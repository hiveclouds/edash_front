/* ============================================================
   Battery Repository — 360eDash
   ------------------------------------------------------------
   PHASE 3 — SKEMA DISAMAKAN DENGAN TABEL ASLI BACKEND (2026-08-25):
   Tabel `batteries` yang sebenarnya sudah dibuat & dipakai tim
   backend TIDAK punya project_id/battery_no/telemetry_source seperti
   asumsi Phase 2 sebelumnya. Skema asli memakai device_id (FK ke
   `devices`, wajib diisi) + battery_index (1 atau 2, wajib diisi,
   maksimal 2 baterai per device) + current_status/capacity_kwh/
   nominal_voltage_v. File ini ditulis ulang supaya field yang
   dikirim/diterima cocok PERSIS dengan tabel itu — lihat
   API_DOCUMENTATION.md & db/schema.ts di edashboard_api untuk kontrak
   resminya.

   SCOPE:
     1. REGISTERED BATTERIES — user-managed identity/metadata
        (Name, Brand, Model, Serial Number only). Backed oleh tabel
        `batteries` di Postgres lewat window.edashApiFetch()
        (js/api-config.js). CRUD di Battery Station: Read + Update
        (edit identitas baterai yang sudah ada barisnya) PLUS satu
        Create yang dibatasi ketat — hanya untuk menempelkan identitas
        ke device VPS yang sudah nyata terdeteksi tapi belum punya
        baris (kartu "From VPS — identity not registered yet"); tidak
        ada form tambah baterai bebas maupun Deactivate/Delete dari UI
        ini. deviceId/batteryIndex baterai yang sudah ada di DB tetap
        dipakai apa adanya untuk pencocokan telemetry; battery_index
        baterai baru di-assign otomatis oleh server, tidak pernah
        dipilih manual (lihat createBattery() di bawah).
     2. STATUS TRANSITIONS — masih localStorage-only untuk observasi
        sisi klien (lihat battery-telemetry-adapter.js); tabel
        `battery_status_transitions` yang sebenarnya sudah ada di
        backend TAPI belum ada endpoint publik untuk menulis/membaca
        dari sana lewat Core API, jadi bagian ini tetap seperti
        sebelumnya sampai endpoint itu tersedia.

   ASYNC CONTRACT: BR_updateBattery tetap async dan HARUS di-await
   oleh pemanggil (lihat battery-station.js). Reads
   (BR_getCombinedBatteries / BR_getBattery) tetap SYNCHRONOUS —
   membaca dari cache in-memory yang diisi oleh
   window.BR_loadBatteries(projectId), yang di-await sekali oleh
   battery-station.js saat boot() (dan otomatis lagi setelah setiap
   update berhasil).

   Naming: BR_* (Battery Repository), sesuai semua call site yang
   sudah ada di js/battery-station.js.
============================================================= */

(function () {

  const LS_STATUS_HISTORY = "edash-battery-status-history";
  const MAX_HISTORY_SAMPLES = 500; // per battery, oldest samples dropped first

  // In-memory cache of the currently loaded project's batteries
  // (backend sudah men-scope lewat JOIN devices/systems -> projectId
  // di GET /batteries?projectId=..., lihat db/schema.ts
  // Repository.listBatteries()).
  let cache = [];
  let cacheProjectId = null;

  // =============================
  // localStorage helpers (status transition history only — see
  // file header §2)
  // =============================
  function safeParse(raw, fallback) {
    try {
      const v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function loadStatusHistory() {
    return safeParse(localStorage.getItem(LS_STATUS_HISTORY), {});
  }
  function saveStatusHistory(map) {
    try {
      localStorage.setItem(LS_STATUS_HISTORY, JSON.stringify(map));
    } catch (e) {
      console.error("[battery-repository] Gagal menyimpan status history ke localStorage:", e);
    }
  }

  function trim(v) {
    return (v === null || v === undefined) ? "" : String(v).trim();
  }

  // Backend returns raw Postgres rows (snake_case). Map once here so
  // the rest of this file (and battery-station.js) only ever deals
  // with one consistent camelCase shape.
  function mapRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      deviceId: row.device_id !== undefined ? row.device_id : row.deviceId,
      batteryIndex: row.battery_index !== undefined ? row.battery_index : row.batteryIndex,
      name: row.name,
      brand: row.brand,
      model: row.model,
      serialNumber: row.serial_number !== undefined ? row.serial_number : row.serialNumber,
      currentStatus: (row.current_status !== undefined ? row.current_status : row.currentStatus) || null,
      capacityKwh: row.capacity_kwh !== undefined ? row.capacity_kwh : row.capacityKwh,
      nominalVoltageV: row.nominal_voltage_v !== undefined ? row.nominal_voltage_v : row.nominalVoltageV,
      active: row.active !== undefined ? !!row.active : true,
      createdAt: row.created_at !== undefined ? row.created_at : row.createdAt,
      updatedAt: row.updated_at !== undefined ? row.updated_at : row.updatedAt,
    };
  }

  // Map an edashApiFetch() rejection (Error with .code/.message set
  // by api-config.js from the backend's { success:false, error } body)
  // to the same { field: message } shape the form's showFormErrors()
  // already knows how to render.
  function mapApiError(e) {
    if (e && e.code === "DUPLICATE_SERIAL_NUMBER") {
      return { serialNumber: e.message || "Serial Number ini sudah dipakai baterai lain." };
    }
    if (e && e.code === "DEVICE_SLOTS_FULL") {
      return { name: e.message || "Device ini sudah punya 2 baterai terdaftar." };
    }
    if (e && e.code === "VALIDATION_ERROR") {
      return { name: e.message || "Data yang dikirim tidak valid." };
    }
    return { name: (e && e.message) || "Gagal menyimpan baterai ke server." };
  }

  // =============================
  // Load / cache — must be awaited before any BR_get* call is
  // expected to see fresh data (battery-station.js's boot() does
  // this; reloadCombined() itself stays synchronous).
  // =============================
  async function loadBatteries(projectId) {
    try {
      const list = await window.edashApiFetch(`/batteries?projectId=${encodeURIComponent(projectId)}`) || [];
      cache = list.map(mapRow);
      cacheProjectId = projectId;
    } catch (e) {
      console.warn("[battery-repository] Gagal memuat batteries dari API:", e.message);
      cache = [];
      cacheProjectId = projectId;
    }
    return cache;
  }

  // =============================
  // CRUD — registered battery metadata (Postgres)
  // =============================
  function getBattery(id) {
    if (!id) return null;
    return cache.find((b) => b.id === id) || null;
  }

  // Update identity of an already-registered battery. Only Name is
  // required — Brand/Model/Serial Number are optional. They are
  // always sent (even when blank) so that clearing a field in the
  // form and saving actually clears it on the server too (the API
  // stores a blank Brand/Model/Serial Number as NULL rather than
  // rejecting it — see battery.service.ts update()).
  // device_id & battery_index TIDAK bisa diubah lewat update (slot
  // fisik baterai dikunci saat registrasi) — sama seperti field
  // Device/Slot yang disembunyikan di form Edit (battery-station.js).
  async function updateBattery(id, payload) {
    const errors = {};
    const name = trim(payload && payload.name);
    const brand = trim(payload && payload.brand);
    const model = trim(payload && payload.model);
    const serial = trim(payload && payload.serialNumber);

    if (!name) errors.name = "Battery Name wajib diisi.";
    else if (name.length > 255) errors.name = "Battery Name maksimal 255 karakter.";
    if (Object.keys(errors).length) return { ok: false, errors };

    const body = { name, brand, model, serialNumber: serial };

    try {
      const updated = await window.edashApiFetch(`/batteries/${id}`, { method: "PUT", body: JSON.stringify(body) });
      await loadBatteries(cacheProjectId);
      return { ok: true, battery: mapRow(updated) };
    } catch (e) {
      return { ok: false, errors: mapApiError(e) };
    }
  }

  // Menempelkan identitas (Name/Brand/Model/Serial) ke device yang
  // SUDAH ditemukan nyata lewat VPS discovery tapi belum punya baris
  // di tabel `batteries` ("From VPS — identity not registered yet" di
  // Battery Station). Ini BUKAN form tambah baterai baru bebas —
  // deviceId wajib berasal dari device VPS yang sudah ada
  // (battery.__deviceId), dan slot fisiknya (battery_index) di-assign
  // OTOMATIS oleh server (lihat battery.service.ts create()), tidak
  // pernah dipilih manual di form ini.
  async function createBattery(deviceId, payload) {
    const errors = {};
    if (!deviceId) {
      errors.name = "Device VPS untuk baterai ini tidak ditemukan.";
      return { ok: false, errors };
    }

    const name = trim(payload && payload.name);
    const brand = trim(payload && payload.brand);
    const model = trim(payload && payload.model);
    const serial = trim(payload && payload.serialNumber);

    if (!name) errors.name = "Battery Name wajib diisi.";
    else if (name.length > 255) errors.name = "Battery Name maksimal 255 karakter.";
    if (Object.keys(errors).length) return { ok: false, errors };

    const body = { deviceId, name, brand, model, serialNumber: serial };

    try {
      const created = await window.edashApiFetch(`/batteries`, { method: "POST", body: JSON.stringify(body) });
      await loadBatteries(cacheProjectId);
      return { ok: true, battery: mapRow(created) };
    } catch (e) {
      // code is surfaced (not just the mapped message) so callers can
      // react to DEVICE_SLOTS_FULL specifically — see
      // battery-station.js's handleFormSubmit(), which uses this to
      // fall back to updating the device's existing registered
      // battery instead of hard-failing a rename whenever the UI's
      // cached "is this still unregistered?" view was stale.
      return { ok: false, errors: mapApiError(e), code: e && e.code };
    }
  }

  // Find the (first) active registered battery already pointing at a
  // given device. Used as a fallback when a rename was submitted
  // against a placeholder card that turned out to already have a
  // real row by the time the request reached the server (stale
  // view) — see battery-station.js's handleFormSubmit().
  function getBatteryByDeviceId(deviceId) {
    if (!deviceId) return null;
    return cache.find((b) => b.active && b.deviceId === deviceId) || null;
  }

  // =============================
  // Status transitions (see file header §2) — unchanged, still
  // localStorage-backed since there is no public Core API endpoint
  // for battery_status_transitions yet.
  // =============================
  function recordStatusSample(batteryId, status, timestampIso) {
    if (!batteryId || status === null || status === undefined) return;
    const map = loadStatusHistory();
    const arr = Array.isArray(map[batteryId]) ? map[batteryId] : [];
    const last = arr[arr.length - 1];
    if (last && last.status === status) return; // unchanged — do not spam samples every poll
    arr.push({ status, timestamp: timestampIso || new Date().toISOString() });
    if (arr.length > MAX_HISTORY_SAMPLES) arr.splice(0, arr.length - MAX_HISTORY_SAMPLES);
    map[batteryId] = arr;
    saveStatusHistory(map);
  }

  function getBatteryTransitions(batteryId) {
    const map = loadStatusHistory();
    const history = Array.isArray(map[batteryId]) ? map[batteryId] : [];
    if (typeof window.BTA_deriveTransitionsFromHistory === "function") {
      return window.BTA_deriveTransitionsFromHistory(history, batteryId);
    }
    return [];
  }

  // =============================
  // Combined model — metadata (this file, Postgres-backed) + live
  // telemetry (passed in by battery-station.js from
  // battery-telemetry-adapter.js / battery-vps-discovery.js). This
  // is the ONLY place battery-station.js is allowed to read a merged
  // battery object from.
  //
  // telemetrySource key ("device:<deviceId>") sekarang diturunkan
  // langsung dari deviceId (FK asli), bukan lagi kolom terpisah di
  // tabel batteries.
  // =============================
  function getCombinedBatteries(projectId, telemetryBySource) {
    telemetryBySource = telemetryBySource || {};
    const list = cache; // sudah discoping server-side lewat loadBatteries(projectId)

    return list.map((b) => {
      const key = b.deviceId ? `device:${b.deviceId}` : null;
      const telemetry = key ? (telemetryBySource[key] || null) : null;
      if (telemetry && telemetry.status) {
        recordStatusSample(b.id, telemetry.status, telemetry.lastUpdated);
      }
      return {
        id: b.id,
        batteryIndex: b.batteryIndex || null,
        metadata: {
          name: b.name,
          brand: b.brand,
          model: b.model,
          serialNumber: b.serialNumber,
        },
        telemetry,
        source: { metadata: "postgres", telemetry: telemetry ? (telemetry.__source || "vps") : "none" },
        active: b.active,
        __telemetrySource: key,
        __deviceId: b.deviceId || null,
        __batteryIndex: b.batteryIndex || null,
      };
    });
  }

  window.BR_loadBatteries = loadBatteries;
  window.BR_getCombinedBatteries = getCombinedBatteries;
  window.BR_getBattery = getBattery;
  window.BR_getBatteryByDeviceId = getBatteryByDeviceId;
  window.BR_updateBattery = updateBattery;
  window.BR_createBattery = createBattery;
  window.BR_getBatteryTransitions = getBatteryTransitions;

})();