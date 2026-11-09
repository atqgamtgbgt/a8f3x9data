#!/usr/bin/env python3
"""Read-only audit of Japanese vehicle CSVs and monthly manufacturer rankings.

Run from repository root: python tools/audit_data_quality.py
No third-party dependencies; this script does not modify any data.
"""
from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTOHOME = ROOT / "output" / "autohome"
MONTHLY = ROOT / "output" / "market" / "autohome_factory_monthly.json"


def audit_vehicle_csvs() -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    files = sorted(AUTOHOME.glob("*/config_*.ja.csv"))
    identical_aliases = 0
    for path in files:
        alias = path.with_name(path.name.replace(".ja.csv", "_ja.csv"))
        if alias.exists():
            if path.read_bytes() == alias.read_bytes():
                identical_aliases += 1
            else:
                warnings.append(f"Different Japanese aliases: {path.relative_to(ROOT)}")
        try:
            with path.open(encoding="utf-8-sig", newline="") as handle:
                rows = csv.reader(handle)
                header = next(rows)
                if len(header) < 5 or header[:4] != ["セクション", "セクション_ja", "項目", "項目_ja"]:
                    errors.append(f"Unexpected CSV header: {path.relative_to(ROOT)}")
                    continue
                for number, row in enumerate(rows, start=2):
                    if len(row) != len(header):
                        errors.append(f"Column count mismatch: {path.relative_to(ROOT)}:{number}")
                    if len(row) >= 4:
                        if row[0].strip() and not row[1].strip():
                            warnings.append(f"Missing Japanese section: {path.relative_to(ROOT)}:{number}")
                        if row[2].strip() and not row[3].strip():
                            warnings.append(f"Missing Japanese item: {path.relative_to(ROOT)}:{number}")
        except (OSError, UnicodeError, csv.Error) as exc:
            errors.append(f"Could not read {path.relative_to(ROOT)}: {exc}")
    print(f"Japanese vehicle CSVs: {len(files)}; byte-identical _ja.csv aliases: {identical_aliases}")
    return errors, warnings


def audit_monthly_rankings() -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if not MONTHLY.exists():
        return [f"Missing {MONTHLY.relative_to(ROOT)}"], warnings
    try:
        data = json.loads(MONTHLY.read_text(encoding="utf-8"))
        months = data["months"]
        counts: dict[str, int] = {}
        for month, entry in sorted(months.items()):
            ranking = entry.get("top", [])
            counts[month] = len(ranking)
            actual = sum(item["sales"] for item in ranking)
            expected = entry.get("total_sales")
            if actual != expected:
                errors.append(f"{month}: total_sales={expected}, sum(top.sales)={actual}")
            ranks = [item["rank"] for item in ranking]
            if len(ranks) != len(set(ranks)):
                warnings.append(f"{month}: duplicate ranks")
            names = [item["factory"] for item in ranking]
            duplicates = [name for name, count in Counter(names).items() if count > 1]
            if duplicates:
                warnings.append(f"{month}: duplicate manufacturer names: {', '.join(duplicates)}")
        print("Monthly manufacturer coverage: " + ", ".join(f"{month}={count}" for month, count in counts.items()))
        if len(set(counts.values())) > 1:
            warnings.append("Manufacturer coverage varies by month; do not compare monthly totals without a consistent cohort.")
    except (OSError, UnicodeError, ValueError, KeyError, TypeError) as exc:
        errors.append(f"Could not validate monthly ranking data: {exc}")
    return errors, warnings


def main() -> int:
    all_errors: list[str] = []
    all_warnings: list[str] = []
    for check in (audit_vehicle_csvs, audit_monthly_rankings):
        errors, warnings = check()
        all_errors.extend(errors)
        all_warnings.extend(warnings)
    print(f"\nErrors: {len(all_errors)}; warnings: {len(all_warnings)}")
    for message in all_errors:
        print(f"ERROR: {message}")
    for message in all_warnings[:30]:
        print(f"WARN: {message}")
    if len(all_warnings) > 30:
        print(f"... {len(all_warnings) - 30} additional warnings")
    return 1 if all_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
