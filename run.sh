#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -x ".venv/bin/python" ]; then
    echo "Menyiapkan lingkungan Python (.venv)..."
    if command -v python3 >/dev/null 2>&1; then
        python3 -m venv .venv
    elif command -v python >/dev/null 2>&1; then
        python -m venv .venv
    elif command -v uv >/dev/null 2>&1; then
        uv venv .venv
    else
        echo "[ERROR] Python 3.10+ tidak ditemukan. Instal Python 3 terlebih dahulu."
        exit 1
    fi
fi

if ! .venv/bin/python -c "import flask, openpyxl" >/dev/null 2>&1; then
    echo "Menginstal dependensi StandPOS (Flask & openpyxl)..."
    if .venv/bin/python -m pip --version >/dev/null 2>&1; then
        .venv/bin/python -m pip install -r requirements.txt
    elif command -v uv >/dev/null 2>&1; then
        uv pip install --python .venv/bin/python -r requirements.txt
    else
        echo "[ERROR] pip/uv tidak tersedia di .venv."
        exit 1
    fi
fi

echo "Menjalankan StandPOS di http://localhost:5000 ..."
exec .venv/bin/python app.py
