#!/usr/bin/env python3
"""Extract the 303KB generated SERIES_HISTORY classic script from index.html.

Preserves the exact source bytes and original synchronous execution order.
Usage:
  python tools/extract_series_history.py --apply
  python tools/extract_series_history.py --check
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
TARGET = ROOT / "js" / "series-history.js"
TAG = '<script src="js/series-history.js"></script>'
SCRIPTS = re.compile(r"<script\b[^>]*>[\s\S]*?</script\s*>", re.I)
MARKER = "SERIES_HISTORY (自動生成 - generate_series_history.py)"
EXPECTED_ORDINAL = 19
EXPECTED_BYTES = 302805


def read_raw(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def write_raw(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(content)


def check() -> None:
    html = read_raw(INDEX)
    if html.count(TAG) != 1 or not TARGET.exists():
        raise RuntimeError("Missing external SERIES_HISTORY script or incorrect tag count")
    code = read_raw(TARGET)
    if len(code.encode("utf-8")) != EXPECTED_BYTES:
        raise RuntimeError("The extracted script size differs from the verified source")
    if MARKER not in code or "document.currentScript" in code:
        raise RuntimeError("The extracted script is not the intended SERIES_HISTORY block")
    print("Series-history source verified:", len(code.encode("utf-8")), "bytes")


def apply() -> None:
    html = read_raw(INDEX)
    if TAG in html:
        check()
        print("Series-history is already extracted")
        return
    blocks = list(SCRIPTS.finditer(html))
    if len(blocks) < EXPECTED_ORDINAL:
        raise RuntimeError("Script positions changed; manual inspection required")
    block = blocks[EXPECTED_ORDINAL - 1]
    full = block.group(0)
    opening = re.match(r"<script\b[^>]*>", full, re.I)
    closing = re.search(r"</script\s*>$", full, re.I)
    if not opening or not closing or opening.group(0) != "<script>":
        raise RuntimeError("Unexpected inline script attributes; refusing extraction")
    code = full[opening.end():closing.start()]
    if len(code.encode("utf-8")) != EXPECTED_BYTES:
        raise RuntimeError("Source size has changed; manual inspection required")
    if MARKER not in code or "document.currentScript" in code:
        raise RuntimeError("Expected generated SERIES_HISTORY script not found")
    if TARGET.exists():
        raise RuntimeError("Target JS already exists; refusing to overwrite")
    updated = html[:block.start()] + TAG + html[block.end():]
    # Ensure that the only HTML change is the one script element.
    if updated.replace(TAG, full, 1) != html:
        raise RuntimeError("HTML reconstruction check failed")
    write_raw(TARGET, code)
    write_raw(INDEX, updated)
    check()
    print("Synchronous JS extracted with original script order preserved")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    check() if args.check else apply()
