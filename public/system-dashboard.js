function formatRupiah(amount) { return 'Rp' + Number(amount || 0).toLocaleString('id-ID'); }
function formatDate(timestamp) { return new Date(timestamp).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }); }
function daysLeft(timestamp) { return Math.max(0, Math.ceil((timestamp - Date.now()) / 86400000)); }

async function loadPortal() {
  const response = await fetch('/api/my-subscription');
  if (response.status === 401) { window.location.href = '/login.html'; return; }
  if (!response.ok) { document.getElementById('portal-business').textContent = 'Data tidak tersedia'; return; }
  const data = await response.json();
  const remaining = daysLeft(data.berakhir);
  const active = data.status === 'aktif' && remaining > 0;
  document.getElementById('portal-business').textContent = data.nama_usaha;
  document.getElementById('portal-status').textContent = active ? 'AKTIF' : 'EXPIRED';
  document.getElementById('portal-status').className = `status-badge ${active ? 'status-kosong' : 'status-maintenance'}`;
  document.getElementById('portal-stats').innerHTML = `<div class="stat-card ${active ? 'stat-ready' : 'stat-maintenance'}"><span class="stat-icon">◉</span><div><span class="stat-label">Status akses</span><strong>${active ? 'Aktif' : 'Expired'}</strong><small>${active ? 'Sistem siap digunakan' : 'Hubungi admin untuk lanjut'}</small></div></div><div class="stat-card"><span class="stat-icon">⌁</span><div><span class="stat-label">Sisa masa aktif</span><strong>${remaining}</strong><small>hari lagi</small></div></div><div class="stat-card"><span class="stat-icon">◈</span><div><span class="stat-label">Paket</span><strong>${data.nama_paket}</strong><small>langganan sistem</small></div></div>`;
  document.getElementById('portal-package').textContent = data.nama_paket;
  document.getElementById('portal-period').textContent = `${formatDate(data.mulai)} - ${formatDate(data.berakhir)}`;
  document.getElementById('portal-price').textContent = formatRupiah(data.harga);
  document.getElementById('portal-owner').textContent = data.nama_pemilik;
  document.getElementById('portal-username').textContent = data.username;
  document.getElementById('portal-contact').textContent = `${data.email || '-'} / ${data.telepon || '-'}`;
}

document.getElementById('btn-logout').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login.html'; });
loadPortal();
