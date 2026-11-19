@echo off
setlocal
cd /d "%~dp0"

call "%~dp0run.bat" --setup
if errorlevel 1 (
    pause
    exit /b 1
)

where ssh >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Perintah ssh tidak ditemukan. Pastikan OpenSSH Client aktif di Windows.
    pause
    exit /b 1
)

echo Menyalakan server StandPOS di http://localhost:5000 ...
start "" /B ".venv\Scripts\python.exe" app.py

echo Menunggu server siap...
ping -n 3 127.0.0.1 >nul

echo.
echo Membuka link publik sementara via localhost.run ...
echo ^(Biarkan jendela ini tetap terbuka selama link dipakai^)
echo.
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:127.0.0.1:5000 nokey@localhost.run
pause
