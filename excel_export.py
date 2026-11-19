import io
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from db import get_connection, now_wib_iso

CURRENCY_FORMAT = '"Rp "#,##0;-"Rp "#,##0;"Rp "0'
INT_FORMAT = "#,##0"
PERCENT_FORMAT = "0.0%"

FONT_FAMILY = "Calibri"

FILL_HEADER = PatternFill(start_color="18181B", end_color="18181B", fill_type="solid")
FILL_SECTION = PatternFill(start_color="F4F4F5", end_color="F4F4F5", fill_type="solid")
FILL_TOTAL = PatternFill(start_color="F4F4F5", end_color="F4F4F5", fill_type="solid")
FILL_VOID = PatternFill(start_color="FEF2F2", end_color="FEF2F2", fill_type="solid")

BORDER_SIDE = Side(border_style="thin", color="D4D4D8")
BORDER_CELL = Border(
    left=BORDER_SIDE, right=BORDER_SIDE, top=BORDER_SIDE, bottom=BORDER_SIDE
)

FONT_TITLE = Font(name=FONT_FAMILY, size=14, bold=True, color="18181B")
FONT_META_LABEL = Font(name=FONT_FAMILY, size=10, bold=True, color="52525B")
FONT_META_VALUE = Font(name=FONT_FAMILY, size=10, bold=False, color="18181B")
FONT_SECTION = Font(name=FONT_FAMILY, size=11, bold=True, color="18181B")
FONT_HEADER = Font(name=FONT_FAMILY, size=10, bold=True, color="FFFFFF")
FONT_BODY = Font(name=FONT_FAMILY, size=10, bold=False, color="18181B")
FONT_BODY_BOLD = Font(name=FONT_FAMILY, size=10, bold=True, color="18181B")
FONT_PROFIT_POS = Font(name=FONT_FAMILY, size=10, bold=True, color="15803D")
FONT_PROFIT_NEG = Font(name=FONT_FAMILY, size=10, bold=True, color="B91C1C")
FONT_VOID = Font(name=FONT_FAMILY, size=10, bold=False, color="B91C1C", strike=True)
FONT_EMPTY = Font(name=FONT_FAMILY, size=10, italic=True, color="71717A")

ALIGN_LEFT = Alignment(horizontal="left", vertical="center")
ALIGN_CENTER = Alignment(horizontal="center", vertical="center")
ALIGN_RIGHT = Alignment(horizontal="right", vertical="center")
ALIGN_WRAP_LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)


def _sanitize_excel_text(value: str | None) -> str:
    """Cegah Excel formula injection pada teks input pengguna."""
    if value is None:
        return ""
    text = str(value)
    if not text or text == "-":
        return text
    stripped = text.lstrip()
    if (stripped and stripped[0] in ("=", "+", "-", "@")) or text[0] in ("\t", "\r", "\n"):
        return f"'{text}"
    return text


def _format_jam_wib(iso_str: str) -> str:
    """Ambil jam HH:MM:SS dari string waktu ISO lokal."""
    if not iso_str:
        return "-"
    parts = str(iso_str).split("T")
    return parts[1][:8] if len(parts) == 2 else str(iso_str)


def _style_header_row(ws, row_idx: int, headers: list[str], alignments: list[Alignment]) -> None:
    """Tulis dan format baris header tabel."""
    ws.row_dimensions[row_idx].height = 24
    for col_idx, (title, align) in enumerate(zip(headers, alignments), start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=title)
        cell.fill = FILL_HEADER
        cell.font = FONT_HEADER
        cell.border = BORDER_CELL
        cell.alignment = align


def _autosize_columns(
    ws,
    min_widths: dict[int, int] | None = None,
    max_widths: dict[int, int] | None = None,
) -> None:
    """Sesuaikan lebar kolom secara otomatis dengan batas minimum dan maksimum."""
    min_widths = min_widths or {}
    max_widths = max_widths or {}

    for col_cells in ws.columns:
        col_idx = col_cells[0].column
        longest = 0
        for cell in col_cells:
            if cell.row == 1 and ws.title == "Ringkasan":
                continue
            val = cell.value
            if val is None:
                continue
            if isinstance(val, (int, float)):
                num_fmt = cell.number_format or ""
                if "Rp" in num_fmt:
                    text_len = len(f"Rp {int(round(abs(val))):,}") + (1 if val < 0 else 0)
                elif "%" in num_fmt:
                    text_len = 7
                else:
                    text_len = len(f"{int(round(val)):,}")
            else:
                text_len = max((len(line) for line in str(val).splitlines()), default=0)
            if text_len > longest:
                longest = text_len

        floor_w = min_widths.get(col_idx, 10)
        ceil_w = max_widths.get(col_idx, 42)
        ws.column_dimensions[get_column_letter(col_idx)].width = max(
            floor_w, min(longest + 4, ceil_w)
        )


def _fetch_daily_data(tanggal: str, db_path: str | None = None) -> dict:
    """Ambil dan agregasikan data penjualan harian dari SQLite."""
    conn = get_connection(db_path)
    try:
        cap_row = conn.execute(
            "SELECT modal FROM daily_capital WHERE tanggal = ?", (tanggal,)
        ).fetchone()
        modal_awal = int(cap_row["modal"]) if cap_row else 0

        trx_rows = conn.execute(
            """
            SELECT id_transaction, waktu, total_harga, metode_bayar, status,
                   catatan_bayar, uang_diterima, kembalian
            FROM transactions
            WHERE substr(waktu, 1, 10) = ?
            ORDER BY waktu ASC, id_transaction ASC
            """,
            (tanggal,),
        ).fetchall()

        trx_ids = [r["id_transaction"] for r in trx_rows]
        details_by_trx: dict[int, list[dict]] = {tid: [] for tid in trx_ids}

        if trx_ids:
            placeholders = ",".join("?" for _ in trx_ids)
            detail_rows = conn.execute(
                f"""
                SELECT id_detail, id_transaction, nama_item, harga_satuan, qty
                FROM transaction_details
                WHERE id_transaction IN ({placeholders})
                ORDER BY id_detail ASC
                """,
                trx_ids,
            ).fetchall()
            for d in detail_rows:
                details_by_trx[d["id_transaction"]].append(
                    {
                        "id_detail": d["id_detail"],
                        "id_transaction": d["id_transaction"],
                        "nama_item": d["nama_item"],
                        "harga_satuan": int(d["harga_satuan"]),
                        "qty": int(d["qty"]),
                        "subtotal": int(d["harga_satuan"]) * int(d["qty"]),
                    }
                )
    finally:
        conn.close()

    jumlah_paid = 0
    jumlah_void = 0
    total_item_terjual = 0
    total_pendapatan = 0
    total_cash = 0
    total_qris = 0
    total_tf = 0

    item_agg: dict[str, dict] = {}
    transactions: list[dict] = []
    detail_lines: list[dict] = []

    for r in trx_rows:
        tid = int(r["id_transaction"])
        status = r["status"]
        metode = r["metode_bayar"]
        total_harga = int(r["total_harga"])
        jam_wib = _format_jam_wib(r["waktu"])
        trx_details = details_by_trx.get(tid, [])

        ringkasan = ", ".join(f"{d['nama_item']} x{d['qty']}" for d in trx_details)
        transactions.append(
            {
                "id_transaction": tid,
                "jam_wib": jam_wib,
                "status": status,
                "metode_bayar": metode,
                "ringkasan": ringkasan or "-",
                "total_harga": total_harga,
                "uang_diterima": r["uang_diterima"],
                "kembalian": r["kembalian"],
                "catatan_bayar": r["catatan_bayar"] or "-",
            }
        )

        if status == "PAID":
            jumlah_paid += 1
            total_pendapatan += total_harga
            if metode == "CASH":
                total_cash += total_harga
            elif metode == "QRIS":
                total_qris += total_harga
            elif metode == "TF":
                total_tf += total_harga
        else:
            jumlah_void += 1

        for d in trx_details:
            detail_lines.append(
                {
                    "id_transaction": tid,
                    "jam_wib": jam_wib,
                    "status": status,
                    "metode_bayar": metode,
                    "nama_item": d["nama_item"],
                    "harga_satuan": d["harga_satuan"],
                    "qty": d["qty"],
                    "subtotal": d["subtotal"],
                }
            )
            if status == "PAID":
                total_item_terjual += d["qty"]
                key = d["nama_item"].strip()
                entry = item_agg.setdefault(
                    key, {"nama_item": key, "qty": 0, "total": 0}
                )
                entry["qty"] += d["qty"]
                entry["total"] += d["subtotal"]

    rata_rata_trx = round(total_pendapatan / jumlah_paid) if jumlah_paid > 0 else 0
    laba_bersih = total_pendapatan - modal_awal
    item_breakdown = sorted(
        item_agg.values(),
        key=lambda x: (-x["total"], -x["qty"], x["nama_item"].lower()),
    )

    return {
        "tanggal": tanggal,
        "jumlah_paid": jumlah_paid,
        "jumlah_void": jumlah_void,
        "total_item_terjual": total_item_terjual,
        "total_pendapatan": total_pendapatan,
        "total_cash": total_cash,
        "total_qris": total_qris,
        "total_tf": total_tf,
        "rata_rata_trx": rata_rata_trx,
        "modal_awal": modal_awal,
        "laba_bersih": laba_bersih,
        "item_breakdown": item_breakdown,
        "transactions": transactions,
        "detail_lines": detail_lines,
    }


def _build_ringkasan_sheet(ws, data: dict) -> None:
    """Bangun Sheet 1: Ringkasan keuangan harian dan penjualan per menu."""
    ws.title = "Ringkasan"
    ws.views.sheetView[0].showGridLines = True

    ws.cell(row=1, column=1, value="Laporan Penjualan Harian — kasir-standsimple").font = FONT_TITLE
    ws.row_dimensions[1].height = 26

    ws.cell(row=2, column=1, value="Tanggal Laporan").font = FONT_META_LABEL
    ws.cell(row=2, column=2, value=f"{data['tanggal']} (WIB)").font = FONT_META_VALUE
    ws.cell(row=3, column=1, value="Waktu Export").font = FONT_META_LABEL
    ws.cell(
        row=3,
        column=2,
        value=f"{now_wib_iso().replace('T', ' ')} WIB",
    ).font = FONT_META_VALUE

    # Tabel A: Ringkasan Keuangan & Transaksi
    ws.cell(row=5, column=1, value="Ringkasan Keuangan & Transaksi").font = FONT_SECTION
    ws.row_dimensions[5].height = 22
    _style_header_row(ws, 6, ["Metrik", "Nilai"], [ALIGN_LEFT, ALIGN_RIGHT])

    summary_rows = [
        ("Transaksi Berhasil (PAID)", data["jumlah_paid"], INT_FORMAT, False),
        ("Transaksi Dibatalkan (VOID)", data["jumlah_void"], INT_FORMAT, False),
        ("Total Item / Cup Terjual", data["total_item_terjual"], INT_FORMAT, False),
        ("Total Omzet Kotor", data["total_pendapatan"], CURRENCY_FORMAT, True),
        ("Penerimaan Cash", data["total_cash"], CURRENCY_FORMAT, False),
        ("Penerimaan QRIS", data["total_qris"], CURRENCY_FORMAT, False),
        ("Penerimaan Transfer (TF)", data["total_tf"], CURRENCY_FORMAT, False),
        ("Rata-rata per Transaksi", data["rata_rata_trx"], CURRENCY_FORMAT, False),
        ("Modal Harian", data["modal_awal"], CURRENCY_FORMAT, False),
        ("Laba Bersih (Omzet - Modal)", data["laba_bersih"], CURRENCY_FORMAT, True),
    ]

    row_cursor = 7
    for label, value, num_fmt, is_emphasis in summary_rows:
        ws.row_dimensions[row_cursor].height = 20
        c_label = ws.cell(row=row_cursor, column=1, value=label)
        c_val = ws.cell(row=row_cursor, column=2, value=value)
        c_val.number_format = num_fmt

        c_label.border = BORDER_CELL
        c_val.border = BORDER_CELL
        c_label.alignment = ALIGN_LEFT
        c_val.alignment = ALIGN_RIGHT

        if label.startswith("Laba Bersih"):
            c_label.fill = FILL_TOTAL
            c_val.fill = FILL_TOTAL
            c_label.font = FONT_BODY_BOLD
            c_val.font = FONT_PROFIT_POS if value >= 0 else FONT_PROFIT_NEG
        elif is_emphasis:
            c_label.fill = FILL_SECTION
            c_val.fill = FILL_SECTION
            c_label.font = FONT_BODY_BOLD
            c_val.font = FONT_BODY_BOLD
        else:
            c_label.font = FONT_BODY
            c_val.font = FONT_BODY

        row_cursor += 1

    # Tabel B: Rekap Penjualan per Menu / Item
    section_row = row_cursor + 1
    ws.cell(row=section_row, column=1, value="Rekap Penjualan per Menu / Item").font = FONT_SECTION
    ws.row_dimensions[section_row].height = 22

    header_row = section_row + 1
    _style_header_row(
        ws,
        header_row,
        ["No", "Nama Menu / Item", "Terjual (Qty)", "Total Penjualan", "Porsi Omzet"],
        [ALIGN_CENTER, ALIGN_LEFT, ALIGN_RIGHT, ALIGN_RIGHT, ALIGN_RIGHT],
    )

    item_row = header_row + 1
    items = data["item_breakdown"]
    total_omzet = data["total_pendapatan"]

    if not items:
        ws.row_dimensions[item_row].height = 22
        ws.merge_cells(start_row=item_row, start_column=1, end_row=item_row, end_column=5)
        empty_cell = ws.cell(
            row=item_row,
            column=1,
            value="Belum ada item terjual (PAID) pada tanggal ini.",
        )
        empty_cell.font = FONT_EMPTY
        empty_cell.alignment = ALIGN_CENTER
        for c in range(1, 6):
            ws.cell(row=item_row, column=c).border = BORDER_CELL
        item_row += 1
    else:
        for idx, item in enumerate(items, start=1):
            ws.row_dimensions[item_row].height = 20
            porsi = (item["total"] / total_omzet) if total_omzet > 0 else 0.0
            vals = [idx, _sanitize_excel_text(item["nama_item"]), item["qty"], item["total"], porsi]
            fmts = [INT_FORMAT, None, INT_FORMAT, CURRENCY_FORMAT, PERCENT_FORMAT]
            aligns = [ALIGN_CENTER, ALIGN_LEFT, ALIGN_RIGHT, ALIGN_RIGHT, ALIGN_RIGHT]

            for col_i, (v, fmt, align) in enumerate(zip(vals, fmts, aligns), start=1):
                cell = ws.cell(row=item_row, column=col_i, value=v)
                cell.font = FONT_BODY
                cell.border = BORDER_CELL
                cell.alignment = align
                if fmt:
                    cell.number_format = fmt
            item_row += 1

    # Baris Total Tabel B
    ws.row_dimensions[item_row].height = 22
    total_share = 1.0 if total_omzet > 0 and items else 0.0
    total_vals = ["Total", "", data["total_item_terjual"], total_omzet, total_share]
    total_fmts = [None, None, INT_FORMAT, CURRENCY_FORMAT, PERCENT_FORMAT]
    total_aligns = [ALIGN_LEFT, ALIGN_LEFT, ALIGN_RIGHT, ALIGN_RIGHT, ALIGN_RIGHT]
    for col_i, (v, fmt, align) in enumerate(zip(total_vals, total_fmts, total_aligns), start=1):
        cell = ws.cell(row=item_row, column=col_i, value=v)
        cell.fill = FILL_TOTAL
        cell.font = FONT_BODY_BOLD
        cell.border = BORDER_CELL
        cell.alignment = align
        if fmt:
            cell.number_format = fmt

    _autosize_columns(
        ws,
        min_widths={1: 30, 2: 26, 3: 15, 4: 18, 5: 14},
        max_widths={1: 36, 2: 36, 3: 18, 4: 22, 5: 16},
    )


def _build_transactions_sheet(ws, data: dict) -> None:
    """Bangun Sheet 2: Riwayat Transaksi lengkap (PAID dan VOID)."""
    ws.title = "Riwayat Transaksi"
    ws.freeze_panes = "A2"

    headers = [
        "No Trx",
        "Jam (WIB)",
        "Status",
        "Metode",
        "Rincian Pesanan",
        "Total",
        "Uang Diterima",
        "Kembalian",
        "Catatan",
    ]
    aligns = [
        ALIGN_CENTER,
        ALIGN_CENTER,
        ALIGN_CENTER,
        ALIGN_CENTER,
        ALIGN_LEFT,
        ALIGN_RIGHT,
        ALIGN_RIGHT,
        ALIGN_RIGHT,
        ALIGN_LEFT,
    ]
    _style_header_row(ws, 1, headers, aligns)

    row_idx = 2
    trx_list = data["transactions"]

    if not trx_list:
        ws.row_dimensions[row_idx].height = 22
        ws.merge_cells(start_row=row_idx, start_column=1, end_row=row_idx, end_column=9)
        c = ws.cell(
            row=row_idx,
            column=1,
            value="Belum ada transaksi tercatat pada tanggal ini.",
        )
        c.font = FONT_EMPTY
        c.alignment = ALIGN_CENTER
        for col_i in range(1, 10):
            ws.cell(row=row_idx, column=col_i).border = BORDER_CELL
        row_idx += 1
    else:
        for trx in trx_list:
            ws.row_dimensions[row_idx].height = 20
            is_void = trx["status"] == "VOID"
            metode = trx["metode_bayar"]

            if trx["uang_diterima"] is not None:
                uang_val = int(trx["uang_diterima"])
                kembali_val = int(trx["kembalian"] or 0)
            else:
                uang_val = "Uang Pas" if metode == "CASH" else "-"
                kembali_val = "-"

            vals = [
                f"#{trx['id_transaction']}",
                trx["jam_wib"],
                trx["status"],
                metode,
                _sanitize_excel_text(trx["ringkasan"]),
                trx["total_harga"],
                uang_val,
                kembali_val,
                _sanitize_excel_text(trx["catatan_bayar"]),
            ]
            row_aligns = [
                ALIGN_CENTER,
                ALIGN_CENTER,
                ALIGN_CENTER,
                ALIGN_CENTER,
                ALIGN_WRAP_LEFT,
                ALIGN_RIGHT,
                ALIGN_RIGHT if isinstance(uang_val, int) else ALIGN_CENTER,
                ALIGN_RIGHT if isinstance(kembali_val, int) else ALIGN_CENTER,
                ALIGN_LEFT,
            ]

            for col_i, (v, align) in enumerate(zip(vals, row_aligns), start=1):
                cell = ws.cell(row=row_idx, column=col_i, value=v)
                cell.border = BORDER_CELL
                cell.alignment = align
                cell.font = FONT_VOID if is_void else FONT_BODY
                if is_void:
                    cell.fill = FILL_VOID
                if isinstance(v, int):
                    cell.number_format = CURRENCY_FORMAT
            row_idx += 1

    # Baris Ringkasan Bawah
    ws.row_dimensions[row_idx].height = 22
    summary_map = {
        1: "Total Transaksi PAID",
        5: f"{data['jumlah_paid']} transaksi berhasil",
        6: data["total_pendapatan"],
    }
    for col_i in range(1, 10):
        cell = ws.cell(row=row_idx, column=col_i, value=summary_map.get(col_i, ""))
        cell.fill = FILL_TOTAL
        cell.font = FONT_BODY_BOLD
        cell.border = BORDER_CELL
        cell.alignment = ALIGN_RIGHT if col_i == 6 else ALIGN_LEFT
        if col_i == 6:
            cell.number_format = CURRENCY_FORMAT

    _autosize_columns(
        ws,
        min_widths={1: 11, 2: 12, 3: 10, 4: 10, 5: 32, 6: 16, 7: 16, 8: 15, 9: 20},
        max_widths={5: 48, 9: 32},
    )


def _build_details_sheet(ws, data: dict) -> None:
    """Bangun Sheet 3: Rincian per baris item terjual."""
    ws.title = "Rincian Item"
    ws.freeze_panes = "A2"

    headers = [
        "No Trx",
        "Jam (WIB)",
        "Status",
        "Metode",
        "Nama Item",
        "Harga Satuan",
        "Qty",
        "Subtotal",
    ]
    aligns = [
        ALIGN_CENTER,
        ALIGN_CENTER,
        ALIGN_CENTER,
        ALIGN_CENTER,
        ALIGN_LEFT,
        ALIGN_RIGHT,
        ALIGN_RIGHT,
        ALIGN_RIGHT,
    ]
    _style_header_row(ws, 1, headers, aligns)

    row_idx = 2
    details = data["detail_lines"]

    if not details:
        ws.row_dimensions[row_idx].height = 22
        ws.merge_cells(start_row=row_idx, start_column=1, end_row=row_idx, end_column=8)
        c = ws.cell(
            row=row_idx,
            column=1,
            value="Belum ada rincian item pada tanggal ini.",
        )
        c.font = FONT_EMPTY
        c.alignment = ALIGN_CENTER
        for col_i in range(1, 9):
            ws.cell(row=row_idx, column=col_i).border = BORDER_CELL
        row_idx += 1
    else:
        for line in details:
            ws.row_dimensions[row_idx].height = 20
            is_void = line["status"] == "VOID"
            vals = [
                f"#{line['id_transaction']}",
                line["jam_wib"],
                line["status"],
                line["metode_bayar"],
                _sanitize_excel_text(line["nama_item"]),
                line["harga_satuan"],
                line["qty"],
                line["subtotal"],
            ]
            fmts = [None, None, None, None, None, CURRENCY_FORMAT, INT_FORMAT, CURRENCY_FORMAT]
            for col_i, (v, fmt, align) in enumerate(zip(vals, fmts, aligns), start=1):
                cell = ws.cell(row=row_idx, column=col_i, value=v)
                cell.border = BORDER_CELL
                cell.alignment = align
                cell.font = FONT_VOID if is_void else FONT_BODY
                if is_void:
                    cell.fill = FILL_VOID
                if fmt:
                    cell.number_format = fmt
            row_idx += 1

    # Baris Total Bawah (Hanya PAID)
    ws.row_dimensions[row_idx].height = 22
    summary_map = {
        5: "Total Item PAID",
        7: data["total_item_terjual"],
        8: data["total_pendapatan"],
    }
    summary_fmts = {7: INT_FORMAT, 8: CURRENCY_FORMAT}
    for col_i in range(1, 9):
        cell = ws.cell(row=row_idx, column=col_i, value=summary_map.get(col_i, ""))
        cell.fill = FILL_TOTAL
        cell.font = FONT_BODY_BOLD
        cell.border = BORDER_CELL
        cell.alignment = ALIGN_RIGHT if col_i in (7, 8) else ALIGN_LEFT
        if col_i in summary_fmts:
            cell.number_format = summary_fmts[col_i]

    _autosize_columns(
        ws,
        min_widths={1: 11, 2: 12, 3: 10, 4: 10, 5: 26, 6: 16, 7: 10, 8: 16},
        max_widths={5: 40},
    )


def build_daily_report_excel(tanggal: str, db_path: str | None = None) -> bytes:
    """Bangun workbook Excel (.xlsx) laporan penjualan harian kasir-standsimple untuk tanggal tertentu."""
    data = _fetch_daily_data(tanggal, db_path=db_path)

    wb = Workbook()
    ws_summary = wb.active
    _build_ringkasan_sheet(ws_summary, data)

    ws_trx = wb.create_sheet(title="Riwayat Transaksi")
    _build_transactions_sheet(ws_trx, data)

    ws_details = wb.create_sheet(title="Rincian Item")
    _build_details_sheet(ws_details, data)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()
