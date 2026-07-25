#!/usr/bin/env python3
"""
SecureBin — CloudFront API pipeline test caller.

Mirrors the 3-step flow used by categorizeImage() in the app:
  1. GET /presign  → obtain pre-signed S3 upload URL + jobId
  2. PUT image     → upload JPEG directly to S3 via the pre-signed URL
  3. GET /result   → poll until status is 'done' or 'failed'

Usage:
  # Basic test (no location)
  python testbin.py test/images/plastic_bottle.jpg

  # With state + council (tests location-aware Bedrock prompt)
  python testbin.py test/images/plastic_bottle.jpg \
    --state VIC \
    --council "City of Melbourne"

  # Override the CloudFront base URL
  python testbin.py test/images/banana_peel.jpg \
    --state NSW \
    --council "City of Sydney Council" \
    --base-url https://xxxx.cloudfront.net

Env vars (fallbacks):
  SECUREBIN_API_BASE_URL   CloudFront base URL (e.g. https://xxxx.cloudfront.net)
"""

import argparse
import io
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import requests
from PIL import Image

# Match the app's resizeImage() settings.
MAX_DIMENSION = 1024
JPEG_QUALITY = 85
POLL_INTERVAL_S = 2
POLL_MAX_ATTEMPTS = 30

VALID_BINS = {"red", "green", "yellow", "white", "purple", "blue", "orange", "grey"}


def resize_image(image_path: Path) -> bytes:
    """Resize image to fit MAX_DIMENSION and return JPEG bytes."""
    with Image.open(image_path) as img:
        img = img.convert("RGB")
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return buf.getvalue()


def step_presign(
    base_url: str, state: str | None, council: str | None, timeout: int
) -> tuple[str, dict[str, str], str]:
    """Step 1: Request a pre-signed S3 upload URL and jobId."""
    params: dict[str, str] = {"mediaType": "image/jpeg"}
    if state:
        params["state"] = state
    if council:
        params["council"] = council

    url = f"{base_url}/presign?{urlencode(params)}"
    print(f"  → GET {url}")

    resp = requests.get(url, timeout=timeout)
    if not resp.ok:
        raise RuntimeError(
            f"Presign error: {resp.status_code}\nBody: {resp.text[:500]}"
        )

    data = resp.json()
    upload_url = data.get("uploadUrl", "")
    upload_fields = data.get("uploadFields", {})
    job_id = data.get("jobId", "")
    if not upload_url or not job_id:
        raise RuntimeError(f"Unexpected presign response: {json.dumps(data, indent=2)}")

    print(f"  → jobId: {job_id}")
    return upload_url, upload_fields, job_id


def step_upload(upload_url: str, upload_fields: dict[str, str], image_bytes: bytes, timeout: int) -> None:
    """Step 2: POST the JPEG directly to S3 via the pre-signed URL."""
    print(f"  → POST {len(image_bytes):,} bytes to S3")
    files = {"file": ("upload.jpg", image_bytes, "image/jpeg")}
    resp = requests.post(
        upload_url,
        data=upload_fields,
        files=files,
        timeout=timeout,
    )
    if not resp.ok:
        raise RuntimeError(
            f"S3 upload error: {resp.status_code}\nBody: {resp.text[:500]}"
        )
    print("  → Upload OK")


def step_poll(base_url: str, job_id: str, timeout: int) -> dict:
    """Step 3: Poll GET /result/{jobId} until done or failed."""
    url = f"{base_url}/result/{job_id}"
    for attempt in range(1, POLL_MAX_ATTEMPTS + 1):
        time.sleep(POLL_INTERVAL_S)
        print(f"  → Poll {attempt}/{POLL_MAX_ATTEMPTS}  GET {url}")
        resp = requests.get(url, timeout=timeout)
        if not resp.ok:
            raise RuntimeError(
                f"Result API error: {resp.status_code}\nBody: {resp.text[:500]}"
            )
        data = resp.json()
        status = data.get("status")
        if status == "done":
            return data
        if status == "failed":
            raise RuntimeError(
                f"Categorization failed: {data.get('error', 'unknown')}"
            )
    raise RuntimeError(
        f"Timed out after {POLL_MAX_ATTEMPTS * POLL_INTERVAL_S}s"
    )


def validate(result: dict) -> list[str]:
    """Return a list of validation issues (empty = all good)."""
    issues = []
    bin_value = result.get("bin")
    if bin_value not in VALID_BINS:
        issues.append(
            f"Unexpected bin value: {bin_value!r} (expected one of {sorted(VALID_BINS)})"
        )
    if not result.get("item"):
        issues.append("Missing 'item' field in result")
    if not result.get("reason"):
        issues.append("Missing 'reason' field in result")
    return issues


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Test the SecureBin categorization pipeline via CloudFront."
    )
    ap.add_argument("image", type=Path, help="Path to a local image file")
    ap.add_argument(
        "--base-url",
        default=os.environ.get("SECUREBIN_API_BASE_URL"),
        help="CloudFront base URL (or set SECUREBIN_API_BASE_URL env var)",
    )
    ap.add_argument("--state", default=None, help="Australian state/territory code (e.g. VIC)")
    ap.add_argument("--council", default=None, help='Council name (e.g. "City of Melbourne")')
    ap.add_argument("--timeout", type=int, default=30, help="HTTP request timeout in seconds")
    args = ap.parse_args()

    if not args.base_url:
        print("ERROR: Provide --base-url or set SECUREBIN_API_BASE_URL", file=sys.stderr)
        return 2
    if not args.image.is_file():
        print(f"ERROR: Not a file: {args.image}", file=sys.stderr)
        return 2

    base_url = args.base_url.rstrip("/")

    print(f"Image:   {args.image}")
    print(f"Base:    {base_url}")
    if args.state:
        print(f"State:   {args.state}")
    if args.council:
        print(f"Council: {args.council}")
    print()

    # Resize image
    try:
        image_bytes = resize_image(args.image)
    except Exception as e:
        print(f"ERROR encoding image: {e}", file=sys.stderr)
        return 1
    print(f"Encoded: {len(image_bytes):,} bytes JPEG")

    start = time.perf_counter()

    # Step 1: Presign
    print("\n[1/3] Requesting pre-signed URL…")
    try:
        upload_url, upload_fields, job_id = step_presign(base_url, args.state, args.council, args.timeout)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    # Step 2: Upload
    print("\n[2/3] Uploading to S3…")
    try:
        step_upload(upload_url, upload_fields, image_bytes, args.timeout)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    # Step 3: Poll
    print("\n[3/3] Polling for result…")
    try:
        result = step_poll(base_url, job_id, args.timeout)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    elapsed = time.perf_counter() - start
    print(f"\nLatency: {elapsed * 1000:.0f} ms (total)")
    print(f"Result:  {json.dumps(result, indent=2)}")

    issues = validate(result)
    if issues:
        print("\n✗ FAILED:")
        for i in issues:
            print(f"  - {i}")
        return 1

    print(f"\n✓ PASSED — bin = {result['bin']!r}, item = {result.get('item', '')!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())