#!/usr/bin/env bash
# ONE-TIME: adopt the hand-built production backend into CloudFormation.
#
# Production was created in the console years before infra/securebin-backend.yml
# existed. Two stacks — securebin-prod-backend and securebin-dev-backend — held
# a parallel, unused copy of the same shapes with CloudFormation-generated
# names, while the functions the live distribution actually routes to
# (sbGetPresignURL, sbCategorizeImage, sbGetJobResult) belonged to no stack at
# all. This script makes the stack own the real resources instead of look-alikes.
#
# It is kept in the repo after the fact because "how did prod get into
# CloudFormation" is a question worth being able to answer, and because a
# rebuilt account would need to run it again.
#
# WHAT IMPORT DOES AND DOES NOT DO. Import only records existing resources in a
# stack; it never modifies them, and a resource can belong to one stack only. It
# requires the template to contain *nothing but* the resources being imported,
# which is why this generates a subset template: AWS::Lambda::Permission has no
# update handler and cannot be imported, so the four invoke permissions are
# added afterwards by scripts/deploy-backend.sh. The live hand-made permission
# statements stay in place until then, so there is no window where CloudFront
# cannot invoke the functions.
#
# AFTER THIS SCRIPT: run `./scripts/deploy-backend.sh prod` and read the change
# set before approving it. That update is what reconciles the imported resources
# with the template (adds the managed permissions, drops the unused
# s3:DeleteObject grant). An import leaves drift behind by design; the first
# update is where the drift is settled, and it is the step that can bite.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGION="ap-southeast-2"
STACK="securebin-backend-prod"
EXPECTED_ACCOUNT="715626528514"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if [ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]; then
  echo "FATAL: wrong account ($ACCOUNT, expected $EXPECTED_ACCOUNT)" >&2
  exit 1
fi

# An unexecuted IMPORT change set leaves the stack in REVIEW_IN_PROGRESS — a
# shell with no resources, which is what --dry-run produces. That state is
# resumable; any other existing state means the import already happened.
STATUS="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo NONE)"
if [ "$STATUS" != "NONE" ] && [ "$STATUS" != "REVIEW_IN_PROGRESS" ]; then
  echo "$STACK exists ($STATUS) — import has already run. Use deploy-backend.sh." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "=== uploading code artifacts (the import must record the keys the next deploy will use)"
KEYS="$(bash "$ROOT/scripts/deploy-backend.sh" prod --artifacts-only | tail -4)"
eval "$KEYS"
echo "$KEYS"

# The subset template. Properties are stated as literals rather than !GetAtt /
# !Sub so that this file stands alone and can be diffed against the account by
# eye; they resolve to the same values the real template produces, so the
# follow-up deploy reports no change to them.
cat > "$WORK/import.yml" <<YML
AWSTemplateFormatVersion: '2010-09-09'
Description: Import-only subset of infra/securebin-backend.yml. Not the source of truth.
Resources:
  JobsTable:
    Type: AWS::DynamoDB::Table
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: securebin-categorize-jobs
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: jobId
          AttributeType: S
      KeySchema:
        - AttributeName: jobId
          KeyType: HASH
      TimeToLiveSpecification:
        AttributeName: ttl
        Enabled: true

  UploadsBucket:
    Type: AWS::S3::Bucket
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      BucketName: securebin-image-s3-uploads
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        IgnorePublicAcls: true
        BlockPublicPolicy: true
        RestrictPublicBuckets: true
      OwnershipControls:
        Rules:
          - ObjectOwnership: BucketOwnerEnforced
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
            BucketKeyEnabled: true
            BlockedEncryptionTypes:
              EncryptionType:
                - SSE-C
      CorsConfiguration:
        CorsRules:
          - AllowedHeaders: ['Content-Type', '*']
            AllowedMethods: [PUT, POST, GET]
            AllowedOrigins: ['*']
      LifecycleConfiguration:
        Rules:
          - Id: securebin-expire-uploads
            Status: Enabled
            Prefix: uploads/
            ExpirationInDays: 1
          - Id: securebin-abort-incomplete-multipart
            Status: Enabled
            Prefix: ''
            AbortIncompleteMultipartUpload:
              DaysAfterInitiation: 1
      NotificationConfiguration:
        LambdaConfigurations:
          - Event: s3:ObjectCreated:Put
            Function: arn:aws:lambda:${REGION}:${ACCOUNT}:function:sbCategorizeImage
            Filter:
              S3Key:
                Rules:
                  - Name: prefix
                    Value: uploads/
          - Event: s3:ObjectCreated:Post
            Function: arn:aws:lambda:${REGION}:${ACCOUNT}:function:sbCategorizeImage
            Filter:
              S3Key:
                Rules:
                  - Name: prefix
                    Value: uploads/

  GetPresignUrlRole:
    Type: AWS::IAM::Role
    DeletionPolicy: Retain
    Properties:
      RoleName: securebin-s3-presign-role
      Description: Allows Lambda functions to call AWS services on your behalf.
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: lambda.amazonaws.com }
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      Policies:
        - PolicyName: securebin-s3-presign-policy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: s3:PutObject
                Resource: arn:aws:s3:::securebin-image-s3-uploads/uploads/*
              - Effect: Allow
                Action: dynamodb:PutItem
                Resource: arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/securebin-categorize-jobs

  CategorizeImageRole:
    Type: AWS::IAM::Role
    DeletionPolicy: Retain
    Properties:
      RoleName: securebin-categorize-role
      Description: Allows Lambda functions to call AWS services on your behalf.
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: lambda.amazonaws.com }
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      Policies:
        - PolicyName: securebin-categorize-policy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              # Imported AS IT IS TODAY, DeleteObject included. Changing it here
              # would be a lie about the resource being adopted; the grant is
              # removed by the deploy that follows.
              - Sid: S3ReadDelete
                Effect: Allow
                Action:
                  - s3:GetObject
                  - s3:DeleteObject
                Resource: arn:aws:s3:::securebin-image-s3-uploads/uploads/*
              - Sid: DynamoDBUpdate
                Effect: Allow
                Action:
                  - dynamodb:GetItem
                  - dynamodb:UpdateItem
                Resource: arn:aws:dynamodb:${REGION}:*:table/securebin-categorize-jobs
              - Sid: BedrockInvokeNova
                Effect: Allow
                Action:
                  - bedrock:InvokeModel
                  - bedrock:InvokeModelWithResponseStream
                Resource:
                  - arn:aws:bedrock:${REGION}::foundation-model/amazon.nova-lite-v1:0

  GetJobResultRole:
    Type: AWS::IAM::Role
    DeletionPolicy: Retain
    Properties:
      RoleName: securebin-categorize-result-role
      Description: Allows Lambda functions to call AWS services on your behalf.
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: lambda.amazonaws.com }
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
      Policies:
        - PolicyName: securebin-categorize-result-policy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - dynamodb:GetItem
                Resource: arn:aws:dynamodb:${REGION}:*:table/securebin-categorize-jobs

  GetPresignUrlLambda:
    Type: AWS::Lambda::Function
    DeletionPolicy: Retain
    Properties:
      FunctionName: sbGetPresignURL
      Runtime: python3.14
      Handler: lambda_function.lambda_handler
      Role: arn:aws:iam::${ACCOUNT}:role/securebin-s3-presign-role
      Timeout: 10
      MemorySize: 256
      Architectures: [x86_64]
      Environment:
        Variables:
          BUCKET_NAME: securebin-image-s3-uploads
          TABLE_NAME: securebin-categorize-jobs
      Code:
        S3Bucket: ${ArtifactsBucket}
        S3Key: ${PresignCodeKey}

  CategorizeImageLambda:
    Type: AWS::Lambda::Function
    DeletionPolicy: Retain
    Properties:
      FunctionName: sbCategorizeImage
      Runtime: python3.14
      Handler: lambda_function.lambda_handler
      Role: arn:aws:iam::${ACCOUNT}:role/securebin-categorize-role
      Timeout: 30
      MemorySize: 512
      Architectures: [x86_64]
      Environment:
        Variables:
          TABLE_NAME: securebin-categorize-jobs
          MODEL_ID: amazon.nova-lite-v1:0
      Code:
        S3Bucket: ${ArtifactsBucket}
        S3Key: ${CategorizeCodeKey}

  GetJobResultLambda:
    Type: AWS::Lambda::Function
    DeletionPolicy: Retain
    Properties:
      FunctionName: sbGetJobResult
      Runtime: python3.14
      Handler: lambda_function.lambda_handler
      Role: arn:aws:iam::${ACCOUNT}:role/securebin-categorize-result-role
      Timeout: 10
      MemorySize: 256
      Architectures: [x86_64]
      Environment:
        Variables:
          TABLE_NAME: securebin-categorize-jobs
      Code:
        S3Bucket: ${ArtifactsBucket}
        S3Key: ${JobResultCodeKey}

  GetPresignUrlFunctionUrl:
    Type: AWS::Lambda::Url
    DeletionPolicy: Retain
    Properties:
      TargetFunctionArn: arn:aws:lambda:${REGION}:${ACCOUNT}:function:sbGetPresignURL
      AuthType: AWS_IAM

  GetJobResultFunctionUrl:
    Type: AWS::Lambda::Url
    DeletionPolicy: Retain
    Properties:
      TargetFunctionArn: arn:aws:lambda:${REGION}:${ACCOUNT}:function:sbGetJobResult
      AuthType: AWS_IAM

  PresignOAC:
    Type: AWS::CloudFront::OriginAccessControl
    DeletionPolicy: Retain
    Properties:
      OriginAccessControlConfig:
        Name: securebin-presign-oac
        OriginAccessControlOriginType: lambda
        SigningBehavior: always
        SigningProtocol: sigv4

  JobResultOAC:
    Type: AWS::CloudFront::OriginAccessControl
    DeletionPolicy: Retain
    Properties:
      OriginAccessControlConfig:
        Name: securebin-categorize-job-oac
        OriginAccessControlOriginType: lambda
        SigningBehavior: always
        SigningProtocol: sigv4
YML

cat > "$WORK/resources.json" <<JSON
[
  {"ResourceType":"AWS::DynamoDB::Table","LogicalResourceId":"JobsTable",
   "ResourceIdentifier":{"TableName":"securebin-categorize-jobs"}},
  {"ResourceType":"AWS::S3::Bucket","LogicalResourceId":"UploadsBucket",
   "ResourceIdentifier":{"BucketName":"securebin-image-s3-uploads"}},
  {"ResourceType":"AWS::IAM::Role","LogicalResourceId":"GetPresignUrlRole",
   "ResourceIdentifier":{"RoleName":"securebin-s3-presign-role"}},
  {"ResourceType":"AWS::IAM::Role","LogicalResourceId":"CategorizeImageRole",
   "ResourceIdentifier":{"RoleName":"securebin-categorize-role"}},
  {"ResourceType":"AWS::IAM::Role","LogicalResourceId":"GetJobResultRole",
   "ResourceIdentifier":{"RoleName":"securebin-categorize-result-role"}},
  {"ResourceType":"AWS::Lambda::Function","LogicalResourceId":"GetPresignUrlLambda",
   "ResourceIdentifier":{"FunctionName":"sbGetPresignURL"}},
  {"ResourceType":"AWS::Lambda::Function","LogicalResourceId":"CategorizeImageLambda",
   "ResourceIdentifier":{"FunctionName":"sbCategorizeImage"}},
  {"ResourceType":"AWS::Lambda::Function","LogicalResourceId":"GetJobResultLambda",
   "ResourceIdentifier":{"FunctionName":"sbGetJobResult"}},
  {"ResourceType":"AWS::Lambda::Url","LogicalResourceId":"GetPresignUrlFunctionUrl",
   "ResourceIdentifier":{"FunctionArn":"arn:aws:lambda:${REGION}:${ACCOUNT}:function:sbGetPresignURL"}},
  {"ResourceType":"AWS::Lambda::Url","LogicalResourceId":"GetJobResultFunctionUrl",
   "ResourceIdentifier":{"FunctionArn":"arn:aws:lambda:${REGION}:${ACCOUNT}:function:sbGetJobResult"}},
  {"ResourceType":"AWS::CloudFront::OriginAccessControl","LogicalResourceId":"PresignOAC",
   "ResourceIdentifier":{"Id":"E2SZ2HLBWOBZZS"}},
  {"ResourceType":"AWS::CloudFront::OriginAccessControl","LogicalResourceId":"JobResultOAC",
   "ResourceIdentifier":{"Id":"EVYBJBXDW7PC8"}}
]
JSON

CS="import-$(date +%Y%m%d-%H%M%S)"
echo "=== creating import change set $CS"
aws cloudformation create-change-set \
  --region "$REGION" \
  --stack-name "$STACK" \
  --change-set-name "$CS" \
  --change-set-type IMPORT \
  --capabilities CAPABILITY_NAMED_IAM \
  --template-body "file://$WORK/import.yml" \
  --resources-to-import "file://$WORK/resources.json" \
  --query Id --output text

aws cloudformation wait change-set-create-complete \
  --region "$REGION" --stack-name "$STACK" --change-set-name "$CS" 2>/dev/null || {
    aws cloudformation describe-change-set --region "$REGION" \
      --stack-name "$STACK" --change-set-name "$CS" \
      --query "{Status:Status,Reason:StatusReason}" --output json
    echo "FATAL: change set did not reach CREATE_COMPLETE" >&2
    exit 1
  }

echo "=== change set contents (all should be Import)"
aws cloudformation describe-change-set --region "$REGION" \
  --stack-name "$STACK" --change-set-name "$CS" \
  --query "Changes[].ResourceChange.{Action:Action,Logical:LogicalResourceId,Physical:PhysicalResourceId}" \
  --output table

if [ "${1:-}" = "--dry-run" ]; then
  echo "=== --dry-run: change set left unexecuted. Delete it or re-run without the flag."
  exit 0
fi

echo "=== executing"
aws cloudformation execute-change-set --region "$REGION" \
  --stack-name "$STACK" --change-set-name "$CS"
aws cloudformation wait stack-import-complete --region "$REGION" --stack-name "$STACK"
echo "=== imported. Next: ./scripts/deploy-backend.sh prod"
