@echo off
echo =========================================
echo  Indeed Scraper Setup
echo =========================================
echo.
echo Installing Python libraries...
pip install playwright gspread google-auth python-dotenv
echo.
echo Installing Chromium browser...
playwright install chromium
echo.
echo =========================================
echo  Setup complete!
echo =========================================
echo.
echo Next steps:
echo 1. Put service_account.json in this folder
echo 2. Edit config.env with your email and password
echo 3. Run login_setup.bat to save your session
echo 4. Run run.bat to test
echo.
pause
