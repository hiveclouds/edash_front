/* ============================================================
   Task Maintenance — 360eDash
   Halaman viewer/staff untuk mengerjakan task maintenance yang
   di-assign Operator (dibuat lewat Project Monitoring > Task
   Management).

   PERSISTENCE (REVISI):
   Task (task_status pending/accepted/completed, progress_pct,
   progress_note, accepted_at, completion_description,
   items_purchased, foto) SEKARANG disimpan di PostgreSQL lewat
   backend Hono (edashboard_api), tabel `tasks` + `task_photos` —
   BUKAN lagi lewat sinkronisasi manual dengan
   window.__siSystems.futureMaintenance.

   Konsekuensinya, dibanding versi lama:
   - Tidak ada lagi syncTasksWithSystems()/genMaintId()/futureId —
     task di sini SAMA PERSIS dengan row yang dibuat Operator di
     Task Management (satu sumber data, tabel `tasks`), tidak ada
     lagi proses "sinkron 2 arah" yang rawan drift.
   - "Milik saya" difilter di server (?assignedTo=me, di-resolve
     backend jadi user id dari sesi login) — bukan cuma filter di
     browser — jadi staff lain memang tidak menerima payload task
     yang bukan miliknya sama sekali.
   - Semua aksi (accept/update progress/submit selesai) langsung
     PATCH/POST ke server saat itu juga; tidak ada lagi "simpan
     nanti lewat window.__siSaveSystems()" yang terpisah dari
     window.__tkmTasks.
============================================================= */

(function () {

  let tkmActiveStatus = "pending";
  let tkmUnitFilter = "all";
  let tkmPages = { pending: 1, accepted: 1, completed: 1 };
  const tkmPageSize = 6;

  let tkmActiveTaskId = null;
  let tkmSubmitTempFiles = [];   // File[] asli yang mau di-upload saat submit
  let tkmSubmitTempPreviews = []; // object URL preview lokal (paralel dgn tkmSubmitTempFiles)
  let tkmProgressTempFiles = [];
  let tkmProgressTempPreviews = [];

  // window.__tkmTasks tetap dipakai sebagai CACHE di memori (dipakai
  // getTaskById/render), tapi sumber kebenarannya SEKARANG selalu
  // fetch ulang dari server tiap kali ada perubahan status.
  function getTasks() { return window.__tkmTasks || (window.__tkmTasks = []); }
  function getTaskById(id) { return getTasks().find((t) => t.id === id); }

  // ===========================================================
  // HELPERS
  // ===========================================================
  // Untuk Admin/Operator (canViewAllTasks()): getSystems() balikin
  // window.__tkmAllSystems -- daftar SEMUA sistem lintas SEMUA project,
  // di-fetch langsung dari API (lihat fetchAllSystemsForAdmin()), TIDAK
  // bergantung pada project mana yang lagi aktif di Project Monitoring.
  // Untuk Staff biasa: tetap window.__siSystems (sistem project aktif
  // saja) seperti sebelumnya -- staff memang cuma terdaftar di 1
  // project, jadi tidak butuh cross-project.
  function getSystems() {
    if (canViewAllTasks()) return window.__tkmAllSystems || [];
    return window.__siSystems || [];
  }
  // PENTING: sama seperti task-management.js -- system.id adalah ID
  // gabungan khusus tampilan (bukan UUID asli). task.system_id yang
  // tersimpan di DB selalu system.systemId, jadi lookup di sini harus
  // match ke situ.
  function getSystemById(systemId) { return getSystems().find((s) => s.systemId === systemId); }

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

  function priorityTag(p) {
    const map = { high: "High", medium: "Medium", low: "Low" };
    return `<span class="si-priority si-priority-${p || "medium"}">${map[p] || "Medium"}</span>`;
  }

  function statusLabel(status) {
    return { pending: "Pending", accepted: "Sedang Dikerjakan", completed: "Selesai" }[status] || status;
  }

  function unitTag(sys) {
    if (!sys) return "";
    return `<span class="tm-unit-tag"><i class="fa-solid fa-solar-panel"></i>${esc(sys.basic.systemName)}</span>`;
  }

  function dlRow(label, value, unit) {
    const v = (value === undefined || value === null || value === "") ? "-" : value;
    return `<div class="si-dl-row"><dt>${esc(label)}</dt><dd>${esc(v)}${(v !== "-" && unit) ? " " + unit : ""}</dd></div>`;
  }

  // Nama yang ditampilkan untuk "Ditugaskan Kepada" -- utamakan akun
  // staff asli (assigned_to_username) yang di-JOIN backend, technician_name
  // dipertahankan sebagai fallback (mis. dari data migrasi lama).
  function technicianLabel(task) {
    return task.assigned_to_username || task.technician_name || "-";
  }

  function photoUrl(photo) {
    return `${window.EDASH_BACKEND_API_BASE}${photo.url}`;
  }

  // Admin/Operator (punya izin task.management) atau root -> lihat SEMUA
  // tugas dari SEMUA project (buat pantau progres tim lintas project),
  // bukan cuma tugas yang di-assign ke akun mereka sendiri & TIDAK
  // terikat project mana yang lagi aktif di Project Monitoring. Staff
  // biasa tetap hanya lihat tugas miliknya sendiri (otomatis 1 project
  // saja, karena staff memang cuma terdaftar di 1 project).
  function canViewAllTasks() {
    if (typeof window.hasPermission === "function" && window.hasPermission("task.management")) return true;
    try { return sessionStorage.getItem("edash-role-tier") === "root"; } catch (e) { return false; }
  }

  function currentUserId() {
    try { return sessionStorage.getItem("edash-user-id"); } catch (e) { return null; }
  }

  // Dipanggil HANYA untuk Admin/Operator (canViewAllTasks()) -- ambil
  // SEMUA sistem dari SEMUA project (GET /systems tanpa projectId) +
  // nama project-nya (GET /projects, buat label "Nama Project — Nama
  // Unit" di dropdown supaya tidak ambigu kalau 2 project punya nama
  // unit yang sama). Hasilnya di-cache di window.__tkmAllSystems,
  // dipakai getSystems() sebagai pengganti window.__siSystems yang
  // terikat ke satu project aktif. Endpoint /systems & /projects
  // digerbang permission `project.monitoring` -- root selalu lolos,
  // dan role yang punya task.management (operator, dst) pada
  // praktiknya juga selalu punya akses Project Monitoring.
  async function fetchAllSystemsForAdmin() {
    try {
      const [systems, projects] = await Promise.all([
        window.edashApiFetch("/systems"),
        window.edashApiFetch("/projects"),
      ]);
      const projectNameById = new Map((projects || []).map((p) => [p.id, p.project_name]));
      window.__tkmAllSystems = (systems || []).map((s) => ({
        systemId: s.id,
        projectId: s.project_id,
        basic: {
          systemName: projectNameById.has(s.project_id)
            ? `${projectNameById.get(s.project_id)} — ${s.system_name}`
            : s.system_name,
        },
      }));
    } catch (e) {
      console.warn("[task-maintenance] Gagal ambil daftar sistem lintas project:", e.message);
      window.__tkmAllSystems = [];
    }
  }

  // Dibatasi ke sistem-sistem yang KEMBALI dari getSystems() -- buat
  // Staff itu cuma sistem project aktifnya sendiri, buat Admin/Operator
  // itu SEMUA sistem lintas semua project (lihat getSystems()). Perlu
  // difilter di sini karena GET /maintenance/logs tanpa assignedTo
  // (dipakai admin/operator) balikin task dari SEMUA project sekaligus
  // langsung dari server, tanpa penyaringan.
  function currentProjectSystemIds() {
    return new Set(getSystems().map((s) => s.systemId).filter(Boolean));
  }

  async function fetchTasks() {
    // Staff biasa: backend resolve "me" jadi user id dari sesi login.
    // Admin/Operator: TIDAK kirim assignedTo -> backend balikin semua
    // task dari SEMUA project sekaligus, lalu difilter ke sistem-sistem
    // yang admin ini bisa lihat (getSystems() -- lintas semua project)
    // di collectTasks()/currentProjectSystemIds().
    const qs = canViewAllTasks() ? "" : "?assignedTo=me";
    const data = await window.edashApiFetch(`/maintenance/logs${qs}`);
    window.__tkmTasks = data || [];
  }

  function collectTasks(status, unitFilter) {
    const projectSystemIds = currentProjectSystemIds();
    const rows = getTasks().filter((t) => t.task_status === status && projectSystemIds.has(t.system_id));
    const filtered = unitFilter === "all" ? rows : rows.filter((t) => t.system_id === unitFilter);
    filtered.sort((a, b) => (a.scheduled_date || "").localeCompare(b.scheduled_date || ""));
    return filtered;
  }

  // ===========================================================
  // INIT
  // ===========================================================
  window.initTaskMaintenance = async function () {
    // Admin/Operator TIDAK butuh project aktif dipilih dulu di Project
    // Monitoring -- daftar sistem diambil langsung lintas semua project.
    // Staff biasa tetap ikut alur lama (System Information, terikat
    // project aktif -- staff memang cuma 1 project jadi ini cukup).
    if (canViewAllTasks()) {
      await fetchAllSystemsForAdmin();
    } else if (typeof window.__siEnsureSystemsLoaded === "function") {
      await window.__siEnsureSystemsLoaded();
    }

    try {
      await fetchTasks();
    } catch (e) {
      console.warn("[task-maintenance] Gagal ambil task dari server:", e.message);
      showToast("Gagal memuat tugas dari server. Coba refresh halaman.");
      window.__tkmTasks = window.__tkmTasks || [];
    }

    tkmActiveStatus = "pending";
    tkmUnitFilter = "all";
    tkmPages = { pending: 1, accepted: 1, completed: 1 };

    populateUnitFilter();
    bindTabs();
    bindToolbar();
    bindDetailModal();
    bindAcceptModal();
    bindProgressModal();
    bindSubmitModal();
    bindPhotoUpload();
    bindLightbox();

    renderAll();
    showPanel("pending");
  };

  // Dipanggil dari master/header/header.js ketika user klik notifikasi
  // task di bell. attempt: retry singkat karena halaman ini mungkin
  // belum selesai initTaskMaintenance() saat dipanggil.
  window.tkmGoToTask = async function (taskId, attempt) {
    attempt = attempt || 0;
    let task = getTaskById(taskId);

    if (!task) {
      if (attempt === 0) {
        try { await fetchTasks(); task = getTaskById(taskId); } catch (e) { /* ignore, retry below */ }
      }
      if (!task) {
        if (attempt < 20) setTimeout(() => window.tkmGoToTask(taskId, attempt + 1), 50);
        return;
      }
    }

    const unitSelect = document.getElementById("tkmUnitFilter");
    if (unitSelect) unitSelect.value = "all";
    tkmUnitFilter = "all";
    tkmPages = { pending: 1, accepted: 1, completed: 1 };
    renderAll();

    tkmActiveStatus = task.task_status;
    document.querySelectorAll("#tkmSubtabs .tm-subtab").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-status") === task.task_status);
    });
    showPanel(task.task_status);

    setTimeout(() => {
      const el = document.querySelector(`.tkm-task-card[data-id="${taskId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("tm-flash-highlight");
      setTimeout(() => el.classList.remove("tm-flash-highlight"), 2400);
    }, 30);
  };

  // ===========================================================
  // TABS
  // ===========================================================
  function bindTabs() {
    document.querySelectorAll("#tkmSubtabs .tm-subtab").forEach((btn) => {
      btn.onclick = () => {
        tkmActiveStatus = btn.getAttribute("data-status");
        document.querySelectorAll("#tkmSubtabs .tm-subtab").forEach((b) => {
          b.classList.toggle("is-active", b === btn);
        });
        showPanel(tkmActiveStatus);
      };
    });
  }

  function showPanel(status) {
    document.querySelectorAll("#tkmRoot .tm-subpanel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.getAttribute("data-panel") === status);
    });
  }

  // ===========================================================
  // TOOLBAR (unit filter)
  // ===========================================================
  function populateUnitFilter() {
    const select = document.getElementById("tkmUnitFilter");
    if (!select) return;
    const options = getSystems().filter((s) => s.systemId).map((s) => `<option value="${s.systemId}">${esc(s.basic.systemName)}</option>`).join("");
    select.innerHTML = `<option value="all">Semua Unit</option>${options}`;
  }

  function bindToolbar() {
    const select = document.getElementById("tkmUnitFilter");
    if (!select) return;
    select.value = tkmUnitFilter;
    select.onchange = () => {
      tkmUnitFilter = select.value;
      tkmPages = { pending: 1, accepted: 1, completed: 1 };
      renderAll();
    };
  }

  // ===========================================================
  // RENDER: stats, tab counts, lists
  // ===========================================================
  function renderAll() {
    renderStats();
    renderTabCounts();
    renderList("pending");
    renderList("accepted");
    renderList("completed");
  }

  function renderStats() {
    const row = document.getElementById("tkmStatsRow");
    if (!row) return;
    const projectSystemIds = currentProjectSystemIds();
    const all = getTasks().filter((t) => projectSystemIds.has(t.system_id));
    const pending = all.filter((t) => t.task_status === "pending").length;
    const accepted = all.filter((t) => t.task_status === "accepted").length;
    const completed = all.filter((t) => t.task_status === "completed").length;

    row.innerHTML = `
      <div class="si-stat-card">
        <div class="si-stat-icon si-stat-icon-total"><i class="fa-solid fa-list-check"></i></div>
        <div>
          <div class="si-stat-value">${all.length}</div>
          <div class="si-stat-label">Total Tugas</div>
        </div>
      </div>
      <div class="si-stat-card">
        <div class="si-stat-icon si-stat-icon-pending"><i class="fa-solid fa-inbox"></i></div>
        <div>
          <div class="si-stat-value si-stat-pending">${pending}</div>
          <div class="si-stat-label">Pending</div>
        </div>
      </div>
      <div class="si-stat-card">
        <div class="si-stat-icon si-stat-icon-accepted"><i class="fa-solid fa-person-digging"></i></div>
        <div>
          <div class="si-stat-value si-stat-accepted">${accepted}</div>
          <div class="si-stat-label">Sedang Dikerjakan</div>
        </div>
      </div>
      <div class="si-stat-card">
        <div class="si-stat-icon si-stat-icon-connected"><i class="fa-solid fa-circle-check"></i></div>
        <div>
          <div class="si-stat-value si-stat-connected">${completed}</div>
          <div class="si-stat-label">Selesai</div>
        </div>
      </div>`;
  }

  function renderTabCounts() {
    const projectSystemIds = currentProjectSystemIds();
    const all = getTasks().filter((t) => projectSystemIds.has(t.system_id));
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    set("tkmCountPending", all.filter((t) => t.task_status === "pending").length);
    set("tkmCountAccepted", all.filter((t) => t.task_status === "accepted").length);
    set("tkmCountCompleted", all.filter((t) => t.task_status === "completed").length);
  }

  function renderList(status) {
    const listId = { pending: "tkmPendingList", accepted: "tkmAcceptedList", completed: "tkmCompletedList" }[status];
    const pagId = { pending: "tkmPendingPagination", accepted: "tkmAcceptedPagination", completed: "tkmCompletedPagination" }[status];
    const list = document.getElementById(listId);
    if (!list) return;

    const rows = collectTasks(status, tkmUnitFilter);

    if (!rows.length) {
      const emptyCopy = {
        pending: { icon: "fa-inbox", title: "Belum ada tugas baru", desc: "Tidak ada tugas maintenance pending untuk unit yang dipilih." },
        accepted: { icon: "fa-person-digging", title: "Belum ada tugas berjalan", desc: "Belum ada tugas yang sedang dikerjakan untuk unit yang dipilih." },
        completed: { icon: "fa-circle-check", title: "Belum ada riwayat selesai", desc: "Tugas yang sudah Anda selesaikan akan muncul di sini." }
      }[status];
      list.innerHTML = `
        <div class="si-empty">
          <i class="fa-solid ${emptyCopy.icon}"></i>
          <h3>${emptyCopy.title}</h3>
          <p>${emptyCopy.desc}</p>
        </div>`;
      renderPagination(pagId, 1, 1, null);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(rows.length / tkmPageSize));
    if (tkmPages[status] > totalPages) tkmPages[status] = totalPages;
    if (tkmPages[status] < 1) tkmPages[status] = 1;
    const startIdx = (tkmPages[status] - 1) * tkmPageSize;
    const pageRows = rows.slice(startIdx, startIdx + tkmPageSize);

    list.innerHTML = pageRows.map((task) => renderCard(task)).join("");

    list.querySelectorAll(".tkm-task-card").forEach((card) => {
      const id = card.getAttribute("data-id");
      const detailBtn = card.querySelector(".tkm-detail-btn");
      if (detailBtn) detailBtn.onclick = () => openDetail(id);

      const acceptBtn = card.querySelector(".tkm-accept-btn");
      if (acceptBtn) acceptBtn.onclick = () => openAcceptModal(id);

      const progressBtn = card.querySelector(".tkm-progress-btn");
      if (progressBtn) progressBtn.onclick = () => openProgressModal(id);

      const submitBtn = card.querySelector(".tkm-submit-btn");
      if (submitBtn) submitBtn.onclick = () => openSubmitModal(id);
    });

    renderPagination(pagId, totalPages, tkmPages[status], (n) => {
      tkmPages[status] = n;
      renderList(status);
    });
  }

  function renderCard(task) {
    const sys = getSystemById(task.system_id);
    const status = task.task_status;

    // Mode "lihat semua" (admin/operator): tombol aksi (accept/progress/
    // submit) cuma tampil kalau tugas itu MEMANG di-assign ke akun
    // sendiri -- backend juga menolak (403) kalau bukan, ini cuma biar
    // tidak ada tombol nganggur yang pasti gagal kalau diklik.
    const isMine = !canViewAllTasks() || task.assigned_to === currentUserId();

    let footActions = "";
    if (isMine && status === "pending") {
      footActions = `
        <button class="si-btn si-btn-primary si-btn-sm tkm-accept-btn" type="button">
          <i class="fa-solid fa-check"></i> Terima Tugas
        </button>`;
    } else if (isMine && status === "accepted") {
      footActions = `
        <button class="si-btn si-btn-secondary si-btn-sm tkm-progress-btn" type="button">
          <i class="fa-solid fa-gauge-high"></i> Update Progress
        </button>
        <button class="si-btn si-btn-primary si-btn-sm tkm-submit-btn" type="button">
          <i class="fa-solid fa-paper-plane"></i> Submit Selesai
        </button>`;
    }

    const progressBlock = status !== "pending" ? `
      <div class="tkm-progress-wrap">
        <div class="tkm-progress-label">
          <span>${esc(task.progress_note || "Progress pekerjaan")}</span>
          <span>${task.progress_pct}%</span>
        </div>
        <div class="tkm-progress"><div class="tkm-progress-fill" style="width:${task.progress_pct}%"></div></div>
      </div>` : "";

    const completedFoot = status === "completed" ? `
      <span class="tkm-completed-date"><i class="fa-solid fa-circle-check"></i> Diselesaikan ${fmtDate(task.completed_date)}</span>` : "";

    return `
      <div class="tkm-task-card" data-id="${task.id}">
        <div class="tkm-task-card-head">
          <div class="tkm-task-card-head-left">
            <div class="tkm-task-icon tkm-task-icon-${task.priority}"><i class="fa-solid fa-screwdriver-wrench"></i></div>
            <div style="min-width:0;">
              <div class="tkm-task-title">${esc(task.title)}</div>
              <div class="si-maint-tags">
                ${unitTag(sys)}
                <span class="si-tag"><i class="fa-solid fa-calendar"></i>${fmtDate(task.scheduled_date)}</span>
                <span class="si-tag"><i class="fa-solid fa-user"></i>${esc(technicianLabel(task))}</span>
                ${priorityTag(task.priority)}
              </div>
            </div>
          </div>
          <span class="si-badge tkm-status-${status}">${statusLabel(status)}</span>
        </div>
        ${task.description ? `<p class="tkm-task-desc">${esc(task.description)}</p>` : ""}
        ${progressBlock}
        <div class="tkm-task-card-foot">
          <button class="si-btn si-btn-ghost si-btn-sm tkm-detail-btn" type="button">
            <i class="fa-solid fa-circle-info"></i> Lihat Detail
          </button>
          ${completedFoot}
          ${footActions ? `<div class="tkm-task-card-foot-actions">${footActions}</div>` : ""}
        </div>
      </div>`;
  }

  // ===========================================================
  // GENERIC PAGINATION RENDERER
  // ===========================================================
  function renderPagination(wrapId, totalPages, currentPage, onChange) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;

    if (totalPages <= 1) { wrap.innerHTML = ""; return; }

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

  // ===========================================================
  // DETAIL MODAL
  // ===========================================================
  function openDetail(id) {
    const task = getTaskById(id);
    if (!task) return;
    tkmActiveTaskId = id;
    const sys = getSystemById(task.system_id);
    const status = task.task_status;

    document.getElementById("tkmDetailTitle").textContent = task.title;
    document.getElementById("tkmDetailTags").innerHTML = `
      ${unitTag(sys)}
      <span class="si-tag"><i class="fa-solid fa-calendar"></i>${fmtDate(task.scheduled_date)}</span>
      <span class="si-tag"><i class="fa-solid fa-user"></i>${esc(technicianLabel(task))}</span>
      ${priorityTag(task.priority)}
      <span class="si-badge tkm-status-${status}">${statusLabel(status)}</span>
    `;
    document.getElementById("tkmDetailDl").innerHTML = [
      dlRow("Unit", sys ? sys.basic.systemName : "-"),
      dlRow("Judul Tugas", task.title),
      dlRow("Tanggal Dijadwalkan", fmtDate(task.scheduled_date)),
      dlRow("Ditugaskan Kepada", technicianLabel(task)),
      dlRow("Prioritas", (task.priority || "medium").charAt(0).toUpperCase() + (task.priority || "medium").slice(1)),
      dlRow("Status", statusLabel(status))
    ].join("");

    const descWrap = document.getElementById("tkmDetailDescWrap");
    if (task.description) { descWrap.style.display = ""; document.getElementById("tkmDetailDesc").textContent = task.description; }
    else descWrap.style.display = "none";

    // Field "notes" terpisah tidak ada lagi di skema tasks (Postgres) --
    // Operator sekarang menulis catatan sebagai bagian dari Description.
    // Wrap ini disembunyikan permanen, dipertahankan supaya tidak perlu
    // ubah HTML.
    const notesWrap = document.getElementById("tkmDetailNotesWrap");
    if (notesWrap) notesWrap.style.display = "none";

    const progressWrap = document.getElementById("tkmDetailProgressWrap");
    if (status !== "pending") {
      progressWrap.style.display = "";
      document.getElementById("tkmDetailProgressPct").textContent = task.progress_pct + "%";
      document.getElementById("tkmDetailProgressFill").style.width = task.progress_pct + "%";
      document.getElementById("tkmDetailProgressNote").textContent = task.progress_note || "Belum ada catatan progres.";
    } else {
      progressWrap.style.display = "none";
    }

    const reportWrap = document.getElementById("tkmDetailReportWrap");
    const photosWrap = document.getElementById("tkmDetailPhotosWrap");
    const itemsWrap = document.getElementById("tkmDetailItemsWrap");

    if (status === "completed") {
      reportWrap.style.display = "";
      document.getElementById("tkmDetailReportDesc").textContent = task.completion_description || "-";

      const photos = task.photos || [];
      if (photos.length) {
        photosWrap.style.display = "";
        const grid = document.getElementById("tkmDetailPhotos");
        grid.innerHTML = photos.map((p, i) => `<img src="${photoUrl(p)}" alt="Foto ${i + 1}">`).join("");
        grid.querySelectorAll("img").forEach((img) => { img.onclick = () => openLightbox(img.src); });
      } else {
        photosWrap.style.display = "none";
      }

      if (task.items_purchased) {
        itemsWrap.style.display = "";
        document.getElementById("tkmDetailItems").textContent = task.items_purchased;
      } else {
        itemsWrap.style.display = "none";
      }
    } else {
      reportWrap.style.display = "none";
      // Sebelum selesai, tetap tampilkan foto yang sudah diunggah lewat
      // Update Progress (kalau ada) supaya staff bisa cek ulang.
      const photos = task.photos || [];
      if (photos.length) {
        photosWrap.style.display = "";
        const grid = document.getElementById("tkmDetailPhotos");
        grid.innerHTML = photos.map((p, i) => `<img src="${photoUrl(p)}" alt="Foto ${i + 1}">`).join("");
        grid.querySelectorAll("img").forEach((img) => { img.onclick = () => openLightbox(img.src); });
      } else {
        photosWrap.style.display = "none";
      }
      itemsWrap.style.display = "none";
    }

    // Rincian biaya (Hardware/Software/Transport) -- sama seperti di
    // Task Management (lihat task-management.js openFutureDetail()).
    // Tetap ditampilkan terlepas dari status task, selama ada nominal
    // yang diisi Operator saat membuat/mengedit task ini.
    const costWrap = document.getElementById("tkmDetailCostWrap");
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
        document.getElementById("tkmDetailCost").innerHTML = rows.join("");
      } else {
        costWrap.style.display = "none";
      }
    }

    const acceptBtn = document.getElementById("tkmDetailAcceptBtn");
    const progressBtn = document.getElementById("tkmDetailProgressBtn");
    const submitBtn = document.getElementById("tkmDetailSubmitBtn");
    const isMine = !canViewAllTasks() || task.assigned_to === currentUserId();
    acceptBtn.style.display = isMine && status === "pending" ? "" : "none";
    progressBtn.style.display = isMine && status === "accepted" ? "" : "none";
    submitBtn.style.display = isMine && status === "accepted" ? "" : "none";

    document.getElementById("tkmDetailOverlay").classList.add("is-open");
  }

  function closeDetail() {
    document.getElementById("tkmDetailOverlay").classList.remove("is-open");
  }

  function bindDetailModal() {
    document.getElementById("tkmDetailCloseBtn").onclick = closeDetail;
    document.getElementById("tkmDetailCloseBtn2").onclick = closeDetail;
    document.getElementById("tkmDetailOverlay").onclick = (e) => {
      if (e.target.id === "tkmDetailOverlay") closeDetail();
    };
    document.getElementById("tkmDetailAcceptBtn").onclick = () => {
      if (!tkmActiveTaskId) return;
      closeDetail();
      openAcceptModal(tkmActiveTaskId);
    };
    document.getElementById("tkmDetailProgressBtn").onclick = () => {
      if (!tkmActiveTaskId) return;
      closeDetail();
      openProgressModal(tkmActiveTaskId);
    };
    document.getElementById("tkmDetailSubmitBtn").onclick = () => {
      if (!tkmActiveTaskId) return;
      closeDetail();
      openSubmitModal(tkmActiveTaskId);
    };
  }

  // ===========================================================
  // ACCEPT MODAL
  // ===========================================================
  function openAcceptModal(id) {
    const task = getTaskById(id);
    if (!task) return;
    tkmActiveTaskId = id;
    const sys = getSystemById(task.system_id);

    document.getElementById("tkmAcceptTaskTitle").textContent = task.title;
    document.getElementById("tkmAcceptTaskUnit").textContent = (sys ? sys.basic.systemName : "-") + " · Dijadwalkan " + fmtDate(task.scheduled_date);

    document.getElementById("tkmAcceptOverlay").classList.add("is-open");
  }

  function closeAcceptModal() {
    document.getElementById("tkmAcceptOverlay").classList.remove("is-open");
  }

  function bindAcceptModal() {
    document.getElementById("tkmAcceptCloseBtn").onclick = closeAcceptModal;
    document.getElementById("tkmAcceptCancelBtn").onclick = closeAcceptModal;
    document.getElementById("tkmAcceptOverlay").onclick = (e) => {
      if (e.target.id === "tkmAcceptOverlay") closeAcceptModal();
    };
    document.getElementById("tkmAcceptConfirmBtn").onclick = async () => {
      const task = getTaskById(tkmActiveTaskId);
      if (!task) return;
      const btn = document.getElementById("tkmAcceptConfirmBtn");
      btn.disabled = true;
      try {
        const updated = await window.edashApiFetch(`/maintenance/logs/${task.id}/accept`, { method: "POST" });
        Object.assign(task, updated);
        closeAcceptModal();
        renderAll();
        const acceptedTabBtn = document.querySelector('#tkmSubtabs .tm-subtab[data-status="accepted"]');
        if (acceptedTabBtn) acceptedTabBtn.click();
        showToast("Tugas diterima. Selamat bekerja!");

        if (typeof window.hdLogTaskAccepted === "function") {
          const sys = getSystemById(task.system_id);
          if (sys) window.hdLogTaskAccepted(sys, task);
        }
      } catch (e) {
        showToast("Gagal menerima tugas: " + e.message);
      } finally {
        btn.disabled = false;
      }
    };
  }

  // ===========================================================
  // PROGRESS MODAL
  // ===========================================================
  function setProgressReadout(val) {
    document.getElementById("tkmProgressReadout").textContent = val + "%";
    document.getElementById("tkmProgressPreviewFill").style.width = val + "%";
    document.querySelectorAll(".tkm-quick-btn").forEach((btn) => {
      btn.classList.toggle("is-selected", btn.getAttribute("data-value") === String(val));
    });
  }

  function openProgressModal(id) {
    const task = getTaskById(id);
    if (!task) return;
    tkmActiveTaskId = id;
    const sys = getSystemById(task.system_id);

    document.getElementById("tkmProgressTaskTitle").textContent = task.title;
    document.getElementById("tkmProgressTaskUnit").textContent = (sys ? sys.basic.systemName : "-");

    const range = document.getElementById("tkmProgressRange");
    range.value = task.progress_pct || 0;
    setProgressReadout(task.progress_pct || 0);
    document.getElementById("tkmProgressNote").value = task.progress_note || "";

    tkmProgressTempFiles = [];
    tkmProgressTempPreviews = [];

    document.getElementById("tkmProgressOverlay").classList.add("is-open");
  }

  function closeProgressModal() {
    document.getElementById("tkmProgressOverlay").classList.remove("is-open");
  }

  function bindProgressModal() {
    document.getElementById("tkmProgressCloseBtn").onclick = closeProgressModal;
    document.getElementById("tkmProgressCancelBtn").onclick = closeProgressModal;
    document.getElementById("tkmProgressOverlay").onclick = (e) => {
      if (e.target.id === "tkmProgressOverlay") closeProgressModal();
    };

    const range = document.getElementById("tkmProgressRange");
    range.oninput = () => setProgressReadout(parseInt(range.value, 10));

    document.querySelectorAll(".tkm-quick-btn").forEach((btn) => {
      btn.onclick = () => {
        const v = parseInt(btn.getAttribute("data-value"), 10);
        range.value = v;
        setProgressReadout(v);
      };
    });

    document.getElementById("tkmProgressSaveBtn").onclick = async () => {
      const task = getTaskById(tkmActiveTaskId);
      if (!task) return;
      const btn = document.getElementById("tkmProgressSaveBtn");
      btn.disabled = true;
      try {
        const fd = new FormData();
        fd.append("progressPct", String(parseInt(range.value, 10) || 0));
        fd.append("progressNote", document.getElementById("tkmProgressNote").value.trim());
        tkmProgressTempFiles.forEach((f) => fd.append("files", f));

        const updated = await window.edashApiFetch(`/maintenance/logs/${task.id}/progress`, {
          method: "PATCH",
          body: fd,
        });
        Object.assign(task, updated);
        closeProgressModal();
        renderAll();
        showToast("Progress pekerjaan diperbarui.");

        if (typeof window.hdLogTaskProgress === "function") {
          const sys = getSystemById(task.system_id);
          if (sys) window.hdLogTaskProgress(sys, task);
        }
      } catch (e) {
        showToast("Gagal update progres: " + e.message);
      } finally {
        btn.disabled = false;
      }
    };
  }

  // ===========================================================
  // SUBMIT MODAL (penyelesaian task)
  // ===========================================================
  function openSubmitModal(id) {
    const task = getTaskById(id);
    if (!task) return;
    tkmActiveTaskId = id;
    const sys = getSystemById(task.system_id);

    document.getElementById("tkmSubmitTaskTitle").textContent = task.title;
    document.getElementById("tkmSubmitTaskUnit").textContent = (sys ? sys.basic.systemName : "-");

    document.getElementById("tkmSubmitForm").reset();
    document.querySelectorAll("#tkmSubmitForm .si-field").forEach((f) => f.classList.remove("has-error"));
    tkmSubmitTempFiles = [];
    tkmSubmitTempPreviews.forEach((url) => URL.revokeObjectURL(url));
    tkmSubmitTempPreviews = [];
    renderSubmitPhotoThumbs();

    document.getElementById("tkmSubmitOverlay").classList.add("is-open");
  }

  function closeSubmitModal() {
    document.getElementById("tkmSubmitOverlay").classList.remove("is-open");
  }

  function bindSubmitModal() {
    document.getElementById("tkmSubmitCloseBtn").onclick = closeSubmitModal;
    document.getElementById("tkmSubmitCancelBtn").onclick = closeSubmitModal;
    document.getElementById("tkmSubmitOverlay").onclick = (e) => {
      if (e.target.id === "tkmSubmitOverlay") closeSubmitModal();
    };

    document.getElementById("tkmSubmitSaveBtn").onclick = saveSubmitModal;
  }

  async function saveSubmitModal() {
    const task = getTaskById(tkmActiveTaskId);
    if (!task) return;

    const descInput = document.getElementById("tkmSubmitDesc");
    const descField = descInput.closest(".si-field");
    const photoField = document.getElementById("tkmPhotoUpload").closest(".si-field");
    const photoError = document.getElementById("tkmPhotoError");

    let hasError = false;

    if (!descInput.value.trim()) {
      descField.classList.add("has-error");
      hasError = true;
    } else {
      descField.classList.remove("has-error");
    }

    // Minimal 1 foto BARU wajib diupload saat submit (foto bukti akhir),
    // sama seperti aturan lama.
    if (!tkmSubmitTempFiles.length) {
      photoField.classList.add("has-error");
      photoError.style.display = "block";
      hasError = true;
    } else {
      photoField.classList.remove("has-error");
      photoError.style.display = "none";
    }

    if (hasError) return;

    const btn = document.getElementById("tkmSubmitSaveBtn");
    btn.disabled = true;
    try {
      const fd = new FormData();
      fd.append("completionDescription", descInput.value.trim());
      fd.append("itemsPurchased", document.getElementById("tkmSubmitItems").value.trim());
      tkmSubmitTempFiles.forEach((f) => fd.append("files", f));

      const updated = await window.edashApiFetch(`/maintenance/logs/${task.id}/complete`, {
        method: "POST",
        body: fd,
      });
      Object.assign(task, updated);

      closeSubmitModal();
      renderAll();
      const completedTabBtn = document.querySelector('#tkmSubtabs .tm-subtab[data-status="completed"]');
      if (completedTabBtn) completedTabBtn.click();
      showToast("Laporan berhasil dikirim. Tugas selesai!");

      if (typeof window.hdLogTaskCreated === "function") {
        const sys = getSystemById(task.system_id);
        if (sys) window.hdLogTaskCreated("task-history", sys, 0, task);
      }
    } catch (e) {
      showToast("Gagal mengirim laporan: " + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ===========================================================
  // PHOTO UPLOAD (form Update Progress & Submit Hasil Maintenance)
  // Foto TIDAK lagi di-encode base64 -- File asli disimpan di memori
  // (tkmSubmitTempFiles/tkmProgressTempFiles) dan dikirim sebagai
  // multipart/form-data saat Save. Preview thumbnail pakai
  // URL.createObjectURL() (lokal, tidak numpuk base64 di request lain).
  // ===========================================================
  function bindPhotoUpload() {
    const addBtn = document.getElementById("tkmPhotoAddBtn");
    const input = document.getElementById("tkmPhotoInput");
    if (!addBtn || !input) return;

    addBtn.onclick = () => input.click();

    input.onchange = () => {
      const files = Array.from(input.files || []);
      files.forEach((file) => {
        tkmSubmitTempFiles.push(file);
        tkmSubmitTempPreviews.push(URL.createObjectURL(file));
      });
      renderSubmitPhotoThumbs();
      input.value = "";
    };
  }

  function renderSubmitPhotoThumbs() {
    const wrap = document.getElementById("tkmPhotoUpload");
    if (!wrap) return;
    const addBtn = document.getElementById("tkmPhotoAddBtn");

    wrap.querySelectorAll(".tm-photo-thumb").forEach((el) => el.remove());

    tkmSubmitTempPreviews.forEach((src, idx) => {
      const thumb = document.createElement("div");
      thumb.className = "tm-photo-thumb";
      thumb.innerHTML = `
        <img src="${src}" alt="Foto ${idx + 1}">
        <button type="button" class="tm-photo-remove" title="Hapus foto"><i class="fa-solid fa-xmark"></i></button>
      `;
      thumb.querySelector(".tm-photo-remove").onclick = () => {
        URL.revokeObjectURL(tkmSubmitTempPreviews[idx]);
        tkmSubmitTempPreviews.splice(idx, 1);
        tkmSubmitTempFiles.splice(idx, 1);
        renderSubmitPhotoThumbs();
      };
      wrap.insertBefore(thumb, addBtn);
    });
  }

  // ===========================================================
  // LIGHTBOX
  // ===========================================================
  function bindLightbox() {
    const overlay = document.getElementById("tkmLightboxOverlay");
    const closeBtn = document.getElementById("tkmLightboxCloseBtn");
    if (!overlay || !closeBtn) return;

    closeBtn.onclick = () => overlay.classList.remove("is-open");
    overlay.onclick = (e) => {
      if (e.target.id === "tkmLightboxOverlay") overlay.classList.remove("is-open");
    };
  }

  function openLightbox(src) {
    const overlay = document.getElementById("tkmLightboxOverlay");
    const img = document.getElementById("tkmLightboxImg");
    if (!overlay || !img) return;
    img.src = src;
    overlay.classList.add("is-open");
  }

  // ===========================================================
  // TOAST
  // ===========================================================
  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById("tkmToast");
    if (!toast) return;
    document.getElementById("tkmToastMsg").textContent = msg;
    toast.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-show"), 2800);
  }

})();
