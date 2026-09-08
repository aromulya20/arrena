# Rental PS - Sistem Billing

Web app billing untuk bisnis rental PlayStation. Dashboard real-time buat kasir: pilih unit, mulai sewa, tambah waktu, dan otomatis "selesai" begitu waktu habis (nanti bagian ini yang dihubungkan ke hardware relay).

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (via `better-sqlite3`) — satu file, tidak perlu instal database server terpisah
- **Realtime:** Socket.io — dashboard update otomatis tanpa refresh
- **Frontend:** HTML/CSS/JS biasa (tanpa framework, biar ringan dan gampang di-custom)

## Cara Menjalankan

1. Pastikan sudah install [Node.js](https://nodejs.org) (versi 18 ke atas).
2. Buka terminal di folder ini, lalu jalankan:
   ```bash
   npm install
   npm start
   ```
3. Buka browser ke `http://localhost:3000`

Database (`data/rental.db`) akan otomatis dibuat saat pertama kali dijalankan, lengkap dengan 3 unit contoh (PS 1, PS 2, PS 3).

## Struktur Folder

```
rental-ps-billing/
├── server.js          # Server Express + Socket.io + semua API endpoint
├── db.js              # Setup database SQLite + skema tabel
├── package.json
├── data/
│   └── rental.db       # Dibuat otomatis (file database)
└── public/
    ├── index.html       # Dashboard utama (kasir)
    ├── report.html      # Halaman laporan/riwayat
    ├── style.css
    ├── app.js           # Logic dashboard (start/extend/stop, countdown)
    └── report.js        # Logic halaman laporan
```

## Fitur yang Sudah Ada

- Dashboard menampilkan semua unit PS beserta status (kosong / dipakai / maintenance)
- Mulai sewa baru: pilih durasi (tombol cepat 30/60/120/180 menit atau input manual), lihat estimasi biaya sebelum konfirmasi
- Countdown real-time per unit, otomatis sinkron ke semua device yang buka dashboard (pakai Socket.io)
- Tambah waktu (extend) sesi yang sedang berjalan
- Auto "selesai" ketika waktu habis (dicek tiap 5 detik) — unit otomatis kembali jadi "kosong"
- Selesai manual (kalau pelanggan berhenti main lebih awal)
- Halaman laporan: total pendapatan & jumlah transaksi hari ini, plus riwayat transaksi lengkap

## Menambah Unit PS Baru

Saat ini nambah unit lewat API langsung (belum ada form UI-nya), contoh pakai curl:

```bash
curl -X POST http://localhost:3000/api/units \
  -H "Content-Type: application/json" \
  -d '{"nama_unit": "PS 4", "tipe": "PS5", "tarif_per_jam": 8000}'
```

Kalau mau, form tambah unit lewat dashboard bisa ditambahkan menyusul.

## Rencana Pengembangan Selanjutnya

- **Hardware/relay otomatis** — hubungkan `waktu_selesai` di sistem ke smart plug (Sonoff/ESP32 + Tasmota) supaya PS mati otomatis, bukan cuma status di dashboard yang berubah
- **Autentikasi kasir** — login sederhana biar tidak sembarang orang bisa akses dashboard
- **Cetak struk** — generate struk sederhana tiap transaksi
- **Export laporan** — download laporan harian/bulanan ke Excel/PDF
