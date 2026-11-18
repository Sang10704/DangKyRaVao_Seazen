@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ============================================================================
echo   SEAZEN VMS - CAI DAT MOI TRUONG MAY SERVER
echo ============================================================================

python --version >nul 2>&1
if errorlevel 1 (
    echo [LOI] May nay chua cai Python 3.11+. Vui long cai Python va tick "Add to PATH".
    pause
    exit /b 1
)

echo [1/2] Dang cai dat thu vien Python tu requirements.txt...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [LOI] Khong the cai dat requirements.txt. Kiem tra ket noi mang.
    pause
    exit /b 1
)

echo [2/2] Dang kiem tra ODBC Driver for SQL Server...
python -c "import pyodbc; drivers=[d for d in pyodbc.drivers() if 'SQL Server' in d]; print('Drivers tim thay:', drivers); exit(0 if drivers else 1)"
if errorlevel 1 (
    echo [CANH BAO] Chua thay ODBC Driver 18 for SQL Server!
    echo Vui long cai Microsoft ODBC Driver 18 for SQL Server roi chay lai Start_SeaZen_Server.vbs.
    pause
    exit /b 1
)

echo.
echo [HOAN TAT] May Server da san sang!
echo Hay chay file "run\Start_SeaZen_Server.vbs" de bat Server ngam (khong cua so console).
pause
