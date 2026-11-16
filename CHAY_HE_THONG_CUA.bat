@echo off
chcp 65001 >nul
title SEAZEN VMS v2.0 - He Thong Kiem Soat Ra Vao ^& Sinh Trac Hoc
cd /d "%~dp0"

python launcher.py

echo.
echo [THONG BAO] Tien trinh may chu da ket thuc.
pause
