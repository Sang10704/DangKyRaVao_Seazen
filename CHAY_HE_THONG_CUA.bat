@echo off
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONDONTWRITEBYTECODE=1
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

title SeaZen Smart Access Control Server (Port 6868)
color 0B

echo ======================================================================
echo       SEAZEN SMART ACCESS CONTROL - HE THONG QUAN LY CUA RA VAO
echo ======================================================================
echo.

:: [1/4] Kiem tra thu muc du lieu data
if not exist "data" mkdir "data"
echo [1/4] Thu muc du lieu data/ da san sang.

:: [2/4] Kiem tra moi truong Python
echo [2/4] Dang kiem tra moi truong Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [LOI NGHIEP TRONG] Khong tim thay Python tren he thong!
    echo Vui long cai dat Python 3.10 tro len va tich vao "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

:: [3/4] Kiem tra ket noi mang den May Chu ePAD
echo [3/4] Kiem tra ket noi den May Chu ePAD 172.16.56.2...
ping -n 1 -w 1500 172.16.56.2 >nul 2>&1
if errorlevel 1 (
    echo  [CANH BAO] Khong the ping den may chu ePAD 172.16.56.2
    echo            Kiem tra lai day mang LAN hoac ket noi Wi-Fi.
) else (
    echo  [OK] Ket noi mang den May chu ePAD 172.16.56.2 on dinh.
)

:: [4/4] Kiem tra va giai phong port 6868 neu co tien trinh cu
echo [4/4] Kiem tra trang thai cong 6868...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :6868 ^| findstr LISTENING') do (
    echo  - Giai phong tien trinh cu PID %%a tren port 6868...
    taskkill /f /pid %%a >nul 2>&1
)

echo.
echo ======================================================================
echo  THONG TIN HE THONG SEAZEN ACCESS CONTROL
echo ======================================================================
echo  - Dia chi ung dung tai may:    http://localhost:6868
echo  - May chu ket noi ePAD:        http://172.16.56.2:4001/api
echo  - Quan ly 4 thiet bi cua:      SenseFace 4A (2 Lan Vao / 2 Lan Ra)
echo  - Chuc nang:
echo      + 100%% Du lieu thuc te tu ePAD (12 phong ban, 790 nhan su)
echo      + Quet QR CCCD sieu toc (Boc tach, chong hop thoai In Ctrl+P)
echo      + Loc Nhan vien tiep don theo dung Phong Ban
echo      + Ngay/Gio Vao - Ngay/Gio Ra mac dinh 16:45 (co the sua)
echo      + Bieu do va KPI truc quan theo ngay lich su
echo      + Dang ky khach dong bo the RFID truc tiep xuong 4 may cua
echo ======================================================================
echo.
echo Dang khoi dong Web Server va mo trinh duyet...

:: Mo trinh duyet sau 2 giay de dam bao Web Server da lang nghe xong
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:6868"

:: Chay Web Application Flask (chay ma nguon truc tiep, khong dung cache pyc)
python -B app.py

echo.
echo [THONG BAO] Web Server da dung hoat dong.
pause
