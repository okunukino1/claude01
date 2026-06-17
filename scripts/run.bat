@echo off
cd /d "%~dp0"

if not exist "browser_profile" (
    echo [ERROR] Login session not found.
    echo Please run login_setup.bat first.
    pause
    exit /b 1
)

python indeed_scraper.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [FAILED] An error occurred.
    echo If session expired, run login_setup.bat again.
    pause
) else (
    echo.
    echo [SUCCESS] Data written to spreadsheet.
)
