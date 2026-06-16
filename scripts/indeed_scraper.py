#!/usr/bin/env python3
"""
Indeed Analytics → Google Sheets 日次自動転記スクリプト

【必要な環境変数】
  INDEED_EMAIL               : Indeedアカウントのメールアドレス
  INDEED_PASSWORD            : Indeedアカウントのパスワード
  SPREADSHEET_ID             : Google SheetsのスプレッドシートID
  GOOGLE_SERVICE_ACCOUNT_JSON: サービスアカウントキー（JSON文字列）
  SHEET_GID                  : シートのGID（デフォルト: 1404155345）
  TARGET_DATE                : 対象日（YYYY-MM-DD、省略時は前日）
"""
import asyncio
import json
import os
import re
from datetime import datetime, timedelta, timezone
from playwright.async_api import async_playwright
import gspread
from google.oauth2.service_account import Credentials

# ── 設定 ──────────────────────────────────────────────────────────────────────
JST = timezone(timedelta(hours=9))
INDEED_EMAIL    = os.environ["INDEED_EMAIL"]
INDEED_PASSWORD = os.environ["INDEED_PASSWORD"]
SPREADSHEET_ID  = os.environ["SPREADSHEET_ID"]
GOOGLE_SA_JSON  = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
SHEET_GID       = int(os.environ.get("SHEET_GID", "1404155345"))
TARGET_DATE     = os.environ.get("TARGET_DATE", "")

# Indeed アナリティクスURL（月次＋日別表示）
ANALYTICS_URL = (
    "https://employers.indeed.com/analytics/report-jobs-campaigns"
    "?viewState=%7B%22advertiserIds%22%3A%5B%5D%2C%22dateSelection%22%3A%7B"
    "%22base%22%3A%7B%22type%22%3A%22monthToDate%22%7D%7D%2C%22jcTrafficType%22%3A"
    "%22SPONSORED%22%2C%22jcChartGranularity%22%3A%22DAY%22%2C%22jcChartMetric1%22%3A"
    "%22sumCostLocal%22%2C%22jcChartMetric2%22%3A%22sumApplyStarts%22%2C%22jcOrderBy%22%3A"
    "%5B%7B%22field%22%3A%22ACTIVITY_DATE%22%2C%22direction%22%3A%22ASC%22%7D%5D%2C"
    "%22jcViewBy%22%3A%22time%22%2C%22jcDrillDown%22%3A%7B%22from%22%3A%22%22%2C"
    "%22to%22%3A%22daily%22%2C%22rule%22%3A%7B%22granularity%22%3A%22DAY%22%7D%7D%7D"
)

# スプレッドシートの列順（Indeedの表示順に合わせて調整が必要な場合あり）
# キーはコード内の識別子、valueはIndeedページ上の列ヘッダー（部分一致）
COLUMN_KEYWORDS = {
    "impressions": ["impression", "表示", "views"],
    "ctr":         ["ctr", "click-through", "クリック率"],
    "clicks":      ["click", "クリック数"],
    "applications":["apply", "応募数", "apply start"],
    "ar":          ["application rate", "ar", "応募率"],
    "cost":        ["cost", "費用", "spend"],
    "cpc":         ["cpc", "cost per click", "クリック単価"],
    "cpa":         ["cpa", "cost per apply", "応募単価"],
}

SHEET_COLUMNS = ["date", "impressions", "ctr", "clicks", "applications", "ar", "cost", "cpc", "cpa", "notes"]


def get_target_date():
    if TARGET_DATE:
        return datetime.strptime(TARGET_DATE, "%Y-%m-%d").date()
    return (datetime.now(JST) - timedelta(days=1)).date()


def parse_number(s: str) -> float:
    """数値文字列をfloatに変換。% は小数（0.069形式）に変換。"""
    s = s.strip()
    is_percent = s.endswith("%")
    s = re.sub(r"[^\d.]", "", s)
    if not s:
        return 0.0
    val = float(s)
    return val / 100.0 if is_percent else val


def detect_column_order(headers: list[str]) -> dict[str, int]:
    """ヘッダー行からスプレッドシート列の位置を特定する。"""
    order = {}
    for col_key, keywords in COLUMN_KEYWORDS.items():
        for i, h in enumerate(headers):
            h_lower = h.lower()
            if any(k in h_lower for k in keywords):
                order[col_key] = i
                break
    return order


async def scrape_indeed(target_date) -> tuple[list, list]:
    """Indeedにログインしてアナリティクスデータを取得する。"""
    captured_api = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
        )
        ctx = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )
        page = await ctx.new_page()

        # API レスポンスをキャプチャ
        async def on_response(resp):
            if resp.status == 200 and "json" in resp.headers.get("content-type", ""):
                url = resp.url
                if any(k in url.lower() for k in ["analytics", "metrics", "campaign", "report", "stats"]):
                    try:
                        body = await resp.json()
                        captured_api.append({"url": url, "body": body})
                    except Exception:
                        pass

        page.on("response", on_response)

        # ── ログイン ────────────────────────────────────────────────────────────
        print("Indeedにアクセス中...")
        await page.goto("https://employers.indeed.com/", wait_until="networkidle", timeout=30000)
        await page.screenshot(path="debug_01_top.png")
        print(f"トップページURL: {page.url}")

        # ログインページへ移動
        await page.goto("https://employers.indeed.com/p/login", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(2000)
        await page.screenshot(path="debug_02_login.png")
        print(f"ログインページURL: {page.url}")

        # ページのHTML（input要素）をデバッグ出力
        inputs = await page.evaluate("() => Array.from(document.querySelectorAll('input')).map(i => ({type: i.type, name: i.name, id: i.id, placeholder: i.placeholder}))")
        print(f"Input要素一覧: {inputs}")

        # メールアドレス入力（広いセレクターで対応）
        try:
            await page.wait_for_selector("input", timeout=15000)
            email_input = page.locator(
                'input[type="email"], input[name="email"], input[name="__email"], '
                'input[autocomplete="email"], input[autocomplete="username"]'
            ).first
            await email_input.fill(INDEED_EMAIL, timeout=15000)
            print("メールアドレス入力完了")
        except Exception as e:
            html = await page.content()
            with open("debug_login_page.html", "w", encoding="utf-8") as f:
                f.write(html)
            raise RuntimeError(f"メール入力フィールドが見つかりません: {e}")

        await page.wait_for_timeout(500)

        # パスワードが同一ページにある場合（シングルステップ）
        pw_visible = await page.locator('input[type="password"]').count()
        if pw_visible == 0:
            # マルチステップ：メール送信 → パスワードページ
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(2000)
            await page.screenshot(path="debug_03_after_email.png")

        await page.locator('input[type="password"]').first.fill(INDEED_PASSWORD, timeout=15000)
        await page.wait_for_timeout(500)
        await page.locator('button[type="submit"]').last.click()
        await page.wait_for_load_state("networkidle", timeout=30000)
        await page.screenshot(path="debug_04_after_login.png")

        if "login" in page.url.lower() or "signin" in page.url.lower():
            await page.screenshot(path="debug_login_failed.png")
            raise RuntimeError(f"ログイン失敗。URL: {page.url}")

        print(f"ログイン成功: {page.url}")

        # ── アナリティクスページを開く ────────────────────────────────────────
        print("アナリティクスページを読み込み中...")
        await page.goto(ANALYTICS_URL, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(5000)
        await page.screenshot(path="debug_analytics.png")

        date_str = target_date.strftime("%Y-%m-%d")

        # ── テーブルデータ抽出 ────────────────────────────────────────────────
        # ヘッダー行と対象日の行を取得
        result = await page.evaluate(
            """(dateStr) => {
                function getRows(root) {
                    const rows = [];
                    const trList = root.querySelectorAll('tr, [role="row"]');
                    for (const tr of trList) {
                        const cells = tr.querySelectorAll('td, th, [role="cell"], [role="columnheader"]');
                        if (cells.length > 0) {
                            rows.push(Array.from(cells).map(c => (c.innerText || c.textContent).trim()));
                        }
                    }
                    return rows;
                }

                const allRows = getRows(document);
                const headerRow = allRows.find(r =>
                    r.some(c => c.toLowerCase().includes('impression') ||
                                c.includes('表示') ||
                                c.toLowerCase().includes('click') ||
                                c.includes('クリック'))
                ) || [];
                const dataRow = allRows.find(r => r.some(c => c.includes(dateStr))) || [];
                return { headers: headerRow, data: dataRow, allRows };
            }""",
            date_str,
        )

        await browser.close()

    return result, captured_api


def build_sheet_row(result: dict, target_date) -> list:
    """抽出結果をスプレッドシート行に変換する。"""
    headers = result.get("headers", [])
    data    = result.get("data", [])
    date_str = target_date.strftime("%Y-%m-%d")

    if not data:
        return None

    col_order = detect_column_order(headers) if headers else {}
    print(f"検出された列マッピング: {col_order}")
    print(f"生データ: {data}")

    # 列マッピングが取れた場合はそれを使用、取れない場合は位置ベースで推測
    if len(col_order) >= 5:
        def get(key):
            idx = col_order.get(key)
            return parse_number(data[idx]) if idx is not None and idx < len(data) else 0.0
    else:
        # 位置ベース（日付セルを除いた残りを順番に割り当て）
        nums = [c for c in data if c != date_str and c != ""]
        keys = ["impressions", "ctr", "clicks", "applications", "ar", "cost", "cpc", "cpa"]
        col_order = {k: i for i, k in enumerate(keys) if i < len(nums)}
        def get(key):
            idx = col_order.get(key)
            return parse_number(nums[idx]) if idx is not None else 0.0

    return [
        date_str,
        get("impressions"),
        get("ctr"),
        get("clicks"),
        get("applications"),
        get("ar"),
        get("cost"),
        get("cpc"),
        get("cpa"),
        "",  # 備考（手動入力）
    ]


def write_to_sheets(row: list, target_date):
    """スプレッドシートに行を追記する（重複チェックあり）。"""
    date_str = target_date.strftime("%Y-%m-%d")

    creds = Credentials.from_service_account_info(
        json.loads(GOOGLE_SA_JSON),
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    gc = gspread.authorize(creds)
    ss = gc.open_by_key(SPREADSHEET_ID)

    ws = next((s for s in ss.worksheets() if s.id == SHEET_GID), None)
    if ws is None:
        raise RuntimeError(f"GID {SHEET_GID} のシートが見つかりません")

    # 重複チェック
    all_values = ws.get_all_values()
    for r in all_values:
        if r and r[0] == date_str:
            print(f"{date_str} のデータは既に存在します。スキップします。")
            return

    # 最後の日付行の直後に挿入（平均行の前）
    insert_idx = None
    for i, r in enumerate(all_values):
        if r and re.match(r"\d{4}-\d{2}-\d{2}", r[0]):
            insert_idx = i + 2  # 1-indexed + 1

    if insert_idx:
        ws.insert_row(row, insert_idx, value_input_option="USER_ENTERED")
        print(f"行 {insert_idx} に挿入: {row}")
    else:
        ws.append_row(row, value_input_option="USER_ENTERED")
        print(f"末尾に追記: {row}")


async def main():
    target_date = get_target_date()
    print(f"対象日: {target_date}")

    result, captured_api = await scrape_indeed(target_date)

    if not result.get("data"):
        # デバッグ用にAPIレスポンスを保存
        with open("debug_api_responses.json", "w", encoding="utf-8") as f:
            json.dump(captured_api, f, ensure_ascii=False, indent=2)
        all_rows = result.get("allRows", [])
        print(f"対象日 {target_date} のデータが見つかりませんでした。")
        print(f"テーブル行数: {len(all_rows)}")
        print(f"キャプチャしたAPI数: {len(captured_api)}")
        print("debug_analytics.png / debug_api_responses.json を確認してください。")
        raise RuntimeError("データ取得失敗")

    row = build_sheet_row(result, target_date)
    if row is None:
        raise RuntimeError("行の構築に失敗しました")

    print(f"書き込む行: {row}")
    write_to_sheets(row, target_date)
    print("完了！")


if __name__ == "__main__":
    asyncio.run(main())
