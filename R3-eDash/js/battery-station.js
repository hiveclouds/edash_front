/* ============================================================
   360eDash — Battery Station (standalone tab inside Project
   Monitoring) — STEP 2 FULL REDESIGN.

   This page now renders TWO clearly separated concepts, per the
   STEP 1 architecture (js/battery-repository.js +
   js/battery-telemetry-adapter.js):

     1. REGISTERED BATTERIES — user-managed identity/metadata
        (Name, Brand, Model, Serial Number). Comes ONLY from
        window.BR_* (battery-repository.js). Persisted in
        PostgreSQL (`batteries` table, via the /api/v1/batteries
        endpoint — same pattern as /pv-modules) as of Phase 2
        below. window.BR_loadBatteries(projectId) MUST be awaited
        before window.BR_getCombinedBatteries()/BR_getBattery()
        return anything meaningful — see boot().

     2. BATTERY TELEMETRY — operational readings (status, SoC, SoH,
        voltage, current, power, energy). Comes ONLY from
        window.BTA_* (battery-telemetry-adapter.js), which reads
        REAL telemetry from the VPS Core API
        (GET /devices/:id/telemetry/latest and /telemetry/history)
        via window.edashApiFetch() (js/api-config.js). Devices are
        found through window.BVD_* (js/battery-vps-discovery.js),
        which discovers Project -> System -> Device from the VPS
        instead of any hardcoded site list.

   This file NEVER reads raw logger fields directly, and NEVER
   hardcodes Brand/Model/Serial Number — those always come from the
   combined model built by BR_getCombinedBatteries().

   VPS IS connected for both telemetry (Phase 1) and battery
   identity CRUD (Phase 2 — Name/Brand/Model/Serial Number in
   PostgreSQL via /api/v1/batteries). No static JSON is read
   anymore, no endpoint is invented, and no data is mocked/
   hardcoded/localStorage-persisted for identity CRUD anymore — see
   js/battery-repository.js header for what is still localStorage
   -backed on purpose (status transition history only; there is
   still no VPS endpoint for battery_status_transitions).

   PROJECT SCOPING: registered batteries AND telemetry are both
   scoped to the active project (PC_getActiveProject), generically —
   NOT limited to Tawabi. battery-vps-discovery.js already resolves
   Project -> System -> Device for ANY project on the VPS (Tawabi
   via the documented ID shortcut, any other project — Kasdam, PUT,
   dst — via GET /projects/:id with the real UUID), exactly the same
   pattern already proven in system-information.js's
   findCoreApiProject(localProjectId). This file used to hardcode
   the "tawabi" hint and gate telemetry off entirely for every other
   project, which is why Battery Station never showed VPS data for
   Kasdam/PUT even though System Information already could — fixed
   below by always passing the ACTUAL active project id through.
============================================================= */

(function () {

  // =============================
  // Telemetry now comes from the real VPS (Project -> System ->
  // Device discovery, see js/battery-vps-discovery.js), resolved
  // GENERICALLY for whichever project is active — same pattern as
  // system-information.js's findCoreApiProject(localProjectId).
  // "tawabi" is kept only as the DEFAULT project id when no active
  // project has been selected yet (mirrors project-selector.js's
  // "featured" default) — it is NOT a restriction on which projects
  // get telemetry.
  // =============================
  const DEFAULT_PROJECT_ID = "tawabi";

  // =============================
  // State
  // =============================
  const state = {
    projectId: "tawabi",
    telemetryEnabled: true,
    telemetryBySource: {},   // "device:<deviceId>" -> Telemetry
    telemetryLabels: {},     // "device:<deviceId>" -> "PLTS Tawabi 1 — PLTS Tawabi 1"
    telemetryInverterTypes: {}, // "device:<deviceId>" -> raw VPS inverterType ("Hybrid" | "Ongrid" | "Offgrid") | null
    discoveryError: null,    // { message, code } | null — set when VPS discovery/telemetry fails
    ongridOnly: false,       // true ONLY when discovery+telemetry succeeded (no discoveryError) AND every
                             // discovered device for this project is confirmed On-Grid type — On-Grid
                             // inverters have no BMS/battery, so there is genuinely nothing to show. This
                             // is NEVER set as a guess/fallback when telemetry actually failed to load
                             // (see computeOngridState()) — discoveryError and ongridOnly are mutually
                             // exclusive, so a real fetch error is never mislabeled as "battery not available"
                             // (see the ongridOnly computation at the end of loadTelemetry() below).
    discoveredDevices: [],   // last successful BVD_discoverDevicesForActiveProject() result
    backendProjectId: null,  // REAL Postgres project UUID resolved by discovery — see boot()'s
                              // 2026-08-31 fix note. Always use this (never the raw `projectId`
                              // local alias, e.g. "tawabi") for anything hitting the Postgres-backed
                              // `batteries` endpoints (BR_loadBatteries / BR_getCombinedBatteries).
    combined: [],            // all combined batteries (active + inactive) for this project
    view: "list",            // 'list' | 'detail'
    detailBatteryId: null,
    statusFilter: "all",
    trendRange: "today",     // 'today' | 'last7Days' | 'lastMonth'
    usingCustomRange: false, // true while the charts show a custom-fetched date/time window instead of the active preset tab
    lastCustomRange: null,  // { startMs, endMs } of the last "Terapkan" request — kept only so a failed
                             // custom-range fetch can offer a "Coba lagi" retry of the EXACT same window,
                             // never as a substitute for the user re-picking dates.
    formEditingId: null,
    formEditingDeviceId: null, // set when the form is registering a __virtual (VPS-only) card
    loaded: false,
  };

  const el = {};
  const chartInstances = {};

  // =============================
  // Small pure helpers (kept dependency-free / testable)
  // =============================
  function isFiniteNum(v) { return typeof v === "number" && Number.isFinite(v); }

  function esc(str) {
    return String(str === null || str === undefined ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtNum(v, digits) {
    digits = digits === undefined ? 1 : digits;
    if (!isFiniteNum(v)) return "\u2013";
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtDash(v, digits, unit) {
    if (!isFiniteNum(v)) return '<span class="bs-dash">\u2013</span>';
    return esc(fmtNum(v, digits)) + (unit ? " " + esc(unit) : "");
  }

  function fmtDateTimeWib(iso) {
    if (!iso) return "\u2013";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "\u2013";
    return d.toLocaleString("en-US", {
      timeZone: "Asia/Jakarta",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }) + " WIB";
  }

  function fmtChartLabel(iso, isShortSpan) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    if (isShortSpan) {
      return d.toLocaleTimeString("en-US", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleString("en-US", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", hour: "2-digit" });
  }

  // Whether a series' timestamps span <= ~36h — used to pick
  // time-only vs date+hour chart labels based on the ACTUAL data
  // shown, not just the active preset tab, so a custom multi-day
  // range picked while on "Today" still gets date-aware labels.
  function isShortSpanSeries(series) {
    const ts = series && series.timestampsUtc;
    if (!Array.isArray(ts) || ts.length < 2) return true;
    const first = new Date(ts[0]).getTime();
    const last = new Date(ts[ts.length - 1]).getTime();
    if (!isFiniteNum(first) || !isFiniteNum(last)) return true;
    return Math.abs(last - first) <= 36 * 60 * 60 * 1000;
  }

  function fmtDuration(ms) {
    if (!isFiniteNum(ms) || ms < 0) return "\u2013";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
  }

  // Inverter type coming straight from the VPS ("Hybrid" | "Ongrid" |
  // "Offgrid", per DOKUMENTASI_API_eDASHBOARD_360ENERGY.html §4.1/§4.3 —
  // InverterType SERVER_SCOPE attribute / telemetry/latest response
  // field). Normalized/compared case- and separator-insensitively since
  // the doc itself shows both "Ongrid" (attribute) and "On-Grid" (prose)
  // for the same value.
  function normalizeInverterType(type) {
    return typeof type === "string" ? type.trim().toLowerCase().replace(/[\s_-]+/g, "") : "";
  }
  function isOngridInverterType(type) {
    return normalizeInverterType(type) === "ongrid";
  }

  const STATUS_META = {
    charging: { label: "Charging", tone: "charging" },
    discharging: { label: "Discharging", tone: "discharging" },
    idle: { label: "Static", tone: "idle" },
  };
  function statusMeta(status) {
    return STATUS_META[status] || { label: "Unknown", tone: "unknown" };
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // =============================
  // DOM cache
  // =============================
  function cacheEls() {
    el.listView = document.getElementById("bsListView");
    el.detailView = document.getElementById("bsDetailView");

    el.statsRow = document.getElementById("bsStatsRow");
    el.overviewNote = document.getElementById("bsOverviewNote");
    el.sourcePill = document.getElementById("bsSourcePill");
    el.sourcePillText = document.getElementById("bsSourcePillText");

    el.statusFilter = document.getElementById("bsStatusFilter");
    el.inventoryCount = document.getElementById("bsInventoryCount");
    el.batteryGrid = document.getElementById("bsBatteryGrid");
    el.emptyState = document.getElementById("bsEmptyState");
    el.emptyTitle = document.getElementById("bsEmptyTitle");
    el.emptyDesc = document.getElementById("bsEmptyDesc");

    el.backBtn = document.getElementById("bsBackBtn");
    el.projectTitle = document.getElementById("bsProjectTitle");
    el.detailMeta = document.getElementById("bsDetailMeta");
    el.detailBadge = document.getElementById("bsDetailBadge");
    el.lastUpdated = document.getElementById("bsLastUpdated");
    el.detailEditBtn = document.getElementById("bsDetailEditBtn");
    el.refreshDetailBtn = document.getElementById("bsRefreshDetailBtn");
    el.refreshDetailBtnText = document.getElementById("bsRefreshDetailBtnText");

    el.noDataNote = document.getElementById("bsNoDataNote");
    el.heroCard = document.getElementById("bsHeroCard");
    el.stateTop = document.getElementById("bsStateTop");
    el.stateTech = document.getElementById("bsStateTech");
    el.operLiveDot = document.getElementById("bsOperLiveDot");
    el.operSourceLabel = document.getElementById("bsOperSourceLabel");

    el.trendTabs = document.getElementById("bsTrendTabs");
    el.chartGrid = document.getElementById("bsChartGrid");
    el.rangeControls = document.getElementById("bsRangeControls");
    el.rangeFrom = document.getElementById("bsRangeFrom");
    el.rangeTo = document.getElementById("bsRangeTo");
    el.rangeApplyBtn = document.getElementById("bsRangeApplyBtn");
    el.rangeResetBtn = document.getElementById("bsRangeResetBtn");
    el.rangeSliderWrap = document.getElementById("bsRangeSliderWrap");
    el.rangeSliderMin = document.getElementById("bsRangeSliderMin");
    el.rangeSliderMax = document.getElementById("bsRangeSliderMax");
    el.rangeSliderFill = document.getElementById("bsRangeSliderFill");
    el.rangeCaptionStart = document.getElementById("bsRangeCaptionStart");
    el.rangeCaptionEnd = document.getElementById("bsRangeCaptionEnd");

    el.chartModalOverlay = document.getElementById("bsChartModalOverlay");
    el.chartModalTitle = document.getElementById("bsChartModalTitle");
    el.chartModalRange = document.getElementById("bsChartModalRange");
    el.chartModalCloseBtn = document.getElementById("bsChartModalCloseBtn");
    el.chartModalMin = document.getElementById("bsChartModalMin");
    el.chartModalMax = document.getElementById("bsChartModalMax");
    el.chartModalAvg = document.getElementById("bsChartModalAvg");
    el.chartModalLast = document.getElementById("bsChartModalLast");

    el.energySections = document.getElementById("bsEnergySections");

    el.statusRibbon = document.getElementById("bsStatusRibbon");
    el.statusRibbonRange = document.getElementById("bsStatusRibbonRange");
    el.statusLegend = document.getElementById("bsStatusLegend");
    el.logFilterBar = document.getElementById("bsLogFilterBar");
    el.logFilterLabel = document.getElementById("bsLogFilterLabel");
    el.logFilterClearBtn = document.getElementById("bsLogFilterClearBtn");
    el.logList = document.getElementById("bsLogList");
    el.logCount = document.getElementById("bsLogCount");
    el.logMoreBtn = document.getElementById("bsLogMoreBtn");

    // Modals
    el.formOverlay = document.getElementById("bsFormModalOverlay");
    el.formTitle = document.getElementById("bsFormModalTitle");
    el.formDesc = document.getElementById("bsFormModalDesc");
    el.form = document.getElementById("bsBatteryForm");
    el.fieldName = document.getElementById("bsFieldName");
    el.fieldBrand = document.getElementById("bsFieldBrand");
    el.fieldModel = document.getElementById("bsFieldModel");
    el.fieldSerial = document.getElementById("bsFieldSerial");
    el.errName = document.getElementById("bsErrName");
    el.errBrand = document.getElementById("bsErrBrand");
    el.errModel = document.getElementById("bsErrModel");
    el.errSerial = document.getElementById("bsErrSerial");
    el.formCancelBtn = document.getElementById("bsFormCancelBtn");
    el.formSubmitBtnText = document.getElementById("bsFormSubmitBtnText");


    el.toast = document.getElementById("bsToast");
    el.toastMsg = document.getElementById("bsToastMsg");
  }

  // =============================
  // TOAST (mirrors js/system-information.js showToast pattern)
  // =============================
  let toastTimer = null;
  function showToast(msg) {
    if (!el.toast) return;
    el.toastMsg.textContent = msg;
    el.toast.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("is-show"), 2800);
  }

  // =============================
  // DATA LOADING
  // =============================
  async function loadTelemetry() {
    state.telemetryBySource = {};
    state.telemetryLabels = {};
    state.telemetryInverterTypes = {};
    state.discoveryError = null;
    state.ongridOnly = false;
    state.discoveredDevices = [];
    if (!state.telemetryEnabled) return;

    if (typeof window.BVD_discoverDevicesForActiveProject !== "function") {
      state.discoveryError = { message: "Modul discovery VPS (battery-vps-discovery.js) belum dimuat.", code: "DISCOVERY_MODULE_MISSING" };
      return;
    }

    let devices;
    try {
      // localProjectId GENERIK — "tawabi" (kalau memang project aktif)
      // ATAU UUID asli project lain (Kasdam, PUT, dst) dari GET
      // /projects, SAMA seperti findCoreApiProject(localProjectId) di
      // system-information.js. Sebelumnya di sini SELALU dikirim
      // hint "tawabi" hardcode, jadi project lain tidak pernah
      // ke-discovery walau battery-vps-discovery.js sudah mendukungnya.
      devices = await window.BVD_discoverDevicesForActiveProject(state.projectId);
    } catch (e) {
      console.error("[battery-station] Gagal discovery Project/System/Device dari VPS:", e);
      state.discoveryError = { message: e.message, code: e.code || null, status: e.status };
      return;
    }
    state.discoveredDevices = devices;

    const jobs = devices.map(async (device) => {
      const key = `device:${device.deviceId}`;
      try {
        const { bySource, raw } = await window.BTA_getStationTelemetry(device.deviceId, device.deviceName);
        state.telemetryBySource[key] = bySource[key];
        state.telemetryLabels[key] = device.systemName
          ? `${device.systemName} \u2014 ${device.deviceName}`
          : device.deviceName;
        // inverterType comes straight from the same telemetry/latest
        // response (see DOKUMENTASI_API_eDASHBOARD_360ENERGY.html §4.3) —
        // no extra request needed. Kept per-device (not just a single
        // project-level flag) so a project with a MIX of On-Grid and
        // Hybrid/Off-Grid inverters only hides the On-Grid device's
        // battery card, not the whole project's real batteries.
        state.telemetryInverterTypes[key] = (raw && raw.inverterType) || null;
      } catch (e) {
        console.error("[battery-station] Gagal memuat telemetry untuk device", device.deviceId, e);
        // 403 di SATU device biasanya berarti SEMUA device juga akan
        // gagal (endpoint yang sama, session/akun yang sama) — catat
        // sebagai discoveryError supaya UI menunjukkan pesan yang
        // jelas, bukan diam-diam kosong.
        if (!state.discoveryError) {
          state.discoveryError = { message: e.message, code: e.code || null, status: e.status };
        }
      }
    });
    await Promise.all(jobs);

    // ongridOnly — ONLY computed off a genuinely successful load (no
    // discoveryError at all: if even ONE device failed to fetch, we
    // don't know its real inverter type, so we must not guess "no
    // battery" for the whole project — that would hide a real fetch
    // failure behind an incorrect "this is expected" message). Also
    // requires inverterType to be CONFIRMED (non-empty) for every
    // discovered device — never assumed from a missing/blank value.
    if (!state.discoveryError && state.discoveredDevices.length) {
      const keys = state.discoveredDevices.map((d) => `device:${d.deviceId}`);
      const knownTypes = keys
        .map((k) => state.telemetryInverterTypes[k])
        .filter((t) => typeof t === "string" && t.trim() !== "");
      state.ongridOnly = knownTypes.length === keys.length && knownTypes.every(isOngridInverterType);
    }
  }

  // Pesan keterangan untuk kondisi "battery tidak tersedia karena
  // inverter On-Grid" — SELALU dipisah dari describeDiscoveryError()
  // di atas (bukan salah satu cabangnya) supaya kondisi ini TIDAK
  // pernah jadi fallback/pengganti pesan error asli ketika Battery
  // Station memang gagal mengambil data (lihat state.ongridOnly di
  // atas — hanya true kalau loadTelemetry() benar-benar sukses).
  function describeOngridNotice() {
    const name = state.projectName || state.projectId;
    return `Battery is not available for ${name} \u2014 its inverter is On-Grid type, which has no battery/BMS to report on.`;
  }

  // Pesan error yang jelas untuk ditampilkan di el.overviewNote.
  //
  // Catatan akses (DOKUMENTASI_API_eDASHBOARD_360ENERGY.html §4):
  // GET /devices/:id/telemetry/latest & /telemetry/history HANYA
  // butuh "Authenticated" (role apa pun yang sudah login), BUKAN
  // Admin360-only -- itu cuma untuk registrasi/listing device (POST
  // /devices, GET /devices/inverters, §4.1/§4.2), yang tidak pernah
  // dipanggil dari Battery Station. Jadi 403 di sini bukan "belum
  // login sebagai Admin360" (pesan lama keliru) -- itu genuinely
  // error yang perlu diselidiki (mis. session/permission proyek).
  function describeDiscoveryError(err) {
    if (!err) return "";
    if (err.status === 403 || err.code === "FORBIDDEN") {
      return "Akses ke telemetry VPS ditolak (403) oleh backend. Ini bukan soal role Admin360 (telemetry hanya butuh akun yang login) -- kemungkinan izin akun ke proyek ini perlu dicek ke tim backend.";
    }
    if (err.status === 401) {
      return "Sesi login sudah berakhir. Silakan login ulang.";
    }
    if (err.code === "PROJECT_NOT_FOUND") {
      return `Proyek ${state.projectName || state.projectId} tidak ditemukan di VPS.`;
    }
    if (err.code === "NO_DEVICES_FOUND") {
      return "Proyek ditemukan di VPS, tapi tidak ada device/inverter yang terdaftar.";
    }
    return `Gagal memuat data dari VPS: ${err.message || "unknown error"}`;
  }

  // =============================
  // VPS-DISCOVERED (unregistered) batteries — one entry per device
  // VPS discovery found that has NO registered metadata record
  // pointing at it yet. This is what makes Battery Station show real
  // telemetry immediately (same experience as System Information,
  // which shows one card per discovered device with no separate
  // "registration" step) instead of requiring "+ Add Battery" first.
  //
  // These are NEVER written to localStorage/BR — purely a display-
  // time merge. Name = real device name from VPS. Brand/Model/Serial
  // are null (genuinely not available — there is still no metadata
  // CRUD endpoint on the backend, see Phase 2 note in
  // js/battery-repository.js), never guessed. Clicking "Register"
  // on one of these opens the existing Add Battery form pre-filled
  // with the device's name + telemetry source, so the user only has
  // to type Brand/Model/Serial to turn it into a real BR record —
  // no new persistence mechanism, no new endpoint.
  // =============================
  const VIRTUAL_ID_PREFIX = "vps:";
  function isVirtualBatteryId(id) {
    return typeof id === "string" && id.startsWith(VIRTUAL_ID_PREFIX);
  }

  function buildVirtualBattery(device) {
    const key = `device:${device.deviceId}`;
    const telemetry = state.telemetryBySource[key] || null;
    return {
      id: `${VIRTUAL_ID_PREFIX}${device.deviceId}`,
      batteryIndex: null,
      metadata: { name: device.deviceName, brand: null, model: null, serialNumber: null },
      telemetry,
      source: { metadata: "vps-unregistered", telemetry: telemetry ? (telemetry.__source || "vps") : "none" },
      active: true,
      __virtual: true,
      __telemetrySource: key,
      __deviceId: device.deviceId,
    };
  }

  // FIX (2026-08-31): the DB's "max 2 baterai per device" CHECK
  // constraint (battery_index 1 or 2) is a storage-level allowance,
  // NOT a promise that VPS discovery/telemetry ever produces two
  // distinct batteries per device. It doesn't —
  // battery-telemetry-adapter.js's getStationTelemetry() is
  // explicit that /telemetry/latest returns exactly ONE stream per
  // device and "does not distinguish battery_index 1 vs 2 on the
  // same device". So there is only ever ONE real thing a placeholder
  // card could represent per device. The previous "< 2" filter here
  // kept the "From VPS — identity not registered yet" placeholder
  // visible even after that device's telemetry had already been
  // claimed by a registered row, which produced a second card
  // showing the exact same numbers as the first (confirmed: renaming
  // a device's placeholder turned 2 batteries into 4, each duplicate
  // pair reporting identical SoC/SoH/power). Naming/editing a
  // placeholder is supposed to be a rename of that one card, never
  // the creation of an additional one — so the placeholder must hide
  // as soon as the device has ANY active registered battery.
  //
  // INVARIANT: how MANY battery cards exist always follows VPS
  // discovery — exactly one card per currently-discovered device,
  // never more. What the card is NAMED is the only thing the user
  // freely edits. Two things could otherwise violate that invariant
  // even with the fix above, so both are guarded here explicitly
  // rather than trusted to already-clean data:
  //   1. A registered row whose device VPS no longer reports (device
  //      removed/renamed on the VPS side) must not keep rendering a
  //      stale card — the count has to shrink to match VPS, not stay
  //      inflated by rows nothing on VPS backs anymore.
  //   2. If more than one active row still points at the SAME device
  //      (leftover duplicates from the past create-instead-of-update
  //      bug, or any future race), only ONE of them is ever shown —
  //      a device only ever has one telemetry stream, so it can only
  //      ever be one real card. The rest stay in Postgres (harmless,
  //      just hidden) until someone cleans them up server-side; the
  //      UI no longer lets them multiply the count.
  function reloadCombined() {
    const discoveredIds = new Set(state.discoveredDevices.map((d) => d.deviceId));
    const allRegistered = window.BR_getCombinedBatteries(state.backendProjectId || state.projectId, state.telemetryBySource);

    const takenByDevice = {};
    const registered = allRegistered.filter((b) => {
      // Inactive (soft-deleted) rows are never counted or deduped —
      // they're just kept around so a direct link to their detail
      // view still resolves; they can't affect what's shown in the
      // grid (see getActiveCombined()) or how many devices look taken.
      if (!b.active) return true;
      if (!b.__deviceId || !discoveredIds.has(b.__deviceId)) return false; // (1) device no longer on VPS
      if (takenByDevice[b.__deviceId]) return false; // (2) dedupe — one card per device, max
      takenByDevice[b.__deviceId] = true;
      return true;
    });

    const unregistered = state.discoveredDevices
      .filter((d) => !takenByDevice[d.deviceId])
      // On-Grid devices have no BMS/battery at all — don't synthesize
      // an empty "unregistered battery" card full of dashes for them,
      // see describeOngridNotice() / state.ongridOnly above.
      .filter((d) => !isOngridInverterType(state.telemetryInverterTypes[`device:${d.deviceId}`]))
      .map(buildVirtualBattery);
    state.combined = registered.concat(unregistered);
  }

  function getActiveCombined() {
    return state.combined.filter((b) => b.active);
  }

  // =============================
  // SECTION 2 — Overview aggregation
  // Excludes batteries without telemetry from the SoC/SoH averages
  // and status counts (never treated as 0/idle) — Step 2 requirement.
  // =============================
  function computeOverview(activeBatteries) {
    let charging = 0, discharging = 0, otherKnown = 0, noTelemetry = 0;
    const socVals = [];
    const sohVals = [];

    activeBatteries.forEach((b) => {
      const tel = b.telemetry;
      if (!tel || tel.status === null || tel.status === undefined) {
        noTelemetry++;
      } else if (tel.status === "charging") {
        charging++;
      } else if (tel.status === "discharging") {
        discharging++;
      } else {
        otherKnown++;
      }
      if (tel && isFiniteNum(tel.soc)) socVals.push(tel.soc);
      if (tel && isFiniteNum(tel.soh)) sohVals.push(tel.soh);
    });

    return {
      total: activeBatteries.length,
      charging,
      discharging,
      noTelemetry,
      avgSoc: socVals.length ? socVals.reduce((a, v) => a + v, 0) / socVals.length : null,
      avgSoh: sohVals.length ? sohVals.reduce((a, v) => a + v, 0) / sohVals.length : null,
      socSampleCount: socVals.length,
      sohSampleCount: sohVals.length,
    };
  }

  // =============================
  // Source pill (page header) — tells the user, truthfully, where
  // the numbers on this page are actually coming from right now.
  // This element used to be a static "Development Data Source" pill
  // left over from before VPS integration — it was never wired to
  // real state, so it kept showing that text even after telemetry
  // started coming from the VPS. Fixed here: the pill now reflects
  // state.discoveryError / actual telemetry __source every render.
  // =============================
  function renderSourcePill() {
    if (!el.sourcePill) return;
    el.sourcePill.classList.remove("pill-info", "pill-success", "pill-danger", "pill-warning");

    if (!state.telemetryEnabled) {
      el.sourcePill.classList.add("pill-info");
      el.sourcePillText.textContent = "No VPS Telemetry for this Project";
      el.sourcePill.title = "Live VPS telemetry is not available for this project.";
      return;
    }
    if (state.discoveryError) {
      el.sourcePill.classList.add("pill-danger");
      el.sourcePillText.textContent = "VPS Connection Error";
      el.sourcePill.title = describeDiscoveryError(state.discoveryError);
      return;
    }
    if (state.ongridOnly) {
      el.sourcePill.classList.add("pill-warning");
      el.sourcePillText.textContent = "Battery Not Available (On-Grid)";
      el.sourcePill.title = describeOngridNotice();
      return;
    }
    const hasVpsTelemetry = Object.values(state.telemetryBySource).some((t) => t && t.__source === "vps");
    if (hasVpsTelemetry) {
      el.sourcePill.classList.add("pill-success");
      el.sourcePillText.textContent = "Live VPS Data";
      el.sourcePill.title = "Telemetry is fetched live from the VPS Core API (GET /devices/:id/telemetry/latest & /telemetry/history).";
    } else {
      el.sourcePill.classList.add("pill-info");
      el.sourcePillText.textContent = "No Telemetry Data";
      el.sourcePill.title = "VPS discovery succeeded but returned no telemetry yet.";
    }
  }

  function renderOverview() {
    const active = getActiveCombined();
    const agg = computeOverview(active);
    renderSourcePill();

    const items = [
      { icon: "fa-layer-group", tone: "total", label: "Total Batteries", value: String(agg.total) },
      { icon: "fa-bolt", tone: "charging", label: "Charging", value: String(agg.charging) },
      { icon: "fa-battery-three-quarters", tone: "discharging", label: "Discharging", value: String(agg.discharging) },
      { icon: "fa-gauge-high", tone: "soc", label: "Average SoC", value: isFiniteNum(agg.avgSoc) ? fmtNum(agg.avgSoc, 0) + "%" : "\u2014" },
      { icon: "fa-heart-pulse", tone: "soh", label: "Average SoH", value: isFiniteNum(agg.avgSoh) ? fmtNum(agg.avgSoh, 0) + "%" : "\u2014" },
    ];

    el.statsRow.innerHTML = items.map((it) => `
      <div class="bs-stat-card">
        <div class="bs-stat-icon bs-stat-icon-${it.tone}"><i class="fa-solid ${it.icon}"></i></div>
        <div>
          <div class="bs-stat-value">${it.value}</div>
          <div class="bs-stat-label">${esc(it.label)}</div>
        </div>
      </div>`).join("");

    if (state.discoveryError) {
      el.overviewNote.textContent = describeDiscoveryError(state.discoveryError);
    } else if (state.ongridOnly) {
      el.overviewNote.textContent = describeOngridNotice();
    } else if (agg.total === 0) {
      el.overviewNote.textContent = "";
    } else if (agg.noTelemetry > 0) {
      el.overviewNote.textContent = `${agg.noTelemetry} dari ${agg.total} baterai terdaftar tidak punya sumber telemetry dan tidak dihitung dalam rata-rata di atas.`;
    } else {
      el.overviewNote.textContent = "";
    }

    el.inventoryCount.textContent = `${agg.total} ${agg.total === 1 ? "battery" : "batteries"}`;
  }

  // =============================
  // SECTION 3 — Registered Battery grid
  // =============================
  function getFilteredBatteries() {
    const active = getActiveCombined();
    if (state.statusFilter === "all") return active;
    if (state.statusFilter === "no-telemetry") return active.filter((b) => !b.telemetry);
    return active.filter((b) => b.telemetry && b.telemetry.status === state.statusFilter);
  }

  function buildRegCardHtml(battery) {
    const tel = battery.telemetry;
    const meta = statusMeta(tel ? tel.status : null);
    const badgeHtml = tel
      ? `<span class="bs-badge bs-badge-${meta.tone}">${esc(meta.label)}</span>`
      : `<span class="bs-badge bs-badge-none">No telemetry</span>`;

    const metricsHtml = tel
      ? `<div class="bs-reg-card-metrics">
           <div class="bs-reg-card-metric is-primary"><span class="bs-reg-card-metric-value">${fmtDash(tel.soc, 0, "%")}</span><span class="bs-reg-card-metric-label">SoC</span></div>
           <div class="bs-reg-card-metric"><span class="bs-reg-card-metric-value">${fmtDash(tel.soh, 0, "%")}</span><span class="bs-reg-card-metric-label">SoH</span></div>
           <div class="bs-reg-card-metric"><span class="bs-reg-card-metric-value">${fmtDash(tel.power, 1, "kW")}</span><span class="bs-reg-card-metric-label">Power</span></div>
         </div>`
      : `<div class="bs-reg-card-notele"><i class="fa-solid fa-plug-circle-xmark"></i> No telemetry source assigned \u2014 identity only.</div>`;

    // Every card gets the pencil — including VPS-discovered devices
    // that have no `batteries` row yet (__virtual). For those,
    // openEditModal()/handleFormSubmit() below route the save to
    // BR_createBattery() instead of BR_updateBattery() (attaches
    // identity to the device, does not let the user pick device/slot
    // themselves — see battery-repository.js).
    const actionsHtml = `<button class="bs-icon-btn" type="button" data-action="edit" data-battery-id="${esc(battery.id)}" title="${battery.__virtual ? "Add Battery Identity" : "Edit Battery"}" aria-label="${battery.__virtual ? "Add Battery Identity" : "Edit Battery"}"><i class="fa-solid fa-pen"></i></button>`;

    const identityHtml = battery.__virtual
      ? `<span><i class="fa-solid fa-circle-info"></i> From VPS \u2014 identity not registered yet (Brand/Model/Serial unset)</span>`
      : `<span><b>${esc(battery.metadata.brand || "\u2013")}</b> \u00b7 ${esc(battery.metadata.model || "\u2013")}</span>
         <span>SN: ${esc(battery.metadata.serialNumber || "\u2013")}</span>`;

    return `
      <div class="bs-reg-card" data-battery-id="${esc(battery.id)}" tabindex="0" role="button" aria-label="View details for ${esc(battery.metadata.name)}">
        <div class="bs-reg-card-top">
          <div>
            <div class="bs-reg-card-name">${esc(battery.metadata.name)}</div>
            ${badgeHtml}
          </div>
          <div class="bs-reg-card-actions">
            ${actionsHtml}
          </div>
        </div>
        <div class="bs-reg-card-identity">
          ${identityHtml}
          ${state.projectName ? `<span>Project: ${esc(state.projectName)}</span>` : ""}
        </div>
        ${metricsHtml}
        <div class="bs-reg-card-foot">
          <span>${tel ? "Updated " + fmtDateTimeWib(tel.lastUpdated) : "\u2013"}</span>
          <span class="bs-reg-card-foot-link">Details <i class="fa-solid fa-arrow-right"></i></span>
        </div>
      </div>`;
  }

  function renderBatteryGrid() {
    const activeTotal = getActiveCombined().length;
    const filtered = getFilteredBatteries();

    if (activeTotal === 0) {
      el.batteryGrid.innerHTML = "";
      el.batteryGrid.style.display = "none";
      el.emptyState.style.display = "";
      if (state.discoveryError) {
        el.emptyTitle.textContent = "Could not load battery data from VPS";
        el.emptyDesc.textContent = describeDiscoveryError(state.discoveryError);
      } else if (state.ongridOnly) {
        el.emptyTitle.textContent = "Battery not available for this project";
        el.emptyDesc.textContent = describeOngridNotice();
      } else {
        el.emptyTitle.textContent = "No batteries registered yet";
        el.emptyDesc.textContent = "No batteries are registered for this project yet.";
      }
      return;
    }

    if (filtered.length === 0) {
      el.batteryGrid.innerHTML = "";
      el.batteryGrid.style.display = "none";
      el.emptyState.style.display = "";
      el.emptyTitle.textContent = "No battery matches this filter";
      el.emptyDesc.textContent = "Try a different status filter.";
      return;
    }

    el.emptyState.style.display = "none";
    el.batteryGrid.style.display = "";
    el.batteryGrid.innerHTML = filtered.map(buildRegCardHtml).join("");
  }

  function bindGridEvents() {
    el.batteryGrid.addEventListener("click", (e) => {
      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) {
        e.stopPropagation();
        const id = actionBtn.dataset.batteryId;
        if (actionBtn.dataset.action === "edit") openEditModal(id);
        return;
      }
      const card = e.target.closest(".bs-reg-card");
      if (card) showDetailView(card.dataset.batteryId);
    });
    el.batteryGrid.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".bs-reg-card");
      if (card) { e.preventDefault(); showDetailView(card.dataset.batteryId); }
    });
  }

  // =============================
  // VIEW switching
  // =============================
  function showListView() {
    state.view = "list";
    el.listView.classList.add("is-active");
    el.detailView.classList.remove("is-active");
    renderOverview();
    renderBatteryGrid();
  }

  function showDetailView(batteryId) {
    state.view = "detail";
    state.detailBatteryId = batteryId;
    state.transitionsExpanded = false;
    if (el.chartModalOverlay) { closeChartModal(); }
    el.listView.classList.remove("is-active");
    el.detailView.classList.add("is-active");
    renderDetail();
  }

  // =============================
  // DETAIL VIEW
  // =============================
  function getDetailBattery() {
    return state.combined.find((b) => b.id === state.detailBatteryId) || null;
  }

  // Detail header: identity (name/brand/model/serial) + one status
  // badge + compact edit action. Replaces the old
  // separate "Battery Identity" card — one identity header instead
  // of identity-card + header-strip duplicating the same facts.
  function renderHeader(battery) {
    el.projectTitle.textContent = battery.metadata.name;
    const tel = battery.telemetry;
    const meta = statusMeta(tel ? tel.status : null);
    el.detailBadge.className = "bs-badge bs-badge-lg " + (tel ? "bs-badge-" + meta.tone : "bs-badge-none");
    el.detailBadge.textContent = tel ? meta.label : "No telemetry";
    el.detailMeta.innerHTML = battery.__virtual
      ? `<i class="fa-solid fa-circle-info"></i> From VPS \u2014 identity not registered yet${state.projectName ? ` &nbsp;&middot;&nbsp; Project: ${esc(state.projectName)}` : ""}`
      : `<b>${esc(battery.metadata.brand || "\u2013")}</b> \u00b7 ${esc(battery.metadata.model || "\u2013")} &nbsp;&middot;&nbsp; SN: ${esc(battery.metadata.serialNumber || "\u2013")}${state.projectName ? ` &nbsp;&middot;&nbsp; Project: ${esc(state.projectName)}` : ""}`;
    el.lastUpdated.textContent = tel ? ("Updated " + fmtDateTimeWib(tel.lastUpdated)) : "No telemetry source assigned";

    el.detailEditBtn.style.display = "";
    el.detailEditBtn.onclick = () => openEditModal(battery.id);
    el.detailEditBtn.title = battery.__virtual ? "Add Battery Identity" : "Edit Battery";
  }

  // Current Battery State panel: baris pertama tepat 3 kartu (SoC
  // ditonjolkan, Power, Status) — tidak ada sel kosong — lalu
  // Voltage/Current/SoH sebagai strip teks ringkas, bukan kartu.
  function renderOperational(battery) {
    const tel = battery.telemetry;
    if (!tel) {
      el.operLiveDot.style.display = "none";
      el.noDataNote.style.display = "";
      el.noDataNote.innerHTML = `<i class="fa-solid fa-plug-circle-xmark"></i> Tidak ada sumber telemetry \u2014 status, SoC/SoH, voltage, current dan power tidak tersedia.`;
      el.stateTop.innerHTML = `<div class="bs-empty-inline" style="grid-column:1/-1;">Telemetry unavailable.</div>`;
      el.stateTech.innerHTML = "";
      el.heroCard.querySelector(".bs-card-head").style.display = "none";
      return;
    }
    el.operLiveDot.style.display = "";
    el.noDataNote.style.display = "none";
    el.heroCard.querySelector(".bs-card-head").style.display = "";
    if (el.operSourceLabel) {
      el.operSourceLabel.textContent = tel.__source === "vps" ? "Live VPS data" : "No live source";
    }

    const meta = statusMeta(tel.status);
    const statusIcon = meta.tone === "charging" ? "fa-bolt" : meta.tone === "discharging" ? "fa-battery-three-quarters" : "fa-pause";

    el.stateTop.innerHTML = `
      <div class="bs-state-card is-primary">
        <div class="bs-state-icon"><i class="fa-solid fa-gauge-high"></i></div>
        <div><div class="bs-state-value">${fmtDash(tel.soc, 0, "%")}</div><div class="bs-state-label">State of Charge</div></div>
      </div>
      <div class="bs-state-card">
        <div class="bs-state-icon"><i class="fa-solid fa-bolt"></i></div>
        <div><div class="bs-state-value">${fmtDash(tel.power, 2, "kW")}</div><div class="bs-state-label">Power</div></div>
      </div>
      <div class="bs-state-card">
        <div class="bs-state-icon"><i class="fa-solid ${statusIcon}"></i></div>
        <div><div class="bs-state-value" style="font-size:14.5px;">${esc(meta.label)}</div><div class="bs-state-label">Status</div></div>
      </div>`;

    el.stateTech.innerHTML = `
      <span class="bs-state-tech-item">Voltage <b>${fmtDash(tel.voltage, 1, "V")}</b></span>
      <span class="bs-state-tech-item">Current <b>${fmtDash(tel.current, 1, "A")}</b></span>
      <span class="bs-state-tech-item">SoH <b>${fmtDash(tel.soh, 0, "%")}</b></span>`;
  }

  // ---------- C. Charts ----------
  function ensureChartJsLoaded(onReady) {
    if (typeof Chart !== "undefined") { onReady(); return; }
    if (window.__bsChartJsLoading) {
      window.__bsChartJsCallbacks = window.__bsChartJsCallbacks || [];
      window.__bsChartJsCallbacks.push(onReady);
      return;
    }
    window.__bsChartJsLoading = true;
    window.__bsChartJsCallbacks = [onReady];
    const script = document.createElement("script");
    script.src = "vendor/chartjs/chart.umd.min.js";
    script.onload = () => {
      window.__bsChartJsLoading = false;
      window.__bsChartJsCallbacks.forEach((cb) => cb());
      window.__bsChartJsCallbacks = [];
    };
    document.head.appendChild(script);
  }

  function destroyChart(key) {
    if (chartInstances[key]) { chartInstances[key].destroy(); delete chartInstances[key]; }
  }

  function lineChart(canvasId, key, labels, dataset, colorHex, unit) {
    destroyChart(key);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    chartInstances[key] = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: dataset,
          borderColor: colorHex,
          backgroundColor: hexToRgba(colorHex, 0.12),
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false, axis: "x" },
        hover: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: "index",
            intersect: false,
            callbacks: { label: (ctx) => `${fmtNum(ctx.parsed.y, 1)} ${unit}` },
          },
        },
        elements: { point: { hoverRadius: 5, hitRadius: 14 } },
        scales: {
          x: { ticks: { maxTicksLimit: 6, font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { font: { size: 10 } }, grid: { color: "#EEF2F2" } },
        },
      },
    });
  }

  function chartCardHtml(id, canvasId, metricKey, title, iconClass) {
    return `<div class="bs-chart-card" data-metric="${metricKey}">
      <div class="bs-chart-card-head"><span><i class="fa-solid ${iconClass}"></i> ${esc(title)}</span><i class="fa-solid fa-expand" title="Klik untuk lihat lebih besar"></i></div>
      <div class="bs-chart-canvas-wrap" id="${id}-wrap"><canvas id="${canvasId}"></canvas></div>
    </div>`;
  }

  const CHART_METRIC_DEFS = {
    soc:   { seriesKey: "socPct",   title: "SoC Trend",             unit: "%",  color: "#0F6A71", icon: "fa-gauge-high" },
    power: { seriesKey: "powerKw",  title: "Battery Power Trend",   unit: "kW", color: "#FA891A", icon: "fa-bolt" },
    volt:  { seriesKey: "voltageV", title: "Voltage Trend",         unit: "V",  color: "#3E7CB1", icon: "fa-plug" },
    curr:  { seriesKey: "currentA", title: "Current Trend",         unit: "A",  color: "#E3A21A", icon: "fa-wave-square" },
  };

  // ---------- Range window helpers (slider zoom within a loaded
  // series + real custom date/time fetch) ----------
  // The Today/Last 7 Days/Last Month tabs and the date/time
  // "Terapkan" control all call the VPS history endpoint for real
  // (see renderCharts()/applyCustomRange() below and
  // window.BTA_loadHistoryForRange / BTA_loadHistoryForCustomRange
  // in battery-telemetry-adapter.js). Only the drag-slider
  // (rangeSliderMin/Max) still does a pure client-side zoom — it
  // narrows the view within whatever full series is currently
  // loaded, without a new request.
  function toDatetimeLocalValue(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function sliceSeries(series, startIdx, endIdx) {
    const slice = (arr) => (Array.isArray(arr) ? arr.slice(startIdx, endIdx + 1) : arr);
    return {
      timestampsUtc: slice(series.timestampsUtc),
      socPct: slice(series.socPct),
      powerKw: slice(series.powerKw),
      voltageV: slice(series.voltageV),
      currentA: slice(series.currentA),
    };
  }

  function updateRangeVisuals() {
    const full = state.chartFullSeries;
    const win = state.rangeWindow;
    if (!full || !win) return;
    const total = full.timestampsUtc.length;
    const startPct = total > 1 ? (win.startIdx / (total - 1)) * 100 : 0;
    const endPct = total > 1 ? (win.endIdx / (total - 1)) * 100 : 100;
    el.rangeSliderFill.style.left = startPct + "%";
    el.rangeSliderFill.style.width = Math.max(0, endPct - startPct) + "%";
    el.rangeCaptionStart.textContent = fmtChartLabel(full.timestampsUtc[win.startIdx], isShortSpanSeries(full));
    el.rangeCaptionEnd.textContent = fmtChartLabel(full.timestampsUtc[win.endIdx], isShortSpanSeries(full));
    el.rangeFrom.value = toDatetimeLocalValue(full.timestampsUtc[win.startIdx]);
    el.rangeTo.value = toDatetimeLocalValue(full.timestampsUtc[win.endIdx]);
    el.rangeSliderMin.value = String(win.startIdx);
    el.rangeSliderMax.value = String(win.endIdx);
    // Reset now discards a custom-fetched range and reverts to the
    // active preset tab (see applyCustomRange()/handleResetRange()),
    // not just re-widening the slider — so it's shown whenever a
    // custom range is active, regardless of slider position.
    el.rangeResetBtn.hidden = !state.usingCustomRange;
  }

  function setupRangeControls() {
    const full = state.chartFullSeries;
    const total = full.timestampsUtc.length;
    el.rangeSliderMin.max = String(Math.max(0, total - 1));
    el.rangeSliderMax.max = String(Math.max(0, total - 1));
    el.rangeFrom.min = toDatetimeLocalValue(full.timestampsUtc[0]);
    el.rangeFrom.max = toDatetimeLocalValue(full.timestampsUtc[total - 1]);
    el.rangeTo.min = el.rangeFrom.min;
    el.rangeTo.max = el.rangeFrom.max;
    updateRangeVisuals();
  }

  function drawChartsForWindow() {
    const full = state.chartFullSeries;
    const win = state.rangeWindow;
    if (!full || !win) return;
    updateRangeVisuals();
    const series = sliceSeries(full, win.startIdx, win.endIdx);
    state.chartWindowSeries = series;
    ensureChartJsLoaded(() => {
      const labels = series.timestampsUtc.map((ts) => fmtChartLabel(ts, isShortSpanSeries(series)));
      lineChart("bsSocCanvas", "soc", labels, series.socPct, CHART_METRIC_DEFS.soc.color, "%");
      lineChart("bsPowerCanvas", "power", labels, series.powerKw, CHART_METRIC_DEFS.power.color, "kW");
      lineChart("bsVoltCanvas", "volt", labels, series.voltageV, CHART_METRIC_DEFS.volt.color, "V");
      lineChart("bsCurrCanvas", "curr", labels, series.currentA, CHART_METRIC_DEFS.curr.color, "A");
      if (el.chartModalOverlay.classList.contains("is-visible") && state.chartModalMetric) {
        openChartModal(state.chartModalMetric);
      }
    });
  }

  // ---------- Chart zoom modal (klik salah satu grafik) ----------
  function openChartModal(metricKey) {
    const def = CHART_METRIC_DEFS[metricKey];
    const series = state.chartWindowSeries;
    if (!def || !series) return;
    state.chartModalMetric = metricKey;

    const values = series[def.seriesKey] || [];
    const finiteValues = values.filter(isFiniteNum);
    const labels = series.timestampsUtc.map((ts) => fmtChartLabel(ts, isShortSpanSeries(series)));

    el.chartModalTitle.innerHTML = `<i class="fa-solid ${def.icon}"></i> ${esc(def.title)}`;
    el.chartModalRange.textContent = series.timestampsUtc.length
      ? `${fmtDateTimeWib(series.timestampsUtc[0])} \u2192 ${fmtDateTimeWib(series.timestampsUtc[series.timestampsUtc.length - 1])}`
      : "";

    if (finiteValues.length) {
      const min = Math.min(...finiteValues);
      const max = Math.max(...finiteValues);
      const avg = finiteValues.reduce((s, v) => s + v, 0) / finiteValues.length;
      const last = values[values.length - 1];
      el.chartModalMin.textContent = fmtNum(min, 1) + " " + def.unit;
      el.chartModalMax.textContent = fmtNum(max, 1) + " " + def.unit;
      el.chartModalAvg.textContent = fmtNum(avg, 1) + " " + def.unit;
      el.chartModalLast.textContent = isFiniteNum(last) ? fmtNum(last, 1) + " " + def.unit : "\u2014";
    } else {
      el.chartModalMin.textContent = el.chartModalMax.textContent = el.chartModalAvg.textContent = el.chartModalLast.textContent = "\u2014";
    }

    el.chartModalOverlay.classList.add("is-visible");
    ensureChartJsLoaded(() => {
      destroyChart("modal");
      const canvas = document.getElementById("bsChartModalCanvas");
      if (!canvas) return;
      chartInstances.modal = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
          labels,
          datasets: [{
            data: values,
            borderColor: def.color,
            backgroundColor: hexToRgba(def.color, 0.12),
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2.5,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false, axis: "x" },
          hover: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: "index",
              intersect: false,
              callbacks: { label: (ctx) => `${fmtNum(ctx.parsed.y, 1)} ${def.unit}` },
            },
          },
          elements: { point: { hoverRadius: 6, hitRadius: 16 } },
          scales: {
            x: { title: { display: true, text: "Waktu", font: { size: 11 } }, ticks: { maxTicksLimit: 8, font: { size: 11 } }, grid: { display: false } },
            y: { title: { display: true, text: def.unit, font: { size: 11 } }, ticks: { font: { size: 11 } }, grid: { color: "#EEF2F2" } },
          },
        },
      });
    });
  }

  function closeChartModal() {
    el.chartModalOverlay.classList.remove("is-visible");
    state.chartModalMetric = null;
    destroyChart("modal");
  }

  function renderChartCards() {
    el.chartGrid.innerHTML =
      chartCardHtml("bsSocChart", "bsSocCanvas", "soc", CHART_METRIC_DEFS.soc.title, CHART_METRIC_DEFS.soc.icon) +
      chartCardHtml("bsPowerChart", "bsPowerCanvas", "power", CHART_METRIC_DEFS.power.title, CHART_METRIC_DEFS.power.icon) +
      chartCardHtml("bsVoltChart", "bsVoltCanvas", "volt", CHART_METRIC_DEFS.volt.title, CHART_METRIC_DEFS.volt.icon) +
      chartCardHtml("bsCurrChart", "bsCurrCanvas", "curr", CHART_METRIC_DEFS.curr.title, CHART_METRIC_DEFS.curr.icon);
  }

  // Incrementing token guards against race conditions when the user
  // switches tabs/batteries (or fires another Apply) while a
  // previous fetch is still in flight — a stale response is simply
  // dropped instead of overwriting newer data.
  let chartLoadToken = 0;

  // chartEmptyHtml(message, retryAction) — the "nothing to show in the
  // chart grid" placeholder. When retryAction is given, a "Coba lagi"
  // button is rendered too (delegated click handler is in bindEvents())
  // — used ONLY for genuine fetch failures (see renderCharts()/
  // applyCustomRange() below), never for a plain "no data exists"
  // result, so the presence of the button itself already tells the
  // user whether retrying could help.
  function chartEmptyHtml(message, retryAction) {
    const retryHtml = retryAction
      ? `<div><button type="button" class="bs-timeline-more" data-action="${esc(retryAction)}">Coba lagi</button></div>`
      : "";
    return `<div class="bs-chart-empty"><div>${esc(message)}</div>${retryHtml}</div>`;
  }

  // renderCharts(battery) — loads the currently selected preset tab
  // (state.trendRange) for this battery. Always calls
  // BTA_loadHistoryForRange(), which fetches from the VPS the first
  // time a given device+range is requested and reads from cache on
  // repeat selections (see battery-telemetry-adapter.js).
  async function renderCharts(battery) {
    const telemetrySource = battery.__telemetrySource;
    const requestedRange = state.trendRange;
    const myToken = ++chartLoadToken;

    state.chartFullSeries = null;
    state.rangeWindow = null;
    state.usingCustomRange = false;

    if (!telemetrySource) {
      el.chartGrid.innerHTML = `<div class="bs-chart-empty">Belum tersambung ke data logger \u2014 grafik akan muncul setelah terhubung.</div>`;
      el.rangeControls.style.display = "none";
      return;
    }

    el.chartGrid.innerHTML = `<div class="bs-chart-empty">Memuat data historis\u2026</div>`;
    el.rangeControls.style.display = "none";

    const series = await window.BTA_loadHistoryForRange(telemetrySource, requestedRange);

    // Drop this result if the user has since switched tabs/batteries.
    if (myToken !== chartLoadToken) return;

    if (!series || !Array.isArray(series.timestampsUtc) || !series.timestampsUtc.length) {
      // Tell "the VPS request for this range actually failed" apart
      // from "there's genuinely no data yet" — both used to render the
      // exact same message, which is what made a real fetch failure
      // look identical to (and therefore get dismissed as) an empty
      // range. See getHistoryErrorForSource() in
      // battery-telemetry-adapter.js — this is the SAME error that was
      // already console.error-logged there; this just also surfaces it
      // to the user, with a working retry.
      const err = typeof window.BTA_getHistoryErrorForSource === "function"
        ? window.BTA_getHistoryErrorForSource(telemetrySource, requestedRange)
        : null;
      if (err) {
        console.error(`[battery-station] Grafik "${state.trendRange}" untuk ${battery.metadata && battery.metadata.name} gagal dimuat:`, err.message, err);
        el.chartGrid.innerHTML = chartEmptyHtml(`Gagal memuat data historis dari VPS: ${err.message || "unknown error"}`, "retry-charts");
      } else {
        el.chartGrid.innerHTML = chartEmptyHtml("Belum ada data historis untuk rentang ini.");
      }
      el.rangeControls.style.display = "none";
      return;
    }

    el.rangeControls.style.display = "";
    state.chartFullSeries = series;
    state.rangeWindow = { startIdx: 0, endIdx: series.timestampsUtc.length - 1 };

    renderChartCards();
    setupRangeControls();
    drawChartsForWindow();
  }

  // applyCustomRange(startMs, endMs) — always fetches fresh from the
  // VPS history endpoint for exactly the window the user picked in
  // bsRangeFrom/bsRangeTo, replacing (not slicing) whatever was
  // shown before. Bound to the "Terapkan" button.
  async function applyCustomRange(startMs, endMs) {
    const battery = getDetailBattery();
    const telemetrySource = battery && battery.__telemetrySource;
    if (!telemetrySource) return;
    const myToken = ++chartLoadToken;
    state.lastCustomRange = { startMs, endMs };

    el.rangeApplyBtn.disabled = true;
    el.rangeApplyBtn.classList.add("is-loading");

    let series = null;
    let fetchError = null;
    try {
      series = await window.BTA_loadHistoryForCustomRange(telemetrySource, startMs, endMs);
    } catch (e) {
      fetchError = e;
    }

    el.rangeApplyBtn.disabled = false;
    el.rangeApplyBtn.classList.remove("is-loading");

    if (myToken !== chartLoadToken) return;

    if (fetchError) {
      // Already console.error-logged inside loadHistoryForCustomRange()
      // (battery-telemetry-adapter.js); log again here WITH the battery/
      // range context so it's traceable from either file's log lines.
      console.error(`[battery-station] Custom range untuk ${battery.metadata && battery.metadata.name} (${new Date(startMs).toISOString()} \u2192 ${new Date(endMs).toISOString()}) gagal dimuat:`, fetchError.message, fetchError);
      el.chartGrid.innerHTML = chartEmptyHtml(`Gagal memuat data historis dari VPS untuk rentang ini: ${fetchError.message || "unknown error"}`, "retry-custom-range");
      return;
    }

    if (!series || !Array.isArray(series.timestampsUtc) || !series.timestampsUtc.length) {
      el.chartGrid.innerHTML = chartEmptyHtml("Tidak ada data untuk rentang tanggal/jam ini.");
      return;
    }

    state.usingCustomRange = true;
    state.chartFullSeries = series;
    state.rangeWindow = { startIdx: 0, endIdx: series.timestampsUtc.length - 1 };

    renderChartCards();
    setupRangeControls();
    drawChartsForWindow();
  }

  // resetToPresetRange() — discards a custom-fetched range and
  // reverts to whatever the active tab (state.trendRange) shows;
  // reads from cache (no new request) since selecting that tab
  // already fetched it. Bound to the "Reset" button.
  function resetToPresetRange() {
    const battery = getDetailBattery();
    if (!battery) return;
    renderCharts(battery);
  }

  // ---------- D. Energy (Daily only) ----------
  // STEP 2.5: cumulative/lifetime energy (Total Charged / Total
  // Discharged) removed — not part of the standardized Battery API
  // contract (only battery.dailyCharge / battery.dailyDischarge are).
  // Temperature and BMS Charge/Discharge Voltage cards removed
  // entirely for the same reason (Excel-only fields, spec §5).
  function renderEnergy(battery) {
    const tel = battery.telemetry;
    if (!tel) {
      el.energySections.innerHTML = `<div class="bs-empty-inline">Tanpa telemetry.</div>`;
      return;
    }
    if (!isFiniteNum(tel.chargedToday) && !isFiniteNum(tel.dischargedToday)) {
      el.energySections.innerHTML = `<div class="bs-empty-inline">Belum ada data hari ini.</div>`;
      return;
    }
    const charged = isFiniteNum(tel.chargedToday) ? tel.chargedToday : 0;
    const discharged = isFiniteNum(tel.dischargedToday) ? tel.dischargedToday : 0;
    const maxVal = Math.max(charged, discharged, 0.0001);
    const chargedPct = Math.round((charged / maxVal) * 100);
    const dischargedPct = Math.round((discharged / maxVal) * 100);

    el.energySections.innerHTML = `
      <div class="bs-energy-compare">
        <div class="bs-energy-row is-charge">
          <div class="bs-energy-row-top">
            <span class="bs-energy-row-label"><i class="fa-solid fa-arrow-down"></i> Charged</span>
            <span class="bs-energy-row-value">${fmtDash(tel.chargedToday, 1, "kWh")}</span>
          </div>
          <span class="bs-energy-bar-track"><span class="bs-energy-bar-fill" style="width:${chargedPct}%;"></span></span>
        </div>
        <div class="bs-energy-row is-discharge">
          <div class="bs-energy-row-top">
            <span class="bs-energy-row-label"><i class="fa-solid fa-arrow-up"></i> Discharged</span>
            <span class="bs-energy-row-value">${fmtDash(tel.dischargedToday, 1, "kWh")}</span>
          </div>
          <span class="bs-energy-bar-track"><span class="bs-energy-bar-fill" style="width:${dischargedPct}%;"></span></span>
        </div>
      </div>
      <p class="bs-energy-caption">Reset harian, bukan akumulasi.</p>`;
  }

  // ---------- E. Status Transition ----------
  // Ribbon dulu (proporsi waktu per status, sekilas paham tanpa
  // scroll). Klik salah satu legend (Charging/Discharging/Static)
  // memfilter daftar di bawah jadi LOG asli semua kejadian status
  // itu (timestamp per entri) — bukan satu kalimat ringkasan.
  function renderTransitions(battery) {
    state.lastTransitions = [];
    state.transitionFilter = null;
    el.statusLegend.querySelectorAll(".bs-status-legend-item").forEach((b) => b.classList.remove("is-active"));
    el.logFilterBar.style.display = "none";

    if (!battery.__telemetrySource) {
      el.statusRibbon.innerHTML = "";
      el.statusRibbonRange.textContent = "";
      el.logList.innerHTML = `<div class="bs-empty-inline">Perlu sumber telemetry untuk transisi status.</div>`;
      el.logCount.textContent = "0";
      el.logMoreBtn.style.display = "none";
      return;
    }
    const transitions = window.BR_getBatteryTransitions(battery.id);
    el.logCount.textContent = String(transitions.length);
    if (!transitions.length) {
      el.statusRibbon.innerHTML = "";
      el.statusRibbonRange.textContent = "";
      el.logList.innerHTML = `<div class="bs-empty-inline">Belum ada perubahan status.</div>`;
      el.logMoreBtn.style.display = "none";
      return;
    }

    const ascending = transitions.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    state.lastTransitions = ascending;

    // Segmen ribbon: satu segmen per interval status nyata (dari
    // duration yang sudah dihitung sistem), plus satu segmen
    // "ongoing" dari transisi terakhir sampai sekarang. Tidak ada
    // durasi yang dikarang.
    const segments = [];
    ascending.forEach((tr) => {
      if (isFiniteNum(tr.duration) && tr.duration > 0) {
        segments.push({ status: String(tr.previousStatus || "").toLowerCase(), duration: tr.duration });
      }
    });
    const lastTr = ascending[ascending.length - 1];
    const tel = battery.telemetry;
    const nowMs = tel && tel.lastUpdated ? new Date(tel.lastUpdated).getTime() : Date.now();
    const ongoingDuration = nowMs - new Date(lastTr.timestamp).getTime();
    if (ongoingDuration > 0) {
      segments.push({ status: String((tel && tel.status) || lastTr.newStatus || "").toLowerCase(), duration: ongoingDuration });
    }

    const totalDuration = segments.reduce((s, seg) => s + seg.duration, 0);
    if (totalDuration > 0 && segments.length) {
      el.statusRibbon.innerHTML = segments.map((seg) => {
        const meta = statusMeta(seg.status);
        const pct = Math.max((seg.duration / totalDuration) * 100, 0.4);
        const title = `${meta.label} \u00b7 ${fmtDuration(seg.duration)}`;
        return `<div class="bs-status-ribbon-seg tone-${meta.tone}" style="flex:${pct} 0 0;" title="${esc(title)}"></div>`;
      }).join("");
      el.statusRibbonRange.textContent = `${fmtDateTimeWib(ascending[0].timestamp)} \u2192 sekarang`;
    } else {
      el.statusRibbon.innerHTML = `<div class="bs-status-ribbon-seg tone-unknown" style="flex:1 0 0;"></div>`;
      el.statusRibbonRange.textContent = "";
    }

    renderLogList();
  }

  // Menggambar ulang HANYA daftar log (dipakai baik oleh filter
  // legend maupun tombol "tampilkan semua"), tanpa menghitung ulang
  // ribbon dari awal.
  function renderLogList() {
    const ascending = state.lastTransitions;
    if (!ascending.length) return;
    const filter = state.transitionFilter;
    const descendingAll = ascending.slice().reverse();
    // "charging"/"discharging"/"idle" pada legend cocok dengan status
    // BARU (newStatus) dari tiap entri log — itu status yang sedang
    // berjalan setelah transisi itu terjadi.
    const filtered = filter ? descendingAll.filter((tr) => String(tr.newStatus || "").toLowerCase() === filter) : descendingAll;

    if (filter) {
      const meta = statusMeta(filter);
      el.logFilterBar.style.display = "flex";
      el.logFilterLabel.innerHTML = `Menampilkan log <b>${esc(meta.label)}</b> \u2014 ${filtered.length} kejadian`;
    } else {
      el.logFilterBar.style.display = "none";
    }

    if (!filtered.length) {
      el.logList.innerHTML = `<div class="bs-empty-inline">Belum ada kejadian untuk status ini.</div>`;
      el.logMoreBtn.style.display = "none";
      return;
    }

    const LIMIT = 6;
    const visible = state.transitionsExpanded ? filtered : filtered.slice(0, LIMIT);

    el.logList.innerHTML = visible.map((tr) => {
      const meta = statusMeta(String(tr.newStatus || "").toLowerCase());
      return `
      <div class="bs-timeline-item">
        <div class="bs-timeline-left">
          <span class="bs-timeline-dot tone-${meta.tone}"></span>
          <span class="bs-timeline-transition">${esc(tr.previousStatus)}<span class="bs-timeline-arrow">\u2192</span>${esc(tr.newStatus)}</span>
        </div>
        <span class="bs-timeline-time">${fmtDateTimeWib(tr.timestamp)}</span>
      </div>`;
    }).join("");

    if (filtered.length > LIMIT) {
      el.logMoreBtn.style.display = "";
      el.logMoreBtn.textContent = state.transitionsExpanded ? "Tampilkan lebih sedikit" : `Tampilkan semua (${filtered.length})`;
    } else {
      el.logMoreBtn.style.display = "none";
    }
  }


  function renderDetail() {
    const battery = getDetailBattery();
    if (!battery) { showListView(); return; }
    // __telemetrySource sudah selalu diisi oleh getCombinedBatteries()/
    // buildVirtualBattery() dari deviceId (FK asli) — tidak ada lagi
    // kolom telemetry_source terpisah di tabel batteries untuk di-fallback.
    if (!battery.__telemetrySource) {
      const meta = window.BR_getBattery(battery.id);
      battery.__telemetrySource = meta && meta.deviceId ? `device:${meta.deviceId}` : null;
    }

    renderHeader(battery);
    renderOperational(battery);
    renderCharts(battery);
    renderEnergy(battery);
    renderTransitions(battery);
  }

  // =============================
  // EDIT MODAL — identity only (name/brand/model/serialNumber).
  // There is no Add/Register flow anymore: batteries can only be
  // edited once they already exist in the DB. There is no Add/Create
  // nor Delete flow here — Battery Station is Read + Update only.
  // =============================
  function clearFormErrors() {
    [["errName", "fieldName"], ["errBrand", "fieldBrand"], ["errModel", "fieldModel"], ["errSerial", "fieldSerial"]].forEach(([errKey, fieldKey]) => {
      el[errKey].style.display = "none";
      el[errKey].textContent = "";
      el[fieldKey].classList.remove("is-invalid");
    });
  }

  function showFormErrors(errors) {
    const map = {
      name: ["errName", "fieldName"], brand: ["errBrand", "fieldBrand"], model: ["errModel", "fieldModel"],
      serialNumber: ["errSerial", "fieldSerial"],
    };
    Object.keys(errors).forEach((key) => {
      const pair = map[key];
      if (!pair) return;
      el[pair[0]].textContent = errors[key];
      el[pair[0]].style.display = "";
      el[pair[1]].classList.add("is-invalid");
    });
  }

  function openEditModal(batteryId) {
    // Registered batteries live in BR_getBattery() (Postgres cache).
    // Virtual (VPS-discovered, not-yet-registered) cards only exist
    // in state.combined — fall back there so the pencil also works
    // for "From VPS — identity not registered yet" cards.
    const registeredMeta = window.BR_getBattery(batteryId);
    const combined = state.combined.find((b) => b.id === batteryId);
    if (!registeredMeta && !combined) return;

    const isVirtual = !!(combined && combined.__virtual);
    state.formEditingId = batteryId;
    state.formEditingDeviceId = isVirtual ? combined.__deviceId : null;
    clearFormErrors();

    const meta = registeredMeta || combined.metadata;
    el.fieldName.value = meta.name || "";
    el.fieldBrand.value = meta.brand || "";
    el.fieldModel.value = meta.model || "";
    el.fieldSerial.value = meta.serialNumber || "";

    if (el.formTitle) {
      el.formTitle.innerHTML = isVirtual
        ? '<i class="fa-solid fa-pen"></i> Add Battery Identity'
        : '<i class="fa-solid fa-pen"></i> Edit Battery';
    }
    if (el.formDesc) {
      el.formDesc.textContent = isVirtual
        ? "This device was found automatically from VPS and has no identity yet. Fill in its details below \u2014 telemetry (status, SoC, voltage, etc.) is never edited here, it always comes from the assigned device."
        : "Update this battery's identity. Telemetry (status, SoC, voltage, etc.) is never edited here \u2014 it always comes from the assigned device.";
    }
    if (el.formSubmitBtnText) {
      el.formSubmitBtnText.textContent = isVirtual ? "Save Identity" : "Save Changes";
    }

    el.formOverlay.classList.add("is-visible");
    el.fieldName.focus();
  }

  function closeFormModal() {
    el.formOverlay.classList.remove("is-visible");
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    clearFormErrors();
    const payload = {
      name: el.fieldName.value,
      brand: el.fieldBrand.value,
      model: el.fieldModel.value,
      serialNumber: el.fieldSerial.value,
    };

    let isVirtual = !!state.formEditingDeviceId;
    let result = isVirtual
      ? await window.BR_createBattery(state.formEditingDeviceId, payload)
      : await window.BR_updateBattery(state.formEditingId, payload);

    // Safety net: this card looked unregistered when the modal
    // opened, but the device already has a real row by the time the
    // request reached the server (stale view — e.g. another tab, or
    // a slow refresh after reloadCombined()'s fix landed). Rather
    // than blocking the rename with a confusing "device already has
    // 2 batteries registered" error, fall back to updating the
    // device's existing battery — a rename should never be this
    // hard for the user.
    if (!result.ok && isVirtual && result.code === "DEVICE_SLOTS_FULL") {
      const existing = window.BR_getBatteryByDeviceId(state.formEditingDeviceId);
      if (existing) {
        isVirtual = false;
        result = await window.BR_updateBattery(existing.id, payload);
      }
    }

    if (!result.ok) {
      showFormErrors(result.errors || {});
      return;
    }

    // A virtual card (id "vps:<deviceId>") disappears once it has a
    // real `batteries` row — swap the detail view to the new real id
    // so it doesn't get stranded on an id that no longer exists.
    // Compare ids directly (rather than trusting the `isVirtual` flag)
    // so this also covers the DEVICE_SLOTS_FULL fallback above, where
    // the submit started as a "create" but ended up updating a
    // different, already-existing battery id.
    const wasDetailingThisCard = state.view === "detail" && state.detailBatteryId === state.formEditingId;
    const idChanged = result.battery && result.battery.id !== state.formEditingId;

    closeFormModal();
    reloadCombined();

    if (wasDetailingThisCard && idChanged) {
      state.detailBatteryId = result.battery.id;
    }

    if (state.view === "list") { renderOverview(); renderBatteryGrid(); }
    else if (state.view === "detail") { renderDetail(); }
    showToast(isVirtual ? "Battery identity saved." : "Battery updated.");
  }

  // =============================
  // Events
  // =============================
  let eventsBound = false;
  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    bindGridEvents();
    el.backBtn.addEventListener("click", showListView);

    el.statusFilter.addEventListener("change", (e) => {
      state.statusFilter = e.target.value;
      renderBatteryGrid();
    });

    el.refreshDetailBtn.addEventListener("click", async () => {
      el.refreshDetailBtn.classList.add("is-loading");
      el.refreshDetailBtn.disabled = true;
      await ensureTelemetryLoaded(true); // forceFresh -- selalu tarik VPS terbaru & perbarui cache
      reloadCombined();
      renderDetail();
      el.refreshDetailBtn.classList.remove("is-loading");
      el.refreshDetailBtn.disabled = false;
    });

    el.trendTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".bs-tab");
      if (!btn || btn.classList.contains("is-disabled")) return;
      state.trendRange = btn.dataset.range;
      el.trendTabs.querySelectorAll(".bs-tab").forEach((b) => b.classList.toggle("is-active", b === btn));
      const battery = getDetailBattery();
      if (battery) { renderCharts(battery); }
    });

    // ---------- Range slider (geser manual) ----------
    function onSliderInput() {
      if (!state.chartFullSeries) return;
      let minV = Number(el.rangeSliderMin.value);
      let maxV = Number(el.rangeSliderMax.value);
      if (minV > maxV) { [minV, maxV] = [maxV, minV]; }
      state.rangeWindow = { startIdx: minV, endIdx: maxV };
      drawChartsForWindow();
    }
    el.rangeSliderMin.addEventListener("input", onSliderInput);
    el.rangeSliderMax.addEventListener("input", onSliderInput);

    // ---------- Manual date entry — Apply always fetches fresh from
    // the backend for the exact window picked; Reset discards a
    // custom range and reverts to the active preset tab. ----------
    el.rangeApplyBtn.addEventListener("click", () => {
      const fromMs = el.rangeFrom.value ? new Date(el.rangeFrom.value).getTime() : NaN;
      const toMs = el.rangeTo.value ? new Date(el.rangeTo.value).getTime() : NaN;
      if (isNaN(fromMs) || isNaN(toMs)) return;
      applyCustomRange(fromMs, toMs);
    });
    el.rangeResetBtn.addEventListener("click", () => {
      resetToPresetRange();
    });

    el.logMoreBtn.addEventListener("click", () => {
      state.transitionsExpanded = !state.transitionsExpanded;
      renderLogList();
    });

    el.statusLegend.addEventListener("click", (e) => {
      const btn = e.target.closest(".bs-status-legend-item");
      if (!btn) return;
      const status = btn.dataset.status;
      state.transitionFilter = (state.transitionFilter === status) ? null : status;
      state.transitionsExpanded = false;
      el.statusLegend.querySelectorAll(".bs-status-legend-item").forEach((b) => b.classList.toggle("is-active", b === btn && state.transitionFilter));
      renderLogList();
    });
    el.logFilterClearBtn.addEventListener("click", () => {
      state.transitionFilter = null;
      state.transitionsExpanded = false;
      el.statusLegend.querySelectorAll(".bs-status-legend-item").forEach((b) => b.classList.remove("is-active"));
      renderLogList();
    });

    el.chartGrid.addEventListener("click", (e) => {
      const retryChartsBtn = e.target.closest("[data-action='retry-charts']");
      if (retryChartsBtn) {
        const battery = getDetailBattery();
        if (battery) renderCharts(battery);
        return;
      }
      const retryCustomBtn = e.target.closest("[data-action='retry-custom-range']");
      if (retryCustomBtn) {
        if (state.lastCustomRange) applyCustomRange(state.lastCustomRange.startMs, state.lastCustomRange.endMs);
        return;
      }
      const card = e.target.closest(".bs-chart-card");
      if (!card) return;
      openChartModal(card.dataset.metric);
    });
    el.chartModalCloseBtn.addEventListener("click", closeChartModal);
    el.chartModalOverlay.addEventListener("click", (e) => { if (e.target === el.chartModalOverlay) closeChartModal(); });

    el.formCancelBtn.addEventListener("click", closeFormModal);
    el.form.addEventListener("submit", handleFormSubmit);
    el.formOverlay.addEventListener("click", (e) => { if (e.target === el.formOverlay) closeFormModal(); });

  }

  function renderTrendTabs() {
    el.trendTabs.innerHTML = `
      <button class="bs-tab is-active" type="button" data-range="today">Today</button>
      <button class="bs-tab" type="button" data-range="last7Days">Last 7 Days</button>
      <button class="bs-tab" type="button" data-range="lastMonth">Last Month</button>`;
  }

  // =============================
  // Per-project telemetry cache — SAMA POLA dengan
  // window.__siLoadedProjectIds di system-information.js: VPS
  // discovery + telemetry/latest + telemetry/history (bagian PALING
  // berat di halaman ini, beberapa round-trip per device) di-fetch
  // SEKALI PER PROYEK PER SESI, bukan diulang tiap kali balik ke
  // project yang sama. Project baru -> fetch normal (loadTelemetry());
  // balik lagi ke project yang sudah pernah dibuka sesi ini -> langsung
  // pakai cache, instan — inilah yang bikin System Information terasa
  // "responsif" saat gonta-ganti project, sebelumnya Battery Station
  // tidak punya ini sama sekali (selalu fetch ulang dari nol).
  //
  // Disimpan di window (bukan closure lokal) supaya bertahan walau
  // project-monitoring.js membongkar-ulang DOM #pmPanel-battery saat
  // pindah tab / reload halaman Project Monitoring (lihat komentar
  // "reset cache lazy-load" di project-monitoring.js) — persis alasan
  // window.__siSystems juga disimpan di window, bukan closure.
  // =============================
  window.__bsLoadedTelemetryProjectIds = window.__bsLoadedTelemetryProjectIds || new Set();
  window.__bsTelemetryCacheByProject = window.__bsTelemetryCacheByProject || {};

  function cacheCurrentTelemetry() {
    window.__bsTelemetryCacheByProject[state.projectId] = {
      telemetryBySource: state.telemetryBySource,
      telemetryLabels: state.telemetryLabels,
      telemetryInverterTypes: state.telemetryInverterTypes,
      discoveryError: state.discoveryError,
      ongridOnly: state.ongridOnly,
      discoveredDevices: state.discoveredDevices,
    };
    window.__bsLoadedTelemetryProjectIds.add(state.projectId);
  }

  function restoreTelemetryFromCache() {
    const cached = window.__bsTelemetryCacheByProject[state.projectId];
    if (!cached) return false;
    state.telemetryBySource = cached.telemetryBySource;
    state.telemetryLabels = cached.telemetryLabels;
    state.telemetryInverterTypes = cached.telemetryInverterTypes || {};
    state.discoveryError = cached.discoveryError;
    state.ongridOnly = !!cached.ongridOnly;
    state.discoveredDevices = cached.discoveredDevices;
    return true;
  }

  // ensureTelemetryLoaded(forceFresh) — dipanggil boot() (forceFresh
  // false, boleh pakai cache) dan tombol "Refresh" di detail view
  // (forceFresh true, selalu tarik data terbaru dari VPS & perbarui
  // cache-nya juga supaya tab/detail lain ikut lihat data terbaru).
  async function ensureTelemetryLoaded(forceFresh) {
    if (!forceFresh && window.__bsLoadedTelemetryProjectIds.has(state.projectId)) {
      restoreTelemetryFromCache();
      return;
    }
    await loadTelemetry();
    cacheCurrentTelemetry();
  }

  // =============================
  // Init (called by js/project-monitoring.js after this page's HTML
  // has been injected into the "battery" tab panel)
  // =============================
  async function boot() {
    // Sama seperti system-information.js/task-management.js: kalau belum
    // ada proyek aktif tersimpan sama sekali (staff yang login langsung
    // tanpa pernah lewat Project Selector), JANGAN nebak fallback
    // "tawabi" -- itu bisa saja BUKAN project staff ini, dan sebelumnya
    // bikin Battery Station kosong/gagal buat staff project lain.
    // window.__siResolveActiveProjectId (system-information.js) yang
    // nentuin ini, supaya satu sumber kebenaran dipakai bareng-bareng
    // (dia juga yang nyimpen hasilnya balik ke PC_setActiveProject supaya
    // halaman lain ikut konsisten).
    const newProjectId = (typeof window.__siResolveActiveProjectId === "function")
      ? await window.__siResolveActiveProjectId()
      : (((typeof window.PC_getActiveProject === "function") ? window.PC_getActiveProject() : null)?.id || DEFAULT_PROJECT_ID);
    const active = (typeof window.PC_getActiveProject === "function") ? window.PC_getActiveProject() : null;
    // Sudah pernah sukses di-load buat project yang SAMA di sesi browser
    // ini (mis. user sempat pindah ke tab/halaman lain lalu balik lagi
    // ke Battery Station) -- render instan pakai data yang sudah ada,
    // JANGAN tampilkan loading bar penuh, cukup refresh data di
    // belakang layar (sama seperti dashboard.js/project-selector.js).
    // Sebelumnya boot() SELALU fetch ulang dari nol tiap kali tab ini
    // dibuka, walau project & data-nya sama persis dengan kunjungan
    // sebelumnya.
    const isSameProjectAsLastLoad = state.loaded && state.loadedProjectId === newProjectId;

    state.projectId = newProjectId;
    state.projectName = (active && active.name) ? active.name : (state.projectId === "tawabi" ? "Tawabi" : state.projectId);
    // Telemetry VPS sekarang dicoba untuk PROJECT AKTIF APA PUN (Tawabi,
    // Kasdam, PUT, dst) — bukan cuma Tawabi. Kalau projectnya memang
    // tidak ada di VPS / tidak punya device, itu ditangani sebagai
    // discoveryError biasa (lihat describeDiscoveryError()), bukan lagi
    // dimatikan total di awal lewat flag ini.
    state.telemetryEnabled = true;

    renderTrendTabs();

    const loadingContainer = document.getElementById("pmPanel-battery") || document.getElementById("bsRoot");

    if (isSameProjectAsLastLoad) {
      reloadCombined();
      showListView();
      if (window.EdashUpdatingBanner) {
        window.EdashUpdatingBanner.show(loadingContainer, "battery-station", "Memperbarui data battery...");
      }
    } else if (window.EdashLoadingBar) {
      window.EdashLoadingBar.show(loadingContainer, "battery-station", "loading.battery");
    }

    try {
      // BUG FIX (2026-08-31): "tawabi" is a LOCAL routing alias, not a
      // real backend project id — discovery (BVD_discoverDevicesForActiveProject)
      // knows how to resolve it into the real Postgres project UUID
      // internally, and stamps that real UUID onto every discovered
      // device's `.projectId`, but that resolution was never carried
      // back up to `state.projectId` itself. That meant
      // BR_loadBatteries(state.projectId) was calling
      // GET /batteries?projectId=tawabi — a param the `batteries`
      // JOIN can never match — so for Tawabi specifically the
      // frontend could NEVER see its own already-registered
      // batteries, no matter how many real rows existed. Every
      // "name this battery" click therefore always went through
      // createBattery() instead of updateBattery(), silently
      // stacking duplicate rows against the same device on every
      // attempt until DEVICE_SLOTS_FULL. (Kasdam never hit this
      // because its local project id already IS the real UUID —
      // only "tawabi" gets the alias treatment.)
      //
      // Fix: resolve telemetry/discovery FIRST (this is what
      // actually knows the real backend id), then fetch batteries
      // using the REAL id discovery found — never the raw
      // state.projectId alias. This can no longer run in parallel
      // with discovery (it depends on discovery's result now), but
      // discovery is a single request either way, so this costs one
      // extra network round-trip at most, not a real slowdown.
      await ensureTelemetryLoaded(false);
      state.backendProjectId = (state.discoveredDevices[0] && state.discoveredDevices[0].projectId) || state.projectId;
      await window.BR_loadBatteries(state.backendProjectId);
      reloadCombined();
      state.loaded = true;
      state.loadedProjectId = state.projectId;
      showListView();
    } catch (e) {
      console.warn("[battery-station] Gagal memuat data battery:", e);
    } finally {
      if (isSameProjectAsLastLoad && window.EdashUpdatingBanner) {
        window.EdashUpdatingBanner.hideOk(loadingContainer, "battery-station");
      }
      if (!isSameProjectAsLastLoad && window.EdashLoadingBar) {
        window.EdashLoadingBar.done(loadingContainer, "battery-station");
      }
    }
  }

  window.initBatteryStation = function () {
    cacheEls();
    bindEvents();
    boot();
  };

  window.__bsRefresh = function () {
    if (!document.getElementById("bsRoot")) return;
    window.initBatteryStation();
  };
  document.addEventListener("edash:activeprojectchange", () => { window.__bsRefresh(); });

  // Test hooks (prefixed __ — internal only, used by the Node smoke
  // test in this repo's dev workflow, not part of the public API).
  window.__BS_TEST_computeOverview = computeOverview;

})();