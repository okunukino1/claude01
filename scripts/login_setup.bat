@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ブラウザを起動してログインします...
python login_setup.py
