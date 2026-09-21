/* ============================================================
   Page: Project Selector — 360eDash
   Fullscreen MapLibre GL JS map + floating "Project Locations" panel.
   Dipanggil oleh main.js -> loadPage() lewat window.initProjectSelector()
   setiap kali halaman "pages/project-selector.html" selesai dimuat
   ke #page-root.

   CATATAN PERBAIKAN (Agustus 2026): file ini sebelumnya ke-timpa
   isinya oleh js/setting.js (duplikat kode Settings/Role Access) —
   makanya initProjectSelector() tidak pernah ada dan halaman terlihat
   kosong walau HTML + CSS-nya sudah lengkap. File ini ditulis ulang
   dari struktur pages/project-selector.html + css/project-selector.css.

   CATATAN PERBAIKAN #2 (Agustus 2026): psLoadProjects() sebelumnya
   cuma menampilkan proyek "Tawabi" (hasil GET /projects di-filter
   nama /tawabi/i, sisanya dibuang) — jadi proyek real lain di backend
   (mis. "Kasdam") tidak pernah kepanggil/kelihatan di halaman ini.
   Sekarang SEMUA proyek dari GET /api/v1/projects ditampilkan.

   CATATAN PERBAIKAN #3 (Agustus 2026): chart Today/Power Output tadinya
   HANYA proyek Tawabi yang pakai telemetry live per-device (hardcode
   ke provider "Solarman" + filter nama "tawabi"), proyek lain selalu
   dapat chart placeholder/sintetis walau device-nya sebenarnya sudah
   terdaftar di ThingsBoard. Sekarang psGetLiveDataForProject() /
   psBuildLiveDataForProject() dipakai untuk SEMUA proyek: device
   di-discover per proyek (Tawabi tetap lewat by-provider+nama seperti
   semula karena itu satu-satunya cara yang didokumentasikan untuknya;
   proyek lain lewat GET /projects/:id, lihat psDiscoverProjectDevices())
   lalu telemetry latest/history-nya provider-agnostic (lihat
   PS_POWER_HISTORY_KEYS / PS_ENERGY_DAILY_HISTORY_KEYS). Proyek yang
   device-nya belum terdaftar di ThingsBoard otomatis jatuh ke
   psRenderPlaceholderCharts() (chart sintetis 24h dari generatedMWh,
   flat 0 buat 7d — bukan dianggap error).

   Sumber data:
     - BACKEND HONO REAL (dokumentasi: DOKUMENTASI_API_eDASHBOARD_360ENERGY.pdf),
       base URL https://360edashboard.com, diakses lewat window.edashApiFetch()
       (js/api-config.js, sudah pakai credentials:"include" -> otomatis
       ikut session_token cookie dari login yang sudah aktif):
         0. GET /projects -> SEMUA proyek, lalu tiap proyek di-GET
            /projects/:id/analytics buat kapasitas/energi/CO2. INI
            SATU-SATUNYA SUMBER DAFTAR PROYEK sekarang (lihat
            psLoadProjects()) — server/data/projects.json (dummy
            builtin) dan localStorage["edash-user-projects"] (proyek
            "Add New Project") SENGAJA TIDAK dipakai lagi, halaman ini
            cuma menampilkan proyek yang real dari API.
         1. Discovery device per proyek (buat Today/Power live):
            - Tawabi (id tetap "tawabi"): GET /devices/inverters/by-provider
              ?provider=Solarman, cari device dengan nama mengandung
              "Tawabi" (2 inverter, Grup 1 & Grup 2).
            - Proyek lain: GET /projects/:id (PDF §5.1, "beserta unit
              sistem dan inverter terpasang") — response-nya di-scan
              rekursif cari field `thingsboardDeviceId` (lihat
              psDiscoverProjectDevices(), PDF tidak kasih contoh JSON
              persis buat endpoint ini jadi ini best-effort).
         2. GET /devices/:id/telemetry/latest  -> angka real-time
            (overview.currentPower, overview.energyToday, dst — bentuk
            responsnya SUDAH persis sesuai contoh di PDF §4.3, dan
            SUDAH ternormalisasi Rev3 jadi provider-agnostic).
         3. GET /devices/:id/telemetry/history?keys=...&last=24h dan
            ...&last=7d -> kurva 24 jam & 7 hari. Key yang dikirim
            SEKARANG nama variabel logis Rev3 dot-notation (lihat
            PS_POWER_HISTORY_KEYS/PS_ENERGY_DAILY_HISTORY_KEYS,
            "overview.currentPower"/"overview.energyToday") sesuai
            kontrak Rev3 §3 & §4 -- resolusi ke register mentah per
            provider dilakukan backend (Lean Normalized-to-Raw Key
            Resolver), bukan lagi ditebak per-provider di frontend.
            Bentuk respons dikonfirmasi mengelompokkan data per
            kategori di dalam field "telemetry" (raw.telemetry.overview
            .energyToday, dst — lihat psExtractHistoryPoints()), sama
            seperti yang sudah dikonfirmasi di js/dashboard.js.
     - FIX (hapus fallback data dummy): fallback ke
       server/data/tawabi-telemetry.json + tawabi-energy-production.json
       khusus proyek Tawabi SUDAH DIHAPUS. Kalau API live poin 2/3 di
       atas gagal, proyek tersebut (termasuk Tawabi) langsung jatuh ke
       psRenderPlaceholderCharts() seperti proyek lain -- tidak ada lagi
       data JSON statis yang dipakai sebagai isi angka/kurva.

   Exposes window.initProjectSelector().
============================================================= */

(function () {

  // ===========================================================
  // Konstanta & state modul
  // ===========================================================

  // Backend Hono real (lihat DOKUMENTASI_API_eDASHBOARD_360ENERGY.pdf).
  // Base path-nya sendiri sudah diatur di js/api-config.js
  // (window.EDASH_BACKEND_API_BASE, default "/api/v1", same-origin ke
  // 360edashboard.com saat production) — di sini cukup path relatifnya.
  const PS_TAWABI_PROVIDER = "Solarman";
  const PS_TAWABI_NAME_RE = /tawabi/i;

  // REAL DATA — PLTS Kasdam, dari DOKUMENTASI_API_eDASHBOARD_360ENERGY_
  // KASDAM.pdf (§4.1/§4.2). psDiscoverProjectDevices() di bawah SUDAH
  // generik (scan rekursif field `thingsboardDeviceId` di mana pun
  // nested-nya di response GET /projects/:id), jadi Kasdam SEHARUSNYA
  // sudah otomatis ke-detect tanpa perlu kode khusus apa pun di sini.
  // Konstanta ini HANYA dipakai sebagai fallback TERAKHIR (lihat
  // pemakaiannya di psDiscoverProjectDevices) kalau response proyek
  // Kasdam ternyata tidak membawa field itu sama sekali -- Device ID +
  // Access Token di bawah konkret dari dokumentasi (disebut sama persis
  // di §4.1 & §4.2), bukan tebakan generik seperti UUID project/system.
  const PS_KASDAM_NAME_RE = /kasdam/i;
  const PS_KASDAM_FALLBACK_DEVICES = [
    { id: "7ee849a0-9ad5-11f1-8c86-25274e65e397", name: "Inverter PLTS Kasdam 01" },
    { id: "abe8c180-9ad7-11f1-8c86-25274e65e397", name: "Inverter PLTS Kasdam 02" }
  ];
  const WIT_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Jayapura = UTC+9, tanpa DST

  // Harus sinkron dengan PC_CATEGORIES di js/project-context.js.
  //
  // TKT-000045: kategori proyek diperluas — dulu cuma "Rooftop Solar"
  // padahal proyek solar itu ada beberapa jenis (ON Grid, Hybrid On
  // Grid, Hybrid + Solaris BSS, Off-Grid + Diesel). "rooftop" TETAP
  // didukung sebagai alias lama (lihat categoryMeta()) supaya data
  // proyek existing yang masih pakai category:"rooftop" tidak rusak —
  // ditampilkan sebagai "ON Grid Solar PV".
  //
  // Nilai category tiap proyek SEKARANG di-resolve dari Type
  // (On-grid/Off-grid/Hybrid) yang SAMA PERSIS dengan yang ditampilkan
  // di tab System Information (sys.inverterOverview.inverterType) --
  // lihat psApplyInverterTypeCategories() -- lalu dipetakan ke salah
  // satu dari 4 kategori di bawah (Hybrid System Information selalu
  // dipetakan ke "hybrid-on-grid" sebagai varian hybrid default, karena
  // Type di System Information tidak membedakan hybrid-plain dari
  // hybrid+BSS). BUKAN lagi dari field project.category analytics API
  // (yang memang sering kosong).
  const PS_CATEGORY_META = {
    bss: { label: "Solaris BSS", color: "#FA891A", bg: "#FEF4EA", iconBg: "#FDECD8", icon: "fa-charging-station" },
    "on-grid": { label: "ON Grid Solar PV", color: "#2F80ED", bg: "#EAF2FE", iconBg: "#DCEAFD", icon: "fa-solar-panel" },
    "hybrid-on-grid": { label: "Hybrid ON Grid Solar", color: "#9B51E0", bg: "#F4EEFC", iconBg: "#EBDFF9", icon: "fa-plug-circle-bolt" },
    "hybrid-bss": { label: "Hybrid + Solaris BSS", color: "#F2994A", bg: "#FEF3E8", iconBg: "#FCE6CE", icon: "fa-battery-three-quarters" },
    "off-grid-diesel": { label: "Off-Grid + Diesel", color: "#828282", bg: "#F2F2F2", iconBg: "#E6E6E6", icon: "fa-gas-pump" },
    "fish-farm": { label: "Solar Fish Farm", color: "#27AE60", bg: "#EEF8F1", iconBg: "#E1F5E8", icon: "fa-fish" }
  };
  const PS_CATEGORY_ORDER = ["on-grid", "hybrid-on-grid", "hybrid-bss", "off-grid-diesel"];
  // "bss" & "fish-farm" SENGAJA tidak masuk PS_CATEGORY_ORDER (widget
  // "Category" cuma nampilin 4 tipe solar project di atas -- lihat
  // klarifikasi user di TKT-000045), tapi entry-nya tetap dipertahankan
  // di PS_CATEGORY_META supaya categoryMeta() masih bisa kasih warna
  // pin yang benar buat proyek lama yang category-nya masih "bss"/
  // "fish-farm" (dipakai psAddMarker() di peta).

  const LS_USER_PROJECTS = "edash-user-projects"; // sama dgn project-context.js

  // ===========================================================
  // Basemap: "Streets" (overview) vs "Satellite Hybrid" (detail).
  // Saat sebuah proyek dibuka (marker/baris diklik), peta zoom ke
  // level atap lalu basemap otomatis pindah ke citra satelit supaya
  // atapnya kelihatan. Balik ke overview -> balik ke basemap streets.
  //
  // Basemap open-source & gratis tanpa limit (gantinya MapTiler yang
  // sering kena limit):
  //  - Streets: OpenFreeMap (vector tiles MapLibre, tanpa API key)
  //  - Satellite hybrid: Esri World Imagery + label referensi Esri
  //    (raster, gratis tanpa API key)
  // https://openfreemap.org/ · https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9
  // ===========================================================
  const PS_STREET_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
  // FIX (2026-09-08): sebelumnya pakai https://tiles.openfreemap.org/styles/dark
  // -- style itu MEMANG ada, tapi per README resmi openfreemap-styles ("Dark
  // and Fiord is not yet complete... unmodified... exactly as they are on
  // their source repo") sebagian besar layer fill (darat/laut) tidak
  // digambar, jadi yang muncul cuma label + border di atas kanvas hitam
  // polos -- persis keluhan user ("map hitam pas dark mode"). Diganti ke
  // style dark CARTO (dark-matter-gl-style) yang lengkap, stabil, gratis,
  // dan tidak butuh API key -- basemap dark standar yang dipakai luas di
  // ekosistem MapLibre GL JS.
  const PS_STREET_DARK_STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
  const PS_ESRI_SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const PS_ESRI_LABELS_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
  const PS_INITIAL_CENTER = [-2.5, 118];
  const PS_INITIAL_ZOOM = 4;
  const PS_DETAIL_ZOOM = 17; // cukup dekat buat lihat atap proyek, sedikit di-zoom out dari sebelumnya

  function psSatelliteStyle() {
    return {
      version: 8,
      sources: {
        "esri-satellite": {
          type: "raster",
          tiles: [PS_ESRI_SATELLITE_URL],
          tileSize: 256,
          attribution: "Tiles &copy; Esri"
        },
        "esri-labels": {
          type: "raster",
          tiles: [PS_ESRI_LABELS_URL],
          tileSize: 256
        }
      },
      layers: [
        { id: "esri-satellite-layer", type: "raster", source: "esri-satellite" },
        { id: "esri-labels-layer", type: "raster", source: "esri-labels" }
      ]
    };
  }

  let psCurrentBasemap = "streets"; // "streets" | "hybrid"
  let psThemeObserver = null;
  let psResizeObserver = null; // pantau ukuran container #psMap (fix peta "kepotong" saat balik dari halaman lain)
  let psPageRootObserver = null; // deteksi kapan #psMap dilepas dari DOM (pindah halaman) supaya WebGL context-nya dibuang, bukan cuma "ditinggal"
  let psMapEl = null;           // referensi container peta yang sedang aktif, dipakai psPageRootObserver

  let psMap = null;
  let psMarkers = {};           // id -> maplibregl.Marker
  let psPopups = {};            // id -> maplibregl.Popup
  let psProjects = [];          // sekarang isinya cuma proyek Tawabi dari API (lihat psLoadProjects()), tiap item punya `id`
  let psActiveId = null;        // proyek yang sedang dipilih (untuk Today/Power/Detail)
  let psPowerRange = "24h";     // "24h" | "7d"
  let psSearchTerm = "";

  let psLiveDataCache = new Map();    // projectId -> hasil psBuildLiveDataForProject() (Today + Power real)
  let psLivePromiseCache = new Map(); // projectId -> Promise in-flight, biar klik ganda tidak dobel-fetch
  let psDeviceCache = new Map();      // projectId -> device[] (thingsboardDeviceId+name) hasil discovery

  // TKT-000045: toggle "Show all" di sebelah judul "Category" pada
  // panel Project Locations. Default false (unchecked) = kategori
  // dengan 0 proyek disembunyikan (perilaku default sebelum ada
  // checkbox ini). Cuma state UI biasa, tidak disimpan ke
  // localStorage — reset ke default tiap halaman dibuka.
  let psShowAllCategories = false;

  // ===========================================================
  // Entry point
  // ===========================================================

  const PS_STALE_CACHE_KEY = "project-selector:list";

  // Sama seperti poDataLoadedOnce di dashboard.js -- kunjungan PERTAMA saja
  // yang genuinely fetch + tampilkan loading overlay penuh (EdashLoadingBar,
  // sama persis yang dipakai Dashboard). Kunjungan-kunjungan berikutnya
  // (pindah ke halaman lain lalu balik ke Project Selector) SKIP TOTAL
  // fetch-nya -- langsung render ulang instan dari psProjects yang sudah
  // ada di memori, TANPA indikator loading apapun.
  //
  // Sebelumnya di sini dipakai pola stale-while-revalidate terpisah
  // (EdashStaleCache + EdashUpdatingBanner, pita "Memperbarui data
  // proyek..."), TAPI pita itu di-prepend ke `.ps-page` yang mode
  // display-nya `flex` (row peta + panel) -- karena elemen banner ikut jadi
  // flex ITEM di baris itu, dia dirender sebagai kolom sempit di SISI KIRI
  // layar (kepotong sama tombol collapse sidebar) alih-alih pita/overlay
  // di ATAS seperti seharusnya. dashboard.js sendiri sudah lebih dulu
  // pindah dari pola SWR+pita ini karena tetap kerasa "loading lagi" tiap
  // kunjungan (lihat komentar poDataLoadedOnce di js/dashboard.js) --
  // disamakan ke pola itu di sini sekalian membereskan bug pita "di
  // samping" tadi.
  let psDataLoadedOnce = false;

  async function initProjectSelector() {

    psMarkers = {};
    psPopups = {};
    psMap = null;
    psActiveId = null;
    psPowerRange = "24h";
    psSearchTerm = "";

    const searchInput = document.getElementById("psSearchInput");
    if (searchInput) searchInput.value = "";

    function renderAllRows() {
      psRenderSummary();
      psRenderCategoryLegend();
      psRenderGenerationStats();
      psRenderSavedRows();
      psRenderAllRows();
      // Card "Today" ikut disegarkan tiap kali daftar proyek berubah
      // (mis. background refresh status online/offline selesai) --
      // TAPI cuma kalau lagi TIDAK di mode detail, supaya tidak menimpa
      // data REAL proyek yang sedang dibuka user dengan angka akumulasi.
      if (!document.querySelector(".ps-page.is-detail")) {
        psRenderAggregateTodayChart();
      }
    }

    if (psDataLoadedOnce) {
      // Sudah pernah dimuat di sesi SPA ini -- markup halaman selalu baru
      // (di-render ulang lewat innerHTML tiap navigasi), tapi psProjects
      // (datanya) tetap ada di memori, jadi render ulang instan saja.
      renderAllRows();
    } else {

      const loadingContainer = document.querySelector(".ps-page") || document.getElementById("page-root");
      if (window.EdashLoadingBar) {
        window.EdashLoadingBar.show(loadingContainer, PS_STALE_CACHE_KEY, "loading.project");
      }

      try {
        await psLoadProjects();
      } catch (e) {
        console.warn("[project-selector] Gagal memuat data proyek Tawabi dari API:", e.message);
        psProjects = []; // tidak ada fallback lama -> render kosong apa adanya
      }

      psDataLoadedOnce = true;
      renderAllRows();

      if (window.EdashLoadingBar) window.EdashLoadingBar.done(loadingContainer, PS_STALE_CACHE_KEY);

    }

    // Refresh status online/offline REAL + kategori/Type (On-grid/Off-grid/
    // Hybrid, disamakan dgn System Information) di background -- tidak
    // di-await supaya render pertama tidak ketahan nunggu network tiap
    // proyek, cukup re-render ringkasan/daftar/pin + update visual pin
    // begitu hasilnya sudah kekonfirmasi.
    //
    // SENGAJA dijalankan BERURUTAN, bukan Promise.all -- psApplyInverterTypeCategories()
    // adalah yang mengisi window.__siSystems (lihat catatan di dalamnya), yang
    // dibaca window.__siGetProjectOnlineStatus() untuk cross-check status di
    // psRefreshLiveStatuses(). Kalau dijalankan paralel, psRefreshLiveStatuses()
    // bisa saja selesai duluan sebelum window.__siSystems terisi, jadi
    // cross-check-nya selalu null/no-op secara acak (race condition) -- proyek
    // yang sebenarnya online menurut System Information tetap bisa ke-tandai
    // offline gara-gara device-discovery Project Selector sendiri gagal.
    psApplyInverterTypeCategories().then(() => psRefreshLiveStatuses()).then(() => {
      psProjects.forEach(psRefreshMarkerVisual);
      renderAllRows();
    });

    psInitMap();
    psBindUI();

    // Panel "Project Locations" default terbuka supaya halaman tidak
    // terlihat kosong saat pertama kali dibuka.
    const panel = document.getElementById("psPanel");
    if (panel) panel.classList.add("is-open");

    // Default (belum ada proyek yang dibuka / bukan mode detail): card
    // "Today" menampilkan AKUMULASI SEMUA proyek -- lihat catatan FIX
    // (2026-09-08) di psRenderAggregateTodayChart(). psActiveId sengaja
    // dibiarkan null di sini (tidak ada baris proyek yang ke-highlight)
    // karena memang belum ada proyek spesifik yang dipilih.
    psRenderAggregateTodayChart();

  }

  window.initProjectSelector = initProjectSelector;

  // ===========================================================
  // Helpers umum
  // ===========================================================

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return res.json();
  }

  function psSlug(name) {
    return String(name || "project")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "project";
  }

  function fmtNum(n, decimals) {
    const v = Number(n);
    if (!isFinite(v)) return "0";
    return v.toFixed(decimals == null ? 1 : decimals);
  }

  function categoryMeta(category) {
    // "rooftop" = nama kategori lama sebelum TKT-000045, alias-kan ke
    // "on-grid" supaya proyek lama (category:"rooftop" di data/API)
    // tetap tampil benar, bukan fallback ke kategori yang salah.
    if (category === "rooftop") category = "on-grid";
    return PS_CATEGORY_META[category] || PS_CATEGORY_META["on-grid"];
  }

  // "On-grid" / "Off-grid" / "Hybrid" dari VPS Core API bisa datang dalam
  // beberapa variasi ejaan ("Ongrid", "On-Grid", "on_grid", dst — lihat
  // catatan normalizeInverterType() yang sama persis di js/battery-station.js,
  // §4.1/§4.3 dokumentasi: field InverterType SERVER_SCOPE / telemetry/latest
  // memang tidak konsisten kapitalisasi/separatornya). Dibandingkan case- dan
  // separator-insensitive di sini juga supaya tidak salah kelompok.
  function psNormalizeInverterType(raw) {
    const norm = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s_-]+/g, "") : "";
    if (norm === "ongrid") return "on-grid";
    if (norm === "offgrid") return "off-grid";
    if (norm === "hybrid") return "hybrid";
    return null;
  }

  // Type System Information cuma 3 nilai, tapi kategori Project Selector
  // ada 4 (on-grid/hybrid-on-grid/hybrid-bss/off-grid-diesel) -- Type
  // "Hybrid" TIDAK membawa info apakah proyeknya juga punya Solaris BSS,
  // jadi dipetakan ke "hybrid-on-grid" (varian hybrid default/plain).
  // Kalau nanti System Information/BSS registry bisa kasih sinyal
  // eksplisit "proyek ini punya Solaris BSS", pemetaan ke "hybrid-bss"
  // bisa ditambahkan di sini.
  function psInverterTypeToCategory(normType) {
    if (normType === "on-grid") return "on-grid";
    if (normType === "off-grid") return "off-grid-diesel";
    if (normType === "hybrid") return "hybrid-on-grid";
    return null;
  }

  // Timpa p.category tiap proyek dengan kategori yang diturunkan dari Type
  // (On-grid/Off-grid/Hybrid) yang SAMA PERSIS dengan yang ditampilkan di
  // tab System Information (sys.inverterOverview.inverterType) untuk
  // system-system milik proyek itu -- BUKAN lagi field project.category
  // dari GET /projects/:id/analytics (yang memang sering kosong, lihat
  // komentar psBuildProjectFromApi()).
  //
  // PERBAIKAN (TKT-000045 lanjutan): sebelumnya fungsi ini query ke
  // mini-backend LOKAL LAMA server/server.js (endpoint /api/systems) --
  // itu BUKAN sumber data Type yang sebenarnya dipakai tab System
  // Information untuk proyek-proyek real (Tawabi, Kasdam, dst). Type
  // yang tampil di System Information datang dari Core API real
  // (GET /projects/:id lewat edashApiFetch(), lihat loadSystemsForProject()
  // di js/system-information.js), jadi selama ini SEMUA proyek selalu
  // jatuh ke default "on-grid" di sini (Type-nya tidak pernah ketemu di
  // /api/systems yang memang tidak berisi data proyek real) -- pin peta
  // jadi selalu biru semua walau Type asli di System Information sudah
  // benar (mis. Tawabi = Hybrid). Sekarang dipanggil LANGSUNG lewat
  // window.__siLoadSystemsForProject() (diekspos oleh
  // js/system-information.js = loadSystemsForProject() aslinya) supaya
  // sumber datanya 100% sama dengan yang ditampilkan di System
  // Information, per proyek (bukan cuma proyek yang sedang aktif).
  //
  // Kalau proyeknya belum punya system tercatat sama sekali (mis. baru
  // ditambahkan, atau Core API-nya gagal dimuat), category dibiarkan
  // default "on-grid" apa adanya. Kalau system-system dalam 1 proyek
  // punya Type berbeda-beda (jarang), dipakai Type yang paling sering
  // muncul.
  async function psApplyInverterTypeCategories() {

    if (typeof window.__siLoadSystemsForProject !== "function") {
      console.warn("[project-selector] window.__siLoadSystemsForProject tidak tersedia (js/system-information.js belum termuat?), kategori Type dilewati.");
      return;
    }

    await Promise.all(psProjects.map(async (p) => {
      try {
        // Kalau proyek ini kebetulan SUDAH pernah dimuat System
        // Information di sesi ini (mis. user barusan buka tab System
        // Information / Task Management utk proyek yang sama), pakai
        // cache-nya (window.__siSystems) supaya tidak GET /projects/:id
        // dua kali percuma. Kalau belum, fetch langsung.
        const cached = (window.__siSystems || []).filter((s) => s.basic && s.basic.projectId === p.id);
        const systems = cached.length ? cached : await window.__siLoadSystemsForProject(p.id);
        if (!systems || !systems.length) return;

        // PENTING: window.__siLoadSystemsForProject() cuma FETCH & RETURN,
        // tidak pernah nulis balik ke window.__siSystems sendiri -- jadi
        // kalau hasil fetch di sini (bukan dari cache) tidak disimpan,
        // window.__siGetProjectOnlineStatus() (dipakai psRefreshLiveStatuses
        // di bawah utk cross-check status Online/Offline) akan SELALU
        // return null utk proyek ini, walau system-nya baru saja berhasil
        // dimuat barusan -- cross-check itu jadi percuma kecuali user
        // KEBETULAN sudah pernah buka tab System Information sendiri.
        // Simpan di sini (dedup by id) supaya cross-check itu benar-benar
        // aktif untuk SEMUA proyek begitu Project Selector/Dashboard
        // pertama kali dimuat, bukan cuma proyek yang sedang aktif di
        // System Information.
        if (!cached.length) {
          window.__siSystems = window.__siSystems || [];
          const existingIds = new Set(window.__siSystems.map((s) => s.id));
          systems.forEach((s) => { if (!existingIds.has(s.id)) window.__siSystems.push(s); });
        }

        const ownCategories = systems
          .map((s) => psInverterTypeToCategory(psNormalizeInverterType(s.inverterOverview && s.inverterOverview.inverterType)))
          .filter(Boolean);
        if (!ownCategories.length) return;

        const counts = {};
        ownCategories.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
        p.category = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      } catch (e) {
        console.warn(`[project-selector] Gagal ambil Type System Information utk proyek "${p.id}":`, e.message);
      }
    }));

  }

  // Update ulang tampilan pin peta (warna) + popup-nya (label kategori)
  // untuk 1 proyek -- dipanggil setelah status/kategori proyek itu
  // ke-refresh di background (psRefreshLiveStatuses/
  // psApplyInverterTypeCategories), yang bisa selesai SETELAH pin-nya
  // sudah sempat dibuat duluan oleh psAddMarker() (event "load" peta).
  function psRefreshMarkerVisual(p) {

    const marker = psMarkers[p.id];
    const meta = categoryMeta(p.category);

    if (marker) {
      const pinEl = marker.getElement().querySelector(".ps-pin");
      if (pinEl) pinEl.style.setProperty("--pin-color", meta.color);
    }

    const popup = psPopups[p.id];
    if (popup) {
      popup.setHTML(`
        <div class="ps-popup-title">${escapeHtml(p.name)}</div>
        <div class="ps-popup-category">${escapeHtml(meta.label)} • ${p.status === "online" ? "Online" : "Offline"}</div>
      `);
    }

  }

  // ===========================================================
  // Load & merge data proyek — SEKARANG 100% dari API backend real
  // (GET /api/v1/projects + GET /api/v1/projects/:id/analytics),
  // SEMUA proyek yang dikembalikan API ditampilkan (bukan cuma Tawabi
  // lagi). server/data/projects.json (dummy builtin) dan
  // localStorage["edash-user-projects"] (proyek buatan user lewat
  // "Add New Project") SENGAJA TIDAK dipakai lagi di sini — halaman
  // ini cuma boleh nampilin data proyek real dari API.
  // ===========================================================

  // Response backend pakai snake_case (project_name, total_peak_kwp,
  // dst) meski dokumentasi PDF nulisnya camelCase — lihat catatan yang
  // sama di js/dashboard.js (poSnakeToCamelDeep). Helper ringan yang
  // sama ditulis ulang di sini karena project-selector.js modul terpisah
  // (IIFE) dan tidak mengakses scope dashboard.js.
  function psSnakeToCamelDeep(value) {
    if (Array.isArray(value)) return value.map(psSnakeToCamelDeep);
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, v] of Object.entries(value)) {
        const camelKey = key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
        out[camelKey] = psSnakeToCamelDeep(v);
        if (camelKey !== key) out[key] = out[camelKey];
      }
      return out;
    }
    return value;
  }

  function psExtractCoord(project, keys) {
    for (const key of keys) {
      const value = key.split(".").reduce((o, k) => o?.[k], project);
      if (value === null || value === undefined || value === "") continue;
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    return null;
  }

  // Sama seperti PO_TARGET_INTENSITY_MWH_PER_MWP di js/dashboard.js —
  // dipakai kalau mlMetrics.expectedEnergyTodayKwh tidak tersedia dari
  // analytics, supaya target harian tidak 0/kosong.
  const PS_TARGET_INTENSITY_MWH_PER_MWP = 65;

  async function psFetchProjectAnalytics(projectId) {
    try {
      return psSnakeToCamelDeep(await psApiFetch(`/projects/${projectId}/analytics`));
    } catch (e) {
      console.warn(`[project-selector] GET /projects/${projectId}/analytics gagal:`, e.message);
      return null;
    }
  }

  // project: 1 item mentah dari GET /api/v1/projects (sudah camelCase).
  // analytics: hasil GET /api/v1/projects/:id/analytics buat proyek ini
  // (bisa null kalau gagal/404 — proyeknya tetap ditampilkan, cuma
  // angka-angkanya jadi 0).
  function psBuildProjectFromApi(project, analytics) {

    const name = project.projectName || project.project_name || project.name || "Proyek Tanpa Nama";
    const isTawabi = PS_TAWABI_NAME_RE.test(name);

    const totalPeakKwp = analytics?.totalPeakKwp ?? 0;
    const energyTodayKwh = analytics?.realtime?.energyTodayKwh ?? 0;
    const co2ReductionKg = analytics?.realtime?.todayCo2ReductionKg ?? 0;
    const expectedEnergyTodayKwh = analytics?.mlMetrics?.expectedEnergyTodayKwh;

    const capacityMWp = +(totalPeakKwp / 1000).toFixed(3);
    const dailyTargetMWh = typeof expectedEnergyTodayKwh === "number"
      ? +(expectedEnergyTodayKwh / 1000).toFixed(3)
      : +(capacityMWp * PS_TARGET_INTENSITY_MWH_PER_MWP).toFixed(1);

    return {
      // Proyek Tawabi tetap dapat id tetap "tawabi" (dipakai
      // psLoadChartsForProject dkk buat milih sumber telemetry live).
      // Proyek lain pakai id asli dari backend (stabil antar refresh),
      // fallback ke slug nama kalau API tidak mengirim `id`.
      id: isTawabi ? "tawabi" : (project.id || psSlug(name)),
      _isUser: false,
      name,
      location: project.location,
      category: project.category || "on-grid", // API belum tentu punya field kategori — lihat catatan di bawah psLoadProjects()
      lat: psExtractCoord(project, ["latitude", "lat"]),
      lng: psExtractCoord(project, ["longitude", "lng", "lon"]),
      // Default optimis "online" cuma buat render pertama (biar list/peta
      // tidak kosong sambil nunggu network) -- status SEBENARNYA ditimpa
      // sesaat kemudian oleh psRefreshLiveStatuses() begitu psLoadProjects()
      // selesai, berdasarkan sinyal yang SAMA dengan yang dipakai untuk
      // memutuskan Today/Power chart pakai data live atau placeholder
      // (psGetLiveDataForProject): device belum terdaftar / semua device
      // gagal dibaca -> "offline", ada minimal 1 device yang berhasil
      // dibaca -> "online". Lihat psRefreshLiveStatuses() di bawah.
      status: "online",
      alerts: 0, // GET /api/v1/alerts belum diimplement backend (404) — lihat catatan di dashboard.js
      saved: isTawabi,
      capacityMWp,
      generatedMWh: +(energyTodayKwh / 1000).toFixed(3),
      co2AvoidedT: +(co2ReductionKg / 1000).toFixed(3),
      dailyTargetMWh,
      schedule: [] // /api/v1/maintenance ada tapi belum dipakai di sini — daftar kosong = "No upcoming maintenance scheduled."
    };

  }

  async function psLoadProjects() {

    let rawProjects;
    try {
      rawProjects = psSnakeToCamelDeep(await psApiFetch("/projects"));
    } catch (e) {
      console.warn("[project-selector] GET /projects gagal:", e.message);
      psProjects = [];
      return;
    }

    const list = Array.isArray(rawProjects) ? rawProjects : [];

    if (!list.length) {
      console.warn("[project-selector] GET /api/v1/projects mengembalikan daftar kosong.");
      psProjects = [];
      return;
    }

    // Semua proyek dipanggil sekaligus (paralel), masing-masing dengan
    // GET /projects/:id/analytics sendiri — kalau analytics 1 proyek
    // gagal, proyek itu tetap muncul (psFetchProjectAnalytics sudah
    // menangkap error & return null), proyek lain tidak ikut gagal.
    psProjects = await Promise.all(
      list.map(async (raw) => psBuildProjectFromApi(raw, await psFetchProjectAnalytics(raw.id)))
    );

  }

  // Satu-satunya sumber device id per proyek dipakai psRefreshLiveStatuses
  // (di bawah) DAN diekspos ke js/dashboard.js (window.__psGetProjectDeviceIds)
  // supaya kedua halaman menghitung Online/Offline dari device list yang
  // SAMA PERSIS -- sebelumnya Dashboard menurunkan device id sendiri dari
  // GET /projects/:id (poExtractDeviceIds, generik utk semua proyek termasuk
  // Tawabi), sedangkan Project Selector khusus Tawabi malah cari device
  // secara global by-provider/nama (psDiscoverTawabiDevices) -- dua cara
  // beda ini bisa menghasilkan daftar device (dan karenanya angka
  // Online/Offline) yang berbeda untuk proyek yang sama.
  async function psGetProjectDeviceIds(project) {
    const devices = project.id === "tawabi"
      ? await psDiscoverTawabiDevices()
      : await psDiscoverProjectDevices(project);
    return devices.map((d) => d.id);
  }
  window.__psGetProjectDeviceIds = psGetProjectDeviceIds;

  // Ambil status "online"/"offline" SATU device langsung dari field
  // deterministik baru GET /devices/:id/telemetry/latest -> data.status
  // (dokumentasi fitur "Indikator Deterministik Status Online/Offline";
  // backend yang menghitungnya lewat heartbeat, bukan frontend lagi —
  // disamakan persis dengan poFetchDeviceOnlineStatus() di js/dashboard.js).
  async function psFetchDeviceOnlineStatus(deviceId) {
    try {
      const data = await psFetchLatest(deviceId);
      return data?.status === "online";
    } catch (e) {
      // Device tidak bisa dibaca sama sekali (timeout/404/dll) -> anggap
      // offline, konsisten dengan definisi "offline" di kontrak endpoint.
      return false;
    }
  }

  // Deteksi status online/offline REAL per proyek, langsung dari field
  // "status" deterministik GET /devices/:id/telemetry/latest -- proyek
  // dianggap "online" kalau MINIMAL SATU device-nya online. Device id-nya
  // dari psGetProjectDeviceIds() di atas (SAMA yang dipakai Dashboard lewat
  // window.__psGetProjectDeviceIds), jadi tidak perlu endpoint baru.
  // Dipanggil di background setelah render pertama (lihat
  // initProjectSelector()), jadi tidak menahan render awal.
  async function psRefreshLiveStatuses() {
    await Promise.all(psProjects.map(async (p) => {
      try {
        const deviceIds = await psGetProjectDeviceIds(p);

        if (!deviceIds.length) {
          p.status = "offline";
          return;
        }

        const statuses = await Promise.all(deviceIds.map(psFetchDeviceOnlineStatus));
        p.status = statuses.some(Boolean) ? "online" : "offline";
      } catch (e) {
        p.status = "offline";
      }
    }));
  }

  // ===========================================================
  // Ringkasan / kategori / statistik generasi
  // ===========================================================

  function psRenderSummary() {

    const all = psProjects.length;
    const online = psProjects.filter((p) => p.status === "online").length;
    const offline = all - online;
    const alerts = psProjects.reduce((sum, p) => sum + (Number(p.alerts) || 0), 0);

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setVal("psSummaryAll", all);
    setVal("psSummaryOnline", online);
    setVal("psSummaryOffline", offline);
    setVal("psSummaryAlerts", alerts);

  }

  function psRenderCategoryLegend() {

    const wrap = document.getElementById("psLegend");
    if (!wrap) return;

    // "rooftop" = alias lama (lihat categoryMeta()) — dihitung ke
    // dalam bucket "on-grid" supaya proyek lama tidak nyasar/hilang.
    // Proyek dengan category lain di luar PS_CATEGORY_ORDER (mis.
    // "bss" atau "fish-farm" standalone) SENGAJA tidak dihitung sama
    // sekali di widget Category ini.
    const counts = {};
    PS_CATEGORY_ORDER.forEach((c) => { counts[c] = 0; });
    psProjects.forEach((p) => {
      const key = p.category === "rooftop" ? "on-grid" : p.category;
      if (counts[key] !== undefined) counts[key] += 1;
    });

    // TKT-000045: kategori dengan 0 proyek disembunyikan supaya panel
    // "Project Locations" tidak penuh kotak kosong begitu daftar
    // kategori bertambah jadi 6 jenis proyek solar — kecuali user
    // nyalakan checkbox "Show all" (#psShowAllCategories).
    const visibleKeys = psShowAllCategories
      ? PS_CATEGORY_ORDER
      : PS_CATEGORY_ORDER.filter((key) => (counts[key] || 0) > 0);

    if (visibleKeys.length === 0) {
      wrap.innerHTML = `<div class="ps-category-empty">Belum ada proyek</div>`;
      return;
    }

    wrap.innerHTML = visibleKeys.map((key) => {
      const meta = categoryMeta(key);
      return `
        <div class="ps-category-item" style="--cat-bg:${meta.bg}; --cat-border:${meta.bg}; --cat-icon-bg:${meta.iconBg}; --cat-color:${meta.color};">
          <span class="ps-category-icon"><i class="fa-solid ${meta.icon}"></i></span>
          <span class="ps-category-value">${counts[key]}</span>
          <span class="ps-category-label">${escapeHtml(meta.label)}</span>
        </div>
      `;
    }).join("");

  }

  function psRenderGenerationStats() {

    const totalMWh = psProjects.reduce((s, p) => s + (Number(p.generatedMWh) || 0), 0);
    const totalMWp = psProjects.reduce((s, p) => s + (Number(p.capacityMWp) || 0), 0);
    const totalCO2 = psProjects.reduce((s, p) => s + (Number(p.co2AvoidedT) || 0), 0);

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setVal("psGenMWh", fmtNum(totalMWh, totalMWh < 10 ? 2 : 1));
    setVal("psGenMWp", fmtNum(totalMWp, totalMWp < 10 ? 2 : 1));
    setVal("psGenCO2", fmtNum(totalCO2, totalCO2 < 10 ? 2 : 1));

  }

  // ===========================================================
  // Tabel "Saved Projects" & "All Projects"
  // ===========================================================

  function psRowHtml(p) {

    const isOffline = p.status !== "online";
    const isActive = p.id === psActiveId;

    return `
      <div class="ps-table-row ${isActive ? "is-active" : ""}" data-id="${escapeHtml(p.id)}">
        <span class="ps-table-row-name">
          <span class="ps-status-dot ${isOffline ? "is-offline" : ""}"></span>
          ${escapeHtml(p.name)}
        </span>
        <span class="ps-table-row-location">${escapeHtml(p.location || "-")}</span>
        <span class="ps-table-row-actions">
          <button type="button" class="ps-row-action-btn ps-action-save ${p.saved ? "is-saved" : ""}" data-action="save" title="${p.saved ? "Unsave" : "Save"}">
            <i class="fa-solid fa-star"></i>
          </button>
          <button type="button" class="ps-row-action-btn ps-action-delete ${p._isUser ? "" : "is-disabled"}" data-action="delete" title="${p._isUser ? "Delete" : "Built-in project"}" ${p._isUser ? "" : "disabled"}>
            <i class="fa-solid fa-trash"></i>
          </button>
        </span>
      </div>
    `;

  }

  function psRenderSavedRows() {

    const wrap = document.getElementById("psSavedRows");
    if (!wrap) return;

    const saved = psProjects.filter((p) => p.saved);

    wrap.innerHTML = saved.length
      ? saved.map(psRowHtml).join("")
      : `<div class="ps-empty">No saved projects yet.</div>`;

    psBindRowEvents(wrap);

  }

  function psRenderAllRows() {

    const wrap = document.getElementById("psAllRows");
    if (!wrap) return;

    const term = psSearchTerm.trim().toLowerCase();
    const list = term
      ? psProjects.filter((p) =>
          (p.name || "").toLowerCase().includes(term) ||
          (p.location || "").toLowerCase().includes(term))
      : psProjects;

    wrap.innerHTML = list.length
      ? list.map(psRowHtml).join("")
      : `<div class="ps-empty">No projects found.</div>`;

    psBindRowEvents(wrap);

  }

  function psBindRowEvents(wrap) {

    wrap.querySelectorAll(".ps-table-row").forEach((row) => {

      const id = row.getAttribute("data-id");

      row.addEventListener("click", (e) => {
        if (e.target.closest(".ps-row-action-btn")) return;
        psSelectProject(id);
      });

      const saveBtn = row.querySelector('[data-action="save"]');
      if (saveBtn) {
        saveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          psToggleSaved(id);
        });
      }

      const delBtn = row.querySelector('[data-action="delete"]');
      if (delBtn && !delBtn.disabled) {
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          psDeleteUserProject(id);
        });
      }

    });

  }

  function psToggleSaved(id) {

    const p = psProjects.find((x) => x.id === id);
    if (!p) return;

    p.saved = !p.saved;

    // Proyek user-added: persist balik ke localStorage supaya tidak
    // hilang saat halaman di-reload. Proyek builtin (termasuk "tawabi")
    // cuma diubah in-memory untuk sesi ini karena projects.json adalah
    // file statis yang tidak bisa ditulis balik dari browser.
    if (p._isUser && typeof window.PC_getUserProjects === "function") {
      try {
        const list = window.PC_getUserProjects();
        const match = list.find((x) => x.id === id);
        if (match) {
          match.saved = p.saved;
          localStorage.setItem(LS_USER_PROJECTS, JSON.stringify(list));
        }
      } catch (e) {
        console.warn("[project-selector] Gagal menyimpan status saved:", e.message);
      }
    }

    psRenderSummary();
    psRenderSavedRows();
    psRenderAllRows();

  }

  function psDeleteUserProject(id) {

    const p = psProjects.find((x) => x.id === id);
    if (!p || !p._isUser) return;

    if (!window.confirm(`Delete "${p.name}" from Project Selector?`)) return;

    psProjects = psProjects.filter((x) => x.id !== id);

    if (typeof window.PC_getUserProjects === "function") {
      try {
        const list = window.PC_getUserProjects().filter((x) => x.id !== id);
        localStorage.setItem(LS_USER_PROJECTS, JSON.stringify(list));
      } catch (e) {
        console.warn("[project-selector] Gagal menghapus proyek user:", e.message);
      }
    }

    if (psMarkers[id]) {
      psMarkers[id].remove();
      delete psMarkers[id];
    }
    if (psPopups[id]) {
      psPopups[id].remove();
      delete psPopups[id];
    }

    if (psActiveId === id) {
      psActiveId = null;
      document.querySelector(".ps-page")?.classList.remove("is-detail");
      document.getElementById("psTodayFloat")?.classList.remove("is-detail");
      psRenderAggregateTodayChart();
    }

    psRenderSummary();
    psRenderCategoryLegend();
    psRenderGenerationStats();
    psRenderSavedRows();
    psRenderAllRows();

  }

  // ===========================================================
  // Peta (MapLibre GL JS)
  // ===========================================================

  function psFitToAllProjects() {
    if (!psMap) return;
    const coords = psProjects
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => [p.lng, p.lat]);

    if (coords.length === 0) return;

    if (coords.length === 1) {
      psMap.jumpTo({ center: coords[0], zoom: Math.min(psMap.getZoom() || PS_INITIAL_ZOOM, 9) });
      return;
    }

    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0])
    );

    // Panel "Project Locations" ada di kanan (lebar ~450px), jadi kasih
    // padding kanan lebih besar supaya pin di sisi timur Indonesia tidak
    // ketutupan panel itu.
    psMap.fitBounds(bounds, {
      padding: { top: 60, bottom: 60, left: 60, right: 470 },
      maxZoom: PS_INITIAL_ZOOM + 2,
      duration: 0
    });
  }

  function psInitMap() {

    const mapEl = document.getElementById("psMap");
    if (!mapEl || typeof maplibregl === "undefined") {
      if (typeof maplibregl === "undefined") console.warn("[project-selector] MapLibre GL JS belum ter-load, peta dilewati.");
      return;
    }

    // Avoid double initialization when navigating away and back to this page
    if (mapEl._maplibreMap) { psMap = mapEl._maplibreMap; return; }

    // Kalau halaman ini dibuka lewat navigasi SPA (bukan reload penuh
    // browser), #psMap kadang masih berukuran 0x0 di frame ini karena
    // layout/transisi container-nya belum selesai. Membuat instance
    // MapLibre di container 0x0 membuat WebGL context-nya gagal
    // permanen — resize() belakangan tidak bisa memperbaikinya lagi
    // (makanya sebelumnya cuma muncul teks fallback "Project map will
    // appear here"). Solusinya: tunda pembuatan peta sampai container
    // benar-benar sudah punya ukuran nyata.
    let psInitMapAttempts = 0;
    const tryCreateMap = () => {

      if (!document.body.contains(mapEl)) return; // halaman sudah ditinggalkan lagi

      if ((mapEl.offsetWidth === 0 || mapEl.offsetHeight === 0) && psInitMapAttempts < 300) {
        psInitMapAttempts += 1;
        requestAnimationFrame(tryCreateMap);
        return;
      }

      psCreateMapInstance(mapEl);

    };

    tryCreateMap();

  }

  function psCreateMapInstance(mapEl) {

    // MapLibre memakai WebGL, dan browser membatasi jumlah context WebGL
    // yang boleh hidup bersamaan (biasanya ~8-16). Kalau instance peta
    // SEBELUMNYA (dari kunjungan ke halaman ini sebelum ini) tidak pernah
    // di-.remove(), context WebGL-nya cuma "ditinggal" — bukan langsung
    // dibuang — dan lama-lama menghabiskan slot context itu sampai
    // instance peta yang baru gagal render sama sekali (makanya perlu
    // refresh browser buat "reset" semua context lama). Buang instance
    // lama secara eksplisit di sini sebelum bikin yang baru.
    if (psMap) {
      try { psMap.remove(); } catch (e) { /* sudah dilepas / rusak, abaikan */ }
      psMap = null;
    }

    psMap = new maplibregl.Map({
      container: mapEl,
      // FIX (2026-09-08, permintaan user): map SELALU pakai basemap
      // light/streets, TIDAK ikut berubah ke basemap dark walau tema
      // aplikasi di-toggle dark -- disamakan dengan js/dashboard.js yang
      // dari awal memang begitu (lihat PO_STREET_STYLE_URL di sana).
      // psIsDarkTheme()/PS_STREET_DARK_STYLE_URL masih ada di bawah kalau
      // sewaktu-waktu mode dark map ini mau diaktifkan lagi.
      style: PS_STREET_STYLE_URL,
      center: [PS_INITIAL_CENTER[1], PS_INITIAL_CENTER[0]], // MapLibre: [lng, lat]
      zoom: PS_INITIAL_ZOOM,
      attributionControl: false
    });
    mapEl._maplibreMap = psMap;
    psMapEl = mapEl;
    psCurrentBasemap = "streets";

    // Jaga canvas selalu sinkron kalau ukuran container berubah setelah
    // map dibuat (mis. transisi layout SPA yang belum selesai saat init) —
    // supaya tidak ada strip tile kosong akibat canvas WebGL yang
    // ukurannya nggak pas sama container aslinya.
    if (typeof ResizeObserver !== "undefined") {
      const psResizeObserver = new ResizeObserver(() => {
        if (psMap) psMap.resize();
      });
      psResizeObserver.observe(mapEl);
      mapEl._psResizeObserver = psResizeObserver;
    }

    psMap.on("load", () => {
      psProjects.forEach((p) => psAddMarker(p));
      psFitToAllProjects();
    });

    // Kalau tema di-toggle (via Settings) sementara halaman Project
    // Selector masih terbuka, ganti basemap ke varian dark/light yang
    // sesuai tanpa mengubah posisi/zoom peta atau mode streets/hybrid
    // yang sedang aktif.
    if (!psThemeObserver) {
      psThemeObserver = new MutationObserver(() => {
        if (!psMap) return;
        psSetTileLayer(psCurrentBasemap);
      });
      psThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }

    // Peta di-mount di dalam container position:absolute (lihat
    // .ps-page/.ps-map-wrap di css/project-selector.css). Container-nya
    // masih bisa berubah ukuran setelahnya (sidebar toggle, dst) —
    // ResizeObserver memastikan resize() selalu dipanggil ulang tiap kali
    // ukuran nyata container berubah, kapan pun itu terjadi.
    if (psResizeObserver) {
      psResizeObserver.disconnect();
      psResizeObserver = null;
    }
    if (typeof ResizeObserver !== "undefined") {
      psResizeObserver = new ResizeObserver(() => {
        if (psMap) psMap.resize();
      });
      psResizeObserver.observe(mapEl);
    }
    setTimeout(() => { if (psMap) psMap.resize(); }, 150);

    window.removeEventListener("resize", psHandleMapResize);
    window.addEventListener("resize", psHandleMapResize);

    // Buang peta ini SEGERA begitu halaman ditinggalkan (bukan menunggu
    // sampai halaman ini dibuka lagi lain kali) — main.js mengganti
    // #page-root.innerHTML setiap kali route berpindah, jadi mutasi pada
    // #page-root adalah sinyal paling awal & paling andal bahwa halaman
    // ini sudah tidak aktif lagi.
    if (!psPageRootObserver) {
      const pageRoot = document.getElementById("page-root");
      if (pageRoot && typeof MutationObserver !== "undefined") {
        psPageRootObserver = new MutationObserver(() => {
          if (psMapEl && !document.body.contains(psMapEl) && psMap) {
            try { psMap.remove(); } catch (e) { /* abaikan */ }
            psMap = null;
            psMapEl = null;
            if (psResizeObserver) { psResizeObserver.disconnect(); psResizeObserver = null; }
          }
        });
        psPageRootObserver.observe(pageRoot, { childList: true });
      }
    }

  }

  function psHandleMapResize() {
    if (psMap) psMap.resize();
  }

  function psIsDarkTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark";
  }

  function psSetTileLayer(mode) {

    if (!psMap) return;

    psCurrentBasemap = mode;

    // Streets SELALU basemap light (lihat catatan di psCreateMapInstance).
    const target = mode === "hybrid"
      ? psSatelliteStyle()
      : PS_STREET_STYLE_URL;

    psMap.setStyle(target);

  }

  function psAddMarker(p) {

    if (p.lat == null || p.lng == null || !psMap) return;

    const meta = categoryMeta(p.category);

    const el = document.createElement("div");
    el.className = "ps-pin-icon";
    el.innerHTML = `<div class="ps-pin-wrap"><div class="ps-pin" style="--pin-color:${meta.color};"></div></div>`;

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([p.lng, p.lat])
      .addTo(psMap);

    const popup = new maplibregl.Popup({ offset: 30, closeOnClick: false }).setHTML(`
      <div class="ps-popup-title">${escapeHtml(p.name)}</div>
      <div class="ps-popup-category">${escapeHtml(meta.label)} • ${p.status === "online" ? "Online" : "Offline"}</div>
    `);

    el.addEventListener("click", () => psSelectProject(p.id));

    psMarkers[p.id] = marker;
    psPopups[p.id] = popup;

  }

  function psOpenMarkerPopup(id) {
    const popup = psPopups[id];
    const marker = psMarkers[id];
    if (!popup || !marker || !psMap) return;
    popup.setLngLat(marker.getLngLat()).addTo(psMap);
  }

  function psCloseAllPopups() {
    Object.values(psPopups).forEach((popup) => {
      if (popup.isOpen()) popup.remove();
    });
  }



  // ===========================================================
  // Pilih proyek: Today chart selalu ikut proyek yang dipilih,
  // "detail mode" (kartu detail + Power Output + Upcoming Schedule)
  // hanya aktif kalau enterDetail !== false (klik marker/baris).
  // ===========================================================

  function psSelectProject(id, opts) {

    opts = opts || {};
    const enterDetail = opts.enterDetail !== false;
    const skipZoom = !!opts.skipZoom;

    const p = psProjects.find((x) => x.id === id);
    if (!p) return;

    psActiveId = id;

    if (enterDetail) {
      document.querySelector(".ps-page")?.classList.add("is-detail");
    }

    const isDetailNow = !!document.querySelector(".ps-page.is-detail");
    document.getElementById("psTodayFloat")?.classList.toggle("is-detail", isDetailNow);

    psRenderDetailPanel(p);
    psRenderSchedule(p);
    psHighlightActiveRow();

    if (!skipZoom && p.lat != null && psMap) {
      if (enterDetail) {
        // Masuk detail -> zoom ke level atap, lalu basemap otomatis
        // pindah ke Satellite Hybrid begitu animasinya selesai.
        psMap.flyTo({ center: [p.lng, p.lat], zoom: PS_DETAIL_ZOOM, duration: 900 });
        psMap.once("moveend", () => psSetTileLayer("hybrid"));
        setTimeout(() => { if (psMap) psMap.resize(); }, 300);
      } else {
        psMap.flyTo({ center: [p.lng, p.lat], zoom: Math.max(psMap.getZoom(), 9), duration: 600 });
      }
    }

    if (psMarkers[id] && enterDetail) {
      psOpenMarkerPopup(id);
    }

    psLoadChartsForProject(p);

  }

  function psHighlightActiveRow() {
    document.querySelectorAll(".ps-table-row").forEach((row) => {
      row.classList.toggle("is-active", row.getAttribute("data-id") === psActiveId);
    });
  }

  function psRenderDetailPanel(p) {

    const nameEl = document.getElementById("psDetailName");
    const locEl = document.getElementById("psDetailLocation");
    if (nameEl) nameEl.textContent = p.name;
    if (locEl) locEl.textContent = p.location || "-";

  }

  function psRenderSchedule(p) {

    const list = document.getElementById("psHistoryList");
    const countEl = document.getElementById("psHistoryCount");

    const items = Array.isArray(p.schedule) ? p.schedule : [];

    if (countEl) countEl.textContent = `(${items.length})`;
    if (!list) return;

    if (!items.length) {
      list.innerHTML = `<div class="ps-empty">No upcoming maintenance scheduled.</div>`;
      return;
    }

    list.innerHTML = items.map((it) => `
      <div class="ps-history-item">
        <span class="ps-history-icon"><i class="fa-solid fa-screwdriver-wrench"></i></span>
        <span class="ps-history-body">
          <span class="ps-history-item-title">${escapeHtml(it.title || "Maintenance")}</span>
          ${it.note || it.description ? `<span class="ps-history-item-note">${escapeHtml(it.note || it.description)}</span>` : ""}
          <span class="ps-history-tags">
            ${it.date ? `<span class="ps-history-tag"><i class="fa-regular fa-calendar"></i>${escapeHtml(it.date)}</span>` : ""}
            ${it.device ? `<span class="ps-history-tag ps-history-tag-device"><i class="fa-solid fa-microchip"></i>${escapeHtml(it.device)}</span>` : ""}
          </span>
        </span>
      </div>
    `).join("");

  }

  // ===========================================================
  // Data real PLTS Tawabi — API LIVE dulu (backend Hono di
  // 360edashboard.com), server/data/*.json cuma fallback kalau API
  // gagal / device belum terdaftar di ThingsBoard.
  // ===========================================================

  // Wrapper tipis di atas window.edashApiFetch (js/api-config.js) —
  // sudah otomatis pakai credentials:"include" (ikut session_token
  // cookie dari login yang sedang aktif) dan sudah nge-handle format
  // { success, data } / { success:false, error } dari backend.
  async function psApiFetch(path) {
    if (typeof window.edashApiFetch === "function") {
      return window.edashApiFetch(path);
    }
    // Fallback minimal kalau js/api-config.js entah kenapa belum ter-load.
    const base = window.EDASH_BACKEND_API_BASE || "/api/v1";
    const res = await fetch(`${base}${path}`, { credentials: "include" });
    const body = await res.json().catch(() => null);
    if (!body || body.success !== true) {
      throw new Error((body && body.error && body.error.message) || `HTTP ${res.status}`);
    }
    return body.data;
  }

  // Cari 2 inverter PLTS Tawabi (Grup 1 & 2) dan ambil thingsboardDeviceId
  // ASLI-nya — di server/data/systems.json field ini masih "-" (belum
  // pernah didaftarkan saat data lokal itu dibuat), jadi device ID TIDAK
  // di-hardcode di sini, selalu di-discover live per PDF §4.2.
  async function psDiscoverTawabiDevices(forceRefresh) {

    if (psDeviceCache.has("tawabi") && !forceRefresh) return psDeviceCache.get("tawabi");

    let list = [];
    try {
      list = await psApiFetch(`/devices/inverters/by-provider?provider=${encodeURIComponent(PS_TAWABI_PROVIDER)}`);
    } catch (e) {
      console.warn("[project-selector] /devices/inverters/by-provider gagal, coba /devices/inverters:", e.message);
    }

    if (!Array.isArray(list) || !list.length) {
      try {
        list = await psApiFetch("/devices/inverters");
      } catch (e) {
        console.warn("[project-selector] /devices/inverters gagal:", e.message);
        list = [];
      }
    }

    const tawabiDevices = (Array.isArray(list) ? list : [])
      .filter((d) => PS_TAWABI_NAME_RE.test(d.name || ""))
      .map((d) => ({ id: d.thingsboardDeviceId || d.id, name: d.name }))
      .filter((d) => !!d.id);

    psDeviceCache.set("tawabi", tawabiDevices);
    return tawabiDevices;

  }

  // Cari device (inverter) milik SEMUA proyek selain Tawabi, lewat
  // GET /projects/:id (PDF §5.1: "Detail proyek lengkap beserta unit
  // sistem dan inverter terpasang").
  //
  // FIX (2026-09-08): fungsi ini SEBELUMNYA scan REKURSIF cari objek
  // manapun di response yang punya field `thingsboardDeviceId` -- field
  // itu ASUMSI yang keliru. Tabel `devices` di Postgres (lihat
  // db/migrations/001_initial_schema.sql) TIDAK punya kolom
  // `thingsboard_device_id` terpisah -- kolom `id` DEVICE ITU SENDIRI
  // sudah berisi ID ThingsBoard-nya ("id VARCHAR(100) PRIMARY KEY -- ID
  // ThingsBoard"). Jadi field `thingsboardDeviceId` TIDAK PERNAH ada di
  // body GET /projects/:id, dan scan rekursif di atas SELALU pulang
  // dengan array kosong untuk SEMUA proyek kecuali Tawabi (lookup
  // terpisah by-provider) & Kasdam (fallback hardcode) -- device list
  // kosong -> psRefreshLiveStatuses/poRefreshLiveStatuses langsung
  // menganggap proyek itu "offline" TANPA PERNAH mengecek telemetry-nya
  // sama sekali. Ini akar masalah kenapa status Online/Offline di
  // Dashboard (dan Project Selector) selalu salah untuk proyek selain
  // Tawabi/Kasdam.
  //
  // Perbaikan: ambil device langsung dari lokasi yang MEMANG berisi
  // device (systems[].devices / systems[].inverters, atau devices/
  // inverters di root proyek) -- sama persis pola yang sudah dipakai
  // poExtractDeviceIds() di js/dashboard.js -- lalu baca field `id`
  // (bukan `thingsboardDeviceId`) sebagai device id-nya. Ditargetkan ke
  // lokasi yang benar (bukan scan buta ke semua node) supaya tidak
  // ikut menangkap `id` milik objek lain (project/system) sebagai
  // device id palsu.
  async function psDiscoverProjectDevices(project, forceRefresh) {

    if (psDeviceCache.has(project.id) && !forceRefresh) return psDeviceCache.get(project.id);

    let detail = null;
    try {
      detail = psSnakeToCamelDeep(await psApiFetch(`/projects/${project.id}`));
    } catch (e) {
      console.warn(`[project-selector] GET /projects/${project.id} gagal:`, e.message);
      psDeviceCache.set(project.id, []);
      return [];
    }

    const found = [];
    const seen = new Set();
    const pushDevice = (d) => {
      const devId = d?.id;
      if (devId && !seen.has(devId)) {
        seen.add(devId);
        // FIX: field aslinya `deviceName` (dari kolom `device_name`
        // setelah psSnakeToCamelDeep), BUKAN `name` -- fallback lama ke
        // `node.name` tidak pernah cocok sehingga selalu jatuh ke
        // deviceSn/devId saja.
        found.push({ id: devId, name: d.deviceName || d.name || d.deviceSn || devId });
      }
    };

    (detail?.systems || []).forEach((sys) => {
      (sys.devices || sys.inverters || []).forEach(pushDevice);
    });
    (detail?.devices || detail?.inverters || []).forEach(pushDevice);

    // Fallback KHUSUS Kasdam (lihat PS_KASDAM_FALLBACK_DEVICES di atas)
    // — kalau proyek Kasdam ternyata tidak membawa device ternested sama
    // sekali, pakai 2 device ID konkret dari dokumentasi PDF supaya
    // Today/Power chart & status Online/Offline-nya tidak jatuh ke
    // placeholder/offline terus.
    if (!found.length && PS_KASDAM_NAME_RE.test(project.name || "")) {
      console.warn(`[project-selector] Proyek Kasdam (${project.id}) tidak membawa device ternested, pakai fallback PS_KASDAM_FALLBACK_DEVICES dari dokumentasi PDF.`);
      found.push(...PS_KASDAM_FALLBACK_DEVICES);
    }

    psDeviceCache.set(project.id, found);
    return found;

  }

  function psGetPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  async function psFetchLatest(deviceId) {
    return psApiFetch(`/devices/${deviceId}/telemetry/latest`);
  }

  // `keys` boleh string tunggal ATAU array kandidat (di-gabung koma —
  // PDF §4.5: "keys: Filter key spesifik (opsional, pisahkan dengan
  // koma)"). Dipakai supaya satu request bisa nyoba beberapa nama
  // register sekaligus lintas provider (lihat PS_POWER_HISTORY_KEYS /
  // PS_ENERGY_DAILY_HISTORY_KEYS di bawah) tanpa perlu tahu provider
  // device-nya dulu.
  // FIX (2026-09-08): parameter ke-4 dulunya SELALU dikirim sebagai
  // query `last` (mis. "24h"), padahal PDF §4.5 cuma mendokumentasikan
  // 5 nilai relatif yang valid: 30m, 6h, 7d, 30d, 90d — TIDAK ada
  // "24h" di daftar itu. Backend menolak nilai relatif yang tidak
  // dikenal (400 VALIDATION_ERROR), jadi request kurva 24 jam SELALU
  // gagal → hourlyPowerKw tetap null → garis "Realized" di card Today
  // dan chart Power Output (tab 24 Hours) tidak pernah muncul, walau
  // /telemetry/latest (angka MWh + target %) tetap berhasil normal.
  // Perbaikan: untuk rentang 24 jam pakai `startTs`/`endTs` (rentang
  // absolut epoch ms, PDF §4.5) dari awal hari lokal WIT sampai
  // sekarang — bukan `last=24h` yang tidak didukung. Argumen ke-4
  // sekarang boleh berupa string relatif ("7d", dst, tetap query
  // `last`) ATAU object { startTs, endTs } (query absolut).
  // Batasi berapa device yang boleh nge-fetch telemetry/history serentak
  // (Laporan Optimasi Telemetry API §5 poin 2: Thundering Herd —
  // Promise.all() utk histori SELURUH device dalam satu proyek membebani
  // connection pool database). Device tetap semuanya diproses, tapi per
  // batch kecil berurutan, bukan satu tembakan Promise.all raksasa.
  const PS_HISTORY_BATCH_SIZE = 5;

  async function psRunInBatches(items, batchSize, worker) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      results.push(...await Promise.all(batch.map(worker)));
    }
    return results;
  }

  async function psFetchHistory(deviceId, keys, range) {
    const keysParam = Array.isArray(keys) ? keys.join(",") : keys;
    const qs = new URLSearchParams();
    if (keysParam) qs.set("keys", keysParam);
    if (range && typeof range === "object") {
      if (range.startTs != null) qs.set("startTs", String(range.startTs));
      if (range.endTs != null) qs.set("endTs", String(range.endTs));
    } else if (range) {
      qs.set("last", range);
    }
    return psApiFetch(`/devices/${deviceId}/telemetry/history?${qs.toString()}`);
  }

  // Rentang absolut "hari ini" di zona WIT (Asia/Jayapura, UTC+9,
  // tanpa DST) dalam epoch ms UTC — dipakai sebagai pengganti
  // `last=24h` yang tidak didukung backend (lihat psFetchHistory di atas).
  function psTodayRangeWIT() {
    const nowWit = new Date(Date.now() + WIT_OFFSET_MS);
    const startOfDayWitMs = Date.UTC(nowWit.getUTCFullYear(), nowWit.getUTCMonth(), nowWit.getUTCDate());
    // Bulatkan endTs ke kelipatan 1 menit (Laporan Optimasi Telemetry API §5
    // poin 4) -- Date.now() mentah selalu beda di milidetik tiap kali fungsi
    // ini dipanggil, jadi endTs-nya nyaris tidak pernah sama persis dengan
    // request sebelumnya -> cache miss permanen di backend walau rentang
    // waktunya secara efektif sama.
    return {
      startTs: startOfDayWitMs - WIT_OFFSET_MS,
      endTs: Math.floor(Date.now() / 60000) * 60000
    };
  }

  // Kandidat nama register mentah untuk /telemetry/history, per Kamus
  // Data §7 di PDF (register-nya BEDA per provider, tidak seperti
  // /telemetry/latest yang sudah dinormalisasi Rev3):
  //   overview.currentPower -> Solarman: "T_AC_OP"/"ActivePower", 360Energy: "ActivePower"
  //   overview.energyToday  -> Solarman: "Etdy_ge1",              360Energy: "E-Daily"
  // Semua kandidat dikirim sekaligus (comma-separated) supaya cocok
  // untuk device provider manapun tanpa perlu cabang logic per provider.
  // FIX (kesesuaian kontrak Rev3, Laporan Optimasi Telemetry API §1, §3 &
  // §4): sebelumnya di sini dikirim nama register MENTAH provider-spesifik
  // ("ActivePower"/"T_AC_OP", "Etdy_ge1"/"E-Daily") sebagai `keys=`. Itu
  // tidak sesuai kontrak Rev3 -- backend sudah punya Lean
  // Normalized-to-Raw Key Resolver yang menerima nama variabel LOGIS
  // dot-notation ("overview.currentPower", "overview.energyToday") dan
  // menerjemahkannya sendiri ke register mentah tiap provider (lihat
  // tabel "Daftar Lengkap Variabel Rev3"). Cukup 1 key per metrik, tidak
  // perlu lagi daftar kandidat per-provider.
  const PS_POWER_HISTORY_KEYS = ["overview.currentPower"];
  const PS_ENERGY_DAILY_HISTORY_KEYS = ["overview.energyToday"];

  // Bentuk respons /telemetry/history dikonfirmasi (lihat FIX serupa di
  // js/dashboard.js poParseHistoryPoints, sesuai kontrak Rev3 §3 & §4):
  // BUKAN objek datar { [key]: [...] }, melainkan dikelompokkan per
  // KATEGORI dulu di dalam field "telemetry" -- mis.
  // raw.telemetry.overview.energyToday, raw.telemetry.battery.voltage.
  // `keyCandidates` boleh 1 key dot-notation (string) atau beberapa
  // (array) — dipakai key pertama yang beneran ada datanya di response.
  function psExtractHistoryPoints(historyResponse, keyCandidates) {
    if (!historyResponse) return null;
    const keys = Array.isArray(keyCandidates) ? keyCandidates : [keyCandidates];
    for (const key of keys) {
      if (historyResponse.telemetry && typeof historyResponse.telemetry === "object") {
        const nested = key
          .split(".")
          .reduce((obj, part) => (obj && typeof obj === "object" ? obj[part] : undefined), historyResponse.telemetry);
        if (Array.isArray(nested) && nested.length) return nested;
      }
      const direct = historyResponse[key];
      if (Array.isArray(direct) && direct.length) return direct;
      const raw = historyResponse.raw && historyResponse.raw[key];
      if (Array.isArray(raw) && raw.length) return raw;
    }
    return null;
  }

  // Gabung histori daya (semua device dalam 1 proyek), dibucket per jam
  // lokal WIT, dirata-rata per jam lalu dijumlah antar device -> kW.
  function psBucketHourlyPowerKw(histories, hoursCount) {

    const sumW = new Array(hoursCount).fill(0);
    const countW = new Array(hoursCount).fill(0);
    let any = false;

    histories.forEach((h) => {
      const points = psExtractHistoryPoints(h, PS_POWER_HISTORY_KEYS);
      if (!points) return;
      any = true;
      points.forEach((pt) => {
        const ts = Number(pt.ts);
        const val = Number(pt.value);
        if (!isFinite(ts) || !isFinite(val)) return;
        const localHour = new Date(ts + WIT_OFFSET_MS).getUTCHours();
        sumW[localHour] += val;
        countW[localHour] += 1;
      });
    });

    if (!any) return null;

    return sumW.map((total, i) => countW[i] ? +((total / countW[i]) / 1000).toFixed(3) : 0);

  }

  // Gabung histori energi harian (register reset tiap hari) dari semua
  // device dalam 1 proyek -> nilai MAX per tanggal lokal WIT = energi
  // hari itu, dijumlah antar device. Sama logikanya dengan yang sudah
  // dipakai etl_scripts/ untuk membangun tawabi-energy-production.json.
  function psBucketDailyMaxKwh(histories) {

    const byDate = {}; // "YYYY-MM-DD" -> { [deviceIdx]: maxValue }

    histories.forEach((h, idx) => {
      const points = psExtractHistoryPoints(h, PS_ENERGY_DAILY_HISTORY_KEYS);
      if (!points) return;
      points.forEach((pt) => {
        const ts = Number(pt.ts);
        const val = Number(pt.value);
        if (!isFinite(ts) || !isFinite(val)) return;
        const dateKey = new Date(ts + WIT_OFFSET_MS).toISOString().slice(0, 10);
        if (!byDate[dateKey]) byDate[dateKey] = {};
        byDate[dateKey][idx] = Math.max(byDate[dateKey][idx] || 0, val);
      });
    });

    return Object.keys(byDate).sort().map((date) => ({
      date,
      actualKwh: +Object.values(byDate[date]).reduce((s, v) => s + v, 0).toFixed(2)
    }));

  }

  // Generik untuk SEMUA proyek (bukan cuma Tawabi lagi): device-nya
  // di-discover beda cara tergantung proyeknya (Tawabi pakai
  // by-provider=Solarman + filter nama, proyek lain pakai GET
  // /projects/:id), tapi begitu dapat device ID, sisanya (telemetry
  // latest + history, bucketing) 100% sama & provider-agnostic.
  async function psBuildLiveDataForProject(project) {

    const devices = project.id === "tawabi"
      ? await psDiscoverTawabiDevices()
      : await psDiscoverProjectDevices(project);

    if (!devices.length) {
      throw new Error(`Device untuk proyek "${project.name}" belum ditemukan/terdaftar di ThingsBoard.`);
    }

    // --- 1) Snapshot terkini (well-documented, PDF §4.3 — sudah
    // dinormalisasi Rev3, jadi provider-agnostic, tidak perlu tahu
    // Solarman/360Energy/Huawei). ---
    const latests = await Promise.all(devices.map((d) =>
      psFetchLatest(d.id).catch((e) => {
        console.warn(`[project-selector] telemetry/latest gagal untuk ${d.name}:`, e.message);
        return null;
      })
    ));
    const validLatests = latests.filter(Boolean);
    if (!validLatests.length) {
      throw new Error(`telemetry/latest gagal untuk semua device proyek "${project.name}".`);
    }

    const sumField = (path) => validLatests.reduce((s, l) => s + (Number(psGetPath(l, path)) || 0), 0);
    const currentPowerKw = sumField("overview.currentPower") / 1000;
    const energyTodayKwh = sumField("overview.energyToday");

    // --- 2) Kurva 24 jam, dari API real (§4.5) kalau tersedia. Kalau
    // history-nya gagal/kosong (banyak device belum punya time-series
    // tersimpan di ThingsBoard, atau endpoint /history belum konsisten
    // sama dokumentasi), JANGAN dibiarkan null total -- itu yang
    // sebelumnya bikin garis "Realized" di card Today & chart Power
    // Output (tab 24 Hours) kosong sama sekali walau totalnya (dari
    // /telemetry/latest, energyTodayKwh) sudah benar. Sebagai gantinya,
    // sebar `energyTodayKwh` yang SUDAH REAL itu ke bentuk kurva harian
    // (pola bell-curve 06:00-18:00 yang sama dipakai psRenderPlaceholderCharts)
    // supaya chart selalu ada isinya dan tetap konsisten sama angka MWh
    // yang ditampilkan -- bukan angka rekaan baru, cuma "disebar" ke
    // 24 slot jam dari total yang memang sudah didapat live.
    const labels24 = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
    let hourlyPowerKw = null;
    let hourlyIsEstimated = false;
    try {
      // FIX: "24h" bukan nilai `last` yang valid (lihat catatan di
      // psFetchHistory) — pakai rentang absolut hari ini (WIT) supaya
      // request ini benar-benar berhasil dan garis "Realized"/Power
      // Output 24 Hours bisa terisi data live.
      const histories24 = await psRunInBatches(devices, PS_HISTORY_BATCH_SIZE, (d) => psFetchHistory(d.id, PS_POWER_HISTORY_KEYS, psTodayRangeWIT()));
      hourlyPowerKw = psBucketHourlyPowerKw(histories24, 24);
    } catch (e) {
      console.warn("[project-selector] telemetry/history (24h) gagal:", e.message);
    }
    if (!hourlyPowerKw) {
      hourlyPowerKw = psSyntheticHourlyKwh(energyTodayKwh);
      hourlyIsEstimated = true;
    }

    // --- 3) 7 hari terakhir, HANYA dari API real (§4.5) — sama kayak
    // di atas, TIDAK ada fallback fabrikasi. daily7 tetap [] kalau
    // history-nya gagal/kosong.
    let daily7 = [];
    try {
      const histories7 = await psRunInBatches(devices, PS_HISTORY_BATCH_SIZE, (d) => psFetchHistory(d.id, PS_ENERGY_DAILY_HISTORY_KEYS, "7d"));
      daily7 = psBucketDailyMaxKwh(histories7);
    } catch (e) {
      console.warn("[project-selector] telemetry/history (7d) gagal:", e.message);
    }

    return {
      source: "live",
      hourlyPowerKw,
      hourlyIsEstimated,
      labels24,
      todayLabels: labels24,
      todayActualKwh: hourlyPowerKw,
      todayExpectedKwh: null,
      totalActualKwh: energyTodayKwh,
      dailyTargetKwh: null, // diisi dari projects.json oleh psGetLiveDataForProject()
      daily7,
      currentPowerKw
    };

  }

      // FIX (hapus fallback data dummy): psBuildTawabiDataFromJsonFallback()
  // (server/data/tawabi-telemetry.json + tawabi-energy-production.json)
  // sudah DIHAPUS. Kalau psBuildLiveDataForProject() di bawah gagal, tidak
  // ada lagi jatuh ke data JSON statis -- penarikan data kini murni
  // sesuai kontrak Rev3 (live dari Core API) untuk semua proyek termasuk
  // Tawabi.

  // Generik untuk SEMUA proyek — cache per project.id (Map). Proyek yang
  // live API-nya gagal langsung dilempar ke psRenderPlaceholderCharts oleh
  // psLoadChartsForProject() (chart placeholder/flat, bukan JSON dummy).
  async function psGetLiveDataForProject(project, forceRefresh) {

    if (psLiveDataCache.has(project.id) && !forceRefresh) return psLiveDataCache.get(project.id);
    if (psLivePromiseCache.has(project.id) && !forceRefresh) return psLivePromiseCache.get(project.id);

    const promise = (async () => {

      let result = null;

      try {
        result = await psBuildLiveDataForProject(project);
        console.info(`[project-selector] Data proyek "${project.name}" diambil LIVE dari backend (360edashboard.com).`);
      } catch (e) {
        console.warn(`[project-selector] API live gagal untuk "${project.name}":`, e.message);
      }

      if (!result) throw new Error(`Tidak ada data live untuk proyek "${project.name}".`);

      // Target harian (kapasitas terpasang) tetap ambil dari
      // server/data/projects.json / GET /projects/:id/analytics supaya
      // konsisten dgn kartu lain, walau kurvanya berhasil live.
      if (result.dailyTargetKwh == null) {
        const proj = psProjects.find((p) => p.id === project.id);
        result.dailyTargetKwh = ((proj && proj.dailyTargetMWh) || 0) * 1000;
      }

      psLiveDataCache.set(project.id, result);
      return result;

    })();

    psLivePromiseCache.set(project.id, promise);
    promise.catch(() => psLivePromiseCache.delete(project.id)); // biar percobaan gagal tidak nyangkut, next call retry fresh
    return promise;

  }

  // Diekspos supaya halaman lain (mis. js/project-detail.js) bisa pakai
  // kurva Today/Power live yang sama tanpa fetch ulang -- BUKAN lagi
  // dipakai untuk menentukan status Online/Offline (Dashboard & Project
  // Selector sekarang sama-sama membaca status deterministik langsung dari
  // GET /devices/:id/telemetry/latest, lihat psRefreshLiveStatuses() di
  // atas dan poRefreshLiveStatuses() di js/dashboard.js). psLiveDataCache
  // di atas ikut ke-share otomatis (key-nya project.id) -- proyek yang
  // datanya sudah pernah diambil di satu halaman tidak fetch ulang dari
  // halaman lain.
  window.__psGetLiveDataForProject = psGetLiveDataForProject;

      // ===========================================================
  // Chart engine — SVG polylines/bars sederhana (tanpa Chart.js),
  // sesuai konvensi css/project-selector.css (".ps-*-chart-wrap svg").
  // ===========================================================

  function psCumulative(arr) {
    let sum = 0;
    return (arr || []).map((v) => { sum += (Number(v) || 0); return sum; });
  }

  function psLinePoints(values, w, h, pad) {
    const max = Math.max(...values, 1);
    const stepX = values.length > 1 ? (w - 2 * pad) / (values.length - 1) : 0;
    return values.map((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - (v / max) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }

  // ===========================================================
  // Axis helper — dipakai bareng oleh Today chart & Power Output
  // chart supaya kedua grafik punya label sumbu X/Y yang konsisten
  // (sebelumnya cuma polyline/bar polos tanpa keterangan skala).
  // ===========================================================

  // Bikin "nice" tick buat sumbu Y (0, tengah, max) dari suatu nilai
  // maksimum mentah -- dibulatkan ke angka yang enak dibaca.
  function psNiceYTicks(rawMax) {
    const max = Math.max(rawMax, 0.0001);
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    const normalized = max / magnitude;
    let niceMax;
    if (normalized <= 1) niceMax = 1 * magnitude;
    else if (normalized <= 2) niceMax = 2 * magnitude;
    else if (normalized <= 5) niceMax = 5 * magnitude;
    else niceMax = 10 * magnitude;
    return [0, niceMax / 2, niceMax];
  }

  function psFmtAxisNum(v) {
    if (v >= 100) return Math.round(v).toString();
    if (v >= 10) return v.toFixed(1).replace(/\.0$/, "");
    return v.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
  }

  // Pilih subset label sumbu-X supaya tidak numpuk (maks ~6 label).
  function psPickXTickIndices(n, maxTicks) {
    if (n <= 1) return [0];
    const count = Math.min(maxTicks, n);
    const step = (n - 1) / (count - 1);
    const idxs = new Set();
    for (let i = 0; i < count; i++) idxs.add(Math.round(i * step));
    return Array.from(idxs).sort((a, b) => a - b);
  }

  // Render sumbu X (label bawah) + sumbu Y (label kiri + gridline)
  // sebagai elemen SVG tambahan. `plotX0/plotX1/plotY0/plotY1` adalah
  // batas area plot (dalam koordinat viewBox), `yTicks` nilai asli
  // (bukan posisi piksel), `yUnit` teks satuan buat label sumbu Y
  // (ditulis di SETIAP tick, bukan cuma yang paling atas, samakan
  // dengan gaya chart "Today" di js/dashboard.js / Image referensi).
  // Label tepi (index pertama/terakhir) pakai text-anchor start/end
  // supaya tidak kepotong svg (default overflow:hidden) -- sebelumnya
  // SEMUA label pakai text-anchor="middle" jadi label terakhir ("23:00"
  // dst) separuh tulisannya lewat dari viewBox dan kepotong.
  function psAxisSvg({ plotX0, plotX1, plotY0, plotY1, yTicks, yUnit, xLabels, xIndices }) {
    const yMax = yTicks[yTicks.length - 1] || 1;
    const yLines = yTicks.map((t) => {
      const y = plotY1 - (t / yMax) * (plotY1 - plotY0);
      return `
        <line x1="${plotX0}" y1="${y.toFixed(1)}" x2="${plotX1}" y2="${y.toFixed(1)}" stroke="#eef2f2" stroke-width="1" />
        <text x="${(plotX0 - 5).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" class="ps-axis-label">${psFmtAxisNum(t)}${yUnit ? ` ${yUnit}` : ""}</text>
      `;
    }).join("");

    const n = xLabels.length;
    const stepX = n > 1 ? (plotX1 - plotX0) / (n - 1) : 0;
    const lastIdx = xIndices[xIndices.length - 1];
    const xTicks = xIndices.map((i) => {
      const x = plotX0 + i * stepX;
      const anchor = i === 0 ? "start" : (i === lastIdx ? "end" : "middle");
      return `<text x="${x.toFixed(1)}" y="${(plotY1 + 13).toFixed(1)}" text-anchor="${anchor}" class="ps-axis-label">${xLabels[i]}</text>`;
    }).join("");

    return `${yLines}${xTicks}`;
  }

  // Dual-line chart (Projected/dashed orange vs Realized/solid teal),
  // dipakai untuk panel "Today".
  function psRenderTodayChart(labels, actualArr, expectedArr, totalActualKwh, dailyTargetKwh) {

    const wrap = document.getElementById("psTodayChartWrap");
    if (!wrap) return;

    const cumActual = psCumulative(actualArr);
    const cumExpected = (expectedArr && expectedArr.length)
      ? psCumulative(expectedArr)
      : labels.map((_, i) => (dailyTargetKwh / labels.length) * (i + 1));

    // PAD_L dinaikkan lagi (46 -> 58): label sumbu-Y sekarang selalu
    // pakai satuan "MWh" di SETIAP tick (bukan cuma yang teratas) plus
    // font lebih besar (10px), jadi teksnya makin panjang ("0.25 MWh")
    // -- kalau PAD_L kurang, ujung kiri teks (anchor="end") jadi minus
    // dan kepotong tepi kiri svg (viewBox mulai dari x=0), persis yang
    // kelihatan di screenshot ("0.5 MWh" jadi ".5 MWh").
    const W = 380, H = 128;
    const PAD_L = 58, PAD_R = 24, PAD_T = 10, PAD_B = 20;
    const plotX0 = PAD_L, plotX1 = W - PAD_R, plotY0 = PAD_T, plotY1 = H - PAD_B;

    const rawMax = Math.max(...cumActual, ...cumExpected, 1);
    const yTicks = psNiceYTicks(rawMax / 1000); // ticks dalam MWh
    const yMaxKwh = yTicks[yTicks.length - 1] * 1000;

    const toPts = (arr) => arr.map((v, i) => {
      const stepX = arr.length > 1 ? (plotX1 - plotX0) / (arr.length - 1) : 0;
      const x = plotX0 + i * stepX;
      const y = plotY1 - (v / yMaxKwh) * (plotY1 - plotY0);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

    // Sumbu X: jam WIT tiap titik (label sudah "HH:00" dari labels24).
    const xIndices = psPickXTickIndices(labels.length, 6);
    const axis = psAxisSvg({ plotX0, plotX1, plotY0, plotY1, yTicks, yUnit: "MWh", xLabels: labels, xIndices });

    wrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Today generation, X axis time of day, Y axis energy in MWh">
        ${axis}
        <polyline points="${toPts(cumExpected)}" fill="none" stroke="#FA891A" stroke-width="2" stroke-dasharray="4 3" />
        <polyline points="${toPts(cumActual)}" fill="none" stroke="#0f6a71" stroke-width="2.5" />
      </svg>
    `;

    const valMWh = totalActualKwh / 1000;
    const targetMWh = dailyTargetKwh / 1000;
    const pct = targetMWh > 0 ? Math.round((valMWh / targetMWh) * 100) : 0;

    const valEl = document.getElementById("psTodayValue");
    if (valEl) valEl.innerHTML = `${fmtNum(valMWh, valMWh < 10 ? 2 : 1)}<span>MWh</span>`;

    const targetEl = document.getElementById("psTodayTarget");
    if (targetEl) targetEl.innerHTML = targetMWh > 0
      ? `Target <strong>${fmtNum(targetMWh, 2)} MWh</strong> (${pct}%)`
      : "";

  }

  // Single-line/area chart (teal), dipakai untuk panel "Power Output".
  // Label tanggal 7 hari terakhir (YYYY-MM-DD dipangkas ke MM-DD),
  // dipakai buat sumbu-X tab 7 Days — baik untuk Tawabi (real data)
  // maupun project lain (placeholder), biar konsisten.
  function psLast7DayLabels() {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() + WIT_OFFSET_MS - (6 - i) * 86400000);
      return d.toISOString().slice(5, 10);
    });
  }

  // Satu-satunya jalur render buat chart Power Output: dipakai SAMA
  // PERSIS oleh Tawabi (data real) dan semua project lain (placeholder),
  // baik tab 24h maupun 7d. Kalau values kosong/gagal/null, diganti
  // array 0 sepanjang labels — tetap digambar sebagai line chart
  // (bukan teks "No data"), jadi hasilnya garis lurus rata di 0,
  // konsisten sama tampilan 24h yang sudah ada.
  function psRenderPowerLineOrFlat(labels, values, unit) {
    const safeValues = (values && values.length) ? values : labels.map(() => 0);
    psRenderPowerLineChart(labels, safeValues, unit);
  }

  function psRenderPowerLineChart(labels, values, unit) {

    const wrap = document.getElementById("psPowerChartWrap");
    if (!wrap) return;

    const W = 300, H = 166;
    const PAD_L = 40, PAD_R = 24, PAD_T = 10, PAD_B = 22;
    const plotX0 = PAD_L, plotX1 = W - PAD_R, plotY0 = PAD_T, plotY1 = H - PAD_B;
    const plotW = plotX1 - plotX0, plotH = plotY1 - plotY0;

    const rawMax = Math.max(...values, 1);
    const yTicks = psNiceYTicks(rawMax);
    const yMax = yTicks[yTicks.length - 1];

    const stepX = values.length > 1 ? plotW / (values.length - 1) : 0;
    const points = values.map((v, i) => {
      const x = plotX0 + i * stepX;
      const y = plotY1 - (v / yMax) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const areaPoints = `${plotX0},${plotY1} ${points} ${plotX1},${plotY1}`;

    // Sumbu X: "24 Hours" pakai label HH:00 tiap 4 jam, "7 Days" pakai
    // tanggal per titik (sedikit, jadi tampilkan semua).
    const maxXTicks = values.length > 12 ? 6 : values.length;
    const xIndices = psPickXTickIndices(labels.length, maxXTicks);
    const axis = psAxisSvg({ plotX0, plotX1, plotY0, plotY1, yTicks, yUnit: unit || "", xLabels: labels, xIndices });

    wrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Power output chart, X axis time, Y axis power in ${unit || ""}">
        ${axis}
        <polygon points="${areaPoints}" fill="rgba(15,106,113,0.12)" stroke="none" />
        <polyline points="${points}" fill="none" stroke="#0f6a71" stroke-width="2.5" />
      </svg>
    `;

  }

  function psRenderPowerBarChart(labels, values, unit) {

    const wrap = document.getElementById("psPowerChartWrap");
    if (!wrap) return;

    const W = 300, H = 166;
    const PAD_L = 40, PAD_R = 24, PAD_T = 10, PAD_B = 22;
    const plotX0 = PAD_L, plotX1 = W - PAD_R, plotY0 = PAD_T, plotY1 = H - PAD_B;
    const plotW = plotX1 - plotX0, plotH = plotY1 - plotY0;

    const rawMax = Math.max(...values, 1);
    const yTicks = psNiceYTicks(rawMax);
    const yMax = yTicks[yTicks.length - 1];

    const n = values.length || 1;
    const gap = 6;
    const barW = (plotW - gap * (n - 1)) / n;

    const bars = values.map((v, i) => {
      const barH = (v / yMax) * plotH;
      const x = plotX0 + i * (barW + gap);
      const y = plotY1 - barH;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="3" fill="#0f6a71" />`;
    }).join("");

    // Sumbu X: satu label per bar (dipakai buat tab "7 Days", jumlah
    // titik sedikit jadi semua label muat tanpa numpuk). Label tepi
    // (pertama/terakhir) di-anchor start/end biar tidak kepotong svg,
    // sama seperti psAxisSvg() di atas.
    const xTicksSvg = labels.map((l, i) => {
      const x = plotX0 + i * (barW + gap) + barW / 2;
      const anchor = i === 0 ? "start" : (i === labels.length - 1 ? "end" : "middle");
      return `<text x="${x.toFixed(1)}" y="${(plotY1 + 13).toFixed(1)}" text-anchor="${anchor}" class="ps-axis-label">${l}</text>`;
    }).join("");
    const yLines = yTicks.map((t) => {
      const y = plotY1 - (t / yMax) * plotH;
      return `
        <line x1="${plotX0}" y1="${y.toFixed(1)}" x2="${plotX1}" y2="${y.toFixed(1)}" stroke="#eef2f2" stroke-width="1" />
        <text x="${(plotX0 - 5).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" class="ps-axis-label">${psFmtAxisNum(t)}${unit ? ` ${unit}` : ""}</text>
      `;
    }).join("");

    wrap.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Power output by day, X axis date, Y axis energy in ${unit || ""}">
        ${yLines}
        ${bars}
        ${xTicksSvg}
      </svg>
    `;

  }

  // Kurva perkiraan sederhana (06:00-18:00 bell-shape) untuk proyek
  // yang belum punya data logger real — sama seperti konvensi dummy
  // yang sudah dipakai di js/project-detail.js untuk proyek non-tawabi.
  function psSyntheticHourlyKwh(totalKwh) {
    const weights = [0, 0, 0, 0, 0, 0, 0.02, 0.05, 0.09, 0.13, 0.15, 0.15, 0.13, 0.09, 0.06, 0.04, 0.02, 0.01, 0.005, 0, 0, 0, 0, 0];
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;
    return weights.map((w) => totalKwh > 0 ? +(totalKwh * w / sumW).toFixed(3) : 0);
  }

  function psSetDetailOutput(totalKwh, targetKwh) {

    const outEl = document.getElementById("psDetailOutput");
    const targetEl = document.getElementById("psDetailTarget");

    if (outEl) outEl.innerHTML = `${fmtNum(totalKwh, 0)}<span>kWh</span>`;

    if (targetEl) {
      const pct = targetKwh > 0 ? Math.round((totalKwh / targetKwh) * 100) : 0;
      targetEl.innerHTML = targetKwh > 0
        ? `Target <strong>${fmtNum(targetKwh, 0)} kWh</strong> (${pct}%)`
        : "";
    }

  }

  // Sekarang dicoba untuk SEMUA proyek (bukan cuma Tawabi lagi) —
  // psGetLiveDataForProject() sendiri yang tahu cara discover device
  // per proyek (lihat psBuildLiveDataForProject). Kalau gagal (device
  // belum terdaftar di ThingsBoard, backend down, dst), jatuh ke
  // placeholder sintetis/flat seperti sebelumnya.
  // FIX (2026-09-08): card "Today" versi DEFAULT (sebelum user membuka
  // proyek manapun, mode bukan-detail) sebelumnya diam-diam memuat data
  // REAL satu proyek "featured" saja (Tawabi, atau proyek pertama yang
  // "saved") lewat psSelectProject(..., {enterDetail:false}) di
  // initProjectSelector() -- jadi nilai MWh/target yang tampil di layar
  // awal itu punya SATU proyek tertentu, bukan akumulasi semua proyek.
  // Sesuai spesifikasi: default = KESELURUHAN (semua proyek digabung,
  // sama seperti angka "Today's Generation" di panel kiri /
  // psRenderGenerationStats()), baru saat user MASUK MODE DETAIL (klik
  // salah satu proyek) card ini ganti jadi data REAL milik proyek itu
  // sendiri (tetap lewat psLoadChartsForProject() seperti sebelumnya,
  // tidak berubah).
  function psRenderAggregateTodayChart() {

    // FIX (2026-09-08): fallback SEBELUMNYA di sini pakai `Number(p.capacityMWp) * 5`
    // (angka 5 asal-asalan) kalau `p.dailyTargetMWh` falsy -- padahal
    // `p.dailyTargetMWh` (lihat psBuildProjectFromApi di atas) SUDAH
    // dihitung benar untuk SETIAP proyek pakai constant yang SAMA PERSIS
    // dengan Dashboard (PS_TARGET_INTENSITY_MWH_PER_MWP = 65, identik
    // dengan PO_TARGET_INTENSITY_MWH_PER_MWP di js/dashboard.js). Fallback
    // "*5" itu cuma bikin total target di Project Selector ikut menyimpang
    // dari total di Dashboard (yang menjumlah p.targetMWh apa adanya, lihat
    // poRenderMapStat()) tanpa alasan jelas -- dihapus, langsung jumlahkan
    // p.dailyTargetMWh yang sudah konsisten itu, SAMA seperti Dashboard.
    const totalActualKwh = psProjects.reduce((s, p) => s + (Number(p.generatedMWh) || 0), 0) * 1000;
    const totalTargetKwh = psProjects.reduce((s, p) => {
      const target = typeof p.dailyTargetMWh === "number" ? p.dailyTargetMWh : 0;
      return s + target;
    }, 0) * 1000;

    const labels24 = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
    const hourly = psSyntheticHourlyKwh(totalActualKwh);

    psRenderTodayChart(labels24, hourly, null, totalActualKwh, totalTargetKwh);

  }

  async function psLoadChartsForProject(p) {

    try {
      const data = await psGetLiveDataForProject(p);
      psRenderTodayChart(data.todayLabels, data.todayActualKwh, data.todayExpectedKwh, data.totalActualKwh, data.dailyTargetKwh);
      psSetDetailOutput(data.totalActualKwh, data.dailyTargetKwh);
      psRenderPowerForRange(p, data);
    } catch (e) {
      console.warn(`[project-selector] Gagal memuat data real utk "${p.name}":`, e.message);
      psRenderPlaceholderCharts(p);
    }

  }

  function psRenderPowerForRange(p, liveData) {

    if (liveData) {
      if (psPowerRange === "24h") {
        psRenderPowerLineOrFlat(liveData.labels24, liveData.hourlyPowerKw, "kW");
      } else {
        const daily = liveData.daily7;
        psRenderPowerLineOrFlat(
          daily.length ? daily.map((d) => d.date.slice(5)) : psLast7DayLabels(),
          daily.length ? daily.map((d) => d.actualKwh) : [],
          "kWh"
        );
      }
      return;
    }

    psRenderPlaceholderPower(p);

  }

  function psRenderPlaceholderCharts(p) {

    // FIX (2026-09-08): sama seperti di psRenderAggregateTodayChart() --
    // p.dailyTargetMWh sudah dihitung pakai PS_TARGET_INTENSITY_MWH_PER_MWP
    // (65), jadi fallback "* 5" di sini juga cuma bikin card ini bisa
    // menyimpang dari Dashboard tanpa alasan (dan cuma kepakai kalau
    // dailyTargetMWh persis 0). Dihapus, pakai dailyTargetMWh apa adanya.
    const totalKwh = (Number(p.generatedMWh) || 0) * 1000;
    const targetKwh = (typeof p.dailyTargetMWh === "number" ? p.dailyTargetMWh : 0) * 1000;
    const hourly = psSyntheticHourlyKwh(totalKwh);
    const labels24 = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

    psRenderTodayChart(labels24, hourly, null, totalKwh, targetKwh);
    psSetDetailOutput(totalKwh, targetKwh);
    psRenderPlaceholderPower(p);

  }

  function psRenderPlaceholderPower(p) {

    const totalKwh = (Number(p.generatedMWh) || 0) * 1000;
    const labels24 = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

    if (psPowerRange === "24h") {
      psRenderPowerLineOrFlat(labels24, psSyntheticHourlyKwh(totalKwh), "kW");
    } else {
      // Project ini belum punya sumber history 7 hari (bukan Tawabi) —
      // SAMA kayak Tawabi kalau history-nya kosong: garis lurus rata di
      // 0, bukan teks "No data" lagi.
      psRenderPowerLineOrFlat(psLast7DayLabels(), [], "kWh");
    }

  }

  // ===========================================================
  // Binding UI (locate button, detail close, power toggle/refresh,
  // panel/history collapsible, search)
  // ===========================================================

  function psBindUI() {

    const showAllToggle = document.getElementById("psShowAllCategories");
    if (showAllToggle) {
      showAllToggle.checked = psShowAllCategories;
      showAllToggle.addEventListener("change", () => {
        psShowAllCategories = showAllToggle.checked;
        psRenderCategoryLegend();
      });
    }

    const locateBtn = document.getElementById("psLocateBtn");
    if (locateBtn) {
      locateBtn.addEventListener("click", psHandleLocate);
    }

    const detailClose = document.getElementById("psDetailClose");
    if (detailClose) {
      detailClose.addEventListener("click", () => {
        document.querySelector(".ps-page")?.classList.remove("is-detail");
        document.getElementById("psTodayFloat")?.classList.remove("is-detail");
        psActiveId = null;
        // Balik ke card "Today" versi akumulasi semua proyek begitu
        // keluar dari mode detail (lihat psRenderAggregateTodayChart()).
        psRenderAggregateTodayChart();
        if (psMap) {
          psCloseAllPopups();
          const coords = psProjects
            .filter((p) => p.lat != null && p.lng != null)
            .map((p) => [p.lng, p.lat]);
          if (coords.length > 1) {
            const bounds = coords.reduce(
              (b, c) => b.extend(c),
              new maplibregl.LngLatBounds(coords[0], coords[0])
            );
            psMap.fitBounds(bounds, {
              padding: { top: 60, bottom: 60, left: 60, right: 470 },
              maxZoom: PS_INITIAL_ZOOM + 2,
              duration: 900
            });
          } else {
            psMap.flyTo({ center: [PS_INITIAL_CENTER[1], PS_INITIAL_CENTER[0]], zoom: PS_INITIAL_ZOOM, duration: 900 });
          }
          psMap.once("moveend", () => psSetTileLayer("streets"));
        }
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.querySelector(".ps-page.is-detail")) {
        detailClose && detailClose.click();
      }
    });

    const techBtn = document.getElementById("psDetailTechBtn");
    if (techBtn) {
      techBtn.addEventListener("click", () => {
        const p = psProjects.find((x) => x.id === psActiveId);
        if (!p) return;
        if (typeof window.PC_setActiveProject === "function") {
          window.PC_setActiveProject({ id: p.id, name: p.name, category: p.category });
        }
        if (typeof window.loadPage === "function") {
          window.loadPage("pages/project-monitoring.html");
        }
      });
    }

    document.querySelectorAll(".ps-power-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        psPowerRange = btn.getAttribute("data-range") || "24h";
        document.querySelectorAll(".ps-power-toggle-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
        const p = psProjects.find((x) => x.id === psActiveId);
        if (p) psLoadChartsForProject(p);
      });
    });

    const refreshBtn = document.getElementById("psPowerRefresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.classList.add("is-loading");
        const p = psProjects.find((x) => x.id === psActiveId);
        if (p) {
          // Refresh proyek yang lagi dibuka aja (bukan selalu Tawabi) —
          // buang cache device + data live-nya biar psLoadChartsForProject
          // di bawah beneran re-fetch dari API, bukan kepakai cache lama.
          psDeviceCache.delete(p.id);
          psLiveDataCache.delete(p.id);
          psLivePromiseCache.delete(p.id);
          await psLoadChartsForProject(p);
        }
        refreshBtn.classList.remove("is-loading");
      });
    }

    const panelToggle = document.getElementById("psPanelToggle");
    const panel = document.getElementById("psPanel");
    if (panelToggle && panel) {
      panelToggle.addEventListener("click", () => panel.classList.toggle("is-open"));
    }

    const historyToggle = document.getElementById("psHistoryToggle");
    const historyPanel = document.getElementById("psHistoryPanel");
    if (historyToggle && historyPanel) {
      historyToggle.addEventListener("click", () => historyPanel.classList.toggle("is-open"));
    }

    const searchInput = document.getElementById("psSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        psSearchTerm = searchInput.value || "";
        psRenderAllRows();
      });
    }

  }

  function psHandleLocate() {

    const btn = document.getElementById("psLocateBtn");
    if (!psMap || !navigator.geolocation) return;

    btn && btn.classList.add("is-loading");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn && btn.classList.remove("is-loading");
        psMap.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 11, duration: 800 });
      },
      () => {
        btn && btn.classList.remove("is-loading");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );

  }

})();