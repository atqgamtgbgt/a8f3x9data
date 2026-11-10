#!/usr/bin/env python3
"""Extract the 927KB dashboard classic JS from index.html without source edits.

Keeps the script synchronous, at precisely the same position. Read and write
with newline="" to preserve the original line endings and script byte content.

Usage: python tools/extract_dashboard_core.py --apply|--check
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
TARGET = ROOT / "js" / "dashboard-core.js"
TAG = '<script src="js/dashboard-core.js"></script>'
SCRIPT_PATTERN = re.compile(r"<script\b[^>]*>[\s\S]*?</script\s*>", re.I)
EXPECTED_ORDINAL = 7
EXPECTED_BYTES = 926965
SOURCE_MARKER = 'const RAW_BASE = "https://raw.githubusercontent.com/atqgamtgbgt/a8f3x9data/main/"'


def read_raw(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def write_raw(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(data)


def validate() -> None:
    html = read_raw(INDEX)
    if html.count(TAG) != 1 or not TARGET.is_file():
        raise RuntimeError("Main dashboard external-script reference missing or duplicated")
    code = read_raw(TARGET)
    if len(code.encode("utf-8")) != EXPECTED_BYTES:
        raise RuntimeError("Main dashboard JS byte size has unexpectedly changed")
    if SOURCE_MARKER not in code or "document.currentScript" in code:
        raise RuntimeError("Unexpected main dashboard JS content")
    print("Dashboard core verified:", EXPECTED_BYTES, "bytes")


def apply() -> None:
    original = read_raw(INDEX)
    if TAG in original:
        validate()
        return
    scripts = list(SCRIPT_PATTERN.finditer(original))
    if len(scripts) < EXPECTED_ORDINAL:
        raise RuntimeError("Expected main dashboard JS script position not found")
    match = scripts[EXPECTED_ORDINAL - 1]
    full = match.group(0)
    open_tag = re.match(r"<script\b[^>]*>", full, re.I)
    close_tag = re.search(r"</script\s*>$", full, re.I)
    if not open_tag or not close_tag or open_tag.group(0) != "<script>":
        raise RuntimeError("Unexpected script opening; extraction aborted")
    code = full[open_tag.end():close_tag.start()]
    if len(code.encode("utf-8")) != EXPECTED_BYTES or SOURCE_MARKER not in code:
        raise RuntimeError("Target main dashboard script differs from audited baseline")
    if "document.currentScript" in code:
        raise RuntimeError("Main dashboard code uses currentScript; extraction needs review")
    if TARGET.exists():
        raise RuntimeError("Target file already exists; manual review required")
    modified = original[:match.start()] + TAG + original[match.end():]
    if modified.replace(TAG, full, 1) != original:
        raise RuntimeError("Replacing script must be perfectly reversible")
    write_raw(TARGET, code)
    write_raw(INDEX, modified)
    validate()
    print("Moved exact classic script bytes into a synchronous external JS asset")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    validate() if args.check else apply()
