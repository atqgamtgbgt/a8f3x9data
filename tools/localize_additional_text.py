#!/usr/bin/env python3
"""Localize additional Chinese visible text nodes without touching JS, CSS or attributes.

Usage: python tools/localize_additional_text.py --apply|--check

Original source data and names in image filenames remain unchanged.
"""
from __future__ import annotations

import argparse
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
PROTECTED = re.compile(
    r"<script\b[^>]*>[\s\S]*?</script\s*>|<style\b[^>]*>[\s\S]*?</style\s*>", re.I
)
TEXT_NODE = re.compile(r"(?<=>)[^<>]+(?=<)")

# Chinese source quotations may be kept in underlying data; these are UI copies.
TRANSLATIONS: tuple[tuple[str, str, int], ...] = (
    ("蓝电", "藍電", 1),
    ("钇为", "釔為", 1),
    ("华为乾崑", "ファーウェイ乾崑", 1),
    ("「旺销备货」", "「繁忙期に向けた在庫確保」", 1),
    ("「燃油車内销崩塌・新能源强势主导・出口强势增长」",
     "「ICE車の国内販売急減・新エネルギー車の台頭・輸出の好調」", 1),
    ("厂家・渠道", "メーカー・流通経路別", 1),
    ("锂电池全口径需求分析", "リチウムイオン電池の全需要分析", 2),
    ("儲能等26%", "定置用蓄電など26%", 1),
)


def visible_text_segments(source: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    start = 0
    for match in PROTECTED.finditer(source):
        spans.extend((start + m.start(), start + m.end())
                     for m in TEXT_NODE.finditer(source[start:match.start()]))
        start = match.end()
    spans.extend((start + m.start(), start + m.end())
                 for m in TEXT_NODE.finditer(source[start:]))
    return spans


def localize(source: str, check: bool) -> str:
    nodes = visible_text_segments(source)
    counts: Counter[str] = Counter()
    for a, b in nodes:
        part = source[a:b]
        for original, translated, target_count in TRANSLATIONS:
            count = part.count(original)
            if check:
                if count:
                    raise ValueError(f"Chinese text reappeared: {original!r}")
                continue
            if count:
                counts[original] += count

    if check:
        texts = [source[a:b] for a, b in nodes]
        for old, new, count in TRANSLATIONS:
            found = sum(text.count(new) for text in texts)
            if found != count:
                raise ValueError(f"Expected {count} Japanese labels for {old!r}, found {found}")
        return source

    for old, new, target_count in TRANSLATIONS:
        if counts[old] != target_count:
            raise ValueError(f"Expected {target_count} Chinese labels for {old!r}, found {counts[old]}")

    result: list[str] = []
    previous = 0
    for a, b in nodes:
        result.append(source[previous:a])
        text = source[a:b]
        for old, new, count in TRANSLATIONS:
            text = text.replace(old, new)
        result.append(text)
        previous = b
    result.append(source[previous:])
    output = "".join(result)
    if [m.group(0) for m in PROTECTED.finditer(source)] != [m.group(0) for m in PROTECTED.finditer(output)]:
        raise ValueError("Script/style content changed unexpectedly")
    # We modify only between > and <, so the literal markup and attributes remain unchanged.
    localize(output, check=True)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    with INDEX.open("r", encoding="utf-8", newline="") as file:
        source = file.read()
    updated = localize(source, check=args.check)
    if not args.check:
        with INDEX.open("w", encoding="utf-8", newline="") as file:
            file.write(updated)
    print(f"{len(TRANSLATIONS)} Japanese UI phrase groups verified")


if __name__ == "__main__":
    main()
