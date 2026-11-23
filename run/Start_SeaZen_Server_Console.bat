@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title SeaZen VMS Server - Port 6868 (%COMPUTERNAME%)
echo ============================================================================
echo   SEAZEN VMS SERVER - CHAY GIU CUA SO CMD (PORT 6868)
echo   Truy cap co dinh theo Ten may : http://%COMPUTERNAME%:6868
echo   (Giu cua so nay mo de duy tri Server phuc vu may Le tan qua LAN)
echo ============================================================================
echo.
python launcher.py --no-tray
echo.
echo [THONG BAO] Tien trinh Server da ket thuc.
pause
