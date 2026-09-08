function formatRupiah(angka) {
  return 'Rp' + angka.toLocaleString('id-ID');
}

function formatWaktu(ts) {
  return new Date(ts).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

let transactionRows = [];

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function renderPaymentBreakdown(methods) {
  const labels = { tunai: 'Tunai', qris: 'QRIS', debit: 'Debit', transfer: 'Transfer' };
  const entries = Object.entries(methods);
  document.getElementById('payment-breakdown').innerHTML = `
    <div class="breakdown-title"><span class="eyebrow accent-text">PAYMENT MIX</span><strong>Metode pembayaran hari ini</strong></div>
    <div class="breakdown-items">${entries.length ? entries.map(([method, amount]) => `<div class="breakdown-item"><span>${labels[method] || method}</span><strong>${formatRupiah(amount)}</strong></div>`).join('') : '<span class="empty-note">Belum ada transaksi hari ini</span>'}</div>
  `;
}

async function loadSummary() {
  const res = await fetch('/api/report/summary');
  const data = await res.json();
  document.getElementById('summary-cards').innerHTML = `
    <div class="summary-card">
      <div class="label">Pendapatan Hari Ini</div>
      <div class="value">${formatRupiah(data.total_pendapatan_hari_ini)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Jumlah Transaksi Hari Ini</div>
      <div class="value">${data.jumlah_transaksi_hari_ini}</div>
    </div>
    <div class="summary-card">
      <div class="label">Total Sesi Selesai</div>
      <div class="value">${data.total_sesi_selesai_hari_ini}</div>
    </div>
    <div class="summary-card">
      <div class="label">Rata-rata Transaksi</div>
      <div class="value">${formatRupiah(data.rata_rata_transaksi_hari_ini)}</div>
    </div>
  `;
  renderPaymentBreakdown(data.pendapatan_per_metode);
}

async function loadTransactions() {
  const res = await fetch('/api/transactions');
  const rows = await res.json();
  transactionRows = rows;
  renderTransactions();
}

async function loadMonthlyRevenue() {
  const month = document.getElementById('report-month').value;
  const res = await fetch(`/api/report/monthly?month=${month}`);
  const data = await res.json();
  const total = data.days.reduce((sum, day) => sum + day.total_pendapatan, 0);
  const totalTransactions = data.days.reduce((sum, day) => sum + day.jumlah_transaksi, 0);
  const maxRevenue = Math.max(...data.days.map((day) => day.total_pendapatan), 1);
  document.getElementById('monthly-summary').innerHTML = `
    <div><span>Total bulan</span><strong>${formatRupiah(total)}</strong></div>
    <div><span>Hari bertransaksi</span><strong>${data.days.filter((day) => day.total_pendapatan > 0).length} hari</strong></div>
    <div><span>Transaksi</span><strong>${totalTransactions}</strong></div>
  `;
  document.getElementById('daily-revenue').innerHTML = data.days.map((day) => `
    <div class="daily-row ${day.total_pendapatan ? 'has-revenue' : ''}">
      <div class="daily-date"><strong>${String(day.tanggal).padStart(2, '0')}</strong><span>${day.nama_hari}</span></div>
      <div class="daily-bar"><span style="width: ${(day.total_pendapatan / maxRevenue) * 100}%"></span></div>
      <div class="daily-value"><strong>${formatRupiah(day.total_pendapatan)}</strong><span>${day.jumlah_transaksi} transaksi</span></div>
    </div>
  `).join('');
}

function renderTransactions() {
  const query = document.getElementById('report-search').value.toLowerCase().trim();
  const method = document.getElementById('report-method').value;
  const rows = transactionRows.filter((r) => {
    const haystack = `${r.nama_unit} ${r.nama_pelanggan}`.toLowerCase();
    return haystack.includes(query) && (method === 'all' || r.metode_bayar === method);
  });
  document.getElementById('report-count').textContent = `${rows.length}/${transactionRows.length}`;
  const tbody = document.getElementById('report-body');
  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${formatWaktu(r.waktu_transaksi)}</td>
      <td>${r.nama_unit}</td>
      <td>${r.nama_pelanggan}</td>
      <td>${r.durasi_menit}</td>
      <td>${formatRupiah(r.jumlah_bayar)}</td>
      <td>${formatRupiah(r.jumlah_dibayar || r.jumlah_bayar)}</td>
      <td>${r.metode_bayar.toUpperCase()}</td>
      <td>${formatRupiah(r.kembalian || 0)}</td>
      <td>${r.status_sesi}</td>
    </tr>
  `
    )
    .join('');
}

function exportCsv() {
  const headers = ['Waktu', 'Unit', 'Pelanggan', 'Durasi Menit', 'Tagihan', 'Dibayar', 'Metode', 'Kembalian', 'Status'];
  const lines = transactionRows.map((r) => [
    formatWaktu(r.waktu_transaksi), r.nama_unit, r.nama_pelanggan, r.durasi_menit,
    r.jumlah_bayar, r.jumlah_dibayar || r.jumlah_bayar, r.metode_bayar, r.kembalian || 0, r.status_sesi,
  ].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','));
  const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `laporan-rental-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

document.getElementById('report-search').addEventListener('input', renderTransactions);
document.getElementById('report-method').addEventListener('change', renderTransactions);
document.getElementById('btn-export').addEventListener('click', exportCsv);
document.getElementById('report-month').value = getCurrentMonth();
document.getElementById('report-month').addEventListener('change', loadMonthlyRevenue);

loadSummary();
loadTransactions();
loadMonthlyRevenue();
