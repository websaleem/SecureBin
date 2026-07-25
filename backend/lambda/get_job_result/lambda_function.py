import json
import logging
import os
import re
import boto3

# Configure logger — Lambda routes this to CloudWatch Logs
logger = logging.getLogger()
logger.setLevel(logging.INFO)

_region = os.environ.get("AWS_REGION", "ap-southeast-2")
_ddb = boto3.client("dynamodb", region_name=_region)
TABLE = os.environ["TABLE_NAME"]


def _json(status, obj):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(obj),
    }


def lambda_handler(event, context):
    request_id = getattr(context, "aws_request_id", "unknown")
    logger.info("result invoked | request_id=%s", request_id)

    try:
        # Step 1: extract jobId from the request path
        job_id = None
        path_params = event.get("pathParameters") or {}

        if path_params.get("jobId"):
            job_id = path_params["jobId"]
            logger.info(
                "Resolved jobId from pathParameters | jobId=%s | request_id=%s",
                job_id, request_id,
            )
        else:
            raw_path = event.get("rawPath") or event.get("path") or ""
            parts = raw_path.strip("/").split("/")
            if len(parts) >= 2 and parts[0] == "result":
                job_id = parts[1]
                logger.info(
                    "Resolved jobId from rawPath | jobId=%s | rawPath=%s | request_id=%s",
                    job_id, raw_path, request_id,
                )
            else:
                logger.warning(
                    "Could not resolve jobId | rawPath=%r | pathParameters=%s | request_id=%s",
                    raw_path, path_params, request_id,
                )

        # Step 2: validate jobId presence and format
        if not job_id:
            logger.warning("Missing jobId in request | request_id=%s", request_id)
            return _json(400, {"error": "Missing jobId"})

        if not re.match(r'^[a-zA-Z0-9\-]{1,128}$', job_id):
            logger.warning("Invalid jobId format | jobId=%r | request_id=%s", job_id, request_id)
            return _json(400, {"error": "Invalid jobId format"})

        # Step 3: fetch item from DynamoDB
        try:
            resp = _ddb.get_item(TableName=TABLE, Key={"jobId": {"S": job_id}})
            logger.info(
                "DynamoDB get_item OK | jobId=%s | table=%s | found=%s | request_id=%s",
                job_id, TABLE, "Item" in resp, request_id,
            )
        except Exception:
            logger.exception(
                "DynamoDB get_item failed | jobId=%s | table=%s | request_id=%s",
                job_id, TABLE, request_id,
            )
            raise

        # Step 4: handle missing job
        item = resp.get("Item")
        if not item:
            logger.info(
                "Job not found | jobId=%s | request_id=%s",
                job_id, request_id,
            )
            return _json(404, {"error": "Job not found"})

        # Step 5: build response based on status
        status = item["status"]["S"]
        out = {"jobId": job_id, "status": status}

        if status == "done":
            out["bin"] = item["bin"]["S"]
            out["item"] = "Unknown"
            if "item" in item:
                out["item"] = item["item"]["S"]
            out["reason"] = ""
            if "reason" in item:
                out["reason"] = item["reason"]["S"]
            out["confidence"] = 0.0
            if "confidence" in item:
                # confidence was stored as N (number)
                out["confidence"] = float(item["confidence"]["N"])
            logger.info(
                "Job done | jobId=%s | request_id=%s | bin=%s | item=%s | reason=%s | confidence=%0.2f",
                job_id, request_id, out["bin"], out["item"], out["reason"], out["confidence"]
            )
        elif status == "failed":
            out["error"] = item.get("error", {}).get("S", "unknown")
            logger.warning(
                "Job failed | jobId=%s | error=%s | request_id=%s",
                job_id, out["error"], request_id,
            )
        else:
            logger.info(
                "Job in progress | jobId=%s | status=%s | request_id=%s",
                job_id, status, request_id,
            )

        # Step 6: return
        return _json(200, out)

    except Exception:
        logger.exception("result failed with unexpected error | request_id=%s", request_id)
        return _json(500, {"error": "Internal error"})