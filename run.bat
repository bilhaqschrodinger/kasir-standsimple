@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Menyiapkan lingkungan Python ^(.venv^)...
    python -c "import sys" >nul 2>&1
    if not errorlevel 1 (
        python -m venv .venv
    ) else (
        py -3 -c "import sys" >nul 2>&1
        if not errorlevel 1 (
            py -3 -m venv .venv
        ) else (
            uv --version >nul 2>&1
            if not errorlevel 1 (
                uv venv .venv
            ) else (
                echo.
                echo [ERROR] Python 3.10+ tidak ditemukan di komputer ini.
                echo Silakan unduh dari https://www.python.org/downloads/
                echo Saat instalasi, pastikan mencentang opsi "Add Python to PATH".
                echo.
                if not "%~1"=="--setup" pause
                exit /b 1
            )
        )
    )
)

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo [ERROR] Gagal membuat virtual environment .venv.
    if not "%~1"=="--setup" pause
    exit /b 1
)

".venv\Scripts\python.exe" -c "import flask, openpyxl" >nul 2>&1
if errorlevel 1 (
    echo Menginstal dependensi kasir-standsimple ^(Flask ^& openpyxl^)...
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 (
        uv --version >nul 2>&1
        if not errorlevel 1 (
            uv pip install --python ".venv\Scripts\python.exe" -r requirements.txt
        )
    )
    ".venv\Scripts\python.exe" -c "import flask, openpyxl" >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [ERROR] Gagal menginstal dependensi. Pastikan koneksi internet aktif lalu coba lagi.
        if not "%~1"=="--setup" pause
        exit /b 1
    )
)

if "%~1"=="--setup" exit /b 0

echo.
echo Menjalankan kasir-standsimple di http://localhost:5000 ...
echo ^(Tekan Ctrl+C atau tutup jendela ini untuk berhenti^)
echo.
".venv\Scripts\python.exe" app.py
pause
