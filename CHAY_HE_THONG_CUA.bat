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

:: [1/5] Kiem tra thu muc du lieu data
if not exist "data" mkdir "data"
echo [1/5] Thu muc du lieu data/ da san sang.

:: [2/5] Kiem tra moi truong Python
echo [2/5] Dang kiem tra moi truong Python va thu vien...
python --version >nul 2>&1
if errorlevel 1 goto :no_python
goto :check_libs

:no_python
echo.
echo ======================================================================
echo  [LOI NGHIEP TRONG] Khong tim thay Python tren may tinh nay!
echo  Vui long cai dat Python 3.10 hoac 3.11 hoac 3.12.
echo  CHU Y KHI CAI: Nho tich vao o "Add Python to PATH" truoc khi bam Install.
echo ======================================================================
echo.
pause
exit /b 1

:check_libs
python -c "import flask, waitress, zk, requests, openpyxl" >nul 2>&1
if errorlevel 1 goto :install_libs
echo  [OK] Moi truong Python va thu vien da san sang!
goto :check_zk

:install_libs
echo  - Dang tu dong cai dat cac thu vien can thiet tu requirements.txt...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo  [CANH BAO] Co canh bao khi cai thu vien. He thong van se thu chay...
) else (
    echo  [OK] Da cai dat xong cac thu vien!
)

:check_zk
echo.
echo [3/5] Dang kiem tra ket noi den 4 thiet bi cua ZKTeco (Subnet 172.16.56.x)...
ping -n 1 -w 800 172.16.56.139 >nul 2>&1
if errorlevel 1 (echo  [-] 172.16.56.139 : Lan VAO phai - CHUA KET NOI) else (echo  [+] 172.16.56.139 : Lan VAO phai - KET NOI TOT)

ping -n 1 -w 800 172.16.56.138 >nul 2>&1
if errorlevel 1 (echo  [-] 172.16.56.138 : Lan VAO trai - CHUA KET NOI) else (echo  [+] 172.16.56.138 : Lan VAO trai - KET NOI TOT)

ping -n 1 -w 800 172.16.56.137 >nul 2>&1
if errorlevel 1 (echo  [-] 172.16.56.137 : Lan RA trai  - CHUA KET NOI) else (echo  [+] 172.16.56.137 : Lan RA trai  - KET NOI TOT)

ping -n 1 -w 800 172.16.56.136 >nul 2>&1
if errorlevel 1 (echo  [-] 172.16.56.136 : Lan RA phai  - CHUA KET NOI) else (echo  [+] 172.16.56.136 : Lan RA phai  - KET NOI TOT)

echo.
echo [4/5] Kiem tra trang thai cong 6868...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :6868 ^| findstr LISTENING') do (
    echo  - Giai phong tien trinh cu PID %%a tren port 6868...
    taskkill /f /pid %%a >nul 2>&1
)

echo.
echo [5/5] He thong da san sang khoi chay...
echo ======================================================================
echo  THONG TIN KET NOI:
echo  - [1] Truy cap tai MAY NAY (Host hien tai)  : http://localhost:6868
echo  - [2] Truy cap tu MAY LE TAN / MAY KHAC (LAN): Mo trinh duyet go IP_MAY_NAY:6868
echo  - Che do ket noi thiet bi                   : ZKTeco Direct TCP (SenseFace 4A - Port 4370)
echo  - Doc lap hoan toan                          : Khong phu thuoc ePAD hay cloud thu 3
echo  - Che do may chu                             : Da luong Waitress (16 threads toc do cao)
echo ======================================================================
echo.
echo Dang khoi dong Web Server va tu dong mo trinh duyet...

:: Mo trinh duyet sau 2 giay
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:6868"

:: Chay Web Application (luon giu cua so mo neu co loi)
python -B app.py

echo.
echo ======================================================================
echo [THONG BAO] Web Server da dung hoat dong.
echo Xem thong bao o tren neu co loi.
echo ======================================================================
echo.
pause
