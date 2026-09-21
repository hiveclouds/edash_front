/* ============================================================
   Page: Ticketing (WebDev) — 360eDash
   Halaman untuk SEMUA role: submit bug/improvement request untuk
   dashboard ini sendiri, lalu tim WebDev bisa assign diri sendiri
   (atau anggota lain) dan mengubah status sampai selesai.

   PERSISTENCE:
   BEDA dari js/task-maintenance.js — halaman ini TIDAK lagi baca/
   tulis satu file JSON sebagai array utuh. Backend-nya adalah
   backend Hono (edashboard_api, window.EDASH_BACKEND_API_BASE),
   yang nyimpen ticket ke PostgreSQL (tabel tickets/
   ticket_categories/ticket_comments) lewat endpoint REST granular,
   di-mount di bawah prefix /api/v1 (lihat src/routes/index.ts ->
   routes.route('/tickets', ...) & routes.route('/users', ...)):
     GET    /api/v1/tickets                -> ambil semua ticket (+comments)
     POST   /api/v1/tickets                -> buat ticket baru
     PATCH  /api/v1/tickets/:id            -> ubah assignedTo / status
     DELETE /api/v1/tickets/:id            -> hapus ticket
     POST   /api/v1/tickets/:id/comments   -> tambah 1 comment
     GET    /api/v1/users                  -> daftar user nyata (dropdown "Assigned to")
   Tiap aksi langsung memanggil endpoint terkait (bukan lagi "tulis
   balik seluruh array"), lalu UI di-refresh dari response-nya.

   Submitter selalu diambil dari sessionStorage "edash-user" (diisi
   saat login, lihat js/login.js) — TIDAK bisa diketik manual, supaya
   selalu jelas siapa yang benar-benar submit.
============================================================= */

(function () {

  // Tickets & users hidup di Postgres, dilayani backend Hono
  // (edashboard_api) lewat window.EDASH_BACKEND_API_BASE (default
  // "/api/v1", lihat js/api-config.js), BUKAN window.EDASH_API_BASE
  // ("/api", backend lama yang tidak punya route ticket sama sekali).
  //
  // FIX (2026-08-25): sebelumnya file ini salah pakai
  // window.EDASH_API_BASE ("/api") + path "/api/tickets", jadi URL
  // akhirnya "/api/api/tickets" (404, "Unexpected token '<'" karena
  // yang kebalas malah halaman 404 HTML, bukan JSON). Endpoint ticket
  // yang beneran cuma ada di backend Hono, di-mount di bawah prefix
  // EDASH_BACKEND_API_BASE, jadi path di sini cukup "/tickets" /
  // "/users" (base-nya sendiri sudah mengandung "/api/v1").
  //
  // Catatan (2026-08-26): dulu file ini SENGAJA pakai raw fetch() karena
  // ticket.controller.ts membalas response mentah (bukan envelope
  // {success, data}). Sekarang keduanya sudah diupdate BARENG: controller
  // sudah pakai envelope standar, dan di sini sudah pindah ke
  // window.edashApiFetch() (helper terpusat di js/api-config.js) supaya
  // dapat auto-redirect-ke-login kalau sesi expired & timeout otomatis,
  // sama seperti halaman lain. JANGAN ubah salah satu tanpa yang lain.
  const TK_API_PATH = "/tickets";
  const TK_USERS_API_PATH = "/users";

  // NOTE (2026-08-26): dulu ada konstanta TK_ATTACH_MAX_COUNT/
  // TK_ATTACH_MAX_SOURCE_BYTES/TK_ATTACH_MAX_DIMENSION/TK_ATTACH_JPEG_QUALITY
  // + fungsi tkCompressImageFile() di sini untuk resize+kompres FOTO ke
  // JPEG base64 sebelum dikirim. Sudah dihapus -- attachment sekarang
  // wajib mendukung PDF/Word/video juga (bukan cuma foto), dikirim
  // sebagai File asli lewat FormData (lihat TK_ATTACH_MAX_FILES/
  // TK_ATTACH_MAX_SIZE_BYTES/TK_ATTACH_ALLOWED_MIME di bagian CREATE
  // TICKET), jadi resize/kompres di browser sudah tidak relevan.

  async function tkLoadFromServer() {
    try {
      // edashApiFetch: auto-timeout, auto-redirect ke login kalau sesi
      // expired, dan sudah unwrap { success, data } -> langsung array
      // ticket. Sebelumnya di sini raw fetch() dipakai dan dicek pakai
      // Array.isArray(parsed) terhadap RESPONSE MENTAH { success, data }
      // -- itu SELALU false (bukan array), jadi tkLoadFromServer() diam-
      // diam SELALU gagal & ticket list selalu mulai dari kosong walau
      // datanya sebenarnya ada di database.
      const data = await window.edashApiFetch(TK_API_PATH);
      return Array.isArray(data) ? data : null;
    } catch (e) {
      console.warn("[ticketing] Gagal ambil data ticket dari database, mulai dari kosong:", e.message);
      return null;
    }
  }

  // ---------- Real users from the database (for "Assigned to") ----------
  // Diambil sekali per halaman dibuka lewat GET /api/users. Kalau fetch
  // gagal (mis. backend/DB sedang down), fallback ke daftar kosong +
  // current user saja supaya "Assign to me" tetap berfungsi.
  async function tkLoadUsers() {
    try {
      const data = await window.edashApiFetch(TK_USERS_API_PATH);
      return Array.isArray(data) ? data.map((u) => u.username).filter(Boolean) : [];
    } catch (e) {
      console.warn("[ticketing] Gagal ambil daftar user dari database:", e.message);
      return [];
    }
  }

  // ---------- Leaderboard ----------
  async function tkLoadLeaderboard() {
    try {
      const data = await window.edashApiFetch(`${TK_API_PATH}/leaderboard`);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn("[ticketing] Gagal ambil leaderboard:", e.message);
      return [];
    }
  }

  // ---------- Shareable ticket link ----------
  // App ini SPA tanpa URL routing per-halaman (loadPage() di js/main.js
  // cuma fetch() fragment HTML & suntik ke #page-root, TIDAK pernah
  // history.pushState/ubah URL -- lihat komentar di sana). Jadi
  // window.location selalu di root SPA (index.html) apa pun halaman yang
  // lagi tampil, dan cara "deep-link" ke satu ticket tertentu adalah
  // lewat query string ?ticket=<id> di URL root itu, DIBACA oleh:
  //   1) js/main.js (initializeDashboard()) -- override initial page ke
  //      Ticketing kalau ada ?ticket=... di URL saat SPA pertama dimuat.
  //   2) tkOpenFromDeepLinkIfAny() di bawah -- setelah tickets ke-load,
  //      cari ticket-nya & buka modal Detail otomatis.
  // Dipakai id INTERNAL (t.id, UUID) bukan ticketNumber -- karena findTicket()
  // di bawah mencocokkan ke t.id.
  function tkBuildTicketLink(id) {
    return `${window.location.origin}${window.location.pathname}?ticket=${encodeURIComponent(id)}`;
  }

  async function tkCopyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        // fall through ke fallback di bawah
      }
    }
    // Fallback untuk browser lama / konteks non-HTTPS: textarea sementara
    // + document.execCommand("copy").
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function tkCurrentUser() {
    return sessionStorage.getItem("edash-user") || "Anonymous";
  }

  // Cermin persis dari isApprover() di edashboard_api/src/services/
  // ticket.service.ts -- root ATAU role_key yang mengandung "lead"
  // (subteam lead, mis. dari halaman Role Access). Dipakai cuma untuk
  // UI (sembunyikan/nonaktifkan opsi "Resolved") -- otorisasi ASLI
  // tetap dicek di backend, ini tidak menggantikannya.
  // Cermin PERSIS dari requireApproverRole() di ticket.service.ts --
  // root (360master) ATAU role_key spesifik "rems_intern_lead". BUKAN
  // sembarang role yang mengandung kata "lead" (biofloc_intern_lead
  // TIDAK termasuk) -- sebelumnya di sini dicek pakai .includes("lead")
  // yang salah, kebablasan mengizinkan biofloc_intern_lead juga.
  function tkIsApprover() {
    if (sessionStorage.getItem("edash-role-tier") === "root") return true;
    return (sessionStorage.getItem("edash-role") || "") === "rems_intern_lead";
  }

  function tkCurrentRole() {
    return sessionStorage.getItem("edash-role") || null;
  }

  function tkAssigneeOptions() {
    const list = [...(window.__tkUsers || [])];
    const me = tkCurrentUser();
    if (me && me !== "Anonymous" && !list.includes(me)) list.push(me);
    return list;
  }

  function tkAssignedUsers(t) {
    if (Array.isArray(t?.assignedToUsers)) return t.assignedToUsers.filter(Boolean);
    if (t?.assignedTo) return String(t.assignedTo).split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    return [];
  }

  function tkAssignedLabel(t) {
    return tkAssignedUsers(t).join(", ");
  }

  // Gabung nama secara "natural" (Elvi / Elvi & Naila / Elvi, Naila & Rifa)
  // -- dipakai di toast sukses claim, BEDA dari tkAssignedLabel() di atas
  // yang gabung pakai koma polos buat ditampilkan di tabel/detail (lebih
  // ringkas, bukan kalimat).
  function tkJoinNamesNatural(names) {
    if (!names || !names.length) return "";
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  }

  function tkFmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  // "type" sekarang berisi NAMA kategori asli dari ticket_categories
  // (mis. "Feature Request", "UI/UX Feedback") -- sudah human-readable,
  // jadi label = value-nya sendiri. Slug dipakai KHUSUS untuk nama class
  // CSS (className tidak boleh berisi spasi/garis miring).
  function tkTypeLabel(type) {
    return type || "—";
  }

  function tkTypeSlug(type) {
    return String(type || "other")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "other";
  }

  function tkPriorityLabel(p) {
    if (p === "critical") return "Critical";
    if (p === "high") return "High";
    if (p === "low") return "Low";
    return "Medium";
  }

  function tkStatusLabel(s) {
    if (s === "open") return "Open";
    if (s === "waiting_approval") return "Waiting Approval";
    if (s === "resolved") return "Resolved";
    if (s === "rejected") return "Rejected";
    return "In Progress";
  }

  function tkTeamLabel(team) {
    if (team === "R1") return "R1 - Hardware";
    if (team === "R2") return "R2 - Backend";
    if (team === "R3") return "R3 - Frontend";
    return team || "—";
  }

  // Format daysRemaining (dari backend) jadi label pendek: "X hari lagi"
  // / "Hari ini" / "Terlambat X hari" -- atau "—" kalau ticket tidak
  // punya estimasi (daysRemaining null).
  // BUG FIX (2026-09-01): sebelumnya fungsi ini CUMA lihat daysRemaining,
  // sama sekali tidak peduli status tiket -- jadi tiket yang sudah
  // Resolved (atau Rejected) TETAP kelihatan "Terlambat X hari" kalau
  // deadline-nya di masa lalu, padahal tiketnya sudah selesai/final.
  // Sekarang status diikutkan: begitu final, badge due date diganti jadi
  // penanda status (bukan hitungan hari lagi), tidak peduli deadline-nya
  // kapan.
  function tkFmtDaysRemaining(daysRemaining, status) {
    if (status === "resolved") return { text: "Resolved", cls: "tk-due-done" };
    if (status === "rejected") return { text: "Rejected", cls: "tk-due-rejected" };
    if (daysRemaining == null) return { text: "—", cls: "" };
    if (daysRemaining > 0) return { text: `${daysRemaining} hari lagi`, cls: "tk-due-soon" };
    if (daysRemaining === 0) return { text: "Hari ini", cls: "tk-due-today" };
    return { text: `Terlambat ${Math.abs(daysRemaining)} hari`, cls: "tk-due-overdue" };
  }

  // ---------- Timer pengerjaan ----------
  // Format detik -> "1j 23m" / "45m" / "12s" -- dipakai untuk tampilan
  // tkDetailWorkedTime, live-diupdate tiap detik lewat setInterval
  // selama modal Detail terbuka DAN timer sedang berjalan (lihat
  // tkStartTimerTick()/tkStopTimerTick() di initTicketing()).
  function tkFmtDuration(totalSeconds) {
    // SENGAJA pakai singkatan Inggris (h/m/s), BUKAN Indonesia (j/m/d)
    // -- "45d" gampang kebaca "45 day/hari" padahal maksudnya detik,
    // "s" buat "seconds" jauh lebih jelas & gak ambigu.
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  // Total waktu kerja "live" -- akumulasi dari backend (totalWorkedSeconds)
  // + selisih waktu sejak timerStartedAt kalau timer sedang berjalan.
  function tkLiveWorkedSeconds(t) {
    const base = Number(t?.totalWorkedSeconds || 0);
    if (!t?.timerRunning || !t?.timerStartedAt) return base;
    const startedMs = new Date(t.timerStartedAt).getTime();
    if (isNaN(startedMs)) return base;
    return base + Math.max(0, (Date.now() - startedMs) / 1000);
  }

  // Daftar halaman untuk dropdown "Related Page" -- disamakan dengan
  // PAGE_PERMISSION_MAP di js/main.js (sumber kebenaran daftar halaman
  // aplikasi) supaya tidak drift kalau ada halaman baru ditambah/dihapus.
  // "Other" SELALU ditambahkan di akhir sebagai opsi ketik-bebas.
  const TK_RELATED_PAGE_OPTIONS = [
    { value: "Dashboard", label: "Dashboard" },
    { value: "Alert", label: "Alert" },
    { value: "Project Selector", label: "Project Selector" },
    { value: "Project Monitoring", label: "Project Monitoring" },
    { value: "Project Overview", label: "Project Overview" },
    { value: "System Information", label: "System Information" },
    { value: "Battery Station", label: "Battery Station" },
    { value: "Task Management", label: "Task Management" },
    { value: "Task Maintenance", label: "Task Maintenance" },
    { value: "Admin Calculator", label: "Admin Calculator" },
    { value: "Catalog", label: "Catalog" },
    { value: "Add New Project", label: "Add New Project" },
    { value: "Admin View", label: "Admin View" },
    { value: "Activity Log", label: "Activity Log" },
    { value: "Setting", label: "Setting" },
    { value: "Ticketing", label: "Ticketing (this page)" },
  ];
  const TK_RELATED_PAGE_OTHER = "__other__";

  function tkPopulateRelatedPageOptions(selectEl) {
    selectEl.innerHTML = "";
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = "Select a page...";
    selectEl.appendChild(blankOpt);
    TK_RELATED_PAGE_OPTIONS.forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      selectEl.appendChild(opt);
    });
    const otherOpt = document.createElement("option");
    otherOpt.value = TK_RELATED_PAGE_OTHER;
    otherOpt.textContent = "Other (type manually)";
    selectEl.appendChild(otherOpt);
  }

  // =================================================================
  // MAIN INIT — dipanggil setiap kali halaman ini di-route oleh
  // loadPage() di js/main.js (lihat page.includes("ticketing")).
  // =================================================================
  window.initTicketing = async function initTicketing() {

    const root = document.querySelector(".tk-wrap");
    if (!root) return;

    let tickets = window.__tkTickets;
    if (!Array.isArray(tickets)) {
      const fromServer = await tkLoadFromServer();
      tickets = fromServer || [];
      window.__tkTickets = tickets;
    }

    // Selalu refresh daftar user tiap halaman dibuka supaya dropdown
    // "Assigned to" mencerminkan tabel users terkini.
    window.__tkUsers = await tkLoadUsers();

    let tkActiveId = null;      // ticket sedang dibuka di modal Detail
    let tkPendingDeleteId = null;

    const tbody = document.getElementById("tkTableBody");
    const emptyState = document.getElementById("tkEmpty");
    const countLabel = document.getElementById("tkCount");
    const searchInput = document.getElementById("tkSearch");
    const typeFilter = document.getElementById("tkTypeFilter");
    const statusTabs = document.getElementById("tkStatusTabs");
    const teamToggle = document.getElementById("tkTeamToggle");
    let tkActiveStatusTab = "";
    let tkActiveTeamFilter = "";

    // ---------- Rows-per-page (custom, predetermined 10/20/30/40/50) ----------
    const TK_PAGE_SIZE_KEY = "edash-ticketing-page-size";
    function tkLoadPageSize() {
      const saved = Number(localStorage.getItem(TK_PAGE_SIZE_KEY));
      return Number.isFinite(saved) && saved > 0 ? saved : 20;
    }
    let tkPageSize = tkLoadPageSize();
    let tkCurrentPage = 1;

    // ---------- Team-scoped assignee picker ----------
    // R1/R2/R3 are intentionally configured here because some database users
    // (Bahman, Nithish, etc.) share the generic REMS-intern role but are NOT
    // members of one of the three WebDev teams. They may still self-claim a
    // ticket, but admin/lead must not assign them from the team picker.
    const TK_TEAM_MEMBERS = {
      R1: ["Azrial", "Naora", "Nasya"],
      R2: ["Azkal", "Yoga", "Ilham", "Dara", "Anhar"],
      R3: ["Fiyan", "Alifia", "Rifa", "Zevanya", "Elvi", "Amelia"],
    };

    function tkNormalizeName(name) {
      return String(name || "").trim().toLowerCase();
    }

    function tkTeamMemberNames(team) {
      return TK_TEAM_MEMBERS[String(team || "").toUpperCase()] || [];
    }

    function tkTeamScopedAssignedNames(team, currentValue) {
      const currentValues = Array.isArray(currentValue)
        ? currentValue
        : (currentValue ? String(currentValue).split(/\s*,\s*/).filter(Boolean) : []);
      const byNorm = new Map(currentValues.map((name) => [tkNormalizeName(name), name]));
      return tkTeamMemberNames(team).map((name) => byNorm.get(tkNormalizeName(name)) || name);
    }

    function fillAssigneePicker(containerEl, team, currentValue, disabled) {
      if (!containerEl) return;
      containerEl.innerHTML = "";
      const currentValues = Array.isArray(currentValue)
        ? currentValue
        : (currentValue ? String(currentValue).split(/\s*,\s*/).filter(Boolean) : []);
      const selected = new Set(currentValues.map(tkNormalizeName));
      const names = tkTeamMemberNames(team);
      if (!names.length) {
        containerEl.innerHTML = '<div class="tk-assignee-empty">No team members configured.</div>';
        return;
      }
      names.forEach((name) => {
        const label = document.createElement("label");
        label.className = "tk-assignee-choice" + (selected.has(tkNormalizeName(name)) ? " is-selected" : "");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = name;
        input.checked = selected.has(tkNormalizeName(name));
        input.disabled = !!disabled;
        const text = document.createElement("span");
        text.textContent = name;
        label.appendChild(input);
        label.appendChild(text);
        input.addEventListener("change", () => label.classList.toggle("is-selected", input.checked));
        containerEl.appendChild(label);
      });
    }

    function getSelectedAssignees() {
      return Array.from(document.querySelectorAll('#tkDetailAssigneePicker input[type="checkbox"]:checked')).map((input) => input.value);
    }

    // Versi generik dari getSelectedAssignees() di atas -- dipakai buat
    // picker LAIN yang bukan #tkDetailAssigneePicker (mis. #tkFormAssigneePicker
    // di form Edit ticket), biar gak perlu duplikat query selector-nya.
    function getSelectedAssigneesFrom(containerEl) {
      if (!containerEl) return [];
      return Array.from(containerEl.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
    }

    // ---------- Status picker (pill buttons, pengganti <select> polos) ----------
    // <select id="tkDetailStatus"> tetap jadi sumber kebenaran (value +
    // opsi mana yang disabled, diatur dari tkRefreshStatusOptionAvailability()),
    // fungsi ini cuma me-render tampilannya sebagai tombol pill dan
    // nge-sync balik ke situ begitu diklik (lalu dispatch "change" biar
    // semua listener yang sudah ada tetap jalan seperti biasa).
    const TK_STATUS_ICONS = { in_progress: "fa-person-digging", waiting_approval: "fa-hourglass-half" };
    function renderStatusPicker() {
      const picker = document.getElementById("tkDetailStatusPicker");
      const select = document.getElementById("tkDetailStatus");
      if (!picker || !select) return;
      picker.innerHTML = "";
      const currentValue = select.value;
      Array.from(select.options).forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const isSelected = opt.value === currentValue;
        btn.className = `tk-status-choice tk-status-choice-${opt.value}${isSelected ? " is-selected" : ""}`;
        btn.disabled = select.disabled || opt.disabled;
        btn.setAttribute("role", "radio");
        btn.setAttribute("aria-checked", String(isSelected));
        if (opt.title) btn.title = opt.title;
        btn.innerHTML = `<i class="fa-solid ${TK_STATUS_ICONS[opt.value] || "fa-circle"}"></i><span>${opt.textContent}</span>`;
        btn.addEventListener("click", () => {
          if (select.value === opt.value) return;
          select.value = opt.value;
          select.dispatchEvent(new Event("change"));
        });
        picker.appendChild(btn);
      });
    }

    // ---------- Leaderboard: "how points are calculated" popover ----------
    // Klik tombol (?) buka popover terstruktur (tier prioritas + bonus
    // kecepatan) sebagai pengganti tooltip teks polos CSS attr() yang
    // lama -- klik di luar / tombol lagi / Escape buat nutup.
    (function initPointsHelpPopover() {
      const btn = document.getElementById("tkLeaderboardHelpBtn");
      const popover = document.getElementById("tkPointsHelpPopover");
      if (!btn || !popover) return;

      function closePopover() {
        popover.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
      }

      function openPopover() {
        popover.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
      }

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popover.classList.contains("is-open")) closePopover();
        else openPopover();
      });

      document.addEventListener("click", (e) => {
        if (!popover.classList.contains("is-open")) return;
        if (e.target === btn || btn.contains(e.target) || popover.contains(e.target)) return;
        closePopover();
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closePopover();
      });
    })();

    // ---------- Leaderboard ----------
    // Inisial (ludes-dari-server) + di-refresh ulang tiap kali approve
    // sukses (poin baru diberikan, lihat tkDetailApproveBtn handler di
    // bawah) -- TIDAK ikut renderAll()/renderTable() supaya tidak
    // nge-fetch berulang tiap kali user ganti filter/halaman tabel.
    function renderLeaderboard(entries) {
      const list = document.getElementById("tkLeaderboardList");
      const podium = document.getElementById("tkLeaderboardPodium");
      const empty = document.getElementById("tkLeaderboardEmpty");
      const rankedBadge = document.getElementById("tkLeaderboardRankedBadge");
      if (!list || !podium || !empty) return;
      list.innerHTML = "";
      podium.innerHTML = "";
      const lang = (typeof getSavedLanguage === "function" ? getSavedLanguage() : "en");
      if (rankedBadge) {
        const count = Array.isArray(entries) ? entries.length : 0;
        rankedBadge.textContent = lang === "id" ? `${count} kontributor` : `${count} ranked`;
      }
      if (!Array.isArray(entries) || entries.length === 0) {
        empty.classList.remove("hidden");
        return;
      }
      empty.classList.add("hidden");

      const medalClass = ["is-gold", "is-silver", "is-bronze"];
      // Avatar leaderboard: pakai foto profil AKTIF user (entry.photoUrl)
      // kalau ada, fallback ke inisial nama kalau belum pernah upload
      // foto -- pola sama persis dengan avatarInnerHtml di
      // renderComments() (lihat comment lain di file ini). photoUrl
      // dikirim backend LIVE dari tabel users tiap kali leaderboard
      // di-fetch (lihat getLeaderboard() di ticket.service.ts), jadi
      // begitu user ganti foto di Settings, entry lama dia di leaderboard
      // otomatis ikut tampil dengan foto barunya.
      const tkAvatarInnerHtml = (entry, initials) =>
        entry.photoUrl
          ? `<img src="${escapeHtml(entry.photoUrl)}" alt="${escapeHtml(entry.username || "")}">`
          : escapeHtml(initials);

      // Podium sekarang list vertikal urutan rank asli (1 di atas, lalu 2,
      // 3) -- BUKAN lagi susunan visual 2nd-1st-3rd ala podium fisik,
      // supaya kartu-nya tidak kesempitan/dempet kalau ditumpuk sejajar
      // di kolom TOP PERFORMERS yang sempit.
      entries.slice(0, 3).forEach((entry, idx) => {
        const rank = idx + 1;
        const card = document.createElement("div");
        card.className = `tk-podium-card ${medalClass[rank - 1] || ""}`;
        const initials = (entry.username || "?").slice(0, 2).toUpperCase();
        const ticketWord = lang === "id" ? "tiket" : (entry.ticketsCompleted === 1 ? "ticket" : "tickets");
        card.innerHTML = `
          <div class="tk-podium-avatar-wrap">
            <div class="tk-podium-avatar">${tkAvatarInnerHtml(entry, initials)}</div>
            <span class="tk-podium-rank-badge">${rank}</span>
          </div>
          <div class="tk-podium-info">
            <div class="tk-podium-name">${escapeHtml(entry.username)}</div>
            <div class="tk-podium-meta">
              <span class="tk-podium-points">${entry.totalPoints} pts</span>
              <span class="tk-podium-tickets">${entry.ticketsCompleted} ${ticketWord}</span>
            </div>
          </div>
        `;
        podium.appendChild(card);
      });

      entries.forEach((entry, idx) => {
        const rank = idx + 1;
        const row = document.createElement("div");
        row.className = "tk-leaderboard-row" + (rank <= 3 ? ` ${medalClass[rank - 1]}` : "");
        const initials = (entry.username || "?").slice(0, 2).toUpperCase();
        const ticketWord = lang === "id" ? "tiket" : (entry.ticketsCompleted === 1 ? "ticket" : "tickets");
        row.innerHTML = `
          <span class="tk-leaderboard-rank">#${rank}</span>
          <span class="tk-leaderboard-avatar">${tkAvatarInnerHtml(entry, initials)}</span>
          <span class="tk-leaderboard-name">${escapeHtml(entry.username)}</span>
          <span class="tk-leaderboard-tickets">${entry.ticketsCompleted} ${ticketWord}</span>
          <span class="tk-leaderboard-points">${entry.totalPoints} pts</span>
        `;
        list.appendChild(row);
      });
    }

    async function refreshLeaderboard() {
      renderLeaderboard(await tkLoadLeaderboard());
    }
    refreshLeaderboard();

    // ---------- Stats ----------
    function renderStats() {
      document.getElementById("tkStatTotal").textContent = tickets.length;
      document.getElementById("tkStatOpen").textContent = tickets.filter((t) => t.status === "open").length;
      document.getElementById("tkStatInProgress").textContent = tickets.filter((t) => t.status === "in_progress").length;
      document.getElementById("tkStatWaitingApproval").textContent = tickets.filter((t) => t.status === "waiting_approval").length;
      document.getElementById("tkStatResolved").textContent = tickets.filter((t) => t.status === "resolved").length;
      document.getElementById("tkStatRejected").textContent = tickets.filter((t) => t.status === "rejected").length;
    }

    // ---------- Status subtab counts ----------
    function renderStatusTabCounts() {
      const scopedTickets = tkActiveTeamFilter
        ? tickets.filter((t) => t.team === tkActiveTeamFilter)
        : tickets;
      document.getElementById("tkTabCountAll").textContent = scopedTickets.length;
      document.getElementById("tkTabCountOpen").textContent = scopedTickets.filter((t) => t.status === "open").length;
      document.getElementById("tkTabCountInProgress").textContent = scopedTickets.filter((t) => t.status === "in_progress").length;
      document.getElementById("tkTabCountWaitingApproval").textContent = scopedTickets.filter((t) => t.status === "waiting_approval").length;
      document.getElementById("tkTabCountResolved").textContent = scopedTickets.filter((t) => t.status === "resolved").length;
      document.getElementById("tkTabCountRejected").textContent = scopedTickets.filter((t) => t.status === "rejected").length;
    }

    // ---------- Activity heatmap ("tickets worked per day", GitHub-style) ----------
    // No single field on a ticket says "worked on X day" -- so activity for
    // a given day is built from whatever DID actually happen that day:
    //   - the ticket being created (t.createdAt)
    //   - each comment/work-update left on it (c.createdAt)
    //   - the ticket reaching resolved/closed (t.updatedAt, only counted
    //     when the ticket is actually in one of those end states -- so an
    //     unrelated edit that bumped updatedAt on an still-open ticket
    //     doesn't get counted as a "finished" event)
    // Multiple events for the same ticket on the same day just add up
    // naturally, same as multiple commits on GitHub's graph.
    function tkYMD(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }

    // Filter khusus card "Ticket Activity" -- team (All Teams/R1/R2/R3)
    // + status (All Status/Open/In Progress/Waiting Approval/Resolved/
    // Rejected). Cuma mempengaruhi heatmap (tkBuildActivityMap()), TIDAK
    // menyentuh tkActiveTeamFilter/tkActiveStatusTab (yang itu punya
    // tabel utama, dan sengaja dibiarkan independen).
    let tkHeatmapTeamFilter = "";
    let tkHeatmapStatusFilter = "";

    function tkBuildActivityMap() {
      const map = {};
      const bump = (iso) => {
        if (!iso) return;
        const d = new Date(iso);
        if (isNaN(d.getTime())) return;
        const key = tkYMD(d);
        map[key] = (map[key] || 0) + 1;
      };
      const scoped = tickets.filter((t) => {
        if (tkHeatmapTeamFilter && t.team !== tkHeatmapTeamFilter) return false;
        if (tkHeatmapStatusFilter && t.status !== tkHeatmapStatusFilter) return false;
        return true;
      });
      scoped.forEach((t) => {
        bump(t.createdAt);
        (Array.isArray(t.comments) ? t.comments : []).forEach((c) => bump(c.createdAt));
        if (t.status === "resolved" || t.status === "rejected") bump(t.updatedAt);
      });
      return map;
    }

    const TK_MONTH_LABELS = {
      en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"],
    };

    function tkHeatBucket(count) {
      if (!count) return 0;
      if (count <= 2) return 1;
      if (count <= 4) return 2;
      if (count <= 6) return 3;
      return 4;
    }

    // Human-readable count range for each of the 5 legend swatches --
    // mirrors the thresholds in tkHeatBucket() above.
    function tkHeatBucketLabel(bucket, lang) {
      const ranges = ["0", "1–2", "3–4", "5–6", "7+"];
      const word = lang === "id" ? "tiket" : (ranges[bucket] === "1" ? "ticket" : "tickets");
      return `${ranges[bucket]} ${word}`;
    }

    // Fixed calendar span -- August of the current year through July of
    // next year -- instead of a rolling "last N weeks ending today" window.
    // Padded out to full Sun-Sat weeks so the grid stays rectangular; the
    // padding days (before Aug 1 / after Jul 31) are flagged so they
    // render as blank cells rather than pulling in a stray extra month.
    function tkBuildCalendarWeeks() {
      const now = new Date();
      // Kalau bulan saat ini Agustus-Desember (>= 7), siklus mulai Agustus tahun ini.
      // Kalau Januari-Juli (< 7), siklus dimulai Agustus tahun sebelumnya agar bulan saat ini tercakup.
      const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
      const rangeStart = new Date(startYear, 7, 1); // Aug 1
      const rangeEnd = new Date(startYear + 1, 6, 31); // Jul 31 next year

      const gridStart = new Date(rangeStart);
      gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back up to Sunday

      const gridEnd = new Date(rangeEnd);
      gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay())); // forward to Saturday

      const weeks = [];
      const cursor = new Date(gridStart);
      while (cursor <= gridEnd) {
        const days = [];
        for (let d = 0; d < 7; d++) {
          const date = new Date(cursor);
          days.push({ date, inRange: date >= rangeStart && date <= rangeEnd });
          cursor.setDate(cursor.getDate() + 1);
        }
        weeks.push(days);
      }
      return weeks;
    }

    // Groups the weeks into per-month blocks so each month's label can be
    // centered over exactly the columns that belong to it. A week is
    // assigned to the month of its first in-range day, so the handful of
    // padding days at the very start/end (outside Aug-this-year..Jul-next-
    // year) attach to the nearest real month instead of forming their own.
    function tkGroupWeeksByMonth(weeks) {
      const blocks = [];
      weeks.forEach((days) => {
        const rep = (days.find((d) => d.inRange) || days[3]).date;
        const key = `${rep.getFullYear()}-${rep.getMonth()}`;
        let block = blocks[blocks.length - 1];
        if (!block || block.key !== key) {
          block = { key, month: rep.getMonth(), weeks: [] };
          blocks.push(block);
        }
        block.weeks.push(days);
      });
      return blocks;
    }

    // Single shared tooltip element, positioned with `fixed` coordinates
    // on hover so it always reads clearly and is never clipped by the
    // heatmap's horizontal scroll container.
    function tkShowHeatTooltip(cell, text) {
      const tip = document.getElementById("tkHeatmapTooltip");
      if (!tip) return;
      tip.textContent = text;
      const rect = cell.getBoundingClientRect();
      tip.style.left = `${rect.left + rect.width / 2}px`;
      tip.style.top = `${rect.top}px`;
      tip.classList.add("is-visible");
    }

    function tkHideHeatTooltip() {
      const tip = document.getElementById("tkHeatmapTooltip");
      if (tip) tip.classList.remove("is-visible");
    }

    // Ukuran cell/gap sekarang DINAMIS (bukan konstanta tetap lagi) --
    // dihitung ulang tiap render oleh tkFitHeatmapMetrics() supaya
    // seluruh strip Aug-Jul muat pas di lebar card saat ini TANPA perlu
    // scroll horizontal, menyesuaikan lebar kolom Ticket Activity di
    // sebelah Leaderboard (lihat .tk-lb-heatmap-row). Nilai default di
    // bawah dipakai sebagai fallback sebelum ukuran pertama dihitung,
    // dan juga sebagai batas atas (cell tidak pernah lebih besar dari
    // ini, biar tidak jadi raksasa di layar sangat lebar).
    let TK_HEATMAP_CELL = 11; // px, harus sinkron dengan var(--tk-heat-cell) fallback di CSS
    let TK_HEATMAP_GAP = 3; // px, harus sinkron dengan var(--tk-heat-gap) fallback di CSS
    let TK_HEATMAP_MONTHGAP = 8; // px, harus sinkron dengan var(--tk-heat-monthgap) fallback di CSS
    const TK_HEATMAP_CELL_MIN = 6; // di bawah ini square jadi terlalu kecil buat dibaca/di-hover -- fallback ke scroll bawaan
    const TK_HEATMAP_CELL_MAX = 11;
    const TK_HEATMAP_GAP_TIGHT = 2;
    const TK_HEATMAP_MONTHGAP_TIGHT = 5;

    // Hitung ukuran cell/gap paling besar yang masih muat di lebar
    // #tkHeatmapScroll saat ini untuk `totalWeeks` kolom minggu terbagi
    // dalam `blockCount` blok bulan (tiap batas blok dapat jarak ekstra
    // TK_HEATMAP_MONTHGAP). Kalau lebar tersedia terlalu sempit bahkan
    // untuk cell seukuran TK_HEATMAP_CELL_MIN, cell dikunci di ukuran
    // minimum itu dan sisanya biar #tkHeatmapScroll yang scroll (jaring
    // pengaman di layar HP yang sangat sempit) -- bukan zero-scroll
    // dipaksakan sampai squarenya tidak kebaca lagi.
    function tkFitHeatmapMetrics(totalWeeks, blockCount) {
      const scrollEl = document.getElementById("tkHeatmapScroll");
      if (!scrollEl || !totalWeeks || !blockCount) return;
      const available = scrollEl.clientWidth - 30; // dikurangi kolom day-label (24px) + gap body (6px)
      if (available <= 0) return;

      const fit = (gap, monthGap) => {
        const nonCellWidth = (totalWeeks - blockCount) * gap + (blockCount - 1) * (gap + monthGap);
        return Math.floor((available - nonCellWidth) / totalWeeks);
      };

      let gap = 3;
      let monthGap = 8;
      let cell = fit(gap, monthGap);

      // Kalau masih kekecilan di gap normal, coba padatkan jarak antar
      // cell/bulan dulu sebelum menyerah ke cell minimum -- biasanya
      // cukup buat naikkan cell 1-2px lagi di lebar card yang medium.
      if (cell < TK_HEATMAP_CELL_MIN) {
        gap = TK_HEATMAP_GAP_TIGHT;
        monthGap = TK_HEATMAP_MONTHGAP_TIGHT;
        cell = fit(gap, monthGap);
      }

      cell = Math.max(TK_HEATMAP_CELL_MIN, Math.min(TK_HEATMAP_CELL_MAX, cell));

      TK_HEATMAP_CELL = cell;
      TK_HEATMAP_GAP = gap;
      TK_HEATMAP_MONTHGAP = monthGap;

      scrollEl.style.setProperty("--tk-heat-cell", `${cell}px`);
      scrollEl.style.setProperty("--tk-heat-gap", `${gap}px`);
      scrollEl.style.setProperty("--tk-heat-monthgap", `${monthGap}px`);
    }

    function tkRenderHeatmapRow(halfBlocks, activity, today, lang, months) {
      const rowBlockEl = document.createElement("div");
      rowBlockEl.className = "tk-heatmap-row-block";

      const monthsEl = document.createElement("div");
      monthsEl.className = "tk-heatmap-months";

      halfBlocks.forEach((block, blockIdx) => {
        const blockWidth = block.weeks.length * TK_HEATMAP_CELL + (block.weeks.length - 1) * TK_HEATMAP_GAP;
        const monthLabel = document.createElement("span");
        monthLabel.className = "tk-heatmap-month-label";
        monthLabel.textContent = months[block.month];
        monthLabel.style.width = `${blockWidth}px`;
        if (blockIdx > 0) monthLabel.classList.add("tk-heatmap-month-gap");
        monthsEl.appendChild(monthLabel);
      });
      rowBlockEl.appendChild(monthsEl);

      const bodyEl = document.createElement("div");
      bodyEl.className = "tk-heatmap-body";

      const dayLabelsEl = document.createElement("div");
      dayLabelsEl.className = "tk-heatmap-daylabels";

      const monText = (window.i18n ? window.i18n("ticketing.heatmap.mon") : null) || (lang === "id" ? "Sen" : "Mon");
      const wedText = (window.i18n ? window.i18n("ticketing.heatmap.wed") : null) || (lang === "id" ? "Rab" : "Wed");
      const friText = (window.i18n ? window.i18n("ticketing.heatmap.fri") : null) || (lang === "id" ? "Jum" : "Fri");

      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const daySpan = document.createElement("span");
        if (dayIdx === 1) daySpan.textContent = monText;
        else if (dayIdx === 3) daySpan.textContent = wedText;
        else if (dayIdx === 5) daySpan.textContent = friText;
        dayLabelsEl.appendChild(daySpan);
      }
      bodyEl.appendChild(dayLabelsEl);

      const gridEl = document.createElement("div");
      gridEl.className = "tk-heatmap-grid";

      halfBlocks.forEach((block, blockIdx) => {
        const blockEl = document.createElement("div");
        blockEl.className = "tk-heatmap-monthblock";
        if (blockIdx > 0) blockEl.classList.add("tk-heatmap-month-gap");

        block.weeks.forEach((days) => {
          const weekEl = document.createElement("div");
          weekEl.className = "tk-heatmap-week";

          days.forEach((dayObj) => {
            const cell = document.createElement("div");

            if (!dayObj.inRange) {
              cell.className = "tk-heatmap-cell tk-heat-pad";
              weekEl.appendChild(cell);
              return;
            }

            const cellDate = dayObj.date;
            const key = tkYMD(cellDate);
            const count = activity[key] || 0;
            const bucket = tkHeatBucket(count);
            cell.className = `tk-heatmap-cell tk-heat-${bucket}`;

            const isToday = key === tkYMD(today);
            const dateLabel = isToday
              ? (lang === "id" ? "Hari ini" : "Today")
              : cellDate.toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
            const ticketWord = lang === "id" ? "tiket" : (count === 1 ? "ticket" : "tickets");
            const tooltipText = `${count} ${ticketWord} — ${dateLabel}`;

            cell.setAttribute("aria-label", tooltipText);
            cell.addEventListener("mouseenter", () => tkShowHeatTooltip(cell, tooltipText));
            cell.addEventListener("mouseleave", tkHideHeatTooltip);

            weekEl.appendChild(cell);
          });

          blockEl.appendChild(weekEl);
        });

        gridEl.appendChild(blockEl);
      });

      bodyEl.appendChild(gridEl);
      rowBlockEl.appendChild(bodyEl);

      return rowBlockEl;
    }

    function renderActivityHeatmap() {
      const innerEl = document.getElementById("tkHeatmapInner");
      if (!innerEl) return;

      const activity = tkBuildActivityMap();

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const lang = (typeof getSavedLanguage === "function" ? getSavedLanguage() : "en");
      const months = TK_MONTH_LABELS[lang] || TK_MONTH_LABELS.en;

      const blocks = tkGroupWeeksByMonth(tkBuildCalendarWeeks());
      const mid = Math.ceil(blocks.length / 2);
      const half1 = blocks.slice(0, mid);
      const half2 = blocks.slice(mid);

      const weeksHalf1 = half1.reduce((sum, b) => sum + b.weeks.length, 0);
      const weeksHalf2 = half2.reduce((sum, b) => sum + b.weeks.length, 0);
      const maxWeeks = Math.max(weeksHalf1, weeksHalf2);
      const maxBlocks = Math.max(half1.length, half2.length);

      tkFitHeatmapMetrics(maxWeeks, maxBlocks);

      innerEl.innerHTML = "";
      tkHideHeatTooltip();

      innerEl.appendChild(tkRenderHeatmapRow(half1, activity, today, lang, months));
      innerEl.appendChild(tkRenderHeatmapRow(half2, activity, today, lang, months));

      const scrollEl = document.getElementById("tkHeatmapScroll");
      if (scrollEl) scrollEl.scrollLeft = 0;
    }

    // ---------- Filtering ----------
    function filteredTickets() {
      const q = (searchInput.value || "").trim().toLowerCase();
      const type = typeFilter.value;
      const status = tkActiveStatusTab;
      const team = tkActiveTeamFilter;
      return tickets
        .filter((t) => !type || t.type === type)
        .filter((t) => !status || t.status === status)
        .filter((t) => !team || t.team === team)
        .filter((t) => {
          if (!q) return true;
          return (
            (t.title || "").toLowerCase().includes(q) ||
            (t.ticketNumber || t.id || "").toLowerCase().includes(q) ||
            (t.submittedBy || "").toLowerCase().includes(q) ||
            tkAssignedLabel(t).toLowerCase().includes(q)
          );
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    // ---------- Table render ----------
    function renderTable() {
      const list = filteredTickets();
      tbody.innerHTML = "";

      emptyState.classList.toggle("hidden", list.length !== 0);
      countLabel.textContent = `Showing ${list.length} of ${tickets.length} tickets`;

      // Clamp currentPage kalau data/filter berubah bikin halaman
      // sekarang jadi kosong (mis. dari halaman 3 lalu filter dipersempit).
      const totalPages = Math.max(1, Math.ceil(list.length / tkPageSize));
      if (tkCurrentPage > totalPages) tkCurrentPage = totalPages;
      if (tkCurrentPage < 1) tkCurrentPage = 1;
      const startIdx = (tkCurrentPage - 1) * tkPageSize;
      const pageList = list.slice(startIdx, startIdx + tkPageSize);

      pageList.forEach((t) => {
        const tr = document.createElement("tr");
        if (t.status === "rejected") tr.classList.add("is-rejected");
        tr.innerHTML = `
          <td>
            <div class="tk-cell-title">${escapeHtml(t.title)}</div>
            <div class="tk-cell-id">${escapeHtml(t.ticketNumber || t.id)}</div>
          </td>
          <td><span class="tk-pill tk-pill-team-${(t.team || "").toLowerCase()}">${escapeHtml(t.team || "—")}</span></td>
          <td><span class="tk-pill tk-pill-type-${tkTypeSlug(t.type)}">${escapeHtml(tkTypeLabel(t.type))}</span></td>
          <td><span class="tk-pill tk-pill-priority-${t.priority}">${tkPriorityLabel(t.priority)}</span></td>
          <td><span class="tk-pill tk-pill-status-${t.status}">${tkStatusLabel(t.status)}</span></td>
          <td>${escapeHtml(t.submittedBy)}</td>
          <td>${tkAssignedLabel(t) ? escapeHtml(tkAssignedLabel(t)) : '<span class="tk-cell-unassigned">Unassigned</span>'}</td>
          <td>${tkFmtDate(t.createdAt)}</td>
          <td><span class="tk-due-badge ${tkFmtDaysRemaining(t.daysRemaining, t.status).cls}">${tkFmtDaysRemaining(t.daysRemaining, t.status).text}</span></td>
          <td class="tk-row-actions-cell">
            <div class="tk-row-actions">
              <button type="button" class="tk-view-btn" data-id="${escapeHtml(t.id)}"><i class="fa-solid fa-eye"></i> View</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll(".tk-view-btn").forEach((btn) => {
        btn.addEventListener("click", () => openDetail(btn.getAttribute("data-id")));
      });

      renderPagination(totalPages, list.length);
    }

    // ---------- Pagination controls ----------
    function renderPagination(totalPages, totalRows) {
      const wrap = document.getElementById("tkPagination");
      if (!wrap) return;
      wrap.innerHTML = "";
      if (totalRows === 0 || totalPages <= 1) return;

      const makeBtn = (label, page, opts = {}) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        if (opts.active) btn.classList.add("is-active");
        if (opts.disabled) btn.disabled = true;
        btn.addEventListener("click", () => {
          tkCurrentPage = page;
          renderTable();
        });
        return btn;
      };

      wrap.appendChild(makeBtn("‹", tkCurrentPage - 1, { disabled: tkCurrentPage <= 1 }));
      // Tampilkan maksimal 7 nomor halaman langsung, biar tidak meluber
      // kalau data-nya banyak -- selalu tampilkan halaman pertama/terakhir
      // + sekitar halaman aktif.
      const pages = new Set([1, totalPages, tkCurrentPage, tkCurrentPage - 1, tkCurrentPage + 1]);
      let lastShown = 0;
      [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b).forEach((p) => {
        if (lastShown && p - lastShown > 1) {
          const dots = document.createElement("span");
          dots.textContent = "…";
          dots.style.padding = "0 4px";
          dots.style.color = "var(--tk-muted)";
          wrap.appendChild(dots);
        }
        wrap.appendChild(makeBtn(String(p), p, { active: p === tkCurrentPage }));
        lastShown = p;
      });
      wrap.appendChild(makeBtn("›", tkCurrentPage + 1, { disabled: tkCurrentPage >= totalPages }));
    }

    function escapeHtml(str) {
      const div = document.createElement("div");
      div.textContent = str == null ? "" : String(str);
      return div.innerHTML;
    }

    function renderAll() {
      renderStats();
      renderStatusTabCounts();
      renderTable();
      renderActivityHeatmap();
      renderHeatmapLegend();
    }

    // Legend swatches don't change with the data, only with language, so
    // this is wired up separately from renderActivityHeatmap -- hovering
    // a swatch shows the ticket-count range that color represents.
    function renderHeatmapLegend() {
      const lang = (typeof getSavedLanguage === "function" ? getSavedLanguage() : "en");
      for (let bucket = 0; bucket <= 4; bucket++) {
        const swatch = document.getElementById(`tkHeatLegend${bucket}`);
        if (!swatch) continue;
        const text = tkHeatBucketLabel(bucket, lang);
        swatch.setAttribute("aria-label", text);
        swatch.onmouseenter = () => tkShowHeatTooltip(swatch, text);
        swatch.onmouseleave = tkHideHeatTooltip;
      }
    }

    // Cell tooltips and the total/month labels are language-dependent text
    // baked in at render time (not data-i18n spans), so a plain re-render
    // is needed on language switch to pick up the new locale -- the
    // universal language observer only walks data-i18n text nodes and
    // wouldn't touch these.
    document.addEventListener("edash:languagechange", renderActivityHeatmap);
    document.addEventListener("edash:languagechange", renderHeatmapLegend);

    // Re-fit cell/gap size whenever the card's available width actually
    // changes -- window resize (rotate phone, resize browser) AND the
    // heatmap card itself resizing without a window resize event (e.g.
    // sidebar collapse/expand, or the Leaderboard card next to it
    // changing height and reflowing the row at ≤900px). Debounced with
    // rAF-ish setTimeout so rapid drag-resize doesn't thrash re-renders.
    let tkHeatmapRefitTimer = null;
    function tkScheduleHeatmapRefit() {
      clearTimeout(tkHeatmapRefitTimer);
      tkHeatmapRefitTimer = setTimeout(renderActivityHeatmap, 120);
    }
    window.addEventListener("resize", tkScheduleHeatmapRefit);
    if (typeof ResizeObserver !== "undefined") {
      const heatmapCardEl = document.querySelector(".tk-heatmap-card");
      if (heatmapCardEl) {
        new ResizeObserver(tkScheduleHeatmapRefit).observe(heatmapCardEl);
      }
    }

    // ---------- Toast ----------
    let tkToastTimer = null;
    function showToast(msg) {
      const toast = document.getElementById("tkToast");
      if (!toast) return;
      document.getElementById("tkToastMsg").textContent = msg;
      toast.classList.add("is-show");
      clearTimeout(tkToastTimer);
      // Sedikit lebih lama dari sebelumnya (2800ms) supaya pesan yang
      // sekarang bisa lebih panjang (nyebut nama-nama kolaborator claim)
      // tetap sempat kebaca.
      tkToastTimer = setTimeout(() => toast.classList.remove("is-show"), 3400);
    }

    function persist() {
      window.__tkTickets = tickets;
    }

    // =================================================================
    // CONFIRMATION POPUP GENERIK -- dipakai ulang untuk Reject Ticket,
    // Reject Submission, Assign to me/Claim, Save Changes/Submit, dan
    // Approve & Resolve (ganti window.confirm() bawaan browser yang
    // polos, biar konsisten sama gaya modal lain di halaman ini). Isinya
    // (ikon/judul/teks/label & warna tombol) diisi dinamis lewat
    // tkConfirm({...}) sesaat sebelum overlay dibuka -- beda dari
    // tkDeleteOverlay yang teksnya statis khusus delete. tkConfirm()
    // balikin Promise<boolean>: true kalau user klik tombol konfirmasi,
    // false kalau Cancel/X/klik di luar modal.
    // =================================================================
    const tkConfirmOverlay = document.getElementById("tkConfirmOverlay");
    const tkConfirmIconEl = document.getElementById("tkConfirmIcon");
    const tkConfirmTitleEl = document.getElementById("tkConfirmTitle");
    const tkConfirmTextEl = document.getElementById("tkConfirmText");
    const tkConfirmCancelBtn = document.getElementById("tkConfirmCancelBtn");
    const tkConfirmCancelX = document.getElementById("tkConfirmCancelX");
    const tkConfirmActionBtn = document.getElementById("tkConfirmActionBtn");
    let tkConfirmResolve = null;

    function tkCloseConfirm(result) {
      tkConfirmOverlay.classList.remove("is-open");
      if (tkConfirmResolve) {
        const resolve = tkConfirmResolve;
        tkConfirmResolve = null;
        resolve(result);
      }
    }

    // options: { icon, iconVariant, title, text, confirmLabel, confirmVariant }
    function tkConfirm(options) {
      const opts = options || {};
      return new Promise((resolve) => {
        // Kalau ada popup konfirmasi lain yang masih nunggu jawaban
        // (harusnya tidak terjadi di alur normal), anggap Cancel dulu
        // biar tidak nyangkut menunggu selamanya.
        if (tkConfirmResolve) tkCloseConfirm(false);
        tkConfirmResolve = resolve;
        tkConfirmIconEl.innerHTML = `<i class="fa-solid ${opts.icon || "fa-circle-question"}"></i>`;
        tkConfirmIconEl.className = `tk-alert-icon ${opts.iconVariant || "is-danger-solid"}`;
        tkConfirmTitleEl.textContent = opts.title || "Are you sure?";
        tkConfirmTextEl.textContent = opts.text || "Please confirm this action.";
        tkConfirmActionBtn.textContent = opts.confirmLabel || "Confirm";
        tkConfirmActionBtn.className = `tk-pill ${opts.confirmVariant || "tk-pill-danger"}`;
        tkConfirmOverlay.classList.add("is-open");
      });
    }

    tkConfirmCancelBtn.addEventListener("click", () => tkCloseConfirm(false));
    tkConfirmCancelX.addEventListener("click", () => tkCloseConfirm(false));
    tkConfirmActionBtn.addEventListener("click", () => tkCloseConfirm(true));
    tkConfirmOverlay.addEventListener("click", (e) => {
      if (e.target === tkConfirmOverlay) tkCloseConfirm(false);
    });

    // =================================================================
    // ATTACHMENT IMAGE LIGHTBOX -- popup di tempat waktu klik foto
    // attachment (dipakai di New Ticket preview, Edit mode, Detail
    // view, Resolution proof), gantinya pindah tab baru lewat
    // target="_blank". Ditutup lewat tombol X, klik area gelap di
    // luar foto, atau tombol Escape.
    // =================================================================
    const tkLightboxOverlay = document.getElementById("tkImageLightboxOverlay");
    const tkLightboxImg = document.getElementById("tkImageLightboxImg");
    const tkLightboxCloseBtn = document.getElementById("tkImageLightboxCloseBtn");

    function tkOpenImageLightbox(src, alt) {
      if (!tkLightboxOverlay || !tkLightboxImg) return;
      tkLightboxImg.src = src;
      tkLightboxImg.alt = alt || "";
      tkLightboxOverlay.classList.add("is-open");
    }

    function tkCloseImageLightbox() {
      if (!tkLightboxOverlay || !tkLightboxImg) return;
      tkLightboxOverlay.classList.remove("is-open");
      tkLightboxImg.src = "";
    }

    if (tkLightboxOverlay) {
      // Klik di mana pun DI DALAM overlay kecuali gambar itu sendiri
      // dihitung "klik di luar foto" -> tutup popup.
      tkLightboxOverlay.addEventListener("click", (e) => {
        if (e.target !== tkLightboxImg) tkCloseImageLightbox();
      });
    }
    if (tkLightboxCloseBtn) {
      tkLightboxCloseBtn.addEventListener("click", tkCloseImageLightbox);
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && tkLightboxOverlay && tkLightboxOverlay.classList.contains("is-open")) {
        tkCloseImageLightbox();
      }
    });

    // Delegasi: semua thumbnail foto attachment dibungkus
    // `<a href="...download..." target="_blank"><img></a>` di dalam
    // `.tk-attach-thumb` (lihat renderAttachmentPreviews, openDetail
    // attachment grid, resolution attachment grid). Daripada ubah tiap
    // tempat satu-satu, klik pada <img>-nya di-intercept di sini supaya
    // buka lightbox, bukan navigasi tab baru -- link aslinya (buat
    // download langsung / buka tab baru manual) tetap ada di href-nya.
    document.addEventListener("click", (e) => {
      const thumbImg = e.target.closest(".tk-attach-thumb img");
      if (!thumbImg) return;
      const link = thumbImg.closest("a");
      if (link) e.preventDefault(); // batalkan navigasi tab baru dari href download-nya
      tkOpenImageLightbox(thumbImg.src, thumbImg.alt);
    });

    // =================================================================
    // CREATE TICKET (+ EDIT oleh pembuat — modal yang SAMA, dibedakan
    // lewat state tkEditingTicketId: null = mode Create (POST), berisi
    // id tiket = mode Edit (PATCH). Lihat tkOpenEdit()/openCreate()).
    // =================================================================
    const createOverlay = document.getElementById("tkCreateOverlay");
    const tkCreateCancelBtn = document.getElementById("tkCreateCancelBtn");
    const createTitleInput = document.getElementById("tkFormTitle");
    const createTypeSelect = document.getElementById("tkFormType");
    const createPrioritySelect = document.getElementById("tkFormPriority");
    const createPageSelect = document.getElementById("tkFormPage");
    const createPageOtherInput = document.getElementById("tkFormPageOther");
    const createPageError = document.getElementById("tkFormPageError");
    const createPageLabel = document.getElementById("tkFormPageLabel");
    const createDescInput = document.getElementById("tkFormDesc");
    const attachLabel = document.getElementById("tkFormAttachmentLabel");

    let tkEditingTicketId = null; // lihat catatan di atas
    // Snapshot assignee ASLI (sorted+normalized) waktu form Edit dibuka
    // -- dipakai di submit handler buat cek APAKAH admin/lead beneran
    // mengubah pilihan assignee atau tidak. Cuma kirim field
    // "assignedTo" ke backend kalau BENERAN berubah -- soalnya
    // updateTicket() mengunci assignedTo selama status Waiting Approval
    // (kecuali root), jadi kalau field ini SELALU dikirim (walau
    // isinya sama), lead yang cuma mau benerin typo title/deskripsi di
    // tiket yang lagi Waiting Approval bakal ke-block gak jelas.
    let tkEditOriginalAssigneeKey = "";
    // Status tiket yang lagi diedit, diambil pas openEdit() dibuka --
    // dipakai submit handler buat mutusin boleh/tidaknya kirim field
    // "expectedHours" (cuma valid kalau statusnya masih "open", lihat
    // openEdit() & validasi yang sama persis di backend updateTicket()).
    let tkEditOriginalStatus = "";

    // "Question" dan "Other" DIKECUALIKAN dari kewajiban Related
    // Page + attachment -- HARUS sinkron dengan
    // isAttachmentExemptCategory() di ticket.service.ts (backend).
    function tkIsExemptType(typeValue) {
      return ["Question", "Other"].includes(typeValue);
    }

    function tkUpdateConditionalRequiredUI() {
      const exempt = tkIsExemptType(createTypeSelect.value);
      createPageLabel.textContent = exempt ? "Related Page (optional)" : "Related Page (required)";
      attachLabel.textContent = exempt ? "Attachments (optional)" : "Attachments (required)";
    }
    createTypeSelect.addEventListener("change", tkUpdateConditionalRequiredUI);

    // ---- Field yang cuma relevan untuk tim R3 ----
    // Spek: "related page dan type dihapus jika di-assign ke tim R1/R2,
    // tapi dipertahankan kalau di-assign ke R3". Kalau disembunyikan,
    // field ini TIDAK dikirim ke backend sama sekali di submit handler
    // di bawah -- backend otomatis fallback ke kategori "Other" (lihat
    // resolveCategory() di ticket.service.ts), yang juga otomatis
    // membebaskan Related Page dari wajib diisi (attachment TETAP wajib
    // untuk semua tim, tidak berubah).
    const teamSelect = document.getElementById("tkFormTeam");
    const typeFieldWrap = document.getElementById("tkFormTypeField");
    const pageFieldWrap = document.getElementById("tkFormPageField");
    function tkUpdateTeamScopedFieldsUI() {
      const isR3 = teamSelect.value === "R3";
      typeFieldWrap.classList.toggle("hidden", !isR3);
      pageFieldWrap.classList.toggle("hidden", !isR3);
      if (!isR3) {
        createPageSelect.closest(".tk-field").classList.remove("has-error");
        createPageError.classList.remove("is-visible");
      }
      // Assignee picker di form Create ikut di-refresh kalau tim diganti
      // (cuma relevan buat admin/lead -- lihat openCreate()), supaya
      // daftar nama yang muncul selalu anggota tim yang BARU dipilih,
      // bukan nyangkut daftar tim sebelumnya.
      const assigneeField = document.getElementById("tkFormAssigneeField");
      if (!tkEditingTicketId && assigneeField && !assigneeField.classList.contains("hidden")) {
        fillAssigneePicker(document.getElementById("tkFormAssigneePicker"), teamSelect.value, [], false);
        document.getElementById("tkFormAssigneeSelectionText").textContent = "Unassigned";
      }
    }
    teamSelect.addEventListener("change", tkUpdateTeamScopedFieldsUI);

    tkPopulateRelatedPageOptions(createPageSelect);
    createPageSelect.addEventListener("change", () => {
      const isOther = createPageSelect.value === TK_RELATED_PAGE_OTHER;
      createPageOtherInput.classList.toggle("hidden", !isOther);
      if (isOther) createPageOtherInput.focus();
      else createPageOtherInput.value = "";
    });

    // Nilai final Related Page yang akan dikirim ke server: value dropdown
    // apa adanya, KECUALI kalau user pilih "Other" -- pakai isian
    // tkFormPageOther (trimmed).
    function tkResolveRelatedPageValue() {
      if (createPageSelect.value === TK_RELATED_PAGE_OTHER) {
        return createPageOtherInput.value.trim();
      }
      return createPageSelect.value;
    }

    // ---------- Attachment (file apa saja) — New/Edit Ticket ----------
    // CATATAN (2026-08-26): dulu attachment cuma boleh foto (dikompres
    // di browser jadi base64 lalu dikirim sebagai field JSON). Sekarang
    // attachment boleh PDF/Word/video/gambar, sampai 10 file @ 25MB --
    // terlalu besar untuk base64 di body JSON, jadi disimpan sebagai
    // File asli (bukan data URL) dan dikirim lewat FormData saat submit.
    // WAJIB minimal 1 file KECUALI tipe tiket Question/Other (lihat
    // tkUpdateConditionalRequiredUI()) -- pengecualian yang sama berlaku
    // untuk Related Page di atas.
    const attachInput = document.getElementById("tkFormAttachment");
    const attachPickBtn = document.getElementById("tkAttachPickBtn");
    const attachFilenameLabel = document.getElementById("tkAttachFilename");
    const attachPreviewGrid = document.getElementById("tkAttachPreviewWrap");
    const attachField = attachInput.closest(".tk-field");
    const attachNoneLabel = attachFilenameLabel.textContent;
    const attachErrorLabel = document.getElementById("tkFormAttachmentError");

    const TK_ATTACH_MAX_FILES = 10;
    const TK_ATTACH_MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
    // Harus sinkron dengan whitelist MIME di ticket-upload.ts (backend).
    const TK_ATTACH_ALLOWED_MIME = new Set([
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "video/x-msvideo",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ]);

    function tkFileKey(file) {
      return `${file.name}::${file.size}::${file.lastModified}::${file.type}`;
    }

    function tkExtractClipboardFiles(event) {
      return Array.from(event.clipboardData?.files || []).filter((file) => file && file.size > 0);
    }

    function tkNormalizeDroppedFiles(dataTransfer) {
      return Array.from(dataTransfer?.files || []).filter((file) => file && file.size > 0);
    }

    function tkFilterAndAppendFiles(target, incoming) {
      const existingKeys = new Set(target.map(tkFileKey));
      let hadError = false;
      for (const file of incoming) {
        if (target.length >= TK_ATTACH_MAX_FILES) {
          hadError = true;
          break;
        }
        if (file.size > TK_ATTACH_MAX_SIZE_BYTES || !TK_ATTACH_ALLOWED_MIME.has(file.type)) {
          hadError = true;
          continue;
        }
        const key = tkFileKey(file);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        target.push(file);
      }
      return hadError;
    }

    function tkWireAttachmentDropzone(dropzone, getTarget, refresh, errorField) {
      if (!dropzone) return;
      const setDragState = (active) => dropzone.classList.toggle("is-dragover", active);
      const addFiles = (files) => {
        if (!files.length) return;
        const hadError = tkFilterAndAppendFiles(getTarget(), files);
        if (errorField) errorField.classList.toggle("has-error", hadError);
        refresh();
      };
      ["dragenter", "dragover"].forEach((type) => {
        dropzone.addEventListener(type, (e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragState(true);
        });
      });
      ["dragleave", "drop"].forEach((type) => {
        dropzone.addEventListener(type, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (type === "drop") addFiles(tkNormalizeDroppedFiles(e.dataTransfer));
          setDragState(false);
        });
      });
      dropzone.addEventListener("paste", (e) => {
        const files = tkExtractClipboardFiles(e);
        if (!files.length) return;
        e.preventDefault();
        e.stopPropagation();
        addFiles(files);
      });
    }

    let createAttachments = []; // [File, File, ...] -- File asli, TIDAK dikonversi ke base64
    // Dipakai mode Edit: jumlah lampiran yang SUDAH ADA di tiket (dari
    // server), supaya kalau user tidak pilih file baru sama sekali,
    // kita tahu apakah masih lolos aturan wajib (masih ada lampiran
    // lama) atau tidak (tiket ini memang belum pernah punya lampiran).
    let tkExistingAttachmentCount = 0;
    let tkExistingAttachments = []; // attachment rows currently retained in Edit mode

    function tkAttachIcon(file) {
      if (file.type.startsWith("image/")) return null; // pakai thumbnail asli, bukan ikon
      if (file.type === "application/pdf") return "fa-file-pdf";
      if (file.type.startsWith("video/")) return "fa-file-video";
      if (file.type.includes("word")) return "fa-file-word";
      return "fa-file";
    }

    function tkFmtFileSize(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function renderAttachmentPreviews() {
      attachPreviewGrid.innerHTML = "";
      const total = tkExistingAttachments.length + createAttachments.length;
      attachPreviewGrid.classList.toggle("hidden", total === 0);

      tkExistingAttachments.forEach((att, idx) => {
        const thumb = document.createElement("div");
        thumb.className = "tk-attach-thumb tk-attach-existing";
        // FIX (bug: lampiran lama tampil "belum muncul"/tidak bisa
        // diklik): sebelumnya section ini SELALU render ikon generik
        // (fa-image dkk) + tidak ada <a>/<img> sama sekali, beda dari
        // grid attachment read-only di modal Detail (lihat
        // tkDetailAttachmentGrid di atas) yang sudah benar: bikin
        // downloadUrl lewat endpoint attachments/:id/:filename, lalu
        // <img> asli untuk gambar + link bisa diklik untuk file lain.
        // Sekarang dicerminkan persis pola yang sama di sini.
        const downloadUrl = `${window.EDASH_BACKEND_API_BASE}${TK_API_PATH}/attachments/${att.id}/${encodeURIComponent(att.fileName || "file")}`;
        const isImage = (att.mimeType || "").startsWith("image/");
        const icon = att.mimeType === "application/pdf" ? "fa-file-pdf" : att.mimeType?.startsWith("video/") ? "fa-file-video" : att.mimeType?.includes("word") ? "fa-file-word" : "fa-file";
        thumb.innerHTML = isImage
          ? `
            <a href="${downloadUrl}" target="_blank" rel="noopener">
              <img src="${downloadUrl}" alt="${escapeHtmlAttr(att.fileName || "attachment")}">
            </a>
            <button type="button" class="tk-attach-remove" aria-label="Remove existing attachment">
              <i class="fa-solid fa-xmark"></i>
            </button>`
          : `
            <a class="tk-attach-file-link" href="${downloadUrl}" target="_blank" rel="noopener">
              <div class="tk-attach-file-icon"><i class="fa-solid ${icon}"></i></div>
              <div class="tk-attach-file-meta">
                <span class="tk-attach-file-name">${escapeHtmlAttr(att.fileName || "attachment")}</span>
                <span class="tk-attach-file-size">${att.sizeBytes != null ? tkFmtFileSize(att.sizeBytes) : "Existing file"}</span>
              </div>
            </a>
            <button type="button" class="tk-attach-remove" aria-label="Remove existing attachment">
              <i class="fa-solid fa-xmark"></i>
            </button>`;
        thumb.querySelector(".tk-attach-remove").addEventListener("click", () => {
          tkExistingAttachments.splice(idx, 1);
          tkExistingAttachmentCount = tkExistingAttachments.length;
          renderAttachmentPreviews();
          updateAttachmentFilenameLabel();
        });
        attachPreviewGrid.appendChild(thumb);
      });

      createAttachments.forEach((file, idx) => {
        const thumb = document.createElement("div");
        thumb.className = "tk-attach-thumb";
        const icon = tkAttachIcon(file);
        thumb.innerHTML = icon
          ? `
            <div class="tk-attach-file-icon"><i class="fa-solid ${icon}"></i></div>
            <div class="tk-attach-file-meta">
              <span class="tk-attach-file-name">${escapeHtmlAttr(file.name)}</span>
              <span class="tk-attach-file-size">${tkFmtFileSize(file.size)}</span>
            </div>
            <button type="button" class="tk-attach-remove" aria-label="Remove attachment">
              <i class="fa-solid fa-xmark"></i>
            </button>`
          : `
            <img src="${URL.createObjectURL(file)}" alt="${escapeHtmlAttr(file.name)}">
            <button type="button" class="tk-attach-remove" aria-label="Remove attachment">
              <i class="fa-solid fa-xmark"></i>
            </button>`;
        thumb.querySelector(".tk-attach-remove").addEventListener("click", () => {
          createAttachments.splice(idx, 1);
          renderAttachmentPreviews();
          updateAttachmentFilenameLabel();
        });
        attachPreviewGrid.appendChild(thumb);
      });
    }

    function updateAttachmentFilenameLabel() {
      const total = tkExistingAttachments.length + createAttachments.length;
      if (!total) {
        attachFilenameLabel.textContent = attachNoneLabel;
        attachFilenameLabel.classList.remove("has-file");
        return;
      }
      attachFilenameLabel.textContent = `${total}/${TK_ATTACH_MAX_FILES} file${total > 1 ? "s" : ""} attached`;
      attachFilenameLabel.classList.add("has-file");
    }

    function escapeHtmlAttr(str) {
      const div = document.createElement("div");
      div.textContent = str == null ? "" : String(str);
      return div.innerHTML;
    }

    function resetAttachments() {
      createAttachments = [];
      tkExistingAttachmentCount = 0;
      tkExistingAttachments = [];
      attachInput.value = "";
      updateAttachmentFilenameLabel();
      renderAttachmentPreviews();
      attachField.classList.remove("has-error");
    }

    attachPickBtn.addEventListener("click", () => attachInput.click());

    attachInput.addEventListener("change", () => {
      const files = Array.from(attachInput.files || []);
      attachInput.value = ""; // supaya bisa pilih file yang sama lagi kalau perlu
      if (!files.length) return;

      const hadError = tkFilterAndAppendFiles(createAttachments, files);
      attachField.classList.toggle("has-error", hadError);
      updateAttachmentFilenameLabel();
      renderAttachmentPreviews();
    });

    tkWireAttachmentDropzone(
      document.getElementById("tkCreateAttachmentDropzone"),
      () => createAttachments,
      () => { updateAttachmentFilenameLabel(); renderAttachmentPreviews(); },
      attachField
    );

    function openCreate() {
      tkEditingTicketId = null;
      const titleEl = document.getElementById("tkCreateModalTitle");
      if (titleEl) titleEl.textContent = "Submit New Ticket";
      // Mode Create: tombol kiri = "Cancel" (batal, balik ke daftar ticket).
      tkCreateCancelBtn.textContent = "Cancel";
      createTitleInput.value = "";
      document.getElementById("tkFormTeam").value = "R3";
      createTypeSelect.value = "Bug";
      createPrioritySelect.value = "medium";
      document.getElementById("tkFormExpectedHours").value = "";
      document.getElementById("tkFormExpectedHours").disabled = false;
      document.getElementById("tkFormExpectedHours").closest(".tk-field").classList.remove("has-error");
      document.getElementById("tkFormExpectedHoursError").classList.remove("is-visible");
      createPageSelect.value = "";
      createPageOtherInput.value = "";
      createPageOtherInput.classList.add("hidden");
      createDescInput.value = "";
      createTitleInput.closest(".tk-field").classList.remove("has-error");
      createDescInput.closest(".tk-field").classList.remove("has-error");
      createPageError.classList.remove("is-visible");
      createPageSelect.closest(".tk-field").classList.remove("has-error");
      tkUpdateConditionalRequiredUI();
      tkUpdateTeamScopedFieldsUI();
      resetAttachments();
      renderAttachmentPreviews();
      updateAttachmentFilenameLabel();
      document.getElementById("tkFormSubmitterName").textContent = tkCurrentUser();
      // FIX: field "Assigned to"/"Deadline" sekarang JUGA muncul di mode
      // Create (sebelumnya cuma di Edit). "Deadline" muncul buat SEMUA
      // pembuat tiket; "Assigned to" HANYA buat admin master (root)/
      // REMS Intern Lead, dan sifatnya OPSIONAL -- defaultnya kosong/
      // tidak assign siapa-siapa (tiket tetap 'Open' kalau dibiarkan
      // kosong, sama seperti alur lama). Field deadline itu sendiri
      // (tkFormEstimatedDays/tkFormDueDateDirect) TIDAK disentuh sama
      // sekali di sini -- cuma soal kapan row-nya kelihatan.
      const canManageAssignmentsAtCreate = tkIsApprover();
      document.getElementById("tkFormAssignDeadlineRow").classList.remove("hidden");
      document.getElementById("tkFormAssigneeField").classList.toggle("hidden", !canManageAssignmentsAtCreate);
      if (canManageAssignmentsAtCreate) {
        fillAssigneePicker(document.getElementById("tkFormAssigneePicker"), document.getElementById("tkFormTeam").value, [], false);
        document.getElementById("tkFormAssigneeSelectionText").textContent = "Unassigned";
      }
      createOverlay.classList.add("is-open");
    }

    // Dipanggil dari tombol Edit di modal Detail (lihat DETAIL section
    // di bawah) -- prefill form pakai data tiket yang lagi dibuka, lalu
    // buka modal yang SAMA dengan Create, cuma switch ke mode PATCH.
    function openEdit(t) {
      tkEditingTicketId = t.id;
      tkEditOriginalStatus = t.status;
      const titleEl = document.getElementById("tkCreateModalTitle");
      // FIX (2026-08-27): sebelumnya baris ini mencari id
      // "tkCreateModalTitle" yang TIDAK ADA di HTML sama sekali (h3/span-nya
      // tidak punya id apapun), jadi getElementById selalu balikin null dan
      // judul modal TIDAK PERNAH berubah dari default statis "Submit New
      // Ticket" -- baik di mode Create maupun Edit. Sudah ditambahkan
      // id="tkCreateModalTitle" ke span-nya di ticketing.html, dan sekarang
      // mode Edit benar-benar diberi judul sendiri.
      if (titleEl) titleEl.textContent = "Edit Ticket";
      // Mode Edit: tombol kiri = "Back" -- balik ke Detail ticket yang lagi
      // diedit, BUKAN "Cancel" ke daftar. Perubahan yang sudah diketik di
      // form ini tidak disimpan kemana pun (tidak ada draft/auto-save),
      // dan tidak ada popup konfirmasi "are you sure" -- langsung balik.
      tkCreateCancelBtn.textContent = "Back";
      createTitleInput.value = t.title || "";
      document.getElementById("tkFormTeam").value = t.team || "R3";
      createTypeSelect.value = t.type || "Bug";
      createPrioritySelect.value = t.priority || "medium";
      document.getElementById("tkFormExpectedHours").value = t.expectedHours || "";
      // FIX: sebelumnya SELALU disabled di mode Edit -- sekarang bisa
      // diedit selama tiket masih berstatus "open" (belum diclaim).
      // Begitu diclaim, timer & bonus poin leaderboard sudah mulai
      // mengacu ke angka ini, jadi dikunci lagi (cocok dengan validasi
      // status yang sama persis di backend updateTicket()).
      document.getElementById("tkFormExpectedHours").disabled = t.status !== "open";
      document.getElementById("tkFormExpectedHours").closest(".tk-field").classList.remove("has-error");
      document.getElementById("tkFormExpectedHoursError").classList.remove("is-visible");
      const knownPage = TK_RELATED_PAGE_OPTIONS.some((o) => o.value === t.relatedPage);
      if (t.relatedPage && !knownPage) {
        createPageSelect.value = TK_RELATED_PAGE_OTHER;
        createPageOtherInput.value = t.relatedPage;
        createPageOtherInput.classList.remove("hidden");
      } else {
        createPageSelect.value = t.relatedPage || "";
        createPageOtherInput.value = "";
        createPageOtherInput.classList.add("hidden");
      }
      createDescInput.value = t.description || "";
      createTitleInput.closest(".tk-field").classList.remove("has-error");
      createDescInput.closest(".tk-field").classList.remove("has-error");
      createPageError.classList.remove("is-visible");
      createPageSelect.closest(".tk-field").classList.remove("has-error");
      tkUpdateConditionalRequiredUI();
      tkUpdateTeamScopedFieldsUI();
      resetAttachments();
      tkExistingAttachments = Array.isArray(t.attachments) ? t.attachments.map((a) => ({...a})) : [];
      tkExistingAttachmentCount = tkExistingAttachments.length;
      renderAttachmentPreviews();
      updateAttachmentFilenameLabel();
      document.getElementById("tkFormSubmitterName").textContent = tkCurrentUser();

      // "Assigned to" + "Deadline" -- HANYA buat admin master (root)
      // atau REMS Intern Lead (canManageAssignments, cermin dari
      // pengecekan yang sama di updateTicket() ticket.service.ts).
      // Assignee biasa/pembuat tiket yang cuma edit tiketnya sendiri
      // SEBELUM diclaim tetap TIDAK lihat dua field ini sama sekali.
      const canManageAssignments = tkIsApprover();
      const assignDeadlineRow = document.getElementById("tkFormAssignDeadlineRow");
      assignDeadlineRow.classList.toggle("hidden", !canManageAssignments);
      // Field ini bisa ke-hide sendiri oleh openCreate() (buat intern
      // biasa, yang cuma boleh lihat Deadline tanpa Assigned to) --
      // dipastikan lagi keliatan di sini kalau baris induknya sendiri
      // ditampilkan, supaya class "hidden" itu tidak nyangkut kalau modal
      // yang sama dipakai gantian Create lalu Edit dalam sesi yang sama.
      document.getElementById("tkFormAssigneeField").classList.remove("hidden");
      if (canManageAssignments) {
        const assignedUsers = tkAssignedUsers(t);
        fillAssigneePicker(document.getElementById("tkFormAssigneePicker"), t.team, assignedUsers, false);
        document.getElementById("tkFormAssigneeSelectionText").textContent =
          assignedUsers.length ? assignedUsers.join(", ") : "Unassigned";
        tkEditOriginalAssigneeKey = [...assignedUsers].map(tkNormalizeName).sort().join(",");
        // Deadline SENGAJA dikosongin (bukan di-prefill nilai lama) --
        // ini form "ubah kalau perlu", bukan "wajib diisi ulang tiap
        // edit". Kosong = deadline tiket TIDAK disentuh sama sekali
        // (lihat submit handler: hanya dikirim kalau salah satu diisi).
        document.getElementById("tkFormEstimatedDays").value = "";
        document.getElementById("tkFormDueDateDirect").value = "";
      }

      createOverlay.classList.add("is-open");
    }
    window.tkOpenEdit = openEdit; // dipanggil dari tkDetailEditBtn di bawah

    function closeCreate() {
      createOverlay.classList.remove("is-open");
      tkEditingTicketId = null;
    }

    // Tombol X / "Cancel" (mode Create) / "Back" (mode Edit) / klik area
    // gelap di luar modal -- SEMUA jalur "batal" ini SENGAJA tidak pernah
    // menyimpan apapun yang sudah diketik user dan TIDAK menampilkan popup
    // konfirmasi apapun (langsung tutup/balik). Bedanya cuma tujuan
    // akhirnya: mode Create balik ke daftar ticket (list), mode Edit balik
    // ke modal Detail ticket yang barusan diedit.
    function closeCreateOrBack() {
      const returningToTicketId = tkEditingTicketId;
      closeCreate();
      if (returningToTicketId) {
        const t = findTicket(returningToTicketId);
        if (t) openDetail(t.id);
      }
    }

    document.getElementById("tkOpenCreate").addEventListener("click", openCreate);
    document.getElementById("tkCreateCloseBtn").addEventListener("click", closeCreateOrBack);
    tkCreateCancelBtn.addEventListener("click", closeCreateOrBack);
    createOverlay.addEventListener("click", (e) => {
      if (e.target === createOverlay) closeCreateOrBack();
    });

    document.getElementById("tkCreateSubmitBtn").addEventListener("click", async () => {
      const title = createTitleInput.value.trim();
      const desc = createDescInput.value.trim();
      const teamValue = document.getElementById("tkFormTeam").value;
      const isR3Team = teamValue === "R3";
      // Type/Related Page cuma ada (dan cuma dikirim) untuk tim R3 --
      // untuk R1/R2 field-nya disembunyikan (tkUpdateTeamScopedFieldsUI())
      // dan backend fallback ke kategori "Other" (lihat resolveCategory()
      // di ticket.service.ts), yang JUGA membebaskan Related Page +
      // Attachment dari wajib diisi -- exempt di sini SENGAJA ikut true
      // untuk R1/R2 supaya validasi frontend konsisten dengan backend.
      const relatedPage = isR3Team ? tkResolveRelatedPageValue() : "";
      const exempt = !isR3Team || tkIsExemptType(createTypeSelect.value);
      const expectedHoursRaw = document.getElementById("tkFormExpectedHours").value.trim();
      const expectedHoursField = document.getElementById("tkFormExpectedHours").closest(".tk-field");
      const expectedHoursError = document.getElementById("tkFormExpectedHoursError");

      let valid = true;
      if (!title) {
        createTitleInput.closest(".tk-field").classList.add("has-error");
        valid = false;
      } else {
        createTitleInput.closest(".tk-field").classList.remove("has-error");
      }
      if (!desc) {
        createDescInput.closest(".tk-field").classList.add("has-error");
        valid = false;
      } else {
        createDescInput.closest(".tk-field").classList.remove("has-error");
      }
      // Expected time (jam) -- WAJIB, bilangan bulat positif (cermin
      // persis validasi createTicket() di ticket.service.ts).
      const expectedHoursNum = Number(expectedHoursRaw);
      if (!expectedHoursRaw || !Number.isInteger(expectedHoursNum) || expectedHoursNum <= 0) {
        expectedHoursField.classList.add("has-error");
        expectedHoursError.classList.add("is-visible");
        valid = false;
      } else {
        expectedHoursField.classList.remove("has-error");
        expectedHoursError.classList.remove("is-visible");
      }
      // Related Page wajib KECUALI tipe Question/Other ATAU tim R1/R2.
      if (!exempt && !relatedPage) {
        createPageSelect.closest(".tk-field").classList.add("has-error");
        createPageError.classList.add("is-visible");
        valid = false;
      } else {
        createPageSelect.closest(".tk-field").classList.remove("has-error");
        createPageError.classList.remove("is-visible");
      }
      // Attachment wajib KECUALI tipe Question/Other ATAU tim R1/R2 --
      // di mode Edit, "sudah ada lampiran lama & tidak pilih file baru"
      // tetap lolos (lampiran lama dipertahankan, bukan dihapus).
      const totalAttachments = tkExistingAttachments.length + createAttachments.length;
      if (totalAttachments > TK_ATTACH_MAX_FILES) {
        attachField.classList.add("has-error");
        attachErrorLabel.textContent = `Maximum ${TK_ATTACH_MAX_FILES} files allowed.`;
        valid = false;
      } else if (!exempt && totalAttachments === 0) {
        attachField.classList.add("has-error");
        attachErrorLabel.textContent = "At least 1 file is required (unless ticket type is Question/Other).";
        valid = false;
      } else {
        attachField.classList.remove("has-error");
      }

      // Deadline -- field ini SEKARANG selalu kelihatan (Create untuk
      // SEMUA pembuat tiket, Edit untuk admin/lead) -- dibaca kapanpun
      // ada isinya, TIDAK lagi digembok "editingAsManager" (itu cuma
      // relevan buat "Assigned to", bukan Deadline; sebelumnya dua-duanya
      // ke-gembok bareng jadi Deadline diam-diam tidak pernah terkirim
      // sama sekali walau sudah diisi, baik saat Create maupun Edit).
      // Dua-duanya boleh kosong (= deadline tidak diubah/tidak diisi);
      // kalau "Estimated days" diisi, wajib bilangan bulat positif
      // (cermin validasi yang sama persis di section DL modal Detail).
      const formAssignDeadlineRow = document.getElementById("tkFormAssignDeadlineRow");
      const editingAsManager = !!tkEditingTicketId && !formAssignDeadlineRow.classList.contains("hidden");
      const formEstimatedDaysInput = document.getElementById("tkFormEstimatedDays");
      const formEstimatedDaysRaw = formEstimatedDaysInput.value.trim();
      const formDueDateRaw = document.getElementById("tkFormDueDateDirect").value;
      if (formEstimatedDaysRaw && (!Number.isInteger(Number(formEstimatedDaysRaw)) || Number(formEstimatedDaysRaw) <= 0)) {
        formEstimatedDaysInput.closest(".tk-field").classList.add("has-error");
        valid = false;
      } else {
        formEstimatedDaysInput.closest(".tk-field").classList.remove("has-error");
      }

      if (!valid) return;

      // Pop up konfirmasi (yes/no) sebelum benar-benar create/edit ticket --
      // pakai tkConfirm() generik yang sama dengan Approve/Reject/Claim,
      // BUKAN window.confirm() bawaan browser, biar konsisten (lihat
      // tkConfirm() di atas). Kalau user pilih "No"/cancel/klik luar,
      // batal submit dan tetap di form (input yang sudah diisi TIDAK hilang).
      const isEditMode = !!tkEditingTicketId;
      const confirmedSubmit = await tkConfirm({
        icon: isEditMode ? "fa-pen" : "fa-paper-plane",
        iconVariant: "is-primary-solid",
        title: isEditMode ? "Save changes to this ticket?" : "Submit this ticket?",
        text: isEditMode
          ? "Please make sure the details you edited are correct before saving."
          : "Please double-check the title, description, and attachments before submitting.",
        confirmLabel: isEditMode ? "Save Changes" : "Submit Ticket",
        confirmVariant: "tk-pill-primary",
      });
      if (!confirmedSubmit) return;

      const submitBtn = document.getElementById("tkCreateSubmitBtn");
      submitBtn.disabled = true;

      // Dikirim sebagai multipart/form-data (BUKAN JSON) -- attachment
      // bisa berupa video s.d. 25MB x 10 file, terlalu besar untuk
      // dikirim sebagai base64 di body JSON. edashApiFetch() sudah
      // diupdate (js/api-config.js) supaya tidak memaksa
      // Content-Type: application/json kalau body-nya FormData.
      const form = new FormData();
      form.append("title", title);
      form.append("description", desc);
      // Type/Related Page CUMA dikirim untuk tim R3 -- untuk R1/R2
      // sengaja TIDAK di-append sama sekali, biar backend fallback ke
      // kategori "Other" (lihat resolveCategory() di ticket.service.ts).
      if (isR3Team) {
        form.append("type", createTypeSelect.value);
        form.append("relatedPage", relatedPage);
      }
      form.append("team", teamValue);
      form.append("priority", createPrioritySelect.value);
      // expectedHours cuma relevan saat CREATE (ditentukan pembuat tiket
      // sekali di awal) -- backend updateTicket() tidak membaca field ini
      // sama sekali, sengaja tidak dikirim lagi saat mode Edit supaya
      // tidak menyesatkan (nilainya tetap dari waktu ticket dibuat).
      // expectedHours: SELALU dikirim saat Create. Saat Edit, HANYA
      // dikirim kalau tiket dibuka dalam status "open" (field-nya baru
      // enabled di kondisi itu, lihat openEdit()) -- backend
      // updateTicket() MENOLAK field ini sama sekali begitu status
      // sudah bukan Open lagi, jadi kalau tetap dikirim saat status
      // lain, SELURUH request edit ini (termasuk title/deskripsi yang
      // sah) ikut gagal. tkEditOriginalStatus dipakai (bukan t.status
      // langsung) karena disnapshot pas form dibuka, konsisten sama
      // pola tkEditOriginalAssigneeKey di atas.
      if (!tkEditingTicketId || tkEditOriginalStatus === "open") {
        form.append("expectedHours", String(expectedHoursNum));
      }
      createAttachments.forEach((file) => form.append("files", file, file.name));
      if (isEditMode) {
        if (tkExistingAttachments.length) {
          tkExistingAttachments.forEach((att) => form.append("keepAttachmentIds", att.id));
        } else {
          // Empty value is intentional: it means "remove all existing"
          // rather than "field omitted, keep everything".
          form.append("keepAttachmentIds", "");
        }
      }

      // "Assigned to" -- HANYA dikirim di mode Edit oleh admin/lead
      // (editingAsManager, dihitung di atas sebelum validasi). SELALU
      // dikirim (walau kosong = "Unassigned", biar admin bisa sengaja
      // meng-unassign semua orang dari form ini juga).
      if (editingAsManager) {
        const formAssignees = getSelectedAssigneesFrom(document.getElementById("tkFormAssigneePicker"));
        // Cuma kirim "assignedTo" kalau BENERAN beda dari snapshot awal
        // (tkEditOriginalAssigneeKey) -- lihat catatan panjang di
        // deklarasi variabel itu (biar gak ke-lock gara-gara status
        // Waiting Approval padahal cuma mau edit title/deskripsi).
        const formAssigneeKey = [...formAssignees].map(tkNormalizeName).sort().join(",");
        if (formAssigneeKey !== tkEditOriginalAssigneeKey) {
          formAssignees.forEach((name) => form.append("assignedTo", name));
          if (formAssignees.length === 0) form.append("assignedTo", "");
        }
      } else if (!tkEditingTicketId && !document.getElementById("tkFormAssigneeField").classList.contains("hidden")) {
        // Mode Create + admin/lead: assignment OPSIONAL, defaultnya
        // kosong (Unassigned). Cuma di-append kalau BENERAN ada yang
        // dipilih -- tidak kirim apa-apa = tiket tetap 'Open' seperti
        // biasa (lihat createTicket() di ticket.service.ts: kalau
        // assignedTo kosong/tidak dikirim, tiket dibuat Open seperti
        // sebelumnya, tidak otomatis In Progress).
        const formAssignees = getSelectedAssigneesFrom(document.getElementById("tkFormAssigneePicker"));
        formAssignees.forEach((name) => form.append("assignedTo", name));
      }

      // Deadline -- INDEPENDEN dari blok assignee di atas (lihat catatan
      // FIX di deklarasi formEstimatedDaysRaw/formDueDateRaw). Berlaku
      // buat SEMUA pembuat tiket saat Create, dan admin/lead saat Edit.
      // HANYA dikirim kalau salah satu diisi -- kosong dua-duanya =
      // deadline tidak diisi (Create) / tidak diubah (Edit).
      if (formDueDateRaw) {
        form.append("dueDate", new Date(formDueDateRaw).toISOString());
      } else if (formEstimatedDaysRaw) {
        form.append("estimatedDays", formEstimatedDaysRaw);
      }

      // FIX (bug: submit/edit tombolnya ngebug -- tidak bisa submit sama
      // sekali): sebelumnya ada `const isEdit = ...` di SINI (setelah
      // dipakai duluan di blok "if (isEdit)" untuk keepAttachmentIds di
      // atas). Karena `const`/`let` di JS punya temporal dead zone, akses
      // `isEdit` sebelum baris deklarasinya tereksekusi langsung lempar
      // "ReferenceError: Cannot access 'isEdit' before initialization" --
      // errornya kejadian SEBELUM request fetch manapun dikirim, jadi
      // submit (create MAUPUN edit) selalu gagal total, persis seperti
      // yang dilaporkan. isEditMode (sudah dideklarasikan lebih awal,
      // dipakai buat teks konfirmasi popup) merepresentasikan hal yang
      // sama persis -- variabel isEdit yang duplikat ini dihapus, semua
      // pemakaiannya di bawah diganti isEditMode.
      try {
        // timeoutMs dilebihkan dari default 20 detik -- attachment bisa
        // berupa video s.d. 25MB x 10 file, upload-nya bisa makan waktu
        // lebih dari 20 detik di koneksi yang tidak terlalu cepat
        // (lihat FIX timeout di api-config.js).
        const ticket = await window.edashApiFetch(
          isEditMode ? `${TK_API_PATH}/${tkEditingTicketId}` : TK_API_PATH,
          { method: isEditMode ? "PATCH" : "POST", body: form, timeoutMs: 120000 }
        );

        if (isEditMode) {
          const idx = tickets.findIndex((x) => x.id === ticket.id);
          if (idx !== -1) tickets[idx] = ticket;
        } else {
          tickets.unshift(ticket);
        }
        persist();
        renderAll();
        closeCreate();
        showToast(isEditMode ? "Ticket updated" : "Ticket submitted");

        if (typeof logActivity === "function") {
          logActivity({
            eventType: isEditMode ? "ticket_edited" : "ticket_submitted",
            user: tkCurrentUser(),
            userRole: tkCurrentRole(),
            status: "success",
            detail: `${isEditMode ? "Edited" : "Submitted"} ${tkTypeLabel(ticket.type)} ticket: ${ticket.title}`,
            data: { ticketId: ticket.id, type: ticket.type, priority: ticket.priority },
          });
        }

        // Notifikasi bell di header -- HANYA untuk submit baru (bukan
        // edit), dipicu dari role APAPUN yang submit. Visibilitasnya
        // sendiri (cuma tampil untuk role "360 REMS Intern") diatur di
        // dalam hdLogTicketCreated/hdRenderNotifications (header.js),
        // bukan di sini -- di sini cukup selalu log apa adanya.
        if (!isEditMode && typeof window.hdLogTicketCreated === "function") {
          window.hdLogTicketCreated(ticket);
        }
      } catch (e) {
        console.warn("[ticketing] Gagal menyimpan ticket:", e.message);
        showToast(e.message || "Failed to save ticket");
      } finally {
        submitBtn.disabled = false;
      }
    });

    // =================================================================
    // DETAIL / ASSIGN / STATUS / COMMENTS

    // =================================================================
    const detailOverlay = document.getElementById("tkDetailOverlay");
    const detailAssigneeSelect = document.getElementById("tkDetailAssignee");
    const detailAssigneePicker = document.getElementById("tkDetailAssigneePicker");
    const detailAssigneeSelectionText = document.getElementById("tkDetailAssigneeSelectionText");
    const detailStatusSelect = document.getElementById("tkDetailStatus");

    // ---- Bukti pengerjaan (resolution proof) -- textarea + file wajib
    // diisi assignee begitu status mau diganti ke Waiting Approval.
    // Cermin PERSIS dari validasi wajib di ticket.service.ts updateTicket()
    // (deskripsi + minimal 1 file, lihat komentar "1b. Bukti pengerjaan").
    // Section-nya sendiri disembunyikan total kecuali status TUJUAN di
    // dropdown = Waiting Approval DAN tiket belum pernah di status itu. ----
    const resolutionSection = document.getElementById("tkResolutionSection");
    const resolutionNoteInput = document.getElementById("tkResolutionNoteInput");
    const resolutionNoteField = resolutionNoteInput.closest(".tk-field");
    const resolutionAttachInput = document.getElementById("tkResolutionFileInput");
    const resolutionAttachPickBtn = document.getElementById("tkResolutionFilePickBtn");
    const resolutionAttachFilename = document.getElementById("tkResolutionFilename");
    const resolutionAttachPreviewWrap = document.getElementById("tkResolutionPreviewWrap");
    const resolutionAttachErrorLabel = document.getElementById("tkResolutionFileError");
    const resolutionAttachNoneLabel = resolutionAttachFilename.textContent;

    let tkResolutionAttachments = []; // [File, File, ...] -- File asli, sama pola dengan createAttachments

    function tkRenderResolutionPreviews() {
      resolutionAttachPreviewWrap.innerHTML = "";
      resolutionAttachPreviewWrap.classList.toggle("hidden", tkResolutionAttachments.length === 0);
      tkResolutionAttachments.forEach((file, idx) => {
        const thumb = document.createElement("div");
        thumb.className = "tk-attach-thumb";
        const icon = tkAttachIcon(file);
        thumb.innerHTML = icon
          ? `
            <div class="tk-attach-file-icon"><i class="fa-solid ${icon}"></i></div>
            <div class="tk-attach-file-meta">
              <span class="tk-attach-file-name">${escapeHtmlAttr(file.name)}</span>
              <span class="tk-attach-file-size">${tkFmtFileSize(file.size)}</span>
            </div>
            <button type="button" class="tk-attach-remove" aria-label="Remove attachment" data-idx="${idx}">
              <i class="fa-solid fa-xmark"></i>
            </button>
          `
          : `
            <img src="${URL.createObjectURL(file)}" alt="${escapeHtmlAttr(file.name)}">
            <button type="button" class="tk-attach-remove" aria-label="Remove attachment" data-idx="${idx}">
              <i class="fa-solid fa-xmark"></i>
            </button>
          `;
        thumb.querySelector(".tk-attach-remove").addEventListener("click", () => {
          tkResolutionAttachments.splice(idx, 1);
          tkRenderResolutionPreviews();
          tkUpdateResolutionFilenameLabel();
        });
        resolutionAttachPreviewWrap.appendChild(thumb);
      });
    }

    function tkUpdateResolutionFilenameLabel() {
      if (!tkResolutionAttachments.length) {
        resolutionAttachFilename.textContent = resolutionAttachNoneLabel;
        resolutionAttachFilename.classList.remove("has-file");
        return;
      }
      resolutionAttachFilename.textContent = `${tkResolutionAttachments.length}/${TK_ATTACH_MAX_FILES} file${tkResolutionAttachments.length > 1 ? "s" : ""} selected`;
      resolutionAttachFilename.classList.add("has-file");
    }

    function tkResetResolutionFields() {
      tkResolutionAttachments = [];
      resolutionAttachInput.value = "";
      resolutionNoteInput.value = "";
      tkUpdateResolutionFilenameLabel();
      tkRenderResolutionPreviews();
      resolutionNoteField.classList.remove("has-error");
      resolutionAttachPickBtn.closest(".tk-field").classList.remove("has-error");
    }

    resolutionAttachPickBtn.addEventListener("click", () => resolutionAttachInput.click());
    resolutionAttachInput.addEventListener("change", () => {
      const files = Array.from(resolutionAttachInput.files || []);
      resolutionAttachInput.value = "";
      if (!files.length) return;
      const attachField = resolutionAttachPickBtn.closest(".tk-field");
      const hadError = tkFilterAndAppendFiles(tkResolutionAttachments, files);
      attachField.classList.toggle("has-error", hadError);
      tkUpdateResolutionFilenameLabel();
      tkRenderResolutionPreviews();
    });

    tkWireAttachmentDropzone(
      document.getElementById("tkResolutionAttachmentDropzone"),
      () => tkResolutionAttachments,
      () => { tkUpdateResolutionFilenameLabel(); tkRenderResolutionPreviews(); },
      resolutionAttachPickBtn.closest(".tk-field")
    );

    // ---- Siapa yang boleh isi/lihat FORM proof-of-completion --
    // assignee tiket ini SAAT INI, TERMASUK yang baru saja dipilih
    // lewat dropdown "Assigned to"/tombol "Assign to me" SEBELUM Save
    // diklik (dropdown-nya sendiri sumber kebenarannya, bukan t.assignedTo
    // yang masih nilai lama dari server) -- atau admin master (root).
    // Cermin dari effectiveAssignedTo di ticket.service.ts updateTicket()
    // (bagian "1b. Bukti pengerjaan"). BUKAN pembuat tiket, BUKAN staff
    // lain yang cuma kebetulan buka detail tiket ini. ----
    function tkCanSubmitProof() {
      if (sessionStorage.getItem("edash-role-tier") === "root") return true;
      return tkAssignedUsers(findTicket(tkActiveId)).includes(tkCurrentUser());
    }

    // Kunci opsi "Waiting Approval" di dropdown Status buat siapapun
    // yang BUKAN assignee (efektif)/root -- supaya orang lain (paling
    // sering: PEMBUAT tiket yang cuma buka detail tiketnya sendiri,
    // belum tentu jadi assignee-nya) tidak bisa sama sekali memicu
    // form proof-of-completion ini, apalagi sampai coba Save (yang
    // backend PASTI tolak 403). Opsi tetap aktif kalau tiket MEMANG
    // sudah Waiting Approval dari awal (cuma buat lihat, bukan ubah).
    // JUGA dikunci kalau timer pengerjaan belum pernah di-mulai sama
    // sekali di sesi In Progress ini (t.timerRunning masih false) --
    // cermin dari pengecekan existing.timer_started_at di
    // ticket.service.ts updateTicket(). total_worked_seconds > 0 doang
    // (sisa sesi sebelumnya, mis. abis Reject) TIDAK cukup, assignee
    // tetap wajib klik "Mulai Mengerjakan" lagi buat sesi yang ini.
    function tkRefreshStatusOptionAvailability() {
      const waitingOpt = detailStatusSelect.querySelector('option[value="waiting_approval"]');
      const progressOpt = detailStatusSelect.querySelector('option[value="in_progress"]');
      const t = findTicket(tkActiveId);
      if (!t) return;
      const alreadyWaiting = t.status === "waiting_approval";
      const timerNotStarted = !t.timerRunning;
      const lockedWaiting = (!tkCanSubmitProof() || timerNotStarted) && !alreadyWaiting;
      if (waitingOpt) {
        waitingOpt.disabled = lockedWaiting;
        waitingOpt.title = lockedWaiting
          ? (!tkCanSubmitProof()
              ? "Only the current assignee (or an admin) can mark this ticket as Waiting Approval"
              : "Click \"Start Working\" first to begin the work timer before submitting for approval")
          : "";
      }
      const lockProgress = alreadyWaiting;
      if (progressOpt) {
        progressOpt.disabled = lockProgress;
        progressOpt.title = lockProgress
          ? "Waiting Approval is locked until an approver approves or rejects the submission"
          : "";
      }
      // Pill status-nya sendiri di-render ulang di sini supaya selalu
      // ikut kondisi disabled/value <select> terbaru di atas -- satu
      // titik integrasi, dipanggil tiap kali tkRefreshResolutionSectionVisibility()
      // jalan (openDetail() + listener "change" di bawah).
      renderStatusPicker();
    }

    // Nampilin/nyembunyiin section bukti pengerjaan tergantung status
    // TUJUAN yang lagi dipilih di dropdown dibanding status tiket
    // SEKARANG (t.status) -- cuma wajib begitu MASUK Waiting Approval,
    // bukan kalau statusnya memang sudah Waiting Approval dari awal.
    //
    // PENTING (fix bug "Save Changes gak pindah ke Waiting Approval"):
    // form INPUT (#tkResolutionInputWrap, di dalam #tkResolutionSection)
    // sekarang HANYA muncul kalau pill status "Waiting Approval" lagi
    // DIPILIH (isEnteringWaitingApproval) -- BUKAN lagi otomatis muncul
    // begitu timer di-start walau pill masih "In Progress". Sebelumnya
    // form ini ikut nongol tiap kali hasResolution true (submission LAMA
    // ada, mis. abis Reject) + timer jalan, jadi user ngerasa udah
    // "ngisi form submit" padahal status pill masih "In Progress" --
    // pas Save Changes diklik, cuma resolutionNote-nya yang kesimpen
    // (lewat jalur explicitResolutionEdit di backend), status TETAP In
    // Progress karena nextStatus yang dikirim juga "in_progress".
    // Tampilan submission SEBELUMNYA (read-only) sekarang independen,
    // ada di #tkResolutionViewWrap yang posisinya DI ATAS section Status
    // di HTML -- visibility-nya cuma bergantung ke hasResolution, gak
    // peduli pill status yang lagi aktif.
    function tkRefreshResolutionSectionVisibility() {
      const t = findTicket(tkActiveId);
      const resolutionViewWrap = document.getElementById("tkResolutionViewWrap");
      const resolutionInputWrap = document.getElementById("tkResolutionInputWrap");
      if (!t) {
        resolutionSection.classList.add("hidden");
        if (resolutionViewWrap) resolutionViewWrap.classList.add("hidden");
        return;
      }
      tkRefreshStatusOptionAvailability();
      const hasResolution = !!t.resolutionNote || (Array.isArray(t.resolutionAttachments) && t.resolutionAttachments.length > 0);
      const isFinal = t.status === "resolved" || t.status === "rejected";
      const canSubmitProof = tkCanSubmitProof();
      const isEnteringWaitingApproval = detailStatusSelect.value === "waiting_approval" && t.status !== "waiting_approval";
      const isWaitingApproval = t.status === "waiting_approval";
      // canEditProof JUGA wajib t.timerRunning -- kalau nggak, abis
      // Reject (balik ke In Progress, tapi resolutionNote/attachments
      // LAMA masih nyangkut di t.resolutionNote/resolutionAttachments)
      // hasResolution jadi true dan form ini kebuka lagi WALAU timer
      // belum di-start ulang -- persis bug yang dilaporin user: bisa
      // ngedit deskripsi/upload file proof sebelum klik "Mulai
      // Mengerjakan". Cermin dari gate yang sama di
      // tkRefreshStatusOptionAvailability() (opsi "Waiting Approval").
      const canEditProof = canSubmitProof && !isFinal && !isWaitingApproval && t.timerRunning;
      const isApproverWaiting = tkIsApprover() && isWaitingApproval;

      // Read-only "Proof of Completion" -- independen dari pill status,
      // cuma nongol kalau MEMANG ada submission (baru atau bekas
      // reject), di posisi (HTML) di atas section Status.
      if (resolutionViewWrap) resolutionViewWrap.classList.toggle("hidden", !hasResolution);

      // Form input -- HANYA kalau pill "Waiting Approval" lagi dipilih
      // (bukan cuma karena ada submission lama atau timer jalan).
      const showInput = canEditProof && !isApproverWaiting && isEnteringWaitingApproval;
      resolutionSection.classList.toggle("hidden", !showInput);
      resolutionInputWrap.classList.toggle("hidden", !showInput);
      if (showInput && resolutionNoteInput.value === "" && t.resolutionNote) {
        resolutionNoteInput.value = t.resolutionNote;
      }
    }

    function tkPrepareResolutionFields(t) {
      tkResolutionAttachments = [];
      resolutionAttachInput.value = "";
      resolutionNoteInput.value = t?.resolutionNote || "";
      tkUpdateResolutionFilenameLabel();
      tkRenderResolutionPreviews();
      resolutionNoteField.classList.remove("has-error");
      resolutionAttachPickBtn.closest(".tk-field").classList.remove("has-error");
    }

    detailStatusSelect.addEventListener("change", tkRefreshResolutionSectionVisibility);
    // Assignee bisa berubah dari dropdown "Assigned to" langsung (bukan
    // cuma tombol "Assign to me", lihat listener-nya di bawah) -- kalau
    // itu terjadi, hak akses form proof-of-completion (tkCanSubmitProof())
    // ikut berubah, jadi section ini harus di-refresh juga.
    detailAssigneeSelect.addEventListener("change", tkRefreshResolutionSectionVisibility);

    function findTicket(id) {
      return tickets.find((t) => t.id === id) || null;
    }

    // ---------- Timer live-tick (cuma tampilan, tidak nge-fetch server) ----------
    let tkTimerTickHandle = null;
    function tkStartTimerTick(renderFn) {
      tkStopTimerTick();
      tkTimerTickHandle = window.setInterval(renderFn, 1000);
    }
    function tkStopTimerTick() {
      if (tkTimerTickHandle) {
        window.clearInterval(tkTimerTickHandle);
        tkTimerTickHandle = null;
      }
    }

    // ---------- Version history (icon jam ala Google Docs + drawer) ----------
    // GET /tickets/:id/edit-logs -- lihat getTicketEditLogs() di
    // ticket.service.ts (ORDER BY edited_at DESC, jadi log[0] = paling
    // baru). Dipakai buat 2 hal sekaligus:
    //  1. Chip ringkas "Last edited" di meta grid (#tkDetailLastEdited).
    //  2. Isi drawer #tkHistoryDrawer yang dibuka lewat icon jam
    //     (#tkDetailHistoryBtn) di header modal -- daftar versi mirip
    //     panel "Version history" Google Docs (yang paling baru ditandai
    //     "Current version"), klik salah satu versi LAMA -> tampilkan
    //     preview versi itu (tkApplyEditLogSnapshot()) + banner
    //     "Back to latest" di body modal.
    let tkCurrentEditLogs = [];
    async function tkLoadTicketLastEdited(ticketId) {
      const lastEditedEl = document.getElementById("tkDetailLastEdited");
      const historyBtn = document.getElementById("tkDetailHistoryBtn");
      try {
        tkCurrentEditLogs = await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(ticketId)}/edit-logs`);
        if (!Array.isArray(tkCurrentEditLogs)) tkCurrentEditLogs = [];
      } catch (e) {
        tkCurrentEditLogs = [];
      }
      if (lastEditedEl) {
        lastEditedEl.textContent = tkCurrentEditLogs.length
          ? `${tkCurrentEditLogs[0].editedBy}, ${tkFmtDate(tkCurrentEditLogs[0].editedAt)}`
          : "—";
      }
      if (historyBtn) historyBtn.classList.toggle("hidden", tkCurrentEditLogs.length === 0);
      tkRenderHistoryDrawerList();
    }

    function tkRenderHistoryDrawerList() {
      const list = document.getElementById("tkHistoryDrawerList");
      if (!list) return;
      list.innerHTML = "";
      // Baris paling atas = "Current version" (data ASLI tiket sekarang,
      // bukan salah satu log) -- persis pola Google Docs.
      const currentRow = document.createElement("div");
      currentRow.className = "tk-history-item is-current";
      currentRow.innerHTML = `
        <span class="tk-history-item-when">${tkFmtDate(new Date().toISOString())}</span>
        <span class="tk-history-item-current-label" data-i18n="ticketing.detail.currentVersion">Current version</span>
      `;
      list.appendChild(currentRow);
      tkCurrentEditLogs.forEach((log, idx) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "tk-history-item";
        row.innerHTML = `
          <span class="tk-history-item-when">${tkFmtDate(log.editedAt)}</span>
          <span class="tk-history-item-who">${escapeHtml(log.editedBy)}</span>
          <span class="tk-history-item-fields">${escapeHtml((log.changedFields || []).join(", "))}</span>
        `;
        row.addEventListener("click", () => {
          tkApplyEditLogSnapshot(idx);
          tkCloseHistoryDrawer();
        });
        list.appendChild(row);
      });
    }

    function tkOpenHistoryDrawer() {
      document.getElementById("tkHistoryDrawer").classList.add("is-open");
    }
    function tkCloseHistoryDrawer() {
      document.getElementById("tkHistoryDrawer").classList.remove("is-open");
    }
    document.getElementById("tkDetailHistoryBtn").addEventListener("click", tkOpenHistoryDrawer);
    document.getElementById("tkHistoryDrawerCloseBtn").addEventListener("click", tkCloseHistoryDrawer);

    // Timpa SEMENTARA title/desc/badge/assignee/DL di modal dengan
    // snapshotBefore log ke-idx (nilai SEBELUM edit itu terjadi), tanpa
    // mengubah data asli -- dipanggil pas klik versi lama di drawer.
    function tkApplyEditLogSnapshot(idx) {
      const log = tkCurrentEditLogs[idx];
      if (!log) return;
      const snap = log.snapshotBefore || {};
      if (snap.title !== undefined) document.getElementById("tkDetailTitle").textContent = snap.title;
      if (snap.description !== undefined) document.getElementById("tkDetailDesc").textContent = snap.description || "—";
      if (snap.priority !== undefined) {
        document.getElementById("tkDetailPriorityBadge").className = `tk-pill tk-pill-priority-${snap.priority}`;
        document.getElementById("tkDetailPriorityBadge").textContent = tkPriorityLabel(snap.priority);
      }
      if (snap.team !== undefined) {
        document.getElementById("tkDetailTeamBadge").className = `tk-pill tk-pill-team-${(snap.team || "").toLowerCase()}`;
        document.getElementById("tkDetailTeamBadge").textContent = tkTeamLabel(snap.team);
      }
      if (snap.categoryName !== undefined) {
        document.getElementById("tkDetailTypeBadge").className = `tk-pill tk-pill-type-${tkTypeSlug(snap.categoryName)}`;
        document.getElementById("tkDetailTypeBadge").textContent = tkTypeLabel(snap.categoryName);
      }
      if (snap.relatedPage !== undefined) document.getElementById("tkDetailPage").textContent = snap.relatedPage || "—";
      if (snap.assignedTo !== undefined && detailAssigneeSelectionText) {
        const names = Array.isArray(snap.assignedTo) ? snap.assignedTo : [];
        detailAssigneeSelectionText.textContent = names.length ? names.join(", ") : "Unassigned";
      }
      if (snap.dueDate !== undefined) {
        document.getElementById("tkDetailDueDate").textContent = snap.dueDate ? tkFmtDate(snap.dueDate) : "—";
      }
      const banner = document.getElementById("tkEditLogBanner");
      document.getElementById("tkEditLogBannerText").textContent =
        `Viewing version before ${log.editedBy}'s edit on ${tkFmtDate(log.editedAt)}`;
      banner.classList.remove("hidden");
    }
    document.getElementById("tkEditLogBackBtn").addEventListener("click", () => {
      const t = findTicket(tkActiveId);
      document.getElementById("tkEditLogBanner").classList.add("hidden");
      if (t) openDetail(t.id); // re-render dari data ASLI (bukan snapshot)
    });

    // Dipanggil dari master/header/header.js saat notifikasi "Tiket Baru
    // Disubmit" diklik -- sama seperti deep-link ?ticket=<id> di bawah,
    // cuma dipicu dari notif bell bukan dari URL. Ticket list (`tickets`)
    // sudah pasti ter-load duluan karena hdNavigateToNotifPage() nunggu
    // promise loadPage()/initTicketing() selesai dulu sebelum manggil ini.
    window.tkGoToTicket = function (ticketId) {
      const t = findTicket(ticketId);
      if (!t) {
        showToast("Ticket not found or no longer available");
        return;
      }
      openDetail(t.id);
    };

    function renderComments(t) {
      const list = document.getElementById("tkCommentsList");
      const countEl = document.getElementById("tkCommentsCount");
      list.innerHTML = "";
      const comments = t.comments || [];
      if (countEl) countEl.textContent = String(comments.length);
      if (!comments.length) {
        list.innerHTML =
          '<div class="tk-comments-empty"><i class="fa-regular fa-comment-dots"></i><span data-i18n="ticketing.detail.commentsEmpty">No comments yet.</span></div>';
        return;
      }
      comments
        .slice()
        // NOTE 2026-08-25: backend (ticket.service.ts shapeTicket) mengirim
        // field "user"/"comment"/"createdAt" -- BUKAN "author"/"text"/"at".
        // Sebelumnya di sini masih pakai nama field lama sehingga selalu
        // undefined dan tampil sebagai "--" di UI.
        //
        // NOTE 2026-09-05: urutan diubah ke ASCENDING (pesan terlama di atas,
        // pesan terbaru di bawah) supaya bacanya kayak chat -- sebelumnya
        // descending jadi komentar baru malah nongol paling atas.
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .forEach((c) => {
          const item = document.createElement("div");
          const isOwn = tkNormalizeName(c.user) === tkNormalizeName(tkCurrentUser());
          item.className = "tk-comment-item" + (isOwn ? " is-own" : "");
          // Avatar inisial -- pola sama dengan tk-podium-avatar/
          // tk-leaderboard-avatar (2 huruf pertama nama, uppercase).
          // NOTE 2026-09-05: fallback kalau c.user kosong/null (mis. data
          // lama sebelum join username kepasang) -- sebelumnya kalau kosong
          // baris nama+jam jadi terlihat kosong total di UI, sekarang
          // minimal ada "You"/"Unknown" + tanggalnya tetap kepampang.
          const authorLabel = c.user || (isOwn ? "You" : "Unknown");
          const initials = authorLabel.slice(0, 2).toUpperCase();
          const timeLabel = tkFmtDate(c.createdAt);
          // NOTE 2026-09-07: avatar sekarang pakai foto profil AKTIF si
          // pengirim komentar (c.photoUrl) kalau ada, fallback ke inisial
          // nama kalau belum pernah upload foto -- pola sama dengan
          // applyAvatar() di js/main.js (header). c.photoUrl dikirim
          // backend LIVE dari tabel users tiap kali tiket di-fetch (lihat
          // ticket.service.ts shapeTicket()), BUKAN snapshot foto saat
          // komentar dibuat -- jadi begitu user ganti foto di Settings,
          // komentar LAMA dia pun otomatis ikut tampil dengan foto barunya.
          const avatarInnerHtml = c.photoUrl
            ? `<img src="${escapeHtml(c.photoUrl)}" alt="${escapeHtml(authorLabel)}">`
            : escapeHtml(initials);
          // NOTE 2026-09-05: balik ke layout head-di-atas-bubble (bukan
          // gaya WhatsApp jam-di-pojok, itu direvert -- kelihatan jelek).
          // Bedanya: komentar DIRI SENDIRI gak nampilin nama lagi di head
          // (kan jelas itu kita), cukup tanggal/jamnya aja. Komentar orang
          // lain tetap nama + jam kayak semula.
          item.innerHTML = isOwn
            ? `
            <div class="tk-comment-body">
              <div class="tk-comment-item-head">
                <span class="tk-comment-time">${timeLabel}</span>
              </div>
              <div class="tk-comment-bubble">
                <div class="tk-comment-text">${escapeHtml(c.comment)}</div>
              </div>
            </div>
          `
            : `
            <div class="tk-comment-avatar">${avatarInnerHtml}</div>
            <div class="tk-comment-body">
              <div class="tk-comment-item-head">
                <span class="tk-comment-author">${escapeHtml(authorLabel)}</span>
                <span class="tk-comment-time">${timeLabel}</span>
              </div>
              <div class="tk-comment-bubble">
                <div class="tk-comment-text">${escapeHtml(c.comment)}</div>
              </div>
            </div>
          `;
          list.appendChild(item);
        });
    }

    function openDetail(id) {
      const t = findTicket(id);
      if (!t) return;
      tkActiveId = id;

      // FIX: openDetail() dipanggil ulang setelah Save (assign/status
      // berubah) untuk refresh tampilan di tempat -- tapi field yang
      // muncul/hilang setelahnya (mis. baris Assigned to/Status,
      // section Proof of Completion) BISA mengubah total tinggi
      // konten modal. Kalau scroll body TIDAK direset, posisi scroll
      // lama (mis. dari sebelum klik Save) tetap dipakai di konten
      // yang tingginya sudah beda, jadi section-section di bawah
      // (Evidence Files, dst.) kelihatan "kepotong"/kosong padahal
      // sebenarnya cuma belum ke-scroll ke situ. Reset ke atas tiap
      // kali detail ini di-(re)buka.
      const tkModalBody = document.querySelector("#tkDetailOverlay .tk-modal-body");
      if (tkModalBody) tkModalBody.scrollTop = 0;

      document.getElementById("tkDetailIdLabel").textContent = t.ticketNumber || t.id;
      document.getElementById("tkDetailCopyLinkBtn").dataset.ticketId = t.id;
      document.getElementById("tkDetailTitle").textContent = t.title;
      document.getElementById("tkDetailTeamBadge").className = `tk-pill tk-pill-team-${(t.team || "").toLowerCase()}`;
      document.getElementById("tkDetailTeamBadge").textContent = tkTeamLabel(t.team);
      document.getElementById("tkDetailTypeBadge").className = `tk-pill tk-pill-type-${tkTypeSlug(t.type)}`;
      document.getElementById("tkDetailTypeBadge").textContent = tkTypeLabel(t.type);
      document.getElementById("tkDetailPriorityBadge").className = `tk-pill tk-pill-priority-${t.priority}`;
      document.getElementById("tkDetailPriorityBadge").textContent = tkPriorityLabel(t.priority);
      document.getElementById("tkDetailStatusBadge").className = `tk-pill tk-pill-status-${t.status}`;
      document.getElementById("tkDetailStatusBadge").textContent = tkStatusLabel(t.status);
      document.getElementById("tkDetailDesc").textContent = t.description || "—";

      const attachWrap = document.getElementById("tkDetailAttachmentWrap");
      const attachGrid = document.getElementById("tkDetailAttachmentGrid");
      const attachments = Array.isArray(t.attachments) ? t.attachments : [];
      if (attachments.length) {
        attachGrid.innerHTML = "";
        attachments.forEach((att) => {
          const thumb = document.createElement("div");
          thumb.className = "tk-attach-thumb";
          const safeName = escapeHtml(att.fileName || "attachment");
          // FIX (2026-08-26): att.url dulu berisi data URL base64 yang
          // bisa langsung dipasang ke <img src>. Sekarang (attachment
          // disimpan di disk, bukan base64 di DB) att.url isinya PATH
          // RELATIF di server (mis. "tickets/<id>/<uuid>-file.pdf"),
          // BUKAN URL yang bisa di-fetch langsung -- harus lewat endpoint
          // authenticated GET /tickets/attachments/:id/:filename.
          const downloadUrl = `${window.EDASH_BACKEND_API_BASE}${TK_API_PATH}/attachments/${att.id}/${encodeURIComponent(att.fileName || "file")}`;
          const isImage = (att.mimeType || "").startsWith("image/");
          thumb.innerHTML = isImage
            ? `
              <a href="${downloadUrl}" target="_blank" rel="noopener">
                <img src="${downloadUrl}" alt="${safeName}">
              </a>
            `
            : `
              <a class="tk-attach-file-link" href="${downloadUrl}" target="_blank" rel="noopener">
                <i class="fa-solid ${att.mimeType === "application/pdf" ? "fa-file-pdf" : (att.mimeType || "").startsWith("video/") ? "fa-file-video" : (att.mimeType || "").includes("word") ? "fa-file-word" : "fa-file"}"></i>
                <span class="tk-attach-file-name">${safeName}</span>
              </a>
            `;
          attachGrid.appendChild(thumb);
        });
        attachWrap.classList.remove("hidden");
      } else {
        attachGrid.innerHTML = "";
        attachWrap.classList.add("hidden");
      }

      // ---- Bukti pengerjaan (resolution proof) -- ditampilkan ke
      // SEMUA yang buka detail (bukan cuma approver) begitu ticket
      // punya resolutionNote, supaya approver bisa menilai dari
      // deskripsi/file yang diberikan assignee. Field ini muncul begitu
      // tiket pernah masuk Waiting Approval, tetap kelihatan walau
      // sudah Resolved/Rejected (riwayatnya tidak hilang). ----
      const resolutionGrid = document.getElementById("tkResolutionAttachmentGrid");
      const resolutionAttachmentWrap = document.getElementById("tkResolutionAttachmentWrap");
      const resolutionAttachmentsList = Array.isArray(t.resolutionAttachments) ? t.resolutionAttachments : [];
      if (t.resolutionNote) {
        document.getElementById("tkResolutionNoteView").textContent = t.resolutionNote;
        resolutionGrid.innerHTML = "";
        resolutionAttachmentsList.forEach((att) => {
          const thumb = document.createElement("div");
          thumb.className = "tk-attach-thumb";
          const safeName = escapeHtml(att.fileName || "attachment");
          const downloadUrl = `${window.EDASH_BACKEND_API_BASE}${TK_API_PATH}/attachments/${att.id}/${encodeURIComponent(att.fileName || "file")}`;
          const isImage = (att.mimeType || "").startsWith("image/");
          thumb.innerHTML = isImage
            ? `
              <a href="${downloadUrl}" target="_blank" rel="noopener">
                <img src="${downloadUrl}" alt="${safeName}">
              </a>
            `
            : `
              <a class="tk-attach-file-link" href="${downloadUrl}" target="_blank" rel="noopener">
                <i class="fa-solid ${att.mimeType === "application/pdf" ? "fa-file-pdf" : (att.mimeType || "").startsWith("video/") ? "fa-file-video" : (att.mimeType || "").includes("word") ? "fa-file-word" : "fa-file"}"></i>
                <span class="tk-attach-file-name">${safeName}</span>
              </a>
            `;
          resolutionGrid.appendChild(thumb);
        });
        resolutionAttachmentWrap.classList.toggle("hidden", resolutionAttachmentsList.length === 0);
      } else {
        resolutionGrid.innerHTML = "";
        resolutionAttachmentWrap.classList.add("hidden");
      }
      // Visibilitas tkResolutionSection / tkResolutionViewWrap /
      // tkResolutionInputWrap ditentukan oleh tkRefreshResolutionSectionVisibility()
      // di bawah (dipanggil sesaat lagi lewat tkResetResolutionFields
      // flow) -- lihat fungsi itu untuk logika show/hide-nya.

      document.getElementById("tkDetailSubmitter").textContent = t.submittedBy || "—";
      document.getElementById("tkDetailPage").textContent = t.relatedPage || "—";
      document.getElementById("tkDetailCreated").textContent = tkFmtDate(t.createdAt);
      document.getElementById("tkDetailUpdated").textContent = tkFmtDate(t.updatedAt);

      const dueInfo = tkFmtDaysRemaining(t.daysRemaining, t.status);
      const dueDateEl = document.getElementById("tkDetailDueDate");
      dueDateEl.textContent = t.dueDate ? `${tkFmtDate(t.dueDate)} (${dueInfo.text})` : "—";
      dueDateEl.className = `tk-detail-meta-value ${dueInfo.cls}`;

      // ---- Tombol Edit -- awalnya HANYA pembuat tiket sendiri (dan
      // cuma selama belum ada yang mengambil, assignedTo masih kosong).
      // SEKARANG admin master (root) atau REMS Intern Lead JUGA bisa
      // pakai tombol ini kapan pun (walau tiket sudah diclaim) -- biar
      // semua yang bisa mereka edit (title/deskripsi/task, "Assigned
      // to", "Deadline") ada di SATU form yang sama, bukan
      // kepisah-pisah. Field "Assigned to"/"Deadline" tambahan di form
      // ini sendiri cuma kelihatan buat admin/lead (lihat openEdit()).
      const isCreator = t.submittedBy === tkCurrentUser();
      const canManageTicketAsAdmin = tkIsApprover();
      const canEdit = (isCreator && !t.assignedTo) || canManageTicketAsAdmin;
      const editBtn = document.getElementById("tkDetailEditBtn");
      editBtn.classList.toggle("hidden", !canEdit);
      editBtn.onclick = canEdit ? () => { closeDetail(); window.tkOpenEdit(t); } : null;

      // ---- Section DL/estimasi -- HANYA orang yang SEDANG mengerjakan
      // tiket ini (assignedTo == kamu) atau admin master (root). Cermin
      // persis dari pengecekan otorisasi di ticket.service.ts
      // updateTicket(). ----
      const isRoot = sessionStorage.getItem("edash-role-tier") === "root";
      const assignedUsers = tkAssignedUsers(t);
      const isCurrentAssignee = assignedUsers.includes(tkCurrentUser());
      // Sekarang HANYA admin master (root) -- due date normalnya sudah
      // otomatis dihitung dari Expected Time yang diisi pembuat tiket
      // saat submit (lihat createTicket() di ticket.service.ts), jadi
      // assignee tidak perlu/tidak bisa lagi set ini manual.
      const canSetDueDate = isRoot;
      const dueSection = document.getElementById("tkDueDateSection");
      dueSection.classList.toggle("hidden", !canSetDueDate);
      // Divider di bawah tkDueDateSection cuma relevan kalau section-nya
      // sendiri kelihatan -- kalau tidak (bukan admin master), ikut
      // disembunyikan supaya tidak nyisa dua garis pembatas nebeng
      // langsung di antara tombol aksi dan Comments (lihat pesan user).
      document.getElementById("tkDueDateDivider")?.classList.toggle("hidden", !canSetDueDate);
      if (canSetDueDate) {
        document.getElementById("tkDueDateEstimatedDays").value = "";
        // Pre-fill tanggal langsung dari due_date yang sudah ada (kalau
        // ada) supaya gampang dikoreksi, bukan mulai dari kosong lagi.
        document.getElementById("tkDueDateDirect").value = t.dueDate
          ? new Date(t.dueDate).toISOString().slice(0, 10)
          : "";
      }

      // ---- Assigned to / Status / Save -- CUMA relevan kalau tiket
      // belum final. Sekali Resolved/Rejected, backend mengunci status
      // (lihat updateTicket() di ticket.service.ts) -- daripada
      // nampilin form yang ujung-ujungnya ditolak backend, sembunyikan
      // total dan ganti catatan singkat. ----
      const isFinal = t.status === "resolved" || t.status === "rejected";
      const canApprove = tkIsApprover();
      const isWaitingApproval = t.status === "waiting_approval";
      const isApproverReviewingSubmission = canApprove && isWaitingApproval;
      const isOpenStatus = t.status === "open";
      const assignSaveRow = detailAssigneeSelect.closest(".tk-field-row");
      const assignedToField = document.getElementById("tkAssignedToField");
      const statusField = document.getElementById("tkStatusField");
      let finalNote = document.getElementById("tkDetailFinalNote");
      if (!finalNote) {
        finalNote = document.createElement("p");
        finalNote.id = "tkDetailFinalNote";
        finalNote.className = "tk-hint";
        assignSaveRow.parentNode.insertBefore(finalNote, assignSaveRow);
      }
      detailStatusSelect.disabled = isWaitingApproval;
      const canManageAssignments = tkIsApprover();
      // REMS Intern Lead = approver TAPI bukan admin master (root).
      // Dipakai buat bedain "admin cuma lihat Assigned to" vs "lead
      // lihat dua-duanya" (lihat pesan user).
      const isLead = canManageAssignments && !isRoot;
      const canEditAssigneePicker = canManageAssignments && !isWaitingApproval && !isFinal;
      detailAssigneeSelect.classList.add("hidden");
      detailAssigneeSelect.disabled = true;

      // ---- Siapa lihat "Assigned to" vs "Status" ----
      //  - Tiket masih Open (belum ada yang klaim): dua-duanya
      //    disembunyikan total. Satu-satunya jalan "assign" tiket Open
      //    HANYA lewat tombol Claim/"Assign to me" di bawah
      //    (tkClaimBtn/tkClaimPanel), BUKAN dari sini.
      //  - Admin master (root): CUMA "Assigned to" (buat reassign siapa
      //    yang pegang tiket ini) -- TIDAK ada "Status" sama sekali.
      //  - REMS Intern Lead: KEDUANYA -- bisa reassign, DAN bisa juga
      //    jadi assignee yang ikut ngerjain tiketnya sendiri.
      //  - Assignee biasa (REMS intern yang sedang megang tiket ini):
      //    CUMA "Status", tidak bisa sentuh "Assigned to".
      //  - Selain semua di atas (bukan siapa-siapa buat tiket ini):
      //    tidak lihat dua-duanya sama sekali.
      const showAssignedToField = !isOpenStatus && canManageAssignments;
      const showStatusField = !isOpenStatus && (isLead || (isCurrentAssignee && !isRoot));
      const hideAssignStatusRow = isFinal || isWaitingApproval || isOpenStatus || (!showAssignedToField && !showStatusField);
      assignSaveRow.classList.toggle("hidden", hideAssignStatusRow);
      // Divider statis di atas baris ini (lihat markup) ikut disembunyikan
      // bareng barisnya sendiri -- kalau tidak, pas baris Assigned
      // to/Status hilang total (mis. tiket masih Open), garis pembatas
      // itu nyisa nganggur sendirian pas di atas tombol "Assign to me".
      document.getElementById("tkAssignStatusDivider")?.classList.toggle("hidden", hideAssignStatusRow);
      if (assignedToField) assignedToField.classList.toggle("hidden", !showAssignedToField);
      if (statusField) statusField.classList.toggle("hidden", !showStatusField);

      if (showAssignedToField) {
        fillAssigneePicker(detailAssigneePicker, t.team, assignedUsers, !canEditAssigneePicker);
      } else {
        detailAssigneePicker.innerHTML = "";
      }
      if (detailAssigneeSelectionText) {
        const selectedNames = assignedUsers.length ? assignedUsers.join(", ") : "Unassigned";
        detailAssigneeSelectionText.textContent = selectedNames;
      }
      finalNote.classList.toggle("hidden", !isFinal);
      if (isFinal) {
        finalNote.textContent = t.status === "resolved"
          ? "This ticket is Resolved -- assignee and status are locked."
          : "This ticket has been Rejected -- assignee and status are locked.";
      }

      if (!isFinal) {
        detailStatusSelect.value = t.status;
      }

      // Reset section bukti pengerjaan setiap kali modal dibuka/ganti
      // tiket -- jangan sampai draft catatan/file dari tiket lain
      // kebawa nyangkut, atau kalau tiket ini sendiri statusnya sudah
      // Waiting Approval dari awal (tidak butuh input apapun).
      tkPrepareResolutionFields(t);
      tkRefreshResolutionSectionVisibility();

      // ---- Approve/Reject/Claim/Start-timer -- CUMA root (360master)
      // atau REMS Intern Lead (tkIsApprover(), cermin dari
      // requireApproverRole() di ticket.service.ts) untuk Approve/Reject.
      // Approve cuma aktif dari Waiting Approval; Reject aktif dari
      // status APAPUN yang belum final. Claim HANYA dari status Open
      // (lihat claimTicket() di ticket.service.ts -- endpoint baru
      // POST /tickets/:id/claim, BUKAN lagi PATCH assignedTo biasa).
      // Start-timer HANYA dari In Progress, oleh assignee tiket ini
      // SENDIRI (root/admin master TIDAK BOLEH memulai timer tiket
      // orang lain lagi -- cermin dari startTimer() di
      // ticket.service.ts yang sekarang cuma cek assigneeIds), dan
      // cuma kalau timer belum berjalan. ----
      const primaryActionsRow = document.getElementById("tkPrimaryActionsRow");
      const approveBtn = document.getElementById("tkDetailApproveBtn");
      const rejectBtn = document.getElementById("tkDetailRejectBtn");
      const claimBtn = document.getElementById("tkClaimBtn");
      const startTimerBtn = document.getElementById("tkStartTimerBtn");
      const saveDetailBtn = document.getElementById("tkSaveDetailBtn");
      const showApprove = canApprove && t.status === "waiting_approval";
      const showReject = canApprove && !isFinal && (!t.assignedTo || t.status === "waiting_approval");
      const showClaim = isOpenStatus;
      const showStartTimer = t.status === "in_progress" && isCurrentAssignee && !t.timerRunning;
      const showSave = !isFinal && !isWaitingApproval && !isOpenStatus;
      primaryActionsRow.classList.toggle("hidden", !showApprove && !showReject && !showClaim && !showSave && !showStartTimer);
      approveBtn.classList.toggle("hidden", !showApprove);
      rejectBtn.classList.toggle("hidden", !showReject);
      claimBtn.classList.toggle("hidden", !showClaim);
      startTimerBtn.classList.toggle("hidden", !showStartTimer);
      saveDetailBtn.classList.toggle("hidden", !showSave);
      // Panel kolaborator (claim) selalu ditutup ulang tiap kali modal
      // Detail dibuka/pindah tiket -- supaya tidak nyangkut kebuka dari
      // tiket sebelumnya.
      document.getElementById("tkClaimPanel").classList.add("hidden");
      const rejectLabel = rejectBtn.querySelector("span");
      const rejectingProgress = !!t.assignedTo;
      if (rejectLabel) rejectLabel.textContent = rejectingProgress ? "Reject Submission" : "Reject Ticket";
      const deleteBtn = document.getElementById("tkDeleteTicketBtn");
      deleteBtn.classList.toggle("hidden", sessionStorage.getItem("edash-role-tier") !== "root");

      // ---- Expected time / Time worked ----
      document.getElementById("tkDetailExpectedHours").textContent = t.expectedHours ? `${t.expectedHours} hours` : "—";
      tkStopTimerTick();
      const workedEl = document.getElementById("tkDetailWorkedTime");
      const renderWorked = () => {
        workedEl.textContent = tkFmtDuration(tkLiveWorkedSeconds(t)) + (t.timerRunning ? " (running)" : "");
      };
      renderWorked();
      if (t.timerRunning) tkStartTimerTick(renderWorked);

      renderComments(t);
      document.getElementById("tkCommentInput").value = "";

      // ---- Version history (icon jam) -- reset drawer/banner tiap
      // buka modal, biar gak nyangkut dari tiket sebelumnya, lalu
      // muat ulang isi drawer + chip "Last edited" buat tiket ini. ----
      document.getElementById("tkHistoryDrawer").classList.remove("is-open");
      document.getElementById("tkEditLogBanner").classList.add("hidden");
      tkLoadTicketLastEdited(t.id);

      detailOverlay.classList.add("is-open");
    }

    function closeDetail() {
      detailOverlay.classList.remove("is-open");
      tkActiveId = null;
      tkStopTimerTick();
    }

    document.getElementById("tkDetailCloseBtn").addEventListener("click", closeDetail);
    detailOverlay.addEventListener("click", (e) => {
      if (e.target === detailOverlay) closeDetail();
    });

    // ---- Copy Link -- generate link ?ticket=<id> ke ticket yang lagi
    // dibuka & salin ke clipboard, supaya bisa ditempel ke channel
    // eksternal (WhatsApp/Slack/email) dan langsung terbuka modal
    // Detail-nya begitu diklik sesama pekerja yang login. ----
    document.getElementById("tkDetailCopyLinkBtn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const id = btn.dataset.ticketId;
      if (!id) return;
      const ok = await tkCopyToClipboard(tkBuildTicketLink(id));
      showToast(ok ? "Ticket link copied to clipboard" : "Failed to copy link");
    });

    // ---- Claim ("Assign to me") -- HANYA dari status Open (lihat
    // claimTicket() di ticket.service.ts). Klik tombol ini TIDAK
    // langsung claim -- buka dulu panel kolaborator (#tkClaimPanel) biar
    // user bisa opsional pilih rekan satu tim yang ikut mengerjakan,
    // baru "Confirm Claim" yang benar-benar memanggil endpoint. ----
    document.getElementById("tkClaimBtn").addEventListener("click", () => {
      const t = findTicket(tkActiveId);
      if (!t || t.status !== "open") return;
      const me = tkCurrentUser();
      const panel = document.getElementById("tkClaimPanel");
      const picker = document.getElementById("tkClaimCollabPicker");
      // Pilihan kolaborator = anggota tim tiket ini, MINUS diri sendiri
      // (diri sendiri otomatis jadi assignee utama, tidak perlu dicentang).
      const teammates = tkTeamMemberNames(t.team).filter((name) => tkNormalizeName(name) !== tkNormalizeName(me));
      picker.innerHTML = "";
      if (!teammates.length) {
        picker.innerHTML = '<div class="tk-assignee-empty">No other team members to add as collaborators.</div>';
      } else {
        teammates.forEach((name) => {
          const label = document.createElement("label");
          label.className = "tk-assignee-choice";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.value = name;
          const text = document.createElement("span");
          text.textContent = name;
          label.appendChild(input);
          label.appendChild(text);
          input.addEventListener("change", () => label.classList.toggle("is-selected", input.checked));
          picker.appendChild(label);
        });
      }
      panel.classList.remove("hidden");
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    document.getElementById("tkClaimCancelBtn").addEventListener("click", () => {
      document.getElementById("tkClaimPanel").classList.add("hidden");
    });

    // ---- Confirm Claim -- di sinilah pop up konfirmasi (tkConfirm())
    // benar-benar muncul, SETELAH user pilih (atau tidak pilih sama
    // sekali) kolaborator di panel. Teksnya dibikin dinamis: kalau ada
    // kolaborator yang dicentang, sebutkan namanya; kalau tidak ada,
    // bilang bakal kerja sendiri. Endpoint /claim baru dipanggil kalau
    // user jawab Yes di pop up ini. ----
    document.getElementById("tkClaimConfirmBtn").addEventListener("click", async () => {
      const t = findTicket(tkActiveId);
      if (!t || t.status !== "open") return;
      const collaborators = Array.from(
        document.querySelectorAll('#tkClaimCollabPicker input[type="checkbox"]:checked')
      ).map((input) => input.value);
      const confirmed = await tkConfirm({
        icon: "fa-hand",
        iconVariant: "is-primary-solid",
        title: "Assign to me?",
        text: collaborators.length
          ? `This ticket will be assigned to you and moved to In Progress, working together with ${tkJoinNamesNatural(collaborators)}.`
          : "This ticket will be assigned to you and moved to In Progress.",
        confirmLabel: "Confirm",
        confirmVariant: "tk-pill-primary",
      });
      if (!confirmed) return;
      const btn = document.getElementById("tkClaimConfirmBtn");
      btn.disabled = true;
      try {
        const updated = await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(t.id)}/claim`, {
          method: "POST",
          body: JSON.stringify({ collaborators }),
        });
        Object.assign(t, updated);
        persist();
        renderAll();
        openDetail(t.id);
        showToast(
          collaborators.length
            ? `Ticket claimed \u2014 working with ${tkJoinNamesNatural(collaborators)}`
            : "Ticket claimed"
        );
        if (typeof logActivity === "function") {
          logActivity({
            eventType: "ticket_updated",
            user: tkCurrentUser(),
            userRole: tkCurrentRole(),
            status: "success",
            detail: `Claimed ${t.ticketNumber || t.id}${collaborators.length ? ` with ${collaborators.join(", ")}` : ""}`,
            data: { ticketId: t.id, assignedTo: tkAssignedUsers(t), status: t.status },
          });
        }
      } catch (e) {
        showToast(e.message || "Failed to claim ticket");
      } finally {
        btn.disabled = false;
      }
    });

    // ---- Mulai Mengerjakan (start timer) -- HANYA dari In Progress,
    // oleh assignee saat ini (atau root), dan timer belum berjalan
    // (lihat startTimer() di ticket.service.ts). ----
    document.getElementById("tkStartTimerBtn").addEventListener("click", async () => {
      const t = findTicket(tkActiveId);
      if (!t) return;
      const btn = document.getElementById("tkStartTimerBtn");
      btn.disabled = true;
      try {
        const updated = await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(t.id)}/start-timer`, { method: "POST" });
        Object.assign(t, updated);
        persist();
        renderAll();
        openDetail(t.id);
        showToast("Timer started");
      } catch (e) {
        showToast(e.message || "Failed to start timer");
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("tkSaveDetailBtn").addEventListener("click", async () => {
      const t = findTicket(tkActiveId);
      if (!t) return;

      const prevAssignee = tkAssignedLabel(t);
      const prevStatus = t.status;
      const nextAssignees = getSelectedAssignees();
      const nextAssignee = nextAssignees[0] || "";
      const nextStatus = detailStatusSelect.value;

      // ---- Bukti pengerjaan WAJIB (deskripsi + minimal 1 file) begitu
      // status MASUK Waiting Approval -- cermin persis validasi di
      // ticket.service.ts updateTicket() (bagian "1b. Bukti
      // pengerjaan"). Divalidasi juga di sini (bukan cuma backend)
      // supaya user langsung lihat field mana yang kurang, tanpa
      // nunggu round-trip ke server. ----
      const isEnteringWaitingApproval = nextStatus === "waiting_approval" && prevStatus !== "waiting_approval";
      const hasExistingResolutionFiles = Array.isArray(t.resolutionAttachments) && t.resolutionAttachments.length > 0;
      const noteChanged = resolutionNoteInput.value.trim() !== (t.resolutionNote || "").trim();
      const proofEdited = t.status !== "resolved" && t.status !== "rejected" && tkCanSubmitProof() && (noteChanged || tkResolutionAttachments.length > 0);
      const mustSendResolutionForm = isEnteringWaitingApproval || proofEdited;
      // Lapis pertahanan terakhir di depan (opsi dropdown-nya sendiri
      // sudah dikunci di tkRefreshStatusOptionAvailability(), ini
      // jaga-jaga kalau somehow lolos) -- proof-of-completion cuma
      // boleh disubmit assignee (efektif, termasuk yang baru saja
      // klaim lewat "Assign to me") atau admin master. Backend juga
      // menolak ini (403), tapi mengecek di sini dulu supaya pesannya
      // jelas tanpa perlu round-trip ke server.
      if (isEnteringWaitingApproval && !tkCanSubmitProof()) {
        showToast("Only the current assignee (or an admin) can mark this ticket as Waiting Approval");
        return;
      }
      if (isEnteringWaitingApproval) {
        let valid = true;
        const noteFilled = !!resolutionNoteInput.value.trim();
        resolutionNoteField.classList.toggle("has-error", !noteFilled);
        if (!noteFilled) valid = false;

        const attachField = resolutionAttachPickBtn.closest(".tk-field");
        const hasFiles = tkResolutionAttachments.length > 0 || hasExistingResolutionFiles;
        attachField.classList.toggle("has-error", !hasFiles);
        if (!hasFiles) valid = false;

        if (!valid) {
          showToast("Please fill in the work description and attach at least 1 proof file");
          return;
        }
      }

      const confirmed = await tkConfirm({
        icon: isEnteringWaitingApproval ? "fa-paper-plane" : "fa-floppy-disk",
        iconVariant: "is-primary-solid",
        title: isEnteringWaitingApproval ? "Submit for approval?" : "Save changes?",
        text: isEnteringWaitingApproval
          ? "This ticket will be submitted as Waiting Approval with the proof of completion below. You won't be able to edit it once submitted."
          : "This will save your changes to the ticket.",
        confirmLabel: isEnteringWaitingApproval ? "Submit" : "Save",
        confirmVariant: "tk-pill-primary",
      });
      if (!confirmed) return;

      const saveBtn = document.getElementById("tkSaveDetailBtn");
      saveBtn.disabled = true;

      try {
        let updated;
        if (mustSendResolutionForm) {
          // Dikirim sebagai multipart/form-data untuk submit/edit proof.
          const form = new FormData();
          if (tkIsApprover()) nextAssignees.forEach((name) => form.append("assignedTo", name));
          form.append("status", nextStatus);
          form.append("resolutionNote", resolutionNoteInput.value.trim());
          tkResolutionAttachments.forEach((file) => form.append("files", file, file.name));
          updated = await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(t.id)}`, {
            method: "PATCH",
            body: form,
            timeoutMs: 120000,
          });
        } else {
          const patchBody = tkIsApprover()
            ? { assignedTo: nextAssignees, status: nextStatus }
            : { status: nextStatus };
          updated = await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(t.id)}`, {
            method: "PATCH",
            body: JSON.stringify(patchBody),
          });
        }

        Object.assign(t, updated);
        persist();
        renderAll();
        openDetail(t.id); // refresh badges in place (juga reset section bukti pengerjaan)
        showToast("Ticket updated");

        if (typeof logActivity === "function" && (prevAssignee !== tkAssignedLabel(t) || prevStatus !== t.status)) {
          logActivity({
            eventType: "ticket_updated",
            user: tkCurrentUser(),
            userRole: tkCurrentRole(),
            status: "success",
            detail: `Updated ${t.ticketNumber || t.id}: assignee "${tkAssignedLabel(t) || "Unassigned"}", status "${tkStatusLabel(t.status)}"`,
            data: { ticketId: t.id, assignedTo: tkAssignedUsers(t), status: t.status },
          });
        }
      } catch (e) {
        console.warn("[ticketing] Gagal update ticket:", e.message);
        showToast(e.message || "Failed to save changes");
      } finally {
        saveBtn.disabled = false;
      }
    });

    // ---- Approve/Reject -- panggil endpoint khusus (BUKAN PATCH biasa),
    // backend menolak PATCH status langsung ke resolved/rejected. Tombol
    // ini sendiri sudah disembunyikan total di openDetail() kalau bukan
    // approver (root/REMS Intern Lead), tapi backend tetap yang jadi
    // penjaga sesungguhnya (requireApproverRole() di ticket.service.ts).
    document.getElementById("tkDetailApproveBtn").addEventListener("click", async () => {
      const t = findTicket(tkActiveId);
      if (!t) return;
      const confirmed = await tkConfirm({
        icon: "fa-check-double",
        iconVariant: "is-success-solid",
        title: "Approve & Resolve?",
        text: "This ticket will be marked as Resolved and points will be awarded to the assignee(s). This cannot be undone.",
        confirmLabel: "Approve & Resolve",
        confirmVariant: "tk-pill-success",
      });
      if (!confirmed) return;
      const btn = document.getElementById("tkDetailApproveBtn");
      btn.disabled = true;
      try {
        const updated = await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(t.id)}/approve`, { method: "POST" });
        Object.assign(t, updated);
        persist();
        renderAll();
        openDetail(t.id);
        showToast("Ticket approved & resolved");
        refreshLeaderboard(); // poin baru saja diberikan ke assignee(s) -- lihat awardPoints() di ticket.service.ts
        if (typeof logActivity === "function") {
          logActivity({
            eventType: "ticket_approved",
            user: tkCurrentUser(),
            userRole: tkCurrentRole(),
            status: "success",
            detail: `Approved ${t.ticketNumber || t.id} -> Resolved`,
            data: { ticketId: t.id, status: t.status },
          });
        }
      } catch (e) {
        console.warn("[ticketing] Gagal approve ticket:", e.message);
        showToast(e.message || "Failed to approve ticket");
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("tkDetailRejectBtn").addEventListener("click", async () => {
      const t = findTicket(tkActiveId);
      if (!t) return;
      const rejectingProgress = !!t.assignedTo;
      const confirmText = rejectingProgress
        ? "Reject this work submission? The ticket will return to In Progress and the assignee will be notified."
        : "Reject this ticket? This initial rejection is final.";
      const confirmed = await tkConfirm({
        icon: "fa-ban",
        iconVariant: "is-danger-solid",
        title: rejectingProgress ? "Reject Submission?" : "Reject Ticket?",
        text: confirmText,
        confirmLabel: rejectingProgress ? "Reject Submission" : "Reject Ticket",
        confirmVariant: "tk-pill-danger",
      });
      if (!confirmed) return;
      const btn = document.getElementById("tkDetailRejectBtn");
      btn.disabled = true;
      try {
        const updated = await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(t.id)}/reject`, { method: "POST" });
        Object.assign(t, updated);
        persist();
        renderAll();
        openDetail(t.id);
        showToast(rejectingProgress ? "Submission rejected; ticket returned to In Progress" : "Ticket rejected");
        if (typeof logActivity === "function") {
          logActivity({
            eventType: "ticket_rejected",
            user: tkCurrentUser(),
            userRole: tkCurrentRole(),
            status: "success",
            detail: rejectingProgress
              ? `Rejected work submission for ${t.ticketNumber || t.id} -> In Progress`
              : `Rejected ${t.ticketNumber || t.id}`,
            data: { ticketId: t.id, status: t.status, kind: rejectingProgress ? "progress_submission" : "initial_ticket" },
          });
        }
      } catch (e) {
        console.warn("[ticketing] Gagal reject ticket:", e.message);
        showToast(e.message || "Failed to reject ticket");
      } finally {
        btn.disabled = false;
      }
    });

    // ---- Save/Clear DL -- otorisasi sudah divalidasi backend (cuma
    // assignee saat ini atau root), tapi section ini juga sudah
    // disembunyikan total di openDetail() kalau tidak berhak, jadi
    // tombol ini praktis cuma bisa diklik orang yang memang berhak. ----
    document.getElementById("tkDueDateSaveBtn").addEventListener("click", async () => {
      const t = findTicket(tkActiveId);
      if (!t) return;

      const estimatedDaysRaw = document.getElementById("tkDueDateEstimatedDays").value.trim();
      const directDateRaw = document.getElementById("tkDueDateDirect").value;

      if (!estimatedDaysRaw && !directDateRaw) {
        showToast("Fill in estimated days or pick a date first");
        return;
      }
      if (estimatedDaysRaw && (!Number.isInteger(Number(estimatedDaysRaw)) || Number(estimatedDaysRaw) <= 0)) {
        showToast("Estimated days must be a positive whole number");
        return;
      }

      const saveDueBtn = document.getElementById("tkDueDateSaveBtn");
      saveDueBtn.disabled = true;
      try {
        // dueDate (tanggal langsung) DIUTAMAKAN kalau dua-duanya diisi
        // (lihat updateTicket() di ticket.service.ts -- aturan yang sama).
        const payload = directDateRaw
          ? { dueDate: new Date(directDateRaw).toISOString() }
          : { estimatedDays: Number(estimatedDaysRaw) };

        const updated = await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(t.id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });

        Object.assign(t, updated);
        persist();
        renderAll();
        openDetail(t.id);
        showToast("Deadline saved");

        // Sebelumnya set/ubah due date TIDAK pernah dikirim ke activity
        // log sama sekali (beda dari assignee/status di tkSaveDetailBtn
        // yang sudah lama tercatat) -- dikelompokkan ke eventType
        // "ticket_updated" yang sama supaya tetap masuk kategori
        // "Ticketing" di Activity Log, konsisten dengan pola yang sudah
        // ada, tanpa perlu eventType/migration baru.
        if (typeof logActivity === "function") {
          logActivity({
            eventType: "ticket_updated",
            user: tkCurrentUser(),
            userRole: tkCurrentRole(),
            status: "success",
            detail: `Set due date for ${t.ticketNumber || t.id}`,
            data: { ticketId: t.id, dueDate: t.dueDate || null },
          });
        }
      } catch (e) {
        console.warn("[ticketing] Gagal menyimpan DL:", e.message);
        showToast(e.message || "Failed to save deadline");
      } finally {
        saveDueBtn.disabled = false;
      }
    });

    document.getElementById("tkDueDateClearBtn").addEventListener("click", async () => {
      const t = findTicket(tkActiveId);
      if (!t) return;
      const clearBtn = document.getElementById("tkDueDateClearBtn");
      clearBtn.disabled = true;
      try {
        // Kirim dueDate string KOSONG -- backend (updateTicket() di
        // ticket.service.ts) membaca ini sebagai "hapus DL", bukan
        // "tidak diubah" (beda dari field yang sama sekali tidak
        // dikirim di body).
        const updated = await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(t.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ dueDate: "" }),
        });
        Object.assign(t, updated);
        persist();
        renderAll();
        openDetail(t.id);
        showToast("Deadline cleared");

        // Sama seperti Save DL di atas -- clear due date juga belum
        // pernah tercatat di activity log.
        if (typeof logActivity === "function") {
          logActivity({
            eventType: "ticket_updated",
            user: tkCurrentUser(),
            userRole: tkCurrentRole(),
            status: "success",
            detail: `Cleared due date for ${t.ticketNumber || t.id}`,
            data: { ticketId: t.id, dueDate: null },
          });
        }
      } catch (e) {
        console.warn("[ticketing] Gagal menghapus DL:", e.message);
        showToast(e.message || "Failed to clear deadline");
      } finally {
        clearBtn.disabled = false;
      }
    });

    document.getElementById("tkCommentSubmitBtn").addEventListener("click", async () => {
      const t = findTicket(tkActiveId);
      const input = document.getElementById("tkCommentInput");
      const text = input.value.trim();
      if (!t || !text) return;

      const commentBtn = document.getElementById("tkCommentSubmitBtn");
      commentBtn.disabled = true;

      try {
        const updated = await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(t.id)}/comments`, {
          method: "POST",
          body: JSON.stringify({ author: tkCurrentUser(), text }),
        });

        Object.assign(t, updated);
        input.value = "";

        persist();
        renderComments(t);
        document.getElementById("tkDetailUpdated").textContent = tkFmtDate(t.updatedAt);
        renderStats();
        showToast("Comment added");

        // Menambah comment juga belum pernah dikirim ke activity log --
        // dikelompokkan ke "ticket_updated" yang sama seperti due date
        // di atas (bukan eventType baru).
        if (typeof logActivity === "function") {
          logActivity({
            eventType: "ticket_updated",
            user: tkCurrentUser(),
            userRole: tkCurrentRole(),
            status: "success",
            detail: `Commented on ${t.ticketNumber || t.id}`,
            data: { ticketId: t.id },
          });
        }
      } catch (e) {
        console.warn("[ticketing] Gagal menambah comment:", e.message);
        showToast("Failed to add comment");
      } finally {
        commentBtn.disabled = false;
      }
    });

    // ---------- Delete ----------
    const deleteOverlay = document.getElementById("tkDeleteOverlay");

    function openDeleteConfirm() {
      if (!tkActiveId) return;
      tkPendingDeleteId = tkActiveId;
      deleteOverlay.classList.add("is-open");
    }
    function closeDeleteConfirm() {
      deleteOverlay.classList.remove("is-open");
      tkPendingDeleteId = null;
    }

    document.getElementById("tkDeleteTicketBtn").addEventListener("click", openDeleteConfirm);
    document.getElementById("tkDeleteCancelBtn").addEventListener("click", closeDeleteConfirm);
    document.getElementById("tkDeleteCancelX").addEventListener("click", closeDeleteConfirm);
    deleteOverlay.addEventListener("click", (e) => {
      if (e.target === deleteOverlay) closeDeleteConfirm();
    });

    document.getElementById("tkDeleteConfirmBtn").addEventListener("click", async () => {
      if (!tkPendingDeleteId) return;
      const idToDelete = tkPendingDeleteId;
      // Diambil SEBELUM delete -- setelah tickets difilter di bawah,
      // ticketNumber/title-nya sudah tidak bisa dibaca lagi lewat
      // findTicket(), jadi detail activity log-nya jadi kosong kalau
      // diambil belakangan.
      const deletedTicket = findTicket(idToDelete);
      const confirmBtn = document.getElementById("tkDeleteConfirmBtn");
      confirmBtn.disabled = true;

      try {
        await window.edashApiFetch(`${TK_API_PATH}/${encodeURIComponent(idToDelete)}`, {
          method: "DELETE",
        });

        tickets = tickets.filter((t) => t.id !== idToDelete);
        window.__tkTickets = tickets;
        persist();
        closeDeleteConfirm();
        closeDetail();
        renderAll();
        showToast("Ticket deleted");

        // Delete ticket belum pernah tercatat di activity log sama
        // sekali (beda dari submit/edit/update/approve/reject yang
        // sudah dikirim). Dikirim sebagai eventType baru
        // "ticket_deleted" (bukan digabung ke "ticket_updated") supaya
        // baris di Activity History tetap jelas menunjukkan tiket itu
        // DIHAPUS, bukan cuma diubah -- tetap dikelompokkan ke kategori
        // tampilan "Ticketing" yang sama lewat AL_EVENT_GROUP
        // (js/activity-log.js). Backend (activity-log.service.ts
        // ALLOWED_EVENT_TYPES) & enum Postgres activity_logs.event_type
        // juga perlu ditambah nilai ini -- lihat migration
        // 005_activity_log_ticket_events.sql.
        if (typeof logActivity === "function") {
          logActivity({
            eventType: "ticket_deleted",
            user: tkCurrentUser(),
            userRole: tkCurrentRole(),
            status: "success",
            detail: `Deleted ${deletedTicket ? tkTypeLabel(deletedTicket.type) + " ticket: " + deletedTicket.title : idToDelete}`,
            data: { ticketId: idToDelete, type: deletedTicket ? deletedTicket.type : null },
          });
        }
      } catch (e) {
        console.warn("[ticketing] Gagal hapus ticket:", e.message);
        showToast("Failed to delete ticket");
      } finally {
        confirmBtn.disabled = false;
      }
    });

    // ---------- Toolbar events ----------
    searchInput.addEventListener("input", () => { tkCurrentPage = 1; renderTable(); });
    typeFilter.addEventListener("change", () => { tkCurrentPage = 1; renderTable(); });
    statusTabs.querySelectorAll(".tk-status-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        tkActiveStatusTab = tab.getAttribute("data-status") || "";
        statusTabs.querySelectorAll(".tk-status-tab").forEach((el) => el.classList.toggle("is-active", el === tab));
        tkCurrentPage = 1;
        renderTable();
      });
    });
    if (teamToggle) {
      teamToggle.querySelectorAll(".tk-team-toggle-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          tkActiveTeamFilter = btn.getAttribute("data-team") || "";
          teamToggle.querySelectorAll(".tk-team-toggle-btn").forEach((el) => el.classList.toggle("is-active", el === btn));
          tkCurrentPage = 1;
          renderStatusTabCounts();
          renderTable();
        });
      });
    }

    // ---------- Filter card "Ticket Activity" (team + status) ----------
    const heatmapTeamToggle = document.getElementById("tkHeatmapTeamToggle");
    const heatmapStatusToggle = document.getElementById("tkHeatmapStatusToggle");
    if (heatmapTeamToggle) {
      heatmapTeamToggle.querySelectorAll(".tk-team-toggle-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          tkHeatmapTeamFilter = btn.getAttribute("data-team") || "";
          heatmapTeamToggle.querySelectorAll(".tk-team-toggle-btn").forEach((el) => el.classList.toggle("is-active", el === btn));
          renderActivityHeatmap();
        });
      });
    }
    // FIX (visual): dulu <select id="tkHeatmapStatusFilter"> + listener
    // "change" -- diganti pill row yang tinggal diklik (.tk-status-tab),
    // pola click handler-nya disamain persis dengan team toggle di atas.
    if (heatmapStatusToggle) {
      heatmapStatusToggle.querySelectorAll(".tk-status-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          tkHeatmapStatusFilter = btn.getAttribute("data-status") || "";
          heatmapStatusToggle.querySelectorAll(".tk-status-tab").forEach((el) => el.classList.toggle("is-active", el === btn));
          renderActivityHeatmap();
        });
      });
    }

    // ---------- Rows-per-page control ----------
    const pageSizeSelect = document.getElementById("tkPageSizeSelect");
    const pageSizeCustomInput = document.getElementById("tkPageSizeCustomInput");
    if (pageSizeSelect) {
      const predetermined = ["10", "20", "30", "40", "50"];
      pageSizeSelect.value = predetermined.includes(String(tkPageSize)) ? String(tkPageSize) : "custom";
      if (pageSizeSelect.value === "custom") {
        pageSizeCustomInput.value = tkPageSize;
        pageSizeCustomInput.classList.remove("hidden");
      }
      pageSizeSelect.addEventListener("change", () => {
        if (pageSizeSelect.value === "custom") {
          pageSizeCustomInput.classList.remove("hidden");
          pageSizeCustomInput.value = tkPageSize;
          pageSizeCustomInput.focus();
          return;
        }
        pageSizeCustomInput.classList.add("hidden");
        tkPageSize = Number(pageSizeSelect.value) || 20;
        localStorage.setItem(TK_PAGE_SIZE_KEY, String(tkPageSize));
        tkCurrentPage = 1;
        renderTable();
      });
      pageSizeCustomInput.addEventListener("change", () => {
        const val = Math.max(1, Math.floor(Number(pageSizeCustomInput.value) || 20));
        pageSizeCustomInput.value = val;
        tkPageSize = val;
        localStorage.setItem(TK_PAGE_SIZE_KEY, String(tkPageSize));
        tkCurrentPage = 1;
        renderTable();
      });
    }

    renderAll();

    // =================================================================
    // AUTO-REFRESH — polling berkala supaya user TIDAK PERLU refresh
    // browser manual untuk lihat ticket baru / update status-assignee/
    // comment dari orang lain.
    //
    // Cukup re-fetch tickets+users dari server lalu renderAll() ulang.
    // Ini aman dipanggil di background kapan pun karena SEMUA fungsi
    // render (renderStats/renderStatusTabCounts/renderTable/
    // renderActivityHeatmap/renderHeatmapLegend) CUMA menulis ke tabel/
    // angka statistik/heatmap -- tidak satu pun menyentuh isi form di
    // modal Create/Detail (title/description/comment textarea, dsb)
    // atau nilai search box, jadi draft yang sedang diketik user tidak
    // pernah tertimpa oleh refresh berkala ini. Modal Detail yang
    // sedang terbuka juga tidak ikut disentuh (openDetail() tidak
    // dipanggil ulang di sini) supaya tidak mendadak berubah/tertutup
    // di tengah user membaca/mengerjakan sesuatu di dalamnya -- begitu
    // modalnya ditutup & dibuka lagi (atau lewat aksi apapun yang
    // sudah manggil openDetail()), datanya otomatis sudah yang terbaru
    // karena `tickets` di baliknya sudah ter-update.
    // =================================================================
    const TK_AUTO_REFRESH_MS = 15000; // 15 detik
    let tkAutoRefreshTimer = null;
    let tkIsAutoRefreshing = false;

    async function tkAutoRefreshTick() {
      // Jangan tumpuk request kalau siklus sebelumnya belum selesai
      // (koneksi lambat), dan jangan poll kalau tab sedang tidak
      // dilihat (background tab) -- hemat request & baterai; begitu
      // tab aktif lagi, listener visibilitychange di bawah langsung
      // memicu satu refresh instan.
      if (tkIsAutoRefreshing || document.hidden) return;
      tkIsAutoRefreshing = true;
      try {
        const [freshTickets, freshUsers] = await Promise.all([
          tkLoadFromServer(),
          tkLoadUsers(),
        ]);
        // null = fetch gagal (lihat tkLoadFromServer/tkLoadUsers) --
        // pertahankan data lama yang masih tampil, jangan diganti ke
        // kosong gara-gara satu request background gagal.
        if (Array.isArray(freshTickets)) {
          tickets = freshTickets;
          persist();
        }
        if (Array.isArray(freshUsers)) {
          window.__tkUsers = freshUsers;
        }
        renderAll();
      } catch (e) {
        // Diam-diam gagal -- ini refresh background tiap 15 detik,
        // jangan ganggu user dengan toast error kalau koneksi lagi
        // goyang sesaat.
        console.warn("[ticketing] Auto-refresh gagal:", e.message);
      } finally {
        tkIsAutoRefreshing = false;
      }
    }

    function tkStopAutoRefresh() {
      if (tkAutoRefreshTimer) {
        clearInterval(tkAutoRefreshTimer);
        tkAutoRefreshTimer = null;
      }
    }

    // Berhenti otomatis begitu user pindah ke halaman lain di SPA ini.
    // loadPage() di js/main.js meng-abort window.edashPageSignal setiap
    // kali pindah halaman (lihat edStartNewPageAbortScope()) -- dipakai
    // di sini murni sebagai sinyal "halaman Ticketing sudah ditinggal",
    // BUKAN buat fetch (tkLoadFromServer/tkLoadUsers pakai
    // edashApiFetch() apa adanya, tanpa signal ini, supaya request
    // in-flight tetap boleh selesai). Tanpa ini interval-nya akan terus
    // jalan selamanya di background walau #page-root sudah diisi
    // halaman lain -- dan numpuk timer baru tiap kali halaman Ticketing
    // dibuka ulang, karena initTicketing() dipanggil dari awal lagi.
    if (window.edashPageSignal) {
      window.edashPageSignal.addEventListener("abort", tkStopAutoRefresh, { once: true });
    }

    // Refresh instan begitu tab kembali aktif dilihat, supaya user yang
    // habis pindah tab lama tidak melihat data basi selama siklus 15
    // detik pertama.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tkAutoRefreshTick();
    });

    tkAutoRefreshTimer = setInterval(tkAutoRefreshTick, TK_AUTO_REFRESH_MS);

    // ---- Deep-link: ?ticket=<id> di URL SPA ----
    // js/main.js (initializeDashboard()) sudah memaksa halaman awal ke
    // Ticketing kalau URL punya param ini, tapi TIDAK menghapusnya dari
    // URL -- di sinilah param itu benar-benar dipakai: cari ticket-nya di
    // daftar yang barusan di-load, lalu buka modal Detail otomatis.
    // Setelah itu param dibersihkan dari address bar (history.replaceState,
    // TANPA reload) supaya: (a) refresh/klik menu lain berikutnya tidak
    // ikut membuka modal ini lagi, dan (b) kalau user pindah ke halaman
    // lain lalu balik lagi ke Ticketing lewat sidebar, tidak "nyangkut"
    // ke ticket lama.
    const tkDeepLinkId = new URLSearchParams(window.location.search).get("ticket");
    if (tkDeepLinkId) {
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, "", cleanUrl);

      const target = findTicket(tkDeepLinkId);
      if (target) {
        openDetail(target.id);
      } else {
        // Ticket tidak ada (sudah dihapus) atau di luar akses (mis. link
        // basi) -- kasih tahu, jangan diam-diam gagal.
        showToast("Ticket not found or no longer available");
      }
    }
  };

})();