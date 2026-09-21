# Responsive Fix — Changelog

Ringkasan perubahan untuk membuat seluruh dashboard 360eDash usable di
semua ukuran layar (desktop, laptop, tablet/iPad, Android, iPhone),
**tanpa** mengubah UI/UX, warna, typography, layout concept, komponen,
atau fungsi yang sudah ada. Semua perubahan bersifat aditif (ukuran &
posisi saja) atau memperbaiki interaksi yang sebelumnya rusak di layar
kecil.

## 1. Bug kritis: Sidebar tidak bisa dibuka di mobile/tablet (≤900px)

**Sebelum:** di bawah 900px, sidebar berubah jadi off-canvas
(`transform: translateX(-100%)`), tapi satu-satunya tombol toggle
(`#sbToggle`) ada **di dalam** sidebar itu sendiri — jadi ikut
tersembunyi — dan tombol itu cuma toggle class `.is-collapsed`
(collapse ke rail sempit), bukan `.is-open` yang dibutuhkan CSS
off-canvas. Akibatnya: di HP/tablet, sidebar—dan seluruh navigasi
dashboard—tidak bisa diakses sama sekali.

**Perbaikan:**
- `master/header/header.html` — menambahkan tombol hamburger
  (`#hdMenuToggle`) di `.hd-left`, area yang sebelumnya kosong/tidak
  terpakai. Tombol ini hanya tampil ≤900px (lihat `header.css`).
- `master/header/header.css` — style tombol hamburger + breakpoint.
- `master/sidebar/sidebar.css` — menambahkan backdrop overlay
  (`.edash-sidebar-backdrop`) yang tampil di belakang sidebar saat
  terbuka di mobile, plus penyesuaian agar collapsed-state tidak
  konflik dengan off-canvas state di layar kecil.
- `index.html` — menambahkan elemen backdrop, `100dvh` fallback untuk
  shell, dan padding konten yang menyempit bertahap di breakpoint
  kecil.
- `js/main.js` (`sidebarToggle()`) — ditulis ulang supaya tombol
  sidebar berperilaku sesuai lebar layar: **collapse ke rail sempit**
  di desktop/laptop (perilaku lama, tidak berubah), **buka/tutup
  drawer** di mobile/tablet (perilaku baru). Drawer otomatis tertutup
  saat: memilih item navigasi, tap backdrop, atau tekan Esc.

Sudah diverifikasi dengan automated browser testing (Playwright):
sidebar berpindah dari `x:-264` (tersembunyi) ke `x:0` (terbuka) saat
hamburger di-tap, dan tertutup otomatis saat item nav / backdrop
di-klik.

## 2. Safety net responsive (global)

- `css/global.css` — menambahkan `max-width:100%` untuk
  img/svg/video/canvas/iframe/table sebagai jaring pengaman supaya
  konten yang secara tidak sengaja terlalu lebar tidak pernah memicu
  horizontal scroll/keluar viewport. Tidak mengganggu pola tabel yang
  sengaja lebih lebar dari viewport (pakai `min-width` di dalam
  wrapper `overflow-x:auto`) karena `min-width` selalu menang atas
  `max-width` bila keduanya konflik.

## 3. Perbaikan kecil per halaman

- `css/system-information.css` — toast & modal-overlay padding
  disesuaikan lagi di ≤720px/≤480px supaya tidak terlalu mepet ke tepi
  layar sangat sempit (dipakai bersama oleh System Information,
  Project Monitoring, dan Task Management karena berbagi token `--si-*`).
- `css/setting.css` — label tab pengaturan ("Appearance", "Language",
  dst.) sekarang truncate dengan ellipsis di layar sangat sempit
  (≤680px), bukan terpotong mendadak di tengah kata oleh
  `overflow:hidden` milik container tab.

## 4. Halaman yang sudah diperiksa

Semua halaman/fitur berikut sudah ditinjau breakpoint & potensi
overflow-nya: Login, Dashboard/Project Overview, Project Detail,
Project Selector (peta fullscreen), Project Monitoring, System
Information, Battery Station, Catalog, Task Management, Task
Maintenance, Setting, Alert, Activity Log (+ Marketing Analytics),
Add Project, Admin Calculator, Admin View, Solar Calculator, Privacy
Policy/Legal, dan landing page (`main-page/index.html`, berbasis
Tailwind responsive utilities — sudah baik).

Sebagian besar halaman ternyata sudah punya breakpoint yang cukup
matang (1100/980/900/720/640/480px), tabel sudah dibungkus
`overflow-x:auto`, dan modal sudah dibatasi
`max-width: calc(100vw - Npx)`. Perbaikan di atas menutup gap yang
tersisa.

## 5. Verifikasi

Diuji dengan Playwright (Chromium headless) di 320/375/390/412/768/
1024/1280/1440px:
- **Tidak ada horizontal overflow** (`scrollWidth > clientWidth`) di
  semua breakpoint, pada halaman: Dashboard, Solar Calculator,
  Settings, System Information, Project Selector (fullscreen),
  Catalog, Activity Log.
- Interaksi sidebar (buka via hamburger, tutup via nav-click/backdrop/
  Esc) berfungsi sesuai desain.
- Tidak ada perubahan visual pada breakpoint desktop/laptop yang sudah
  ada sebelumnya — semua perubahan CSS bersifat tambahan di dalam
  `@media` blocks atau menyasar elemen yang sebelumnya memang belum
  responsive (misal tombol hamburger, backdrop).

## 6. Follow-up audit — kartu statistik terpotong di System Information & Task Management (≤~420px)

Audit ulang menyeluruh (Playwright, 18 halaman × 13 lebar viewport
320–1920px, plus tiap modal di setiap halaman dipaksa terbuka satu per
satu untuk dicek) menemukan satu gap yang lolos dari pass sebelumnya:

**Sebelum:** `.si-stats-row` (baris 3 kartu ringkasan statistik) di
`css/system-information.css` memakai `grid-template-columns:
repeat(3, 1fr)` tanpa breakpoint. Class ini dipakai bareng oleh
halaman **System Information** dan **Task Management** (Task
Maintenance sudah aman karena punya class tambahan `.tkm-stats-row`
dengan breakpoint sendiri). Di layar sempit (≤~420px), 3 grid track
tidak bisa menyusut di bawah lebar konten kartu (ikon + angka +
label), sehingga baris kartu melebar melebihi container dan kartu
ke-3 terdorong keluar — lalu disembunyikan begitu saja oleh
`overflow-x: hidden` milik `.edash-content`. Bukan horizontal-scroll
yang kelihatan, tapi kartu yang benar-benar hilang & tidak bisa
diakses sama sekali di HP.

**Perbaikan:** `css/system-information.css` — menambahkan 2 aturan di
dalam `@media` block yang sudah ada, mengikuti pola persis yang
sudah dipakai `.tkm-stats-row` di `task-maintenance.css`:
- `@media (max-width: 720px)`: `.si-stats-row` → 2 kolom.
- `@media (max-width: 480px)`: `.si-stats-row` → 1 kolom.

Tidak ada perubahan warna, tipografi, struktur HTML, atau breakpoint
lain yang disentuh.

**Verifikasi:** overflow-audit penuh (18 halaman × 13 lebar) sebelum
dan sesudah fix sama-sama nihil horizontal overflow; screenshot
System Information & Task Management di 375px dan 480px dicek ulang
— ketiga kartu sekarang stack penuh & sepenuhnya terlihat. Semua
modal (logout, create/edit user, delete confirm, maintenance log,
dsb.) di 10 halaman yang memilikinya dicek satu per satu di 375px —
semuanya center, muat penuh, tidak overflow.
