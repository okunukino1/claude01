@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo Indeed アナリティクス取得を開始します...
echo.
python indeed_scraper.py
echo.
if %ERRORLEVEL% NEQ 0 (
    echo [失敗] エラーが発生しました。
    echo debug_*.png ファイルを確認してください。
) else (
    echo [成功] スプレッドシートへの記入が完了しました。
)
echo.
pause
