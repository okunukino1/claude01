#!/usr/bin/env python3
"""
【初回だけ実行】Indeed ログインセットアップ

システムのChromeブラウザを使ってログインします。
Googleログインも正常に動作します。
"""
import asyncio
import subprocess
import sys
from pathlib import Path
from playwright.async_api import async_playwright

PROFILE_DIR = str(Path(__file__).parent / "browser_profile")

async def main():
    print("=" * 50)
    print(" Indeed Login Setup")
    print("=" * 50)
    print()
    print("Opening Chrome browser...")
    print("Please log in to Indeed.")
    print("After you see the analytics page,")
    print("come back here and press Enter.")
    print()

    async with async_playwright() as p:
        # まずChromeで試す、なければEdge、最後にChromium
        browser_launched = False

        for channel in ["chrome", "msedge"]:
            try:
                ctx = await p.chromium.launch_persistent_context(
                    user_data_dir=PROFILE_DIR,
                    channel=channel,
                    headless=False,
                    args=["--no-sandbox"],
                    viewport={"width": 1280, "height": 900},
                )
                print(f"Using: {channel}")
                browser_launched = True
                break
            except Exception as e:
                print(f"{channel} not found, trying next...")
                continue

        if not browser_launched:
            # ChromiumにフォールバックするがGoogleログインは手動で対処
            print("Using built-in Chromium browser.")
            ctx = await p.chromium.launch_persistent_context(
                user_data_dir=PROFILE_DIR,
                headless=False,
                args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
                viewport={"width": 1280, "height": 900},
            )

        page = await ctx.new_page()
        await page.goto("https://employers.indeed.com/", wait_until="domcontentloaded")

        input(">>> Logged in to Indeed? Press Enter to save session: ")

        await ctx.close()

    print()
    print("Session saved!")
    print("From now on, the script will run automatically.")
    print()
    input("Press Enter to close...")

if __name__ == "__main__":
    asyncio.run(main())
