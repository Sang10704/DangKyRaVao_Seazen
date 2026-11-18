@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [DEV MODE] Khoi dong SeaZen VMS Dev Server tai http://127.0.0.1:6869 (Khong dung cong 6868 Prod)...
python launcher.py --dev
pause
