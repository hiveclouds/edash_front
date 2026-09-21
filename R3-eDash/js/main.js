// =============================
// Load HTML Component
// =============================

async function loadComponent(file, target) {

    try {

        const response = await fetch(file);

        if (!response.ok)
            throw new Error(`Cannot load ${file}`);

        document.querySelector(target).innerHTML =
            await response.text();

    } catch (err) {

        console.error(err);

        document.querySelector(target).innerHTML =
            `<p style="padding:20px;color:red;">
                Failed loading ${file}
            </p>`;
    }

}

// =============================
// Permission Gate (Settings > Role Access)
// =============================
// Peta halaman -> permission_key yang menjaganya. Halaman yang TIDAK ada
// di map ini (mis. alert.html, setting.html, operator-dashboard.html)
// dianggap terbuka buat siapapun yang sudah login -- termasuk alert.html,
// karena alert.ack cuma menjaga tombol Edit/Delete di dalamnya (action-level
// gate, bukan page-level), bukan seluruh halamannya.
const PAGE_PERMISSION_MAP = {
    "pages/dashboard.html": "dashboard.view",
    "pages/project-selector.html": "project.monitoring",
    "pages/project-monitoring.html": "project.monitoring",
    "pages/project-detail.html": "project.monitoring",
    "pages/project-overview.html": "project.monitoring",
    "pages/system-information.html": "project.monitoring",
    "pages/battery-station.html": "battery.view",
    "pages/alert.html": "alert.diagnosis.view",
    "pages/task-management.html": "task.management",
    "pages/task-maintenance.html": "task.maintenance",
    "pages/admin-calculator.html": "calculator.use",
    "pages/catalog.html": "catalog.view",
    "pages/add-project.html": "project.create",
    "pages/admin-view.html": "adminview.access",
    "pages/activity-log.html": "activitylog.view",
};

// root selalu lolos tanpa cek array permission (root memang tidak punya
// baris di role_permissions -- sama seperti requirePermission() di
// backend). Role lain dicek dari sessionStorage.edash-permissions, yang
// diisi login.js dari response /auth/login (field user.permissions).
//
// adminview.access & users.manage punya HARDCODE tambahan: operator
// SELALU lolos 2 permission itu, sama seperti backend
// (requirePermissionOrRoleKeys di admin.routes.ts) -- walaupun di tabel
// role_permissions kedua permission itu ke-toggle OFF buat operator.
const PERMISSION_HARDCODE_BYPASS_ROLES = {
    "adminview.access": ["operator"],
    "users.manage": ["operator"],
};

function hasPermission(permissionKey) {

    if (!permissionKey) return true;

    if (sessionStorage.getItem("edash-role-tier") === "root") return true;

    const role = sessionStorage.getItem("edash-role");
    const bypassRoles = PERMISSION_HARDCODE_BYPASS_ROLES[permissionKey];
    if (bypassRoles && role && bypassRoles.includes(role)) return true;

    let permissions = [];
    try {
        permissions = JSON.parse(sessionStorage.getItem("edash-permissions") || "[]");
    } catch (err) {
        permissions = [];
    }

    return permissions.includes(permissionKey);

}

// Halaman pertama (urutan di PAGE_PERMISSION_MAP) yang boleh diakses role
// yang sedang login -- dipakai buat landing page awal & tombol di layar
// Access Denied, supaya tidak hardcode ke dashboard.html (yang bisa saja
// izinnya di-toggle OFF juga buat role tertentu).
function getFirstAllowedPage() {

    for (const page in PAGE_PERMISSION_MAP) {
        if (hasPermission(PAGE_PERMISSION_MAP[page])) return page;
    }

    return null;

}

// =============================
// Last Visited Page (persist across refresh)
// =============================
// Setiap loadPage() yang BERHASIL (lolos permission gate & fetch-nya OK)
// disimpan ke sessionStorage di sini -- supaya hard refresh (F5) bisa
// balik ke halaman yang sama, bukan selalu "kelempar" ke Dashboard.
// Pakai sessionStorage (bukan localStorage) supaya tab/sesi baru tetap
// mulai dari initial page normal, cuma refresh di tab yang sama yang
// "diingat".
const LAST_PAGE_STORAGE_KEY = "edash-last-page";

// Sebelum halaman terakhir itu dipakai lagi sebagai initial page (lihat
// initializeDashboard()), cek ulang apakah role yang sedang login masih
// boleh mengaksesnya -- bisa saja izinnya baru dicabut root di tab lain
// sejak terakhir kali halaman itu dibuka.
function isLastPageStillAllowed(page) {

    if (!page) return false;

    const permissionKey = PAGE_PERMISSION_MAP[page];
    if (permissionKey && !hasPermission(permissionKey)) return false;

    // Ticketing (WebDev) internal-only (root/360master + biofloc & REMS
    // intern lead/intern) -- sama seperti hardcode di applyOperatorSidebar().
    // Tidak ada di PAGE_PERMISSION_MAP karena backend-nya digate per-tier
    // (requireInternalOrRoot), bukan requirePermission per-capability, jadi
    // harus dicek manual juga di sini supaya operator/staff yang refresh
    // tidak "nyangkut balik" ke halaman yang sebenarnya bukan haknya.
    if (page === "pages/ticketing.html") {
        const role = sessionStorage.getItem("edash-role");
        if (role === "operator" || role === "staff") return false;
    }

    return true;

}

function renderAccessDeniedPage() {

    const fallbackPage = hasPermission("dashboard.view") ? "pages/dashboard.html" : getFirstAllowedPage();

    const root = document.getElementById("page-root");
    if (!root) return;

    root.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:80px 20px;text-align:center;min-height:50vh;">
            <i class="fa-solid fa-lock" style="font-size:40px;color:#B0B7C3;"></i>
            <h2 style="margin:0;font-size:20px;color:#1B2430;">Akses Ditolak</h2>
            <p style="margin:0;color:#6B7280;max-width:360px;">Kamu tidak punya akses ke halaman ini. Hubungi 360master kalau menurutmu ini keliru.</p>
            ${fallbackPage ? `<button type="button" id="edAccessDeniedBackBtn" style="margin-top:8px;padding:10px 20px;border:none;border-radius:8px;background:#0F6A71;color:#fff;font-weight:600;cursor:pointer;">Kembali ke Dashboard</button>` : ""}
        </div>
    `;

    const backBtn = document.getElementById("edAccessDeniedBackBtn");
    if (backBtn && fallbackPage) {
        backBtn.addEventListener("click", () => loadPage(fallbackPage));
    }

}

// Sembunyikan nav item sidebar yang permission-nya tidak dimiliki role yang
// sedang login -- generik buat SEMUA role (root selalu lihat semua item,
// tidak pernah disembunyikan di sini). Dijalankan SEBELUM
// applyOperatorSidebar(), supaya override khusus operator (relabel
// Project Monitoring, sembunyikan Project Selector) tetap final.
//
// CATATAN: sengaja SELALU set style.display (bukan cuma "none" saat
// ditolak) -- supaya kalau dipanggil ulang setelah refreshUserSession()
// (permission baru saja di-toggle ON lagi oleh root di tab lain), item
// yang tadinya disembunyikan bisa muncul balik juga, bukan cuma bisa
// disembunyikan satu arah.
function applyPermissionSidebar() {

    const isRoot = sessionStorage.getItem("edash-role-tier") === "root";

    document.querySelectorAll(".sb-nav-item[data-page]").forEach((item) => {

        const page = item.getAttribute("data-page");
        const permissionKey = PAGE_PERMISSION_MAP[page];

        if (isRoot || !permissionKey) {
            item.style.display = "";
            return;
        }

        item.style.display = hasPermission(permissionKey) ? "" : "none";

    });

}

// =============================
// Refresh Session (Settings > Role Access "langsung nempel")
// =============================
// GET /auth/me -- narik ulang { role, roleLabel, roleTier,
// canManageSettings, permissions } TERBARU dari backend tanpa perlu
// logout/login ulang. Sebelum ini, edash-permissions di sessionStorage
// cuma diisi SEKALI saat /auth/login (lihat login.js) -- jadi kalau root
// toggle permission role tertentu di Settings > Role Access, user lain
// dengan role itu baru "lihat" perubahannya kalau logout lalu login lagi.
//
// Dipanggil di 2 tempat (lihat pemanggilnya): initializeDashboard() saat
// SPA pertama kali dimuat (termasuk hard refresh), dan di awal loadPage()
// setiap kali pindah halaman -- supaya toggle permission langsung nempel
// di kedua skenario yang diminta, tanpa perlu logout.
async function refreshUserSession() {

    if (typeof edashApiFetch !== "function") return null;

    try {

        const data = await edashApiFetch("/auth/me");
        // Terima dua kemungkinan bentuk payload backend: { user: {...} }
        // (konsisten sama payload.data.user di /auth/login, lihat
        // login.js) atau user langsung sebagai data itu sendiri.
        const user = data && data.user ? data.user : data;

        if (!user) return null;

        // Sama persis field yang diisi login.js saat /auth/login --
        // supaya semua halaman yang baca sessionStorage ini (setting.js,
        // ticketing.js, admin-view.js, dll) tetap konsisten.
        sessionStorage.setItem("edash-user", user.username);
        sessionStorage.setItem("edash-role", user.roleKey);
        sessionStorage.setItem("edash-role-label", user.roleLabel);
        sessionStorage.setItem("edash-role-tier", user.roleTier);
        sessionStorage.setItem("edash-can-manage-settings", user.canManageSettings ? "1" : "0");
        sessionStorage.setItem("edash-user-id", user.id);
        sessionStorage.setItem("edash-permissions", JSON.stringify(user.permissions || []));
        // Sama seperti login.js -- Full Name & foto profil TERBARU dari
        // Settings > Profil, supaya header/sidebar langsung "nempel" begitu
        // Save Changes diklik (setting.js manggil refreshUserSession() ini
        // setelah PUT /auth/profile & /auth/profile/photo berhasil), tanpa
        // perlu logout/login ulang -- berlaku buat SEMUA role, karena
        // refreshUserSession() dipanggil generik di sini, bukan per-role.
        sessionStorage.setItem("edash-user-fullname", user.fullName || user.username);
        sessionStorage.setItem("edash-user-photo", user.photoUrl || "");
        sessionStorage.setItem("edash-user-email", user.email || "");

        // Terapkan ulang efek UI yang bergantung ke permission/role, kalau
        // bagian-bagian itu sudah ke-render di DOM saat ini (aman kalau
        // belum -- querySelector/getElementById cuma balikin null/kosong).
        applyPermissionSidebar();
        if (typeof applyOperatorSidebar === "function") applyOperatorSidebar();
        if (typeof applyEmptyNavGroupVisibility === "function") applyEmptyNavGroupVisibility();
        if (typeof populateHeaderProfile === "function") populateHeaderProfile();

        return user;

    } catch (err) {
        // Gagal narik /auth/me (mis. lagi offline) -- JANGAN putus alur
        // halaman, cukup pakai data sesi yang lama (sama seperti perilaku
        // sebelum fitur ini ada). edashApiFetch sendiri yang akan redirect
        // ke login.html kalau responsnya 401 (session_token expired).
        console.warn("[main] Gagal refresh sesi dari /auth/me:", err.message || err);
        return null;
    }

}

// Wrapper dengan batas waktu buat refreshUserSession() -- dipakai di
// loadPage() (BUKAN di boot pertama initializeDashboard(), yang memang
// harus menunggu penuh buat menentukan initialPage/role).
//
// KENAPA INI PERLU: refreshUserSession() manggil /auth/me lewat network,
// dan request PERTAMA ke backend tepat setelah login (cold TLS/koneksi,
// session lookup belum "panas") bisa lambat -- kadang beberapa detik.
// Karena loadPage() sebelumnya SELALU `await refreshUserSession()` dulu
// sebelum merender apa pun, tiap kali user klik menu sidebar tepat
// setelah login, klik itu terasa "tidak merespons" selama request lambat
// itu berlangsung -- padahal sebenarnya cuma menunggu, bukan macet. User
// yang tidak sabar lalu refresh browser, dan setelah refresh koneksinya
// sudah "hangat" jadi /auth/me berikutnya cepat -- makanya kelihatan
// seperti "harus di-refresh dulu baru normal".
//
// Solusinya BUKAN membatalkan refresh-nya, tapi memberi batas waktu:
// kalau /auth/me belum selesai dalam SESSION_REFRESH_TIMEOUT_MS, navigasi
// tetap lanjut pakai data permission yang sudah ada di sessionStorage
// (dari login terakhir / refresh terakhir yang berhasil) -- TIDAK
// menunggu tanpa batas. Request /auth/me aslinya tetap jalan di
// background dan tetap akan meng-update sessionStorage + UI begitu
// selesai (lihat isi refreshUserSession()), jadi datanya tetap
// "menyusul" jadi fresh, cuma tidak memblokir navigasi yang sedang
// berlangsung.
const SESSION_REFRESH_TIMEOUT_MS = 1200;

function refreshUserSessionWithTimeout() {
    return Promise.race([
        refreshUserSession(),
        new Promise((resolve) => setTimeout(() => resolve(null), SESSION_REFRESH_TIMEOUT_MS)),
    ]);
}

// =============================
// Load Page
// =============================

// Token buat menjaga loadPage() dari race condition. Sidebar sudah bisa
// diklik SEBELUM loadPage(initialPage) awal selesai (lihat
// initializeDashboard()) -- jadi kalau user klik menu lain selagi page
// pertama masih proses (refreshUserSession() + fetch(page) di bawah, bisa
// lambat terutama tepat setelah login), DUA panggilan loadPage() berjalan
// bersamaan. Tanpa penjagaan ini, siapa pun yang paling akhir SELESAI yang
// menang nulis ke #page-root & LAST_PAGE_STORAGE_KEY -- biasanya load awal
// (mis. Dashboard) menimpa balik halaman yang baru saja diklik user,
// sehingga kelihatan seperti "diklik tidak pindah halaman" sampai di-
// refresh (refresh cuma memicu satu loadPage() saja, jadi tidak ada race).
let edPageLoadToken = 0;

// =============================
// Per-page request cancellation
// =============================
// AKAR MASALAH SEBENARNYA dari "pindah halaman lewat sidebar tidak
// responsif": halaman-halaman tertentu (Dashboard paling parah -- lihat
// poLoadTodayRealCurve()/poLoadWeeklyCurve() di dashboard.js) menembak
// SATU request /telemetry/history TERPISAH per device secara paralel
// (Promise.all atas semua device). Kalau device-nya banyak, ini gampang
// menembus batas ~6 koneksi bersamaan per situs yang diizinkan browser --
// sisanya antre. Request-request ini TIDAK PERNAH dibatalkan waktu user
// pindah ke halaman lain, jadi mereka terus antre & jalan di background,
// menyita slot koneksi yang seharusnya dipakai halaman BARU (termasuk
// fetch(page) buat HTML-nya sendiri, /auth/me, dan data halaman baru itu
// sendiri) -- persis pola yang kelihatan di Network tab: request lama
// (history?last=24h/14d) menumpuk & makin lama makin lambat, sementara
// halaman yang baru diklik kelihatan "diam" karena request-nya sendiri
// ikut ketahan antrean yang sama.
//
// Solusi: satu AbortSignal per halaman, di-expose lewat
// window.edashPageSignal -- setiap kali loadPage() pindah ke halaman
// BARU, AbortController lama di-abort dulu (otomatis membatalkan semua
// fetch yang masih menyertakan signal ini), baru bikin yang baru buat
// halaman berikutnya. Halaman/skrip yang menembak banyak request
// per-device (dashboard.js, dan sejenisnya kalau ada) tinggal
// menyertakan `{ signal: window.edashPageSignal }` di panggilan
// edashApiFetch()-nya.
let edPageAbortController = null;

function edStartNewPageAbortScope() {
    if (edPageAbortController) edPageAbortController.abort();
    edPageAbortController = new AbortController();
    window.edashPageSignal = edPageAbortController.signal;
    return edPageAbortController.signal;
}

async function loadPage(page) {

    const myToken = ++edPageLoadToken;

    try {

        // Narik ulang role/permission TERBARU sebelum cek akses halaman
        // yang mau dibuka -- ini yang bikin toggle di Settings > Role
        // Access langsung nempel begitu user pindah halaman, tanpa perlu
        // logout dulu. Pakai versi ber-timeout (lihat komentar di
        // refreshUserSessionWithTimeout() di atas) supaya navigasi TIDAK
        // ikut lambat kalau /auth/me sedang lambat -- permission yang
        // dipakai di bawah tetap yang paling baru KALAU sempat, atau yang
        // lama (masih valid) kalau belum sempat dalam batas waktu.
        await refreshUserSessionWithTimeout();

        // Sudah ada panggilan loadPage() yang LEBIH BARU (user sempat klik
        // menu lain selagi refreshUserSession() di atas masih berjalan) --
        // batalkan yang ini, biar tidak menimpa balik halaman yang
        // seharusnya sedang dituju sekarang.
        if (myToken !== edPageLoadToken) return;

        const permissionKey = PAGE_PERMISSION_MAP[page];
        if (permissionKey && !hasPermission(permissionKey)) {
            renderAccessDeniedPage();
            return;
        }

        // Halaman ini sudah pasti akan ditampilkan sekarang -- batalkan
        // dulu semua request yang masih menggantung dari halaman
        // SEBELUMNYA (lihat penjelasan panjang di edStartNewPageAbortScope()
        // di atas) SEBELUM fetch(page) di bawah, supaya fetch halaman baru
        // ini dapat slot koneksi browser secepat mungkin alih-alih ikut
        // antre di belakang request-request lama yang masih menyala.
        edStartNewPageAbortScope();

        const response = await fetch(page);
        const html = await response.text();

        // Cek lagi setelah fetch(page) selesai (bisa juga lambat) --
        // alasan sama seperti di atas.
        if (myToken !== edPageLoadToken) return;

        const pageRootEl = document.getElementById("page-root");
        pageRootEl.innerHTML = html;

        // Defensive reset: #page-root is a SHARED, long-lived element (only
        // its innerHTML is swapped by every loadPage() call, the element
        // itself is never recreated). Some page-level code (e.g.
        // EdashLoadingBar.show() in js/loading-bar.js, when handed
        // "#page-root" or an ancestor of it as its container) can end up
        // writing an inline `style="position: relative"` onto it. If that
        // never gets cleaned up, #page-root -- which normally collapses to
        // height:0 since its content is Project Selector's absolutely
        // positioned `.ps-page` -- becomes the CONTAINING BLOCK for that
        // `.ps-page { position:absolute; inset:-24px }` instead of
        // `.edash-content`, so the fullscreen map renders at ~48px tall
        // instead of filling the screen (looks like the map got pushed up
        // and clipped). This only shows up after SPA navigation because a
        // hard refresh always starts with a clean #page-root with no
        // leftover inline style. Clearing any inline position here on
        // every navigation guarantees #page-root is never accidentally a
        // positioning context, regardless of what earlier ran on it.
        pageRootEl.style.position = "";

        // Ingat halaman ini sebagai "halaman terakhir yang dibuka" -- dibaca
        // lagi oleh initializeDashboard() saat hard refresh (F5), supaya
        // user kembali ke sini, bukan selalu ke Dashboard. Disimpan di sini
        // (bukan lebih awal) supaya cuma halaman yang benar-benar berhasil
        // dimuat (lolos permission gate & fetch-nya sukses) yang diingat.
        sessionStorage.setItem(LAST_PAGE_STORAGE_KEY, page);

        // Reset scroll position on every navigation. Without this, if the
        // PREVIOUS page (e.g. Settings, Task Management) was scrolled down,
        // .edash-content keeps that scrollTop offset. Project Selector's
        // map/cards are positioned with `position:absolute` INSIDE
        // .edash-content (see .ps-page { inset: ... } in project-selector.css),
        // so a leftover scrollTop pushes the whole fullscreen layout upward —
        // the floating cards end up shifted up and clipped at the top, with
        // no margin at the bottom, until a hard refresh resets scrollTop to 0.
        const contentEl = document.querySelector(".edash-content");
        if (contentEl) contentEl.scrollTop = 0;

        // Hanya Project Selector yang perlu mengunci scroll (peta
        // fullscreen). Halaman lain (Settings, dst.) harus tetap
        // bisa di-scroll normal lewat mouse wheel / trackpad.
        const isFullscreenPage = page.includes("project-selector");

        document.documentElement.classList.toggle("edash-fullscreen-page", isFullscreenPage);
        document.body.classList.toggle("edash-fullscreen-page", isFullscreenPage);

        applyLanguage(getSavedLanguage());

        // Jalankan initializer khusus halaman jika tersedia
        if (page.includes("login") && typeof initLogin === "function") {
            initLogin();
        }

        if (page.includes("project-overview") && typeof initializeProjectOverview === "function") {
            initializeProjectOverview();
        }

        if (page.includes("dashboard") && typeof initDashboardPage === "function") {
            initDashboardPage();
        }

        if (page.includes("project-selector") && typeof initProjectSelector === "function") {
            initProjectSelector();
        }

        if (page.includes("project-monitoring") && typeof initProjectMonitoring === "function") {
            initProjectMonitoring();
        }

        if (page.includes("system-information") && typeof initSystemInformation === "function") {
            initSystemInformation();
        }

        if (page.includes("task-management") && typeof initTaskManagement === "function") {
            initTaskManagement();
        }

        if (page.includes("task-maintenance") && typeof initTaskMaintenance === "function") {
            initTaskMaintenance();
        }

        if (page.includes("setting") && typeof initSetting === "function") {
            initSetting();
        }

        if (page.includes("alert") && typeof initializeAlert === "function") {
            initializeAlert();
        }

        if (page.includes("add-project") && typeof initAddProject === "function") {
            initAddProject();
        }

        if (page.includes("admin-calculator") && typeof initAdminCalculator === "function") {
            initAdminCalculator();
        }

        if (page.includes("admin-view") && typeof initAdminView === "function") {
            initAdminView();
        }

        if (page.includes("activity-log") && typeof initActivityLog === "function") {
            initActivityLog();
        }

        if (page.includes("catalog") && typeof initCatalog === "function") {
            initCatalog();
        }

        if (page.includes("operator-dashboard") && typeof initOperatorDashboard === "function") {
            initOperatorDashboard();
        }

        if (page.includes("ticketing") && typeof initTicketing === "function") {
            initTicketing();
        }

    } catch (err) {

        console.error(err);

    }

}

// =============================
// Language Switch (EN / ID)
// =============================

const translations = {
    en: {
        "header.notif.title": "Notifications",
        "header.notif.markAll": "Mark All Read",
        "header.notif.empty": "No notifications yet",

        "sidebar.greeting.label": "Hello,",
        "sidebar.dashboard": "Dashboard",
        "sidebar.nav.monitoring": "Monitoring",
        "sidebar.nav.projectSelector": "Project Selector",
        "sidebar.nav.projectMonitoring": "Project Monitoring",
        "sidebar.nav.systemInformation": "System Information",
        "sidebar.nav.alerts": "Alerts",
        "sidebar.nav.taskMaintenance": "Task Maintenance",
        "sidebar.nav.batteryStation": "Battery Station",
        "taskMaintenance.subtitle": "List of maintenance tasks assigned to you. Accept tasks, update work progress, then submit the completion report.",
        "activityLog.subtitle": "This page tracks visitor origin, language switches, logins, logouts, calculator use, and report exports. The full activity list is below.",
        "marketing.metaOverview": "Meta Pixel Overview",
        "marketing.subtitle": "This card shows visitors and conversions on the Solar Calculator page. Data comes from the Meta Pixel events on that page.",
        "marketing.viewDetails": "View Details",
        "marketing.totalVisitors": "Total Visitors",
        "marketing.calculatorEngagement": "Calculator Engagement",
        "marketing.calculateClicks": "Calculate Estimate Clicks",
        "marketing.leads": "Leads (Email Submissions)",
        "marketing.engagementRate": "Engagement rate",
        "marketing.engagedVisitors": "engaged visitors ÷ total visitors",
        "marketing.conversionRate": "Conversion rate",
        "marketing.leadsVisitors": "leads ÷ total visitors",
        "marketing.funnelTitle": "Visitor → Lead Funnel",
        "marketing.empty": "No Meta Pixel events recorded yet. Numbers will appear here as soon as someone visits the Solar Calculator page.",
        "marketing.detailsTitle": "Marketing Analytics Details",
        "sidebar.nav.tools": "Tools",
        "sidebar.nav.adminCalc": "Admin Calculator",
        "sidebar.nav.catalog": "Katalog",
        "sidebar.nav.addProject": "Add New Project",
        "sidebar.nav.administration": "Administration",
        "sidebar.nav.adminView": "Admin View",
        "sidebar.nav.ActivityLog": "Activity Log",
        "sidebar.nav.webdev": "Ticketing",
        "sidebar.nav.ticketing": "Ticketing",
        "sidebar.nav.others": "Others",
        "sidebar.nav.setting": "Setting",
        "sidebar.nav.logout": "Logout",

        "ticketing.title": "Ticketing",
        "ticketing.subtitle": "Report and track technical issues, bug fixes, and feature requests across teams.",
        "ticketing.newTicket": "New Ticket",
        "ticketing.stats.total": "Total Tickets",
        "ticketing.stats.open": "Open",
        "ticketing.stats.inProgress": "In Progress",
        "ticketing.stats.waitingApproval": "Waiting Approval",
        "ticketing.stats.resolved": "Resolved",
        "ticketing.stats.rejected": "Rejected",
        "ticketing.heatmap.title": "Ticket Activity",
        "ticketing.heatmap.subtitle": "Daily log of ticket submissions, updates, and resolutions.",
        "ticketing.heatmap.mon": "Mon",
        "ticketing.heatmap.wed": "Wed",
        "ticketing.heatmap.fri": "Fri",
        "ticketing.heatmap.less": "Less",
        "ticketing.heatmap.more": "More",
        "ticketing.filters.allTypes": "All Types",
        "ticketing.filters.allStatus": "All Status",
        "ticketing.filters.allTeams": "All Teams",
        "ticketing.type.bug": "Bug",
        "ticketing.type.featureRequest": "Feature Request",
        "ticketing.type.uiUxFeedback": "UI/UX Feedback",
        "ticketing.type.dataIssue": "Data Issue",
        "ticketing.type.performanceIssue": "Performance Issue",
        "ticketing.type.question": "Question",
        "ticketing.type.other": "Other",
        "ticketing.priority.low": "Low",
        "ticketing.priority.medium": "Medium",
        "ticketing.priority.high": "High",
        "ticketing.status.inProgress": "In Progress",
        "ticketing.status.waitingApproval": "Waiting Approval",
        "ticketing.status.resolved": "Resolved",
        "ticketing.status.rejected": "Rejected",
        "ticketing.team.r1": "R1 - Hardware",
        "ticketing.team.r2": "R2 - Backend",
        "ticketing.team.r3": "R3 - Frontend",
        "ticketing.table.id": "Ticket",
        "ticketing.table.team": "Team",
        "ticketing.table.type": "Type",
        "ticketing.table.priority": "Priority",
        "ticketing.table.status": "Status",
        "ticketing.table.submittedBy": "Submitted By",
        "ticketing.table.assignedTo": "Assigned To",
        "ticketing.table.created": "Created",
        "ticketing.table.actions": "Actions",
        "ticketing.table.rowsPerPage": "Rows per page",
        "ticketing.table.rowsPerPageCustom": "Custom...",
        "ticketing.emptyState": "No tickets found matching your filters.",
        "ticketing.createModal.title": "Submit New Ticket",
        "ticketing.createModal.titleLabel": "Title",
        "ticketing.createModal.titleError": "Title is required.",
        "ticketing.createModal.typeLabel": "Type",
        "ticketing.createModal.teamLabel": "Team",
        "ticketing.createModal.priorityLabel": "Priority",
        "ticketing.createModal.pageLabel": "Related Page (optional)",
        "ticketing.createModal.descLabel": "Description",
        "ticketing.createModal.descError": "Description is required.",
        "ticketing.createModal.attachmentLabel": "Attachments (required)",
        "ticketing.createModal.attachmentPick": "Add files",
        "ticketing.createModal.attachmentNone": "No file selected",
        "ticketing.createModal.attachmentHint": "PDF, Word, video, or image (max. 10 files, 25 MB each). Required for bug reports and feature requests.",
        "ticketing.createModal.attachmentError": "At least 1 file is required (max 10 files, 25MB each, PDF/Word/video/image only).",
        "ticketing.createModal.submitterHint": "Submitted as",
        "ticketing.createModal.cancel": "Cancel",
        "ticketing.createModal.submit": "Submit Ticket",
        "ticketing.detail.submittedBy": "Submitted by",
        "ticketing.detail.attachment": "Attachments",
        "ticketing.detail.relatedPage": "Related page",
        "ticketing.detail.created": "Created",
        "ticketing.detail.updated": "Last updated",
        "ticketing.detail.assignedTo": "Assigned to",
        "ticketing.detail.status": "Status",
        "ticketing.detail.claim": "Assign to me",
        "ticketing.detail.save": "Save Changes",
        "ticketing.detail.comments": "Comments",
        "ticketing.detail.commentsEmpty": "No comments yet.",
        "ticketing.detail.commentSubmit": "Comment",
        "ticketing.detail.delete": "Delete this ticket",
        "ticketing.deleteModal.title": "Delete Ticket",
        "ticketing.deleteModal.text": "This ticket, its attachments, and all comments will be permanently deleted. This action cannot be undone.",
        "ticketing.deleteModal.cancel": "Cancel",
        "ticketing.deleteModal.confirm": "Delete Permanently",
        "ticketing.createModal.descPlaceholder": "Describe the issue, reproduction steps, or desired outcome...",
        "ticketing.createModal.estimatedDaysPlaceholder": "Number of days",
        "ticketing.createModal.pageError": "Related Page is required (except for Question/Other tickets).",
        "ticketing.createModal.pageOtherPlaceholder": "Type the page/feature name",
        "ticketing.createModal.titlePlaceholder": "Short summary of the bug or improvement",
        "ticketing.detail.commentPlaceholder": "Add a comment or work update...",
        "ticketing.detail.dueDate": "Estimated completion",
        "ticketing.detail.dueDateClear": "Clear Deadline",
        "ticketing.detail.dueDateDirectLabel": "Or pick an exact date",
        "ticketing.detail.dueDateEstimatedDaysLabel": "Estimated days from today",
        "ticketing.detail.dueDateHint": "Admin only. By default, the deadline is calculated automatically from the expected hours.",
        "ticketing.detail.dueDateSave": "Save Deadline",
        "ticketing.detail.dueDateSection": "Adjust Completion Deadline",
        "ticketing.detail.edit": "Edit",
        "ticketing.detail.editLog": "History",
        "ticketing.detail.editLogTitle": "Edit history",
        "ticketing.detail.editLogBack": "Back to latest",
        "ticketing.detail.copyLink": "Copy Link",
        "ticketing.detail.approve": "Approve & Resolve",
        "ticketing.detail.reject": "Reject Ticket",
        "ticketing.detail.claimPanelTitle": "Claim Ticket",
        "ticketing.detail.claimPanelHint": "Optional: select teammates who will collaborate on this ticket.",
        "ticketing.detail.claimCancel": "Cancel",
        "ticketing.detail.claimConfirm": "Confirm Claim",
        "ticketing.detail.startTimer": "Start Working",
        "ticketing.detail.expectedHours": "Expected time",
        "ticketing.detail.workedTime": "Time worked",
        "ticketing.status.open": "Open",
        "ticketing.leaderboard.title": "Leaderboard",
        "ticketing.leaderboard.subtitle": "Top contributors ranked by completed tickets and delivery speed.",
        "ticketing.leaderboard.empty": "No rankings yet. Completed tickets will appear here.",
        "ticketing.leaderboard.pointsHelp.title": "Points & Scoring",
        "ticketing.leaderboard.pointsHelp.bonusLabel": "Speed bonus:",
        "ticketing.leaderboard.pointsHelp.bonusText": "Complete before target time to earn bonus points.",
        "ticketing.leaderboard.topPerformers": "Top Contributors",
        "ticketing.leaderboard.contenders": "Rankings",
        "ticketing.createModal.expectedHoursLabel": "Expected time (hours)",
        "ticketing.createModal.expectedHoursPlaceholder": "e.g. 6",
        "ticketing.createModal.expectedHoursError": "Expected time is required (whole number of hours, at least 1).",
        "ticketing.createModal.priorityTooltip": "Low: Minor visual issue. Medium: Feature impaired with workaround. High: Major feature unavailable. Critical: System outage or risk of data loss.",
        "ticketing.detail.waitingApprovalHint": "Submit for review once complete. An admin or lead will review and verify the changes.",
        "ticketing.detail.resolutionViewTitle": "Proof of Completion",
        "ticketing.detail.resolutionAttachment": "Evidence files",
        "ticketing.detail.resolutionInputTitle": "Proof of Completion",
        "ticketing.detail.resolutionInputHint": "Outline the solution and attach proof of completion before requesting approval.",
        "ticketing.detail.resolutionNoteLabel": "Resolution Summary",
        "ticketing.detail.resolutionNotePlaceholder": "Summarize the changes made or fix applied...",
        "ticketing.detail.resolutionNoteError": "Description is required before marking this ticket as Waiting Approval.",
        "ticketing.detail.resolutionAttachmentLabel": "Evidence files (required)",
        "ticketing.detail.resolutionAttachmentHint": "PDF, Word, video, or image (max. 10 files, 25 MB each). At least 1 file is required.",
        "ticketing.detail.resolutionAttachmentError": "At least 1 file is required (max 10 files, 25MB each, PDF/Word/video/image only).",
        "ticketing.priority.critical": "Critical",
        "ticketing.searchPlaceholder": "Search by title, submitter, or ticket ID...",
        "ticketing.table.due": "Due",

        "settings.eyebrow": "Account & Preferences",
        "settings.title": "Settings",
        "settings.subtitle": "Manage the appearance, language, and account security for your 360eDash account in one place.",

        "settings.tabs.appearance": "Appearance",
        "settings.tabs.language": "Language",
        "settings.tabs.profile": "Profile",
        "settings.tabs.account": "Account",

        "settings.appearance.title": "Appearance",
        "settings.appearance.desc": "Choose the display theme that's most comfortable for your eyes.",
        "settings.appearance.light": "Light Mode",
        "settings.appearance.dark": "Dark Mode",
        "settings.appearance.system": "System",
        "settings.appearance.soon": "Soon",
        "settings.appearance.hint": "Dark mode is saved as your preference and will roll out across the whole dashboard soon.",
        "settings.appearance.darkToast": "Dark mode enabled",
        "settings.appearance.lightToast": "Light mode enabled",

        "settings.language.title": "Language",
        "settings.language.desc": "Set the display language for all menus and dashboard labels.",
        "settings.language.label": "Display language",
        "settings.language.hint": "More languages will be added in an upcoming update.",
        "settings.language.toastEn": "Language changed to English",
        "settings.language.toastId": "Bahasa diubah ke Indonesia",

        "settings.profile.title": "Profile",
        "settings.profile.desc": "Update the profile and contact information shown on your account.",
        "settings.profile.changePhoto": "Change Photo",
        "settings.profile.removePhoto": "Remove",
        "settings.profile.photoHint": "JPG or PNG, max 2MB.",
        "settings.profile.fullName": "Full Name",
        "settings.profile.email": "Email",
        "settings.profile.phone": "Phone Number",
        "settings.profile.position": "Job Position",
        "settings.profile.discard": "Discard",
        "settings.profile.save": "Save Changes",

        "settings.account.title": "Account",
        "settings.account.desc": "Manage your username and password to keep your account secure.",
        "settings.account.username": "Username",
        "settings.account.currentPassword": "Current Password",
        "settings.account.newPassword": "New Password",
        "settings.account.confirmPassword": "Confirm Password",
        "settings.account.strength": "Password strength",
        "settings.account.discard": "Discard",
        "settings.account.update": "Update Password",

        "maintenance.need.title": "Does this unit need maintenance?",
        "maintenance.need.desc": "Request a maintenance schedule or view this unit's maintenance history on the Task Management page.",
        "maintenance.need.button": "Request Maintenance Task",

        "settings.errors.required": "This field is required.",
        "settings.errors.email": "Enter a valid email address.",
        "settings.errors.phone": "Enter a valid phone number.",
        "settings.errors.password": "Minimum 8 characters.",
        "settings.errors.confirmPassword": "Passwords do not match.",

        "settings.tabs.roleAccess": "Role Access",
        "settings.roleAccess.title": "Role Access",
        "settings.roleAccess.hint": "Each column is a team role. Turn a switch on to let people with that role use that feature.",
        "settings.roleAccess.capabilityCol": "What it lets people do",

        "settings.roleAccess.roles.bioflocLead": "Biofloc Intern Lead",
        "settings.roleAccess.roles.remsLead": "REMS Intern Lead",
        "settings.roleAccess.roles.bioflocIntern": "Biofloc Intern",
        "settings.roleAccess.roles.remsIntern": "REMS Intern",
        "settings.roleAccess.roles.operator": "Operator",
        "settings.roleAccess.roles.staff": "Staff",

        "settings.roleAccess.cap.dashboard.title": "See the Dashboard",
        "settings.roleAccess.cap.dashboard.desc": "Open the main Dashboard page and see today's and this week's production overview.",
        "settings.roleAccess.cap.monitor.title": "See Project Monitoring",
        "settings.roleAccess.cap.monitor.desc": "Open the project map and check how each site is doing.",
        "settings.roleAccess.cap.battery.title": "See Battery Status",
        "settings.roleAccess.cap.battery.desc": "Check battery charge and health on the Battery Station page.",
        "settings.roleAccess.cap.alert.title": "Clear Alerts",
        "settings.roleAccess.cap.alert.desc": "Mark an active alert as handled so it's cleared for everyone.",
        "settings.roleAccess.cap.taskManagement.title": "Manage Tasks",
        "settings.roleAccess.cap.taskManagement.desc": "Create, edit, and schedule tasks for the team.",
        "settings.roleAccess.cap.taskMaintenance.title": "Manage Maintenance Tasks",
        "settings.roleAccess.cap.taskMaintenance.desc": "Create and update equipment maintenance tasks and schedules.",
        "settings.roleAccess.cap.calculator.title": "Use the Calculator",
        "settings.roleAccess.cap.calculator.desc": "Use the calculator tool to estimate system size and cost.",
        "settings.roleAccess.cap.catalog.title": "See the Catalog",
        "settings.roleAccess.cap.catalog.desc": "View the equipment list and pricing.",
        "settings.roleAccess.cap.projectCreate.title": "Add New Projects",
        "settings.roleAccess.cap.projectCreate.desc": "Create a brand-new project in the system.",
        "settings.roleAccess.cap.adminView.title": "Open Admin View",
        "settings.roleAccess.cap.adminView.desc": "Open Admin View to manage staff accounts.",
        "settings.roleAccess.cap.activityLog.title": "See Activity Log",
        "settings.roleAccess.cap.activityLog.desc": "View the history of actions taken across the dashboard.",
        "settings.roleAccess.cap.usersManage.title": "Manage User Accounts",
        "settings.roleAccess.cap.usersManage.desc": "Create, edit, or remove other people's accounts.",

        "settings.roleAccess.updateToast": "Permission updated",
        "settings.roleAccess.updateToastRole": "Permission updated for {role}",
        "settings.roleAccess.resetToast": "Reset to default permissions",
        "settings.roleAccess.loadFailedToast": "Couldn't load permissions from the server",

        "settings.roleAccess.addRole": "Add New Role",
        "settings.roleAccess.deleteRole": "Delete Role",
        "settings.roleAccess.modalCancel": "Cancel",
        "settings.roleAccess.addRoleModal.title": "Add New Role",
        "settings.roleAccess.addRoleModal.desc": "Give the new role a name. You can turn its permissions on afterward from the table.",
        "settings.roleAccess.addRoleModal.label": "Role name",
        "settings.roleAccess.addRoleModal.error": "Enter a role name that isn't already used.",
        "settings.roleAccess.addRoleModal.colorLabel": "Role color",
        "settings.roleAccess.addRoleModal.confirm": "Add Role",
        "settings.roleAccess.editRoleModal.title": "Rename Role",
        "settings.roleAccess.editRoleModal.desc": "Give this role a different display name. It only changes the label, not its permissions.",
        "settings.roleAccess.editRoleModal.label": "Role name",
        "settings.roleAccess.editRoleModal.error": "Enter a role name that isn't already used.",
        "settings.roleAccess.editRoleModal.confirm": "Save Name",
        "settings.roleAccess.deleteRoleModal.title": "Delete Role",
        "settings.roleAccess.deleteRoleModal.label": "Select role to delete",
        "settings.roleAccess.deleteRoleModal.warning": "This role and all its permissions will be permanently deleted. This can't be undone.",
        "settings.roleAccess.deleteRoleModal.confirm": "Delete Permanently",

        "logout.title": "Log Out",
        "logout.desc": "Are you sure you want to log out from your account?",
        "logout.cancel": "Cancel",
        "alert.title": "Alert Diagnosis",
        "alert.subtitle": "Live device alerts with transparent, ranked fault diagnosis — not just a threshold ping.",
        "alert.tabs.live": "Live Alerts",
        "alert.tabs.classifiers": "Classifiers",
        "alert.tabs.matrix": "Fault Encoding Matrix",
        "alert.tabs.versions": "Versions",
        "alert.stats.active": "Active",
        "alert.stats.acknowledged": "Acknowledged",
        "alert.stats.resolved": "Resolved",
        "alert.filters.allDevices": "All Devices",
        "alert.filters.allStatus": "All Status",
        "alert.status.active": "Active",
        "alert.status.acknowledged": "Acknowledged",
        "alert.status.resolved": "Resolved",
        "alert.status.dismissed": "Dismissed",
        "alert.toolbar.refresh": "Refresh",
        "alert.table.device": "Device",
        "alert.table.triggeredBy": "Triggered By",
        "alert.table.status": "Status",
        "alert.table.triggeredAt": "Triggered At",
        "alert.table.actions": "Actions",
        "alert.emptyState": "No alerts match this filter.",
        "alert.placeholder.comingSoon": "Coming in a later stage.",
        "alert.diagnosisModal.title": "Diagnosis",
        "alert.diagnosisModal.rankedFaults": "Ranked Fault Diagnosis",
        "alert.diagnosisModal.noDiagnosisYet": "Diagnosis for this alert is not available yet.",
        "alert.validation.title": "Expert Validation",
        "alert.validation.hint": "Confirm whether this diagnosis looks right — this feeds the prior probabilities for future alerts.",
        "alert.validation.accurate": "Seems Accurate",
        "alert.validation.wrong": "Seems Wrong",
        "alert.validation.resolvedFaultLabel": "Confirmed fault (optional)",
        "alert.validation.resolvedFaultNone": "— None / false alarm —",
        "alert.validation.notesLabel": "Notes",
        "alert.validation.notesPlaceholder": "Optional — what did you actually find?",
        "alert.validation.submit": "Submit Validation",

        "alert.classifiers.add": "Add Classifier",
        "alert.classifiers.emptyState": "No classifiers yet — add one to start detecting symptoms.",
        "alert.classifiers.table.name": "Name",
        "alert.classifiers.table.stream": "Data Stream",
        "alert.classifiers.table.condition": "Condition",
        "alert.classifiers.table.type": "Type",
        "alert.classifiers.table.status": "Status",
        "alert.classifiers.table.actions": "Actions",
        "alert.classifierModal.titleAdd": "Add Classifier",
        "alert.classifierModal.name": "Name",
        "alert.classifierModal.nameError": "Name is required.",
        "alert.classifierModal.mode": "Mode",
        "alert.classifierModal.modeThreshold": "Threshold",
        "alert.classifierModal.modeRateOfChange": "Rate of Change",
        "alert.classifierModal.type": "Type",
        "alert.classifierModal.typeRuleBased": "Rule-based",
        "alert.classifierModal.typeMlBased": "ML-based (coming soon)",
        "alert.classifierModal.ifSection": "IF",
        "alert.classifierModal.stream": "Data stream",
        "alert.classifierModal.operator": "Operator",
        "alert.classifierModal.compareTo": "Relative to",
        "alert.classifierModal.compareStatic": "A static value",
        "alert.classifierModal.compareStream": "Another data stream",
        "alert.classifierModal.compareValue": "Value",
        "alert.classifierModal.compareValueError": "A numeric value is required.",
        "alert.classifierModal.compareStreamSelect": "Compare to stream",
        "alert.classifierModal.forSection": "FOR",
        "alert.classifierModal.duration": "Duration (minutes)",
        "alert.classifierModal.minTrue": "Min. true",
        "alert.classifierModal.cancel": "Cancel",
        "alert.classifierModal.save": "Save Classifier",
        "alert.matrix.legend.present": "Present",
        "alert.matrix.legend.absent": "Absent",
        "alert.matrix.legend.unknown": "Unknown",
        "alert.matrix.hint": "Click a cell to cycle Present → Absent → Unknown.",
        "alert.matrix.qa.details": "Show details",
        "alert.matrix.aiPanel.title": "AI Review Queue",
        "alert.matrix.aiPanel.hint": "Draft suggestions — nothing applies live until you Submit Changes below.",
        "alert.matrix.aiPanel.empty": "No pending suggestions.",
        "alert.matrix.discard": "Discard",
        "alert.matrix.submit": "Submit Changes",

        "alert.versions.notesPlaceholder": "Notes for this snapshot (optional)",
        "alert.versions.saveCurrent": "Save Current as Version",
        "alert.versions.table.savedAt": "Saved At",
        "alert.versions.table.savedBy": "Saved By",
        "alert.versions.table.notes": "Notes",
        "alert.versions.table.actions": "Actions",
        "alert.versions.emptyState": "No saved versions yet.",
        "alert.confirm.cancel": "Cancel",
        "alert.confirm.confirm": "Confirm",

        "logout.confirm": "Log Out"
    },
    id: {
        "header.notif.title": "Notifikasi",
        "header.notif.markAll": "Tandai Semua Dibaca",
        "header.notif.empty": "Belum ada notifikasi",

        "sidebar.greeting.label": "Halo,",
        "sidebar.dashboard": "Dashboard",
        "sidebar.nav.monitoring": "Monitoring",
        "sidebar.nav.projectSelector": "Pemilih Proyek",
        "sidebar.nav.projectMonitoring": "Pemantauan Proyek",
        "sidebar.nav.systemInformation": "Informasi System",
        "sidebar.nav.alerts": "Peringatan",
        "sidebar.nav.taskMaintenance": "Pemeliharaan Tugas",
        "sidebar.nav.batteryStation": "Stasiun Baterai",
        "taskMaintenance.subtitle": "Daftar tugas maintenance yang ditugaskan kepada Anda. Terima tugas, perbarui progres pekerjaan, lalu kirim laporan hasil saat sudah selesai.",
        "activityLog.subtitle": "Halaman ini mencatat asal pengunjung, pergantian bahasa, login, logout, penggunaan kalkulator, dan ekspor laporan. Daftar aktivitas lengkap ada di bawah.",
        "marketing.metaOverview": "Ringkasan Meta Pixel",
        "marketing.subtitle": "Kartu ini menampilkan pengunjung dan konversi di halaman Kalkulator Solar. Data ini berasal dari event Meta Pixel di halaman tersebut.",
        "marketing.viewDetails": "Lihat Detail",
        "marketing.totalVisitors": "Total Pengunjung",
        "marketing.calculatorEngagement": "Interaksi Kalkulator",
        "marketing.calculateClicks": "Klik Hitung Estimasi",
        "marketing.leads": "Lead (Pengiriman Email)",
        "marketing.engagementRate": "Rasio interaksi",
        "marketing.engagedVisitors": "pengunjung yang berinteraksi ÷ total pengunjung",
        "marketing.conversionRate": "Rasio konversi",
        "marketing.leadsVisitors": "lead ÷ total pengunjung",
        "marketing.funnelTitle": "Funnel Pengunjung → Lead",
        "marketing.empty": "Belum ada event Meta Pixel yang tercatat. Angka akan muncul di sini saat seseorang mengunjungi halaman Kalkulator Solar.",
        "marketing.detailsTitle": "Detail Analitik Pemasaran",
        "sidebar.nav.tools": "Alat",
        "sidebar.nav.adminCalc": "Kalkulator Admin",
        "sidebar.nav.catalog": "Katalog",
        "sidebar.nav.addProject": "Tambah Proyek Baru",
        "sidebar.nav.administration": "Administrasi",
        "sidebar.nav.adminView": "Tampilan Admin",
        "sidebar.nav.marketing": "Pemasaran",
        "sidebar.nav.webdev": "Ticketing",
        "sidebar.nav.ticketing": "Ticketing",
        "sidebar.nav.others": "Lainnya",
        "sidebar.nav.setting": "Pengaturan",
        "sidebar.nav.logout": "Keluar",

        "ticketing.title": "Ticketing",
        "ticketing.subtitle": "Pantau dan kelola laporan kendala, perbaikan sistem, serta permintaan fitur antartim.",
        "ticketing.newTicket": "Ticket Baru",
        "ticketing.stats.total": "Total Ticket",
        "ticketing.stats.open": "Terbuka",
        "ticketing.stats.inProgress": "Sedang Dikerjakan",
        "ticketing.stats.waitingApproval": "Menunggu Approval",
        "ticketing.stats.resolved": "Selesai",
        "ticketing.stats.rejected": "Ditolak",
        "ticketing.heatmap.title": "Aktivitas Tiket",
        "ticketing.heatmap.subtitle": "Aktivitas harian pembuatan, pembaruan, dan penyelesaian tiket.",
        "ticketing.heatmap.mon": "Sen",
        "ticketing.heatmap.wed": "Rab",
        "ticketing.heatmap.fri": "Jum",
        "ticketing.heatmap.less": "Sedikit",
        "ticketing.heatmap.more": "Banyak",
        "ticketing.filters.allTypes": "Semua Tipe",
        "ticketing.filters.allStatus": "Semua Status",
        "ticketing.filters.allTeams": "Semua Tim",
        "ticketing.type.bug": "Bug",
        "ticketing.type.featureRequest": "Permintaan Fitur",
        "ticketing.type.uiUxFeedback": "Masukan UI/UX",
        "ticketing.type.dataIssue": "Masalah Data",
        "ticketing.type.performanceIssue": "Masalah Performa",
        "ticketing.type.question": "Pertanyaan",
        "ticketing.type.other": "Lainnya",
        "ticketing.priority.low": "Rendah",
        "ticketing.priority.medium": "Sedang",
        "ticketing.priority.high": "Tinggi",
        "ticketing.status.inProgress": "Sedang Dikerjakan",
        "ticketing.status.waitingApproval": "Menunggu Approval",
        "ticketing.status.resolved": "Selesai",
        "ticketing.status.rejected": "Ditolak",
        "ticketing.team.r1": "R1 - Hardware",
        "ticketing.team.r2": "R2 - Backend",
        "ticketing.team.r3": "R3 - Frontend",
        "ticketing.table.id": "Ticket",
        "ticketing.table.team": "Tim",
        "ticketing.table.type": "Tipe",
        "ticketing.table.priority": "Prioritas",
        "ticketing.table.status": "Status",
        "ticketing.table.submittedBy": "Dikirim Oleh",
        "ticketing.table.assignedTo": "Ditugaskan Ke",
        "ticketing.table.created": "Dibuat",
        "ticketing.table.actions": "Aksi",
        "ticketing.table.rowsPerPage": "Baris per halaman",
        "ticketing.table.rowsPerPageCustom": "Kustom...",
        "ticketing.emptyState": "Tidak ada tiket yang sesuai dengan filter saat ini.",
        "ticketing.createModal.title": "Buat Tiket Baru",
        "ticketing.createModal.titleLabel": "Judul",
        "ticketing.createModal.titleError": "Judul wajib diisi.",
        "ticketing.createModal.typeLabel": "Tipe",
        "ticketing.createModal.teamLabel": "Tim",
        "ticketing.createModal.priorityLabel": "Prioritas",
        "ticketing.createModal.pageLabel": "Halaman Terkait (opsional)",
        "ticketing.createModal.descLabel": "Deskripsi",
        "ticketing.createModal.descError": "Deskripsi wajib diisi.",
        "ticketing.createModal.attachmentLabel": "Lampiran (wajib)",
        "ticketing.createModal.attachmentPick": "Tambah file",
        "ticketing.createModal.attachmentNone": "Belum ada file dipilih",
        "ticketing.createModal.attachmentHint": "PDF, Word, video, atau gambar (maks. 10 file, 25 MB per file). Wajib untuk laporan kendala dan fitur.",
        "ticketing.createModal.attachmentError": "Minimal 1 file wajib diisi (maks. 10 file, masing-masing 25MB, hanya PDF/Word/video/gambar).",
        "ticketing.createModal.submitterHint": "Dikirim sebagai",
        "ticketing.createModal.cancel": "Batal",
        "ticketing.createModal.submit": "Kirim Tiket",
        "ticketing.detail.submittedBy": "Dikirim oleh",
        "ticketing.detail.attachment": "Lampiran",
        "ticketing.detail.relatedPage": "Halaman terkait",
        "ticketing.detail.created": "Dibuat",
        "ticketing.detail.updated": "Terakhir diperbarui",
        "ticketing.detail.assignedTo": "Ditugaskan ke",
        "ticketing.detail.status": "Status",
        "ticketing.detail.claim": "Assign ke saya",
        "ticketing.detail.save": "Simpan Perubahan",
        "ticketing.detail.comments": "Komentar",
        "ticketing.detail.commentsEmpty": "Belum ada komentar.",
        "ticketing.detail.commentSubmit": "Kirim Komentar",
        "ticketing.detail.delete": "Hapus tiket ini",
        "ticketing.deleteModal.title": "Hapus Tiket",
        "ticketing.deleteModal.text": "Tiket ini beserta lampiran dan seluruh komentarnya akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.",
        "ticketing.deleteModal.cancel": "Batal",
        "ticketing.deleteModal.confirm": "Hapus Permanen",
        "ticketing.createModal.descPlaceholder": "Jelaskan kendala, langkah terjadinya bug, atau detail kebutuhan fitur...",
        "ticketing.createModal.estimatedDaysPlaceholder": "Jumlah hari",
        "ticketing.createModal.pageError": "Halaman Terkait wajib diisi (kecuali tiket tipe Question/Other).",
        "ticketing.createModal.pageOtherPlaceholder": "Ketik nama halaman/fitur",
        "ticketing.createModal.titlePlaceholder": "Ringkasan singkat kendala atau perbaikan",
        "ticketing.detail.commentPlaceholder": "Tambahkan komentar atau update pekerjaan...",
        "ticketing.detail.dueDate": "Estimasi selesai",
        "ticketing.detail.dueDateClear": "Hapus Deadline",
        "ticketing.detail.dueDateDirectLabel": "Atau pilih tanggal pasti",
        "ticketing.detail.dueDateEstimatedDaysLabel": "Estimasi hari dari sekarang",
        "ticketing.detail.dueDateHint": "Khusus admin. Tenggat waktu normalnya dihitung otomatis dari estimasi jam kerja saat tiket dibuat.",
        "ticketing.detail.dueDateSave": "Simpan Deadline",
        "ticketing.detail.dueDateSection": "Penyesuaian Tenggat Waktu",
        "ticketing.detail.edit": "Edit",
        "ticketing.detail.editLog": "Histori",
        "ticketing.detail.editLogTitle": "Histori edit",
        "ticketing.detail.editLogBack": "Kembali ke versi terbaru",
        "ticketing.detail.copyLink": "Salin Link",
        "ticketing.detail.approve": "Approve & Selesaikan",
        "ticketing.detail.reject": "Tolak Tiket",
        "ticketing.detail.claimPanelTitle": "Ambil Tiket",
        "ticketing.detail.claimPanelHint": "Opsional: pilih rekan satu tim yang akan berkolaborasi mengerjakan tiket ini.",
        "ticketing.detail.claimCancel": "Batal",
        "ticketing.detail.claimConfirm": "Konfirmasi Ambil Tiket",
        "ticketing.detail.startTimer": "Mulai Mengerjakan",
        "ticketing.detail.expectedHours": "Expected time",
        "ticketing.detail.workedTime": "Waktu kerja",
        "ticketing.status.open": "Terbuka",
        "ticketing.leaderboard.title": "Papan Peringkat",
        "ticketing.leaderboard.subtitle": "Kontributor teratas berdasarkan penyelesaian tiket dan kecepatan pengerjaan.",
        "ticketing.leaderboard.empty": "Belum ada peringkat. Tiket yang telah diselesaikan akan muncul di sini.",
        "ticketing.leaderboard.pointsHelp.title": "Skema Poin",
        "ticketing.leaderboard.pointsHelp.bonusLabel": "Bonus kecepatan:",
        "ticketing.leaderboard.pointsHelp.bonusText": "Selesaikan sebelum target waktu untuk mendapatkan poin tambahan.",
        "ticketing.leaderboard.topPerformers": "Kontributor Terbaik",
        "ticketing.leaderboard.contenders": "Klasemen",
        "ticketing.createModal.expectedHoursLabel": "Target waktu (jam)",
        "ticketing.createModal.expectedHoursPlaceholder": "cth. 6",
        "ticketing.createModal.expectedHoursError": "Target waktu wajib diisi (bilangan bulat jam, minimal 1).",
        "ticketing.createModal.priorityTooltip": "Low: Kendala visual minor. Medium: Fitur terganggu, ada alternatif. High: Fitur utama tidak berfungsi. Critical: Sistem tidak dapat diakses atau risiko kehilangan data.",
        "ticketing.detail.waitingApprovalHint": "Ajukan peninjauan setelah selesai. Admin atau lead akan memeriksa dan memverifikasi hasil pengerjaan.",
        "ticketing.detail.resolutionViewTitle": "Bukti Penyelesaian",
        "ticketing.detail.resolutionAttachment": "File bukti",
        "ticketing.detail.resolutionInputTitle": "Bukti Penyelesaian",
        "ticketing.detail.resolutionInputHint": "Tulis ringkasan perbaikan dan lampirkan bukti pengerjaan sebelum mengajukan persetujuan.",
        "ticketing.detail.resolutionNoteLabel": "Ringkasan Penyelesaian",
        "ticketing.detail.resolutionNotePlaceholder": "Tuliskan perubahan atau solusi yang telah diterapkan...",
        "ticketing.detail.resolutionNoteError": "Deskripsi wajib diisi sebelum menandai tiket ini Menunggu Approval.",
        "ticketing.detail.resolutionAttachmentLabel": "File bukti (wajib)",
        "ticketing.detail.resolutionAttachmentHint": "PDF, Word, video, atau gambar (maks. 10 file, 25 MB per file). Minimal 1 file wajib diunggah.",
        "ticketing.detail.resolutionAttachmentError": "Minimal 1 file wajib diunggah (maks 10 file, 25MB per file, hanya PDF/Word/video/gambar).",
        "ticketing.priority.critical": "Kritis",
        "ticketing.searchPlaceholder": "Cari berdasarkan judul, pengirim, atau ID tiket...",
        "ticketing.table.due": "Tenggat",

        "settings.eyebrow": "Akun & Preferensi",
        "settings.title": "Pengaturan",
        "settings.subtitle": "Kelola tampilan, bahasa, dan keamanan akun 360eDash kamu di satu tempat.",

        "settings.tabs.appearance": "Tampilan",
        "settings.tabs.language": "Bahasa",
        "settings.tabs.profile": "Profil",
        "settings.tabs.account": "Akun",

        "settings.appearance.title": "Tampilan",
        "settings.appearance.desc": "Pilih tema tampilan yang paling nyaman di mata kamu.",
        "settings.appearance.light": "Mode Terang",
        "settings.appearance.dark": "Mode Gelap",
        "settings.appearance.system": "Sistem",
        "settings.appearance.soon": "Segera",
        "settings.appearance.hint": "Mode gelap disimpan sebagai preferensi kamu dan akan diterapkan ke seluruh dashboard secara bertahap.",
        "settings.appearance.darkToast": "Mode gelap diaktifkan",
        "settings.appearance.lightToast": "Mode terang diaktifkan",

        "settings.language.title": "Bahasa",
        "settings.language.desc": "Atur bahasa tampilan untuk seluruh menu dan label dashboard.",
        "settings.language.label": "Bahasa tampilan",
        "settings.language.hint": "Bahasa lain akan segera ditambahkan di update berikutnya.",
        "settings.language.toastEn": "Language changed to English",
        "settings.language.toastId": "Bahasa diubah ke Indonesia",

        "settings.profile.title": "Profil",
        "settings.profile.desc": "Perbarui informasi profil dan kontak yang tampil di akun kamu.",
        "settings.profile.changePhoto": "Ganti Foto",
        "settings.profile.removePhoto": "Hapus",
        "settings.profile.photoHint": "JPG atau PNG, maksimal 2MB.",
        "settings.profile.fullName": "Nama Lengkap",
        "settings.profile.email": "Email",
        "settings.profile.phone": "Nomor Telepon",
        "settings.profile.position": "Jabatan",
        "settings.profile.discard": "Batalkan",
        "settings.profile.save": "Simpan Perubahan",

        "settings.account.title": "Akun",
        "settings.account.desc": "Kelola username dan kata sandi untuk menjaga keamanan akun kamu.",
        "settings.account.username": "Username",
        "settings.account.currentPassword": "Kata Sandi Saat Ini",
        "settings.account.newPassword": "Kata Sandi Baru",
        "settings.account.confirmPassword": "Konfirmasi Kata Sandi",
        "settings.account.strength": "Kekuatan kata sandi",
        "settings.account.discard": "Batalkan",
        "settings.account.update": "Perbarui Kata Sandi",

        "maintenance.need.title": "Unit ini butuh maintenance?",
        "maintenance.need.desc": "Ajukan jadwal pemeliharaan atau lihat riwayat maintenance unit ini di halaman Manajemen Tugas.",
        "maintenance.need.button": "Ajukan Task Maintenance",

        "settings.errors.required": "Kolom ini wajib diisi.",
        "settings.errors.email": "Masukkan alamat email yang valid.",
        "settings.errors.phone": "Masukkan nomor telepon yang valid.",
        "settings.errors.password": "Minimal 8 karakter.",
        "settings.errors.confirmPassword": "Kata sandi tidak cocok.",

        "settings.tabs.roleAccess": "Akses Role",
        "settings.roleAccess.title": "Akses Role",
        "settings.roleAccess.hint": "Tiap kolom itu satu role di tim. Nyalakan toggle-nya kalau role itu boleh pakai fitur tersebut.",
        "settings.roleAccess.capabilityCol": "Fitur yang boleh dipakai",

        "settings.roleAccess.roles.bioflocLead": "Biofloc Intern Lead",
        "settings.roleAccess.roles.remsLead": "REMS Intern Lead",
        "settings.roleAccess.roles.bioflocIntern": "Biofloc Intern",
        "settings.roleAccess.roles.remsIntern": "REMS Intern",
        "settings.roleAccess.roles.operator": "Operator",
        "settings.roleAccess.roles.staff": "Staff",

        "settings.roleAccess.cap.dashboard.title": "Lihat Dashboard",
        "settings.roleAccess.cap.dashboard.desc": "Bisa buka halaman Dashboard utama dan lihat ringkasan produksi hari ini serta minggu ini.",
        "settings.roleAccess.cap.monitor.title": "Lihat Project Monitoring",
        "settings.roleAccess.cap.monitor.desc": "Bisa buka peta project dan cek kondisi tiap lokasi.",
        "settings.roleAccess.cap.battery.title": "Lihat Status Baterai",
        "settings.roleAccess.cap.battery.desc": "Bisa cek level dan kondisi baterai di halaman Battery Station.",
        "settings.roleAccess.cap.alert.title": "Tutup/Selesaikan Alert",
        "settings.roleAccess.cap.alert.desc": "Bisa menandai alert yang aktif sebagai sudah ditangani, jadi hilang dari daftar semua orang.",
        "settings.roleAccess.cap.taskManagement.title": "Kelola Tugas Tim",
        "settings.roleAccess.cap.taskManagement.desc": "Bisa membuat, mengubah, dan menjadwalkan tugas rutin untuk tim.",
        "settings.roleAccess.cap.taskMaintenance.title": "Kelola Tugas Maintenance",
        "settings.roleAccess.cap.taskMaintenance.desc": "Bisa membuat dan memperbarui jadwal perawatan peralatan.",
        "settings.roleAccess.cap.calculator.title": "Pakai Kalkulator",
        "settings.roleAccess.cap.calculator.desc": "Bisa pakai kalkulator untuk menghitung estimasi ukuran dan biaya sistem.",
        "settings.roleAccess.cap.catalog.title": "Lihat Katalog",
        "settings.roleAccess.cap.catalog.desc": "Bisa melihat daftar peralatan beserta harganya.",
        "settings.roleAccess.cap.projectCreate.title": "Tambah Project Baru",
        "settings.roleAccess.cap.projectCreate.desc": "Bisa membuat project baru di sistem.",
        "settings.roleAccess.cap.adminView.title": "Buka Admin View",
        "settings.roleAccess.cap.adminView.desc": "Bisa buka halaman Admin View untuk mengelola akun staff.",
        "settings.roleAccess.cap.activityLog.title": "Lihat Activity Log",
        "settings.roleAccess.cap.activityLog.desc": "Bisa melihat riwayat aktivitas yang terjadi di seluruh dashboard.",
        "settings.roleAccess.cap.usersManage.title": "Kelola Akun Pengguna",
        "settings.roleAccess.cap.usersManage.desc": "Bisa membuat, mengubah, atau menghapus akun orang lain.",

        "settings.roleAccess.updateToast": "Permission berhasil diperbarui",
        "settings.roleAccess.updateToastRole": "Permission untuk {role} berhasil diperbarui",
        "settings.roleAccess.resetToast": "Permission dikembalikan ke default",
        "settings.roleAccess.loadFailedToast": "Gagal memuat permission dari server",

        "settings.roleAccess.addRole": "Tambah Role Baru",
        "settings.roleAccess.deleteRole": "Hapus Role",
        "settings.roleAccess.modalCancel": "Batal",
        "settings.roleAccess.addRoleModal.title": "Tambah Role Baru",
        "settings.roleAccess.addRoleModal.desc": "Beri nama role baru. Kamu bisa atur izin aksesnya langsung dari tabel setelah dibuat.",
        "settings.roleAccess.addRoleModal.label": "Nama role",
        "settings.roleAccess.addRoleModal.error": "Nama role wajib diisi dan belum dipakai.",
        "settings.roleAccess.addRoleModal.colorLabel": "Warna role",
        "settings.roleAccess.addRoleModal.confirm": "Tambah Role",
        "settings.roleAccess.editRoleModal.title": "Ganti Nama Role",
        "settings.roleAccess.editRoleModal.desc": "Ubah nama tampilan role ini. Cuma nama yang berubah, izin aksesnya tetap sama.",
        "settings.roleAccess.editRoleModal.label": "Nama role",
        "settings.roleAccess.editRoleModal.error": "Nama role wajib diisi dan belum dipakai.",
        "settings.roleAccess.editRoleModal.confirm": "Simpan Nama",
        "settings.roleAccess.deleteRoleModal.title": "Hapus Role",
        "settings.roleAccess.deleteRoleModal.label": "Pilih role yang mau dihapus",
        "settings.roleAccess.deleteRoleModal.warning": "Role dan seluruh izinnya akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.",
        "settings.roleAccess.deleteRoleModal.confirm": "Hapus Permanen",

        "logout.title": "Keluar",
        "logout.desc": "Yakin ingin keluar dari akun kamu?",
        "logout.cancel": "Batal",
        "alert.title": "Diagnosis Alert",
        "alert.subtitle": "Alert perangkat langsung dengan diagnosis fault yang transparan dan ter-ranking — bukan cuma ping ambang batas.",
        "alert.tabs.live": "Alert Aktif",
        "alert.tabs.classifiers": "Classifier",
        "alert.tabs.matrix": "Matrix Fault Encoding",
        "alert.tabs.versions": "Versi",
        "alert.stats.active": "Aktif",
        "alert.stats.acknowledged": "Diketahui",
        "alert.stats.resolved": "Selesai",
        "alert.filters.allDevices": "Semua Device",
        "alert.filters.allStatus": "Semua Status",
        "alert.status.active": "Aktif",
        "alert.status.acknowledged": "Diketahui",
        "alert.status.resolved": "Selesai",
        "alert.status.dismissed": "Diabaikan",
        "alert.toolbar.refresh": "Muat Ulang",
        "alert.table.device": "Device",
        "alert.table.triggeredBy": "Dipicu Oleh",
        "alert.table.status": "Status",
        "alert.table.triggeredAt": "Waktu Dipicu",
        "alert.table.actions": "Aksi",
        "alert.emptyState": "Tidak ada alert yang cocok dengan filter ini.",
        "alert.placeholder.comingSoon": "Segera hadir di tahap berikutnya.",
        "alert.diagnosisModal.title": "Diagnosis",
        "alert.diagnosisModal.rankedFaults": "Diagnosis Fault Ter-ranking",
        "alert.diagnosisModal.noDiagnosisYet": "Diagnosis untuk alert ini belum tersedia.",
        "alert.validation.title": "Validasi Expert",
        "alert.validation.hint": "Konfirmasi apakah diagnosis ini sudah tepat — ini jadi bahan prior probability buat alert selanjutnya.",
        "alert.validation.accurate": "Sudah Tepat",
        "alert.validation.wrong": "Kurang Tepat",
        "alert.validation.resolvedFaultLabel": "Fault yang dikonfirmasi (opsional)",
        "alert.validation.resolvedFaultNone": "— Tidak ada / alarm palsu —",
        "alert.validation.notesLabel": "Catatan",
        "alert.validation.notesPlaceholder": "Opsional — apa yang beneran ditemukan?",
        "alert.validation.submit": "Kirim Validasi",

        "alert.classifiers.add": "Tambah Classifier",
        "alert.classifiers.emptyState": "Belum ada classifier — tambah satu buat mulai deteksi gejala.",
        "alert.classifiers.table.name": "Nama",
        "alert.classifiers.table.stream": "Data Stream",
        "alert.classifiers.table.condition": "Kondisi",
        "alert.classifiers.table.type": "Tipe",
        "alert.classifiers.table.status": "Status",
        "alert.classifiers.table.actions": "Aksi",
        "alert.classifierModal.titleAdd": "Tambah Classifier",
        "alert.classifierModal.name": "Nama",
        "alert.classifierModal.nameError": "Nama wajib diisi.",
        "alert.classifierModal.mode": "Mode",
        "alert.classifierModal.modeThreshold": "Threshold",
        "alert.classifierModal.modeRateOfChange": "Rate of Change",
        "alert.classifierModal.type": "Tipe",
        "alert.classifierModal.typeRuleBased": "Rule-based",
        "alert.classifierModal.typeMlBased": "ML-based (segera hadir)",
        "alert.classifierModal.ifSection": "JIKA",
        "alert.classifierModal.stream": "Data stream",
        "alert.classifierModal.operator": "Operator",
        "alert.classifierModal.compareTo": "Relatif terhadap",
        "alert.classifierModal.compareStatic": "Nilai statis",
        "alert.classifierModal.compareStream": "Data stream lain",
        "alert.classifierModal.compareValue": "Nilai",
        "alert.classifierModal.compareValueError": "Nilai angka wajib diisi.",
        "alert.classifierModal.compareStreamSelect": "Bandingkan ke stream",
        "alert.classifierModal.forSection": "SELAMA",
        "alert.classifierModal.duration": "Durasi (menit)",
        "alert.classifierModal.minTrue": "Min. true",
        "alert.classifierModal.cancel": "Batal",
        "alert.classifierModal.save": "Simpan Classifier",
        "alert.matrix.legend.present": "Present",
        "alert.matrix.legend.absent": "Absent",
        "alert.matrix.legend.unknown": "Unknown",
        "alert.matrix.hint": "Klik sebuah sel buat siklus Present → Absent → Unknown.",
        "alert.matrix.qa.details": "Tampilkan detail",
        "alert.matrix.aiPanel.title": "Antrean Review AI",
        "alert.matrix.aiPanel.hint": "Draft saran — belum berlaku sampai kamu klik Submit Changes di bawah.",
        "alert.matrix.aiPanel.empty": "Tidak ada saran yang menunggu.",
        "alert.matrix.discard": "Batalkan",
        "alert.matrix.submit": "Submit Perubahan",

        "alert.versions.notesPlaceholder": "Catatan untuk snapshot ini (opsional)",
        "alert.versions.saveCurrent": "Simpan Kondisi Sekarang sebagai Versi",
        "alert.versions.table.savedAt": "Disimpan Pada",
        "alert.versions.table.savedBy": "Disimpan Oleh",
        "alert.versions.table.notes": "Catatan",
        "alert.versions.table.actions": "Aksi",
        "alert.versions.emptyState": "Belum ada versi tersimpan.",
        "alert.confirm.cancel": "Batal",
        "alert.confirm.confirm": "Konfirmasi",

        "logout.confirm": "Keluar"
    }
};


// ============================================================
// Global UI translations for pages that contain legacy/static text
// without data-i18n attributes. This keeps the existing translation
// architecture intact while making the language switch universal.
// ============================================================
const uiTextTranslations = [
    ["Total Alerts", "Total Peringatan"],
    ["High", "Tinggi"],
    ["Medium", "Sedang"],
    ["Low", "Rendah"],
    ["Alert", "Peringatan"],

    ["Alert", "Peringatan"],
    ["Active issues across your projects", "Masalah aktif di seluruh proyek Anda"],
    ["Project Overview", "Ringkasan Proyek"],
    ["Battery Station", "Stasiun Baterai"],
    ["Battery Swapping Station", "Stasiun Penukaran Baterai"],
    ["Charging Schedule", "Jadwal Pengisian"],
    ["Battery Slot Status", "Status Slot Baterai"],
    ["Swap History", "Riwayat Swap"],
    ["24-Hour Charging Schedule", "Tabel Waktu Pengisian (24 Jam)"],
    ["Charging – Solar", "Mengisi – Solar"],
    ["Charging – Grid", "Mengisi – Grid"],
    ["Charging – Hybrid", "Mengisi – Hybrid"],
    ["Charging", "Mengisi"],
    ["Charging Power", "Mengisi Daya"],
    ["Ready to Swap", "Siap Ditukar"],
    ["In Use", "Digunakan"],
    ["Idle", "Idle"],
    ["No data", "Tidak ada data"],
    ["Recently swapped", "Baru saja ditukar"],
    ["Add New System", "Tambah Sistem Baru"],
    ["Fill in the project details and system specifications below.", "Isi detail proyek dan spesifikasi sistem di bawah ini."],
    ["Project Details", "Detail Proyek"],
    ["Project Name", "Nama Proyek"],
    ["Project Location", "Lokasi Proyek"],
    ["Time Zone", "Zona Waktu"],
    ["GMT+7 — WIB (Jakarta)", "GMT+7 — WIB (Jakarta)"],
    ["Latitude", "Lintang"],
    ["Longitude", "Bujur"],
    ["Project Partner", "Mitra Proyek"],
    ["Partner Type", "Jenis Mitra"],
    ["Company", "Perusahaan"],
    ["Project System", "Sistem Proyek"],
    ["Project Schema", "Skema Proyek"],
    ["Direct Purchase", "Pembelian Langsung"],
    ["Project Type", "Jenis Proyek"],
    ["Default", "Default"],
    ["Inverter #1", "Inverter #1"],
    ["Add New Inverter", "Tambah Inverter Baru"],
    ["Inverter #1 Details", "Detail Inverter #1"],
    ["Inverter Brand", "Merek Inverter"],
    ["Max Output (kW)", "Output Maksimal (kW)"],
    ["Communicational Protocol", "Protokol Komunikasi"],
    ["Inverter Manual (PDF)", "Manual Inverter (PDF)"],
    ["Choose File", "Pilih File"],
    ["No file chosen", "Tidak ada file yang dipilih"],
    ["Solar Panel Properties", "Properti Panel Surya"],
    ["Model", "Model"],
    ["PV Installed (kW)", "PV Terpasang (kW)"],
    ["PV Installed", "PV Terpasang"],
    ["Panel Size (W)", "Ukuran Panel (W)"],
    ["Cell Type", "Jenis Sel"],
    ["Monocrystalline", "Monokristalin"],
    ["Admin View", "Tampilan Admin"],
    ["Administration", "Administrasi"],
    ["Manage user accounts, access rights, and project assignments on the 360eDash platform.", "Kelola akun pengguna, hak akses, dan penugasan proyek di platform 360eDash."],
    ["Total Users", "Total Pengguna"],
    ["Search by username, email, or User Id...", "Cari berdasarkan username, email, atau ID Pengguna..."],
    ["All Roles", "Semua Peran"],
    ["Create User", "Buat Pengguna"],
    ["User", "Pengguna"],
    ["Email", "Email"],
    ["User Id", "ID Pengguna"],
    ["Role", "Peran"],
    ["Projects", "Proyek"],
    ["Actions", "Aksi"],
    ["Manage Projects", "Kelola Proyek"],
    ["Showing 10 of 29 users", "Menampilkan 10 dari 29 pengguna"],
    ["First", "Pertama"],
    ["Prev", "Sebelumnya"],
    ["Next", "Berikutnya"],
    ["Last", "Terakhir"],
    ["Activity Log", "Log Aktivitas"],
    ["Monitor user activity history on the dashboard — login, logout, and use of Solar Calculator or Admin Calculator.", "Pantau riwayat aktivitas pengguna di dashboard — login, logout, dan penggunaan Solar Calculator maupun Admin Calculator."],
    ["Refresh", "Segarkan"],
    ["Export CSV", "Ekspor CSV"],
    ["Search", "Cari"],
    ["Search name, email, or activity details...", "Cari nama, email, atau detail aktivitas..."],
    ["Search name, email, or activity detail...", "Cari nama, email, atau detail aktivitas..."],
    ["Activity Type", "Tipe Aktivitas"],
    ["All Types", "Semua Tipe"],
    ["Status", "Status"],
    ["All Statuses", "Semua Status"],
    ["Date Range", "Rentang Tanggal"],
    ["Reset Filter", "Atur Ulang Filter"],
    ["Activity History", "Riwayat Aktivitas"],
    ["0 activities", "0 aktivitas"],
    ["No activities match the current filters.", "Tidak ada aktivitas yang cocok dengan filter ini."],
    ["Showing 0-0 of 0 activities", "Menampilkan 0-0 dari 0 aktivitas"],
    ["Project Locations", "Lokasi Proyek"],
    ["All Projects", "Semua Proyek"],
    ["Online", "Online"],
    ["Offline", "Offline"],
    ["Active Alerts", "Peringatan Aktif"],
    ["Category", "Kategori"],
    ["Solar Fish Farm", "Solar Fish Farm"],
    ["Solar BSS", "Solar BSS"],
    ["Today's Generation", "Produksi Hari Ini"],
    ["Generated", "Dihasilkan"],
    ["Installed", "Terpasang"],
    ["CO2 Avoided", "CO2 Dihindari"],
    ["Saved Projects", "Proyek Tersimpan"],
    ["Name", "Nama"],
    ["Location", "Lokasi"],
    ["Action", "Aksi"],
    ["Search project...", "Cari proyek..."],
    ["System Information", "Informasi Sistem"],
    ["Manage all installed solar PV systems — connection status, inverters, panels, and maintenance schedules.", "Kelola seluruh system PLTS yang terpasang — status koneksi, inverter, panel, dan jadwal pemeliharaan."],
    ["Add System", "Tambah Sistem"],
    ["Total Devices", "Total Perangkat"],
    ["Connected", "Terhubung"],
    ["Pending", "Menunggu"],
    ["Task Management", "Manajemen Tugas"],
    ["Manage upcoming maintenance schedules and view maintenance history for all PV system units in this project.", "Kelola jadwal pemeliharaan mendatang dan lihat riwayat pemeliharaan untuk seluruh unit PLTS pada project ini."],
    ["Upcoming Maintenance", "Jadwal Mendatang"],
    ["High Priority", "Prioritas Tinggi"],
    ["Completed History", "Riwayat Selesai"],
    ["Future Maintenance", "Pemeliharaan Mendatang"],
    ["Historical Maintenance", "Riwayat Pemeliharaan"],
    ["All Units", "Semua Unit"],
    ["Add Problematic Unit", "Tambah Unit Bermasalah"],
    ["Upcoming Maintenance (4)", "Jadwal Mendatang (4)"],
    ["Scheduled Maintenance", "Pemeliharaan Terjadwal"],
    ["Receive panel cleaning and improve efficiency.", "Lakukan pembersihan panel dan tingkatkan efisiensi."],
    ["Routine panel cleaning and inspect efficiency.", "Lakukan pembersihan panel rutin dan periksa efisiensi."],
    ["Inverter inspection to ensure optimal energy conversion performance.", "Periksa inverter untuk memastikan kinerja konversi energi optimal."],
    ["Check battery capacity and terminal connections.", "Periksa kapasitas baterai dan koneksi terminal."],
    ["Bring a multimeter and hydrometer.", "Bawa multimeter dan hydrometer."],
    ["Bring standard cleaning tools.", "Bawa alat pembersih standar."],
    ["Initial off-grid installation inspection", "Pemeriksaan awal instalasi off-grid"],
    ["Standard verification after new installation.", "Verifikasi standar setelah pemasangan baru."],
    ["Output voltage testing, charge controller calibration, full load test.", "Pengujian tegangan output, kalibrasi charge controller, uji beban penuh."],
    ["System running normally, routine check scheduled every 3 months.", "Sistem berjalan normal, dijadwalkan cek rutin tiap 3 bulan."],
    ["Panel cleaning to restore efficiency and improve output", "Pembersihan panel untuk memulihkan efisiensi dan meningkatkan output"],
    ["Dust build-up caused output to drop by 12%.", "Penumpukan debu menyebabkan output turun 12%."],
    ["Cleaned all panel surfaces with soft-bristle brush and demineralized water; re-checked wiring connections.", "Membersihkan seluruh permukaan panel dengan sikat berbulu lembut dan air demineralisasi; memeriksa ulang koneksi kabel."],
    ["Monthly cleaning schedule recommended during dry season.", "Jadwal pembersihan bulanan disarankan selama musim kemarau."],
    ["Inverter inspection to optimal energy conversion performance", "Pemeriksaan inverter untuk kinerja konversi energi optimal"],
    ["Inverter reported minor voltage fluctuation warning on communication panel.", "Inverter melaporkan peringatan fluktuasi tegangan kecil pada panel komunikasi."],
    ["Recalibrated voltage thresholds, tightened terminal connections, updated firmware.", "Mengkalibrasi ulang ambang tegangan, mengencangkan koneksi terminal, memperbarui firmware."],
    ["Monitor for one week to confirm stability.", "Pantau selama satu minggu untuk memastikan stabilitas."],
    ["Medium", "Sedang"],
    ["High", "Tinggi"],
    ["Low", "Rendah"],
    ["Add New Alert", "Tambah Peringatan Baru"],
    ["Alert Type", "Jenis Peringatan"],
    ["Alert Detail", "Detail Peringatan"],
    ["Actions", "Aksi"],
    ["Select Alert Type", "Pilih Jenis Peringatan"],
    ["Location / Video Call", "Lokasi / Panggilan Video"],
    ["Alert / Reminder", "Peringatan / Pengingat"],
    ["Project System(s)", "Sistem Proyek"],
    ["Add Alert", "Tambah Peringatan"],
    ["Edit Alert", "Edit Peringatan"],
    ["Next", "Berikutnya"],
    ["System Name", "Nama Sistem"],
    ["Installed Date", "Tanggal Pemasangan"],
    ["Last Updated", "Terakhir Diperbarui"],
    ["Last Maintenance", "Pemeliharaan Terakhir"],
    ["Next Maintenance", "Pemeliharaan Berikutnya"],
    ["Action Taken", "Tindakan yang Dilakukan"],
    ["Maintenance Detail", "Detail Pemeliharaan"],
    ["Maintenance Log Detail", "Detail Log Pemeliharaan"],
    ["Complete information about the scheduled maintenance.", "Informasi lengkap jadwal pemeliharaan."],
    ["Complete history of completed maintenance work.", "Riwayat lengkap pekerjaan pemeliharaan yang telah diselesaikan."],
    ["Select the unit that needs maintenance and fill in the schedule.", "Pilih unit yang membutuhkan maintenance dan lengkapi jadwalnya."],
    ["Items Purchased", "Barang yang Dibeli"],
    ["Documentation Photos", "Foto Dokumentasi"],
    ["Cost", "Biaya"],
    ["Assign Technician", "Tetapkan Teknisi"],
    ["Assigned Technician", "Teknisi yang Ditugaskan"],
    ["Hardware Expenses", "Biaya Hardware"],
    ["Software Costs", "Biaya Software"],
    ["Transportation Costs", "Biaya Transportasi"],
    ["Edit Schedule", "Edit Jadwal"],
    ["Close", "Tutup"],
    ["Cancel", "Batal"],
    ["Save", "Simpan"],
    ["Delete", "Hapus"],
    ["Total Cost", "Total Biaya"],
    ["Unit / System", "Unit / Sistem"],
    ["Select unit", "Pilih unit"],
    ["Select technician", "Pilih teknisi"],
    ["Other...", "Lainnya..."],
    ["Other technician name", "Nama teknisi lain"],
    ["Additional notes (optional)", "Catatan tambahan (opsional)"],
    ["Describe the problem / work in detail...", "Jelaskan detail masalah / pekerjaan..."],
    ["e.g. Unstable inverter", "Contoh: Inverter tidak stabil"],
    ["e.g. 2x MC4 Connectors, 1x 4mm NYAF Cable, 1x 10A Fuse", "Contoh: 2x MC4 Connector, 1x Kabel NYAF 4mm, 1x Fuse 10A"],
    ["Unit is required.", "Unit wajib dipilih."],
    ["Scheduled Date is required.", "Scheduled Date wajib diisi."],
    ["Documentation photo", "Foto dokumentasi"],
    ["No upcoming maintenance scheduled yet.", "Belum ada jadwal maintenance mendatang."],
    ["No maintenance history yet.", "Belum ada riwayat maintenance."],
    ["Maintenance schedule deleted.", "Jadwal maintenance dihapus."],
    ["Maintenance schedule saved.", "Jadwal maintenance disimpan."],
    ["Project", "Proyek"],
    ["Live monitoring", "Monitoring langsung"],
    ["PROJECT OVERVIEW", "RINGKASAN PROYEK"],
    ["Installed Capacity", "Kapasitas Terpasang"],
    ["PV Panels", "Panel PV"],
    ["Commissioned", "Mulai Beroperasi"],
    ["Last data update", "Pembaruan data terakhir"],
    ["PV Health", "Kesehatan PV"],
    ["Healthy", "Sehat"],
    ["All panels operating normally", "Semua panel beroperasi normal"],
    ["Current Power", "Daya Saat Ini"],
    ["vs yesterday", "dibanding kemarin"],
    ["Today's Energy", "Energi Hari Ini"],
    ["Expected", "Ekspektasi"],
    ["Performance Ratio", "Rasio Performa"],
    ["this week", "minggu ini"],
    ["Actual vs Expected", "Aktual vs Ekspektasi"],
    ["Actual", "Aktual"],
    ["Energy Production", "Produksi Energi"],
    ["need attention", "perlu perhatian"],
    ["Critical", "Kritis"],
    ["Warning", "Peringatan"],
    ["View all alerts", "Lihat semua peringatan"],
    ["Notifications", "Notifikasi"],
    ["Delivery status", "Status pengiriman"],
    ["notifications sent today", "notifikasi dikirim hari ini"],
    ["Maintenance reminder", "Pengingat pemeliharaan"],
    ["Weather", "Cuaca"],
    ["Partly Cloudy", "Berawan Sebagian"],
    ["Humidity", "Kelembapan"],
    ["Solar Irradiance", "Iradiasi Surya"],
    ["Energy Summary", "Ringkasan Energi"],
    ["Production overview", "Ringkasan produksi"],
    ["Today", "Hari Ini"],
    ["This Week", "Minggu Ini"],
    ["This Month", "Bulan Ini"],
    ["Lifetime", "Total"],
    ["Battery Summary", "Ringkasan Baterai"],
    ["Station status", "Status stasiun"],
    ["Health", "Kesehatan"],
    ["Good", "Baik"],
    ["Online units", "Unit online"],
    ["View Battery Station", "Lihat Battery Station"],
    ["Inverter Status", "Status Inverter"],
    ["Power conversion", "Konversi daya"],
    ["Output", "Output"],
    ["Efficiency", "Efisiensi"],
    ["Temperature", "Suhu"],
    ["View System Information", "Lihat Informasi Sistem"],
    ["System Health", "Kesehatan Sistem"],
    ["Device status", "Status perangkat"],
    ["PV Panel", "Panel PV"],
    ["Inverter", "Inverter"],
    ["Battery", "Baterai"],
    ["Gateway", "Gateway"],
    ["Normal", "Normal"],
    ["Recent Activity", "Aktivitas Terbaru"],
    ["Latest project events", "Kejadian proyek terbaru"],
    ["Inverter back online", "Inverter kembali online"],
    ["System connection restored", "Koneksi sistem dipulihkan"],
    ["Battery charging started", "Pengisian baterai dimulai"],
    ["Battery station entered charging cycle", "Stasiun baterai memasuki siklus pengisian"],
    ["Warning cleared", "Peringatan telah ditangani"],
    ["Panel temperature returned to normal", "Suhu panel kembali normal"],
    ["Yesterday", "Kemarin"],
    ["Maintenance completed", "Pemeliharaan selesai"],
    ["Routine inspection completed", "Pemeriksaan rutin selesai"],

];


// Additional universal translations for page content that is rendered by
// individual page HTML/JS files without data-i18n attributes.
// Keep these as EN/ID pairs so the same text can switch in both directions.
const additionalUiTextTranslations = [
    ["Open menu", "Buka menu"],
    ["Toggle light/dark mode", "Ganti mode terang/gelap"],
    ["Download CSV", "Unduh CSV"],
    ["Details", "Detail"],
    ["System Activity Log", "Log Aktivitas Sistem"],
    ["Marketing Analytics", "Analitik Pemasaran"],
    ["View Details", "Lihat Detail"],
    ["Reset", "Atur Ulang"],
    ["Monitor and manage all active alerts from all ongoing projects.", "Pantau dan kelola seluruh alert aktif dari semua proyek yang sedang berjalan."],
    ["Search by Project Name", "Cari berdasarkan Nama Proyek"],
    ["Newest", "Terbaru"],
    ["Latest", "Terakhir"],
    ["Add Alert", "Tambah Peringatan"],

    ["Dashboard Activity Analytics", "Analitik Aktivitas Dashboard"],
    ["Infographic overview of the dashboard's core activity — visitor origin, language switch, login/logout, calculator simulation, and monthly report export — plus the full user activity history below.", "Ringkasan infografis aktivitas utama dashboard — asal pengunjung, pergantian bahasa, login/logout, simulasi kalkulator, dan ekspor laporan bulanan — beserta riwayat aktivitas pengguna lengkap di bawah ini."],
    ["Total Visitors", "Total Pengunjung"],
    ["From Indonesia", "Dari Indonesia"],
    ["Login Activity", "Aktivitas Login"],
    ["Simulated Calculator Usage", "Penggunaan Kalkulator Simulasi"],
    ["Activity Summary", "Ringkasan Aktivitas"],
    ["Activity Trend", "Tren Aktivitas"],
    ["last 30 days", "30 hari terakhir"],
    ["Tick a row to plot it on the chart below.", "Centang baris untuk menampilkannya pada grafik di bawah."],
    ["Activity Type", "Tipe Aktivitas"],
    ["Detail", "Detail"],
    ["In Range", "Dalam Rentang"],
    ["Past Day", "Hari Lalu"],
    ["Past Week", "Minggu Lalu"],
    ["Chart Type", "Tipe Grafik"],
    ["Export Data", "Ekspor Data"],
    ["From", "Dari"],
    ["to", "sampai"],
    ["Quick range", "Rentang cepat"],
    ["Visitors", "Pengunjung"],
    ["Session", "Sesi"],
    ["Tool", "Alat"],
    ["Export", "Ekspor"],
    ["Language", "Bahasa"],
    ["Solar Calculator", "Kalkulator Solar"],
    ["Admin Calculator", "Kalkulator Admin"],
    ["Export Report", "Ekspor Laporan"],
    ["Other", "Lainnya"],
    ["All Countries", "Semua Negara"],
    ["All Status", "Semua Status"],
    ["All Types", "Semua Tipe"],
    ["Country of Origin", "Asal Negara"],
    ["Device & IP", "Perangkat & IP"],
    ["Time", "Waktu"],
    ["User", "Pengguna"],
    ["Success", "Berhasil"],
    ["Failed", "Gagal"],
    ["No activity matches this filter.", "Tidak ada aktivitas yang cocok dengan filter ini."],
    ["Rows per page", "Baris per halaman"],
    ["No Meta Pixel events recorded yet. Numbers will appear here as soon as someone visits the Solar Calculator page.", "Belum ada event Meta Pixel yang tercatat. Angka akan muncul di sini saat seseorang mengunjungi halaman Kalkulator Solar."],
    ["Solar Calculator visitor & conversion funnel, sourced from the Meta Pixel events already firing on that page.", "Funnel pengunjung dan konversi Kalkulator Solar, bersumber dari event Meta Pixel yang sudah berjalan di halaman tersebut."],
    ["Meta Pixel Overview", "Ringkasan Meta Pixel"],
    ["Calculator Engagement", "Interaksi Kalkulator"],
    ["Calculate Estimate Clicks", "Klik Hitung Estimasi"],
    ["Leads (Email Submissions)", "Lead (Pengiriman Email)"],
    ["Engagement rate", "Rasio interaksi"],
    ["Conversion rate", "Rasio konversi"],
    ["engaged visitors ÷ total visitors", "pengunjung yang berinteraksi ÷ total pengunjung"],
    ["leads ÷ total visitors", "lead ÷ total pengunjung"],
    ["Marketing Analytics Details", "Detail Analitik Pemasaran"],
    ["Meta Pixel Overview", "Ringkasan Meta Pixel"],
    ["Total Visitors", "Total Pengunjung"],
    ["Calculator Engagement", "Interaksi Kalkulator"],
    ["Calculate Estimate Clicks", "Klik Hitung Estimasi"],
    ["Leads (Email Submissions)", "Lead (Pengiriman Email)"],
    ["Engagement rate", "Rasio interaksi"],
    ["Conversion rate", "Rasio konversi"],
    ["engaged visitors ÷ total visitors", "pengunjung yang berinteraksi ÷ total pengunjung"],
    ["leads ÷ total visitors", "lead ÷ total pengunjung"],
    ["Visitor → Lead Funnel", "Funnel Pengunjung → Lead"],
    ["Visitors (PageView)", "Pengunjung (PageView)"],
    ["Calculate Estimate", "Hitung Estimasi"],
    ["Leads", "Lead"],
    ["View Details", "Lihat Detail"],
    ["No Meta Pixel events recorded in this period.", "Tidak ada event Meta Pixel yang tercatat pada periode ini."],
    ["Period & Data Used", "Periode & Data yang Digunakan"],
    ["Date range", "Rentang tanggal"],
    ["Total Meta Pixel events", "Total event Meta Pixel"],
    ["Data source", "Sumber data"],
    ["Meta Pixel event mirror (our own server)", "Mirror event Meta Pixel (server kami)"],
    ["Metrics", "Metrik"],
    ["Raw Event Breakdown", "Rincian Event Mentah"],
    ["How This Data Is Collected", "Cara Data Ini Dikumpulkan"],
    ["Page View (visited Solar Calculator)", "Page View (mengunjungi Kalkulator Solar)"],
    ["Calculate Estimate click", "Klik Hitung Estimasi"],
    ["Calculate Estimate click (custom event)", "Klik Hitung Estimasi (event khusus)"],
    ["Calculator field changed", "Kolom kalkulator berubah"],
    ["Battery scenario toggled", "Skenario baterai diubah"],
    ["Lead (email submitted)", "Lead (email terkirim)"],
    ["Switched dashboard language to Indonesian", "Beralih ke bahasa Indonesia"],
    ["Switched dashboard language to English", "Beralih ke bahasa Inggris"],

    ["Total Activity", "Total Aktivitas"],
    ["Activity Detail", "Detail Aktivitas"],
    ["Showing 0-0 of 0 activities", "Menampilkan 0-0 dari 0 aktivitas"],
    ["Loading activity log…", "Memuat log aktivitas…"],
    ["Couldn't reach the Activity Log backend. Make sure server/server.js is running, then click Refresh.", "Tidak dapat menghubungi backend Log Aktivitas. Pastikan server/server.js sedang berjalan, lalu klik Segarkan."],
    ["Set a valid date range first.", "Atur rentang tanggal yang valid terlebih dahulu."],
    ["Tick at least one activity to export.", "Centang setidaknya satu aktivitas untuk diekspor."],
    ["Tick a row above to plot it.", "Centang baris di atas untuk menampilkannya pada grafik."],
    ["Add Row", "Tambah Baris"],
    ["Add Alert", "Tambah Peringatan"],
    ["Upload CSV", "Unggah CSV"],
    ["CSV upload format:", "Format unggah CSV:"],
    ["plus optional technical specification columns", "ditambah kolom spesifikasi teknis opsional"],
    ["only fill in values relevant to that category, the rest may be left blank.", "isi hanya nilai yang relevan untuk kategori tersebut, sisanya boleh dikosongkan."],
    ["Data uploaded will be added to existing data (old data will not be deleted).", "Data yang diunggah akan ditambahkan ke data yang sudah ada (data lama tidak akan dihapus)."],
    ["Delete this row?", "Hapus baris ini?"],
    ["The following data will be permanently deleted:", "Data berikut akan dihapus secara permanen:"],
    ["Add Row", "Tambah Baris"],
    ["Cancel", "Batal"],
    ["Delete", "Hapus"],
    ["Work completed 100%.", "Pekerjaan selesai 100%."],
    ["Cleaning panel surfaces & checking cables.", "Sedang membersihkan permukaan panel & cek kabel."],
    ["Cleaning completed, final efficiency check remains.", "Pembersihan selesai, tinggal cek efisiensi akhir."],

    ["All Statuses", "Semua Status"], ["All Status", "Semua Status"],
    ["All Priorities", "Semua Prioritas"], ["Priority", "Prioritas"],
    ["7 Days", "7 Hari"], ["30 Days", "30 Hari"], ["Last 24 hours", "24 Jam Terakhir"],
    ["Custom", "Kustom"], ["Actual vs Expected output", "Output Aktual vs Ekspektasi"],
    ["Total Energy", "Total Energi"], ["Wind Speed", "Kecepatan Angin"], ["Wind", "Angin"],
    ["Environmental Impact", "Dampak Lingkungan"],
    ["Estimated benefit generated since commissioning", "Perkiraan manfaat yang dihasilkan sejak commissioning"],
    ["Energy Saved / Benefit", "Energi Dihemat / Manfaat"], ["CO₂ Emissions Saved", "Emisi CO₂ Dihindari"],
    ["Trees Equivalent", "Setara Pohon"], ["CO₂ absorption per year, if planted", "Penyerapan CO₂ per tahun jika ditanam"],
    ["vs. grid electricity generation", "vs. pembangkit listrik dari jaringan (grid)"],
    ["trees", "pohon"],
    ["From", "Dari"], ["To", "Sampai"],
    ["Maintenance Summary", "Ringkasan Pemeliharaan"], ["Next Scheduled", "Jadwal Berikutnya"], ["Last Completed", "Terakhir Selesai"],
    ["Predictive Maintenance", "Pemeliharaan Prediktif"], ["Recent Activity", "Aktivitas Terbaru"],
    ["Email today", "Email hari ini"], ["WhatsApp today", "WhatsApp hari ini"], ["Total sent today", "Total dikirim hari ini"],
    ["Last notification", "Notifikasi terakhir"], ["Delivered", "Terkirim"], ["Cycles", "Siklus"],
    ["Fault", "Gangguan"], ["Communication", "Komunikasi"], ["Healthy", "Sehat"], ["Warning", "Peringatan"],
    ["Critical", "Kritis"], ["Info", "Info"], ["High Risk", "Risiko Tinggi"], ["Medium Risk", "Risiko Sedang"],
    ["Low Risk", "Risiko Rendah"], ["Battery Voltage", "Tegangan Baterai"], ["PV Voltage", "Tegangan PV"],
    ["Inverter Performance", "Performa Inverter"], ["Radiator Temperature", "Suhu Radiator"],
    ["Battery Current", "Arus Baterai"], ["Battery Power", "Daya Baterai"], ["Inverter Leak Current", "Arus Bocor Inverter"],
    ["Success", "Berhasil"], ["Failed", "Gagal"],
    ["All Priorities", "Semua Priority"], ["All Status", "Semua status"], ["Wind Speed", "Kec. Angin"],
    ["Mark All as Read", "Tandai Semua Dibaca"], ["Notifications", "Notifikasi"], ["Last Login", "Login Terakhir"],
    ["Active", "Aktif"], ["Battery started automatic charging", "Battery mulai charging otomatis"],
    ["Daily production report sent", "Laporan produksi harian terkirim"],
    ["String 4 panel efficiency decreased", "Efisiensi panel string 4 menurun"],
    ["String 4 panel efficiency decrease detected", "Efisiensi panel string 4 menurun terdeteksi"],
    ["Irradiance sensor resynchronized", "Sensor irradiance tersinkronisasi ulang"],
    ["Routine maintenance completed by Technician Budi", "Maintenance rutin diselesaikan oleh Teknisi Budi"],
    ["Battery BAT-01 started charging", "Battery BAT-01 mulai charging"],
    ["Task Scheduled", "Task Dijadwalkan"], ["Task Completion Report Received", "Laporan Task Diterima"],
    ["Monitoring 8-Slot Repair", "Perbaikan Monitoring 8 Slot"], ["Add Continuity Feature", "Tambah Fitur Continuity"],
    ["Fake Load for Individual Testing", "Fake Load untuk Test Individual"],
    ["Project Monitoring", "Pemantauan Proyek"],
    ["Monitor project overview, system information, battery station, and task maintenance in one page.", "Pantau overview proyek, informasi system, battery station, dan task maintenance dalam satu halaman."],
    ["Filter", "Filter"],
    ["All", "Semua"],
    ["Waiting", "Menunggu"],
    ["Summary", "Ringkasan"],
    ["System Overview", "Ringkasan Sistem"],
    ["Edit", "Edit"],
    ["Installation Date", "Tanggal Pemasangan"],
    ["Peak Power", "Daya Puncak"],
    ["Address", "Alamat"],
    ["Inverter Overview", "Ringkasan Inverter"],
    ["Type", "Tipe"],
    ["Off-grid", "Off-grid"],
    ["Maximum Output", "Output Maksimal"],
    ["Frequency", "Frekuensi"],
    ["Communication Protocol", "Protokol Komunikasi"],
    ["Maintenance Date", "Tanggal Pemeliharaan"],
    ["PV Panel Overview", "Ringkasan Panel PV"],
    ["Solar Panel Overview", "Ringkasan Panel Surya"],
    ["Individual Panel Size", "Ukuran Panel Individu"],
    ["Hardware", "Perangkat Keras"],
    ["Device Overview", "Ringkasan Perangkat"],
    ["Comm. Protocol", "Protokol Komunikasi"],
    ["Input Power", "Daya Masukan"],
    ["Connection Type", "Tipe Koneksi"],
    ["Monitoring", "Monitoring"],
    ["Voltage Output", "Output Tegangan"],
    ["Current Output", "Output Arus"],
    ["Power Output", "Output Daya"],
    ["24 Hours", "24 Jam"],
    ["7 Days", "7 Hari"],
    ["Diagnostics", "Diagnostik"],
    ["Solar Panel Health", "Kesehatan Panel Surya"],
    ["HEALTH", "KESEHATAN"],
    ["Fair", "Cukup"],
    ["Excellent", "Sangat Baik"], ["Needs Attention", "Perlu Perhatian"], ["No Data", "Tidak Ada Data"],
    ["Estimated panel condition based on output vs installed capacity.", "Estimasi kondisi panel berdasarkan output vs kapasitas terpasang."],
    ["Log", "Log"],
    ["Alarm History", "Riwayat Alarm"],
    ["View details", "Lihat detail"],
    ["Time", "Waktu"],
    ["Description", "Deskripsi"],
    ["Battery voltage low warning", "Peringatan tegangan baterai rendah"],
    ["Charge controller overheat alert", "Peringatan pengendali pengisian terlalu panas"],
    ["Resolved", "Selesai"],
    ["This unit needs maintenance?", "Unit ini membutuhkan maintenance?"],
    ["Request a maintenance schedule or view this unit's maintenance history on the Task Management page.", "Ajukan jadwal maintenance atau lihat riwayat maintenance unit ini di halaman Manajemen Tugas."],
    ["Request Maintenance Task", "Ajukan Task Maintenance"],

    ["Select Battery Station", "Pilih Battery Station"],
    ["Total Slots", "Total Slot"],
    ["Currently Charging", "Sedang Mengisi"],
    ["Average SoC", "Rata-rata SoC"],
    ["Swaps Today", "Swap Hari Ini"],
    ["Device Time:", "Waktu perangkat:"],
    ["Updated", "Diperbarui"],
    ["Completed", "Selesai"],
    ["In Progress", "Berlangsung"],
    ["Scheduled", "Terjadwal"],
    ["Upcoming", "Mendatang"],
    ["by", "oleh"],
    ["hour ago", "jam lalu"],
    ["hours ago", "jam lalu"],
    ["Highlight Status", "Sorot Status"],
    ["In Use", "Digunakan"],
    ["Charging - Solar", "Mengisi – Solar"],
    ["Charging - Grid", "Mengisi – Grid"],
    ["Charging - Hybrid", "Mengisi – Hybrid"],
    ["Charging – Solar", "Mengisi – Solar"],
    ["Charging – Grid", "Mengisi – Grid"],
    ["Charging – Hybrid", "Mengisi – Hybrid"],

    ["Severity", "Tingkat Keparahan"],
    ["Project Center", "Pusat Proyek"],
    ["Repair", "Perbaikan"],
    ["Warning", "Peringatan"],
    ["Project(s)", "Proyek"],
    ["System Type(s)", "Tipe Sistem"],
    ["Battery", "Baterai"],
    ["Repeat", "Pengulangan"],
    ["Does not repeat", "Tidak berulang"],
    ["Travel Time", "Waktu Perjalanan"],
    ["None", "Tidak ada"],
    ["Reminder", "Pengingat"],
    ["1 day before", "1 hari sebelumnya"],
    ["PIC / Invitees", "PIC / Undangan"],
    ["fix 8 slot monitoring for bss", "perbaikan monitoring 8 slot untuk BSS"],

    ["Task Maintenance", "Pemeliharaan Tugas"],
    ["List of maintenance tasks assigned to you. Accept tasks, update work progress, then submit the completion report.", "Daftar tugas maintenance yang ditugaskan kepada Anda. Terima tugas, perbarui progres pekerjaan, lalu kirim laporan hasil saat sudah selesai."],
    ["Total Tasks", "Total Tugas"],
    ["Tasks In Progress", "Tugas Sedang Dikerjakan"],
    ["Completed Tasks", "Tugas Selesai"],
    ["View Details", "Lihat Detail"],
    ["Update Progress", "Update Progress"],
    ["Submit Completed", "Submit Selesai"],
    ["Maintenance Task Details", "Detail Tugas Maintenance"],
    ["Complete information for the maintenance task assigned to you.", "Informasi lengkap tugas maintenance yang ditugaskan kepada Anda."],
    ["Unit", "Unit"],
    ["Task Title", "Judul Tugas"],
    ["Scheduled Date", "Tanggal Dijadwalkan"],
    ["Assigned To", "Ditugaskan Kepada"],
    ["Priority", "Prioritas"],
    ["Work Description", "Deskripsi Pekerjaan"],
    ["Admin Notes", "Catatan dari Admin"],
    ["Work Progress", "Progress Pekerjaan"],
    ["Cleaning the panel surface and checking cables.", "Membersihkan permukaan panel dan memeriksa kabel."],
    ["Bring standard cleaning equipment.", "Bawa alat pembersih standar."],
    ["Panel cleaning completed, final efficiency check remains.", "Pembersihan selesai, tinggal cek efisiensi akhir."],

    ["Problem", "Masalah"], ["Problem Fixed", "Masalah Teratasi"], ["Notes", "Catatan"],
    ["Start:", "Mulai:"], ["Completed:", "Selesai:"],
    ["Maintenance Title", "Judul Pemeliharaan"],
    ["Start Date", "Tanggal Mulai"], ["Completed Date", "Tanggal Selesai"],
    ["Technician", "Teknisi"],

    ["Solar Planning Tool", "Solar Planning Tool"],
    ["Integrated Solar PV Planning & Costing Workspace", "Workspace Perencanaan & Perhitungan Biaya PLTS Terintegrasi"],
    ["Project Information", "Informasi Proyek"],
    ["System Configuration", "Konfigurasi Sistem"],
    ["Calculate", "Kalkulasi"],
    ["Result", "Hasil"],
    ["Enter Your Solar Project Data", "Masukkan Data Proyek Surya Anda"],
    ["Province (PSH source)", "Provinsi (sumber PSH)"],
    ["City / Regency", "Kota / Kabupaten"],
    ["What type of facility do you have?", "Apa jenis fasilitas yang Anda miliki?"],
    ["Restaurant", "Restoran"],
    ["Installed PLN Capacity (kVA)", "Kapasitas PLN Terpasang (kVA)"],
    ["PLN Tariff / Year (Rp/kWh)", "Tarif PLN / Tahun (Rp/kWh)"],
    ["Energy Input Method", "Metode Input Energi"],
    ["Monthly Bill (IDR)", "Tagihan Bulanan (IDR)"],
    ["Total Monthly Bill (IDR)", "Total Tagihan Bulanan (IDR)"],
    ["Limit by Roof Area", "Batasi Berdasarkan Luas Atap"],
    ["Total Roof Area (m²)", "Total Luas Atap (m²)"],
    ["Usable Roof Space (%)", "Luas Atap yang Dapat Digunakan (%)"],
    ["Primary Inputs", "Input Utama"],
    ["Target kWp", "Target kWp"],
    ["System Type", "Tipe Sistem"],
    ["On-Grid", "On-Grid"],
    ["Solar Panel Model", "Model Panel Surya"],
    ["Inverter efficiency", "Efisiensi inverter"],
    ["System PR", "PR Sistem"],
    ["Advance Design Parameters", "Parameter Desain Lanjutan"],
    ["Secondary - Cable Routing & Safety Factors", "Sekunder - Perutean Kabel & Faktor Keselamatan"],
    ["DC Cabling", "Kabel DC"],
    ["Cable Length (m)", "Panjang Kabel (m)"],
    ["Max Voltage Drop (%)", "Penurunan Tegangan Maksimal (%)"],
    ["AC Cabling", "Kabel AC"],
    ["Safety Factors", "Faktor Keselamatan"],
    ["Isc Safety Factor (×)", "Faktor Keselamatan Isc (×)"],
    ["Voc Cold Factor (×)", "Faktor Voc Dingin (×)"],
    ["Calculate & View Results", "Kalkulasi & Lihat Hasil"],
    ["Design", "Desain"],
    ["Visual", "Visual"],
    ["Configuration", "Konfigurasi"],
    ["RAB", "RAB"],
    ["Customer", "Pelanggan"],
    ["Summary", "Ringkasan"],
    ["Catalog", "Katalog"],
    ["Active Configuration", "Konfigurasi Aktif"],
    ["Recommended", "Direkomendasikan"],
    ["Quick Output Cards", "Kartu Output Cepat"],
    ["Panel Counts", "Jumlah Panel"],
    ["Actual array", "Array aktual"],
    ["Peak DC", "Puncak DC"],
    ["Peak AC", "Puncak AC"],
    ["Parameter", "Parameter"],
    ["Value", "Nilai"],
    ["String topology", "Topologi string"],
    ["Voltage feasibility (§14 checks)", "Kelayakan tegangan (pemeriksaan §14)"],
    ["PASS", "LULUS"],
    ["Array footprint", "Luas array"],
    ["DC cable", "Kabel DC"],
    ["Daily Energy", "Energi Harian"],
    ["Annual Energy", "Energi Tahunan"],
    ["Monthly Energy Chart", "Grafik Energi Bulanan"],
    ["System Flow Diagram", "Diagram Aliran Sistem"],
    ["Array PV", "Array PV"],
    ["DC Combiner", "DC Combiner"],
    ["AC Distribution", "Distribusi AC"],
    ["Load", "Beban"],
    ["Facility", "Fasilitas"],
    ["String Layout per MPPT", "Tata Letak String per MPPT"],
    ["Clipping AC", "Clipping AC"],
    ["Actual AC Output", "Output AC Aktual"],
    ["Potential without clipping", "Potensi tanpa clipping"],
    ["Inverter Capacity", "Kapasitas Inverter"],
    ["All Valid Inverter Configurations", "Semua Konfigurasi Inverter yang Valid"],
    ["Two inverters, DC/AC 1.29, 4 MPPT inputs (mixed string). ~50% redundancy if one inverter fails.", "Dua inverter, DC/AC 1.29, 4 input MPPT (mixed string). Redundansi ~50% jika satu inverter gagal."],
    ["Three inverters, DC/AC 0.88, 6 MPPT — suitable for complex/shaded roofs. Zero clipping.", "Tiga inverter, DC/AC 0.88, 6 MPPT — cocok untuk atap kompleks/bayangan parsial. Zero clipping."],
    ["One central inverter, DC/AC 1.09. Simplest, low maintenance, no redundancy.", "Satu inverter sentral, DC/AC 1.09. Paling sederhana, hemat perawatan, tanpa redundansi."],
    ["Total Inverter", "Total Inverter"],
    ["unit", "unit"],
    ["Estimated Cost", "Estimasi Biaya"],
    ["Efficiency High", "Efisiensi Tinggi"],
    ["View RAB", "Lihat RAB"],
    ["Active RAB", "RAB Aktif"],
    ["Highest Value", "Nilai Tertinggi"],
    ["Profit Margin Settings", "Pengaturan Margin Keuntungan"],
    ["Profit Margin", "Margin Keuntungan"],
    ["selected", "dipilih"],
    ["Cost Breakdown", "Rincian Biaya"],
    ["Base Cost", "Biaya Dasar"],
    ["Margin", "Margin"],
    ["Customer Selling Price", "Harga Jual Pelanggan"],
    ["Proposal Preview", "Pratinjau Proposal"],
    ["Export Customer Offer", "Ekspor Penawaran Pelanggan"],
    ["Executive Summary — Solar PV System Design", "Ringkasan Eksekutif — Desain Sistem PLTS"],
    ["Created", "Dibuat"],
    ["Project Overview", "Ringkasan Proyek"],
    ["Target capacity", "Kapasitas target"],
    ["Actual array capacity", "Kapasitas array aktual"],
    ["System type", "Tipe sistem"],
    ["Province / location", "Provinsi / lokasi"],
    ["Solar peak hours (PSH)", "Jam puncak surya (PSH)"],
    ["PV Array Configuration", "Konfigurasi Array PV"],
    ["Panel model", "Model panel"],
    ["Total panels", "Total panel"],
    ["String configuration", "Konfigurasi string"],
    ["Vmpp string (STC)", "Vmpp string (STC)"],
    ["Voc string (STC)", "Voc string (STC)"],
    ["Array area", "Luas array"],
    ["Selected Configuration", "Konfigurasi Terpilih"],
    ["Total inverter rating", "Rating inverter total"],
    ["Number of units", "Jumlah unit"],
    ["Total MPPT inputs", "Total input MPPT"],
    ["Peak AC output", "Output AC puncak"],
    ["Clipping STC", "Clipping STC"],
    ["Light (near AC limit)", "Ringan (dekat batas AC)"],
    ["Inverter efficiency", "Efisiensi inverter"],
    ["Cable", "Kabel"],
    ["DC cable type", "Tipe kabel DC"],
    ["Total DC cable (×1.5 safety factor)", "Total kabel DC (×1.5 faktor keamanan)"],
    ["AC cable type", "Tipe kabel AC"],
    ["Total AC cable (×1.5 safety factor)", "Total kabel AC (×1.5 faktor keamanan)"],
    ["Estimated Energy Production", "Estimasi Produksi Energi"],
    ["Peak DC power", "Daya DC puncak"],
    ["Daily estimated energy", "Estimasi energi harian"],
    ["Monthly estimated energy", "Estimasi energi bulanan"],
    ["Annual estimated energy", "Estimasi energi tahunan"],
    ["20-year estimate (without degradation)", "Estimasi 20 tahun (tanpa degradasi)"],
    ["Budget Summary", "Ringkasan Anggaran Biaya"],
    ["Price basis", "Dasar harga"],
    ["Best Price", "Harga Terbaik"],
    ["Subtotal (Pre-VAT)", "Subtotal (Pra-PPN)"],
    ["VAT 11%", "PPN 11%"],
    ["Total (including VAT)", "TOTAL (termasuk PPN)"],
    ["Cost per installed kWp", "Biaya per kWp terpasang"],
    ["20-year energy cost (proxy)", "Biaya energi 20 tahun (proxy)"],
    ["Save PDF", "Simpan PDF"],
    ["Print PDF", "Cetak PDF"],
    ["Show Technical Specifications", "Tampilkan Spesifikasi Teknik"],
    ["Solar Panel", "Panel Surya"],
    ["Inverter On-Grid", "Inverter On-Grid"],
    ["Inverter Hybrid", "Inverter Hybrid"],
    ["Mounting", "Mounting"],
    ["Rack", "Rack"],
    ["PDI", "PDI"],
    ["PDDC", "PDDC"],
    ["PDC", "PDC"],
    ["DC Cable", "Kabel DC"],
    ["AC Cable", "Kabel AC"],
    ["Accessories", "Aksesori"],
    ["Services", "Jasa"],
    ["SLO/NIDI", "SLO/NIDI"],
    ["edit cell · prices in IDR", "edit sel · harga dalam IDR"],

    ["Manage Projects", "Kelola Proyek"],
    ["Activity Type", "Tipe Aktivitas"],
    ["Activity Detail", "Detail Aktivitas"],
    ["Device & IP", "Perangkat & IP"],
    ["Project Partner", "Mitra Proyek"],

    // Dashboard (Project Overview map) page
    ["Monitor solar project status and performance.", "Pantau status dan performa proyek PLTS."],
    ["Refresh data", "Segarkan data"],
    ["Download data", "Unduh data"],
    ["MWh Generated", "MWh Dihasilkan"],
    ["MWp Installed", "MWp Terpasang"],
    ["Ton CO2 Avoided", "Ton CO2 Dihindari"],
    ["Weekly Analysis", "Analisis Mingguan"],
    ["Last Week", "Minggu Lalu"],
    ["Top Performing Sites", "Situs Berkinerja Terbaik"],
    ["Points of Interest", "Titik Menarik"],
    ["Emissions Avoided", "Emisi Dihindari"],
    ["Projected", "Proyeksi"],
    ["Realized", "Realisasi"],
    ["Upcoming Repair", "Perbaikan Mendatang"],
    ["Awaiting Permit", "Menunggu Izin"],
    ["Installation Scheduled", "Instalasi Terjadwal"],
    ["Status Update", "Pembaruan Status"],

    // Project Detail — Performance Analytics section
    ["Performance Analytics", "Analitik Performa"],
    ["Detailed operating variables for the selected PV system.", "Variabel operasional terperinci untuk sistem PLTS yang dipilih."],

    // Project Detail — per-project maintenance data (Maintenance Summary card)
    ["Routine Preventive Inspection", "Inspeksi Preventif Rutin"],
    ["Panel Cleaning & String Check", "Pembersihan Panel & Pengecekan String"],
    ["Efficiency gradually declining — inspection recommended within 2 weeks", "Efisiensi menurun bertahap — disarankan pengecekan dalam 2 minggu"],
    ["Inverter Firmware Update", "Update Firmware Inverter"],
    ["Routine Monthly Inspection", "Inspeksi Rutin Bulanan"],
    ["Emergency Repair INV-02", "Perbaikan Darurat INV-02"],
    ["String 6 Cable Replacement", "Penggantian Kabel String 6"],
    ["Recurring offline pattern — high failure risk, schedule replacement", "Pola offline berulang — risiko kegagalan tinggi, jadwalkan penggantian"],
    ["Operating temperature above average — monitor closely for the next 7 days", "Suhu operasi di atas rata-rata — pantau ketat 7 hari ke depan"],
    ["INV-03 Inverter Temperature Check", "Pengecekan Suhu Inverter INV-03"],
    ["Operating temperature trending up — schedule cooling system check", "Suhu operasi cenderung naik — jadwalkan pengecekan pendingin"],

    // Project Monitoring — "Ringkasan Proyek" (Project Overview detail) tab
    // Summary strip + stat cards + report modal labels that were still
    // missing from the dictionary, so they stayed in English/Indonesian
    // no matter which language was selected.
    ["Capacity", "Kapasitas"],
    ["Commission Date", "Tanggal Commissioning"],
    ["Owner", "Pemilik"],
    ["Inverter Summary", "Ringkasan Inverter"],
    ["Inverter Online", "Inverter Online"],
    ["Battery SOC", "SOC Baterai"],
    ["Open Battery Station", "Buka Battery Station"],
    ["Irradiance", "Iradiasi"],
    ["Sunny", "Cerah"],
    ["Partly Sunny", "Cerah Berawan"],
    ["Cloudy", "Berawan"],
    ["Performance Report", "Laporan Performa"],
    ["Reporting Period", "Periode Laporan"],
    ["Production Summary", "Ringkasan Produksi"],
    ["Energy Generated", "Energi Dihasilkan"],
    ["Expected Production", "Produksi Ekspektasi"],
    ["PV Health & Key Metrics", "Kesehatan PV & Metrik Utama"],
    ["Anomalies & Alerts Summary", "Ringkasan Anomali & Peringatan"],
    ["View All Alerts", "Lihat Semua Peringatan"],
    ["Export PDF", "Ekspor PDF"],

    // Battery Station tab (project-monitoring) — labels that were still
    // hardcoded in Indonesian and missing from the dictionary.
    ["Click a slot to change its status", "Klik slot untuk ubah status"],
    ["Loading data…", "Memuat data…"],
    ["Live battery slot status, charging schedule, and swap history.", "Status slot baterai, jadwal pengisian, dan riwayat swap secara langsung"],
    ["No swap history yet.", "Belum ada riwayat swap."],
    ["Battery station data updated", "Data battery station diperbarui"],

    // Task Maintenance page (viewer/staff task list + modals)
    ["In Progress", "Sedang Dikerjakan"],
    ["No progress notes yet.", "Belum ada catatan progres."],
    ["Progress Notes (optional)", "Catatan Progress (opsional)"],
    ["Work Result Description", "Deskripsi Hasil Pekerjaan"],
    ["Work result description is required.", "Deskripsi hasil pekerjaan wajib diisi."],
    ["Complete information about the task assigned to you.", "Informasi lengkap tugas yang ditugaskan kepada Anda."],
    ["Items Purchased (optional)", "Items Purchased (opsional)"],
    ["Send Report", "Kirim Laporan"],
    ["Confirm that you will work on this task.", "Konfirmasi bahwa Anda akan mengerjakan tugas ini."],
    ["Work Result Report", "Laporan Hasil Pekerjaan"],
    ["Complete the work result report to finish this task.", "Lengkapi laporan hasil pekerjaan untuk menyelesaikan tugas ini."],
    ["At least 1 documentation photo is required.", "Minimal 1 foto dokumentasi wajib diunggah."],
    ["Update the percentage of work completed.", "Perbarui persentase pekerjaan yang sudah diselesaikan."],
    ["Progress will automatically become", "Progress akan otomatis menjadi"],
    ["After being accepted, this task will move to the", "Setelah diterima, tugas ini akan pindah ke tab"],
    ["Save Progress", "Simpan Progress"],
    ["Submit Maintenance Result", "Submit Hasil Maintenance"],
    ["Add Photo", "Tambah Foto"],
    ["Accept Task", "Terima Tugas"],
    ["Accept Maintenance Task", "Terima Tugas Maintenance"],
    ["Upload at least 1 photo as proof of the work result.", "Unggah minimal 1 foto sebagai bukti hasil pekerjaan."],
    ["Yes, Accept Task", "Ya, Terima Tugas"],
    ["tab and you can start updating your work progress.", "dan Anda bisa mulai memperbarui progres pekerjaan."],
    ["and the task will move to the", "dan tugas berpindah ke tab"],
    ["tab after the report is submitted.", "setelah laporan dikirim."],
    ["No new tasks yet", "Belum ada tugas baru"],
    ["No pending maintenance tasks for the selected unit.", "Tidak ada tugas maintenance pending untuk unit yang dipilih."],
    ["No tasks in progress yet", "Belum ada tugas berjalan"],
    ["No tasks currently in progress for the selected unit.", "Belum ada tugas yang sedang dikerjakan untuk unit yang dipilih."],
    ["No completed history yet", "Belum ada riwayat selesai"],
    ["Tasks you have completed will appear here.", "Tugas yang sudah Anda selesaikan akan muncul di sini."],
    ["Work progress", "Progress pekerjaan"],
    ["Task accepted. Happy working!", "Tugas diterima. Selamat bekerja!"],
    ["Work progress updated.", "Progress pekerjaan diperbarui."],
    ["Report submitted successfully. Task completed!", "Laporan berhasil dikirim. Tugas selesai!"],
    ["Delete photo", "Hapus foto"],
    // Admin Calculator translations added from teammate version (merged without replacing existing project changes).
    ["Polycrystalline", "Polikristalin"],
    ["Off-Grid", "Off-Grid"],
    ["Not yet calculated", "Belum dihitung"],
    ["Cost/kWp (pre-VAT)", "Biaya/kWp (pra-PPN)"],
    ["Battery Discharge", "Pengosongan Baterai"],
    ["Battery Round-trip Efficiency", "Efisiensi Round-trip Baterai"],
    ["Battery Selection", "Pemilihan Baterai"],
    ["Battery Storage", "Penyimpanan Baterai"],
    ["Battery Storage Scenario", "Skenario Penyimpanan Baterai"],
    ["Catalog Components", "Komponen Katalog"],
    ["Components used", "Komponen yang digunakan"],
    ["Components will be selected automatically from the active catalog once the system inputs are available.", "Komponen akan dipilih otomatis dari katalog aktif setelah input sistem tersedia."],
    ["Configuration Preference", "Preferensi Konfigurasi"],
    ["Consumption", "Konsumsi"],
    ["Customize Components", "Kustomisasi Komponen"],
    ["Enable battery storage scenario", "Aktifkan skenario penyimpanan baterai"],
    ["Energy Discharged", "Energi yang Dikeluarkan"],
    ["Energy Stored", "Energi yang Disimpan"],
    ["Estimated Battery Capacity", "Estimasi Kapasitas Baterai"],
    ["Estimated Daily Production vs. Consumption", "Estimasi Produksi Harian vs. Konsumsi"],
    ["Excess Energy Coverage (%)", "Cakupan Energi Berlebih (%)"],
    ["Excess Solar Available", "Surplus Surya Tersedia"],
    ["Export Excel", "Ekspor Excel"],
    ["Use this if you want to replace a supporting component chosen by the package.", "Gunakan ini jika ingin mengganti komponen pendukung yang dipilih oleh paket."],
    ["Selling Price (Pre-VAT)", "Harga Jual (Pra-PPN)"],
    ["Unit Price", "Harga Satuan"],
    ["Hybrid system planning", "Perencanaan sistem hybrid"],
    ["I. Spare Parts", "I. Suku Cadang"],
    ["II. Installation Material", "II. Material Instalasi"],
    ["III. Service", "III. Jasa"],
    ["Installation Service", "Jasa Instalasi"],
    ["Inverter Model", "Model Inverter"],
    ["Inverter capacity is sufficient for the array output at design conditions.", "Kapasitas inverter cukup untuk output array pada kondisi desain."],
    ["Complete the project data on the left, then click", "Lengkapi data proyek di sebelah kiri, lalu klik"],
    ["Manual — Excess Coverage", "Manual — Cakupan Surplus"],
    ["Manual — Target Capacity", "Manual — Kapasitas Target"],
    ["Monthly Usage (kWh)", "Penggunaan Bulanan (kWh)"],
    ["No catalog item selected.", "Belum ada item katalog yang dipilih."],
    ["OK, Got It", "OK, Mengerti"],
    ["Optimal System Configurations", "Konfigurasi Sistem Optimal"],
    ["RAB for:", "RAB untuk:"],
    ["BOQ", "RAB"],
    ["View BOQ", "Lihat RAB"],
    ["Active BOQ", "RAB Aktif"],
    ["BOQ for:", "RAB untuk:"],
    ["Bill of Quantities (BOQ)", "Rincian Volume Pekerjaan (RAB)"],

    // Admin Calculator — additional static labels found not yet covered
    // by the phrase table above (voltage-feasibility table, visual metric
    // cards, clipping chart, alternative-config card, monthly chart month
    // abbreviations, and the Summary/Ringkasan tab grid + narrative text).
    ["CHECK 1 — Abs. max (Voc_cold)", "PERIKSA 1 — Maks. Abs. (Voc_cold)"],
    ["DC cable (×1.55F)", "Kabel DC (×1.55F)"],
    ["Peak DC (array)", "Puncak DC (array)"],
    ["MWh/year", "MWh/tahun"],
    ["Alternative", "Alternatif"],
    ["Inverter Capacity (", "Kapasitas Inverter ("],
    ["String layout is calculated automatically from the catalog parameters.", "Tata letak string dihitung otomatis dari parameter katalog."],
    ["DC output may exceed the inverter AC capacity at peak production; the clipping estimate is included in the annual energy figure.", "Output DC dapat melebihi kapasitas AC inverter pada produksi puncak; estimasi clipping sudah termasuk dalam angka energi tahunan."],
    ["Inverter capacity is sufficient for the array output under design conditions; there is no indication of significant clipping in this estimate.", "Kapasitas inverter sudah cukup untuk output array pada kondisi desain; tidak ada indikasi clipping signifikan pada estimasi ini."],
    ["Potential clipping at peak production.", "Berpotensi clipping saat produksi puncak."],
    ["DC/AC ratio is still within a practical range.", "Rasio DC/AC masih dalam rentang yang wajar."],
    ["May", "Mei"], ["Aug", "Agu"], ["Oct", "Okt"], ["Dec", "Des"],
    ["The Solar PV system", "Sistem PLTS"],
    ["inverter configuration with a DC/AC ratio of", "konfigurasi inverter dengan rasio DC/AC"],
    ["Estimated production:", "Estimasi produksi:"],
    ["Total installed cost (pre-VAT):", "Total biaya instalasi (sebelum PPN):"],
    ["The hybrid system uses an inverter configuration optimized from the catalog and a battery from the catalog.", "Sistem hybrid menggunakan konfigurasi inverter yang dioptimalkan dari katalog dan baterai dari katalog."],
    ["The off-grid system uses a hybrid inverter and a battery from the catalog.", "Sistem off-grid menggunakan inverter hybrid dan baterai dari katalog."],
    ["The on-grid system does not use a battery.", "Sistem on-grid tidak menggunakan baterai."],
    ["⚠ Configuration needs review", "⚠ Konfigurasi perlu ditinjau"],
    ["Not specified in catalog", "Tidak ditentukan dalam katalog"],
    ["Peak sun hours (PSH)", "Jam matahari puncak (PSH)"],
    ["Voc string (cold check)", "Voc string (cek dingin)"],
    ["DC/AC ratio", "Rasio DC/AC"],
    ["Quantity", "Jumlah"],
    ["Cabling", "Perkabelan"],
    ["Total DC cable", "Total kabel DC"],
    ["Total AC cable", "Total kabel AC"],
    ["Energy Production Estimate", "Estimasi Produksi Energi"],
    ["Estimated daily energy", "Estimasi energi harian"],
    ["Estimated monthly energy", "Estimasi energi bulanan"],
    ["Estimated annual energy", "Estimasi energi tahunan"],
    ["20-year estimate", "Estimasi 20 tahun"],
    ["Cost Budget Summary", "Ringkasan Anggaran Biaya"],
    ["Active configuration", "Konfigurasi aktif"],
    ["Subtotal (pre-VAT)", "Subtotal (sebelum PPN)"],
    ["Cost per kWp installed", "Biaya per kWp terpasang"],
    ["Battery Storage", "Penyimpanan Baterai"],
    ["Target storage", "Target penyimpanan"],
    ["Total nominal capacity", "Total kapasitas nominal"],
    ["Usable capacity", "Kapasitas terpakai"],
    ["Sizing reference", "Referensi ukuran"],
    ["Potential clipping", "Berpotensi clipping"],
    ["Minor / minimal", "Kecil / minimal"],
    ["Recommended / Best Value balances technical fit and estimated cost. Best Quality means the strongest technical-fit score from the available catalog data; it is not a brand-quality rating.", "Recommended / Best Value menyeimbangkan kesesuaian teknis dan estimasi biaya. Best Quality berarti skor kesesuaian teknis terkuat dari data katalog yang tersedia; ini bukan penilaian kualitas merek."],
    ["Select from Catalog", "Pilih dari Katalog"],
    ["Solar Production", "Produksi Surya"],
    ["Solar Used", "Surya Terpakai"],
    ["Stored in Battery", "Tersimpan di Baterai"],
    ["Subtotal pre-VAT", "Subtotal pra-PPN"],
    ["Target Battery Capacity (kWh)", "Target Kapasitas Baterai (kWh)"],
    ["Target storage is calculated automatically from the selected energy basis.", "Target penyimpanan dihitung otomatis dari basis energi yang dipilih."],
    ["The system determines the storage target, battery model, and quantity automatically from the selected energy basis.", "Sistem menentukan target penyimpanan, model baterai, dan jumlahnya secara otomatis dari basis energi yang dipilih."],
    ["Topology string", "String topologi"],
    ["Total Bill to Customer (Including VAT)", "Total Tagihan ke Customer (Termasuk PPN)"],
    ["Total including VAT", "Total termasuk PPN"],
    ["Use this only when you want to manually replace an optimized component.", "Gunakan ini hanya jika Anda ingin mengganti komponen yang telah dioptimalkan secara manual."],
    ["Save Changes", "Simpan Perubahan"],
    ["Saved.", "Tersimpan."],
    ["Date", "Tanggal"],
    ["Title", "Judul"],
    ["Username", "Nama Pengguna"],
    ["Logout", "Keluar"],
    ["Login", "Masuk"],
    ["Add New Project", "Tambah Proyek Baru"],
    ["Automatic optimization", "Optimasi Otomatis"],
    ["Lowest-cost valid configuration.", "Konfigurasi valid dengan biaya terendah."],
    ["Highest technical-fit valid configuration.", "Konfigurasi valid dengan kesesuaian teknis tertinggi."],
    ["Best balance between cost and technical fit.", "Keseimbangan terbaik antara biaya dan kesesuaian teknis."],
    ["Initial configuration is valid.", "Konfigurasi awal valid."],
    ["Recommended · Best Value", "Direkomendasikan · Best Value"],
    ["Best Quality", "Kualitas Terbaik"],
    ["to view the system design, energy output, and inverter configuration options.", "untuk melihat desain sistem, output energi, dan opsi konfigurasi inverter."],
    ["Price:", "Harga:"],
    ["(Estimate)", "(Estimasi)"],
    ["Additional Peak Load", "Beban Puncak Tambahan"],
    ["All your information is only used to provide your solar estimate and quotation.", "Semua informasi Anda hanya digunakan untuk memberikan estimasi dan penawaran solar Anda."],
    ["Available Solar Surplus", "Surplus Surya Tersedia"],
    ["Average Annual Reduction", "Rata-rata Pengurangan Tahunan"],
    ["Base Load", "Beban Dasar"],
    ["Calculate Estimate", "Hitung Estimasi"],
    ["Calculate your facility's rooftop solar potential in seconds.", "Hitung potensi solar atap fasilitas Anda dalam hitungan detik."],
    ["Chat via WhatsApp", "Chat via WhatsApp"],
    ["Choose How You'd Like to Go Solar", "Pilih Cara Anda Ingin Beralih ke Solar"],
    ["Comparison of base load, additional peak load, and installed PLN capacity", "Perbandingan beban dasar, beban puncak tambahan, dan kapasitas PLN terpasang"],
    ["Continue to Official Quote", "Lanjut ke Penawaran Resmi"],
    ["Country", "Negara"],
    ["Country Name", "Nama Negara"],
    ["Custom PLN Tariff (Rp/kWh)", "Tarif PLN Kustom (Rp/kWh)"],
    ["Daily Cost (Pre-Solar)", "Biaya Harian (Sebelum Solar)"],
    ["Daily Energy (kWh)", "Energi Harian (kWh)"],
    ["Daily Excess Surplus", "Surplus Berlebih Harian"],
    ["Daily Grid Import", "Impor Grid Harian"],
    ["Daily Solar Consumption", "Konsumsi Surya Harian"],
    ["Daily Solar Mix", "Bauran Surya Harian"],
    ["Daily Specific Yield", "Yield Spesifik Harian"],
    ["Daily energy mix breakdown", "Rincian bauran energi harian"],
    ["Discharged Energy", "Energi yang Dikeluarkan"],
    ["Download Report (PDF)", "Unduh Laporan (PDF)"],
    ["Electricity Bill: Now vs. Solar", "Tagihan Listrik: Sekarang vs. Solar"],
    ["Energy Stored in Battery", "Energi Tersimpan di Baterai"],
    ["Enter Your Project Details", "Masukkan Detail Proyek Anda"],
    ["Enter your email to view investment details, payback period, and download the estimate report as a PDF.", "Masukkan email Anda untuk melihat detail investasi, periode pengembalian, dan unduh laporan estimasi sebagai PDF."],
    ["Environmental Impact & CSR Equivalent (20 Years)", "Dampak Lingkungan & Setara CSR (20 Tahun)"],
    ["Estimated Energy Performance (Year 1)", "Estimasi Performa Energi (Tahun 1)"],
    ["Estimated Monthly Savings", "Estimasi Penghematan Bulanan"],
    ["Estimated system investment", "Estimasi investasi sistem"],
    ["Expand Table", "Perluas Tabel"],
    ["Facility Province", "Provinsi Fasilitas"],
    ["Facility Type", "Jenis Fasilitas"],
    ["Factory 1 Shift", "Pabrik 1 Shift"],
    ["Factory 24/7", "Pabrik 24/7"],
    ["Fill in the form and click \\\"Calculate Estimate\\\" to see your facility's solar system potential.", "Isi formulir dan klik \\\"Hitung Estimasi\\\" untuk melihat potensi sistem solar fasilitas Anda."],
    ["Financial", "Finansial"],
    ["Financing model", "Model pembiayaan"],
    ["Full Breakdown & Investment Projection", "Rincian Lengkap & Proyeksi Investasi"],
    ["Full name", "Nama lengkap"],
    ["Go solar", "Beralih ke solar"],
    ["Hi, thanks for visiting 360energy. We help businesses design & install the right solar panel system to maximize their electricity savings. Feel free to reach out through this chat.", "Hai, terima kasih telah mengunjungi 360energy. Kami membantu bisnis merancang & memasang sistem panel surya yang tepat untuk memaksimalkan penghematan listrik. Silakan hubungi kami melalui chat ini."],
    ["Hospital", "Rumah Sakit"],
    ["If you go solar, over 20 years you'll save", "Jika Anda beralih ke solar, selama 20 tahun Anda akan menghemat"],
    ["Indonesia", "Indonesia"],
    ["Initial estimate — for an official quote, our team will conduct a further site survey.", "Estimasi awal — untuk penawaran resmi, tim kami akan melakukan survei lokasi lebih lanjut."],
    ["Installed PLN Capacity", "Kapasitas PLN Terpasang"],
    ["Installed PLN Power Capacity (kVA)", "Kapasitas Daya PLN Terpasang (kVA)"],
    ["Fill in your monthly electricity bill data", "Isi data tagihan listrik bulanan Anda"],
    ["Load & Billing Snapshot", "Ringkasan Beban & Tagihan"],
    ["Mall / Retail", "Mall / Ritel"],
    ["Mangrove Forest Equivalent", "Setara Hutan Mangrove"],
    ["Max Output Power", "Daya Output Maksimal"],
    ["Monthly Bill (Pre-Solar)", "Tagihan Bulanan (Sebelum Solar)"],
    ["Monthly bill", "Tagihan bulanan"],
    ["More information about Available Solar Surplus", "Informasi lebih lanjut tentang Surplus Surya Tersedia"],
    ["More information about Battery Round-trip Efficiency", "Informasi lebih lanjut tentang Efisiensi Round-trip Baterai"],
    ["More information about Discharged Energy", "Informasi lebih lanjut tentang Energi yang Dikeluarkan"],
    ["More information about Estimated Battery Capacity", "Informasi lebih lanjut tentang Estimasi Kapasitas Baterai"],
    ["More information about Facility Type", "Informasi lebih lanjut tentang Jenis Fasilitas"],
    ["More information about Fill in your monthly electricity bill", "Informasi lebih lanjut tentang mengisi tagihan listrik bulanan Anda"],
    ["More information about Installed PLN Power Capacity", "Informasi lebih lanjut tentang Kapasitas Daya PLN Terpasang"],
    ["More information about PLN Tariff Category", "Informasi lebih lanjut tentang Kategori Tarif PLN"],
    ["More information about Stored Energy", "Informasi lebih lanjut tentang Energi Tersimpan"],
    ["More information about Total Monthly Electricity Bill", "Informasi lebih lanjut tentang Total Tagihan Listrik Bulanan"],
    ["No upfront cost", "Tanpa biaya di muka"],
    ["Number of Panels", "Jumlah Panel"],
    ["Outright Purchase: Annual Financial Breakdown", "Pembelian Langsung: Rincian Finansial Tahunan"],
    ["PLN Tariff", "Tarif PLN"],
    ["PLN Tariff Category", "Kategori Tarif PLN"],
    ["Pay a lower monthly rate than PLN with", "Bayar tarif bulanan lebih rendah dari PLN dengan"],
    ["Pay for the system upfront and", "Bayar sistem di muka dan"],
    ["Payback Period (Outright Purchase)", "Periode Pengembalian (Pembelian Langsung)"],
    ["Paying off investment", "Melunasi investasi"],
    ["Personal", "Personal"],
    ["Phone number", "Nomor telepon"],
    ["Prep / Idle Load", "Beban Persiapan / Idle"],
    ["Pure savings, no more payments", "Penghematan murni, tidak ada pembayaran lagi"],
    ["Residential Complex", "Kompleks Perumahan"],
    ["Save Rp -- in Year 1 → save Rp --/year by Year 20", "Hemat Rp -- di Tahun 1 → hemat Rp --/tahun pada Tahun 20"],
    ["Save up to", "Hemat hingga"],
    ["Savings (Rp)", "Penghematan (Rp)"],
    ["Self-consumed", "Terpakai Sendiri"],
    ["Sign In", "Masuk"],
    ["Smart Solar Planner", "Perencana Surya Cerdas"],
    ["Solar Energy Coverage", "Cakupan Energi Surya"],
    ["Solar Leasing", "Sewa Solar"],
    ["Solar Leasing Tariff (BOT)", "Tarif Sewa Solar (BOT)"],
    ["Solar PV System", "Sistem PLTS"],
    ["Solar System Size", "Ukuran Sistem Surya"],
    ["Stay on PLN", "Tetap di PLN"],
    ["Stored Energy", "Energi Tersimpan"],
    ["Street Lighting", "Penerangan Jalan"],
    ["System Size", "Ukuran Sistem"],
    ["System size", "Ukuran sistem"],
    ["Technical", "Teknis"],
    ["This estimate is indicative, based on standard assumptions (regional solar irradiance potential, typical load profiles, and prevailing market prices). Final figures will be adjusted after a technical survey by the 360energy team.", "Estimasi ini bersifat indikatif, berdasarkan asumsi standar (potensi iradiasi surya regional, profil beban umum, dan harga pasar yang berlaku). Angka final akan disesuaikan setelah survei teknis oleh tim 360energy."],
    ["Total Daily Energy Use (kWh)", "Total Penggunaan Energi Harian (kWh)"],
    ["Total Daily Production", "Total Produksi Harian"],
    ["Total Emission Reduction", "Total Pengurangan Emisi"],
    ["Total Monthly Electricity Bill (Rp)", "Total Tagihan Listrik Bulanan (Rp)"],
    ["Total Panel Area", "Total Luas Panel"],
    ["Total Project Savings (20yr)", "Total Penghematan Proyek (20 Tahun)"],
    ["Total savings over 20 years", "Total penghematan selama 20 tahun"],
    ["Type your city", "Ketik nama kota Anda"],
    ["Type your country name", "Ketik nama negara Anda"],
    ["Type your province / state", "Ketik provinsi / negara bagian Anda"],
    ["United States", "Amerika Serikat"],
    ["Unlock Details & Report", "Buka Detail & Laporan"],
    ["Unlock the full breakdown & report", "Buka rincian & laporan lengkap"],
    ["Unlock your full report for production charts, investment breakdown, payback period, and environmental impact.", "Buka laporan lengkap Anda untuk grafik produksi, rincian investasi, periode pengembalian, dan dampak lingkungan."],
    ["Usable Roof Area (%)", "Luas Atap yang Bisa Digunakan (%)"],
    ["With Solar", "Dengan Solar"],
    ["You own the system", "Anda memiliki sistem"],
    ["Your electricity bill goes up every year as PLN tariffs increase. Here's how your annual bill compares at a few points in time, with and without solar.", "Tagihan listrik Anda naik setiap tahun seiring kenaikan tarif PLN. Berikut perbandingan tagihan tahunan Anda pada beberapa titik waktu, dengan dan tanpa solar."],
    ["Your estimate will appear here", "Estimasi Anda akan muncul di sini"],
    ["kWh/day", "kWh/hari"],
    ["new monthly bill", "tagihan bulanan baru"],
    ["of total daily electricity consumption", "dari total konsumsi listrik harian"],
    ["off your total bill vs. staying 100% on PLN", "dari total tagihan Anda vs. tetap 100% di PLN"],
    ["on your electricity costs over 20 years", "dari biaya listrik Anda selama 20 tahun"],
    ["own it outright", "memiliki sepenuhnya"],
    ["solar panels", "panel surya"],
    ["that's", "itu"],
    ["your estimated investment payback", "estimasi pengembalian investasi Anda"],
    ["zero upfront investment", "investasi awal nol"],
    ["360energy owns, installs, and maintains the system for you.", "360energy memiliki, memasang, dan memelihara sistem untuk Anda."],
    ["like planting", "seperti menanam"],
    ["the biggest long-term savings, with your investment paid back in just a few years.", "penghematan jangka panjang terbesar, dengan investasi Anda kembali hanya dalam beberapa tahun."],
    ["Factory", "Pabrik"],
    ["Warehouse", "Gudang"],
    ["MWh/year", "MWh/tahun"],
    ["Auto — Recommended", "Otomatis — Direkomendasikan"],
    ["by 360Energy (PT. Pionir Energi Hijau)", "by 360Energy (PT. Pionir Energi Hijau)"],
    ["Capacity (kW/Wp/kWh)", "Kapasitas (kW/Wp/kWh)"],
    ["Capacity kW/Wp/kWh, Voc, Vmpp, Impp, MPPT, L, W", "Kapasitas kW/Wp/kWh, Voc, Vmpp, Impp, MPPT, L, W"],
    ["Size (kW)", "Ukuran (kW)"],

    // ---- Merged in from edash-solar-calculator-language-fixed-final-v2 ----
    // Catalog / Admin Calculator (BOQ-RAB) / battery-auto labels not yet
    // covered by the translation dictionary above.
    ["Cabling", "Perkabelan"],
    ["Roof Top Solar", "Solar Rooftop"],
    ["Cheapest", "Termurah"],
    ["🎯 Target Fit", "🎯 Kesesuaian Target"],
    ["Office", "Kantor"],
    ["The system determines the storage target automatically from the selected energy basis.", "Sistem menentukan target penyimpanan secara otomatis berdasarkan basis energi yang dipilih."],
    ["Battery Model", "Model Baterai"],
    ["No battery model selected.", "Belum ada model baterai yang dipilih."],
    ["Use inverter catalog", "Gunakan katalog inverter"],
    ["On-Grid (default — more choices)", "On-Grid (default — lebih banyak pilihan)"],
    ["Hybrid (hybrid inverter catalog only)", "Hybrid (khusus katalog inverter hybrid)"],
    ["Using On-Grid inverter catalog for calculations (default).", "Menggunakan katalog inverter On-Grid untuk kalkulasi (default)."],
    ["Target storage", "Target penyimpanan"],
    ["⭐ Recommended · Best Value", "⭐ Direkomendasikan · Nilai Terbaik"],
    ["💰 Best Price", "💰 Harga Terbaik"],
    ["🏆 Best Quality", "🏆 Kualitas Terbaik"],
    ["Target DC/AC Oversizing Ratio", "Rasio Oversizing DC/AC Target"],
    ["Standard EPC practice: 1.10x–1.30x. A value of 1.00x means the DC array and inverter AC capacity are equal (no oversizing).", "Praktik EPC standar: 1.10x–1.30x. Nilai 1.00x berarti kapasitas array DC dan kapasitas AC inverter sama (tanpa oversizing)."],
    ["Use this if you want to replace the supporting components selected by the package.", "Gunakan ini jika Anda ingin mengganti komponen pendukung yang dipilih oleh paket."],
    ["✓ Initial configuration is valid.", "✓ Konfigurasi awal valid."],
    ["Empty state before calculate", "Tampilan kosong sebelum kalkulasi"],
    ["to see the system design, energy output, and inverter configuration options.", "untuk melihat desain sistem, output energi, dan pilihan konfigurasi inverter."],
    ["String length [Lmin–Lmax]", "Panjang string [Lmin–Lmax]"],
    ["TAB: Visual", "TAB: Visual"],
    ["Inverter capacity is sufficient for the array output under design conditions.", "Kapasitas inverter mencukupi untuk output array pada kondisi desain."],
    ["No", "No"],
    ["Item", "Item"],
    ["Qty", "Jumlah"],
    ["% selected", "% dipilih"],
    ["Selling Price (pre-VAT)", "Harga Jual (sebelum PPN)"],
    ["Total Customer Invoice (Including VAT)", "Total Tagihan Pelanggan (Termasuk PPN)"],
    ["I. Parts", "I. Komponen"],
    ["Subtotal (pre-VAT)", "Subtotal (sebelum PPN)"],
    ["Notice", "Pemberitahuan"],
    ["List of PLTS Component Prices & Specifications", "Daftar Harga & Spesifikasi Komponen PLTS"],
    ["HPP", "HPP"],
    ["Latest Price (Live)", "Harga Terbaru (Live)"],
    ["Rows are rendered dynamically by js/catalog.js from localStorage", "Baris ditampilkan secara dinamis oleh js/catalog.js dari localStorage"],
    ["Delete row confirmation modal", "Modal konfirmasi hapus baris"],
    ["Release the CSV file here to update the Catalog", "Lepaskan file CSV di sini untuk memperbarui Katalog"],
    ["Technical Specifications", "Spesifikasi Teknik"],
    ["Live Price", "Harga Live"],
    ["Last Update", "Update Terakhir"],
    ["Required", "Wajib"],
    ["Optional", "Opsional"],
    ["Download", "Unduh"],
    ["Import", "Impor"],
    ["Upload", "Unggah"],
    ["No data available", "Tidak ada data tersedia"],
    ["No catalog data", "Tidak ada data katalog"],
    ["PV Inverter", "Inverter PV"],
    ["Total Inverter Capacity", "Total Kapasitas Inverter"],
    ["pre-VAT", "sebelum PPN"],
    ["Target storage:", "Target penyimpanan:"],
    ["Auto — Cheapest Battery", "Otomatis — Baterai Termurah"],
    ["Battery options for", "Pilihan baterai untuk"],
    ["kWh target", "target kWh"],
    ["Capacity:", "Kapasitas:"],
    ["Price", "Harga"],
    ["Usable reference:", "Referensi yang dapat digunakan:"],
    ["Estimated daily load", "Estimasi beban harian"],
    ["estimated daily production", "estimasi produksi harian"],
    ["daily excess", "surplus harian"],
    ["target storage", "target penyimpanan"],
    ["Configuration needs review", "Konfigurasi perlu diperiksa"],
    ["Estimated production", "Estimasi produksi"],
    ["Total installed cost", "Total biaya terpasang"],
    ["Active Catalog Price", "Harga Katalog Aktif"],
    ["Selling Price", "Harga Jual"],
    ["TOTAL CUSTOMER INVOICE", "TOTAL TAGIHAN PELANGGAN"],
    ["Hide Technical Specifications", "Sembunyikan Spesifikasi Teknik"],
    ["No data in this category. Use \"Add Row\" below the table, or upload a CSV.", "Belum ada data pada kategori ini. Gunakan \"Tambah Baris\" di bawah tabel, atau upload CSV."],
    ["total rows", "baris total"],
    ["Update latest price?", "Perbarui harga terbaru?"],
    ["Delete all catalog data?", "Hapus semua data katalog?"],
    ["Update Price", "Update Harga"],
    ["Latest price for", "Harga terbaru untuk"],
    ["will be changed from", "akan diubah dari"],
    ["The old price will be saved automatically as history", "Harga lama otomatis tersimpan sebagai riwayat"],
    ["The Last Updated date will be recorded automatically.", "Tanggal Update Terakhir akan otomatis tercatat."],
    ["Set the latest price for", "Set harga terbaru untuk"],
    ["The Last Updated date will be updated to now.", "Tanggal Update Terakhir akan diperbarui ke sekarang."],
    ["Delete row", "Hapus baris"],
    ["There is no data to delete.", "Belum ada data untuk dihapus."],
    ["rows in this catalog will be permanently deleted, including those imported from CSV.", "baris data pada katalog ini akan dihapus permanen, termasuk yang diimpor dari CSV."],
    ["CSV upload format: columns", "Format CSV upload: kolom"],
    ["required", "wajib"],
    ["fill only fields relevant to the category; the rest may be left blank.", "hanya isi yang relevan untuk kategori tersebut, sisanya boleh kosong."],
    ["Category values may use short names", "Nilai Kategori boleh nama singkat"],
    ["or full names", "atau nama panjangnya"],
    ["automatically matched to the corresponding category.", "otomatis dicocokkan ke kategori yang sesuai."],
    ["New IDs will be", "ID baru akan"],
    ["added", "ditambahkan"],
    ["as new rows.", "sebagai baris baru."],
    ["For IDs already in the catalog", "Untuk ID yang sudah ada di katalog"],
    ["prices in the newly uploaded CSV are treated as", "harga pada CSV yang baru diupload dianggap sebagai"],
    ["the latest vendor price", "harga terbaru dari vendor"],
    ["value", "nilai"],
    ["the old value automatically shifts into the reference", "yang lama otomatis bergeser jadi referensi"],
    ["so vendor price history can always be viewed.", "supaya histori pergerakan harga vendor selalu bisa dilihat."],
    ["The Latest Price (Live) column can also be edited directly in this table at any time", "Kolom Harga Terbaru (Live) juga bisa diedit langsung di tabel ini kapan saja"],
    ["the system will show a confirmation before saving", "sistem akan menampilkan konfirmasi sebelum menyimpan"],
    ["then automatically shift the old price to Dec '25/Sep '25", "lalu otomatis menggeser harga lama ke Des '25/Sep '25"],
    ["and update the date in the Last Updated column.", "dan memperbarui tanggal pada kolom Update Terakhir."],
    ["The Latest Price (Live) and Last Updated columns are managed automatically by the system and do not need to be included in the CSV file.", "Kolom Harga Terbaru (Live) dan Update Terakhir dikelola otomatis oleh sistem dan tidak perlu ada di file CSV."],
    ["You can also drag & drop a CSV file directly onto this page", "Anda juga bisa langsung drag & drop file CSV ke halaman ini"],
    ["there is no need to click the Upload CSV button", "tidak perlu klik tombol Upload CSV"],
    ["the Catalog data will be updated automatically.", "data Katalog akan otomatis diperbarui."],
    ["Drop the CSV file here to update the Catalog", "Lepaskan file CSV di sini untuk memperbarui Katalog"],
    ["CSV imported successfully", "Berhasil impor CSV"],
    ["new rows added", "baris baru ditambahkan"],
    ["item prices updated (live)", "harga item diperbarui (live)"],
    ["rows skipped", "baris dilewati"],
    ["Failed to read the CSV file.", "Gagal membaca file CSV."],
    ["No valid rows found. Check the Category column in the CSV.", "Tidak ada baris valid ditemukan. Periksa kolom Kategori pada CSV."],

]

const uiTextMap = new Map();
uiTextTranslations.forEach(([en, id]) => {
    uiTextMap.set(en.trim(), { en: en.trim(), id: id.trim() });
    uiTextMap.set(id.trim(), { en: en.trim(), id: id.trim() });
});
additionalUiTextTranslations.forEach(([en, id]) => {
    uiTextMap.set(en.trim(), { en: en.trim(), id: id.trim() });
    uiTextMap.set(id.trim(), { en: en.trim(), id: id.trim() });
});

function translateDynamicText(value, lang) {
    if (!value) return value;
    const trimmed = value.trim();
    if (trimmed === "Mengisi Daya") {
        return value.replace(trimmed, lang === "en" ? "Charging" : "Mengisi Daya");
    }
    const pair = uiTextMap.get(trimmed);
    if (pair) return value.replace(trimmed, pair[lang]);

    // Composite strings built by joining several pieces with " · ", e.g.
    // "Inspeksi Preventif Rutin · 22 Agu 2026 · Teknisi Budi" (Maintenance
    // Summary card). Each piece is set as ONE text node by the page's JS,
    // so a plain uiTextMap lookup on the whole string never matches. Split
    // on the separator, translate each piece independently, then rejoin.
    if (trimmed.includes(" · ") && !uiTextMap.has(trimmed)) {
        const parts = trimmed.split(" · ");
        const translatedParts = parts.map((part) => translateDynamicText(part, lang));
        if (translatedParts.some((p, i) => p !== parts[i])) {
            return value.replace(trimmed, translatedParts.join(" · "));
        }
    }

    let m = trimmed.match(/^Manage Projects(?: \((\d+)\))?$/);
    if (m) return lang === "id" ? `Kelola Proyek${m[1] ? ` (${m[1]})` : ""}` : `Manage Projects${m[1] ? ` (${m[1]})` : ""}`;

    m = trimmed.match(/^Showing (\d+) of (\d+) users$/);
    if (m) return lang === "id" ? `Menampilkan ${m[1]} dari ${m[2]} pengguna` : `Showing ${m[1]} of ${m[2]} users`;

    m = trimmed.match(/^Menampilkan (\d+)-(\d+) dari (\d+) aktivitas$/);
    if (m) return lang === "en" ? `Showing ${m[1]}-${m[2]} of ${m[3]} activities` : trimmed;

    m = trimmed.match(/^Showing (\d+)-(\d+) of (\d+) activities$/);
    if (m) return lang === "id" ? `Menampilkan ${m[1]}-${m[2]} dari ${m[3]} aktivitas` : trimmed;

    m = trimmed.match(/^(\d+) aktivitas$/);
    if (m) return lang === "en" ? `${m[1]} activities` : trimmed;

    m = trimmed.match(/^(\d+) activities$/);
    if (m) return lang === "id" ? `${m[1]} aktivitas` : trimmed;

    m = trimmed.match(/^(\d+) jam lalu$/i);
    if (m) return lang === "en" ? `${m[1]} ${m[1] === "1" ? "hour" : "hours"} ago` : trimmed;

    m = trimmed.match(/^(\d+) (hour|hours) ago$/i);
    if (m) return lang === "id" ? `${m[1]} jam lalu` : trimmed;

    m = trimmed.match(/^(\d+) menit lalu$/i);
    if (m) return lang === "en" ? `${m[1]} ${m[1] === "1" ? "minute" : "minutes"} ago` : trimmed;

    m = trimmed.match(/^(\d+) (minute|minutes) ago$/i);
    if (m) return lang === "id" ? `${m[1]} menit lalu` : trimmed;

    m = trimmed.match(/^(\d+) hari lalu$/i);
    if (m) return lang === "en" ? `${m[1]} ${m[1] === "1" ? "day" : "days"} ago` : trimmed;

    m = trimmed.match(/^(\d+) (day|days) ago$/i);
    if (m) return lang === "id" ? `${m[1]} hari lalu` : trimmed;

    m = trimmed.match(/^(\d+) minggu lalu$/i);
    if (m) return lang === "en" ? `${m[1]} ${m[1] === "1" ? "week" : "weeks"} ago` : trimmed;

    m = trimmed.match(/^(\d+) (week|weeks) ago$/i);
    if (m) return lang === "id" ? `${m[1]} minggu lalu` : trimmed;

    m = trimmed.match(/^Teknisi (.+)$/i);
    if (m) return lang === "en" ? `Technician ${m[1]}` : trimmed;

    m = trimmed.match(/^Technician (.+)$/i);
    if (m) return lang === "id" ? `Teknisi ${m[1]}` : trimmed;

    {
      const idToEnMonth = { "Jan": "Jan", "Feb": "Feb", "Mar": "Mar", "Apr": "Apr", "Mei": "May", "Jun": "Jun", "Jul": "Jul", "Agu": "Aug", "Sep": "Sep", "Okt": "Oct", "Nov": "Nov", "Des": "Dec" };
      const enToIdMonth = { "Jan": "Jan", "Feb": "Feb", "Mar": "Mar", "Apr": "Apr", "May": "Mei", "Jun": "Jun", "Jul": "Jul", "Aug": "Agu", "Sep": "Sep", "Oct": "Okt", "Nov": "Nov", "Dec": "Des" };
      m = trimmed.match(/^(\d{1,2}) (Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des) (\d{4})$/);
      if (m) return lang === "en" ? `${m[1]} ${idToEnMonth[m[2]]} ${m[3]}` : trimmed;
      m = trimmed.match(/^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/);
      if (m) return lang === "id" ? `${m[1]} ${enToIdMonth[m[2]]} ${m[3]}` : trimmed;

      // "Mon D, YYYY" format (e.g. dashboard's Points of Interest list:
      // "Aug 8, 2026"). Different token order/punctuation from the "D Mon
      // YYYY" pattern above, so it needs its own match.
      m = trimmed.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/);
      if (m) return lang === "id" ? `${m[2]} ${enToIdMonth[m[1]]} ${m[3]}` : trimmed;
    }

    {
      const riskEnToId = { "High": "Tinggi", "Medium": "Sedang", "Low": "Rendah" };
      const riskIdToEn = { "Tinggi": "High", "Sedang": "Medium", "Rendah": "Low" };
      m = trimmed.match(/^(High|Medium|Low) Risk · (\d+)%$/);
      if (m) return lang === "id" ? `Risiko ${riskEnToId[m[1]]} · ${m[2]}%` : trimmed;
      m = trimmed.match(/^Risiko (Tinggi|Sedang|Rendah) · (\d+)%$/);
      if (m) return lang === "en" ? `${riskIdToEn[m[1]]} Risk · ${m[2]}%` : trimmed;
    }

    m = trimmed.match(/^(\d+(?:\.\d+)?)\s*kWp\s+(Terpasang|Installed)$/i);
    if (m) return lang === "id" ? `${m[1]} kWp Terpasang` : `${m[1]} kWp Installed`;

    m = trimmed.match(/^(\d+(?:\.\d+)?)\s*km\/(j|h)$/i);
    if (m) return lang === "id" ? `${m[1]} km/j` : `${m[1]} km/h`;

    m = trimmed.match(/^oleh\s+(.+)$/i);
    if (m) return lang === "en" ? `by ${m[1]}` : trimmed;

    m = trimmed.match(/^by\s+(.+)$/i);
    if (m) return lang === "id" ? `oleh ${m[1]}` : trimmed;

    m = trimmed.match(/^Beralih ke station\s+(.+)$/i);
    if (m) return lang === "en" ? `Switched to station ${m[1]}` : trimmed;

    m = trimmed.match(/^Switched to station\s+(.+)$/i);
    if (m) return lang === "id" ? `Beralih ke station ${m[1]}` : trimmed;

    m = trimmed.match(/^(.+) ditandai (Mengisi Daya|Siap Ditukar)$/i);
    if (m) return lang === "en" ? `${m[1]} marked ${m[2] === "Mengisi Daya" ? "Charging" : "Ready to Swap"}` : trimmed;

    m = trimmed.match(/^(.+) marked (Charging|Ready to Swap)$/i);
    if (m) return lang === "id" ? `${m[1]} ditandai ${m[2] === "Charging" ? "Mengisi Daya" : "Siap Ditukar"}` : trimmed;

    m = trimmed.match(/^Diperbarui\s+(.+)$/i);
    if (m) return lang === "en" ? `Updated ${m[1]}` : trimmed;

    m = trimmed.match(/^Updated\s+(.+)$/i);
    if (m) return lang === "id" ? `Diperbarui ${m[1]}` : trimmed;

    m = trimmed.match(/^Diselesaikan\s+(.+)$/i);
    if (m) return lang === "en" ? `Completed ${translateDynamicText(m[1], lang)}` : trimmed;

    m = trimmed.match(/^Completed\s+(\d{1,2}\s+\w+\s+\d{4})$/i);
    if (m) return lang === "id" ? `Diselesaikan ${translateDynamicText(m[1], lang)}` : trimmed;

    m = trimmed.match(/^≈\s*Rp\s*([\d.,]+)\s*estimated bill savings$/i);
    if (m) return lang === "id" ? `≈ Rp ${m[1]} estimasi penghematan tagihan` : trimmed;

    m = trimmed.match(/^≈\s*Rp\s*([\d.,]+)\s*estimasi penghematan tagihan$/i);
    if (m) return lang === "en" ? `≈ Rp ${m[1]} estimated bill savings` : trimmed;

    m = trimmed.match(/^(\d+)% of ([\d.]+) MWh target$/i);
    if (m) return lang === "id" ? `${m[1]}% dari target ${m[2]} MWh` : trimmed;

    m = trimmed.match(/^(\d+)% dari target ([\d.]+) MWh$/i);
    if (m) return lang === "en" ? `${m[1]}% of ${m[2]} MWh target` : trimmed;

    m = trimmed.match(/^([+-]?\d+)% vs last week$/i);
    if (m) return lang === "id" ? `${m[1]}% vs minggu lalu` : trimmed;

    m = trimmed.match(/^([+-]?\d+)% vs minggu lalu$/i);
    if (m) return lang === "en" ? `${m[1]}% vs last week` : trimmed;

    m = trimmed.match(/^(\()?(\d+)% of target(\))?$/i);
    if (m) return lang === "id" ? `${m[1] || ""}${m[2]}% dari target${m[3] || ""}` : trimmed;

    m = trimmed.match(/^(\()?(\d+)% dari target(\))?$/i);
    if (m) return lang === "en" ? `${m[1] || ""}${m[2]}% of target${m[3] || ""}` : trimmed;

    m = trimmed.match(/^([+-]?\d+)% vs previous period$/i);
    if (m) return lang === "id" ? `${m[1]}% dibanding periode sebelumnya` : trimmed;
    m = trimmed.match(/^([+-]?\d+)% dibanding periode sebelumnya$/i);
    if (m) return lang === "en" ? `${m[1]}% vs previous period` : trimmed;

    m = trimmed.match(/^(\d+) activities$/i);
    if (m) return lang === "id" ? `${m[1]} aktivitas` : trimmed;
    m = trimmed.match(/^(\d+) aktivitas$/i);
    if (m) return lang === "en" ? `${m[1]} activities` : trimmed;

    m = trimmed.match(/^(\d+) series selected$/i);
    if (m) return lang === "id" ? `${m[1]} seri dipilih` : trimmed;
    m = trimmed.match(/^(\d+) seri dipilih$/i);
    if (m) return lang === "en" ? `${m[1]} series selected` : trimmed;

    m = trimmed.match(/^(\d+) rows total$/i);
    if (m) return lang === "id" ? `${m[1]} baris total` : trimmed;
    m = trimmed.match(/^(\d+) baris total$/i);
    if (m) return lang === "en" ? `${m[1]} rows total` : trimmed;

    m = trimmed.match(/^Page (\d+) of (\d+)$/i);
    if (m) return lang === "id" ? `Halaman ${m[1]} dari ${m[2]}` : trimmed;
    m = trimmed.match(/^Halaman (\d+) dari (\d+)$/i);
    if (m) return lang === "en" ? `Page ${m[1]} of ${m[2]}` : trimmed;

    m = trimmed.match(/^(\d+) days?$/i);
    if (m) return lang === "id" ? `${m[1]} hari` : trimmed;
    m = trimmed.match(/^(\d+) hari$/i);
    if (m) return lang === "en" ? `${m[1]} ${m[1] === "1" ? "day" : "days"}` : trimmed;

    // --- Admin Calculator dynamic strings (value/number embedded in the
    // same text node, so a plain uiTextMap exact-match can never hit) ---

    m = trimmed.match(/^Active Configuration — (.+)$/);
    if (m) return lang === "id" ? `Konfigurasi Aktif — ${m[1]}` : trimmed;
    m = trimmed.match(/^Konfigurasi Aktif — (.+)$/);
    if (m) return lang === "en" ? `Active Configuration — ${m[1]}` : trimmed;

    m = trimmed.match(/^Abs\. limit: (.+)$/);
    if (m) return lang === "id" ? `Batas Abs.: ${m[1]}` : trimmed;
    m = trimmed.match(/^Batas Abs\.: (.+)$/);
    if (m) return lang === "en" ? `Abs. limit: ${m[1]}` : trimmed;

    m = trimmed.match(/^(\d+) string total$/);
    if (m) return lang === "id" ? `${m[1]} total string` : trimmed;
    m = trimmed.match(/^(\d+) total string$/);
    if (m) return lang === "en" ? `${m[1]} string total` : trimmed;

    m = trimmed.match(/^Uniform string configuration: (\d+) string × (\d+) panel\/string\.$/);
    if (m) return lang === "id" ? `Konfigurasi string seragam: ${m[1]} string × ${m[2]} panel/string.` : trimmed;
    m = trimmed.match(/^Konfigurasi string seragam: (\d+) string × (\d+) panel\/string\.$/);
    if (m) return lang === "en" ? `Uniform string configuration: ${m[1]} string × ${m[2]} panel/string.` : trimmed;

    m = trimmed.match(/^Voc cold ([\d.,]+)V is still below the ([\d.,]+)V limit\.$/);
    if (m) return lang === "id" ? `Voc cold ${m[1]}V masih di bawah batas ${m[2]}V.` : trimmed;
    m = trimmed.match(/^Voc cold ([\d.,]+)V masih di bawah batas ([\d.,]+)V\.$/);
    if (m) return lang === "en" ? `Voc cold ${m[1]}V is still below the ${m[2]}V limit.` : trimmed;

    m = trimmed.match(/^⚠ Voc cold ([\d.,]+)V exceeds the ([\d.,]+)V limit\.$/);
    if (m) return lang === "id" ? `⚠ Voc cold ${m[1]}V melebihi batas ${m[2]}V.` : trimmed;
    m = trimmed.match(/^⚠ Voc cold ([\d.,]+)V melebihi batas ([\d.,]+)V\.$/);
    if (m) return lang === "en" ? `⚠ Voc cold ${m[1]}V exceeds the ${m[2]}V limit.` : trimmed;

    m = trimmed.match(/^PV inverter (.+)$/);
    if (m) return lang === "id" ? `Inverter PV ${m[1]}` : trimmed;
    m = trimmed.match(/^Inverter PV (.+)$/);
    if (m) return lang === "en" ? `PV inverter ${m[1]}` : trimmed;

    m = trimmed.match(/^\(([\d.,]+) kWh\/day\)$/);
    if (m) return lang === "id" ? `(${m[1]} kWh/hari)` : trimmed;
    m = trimmed.match(/^\(([\d.,]+) kWh\/hari\)$/);
    if (m) return lang === "en" ? `(${m[1]} kWh/day)` : trimmed;

    m = trimmed.match(/^([\d.,]+) kWh\/day$/);
    if (m) return lang === "id" ? `${m[1]} kWh/hari` : trimmed;
    m = trimmed.match(/^([\d.,]+) kWh\/hari$/);
    if (m) return lang === "en" ? `${m[1]} kWh/day` : trimmed;

    m = trimmed.match(/^([\d.,]+) kWh\/month$/);
    if (m) return lang === "id" ? `${m[1]} kWh/bulan` : trimmed;
    m = trimmed.match(/^([\d.,]+) kWh\/bulan$/);
    if (m) return lang === "en" ? `${m[1]} kWh/month` : trimmed;

    m = trimmed.match(/^([\d.,]+) MWh\/yr$/);
    if (m) return lang === "id" ? `${m[1]} MWh/thn` : trimmed;
    m = trimmed.match(/^([\d.,]+) MWh\/thn$/);
    if (m) return lang === "en" ? `${m[1]} MWh/yr` : trimmed;

    m = trimmed.match(/^([\d.,]+) h\/day$/);
    if (m) return lang === "id" ? `${m[1]} j/hari` : trimmed;
    m = trimmed.match(/^([\d.,]+) j\/hari$/);
    if (m) return lang === "en" ? `${m[1]} h/day` : trimmed;

    m = trimmed.match(/^Technical (\d+)\/100$/);
    if (m) return lang === "id" ? `Teknis ${m[1]}/100` : trimmed;
    m = trimmed.match(/^Teknis (\d+)\/100$/);
    if (m) return lang === "en" ? `Technical ${m[1]}/100` : trimmed;

    m = trimmed.match(/^\((\d+) panels? ([\d.,]+)Wp\) uses the$/);
    if (m) return lang === "id" ? `(${m[1]} panel ${m[2]}Wp) menggunakan` : trimmed;
    m = trimmed.match(/^\((\d+) panel ([\d.,]+)Wp\) menggunakan$/);
    if (m) return lang === "en" ? `(${m[1]} panels ${m[2]}Wp) uses the` : trimmed;

    m = trimmed.match(/^([\d.,]+) V — (✓ Safe|✕ Exceeds limit)$/);
    if (m) return lang === "id" ? `${m[1]} V — ${m[2] === "✓ Safe" ? "✓ Aman" : "✕ Melebihi batas"}` : trimmed;
    m = trimmed.match(/^([\d.,]+) V — (✓ Aman|✕ Melebihi batas)$/);
    if (m) return lang === "en" ? `${m[1]} V — ${m[2] === "✓ Aman" ? "✓ Safe" : "✕ Exceeds limit"}` : trimmed;

    return value;
}

function updateCatalogCsvHintLanguage(lang) {
    const el = document.getElementById("spCatalogCsvHint");
    if (!el) return;

    if (lang === "en") {
        el.innerHTML = `
          CSV upload format: columns <strong>ID, Category, Name, Unit, Size (kW), HPP, Dec '25, Sep '25, Notes</strong>
          (required), plus optional technical specification columns (<strong>Capacity kW/Wp/kWh, Voc, Vmpp, Impp, MPPT, L, W</strong>)
          — only fill in values relevant to that category, the rest may be left blank. Category values may use short names
          (e.g. "PDI", "DC Cable") or full names (e.g. "Inverter Distribution Panel", "PV Cable (DC)") —
          automatically matched to the corresponding category. New IDs will be <strong>added</strong> as new rows.
          For IDs already in the catalog, prices in the newly uploaded CSV are treated as the
          <strong>latest vendor price</strong>: the old <strong>Latest Price (Live)</strong> value automatically
          shifts to <strong>Dec '25</strong>, and the old Dec '25 value shifts to <strong>Sep '25</strong> —
          so vendor price history can always be viewed. The <strong>Latest Price (Live)</strong> column can also be edited
          <strong>directly in this table</strong> at any time — the system will show a confirmation before saving,
          then automatically shift the old price to Dec '25/Sep '25 and update the date in the
          <strong>Last Updated</strong> column. The Latest Price (Live) and Last Updated columns are managed automatically
          by the system and <strong>do not need</strong> to be included in the CSV file.
          You can also <strong>drag &amp; drop a CSV file</strong> directly onto this page — there is no need to click the
          Upload CSV button; the Catalog data will be updated automatically.
        `;
    } else {
        el.innerHTML = `
          Format CSV upload: kolom <strong>ID, Kategori/Category, Nama/Name, Satuan/Unit, Ukuran (kW)/Size (kW), HPP, Des '25/Dec '25, Sep '25, Catatan/Notes</strong>
          (wajib), plus kolom spesifikasi teknik opsional (<strong>Kapasitas kW/Wp/kWh, Voc, Vmpp, Impp, MPPT, L, W</strong>)
          — hanya isi yang relevan untuk kategori tersebut, sisanya boleh kosong. Nilai Kategori boleh nama singkat
          (mis. "PDI", "Kabel DC") atau nama panjangnya (mis. "Panel Distribusi Inverter", "Kabel PV (DC)") —
          otomatis dicocokkan ke kategori yang sesuai. ID baru akan <strong>ditambahkan</strong> sebagai baris baru.
          Untuk ID yang sudah ada di katalog, harga pada CSV yang baru diupload dianggap sebagai
          <strong>harga terbaru dari vendor</strong>: nilai <strong>Harga Terbaru (Live)</strong> yang lama otomatis
          bergeser jadi referensi <strong>Des '25</strong>, dan nilai Des '25 yang lama bergeser jadi
          <strong>Sep '25</strong> — supaya histori pergerakan harga vendor selalu bisa dilihat.
          Kolom <strong>Harga Terbaru (Live)</strong> juga bisa diedit <strong>langsung di tabel</strong> ini kapan
          saja — sistem akan menampilkan konfirmasi sebelum menyimpan, lalu otomatis menggeser harga lama ke
          Des '25/Sep '25 dan memperbarui tanggal pada kolom <strong>Update Terakhir</strong>. Kolom Harga Terbaru
          (Live) dan Update Terakhir dikelola otomatis oleh sistem dan <strong>tidak perlu</strong> ada di file CSV.
          Anda juga bisa langsung <strong>drag &amp; drop file CSV</strong> ke halaman ini — tidak perlu klik tombol
          Upload CSV, data Katalog akan otomatis diperbarui.
        `;
    }
}

function applyUniversalLanguage(lang) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    // The "Task Management" tab inside Project Monitoring (#pmPanel-task,
    // loaded from pages/task-management.html) goes through the same
    // dictionary/observer translation as every other page. Static UI text
    // is translated, while task data marked with data-no-translate stays
    // exactly as saved, even when it happens to match a dictionary phrase.

    nodes.forEach((node) => {
        if (!node.nodeValue || !node.nodeValue.trim()) return;
        const parent = node.parentElement;
        if (parent && ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) return;

        // User-entered / stored task data must remain exactly as saved.
        // This prevents free-form maintenance content from being translated
        // just because it happens to match a phrase in the UI dictionary.
        if (parent && parent.closest("[data-no-translate]")) return;

        const next = translateDynamicText(node.nodeValue, lang);
        if (next !== node.nodeValue) node.nodeValue = next;
    });

    document.querySelectorAll("input[placeholder], textarea[placeholder], [title], [aria-label]").forEach((el) => {
        ["placeholder", "title", "aria-label"].forEach((attr) => {
            const value = el.getAttribute(attr);
            if (!value) return;
            const next = translateDynamicText(value, lang);
            if (next !== value) el.setAttribute(attr, next);
        });
    });

    document.querySelectorAll("option").forEach((option) => {
        const next = translateDynamicText(option.textContent, lang);
        if (next !== option.textContent) option.textContent = next;
    });
}

// Small Yes/No helper that always matches the currently active language,
// used for boolean fields (e.g. "Problem Fixed") rendered by other page
// scripts. Kept separate from additionalUiTextTranslations because bare
// "No" collides with unrelated "No" (row number) table headers elsewhere.
function yesNoText(value) {
    const isId = getSavedLanguage() === "id";
    return value ? (isId ? "Ya" : "Yes") : (isId ? "Tidak" : "No");
}

function t(key) {
    const lang = getSavedLanguage();
    return (translations[lang] && translations[lang][key]) ||
           (translations.id && translations.id[key]) || key;
}

function getSavedLanguage() {

    return localStorage.getItem("edash-lang") || "en";

}

function applySavedTheme() {
    const theme = localStorage.getItem("edash-theme") === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;

    // Sinkronkan tampilan toggle di header (kalau sudah ke-render) supaya
    // posisi thumb & aria-checked selalu cocok sama data-theme saat ini --
    // dipanggil baik di startup awal maupun tiap kali user klik toggle-nya
    // sendiri (lihat themeSwitcher()), jadi satu fungsi ini yang jadi
    // sumber kebenaran tunggal buat apply state ke DOM.
    const toggle = document.getElementById("hdThemeToggle");
    if (toggle) {
        toggle.setAttribute("aria-checked", theme === "dark" ? "true" : "false");
    }
}

function applyLanguage(lang) {

    const dict = translations[lang] || translations.id;

    document.querySelectorAll("[data-i18n]").forEach((el) => {

        const key = el.getAttribute("data-i18n");

        if (dict[key]) {
            el.textContent = dict[key];
        }

    });

    // Placeholder text on <input>/<textarea>/<select> marked with
    // data-i18n-placeholder="dictionary.key" -- separate from the
    // data-i18n walker above because .placeholder is an attribute, not
    // a text node. Used by pages/ticketing.html (e.g. Expected Time,
    // "type the page/feature name" fields) so their placeholder text
    // switches instantly with the rest of the page instead of relying
    // on the fragile literal-text reverse lookup in translateDynamicText().
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const key = el.getAttribute("data-i18n-placeholder");
        if (dict[key]) el.setAttribute("placeholder", dict[key]);
    });

    // CSS-only tooltips rendered via `content: attr(data-tooltip)` (see
    // .tk-priority-info::after in css/ticketing.css) live OUTSIDE the DOM
    // text tree entirely, so neither the data-i18n walker nor the
    // input[placeholder]/[title] pass in applyUniversalLanguage() can
    // reach them. Elements that want a translated tooltip mark BOTH
    // data-i18n-tooltip="dictionary.key" (source of truth) and a
    // data-tooltip="..." fallback (English, shown before JS runs).
    document.querySelectorAll("[data-i18n-tooltip]").forEach((el) => {
        const key = el.getAttribute("data-i18n-tooltip");
        if (dict[key]) el.setAttribute("data-tooltip", dict[key]);
    });

    const currentLabel = document.getElementById("hdLangCurrent");

    if (currentLabel) {
        currentLabel.textContent = lang.toUpperCase();
    }

    localStorage.setItem("edash-lang", lang);
    applyUniversalLanguage(lang);
    updateCatalogCsvHintLanguage(lang);

    // Canvas-drawn content (e.g. Chart.js charts) is invisible to the DOM
    // text walker above, since it's pixels, not text nodes. Pages that
    // render language-sensitive canvas content (like the Energy Production
    // chart's date-axis labels) listen for this event to redraw themselves.
    document.dispatchEvent(new CustomEvent("edash:languagechange", { detail: { lang } }));

}

function languageSwitcher() {

    const toggle = document.getElementById("hdLangToggle");

    if (!toggle) return;

    toggle.onclick = () => {

        const nextLang = getSavedLanguage() === "id" ? "en" : "id";

        applyLanguage(nextLang);

        if (typeof logActivity === "function") {
            logActivity({
                eventType: "language_switch",
                user: sessionStorage.getItem("edash-user") || "Anonymous",
                userRole: sessionStorage.getItem("edash-role") || null,
                status: "success",
                detail: nextLang === "id" ? "Switched dashboard language to Indonesian" : "Switched dashboard language to English",
                data: { language: nextLang },
            });
        }

    };

}

// Toggle Light/Dark mode di header (di sebelah language switch). Pola dan
// tempat pemanggilannya SENGAJA dibuat mirip languageSwitcher() di atas --
// baca lebih lanjut soal kenapa "edash-theme" jadi satu-satunya sumber
// kebenaran di applySavedTheme(). Toggle Appearance di halaman Settings
// (js/setting.js) pakai key localStorage yang SAMA persis, jadi otomatis
// tetap sinkron dua arah tanpa perlu event/broadcast tambahan -- begitu
// salah satu diubah, yang lain ikut benar begitu applySavedTheme()
// dipanggil ulang (mis. pas pindah halaman/reload).
function themeSwitcher() {

    const toggle = document.getElementById("hdThemeToggle");

    if (!toggle) return;

    // Sinkronkan aria-checked begitu toggle ini benar-benar ada di DOM --
    // applySavedTheme() sendiri dipanggil lebih dulu di initializeDashboard()
    // SEBELUM header di-inject, jadi upaya sync-nya di sana no-op waktu itu
    // (elemen belum ada). Set ulang di sini supaya benar sejak awal.
    toggle.setAttribute("aria-checked", localStorage.getItem("edash-theme") === "dark" ? "true" : "false");

    toggle.onclick = () => {

        const nextTheme = localStorage.getItem("edash-theme") === "dark" ? "light" : "dark";

        localStorage.setItem("edash-theme", nextTheme);
        applySavedTheme();

        if (typeof logActivity === "function") {
            logActivity({
                eventType: "theme_switch",
                user: sessionStorage.getItem("edash-user") || "Anonymous",
                userRole: sessionStorage.getItem("edash-role") || null,
                status: "success",
                detail: nextTheme === "dark" ? "Switched dashboard theme to Dark mode" : "Switched dashboard theme to Light mode",
                data: { theme: nextTheme },
            });
        }

    };

}

// Keep newly-rendered/dynamic page content translated as well.
let edashLanguageObserver = null;
function initUniversalLanguageObserver() {
    if (edashLanguageObserver || !document.body) return;
    edashLanguageObserver = new MutationObserver(() => {
        applyUniversalLanguage(getSavedLanguage());
    });
    edashLanguageObserver.observe(document.body, { childList: true, subtree: true });
}

// =============================
// Sidebar Toggle
// =============================

function sidebarToggle() {

    const sidebar = document.getElementById("edashSidebar");
    const button = document.getElementById("sbToggle");
    const menuButton = document.getElementById("hdMenuToggle");
    const backdrop = document.getElementById("edashSidebarBackdrop");

    if (!sidebar) return;

    const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

    const openMobileSidebar = () => {
        sidebar.classList.add("is-open");
        if (backdrop) backdrop.classList.add("is-open");
        if (menuButton) menuButton.setAttribute("aria-expanded", "true");
        document.body.style.overflow = "hidden";
    };

    const closeMobileSidebar = () => {
        sidebar.classList.remove("is-open");
        if (backdrop) backdrop.classList.remove("is-open");
        if (menuButton) menuButton.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
    };

    // Desktop/laptop: the in-sidebar button collapses it to a narrow
    // icon rail. Mobile/tablet (<=900px): the sidebar is off-canvas,
    // so the SAME button instead opens/closes it as a drawer.
    if (button) {
        button.onclick = () => {
            if (isMobile()) {
                sidebar.classList.contains("is-open")
                    ? closeMobileSidebar()
                    : openMobileSidebar();
            } else {
                sidebar.classList.toggle("is-collapsed");
                // Let any MapLibre map on the current page know its container
                // just resized (sidebar width change), so it can re-measure
                // itself — otherwise the map stays cropped/misaligned to its
                // old width until the next manual resize/refresh.
                document.dispatchEvent(new CustomEvent("edash:sidebartoggle"));
                setTimeout(() => {
                    document.dispatchEvent(new CustomEvent("edash:sidebartoggle"));
                }, 260); // matches the sidebar's width transition duration
            }
        };
    }

    // Hamburger button in the header (only visible <=900px) opens the
    // same off-canvas drawer.
    if (menuButton) {
        menuButton.onclick = () => {
            sidebar.classList.contains("is-open")
                ? closeMobileSidebar()
                : openMobileSidebar();
        };
    }

    // Tapping the dimmed backdrop closes the drawer.
    if (backdrop) {
        backdrop.onclick = () => closeMobileSidebar();
    }

    // Esc key closes the drawer.
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && sidebar.classList.contains("is-open")) {
            closeMobileSidebar();
        }
    });

    // Picking a nav item on mobile should close the drawer so the
    // user immediately sees the page they navigated to.
    sidebar.addEventListener("click", (e) => {
        if (!isMobile()) return;
        const target = e.target.closest("a, button");
        if (target && !target.closest(".sb-brand")) {
            closeMobileSidebar();
        }
    });

    // If the window is resized from mobile back to desktop width
    // while the drawer is open, clear the mobile-only state so it
    // doesn't linger.
    window.addEventListener("resize", () => {
        if (!isMobile()) closeMobileSidebar();
    });

}

// =============================
// Sidebar Active State + Page Navigation
// =============================

function sidebarActiveState() {

    const dashboardBtn = document.getElementById("sbDashboardBtn");
    const navItems = document.querySelectorAll(".sb-nav-item");

    if (!dashboardBtn) return;

    dashboardBtn.addEventListener("click", () => {

        dashboardBtn.classList.add("is-active");
        navItems.forEach((el) => el.classList.remove("is-active"));

        loadPage("pages/dashboard.html");

    });

    navItems.forEach((item) => {

        item.addEventListener("click", (e) => {

            dashboardBtn.classList.remove("is-active");
            navItems.forEach((el) => el.classList.remove("is-active"));
            item.classList.add("is-active");

            const page = item.getAttribute("data-page");

            if (page) {
                e.preventDefault();
                loadPage(page);
            }

        });

    });

}

// =============================
// Role-based Sidebar (Operator)
// =============================
// Operator accounts only get a slimmed-down sidebar: Project Monitoring
// (relabeled "Dashboard"), Alerts, Task Maintenance, Admin View, Setting,
// and Logout — no Project Selector, Tools group, or Activity Log. This
// only runs (and only hides/relabels) when the logged-in role is client
// tier (operator/staff); Admin360's & internal roles' sidebar are
// untouched by this function.
function applyOperatorSidebar() {

    const role = sessionStorage.getItem("edash-role");
    const isClientTier = role === "operator" || role === "staff";

    if (!isClientTier) return;

    const quickActions = document.querySelector(".sb-quick-actions");
    if (quickActions) quickActions.style.display = "none";

    const projectSelector = document.querySelector(
        '.sb-nav-item[data-page="pages/project-selector.html"]'
    );
    if (projectSelector) projectSelector.style.display = "none";

    const toolsTitle = document.querySelector('.sb-nav-title[data-i18n="sidebar.nav.tools"]');
    const toolsGroup = toolsTitle ? toolsTitle.closest(".sb-nav-group") : null;
    if (toolsGroup) toolsGroup.style.display = "none";

    // Neither operator nor staff has a right to Activity Log.
    const activityLogItem = document.querySelector(
        '.sb-nav-item[data-page="pages/activity-log.html"]'
    );
    if (activityLogItem) activityLogItem.style.display = "none";

    // Ticketing (WebDev) is internal-only: root/360master + biofloc &
    // REMS intern leads/interns. Client tier (operator, staff) can't
    // submit or see WebDev tickets. (Tidak ada di PAGE_PERMISSION_MAP
    // karena backend-nya digate requireInternalOrRoot per-tier, bukan
    // requirePermission per-capability, jadi applyPermissionSidebar()
    // tidak menyembunyikan ini -- harus tetap di-hardcode di sini.)
    const ticketingItem = document.querySelector(
        '.sb-nav-item[data-page="pages/ticketing.html"]'
    );
    if (ticketingItem) ticketingItem.style.display = "none";

    // Operator & staff: relabel "Project Monitoring" -> "Dashboard", point
    // it at the Operator Dashboard page instead of Admin 360's Project
    // Monitoring, and swap its icon for a chart icon (reuses the existing
    // sidebar.dashboard translation key so the label stays correct on
    // language switch). Staff now shares the same Operator Dashboard page
    // as operator (js/operator/operator-dashboard.js already scopes it to
    // whichever project the logged-in account is assigned to), instead of
    // Admin 360's Project Monitoring which is meant for root/internal
    // roles overseeing every project.
    if (role === "operator" || role === "staff") {
        const projectMonitoringItem = document.querySelector(
            '.sb-nav-item[data-page="pages/project-monitoring.html"]'
        );
        if (projectMonitoringItem) {
            projectMonitoringItem.setAttribute("data-page", "pages/operator/operator-dashboard.html");
            const label = projectMonitoringItem.querySelector(".sb-nav-label");
            if (label) label.setAttribute("data-i18n", "sidebar.dashboard");
            const icon = projectMonitoringItem.querySelector(".sb-nav-icon i");
            if (icon) icon.setAttribute("class", "fa-solid fa-chart-simple");
        }

    }

}

// =============================
// Hide Empty Nav Groups (e.g. Administration for staff)
// =============================
// Runs AFTER applyPermissionSidebar() & applyOperatorSidebar(), once every
// item's final display has been decided -- hides a nav group's title too
// (not just its items) when NONE of its items are visible for the role
// currently logged in. Staff has no permission ON by default for any item
// under Administration (Admin View, Activity Log, WebDev are all hidden
// for client tier / lack permission), so the group disappears entirely
// instead of showing an empty "Administration" header with nothing under
// it. The moment root turns one of those permissions ON for staff via
// Settings > Role Access and refreshUserSession() re-runs the chain, the
// item reappears and so does the group -- no hardcoding to "staff",
// works for any role/group combination that ends up with zero visible
// items. Footer group (Setting/Logout) is excluded -- it's always shown.
function applyEmptyNavGroupVisibility() {

    document.querySelectorAll(".sb-nav-group:not(.sb-nav-group-footer)").forEach((group) => {

        const hasVisibleItem = Array.from(group.querySelectorAll(".sb-nav-item"))
            .some((item) => item.style.display !== "none");

        group.style.display = hasVisibleItem ? "" : "none";

    });

}

// =============================
// Header Profile (name/role from session + last active dropdown)
// =============================

// Fallback map kalau "edash-role-label" belum/tidak ada di sessionStorage.
// Dulu cuma berisi enum lama (admin360/operator/viewer) yang sudah tidak
// dipakai backend -- makanya role account seperti "staff" jatuh ke "—".
// Sekarang mencakup roleKey asli dari backend juga sebagai jaga-jaga.
const ROLE_LABELS = {
    root: "Admin Master",
    admin360: "Admin 360",
    operator: "Operator",
    staff: "Staff",
    biofloc_intern_lead: "Biofloc Intern Lead",
    rems_intern_lead: "REMS Intern Lead",
    biofloc_intern: "Biofloc Intern",
    rems_intern: "REMS Intern",
    viewer: "Viewer"
};

function getInitials(username) {

    if (!username) return "?";

    const clean = username.split("@")[0].replace(/[._\s]/g, "");

    return clean.slice(0, 2).toUpperCase() || "?";

}

function formatLastActiveID(timestamp) {

    if (!timestamp) return "—";

    const then = Number(timestamp);
    const diffMs = Date.now() - then;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "Baru saja";
    if (diffMin < 60) return `${diffMin} menit yang lalu`;

    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} jam yang lalu`;

    const date = new Date(then);
    const dateLabel = date.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    const timeLabel = date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return `Kemarin, ${timeLabel}`;

    return `${dateLabel}, ${timeLabel}`;

}

// Render satu avatar element (hd-avatar / hd-profile-menu-avatar) --
// pakai foto profil (Settings > Profil) kalau sudah pernah diupload,
// fallback ke inisial nama seperti sebelumnya kalau belum ada foto.
// Dipakai sama-sama oleh populateHeaderProfile() di bawah supaya avatar
// header (ikon kecil) & avatar di dropdown menu-nya selalu konsisten,
// dan otomatis kepakai buat SEMUA role karena elemennya generik (bukan
// di-render ulang per-role).
function applyAvatar(el, photoUrl, initials) {

    if (!el) return;

    if (photoUrl) {
        el.innerHTML = `<img src="${photoUrl}" alt="Foto profil">`;
    } else {
        el.textContent = initials;
    }

}

function populateHeaderProfile() {

    const username = sessionStorage.getItem("edash-user") || "Guest";
    const roleKey = sessionStorage.getItem("edash-role") || "";
    const loginTime = sessionStorage.getItem("edash-login-time");

    // Utamakan roleLabel asli dari backend (disimpan login.js saat login,
    // lihat js/login.js: sessionStorage.setItem("edash-role-label", ...)).
    // ROLE_LABELS[roleKey] cuma fallback kalau label itu kosong/belum ada
    // (mis. sesi lama sebelum field ini ditambahkan).
    const roleLabelFromSession = sessionStorage.getItem("edash-role-label");
    const roleLabel = roleLabelFromSession || ROLE_LABELS[roleKey] || "—";
    const lastActive = formatLastActiveID(loginTime);

    // Full Name & foto profil TERBARU dari Settings > Profil (lihat
    // login.js & refreshUserSession() di atas) -- fallback ke username
    // polos / tanpa foto kalau user belum pernah isi Full Name / upload
    // foto sama sekali (sesi lama, atau akun baru), supaya header tetap
    // tampil rapi bukan kosong.
    const fullName = sessionStorage.getItem("edash-user-fullname") || username;
    const photoUrl = sessionStorage.getItem("edash-user-photo") || "";
    const email = sessionStorage.getItem("edash-user-email") || `${username}@360edash.com`;
    const initials = getInitials(fullName);

    const nameEl = document.getElementById("hdProfileName");
    const roleEl = document.getElementById("hdProfileRole");
    const avatarEl = document.getElementById("hdAvatarInitials");
    const menuAvatarEl = document.getElementById("hdMenuAvatarInitials");
    const menuNameEl = document.getElementById("hdMenuName");
    const menuEmailEl = document.getElementById("hdMenuEmail");
    const menuRoleEl = document.getElementById("hdMenuRole");
    const lastActiveEl = document.getElementById("hdLastActive");
    const greetingNameEl = document.querySelector(".sb-greeting-name");

    if (nameEl) nameEl.textContent = fullName;
    if (roleEl) roleEl.textContent = roleLabel;
    applyAvatar(avatarEl, photoUrl, initials);
    applyAvatar(menuAvatarEl, photoUrl, initials);
    if (menuNameEl) menuNameEl.textContent = fullName;
    if (menuEmailEl) menuEmailEl.textContent = email;
    if (menuRoleEl) menuRoleEl.textContent = roleLabel;
    if (lastActiveEl) lastActiveEl.textContent = lastActive;
    // Sidebar greeting ("Halo, <nama>!") -- selalu pakai Full Name
    // terbaru juga, supaya sinkron dengan header & Settings > Profil.
    if (greetingNameEl) greetingNameEl.textContent = `${fullName}!`;

}

function headerProfileDropdown() {

    const wrap = document.getElementById("hdProfileWrap");
    const trigger = document.getElementById("hdProfile");

    if (!wrap || !trigger) return;

    trigger.addEventListener("click", (e) => {

        e.stopPropagation();

        const isOpen = wrap.classList.toggle("is-open");
        trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");

        // Refresh "last active" every time the dropdown is opened
        if (isOpen) {
            const lastActiveEl = document.getElementById("hdLastActive");
            if (lastActiveEl) {
                lastActiveEl.textContent = formatLastActiveID(sessionStorage.getItem("edash-login-time"));
            }
        }

    });

    document.addEventListener("click", (e) => {
        if (!wrap.contains(e.target)) {
            wrap.classList.remove("is-open");
            trigger.setAttribute("aria-expanded", "false");
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && wrap.classList.contains("is-open")) {
            wrap.classList.remove("is-open");
            trigger.setAttribute("aria-expanded", "false");
        }
    });

    const menuLogoutBtn = document.getElementById("hdMenuLogoutBtn");
    if (menuLogoutBtn) {
        menuLogoutBtn.addEventListener("click", () => {
            wrap.classList.remove("is-open");
            trigger.setAttribute("aria-expanded", "false");
            if (typeof lgOpen === "function") lgOpen();
        });
    }

}

// =============================
// Initialize Dashboard
// =============================

async function initializeDashboard() {

    // Apply saved theme before rendering the shared shell.
    applySavedTheme();

    // Narik ulang role/permission TERBARU dari /auth/me SEBELUM menentukan
    // initialPage di bawah -- supaya kalau permission "dashboard.view" (atau
    // apapun) baru saja di-toggle root lewat Settings > Role Access, hard
    // refresh (F5) langsung mengarah ke halaman yang benar tanpa perlu
    // logout/login ulang dulu. loadPage() di bawah juga sudah manggil ini
    // sendiri setiap pindah halaman (lihat refreshUserSession()).
    //
    // Pakai versi ber-timeout: sessionStorage sudah punya role/permission
    // dari login.js (login) atau boot sebelumnya (refresh), jadi kalau
    // /auth/me sedang lambat (mis. request pertama tepat setelah login),
    // boot TETAP lanjut pakai data yang sudah ada itu -- bukan nge-hang
    // sampai beberapa detik cuma buat menentukan halaman awal. Update
    // terbaru dari /auth/me tetap menyusul di background begitu selesai.
    await refreshUserSessionWithTimeout();

    const initialRole = sessionStorage.getItem("edash-role");
    const initialRoleTier = sessionStorage.getItem("edash-role-tier");

    // Prioritas #1: balikin ke halaman TERAKHIR yang dibuka user sebelum
    // refresh (lihat LAST_PAGE_STORAGE_KEY di loadPage()), supaya hard
    // refresh (F5) tidak selalu "melempar" user balik ke Dashboard. Kalau
    // belum pernah ada (tab baru) atau izinnya sudah dicabut sejak
    // terakhir dibuka, baru jatuh ke logika default role di bawah seperti
    // sebelumnya.
    const lastPage = sessionStorage.getItem(LAST_PAGE_STORAGE_KEY);

    // Ticket deep-link (?ticket=<id>) -- lihat tombol "Copy Link" di modal
    // detail ticket, js/ticketing.js. Kalau URL SPA ini dibuka dengan
    // query param itu (mis. dari link yang dikirim ke channel eksternal),
    // PRIORITASKAN membuka Ticketing dulu, override "halaman terakhir"
    // -- selama role yang sedang login memang boleh akses Ticketing
    // (internal-only, sama seperti isLastPageStillAllowed() di bawah).
    // ticketing.js sendiri yang nanti baca ulang param ini (masih ada di
    // URL) buat tahu ticket mana yang harus langsung dibuka di modal.
    const ticketDeepLinkId = new URLSearchParams(window.location.search).get("ticket");
    const hasTicketDeepLink = !!ticketDeepLinkId && isLastPageStillAllowed("pages/ticketing.html");

    let initialPage;
    if (hasTicketDeepLink) {
        initialPage = "pages/ticketing.html";
    } else if (isLastPageStillAllowed(lastPage)) {
        initialPage = lastPage;
    } else if (initialRole === "operator") {
        initialPage = "pages/operator/operator-dashboard.html";
    } else if (initialRole === "staff") {
        // Staff = hirarki paling bawah, cuma pegang 1 project yang sudah
        // di-assign admin lewat Admin View (lihat AdminService.reassign
        // Project di backend) -- tidak ada gunanya lihat Dashboard
        // (ringkasan SEMUA project) dulu. Sama seperti operator, langsung
        // ke Operator Dashboard (BUKAN Admin 360's Project Monitoring --
        // itu halaman untuk root/internal yang mengawasi semua project),
        // yang otomatis ke-scope ke project miliknya sendiri.
        initialPage = "pages/operator/operator-dashboard.html";
    } else if (initialRoleTier === "root" || hasPermission("dashboard.view")) {
        initialPage = "pages/dashboard.html";
    } else {
        // dashboard.view di-toggle OFF buat role ini -- arahkan ke halaman
        // pertama yang memang boleh diakses, supaya tidak langsung kena
        // layar Access Denied begitu login.
        initialPage = getFirstAllowedPage() || "pages/dashboard.html";
    }

    // IMPORTANT: loadComponent() for the sidebar/header/logout-modal is
    // awaited SEPARATELY from loadPage(initialPage) below (previously all 4
    // were fired together in one Promise.all and awaited as a batch).
    //
    // loadPage() starts with its own `await refreshUserSession()` (an
    // /auth/me network round trip) before it does anything else -- and on
    // the very first page load right after login, that's the first
    // authenticated request this tab has ever made, so it can legitimately
    // take longer (cold TLS/connection, backend/session lookup not warmed
    // up yet) than the plain static-file fetches the sidebar/header need.
    //
    // Because sidebarActiveState() (which binds the sidebar's nav-item
    // click handlers) used to run only AFTER that combined Promise.all
    // resolved, a slow (or failed/retried) /auth/me on first login could
    // leave the sidebar fully visible but completely unresponsive to
    // clicks for as long as loadPage() was still stuck -- which reads to
    // the user as "menu tidak bisa diklik". A hard refresh "fixed" it only
    // because sessionStorage/cookies were already warm by then, so the
    // second /auth/me came back quickly.
    //
    // Splitting these means the sidebar becomes clickable the moment its
    // OWN html is in the DOM, regardless of how long the initial page
    // fetch takes.
    await Promise.all([

        loadComponent(
            "master/sidebar/sidebar.html",
            "#sidebar-root"
        ),

        loadComponent(
            "master/header/header.html",
            "#header-root"
        ),

        loadComponent(
            "master/logout-modal/logout-modal.html",
            "#logout-modal-root"
        )

    ]);

    // Wire up sidebar interactivity right away -- deliberately BEFORE
    // awaiting loadPage(initialPage) below. Each call is isolated in its
    // own try/catch too, so one throwing (e.g. applyPermissionSidebar()
    // hitting unexpected sessionStorage state) can no longer take out
    // sidebarActiveState() -- the actual nav-item click binding -- along
    // with it.
    try { sidebarActiveState(); } catch (err) { console.error("[main] sidebarActiveState failed:", err); }
    try { sidebarToggle(); } catch (err) { console.error("[main] sidebarToggle failed:", err); }
    try { applyPermissionSidebar(); } catch (err) { console.error("[main] applyPermissionSidebar failed:", err); }
    try { applyOperatorSidebar(); } catch (err) { console.error("[main] applyOperatorSidebar failed:", err); }
    try { applyEmptyNavGroupVisibility(); } catch (err) { console.error("[main] applyEmptyNavGroupVisibility failed:", err); }
    try { languageSwitcher(); } catch (err) { console.error("[main] languageSwitcher failed:", err); }
    try { themeSwitcher(); } catch (err) { console.error("[main] themeSwitcher failed:", err); }

    // NOW load the initial page content itself. Deliberately awaited AFTER
    // the sidebar is already interactive (see note above). This call goes
    // through the SAME loadPage() as any sidebar click, which now uses
    // refreshUserSessionWithTimeout() internally -- so even this first
    // load can no longer hang for seconds waiting on a slow /auth/me.
    // Whichever loadPage() call (this one, or a nav click that raced in
    // during the very short window before this line runs) finishes last
    // is the one that's kept, via the edPageLoadToken freshness check
    // inside loadPage() itself.
    await loadPage(initialPage);

    // Sidebar HTML hardcode tombol Dashboard sebagai is-active by default.
    // Kalau initialPage hasil restore di atas BUKAN Dashboard, pindahkan
    // highlight-nya ke nav item yang sesuai supaya sidebar tidak "bohong"
    // menunjukkan Dashboard padahal halaman yang tampil adalah halaman lain.
    const restoredDashboardBtn = document.getElementById("sbDashboardBtn");
    if (restoredDashboardBtn) {
        restoredDashboardBtn.classList.toggle("is-active", initialPage === "pages/dashboard.html");
    }
    document.querySelectorAll(".sb-nav-item[data-page]").forEach((item) => {
        item.classList.toggle("is-active", item.getAttribute("data-page") === initialPage);
    });

    if (typeof initLogoutModal === "function") {
        initLogoutModal();
    }

    if (typeof initHeaderNotifications === "function") {
        initHeaderNotifications();
    }

    populateHeaderProfile();
    headerProfileDropdown();

    applyLanguage(getSavedLanguage());

    // Keep content that's injected later (lazy-loaded tab panels like
    // Project Monitoring's Overview/System/Battery/Task fragments) translated
    // too. Without this, applyLanguage() only runs once at boot and anything
    // fetched into the DOM afterwards is stuck in whatever language it was
    // written in.
    initUniversalLanguageObserver();

    // "Siapa yang online" di Admin View (js/admin-view.js) dihitung dari
    // kolom users.last_seen_at, yang di-update SETIAP kali /auth/me sukses
    // (lihat AuthService.refreshSession() di backend). refreshUserSession()
    // sendiri sudah otomatis kepanggil tiap pindah halaman (loadPage()) --
    // tapi kalau user diam saja di SATU halaman tanpa pindah-pindah, tidak
    // ada request /auth/me lagi setelah itu, jadi last_seen_at-nya jadi
    // "basi" dan yang bersangkutan salah kelihatan offline padahal tab-nya
    // masih terbuka. Heartbeat berkala ini yang jaga supaya tetap ke-update
    // selama tab masih terbuka & user masih login, terlepas dia pindah
    // halaman atau tidak.
    setInterval(() => {
        if (sessionStorage.getItem("edash-role")) refreshUserSession();
    }, 2 * 60 * 1000);

}

document.addEventListener(
    "DOMContentLoaded",
    initializeDashboard
);