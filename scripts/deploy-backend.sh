#!/usr/bin/env bash
# Deploy the SecureBin backend — infrastructure AND Lambda code — for one
# environment.
#
#   ./scripts/deploy-backend.sh prod
#   ./scripts/deploy-backend.sh dev
#
# Why this exists: production used to be deployable only by hand, with
# `aws lambda update-function-code` against functions no stack owned. The code
# and the infrastructure drifted apart because nothing made them move together.
# They move together here: the package sha256 becomes the S3 key, the key is a
# stack parameter, so "the running code" and "the stack" are the same fact.
#
# Re-running with unchanged source produces the same keys and CloudFormation
# reports no changes. That property is the point — it makes the deploy safe to
# run to answer the question "is prod what the repo says?"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_NAME="${1:-}"
REGION="ap-southeast-2"
EXPECTED_ACCOUNT="715626528514"

# --artifacts-only stops after the upload and prints the keys as shell
# assignments. scripts/import-prod-backend.sh needs the keys before the stack
# exists, and they must be produced by exactly this code or the import would
# record a key the next deploy then "changes".
#
# --dry-run builds the change set and prints it without executing. Worth using
# on prod: this stack was imported, so the first deploy after any import is the
# one that reconciles drift, and reconciliation is where a missing template
# property turns into a deleted setting.
ARTIFACTS_ONLY=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --artifacts-only) ARTIFACTS_ONLY=1 ;;
    --dry-run)        DRY_RUN=1 ;;
  esac
done

case "$ENV_NAME" in
  prod)
    STACK="securebin-backend-prod"
    SUFFIX=""
    BUCKET="securebin-image-s3-uploads"
    TABLE="securebin-categorize-jobs"
    DIST="E90FW67SOXKZN"
    ;;
  dev)
    STACK="securebin-backend-dev"
    SUFFIX="-dev"
    BUCKET="securebin-image-s3-uploads-dev"
    TABLE="securebin-categorize-jobs-dev"
    DIST="E1RSG4XSFIN3LV"
    ;;
  *)
    echo "usage: $0 {prod|dev}" >&2
    exit 2
    ;;
esac

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if [ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]; then
  echo "FATAL: wrong account ($ACCOUNT, expected $EXPECTED_ACCOUNT)" >&2
  exit 1
fi

ARTIFACTS="securebin-lambda-artifacts-${ACCOUNT}"
BUILD="$ROOT/backend/build"

echo "=== staging packages"
bash "$ROOT/scripts/package_lambdas.sh"

# A zip of identical sources must hash identically, or the key changes on every
# run and every deploy looks like a code change. Python's zipfile with a fixed
# timestamp and sorted entries gives that; `zip` does not, because it records
# mtimes.
zip_deterministic() {
  local dir="$1" out="$2"
  python3 - "$dir" "$out" <<'PY'
import sys, os, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir(src)):
        path = os.path.join(src, name)
        if not os.path.isfile(path):
            continue
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.external_attr = 0o644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        with open(path, "rb") as fh:
            z.writestr(info, fh.read())
PY
}

echo "=== ensuring artifacts bucket s3://$ARTIFACTS"
if ! aws s3api head-bucket --bucket "$ARTIFACTS" --region "$REGION" >/dev/null 2>&1; then
  aws s3api create-bucket --bucket "$ARTIFACTS" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  aws s3api put-public-access-block --bucket "$ARTIFACTS" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$ARTIFACTS" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  # Versioning so a key can never be repointed at different bytes.
  aws s3api put-bucket-versioning --bucket "$ARTIFACTS" \
    --versioning-configuration Status=Enabled
  echo "  created"
fi

# Plain variables rather than an associative array: macOS ships bash 3.2, where
# `declare -A` does not exist.
KEY_PRESIGN=""
KEY_CATEGORIZE=""
KEY_RESULT=""

for fn in get_presign_url categorize_image get_job_result; do
  zip_path="$BUILD/$fn.zip"
  zip_deterministic "$BUILD/$fn" "$zip_path"
  sha="$(python3 -c "
import hashlib,sys
print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest()[:16])" "$zip_path")"
  key="${ENV_NAME}/${fn}-${sha}.zip"
  case "$fn" in
    get_presign_url)  KEY_PRESIGN="$key" ;;
    categorize_image) KEY_CATEGORIZE="$key" ;;
    get_job_result)   KEY_RESULT="$key" ;;
  esac
  if aws s3api head-object --bucket "$ARTIFACTS" --key "$key" >/dev/null 2>&1; then
    echo "  $fn -> s3://$ARTIFACTS/$key (already uploaded)"
  else
    aws s3 cp "$zip_path" "s3://$ARTIFACTS/$key" --only-show-errors
    echo "  $fn -> s3://$ARTIFACTS/$key (uploaded)"
  fi
done

if [ "$ARTIFACTS_ONLY" = "1" ]; then
  echo "PresignCodeKey=$KEY_PRESIGN"
  echo "CategorizeCodeKey=$KEY_CATEGORIZE"
  echo "JobResultCodeKey=$KEY_RESULT"
  echo "ArtifactsBucket=$ARTIFACTS"
  exit 0
fi

echo "=== deploying $STACK"
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK" \
  --template-file "$ROOT/infra/securebin-backend.yml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  $( [ "$DRY_RUN" = "1" ] && echo --no-execute-changeset ) \
  --parameter-overrides \
    "ResourceSuffix=$SUFFIX" \
    "UploadsBucketName=$BUCKET" \
    "JobsTableName=$TABLE" \
    "DistributionId=$DIST" \
    "ArtifactsBucket=$ARTIFACTS" \
    "PresignCodeKey=$KEY_PRESIGN" \
    "CategorizeCodeKey=$KEY_CATEGORIZE" \
    "JobResultCodeKey=$KEY_RESULT"

if [ "$DRY_RUN" = "1" ]; then
  CS="$(aws cloudformation list-change-sets --region "$REGION" --stack-name "$STACK" \
    --query "sort_by(Summaries[?ExecutionStatus=='AVAILABLE'],&CreationTime)[-1].ChangeSetName" \
    --output text)"
  echo "=== change set $CS (not executed)"
  aws cloudformation describe-change-set --region "$REGION" --stack-name "$STACK" \
    --change-set-name "$CS" \
    --query "Changes[].ResourceChange.{Action:Action,Logical:LogicalResourceId,Replace:Replacement,Scope:Scope}" \
    --output table
  exit 0
fi

echo "=== outputs"
aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Outputs[].[OutputKey,OutputValue]" --output table
