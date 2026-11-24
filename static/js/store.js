// kasir-standsimple — Penyimpanan Privat Lokal di Perangkat (IndexedDB + Fallback localStorage)
(function (global) {
  'use strict';

  const DB_NAME = 'kasir_standsimple_db';
  const DB_VERSION = 1;
  const FALLBACK_KEY = 'kasir_standsimple_fallback_v1';

  const MAX_NAME_LEN = 120;
  const MAX_NOTE_LEN = 250;
  const MAX_ITEMS_PER_ORDER = 200;
  const MAX_MONEY_VALUE = 1000000000;

  let dbPromise = null;

  function _wibDate(nowMs) {
    const ms = typeof nowMs === 'number' ? nowMs : Date.now();
    return new Date(ms + 7 * 60 * 60 * 1000);
  }

  function nowWibIso() {
    const d = _wibDate();
    return d.toISOString().slice(0, 19);
  }

  function todayWibStr() {
    const d = _wibDate();
    return d.toISOString().slice(0, 10);
  }

  function _formatJamWib(isoStr) {
    if (!isoStr) return '-';
    const parts = String(isoStr).split('T');
    return parts.length === 2 ? parts[1].slice(0, 8) : String(isoStr);
  }

  function _parseBoundedInt(val, minValue) {
    if (typeof val === 'boolean' || val === null || val === undefined) return null;
    let n = null;
    if (typeof val === 'number') {
      if (Number.isInteger(val)) n = val;
    } else if (typeof val === 'string') {
      const s = val.trim();
      if (/^\d+$/.test(s)) n = parseInt(s, 10);
    }
    if (n === null || n < minValue || n > MAX_MONEY_VALUE) return null;
    return n;
  }

  function _validateIsoDate(rawVal) {
    const str = rawVal ? String(rawVal).trim() : '';
    if (!str || str === 'undefined' || str === 'null') return todayWibStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      throw new Error('Format tanggal harus YYYY-MM-DD.');
    }
    const [y, m, d] = str.split('-').map((x) => parseInt(x, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() + 1 !== m ||
      dt.getUTCDate() !== d
    ) {
      throw new Error('Tanggal kalender tidak valid.');
    }
    return str;
  }

  // -------------------------------------------------------------------------
  // Lapisan Penyimpanan: IndexedDB (utama) + localStorage (fallback)
  // -------------------------------------------------------------------------
  function _readFallbackState() {
    try {
      const raw = global.localStorage.getItem(FALLBACK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (_) {}
    return {
      seq: { menus: 0, transactions: 0, transaction_details: 0 },
      menus: [],
      transactions: [],
      transaction_details: [],
      daily_capital: [],
    };
  }

  function _writeFallbackState(state) {
    global.localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
  }

  function _openIdb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB tidak tersedia'));
        return;
      }
      const req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('menus')) {
          db.createObjectStore('menus', { keyPath: 'id_menu', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('transactions')) {
          const trxStore = db.createObjectStore('transactions', {
            keyPath: 'id_transaction',
            autoIncrement: true,
          });
          trxStore.createIndex('waktu', 'waktu', { unique: false });
        }
        if (!db.objectStoreNames.contains('transaction_details')) {
          const detStore = db.createObjectStore('transaction_details', {
            keyPath: 'id_detail',
            autoIncrement: true,
          });
          detStore.createIndex('id_transaction', 'id_transaction', { unique: false });
        }
        if (!db.objectStoreNames.contains('daily_capital')) {
          db.createObjectStore('daily_capital', { keyPath: 'tanggal' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Gagal membuka IndexedDB'));
    });
    return dbPromise;
  }

  async function _withIdb(storeNames, mode, fn) {
    try {
      const db = await _openIdb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('Transaksi database gagal'));
        tx.onabort = () => reject(tx.error || new Error('Transaksi database dibatalkan'));
        Promise.resolve(fn(tx))
          .then((val) => {
            result = val;
          })
          .catch((err) => {
            try {
              tx.abort();
            } catch (_) {}
            reject(err);
          });
      });
    } catch (_) {
      return null; // Fallback ditangani pemanggil
    }
  }

  function _reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // -------------------------------------------------------------------------
  // Operasi Menu
  // -------------------------------------------------------------------------
  async function getMenus() {
    const idbRes = await _withIdb(['menus'], 'readonly', async (tx) => {
      const all = await _reqToPromise(tx.objectStore('menus').getAll());
      return all
        .filter((m) => m.aktif === 1)
        .sort((a, b) => a.id_menu - b.id_menu);
    });
    if (idbRes !== null) return idbRes;

    const st = _readFallbackState();
    return st.menus
      .filter((m) => m.aktif === 1)
      .sort((a, b) => a.id_menu - b.id_menu);
  }

  async function createMenu(nama_menu, harga) {
    const cleanName = String(nama_menu || '').trim();
    if (!cleanName) throw new Error('Isi nama menu terlebih dahulu.');
    if (cleanName.length > MAX_NAME_LEN) {
      throw new Error(`Nama menu maksimal ${MAX_NAME_LEN} karakter.`);
    }
    const cleanPrice = _parseBoundedInt(harga, 1);
    if (cleanPrice === null) {
      throw new Error('Harga harus berupa angka bulat lebih dari 0.');
    }

    const row = { nama_menu: cleanName, harga: cleanPrice, aktif: 1 };
    const idbRes = await _withIdb(['menus'], 'readwrite', async (tx) => {
      const newId = await _reqToPromise(tx.objectStore('menus').add(row));
      return { id_menu: newId, ...row };
    });
    if (idbRes !== null) return idbRes;

    const st = _readFallbackState();
    st.seq.menus += 1;
    const saved = { id_menu: st.seq.menus, ...row };
    st.menus.push(saved);
    _writeFallbackState(st);
    return saved;
  }

  async function deleteMenu(id_menu) {
    const id = _parseBoundedInt(id_menu, 1);
    if (id === null) throw new Error('ID menu tidak valid.');

    const idbRes = await _withIdb(['menus'], 'readwrite', async (tx) => {
      const store = tx.objectStore('menus');
      const existing = await _reqToPromise(store.get(id));
      if (!existing) return false;
      existing.aktif = 0;
      await _reqToPromise(store.put(existing));
      return true;
    });
    if (idbRes !== null) return idbRes;

    const st = _readFallbackState();
    const target = st.menus.find((m) => m.id_menu === id);
    if (!target) return false;
    target.aktif = 0;
    _writeFallbackState(st);
    return true;
  }

  // -------------------------------------------------------------------------
  // Modal Harian
  // -------------------------------------------------------------------------
  async function setCapital(tanggalInput, modalInput) {
    const tanggal = _validateIsoDate(tanggalInput);
    const modal = _parseBoundedInt(modalInput, 0);
    if (modal === null) {
      throw new Error('Nominal modal harus berupa angka bulat >= 0.');
    }

    const row = { tanggal, modal };
    const idbRes = await _withIdb(['daily_capital'], 'readwrite', async (tx) => {
      await _reqToPromise(tx.objectStore('daily_capital').put(row));
      return row;
    });
    if (idbRes !== null) return idbRes;

    const st = _readFallbackState();
    const idx = st.daily_capital.findIndex((c) => c.tanggal === tanggal);
    if (idx >= 0) st.daily_capital[idx] = row;
    else st.daily_capital.push(row);
    _writeFallbackState(st);
    return row;
  }

  // -------------------------------------------------------------------------
  // Checkout & Pembayaran
  // -------------------------------------------------------------------------
  async function checkout({ metode_bayar, catatan_bayar = null, uang_diterima = null, items = [] }) {
    const metode = String(metode_bayar || '').trim().toUpperCase();
    if (!['CASH', 'QRIS', 'TF'].includes(metode)) {
      throw new Error('Pilih metode pembayaran CASH, QRIS, atau TF.');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Pesanan masih kosong.');
    }
    if (items.length > MAX_ITEMS_PER_ORDER) {
      throw new Error(`Maksimal ${MAX_ITEMS_PER_ORDER} item dalam satu transaksi.`);
    }

    let total_harga = 0;
    const validatedItems = [];
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i] || {};
      const nama_item = String(it.nama_item || '').trim();
      if (!nama_item) throw new Error(`Nama item ke-${i + 1} kosong.`);
      if (nama_item.length > MAX_NAME_LEN) {
        throw new Error(`Nama item ke-${i + 1} maksimal ${MAX_NAME_LEN} karakter.`);
      }
      const harga_satuan = _parseBoundedInt(it.harga_satuan, 1);
      if (harga_satuan === null) {
        throw new Error(`Harga '${nama_item}' harus angka bulat lebih dari 0.`);
      }
      const qty = _parseBoundedInt(it.qty, 1);
      if (qty === null) {
        throw new Error(`Jumlah '${nama_item}' harus angka bulat lebih dari 0.`);
      }
      total_harga += harga_satuan * qty;
      validatedItems.push({ nama_item, harga_satuan, qty });
    }

    const catatan =
      catatan_bayar !== null && catatan_bayar !== undefined && String(catatan_bayar).trim() !== ''
        ? String(catatan_bayar).trim()
        : null;
    if (catatan && catatan.length > MAX_NOTE_LEN) {
      throw new Error(`Catatan pembayaran maksimal ${MAX_NOTE_LEN} karakter.`);
    }

    let uangDiterimaFinal = null;
    let kembalianFinal = null;
    if (metode === 'CASH' && uang_diterima !== null && uang_diterima !== undefined && String(uang_diterima).trim() !== '') {
      const parsedUang = _parseBoundedInt(uang_diterima, 0);
      if (parsedUang === null) {
        throw new Error('Nominal uang diterima harus berupa angka bulat.');
      }
      if (parsedUang < total_harga) {
        throw new Error('Uang diterima kurang dari total tagihan.');
      }
      uangDiterimaFinal = parsedUang;
      kembalianFinal = parsedUang - total_harga;
    }

    const waktu = nowWibIso();
    const headerRow = {
      waktu,
      total_harga,
      metode_bayar: metode,
      status: 'PAID',
      status_bayar: 'PAID',
      catatan_bayar: catatan,
      uang_diterima: uangDiterimaFinal,
      kembalian: kembalianFinal,
    };

    const idbRes = await _withIdb(['transactions', 'transaction_details'], 'readwrite', async (tx) => {
      const trxStore = tx.objectStore('transactions');
      const detStore = tx.objectStore('transaction_details');
      const id_transaction = await _reqToPromise(trxStore.add(headerRow));
      for (const item of validatedItems) {
        await _reqToPromise(
          detStore.add({
            id_transaction,
            nama_item: item.nama_item,
            harga_satuan: item.harga_satuan,
            qty: item.qty,
          })
        );
      }
      return {
        ok: true,
        id_transaction,
        total_harga,
        kembalian: kembalianFinal,
        waktu,
      };
    });
    if (idbRes !== null) return idbRes;

    const st = _readFallbackState();
    st.seq.transactions += 1;
    const id_transaction = st.seq.transactions;
    st.transactions.push({ id_transaction, ...headerRow });
    for (const item of validatedItems) {
      st.seq.transaction_details += 1;
      st.transaction_details.push({
        id_detail: st.seq.transaction_details,
        id_transaction,
        nama_item: item.nama_item,
        harga_satuan: item.harga_satuan,
        qty: item.qty,
      });
    }
    _writeFallbackState(st);
    return {
      ok: true,
      id_transaction,
      total_harga,
      kembalian: kembalianFinal,
      waktu,
    };
  }

  // -------------------------------------------------------------------------
  // Laporan, Detail & Void
  // -------------------------------------------------------------------------
  async function _loadRawSnapshot() {
    const idbRes = await _withIdb(
      ['menus', 'transactions', 'transaction_details', 'daily_capital'],
      'readonly',
      async (tx) => {
        const [menus, transactions, transaction_details, daily_capital] = await Promise.all([
          _reqToPromise(tx.objectStore('menus').getAll()),
          _reqToPromise(tx.objectStore('transactions').getAll()),
          _reqToPromise(tx.objectStore('transaction_details').getAll()),
          _reqToPromise(tx.objectStore('daily_capital').getAll()),
        ]);
        return { menus, transactions, transaction_details, daily_capital };
      }
    );
    if (idbRes !== null) return idbRes;
    return _readFallbackState();
  }

  async function getReport(tanggalInput) {
    const tanggal = _validateIsoDate(tanggalInput);
    const snap = await _loadRawSnapshot();

    const capRow = snap.daily_capital.find((c) => c.tanggal === tanggal);
    const modal_awal = capRow ? Number(capRow.modal) : 0;

    const dayTrx = snap.transactions
      .filter((t) => String(t.waktu || '').slice(0, 10) === tanggal)
      .sort((a, b) => {
        if (a.waktu !== b.waktu) return b.waktu.localeCompare(a.waktu);
        return b.id_transaction - a.id_transaction;
      });

    const detailsByTrx = {};
    for (const d of snap.transaction_details) {
      if (!detailsByTrx[d.id_transaction]) detailsByTrx[d.id_transaction] = [];
      detailsByTrx[d.id_transaction].push(d);
    }

    let total_pendapatan = 0;
    let total_cash = 0;
    let total_qris = 0;
    let total_tf = 0;
    let jumlah_transaksi = 0;

    const transaksi = dayTrx.map((r) => {
      const dets = (detailsByTrx[r.id_transaction] || []).sort((a, b) => a.id_detail - b.id_detail);
      if (r.status === 'PAID') {
        total_pendapatan += r.total_harga;
        jumlah_transaksi += 1;
        if (r.metode_bayar === 'CASH') total_cash += r.total_harga;
        else if (r.metode_bayar === 'QRIS') total_qris += r.total_harga;
        else if (r.metode_bayar === 'TF') total_tf += r.total_harga;
      }
      return {
        id_transaction: r.id_transaction,
        waktu: r.waktu,
        total_harga: r.total_harga,
        metode_bayar: r.metode_bayar,
        status: r.status,
        catatan_bayar: r.catatan_bayar || null,
        uang_diterima: r.uang_diterima !== undefined ? r.uang_diterima : null,
        kembalian: r.kembalian !== undefined ? r.kembalian : null,
        ringkasan: dets.map((d) => `${d.nama_item} x${d.qty}`).join(', '),
      };
    });

    return {
      tanggal,
      modal_awal,
      total_pendapatan,
      laba_bersih: total_pendapatan - modal_awal,
      total_cash,
      total_qris,
      total_tf,
      jumlah_transaksi,
      transaksi,
    };
  }

  async function getTransactionDetail(id_transaction) {
    const id = _parseBoundedInt(id_transaction, 1);
    if (id === null) return null;

    const snap = await _loadRawSnapshot();
    const trx = snap.transactions.find((t) => t.id_transaction === id);
    if (!trx) return null;

    const items = snap.transaction_details
      .filter((d) => d.id_transaction === id)
      .sort((a, b) => a.id_detail - b.id_detail)
      .map((d) => ({
        id_detail: d.id_detail,
        nama_item: d.nama_item,
        harga_satuan: d.harga_satuan,
        qty: d.qty,
        subtotal: d.harga_satuan * d.qty,
      }));

    return { ...trx, items };
  }

  async function voidTransaction(id_transaction) {
    const id = _parseBoundedInt(id_transaction, 1);
    if (id === null) throw new Error('ID transaksi tidak valid.');

    const idbRes = await _withIdb(['transactions'], 'readwrite', async (tx) => {
      const store = tx.objectStore('transactions');
      const trx = await _reqToPromise(store.get(id));
      if (!trx) throw new Error('Transaksi tidak ditemukan.');
      trx.status = 'VOID';
      trx.status_bayar = 'VOID';
      await _reqToPromise(store.put(trx));
      return { ok: true, id_transaction: id, status: 'VOID' };
    });
    if (idbRes !== null) return idbRes;

    const st = _readFallbackState();
    const trx = st.transactions.find((t) => t.id_transaction === id);
    if (!trx) throw new Error('Transaksi tidak ditemukan.');
    trx.status = 'VOID';
    trx.status_bayar = 'VOID';
    _writeFallbackState(st);
    return { ok: true, id_transaction: id, status: 'VOID' };
  }

  async function getDailyExportData(tanggalInput) {
    const tanggal = _validateIsoDate(tanggalInput);
    const snap = await _loadRawSnapshot();

    const capRow = snap.daily_capital.find((c) => c.tanggal === tanggal);
    const modal_awal = capRow ? Number(capRow.modal) : 0;

    const dayTrx = snap.transactions
      .filter((t) => String(t.waktu || '').slice(0, 10) === tanggal)
      .sort((a, b) => {
        if (a.waktu !== b.waktu) return a.waktu.localeCompare(b.waktu);
        return a.id_transaction - b.id_transaction;
      });

    const detailsByTrx = {};
    for (const d of snap.transaction_details) {
      if (!detailsByTrx[d.id_transaction]) detailsByTrx[d.id_transaction] = [];
      detailsByTrx[d.id_transaction].push(d);
    }

    let jumlah_paid = 0;
    let jumlah_void = 0;
    let total_item_terjual = 0;
    let total_pendapatan = 0;
    let total_cash = 0;
    let total_qris = 0;
    let total_tf = 0;

    const itemAgg = {};
    const transactions = [];
    const detail_lines = [];

    for (const r of dayTrx) {
      const dets = (detailsByTrx[r.id_transaction] || []).sort((a, b) => a.id_detail - b.id_detail);
      const jam_wib = _formatJamWib(r.waktu);
      const ringkasan = dets.map((d) => `${d.nama_item} x${d.qty}`).join(', ');

      transactions.push({
        id_transaction: r.id_transaction,
        jam_wib,
        status: r.status,
        metode_bayar: r.metode_bayar,
        ringkasan: ringkasan || '-',
        total_harga: r.total_harga,
        uang_diterima: r.uang_diterima !== undefined ? r.uang_diterima : null,
        kembalian: r.kembalian !== undefined ? r.kembalian : null,
        catatan_bayar: r.catatan_bayar || '-',
      });

      if (r.status === 'PAID') {
        jumlah_paid += 1;
        total_pendapatan += r.total_harga;
        if (r.metode_bayar === 'CASH') total_cash += r.total_harga;
        else if (r.metode_bayar === 'QRIS') total_qris += r.total_harga;
        else if (r.metode_bayar === 'TF') total_tf += r.total_harga;
      } else {
        jumlah_void += 1;
      }

      for (const d of dets) {
        const subtotal = d.harga_satuan * d.qty;
        detail_lines.push({
          id_transaction: r.id_transaction,
          jam_wib,
          status: r.status,
          metode_bayar: r.metode_bayar,
          nama_item: d.nama_item,
          harga_satuan: d.harga_satuan,
          qty: d.qty,
          subtotal,
        });
        if (r.status === 'PAID') {
          total_item_terjual += d.qty;
          const key = String(d.nama_item).trim();
          if (!itemAgg[key]) itemAgg[key] = { nama_item: key, qty: 0, total: 0 };
          itemAgg[key].qty += d.qty;
          itemAgg[key].total += subtotal;
        }
      }
    }

    const rata_rata_trx = jumlah_paid > 0 ? Math.round(total_pendapatan / jumlah_paid) : 0;
    const laba_bersih = total_pendapatan - modal_awal;
    const item_breakdown = Object.values(itemAgg).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.qty !== a.qty) return b.qty - a.qty;
      return a.nama_item.toLowerCase().localeCompare(b.nama_item.toLowerCase());
    });

    return {
      tanggal,
      exported_at: nowWibIso(),
      jumlah_paid,
      jumlah_void,
      total_item_terjual,
      total_pendapatan,
      total_cash,
      total_qris,
      total_tf,
      rata_rata_trx,
      modal_awal,
      laba_bersih,
      item_breakdown,
      transactions,
      detail_lines,
    };
  }

  // -------------------------------------------------------------------------
  // Backup & Restore JSON Privat (untuk pindah HP / cadangan)
  // -------------------------------------------------------------------------
  async function exportBackupJson() {
    const snap = await _loadRawSnapshot();
    return {
      app: 'kasir-standsimple',
      version: 1,
      exported_at: nowWibIso(),
      menus: snap.menus || [],
      transactions: snap.transactions || [],
      transaction_details: snap.transaction_details || [],
      daily_capital: snap.daily_capital || [],
    };
  }

  async function importBackupJson(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Format file backup tidak valid.');
    }
    if (
      !Array.isArray(payload.menus) ||
      !Array.isArray(payload.transactions) ||
      !Array.isArray(payload.transaction_details) ||
      !Array.isArray(payload.daily_capital)
    ) {
      throw new Error('Struktur data backup tidak lengkap.');
    }

    const idbRes = await _withIdb(
      ['menus', 'transactions', 'transaction_details', 'daily_capital'],
      'readwrite',
      async (tx) => {
        for (const name of ['menus', 'transactions', 'transaction_details', 'daily_capital']) {
          await _reqToPromise(tx.objectStore(name).clear());
        }
        for (const m of payload.menus) {
          await _reqToPromise(tx.objectStore('menus').put(m));
        }
        for (const t of payload.transactions) {
          await _reqToPromise(tx.objectStore('transactions').put(t));
        }
        for (const d of payload.transaction_details) {
          await _reqToPromise(tx.objectStore('transaction_details').put(d));
        }
        for (const c of payload.daily_capital) {
          await _reqToPromise(tx.objectStore('daily_capital').put(c));
        }
        return true;
      }
    );
    if (idbRes !== null) return true;

    const maxMenu = payload.menus.reduce((m, x) => Math.max(m, Number(x.id_menu) || 0), 0);
    const maxTrx = payload.transactions.reduce((m, x) => Math.max(m, Number(x.id_transaction) || 0), 0);
    const maxDet = payload.transaction_details.reduce((m, x) => Math.max(m, Number(x.id_detail) || 0), 0);
    _writeFallbackState({
      seq: { menus: maxMenu, transactions: maxTrx, transaction_details: maxDet },
      menus: payload.menus,
      transactions: payload.transactions,
      transaction_details: payload.transaction_details,
      daily_capital: payload.daily_capital,
    });
    return true;
  }

  global.StandStore = {
    nowWibIso,
    todayWibStr,
    getMenus,
    createMenu,
    deleteMenu,
    setCapital,
    checkout,
    getReport,
    getTransactionDetail,
    voidTransaction,
    getDailyExportData,
    exportBackupJson,
    importBackupJson,
  };
})(typeof window !== 'undefined' ? window : globalThis);
