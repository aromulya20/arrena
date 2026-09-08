const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
app.set('trust proxy', 1); // wajib di Vercel biar cookie 'secure' & IP kedeteksi bener

// Pastikan skema tabel & seed data udah siap sebelum request diproses.
// Di serverless ini cuma jalan sekali per cold start.
app.use(async (req, res, next) => {
  try {
    await db.ready();
    next();
  } catch (error) {
    console.error('DB init error:', error);
    res.status(500).json({ error: 'Database belum siap, cek DATABASE_URL' });
  }
});

app.use(bodyParser.json());
app.use(session({
  store: new pgSession({ pool: db.pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'rental-arena-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

function requirePageAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login.html');
}

function requireStaffPage(req, res, next) {
  if (req.session.user?.role === 'admin' || req.session.user?.role === 'kasir') return next();
  return next();
}

function requireSubscriberPage(req, res, next) {
  if (req.session.user?.role === 'subscriber') return next();
  if (!req.session.user) return res.redirect('/login.html');
  res.redirect('/index.html');
}

function requireApiAuth(req, res, next) {
  if (req.session.user) return next();
  res.status(401).json({ error: 'Login diperlukan' });
}

function requireAdmin(req, res, next) {
  if (req.session.user?.role === 'admin') return next();
  res.status(403).json({ error: 'Akses admin diperlukan' });
}

function requireAdminPage(req, res, next) {
  if (req.session.user?.role === 'admin') return next();
  res.redirect('/index.html');
}

// Bungkus tiap async route handler biar error-nya ketangkep otomatis (pengganti try/catch berulang)
function h(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get(['/', '/index.html'], requirePageAuth, requireStaffPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/report.html', requirePageAuth, requireStaffPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'report.html')));
app.get('/members.html', requirePageAuth, (req, res) => {
  if (req.session.user?.role === 'subscriber') {
    return res.sendFile(path.join(__dirname, 'public', 'system-dashboard.html'));
  }
  return res.sendFile(path.join(__dirname, 'public', 'members.html'));
});
app.get('/system-subscribers.html', requirePageAuth, requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'system-subscribers.html')));
app.get('/admin-dashboard.html', requirePageAuth, requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'system-subscribers.html')));
app.get('/system-dashboard.html', requireSubscriberPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'system-dashboard.html')));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- API: Auth ----------
app.post('/api/auth/login', h(async (req, res) => {
  const { username, password } = req.body;
  const user = await db.get('SELECT * FROM app_users WHERE username = ? AND aktif = 1', [username]);
  if (user && bcrypt.compareSync(password || '', user.password_hash)) {
    req.session.user = { id: user.id, nama: user.nama, username: user.username, role: user.role };
    return res.json({ user: req.session.user, redirect: '/index.html' });
  }
  const subscriber = await db.get(
    'SELECT * FROM pelanggan_sistem WHERE username = ? AND status = ? AND berakhir >= ?',
    [username, 'aktif', Date.now()]
  );
  if (subscriber && bcrypt.compareSync(password || '', subscriber.password_hash)) {
    req.session.user = { id: subscriber.id, nama: subscriber.nama_pemilik, username: subscriber.username, role: 'subscriber', subscriberId: subscriber.id };
    return res.json({ user: req.session.user, redirect: '/index.html' });
  }
  res.status(401).json({ error: 'Username atau password salah atau langganan sudah tidak aktif' });
}));

app.get('/api/auth/me', (req, res) => res.json({ user: req.session.user || null }));
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  return requireApiAuth(req, res, next);
});

app.get('/api/my-subscription', h(async (req, res) => {
  if (req.session.user?.role !== 'subscriber') return res.status(403).json({ error: 'Akses pelanggan sistem diperlukan' });
  const subscription = await db.get(
    `SELECT id, nama_usaha, nama_pemilik, telepon, email, username, nama_paket, mulai, berakhir, harga, status FROM pelanggan_sistem WHERE id = ?`,
    [req.session.user.subscriberId]
  );
  if (!subscription) return res.status(404).json({ error: 'Data langganan tidak ditemukan' });
  res.json(subscription);
}));

// ---------- Helper ----------
async function getUnitsWithSession() {
  const units = await db.all('SELECT * FROM unit_ps ORDER BY id');
  const result = [];
  for (const u of units) {
    const sesi = await db.get(
      `SELECT * FROM sesi_rental WHERE unit_ps_id = ? AND status IN ('aktif', 'belum_bayar') ORDER BY id DESC LIMIT 1`,
      [u.id]
    );
    result.push({ ...u, sesi_aktif: sesi || null });
  }
  return result;
}

function hitungBiaya(tarifPerJam, durasiMenit) {
  return Math.round((tarifPerJam / 60) * durasiMenit);
}

// Ganti pengganti setInterval: dicek tiap kali /api/units dipanggil (endpoint ini yang di-polling client
// tiap beberapa detik), jadi efeknya sama kayak dicek berkala tanpa butuh proses yang nyala terus.
async function expireOverdueSessions() {
  const now = Date.now();
  const expired = await db.all(
    `SELECT * FROM sesi_rental WHERE status = 'aktif' AND mode_waktu = 'countdown' AND waktu_selesai <= ?`,
    [now]
  );
  for (const sesi of expired) {
    await db.run(`UPDATE sesi_rental SET status = 'belum_bayar' WHERE id = ?`, [sesi.id]);
    await db.run(`UPDATE unit_ps SET status = 'kosong' WHERE id = ?`, [sesi.unit_ps_id]);
  }
  return expired;
}

// ---------- API: Unit PS ----------
app.get('/api/units', h(async (req, res) => {
  await expireOverdueSessions();
  res.json(await getUnitsWithSession());
}));

app.post('/api/units', h(async (req, res) => {
  const { nama_unit, tipe, tarif_per_jam } = req.body;
  if (!nama_unit || !tarif_per_jam) {
    return res.status(400).json({ error: 'nama_unit dan tarif_per_jam wajib diisi' });
  }
  const info = await db.run(
    'INSERT INTO unit_ps (nama_unit, tipe, tarif_per_jam, status) VALUES (?, ?, ?, ?)',
    [nama_unit, tipe || 'PS4', tarif_per_jam, 'kosong']
  );
  res.json({ id: info.lastInsertRowid });
}));

// ---------- API: POS produk ----------
app.get('/api/products', h(async (req, res) => {
  res.json(await db.all('SELECT * FROM produk WHERE aktif = 1 ORDER BY kategori, nama_produk'));
}));

app.post('/api/products', h(async (req, res) => {
  const { nama_produk, kategori, harga } = req.body;
  if (!nama_produk || !harga || harga <= 0) {
    return res.status(400).json({ error: 'Nama produk dan harga wajib diisi' });
  }
  const info = await db.run('INSERT INTO produk (nama_produk, kategori, harga) VALUES (?, ?, ?)', [nama_produk.trim(), kategori || 'lainnya', harga]);
  res.json({ id: info.lastInsertRowid });
}));

app.put('/api/products/:id', h(async (req, res) => {
  const { nama_produk, kategori, harga } = req.body;
  if (!nama_produk || !harga || harga <= 0) {
    return res.status(400).json({ error: 'Nama produk dan harga wajib diisi' });
  }
  const info = await db.run('UPDATE produk SET nama_produk = ?, kategori = ?, harga = ? WHERE id = ?', [nama_produk.trim(), kategori || 'lainnya', harga, req.params.id]);
  if (!info.changes) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  res.json({ ok: true });
}));

app.post('/api/pos/sales', h(async (req, res) => {
  const { items, metode_bayar = 'tunai', jumlah_dibayar } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Keranjang masih kosong' });
  if (!['tunai', 'qris', 'debit', 'transfer'].includes(metode_bayar)) return res.status(400).json({ error: 'Metode pembayaran tidak valid' });

  const saleItems = [];
  for (const item of items) {
    const product = await db.get('SELECT * FROM produk WHERE id = ? AND aktif = 1', [item.produk_id]);
    const jumlah = Number(item.jumlah);
    if (!product || !Number.isInteger(jumlah) || jumlah <= 0) return res.status(400).json({ error: 'Produk atau jumlah tidak valid' });
    saleItems.push({ product, jumlah, subtotal: product.harga * jumlah });
  }
  const total = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
  const dibayar = Number(jumlah_dibayar ?? total);
  if (!Number.isFinite(dibayar) || dibayar < total) return res.status(400).json({ error: 'Nominal pembayaran kurang', total_bayar: total });

  try {
    const id = await db.transaction(async (tx) => {
      const sale = await tx.run(
        'INSERT INTO penjualan_pos (total_bayar, metode_bayar, jumlah_dibayar, kembalian, waktu_penjualan) VALUES (?, ?, ?, ?, ?)',
        [total, metode_bayar, dibayar, dibayar - total, Date.now()]
      );
      for (const item of saleItems) {
        await tx.run(
          'INSERT INTO detail_penjualan_pos (penjualan_id, produk_id, jumlah, harga_satuan, subtotal) VALUES (?, ?, ?, ?, ?)',
          [sale.lastInsertRowid, item.product.id, item.jumlah, item.product.harga, item.subtotal]
        );
      }
      return sale.lastInsertRowid;
    });
    res.json({ ok: true, id, total_bayar: total, kembalian: dibayar - total });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}));

// ---------- API: Langganan pelanggan ----------
app.get('/api/subscriptions', h(async (req, res) => {
  const rows = await db.all(`
    SELECT l.*, p.nama, p.telepon, p.email,
           CASE WHEN l.berakhir >= ? THEN 'aktif' ELSE 'expired' END as status_aktual
    FROM langganan l JOIN pelanggan p ON p.id = l.pelanggan_id
    ORDER BY l.berakhir DESC, l.id DESC
  `, [Date.now()]);
  res.json(rows);
}));

app.post('/api/subscriptions', requireAdmin, h(async (req, res) => {
  const { nama, telepon, email, nama_paket, mulai, berakhir, harga } = req.body;
  const mulaiMs = new Date(`${mulai}T00:00:00`).getTime();
  const berakhirMs = new Date(`${berakhir}T23:59:59`).getTime();
  if (!nama || !nama_paket || !Number.isFinite(mulaiMs) || !Number.isFinite(berakhirMs) || berakhirMs < mulaiMs) {
    return res.status(400).json({ error: 'Data pelanggan dan periode langganan wajib valid' });
  }
  const id = await db.transaction(async (tx) => {
    const customer = await tx.run('INSERT INTO pelanggan (nama, telepon, email, created_at) VALUES (?, ?, ?, ?)', [nama.trim(), telepon || '', email || '', Date.now()]);
    const subscription = await tx.run(
      'INSERT INTO langganan (pelanggan_id, nama_paket, mulai, berakhir, harga, status) VALUES (?, ?, ?, ?, ?, ?)',
      [customer.lastInsertRowid, nama_paket, mulaiMs, berakhirMs, Number(harga) || 0, 'aktif']
    );
    return subscription.lastInsertRowid;
  });
  res.json({ ok: true, id });
}));

app.post('/api/subscriptions/:id/extend', requireAdmin, h(async (req, res) => {
  const tambahanHari = Number(req.body.tambahan_hari);
  if (!Number.isInteger(tambahanHari) || tambahanHari <= 0) return res.status(400).json({ error: 'Tambahan hari tidak valid' });
  const subscription = await db.get('SELECT * FROM langganan WHERE id = ?', [req.params.id]);
  if (!subscription) return res.status(404).json({ error: 'Langganan tidak ditemukan' });
  const mulaiDari = Math.max(Date.now(), Number(subscription.berakhir));
  const berakhirBaru = mulaiDari + tambahanHari * 24 * 60 * 60 * 1000;
  await db.run(`UPDATE langganan SET berakhir = ?, status = 'aktif' WHERE id = ?`, [berakhirBaru, req.params.id]);
  res.json({ ok: true, berakhir: berakhirBaru });
}));

app.get('/api/subscriptions/summary', h(async (req, res) => {
  const now = Date.now();
  const total = (await db.get('SELECT COUNT(*) as c FROM langganan')).c;
  const aktif = (await db.get('SELECT COUNT(*) as c FROM langganan WHERE berakhir >= ?', [now])).c;
  const akanBerakhir = (await db.get('SELECT COUNT(*) as c FROM langganan WHERE berakhir >= ? AND berakhir < ?', [now, now + 7 * 24 * 60 * 60 * 1000])).c;
  res.json({ total: Number(total), aktif: Number(aktif), akan_berakhir: Number(akanBerakhir) });
}));

// ---------- API: Pelanggan berlangganan sistem ----------
app.get('/api/system-subscribers', requireAdmin, h(async (req, res) => {
  const rows = await db.all(`
    SELECT id, nama_usaha, nama_pemilik, telepon, email, username, nama_paket, mulai, berakhir, harga,
           CASE WHEN berakhir < ? THEN 'expired' WHEN berakhir < ? THEN 'segera_berakhir' ELSE status END as status_aktual
    FROM pelanggan_sistem ORDER BY berakhir DESC, id DESC
  `, [Date.now(), Date.now() + 7 * 24 * 60 * 60 * 1000]);
  res.json(rows);
}));

app.get('/api/system-subscribers/summary', requireAdmin, h(async (req, res) => {
  const now = Date.now();
  const total = (await db.get('SELECT COUNT(*) as c FROM pelanggan_sistem')).c;
  const aktif = (await db.get('SELECT COUNT(*) as c FROM pelanggan_sistem WHERE status = ? AND berakhir >= ?', ['aktif', now])).c;
  const segeraBerakhir = (await db.get('SELECT COUNT(*) as c FROM pelanggan_sistem WHERE status = ? AND berakhir >= ? AND berakhir < ?', ['aktif', now, now + 7 * 24 * 60 * 60 * 1000])).c;
  const pendapatan = (await db.get('SELECT COALESCE(SUM(harga), 0) as total FROM pelanggan_sistem WHERE mulai >= ?', [new Date(new Date().setHours(0, 0, 0, 0)).getTime()])).total;
  res.json({ total: Number(total), aktif: Number(aktif), segera_berakhir: Number(segeraBerakhir), pendapatan: Number(pendapatan) });
}));

app.post('/api/system-subscribers', requireAdmin, h(async (req, res) => {
  const { nama_usaha, nama_pemilik, telepon, email, username, password, nama_paket, mulai, berakhir, harga } = req.body;
  const mulaiMs = new Date(`${mulai}T00:00:00`).getTime();
  const berakhirMs = new Date(`${berakhir}T23:59:59`).getTime();
  if (!nama_usaha || !nama_pemilik || !username || !password || !nama_paket || !Number.isFinite(mulaiMs) || !Number.isFinite(berakhirMs) || berakhirMs < mulaiMs) {
    return res.status(400).json({ error: 'Data usaha, akun, dan periode wajib valid' });
  }
  try {
    const info = await db.run(`
      INSERT INTO pelanggan_sistem (nama_usaha, nama_pemilik, telepon, email, username, password_hash, nama_paket, mulai, berakhir, harga, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aktif', ?)
    `, [nama_usaha.trim(), nama_pemilik.trim(), telepon || '', email || '', username.trim(), bcrypt.hashSync(password, 10), nama_paket.trim(), mulaiMs, berakhirMs, Number(harga) || 0, Date.now()]);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (error) {
    res.status(400).json({ error: error.code === '23505' ? 'Username sudah digunakan' : error.message });
  }
}));

app.post('/api/system-subscribers/:id/extend', requireAdmin, h(async (req, res) => {
  const tambahanBulan = Number(req.body.tambahan_bulan);
  if (!Number.isInteger(tambahanBulan) || tambahanBulan <= 0) return res.status(400).json({ error: 'Tambahan bulan tidak valid' });
  const subscriber = await db.get('SELECT * FROM pelanggan_sistem WHERE id = ?', [req.params.id]);
  if (!subscriber) return res.status(404).json({ error: 'Pelanggan sistem tidak ditemukan' });
  const from = Math.max(Date.now(), Number(subscriber.berakhir));
  const date = new Date(from);
  date.setMonth(date.getMonth() + tambahanBulan);
  await db.run(`UPDATE pelanggan_sistem SET berakhir = ?, status = 'aktif' WHERE id = ?`, [date.getTime(), req.params.id]);
  res.json({ ok: true, berakhir: date.getTime() });
}));

app.put('/api/system-subscribers/:id', requireAdmin, h(async (req, res) => {
  const { nama_usaha, nama_pemilik, telepon, email, username, password, nama_paket, mulai, berakhir, harga } = req.body;
  const mulaiMs = new Date(`${mulai}T00:00:00`).getTime();
  const berakhirMs = new Date(`${berakhir}T23:59:59`).getTime();
  if (!nama_usaha || !nama_pemilik || !username || !nama_paket || !Number.isFinite(mulaiMs) || !Number.isFinite(berakhirMs) || berakhirMs < mulaiMs) {
    return res.status(400).json({ error: 'Data usaha, akun, dan periode wajib valid' });
  }
  try {
    const passwordPart = password ? ', password_hash = ?' : '';
    const values = [nama_usaha.trim(), nama_pemilik.trim(), telepon || '', email || '', username.trim(), nama_paket.trim(), mulaiMs, berakhirMs, Number(harga) || 0];
    if (password) values.push(bcrypt.hashSync(password, 10));
    values.push(req.params.id);
    await db.run(`UPDATE pelanggan_sistem SET nama_usaha = ?, nama_pemilik = ?, telepon = ?, email = ?, username = ?, nama_paket = ?, mulai = ?, berakhir = ?, harga = ?${passwordPart} WHERE id = ?`, values);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.code === '23505' ? 'Username sudah digunakan' : error.message });
  }
}));

app.post('/api/system-subscribers/:id/deactivate', requireAdmin, h(async (req, res) => {
  const info = await db.run(`UPDATE pelanggan_sistem SET status = 'nonaktif' WHERE id = ?`, [req.params.id]);
  if (!info.changes) return res.status(404).json({ error: 'Pelanggan sistem tidak ditemukan' });
  res.json({ ok: true });
}));

// ---------- API: Sesi Rental ----------
app.post('/api/sessions/start', h(async (req, res) => {
  const { unit_ps_id, nama_pelanggan, durasi_menit, mode_waktu = 'countdown' } = req.body;

  if (!unit_ps_id || !['countdown', 'stopwatch'].includes(mode_waktu)) {
    return res.status(400).json({ error: 'unit_ps_id dan mode waktu wajib diisi' });
  }
  if (mode_waktu === 'countdown' && (!durasi_menit || durasi_menit <= 0)) {
    return res.status(400).json({ error: 'durasi_menit wajib diisi untuk mode countdown' });
  }

  const unit = await db.get('SELECT * FROM unit_ps WHERE id = ?', [unit_ps_id]);
  if (!unit) return res.status(404).json({ error: 'Unit tidak ditemukan' });
  if (unit.status !== 'kosong') {
    return res.status(400).json({ error: 'Unit sedang dipakai atau maintenance' });
  }

  const waktuMulai = Date.now();
  const durasi = mode_waktu === 'stopwatch' ? 0 : Number(durasi_menit);
  const waktuSelesai = mode_waktu === 'stopwatch' ? 0 : waktuMulai + durasi * 60 * 1000;
  const totalBayar = mode_waktu === 'stopwatch' ? 0 : hitungBiaya(unit.tarif_per_jam, durasi);

  const info = await db.run(
    `INSERT INTO sesi_rental (unit_ps_id, nama_pelanggan, waktu_mulai, durasi_menit, waktu_selesai, status, total_bayar, mode_waktu)
     VALUES (?, ?, ?, ?, ?, 'aktif', ?, ?)`,
    [unit_ps_id, nama_pelanggan || '-', waktuMulai, durasi, waktuSelesai, totalBayar, mode_waktu]
  );

  await db.run(`UPDATE unit_ps SET status = 'dipakai' WHERE id = ?`, [unit_ps_id]);

  res.json({ id: info.lastInsertRowid, total_bayar: totalBayar, waktu_selesai: waktuSelesai, mode_waktu });
}));

app.post('/api/sessions/:id/extend', h(async (req, res) => {
  const { id } = req.params;
  const { tambahan_menit } = req.body;
  if (!tambahan_menit) return res.status(400).json({ error: 'tambahan_menit wajib diisi' });

  const sesi = await db.get(`SELECT * FROM sesi_rental WHERE id = ? AND status = 'aktif'`, [id]);
  if (!sesi) return res.status(404).json({ error: 'Sesi aktif tidak ditemukan' });

  const unit = await db.get('SELECT * FROM unit_ps WHERE id = ?', [sesi.unit_ps_id]);
  if (sesi.mode_waktu === 'stopwatch') {
    return res.status(400).json({ error: 'Stopwatch tidak memakai tambahan waktu' });
  }
  const tambahanBiaya = hitungBiaya(unit.tarif_per_jam, tambahan_menit);
  const waktuSelesaiBaru = Number(sesi.waktu_selesai) + tambahan_menit * 60 * 1000;

  await db.run(
    `UPDATE sesi_rental SET durasi_menit = durasi_menit + ?, waktu_selesai = ?, total_bayar = total_bayar + ? WHERE id = ?`,
    [tambahan_menit, waktuSelesaiBaru, tambahanBiaya, id]
  );

  res.json({ ok: true, waktu_selesai: waktuSelesaiBaru, tambahan_biaya: tambahanBiaya });
}));

app.post('/api/sessions/:id/stop', h(async (req, res) => {
  const { id } = req.params;
  const { metode_bayar = 'tunai', jumlah_dibayar, items = [] } = req.body || {};
  const sesi = await db.get(`SELECT * FROM sesi_rental WHERE id = ? AND status IN ('aktif', 'belum_bayar')`, [id]);
  if (!sesi) return res.status(404).json({ error: 'Sesi aktif tidak ditemukan' });

  let totalBayar = sesi.total_bayar;
  const jumlahDibayar = Number(jumlah_dibayar ?? totalBayar);
  if (!['tunai', 'qris', 'debit', 'transfer'].includes(metode_bayar)) {
    return res.status(400).json({ error: 'Metode pembayaran tidak valid' });
  }

  const activeProducts = await db.all('SELECT id, nama_produk, harga FROM produk WHERE aktif = 1');
  if (!Number.isFinite(jumlahDibayar) || jumlahDibayar < totalBayar) {
    const extraTotal = Array.isArray(items) ? items.reduce((sum, item) => {
      const product = activeProducts.find((row) => row.id === Number(item.produk_id));
      return product && Number.isInteger(Number(item.jumlah)) ? sum + product.harga * Number(item.jumlah) : sum;
    }, 0) : 0;
    return res.status(400).json({ error: 'Nominal pembayaran kurang', total_bayar: totalBayar + extraTotal });
  }

  const billItems = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const product = await db.get('SELECT * FROM produk WHERE id = ? AND aktif = 1', [item.produk_id]);
    const jumlah = Number(item.jumlah);
    if (!product || !Number.isInteger(jumlah) || jumlah <= 0) return res.status(400).json({ error: 'Produk atau jumlah tidak valid' });
    billItems.push({ product, jumlah, subtotal: product.harga * jumlah });
  }
  const extraTotal = billItems.reduce((sum, item) => sum + item.subtotal, 0);
  totalBayar += extraTotal;
  if (!Number.isFinite(jumlahDibayar) || jumlahDibayar < totalBayar) {
    return res.status(400).json({ error: 'Nominal pembayaran kurang', total_bayar: totalBayar });
  }

  await db.transaction(async (tx) => {
    if (sesi.mode_waktu === 'stopwatch') {
      const durasiAktual = Math.max(1, Math.ceil((Date.now() - Number(sesi.waktu_mulai)) / 60000));
      const unit = await tx.get('SELECT * FROM unit_ps WHERE id = ?', [sesi.unit_ps_id]);
      totalBayar = hitungBiaya(unit.tarif_per_jam, durasiAktual) + extraTotal;
      await tx.run(`UPDATE sesi_rental SET status = 'selesai', durasi_menit = ?, total_bayar = ? WHERE id = ?`, [durasiAktual, totalBayar, id]);
    } else {
      await tx.run(`UPDATE sesi_rental SET status = 'selesai', total_bayar = ? WHERE id = ?`, [totalBayar, id]);
    }
    for (const item of billItems) {
      await tx.run(
        'INSERT INTO detail_sesi_barang (sesi_rental_id, produk_id, jumlah, harga_satuan, subtotal) VALUES (?, ?, ?, ?, ?)',
        [id, item.product.id, item.jumlah, item.product.harga, item.subtotal]
      );
    }
    await tx.run(
      `INSERT INTO transaksi (sesi_rental_id, metode_bayar, jumlah_bayar, jumlah_dibayar, kembalian, waktu_transaksi)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, metode_bayar, totalBayar, jumlahDibayar, jumlahDibayar - totalBayar, Date.now()]
    );
    await tx.run(`UPDATE unit_ps SET status = 'kosong' WHERE id = ?`, [sesi.unit_ps_id]);
  });

  res.json({ ok: true, total_bayar: totalBayar });
}));

// ---------- API: Laporan / Riwayat ----------
app.get('/api/transactions', h(async (req, res) => {
  const rows = await db.all(
    `SELECT * FROM (
       SELECT t.id, t.jumlah_bayar, t.waktu_transaksi, t.metode_bayar, t.jumlah_dibayar, t.kembalian,
              s.nama_pelanggan, s.durasi_menit, s.status as status_sesi,
              u.nama_unit
       FROM transaksi t
       JOIN sesi_rental s ON s.id = t.sesi_rental_id
       JOIN unit_ps u ON u.id = s.unit_ps_id
       UNION ALL
       SELECT -p.id as id, p.total_bayar as jumlah_bayar, p.waktu_penjualan as waktu_transaksi,
              p.metode_bayar, p.jumlah_dibayar, p.kembalian, 'Kasir' as nama_pelanggan,
              0 as durasi_menit, 'selesai' as status_sesi, 'Penjualan POS' as nama_unit
       FROM penjualan_pos p
      ) laporan
      ORDER BY waktu_transaksi DESC
      LIMIT 200`
  );
  res.json(rows);
}));

app.get('/api/report/summary', h(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfDay = today.getTime();

  const rentalRevenueToday = (await db.get(`SELECT COALESCE(SUM(jumlah_bayar),0) as total FROM transaksi WHERE waktu_transaksi >= ?`, [startOfDay])).total;
  const posRevenueToday = (await db.get(`SELECT COALESCE(SUM(total_bayar),0) as total FROM penjualan_pos WHERE waktu_penjualan >= ?`, [startOfDay])).total;
  const totalHariIni = Number(rentalRevenueToday) + Number(posRevenueToday);

  const rentalTransactionsToday = (await db.get(`SELECT COUNT(*) as c FROM transaksi WHERE waktu_transaksi >= ?`, [startOfDay])).c;
  const posTransactionsToday = (await db.get(`SELECT COUNT(*) as c FROM penjualan_pos WHERE waktu_penjualan >= ?`, [startOfDay])).c;
  const totalTransaksiHariIni = Number(rentalTransactionsToday) + Number(posTransactionsToday);

  const totalSesiSelesaiHariIni = (await db.get(`SELECT COUNT(*) as c FROM sesi_rental WHERE status = 'selesai' AND waktu_mulai >= ?`, [startOfDay])).c;
  const rentalByMethod = await db.all(`SELECT metode_bayar, COALESCE(SUM(jumlah_bayar), 0) as total FROM transaksi WHERE waktu_transaksi >= ? GROUP BY metode_bayar`, [startOfDay]);
  const posByMethod = await db.all(`SELECT metode_bayar, COALESCE(SUM(total_bayar), 0) as total FROM penjualan_pos WHERE waktu_penjualan >= ? GROUP BY metode_bayar`, [startOfDay]);
  const pendapatanPerMetode = [...rentalByMethod, ...posByMethod]
    .reduce((result, row) => ({ ...result, [row.metode_bayar]: (result[row.metode_bayar] || 0) + Number(row.total) }), {});

  res.json({
    total_pendapatan_hari_ini: totalHariIni,
    jumlah_transaksi_hari_ini: totalTransaksiHariIni,
    total_sesi_selesai_hari_ini: Number(totalSesiSelesaiHariIni),
    rata_rata_transaksi_hari_ini: totalTransaksiHariIni ? Math.round(totalHariIni / totalTransaksiHariIni) : 0,
    pendapatan_per_metode: pendapatanPerMetode,
  });
}));

app.get('/api/report/monthly', h(async (req, res) => {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(req.query.month || '');
  const now = new Date();
  const year = monthMatch ? Number(monthMatch[1]) : now.getFullYear();
  const monthIndex = monthMatch ? Number(monthMatch[2]) - 1 : now.getMonth();
  if (monthIndex < 0 || monthIndex > 11) {
    return res.status(400).json({ error: 'Format bulan tidak valid' });
  }

  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, index) => ({
    tanggal: index + 1,
    nama_hari: new Date(year, monthIndex, index + 1).toLocaleDateString('id-ID', { weekday: 'short' }),
    total_pendapatan: 0,
    jumlah_transaksi: 0,
  }));
  const rentalRows = await db.all(`SELECT jumlah_bayar, waktu_transaksi FROM transaksi WHERE waktu_transaksi >= ? AND waktu_transaksi < ?`, [start.getTime(), end.getTime()]);
  const posRows = await db.all(`SELECT total_bayar as jumlah_bayar, waktu_penjualan as waktu_transaksi FROM penjualan_pos WHERE waktu_penjualan >= ? AND waktu_penjualan < ?`, [start.getTime(), end.getTime()]);

  [...rentalRows, ...posRows].forEach((row) => {
    const date = new Date(Number(row.waktu_transaksi));
    if (date.getFullYear() === year && date.getMonth() === monthIndex) {
      const day = days[date.getDate() - 1];
      day.total_pendapatan += Number(row.jumlah_bayar);
      day.jumlah_transaksi += 1;
    }
  });
  res.json({ year, month: monthIndex + 1, days });
}));

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Rental PS Billing berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;
