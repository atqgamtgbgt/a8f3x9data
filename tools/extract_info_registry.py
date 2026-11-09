#!/usr/bin/env python3
"""Extract the large INFO_REGISTRY classic script without changing execution order.

A synchronous <script src> occupies the exact position of the original inline
script. No async/defer/module attribute is added. Original script bytes are
copied directly into js/info-registry.js, preserving CRLF and quoted data.

    python tools/extract_info_registry.py --apply
    python tools/extract_info_registry.py --check
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
TARGET = ROOT / "js" / "info-registry.js"
TAG = '<script src="js/info-registry.js"></script>'
SCRIPT_PATTERN = re.compile(r"<script\b[^>]*>[\s\S]*?</script\s*>", re.I)
EXPECTED_ORDINAL = 18
EXPECTED_BYTES = 511214


def read_raw(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def write_raw(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(content)


def verify_extracted(html: str) -> None:
    if html.count(TAG) != 1 or not TARGET.exists():
        raise ValueError("External info registry is missing or referenced more than once")
    script = read_raw(TARGET)
    if len(script.encode("utf-8")) != EXPECTED_BYTES:
        raise ValueError("Unexpected size for extracted INFO_REGISTRY: " + str(len(script.encode("utf-8"))))
    if "window.INFO_REGISTRY" not in script or "document.currentScript" in script:
        raise ValueError("Unexpected source in extracted INFO_REGISTRY")
    print("INFO_REGISTRY external file validated:", EXPECTED_BYTES, "bytes")


def apply() -> None:
    html = read_raw(INDEX)
    if TAG in html:
        verify_extracted(html)
        print("Already extracted")
        return
    scripts = list(SCRIPT_PATTERN.finditer(html))
    if len(scripts) < EXPECTED_ORDINAL:
        raise ValueError("Not enough classic script blocks to safely locate INFO_REGISTRY")
    found = scripts[EXPECTED_ORDINAL - 1]
    tag = found.group(0)
    opening = re.match(r"<script\b[^>]*>", tag, re.I)
    assert opening is not None
    code = tag[opening.end():]
    code = re.sub(r"</script\s*>$", "", code, flags=re.I)
    if "src=" in opening.group(0).lower() or "defer" in opening.group(0).lower() or "async" in opening.group(0).lower():
        raise ValueError("Candidate script is not a synchronous inline script")
    if len(code.encode("utf-8")) != EXPECTED_BYTES:
        raise ValueError("The INFO_REGISTRY block size changed; extraction needs review")
    if "window.INFO_REGISTRY" not in code or "document.currentScript" in code:
        raise ValueError("The target is not the expected independent INFO_REGISTRY block")
    if TARGET.exists():
        raise ValueError("Target JS already exists while HTML still contains inline registry")
    new_html = html[:found.start()] + TAG + html[found.end():]
    write_raw(TARGET, code)
    write_raw(INDEX, new_html)
    verify_extracted(new_html)
    print("Extracted INFO_REGISTRY without changing the ordering of script tags")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--apply", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        verify_extracted(read_raw(INDEX))
    else:
        apply()
