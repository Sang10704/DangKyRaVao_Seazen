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

echo [1/4] Dang tam luu du lieu van hanh cuc bo (data/*.json)...
set "STASHED_RUNTIME=0"
for /f "delims=" %%s in ('git status --porcelain -- data/') do set "STASHED_RUNTIME=1"
if "%STASHED_RUNTIME%"=="1" (
    git stash push -m "seazen-auto-update-runtime-data" -- data/ >nul 2>&1
)

echo [2/4] Dang tai code moi nhat tu origin/main...
git pull origin main
if errorlevel 1 (
    if "%STASHED_RUNTIME%"=="1" git stash pop --quiet >nul 2>&1
    echo.
    echo [CANH BAO] git pull khong thanh cong (co the co thay doi cuc bo bi xung dot).
    echo Vui long kiem tra lai trang thai git truoc khi cap nhat.
    pause
    exit /b 1
)

if "%STASHED_RUNTIME%"=="1" (
    echo [Khoi phuc] Dang giu nguyen du lieu van hanh local (data/*.json)...
    git checkout stash@{0} -- data/ >nul 2>&1
    git stash drop >nul 2>&1
)

echo [3/4] Dang dung Server cu & kiem tra thu vien Python (requirements.txt)...
for /f "tokens=5" %%p in ('netstat -ano -p TCP ^| findstr ":6868 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)
timeout /t 1 >nul
python -m pip install -r requirements.txt --quiet

echo [4/4] Dang khoi dong lai SeaZen VMS Server (chay ngam khong console)...
start "" pythonw.exe "%CD%\launcher.py" --restart --no-browser

echo.
echo [HOAN TAT] Da cap nhat code moi va khoi dong lai Server tai cong 6868!
timeout /t 4 >nul
