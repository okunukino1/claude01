@echo off
chcp 65001 > nul
echo =========================================
echo  Indeed スクレイパー セットアップ
echo =========================================
echo.
echo Pythonライブラリをインストールしています...
pip install playwright gspread google-auth python-dotenv
echo.
echo Chromiumブラウザをインストールしています...
playwright install chromium
echo.
echo =========================================
echo  セットアップ完了！
echo =========================================
echo.
echo 次にやること：
echo 1. このフォルダに service_account.json を置く
echo 2. config.env をメモ帳で開いてメール・パスワードを入力する
echo 3. run.bat をダブルクリックしてテスト実行する
echo.
pause
