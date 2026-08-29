#!/usr/bin/env python3
"""Generate backend/lambda/shared/councils.py from constants/councils.ts.

The Lambdas validate the user-supplied state/council pair against this exact
allowlist before it is interpolated into the Bedrock prompt, so the two lists
must stay in sync. Run this after editing constants/councils.ts.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "constants" / "councils.ts"
OUT = ROOT / "backend" / "lambda" / "shared" / "councils.py"

# Match a single- or double-quoted JS string, honouring backslash escapes.
STRING = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"")


def unescape(value):
    return re.sub(r"\\(.)", r"\1", value)


def main():
    src = SRC.read_text()

    # Isolate the COUNCILS object only; other exports in this file also use
    # state keys and must not bleed into the allowlist.
    start = src.index("export const COUNCILS")
    brace = src.index("{", start)
    depth, i = 0, brace
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = src[brace : i + 1]

    councils = {}
    for m in re.finditer(r"(\w+)\s*:\s*\[(.*?)\]", body, re.DOTALL):
        names = {unescape(a or b).strip() for a, b in STRING.findall(m.group(2))}
        councils[m.group(1)] = sorted(n for n in names if n)

    if not councils:
        sys.exit("no councils parsed — check constants/councils.ts")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w") as f:
        f.write('"""Generated from constants/councils.ts — do not edit by hand.\n\n')
        f.write("Regenerate with: python3 scripts/gen_councils.py\n\"\"\"\n\n")
        f.write("COUNCILS = " + json.dumps(councils, indent=4, ensure_ascii=False) + "\n")

    total = sum(len(v) for v in councils.values())
    print(f"wrote {OUT.relative_to(ROOT)}: {len(councils)} states, {total} councils")
    for state in sorted(councils):
        print(f"  {state:4s} {len(councils[state]):4d}")


if __name__ == "__main__":
    main()
