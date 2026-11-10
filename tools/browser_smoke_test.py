#!/usr/bin/env python3
"""Headless Chrome smoke checks for the published static dashboard.

Run after starting an HTTP server at http://127.0.0.1:8768/ .
Requires selenium and Google Chrome/Chromium/ChromeDriver on the runner.
"""
from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

BASE = os.environ.get("SITE_URL", "http://127.0.0.1:8768/")
ROOT = Path(__file__).resolve().parents[1]
SCREENSHOTS = ROOT / "smoke_screenshots"
EXTRACTED_ASSETS = ("js/dashboard-core.js", "js/info-registry.js", "js/series-history.js")


def main() -> int:
    options = Options()
    options.page_load_strategy = "eager"
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1365,880")
    options.add_argument("--no-first-run")
    options.add_argument("--disable-background-networking")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    chrome = shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
    if chrome:
        options.binary_location = chrome
    SCREENSHOTS.mkdir(exist_ok=True)

    with webdriver.Chrome(options=options) as driver:
        driver.set_page_load_timeout(35)
        driver.get(BASE)
        wait = WebDriverWait(driver, 30)
        wait.until(lambda d: d.execute_script("return document.readyState") != "loading")
        wait.until(lambda d: d.execute_script("return !!window.INFO_REGISTRY"))

        state = driver.execute_script("""
            const assets = Array.from(document.querySelectorAll('script[src]'))
                .map(s => new URL(s.src).pathname);
            return {
                title: document.title,
                readyState: document.readyState,
                infoRegistryKeys: Object.keys(window.INFO_REGISTRY || {}).length,
                assetPaths: assets,
                pageTextLength: document.body.innerText.length,
                hasDashboardCore: typeof RAW_BASE !== 'undefined',
                hasHistorySource: Array.from(document.querySelectorAll('script[src]'))
                    .some(s => s.src.includes('js/series-history.js')),
                desktopScrollWidth: document.documentElement.scrollWidth,
                desktopViewportWidth: window.innerWidth
            };
        """)
        print("Desktop state:", state, flush=True)
        assert state["title"], "Missing document title"
        assert state["infoRegistryKeys"] > 0, "Info registry is empty"
        assert state["pageTextLength"] > 100, "Main page appears empty"
        assert state["hasDashboardCore"], "Dashboard JS did not execute"
        assert state["hasHistorySource"], "Series history asset not linked"
        for asset in EXTRACTED_ASSETS:
            assert any(p.endswith("/" + asset) for p in state["assetPaths"]), f"Missing script tag {asset}"

        driver.save_screenshot(str(SCREENSHOTS / "desktop.png"))
        driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", {
            "width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True
        })
        time.sleep(1)
        mobile = driver.execute_script("""
            return {
                viewport: window.innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
                bodyScrollWidth: document.body.scrollWidth,
                viewportMeta: document.querySelector('meta[name="viewport"]')?.content || ''
            };
        """)
        print("Mobile state:", mobile, flush=True)
        driver.save_screenshot(str(SCREENSHOTS / "mobile.png"))
        if mobile["scrollWidth"] > mobile["viewport"] + 8:
            print("WARN: Horizontal overflow on mobile:", mobile["scrollWidth"] - mobile["viewport"], "px")

        logs = driver.get_log("browser")
        severe = [log for log in logs if log.get("level") == "SEVERE"]
        print("Browser severe console messages:", len(severe))
        for entry in severe[:15]:
            print("  console:", entry["message"][:300])
        blocking = [
            entry for entry in severe
            if ("Uncaught SyntaxError" in entry.get("message", "")
                or "Uncaught ReferenceError" in entry.get("message", ""))
            and ("dashboard-core.js" in entry.get("message", "")
                 or "info-registry.js" in entry.get("message", "")
                 or "series-history.js" in entry.get("message", ""))
        ]
        assert not blocking, f"Exceptions from extracted scripts: {blocking}"
        print("Browser smoke checks passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, TimeoutException) as error:
        print("BROWSER SMOKE FAILED:", error, file=sys.stderr)
        raise SystemExit(1)
