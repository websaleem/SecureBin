#!/usr/bin/env bash
# Stage each Lambda's source together with the shared modules it imports.
#
# get_presign_url and categorize_image both `from councils import COUNCILS`, but
# councils.py lives in backend/lambda/shared/ so that one generated copy serves
# both. A Lambda deployment package has no notion of a sibling directory, so the
# shared modules must be copied in before packaging — otherwise the import fails
# at runtime, COUNCILS is empty, and every location silently degrades to
# "unknown" instead of giving council-specific advice.
#
# Run this before `aws cloudformation deploy`; the template's Code paths point at
# the staged directories this produces.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/backend/lambda"
BUILD="$ROOT/backend/build"

# Functions that need the shared council allowlist.
NEEDS_SHARED=(get_presign_url categorize_image)
ALL_FNS=(get_presign_url categorize_image get_job_result)

# Regenerate the allowlist so it cannot drift from constants/councils.ts.
python3 "$ROOT/scripts/gen_councils.py"

rm -rf "$BUILD"
for fn in "${ALL_FNS[@]}"; do
  mkdir -p "$BUILD/$fn"
  cp "$SRC/$fn/lambda_function.py" "$BUILD/$fn/"
  for needs in "${NEEDS_SHARED[@]}"; do
    if [ "$fn" = "$needs" ]; then
      cp "$SRC/shared/councils.py" "$BUILD/$fn/"
    fi
  done
  echo "staged $fn -> backend/build/$fn ($(ls "$BUILD/$fn" | tr '\n' ' '))"
done

# Fail loudly rather than shipping a package whose import will fail at runtime.
for fn in "${NEEDS_SHARED[@]}"; do
  if [ ! -f "$BUILD/$fn/councils.py" ]; then
    echo "FATAL: councils.py missing from $fn package" >&2
    exit 1
  fi
  ( cd "$BUILD/$fn" && python3 -c "import councils; assert councils.COUNCILS, 'empty allowlist'; \
      print('  verified: %d states, %d councils' % (len(councils.COUNCILS), sum(len(v) for v in councils.COUNCILS.values())))" )
done

echo "OK — deploy with: aws cloudformation deploy --template-file infra/securebin-backend.yml ..."
