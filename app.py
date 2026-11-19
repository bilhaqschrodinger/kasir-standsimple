import io
import os
import re
from datetime import datetime
from flask import Flask, jsonify, redirect, render_template, request, send_file
from werkzeug.exceptions import HTTPException
from werkzeug.serving import WSGIRequestHandler

from db import get_connection, init_db, now_wib_iso, today_wib_str
from excel_export import build_daily_report_excel

app = Flask(__name__)

CSP_POLICY = (
    "default-src 'self'; "
    "script-src 'self' https://cdn.tailwindcss.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'self'; "
    "form-action 'self'"
)

MAX_NAME_LEN = 120
MAX_NOTE_LEN = 250
MAX_ITEMS_PER_ORDER = 200
MAX_MONEY_VALUE = 1_000_000_000


def _parse_bounded_int(val, min_value: int) -> int | None:
    """Validasi bahwa nilai adalah integer bulat >= min_value dan <= MAX_MONEY_VALUE."""
    if isinstance(val, bool) or val is None:
        return None
    n: int | None = None
    if isinstance(val, int):
        n = val
    elif isinstance(val, str):
        s = val.strip()
        if s.isdigit():
            n = int(s)
    if n is None or n < min_value or n > MAX_MONEY_VALUE:
        return None
    return n


def parse_positive_int(val) -> int | None:
    """Validasi bahwa nilai adalah integer bulat > 0 dan <= MAX_MONEY_VALUE."""
    return _parse_bounded_int(val, 1)


def parse_non_negative_int(val) -> int | None:
    """Validasi bahwa nilai adalah integer bulat >= 0 dan <= MAX_MONEY_VALUE."""
    return _parse_bounded_int(val, 0)


def _validate_iso_date(raw_val) -> tuple[str | None, tuple | None]:
    """Validasi string tanggal kalender YYYY-MM-DD (default hari ini WIB)."""
    tanggal = (str(raw_val) if raw_val is not None else "").strip()
    if not tanggal or tanggal in ("undefined", "null"):
        return today_wib_str(), None

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tanggal):
        return None, (
            jsonify({"ok": False, "error": "Format tanggal harus YYYY-MM-DD."}),
            400,
        )
    try:
        datetime.strptime(tanggal, "%Y-%m-%d")
    except ValueError:
        return None, (
            jsonify({"ok": False, "error": "Tanggal kalender tidak valid."}),
            400,
        )
    return tanggal, None


# Inisialisasi database otomatis saat aplikasi jalan
init_db()


@app.after_request
def disable_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["Content-Security-Policy"] = CSP_POLICY
    response.headers["Strict-Transport-Security"] = "max-age=31536000"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), payment=(), usb=()"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


@app.errorhandler(400)
def bad_request_error(e):
    return jsonify({"ok": False, "error": "Permintaan tidak valid."}), 400


@app.errorhandler(404)
def not_found_error(e):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Data tidak ditemukan."}), 404
    return redirect("/")


@app.errorhandler(405)
def method_not_allowed_error(e):
    return jsonify({"ok": False, "error": "Metode HTTP tidak diizinkan."}), 405


@app.errorhandler(Exception)
def internal_error(e):
    if isinstance(e, HTTPException):
        return jsonify({"ok": False, "error": e.description}), e.code
    return (
        jsonify(
            {
                "ok": False,
                "error": "Terjadi kendala pada server. Silakan coba lagi.",
            }
        ),
        500,
    )


# ---------------------------------------------------------------------------
# Halaman Utama Terpadu (Kasir + Menu + Omzet + Riwayat dalam 1 layar)
# ---------------------------------------------------------------------------
@app.route("/")
@app.route("/admin")
@app.route("/dashboard")
def pos_page():
    return render_template("pos.html", today=today_wib_str())


# ---------------------------------------------------------------------------
# API Menu (/api/menus) — Tanpa Login
# ---------------------------------------------------------------------------
@app.route("/api/menus", methods=["GET"])
def api_get_menus():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id_menu, nama_menu, harga, aktif FROM menus WHERE aktif = 1 ORDER BY id_menu ASC"
        ).fetchall()
        return jsonify([dict(row) for row in rows])
    finally:
        conn.close()


def _validate_menu_payload(data) -> tuple[tuple[str, int] | None, tuple | None]:
    """Validasi payload JSON untuk pembuatan atau pembaruan menu."""
    if not isinstance(data, dict):
        return None, (
            jsonify({"ok": False, "error": "Format data harus berupa JSON."}),
            400,
        )

    nama_menu = str(data.get("nama_menu") or "").strip()
    if not nama_menu:
        return None, (
            jsonify({"ok": False, "error": "Isi nama menu terlebih dahulu."}),
            400,
        )
    if len(nama_menu) > MAX_NAME_LEN:
        return None, (
            jsonify(
                {
                    "ok": False,
                    "error": f"Nama menu maksimal {MAX_NAME_LEN} karakter.",
                }
            ),
            400,
        )

    harga = parse_positive_int(data.get("harga"))
    if harga is None:
        return None, (
            jsonify(
                {
                    "ok": False,
                    "error": f"Harga harus berupa angka bulat antara 1 dan {MAX_MONEY_VALUE:,}.".replace(
                        ",", "."
                    ),
                }
            ),
            400,
        )
    return (nama_menu, harga), None


@app.route("/api/menus", methods=["POST"])
def api_create_menu():
    parsed, err_resp = _validate_menu_payload(request.get_json(silent=True))
    if err_resp is not None:
        return err_resp
    nama_menu, harga = parsed

    conn = get_connection()
    try:
        with conn:
            cur = conn.execute(
                "INSERT INTO menus (nama_menu, harga, aktif) VALUES (?, ?, 1)",
                (nama_menu, harga),
            )
            new_id = cur.lastrowid
        return (
            jsonify(
                {
                    "ok": True,
                    "id_menu": new_id,
                    "menu": {
                        "id_menu": new_id,
                        "nama_menu": nama_menu,
                        "harga": harga,
                        "aktif": 1,
                    },
                }
            ),
            201,
        )
    finally:
        conn.close()


@app.route("/api/menus/<int:id_menu>", methods=["PUT"])
def api_update_menu(id_menu: int):
    parsed, err_resp = _validate_menu_payload(request.get_json(silent=True))
    if err_resp is not None:
        return err_resp
    nama_menu, harga = parsed

    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id_menu, aktif FROM menus WHERE id_menu = ?", (id_menu,)
        ).fetchone()
        if not existing or existing["aktif"] == 0:
            return jsonify({"ok": False, "error": "Menu tidak ditemukan."}), 404

        with conn:
            conn.execute(
                "UPDATE menus SET nama_menu = ?, harga = ? WHERE id_menu = ?",
                (nama_menu, harga, id_menu),
            )
        return jsonify(
            {
                "ok": True,
                "menu": {
                    "id_menu": id_menu,
                    "nama_menu": nama_menu,
                    "harga": harga,
                    "aktif": 1,
                },
            }
        )
    finally:
        conn.close()


@app.route("/api/menus/<int:id_menu>", methods=["DELETE"])
def api_delete_menu(id_menu: int):
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id_menu FROM menus WHERE id_menu = ?", (id_menu,)
        ).fetchone()
        if not existing:
            return jsonify({"ok": False, "error": "Menu tidak ditemukan."}), 404

        with conn:
            conn.execute("UPDATE menus SET aktif = 0 WHERE id_menu = ?", (id_menu,))
        return jsonify({"ok": True, "id_menu": id_menu})
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# API Checkout (/api/checkout)
# ---------------------------------------------------------------------------
@app.route("/api/checkout", methods=["POST"])
def api_checkout():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Format data harus berupa JSON."}), 400

    metode_bayar = str(data.get("metode_bayar") or "").strip().upper()
    if metode_bayar not in ("CASH", "QRIS", "TF"):
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "Pilih metode pembayaran CASH, QRIS, atau TF.",
                }
            ),
            400,
        )

    raw_items = data.get("items")
    if not isinstance(raw_items, list) or len(raw_items) == 0:
        return (
            jsonify({"ok": False, "error": "Pesanan masih kosong."}),
            400,
        )
    if len(raw_items) > MAX_ITEMS_PER_ORDER:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": f"Maksimal {MAX_ITEMS_PER_ORDER} item dalam satu transaksi.",
                }
            ),
            400,
        )

    validated_items = []
    total_harga = 0

    for idx, item in enumerate(raw_items, start=1):
        if not isinstance(item, dict):
            return (
                jsonify({"ok": False, "error": f"Item ke-{idx} tidak valid."}),
                400,
            )
        nama_item = str(item.get("nama_item") or "").strip()
        harga_satuan = parse_positive_int(item.get("harga_satuan"))
        qty = parse_positive_int(item.get("qty"))

        if not nama_item:
            return (
                jsonify({"ok": False, "error": f"Nama item ke-{idx} kosong."}),
                400,
            )
        if len(nama_item) > MAX_NAME_LEN:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": f"Nama item ke-{idx} maksimal {MAX_NAME_LEN} karakter.",
                    }
                ),
                400,
            )
        if harga_satuan is None:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": f"Harga '{nama_item}' harus angka bulat lebih dari 0.",
                    }
                ),
                400,
            )
        if qty is None:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": f"Jumlah '{nama_item}' harus angka bulat lebih dari 0.",
                    }
                ),
                400,
            )

        total_harga += harga_satuan * qty
        validated_items.append(
            {
                "nama_item": nama_item,
                "harga_satuan": harga_satuan,
                "qty": qty,
            }
        )

    catatan_raw = data.get("catatan_bayar")
    catatan_bayar = (
        str(catatan_raw).strip()
        if catatan_raw is not None and str(catatan_raw).strip() != ""
        else None
    )
    if catatan_bayar is not None and len(catatan_bayar) > MAX_NOTE_LEN:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": f"Catatan pembayaran maksimal {MAX_NOTE_LEN} karakter.",
                }
            ),
            400,
        )

    uang_diterima = None
    kembalian = None

    if metode_bayar == "CASH":
        raw_uang = data.get("uang_diterima")
        if raw_uang is not None and str(raw_uang).strip() != "":
            parsed_uang = parse_non_negative_int(raw_uang)
            if parsed_uang is None:
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "Nominal uang diterima harus berupa angka bulat.",
                        }
                    ),
                    400,
                )
            if parsed_uang < total_harga:
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": f"Uang diterima (Rp {parsed_uang:,}) kurang dari total (Rp {total_harga:,}).".replace(
                                ",", "."
                            ),
                        }
                    ),
                    400,
                )
            uang_diterima = parsed_uang
            kembalian = uang_diterima - total_harga

    waktu = now_wib_iso()

    conn = get_connection()
    try:
        with conn:
            cur = conn.execute(
                """
                INSERT INTO transactions
                    (waktu, total_harga, metode_bayar, status, status_bayar, catatan_bayar, uang_diterima, kembalian)
                VALUES (?, ?, ?, 'PAID', 'PAID', ?, ?, ?)
                """,
                (
                    waktu,
                    total_harga,
                    metode_bayar,
                    catatan_bayar,
                    uang_diterima,
                    kembalian,
                ),
            )
            id_transaction = cur.lastrowid

            conn.executemany(
                """
                INSERT INTO transaction_details
                    (id_transaction, nama_item, harga_satuan, qty)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        id_transaction,
                        it["nama_item"],
                        it["harga_satuan"],
                        it["qty"],
                    )
                    for it in validated_items
                ],
            )

        return jsonify(
            {
                "ok": True,
                "id_transaction": id_transaction,
                "total_harga": total_harga,
                "kembalian": kembalian,
                "waktu": waktu,
            }
        )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# API Modal Harian (/api/capital)
# ---------------------------------------------------------------------------
@app.route("/api/capital", methods=["PUT", "POST"])
def api_set_capital():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Format data harus berupa JSON."}), 400

    tanggal, err_resp = _validate_iso_date(data.get("tanggal"))
    if err_resp is not None:
        return err_resp

    modal = parse_non_negative_int(data.get("modal"))
    if modal is None:
        return (
            jsonify(
                {"ok": False, "error": "Nominal modal harus berupa angka bulat >= 0."}
            ),
            400,
        )

    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO daily_capital (tanggal, modal)
                VALUES (?, ?)
                ON CONFLICT(tanggal) DO UPDATE SET modal = excluded.modal
                """,
                (tanggal, modal),
            )
        return jsonify({"ok": True, "tanggal": tanggal, "modal": modal})
    finally:
        conn.close()


def _resolve_report_date() -> tuple[str | None, tuple | None]:
    """Ambil dan validasi parameter tanggal (YYYY-MM-DD) dari query string."""
    return _validate_iso_date(request.args.get("date"))


# ---------------------------------------------------------------------------
# API Laporan, Riwayat, Detail & Void Transaksi
# ---------------------------------------------------------------------------
@app.route("/api/report", methods=["GET"])
def api_report():
    tanggal, err_resp = _resolve_report_date()
    if err_resp is not None:
        return err_resp

    conn = get_connection()
    try:
        cap_row = conn.execute(
            "SELECT modal FROM daily_capital WHERE tanggal = ?", (tanggal,)
        ).fetchone()
        modal_awal = cap_row["modal"] if cap_row else 0

        trx_rows = conn.execute(
            """
            SELECT id_transaction, waktu, total_harga, metode_bayar, status,
                   catatan_bayar, uang_diterima, kembalian
            FROM transactions
            WHERE substr(waktu, 1, 10) = ?
            ORDER BY waktu DESC, id_transaction DESC
            """,
            (tanggal,),
        ).fetchall()

        total_pendapatan = 0
        total_cash = 0
        total_qris = 0
        total_tf = 0
        jumlah_transaksi = 0

        trx_ids = [r["id_transaction"] for r in trx_rows]
        details_by_trx: dict[int, list[str]] = {tid: [] for tid in trx_ids}

        if trx_ids:
            placeholders = ",".join("?" for _ in trx_ids)
            detail_rows = conn.execute(
                f"""
                SELECT id_transaction, nama_item, qty
                FROM transaction_details
                WHERE id_transaction IN ({placeholders})
                ORDER BY id_detail ASC
                """,
                trx_ids,
            ).fetchall()
            for d in detail_rows:
                details_by_trx[d["id_transaction"]].append(
                    f"{d['nama_item']} x{d['qty']}"
                )

        transaksi_list = []
        for r in trx_rows:
            tid = r["id_transaction"]
            status = r["status"]
            harga = r["total_harga"]
            metode = r["metode_bayar"]

            if status == "PAID":
                total_pendapatan += harga
                jumlah_transaksi += 1
                if metode == "CASH":
                    total_cash += harga
                elif metode == "QRIS":
                    total_qris += harga
                elif metode == "TF":
                    total_tf += harga

            transaksi_list.append(
                {
                    "id_transaction": tid,
                    "waktu": r["waktu"],
                    "total_harga": harga,
                    "metode_bayar": metode,
                    "status": status,
                    "catatan_bayar": r["catatan_bayar"],
                    "uang_diterima": r["uang_diterima"],
                    "kembalian": r["kembalian"],
                    "ringkasan": ", ".join(details_by_trx.get(tid, [])),
                }
            )

        return jsonify(
            {
                "tanggal": tanggal,
                "modal_awal": modal_awal,
                "total_pendapatan": total_pendapatan,
                "laba_bersih": total_pendapatan - modal_awal,
                "total_cash": total_cash,
                "total_qris": total_qris,
                "total_tf": total_tf,
                "jumlah_transaksi": jumlah_transaksi,
                "transaksi": transaksi_list,
            }
        )
    finally:
        conn.close()


@app.route("/api/export/excel", methods=["GET"])
def api_export_excel():
    tanggal, err_resp = _resolve_report_date()
    if err_resp is not None:
        return err_resp

    xlsx_bytes = build_daily_report_excel(tanggal)
    return send_file(
        io.BytesIO(xlsx_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=f"StandPOS_Laporan_{tanggal}.xlsx",
    )


@app.route("/api/transactions/<int:id_transaction>", methods=["GET"])
def api_transaction_detail(id_transaction: int):
    conn = get_connection()
    try:
        trx = conn.execute(
            """
            SELECT id_transaction, waktu, total_harga, metode_bayar, status,
                   catatan_bayar, uang_diterima, kembalian
            FROM transactions
            WHERE id_transaction = ?
            """,
            (id_transaction,),
        ).fetchone()
        if not trx:
            return jsonify({"ok": False, "error": "Transaksi tidak ditemukan."}), 404

        details = conn.execute(
            """
            SELECT id_detail, nama_item, harga_satuan, qty
            FROM transaction_details
            WHERE id_transaction = ?
            ORDER BY id_detail ASC
            """,
            (id_transaction,),
        ).fetchall()

        items = [
            {
                "id_detail": d["id_detail"],
                "nama_item": d["nama_item"],
                "harga_satuan": d["harga_satuan"],
                "qty": d["qty"],
                "subtotal": d["harga_satuan"] * d["qty"],
            }
            for d in details
        ]

        result = dict(trx)
        result["items"] = items
        return jsonify(result)
    finally:
        conn.close()


@app.route("/api/transactions/<int:id_transaction>/void", methods=["POST"])
def api_void_transaction(id_transaction: int):
    conn = get_connection()
    try:
        trx = conn.execute(
            "SELECT id_transaction FROM transactions WHERE id_transaction = ?",
            (id_transaction,),
        ).fetchone()
        if not trx:
            return jsonify({"ok": False, "error": "Transaksi tidak ditemukan."}), 404

        with conn:
            conn.execute(
                "UPDATE transactions SET status = 'VOID', status_bayar = 'VOID' WHERE id_transaction = ?",
                (id_transaction,),
            )
        return jsonify(
            {
                "ok": True,
                "id_transaction": id_transaction,
                "status": "VOID",
            }
        )
    finally:
        conn.close()


class NoBannerRequestHandler(WSGIRequestHandler):
    """Hilangkan header Server (versi Werkzeug/Python) dari respons HTTP."""

    def send_header(self, keyword: str, value: str) -> None:
        if keyword.lower() == "server":
            return
        super().send_header(keyword, value)


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(
        host="0.0.0.0",
        port=port,
        debug=False,
        request_handler=NoBannerRequestHandler,
    )
