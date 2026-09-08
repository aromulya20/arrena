const grid = document.getElementById('units-grid');

let currentUnits = [];
let selectedUnitForStart = null;
let selectedUnitForExtend = null;
let selectedSessionForStop = null;
let activeFilter = 'all';
let searchQuery = '';
let selectedTimeMode = 'countdown';

function formatRupiah(angka) {
  return 'Rp' + angka.toLocaleString('id-ID');
}

function formatSisaWaktu(msSisa) {
  if (msSisa <= 0) return '00:00';
  const totalDetik = Math.floor(msSisa / 1000);
  const menit = Math.floor(totalDetik / 60);
  const detik = totalDetik % 60;
  return `${String(menit).padStart(2, '0')}:${String(detik).padStart(2, '0')}`;
}

function formatDurasiBerjalan(msBerjalan) {
  const totalDetik = Math.max(0, Math.floor(msBerjalan / 1000));
  const jam = Math.floor(totalDetik / 3600);
  const menit = Math.floor((totalDetik % 3600) / 60);
  const detik = totalDetik % 60;
  return `${String(jam).padStart(2, '0')}:${String(menit).padStart(2, '0')}:${String(detik).padStart(2, '0')}`;
}

function formatJam(timestamp) {
  return new Date(timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function updateDashboardStats() {
  const dipakai = currentUnits.filter((unit) => unit.status === 'dipakai').length;
  const kosong = currentUnits.filter((unit) => unit.status === 'kosong').length;
  const maintenance = currentUnits.filter((unit) => unit.status === 'maintenance').length;
  document.getElementById('dashboard-stats').innerHTML = `
    <div class="stat-card stat-active"><span class="stat-icon">◉</span><div><span class="stat-label">Sedang bermain</span><strong>${dipakai}</strong><small>dari ${currentUnits.length} unit</small></div></div>
    <div class="stat-card stat-ready"><span class="stat-icon">＋</span><div><span class="stat-label">Siap disewa</span><strong>${kosong}</strong><small>unit tersedia sekarang</small></div></div>
    <div class="stat-card stat-maintenance"><span class="stat-icon">⌁</span><div><span class="stat-label">Maintenance</span><strong>${maintenance}</strong><small>perlu perhatian</small></div></div>
  `;
}

function getVisibleUnits() {
  return currentUnits.filter((unit) => {
    const matchesFilter = activeFilter === 'all' || unit.tipe.toUpperCase().includes(activeFilter) || unit.status === activeFilter;
    const haystack = `${unit.nama_unit} ${unit.tipe} ${unit.sesi_aktif?.nama_pelanggan || ''}`.toLowerCase();
    return matchesFilter && haystack.includes(searchQuery);
  });
}

function renderUnits() {
  grid.innerHTML = '';
  const visibleUnits = getVisibleUnits();
  document.getElementById('unit-count').textContent = `${visibleUnits.length}/${currentUnits.length}`;
  visibleUnits.forEach((unit) => {
    const card = document.createElement('div');
    const sesi = unit.sesi_aktif;
    const unpaid = sesi?.status === 'belum_bayar';
    const sisaMs = sesi ? sesi.waktu_selesai - Date.now() : 0;
    const totalMs = sesi && sesi.mode_waktu === 'countdown' ? sesi.waktu_selesai - sesi.waktu_mulai : 1;
    const progress = sesi ? Math.max(0, Math.min(100, ((Date.now() - sesi.waktu_mulai) / totalMs) * 100)) : 0;
    const lowTime = sesi && sesi.mode_waktu === 'countdown' && sisaMs <= 15 * 60 * 1000;
    card.className = `unit-card ${sesi ? 'is-active' : 'is-idle'} ${unpaid ? 'is-unpaid' : ''} ${lowTime ? 'is-ending' : ''}`;

    card.innerHTML = `
      <div class="unit-card-head">
        <div>
          <div class="unit-name"><span class="unit-dot"></span>${unit.nama_unit}</div>
          <div class="unit-type">${unit.tipe} <span>·</span> ${formatRupiah(unit.tarif_per_jam)}/jam</div>
        </div>
        <span class="status-badge ${unpaid ? 'status-dipakai' : `status-${unit.status}`}" >${unpaid ? 'MENUNGGU BAYAR' : unit.status === 'dipakai' ? 'ON SESSION' : unit.status.toUpperCase()}</span>
      </div>

      ${sesi
        ? unpaid
          ? `<div class="time-label">PEMBAYARAN DIPERLUKAN</div><div class="countdown unpaid-label">${formatRupiah(sesi.total_bayar)}</div><div class="session-meta"><span>◷ Sesi selesai</span><strong>${sesi.nama_pelanggan}</strong></div>`
          : sesi.mode_waktu === 'stopwatch'
            ? `<div class="time-label">STOPWATCH MANUAL</div><div class="countdown stopwatch" data-mulai="${sesi.waktu_mulai}">${formatDurasiBerjalan(Date.now() - sesi.waktu_mulai)}</div><div class="session-meta"><span>◷ Mulai ${formatJam(sesi.waktu_mulai)}</span><strong>${sesi.nama_pelanggan}</strong></div>`
            : `<div class="time-label">WAKTU TERSISA</div><div class="countdown ${lowTime ? 'urgent' : ''}" data-selesai="${sesi.waktu_selesai}">${formatSisaWaktu(sisaMs)}</div><div class="progress-track"><span style="width: ${progress}%"></span></div><div class="session-meta"><span>◷ Selesai ${formatJam(sesi.waktu_selesai)}</span><strong>${sesi.nama_pelanggan}</strong></div>`
        : `<div class="countdown idle">READY TO PLAY</div><div class="empty-note">Pilih unit untuk mulai sesi baru</div>`}

      <div class="card-actions">
        ${
          sesi
            ? `${unpaid ? `<button class="btn-primary" data-action="stop" data-id="${sesi.id}" data-mode="${sesi.mode_waktu}" data-total="${sesi.total_bayar}" data-tarif="${unit.tarif_per_jam}" data-mulai="${sesi.waktu_mulai}" data-unit="${unit.nama_unit}">Bayar di POS</button>` : `${sesi.mode_waktu === 'countdown' ? `<button class="btn-small" data-action="extend" data-id="${sesi.id}" data-unit="${unit.nama_unit}">+ Waktu</button>` : ''}
              <button class="btn-small" data-action="stop" data-id="${sesi.id}" data-mode="${sesi.mode_waktu}" data-total="${sesi.total_bayar}" data-tarif="${unit.tarif_per_jam}" data-mulai="${sesi.waktu_mulai}" data-unit="${unit.nama_unit}">Selesai</button>`}`
            : `<button class="btn-primary" data-action="start" data-id="${unit.id}" data-unit="${unit.nama_unit}" data-tarif="${unit.tarif_per_jam}" ${unit.status !== 'kosong' ? 'disabled' : ''}>Mulai Sewa</button>`
        }
      </div>
    `;

    grid.appendChild(card);
  });
}

// Update angka countdown tiap detik tanpa nunggu server (biar smooth), server tetap jadi sumber kebenaran tiap 5 detik
function updateTimers() {
  document.querySelectorAll('.countdown[data-selesai]').forEach((el) => {
    const selesai = Number(el.dataset.selesai);
    el.textContent = formatSisaWaktu(selesai - Date.now());
  });
  document.querySelectorAll('.countdown[data-mulai]').forEach((el) => {
    const mulai = Number(el.dataset.mulai);
    if (Number.isFinite(mulai) && mulai > 0) {
      el.textContent = formatDurasiBerjalan(Date.now() - mulai);
    }
  });
}

updateTimers();
setInterval(updateTimers, 1000);

// Pengganti socket.io: Vercel serverless gak bisa jaga koneksi websocket nyala terus,
// jadi update unit di-poll tiap 3 detik. Server tetap jadi sumber kebenaran soal status/waktu.
async function pollUnits() {
  try {
    const response = await fetch('/api/units', { credentials: 'same-origin' });
    if (!response.ok) return;
    currentUnits = await response.json();
    updateDashboardStats();
    renderUnits();
  } catch (error) {
    console.error('Gagal ambil update unit:', error);
  }
}

pollUnits();
setInterval(pollUnits, 3000);

document.querySelectorAll('.filter-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    activeFilter = button.dataset.filter;
    renderUnits();
  });
});

document.getElementById('unit-search').addEventListener('input', (event) => {
  searchQuery = event.target.value.toLowerCase().trim();
  renderUnits();
});

// ---------- Modal: Tambah device ----------
const modalDevice = document.getElementById('modal-device');
const deviceName = document.getElementById('device-name');
const deviceType = document.getElementById('device-type');
const deviceRate = document.getElementById('device-rate');

document.getElementById('btn-add-device').addEventListener('click', () => {
  deviceName.value = '';
  deviceType.value = 'PS5';
  deviceRate.value = 5000;
  modalDevice.classList.remove('hidden');
  deviceName.focus();
});

document.getElementById('btn-cancel-device').addEventListener('click', () => modalDevice.classList.add('hidden'));
document.getElementById('btn-confirm-device').addEventListener('click', async () => {
  const namaUnit = deviceName.value.trim();
  const tarif = Number(deviceRate.value);
  if (!namaUnit || !tarif || tarif <= 0) {
    alert('Nama device dan tarif wajib diisi');
    return;
  }
  const response = await fetch('/api/units', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nama_unit: namaUnit, tipe: deviceType.value, tarif_per_jam: tarif }),
  });
  if (!response.ok) {
    const error = await response.json();
    alert(error.error || 'Device gagal ditambahkan');
    return;
  }
  modalDevice.classList.add('hidden');
  pollUnits();
});

// ---------- POS barang ----------
const modalPos = document.getElementById('modal-pos');
const posProduct = document.getElementById('pos-product');
const posQuantity = document.getElementById('pos-quantity');
const posCartElement = document.getElementById('pos-cart');
const posTotalValue = document.getElementById('pos-total-value');
const posMethod = document.getElementById('pos-method');
const posPaid = document.getElementById('pos-paid');
const posChange = document.getElementById('pos-change');
const posProductList = document.getElementById('pos-product-list');
let posProducts = [];
let posCart = [];
let posLastTotal = 0;
let editingProductId = null;

function formatCategory(category) {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

async function loadPosProducts() {
  const response = await fetch('/api/products');
  posProducts = await response.json();
  posProduct.innerHTML = posProducts.map((product) => `<option value="${product.id}">${product.nama_produk} · ${formatRupiah(product.harga)} (${formatCategory(product.kategori)})</option>`).join('');
  posProductList.innerHTML = posProducts.map((product) => `<div class="pos-product-row"><span>${product.nama_produk} <small>${formatCategory(product.kategori)}</small></span><strong>${formatRupiah(product.harga)}</strong><button class="btn-small" data-edit-product="${product.id}">Edit</button></div>`).join('');
}

function getPosTotal() {
  return posCart.reduce((total, item) => total + item.harga * item.jumlah, 0);
}

function renderPosCart() {
  const total = getPosTotal();
  posCartElement.innerHTML = posCart.length ? posCart.map((item, index) => `
    <div class="pos-cart-item"><div><strong>${item.nama}</strong><span>${item.jumlah} × ${formatRupiah(item.harga)}</span></div><strong>${formatRupiah(item.harga * item.jumlah)}</strong><button class="cart-remove" data-cart-index="${index}" aria-label="Hapus ${item.nama}">×</button></div>
  `).join('') : '<span class="empty-note">Belum ada barang di keranjang</span>';
  posTotalValue.textContent = formatRupiah(total);
  if (!posPaid.value || Number(posPaid.value) === posLastTotal) posPaid.value = total || '';
  posLastTotal = total;
  updatePosChange();
}

function updatePosChange() {
  const total = getPosTotal();
  const paid = Number(posPaid.value) || 0;
  posChange.textContent = paid >= total && total > 0 ? `Kembalian: ${formatRupiah(paid - total)}` : total > 0 ? `Kurang: ${formatRupiah(total - paid)}` : '';
  posChange.classList.toggle('is-valid', total > 0 && paid >= total);
  posChange.classList.toggle('is-invalid', total > 0 && paid < total);
}

document.getElementById('btn-open-pos').addEventListener('click', async () => {
  await loadPosProducts();
  posCart = [];
  posLastTotal = 0;
  posMethod.value = 'tunai';
  posPaid.value = '';
  renderPosCart();
  modalPos.classList.remove('hidden');
});

function closePos() { modalPos.classList.add('hidden'); }
document.getElementById('btn-cancel-pos').addEventListener('click', closePos);
document.getElementById('btn-cancel-pos-bottom').addEventListener('click', closePos);
document.getElementById('btn-add-cart').addEventListener('click', () => {
  const product = posProducts.find((item) => item.id === Number(posProduct.value));
  const jumlah = Number(posQuantity.value);
  if (!product || !Number.isInteger(jumlah) || jumlah <= 0) return;
  const existing = posCart.find((item) => item.id === product.id);
  if (existing) existing.jumlah += jumlah;
  else posCart.push({ id: product.id, nama: product.nama_produk, harga: product.harga, jumlah });
  posQuantity.value = 1;
  renderPosCart();
});

posCartElement.addEventListener('click', (event) => {
  const button = event.target.closest('[data-cart-index]');
  if (button) { posCart.splice(Number(button.dataset.cartIndex), 1); renderPosCart(); }
});
posProductList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit-product]');
  if (!button) return;
  const product = posProducts.find((item) => item.id === Number(button.dataset.editProduct));
  if (!product) return;
  editingProductId = product.id;
  document.getElementById('new-product-name').value = product.nama_produk;
  document.getElementById('new-product-category').value = product.kategori;
  document.getElementById('new-product-price').value = product.harga;
  document.getElementById('btn-save-product').textContent = 'Update Menu';
});
posPaid.addEventListener('input', updatePosChange);
document.getElementById('btn-save-product').addEventListener('click', async () => {
  const name = document.getElementById('new-product-name').value.trim();
  const price = Number(document.getElementById('new-product-price').value);
  if (!name || !price || price <= 0) { alert('Nama dan harga menu wajib diisi'); return; }
  const response = await fetch(editingProductId ? `/api/products/${editingProductId}` : '/api/products', { method: editingProductId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nama_produk: name, kategori: document.getElementById('new-product-category').value, harga: price }) });
  if (!response.ok) { alert('Menu gagal disimpan'); return; }
  document.getElementById('new-product-name').value = '';
  document.getElementById('new-product-price').value = '';
  editingProductId = null;
  document.getElementById('btn-save-product').textContent = 'Simpan Menu';
  await loadPosProducts();
  alert('Menu berhasil disimpan');
});

document.getElementById('btn-confirm-pos').addEventListener('click', async () => {
  const total = getPosTotal();
  const paid = Number(posPaid.value) || 0;
  if (!posCart.length) { alert('Tambahkan barang ke keranjang dulu'); return; }
  if (paid < total) { alert('Nominal pembayaran masih kurang'); return; }
  const response = await fetch('/api/pos/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: posCart.map((item) => ({ produk_id: item.id, jumlah: item.jumlah })), metode_bayar: posMethod.value, jumlah_dibayar: paid }) });
  if (!response.ok) { const error = await response.json(); alert(error.error || 'Penjualan gagal disimpan'); return; }
  closePos();
});

// ---------- Event delegation untuk tombol aksi ----------
grid.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'start') {
    selectedUnitForStart = {
      id: btn.dataset.id,
      nama: btn.dataset.unit,
      tarif: Number(btn.dataset.tarif),
    };
    openStartModal();
  } else if (action === 'extend') {
    selectedUnitForExtend = { sesiId: btn.dataset.id, nama: btn.dataset.unit };
    openExtendModal();
  } else if (action === 'stop') {
    selectedSessionForStop = {
      id: btn.dataset.id,
      namaUnit: btn.dataset.unit,
      mode: btn.dataset.mode,
      total: Number(btn.dataset.total) || 0,
      tarif: Number(btn.dataset.tarif),
      waktuMulai: Number(btn.dataset.mulai),
    };
    openCashierModal();
  }
});

// ---------- Modal: Mulai Sewa ----------
const modalStart = document.getElementById('modal-start');
const inputNama = document.getElementById('input-nama');
const inputDurasi = document.getElementById('input-durasi');
const previewBiaya = document.getElementById('preview-biaya');

function openStartModal() {
  document.getElementById('modal-unit-name').textContent = selectedUnitForStart.nama;
  inputNama.value = '';
  inputDurasi.value = '';
  selectedTimeMode = 'countdown';
  previewBiaya.textContent = '';
  document.querySelectorAll('#modal-start .mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === selectedTimeMode));
  document.querySelectorAll('#modal-start .duration-buttons button, #modal-start #input-durasi').forEach((element) => { element.disabled = false; });
  document.querySelectorAll('#modal-start .duration-buttons button').forEach((b) => b.classList.remove('selected'));
  modalStart.classList.remove('hidden');
}

document.querySelectorAll('#modal-start .mode-button').forEach((button) => {
  button.addEventListener('click', () => {
    selectedTimeMode = button.dataset.mode;
    document.querySelectorAll('#modal-start .mode-button').forEach((item) => item.classList.toggle('active', item === button));
    const countdownMode = selectedTimeMode === 'countdown';
    document.querySelectorAll('#modal-start .duration-buttons button, #modal-start #input-durasi').forEach((element) => { element.disabled = !countdownMode; });
    previewBiaya.textContent = countdownMode ? '' : 'Biaya dihitung saat sesi dihentikan';
  });
});

function updatePreviewBiaya() {
  const menit = Number(inputDurasi.value) || 0;
  if (menit > 0 && selectedUnitForStart) {
    const biaya = Math.round((selectedUnitForStart.tarif / 60) * menit);
    previewBiaya.textContent = `Estimasi biaya: ${formatRupiah(biaya)}`;
  } else {
    previewBiaya.textContent = '';
  }
}

document.querySelectorAll('#modal-start .duration-buttons button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#modal-start .duration-buttons button').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    inputDurasi.value = b.dataset.menit;
    updatePreviewBiaya();
  });
});

inputDurasi.addEventListener('input', updatePreviewBiaya);

document.getElementById('btn-cancel-start').addEventListener('click', () => {
  modalStart.classList.add('hidden');
});

document.getElementById('btn-confirm-start').addEventListener('click', async () => {
  const modeWaktu = document.querySelector('#modal-start .mode-button.active')?.dataset.mode || selectedTimeMode;
  const durasi = Number(inputDurasi.value);
  if (modeWaktu === 'countdown' && (!durasi || durasi <= 0)) {
    alert('Isi durasi sewa dulu ya');
    return;
  }
  await fetch('/api/sessions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      unit_ps_id: selectedUnitForStart.id,
      nama_pelanggan: inputNama.value || '-',
      durasi_menit: durasi,
      mode_waktu: modeWaktu,
    }),
  });
  modalStart.classList.add('hidden');
  pollUnits();
});

// ---------- Modal: Kasir stopwatch ----------
const modalCashier = document.getElementById('modal-cashier');
const cashierTotal = document.getElementById('cashier-total');
const cashierDuration = document.getElementById('cashier-duration');
const cashierMethod = document.getElementById('cashier-method');
const cashierPaid = document.getElementById('cashier-paid');
const cashierChange = document.getElementById('cashier-change');
const cashierProduct = document.getElementById('cashier-product');
const cashierQuantity = document.getElementById('cashier-quantity');
const cashierCartElement = document.getElementById('cashier-cart');
const cashierItemsTotal = document.getElementById('cashier-items-total');
let cashierProducts = [];
let cashierCart = [];

async function loadCashierProducts() {
  cashierProducts = await (await fetch('/api/products')).json();
  cashierProduct.innerHTML = cashierProducts.map((product) => `<option value="${product.id}">${product.nama_produk} · ${formatRupiah(product.harga)}</option>`).join('');
}

function getCashierItemsTotal() {
  return cashierCart.reduce((sum, item) => sum + item.harga * item.jumlah, 0);
}

function renderCashierCart() {
  cashierCartElement.innerHTML = cashierCart.length ? cashierCart.map((item, index) => `<div class="pos-cart-item"><div><strong>${item.nama}</strong><span>${item.jumlah} × ${formatRupiah(item.harga)}</span></div><strong>${formatRupiah(item.harga * item.jumlah)}</strong><button class="cart-remove" data-cashier-index="${index}" aria-label="Hapus ${item.nama}">×</button></div>`).join('') : '<span class="empty-note">Belum ada snack/minuman</span>';
  cashierItemsTotal.textContent = formatRupiah(getCashierItemsTotal());
  const total = getCashierSummary().total;
  if (Number(cashierPaid.value) < total) cashierPaid.value = total;
  updateCashierSummary();
}

function getCashierSummary() {
  const durasi = Math.max(1, Math.ceil((Date.now() - selectedSessionForStop.waktuMulai) / 60000));
  const sessionTotal = selectedSessionForStop.mode === 'countdown'
    ? selectedSessionForStop.total
    : Math.round((selectedSessionForStop.tarif / 60) * durasi);
  const total = sessionTotal + getCashierItemsTotal();
  const dibayar = Number(cashierPaid.value) || 0;
  return { durasi, total, dibayar };
}

function updateCashierSummary() {
  const { total, dibayar } = getCashierSummary();
  cashierTotal.textContent = formatRupiah(total);
  cashierChange.textContent = dibayar >= total
    ? `Kembalian: ${formatRupiah(dibayar - total)}`
    : `Kurang: ${formatRupiah(total - dibayar)}`;
  cashierChange.classList.toggle('is-valid', dibayar >= total);
  cashierChange.classList.toggle('is-invalid', dibayar < total);
}

function openCashierModal() {
  document.getElementById('cashier-unit-name').textContent = selectedSessionForStop.namaUnit;
  cashierMethod.value = 'tunai';
  cashierCart = [];
  cashierQuantity.value = 1;
  loadCashierProducts().then(renderCashierCart);
  const { durasi, total } = getCashierSummary();
  cashierDuration.textContent = formatDurasiBerjalan(durasi * 60 * 1000);
  cashierPaid.value = total;
  updateCashierSummary();
  modalCashier.classList.remove('hidden');
}

document.getElementById('btn-add-cashier-item').addEventListener('click', () => {
  const product = cashierProducts.find((item) => item.id === Number(cashierProduct.value));
  const jumlah = Number(cashierQuantity.value);
  if (!product || !Number.isInteger(jumlah) || jumlah <= 0) return;
  const existing = cashierCart.find((item) => item.id === product.id);
  if (existing) existing.jumlah += jumlah;
  else cashierCart.push({ id: product.id, nama: product.nama_produk, harga: product.harga, jumlah });
  cashierQuantity.value = 1;
  renderCashierCart();
});

cashierCartElement.addEventListener('click', (event) => {
  const button = event.target.closest('[data-cashier-index]');
  if (button) { cashierCart.splice(Number(button.dataset.cashierIndex), 1); renderCashierCart(); }
});

cashierPaid.addEventListener('input', updateCashierSummary);
document.getElementById('btn-cancel-cashier').addEventListener('click', () => modalCashier.classList.add('hidden'));
document.getElementById('btn-confirm-cashier').addEventListener('click', async () => {
  const { total, dibayar } = getCashierSummary();
  if (dibayar < total) {
    alert('Nominal pembayaran masih kurang');
    return;
  }
  const response = await fetch(`/api/sessions/${selectedSessionForStop.id}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metode_bayar: cashierMethod.value, jumlah_dibayar: dibayar, items: cashierCart.map((item) => ({ produk_id: item.id, jumlah: item.jumlah })) }),
  });
  if (!response.ok) {
    const error = await response.json();
    alert(error.error || 'Gagal menyimpan transaksi');
    return;
  }
  modalCashier.classList.add('hidden');
  pollUnits();
});

// ---------- Modal: Extend ----------
const modalExtend = document.getElementById('modal-extend');
const inputExtendDurasi = document.getElementById('input-extend-durasi');

function openExtendModal() {
  document.getElementById('extend-unit-name').textContent = selectedUnitForExtend.nama;
  inputExtendDurasi.value = '';
  document.querySelectorAll('#modal-extend .duration-buttons button').forEach((b) => b.classList.remove('selected'));
  modalExtend.classList.remove('hidden');
}

document.querySelectorAll('#modal-extend .duration-buttons button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#modal-extend .duration-buttons button').forEach((x) => x.classList.remove('selected'));
    b.classList.add('selected');
    inputExtendDurasi.value = b.dataset.menit;
  });
});

document.getElementById('btn-cancel-extend').addEventListener('click', () => {
  modalExtend.classList.add('hidden');
});

document.getElementById('btn-confirm-extend').addEventListener('click', async () => {
  const menit = Number(inputExtendDurasi.value);
  if (!menit || menit <= 0) {
    alert('Isi tambahan waktu dulu ya');
    return;
  }
  await fetch(`/api/sessions/${selectedUnitForExtend.sesiId}/extend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tambahan_menit: menit }),
  });
  modalExtend.classList.add('hidden');
  pollUnits();
});
