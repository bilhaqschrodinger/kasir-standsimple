import os
import sqlite3
from datetime import datetime, timezone, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("STANDPOS_DB_PATH", os.path.join(BASE_DIR, "standpos.db"))

WIB = timezone(timedelta(hours=7))


def now_wib_iso() -> str:
    """Waktu sekarang dalam zona WIB (Asia/Jakarta) format ISO 8601 lokal."""
    return datetime.now(WIB).strftime("%Y-%m-%dT%H:%M:%S")


def today_wib_str() -> str:
    """Tanggal hari ini dalam zona WIB (YYYY-MM-DD)."""
    return datetime.now(WIB).strftime("%Y-%m-%d")


def get_connection(db_path: str | None = None) -> sqlite3.Connection:
    """Membuka koneksi SQLite (`standpos.db`)."""
    target_path = db_path or DB_PATH
    conn = sqlite3.connect(target_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS menus (
  id_menu     INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_menu   TEXT    NOT NULL,
  harga       INTEGER NOT NULL CHECK (harga > 0),
  aktif       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transactions (
  id_transaction INTEGER PRIMARY KEY AUTOINCREMENT,
  waktu          TEXT    NOT NULL,                       -- ISO 8601 WIB
  total_harga    INTEGER NOT NULL CHECK (total_harga > 0),
  metode_bayar   TEXT    NOT NULL CHECK (metode_bayar IN ('CASH','QRIS','TF')),
  status         TEXT    NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID','VOID')),
  status_bayar   TEXT    NOT NULL DEFAULT 'PAID',
  catatan_bayar  TEXT,                                   -- referensi QRIS/TF (opsional)
  uang_diterima  INTEGER,                                -- hanya CASH
  kembalian      INTEGER                                 -- hanya CASH
);

CREATE TABLE IF NOT EXISTS transaction_details (
  id_detail      INTEGER PRIMARY KEY AUTOINCREMENT,
  id_transaction INTEGER NOT NULL REFERENCES transactions(id_transaction),
  nama_item      TEXT    NOT NULL,
  harga_satuan   INTEGER NOT NULL CHECK (harga_satuan > 0),
  qty            INTEGER NOT NULL CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS daily_capital (
  tanggal        TEXT    PRIMARY KEY,                    -- YYYY-MM-DD
  modal          INTEGER NOT NULL DEFAULT 0 CHECK (modal >= 0)
);

CREATE INDEX IF NOT EXISTS idx_trx_waktu ON transactions(waktu);
"""


def init_db(db_path: str | None = None) -> None:
    """Inisialisasi tabel database SQLite jika belum ada."""
    conn = get_connection(db_path)
    try:
        with conn:
            conn.executescript(SCHEMA_SQL)
            cols = [
                row["name"]
                for row in conn.execute("PRAGMA table_info(transactions)").fetchall()
            ]
            if "status_bayar" not in cols:
                conn.execute(
                    "ALTER TABLE transactions ADD COLUMN status_bayar TEXT NOT NULL DEFAULT 'PAID'"
                )
    finally:
        conn.close()
