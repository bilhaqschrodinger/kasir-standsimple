"""Verification & Quality Assurance runner for StandPOS."""

from __future__ import annotations

import argparse
import ast
import http.client
import io
import json
import os
import py_compile
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Callable

import openpyxl
from werkzeug.serving import make_server

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)


def _read_text(rel_path: str) -> str:
    full_path = os.path.join(ROOT_DIR, rel_path)
    with open(full_path, "r", encoding="utf-8") as fh:
        return fh.read()


def _run_subchecks(
    name: str,
    cases: list[tuple[str, Callable[[], None]]],
    threshold: float,
) -> dict:
    """Execute named boolean checks and compute a 0.0-1.0 pillar score."""
    passed_items: list[str] = []
    issues: list[dict] = []

    for label, fn in cases:
        try:
            fn()
            passed_items.append(label)
        except Exception as exc:  # noqa: BLE001 - intentional aggregation per check
            issues.append({"check": label, "message": str(exc)})

    total = len(cases)
    score = round(len(passed_items) / total, 4) if total else 1.0
    return {
        "name": name,
        "score": score,
        "passed": score >= threshold and len(issues) == 0,
        "passedCount": len(passed_items),
        "totalCount": total,
        "details": passed_items,
        "issues": issues,
    }


def _check_code_correctness(app_mod, db_mod, tmp_dir: str, threshold: float) -> dict:
    """Pillar 1: syntax compilation & end-to-end API/DB/Excel behavioral smokes."""
    client = app_mod.app.test_client()
    today = db_mod.today_wib_str()
    state: dict = {}

    def check_py_compile() -> None:
        py_files = [
            "app.py",
            "db.py",
            "excel_export.py",
            os.path.join("scripts", "verify.py"),
        ]
        for rel in py_files:
            src = os.path.join(ROOT_DIR, rel)
            cfile = os.path.join(tmp_dir, f"{os.path.basename(rel)}.pyc")
            py_compile.compile(src, cfile=cfile, doraise=True)

    def check_js_syntax() -> None:
        node_bin = shutil.which("node")
        if not node_bin:
            return
        js_path = os.path.join(ROOT_DIR, "static", "js", "pos.js")
        proc = subprocess.run(
            [node_bin, "--check", js_path],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        assert proc.returncode == 0, proc.stderr.strip() or "JS syntax check failed"

    def check_html_routes() -> None:
        for route in ("/", "/admin", "/dashboard"):
            resp = client.get(route)
            assert resp.status_code == 200, f"{route} returned {resp.status_code}"
        body = client.get("/").data
        for marker in (b"btn-export-excel", b"btn-pay-cash", b"btn-pay-qris", b"btn-pay-tf"):
            assert marker in body, f"Missing UI element {marker!r}"

    def check_menu_crud_and_validation() -> None:
        # Reject invalid payloads
        for bad_payload in (
            {},
            {"nama_menu": "   ", "harga": 5000},
            {"nama_menu": "Kopi", "harga": 0},
            {"nama_menu": "Kopi", "harga": -100},
            {"nama_menu": "Kopi", "harga": True},
            {"nama_menu": "Kopi", "harga": 15.5},
            {"nama_menu": "A" * 121, "harga": 5000},
            {"nama_menu": "Kopi", "harga": 2_000_000_000},
        ):
            r = client.post("/api/menus", json=bad_payload)
            assert r.status_code == 400, f"Expected 400 for {bad_payload}, got {r.status_code}"

        r_add = client.post("/api/menus", json={"nama_menu": "Kopi Susu Aren", "harga": 18000})
        assert r_add.status_code == 201
        menu_id = r_add.get_json()["id_menu"]

        r_upd = client.put(
            f"/api/menus/{menu_id}",
            json={"nama_menu": "Kopi Susu Gula Aren", "harga": 19000},
        )
        assert r_upd.status_code == 200
        assert r_upd.get_json()["menu"]["harga"] == 19000

        menus = client.get("/api/menus").get_json()
        assert len(menus) == 1 and menus[0]["nama_menu"] == "Kopi Susu Gula Aren"

        r_del = client.delete(f"/api/menus/{menu_id}")
        assert r_del.status_code == 200
        assert client.get("/api/menus").get_json() == []

    def check_capital_validation() -> None:
        assert client.put("/api/capital", json=[]).status_code == 400
        assert client.put("/api/capital", json={"tanggal": today, "modal": -1}).status_code == 400
        assert (
            client.put("/api/capital", json={"tanggal": "2026-02-31", "modal": 1000}).status_code
            == 400
        )
        r_ok = client.put("/api/capital", json={"tanggal": today, "modal": 100000})
        assert r_ok.status_code == 200 and r_ok.get_json()["modal"] == 100000

    def check_checkout_and_atomicity() -> None:
        # Reject bad inputs
        assert client.post("/api/checkout", json={"metode_bayar": "GOPAY", "items": []}).status_code == 400
        assert client.post("/api/checkout", json={"metode_bayar": "CASH", "items": []}).status_code == 400
        assert (
            client.post(
                "/api/checkout",
                json={
                    "metode_bayar": "CASH",
                    "uang_diterima": 5000,
                    "items": [{"nama_item": "Es Teh", "harga_satuan": 5000, "qty": 2}],
                },
            ).status_code
            == 400
        )
        assert (
            client.post(
                "/api/checkout",
                json={
                    "metode_bayar": "QRIS",
                    "catatan_bayar": "x" * 251,
                    "items": [{"nama_item": "Es Teh", "harga_satuan": 5000, "qty": 1}],
                },
            ).status_code
            == 400
        )
        # Atomic failure on bad second item must not insert header
        before_count = len(client.get(f"/api/report?date={today}").get_json()["transaksi"])
        r_partial_bad = client.post(
            "/api/checkout",
            json={
                "metode_bayar": "CASH",
                "items": [
                    {"nama_item": "Valid", "harga_satuan": 5000, "qty": 1},
                    {"nama_item": "BadQty", "harga_satuan": 5000, "qty": 0},
                ],
            },
        )
        assert r_partial_bad.status_code == 400
        after_count = len(client.get(f"/api/report?date={today}").get_json()["transaksi"])
        assert after_count == before_count, "Failed checkout inserted partial data"

        # Valid CASH, QRIS, TF
        r_cash = client.post(
            "/api/checkout",
            json={
                "metode_bayar": "CASH",
                "uang_diterima": 50000,
                "total_harga": 1,  # Must be ignored by server
                "items": [{"nama_item": "Kopi Susu Aren", "harga_satuan": 18000, "qty": 2}],
            },
        ).get_json()
        assert r_cash["ok"] and r_cash["total_harga"] == 36000 and r_cash["kembalian"] == 14000

        r_qris = client.post(
            "/api/checkout",
            json={
                "metode_bayar": "QRIS",
                "catatan_bayar": "a.n. Budi",
                "items": [
                    {"nama_item": "Kopi Susu Aren", "harga_satuan": 18000, "qty": 1},
                    {"nama_item": "Americano", "harga_satuan": 15000, "qty": 1},
                ],
            },
        ).get_json()
        assert r_qris["ok"] and r_qris["total_harga"] == 33000

        r_tf = client.post(
            "/api/checkout",
            json={
                "metode_bayar": "TF",
                "catatan_bayar": "BCA 4412",
                "items": [{"nama_item": "Matcha Latte", "harga_satuan": 22000, "qty": 1}],
            },
        ).get_json()
        assert r_tf["ok"] and r_tf["total_harga"] == 22000

        r_void_seed = client.post(
            "/api/checkout",
            json={
                "metode_bayar": "CASH",
                "items": [{"nama_item": "Americano", "harga_satuan": 15000, "qty": 2}],
            },
        ).get_json()
        assert r_void_seed["ok"]
        state["void_id"] = r_void_seed["id_transaction"]

    def check_report_detail_and_void() -> None:
        void_id = state["void_id"]
        assert client.get("/api/transactions/999999").status_code == 404
        assert client.post("/api/transactions/999999/void").status_code == 404

        det = client.get(f"/api/transactions/{void_id}")
        assert det.status_code == 200 and det.get_json()["total_harga"] == 30000

        r_void = client.post(f"/api/transactions/{void_id}/void")
        assert r_void.status_code == 200 and r_void.get_json()["status"] == "VOID"

        rep = client.get(f"/api/report?date={today}").get_json()
        assert rep["jumlah_transaksi"] == 3
        assert rep["total_pendapatan"] == 91000
        assert rep["total_cash"] == 36000
        assert rep["total_qris"] == 33000
        assert rep["total_tf"] == 22000
        assert rep["modal_awal"] == 100000
        assert rep["laba_bersih"] == -9000
        assert len(rep["transaksi"]) == 4

    def check_excel_export() -> None:
        resp = client.get(f"/api/export/excel?date={today}")
        assert resp.status_code == 200
        assert "spreadsheetml.sheet" in resp.headers.get("Content-Type", "")
        assert f"StandPOS_Laporan_{today}.xlsx" in resp.headers.get("Content-Disposition", "")

        wb = openpyxl.load_workbook(io.BytesIO(resp.data))
        assert wb.sheetnames == ["Ringkasan", "Riwayat Transaksi", "Rincian Item"]

        ws_sum = wb["Ringkasan"]
        metrics = {
            ws_sum.cell(row=r, column=1).value: ws_sum.cell(row=r, column=2).value
            for r in range(7, 17)
        }
        assert metrics["Transaksi Berhasil (PAID)"] == 3
        assert metrics["Transaksi Dibatalkan (VOID)"] == 1
        assert metrics["Total Item / Cup Terjual"] == 5
        assert metrics["Total Omzet Kotor"] == 91000
        assert metrics["Modal Harian"] == 100000
        assert metrics["Laba Bersih (Omzet - Modal)"] == -9000

        ws_trx = wb["Riwayat Transaksi"]
        assert ws_trx.max_row == 6
        assert ws_trx.cell(row=5, column=3).value == "VOID"
        assert ws_trx.cell(row=5, column=6).font.strike is True
        assert ws_trx.cell(row=6, column=6).value == 91000

        ws_det = wb["Rincian Item"]
        assert ws_det.max_row == 7
        assert ws_det.cell(row=7, column=7).value == 5
        assert ws_det.cell(row=7, column=8).value == 91000

        assert client.get("/api/export/excel?date=2099-01-01").status_code == 200
        assert client.get("/api/export/excel?date=2026-02-31").status_code == 400

    return _run_subchecks(
        "code-correctness",
        [
            ("Python syntax compilation", check_py_compile),
            ("JavaScript syntax check", check_js_syntax),
            ("HTML routes & controls", check_html_routes),
            ("Menu CRUD & validation", check_menu_crud_and_validation),
            ("Capital input & date validation", check_capital_validation),
            ("Checkout calculation & atomicity", check_checkout_and_atomicity),
            ("Report metrics, detail & VOID", check_report_detail_and_void),
            ("Excel export 3 sheets & edge dates", check_excel_export),
        ],
        threshold,
    )


def _check_security(app_mod, threshold: float) -> dict:
    """Pillar 2: Excel formula injection protection, HTTP security headers & static hygiene."""
    client = app_mod.app.test_client()
    inj_date = "2026-11-10"

    def check_excel_formula_injection() -> None:
        r = client.post(
            "/api/checkout",
            json={
                "metode_bayar": "QRIS",
                "catatan_bayar": "+CMD|' /C calc'!A0",
                "items": [
                    {"nama_item": "=1+1", "harga_satuan": 5000, "qty": 1},
                    {"nama_item": "@SUM(1,2)", "harga_satuan": 3000, "qty": 1},
                ],
            },
        )
        assert r.status_code == 200
        tid = r.get_json()["id_transaction"]
        # Move transaction onto isolated date so Sheet 1/2/3 assertions stay deterministic
        conn = app_mod.get_connection()
        try:
            with conn:
                conn.execute(
                    "UPDATE transactions SET waktu = ? WHERE id_transaction = ?",
                    (f"{inj_date}T12:00:00", tid),
                )
        finally:
            conn.close()

        resp = client.get(f"/api/export/excel?date={inj_date}")
        assert resp.status_code == 200
        wb = openpyxl.load_workbook(io.BytesIO(resp.data))

        ws_sum = wb["Ringkasan"]
        assert str(ws_sum.cell(row=20, column=2).value).startswith("'")
        assert str(ws_sum.cell(row=21, column=2).value).startswith("'")

        ws_trx = wb["Riwayat Transaksi"]
        assert str(ws_trx.cell(row=2, column=5).value).startswith("'")
        assert str(ws_trx.cell(row=2, column=9).value).startswith("'")

        ws_det = wb["Rincian Item"]
        assert str(ws_det.cell(row=2, column=5).value).startswith("'")
        assert str(ws_det.cell(row=3, column=5).value).startswith("'")

    def check_security_headers() -> None:
        for route in ("/", "/api/report"):
            headers = client.get(route).headers
            assert headers.get("X-Content-Type-Options") == "nosniff"
            assert headers.get("X-Frame-Options") == "SAMEORIGIN"
            assert headers.get("Referrer-Policy") == "same-origin"
            assert headers.get("Strict-Transport-Security") == "max-age=31536000"
            assert "geolocation=()" in headers.get("Permissions-Policy", "")
            assert headers.get("X-XSS-Protection") == "1; mode=block"
            assert "no-store" in headers.get("Cache-Control", "")

            csp = headers.get("Content-Security-Policy", "")
            assert "default-src 'self'" in csp, "CSP missing default-src 'self'"
            script_match = re.search(r"script-src\s+([^;]+)", csp)
            assert script_match is not None, "CSP missing script-src"
            script_src = script_match.group(1)
            assert "'unsafe-inline'" not in script_src, "CSP script-src must not allow 'unsafe-inline'"
            assert "'unsafe-eval'" not in script_src, "CSP script-src must not allow 'unsafe-eval'"

    def check_no_inline_scripts() -> None:
        html_text = _read_text(os.path.join("templates", "pos.html"))
        for match in re.finditer(
            r"<script\b([^>]*)>(.*?)</script>", html_text, re.IGNORECASE | re.DOTALL
        ):
            attrs, body = match.group(1), match.group(2).strip()
            assert re.search(r"\bsrc\s*=", attrs, re.IGNORECASE) and not body, (
                "Inline <script> block detected in templates/pos.html"
            )

    def check_no_server_banner() -> None:
        srv = make_server(
            "127.0.0.1",
            0,
            app_mod.app,
            request_handler=app_mod.NoBannerRequestHandler,
        )
        thread = threading.Thread(target=srv.serve_forever, daemon=True)
        thread.start()
        try:
            http_conn = http.client.HTTPConnection("127.0.0.1", srv.server_port, timeout=5)
            http_conn.request("GET", "/")
            resp = http_conn.getresponse()
            resp.read()
            headers_lower = {k.lower(): v for k, v in resp.getheaders()}
            assert resp.status == 200, f"Expected 200 from live probe, got {resp.status}"
            assert "server" not in headers_lower, (
                f"Server banner leaked: {headers_lower.get('server')}"
            )
            http_conn.close()
        finally:
            srv.shutdown()
            srv.server_close()
            thread.join(timeout=2)

    def check_static_js_xss_patterns() -> None:
        js_text = _read_text(os.path.join("static", "js", "pos.js"))
        for idx, line in enumerate(js_text.splitlines(), start=1):
            if "innerHTML" in line and not re.search(r"innerHTML\s*=\s*''\s*;", line):
                raise AssertionError(f"Unsafe innerHTML assignment at pos.js:{idx}")
            if re.search(r"\b(eval|document\.write)\s*\(", line):
                raise AssertionError(f"Unsafe sink at pos.js:{idx}")

    def check_no_secrets_or_personal_paths() -> None:
        files_to_scan = [
            "app.py",
            "db.py",
            "excel_export.py",
            "README.md",
            "run.bat",
            "share.bat",
            "run.sh",
            os.path.join("templates", "pos.html"),
            os.path.join("static", "js", "pos.js"),
        ]
        secret_rx = re.compile(r"(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})")
        user_path_rx = re.compile(r"C:\\Users\\", re.IGNORECASE)
        for rel in files_to_scan:
            text = _read_text(rel)
            assert not user_path_rx.search(text), f"Hardcoded Windows user path in {rel}"
            assert not secret_rx.search(text), f"Potential secret token in {rel}"

        gitignore_text = _read_text(".gitignore")
        assert "standpos.db" in gitignore_text and "*.db" in gitignore_text

    return _run_subchecks(
        "security",
        [
            ("Excel formula injection sanitization", check_excel_formula_injection),
            ("HTTP security & cache headers", check_security_headers),
            ("No inline scripts in HTML templates", check_no_inline_scripts),
            ("No Werkzeug Server banner in HTTP responses", check_no_server_banner),
            ("Frontend static XSS audit", check_static_js_xss_patterns),
            ("No personal paths, secrets & DB gitignored", check_no_secrets_or_personal_paths),
        ],
        threshold,
    )


def _check_performance(app_mod, db_mod, threshold: float) -> dict:
    """Pillar 3: SQLite WAL mode, table indexes & batch checkout/export latency."""
    client = app_mod.app.test_client()
    bench_date = "2026-11-12"

    def check_sqlite_wal_and_indexes() -> None:
        conn = db_mod.get_connection()
        try:
            mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
            assert str(mode).lower() == "wal", f"Expected WAL journal_mode, got {mode}"
            indexes = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'index'"
                ).fetchall()
            }
            assert "idx_trx_waktu" in indexes, "Missing index idx_trx_waktu"
            assert "idx_detail_trx" in indexes, "Missing index idx_detail_trx"
        finally:
            conn.close()

    def check_batch_throughput() -> None:
        start = time.perf_counter()
        created_ids = []
        for i in range(50):
            r = client.post(
                "/api/checkout",
                json={
                    "metode_bayar": "CASH" if i % 2 == 0 else "QRIS",
                    "items": [{"nama_item": f"Menu {i % 5}", "harga_satuan": 12000, "qty": 2}],
                },
            )
            assert r.status_code == 200
            created_ids.append(r.get_json()["id_transaction"])

        conn = db_mod.get_connection()
        try:
            with conn:
                placeholders = ",".join("?" for _ in created_ids)
                conn.execute(
                    f"UPDATE transactions SET waktu = ? WHERE id_transaction IN ({placeholders})",
                    [f"{bench_date}T10:00:00", *created_ids],
                )
        finally:
            conn.close()

        rep = client.get(f"/api/report?date={bench_date}")
        assert rep.status_code == 200 and rep.get_json()["jumlah_transaksi"] == 50

        xlsx = client.get(f"/api/export/excel?date={bench_date}")
        assert xlsx.status_code == 200 and len(xlsx.data) > 0

        elapsed = time.perf_counter() - start
        assert elapsed < 3.0, f"50-trx batch + report + Excel took {elapsed:.2f}s (>= 3.0s)"

    return _run_subchecks(
        "performance",
        [
            ("SQLite WAL mode & query indexes", check_sqlite_wal_and_indexes),
            ("50-order checkout + report + Excel < 3.0s", check_batch_throughput),
        ],
        threshold,
    )


def _check_best_practices(threshold: float) -> dict:
    """Pillar 4: clean modular architecture, AST exception hygiene & universal launchers."""

    def check_module_layout() -> None:
        required = [
            "app.py",
            "db.py",
            "excel_export.py",
            "requirements.txt",
            "run.bat",
            "share.bat",
            "run.sh",
            os.path.join("templates", "pos.html"),
            os.path.join("static", "js", "pos.js"),
        ]
        for rel in required:
            assert os.path.isfile(os.path.join(ROOT_DIR, rel)), f"Missing {rel}"

    def check_no_bare_except() -> None:
        for rel in (
            "app.py",
            "db.py",
            "excel_export.py",
            os.path.join("scripts", "verify.py"),
        ):
            tree = ast.parse(_read_text(rel), filename=rel)
            for node in ast.walk(tree):
                if isinstance(node, ast.ExceptHandler) and node.type is None:
                    raise AssertionError(f"Bare except clause in {rel}:{node.lineno}")

    def check_dependencies_declared() -> None:
        reqs = _read_text("requirements.txt").lower()
        assert "flask" in reqs, "flask missing from requirements.txt"
        assert "openpyxl" in reqs, "openpyxl missing from requirements.txt"

    return _run_subchecks(
        "best-practices",
        [
            ("Modular project layout & launchers", check_module_layout),
            ("No bare except clauses in Python", check_no_bare_except),
            ("Runtime dependencies declared", check_dependencies_declared),
        ],
        threshold,
    )


def _check_documentation(threshold: float) -> dict:
    """Pillar 5: README accuracy, MIT LICENSE & .gitignore completeness."""

    def check_required_docs() -> None:
        for rel in ("README.md", "LICENSE", ".gitignore"):
            content = _read_text(rel).strip()
            assert len(content) > 20, f"{rel} is unexpectedly short"
        assert "MIT License" in _read_text("LICENSE")

    def check_readme_coverage() -> None:
        readme = _read_text("README.md")
        for token in ("run.bat", "pip install -r requirements.txt", "Export", "SQLite", "verify.py"):
            assert token in readme, f"README.md missing documentation for '{token}'"

    return _run_subchecks(
        "documentation",
        [
            ("README.md, LICENSE (MIT) & .gitignore present", check_required_docs),
            ("README documents setup, Excel export & verify", check_readme_coverage),
        ],
        threshold,
    )


def run_verification(threshold: float) -> dict:
    """Run all five QA verification pillars inside an isolated temporary database."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_db = os.path.join(tmp_dir, "verify_standpos.db")
        os.environ["STANDPOS_DB_PATH"] = tmp_db

        import db as db_mod

        db_mod.DB_PATH = tmp_db
        db_mod.init_db(tmp_db)
        import app as app_mod

        checks = [
            _check_code_correctness(app_mod, db_mod, tmp_dir, threshold),
            _check_security(app_mod, threshold),
            _check_performance(app_mod, db_mod, threshold),
            _check_best_practices(threshold),
            _check_documentation(threshold),
        ]

    overall_score = round(sum(c["score"] for c in checks) / len(checks), 4)
    passed = overall_score >= threshold and all(c["passed"] for c in checks)

    return {
        "overallScore": overall_score,
        "passed": passed,
        "threshold": threshold,
        "checks": checks,
    }


def _print_table(report: dict) -> None:
    status_label = "PASSED" if report["passed"] else "FAILED"
    print("StandPOS Verification & Quality Assurance")
    print("=" * 56)
    print(
        f"Overall Score : {report['overallScore']:.4f} "
        f"(Threshold: {report['threshold']:.2f}) [{status_label}]"
    )
    print("-" * 56)
    for chk in report["checks"]:
        badge = "PASS" if chk["passed"] else "FAIL"
        print(
            f"[{badge}] {chk['name']:<20} "
            f"score={chk['score']:.2f} ({chk['passedCount']}/{chk['totalCount']})"
        )
        for issue in chk["issues"]:
            print(f"       - {issue['check']}: {issue['message']}")
    print("=" * 56)


def main() -> int:
    parser = argparse.ArgumentParser(description="StandPOS Verification & QA Suite")
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.95,
        help="Minimum passing score between 0.0 and 1.0 (default: 0.95)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print structured JSON verification output",
    )
    parser.add_argument(
        "--export",
        type=str,
        default="",
        help="Optional path to save the JSON verification report",
    )
    args = parser.parse_args()

    if not 0.0 <= args.threshold <= 1.0:
        print("Error: --threshold must be between 0.0 and 1.0", file=sys.stderr)
        return 2

    try:
        report = run_verification(args.threshold)
    except Exception as exc:  # noqa: BLE001 - standardized exit code 2 on runner error
        print(f"Verification error: {exc}", file=sys.stderr)
        return 2

    if args.export:
        export_dir = os.path.dirname(os.path.abspath(args.export))
        if export_dir:
            os.makedirs(export_dir, exist_ok=True)
        with open(args.export, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        _print_table(report)

    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
