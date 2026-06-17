@echo off
chcp 65001 > nul
cd /d "%~dp0"

REM browser_profile フォルダがなければ初回ログインを促す
if not exist "browser_profile" (
    echo.
    echo [エラー] まだログイン設定が完了していません。
    echo login_setup.bat を先に実行してください。
    echo.
    pause
    exit /b 1
)

python indeed_scraper.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [失敗] エラーが発生しました。
    echo セッション切れの場合は login_setup.bat を実行してください。
    echo.
    pause
) else (
    echo.
    echo [成功] スプレッドシートへの記入が完了しました。
)
