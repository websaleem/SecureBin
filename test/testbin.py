#!/usr/bin/env python3
"""
SecureBin — CloudFront API pipeline test caller.

Mirrors the behavior of categorizeImage() in the app:
  1. Resize + base64-encode a local image
  2. POST { image, mediaType } to the CloudFront endpoint
  3. Validate the response shape and bin value

Usage:
  python test_categorize.py <image_path> [--url https://xxxx.cloudfront.net/categorize]

Env vars (fallbacks):
  SECUREBIN_API_URL   CloudFront endpoint URL
"""

import argparse
import base64
import io
import json
import os
import sys
import time
from pathlib import Path

import requests
from PIL import Image

# Match whatever your app's resizeAndEncode() targets.
# Adjust if your RN helper uses different values.
MAX_DIMENSION = 1024
JPEG_QUALITY = 85
VALID_BINS = {"red", "green", "yellow", "white"}


def resize_and_encode(image_path: Path) -> tuple[str, str]:
    """Resize image to fit MAX_DIMENSION and return (base64_str, media_type)."""
    with Image.open(image_path) as img:
        # Normalize orientation from EXIF, convert to RGB for JPEG
        img = img.convert("RGB")
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        raw = buf.getvalue()

    b64 = base64.b64encode(raw).decode("ascii")
    return b64, "image/jpeg"


def call_api(url: str, image_b64: str, media_type: str, timeout: int = 30) -> tuple[dict, float]:
    """POST the payload and return (parsed_json, elapsed_seconds)."""
    payload = {"image": image_b64, "mediaType": media_type}
    headers = {"Content-Type": "application/json"}

    start = time.perf_counter()
    resp = requests.post(url, headers=headers, data=json.dumps(payload), timeout=timeout)
    elapsed = time.perf_counter() - start

    if not resp.ok:
        # Show body for debugging — Lambda/API Gateway often put useful info here
        raise RuntimeError(
            f"Categorization API error: {resp.status_code}\n"
            f"Body: {resp.text[:500]}"
        )

    return resp.json(), elapsed


def validate(parsed: dict) -> list[str]:
    """Return a list of validation issues (empty list = all good)."""
    issues = []
    bin_value = parsed.get("bin")
    if bin_value not in VALID_BINS:
        issues.append(f"Unexpected bin value: {bin_value!r} (expected one of {sorted(VALID_BINS)})")
    return issues


def main() -> int:
    ap = argparse.ArgumentParser(description="Test SecureBin categorization API via CloudFront.")
    ap.add_argument("image", type=Path, help="Path to a local image file")
    ap.add_argument(
        "--url",
        default=os.environ.get("SECUREBIN_API_URL"),
        help="CloudFront API URL (or set SECUREBIN_API_URL env var)",
    )
    ap.add_argument("--timeout", type=int, default=30, help="Request timeout in seconds")
    args = ap.parse_args()

    if not args.url:
        print("ERROR: Provide --url or set SECUREBIN_API_URL", file=sys.stderr)
        return 2
    if not args.image.is_file():
        print(f"ERROR: Not a file: {args.image}", file=sys.stderr)
        return 2

    print(f"→ Image:    {args.image}")
    print(f"→ Endpoint: {args.url}")

    try:
        b64, media_type = resize_and_encode(args.image)
    except Exception as e:
        print(f"ERROR encoding image: {e}", file=sys.stderr)
        return 1

    print(f"→ Encoded:  {len(b64):,} chars base64 ({media_type})")

    try:
        parsed, elapsed = call_api(args.url, b64, media_type, timeout=args.timeout)
    except requests.Timeout:
        print(f"ERROR: Request timed out after {args.timeout}s", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"ERROR calling API: {e}", file=sys.stderr)
        return 1

    print(f"→ Latency:  {elapsed * 1000:.0f} ms")
    print(f"→ Response: {json.dumps(parsed, indent=2)}")

    issues = validate(parsed)
    if issues:
        print("\n✗ FAILED:")
        for i in issues:
            print(f"  - {i}")
        return 1

    print(f"\n✓ PASSED — bin = {parsed['bin']!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())