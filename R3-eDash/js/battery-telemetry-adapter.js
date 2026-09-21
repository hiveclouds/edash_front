/* ============================================================
   Battery Telemetry Adapter — 360eDash
   ------------------------------------------------------------
   VPS INTEGRATION. Owns TELEMETRY only (never metadata — see
   js/battery-repository.js for Name/Brand/Model/Serial Number,
   which is still localStorage-only, see that file's header for
   why: no CRUD endpoint exists on the backend yet for battery
   metadata — confirmed BACKEND GAP, not something this file can
   fix from the frontend).

   Reads REAL telemetry from the VPS Core API via
   window.edashApiFetch() (js/api-config.js):
     GET /devices/:id/telemetry/latest
     GET /devices/:id/telemetry/history?startTs=&endTs=
   (API_DOCUMENTATION.md §4.3 / §4.5, per
   DOKUMENTASI_API_eDASHBOARD_360ENERGY.html — the unified doc that
   now covers all projects, Tawabi/Kasdam/PUT alike). Both endpoints
   are documented "Akses: Authenticated" — any logged-in role
   (Admin360/Operator/Viewer), NOT Admin360-only. Admin360 is only
   required for device REGISTRATION/listing (POST /devices, GET
   /devices/inverters[/by-provider], §4.1/§4.2) — a previous version
   of this file's comment incorrectly said all of /devices/* needs
   Admin360, which battery-station.js's describeDiscoveryError() then
   surfaced as a misleading "login with an Admin360 account" message
   on ANY 403 here. A 403 on telemetry itself should instead be
   treated as a genuine, unexpected error (see describeDiscoveryError
   in js/battery-station.js).

   HISTORY RANGES — real backend fetch per range, not client-side
   zoom. getStationTelemetry() (the function that runs for every
   discovered device during the initial list load) fetches ONLY
   telemetry/latest — same cadence as system-information.js's
   loadOneTawabiCard(). History (today/last7Days/lastMonth) is
   deliberately NOT prefetched there; it is lazy-loaded on demand by
   loadHistoryForRange(), triggered only when the user opens a
   battery's detail view or switches range tab (mirrors
   system-information.js's ensureTawabiChartData()/
   ensureTawabiRangeData(), called from showDetailView()) — then
   cached per device+range so switching back doesn't re-fetch.
   (2026-08-26: this briefly eagerly prefetched all three ranges
   for every device at list-load time so every tab's chart would
   already be cached by the time the list appeared. In practice that
   meant N devices x 4 concurrent requests firing at once, which was
   enough to make the VPS start timing out even on the plain
   telemetry/latest calls — turning a single slow chart tab into the
   whole battery list failing to load. Reverted to the
   system-information.js cadence below.) Every history fetch failure
   — eager or on-demand — is both console.error-logged AND recorded
   in entry.historyErrors[rangeKey] (see getHistoryErrorForSource()),
   so "no data for this range" and "the request for this range
   failed" are never shown to the user as the same thing. The custom
   date/time picker (bsRangeFrom/bsRangeTo + "Terapkan") always goes
   through loadHistoryForCustomRange(), which calls the VPS history
   endpoint fresh with the exact startTs/endTs the user picked — it
   is NOT a client-side slice of an already-loaded window, is NEVER
   cached, and THROWS on failure instead of swallowing the error
   into a `null` return, so battery-station.js's applyCustomRange()
   can log and show the real reason a chosen date range didn't load.

   No static JSON is read anymore. No endpoint is invented. Fields
   this file does NOT populate (minTemperature, maxTemperature,
   totalCharged, totalDischarged, bmsChargeVoltage,
   bmsDischargeVoltage) are NOT part of the documented
   `battery.*` object returned by the VPS — they stay null on
   purpose rather than being guessed/mapped from something else.
   Same for status transition history: there is no VPS endpoint
   exposing battery_status_transitions, so
   getTransitionsForSource() always returns [].

   Naming: BTA_* (Battery Telemetry Adapter) — kept identical to
   the previous (JSON-based) version so js/battery-station.js does
   not need to change its call sites, only what "source" means
   (now "device:<deviceId>" instead of "<siteId>:<batteryNo>").
============================================================= */

(function () {

  const RANGE_MS = {
    today: 24 * 60 * 60 * 1000,          // 1 day
    last7Days: 7 * 24 * 60 * 60 * 1000,  // 7 days
    lastMonth: 30 * 24 * 60 * 60 * 1000, // 30 days ("last month" as a rolling window)
  };

  // BATTERY_KEYS — the 8 Rev3 `battery.*` variables this page actually
  // renders (voltage, current, power, soc, soh, dailyCharge,
  // dailyDischarge, status — see Bab 4 "Daftar Lengkap Variabel Rev3"
  // in Laporan_Optimasi_Telemetry_API.pdf). Sent as `keys=` on every
  // /telemetry/latest and /telemetry/history call below so the
  // backend's Key Resolver only pulls these registers instead of all
  // 57, per the report's Battery Station acceptance criteria. Do not
  // add non-battery keys here — this page has no use for them.
  const BATTERY_KEYS = [
    "battery.voltage",
    "battery.current",
    "battery.power",
    "battery.soc",
    "battery.soh",
    "battery.dailyCharge",
    "battery.dailyDischarge",
    "battery.status",
  ].join(",");

  // isFiniteNum(v) -> true only for an already-numeric, finite value.
  // Used by callers (battery-station.js's fmtDash) that expect
  // normalizeTelemetry() to have ALREADY coerced everything to real
  // numbers -- see toNum() below, which is what actually does that
  // coercion now.
  function isFiniteNum(v) { return typeof v === "number" && Number.isFinite(v); }

  // toNum(v) -> number | null. Coerces numeric-looking STRINGS too
  // ("51.2" -> 51.2), not just values that are already typeof
  // "number". BUG FIX (2026-08-26): the Rev3-normalized
  // battery.{voltage,current,power,soc,soh,dailyCharge,
  // dailyDischarge} fields are documented as `number` (§4.3/§7 of
  // DOKUMENTASI_API_eDASHBOARD_360ENERGY.html), but the backend's
  // normalization pipeline maps DIFFERENT raw registers per
  // provider (Solarman vs 360Energy, see the §7 dictionary) into
  // that same Rev3 shape -- and at least one project's device
  // (PLTS Gedung PUT PNJ) was observed sending these as numeric
  // STRINGS instead of JSON numbers. The old code only accepted
  // `typeof === "number"` and otherwise kept the raw (unusable)
  // value or fell through to null, so real numeric data silently
  // rendered as "–" downstream even though it existed. toNum()
  // accepts both shapes so no real device value gets dropped just
  // because of how one provider's data happens to be typed.
  function toNum(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // =============================
  // Telemetry model (same public contract as before)
  // =============================
  function emptyTelemetry() {
    return {
      status: null,
      soc: null,
      soh: null,
      voltage: null,
      current: null,
      power: null,
      minTemperature: null,
      maxTemperature: null,
      chargedToday: null,
      dischargedToday: null,
      totalCharged: null,
      totalDischarged: null,
      bmsChargeVoltage: null,
      bmsDischargeVoltage: null,
      lastUpdated: null,
      __source: "none",
    };
  }

  // normalizeTelemetry(latestData) -> Telemetry
  // latestData = the `data` object from GET /devices/:id/telemetry/latest
  // (i.e. { deviceId, provider, timestamp, lastSeen, battery: {...}, ... }).
  function normalizeTelemetry(latestData) {
    const t = emptyTelemetry();
    if (!latestData || !latestData.battery) return t;

    const b = latestData.battery;

    // Status normalized to lowercase to match STATUS_META keys in
    // battery-station.js (charging/discharging/idle) — case of the
    // real VPS value (e.g. "Charging" vs "charging") is not yet
    // confirmed live, so this normalization is defensive, not a
    // guess about the value itself.
    t.status = (b.status === null || b.status === undefined || b.status === "") ? null : String(b.status).toLowerCase();
    t.soc = toNum(b.soc);
    t.soh = toNum(b.soh);
    t.voltage = toNum(b.voltage);
    t.current = toNum(b.current);
    t.power = toNum(b.power);
    t.chargedToday = toNum(b.dailyCharge);
    t.dischargedToday = toNum(b.dailyDischarge);

    // NOT AVAILABLE from the VPS normalized battery object — left
    // null on purpose (see file header).
    t.minTemperature = null;
    t.maxTemperature = null;
    t.totalCharged = null;
    t.totalDischarged = null;
    t.bmsChargeVoltage = null;
    t.bmsDischargeVoltage = null;

    t.lastUpdated = latestData.timestamp || latestData.lastSeen || null;
    t.__source = "vps";
    return t;
  }

  // seriesFromHistory(historyData) -> { timestampsUtc, voltageV,
  //   socPct, currentA, powerKw } | null
  // historyData = the `data` object from GET
  // /devices/:id/telemetry/history?startTs=&endTs= (i.e.
  // { ..., telemetry: { battery: { voltage:[{ts,datetime,value}], ... } } }).
  function seriesFromHistory(historyData) {
    const battery = historyData && historyData.telemetry && historyData.telemetry.battery;
    if (!battery) return null;

    const voltage = Array.isArray(battery.voltage) ? battery.voltage : [];
    const soc = Array.isArray(battery.soc) ? battery.soc : [];
    const current = Array.isArray(battery.current) ? battery.current : [];
    const power = Array.isArray(battery.power) ? battery.power : [];

    // Pick whichever series actually has points to derive the shared
    // timeline from (they should all share the same timestamps, but
    // don't assume every field is always populated).
    const primary = voltage.length ? voltage : (soc.length ? soc : (current.length ? current : power));
    if (!primary.length) return null;

    const toIso = (pt) => pt.datetime || (isFiniteNum(pt.ts) ? new Date(pt.ts).toISOString() : null);
    const toNums = (arr) => arr.map((pt) => Number(pt.value));

    return {
      timestampsUtc: primary.map(toIso),
      voltageV: toNums(voltage),
      socPct: toNums(soc),
      currentA: toNums(current),
      powerKw: toNums(power),
    };
  }

  // =============================
  // Cache — one entry per "device:<deviceId>" source key.
  // entry.history[rangeKey] holds a fetched-once series for the
  // named preset ranges (today/last7Days/lastMonth); switching back
  // to an already-fetched tab reads from here instead of re-hitting
  // the backend. entry.historyErrors[rangeKey] holds the LAST error
  // that occurred while trying to fetch that range (null once a fetch
  // for that range has succeeded) — this is what lets
  // battery-station.js tell "genuinely no data for this range" apart
  // from "the VPS request for this range actually failed", which
  // used to look identical to the user (both showed the same "no
  // historical data" message) even though only one of them is
  // recoverable by just clicking the tab again.
  // Custom date/time ranges are NEVER cached here — see
  // loadHistoryForCustomRange() below — since an arbitrary window is
  // unlikely to be reselected verbatim and caching it would grow
  // unbounded.
  // =============================
  const cache = {}; // sourceKey -> { latest: Telemetry, history: { [rangeKey]: series|null }, historyErrors: { [rangeKey]: {message,code,status}|null } }

  function sourceKeyFor(deviceId) {
    return `device:${deviceId}`;
  }

  function deviceIdFromSource(telemetrySource) {
    return typeof telemetrySource === "string" ? telemetrySource.replace(/^device:/, "") : null;
  }

  function getCacheEntry(key) {
    return cache[key] || (cache[key] = { latest: null, history: {}, historyErrors: {} });
  }

  function toErrorInfo(e) {
    return { message: e && e.message ? e.message : "unknown error", code: (e && e.code) || null, status: e && e.status };
  }

  async function fetchHistoryWindow(deviceId, startTs, endTs) {
    const raw = await window.edashApiFetch(`/devices/${deviceId}/telemetry/history?keys=${BATTERY_KEYS}&startTs=${startTs}&endTs=${endTs}`);
    return seriesFromHistory(raw);
  }

  async function fetchHistoryRange(deviceId, rangeMs) {
    // FIX (disclaimer §5, poin 4): dulu "const endTs = Date.now();" --
    // milidetiknya selalu beda tiap kali dipanggil, jadi tiap request
    // preset range (Today/7D/30D) punya query string endTs yang unik ->
    // cache di backend TIDAK PERNAH kena hit (selalu MISS), padahal
    // isinya harusnya sama kalau masih di menit yang sama. Dibulatkan
    // ke kelipatan 1 menit (60000 ms), sama seperti fix yang sudah
    // diterapkan di system-information.js's fetchTawabiHistoryChart().
    const endTs = Math.floor(Date.now() / 60000) * 60000;
    const startTs = endTs - rangeMs;
    return fetchHistoryWindow(deviceId, startTs, endTs);
  }

  // getStationTelemetry(deviceId, deviceLabel) -> { bySource, raw }
  // "Station" naming kept for call-site compatibility with
  // js/battery-station.js; today this represents exactly one VPS
  // device (one battery per device — see BACKEND GAP note in the
  // handover doc: /telemetry/latest does not distinguish
  // battery_index 1 vs 2 on the same device).
  //
  // ONLY telemetry/latest is fetched here, for the SAME reason (and
  // the SAME cadence) as system-information.js's loadOneTawabiCard():
  // this is what runs for every discovered device, in parallel,
  // during the initial list load — so it has to stay light. History
  // (today/last7Days/lastMonth) is intentionally NOT prefetched here;
  // it is lazy-loaded on demand via loadHistoryForRange()/
  // loadHistoryForCustomRange() below, triggered only when the user
  // actually opens a battery's detail view or switches range tab —
  // exactly like system-information.js's ensureTawabiChartData()/
  // ensureTawabiRangeData(), called from showDetailView(), not from
  // the list-load Promise.all.
  //
  // (2026-08-26 history: this briefly ALSO eagerly prefetched all
  // three history ranges here, so every tab's chart would already be
  // cached by the time the list finished loading. That backfired in
  // practice — N devices x 4 concurrent requests (latest + 3 history
  // ranges) at once overloaded the VPS enough that even the plain
  // telemetry/latest calls started timing out, so the whole list
  // failed to load instead of just a chart tab. Reverted back to the
  // system-information.js cadence: keep the always-needed list load
  // cheap, push the heavy per-range history fetches out to the point
  // they're actually needed.)
  async function getStationTelemetry(deviceId, deviceLabel) {
    const key = sourceKeyFor(deviceId);
    const entry = getCacheEntry(key);

    const latestRaw = await window.edashApiFetch(`/devices/${deviceId}/telemetry/latest?keys=${BATTERY_KEYS}`);
    const latest = normalizeTelemetry(latestRaw);
    entry.latest = latest;

    return {
      bySource: { [key]: latest },
      raw: latestRaw,
    };
  }

  // loadHistoryForRange(telemetrySource, rangeKey) -> Promise<series|null>
  // On-demand fetch for a named preset range ("today" | "last7Days" |
  // "lastMonth"), called when the user opens a battery's detail view
  // (default tab) or clicks a different range tab — see renderCharts()
  // in battery-station.js, same trigger point as
  // system-information.js's ensureTawabiChartData()/
  // ensureTawabiRangeData() called from showDetailView(). Returns the
  // cached series immediately (still via a resolved Promise) if this
  // device+range was already fetched this session; otherwise calls the
  // VPS history endpoint for real and caches the result. This is what
  // makes the "Today"/"Last 7 Days"/"Last Month" tabs actually pull
  // different backend data instead of slicing one pre-fetched window,
  // while keeping each request scoped to one device+range at a time
  // instead of bursting every range for every device at once (see the
  // history note on getStationTelemetry() above for why that matters).
  async function loadHistoryForRange(telemetrySource, rangeKey) {
    const deviceId = deviceIdFromSource(telemetrySource);
    if (!deviceId) return null;
    const rangeMs = RANGE_MS[rangeKey];
    if (!rangeMs) return null;

    const entry = getCacheEntry(telemetrySource);
    if (entry.history[rangeKey]) return entry.history[rangeKey];

    try {
      const series = await fetchHistoryRange(deviceId, rangeMs);
      entry.history[rangeKey] = series;
      entry.historyErrors[rangeKey] = null;
      return series;
    } catch (e) {
      console.error(`[battery-telemetry-adapter] Gagal ambil history (${rangeKey}) untuk ${deviceId}:`, e.message, e);
      entry.history[rangeKey] = null;
      entry.historyErrors[rangeKey] = toErrorInfo(e);
      return null;
    }
  }

  // loadHistoryForCustomRange(telemetrySource, startMs, endMs) ->
  // Promise<series> — throws on failure (does NOT swallow the error
  // into a `null` return like before). A custom date/time window is a
  // deliberate, explicit user action (the "Terapkan"/Apply button) —
  // silently turning a real VPS failure into the same "no data" result
  // as a genuinely empty range is exactly the ambiguity that made this
  // hard to diagnose, so the caller (battery-station.js's
  // applyCustomRange()) now gets the real error and is responsible for
  // both logging it clearly and showing the user a message that's
  // distinguishable from "there's just no data here". Never cached,
  // never sliced from another range's data.
  async function loadHistoryForCustomRange(telemetrySource, startMs, endMs) {
    const deviceId = deviceIdFromSource(telemetrySource);
    if (!deviceId || !isFiniteNum(startMs) || !isFiniteNum(endMs)) return null;
    const startTs = Math.min(startMs, endMs);
    const endTs = Math.max(startMs, endMs);
    try {
      return await fetchHistoryWindow(deviceId, startTs, endTs);
    } catch (e) {
      console.error(`[battery-telemetry-adapter] Gagal ambil history (custom range) untuk ${deviceId}:`, e.message, e);
      throw e;
    }
  }

  // getHistorySeriesForSource(telemetrySource, rangeKey) -> series | null
  // Synchronous cache read only — does NOT fetch. Kept for callers
  // that just want "whatever is already cached, if anything" without
  // triggering a request; battery-station.js's normal render flow
  // should use loadHistoryForRange()/loadHistoryForCustomRange()
  // instead so it actually gets fresh data on first selection.
  function getHistorySeriesForSource(telemetrySource, rangeKey) {
    if (!telemetrySource || typeof telemetrySource !== "string") return null;
    const entry = cache[telemetrySource];
    if (!entry) return null;
    const series = entry.history && entry.history[rangeKey];
    if (!series || !Array.isArray(series.timestampsUtc) || !series.timestampsUtc.length) return null;
    return series;
  }

  // getHistoryErrorForSource(telemetrySource, rangeKey) -> {message,code,status} | null
  // Synchronous cache read of the LAST error recorded for this
  // device+range (from the eager prefetch in getStationTelemetry() or
  // a later loadHistoryForRange() retry) — null if that range has
  // never failed, or has since succeeded. This is what lets
  // battery-station.js tell "the VPS genuinely has no data for this
  // range" apart from "the request for this range failed" instead of
  // showing the same generic empty message for both.
  function getHistoryErrorForSource(telemetrySource, rangeKey) {
    if (!telemetrySource || typeof telemetrySource !== "string") return null;
    const entry = cache[telemetrySource];
    if (!entry) return null;
    return (entry.historyErrors && entry.historyErrors[rangeKey]) || null;
  }


  // =============================
  // Status transitions — NO VPS ENDPOINT EXISTS for
  // battery_status_transitions (table is confirmed to exist in
  // PostgreSQL, but nothing exposes it over the API — see handover
  // doc §8.3/§15). Always returns [] rather than fabricating a log.
  // deriveTransitionsFromHistory() is kept as a pure, dependency-free
  // function (no VPS assumption) in case a future endpoint returns
  // raw per-sample status history instead of a pre-built log.
  // =============================
  function deriveTransitionsFromHistory(history, batteryId) {
    if (!Array.isArray(history) || history.length < 2) return [];
    const sorted = history
      .filter((p) => p && p.timestamp && p.status !== undefined)
      .slice()
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const events = [];
    let prevTs = null;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.status === prev.status) continue;
      const durationMs = prevTs ? (new Date(prev.timestamp) - prevTs) : null;
      events.push({
        id: `trans-${batteryId}-${i}`,
        batteryId,
        timestamp: cur.timestamp,
        previousStatus: prev.status,
        newStatus: cur.status,
        duration: durationMs,
      });
      prevTs = new Date(prev.timestamp);
    }
    return events;
  }

  // Kept for call-site compatibility with older code paths — no-op
  // today since there is nothing to "ensure loaded" beyond what
  // getStationTelemetry() already fetches.
  async function ensureStationLogsLoaded() {
    return null;
  }

  function getTransitionsForSource() {
    return [];
  }

  window.BTA_normalizeTelemetry = normalizeTelemetry;
  window.BTA_getStationTelemetry = getStationTelemetry;
  window.BTA_loadHistoryForRange = loadHistoryForRange;
  window.BTA_loadHistoryForCustomRange = loadHistoryForCustomRange;
  window.BTA_ensureStationLogsLoaded = ensureStationLogsLoaded;
  window.BTA_getTransitionsForSource = getTransitionsForSource;
  window.BTA_deriveTransitionsFromHistory = deriveTransitionsFromHistory;
  window.BTA_getHistorySeriesForSource = getHistorySeriesForSource;
  window.BTA_getHistoryErrorForSource = getHistoryErrorForSource;

})();