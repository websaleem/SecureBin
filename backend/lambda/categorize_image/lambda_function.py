import base64
import json
import logging
import os
import time
import urllib.parse
import boto3

# Configure logger — Lambda routes this to CloudWatch Logs
logger = logging.getLogger()
logger.setLevel(logging.INFO)

_region = os.environ.get("AWS_REGION", "ap-southeast-2")
_s3 = boto3.client("s3", region_name=_region)
_bedrock = boto3.client("bedrock-runtime", region_name=_region)
_ddb = boto3.client("dynamodb", region_name=_region)

TABLE = os.environ["TABLE_NAME"]
# Fallback must match a model the execution role is allowed to invoke; the
# securebin-categorize-role policy is scoped to Nova Lite only.
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-lite-v1:0")

# All bin / disposal colours SecureBin can return
VALID_BINS = {
    "red",      # general waste (landfill)
    "yellow",   # mixed recycling
    "green",    # organics / FOGO
    "white",    # glass-only (older kerbside scheme, SA/NT)
    "purple",   # glass-only (newer AS4123 scheme, VIC / parts of NSW)
    "blue",     # drop-off required (e-waste, batteries, soft plastics, chemicals)
    "orange",   # reuse / donate (still has life)
    "grey",     # unsure / ambiguous — prompt user for more info
}

# Failure classes. The user-facing text is returned to the client verbatim by the
# /result endpoint, so it must never carry internal AWS detail — that goes to
# CloudWatch and to the non-returned errorDetail attribute.
UNCLEAR_IMAGE = (
    "UNCLEAR_IMAGE",
    "Could not categorize the item. Please try again with a clearer photo.",
)
MODEL_BUSY = (
    "MODEL_BUSY",
    "SecureBin is busy right now. Please try again in a moment.",
)
INTERNAL_ERROR = (
    "INTERNAL_ERROR",
    "SecureBin could not complete the scan due to a problem on our end. "
    "This is not a problem with your photo.",
)

# Bedrock/botocore error codes that mean "retry later", not "bad image".
_BUSY_ERROR_CODES = {
    "ThrottlingException",
    "TooManyRequestsException",
    "ServiceQuotaExceededException",
    "ServiceUnavailableException",
    "ModelTimeoutException",
    "ModelNotReadyException",
}


class ImageUnclearError(Exception):
    """The model responded, but its answer was unusable for this image."""


def _classify_failure(exc):
    """Map an exception to a (code, user_message) pair.

    Only genuine model-output problems are reported as a photo problem. Access
    denials, misconfiguration and throttling are reported as server-side faults
    so users are not told to retake a photo that was never the cause.
    """
    if isinstance(exc, ImageUnclearError):
        return UNCLEAR_IMAGE
    error_code = None
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        error_code = response.get("Error", {}).get("Code")
    if error_code in _BUSY_ERROR_CODES:
        return MODEL_BUSY
    return INTERNAL_ERROR

def _unwrap_ddb_value(attr):
    """Convert a DynamoDB typed attribute into a plain Python value."""
    if "S" in attr:
        return attr["S"]
    if "N" in attr:
        # DynamoDB stores numbers as strings; cast to int or float
        n = attr["N"]
        return int(n) if n.isdigit() or (n.startswith("-") and n[1:].isdigit()) else float(n)
    if "BOOL" in attr:
        return attr["BOOL"]
    if "NULL" in attr:
        return None
    if "L" in attr:
        return [_unwrap_ddb_value(v) for v in attr["L"]]
    if "M" in attr:
        return {k: _unwrap_ddb_value(v) for k, v in attr["M"].items()}
    return None

def _get_job_fields(job_id, fields, request_id):
    """
    Fetch specific attributes for a job from DynamoDB.

    fields: list of attribute names to retrieve (e.g. ["state", "councilName"])
    Returns: dict of {field_name: value} for fields that exist on the row.
             Missing fields are omitted from the returned dict (no KeyError).
    """
    # Use ExpressionAttributeNames to safely reference fields, since some
    # attribute names ("status", "key") are DynamoDB reserved words.
    names = {f"#f{i}": f for i, f in enumerate(fields)}
    projection = ", ".join(names.keys())

    try:
        resp = _ddb.get_item(
            TableName=TABLE,
            Key={"jobId": {"S": job_id}},
            ProjectionExpression=projection,
            ExpressionAttributeNames=names,
        )
    except Exception:
        logger.exception(
            "DynamoDB get_item failed | jobId=%s | fields=%s | request_id=%s",
            job_id, fields, request_id,
        )
        raise

    item = resp.get("Item")
    if not item:
        logger.warning(
            "Job not found in DynamoDB | jobId=%s | request_id=%s",
            job_id, request_id,
        )
        return {}

    # Unwrap DynamoDB type descriptors: {"S": "value"} -> "value"
    result = {}
    for field in fields:
        if field in item:
            result[field] = _unwrap_ddb_value(item[field])

    logger.info(
        "DynamoDB fields fetched | jobId=%s | requested=%s | found=%s | request_id=%s",
        job_id, fields, list(result.keys()), request_id,
    )
    return result

def _update_job_status(job_id, status, request_id, **extra):
    """Update the DynamoDB row for a job."""
    expr = "SET #s = :s"
    names = {"#s": "status"}
    values = {":s": {"S": status}}
    for i, (k, v) in enumerate(extra.items()):
        placeholder = f":v{i}"
        name_placeholder = f"#n{i}"
        expr += f", {name_placeholder} = {placeholder}"
        names[name_placeholder] = k

        # Pick DynamoDB type based on Python type
        if isinstance(v, bool):
            values[placeholder] = {"BOOL": v}
        elif isinstance(v, (int, float)):
            values[placeholder] = {"N": str(v)}
        elif v is None:
            values[placeholder] = {"NULL": True}
        else:
            values[placeholder] = {"S": str(v)}

    try:
        _ddb.update_item(
            TableName=TABLE,
            Key={"jobId": {"S": job_id}},
            UpdateExpression=expr,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
        logger.info(
            "DynamoDB update OK | jobId=%s | status=%s | extras=%s | request_id=%s",
            job_id, status, list(extra.keys()), request_id,
        )
    except Exception:
        logger.exception(
            "DynamoDB update failed | jobId=%s | status=%s | request_id=%s",
            job_id, status, request_id,
        )
        raise


import re

def _extract_result(text, job_id, request_id):
    """
    Extract bin, reason, and confidence from Claude's response.
    Handles: pure JSON, markdown-wrapped JSON, prose + JSON.
    Returns: dict with keys {bin, reason, confidence}. Missing fields default.
    """
    # 1. Strip markdown code fences if present
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```\s*$", "", cleaned)
        cleaned = cleaned.strip()
        logger.info("Stripped code fences | jobId=%s | request_id=%s", job_id, request_id)

    # 2. Try direct JSON parse
    obj = None
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            obj = parsed
    except json.JSONDecodeError:
        pass

    # 3. Fall back to extracting any {...} block from the text
    if obj is None:
        match = re.search(r'\{.*\}', cleaned, re.DOTALL)  # greedy: tolerate nested objects
        if match:
            try:
                obj = json.loads(match.group(0))
                logger.info("Extracted JSON via regex | jobId=%s | request_id=%s", job_id, request_id)
            except json.JSONDecodeError:
                pass

    if obj is None:
        logger.warning(
            "Could not parse JSON from response | jobId=%s | text=%r | request_id=%s",
            job_id, text, request_id,
        )
        raise ImageUnclearError(f"Could not parse response as JSON: {text!r}")

    # 4. Extract and normalize fields
    bin_value = obj.get("bin", "").strip().lower() if isinstance(obj.get("bin"), str) else ""
    item = obj.get("item", "").strip() if isinstance(obj.get("item"), str) else ""
    reason = obj.get("reason", "").strip() if isinstance(obj.get("reason"), str) else ""

    # Confidence can come as a float (0.87) or a string ("high" / "0.87")
    confidence_raw = obj.get("confidence")
    if isinstance(confidence_raw, (int, float)):
        confidence = float(confidence_raw)
    elif isinstance(confidence_raw, str):
        try:
            confidence = float(confidence_raw)
        except ValueError:
            confidence = None
    else:
        confidence = None

    if not bin_value:
        logger.warning(
            "Missing bin in parsed response | jobId=%s | obj=%s | request_id=%s",
            job_id, obj, request_id,
        )
        raise ImageUnclearError(f"Response missing 'bin' field: {obj}")

    return {"bin": bin_value, "item": item, "reason": reason, "confidence": confidence}

SYSTEM_PROMPT = """You are SecureBin, a waste item categorization assistant for Australian households. 
Your job is to look at a photo of a single item and tell the user which bin it belongs to based on their local council's rules. The list of bins -
red: General waste, landfill (non-recyclable), contaminated packaging, nappies, broken ceramics, soft plastics in most councils.
yellow: Clean paper, cardboard, hard plastics, aluminium and steel cans, glass (where no separate glass bin).
green: Organics / FOGO (Food scraps, garden waste, uncoated paper towels) Council-dependent.
white: Glass-only kerbside stream in select councils (common for CDS returns in SA/NT)
purple: Newer glass-only kerbside bin, rolling out in Victoria (CRS) and parts of NSW.
blue: Drop-off required (e-waste, batteries, chemicals — take to a collection point, Not kerbside.
orange: Still has life. Clothes, furniture, working electronics — charity bin or marketplace.
grey: Categorization failed or item is ambiguous. Prompt user for more info."""

# Defence in depth: presign validates at the boundary, but rows written before
# that validation existed can still hold arbitrary text. Re-check here, right
# before the values reach the prompt.
try:
    from councils import COUNCILS
except ImportError:  # pragma: no cover - packaging safety net
    COUNCILS = {}
    logger.error("councils allowlist missing from deployment package")

ALLOWED_STATES = set(COUNCILS) or {
    "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA",
}


def _validate_location(state, council):
    """Return (state, council) only if they are an exact known pair.

    Anything else degrades to ("", ""), which the categorizer treats as
    'location unknown' — never as free text to embed in the prompt.
    """
    state = (state or "").strip().upper()
    council = " ".join((council or "").split())
    if state not in ALLOWED_STATES:
        return "", ""
    if council not in COUNCILS.get(state, ()):
        return "", ""
    return state, council


def _categorize_image(image_bytes, media_type, council, state, job_id, request_id):

    # create location context
    state, council = _validate_location(state, council)
    location_ctx = ""
    if council and state:
        location_ctx = (
            f"The user is in {council}, {state}, Australia. "
            f"Apply {council}'s specific bin collection rules where known."
        )
    else:
        location_ctx = "Location unknown. Use general Australian bin guidelines." 

    """Invoke Bedrock and return the bin value."""
    format_str = media_type.split("/")[-1].lower()
    if format_str == "jpg":
        format_str = "jpeg"

    body = {
        "system": [{"text": SYSTEM_PROMPT}],
        "messages": [{
            "role": "user",
            "content": [
                {
                    "image": {
                        "format": format_str,
                        "source": {
                            "bytes": base64.b64encode(image_bytes).decode("ascii")
                        }
                    }
                },
                {
                    "text": (
                        f"""You are an Australian waste categoriation assistant. {location_ctx}                                                                 
                        Look at the item in this image and categorize it into exactly one bin name.
                        Reply with ONLY this JSON, no other text, the reason length should be under 132 chars limit:
                        {{"bin": "<one of the 8 colours above>", "item": "<item name, e.g. Plastic Bottle>", "reason": "<one sentence>", "confidence": <0.0–1.0>}}                                     
                        """
                    )
                }
            ]
        }],
        "inferenceConfig": {"maxTokens": 2000}
    }

    logger.info(
        "Calling Bedrock | jobId=%s | model=%s | image_bytes=%d | media_type=%s | request_id=%s | location_ctx=%s",
        job_id, MODEL_ID, len(image_bytes), media_type, request_id, location_ctx
    )
    t0 = time.perf_counter()

    try:
        resp = _bedrock.invoke_model(
            modelId=MODEL_ID,
            contentType="application/json",
            body=json.dumps(body),
        )
    except Exception:
        logger.exception(
            "Bedrock invoke failed | jobId=%s | model=%s | request_id=%s",
            job_id, MODEL_ID, request_id,
        )
        raise

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    logger.info(
        "Bedrock invoke OK | jobId=%s | elapsed_ms=%d | request_id=%s",
        job_id, elapsed_ms, request_id,
    )

    # Parse Bedrock response
    try:
        parsed = json.loads(resp["body"].read())
        text = parsed["output"]["message"]["content"][0]["text"].strip()
        logger.info(
            "Bedrock raw text | jobId=%s | text=%r | request_id=%s",
            job_id, text, request_id,
        )
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        logger.exception(
            "Failed to read Bedrock envelope | jobId=%s | request_id=%s",
            job_id, request_id,
        )
        raise ValueError(f"Unparseable Bedrock envelope: {e}")

    # Extract results — handle various response formats defensively
    result = _extract_result(text, job_id, request_id)
    return result

def lambda_handler(event, context):
    request_id = getattr(context, "aws_request_id", "unknown")
    records = event.get("Records", [])
    logger.info(
        "categorize invoked | records=%d | request_id=%s",
        len(records), request_id,
    )

    for i, record in enumerate(records):
        # Step 1: extract S3 bucket and key from the event
        try:
            bucket = record["s3"]["bucket"]["name"]
            key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
            size = record["s3"]["object"].get("size", 0)
        except (KeyError, TypeError):
            logger.exception(
                "Malformed S3 record | record_index=%d | request_id=%s",
                i, request_id,
            )
            continue

        # Step 2: extract jobId from the key (format: "uploads/<uuid>.<ext>")
        filename = key.split("/")[-1]
        job_id = filename.rsplit(".", 1)[0]

        logger.info(
            "Processing record %d | bucket=%s | key=%s | size=%d | jobId=%s | request_id=%s",
            i, bucket, key, size, job_id, request_id,
        )

        try:
            # Step 3: fetch image from S3
            try:
                obj = _s3.get_object(Bucket=bucket, Key=key)
                image_bytes = obj["Body"].read()
                media_type = obj.get("ContentType", "image/jpeg")
                logger.info(
                    "S3 get_object OK | jobId=%s | bytes=%d | content_type=%s | request_id=%s",
                    job_id, len(image_bytes), media_type, request_id,
                )
            except Exception:
                logger.exception(
                    "S3 get_object failed | jobId=%s | bucket=%s | key=%s | request_id=%s",
                    job_id, bucket, key, request_id,
                )
                raise

            # Step 4: get state and council name from db
            fields = _get_job_fields(job_id, ["state", "council"], request_id)
            state = fields.get("state")
            council = fields.get("council")

            logger.info(
                "Get council and state from DB for | jobId=%s | state=%s | council=%s | request_id=%s",
                job_id, state, council, request_id,
            )

            # Step 5: categorize image via Bedrock
            result = _categorize_image(image_bytes, media_type, council, state, job_id, request_id)

            # Step 6: validate bin value
            if result["bin"] not in VALID_BINS:
                logger.warning(
                    "Invalid bin from model | jobId=%s | bin=%r | valid=%s | request_id=%s",
                    job_id, result["bin"], sorted(VALID_BINS), request_id,
                )
                _update_job_status(
                    job_id, "failed", request_id,
                    error=UNCLEAR_IMAGE[1],
                    errorCode=UNCLEAR_IMAGE[0],
                    errorDetail=f"model returned invalid bin {result['bin']!r}",
                )
                continue

            # Step 7: write success to DynamoDB  — include reason and confidence
            extras = {
                "bin": result["bin"],
                "item":   result.get("item", ""),
                "reason": result["reason"],
            }
            if result["confidence"] is not None:
                extras["confidence"] = result["confidence"]

            _update_job_status(job_id, "done", request_id, **extras)
            logger.info(
                "Job complete | jobId=%s | bin=%s | confidence=%s | request_id=%s",
                job_id, result["bin"], result["confidence"], request_id,
            )

        except Exception as e:
            logger.exception(
                "Categorization failed | jobId=%s | request_id=%s",
                job_id, request_id,
            )
            # Record the failure in DynamoDB so the client polling /result sees it.
            # errorDetail is stored for operators and is not returned by /result.
            error_code, user_message = _classify_failure(e)
            logger.error(
                "Job failed | jobId=%s | errorCode=%s | detail=%s | request_id=%s",
                job_id, error_code, f"{type(e).__name__}: {e}", request_id,
            )
            try:
                _update_job_status(
                    job_id, "failed", request_id,
                    error=user_message,
                    errorCode=error_code,
                    errorDetail=f"{type(e).__name__}: {e}"[:900],
                )
            except Exception:
                logger.exception(
                    "Failed to record failure status | jobId=%s | request_id=%s",
                    job_id, request_id,
                )

    logger.info("categorization completed | request_id=%s", request_id)
    return {"ok": True}