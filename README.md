# kasir-standsimple

Aplikasi kasir web ringan, gratis, dan *offline-first* untuk stand makanan/minuman, booth kopi, atau bazaar sementara. Dirancang tampil dalam **satu layar kerja** tanpa login rumit dan tanpa biaya langganan bulanan.

---

## Kenapa kasir-standsimple?

- **Satu layar untuk semua:** Input pesanan, tombol menu cepat, ringkasan omzet, modal harian, hingga riwayat transaksi langsung terlihat di satu halaman utama.
- **Berjalan lokal & offline-first:** Semua data tersimpan di file SQLite (`standpos.db`) yang otomatis dibuat saat aplikasi pertama kali dijalankan.
- **Setup minimal:** Tidak butuh database server terpisah (MySQL/PostgreSQL). Cukup Python 3.10+.
- **Siap rekap ke Excel:** Ekspor laporan harian rapi berbentuk file `.xlsx` asli (3 sheet siap cetak/kirim ke partner).

---

## Fitur Utama

- **Tombol Menu Cepat & Input Manual Fleksibel**
  - Simpan daftar menu tetap agar muncul sebagai tombol cepat di layar kasir.
  - Ketik item manual + harga satuan dan bisa langsung dibayar tanpa wajib menyimpannya ke daftar menu.
- **3 Metode Pembayaran (Cash, QRIS, Transfer)**
  - **Cash:** Dilengkapi pilihan nominal cepat dan hitung kembalian otomatis.
  - **QRIS & Transfer:** Konfirmasi manual disertai kolom catatan opsional (misalnya nama pengirim atau 4 digit referensi mutasi).
- **Pantau Modal & Laba Bersih Real-Time**
  - Catat modal harian langsung di bar atas untuk menghitung otomatis selisih laba bersih (`Total omzet - Modal`).
  - Data transaksi masuk, rincian per metode bayar, dan tabel riwayat tersinkron otomatis tiap 5 detik (WIB / `Asia/Jakarta`).
- **Rincian & Pembatalan (Void)**
  - Klik baris transaksi untuk melihat detail item, lalu tandai `Void` jika terjadi salah input—nominalnya langsung dikeluarkan dari omzet tanpa menghapus histori.
- **Export Laporan Excel (`.xlsx`) per Tanggal**
  - Menghasilkan file `kasir-standsimple_laporan_YYYY-MM-DD.xlsx` berisi 3 sheet:
    1. **Ringkasan:** Jumlah transaksi `PAID`/`VOID`, total cup/item terjual, total omzet, Cash/QRIS/Transfer, modal harian, laba bersih, dan rekap penjualan per menu.
    2. **Riwayat Transaksi:** Daftar seluruh transaksi lengkap dengan status, kembalian, dan catatan (baris `VOID` ditandai coret).
    3. **Rincian Item:** Pecahan setiap baris item terjual per transaksi.

---

## Cara Menjalankan

### Opsi 1: Windows (Klik 2x)
1. Pastikan [Python 3.10+](https://www.python.org/downloads/) sudah terpasang (centang **"Add Python to PATH"** saat instalasi).
2. Klik 2x file **`run.bat`** — script akan otomatis membuat `.venv`, menginstal dependensi, dan menyalakan server.
3. Buka browser dan kunjungi: **http://localhost:5000**

### Opsi 2: macOS / Linux
```bash
chmod +x run.sh
./run.sh
```
Lalu buka **http://localhost:5000** di browser.

### Opsi 3: Manual (Semua OS)
```bash
pip install -r requirements.txt
python app.py
```

---

## Akses dari HP atau Perangkat Lain

- **Satu Wi-Fi / Hotspot yang sama:**
  Server mendengarkan di `0.0.0.0:5000`. Saat aplikasi berjalan, cek alamat IP lokal laptop (misal `http://192.168.1.10:5000` yang tercetak di terminal) lalu buka alamat tersebut di browser HP.
- **Beda jaringan (Link Publik Sementara di Windows):**
  Klik 2x **`share.bat`** untuk menyalakan server sekaligus membuka *tunnel* sementara melalui `localhost.run` (memerlukan OpenSSH Client bawaan Windows dan koneksi internet).

---

## Struktur Proyek

```text
kasir-standsimple/
├── app.py               # Server Flask & REST API JSON
├── db.py                # Koneksi SQLite, helper waktu WIB & skema tabel
├── excel_export.py      # Generator laporan Excel (.xlsx) 3 sheet
├── requirements.txt     # Dependensi Python (Flask, openpyxl)
├── run.bat              # Launcher otomatis untuk Windows
├── run.sh               # Launcher otomatis untuk macOS/Linux
├── share.bat            # Launcher + tunnel publik sementara (Windows)
├── scripts/
│   └── verify.py        # Pengujian otomatis & audit QA (threshold 0.95)
├── templates/
│   └── pos.html         # Antarmuka kasir & laporan terpadu
└── static/
    └── js/
        └── pos.js       # Logika keranjang, checkout, polling & export
```

---

## Verifikasi & Kualitas Kode

Jalankan suite verifikasi otomatis (mencakup uji fungsi API/SQLite/Excel, keamanan input & header HTTP, performa WAL + indeks, praktik terbaik kode, dan kelengkapan dokumentasi):

```bash
python scripts/verify.py
python scripts/verify.py --json --threshold 0.95
```

---

## Teknologi yang Digunakan

- **Backend:** Python, Flask
- **Database:** SQLite (`standpos.db`, dibuat otomatis)
- **Frontend:** HTML5, Vanilla JavaScript, Tailwind CSS (CDN)
- **Export Excel:** `openpyxl`

---

## Kontribusi & Lisensi

Kontribusi (*issue* maupun *pull request*) sangat terbuka untuk pengembangan fitur tambahan yang tetap menjaga aplikasi ini sederhana dan cepat dipakai di lapangan.

Proyek ini dirilis gratis di bawah lisensi **[MIT License](LICENSE)** — bebas dipakai, dimodifikasi, dan dibagikan untuk kebutuhan usaha stand maupun pembelajaran.
