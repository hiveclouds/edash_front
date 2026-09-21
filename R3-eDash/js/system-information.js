/* ============================================================
   System Information — 360eDash
   Semua logic untuk halaman System Information: list system,
   wizard Add System, detail system (charts, edit, maintenance).
============================================================= */

(function () {

  // ---------------------------------------------------------
  // Persistence layer — backend server/server.js (endpoint
  // /api/systems), BUKAN localStorage.
  //
  // Seluruh array system (list + detail + maintenance + alarm
  // history) dibaca sekali via GET saat halaman ini dibuka, dan
  // ditulis balik SELURUHNYA via PUT setiap ada perubahan (Add System,
  // Edit, Delete, jadwal maintenance) — jadi semua device/user yang
  // menembak backend yang sama otomatis lihat data yang sama, dan
  // datanya tetap ada walau browser ditutup / storage browser dibersihkan.
  //
  // Backend harus jalan duluan: node server/server.js (lihat
  // server/README.md). Base URL diatur lewat window.EDASH_API_BASE
  // di js/api-config.js (default http://localhost:3001).
  //
  // Kalau backend tidak terjangkau (belum dijalankan, dsb), fetch GET
  // gagal dan halaman fallback ke seedSystems() (dummy) supaya UI
  // tetap bisa dipakai/dicoba — tapi perubahan yang dibuat saat itu
  // TIDAK akan tersimpan sampai backend hidup lagi (fetch PUT akan
  // gagal juga, error-nya cuma dicatat di console, tidak mengganggu UI).
  // ---------------------------------------------------------
  const SI_API_PATH = "/api/systems";

  function siApiBase() {
    return window.EDASH_API_BASE || "http://localhost:3001";
  }

  async function loadSystemsFromServer() {
    try {
      const res = await fetch(`${siApiBase()}${SI_API_PATH}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await res.json();
      return Array.isArray(parsed) && parsed.length ? parsed : null;
    } catch (e) {
      console.warn("[system-information] Gagal ambil data dari server, pakai data dummy sementara:", e.message);
      return null;
    }
  }

  // ---------------------------------------------------------
  // Maintenance entry IDs — setiap item futureMaintenance /
  // historicalMaintenance butuh "id" unik & stabil (BUKAN index
  // array) supaya bisa dirujuk dengan aman dari halaman lain
  // (Task Management, Task Maintenance) walau urutan/array-nya
  // berubah (ditambah/dihapus/diedit dari halaman manapun).
  // Dipakai bareng-bareng oleh system-information.js, task-management.js
  // dan task-maintenance.js lewat window.__siGenMaintId.
  // ---------------------------------------------------------
  function genMaintId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return "m-" + window.crypto.randomUUID();
    }
    return "m-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }
  window.__siGenMaintId = genMaintId;

  // Pastikan semua entry futureMaintenance/historicalMaintenance di
  // seluruh system punya "id". Dipanggil setiap kali data system
  // dimuat (seed maupun dari server) supaya data lama (systems.json
  // yang belum punya field id) otomatis "ditambal" tanpa perlu
  // migrasi manual.
  function ensureMaintenanceIds(systems) {
    (systems || []).forEach((sys) => {
      (sys.futureMaintenance || []).forEach((m) => { if (!m.id) m.id = genMaintId(); });
      (sys.historicalMaintenance || []).forEach((h) => { if (!h.id) h.id = genMaintId(); });
    });
    return systems;
  }
  window.__siEnsureMaintenanceIds = ensureMaintenanceIds;

  // ---------------------------------------------------------
  // REAL DATA — PLTS Tawabi, dari eDashboard Core API (bukan
  // dari server/server.js mini-backend di atas).
  //
  // ID di bawah ini DIAMBIL DARI CONTOH DI DOKUMENTASI PDF
  // (§4.3, §5.2, §6.1) yang konsisten menyebut "PLTS Kawasan
  // Tawabi Halmahera Selatan" berulang kali dengan UUID yang
  // SAMA di tiga section berbeda — dugaan kuat ini ID asli yang
  // di-seed di database VPS untuk testing, BUKAN placeholder
  // acak. Tapi ini tetap tebakan, makanya ada fallback pencarian
  // by nama kalau ID langsung ternyata 404.
  // ---------------------------------------------------------
  const TAWABI_PROJECT_ID = "b0000000-0000-0000-0000-000000000001";
  const TAWABI_SYSTEM_ID = "c0000000-0000-0000-0000-000000000001";
  const TAWABI_DEVICE_ID = "979153e0-97b3-11f1-8c86-25274e65e397";

  // ---------------------------------------------------------
  // REAL DATA — PLTS Kasdam (Kawasan Kasdam, Halmahera Selatan),
  // dari DOKUMENTASI_API_eDASHBOARD_360ENERGY_KASDAM.pdf (§4.1, §4.2).
  //
  // BEDA dengan Tawabi: PDF Kasdam TIDAK dipakai untuk menebak project
  // ID/system ID (angka "b0000000-...-0001" / "c0000000-...-0001" di
  // dokumentasi Kasdam ini PERSIS SAMA dengan tebakan TAWABI_PROJECT_ID/
  // TAWABI_SYSTEM_ID di atas -- kemungkinan besar itu cuma UUID contoh
  // generik yang dipakai berulang di template dokumentasi, BUKAN ID
  // asli yang unik per proyek). Jadi project Kasdam TETAP di-resolve
  // generik lewat findCoreApiProject(localProjectId) pakai UUID ASLI
  // dari GET /projects (localProjectId sudah = UUID asli, lihat
  // psBuildProjectFromApi() di project-selector.js), TIDAK ditebak.
  //
  // thingsboardDeviceId di bawah ini BEDA ceritanya -- itu bukan UUID
  // contoh generik, tapi Device ID + Access Token KONKRET per inverter
  // (SN F01257000587/588) yang disebut PERSIS SAMA di 2 section
  // berbeda PDF (§4.1 tabel registrasi & §4.2 contoh respons daftar
  // inverter) -- jadi dipakai sebagai FALLBACK TERAKHIR SAJA, hanya
  // kalau project Kasdam ketemu di Core API tapi response /projects/:id
  // ternyata tidak membawa systems/devices ternested sama sekali
  // (lihat pemakaiannya di loadSystemsForProject di bawah), supaya
  // halaman tidak kosong total sambil menunggu strukturnya dikonfirmasi
  // lewat console.log.
  const KASDAM_PROJECT_NAME_RE = /kasdam/i;
  const KASDAM_FALLBACK_DEVICES = [
    { id: "7ee849a0-9ad5-11f1-8c86-25274e65e397", name: "Inverter PLTS Kasdam 01", deviceSn: "F01257000587", systemLabel: "PLTS KASDAM GRUP 1" },
    { id: "abe8c180-9ad7-11f1-8c86-25274e65e397", name: "Inverter PLTS Kasdam 02", deviceSn: "F01257000588", systemLabel: "PLTS KASDAM GRUP 2" }
  ];

  async function findTawabiProject() {
    // Coba langsung dulu pakai ID dari dokumentasi.
    try {
      const project = await edashApiFetch(`/projects/${TAWABI_PROJECT_ID}`);
      console.log("[system-information] GET /projects/:id (Tawabi, direct ID) raw response:", project);
      return project;
    } catch (e) {
      console.warn("[system-information] ID Tawabi dari dokumentasi tidak ditemukan langsung, coba cari by nama:", e.message);
    }
    // Fallback: cari di daftar semua proyek berdasarkan nama.
    try {
      const list = await edashApiFetch("/projects");
      const found = (list || []).find((p) =>
        (p.project_name || p.projectName || p.name || "").toLowerCase().includes("tawabi")
      );
      if (!found) return null;
      const detail = await edashApiFetch(`/projects/${found.id}`);
      console.log("[system-information] GET /projects/:id (Tawabi, hasil pencarian nama) raw response:", detail);
      return detail;
    } catch (e) {
      console.warn("[system-information] Gagal mencari proyek Tawabi:", e.message);
      return null;
    }
  }

  // ---------------------------------------------------------
  // MULTI-PROYEK — generalisasi dari findTawabiProject() di atas.
  // ---------------------------------------------------------
  // Sebelumnya System Information (dan Task Management/Task Maintenance
  // yang numpang lewat window.__siSystems / __siEnsureSystemsLoaded)
  // HANYA PERNAH memuat proyek Tawabi, apapun proyek yang sedang aktif
  // dipilih di Project Selector / tab Project Overview. Sekarang setiap
  // proyek Core API (id chip-nya = UUID asli backend, mis. PLTS Kasdam)
  // dimuat & di-cache SENDIRI-SENDIRI, dan yang ditampilkan di kartu
  // selalu proyek yang SEDANG AKTIF (localProjectId) — bukan selalu
  // Tawabi lagi.
  //
  // "tawabi" tetap id khusus lokal (dipakai di seluruh halaman lain,
  // lihat project-detail.js/project-selector.js) yang di-resolve lewat
  // findTawabiProject() (ID hardcode + fallback cari nama). Proyek API
  // lain (Kasdam, dst) id lokalnya = UUID asli dari GET /projects,
  // cukup di-fetch langsung lewat GET /projects/:id.
  // ---------------------------------------------------------
  async function findCoreApiProject(localProjectId) {
    if (!localProjectId || localProjectId === "tawabi") return findTawabiProject();
    try {
      const project = await edashApiFetch(`/projects/${localProjectId}`);
      console.log(`[system-information] GET /projects/${localProjectId} raw response:`, project);
      return project;
    } catch (e) {
      console.warn(`[system-information] Gagal ambil /projects/${localProjectId}:`, e.message);
      return null;
    }
  }

  // Muat SEMUA unit sistem + inverter milik SATU proyek (id lokal apa
  // pun — "tawabi" atau UUID proyek API lain seperti Kasdam), lalu
  // tandai tiap kartu hasilnya dengan basic.projectId = localProjectId
  // supaya siProjectScopedSystems() bisa filter per proyek dengan
  // benar (sebelumnya field ini TIDAK PERNAH diisi sama sekali untuk
  // system yang datang dari Core API — makanya proyek selain Tawabi
  // selalu kosong/ketimpa data Tawabi).
  //
  // PENTING: untuk proyek SELAIN Tawabi, extractTawabiSystems()/
  // extractDevicesForSystem() TIDAK dipakai — keduanya fallback ke ID
  // system/device Tawabi kalau project.systems/devices kosong (aman
  // dulu karena cuma dipakai Tawabi). Kalau dipakai apa adanya untuk
  // proyek lain yang kebetulan belum lengkap system/inverter-nya, bisa
  // salah nampilin telemetry Tawabi di proyek yang salah.
  async function loadSystemsForProject(localProjectId) {
    try {
      const project = await findCoreApiProject(localProjectId);
      if (!project) {
        console.warn(`[system-information] Proyek "${localProjectId}" tidak ditemukan di Core API.`);
        return [];
      }

      const isTawabi = localProjectId === "tawabi";
      const projectName = project.project_name || project.projectName || project.name || "";
      const isKasdam = !isTawabi && KASDAM_PROJECT_NAME_RE.test(projectName);

      let systemsMeta = isTawabi ? extractTawabiSystems(project) : (project.systems || project.units || []);

      // Fallback KHUSUS Kasdam — lihat catatan KASDAM_FALLBACK_DEVICES
      // di atas. Kalau proyek Kasdam ketemu di Core API tapi
      // project.systems/units kosong (struktur nested belum/tidak
      // sesuai dugaan), tetap render 2 kartu (Grup 1 & 2) pakai
      // Device ID konkret dari dokumentasi PDF, bukan halaman kosong.
      if (isKasdam && !systemsMeta.length) {
        console.warn("[system-information] Proyek Kasdam tidak membawa systems/units ternested, pakai fallback KASDAM_FALLBACK_DEVICES dari dokumentasi PDF.");
        systemsMeta = KASDAM_FALLBACK_DEVICES.map((d) => ({ id: null, name: d.systemLabel, _kasdamDevice: d }));
      }

      const jobs = [];
      systemsMeta.forEach((system, i) => {
        const devices = isTawabi
          ? extractDevicesForSystem(project, system, i, systemsMeta.length)
          : (system && system._kasdamDevice
              ? [system._kasdamDevice]
              : ((system && (system.devices || system.inverters)) ||
                 (project.devices || project.inverters || []).filter((d) => (d.system_id || d.systemId) === system?.id)));
        devices.forEach((device) => {
          jobs.push(loadOneTawabiCard(project, system, device, i));
        });
      });

      const results = await Promise.all(jobs);
      results.forEach((s, i) => {
        s.basic = s.basic || {};
        s.basic.projectId = localProjectId;
        // ID kartu unik per proyek+unit (sebelumnya selalu diawali
        // "sys-tawabi-api-" apapun proyeknya -- bisa collide kalau
        // 2 proyek berbeda kebetulan punya system.id yang sama).
        s.id = `sys-api-${localProjectId}-${s.systemId || i}`;
      });
      return results;
    } catch (e) {
      console.warn(`[system-information] Gagal memuat systems untuk proyek "${localProjectId}":`, e.message);
      return [];
    }
  }

  // Diekspos supaya halaman lain (js/project-selector.js — kategori/warna
  // pin Project Locations, disamakan dgn Type System Information) bisa
  // pakai LOGIKA & SUMBER DATA YANG SAMA PERSIS (Core API real via
  // edashApiFetch, BUKAN mini-backend lokal server/server.js) buat
  // dapetin Type per proyek, tanpa duplikat kode traversal
  // systems/devices/Kasdam-fallback di atas. Dipanggil langsung
  // (BUKAN lewat window.__siEnsureActiveProjectSystemsLoaded, yang
  // cuma muat proyek yang SEDANG AKTIF) karena Project Selector perlu
  // Type semua proyek sekaligus buat mewarnai semua pin di peta, bukan
  // cuma satu proyek aktif.
  window.__siLoadSystemsForProject = loadSystemsForProject;

  // Bentuk nested "systems"/"devices" di dalam response detail
  // proyek TIDAK dicontohkan di dokumentasi (cuma disebut "detail
  // proyek lengkap beserta unit sistem dan inverter terpasang" di
  // §5.1) — jadi field accessor di bawah ini coba beberapa nama
  // kemungkinan (systems/units, devices/inverters). Cek console.log
  // di atas untuk tahu nama field yang benar, lalu sesuaikan di sini
  // kalau ternyata meleset.
  //
  // PENTING: PLTS Tawabi punya 2 unit (Grup 1 & Grup 2, masing-masing
  // 1 inverter) — jadi di sini kita ambil SEMUA unit yang ada di
  // response, bukan cuma yang cocok dengan TAWABI_SYSTEM_ID (yang
  // itu cuma contoh 1 ID dari dokumentasi, kemungkinan cuma punya
  // Grup 1). Kartu di halaman ini nanti dibuat 1 per unit.
  function extractTawabiSystems(project) {
    const systemsArr = project.systems || project.units || [];
    if (systemsArr.length) return systemsArr;
    // Fallback kalau response project ternyata tidak punya nested
    // systems sama sekali -> minimal masih render 1 kartu pakai ID
    // dari dokumentasi supaya halaman tidak kosong total.
    return [{ id: TAWABI_SYSTEM_ID }];
  }
  function extractDevicesForSystem(project, system, systemIndex, totalSystems) {
    const devicesArr = (system && (system.devices || system.inverters)) || [];
    if (devicesArr.length) return devicesArr;

    // Fallback 1: cari di daftar device level-proyek yang punya systemId
    // yang cocok, kalau strukturnya ternyata flat (bukan nested).
    const projectDevices = project.devices || project.inverters || [];
    const matched = projectDevices.filter((d) => (d.system_id || d.systemId) === system?.id);
    if (matched.length) return matched;

    // Fallback 2 (PENTING -- ini yang memperbaiki bug "4 kartu"):
    // kalau matching by systemId gagal total, JANGAN kembalikan
    // SEMUA device project ke SETIAP system (itu yang bikin device
    // yang sama kepasang dobel ke Grup 1 DAN Grup 2). Kalau jumlah
    // device project persis sama dengan jumlah system, pasangkan
    // berdasarkan URUTAN saja (system ke-i <-> device ke-i) --
    // asumsi wajar untuk kasus PLTS Tawabi (2 system, 2 device).
    if (projectDevices.length === totalSystems) {
      return projectDevices[systemIndex] ? [projectDevices[systemIndex]] : [];
    }

    // Fallback terakhir: kalau TIDAK bisa dipasangkan sama sekali
    // (jumlah tidak cocok), hanya berikan seluruh device ke system
    // PERTAMA saja supaya tidak ada duplikasi entah dari mana.
    if (systemIndex === 0) {
      return projectDevices.length ? projectDevices : [{ id: TAWABI_DEVICE_ID }];
    }
    return [];
  }

  // =============================
  // Real chart data — GET /devices/:id/telemetry/history?startTs=...&endTs=...
  // (rentang 24 jam terakhir, dokumentasi §4.5)
  // =============================
  //
  // Bentuk response SUDAH DIKONFIRMASI dari Network tab (2026-08-20):
  //   {
  //     deviceId, provider, inverterType,
  //     query: { startTs, endTs, interval, agg, startDate, endDate },
  //     telemetry: {
  //       overview: { currentPower: [{ts, value}, ...], ... },
  //       ac3Phase: { phaseR: { voltage: [{ts,value},...], current: [...] }, ... },
  //       ... (mengikuti struktur ternormalisasi Rev3 yang sama seperti
  //           /telemetry/latest, cuma tiap leaf field jadi array time-series
  //           {ts, value}, bukan angka tunggal)
  //     }
  //   }
  function parseTawabiHistoryResponse(raw, rangeDays) {

    if (!raw || !raw.telemetry) return null;

    const t = raw.telemetry;
    const powerSeries = t.overview?.currentPower || [];
    const voltageSeries = t.ac3Phase?.phaseR?.voltage || [];
    const currentSeries = t.ac3Phase?.phaseR?.current || [];
    // Suhu inverter -- selalu ada untuk semua provider (section 7 dokumentasi:
    // diagnostics.inverterTemp dipetakan dari register Solarman INV_T juga,
    // bukan cuma logger tambahan 360Energy seperti ambientTemp/humidity).
    const temperatureSeries = t.diagnostics?.inverterTemp || [];
    // Grid & Load -- historis, buat grafik trend ekspor/impor & konsumsi
    // (sebelumnya cuma ditampilkan sebagai angka statis "saat ini" di
    // card Grid & Load, sekarang ditambah grafik trend-nya).
    const gridPowerSeries = t.grid?.gridPower || [];
    const loadPowerSeries = t.load?.loadPower || [];

    // Pakai series pertama yang ada isinya buat generate label waktu
    // (semua series historis punya timestamp yang sama per titik).
    const primarySeries = powerSeries.length ? powerSeries : (voltageSeries.length ? voltageSeries : currentSeries);
    if (!primarySeries.length) return null;

    // Untuk rentang >1 hari, label WAJIB include tanggal -- kalau cuma
    // "14:30" doang, jam yang sama keulang tiap hari jadi bingung mana
    // hari yang mana di sumbu grafik.
    //
    // FIX: sebelumnya SEMUA rentang >1 hari (termasuk 30 hari / custom
    // berbulan-bulan yang datanya per-jam, bisa ratusan-ribuan titik)
    // tetap pakai format "17 Agu, 14.00" (tanggal + jam) di SETIAP
    // titik. Label sepanjang itu dikali ratusan titik bikin sumbu-X
    // numpuk/tabrakan biar autoSkip/rotasi sudah aktif. Untuk rentang
    // yang jelas-jelas multi-hari (>3 hari), jam per titik tidak
    // penting buat dibaca di sumbu -- cukup tanggalnya saja, jauh lebih
    // pendek dan lebih gampang di-autoSkip Chart.js.
    const labels = primarySeries.map((pt) => {
      const d = new Date(pt.ts);
      if (rangeDays > 3) return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
      return rangeDays > 1
        ? d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
        : d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    });
    const toNums = (series) => series.map((pt) => Number(pt.value));

    return {
      labels,
      power: toNums(powerSeries),
      voltage: toNums(voltageSeries),
      current: toNums(currentSeries),
      temperature: toNums(temperatureSeries),
      gridPower: toNums(gridPowerSeries),
      loadPower: toNums(loadPowerSeries)
    };

  }

  // FIX (poin 3, disclaimer §5): dulu di sini fallback-nya manggil
  // genChartData24h/7d/Nd() -- kurva lonceng "sintetis" (pola matematis
  // Gaussian) yang bikin device yang OFFLINE atau histori-nya KOSONG
  // kelihatan seolah-olah lagi produksi listrik normal (grafik naik-turun
  // meyakinkan). Ini menyesatkan buat user, jadi DIHAPUS. Sekarang kalau
  // API telemetry/history gagal / responsnya kosong / device offline,
  // grafik WAJIB nampilin garis datar 0 (flatZeroSeries di bawah) --
  // jelas ke user artinya "tidak ada data", bukan data listrik beneran.
  function flatZeroSeries(rangeDays) {
    const now = new Date();
    const isHourly = rangeDays <= 1;
    const pointCount = isHourly ? 24 : rangeDays;
    const labels = Array.from({ length: pointCount }, (_, i) => {
      const d = new Date(now);
      if (isHourly) {
        d.setHours(d.getHours() - (pointCount - 1 - i), 0, 0, 0);
        return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      }
      d.setDate(d.getDate() - (pointCount - 1 - i));
      return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    });
    const zeros = () => labels.map(() => 0);
    return {
      labels,
      power: zeros(),
      voltage: zeros(),
      current: zeros(),
      temperature: zeros(),
      gridPower: zeros(),
      loadPower: zeros()
    };
  }

  // Fetcher generik -- dipakai buat "Today" (24 jam), "7 Days", dan
  // "30 Days" sekaligus, cuma beda rentang startTs/endTs. Kalau gagal/
  // kosong, jatuh ke flatZeroSeries(rangeDays) (garis datar 0) -- BUKAN
  // fallback sintetis lagi (lihat catatan flatZeroSeries di atas).
  async function fetchTawabiHistoryChart(deviceId, rangeDays) {
    try {
      // FIX (poin 4, disclaimer §5): dulu "const endTs = Date.now();" --
      // milidetiknya selalu beda tiap kali dipanggil (walau cuma beda
      // sepersekian detik), jadi tiap request punya query string endTs
      // yang unik -> cache di backend/CDN/browser TIDAK PERNAH kena hit
      // (selalu MISS), padahal isinya harusnya sama kalau masih di menit
      // yang sama. Dibulatkan ke kelipatan 1 menit (60000 ms) supaya
      // request2 yang terjadi di menit yang sama menghasilkan endTs
      // (dan startTs turunannya) IDENTIK -> bisa di-cache dengan benar.
      const endTs = Math.floor(Date.now() / 60000) * 60000;
      const startTs = endTs - rangeDays * 24 * 60 * 60 * 1000;

      const raw = await edashApiFetch(`/devices/${deviceId}/telemetry/history?startTs=${startTs}&endTs=${endTs}`);
      console.log(`[system-information] GET /devices/${deviceId}/telemetry/history (${rangeDays} hari) raw response:`, raw);

      const parsed = parseTawabiHistoryResponse(raw, rangeDays);
      if (parsed && parsed.labels.length) return parsed;

      console.warn(`[system-information] Response history ${rangeDays} hari tidak dikenali bentuknya / kosong, tampilkan garis datar 0.`);
    } catch (e) {
      console.warn(`[system-information] Gagal ambil telemetry/history ${rangeDays} hari untuk ${deviceId}, tampilkan garis datar 0:`, e.message);
    }
    return flatZeroSeries(rangeDays);
  }

  // "Today" = rentang 24 jam terakhir (dipertahankan sebagai alias biar
  // tidak perlu ubah pemanggil lain yang masih pakai nama lama ini).
  // Parameter fallbackScale sudah TIDAK dipakai lagi (fallback sekarang
  // selalu garis datar 0, bukan kurva sintetis skala tertentu) --
  // dipertahankan di signature supaya pemanggil lama tidak perlu diubah.
  async function fetchTawabiTodayChart(deviceId, fallbackScale) {
    return fetchTawabiHistoryChart(deviceId, 1);
  }

  // Fetch khusus buat live refresh chart 24 Jam -- BEDA dari
  // fetchTawabiTodayChart biasa: yang itu kalau gagal fallback ke
  // flatZeroSeries (garis datar 0), pas dipakai buat initial load itu
  // benar (halaman harus render SESUATU). Tapi kalau dipakai di
  // siLiveRefreshTick tiap 10 detik, itu bahaya -- 1 request gagal/
  // timeout (network blip dsb) bisa nimpa chart yang udah bagus jadi
  // garis 0. Di sini kalau gagal/kosong cukup balikin null, biar chart
  // LAMA di canvas dipertahankan apa adanya (lihat siRefreshDetailLiveChart).
  async function pollFetchTawabiTodayChart(deviceId) {
    const endTs = Math.floor(Date.now() / 60000) * 60000;
    const startTs = endTs - 1 * 24 * 60 * 60 * 1000;
    const raw = await edashApiFetch(`/devices/${deviceId}/telemetry/history?startTs=${startTs}&endTs=${endTs}`);
    const parsed = parseTawabiHistoryResponse(raw, 1);
    return (parsed && parsed.labels.length) ? parsed : null;
  }


  async function fetchTawabiWeekChart(deviceId, fallbackScale) {
    return fetchTawabiHistoryChart(deviceId, 7);
  }

  async function fetchTawabiMonthChart(deviceId, fallbackScale) {
    return fetchTawabiHistoryChart(deviceId, 30);
  }

  // Custom Range -- sama seperti today/week/month di atas, cuma
  // startTs/endTs-nya dihitung dari 2 tanggal yang user pilih sendiri
  // di date-picker (bukan rentang tetap 1/7/30 hari). Dipanggil
  // on-demand tiap kali Custom Range diklik/diganti (lihat
  // loadCustomRangeAndRender di bawah), hasilnya di-cache per
  // rentang tanggal di sys.chart._customCache biar tidak fetch ulang
  // kalau user pilih rentang yang sama lagi.
  async function fetchTawabiCustomChart(deviceId, dateFrom, dateTo, fallbackScale) {
    const startTs = new Date(`${dateFrom}T00:00:00`).getTime();
    const endTs = new Date(`${dateTo}T23:59:59.999`).getTime();
    const rangeDays = Math.max(1, Math.round((endTs - startTs) / 86400000));

    try {
      const raw = await edashApiFetch(`/devices/${deviceId}/telemetry/history?startTs=${startTs}&endTs=${endTs}`);
      console.log(`[system-information] GET /devices/${deviceId}/telemetry/history (custom ${dateFrom}..${dateTo}) raw response:`, raw);

      const parsed = parseTawabiHistoryResponse(raw, rangeDays);
      if (parsed && parsed.labels.length) return parsed;

      console.warn(`[system-information] Response history custom range tidak dikenali bentuknya / kosong, tampilkan garis datar 0.`);
    } catch (e) {
      console.warn(`[system-information] Gagal ambil telemetry/history custom range (${dateFrom}..${dateTo}) untuk ${deviceId}, tampilkan garis datar 0:`, e.message);
    }
    return flatZeroSeries(rangeDays);
  }

  function mapTawabiToSiSystem(project, system, device, telemetry, unitIndex, charts, pvModuleRow) {

    const ov = telemetry?.overview || {};
    const diag = telemetry?.diagnostics || {};
    const ml = telemetry?.mlMetrics || {};

    const systemLabel = (system && (system.system_name || system.systemName || system.name)) || `PLTS Tawabi Grup ${unitIndex + 1}`;
    const scale = ml.performanceRatioPct ? ml.performanceRatioPct / 100 : 0.7;

    // today/week/month sudah di-fetch DI LUAR fungsi ini (lihat
    // loadOneTawabiCard) supaya bisa jalan PARALEL dengan telemetry/latest,
    // bukan gantian -- itu penyebab utama loading lama sebelumnya.

    return {
      // ID unik PER UNIT (pakai id sistem asli dari API kalau ada,
      // fallback ke index urutan) -- supaya Grup 1 & Grup 2 (dan unit
      // lain kalau ada) muncul sebagai kartu terpisah, tidak saling timpa.
      id: `sys-tawabi-api-${(system && system.id) || unitIndex}`,
      systemId: (system && system.id) || null, // UUID asli dari backend, dipakai buat query ?system_id=... ke /pv-modules (BEDA dari `id` di atas yang sudah diberi prefix "sys-tawabi-api-" khusus untuk kebutuhan internal frontend)
      pvModuleLoaded: pvModuleRow !== undefined, // false hanya kalau fetch-nya gagal (lihat fetchTawabiPvModule)
      _pvModuleId: pvModuleRow ? pvModuleRow.id : null,
      // PERBAIKAN: sebelumnya "status" cuma ngecek diag.modbusOk === false
      // (True 3 -> "pending"), sedangkan kalau fetch /telemetry/latest-nya
      // GAGAL TOTAL (device unreachable -- `telemetry` param di sini jadi
      // null, lihat loadOneTawabiCard di atas), diag jadi {} kosong dan
      // `diag.modbusOk === false` EVALUASINYA FALSE (undefined !== false),
      // jatuh ke else branch -> ditandai "connected". Padahal ini kondisi
      // yang paling jelas menunjukkan device OFFLINE (sama definisinya
      // dengan Dashboard/Project Selector: "online" = berhasil membaca
      // live telemetry). Sekarang: fetch gagal total -> "offline" secara
      // eksplisit; modbusOk===false (device kebaca tapi register gagal)
      // tetap "pending"; sisanya "connected". Card Offline di Stats Row
      // (di atas) sekarang benar-benar bisa terisi, bukan selalu 0.
      status: !telemetry ? "offline" : (diag.modbusOk === false ? "pending" : "connected"),
      basic: {
        systemName: systemLabel,
        inverter1: (device && device.name) || "-",
        inverterBrand: (device && device.provider) || telemetry?.provider || "-"
      },
      systemOverview: {
        installedDate: (system && (system.installed_date || system.installedDate)) || "-",
        lastUpdated: telemetry?.lastSeen || new Date().toISOString(),
        peakPowerKwp: (system && (system.peak_power_kwp || system.peakPowerKwp)) || "-",
        address: (system && system.address) || project.location || "-"
      },
      inverterOverview: {
        deviceId: (device && device.id) || TAWABI_DEVICE_ID,
        // Fallback ke device.id (bukan cuma TAWABI_DEVICE_ID) kalau
        // objek device tidak punya field thingsboard_device_id/
        // thingsboardDeviceId terpisah -- penting untuk device fallback
        // Kasdam (KASDAM_FALLBACK_DEVICES) yang cuma punya {id, name,
        // deviceSn}, supaya kartunya tidak salah nampilin ID Tawabi.
        tbDeviceId: (device && (device.thingsboard_device_id || device.thingsboardDeviceId || device.id)) || TAWABI_DEVICE_ID,
        deviceName: (device && device.name) || "-",
        deviceSn: (device && (device.device_sn || device.deviceSn)) || "-",
        deviceType: (device && (device.device_type || device.deviceType)) || "Inverter",
        provider: (device && device.provider) || telemetry?.provider || "-",
        inverterType: (device && (device.inverter_type || device.inverterType)) || telemetry?.inverterType || "-",
        maximumOutputKw: (device && (device.maximum_output_kw || device.maximumOutputKw)) || "-",
        communicationProtocol: (device && (device.communication_protocol || device.communicationProtocol)) || "-",
        installationDate: (device && (device.installation_date || device.installationDate)) || "-",
        lastMaintenance: (device && (device.last_maintenance || device.lastMaintenance)) || "-",
        nextMaintenance: (device && (device.next_maintenance || device.nextMaintenance)) || "-",
        maintenanceFrequency: "-",
        // Suhu terkini inverter & radiator -- selalu ada untuk semua provider
        // (lihat parseTawabiHistoryResponse di atas untuk histori/grafiknya).
        inverterTemperatureC: diag.inverterTemp ?? "-",
        radiatorTemperatureC: diag.radiatorTemp ?? "-"
      },
      // PV Panel Overview -- sama seperti System/Inverter Overview,
      // datanya sudah tersedia begitu list/card dibuka (di-fetch
      // paralel dengan telemetry/latest di loadOneTawabiCard), bukan
      // lazy-load terpisah lagi.
      pvPanelOverview: mapPvModuleToOverview(pvModuleRow),
      deviceOverview: {
        firmware: "-",
        modbusStatus: diag.modbusOk === true ? "OK" : (diag.modbusOk === false ? "Terputus" : "-"),
        uptimeSeconds: diag.uptimeSeconds ?? "-",
        lastSeen: telemetry?.lastSeen || "-",
        ambientTemperatureC: diag.ambientTemp ?? "-",
        humidityPct: diag.humidity ?? "-",
        fanRelay: diag.relayOn === true ? "ON" : (diag.relayOn === false ? "OFF" : "-"),
        alarmRegisterStatus: diag.alarmActive === true ? "Aktif" : (diag.alarmActive === false ? "Normal" : "-")
      },
      // Field di bawah ini SENGAJA tidak lagi dirender di UI (card
      // Electrical Quality & Diagnostics sudah dihapus atas permintaan),
      // tapi mapping-nya dibiarkan hidup kalau-kalau dipakai lagi nanti.
      electricalQuality: {
        frequencyHz: ov.acFrequency ?? "-",
        reactivePowerKvar: ov.reactivePower ?? "-",
        powerFactor: ov.powerFactor ?? "-"
      },
      diagnostics: {
        leakCurrentMa: "-",
        insulationResistanceKohm: "-",
        inverterStatus: diag.modbusOk === false ? "Fault" : "Normal",
        faultCode: diag.faultCode ?? "-"
      },
      // Baru: 3 section di bawah ini SEMUA dari /telemetry/latest juga,
      // tapi field-nya BELUM pernah dipakai di halaman manapun di app
      // ini -- bukan "Battery" (itu sudah ada page Battery Station
      // sendiri, jadi telemetry.battery SENGAJA tidak dipetakan lagi di
      // sini biar tidak dobel), dan bukan ac3Phase snapshot (itu sudah
      // kepakai buat chart Voltage/Current/Power historis di atas).
      productionOverview: {
        currentPowerW: ov.currentPower ?? "-",
        pvTotalPowerW: ov.pvTotalPower ?? "-",
        energyTodayKwh: ov.energyToday ?? "-",
        energyTotalKwh: ov.energyTotal ?? "-",
        efficiencyPct: ov.efficiency ?? "-"
      },
      pvStrings: (() => {
        const raw = telemetry?.pvStrings || {};
        return ["string1", "string2", "string3", "string4"].map((k, i) => {
          const s = raw[k] || {};
          return { label: `String ${i + 1}`, voltage: s.voltage ?? null, current: s.current ?? null, power: s.power ?? null };
        });
      })(),
      gridLoad: (() => {
        const g = telemetry?.grid || {};
        const l = telemetry?.load || {};
        return {
          gridPowerW: g.gridPower ?? "-",
          dailyFeedInKwh: g.dailyFeedIn ?? "-",
          totalFeedInKwh: g.totalFeedIn ?? "-",
          dailyPurchasedKwh: g.dailyPurchased ?? "-",
          totalPurchasedKwh: g.totalPurchased ?? "-",
          loadPowerW: l.loadPower ?? "-",
          dailyConsumptionKwh: l.dailyConsumption ?? "-",
          totalConsumptionKwh: l.totalConsumption ?? "-"
        };
      })(),
      futureMaintenance: [],
      historicalMaintenance: [],
      alarmHistory: [],
      // "today" & "week" & "month" = REAL (dari telemetry/history rentang
      // 1/7/30 hari). Custom Range JUGA REAL sekarang -- di-fetch on-demand
      // tiap user pilih/ganti rentang tanggal (lihat fetchTawabiCustomChart
      // & loadCustomRangeAndRender), hasilnya ditaruh di _customCache
      // supaya tidak fetch ulang kalau rentang yang sama dipilih lagi.
      chart: {
        deviceId: charts.deviceId,
        fallbackScale: scale,
        today: charts.todayChart,
        week: charts.weekChart,
        month: charts.monthChart,
        loaded: !!(charts.todayChart || charts.weekChart || charts.monthChart),
        _customCache: {},
        range: (() => {
          // FIX: sebelumnya dibatasi cuma 29 hari ke belakang -- persis
          // sama dengan preset "30 Days", jadi tombol "Custom" jadi
          // nyaris tidak berguna (user tidak bisa pilih rentang LEBIH
          // JAUH dari 30 hari terakhir, padahal itu justru tujuan utama
          // Custom Range). Backend/API sudah dukung agregasi sampai
          // >90 hari & per-tahun (lihat dokumentasi §4.5), jadi batas
          // di frontend ini dilebarkan ke 1 tahun ke belakang. Kalau
          // system.installedDate ada & lebih baru dari itu, pakai itu
          // supaya user tidak bisa pilih tanggal sebelum sistem terpasang.
          const today = new Date();
          const first = new Date(today);
          first.setDate(first.getDate() - 364);
          const installed = (system && (system.installed_date || system.installedDate)) || null;
          const installedDate = installed ? new Date(installed) : null;
          const firstDate = installedDate && !isNaN(installedDate.getTime()) && installedDate > first
            ? installedDate
            : first;
          return { firstDate: firstDate.toISOString().slice(0, 10), lastDate: today.toISOString().slice(0, 10) };
        })()
      },
      health: ml.deviceScore ?? 80
    };

  }

  async function loadOneTawabiCard(project, system, device, unitIndex) {
    const deviceIdForTelemetry = (device && (device.id || device.thingsboardDeviceId)) || TAWABI_DEVICE_ID;
    const systemId = (system && system.id) || null;

    // telemetry/latest DAN pv-modules di-fetch BERSAMAAN di sini --
    // sama seperti System/Inverter Overview (yang datanya sudah ada
    // dari fetch project di awal), PV Panel sekarang juga langsung
    // tersedia begitu list/card muncul, tidak perlu nunggu user buka
    // detail dulu. History chart (24h/7d/30d) TETAP lazy-load terpisah
    // (lihat ensureTawabiChartData/ensureTawabiRangeData) karena itu
    // yang paling berat (round-trip ke ThingsBoard) -- PV module cuma
    // baca dari database sendiri, jadi murah untuk selalu di-include.
    const [telemetryResult, pvModuleRow] = await Promise.all([
      edashApiFetch(`/devices/${deviceIdForTelemetry}/telemetry/latest`).catch((e) => {
        console.warn(`[system-information] Gagal ambil telemetry unit #${unitIndex + 1}, field live akan kosong:`, e.message);
        return null;
      }),
      systemId ? fetchTawabiPvModule(systemId) : Promise.resolve(undefined)
    ]);

    return mapTawabiToSiSystem(project, system, device, telemetryResult, unitIndex, { todayChart: null, weekChart: null, monthChart: null, deviceId: deviceIdForTelemetry }, pvModuleRow);
  }

  // ===========================================================
  // LIVE TELEMETRY POLLING
  // ------------------------------------------------------------
  // Sebelumnya /telemetry/latest cuma di-fetch SEKALI pas kartu/halaman
  // ini pertama kali dimuat (loadOneTawabiCard di atas) -- setelahnya
  // angka currentPower, status, suhu, dst TIDAK PERNAH ter-update lagi
  // walau device-nya sudah kirim data baru, sampai user reload manual
  // atau pindah-balik tab.
  //
  // Backend (lihat DOKUMENTASI_API_eDASHBOARD_360ENERGY.pdf §4.7) sudah
  // sediakan WS /devices/:id/telemetry/ws (push tiap 5 detik), TAPI
  // frontend project ini belum ada satupun kode WebSocket sama sekali,
  // dan tiap project Tawabi/Kasdam cuma 2 kartu -- jadi untuk sekarang
  // dipilih REST polling ringan (pola yang SAMA dengan yang sudah
  // dipakai di header.js/admin-view.js/ticketing.js), bukan WS. Kalau
  // nanti jumlah kartu per proyek membengkak jadi puluhan, pola ini
  // yang paling gampang di-upgrade ke WS per kartu.
  //
  // PENTING soal render ulang: renderDetail() ASLI (lihat function-nya
  // di bawah) me-rebuild SELURUH siCardsRow lewat innerHTML (termasuk
  // destroy+rebuild semua Chart.js instance & reset tab 7 Hari/30 Hari
  // yang lagi dipilih user) -- terlalu berat & destruktif kalau
  // dipanggil tiap 10 detik. Makanya untuk Detail view, tick ini HANYA
  // menimpa card yang datanya berasal dari telemetry (lihat
  // data-si-section yang ditambahkan di overviewCard/realtimeCard/
  // deviceCard/pvStringsCard/healthCard), lewat siRefreshDetailLiveCards()
  // -- chart & urutan drag-drop kartu sama sekali tidak disentuh.
  // ===========================================================
  const SI_LIVE_REFRESH_MS = 10000; // 10 detik -- cukup untuk terasa "live" tanpa membebani backend/ThingsBoard tiap kartu render ulang

  let siLiveRefreshTimer = null;
  let siIsLiveRefreshing = false;

  // Menimpa IN-PLACE cuma field2 `sys` yang berasal dari telemetry
  // (overview/diagnostics/mlMetrics) -- field master/static (basic,
  // systemOverview.installedDate/peakPowerKwp/address, pvPanelOverview,
  // chart config) SENGAJA tidak disentuh sama sekali di sini, itu bukan
  // data real-time dan tidak perlu di-refetch tiap 10 detik.
  function applySiLiveTelemetry(sys, telemetry) {
    if (!sys) return;
    const ov = telemetry?.overview || {};
    const diag = telemetry?.diagnostics || {};
    const ml = telemetry?.mlMetrics || {};

    sys.status = !telemetry ? "offline" : (diag.modbusOk === false ? "pending" : "connected");
    sys.systemOverview.lastUpdated = telemetry?.lastSeen || sys.systemOverview.lastUpdated;

    sys.inverterOverview.inverterTemperatureC = diag.inverterTemp ?? "-";
    sys.inverterOverview.radiatorTemperatureC = diag.radiatorTemp ?? "-";

    sys.deviceOverview.modbusStatus = diag.modbusOk === true ? "OK" : (diag.modbusOk === false ? "Terputus" : "-");
    sys.deviceOverview.uptimeSeconds = diag.uptimeSeconds ?? "-";
    sys.deviceOverview.lastSeen = telemetry?.lastSeen || "-";
    sys.deviceOverview.ambientTemperatureC = diag.ambientTemp ?? "-";
    sys.deviceOverview.humidityPct = diag.humidity ?? "-";
    sys.deviceOverview.fanRelay = diag.relayOn === true ? "ON" : (diag.relayOn === false ? "OFF" : "-");
    sys.deviceOverview.alarmRegisterStatus = diag.alarmActive === true ? "Aktif" : (diag.alarmActive === false ? "Normal" : "-");

    sys.electricalQuality.frequencyHz = ov.acFrequency ?? "-";
    sys.electricalQuality.reactivePowerKvar = ov.reactivePower ?? "-";
    sys.electricalQuality.powerFactor = ov.powerFactor ?? "-";

    sys.diagnostics.inverterStatus = diag.modbusOk === false ? "Fault" : "Normal";
    sys.diagnostics.faultCode = diag.faultCode ?? "-";

    sys.productionOverview.currentPowerW = ov.currentPower ?? "-";
    sys.productionOverview.pvTotalPowerW = ov.pvTotalPower ?? "-";
    sys.productionOverview.energyTodayKwh = ov.energyToday ?? "-";
    sys.productionOverview.energyTotalKwh = ov.energyTotal ?? "-";
    sys.productionOverview.efficiencyPct = ov.efficiency ?? "-";

    const rawStrings = telemetry?.pvStrings || {};
    sys.pvStrings = ["string1", "string2", "string3", "string4"].map((k, i) => {
      const s = rawStrings[k] || {};
      return { label: `String ${i + 1}`, voltage: s.voltage ?? null, current: s.current ?? null, power: s.power ?? null };
    });

    const g = telemetry?.grid || {};
    const l = telemetry?.load || {};
    sys.gridLoad = {
      gridPowerW: g.gridPower ?? "-",
      dailyFeedInKwh: g.dailyFeedIn ?? "-",
      totalFeedInKwh: g.totalFeedIn ?? "-",
      dailyPurchasedKwh: g.dailyPurchased ?? "-",
      totalPurchasedKwh: g.totalPurchased ?? "-",
      loadPowerW: l.loadPower ?? "-",
      dailyConsumptionKwh: l.dailyConsumption ?? "-",
      totalConsumptionKwh: l.totalConsumption ?? "-"
    };

    sys.health = ml.deviceScore ?? sys.health;
  }

  // Timpa cuma card2 yang isinya live telemetry di Detail view yang
  // SEDANG TERBUKA sekarang (kalau ada), pakai data-si-section yang
  // sudah ditambahkan ke masing2 card. Kalau siCardsRow belum ada di
  // DOM (mis. user lagi di List view), fungsi ini no-op.
  function siRefreshDetailLiveCards(sys) {
    const cardsRow = document.getElementById("siCardsRow");
    if (!cardsRow || !sys) return;

    const patches = {
      systemOverview: systemOverviewCard(sys),
      inverterOverview: inverterOverviewCard(sys),
      deviceOverview: deviceCard(sys),
      productionOverview: productionOverviewCard(sys),
      pvStrings: pvStringsCard(sys),
      gridLoad: gridLoadCard(sys),
      health: healthCard(sys.health)
    };
    Object.keys(patches).forEach((key) => {
      const el = cardsRow.querySelector(`[data-si-section="${key}"]`);
      if (el) el.outerHTML = patches[key];
    });

    const b = statusBadge(sys.status);
    const badgeEl = document.getElementById("siDetailStatusBadge");
    if (badgeEl) {
      badgeEl.className = "si-badge " + b.cls;
      badgeEl.textContent = b.label;
    }
  }

  // Timpa data chart 24 Jam yang lagi aktif (kalau ada) secara IN-PLACE
  // lewat Chart.js .update() -- BUKAN destroy+recreate kayak
  // renderSingleChart biasa. Chart yang toggle-nya lagi di 7 Hari/30
  // Hari/Custom TIDAK disentuh canvas-nya (chart.today tetap ke-update
  // di memori sys, baru kepake begitu user toggle balik ke 24 Jam --
  // konsisten sama alasan siRefreshDetailLiveCards tidak menyentuh chart).
  function siRefreshDetailLiveChart(sys, todayChart) {
    if (!todayChart || !todayChart.labels || !todayChart.labels.length) return;
    sys.chart.today = todayChart;

    chartSpecs.forEach((spec) => {
      const period = siChartPeriods[spec.key] || { mode: "24h" };
      if (period.mode !== "24h") return;

      const applyToInstance = (instKey) => {
        const inst = window.__siChartInstances[instKey];
        if (!inst) return;
        inst.data.labels = todayChart.labels;
        inst.data.datasets[0].data = todayChart[spec.key] || [];
        inst.update("none"); // "none" = tanpa animasi ulang tiap 10 detik, biar tidak flicker
      };
      applyToInstance(spec.canvas);      // canvas kartu kecil
      applyToInstance("zoom-" + spec.canvas); // canvas modal zoom, kalau lagi kebuka (lihat instKey di renderCharts)

      // Angka ringkasan Rata-rata/Puncak/Terendah di bawah chart --
      // format HTML-nya disamain persis sama yang dipakai renderSingleChart
      // supaya tidak ada perbedaan visual antara initial render vs live update.
      const statsEl = document.querySelector(`[data-chart-stats="${spec.key}"]`);
      if (statsEl) {
        statsEl.innerHTML = `<span class="si-chart-period-caption">${esc(periodLabel(period))}</span><span class="si-chart-stats-values">${computeChartStats(todayChart[spec.key], spec.unit)}</span>`;
      }
    });
  }


  // Jalankan sekumpulan async job dalam GELOMBANG kecil (default 4
  // konkuren), bukan semua sekaligus lewat Promise.all -- ini yang
  // dimaksud "batching" di disclaimer §5 poin 2 (Thundering Herd):
  // narik histori/telemetry SEMUA device bersamaan di detik yang sama
  // bikin lonjakan koneksi serentak ke backend/database. Dengan
  // batching, paling banyak SI_POLL_BATCH_SIZE request yang jalan
  // berbarengan; gelombang berikutnya baru mulai setelah gelombang
  // sebelumnya selesai -- beban ke backend jadi lebih rata.
  //
  // Generic (bukan spesifik telemetry) supaya bisa dipakai ulang kalau
  // ada kebutuhan batching lain nanti, bukan cuma di siLiveRefreshTick.
  const SI_POLL_BATCH_SIZE = 4;

  async function runInBatches(items, batchSize, worker) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(worker));
      results.push(...batchResults);
    }
    return results;
  }

  async function siLiveRefreshTick() {
    // Jangan tumpuk request kalau siklus sebelumnya belum selesai, dan
    // jangan poll kalau tab sedang tidak dilihat (background tab) --
    // sama seperti pola tkAutoRefreshTick() di ticketing.js.
    if (siIsLiveRefreshing || document.hidden) return;

    const grid = document.getElementById("siSystemGrid");
    if (!grid) return; // halaman/tab System Information belum pernah dibuka

    siIsLiveRefreshing = true;
    try {
      // Kalau lagi buka Detail view 1 system -> cukup refresh system itu
      // saja (paling relevan buat user & paling murah). Kalau lagi di
      // List view -> refresh SEMUA kartu yang sedang dimuat di sesi ini
      // (window.__siSystems isinya kecil -- 2 unit untuk Tawabi/Kasdam
      // sejauh ini, bukan puluhan -- tapi tetap di-batch di bawah biar
      // aman kalau nanti device-nya nambah banyak, bukan nunggu jadi
      // masalah dulu baru dibenerin).
      const targets = siActiveSystemId
        ? window.__siSystems.filter((s) => s.id === siActiveSystemId)
        : window.__siSystems;

      // Cuma system hasil mapping Core API/Tawabi (punya deviceId) yang
      // bisa di-poll -- lewati entry lain kalau ada.
      const pollable = targets.filter((s) => s.chart && s.chart.deviceId);
      if (!pollable.length) return;

      // FIX (disclaimer §5 poin 2, Thundering Herd): dulu Promise.all
      // langsung ke SEMUA pollable sekaligus -- kalau device-nya
      // banyak, itu nembak puluhan request bersamaan di detik yang
      // sama tiap 10 detik siklusnya. Diganti runInBatches supaya
      // paling banyak SI_POLL_BATCH_SIZE request jalan berbarengan.
      await runInBatches(pollable, SI_POLL_BATCH_SIZE, async (sys) => {
        try {
          const telemetry = await edashApiFetch(`/devices/${sys.chart.deviceId}/telemetry/latest`);
          applySiLiveTelemetry(sys, telemetry);
        } catch (e) {
          // Diam2 gagal per unit -- jangan sampai 1 device timeout bikin
          // kartu lain ikut gagal ke-refresh juga.
          console.warn(`[system-information] Live refresh gagal untuk device ${sys.chart.deviceId}:`, e.message);
        }
      });

      if (siActiveSystemId) {
        const sys = getSystem(siActiveSystemId);
        if (sys) {
          siRefreshDetailLiveCards(sys);

          // Chart 24 Jam cuma di-refresh buat system yang lagi DIBUKA
          // (murah, cuma 1 request) & cuma kalau load awalnya sudah
          // selesai (sys.chart.loaded) -- biar tidak tabrakan sama
          // ensureTawabiChartData yang mungkin masih jalan. Gagal di sini
          // diam-diam saja (chart lama dipertahankan, lihat
          // pollFetchTawabiTodayChart) -- jangan sampai bikin seluruh
          // tick gagal cuma gara-gara chart history timeout.
          if (sys.chart && sys.chart.loaded && sys.chart.deviceId) {
            try {
              const todayChart = await pollFetchTawabiTodayChart(sys.chart.deviceId);
              siRefreshDetailLiveChart(sys, todayChart);
            } catch (e) {
              console.warn(`[system-information] Live refresh chart 24 Jam gagal untuk ${sys.chart.deviceId}:`, e.message);
            }
          }
        }
      } else {
        renderSystemGrid(); // ringan (tanpa chart/toggle state), aman dipanggil ulang -- lihat catatan di renderSystemGrid()
      }
    } finally {
      siIsLiveRefreshing = false;
    }
  }

  function siStopLiveRefresh() {
    if (siLiveRefreshTimer) {
      clearInterval(siLiveRefreshTimer);
      siLiveRefreshTimer = null;
    }
  }

  function siStartLiveRefresh() {
    siStopLiveRefresh(); // hindari double-timer kalau initSystemInformation() sempat terpanggil 2x
    siLiveRefreshTimer = setInterval(siLiveRefreshTick, SI_LIVE_REFRESH_MS);
  }

  // Refresh instan begitu tab kembali aktif dilihat, supaya user yang
  // habis pindah tab lama tidak melihat data basi selama siklus 10
  // detik pertama.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) siLiveRefreshTick();
  });

  // Berhenti otomatis begitu user pindah ke halaman lain di SPA ini --
  // pola sama persis dengan tkStopAutoRefresh() di ticketing.js. Tanpa
  // ini timer akan terus jalan di background walau #page-root sudah
  // diisi halaman lain, dan numpuk timer baru tiap kali System
  // Information dibuka ulang (initSystemInformation() dipanggil dari awal).
  if (window.edashPageSignal) {
    window.edashPageSignal.addEventListener("abort", siStopLiveRefresh, { once: true });
  }

  // Ambil data PV Panel (GET /pv-modules?system_id=...) dan petakan ke
  // bentuk yang dipakai card "PV Panel Overview". Field API snake_case
  // (model_name, individual_panel_size_wp, dst) -- lihat spek endpoint
  // di pv-modules.routes.ts. Kalau belum ada isinya / endpoint belum
  // live / gagal fetch, balikin object placeholder "-" semua (aman,
  // tidak bikin halaman error).
  function emptyPvPanelOverview() {
    return {
      pvId: "-", pvModel: "-", cellType: "-", individualPanelSizeM2: "-",
      pvInstalledKw: "-", installationDate: "-", lastMaintenance: "-",
      nextMaintenance: "-", maintenanceFrequency: "-"
    };
  }

  function mapPvModuleToOverview(row) {
    if (!row) return emptyPvPanelOverview();
    // Robust ke dua kemungkinan casing (lihat catatan panjang di
    // savePvModuleToApi soal ketidakpastian konvensi field API ini).
    return {
      pvId: row.id || "-",
      pvModel: row.model_name || row.modelName || "-",
      cellType: row.cell_type || row.cellType || "-",
      individualPanelSizeM2: (row.individual_panel_size_wp ?? row.individualPanelSizeWp) ?? "-",
      pvInstalledKw: (row.pv_installed_kw ?? row.pvInstalledKw) ?? "-",
      installationDate: row.installation_date || row.installationDate || "-",
      lastMaintenance: row.last_maintenance || row.lastMaintenance || "-",
      nextMaintenance: row.next_maintenance || row.nextMaintenance || "-",
      maintenanceFrequency: "-"
    };
  }

  function pvPanelOverviewRows(sys) {
    const p = sys.pvPanelOverview;
    return [
      ["PV ID", p.pvId],
      ["Model", p.pvModel],
      ["Cell Type", p.cellType],
      ["Individual Panel Size", p.individualPanelSizeM2, p.individualPanelSizeM2 !== "-" ? "m\u00b2" : ""],
      ["PV Installed", p.pvInstalledKw, p.pvInstalledKw !== "-" ? "kW" : ""],
      ["Installation Date", fmtDate(p.installationDate)],
      ["Last Maintenance", fmtDate(p.lastMaintenance)],
      ["Next Maintenance", fmtDate(p.nextMaintenance)],
      ["Maintenance Status", computeMaintenanceStatus(p.nextMaintenance)]
    ];
  }

  async function fetchTawabiPvModule(systemId) {
    try {
      const list = await edashApiFetch(`/pv-modules?systemId=${encodeURIComponent(systemId)}`) || [];
      return list.length ? list[0] : null; // 1 system -> 1 PV module (untuk sekarang)
    } catch (e) {
      console.warn("[system-information] Gagal ambil /pv-modules, field PV Panel akan '-':", e.message);
      return undefined; // beda dari `null` -- ini artinya "gagal fetch", bukan "memang kosong"
    }
  }

  // Dipanggil lazy pas user buka detail system tertentu (showDetailView).
  // Kalau history-nya sudah pernah di-load sebelumnya (sys.chart.loaded),
  // langsung skip -- tidak fetch ulang tiap kali system yang sama dibuka
  // lagi di sesi yang sama.
  // Cuma fetch 24 JAM dulu -- ini yang dibutuhin buat tampilan default
  // begitu detail system dibuka. 7 Hari & 30 Hari SENGAJA tidak
  // di-fetch di sini lagi (dulu semua 3 rentang di-fetch bareng dari
  // awal, padahal kebanyakan user defaultnya cuma lihat 24 Jam) --
  // dipindah jadi lazy per-klik lewat ensureTawabiRangeData() di
  // bawah, dipanggil pas user klik tab "7 Days"/"30 Days".
  async function ensureTawabiChartData(sys) {
    if (!sys || !sys.chart || sys.chart.loaded) return;
    const deviceId = sys.chart.deviceId;
    try {
      sys.chart.today = await fetchTawabiTodayChart(deviceId, sys.chart.fallbackScale);
      sys.chart.loaded = true;
    } catch (e) {
      console.warn("[system-information] Gagal lazy-load chart 24 jam:", e.message);
      // loaded TETAP false supaya bisa dicoba lagi kalau user buka
      // ulang detail system ini nanti.
    }
  }

  // Lazy-load 1 rentang spesifik (week/month) -- dipanggil pas user
  // klik tab "7 Days" atau "30 Days" untuk pertama kalinya. Data 1
  // rentang ini KEBAGI ke SEMUA chart card (Voltage/Current/Power/dst)
  // karena 1 kali fetch /telemetry/history sudah bawa semua metrik
  // sekaligus -- jadi cukup di-fetch SEKALI per rentang per system,
  // bukan per chart card.
  async function ensureTawabiRangeData(sys, mode) {
    const flagKey = mode === "7d" ? "weekLoaded" : "monthLoaded";
    const dataKey = mode === "7d" ? "week" : "month";
    if (!sys || !sys.chart || sys.chart[flagKey]) return true;
    try {
      const fetcher = mode === "7d" ? fetchTawabiWeekChart : fetchTawabiMonthChart;
      sys.chart[dataKey] = await fetcher(sys.chart.deviceId, sys.chart.fallbackScale);
      sys.chart[flagKey] = true;
      return true;
    } catch (e) {
      console.warn(`[system-information] Gagal lazy-load chart ${mode}:`, e.message);
      return false;
    }
  }

  async function loadTawabiSystemsFromApi() {
    try {
      const project = await findTawabiProject();
      if (!project) {
        console.warn("[system-information] Proyek Tawabi tidak ditemukan di API.");
        return [];
      }

      const systems = extractTawabiSystems(project);
      console.log(`[system-information] Ditemukan ${systems.length} unit sistem Tawabi:`, systems);

      // Kumpulkan semua kombinasi (unit, device) dulu, baru fetch
      // SEMUANYA SEKALIGUS lewat Promise.all -- bukan satu-satu
      // berurutan seperti sebelumnya (itu penyebab loading lama:
      // tiap unit nunggu telemetry/latest + telemetry/history unit
      // sebelumnya kelar dulu, padahal request-nya independen).
      const jobs = [];
      systems.forEach((system, i) => {
        const devices = extractDevicesForSystem(project, system, i, systems.length);
        devices.forEach((device) => {
          jobs.push(loadOneTawabiCard(project, system, device, i));
        });
      });

      return await Promise.all(jobs);

    } catch (e) {
      console.warn("[system-information] Gagal memuat system Tawabi dari API:", e.message);
      return [];
    }
  }


  function saveSystemsToServer() {
    // Fire-and-forget: gagal simpan ke server TIDAK BOLEH memblokir/
    // mengganggu interaksi user (Add/Edit/Delete tetap langsung
    // ke-reflect di layar dari window.__siSystems), cuma dicatat
    // sebagai warning di console.
    fetch(`${siApiBase()}${SI_API_PATH}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(window.__siSystems),
    }).then((res) => {
      if (!res.ok) console.warn(`[system-information] Server menolak simpan (HTTP ${res.status}).`);
    }).catch((e) => {
      console.warn("[system-information] Gagal simpan ke server:", e.message);
    });
  }
  window.__siSaveSystems = saveSystemsToServer;

  // ---------------------------------------------------------
  // In-memory "database". Diisi seedSystems() (dummy) dulu supaya
  // fungsi lain aman dipanggil sebelum fetch pertama selesai; begitu
  // initSystemInformation() jalan, data asli dari server di-fetch dan
  // MENIMPA ini sebelum render pertama kali.
  // ---------------------------------------------------------
  // Gabungkan system yang dibuat lewat form "Add New Project" (lihat
  // js/add-project.js + js/project-context.js, disimpan di
  // localStorage["edash-user-systems"]) ke dalam list, tanpa duplikat
  // (dicek berdasarkan id).
  function mergeUserSystems(list) {
    const extra = (typeof window.PC_getUserSystems === "function") ? window.PC_getUserSystems() : [];
    if (!extra.length) return list;
    const existingIds = new Set(list.map((s) => s.id));
    extra.forEach((s) => { if (!existingIds.has(s.id)) list.unshift(s); });
    return list;
  }

  // Sesuai permintaan: System Information sekarang HANYA menampilkan
  // Tawabi dari Core API. mergeUserSystems() (proyek user via Add
  // Project) dan seedSystems() (kosong sejak dihapus) tidak lagi
  // dipanggil di sini -- list dimulai kosong, diisi HANYA oleh
  // loadTawabiSystemFromApi() di __siEnsureSystemsLoaded di bawah.
  window.__siSystems = window.__siSystems || [];
  ensureMaintenanceIds(window.__siSystems);
  window.__siSystemsLoaded = window.__siSystemsLoaded || false;

  // Proyek yang sedang aktif (dipilih di Project Selector / baru saja
  // ditambahkan lewat Add Project, ATAU salah satu proyek Core API
  // seperti PLTS Kasdam) — dipakai untuk filter list system di bawah
  // supaya System Information di dalam Project Monitoring ikut proyek
  // yang sedang dipantau, BUKAN selalu Tawabi lagi.
  function siProjectScopedSystems() {
    const all = window.__siSystems || [];
    // window.__siActiveProjectId di-set oleh resolveActiveProjectId() di
    // bawah (dipanggil dari __siEnsureActiveProjectSystemsLoaded() /
    // initSystemInformation(), SELALU sebelum fungsi render manapun yang
    // butuh daftar system dipanggil) -- jadi di sini cukup baca cache-nya
    // secara sinkron. Fallback ke PC_getActiveProject()/"tawabi" hanya
    // untuk jaga-jaga kalau fungsi ini kepanggil sebelum init selesai.
    const active = (typeof window.PC_getActiveProject === "function") ? window.PC_getActiveProject() : null;
    const activeId = window.__siActiveProjectId || (active ? active.id : "tawabi");

    // Sekarang SEMUA system dari Core API (Tawabi maupun proyek lain
    // spt Kasdam) selalu ditandai basic.projectId oleh
    // loadSystemsForProject() -- jadi filter ketat ke proyek aktif ini
    // sudah cukup & akurat.
    const taggedForActive = all.filter((s) => s.basic && s.basic.projectId === activeId);
    if (taggedForActive.length) return taggedForActive;

    // Belum ada SATU PUN system yang pernah ditandai projectId sama
    // sekali (mis. data API belum sempat dimuat sama sekali di sesi
    // ini) -> fallback tampilkan apa adanya, supaya behaviour lama
    // untuk kasus itu tidak berubah. Begitu ada minimal 1 system yang
    // sudah ditandai (proyek manapun), JANGAN fallback ke "semua" lagi
    // -- drpd salah nampilin system milik proyek lain, lebih aman
    // tampilkan kosong sambil menunggu __siEnsureActiveProjectSystemsLoaded()
    // selesai memuat proyek yang benar.
    const anyTagged = all.some((s) => s.basic && s.basic.projectId);
    if (!anyTagged) return all;
    return [];
  }
  window.__siChartInstances = window.__siChartInstances || {};

  // ===========================================================
  // Cross-page status integration
  // ===========================================================
  // Dashboard (js/dashboard.js) dan Project Selector (js/project-selector.js)
  // masing-masing punya cara SENDIRI buat cek online/offline (device
  // discovery + /telemetry/latest lewat psGetLiveDataForProject) --
  // System Information juga fetch /telemetry/latest sendiri per unit
  // (loadOneTawabiCard di atas) buat status Connected/Pending/Offline
  // per system. Dua implementasi terpisah yang menembak endpoint yang
  // sama bisa saja beda hasil kalau device flap persis di antara dua
  // request itu.
  //
  // Diekspos di sini supaya halaman lain bisa CROSS-CHECK ke status
  // yang SUDAH DIHITUNG System Information (kalau proyeknya sudah
  // pernah dimuat di window.__siSystems pada sesi ini) sebagai sumber
  // tambahan yang tervalidasi, bukan cuma percaya hasil device-discovery
  // masing-masing halaman sendiri-sendiri. "Online" di sini = ada
  // MINIMAL SATU system proyek itu yang statusnya "connected" (definisi
  // yang sama dipakai pdApplyInverterSummary() di js/project-detail.js
  // untuk kartu status Project Overview).
  //
  // Return null (BUKAN false) kalau System Information belum pernah
  // memuat system APAPUN untuk proyek ini di sesi ini -- pemanggil harus
  // treat null sebagai "tidak tahu, jangan timpa apa-apa", supaya
  // integrasi ini cuma MENGOREKSI kalau datanya benar-benar tersedia,
  // tidak memaksa proyek yang belum sempat dibuka System Information-nya
  // jadi ke-mark offline secara keliru.
  window.__siGetProjectOnlineStatus = function (projectId) {
    const all = window.__siSystems || [];
    const own = all.filter((s) => s.basic && s.basic.projectId === projectId);
    if (!own.length) return null;
    const anyConnected = own.some((s) => s.status === "connected" || s.status === "online");
    return anyConnected ? "online" : "offline";
  };

  let siActiveSystemId = null;
  // siWizardStep, siEditSection, siDeleteTargetId (state buat wizard/edit/
  // delete) DIHAPUS -- sudah tidak dipakai lagi bersama fiturnya.
  let siScheduleEditIndex = null; // null = add baru, angka = edit index
  // Tiap chart (voltage/current/power) punya periode sendiri-sendiri:
  // mode 'today' | '7d' | '30d' | 'custom'. Untuk 'custom' disimpan
  // rentang tanggal (dateFrom..dateTo) yang dipilih, BUKAN cuma satu
  // tanggal — user bisa pilih "dari hari apa sampai kapan" bebas.
  function defaultChartPeriods() {
    return {
      voltage: { mode: "24h", dateFrom: null, dateTo: null },
      current: { mode: "24h", dateFrom: null, dateTo: null },
      power: { mode: "24h", dateFrom: null, dateTo: null }
    };
  }
  let siChartPeriods = defaultChartPeriods();
  let siFutureDetailIndex = null;
  let siHistoryDetailIndex = null;
  let siListFilter = "all";     // 'all' | 'connected' | 'pending' | 'offline'
  let siListPage = 1;
  const siListPageSize = 6;     // 2 baris x 3 kolom per halaman

  // ===========================================================
  // SEED DATA
  // ===========================================================
  function seedSystems() {
    // Data dummy (Zamdon, Sorotec, dst.) DIHAPUS atas permintaan —
    // System Information sekarang HANYA menampilkan data PLTS Tawabi
    // dari Core API (lihat loadTawabiSystemFromApi() di atas), tidak ada
    // lagi fallback dummy. Kalau API Tawabi gagal dimuat, halaman ini
    // akan tampil kosong (bukan dummy) sampai koneksi API pulih.
    return [];
  }

  // (genChartData24h/7d/Nd/ByDay dan genChartData() DIHAPUS -- dulu
  // dipakai buat 2 hal: (1) fallback fetch history yang sudah diganti
  // flatZeroSeries di atas, dan (2) tombol "Refresh Chart" manual +
  // chart awal system baru di wizard "Add System" di bawah, yang
  // sekarang keduanya cuma pakai objek chart kosong -- kalau memang
  // belum ada data, tampilkan kosong apa adanya, bukan angka acak.

  // FIX BUG (ReferenceError, penyebab System Information blank total):
  // baris ini dulu "window.__siGenChartData = genChartData;" -- tapi
  // genChartData() sudah DIHAPUS di atas. Assignment ke fungsi yang
  // tidak ada langsung throw ReferenceError SAAT SCRIPT DIMUAT (bukan
  // pas dipanggil), jadi seluruh sisa kode di bawahnya (render stat
  // card, daftar sistem, dst) ikut gagal jalan -- itu sebabnya halaman
  // System Information kelihatan kosong total, bukan cuma chart-nya.
  // window.__siGenChartData masih dipakai js/add-project.js (generate
  // chart kosong pas wizard "Add Project" bikin system baru), jadi
  // tetap di-expose di sini, tapi sekarang wrapper ke flatZeroSeries
  // (garis datar 0) supaya konsisten sama fix chart lain, BUKAN
  // genChartData yang sudah dihapus.
  window.__siGenChartData = function () {
    return {
      today: flatZeroSeries(1),
      week: flatZeroSeries(7),
      month: flatZeroSeries(30)
    };
  };

  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 9);
  }

  function esc(str) {
    if (str === undefined || str === null || str === "") return "-";
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtDate(d) {
    if (!d || d === "-") return "-";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }

  // ===========================================================
  // INIT (dipanggil main.js setiap halaman ini dimuat)
  //
  // Async: fetch ke server dilakukan SEKALI PER PROYEK per sesi
  // (di-cache di window.__siLoadedProjectIds) -- tiap proyek Core API
  // (Tawabi, Kasdam, dst) di-fetch & di-cache sendiri-sendiri saat
  // PERTAMA KALI proyek itu jadi proyek aktif; pindah balik ke proyek
  // yang sudah pernah dimuat TIDAK fetch ulang, langsung pakai cache
  // di window.__siSystems.
  // ===========================================================
  // Loader bersama, dipanggil dari halaman System Information SENDIRI
  // maupun dari Task Management / Task Maintenance (lewat
  // window.__siEnsureSystemsLoaded) supaya data proyek yang SEDANG
  // AKTIF selalu tersedia di window.__siSystems walaupun user membuka
  // Task Management/Task Maintenance duluan tanpa pernah membuka
  // halaman System Information di sesi itu.
  //
  // Sebelumnya loader ini SELALU memuat Tawabi doang, apapun proyek
  // aktifnya -- sekarang ikut window.PC_getActiveProject() supaya
  // pindah proyek (mis. dari PLTS Tawabi ke PLTS Kasdam via Project
  // Selector/Project Overview) benar-benar memanggil data proyek itu,
  // bukan nyangkut di data Tawabi terus. Fetch ke mini-backend
  // (server/server.js, endpoint /api/systems) tetap TIDAK dipanggil
  // di sini seperti sebelumnya (lihat loadSystemsFromServer() /
  // mergeUserSystems() di atas, dibiarkan hidup tapi tidak dipakai).
  window.__siLoadedProjectIds = window.__siLoadedProjectIds || new Set();

  // Cache validasi per user (di-reset otomatis tiap kali halaman ini
  // di-load ulang beneran -- login/logout SELALU full page reload, lihat
  // logout-modal.js -> window.location.replace()). Cuma buat hindari
  // nembak /projects berkali-kali dalam 1 sesi/tab yang sama.
  let siValidatedForUserId = undefined;

  // Resolve project id mana yang harus dimuat SEKARANG.
  //
  // Sebelumnya: kalau belum ada "proyek aktif" tersimpan di localStorage
  // (edash-active-project -- lihat project-context.js), kode ini SELALU
  // nebak fallback ke "tawabi", apapun proyek staff yang lagi login.
  // Itu salah kalau staff-nya BUKAN staff Tawabi (mis. staff Kasdam yang
  // login langsung tanpa pernah lewat Project Selector): backend
  // (ProjectService.getById -> scopedProjectIds) sengaja menolak dengan
  // 404 PROJECT_NOT_FOUND kalau project yang diminta tidak ada di
  // user_project_access staff itu, jadi Task Management & Task
  // Maintenance staff itu jadi kosong/gagal total.
  //
  // "edash-active-project" di localStorage ini juga TIDAK per-akun --
  // begitu Operator/Staff A memilih/dapat project X, nilai itu nyangkut
  // di browser biarpun kemudian LOGIN SEBAGAI AKUN LAIN (mis. Staff B
  // yang project-nya beda) -- gejalanya jadi "staff pertama yang dites
  // benar, staff kedua di browser yang sama malah 0/kosong", karena
  // versi pertama fix ini cuma cek "ada active project tersimpan atau
  // enggak", TANPA VALIDASI project itu masih punya USER YANG LAGI LOGIN
  // SEKARANG atau bukan.
  //
  // Sekarang: SETIAP kali user baru (userId beda dari validasi
  // terakhir), validasi ulang lewat GET /projects -- endpoint itu SUDAH
  // otomatis ke-scope ke project yang di-assign ke user yang sedang
  // login (lihat ProjectService.list/scopedProjectIds di edashboard_api,
  // staff selalu dapat persis 1 project miliknya sendiri, operator/root
  // bisa lebih). Kalau proyek aktif yang tersimpan SEKARANG masih ada di
  // daftar itu, PERTAHANKAN (supaya operator dengan >1 project yang
  // sudah pilih manual tidak ke-reset tiap buka halaman). Kalau TIDAK
  // (nyangkut dari akun lain, atau project itu sudah dicabut), timpa
  // dengan project pertama milik user ini. Pola ini SAMA PERSIS dengan
  // opdApplyResolvedProjects() di js/operator/operator-dashboard.js,
  // cuma sumber datanya GET /projects (bukan GET /admin/users/:id/projects
  // yang butuh permission adminview.access dan staff biasa belum tentu
  // punya).
  async function resolveActiveProjectId() {
    const userId = (typeof sessionStorage !== "undefined") ? sessionStorage.getItem("edash-user-id") : null;
    let active = (typeof window.PC_getActiveProject === "function") ? window.PC_getActiveProject() : null;

    if (siValidatedForUserId !== userId) {
      try {
        const myProjects = await window.edashApiFetch("/projects");
        const list = myProjects || [];
        const stillValid = active && list.some((p) => p.id === active.id);

        if (!stillValid) {
          const mine = list[0];
          if (mine && mine.id) {
            active = {
              id: mine.id,
              name: mine.project_name || mine.projectName || mine.name || mine.id,
              category: null,
            };
            if (typeof window.PC_setActiveProject === "function") window.PC_setActiveProject(active);
          } else {
            // User ini tidak (lagi) punya akses project APAPUN -- jangan
            // pertahankan project nyangkut milik user lain.
            active = null;
          }
        }
        siValidatedForUserId = userId;
      } catch (e) {
        console.warn("[system-information] Gagal validasi proyek aktif dari /projects:", e.message);
        // Gagal total (mis. offline) -- JANGAN tandai tervalidasi, supaya
        // pemanggilan berikutnya coba lagi, tapi tetap lanjut pakai apa
        // yang ada sekarang dulu biar halaman tidak nge-hang.
      }
    }

    const resolvedId = active ? active.id : "tawabi";
    window.__siActiveProjectId = resolvedId;
    return resolvedId;
  }

  // Diekspos supaya halaman lain yang punya pola fallback sejenis (mis.
  // battery-station.js) bisa pakai resolver yang SAMA, bukan duplikat
  // logic-nya sendiri-sendiri (yang dulu jadi sumber bug: tiap halaman
  // nebak "tawabi" secara independen).
  window.__siResolveActiveProjectId = resolveActiveProjectId;

  window.__siEnsureActiveProjectSystemsLoaded = async function () {
    const targetId = await resolveActiveProjectId();

    if (!window.__siLoadedProjectIds.has(targetId)) {
      const newSystems = await loadSystemsForProject(targetId);
      const existingIds = new Set(window.__siSystems.map((s) => s.id));
      // unshift satu-satu (bukan spread di depan) supaya urutan
      // Grup 1, Grup 2, dst tetap sesuai urutan dari API.
      for (let i = newSystems.length - 1; i >= 0; i--) {
        if (!existingIds.has(newSystems[i].id)) window.__siSystems.unshift(newSystems[i]);
      }
      ensureMaintenanceIds(window.__siSystems);
      window.__siLoadedProjectIds.add(targetId);
      window.__siSystemsLoaded = true; // dipertahankan: beberapa kode lama masih baca flag ini
    }
    return window.__siSystems;
  };

  // Nama lama dipertahankan (dipanggil dari task-management.js &
  // task-maintenance.js) -- sekarang otomatis project-aware.
  window.__siEnsureSystemsLoaded = window.__siEnsureActiveProjectSystemsLoaded;

  window.initSystemInformation = async function () {

    siActiveSystemId = null;
    siListFilter = "all";
    siListPage = 1;

    const targetId = await resolveActiveProjectId();

    if (!window.__siLoadedProjectIds.has(targetId)) {
      const loadingContainer = document.getElementById("pmPanel-system") || document.getElementById("siSystemGrid")?.parentElement;
      if (window.EdashLoadingBar) window.EdashLoadingBar.show(loadingContainer, "system-information", "loading.system");
      await window.__siEnsureActiveProjectSystemsLoaded();
      if (window.EdashLoadingBar) window.EdashLoadingBar.done(loadingContainer, "system-information");
    } else {
      await window.__siEnsureActiveProjectSystemsLoaded();
    }

    ensureChartJsLoaded();

    renderSystemGrid();
    bindListEvents();
    // bindWizardEvents(), bindWizardConditionalFields(), bindEditModalEvents(),
    // dan bindDeleteConfirmEvents() DIHAPUS -- fungsinya sudah tidak ada
    // (dihapus bersama fitur Add/Edit/Delete System). Halaman ini sekarang
    // murni read-only cerminan device dari Core API.
    bindScheduleModalEvents();
    bindDetailModalEvents();
    bindZoomModalEvents();

    showListView();

    siStartLiveRefresh();
  };

  // Refresh ringan — dipanggil setiap kali "proyek aktif" GLOBAL
  // berubah (mis. user ganti proyek lewat dropdown/pencarian di tab
  // Project Overview — lihat js/project-detail.js -> PC_setActiveProject),
  // supaya tab System Information ini ikut pindah proyek juga tanpa
  // perlu pindah-balik tab / reload halaman dulu. Kalau proyek yang
  // baru dipilih BELUM pernah dimuat di sesi ini, tampilkan loading
  // state sebentar sambil __siEnsureActiveProjectSystemsLoaded()
  // fetch data proyek itu -- baru render begitu selesai.
  window.__siRefresh = async function () {
    const grid = document.getElementById("siSystemGrid");
    if (!grid) return; // tab belum pernah dibuka
    siActiveSystemId = null;
    siListPage = 1;

    // Event edash:activeprojectchange ini SELALU dispatch dengan proyek
    // yang sudah pasti ada (lihat PC_setActiveProject()), jadi resolve
    // di sini normalnya langsung balik dari cache tanpa fetch tambahan --
    // dipertahankan pakai resolveActiveProjectId() supaya konsisten satu
    // sumber kebenaran dengan __siEnsureActiveProjectSystemsLoaded().
    const targetId = await resolveActiveProjectId();

    if (window.__siLoadedProjectIds.has(targetId)) {
      showListView();
      renderSystemGrid();
      return;
    }

    const loadingContainer = document.getElementById("pmPanel-system") || grid.parentElement;
    if (window.EdashLoadingBar) window.EdashLoadingBar.show(loadingContainer, "system-information", "loading.system");
    window.__siEnsureActiveProjectSystemsLoaded().then(() => {
      showListView();
      renderSystemGrid();
      if (window.EdashLoadingBar) window.EdashLoadingBar.done(loadingContainer, "system-information");
    });
  };

  document.addEventListener("edash:activeprojectchange", () => {
    if (typeof window.__siRefresh === "function") window.__siRefresh();
  });

  // ===========================================================
  // Chart.js loader (aman dipanggil berkali-kali; hanya inject
  // <script> sekali jika window.Chart belum tersedia dari halaman)
  // ===========================================================
  function ensureChartJsLoaded(onReady) {
    if (typeof Chart !== "undefined") {
      if (onReady) onReady();
      return;
    }
    if (window.__siChartJsLoading) {
      if (onReady) window.__siChartJsCallbacks.push(onReady);
      return;
    }
    window.__siChartJsLoading = true;
    window.__siChartJsCallbacks = onReady ? [onReady] : [];

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js";
    script.onload = () => {
      window.__siChartJsLoading = false;
      // Render ulang chart di system yang sedang aktif (jika ada)
      const sys = getSystem(siActiveSystemId);
      if (sys) renderCharts(sys);
      (window.__siChartJsCallbacks || []).forEach((cb) => { try { cb(); } catch (e) {} });
      window.__siChartJsCallbacks = [];
    };
    document.head.appendChild(script);
  }

  // ===========================================================
  // VIEW SWITCHING
  // ===========================================================
  function showListView() {
    document.getElementById("siListView").classList.add("is-active");
    document.getElementById("siDetailView").classList.remove("is-active");
  }

  function showDetailView(systemId) {
    siActiveSystemId = systemId;
    // Render duluan pakai data yang sudah ada -- System/Inverter/PV
    // Panel Overview & telemetry/latest sudah tersedia semua dari list
    // load. Cuma grafik (history) yang untuk sementara tampil kosong
    // sambil di-lazy-load di bawah (lihat ensureTawabiChartData).
    renderDetail(systemId);
    document.getElementById("siListView").classList.remove("is-active");
    document.getElementById("siDetailView").classList.add("is-active");

    const sys = getSystem(systemId);
    if (!sys) return;

    if (sys.chart && !sys.chart.loaded) {
      chartLoadingSetVisible(true);
      ensureTawabiChartData(sys).then(() => {
        chartLoadingSetVisible(false);
        // Guard: kalau user sudah keburu pindah ke system lain sebelum
        // fetch ini selesai, JANGAN timpa tampilan yang sedang aktif
        // sekarang dengan data system yang lama.
        if (siActiveSystemId === systemId) renderCharts(sys);
      });
    }
  }

  // Kasih indikator kecil "Memuat grafik..." di tiap chart card selagi
  // history sedang di-lazy-load (lihat showDetailView), supaya user
  // tahu grafiknya masih nyusul, bukan dikira kosong/error.
  function chartLoadingSetVisible(visible) {
    document.querySelectorAll(".si-chart-card .si-chart-wrap").forEach((wrap) => {
      wrap.classList.toggle("si-chart-loading", visible);
    });
  }

  // ===========================================================
  // LIST VIEW
  // ===========================================================
  function statusBadge(status) {
    const map = {
      connected: { cls: "si-badge-connected", label: "Connected" },
      pending: { cls: "si-badge-pending", label: "Pending" },
      offline: { cls: "si-badge-offline", label: "Offline" }
    };
    return map[status] || map.offline;
  }

  // ---------- Stats row ----------
  function renderStatsRow() {
    const row = document.getElementById("siStatsRow");
    if (!row) return;
    const systems = siProjectScopedSystems();
    const total = systems.length;
    const connected = systems.filter((s) => s.status === "connected").length;
    // Kartu ke-3 nunjukin Offline (bukan Pending) — soalnya di data
    // real, device yang belum lama kirim data itu langsung offline
    // (bukan pending), jadi angka Total/Connected/Pending dulu bisa
    // kelihatan "2 total tapi 0+0" dan bikin bingung. Status "pending"
    // sendiri tetap ada (dipakai pas system baru ditambahkan / belum
    // pernah connect), cuma filter dropdown di list view yang masih
    // punya opsi Pending — kartu ringkasan ini fokus ke Offline karena
    // itu yang paling sering kejadian & paling perlu diperhatikan.
    const offline = systems.filter((s) => s.status === "offline").length;

    row.innerHTML = `
      <div class="si-stat-card">
        <div class="si-stat-icon si-stat-icon-total"><i class="fa-solid fa-server"></i></div>
        <div>
          <div class="si-stat-value">${total}</div>
          <div class="si-stat-label">Total Devices</div>
        </div>
      </div>
      <div class="si-stat-card">
        <div class="si-stat-icon si-stat-icon-connected"><i class="fa-solid fa-plug-circle-check"></i></div>
        <div>
          <div class="si-stat-value si-stat-connected">${connected}</div>
          <div class="si-stat-label">Connected</div>
        </div>
      </div>
      <div class="si-stat-card">
        <div class="si-stat-icon si-stat-icon-offline"><i class="fa-solid fa-plug-circle-xmark"></i></div>
        <div>
          <div class="si-stat-value si-stat-offline">${offline}</div>
          <div class="si-stat-label">Offline</div>
        </div>
      </div>`;
  }

  // ---------- Filtering + pagination ----------
  function getFilteredSystems() {
    const systems = siProjectScopedSystems();
    if (siListFilter === "all") return systems;
    return systems.filter((s) => s.status === siListFilter);
  }

  function renderSystemGrid() {
    const grid = document.getElementById("siSystemGrid");
    const empty = document.getElementById("siEmptyState");
    const pagination = document.getElementById("siPagination");
    const systems = siProjectScopedSystems();

    renderStatsRow();

    if (!systems.length) {
      grid.innerHTML = "";
      empty.style.display = "block";
      document.getElementById("siEmptyTitle").textContent = "Belum ada system";
      document.getElementById("siEmptyDesc").textContent = 'Klik "Add System" untuk menambahkan system PLTS pertama Anda.';
      if (pagination) pagination.innerHTML = "";
      return;
    }

    const filtered = getFilteredSystems();

    if (!filtered.length) {
      grid.innerHTML = "";
      empty.style.display = "block";
      document.getElementById("siEmptyTitle").textContent = "Tidak ada hasil";
      document.getElementById("siEmptyDesc").textContent = "Tidak ada system yang cocok dengan filter ini.";
      if (pagination) pagination.innerHTML = "";
      return;
    }
    empty.style.display = "none";

    const totalPages = Math.max(1, Math.ceil(filtered.length / siListPageSize));
    if (siListPage > totalPages) siListPage = totalPages;
    if (siListPage < 1) siListPage = 1;

    const startIdx = (siListPage - 1) * siListPageSize;
    const pageItems = filtered.slice(startIdx, startIdx + siListPageSize);

    grid.innerHTML = pageItems.map((sys) => {
      const b = statusBadge(sys.status);
      return `
        <div class="si-sys-card" data-system-id="${sys.id}">
          <div class="si-sys-card-top">
            <div class="si-sys-card-id">
              <div class="si-sys-icon"><i class="fa-solid fa-solar-panel"></i></div>
              <div style="min-width:0;">
                <div class="si-sys-name">${esc(sys.basic.systemName)}</div>
                <div class="si-sys-sub">${esc(sys.basic.inverterBrand)}</div>
              </div>
            </div>
            <div class="si-sys-card-top-actions">
              <!-- Tombol hapus per-kartu DIHAPUS -- CRUD system (Add/Edit/
                   Delete) sudah tidak dipakai, halaman ini sekarang murni
                   read-only cerminan device dari Core API. -->
              <span class="si-badge ${b.cls}">${b.label}</span>
            </div>
          </div>
          <div class="si-sys-card-meta">
            <div class="si-sys-meta-row"><span>Peak Power</span><span>${esc(sys.systemOverview.peakPowerKwp)}${sys.systemOverview.peakPowerKwp && sys.systemOverview.peakPowerKwp !== "-" ? " kWp" : ""}</span></div>
            <div class="si-sys-meta-row"><span>Address</span><span>${esc(sys.systemOverview.address)}</span></div>
          </div>
          <div class="si-sys-card-foot">
            <span>View details</span>
            <i class="fa-solid fa-arrow-right"></i>
          </div>
        </div>`;
    }).join("");

    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    const wrap = document.getElementById("siPagination");
    if (!wrap) return;

    if (totalPages <= 1) {
      wrap.innerHTML = "";
      return;
    }

    const page = siListPage;
    let pageNums = [];
    const addNum = (n) => { if (!pageNums.includes(n) && n >= 1 && n <= totalPages) pageNums.push(n); };
    addNum(1);
    addNum(totalPages);
    addNum(page - 1);
    addNum(page);
    addNum(page + 1);
    pageNums = pageNums.sort((a, b) => a - b);

    let html = `<button class="si-page-btn" data-page="${page - 1}" ${page === 1 ? "disabled" : ""} aria-label="Sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>`;
    let prev = 0;
    pageNums.forEach((n) => {
      if (prev && n - prev > 1) html += `<span class="si-page-ellipsis">…</span>`;
      html += `<button class="si-page-btn ${n === page ? "is-active" : ""}" data-page="${n}">${n}</button>`;
      prev = n;
    });
    html += `<button class="si-page-btn" data-page="${page + 1}" ${page === totalPages ? "disabled" : ""} aria-label="Berikutnya"><i class="fa-solid fa-chevron-right"></i></button>`;

    wrap.innerHTML = html;

    wrap.querySelectorAll(".si-page-btn").forEach((btn) => {
      btn.onclick = () => {
        const n = parseInt(btn.getAttribute("data-page"), 10);
        if (!n || n < 1 || n > totalPages || n === siListPage) return;
        siListPage = n;
        renderSystemGrid();
      };
    });
  }

  function bindListEvents() {
    // Tombol "Add System" (siAddSystemBtn) & openWizard() DIHAPUS bersama
    // fitur Add/Edit/Delete system -- lihat catatan di bagian atas file.

    // Event delegation supaya tidak perlu rebind tiap render ulang grid.
    // Tombol hapus per-kartu (.si-card-delete-btn) DIHAPUS -- sekarang
    // klik kartu cuma buka detail view, tidak ada aksi delete lagi.
    const grid = document.getElementById("siSystemGrid");
    grid.onclick = (e) => {
      const card = e.target.closest(".si-sys-card");
      if (card) showDetailView(card.getAttribute("data-system-id"));
    };

    const filterSelect = document.getElementById("siStatusFilter");
    if (filterSelect) {
      filterSelect.value = siListFilter;
      filterSelect.onchange = () => {
        siListFilter = filterSelect.value;
        siListPage = 1;
        renderSystemGrid();
      };
    }

    document.getElementById("siBackBtn").onclick = () => {
      renderSystemGrid();
      showListView();
    };
  }

  // (Fungsi DELETE SYSTEM -- openDeleteConfirm/closeDeleteConfirm/
  // confirmDeleteSystem/bindDeleteConfirmEvents -- DIHAPUS seluruhnya
  // bersama modal siDeleteConfirmOverlay di HTML. Halaman ini sekarang
  // murni read-only cerminan device dari Core API, tidak ada lagi cara
  // menghapus system dari sini.)

  // ===========================================================
  // DETAIL VIEW
  // ===========================================================
  function getSystem(id) {
    return window.__siSystems.find((s) => s.id === id);
  }

  function dlRow(label, value, unit) {
    const v = (value === undefined || value === null || value === "") ? "-" : value;
    return `<div class="si-dl-row"><dt>${esc(label)}</dt><dd>${esc(v)}${(v !== "-" && unit) ? " " + unit : ""}</dd></div>`;
  }

  // Sama seperti overviewCard, tapi TANPA tombol edit -- dipakai buat
  // card yang isinya murni telemetry real-time hasil baca sensor
  // (Production Overview, Grid & Load), bukan master data yang
  // memang bisa/boleh diedit manual (System Overview dkk).
  function realtimeCard(opts) {
    // opts: { eyebrow, title, section, rows: [[label,value,unit]] }
    // section (opsional) -> dipakai siRefreshDetailLiveCards() (live
    // polling) buat cari & timpa HANYA card ini pas ada telemetry baru,
    // tanpa perlu render ulang siCardsRow semuanya (lihat blok LIVE
    // TELEMETRY POLLING di bawah).
    return `
      <div class="si-card" data-zoom-type="generic" data-si-section="${esc(opts.section || "")}">
        <div class="si-card-head">
          <div class="si-card-head-text">
            <div class="si-card-eyebrow">${esc(opts.eyebrow)}</div>
            <h3>${esc(opts.title)}</h3>
          </div>
        </div>
        <dl class="si-dl">
          ${opts.rows.map(r => dlRow(r[0], r[1], r[2])).join("")}
        </dl>
      </div>`;
  }

  // Diekstrak dari renderDetail() (sebelumnya inline overviewCard({...}))
  // supaya bisa dipanggil ulang persis sama oleh siRefreshDetailLiveCards()
  // (live polling, lihat blok LIVE TELEMETRY POLLING di bawah) tanpa
  // duplikasi definisi rows-nya di 2 tempat.
  function systemOverviewCard(sys) {
    return overviewCard({
      eyebrow: "Summary", title: "System Overview", section: "systemOverview",
      rows: [
        ["Installed Date", fmtDate(sys.systemOverview.installedDate)],
        ["Last Updated", fmtDate(sys.systemOverview.lastUpdated)],
        ["Peak Power", sys.systemOverview.peakPowerKwp, sys.systemOverview.peakPowerKwp !== "-" ? "kWp" : ""],
        ["Address", sys.systemOverview.address]
      ]
    });
  }

  function inverterOverviewCard(sys) {
    return overviewCard({
      eyebrow: sys.basic.inverterBrand, title: "Inverter Overview", section: "inverterOverview",
      rows: [
        ["Device ID", sys.inverterOverview.deviceId],
        ["Device Serial Number", sys.inverterOverview.deviceSn],
        ["Provider", sys.inverterOverview.provider],
        ["Type", sys.inverterOverview.inverterType],
        ["Maximum Output", sys.inverterOverview.maximumOutputKw, sys.inverterOverview.maximumOutputKw !== "-" ? "kW" : ""],
        ["Communication Protocol", sys.inverterOverview.communicationProtocol],
        ["Inverter Temperature", sys.inverterOverview.inverterTemperatureC, sys.inverterOverview.inverterTemperatureC !== "-" ? "°C" : ""],
        ["Radiator Temperature", sys.inverterOverview.radiatorTemperatureC, sys.inverterOverview.radiatorTemperatureC !== "-" ? "°C" : ""],
        ["Installation Date", fmtDate(sys.inverterOverview.installationDate)],
        ["Last Maintenance", fmtDate(sys.inverterOverview.lastMaintenance)],
        ["Next Maintenance", fmtDate(sys.inverterOverview.nextMaintenance)],
        ["Maintenance Status", computeMaintenanceStatus(sys.inverterOverview.nextMaintenance)]
      ]
    });
  }

  function productionOverviewCard(sys) {
    const p = sys.productionOverview || {};
    return realtimeCard({
      eyebrow: "Realtime", title: "Production Overview", section: "productionOverview",
      rows: [
        ["Current Power", p.currentPowerW, p.currentPowerW !== "-" ? "W" : ""],
        ["PV Total Power", p.pvTotalPowerW, p.pvTotalPowerW !== "-" ? "W" : ""],
        ["Energy Today", p.energyTodayKwh, p.energyTodayKwh !== "-" ? "kWh" : ""],
        ["Energy Total", p.energyTotalKwh, p.energyTotalKwh !== "-" ? "kWh" : ""],
        ["Efficiency", p.efficiencyPct, p.efficiencyPct !== "-" ? "%" : ""]
      ]
    });
  }


  function pvStringsCard(sys) {
    const strings = sys.pvStrings || [];
    const rows = strings.map((s) => `
      <tr>
        <td>${esc(s.label)}</td>
        <td>${s.voltage != null ? esc(s.voltage) + " V" : "-"}</td>
        <td>${s.current != null ? esc(s.current) + " A" : "-"}</td>
        <td>${s.power != null ? esc(s.power) + " W" : "-"}</td>
      </tr>`).join("");

    return `
      <div class="si-card" data-zoom-type="generic" data-si-section="pvStrings">
        <div class="si-card-head">
          <div class="si-card-head-text">
            <div class="si-card-eyebrow">Realtime</div>
            <h3>PV Strings</h3>
          </div>
        </div>
        <div class="si-table-wrap">
          <table class="si-table">
            <thead><tr><th>String</th><th>Voltage</th><th>Current</th><th>Power</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4" class="si-table-empty">Tidak ada data string PV.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  }

  function gridLoadCard(sys) {
    const g = sys.gridLoad || {};
    return realtimeCard({
      eyebrow: "Realtime", title: "Grid & Load", section: "gridLoad",
      rows: [
        ["Grid Power", g.gridPowerW, g.gridPowerW !== "-" ? "W" : ""],
        ["Daily Feed-in", g.dailyFeedInKwh, g.dailyFeedInKwh !== "-" ? "kWh" : ""],
        ["Total Feed-in", g.totalFeedInKwh, g.totalFeedInKwh !== "-" ? "kWh" : ""],
        ["Daily Purchased", g.dailyPurchasedKwh, g.dailyPurchasedKwh !== "-" ? "kWh" : ""],
        ["Total Purchased", g.totalPurchasedKwh, g.totalPurchasedKwh !== "-" ? "kWh" : ""],
        ["Load Power", g.loadPowerW, g.loadPowerW !== "-" ? "W" : ""],
        ["Daily Consumption", g.dailyConsumptionKwh, g.dailyConsumptionKwh !== "-" ? "kWh" : ""],
        ["Total Consumption", g.totalConsumptionKwh, g.totalConsumptionKwh !== "-" ? "kWh" : ""]
      ]
    });
  }

  function overviewCard(opts) {
    // opts: { eyebrow, title, section, rows: [[label,value,unit]] }
    // Tombol edit pencil DIHAPUS bersama fitur Edit lainnya -- head
    // sekarang cuma teks judul, tidak ada aksi apa-apa.
    // section -> lihat catatan data-si-section di realtimeCard() di atas.
    return `
      <div class="si-card" data-zoom-type="generic" data-si-section="${esc(opts.section || "")}">
        <div class="si-card-head">
          <div class="si-card-head-text">
            <div class="si-card-eyebrow">${esc(opts.eyebrow)}</div>
            <h3>${esc(opts.title)}</h3>
          </div>
        </div>
        <dl class="si-dl">
          ${opts.rows.map(r => dlRow(r[0], r[1], r[2])).join("")}
        </dl>
      </div>`;
  }

  function deviceCard(sys) {
    const d = sys.deviceOverview;
    return `
      <div class="si-card" data-zoom-type="generic" data-si-section="deviceOverview">
        <div class="si-card-head">
          <div class="si-card-head-text">
            <div class="si-card-eyebrow">Hardware</div>
            <h3>Device / Logger</h3>
          </div>
        </div>
        <div class="si-device-row">
          <div class="si-device-icon"><i class="fa-solid fa-microchip"></i></div>
          <dl class="si-dl" style="flex:1;">
            ${dlRow("Firmware", d.firmware)}
            ${dlRow("Modbus Status", d.modbusStatus)}
            ${dlRow("Uptime", d.uptimeSeconds, d.uptimeSeconds !== "-" ? "detik" : "")}
            ${dlRow("Last Seen", d.lastSeen)}
            ${dlRow("Ambient Temperature", d.ambientTemperatureC, d.ambientTemperatureC !== "-" ? "°C" : "")}
            ${dlRow("Humidity", d.humidityPct, d.humidityPct !== "-" ? "%" : "")}
            ${dlRow("Fan Relay", d.fanRelay)}
            ${dlRow("Alarm Register Status", d.alarmRegisterStatus)}
          </dl>
        </div>
      </div>`;
  }

  // Status maintenance dihitung otomatis dari nextMaintenance (BUKAN
  // field yang diisi manual) — sesuai kontrak "maintenanceStatus" di
  // section Inverter/PV maintenance, statusnya derived, bukan input.
  function computeMaintenanceStatus(nextMaintenance) {
    if (!nextMaintenance || nextMaintenance === "-") return "-";
    const next = new Date(nextMaintenance);
    if (isNaN(next.getTime())) return "-";
    const diffDays = Math.ceil((next - new Date()) / 86400000);
    if (diffDays < 0) return "Overdue";
    if (diffDays <= 30) return "Due Soon";
    return "OK";
  }

  function chartCard(id, title, color, unit, canvasId, range) {
    const minD = (range && range.firstDate) || "";
    const maxD = (range && range.lastDate) || "";
    return `
      <div class="si-card si-chart-card" data-zoom-type="chart" data-zoom-chart-key="${id}">
        <div class="si-card-head si-chart-card-head">
          <div class="si-card-head-text">
            <div class="si-card-eyebrow">Monitoring</div>
            <h3>${esc(title)}</h3>
          </div>
          <div class="si-chart-head-actions">
            <div class="si-chart-toggle" data-chart-key="${id}">
              <button type="button" class="is-active" data-period="24h">24 Jam</button>
              <button type="button" data-period="7d">7 Hari</button>
              <button type="button" data-period="30d">30 Hari</button>
              <button type="button" data-period="custom" title="Pilih rentang tanggal sendiri"><i class="fa-solid fa-calendar-days"></i> Custom</button>
            </div>
            <!-- Tombol refresh chart manual DIHAPUS dari tampilan --
                 sebelumnya cuma di-disable ("Belum tersedia — monitoring
                 belum realtime"), sekarang dihilangkan sepenuhnya karena
                 memang tidak ada fungsinya (monitoring belum realtime,
                 lihat catatan bindDetailEvents() di bawah). -->
          </div>
        </div>
        <div class="si-chart-daterange" data-chart-key="${id}" style="display:none;">
          <div class="si-chart-daterange-field">
            <label>Dari</label>
            <input type="date" class="si-chart-date-from" data-chart-key="${id}" min="${minD}" max="${maxD}" value="${maxD}">
          </div>
          <div class="si-chart-daterange-field">
            <label>Sampai</label>
            <input type="date" class="si-chart-date-to" data-chart-key="${id}" min="${minD}" max="${maxD}" value="${maxD}">
          </div>
        </div>
        <div class="si-chart-stats" data-chart-stats="${id}"></div>
        <div class="si-chart-wrap"><canvas id="${canvasId}"></canvas></div>
      </div>`;
  }

  // Ringkasan kecil (avg/peak/min) di atas tiap chart supaya angka
  // penting langsung kebaca tanpa hover ke titik data satu-satu —
  // ini yang bikin chart "informatif", bukan cuma gambar kurva.
  function computeChartStats(values, unit) {
    const nums = (values || []).filter((v) => typeof v === "number" && !isNaN(v));
    if (!nums.length) return "Tidak ada data pada rentang ini.";
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("id-ID");
    return `Rata-rata <b>${fmt(avg)}</b> ${unit} &nbsp;·&nbsp; Puncak <b>${fmt(max)}</b> ${unit} &nbsp;·&nbsp; Terendah <b>${fmt(min)}</b> ${unit}`;
  }

  function fmtIdDate(dateStr) {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }

  function periodLabel(period) {
    if (period.mode === "24h") return "24 jam terakhir";
    if (period.mode === "7d") return "7 hari terakhir";
    if (period.mode === "30d") return "30 hari terakhir";
    if (period.mode === "custom" && period.dateFrom && period.dateTo) {
      if (period.dateFrom === period.dateTo) return fmtIdDate(period.dateFrom);
      return `${fmtIdDate(period.dateFrom)} – ${fmtIdDate(period.dateTo)}`;
    }
    return "";
  }

  function healthCard(health) {
    const color = health >= 90 ? "var(--si-success)" : health >= 70 ? "var(--si-warning)" : "var(--si-danger)";
    const label = health >= 90 ? "Excellent" : health >= 70 ? "Fair" : health > 0 ? "Needs Attention" : "No Data";
    const deg = Math.max(0, Math.min(100, health)) * 3.6;
    return `
      <div class="si-card" data-zoom-type="generic" data-si-section="health">
        <div class="si-card-head" style="border-bottom:none;">
          <div class="si-card-head-text">
            <div class="si-card-eyebrow">Diagnostics</div>
            <h3>Solar Panel Health</h3>
          </div>
        </div>
        <div class="si-health-wrap">
          <div class="si-gauge" style="background:conic-gradient(${color} ${deg}deg, var(--si-page-bg) ${deg}deg);">
            <div class="si-gauge-inner">
              <b>${health > 0 ? health + "%" : "-"}</b>
              <span>HEALTH</span>
            </div>
          </div>
          <div class="si-health-meta">
            <div class="si-health-label" style="color:${color};">${label}</div>
            <div class="si-health-desc">Estimasi kondisi panel berdasarkan output vs kapasitas terpasang.</div>
          </div>
        </div>
      </div>`;
  }

  function alarmCard(alarms) {
    const statusMap = {
      resolved: { cls: "si-badge-connected", label: "Resolved" },
      warning: { cls: "si-badge-pending", label: "Warning" },
      active: { cls: "si-badge-offline", label: "Active" },
      info: { cls: "si-badge-info", label: "Info" }
    };
    const rows = alarms.length
      ? alarms.map(a => {
          const s = statusMap[a.status] || statusMap.info;
          return `<tr><td>${esc(a.time)}</td><td>${esc(a.description)}</td><td><span class="si-badge ${s.cls}">${s.label}</span></td></tr>`;
        }).join("")
      : `<tr><td colspan="3" class="si-table-empty">Tidak ada riwayat alarm.</td></tr>`;

    return `
      <div class="si-card" data-zoom-type="generic">
        <div class="si-card-head">
          <div class="si-card-head-text">
            <div class="si-card-eyebrow">Log</div>
            <h3>Alarm History</h3>
          </div>
          <button class="si-btn si-btn-secondary si-btn-sm si-alarm-viewdetail-btn" type="button">
            <span>View details</span>
            <i class="fa-solid fa-arrow-right"></i>
          </button>
        </div>
        <div class="si-table-wrap">
          <table class="si-table">
            <thead><tr><th>Time</th><th>Description</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // Navigasi ke halaman Alerts lewat sidebar SPA router (loadPage +
  // sinkronisasi active-state sidebar) — pola yang sama dipakai di
  // master/header/header.js (hdNavigateToNotifPage) waktu notifikasi
  // di bell diklik.
  //
  // NOTE: alert.js belum punya mekanisme filter per unit/system, jadi
  // tombol ini murni pindah ke halaman Alerts (belum bisa auto-filter
  // ke alert unit ini saja).
  function navigateToAlertsPage(systemId) {
    const page = "pages/alert.html";

    if (typeof window.loadPage !== "function") {
      window.location.href = page;
      return;
    }

    window.loadPage(page);

    // Sinkronkan active-state sidebar, sama seperti klik nav item
    // biasa (bukan cuma ganti isi #page-root).
    const dashboardBtn = document.getElementById("sbDashboardBtn");
    const navItems = document.querySelectorAll(".sb-nav-item");
    if (dashboardBtn) dashboardBtn.classList.remove("is-active");
    navItems.forEach((el) => el.classList.remove("is-active"));
    const matchingNavItem = Array.from(navItems).find((el) => el.getAttribute("data-page") === page);
    if (matchingNavItem) matchingNavItem.classList.add("is-active");
  }

  // ---------- Drag & drop reorder kartu ----------
  // Setiap grid (.si-cards-grid) bisa di-drag-drop urutan kartunya secara
  // independen per section (System/Inverter/PV Overview, Device/Voltage/
  // Current, Power/Temp/Health/Alarm, Production/PV Strings/Grid&Load).
  // Urutan disimpan ke localStorage per systemId+row supaya tetap sama
  // walau halaman di-refresh atau kartu di-render ulang (edit/wizard/dll).
  function siCardKey(cardEl) {
    const h3 = cardEl.querySelector(".si-card-head h3, summary h3");
    if (h3) return h3.textContent.trim();
    return cardEl.getAttribute("data-zoom-chart-key") || "";
  }

  function siApplySavedCardOrder(container, storageKey) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); }
    catch (e) { saved = null; }
    if (!saved || !Array.isArray(saved) || !saved.length) return;

    const children = Array.from(container.children).filter(c => c.classList.contains("si-card"));
    const byKey = new Map(children.map(c => [siCardKey(c), c]));
    const ordered = [];
    saved.forEach((k) => {
      if (byKey.has(k)) { ordered.push(byKey.get(k)); byKey.delete(k); }
    });
    // Kartu baru yang belum ada di urutan tersimpan (misal fitur baru
    // ditambahkan setelah user terakhir ngatur urutan) ditaruh di akhir,
    // urutan aslinya dipertahankan.
    children.forEach((c) => { if (byKey.has(siCardKey(c))) ordered.push(c); });
    ordered.forEach((c) => container.appendChild(c));
  }

  function siMakeCardsSortable(container, storageKey) {
    let dragEl = null;

    function persistOrder() {
      const order = Array.from(container.children)
        .filter(c => c.classList.contains("si-card"))
        .map(siCardKey);
      try { localStorage.setItem(storageKey, JSON.stringify(order)); } catch (e) { /* abaikan kalau storage penuh/diblokir */ }
    }

    Array.from(container.children).forEach((card) => {
      if (!card.classList.contains("si-card")) return;
      card.setAttribute("draggable", "true");
      card.classList.add("si-card-draggable");
      // Supaya tombol edit/toggle 24h-7d-30d/refresh/canvas chart di
      // dalam kartu tetap bisa diklik normal (drag cuma dari area
      // kosong/header kartu, bukan dari kontrol interaktifnya).
      card.querySelectorAll("button, a, input, select, textarea, canvas").forEach((el) => {
        el.setAttribute("draggable", "false");
      });

      card.addEventListener("dragstart", (e) => {
        dragEl = card;
        card.classList.add("si-card-dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", siCardKey(card)); } catch (err) {}
      });

      card.addEventListener("dragend", () => {
        card.classList.remove("si-card-dragging");
        container.querySelectorAll(".si-card-drop-before, .si-card-drop-after")
          .forEach(c => c.classList.remove("si-card-drop-before", "si-card-drop-after"));
        dragEl = null;
        persistOrder();
      });

      card.addEventListener("dragover", (e) => {
        if (!dragEl || dragEl === card) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = card.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        card.classList.toggle("si-card-drop-after", after);
        card.classList.toggle("si-card-drop-before", !after);
      });

      card.addEventListener("dragleave", () => {
        card.classList.remove("si-card-drop-before", "si-card-drop-after");
      });

      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("si-card-drop-before", "si-card-drop-after");
        if (!dragEl || dragEl === card) return;
        const rect = card.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        container.insertBefore(dragEl, after ? card.nextSibling : card);
      });
    });
  }

  // Dipanggil tiap habis nge-set innerHTML salah satu grid, supaya urutan
  // tersimpan langsung diterapkan lagi dan drag-drop-nya aktif ulang
  // (innerHTML baru = elemen baru, listener lama otomatis hilang).
  function siInitSortableRow(container, systemId, rowKey) {
    const storageKey = `si-card-order:${systemId}:${rowKey}`;
    siApplySavedCardOrder(container, storageKey);
    siMakeCardsSortable(container, storageKey);
  }

  function renderDetail(systemId) {
    const sys = getSystem(systemId);
    if (!sys) return;

    const b = statusBadge(sys.status);
    document.getElementById("siDetailName").textContent = sys.basic.systemName;
    document.getElementById("siDetailStatusBadge").className = "si-badge " + b.cls;
    document.getElementById("siDetailStatusBadge").textContent = b.label;
    document.getElementById("siDetailSub").textContent =
      `${sys.basic.inverterBrand} · ${sys.systemOverview.address || "-"}`;

    // Semua kartu digabung jadi SATU grid (#siCardsRow) supaya bisa
    // di-drag-drop bebas dari atas ke bawah -- sebelumnya dipecah jadi 4
    // grid terpisah (per "row"), tapi itu bikin kartu numpuk sendirian
    // dengan gap kosong di sampingnya kalau jumlah kartu dalam 1 section
    // tidak habis dibagi 3 (misal Row 3 isinya 4 kartu -> kartu ke-4
    // jadi sendirian di baris barunya). Digabung jadi 1 grid besar,
    // gap kayak gitu cuma bisa muncul di baris paling akhir halaman.
    const chartRange = (sys.chart && sys.chart.range) || null;
    document.getElementById("siCardsRow").innerHTML = [
      systemOverviewCard(sys),
      inverterOverviewCard(sys),
      overviewCard({
        eyebrow: "Panel", title: "PV Panel Overview", section: "pvPanelOverview",
        rows: pvPanelOverviewRows(sys)
      }),
      deviceCard(sys),
      chartCard("voltage", "Voltage Output", "orange", "V", "siChartVoltage", chartRange),
      chartCard("current", "Current Output", "red", "A", "siChartCurrent", chartRange),
      chartCard("power", "Power Output", "green", "kW", "siChartPower", chartRange),
      chartCard("temperature", "Inverter Temperature", "orange", "\u00b0C", "siChartTemperature", chartRange),
      healthCard(sys.health),
      alarmCard(sys.alarmHistory),
      productionOverviewCard(sys),
      pvStringsCard(sys),
      gridLoadCard(sys),
      chartCard("gridPower", "Grid Power (Ekspor/Impor)", "blue", "W", "siChartGridPower", chartRange),
      chartCard("loadPower", "Load Power (Konsumsi)", "red", "W", "siChartLoadPower", chartRange)
    ].join("");
    siInitSortableRow(document.getElementById("siCardsRow"), systemId, "all");

    siChartPeriods = defaultChartPeriods();
    renderCharts(sys);
    bindChartToggleEvents(sys);
    renderFutureMaintenance(sys);
    renderHistoricalMaintenance(sys);
    bindDetailEvents(sys);
  }

  // ---------- Charts (Chart.js) ----------
  const chartSpecs = [
    { canvas: "siChartVoltage", key: "voltage", color: "#E3A21A", unit: "V", label: "Voltage" },
    { canvas: "siChartCurrent", key: "current", color: "#D64545", unit: "A", label: "Current" },
    { canvas: "siChartPower", key: "power", color: "#2F9E6E", unit: "kW", label: "Power" },
    { canvas: "siChartTemperature", key: "temperature", color: "#E36A1A", unit: "\u00b0C", label: "Inverter Temperature" },
    { canvas: "siChartGridPower", key: "gridPower", color: "#2F6FE3", unit: "W", label: "Grid Power" },
    { canvas: "siChartLoadPower", key: "loadPower", color: "#D64545", unit: "W", label: "Load Power" }
  ];

  // Judul tooltip saat hover: tanggal per titik data. dataset.labels
  // untuk periode harian (7d/30d/custom) berisi tanggal per hari
  // ("Thu 09 Jul", dst); untuk 24 jam berisi jam ("00:00", dst) —
  // dua-duanya sudah cukup jelas dipakai langsung sebagai judul.
  function chartTooltipTitle(period, dataset) {
    return (items) => {
      const idx = items[0].dataIndex;
      const raw = dataset.labels[idx];
      if (period.mode === "24h") return `Jam ${raw}`;
      return raw; // "Thu 09 Jul" dkk sudah human-readable
    };
  }

  function chartTooltipLabel(spec) {
    return (item) => `${spec.label}: ${item.formattedValue} ${spec.unit}`;
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Tipe visual grafik ditentukan oleh jenis metriknya (bukan oleh
  // toggle periode 24 Jam/7 Hari) — voltage cenderung stabil sehingga
  // ditampilkan sebagai area/line chart, sedangkan current & power
  // lebih informatif sebagai bar chart. Toggle periode hanya mengganti
  // rentang data yang ditampilkan.
  function chartTypeFor(key) {
    // Semua chart sekarang seragam pakai "line" (dulu current/power pakai
    // "bar", tapi kalau datanya flat 0 sepanjang periode -- misal malam
    // hari tidak ada produksi -- bar chart jadi tidak jelas kebaca,
    // sementara line chart tetap kelihatan sebagai garis datar di 0 yang
    // jelas maknanya "memang segini, bukan error/kosong".
    return "line";
  }

  // Ambil dataset {labels, voltage, current, power} sesuai periode aktif
  // chart tsb. 'custom' sekarang ambil dari sys.chart._customCache, hasil
  // fetch REAL ke GET /telemetry/history?startTs=...&endTs=... buat
  // rentang dateFrom..dateTo persis yang user pilih (lihat
  // fetchTawabiCustomChart + loadCustomRangeAndRender). Kalau fetch-nya
  // belum selesai / belum pernah dipanggil untuk rentang itu, sementara
  // tampilkan "week" dulu supaya chart tidak kosong total sambil nunggu.
  function datasetForPeriod(sys, period) {
    const chart = sys.chart || {};
    const empty = { labels: [], voltage: [], current: [], power: [], temperature: [], gridPower: [], loadPower: [] };
    if (period.mode === "7d") return chart.week || empty;
    if (period.mode === "30d") return chart.month || empty;
    if (period.mode === "custom") {
      const cacheKey = `${period.dateFrom}_${period.dateTo}`;
      const cached = (chart._customCache || {})[cacheKey];
      return cached || chart.week || empty;
    }
    return chart.today || empty;
  }

  // opts (semua opsional, dipakai buat render canvas KEDUA di zoom modal
  // tanpa mengganggu canvas asli di kartu kecil):
  //   canvasId       - id elemen <canvas> tujuan (default: spec.canvas)
  //   statsSelector  - selector elemen ringkasan (default: [data-chart-stats="key"])
  //   instKey        - key unik di window.__siChartInstances (default: spec.canvas)
  function renderSingleChart(sys, spec, opts) {
    opts = opts || {};
    const canvasId = opts.canvasId || spec.canvas;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (typeof Chart === "undefined") {
      ensureChartJsLoaded();
      return;
    }

    const period = siChartPeriods[spec.key] || { mode: "24h", dateFrom: null, dateTo: null };
    const dataset = datasetForPeriod(sys, period);
    const type = chartTypeFor(spec.key);
    // FIX: "24 Hours" sebelumnya TIDAK termasuk kondisi ini, jadi
    // sumbu-X-nya disembunyikan total (tidak ada info jam sama sekali
    // di bawah grafik "24 Jam Terakhir"). Sekarang ikut ditampilkan --
    // aman karena xTickCallback di bawah sudah menjamin cuma
    // MAX_X_TICKS label yang muncul, jadi tidak akan numpuk walau
    // titik per-jamnya banyak.
    const isDaily = period.mode === "24h" || period.mode === "7d" || period.mode === "30d" || period.mode === "custom";
    const manyPoints = dataset.labels.length > 20;

    // FIX: autoSkip + maxTicksLimit bawaan Chart.js kadang TIDAK
    // memangkas label sebanyak yang diharapkan (tergantung lebar
    // canvas real-time saat render, kadang masih nampilin puluhan
    // label numpuk tanpa rotasi -- lihat laporan screenshot "Power
    // Output"/"Inverter Temp" masih berantakan walau autoSkip sudah
    // aktif). Diganti pendekatan yang lebih pasti: kita sendiri yang
    // mutusin hanya boleh ada MAX_X_TICKS label yang ditampilkan,
    // sisanya di-kosongin lewat ticks.callback (bukan diserahkan ke
    // heuristik internal Chart.js). Hasilnya jumlah & jarak antar
    // label jadi konsisten apa pun ukuran kartu / jumlah titik data.
    const MAX_X_TICKS = 7;
    const xTickStep = Math.max(1, Math.ceil(dataset.labels.length / MAX_X_TICKS));
    // Ambil label LANGSUNG dari dataset.labels[index] (bukan lewat
    // this.getLabelForValue(value), yang perilakunya beda-beda antar
    // versi Chart.js dan sempat balik index mentah, bukan teks
    // tanggal) -- ini sumber data yang sudah pasti string tanggal asli.
    const xTickCallback = function (value, index) {
      return index % xTickStep === 0 ? (dataset.labels[index] ?? "") : null;
    };

    const statsEl = document.querySelector(opts.statsSelector || `[data-chart-stats="${spec.key}"]`);
    if (statsEl) {
      const unit = spec.unit || "";
      const isCustomPending = period.mode === "custom" &&
        !((sys.chart._customCache || {})[`${period.dateFrom}_${period.dateTo}`]);
      const captionSuffix = isCustomPending ? ' <i class="fa-solid fa-spinner fa-spin" title="Mengambil data dari server..."></i>' : "";
      statsEl.innerHTML = `<span class="si-chart-period-caption">${esc(periodLabel(period))}${captionSuffix}</span><span class="si-chart-stats-values">${computeChartStats(dataset[spec.key], unit)}</span>`;
    }

    const instKey = opts.instKey || spec.canvas;
    if (window.__siChartInstances[instKey]) {
      window.__siChartInstances[instKey].destroy();
    }

    // Tooltip default Chart.js kadang keluar pucat/kontrasnya kurang
    // (terlihat samar di atas bar/line-nya) — bukan soal bentuk huruf
    // (miring/tegak), tapi soal warna. Dikasih background gelap solid +
    // teks putih tebal di sini supaya angkanya selalu kebaca jelas,
    // dipakai bareng di chart bar maupun line di bawah.
    const tooltipStyle = {
      enabled: true,
      backgroundColor: "rgba(20, 30, 32, 0.92)",
      titleColor: "#FFFFFF",
      bodyColor: "#FFFFFF",
      titleFont: { size: 11, weight: "600" },
      bodyFont: { size: 12, weight: "700" },
      padding: 8,
      cornerRadius: 6,
      displayColors: false,
      callbacks: {
        label: (ctx) => `${ctx.formattedValue}${spec.unit ? " " + spec.unit : ""}`
      }
    };

    if (type === "bar") {
      window.__siChartInstances[instKey] = new Chart(canvas, {
        type: "bar",
        data: {
          labels: dataset.labels,
          datasets: [{
            data: dataset[spec.key],
            backgroundColor: spec.color,
            borderRadius: 3,
            barPercentage: 0.9,
            categoryPercentage: 0.9
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: true,
              backgroundColor: "#1F2A2C",
              titleColor: "#fff",
              titleFont: { size: 11, weight: "600" },
              bodyColor: "#E7EDEE",
              bodyFont: { size: 11 },
              padding: 10,
              displayColors: false,
              callbacks: { title: chartTooltipTitle(period, dataset), label: chartTooltipLabel(spec) }
            }
          },
          scales: {
            x: {
              ticks: {
                font: { size: 9.5 }, color: "#7C8B8D",
                maxRotation: manyPoints ? 60 : 0,
                minRotation: manyPoints ? 60 : 0,
                display: isDaily,
                autoSkip: false,
                // FIX: sebelumnya callback ini cuma dipasang KALAU
                // manyPoints (>20 titik) -- di bawah itu diserahkan ke
                // default Chart.js, yang ternyata malah nampilin index
                // angka mentah (0,1,2,3...) BUKAN label tanggal aslinya
                // buat sebagian rentang data. Dipasang permanen supaya
                // label yang tampil SELALU string tanggal asli dari
                // dataset.labels, bukan pernah index numerik.
                callback: xTickCallback
              },
              grid: { display: false }
            },
            y: {
              grid: { color: "#E7EDEE" },
              ticks: {
                font: { size: 10 }, color: "#7C8B8D", maxTicksLimit: 5,
                callback: (v) => `${v} ${spec.unit}`
              }
            }
          }
        }
      });
    } else {
      window.__siChartInstances[instKey] = new Chart(canvas, {
        type: "line",
        data: {
          labels: dataset.labels,
          datasets: [{
            data: dataset[spec.key],
            borderColor: spec.color,
            backgroundColor: hexToRgba(spec.color, 0.25),
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: spec.color,
            pointBorderColor: "#fff",
            pointBorderWidth: 1.5,
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: true,
              backgroundColor: "#1F2A2C",
              titleColor: "#fff",
              titleFont: { size: 11, weight: "600" },
              bodyColor: "#E7EDEE",
              bodyFont: { size: 11 },
              padding: 10,
              displayColors: false,
              callbacks: { title: chartTooltipTitle(period, dataset), label: chartTooltipLabel(spec) }
            }
          },
          scales: {
            // FIX: sebelumnya branch line chart ini TIDAK set minRotation
            // (beda dengan branch bar di atas) -- akibatnya Chart.js bebas
            // pilih rotasi 0°-60° sendiri, sering milih rotasi rendah yang
            // bikin label tanggal saling tindih/tabrakan kalau titiknya
            // banyak (kasus chart "Power Output" custom range di screenshot).
            // Disamakan dengan branch bar: rotasi dipaksa 60° begitu titik
            // > 20, dan maxTicksLimit diturunkan jadi 8 (dari 15) supaya
            // tiap label punya ruang cukup, tidak numpuk.
            x: { ticks: { display: isDaily, font: { size: 9.5 }, color: "#7C8B8D", maxRotation: manyPoints ? 60 : 0, minRotation: manyPoints ? 60 : 0, autoSkip: false, callback: xTickCallback }, grid: { display: false } },
            // Sumbu-Y sekarang ditampilkan (sebelumnya display:false) supaya
            // jelas puncak grafik itu terhadap skala berapa V.
            y: {
              display: true,
              grid: { color: "#F1F4F4", drawTicks: false },
              ticks: {
                font: { size: 9.5 }, color: "#9AA6A8", maxTicksLimit: 4,
                callback: (v) => `${v} ${spec.unit}`
              }
            }
          }
        }
      });
    }
  }

  function renderCharts(sys) {
    chartSpecs.forEach((spec) => renderSingleChart(sys, spec));
  }

  // Fetch REAL telemetry/history untuk rentang custom (dateFrom..dateTo),
  // simpan ke sys.chart._customCache, lalu re-render chart 'key' tsb.
  // Kalau rentang yang sama sudah pernah di-fetch sebelumnya, langsung
  // pakai cache tanpa fetch ulang. Ada guard di akhir supaya tidak
  // "menimpa" tampilan kalau user keburu ganti toggle/rentang lain
  // sebelum fetch yang lama ini selesai (race condition).
  async function loadCustomRangeAndRender(sys, key, dateFrom, dateTo) {
    const spec = chartSpecs.find((s) => s.key === key);
    if (!spec) return;

    // Render dulu pakai cache/fallback yang ada sekarang supaya UI
    // langsung merespons klik user, tidak nge-freeze nunggu network.
    renderSingleChart(sys, spec);

    const cacheKey = `${dateFrom}_${dateTo}`;
    sys.chart._customCache = sys.chart._customCache || {};
    if (!sys.chart._customCache[cacheKey]) {
      const deviceId = sys.chart.deviceId || TAWABI_DEVICE_ID;
      const fallbackScale = sys.chart.fallbackScale || 0.7;
      const data = await fetchTawabiCustomChart(deviceId, dateFrom, dateTo, fallbackScale);
      sys.chart._customCache[cacheKey] = data;
    }

    // Cuma render ulang kalau rentang ini masih yang lagi aktif dipilih
    // user (bukan sudah diganti ke rentang/toggle lain selagi nunggu).
    const current = siChartPeriods[key];
    if (current && current.mode === "custom" && current.dateFrom === dateFrom && current.dateTo === dateTo) {
      renderSingleChart(sys, spec);
    }
  }

  function bindChartToggleEvents(sys) {
    document.querySelectorAll(".si-chart-toggle").forEach((toggle) => {
      const key = toggle.getAttribute("data-chart-key");
      const rangeWrap = document.querySelector(`.si-chart-daterange[data-chart-key="${key}"]`);
      const fromInput = document.querySelector(`.si-chart-date-from[data-chart-key="${key}"]`);
      const toInput = document.querySelector(`.si-chart-date-to[data-chart-key="${key}"]`);

      toggle.querySelectorAll("button").forEach((btn) => {
        btn.onclick = () => {
          const period = btn.getAttribute("data-period");
          toggle.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b === btn));

          if (period === "custom") {
            // Klik "Custom" membuka 2 date-picker (Dari / Sampai). Default
            // rentangnya 14 hari terakhir supaya langsung ada isinya —
            // user tetap bebas geser ke rentang manapun dalam data yang
            // tersedia (min/max sudah dibatasi ke sys.chart.range).
            if (rangeWrap) rangeWrap.style.display = "flex";
            const range = sys.chart.range || {};
            let dateTo = (toInput && toInput.value) || range.lastDate;
            let dateFrom = (fromInput && fromInput.value) || range.firstDate;
            if (!(fromInput && fromInput.value)) {
              const toDate = new Date(dateTo);
              if (!isNaN(toDate.getTime())) {
                const d = new Date(toDate);
                d.setDate(d.getDate() - 13);
                const candidate = d.toISOString().slice(0, 10);
                dateFrom = candidate > range.firstDate ? candidate : range.firstDate;
              }
            }
            if (fromInput) fromInput.value = dateFrom;
            if (toInput) toInput.value = dateTo;
            siChartPeriods[key] = { mode: "custom", dateFrom, dateTo };
            loadCustomRangeAndRender(sys, key, dateFrom, dateTo);
            return;
          } else {
            if (rangeWrap) rangeWrap.style.display = "none";
            siChartPeriods[key] = { mode: period, dateFrom: null, dateTo: null };
          }

          const spec = chartSpecs.find((s) => s.key === key);
          if (!spec) return;

          if (period === "7d" || period === "30d") {
            const flagKey = period === "7d" ? "weekLoaded" : "monthLoaded";
            if (!sys.chart[flagKey]) {
              // Belum pernah di-fetch -- tampilkan loading di chart INI
              // saja (bukan semua chart), fetch, baru render begitu selesai.
              const wrap = document.querySelector(`#${spec.canvas}`)?.closest(".si-chart-wrap");
              if (wrap) wrap.classList.add("si-chart-loading");
              ensureTawabiRangeData(sys, period).then(() => {
                if (wrap) wrap.classList.remove("si-chart-loading");
                // Guard: kalau user sudah klik pindah period lain lagi
                // sebelum fetch ini selesai, jangan timpa tampilannya.
                if (siChartPeriods[key] && siChartPeriods[key].mode === period) {
                  renderSingleChart(sys, spec);
                }
              });
              return;
            }
          }

          renderSingleChart(sys, spec);
        };
      });

      function onRangeChange() {
        if (!fromInput || !toInput || !fromInput.value || !toInput.value) return;
        const dateFrom = fromInput.value;
        const dateTo = toInput.value;
        siChartPeriods[key] = { mode: "custom", dateFrom, dateTo };
        loadCustomRangeAndRender(sys, key, dateFrom, dateTo);
      }
      if (fromInput) fromInput.onchange = onRangeChange;
      if (toInput) toInput.onchange = onRangeChange;
    });
  }

  // ===========================================================
  // ZOOM CARD MODAL — klik card mana pun (kecuali tombol/toggle/input
  // di dalamnya) -> tampilkan versi lebih besar di modal.
  // 2 mode:
  //  - "generic" (overview/device/health/alarm): tinggal clone innerHTML
  //    kartunya apa adanya, dibesarkan lewat CSS (.si-zoom-body).
  //  - "chart" (voltage/current/power): render ULANG chart-nya di
  //    canvas baru dalam modal (pakai data & periode yang lagi aktif
  //    sekarang di kartu kecilnya), bukan sekadar clone gambar statis,
  //    supaya tooltip & sumbu tetap presisi di ukuran besar.
  // ===========================================================
  function closeZoomChartInstances() {
    Object.keys(window.__siChartInstances).forEach((key) => {
      if (key.indexOf("zoom-") === 0) {
        window.__siChartInstances[key].destroy();
        delete window.__siChartInstances[key];
      }
    });
  }

  function openZoomModal(sys, cardEl) {
    const type = cardEl.getAttribute("data-zoom-type");
    if (!type) return;

    const titleEl = cardEl.querySelector(".si-card-head h3");
    const eyebrowEl = cardEl.querySelector(".si-card-head .si-card-eyebrow");
    document.getElementById("siZoomTitle").textContent = titleEl ? titleEl.textContent : "";
    document.getElementById("siZoomEyebrow").textContent = eyebrowEl ? eyebrowEl.textContent : "";

    const body = document.getElementById("siZoomBody");

    if (type === "chart") {
      const key = cardEl.getAttribute("data-zoom-chart-key");
      const spec = chartSpecs.find((s) => s.key === key);
      body.innerHTML = `
        <div class="si-chart-stats" data-chart-stats-modal="${esc(key)}"></div>
        <div class="si-chart-wrap"><canvas id="siZoomChartCanvas"></canvas></div>
      `;
      document.getElementById("siZoomOverlay").classList.add("is-open");
      // Tunggu 1 frame supaya modal sudah punya ukuran layout final
      // dulu sebelum Chart.js dibuat (kalau langsung, canvas masih
      // dianggap 0x0 karena overlay barusan display:flex).
      requestAnimationFrame(() => {
        if (spec) {
          renderSingleChart(sys, spec, {
            canvasId: "siZoomChartCanvas",
            statsSelector: `[data-chart-stats-modal="${key}"]`,
            instKey: "zoom-" + spec.canvas
          });
        }
      });
      return;
    }

    // generic: apa adanya, clone innerHTML kartu kecilnya (header
    // ikut ke-clone tapi disembunyikan lewat CSS .si-zoom-body
    // .si-card-head { display:none }, jadi tombol edit/"view details"
    // di dalamnya juga otomatis tidak tampil -- aman, tidak ada
    // tombol nyantol tanpa handler di dalam modal).
    body.innerHTML = cardEl.innerHTML;
    document.getElementById("siZoomOverlay").classList.add("is-open");
  }

  function closeZoomModal() {
    document.getElementById("siZoomOverlay").classList.remove("is-open");
    closeZoomChartInstances();
    document.getElementById("siZoomBody").innerHTML = "";
  }

  function bindZoomModalEvents() {
    document.getElementById("siZoomCloseBtn").onclick = closeZoomModal;
    document.getElementById("siZoomOverlay").onclick = (e) => {
      if (e.target.id === "siZoomOverlay") closeZoomModal();
    };
  }
  window.__siBindZoomModalEvents = bindZoomModalEvents;

  // Dipanggil tiap habis renderDetail() (lihat bindDetailEvents). Pakai
  // event delegation langsung di tiap .si-card (bukan di container),
  // dan skip kalau yang diklik/di dalam elemen interaktif (tombol edit,
  // toggle 24h/7d/30d/custom, date-picker, "View details", dst) supaya
  // fungsi aslinya tetap jalan normal, tidak ke-intercept oleh zoom.
  function bindZoomCardEvents(sys) {
    document.querySelectorAll("#siCardsRow .si-card").forEach((cardEl) => {
      cardEl.onclick = (e) => {
        if (e.target.closest("button, a, input, select, textarea")) return;
        openZoomModal(sys, cardEl);
      };
    });
  }

  // ---------- Future Maintenance ----------
  function priorityTag(p) {
    const map = { high: "High", medium: "Medium", low: "Low" };
    return `<span class="si-priority si-priority-${p || "medium"}">${map[p] || "Medium"}</span>`;
  }

  function renderFutureMaintenance(sys) {
    const list = document.getElementById("siFutureList");
    const count = document.getElementById("siFutureCount");
    count.textContent = sys.futureMaintenance.length ? ` (${sys.futureMaintenance.length})` : "";

    if (!sys.futureMaintenance.length) {
      list.innerHTML = `<div class="si-empty-inline">No future maintenance scheduled.</div>`;
      return;
    }

    list.innerHTML = sys.futureMaintenance.map((m, idx) => `
      <div class="si-maint-item" data-idx="${idx}">
        <div class="si-maint-icon"><i class="fa-solid fa-screwdriver-wrench"></i></div>
        <div class="si-maint-body">
          <div class="si-maint-title">${esc(m.title)}</div>
          ${m.description ? `<div class="si-maint-desc">${esc(m.description)}</div>` : ""}
          <div class="si-maint-tags">
            <span class="si-tag"><i class="fa-solid fa-calendar"></i>${fmtDate(m.scheduledDate)}</span>
            <span class="si-tag"><i class="fa-solid fa-user"></i>${esc(m.technician)}</span>
            ${priorityTag(m.priority)}
          </div>
        </div>
        <div class="si-maint-actions">
          <button class="si-btn si-btn-secondary si-btn-sm si-edit-schedule-btn" data-idx="${idx}" type="button">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="si-btn si-btn-danger-ghost si-btn-sm si-delete-schedule-btn" data-idx="${idx}" type="button">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `).join("");
  }

  // ---------- Historical Maintenance ----------
  function renderHistoricalMaintenance(sys) {
    const list = document.getElementById("siHistoryList");
    const count = document.getElementById("siHistoryCount");
    count.textContent = sys.historicalMaintenance.length ? ` (${sys.historicalMaintenance.length})` : "";

    if (!sys.historicalMaintenance.length) {
      list.innerHTML = `<div class="si-empty-inline">No historical maintenance records.</div>`;
      return;
    }

    list.innerHTML = sys.historicalMaintenance.map((h, idx) => `
      <div class="si-timeline-item">
        <div class="si-timeline-dot"><i class="fa-solid fa-check"></i></div>
        <div class="si-timeline-card" data-idx="${idx}">
          <div class="si-timeline-head">
            <div>
              <h4>${esc(h.title)}</h4>
              <div class="si-timeline-dates"><span>Start:</span> ${fmtDate(h.startDate)} &nbsp;·&nbsp; <span>Completed:</span> ${fmtDate(h.completedDate)}</div>
            </div>
            <span class="si-badge si-badge-connected">Completed</span>
          </div>
          <div class="si-timeline-grid">
            <div><b>Problem</b>${esc(h.problem)}</div>
            <div><b>Action Taken</b>${esc(h.actionTaken)}</div>
            <div><b>Problem Fixed</b>${yesNoText(h.problemFixed)}</div>
            <div><b>Status</b>Completed</div>
          </div>
          ${h.notes ? `<div class="si-timeline-notes"><b style="display:block;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--si-muted);margin-bottom:3px;">Notes</b>${esc(h.notes)}</div>` : ""}
          <div class="si-timeline-tech">
            <span class="si-avatar-sm"><i class="fa-solid fa-user"></i></span>
            ${esc(h.technician)}
          </div>
        </div>
      </div>
    `).join("");
  }

  // ---------- Detail view events (schedule buttons) ----------
  function bindDetailEvents(sys) {
    bindZoomCardEvents(sys);

    // Binding .si-edit-section-btn / openEditModal() DIHAPUS -- tombol
    // edit pencil-nya sendiri sudah tidak dirender lagi di overviewCard()/
    // deviceCard() (lihat catatan di sana).

    // Tombol refresh chart manual sudah di-disable (lihat render kartu:
    // title="Belum tersedia — monitoring belum realtime", attribute
    // disabled) -- monitoring belum realtime jadi tidak ada "data baru"
    // yang bisa di-refresh secara manual. Dulu handler ini malah generate
    // angka acak baru tiap diklik (genChartData()) -- DIHAPUS. Sekarang
    // tidak ada listener sama sekali karena tombolnya memang tidak aktif.

    const alarmViewBtn = document.querySelector(".si-alarm-viewdetail-btn");
    if (alarmViewBtn) alarmViewBtn.onclick = () => navigateToAlertsPage(sys.id);

    document.getElementById("siAddScheduleBtn").onclick = () => openScheduleModal(null);

    document.querySelectorAll(".si-edit-schedule-btn").forEach((btn) => {
      btn.onclick = () => openScheduleModal(parseInt(btn.getAttribute("data-idx"), 10));
    });

    document.querySelectorAll(".si-delete-schedule-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute("data-idx"), 10);
        sys.futureMaintenance.splice(idx, 1);
        saveSystemsToServer();
        renderFutureMaintenance(sys);
        bindDetailEvents(sys);
        showToast("Jadwal maintenance dihapus.");
      };
    });

    document.querySelectorAll(".si-edit-schedule-btn, .si-delete-schedule-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => e.stopPropagation());
    });

    document.querySelectorAll("#siFutureList .si-maint-item").forEach((item) => {
      item.onclick = () => openFutureDetail(parseInt(item.getAttribute("data-idx"), 10));
    });

    document.querySelectorAll("#siHistoryList .si-timeline-card").forEach((card) => {
      card.onclick = () => openHistoryDetail(parseInt(card.getAttribute("data-idx"), 10));
    });
  }

  // ===========================================================
  // MAINTENANCE DETAIL MODALS (Future & Historical)
  // ===========================================================
  function openFutureDetail(idx) {
    const sys = getSystem(siActiveSystemId);
    if (!sys) return;
    const m = sys.futureMaintenance[idx];
    if (!m) return;
    siFutureDetailIndex = idx;

    document.getElementById("siFutureDetailTitle").textContent = m.title || "-";
    document.getElementById("siFutureDetailTags").innerHTML = `
      <span class="si-tag"><i class="fa-solid fa-calendar"></i>${fmtDate(m.scheduledDate)}</span>
      <span class="si-tag"><i class="fa-solid fa-user"></i>${esc(m.technician)}</span>
      ${priorityTag(m.priority)}
    `;
    document.getElementById("siFutureDetailDl").innerHTML = [
      dlRow("Maintenance Title", m.title),
      dlRow("Scheduled Date", fmtDate(m.scheduledDate)),
      dlRow("Assigned Technician", m.technician),
      dlRow("Priority", (m.priority || "medium").charAt(0).toUpperCase() + (m.priority || "medium").slice(1)),
      dlRow("Status", "Upcoming")
    ].join("");

    const descWrap = document.getElementById("siFutureDetailDescWrap");
    if (m.description) { descWrap.style.display = ""; document.getElementById("siFutureDetailDesc").textContent = m.description; }
    else descWrap.style.display = "none";

    const notesWrap = document.getElementById("siFutureDetailNotesWrap");
    if (m.notes) { notesWrap.style.display = ""; document.getElementById("siFutureDetailNotes").textContent = m.notes; }
    else notesWrap.style.display = "none";

    document.getElementById("siFutureDetailOverlay").classList.add("is-open");
  }

  function closeFutureDetail() {
    document.getElementById("siFutureDetailOverlay").classList.remove("is-open");
  }

  function openHistoryDetail(idx) {
    const sys = getSystem(siActiveSystemId);
    if (!sys) return;
    const h = sys.historicalMaintenance[idx];
    if (!h) return;
    siHistoryDetailIndex = idx;

    document.getElementById("siHistoryDetailTitle").textContent = h.title || "-";
    document.getElementById("siHistoryDetailTags").innerHTML = `
      <span class="si-tag"><i class="fa-solid fa-calendar-check"></i>${fmtDate(h.completedDate)}</span>
      <span class="si-tag"><i class="fa-solid fa-user"></i>${esc(h.technician)}</span>
      <span class="si-badge si-badge-connected">Completed</span>
    `;
    document.getElementById("siHistoryDetailDl").innerHTML = [
      dlRow("Maintenance Title", h.title),
      dlRow("Start Date", fmtDate(h.startDate)),
      dlRow("Completed Date", fmtDate(h.completedDate)),
      dlRow("Technician", h.technician),
      dlRow("Problem Fixed", yesNoText(h.problemFixed)),
      dlRow("Status", "Completed")
    ].join("");

    document.getElementById("siHistoryDetailProblem").textContent = h.problem || "-";
    document.getElementById("siHistoryDetailAction").textContent = h.actionTaken || "-";

    const notesWrap = document.getElementById("siHistoryDetailNotesWrap");
    if (h.notes) { notesWrap.style.display = ""; document.getElementById("siHistoryDetailNotes").textContent = h.notes; }
    else notesWrap.style.display = "none";

    document.getElementById("siHistoryDetailOverlay").classList.add("is-open");
  }

  function closeHistoryDetail() {
    document.getElementById("siHistoryDetailOverlay").classList.remove("is-open");
  }

  function bindDetailModalEvents() {
    document.getElementById("siFutureDetailCloseBtn").onclick = closeFutureDetail;
    document.getElementById("siFutureDetailCloseBtn2").onclick = closeFutureDetail;
    document.getElementById("siFutureDetailOverlay").onclick = (e) => {
      if (e.target.id === "siFutureDetailOverlay") closeFutureDetail();
    };
    document.getElementById("siFutureDetailEditBtn").onclick = () => {
      closeFutureDetail();
      openScheduleModal(siFutureDetailIndex);
    };
    document.getElementById("siFutureDetailDeleteBtn").onclick = () => {
      const sys = getSystem(siActiveSystemId);
      if (!sys || siFutureDetailIndex === null) return;
      sys.futureMaintenance.splice(siFutureDetailIndex, 1);
      saveSystemsToServer();
      closeFutureDetail();
      renderFutureMaintenance(sys);
      bindDetailEvents(sys);
      showToast("Jadwal maintenance dihapus.");
    };

    document.getElementById("siHistoryDetailCloseBtn").onclick = closeHistoryDetail;
    document.getElementById("siHistoryDetailCloseBtn2").onclick = closeHistoryDetail;
    document.getElementById("siHistoryDetailOverlay").onclick = (e) => {
      if (e.target.id === "siHistoryDetailOverlay") closeHistoryDetail();
    };
  }

  // ===========================================================
  // SCHEDULE MODAL (Add / Edit Future Maintenance — reused)
  // ===========================================================
  const scheduleTechnicianOptions = ["Dedi Kurniawan", "Andi Wijaya", "Budi Santoso", "Citra Lestari"];

  function setSchedulePriority(form, priority) {
    form.querySelector('[name="priority"]').value = priority || "medium";
    form.querySelectorAll(".si-priority-opt").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.getAttribute("data-value") === (priority || "medium"));
    });
  }

  function openScheduleModal(editIdx) {
    siScheduleEditIndex = editIdx;
    const form = document.getElementById("siScheduleForm");
    form.reset();
    document.querySelectorAll("#siScheduleForm .si-conditional-field").forEach((el) => el.classList.remove("is-visible"));

    document.getElementById("siScheduleModalTitle").textContent =
      editIdx === null ? "Add Schedule" : "Edit Schedule";

    const techSelect = form.querySelector('[name="technician"]');
    const techCustom = form.querySelector('[name="technicianCustom"]');

    if (editIdx !== null) {
      const sys = getSystem(siActiveSystemId);
      const m = sys.futureMaintenance[editIdx];
      form.querySelector('[name="title"]').value = m.title || "";
      form.querySelector('[name="description"]').value = m.description || "";
      form.querySelector('[name="scheduledDate"]').value = m.scheduledDate || "";
      setSchedulePriority(form, m.priority);
      form.querySelector('[name="notes"]').value = m.notes || "";

      if (m.technician && scheduleTechnicianOptions.includes(m.technician)) {
        techSelect.value = m.technician;
      } else if (m.technician && m.technician !== "-") {
        techSelect.value = "other";
        techCustom.value = m.technician;
        techCustom.classList.add("is-visible");
      } else {
        techSelect.value = "";
      }
    } else {
      setSchedulePriority(form, "medium");
    }

    techSelect.onchange = () => techCustom.classList.toggle("is-visible", techSelect.value === "other");

    document.getElementById("siScheduleOverlay").classList.add("is-open");
  }

  function closeScheduleModal() {
    document.getElementById("siScheduleOverlay").classList.remove("is-open");
  }

  function saveScheduleModal() {
    const sys = getSystem(siActiveSystemId);
    if (!sys) return;

    const form = document.getElementById("siScheduleForm");
    const dateInput = form.querySelector('[name="scheduledDate"]');
    const dateField = dateInput.closest(".si-field");
    if (!dateInput.value) {
      dateField.classList.add("has-error");
      dateInput.classList.add("is-invalid");
      return;
    }
    dateField.classList.remove("has-error");
    dateInput.classList.remove("is-invalid");

    const fd = new FormData(form);
    const technicianRaw = fd.get("technician") || "";
    const entry = {
      title: fd.get("title") || "Untitled Maintenance",
      description: fd.get("description") || "",
      scheduledDate: fd.get("scheduledDate") || "",
      priority: fd.get("priority") || "medium",
      technician: technicianRaw === "other" ? (fd.get("technicianCustom") || "Lainnya") : (technicianRaw || "-"),
      notes: fd.get("notes") || ""
    };

    if (siScheduleEditIndex === null) {
      // Baru: kasih id unik supaya bisa dirujuk otomatis oleh Task
      // Management & Task Maintenance (lihat genMaintId() di atas).
      entry.id = genMaintId();
      sys.futureMaintenance.push(entry);
    } else {
      // Edit: pertahankan id yang sudah ada supaya task terkait di
      // Task Maintenance tetap nyambung ke entry yang sama.
      entry.id = sys.futureMaintenance[siScheduleEditIndex].id || genMaintId();
      sys.futureMaintenance[siScheduleEditIndex] = entry;
    }
    saveSystemsToServer();

    closeScheduleModal();
    renderFutureMaintenance(sys);
    bindDetailEvents(sys);
    showToast("Jadwal maintenance disimpan.");
  }

  function bindScheduleModalEvents() {
    document.getElementById("siScheduleCloseBtn").onclick = closeScheduleModal;
    document.getElementById("siScheduleCancelBtn").onclick = closeScheduleModal;
    document.getElementById("siScheduleSaveBtn").onclick = saveScheduleModal;
    document.getElementById("siScheduleOverlay").onclick = (e) => {
      if (e.target.id === "siScheduleOverlay") closeScheduleModal();
    };

    document.querySelectorAll("#siScheduleForm .si-priority-opt").forEach((btn) => {
      btn.onclick = () => setSchedulePriority(document.getElementById("siScheduleForm"), btn.getAttribute("data-value"));
    });
  }

  // ===========================================================
  // TOAST
  // ===========================================================
  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById("siToast");
    document.getElementById("siToastMsg").textContent = msg;
    toast.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-show"), 2800);
  }

})();