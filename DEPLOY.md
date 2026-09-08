# Panduan Deploy ke Vercel + Supabase

## Apa yang berubah dari versi lokal
- Database: **SQLite (better-sqlite3)** → **Postgres di Supabase**
- Session login: memory → tabel `session` di Postgres (`connect-pg-simple`)
- Real-time update unit: **Socket.io** → polling `/api/units` tiap 3 detik
- Auto-selesai sesi yang waktunya habis: `setInterval` → dicek tiap `/api/units` dipanggil

Semua fitur & alur pemakaian sama persis kayak sebelumnya, cuma cara jalannya di-adaptasi biar cocok sama serverless.

## 1. Bikin project Supabase
1. Buat project baru di supabase.com.
2. Buka **Project Settings → Database → Connection string**, pilih tab **Transaction pooler** (port `6543`) — ini penting, jangan pakai direct connection (port 5432), karena serverless butuh connection pooling.
3. Copy connection string-nya, isi password project-mu di bagian `[PASSWORD]`.

## 2. Set environment variables
Buat file `.env` (lokal) berdasarkan `.env.example`, atau langsung isi di Vercel dashboard nanti:
- `DATABASE_URL` = connection string dari langkah 1
- `SESSION_SECRET` = string acak bebas (misal hasil `openssl rand -hex 32`)
- `NODE_ENV` = `production` (Vercel set otomatis, gak perlu diisi manual)

Tabel-tabel akan otomatis dibuat + di-seed data awal (3 unit PS, produk POS, akun admin `admin` / `admin123`) saat pertama kali server jalan — gak perlu jalanin migration manual.

## 3. Push ke GitHub
```bash
git init
git add .
git commit -m "Ready for Vercel + Supabase"
git branch -M main
git remote add origin <url-repo-kamu>
git push -u origin main
```

## 4. Deploy di Vercel
1. Import repo di vercel.com/new.
2. Framework preset: **Other**.
3. Di tab **Environment Variables**, masukkan `DATABASE_URL` dan `SESSION_SECRET`.
4. Deploy.

## 5. Setelah deploy
- Buka domain Vercel-nya, login pakai `admin` / `admin123`, **langsung ganti password admin** (lewat tabel `app_users` di Supabase Table Editor, karena belum ada UI ganti password).
- Cek log di Vercel kalau ada error koneksi DB — biasanya karena salah connection string (pastikan pakai pooler port 6543, bukan 5432).

## Batasan yang perlu kamu tahu
- **Real-time**: sekarang berbasis polling 3 detik, bukan push instan kayak socket.io. Untuk kasus rental PS ini bedanya gak kerasa signifikan, tapi kalau nanti mau instan banget, bisa upgrade ke Supabase Realtime.
- **Auto-selesai sesi**: dicek tiap ada yang buka halaman/polling `/api/units`. Kalau gak ada satupun browser yang lagi buka dashboard, sesi yang harusnya auto-expire baru keupdate pas ada yang buka lagi. Untuk pemakaian normal (dashboard kasir selalu kebuka) ini gak masalah.
