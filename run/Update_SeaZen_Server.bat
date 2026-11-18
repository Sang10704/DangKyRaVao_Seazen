@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================================================
echo   SEAZEN VMS - CAP NHAT MA NGUON TU GITHUB & KHOI DONG LAI SERVER
echo ============================================================================

git --version >nul 2>&1
if errorlevel 1 (
    echo [LOI] May Server chua cai Git. Vui long cai Git for Windows.
    pause
    exit /b 1
)

echo [1/3] Dang tai code moi nhat tu origin/main...
git pull origin main
if errorlevel 1 (
    echo.
    echo [CANH BAO] git pull khong thanh cong (co the co thay doi cuc bo bi xung dot).
    echo Vui long kiem tra lai trang thai git truoc khi cap nhat.
    pause
    exit /b 1
)

echo [2/3] Dang kiem tra thu vien Python (requirements.txt)...
python -m pip install -r requirements.txt --quiet

echo [3/3] Dang khoi dong lai SeaZen VMS Server (chay ngam khong console)...
start "" pythonw.exe "%CD%\launcher.py" --restart

echo.
echo [HOAN TAT] Da cap nhat code moi va khoi dong lai Server tai cong 6868!
timeout /t 4 >nul
