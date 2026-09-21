# 360eDash — Activity Log Backend

Backend minimal (Node.js bawaan, **tanpa dependency npm**) yang mencatat
seluruh aktivitas aplikasi (login, logout, Admin Calculator, Solar
Calculator, export report) ke satu file JSON: `data/activity-logs.json`.

Server ini **terpisah** dari cara frontend dijalankan sekarang (VSCode
Live Server, port 5502). Frontend tetap dijalankan seperti biasa — server
ini hanya menambahkan API di port lain yang dipanggil lewat `fetch()`.

## Menjalankan

```bash
node server/server.js
```

Tidak perlu `npm install`. Server akan jalan di `http://localhost:3001`
(bisa diubah lewat environment variable `EDASH_API_PORT`).

## IP & Country klien

- IP klien diambil backend dari request (`getClientIp`), bukan dikirim
  dari frontend.
- Saat development (localhost), IP akan tercatat sebagai `::1` /
  `127.0.0.1` dan `country` diisi `"-"` — `ipwho.is` **tidak** dipanggil
  untuk IP lokal/privat.
- Saat IP klien adalah IP publik, backend memanggil `ipwho.is` sekali
  untuk mengisi `country`. Kalau lookup gagal/timeout, `country` tetap
  `"-"` — tidak pernah diisi data karangan.
- Kalau backend ini nanti dijalankan di belakang reverse proxy/Vercel,
  set env var `EDASH_TRUST_PROXY=1` supaya IP klien asli dibaca dari
  header `X-Forwarded-For` / `X-Real-IP` yang ditulis proxy tsb, bukan
  dari koneksi TCP langsung (yang saat di belakang proxy hanya akan
  berisi IP proxy-nya sendiri). **Jangan** set env var ini kalau server
  diakses langsung tanpa proxy tepercaya di depannya — kalau di-set,
  klien mana pun bisa memalsukan IP-nya sendiri lewat header tsb.

## Endpoint

| Method | Path                    | Keterangan                                                        |
|--------|-------------------------|--------------------------------------------------------------------|
| POST   | `/api/activity`         | Catat 1 activity baru                                              |
| GET    | `/api/activity`         | Ambil seluruh activity (terbaru dulu)                              |
| GET    | `/api/activity/:id`     | Ambil 1 activity berdasarkan id                                    |
| POST   | `/api/marketing-events` | Catat 1 mirror event Meta Pixel (storage terpisah, lihat di bawah) |
| GET    | `/api/marketing-events` | Ambil seluruh mirror event Meta Pixel (terbaru dulu)               |
| GET    | `/api/health`           | Health check                                                       |

## Storage

`data/activity-logs.json` — array JSON biasa, ditulis lewat file temp +
rename (atomic) supaya aman dari request yang datang bersamaan. Backend
melakukan lookup IP → negara lewat `ipwho.is` (bukan dari frontend). Kalau
lookup gagal (mis. IP lokal/privat, atau timeout), field `country` diisi
`"-"` — tidak pernah mengarang negara.

`data/marketing-pixel-events.json` — storage **terpisah total** dari
`activity-logs.json`, dipakai khusus oleh section "Marketing Analytics"
di halaman Activity Log. Berisi mirror dari event Meta Pixel (`fbq(...)`)
yang benar-benar terkirim dari halaman Solar Calculator (lihat
`js/marketing-pixel-client.js` & pemanggilannya di `js/solar-calculator.js`).
Alasan storage ini dipisah, bukan digabung ke `activity-logs.json`:

- Meta Pixel hanya mengirim data satu arah ke server Meta — proyek ini
  tidak punya Graph API/Conversions API/access token untuk membaca balik
  data resmi dari Meta Ads Manager, jadi kita mem-mirror event yang sama
  ke server sendiri supaya dashboard tetap bisa menampilkan angka nyata.
- Data ini murni untuk kebutuhan marketing (visitor/engagement/funnel
  Solar Calculator), bukan bagian dari Activity Log administratif —
  mencampurnya akan bikin kedua use case saling mengotori.
- Event yang diterima dibatasi ke `ALLOWED_MARKETING_EVENT_TYPES` di
  `server.js` (persis nama event yang dipakai `fbq(...)` di
  `js/solar-calculator.js`), dan sengaja **tidak menyimpan email** dari
  event `Lead` — hanya dipakai untuk menghitung jumlah/rasio konversi.


## Mengarahkan frontend ke server production

Ubah `js/api-config.js`:

```js
window.EDASH_API_BASE = "https://api.contoh-domain-kamu.com";
```

## Keterbatasan solusi file JSON (lihat juga ringkasan akhir implementasi)

- Cocok untuk skala kecil–menengah (ratusan ribu baris). Untuk trafik
  tinggi/banyak instance server paralel, pertimbangkan migrasi ke
  database nyata.
- Tidak ada index/query canggih — filter/pencarian dilakukan di frontend
  setelah `GET /api/activity` mengambil seluruh data.
- Satu proses Node saja (tidak otomatis restart kalau crash) — untuk
  production, jalankan lewat process manager (mis. `pm2`, systemd) atau
  container dengan restart policy.
