@echo off
chcp 65001 >nul
title SEAZEN VMS v2.0 - He Thong Kiem Soat Ra Vao ^& Sinh Trac Hoc
cd /d "%~dp0"

echo ============================================================================
echo   SEAZEN VMS v2.0 - HE THONG KIEM SOAT RA VAO ^& SINH TRAC HOC KHUON MAT
echo   - CSDL Microsoft SQL Server: SeaZen_AccessControl (18 Bang)
echo   - Dong bo SharePoint Online: VMS SEAZEN - (Ten bang) [Cot Tieng Viet]
echo   - Bao ve Dong ho 4 May ZKTeco SenseFace 4A: Chuan NTP Viet Nam (2 Lop)
echo ============================================================================
echo.
echo   [1] Chay che do Desktop App (WebView2 Native Window - Mac dinh)
echo   [2] Chay che do DevTest (Mo tren Trinh duyet Web de kiem thu)
echo.
choice /c 12 /n /t 5 /d 1 /m "Chon che do khoi chay [1/2] (Tu dong chon [1] sau 5 giay): "

if errorlevel 2 (
    python launcher.py --devtest
) else (
    python launcher.py
)

if %errorlevel% neq 0 (
    echo.
    echo [CANH BAO] Ung dung dung voi ma loi %errorlevel%.
    pause
)
