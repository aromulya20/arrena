const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// Kolom timestamp di skema ini pakai BIGINT (unix ms). Driver pg secara default
// balikin BIGINT sebagai STRING (biar gak kehilangan presisi angka besar), tapi
// itu bikin `new Date(stringnya)` di client salah parse (bukan dianggap epoch ms).
// Nilai ms timestamp kita jauh di bawah Number.MAX_SAFE_INTEGER, jadi aman di-parse jadi Number biasa.
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10))); // OID 20 = BIGINT

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL belum di-set. Isi env var ini dengan connection string Supabase (pooled, port 6543).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 5,
});

// Konversi placeholder gaya better-sqlite3 (?) ke gaya pg ($1, $2, ...)
// supaya query lama gak perlu ditulis ulang manual satu-satu.
function toPgQuery(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function buildRunQuery(sql) {
  const query = toPgQuery(sql);
  const isInsert = /^\s*INSERT/i.test(query) && !/RETURNING/i.test(query);
  return { query: isInsert ? `${query} RETURNING id` : query, isInsert };
}

async function get(sql, params = []) {
  const result = await pool.query(toPgQuery(sql), params);
  return result.rows[0];
}

async function all(sql, params = []) {
  const result = await pool.query(toPgQuery(sql), params);
  return result.rows;
}

async function run(sql, params = []) {
  const { query, isInsert } = buildRunQuery(sql);
  const result = await pool.query(query, params);
  return {
    lastInsertRowid: isInsert && result.rows[0] ? result.rows[0].id : undefined,
    changes: result.rowCount,
  };
}

// Bungkus beberapa query jadi satu transaksi (pengganti db.transaction() better-sqlite3).
// Pakai: await db.transaction(async (tx) => { await tx.run(...); await tx.get(...); });
async function transaction(callback) {
  const client = await pool.connect();
  const tx = {
    get: async (sql, params = []) => (await client.query(toPgQuery(sql), params)).rows[0],
    all: async (sql, params = []) => (await client.query(toPgQuery(sql), params)).rows,
    run: async (sql, params = []) => {
      const { query, isInsert } = buildRunQuery(sql);
      const result = await client.query(query, params);
      return {
        lastInsertRowid: isInsert && result.rows[0] ? result.rows[0].id : undefined,
        changes: result.rowCount,
      };
    },
  };
  try {
    await client.query('BEGIN');
    const returnValue = await callback(tx);
    await client.query('COMMIT');
    return returnValue;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---- Skema tabel (Postgres) ----
// Catatan: kolom waktu pakai BIGINT (bukan INTEGER) karena nyimpen unix timestamp
// dalam milidetik -- INTEGER di Postgres cuma sanggup ~24 hari dari epoch.
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS unit_ps (
      id SERIAL PRIMARY KEY,
      nama_unit TEXT NOT NULL,
      tipe TEXT DEFAULT 'PS4',
      tarif_per_jam INTEGER NOT NULL DEFAULT 5000,
      status TEXT NOT NULL DEFAULT 'kosong'
    );

    CREATE TABLE IF NOT EXISTS sesi_rental (
      id SERIAL PRIMARY KEY,
      unit_ps_id INTEGER NOT NULL REFERENCES unit_ps(id),
      nama_pelanggan TEXT,
      waktu_mulai BIGINT NOT NULL,
      durasi_menit INTEGER NOT NULL,
      waktu_selesai BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'aktif',
      total_bayar INTEGER NOT NULL DEFAULT 0,
      mode_waktu TEXT NOT NULL DEFAULT 'countdown'
    );

    CREATE TABLE IF NOT EXISTS transaksi (
      id SERIAL PRIMARY KEY,
      sesi_rental_id INTEGER NOT NULL REFERENCES sesi_rental(id),
      metode_bayar TEXT DEFAULT 'tunai',
      jumlah_bayar INTEGER NOT NULL,
      waktu_transaksi BIGINT NOT NULL,
      jumlah_dibayar INTEGER NOT NULL DEFAULT 0,
      kembalian INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS produk (
      id SERIAL PRIMARY KEY,
      nama_produk TEXT NOT NULL,
      kategori TEXT NOT NULL DEFAULT 'lainnya',
      harga INTEGER NOT NULL,
      aktif INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS penjualan_pos (
      id SERIAL PRIMARY KEY,
      total_bayar INTEGER NOT NULL,
      metode_bayar TEXT NOT NULL DEFAULT 'tunai',
      jumlah_dibayar INTEGER NOT NULL,
      kembalian INTEGER NOT NULL DEFAULT 0,
      waktu_penjualan BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS detail_penjualan_pos (
      id SERIAL PRIMARY KEY,
      penjualan_id INTEGER NOT NULL REFERENCES penjualan_pos(id),
      produk_id INTEGER NOT NULL REFERENCES produk(id),
      jumlah INTEGER NOT NULL,
      harga_satuan INTEGER NOT NULL,
      subtotal INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      nama TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'kasir',
      aktif INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pelanggan (
      id SERIAL PRIMARY KEY,
      nama TEXT NOT NULL,
      telepon TEXT,
      email TEXT,
      aktif INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS langganan (
      id SERIAL PRIMARY KEY,
      pelanggan_id INTEGER NOT NULL REFERENCES pelanggan(id),
      nama_paket TEXT NOT NULL,
      mulai BIGINT NOT NULL,
      berakhir BIGINT NOT NULL,
      harga INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'aktif'
    );

    CREATE TABLE IF NOT EXISTS pelanggan_sistem (
      id SERIAL PRIMARY KEY,
      nama_usaha TEXT NOT NULL,
      nama_pemilik TEXT NOT NULL,
      telepon TEXT,
      email TEXT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nama_paket TEXT NOT NULL DEFAULT 'Basic',
      mulai BIGINT NOT NULL,
      berakhir BIGINT NOT NULL,
      harga INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'aktif',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS detail_sesi_barang (
      id SERIAL PRIMARY KEY,
      sesi_rental_id INTEGER NOT NULL REFERENCES sesi_rental(id),
      produk_id INTEGER NOT NULL REFERENCES produk(id),
      jumlah INTEGER NOT NULL,
      harga_satuan INTEGER NOT NULL,
      subtotal INTEGER NOT NULL
    );
  `);

  // Seed data unit kalau tabel masih kosong
  const unitCount = await get('SELECT COUNT(*) as c FROM unit_ps');
  if (Number(unitCount.c) === 0) {
    await run('INSERT INTO unit_ps (nama_unit, tipe, tarif_per_jam, status) VALUES (?, ?, ?, ?)', ['PS 1', 'PS4', 5000, 'kosong']);
    await run('INSERT INTO unit_ps (nama_unit, tipe, tarif_per_jam, status) VALUES (?, ?, ?, ?)', ['PS 2', 'PS4', 5000, 'kosong']);
    await run('INSERT INTO unit_ps (nama_unit, tipe, tarif_per_jam, status) VALUES (?, ?, ?, ?)', ['PS 3', 'PS5', 8000, 'kosong']);
  }

  const productCount = await get('SELECT COUNT(*) as c FROM produk');
  if (Number(productCount.c) === 0) {
    const seedProducts = [
      ['Air Mineral', 'minuman', 4000],
      ['Teh Botol', 'minuman', 5000],
      ['Kopi Botol', 'minuman', 7000],
      ['Kentang Goreng', 'snack', 10000],
      ['Mie Instan', 'snack', 12000],
      ['Popcorn', 'snack', 15000],
    ];
    for (const [nama_produk, kategori, harga] of seedProducts) {
      await run('INSERT INTO produk (nama_produk, kategori, harga) VALUES (?, ?, ?)', [nama_produk, kategori, harga]);
    }
  }

  const adminCount = await get('SELECT COUNT(*) as c FROM app_users');
  if (Number(adminCount.c) === 0) {
    await run(
      'INSERT INTO app_users (nama, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
      ['Administrator', 'admin', bcrypt.hashSync('admin123', 10), 'admin', Date.now()]
    );
  }
}

// Di serverless, ensureSchema() dipanggil sekali per cold start (bukan tiap request)
let schemaReadyPromise = null;
function ready() {
  if (!schemaReadyPromise) schemaReadyPromise = ensureSchema();
  return schemaReadyPromise;
}

module.exports = { pool, get, all, run, transaction, ready };
