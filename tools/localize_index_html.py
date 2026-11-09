#!/usr/bin/env python3
"""Apply conservative Japanese text replacements in the large index.html.

Runs without external packages. Exact HTML fragments, including asset paths, are
matched so images, JavaScript, CSS, and underlying manufacturer IDs remain intact.

Usage:
    python tools/localize_index_html.py --apply
    python tools/localize_index_html.py --check
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"

# Only display text is changed. Keep data-logo filenames and selectors untouched.
REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ('<option value="merged" selected>連結（cnsuv → 汽车之家）</option>',
     '<option value="merged" selected>連結（cnsuv → Autohome）</option>'),
    ('<option value="autohome">汽车之家のみ（2026年3月〜）</option>',
     '<option value="autohome">Autohomeのみ（2026年3月〜）</option>'),
    ('<div class="huawei-title">华为 五界三境</div>',
     '<div class="huawei-title">ファーウェイ「五界三境」</div>'),
    ('<div class="huawei-brand-name">问界<br>',
     '<div class="huawei-brand-name">問界<br>'),
    ('<li><div class="brand-item"><span class="brand-logo-mini" data-logo="岚图汽车.png"></span>岚图（Voyah）</div></li>',
     '<li><div class="brand-item"><span class="brand-logo-mini" data-logo="岚图汽车.png"></span>VOYAH（嵐図）</div></li>'),
    ('<li><div class="brand-item"><span class="brand-logo-mini" data-logo="智己汽车.png"></span>智己（IM）</div></li>',
     '<li><div class="brand-item"><span class="brand-logo-mini" data-logo="智己汽车.png"></span>IM Motors（智己）</div></li>'),
    ('<li><div class="brand-item"><span class="brand-logo-mini" data-logo="广汽传祺.png"></span>传祺（Trumpchi）</div></li>',
     '<li><div class="brand-item"><span class="brand-logo-mini" data-logo="广汽传祺.png"></span>GAC Trumpchi（伝祺）</div></li>'),
    ('<li><div class="brand-item"><span class="brand-logo-mini" data-logo="广汽昊铂.png"></span>昊铂（Hyper）</div></li>',
     '<li><div class="brand-item"><span class="brand-logo-mini" data-logo="广汽昊铂.png"></span>昊鉑（HYPTEC）</div></li>'),
    ('<li><div class="brand-item"><span class="brand-logo-mini" data-logo="深蓝汽车.png"></span>深蓝（Deepal）</div></li>',
     '<li><div class="brand-item"><span class="brand-logo-mini" data-logo="深蓝汽车.png"></span>Deepal（深藍）</div></li>'),
    ('<li><div class="brand-item"><span class="brand-logo-mini" data-logo="阿维塔.png"></span>阿维塔（Avatr）</div></li>',
     '<li><div class="brand-item"><span class="brand-logo-mini" data-logo="阿维塔.png"></span>AVATR（アバター）</div></li>'),
    ('<li><div class="brand-item"><span class="brand-logo-mini" data-logo="北京汽车.png"></span>北京汽车</div></li>',
     '<li><div class="brand-item"><span class="brand-logo-mini" data-logo="北京汽车.png"></span>北京汽車</div></li>'),
    ('<li><div class="brand-item"><span class="brand-logo-mini" data-logo="AITO 问界.png"></span>AITO 问界</div></li>',
     '<li><div class="brand-item"><span class="brand-logo-mini" data-logo="AITO 问界.png"></span>AITO（問界）</div></li>'),
)


def important_markup(text: str) -> tuple[list[str], list[str], list[str]]:
    scripts = re.findall(r"<script\b[^>]*>[\s\S]*?</script\s*>", text, re.I)
    styles = re.findall(r"<style\b[^>]*>[\s\S]*?</style\s*>", text, re.I)
    asset_attrs = re.findall(r'\b(?:src|href|data-logo)\s*=\s*["\'][^"\']*["\']', text)
    return scripts, styles, asset_attrs


def run(check: bool) -> None:
    original = INDEX.read_text(encoding="utf-8")
    updated = original
    for old, new in REPLACEMENTS:
        if check:
            if old in original or new not in original:
                raise ValueError("Japanese display text missing/obsolete: " + old[:100])
            continue
        if old not in updated:
            if new not in updated:
                raise ValueError("Expected HTML fragment not found: " + old[:100])
            continue  # Already applied.
        n = updated.count(old)
        updated = updated.replace(old, new)
        print("Localized", n, "instance(s):", old[:92])
    if check:
        print("All", len(REPLACEMENTS), "targeted display strings are localized")
        return
    if important_markup(original) != important_markup(updated):
        raise ValueError("Aborted: script/style or asset-link attributes would change")
    if updated != original:
        INDEX.write_text(updated, encoding="utf-8")
        print("Updated index.html; source scripts, styles, and asset references unchanged")
    else:
        print("index.html is already localized")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--apply", action="store_true")
    group.add_argument("--check", action="store_true")
    args = parser.parse_args()
    run(args.check)
