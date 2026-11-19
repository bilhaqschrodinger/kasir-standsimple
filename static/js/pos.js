// StandPOS — Antarmuka Terpadu (Kasir, Menu Cepat, Modal Harian, Omzet & Riwayat Database)

let menus = [];
let cart = [];
let activeDigitalMethod = null;
let isSubmittingCheckout = false;
let currentModalAwal = 0;
let activeDetailTrxId = null;

function formatRupiah(angka) {
  const n = Math.round(Number(angka) || 0);
  const sign = n < 0 ? '-' : '';
  const absStr = Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp ${absStr}`;
}

function formatJam(isoStr) {
  if (!isoStr) return '-';
  const parts = String(isoStr).split('T');
  return parts.length === 2 ? parts[1].slice(0, 8) : isoStr;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const style =
    type === 'error'
      ? 'bg-red-800 text-white border border-red-900'
      : 'bg-zinc-900 text-white border border-zinc-800';
  toast.className = `${style} px-4 py-3 text-sm font-medium pointer-events-auto transition-opacity duration-150`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 150);
  }, 2600);
}

function getSelectedDate() {
  const el = document.getElementById('filter-date');
  if (el && el.value) return el.value;
  if (window.TODAY_WIB && window.TODAY_WIB !== 'undefined') return window.TODAY_WIB;
  return '';
}

// ---------------------------------------------------------------------------
// CEK INPUT DRAFT (Jika user mengetik nama & harga tapi belum klik "+ Masukkan")
// ---------------------------------------------------------------------------
function getDraftInputItem() {
  const namaInput = document.getElementById('custom-nama');
  const hargaInput = document.getElementById('custom-harga');
  if (!namaInput || !hargaInput) return null;

  const nama = namaInput.value.trim();
  const harga = parseInt(hargaInput.value.trim(), 10);
  if (nama && Number.isInteger(harga) && harga > 0) {
    return { nama_item: nama, harga_satuan: harga, qty: 1 };
  }
  return null;
}

function commitDraftIfPresent() {
  const draft = getDraftInputItem();
  if (draft) {
    addItemToCart(draft.nama_item, draft.harga_satuan);
    document.getElementById('custom-nama').value = '';
    document.getElementById('custom-harga').value = '';
    renderCart();
  }
}

// ---------------------------------------------------------------------------
// 1. TOMBOL MENU CEPAT (Load, Simpan, & Hapus)
// ---------------------------------------------------------------------------
async function fetchMenus() {
  try {
    const res = await fetch('/api/menus');
    if (!res.ok) return;
    const data = await res.json();
    menus = Array.isArray(data) ? data : [];
    renderMenuGrid();
  } catch (_) {}
}

function renderMenuGrid() {
  const gridEl = document.getElementById('pos-menu-grid');
  const emptyEl = document.getElementById('pos-menu-empty');
  const countLabel = document.getElementById('menu-count-label');

  countLabel.textContent = `${menus.length} menu`;
  gridEl.innerHTML = '';

  if (menus.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  menus.forEach((menu) => {
    const card = document.createElement('div');
    card.className =
      'relative min-h-[70px] bg-white hover:bg-zinc-900 border border-zinc-300 hover:border-zinc-900 rounded transition group flex flex-col justify-between';

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'w-full h-full p-3 text-left flex flex-col justify-between flex-1';

    const title = document.createElement('span');
    title.className =
      'text-sm font-semibold text-zinc-900 group-hover:text-white pr-5 leading-snug line-clamp-2';
    title.textContent = menu.nama_menu;

    const price = document.createElement('span');
    price.className =
      'num text-xs font-semibold text-zinc-500 group-hover:text-zinc-300 mt-1.5';
    price.textContent = formatRupiah(menu.harga);

    mainBtn.appendChild(title);
    mainBtn.appendChild(price);
    mainBtn.addEventListener('click', () => addItemToCart(menu.nama_menu, menu.harga));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.title = 'Hapus dari tombol menu';
    delBtn.className =
      'absolute top-1.5 right-2 text-xs font-bold text-zinc-400 hover:text-red-500 group-hover:text-zinc-400 px-1.5 py-0.5';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteMenu(menu.id_menu, menu.nama_menu);
    });

    card.appendChild(mainBtn);
    card.appendChild(delBtn);
    gridEl.appendChild(card);
  });
}

async function handleSaveAsMenu() {
  const namaInput = document.getElementById('custom-nama');
  const hargaInput = document.getElementById('custom-harga');
  const nama_menu = namaInput.value.trim();
  const harga = parseInt(hargaInput.value.trim(), 10);

  if (!nama_menu || !Number.isInteger(harga) || harga <= 0) {
    showToast('Ketik nama menu dan harga (> 0) terlebih dahulu.', 'error');
    namaInput.focus();
    return;
  }

  const btn = document.getElementById('btn-save-as-menu');
  btn.disabled = true;
  try {
    const res = await fetch('/api/menus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nama_menu, harga }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data.error || 'Gagal menyimpan menu.', 'error');
      return;
    }
    // Sekaligus masukkan ke pesanan aktif supaya bisa langsung dibayar juga
    addItemToCart(nama_menu, harga);
    namaInput.value = '';
    hargaInput.value = '';
    renderCart();
    await fetchMenus();
    showToast(`"${nama_menu}" disimpan ke tombol menu & masuk pesanan`);
  } catch (_) {
    showToast('Gagal menghubungi server.', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function deleteMenu(id_menu, nama_menu) {
  try {
    const res = await fetch(`/api/menus/${id_menu}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.ok) return;
    await fetchMenus();
    showToast(`Tombol menu "${nama_menu}" dihapus`);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// 2. INPUT MODAL HARIAN LANGSUNG (Inline di Baris Atas)
// ---------------------------------------------------------------------------
async function handleCapitalInlineSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('input-capital-inline');
  const raw = input.value.trim();
  const modalVal = raw === '' ? 0 : parseInt(raw, 10);

  if (!Number.isInteger(modalVal) || modalVal < 0) {
    showToast('Modal harian harus berupa angka bulat >= 0.', 'error');
    return;
  }

  const btn = document.getElementById('btn-save-capital-inline');
  btn.disabled = true;
  try {
    const res = await fetch('/api/capital', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tanggal: getSelectedDate(), modal: modalVal }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data.error || 'Gagal menyimpan modal.', 'error');
      return;
    }
    await fetchReport(true);
    showToast(`Modal harian ${formatRupiah(modalVal)} tersimpan`);
  } catch (_) {
    showToast('Gagal menghubungi server.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 3. KERANJANG PESANAN & ITEM MANUAL
// ---------------------------------------------------------------------------
function makeCartKey(nama_item, harga_satuan) {
  return `${nama_item.trim().toLowerCase()}__${Number(harga_satuan)}`;
}

function addItemToCart(nama_item, harga_satuan) {
  const cleanName = String(nama_item || '').trim();
  const cleanPrice = parseInt(harga_satuan, 10);

  if (!cleanName || !Number.isInteger(cleanPrice) || cleanPrice <= 0) {
    showToast('Nama menu wajib diisi dan harga harus > 0.', 'error');
    return;
  }

  const key = makeCartKey(cleanName, cleanPrice);
  const existing = cart.find((item) => item.key === key);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      key,
      nama_item: cleanName,
      harga_satuan: cleanPrice,
      qty: 1,
    });
  }
  renderCart();
}

function updateItemQty(key, delta) {
  const idx = cart.findIndex((item) => item.key === key);
  if (idx === -1) return;
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) {
    cart.splice(idx, 1);
  }
  renderCart();
}

function clearCart() {
  cart = [];
  document.getElementById('custom-nama').value = '';
  document.getElementById('custom-harga').value = '';
  renderCart();
}

function getCartTotal() {
  const cartSum = cart.reduce((sum, item) => sum + item.harga_satuan * item.qty, 0);
  const draft = getDraftInputItem();
  return cartSum + (draft ? draft.harga_satuan : 0);
}

function renderCart() {
  const listEl = document.getElementById('cart-list');
  const emptyEl = document.getElementById('cart-empty');
  const draftNotice = document.getElementById('draft-item-notice');
  const draftText = document.getElementById('draft-item-text');
  const totalEl = document.getElementById('cart-total');
  const countEl = document.getElementById('cart-item-count');
  const btnClear = document.getElementById('btn-clear-cart');
  const btnCash = document.getElementById('btn-pay-cash');
  const btnQris = document.getElementById('btn-pay-qris');
  const btnTf = document.getElementById('btn-pay-tf');

  listEl.innerHTML = '';

  const draft = getDraftInputItem();
  const totalQty = cart.reduce((acc, it) => acc + it.qty, 0) + (draft ? 1 : 0);
  const totalHarga = getCartTotal();

  countEl.textContent = `${totalQty} item`;
  totalEl.textContent = formatRupiah(totalHarga);

  if (draft) {
    draftText.textContent = `${draft.nama_item} (${formatRupiah(draft.harga_satuan)})`;
    draftNotice.classList.remove('hidden');
  } else {
    draftNotice.classList.add('hidden');
  }

  const hasPayableItems = cart.length > 0 || draft !== null;
  btnClear.disabled = !hasPayableItems || isSubmittingCheckout;
  btnCash.disabled = !hasPayableItems || isSubmittingCheckout;
  btnQris.disabled = !hasPayableItems || isSubmittingCheckout;
  btnTf.disabled = !hasPayableItems || isSubmittingCheckout;

  if (!hasPayableItems) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  cart.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'py-3 flex items-center justify-between gap-3';

    const info = document.createElement('div');
    info.className = 'min-w-0 flex-1';

    const nameEl = document.createElement('p');
    nameEl.className = 'text-sm font-semibold text-zinc-900 truncate';
    nameEl.textContent = item.nama_item;

    const subInfo = document.createElement('p');
    subInfo.className = 'num text-xs text-zinc-500 mt-0.5';
    subInfo.textContent = `${formatRupiah(item.harga_satuan)} × ${item.qty} = `;

    const subTotalSpan = document.createElement('span');
    subTotalSpan.className = 'font-semibold text-zinc-800';
    subTotalSpan.textContent = formatRupiah(item.harga_satuan * item.qty);
    subInfo.appendChild(subTotalSpan);

    info.appendChild(nameEl);
    info.appendChild(subInfo);

    const controls = document.createElement('div');
    controls.className = 'flex items-center gap-1.5';

    const btnMinus = document.createElement('button');
    btnMinus.type = 'button';
    btnMinus.className =
      'w-9 h-9 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 font-bold text-base flex items-center justify-center rounded transition';
    btnMinus.textContent = '−';
    btnMinus.addEventListener('click', () => updateItemQty(item.key, -1));

    const qtyBadge = document.createElement('span');
    qtyBadge.className = 'num w-7 text-center font-semibold text-sm text-zinc-900';
    qtyBadge.textContent = item.qty;

    const btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className =
      'w-9 h-9 bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-base flex items-center justify-center rounded transition';
    btnPlus.textContent = '+';
    btnPlus.addEventListener('click', () => updateItemQty(item.key, 1));

    controls.appendChild(btnMinus);
    controls.appendChild(qtyBadge);
    controls.appendChild(btnPlus);

    row.appendChild(info);
    row.appendChild(controls);
    listEl.appendChild(row);
  });
}

function handleCustomItemSubmit(e) {
  e.preventDefault();
  const namaInput = document.getElementById('custom-nama');
  const hargaInput = document.getElementById('custom-harga');

  const nama = namaInput.value.trim();
  const hargaStr = hargaInput.value.trim();
  const harga = parseInt(hargaStr, 10);

  if (!nama) {
    showToast('Ketik nama menu terlebih dahulu.', 'error');
    namaInput.focus();
    return;
  }
  if (!hargaStr || !Number.isInteger(harga) || harga <= 0) {
    showToast('Harga harus berupa angka bulat > 0.', 'error');
    hargaInput.focus();
    return;
  }

  addItemToCart(nama, harga);
  namaInput.value = '';
  hargaInput.value = '';
  renderCart();
  namaInput.focus();
}

// ---------------------------------------------------------------------------
// 4. CHECKOUT PEMBAYARAN (CASH, QRIS, TF)
// ---------------------------------------------------------------------------
function openCashModal() {
  commitDraftIfPresent();
  if (cart.length === 0 || isSubmittingCheckout) return;
  const total = getCartTotal();
  document.getElementById('cash-modal-total').textContent = formatRupiah(total);
  const inputUang = document.getElementById('input-uang-diterima');
  inputUang.value = '';
  document.getElementById('cash-modal-kembalian').textContent = formatRupiah(0);
  document.getElementById('cash-error').classList.add('hidden');
  document.getElementById('btn-confirm-cash').disabled = false;

  const modal = document.getElementById('modal-cash');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  inputUang.focus();
}

function closeCashModal() {
  const modal = document.getElementById('modal-cash');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function updateCashKembalian() {
  const total = getCartTotal();
  const raw = document.getElementById('input-uang-diterima').value.trim();
  const kembalianEl = document.getElementById('cash-modal-kembalian');
  const errEl = document.getElementById('cash-error');
  const btnConfirm = document.getElementById('btn-confirm-cash');

  if (raw === '') {
    kembalianEl.textContent = formatRupiah(0);
    errEl.classList.add('hidden');
    btnConfirm.disabled = isSubmittingCheckout;
    return;
  }

  const uang = parseInt(raw, 10);
  if (isNaN(uang) || uang < total) {
    kembalianEl.textContent = 'Rp 0';
    errEl.textContent = `Uang diterima kurang dari ${formatRupiah(total)}.`;
    errEl.classList.remove('hidden');
    btnConfirm.disabled = true;
  } else {
    kembalianEl.textContent = formatRupiah(uang - total);
    errEl.classList.add('hidden');
    btnConfirm.disabled = isSubmittingCheckout;
  }
}

function openDigitalModal(method) {
  commitDraftIfPresent();
  if (cart.length === 0 || isSubmittingCheckout) return;
  activeDigitalMethod = method;
  const total = getCartTotal();

  const titleEl = document.getElementById('digital-title');
  const confirmText = document.getElementById('digital-confirm-text');
  const btnConfirm = document.getElementById('btn-confirm-digital');
  const catatanInput = document.getElementById('input-catatan-bayar');

  titleEl.textContent = method === 'QRIS' ? 'Pembayaran QRIS' : 'Pembayaran Transfer (TF)';
  confirmText.textContent = `Total ${formatRupiah(total)}. Sudah cek pembayaran masuk di HP/m-banking?`;
  catatanInput.value = '';

  btnConfirm.className =
    method === 'QRIS'
      ? 'flex-1 min-h-[50px] bg-blue-700 hover:bg-blue-800 disabled:bg-zinc-200 text-white font-semibold text-sm rounded transition'
      : 'flex-1 min-h-[50px] bg-indigo-700 hover:bg-indigo-800 disabled:bg-zinc-200 text-white font-semibold text-sm rounded transition';

  const modal = document.getElementById('modal-digital');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  catatanInput.focus();
}

function closeDigitalModal() {
  activeDigitalMethod = null;
  const modal = document.getElementById('modal-digital');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function submitCheckout({ metode_bayar, catatan_bayar = null, uang_diterima = null }) {
  commitDraftIfPresent();
  if (isSubmittingCheckout || cart.length === 0) return;

  isSubmittingCheckout = true;
  renderCart();

  const btnConfirmCash = document.getElementById('btn-confirm-cash');
  const btnConfirmDigital = document.getElementById('btn-confirm-digital');
  btnConfirmCash.disabled = true;
  btnConfirmDigital.disabled = true;

  const payload = {
    metode_bayar,
    catatan_bayar,
    uang_diterima,
    items: cart.map((item) => ({
      nama_item: item.nama_item,
      harga_satuan: item.harga_satuan,
      qty: item.qty,
    })),
  };

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      showToast(data.error || 'Gagal menyimpan transaksi.', 'error');
      return;
    }

    closeCashModal();
    closeDigitalModal();
    clearCart();
    showToast(`Transaksi #${data.id_transaction} (${formatRupiah(data.total_harga)}) tersimpan`);
    await fetchReport(true);
  } catch (_) {
    showToast('Gagal menghubungi server.', 'error');
  } finally {
    isSubmittingCheckout = false;
    btnConfirmCash.disabled = false;
    btnConfirmDigital.disabled = false;
    renderCart();
  }
}

// ---------------------------------------------------------------------------
// 5. RINGKASAN DATABASE & RIWAYAT TRANSAKSI (Langsung di Layar Utama)
// ---------------------------------------------------------------------------
async function fetchReport(silent = true) {
  const dateStr = getSelectedDate();
  try {
    const res = await fetch(`/api/report?date=${encodeURIComponent(dateStr)}`);
    if (!res.ok) return;
    const data = await res.json();
    renderReport(data);
  } catch (_) {
    if (!silent) showToast('Gagal memuat data transaksi.', 'error');
  }
}

function renderReport(data) {
  currentModalAwal = data.modal_awal || 0;
  const laba = (data.total_pendapatan || 0) - currentModalAwal;

  document.getElementById('metric-jumlah').textContent = data.jumlah_transaksi || 0;
  document.getElementById('metric-pendapatan').textContent = formatRupiah(data.total_pendapatan);
  document.getElementById('metric-cash').textContent = formatRupiah(data.total_cash);
  document.getElementById('metric-qris').textContent = formatRupiah(data.total_qris);
  document.getElementById('metric-tf').textContent = formatRupiah(data.total_tf);

  const capInput = document.getElementById('input-capital-inline');
  if (document.activeElement !== capInput) {
    capInput.value = currentModalAwal > 0 ? currentModalAwal : '';
  }

  const labaEl = document.getElementById('metric-laba');
  labaEl.textContent = formatRupiah(laba);
  labaEl.className =
    laba < 0
      ? 'num text-base sm:text-lg font-bold text-red-700 mt-0.5'
      : 'num text-base sm:text-lg font-bold text-emerald-800 mt-0.5';

  const nowStr = new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  document.getElementById('last-updated').textContent = `Diperbarui ${nowStr}`;

  const tbody = document.getElementById('trx-table-body');
  const emptyEl = document.getElementById('trx-empty');
  tbody.innerHTML = '';

  const list = Array.isArray(data.transaksi) ? data.transaksi : [];
  if (list.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  list.forEach((trx) => {
    const isVoid = trx.status === 'VOID';
    const tr = document.createElement('tr');
    tr.className = `cursor-pointer transition ${
      isVoid ? 'bg-zinc-50 text-zinc-400' : 'hover:bg-zinc-50 text-zinc-900'
    }`;

    const strike = isVoid ? 'line-through text-zinc-400' : '';

    const tdId = document.createElement('td');
    tdId.className = `num py-3 px-4 font-semibold whitespace-nowrap ${strike}`;
    tdId.textContent = `#${trx.id_transaction}`;

    const tdJam = document.createElement('td');
    tdJam.className = `num py-3 px-4 text-zinc-500 whitespace-nowrap ${strike}`;
    tdJam.textContent = formatJam(trx.waktu);

    const tdRingkasan = document.createElement('td');
    tdRingkasan.className = `py-3 px-4 font-medium max-w-md truncate ${strike}`;
    tdRingkasan.textContent = trx.ringkasan || '-';

    const tdMetode = document.createElement('td');
    tdMetode.className = `py-3 px-4 font-semibold text-xs whitespace-nowrap ${strike}`;
    tdMetode.textContent = trx.metode_bayar;

    const tdCatatan = document.createElement('td');
    tdCatatan.className = `py-3 px-4 text-xs text-zinc-500 max-w-[180px] truncate ${strike}`;
    tdCatatan.textContent = trx.catatan_bayar || '-';

    const tdTotal = document.createElement('td');
    tdTotal.className = `num py-3 px-4 font-bold text-right whitespace-nowrap ${strike}`;
    tdTotal.textContent = formatRupiah(trx.total_harga);

    const tdAksi = document.createElement('td');
    tdAksi.className = 'py-3 px-4 text-right whitespace-nowrap';

    if (isVoid) {
      const voidLabel = document.createElement('span');
      voidLabel.className = 'text-xs font-semibold text-red-700';
      voidLabel.textContent = 'Void';
      tdAksi.appendChild(voidLabel);
    } else {
      const btnVoid = document.createElement('button');
      btnVoid.type = 'button';
      btnVoid.className =
        'text-xs font-semibold text-red-700 hover:text-red-900 underline underline-offset-2';
      btnVoid.textContent = 'Batalkan';
      btnVoid.addEventListener('click', (e) => {
        e.stopPropagation();
        voidTransaction(trx.id_transaction);
      });
      tdAksi.appendChild(btnVoid);
    }

    tr.appendChild(tdId);
    tr.appendChild(tdJam);
    tr.appendChild(tdRingkasan);
    tr.appendChild(tdMetode);
    tr.appendChild(tdCatatan);
    tr.appendChild(tdTotal);
    tr.appendChild(tdAksi);

    tr.addEventListener('click', () => openTransactionDetail(trx.id_transaction));
    tbody.appendChild(tr);
  });
}

async function openTransactionDetail(id_transaction) {
  try {
    const res = await fetch(`/api/transactions/${id_transaction}`);
    if (!res.ok) return;
    const trx = await res.json();
    activeDetailTrxId = trx.id_transaction;

    const isVoid = trx.status === 'VOID';
    document.getElementById('detail-title').textContent = `Transaksi #${trx.id_transaction}`;
    document.getElementById('detail-waktu').textContent = `${trx.waktu.replace('T', ' ')} WIB`;
    document.getElementById('detail-metode').textContent = trx.metode_bayar;

    const statusEl = document.getElementById('detail-status');
    statusEl.textContent = isVoid ? 'VOID (Dibatalkan)' : 'PAID (Tercatat)';
    statusEl.className = isVoid
      ? 'font-bold text-red-700 mt-0.5 block'
      : 'font-bold text-emerald-700 mt-0.5 block';

    const catatanBox = document.getElementById('detail-catatan-box');
    if (trx.catatan_bayar) {
      document.getElementById('detail-catatan').textContent = trx.catatan_bayar;
      catatanBox.classList.remove('hidden');
    } else {
      catatanBox.classList.add('hidden');
    }

    const cashBox = document.getElementById('detail-cash-box');
    if (trx.metode_bayar === 'CASH' && trx.uang_diterima !== null && trx.uang_diterima !== undefined) {
      document.getElementById('detail-uang-diterima').textContent = formatRupiah(trx.uang_diterima);
      document.getElementById('detail-kembalian').textContent = formatRupiah(trx.kembalian || 0);
      cashBox.classList.remove('hidden');
      cashBox.classList.add('grid');
    } else {
      cashBox.classList.add('hidden');
      cashBox.classList.remove('grid');
    }

    const itemsList = document.getElementById('detail-items-list');
    itemsList.innerHTML = '';
    (trx.items || []).forEach((item) => {
      const div = document.createElement('div');
      div.className = 'py-2.5 flex items-center justify-between text-sm';

      const left = document.createElement('div');
      const nameP = document.createElement('p');
      nameP.className = `font-semibold text-zinc-900 ${isVoid ? 'line-through text-zinc-400' : ''}`;
      nameP.textContent = item.nama_item;

      const qtyP = document.createElement('p');
      qtyP.className = 'num text-xs text-zinc-500';
      qtyP.textContent = `${formatRupiah(item.harga_satuan)} × ${item.qty}`;
      left.appendChild(nameP);
      left.appendChild(qtyP);

      const right = document.createElement('span');
      right.className = `num font-semibold text-zinc-900 ${isVoid ? 'line-through text-zinc-400' : ''}`;
      right.textContent = formatRupiah(item.subtotal);

      div.appendChild(left);
      div.appendChild(right);
      itemsList.appendChild(div);
    });

    const totalEl = document.getElementById('detail-total');
    totalEl.textContent = formatRupiah(trx.total_harga);
    totalEl.className = isVoid
      ? 'num text-xl font-bold text-zinc-400 line-through'
      : 'num text-xl font-bold text-zinc-900';

    const btnVoid = document.getElementById('btn-void-trx');
    if (isVoid) {
      btnVoid.classList.add('hidden');
    } else {
      btnVoid.classList.remove('hidden');
    }

    const modal = document.getElementById('modal-detail');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  } catch (_) {}
}

function closeDetailModal() {
  activeDetailTrxId = null;
  const modal = document.getElementById('modal-detail');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function voidTransaction(id_transaction) {
  try {
    const res = await fetch(`/api/transactions/${id_transaction}/void`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data.error || 'Gagal membatalkan transaksi.', 'error');
      return;
    }
    closeDetailModal();
    showToast(`Transaksi #${id_transaction} dibatalkan (Void)`);
    await fetchReport(true);
  } catch (_) {
    showToast('Gagal menghubungi server.', 'error');
  }
}

async function handleExportExcel() {
  const btn = document.getElementById('btn-export-excel');
  const dateStr = getSelectedDate();
  if (!btn || btn.disabled) return;

  btn.disabled = true;
  btn.textContent = 'Menyiapkan...';

  try {
    const res = await fetch(`/api/export/excel?date=${encodeURIComponent(dateStr)}`);
    if (!res.ok) {
      let msg = 'Gagal mengekspor laporan Excel.';
      try {
        const errData = await res.json();
        if (errData && errData.error) msg = errData.error;
      } catch (_) {}
      showToast(msg, 'error');
      return;
    }

    const blob = await res.blob();
    let filename = `StandPOS_Laporan_${dateStr}.xlsx`;
    const disposition = res.headers.get('Content-Disposition') || '';
    const matchUtf = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const matchPlain = disposition.match(/filename="?([^";]+)"?/i);
    if (matchUtf && matchUtf[1]) {
      filename = decodeURIComponent(matchUtf[1]);
    } else if (matchPlain && matchPlain[1]) {
      filename = matchPlain[1];
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast(`Laporan Excel ${dateStr} diunduh`);
  } catch (_) {
    showToast('Gagal mengunduh file Excel.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export Excel';
  }
}

// ---------------------------------------------------------------------------
// INISIALISASI
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  fetchMenus();
  fetchReport(true);

  setInterval(() => {
    fetchMenus();
    fetchReport(true);
  }, 5000);

  // Filter Tanggal & Export Excel
  const filterDate = document.getElementById('filter-date');
  filterDate.addEventListener('change', () => fetchReport(false));
  document.getElementById('btn-today').addEventListener('click', () => {
    filterDate.value = window.TODAY_WIB;
    fetchReport(false);
  });
  document.getElementById('btn-export-excel').addEventListener('click', handleExportExcel);

  // Modal Harian Inline
  document.getElementById('form-capital-inline').addEventListener('submit', handleCapitalInlineSubmit);

  // Saat user mengetik nama & harga di input kiri, otomatis aktifkan tombol Bayar!
  document.getElementById('custom-nama').addEventListener('input', renderCart);
  document.getElementById('custom-harga').addEventListener('input', renderCart);

  // Form Input Menu / Pesanan
  document.getElementById('form-custom-item').addEventListener('submit', handleCustomItemSubmit);
  document.getElementById('btn-save-as-menu').addEventListener('click', handleSaveAsMenu);
  document.getElementById('btn-clear-cart').addEventListener('click', clearCart);

  // Tombol Pembayaran
  document.getElementById('btn-pay-cash').addEventListener('click', openCashModal);
  document.getElementById('btn-pay-qris').addEventListener('click', () => openDigitalModal('QRIS'));
  document.getElementById('btn-pay-tf').addEventListener('click', () => openDigitalModal('TF'));

  // Modal Cash
  document.getElementById('btn-close-cash').addEventListener('click', closeCashModal);
  document.getElementById('btn-cancel-cash').addEventListener('click', closeCashModal);
  document.getElementById('input-uang-diterima').addEventListener('input', updateCashKembalian);
  document.querySelectorAll('.btn-quick-cash').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nom = btn.getAttribute('data-nominal');
      const input = document.getElementById('input-uang-diterima');
      input.value = nom === 'pas' ? getCartTotal() : nom;
      updateCashKembalian();
    });
  });

  document.getElementById('form-cash').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUang = document.getElementById('input-uang-diterima').value.trim();
    let uang_diterima = null;
    if (rawUang !== '') {
      const parsed = parseInt(rawUang, 10);
      if (isNaN(parsed) || parsed < getCartTotal()) {
        showToast('Uang diterima kurang dari total tagihan.', 'error');
        return;
      }
      uang_diterima = parsed;
    }
    await submitCheckout({
      metode_bayar: 'CASH',
      uang_diterima,
      catatan_bayar: null,
    });
  });

  // Modal Digital (QRIS / TF)
  document.getElementById('btn-close-digital').addEventListener('click', closeDigitalModal);
  document.getElementById('btn-cancel-digital').addEventListener('click', closeDigitalModal);
  document.getElementById('form-digital').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeDigitalMethod) return;
    const catatan = document.getElementById('input-catatan-bayar').value.trim();
    await submitCheckout({
      metode_bayar: activeDigitalMethod,
      catatan_bayar: catatan || null,
      uang_diterima: null,
    });
  });

  // Modal Detail Transaksi & Void
  document.getElementById('btn-close-detail').addEventListener('click', closeDetailModal);
  document.getElementById('btn-close-detail-bottom').addEventListener('click', closeDetailModal);
  document.getElementById('btn-void-trx').addEventListener('click', () => {
    if (activeDetailTrxId) voidTransaction(activeDetailTrxId);
  });

  renderCart();
});
