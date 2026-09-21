/* ============================================================
   Task Management — 360eDash
   Tab "Future Maintenance" & "Historical Maintenance", dipakai
   Operator untuk membuat & assign tugas maintenance ke Staff.

   PERSISTENCE (REVISI):
   Data tugas SEKARANG di PostgreSQL (tabel `tasks` + `task_photos`,
   lewat backend Hono edashboard_api) -- BUKAN lagi array
   sys.futureMaintenance/historicalMaintenance yang ditumpuk di
   window.__siSystems lalu ditulis balik ke penyimpanan System
   Information yang lama.

   window.__siSystems TETAP dipakai (TIDAK diganti di revisi ini),
   TAPI HANYA untuk daftar unit/system (dropdown filter & "Unit /
   System" di form) -- persis kebutuhan System Information, yang
   migrasinya di luar scope task ini. Kalau window.__siSystems di
   instalasi Anda TERNYATA belum bersumber dari Postgres (masih
   sumber lama dengan id non-UUID seperti "sys-tawabi-grup2"),
   createTask()/updateTask() di bawah akan gagal dengan error
   "System tidak ditemukan" karena backend /maintenance
   memvalidasi systemId terhadap tabel `systems` di Postgres (UUID)
   -- System Information PERLU dimigrasi ke /api/v1/systems dulu
   sebelum halaman ini bisa dipakai penuh.

   PENYESUAIAN SKEMA (dibanding data dummy lama):
   - "Notes" tidak lagi kolom terpisah (tabel `tasks` cuma punya
     `description`) -- sekarang digabung ke akhir Description
     dengan prefix "Catatan: ...".
   - Rincian biaya (Hardware/Software/Transport) sekarang tersimpan
     di 3 kolom terpisah (`hardware_cost`/`software_cost`/
     `transport_cost`, lihat migration 003_task_cost_breakdown.sql)
     -- breakdown-nya utuh, bukan cuma total. Kolom `cost` (total)
     dihitung ulang otomatis di server tiap kali salah satu dari
     ketiganya berubah.
   - "Assign Technician" sekarang dropdown akun Staff sungguhan
     (dari GET /maintenance/assignable-staff?systemId=..., value =
     user id, DIFILTER ke staff project unit yang lagi dipilih),
     bukan daftar nama hardcoded -- supaya tugas benar-benar
     ter-assign ke akun staff (assigned_to) dan otomatis muncul di
     Task Maintenance staff itu. "Lainnya..." tetap ada untuk
     kasus teknisi eksternal tanpa akun (technicianName bebas,
     assignedTo dikosongkan -- task jenis ini TIDAK akan muncul di
     halaman Task Maintenance staff manapun, karena tidak ada
     assigned_to).
============================================================= */

(function () {

  let tmSubTab = "future";
  let tmFutureUnitFilter = "all";
  let tmFuturePriorityFilter = "all";
  let tmHistoryUnitFilter = "all";
  let tmScheduleEditId = null;   // task.id saat edit, null saat tambah baru
  let tmFutureDetailId = null;
  let tmHistoryDetailId = null;

  let tmScheduleTempFiles = [];     // File[] foto baru yang mau diupload
  let tmScheduleTempPreviews = [];  // object URL preview, paralel dgn tmScheduleTempFiles
  let tmScheduleExistingPhotos = []; // foto yang sudah ada di server (mode edit): [{id,url}]

  let tmFuturePage = 1;
  let tmHistoryPage = 1;
  const tmPageSize = 5;

  let tmAssignableStaff = []; // [{id, username, roleKey, roleLabel}]

  // window.__tmTasks -- cache di memori, sumber kebenaran selalu
  // di-refresh dari server (GET /maintenance/logs) tiap kali halaman
  // ini dibuka / ada perubahan.
  function getTasks() { return window.__tmTasks || (window.__tmTasks = []); }
  function getTaskById(id) { return getTasks().find((t) => t.id === id); }

  // ===========================================================
  // HELPERS
  // ===========================================================
  function getSystems() {
    const all = window.__siSystems || [];
    // window.__siActiveProjectId di-set oleh resolveActiveProjectId() di
    // system-information.js (dipanggil dari __siEnsureSystemsLoaded(),
    // yang SELALU di-await di initTaskManagement() sebelum getSystems()
    // dipakai) -- baca cache-nya di sini supaya konsisten satu sumber
    // kebenaran, dan supaya staff yang login langsung (tanpa proyek aktif
    // tersimpan di localStorage) tidak nyasar ke fallback "tawabi" yang
    // salah proyek (lihat catatan panjang di resolveActiveProjectId()).
    const active = (typeof window.PC_getActiveProject === "function") ? window.PC_getActiveProject() : null;
    const activeId = window.__siActiveProjectId || (active ? active.id : "tawabi");

    const taggedForActive = all.filter((s) => s.basic && s.basic.projectId === activeId);
    if (taggedForActive.length) return taggedForActive;

    const anyTagged = all.some((s) => s.basic && s.basic.projectId);
    if (!anyTagged) return all;
    return [];
  }

  // PENTING: system.id (dari window.__siSystems) adalah ID GABUNGAN
  // khusus tampilan frontend (mis. "sys-api-tawabi-<uuid>"), BUKAN UUID
  // asli Postgres -- lihat komentar di system-information.js pada baris
  // yang men-set `s.id`. UUID asli ada di system.systemId. Backend
  // /maintenance/* memvalidasi systemId sebagai UUID ke tabel `systems`,
  // jadi task.system_id yang tersimpan di DB SELALU system.systemId,
  // dan lookup di sini HARUS match ke situ juga -- bukan system.id.
  function getSystemById(systemId) {
    return getSystems().find((s) => s.systemId === systemId);
  }

  // Dipakai HANYA untuk menerima parameter dari project-monitoring.js
  // (window.pmGoToTaskManagement) yang masih mengirim system.id versi
  // lama (gabungan) -- resolve balik ke system.systemId (UUID asli)
  // supaya bisa dipakai konsisten dengan sisa halaman ini.
  function resolveSystemIdFromLegacyDisplayId(displayId) {
    const sys = getSystems().find((s) => s.id === displayId);
    return sys ? sys.systemId : displayId;
  }

  async function fetchTasks() {
    const data = await window.edashApiFetch("/maintenance/logs");
    window.__tmTasks = data || [];
  }

  // systemId opsional -- kalau diisi, backend resolve project dari unit
  // itu lalu balikin CUMA staff yang punya akses ke project tersebut
  // (lihat listAssignableStaffForSystem di maintenance.service.ts).
  // Tanpa systemId -> semua staff (dipakai sebagai fallback awal
  // sebelum operator memilih unit).
  async function fetchAssignableStaff(systemId) {
    try {
      const qs = systemId ? `?systemId=${encodeURIComponent(systemId)}` : "";
      tmAssignableStaff = await window.edashApiFetch(`/maintenance/assignable-staff${qs}`) || [];
    } catch (e) {
      console.warn("[task-management] Gagal ambil daftar staff:", e.message);
      tmAssignableStaff = [];
    }
  }

  function esc(str) {
    if (str === undefined || str === null || str === "") return "-";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtDate(d) {
    if (!d || d === "-") return "-";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  }

  function fmtRp(v) {
    const n = Number(v);
    if (!v || v === "-" || isNaN(n)) return "-";
    return "Rp " + n.toLocaleString("id-ID");
  }

  function dlRow(label, value, unit, noTranslate = false) {
    const v = (value === undefined || value === null || value === "") ? "-" : value;
    const dataAttr = noTranslate ? ' data-no-translate' : "";
    return `<div class="si-dl-row"><dt>${esc(label)}</dt><dd${dataAttr}>${esc(v)}${(v !== "-" && unit) ? " " + unit : ""}</dd></div>`;
  }

  function priorityTag(p) {
    const map = { high: "High", medium: "Medium", low: "Low" };
    return `<span class="si-priority si-priority-${p || "medium"}">${map[p] || "Medium"}</span>`;
  }

  function unitTag(sys) {
    if (!sys) return "";
    return `<span class="tm-unit-tag"><i class="fa-solid fa-solar-panel"></i>${esc(sys.basic.systemName)}</span>`;
  }

  function technicianLabel(task) {
    return task.assigned_to_username || task.technician_name || "-";
  }

  function photoUrl(photo) {
    return `${window.EDASH_BACKEND_API_BASE}${photo.url}`;
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };

  // Selalu dibatasi ke sistem-sistem milik project yang lagi aktif --
  // TERLEPAS dari filter unit yang dipilih ("Semua Unit" TIDAK berarti
  // "semua project", cuma "semua unit DI PROJECT INI"). Backend
  // GET /maintenance/logs tanpa systemId balikin task dari SEMUA
  // project sekaligus, jadi penyaringan per-project ini WAJIB
  // dilakukan di sini.
  function currentProjectSystemIds() {
    return new Set(getSystems().map((s) => s.systemId).filter(Boolean));
  }

  function collectFuture(unitFilter, priorityFilter) {
    const projectSystemIds = currentProjectSystemIds();
    const rows = getTasks().filter((t) => t.task_status !== "completed" && projectSystemIds.has(t.system_id));
    const filtered = rows.filter((t) => {
      if (unitFilter !== "all" && t.system_id !== unitFilter) return false;
      if (priorityFilter && priorityFilter !== "all" && (t.priority || "medium") !== priorityFilter) return false;
      return true;
    });
    filtered.sort((a, b) => {
      const pa = priorityOrder[a.priority || "medium"] ?? 1;
      const pb = priorityOrder[b.priority || "medium"] ?? 1;
      if (pa !== pb) return pa - pb;
      return (a.scheduled_date || "").localeCompare(b.scheduled_date || "");
    });
    return filtered;
  }

  function collectHistory(unitFilter) {
    const projectSystemIds = currentProjectSystemIds();
    const rows = getTasks().filter((t) => t.task_status === "completed" && projectSystemIds.has(t.system_id));
    const filtered = unitFilter === "all" ? rows : rows.filter((t) => t.system_id === unitFilter);
    filtered.sort((a, b) => (b.completed_date || "").localeCompare(a.completed_date || ""));
    return filtered;
  }

  // ===========================================================
  // INIT
  // ===========================================================
  window.initTaskManagement = async function () {
    tmSubTab = "future";
    tmFutureUnitFilter = "all";
    tmFuturePriorityFilter = "all";
    tmHistoryUnitFilter = "all";
    tmFuturePage = 1;
    tmHistoryPage = 1;

    if (typeof window.__siEnsureSystemsLoaded === "function") {
      await window.__siEnsureSystemsLoaded();
    }

    try {
      await fetchTasks();
    } catch (e) {
      console.warn("[task-management] Gagal ambil task dari server:", e.message);
      showToast("Gagal memuat data tugas dari server. Coba refresh halaman.");
      window.__tmTasks = window.__tmTasks || [];
    }
    // Daftar staff TIDAK di-fetch sekali di sini lagi -- sekarang selalu
    // dimuat ulang sesuai unit yang dipilih di form (lihat
    // refreshTechnicianOptions), supaya staff yang muncul selalu sesuai
    // project unit itu.

    populateUnitFilters();
    bindSubTabs();
    bindToolbar();
    bindScheduleModalEvents();
    bindDetailModalEvents();
    bindPhotoUpload();
    bindLightbox();

    renderStats();
    renderFutureList();
    renderHistoryList();
    showSubPanel("future");
  };

  // Refresh ringan dari server (dipanggil js/project-monitoring.js tiap
  // kali tab Task Management dibuka dalam satu kunjungan).
  window.__tmRefresh = async function () {
    populateUnitFilters();
    try { await fetchTasks(); } catch (e) { /* biarkan data lama tampil kalau refresh gagal */ }
    renderStats();
    renderFutureList();
    renderHistoryList();
  };

  document.addEventListener("edash:activeprojectchange", () => {
    window.__tmRefresh();
  });

  // ===========================================================
  // SUB TAB SWITCHING
  // ===========================================================
  function bindSubTabs() {
    document.querySelectorAll("#tmSubtabs .tm-subtab").forEach((btn) => {
      btn.onclick = () => {
        tmSubTab = btn.getAttribute("data-subtab");
        document.querySelectorAll("#tmSubtabs .tm-subtab").forEach((b) => {
          b.classList.toggle("is-active", b === btn);
        });
        showSubPanel(tmSubTab);
      };
    });
  }

  function showSubPanel(tab) {
    document.querySelectorAll(".tm-subpanel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.getAttribute("data-subpanel") === tab);
    });
  }

  // ===========================================================
  // STATS ROW
  // ===========================================================
  function renderStats() {
    const row = document.getElementById("tmStatsRow");
    if (!row) return;

    const allFuture = collectFuture("all", "all");
    const highPriority = allFuture.filter((t) => t.priority === "high").length;
    const allHistory = collectHistory("all");

    row.innerHTML = `
      <div class="si-stat-card">
        <div class="si-stat-icon si-stat-icon-total"><i class="fa-solid fa-calendar-days"></i></div>
        <div>
          <div class="si-stat-value">${allFuture.length}</div>
          <div class="si-stat-label">Jadwal Mendatang</div>
        </div>
      </div>
      <div class="si-stat-card">
        <div class="si-stat-icon si-stat-icon-danger"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div>
          <div class="si-stat-value si-stat-danger">${highPriority}</div>
          <div class="si-stat-label">Prioritas Tinggi</div>
        </div>
      </div>
      <div class="si-stat-card">
        <div class="si-stat-icon si-stat-icon-connected"><i class="fa-solid fa-clock-rotate-left"></i></div>
        <div>
          <div class="si-stat-value si-stat-connected">${allHistory.length}</div>
          <div class="si-stat-label">Riwayat Selesai</div>
        </div>
      </div>`;
  }

  // ===========================================================
  // UNIT FILTER DROPDOWNS
  // ===========================================================
  function populateUnitFilters() {
    // Unit tanpa systemId (UUID asli belum ke-resolve dari backend --
    // lihat catatan di getSystemById) DISEMBUNYIKAN dari dropdown, biar
    // operator tidak bisa pilih unit yang pasti akan gagal saat submit
    // (SYSTEM_NOT_FOUND).
    const options = getSystems()
      .filter((s) => s.systemId)
      .map((s) => `<option value="${s.systemId}">${esc(s.basic.systemName)}</option>`)
      .join("");

    const futureFilter = document.getElementById("tmFutureUnitFilter");
    const historyFilter = document.getElementById("tmHistoryUnitFilter");
    const unitSelect = document.getElementById("tmUnitSelect");

    if (futureFilter) futureFilter.innerHTML = `<option value="all">Semua Unit</option>${options}`;
    if (historyFilter) historyFilter.innerHTML = `<option value="all">Semua Unit</option>${options}`;
    if (unitSelect) unitSelect.innerHTML = `<option value="">Pilih unit</option>${options}`;
  }

  // Isi ulang <select name="technician"> dengan akun Staff sungguhan
  // (value = user id -> assignedTo), + "Lainnya..." untuk teknisi
  // eksternal tanpa akun.
  function populateTechnicianOptions(form) {
    const select = form.querySelector('[name="technician"]');
    if (!select) return;
    if (!tmAssignableStaff.length) {
      select.innerHTML = `<option value="">Pilih unit terlebih dahulu</option><option value="other">Lainnya...</option>`;
      return;
    }
    const options = tmAssignableStaff.map((u) => `<option value="${u.id}">${esc(u.username)}</option>`).join("");
    select.innerHTML = `<option value="">Pilih teknisi</option>${options}<option value="other">Lainnya...</option>`;
  }

  // Fetch ulang staff sesuai unit yang lagi kepilih, render dropdown-nya,
  // lalu (kalau ada) preselect staff yang sudah ter-assign sebelumnya --
  // dipanggil tiap modal dibuka DAN tiap operator ganti pilihan unit.
  async function refreshTechnicianOptions(form, systemId, preselectStaffId) {
    const select = form.querySelector('[name="technician"]');
    if (select) select.innerHTML = `<option value="">Memuat staff...</option>`;
    await fetchAssignableStaff(systemId);
    populateTechnicianOptions(form);
    if (preselectStaffId && select && tmAssignableStaff.some((u) => u.id === preselectStaffId)) {
      select.value = preselectStaffId;
    }
  }

  function bindToolbar() {
    const futureFilter = document.getElementById("tmFutureUnitFilter");
    const futurePriorityFilter = document.getElementById("tmFuturePriorityFilter");
    const historyFilter = document.getElementById("tmHistoryUnitFilter");
    const addBtn = document.getElementById("tmAddFutureBtn");

    if (futureFilter) {
      futureFilter.value = tmFutureUnitFilter;
      futureFilter.onchange = () => {
        tmFutureUnitFilter = futureFilter.value;
        tmFuturePage = 1;
        renderFutureList();
      };
    }

    if (futurePriorityFilter) {
      futurePriorityFilter.value = tmFuturePriorityFilter;
      futurePriorityFilter.onchange = () => {
        tmFuturePriorityFilter = futurePriorityFilter.value;
        tmFuturePage = 1;
        renderFutureList();
      };
    }

    if (historyFilter) {
      historyFilter.value = tmHistoryUnitFilter;
      historyFilter.onchange = () => {
        tmHistoryUnitFilter = historyFilter.value;
        tmHistoryPage = 1;
        renderHistoryList();
      };
    }

    if (addBtn) addBtn.onclick = () => openScheduleModal(null, null);
  }

  // ===========================================================
  // FUTURE MAINTENANCE LIST
  // ===========================================================
  function renderFutureList() {
    const list = document.getElementById("tmFutureList");
    const count = document.getElementById("tmFutureCount");
    if (!list) return;

    const rows = collectFuture(tmFutureUnitFilter, tmFuturePriorityFilter);
    if (count) count.textContent = rows.length ? ` (${rows.length})` : "";

    if (!rows.length) {
      list.innerHTML = `<div class="si-empty-inline">Belum ada jadwal maintenance mendatang.</div>`;
      renderPaginationControls("tmFuturePagination", 1, 1, null);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / tmPageSize));
    if (tmFuturePage > totalPages) tmFuturePage = totalPages;
    if (tmFuturePage < 1) tmFuturePage = 1;
    const startIdx = (tmFuturePage - 1) * tmPageSize;
    const pageRows = rows.slice(startIdx, startIdx + tmPageSize);

    list.innerHTML = pageRows.map((task) => {
      const sys = getSystemById(task.system_id);
      return `
        <div class="si-maint-item" data-id="${task.id}">
          <div class="si-maint-icon"><i class="fa-solid fa-screwdriver-wrench"></i></div>
          <div class="si-maint-body">
            <div class="si-maint-title" data-no-translate>${esc(task.title)}</div>
            ${task.description ? `<div class="si-maint-desc" data-no-translate>${esc(task.description)}</div>` : ""}
            <div class="si-maint-tags">
              ${unitTag(sys)}
              <span class="si-tag"><i class="fa-solid fa-calendar"></i>${fmtDate(task.scheduled_date)}</span>
              <span class="si-tag"><i class="fa-solid fa-user"></i>${esc(technicianLabel(task))}</span>
              ${priorityTag(task.priority)}
              ${task.task_status === "accepted" ? `<span class="si-badge tkm-status-accepted">Sedang Dikerjakan (${task.progress_pct}%)</span>` : ""}
            </div>
          </div>
          <div class="si-maint-actions">
            <button class="si-btn si-btn-secondary si-btn-sm tm-edit-future-btn" data-id="${task.id}" type="button">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="si-btn si-btn-danger-ghost si-btn-sm tm-delete-future-btn" data-id="${task.id}" type="button">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join("");

    document.querySelectorAll("#tmFutureList .si-maint-item").forEach((item) => {
      item.onclick = () => openFutureDetail(item.getAttribute("data-id"));
    });

    document.querySelectorAll(".tm-edit-future-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openScheduleModal(btn.getAttribute("data-id"));
      };
    });

    document.querySelectorAll(".tm-delete-future-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        deleteTask(btn.getAttribute("data-id"));
      };
    });

    renderPaginationControls("tmFuturePagination", totalPages, tmFuturePage, (n) => {
      tmFuturePage = n;
      renderFutureList();
    });
  }

  // ===========================================================
  // GENERIC PAGINATION RENDERER
  // ===========================================================
  function renderPaginationControls(wrapId, totalPages, currentPage, onChange) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;

    totalPages = Math.max(1, totalPages);
    currentPage = Math.max(1, Math.min(currentPage, totalPages));

    let pageNums = [];
    const addNum = (n) => { if (!pageNums.includes(n) && n >= 1 && n <= totalPages) pageNums.push(n); };
    addNum(1); addNum(totalPages); addNum(currentPage - 1); addNum(currentPage); addNum(currentPage + 1);
    pageNums = pageNums.sort((a, b) => a - b);

    let html = `<button class="si-page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""} aria-label="Sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>`;
    let prev = 0;
    pageNums.forEach((n) => {
      if (prev && n - prev > 1) html += `<span class="si-page-ellipsis">…</span>`;
      html += `<button class="si-page-btn ${n === currentPage ? "is-active" : ""}" data-page="${n}">${n}</button>`;
      prev = n;
    });
    html += `<button class="si-page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""} aria-label="Berikutnya"><i class="fa-solid fa-chevron-right"></i></button>`;

    wrap.innerHTML = html;

    wrap.querySelectorAll(".si-page-btn").forEach((btn) => {
      btn.onclick = () => {
        const n = parseInt(btn.getAttribute("data-page"), 10);
        if (!n || n < 1 || n > totalPages || n === currentPage || !onChange) return;
        onChange(n);
      };
    });
  }

  async function deleteTask(id) {
    const task = getTaskById(id);
    if (!task) return;
    if (!window.confirm(`Hapus jadwal maintenance "${task.title}"? Tindakan ini tidak bisa dibatalkan.`)) return;

    try {
      await window.edashApiFetch(`/maintenance/logs/${id}`, { method: "DELETE" });
      window.__tmTasks = getTasks().filter((t) => t.id !== id);
      renderFutureList();
      renderHistoryList();
      renderStats();
      showToast("Jadwal maintenance dihapus.");

      if (typeof window.hdLogTaskDeleted === "function") {
        const sys = getSystemById(task.system_id);
        if (sys) window.hdLogTaskDeleted(sys, task);
      }
    } catch (e) {
      showToast("Gagal menghapus: " + e.message);
    }
  }

  // ===========================================================
  // HISTORICAL MAINTENANCE LIST
  // ===========================================================
  function renderHistoryList() {
    const list = document.getElementById("tmHistoryList");
    const count = document.getElementById("tmHistoryCount");
    if (!list) return;

    const rows = collectHistory(tmHistoryUnitFilter);
    if (count) count.textContent = rows.length ? ` (${rows.length})` : "";

    if (!rows.length) {
      list.innerHTML = `<div class="si-empty-inline">Belum ada riwayat maintenance.</div>`;
      renderPaginationControls("tmHistoryPagination", 1, 1, null);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / tmPageSize));
    if (tmHistoryPage > totalPages) tmHistoryPage = totalPages;
    if (tmHistoryPage < 1) tmHistoryPage = 1;
    const startIdx = (tmHistoryPage - 1) * tmPageSize;
    const pageRows = rows.slice(startIdx, startIdx + tmPageSize);

    list.innerHTML = pageRows.map((task) => {
      const sys = getSystemById(task.system_id);
      return `
        <div class="si-timeline-item">
          <div class="si-timeline-dot"><i class="fa-solid fa-check"></i></div>
          <div class="si-timeline-card" data-id="${task.id}">
            <div class="si-timeline-head">
              <div>
                <h4 data-no-translate>${esc(task.title)}</h4>
                <div class="si-timeline-dates">Diterima: ${fmtDate(task.accepted_at)} &nbsp;·&nbsp; Selesai: ${fmtDate(task.completed_date)}</div>
              </div>
              <span class="si-badge si-badge-connected">Completed</span>
            </div>
            <div class="si-maint-tags" style="margin-bottom:8px;">${unitTag(sys)}</div>
            <div class="si-timeline-grid">
              <div><b>Problem</b><span data-no-translate>${esc(task.description)}</span></div>
              <div><b>Action Taken</b><span data-no-translate>${esc(task.completion_description)}</span></div>
              <div><b>Status</b>Completed</div>
            </div>
            <div class="si-timeline-tech">
              <span class="si-avatar-sm"><i class="fa-solid fa-user"></i></span>
              ${esc(technicianLabel(task))}
            </div>
          </div>
        </div>
      `;
    }).join("");

    document.querySelectorAll("#tmHistoryList .si-timeline-card").forEach((card) => {
      card.onclick = () => openHistoryDetail(card.getAttribute("data-id"));
    });

    renderPaginationControls("tmHistoryPagination", totalPages, tmHistoryPage, (n) => {
      tmHistoryPage = n;
      renderHistoryList();
    });
  }

  // ===========================================================
  // ADD / EDIT SCHEDULE MODAL
  // ===========================================================
  function setSchedulePriority(form, priority) {
    form.querySelector('[name="priority"]').value = priority || "medium";
    form.querySelectorAll(".si-priority-opt").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.getAttribute("data-value") === (priority || "medium"));
    });
  }

  async function openScheduleModal(taskId, presetUnitId) {
    tmScheduleEditId = taskId || null;
    const task = taskId ? getTaskById(taskId) : null;

    const form = document.getElementById("tmScheduleForm");
    form.reset();
    document.querySelectorAll("#tmScheduleForm .si-conditional-field").forEach((el) => el.classList.remove("is-visible"));
    document.querySelectorAll("#tmScheduleForm .si-field").forEach((f) => f.classList.remove("has-error"));

    tmAssignableStaff = [];
    populateTechnicianOptions(form);

    const unitSelect = document.getElementById("tmUnitSelect");
    const techSelect = form.querySelector('[name="technician"]');
    const techCustom = form.querySelector('[name="technicianCustom"]');

    document.getElementById("tmScheduleModalTitle").textContent = task ? "Edit Schedule" : "Tambah Unit Bermasalah";

    tmScheduleTempFiles = [];
    tmScheduleTempPreviews.forEach((url) => URL.revokeObjectURL(url));
    tmScheduleTempPreviews = [];
    tmScheduleExistingPhotos = task ? (task.photos || []).slice() : [];

    if (task) {
      unitSelect.value = task.system_id;
      form.querySelector('[name="title"]').value = task.title || "";
      form.querySelector('[name="description"]').value = task.description || "";
      form.querySelector('[name="scheduledDate"]').value = task.scheduled_date || "";
      setSchedulePriority(form, task.priority);
      form.querySelector('[name="itemsPurchased"]').value = task.items_purchased || "";
      form.querySelector('[name="hardwareExpense"]').value = (task.hardware_cost && Number(task.hardware_cost) > 0) ? task.hardware_cost : "";
      form.querySelector('[name="softwareCost"]').value = (task.software_cost && Number(task.software_cost) > 0) ? task.software_cost : "";
      form.querySelector('[name="transportCost"]').value = (task.transport_cost && Number(task.transport_cost) > 0) ? task.transport_cost : "";
    } else {
      unitSelect.value = presetUnitId || "";
      setSchedulePriority(form, "medium");
    }

    renderPhotoThumbs();

    // Dropdown teknisi di-muat ULANG sesuai unit yang lagi kepilih --
    // backend cuma balikin staff yang punya akses ke project unit ini
    // (lihat listAssignableStaffForSystem()), jadi Operator tidak akan
    // pernah bisa assign staff dari project lain.
    await refreshTechnicianOptions(form, unitSelect.value || null, task ? task.assigned_to : null);

    if (task) {
      if (!(task.assigned_to && techSelect.value === task.assigned_to) && task.technician_name && task.technician_name !== "-") {
        techSelect.value = "other";
        techCustom.value = task.technician_name;
        techCustom.classList.add("is-visible");
      } else if (!task.assigned_to) {
        techSelect.value = "";
      }
    }

    unitSelect.onchange = () => {
      techCustom.classList.remove("is-visible");
      refreshTechnicianOptions(form, unitSelect.value || null, null);
    };
    techSelect.onchange = () => techCustom.classList.toggle("is-visible", techSelect.value === "other");

    document.getElementById("tmScheduleOverlay").classList.add("is-open");
  }

  function closeScheduleModal() {
    document.getElementById("tmScheduleOverlay").classList.remove("is-open");
  }

  // ===========================================================
  // PHOTO UPLOAD (Add/Edit Future Maintenance form)
  // File asli disimpan di memori & dikirim sebagai multipart saat
  // Save -- BUKAN base64 lagi. Foto yang SUDAH ADA di server (mode
  // edit) ditampilkan dari tmScheduleExistingPhotos dengan tombol
  // hapus yang langsung memanggil DELETE /maintenance/photos/:id.
  // ===========================================================
  function bindPhotoUpload() {
    const addBtn = document.getElementById("tmPhotoAddBtn");
    const input = document.getElementById("tmPhotoInput");
    if (!addBtn || !input) return;

    addBtn.onclick = () => input.click();

    input.onchange = () => {
      const files = Array.from(input.files || []);
      files.forEach((file) => {
        tmScheduleTempFiles.push(file);
        tmScheduleTempPreviews.push(URL.createObjectURL(file));
      });
      renderPhotoThumbs();
      input.value = "";
    };
  }

  function renderPhotoThumbs() {
    const wrap = document.getElementById("tmPhotoUpload");
    if (!wrap) return;
    const addBtn = document.getElementById("tmPhotoAddBtn");

    wrap.querySelectorAll(".tm-photo-thumb").forEach((el) => el.remove());

    // Foto lama (sudah tersimpan di server)
    tmScheduleExistingPhotos.forEach((photo) => {
      const thumb = document.createElement("div");
      thumb.className = "tm-photo-thumb";
      thumb.innerHTML = `
        <img src="${photoUrl(photo)}" alt="Foto">
        <button type="button" class="tm-photo-remove" title="Hapus foto"><i class="fa-solid fa-xmark"></i></button>
      `;
      thumb.querySelector(".tm-photo-remove").onclick = async () => {
        if (!window.confirm("Hapus foto ini dari server?")) return;
        try {
          await window.edashApiFetch(`/maintenance/photos/${photo.id}`, { method: "DELETE" });
          tmScheduleExistingPhotos = tmScheduleExistingPhotos.filter((p) => p.id !== photo.id);
          renderPhotoThumbs();
        } catch (e) {
          showToast("Gagal hapus foto: " + e.message);
        }
      };
      wrap.insertBefore(thumb, addBtn);
    });

    // Foto baru (belum diupload, masih di memori)
    tmScheduleTempPreviews.forEach((src, idx) => {
      const thumb = document.createElement("div");
      thumb.className = "tm-photo-thumb";
      thumb.innerHTML = `
        <img src="${src}" alt="Foto baru ${idx + 1}">
        <button type="button" class="tm-photo-remove" title="Batalkan foto"><i class="fa-solid fa-xmark"></i></button>
      `;
      thumb.querySelector(".tm-photo-remove").onclick = () => {
        URL.revokeObjectURL(tmScheduleTempPreviews[idx]);
        tmScheduleTempPreviews.splice(idx, 1);
        tmScheduleTempFiles.splice(idx, 1);
        renderPhotoThumbs();
      };
      wrap.insertBefore(thumb, addBtn);
    });
  }

  // ===========================================================
  // LIGHTBOX
  // ===========================================================
  function bindLightbox() {
    const overlay = document.getElementById("tmLightboxOverlay");
    const closeBtn = document.getElementById("tmLightboxCloseBtn");
    if (!overlay || !closeBtn) return;

    closeBtn.onclick = () => overlay.classList.remove("is-open");
    overlay.onclick = (e) => {
      if (e.target.id === "tmLightboxOverlay") overlay.classList.remove("is-open");
    };
  }

  function openLightbox(src) {
    const overlay = document.getElementById("tmLightboxOverlay");
    const img = document.getElementById("tmLightboxImg");
    if (!overlay || !img) return;
    img.src = src;
    overlay.classList.add("is-open");
  }

  async function saveScheduleModal() {
    const form = document.getElementById("tmScheduleForm");

    const unitSelect = document.getElementById("tmUnitSelect");
    const unitField = unitSelect.closest(".si-field");
    const dateInput = form.querySelector('[name="scheduledDate"]');
    const dateField = dateInput.closest(".si-field");

    let hasError = false;

    if (!unitSelect.value) { unitField.classList.add("has-error"); hasError = true; }
    else unitField.classList.remove("has-error");

    if (!dateInput.value) {
      dateField.classList.add("has-error");
      dateInput.classList.add("is-invalid");
      hasError = true;
    } else {
      dateField.classList.remove("has-error");
      dateInput.classList.remove("is-invalid");
    }

    if (hasError) return;

    const fd = new FormData(form);
    const technicianRaw = fd.get("technician") || "";
    const isCustomTechnician = technicianRaw === "other";

    const hw = Number(fd.get("hardwareExpense")) || 0;
    const sw = Number(fd.get("softwareCost")) || 0;
    const tr = Number(fd.get("transportCost")) || 0;

    const notesRaw = (fd.get("notes") || "").trim();
    let description = (fd.get("description") || "").trim();
    if (notesRaw) description = description ? `${description}\n\nCatatan: ${notesRaw}` : `Catatan: ${notesRaw}`;

    const payload = new FormData();
    payload.set("systemId", unitSelect.value);
    payload.set("maintenanceType", "General"); // kolom wajib di backend, UI ini tidak punya field terpisah untuk ini
    payload.set("title", fd.get("title") || "Untitled Maintenance");
    payload.set("description", description);
    payload.set("scheduledDate", fd.get("scheduledDate") || "");
    payload.set("priority", fd.get("priority") || "medium");
    payload.set("itemsPurchased", fd.get("itemsPurchased") || "");
    // 3 kolom terpisah di backend (hardware_cost/software_cost/
    // transport_cost) -- total (`cost`) dihitung ulang otomatis di
    // server dari ketiganya, tidak perlu dikirim dari sini.
    payload.set("hardwareCost", String(hw));
    payload.set("softwareCost", String(sw));
    payload.set("transportCost", String(tr));

    if (isCustomTechnician) {
      payload.set("technicianName", fd.get("technicianCustom") || "Lainnya");
      payload.set("assignedTo", "");
    } else if (technicianRaw) {
      payload.set("assignedTo", technicianRaw);
      payload.set("technicianName", "");
    }

    tmScheduleTempFiles.forEach((f) => payload.append("files", f));

    const saveBtn = document.getElementById("tmScheduleSaveBtn");
    saveBtn.disabled = true;
    try {
      let saved;
      if (tmScheduleEditId) {
        saved = await window.edashApiFetch(`/maintenance/logs/${tmScheduleEditId}`, { method: "PATCH", body: payload });
        const idx = getTasks().findIndex((t) => t.id === tmScheduleEditId);
        if (idx !== -1) window.__tmTasks[idx] = saved;

        if (typeof window.hdLogTaskEdited === "function") {
          const sys = getSystemById(saved.system_id);
          if (sys) window.hdLogTaskEdited(sys, 0, saved);
        }
      } else {
        saved = await window.edashApiFetch("/maintenance/logs", { method: "POST", body: payload });
        getTasks().push(saved);

        if (typeof window.hdLogTaskCreated === "function") {
          const sys = getSystemById(saved.system_id);
          if (sys) window.hdLogTaskCreated("task-future", sys, 0, saved);
        }
      }

      closeScheduleModal();
      renderFutureList();
      renderStats();
      showToast("Jadwal maintenance disimpan.");
    } catch (e) {
      showToast("Gagal menyimpan: " + e.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  function bindScheduleModalEvents() {
    document.getElementById("tmScheduleCloseBtn").onclick = closeScheduleModal;
    document.getElementById("tmScheduleCancelBtn").onclick = closeScheduleModal;
    document.getElementById("tmScheduleSaveBtn").onclick = saveScheduleModal;
    document.getElementById("tmScheduleOverlay").onclick = (e) => {
      if (e.target.id === "tmScheduleOverlay") closeScheduleModal();
    };

    document.querySelectorAll("#tmScheduleForm .si-priority-opt").forEach((btn) => {
      btn.onclick = () => setSchedulePriority(document.getElementById("tmScheduleForm"), btn.getAttribute("data-value"));
    });
  }

  // Dipanggil dari System Information saat user klik "Ajukan Task
  // Maintenance" pada unit tertentu.
  // unitId yang masuk ke sini dikirim window.pmGoToTaskManagement
  // (project-monitoring.js), yang masih memakai system.id versi LAMA
  // (ID gabungan tampilan) -- resolve dulu ke systemId (UUID asli)
  // sebelum dipakai di form, lihat resolveSystemIdFromLegacyDisplayId().
  window.tmOpenAddForUnit = function (unitId) {
    tmSubTab = "future";
    document.querySelectorAll("#tmSubtabs .tm-subtab").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-subtab") === "future");
    });
    showSubPanel("future");

    const futureFilter = document.getElementById("tmFutureUnitFilter");
    const futurePriorityFilter = document.getElementById("tmFuturePriorityFilter");
    if (futureFilter) { futureFilter.value = "all"; tmFutureUnitFilter = "all"; }
    if (futurePriorityFilter) { futurePriorityFilter.value = "all"; tmFuturePriorityFilter = "all"; }
    tmFuturePage = 1;
    renderFutureList();

    openScheduleModal(null, resolveSystemIdFromLegacyDisplayId(unitId));
  };

  // Dipanggil dari bell notifikasi (klik notifikasi task) untuk
  // menyorot entry yang dimaksud.
  window.tmFocusEntry = function (kind, taskId) {
    const task = getTaskById(taskId);
    if (!task) return;
    const isHistory = task.task_status === "completed";
    tmSubTab = isHistory ? "history" : "future";

    document.querySelectorAll("#tmSubtabs .tm-subtab").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-subtab") === tmSubTab);
    });
    showSubPanel(tmSubTab);

    if (isHistory) {
      const historyFilter = document.getElementById("tmHistoryUnitFilter");
      if (historyFilter) historyFilter.value = "all";
      tmHistoryUnitFilter = "all";
      const rows = collectHistory("all");
      const rowIdx = rows.findIndex((t) => t.id === taskId);
      if (rowIdx === -1) return;
      tmHistoryPage = Math.floor(rowIdx / tmPageSize) + 1;
      renderHistoryList();
    } else {
      const futureFilter = document.getElementById("tmFutureUnitFilter");
      if (futureFilter) futureFilter.value = "all";
      tmFutureUnitFilter = "all";
      const futurePriorityFilter = document.getElementById("tmFuturePriorityFilter");
      if (futurePriorityFilter) futurePriorityFilter.value = "all";
      tmFuturePriorityFilter = "all";
      const rows = collectFuture("all", "all");
      const rowIdx = rows.findIndex((t) => t.id === taskId);
      if (rowIdx === -1) return;
      tmFuturePage = Math.floor(rowIdx / tmPageSize) + 1;
      renderFutureList();
    }

    setTimeout(() => {
      const selector = isHistory
        ? `.si-timeline-card[data-id="${taskId}"]`
        : `.si-maint-item[data-id="${taskId}"]`;
      const el = document.querySelector(selector);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("tm-flash-highlight");
      setTimeout(() => el.classList.remove("tm-flash-highlight"), 2400);
    }, 30);
  };

  // ===========================================================
  // DETAIL MODALS (Future & Historical)
  // ===========================================================
  function openFutureDetail(taskId) {
    const task = getTaskById(taskId);
    if (!task) return;
    const sys = getSystemById(task.system_id);
    tmFutureDetailId = taskId;

    document.getElementById("tmFutureDetailTitle").textContent = task.title || "-";
    document.getElementById("tmFutureDetailTags").innerHTML = `
      ${unitTag(sys)}
      <span class="si-tag"><i class="fa-solid fa-calendar"></i>${fmtDate(task.scheduled_date)}</span>
      <span class="si-tag"><i class="fa-solid fa-user"></i>${esc(technicianLabel(task))}</span>
      ${priorityTag(task.priority)}
    `;
    document.getElementById("tmFutureDetailDl").innerHTML = [
      dlRow("Unit", sys ? sys.basic.systemName : "-"),
      dlRow("Maintenance Title", task.title, null, true),
      dlRow("Scheduled Date", fmtDate(task.scheduled_date)),
      dlRow("Assigned Technician", technicianLabel(task)),
      dlRow("Priority", (task.priority || "medium").charAt(0).toUpperCase() + (task.priority || "medium").slice(1)),
      dlRow("Status", task.task_status === "accepted" ? `Sedang Dikerjakan (${task.progress_pct}%)` : "Upcoming")
    ].join("");

    const descWrap = document.getElementById("tmFutureDetailDescWrap");
    if (task.description) { descWrap.style.display = ""; document.getElementById("tmFutureDetailDesc").textContent = task.description; }
    else descWrap.style.display = "none";

    const notesWrap = document.getElementById("tmFutureDetailNotesWrap");
    if (notesWrap) notesWrap.style.display = "none"; // digabung ke Description, lihat catatan skema di header file

    const photosWrap = document.getElementById("tmFutureDetailPhotosWrap");
    const photos = task.photos || [];
    if (photos.length) {
      photosWrap.style.display = "";
      const grid = document.getElementById("tmFutureDetailPhotos");
      grid.innerHTML = photos.map((p, i) => `<img src="${photoUrl(p)}" alt="Foto ${i + 1}">`).join("");
      grid.querySelectorAll("img").forEach((img) => { img.onclick = () => openLightbox(img.src); });
    } else {
      photosWrap.style.display = "none";
    }

    const itemsWrap = document.getElementById("tmFutureDetailItemsWrap");
    if (task.items_purchased) { itemsWrap.style.display = ""; document.getElementById("tmFutureDetailItems").textContent = task.items_purchased; }
    else itemsWrap.style.display = "none";

    const costWrap = document.getElementById("tmFutureDetailCostWrap");
    const hw = Number(task.hardware_cost) || 0;
    const sw = Number(task.software_cost) || 0;
    const tr = Number(task.transport_cost) || 0;
    const total = hw + sw + tr;
    if (total > 0) {
      costWrap.style.display = "";
      const rows = [];
      if (hw > 0) rows.push(`<div class="tm-cost-row"><span>Hardware Expenses</span><span>${fmtRp(hw)}</span></div>`);
      if (sw > 0) rows.push(`<div class="tm-cost-row"><span>Software Cost</span><span>${fmtRp(sw)}</span></div>`);
      if (tr > 0) rows.push(`<div class="tm-cost-row"><span>Transport Cost</span><span>${fmtRp(tr)}</span></div>`);
      rows.push(`<div class="tm-cost-row tm-cost-total"><span>Total Cost</span><span>${fmtRp(total)}</span></div>`);
      document.getElementById("tmFutureDetailCost").innerHTML = rows.join("");
    } else {
      costWrap.style.display = "none";
    }

    document.getElementById("tmFutureDetailOverlay").classList.add("is-open");
  }

  function closeFutureDetail() {
    document.getElementById("tmFutureDetailOverlay").classList.remove("is-open");
  }

  function openHistoryDetail(taskId) {
    const task = getTaskById(taskId);
    if (!task) return;
    const sys = getSystemById(task.system_id);
    tmHistoryDetailId = taskId;

    document.getElementById("tmHistoryDetailTitle").textContent = task.title || "-";
    document.getElementById("tmHistoryDetailTags").innerHTML = `
      ${unitTag(sys)}
      <span class="si-tag"><i class="fa-solid fa-calendar-check"></i>${fmtDate(task.completed_date)}</span>
      <span class="si-tag"><i class="fa-solid fa-user"></i>${esc(technicianLabel(task))}</span>
      <span class="si-badge si-badge-connected">Completed</span>
    `;
    document.getElementById("tmHistoryDetailDl").innerHTML = [
      dlRow("Unit", sys ? sys.basic.systemName : "-"),
      dlRow("Maintenance Title", task.title, null, true),
      dlRow("Start Date", fmtDate(task.accepted_at || task.scheduled_date)),
      dlRow("Completed Date", fmtDate(task.completed_date)),
      dlRow("Technician", technicianLabel(task)),
      dlRow("Status", "Completed")
    ].join("");

    document.getElementById("tmHistoryDetailProblem").textContent = task.description || "-";
    document.getElementById("tmHistoryDetailAction").textContent = task.completion_description || "-";

    const notesWrap = document.getElementById("tmHistoryDetailNotesWrap");
    if (notesWrap) notesWrap.style.display = "none";

    const photosWrap = document.getElementById("tmHistoryDetailPhotosWrap");
    const photos = task.photos || [];
    if (photos.length) {
      photosWrap.style.display = "";
      const grid = document.getElementById("tmHistoryDetailPhotos");
      grid.innerHTML = photos.map((p, i) => `<img src="${photoUrl(p)}" alt="Foto ${i + 1}">`).join("");
      grid.querySelectorAll("img").forEach((img) => { img.onclick = () => openLightbox(img.src); });
    } else {
      photosWrap.style.display = "none";
    }

    const itemsWrap = document.getElementById("tmHistoryDetailItemsWrap");
    if (task.items_purchased) {
      itemsWrap.style.display = "";
      document.getElementById("tmHistoryDetailItems").textContent = task.items_purchased;
    } else {
      itemsWrap.style.display = "none";
    }

    const costWrap = document.getElementById("tmHistoryDetailCostWrap");
    if (costWrap) {
      const hw = Number(task.hardware_cost) || 0;
      const sw = Number(task.software_cost) || 0;
      const tr = Number(task.transport_cost) || 0;
      const total = hw + sw + tr;
      if (total > 0) {
        costWrap.style.display = "";
        const rows = [];
        if (hw > 0) rows.push(`<div class="tm-cost-row"><span>Hardware Expenses</span><span>${fmtRp(hw)}</span></div>`);
        if (sw > 0) rows.push(`<div class="tm-cost-row"><span>Software Cost</span><span>${fmtRp(sw)}</span></div>`);
        if (tr > 0) rows.push(`<div class="tm-cost-row"><span>Transport Cost</span><span>${fmtRp(tr)}</span></div>`);
        rows.push(`<div class="tm-cost-row tm-cost-total"><span>Total Cost</span><span>${fmtRp(total)}</span></div>`);
        document.getElementById("tmHistoryDetailCost").innerHTML = rows.join("");
      } else {
        costWrap.style.display = "none";
      }
    }

    document.getElementById("tmHistoryDetailOverlay").classList.add("is-open");
  }

  function closeHistoryDetail() {
    document.getElementById("tmHistoryDetailOverlay").classList.remove("is-open");
  }

  function bindDetailModalEvents() {
    document.getElementById("tmFutureDetailCloseBtn").onclick = closeFutureDetail;
    document.getElementById("tmFutureDetailCloseBtn2").onclick = closeFutureDetail;
    document.getElementById("tmFutureDetailOverlay").onclick = (e) => {
      if (e.target.id === "tmFutureDetailOverlay") closeFutureDetail();
    };
    document.getElementById("tmFutureDetailEditBtn").onclick = () => {
      if (!tmFutureDetailId) return;
      closeFutureDetail();
      openScheduleModal(tmFutureDetailId);
    };
    document.getElementById("tmFutureDetailDeleteBtn").onclick = () => {
      if (!tmFutureDetailId) return;
      closeFutureDetail();
      deleteTask(tmFutureDetailId);
    };

    document.getElementById("tmHistoryDetailCloseBtn").onclick = closeHistoryDetail;
    document.getElementById("tmHistoryDetailCloseBtn2").onclick = closeHistoryDetail;
    document.getElementById("tmHistoryDetailOverlay").onclick = (e) => {
      if (e.target.id === "tmHistoryDetailOverlay") closeHistoryDetail();
    };
  }

  // ===========================================================
  // TOAST
  // ===========================================================
  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById("tmToast");
    if (!toast) return;
    document.getElementById("tmToastMsg").textContent = msg;
    toast.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-show"), 2800);
  }

})();
