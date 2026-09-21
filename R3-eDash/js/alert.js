/* ============================================================
   Page: Alert Diagnosis — 360eDash
   Stage 5: cuma Tab 1 (Live Alerts) yang beneran jalan. Tab 2/3/4
   (Classifiers, Fault Encoding Matrix, Versions) masih placeholder di
   alert.html -- itu Stage 6 & 7, JANGAN diisi di sini.

   Backend: edashboard_api (Hono), lewat window.EDASH_BACKEND_API_BASE
   (bukan window.EDASH_API_BASE -- itu backend lama, tidak punya route
   /alerts diagnosis sama sekali). Endpoint yang dipakai stage ini:
     GET  /alerts/active            -> daftar alert status='active'
     GET  /alerts/history?limit=    -> semua alert (buat filter status
                                        lain: acknowledged/resolved)
     GET  /alerts/:id/diagnosis     -> breakdown Bayesian lengkap
     PUT  /alerts/:id/ack           -> acknowledge
     PUT  /alerts/:id/resolve       -> resolve manual (tanpa expert
                                        validation -- lihat validate())
     PUT  /alerts/:id/validate      -> expert validation (verdict +
                                        notes + resolvedFaultId opsional)
     GET  /classifiers              -> buat resolve nama classifier
                                        pemicu (triggered_by_classifier_id)
     GET  /fault-classes            -> buat isi dropdown "Confirmed fault"

   GANTI TOTAL dari alert.js versi lama (100% window.__alertData lokal,
   tidak pernah terhubung ke API apapun) -- lihat catatan di alert.html.

   CATATAN untuk stage lanjutan (BUKAN bug yang harus difix sekarang,
   di luar scope frontend-only Stage 5):
   - GET /devices belum tentu bisa diakses oleh role yang cuma punya
     "alert.diagnosis.view" (device.routes.ts di-gate project.monitoring/
     battery.view, permission BEDA dari alert.*). Kode di bawah
     defensif -- kalau fetch /devices gagal (403/apapun), tabel tetap
     tampil pakai device_id mentah sebagai fallback, TIDAK bikin
     seluruh halaman gagal.
   - window.__alertData dulu dibaca master/header/header.js buat badge
     notifikasi bell -- alert.js yang lama manggil hdPushLogEntry()
     manual (bukan otomatis baca __alertData), jadi alert baru dari
     sistem ini TIDAK otomatis muncul di notifikasi bell kecuali
     ditambahkan manual nanti (di luar scope Stage 5).
============================================================= */

(function () {

  function adxApiBase() {
    return window.EDASH_BACKEND_API_BASE || "/api/v1";
  }

  function adxCurrentUser() {
    return sessionStorage.getItem("edash-user") || "Unknown";
  }

  // ---------- State ----------
  let alerts = [];
  let classifiersById = {};   // classifierId -> ClassifierRow (nama pemicu)
  let devicesById = {};       // deviceId -> nama device (best-effort, lihat catatan di atas)
  let faultsById = {};        // faultId -> FaultClassRow (dropdown "Confirmed fault")
  let activeStatusFilter = "";
  let activeDeviceFilter = "";
  let adxActiveAlertId = null; // alert yang lagi kebuka di modal diagnosis
  let adxToastTimer = null;

  function showToast(msg) {
    const toast = document.getElementById("adxToast");
    if (!toast) return;
    document.getElementById("adxToastMsg").textContent = msg;
    toast.classList.add("is-show");
    clearTimeout(adxToastTimer);
    adxToastTimer = setTimeout(() => toast.classList.remove("is-show"), 3400);
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function deviceLabel(deviceId) {
    return devicesById[deviceId] || deviceId;
  }

  function classifierLabel(classifierId) {
    const c = classifiersById[classifierId];
    return c ? c.name : classifierId;
  }

  function statusLabel(status) {
    const map = {
      active: "alert.status.active",
      acknowledged: "alert.status.acknowledged",
      resolved: "alert.status.resolved",
      dismissed: "alert.status.dismissed",
    };
    return typeof t === "function" ? t(map[status] || "") || status : status;
  }

  // ---------- Data loading ----------
  async function loadClassifiers() {
    try {
      const list = await window.edashApiFetch("/classifiers");
      classifiersById = {};
      (list || []).forEach((c) => { classifiersById[c.id] = c; });
    } catch (e) {
      console.warn("[alert] Gagal ambil daftar classifier:", e.message);
    }
  }

  async function loadFaults() {
    try {
      const list = await window.edashApiFetch("/fault-classes");
      faultsById = {};
      (list || []).forEach((f) => { faultsById[f.id] = f; });
      const select = document.getElementById("adxResolvedFaultSelect");
      if (select) {
        const noneOpt = select.querySelector('option[value=""]');
        select.innerHTML = "";
        if (noneOpt) select.appendChild(noneOpt);
        else {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "— None / false alarm —";
          select.appendChild(opt);
        }
        list.forEach((f) => {
          const opt = document.createElement("option");
          opt.value = f.id;
          opt.textContent = f.name;
          select.appendChild(opt);
        });
      }
    } catch (e) {
      console.warn("[alert] Gagal ambil daftar fault class:", e.message);
    }
  }

  // Best-effort saja -- lihat catatan panjang di kepala file soal
  // kemungkinan gate permission /devices berbeda dari alert.*.
  async function loadDevices() {
    try {
      const list = await window.edashApiFetch("/devices");
      devicesById = {};
      (list || []).forEach((d) => {
        devicesById[d.id] = d.deviceName || d.device_name || d.id;
      });
      const filter = document.getElementById("adxDeviceFilter");
      if (filter) {
        const blank = filter.querySelector('option[value=""]');
        filter.innerHTML = "";
        if (blank) filter.appendChild(blank);
        list.forEach((d) => {
          const opt = document.createElement("option");
          opt.value = d.id;
          opt.textContent = d.deviceName || d.device_name || d.id;
          filter.appendChild(opt);
        });
      }
    } catch (e) {
      console.warn("[alert] Gagal ambil daftar device (fallback ke device_id mentah di tabel):", e.message);
    }
  }

  async function loadAlerts() {
    try {
      // "Semua status" butuh /history (limit besar), sedangkan filter
      // spesifik "active" bisa langsung pakai /active (lebih ringan).
      // acknowledged/resolved/dismissed TIDAK punya endpoint sendiri --
      // diambil dari /history lalu difilter di client.
      if (activeStatusFilter === "active") {
        alerts = await window.edashApiFetch("/alerts/active" + (activeDeviceFilter ? `?deviceId=${encodeURIComponent(activeDeviceFilter)}` : ""));
      } else {
        alerts = await window.edashApiFetch("/alerts/history?limit=200" + (activeDeviceFilter ? `&deviceId=${encodeURIComponent(activeDeviceFilter)}` : ""));
        if (activeStatusFilter) {
          alerts = alerts.filter((a) => a.status === activeStatusFilter);
        }
      }
    } catch (e) {
      console.warn("[alert] Gagal ambil daftar alert:", e.message);
      alerts = [];
      showToast(e.message || "Failed to load alerts");
    }
    renderStats();
    renderTable();
  }

  // ---------- Render: stat cards ----------
  function renderStats() {
    // Stat card SELALU hitung dari histori penuh (bukan cuma alert yang
    // lolos filter saat ini) -- kalau lagi difilter ke device tertentu,
    // stat ini tetap representatif buat device itu; kalau tidak ada
    // device filter, /history?limit=200 di atas sudah cukup luas.
    const counts = { active: 0, acknowledged: 0, resolved: 0 };
    alerts.forEach((a) => { if (counts[a.status] !== undefined) counts[a.status]++; });
    document.getElementById("adxStatActive").textContent = counts.active;
    document.getElementById("adxStatAcknowledged").textContent = counts.acknowledged;
    document.getElementById("adxStatResolved").textContent = counts.resolved;
  }

  // ---------- Render: table ----------
  function renderTable() {
    const tbody = document.getElementById("adxTableBody");
    const empty = document.getElementById("adxEmpty");
    tbody.innerHTML = "";

    if (!alerts.length) {
      empty.classList.remove("hidden");
      document.getElementById("adxCount").textContent = "Showing 0 of 0 alerts";
      return;
    }
    empty.classList.add("hidden");

    alerts.forEach((a) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(deviceLabel(a.device_id))}</td>
        <td>${escapeHtml(classifierLabel(a.triggered_by_classifier_id))}</td>
        <td><span class="adx-pill adx-pill-${a.status}">${escapeHtml(statusLabel(a.status))}</span></td>
        <td>${fmtDate(a.triggered_at)}</td>
        <td>
          <button type="button" class="adx-btn adx-btn-secondary adx-btn-sm" data-action="view" data-id="${a.id}">
            <i class="fa-solid fa-stethoscope"></i> View
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("adxCount").textContent = `Showing ${alerts.length} of ${alerts.length} alerts`;

    tbody.querySelectorAll('button[data-action="view"]').forEach((btn) => {
      btn.addEventListener("click", () => openDiagnosis(btn.getAttribute("data-id")));
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // ---------- Diagnosis modal ----------
  async function openDiagnosis(alertId) {
    adxActiveAlertId = alertId;
    const overlay = document.getElementById("adxDiagnosisOverlay");
    const alert = alerts.find((a) => a.id === alertId);

    document.getElementById("adxAlertSummary").innerHTML = alert ? `
      <div class="adx-summary-row"><strong>${escapeHtml(deviceLabel(alert.device_id))}</strong></div>
      <div class="adx-summary-row">Triggered by: ${escapeHtml(classifierLabel(alert.triggered_by_classifier_id))}</div>
      <div class="adx-summary-row">Status: <span class="adx-pill adx-pill-${alert.status}">${escapeHtml(statusLabel(alert.status))}</span></div>
      <div class="adx-summary-row">Triggered at: ${fmtDate(alert.triggered_at)}</div>
    ` : "";

    const faultList = document.getElementById("adxFaultList");
    const noDiagnosisHint = document.getElementById("adxNoDiagnosisHint");
    faultList.innerHTML = "";
    noDiagnosisHint.classList.add("hidden");

    try {
      const diagnosis = await window.edashApiFetch(`/alerts/${encodeURIComponent(alertId)}/diagnosis`);
      renderFaultList(diagnosis.faults || []);
    } catch (e) {
      // 404 DIAGNOSIS_NOT_FOUND -- wajar buat alert lama/manual yang
      // belum pernah lewat diagnosis-engine.service.ts, BUKAN error
      // yang perlu ditoast ke user.
      noDiagnosisHint.classList.remove("hidden");
    }

    overlay.classList.add("is-open");
  }

  function renderFaultList(faults) {
    const faultList = document.getElementById("adxFaultList");
    faultList.innerHTML = "";

    faults
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .forEach((f) => {
        const pct = Math.round(f.posteriorProbability * 1000) / 10;
        const card = document.createElement("div");
        card.className = "adx-fault-card";
        card.innerHTML = `
          <div class="adx-fault-head">
            <span class="adx-fault-rank">#${f.rank}</span>
            <span class="adx-fault-name">${escapeHtml(f.faultName)}</span>
            <span class="adx-fault-pct">${pct}%</span>
          </div>
          <div class="adx-fault-bar-track"><div class="adx-fault-bar-fill" style="width:${pct}%"></div></div>
          <button type="button" class="adx-fault-expand-btn">
            <i class="fa-solid fa-chevron-down"></i> Why this ranking?
          </button>
          <div class="adx-fault-breakdown hidden">
            ${(f.classifierBreakdown || []).map(renderClassifierRow).join("")}
          </div>
        `;
        const expandBtn = card.querySelector(".adx-fault-expand-btn");
        const breakdown = card.querySelector(".adx-fault-breakdown");
        expandBtn.addEventListener("click", () => {
          breakdown.classList.toggle("hidden");
          expandBtn.querySelector("i").className = breakdown.classList.contains("hidden")
            ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up";
        });
        faultList.appendChild(card);
      });
  }

  // Dua "Unknown" WAJIB dibedakan labelnya (context.md Layer 3) --
  // unknown-by-design (expert belum isi/tidak relevan) vs
  // unknown-by-data (data stream tidak tersedia saat itu).
  function renderClassifierRow(entry) {
    let stateLabel;
    let stateClass;
    if (entry.skippedReason === "unknown-by-design") {
      stateLabel = "N/A by design";
      stateClass = "is-neutral";
    } else if (entry.skippedReason === "unknown-by-data") {
      stateLabel = "Data unavailable";
      stateClass = "is-neutral";
    } else if (entry.matched) {
      stateLabel = "Matched";
      stateClass = "is-match";
    } else {
      stateLabel = "Did not match";
      stateClass = "is-mismatch";
    }
    const fuzzyText = entry.fuzzyScore == null ? "—" : entry.fuzzyScore.toFixed(2);
    return `
      <div class="adx-classifier-row ${stateClass}">
        <span class="adx-classifier-name">${escapeHtml(entry.classifierName)}</span>
        <span class="adx-classifier-state">${stateLabel}</span>
        <span class="adx-classifier-fuzzy">fuzzy: ${fuzzyText}</span>
        <span class="adx-classifier-ratio">×${entry.likelihoodRatioApplied.toFixed(2)}</span>
      </div>
    `;
  }

  function closeDiagnosis() {
    document.getElementById("adxDiagnosisOverlay").classList.remove("is-open");
    adxActiveAlertId = null;
    document.getElementById("adxValidationNotes").value = "";
    document.getElementById("adxResolvedFaultSelect").value = "";
  }

  // ---------- Expert validation ----------
  async function submitValidation(verdict) {
    if (!adxActiveAlertId) return;
    const notes = document.getElementById("adxValidationNotes").value.trim();
    const resolvedFaultId = document.getElementById("adxResolvedFaultSelect").value || null;
    try {
      await window.edashApiFetch(`/alerts/${encodeURIComponent(adxActiveAlertId)}/validate`, {
        method: "PUT",
        body: JSON.stringify({ verdict, notes: notes || null, resolvedFaultId }),
      });
      showToast("Validation submitted");
      closeDiagnosis();
      await loadAlerts();

      if (typeof logActivity === "function") {
        logActivity({
          eventType: "alert_validated",
          user: adxCurrentUser(),
          userRole: sessionStorage.getItem("edash-role") || null,
          status: "success",
          detail: `Expert validation (${verdict}) submitted for an alert diagnosis`,
          data: { alertId: adxActiveAlertId, verdict, resolvedFaultId },
        });
      }
    } catch (e) {
      console.warn("[alert] Gagal submit validation:", e.message);
      showToast(e.message || "Failed to submit validation");
    }
  }

  // ============================================================
  // TAB 2 — CLASSIFIERS (Stage 6)
  // ============================================================

  let dataStreamsList = [];   // DataStreamRow[]
  let classifiersList = [];   // ClassifierRow[] (ordered, buat tabel -- beda dari classifiersById yg dipakai Tab 1 buat lookup nama)
  let editingClassifierId = null; // null = mode Add

  function streamLabel(streamId) {
    const s = dataStreamsList.find((d) => d.id === streamId);
    return s ? s.name : streamId;
  }

  // Kalimat manusiawi 1-baris buat kolom "Condition" di tabel, mis.
  // "battery.soc < 20 FOR 5 min (≥80% of points)" -- BUKAN textbox rule
  // language yang diketik user, cuma representasi dari builder dropdown.
  function classifierConditionSentence(c) {
    const streamName = streamLabel(c.stream_id);
    const target = c.compare_to_type === 'stream'
      ? streamLabel(c.compare_stream_id)
      : String(Number(c.compare_value));
    const verb = c.mode === 'RATE_OF_CHANGE' ? ' (rate of change)' : '';
    return `${escapeHtml(streamName)}${escapeHtml(verb)} ${escapeHtml(c.operator)} ${escapeHtml(target)} `
      + `FOR ${c.duration_minutes} min (≥${Number(c.min_true_percentage)}% of points)`;
  }

  async function loadDataStreams() {
    try {
      dataStreamsList = await window.edashApiFetch("/data-streams");
    } catch (e) {
      console.warn("[alert] Gagal ambil data streams:", e.message);
      dataStreamsList = [];
    }
  }

  async function loadClassifiersTab() {
    try {
      classifiersList = await window.edashApiFetch("/classifiers");
      // classifiersById (state Tab 1) ikut disegarkan -- sumber sama,
      // supaya nama pemicu alert di Tab 1 juga ikut update kalau ada
      // classifier baru/berubah nama dari sini.
      classifiersById = {};
      classifiersList.forEach((c) => { classifiersById[c.id] = c; });
    } catch (e) {
      console.warn("[alert] Gagal ambil daftar classifier:", e.message);
      classifiersList = [];
      showToast(e.message || "Failed to load classifiers");
    }
    renderClassifiersTable();
  }

  function renderClassifiersTable() {
    const tbody = document.getElementById("adxClassifiersTableBody");
    const empty = document.getElementById("adxClassifiersEmpty");
    tbody.innerHTML = "";

    if (!classifiersList.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    classifiersList.forEach((c) => {
      const tr = document.createElement("tr");
      if (!c.is_active) tr.classList.add("is-inactive-row");
      tr.innerHTML = `
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(streamLabel(c.stream_id))}</td>
        <td class="adx-condition-cell">${classifierConditionSentence(c)}</td>
        <td>
          ${c.type === "ml_based"
            ? `<span class="adx-pill adx-pill-neutral" data-i18n="alert.classifierModal.typeMlBased">ML-based (coming soon)</span>`
            : `<span class="adx-pill adx-pill-info" data-i18n="alert.classifierModal.typeRuleBased">Rule-based</span>`}
        </td>
        <td>
          <span class="adx-pill ${c.is_active ? "adx-pill-resolved" : "adx-pill-neutral"}">
            ${c.is_active ? "Active" : "Inactive"}
          </span>
        </td>
        <td class="adx-row-actions">
          <button type="button" class="adx-btn adx-btn-secondary adx-btn-sm" data-action="edit" data-id="${c.id}">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button type="button" class="adx-btn adx-btn-secondary adx-btn-sm" data-action="toggle" data-id="${c.id}">
            <i class="fa-solid ${c.is_active ? "fa-toggle-on" : "fa-toggle-off"}"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
      btn.addEventListener("click", () => openClassifierModal(btn.getAttribute("data-id")));
    });
    tbody.querySelectorAll('button[data-action="toggle"]').forEach((btn) => {
      btn.addEventListener("click", () => toggleClassifierActive(btn.getAttribute("data-id")));
    });
  }

  async function toggleClassifierActive(id) {
    const c = classifiersList.find((x) => x.id === id);
    if (!c) return;
    try {
      await window.edashApiFetch(`/classifiers/${encodeURIComponent(id)}/${c.is_active ? "deactivate" : "activate"}`, { method: "POST" });
      showToast(c.is_active ? "Classifier deactivated" : "Classifier activated");
      await loadClassifiersTab();
    } catch (e) {
      console.warn("[alert] Gagal ubah status classifier:", e.message);
      showToast(e.message || "Failed to update classifier");
    }
  }

  function fillStreamSelect(selectEl) {
    selectEl.innerHTML = "";
    dataStreamsList.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.category})`;
      selectEl.appendChild(opt);
    });
  }

  function openClassifierModal(id) {
    editingClassifierId = id || null;
    const c = id ? classifiersList.find((x) => x.id === id) : null;

    document.getElementById("adxClassifierModalTitle").textContent = c ? "Edit Classifier" : "Add Classifier";
    document.getElementById("adxClfName").value = c ? c.name : "";
    document.getElementById("adxClfMode").value = c ? c.mode : "THRESHOLD";
    document.getElementById("adxClfType").value = c ? c.type : "rule_based";

    const streamSelect = document.getElementById("adxClfStream");
    const compareStreamSelect = document.getElementById("adxClfCompareStream");
    fillStreamSelect(streamSelect);
    fillStreamSelect(compareStreamSelect);
    if (c) streamSelect.value = c.stream_id;

    document.getElementById("adxClfOperator").value = c ? c.operator : "<";
    document.getElementById("adxClfCompareToType").value = c ? c.compare_to_type : "static_value";
    document.getElementById("adxClfCompareValue").value = c && c.compare_value !== null ? Number(c.compare_value) : "";
    if (c && c.compare_to_type === "stream") compareStreamSelect.value = c.compare_stream_id;
    document.getElementById("adxClfDuration").value = c ? c.duration_minutes : 5;
    document.getElementById("adxClfMinTrue").value = c ? Number(c.min_true_percentage) : 80;

    updateCompareTargetVisibility();
    document.getElementById("adxClfNameError").classList.remove("is-visible");
    document.getElementById("adxClfCompareValueError").classList.remove("is-visible");
    document.getElementById("adxClassifierModalOverlay").classList.add("is-open");
  }

  function closeClassifierModal() {
    document.getElementById("adxClassifierModalOverlay").classList.remove("is-open");
    editingClassifierId = null;
  }

  function updateCompareTargetVisibility() {
    const isStream = document.getElementById("adxClfCompareToType").value === "stream";
    document.getElementById("adxClfCompareValueField").classList.toggle("hidden", isStream);
    document.getElementById("adxClfCompareStreamField").classList.toggle("hidden", !isStream);
  }

  async function submitClassifierForm() {
    const name = document.getElementById("adxClfName").value.trim();
    const compareToType = document.getElementById("adxClfCompareToType").value;
    const compareValueRaw = document.getElementById("adxClfCompareValue").value;

    let valid = true;
    if (!name) {
      document.getElementById("adxClfNameError").classList.add("is-visible");
      valid = false;
    } else {
      document.getElementById("adxClfNameError").classList.remove("is-visible");
    }
    if (compareToType === "static_value" && compareValueRaw === "") {
      document.getElementById("adxClfCompareValueError").classList.add("is-visible");
      valid = false;
    } else {
      document.getElementById("adxClfCompareValueError").classList.remove("is-visible");
    }
    if (!valid) return;

    const payload = {
      name,
      mode: document.getElementById("adxClfMode").value,
      type: document.getElementById("adxClfType").value,
      streamId: document.getElementById("adxClfStream").value,
      operator: document.getElementById("adxClfOperator").value,
      compareToType,
      compareValue: compareToType === "static_value" ? Number(compareValueRaw) : null,
      compareStreamId: compareToType === "stream" ? document.getElementById("adxClfCompareStream").value : null,
      durationMinutes: Number(document.getElementById("adxClfDuration").value) || 5,
      minTruePercentage: Number(document.getElementById("adxClfMinTrue").value),
    };

    const saveBtn = document.getElementById("adxClassifierSaveBtn");
    saveBtn.disabled = true;
    try {
      if (editingClassifierId) {
        await window.edashApiFetch(`/classifiers/${encodeURIComponent(editingClassifierId)}`, { method: "PUT", body: JSON.stringify(payload) });
        showToast("Classifier updated");
      } else {
        await window.edashApiFetch("/classifiers", { method: "POST", body: JSON.stringify(payload) });
        showToast("Classifier created");
      }
      closeClassifierModal();
      await loadClassifiersTab();
    } catch (e) {
      console.warn("[alert] Gagal simpan classifier:", e.message);
      showToast(e.message || "Failed to save classifier");
    } finally {
      saveBtn.disabled = false;
    }
  }

  // ============================================================
  // TAB 3 — FAULT ENCODING MATRIX (Stage 6)
  // ============================================================

  let faultsList = [];        // FaultClassRow[]
  let matrixRows = [];        // EncodingMatrixRow[] (SPARSE -- lihat catatan di schema.ts, cell yg belum di-set tidak punya baris)
  let pendingMatrixChanges = {}; // `${faultId}::${classifierId}` -> 'present'|'absent'|'unknown' (belum dikirim ke server)
  let aiSuggestions = [];     // EncodingAiSuggestionRow[] (status='pending')
  let aiPendingDecisions = {}; // suggestionId -> 'accept'|'reject' (staged, sama pola kayak pendingMatrixChanges)

  const MATRIX_STATE_CYCLE = ["unknown", "present", "absent"];

  function matrixCellKey(faultId, classifierId) {
    return `${faultId}::${classifierId}`;
  }

  function getCellState(faultId, classifierId) {
    const key = matrixCellKey(faultId, classifierId);
    if (Object.prototype.hasOwnProperty.call(pendingMatrixChanges, key)) return pendingMatrixChanges[key];
    const row = matrixRows.find((r) => r.fault_id === faultId && r.classifier_id === classifierId);
    return row ? row.state : "unknown";
  }

  async function loadMatrixTab() {
    try {
      const [faults, matrix, qa, suggestions] = await Promise.all([
        window.edashApiFetch("/fault-classes"),
        window.edashApiFetch("/fault-encoding/matrix"),
        window.edashApiFetch("/fault-encoding/qa"),
        window.edashApiFetch("/encoding-ai-suggestions?status=pending"),
      ]);
      faultsList = faults || [];
      matrixRows = matrix || [];
      aiSuggestions = suggestions || [];
      renderQaBanner(qa || { namedGaps: [], identicalSignatures: [] });
      renderAiSuggestions();
      renderMatrixGrid();
    } catch (e) {
      console.warn("[alert] Gagal ambil data Fault Encoding Matrix:", e.message);
      showToast(e.message || "Failed to load fault encoding matrix");
    }
  }

  function renderQaBanner(qa) {
    const banner = document.getElementById("adxQaBanner");
    const textEl = document.getElementById("adxQaBannerText");
    const details = document.getElementById("adxQaDetails");
    const total = qa.namedGaps.length + qa.identicalSignatures.length;

    if (total === 0) {
      banner.classList.add("hidden");
      details.classList.add("hidden");
      return;
    }
    banner.classList.remove("hidden");
    textEl.textContent = `${qa.namedGaps.length} named gap(s), ${qa.identicalSignatures.length} identical signature(s) found.`;

    details.innerHTML = [
      ...qa.namedGaps.map((g) => `
        <div class="adx-qa-issue">
          <i class="fa-solid fa-circle-exclamation"></i>
          <span><strong>${escapeHtml(g.faultName)}</strong> — "${escapeHtml(g.classifierName)}" is Unknown here, but set Present/Absent for: ${escapeHtml(g.relatedFaultNames.join(", "))}. Possibly forgotten?</span>
        </div>
      `),
      ...qa.identicalSignatures.map((s) => `
        <div class="adx-qa-issue">
          <i class="fa-solid fa-clone"></i>
          <span>Identical signatures: <strong>${escapeHtml(s.faultNames.join(", "))}</strong> — Bayes can only tell these apart by prior probability.</span>
        </div>
      `),
    ].join("");
  }

  function renderAiSuggestions() {
    const list = document.getElementById("adxAiSuggestionList");
    const empty = document.getElementById("adxAiSuggestionEmpty");
    list.innerHTML = "";

    if (!aiSuggestions.length) {
      empty.classList.remove("hidden");
      updateMatrixSubmitBar();
      return;
    }
    empty.classList.add("hidden");

    aiSuggestions.forEach((s) => {
      const payload = s.suggestion || {};
      const fault = faultsList.find((f) => f.id === payload.faultId);
      const decision = aiPendingDecisions[s.id];
      const card = document.createElement("div");
      card.className = "adx-ai-suggestion-card";
      card.innerHTML = `
        <div class="adx-ai-suggestion-summary">
          <strong>${escapeHtml(fault ? fault.name : payload.faultId || "?")}</strong> ×
          <strong>${escapeHtml(classifierLabel(payload.classifierId))}</strong>:
          ${escapeHtml(payload.fromState || "unknown")} → ${escapeHtml(payload.toState || "unknown")}
        </div>
        ${payload.reason ? `<p class="adx-ai-suggestion-reason">${escapeHtml(payload.reason)}</p>` : ""}
        <div class="adx-ai-suggestion-actions">
          <button type="button" class="adx-btn adx-btn-sm ${decision === "accept" ? "adx-btn-primary" : "adx-btn-secondary"}" data-action="accept" data-id="${s.id}">
            <i class="fa-solid fa-check"></i> Accept
          </button>
          <button type="button" class="adx-btn adx-btn-sm ${decision === "reject" ? "adx-btn-danger" : "adx-btn-secondary"}" data-action="reject" data-id="${s.id}">
            <i class="fa-solid fa-xmark"></i> Reject
          </button>
        </div>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        // Klik lagi tombol yang sama = batalkan staged decision (toggle).
        aiPendingDecisions[id] = aiPendingDecisions[id] === action ? undefined : action;
        if (aiPendingDecisions[id] === undefined) delete aiPendingDecisions[id];
        renderAiSuggestions();
      });
    });

    updateMatrixSubmitBar();
  }

  function renderMatrixGrid() {
    const table = document.getElementById("adxMatrixTable");
    if (!faultsList.length || !classifiersList.length) {
      table.innerHTML = `<tr><td class="adx-hint">No faults/classifiers defined yet.</td></tr>`;
      return;
    }

    let thead = `<thead><tr><th class="adx-matrix-corner"></th>`;
    classifiersList.forEach((c) => { thead += `<th class="adx-matrix-col-head" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</th>`; });
    thead += `</tr></thead>`;

    let tbody = `<tbody>`;
    faultsList.forEach((f) => {
      tbody += `<tr><th class="adx-matrix-row-head">${escapeHtml(f.name)}</th>`;
      classifiersList.forEach((c) => {
        const state = getCellState(f.id, c.id);
        const key = matrixCellKey(f.id, c.id);
        const isDirty = Object.prototype.hasOwnProperty.call(pendingMatrixChanges, key);
        tbody += `<td class="adx-matrix-cell is-${state} ${isDirty ? "is-dirty" : ""}" data-fault="${f.id}" data-classifier="${c.id}" title="${escapeHtml(f.name)} × ${escapeHtml(c.name)}: ${state}"></td>`;
      });
      tbody += `</tr>`;
    });
    tbody += `</tbody>`;

    table.innerHTML = thead + tbody;

    table.querySelectorAll(".adx-matrix-cell").forEach((cell) => {
      cell.addEventListener("click", () => cycleCell(cell.getAttribute("data-fault"), cell.getAttribute("data-classifier")));
    });
  }

  function cycleCell(faultId, classifierId) {
    const current = getCellState(faultId, classifierId);
    const next = MATRIX_STATE_CYCLE[(MATRIX_STATE_CYCLE.indexOf(current) + 1) % MATRIX_STATE_CYCLE.length];
    pendingMatrixChanges[matrixCellKey(faultId, classifierId)] = next;
    renderMatrixGrid();
    updateMatrixSubmitBar();
  }

  function updateMatrixSubmitBar() {
    const bar = document.getElementById("adxMatrixSubmitBar");
    const count = Object.keys(pendingMatrixChanges).length + Object.keys(aiPendingDecisions).length;
    if (count === 0) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    document.getElementById("adxMatrixPendingCount").textContent = `${count} unsaved change${count > 1 ? "s" : ""}`;
  }

  function discardMatrixChanges() {
    pendingMatrixChanges = {};
    aiPendingDecisions = {};
    renderMatrixGrid();
    renderAiSuggestions();
    updateMatrixSubmitBar();
  }

  // Kirim SEMUA perubahan staged (cell matrix manual + keputusan AI
  // suggestion) sekaligus -- ini titik SATU-SATUNYA yang beneran
  // menyentuh backend (lihat catatan besar di
  // EncodingAiSuggestionService.accept() soal draft-only sampai titik
  // ini). Kalau salah satu gagal di tengah jalan, sisanya TETAP
  // dilanjutkan (Promise.allSettled) supaya user tidak kehilangan
  // seluruh batch cuma karena 1 baris error -- baris yang gagal
  // dilaporkan di toast, TIDAK dihapus dari pending (bisa dicoba lagi).
  async function submitMatrixChanges() {
    const submitBtn = document.getElementById("adxMatrixSubmitBtn");
    submitBtn.disabled = true;

    const cellEntries = Object.entries(pendingMatrixChanges);
    const decisionEntries = Object.entries(aiPendingDecisions);

    const cellResults = await Promise.allSettled(cellEntries.map(([key, state]) => {
      const [faultId, classifierId] = key.split("::");
      return window.edashApiFetch("/fault-encoding/matrix", {
        method: "PUT",
        body: JSON.stringify({ faultId, classifierId, state }),
      });
    }));
    const decisionResults = await Promise.allSettled(decisionEntries.map(([id, action]) =>
      window.edashApiFetch(`/encoding-ai-suggestions/${encodeURIComponent(id)}/${action}`, { method: "PUT" })
    ));

    // Sisakan cuma yang GAGAL di pending -- yang sukses dibuang dari state.
    const nextPendingCells = {};
    cellResults.forEach((r, i) => { if (r.status === "rejected") nextPendingCells[cellEntries[i][0]] = cellEntries[i][1]; });
    const nextPendingDecisions = {};
    decisionResults.forEach((r, i) => { if (r.status === "rejected") nextPendingDecisions[decisionEntries[i][0]] = decisionEntries[i][1]; });

    const failedCount = Object.keys(nextPendingCells).length + Object.keys(nextPendingDecisions).length;
    pendingMatrixChanges = nextPendingCells;
    aiPendingDecisions = nextPendingDecisions;

    showToast(failedCount === 0 ? "All changes submitted" : `${failedCount} change(s) failed — still pending, try again`);
    submitBtn.disabled = false;

    await loadMatrixTab(); // segarkan matrix/QA/suggestion list dari server
  }


  let classifiersTabLoaded = false;
  let matrixTabLoaded = false;
  let versionsTabLoaded = false;

  function initTabs() {
    const tabs = document.querySelectorAll(".adx-tab");
    const panels = {
      live: document.getElementById("adxTabLive"),
      classifiers: document.getElementById("adxTabClassifiers"),
      matrix: document.getElementById("adxTabMatrix"),
      versions: document.getElementById("adxTabVersions"),
    };
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.disabled) return;
        tabs.forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        Object.values(panels).forEach((p) => p && p.classList.add("hidden"));
        const target = panels[tab.getAttribute("data-tab")];
        if (target) target.classList.remove("hidden");

        // Lazy-load Tab 2/3 -- SEKALI per kunjungan halaman (bukan tiap
        // klik), data streams/classifiers/matrix tidak sering berubah
        // dalam 1 sesi. Refresh sebenarnya lewat buka-tutup halaman lagi.
        const tabName = tab.getAttribute("data-tab");
        if (tabName === "classifiers" && !classifiersTabLoaded) {
          classifiersTabLoaded = true;
          loadDataStreams().then(loadClassifiersTab);
        }
        if (tabName === "matrix" && !matrixTabLoaded) {
          matrixTabLoaded = true;
          // Matrix butuh classifiersList (kolom grid) -- pastikan sudah
          // ke-load walau user belum pernah buka Tab 2 sama sekali.
          const ensureClassifiers = classifiersTabLoaded && classifiersList.length
            ? Promise.resolve()
            : loadDataStreams().then(loadClassifiersTab);
          ensureClassifiers.then(loadMatrixTab);
        }
        if (tabName === "versions" && !versionsTabLoaded) {
          versionsTabLoaded = true;
          loadVersionsTab();
        }
      });
    });
  }

  // ---------- Init ----------
  async function init() {
    initTabs();

    document.getElementById("adxRefreshBtn").addEventListener("click", loadAlerts);
    document.getElementById("adxStatusFilter").addEventListener("change", (e) => {
      activeStatusFilter = e.target.value;
      loadAlerts();
    });
    document.getElementById("adxDeviceFilter").addEventListener("change", (e) => {
      activeDeviceFilter = e.target.value;
      loadAlerts();
    });
    document.getElementById("adxDiagnosisCloseBtn").addEventListener("click", closeDiagnosis);
    document.getElementById("adxDiagnosisOverlay").addEventListener("click", (e) => {
      if (e.target === document.getElementById("adxDiagnosisOverlay")) closeDiagnosis();
    });
    document.getElementById("adxVerdictAccurateBtn").addEventListener("click", () => submitValidation("accurate"));
    document.getElementById("adxVerdictWrongBtn").addEventListener("click", () => submitValidation("wrong"));
    document.getElementById("adxSubmitValidationBtn").addEventListener("click", () => {
      // Tombol generik (bukan verdict spesifik) -- kirim verdict
      // berdasarkan mana yang terakhir kali diklik? Tidak ada state
      // begitu di HTML saat ini, jadi tombol ini dianggap alias buat
      // "accurate" (jalur paling umum: submit catatan tambahan setelah
      // sudah pilih salah satu verdict button di atas). Verdict button
      // itu sendiri SUDAH langsung submit -- tombol Submit Validation
      // ini praktis redundant kecuali user isi notes/fault dulu lalu
      // klik salah satu verdict button (yang sudah cukup). Dibiarkan
      // no-op supaya tidak submit ganda / verdict yang salah.
    });

    // ---- Tab 2: Classifiers ----
    document.getElementById("adxAddClassifierBtn").addEventListener("click", () => openClassifierModal(null));
    document.getElementById("adxClassifierModalCloseBtn").addEventListener("click", closeClassifierModal);
    document.getElementById("adxClassifierCancelBtn").addEventListener("click", closeClassifierModal);
    document.getElementById("adxClassifierModalOverlay").addEventListener("click", (e) => {
      if (e.target === document.getElementById("adxClassifierModalOverlay")) closeClassifierModal();
    });
    document.getElementById("adxClfCompareToType").addEventListener("change", updateCompareTargetVisibility);
    document.getElementById("adxClassifierSaveBtn").addEventListener("click", submitClassifierForm);

    // ---- Tab 3: Fault Encoding Matrix ----
    document.getElementById("adxQaBannerToggleBtn").addEventListener("click", () => {
      document.getElementById("adxQaDetails").classList.toggle("hidden");
    });
    document.getElementById("adxMatrixDiscardBtn").addEventListener("click", discardMatrixChanges);
    document.getElementById("adxMatrixSubmitBtn").addEventListener("click", submitMatrixChanges);

    // ---- Tab 4: Versions ----
    document.getElementById("adxSaveVersionBtn").addEventListener("click", saveCurrentVersion);
    document.getElementById("adxConfirmCancelBtn").addEventListener("click", () => adxCloseConfirm(false));
    document.getElementById("adxConfirmCancelX").addEventListener("click", () => adxCloseConfirm(false));
    document.getElementById("adxConfirmActionBtn").addEventListener("click", () => adxCloseConfirm(true));
    document.getElementById("adxConfirmOverlay").addEventListener("click", (e) => {
      if (e.target === document.getElementById("adxConfirmOverlay")) adxCloseConfirm(false);
    });

    await Promise.all([loadClassifiers(), loadFaults(), loadDevices()]);
    await loadAlerts();
  }

  // ============================================================
  // GENERIC CONFIRM MODAL -- pola sama persis tkConfirm() di
  // js/ticketing.js (Promise-based, resolve(true/false)).
  // ============================================================
  let adxConfirmResolve = null;

  function adxCloseConfirm(result) {
    document.getElementById("adxConfirmOverlay").classList.remove("is-open");
    if (adxConfirmResolve) {
      const resolve = adxConfirmResolve;
      adxConfirmResolve = null;
      resolve(result);
    }
  }

  function adxConfirm(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      if (adxConfirmResolve) adxCloseConfirm(false); // popup lain masih nunggu -- anggap Cancel dulu
      adxConfirmResolve = resolve;
      document.getElementById("adxConfirmIcon").innerHTML = `<i class="fa-solid ${opts.icon || "fa-circle-question"}"></i>`;
      document.getElementById("adxConfirmTitle").textContent = opts.title || "Are you sure?";
      document.getElementById("adxConfirmText").textContent = opts.text || "Please confirm this action.";
      document.getElementById("adxConfirmActionBtn").textContent = opts.confirmLabel || "Confirm";
      document.getElementById("adxConfirmOverlay").classList.add("is-open");
    });
  }

  // ============================================================
  // TAB 4 — VERSIONS (Stage 7)
  // ============================================================

  let versionsList = []; // EncodingVersionRow[]

  async function loadVersionsTab() {
    try {
      versionsList = await window.edashApiFetch("/encoding-versions");
    } catch (e) {
      console.warn("[alert] Gagal ambil daftar versi encoding:", e.message);
      versionsList = [];
      showToast(e.message || "Failed to load versions");
    }
    renderVersionsTable();
  }

  function renderVersionsTable() {
    const tbody = document.getElementById("adxVersionsTableBody");
    const empty = document.getElementById("adxVersionsEmpty");
    tbody.innerHTML = "";

    if (!versionsList.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    versionsList
      .slice()
      .sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at))
      .forEach((v) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${fmtDate(v.saved_at)}</td>
          <td>${escapeHtml(v.saved_by || "—")}</td>
          <td>${escapeHtml(v.notes || "—")}</td>
          <td>
            <button type="button" class="adx-btn adx-btn-secondary adx-btn-sm" data-action="load" data-id="${v.id}">
              <i class="fa-solid fa-clock-rotate-left"></i>
              <span data-i18n="alert.versions.load">Load this version</span>
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });

    tbody.querySelectorAll('button[data-action="load"]').forEach((btn) => {
      btn.addEventListener("click", () => confirmLoadVersion(btn.getAttribute("data-id")));
    });
  }

  async function saveCurrentVersion() {
    const notesInput = document.getElementById("adxVersionNotes");
    const btn = document.getElementById("adxSaveVersionBtn");
    btn.disabled = true;
    try {
      await window.edashApiFetch("/encoding-versions", {
        method: "POST",
        body: JSON.stringify({ notes: notesInput.value.trim() || null }),
      });
      notesInput.value = "";
      showToast("Version saved");
      await loadVersionsTab();
    } catch (e) {
      console.warn("[alert] Gagal simpan versi encoding:", e.message);
      showToast(e.message || "Failed to save version");
    } finally {
      btn.disabled = false;
    }
  }

  // Rollback itu UPDATE baris yang MASIH ADA (matched by id) + upsert
  // encoding_matrix -- BUKAN restore penuh 1:1 kalau ada classifier/
  // fault yang sudah dihapus sejak snapshot diambil, atau dibuat
  // setelahnya (lihat catatan panjang di
  // EncodingAiSuggestionService/EncodingVersionService.loadVersion() di
  // backend). Peringatan ini WAJIB kelihatan di teks konfirmasi, bukan
  // cuma "yakin rollback?" generik -- supaya admin tidak salah kira ini
  // restore sempurna.
  async function confirmLoadVersion(id) {
    const version = versionsList.find((v) => v.id === id);
    const ok = await adxConfirm({
      icon: "fa-clock-rotate-left",
      title: "Load this version?",
      text: `This overwrites classifiers, fault classes, and the encoding matrix with the "${version && version.notes ? version.notes : fmtDate(version ? version.saved_at : null)}" snapshot. `
        + `Note: this updates rows that still exist — it does NOT recreate classifiers/faults deleted since this snapshot, or remove ones created after it. This cannot be undone.`,
      confirmLabel: "Load Version",
    });
    if (!ok) return;

    try {
      await window.edashApiFetch(`/encoding-versions/${encodeURIComponent(id)}/load`, { method: "POST" });
      showToast("Version loaded");
      // Segarkan Tab 2/3 juga kalau sudah pernah dibuka -- isinya bisa
      // berubah total setelah rollback.
      if (classifiersTabLoaded) await loadClassifiersTab();
      if (matrixTabLoaded) { discardMatrixChanges(); await loadMatrixTab(); }
    } catch (e) {
      console.warn("[alert] Gagal load versi encoding:", e.message);
      showToast(e.message || "Failed to load version");
    }
  }


  // FIX: main.js loadPage() manggil window.initializeAlert() secara
  // eksplisit setelah fragment alert.html di-inject (lihat
  // "page.includes('alert') && typeof initializeAlert === 'function'"
  // di js/main.js) -- BUKAN lewat DOMContentLoaded (fragment ini
  // di-inject via fetch+innerHTML SETELAH DOMContentLoaded sudah lewat
  // sekali di awal load index.html, jadi event itu tidak pernah nyala
  // lagi buat fragment yang baru masuk). Expose global function dengan
  // nama PERSIS yang dicari main.js.
  window.initializeAlert = init;

})();
