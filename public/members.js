function formatRupiah(amount) { return 'Rp' + Number(amount || 0).toLocaleString('id-ID'); }
function formatDate(timestamp) { return new Date(timestamp).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
let members = [];

async function loadMembers() {
  const response = await fetch('/api/subscriptions');
  if (response.status === 401) { window.location.href = '/login.html'; return; }
  members = await response.json();
  renderMembers();
}
async function loadStats() {
  const data = await (await fetch('/api/subscriptions/summary')).json();
  document.getElementById('member-stats').innerHTML = `<div class="stat-card stat-active"><span class="stat-icon">◉</span><div><span class="stat-label">Total langganan</span><strong>${data.total}</strong><small>semua riwayat</small></div></div><div class="stat-card stat-ready"><span class="stat-icon">＋</span><div><span class="stat-label">Aktif sekarang</span><strong>${data.aktif}</strong><small>user berlangganan</small></div></div><div class="stat-card stat-maintenance"><span class="stat-icon">⌁</span><div><span class="stat-label">Segera berakhir</span><strong>${data.akan_berakhir}</strong><small>dalam 7 hari</small></div></div>`;
}
function renderMembers() {
  const query = document.getElementById('member-search').value.toLowerCase().trim();
  const rows = members.filter((member) => `${member.nama} ${member.telepon} ${member.email} ${member.nama_paket}`.toLowerCase().includes(query));
  document.getElementById('member-count').textContent = `${rows.length}/${members.length}`;
  document.getElementById('member-body').innerHTML = rows.length ? rows.map((member) => `<tr><td><strong>${member.nama}</strong></td><td>${member.telepon || '-'}<br><small>${member.email || ''}</small></td><td>${member.nama_paket}</td><td>${formatDate(member.mulai)} - ${formatDate(member.berakhir)}</td><td>${formatRupiah(member.harga)}</td><td><span class="status-badge status-${member.status_aktual === 'aktif' ? 'kosong' : 'maintenance'}">${member.status_aktual.toUpperCase()}</span></td><td><button class="btn-small" data-extend-id="${member.id}">+ 30 Hari</button></td></tr>`).join('') : '<tr><td colspan="7">Belum ada data langganan.</td></tr>';
}
function todayValue() { return new Date().toISOString().slice(0, 10); }
function openMemberModal() { const today = todayValue(); document.getElementById('member-start').value = today; document.getElementById('member-end').value = today; document.getElementById('member-modal').classList.remove('hidden'); }
function closeMemberModal() { document.getElementById('member-modal').classList.add('hidden'); }

document.getElementById('btn-open-member').addEventListener('click', openMemberModal);
document.getElementById('btn-cancel-member').addEventListener('click', closeMemberModal);
document.getElementById('member-search').addEventListener('input', renderMembers);
document.getElementById('btn-logout').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login.html'; });
document.getElementById('member-body').addEventListener('click', async (event) => { const button = event.target.closest('[data-extend-id]'); if (!button) return; const days = Number(prompt('Tambahkan berapa hari?', '30')); if (!days) return; const response = await fetch(`/api/subscriptions/${button.dataset.extendId}/extend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tambahan_hari: days }) }); if (!response.ok) { const error = await response.json(); alert(error.error || 'Gagal memperpanjang'); return; } await loadMembers(); await loadStats(); });
document.getElementById('btn-save-member').addEventListener('click', async () => { const response = await fetch('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nama: document.getElementById('member-name').value.trim(), telepon: document.getElementById('member-phone').value.trim(), email: document.getElementById('member-email').value.trim(), nama_paket: document.getElementById('member-package').value.trim(), mulai: document.getElementById('member-start').value, berakhir: document.getElementById('member-end').value, harga: Number(document.getElementById('member-price').value) || 0 }) }); if (!response.ok) { const error = await response.json(); alert(error.error || 'Gagal menyimpan'); return; } closeMemberModal(); document.querySelectorAll('#member-modal input').forEach((input) => { if (input.type !== 'date') input.value = ''; }); await loadMembers(); await loadStats(); });
loadMembers();
loadStats();
