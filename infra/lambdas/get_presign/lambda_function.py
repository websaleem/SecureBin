import json
import logging
import os
import time
import uuid
import boto3
from botocore.config import Config

# Configure logger — Lambda automatically routes this to CloudWatch Logs
logger = logging.getLogger()
logger.setLevel(logging.INFO)

_region = os.environ.get("AWS_REGION", "ap-southeast-2")
_s3 = boto3.client(
    "s3",
    region_name=_region,
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
)
_ddb = boto3.client("dynamodb", region_name=_region)

BUCKET = os.environ["BUCKET_NAME"]
TABLE = os.environ["TABLE_NAME"]
EXPIRES = 300
TTL_HOURS = 24
ALLOWED_MEDIA = {"image/jpeg", "image/png", "image/webp"}


def _json(status, obj):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(obj),
    }


def lambda_handler(event, context):
    request_id = getattr(context, "aws_request_id", "unknown")
    logger.info("presign invoked", extra={"request_id": request_id})

    try:
        # Step 1: parse mediaType from query string
        params = event.get("queryStringParameters") or {}                     
        media_type = params.get("mediaType")
        state = params.get("state") or ""
        council = params.get("council") or ""
        logger.info("Parsed request | request_id=%s | mediaType=%s | council=%s | state=%s", request_id, media_type, council, state)  

        # Step 2: validate mediaType
        if media_type not in ALLOWED_MEDIA:
            logger.warning(
                "Rejected mediaType=%r (allowed=%s) | request_id=%s",
                media_type, sorted(ALLOWED_MEDIA), request_id,
            )
            return _json(400, {"error": "Invalid or missing mediaType"})

        # Step 3: generate jobId and S3 key
        job_id = str(uuid.uuid4())
        ext = media_type.split("/")[1]
        key = f"uploads/{job_id}.{ext}"
        logger.info("Generated job | jobId=%s | key=%s | request_id=%s", job_id, key, request_id)

        # Step 4: write pending row to DynamoDB
        now = int(time.time())
        ttl_value = now + TTL_HOURS * 3600
        try:
            _ddb.put_item(
                TableName=TABLE,
                Item={
                    "jobId": {"S": job_id},
                    "status": {"S": "pending"},
                    "key": {"S": key},
                    "council": {"S": council},
                    "state": {"S": state},
                    "createdAt": {"N": str(now)},
                    "ttl": {"N": str(ttl_value)},
                },
            )
            logger.info(
                "DynamoDB put_item OK | jobId=%s | table=%s | ttl=%d | request_id=%s | mediaType=%s | council=%s | state=%s",
                job_id, TABLE, ttl_value, request_id, media_type, council, state
            )
        except Exception as e:
            logger.exception(
                "DynamoDB put_item failed | jobId=%s | table=%s | request_id=%s",
                job_id, TABLE, request_id,
            )
            raise

        # Step 5: generate presigned PUT
        try:
            presigned_url = _s3.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': BUCKET,
                    'Key': key,
                    'ContentType': media_type
                },
                ExpiresIn=EXPIRES,
                HttpMethod='PUT'
            )
            logger.info(
                "Presigned PUT generated | jobId=%s | bucket=%s | expires_in=%d | request_id=%s",
                job_id, BUCKET, EXPIRES, request_id,
            )
        except Exception as e:
            logger.exception(
                "Presign failed | jobId=%s | bucket=%s | request_id=%s",
                job_id, BUCKET, request_id,
            )
            raise

        # Step 6: return success
        logger.info("presign success | jobId=%s | request_id=%s", job_id, request_id)
        return _json(200, {
            "uploadUrl": presigned_url,
            "jobId": job_id,
            "expiresIn": EXPIRES
        })

    except Exception as e:
        logger.exception("presign failed with unexpected error | request_id=%s", request_id)
        return _json(500, {"error": "Internal error"})