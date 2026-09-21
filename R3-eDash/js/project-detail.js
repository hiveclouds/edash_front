/* ============================================================
   Tab: Project Overview (detail) — inside Project Monitoring
   360eDash

   Detail view for ONE selected project (Project Summary, Current
   Power, Today's Energy, PV Health, Performance Ratio, Weather,
   Energy Production chart, Active Alerts, Notifications, Battery
   Summary, Inverter Summary, System Health, Recent Activity).

   Every project below starts from a seed/placeholder dummy data set.
   For "tawabi" (PLTS Tawabi, the only project with a real data-logger
   source) this seed is overwritten at runtime by pdLoadRealTawabiProject()
   from server/data/tawabi-telemetry.json, server/data/battery-station/
   tawabi-1.json + tawabi-2.json, server/data/tawabi-energy-production.json
   (Energy Production Actual-vs-Expected chart), and GET /api/systems.
   Other/user-added projects without a real source keep the dummy seed.
   Switching the project chip re-renders the whole page — no navigation,
   no reload.

   Exposes window.initProjectDetail(), called by
   js/project-monitoring.js each time the "Project Overview" tab
   is lazily loaded.
============================================================= */

(function () {

  let pdChart = null;
  let pdCurrentId = "tawabi";
  let pdReportPeriod = "7d";
  let pdLanguageListenerBound = false;

  // Staff = hirarki paling bawah, selalu 1 project (di-assign admin lewat
  // Admin View, backend GET /projects sudah discope per akun). Dipakai
  // buat matikan project switcher (dropdown + search) & memaksa
  // pdCurrentId ke satu-satunya project miliknya -- lihat initProjectDetail().
  const PD_IS_STAFF = sessionStorage.getItem("edash-role") === "staff";

  // Conversion factors for Environmental Impact.
  // These are calculation factors, not data-logger fields.
  // Energy itself comes from the Tawabi logger history (actualKwh / Et_ge0).
  const ENV_CO2_PER_KWH = 0.85;          // kg CO2 avoided per kWh
  const ENV_TREES_PER_KG_CO2 = 1 / 21;   // ~21 kg CO2 absorbed / tree / year
  const ENV_TARIFF_PER_KWH = 1444.7;     // Rp/kWh, default fallback rate (R-1/TR 3500-5500 VA)
  // Rp/kWh, indicative diesel genset fuel cost -- typical industrial solar
  // (non-subsidized) price (~Rp 13.000-14.000/liter) at ~0.25-0.3 L/kWh
  // genset fuel consumption works out to roughly this range. Used only as
  // the starting point shown in the Diesel Fuel Cost field before an
  // admin enters their own site's actual figure.
  const ENV_DIESEL_DEFAULT_RATE = 3500;

  // PLN non-subsidized tariff categories the user can pick from in the
  // Bill Savings settings modal. Rates are indicative reference values
  // (Rp/kWh) -- admins can also switch to a manual Diesel Fuel Cost
  // basis instead if these don't match their site's actual tariff.
  const ENV_PLN_TARIFFS = [
    { id: "r1_900",     label: "R-1/TR 900 VA (Rumah Tangga)",          rate: 1352.00 },
    { id: "r1_1300",    label: "R-1/TR 1300 VA (Rumah Tangga)",         rate: 1444.70 },
    { id: "r1_2200",    label: "R-1/TR 2200 VA (Rumah Tangga)",         rate: 1444.70 },
    { id: "r1_3500",    label: "R-1/TR 3500-5500 VA (Rumah Tangga)",    rate: 1699.53 },
    { id: "b2_bisnis",  label: "B-2/TR 6600 VA-200 kVA (Bisnis)",       rate: 1444.70 },
    { id: "i3_industri",label: "I-3/TM di atas 200 kVA (Industri)",     rate: 1114.74 },
  ];
  const ENV_TARIFF_CFG_KEY = "edash-admin-env-tariff-cfg";

  // Formats a raw digit string with "." thousand separators, id-ID style
  // (e.g. "3500" -> "3.500"). Used to live-format the Diesel Fuel Cost
  // input as the admin types, instead of a native number spinner.
  function pdFormatRupiahThousands(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  // Config per project id: { source: "pln" | "manual", plnId, manualRate }.
  // manualRate is null until the admin actually types a value -- the
  // field shows the ENV_DIESEL_DEFAULT_RATE only as a placeholder hint,
  // not as a pre-filled number, so it's obvious nothing real has been
  // entered yet.
  // Mirrors the pattern used by PD_PERF_CFG_KEY below -- one JSON blob in
  // localStorage keyed by project id, so each project remembers its own
  // Bill Savings basis.
  function pdLoadEnvTariffCfgAll() {
    try {
      const raw = localStorage.getItem(ENV_TARIFF_CFG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function pdEnvTariffCfgFor(projectId) {
    const all = pdLoadEnvTariffCfgAll();
    const cfg = all[projectId] || {};
    return {
      source: cfg.source === "manual" ? "manual" : "pln",
      plnId: cfg.plnId && ENV_PLN_TARIFFS.some((t) => t.id === cfg.plnId) ? cfg.plnId : ENV_PLN_TARIFFS[3].id,
      manualRate: Number.isFinite(Number(cfg.manualRate)) && Number(cfg.manualRate) > 0 ? Number(cfg.manualRate) : null,
    };
  }
  function pdPersistEnvTariffCfg(projectId, cfg) {
    const all = pdLoadEnvTariffCfgAll();
    all[projectId] = cfg;
    try { localStorage.setItem(ENV_TARIFF_CFG_KEY, JSON.stringify(all)); } catch {}
  }
  // Resolves the active { rate, label } for a project's saved config.
  // Label is kept short (source only) -- the exact PLN category/rate is
  // already visible inside the Settings modal, so the card itself
  // doesn't need to repeat it and blow out its height.
  function pdEnvActiveTariff(projectId) {
    const cfg = pdEnvTariffCfgFor(projectId);
    if (cfg.source === "manual") {
      return { rate: cfg.manualRate != null ? cfg.manualRate : ENV_DIESEL_DEFAULT_RATE, label: "Based on Diesel Fuel Cost" };
    }
    return { rate: (ENV_PLN_TARIFFS.find((t) => t.id === cfg.plnId) || ENV_PLN_TARIFFS[3]).rate, label: "Based on PLN Tariff" };
  }

  // ===========================================================
  // WEATHER — Open-Meteo (https://open-meteo.com), free, no API key.
  // Dipakai untuk mengisi card "Weather" yang sebelumnya placeholder
  // statis (0°C / Not available). Setiap proyek butuh koordinat
  // (field `_coords: {lat, lng}`) supaya bisa di-fetch; proyek tanpa
  // koordinat akan tetap menampilkan placeholder seperti biasa.
  // Cache 10 menit per proyek supaya tidak spam API saat user
  // bolak-balik ganti chip proyek.
  // ===========================================================
  const PD_WEATHER_CACHE_MS = 10 * 60 * 1000;
  const PD_WEATHER_CODE_TEXT = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
    56: "Light freezing drizzle", 57: "Freezing drizzle",
    61: "Slight rain", 63: "Rain", 65: "Heavy rain",
    66: "Light freezing rain", 67: "Freezing rain",
    71: "Slight snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Slight rain showers", 81: "Rain showers", 82: "Violent rain showers",
    85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Thunderstorm w/ heavy hail"
  };

  function pdWeatherCodeToText(code) {
    return PD_WEATHER_CODE_TEXT[code] || "Not available";
  }

  async function pdFetchWeather(lat, lng) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,shortwave_radiation&timezone=auto`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const c = json.current || {};
    return {
      tempC: Math.round((c.temperature_2m ?? 0) * 10) / 10,
      condition: pdWeatherCodeToText(c.weather_code),
      humidity: Math.round(c.relative_humidity_2m ?? 0),
      windSpeed: Math.round(c.wind_speed_10m ?? 0),
      irradiance: Math.round(c.shortwave_radiation ?? 0)
    };
  }

  // Ambil cuaca real untuk satu proyek (dipanggil tiap kali proyek itu
  // dipilih). Non-blocking: kalau gagal (mis. offline / dibuka via
  // file://), card tetap menampilkan nilai terakhir/placeholder.
  async function pdLoadWeather(id) {
    const target = projects[id];
    if (!target || !target._coords) return;
    const now = Date.now();
    if (target._weatherFetchedAt && (now - target._weatherFetchedAt) < PD_WEATHER_CACHE_MS) return;
    try {
      target.weather = await pdFetchWeather(target._coords.lat, target._coords.lng);
      target._weatherFetchedAt = now;
      if (pdCurrentId === id) renderWeather(target);
    } catch (e) {
      console.warn("[project-detail] Gagal ambil cuaca dari Open-Meteo:", e.message);
    }
  }

  // ===========================================================
  // DUMMY DATA — one full data set per project
  // ===========================================================
  // ===========================================================
  // DATA — proyek yang ditampilkan di tab "Project Overview"
  // (di dalam Project Monitoring). Sekarang HANYA "PLTS Tawabi",
  // satu-satunya proyek dengan data real (sebelumnya ada 4 proyek
  // dummy: pnj/pds/beacon/puri — sudah dihapus per permintaan).
  //
  // "tawabi" di bawah cuma SEED/placeholder awal (dipakai sesaat
  // sebelum fetch selesai, atau kalau fetch gagal total — mis.
  // dibuka via file://). Begitu pdLoadRealTawabiProject() sukses,
  // isinya ditimpa PENUH oleh data real dari:
  //   - server/data/tawabi-telemetry.json           (energy, weekly)
  //   - server/data/battery-station/tawabi-1.json +
  //     tawabi-2.json                                (battery, BMS, log aktivitas)
  //   - GET {EDASH_API_BASE}/api/systems              (inverter, maintenance)
  //
  // weather & notification (email/WA) TETAP placeholder karena
  // memang belum ada sumber datanya (lihat kontrak API: "External
  // weather/sensor; not confirmed Solarman", belum ada Notification
  // service) — bukan kelalaian.
  // ===========================================================
  const projects = {

    tawabi: {
      label: "PLTS Tawabi",
      _coords: { lat: -0.536368, lng: 127.234187 }, // Halmahera Utara — dipakai untuk fetch cuaca Open-Meteo
      summary: {
        name: "PLTS Tawabi",
        location: "Halmahera Utara, Maluku Utara",
        capacityKwp: 0,
        panelCount: 0,
        commissionDate: "—",
        owner: "—",
        status: "offline",
        lastUpdate: "—"
      },
      power: { now: 0, trendPct: 0, trendDir: "up", trendAvailable: true },
      todayEnergy: { actual: 0, expected: 1 },
      health: { pct: 0 },
      performance: { ratio: 0, efficiency: 0 },
      weather: { tempC: 0, condition: "Not available", humidity: 0, windSpeed: 0, irradiance: 0 },
      energy: { today: 0, week: 0, month: 0, total: 0, peakKw: 120, dailyBase: 120 },
      alerts: [],
      notification: { email: 0, wa: 0, last: "—", lastTime: "—", delivery: "pending" },
      battery: { soc: 0, status: "idle", health: 0, online: 0, total: 2, cycles: 0 },
      inverter: { online: 0, total: 2, healthy: 0, fault: 0, communication: "Unknown" },
      devices: [
        { name: "PV Panel", icon: "fa-solar-panel", online: 0, total: 0, status: "warning" },
        { name: "Inverter", icon: "fa-plug-circle-bolt", online: 0, total: 2, status: "warning" },
        { name: "Battery", icon: "fa-car-battery", online: 0, total: 2, status: "warning" },
        { name: "Gateway", icon: "fa-wifi", online: 0, total: 0, status: "warning" },
        { name: "Sensor", icon: "fa-satellite-dish", online: 0, total: 0, status: "warning" }
      ],
      activity: [],
      maintenance: { nextScheduled: null, lastCompleted: null, predictive: [] }
    }

  };

  // ===========================================================
  // Proyek baru dari halaman "Add New Project" (window.PC_getUserProjects()).
  // Belum punya telemetry/BMS/inverter real seperti Tawabi, jadi
  // didaftarkan dengan data kosong (skeleton) supaya bisa dipilih di
  // project switcher tapi TIDAK menampilkan data Tawabi.
  // ===========================================================
  function pdBuildEmptyProject(userProject) {
    return {
      label: userProject.name,
      _coords: (Number.isFinite(userProject.lat) && Number.isFinite(userProject.lng))
        ? { lat: userProject.lat, lng: userProject.lng }
        : null,
      summary: {
        name: userProject.name,
        location: userProject.location || "—",
        capacityKwp: 0,
        panelCount: 0,
        commissionDate: "—",
        owner: userProject.partner || "—",
        status: "offline",
        lastUpdate: "—"
      },
      power: { now: 0, trendPct: 0, trendDir: "up", trendAvailable: true },
      todayEnergy: { actual: 0, expected: 1 },
      health: { pct: 0 },
      performance: { ratio: 0, efficiency: 0 },
      weather: { tempC: 0, condition: "Not available", humidity: 0, windSpeed: 0, irradiance: 0 },
      energy: { today: 0, week: 0, month: 0, total: 0, peakKw: 0, dailyBase: 0 },
      alerts: [],
      notification: { email: 0, wa: 0, last: "—", lastTime: "—", delivery: "pending" },
      battery: { soc: 0, status: "idle", health: 0, online: 0, total: 0, cycles: 0 },
      inverter: { online: 0, total: 0, healthy: 0, fault: 0, communication: "Unknown" },
      devices: [
        { name: "PV Panel", icon: "fa-solar-panel", online: 0, total: 0, status: "warning" },
        { name: "Inverter", icon: "fa-plug-circle-bolt", online: 0, total: 0, status: "warning" },
        { name: "Battery", icon: "fa-car-battery", online: 0, total: 0, status: "warning" },
        { name: "Gateway", icon: "fa-wifi", online: 0, total: 0, status: "warning" },
        { name: "Sensor", icon: "fa-satellite-dish", online: 0, total: 0, status: "warning" }
      ],
      activity: [],
      maintenance: { nextScheduled: null, lastCompleted: null, predictive: [] }
    };
  }

  function pdRegisterUserProjects() {
    if (typeof window.PC_getUserProjects !== "function") return;
    window.PC_getUserProjects().forEach((up) => {
      if (!projects[up.id]) projects[up.id] = pdBuildEmptyProject(up);
    });
  }

  // ===========================================================
  // SEMUA PROYEK DARI CORE API (GET /api/v1/projects, §5.1 dokumentasi)
  // ---------------------------------------------------------------
  // Sebelumnya dropdown/pencarian di sini HANYA pernah menampilkan
  // "PLTS Tawabi" (satu-satunya id yang di-hardcode). Sekarang SEMUA
  // proyek yang terdaftar di Core API ikut didaftarkan sebagai chip,
  // supaya user bisa pilih proyek lain juga -- bukan cuma Tawabi.
  //
  // Tawabi tetap pakai jalur lama (pdLoadRealTawabiProject, key
  // "tawabi") karena sudah lengkap & teruji; proyek API lainnya
  // didaftarkan dulu sebagai skeleton KOSONG (murah, cukup untuk
  // muncul di dropdown), lalu detail/analytics/telemetry-nya baru
  // di-fetch LAZY -- sekali saja, saat proyek itu benar-benar dipilih
  // user (lihat pdLoadRealApiProject() & pemanggilnya di selectProject()) 
  // -- supaya init tidak perlu menunggu N proyek x M inverter sekaligus.
  // ===========================================================
  async function pdFetchApiProjectsList() {
    try {
      const list = await edashApiFetch("/projects");
      if (Array.isArray(list)) return list;
      if (Array.isArray(list?.projects)) return list.projects;
      return [];
    } catch (e) {
      console.warn("[project-detail] Gagal ambil GET /projects (daftar seluruh proyek):", e.message);
      return [];
    }
  }

  function pdBuildApiProjectSkeleton(p) {
    const name = p.project_name || p.projectName || p.name || "Proyek";
    const lat = Number(p.latitude ?? p.lat);
    const lng = Number(p.longitude ?? p.lng);
    return {
      label: name,
      _apiProjectId: p.id,
      _realDataLoaded: false,
      _coords: (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null,
      summary: {
        name,
        location: pdCleanLocation(p.location) || "—",
        capacityKwp: 0,
        panelCount: 0,
        commissionDate: "—",
        owner: p.owner_name || p.ownerName || p.projectPartner || "—",
        status: "offline",
        lastUpdate: "—"
      },
      power: { now: 0, trendPct: 0, trendDir: "up", trendAvailable: false },
      todayEnergy: { actual: 0, expected: 1 },
      health: { pct: 0 },
      performance: { ratio: 0, efficiency: 0 },
      weather: { tempC: 0, condition: "Not available", humidity: 0, windSpeed: 0, irradiance: 0 },
      energy: { today: 0, week: 0, month: 0, total: 0, peakKw: 0, dailyBase: 0 },
      alerts: [],
      notification: { email: 0, wa: 0, last: "—", lastTime: "—", delivery: "pending" },
      battery: { soc: 0, status: "idle", health: 0, online: 0, total: 0, cycles: 0 },
      inverter: { online: 0, total: 0, healthy: 0, fault: 0, communication: "Unknown" },
      devices: [
        { name: "PV Panel", icon: "fa-solar-panel", online: 0, total: 0, status: "warning" },
        { name: "Inverter", icon: "fa-plug-circle-bolt", online: 0, total: 0, status: "warning" },
        { name: "Battery", icon: "fa-car-battery", online: 0, total: 0, status: "warning" },
        { name: "Gateway", icon: "fa-wifi", online: 0, total: 0, status: "warning" },
        { name: "Sensor", icon: "fa-satellite-dish", online: 0, total: 0, status: "warning" }
      ],
      activity: [],
      maintenance: { nextScheduled: null, lastCompleted: null, predictive: [] }
    };
  }

  // Daftarkan tiap proyek dari GET /projects sebagai chip, kalau belum
  // ada (mis. belum jadi "tawabi" atau proyek lokal user). Dipanggil
  // tiap kali tab ini dibuka -- murah, cuma nambah key yang belum ada.
  function pdRegisterApiProjects(list) {
    (list || []).forEach((p) => {
      if (!p || !p.id) return;
      if (p.id === PD_TAWABI_PROJECT_ID) return; // sudah ada sebagai "tawabi", jalur detailnya lebih lengkap
      if (!projects[p.id]) projects[p.id] = pdBuildApiProjectSkeleton(p);
    });
  }

  // Muat detail lengkap (project + analytics + tiap unit/inverter
  // telemetry) untuk SATU proyek Core API selain Tawabi -- pola yang
  // sama persis dengan pdLoadRealTawabiProject() di bawah, tapi
  // generik untuk id proyek manapun. Dipanggil lazy sekali per proyek,
  // saat proyek itu pertama kali dipilih user (lihat selectProject()).
  async function pdLoadRealApiProject(localId) {
    const target = projects[localId];
    if (!target || target._realDataLoaded) return;
    const apiId = target._apiProjectId || localId;

    try {
      const project = await edashApiFetch(`/projects/${apiId}`);
      target.summary.location = pdCleanLocation(project.location) || target.summary.location;
      target.summary.owner = project.owner_name || project.ownerName || target.summary.owner;

      // PENTING: JANGAN pakai pdExtractTawabiSystems/pdExtractDevicesForSystem
      // di sini -- keduanya fallback ke ID system/device Tawabi kalau
      // project.systems/devices kosong (aman dulu karena cuma dipakai utk
      // Tawabi). Untuk proyek API lain, kalau memang belum ada system/
      // device terpasang (project baru/kosong), jangan sampai malah
      // menampilkan telemetry Tawabi -- cukup skip pengambilan unit,
      // biarkan angka realtime tetap dari analytics saja (§5.2).
      let systemsMeta = project.systems || project.units || [];

      // Fallback KHUSUS Kasdam — lihat catatan PD_KASDAM_FALLBACK_DEVICES
      // di atas. Kalau proyek Kasdam ketemu di Core API tapi
      // project.systems/units kosong, tetap render 2 unit (Grup 1 & 2)
      // pakai Device ID konkret dari dokumentasi PDF, bukan tab kosong.
      const projectNameForFallback = project.project_name || project.projectName || project.name || "";
      if (!systemsMeta.length && PD_KASDAM_PROJECT_NAME_RE.test(projectNameForFallback)) {
        console.warn(`[project-detail] Proyek Kasdam (${apiId}) tidak membawa systems/units ternested, pakai fallback PD_KASDAM_FALLBACK_DEVICES dari dokumentasi PDF.`);
        systemsMeta = PD_KASDAM_FALLBACK_DEVICES.map((d) => ({ id: null, name: d.systemLabel, _kasdamDevice: d }));
      }

      const jobs = [];
      systemsMeta.forEach((system, i) => {
        const devicesArr = (system && system._kasdamDevice)
          ? [system._kasdamDevice]
          : (system && (system.devices || system.inverters)) || [];
        const matched = devicesArr.length
          ? devicesArr
          : (project.devices || project.inverters || []).filter((d) => (d.system_id || d.systemId) === system?.id);
        matched.forEach((device) => {
          jobs.push(() => pdLoadOneTawabiUnit(system, device, i));
        });
      });

      const [analytics, units] = await Promise.all([
        edashApiFetch(`/projects/${apiId}/analytics`).catch((e) => {
          console.warn(`[project-detail] Gagal ambil /projects/${apiId}/analytics:`, e.message);
          return null;
        }),
        // MERGE: batasi 2 device sekaligus lewat pdRunBatched (bukan
        // Promise.all polos atas SEMUA unit proyek) -- mengurangi lonjakan
        // koneksi bersamaan ke backend walau tiap unit sendiri sudah
        // ringan (telemetry/latest + histori 1 hari saja, lihat
        // pdLoadOneTawabiUnit).
        pdRunBatched(jobs, 2)
      ]);
      const validUnits = units.filter((u) => u.telemetry);

      if (analytics) {
        target.summary.location = analytics.location || target.summary.location;
        target.summary.capacityKwp = Math.round(analytics.totalPeakKwp || target.summary.capacityKwp);
        target.energy.peakKw = analytics.totalPeakKwp || target.energy.peakKw;

        const todayKwh = analytics.realtime?.energyTodayKwh ?? 0;
        const expectedTodayKwh = analytics.mlMetrics?.expectedEnergyTodayKwh || todayKwh || 1;
        target.todayEnergy = { actual: +todayKwh.toFixed(1), expected: +expectedTodayKwh.toFixed(1) };
        target.energy.today = +todayKwh.toFixed(1);
        target.energy.dailyBase = +expectedTodayKwh.toFixed(1);
        target.power.now = +(analytics.realtime?.totalCurrentPowerKw || 0).toFixed(2);
        target.power.trendAvailable = false;

        target.performance.ratio = Math.round(analytics.mlMetrics?.performanceRatioPct || 0);
        target.performance.efficiency = Math.round(analytics.mlMetrics?.pvHealthPct || target.performance.efficiency);
        target.health.pct = Math.round(analytics.mlMetrics?.pvHealthPct || target.health.pct);

        target.energy.total = +((analytics.lifetime?.totalEnergyKwh) || target.energy.total).toFixed(1);
        target._environmentalSource = {
          source: "eDashboard Core API GET /projects/:id/analytics",
          co2ReductionKgLifetime: analytics.lifetime?.co2ReductionKg,
          treesEquivalentLifetime: analytics.lifetime?.treesEquivalent,
          costSavingsIdrLifetime: analytics.lifetime?.costSavingsIdr,
          todaySavingsIdr: analytics.realtime?.todaySavingsIdr,
          todayCo2ReductionKg: analytics.realtime?.todayCo2ReductionKg
        };
      }

      const withBattery = validUnits.filter((u) => u.telemetry?.battery && u.telemetry.battery.voltage != null);
      if (withBattery.length) {
        const socAvg = pdAvgOf(...withBattery.map((u) => u.telemetry.battery.soc).filter((n) => n != null));
        const sohAvg = pdAvgOf(...withBattery.map((u) => u.telemetry.battery.soh).filter((n) => n != null));
        const isCharging = withBattery.some((u) => (u.telemetry.battery.status || "").toLowerCase() === "charging");
        target.battery = {
          soc: Math.round(socAvg), status: isCharging ? "charging" : "idle",
          health: Math.round(sohAvg), online: withBattery.length, total: validUnits.length || withBattery.length,
          cycles: 0
        };
        if (!analytics?.mlMetrics?.pvHealthPct) target.health.pct = Math.round(sohAvg);
      }

      if (validUnits.length) {
        target._energyProduction = pdBuildEnergyProduction(validUnits, analytics);
        target._realPerformance = pdBuildRealPerformance(validUnits);
      }

      if (validUnits.length) {
        pdApplyInverterSummary(target, validUnits.map((u, i) => pdMapUnitToSystemLike(u, i)), "tawabi");
        target.summary.lastUpdate = pdRelativeTime(validUnits[0].telemetry?.lastSeen);
      }

      // Samakan status online/offline dengan Dashboard/Project Selector
      // (lihat pdSyncStatusWithLiveTelemetry di atas) -- pakai apiId asli
      // yang sudah di-resolve di awal fungsi ini, BUKAN literal "tawabi"
      // di atas (yang cuma dipakai pdApplyInverterSummary utk cross-check
      // System Information).
      await pdSyncStatusWithLiveTelemetry(target, apiId, target.summary.name);

      if (validUnits.length) {
        target.activity = validUnits
          .map((u) => {
            const diag = u.telemetry?.diagnostics || {};
            return {
              text: `${u.systemLabel}: modbus ${diag.modbusOk === false ? "terputus" : "OK"}, fault ${diag.faultCode ?? "-"}`,
              time: pdRelativeTime(u.telemetry?.lastSeen),
              type: diag.modbusOk === false ? "warning" : "info",
              _ts: u.telemetry?.lastSeen || 0
            };
          })
          .sort((a, b) => new Date(b._ts) - new Date(a._ts));
      }
    } catch (e) {
      console.warn(`[project-detail] Gagal memuat data real proyek ${apiId}:`, e.message);
    } finally {
      target._realDataLoaded = true;
    }
  }

  // ===========================================================
  // REAL DATA LOADER — PLTS Tawabi
  // Sekarang dipasangkan ke eDashboard Core API (backend Hono,
  // window.EDASH_BACKEND_API_BASE / edashApiFetch() dari
  // js/api-config.js) dengan pola YANG SAMA seperti System
  // Information (js/system-information.js), BUKAN lagi
  // server/data/tawabi-telemetry.json, server/data/battery-station/
  // tawabi-*.json, server/data/tawabi-energy-production.json,
  // server/data/tawabi-performance-24h.json, atau GET /api/systems
  // difilter "tawabi" (mini-backend server/server.js):
  //
  //   - GET /projects/:id                 -> Project master + unit
  //     sistem/inverter terpasang (§5.1 dokumentasi).
  //   - GET /projects/:id/analytics       -> Energy summary, Weekly
  //     analysis (performance ratio), Health, Environmental (§5.2).
  //   - GET /devices/:id/telemetry/latest -> Battery summary,
  //     Performance Analytics (nilai "current"), status/fault code
  //     per unit (§4.3), digabung antar Grup 1/Grup 2.
  //   - GET /devices/:id/telemetry/history -> Energy Production
  //     chart (Actual vs Expected, hari ini + 30 hari terakhir),
  //     Performance Analytics 24-jam (sparkline), dan katalog variabel
  //     "Add Graph" (90 hari, semua kategori: overview/pvStrings/
  //     ac3Phase/grid/load/battery/diagnostics), dari time-series
  //     ternormalisasi Rev3 (§4.5/§7) — lihat PD_GRAPH_VAR_DEFS /
  //     pdBuildGraphCatalogFromUnits di bawah.
  //
  // /api/systems (mini-backend lama) TETAP dipakai, tapi HANYA untuk
  // proyek user lain (mis. "Elvi Company" dari Add New Project) yang
  // belum punya proyek di Core API — lihat pdApplyRealDataForUserProjects.
  // ===========================================================
  const PD_TAWABI_PROJECT_ID = "b0000000-0000-0000-0000-000000000001";
  const PD_TAWABI_SYSTEM_ID = "c0000000-0000-0000-0000-000000000001";
  const PD_TAWABI_DEVICE_ID = "979153e0-97b3-11f1-8c86-25274e65e397";
  const PD_TAWABI_TIMEZONE = "Asia/Jayapura";

  // ---------------------------------------------------------
  // REAL DATA — PLTS Kasdam, dari
  // DOKUMENTASI_API_eDASHBOARD_360ENERGY_KASDAM.pdf (§4.1, §4.2).
  // Sama seperti di js/system-information.js: project/system ID contoh
  // di PDF Kasdam ini ("b0000000-...-0001" / "c0000000-...-0001") PERSIS
  // SAMA dengan tebakan PD_TAWABI_PROJECT_ID/PD_TAWABI_SYSTEM_ID di atas
  // -- kemungkinan besar cuma UUID contoh generik di template dokumentasi,
  // BUKAN ID asli. Jadi proyek Kasdam TETAP di-resolve generik lewat
  // pdLoadRealApiProject(apiId) pakai UUID ASLI dari GET /projects, TIDAK
  // ditebak dari PD_TAWABI_PROJECT_ID.
  //
  // Device ID + Access Token di bawah ini BEDA -- itu konkret per
  // inverter (SN F01257000587/588), disebut sama persis di 2 section PDF
  // berbeda, jadi dipakai sebagai FALLBACK TERAKHIR SAJA kalau
  // project.systems/units Kasdam kosong di response /projects/:id.
  const PD_KASDAM_PROJECT_NAME_RE = /kasdam/i;
  const PD_KASDAM_FALLBACK_DEVICES = [
    { id: "7ee849a0-9ad5-11f1-8c86-25274e65e397", name: "Inverter PLTS Kasdam 01", deviceSn: "F01257000587", systemLabel: "PLTS KASDAM GRUP 1" },
    { id: "abe8c180-9ad7-11f1-8c86-25274e65e397", name: "Inverter PLTS Kasdam 02", deviceSn: "F01257000588", systemLabel: "PLTS KASDAM GRUP 2" }
  ];

  function pdApiBase() {
    return window.EDASH_API_BASE || "http://localhost:3001";
  }

  function pdAvgOf(...nums) {
    const valid = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
    if (!valid.length) return 0;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }
  function pdSumIgnoreNull(nums) {
    const valid = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
    return valid.reduce((a, b) => a + b, 0);
  }

  // Tanggal lokal (WIT) "YYYY-MM-DD" dari sebuah epoch ms -- dipakai
  // buat bucket harian chart Energy Production, supaya batas hari
  // mengikuti waktu lokasi PLTS Tawabi, bukan UTC/waktu browser user.
  function pdDateInTz(ts, tz) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ts));
    const get = (t) => parts.find((p) => p.type === t)?.value || "00";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }
  function pdHourInTz(ts, tz) {
    return parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date(ts)), 10) % 24;
  }
  function pdLastNDates(n, tz) {
    const out = [];
    const now = Date.now();
    for (let i = n - 1; i >= 0; i--) out.push(pdDateInTz(now - i * 86400000, tz));
    return out;
  }

  // Kelompokkan time-series {ts,value}[] jadi 24 bucket per jam (indeks
  // 0-23 = jam lokal WIT), dipakai buat chart "Today" (Energy
  // Production) & sparkline 24-jam Performance Analytics.
  function pdBucketByHourOfDay(series, tz) {
    const buckets = Array.from({ length: 24 }, () => []);
    (series || []).forEach((pt) => {
      const h = pdHourInTz(pt.ts, tz);
      const v = Number(pt.value);
      if (Number.isFinite(v)) buckets[h].push(v);
    });
    return buckets.map((arr) => (arr.length ? pdAvgOf(...arr) : null));
  }

  // Label 24 jam untuk window ROLLING "24 jam terakhir dari sekarang"
  // (bukan "hari kalender ini") -- jam terlama di indeks 0, "Now" di
  // indeks 23. Dipakai bareng pdBucketLast24hRolling di bawah supaya
  // sumbu-X selalu konsisten dengan cara data itu di-bucket.
  function pdRollingHourLabels(tz) {
    const now = Date.now();
    const HOUR = 3600000;
    return Array.from({ length: 24 }, (_, i) => {
      if (i === 23) return "Now";
      const ts = now - (23 - i) * HOUR;
      return `${new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date(ts))}:00`;
    });
  }

  // Kelompokkan time-series {ts,value}[] dari window ROLLING 24 jam
  // (mis. hasil GET /devices/:id/telemetry/history?startTs=now-24h&endTs=now,
  // §4.5 dokumentasi) jadi 24 bucket per JAM-DIHITUNG-MUNDUR-DARI-SEKARANG
  // -- BUKAN per "jam lokal 0-23" seperti pdBucketByHourOfDay di atas.
  //
  // Kenapa ini penting: window rolling 24 jam SERING melintasi 2 tanggal
  // kalender berbeda (mis. sekarang jam 21:47 -> window-nya kemarin
  // 21:47 s/d hari ini 21:47). pdBucketByHourOfDay mengelompokkan HANYA
  // berdasar jam-lokal (0-23) tanpa peduli tanggal, jadi utk jam "21" dia
  // mencampur pembacaan KEMARIN jam 21 (mis. register lifetime yang
  // masih rendah) dengan pembacaan HARI INI jam 21 (register lifetime
  // yang sudah tinggi) lalu dirata-rata -- hasilnya nilai jam 21 jadi
  // "anjlok" tiba-tiba dibanding jam 20, walau nilainya (Cumulative
  // Production/register lifetime) SEHARUSNYA cuma naik terus. Fungsi ini
  // membagi bucket berdasar SEBERAPA LAMA YANG LALU (24 bucket 1-jam
  // dihitung mundur dari waktu sekarang), jadi tidak pernah mencampur 2
  // tanggal ke bucket yang sama.
  //
  // useMax=true: bucket pakai nilai MAKSIMUM per jam (register kumulatif
  // §7 dokumentasi, sama seperti pdBucketByDateMax). useMax=false: rata-
  // rata (variabel gauge sesaat: voltage/current/power/temp/dst).
  function pdBucketLast24hRolling(series, useMax) {
    const now = Date.now();
    const HOUR = 3600000;
    const buckets = Array.from({ length: 24 }, () => []);
    (series || []).forEach((pt) => {
      const ageMs = now - pt.ts;
      if (ageMs < 0 || ageMs > 24 * HOUR) return; // di luar window 24 jam, abaikan
      const idxFromNow = Math.min(23, Math.floor(ageMs / HOUR)); // 0 = jam paling baru
      const i = 23 - idxFromNow; // 0 = paling lama ... 23 = paling baru/"Now"
      const v = Number(pt.value);
      if (Number.isFinite(v)) buckets[i].push(v);
    });
    return buckets.map((arr) => {
      if (!arr.length) return null;
      return useMax ? Math.max(...arr) : pdAvgOf(...arr);
    });
  }

  // Kelompokkan time-series jadi { "YYYY-MM-DD": nilaiMaksimum } --
  // dipakai buat register kumulatif harian (overview.energyToday,
  // §7 dokumentasi: reset tiap hari, jadi nilai TERBESAR dalam 1 hari
  // = total energi hari itu).
  function pdBucketByDateMax(series, tz) {
    const map = {};
    (series || []).forEach((pt) => {
      const d = pdDateInTz(pt.ts, tz);
      const v = Number(pt.value);
      if (!Number.isFinite(v)) return;
      if (!(d in map) || v > map[d]) map[d] = v;
    });
    return map;
  }

  // Kelompokkan time-series jadi { "YYYY-MM-DD": nilaiRata-rata } --
  // dipakai buat variabel non-kumulatif (voltage/current/power/temp/dst,
  // yang naik-turun sepanjang hari, bukan register yang direset tiap
  // hari) di catalog "Add Graph" (lihat pdBuildGraphCatalogFromUnits).
  function pdBucketByDateAvg(series, tz) {
    const sums = {}, counts = {};
    (series || []).forEach((pt) => {
      const d = pdDateInTz(pt.ts, tz);
      const v = Number(pt.value);
      if (!Number.isFinite(v)) return;
      sums[d] = (sums[d] || 0) + v;
      counts[d] = (counts[d] || 0) + 1;
    });
    const map = {};
    Object.keys(sums).forEach((d) => { map[d] = sums[d] / counts[d]; });
    return map;
  }

  // Ambil nilai bersarang dari object pakai dotted path, mis.
  // pdGetPath(telemetry, "pvStrings.string1.voltage") ->
  // telemetry.pvStrings.string1.voltage. Dipakai buat "membongkar"
  // skema ternormalisasi Rev3 (overview/pvStrings/ac3Phase/grid/load/
  // battery/diagnostics, §4.5/§7 dokumentasi) jadi daftar variabel
  // flat buat catalog "Add Graph".
  function pdGetPath(obj, path) {
    return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
  }

  function pdRelativeTime(iso) {
    if (!iso) return "—";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "—";
    const diffMin = Math.round((Date.now() - then) / 60000);
    if (diffMin < 1) return "Baru saja";
    if (diffMin < 60) return `${diffMin} menit lalu`;
    const diffHour = Math.round(diffMin / 60);
    if (diffHour < 24) return `${diffHour} jam lalu`;
    return `${Math.round(diffHour / 24)} hari lalu`;
  }

  // Format tanggal commission ("YYYY-MM-DD", dari field devices.installationDate
  // -- lihat §3.2.1 dokumentasi Core API, contoh response registrasi device)
  // jadi human-readable ala "18 Feb 2026". Balikin null kalau tanggalnya
  // kosong/tidak valid, supaya caller bisa fallback ke nilai lama / "-".
  function pdFormatCommissionDate(dateStr) {
    if (!dateStr || dateStr === "-") return null;
    const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }

  // Buang prefix Google Plus Code (mis. "F68P+46, ") dari string lokasi
  // proyek supaya yang tampil di header langsung "Desa Tawabi, ..." --
  // plus code-nya sendiri tetap apa adanya di data asli (project.location /
  // analytics.location), cuma dibersihkan pas mau ditampilkan di UI.
  function pdCleanLocation(loc) {
    if (!loc) return loc;
    return loc.replace(/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\s*,\s*/i, "").trim();
  }

  // Cari proyek Tawabi di Core API -- pola identik findTawabiProject()
  // di js/system-information.js (coba ID langsung dari dokumentasi
  // dulu, fallback cari by nama kalau 404).
  async function pdFindTawabiProject() {
    try {
      const project = await edashApiFetch(`/projects/${PD_TAWABI_PROJECT_ID}`);
      console.log("[project-detail] GET /projects/:id (Tawabi, direct ID) raw response:", project);
      return project;
    } catch (e) {
      console.warn("[project-detail] ID Tawabi dari dokumentasi tidak ditemukan langsung, coba cari by nama:", e.message);
    }
    try {
      const list = await edashApiFetch("/projects");
      const found = (list || []).find((p) => (p.project_name || p.projectName || p.name || "").toLowerCase().includes("tawabi"));
      if (!found) return null;
      const detail = await edashApiFetch(`/projects/${found.id}`);
      console.log("[project-detail] GET /projects/:id (Tawabi, hasil pencarian nama) raw response:", detail);
      return detail;
    } catch (e) {
      console.warn("[project-detail] Gagal mencari proyek Tawabi:", e.message);
      return null;
    }
  }

  // PLTS Tawabi punya 2 unit (Grup 1 & Grup 2) -- sama seperti System
  // Information, semua unit diambil (bukan cuma 1), lalu digabung/
  // dijumlah di pdLoadRealTawabiProject().
  function pdExtractTawabiSystems(project) {
    const systemsArr = project.systems || project.units || [];
    if (systemsArr.length) return systemsArr;
    return [{ id: PD_TAWABI_SYSTEM_ID }];
  }
  function pdExtractDevicesForSystem(project, system, systemIndex, totalSystems) {
    const devicesArr = (system && (system.devices || system.inverters)) || [];
    if (devicesArr.length) return devicesArr;
    const projectDevices = project.devices || project.inverters || [];
    const matched = projectDevices.filter((d) => (d.system_id || d.systemId) === system?.id);
    if (matched.length) return matched;
    if (projectDevices.length === totalSystems) {
      return projectDevices[systemIndex] ? [projectDevices[systemIndex]] : [];
    }
    if (systemIndex === 0) return projectDevices.length ? projectDevices : [{ id: PD_TAWABI_DEVICE_ID }];
    return [];
  }

  // MERGE (dari perbaikan temen tim frontend): batasi jumlah request
  // histori yang jalan BERSAMAAN, biar tidak "Thundering Herd" walau
  // sumbernya cuma beberapa unit/device -- lihat §5.2 Laporan Optimasi
  // Telemetry API Rev3. `taskFns` adalah array FUNGSI tanpa argumen
  // (bukan Promise yang sudah mulai jalan), supaya device/rentang
  // berikutnya baru benar-benar mulai fetch begitu ada slot kosong,
  // bukan semuanya nembak sekaligus lalu antre di connection pool
  // backend. Dipakai di pdLoadOneTawabiUnit (page load) & di
  // pdFetchGraphUnitsForProject (katalog "Add Graph") di bawah --
  // TIDAK mengubah KAPAN fetch itu boleh mulai (tetap patuh lazy-
  // loading/on-demand poin 1 & 2), cuma membatasi BERAPA yang boleh
  // jalan bersamaan begitu memang sudah waktunya fetch.
  async function pdRunBatched(taskFns, limit) {
    const results = new Array(taskFns.length);
    let next = 0;
    async function worker() {
      while (next < taskFns.length) {
        const i = next++;
        results[i] = await taskFns[i]();
      }
    }
    const workerCount = Math.max(1, Math.min(limit, taskFns.length));
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
  }

  // Ambil 1 unit sekaligus: telemetry/latest (nilai "current") + 1
  // rentang history (1 hari, utk chart "Today"/sparkline 24-jam) --
  // SEMUA PARALEL, sama seperti loadOneTawabiCard() di
  // system-information.js.
  //
  // FIX (poin 1 & 2, disclaimer §5): dulu di sini JUGA ikut fetch
  // histori 30 HARI per unit (pdFetchDeviceHistory(deviceId, 30)),
  // dan karena pdLoadOneTawabiUnit() ini dipanggil lewat Promise.all
  // untuk SEMUA unit/device sekaligus begitu halaman project-detail
  // dibuka (lihat pdLoadRealTawabiProject/pdLoadRealApiProject), itu
  // persis pola "pre-fetch histori 30 hari untuk seluruh unit device
  // secara paralel saat halaman baru dibuka" (Thundering Herd) yang
  // dilarang laporan optimasi -- padahal hasilnya (history30d) HANYA
  // dipakai buat mengisi `_energyProduction.daily` punya chart "Energy
  // Production (Actual vs Expected)" versi lama yang canvas-nya
  // (#pdEnergyChart) SUDAH TIDAK ADA lagi di project-detail.html (sudah
  // diganti kartu "Environmental Impact") -- jadi fetch itu 100% sia-
  // sia, dibayar tiap kali halaman dibuka tanpa pernah benar-benar
  // dipakai. Dihapus di sini; kalau chart "Energy Production" itu
  // suatu saat dihidupkan lagi, fetch 30-harinya WAJIB jadi on-demand
  // (dipanggil saat chart itu benar-benar mau dirender), BUKAN
  // dikembalikan ke sini.
  //
  // CATATAN MERGE: versi temen tim frontend menambahkan lagi fetch
  // history30d di sini (buat idupin chart Energy Production), dibatasi
  // pdRunBatched(jobs, 2) di pemanggilnya. SENGAJA TIDAK diambil --
  // itu tetap pre-fetch histori 30 hari utk SEMUA unit begitu halaman
  // dibuka (cuma throttled, bukan on-demand), jadi masih bisa ditandai
  // melanggar poin 1 laporan optimasi walau dampak CPU-nya lebih
  // kecil. Kalau chart Energy Production itu suatu saat memang mau
  // dihidupkan lagi, tambahkan fetch 30-harinya di titik render
  // chart-nya sendiri (on-demand), bukan di sini.
  // pdFetchDeviceHistoryRange -- versi generik dari pdFetchDeviceHistory
  // di bawah yang menerima startTs/endTs eksplisit (bukan cuma
  // "N hari ke belakang dari sekarang"), plus `intervalMs` OPSIONAL.
  // Dipakai juga oleh mode "Custom Range" kartu "Add Graph" (lihat
  // pdEnsureGraphCustomData) supaya rentang tanggal manapun yang
  // dipilih user bisa pakai titik RAW dari API. Kalau `intervalMs`
  // tidak diisi, backend yang menentukan interval-nya secara adaptif
  // dari lama rentang (sama seperti mode 7 Hari/30 Hari) -- kalau
  // diisi, backend WAJIB pakai interval itu persis (lihat
  // parseHistoryQuery() di telemetry.controller.ts: `interval` query
  // param mem-BYPASS pemanggilan calculateAdaptiveAggregation()
  // sepenuhnya).
  async function pdFetchDeviceHistoryRange(deviceId, startTs, endTs, intervalMs) {
    try {
      const intervalParam = intervalMs ? `&interval=${intervalMs}` : "";
      const raw = await edashApiFetch(`/devices/${deviceId}/telemetry/history?startTs=${startTs}&endTs=${endTs}${intervalParam}`);
      console.log(`[project-detail] GET /devices/${deviceId}/telemetry/history (custom ${startTs}-${endTs}, interval=${intervalMs || "auto"}) raw response:`, raw);
      return raw?.telemetry || null;
    } catch (e) {
      console.warn(`[project-detail] Gagal ambil telemetry/history custom untuk ${deviceId}:`, e.message);
      return null;
    }
  }
  async function pdFetchDeviceHistory(deviceId, rangeDays) {
    // BULATKAN EPOCH KE KELIPATAN 1 MENIT (Rev3 frontend disclaimer
    // §4) -- Date.now() mentah punya milidetik yang selalu berubah,
    // jadi endTs (dan startTs yang diturunkan darinya) berbeda di
    // setiap panggilan walau dalam detik yang sama, menyebabkan
    // cache miss permanen di backend. Math.floor(Date.now() / 60000)
    // * 60000 membulatkan ke bawah ke menit terdekat supaya beberapa
    // panggilan dalam menit yang sama menghasilkan endTs identik dan
    // bisa kena cache backend.
    const endTs = Math.floor(Date.now() / 60000) * 60000;
    const startTs = endTs - rangeDays * 24 * 60 * 60 * 1000;
    return pdFetchDeviceHistoryRange(deviceId, startTs, endTs);
  }
  async function pdLoadOneTawabiUnit(system, device, unitIndex) {
    const deviceId = (device && (device.id || device.thingsboardDeviceId)) || PD_TAWABI_DEVICE_ID;
    const systemLabel = (system && (system.system_name || system.systemName || system.name)) || `PLTS Tawabi Grup ${unitIndex + 1}`;
    // Tanggal commission per-unit -- CONFIRMED dari real response
    // GET /projects/:id: field-nya "installation_date" (snake_case) di
    // tiap object system.inverters[]. Fallback ke system.installed_date
    // (juga snake_case, level system bukan device) buat jaga-jaga kalau
    // suatu saat array inverters kosong tapi system-nya masih ada.
    const installedDate =
      (device && (device.installationDate || device.installation_date)) ||
      (system && (system.installedDate || system.installed_date)) ||
      null;
    const [telemetry, history1d] = await Promise.all([
      edashApiFetch(`/devices/${deviceId}/telemetry/latest`).catch((e) => {
        console.warn(`[project-detail] Gagal ambil telemetry unit #${unitIndex + 1}:`, e.message);
        return null;
      }),
      pdFetchDeviceHistory(deviceId, 1)
    ]);
    return { deviceId, systemLabel, installedDate, telemetry, history1d };
  }

  // "System object" ala System Information (basic/status/systemOverview/
  // deviceOverview/diagnostics), dibangun dari 1 unit Tawabi Core API --
  // dipakai supaya pdApplyInverterSummary() (generik, dipakai juga oleh
  // proyek user lain) bisa langsung menerima data Tawabi tanpa perlu
  // fungsi terpisah. historicalMaintenance/futureMaintenance sengaja []
  // (belum ada endpoint list-nya di Core API, sama seperti System
  // Information -- BUKAN kelalaian).
  function pdMapUnitToSystemLike(unit, unitIndex) {
    const diag = unit.telemetry?.diagnostics || {};
    // PERBAIKAN: kalau /telemetry/latest gagal total (unit.telemetry ===
    // null, lihat pdFetchOneUnit di atas -- device unreachable), diag jadi
    // {} kosong dan `diag.modbusOk === false` evaluasinya FALSE (undefined
    // !== false), jadi jatuh ke branch "online". Itu kebalikan dari
    // maksudnya -- definisi "online" yang dipakai Dashboard/Project
    // Selector (lihat window.__psGetLiveDataForProject) justru "live
    // telemetry BERHASIL dibaca", jadi gagal total telemetry harus
    // "offline", bukan default "online". Sekarang eksplisit dicek dua
    // kondisi: fetch gagal total ATAU modbusOk === false -> "offline".
    const telemetryOk = !!unit.telemetry;
    return {
      id: `tawabi-core-${unitIndex}`,
      basic: { systemName: unit.systemLabel },
      status: (!telemetryOk || diag.modbusOk === false) ? "offline" : "online",
      systemOverview: { installedDate: unit.installedDate || "-" },
      deviceOverview: {
        lastSeen: unit.telemetry?.lastSeen || null,
        modbusStatus: (telemetryOk && diag.modbusOk !== false) ? "Online" : "Offline"
      },
      diagnostics: { faultCode: diag.faultCode ?? "00_00" },
      historicalMaintenance: [],
      futureMaintenance: []
    };
  }

  // Chart "Energy Production" (Actual vs Expected) -- actual: jumlah
  // riil overview.pvTotalPower (fallback currentPower) per-jam hari ini
  // & register kumulatif overview.energyToday per-hari (30 hari
  // terakhir), dijumlah antar unit (Grup 1 + Grup 2, additive karena 2
  // inverter fisik terpisah). Expected: actual dibagi performance
  // ratio REAL dari analytics.mlMetrics.performanceRatioPct (§5.2) --
  // BUKAN kurva model/asumsi seperti versi dummy sebelumnya, murni
  // rasio yang sudah dihitung backend dari data lintas-inverter.
  function pdBuildEnergyProduction(validUnits, analytics) {
    const ratio = (analytics?.mlMetrics?.performanceRatioPct || 0) / 100;

    const hourlyPerUnit = validUnits.map((u) =>
      pdBucketByHourOfDay(u.history1d?.overview?.pvTotalPower || u.history1d?.overview?.currentPower || [], PD_TAWABI_TIMEZONE)
    );
    const actualKwh = Array.from({ length: 24 }, (_, h) => {
      const sumW = pdSumIgnoreNull(hourlyPerUnit.map((arr) => arr[h]).filter((n) => n != null));
      return +(sumW / 1000).toFixed(2);
    });
    const expectedKwh = actualKwh.map((v) => (ratio > 0 ? +(v / ratio).toFixed(2) : v));

    // FIX (poin 1 & 2, disclaimer §5): `daily` (30 hari) dulu dihitung
    // dari history30d yang di-fetch PARALEL untuk semua unit begitu
    // halaman dibuka -- itu satu-satunya alasan history30d ada, dan
    // satu-satunya konsumen `daily` ini adalah chart "Energy Production
    // (Actual vs Expected)" versi lama yang canvas-nya (#pdEnergyChart)
    // sudah tidak ada lagi di project-detail.html (lihat catatan FIX di
    // pdLoadOneTawabiUnit di atas). Karena history30d sudah dihapus dari
    // fetch awal, `daily` sekarang array kosong -- kalau chart lama itu
    // suatu saat dihidupkan lagi, isi ini WAJIB diisi dari fetch
    // on-demand terpisah (dipanggil saat chart-nya benar-benar mau
    // dirender), BUKAN dengan mengembalikan history30d ke sini.
    const daily = [];

    return { today: { actualKwh, expectedKwh }, daily };
  }

  // Performance Analytics (Battery/PV Voltage, Radiator Temp, Battery
  // Current/Power, Inverter Leak Current) -- sparkline 24-jam dari
  // telemetry/history REAL (battery.*/diagnostics.radiatorTemp/
  // pvStrings.string1.voltage, §4.3/§7 dokumentasi), "value" (angka
  // besar di kartu) dari telemetry/latest supaya selalu real-time
  // walau jam berjalan belum penuh terisi di history.
  function pdBuildRealPerformance(validUnits) {
    const labels = pdRollingHourLabels(PD_TAWABI_TIMEZONE);
    const fillZero = (arr) => arr.map((v) => (v == null ? 0 : +v.toFixed(2)));
    const combineAvg = (perUnit) => Array.from({ length: 24 }, (_, h) => {
      const vals = perUnit.map((arr) => arr[h]).filter((n) => n != null);
      return vals.length ? pdAvgOf(...vals) : null;
    });
    const combineSum = (perUnit) => Array.from({ length: 24 }, (_, h) => {
      const vals = perUnit.map((arr) => arr[h]).filter((n) => n != null);
      return vals.length ? pdSumIgnoreNull(vals) : null;
    });

    // pdBucketLast24hRolling (BUKAN pdBucketByHourOfDay) -- semua
    // variabel di sini adalah gauge sesaat (voltage/current/power/temp),
    // jadi useMax=false (rata-rata per jam), tapi tetap dibucket per
    // "jam-dihitung-mundur-dari-sekarang" supaya window rolling 24 jam
    // yang melintasi 2 tanggal kalender tidak mencampur data 2 hari
    // berbeda ke 1 bucket yang sama (lihat komentar pdBucketLast24hRolling).
    const batteryVoltage = fillZero(combineAvg(validUnits.map((u) => pdBucketLast24hRolling(u.history1d?.battery?.voltage || [], false))));
    const batteryCurrent = fillZero(combineSum(validUnits.map((u) => pdBucketLast24hRolling(u.history1d?.battery?.current || [], false))));
    const batteryPower = fillZero(combineSum(validUnits.map((u) => pdBucketLast24hRolling(u.history1d?.battery?.power || [], false))));
    const radiatorTemp = fillZero(combineAvg(validUnits.map((u) => pdBucketLast24hRolling(u.history1d?.diagnostics?.radiatorTemp || [], false))));
    const pvVoltage = fillZero(combineAvg(validUnits.map((u) => pdBucketLast24hRolling(u.history1d?.pvStrings?.string1?.voltage || [], false))));
    // Leak current inverter TIDAK ada di kontrak telemetry ternormalisasi
    // Rev3 (§4.3/§7 dokumentasi) -- tetap "-"/0, sama seperti System
    // Information, BUKAN dummy dihilangkan diam-diam.
    const leakCurrent = new Array(24).fill(0);

    const liveBatteryVoltage = pdAvgOf(...validUnits.map((u) => u.telemetry?.battery?.voltage).filter((n) => n != null));
    const livePvVoltage = pdAvgOf(...validUnits.map((u) => u.telemetry?.pvStrings?.string1?.voltage).filter((n) => n != null));
    const liveRadiatorTemp = validUnits.map((u) => u.telemetry?.diagnostics?.radiatorTemp).filter((n) => n != null);
    const liveBatteryCurrent = pdSumIgnoreNull(validUnits.map((u) => u.telemetry?.battery?.current).filter((n) => n != null));
    const liveBatteryPower = pdSumIgnoreNull(validUnits.map((u) => u.telemetry?.battery?.power).filter((n) => n != null));

    return {
      batteryVoltage: { title: "Battery Voltage", unit: "V", value: +liveBatteryVoltage.toFixed(1), decimals: 1, data: batteryVoltage, labels },
      pvVoltage: { title: "PV Voltage", unit: "V", value: +livePvVoltage.toFixed(0), decimals: 0, data: pvVoltage, labels },
      radiatorTemp: { title: "Inverter Performance", subtitle: "Radiator Temperature", unit: "°C", value: +(liveRadiatorTemp.length ? Math.max(...liveRadiatorTemp) : 0).toFixed(1), decimals: 1, data: radiatorTemp, labels },
      batteryCurrent: { title: "Battery Current", unit: "A", value: +liveBatteryCurrent.toFixed(1), decimals: 1, data: batteryCurrent, labels },
      batteryPower: { title: "Battery Power", unit: "W", value: Math.round(liveBatteryPower), decimals: 0, data: batteryPower, labels },
      leakCurrent: { title: "Inverter Leak Current", unit: "mA", value: 0, decimals: 0, data: leakCurrent, labels }
    };
  }

  // ===========================================================
  // Inverter Summary + Maintenance — GENERIC per project.
  // Dipakai baik buat Tawabi maupun proyek user (mis. Elvi Company),
  // supaya keduanya konsisten: masing-masing hanya menampilkan
  // system yang MEMANG ditandai basic.projectId == id proyek itu
  // (id yang sama dipakai System Information / Task Management).
  // ===========================================================
  // "Online" untuk keperluan agregasi status proyek -- menerima DUA
  // vocabulary status yang dipakai berbeda-beda di app ini:
  //   - unit Tawabi yang di-mapping sendiri oleh project-detail.js
  //     (pdMapUnitToSystemLike di atas) pakai "online"/"offline".
  //   - system dari System Information / server (mis. /api/systems,
  //     window.__siSystems) pakai "connected"/"pending"/"offline".
  // SEBELUMNYA pdApplyInverterSummary() di bawah cuma cek `=== "online"`
  // secara literal -- untuk system yang datang dari System Information
  // (vocabulary "connected"), itu TIDAK PERNAH match, jadi `online`
  // count selalu 0 dan status proyek di Project Overview SELALU
  // "Offline" walau System Information sendiri menampilkan system itu
  // "Connected". Helper ini menyatukan definisinya supaya kedua tab
  // (Project Overview & System Information) selalu sepakat.
  function pdIsSystemOnline(s) {
    return s && (s.status === "online" || s.status === "connected");
  }

  function pdApplyInverterSummary(target, projectSystems, projectId) {
    if (!projectSystems.length) return;

    const online = projectSystems.filter(pdIsSystemOnline).length;
    const faultCount = projectSystems.filter((s) => (s.diagnostics?.faultCode || "00_00") !== "00_00").length;

    target.summary.status = online > 0 ? "online" : "offline";

    // Cross-check terhadap System Information (kalau tab itu sudah pernah
    // dimuat di sesi ini -- lihat window.__siGetProjectOnlineStatus di
    // js/system-information.js). null artinya System Information belum
    // punya data proyek ini sama sekali, jadi TIDAK menimpa apa-apa;
    // kalau ada dan BEDA dari hasil di atas, System Information yang
    // menang (sumber datanya sama, tapi lebih baru kalau tab itu baru
    // saja dibuka/di-refresh) -- Project Overview & System Information
    // jadi selalu melaporkan online/offline yang sama untuk proyek yang
    // sama, bukan dua angka yang bisa berbeda.
    if (projectId && typeof window.__siGetProjectOnlineStatus === "function") {
      const siStatus = window.__siGetProjectOnlineStatus(projectId);
      if (siStatus && siStatus !== target.summary.status) {
        console.info(`[project-detail] Status "${target.summary.status}" untuk proyek "${projectId}" dikoreksi jadi "${siStatus}" mengikuti System Information.`);
        target.summary.status = siStatus;
      }
    }

    // Owner sekarang diisi dari project.owner_name (Core API, §5.1) di
    // pdLoadRealTawabiProject() -- TIDAK fallback ke "Solarman" lagi
    // (dulu asal isi nama vendor logger, padahal itu bukan pemilik
    // proyeknya). Kalau memang belum ada owner sama sekali, biarkan "—".
    // Commission date proyek = tanggal instalasi PALING AWAL di antara
    // semua unit (Grup 1 & Grup 2 dst, bukan cuma unit pertama), karena
    // itu tanggal pembangkit ini mulai beroperasi. Diformat human-readable
    // ("18 Feb 2026"); kalau semua unit belum punya installationDate, tetap
    // fallback ke nilai lama ("-").
    const installDates = projectSystems
      .map((s) => s.systemOverview?.installedDate)
      .filter((d) => d && d !== "-")
      .sort();
    target.summary.commissionDate = pdFormatCommissionDate(installDates[0]) || target.summary.commissionDate;
    target.summary.lastUpdate = pdRelativeTime(projectSystems[0]?.deviceOverview?.lastSeen);

    target.inverter = {
      online, total: projectSystems.length, healthy: projectSystems.length - faultCount,
      fault: faultCount,
      communication: projectSystems.every((s) => s.deviceOverview?.modbusStatus === "Online") ? "Normal" : "Terputus"
    };

    target.devices[1] = { name: "Inverter", icon: "fa-plug-circle-bolt", online, total: projectSystems.length, status: faultCount ? "fault" : (online === projectSystems.length ? "healthy" : "warning") };
    target.devices[2] = { name: "Battery", icon: "fa-car-battery", online: target.battery.online, total: target.battery.total, status: target.battery.online === target.battery.total ? "healthy" : "warning" };
    target.devices[0] = { name: "PV Panel", icon: "fa-solar-panel", online: projectSystems.length, total: projectSystems.length, status: "healthy" };

    target.alerts = projectSystems
      .filter((s) => (s.diagnostics?.faultCode || "00_00") !== "00_00" || !pdIsSystemOnline(s))
      .map((s) => ({
        severity: s.status === "offline" ? "warning" : "info",
        title:
          s.status === "offline" ? `${s.basic?.systemName} sedang offline` :
          s.status === "pending" ? `${s.basic?.systemName} menunggu validasi koneksi` :
          `${s.basic?.systemName}: fault ${s.diagnostics?.faultCode}`,
        unit: s.basic?.systemName || s.id,
        time: pdRelativeTime(s.deviceOverview?.lastSeen)
      }));

    const allHistorical = projectSystems.flatMap((s) => s.historicalMaintenance || []);
    const allFuture = projectSystems.flatMap((s) => s.futureMaintenance || []);
    allHistorical.sort((a, b) => new Date(b.completedDate || b.startDate || 0) - new Date(a.completedDate || a.startDate || 0));
    allFuture.sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0));

    target.maintenance = {
      nextScheduled: allFuture[0] ? { date: allFuture[0].startDate, type: allFuture[0].title, assignee: allFuture[0].technician || "—" } : null,
      lastCompleted: allHistorical[0] ? { date: allHistorical[0].completedDate || allHistorical[0].startDate, type: allHistorical[0].title, assignee: allHistorical[0].technician || "—" } : null,
      predictive: []
    };
  }

  // FIX (2026-09-08, permintaan user): status online/offline proyek di
  // Project Detail SEBELUMNYA dihitung sendiri lewat pdIsSystemOnline()
  // (dari hasil diagnostics modbus per system, "online" kalau fetch
  // telemetry sukses & modbusOk !== false) lalu di-cross-check ke System
  // Information (window.__siGetProjectOnlineStatus, definisi "online"-nya
  // JUGA beda sendiri) -- 3 halaman (Dashboard, Project Selector, Project
  // Detail) bisa melaporkan status online/offline yang BEDA-BEDA untuk
  // proyek yang sama, tergantung dihitung dari halaman mana.
  //
  // Sekarang status akhir proyek DIPAKSA SAMA PERSIS dengan
  // Dashboard/Project Selector: device id-nya diambil dari
  // window.__psGetProjectDeviceIds (fungsi yang sama, dari
  // js/project-selector.js, yang sudah diperbaiki supaya benar-benar
  // nemu device tiap proyek), lalu proyek dianggap "online" kalau
  // MINIMAL SATU device-nya, dari GET /devices/:id/telemetry/latest,
  // punya field status:"online" (heartbeat 15 menit di backend).
  //
  // Dipanggil SETELAH pdApplyInverterSummary() supaya hasilnya jadi
  // penentu akhir (menimpa status hasil diagnostics lokal / cross-check
  // System Information di atas). Kalau window.__psGetProjectDeviceIds
  // belum ke-load atau requestnya gagal total, status yang sudah ada
  // (dari pdApplyInverterSummary) dibiarkan apa adanya sebagai fallback
  // -- TIDAK dipaksa "offline".
  async function pdSyncStatusWithLiveTelemetry(target, projectIdForDeviceLookup, projectName) {

    if (typeof window.__psGetProjectDeviceIds !== "function") return;

    try {
      const deviceIds = await window.__psGetProjectDeviceIds({ id: projectIdForDeviceLookup, name: projectName });

      if (!deviceIds.length) {
        target.summary.status = "offline";
        return;
      }

      const statuses = await Promise.all(deviceIds.map(async (id) => {
        try {
          const data = await edashApiFetch(`/devices/${id}/telemetry/latest`);
          return data?.status === "online";
        } catch (e) {
          return false;
        }
      }));

      target.summary.status = statuses.some(Boolean) ? "online" : "offline";
    } catch (e) {
      console.warn(`[project-detail] Gagal sinkronkan status live untuk proyek "${projectIdForDeviceLookup}":`, e.message);
    }

  }

  // Fetch /api/systems SEKALI (dipakai bareng buat Tawabi + semua
  // proyek user), supaya tidak fetch berkali-kali dan supaya semua
  // proyek dapat data dari snapshot systems yang SAMA.
  //
  // FIX (2026-08-26): pdApiBase() sendiri SUDAH "/api" (EDASH_API_BASE),
  // jadi nambah "/api/systems" lagi di sini bikin URL akhirnya
  // "/api/api/systems" -> 404. Cukup "/systems" di sini.
  async function pdFetchAllSystems() {
    try {
      const res = await fetch(`${pdApiBase()}/systems`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const systems = await res.json();
      return Array.isArray(systems) ? systems : [];
    } catch (e) {
      console.warn("[project-detail] Gagal ambil /api/systems:", e.message);
      return [];
    }
  }

  // Gabungkan snapshot /api/systems dengan window.__siSystems (kalau tab
  // System Information sudah pernah dimuat di sesi ini) -- entry dari
  // System Information MENANG kalau id-nya sama, karena itu yang paling
  // baru/live (termasuk system yang baru ditambah/diedit lewat wizard
  // System Information, atau unit Tawabi yang statusnya dihitung dari
  // /telemetry/latest terkini). Tanpa ini, Project Overview & System
  // Information bisa saja menampilkan status berbeda untuk system yang
  // SAMA PERSIS hanya karena masing-masing fetch snapshot-nya sendiri di
  // waktu yang berbeda.
  function pdMergeWithSiSystems(allSystems) {
    const siList = Array.isArray(window.__siSystems) ? window.__siSystems : [];
    if (!siList.length) return allSystems;
    const merged = allSystems.slice();
    const idxById = new Map(merged.map((s, i) => [s.id, i]));
    siList.forEach((s) => {
      if (idxById.has(s.id)) merged[idxById.get(s.id)] = s;
      else merged.push(s);
    });
    return merged;
  }

  // Terapkan Inverter Summary + Maintenance real ke SEMUA proyek user
  // (mis. Elvi Company) yang sudah didaftarkan pdRegisterUserProjects(),
  // memfilter dari snapshot systems yang sama berdasarkan
  // basic.projectId === id proyek itu (BUKAN by nama), supaya konsisten
  // dengan System Information / Task Management.
  function pdApplyRealDataForUserProjects(allSystems) {
    if (typeof window.PC_getUserProjects !== "function") return;
    const combined = pdMergeWithSiSystems(allSystems);
    window.PC_getUserProjects().forEach((up) => {
      const target = projects[up.id];
      if (!target) return;
      const ownSystems = combined.filter((s) => s.basic && s.basic.projectId === up.id);
      pdApplyInverterSummary(target, ownSystems, up.id);
      // Samakan status online/offline dengan Dashboard/Project Selector
      // (lihat pdSyncStatusWithLiveTelemetry di atas).
      pdSyncStatusWithLiveTelemetry(target, target._apiProjectId || up.id, target.summary.name);
    });
  }

  async function pdLoadRealTawabiProject() {
    const target = projects.tawabi;

    // --- 0) Cari proyek + semua unit (Grup 1, Grup 2, dst) di Core API
    const project = await pdFindTawabiProject();
    if (!project) {
      console.warn("[project-detail] Proyek Tawabi tidak ditemukan di Core API, tab ini tetap pakai data dummy bawaan.");
    } else {
      const projectId = project.id || PD_TAWABI_PROJECT_ID;
      target.summary.location = project.location || target.summary.location;
      target.summary.owner = project.owner_name || project.ownerName || target.summary.owner;

      const systemsMeta = pdExtractTawabiSystems(project);
      const jobs = [];
      systemsMeta.forEach((system, i) => {
        pdExtractDevicesForSystem(project, system, i, systemsMeta.length).forEach((device) => {
          jobs.push(() => pdLoadOneTawabiUnit(system, device, i));
        });
      });

      const [analytics, units] = await Promise.all([
        edashApiFetch(`/projects/${projectId}/analytics`).catch((e) => {
          console.warn("[project-detail] Gagal ambil /projects/:id/analytics:", e.message);
          return null;
        }),
        // MERGE: sama seperti pdLoadRealApiProject di atas -- batasi 2
        // device sekaligus lewat pdRunBatched.
        pdRunBatched(jobs, 2)
      ]);
      const validUnits = units.filter((u) => u.telemetry);

      // --- 1) Project Summary / Power / Today's Energy / Performance /
      //     Health / Environmental -- SEMUA dari GET /projects/:id/analytics
      //     (dihitung backend lintas-inverter, §5.2 dokumentasi).
      if (analytics) {
        target.summary.location = analytics.location || target.summary.location;
        target.summary.capacityKwp = Math.round(analytics.totalPeakKwp || target.summary.capacityKwp);
        target.energy.peakKw = analytics.totalPeakKwp || target.energy.peakKw;

        const todayKwh = analytics.realtime?.energyTodayKwh ?? 0;
        const expectedTodayKwh = analytics.mlMetrics?.expectedEnergyTodayKwh || todayKwh || 1;
        target.todayEnergy = { actual: +todayKwh.toFixed(1), expected: +expectedTodayKwh.toFixed(1) };
        target.energy.today = +todayKwh.toFixed(1);
        target.energy.dailyBase = +expectedTodayKwh.toFixed(1);
        target.power.now = +(analytics.realtime?.totalCurrentPowerKw || 0).toFixed(2);
        // Belum ada baseline (mis. power di jam yang sama kemarin) di
        // kontrak Core API sekarang buat ngitung tren Current Power beneran
        // -- drpd nampilin "0%" statis yang keliatan real padahal cuma sisa
        // seed dummy, sembunyikan badge tren-nya buat Tawabi (lihat
        // renderStats()).
        target.power.trendAvailable = false;

        target.performance.ratio = Math.round(analytics.mlMetrics?.performanceRatioPct || 0);
        target.performance.efficiency = Math.round(analytics.mlMetrics?.pvHealthPct || target.performance.efficiency);
        target.health.pct = Math.round(analytics.mlMetrics?.pvHealthPct || target.health.pct);

        // Environmental Impact -- akumulasi energi lifetime & CO2/pohon
        // dari analytics.lifetime, dihitung backend dari SELURUH histori
        // register kumulatif tiap inverter (bukan penjumlahan file lokal).
        target.energy.total = +((analytics.lifetime?.totalEnergyKwh) || target.energy.total).toFixed(1);
        target._environmentalSource = {
          source: "eDashboard Core API GET /projects/:id/analytics",
          co2ReductionKgLifetime: analytics.lifetime?.co2ReductionKg,
          treesEquivalentLifetime: analytics.lifetime?.treesEquivalent,
          costSavingsIdrLifetime: analytics.lifetime?.costSavingsIdr,
          todaySavingsIdr: analytics.realtime?.todaySavingsIdr,
          todayCo2ReductionKg: analytics.realtime?.todayCo2ReductionKg
        };
      }

      // --- 2) Battery summary -- dari telemetry.battery tiap unit
      //     (§4.3 dokumentasi), digabung/dirata-rata antar Grup 1 & 2.
      const withBattery = validUnits.filter((u) => u.telemetry?.battery && u.telemetry.battery.voltage != null);
      if (withBattery.length) {
        const socAvg = pdAvgOf(...withBattery.map((u) => u.telemetry.battery.soc).filter((n) => n != null));
        const sohAvg = pdAvgOf(...withBattery.map((u) => u.telemetry.battery.soh).filter((n) => n != null));
        const isCharging = withBattery.some((u) => (u.telemetry.battery.status || "").toLowerCase() === "charging");
        target.battery = {
          soc: Math.round(socAvg), status: isCharging ? "charging" : "idle",
          health: Math.round(sohAvg), online: withBattery.length, total: validUnits.length || withBattery.length,
          cycles: 0 // belum ada register cycle count di kontrak Rev3
        };
        if (!analytics?.mlMetrics?.pvHealthPct) target.health.pct = Math.round(sohAvg);
      }

      // --- 3) Energy Production chart (Actual vs Expected) & Performance
      //     Analytics 24-jam -- dari telemetry/history REAL tiap unit.
      if (validUnits.length) {
        target._energyProduction = pdBuildEnergyProduction(validUnits, analytics);
        target._realPerformance = pdBuildRealPerformance(validUnits);
      }

      // --- 4) Inverter summary + status/fault (§4.3 diagnostics) --
      //     dibangun jadi "system object" ala System Information, lalu
      //     pakai pdApplyInverterSummary() yang generik (§ dibawah).
      //     Maintenance TETAP kosong (belum ada endpoint list-nya di
      //     Core API) -- bukan kelalaian, memang belum tersedia.
      if (validUnits.length) {
        pdApplyInverterSummary(target, validUnits.map((u, i) => pdMapUnitToSystemLike(u, i)), "tawabi");
        target.summary.lastUpdate = pdRelativeTime(validUnits[0].telemetry?.lastSeen);
      }

      // Samakan status online/offline dengan Dashboard/Project Selector
      // (lihat pdSyncStatusWithLiveTelemetry di atas). Literal "tawabi"
      // dipakai (bukan `projectId`/UUID asli di atas) karena
      // window.__psGetProjectDeviceIds mengenali Tawabi lewat sentinel
      // id "tawabi" itu, sama seperti js/dashboard.js & js/project-selector.js.
      await pdSyncStatusWithLiveTelemetry(target, "tawabi", target.summary.name);

      // Recent activity: belum ada endpoint activity-log per-device di
      // Core API (charge/discharge transition log seperti battery-station
      // lama tidak ada kontraknya) -- diganti ringkasan status modbus/fault
      // real-time tiap unit sebagai pengganti, tetap 100% dari Core API.
      if (validUnits.length) {
        target.activity = validUnits
          .map((u) => {
            const diag = u.telemetry?.diagnostics || {};
            return {
              text: `${u.systemLabel}: modbus ${diag.modbusOk === false ? "terputus" : "OK"}, fault ${diag.faultCode ?? "-"}`,
              time: pdRelativeTime(u.telemetry?.lastSeen),
              type: diag.modbusOk === false ? "warning" : "info",
              _ts: u.telemetry?.lastSeen || 0
            };
          })
          .sort((a, b) => new Date(b._ts) - new Date(a._ts));
      }
    }

    // Proyek lain (mis. Elvi Company dari "Add New Project") belum
    // punya proyek di Core API, jadi TETAP dari mini-backend lama
    // (server/server.js, GET /api/systems) seperti sebelumnya.
    const allSystems = await pdFetchAllSystems();
    pdApplyRealDataForUserProjects(allSystems);
  }

  // ===========================================================
  // Performance Analytics — six Grafana-style operating variables.
  // Kalau proyek punya data real (p._realPerformance, diisi oleh
  // pdLoadRealTawabiProject()), pakai itu langsung — kalau tidak,
  // fallback ke formula simulasi seperti sebelumnya.
  // ===========================================================
  function buildPerformanceData(p) {
    let builtin;
    if (p._realPerformance) {
      builtin = p._realPerformance;
    } else {
      const base = p.energy.peakKw || p.summary.capacityKwp;
      const v = Math.round((560 + base * 1.35) * 10) / 10;
      const pv = Math.round((base > 20 ? 570 : 500 + base * 16) * 10) / 10;
      const temp = Math.round((40 + p.weather.tempC * 0.12) * 10) / 10;
      const currentPeak = Math.round((18 + base * 1.45) * 10) / 10;
      const powerPeak = Math.round((base * 1000 * 1.45) / 100) * 100;
      const leak = Math.round((72 + p.weather.tempC * 0.55) * 10) / 10;
      const wave = (center, amp, points = 12) => Array.from({length: points}, (_, i) => {
        const phase = i / (points - 1);
        return center + Math.sin(phase * Math.PI * 2.2) * amp + Math.cos(phase * Math.PI * 5) * amp * .18;
      });
      builtin = {
        batteryVoltage: { title:"Battery Voltage", unit:"V", value:v, decimals:1, data:wave(v,3.2) },
        pvVoltage: { title:"PV Voltage", unit:"V", value:pv, decimals:0, data:[0,0,pv*.82,pv*.91,pv*.96,pv,pv*.98,pv*.94,pv*.88,pv*.78,0,0] },
        radiatorTemp: { title:"Inverter Performance", subtitle:"Radiator Temperature", unit:"°C", value:temp, decimals:1, data:wave(temp,1.6) },
        batteryCurrent: { title:"Battery Current", unit:"A", value:-2.4, decimals:1, data:[-5,-5,-4,-1,5,currentPeak,currentPeak*.62,8,1,-2,-3,-2.4] },
        batteryPower: { title:"Battery Power", unit:"W", value:Math.round(base*55), decimals:0, data:[-2400,-2200,0,base*180,base*620,powerPeak,powerPeak*.58,base*260,0,-1800,-2300,base*55] },
        leakCurrent: { title:"Inverter Leak Current", unit:"mA", value:leak, decimals:0, data:wave(leak,13) }
      };
    }

    // Grid ini SEKARANG persis seperti Project Overview-nya Operator
    // dashboard (js/operator/operator-dashboard.js, lihat CARDS_STORAGE_KEY
    // / loadSavedCards): tidak ada kartu bawaan yang otomatis muncul sama
    // sekali. `builtin` di atas TIDAK dipakai lagi di bawah ini (sengaja
    // dibiarkan/tidak dihapus supaya diff minimal & gampang dikembalikan
    // kalau suatu saat butuh default lagi) — grid sekarang murni dari
    // cfg.custom, jadi proyek yang belum pernah disentuh user selalu
    // terbuka kosong (cuma tombol "+ Add Graph").
    const cfg = pdPerfCfgFor(pdCurrentId);
    const result = {};
    cfg.custom.forEach((c) => { result[c.id] = pdCustomCardMeta(p, c); });
    return result;
  }

  // ===========================================================
  // Performance Analytics — per-project graph selection
  // ---------------------------------------------------------------
  // Mirrors the Operator dashboard's "Add Graph" / dashed "+" tile
  // feature (js/operator/operator-dashboard.js), but the variable
  // catalog here comes from the Core API (GET /devices/:id/telemetry/
  // history, see pdBuildGraphCatalogFromUnits above) instead of the
  // local tawabi-graph-variables.json the Operator dashboard still
  // reads. Selection is remembered per project id in localStorage so
  // it survives a refresh/tab switch.
  // ===========================================================
  // Plain (un-versioned) key is fine now: the grid no longer has any
  // built-in cards to accidentally inherit from an old selection (see
  // buildPerformanceData above) — a project with no saved `custom`
  // cards is simply empty, the same guarantee the versioned key was
  // there for.
  const PD_PERF_CFG_KEY = "edash-admin-performance-cfg";
  let pdPerfCfgAll = null;

  function pdLoadPerfCfgAll() {
    if (pdPerfCfgAll) return pdPerfCfgAll;
    try {
      const raw = localStorage.getItem(PD_PERF_CFG_KEY);
      pdPerfCfgAll = raw ? JSON.parse(raw) : {};
      if (!pdPerfCfgAll || typeof pdPerfCfgAll !== "object") pdPerfCfgAll = {};
    } catch (e) {
      pdPerfCfgAll = {};
    }
    return pdPerfCfgAll;
  }

  function pdPerfCfgFor(projectId) {
    const all = pdLoadPerfCfgAll();
    if (!all[projectId] || typeof all[projectId] !== "object") {
      // Fresh project: no custom cards yet, so the grid renders empty
      // (just the "+ Add Graph" tile) -- see buildPerformanceData, which
      // no longer merges in any built-in card at all, same as the
      // Operator dashboard's Project Overview grid.
      all[projectId] = { hiddenBuiltin: [], custom: [], wide: [], order: [] };
    }
    // hiddenBuiltin is kept around only so removePerfCard (below) has
    // somewhere harmless to push a key if it's ever called on a
    // non-custom perfKey; it's no longer read anywhere since built-in
    // cards are never merged into the grid in the first place.
    if (!Array.isArray(all[projectId].hiddenBuiltin)) all[projectId].hiddenBuiltin = [];
    if (!Array.isArray(all[projectId].custom)) all[projectId].custom = [];
    // "Lebarkan sebaris" (expand to full row) selection, keyed by perfKey
    // — same feature/idea as the Operator dashboard's card.wide toggle
    // (js/operator/operator-dashboard.js), just persisted here instead
    // of living on the in-memory card object.
    if (!Array.isArray(all[projectId].wide)) all[projectId].wide = [];
    // Manual drag-and-drop order (perfKey list), same idea as the
    // Operator dashboard's draggable card grid — persisted per project
    // so a reorder survives a refresh/tab switch. Any perfKey not (yet)
    // in this list just falls back to natural/original order (see
    // pdPerfOrderIndex below), so old saved configs without this field
    // keep working unchanged.
    if (!Array.isArray(all[projectId].order)) all[projectId].order = [];
    // Which dataset ("trendline") legend entries the user has clicked
    // off, keyed by perfKey -> array of dataset labels. Chart.js's
    // built-in legend click already hides/shows a line live, but that
    // state only ever lived on the in-memory Chart instance -- the
    // second renderPerformanceAnalytics() destroys+recreates every
    // chart (page revisit, period switch, data refresh, etc.), every
    // dataset silently came back visible. Persisting by LABEL (not
    // index) so a saved hide survives a card being re-ordered or a
    // variable being added/removed from it.
    if (!all[projectId].hiddenSeries || typeof all[projectId].hiddenSeries !== "object") all[projectId].hiddenSeries = {};
    return all[projectId];
  }

  function pdPerfHiddenSeriesFor(perfKey) {
    const cfg = pdPerfCfgFor(pdCurrentId);
    if (!Array.isArray(cfg.hiddenSeries[perfKey])) cfg.hiddenSeries[perfKey] = [];
    return cfg.hiddenSeries[perfKey];
  }

  function pdIsSeriesHidden(perfKey, label) {
    return pdPerfHiddenSeriesFor(perfKey).includes(label);
  }

  function pdSetSeriesHidden(perfKey, label, hidden) {
    const list = pdPerfHiddenSeriesFor(perfKey);
    const idx = list.indexOf(label);
    if (hidden && idx === -1) list.push(label);
    else if (!hidden && idx !== -1) list.splice(idx, 1);
    pdPersistPerfCfg();
  }

  // Position of a perfKey within this project's saved manual order —
  // unlisted keys (new cards, or configs saved before drag-and-drop
  // existed) sort after every explicitly-ordered one, in their
  // original/natural relative order (Array.prototype.sort is stable).
  function pdPerfOrderIndex(perfKey) {
    const idx = pdPerfCfgFor(pdCurrentId).order.indexOf(perfKey);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  }

  function pdIsPerfCardWide(perfKey) {
    return pdPerfCfgFor(pdCurrentId).wide.includes(perfKey);
  }

  function pdTogglePerfCardWide(p, perfKey) {
    const cfg = pdPerfCfgFor(pdCurrentId);
    const idx = cfg.wide.indexOf(perfKey);
    if (idx === -1) cfg.wide.push(perfKey); else cfg.wide.splice(idx, 1);
    pdPersistPerfCfg();
    renderPerformanceAnalytics(p);
  }

  function pdPersistPerfCfg() {
    try {
      localStorage.setItem(PD_PERF_CFG_KEY, JSON.stringify(pdLoadPerfCfgAll()));
    } catch (e) {
      console.warn("[project-detail] Gagal simpan pilihan grafik Performance Analytics:", e.message);
    }
  }

  // Builds the same meta shape as the built-in cards (title/unit/
  // value/decimals/data) for a custom variable card, so it flows
  // through renderPerformanceCard / renderPerfCardChart unchanged.
  // catalogKeys is carried on the meta itself (see pdPerfDailySeries
  // below) rather than the global PD_PERF_CATALOG_KEYS map, since
  // custom cards aren't known ahead of time.
  function pdCustomCardMeta(p, c) {
    const keys = c.varKeys || [c.varKey];
    // Full per-variable descriptors — prefer what was saved with the card
    // (c.vars, see the "Add graph" handler below); fall back to a plain
    // reconstruction from varKeys for cards saved before that field
    // existed, so old localStorage selections don't break.
    const varList = (c.vars && c.vars.length) ? c.vars : keys.map((k) => ({ key: k, label: k, unit: c.unit || "", color: c.color }));
    const deviceGroupId = c.deviceGroupId || "grup1";
    const catalog = pdCurrentGraphCatalog();
    const groupData = (catalog && catalog.groups[deviceGroupId]) ? catalog.groups[deviceGroupId].data : null;
    const lastIdx = groupData ? (groupData.labels || []).length - 1 : -1;

    const latestFor = (key) => {
      if (groupData && lastIdx >= 0) {
        const n = (groupData[key] || [])[lastIdx];
        if (typeof n === "number" && isFinite(n)) return n;
      }
      return null;
    };

    // FIX: dulu di sini tiap variabel dapat kurva sinus/cosinus
    // "believable-looking" sendiri-sendiri kalau data jam-jaman real
    // (pdGraphRealHourlySeries) belum ada -- MENYESATKAN, kelihatan
    // seperti kurva produksi/konsumsi beneran padahal cuma pola
    // matematis. `data` di sini HANYA dipakai sebagai fallback TERAKHIR
    // (lihat pdPerfHourlySeries: real data dicoba dulu lewat
    // pdGraphRealHourlySeries, baru jatuh ke sini kalau memang belum
    // tersedia) -- disamakan dengan flatZeroSeries di
    // js/system-information.js: garis datar 0, bukan data buatan.
    // "Current value" (badge angka) tetap pakai `latest` real terakhir
    // kalau ada -- cuma bentuk kurva 24 jam-nya yang di-flat-kan.
    const vars = varList.map((v) => {
      const latest = latestFor(v.key);
      const base = latest != null ? latest : (typeof c.seed === "number" ? c.seed : 50);
      const wave = Array.from({ length: 12 }, () => 0);
      return { key: v.key, label: v.label || v.key, unit: v.unit || c.unit || "", color: v.color || c.color, groupId: v.groupId, data: wave, value: base };
    });

    // "Current value" badge on the card head still shows a single number
    // — the average across all selected variables (same as before).
    const nums = vars.map((v) => v.value).filter((n) => typeof n === "number" && isFinite(n));
    const value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 50;

    // Nama unit asli dari Core API (mis. "PLTS Tawabi Grup 1") supaya
    // kartu custom kelihatan jelas datanya dari unit mana -- fallback ke
    // "Grup 1"/"Grup 2" dari deviceGroupId kalau catalog belum sempat
    // ke-load (baru pertama buka Add Graph / masih fetching).
    const groupLabel = (groupData && catalog.groups[deviceGroupId].name)
      || ("Grup " + (deviceGroupId.replace(/^grup/, "") || "1"));

    // A card whose variables span more than one device group (e.g.
    // "Daily Production" from Grup 1 AND Grup 2 in one Compare/Line
    // graph) already gets each line labelled with its own group name
    // in the chart legend/tooltip (see cardMultiGroup/pdGraphGroupName
    // in renderPerfCardChart). The header badge now mirrors that: every
    // DISTINCT group name involved is joined together with " + " (e.g.
    // "PLTS TAWABI GRUP 1 + PLTS TAWABI GRUP 2") -- same behaviour as
    // the Operator dashboard's cardGroupLabel() -- instead of being left
    // blank, so it's clear at a glance which units a combined chart is
    // pulling from.
    const multiGroup = pdSelectionSpansMultipleGroups(vars);
    const multiGroupLabel = multiGroup
      ? Array.from(new Set(vars.map((v) => v.groupId).filter(Boolean)))
          .map((gid) => pdGraphGroupName(gid))
          .filter(Boolean)
          .join(" + ")
      : "";

    return {
      title: c.title, unit: c.unit || "", value, decimals: c.decimals != null ? c.decimals : 1,
      data: vars[0] ? vars[0].data : [], catalogKeys: keys, color: c.color,
      vars, deviceGroupId,
      // "compare" (atas-bawah/mirror) dipertahankan apa adanya di sini --
      // sebelumnya ternary ini cuma tahu "bar"/"line" dan diam-diam
      // menjatuhkan mode Compare balik ke "line" setiap kali kartu
      // di-render ulang. comparePair (top/bottom key) ikut dibawa supaya
      // renderPerfCardChartMulti() tahu variabel mana yang harus
      // dinegasikan.
      chartType: c.chartType === "bar" ? "bar" : (c.chartType === "compare" ? "compare" : (c.chartType === "stack" ? "stack" : "line")),
      comparePair: c.comparePair || null,
      subtitle: multiGroup ? multiGroupLabel : groupLabel,
    };
  }

  // ===========================================================
  // INIT (dipanggil js/project-monitoring.js)
  // ===========================================================
  // Flag modul: true kalau data real Tawabi sudah PERNAH berhasil
  // di-fetch dalam sesi ini. Dipakai supaya loading state "Memuat data
  // proyek..." (mirip System Information) cuma tampil di kunjungan
  // PERTAMA ke tab ini, bukan tiap kali initProjectDetail() dipanggil
  // ulang (mis. pindah halaman lalu balik lagi ke Project Monitoring).
  let pdRealDataLoadedOnce = false;

  window.initProjectDetail = async function () {
    // Daftarkan proyek baru (dari Add Project) + samakan pdCurrentId
    // dengan proyek yang sedang aktif (dipilih di Project Selector,
    // atau baru saja ditambahkan) supaya tab "Project Overview" ini
    // langsung menampilkan proyek yang benar, bukan selalu Tawabi.
    pdRegisterUserProjects();
    // Daftarkan SEMUA proyek dari Core API (GET /api/v1/projects) sebagai
    // chip -- sebelumnya cuma "PLTS Tawabi" yang di-hardcode di sini.
    // Untuk staff, GET /projects backend SUDAH discope ke 1 project
    // miliknya saja (lihat ProjectService.scopedProjectIds) -- jadi
    // apiProjects di sini otomatis cuma berisi project itu.
    let apiProjects = [];
    try {
      apiProjects = await pdFetchApiProjectsList();
      pdRegisterApiProjects(apiProjects);
    } catch (e) {
      console.warn("[project-detail] Gagal mendaftarkan seluruh proyek dari Core API:", e.message);
    }
    const activeProject = (typeof window.PC_getActiveProject === "function") ? window.PC_getActiveProject() : null;
    if (activeProject && projects[activeProject.id]) {
      pdCurrentId = activeProject.id;
    }

    if (PD_IS_STAFF) {
      // Staff sekarang mendarat LANGSUNG di Project Monitoring saat login
      // (lihat main.js initializeDashboard) -- tidak selalu sempat mampir
      // ke Project Selector dulu buat set PC_getActiveProject(), jadi
      // activeProject di atas bisa saja kosong/basi. Timpa dengan
      // satu-satunya project yang memang dikembalikan backend untuk akun
      // ini, bukan default seed "tawabi" (yang bisa saja BUKAN project
      // staff ini).
      const ownApiProject = apiProjects[0];
      if (ownApiProject) {
        const ownLocalId = ownApiProject.id === PD_TAWABI_PROJECT_ID ? "tawabi" : ownApiProject.id;
        if (projects[ownLocalId]) pdCurrentId = ownLocalId;
      }
    }

    bindReportModalChrome();
    bindEnvSettingsModalChrome();
    pdBindGraphModal();

    const loadingEl = document.getElementById("pdLoadingState");
    const contentEl = document.getElementById("pdContent");

    if (pdRealDataLoadedOnce) {
      // Data real sudah pernah di-fetch sebelumnya di sesi ini (mis.
      // user sempat pindah ke halaman lain lalu balik ke Project
      // Monitoring) -- langsung render sekali dgn data yang sudah ada
      // di cache `projects`, TANPA loading state dan TANPA fetch ulang.
      renderChips();
      try { selectProject(pdCurrentId); } catch (e) { console.error("[project-detail] render gagal:", e); }
      //
      // PENTING: markup panel ini SELALU dipasang ulang dari nol tiap
      // kunjungan (lihat htmlCache di project-monitoring.js) -- artinya
      // #pdContent & #pdLoadingState SELALU balik ke kondisi default
      // mentahnya (content hidden, loading state kelihatan), walau data
      // sebenarnya sudah ada. Baris toggle display di bawah ini WAJIB
      // dijalankan juga di cabang ini, bukan cuma di cabang "kunjungan
      // pertama" -- kalau kelewat, begitu fast-path ini kepakai (setelah
      // markup di-cache), halaman selalu nyangkut di skeleton loading
      // walau data sebenarnya sudah selesai dirender di baliknya
      // (display:none).
      if (loadingEl) loadingEl.style.display = "none";
      if (contentEl) contentEl.style.display = "";
    } else {
      // Kunjungan PERTAMA ke tab ini dalam sesi -- sembunyikan konten,
      // tampilkan "Memuat data proyek..." (sama seperti System
      // Information), TUNGGU GET /projects/:id/analytics + telemetry
      // Core API selesai, baru render SEKALI dengan data real. Tidak
      // ada lagi render awal pakai seed/dummy yang lalu "kedip" berubah
      // begitu data asli masuk.
      if (contentEl) contentEl.style.display = "none";
      if (loadingEl) loadingEl.style.display = "";

      renderChips(); // murah (cuma daftar dropdown proyek), aman dijalankan sebelum data Tawabi siap

      const loadingContainer = document.getElementById("pmPanel-overview") || (loadingEl && loadingEl.parentElement);
      if (window.EdashLoadingBar) window.EdashLoadingBar.show(loadingContainer, "project-overview", "loading.project");

      try {
        await pdLoadRealTawabiProject();
      } catch (e) {
        console.error("[project-detail] Gagal memuat data real Tawabi:", e);
      }
      pdRealDataLoadedOnce = true;

      if (window.EdashLoadingBar) window.EdashLoadingBar.done(loadingContainer, "project-overview");

      if (loadingEl) loadingEl.style.display = "none";
      if (contentEl) contentEl.style.display = "";
      try { selectProject(pdCurrentId); } catch (e) { console.error("[project-detail] render (data real) gagal:", e); }
    }


    if (!pdLanguageListenerBound) {
      pdLanguageListenerBound = true;
      document.addEventListener("edash:languagechange", () => {
        if (!pdChart || !projects[pdCurrentId]) return;
        const filters = document.getElementById("pdChartFilters");
        const activeBtn = filters ? filters.querySelector(".pd-filter-btn.is-active") : null;
        const range = activeBtn ? activeBtn.getAttribute("data-range") : "7d";
        if (range === "custom") {
          const fromInput = document.getElementById("pdCustomFrom");
          const toInput = document.getElementById("pdCustomTo");
          if (fromInput && toInput && fromInput.value && toInput.value) {
            renderChart(projects[pdCurrentId], "custom", fromInput.value, toInput.value);
          }
        } else {
          renderChart(projects[pdCurrentId], range);
        }
      });
    }
  };

  // ===========================================================
  // PROJECT SWITCHING
  // ===========================================================
  // Fills the picker input with the given project's label without
  // marking it as "typed" — used on initial render and whenever the
  // active project changes elsewhere (selectProject() below), same
  // idea as the Operator dashboard's fillSearchWithActiveProject().
  function fillProjectPickerLabel(id) {
    const input = document.getElementById("pdProjectSearchInput");
    if (input && projects[id]) input.value = projects[id].label;
  }

  function renderChips() {
    const picker = document.getElementById("pdProjectPicker");
    const input = document.getElementById("pdProjectSearchInput");
    if (!picker || !input) return;

    if (PD_IS_STAFF) {
      // Staff cuma punya 1 project (di-assign admin) -- tidak ada
      // gunanya nampilkan switcher buat "pilih" dari daftar berisi 1
      // item. Picker-nya dikunci ke project itu saja (tetap kelihatan
      // nama project-nya, cuma tidak bisa diganti/dibuka).
      fillProjectPickerLabel(pdCurrentId);
      input.readOnly = true;
      picker.classList.add("is-locked");
      return;
    }

    picker.classList.remove("is-locked");
    input.readOnly = false;
    fillProjectPickerLabel(pdCurrentId);
    bindProjectSearch();
  }

  // Project search / switcher — the picker input above doubles as both
  // the current-project label and the search trigger, same behavior as
  // the Operator dashboard's opdSearchInput + #opdProjectDropdown
  // (js/operator/operator-dashboard.js): focusing it opens the dropdown
  // (typing further filters it), clicking an entry switches project.
  function bindProjectSearch() {
    const picker = document.getElementById("pdProjectPicker");
    const popover = document.getElementById("pdProjectSearchPopover");
    const input = document.getElementById("pdProjectSearchInput");
    const results = document.getElementById("pdProjectSearchResults");
    if (!picker || !popover || !input || !results || picker.dataset.bound === "true") return;

    picker.dataset.bound = "true";

    // True while the input still just holds the auto-filled active-
    // project label rather than something the user actually typed —
    // cleared on the first real keystroke, same flag as the Operator
    // dashboard's opdSearchIsProjectPrefill.
    let isPrefill = true;

    const close = () => {
      popover.hidden = true;
      input.setAttribute("aria-expanded", "false");
    };

    const renderResults = () => {
      const q = isPrefill ? "" : input.value.trim().toLowerCase();
      const matches = Object.entries(projects).filter(([id, project]) =>
        !q || project.label.toLowerCase().includes(q) || id.toLowerCase().includes(q)
      );

      results.innerHTML = matches.length
        ? matches.map(([id, project]) => `
            <button class="pd-project-search-result${id === pdCurrentId ? " is-selected" : ""}" type="button" data-project-id="${id}" role="option" aria-selected="${id === pdCurrentId}">
              <i class="fa-solid fa-diagram-project"></i>
              <span>${project.label}</span>
            </button>
          `).join("")
        : `<div class="pd-project-search-empty">Proyek tidak ditemukan.</div>`;
    };

    const open = () => {
      popover.hidden = false;
      input.setAttribute("aria-expanded", "true");
      renderResults();
    };

    input.addEventListener("focus", () => {
      if (isPrefill) input.select();
      open();
    });
    input.addEventListener("input", () => {
      isPrefill = false;
      renderResults();
      if (popover.hidden) open();
    });

    // mousedown + preventDefault (rather than click) so the pick
    // registers before the input's blur handler below would otherwise
    // close the dropdown out from under it — same pattern as the
    // Operator dashboard's project-dropdown item handler.
    results.addEventListener("mousedown", (event) => {
      const item = event.target.closest("[data-project-id]");
      if (!item) return;
      event.preventDefault();
      selectProject(item.dataset.projectId);
      isPrefill = true;
      close();
      input.blur();
    });

    input.addEventListener("blur", () => {
      // Small delay so a dropdown item's mousedown above still gets to
      // register its pick before we hide the panel, same as the
      // Operator dashboard's searchInput blur handler.
      setTimeout(() => {
        close();
        // Whatever was left half-typed reverts back to showing the
        // active project's name, same as the search bar snapping back
        // once focus leaves it.
        fillProjectPickerLabel(pdCurrentId);
        isPrefill = true;
      }, 120);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        input.blur();
      }
    });
  }

  function selectProject(id) {
    if (!projects[id]) return;
    pdCurrentId = id;

    // Sinkronkan balik ke "proyek aktif" GLOBAL (project-context.js) supaya
    // System Information / Task Management / Battery Station ikut pindah
    // juga kalau user ganti proyek lewat dropdown/pencarian di Project
    // Overview ini — bukan cuma tampilan lokal halaman ini doang.
    if (typeof window.PC_setActiveProject === "function") {
      window.PC_setActiveProject({ id, name: projects[id].label });
    }

    fillProjectPickerLabel(id);

    const p = projects[id];

    renderHeader(p);
    renderStats(p);
    renderWeather(p);
    renderEnvironmental(p);
    renderPerformanceAnalytics(p);
    bindActions();

    // LAZY LOADING (Rev3 frontend disclaimer §1/§2) -- katalog "Add
    // Graph" (GET /devices/:id/telemetry/history 90 hari + 1D + 7D +
    // 30D, PARALEL utk SETIAP unit device) TIDAK LAGI di-preload di
    // sini. Memanggilnya otomatis begitu halaman/proyek ini dibuka
    // adalah persis pola "pre-fetch histori 30/90 hari untuk seluruh
    // unit device secara paralel saat halaman baru dibuka" yang
    // menyebabkan lonjakan CPU 100% di VPS 2 core (Thundering Herd) --
    // dilarang oleh laporan optimasi. Katalog ini sekarang murni
    // On-Demand: baru di-fetch (lewat pdEnsureGraphCatalog(), yang
    // sudah memoize per proyek jadi aman dipanggil berkali-kali) saat
    // user BENAR-BENAR membutuhkannya, yaitu:
    //   (a) klik tab periode "7 Days" / "30 Days" / "Custom" di sebuah
    //       kartu Performance Analytics -- lihat setPerfPeriodMode();
    //   (b) buka modal "Add Graph" -- lihat openPdGraphModal().
    // Kartu 24H tetap tampil langsung dari p._realPerformance (sumber
    // jam-jaman yang sudah ada), jadi tidak ada yang menunggu apa pun
    // saat halaman baru dibuka.

    // Fetch cuaca real (Open-Meteo) untuk proyek ini kalau koordinatnya
    // ada; renderWeather() dipanggil ulang begitu hasilnya datang.
    pdLoadWeather(id);

    // Proyek dari Core API selain Tawabi (chip yang baru ditambahkan
    // lewat pdRegisterApiProjects) masih berupa skeleton kosong sampai
    // dipilih -- muat detail/analytics/telemetry-nya SEKALI di sini,
    // lalu render ulang begitu selesai (kalau user belum pindah lagi
    // ke proyek lain sementara fetch-nya berjalan).
    if (p._apiProjectId && !p._realDataLoaded) {
      pdLoadRealApiProject(id).then(() => {
        if (pdCurrentId === id) selectProject(id);
      });
    }
  }

  // ===========================================================
  // RENDER: Performance Analytics
  // ---------------------------------------------------------------
  // The chart *feature* inside each of the 6 cards now matches the
  // Operator dashboard's graph cards 1:1 — a 24 Hours / 7 Days /
  // 30 Days / Custom period toggle, a real Chart.js line chart, and
  // a below-chart draggable range slider (see js/operator/operator-
  // dashboard.js "renderCardChart" / "renderCardRangeSlider" and
  // css/operator/operator-dashboard.css .opd-card-period-* /
  // .opd-card-range-* — those same classes/styles are reused here
  // so it's visually and behaviourally the same widget). Everything
  // else about this section (the 6-card grid, titles, current-value
  // pill) is unchanged.
  //
  // 7D/30D/Custom pull real daily history from the Core API "Add
  // Graph" catalog (GET /devices/:id/telemetry/history, group
  // "grup1"/"grup2" — see pdBuildGraphCatalogFromUnits above) when
  // the active project is the real Tawabi project; 24H keeps using
  // the existing hourly source
  // (p._realPerformance / buildPerformanceData's formula fallback).
  // Projects without a real logger (user-added ones) fall back to a
  // seeded daily simulation for 7D/30D/Custom.
  // ===========================================================
  const PD_PERF_PERIODS = [
    { mode: "24h", label: "24 Hours" },
    { mode: "7d", label: "7 Days" },
    { mode: "30d", label: "30 Days" },
    { mode: "custom", label: "Custom", icon: "fa-calendar-days", title: "Pick your own date range" },
  ];

  // Path Core API (skema ternormalisasi Rev3, sama dengan PD_GRAPH_VAR_DEFS
  // di atas) buat data 7D/30D/Custom pada 6 kartu bawaan Performance
  // Analytics. leakCurrent sengaja TIDAK dipetakan -- belum ada field
  // leakage current di kontrak Rev3 (§4.3/§4.5 dokumentasi), sama seperti
  // kartu "24 Hours"-nya yang memang hardcode 0 di pdBuildRealPerformance().
  const PD_PERF_CATALOG_KEYS = {
    batteryVoltage: ["battery.voltage"],
    pvVoltage: ["pvStrings.string1.voltage", "pvStrings.string2.voltage"],
    radiatorTemp: ["diagnostics.radiatorTemp"],
    batteryCurrent: ["battery.current"],
    batteryPower: ["battery.power"],
  };

  const PD_PERF_COLORS = {
    batteryVoltage: "#0F6A71",
    pvVoltage: "#3E7CB1",
    radiatorTemp: "#E3A21A",
    batteryCurrent: "#2F9E6E",
    batteryPower: "#6DC3BB",
    leakCurrent: "#D64545",
  };

  // ===========================================================
  // "Add Graph" catalog — SEKARANG dari eDashboard Core API, BUKAN
  // lagi dari file lokal server/data/tawabi-graph-variables.json.
  // ---------------------------------------------------------------
  // Dokumentasi API belum punya endpoint "list variabel logger"
  // tersendiri, tapi skema ternormalisasi Rev3 yang DIDOKUMENTASIKAN
  // (§4.3 telemetry/latest & §4.5 telemetry/history: overview,
  // pvStrings, ac3Phase, grid, load, battery, diagnostics) SUDAH
  // berisi semua variabel yang perlu bisa di-plot. Jadi PD_GRAPH_VAR_DEFS
  // di bawah adalah katalog variabel yang dibangun manual dari skema
  // itu (bukan tebak-tebakan/dummy), lalu nilainya diambil 100% dari
  // GET /devices/:id/telemetry/history (§4.5 dokumentasi) tiap unit
  // (Grup 1 & Grup 2), sama seperti chart Energy Production di atas.
  // ===========================================================
  const PD_GRAPH_HISTORY_DAYS = 90; // durasi relatif terpanjang yg didokumentasikan (`last=90d`)

  // { path ke value dlm telemetry ternormalisasi, label, unit, category }
  // category dipakai untuk grouping di panel kiri modal "Create graph"
  // (lihat PD_GRAPH_CATEGORY_ORDER di bawah).
  const PD_GRAPH_VAR_DEFS = [
    { path: "overview.currentPower", label: "Current Power", unit: "W", category: "ENERGY" },
    { path: "overview.pvTotalPower", label: "PV Total Power", unit: "W", category: "ENERGY" },
    { path: "overview.energyToday", label: "Daily Production", unit: "kWh", category: "ENERGY" },
    { path: "overview.energyTotal", label: "Cumulative Production", unit: "kWh", category: "ENERGY" },
    { path: "overview.efficiency", label: "Efficiency", unit: "%", category: "ENERGY" },
    { path: "overview.powerFactor", label: "Power Factor", unit: "cos φ", category: "ENERGY" },
    { path: "overview.reactivePower", label: "Reactive Power", unit: "kVAR", category: "ENERGY" },
    { path: "overview.acFrequency", label: "AC Frequency", unit: "Hz", category: "ENERGY" },

    { path: "battery.voltage", label: "Battery Voltage", unit: "V", category: "BATTERY PERFORMANCE" },
    { path: "battery.current", label: "Battery Current", unit: "A", category: "BATTERY PERFORMANCE" },
    { path: "battery.power", label: "Battery Power", unit: "W", category: "BATTERY PERFORMANCE" },
    { path: "battery.soc", label: "State of Charge (SoC)", unit: "%", category: "BATTERY PERFORMANCE" },
    { path: "battery.soh", label: "State of Health (SoH)", unit: "%", category: "BATTERY PERFORMANCE" },
    { path: "battery.dailyCharge", label: "Daily Charging Energy", unit: "kWh", category: "BATTERY ENERGY" },
    { path: "battery.dailyDischarge", label: "Daily Discharging Energy", unit: "kWh", category: "BATTERY ENERGY" },

    { path: "diagnostics.inverterTemp", label: "Inverter Temperature", unit: "°C", category: "INVERTER" },
    { path: "diagnostics.radiatorTemp", label: "Radiator Temperature", unit: "°C", category: "INVERTER" },
    { path: "diagnostics.ambientTemp", label: "Ambient Temperature", unit: "°C", category: "INVERTER" },
    { path: "diagnostics.espTemp", label: "ESP Temperature", unit: "°C", category: "INVERTER" },
    { path: "diagnostics.humidity", label: "Humidity", unit: "%", category: "INVERTER" },

    { path: "pvStrings.string1.voltage", label: "PV1 DC Voltage", unit: "V", category: "PV STRING VOLTAGE" },
    { path: "pvStrings.string2.voltage", label: "PV2 DC Voltage", unit: "V", category: "PV STRING VOLTAGE" },
    { path: "pvStrings.string3.voltage", label: "PV3 DC Voltage", unit: "V", category: "PV STRING VOLTAGE" },
    { path: "pvStrings.string4.voltage", label: "PV4 DC Voltage", unit: "V", category: "PV STRING VOLTAGE" },
    { path: "pvStrings.string1.current", label: "PV1 DC Current", unit: "A", category: "PV STRING CURRENT" },
    { path: "pvStrings.string2.current", label: "PV2 DC Current", unit: "A", category: "PV STRING CURRENT" },
    { path: "pvStrings.string3.current", label: "PV3 DC Current", unit: "A", category: "PV STRING CURRENT" },
    { path: "pvStrings.string4.current", label: "PV4 DC Current", unit: "A", category: "PV STRING CURRENT" },
    { path: "pvStrings.string1.power", label: "PV1 DC Power", unit: "W", category: "PV STRING POWER" },
    { path: "pvStrings.string2.power", label: "PV2 DC Power", unit: "W", category: "PV STRING POWER" },
    { path: "pvStrings.string3.power", label: "PV3 DC Power", unit: "W", category: "PV STRING POWER" },
    { path: "pvStrings.string4.power", label: "PV4 DC Power", unit: "W", category: "PV STRING POWER" },

    { path: "ac3Phase.phaseR.voltage", label: "Phase R Voltage", unit: "V", category: "AC OUTPUT" },
    { path: "ac3Phase.phaseS.voltage", label: "Phase S Voltage", unit: "V", category: "AC OUTPUT" },
    { path: "ac3Phase.phaseT.voltage", label: "Phase T Voltage", unit: "V", category: "AC OUTPUT" },
    { path: "ac3Phase.phaseR.current", label: "Phase R Current", unit: "A", category: "AC OUTPUT" },
    { path: "ac3Phase.phaseS.current", label: "Phase S Current", unit: "A", category: "AC OUTPUT" },
    { path: "ac3Phase.phaseT.current", label: "Phase T Current", unit: "A", category: "AC OUTPUT" },
    { path: "ac3Phase.phaseR.power", label: "Phase R Power", unit: "W", category: "AC OUTPUT" },
    { path: "ac3Phase.phaseS.power", label: "Phase S Power", unit: "W", category: "AC OUTPUT" },
    { path: "ac3Phase.phaseT.power", label: "Phase T Power", unit: "W", category: "AC OUTPUT" },

    { path: "grid.gridPower", label: "Grid Power", unit: "W", category: "GRID & LOAD" },
    { path: "grid.dailyFeedIn", label: "Daily Feed-in Energy", unit: "kWh", category: "GRID & LOAD" },
    { path: "grid.dailyPurchased", label: "Daily Grid Purchase", unit: "kWh", category: "GRID & LOAD" },
    { path: "load.loadPower", label: "Load Power", unit: "W", category: "GRID & LOAD" },
    { path: "load.dailyConsumption", label: "Daily Consumption", unit: "kWh", category: "GRID & LOAD" },
  ];

  // Path yang isinya register KUMULATIF/harian (reset tiap hari atau
  // makin naik terus) -- pakai nilai MAKSIMUM per hari (§7 dokumentasi:
  // "Etdy_..." style register), bukan rata-rata. Selain daftar ini,
  // semua variabel dianggap nilai sesaat (gauge) -> dirata-rata per hari.
  const PD_GRAPH_CUMULATIVE_PATHS = new Set([
    "overview.energyToday", "overview.energyTotal",
    "battery.dailyCharge", "battery.dailyDischarge",
    "grid.dailyFeedIn", "grid.totalFeedIn", "grid.dailyPurchased", "grid.totalPurchased",
    "load.dailyConsumption", "load.totalConsumption",
  ]);

  // Katalog "Add Graph" sekarang di-cache PER PROYEK (keyed by pdCurrentId),
  // BUKAN satu variabel global lagi. Sebelumnya begitu proyek Tawabi dibuka
  // sekali, pdGraphCatalog/pdGraphView ke-cache selamanya dan TETAP dipakai
  // walau user pindah ke proyek lain -- jadi tombol "Add Graph" di proyek
  // manapun selalu menampilkan daftar variabel + toggle "Grup 1/Grup 2"
  // milik PLTS Tawabi, bukan device/unit milik proyek yang sedang aktif.
  // Sekarang tiap proyek (key = id proyek, sama dengan pdCurrentId) punya
  // katalog sendiri, di-fetch dari system/device PROYEK ITU SENDIRI lewat
  // pdFetchGraphUnitsForProject(projectId) di bawah.
  let pdGraphCatalogByProject = {};
  let pdGraphCatalogPromiseByProject = {};
  let pdGraphUnitsCacheByProject = {}; // { [projectId]: [{ deviceId, systemLabel, history, history1d }] }
  // FIX (disclaimer §5 poin 1 & 2, lanjutan): cache TERPISAH khusus buat
  // fetch "hourly-only" (cuma history1d, TANPA 90/7/30 hari) -- lihat
  // pdEnsureHourlyCatalog() & pdFetchGraphUnitsForProject(projectId,
  // {lite:true}) di bawah. Dulu renderPerformanceAnalytics() (buat
  // ngisi kartu custom "Add Graph" yang defaultnya mode 24H) manggil
  // pdEnsureGraphCatalog() PENUH (90+1+7+30 hari, paralel utk SEMUA
  // unit) begitu proyek dibuka kalau proyek itu sudah punya kartu
  // custom tersimpan -- persis pola "pre-fetch histori 30/90 hari utk
  // seluruh unit device secara paralel saat halaman baru dibuka" yang
  // dilarang laporan optimasi, cuma "nyamar" jadi on-demand karena
  // dibungkus kondisi hasCustomCards. Karena kartu custom disimpan di
  // localStorage per proyek, syarat itu jadi TRUE terus buat proyek
  // mana pun yang pernah ditambahi 1 kartu custom -- jadi tiap kali
  // proyek itu dibuka lagi, fetch berat itu tetap kepicu otomatis.
  // Sekarang eager-trigger-nya diganti versi "lite" (cuma history1d,
  // 1 request/unit -- SAMA persis bebannya dengan pdLoadOneTawabiUnit
  // yang memang sudah jalan tiap halaman dibuka), cukup buat ngisi
  // mode 24H default. Fetch 90/7/30-hari yang berat tetap murni
  // on-demand: baru jalan saat user klik tab "7 Days"/"30 Days"/
  // "Custom" (setPerfPeriodMode) atau buka modal "Add Graph"
  // (openPdGraphModal) -- lihat pdEnsureGraphCatalog(), TIDAK diubah.
  let pdHourlyCatalogPromiseByProject = {};
  let pdHourlyCatalogSettledByProject = {};
  function pdCurrentGraphCatalog() { return pdGraphCatalogByProject[pdCurrentId] || null; }

  // Versi generik dari pdExtractTawabiSystems/pdExtractDevicesForSystem --
  // SAMA logikanya, tapi TANPA fallback ke ID system/device Tawabi yang
  // di-hardcode (PD_TAWABI_SYSTEM_ID/PD_TAWABI_DEVICE_ID). Dipakai buat
  // katalog "Add Graph" proyek API selain Tawabi, supaya proyek yang
  // memang belum punya system/device terpasang cukup menghasilkan
  // catalog kosong (modal akan menampilkan pesan error yang jelas),
  // BUKAN diam-diam menampilkan device Tawabi.
  function pdExtractSystemsGeneric(project) {
    return project.systems || project.units || [];
  }
  function pdExtractDevicesForSystemGeneric(project, system, systemIndex, totalSystems) {
    const devicesArr = (system && (system.devices || system.inverters)) || [];
    if (devicesArr.length) return devicesArr;
    const projectDevices = project.devices || project.inverters || [];
    const matched = projectDevices.filter((d) => (d.system_id || d.systemId) === system?.id);
    if (matched.length) return matched;
    if (projectDevices.length === totalSystems) {
      return projectDevices[systemIndex] ? [projectDevices[systemIndex]] : [];
    }
    if (systemIndex === 0) return projectDevices;
    return [];
  }

  // Ambil telemetry/history REAL (§4.5 dokumentasi) tiap unit dari PROYEK
  // YANG SEDANG AKTIF (Grup 1, Grup 2, dst) langsung dari Core API, khusus
  // buat catalog "Add Graph" (rentang PD_GRAPH_HISTORY_DAYS hari, independen
  // dari fetch 1D/30D yang dipakai kartu-kartu lain supaya modal ini tetap
  // bisa dibuka walau belum sempat pdLoadRealTawabiProject()/
  // pdLoadRealApiProject() untuk proyek ini).
  //
  // Tawabi tetap lewat pdFindTawabiProject()/pdExtractTawabiSystems (jalur
  // lama, sudah teruji); proyek Core API lainnya di-resolve generik lewat
  // GET /projects/:id (apiId dari projects[id]._apiProjectId, sama seperti
  // pdLoadRealApiProject) + pdExtractSystemsGeneric/pdExtractDevicesForSystemGeneric,
  // supaya "Grup 1/Grup 2" & daftar variabel yang tampil selalu ikut
  // menyesuaikan proyek yang sedang dipilih (pdCurrentId), bukan selalu Tawabi.
  //
  // history1d (1 hari) DITAMBAHKAN di sini juga -- dipakai supaya mode
  // "24 Hours" kartu custom (di-tambah lewat "Add Graph") bisa pakai
  // jam-jaman REAL (sama seperti kartu built-in lewat pdBuildRealPerformance),
  // BUKAN lagi gelombang sinus sintetis (lihat pdCustomCardMeta) yang bisa
  // turun ke minus walau variabelnya secara fisik tidak mungkin negatif
  // (mis. Current Power/PV Total Power jam 02:00 malam).
  async function pdFetchGraphUnitsForProject(projectId, opts) {
    // FIX (disclaimer §5 poin 1 & 2): opts.lite=true cuma fetch
    // history1d (1 request/device, sama beban dgn pdLoadOneTawabiUnit
    // di page load) -- DIPAKAI OLEH pdEnsureHourlyCatalog() buat ngisi
    // mode 24H kartu custom "Add Graph" begitu proyek dibuka, TANPA
    // ikut fetch 90/7/30-hari paralel (yang tetap murni on-demand lewat
    // pdEnsureGraphCatalog() saat tab 7D/30D/Custom diklik atau modal
    // "Add Graph" dibuka). Cache key dipisah ("<id>::lite" vs "<id>")
    // supaya hasil lite TIDAK PERNAH tertukar/dianggap sama dengan hasil
    // fetch penuh (yang py vars/weekly/monthly lengkap).
    const lite = !!(opts && opts.lite);
    const cacheKey = lite ? `${projectId}::lite` : projectId;
    if (pdGraphUnitsCacheByProject[cacheKey]) return pdGraphUnitsCacheByProject[cacheKey];

    let project = null;
    if (projectId === "tawabi") {
      project = await pdFindTawabiProject();
    } else {
      const target = projects[projectId];
      const apiId = (target && target._apiProjectId) || projectId;
      try {
        project = await edashApiFetch(`/projects/${apiId}`);
      } catch (e) {
        console.warn(`[project-detail] Gagal ambil GET /projects/${apiId} untuk katalog Add Graph:`, e.message);
      }
    }
    if (!project) return [];

    const systemsMeta = projectId === "tawabi" ? pdExtractTawabiSystems(project) : pdExtractSystemsGeneric(project);
    const fallbackLabel = (projects[projectId] && projects[projectId].label) || "Unit";
    const jobs = [];
    systemsMeta.forEach((system, i) => {
      const devices = projectId === "tawabi"
        ? pdExtractDevicesForSystem(project, system, i, systemsMeta.length)
        : pdExtractDevicesForSystemGeneric(project, system, i, systemsMeta.length);
      devices.forEach((device) => {
        const deviceId = (device && (device.id || device.thingsboardDeviceId)) || (projectId === "tawabi" ? PD_TAWABI_DEVICE_ID : null);
        if (!deviceId) return;
        const systemLabel = (system && (system.system_name || system.systemName || system.name)) || `${fallbackLabel} Grup ${i + 1}`;
        // history7d/history30d (RAW, TANPA di-bucket per-hari) DITAMBAHKAN
        // di sini juga -- sama alasannya seperti history1d di atas: supaya
        // mode "7 Days"/"30 Days" kartu custom "Add Graph" bisa pakai titik
        // RAW dari API (15 menit/jam, sama seperti System Information),
        // BUKAN lagi 1 titik/hari hasil bucketing dari fetch
        // PD_GRAPH_HISTORY_DAYS (90 hari) di atas -- fetch 90-hari itu
        // SELALU dapat interval kasar dari backend (harian) karena
        // intervalnya dihitung dari TOTAL durasi query, bukan dari rentang
        // yang sedang ditampilkan, jadi tidak bisa dipakai ulang buat
        // resolusi halus 7/30 hari, wajib fetch terpisah.
        // MERGE: jobs sekarang array FUNGSI (bukan Promise yang sudah
        // jalan) supaya bisa dijalankan lewat pdRunBatched di bawah --
        // device berikutnya baru benar-benar mulai fetch begitu dapat
        // slot kosong, bukan semuanya nembak bersamaan.
        jobs.push(
          lite
            // Mode lite: cuma history1d, SATU request/device -- bukan 4
            // request/device (90+1+7+30 hari) kayak fetch penuh di bawah.
            ? () => pdFetchDeviceHistory(deviceId, 1).then((history1d) => ({ deviceId, systemLabel, history: null, history1d, history7d: null, history30d: null }))
            // MERGE (dari perbaikan temen tim frontend): dulu ke-4
            // rentang (1d/7d/30d/90d) ditembak SEKALIGUS lewat Promise.all
            // per unit -- 30d & 90d jauh lebih berat (data mentah/
            // unaggregated, rentang lebih panjang) daripada 1d/7d, jadi
            // kalau dibarengkan mereka rebutan resource. Sekarang 1d/7d
            // (ringan) + 90d (history utama, cuma 1x per unit) jalan
            // bareng duluan (pdRunBatched limit 3), 30d MENYUSUL begitu
            // salah satu di antaranya selesai -- supaya 30d tidak pernah
            // bertabrakan langsung dengan 90d (2 rentang paling berat).
            : () => pdRunBatched([
                () => pdFetchDeviceHistory(deviceId, 1),
                () => pdFetchDeviceHistory(deviceId, 7),
                () => pdFetchDeviceHistory(deviceId, PD_GRAPH_HISTORY_DAYS),
                () => pdFetchDeviceHistory(deviceId, 30),
              ], 3).then(([history1d, history7d, history, history30d]) => ({ deviceId, systemLabel, history, history1d, history7d, history30d }))
        );
      });
    });
    // MERGE: batasi 2 unit sekaligus lewat pdRunBatched, gantiin
    // Promise.all(jobs) polos atas SEMUA unit proyek -- lihat pdRunBatched
    // di atas. Ini TIDAK mengubah kapan fetch ini boleh mulai (tetap
    // murni on-demand, lihat pdEnsureGraphCatalog/pdEnsureHourlyCatalog),
    // cuma membatasi berapa banyak yang boleh jalan bersamaan begitu
    // memang waktunya fetch.
    const units = (await pdRunBatched(jobs, 2)).filter((u) => lite ? u.history1d : u.history);
    pdGraphUnitsCacheByProject[cacheKey] = units;
    return units;
  }

  // Cari label waktu RAW (resolusi asli data logger, biasanya tiap 5
  // menit -- SAMA seperti System Information's parseTawabiHistoryResponse,
  // yang juga langsung plot tiap titik dari response API apa adanya,
  // BUKAN dirata-rata per jam) dari series pertama yang ada isinya di
  // history1d satu unit. Dipakai supaya sumbu-X mode "24 Hours" kartu
  // custom "Add Graph" punya kepadatan yang sama kayak grafik di System
  // Information, bukan cuma 24 titik kasar.
  const PD_GRAPH_HOURLY_LABEL_PRIORITY = [
    "overview.currentPower", "overview.pvTotalPower",
    "ac3Phase.phaseR.voltage", "ac3Phase.phaseR.current", "battery.voltage"
  ];
  // Generalisasi dari versi lama (khusus history1d) -- dipakai juga buat
  // mode "7 Days"/"30 Days" kartu custom "Add Graph" di bawah
  // (pdRawWeeklyLabelsFromHistory7d/pdRawMonthlyLabelsFromHistory30d),
  // supaya sumbu-X-nya sama-sama plot label per TITIK RAW dari response
  // API (bukan per-hari), persis seperti System Information. withDate=true
  // dipakai untuk rentang >1 hari (7d/30d) supaya labelnya include tanggal
  // -- kalau cuma "14:30" doang, jam yang sama keulang tiap hari jadi
  // bingung mana hari yang mana di sumbu grafik (sama seperti alasan yang
  // sama di parseTawabiHistoryResponse() di js/system-information.js).
  function pdRawPeriodLabelsFromHistory(historyResp, tz, withDate) {
    let reference = null;
    for (const path of PD_GRAPH_HOURLY_LABEL_PRIORITY) {
      const s = pdGetPath(historyResp, path);
      if (Array.isArray(s) && s.length) { reference = s; break; }
    }
    if (!reference) {
      for (const def of PD_GRAPH_VAR_DEFS) {
        const s = pdGetPath(historyResp, def.path);
        if (Array.isArray(s) && s.length) { reference = s; break; }
      }
    }
    if (!reference) return [];
    const fmt = withDate
      ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      : new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    return reference.map((pt) => fmt.format(new Date(pt.ts)));
  }
  function pdRawHourlyLabelsFromHistory1d(history1d, tz) {
    return pdRawPeriodLabelsFromHistory(history1d, tz, false);
  }

  // Bongkar telemetry/history tiap unit (skema ternormalisasi Rev3)
  // jadi bentuk { meta:{vars,status_vars}, groups:{grup1:{name,sn,data:
  // {labels,<path>:[...]}}, grup2:{...}} } -- SAMA PERSIS dengan bentuk
  // file lokal lama, supaya pdBuildGraphView/pdGraphRealSeries/
  // pdCustomCardMeta di bawah tidak perlu diubah sama sekali.
  function pdBuildGraphCatalogFromUnits(units) {
    const dates = pdLastNDates(PD_GRAPH_HISTORY_DAYS, PD_TAWABI_TIMEZONE);
    const groups = {};
    units.forEach((u, i) => {
      const gid = `grup${i + 1}`;
      const data = { labels: dates };
      const hourlyLabels = pdRawHourlyLabelsFromHistory1d(u.history1d, PD_TAWABI_TIMEZONE);
      const hourly = { labels: hourlyLabels };
      // "7 Days" (titik tiap 15 menit) & "30 Days" (titik tiap 1 jam) --
      // sama seperti "hourly" di atas, plot LANGSUNG titik raw dari
      // response API (bukan 1 titik/hari), pakai fetch terpisah
      // history7d/history30d (lihat pdFetchGraphUnitsForProject) supaya
      // resolusinya konsisten dengan grafik System Information.
      const weeklyLabels = pdRawPeriodLabelsFromHistory(u.history7d, PD_TAWABI_TIMEZONE, true);
      const weekly = { labels: weeklyLabels };
      const monthlyLabels = pdRawPeriodLabelsFromHistory(u.history30d, PD_TAWABI_TIMEZONE, true);
      const monthly = { labels: monthlyLabels };
      // "Custom Range" -- sama pola dengan weekly/monthly di atas, titik
      // RAW dari API (resolusinya ditentukan backend secara adaptif dari
      // lama rentang tanggal yang dipilih user, lihat pdEnsureGraphCustomData),
      // BUKAN lagi 1 titik/hari (pdPerfDailySeries). u.historyCustom cuma
      // ada kalau user sudah pernah pilih rentang Custom di proyek ini.
      const customLabels = pdRawPeriodLabelsFromHistory(u.historyCustom, PD_TAWABI_TIMEZONE, true);
      const custom = { labels: customLabels };
      PD_GRAPH_VAR_DEFS.forEach((def) => {
        const series = pdGetPath(u.history, def.path);
        if (Array.isArray(series) && series.length) {
          const map = PD_GRAPH_CUMULATIVE_PATHS.has(def.path)
            ? pdBucketByDateMax(series, PD_TAWABI_TIMEZONE)
            : pdBucketByDateAvg(series, PD_TAWABI_TIMEZONE);
          data[def.path] = dates.map((d) => (d in map ? +map[d].toFixed(3) : null));
        }
        // FIX: dulu di sini di-bucket jadi cuma 24 titik/jam
        // (pdBucketLast24hRolling), rata-rata/max per jam -- kelihatan
        // "kasar"/beda jauh sama grafik System Information yang plot
        // SEMUA titik raw dari response API (biasanya tiap 5 menit).
        // Sekarang dipetakan LANGSUNG dari history1d, per titik, sama
        // persis seperti parseTawabiHistoryResponse() di
        // js/system-information.js -- tidak ada lagi agregasi/averaging,
        // resolusi & bentuk kurvanya jadi identik dengan System
        // Information untuk device yang sama.
        const series1d = pdGetPath(u.history1d, def.path);
        if (Array.isArray(series1d) && series1d.length && hourlyLabels.length) {
          hourly[def.path] = series1d.slice(0, hourlyLabels.length).map((pt) => {
            const n = Number(pt && pt.value);
            return Number.isFinite(n) ? +n.toFixed(3) : null;
          });
        }
        // "7 Days" (titik tiap 15 menit dari history7d) & "30 Days" (titik
        // tiap 1 jam dari history30d) -- sama polanya kayak "hourly" di
        // atas, dipetakan LANGSUNG per titik, TANPA di-bucket per-hari.
        const series7d = pdGetPath(u.history7d, def.path);
        if (Array.isArray(series7d) && series7d.length && weeklyLabels.length) {
          weekly[def.path] = series7d.slice(0, weeklyLabels.length).map((pt) => {
            const n = Number(pt && pt.value);
            return Number.isFinite(n) ? +n.toFixed(3) : null;
          });
        }
        const series30d = pdGetPath(u.history30d, def.path);
        if (Array.isArray(series30d) && series30d.length && monthlyLabels.length) {
          monthly[def.path] = series30d.slice(0, monthlyLabels.length).map((pt) => {
            const n = Number(pt && pt.value);
            return Number.isFinite(n) ? +n.toFixed(3) : null;
          });
        }
        const seriesCustom = pdGetPath(u.historyCustom, def.path);
        if (Array.isArray(seriesCustom) && seriesCustom.length && customLabels.length) {
          custom[def.path] = seriesCustom.slice(0, customLabels.length).map((pt) => {
            const n = Number(pt && pt.value);
            return Number.isFinite(n) ? +n.toFixed(3) : null;
          });
        }
      });
      groups[gid] = { name: u.systemLabel, sn: u.deviceId, data, hourly, weekly, monthly, custom };
    });
    const vars = PD_GRAPH_VAR_DEFS.filter((def) =>
      Object.values(groups).some((g) => Array.isArray(g.data[def.path]) && g.data[def.path].some((n) => n != null))
    ).map((def) => ({ key: def.path, label: def.label, unit: def.unit, category: def.category }));
    return { meta: { vars, status_vars: [] }, groups };
  }

  // Ditandai true begitu fetch katalog ("Add Graph") untuk sebuah proyek
  // SELESAI dicoba (berhasil ATAU gagal) -- dipakai buat bedakan overlay
  // "Memuat data..." (fetch masih jalan) dari kartu yang memang genuinely
  // tidak punya data real (fetch sudah selesai tapi tetap flat 0, lihat
  // pdSyntheticDaily/pdCustomCardMeta). Sebelum ini ditandai, overlay
  // TETAP tampil supaya user tidak salah kira flat-0 sementara (baru
  // reload, katalog belum sempat ke-fetch) sebagai "semua variabel sama
  // beneran".
  let pdGraphCatalogSettledByProject = {};
  function pdIsGraphCatalogSettled(projectId) {
    return !!pdGraphCatalogSettledByProject[projectId || pdCurrentId];
  }
  function pdHidePerfChartLoadingOverlays() {
    document.querySelectorAll(".pd-perf-chart-loading").forEach((el) => el.classList.add("is-hidden"));
  }

  // FIX (permintaan user: "load graph lama banget, load pertama kali
  // biasa aja abis itu pake cache"): sama pola dgn Operator Dashboard-nya
  // (js/operator/operator-dashboard.js, ensureGraphCatalog) -- ditambah
  // lapisan sessionStorage (window.EdashStaleCache, js/stale-cache.js)
  // biar katalog "Add Graph" TIDAK hilang begitu tab di-refresh. Sebelum
  // ini pdGraphCatalogByProject cuma cache di memory JS, jadi 90 hari
  // telemetry per device ke-fetch ulang dari nol tiap kali halaman
  // di-reload -- makanya kerasa "lama banget" berulang-ulang padahal
  // datanya sendiri sering belum berubah.
  function pdGraphCatalogCacheKey(projectId) {
    return `pd-add-graph-catalog:${projectId}`;
  }

  function pdRefreshGraphCatalogInBackground(projectId) {
    // Bypass cache unit di memory supaya ini beneran narik ulang dari
    // Core API, bukan cuma balikin hasil lama yang sama lagi.
    delete pdGraphUnitsCacheByProject[projectId];
    pdFetchGraphUnitsForProject(projectId)
      .then((units) => {
        if (!units.length) return;
        // Cuma nimpa `.groups` (data telemetry), BUKAN rebuild
        // categories/id/warna variabel -- supaya modal yang lagi kebuka
        // (kalau ada) tidak kehilangan pilihan variabel yang sudah
        // dicentang gara-gara id-nya berubah.
        const rebuilt = pdBuildGraphCatalogFromUnits(units);
        const catalog = pdGraphCatalogByProject[projectId];
        if (!catalog) return;
        catalog.groups = rebuilt.groups;
        if (window.EdashStaleCache) window.EdashStaleCache.set(pdGraphCatalogCacheKey(projectId), catalog);
      })
      .catch((e) => {
        console.warn(`[project-detail] Gagal refresh katalog Add Graph di belakang layar (proyek ${projectId}):`, e.message);
      });
  }

  function pdEnsureGraphCatalog(projectId) {
    const id = projectId || pdCurrentId;

    // Sudah pernah dibangun di tab ini (sesi JS masih hidup) -- pakai
    // langsung dari memory.
    if (pdGraphCatalogByProject[id]) return Promise.resolve(pdGraphCatalogByProject[id]);

    if (pdGraphCatalogPromiseByProject[id]) return pdGraphCatalogPromiseByProject[id];

    // Belum ada di memory (baru pertama kali DI TAB INI) -- coba dulu
    // sessionStorage (bisa jadi halamannya baru di-refresh, bukan
    // load pertama beneran).
    const cachedEntry = window.EdashStaleCache && window.EdashStaleCache.get(pdGraphCatalogCacheKey(id));
    if (cachedEntry && cachedEntry.data) {
      pdGraphCatalogByProject[id] = cachedEntry.data;
      pdGraphCatalogSettledByProject[id] = true;
      pdRefreshGraphCatalogInBackground(id);
      return Promise.resolve(cachedEntry.data);
    }

    const promise = pdFetchGraphUnitsForProject(id)
      .then((units) => {
        if (!units.length) throw new Error(`Tidak ada unit dengan telemetry/history dari Core API untuk proyek "${(projects[id] && projects[id].label) || id}".`);
        const catalog = pdBuildGraphCatalogFromUnits(units);
        pdGraphCatalogByProject[id] = catalog;
        // Simpan ke sessionStorage juga -- load berikutnya (termasuk
        // lintas refresh) pakai ini dulu (instan) alih-alih fetch 90
        // hari telemetry dari nol lagi.
        if (window.EdashStaleCache) window.EdashStaleCache.set(pdGraphCatalogCacheKey(id), catalog);
        return catalog;
      })
      .catch((e) => {
        console.warn(`[project-detail] Gagal membangun katalog Add Graph (proyek ${id}) dari GET /devices/:id/telemetry/history:`, e.message);
        delete pdGraphCatalogPromiseByProject[id];
        throw e;
      })
      .finally(() => { pdGraphCatalogSettledByProject[id] = true; });
    pdGraphCatalogPromiseByProject[id] = promise;
    return promise;
  }

  // FIX (disclaimer §5 poin 1 & 2, lanjutan): versi RINGAN dari
  // pdEnsureGraphCatalog() di atas -- cuma fetch history1d (lihat
  // pdFetchGraphUnitsForProject(id, {lite:true})), TANPA history
  // 90/7/30-hari. Dipakai HANYA oleh renderPerformanceAnalytics() buat
  // ngisi mode 24H kartu custom "Add Graph" begitu proyek dibuka --
  // BUKAN pengganti pdEnsureGraphCatalog(): begitu user beneran klik
  // tab 7D/30D/Custom atau buka modal "Add Graph", pdEnsureGraphCatalog()
  // (fetch penuh) tetap yang dipanggil (lihat setPerfPeriodMode/
  // openPdGraphModal) dan hasilnya menimpa pdGraphCatalogByProject[id]
  // di sini -- jadi katalog "lite" ini murni pengisi sementara, tidak
  // pernah dianggap final.
  //
  // Kalau fetch penuh SUDAH pernah jalan/lagi jalan (pdGraphCatalogPromiseByProject[id]
  // ada), fungsi ini numpang ke promise itu saja alih-alih fetch lite
  // terpisah -- supaya tidak ada 2 request history1d yang tumpang
  // tindih buat device yang sama.
  function pdEnsureHourlyCatalog(projectId) {
    const id = projectId || pdCurrentId;
    if (pdGraphCatalogPromiseByProject[id]) return pdGraphCatalogPromiseByProject[id];
    if (pdHourlyCatalogPromiseByProject[id]) return pdHourlyCatalogPromiseByProject[id];
    const promise = pdFetchGraphUnitsForProject(id, { lite: true })
      .then((units) => {
        if (!units.length) throw new Error(`Tidak ada unit dengan telemetry/history (lite) dari Core API untuk proyek "${(projects[id] && projects[id].label) || id}".`);
        const catalog = pdBuildGraphCatalogFromUnits(units);
        // Jangan timpa katalog PENUH kalau ternyata sudah landing duluan
        // (mis. race dengan user yang kebetulan langsung buka modal "Add
        // Graph" sebelum fetch lite ini selesai).
        if (!pdGraphCatalogByProject[id]) pdGraphCatalogByProject[id] = catalog;
        return catalog;
      })
      .catch((e) => {
        console.warn(`[project-detail] Gagal membangun katalog lite (24H) (proyek ${id}) dari GET /devices/:id/telemetry/history:`, e.message);
        delete pdHourlyCatalogPromiseByProject[id];
        throw e;
      })
      .finally(() => { pdHourlyCatalogSettledByProject[id] = true; });
    pdHourlyCatalogPromiseByProject[id] = promise;
    return promise;
  }
  function pdIsHourlyCatalogSettled(projectId) {
    return !!pdHourlyCatalogSettledByProject[projectId || pdCurrentId] || pdIsGraphCatalogSettled(projectId);
  }

  // FIX: mode "Custom Range" kartu "Add Graph" dulu selalu plot 1
  // titik/hari (slice dari `data`, hasil bucketing harian fetch 90-hari
  // di atas) -- beda jauh & lebih kasar dari mode "7 Days"/"30 Days"
  // yang sudah plot titik RAW dari API (lihat pdBuildGraphCatalogFromUnits).
  // pdEnsureGraphCustomData() di bawah menarik histori RAW khusus untuk
  // rentang tanggal PERSIS yang dipilih user (bukan preset 7/30 hari),
  // resolusinya (2 jam utk rentang ~1 bulan, dst) ditentukan backend
  // secara adaptif dari lama rentangnya -- sama seperti mode 7D/30D,
  // BUKAN di-hardcode di frontend. Cuma nyimpen SATU rentang custom
  // ter-cache per proyek (u.historyCustom ditimpa tiap kali user ganti
  // tanggal) -- cukup karena cuma rentang yang lagi aktif dilihat yang
  // pernah dibutuhkan render sekaligus.
  let pdGraphCustomRangeByProject = {}; // { [projectId]: { rangeKey, loaded, promise } }
  function pdIsGraphCustomLoaded(projectId, dateFrom, dateTo) {
    const state = pdGraphCustomRangeByProject[projectId || pdCurrentId];
    return !!(state && state.loaded && state.rangeKey === dateFrom + "|" + dateTo);
  }

  // FIX: overlay "Memuat data..." kartu (lihat renderPerformanceCard)
  // dulu cuma cek pdIsGraphCatalogSettled() -- "pernah ada 1 kali fetch
  // katalog yang SELESAI" -- jadi begitu SATU kartu Custom pernah
  // selesai fetch, overlay SEMUA kartu (termasuk yang baru ganti
  // tanggal ke rentang lain yang belum pernah ditarik sama sekali)
  // langsung dianggap "siap" walau datanya sebenarnya masih data
  // rentang LAMA/fallback. pdIsPerfCardDataReady() di bawah nambahin
  // 1 lapis cek KHUSUS mode "custom": rentang tanggal yang lagi aktif
  // di KARTU INI harus benar-benar sudah selesai ditarik
  // (pdIsGraphCustomLoaded, per rentang persis dateFrom|dateTo), bukan
  // cuma "katalog pernah settle sekali". Mode 7D/30D tetap cukup cek
  // katalog settled saja karena history7d/history30d SELALU ditarik
  // BARENG dalam satu fetch penuh yang sama (lihat pdFetchGraphUnitsForProject),
  // tidak per-rentang seperti custom.
  function pdIsPerfCardDataReady(period) {
    if (!pdIsGraphCatalogSettled(pdCurrentId)) return false;
    if (period.mode === "custom") return pdIsGraphCustomLoaded(pdCurrentId, period.dateFrom, period.dateTo);
    return true;
  }

  // Interval dasar yang DIPAKSAKAN untuk mode "Custom Range" -- 2 jam,
  // SAMA seperti mode "30 Days" (bukan diserahkan ke adaptive tiering
  // backend berdasar lama rentang, yang buat rentang >30 hari akan
  // jatuh ke interval 1 hari/2 hari, jauh lebih kasar dari 7D/30D).
  const PD_CUSTOM_BASE_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 jam
  // SAMA PERSIS dengan MAX_SAFE_INTERVALS di calculateAdaptiveAggregation()
  // (thingsboard.service.ts) -- wajib disamakan di sini karena `interval`
  // eksplisit lewat query param BYPASS pengaman itu sepenuhnya (lihat
  // parseHistoryQuery(): kalau `interval` diisi, calculateAdaptiveAggregation()
  // tidak pernah dipanggil sama sekali, jadi doubling safeguard-nya juga
  // tidak ikut jalan). Tanpa disalin ulang di sini, rentang custom yang
  // sangat panjang (mis. 6 bulan/1 tahun) pada interval 2 jam akan
  // menghasilkan ribuan titik -> ThingsBoard menolak query dengan 400
  // "Incorrect TsKvQuery. Number of intervals is to high".
  const PD_CUSTOM_MAX_SAFE_INTERVALS = 500;
  // Dobel interval terus (2 jam -> 4 jam -> 8 jam -> ... -> 1 hari -> dst)
  // sampai jumlah titiknya aman -- rentang custom SEPENDEK APAPUN tidak
  // pernah lebih halus dari 2 jam (base-nya sendiri 2 jam), rentang
  // custom SEPANJANG APAPUN otomatis coarsen sendiri secukupnya, tidak
  // pernah sampai request-nya ditolak backend.
  function pdComputeCustomIntervalMs(durationMs) {
    let interval = PD_CUSTOM_BASE_INTERVAL_MS;
    while (durationMs / interval > PD_CUSTOM_MAX_SAFE_INTERVALS) interval *= 2;
    return interval;
  }

  async function pdEnsureGraphCustomData(projectId, dateFrom, dateTo) {
    const id = projectId || pdCurrentId;
    if (!dateFrom || !dateTo) return false;
    const rangeKey = dateFrom + "|" + dateTo;
    const state = (pdGraphCustomRangeByProject[id] = pdGraphCustomRangeByProject[id] || {});
    if (state.rangeKey === rangeKey && state.loaded) return true;
    if (state.rangeKey === rangeKey && state.promise) return state.promise;

    state.rangeKey = rangeKey;
    state.loaded = false;
    state.promise = (async () => {
      try {
        // Katalog dasar (daftar unit/deviceId) harus sudah ada dulu --
        // aman/murah dipanggil ulang, pdEnsureGraphCatalog() sudah memoize.
        await pdEnsureGraphCatalog(id);
        const units = pdGraphUnitsCacheByProject[id] || [];
        if (!units.length) return false;

        // Rentang dihitung dari tanggal LOKAL yang dipilih user (00:00
        // tanggal "from" s/d akhir tanggal "to"), endTs dibulatkan ke
        // kelipatan 1 menit & tidak pernah melewati "sekarang" (jaga-jaga
        // kalau tanggal "to" adalah hari ini).
        const startTs = new Date(dateFrom + "T00:00:00").getTime();
        const endTsRaw = new Date(dateTo + "T23:59:59").getTime();
        const endTs = Math.min(Math.floor(Date.now() / 60000) * 60000, endTsRaw);
        if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || startTs >= endTs) return false;

        const intervalMs = pdComputeCustomIntervalMs(endTs - startTs);
        // Concurrency 3 (bukan 2 kayak fetch dasar) -- fetch ini SUDAH
        // di-debounce (lihat pdCustomDateDebounceTimers di
        // setPerfCustomDate) & murni on-demand (baru jalan pas user
        // beneran pilih tanggal), jadi beda dari fetch dasar/awal yang
        // memang perlu dijaga pelan-pelan biar tidak numpuk beban ke
        // banyak unit sekaligus saat page baru dibuka.
        const results = await pdRunBatched(units.map((u) => () => pdFetchDeviceHistoryRange(u.deviceId, startTs, endTs, intervalMs)), 3);
        units.forEach((u, i) => { u.historyCustom = results[i]; });

        pdGraphCatalogByProject[id] = pdBuildGraphCatalogFromUnits(units);
        if (state.rangeKey === rangeKey) state.loaded = true;
        return true;
      } catch (e) {
        console.warn(`[project-detail] Gagal lazy-load history custom (${dateFrom}..${dateTo}) katalog Add Graph (proyek ${id}):`, e.message);
        return false;
      } finally {
        if (state.rangeKey === rangeKey) delete state.promise;
      }
    })();
    return state.promise;
  }

  // Per-card state, keyed "<projectId>:<perfKey>" so switching
  // projects never leaks one project's period pick into another's.
  const pdPerfState = {};
  const pdPerfChartInstances = {};
  const pdPerfFullSeries = {};
  const pdPerfRangeState = {};

  function pdPerfStateFor(id) {
    if (!pdPerfState[id]) pdPerfState[id] = { mode: "24h", dateFrom: null, dateTo: null };
    return pdPerfState[id];
  }

  function pdPerfPeriodSliceBounds(labels, period) {
    if (!labels.length) return { fromIdx: 0, toIdx: -1 };
    let fromIdx = 0, toIdx = labels.length - 1;
    const mode = (period && period.mode) || "30d";
    if (mode === "7d") {
      fromIdx = Math.max(0, labels.length - 7);
    } else if (mode === "30d") {
      fromIdx = Math.max(0, labels.length - 30);
    } else if (mode === "custom") {
      if (period.dateFrom) {
        const idx = labels.findIndex((d) => d >= period.dateFrom);
        fromIdx = idx === -1 ? labels.length - 1 : idx;
      }
      if (period.dateTo) {
        let idx = -1;
        for (let i = labels.length - 1; i >= 0; i--) { if (labels[i] <= period.dateTo) { idx = i; break; } }
        toIdx = idx === -1 ? 0 : idx;
      }
    }
    if (fromIdx > toIdx) { const t = fromIdx; fromIdx = toIdx; toIdx = t; }
    return { fromIdx, toIdx };
  }

  // FIX: dulu di sini fallback-nya kurva sinus/cosinus "sintetis" (naik-
  // turun meyakinkan) kalau katalog Add Graph (GET /devices/:id/
  // telemetry/history) belum ke-load atau variabelnya nggak ada
  // datanya. Itu MENYESATKAN -- kelihatan seolah-olah data produksi
  // beneran padahal cuma pola matematis. Disamakan dengan fix yang
  // sama di js/system-information.js (flatZeroSeries): kalau data
  // real belum/tidak tersedia, WAJIB garis datar 0, supaya user
  // langsung tahu artinya "belum ada data", bukan data listrik asli.
  // baseValue/amplitude dipertahankan di signature (bukan dipakai lagi)
  // supaya pemanggil lama tidak perlu diubah.
  function pdSyntheticDaily(baseValue, amplitude, days = 60) {
    const labels = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      labels.push(d.toISOString().slice(0, 10));
    }
    return { labels, values: labels.map(() => 0) };
  }

  function pdPerfDailySeries(p, perfKey, meta) {
    const catalog = pdCurrentGraphCatalog();
    if (catalog) {
      const gid = meta.deviceGroupId || "grup1";
      const groupData = catalog.groups[gid] && catalog.groups[gid].data;
      const keys = meta.catalogKeys || PD_PERF_CATALOG_KEYS[perfKey];
      if (groupData && keys) {
        const labels = groupData.labels || [];
        const values = labels.map((_, i) => {
          const nums = keys.map((k) => (groupData[k] || [])[i]).filter((n) => typeof n === "number" && isFinite(n));
          return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
        });
        return { labels, values };
      }
    }
    return pdSyntheticDaily(meta.value || 0, Math.max(Math.abs(meta.value || 1) * 0.05, 1));
  }

  function pdPerfHourlySeries(meta) {
    // Kartu custom ("Add Graph", vars[0] ada) -- coba data jam-jaman REAL
    // dari catalog dulu (sama seperti kartu built-in di bawah), supaya
    // mode 24H tidak lagi pakai gelombang sinus sintetis (meta.data) yang
    // bisa turun ke minus untuk variabel yang secara fisik non-negatif.
    if (meta.vars && meta.vars.length === 1) {
      const real = pdGraphRealHourlySeries(meta.vars[0], meta.vars[0].groupId || meta.deviceGroupId);
      if (real) return real;
    }
    const values = meta.data || [];
    if (meta.labels && meta.labels.length === values.length) return { labels: meta.labels, values };
    const labels = values.map((_, i) => {
      if (i === values.length - 1) return "Now";
      const hour = Math.round((i / Math.max(values.length - 1, 1)) * 24);
      return `${String(hour).padStart(2, "0")}:00`;
    });
    return { labels, values };
  }

  // Versi mode "7 Days" (titik 15 menit, dari history7d) & "30 Days"
  // (titik 1 jam, dari history30d) dari pdPerfHourlySeries di atas --
  // sama pola/fallback-nya, cuma beda periodKey catalog yang dibaca
  // (lihat pdGraphRealPeriodSeries/pdBuildGraphCatalogFromUnits). Fallback
  // kalau catalog belum siap tetap flat 0 (pdSyntheticDaily), BUKAN kurva
  // sintetis, supaya konsisten dengan flatZeroSeries di
  // js/system-information.js.
  function pdPerfWeeklySeries(meta) {
    if (meta.vars && meta.vars.length === 1) {
      const real = pdGraphRealPeriodSeries(meta.vars[0], meta.vars[0].groupId || meta.deviceGroupId, "weekly");
      if (real) return real;
    }
    return pdSyntheticDaily(meta.value || 0, Math.max(Math.abs(meta.value || 1) * 0.05, 1));
  }
  function pdPerfMonthlySeries(meta) {
    if (meta.vars && meta.vars.length === 1) {
      const real = pdGraphRealPeriodSeries(meta.vars[0], meta.vars[0].groupId || meta.deviceGroupId, "monthly");
      if (real) return real;
    }
    return pdSyntheticDaily(meta.value || 0, Math.max(Math.abs(meta.value || 1) * 0.05, 1));
  }
  // Versi mode "Custom Range" -- sama pola dengan Weekly/Monthly di
  // atas, baca field "custom" katalog (diisi pdEnsureGraphCustomData
  // begitu user pilih tanggal from/to). Kalau rentang yang dipilih user
  // BEDA dari rentang yang lagi ke-cache di catalog.custom (mis. user
  // baru saja ganti tanggal dan fetch-nya belum kelar), pdGraphRealPeriodSeries
  // tetap balikin data catalog.custom yang ADA (rentang lama) sampai
  // fetch baru selesai & renderPerformanceAnalytics dipanggil ulang --
  // dijaga oleh guard di setPerfCustomDate/setPerfPeriodMode.
  function pdPerfCustomSeries(meta) {
    if (meta.vars && meta.vars.length === 1) {
      const real = pdGraphRealPeriodSeries(meta.vars[0], meta.vars[0].groupId || meta.deviceGroupId, "custom");
      if (real) return real;
    }
    return pdSyntheticDaily(meta.value || 0, Math.max(Math.abs(meta.value || 1) * 0.05, 1));
  }

  function renderPerformanceAnalytics(p) {
    const grid = document.getElementById("pdPerformanceGrid");
    if (!grid) return;

    // Chart.js instances from the previous render must be destroyed
    // before their <canvas> elements are thrown away by the
    // innerHTML rebuild below.
    Object.keys(pdPerfChartInstances).forEach((id) => {
      pdPerfChartInstances[id].destroy();
      delete pdPerfChartInstances[id];
    });

    const perfData = buildPerformanceData(p);
    // Order cards by: (1) this project's saved drag-and-drop order
    // (see pdPerfOrderIndex/wirePerfCardDragAndDrop below), then (2)
    // wide ("Lebarkan sebaris") cards floated to the top of the grid
    // and kept grouped together there, same as the Operator
    // dashboard's toggleCardWide — otherwise a card widened in the
    // middle of the grid just takes up its full row in place, pushing
    // the cards after it down unevenly and leaving the ones before it
    // stranded in a half-empty row. Array.prototype.sort is a stable
    // sort, so each pass only reorders on its own criterion and
    // leaves everything else (the previous pass's ordering, or the
    // object's natural key order for never-dragged cards) untouched.
    const perfEntries = Object.entries(perfData)
      .sort((a, b) => pdPerfOrderIndex(a[0]) - pdPerfOrderIndex(b[0]))
      .sort((a, b) => Number(pdIsPerfCardWide(b[0])) - Number(pdIsPerfCardWide(a[0])));
    grid.innerHTML = perfEntries.map(([perfKey, meta]) => renderPerformanceCard(perfKey, meta)).join("")
      + `<button type="button" class="opd-card-add" data-add-perf-card title="Add Graph"><i class="fa-solid fa-plus"></i></button>`;

    wirePerformanceCards(p);
    Object.keys(perfData).forEach((perfKey) => renderPerfCardChart(p, perfKey, perfData[perfKey]));

    // FIX: overlay "Memuat data..." di kartu custom "Add Graph" (lihat
    // renderPerformanceCard, class .pd-perf-chart-loading) cuma
    // disembunyikan begitu fetch katalog pernah SELESAI jalan untuk
    // proyek ini (pdIsHourlyCatalogSettled). Sebelumnya itu dipicu
    // TANPA SYARAT dari selectProject() setiap proyek dibuka -- tapi itu
    // persis pola "pre-fetch histori 30/90 hari untuk semua unit
    // device secara paralel saat halaman baru dibuka" yang sudah
    // dihapus demi lazy-loading (disclaimer §5 poin 1 & 2). Akibatnya
    // kartu custom yang defaultnya 24 Hours (bukan 7D/30D/Custom --
    // satu-satunya mode lain yang memicu fetch, lihat setPerfPeriodMode)
    // jadi TIDAK PERNAH memicu fetch itu sama sekali kalau user cuma
    // reload halaman, spinner-nya nyangkut selamanya sampai user
    // kebetulan buka modal "Add Graph".
    //
    // FIX LANJUTAN (masih disclaimer §5 poin 1 & 2): trigger yang
    // dipasang DI SINI dulu manggil pdEnsureGraphCatalog() -- fetch
    // PENUH 90+1+7+30 hari, paralel utk SEMUA unit -- begitu proyek
    // dibuka kalau proyek itu sudah punya kartu custom tersimpan.
    // Karena kartu custom disimpan di localStorage per proyek, syarat
    // "hasCustomCards" itu jadi TRUE PERMANEN buat proyek mana pun yang
    // pernah ditambahi 1 kartu custom -- jadi ini toh masih persis pola
    // "pre-fetch saat halaman dibuka"/thundering herd yang dilarang,
    // cuma nyamar jadi on-demand. Diganti ke pdEnsureHourlyCatalog(),
    // versi RINGAN yang cuma fetch history1d (1 request/device -- sama
    // beban dengan pdLoadOneTawabiUnit yang memang sudah jalan tiap
    // halaman dibuka), cukup buat ngisi mode 24H default. Fetch
    // 90/7/30-hari yang berat TETAP murni on-demand: baru jalan saat
    // user klik tab "7 Days"/"30 Days"/"Custom" (setPerfPeriodMode) atau
    // buka modal "Add Graph" (openPdGraphModal), lewat
    // pdEnsureGraphCatalog() yang TIDAK diubah.
    const hasCustomCards = perfEntries.some(([, meta]) => meta.vars && meta.vars.length);
    if (hasCustomCards && !pdIsHourlyCatalogSettled(pdCurrentId)) {
      const targetId = pdCurrentId;
      pdEnsureHourlyCatalog(targetId).then(() => {
        if (pdCurrentId === targetId) {
          pdRefreshPerfCardsFromGraphCatalog(p);
          renderPerformanceAnalytics(p);
        }
      }).catch((e) => {
        console.warn(`[project-detail] Gagal memuat katalog 24H (lite) (proyek ${targetId}):`, e.message);
      }).finally(() => {
        if (pdCurrentId === targetId) pdHidePerfChartLoadingOverlays();
      });
    }
  }

  // Upgrade kartu 7D/30D/Custom/24H yang sedang tampil ke data real begitu
  // pdGraphCatalog siap (dipanggil dari openPdGraphModal, BUKAN dari
  // renderPerformanceAnalytics lagi -- lihat catatan di atas). 24H ikut
  // di-refresh sekarang karena catalog juga membawa bucket jam-jaman REAL
  // (history1d, lihat pdFetchTawabiGraphUnits/pdGraphRealHourlySeries),
  // bukan cuma daily bucket 90 hari.
  function pdRefreshPerfCardsFromGraphCatalog(p) {
    if (!pdCurrentGraphCatalog()) return;
    const perfData = buildPerformanceData(p);
    Object.keys(perfData).forEach((perfKey) => renderPerfCardChart(p, perfKey, perfData[perfKey]));
  }

  function renderPerformanceCard(perfKey, v) {
    const id = pdCurrentId + ":" + perfKey;
    const period = pdPerfStateFor(id);
    const wide = pdIsPerfCardWide(perfKey);
    return `<article class="pd-performance-card${wide ? " is-wide" : ""}" data-perf-id="${id}">
      <button type="button" class="opd-card-resize" data-perf-resize="${esc(perfKey)}" title="${wide ? "Kecilkan" : "Lebarkan sebaris"}">
        <i class="fa-solid ${wide ? "fa-down-left-and-up-right-to-center" : "fa-up-right-and-down-left-from-center"}"></i>
      </button>
      <button type="button" class="opd-card-download opd-card-download-csv" data-perf-csv="${esc(perfKey)}" title="Download CSV (selected window)">
        <i class="fa-solid fa-file-csv"></i>
      </button>
      <button type="button" class="opd-card-download opd-card-download-png" data-perf-png="${esc(perfKey)}" title="Download graph as PNG">
        <i class="fa-solid fa-image"></i>
      </button>
      <button type="button" class="opd-card-remove" title="Remove" data-perf-remove="${esc(perfKey)}">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="pd-performance-card-head">
        <div class="pd-performance-title-wrap">
          <span class="opd-card-drag-handle" title="Drag to reorder" aria-hidden="true">
            <i class="fa-solid fa-grip-vertical"></i>
          </span>
          <div class="pd-performance-title-col">
            <span class="pd-performance-title pd-performance-title-editable" title="Click to edit graph" data-edit-perf-card="${esc(perfKey)}">${esc(v.title)}</span>
            ${v.subtitle ? `<span class="pd-performance-subtitle" title="${esc(v.subtitle)}">${esc(v.subtitle)}</span>` : ""}
          </div>
        </div>
      </div>

      <div class="opd-card-period-row">
        <div class="opd-card-period-toggle" data-period-toggle="${id}">
          ${PD_PERF_PERIODS.map((mp) => `
            <button type="button" class="${period.mode === mp.mode ? "is-active" : ""}" data-period="${mp.mode}" title="${mp.title || ""}">${mp.icon ? `<i class="fa-solid ${mp.icon}"></i> ` : ""}${mp.label}</button>
          `).join("")}
        </div>
      </div>

      <div class="opd-card-daterange" data-daterange="${id}" style="${period.mode === "custom" ? "" : "display:none;"}">
        <div class="opd-card-daterange-field"><label>From</label><input type="date" data-date-from="${id}" value="${period.dateFrom || ""}"></div>
        <div class="opd-card-daterange-field"><label>To</label><input type="date" data-date-to="${id}" value="${period.dateTo || ""}"></div>
      </div>

      <div class="pd-performance-chart">
        <canvas id="pdPerfChart-${esc(id)}"></canvas>
        ${v.vars && period.mode !== "24h" ? `<div class="pd-perf-chart-loading${pdIsPerfCardDataReady(period) ? " is-hidden" : ""}" data-perf-loading="${id}"><i class="fa-solid fa-spinner fa-spin"></i> Loading data...</div>` : ""}
      </div>

      <div class="opd-card-range" data-range="${id}">
        <div class="opd-card-range-track" data-range-track="${id}">
          <canvas class="opd-card-range-spark" data-range-spark="${id}" height="44"></canvas>
          <div class="opd-card-range-mask opd-card-range-mask-left" data-range-mask-left="${id}"></div>
          <div class="opd-card-range-mask opd-card-range-mask-right" data-range-mask-right="${id}"></div>
          <div class="opd-card-range-fill" data-range-fill="${id}"></div>
          <div class="opd-card-range-handle" data-range-handle="from" data-range-id="${id}"></div>
          <div class="opd-card-range-handle" data-range-handle="to" data-range-id="${id}"></div>
        </div>
        <div class="opd-card-range-caption" data-range-caption="${id}"></div>
      </div>
    </article>`;
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function wirePerformanceCards(p) {
    const grid = document.getElementById("pdPerformanceGrid");
    if (!grid) return;
    grid.querySelectorAll("[data-perf-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removePerfCard(p, btn.getAttribute("data-perf-remove")));
    });
    grid.querySelectorAll("[data-perf-resize]").forEach((btn) => {
      btn.addEventListener("click", () => pdTogglePerfCardWide(p, btn.getAttribute("data-perf-resize")));
    });
    grid.querySelectorAll("[data-perf-png]").forEach((btn) => {
      btn.addEventListener("click", () => downloadPerfChartPng(btn.getAttribute("data-perf-png")));
    });
    grid.querySelectorAll("[data-perf-csv]").forEach((btn) => {
      btn.addEventListener("click", () => downloadPerfChartCsv(btn.getAttribute("data-perf-csv")));
    });
    grid.querySelectorAll("[data-add-perf-card]").forEach((btn) => {
      btn.addEventListener("click", () => openPdGraphModal());
    });
    // Clicking a custom card's title re-opens the same "Create graph"
    // modal, pre-filled from that card, so it can be edited/saved in
    // place instead of only ever being removable. Built-in cards (no
    // matching cfg.custom entry) simply have no data-edit-perf-card
    // handler wired, so nothing happens if one is ever clicked.
    grid.querySelectorAll("[data-edit-perf-card]").forEach((label) => {
      label.addEventListener("click", () => {
        const perfKey = label.getAttribute("data-edit-perf-card");
        const editCard = pdPerfCfgFor(pdCurrentId).custom.find((c) => c.id === perfKey);
        if (editCard) openPdGraphModal(editCard);
      });
    });
    grid.querySelectorAll("[data-period-toggle]").forEach((toggle) => {
      const id = toggle.getAttribute("data-period-toggle");
      const perfKey = id.split(":")[1];
      toggle.querySelectorAll("button[data-period]").forEach((btn) => {
        btn.addEventListener("click", () => setPerfPeriodMode(p, perfKey, btn.getAttribute("data-period")));
      });
    });
    grid.querySelectorAll("[data-date-from]").forEach((input) => {
      const perfKey = input.getAttribute("data-date-from").split(":")[1];
      input.addEventListener("change", () => setPerfCustomDate(p, perfKey, "dateFrom", input.value));
    });
    grid.querySelectorAll("[data-date-to]").forEach((input) => {
      const perfKey = input.getAttribute("data-date-to").split(":")[1];
      input.addEventListener("change", () => setPerfCustomDate(p, perfKey, "dateTo", input.value));
    });

    wirePerfCardDragAndDrop(grid);
  }

  // ---------- drag-and-drop card reordering ----------
  // Same custom pointer-events drag as the Operator dashboard's card
  // grid (js/operator/operator-dashboard.js — see the comment above
  // its wireCardDragAndDrop for why this isn't the native HTML5
  // draggable/dragstart API): grabbing a card's grip handle (top-left,
  // next to its title) spawns a fully opaque floating clone that
  // tracks the pointer, while the other cards in the grid live-shift
  // out of the way as it passes over them. On drop, the on-screen
  // order is copied back into this project's saved order (pdPerfCfgFor
  // .order) and persisted, so it survives a refresh/tab switch. The
  // dashed "+" add tile has no data-perf-id and is never draggable —
  // any card dropped near it is inserted right before it, so it stays
  // last.
  let pdDraggedPerfEl = null;
  let pdDraggedPerfGrid = null;
  let pdDragFloatEl = null;
  let pdDragOffsetX = 0;
  let pdDragOffsetY = 0;

  function wirePerfCardDragAndDrop(grid) {
    // Every render rebuilds the grid's innerHTML, so handles are
    // rewired each time (same pattern as period toggles/remove/resize
    // buttons above).
    grid.querySelectorAll(".opd-card-drag-handle").forEach((handle) => {
      const card = handle.closest(".pd-performance-card[data-perf-id]");
      if (!card) return;
      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return; // left click / primary touch only
        e.preventDefault();
        startPerfCardDrag(e, grid, card);
      });
    });
  }

  function startPerfCardDrag(e, grid, card) {
    pdDraggedPerfEl = card;
    pdDraggedPerfGrid = grid;

    const rect = card.getBoundingClientRect();
    pdDragOffsetX = e.clientX - rect.left;
    pdDragOffsetY = e.clientY - rect.top;

    // Canvas content isn't copied by cloneNode, so the chart + range
    // sparkline canvases are repainted manually from the live card.
    const clone = card.cloneNode(true);
    clone.classList.remove("is-dragging");
    clone.classList.add("opd-card-drag-float");
    clone.style.position = "fixed";
    clone.style.left = rect.left + "px";
    clone.style.top = rect.top + "px";
    clone.style.width = rect.width + "px";
    clone.style.height = rect.height + "px";
    clone.style.margin = "0";
    clone.style.pointerEvents = "none";
    const liveCanvases = card.querySelectorAll("canvas");
    clone.querySelectorAll("canvas").forEach((cloneCanvas, i) => {
      const liveCanvas = liveCanvases[i];
      if (!liveCanvas) return;
      cloneCanvas.width = liveCanvas.width;
      cloneCanvas.height = liveCanvas.height;
      const ctx = cloneCanvas.getContext("2d");
      if (ctx) ctx.drawImage(liveCanvas, 0, 0);
    });
    document.body.appendChild(clone);
    pdDragFloatEl = clone;

    // Hide the original card in place — the floating clone above
    // (fully opaque) is what now visually follows the cursor.
    card.classList.add("is-dragging");

    document.addEventListener("pointermove", onPerfCardDragMove);
    document.addEventListener("pointerup", onPerfCardDragEnd);
    document.addEventListener("pointercancel", onPerfCardDragEnd);
  }

  function onPerfCardDragMove(e) {
    if (!pdDragFloatEl || !pdDraggedPerfEl) return;
    pdDragFloatEl.style.left = (e.clientX - pdDragOffsetX) + "px";
    pdDragFloatEl.style.top = (e.clientY - pdDragOffsetY) + "px";

    // The float has pointer-events:none, so elementFromPoint sees
    // straight through it to the real card underneath the cursor.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under && under.closest(".pd-performance-card[data-perf-id], .opd-card-add");
    if (!target || target === pdDraggedPerfEl) return;
    const grid = pdDraggedPerfGrid;
    if (!grid || !grid.contains(target)) return;

    const isAddTile = target.classList.contains("opd-card-add");
    let insertBefore = true;
    if (!isAddTile) {
      const rect = target.getBoundingClientRect();
      insertBefore = e.clientX < rect.left + rect.width / 2;
    }

    const willMove = insertBefore
      ? target.previousElementSibling !== pdDraggedPerfEl
      : target.nextElementSibling !== pdDraggedPerfEl;
    if (!willMove) return;

    animatePerfCardShift(grid, () => {
      if (insertBefore) {
        grid.insertBefore(pdDraggedPerfEl, target);
      } else {
        grid.insertBefore(pdDraggedPerfEl, target.nextElementSibling);
      }
    });
  }

  function onPerfCardDragEnd() {
    document.removeEventListener("pointermove", onPerfCardDragMove);
    document.removeEventListener("pointerup", onPerfCardDragEnd);
    document.removeEventListener("pointercancel", onPerfCardDragEnd);

    if (pdDragFloatEl) {
      pdDragFloatEl.remove();
      pdDragFloatEl = null;
    }
    if (pdDraggedPerfEl) pdDraggedPerfEl.classList.remove("is-dragging");

    const finishedGrid = pdDraggedPerfGrid;
    pdDraggedPerfEl = null;
    pdDraggedPerfGrid = null;

    if (finishedGrid) syncPerfCardOrderFromDom(finishedGrid);
  }

  // FLIP-style animation: measure every card's position (First), run
  // the actual DOM reorder (Last), then for any card whose position
  // changed, jump it back to where it was with a transform and
  // transition to zero (Invert + Play) — so cards glide into their new
  // spot instead of snapping instantly. The dragged card itself is
  // skipped since its position already tracks the pointer via the
  // floating clone.
  function animatePerfCardShift(grid, moveFn) {
    const cards = Array.from(grid.querySelectorAll(".pd-performance-card[data-perf-id]"))
      .filter((el) => el !== pdDraggedPerfEl);
    const firstRects = new Map();
    cards.forEach((el) => firstRects.set(el, el.getBoundingClientRect()));

    moveFn();

    cards.forEach((el) => {
      const first = firstRects.get(el);
      if (!first) return;
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (!dx && !dy) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // eslint-disable-next-line no-unused-expressions
      el.getBoundingClientRect(); // force reflow so the transform above applies before we transition it away
      requestAnimationFrame(() => {
        el.style.transition = "transform 180ms ease";
        el.style.transform = "";
      });
    });
  }

  // Copies the on-screen order back into this project's saved cfg
  // (perfKey list, e.g. "tawabi:batteryVoltage" -> "batteryVoltage")
  // and persists it. Wide cards still float back to the top on the
  // next render (see renderPerformanceAnalytics's sort), but their
  // relative order — and every non-wide card's order — now follows
  // exactly how the admin last arranged them.
  function syncPerfCardOrderFromDom(grid) {
    const keys = Array.from(grid.querySelectorAll(".pd-performance-card[data-perf-id]"))
      .map((el) => el.getAttribute("data-perf-id").split(":")[1]);
    pdPerfCfgFor(pdCurrentId).order = keys;
    pdPersistPerfCfg();
  }

  // Removing a card just adds/keeps it out of this project's saved
  // selection (built-in keys go on the hide-list, custom cards get
  // deleted outright) — same effect as never adding it via "Add
  // Graph", so it's simple to bring a built-in one back later by
  // clearing localStorage, same as the Operator dashboard's cards.
  function removePerfCard(p, perfKey) {
    const cfg = pdPerfCfgFor(pdCurrentId);
    const id = pdCurrentId + ":" + perfKey;
    if (pdPerfChartInstances[id]) { pdPerfChartInstances[id].destroy(); delete pdPerfChartInstances[id]; }
    delete pdPerfFullSeries[id];
    delete pdPerfRangeState[id];
    const customIdx = cfg.custom.findIndex((c) => c.id === perfKey);
    if (customIdx !== -1) {
      cfg.custom.splice(customIdx, 1);
    } else if (!cfg.hiddenBuiltin.includes(perfKey)) {
      cfg.hiddenBuiltin.push(perfKey);
    }
    const wideIdx = cfg.wide.indexOf(perfKey);
    if (wideIdx !== -1) cfg.wide.splice(wideIdx, 1);
    pdPersistPerfCfg();
    renderPerformanceAnalytics(p);
  }

  function setPerfPeriodMode(p, perfKey, mode) {
    const id = pdCurrentId + ":" + perfKey;
    const period = pdPerfStateFor(id);
    period.mode = mode;
    if (mode === "custom" && (!period.dateFrom || !period.dateTo)) {
      const meta = buildPerformanceData(p)[perfKey];
      const daily = pdPerfDailySeries(p, perfKey, meta);
      if (daily.labels.length) {
        const fromIdx = Math.max(0, daily.labels.length - 30);
        if (!period.dateFrom) period.dateFrom = daily.labels[fromIdx];
        if (!period.dateTo) period.dateTo = daily.labels[daily.labels.length - 1];
      }
    }
    renderPerformanceAnalytics(p);

    // ON-DEMAND FETCH (Rev3 frontend disclaimer §1) -- "7 Days" /
    // "30 Days" / "Custom" adalah SATU-SATUNYA titik pemicu histori
    // 7D/30D/90D. Kartu langsung dirender dulu di atas (pakai data
    // yang sudah ada/fallback), lalu baru di sini katalog di-fetch
    // (kalau belum pernah/masih berjalan utk proyek ini --
    // pdEnsureGraphCatalog() sudah memoize sendiri, jadi klik
    // berulang-ulang tidak memicu fetch ulang) dan kartu di-refresh
    // ke data logger REAL begitu selesai. Mode "24h" tidak menyentuh
    // baris ini sama sekali -- itu satu-satunya mode yang boleh
    // tampil langsung tanpa fetch histori tambahan.
    if (mode !== "24h") {
      const targetId = pdCurrentId;
      pdEnsureGraphCatalog(targetId).then(() => {
        // Mode "Custom" butuh SATU fetch lagi (histori RAW utk rentang
        // tanggal PERSIS dateFrom..dateTo di atas, lihat
        // pdEnsureGraphCustomData) -- katalog dasar di atas cuma
        // menjamin daftar unit/deviceId & data 90-hari/7-hari/30-hari
        // sudah ada, BUKAN histori custom-nya sendiri.
        if (mode === "custom" && period.dateFrom && period.dateTo) {
          return pdEnsureGraphCustomData(targetId, period.dateFrom, period.dateTo);
        }
      }).then(() => {
        if (pdCurrentId === targetId) {
          pdRefreshPerfCardsFromGraphCatalog(p);
          renderPerformanceAnalytics(p);
        }
      }).catch((e) => {
        console.warn(`[project-detail] Gagal memuat histori ${mode} (proyek ${targetId}):`, e.message);
      }).finally(() => {
        if (pdCurrentId === targetId) pdHidePerfChartLoadingOverlays();
      });
    }
  }

  // FIX (permintaan user -- custom range kerasa lambat): akar
  // masalahnya BUKAN cuma "network lambat", tapi setiap kali tanggal
  // berubah (bahkan cuma mundur/maju 1-2 hari), rentang startTs/endTs
  // yang dikirim ke backend JADI BEDA TOTAL dari rentang sebelumnya --
  // itu berarti cache key di backend (lihat controller telemetry:
  // cacheKey pakai alignedStartTs/alignedEndTs persis) SELALU cache-miss,
  // jadi ThingsBoard WAJIB hitung ulang agregasinya dari nol tiap kali,
  // untuk SEMUA unit. Kalau user pakai panah naik/turun di
  // <input type="date"> (tiap ketuk = 1 event "change" di banyak
  // browser) atau ganti field "From" lalu langsung "To", ini artinya
  // BEBERAPA fetch penuh (semua unit) tertumpuk beruntun -- bukan cuma
  // 1 kali, padahal yang kepake cuma hasil TERAKHIR.
  //
  // pdCustomDateDebounceTimers di bawah nunda pdEnsureGraphCustomData()
  // 500ms setelah perubahan tanggal TERAKHIR -- kalau user ganti lagi
  // sebelum 500ms itu abis, timer sebelumnya dibatalin & mulai dari 0.
  // Hasilnya: cuma SATU fetch yang beneran jalan buat kombinasi tanggal
  // FINAL, bukan satu fetch terpisah tiap perubahan kecil di sepanjang
  // jalan -- mengurangi jumlah request bolak-balik ke backend secara
  // signifikan tanpa mengubah kecepatan 1 fetch itu sendiri.
  let pdCustomDateDebounceTimers = {}; // { [projectId]: timeoutId }
  function setPerfCustomDate(p, perfKey, field, value) {
    const id = pdCurrentId + ":" + perfKey;
    const period = pdPerfStateFor(id);
    period.mode = "custom";
    period[field] = value;
    // FIX: dulu di sini cuma renderPerfCardChart() (gambar ulang chart-nya
    // doang) -- overlay "Memuat data..." (bagian dari markup kartu,
    // lihat renderPerformanceCard) TIDAK ikut di-render ulang, jadi
    // walau pdIsPerfCardDataReady() di atas sudah balikin false untuk
    // rentang baru ini, overlay-nya tetap kelihatan "is-hidden" (state
    // lama dari render terakhir) sampai fetch-nya KELAR baru overlay-nya
    // ikut ke-update lewat renderPerformanceAnalytics() di .then() bawah
    // -- user tidak pernah lihat overlay ini SELAMA fetch-nya berjalan,
    // cuma lihat chart "meloncat" tiba-tiba begitu selesai. Ganti ke
    // renderPerformanceAnalytics() penuh di sini supaya overlay kartu
    // ini langsung muncul SAAT tanggal diganti (chart lama tetap
    // kelihatan di baliknya sampai data baru datang, cuma ketutup
    // overlay spinner).
    renderPerformanceAnalytics(p);

    // ON-DEMAND FETCH (DI-DEBOUNCE) -- lihat catatan pdCustomDateDebounceTimers
    // di atas. targetId & rentang tanggal di-"snapshot" di closure ini
    // (dateFromAtSchedule/dateToAtSchedule), BUKAN dibaca ulang dari
    // `period` saat timer akhirnya jalan -- supaya kalau user sempat
    // ganti tanggal LAGI sebelum timer ini sempat jalan, timer LAMA
    // (yang sudah dibatalin di bawah) tidak bisa nyasar fetch rentang
    // yang sudah usang.
    if (period.dateFrom && period.dateTo) {
      const targetId = pdCurrentId;
      const dateFromAtSchedule = period.dateFrom;
      const dateToAtSchedule = period.dateTo;
      clearTimeout(pdCustomDateDebounceTimers[targetId]);
      pdCustomDateDebounceTimers[targetId] = setTimeout(() => {
        delete pdCustomDateDebounceTimers[targetId];
        pdEnsureGraphCustomData(targetId, dateFromAtSchedule, dateToAtSchedule).then(() => {
          if (pdCurrentId === targetId) renderPerformanceAnalytics(p);
        }).catch((e) => {
          console.warn(`[project-detail] Gagal memuat histori custom (proyek ${targetId}):`, e.message);
          // Fetch gagal -- render ulang juga supaya overlay TIDAK nyangkut
          // selamanya (pdIsPerfCardDataReady tetap false krn state.loaded
          // tidak pernah jadi true, tapi setidaknya chart fallback/lama
          // kelihatan lagi drpd ketutup spinner terus-terusan).
          if (pdCurrentId === targetId) renderPerformanceAnalytics(p);
        });
      }, 500);
    }
  }

  // ---------- draw a card's real Chart.js chart for its current period ----------
  // Assigns each variable to a y-axis, grouping by unit AND rough
  // magnitude (two vars can share a unit but differ by orders of
  // magnitude, so the smaller one needs its own axis or it gets
  // squashed flat). Ported 1:1 from the Operator dashboard's
  // computeAxisGroups (js/operator/operator-dashboard.js) so a
  // multi-variable card (e.g. "Battery Voltage vs SoC") looks and
  // behaves the same here as it does there.
  function pdComputeAxisGroups(vars, seriesFor) {
    const varStats = vars.map((v) => {
      const arr = seriesFor(v).filter((x) => typeof x === "number" && isFinite(x));
      const maxAbs = arr.length ? Math.max(...arr.map(Math.abs)) : 1;
      return { v, maxAbs: maxAbs || 1 };
    });
    const byUnit = {};
    varStats.forEach((item) => {
      (byUnit[item.v.unit] = byUnit[item.v.unit] || []).push(item);
    });
    const axisGroups = [];
    Object.keys(byUnit).forEach((unit) => {
      const items = byUnit[unit].slice().sort((a, b) => b.maxAbs - a.maxAbs);
      let current = null;
      items.forEach((item) => {
        if (!current || item.maxAbs < current.repMax / 10) {
          current = { key: unit + "_g" + axisGroups.length, unit, varKeys: new Set(), repMax: item.maxAbs };
          axisGroups.push(current);
        }
        current.varKeys.add(item.v.key);
      });
    });
    const varKeyToAxis = {};
    axisGroups.forEach((g) => g.varKeys.forEach((key) => { varKeyToAxis[key] = g.key; }));
    return { axisGroups, varKeyToAxis };
  }

  // Hourly ("24 Hours") series for a single variable of a multi-variable
  // custom card. Prioritaskan data REAL jam-jaman dari catalog (lihat
  // pdGraphRealHourlySeries/history1d di pdFetchTawabiGraphUnits) --
  // fallback ke gelombang sinus sintetis (v.data, lihat pdCustomCardMeta)
  // HANYA kalau catalog belum sempat ke-load sama sekali (mis. modal
  // "Add Graph" belum pernah dibuka di sesi ini), supaya kartu tidak
  // kosong sambil menunggu.
  function pdPerfHourlySeriesForVar(v, groupId) {
    return pdPerfPeriodSeriesForVar(v, groupId, "hourly");
  }

  // Versi mode "7 Days"/"30 Days" dari pdPerfHourlySeriesForVar di atas,
  // dipakai kartu multi-variabel (renderPerfCardChartMulti) -- lihat
  // pdPerfWeeklySeries/pdPerfMonthlySeries untuk versi single-variable-nya.
  function pdPerfWeeklySeriesForVar(v, groupId) {
    return pdPerfPeriodSeriesForVar(v, groupId, "weekly");
  }
  function pdPerfMonthlySeriesForVar(v, groupId) {
    return pdPerfPeriodSeriesForVar(v, groupId, "monthly");
  }
  // Versi mode "Custom Range" -- lihat pdPerfCustomSeries untuk versi
  // single-variable-nya.
  function pdPerfCustomSeriesForVar(v, groupId) {
    return pdPerfPeriodSeriesForVar(v, groupId, "custom");
  }
  function pdPerfPeriodSeriesForVar(v, groupId, periodKey) {
    const real = pdGraphRealPeriodSeries(v, groupId, periodKey);
    if (real) return real;
    const values = v.data || [];
    const labels = values.map((_, i) => {
      if (i === values.length - 1) return "Now";
      const hour = Math.round((i / Math.max(values.length - 1, 1)) * 24);
      return `${String(hour).padStart(2, "0")}:00`;
    });
    return { labels, values };
  }

  // Multi-variable rendering path — used when a card has 2+ variables
  // selected (e.g. via "Add graph" -> checking more than one variable).
  // Plots EACH variable as its own line, grouping shared-unit variables
  // onto a shared y-axis and giving differing units their own axis (see
  // pdComputeAxisGroups), same as the Operator dashboard's cards. Single-
  // variable cards (built-in or custom) keep using the simpler path in
  // renderPerfCardChart below.
  function renderPerfCardChartMulti(p, perfKey, meta, id, canvas) {
    const period = pdPerfStateFor(id);

    // Each variable can carry its OWN groupId now (a card can mix
    // variables from different device groups, see toggleVar in
    // renderPdGraphVarPanel) -- v.groupId is preferred over the card's
    // primary meta.deviceGroupId, which only remains as a fallback for
    // cards saved before this change (which only ever had one group).
    const seriesForVar = (v) => {
      if (period.mode === "24h") return pdPerfHourlySeriesForVar(v, v.groupId || meta.deviceGroupId);
      // Titik 15 menit/1 jam (history7d/history30d), sama seperti grafik
      // System Information -- BUKAN lagi 1 titik/hari (pdGraphRealSeries).
      if (period.mode === "7d") return pdPerfWeeklySeriesForVar(v, v.groupId || meta.deviceGroupId);
      if (period.mode === "30d") return pdPerfMonthlySeriesForVar(v, v.groupId || meta.deviceGroupId);
      // Titik RAW dari rentang tanggal PERSIS yang dipilih user
      // (history Custom, lihat pdEnsureGraphCustomData) -- BUKAN lagi
      // 1 titik/hari (pdGraphRealSeries) seperti sebelumnya.
      if (period.mode === "custom") return pdPerfCustomSeriesForVar(v, v.groupId || meta.deviceGroupId);
      const daily = pdGraphRealSeries(v, v.groupId || meta.deviceGroupId);
      const { fromIdx, toIdx } = pdPerfPeriodSliceBounds(daily.labels, period);
      return fromIdx <= toIdx
        ? { labels: daily.labels.slice(fromIdx, toIdx + 1), values: daily.values.slice(fromIdx, toIdx + 1) }
        : { labels: [], values: [] };
    };

    if (period.mode === "custom") {
      // `daily` di sini HANYA dipakai buat batas min/max input tanggal
      // (butuh label per-HARI, bukan titik raw 2-jam-an) -- data yang
      // benar-benar diplot ke chart tetap lewat pdPerfCustomSeriesForVar
      // di atas (seriesForVar).
      const daily = pdGraphRealSeries(meta.vars[0], meta.vars[0].groupId || meta.deviceGroupId);
      const fromInput = document.querySelector(`[data-date-from="${id}"]`);
      const toInput = document.querySelector(`[data-date-to="${id}"]`);
      if (daily.labels.length) {
        if (fromInput) { fromInput.min = daily.labels[0]; fromInput.max = daily.labels[daily.labels.length - 1]; }
        if (toInput) { toInput.min = daily.labels[0]; toInput.max = daily.labels[daily.labels.length - 1]; }
      }
    }

    const perVarFull = meta.vars.map((v) => ({ v, s: seriesForVar(v) }));
    const labels = perVarFull[0] ? perVarFull[0].s.labels : [];
    const total = labels.length;
    const periodSignature = period.mode + "|" + (period.dateFrom || "") + "|" + (period.dateTo || "");
    const prevState = pdPerfRangeState[id];
    if (!prevState || prevState.total !== total || prevState.periodSignature !== periodSignature) {
      pdPerfRangeState[id] = { from: 0, to: Math.max(0, total - 1), total, periodSignature };
    }
    const { from: rFrom, to: rTo } = pdPerfRangeState[id];
    const rangedLabels = rFrom <= rTo ? labels.slice(rFrom, rTo + 1) : [];

    // Unified full-period (unranged) store, read by three things: (1)
    // the below-chart mini navigator spark, which only ever looks at
    // series[0]; (2) applyPerfRangeFilter(), so dragging the range
    // handles re-slices EVERY dataset in the card, not just the first
    // one; (3) the PNG/CSV export buttons, which need the exact values
    // currently inside the selected window for every line. The
    // Compare/Stack branches below overwrite `.series`/`.type` with
    // their own derived datasets right before building their chart.
    const cardMultiGroupForFull = pdSelectionSpansMultipleGroups(meta.vars);
    pdPerfFullSeries[id] = {
      labels,
      type: "multi",
      series: perVarFull.map(({ v, s }) => ({
        label: v.label + (v.unit ? " (" + v.unit + ")" : "") + (cardMultiGroupForFull ? " — " + pdGraphGroupName(v.groupId || meta.deviceGroupId) : ""),
        values: s.values,
        negate: false,
      })),
    };

    const seriesFor = (v) => {
      // Matched by object identity (e.v === v), NOT e.v.key === v.key --
      // two variables in the same card can share the same key when they
      // come from different device groups (e.g. "Daily Production" from
      // Grup 1 AND Grup 2), so matching by key alone always resolved to
      // whichever of the two came first in perVarFull, making BOTH
      // datasets plot Grup 1's data and the second line invisible
      // underneath the first. perVarFull was built via
      // `meta.vars.map((v) => ({ v, s: seriesForVar(v) }))` just above,
      // so its `v` entries are the exact same object references as the
      // ones in meta.vars that this is called with -- safe to compare
      // directly instead of by a field that isn't actually unique.
      const entry = perVarFull.find((e) => e.v === v);
      const arr = entry ? entry.s.values : [];
      return rFrom <= rTo ? arr.slice(rFrom, rTo + 1) : [];
    };

    // "Compare" (atas-bawah/mirror) -- kartu ini disimpan dari modal "Add
    // graph" dengan chartType "compare" + comparePair {top,bottom} (lihat
    // pdGraphAddBtn handler & pdCustomCardMeta). Render-nya sama persis
    // dengan preview live di updatePdGraphPreview(): dataset "top" apa
    // adanya, dataset "bottom" dinegasikan supaya turun ke bawah axis 0.
    // Kalau comparePair somehow gak ketemu (mis. kartu lama dari sebelum
    // fitur ini ada, atau salah satu var-nya udah gak ada di catalog),
    // fallback ke rendering Line/Bar biasa di bawah supaya kartu gak
    // rusak/kosong.
    const comparePair = meta.chartType === "compare" && meta.comparePair
      ? {
          topVar: meta.vars.find((v) => v.key === meta.comparePair.top),
          bottomVar: meta.vars.find((v) => v.key === meta.comparePair.bottom),
        }
      : null;

    if (comparePair && comparePair.topVar && comparePair.bottomVar) {
      // Sama persis dengan preview live di updatePdGraphPreview(): bar
      // mirror, "top" apa adanya (naik dari 0), "bottom" dinegasikan
      // (turun ke bawah 0). Styling (fill soft, sudut dibulatkan, jarak
      // antar-bar) disamain juga supaya kartu tersimpan konsisten sama
      // preview modal.
      const topValues = seriesFor(comparePair.topVar);
      const bottomValues = seriesFor(comparePair.bottomVar);
      const topLabel = comparePair.topVar.label + (comparePair.topVar.unit ? " (" + comparePair.topVar.unit + ")" : "");
      const bottomLabel = comparePair.bottomVar.label + (comparePair.bottomVar.unit ? " (" + comparePair.bottomVar.unit + ")" : "");
      const datasets = [
        {
          label: topLabel,
          data: topValues,
          hidden: pdIsSeriesHidden(perfKey, topLabel),
          backgroundColor: pdHexToRgba(comparePair.topVar.color, 0.55),
          borderColor: comparePair.topVar.color,
          borderWidth: 1.5,
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 1,
          categoryPercentage: 1,
          grouped: false,
        },
        {
          label: bottomLabel,
          data: bottomValues.map((n) => (typeof n === "number" && isFinite(n) ? -n : n)),
          hidden: pdIsSeriesHidden(perfKey, bottomLabel),
          backgroundColor: pdHexToRgba(comparePair.bottomVar.color, 0.55),
          borderColor: comparePair.bottomVar.color,
          borderWidth: 1.5,
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 1,
          categoryPercentage: 1,
          grouped: false,
        },
      ];

      // Full (unranged) values for the drag-navigator/export store --
      // seriesFor() above only returns the already-windowed slice, so
      // pull the full arrays straight from perVarFull instead. Bottom
      // stays POSITIVE here (negate:true) so exported CSV numbers match
      // what the variable actually reads, not the mirrored bar's sign.
      const topFull = perVarFull.find((e) => e.v === comparePair.topVar);
      const bottomFull = perVarFull.find((e) => e.v === comparePair.bottomVar);
      pdPerfFullSeries[id] = {
        labels,
        type: "compare",
        series: [
          { label: topLabel, values: topFull ? topFull.s.values : [], negate: false },
          { label: bottomLabel, values: bottomFull ? bottomFull.s.values : [], negate: true },
        ],
      };

      pdPerfChartInstances[id] = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: { labels: rangedLabels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          // Chart.js's default ~1s grow-in animation made this card look
          // much slower to appear than the plain-text stat cards above it
          // (which paint instantly) -- draw it fully rendered right away.
          animation: { duration: 0 },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              display: true, position: "bottom", labels: { boxWidth: 8, font: { size: 9.5, family: "Poppins" } },
              // Persist which line the user clicked off, keyed by label,
              // so it stays hidden the next time this card is rebuilt
              // (page revisit, period switch, drag-range update, etc.) --
              // see pdSetSeriesHidden/pdIsSeriesHidden above.
              onClick: (e, legendItem, legend) => {
                const ci = legend.chart;
                if (ci.isDatasetVisible(legendItem.datasetIndex)) { ci.hide(legendItem.datasetIndex); legendItem.hidden = true; }
                else { ci.show(legendItem.datasetIndex); legendItem.hidden = false; }
                pdSetSeriesHidden(perfKey, legendItem.text, legendItem.hidden);
              },
            },
            tooltip: {
              backgroundColor: "#25343F",
              titleFont: { size: 11, family: "Poppins", weight: "600" },
              bodyFont: { size: 10.5, family: "Poppins" },
              padding: 8,
              cornerRadius: 8,
              callbacks: { label: (ctx) => `${ctx.dataset.label}: ${Math.abs(ctx.parsed.y).toLocaleString("en-US", { maximumFractionDigits: 2 })}` },
            },
          },
          scales: {
            x: { ticks: { font: { size: 9, family: "Poppins" }, maxTicksLimit: 5, autoSkip: true, maxRotation: 0, minRotation: 0 }, grid: { display: false } },
            y: {
              grid: {
                color: (ctx) => (ctx.tick.value === 0 ? "#C9D6D7" : "#EEF3F3"),
                lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 1),
              },
              border: { display: false },
              ticks: { font: { size: 9, family: "Poppins" }, callback: (v) => Math.abs(v) },
            },
          },
        },
      });

      renderPerfCardRangeSlider(id);
      return;
    }

    // "Stack" -- saved card from the "Add graph" modal with chartType
    // "stack" (only available for the Daily Consumption or Daily
    // Production variable, see pdFindStackDef()/PD_GRAPH_STACK_CONFIGS).
    // The derived segments come from 5 other raw paths (not from
    // meta.vars), but still need to be sliced with the SAME period &
    // range (24h/7d/30d/custom + drag range slider) as the main variable
    // so the stack lines up with the card's x-axis (rangedLabels) --
    // reuses seriesForVar()/rFrom/rTo already computed above.
    // meta.vars[0].key is the ONE variable that was checked when this
    // card was saved (the Stack trigger) -- look up which config (and
    // therefore which segment breakdown/labels/colors) applies. Falls
    // through to the normal line/bar rendering below if the key isn't a
    // known trigger anymore (e.g. an old saved card from before a
    // config was renamed/removed), instead of rendering a broken chart.
    const stackConfig = meta.chartType === "stack" && meta.vars[0] ? PD_GRAPH_STACK_CONFIGS[meta.vars[0].key] : null;
    if (stackConfig) {
      // seriesForVar() returns the FULL {labels, values} (not yet
      // ranged by rFrom/rTo -- that only happens via seriesFor() above),
      // so it needs slicing manually here too with the same rFrom/rTo
      // to stay consistent in length with rangedLabels.
      // Full (unranged) segment values, kept RAW/non-cumulative -- this
      // both feeds the below-chart navigator spark and lets
      // applyPerfRangeFilter() rebuild the cumulative running totals
      // for any window without needing the whole card re-rendered.
      const segmentsFull = pdComputeStackSegments((sourceDef) => seriesForVar(sourceDef).values, stackConfig.segments);
      const segments = {};
      stackConfig.segments.forEach((seg) => {
        segments[seg.id] = rFrom <= rTo ? segmentsFull[seg.id].slice(rFrom, rTo + 1) : [];
      });
      const datasets = pdBuildStackAreaDatasets(segments, rangedLabels.length, stackConfig.segments);
      datasets.forEach((ds) => { ds.hidden = pdIsSeriesHidden(perfKey, ds.label); });

      pdPerfFullSeries[id] = {
        labels,
        type: "stack",
        stackSegmentDefs: stackConfig.segments,
        series: stackConfig.segments.map((seg) => ({ label: seg.label + " (kWh)", values: segmentsFull[seg.id], negate: false })),
      };

      pdPerfChartInstances[id] = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: { labels: rangedLabels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 0 },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: {
              display: true, position: "bottom", labels: { boxWidth: 8, font: { size: 9.5, family: "Poppins" } },
              onClick: (e, legendItem, legend) => {
                const ci = legend.chart;
                if (ci.isDatasetVisible(legendItem.datasetIndex)) { ci.hide(legendItem.datasetIndex); legendItem.hidden = true; }
                else { ci.show(legendItem.datasetIndex); legendItem.hidden = false; }
                pdSetSeriesHidden(perfKey, legendItem.text, legendItem.hidden);
              },
            },
            tooltip: {
              backgroundColor: "#25343F",
              titleFont: { size: 11, family: "Poppins", weight: "600" },
              bodyFont: { size: 10.5, family: "Poppins" },
              padding: 8,
              cornerRadius: 8,
              callbacks: pdStackTooltipCallbacks(),
            },
          },
          scales: {
            x: { ticks: { font: { size: 9, family: "Poppins" }, maxTicksLimit: 5, autoSkip: true, maxRotation: 0, minRotation: 0 }, grid: { display: false } },
            y: { grid: { color: "#EEF3F3" }, border: { display: false }, ticks: { font: { size: 9, family: "Poppins" } }, beginAtZero: true },
          },
        },
      });

      renderPerfCardRangeSlider(id);
      return;
    }

    const { axisGroups, varKeyToAxis } = pdComputeAxisGroups(meta.vars, seriesFor);

    const chartType = meta.chartType === "bar" ? "bar" : "line";
    const cardMultiGroup = pdSelectionSpansMultipleGroups(meta.vars);
    // Auto-contrast colors, NOT the vars' stored .color -- see
    // pdAssignContrastColors() above. Fixes cards like "Daily Production"
    // plotted for both PLTS TAWABI GRUP 1 and GRUP 2, which used to share
    // one catalog color and blend together.
    const cardContrastColors = pdAssignContrastColors(meta.vars.length);
    const datasets = meta.vars.map((v, i) => {
      const color = cardContrastColors[i];
      return {
        label: v.label + (v.unit ? " (" + v.unit + ")" : "") + (cardMultiGroup ? " — " + pdGraphGroupName(v.groupId || meta.deviceGroupId) : ""),
        data: seriesFor(v),
        hidden: pdIsSeriesHidden(perfKey, v.label + (v.unit ? " (" + v.unit + ")" : "") + (cardMultiGroup ? " — " + pdGraphGroupName(v.groupId || meta.deviceGroupId) : "")),
        borderColor: color,
        backgroundColor: chartType === "bar" ? color + "cc" : pdHexToRgba(color, 0.15),
        fill: chartType === "line",
        spanGaps: true,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
        maxBarThickness: 26,
        yAxisID: varKeyToAxis[v.key],
      };
    });

    const scales = { x: { ticks: { font: { size: 9, family: "Poppins" }, maxTicksLimit: 5, autoSkip: true, maxRotation: 0, minRotation: 0 }, grid: { display: false } } };
    axisGroups.forEach((g, i) => {
      scales[g.key] = {
        type: "linear",
        position: i === 0 ? "left" : "right",
        grid: { drawOnChartArea: i === 0, color: "#EEF3F3" },
        border: { display: false },
        ticks: { font: { size: 9, family: "Poppins" } },
        offset: axisGroups.length > 1,
      };
    });

    pdPerfChartInstances[id] = new Chart(canvas.getContext("2d"), {
      type: chartType,
      data: { labels: rangedLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true, position: "bottom", labels: { boxWidth: 8, font: { size: 9.5, family: "Poppins" } },
            onClick: (e, legendItem, legend) => {
              const ci = legend.chart;
              if (ci.isDatasetVisible(legendItem.datasetIndex)) { ci.hide(legendItem.datasetIndex); legendItem.hidden = true; }
              else { ci.show(legendItem.datasetIndex); legendItem.hidden = false; }
              pdSetSeriesHidden(perfKey, legendItem.text, legendItem.hidden);
            },
          },
          tooltip: {
            backgroundColor: "#25343F",
            titleFont: { size: 11, family: "Poppins", weight: "600" },
            bodyFont: { size: 10.5, family: "Poppins" },
            padding: 8,
            cornerRadius: 8,
          },
        },
        scales,
      },
    });

    renderPerfCardRangeSlider(id);
  }

  function renderPerfCardChart(p, perfKey, meta) {
    const id = pdCurrentId + ":" + perfKey;
    const canvas = document.getElementById("pdPerfChart-" + id);
    if (!canvas || typeof Chart === "undefined") return;

    if (pdPerfChartInstances[id]) { pdPerfChartInstances[id].destroy(); delete pdPerfChartInstances[id]; }

    // 2+ variables selected (e.g. "Battery Voltage" + "State of Charge")
    // -> plot each as its own line instead of collapsing them into one
    // averaged line. See renderPerfCardChartMulti above. "Stack" cards
    // (chartType "stack") ALSO need renderPerfCardChartMulti even though
    // they only have 1 checked variable (Daily Consumption) -- the 3
    // PV/Battery/PLN datasets are derived there from other raw paths, not
    // from meta.vars. Without this chartType check, a saved Stack card
    // would silently fall through to the plain single-line/-area path
    // below and render as an unstyled single curve (no legend, no
    // PV/Battery/PLN split at all).
    if ((meta.vars && meta.vars.length > 1) || meta.chartType === "stack") {
      renderPerfCardChartMulti(p, perfKey, meta, id, canvas);
      return;
    }

    const period = pdPerfStateFor(id);
    let full;
    if (period.mode === "24h") {
      full = pdPerfHourlySeries(meta);
    } else if (period.mode === "7d") {
      // Titik 15 menit (history7d), sama seperti grafik System
      // Information -- BUKAN lagi 1 titik/hari (pdPerfDailySeries).
      full = pdPerfWeeklySeries(meta);
    } else if (period.mode === "30d") {
      // Titik 1 jam (history30d), sama seperti grafik System
      // Information -- BUKAN lagi 1 titik/hari (pdPerfDailySeries).
      full = pdPerfMonthlySeries(meta);
    } else {
      // `daily` di sini HANYA dipakai buat batas min/max input tanggal
      // (butuh label per-HARI) -- data yang benar-benar diplot ke chart
      // sekarang lewat pdPerfCustomSeries() di bawah (titik RAW dari
      // rentang tanggal persis yang dipilih user, lihat
      // pdEnsureGraphCustomData), BUKAN lagi slice dari `daily`
      // (1 titik/hari).
      const daily = pdPerfDailySeries(p, perfKey, meta);
      full = pdPerfCustomSeries(meta);

      if (period.mode === "custom") {
        const fromInput = document.querySelector(`[data-date-from="${id}"]`);
        const toInput = document.querySelector(`[data-date-to="${id}"]`);
        if (daily.labels.length) {
          if (fromInput) { fromInput.min = daily.labels[0]; fromInput.max = daily.labels[daily.labels.length - 1]; }
          if (toInput) { toInput.min = daily.labels[0]; toInput.max = daily.labels[daily.labels.length - 1]; }
        }
      }
    }

    pdPerfFullSeries[id] = { labels: full.labels, type: "single", series: [{ label: meta.title, values: full.values, negate: false }] };
    const total = full.labels.length;
    const periodSignature = period.mode + "|" + (period.dateFrom || "") + "|" + (period.dateTo || "");
    const prevState = pdPerfRangeState[id];
    if (!prevState || prevState.total !== total || prevState.periodSignature !== periodSignature) {
      pdPerfRangeState[id] = { from: 0, to: Math.max(0, total - 1), total, periodSignature };
    }
    const { from: rFrom, to: rTo } = pdPerfRangeState[id];
    const labels = rFrom <= rTo ? full.labels.slice(rFrom, rTo + 1) : [];
    const values = rFrom <= rTo ? full.values.slice(rFrom, rTo + 1) : [];
    const color = meta.color || PD_PERF_COLORS[perfKey] || "#0F6A71";
    const chartType = meta.chartType === "bar" ? "bar" : "line";

    pdPerfChartInstances[id] = new Chart(canvas.getContext("2d"), {
      type: chartType,
      data: {
        labels,
        datasets: [{
          label: meta.title,
          data: values,
          borderColor: color,
          backgroundColor: chartType === "bar" ? color + "cc" : pdHexToRgba(color, 0.15),
          fill: chartType === "line",
          spanGaps: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          maxBarThickness: 26,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#25343F",
            titleFont: { size: 11, family: "Poppins", weight: "600" },
            bodyFont: { size: 10.5, family: "Poppins" },
            padding: 8,
            cornerRadius: 8,
            callbacks: { label: (ctx) => `${formatPerformanceValue(ctx.parsed.y, meta.decimals)} ${meta.unit}` },
          },
        },
        scales: {
          x: { ticks: { font: { size: 9, family: "Poppins" }, maxTicksLimit: 5, autoSkip: true, maxRotation: 0, minRotation: 0 }, grid: { display: false } },
          y: { ticks: { font: { size: 9, family: "Poppins" } }, grid: { color: "#EEF3F3" }, border: { display: false } },
        },
      },
    });

    renderPerfCardRangeSlider(id);
  }

  function pdHexToRgba(hex, alpha) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const num = parseInt(h, 16);
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ---------- automated high-contrast trendline colors ----------
  // Each catalog variable carries a fixed `.color` (assigned once,
  // round-robin through PD_GRAPH_PALETTE, in pdBuildGraphView) so the "Add
  // graph" checklist swatches stay stable no matter what's plotted. But a
  // multi-line chart can end up drawing the SAME catalog variable twice
  // (e.g. "Daily Production" picked from both PLTS TAWABI GRUP 1 and GRUP
  // 2 -- they share one catalog entry, so one fixed .color) or several
  // variables whose catalog colors just happen to sit close together on
  // the wheel (e.g. two shades of teal/green) -- either way the lines
  // blend into each other. Rather than trust the stored .color for the
  // actual trendlines, every multi-line chart below recomputes colors from
  // THIS helper -- spread evenly around the hue wheel for however many
  // lines are actually on screen (max separation for that exact count),
  // alternating lightness/saturation on top so long lists (7-8+ variables,
  // where evenly-spaced hues start getting close again after wrapping)
  // still stay tellable apart. A single-variable chart keeps the original
  // brand teal so it looks exactly like before.
  function pdHslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  const PD_CONTRAST_BASE_HUE = 184; // ~matches the old #0F6A71 brand teal

  // Returns `n` hex colors, guaranteed maximally spread for that count --
  // call it once per render with the exact number of lines being drawn
  // (e.g. `pdAssignContrastColors(meta.vars.length)`) and index into the
  // result in the SAME order the lines/legend/stat-chips are built, so
  // everything referring to "line #i" stays visually consistent.
  function pdAssignContrastColors(n) {
    if (n <= 0) return [];
    if (n === 1) return [pdHslToHex(PD_CONTRAST_BASE_HUE, 58, 32)];
    const step = 360 / n;
    return Array.from({ length: n }, (_, i) => {
      const hue = PD_CONTRAST_BASE_HUE + i * step;
      const lightness = 32 + (i % 2) * 14; // alternate darker/lighter
      const saturation = 62 - (Math.floor(i / 2) % 2) * 16; // extra nudge apart on long lists
      return pdHslToHex(hue, saturation, lightness);
    });
  }

  // ---------- below-chart range slider ----------
  // Mini navigator sparkline + draggable two-handle selection track,
  // ported 1:1 from the Operator dashboard's card slider (see
  // drawCardRangeSpark / renderCardRangeSlider / wireCardRangeHandles
  // in js/operator/operator-dashboard.js), just generalized to a
  // single series (each Performance Analytics card only ever plots
  // one variable) instead of the operator's multi-variable cards.
  function pdDrawPerfRangeSpark(canvas, values) {
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 300;
    const h = 44;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    const pts = [];
    const n = (values || []).length;
    for (let i = 0; i < n; i++) {
      if (values[i] == null || !isFinite(values[i])) continue;
      pts.push({ i, v: values[i] });
    }
    if (!pts.length) return;

    const nums = pts.map((pt) => pt.v);
    const min = Math.min(...nums), max = Math.max(...nums), span = (max - min) || 1;
    const padY = 4;
    const xAt = (idx) => (n === 1 ? w / 2 : (idx / (n - 1)) * w);
    const yAt = (v) => h - padY - ((v - min) / span) * (h - padY * 2);

    ctx.beginPath();
    ctx.moveTo(xAt(pts[0].i), h);
    pts.forEach((pt) => ctx.lineTo(xAt(pt.i), yAt(pt.v)));
    ctx.lineTo(xAt(pts[pts.length - 1].i), h);
    ctx.closePath();
    ctx.fillStyle = "rgba(15, 106, 113, 0.16)";
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(15, 106, 113, 0.85)";
    ctx.lineWidth = 1.3;
    pts.forEach((pt, idx) => {
      const x = xAt(pt.i), y = yAt(pt.v);
      if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    pts.forEach((pt) => {
      const x = xAt(pt.i), y = yAt(pt.v);
      ctx.beginPath();
      ctx.arc(x, y, pts.length === 1 ? 3 : 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(15, 106, 113, 0.95)";
      ctx.fill();
    });
  }

  function renderPerfCardRangeSlider(id) {
    const full = pdPerfFullSeries[id];
    const state = pdPerfRangeState[id];
    const track = document.querySelector(`[data-range-track="${id}"]`);
    const sparkEl = document.querySelector(`[data-range-spark="${id}"]`);
    const fillEl = document.querySelector(`[data-range-fill="${id}"]`);
    const maskLeftEl = document.querySelector(`[data-range-mask-left="${id}"]`);
    const maskRightEl = document.querySelector(`[data-range-mask-right="${id}"]`);
    const captionEl = document.querySelector(`[data-range-caption="${id}"]`);
    const handles = document.querySelectorAll(`[data-range-handle][data-range-id="${id}"]`);
    if (!full || !state || !track) return;

    const total = full.labels.length;
    if (total < 2) {
      track.style.display = "none";
      if (captionEl) captionEl.textContent = "";
      return;
    }
    track.style.display = "";

    if (sparkEl && full.series[0]) pdDrawPerfRangeSpark(sparkEl, full.series[0].values.map((v) => (typeof v === "number" && isFinite(v) ? v : null)));

    const fromPct = (state.from / (total - 1)) * 100;
    const toPct = (state.to / (total - 1)) * 100;
    if (fillEl) { fillEl.style.left = fromPct + "%"; fillEl.style.width = Math.max(0, toPct - fromPct) + "%"; }
    if (maskLeftEl) maskLeftEl.style.width = fromPct + "%";
    if (maskRightEl) maskRightEl.style.width = (100 - toPct) + "%";
    handles.forEach((h) => { const which = h.getAttribute("data-range-handle"); h.style.left = (which === "from" ? fromPct : toPct) + "%"; });
    if (captionEl) {
      const showingAll = state.from === 0 && state.to === total - 1;
      captionEl.textContent = showingAll
        ? `${full.labels[0]} — ${full.labels[total - 1]} (${total} data)`
        : `${full.labels[state.from]} — ${full.labels[state.to]} (${state.to - state.from + 1} of ${total})`;
    }

    wirePerfRangeHandles(id, track);
  }

  function applyPerfRangeFilter(id) {
    const chart = pdPerfChartInstances[id];
    const full = pdPerfFullSeries[id];
    const state = pdPerfRangeState[id];
    if (!chart || !full || !state) return;
    const { from, to } = state;
    const inRange = from <= to;
    chart.data.labels = inRange ? full.labels.slice(from, to + 1) : [];

    if (full.type === "stack" && full.stackSegmentDefs) {
      // Stack datasets are CUMULATIVE running totals (see
      // pdBuildStackAreaDatasets), so they can't just be re-sliced like
      // a normal line -- rebuild the running totals from each segment's
      // raw (non-cumulative) full values for the new window first.
      const segments = {};
      full.series.forEach((s, i) => {
        segments[full.stackSegmentDefs[i].id] = inRange ? s.values.slice(from, to + 1) : [];
      });
      const rebuilt = pdBuildStackAreaDatasets(segments, chart.data.labels.length, full.stackSegmentDefs);
      rebuilt.forEach((ds, i) => {
        if (!chart.data.datasets[i]) return;
        chart.data.datasets[i].data = ds.data;
        chart.data.datasets[i].pdRawValues = ds.pdRawValues;
      });
    } else {
      // Re-slice EVERY dataset (not just the first) -- a saved card can
      // plot several variables/segments at once (Compare/multi-line "Add
      // Graph" cards), so dragging the range handles needs to move all
      // of them together instead of leaving dataset 1+ stuck on the old
      // window. "Compare" bottom line is stored positive and re-negated
      // here only for the chart's mirrored bar, so exported values (see
      // downloadPerfChartCsv) stay in the variable's real sign.
      full.series.forEach((s, i) => {
        if (!chart.data.datasets[i]) return;
        const sliced = inRange ? s.values.slice(from, to + 1) : [];
        chart.data.datasets[i].data = s.negate ? sliced.map((n) => (typeof n === "number" && isFinite(n) ? -n : n)) : sliced;
      });
    }
    chart.update("none");
  }

  // Download the card's current chart exactly as drawn (including
  // whatever period/range-slider window is active) as a PNG image.
  // Chart.js keeps a canvas underneath the whole time, so this is just
  // reading it back out -- no server round-trip needed.
  function downloadPerfChartPng(perfKey) {
    const id = pdCurrentId + ":" + perfKey;
    const chart = pdPerfChartInstances[id];
    if (!chart) return;
    const link = document.createElement("a");
    link.href = chart.toBase64Image("image/png", 1);
    link.download = `${perfKey}-${id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Export the data CURRENTLY inside the card's selected window (the
  // below-chart range slider, or the full period if it hasn't been
  // dragged) to CSV -- one column per VISIBLE line/segment, so a
  // trendline the user has clicked off in the legend is left out of the
  // export too, same as it's left out of the PNG. Reads straight off
  // the live Chart instance (chart.data), which applyPerfRangeFilter()
  // keeps in sync with the range slider for every dataset, not the
  // card's full unranged history.
  function downloadPerfChartCsv(perfKey) {
    const id = pdCurrentId + ":" + perfKey;
    const chart = pdPerfChartInstances[id];
    const full = pdPerfFullSeries[id];
    if (!chart || !full) return;

    const labels = chart.data.labels || [];
    const visibleCols = chart.data.datasets
      .map((ds, i) => ({ ds, i }))
      .filter(({ i }) => chart.isDatasetVisible(i));
    if (!labels.length || !visibleCols.length) return;

    const header = ["Date", ...visibleCols.map(({ ds }) => ds.label)];
    const rows = [header];
    labels.forEach((label, rowIdx) => {
      rows.push([label, ...visibleCols.map(({ ds, i }) => {
        // Compare charts store the "bottom" dataset negated for the
        // mirrored bar visual (see renderPerfCardChartMulti) -- undo
        // that here so the exported number matches the real reading,
        // not the bar's on-screen sign. Stack charts keep the raw
        // (non-cumulative) per-segment value in pdRawValues instead of
        // the cumulative running total used to draw the filled area.
        const series = full.series[i];
        if (full.type === "stack" && Array.isArray(ds.pdRawValues)) return ds.pdRawValues[rowIdx];
        const raw = ds.data[rowIdx];
        if (series && series.negate && typeof raw === "number" && isFinite(raw)) return -raw;
        return raw;
      })]);
    });

    const csvContent = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${perfKey}-${id}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  function wirePerfRangeHandles(id, track) {
    if (track.dataset.wired) return;
    track.dataset.wired = "1";

    function startDrag(e, kind) {
      const state = pdPerfRangeState[id];
      const full = pdPerfFullSeries[id];
      if (!state || !full) return;
      const total = full.labels.length;
      const rect = track.getBoundingClientRect();
      const startX = e.clientX;
      const startFrom = state.from, startTo = state.to;

      const onMove = (moveEvt) => {
        const st = pdPerfRangeState[id];
        if (!st || !rect.width) return;
        const dIndex = Math.round(((moveEvt.clientX - startX) / rect.width) * (total - 1));
        if (kind === "from") {
          let idx = startFrom + dIndex;
          if (idx < 0) idx = 0;
          if (idx > st.to - 1) idx = Math.max(0, st.to - 1);
          st.from = idx;
        } else if (kind === "to") {
          let idx = startTo + dIndex;
          if (idx > total - 1) idx = total - 1;
          if (idx < st.from + 1) idx = Math.min(total - 1, st.from + 1);
          st.to = idx;
        } else {
          const span = startTo - startFrom;
          let from = startFrom + dIndex, to = from + span;
          if (from < 0) { from = 0; to = span; }
          if (to > total - 1) { to = total - 1; from = Math.max(0, to - span); }
          st.from = from; st.to = to;
        }
        renderPerfCardRangeSlider(id);
        applyPerfRangeFilter(id);
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    }

    track.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const handleEl = e.target.closest && e.target.closest("[data-range-handle]");
      if (handleEl) { startDrag(e, handleEl.getAttribute("data-range-handle")); return; }
      const fillEl = e.target.closest && e.target.closest("[data-range-fill]");
      if (fillEl) { startDrag(e, "move"); return; }
      const state = pdPerfRangeState[id];
      const full = pdPerfFullSeries[id];
      if (!state || !full) return;
      const total = full.labels.length;
      const rect = track.getBoundingClientRect();
      if (!rect.width) return;
      const idx = Math.round(((e.clientX - rect.left) / rect.width) * (total - 1));
      const span = state.to - state.from;
      let from = idx - Math.round(span / 2), to = from + span;
      if (from < 0) { from = 0; to = span; }
      if (to > total - 1) { to = total - 1; from = Math.max(0, to - span); }
      state.from = from; state.to = to;
      renderPerfCardRangeSlider(id);
      applyPerfRangeFilter(id);
      startDrag(e, "move");
    });
  }

  function formatPerformanceValue(value, decimals) {
    return Number(value).toLocaleString(undefined,{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
  }

  // ===========================================================
  // RENDER: header / project summary
  // ===========================================================
  function renderHeader(p) {
    const s = p.summary;

    // Project name is represented by the project selector in the information card.
    // Do not target the old standalone title element; it is intentionally not in the current layout.
    //
    // PENTING: semua write di bawah ini DIJAGA null-check. Tanpa ini, kalau
    // salah satu elemen belum ada di DOM saat renderHeader() dipanggil (mis.
    // race pertama kali panel di-mount), throw di sini membatalkan SELURUH
    // initProjectDetail() (async function, exception sebelum await pertama
    // jadi Promise rejection senyap -- "Uncaught in promise") sehingga
    // await pdLoadRealTawabiProject() dan render KEDUA (yang nampilin data
    // Tawabi asli dari Core API) tidak pernah sempat jalan.
    const locEl = document.getElementById("pdProjectLocation");
    if (locEl) {
      locEl.textContent = pdCleanLocation(s.location);
      // Wrap behaviour (white-space/overflow/ellipsis) for the potentially
      // long Tawabi address now lives in css/project-detail.css
      // (#pdProjectLocation rule) instead of being set inline here --
      // an inline style has higher specificity than EVERY @media rule in
      // the stylesheet, so setting it via JS silently broke the mobile
      // breakpoints for the whole summary strip. Only keep the `title`
      // attribute here (a11y / hover tooltip, harmless either way).
      locEl.title = locEl.textContent;
    }
    // NOTE: .pd-summary-strip's column ratio (wider Location column vs.
    // Owner/Commission Date) is now defined directly in
    // css/project-detail.css so it can be overridden per breakpoint by
    // @media rules there. It used to be set here via
    // stripEl.style.gridTemplateColumns, but inline styles always beat
    // stylesheet rules regardless of media query -- that made the strip
    // ignore every responsive breakpoint below 1180px and squeeze all 5
    // columns into narrow mobile widths, causing the overlapping/cut-off
    // layout on phones.
    setTextIfExists("pdProjectCapacity", `${s.capacityKwp} kWp Terpasang`);
    setTextIfExists("pdProjectCommissioned", s.commissionDate);
    setTextIfExists("pdProjectOwner", s.owner);
    setTextIfExists("pdProjectPanelCount", `${s.panelCount} panel`);
    setTextIfExists("pdLiveUpdated", s.lastUpdate);

    const pill = document.getElementById("pdStatusPill");
    if (pill) {
      pill.classList.remove("is-offline", "is-warning");
      if (s.status === "offline") pill.classList.add("is-offline");
      if (s.status === "warning") pill.classList.add("is-warning");
      const pillLabel = pill.querySelector("span");
      if (pillLabel) {
        pillLabel.textContent =
          s.status === "online" ? "Online" :
          s.status === "warning" ? "Warning" : "Offline";
      }
    }
  }

  function setTextIfExists(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  // ===========================================================
  // RENDER: stat + gauge cards
  // ===========================================================
  function renderStats(p) {

    document.getElementById("pdPowerNow").textContent = p.power.now.toFixed(1);
    const trendEl = document.getElementById("pdPowerTrend");
    if (trendEl) {
      if (p.power.trendAvailable === false) {
        // Belum ada baseline buat ngitung tren beneran (lihat catatan di
        // pdLoadRealTawabiProject()) -- drpd nampilin "0%" yang statis/palsu,
        // badge-nya disembunyikan.
        trendEl.style.display = "none";
      } else {
        trendEl.style.display = "";
        trendEl.innerHTML = `<i class="fa-solid fa-arrow-trend-${p.power.trendDir}"></i> ${p.power.trendPct}%`;
        trendEl.className = "pd-trend " + (p.power.trendDir === "up" ? "pd-trend-up" : "pd-trend-down");
      }
    }

    document.getElementById("pdEnergyToday").textContent = p.todayEnergy.actual;
    const pct = Math.round((p.todayEnergy.actual / p.todayEnergy.expected) * 100);
    document.getElementById("pdEnergyTodayPct").textContent = `(${pct}% dari target)`;

    setGauge("pdHealthGauge", p.health.pct, healthColor(p.health.pct));
    document.getElementById("pdHealthPct").textContent = `${p.health.pct}%`;
    const healthStatusEl = document.getElementById("pdHealthStatus");
    const healthLabel = p.health.pct >= 90 ? "Healthy" : p.health.pct >= 70 ? "Warning" : "Critical";
    healthStatusEl.textContent = healthLabel;
    healthStatusEl.className = "pill " +
      (healthLabel === "Healthy" ? "pill-success" : healthLabel === "Warning" ? "pill-warning" : "pill-danger");

    setGauge("pdPerfGauge", p.performance.ratio, "var(--si-primary, #0f6a71)");
    document.getElementById("pdPerfPct").textContent = `${p.performance.ratio}%`;
    document.getElementById("pdEfficiency").textContent = `${p.performance.efficiency}%`;

  }

  function healthColor(pct) {
    if (pct >= 90) return "var(--si-success, #2F9E6E)";
    if (pct >= 70) return "var(--si-warning, #E3A21A)";
    return "var(--si-danger, #D64545)";
  }

  function setGauge(id, pct, color) {
    const el = document.getElementById(id);
    if (!el) return;
    const deg = Math.max(0, Math.min(100, pct)) * 3.6;
    el.style.background = `conic-gradient(${color} ${deg}deg, var(--si-page-bg, #F4F7F7) ${deg}deg)`;
  }

  // ===========================================================
  // RENDER: alerts
  // ===========================================================
  function renderAlerts(p) {
    const list = document.getElementById("pdAlertList");
    list.innerHTML = p.alerts.map((a) => {
      const icon = a.severity === "critical" ? "fa-circle-exclamation" :
                   a.severity === "warning" ? "fa-triangle-exclamation" : "fa-circle-info";
      return `
        <li class="pd-alert-item is-${a.severity}">
          <span class="pd-alert-icon"><i class="fa-solid ${icon}"></i></span>
          <div class="pd-alert-body">
            <div class="pd-alert-title">${a.title}</div>
            <div class="pd-alert-meta">${a.unit} · ${a.time}</div>
          </div>
        </li>`;
    }).join("");

    const counts = { critical: 0, warning: 0, info: 0 };
    p.alerts.forEach((a) => { if (counts[a.severity] !== undefined) counts[a.severity]++; });
    document.getElementById("pdAlertCritical").textContent = counts.critical;
    document.getElementById("pdAlertWarning").textContent = counts.warning;
    document.getElementById("pdAlertInfo").textContent = counts.info;
  }

  // ===========================================================
  // RENDER: notifications
  // ===========================================================


  // ===========================================================
  // RENDER: weather
  // ===========================================================
  function renderWeather(p) {
    const w = p.weather;
    document.getElementById("pdWeatherTemp").textContent = w.tempC;
    document.getElementById("pdWeatherDesc").textContent = w.condition;
    document.getElementById("pdWeatherHumidity").textContent = `${w.humidity}%`;
    document.getElementById("pdWeatherWind").textContent = `${w.windSpeed} km/j`;
    document.getElementById("pdWeatherIrradiance").textContent = `${w.irradiance} W/m²`;

    // Lokasi: pakai nama lokasi proyek (summary.location). Kalau ada
    // koordinat (_coords), tampilkan juga sebagai info tambahan supaya
    // jelas titik mana yang dipakai untuk fetch cuaca ke Open-Meteo.
    const locEl = document.getElementById("pdWeatherLocationText");
    if (locEl) {
      const locName = p.summary?.location || "—";
      const coords = p._coords ? ` (${p._coords.lat.toFixed(4)}, ${p._coords.lng.toFixed(4)})` : "";
      locEl.textContent = `${locName}${coords}`;
    }
  }

  // ===========================================================
  // RENDER: energy summary
  // ===========================================================
  function renderEnergySummary(p) {
    const e = p.energy;
    document.getElementById("pdSumToday").textContent = `${fmt(e.today)} kWh`;
    document.getElementById("pdSumWeek").textContent = `${fmt(e.week)} kWh`;
    document.getElementById("pdSumMonth").textContent = `${fmt(e.month)} kWh`;
    document.getElementById("pdSumTotal").textContent = `${fmt(e.total)} kWh`;
  }

  function fmt(n) {
    return n.toLocaleString("id-ID");
  }

  // ===========================================================
  // RENDER: battery summary
  // ===========================================================
  function renderBattery(p) {
    const b = p.battery;

    setGauge("pdBatteryGauge", b.soc, batteryColor(b.soc));
    document.getElementById("pdSocPct").textContent = `${b.soc}%`;

    const pill = document.getElementById("pdBatteryStatusPill");
    const isCharging = b.status === "charging";
    pill.textContent = isCharging ? "Charging" : "Idle";
    pill.className = "pill " + (isCharging ? "pill-info" : "pill-warning");
  }

  function batteryColor(pct) {
    if (pct >= 50) return "var(--si-success, #2F9E6E)";
    if (pct >= 20) return "var(--si-warning, #E3A21A)";
    return "var(--si-danger, #D64545)";
  }

  // ===========================================================
  // RENDER: inverter summary
  // ===========================================================
  function renderInverter(p) {
    const inv = p.inverter;
    document.getElementById("pdInverterOnline").textContent = `${inv.online} / ${inv.total}`;
    document.getElementById("pdInverterHealthy").textContent = inv.healthy;
    document.getElementById("pdInverterFault").textContent = inv.fault;
    document.getElementById("pdInverterCommLabel").textContent = inv.communication;

    const commPill = document.getElementById("pdInverterCommPill");
    const isNormal = inv.communication === "Normal";
    commPill.textContent = inv.communication;
    commPill.className = "pill " + (isNormal ? "pill-success" : "pill-warning");
  }

  // ===========================================================
  // RENDER: system / device health (compact list)
  // ===========================================================
  function renderDevices(p) {
    const grid = document.getElementById("pdDeviceGrid");
    if (!grid) return;

    grid.innerHTML = p.devices.map((d) => {
      const issueClass = d.status === "fault" ? "has-fault" : d.status === "warning" ? "has-issue" : "";
      const statusLabel = d.status === "fault" ? "Fault" : d.status === "warning" ? "Warning" : "Healthy";
      const pillClass = d.status === "fault" ? "pill-danger" : d.status === "warning" ? "pill-warning" : "pill-success";
      return `
      <div class="pd-device-compact-row ${issueClass}">
        <span class="pd-device-compact-name">
          <i class="fa-solid ${d.icon}"></i>
          <span>${d.name}</span>
        </span>
        <span class="pd-device-compact-count">${d.online}/${d.total}</span>
        <span class="pill ${pillClass}">${statusLabel}</span>
      </div>
    `;
    }).join("");

    const okCount = p.devices.filter((d) => d.status === "healthy").length;
    const scoreOk = document.getElementById("pdDeviceScoreOk");
    const scoreTotal = document.getElementById("pdDeviceScoreTotal");
    if (scoreOk) scoreOk.textContent = okCount;
    if (scoreTotal) scoreTotal.textContent = p.devices.length;
  }

  // ===========================================================
  // RENDER: Environmental Impact / Savings
  // ===========================================================
  function renderEnvironmental(p) {
    // total = accumulated actual production from Tawabi logger history.
    const totalKwh = (p.energy && Number.isFinite(Number(p.energy.total)))
      ? Number(p.energy.total)
      : 0;
    const energyMwh = totalKwh / 1000;

    // Prioritaskan angka CO2/pohon yang SUDAH dihitung backend
    // (analytics.lifetime.co2ReductionKg / treesEquivalent, dikirim
    // GET /projects/:id/analytics, ditangkap ke p._environmentalSource
    // di pdLoadRealTawabiProject()). Faktor konversi lokal (ENV_CO2_PER_KWH
    // dkk) cuma dipakai sebagai FALLBACK -- misalnya buat proyek user lain
    // yang belum punya sumber real -- supaya angka yang tampil konsisten
    // sama yang "resmi" dihitung backend, bukan hasil asumsi frontend
    // sendiri yang bisa beda faktor konversinya.
    const real = p._environmentalSource || {};
    const hasRealCo2 = Number.isFinite(Number(real.co2ReductionKgLifetime));
    const hasRealTrees = Number.isFinite(Number(real.treesEquivalentLifetime));

    const co2Ton = hasRealCo2
      ? Number(real.co2ReductionKgLifetime) / 1000
      : (totalKwh * ENV_CO2_PER_KWH) / 1000;
    const trees = hasRealTrees
      ? Math.round(Number(real.treesEquivalentLifetime))
      : Math.round(totalKwh * ENV_CO2_PER_KWH * ENV_TREES_PER_KG_CO2);

    // Bill Savings is now a direct calculation off the admin-configured
    // tariff (PLN category or manual Diesel Fuel Cost, see Settings on
    // the card) instead of a fixed "estimated" factor.
    const tariff = pdEnvActiveTariff(p.id || pdCurrentId);
    const moneySaved = Math.round(totalKwh * tariff.rate);

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    setText("pdEnvEnergy", energyMwh >= 100 ? Math.round(energyMwh).toLocaleString("id-ID") : energyMwh.toFixed(1));
    setText("pdEnvBillSavings", `Rp ${moneySaved.toLocaleString("id-ID")}`);
    setText("pdEnvBillSavingsSource", tariff.label);
    setText("pdEnvCo2", co2Ton.toFixed(1));
    setText("pdEnvTrees", trees.toLocaleString("id-ID"));
  }

  // ===========================================================
  // RENDER: Maintenance & Predictive summary
  // ===========================================================
  function renderMaintenance(p) {
    const m = p.maintenance;
    if (!m) return;

    const nextEl = document.getElementById("pdMaintNext");
    const lastEl = document.getElementById("pdMaintLast");
    if (nextEl && m.nextScheduled) {
      nextEl.textContent = `${m.nextScheduled.type} · ${m.nextScheduled.date} · ${m.nextScheduled.assignee}`;
    }
    if (lastEl && m.lastCompleted) {
      lastEl.textContent = `${m.lastCompleted.type} · ${m.lastCompleted.date} · ${m.lastCompleted.assignee}`;
    }

    const predictiveEl = document.getElementById("pdMaintPredictive");
    if (!predictiveEl) return;

    if (!m.predictive || m.predictive.length === 0) {
      predictiveEl.innerHTML = `<div class="pd-predictive-empty">Tidak ada risiko prediktif terdeteksi saat ini.</div>`;
      return;
    }

    predictiveEl.innerHTML = m.predictive.map((item) => {
      const level = item.risk >= 70 ? "high" : item.risk >= 40 ? "medium" : "low";
      const riskLabel = level === "high" ? "High Risk" : level === "medium" ? "Medium Risk" : "Low Risk";
      return `
        <div class="pd-predictive-item is-${level}">
          <div class="pd-predictive-item-top">
            <b>${item.component}</b>
            <span class="pd-predictive-risk is-${level}">${riskLabel} · ${item.risk}%</span>
          </div>
          <div class="pd-predictive-bar"><span style="width:${item.risk}%"></span></div>
          <div class="pd-predictive-note">${item.note}</div>
        </div>
      `;
    }).join("");
  }

  // ===========================================================
  // RENDER: recent activity
  // ===========================================================
  function renderActivity(p) {
    const list = document.getElementById("pdActivityList");
    list.innerHTML = p.activity.map((a) => `
      <li class="pd-activity-item">
        <span class="pd-activity-dot is-${a.type || "success"}"></span>
        <div>
          <div class="pd-activity-text">${a.text}</div>
          <div class="pd-activity-time">${a.time}</div>
        </div>
      </li>
    `).join("");
  }

  // ===========================================================
  // ACTIONS: view all alerts / go to battery / go to system info
  // ===========================================================
  function bindActions() {

    const viewAllBtn = document.getElementById("pdViewAllAlertsBtn");
    if (viewAllBtn) {
      viewAllBtn.onclick = () => {
        if (typeof loadPage === "function") {
          loadPage("pages/alert.html");
        }
      };
    }

    const goBatteryBtn = document.getElementById("pdGoBatteryBtn");
    if (goBatteryBtn) {
      goBatteryBtn.onclick = () => {
        const batteryTab = document.querySelector('#pmTabs .pm-tab[data-tab="battery"]');
        if (batteryTab) batteryTab.click();
      };
    }

    const goSystemBtn = document.getElementById("pdGoSystemBtn");
    if (goSystemBtn) {
      goSystemBtn.onclick = () => {
        const systemTab = document.querySelector('#pmTabs .pm-tab[data-tab="system"]');
        if (systemTab) systemTab.click();
      };
    }

    const refreshBtn = document.getElementById("pdRefreshBtn");
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        refreshBtn.classList.add("is-spinning");
        setTimeout(() => refreshBtn.classList.remove("is-spinning"), 650);
        const liveUpdatedEl = document.getElementById("pdLiveUpdated");
        if (liveUpdatedEl) liveUpdatedEl.textContent = "Baru saja";
        showToast("Data project diperbarui.");
      };
    }

    const openReportBtn = document.getElementById("pdOpenReportBtn");
    if (openReportBtn) {
      openReportBtn.onclick = () => openReportModal();
    }

  }

  // ===========================================================
  // CHART: Energy Production (Actual vs Expected)
  // ===========================================================
  function bindChartFilters(p) {

    const filters = document.getElementById("pdChartFilters");
    const customRange = document.getElementById("pdCustomRange");
    const fromInput = document.getElementById("pdCustomFrom");
    const toInput = document.getElementById("pdCustomTo");

    if (!filters) return;

    filters.querySelectorAll(".pd-filter-btn").forEach((btn) => {
      btn.onclick = () => {

        filters.querySelectorAll(".pd-filter-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");

        const range = btn.getAttribute("data-range");
        customRange.hidden = range !== "custom";

        if (range === "custom") {
          if (!fromInput.value || !toInput.value) return;
          renderChart(projects[pdCurrentId], "custom", fromInput.value, toInput.value);
        } else {
          renderChart(projects[pdCurrentId], range);
        }

      };
    });

    [fromInput, toInput].forEach((input) => {
      input.onchange = () => {
        if (fromInput.value && toInput.value) {
          renderChart(projects[pdCurrentId], "custom", fromInput.value, toInput.value);
        }
      };
    });

    // Reset filter UI back to the default "7 Days" range on project switch.
    filters.querySelectorAll(".pd-filter-btn").forEach((b) => b.classList.remove("is-active"));
    const defaultBtn = filters.querySelector('[data-range="7d"]');
    if (defaultBtn) defaultBtn.classList.add("is-active");
    if (customRange) customRange.hidden = true;

  }

  function renderChart(p, range, fromDate, toDate) {

    const canvas = document.getElementById("pdEnergyChart");
    if (!canvas || typeof Chart === "undefined") return;

    const { labels, actual, expected } = buildSeries(p, range, fromDate, toDate);

    const styles = getComputedStyle(document.documentElement);
    const primary = (styles.getPropertyValue("--si-primary") || "#0f6a71").trim();
    const accent = (styles.getPropertyValue("--si-accent") || "#FA891A").trim();
    const muted = (styles.getPropertyValue("--si-muted") || "#7C8B8D").trim();
    const border = (styles.getPropertyValue("--si-border") || "#E7EDEE").trim();

    if (pdChart) {
      pdChart.destroy();
    }

    pdChart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Actual",
            data: actual,
            borderColor: primary,
            backgroundColor: primary + "22",
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2.5
          },
          {
            label: "Expected",
            data: expected,
            borderColor: accent,
            borderDash: [5, 4],
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: muted, font: { size: 10.5 } } },
          y: { grid: { color: border }, ticks: { color: muted, font: { size: 10.5 } } }
        }
      }
    });

  }

  // FALLBACK ONLY — dipakai kalau proyek tidak punya
  // p._energyProduction (belum ada sumber data logger real, mis. proyek
  // yang baru ditambah user sendiri). Untuk PLTS Tawabi, buildSeries()
  // di atas sudah pakai buildRealSeries() dari data logger asli dan
  // TIDAK memanggil kode di bawah ini sama sekali.
  // Deterministic pseudo-random dummy series generator so the
  // chart looks stable/realistic across re-renders of the same range,
  // seeded per-project so every project has its own distinct chart.
  function seededRandom(seed) {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function projectSeedOffset(p) {
    // Derive a stable numeric offset from the project's peak power
    // so different projects don't render identical-looking curves.
    return Math.round((p.energy && p.energy.peakKw ? p.energy.peakKw : 10) * 97);
  }

  function buildSeries(p, range, fromDate, toDate) {

    // Proyek dengan data logger real (saat ini: PLTS Tawabi) -> pakai
    // server/data/tawabi-energy-production.json, BUKAN dummy generator.
    if (p._energyProduction) {
      return buildRealSeries(p._energyProduction, range, fromDate, toDate);
    }

    // Proyek lain (belum punya sumber data real, mis. proyek yang baru
    // ditambah user sendiri) -> tetap fallback ke dummy seed generator
    // supaya UI tidak kosong sama sekali.
    const offset = projectSeedOffset(p);
    const peak = (p.energy && p.energy.peakKw) ? p.energy.peakKw : 10;
    const dailyBase = (p.energy && p.energy.dailyBase) ? p.energy.dailyBase : 60;

    if (range === "today") {
      const labels = [];
      const actual = [];
      const expected = [];
      for (let h = 6; h <= 18; h++) {
        labels.push(`${h}:00`);
        const bell = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
        const exp = Math.round(bell * peak * 5);
        const act = Math.round(exp * (0.82 + seededRandom(h + offset) * 0.22));
        expected.push(exp);
        actual.push(Math.min(act, exp + 5));
      }
      return { labels, actual, expected };
    }

    if (range === "custom" && fromDate && toDate) {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      const days = Math.max(1, Math.min(90, Math.round((to - from) / 86400000) + 1));
      return buildDailySeries(days, from, offset, dailyBase);
    }

    const days = range === "30d" ? 30 : 7;
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    return buildDailySeries(days, start, offset, dailyBase);

  }

  // Bangun {labels, actual, expected} dari data logger REAL
  // (tawabi-energy-production.json) untuk range yang dipilih user.
  function buildRealSeries(ep, range, fromDate, toDate) {
    const locale = (typeof getSavedLanguage === "function" && getSavedLanguage() === "en") ? "en-US" : "id-ID";
    const dayLabel = (isoDate) => new Date(isoDate + "T00:00:00").toLocaleDateString(locale, { day: "2-digit", month: "short" });

    if (range === "today") {
      const t = ep.today;
      if (!t) return { labels: [], actual: [], expected: [] };
      // Tampilkan jam 06:00-18:00 (jam siang/produksi) sesuai contoh UI,
      // 24 nilai per-jam yang ada di file sudah dalam waktu lokal WIT.
      const startH = 6, endH = 18;
      const labels = [], actual = [], expected = [];
      for (let h = startH; h <= endH; h++) {
        labels.push(`${h}:00`);
        actual.push(t.actualKwh[h] ?? 0);
        expected.push(t.expectedKwh[h] ?? 0);
      }
      return { labels, actual, expected };
    }

    const daily = ep.daily || [];
    if (!daily.length) return { labels: [], actual: [], expected: [] };

    let rows;
    if (range === "custom" && fromDate && toDate) {
      rows = daily.filter((d) => d.date >= fromDate && d.date <= toDate);
    } else {
      const days = range === "30d" ? 30 : 7;
      rows = daily.slice(-days);
    }

    return {
      labels: rows.map((d) => dayLabel(d.date)),
      actual: rows.map((d) => d.actualKwh),
      expected: rows.map((d) => d.expectedKwh)
    };
  }

  function buildDailySeries(days, startDate, offset, dailyBase) {
    const labels = [];
    const actual = [];
    const expected = [];
    const locale = (typeof getSavedLanguage === "function" && getSavedLanguage() === "en") ? "en-US" : "id-ID";
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      labels.push(d.toLocaleDateString(locale, { day: "2-digit", month: "short" }));
      const seed = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate() + offset;
      const exp = Math.round(dailyBase * (0.9 + seededRandom(seed) * 0.24));
      const act = Math.round(exp * (0.78 + seededRandom(seed + 1) * 0.24));
      expected.push(exp);
      actual.push(act);
    }
    return { labels, actual, expected };
  }

  // ===========================================================
  // BILL SAVINGS SETTINGS MODAL (Environmental Impact card)
  // ===========================================================
  function bindEnvSettingsModalChrome() {
    const modal = document.getElementById("pdEnvSettingsModal");
    const closeBtn = document.getElementById("pdEnvSettingsCloseBtn");
    const cancelBtn = document.getElementById("pdEnvSettingsCancelBtn");
    const saveBtn = document.getElementById("pdEnvSettingsSaveBtn");
    const plnSelect = document.getElementById("pdEnvPlnSelect");
    const manualInput = document.getElementById("pdEnvManualInput");
    const sourceRadios = document.querySelectorAll('input[name="pdEnvSource"]');

    if (plnSelect && !plnSelect.options.length) {
      plnSelect.innerHTML = ENV_PLN_TARIFFS.map((t) =>
        `<option value="${t.id}">${t.label} — Rp ${t.rate.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kWh</option>`
      ).join("");
    }

    if (closeBtn) closeBtn.onclick = closeEnvSettingsModal;
    if (cancelBtn) cancelBtn.onclick = closeEnvSettingsModal;
    if (modal) modal.onclick = (e) => { if (e.target === modal) closeEnvSettingsModal(); };

    sourceRadios.forEach((radio) => {
      radio.onchange = () => {
        const plnField = document.getElementById("pdEnvPlnField");
        const manualField = document.getElementById("pdEnvManualField");
        if (radio.checked) {
          if (plnField) plnField.hidden = radio.value !== "pln";
          if (manualField) manualField.hidden = radio.value !== "manual";
        }
      };
    });

    // Plain text field with live "." thousand-separator formatting instead
    // of a native number spinner -- keeps typing/pasting a price feeling
    // like a currency box, no scroll-to-change-the-value behaviour.
    if (manualInput) {
      manualInput.oninput = () => {
        const digits = manualInput.value.replace(/\D/g, "");
        manualInput.value = digits ? pdFormatRupiahThousands(digits) : "";
      };
    }

    if (saveBtn) saveBtn.onclick = saveEnvSettings;

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && modal.classList.contains("is-open")) closeEnvSettingsModal();
    });

    const settingsBtn = document.getElementById("pdEnvSettingsBtn");
    if (settingsBtn) settingsBtn.onclick = openEnvSettingsModal;
  }

  function openEnvSettingsModal() {
    const modal = document.getElementById("pdEnvSettingsModal");
    if (!modal) return;

    const cfg = pdEnvTariffCfgFor(pdCurrentId);
    const plnRadio = document.getElementById("pdEnvSourcePln");
    const manualRadio = document.getElementById("pdEnvSourceManual");
    const plnSelect = document.getElementById("pdEnvPlnSelect");
    const manualInput = document.getElementById("pdEnvManualInput");
    const plnField = document.getElementById("pdEnvPlnField");
    const manualField = document.getElementById("pdEnvManualField");

    if (plnRadio) plnRadio.checked = cfg.source === "pln";
    if (manualRadio) manualRadio.checked = cfg.source === "manual";
    if (plnField) plnField.hidden = cfg.source !== "pln";
    if (manualField) manualField.hidden = cfg.source !== "manual";
    if (plnSelect) plnSelect.value = cfg.plnId;
    // Leave blank (showing the placeholder example) until the admin has
    // actually saved a value of their own -- avoids implying a real
    // number was already configured.
    if (manualInput) manualInput.value = cfg.manualRate != null ? pdFormatRupiahThousands(String(cfg.manualRate)) : "";

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeEnvSettingsModal() {
    const modal = document.getElementById("pdEnvSettingsModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  function saveEnvSettings() {
    const source = document.getElementById("pdEnvSourceManual").checked ? "manual" : "pln";
    const plnId = document.getElementById("pdEnvPlnSelect").value;
    const manualDigits = document.getElementById("pdEnvManualInput").value.replace(/\D/g, "");
    const manualRate = manualDigits ? Number(manualDigits) : null;

    pdPersistEnvTariffCfg(pdCurrentId, { source, plnId, manualRate });
    closeEnvSettingsModal();

    if (projects[pdCurrentId]) renderEnvironmental(projects[pdCurrentId]);
    showToast("Bill savings settings updated.");
  }

  // ===========================================================
  // PERFORMANCE REPORT MODAL
  // ===========================================================
  function bindReportModalChrome() {
    const modal = document.getElementById("pdReportModal");
    const closeBtn = document.getElementById("pdReportCloseBtn");

    if (closeBtn) closeBtn.onclick = closeReportModal;
    if (modal) {
      modal.onclick = (e) => { if (e.target === modal) closeReportModal(); };
    }

    const chips = document.getElementById("pdReportPeriodChips");
    if (chips) {
      chips.querySelectorAll("button").forEach((btn) => {
        btn.onclick = () => {
          chips.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          pdReportPeriod = btn.getAttribute("data-period");
          populateReport(projects[pdCurrentId], pdReportPeriod);
        };
      });
    }

    const csvBtn = document.getElementById("pdReportExportCsvBtn");
    if (csvBtn) csvBtn.onclick = exportReportCsv;

    const pdfBtn = document.getElementById("pdReportExportPdfBtn");
    if (pdfBtn) pdfBtn.onclick = exportReportPdf;

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && modal.classList.contains("is-open")) closeReportModal();
    });
  }

  function openReportModal() {
    const modal = document.getElementById("pdReportModal");
    if (!modal) return;

    pdReportPeriod = "7d";
    const chips = document.getElementById("pdReportPeriodChips");
    if (chips) {
      chips.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("is-active", b.getAttribute("data-period") === "7d");
      });
    }

    populateReport(projects[pdCurrentId], pdReportPeriod);
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeReportModal() {
    const modal = document.getElementById("pdReportModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  // Sums the same series used by the Energy Production chart (real data
  // logger series for Tawabi via buildRealSeries(), dummy fallback for
  // other projects) so the report's numbers line up with what's on
  // screen for that range.
  function computeReportTotals(p, period) {
    const factor = (p.todayEnergy && p.todayEnergy.actual)
      ? (p.todayEnergy.expected / p.todayEnergy.actual)
      : 1.08;

    if (period === "30d") {
      const s = buildSeries(p, "30d");
      return {
        actual: s.actual.reduce((a, b) => a + b, 0),
        expected: s.expected.reduce((a, b) => a + b, 0),
        rangeLabel: dateRangeLabel(30)
      };
    }

    if (period === "month") {
      const actual = p.energy.month;
      return {
        actual,
        expected: Math.round(actual * factor),
        rangeLabel: monthLabel()
      };
    }

    // default: 7 days
    const s = buildSeries(p, "7d");
    return {
      actual: s.actual.reduce((a, b) => a + b, 0),
      expected: s.expected.reduce((a, b) => a + b, 0),
      rangeLabel: dateRangeLabel(7)
    };
  }

  function dateRangeLabel(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    const opt = { day: "2-digit", month: "short", year: "numeric" };
    return `${start.toLocaleDateString("id-ID", opt)} – ${end.toLocaleDateString("id-ID", opt)}`;
  }

  function monthLabel() {
    return new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  }

  function populateReport(p, period) {
    const s = p.summary;
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    set("pdReportTitle", s.name);
    set("pdRepName", s.name);
    set("pdRepLocation", s.location);
    set("pdRepOwner", s.owner);
    set("pdRepCommissioned", s.commissionDate);
    set("pdRepCapacity", `${s.capacityKwp} kWp`);
    set("pdRepPanels", `${s.panelCount} panel`);

    const totals = computeReportTotals(p, period);
    set("pdReportRange", totals.rangeLabel);
    set("pdRepGenerated", `${fmt(totals.actual)} kWh`);
    set("pdRepExpected", `${fmt(totals.expected)} kWh`);
    set("pdRepPr", `${p.performance.ratio}%`);
    set("pdRepEfficiency", `${p.performance.efficiency}%`);

    const deltaPct = totals.expected
      ? Math.round(((totals.actual - totals.expected) / totals.expected) * 1000) / 10
      : 0;
    const trendDir = deltaPct >= 0 ? "up" : "down";
    const trendWord = deltaPct >= 0 ? "di atas" : "di bawah";
    const trendEl = document.getElementById("pdRepTrend");
    if (trendEl) {
      trendEl.innerHTML =
        `<i class="fa-solid fa-arrow-trend-${trendDir}"></i> Tren produksi: aktual <b>${Math.abs(deltaPct)}% ${trendWord}</b> target ekspektasi pada periode ini.`;
    }

    const healthLabel = p.health.pct >= 90 ? "Healthy" : p.health.pct >= 70 ? "Warning" : "Critical";
    set("pdRepHealth", `${p.health.pct}% (${healthLabel})`);
    set("pdRepPower", `${p.power.now.toFixed(1)} kW`);
    set("pdRepBattery", `${p.battery.soc}% SOC`);
    set("pdRepInverter", `${p.inverter.online} / ${p.inverter.total} Online`);

    const alertsList = document.getElementById("pdRepAlerts");
    if (alertsList) {
      if (!p.alerts || p.alerts.length === 0) {
        alertsList.innerHTML = `<li class="pd-report-alert-empty">Tidak ada anomali atau alert terdeteksi pada periode ini.</li>`;
      } else {
        alertsList.innerHTML = p.alerts.map((a) => `
          <li><span>${a.title} (${a.unit})</span><span>${a.severity.toUpperCase()} · ${a.time}</span></li>
        `).join("");
      }
    }
  }

  // ===========================================================
  // EXPORT PDF — built natively with jsPDF (vendor/jspdf), so it
  // downloads a real .pdf file straight away instead of routing
  // through the browser's print dialog (which some browsers don't
  // let you "Save as PDF" from directly, and which used to leave
  // the report looking like a raw screenshot of the dark UI).
  // Always reflects whichever period chip (7 Days / 30 Days / This
  // Month) is currently selected in the modal.
  // ===========================================================
  const PDF_COLOR = {
    primary: [15, 106, 113],      // --si-primary
    primaryDark: [11, 79, 84],    // --si-primary-dark
    ink: [37, 52, 63],            // --si-ink
    muted: [124, 139, 141],       // --si-muted
    border: [231, 237, 238],      // --si-border
    pageBg: [244, 247, 247],      // --si-page-bg
    success: [47, 158, 110],      // --si-success
    warning: [227, 162, 26],      // --si-warning
    danger: [214, 69, 69]         // --si-danger
  };

  function exportReportPdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showToast("Export PDF gagal dimuat. Coba muat ulang halaman.");
      return;
    }

    const p = projects[pdCurrentId];
    if (!p) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 16;
    const contentW = pageW - marginX * 2;
    let y = 0;

    const s = p.summary;
    const totals = computeReportTotals(p, pdReportPeriod);
    const rangeLabel = totals.rangeLabel;
    const periodTitle = pdReportPeriod === "30d" ? "30 Days"
      : pdReportPeriod === "month" ? "This Month"
      : "7 Days";

    const deltaPct = totals.expected
      ? Math.round(((totals.actual - totals.expected) / totals.expected) * 1000) / 10
      : 0;
    const trendWord = deltaPct >= 0 ? "di atas" : "di bawah";
    const healthLabel = p.health.pct >= 90 ? "Healthy" : p.health.pct >= 70 ? "Warning" : "Critical";

    // ---------- helpers ----------
    function setColor(c) { doc.setTextColor(c[0], c[1], c[2]); }
    function setFill(c) { doc.setFillColor(c[0], c[1], c[2]); }
    function setDraw(c) { doc.setDrawColor(c[0], c[1], c[2]); }

    function ensureSpace(need) {
      if (y + need > pageH - 22) {
        doc.addPage();
        y = 16;
      }
    }

    // Header bar for a section. Filled + bordered, and the value
    // table drawn right after it (see kvGrid) shares its left/right
    // edges so the whole thing reads as one bordered card instead of
    // a title floating loose above its content.
    function sectionTitle(title) {
      ensureSpace(12);
      setFill(PDF_COLOR.pageBg);
      setDraw(PDF_COLOR.border);
      doc.setLineWidth(0.3);
      doc.rect(marginX, y, contentW, 8, "FD");
      setColor(PDF_COLOR.primaryDark);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.text(title.toUpperCase(), marginX + 3, y + 5.6);
      y += 8; // no gap — the table below attaches directly under the bar
    }

    // Renders the label/value pairs as an actual bordered table (grid
    // lines between columns and rows), attached directly under the
    // section's header bar so header+table read as one card. Adds a
    // clear gap afterwards before the next section starts.
    //
    // Row height is computed per row from how many lines the longest
    // value in that row wraps to (e.g. a long "Owner" name), so long
    // text gets its own room instead of overlapping the row below.
    function kvGrid(items, cols) {
      const colW = contentW / cols;
      const valueLineH = 4.4; // ~line height at 11pt bold, in mm
      const rows = Math.ceil(items.length / cols);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      const rowHeights = [];
      for (let r = 0; r < rows; r++) {
        let maxLines = 1;
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx >= items.length) continue;
          const lines = doc.splitTextToSize(String(items[idx].value), colW - 6);
          maxLines = Math.max(maxLines, lines.length);
        }
        rowHeights.push(10.4 + (maxLines - 1) * valueLineH + 3);
      }
      const totalH = rowHeights.reduce((a, b) => a + b, 0);
      ensureSpace(totalH);

      setDraw(PDF_COLOR.border);
      doc.setLineWidth(0.3);
      doc.rect(marginX, y, contentW, totalH, "D");
      for (let c = 1; c < cols; c++) {
        const x = marginX + c * colW;
        doc.line(x, y, x, y + totalH);
      }
      let dividerY = y;
      for (let r = 0; r < rows - 1; r++) {
        dividerY += rowHeights[r];
        doc.line(marginX, dividerY, marginX + contentW, dividerY);
      }

      let rowY = y;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx >= items.length) break;
          const item = items[idx];
          const x = marginX + c * colW;
          setColor(PDF_COLOR.muted);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.3);
          doc.text(item.label, x + 3, rowY + 4.6, { maxWidth: colW - 6 });
          setColor(PDF_COLOR.ink);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text(String(item.value), x + 3, rowY + 10.4, { maxWidth: colW - 6 });
        }
        rowY += rowHeights[r];
      }

      y += totalH + 8;
    }

    // ---------- header band ----------
    setFill(PDF_COLOR.primaryDark);
    doc.rect(0, 0, pageW, 24, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text("360\u00B0eDash", marginX, 10.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.3);
    doc.setTextColor(210, 232, 233);
    doc.text("Performance Report", marginX, 16.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text(periodTitle, pageW - marginX, 10.5, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(210, 232, 233);
    doc.text(rangeLabel, pageW - marginX, 16.5, { align: "right" });

    y = 32;

    // ---------- project title ----------
    setColor(PDF_COLOR.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(s.name, marginX, y);
    y += 6.5;
    setColor(PDF_COLOR.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text(s.location, marginX, y);
    y += 8;

    setDraw(PDF_COLOR.border);
    doc.setLineWidth(0.25);
    doc.line(marginX, y, pageW - marginX, y);
    y += 8;

    // ---------- Project Information ----------
    sectionTitle("Project Information");
    kvGrid([
      { label: "Project Name", value: s.name },
      { label: "Location", value: s.location },
      { label: "Owner", value: s.owner },
      { label: "Commissioned", value: s.commissionDate },
      { label: "Installed Capacity", value: `${s.capacityKwp} kWp` },
      { label: "PV Panels", value: `${s.panelCount} panel` }
    ], 3);

    // ---------- Production Summary ----------
    sectionTitle("Production Summary");
    kvGrid([
      { label: "Energy Generated", value: `${fmt(totals.actual)} kWh` },
      { label: "Expected Production", value: `${fmt(totals.expected)} kWh` },
      { label: "Performance Ratio", value: `${p.performance.ratio}%` },
      { label: "Efficiency", value: `${p.performance.efficiency}%` }
    ], 4);

    // kvGrid() already left an 8mm gap after the table — pull the
    // note up right underneath it so it doesn't float in no-man's-land.
    y -= 4;
    ensureSpace(9);
    setFill(PDF_COLOR.pageBg);
    setDraw(PDF_COLOR.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(marginX, y, contentW, 9, 1.5, 1.5, "FD");
    setColor(PDF_COLOR.ink);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(
      `Tren produksi: aktual ${Math.abs(deltaPct)}% ${trendWord} target ekspektasi pada periode ini.`,
      marginX + 3, y + 5.8
    );
    y += 9 + 8;

    // ---------- PV Health & Key Metrics ----------
    sectionTitle("PV Health & Key Metrics");
    kvGrid([
      { label: "PV Health", value: `${p.health.pct}% (${healthLabel})` },
      { label: "Current Power", value: `${p.power.now.toFixed(1)} kW` },
      { label: "Battery SOC", value: `${p.battery.soc}% SOC` },
      { label: "Inverter Online", value: `${p.inverter.online} / ${p.inverter.total} Online` }
    ], 4);

    // ---------- Anomalies & Alerts Summary ----------
    sectionTitle("Anomalies & Alerts Summary");

    const alerts = p.alerts && p.alerts.length ? p.alerts : null;
    const colSeverityW = 26, colTimeW = 34;
    const colTitleW = contentW - colSeverityW - colTimeW;
    const rowH = 9;
    const alertsTotalH = rowH * (alerts ? alerts.length : 1);

    ensureSpace(alertsTotalH);
    const alertsTop = y;

    // Outer border + the two column dividers, drawn once up front so
    // the whole block reads as one table (matches the info grids above).
    setDraw(PDF_COLOR.border);
    doc.setLineWidth(0.3);
    doc.rect(marginX, y, contentW, alertsTotalH, "D");
    doc.line(marginX + colSeverityW, y, marginX + colSeverityW, y + alertsTotalH);
    doc.line(marginX + colSeverityW + colTitleW, y, marginX + colSeverityW + colTitleW, y + alertsTotalH);

    if (!alerts) {
      setColor(PDF_COLOR.muted);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text("Tidak ada anomali atau alert terdeteksi pada periode ini.", marginX + 3, y + 5.5, {
        maxWidth: contentW - 6
      });
      y += rowH;
    } else {
      alerts.forEach((a, i) => {
        if (i > 0) doc.line(marginX, y, marginX + contentW, y);
        if (i % 2 === 1) {
          setFill(PDF_COLOR.pageBg);
          doc.rect(marginX + 0.15, y + 0.15, contentW - 0.3, rowH - 0.3, "F");
          // re-draw the column dividers over the fill so they stay visible
          setDraw(PDF_COLOR.border);
          doc.line(marginX + colSeverityW, y, marginX + colSeverityW, y + rowH);
          doc.line(marginX + colSeverityW + colTitleW, y, marginX + colSeverityW + colTitleW, y + rowH);
        }

        const chipColor = a.severity === "warning" ? PDF_COLOR.warning
          : a.severity === "critical" || a.severity === "danger" ? PDF_COLOR.danger
          : PDF_COLOR.primary;
        setFill(chipColor);
        doc.roundedRect(marginX + 2, y + 1.8, 22, 5.4, 1.2, 1.2, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.6);
        doc.setTextColor(255, 255, 255);
        doc.text(a.severity.toUpperCase(), marginX + 13, y + 5.4, { align: "center" });

        setColor(PDF_COLOR.ink);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.6);
        doc.text(`${a.title} (${a.unit})`, marginX + colSeverityW + 2, y + 5.6, {
          maxWidth: colTitleW - 4
        });

        setColor(PDF_COLOR.muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(a.time, pageW - marginX - 2, y + 5.6, { align: "right" });

        y += rowH;
      });
    }
    y = alertsTop + alertsTotalH + 6;

    // ---------- footer on every page ----------
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      setDraw(PDF_COLOR.border);
      doc.setLineWidth(0.2);
      doc.line(marginX, pageH - 14, pageW - marginX, pageH - 14);
      setColor(PDF_COLOR.muted);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      const generatedAt = new Date().toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
      });
      doc.text(`Generated by 360eDash \u2022 ${generatedAt}`, marginX, pageH - 9);
      doc.text(`Page ${i} of ${pageCount}`, pageW - marginX, pageH - 9, { align: "right" });
    }

    const fileSafeId = String(pdCurrentId).replace(/[^a-z0-9-]+/gi, "-");
    doc.save(`performance-report-${fileSafeId}-${pdReportPeriod}.pdf`);

    if (typeof logActivity === "function") {
      logActivity({
        eventType: "project_report_export",
        user: sessionStorage.getItem("edash-user") || "Anonymous",
        userRole: sessionStorage.getItem("edash-role") || null,
        status: "success",
        detail: `Exported performance report for ${p.summary?.name || pdCurrentId} (${periodTitle}) to PDF`,
        data: {
          projectId: pdCurrentId,
          projectName: p.summary?.name || null,
          period: pdReportPeriod,
          periodLabel: periodTitle,
          totals,
          export: { type: "PDF", status: "success" },
        },
      });
    }

    showToast("Laporan performa berhasil diekspor ke PDF.");
  }

  function exportReportCsv() {
    const p = projects[pdCurrentId];
    const s = p.summary;
    const totals = computeReportTotals(p, pdReportPeriod);
    const rangeLabel = document.getElementById("pdReportRange")
      ? document.getElementById("pdReportRange").textContent
      : "";

    const rows = [
      ["Performance Report", s.name],
      ["Reporting Period", rangeLabel],
      [],
      ["Project Information"],
      ["Location", s.location],
      ["Owner", s.owner],
      ["Commissioned", s.commissionDate],
      ["Installed Capacity", `${s.capacityKwp} kWp`],
      ["PV Panels", `${s.panelCount} panel`],
      [],
      ["Production Summary"],
      ["Energy Generated (kWh)", totals.actual],
      ["Expected Production (kWh)", totals.expected],
      ["Performance Ratio (%)", p.performance.ratio],
      ["Efficiency (%)", p.performance.efficiency],
      [],
      ["PV Health & Key Metrics"],
      ["PV Health (%)", p.health.pct],
      ["Current Power (kW)", p.power.now],
      ["Battery SOC (%)", p.battery.soc],
      ["Inverter Online", `${p.inverter.online} / ${p.inverter.total}`],
      [],
      ["Anomalies & Alerts"],
      ["Severity", "Title", "Unit", "Time"]
    ];

    if (p.alerts && p.alerts.length > 0) {
      p.alerts.forEach((a) => rows.push([a.severity, a.title, a.unit, a.time]));
    } else {
      rows.push(["-", "Tidak ada anomali terdeteksi", "-", "-"]);
    }

    const csvContent = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `performance-report-${pdCurrentId}-${pdReportPeriod}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    if (typeof logActivity === "function") {
      logActivity({
        eventType: "project_report_export",
        user: sessionStorage.getItem("edash-user") || "Anonymous",
        userRole: sessionStorage.getItem("edash-role") || null,
        status: "success",
        detail: `Exported performance report for ${s.name || pdCurrentId} (${rangeLabel || pdReportPeriod}) to CSV`,
        data: {
          projectId: pdCurrentId,
          projectName: s.name || null,
          period: pdReportPeriod,
          periodLabel: rangeLabel || null,
          totals,
          export: { type: "CSV", status: "success" },
        },
      });
    }

    showToast("Laporan performa berhasil diekspor ke CSV.");
  }

  function csvEscape(value) {
    const str = value === undefined || value === null ? "" : String(value);
    if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  }

  // ===========================================================
  // TOAST (lightweight, reuses the shared .edash-toast styles)
  // ===========================================================
  let pdToastTimer = null;
  function showToast(msg) {
    let host = document.querySelector(".edash-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "edash-toast-host";
      document.body.appendChild(host);
    }
    let toast = document.getElementById("pdInlineToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "pdInlineToast";
      toast.className = "edash-toast edash-toast-success";
      toast.innerHTML = `<i class="fa-solid fa-circle-check"></i><span></span>`;
      host.appendChild(toast);
    }
    toast.querySelector("span").textContent = msg;
    toast.classList.add("is-visible");
    clearTimeout(pdToastTimer);
    pdToastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  // ===========================================================
  // "Create graph" modal — Performance Analytics
  // ---------------------------------------------------------------
  // Opened by #pdAddGraphBtn (next to the section title) or the
  // dashed "+" tile at the end of #pdPerformanceGrid (see
  // renderPerformanceAnalytics/wirePerformanceCards above). Same
  // idea and same real data source as the Operator dashboard's
  // "Create graph" modal (js/operator/operator-dashboard.js) — a
  // categorized variable checklist on the left, a live Chart.js
  // preview on the right — just scoped to this project (pdCurrentId)
  // and appending into #pdPerformanceGrid instead of the Operator's
  // #opdGrid-project.
  // ===========================================================
  const PD_GRAPH_PALETTE = ["#0F6A71", "#6DC3BB", "#2F9E6E", "#3E7CB1", "#E3A21A", "#D64545", "#0B4F54", "#7C8B8D"];
  const PD_GRAPH_CATEGORY_ORDER = [
    "ENERGY", "BATTERY PERFORMANCE", "BATTERY BMS", "BATTERY ENERGY",
    "BATTERY STATUS", "INVERTER", "PV STRING VOLTAGE", "PV STRING CURRENT",
    "PV STRING POWER", "AC OUTPUT", "GRID & LOAD",
  ];

  // Whitelist pasangan variabel yang boleh dipakai untuk graph type
  // "Compare" (atas-bawah/mirror, lihat gambar referensi "Energy
  // Production (Top) and Energy Consumption (Bottom)"). SENGAJA berupa
  // whitelist manual, BUKAN deteksi otomatis dari unit/kategori --
  // banyak pasangan variabel bersatuan sama (kWh) tapi gak masuk akal
  // dicerminkan (mis. Daily Production vs Cumulative Production). `top`/
  // `bottom` harus persis sama dengan `v.key` di catalog (lihat
  // pdBuildGraphView) -- meng-cover baik skema lama Tawabi (mis.
  // "Etdy_ge1"/"Etdy_use1", lihat js/operator/graph-builder-data.js)
  // maupun skema generik proyek berbasis Core API (mis.
  // "overview.energyToday"/"load.dailyConsumption", lihat
  // pdCurrentGraphCatalog/PD_GRAPH_VAR_DEFS di bawah). Tambah baris baru
  // di sini kalau ada pasangan produksi/konsumsi lain yang relevan --
  // JANGAN generalisasi ke semua variabel unit sama, lihat diskusi di
  // percakapan waktu fitur ini pertama kali diusulkan.
  const PD_GRAPH_COMPARE_PAIRS = [
    // Skema lama Tawabi (key pendek dari device logger, lihat
    // js/operator/graph-builder-data.js REAL_DATA.meta.vars) --
    // produksi/konsumsi & charging/discharging, versi harian & kumulatif.
    { top: "Etdy_ge1", bottom: "Etdy_use1", label: "Produksi vs Konsumsi Energi (Harian)" },
    { top: "Et_ge0", bottom: "Et_use1", label: "Produksi vs Konsumsi Energi (Kumulatif)" },
    { top: "Etdy_cg1", bottom: "Etdy_dcg1", label: "Charging vs Discharging Energi Baterai (Harian)" },
    { top: "t_cg_n1", bottom: "t_dcg_n1", label: "Charging vs Discharging Energi Baterai (Kumulatif)" },

    // Skema generik proyek berbasis Core API (path ke telemetry
    // ternormalisasi, lihat PD_GRAPH_VAR_DEFS di atas).
    { top: "overview.energyToday", bottom: "load.dailyConsumption", label: "Produksi vs Konsumsi Energi (Harian)" },
    { top: "grid.dailyFeedIn", bottom: "grid.dailyPurchased", label: "Energi Dijual vs Dibeli dari Grid (Harian)" },
    { top: "battery.dailyCharge", bottom: "battery.dailyDischarge", label: "Charging vs Discharging Energi Baterai (Harian)" },

    // TIDAK ditambah (sengaja dilewati, bukan lupa):
    // - BMS_C_V vs BMS_D_V / B_MAX_T vs B_MIN_T / DP1 vs DP2: dua-duanya
    //   sama-sama "gauge" sesaat dari jenis yang sama (bukan pasangan
    //   arah aliran energi yang berlawanan), jadi mode overlay Line/Bar
    //   yang udah ada lebih pas daripada dicerminkan atas-bawah.
    // - grid.gridPower vs load.loadPower: keduanya nilai daya sesaat (W)
    //   yang maknanya belum tentu berlawanan arah (grid power bisa net
    //   impor/ekspor tergantung device), jadi gak sepasti pasangan
    //   energi harian/kumulatif di atas -- kalau di lapangan ternyata ini
    //   memang selalu produksi-vs-pakai, tinggal tambah baris baru.
    // - Cumulative consumption/charge-discharge di skema generik
    //   (mis. "load.totalConsumption"): field-nya ada di
    //   PD_GRAPH_CUMULATIVE_PATHS tapi TIDAK terdaftar sebagai variabel
    //   yang bisa dicentang di PD_GRAPH_VAR_DEFS, jadi gak bisa dijadikan
    //   pasangan (gak akan pernah match pdFindComparePair()).
  ];

  // ---------------------------------------------------------------
  // "Stack" -- pecah SATU variabel jadi kurva tumpukan (stacked area)
  // 3 komponen turunan per hari. BEDA dari "Compare" di atas -- Compare
  // membandingkan 2 variabel MENTAH berdampingan/mirror, sedangkan Stack
  // ini MENURUNKAN (derive) 3 komponen dari variabel lain yang TIDAK
  // perlu dicentang user (overview.energyToday, grid.dailyFeedIn,
  // battery.dailyCharge, battery.dailyDischarge, grid.dailyPurchased --
  // semua sudah ada di PD_GRAPH_VAR_DEFS/catalog, cuma diambil manual
  // lewat pdGraphRealSeries(), bukan lewat pdGraphSelected).
  //
  // Dua variabel bisa jadi trigger Stack, masing-masing dengan pecahan
  // yang beda (lihat PD_GRAPH_STACK_CONFIGS di bawah):
  //  - "Daily Consumption" -> DARI MANA listrik yang dipakai berasal
  //    (PV langsung / Baterai / PLN-impor)
  //  - "Daily Production" (overview.energyToday) -> KE MANA listrik yang
  //    diproduksi PV itu pergi (langsung ke Load / nge-charge Baterai /
  //    diekspor ke PLN). "PLN" di sini artinya EKSPOR (grid.dailyFeedIn,
  //    dijual ke grid), BUKAN impor -- produksi PV gak mungkin datang
  //    "dari" PLN, jadi labelnya sengaja dibedain ("To PLN (Grid Export)")
  //    dari punya Consumption ("From PLN (Grid)") biar gak ambigu.
  //
  // Rumus (asumsi: load HANYA disuplai PV, baterai, atau PLN -- tidak
  // ada sumber energi lain; dan produksi PV HANYA dipakai load, nge-charge
  // baterai, atau diekspor -- tidak ada losses lain yang dihitung):
  //   Dari PV        = max(0, energyToday - dailyFeedIn - battery.dailyCharge)
  //   Dari Baterai   = max(0, battery.dailyDischarge)
  //   Dari PLN       = max(0, grid.dailyPurchased)
  //   Ke Load        = max(0, energyToday - dailyFeedIn - battery.dailyCharge)
  //                    (persis sama rumusnya dengan "Dari PV" di atas --
  //                    ini emang porsi produksi PV yang gak diekspor/
  //                    dicharge, jadi otomatis = porsi konsumsi yang
  //                    datang langsung dari PV)
  //   Ke Baterai     = max(0, battery.dailyCharge)
  //   Ke PLN (Ekspor)= max(0, grid.dailyFeedIn)
  // Totalnya SEHARUSNYA mendekati variabel trigger-nya (load.dailyConsumption
  // atau overview.energyToday), tapi bisa meleset dikit (rounding/losses
  // di device) -- ini cuma estimasi visual, bukan angka billing resmi.
  const PD_GRAPH_STACK_SOURCES = {
    pv: { key: "overview.energyToday" },
    feedIn: { key: "grid.dailyFeedIn" },
    charge: { key: "battery.dailyCharge" },
    discharge: { key: "battery.dailyDischarge" },
    purchased: { key: "grid.dailyPurchased" },
  };
  // Tiap segmen: {id, label, color, compute(raw)}. `raw` adalah nilai HARI
  // YANG SAMA dari PD_GRAPH_STACK_SOURCES di atas (pv/feedIn/charge/
  // discharge/purchased -- null kalau device gak punya data hari itu).
  // compute() kembalikan kontribusi segmen ini SENDIRI (non-kumulatif,
  // sudah di-clamp >= 0) buat hari itu, atau null kalau gak bisa dihitung.
  const PD_GRAPH_STACK_CONFIGS = {
    "load.dailyConsumption": {
      label: "Electricity Consumption: PV vs Battery vs PLN (Daily)",
      segments: [
        { id: "pv", label: "From PV", color: "#2F9E6E",
          compute: (r) => (r.pv !== null && r.feedIn !== null && r.charge !== null) ? Math.max(0, r.pv - r.feedIn - r.charge) : null },
        { id: "battery", label: "From Battery", color: "#3E7CB1",
          compute: (r) => r.discharge !== null ? Math.max(0, r.discharge) : null },
        { id: "pln", label: "From PLN (Grid)", color: "#D64545",
          compute: (r) => r.purchased !== null ? Math.max(0, r.purchased) : null },
      ],
    },
    "overview.energyToday": {
      label: "Electricity Production: To Load vs Battery vs PLN (Daily)",
      segments: [
        { id: "load", label: "To Load", color: "#2F9E6E",
          compute: (r) => (r.pv !== null && r.feedIn !== null && r.charge !== null) ? Math.max(0, r.pv - r.feedIn - r.charge) : null },
        { id: "battery", label: "To Battery", color: "#3E7CB1",
          compute: (r) => r.charge !== null ? Math.max(0, r.charge) : null },
        // "PLN" di sini = EKSPOR (feed-in), bukan impor -- produksi PV
        // gak pernah "berasal dari" PLN, jadi labelnya "To PLN (Grid
        // Export)" biar jelas beda arah dari punya Consumption.
        { id: "pln", label: "To PLN (Grid Export)", color: "#D64545",
          compute: (r) => r.feedIn !== null ? Math.max(0, r.feedIn) : null },
      ],
    },
  };

  // Persis 1 variabel dicentang DAN variabel itu salah satu trigger di
  // PD_GRAPH_STACK_CONFIGS -> kembalikan config-nya (dipakai buat
  // enable/disable tombol "Stack" + nge-trigger rendering stacked area-nya).
  // "Compare" and "Stack" both draw a derived relationship between
  // variables OF THE SAME DEVICE (e.g. that group's own production vs its
  // own consumption) -- mixing groups doesn't mean anything for either
  // mode, so both bail out (same as "no match") once the selection spans
  // more than one groupId. Cross-group selections still work fine in
  // plain Line/Bar mode.
  function pdSelectionSpansMultipleGroups(selectedVars) {
    if (!selectedVars || !selectedVars.length) return false;
    const groupIds = new Set(selectedVars.map((v) => v.groupId).filter(Boolean));
    return groupIds.size > 1;
  }

  function pdFindStackDef(selectedVars) {
    if (!selectedVars || selectedVars.length !== 1) return null;
    const config = PD_GRAPH_STACK_CONFIGS[selectedVars[0].key];
    return config ? { key: selectedVars[0].key, label: config.label, segments: config.segments, groupId: selectedVars[0].groupId } : null;
  }

  // Ambil 5 series komponen mentah (PV/feed-in/charge/discharge/
  // purchased) lalu turunkan jadi segmen-segmen tumpukan sesuai
  // `segmentDefs` (dari PD_GRAPH_STACK_CONFIGS[key].segments -- beda
  // trigger variable, beda pecahan/rumus, lihat komentar di atas).
  // `seriesFn(sourceDef)` adalah cara memanggil pdGraphRealSeries (atau
  // versi yang sudah di-slice per periode, lihat renderPerfCardChartMulti)
  // supaya fungsi ini bisa dipakai di preview modal MAUPUN kartu
  // tersimpan di grid tanpa duplikasi logika pengurangan/clamp-nya.
  function pdComputeStackSegments(seriesFn, segmentDefs) {
    const pv = seriesFn(PD_GRAPH_STACK_SOURCES.pv);
    const feedIn = seriesFn(PD_GRAPH_STACK_SOURCES.feedIn);
    const charge = seriesFn(PD_GRAPH_STACK_SOURCES.charge);
    const discharge = seriesFn(PD_GRAPH_STACK_SOURCES.discharge);
    const purchased = seriesFn(PD_GRAPH_STACK_SOURCES.purchased);
    const n = Math.max(pv.length, feedIn.length, charge.length, discharge.length, purchased.length);
    const num = (arr, i) => (typeof arr[i] === "number" && isFinite(arr[i]) ? arr[i] : null);
    const result = {};
    segmentDefs.forEach((seg) => { result[seg.id] = []; });
    for (let i = 0; i < n; i++) {
      const raw = { pv: num(pv, i), feedIn: num(feedIn, i), charge: num(charge, i), discharge: num(discharge, i), purchased: num(purchased, i) };
      segmentDefs.forEach((seg) => { result[seg.id].push(seg.compute(raw)); });
    }
    return result;
  }

  // Turunkan dataset AREA CHART yang benar-benar bertumpuk (cumulative)
  // dari segmen mentah pdComputeStackSegments() di atas, sesuai urutan
  // `segmentDefs` (bottom -> top). PENTING: Chart.js TIDAK auto-stack
  // nilai buat tipe "line" (beda dari "bar", yang auto-stack kalau
  // scale.stacked=true) -- kalau 3 dataset digambar apa adanya dengan
  // fill:true, ketiga area itu bakal numpuk MULAI DARI 0 dan saling
  // menimpa/blend warnanya (bug yang kelihatan di screenshot pertama:
  // PLN yang nilainya kecil jadi ketutup gradasi ungu blend PV+Baterai).
  // Jadi di sini nilainya di-akumulasi manual (segmen 1 -> segmen 1+2 ->
  // segmen 1+2+3), lalu tiap dataset (selain yang paling bawah) fill:
  // "-1" (isi ke dataset SEBELUMNYA, bukan ke origin/0) supaya yang
  // kelihatan cuma "lapisan"-nya, bukan area kumulatifnya. Nilai ASLI
  // (non-kumulatif) tiap segmen tetap disimpan di `pdRawValues` supaya
  // tooltip (pdStackTooltipCallbacks di bawah) bisa nampilin angka yang
  // benar, bukan angka kumulatifnya.
  function pdBuildStackAreaDatasets(segments, length, segmentDefs) {
    const running = new Array(length).fill(0);
    return segmentDefs.map((seg, idx) => {
      const cumulative = new Array(length);
      for (let i = 0; i < length; i++) {
        const v = segments[seg.id][i];
        running[i] += (typeof v === "number" && isFinite(v)) ? v : 0;
        cumulative[i] = running[i];
      }
      return {
        label: seg.label + " (kWh)",
        data: cumulative,
        borderColor: seg.color,
        backgroundColor: pdHexToRgba(seg.color, 0.28),
        fill: idx === 0 ? "origin" : "-1",
        spanGaps: true,
        tension: 0.35,
        pointRadius: 0,
        borderWidth: 2,
        // Non-cumulative value for THIS segment only, read by the
        // tooltip callback below (ctx.parsed.y on these datasets is the
        // cumulative/stacked value, needed for the fill to look right,
        // not the segment's own contribution).
        pdRawValues: segments[seg.id],
      };
    });
  }

  // Shared tooltip config for the Stack chart (preview + saved card):
  // "label" shows each segment's OWN value (from pdRawValues, not the
  // cumulative ctx.parsed.y), "footer" shows the grand total (the
  // topmost/last dataset's cumulative value = sum of all segments).
  function pdStackTooltipCallbacks() {
    return {
      label: (ctx) => {
        const raw = ctx.dataset.pdRawValues ? ctx.dataset.pdRawValues[ctx.dataIndex] : null;
        const val = typeof raw === "number" && isFinite(raw) ? raw : ctx.parsed.y;
        return `${ctx.dataset.label}: ${Math.abs(val).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
      },
      footer: (items) => {
        const total = items.reduce((max, it) => Math.max(max, typeof it.parsed.y === "number" ? it.parsed.y : 0), 0);
        return "Total: " + total.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " kWh";
      },
    };
  }

  // Cek apakah persis 2 variabel yang lagi dicentang (plottable) cocok
  // sama salah satu pasangan di atas -- kalau iya, kembalikan pair def +
  // referensi var mana yang jadi "top" (digambar naik dari 0) dan mana
  // yang jadi "bottom" (dinegasikan supaya turun ke bawah axis 0).
  // null kalau tidak ada 2 variabel atau pasangannya tidak dikenali.
  function pdFindComparePair(selectedVars) {
    if (!selectedVars || selectedVars.length !== 2) return null;
    if (pdSelectionSpansMultipleGroups(selectedVars)) return null;
    const keys = selectedVars.map((v) => v.key);
    const pair = PD_GRAPH_COMPARE_PAIRS.find((p) => keys.includes(p.top) && keys.includes(p.bottom));
    if (!pair) return null;
    return {
      pair,
      topVar: selectedVars.find((v) => v.key === pair.top),
      bottomVar: selectedVars.find((v) => v.key === pair.bottom),
    };
  }

  // { categories: [{name, vars:[{key,label,unit,category,id,color,plottable}]}], deviceGroups: [{id,name,sn}] }
  let pdGraphView = null;
  // Proyek yang sedang "dimiliki" oleh pdGraphView/pdGCurrentGroupId/
  // pdGPanelBuilt di bawah. pdGraphView dulu dibangun SEKALI lalu dipakai
  // terus-menerus (lihat pdBuildGraphView: `if (pdGraphView || ...) return`)
  // -- akibatnya begitu modal "Add Graph" pernah dibuka saat proyek Tawabi
  // aktif, daftar variabel & toggle "Grup 1/Grup 2" itu NEMPEL selamanya
  // walau user lalu pindah ke proyek lain. Sekarang openPdGraphModal()
  // membandingkan pdCurrentId dengan pdGraphViewProjectId setiap kali
  // dibuka, dan me-reset ketiganya kalau proyeknya berbeda dari terakhir
  // kali modal ini dibangun.
  let pdGraphViewProjectId = null;
  let pdGraphSelected = [];
  let pdGraphTitleTouched = false;
  let pdGraphPreviewChart = null;
  let pdGChartType = "line";
  let pdGCurrentGroupId = null;
  let pdGPanelBuilt = false;
  // perfKey of the custom card currently being EDITED (clicked its
  // title in the grid), or null when the modal is in normal "Add
  // graph" mode — see openPdGraphModal(editCard) / the pdGraphAddBtn
  // click handler in pdBindGraphModal below.
  let pdGraphEditingId = null;

  // Same catalog shape as the Operator dashboard's "Add Graph" modal
  // (js/operator/operator-dashboard.js): numeric vars (plottable) +
  // status/text vars (shown but disabled for charting), grouped by
  // category, plus the list of real logger devices (Tawabi Grup 1 /
  // Grup 2) so the same "Device:" switcher is available here too.
  function pdBuildGraphView() {
    const catalog = pdCurrentGraphCatalog();
    if ((pdGraphView && pdGraphViewProjectId === pdCurrentId) || !catalog) return pdGraphView;
    let cursor = 0;
    const nextColor = () => PD_GRAPH_PALETTE[(cursor++) % PD_GRAPH_PALETTE.length];
    const numericVars = (catalog.meta.vars || []).map((v) => ({ ...v, plottable: true }));
    const statusVars = (catalog.meta.status_vars || []).map((v) => ({ ...v, unit: "", plottable: false }));
    const allVars = [...numericVars, ...statusVars];
    const categories = PD_GRAPH_CATEGORY_ORDER
      .map((name) => ({ name, vars: allVars.filter((v) => v.category === name) }))
      .filter((cat) => cat.vars.length);
    let uid = 0;
    categories.forEach((cat) => cat.vars.forEach((v) => { v.id = "pdgv" + (uid++); v.color = nextColor(); }));
    const deviceGroups = Object.keys(catalog.groups || {}).map((gid) => ({
      id: gid,
      name: catalog.groups[gid].name,
      sn: catalog.groups[gid].sn,
    }));
    pdGraphView = { categories, deviceGroups };
    pdGraphViewProjectId = pdCurrentId;
    return pdGraphView;
  }

  function pdGraphVarPanelEl() { return document.getElementById("pdGraphVarPanel"); }

  // ---------- device / group switcher (Tawabi Grup 1 / Grup 2) ----------
  function renderPdGraphDeviceToggle() {
    const toggle = document.getElementById("pdGraphDeviceToggle");
    if (!toggle || !pdGraphView) return;
    toggle.innerHTML = "";
    pdGraphView.deviceGroups.forEach((g) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "opd-graph-seg-btn" + (g.id === pdGCurrentGroupId ? " is-active" : "");
      // Tampilkan system_name APA ADANYA dari Core API (GET /projects/:id
      // -> systems[].system_name), tanpa dipotong/diganti lagi -- supaya
      // toggle ini selalu sinkron persis dengan nama yang didaftarkan di
      // backend (dulu di-strip prefix "PLTS TAWABI " jadi cuma "GRUP 1"/
      // "GRUP 2", sekarang full apa adanya).
      btn.textContent = g.name;
      btn.addEventListener("click", () => {
        pdGCurrentGroupId = g.id;
        renderPdGraphDeviceToggle();
        // Checked state is now tracked PER GROUP (see toggleVar in
        // renderPdGraphVarPanel below), so switching "Device:" needs to
        // repaint the left checklist to whatever THIS group has checked --
        // instead of leaving the previous group's checkmarks on screen.
        syncPdGraphVarPanelChecks();
        updatePdGraphPreview();
      });
      toggle.appendChild(btn);
    });
  }

  // Re-syncs the left checklist's checkbox/highlight state to whichever
  // device group is now active. A variable's checked state lives per
  // (groupId, variable id) pair in pdGraphSelected, not just per variable
  // id -- so the same variable can be checked under Grup 1 and unchecked
  // under Grup 2 at the same time, letting the two groups' data be freely
  // mixed into one comparison chart instead of always following whichever
  // group is currently displayed.
  function syncPdGraphVarPanelChecks() {
    const panel = pdGraphVarPanelEl();
    if (!panel) return;
    panel.querySelectorAll(".opd-graph-var-row").forEach((row) => {
      const id = row.dataset.id;
      const isSel = pdGraphSelected.some((s) => s.groupId === pdGCurrentGroupId && s.id === id);
      row.classList.toggle("is-checked", isSel);
      const cb = row.querySelector("input[type=checkbox]");
      if (cb) cb.checked = isSel;
    });
  }

  // Looks up a device group's display name for the "— Grup X" legend/
  // caption suffix (see isMultiGroup usages above). Tries the "Add Graph"
  // modal's own view first (pdGraphView), then falls back to the raw
  // catalog -- a saved multi-group card can render on the dashboard grid
  // before the modal has ever been opened this session, when pdGraphView
  // doesn't exist yet but the catalog (fetched for the grid itself) does.
  function pdGraphGroupName(groupId) {
    if (!groupId) return "";
    const fromView = pdGraphView && pdGraphView.deviceGroups.find((gr) => gr.id === groupId);
    if (fromView) return fromView.name;
    const catalog = pdCurrentGraphCatalog();
    return (catalog && catalog.groups[groupId] && catalog.groups[groupId].name) || groupId;
  }

  function renderPdGraphVarPanel() {
    const panel = pdGraphVarPanelEl();
    if (!panel || !pdGraphView) return;
    panel.innerHTML = pdGraphView.categories.map((cat) => `
      <div class="opd-graph-var-category">
        <p class="opd-graph-cat-title">${esc(cat.name)}</p>
        ${cat.vars.map((v) => `
          <label class="opd-graph-var-row" data-id="${v.id}">
            <input type="checkbox" data-var-check="${v.id}">
            <span class="opd-graph-var-dot" style="background:${v.color}"></span>
            <span class="opd-graph-var-label">${esc(v.label)}</span>
            <span class="opd-graph-var-unit">${esc(v.unit || "")}</span>
          </label>
        `).join("")}
      </div>
    `).join("");

    panel.querySelectorAll("[data-var-check]").forEach((input) => {
      input.addEventListener("change", () => {
        const v = pdGraphView.categories.flatMap((c) => c.vars).find((vv) => vv.id === input.getAttribute("data-var-check"));
        if (!v) return;
        const row = input.closest(".opd-graph-var-row");
        // Tag the selection with the device group it was checked under
        // (pdGCurrentGroupId), NOT just the variable's own id -- so the
        // same variable can be selected independently per group (see
        // syncPdGraphVarPanelChecks above), and Grup 1's reading can be
        // plotted right alongside Grup 2's in one comparison chart.
        if (input.checked) {
          if (!pdGraphSelected.some((s) => s.groupId === pdGCurrentGroupId && s.id === v.id)) {
            pdGraphSelected.push(Object.assign({}, v, { groupId: pdGCurrentGroupId }));
          }
          if (row) row.classList.add("is-checked");
        } else {
          pdGraphSelected = pdGraphSelected.filter((s) => !(s.groupId === pdGCurrentGroupId && s.id === v.id));
          if (row) row.classList.remove("is-checked");
        }
        updatePdGraphTitle();
        updatePdGraphPreview();
        const addBtn = document.getElementById("pdGraphAddBtn");
        if (addBtn) addBtn.disabled = pdGraphSelected.filter((v2) => v2.unit).length === 0;
      });
    });
  }

  // Pure computation of the auto-generated title for a given selection
  // + chart type — shared by updatePdGraphTitle() (below) and
  // pdLoadCardIntoGraphModal() (so editing a card can tell whether its
  // saved title was ever hand-typed or is still just the auto-name).
  function computePdGraphAutoTitle(selectedVars, chartTypeVal) {
    if (!selectedVars.length) return "";
    const stackDef = chartTypeVal === "stack" ? pdFindStackDef(selectedVars.filter((v) => v.unit)) : null;
    if (stackDef) return stackDef.label;
    const names = selectedVars.map((s) => s.label);
    return names.length <= 2
      ? names.join(" vs ")
      : names.slice(0, 2).join(" vs ") + ` +${names.length - 2} more`;
  }

  // Same "A vs B" / "A vs B +N more" title behavior as the Operator
  // dashboard's modal, instead of always joining every label with " + ".
  function updatePdGraphTitle() {
    const input = document.getElementById("pdGraphTitleInput");
    if (!input || pdGraphTitleTouched) return;
    if (!pdGraphSelected.length) {
      input.value = "";
      input.placeholder = "Select a variable on the left…";
      return;
    }
    input.value = computePdGraphAutoTitle(pdGraphSelected, pdGChartType);
  }

  // ---------- graph-type toggle (Line / Bar) ----------
  function bindPdGraphTypeToggle() {
    const toggle = document.getElementById("pdGraphTypeToggle");
    if (!toggle || toggle.dataset.bound === "true") return;
    toggle.dataset.bound = "true";
    toggle.querySelectorAll(".opd-graph-seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        // "Compare" sengaja di-disable via atribut `disabled` (lihat
        // updatePdGraphCompareAvailability()) selama pasangan variabel yang
        // dicentang belum cocok whitelist PD_GRAPH_COMPARE_PAIRS -- browser
        // sebenarnya sudah gak fire event click ke tombol disabled, guard
        // ini cuma jaga-jaga.
        if (btn.disabled) return;
        toggle.querySelectorAll(".opd-graph-seg-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        pdGChartType = btn.dataset.type;
        updatePdGraphTitle();
        updatePdGraphPreview();
      });
    });
  }

  // Enable/disable tombol "Compare" tiap kali seleksi variabel berubah.
  // Kalau Compare lagi aktif dipilih tapi user meng-uncheck salah satu
  // variabel pasangannya (jadi pasangannya udah gak valid lagi), otomatis
  // fallback ke "Line" supaya preview gak nyangkut di mode yang gak
  // relevan lagi. Dipanggil dari updatePdGraphPreview() di awal, SEBELUM
  // early-return untuk state kosong/non-numeric, supaya tombolnya tetap
  // ke-update meski preview belum bisa digambar.
  function updatePdGraphCompareAvailability(plottable) {
    const compareBtn = document.getElementById("pdGraphCompareBtn");
    if (!compareBtn) return null;
    const comparePair = pdFindComparePair(plottable);
    // Bukan cuma di-disable -- tombolnya disembunyikan total (display:none
    // lewat class "is-hidden", lihat CSS .opd-graph-seg-btn.is-hidden) kalau
    // seleksi variabel saat ini belum cocok pasangan manapun, supaya "Line"/
    // "Bar" gak keganggu tombol abu-abu yang kelihatan gak relevan. `disabled`
    // tetap dipasang bareng sebagai jaga-jaga a11y/keyboard nav.
    compareBtn.classList.toggle("is-hidden", !comparePair);
    compareBtn.disabled = !comparePair;
    compareBtn.title = comparePair
      ? "Bandingkan " + comparePair.pair.label.toLowerCase()
      : "Hanya tersedia untuk pasangan variabel tertentu, mis. Produksi vs Konsumsi Energi";
    if (!comparePair && pdGChartType === "compare") {
      pdGChartType = "line";
      const toggle = document.getElementById("pdGraphTypeToggle");
      if (toggle) {
        toggle.querySelectorAll(".opd-graph-seg-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.type === "line"));
      }
    }
    return comparePair;
  }

  // Sama seperti updatePdGraphCompareAvailability() di atas, tapi buat
  // tombol "Stack" -- cuma nyala kalau persis 1 variabel dicentang dan
  // variabel itu salah satu trigger di PD_GRAPH_STACK_CONFIGS (Daily
  // Consumption ATAU Daily Production, lihat pdFindStackDef()).
  function updatePdGraphStackAvailability(plottable) {
    const stackBtn = document.getElementById("pdGraphStackBtn");
    if (!stackBtn) return null;
    const stackDef = pdFindStackDef(plottable);
    // Sama seperti Compare di atas -- disembunyikan total (bukan cuma
    // di-disable/abu-abu) selama variabel yang dicentang bukan salah
    // satu trigger Stack yang dikenal.
    stackBtn.classList.toggle("is-hidden", !stackDef);
    stackBtn.disabled = !stackDef;
    stackBtn.title = stackDef
      ? "Split into " + stackDef.segments.map((s) => s.label).join(" / ")
      : "Only available for Daily Consumption or Daily Production, split into their derived components";
    if (!stackDef && pdGChartType === "stack") {
      pdGChartType = "line";
      const toggle = document.getElementById("pdGraphTypeToggle");
      if (toggle) {
        toggle.querySelectorAll(".opd-graph-seg-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.type === "line"));
      }
    }
    return stackDef;
  }

  // Reads a variable's real daily series from the currently-selected
  // device group (defaults to the Operator dashboard's "grup1" / Tawabi
  // Grup 1 when no group is picked yet, e.g. for built-in cards).
  function pdGraphRealSeries(v, groupId) {
    // Prefer an explicitly-passed groupId (callers that already resolved
    // the right group), then the variable's OWN groupId (tagged when it
    // was checked -- see toggleVar in renderPdGraphVarPanel below), and
    // only fall back to whichever group is currently displayed. This is
    // what lets a saved/previewed chart mix variables checked under
    // different device groups instead of always following pdGCurrentGroupId.
    const gid = groupId || (v && v.groupId) || pdGCurrentGroupId || "grup1";
    const catalog = pdCurrentGraphCatalog();
    if (catalog) {
      const groupData = catalog.groups[gid] && catalog.groups[gid].data;
      if (groupData && groupData[v.key]) {
        return { labels: groupData.labels || [], values: groupData[v.key] };
      }
    }
    // Katalog belum siap / variabel belum ada datanya -> pdSyntheticDaily
    // sekarang mengembalikan garis datar 0 (lihat catatan fix di
    // definisinya), BUKAN kurva sinus buatan lagi -- konsisten dengan
    // flatZeroSeries di js/system-information.js.
    return pdSyntheticDaily(50, 8);
  }

  // Versi JAM-JAMAN (24 titik, hari ini) dari pdGraphRealSeries di atas --
  // dipakai mode "24 Hours" kartu custom "Add Graph". Kembalikan null
  // (bukan data sintetis) kalau belum ada di catalog, supaya pemanggil
  // bisa memutuskan sendiri fallback-nya (lihat pdPerfHourlySeriesForVar/
  // pdPerfHourlySeries) -- BUKAN nilai buatan yang bisa menyesatkan
  // (mis. turun ke minus untuk variabel yang secara fisik non-negatif).
  function pdGraphRealHourlySeries(v, groupId) {
    return pdGraphRealPeriodSeries(v, groupId, "hourly");
  }

  // Generalisasi dari pdGraphRealHourlySeries di atas -- periodKey bisa
  // "hourly" (mode "24 Hours"), "weekly" (mode "7 Days", titik 15 menit)
  // atau "monthly" (mode "30 Days", titik 1 jam), masing-masing dibangun
  // di pdBuildGraphCatalogFromUnits dari fetch history1d/history7d/
  // history30d terpisah. Sama seperti versi hourly, kembalikan null
  // (bukan data sintetis) kalau catalog/variabelnya belum ada, supaya
  // pemanggil bisa memutuskan sendiri fallback-nya.
  function pdGraphRealPeriodSeries(v, groupId, periodKey) {
    const gid = groupId || (v && v.groupId) || pdGCurrentGroupId || "grup1";
    const catalog = pdCurrentGraphCatalog();
    if (catalog) {
      const group = catalog.groups[gid];
      const period = group && group[periodKey];
      if (period && Array.isArray(period[v.key])) {
        return { labels: period.labels || [], values: period[v.key] };
      }
    }
    return null;
  }

  // ---------- stat chips (Now / Min / Max / Avg) ----------
  function renderPdGraphStats(plottable) {
    const statsRow = document.getElementById("pdGraphStatsRow");
    if (!statsRow) return;
    statsRow.innerHTML = "";
    const multiGroup = pdSelectionSpansMultipleGroups(plottable);
    // Same auto-contrast palette as the preview chart's datasets/legend
    // (both call pdAssignContrastColors with the same count, so "line #i"
    // always matches "stat chip #i") -- not the vars' stored .color.
    const statColors = pdAssignContrastColors(plottable.length);
    plottable.forEach((v, i) => {
      const color = statColors[i];
      const raw = pdGraphRealSeries(v).values.filter((n) => n !== null && n !== undefined && !Number.isNaN(n));
      if (!raw.length) return;
      const min = Math.min(...raw);
      const max = Math.max(...raw);
      const avg = raw.reduce((a, b) => a + b, 0) / raw.length;
      const now = raw[raw.length - 1];
      const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

      const chip = document.createElement("div");
      chip.className = "opd-graph-stat-chip";
      chip.style.borderColor = pdHexToRgba(color, 0.35);

      const dot = document.createElement("span");
      dot.className = "opd-graph-stat-dot";
      dot.style.background = color;
      chip.appendChild(dot);

      const label = document.createElement("span");
      label.className = "opd-graph-stat-label";
      label.textContent = v.label + (multiGroup ? " — " + pdGraphGroupName(v.groupId) : "");
      chip.appendChild(label);

      const nowEl = document.createElement("span");
      nowEl.className = "opd-graph-stat-now";
      nowEl.style.background = pdHexToRgba(color, 0.16);
      nowEl.style.color = color;
      nowEl.textContent = `${fmt(now)} ${v.unit} Now`;
      chip.appendChild(nowEl);

      const minmax = document.createElement("span");
      minmax.className = "opd-graph-stat-minmax";
      minmax.textContent = `Min ${fmt(min)} · Max ${fmt(max)} · Avg ${fmt(avg)}`;
      chip.appendChild(minmax);

      statsRow.appendChild(chip);
    });
  }

  function updatePdGraphPreview() {
    const emptyState = document.getElementById("pdGraphEmptyState");
    const canvas = document.getElementById("pdGraphPreviewCanvas");
    const legend = document.getElementById("pdGraphLegend");
    const caption = document.getElementById("pdGraphPreviewCaption");
    const addBtn = document.getElementById("pdGraphAddBtn");
    const statsRow = document.getElementById("pdGraphStatsRow");
    const typeField = document.getElementById("pdGraphTypeField");
    // "Graph type" label kelihatan beda gaya dari "Graph title" karena
    // container-nya cuma punya class "opd-graph-field-chart-type", TANPA
    // base class "opd-graph-field" (project-detail.html) -- akibatnya rule
    // CSS `.opd-graph-field label` (font-size/weight/color yang dipakai
    // Graph title) gak kena ke label ini. Tambahin base class-nya di sini
    // supaya keduanya konsisten.
    if (typeField) typeField.classList.add("opd-graph-field");
    if (!canvas) return;

    const plottable = pdGraphSelected.filter((v) => v.unit);
    const nonPlottable = pdGraphSelected.filter((v) => !v.unit);

    // Enable/disable tombol "Compare" berdasar seleksi SAAT INI -- panggil
    // di awal (sebelum early-return di bawah) supaya tombolnya tetap update
    // walau preview belum bisa digambar (mis. belum ada variabel dipilih).
    const comparePair = updatePdGraphCompareAvailability(plottable);
    const stackDef = updatePdGraphStackAvailability(plottable);

    if (pdGraphPreviewChart) { pdGraphPreviewChart.destroy(); pdGraphPreviewChart = null; }

    if (!pdGraphSelected.length) {
      if (emptyState) {
        emptyState.style.display = "";
        const strong = emptyState.querySelector("strong");
        const sub = emptyState.querySelector(".opd-graph-empty-sub");
        if (strong) strong.textContent = "No variable selected yet";
        if (sub) sub.textContent = "Check one or more variables on the left to preview the graph here. The data used is actual data from the PLTS TAWABI logger (daily average).";
      }
      canvas.style.display = "none";
      if (legend) legend.innerHTML = "";
      if (caption) caption.textContent = "";
      if (statsRow) statsRow.innerHTML = "";
      if (typeField) typeField.style.display = "none";
      if (addBtn) addBtn.disabled = true;
      return;
    }

    if (!plottable.length) {
      if (emptyState) {
        emptyState.style.display = "";
        const strong = emptyState.querySelector("strong");
        const sub = emptyState.querySelector(".opd-graph-empty-sub");
        if (strong) strong.textContent = "This variable isn't numeric";
        if (sub) sub.textContent = "Fields like " + nonPlottable.map((v) => v.label).join(", ") + " are status/text fields, so they can't be drawn as a line/bar graph.";
      }
      canvas.style.display = "none";
      if (legend) legend.innerHTML = "";
      if (caption) caption.textContent = "";
      if (statsRow) statsRow.innerHTML = "";
      if (typeField) typeField.style.display = "none";
      if (addBtn) addBtn.disabled = true;
      return;
    }

    if (emptyState) emptyState.style.display = "none";
    canvas.style.display = "";
    if (typeField) typeField.style.display = "flex";
    if (addBtn) addBtn.disabled = false;

    // x-axis labels come from the FIRST plottable variable's own group
    // (pdGraphRealSeries defaults to v.groupId) rather than whichever
    // group is currently displayed in the "Device:" toggle -- Stack/Compare
    // are guaranteed single-group by pdFindStackDef/pdFindComparePair, but
    // Line/Bar can now mix groups.
    const labels = pdGraphRealSeries(plottable[0]).labels;
    const isMultiGroup = pdSelectionSpansMultipleGroups(plottable);

    if (pdGChartType === "stack" && stackDef) {
      // ---- "Stack" (derived breakdown of Daily Consumption/Production,
      // segments come from stackDef.segments -- see PD_GRAPH_STACK_CONFIGS) ----
      // Different from Compare/Line/Bar above -- only ONE variable is
      // checked, but 3 DERIVED datasets get drawn (not from
      // pdGraphSelected), see pdComputeStackSegments()/PD_GRAPH_STACK_SOURCES.
      const segments = pdComputeStackSegments((sourceDef) => pdGraphRealSeries(sourceDef, stackDef.groupId).values, stackDef.segments);
      const datasets = pdBuildStackAreaDatasets(segments, labels.length, stackDef.segments);

      pdGraphPreviewChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#25343F",
              padding: 8,
              cornerRadius: 8,
              callbacks: pdStackTooltipCallbacks(),
            },
          },
          scales: {
            x: { ticks: { font: { size: 9, family: "Poppins" }, maxTicksLimit: 5, autoSkip: true, maxRotation: 0, minRotation: 0 }, grid: { display: false } },
            y: {
              title: { display: true, text: "kWh", font: { size: 10.5, family: "Poppins", weight: "500" }, color: "#7C8B8D" },
              grid: { color: "#EEF3F3" },
              border: { display: false },
              ticks: { font: { size: 9, family: "Poppins" } },
              beginAtZero: true,
            },
          },
        },
      });

      if (legend) {
        legend.innerHTML = stackDef.segments.map((seg) => `
          <div class="opd-graph-legend-item"><span class="opd-graph-legend-ring" style="border-color:${seg.color}"></span><span>${esc(seg.label)}</span></div>
        `).join("");
      }
      if (statsRow) {
        statsRow.innerHTML = "";
        const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
        stackDef.segments.forEach((seg) => {
          const raw = segments[seg.id].filter((n) => typeof n === "number" && isFinite(n));
          if (!raw.length) return;
          const now = raw[raw.length - 1];
          const avg = raw.reduce((a, b) => a + b, 0) / raw.length;
          const chip = document.createElement("div");
          chip.className = "opd-graph-stat-chip";
          chip.style.borderColor = pdHexToRgba(seg.color, 0.35);
          chip.innerHTML = `
            <span class="opd-graph-stat-dot" style="background:${seg.color}"></span>
            <span class="opd-graph-stat-label">${esc(seg.label)}</span>
            <span class="opd-graph-stat-now" style="background:${pdHexToRgba(seg.color, 0.16)};color:${seg.color}">${fmt(now)} kWh Now</span>
            <span class="opd-graph-stat-minmax">Avg ${fmt(avg)} kWh/day</span>
          `;
          statsRow.appendChild(chip);
        });
      }
      if (caption) {
        const activeGroup = pdGraphView.deviceGroups.find((g) => g.id === (stackDef.groupId || pdGCurrentGroupId));
        caption.textContent =
          `${labels.length ? labels[0] : ""} — ${labels.length ? labels[labels.length - 1] : ""} (${labels.length} data, daily) — estimated PV/Battery/PLN split, not an official billing figure` +
          (activeGroup ? ` from ${activeGroup.name}` : "");
      }
      return;
    }

    if (pdGChartType === "compare" && comparePair) {
      // ---- "Compare" (atas-bawah/mirror, bar) ----
      // Cuma jalan kalau persis 2 variabel dicentang DAN pasangannya ada
      // di whitelist PD_GRAPH_COMPARE_PAIRS (lihat pdFindComparePair()).
      // Teknik yang sama dipakai untuk kartu tersimpan, lihat
      // renderPerfCardChartMulti(): dataset "top" digambar apa adanya
      // (naik dari 0), dataset "bottom" DINEGASIKAN (v => -v) supaya
      // batangnya turun ke bawah axis 0 -- efek cermin seperti gambar
      // referensi "Energy Production (Top) / Energy Consumption
      // (Bottom)". Tooltip tetap nunjukin nilai asli (bukan yang
      // dinegasikan) lewat callback di bawah.
      //
      // Styling sengaja dibikin senada sama chart 1-variabel lainnya
      // (fill soft pakai pdHexToRgba, bukan warna solid pekat "cc") --
      // ditambah sudut bar dibulatkan (borderRadius) dan dikasih jarak
      // antar-bar (barPercentage/categoryPercentage) biar gak keliatan
      // "nempel"/kotak-kotak kayak versi awal.
      const topVar = comparePair.topVar;
      const bottomVar = comparePair.bottomVar;
      const topValues = pdGraphRealSeries(topVar).values;
      const bottomValues = pdGraphRealSeries(bottomVar).values;

      const datasets = [
        {
          label: topVar.label + (topVar.unit ? " (" + topVar.unit + ")" : ""),
          data: topValues,
          backgroundColor: pdHexToRgba(topVar.color, 0.55),
          borderColor: topVar.color,
          borderWidth: 1.5,
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 1,
          categoryPercentage: 1,
          grouped: false,
        },
        {
          label: bottomVar.label + (bottomVar.unit ? " (" + bottomVar.unit + ")" : ""),
          data: bottomValues.map((n) => (typeof n === "number" && isFinite(n) ? -n : n)),
          backgroundColor: pdHexToRgba(bottomVar.color, 0.55),
          borderColor: bottomVar.color,
          borderWidth: 1.5,
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 1,
          categoryPercentage: 1,
          grouped: false,
        },
      ];

      pdGraphPreviewChart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#25343F",
              padding: 8,
              cornerRadius: 8,
              callbacks: { label: (ctx) => `${ctx.dataset.label}: ${Math.abs(ctx.parsed.y).toLocaleString("en-US", { maximumFractionDigits: 2 })}` },
            },
          },
          scales: {
            x: { ticks: { font: { size: 9, family: "Poppins" }, maxTicksLimit: 5, autoSkip: true, maxRotation: 0, minRotation: 0 }, grid: { display: false } },
            y: {
              title: { display: true, text: topVar.unit || "", font: { size: 10.5, family: "Poppins", weight: "500" }, color: "#7C8B8D" },
              grid: {
                // garis nol sedikit lebih tegas dari garis grid lainnya,
                // biar batas "atas" vs "bawah"-nya kelihatan rapi/jelas
                // tanpa harus nambah elemen visual baru.
                color: (ctx) => (ctx.tick.value === 0 ? "#C9D6D7" : "#EEF3F3"),
                lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 1),
              },
              border: { display: false },
              ticks: { font: { size: 9, family: "Poppins" }, callback: (v) => Math.abs(v) },
            },
          },
        },
      });
    } else {
      // ---- Line / Bar (existing behavior) ----
      // Group plottable vars by unit AND rough magnitude — same
      // computeAxisGroups approach used by the Operator dashboard and by
      // this project's own saved multi-variable cards (see
      // renderPerfCardChartMulti) — so the preview matches what a saved
      // card will actually look like.
      const { axisGroups, varKeyToAxis } = pdComputeAxisGroups(plottable, (v) => pdGraphRealSeries(v).values);

      const scales = { x: { ticks: { font: { size: 9, family: "Poppins" }, maxTicksLimit: 5, autoSkip: true, maxRotation: 0, minRotation: 0 }, grid: { display: false } } };
      axisGroups.forEach((g, i) => {
        scales[g.key] = {
          type: "linear",
          position: i === 0 ? "left" : "right",
          title: { display: true, text: g.unit, font: { size: 10.5, family: "Poppins", weight: "500" }, color: "#7C8B8D" },
          grid: { drawOnChartArea: i === 0, color: "#EEF3F3" },
          border: { display: false },
          ticks: { font: { size: 9, family: "Poppins" } },
          offset: axisGroups.length > 1,
        };
      });

      // When the selection mixes groups (e.g. Grup 1's Battery Voltage +
      // Grup 2's Battery Voltage in one comparison chart), append the
      // group name to each dataset's label so the legend/tooltip can
      // still tell them apart -- with a single group it stays exactly as
      // before ("Battery Voltage (V)").
      // Auto-contrast colors, NOT the vars' stored .color -- see
      // pdAssignContrastColors() above. Keeps the preview matching what
      // the saved card will actually render, including cases like the
      // same catalog variable picked from two different device groups.
      const previewContrastColors = pdAssignContrastColors(plottable.length);
      const datasets = plottable.map((v, i) => {
        const color = previewContrastColors[i];
        return {
          label: v.label + (v.unit ? " (" + v.unit + ")" : "") + (isMultiGroup ? " — " + pdGraphGroupName(v.groupId) : ""),
          data: pdGraphRealSeries(v).values,
          borderColor: color,
          backgroundColor: pdGChartType === "bar" ? color + "cc" : pdHexToRgba(color, plottable.length === 1 ? 0.20 : 0.12),
          fill: pdGChartType === "line",
          spanGaps: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          maxBarThickness: 26,
          yAxisID: varKeyToAxis[v.key],
        };
      });

      pdGraphPreviewChart = new Chart(canvas.getContext("2d"), {
        type: pdGChartType,
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: { legend: { display: false }, tooltip: { backgroundColor: "#25343F", padding: 8, cornerRadius: 8 } },
          scales,
        },
      });
    }

    renderPdGraphStats(plottable);

    if (legend) {
      // Same auto-contrast palette as the datasets/stat-chips above (same
      // count in, same colors out) so the legend ring matches its line.
      const legendContrastColors = pdAssignContrastColors(plottable.length);
      legend.innerHTML = plottable.map((v, i) => `
        <div class="opd-graph-legend-item"><span class="opd-graph-legend-ring" style="border-color:${legendContrastColors[i]}"></span><span>${esc(v.label + (isMultiGroup ? " — " + pdGraphGroupName(v.groupId) : ""))}</span></div>
      `).join("");
    }
    if (caption) {
      const fromLabel = isMultiGroup
        ? "from " + Array.from(new Set(plottable.map((v) => pdGraphGroupName(v.groupId)))).join(", ")
        : (() => { const g = pdGraphView.deviceGroups.find((gr) => gr.id === ((plottable[0] && plottable[0].groupId) || pdGCurrentGroupId)); return g ? "from " + g.name : ""; })();
      caption.textContent =
        `${labels.length ? labels[0] : ""} — ${labels.length ? labels[labels.length - 1] : ""} (${labels.length} data, daily average) ${fromLabel}` +
        (nonPlottable.length ? ` — ${nonPlottable.length} non-numeric variable(s) excluded.` : "");
    }
  }

  // Modal chrome (title/button label) toggles between "Add graph" mode
  // and "Edit graph" mode depending on pdGraphEditingId — same idea as
  // the Operator dashboard's updateGraphModalChrome (js/operator/
  // operator-dashboard.js).
  function pdUpdateGraphModalChrome() {
    const titleEl = document.getElementById("pdGraphModalTitle");
    if (titleEl) titleEl.textContent = pdGraphEditingId ? "Edit graph" : "Create graph";
    const addBtn = document.getElementById("pdGraphAddBtn");
    if (addBtn) addBtn.textContent = pdGraphEditingId ? "Save changes" : "Add graph";
  }

  // Pre-fills the modal's selection/title/chart-type from an existing
  // custom card instead of the blank "Add graph" defaults — used when
  // the user clicks a card's title to edit it (see the
  // [data-edit-perf-card] wiring in wirePerformanceCards). Matches the
  // card's saved variables back to the freshly-built pdGraphView by
  // (key, groupId) rather than by its own v.id, since that id is
  // regenerated every time the view is rebuilt and isn't stable across
  // sessions/cards. Ported 1:1 from the Operator dashboard's
  // loadCardIntoGraphModal.
  function pdLoadCardIntoGraphModal(editCard) {
    const allViewVars = pdGraphView.categories.flatMap((c) => c.vars);
    const cardVars = (Array.isArray(editCard.vars) && editCard.vars.length) ? editCard.vars
      : (Array.isArray(editCard.varKeys) && editCard.varKeys.length) ? editCard.varKeys.map((k) => ({ key: k, unit: editCard.unit || "" }))
      : [];
    const fallbackGroupId = editCard.deviceGroupId || (pdGraphView.deviceGroups[0] && pdGraphView.deviceGroups[0].id) || null;

    pdGraphSelected = cardVars.map((cv) => {
      const gid = cv.groupId || fallbackGroupId;
      const match = allViewVars.find((v) => v.key === cv.key);
      return match ? Object.assign({}, match, { groupId: gid }) : Object.assign({}, cv, { groupId: gid, id: cv.key, plottable: !!cv.unit });
    });
    pdGCurrentGroupId = (pdGraphSelected[0] && pdGraphSelected[0].groupId) || fallbackGroupId;
    pdGChartType = editCard.chartType || "line";

    // Only lock the title (pdGraphTitleTouched = true, same flag set
    // when the user hand-types into the field) if the saved title is
    // NOT just what auto-generation would have produced for this exact
    // selection — i.e. it was actually customized. Otherwise leave it
    // untouched so it keeps following the selection while editing, same
    // as when adding a brand-new graph (this is what was missing
    // before: every saved title got treated as "touched", so ticking/
    // unticking a variable during an edit never updated the title on
    // the card afterwards).
    const autoTitle = computePdGraphAutoTitle(pdGraphSelected, pdGChartType);
    pdGraphTitleTouched = !!(editCard.title && editCard.title !== autoTitle);

    const titleInput = document.getElementById("pdGraphTitleInput");
    if (titleInput) titleInput.value = editCard.title || autoTitle;
    const typeToggle = document.getElementById("pdGraphTypeToggle");
    if (typeToggle) {
      typeToggle.querySelectorAll(".opd-graph-seg-btn").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.type === pdGChartType);
      });
    }
    syncPdGraphVarPanelChecks();
    const addBtn = document.getElementById("pdGraphAddBtn");
    if (addBtn) addBtn.disabled = pdGraphSelected.filter((v) => v.unit).length === 0;
  }

  function resetPdGraphModalState() {
    pdGraphSelected = [];
    pdGraphTitleTouched = false;
    pdGChartType = "line";
    const titleInput = document.getElementById("pdGraphTitleInput");
    if (titleInput) titleInput.value = "";
    const panel = pdGraphVarPanelEl();
    if (panel) {
      panel.querySelectorAll("input[type=checkbox]").forEach((i) => { i.checked = false; });
      panel.querySelectorAll(".opd-graph-var-row").forEach((row) => row.classList.remove("is-checked"));
    }
    const typeToggle = document.getElementById("pdGraphTypeToggle");
    if (typeToggle) typeToggle.querySelectorAll(".opd-graph-seg-btn").forEach((b, i) => b.classList.toggle("is-active", i === 0));
    updatePdGraphPreview();
  }

  // Marks the title as hand-typed the moment the user touches the field
  // — bound ONCE here (not inside resetPdGraphModalState, which only
  // ever ran for the "Add graph" flow) so it's active the very first
  // time the modal opens, including when that first open is an
  // Edit-graph click rather than "+ Add Graph". Same one-time binding
  // as the Operator dashboard's graphTitleInput.addEventListener
  // (js/operator/operator-dashboard.js).
  (function bindPdGraphTitleInput() {
    const titleInput = document.getElementById("pdGraphTitleInput");
    if (titleInput) titleInput.addEventListener("input", () => { pdGraphTitleTouched = true; });
  })();

  // Toggle antara skeleton / konten asli / pesan error di dalam modal
  // "Create graph". Dipanggil oleh openPdGraphModal() supaya modal bisa
  // langsung dibuka (tanpa nunggu fetch selesai) dan user langsung tahu
  // sesuatu sedang dimuat, bukan cuma diem sampai toast muncul.
  function setPdGraphModalPhase(phase) {
    const loadingEl = document.getElementById("pdGraphLoading");
    const errorEl = document.getElementById("pdGraphError");
    const bodyEl = document.getElementById("pdGraphBody");
    const deviceSwitchEl = document.getElementById("pdGraphDeviceSwitch");
    const subtitleEl = document.getElementById("pdGraphSubtitle");
    const addBtn = document.getElementById("pdGraphAddBtn");

    if (loadingEl) loadingEl.classList.toggle("is-visible", phase === "loading");
    if (loadingEl) loadingEl.setAttribute("aria-hidden", phase === "loading" ? "false" : "true");
    if (errorEl) errorEl.classList.toggle("is-visible", phase === "error");
    if (errorEl) errorEl.setAttribute("aria-hidden", phase === "error" ? "false" : "true");
    if (bodyEl) bodyEl.style.display = phase === "ready" ? "" : "none";
    if (deviceSwitchEl) deviceSwitchEl.style.display = phase === "ready" ? "" : "none";
    if (subtitleEl) subtitleEl.style.display = phase === "loading" || phase === "error" ? "none" : "";
    if (addBtn) addBtn.disabled = phase !== "ready" || !pdGraphSelected.length;
  }

  function openPdGraphModal(editCard) {
    const modal = document.getElementById("pdGraphModal");
    if (!modal) return;

    pdGraphEditingId = editCard ? editCard.id : null;
    pdUpdateGraphModalChrome();

    // Modal dibuka LANGSUNG saat tombol "+ Add Graph" diklik, tanpa nunggu
    // fetch selesai -- dulu modal baru muncul setelah data siap (jadi
    // sempat kelihatan "diem" sebelum toast + popup nongol). Sekarang
    // popup nongol duluan dengan skeleton, baru diisi konten aslinya
    // begitu data datang.
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");

    // Proyek aktif berubah sejak modal ini terakhir dibangun (mis. user
    // sempat ganti chip proyek) -- reset panel/toggle/grup supaya modal
    // membangun ulang dari katalog proyek yang SEKARANG aktif, bukan
    // menyisakan daftar variabel/Grup 1/Grup 2 milik proyek sebelumnya.
    if (pdGraphViewProjectId !== pdCurrentId) {
      pdGraphView = null;
      pdGCurrentGroupId = null;
      pdGPanelBuilt = false;
    }

    // Fetch (GET /devices/:id/telemetry/history, 90 hari, tiap unit dari
    // PROYEK YANG SEDANG AKTIF) BENERAN baru mulai di sini (bukan lagi
    // di-preload dari selectProject() -- lihat catatan disclaimer §5
    // poin 1&2 di dekat awal selectProject() dan pdEnsureHourlyCatalog()
    // di atas: yang jalan otomatis begitu proyek dibuka cuma versi
    // "lite", history1d doang, BUKAN katalog penuh ini). Kalau user
    // sempat klik tab 7D/30D/Custom di kartu Performance Analytics
    // SEBELUM buka modal ini, pdEnsureGraphCatalog() di sini cukup
    // "menumpang" promise yang sama (di-cache per proyek via
    // pdGraphCatalogPromiseByProject) sehingga modal langsung "ready"
    // tanpa skeleton; kalau belum ada yang pernah memicunya, modal
    // ini sendiri yang jadi trigger on-demand pertama.
    const wasCached = !!pdCurrentGraphCatalog();
    setPdGraphModalPhase(wasCached ? "ready" : "loading");

    pdEnsureGraphCatalog(pdCurrentId).then(() => {
      pdBuildGraphView();
      if (!pdGCurrentGroupId && pdGraphView.deviceGroups.length) pdGCurrentGroupId = pdGraphView.deviceGroups[0].id;
      if (!pdGPanelBuilt) {
        renderPdGraphVarPanel();
        pdGPanelBuilt = true;
      }
      bindPdGraphTypeToggle();
      if (editCard) {
        pdLoadCardIntoGraphModal(editCard);
      } else {
        resetPdGraphModalState();
      }
      renderPdGraphDeviceToggle();
      setPdGraphModalPhase("ready");

      // Baru sekarang (bukan otomatis saat render halaman) upgrade
      // kartu 7D/30D/Custom yang sedang tampil ke data real, kalau ini
      // pertama kali catalog PROYEK INI berhasil di-fetch.
      if (!wasCached) {
        const p = projects[pdCurrentId];
        if (p) pdRefreshPerfCardsFromGraphCatalog(p);
      }
    }).catch((e) => {
      const msgEl = document.getElementById("pdGraphErrorMsg");
      if (msgEl) msgEl.textContent = e && e.message ? e.message : "Periksa koneksi Anda lalu coba lagi.";
      setPdGraphModalPhase("error");
      showToast("Gagal memuat daftar variabel grafik. Coba lagi.");
    });
  }

  function closePdGraphModal() {
    const modal = document.getElementById("pdGraphModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    pdGraphEditingId = null;
    pdUpdateGraphModalChrome();
  }

  function pdBindGraphModal() {
    const addGraphBtn = document.getElementById("pdAddGraphBtn");
    const closeBtn = document.getElementById("pdGraphCloseBtn");
    const cancelBtn = document.getElementById("pdGraphCancelBtn");
    const addBtn = document.getElementById("pdGraphAddBtn");
    const modal = document.getElementById("pdGraphModal");
    if (!modal || modal.dataset.bound === "true") return;
    modal.dataset.bound = "true";

    const retryBtn = document.getElementById("pdGraphRetryBtn");

    if (addGraphBtn) addGraphBtn.onclick = () => openPdGraphModal();
    if (closeBtn) closeBtn.addEventListener("click", closePdGraphModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closePdGraphModal);
    // "Coba lagi" di error state: modal sudah kebuka, jadi cukup panggil
    // openPdGraphModal() lagi -- entry proyek ini di pdGraphCatalogPromiseByProject
    // sudah dihapus (oleh pdEnsureGraphCatalog() saat gagal), jadi ini akan fetch ulang.
    if (retryBtn) retryBtn.addEventListener("click", () => openPdGraphModal());
    modal.addEventListener("click", (e) => { if (e.target === modal) closePdGraphModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("is-open")) closePdGraphModal(); });

    if (addBtn) {
      addBtn.addEventListener("click", () => {
        const plottable = pdGraphSelected.filter((v) => v.unit);
        if (!plottable.length) return;
        const titleInput = document.getElementById("pdGraphTitleInput");
        const stackDefForSave = pdGChartType === "stack" ? pdFindStackDef(plottable) : null;
        const title = (titleInput && titleInput.value.trim())
          || (stackDefForSave ? stackDefForSave.label : plottable.map((v) => v.label).join(" vs "));
        const primary = plottable[0];
        const cfg = pdPerfCfgFor(pdCurrentId);
        const comparePair = pdGChartType === "compare" ? (() => {
          const cp = pdFindComparePair(plottable);
          return cp ? { top: cp.pair.top, bottom: cp.pair.bottom } : null;
        })() : null;

        // Fields shared between "Add graph" and "Edit graph" — id is
        // deliberately left out here since the two branches below treat
        // it differently (kept as-is when editing, freshly generated
        // when adding).
        const fields = {
          title,
          unit: primary.unit || "",
          varKeys: plottable.map((v) => v.key),
          // Full per-variable info (key/label/unit/color/groupId) — needed
          // so a card with 2+ variables selected can plot EACH one as its
          // own line (with its own y-axis when units differ, and its own
          // device group's data when groups are mixed), same as the
          // Operator dashboard's cards. Without this, only the flattened
          // varKeys were kept and the card could only ever render a single
          // averaged line — see pdCustomCardMeta / renderPerfCardChart.
          vars: plottable.map((v) => ({ key: v.key, label: v.label, unit: v.unit || "", color: v.color, groupId: v.groupId })),
          color: primary.color,
          decimals: 1,
          // deviceGroupId is kept as a fallback/primary group (used for
          // date-range bounds, and as the default for any var without its
          // own groupId, e.g. cards saved before this change) -- but each
          // variable above now also carries its OWN groupId, since a
          // card's variables can come from different device groups.
          deviceGroupId: (primary && primary.groupId) || pdGCurrentGroupId || "grup1",
          chartType: pdGChartType,
          // Kalau yang disimpan mode "Compare", catat juga key mana yang
          // "top" dan mana yang "bottom" (lihat PD_GRAPH_COMPARE_PAIRS)
          // supaya kartu tersimpan di grid bisa render mirror yang sama
          // persis dengan preview modal ini -- lihat pdCustomCardMeta()
          // dan renderPerfCardChartMulti().
          comparePair,
        };

        // Editing an existing custom card (opened by clicking its title,
        // see wirePerformanceCards' [data-edit-perf-card] handler) updates
        // it in place — same id, so its period/wide/order state (kept
        // separately, keyed by perfKey) survives the edit — instead of
        // pushing a new one.
        if (pdGraphEditingId) {
          const existing = cfg.custom.find((c) => c.id === pdGraphEditingId);
          if (existing) Object.assign(existing, fields);
        } else {
          cfg.custom.push(Object.assign({ id: "custom_" + Date.now().toString(36) }, fields));
        }

        pdPersistPerfCfg();
        const wasEditing = !!pdGraphEditingId;
        closePdGraphModal();
        const p = projects[pdCurrentId];
        if (p) renderPerformanceAnalytics(p);
        showToast(wasEditing ? "Grafik berhasil diperbarui." : "Grafik ditambahkan ke Performance Analytics.");
      });
    }
  }

  pdBindGraphModal();

})();