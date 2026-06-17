#!/usr/bin/env python3
"""
【初回だけ実行】Indeed ログインセットアップ

ブラウザが開くので Indeed にログインしてください。
ログイン完了後 Enter を押すとセッションが保存されます。
次回以降は自動でログイン状態が維持されます。
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

PROFILE_DIR = str(Path(__file__).parent / "browser_profile")

async def main():
    print("=" * 50)
    print(" Indeed ログインセットアップ")
    print("=" * 50)
    print()
    print("ブラウザが開きます。")
    print("Indeed にログインしてアナリティクスページが")
    print("表示されたら、この画面に戻って Enter を押してください。")
    print()

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            args=["--no-sandbox"],
            viewport={"width": 1280, "height": 900},
        )
        page = await ctx.new_page()
        await page.goto("https://employers.indeed.com/", wait_until="domcontentloaded")

        input(">>> Indeed にログインしたら Enter を押してください: ")

        await ctx.close()

    print()
    print("セッションを保存しました！")
    print("これ以降は自動でログイン状態が引き継がれます。")
    print()
    input("Enterで閉じる")

if __name__ == "__main__":
    asyncio.run(main())
