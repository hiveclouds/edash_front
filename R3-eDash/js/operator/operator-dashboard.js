// =============================
// Page: Operator Dashboard — 360eDash
// pages/operator/operator-dashboard.html
//
// Layout: title -> Environmental Impact summary (same block/data
// source as Project Overview's) -> rounded search bar ("Search
// Project") stretching to meet "Add Graph" at the far right ->
// sub-tabs (Project Overview — leftmost, open by default — then
// System Information / Battery Station / Task Management, same
// .pm-tabs component as Project Monitoring). Project Overview keeps
// its own card grid: each grid ends with a dashed "add card" tile;
// clicking it (or the "Add Graph" button) opens the "Create graph"
// modal (see the "Create graph" modal section further down) so the
// operator can pick one or more real Tawabi logger variables, a
// device/group and a chart type, then drops an actual Chart.js chart
// into the grid (flex-wrap, see css/operator/operator-dashboard.css).
// System Information / Battery Station / Task Management instead
// behave like Admin 360's Project Monitoring tabs (pages/project-
// monitoring.html + js/project-monitoring.js): each is lazy-fetched
// once from its real page (pages/system-information.html, pages/
// battery-station.html, pages/task-management.html) and rendered
// with that page's own initializer (initSystemInformation /
// initBatteryStation / initTaskManagement) — same content an Admin
// 360 user sees on those pages. A floating icon-only button pinned
// bottom-right fullscreens just the page content (no header/
// sidebar).
// =============================

// ===========================================================
// Operator Project Context
// ------------------------------------------------------------
// Dipanggil di awal initOperatorDashboard() SEBELUM tab apa pun
// dirender. Tugasnya: cari tahu project apa saja yang sudah
// di-assign 360master/Admin ke akun Operator yang sedang login
// (lewat fitur "Manage Projects" di Admin View — js/admin-view.js),
// lalu otomatis menjadikan salah satunya "proyek aktif" lewat
// window.PC_setActiveProject() (js/project-context.js).
//
// Kenapa ini penting: System Information / Battery Station / Task
// Management SUDAH project-aware sejak lama (baca
// window.PC_getActiveProject() masing-masing — lihat
// js/system-information.js, js/battery-station.js,
// js/task-management.js), tapi sebelumnya operator-dashboard.js
// TIDAK PERNAH memanggil PC_setActiveProject() sama sekali, jadi
// Operator selalu melihat proyek aktif "apa adanya" (default
// fallback "tawabi" di semua modul itu kalau belum ada proyek aktif
// tersimpan) — bukan project yang benar-benar di-assign ke akun
// mereka.
//
// Endpoint yang dipakai: GET /projects -- endpoint yang sama dipakai
// System Information/Task Management/Battery Station (lihat
// resolveActiveProjectId() di js/system-information.js), sudah
// otomatis ke-scope ke project milik user yang sedang login (staff
// selalu 1, operator bisa lebih), TANPA butuh permission admin
// (adminview.access) sama sekali -- lihat opdFetchAssignedProjects()
// di bawah untuk kenapa ini sengaja BUKAN GET /admin/users/:id/projects
// lagi (endpoint admin gagal 403 untuk staff yang belum di-grant
// adminview.access).
// ===========================================================

// Cache per userId dalam 1 sesi supaya pindah-balik tab/halaman di
// Operator Dashboard tidak fetch ulang assignment-nya tiap kali.
let opdCachedProjects = null;
let opdCachedForUserId = null;
let opdProjectFetchInFlight = null;

function opdCurrentUserId() {
    return sessionStorage.getItem("edash-user-id") || null;
}

function opdCurrentRole() {
    return sessionStorage.getItem("edash-role") || null;
}

// Ambil project yang boleh dilihat user yang sedang login, lewat
// GET /projects -- endpoint ini SUDAH otomatis ke-scope di backend
// (ProjectService.list -> scopedProjectIds) berdasarkan
// user_project_access: staff selalu dapat persis 1 project miliknya
// sendiri, operator bisa lebih dari 1, TANPA butuh permission admin
// apa pun.
//
// Sebelumnya fungsi ini manggil GET /admin/users/:id/projects +
// GET /admin/assignable-projects -- KEDUANYA di-gate permission
// 'adminview.access' di backend (lihat routes/admin.routes.ts:
// viewGate = requirePermissionOrRoleKeys('adminview.access', ['operator'], ...)).
// root & role KEY 'operator' selalu lolos (hardcode), tapi staff
// TIDAK dapat bypass itu -- kalau permission adminview.access belum
// di-grant ke role staff (Settings > Roles), kedua call itu balik 403
// diam-diam (ke-catch di opdEnsureActiveProject), opdAssignedProjects
// jadi kosong, dan search bar "Search Project" + dropdown project
// switcher di Dashboard staff jadi kosong/nggak kepanggil sama sekali
// -- padahal Operator di akun lain terlihat normal karena dapat
// bypass role-key itu. GET /projects tidak butuh permission itu sama
// sekali (cuma project.monitoring, yang semua role client punya),
// jadi staff maupun operator sama-sama jalan lewat jalur yang sama
// persis, tanpa bergantung ke toggle admin apa pun.
async function opdFetchAssignedProjects(userId) {
    const rows = await window.edashApiFetch(`/projects`);
    const seen = new Set();
    return (rows || [])
        .map((p) => {
            const id = p.id;
            if (!id || seen.has(id)) return null;
            seen.add(id);
            return { id, name: p.project_name || p.projectName || p.name || id };
        })
        .filter(Boolean);
}

// Putuskan proyek mana yang jadi "aktif": kalau proyek aktif yang
// TERSIMPAN SEKARANG (mis. dari sesi sebelumnya, atau dari role lain
// yang sempat login di browser yang sama) masih termasuk salah satu
// yang di-assign ke operator ini, PERTAHANKAN pilihan itu (supaya
// pilihan operator di project switcher tidak ke-reset tiap refresh).
// Kalau tidak, auto-pick proyek PERTAMA yang di-assign — untuk
// operator dengan cuma 1 project, ini otomatis dan satu-satunya opsi
// yang benar, tanpa perlu pilih manual.
function opdApplyResolvedProjects(projects) {
    if (!projects.length) {
        return { status: "none", projects: [] };
    }

    const current = (typeof window.PC_getActiveProject === "function") ? window.PC_getActiveProject() : null;
    const stillValid = current && projects.some((p) => p.id === current.id);

    if (!stillValid && typeof window.PC_setActiveProject === "function") {
        window.PC_setActiveProject({ id: projects[0].id, name: projects[0].name });
    }

    return {
        status: projects.length === 1 ? "single" : "multiple",
        projects,
        activeId: stillValid ? current.id : projects[0].id,
    };
}

// Entry point utama, dipanggil di awal initOperatorDashboard().
// Mengembalikan:
//   { status: "single" | "multiple", projects, activeId }
//   { status: "none", projects: [] }        -- operator/staff belum di-assign project apa pun
//   { status: "error", projects: [], error } -- gagal fetch assignment (mis. offline)
//   { status: "n/a", projects: [] }          -- bukan role operator/staff, tidak ada assignment untuk ditegakkan
async function opdEnsureActiveProject() {
    const userId = opdCurrentUserId();
    const role = opdCurrentRole();

    // Staff sekarang juga mendarat di halaman ini (lihat applyOperatorSidebar()
    // & initializeDashboard() di js/main.js) dan sama seperti operator cuma
    // boleh baca project miliknya sendiri lewat GET /projects (scoped
    // otomatis di backend, lihat opdFetchAssignedProjects di atas) --
    // staff-nya SELALU 1 project, jadi logic di bawah ini
    // (opdApplyResolvedProjects dkk) tetap benar apa adanya.
    if ((role !== "operator" && role !== "staff") || !userId) {
        return { status: "n/a", projects: [] };
    }

    if (opdCachedProjects && opdCachedForUserId === userId) {
        return opdApplyResolvedProjects(opdCachedProjects);
    }

    if (opdProjectFetchInFlight && opdCachedForUserId === userId) {
        return opdProjectFetchInFlight.then(opdApplyResolvedProjects);
    }

    opdCachedForUserId = userId;
    opdProjectFetchInFlight = opdFetchAssignedProjects(userId)
        .then((projects) => {
            opdCachedProjects = projects;
            return projects;
        })
        .finally(() => { opdProjectFetchInFlight = null; });

    try {
        const projects = await opdProjectFetchInFlight;
        return opdApplyResolvedProjects(projects);
    } catch (err) {
        console.warn("[operator-dashboard] Gagal memuat project yang di-assign:", err.message || err);
        opdCachedForUserId = null; // biar percobaan berikutnya fetch ulang, bukan nyangkut di error terus
        return { status: "error", projects: [], error: err };
    }
}

async function initOperatorDashboard() {

    // ---------- Auto-load project assignment ----------
    // SEBELUM apa pun lain di halaman ini dirender: cari tahu project
    // apa saja yang sudah di-assign ke akun Operator ini (lihat
    // opdEnsureActiveProject() di atas), lalu otomatis jadikan salah
    // satunya "proyek aktif" lewat PC_setActiveProject. System
    // Information / Battery Station / Task Management di bawah sudah
    // baca window.PC_getActiveProject() sendiri-sendiri, jadi begitu
    // ini selesai, ketiga tab itu OTOMATIS menampilkan data project
    // operator ini -- bukan selalu Tawabi lagi.
    const opdProjectResult = await opdEnsureActiveProject();

    let operatorProjectStatus = opdProjectResult.status;

    const searchInput = document.getElementById("opdSearchInput");
    const projectDropdown = document.getElementById("opdProjectDropdown");
    const noProjectState = document.getElementById("opdNoProjectState");

    function esc(str) {
        return String(str).replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    // Projects assigned to this Operator account (from opdEnsureActiveProject()
    // above) and which one is currently active — kept in sync by
    // renderProjectIndicator() below so the dropdown wiring further down
    // always works off the latest list/selection.
    let opdAssignedProjects = [];
    let opdActiveProjectId = null;
    // True while #opdSearchInput's value is the auto-filled active-project
    // name rather than something the Operator actually typed — cleared on
    // the first real keystroke so Project Overview's graph search (see
    // renderGrid() below) only ever filters on text the Operator wrote
    // themselves, never on the pre-filled project name.
    let opdSearchIsProjectPrefill = false;

    function fillSearchWithActiveProject() {
        if (!searchInput) return;
        const active = opdAssignedProjects.find((p) => p.id === opdActiveProjectId);
        searchInput.value = active ? active.name : "";
        opdSearchIsProjectPrefill = true;
    }

    function closeProjectDropdown() {
        if (projectDropdown) projectDropdown.style.display = "none";
    }

    // Renders/opens the project switcher panel under the search input —
    // filtered by whatever's typed, or showing every assigned project when
    // the box still just holds the auto-filled active-project name.
    function openProjectDropdown() {
        if (!projectDropdown || !opdAssignedProjects.length) return;
        const typed = opdSearchIsProjectPrefill ? "" : (searchInput ? searchInput.value.trim().toLowerCase() : "");
        const matches = opdAssignedProjects.filter((p) => !typed || p.name.toLowerCase().includes(typed));

        projectDropdown.innerHTML = matches.length
            ? matches.map((p) => `
                <div class="opd-project-dropdown-item${p.id === opdActiveProjectId ? " is-active" : ""}" data-project-id="${esc(p.id)}">
                    <i class="fa-solid fa-diagram-project"></i>
                    <span>${esc(p.name)}</span>
                </div>
            `).join("")
            : `<div class="opd-project-dropdown-empty">No matching project</div>`;

        projectDropdown.querySelectorAll(".opd-project-dropdown-item").forEach((item) => {
            // mousedown + preventDefault (rather than click) so the pick
            // registers before the input's blur handler below would
            // otherwise close the dropdown out from under it.
            item.addEventListener("mousedown", (e) => {
                e.preventDefault();
                const picked = opdAssignedProjects.find((p) => p.id === item.dataset.projectId);
                if (!picked) return;
                const projectChanged = opdActiveProjectId !== picked.id;
                opdActiveProjectId = picked.id;
                if (typeof window.PC_setActiveProject === "function") {
                    window.PC_setActiveProject({ id: picked.id, name: picked.name });
                    loadEnvironmentalImpact();
                }
                // Cards are saved PER PROJECT (see loadSavedCards/
                // persistCards above) -- swap the grid's card list over
                // to whichever project is now active, instead of leaving
                // the previous project's cards on screen (which is what
                // made a graph added under "PLTS Tawabi" wrongly keep
                // showing up under "PLTS Kasdam"/"PLTS PUT" too).
                if (projectChanged) {
                    destroyAllCardCharts();
                    cardsByTab.project = loadSavedCards(opdActiveProjectId);
                    counterByTab.project = cardsByTab.project.length;
                    // "Add Graph"'s catalog is also per-project (see
                    // ensureGraphCatalog()) -- fetch/reuse it before
                    // (re)drawing so the new project's cards render
                    // against their own real data instead of stale/no
                    // data.
                    graphCatalog = graphCatalogByProject[picked.id] || null;
                    if (cardsByTab.project.some((c) => c.type === "chart")) {
                        // FIX (disclaimer §5 poin 1 & 2): dulu di sini
                        // langsung ensureGraphCatalog() (fetch PENUH --
                        // 90 hari + 1 hari untuk SEMUA unit sekaligus)
                        // begitu project di-switch, walau kartu-kartunya
                        // default-nya mode "24 Hours" doang. Diganti ke
                        // ensureHourlyCatalog() (cuma history1d) --
                        // ensureGraphCatalog() PENUH tetap dipanggil,
                        // tapi murni on-demand begitu Operator beneran
                        // klik toggle 7D/30D/Custom atau buka modal "Add
                        // Graph" (lihat setCardPeriodMode/openGraphModal).
                        ensureHourlyCatalog(picked.id).then(() => renderGrid("project")).catch(() => {
                            // ensureHourlyCatalog already logs a warning; cards
                            // just stay as their last-known state.
                            renderGrid("project");
                        });
                    } else {
                        renderGrid("project");
                    }
                }
                fillSearchWithActiveProject();
                closeProjectDropdown();
            });
        });

        projectDropdown.style.display = "";
    }

    if (searchInput) {
        searchInput.addEventListener("focus", () => {
            if (opdSearchIsProjectPrefill) searchInput.select();
            openProjectDropdown();
        });
        searchInput.addEventListener("input", () => {
            opdSearchIsProjectPrefill = false;
            openProjectDropdown();
        });
        searchInput.addEventListener("blur", () => {
            // Small delay so a dropdown item's mousedown above still gets
            // to register its pick before we hide the panel.
            setTimeout(closeProjectDropdown, 120);
        });
    }

    function renderProjectIndicator(result) {
        operatorProjectStatus = result.status;
        opdAssignedProjects = result.projects || [];
        opdActiveProjectId = result.activeId || null;

        if (noProjectState) noProjectState.style.display = (result.status === "none") ? "" : "none";

        if (result.status === "none" || result.status === "n/a" || result.status === "error" || !opdAssignedProjects.length) {
            closeProjectDropdown();
            return;
        }

        // Pre-fill the search box with the active project's name (like the
        // mock) so it reads as the switcher's current value at rest — only
        // while the box isn't already showing something the Operator typed.
        if (opdSearchIsProjectPrefill || (searchInput && !searchInput.value)) {
            fillSearchWithActiveProject();
        }
    }

    renderProjectIndicator(opdProjectResult);

    // Project Overview sits leftmost and is the tab open by default
    // (see pages/operator/operator-dashboard.html); System
    // Information / Battery Station / Task Management follow.
    const TABS = ["project", "system", "battery", "task"];

    // Only Project Overview still uses the in-page card grid. One
    // card list + running name counter, no default placeholder card
    // — the grid starts empty, so the first tile shown is the dashed
    // "+" add card. Cards created afterwards (via the "Create graph"
    // modal) carry type:"chart" plus the picked vars/device/chart
    // type (see addChartCard/renderCardChart below) and get a real
    // Chart.js mini-chart instead of a blank tile. This page still has
    // no backend for graphs, but the cards are mirrored into
    // localStorage (see loadSavedCards/persistCards below) so they
    // survive a page refresh instead of vanishing.
    //
    // Scoped PER PROJECT (mirrors Project Detail's PD_PERF_CFG_KEY /
    // pdPerfCfgFor in js/project-detail.js) -- storage is now
    // { [projectId]: Card[] } instead of a single flat array, so a
    // graph added while "PLTS Tawabi" is active no longer bleeds into
    // "PLTS Kasdam" or "PLTS PUT" when the Operator switches project.
    // Each project starts with its own empty grid until the Operator
    // adds a graph specifically for it.
    const CARDS_STORAGE_KEY = "edash-operator-dashboard-cards";

    function loadAllSavedCards() {
        try {
            const raw = localStorage.getItem(CARDS_STORAGE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            // Migrate the old flat-array shape (cards shared across every
            // project) into the new per-project shape -- best guess is to
            // attribute those old cards to whichever project is active
            // right now, since that's almost always "tawabi" (the only
            // project this grid supported before per-project scoping
            // existed), rather than silently discarding the Operator's
            // previously-saved cards.
            if (Array.isArray(parsed)) {
                const fallbackId = opdActiveProjectId || "tawabi";
                return parsed.length ? { [fallbackId]: parsed } : {};
            }
            if (!parsed || typeof parsed !== "object") return {};
            return parsed;
        } catch (e) {
            console.warn("[operator-dashboard] Gagal baca cards dari localStorage:", e.message);
            return {};
        }
    }

    let opdCardsAll = loadAllSavedCards();

    // Sanity-check each entry so a corrupted/old-shape value in storage
    // can't crash the render — only keep well-formed chart cards. Cards
    // saved before the period toggle existed won't have a `period` yet,
    // so default one in here (rather than in every place that reads
    // card.period later).
    function loadSavedCards(projectId) {
        const list = (projectId && Array.isArray(opdCardsAll[projectId])) ? opdCardsAll[projectId] : [];
        return list.filter((c) => c && c.type === "chart" && c.id &&
            Array.isArray(c.vars) && c.vars.length && c.deviceGroupId)
            .map((c) => {
                if (!c.period || typeof c.period !== "object") {
                    // FIX: default mode DISAMAKAN dengan Project Detail
                    // (pdPerfState default-nya "24h", lihat js/project-detail.js)
                    // -- kartu lama (disimpan sebelum field "period" ada)
                    // dulu default-nya "30d", jadi begitu di-load ulang
                    // langsung minta histori 30 hari padahal harusnya
                    // yang pertama ditampilkan cuma 24 jam.
                    c.period = { mode: "24h", dateFrom: null, dateTo: null };
                }
                return c;
            });
    }

    function persistCards() {
        if (!opdActiveProjectId) return;
        try {
            opdCardsAll[opdActiveProjectId] = cardsByTab.project;
            localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(opdCardsAll));
        } catch (e) {
            console.warn("[operator-dashboard] Gagal simpan cards ke localStorage:", e.message);
        }
    }

    // Tears down every live Chart.js instance for the current grid --
    // needed before swapping cardsByTab.project to a different project's
    // card list (their canvases are about to be discarded wholesale by
    // renderGrid's innerHTML rebuild, so the old Chart instances would
    // otherwise leak, still referencing detached canvases).
    function destroyAllCardCharts() {
        Object.keys(cardChartInstances).forEach((id) => {
            cardChartInstances[id].destroy();
            delete cardChartInstances[id];
        });
    }

    const cardsByTab = { project: loadSavedCards(opdActiveProjectId) };
    const counterByTab = { project: cardsByTab.project.length };
    let activeTab = "project";

    // Lazy-load cache for the other three tabs (same pattern as
    // js/project-monitoring.js) — each of System Information /
    // Battery Station / Task Management is fetched from its real
    // page and initialized only once per visit to this dashboard.
    let systemLoadPromise = null;
    let batteryLoadPromise = null;
    let taskLoadPromise = null;

    // Real per-project variable catalog + telemetry for the "Create
    // graph" modal — see GRAPH_VAR_DEFS/ensureGraphCatalog() further
    // down (fetched from the Core API, not a static JSON file).
    let graphCatalog = null;

    // Chart.js instances for "chart"-type cards, keyed by card id, so
    // they can be destroyed before a re-render replaces their canvas
    // (renderGrid rebuilds innerHTML wholesale).
    const cardChartInstances = {};
    // Below-chart range-slider state, keyed by card id — cardFullSeries
    // is the {labels, values} of the card's FIRST variable for the
    // currently selected period (24h/7d/30d/custom), used as the mini
    // navigator sparkline; cardRangeState is the {from,to} window the
    // Operator has dragged within it. Ported 1:1 from Project Detail's
    // pdPerfFullSeries/pdPerfRangeState (js/project-detail.js).
    const cardFullSeries = {};
    const cardRangeState = {};

    function hexToRgba(hex, alpha) {
        let h = hex.replace("#", "");
        if (h.length === 3) h = h.split("").map((c) => c + c).join("");
        const num = parseInt(h, 16);
        const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // ---------- automated high-contrast trendline colors ----------
    // Each catalog variable carries a fixed `.color` (assigned once,
    // round-robin through PALETTE, in ensureGraphCatalog) so the "Add
    // graph" checklist swatches stay stable no matter what's plotted.
    // But a multi-line chart can end up drawing the SAME catalog
    // variable twice (e.g. "Daily Production" picked from both PLTS
    // TAWABI GRUP 1 and GRUP 2 -- they share one catalog entry, so one
    // fixed .color) or several variables whose catalog colors just
    // happen to sit close together on the wheel -- either way the lines
    // blend into each other. Rather than trust the stored .color for
    // the actual trendlines, every multi-line chart below recomputes
    // colors from THIS helper -- spread evenly around the hue wheel for
    // however many lines are actually on screen (max separation for
    // that exact count), alternating lightness/saturation on top so
    // long lists stay tellable apart. A single-variable chart keeps the
    // original brand teal so it looks exactly like before. Ported 1:1
    // from Project Detail's pdAssignContrastColors (js/project-detail.js).
    function hslToHex(h, s, l) {
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

    const CONTRAST_BASE_HUE = 184; // ~matches the old #0F6A71 brand teal

    // Returns `n` hex colors, guaranteed maximally spread for that count
    // -- call it once per render with the exact number of lines being
    // drawn (e.g. `assignContrastColors(card.vars.length)`) and index
    // into the result in the SAME order the lines/legend/stat-chips are
    // built, so everything referring to "line #i" stays visually
    // consistent.
    function assignContrastColors(n) {
        if (n <= 0) return [];
        if (n === 1) return [hslToHex(CONTRAST_BASE_HUE, 58, 32)];
        const step = 360 / n;
        return Array.from({ length: n }, (_, i) => {
            const hue = CONTRAST_BASE_HUE + i * step;
            const lightness = 32 + (i % 2) * 14; // alternate darker/lighter
            const saturation = 62 - (Math.floor(i / 2) % 2) * 16; // extra nudge apart on long lists
            return hslToHex(hue, saturation, lightness);
        });
    }

    // Which inverter/device group ("PLTS TAWABI GRUP 1" / "GRUP 2", etc.)
    // a custom chart card's data comes from. A card CAN now mix
    // variables from two+ groups (each var carries its own groupId, see
    // toggleGraphVar/graphAddBtn's handler) — when it does, every
    // DISTINCT group name involved is joined together instead of just
    // one. Falls back to card.deviceGroupName / card.deviceGroupId (the
    // single-group shape saved before this existed) for older cards, so
    // they keep working exactly as before.
    function cardGroupLabel(card) {
        if (Array.isArray(card.vars) && card.vars.some((v) => v && v.groupId)) {
            const ids = Array.from(new Set(card.vars.map((v) => v.groupId).filter(Boolean)));
            if (ids.length > 1) {
                const names = ids.map((gid) => graphGroupName(gid)).filter(Boolean);
                if (names.length) return names.join(" + ");
            }
        }
        if (card.deviceGroupName) return card.deviceGroupName;
        if (graphCatalog && graphCatalog.groups[card.deviceGroupId] && graphCatalog.groups[card.deviceGroupId].name) {
            return graphCatalog.groups[card.deviceGroupId].name;
        }
        return "";
    }

    const addGraphBtn = document.getElementById("opdAddGraphBtn");
    const fullscreenBtn = document.getElementById("opdFullscreenBtn");

    function renderGrid(tab) {
        // Only Project Overview still has a #opdGrid-<tab> element in
        // the DOM (see pages/operator/operator-dashboard.html) — the
        // other three tabs are lazy-fetched real pages now, so this
        // is a no-op for them.
        const grid = document.getElementById("opdGrid-" + tab);
        if (!grid) return;

        // While the search box still just holds the auto-filled active
        // project name (opdSearchIsProjectPrefill, see above), that text
        // is not a graph search — ignore it so the grid isn't filtered
        // down by a project name that (usually) won't match any card
        // title.
        const query = (searchInput && tab === activeTab && !opdSearchIsProjectPrefill ? searchInput.value : "").trim().toLowerCase();
        const cards = cardsByTab[tab];
        const visible = cards.filter((c) => !query || (c.type === "chart" ? c.title : c.label).toLowerCase().includes(query));

        // "Lebarkan sebaris" ("expand to full row") cards float to the
        // top of the grid and stay grouped together there — same idea
        // as Project Detail's renderPerformanceAnalytics sort — so a
        // card widened in the middle of the grid doesn't just take up
        // its full row in place, leaving cards before it stranded in a
        // half-empty row. Array.prototype.sort is stable, so this only
        // reorders on the wide/non-wide split and otherwise leaves the
        // existing (manually dragged, or natural) order untouched.
        visible.sort((a, b) => Number(!!b.wide) - Number(!!a.wide));

        // Graphs only ever live on the Project Overview tab — the
        // dashed "+" add tile is only rendered there (the other three
        // sub-tabs no longer have a grid at all, see switchTab()). Each
        // chart card also gets its own period toggle (24 Hours / 7
        // Days / 30 Days / Custom, same idea as System Information's
        // chart widget) plus a From/To date range for "Custom" and a
        // compact stats row — see PERIODS/renderCardChart below.
        grid.innerHTML = visible.map((c) => c.type === "chart" ? `
            <div class="opd-card opd-card-chart${c.wide ? " is-wide" : ""}" data-card-id="${esc(c.id)}">
                <button type="button" class="opd-card-resize" data-resize="${esc(c.id)}" title="${c.wide ? "Kecilkan" : "Lebarkan sebaris"}">
                    <i class="fa-solid ${c.wide ? "fa-down-left-and-up-right-to-center" : "fa-up-right-and-down-left-from-center"}"></i>
                </button>
                <button type="button" class="opd-card-download opd-card-download-csv" data-download-csv="${esc(c.id)}" title="Download CSV (selected window)">
                    <i class="fa-solid fa-file-csv"></i>
                </button>
                <button type="button" class="opd-card-download opd-card-download-png" data-download-png="${esc(c.id)}" title="Download graph as PNG">
                    <i class="fa-solid fa-image"></i>
                </button>
                <div class="opd-card-chart-head">
                    <div class="opd-card-chart-title-wrap">
                        <span class="opd-card-drag-handle" title="Drag to reorder" aria-hidden="true">
                            <i class="fa-solid fa-grip-vertical"></i>
                        </span>
                        <div class="opd-card-chart-title-col">
                            <span class="opd-card-label opd-card-label-editable" title="Click to edit graph" data-edit-card="${esc(c.id)}">${esc(c.title)}</span>
                            ${cardGroupLabel(c) ? `<span class="opd-card-chart-meta" title="${esc(cardGroupLabel(c))}">${esc(cardGroupLabel(c))}</span>` : ""}
                        </div>
                    </div>
                    <button type="button" class="opd-card-remove" title="Remove" data-remove="${esc(c.id)}">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="opd-card-period-row">
                    <div class="opd-card-period-toggle" data-period-toggle="${esc(c.id)}">
                        ${PERIODS.map((p) => `
                            <button type="button" class="${cardPeriod(c).mode === p.mode ? "is-active" : ""}" data-period="${p.mode}" title="${esc(p.title || "")}">${p.icon ? `<i class="fa-solid ${p.icon}"></i> ` : ""}${esc(p.label)}</button>
                        `).join("")}
                    </div>
                </div>
                <div class="opd-card-daterange" data-daterange="${esc(c.id)}" style="${cardPeriod(c).mode === "custom" ? "" : "display:none;"}">
                    <div class="opd-card-daterange-field">
                        <label>From</label>
                        <input type="date" data-date-from="${esc(c.id)}" value="${esc(cardPeriod(c).dateFrom || "")}">
                    </div>
                    <div class="opd-card-daterange-field">
                        <label>To</label>
                        <input type="date" data-date-to="${esc(c.id)}" value="${esc(cardPeriod(c).dateTo || "")}">
                    </div>
                </div>
                <div class="opd-card-chart-body">
                    <canvas id="opdCardChart-${esc(c.id)}"></canvas>
                    ${cardPeriod(c).mode !== "24h" ? `<div class="opd-card-chart-loading${isCardDataReady(cardPeriod(c)) ? " is-hidden" : ""}" data-card-loading="${esc(c.id)}"><i class="fa-solid fa-spinner fa-spin"></i> Loading data...</div>` : ""}
                </div>
                <div class="opd-card-range" data-range="${esc(c.id)}">
                    <div class="opd-card-range-track" data-range-track="${esc(c.id)}">
                        <canvas class="opd-card-range-spark" data-range-spark="${esc(c.id)}" height="44"></canvas>
                        <div class="opd-card-range-mask opd-card-range-mask-left" data-range-mask-left="${esc(c.id)}"></div>
                        <div class="opd-card-range-mask opd-card-range-mask-right" data-range-mask-right="${esc(c.id)}"></div>
                        <div class="opd-card-range-fill" data-range-fill="${esc(c.id)}"></div>
                        <div class="opd-card-range-handle" data-range-handle="from" data-range-id="${esc(c.id)}"></div>
                        <div class="opd-card-range-handle" data-range-handle="to" data-range-id="${esc(c.id)}"></div>
                    </div>
                    <div class="opd-card-range-caption" data-range-caption="${esc(c.id)}"></div>
                </div>
            </div>
        ` : `
            <div class="opd-card" data-card-id="${esc(c.id)}">
                <span class="opd-card-label">${esc(c.label)}</span>
                <button type="button" class="opd-card-remove" title="Remove" data-remove="${esc(c.id)}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `).join("") + `
            <button type="button" class="opd-card-add" data-add-tab="${esc(tab)}" title="Add Graph">
                <i class="fa-solid fa-plus"></i>
            </button>
        `;

        if (query && !visible.length) {
            grid.innerHTML += `<p class="opd-grid-empty-hint">No graphs match "${esc(searchInput.value.trim())}".</p>`;
        }

        grid.querySelectorAll("[data-remove]").forEach((btn) => {
            btn.addEventListener("click", () => removeCard(tab, btn.getAttribute("data-remove")));
        });
        grid.querySelectorAll("[data-resize]").forEach((btn) => {
            btn.addEventListener("click", () => toggleCardWide(tab, btn.getAttribute("data-resize")));
        });
        grid.querySelectorAll("[data-download-png]").forEach((btn) => {
            btn.addEventListener("click", () => downloadCardPng(btn.getAttribute("data-download-png")));
        });
        grid.querySelectorAll("[data-download-csv]").forEach((btn) => {
            btn.addEventListener("click", () => downloadCardCsv(btn.getAttribute("data-download-csv")));
        });
        grid.querySelectorAll("[data-add-tab]").forEach((btn) => {
            btn.addEventListener("click", () => openGraphModal(btn.getAttribute("data-add-tab")));
        });
        // Clicking a chart card's title re-opens the same "Create graph"
        // modal, pre-filled from that card, so it can be edited/saved in
        // place instead of only ever being removable.
        grid.querySelectorAll("[data-edit-card]").forEach((label) => {
            label.addEventListener("click", () => {
                const card = cardsByTab[tab].find((c) => c.id === label.getAttribute("data-edit-card"));
                if (card) openGraphModal(tab, card);
            });
        });
        grid.querySelectorAll("[data-period-toggle]").forEach((toggle) => {
            const id = toggle.getAttribute("data-period-toggle");
            toggle.querySelectorAll("button[data-period]").forEach((btn) => {
                btn.addEventListener("click", () => setCardPeriodMode(tab, id, btn.getAttribute("data-period")));
            });
        });
        grid.querySelectorAll("[data-date-from]").forEach((input) => {
            input.addEventListener("change", () => setCardCustomDate(tab, input.getAttribute("data-date-from"), "dateFrom", input.value));
        });
        grid.querySelectorAll("[data-date-to]").forEach((input) => {
            input.addEventListener("change", () => setCardCustomDate(tab, input.getAttribute("data-date-to"), "dateTo", input.value));
        });

        // (Re)draw the real charts now that their <canvas> elements
        // exist in the DOM.
        visible.filter((c) => c.type === "chart").forEach(renderCardChart);

        wireCardDragAndDrop(tab, grid);
    }

    function renderAll() {
        // Only Project Overview has a grid to render — System
        // Information / Battery Station / Task Management are
        // lazy-fetched on first visit instead (see switchTab()).
        renderGrid("project");
    }

    // ---------- per-card period (24 Hours / 7 Days / 30 Days / Custom) ----------
    // "24 Hours"/"7 Days"/"30 Days"/"Custom" each pull RAW telemetry
    // points from their own dedicated fetch (history1d/history7d/
    // history30d/historyCustom -- see fetchGraphUnitsForProject &
    // ensureGraphCustomData) instead of slicing the coarse daily
    // average used for longer ranges -- same underlying idea as System
    // Information's chart toggle.
    const PERIODS = [
        { mode: "24h", label: "24 Hours" },
        { mode: "7d", label: "7 Days" },
        { mode: "30d", label: "30 Days" },
        { mode: "custom", label: "Custom", icon: "fa-calendar-days", title: "Pick your own date range" },
    ];

    function cardPeriod(card) {
        if (!card.period || typeof card.period !== "object") {
            // FIX: disamakan dengan Project Detail (pdPerfState default
            // "24h") -- kartu pertama kali ditampilkan harusnya cuma
            // narik histori 24 jam, bukan langsung 30 hari.
            card.period = { mode: "24h", dateFrom: null, dateTo: null };
        }
        return card.period;
    }

    // Drives the "Memuat data..." overlay in the card markup above --
    // stays visible until the base catalog has settled at least once
    // AND (for "7 Days"/"30 Days") the background history7d/history30d
    // prefetch has settled, AND (for "Custom") the exact picked date
    // range has finished loading, so the Operator never mistakes a
    // still-loading/fallback chart for the real data. Adapted from
    // Project Detail's pdIsPerfCardDataReady (js/project-detail.js) --
    // this page fetches 7D/30D data separately/lazily (see
    // ensureGraphWeeklyMonthlyData) so it needs its own settled check
    // that Project Detail doesn't (there all 4 ranges land together).
    function isCardDataReady(period) {
        if (!isGraphCatalogSettled(opdActiveProjectId)) return false;
        if (period.mode === "7d" || period.mode === "30d") return isGraphWeeklyMonthlySettled(opdActiveProjectId);
        if (period.mode === "custom") return isGraphCustomLoaded(opdActiveProjectId, period.dateFrom, period.dateTo);
        return true;
    }

    // Given the full label list (ascending ISO date strings) for a
    // card's device group, returns the [fromIdx, toIdx] slice bounds
    // matching its current period. Only actually used for the plain
    // daily `data` labels now ("YYYY-MM-DD") -- hourly/weekly/monthly/
    // custom each carry their OWN already-exactly-right label list
    // (see renderCardChart), so this is just the graceful fallback
    // while a period's real data hasn't finished loading yet.
    function graphDateOnlyKey(s) {
        return typeof s === "string" && s.length > 10 ? s.slice(0, 10) : s;
    }
    function periodSliceBounds(labels, period) {
        if (!labels.length) return { fromIdx: 0, toIdx: -1 };
        let fromIdx = 0;
        let toIdx = labels.length - 1;
        const mode = (period && period.mode) || "30d";
        if (mode === "24h") {
            fromIdx = labels.length - 1;
        } else if (mode === "7d") {
            fromIdx = Math.max(0, labels.length - 7);
        } else if (mode === "30d") {
            fromIdx = Math.max(0, labels.length - 30);
        } else if (mode === "custom") {
            if (period.dateFrom) {
                const idx = labels.findIndex((d) => graphDateOnlyKey(d) >= period.dateFrom);
                fromIdx = idx === -1 ? labels.length - 1 : idx;
            }
            if (period.dateTo) {
                let idx = -1;
                for (let i = labels.length - 1; i >= 0; i--) {
                    if (graphDateOnlyKey(labels[i]) <= period.dateTo) { idx = i; break; }
                }
                toIdx = idx === -1 ? 0 : idx;
            }
        }
        if (fromIdx > toIdx) { const t = fromIdx; fromIdx = toIdx; toIdx = t; }
        return { fromIdx, toIdx };
    }

    function setCardPeriodMode(tab, id, mode) {
        const card = cardsByTab[tab].find((c) => c.id === id);
        if (!card) return;
        const period = cardPeriod(card);
        period.mode = mode;
        // First time "Custom" is opened, default the range to the last
        // 30 days of real data instead of leaving it blank.
        if (mode === "custom" && (!period.dateFrom || !period.dateTo) && graphCatalog) {
            const groupData = graphCatalog.groups[card.deviceGroupId] && graphCatalog.groups[card.deviceGroupId].data;
            const labels = (groupData && groupData.labels) || [];
            if (labels.length) {
                const fromIdx = Math.max(0, labels.length - 30);
                if (!period.dateFrom) period.dateFrom = labels[fromIdx];
                if (!period.dateTo) period.dateTo = labels[labels.length - 1];
            }
        }
        renderGrid(tab);
        if (tab === "project") persistCards();

        // ON-DEMAND FETCH -- kartu langsung dirender dulu di atas (pakai
        // data yang sudah ada/fallback), lalu di sini katalog dipastikan
        // sudah lengkap (ensureGraphCatalog() memoize sendiri, jadi klik
        // berulang tidak memicu fetch ulang) dan kartu di-refresh begitu
        // histori 7D/30D/Custom-nya benar-benar siap. Mode "24h" tidak
        // menyentuh baris ini -- history1d sudah selalu ikut fetch awal.
        // Adapted dari Project Detail's setPerfPeriodMode
        // (js/project-detail.js) -- 7D/30D di sini biasanya SUDAH
        // ke-prefetch di belakang layar (lihat ensureGraphCatalog) tepat
        // begitu proyek ini dibuka, jadi ensureGraphWeeklyMonthlyData()
        // di bawah kebanyakan cuma numpang ke promise yang sudah
        // selesai/lagi jalan, bukan mulai fetch baru.
        if (mode !== "24h" && opdActiveProjectId) {
            const targetId = opdActiveProjectId;
            ensureGraphCatalog().then(() => {
                if (mode === "7d" || mode === "30d") {
                    return ensureGraphWeeklyMonthlyData(targetId);
                }
                if (mode === "custom" && period.dateFrom && period.dateTo) {
                    return ensureGraphCustomData(targetId, period.dateFrom, period.dateTo);
                }
            }).then(() => {
                if (opdActiveProjectId === targetId) renderGrid(tab);
            }).catch((e) => {
                console.warn(`[operator-dashboard] Gagal memuat histori ${mode} (project ${targetId}):`, e.message);
            });
        }
    }

    // FIX (permintaan user -- custom range kerasa lambat): akar
    // masalahnya BUKAN cuma "network lambat", tapi setiap kali tanggal
    // berubah (bahkan cuma mundur/maju 1-2 hari), rentang startTs/endTs
    // yang dikirim ke backend JADI BEDA TOTAL dari rentang sebelumnya --
    // cache key di backend selalu cache-miss, jadi ThingsBoard WAJIB
    // hitung ulang agregasinya dari nol tiap kali, untuk SEMUA unit.
    // Kalau Operator pakai panah naik/turun di <input type="date">
    // (tiap ketuk = 1 event "change" di banyak browser) atau ganti
    // field "From" lalu langsung "To", ini artinya BEBERAPA fetch penuh
    // (semua unit) tertumpuk beruntun -- bukan cuma 1 kali, padahal
    // yang kepake cuma hasil TERAKHIR.
    //
    // customDateDebounceTimers di bawah nunda ensureGraphCustomData()
    // 500ms setelah perubahan tanggal TERAKHIR -- kalau Operator ganti
    // lagi sebelum 500ms itu abis, timer sebelumnya dibatalin & mulai
    // dari 0. Hasilnya: cuma SATU fetch yang beneran jalan buat
    // kombinasi tanggal FINAL, bukan satu fetch terpisah tiap perubahan
    // kecil di sepanjang jalan. Ported 1:1 dari Project Detail's
    // pdCustomDateDebounceTimers (js/project-detail.js).
    const customDateDebounceTimers = {}; // { [projectId]: timeoutId }
    function setCardCustomDate(tab, id, field, value) {
        const card = cardsByTab[tab].find((c) => c.id === id);
        if (!card) return;
        const period = cardPeriod(card);
        period.mode = "custom";
        period[field] = value;
        // FIX: dulu di sini cuma renderCardChart(card) (gambar ulang
        // chart-nya doang) -- overlay "Memuat data..." (bagian dari
        // markup kartu yang dibangun renderGrid, lihat baris
        // "opd-card-chart-loading" di atas) TIDAK ikut di-render ulang,
        // jadi walau isCardDataReady() sudah balikin false untuk
        // rentang baru ini, overlay-nya tetap kelihatan "is-hidden"
        // (state lama dari render terakhir) sampai fetch-nya KELAR --
        // Operator tidak pernah lihat overlay ini SELAMA fetch-nya
        // berjalan, cuma lihat chart "meloncat" tiba-tiba begitu
        // selesai. Ganti ke renderGrid(tab) penuh di sini supaya
        // overlay kartu ini langsung muncul SAAT tanggal diganti.
        // Ported 1:1 dari Project Detail's setPerfCustomDate.
        renderGrid(tab);
        if (tab === "project") persistCards();

        // ON-DEMAND FETCH (DI-DEBOUNCE) -- lihat catatan
        // customDateDebounceTimers di atas. targetId & rentang tanggal
        // di-"snapshot" di closure ini (dateFromAtSchedule/
        // dateToAtSchedule), BUKAN dibaca ulang dari `period` saat timer
        // akhirnya jalan -- supaya kalau Operator sempat ganti tanggal
        // LAGI sebelum timer ini sempat jalan, timer LAMA (yang sudah
        // dibatalin di bawah) tidak bisa nyasar fetch rentang yang
        // sudah usang.
        if (period.dateFrom && period.dateTo && opdActiveProjectId) {
            const targetId = opdActiveProjectId;
            const dateFromAtSchedule = period.dateFrom;
            const dateToAtSchedule = period.dateTo;
            clearTimeout(customDateDebounceTimers[targetId]);
            customDateDebounceTimers[targetId] = setTimeout(() => {
                delete customDateDebounceTimers[targetId];
                ensureGraphCustomData(targetId, dateFromAtSchedule, dateToAtSchedule).then(() => {
                    if (opdActiveProjectId === targetId) renderGrid(tab);
                }).catch((e) => {
                    console.warn(`[operator-dashboard] Gagal memuat histori custom (project ${targetId}):`, e.message);
                    // Fetch gagal -- render ulang juga supaya overlay TIDAK
                    // nyangkut selamanya (isCardDataReady tetap false krn
                    // rentang ini tidak pernah "loaded", tapi setidaknya
                    // chart fallback/lama kelihatan lagi drpd ketutup
                    // spinner terus-terusan).
                    if (opdActiveProjectId === targetId) renderGrid(tab);
                });
            }, 500);
        }
    }

    function addChartCard(tab, cardData) {
        counterByTab[tab] += 1;
        cardsByTab[tab].push(cardData);
        if (tab === activeTab) fillSearchWithActiveProject();
        renderGrid(tab);
        if (tab === "project") persistCards();
    }

    function removeCard(tab, id) {
        if (cardChartInstances[id]) {
            cardChartInstances[id].destroy();
            delete cardChartInstances[id];
        }
        delete cardFullSeries[id];
        delete cardFullSeriesByDataset[id];
        delete cardRangeState[id];
        cardsByTab[tab] = cardsByTab[tab].filter((c) => c.id !== id);
        renderGrid(tab);
        if (tab === "project") persistCards();
    }

    // "Lebarkan sebaris" (expand a chart card to the full row width) —
    // ported 1:1 from Project Detail's pdTogglePerfCardWide. Stored
    // directly on the card object (card.wide) rather than a separate
    // keyed list, since these cards already round-trip through
    // localStorage wholesale via persistCards().
    function toggleCardWide(tab, id) {
        const card = cardsByTab[tab].find((c) => c.id === id);
        if (!card) return;
        card.wide = !card.wide;
        renderGrid(tab);
        if (tab === "project") persistCards();
    }

    // Which dataset ("trendline") legend entries the Operator has
    // clicked off, kept on the card object itself (card.hiddenSeries,
    // by dataset LABEL so it survives a var being re-ordered) and
    // round-tripped through localStorage the same way card.wide is —
    // see persistCards(). Without this, renderCardChart() destroying +
    // recreating the Chart instance on every re-render (tab revisit,
    // period switch, polling refresh, etc.) silently brought every
    // hidden line back.
    function isCardSeriesHidden(card, label) {
        return Array.isArray(card.hiddenSeries) && card.hiddenSeries.includes(label);
    }
    function setCardSeriesHidden(tab, card, label, hidden) {
        if (!Array.isArray(card.hiddenSeries)) card.hiddenSeries = [];
        const idx = card.hiddenSeries.indexOf(label);
        if (hidden && idx === -1) card.hiddenSeries.push(label);
        else if (!hidden && idx !== -1) card.hiddenSeries.splice(idx, 1);
        if (tab === "project") persistCards();
    }
    // Shared legend onClick for all three chart branches below --
    // toggles the dataset like Chart.js's own default handler would,
    // then persists the click so it sticks across re-renders.
    function cardLegendOnClick(tab, card) {
        return (e, legendItem, legend) => {
            const ci = legend.chart;
            if (ci.isDatasetVisible(legendItem.datasetIndex)) { ci.hide(legendItem.datasetIndex); legendItem.hidden = true; }
            else { ci.show(legendItem.datasetIndex); legendItem.hidden = false; }
            setCardSeriesHidden(tab, card, legendItem.text, legendItem.hidden);
        };
    }

    // Download the card's chart canvas (as currently drawn, including
    // whatever period/range-slider window is active) as a PNG.
    function downloadCardPng(id) {
        const chart = cardChartInstances[id];
        if (!chart) return;
        const link = document.createElement("a");
        link.href = chart.toBase64Image("image/png", 1);
        link.download = `${id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Export the data currently inside the card's selected window to
    // CSV — one column per VISIBLE line/segment (a trendline hidden via
    // the legend is left out, same as it's left out of the PNG).
    function downloadCardCsv(id) {
        const chart = cardChartInstances[id];
        const perDataset = cardFullSeriesByDataset[id];
        if (!chart || !perDataset) return;

        const labels = chart.data.labels || [];
        const visibleCols = chart.data.datasets
            .map((ds, i) => ({ ds, i }))
            .filter(({ i }) => chart.isDatasetVisible(i));
        if (!labels.length || !visibleCols.length) return;

        const header = ["Date", ...visibleCols.map(({ ds }) => ds.label)];
        const rows = [header];
        labels.forEach((label, rowIdx) => {
            rows.push([label, ...visibleCols.map(({ ds }) => (Array.isArray(ds.pdRawValues) ? ds.pdRawValues[rowIdx] : ds.data[rowIdx]))]);
        });

        const csvEscapeCell = (v) => {
            const s = v === null || v === undefined ? "" : String(v);
            return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csvContent = rows.map((r) => r.map(csvEscapeCell).join(",")).join("\r\n");
        const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${id}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    // ===========================================================
    // Card drag-and-drop reordering — ported 1:1 from Project Detail's
    // wirePerfCardDragAndDrop/startPerfCardDrag/animatePerfCardShift
    // (js/project-detail.js), just adapted from its perfKey-keyed
    // pdPerfCfgFor(...).order list to reordering this page's
    // cardsByTab[tab] array directly (persisted wholesale via
    // persistCards()).
    //
    // This is a custom pointer-events drag rather than the native
    // HTML5 draggable/dragstart API because the native API's default
    // "ghost" drag image is a flattened low-res snapshot that can't
    // reflect a *live* Chart.js <canvas> — grabbing a card's grip
    // handle here instead spawns a fully opaque floating clone
    // (with its canvases repainted from the live card) that tracks
    // the pointer, while the other cards in the grid live-shift out
    // of the way as it passes over them (see animateCardShift). The
    // dashed "+" add tile has no data-card-id and is never
    // draggable — any card dropped near it is inserted right before
    // it, so it stays last.
    let opdDraggedCardEl = null;
    let opdDraggedCardGrid = null;
    let opdDraggedCardTab = null;
    let opdDragFloatEl = null;
    let opdDragOffsetX = 0;
    let opdDragOffsetY = 0;

    function wireCardDragAndDrop(tab, grid) {
        // Every render rebuilds the grid's innerHTML, so handles are
        // rewired each time (same pattern as period toggles/remove/
        // resize buttons above).
        grid.querySelectorAll(".opd-card-drag-handle").forEach((handle) => {
            const card = handle.closest(".opd-card[data-card-id]");
            if (!card) return;
            handle.addEventListener("pointerdown", (e) => {
                if (e.button !== undefined && e.button !== 0) return; // left click / primary touch only
                e.preventDefault();
                startCardDrag(e, tab, grid, card);
            });
        });
    }

    function startCardDrag(e, tab, grid, card) {
        opdDraggedCardEl = card;
        opdDraggedCardGrid = grid;
        opdDraggedCardTab = tab;

        const rect = card.getBoundingClientRect();
        opdDragOffsetX = e.clientX - rect.left;
        opdDragOffsetY = e.clientY - rect.top;

        // Canvas content isn't copied by cloneNode, so the chart +
        // range sparkline canvases are repainted manually from the
        // live card.
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
        opdDragFloatEl = clone;

        // Hide the original card in place — the floating clone above
        // (fully opaque) is what now visually follows the cursor.
        card.classList.add("is-dragging");

        document.addEventListener("pointermove", onCardDragMove);
        document.addEventListener("pointerup", onCardDragEnd);
        document.addEventListener("pointercancel", onCardDragEnd);
    }

    function onCardDragMove(e) {
        if (!opdDragFloatEl || !opdDraggedCardEl) return;
        opdDragFloatEl.style.left = (e.clientX - opdDragOffsetX) + "px";
        opdDragFloatEl.style.top = (e.clientY - opdDragOffsetY) + "px";

        // The float has pointer-events:none, so elementFromPoint sees
        // straight through it to the real card underneath the cursor.
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const target = under && under.closest(".opd-card[data-card-id], .opd-card-add");
        if (!target || target === opdDraggedCardEl) return;
        const grid = opdDraggedCardGrid;
        if (!grid || !grid.contains(target)) return;

        const isAddTile = target.classList.contains("opd-card-add");
        let insertBefore = true;
        if (!isAddTile) {
            const rect = target.getBoundingClientRect();
            insertBefore = e.clientX < rect.left + rect.width / 2;
        }

        const willMove = insertBefore
            ? target.previousElementSibling !== opdDraggedCardEl
            : target.nextElementSibling !== opdDraggedCardEl;
        if (!willMove) return;

        animateCardShift(grid, () => {
            if (insertBefore) {
                grid.insertBefore(opdDraggedCardEl, target);
            } else {
                grid.insertBefore(opdDraggedCardEl, target.nextElementSibling);
            }
        });
    }

    function onCardDragEnd() {
        document.removeEventListener("pointermove", onCardDragMove);
        document.removeEventListener("pointerup", onCardDragEnd);
        document.removeEventListener("pointercancel", onCardDragEnd);

        if (opdDragFloatEl) {
            opdDragFloatEl.remove();
            opdDragFloatEl = null;
        }
        if (opdDraggedCardEl) opdDraggedCardEl.classList.remove("is-dragging");

        const finishedGrid = opdDraggedCardGrid;
        const finishedTab = opdDraggedCardTab;
        opdDraggedCardEl = null;
        opdDraggedCardGrid = null;
        opdDraggedCardTab = null;

        if (finishedGrid && finishedTab) syncCardOrderFromDom(finishedTab, finishedGrid);
    }

    // FLIP-style animation: measure every card's position (First), run
    // the actual DOM reorder (Last), then for any card whose position
    // changed, jump it back to where it was with a transform and
    // transition to zero (Invert + Play) — so cards glide into their
    // new spot instead of snapping instantly. The dragged card itself
    // is skipped since its position already tracks the pointer via
    // the floating clone.
    function animateCardShift(grid, moveFn) {
        const cards = Array.from(grid.querySelectorAll(".opd-card[data-card-id]"))
            .filter((el) => el !== opdDraggedCardEl);
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

    // Copies the on-screen order back into cardsByTab[tab] and
    // persists it. Wide cards still float back to the top on the next
    // render (see renderGrid's sort), but their relative order — and
    // every non-wide card's order — now follows exactly how the
    // Operator last arranged them.
    function syncCardOrderFromDom(tab, grid) {
        const ids = Array.from(grid.querySelectorAll(".opd-card[data-card-id]"))
            .map((el) => el.getAttribute("data-card-id"));
        const byId = {};
        cardsByTab[tab].forEach((c) => { byId[c.id] = c; });
        cardsByTab[tab] = ids.map((id) => byId[id]).filter(Boolean);
        if (tab === "project") persistCards();
    }

    // ---------- render a saved chart card's canvas ----------
    // Same multi-axis grouping as the modal's live preview (see
    // computeAxisGroups) — smaller-scale variables (e.g. Daily
    // Production, tens of kWh) get their own axis instead of being
    // squashed flat next to a larger one that shares the same unit
    // (e.g. Cumulative Consumption, thousands of kWh) — otherwise a
    // saved card would render very differently from what was shown in
    // the "Add graph" preview. Pulls straight from graphCatalog (fetched
    // once by ensureGraphCatalog) so the card always matches the real
    // logger data, no separate copy kept per card.
    function drawCardRangeSpark(canvas, values) {
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

    function renderCardRangeSlider(id) {
        const full = cardFullSeries[id];
        const state = cardRangeState[id];
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

        if (sparkEl) drawCardRangeSpark(sparkEl, full.values.map((v) => (typeof v === "number" && isFinite(v) ? v : null)));

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

        wireCardRangeHandles(id, track);
    }

    function applyCardRangeFilter(id) {
        const chart = cardChartInstances[id];
        const full = cardFullSeries[id];
        const state = cardRangeState[id];
        if (!chart || !full || !state) return;
        const { from, to } = state;
        chart.data.labels = full.labels.slice(from, to + 1);
        const perDataset = cardFullSeriesByDataset[id] || [];
        chart.data.datasets.forEach((ds, dsIdx) => {
            const entry = perDataset[dsIdx];
            if (!entry) return;
            ds.data = entry.data.slice(from, to + 1);
            // Kartu "Stack" (area bertumpuk) simpan nilai MENTAH per
            // segmen di ds.pdRawValues (dipakai stackTooltipCallbacks()
            // supaya tooltip nampilin angka aslinya, bukan angka
            // kumulatif) -- perlu di-slice terpisah dari array raw-nya
            // sendiri, bukan ikut ds.data yang sudah kumulatif.
            if (entry.raw) ds.pdRawValues = entry.raw.slice(from, to + 1);
        });
        chart.update("none");
    }

    function wireCardRangeHandles(id, track) {
        if (track.dataset.wired) return;
        track.dataset.wired = "1";

        function startDrag(e, kind) {
            const state = cardRangeState[id];
            const full = cardFullSeries[id];
            if (!state || !full) return;
            const total = full.labels.length;
            const rect = track.getBoundingClientRect();
            const startX = e.clientX;
            const startFrom = state.from, startTo = state.to;

            const onMove = (moveEvt) => {
                const st = cardRangeState[id];
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
                renderCardRangeSlider(id);
                applyCardRangeFilter(id);
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
            const state = cardRangeState[id];
            const full = cardFullSeries[id];
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
            renderCardRangeSlider(id);
            applyCardRangeFilter(id);
            startDrag(e, "move");
        });
    }

    // Full (unranged) values PER DATASET for the currently rendered
    // chart, keyed by card id then dataset index — applyCardRangeFilter()
    // needs this to re-slice line/bar/compare/stack datasets alike
    // (stack's "cumulative" datasets can't just be re-sliced from
    // ds.data once already ranged, see the comment there).
    const cardFullSeriesByDataset = {};

    // Sets up (or refreshes) cardFullSeries/cardRangeState for a card
    // that just (re)rendered with `labels` + one {data,raw?} entry per
    // Chart.js dataset (raw only needed for Stack's cumulative-vs-raw
    // split, see applyCardRangeFilter), and draws the slider. Called
    // once at the end of each renderCardChart branch below (stack /
    // compare / default).
    function primeCardRangeSlider(card, labels, perDatasetEntries) {
        const total = labels.length;
        const periodSignature = cardPeriod(card).mode + "|" + (cardPeriod(card).dateFrom || "") + "|" + (cardPeriod(card).dateTo || "");
        const prevState = cardRangeState[card.id];
        if (!prevState || prevState.total !== total || prevState.periodSignature !== periodSignature) {
            cardRangeState[card.id] = { from: 0, to: Math.max(0, total - 1), total, periodSignature };
        }
        cardFullSeries[card.id] = { labels, values: (perDatasetEntries[0] && perDatasetEntries[0].data) || [] };
        cardFullSeriesByDataset[card.id] = perDatasetEntries;

        const { from, to } = cardRangeState[card.id];
        const chart = cardChartInstances[card.id];
        if (chart && from <= to && (from > 0 || to < total - 1)) {
            // Kartu ini masih ingat window yang di-drag Operator dari
            // render sebelumnya (mis. cuma ganti Custom date range tapi
            // total titik datanya kebetulan sama) -- terapkan lagi
            // supaya slider-nya tidak "reset" ke tampilan penuh tiap
            // renderCardChart() dipanggil ulang (mis. tiap kali polling).
            applyCardRangeFilter(card.id);
        }
        renderCardRangeSlider(card.id);
    }

    function renderCardChart(card) {
        const canvas = document.getElementById("opdCardChart-" + card.id);
        if (!canvas || typeof Chart === "undefined" || !graphCatalog) return;

        if (cardChartInstances[card.id]) {
            cardChartInstances[card.id].destroy();
        }

        // A card's variables can each carry their OWN groupId now (see
        // graphAddBtn's handler) — card.deviceGroupId is kept as the
        // fallback/primary group (date-range bounds, and the default
        // for any var without its own groupId, e.g. cards saved before
        // this existed). groupDataForId() looks up any group's data on
        // demand instead of always the single primary one.
        const groupDataForId = (gid) => graphCatalog.groups[gid] && graphCatalog.groups[gid].data;
        const primaryGroupData = groupDataForId(card.deviceGroupId);
        // Every group in this catalog shares the same date range (see
        // buildGraphCatalogFromUnits), so any available group's labels
        // work fine as the fallback if the card's own saved
        // deviceGroupId can't be found anymore (e.g. project's systems
        // changed since the card was saved).
        const anyGroupData = primaryGroupData || Object.values(graphCatalog.groups)[0];
        if (!anyGroupData) return;

        const fullLabels = anyGroupData.labels || [];
        const period = cardPeriod(card);
        const isMultiGroup = selectionSpansMultipleGroups(card.vars);

        // Keep the From/To date pickers in sync with the real data
        // range now that it's actually loaded (they render with just
        // the card's saved value before this point).
        const fromInput = document.querySelector(`[data-date-from="${card.id}"]`);
        const toInput = document.querySelector(`[data-date-to="${card.id}"]`);
        if (fullLabels.length) {
            const minD = fullLabels[0];
            const maxD = fullLabels[fullLabels.length - 1];
            if (fromInput) { fromInput.min = minD; fromInput.max = maxD; }
            if (toInput) { toInput.min = minD; toInput.max = maxD; }
        }

        // "24 Hours"/"7 Days"/"30 Days" masing-masing pakai titik RAW
        // (bukan bucket rata-rata) dari history1d/history7d/history30d
        // (lihat graphRealHourlySeries/graphRealWeeklySeries/
        // graphRealMonthlySeries()) kalau catalog project ini sudah
        // bawa itu -- BUKAN lagi cuma slice dari data harian seperti
        // sebelumnya (yang jauh lebih kasar utk 7D/30D dan cuma "hari
        // paling baru" utk 24h). Fallback ke slice harian lama kalau
        // grup ini belum punya bucket-nya (mis. baru saja di-assign,
        // catalog belum sempat fetch ulang). Both branches resolve EACH
        // variable's own groupId first (with card.deviceGroupId only as
        // a fallback), so a multi-group card still pulls every line
        // from the right inverter.
        const hourlyFirst = period.mode === "24h" && card.vars[0]
            ? graphRealHourlySeries(card.vars[0], card.vars[0].groupId || card.deviceGroupId)
            : null;
        const weeklyFirst = period.mode === "7d" && card.vars[0]
            ? graphRealWeeklySeries(card.vars[0], card.vars[0].groupId || card.deviceGroupId)
            : null;
        const monthlyFirst = period.mode === "30d" && card.vars[0]
            ? graphRealMonthlySeries(card.vars[0], card.vars[0].groupId || card.deviceGroupId)
            : null;
        // Mode "Custom" -- titik RAW dari rentang tanggal PERSIS yang
        // dipilih user (graphRealCustomSeries, diisi on-demand oleh
        // ensureGraphCustomData -- lihat setCardPeriodMode/
        // setCardCustomDate). Sudah PERSIS rentang yang diminta, jadi
        // TIDAK perlu di-slice lagi lewat periodSliceBounds seperti
        // hourlyFirst/weeklyFirst/monthlyFirst di atas -- beda dengan
        // versi lama yang menyayat bucket 2-jam-an TETAP hasil fetch
        // 90-hari. Fallback ke slice harian lama di bawah kalau histori
        // custom-nya belum pernah/selesai ditarik supaya kartu tidak
        // kosong sambil menunggu.
        const customFirst = period.mode === "custom" && card.vars[0]
            ? graphRealCustomSeries(card.vars[0], card.vars[0].groupId || card.deviceGroupId)
            : null;

        let labels, seriesFor;
        if (hourlyFirst) {
            labels = hourlyFirst.labels;
            seriesFor = (v) => {
                const hourly = graphRealHourlySeries(v, v.groupId || card.deviceGroupId);
                return hourly ? hourly.values : new Array(labels.length).fill(null);
            };
        } else if (weeklyFirst) {
            labels = weeklyFirst.labels;
            seriesFor = (v) => {
                const weekly = graphRealWeeklySeries(v, v.groupId || card.deviceGroupId);
                return weekly ? weekly.values : new Array(labels.length).fill(null);
            };
        } else if (monthlyFirst) {
            labels = monthlyFirst.labels;
            seriesFor = (v) => {
                const monthly = graphRealMonthlySeries(v, v.groupId || card.deviceGroupId);
                return monthly ? monthly.values : new Array(labels.length).fill(null);
            };
        } else if (customFirst) {
            labels = customFirst.labels;
            seriesFor = (v) => {
                const real = graphRealCustomSeries(v, v.groupId || card.deviceGroupId);
                return real ? real.values : new Array(labels.length).fill(null);
            };
        } else {
            const { fromIdx, toIdx } = periodSliceBounds(fullLabels, period);
            labels = fromIdx <= toIdx ? fullLabels.slice(fromIdx, toIdx + 1) : [];
            seriesFor = (v) => {
                const gd = groupDataForId(v.groupId || card.deviceGroupId);
                const arr = (gd && gd[v.key]) || [];
                return fromIdx <= toIdx ? arr.slice(fromIdx, toIdx + 1) : [];
            };
        }

        // ---- "Stack" (derived PV/Battery/PLN breakdown — same as the
        // "Add graph" modal preview, see computeStackSegments()) ----
        const stackDef = card.chartType === "stack" ? findStackDef(card.vars) : null;
        if (stackDef) {
            const segments = computeStackSegments(seriesFor, stackDef.segments);
            const datasets = buildStackAreaDatasets(segments, labels.length, stackDef.segments);
            datasets.forEach((ds) => { ds.hidden = isCardSeriesHidden(card, ds.label); });
            renderCardStackStats(card, stackDef, segments);
            cardChartInstances[card.id] = new Chart(canvas.getContext("2d"), {
                type: "line",
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: {
                        legend: {
                            display: true, position: "bottom", labels: { boxWidth: 8, font: { size: 9.5, family: "Poppins" } },
                            onClick: cardLegendOnClick("project", card),
                        },
                        tooltip: { backgroundColor: "#25343F", padding: 8, cornerRadius: 8, callbacks: stackTooltipCallbacks() },
                    },
                    scales: {
                        x: { ticks: { font: { size: 9, family: "Poppins" }, maxTicksLimit: 5, autoSkip: true }, grid: { display: false } },
                        y: { grid: { color: "#EEF3F3" }, border: { display: false }, ticks: { font: { size: 9, family: "Poppins" } }, beginAtZero: true },
                    },
                },
            });
            primeCardRangeSlider(card, labels, stackDef.segments.map((seg, idx) => ({
                data: cardChartInstances[card.id].data.datasets[idx].data.slice(0),
                raw: segments[seg.id] || [],
            })));
            return;
        }

        // ---- "Compare" (mirrored top/bottom bar — same as the "Add
        // graph" modal preview, see findComparePair()) ----
        const comparePair = card.chartType === "compare" ? findComparePair(card.vars) : null;
        if (comparePair) {
            const topVar = comparePair.topVar;
            const bottomVar = comparePair.bottomVar;
            const topValues = seriesFor(topVar);
            // Kept un-negated separately (pdRawValues, same field Stack
            // already uses) so CSV export shows the variable's real
            // reading, not the sign flipped purely for the mirrored bar.
            const bottomValuesRaw = seriesFor(bottomVar);
            const bottomValues = bottomValuesRaw.map((n) => (typeof n === "number" && isFinite(n) ? -n : n));
            const topLabel = topVar.label + (topVar.unit ? " (" + topVar.unit + ")" : "");
            const bottomLabel = bottomVar.label + (bottomVar.unit ? " (" + bottomVar.unit + ")" : "");
            renderCardStats(card, seriesFor);
            cardChartInstances[card.id] = new Chart(canvas.getContext("2d"), {
                type: "bar",
                data: {
                    labels,
                    datasets: [
                        { label: topLabel, data: topValues, hidden: isCardSeriesHidden(card, topLabel), backgroundColor: hexToRgba(topVar.color, 0.55), borderColor: topVar.color, borderWidth: 1.5, borderRadius: 4, borderSkipped: false, barPercentage: 1, categoryPercentage: 1, grouped: false },
                        { label: bottomLabel, data: bottomValues, hidden: isCardSeriesHidden(card, bottomLabel), pdRawValues: bottomValuesRaw, backgroundColor: hexToRgba(bottomVar.color, 0.55), borderColor: bottomVar.color, borderWidth: 1.5, borderRadius: 4, borderSkipped: false, barPercentage: 1, categoryPercentage: 1, grouped: false },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: {
                        legend: {
                            display: true, position: "bottom", labels: { boxWidth: 8, font: { size: 9.5, family: "Poppins" } },
                            onClick: cardLegendOnClick("project", card),
                        },
                        tooltip: { backgroundColor: "#25343F", padding: 8, cornerRadius: 8, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${Math.abs(ctx.parsed.y).toLocaleString("en-US", { maximumFractionDigits: 2 })}` } },
                    },
                    scales: {
                        x: { ticks: { font: { size: 9, family: "Poppins" }, maxTicksLimit: 5, autoSkip: true }, grid: { display: false } },
                        y: {
                            grid: { color: (ctx) => (ctx.tick.value === 0 ? "#C9D6D7" : "#EEF3F3"), lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 1) },
                            border: { display: false },
                            ticks: { font: { size: 9, family: "Poppins" }, callback: (v) => Math.abs(v) },
                        },
                    },
                },
            });
            primeCardRangeSlider(card, labels, [
                { data: topValues },
                { data: bottomValues, raw: bottomValuesRaw },
            ]);
            return;
        }

        const { axisGroups, varKeyToAxis } = computeAxisGroups(card.vars, seriesFor);

        renderCardStats(card, seriesFor, isMultiGroup);

        // Same as the "Add graph" preview: once the saved card's own
        // variables span multiple groups, append " — GroupName" to each
        // line so the legend/tooltip can still tell them apart.
        // Auto-contrast colors, NOT the vars' stored .color -- see
        // assignContrastColors() above. Fixes cards like "Daily
        // Production" plotted for both PLTS TAWABI GRUP 1 and GRUP 2,
        // which used to share one catalog color and blend together.
        const cardContrastColors = assignContrastColors(card.vars.length);
        const datasets = card.vars.map((v, i) => {
            const color = cardContrastColors[i];
            return {
                label: v.label + (v.unit ? " (" + v.unit + ")" : "") + (isMultiGroup ? " — " + graphGroupName(v.groupId || card.deviceGroupId) : ""),
                data: seriesFor(v),
                hidden: isCardSeriesHidden(card, v.label + (v.unit ? " (" + v.unit + ")" : "") + (isMultiGroup ? " — " + graphGroupName(v.groupId || card.deviceGroupId) : "")),
                borderColor: color,
                backgroundColor: card.chartType === "bar" ? color + "cc" : hexToRgba(color, 0.15),
                fill: card.chartType === "line",
                spanGaps: true,
                tension: 0.35,
                // Same as the "Add graph" preview (updateGraphPreview) --
                // without this, Chart.js falls back to a plain Catmull-Rom
                // spline, which can badly overshoot on noisy day-to-day
                // telemetry (real Daily Production / Battery Current data
                // zig-zags a lot) and render as a distorted, looping "blob"
                // instead of the same clean curve the preview showed before
                // the card was added. Monotone cubic interpolation keeps the
                // saved card's line matching the preview's shape.
                cubicInterpolationMode: "monotone",
                pointRadius: 0,
                borderWidth: 2,
                maxBarThickness: 26,
                yAxisID: varKeyToAxis[v.key],
            };
        });

        const scales = { x: {
            ticks: { font: { size: 9, family: "Poppins" }, maxTicksLimit: 5, autoSkip: true },
            grid: { display: false },
        } };
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

        cardChartInstances[card.id] = new Chart(canvas.getContext("2d"), {
            type: card.chartType,
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: {
                        display: card.vars.length > 1,
                        position: "bottom",
                        labels: { boxWidth: 8, font: { size: 9.5, family: "Poppins" } },
                        onClick: cardLegendOnClick("project", card),
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
        primeCardRangeSlider(card, labels, datasets.map((ds) => ({ data: ds.data })));
    }

    // ---------- compact stat chips (Avg / Max / Min) for a saved card ----------
    // Same idea as the "Add graph" modal's stat chips (renderGraphStats
    // below) but scoped to whatever's currently visible in the card
    // (i.e. respects the period toggle), and rendered smaller so
    // several fit inside the card without crowding the chart itself.
    function renderCardStats(card, seriesFor, multiGroup) {
        const statsEl = document.querySelector(`[data-card-stats="${card.id}"]`);
        if (!statsEl) return;
        statsEl.innerHTML = "";

        // Same auto-contrast palette as the datasets above (same count
        // in, same colors out) so the stat chip dot always matches its
        // line.
        const statColors = assignContrastColors(card.vars.length);
        card.vars.forEach((v, i) => {
            const color = statColors[i];
            const raw = seriesFor(v).filter((n) => n !== null && n !== undefined && !Number.isNaN(n));
            if (!raw.length) return;
            const min = Math.min(...raw);
            const max = Math.max(...raw);
            const avg = raw.reduce((a, b) => a + b, 0) / raw.length;
            const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

            const chip = document.createElement("div");
            chip.className = "opd-card-stat-chip";
            chip.style.borderColor = hexToRgba(color, 0.35);

            const dot = document.createElement("span");
            dot.className = "opd-card-stat-dot";
            dot.style.background = color;
            chip.appendChild(dot);

            const label = document.createElement("span");
            label.className = "opd-card-stat-label";
            label.textContent = v.label + (multiGroup ? " — " + graphGroupName(v.groupId || card.deviceGroupId) : "");
            chip.appendChild(label);

            const minmax = document.createElement("span");
            minmax.className = "opd-card-stat-minmax";
            minmax.textContent = `Avg ${fmt(avg)} · Max ${fmt(max)} · Min ${fmt(min)} ${v.unit}`;
            chip.appendChild(minmax);

            statsEl.appendChild(chip);
        });

        if (!statsEl.children.length) {
            statsEl.innerHTML = `<span class="opd-card-stat-empty">No data in this range.</span>`;
        }
    }

    // Same as renderCardStats() above, but for a saved "Stack" card —
    // shows one chip per derived segment (PV/Battery/PLN) instead of
    // per checked variable, matching the modal preview's stat chips.
    function renderCardStackStats(card, stackDef, segments) {
        const statsEl = document.querySelector(`[data-card-stats="${card.id}"]`);
        if (!statsEl) return;
        statsEl.innerHTML = "";
        const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

        stackDef.segments.forEach((seg) => {
            const raw = (segments[seg.id] || []).filter((n) => typeof n === "number" && isFinite(n));
            if (!raw.length) return;
            const avg = raw.reduce((a, b) => a + b, 0) / raw.length;

            const chip = document.createElement("div");
            chip.className = "opd-card-stat-chip";
            chip.style.borderColor = hexToRgba(seg.color, 0.35);
            chip.innerHTML = `
                <span class="opd-card-stat-dot" style="background:${seg.color}"></span>
                <span class="opd-card-stat-label">${esc(seg.label)}</span>
                <span class="opd-card-stat-minmax">Avg ${fmt(avg)} kWh/day</span>
            `;
            statsEl.appendChild(chip);
        });

        if (!statsEl.children.length) {
            statsEl.innerHTML = `<span class="opd-card-stat-empty">No data in this range.</span>`;
        }
    }

    // ===========================================================
    // LAZY LOADERS — System Information / Battery Station / Task
    // Management. Same fetch-once-then-init pattern as Admin 360's
    // js/project-monitoring.js (loadSystem/loadBattery/loadTask),
    // just pointed at this page's own panels (#opdPanel-<tab>) so an
    // Operator sees the exact same page Admin 360 uses.
    // ===========================================================
    function loadSystem() {
        if (systemLoadPromise) return systemLoadPromise;

        const panel = document.getElementById("opdPanel-system");
        if (!panel) return Promise.resolve();

        systemLoadPromise = fetch("pages/system-information.html", { cache: "no-store" })
            .then((res) => {
                if (!res.ok) throw new Error("HTTP " + res.status + " saat fetch system-information.html");
                return res.text();
            })
            .then((html) => {
                panel.innerHTML = html;
                if (typeof initSystemInformation === "function") {
                    try {
                        initSystemInformation();
                    } catch (e) {
                        console.error("[operator-dashboard] initSystemInformation error:", e);
                        panel.innerHTML += `<p style="padding:12px;color:red;">Sebagian konten System Information gagal dimuat (lihat console: ${esc(String(e.message || e))}).</p>`;
                    }
                }
                if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
                bindNeedMaintenanceButton();
            })
            .catch((err) => {
                console.error("[operator-dashboard] loadSystem error:", err);
                systemLoadPromise = null;
                panel.innerHTML = `<p style="padding:20px;color:red;">Gagal memuat System Information: ${esc(String(err.message || err))}</p>`;
            });

        return systemLoadPromise;
    }

    function loadBattery() {
        if (batteryLoadPromise) return batteryLoadPromise;

        const panel = document.getElementById("opdPanel-battery");
        if (!panel) return Promise.resolve();

        batteryLoadPromise = fetch("pages/battery-station.html", { cache: "no-store" })
            .then((res) => {
                if (!res.ok) throw new Error("HTTP " + res.status + " saat fetch battery-station.html");
                return res.text();
            })
            .then((html) => {
                panel.innerHTML = html;
                if (typeof initBatteryStation === "function") {
                    try {
                        initBatteryStation();
                    } catch (e) {
                        console.error("[operator-dashboard] initBatteryStation error:", e);
                        panel.innerHTML += `<p style="padding:12px;color:red;">Sebagian konten Battery Station gagal dimuat (lihat console: ${esc(String(e.message || e))}).</p>`;
                    }
                }
                if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
            })
            .catch((err) => {
                console.error("[operator-dashboard] loadBattery error:", err);
                batteryLoadPromise = null;
                panel.innerHTML = `<p style="padding:20px;color:red;">Gagal memuat Battery Station: ${esc(String(err.message || err))}</p>`;
            });

        return batteryLoadPromise;
    }

    function loadTask() {
        if (taskLoadPromise) return taskLoadPromise;

        const panel = document.getElementById("opdPanel-task");
        if (!panel) return Promise.resolve();

        taskLoadPromise = fetch("pages/task-management.html", { cache: "no-store" })
            .then((res) => {
                if (!res.ok) throw new Error("HTTP " + res.status + " saat fetch task-management.html");
                return res.text();
            })
            .then((html) => {
                panel.innerHTML = html;
                if (typeof initTaskManagement === "function") {
                    try {
                        initTaskManagement();
                    } catch (e) {
                        console.error("[operator-dashboard] initTaskManagement error:", e);
                        panel.innerHTML += `<p style="padding:12px;color:red;">Sebagian konten Task Management gagal dimuat (lihat console: ${esc(String(e.message || e))}).</p>`;
                    }
                }
                if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
            })
            .catch((err) => {
                console.error("[operator-dashboard] loadTask error:", err);
                taskLoadPromise = null;
                panel.innerHTML = `<p style="padding:20px;color:red;">Gagal memuat Task Management: ${esc(String(err.message || err))}</p>`;
            });

        return taskLoadPromise;
    }

    // Bridge: System Information -> Task Management (same "Ajukan
    // Task Maintenance" button/behavior as Admin 360's Project
    // Monitoring — js/project-monitoring.js's bindNeedMaintenanceButton
    // / pmGoToTaskManagement). Rebound to THIS page's own switchTab()/
    // loadTask() rather than the global pmGoToTaskManagement, since
    // that one targets #pmTabs/#pmPanel-task which don't exist here.
    let opdPendingUnitId = null;
    function bindNeedMaintenanceButton() {
        const btn = document.getElementById("siNeedMaintenanceBtn");
        if (!btn) return;

        btn.onclick = () => {
            const nameEl = document.getElementById("siDetailName");
            const unitName = nameEl ? nameEl.textContent.trim() : "";
            const sys = (window.__siSystems || []).find(
                (s) => s.basic && s.basic.systemName === unitName
            );
            opdPendingUnitId = sys ? sys.id : null;

            switchTab("task");
            loadTask().then(() => {
                if (opdPendingUnitId && typeof window.tmOpenAddForUnit === "function") {
                    const unitId = opdPendingUnitId;
                    opdPendingUnitId = null;
                    // beri jeda kecil supaya DOM task-management selesai ter-render
                    setTimeout(() => window.tmOpenAddForUnit(unitId), 30);
                }
            });
        };
    }

    function switchTab(tab) {
        if (!tab || !TABS.includes(tab)) return;
        activeTab = tab;

        document.querySelectorAll("#opdTabs .pm-tab").forEach((btn) => {
            btn.classList.toggle("is-active", btn.getAttribute("data-tab") === tab);
        });
        document.querySelectorAll(".opd-page .pm-tab-panel").forEach((panel) => {
            panel.classList.toggle("is-active", panel.getAttribute("data-panel") === tab);
        });

        fillSearchWithActiveProject();

        // Project Overview keeps its own in-page card grid; the other
        // three tabs lazy-fetch their real Admin 360 page on first visit.
        if (tab === "project") renderGrid(tab);

        // Operator ini belum di-assign project apa pun (lihat
        // opdEnsureActiveProject() above) -- jangan panggil
        // loadSystem/loadBattery/loadTask sama sekali, karena kalau
        // dibiarkan, ketiganya akan fallback ke default "tawabi" di
        // masing-masing modul (bukan "kosong yang benar"), which
        // salah menampilkan data proyek yang BUKAN milik operator ini.
        if (operatorProjectStatus === "none" && tab !== "project") {
            const panel = document.getElementById("opdPanel-" + tab);
            if (panel && !panel.dataset.opdNoProjectRendered) {
                panel.innerHTML = `<p style="padding:40px 20px;text-align:center;color:var(--text-secondary,#888);">Anda belum memiliki project yang ditugaskan. Hubungi 360master/Admin untuk mendapatkan akses project.</p>`;
                panel.dataset.opdNoProjectRendered = "1";
            }
            return;
        }

        if (tab === "system") loadSystem();
        if (tab === "battery") loadBattery();
        if (tab === "task") loadTask();
    }

    document.querySelectorAll("#opdTabs .pm-tab").forEach((btn) => {
        btn.onclick = () => switchTab(btn.getAttribute("data-tab"));
    });

    // The "Add Graph" button next to the search bar always adds to
    // the Project Overview tab, regardless of which tab is active —
    // the other sub-tabs are left empty for now (they still get
    // their own "+" tile per grid for later).
    if (addGraphBtn) {
        addGraphBtn.onclick = () => openGraphModal("project");
    }

    if (searchInput) {
        searchInput.oninput = () => renderGrid(activeTab);
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") renderGrid(activeTab);
        });
    }

    // ---------- Fullscreen toggle: page content only ----------
    // Targets `.edash-content` — the scrollable main-content region,
    // a sibling of #header-root and outside #sidebar-root — so the
    // native Fullscreen API naturally excludes both the header and
    // the sidebar. Icon-only button; icon swaps expand <-> compress
    // to reflect actual state (also catches Esc / browser-UI exits
    // via fullscreenchange, not just clicks on the button).
    const fullscreenTarget = document.querySelector(".edash-content");
    if (fullscreenBtn && fullscreenTarget) {
        const setFullscreenIcon = () => {
            const isFs = document.fullscreenElement === fullscreenTarget;
            fullscreenBtn.innerHTML = `<i class="fa-solid ${isFs ? "fa-compress" : "fa-expand"}"></i>`;
            fullscreenBtn.title = isFs ? "Exit fullscreen" : "Fullscreen";
        };
        fullscreenBtn.onclick = () => {
            if (document.fullscreenElement === fullscreenTarget) {
                document.exitFullscreen();
            } else if (fullscreenTarget.requestFullscreen) {
                fullscreenTarget.requestFullscreen().catch((err) => {
                    console.warn("[operator-dashboard] Fullscreen request failed:", err.message);
                });
            }
        };
        document.addEventListener("fullscreenchange", setFullscreenIcon);
    }

    // ===========================================================
    // "Create graph" modal — opened by "Add Graph" / the Project
    // Overview grid's "+" tile. Two panes: left = variable checklist
    // grouped by category, right = live preview + title/type
    // controls. On "Add graph" it pushes a real chart card into the
    // tab that was active when the modal was opened (always
    // "project" here, since that's the only tab with a grid).
    // ===========================================================

    const PALETTE = [
        "#0F6A71", "#6DC3BB", "#2F9E6E", "#3E7CB1",
        "#E3A21A", "#D64545", "#0B4F54", "#7C8B8D",
    ];
    const CATEGORY_ORDER = [
        "ENERGY", "BATTERY PERFORMANCE", "BATTERY BMS",
        "BATTERY ENERGY", "BATTERY STATUS", "INVERTER",
        "PV STRING VOLTAGE", "PV STRING CURRENT", "PV STRING POWER",
        "AC OUTPUT", "GRID & LOAD",
    ];

    const graphModal = document.getElementById("opdGraphModal");
    const graphVarPanel = document.getElementById("opdGraphVarPanel");
    const graphTitleInput = document.getElementById("opdGraphTitleInput");
    const graphTypeField = document.getElementById("opdGraphTypeField");
    const graphTypeToggle = document.getElementById("opdGraphTypeToggle");
    const graphPreviewBox = document.getElementById("opdGraphPreviewBox");
    const graphEmptyState = document.getElementById("opdGraphEmptyState");
    const graphCanvas = document.getElementById("opdGraphPreviewCanvas");
    const graphStatsRow = document.getElementById("opdGraphStatsRow");
    const graphLegend = document.getElementById("opdGraphLegend");
    const graphCaption = document.getElementById("opdGraphPreviewCaption");
    const graphDeviceToggle = document.getElementById("opdGraphDeviceToggle");
    const graphChartPanel = document.getElementById("opdGraphChartPanel");
    const graphAddBtn = document.getElementById("opdGraphAddBtn");
    const graphCancelBtn = document.getElementById("opdGraphCancelBtn");
    const graphCloseBtn = document.getElementById("opdGraphCloseBtn");
    // Loading skeleton / error+retry state — same component as Project
    // Detail's "Add Graph" modal (js/project-detail.js
    // setPdGraphModalPhase/openPdGraphModal). The modal now opens
    // INSTANTLY when clicked instead of waiting for the telemetry fetch
    // to finish first, showing this skeleton meanwhile so it never just
    // looks like a dead button while real API calls are in flight.
    const graphLoading = document.getElementById("opdGraphLoading");
    const graphError = document.getElementById("opdGraphError");
    const graphErrorMsg = document.getElementById("opdGraphErrorMsg");
    const graphRetryBtn = document.getElementById("opdGraphRetryBtn");
    const graphBody = document.getElementById("opdGraphBody");
    const graphDeviceSwitch = document.getElementById("opdGraphDeviceSwitch");
    const graphSubtitle = document.getElementById("opdGraphSubtitle");

    let gSelected = [];        // selected variable objects, in click order
    let gChartType = "line";
    let gTitleTouched = false;
    let gPreviewChart = null;
    let gCurrentGroupId = null;
    let gTargetTab = "project"; // which tab "Add graph" appends to
    let gPanelBuilt = false;
    // id of the card currently being EDITED (clicked its title in the
    // grid), or null when the modal is in normal "Add graph" mode —
    // see openGraphModal(tab, editCard) / graphAddBtn's click handler
    // below, and cardTitleClick() which sets this by re-opening the
    // modal with the clicked card passed in.
    let gEditingCardId = null;
    // Which project graphCatalog/gCurrentGroupId/gPanelBuilt currently
    // belong to — openGraphModal() compares this against opdActiveProjectId
    // every time it's opened and resets all three if the Operator switched
    // project since the modal was last built (same guard as Project
    // Detail's pdGraphViewProjectId).
    let graphCatalogProjectId = null;
    const graphCatalogByProject = {};
    const graphCatalogPromiseByProject = {};

    // ===========================================================
    // Real telemetry -> "Add Graph" catalog builder (generic, works for
    // whatever project this Operator has active — ported from Admin
    // 360's Project Detail equivalent, js/project-detail.js
    // PD_GRAPH_VAR_DEFS / pdFetchGraphUnitsForProject /
    // pdBuildGraphCatalogFromUnits). Pulls straight from the Core API
    // (GET /projects/:id + GET /devices/:id/telemetry/history) instead
    // of server/data/tawabi-graph-variables.json, so "Add Graph" always
    // reflects whichever project this Operator is actually assigned to.
    // ===========================================================
    const GRAPH_HISTORY_DAYS = 90;
    const GRAPH_TIMEZONE = "Asia/Jayapura";
    // Interval EKSPLISIT (bukan diserahkan ke adaptive tiering backend)
    // untuk histori 30-hari ("30 Days") DAN rentang "Custom" -- 2 jam,
    // dipaksa lewat query param supaya resolusinya SELALU sama persis
    // setiap kali, tidak tergantung nebak-nebak adaptive tiering backend
    // (yang bisa berbeda hasilnya tergantung kepadatan data/durasi query
    // eksak) -- SAMA konstanta dgn Project Detail's PD_TWO_HOUR_INTERVAL_MS
    // (js/project-detail.js), supaya kedua halaman selalu tampil identik.
    const GRAPH_TWO_HOUR_INTERVAL_MS = 2 * 60 * 60 * 1000;

    // Flat list of every plottable telemetry path in the normalized
    // Rev3 schema (overview/battery/diagnostics/pvStrings/ac3Phase/
    // grid/load) — same set Project Detail offers in "Add Graph".
    const GRAPH_VAR_DEFS = [
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

    // Paths that are cumulative/daily registers (reset each day or
    // ever-increasing) -> bucket by MAX per day. Everything else is a
    // point-in-time gauge -> bucket by AVERAGE per day.
    const GRAPH_CUMULATIVE_PATHS = new Set([
        "overview.energyToday", "overview.energyTotal",
        "battery.dailyCharge", "battery.dailyDischarge",
        "grid.dailyFeedIn", "grid.totalFeedIn", "grid.dailyPurchased", "grid.totalPurchased",
        "load.dailyConsumption", "load.totalConsumption",
    ]);

    // Same "A vs B" pairs whitelist as Project Detail's
    // PD_GRAPH_COMPARE_PAIRS (js/project-detail.js) — only the generic
    // Core API path scheme applies here, since this catalog is always
    // built from real telemetry now, never the old short Tawabi-logger
    // keys.
    const GRAPH_COMPARE_PAIRS = [
        { top: "overview.energyToday", bottom: "load.dailyConsumption", label: "Produksi vs Konsumsi Energi (Harian)" },
        { top: "grid.dailyFeedIn", bottom: "grid.dailyPurchased", label: "Energi Dijual vs Dibeli dari Grid (Harian)" },
        { top: "battery.dailyCharge", bottom: "battery.dailyDischarge", label: "Charging vs Discharging Energi Baterai (Harian)" },
    ];

    // Same derived-breakdown "Stack" feature as Project Detail's
    // PD_GRAPH_STACK_SOURCES/PD_GRAPH_STACK_CONFIGS — splits ONE checked
    // variable (Daily Consumption or Daily Production) into 3 segments
    // (PV / Battery / PLN) using the other raw daily series for the
    // same day.
    const GRAPH_STACK_SOURCES = {
        pv: { key: "overview.energyToday" },
        feedIn: { key: "grid.dailyFeedIn" },
        charge: { key: "battery.dailyCharge" },
        discharge: { key: "battery.dailyDischarge" },
        purchased: { key: "grid.dailyPurchased" },
    };
    const GRAPH_STACK_CONFIGS = {
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
                { id: "pln", label: "To PLN (Grid Export)", color: "#D64545",
                    compute: (r) => r.feedIn !== null ? Math.max(0, r.feedIn) : null },
            ],
        },
    };

    // True when the checked variables were checked under 2+ DIFFERENT
    // device groups (e.g. Grup 1's Battery Voltage + Grup 2's Battery
    // Voltage in one comparison chart) -- ported 1:1 from Project
    // Detail's pdSelectionSpansMultipleGroups (js/project-detail.js).
    function selectionSpansMultipleGroups(selectedVars) {
        if (!selectedVars || !selectedVars.length) return false;
        const groupIds = new Set(selectedVars.map((v) => v.groupId).filter(Boolean));
        return groupIds.size > 1;
    }

    // Device group's display name for the "— Grup X" legend/tooltip/
    // caption suffix used once a selection spans multiple groups (see
    // selectionSpansMultipleGroups usages below). Falls back to the raw
    // id if the catalog isn't loaded yet / the group can't be found, so
    // a caption never ends up with a literal "undefined".
    function graphGroupName(groupId) {
        if (!groupId) return "";
        const g = graphCatalog && graphCatalog.deviceGroups && graphCatalog.deviceGroups.find((gr) => gr.id === groupId);
        return (g && g.name) || groupId;
    }

    function findComparePair(selectedVars) {
        if (!selectedVars || selectedVars.length !== 2) return null;
        // "Compare" mirrors ONE device's own production against its own
        // consumption etc. -- mixing 2 different inverters/groups into
        // this mode doesn't mean anything, so bail out the same as "no
        // match" once the selection spans more than one group. Same
        // guard as Project Detail's pdFindComparePair.
        if (selectionSpansMultipleGroups(selectedVars)) return null;
        const keys = selectedVars.map((v) => v.key);
        const pair = GRAPH_COMPARE_PAIRS.find((p) => keys.includes(p.top) && keys.includes(p.bottom));
        if (!pair) return null;
        return {
            pair,
            topVar: selectedVars.find((v) => v.key === pair.top),
            bottomVar: selectedVars.find((v) => v.key === pair.bottom),
        };
    }

    function findStackDef(selectedVars) {
        if (!selectedVars || selectedVars.length !== 1) return null;
        const config = GRAPH_STACK_CONFIGS[selectedVars[0].key];
        return config ? { key: selectedVars[0].key, label: config.label, segments: config.segments, groupId: selectedVars[0].groupId } : null;
    }

    function computeStackSegments(seriesFn, segmentDefs) {
        const pv = seriesFn(GRAPH_STACK_SOURCES.pv);
        const feedIn = seriesFn(GRAPH_STACK_SOURCES.feedIn);
        const charge = seriesFn(GRAPH_STACK_SOURCES.charge);
        const discharge = seriesFn(GRAPH_STACK_SOURCES.discharge);
        const purchased = seriesFn(GRAPH_STACK_SOURCES.purchased);
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

    // Same manual-accumulate technique as Project Detail's
    // pdBuildStackAreaDatasets: Chart.js doesn't auto-stack "line" type
    // datasets, so values are accumulated segment-by-segment and each
    // (besides the bottom one) fills "-1" (into the PREVIOUS dataset,
    // not the origin) so what's visible is just each layer, not the
    // cumulative area blending on top of each other.
    function buildStackAreaDatasets(segments, length, segmentDefs) {
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
                backgroundColor: hexToRgba(seg.color, 0.28),
                fill: idx === 0 ? "origin" : "-1",
                spanGaps: true,
                tension: 0.35,
                pointRadius: 0,
                borderWidth: 2,
                pdRawValues: segments[seg.id],
            };
        });
    }

    function stackTooltipCallbacks() {
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

    function graphDateInTz(ts) {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: GRAPH_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ts));
        const get = (t) => parts.find((p) => p.type === t)?.value || "00";
        return `${get("year")}-${get("month")}-${get("day")}`;
    }
    function graphLastNDates(n) {
        const out = [];
        const now = Date.now();
        for (let i = n - 1; i >= 0; i--) out.push(graphDateInTz(now - i * 86400000));
        return out;
    }
    function graphBucketByDateMax(series) {
        const map = {};
        (series || []).forEach((pt) => {
            const d = graphDateInTz(pt.ts);
            const v = Number(pt.value);
            if (!Number.isFinite(v)) return;
            if (!(d in map) || v > map[d]) map[d] = v;
        });
        return map;
    }
    function graphBucketByDateAvg(series) {
        const sums = {}, counts = {};
        (series || []).forEach((pt) => {
            const d = graphDateInTz(pt.ts);
            const v = Number(pt.value);
            if (!Number.isFinite(v)) return;
            sums[d] = (sums[d] || 0) + v;
            counts[d] = (counts[d] || 0) + 1;
        });
        const map = {};
        Object.keys(sums).forEach((d) => { map[d] = sums[d] / counts[d]; });
        return map;
    }
    function graphGetPath(obj, path) {
        return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), obj);
    }

    // FIX: "24 Hours"/"7 Days"/"30 Days"/"Custom" dulu di-bucket/rata-
    // ratakan (per-jam, per-2-jam) dari satu fetch 90-hari kasar --
    // kelihatan jauh lebih "halus"/beda bentuk kurvanya dari grafik
    // System Information untuk device yang sama (yang plot SEMUA titik
    // raw dari response API, biasanya tiap beberapa menit). Sekarang
    // plot LANGSUNG titik raw dari fetch history1d/history7d/history30d/
    // historyCustom terpisah (lihat fetchGraphUnitsForProject di bawah),
    // TANPA agregasi apa pun -- resolusi & bentuk kurvanya jadi identik
    // dengan System Information. Ported 1:1 dari Project Detail's
    // pdRawPeriodLabelsFromHistory/pdRawHourlyLabelsFromHistory1d
    // (js/project-detail.js).
    const GRAPH_HOURLY_LABEL_PRIORITY = [
        "overview.currentPower", "overview.pvTotalPower",
        "ac3Phase.phaseR.voltage", "ac3Phase.phaseR.current", "battery.voltage",
    ];
    function graphRawPeriodLabelsFromHistory(historyResp, tz, withDate) {
        let reference = null;
        for (const path of GRAPH_HOURLY_LABEL_PRIORITY) {
            const s = graphGetPath(historyResp, path);
            if (Array.isArray(s) && s.length) { reference = s; break; }
        }
        if (!reference) {
            for (const def of GRAPH_VAR_DEFS) {
                const s = graphGetPath(historyResp, def.path);
                if (Array.isArray(s) && s.length) { reference = s; break; }
            }
        }
        if (!reference) return [];
        const fmt = withDate
            ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
            : new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
        return reference.map((pt) => fmt.format(new Date(pt.ts)));
    }
    function graphRawHourlyLabelsFromHistory1d(history1d, tz) {
        return graphRawPeriodLabelsFromHistory(history1d, tz, false);
    }

    // Systems/devices for WHATEVER project is active — no Tawabi-only
    // hardcoded fallback IDs: a project with no systems/devices wired
    // up in the Core API just yields an empty catalog (ensureGraphCatalog()
    // surfaces a clear error message via the modal's error state below),
    // rather than silently substituting some other project's device.
    function graphExtractSystems(project) {
        return (project && (project.systems || project.units)) || [];
    }
    function graphExtractDevicesForSystem(project, system, systemIndex, totalSystems) {
        const devicesArr = (system && (system.devices || system.inverters)) || [];
        if (devicesArr.length) return devicesArr;
        const projectDevices = (project && (project.devices || project.inverters)) || [];
        const matched = projectDevices.filter((d) => (d.system_id || d.systemId) === system?.id);
        if (matched.length) return matched;
        if (projectDevices.length === totalSystems) {
            return projectDevices[systemIndex] ? [projectDevices[systemIndex]] : [];
        }
        return systemIndex === 0 ? projectDevices : [];
    }

    // Runs `taskFns` (each a zero-arg function returning a Promise) with
    // at most `limit` running at once, in ORIGINAL ORDER in the returned
    // array -- ported 1:1 from Project Detail's pdRunBatched
    // (js/project-detail.js). Used below so pulling 4 history ranges x
    // several devices doesn't all fire simultaneously and starve/queue
    // behind each other on the backend.
    async function runBatched(taskFns, limit) {
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

    async function graphFetchDeviceHistoryRange(deviceId, startTs, endTs, intervalMs) {
        try {
            const intervalParam = intervalMs ? `&interval=${intervalMs}` : "";
            const raw = await window.edashApiFetch(`/devices/${deviceId}/telemetry/history?startTs=${startTs}&endTs=${endTs}${intervalParam}`);
            return raw?.telemetry || null;
        } catch (e) {
            console.warn(`[operator-dashboard] Gagal ambil telemetry/history untuk ${deviceId}:`, e.message);
            return null;
        }
    }
    async function graphFetchDeviceHistory(deviceId, rangeDays, intervalMs) {
        // Round endTs DOWN to the nearest minute (same fix as Project
        // Detail's pdFetchDeviceHistory) -- a raw Date.now() has
        // milliseconds that always differ, so endTs (and the startTs
        // derived from it) is different on every call even within the
        // same second, which permanently misses the backend cache.
        const endTs = Math.floor(Date.now() / 60000) * 60000;
        const startTs = endTs - (rangeDays || GRAPH_HISTORY_DAYS) * 24 * 60 * 60 * 1000;
        return graphFetchDeviceHistoryRange(deviceId, startTs, endTs, intervalMs);
    }

    // Real per-project units: fetch GET /projects/:id, walk its
    // systems/devices, pull 2 telemetry/history ranges per device --
    // 1 day + GRAPH_HISTORY_DAYS(90) days. That's enough to build the
    // full variable list/categories/colors AND the "24 Hours"/daily
    // views, so the "Add Graph" modal (which only ever needs those, not
    // 7D/30D) opens fast. history7d/history30d (needed for "7
    // Days"/"30 Days" to plot RAW points instead of the 90-day fetch's
    // daily-bucketed ones) are fetched SEPARATELY and don't block this
    // -- see ensureGraphWeeklyMonthlyData() below. Ported 1:1 from
    // Project Detail's pdFetchGraphUnitsForProject
    // (js/project-detail.js), adapted to this page's generic
    // (non-Tawabi-hardcoded) project/device lookup, PLUS split into a
    // fast/slow pair so opening "Add Graph" doesn't wait on 7D/30D data
    // it never actually uses.
    const graphUnitsCacheByProject = {};
    // FIX (disclaimer §5 poin 1 & 2, disamakan dgn Project Detail's
    // pdFetchGraphUnitsForProject): opts.lite=true cuma fetch history1d
    // (1 request/device) -- TANPA ikut fetch 90-hari (yang tetap murni
    // on-demand lewat ensureGraphCatalog() saat tab 7D/30D/Custom
    // diklik atau modal "Add Graph" dibuka). Dipakai OLEH
    // ensureHourlyCatalog() di bawah buat ngisi mode 24H kartu begitu
    // project ini dibuka/di-switch, TANPA nge-fetch histori 90/7/30
    // hari paralel untuk SEMUA unit sekaligus (yang sebelumnya bikin
    // load pertama kali proyek berat, bukan cuma 24-jam). Cache key
    // dipisah ("<id>::lite" vs "<id>") supaya hasil lite TIDAK PERNAH
    // tertukar/dianggap sama dengan hasil fetch penuh.
    async function fetchGraphUnitsForProject(projectId, opts) {
        const lite = !!(opts && opts.lite);
        const cacheKey = lite ? `${projectId}::lite` : projectId;
        if (graphUnitsCacheByProject[cacheKey]) return graphUnitsCacheByProject[cacheKey];

        const project = await window.edashApiFetch(`/projects/${projectId}`);
        if (!project) return [];

        const systemsMeta = graphExtractSystems(project);
        const jobs = [];
        systemsMeta.forEach((system, i) => {
            const devices = graphExtractDevicesForSystem(project, system, i, systemsMeta.length);
            devices.forEach((device) => {
                const deviceId = device && (device.id || device.thingsboardDeviceId);
                if (!deviceId) return;
                const systemLabel = (system && (system.system_name || system.systemName || system.name)) || `Grup ${i + 1}`;
                jobs.push(
                    lite
                        // Mode lite: cuma history1d, SATU request/device --
                        // bukan 2 request/device (1+90 hari) kayak fetch
                        // penuh di bawah.
                        ? () => graphFetchDeviceHistory(deviceId, 1).then((history1d) => ({ deviceId, systemLabel, history: null, history1d, history7d: null, history30d: null }))
                        : () => Promise.all([
                            graphFetchDeviceHistory(deviceId, 1),
                            graphFetchDeviceHistory(deviceId, GRAPH_HISTORY_DAYS),
                        ]).then(([history1d, history]) => ({ deviceId, systemLabel, history, history1d, history7d: null, history30d: null }))
                );
            });
        });
        // Batasi 2 unit sekaligus, bukan Promise.all polos atas SEMUA
        // unit proyek -- sama alasannya dengan batching di atas.
        const units = (await runBatched(jobs, 2)).filter((u) => lite ? u.history1d : u.history);
        graphUnitsCacheByProject[cacheKey] = units;
        return units;
    }

    // Versi TERPISAH dari fetch dasar di atas -- narik
    // history7d/history30d (2 request/device tambahan) untuk unit-unit
    // yang SUDAH ada di graphUnitsCacheByProject, TANPA membuat modal
    // "Add Graph"/katalog dasar menunggu ini beres. HANYA dipanggil
    // dari setCardPeriodMode() begitu Operator BENERAN klik toggle
    // "7 Days"/"30 Days" pada kartu manapun (TIDAK lagi fire-and-forget
    // dari ensureGraphCatalog() -- lihat catatan FIX di sana -- supaya
    // history7d/history30d beneran cuma ke-fetch on-demand, bukan
    // proaktif begitu modal "Add Graph" dibuka).
    const graphWeeklyMonthlyPromiseByProject = {};
    const graphWeeklyMonthlySettledByProject = {};
    function isGraphWeeklyMonthlySettled(projectId) {
        return !!graphWeeklyMonthlySettledByProject[projectId || opdActiveProjectId];
    }
    function ensureGraphWeeklyMonthlyData(projectId) {
        const id = projectId || opdActiveProjectId;
        if (!id) return Promise.resolve(false);
        if (graphWeeklyMonthlyPromiseByProject[id]) return graphWeeklyMonthlyPromiseByProject[id];

        const promise = fetchGraphUnitsForProject(id)
            .then(async (units) => {
                if (!units.length) return false;
                const results = await runBatched(units.map((u) => () => Promise.all([
                    graphFetchDeviceHistory(u.deviceId, 7),
                    graphFetchDeviceHistory(u.deviceId, 30, GRAPH_TWO_HOUR_INTERVAL_MS),
                ])), 2);
                units.forEach((u, i) => {
                    u.history7d = results[i][0];
                    u.history30d = results[i][1];
                });
                // Timpa cuma `.groups` katalog yang sudah ada (bukan
                // rebuild categories/warna/id-nya) -- sama pola dgn
                // ensureGraphCustomData, supaya id/warna variabel yang
                // sudah kepilih di modal tidak berubah begitu 7D/30D-nya
                // selesai ditarik di belakang layar.
                const rebuilt = buildGraphCatalogFromUnits(units);
                const catalog = graphCatalogByProject[id];
                if (catalog) catalog.groups = rebuilt.groups;
                return true;
            })
            .catch((e) => {
                console.warn(`[operator-dashboard] Gagal memuat histori 7D/30D (project ${id}):`, e.message);
                return false;
            })
            .finally(() => { graphWeeklyMonthlySettledByProject[id] = true; });
        graphWeeklyMonthlyPromiseByProject[id] = promise;
        return promise;
    }

    // Turn real per-device telemetry history into { meta: {vars,
    // status_vars}, groups:{grup1:{name,sn,data:{labels,<path>:[...]}},
    // ...} } — same shape the old static tawabi-graph-variables.json
    // file had, so the category/color/deviceGroup assembly in
    // ensureGraphCatalog() below doesn't need to change. `hourly`/
    // `weekly`/`monthly` now hold RAW per-point values straight off
    // history1d/history7d/history30d (see the FIX note on
    // graphRawPeriodLabelsFromHistory above) instead of bucketed
    // averages; `weekly`/`monthly`/`custom` start empty until
    // ensureGraphWeeklyMonthlyData()/ensureGraphCustomData() actually
    // fill them in (see above). Ported 1:1 from Project Detail's
    // pdBuildGraphCatalogFromUnits.
    function buildGraphCatalogFromUnits(units) {
        const dates = graphLastNDates(GRAPH_HISTORY_DAYS);
        const groups = {};
        units.forEach((u, i) => {
            const gid = `grup${i + 1}`;
            const data = { labels: dates };
            const hourlyLabels = graphRawHourlyLabelsFromHistory1d(u.history1d, GRAPH_TIMEZONE);
            const hourly = { labels: hourlyLabels };
            const weeklyLabels = graphRawPeriodLabelsFromHistory(u.history7d, GRAPH_TIMEZONE, true);
            const weekly = { labels: weeklyLabels };
            const monthlyLabels = graphRawPeriodLabelsFromHistory(u.history30d, GRAPH_TIMEZONE, true);
            const monthly = { labels: monthlyLabels };
            const customLabels = graphRawPeriodLabelsFromHistory(u.historyCustom, GRAPH_TIMEZONE, true);
            const custom = { labels: customLabels };
            GRAPH_VAR_DEFS.forEach((def) => {
                const series = graphGetPath(u.history, def.path);
                if (Array.isArray(series) && series.length) {
                    const map = GRAPH_CUMULATIVE_PATHS.has(def.path) ? graphBucketByDateMax(series) : graphBucketByDateAvg(series);
                    data[def.path] = dates.map((d) => (d in map ? +map[d].toFixed(3) : null));
                }
                // Titik RAW (bukan lagi di-bucket per jam) dari
                // history1d/history7d/history30d/historyCustom -- sama
                // pola pemetaan untuk keempatnya, cuma bedanya sumber
                // fetch-nya (lihat pdBuildGraphCatalogFromUnits, catatan
                // FIX di atas).
                const series1d = graphGetPath(u.history1d, def.path);
                if (Array.isArray(series1d) && series1d.length && hourlyLabels.length) {
                    hourly[def.path] = series1d.slice(0, hourlyLabels.length).map((pt) => {
                        const n = Number(pt && pt.value);
                        return Number.isFinite(n) ? +n.toFixed(3) : null;
                    });
                }
                const series7d = graphGetPath(u.history7d, def.path);
                if (Array.isArray(series7d) && series7d.length && weeklyLabels.length) {
                    weekly[def.path] = series7d.slice(0, weeklyLabels.length).map((pt) => {
                        const n = Number(pt && pt.value);
                        return Number.isFinite(n) ? +n.toFixed(3) : null;
                    });
                }
                const series30d = graphGetPath(u.history30d, def.path);
                if (Array.isArray(series30d) && series30d.length && monthlyLabels.length) {
                    monthly[def.path] = series30d.slice(0, monthlyLabels.length).map((pt) => {
                        const n = Number(pt && pt.value);
                        return Number.isFinite(n) ? +n.toFixed(3) : null;
                    });
                }
                const seriesCustom = graphGetPath(u.historyCustom, def.path);
                if (Array.isArray(seriesCustom) && seriesCustom.length && customLabels.length) {
                    custom[def.path] = seriesCustom.slice(0, customLabels.length).map((pt) => {
                        const n = Number(pt && pt.value);
                        return Number.isFinite(n) ? +n.toFixed(3) : null;
                    });
                }
            });
            groups[gid] = { name: u.systemLabel, sn: u.deviceId, data, hourly, weekly, monthly, custom };
        });
        const vars = GRAPH_VAR_DEFS.filter((def) =>
            Object.values(groups).some((g) => Array.isArray(g.data[def.path]) && g.data[def.path].some((n) => n != null))
        ).map((def) => ({ key: def.path, label: def.label, unit: def.unit, category: def.category }));
        return { meta: { vars, status_vars: [] }, groups };
    }

    // ---------- persistent cache (sessionStorage) so "Add Graph" isn't ----------
    // ---------- slow again after a page refresh/reload -----------------------
    // FIX (permintaan user: "load graph lama banget, load pertama kali
    // biasa aja, abis itu pake cache"): sebelum ini graphCatalogByProject/
    // graphUnitsCacheByProject cuma cache di MEMORY JS -- makanya
    // kerasa instan kalau modal dibuka-tutup berkali-kali TANPA reload
    // halaman, tapi begitu di-refresh (F5) semuanya hilang dan 90 hari
    // telemetry per device ke-fetch ulang dari nol lagi, jadi kerasa
    // "lama banget" tiap kali. Ditambah lapisan sessionStorage (pakai
    // window.EdashStaleCache yang sudah ada di js/stale-cache.js, sudah
    // di-load index.html sebelum file ini) dengan pola stale-while-
    // revalidate: begitu ada versi tersimpan, TAMPILKAN LANGSUNG itu
    // (instan, 0 network) sambil narik versi terbaru di belakang layar
    // buat nimpa cache-nya -- jadi cuma load PERTAMA di tab ini yang
    // beneran nunggu network, sisanya (termasuk lintas refresh, selama
    // tab-nya sama) langsung dari cache.
    function graphCatalogCacheKey(projectId) {
        return `opd-add-graph-catalog:${projectId}`;
    }

    function refreshGraphCatalogInBackground(projectId) {
        // Bypass cache unit di memory (graphUnitsCacheByProject) supaya
        // ini BENERAN narik ulang dari Core API, bukan cuma balikin
        // hasil lama yang sama lagi.
        delete graphUnitsCacheByProject[projectId];
        fetchGraphUnitsForProject(projectId)
            .then((units) => {
                if (!units.length) return;
                // Sama pola dengan ensureGraphWeeklyMonthlyData: cuma
                // nimpa `.groups` (data telemetry-nya), BUKAN rebuild
                // categories/id/warna variabel -- supaya modal yang lagi
                // kebuka (kalau ada) tidak kehilangan pilihan variabel
                // yang sudah dicentang gara-gara id-nya berubah.
                const rebuilt = buildGraphCatalogFromUnits(units);
                const catalog = graphCatalogByProject[projectId];
                if (!catalog) return;
                catalog.groups = rebuilt.groups;
                if (window.EdashStaleCache) window.EdashStaleCache.set(graphCatalogCacheKey(projectId), catalog);
                if (projectId === opdActiveProjectId && graphModal && graphModal.classList.contains("is-open")) {
                    updateGraphPreview();
                }
            })
            .catch((e) => {
                console.warn(`[operator-dashboard] Gagal refresh katalog Add Graph di belakang layar (project ${projectId}):`, e.message);
            });
    }

    // ---------- fetch + build the variable catalog (per active project) ----------
    function ensureGraphCatalog() {
        const projectId = opdActiveProjectId;
        if (!projectId) return Promise.reject(new Error("Belum ada project aktif. Pilih/tunggu project ter-assign dulu."));

        // Sudah pernah dibangun di TAB ini (sesi JS masih hidup, belum
        // reload) -- pakai langsung dari memory, jangan sentuh network
        // atau sessionStorage sama sekali.
        if (graphCatalogByProject[projectId]) {
            if (projectId === opdActiveProjectId) {
                graphCatalog = graphCatalogByProject[projectId];
                graphCatalogProjectId = projectId;
            }
            return Promise.resolve(graphCatalogByProject[projectId]);
        }

        if (graphCatalogPromiseByProject[projectId]) return graphCatalogPromiseByProject[projectId];

        // Belum ada di memory (baru pertama kali dibuka DI TAB INI) --
        // coba dulu sessionStorage (bisa jadi ini bukan load pertama
        // beneran, cuma halamannya baru di-refresh).
        const cachedEntry = window.EdashStaleCache && window.EdashStaleCache.get(graphCatalogCacheKey(projectId));
        if (cachedEntry && cachedEntry.data) {
            const cachedCatalog = cachedEntry.data;
            graphCatalogByProject[projectId] = cachedCatalog;
            if (projectId === opdActiveProjectId) {
                graphCatalog = cachedCatalog;
                graphCatalogProjectId = projectId;
            }
            graphCatalogSettledByProject[projectId] = true;
            refreshGraphCatalogInBackground(projectId);
            return Promise.resolve(cachedCatalog);
        }

        const promise = fetchGraphUnitsForProject(projectId)
            .then((units) => {
                if (!units.length) {
                    throw new Error("Tidak ada unit dengan telemetry/history dari Core API untuk project ini.");
                }
                const raw = buildGraphCatalogFromUnits(units);

                let colorCursor = 0;
                const nextColor = () => PALETTE[(colorCursor++) % PALETTE.length];

                const numericVars = raw.meta.vars.map((v) => ({ ...v, plottable: true }));
                const statusVars = raw.meta.status_vars.map((v) => ({ ...v, unit: "", plottable: false }));
                const allVars = [...numericVars, ...statusVars];

                const categories = CATEGORY_ORDER
                    .map((name) => ({ name, vars: allVars.filter((v) => v.category === name) }))
                    .filter((cat) => cat.vars.length > 0);

                let uid = 0;
                categories.forEach((cat) => cat.vars.forEach((v) => {
                    v.id = "gv" + (uid++);
                    v.color = nextColor();
                }));

                const deviceGroups = Object.keys(raw.groups).map((gid) => ({
                    id: gid,
                    name: raw.groups[gid].name,
                    sn: raw.groups[gid].sn,
                }));

                const catalog = { categories, deviceGroups, groups: raw.groups };
                graphCatalogByProject[projectId] = catalog;
                if (projectId === opdActiveProjectId) {
                    graphCatalog = catalog;
                    graphCatalogProjectId = projectId;
                }
                // Simpan ke sessionStorage juga (lihat blok besar di atas
                // ensureGraphCatalog) -- supaya kalau tab ini di-refresh,
                // load BERIKUTNYA pakai cache ini dulu (instan) alih-alih
                // fetch 90 hari telemetry dari nol lagi.
                if (window.EdashStaleCache) window.EdashStaleCache.set(graphCatalogCacheKey(projectId), catalog);
                // FIX (permintaan user): dulu di sini ADA fire-and-forget
                // ensureGraphWeeklyMonthlyData(projectId) begitu katalog
                // dasar ini landing -- jadi SEKALIPUN Operator cuma buka
                // modal "Add Graph" buat lihat-lihat/pilih variabel (belum
                // tentu mau lihat 7D/30D sama sekali), history7d/history30d
                // buat SEMUA unit tetap ke-fetch di belakang layar.
                // Dihapus -- history7d/history30d SEKARANG BENERAN
                // cuma ditarik kalau Operator beneran klik toggle
                // "7 Days"/"30 Days"/"Custom" pada kartu manapun (lihat
                // setCardPeriodMode di atas, yang MEMANG SUDAH manggil
                // ensureGraphWeeklyMonthlyData()/ensureGraphCustomData()
                // sendiri begitu mode itu diklik -- jadi penghapusan ini
                // TIDAK menghilangkan fitur 7D/30D-nya sama sekali, cuma
                // menghapus prefetch proaktifnya).
                return catalog;
            })
            .catch((err) => {
                console.warn(`[operator-dashboard] Gagal membangun katalog Add Graph (project ${projectId}):`, err.message);
                delete graphCatalogPromiseByProject[projectId];
                throw err;
            })
            .finally(() => { graphCatalogSettledByProject[projectId] = true; });
        graphCatalogPromiseByProject[projectId] = promise;
        return promise;
    }

    // Dipakai kartu "Add Graph" (lewat isCardDataReady di bawah) buat
    // nunjukin overlay "Memuat data..." SEBELUM katalog dasar pernah
    // selesai di-fetch sama sekali -- tanpa ini, kartu 7D/30D/Custom
    // yang baru dibuka bisa kelihatan flat-0/kosong sekilas dan
    // gampang dikira "datanya memang segitu", bukan "belum sempat
    // di-fetch". Ported 1:1 dari Project Detail's
    // pdGraphCatalogSettledByProject/pdIsGraphCatalogSettled.
    const graphCatalogSettledByProject = {};
    function isGraphCatalogSettled(projectId) {
        return !!graphCatalogSettledByProject[projectId || opdActiveProjectId];
    }

    // FIX (disclaimer §5 poin 1 & 2, disamakan dgn Project Detail's
    // pdEnsureHourlyCatalog): versi RINGAN dari ensureGraphCatalog() di
    // atas -- cuma fetch history1d (lihat fetchGraphUnitsForProject(id,
    // {lite:true})), TANPA history 90/7/30-hari. Dipakai HANYA di
    // bootstrap awal & saat project di-switch, buat ngisi mode 24H
    // kartu "Add Graph" begitu project dibuka -- BUKAN pengganti
    // ensureGraphCatalog(): begitu Operator beneran klik tab
    // 7D/30D/Custom atau buka modal "Add Graph", ensureGraphCatalog()
    // (fetch penuh) tetap yang dipanggil (lihat setCardPeriodMode/
    // openGraphModal) dan hasilnya menimpa graphCatalogByProject[id]
    // di sini -- jadi katalog "lite" ini murni pengisi sementara, tidak
    // pernah dianggap final.
    //
    // Kalau fetch penuh SUDAH pernah jalan/lagi jalan
    // (graphCatalogPromiseByProject[id] ada), fungsi ini numpang ke
    // promise itu saja alih-alih fetch lite terpisah -- supaya tidak
    // ada 2 request history1d yang tumpang tindih buat device yang sama.
    const hourlyCatalogPromiseByProject = {};
    const hourlyCatalogSettledByProject = {};
    function ensureHourlyCatalog(projectId) {
        const id = projectId || opdActiveProjectId;
        if (!id) return Promise.reject(new Error("Belum ada project aktif. Pilih/tunggu project ter-assign dulu."));
        if (graphCatalogPromiseByProject[id]) return graphCatalogPromiseByProject[id];
        if (hourlyCatalogPromiseByProject[id]) return hourlyCatalogPromiseByProject[id];

        const promise = fetchGraphUnitsForProject(id, { lite: true })
            .then((units) => {
                if (!units.length) throw new Error(`Tidak ada unit dengan telemetry/history (lite) dari Core API untuk project "${id}".`);
                const raw = buildGraphCatalogFromUnits(units);
                const deviceGroups = Object.keys(raw.groups).map((gid) => ({
                    id: gid,
                    name: raw.groups[gid].name,
                    sn: raw.groups[gid].sn,
                }));
                // Katalog lite TIDAK dianggap final: categories/colors
                // sengaja dikosongkan (raw.meta.vars pasti kosong tanpa
                // fetch 90-hari) -- modal "Add Graph" selalu memanggil
                // ensureGraphCatalog() (fetch penuh) sendiri, jadi tidak
                // pernah numpang ke sini buat isi panel variabelnya.
                const catalog = { categories: [], deviceGroups, groups: raw.groups };
                // Jangan timpa katalog PENUH kalau ternyata sudah landing
                // duluan (mis. race dengan Operator yang kebetulan
                // langsung buka modal "Add Graph"/klik toggle 7D-30D-Custom
                // sebelum fetch lite ini selesai).
                if (!graphCatalogByProject[id]) {
                    graphCatalogByProject[id] = catalog;
                    if (id === opdActiveProjectId) {
                        graphCatalog = catalog;
                        graphCatalogProjectId = id;
                    }
                }
                return catalog;
            })
            .catch((e) => {
                console.warn(`[operator-dashboard] Gagal membangun katalog lite (24H) (project ${id}):`, e.message);
                delete hourlyCatalogPromiseByProject[id];
                throw e;
            })
            .finally(() => { hourlyCatalogSettledByProject[id] = true; });
        hourlyCatalogPromiseByProject[id] = promise;
        return promise;
    }
    function isHourlyCatalogSettled(projectId) {
        return !!hourlyCatalogSettledByProject[projectId || opdActiveProjectId] || isGraphCatalogSettled(projectId);
    }

    // FIX: mode "Custom Range" kartu "Add Graph" dulu selalu plot bucket
    // 2-jam-an TETAP yang diturunkan dari fetch 90-hari (lihat FIX note
    // di buildGraphCatalogFromUnits) -- sekarang menarik histori RAW
    // khusus untuk rentang tanggal PERSIS yang dipilih user, resolusinya
    // (2 jam utk rentang ~1 bulan, dst) ditentukan backend secara
    // adaptif dari lama rentangnya -- sama seperti mode 7D/30D, BUKAN
    // di-hardcode di frontend. Cuma nyimpen SATU rentang custom
    // ter-cache per proyek (u.historyCustom ditimpa tiap kali user
    // ganti tanggal) -- cukup karena cuma rentang yang lagi aktif
    // dilihat yang pernah dibutuhkan render sekaligus. Ported 1:1 dari
    // Project Detail's pdEnsureGraphCustomData (js/project-detail.js).
    const graphCustomRangeByProject = {}; // { [projectId]: { rangeKey, loaded, promise } }
    function isGraphCustomLoaded(projectId, dateFrom, dateTo) {
        const state = graphCustomRangeByProject[projectId];
        return !!(state && state.loaded && state.rangeKey === dateFrom + "|" + dateTo);
    }

    // Interval dasar yang DIPAKSAKAN untuk mode "Custom Range" -- 2 jam,
    // SAMA seperti mode "30 Days" (bukan diserahkan ke adaptive tiering
    // backend berdasar lama rentang, yang buat rentang >30 hari akan
    // jatuh ke interval 1 hari/2 hari, jauh lebih kasar dari 7D/30D).
    const GRAPH_CUSTOM_BASE_INTERVAL_MS = GRAPH_TWO_HOUR_INTERVAL_MS; // 2 jam -- sama konstanta dgn fetch 30 Days di atas
    // SAMA PERSIS dengan MAX_SAFE_INTERVALS di calculateAdaptiveAggregation()
    // (thingsboard.service.ts) -- wajib disamakan di sini karena
    // `interval` eksplisit lewat query param BYPASS pengaman itu
    // sepenuhnya. Tanpa disalin ulang di sini, rentang custom yang
    // sangat panjang (mis. 6 bulan/1 tahun) pada interval 2 jam akan
    // menghasilkan ribuan titik -> ThingsBoard menolak query dengan 400
    // "Incorrect TsKvQuery. Number of intervals is to high".
    const GRAPH_CUSTOM_MAX_SAFE_INTERVALS = 500;
    function computeCustomIntervalMs(durationMs) {
        let interval = GRAPH_CUSTOM_BASE_INTERVAL_MS;
        while (durationMs / interval > GRAPH_CUSTOM_MAX_SAFE_INTERVALS) interval *= 2;
        return interval;
    }

    async function ensureGraphCustomData(projectId, dateFrom, dateTo) {
        const id = projectId;
        if (!id || !dateFrom || !dateTo) return false;
        const rangeKey = dateFrom + "|" + dateTo;
        const state = (graphCustomRangeByProject[id] = graphCustomRangeByProject[id] || {});
        if (state.rangeKey === rangeKey && state.loaded) return true;
        if (state.rangeKey === rangeKey && state.promise) return state.promise;

        state.rangeKey = rangeKey;
        state.loaded = false;
        state.promise = (async () => {
            try {
                // Katalog dasar (daftar unit/deviceId) harus sudah ada
                // dulu -- aman/murah dipanggil ulang, ensureGraphCatalog()
                // sudah memoize sendiri.
                await ensureGraphCatalog();
                const units = graphUnitsCacheByProject[id] || [];
                if (!units.length) return false;

                // Rentang dihitung dari tanggal LOKAL yang dipilih user
                // (00:00 tanggal "from" s/d akhir tanggal "to"), endTs
                // dibulatkan ke kelipatan 1 menit & tidak pernah
                // melewati "sekarang".
                const startTs = new Date(dateFrom + "T00:00:00").getTime();
                const endTsRaw = new Date(dateTo + "T23:59:59").getTime();
                const endTs = Math.min(Math.floor(Date.now() / 60000) * 60000, endTsRaw);
                if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || startTs >= endTs) return false;

                const intervalMs = computeCustomIntervalMs(endTs - startTs);
                // Concurrency 3 (bukan 2 kayak fetch dasar) -- fetch ini
                // SUDAH di-debounce (lihat customDateDebounceTimers di
                // setCardCustomDate) & murni on-demand (baru jalan pas
                // Operator beneran pilih tanggal), jadi beda dari fetch
                // dasar/awal yang memang perlu dijaga pelan-pelan biar
                // tidak numpuk beban ke banyak unit sekaligus saat page
                // baru dibuka.
                const results = await runBatched(units.map((u) => () => graphFetchDeviceHistoryRange(u.deviceId, startTs, endTs, intervalMs)), 3);
                units.forEach((u, i) => { u.historyCustom = results[i]; });

                // Timpa cuma `.groups` katalog yang sudah ada (bukan
                // rebuild categories/warna/id-nya) supaya id/warna
                // variabel yang sudah kepilih di modal tidak berubah
                // begitu histori custom-nya selesai ditarik.
                const rebuilt = buildGraphCatalogFromUnits(units);
                const catalog = graphCatalogByProject[id];
                if (catalog) catalog.groups = rebuilt.groups;

                if (state.rangeKey === rangeKey) state.loaded = true;
                return true;
            } catch (e) {
                console.warn(`[operator-dashboard] Gagal lazy-load histori custom (${dateFrom}..${dateTo}) katalog Add Graph (project ${id}):`, e.message);
                return false;
            } finally {
                if (state.rangeKey === rangeKey) delete state.promise;
            }
        })();
        return state.promise;
    }


    function renderGraphDeviceToggle() {
        graphDeviceToggle.innerHTML = "";
        graphCatalog.deviceGroups.forEach((g) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "opd-graph-seg-btn" + (g.id === gCurrentGroupId ? " is-active" : "");
            // Tampilkan system_name APA ADANYA dari Core API (GET
            // /projects/:id -> systems[].system_name), tanpa dipotong/
            // diganti lagi -- sama seperti Project Detail (lihat
            // renderPdGraphDeviceToggle di js/project-detail.js).
            btn.textContent = g.name;
            btn.addEventListener("click", () => {
                gCurrentGroupId = g.id;
                renderGraphDeviceToggle();
                // Checked state is tracked PER GROUP (see toggleGraphVar
                // below), so switching "Device:" needs to repaint the
                // left checklist to whatever THIS group has checked --
                // instead of leaving the previous group's checkmarks on
                // screen, which is what made it impossible to tell two
                // groups' selections apart.
                syncGraphVarPanelChecks();
                updateGraphPreview();
            });
            graphDeviceToggle.appendChild(btn);
        });
    }

    // Re-syncs the left checklist's checkbox/highlight state to whichever
    // device group is now active. A variable's checked state lives per
    // (groupId, variable id) pair in gSelected, not just per variable id
    // -- so the same variable can be checked under Grup 1 and unchecked
    // under Grup 2 at the same time, letting the two groups' data be
    // freely mixed into one comparison chart. Ported 1:1 from Project
    // Detail's syncPdGraphVarPanelChecks.
    function syncGraphVarPanelChecks() {
        graphVarPanel.querySelectorAll(".opd-graph-var-row").forEach((row) => {
            const id = row.dataset.id;
            const isSel = gSelected.some((s) => s.groupId === gCurrentGroupId && s.id === id);
            row.classList.toggle("is-checked", isSel);
            const cb = row.querySelector("input[type=checkbox]");
            if (cb) cb.checked = isSel;
        });
    }

    // ---------- left panel (built once, reused across opens) ----------
    function renderGraphVarPanel() {
        graphVarPanel.innerHTML = "";
        graphCatalog.categories.forEach((cat) => {
            const wrap = document.createElement("div");
            wrap.className = "opd-graph-var-category";

            const title = document.createElement("p");
            title.className = "opd-graph-cat-title";
            title.textContent = cat.name;
            wrap.appendChild(title);

            cat.vars.forEach((v) => {
                const row = document.createElement("label");
                row.className = "opd-graph-var-row";
                row.dataset.id = v.id;

                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.addEventListener("change", () => toggleGraphVar(v, cb.checked, row));

                const dot = document.createElement("span");
                dot.className = "opd-graph-var-dot";
                dot.style.background = v.color;

                const label = document.createElement("span");
                label.className = "opd-graph-var-label";
                label.textContent = v.label;

                const unit = document.createElement("span");
                unit.className = "opd-graph-var-unit";
                unit.textContent = v.unit;

                row.appendChild(cb);
                row.appendChild(dot);
                row.appendChild(label);
                row.appendChild(unit);
                wrap.appendChild(row);
            });

            graphVarPanel.appendChild(wrap);
        });
    }

    // ---------- selection handling ----------
    // Tags each pushed selection with the device group it was checked
    // under (gCurrentGroupId), NOT just the variable's own id -- so the
    // same variable can be selected independently per group and Grup 1's
    // reading can be plotted right alongside Grup 2's in one comparison
    // chart. Ported 1:1 from Project Detail's toggleVar (see
    // renderPdGraphVarPanel, js/project-detail.js).
    function toggleGraphVar(v, isChecked, rowEl) {
        if (isChecked) {
            if (!gSelected.some((s) => s.groupId === gCurrentGroupId && s.id === v.id)) {
                gSelected.push(Object.assign({}, v, { groupId: gCurrentGroupId }));
            }
            rowEl.classList.add("is-checked");
        } else {
            gSelected = gSelected.filter((s) => !(s.groupId === gCurrentGroupId && s.id === v.id));
            rowEl.classList.remove("is-checked");
        }
        updateGraphTitle();
        updateGraphPreview();
        graphAddBtn.disabled = gSelected.filter((v2) => v2.unit).length === 0;
    }

    // Pure computation of the auto-generated title for a given selection
    // + chart type — shared by updateGraphTitle() (below) and
    // loadCardIntoGraphModal() (so editing a card can tell whether its
    // saved title was ever hand-typed or is still just the auto-name).
    function computeGraphAutoTitle(selectedVars, chartTypeVal) {
        if (!selectedVars.length) return "";
        const stackDef = chartTypeVal === "stack" ? findStackDef(selectedVars.filter((v) => v.unit)) : null;
        if (stackDef) return stackDef.label;
        const names = selectedVars.map((s) => s.label);
        return names.length <= 2
            ? names.join(" vs ")
            : names.slice(0, 2).join(" vs ") + ` +${names.length - 2} more`;
    }

    function updateGraphTitle() {
        if (gTitleTouched) return;
        if (gSelected.length === 0) {
            graphTitleInput.value = "";
            graphTitleInput.placeholder = "Select a variable on the left…";
            return;
        }
        graphTitleInput.value = computeGraphAutoTitle(gSelected, gChartType);
    }

    // ---------- chart-type toggle ----------
    graphTypeToggle.querySelectorAll(".opd-graph-seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.disabled) return;
            graphTypeToggle.querySelectorAll(".opd-graph-seg-btn").forEach((b) => b.classList.remove("is-active"));
            btn.classList.add("is-active");
            gChartType = btn.dataset.type;
            updateGraphPreview();
        });
    });

    function makeAreaGradient(ctx, chartArea, hexColor, topAlpha) {
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, hexToRgba(hexColor, topAlpha));
        gradient.addColorStop(1, hexToRgba(hexColor, 0));
        return gradient;
    }

    function graphGroupData(groupId) {
        const gid = groupId || gCurrentGroupId;
        return graphCatalog.groups[gid] && graphCatalog.groups[gid].data;
    }
    // Reads a variable's real daily series from an explicit groupId when
    // given, otherwise the variable's OWN groupId (tagged when it was
    // checked -- see toggleGraphVar below), and only falls back to
    // whichever group is currently displayed in the "Device:" toggle.
    // This is what lets a preview/saved chart mix variables checked
    // under different device groups instead of always following
    // gCurrentGroupId -- ported 1:1 from Project Detail's
    // pdGraphRealSeries (js/project-detail.js).
    function graphRealSeries(v, groupId) {
        const gid = groupId || (v && v.groupId) || gCurrentGroupId;
        const data = graphGroupData(gid);
        return (data && data[v.key]) || [];
    }
    // Generic accessor for the "raw" period buckets built in
    // buildGraphCatalogFromUnits() -- periodKey is "hourly" (mode "24
    // Hours"), "weekly" ("7 Days", 15-min points), "monthly" ("30 Days",
    // 1-hour points) or "custom" (exact user-picked date range, see
    // ensureGraphCustomData below). Returns null (not synthetic data)
    // when the catalog/variable isn't there yet, so callers can decide
    // their own fallback. Ported 1:1 from Project Detail's
    // pdGraphRealPeriodSeries (js/project-detail.js).
    function graphRealPeriodSeries(v, groupId, periodKey) {
        const gid = groupId || (v && v.groupId) || gCurrentGroupId;
        const group = graphCatalog && graphCatalog.groups[gid];
        const period = group && group[periodKey];
        if (period && Array.isArray(period[v.key])) {
            return { labels: period.labels || [], values: period[v.key] };
        }
        return null;
    }
    function graphRealHourlySeries(v, groupId) {
        return graphRealPeriodSeries(v, groupId, "hourly");
    }
    // "7 Days" (titik 15 menit dari history7d) & "30 Days" (titik 1 jam
    // dari history30d) -- sama pola dengan graphRealHourlySeries di atas.
    function graphRealWeeklySeries(v, groupId) {
        return graphRealPeriodSeries(v, groupId, "weekly");
    }
    function graphRealMonthlySeries(v, groupId) {
        return graphRealPeriodSeries(v, groupId, "monthly");
    }
    // Mode "Custom" -- titik RAW dari rentang tanggal PERSIS yang
    // dipilih user (lihat ensureGraphCustomData), bukan lagi bucket
    // 2-jam-an tetap yang diturunkan dari fetch 90-hari.
    function graphRealCustomSeries(v, groupId) {
        return graphRealPeriodSeries(v, groupId, "custom");
    }

    // ---------- shared: assign each variable to a y-axis ----------
    // Groups vars by unit AND rough magnitude — two vars can share a unit
    // (e.g. both "kWh") but differ by 100x (Daily Production: tens vs.
    // Cumulative Consumption: thousands), so the smaller one needs its
    // own axis or it gets squashed flat against the x-axis. Keyed by
    // v.key (not v.id) so this works both for the modal's live preview
    // (catalog vars, which have an id) and for saved dashboard-card
    // charts (card.vars, which only keep key/label/unit/color) — the
    // same grouping logic drives both so a card looks the same on the
    // dashboard as it did in the "Add graph" preview.
    function computeAxisGroups(vars, seriesFor) {
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

    // ---------- stat chips (Now / Min / Max / Avg) ----------
    function renderGraphStats(plottable, multiGroup) {
        graphStatsRow.innerHTML = "";
        // Same auto-contrast palette as the preview chart's
        // datasets/legend (both call assignContrastColors with the same
        // count, so "line #i" always matches "stat chip #i") -- not the
        // vars' stored .color.
        const statColors = assignContrastColors(plottable.length);
        plottable.forEach((v, i) => {
            const color = statColors[i];
            const raw = graphRealSeries(v).filter((n) => n !== null && n !== undefined && !Number.isNaN(n));
            if (!raw.length) return;
            const min = Math.min(...raw);
            const max = Math.max(...raw);
            const avg = raw.reduce((a, b) => a + b, 0) / raw.length;
            const now = raw[raw.length - 1];
            const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

            const chip = document.createElement("div");
            chip.className = "opd-graph-stat-chip";
            chip.style.borderColor = hexToRgba(color, 0.35);

            const dot = document.createElement("span");
            dot.className = "opd-graph-stat-dot";
            dot.style.background = color;
            chip.appendChild(dot);

            const label = document.createElement("span");
            label.className = "opd-graph-stat-label";
            label.textContent = v.label + (multiGroup ? " — " + graphGroupName(v.groupId) : "");
            chip.appendChild(label);

            const nowEl = document.createElement("span");
            nowEl.className = "opd-graph-stat-now";
            nowEl.style.background = hexToRgba(color, 0.16);
            nowEl.style.color = color;
            nowEl.textContent = `${fmt(now)} ${v.unit} Now`;
            chip.appendChild(nowEl);

            const minmax = document.createElement("span");
            minmax.className = "opd-graph-stat-minmax";
            minmax.textContent = `Min ${fmt(min)} · Max ${fmt(max)} · Avg ${fmt(avg)}`;
            chip.appendChild(minmax);

            graphStatsRow.appendChild(chip);
        });
    }

    // Enable/disable/hide "Compare" based on the current selection —
    // same behavior as Project Detail's updatePdGraphCompareAvailability.
    // Hidden entirely (not just greyed out) via .is-hidden when the
    // checked vars don't match a GRAPH_COMPARE_PAIRS entry, so "Line"/
    // "Bar" aren't crowded by an irrelevant-looking button. Falls back
    // to "Line" automatically if Compare was active but its pair is no
    // longer selected.
    function updateGraphCompareAvailability(plottable) {
        const compareBtn = document.getElementById("opdGraphCompareBtn");
        if (!compareBtn) return null;
        const comparePair = findComparePair(plottable);
        compareBtn.classList.toggle("is-hidden", !comparePair);
        compareBtn.disabled = !comparePair;
        compareBtn.title = comparePair
            ? "Bandingkan " + comparePair.pair.label.toLowerCase()
            : "Hanya tersedia untuk pasangan variabel tertentu, mis. Produksi vs Konsumsi Energi";
        if (!comparePair && gChartType === "compare") {
            gChartType = "line";
            graphTypeToggle.querySelectorAll(".opd-graph-seg-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.type === "line"));
        }
        return comparePair;
    }

    // Same as updateGraphCompareAvailability() above, for "Stack" — only
    // enabled when exactly 1 variable is checked and it's one of the
    // GRAPH_STACK_CONFIGS trigger keys (Daily Consumption or Daily
    // Production).
    function updateGraphStackAvailability(plottable) {
        const stackBtn = document.getElementById("opdGraphStackBtn");
        if (!stackBtn) return null;
        const stackDef = findStackDef(plottable);
        stackBtn.classList.toggle("is-hidden", !stackDef);
        stackBtn.disabled = !stackDef;
        stackBtn.title = stackDef
            ? "Split into " + stackDef.segments.map((s) => s.label).join(" / ")
            : "Only available for Daily Consumption or Daily Production, split into their derived components";
        if (!stackDef && gChartType === "stack") {
            gChartType = "line";
            graphTypeToggle.querySelectorAll(".opd-graph-seg-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.type === "line"));
        }
        return stackDef;
    }

    // ---------- build / update the live preview ----------
    function updateGraphPreview() {
        // "Graph type" label kelihatan beda posisi/gaya dari "Graph title"
        // karena container-nya cuma punya class "opd-graph-field-chart-type",
        // TANPA base class "opd-graph-field" (lihat markup di
        // pages/operator/operator-dashboard.html) -- akibatnya rule CSS
        // `.opd-graph-field { flex-direction:column; gap:6px }` dan
        // `.opd-graph-field label` (font-size/weight/color yang dipakai
        // Graph title) gak kena ke elemen ini. Sama persis dengan fix yang
        // sudah ada di updatePdGraphPreview() (js/project-detail.js) --
        // tambahin base class-nya di sini juga supaya keduanya konsisten.
        if (graphTypeField) graphTypeField.classList.add("opd-graph-field");

        const plottable = gSelected.filter((v) => v.unit);
        const nonPlottable = gSelected.filter((v) => !v.unit);

        // Update Compare/Stack availability up front (before the empty-
        // state early-returns below) so those buttons always reflect the
        // CURRENT selection, even while the preview itself can't be
        // drawn yet.
        const comparePair = updateGraphCompareAvailability(plottable);
        const stackDef = updateGraphStackAvailability(plottable);

        if (gSelected.length === 0) {
            graphEmptyState.style.display = "block";
            graphEmptyState.querySelector("strong").textContent = "No variable selected yet";
            graphEmptyState.querySelector(".opd-graph-empty-sub").textContent =
                "Check one or more variables on the left to preview the graph here. The data used is actual data from the PLTS TAWABI logger (daily average).";
            graphLegend.innerHTML = "";
            graphCaption.textContent = "";
            graphStatsRow.innerHTML = "";
            graphTypeField.style.display = "none";
            if (gPreviewChart) { gPreviewChart.destroy(); gPreviewChart = null; }
            graphCanvas.style.display = "none";
            graphPreviewBox.style.display = "flex";
            syncVarPanelHeight();
            return;
        }

        if (!plottable.length) {
            graphEmptyState.style.display = "block";
            graphEmptyState.querySelector("strong").textContent = "This variable isn't numeric";
            graphEmptyState.querySelector(".opd-graph-empty-sub").textContent =
                "Fields like " + nonPlottable.map((v) => v.label).join(", ") +
                " are status/text fields, so they can't be drawn as a line/bar graph.";
            graphLegend.innerHTML = "";
            graphCaption.textContent = "";
            graphStatsRow.innerHTML = "";
            graphTypeField.style.display = "none";
            if (gPreviewChart) { gPreviewChart.destroy(); gPreviewChart = null; }
            graphCanvas.style.display = "none";
            graphPreviewBox.style.display = "flex";
            syncVarPanelHeight();
            return;
        }

        graphEmptyState.style.display = "none";
        graphPreviewBox.style.display = "flex";
        graphTypeField.style.display = "flex";
        graphCanvas.style.display = "block";

        // Labels come from whichever group happens to be displayed --
        // every group in this catalog shares the same date range (see
        // buildGraphCatalogFromUnits), so this stays correct even when
        // the selection below mixes variables from other groups too.
        const labels = graphGroupData().labels;
        const N = labels.length;
        const activeGroup = graphCatalog.deviceGroups.find((g) => g.id === gCurrentGroupId);
        const isMultiGroup = selectionSpansMultipleGroups(plottable);

        // ---- "Stack" (derived breakdown of Daily Consumption/Production
        // into PV/Battery/PLN segments — see GRAPH_STACK_CONFIGS) ----
        if (gChartType === "stack" && stackDef) {
            const segments = computeStackSegments((sourceDef) => graphRealSeries(sourceDef, stackDef.groupId), stackDef.segments);
            const datasets = buildStackAreaDatasets(segments, N, stackDef.segments);

            if (gPreviewChart) gPreviewChart.destroy();
            gPreviewChart = new Chart(graphCanvas.getContext("2d"), {
                type: "line",
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: "#25343F", padding: 8, cornerRadius: 8, callbacks: stackTooltipCallbacks() },
                    },
                    scales: {
                        x: { ticks: { font: { size: 10.5, family: "Poppins" }, color: "#7C8B8D", maxTicksLimit: 8, autoSkip: true, padding: 4 }, grid: { display: false }, border: { display: false } },
                        y: {
                            title: { display: true, text: "kWh", font: { size: 10.5, family: "Poppins", weight: "500" }, color: "#7C8B8D" },
                            grid: { color: "#EEF3F3" },
                            border: { display: false },
                            ticks: { font: { size: 10.5, family: "Poppins" } },
                            beginAtZero: true,
                        },
                    },
                },
            });

            graphLegend.innerHTML = stackDef.segments.map((seg) => `
                <div class="opd-graph-legend-item"><span class="opd-graph-legend-ring" style="border-color:${seg.color}"></span><span>${esc(seg.label)}</span></div>
            `).join("");

            graphStatsRow.innerHTML = "";
            const fmtStack = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
            stackDef.segments.forEach((seg) => {
                const raw = segments[seg.id].filter((n) => typeof n === "number" && isFinite(n));
                if (!raw.length) return;
                const now = raw[raw.length - 1];
                const avg = raw.reduce((a, b) => a + b, 0) / raw.length;
                const chip = document.createElement("div");
                chip.className = "opd-graph-stat-chip";
                chip.style.borderColor = hexToRgba(seg.color, 0.35);
                chip.innerHTML = `
                    <span class="opd-graph-stat-dot" style="background:${seg.color}"></span>
                    <span class="opd-graph-stat-label">${esc(seg.label)}</span>
                    <span class="opd-graph-stat-now" style="background:${hexToRgba(seg.color, 0.16)};color:${seg.color}">${fmtStack(now)} kWh Now</span>
                    <span class="opd-graph-stat-minmax">Avg ${fmtStack(avg)} kWh/day</span>
                `;
                graphStatsRow.appendChild(chip);
            });

            graphCaption.textContent =
                `${labels.length ? labels[0] : ""} — ${labels.length ? labels[labels.length - 1] : ""} (${labels.length} data, daily) — estimated PV/Battery/PLN split, not an official billing figure` +
                (stackDef.groupId ? ` from ${graphGroupName(stackDef.groupId)}` : (activeGroup ? ` from ${activeGroup.name}` : ""));
            syncVarPanelHeight();
            return;
        }

        // ---- "Compare" (mirrored top/bottom bar — top drawn as-is,
        // bottom negated so it drops below the 0 axis — see
        // GRAPH_COMPARE_PAIRS/findComparePair()) ----
        if (gChartType === "compare" && comparePair) {
            const topVar = comparePair.topVar;
            const bottomVar = comparePair.bottomVar;
            const topValues = graphRealSeries(topVar);
            const bottomValues = graphRealSeries(bottomVar).map((n) => (typeof n === "number" && isFinite(n) ? -n : n));

            const datasets = [
                { label: topVar.label + (topVar.unit ? " (" + topVar.unit + ")" : ""), data: topValues, backgroundColor: hexToRgba(topVar.color, 0.55), borderColor: topVar.color, borderWidth: 1.5, borderRadius: 4, borderSkipped: false, barPercentage: 1, categoryPercentage: 1, grouped: false },
                { label: bottomVar.label + (bottomVar.unit ? " (" + bottomVar.unit + ")" : ""), data: bottomValues, backgroundColor: hexToRgba(bottomVar.color, 0.55), borderColor: bottomVar.color, borderWidth: 1.5, borderRadius: 4, borderSkipped: false, barPercentage: 1, categoryPercentage: 1, grouped: false },
            ];

            if (gPreviewChart) gPreviewChart.destroy();
            gPreviewChart = new Chart(graphCanvas.getContext("2d"), {
                type: "bar",
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: "#25343F", padding: 8, cornerRadius: 8, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${Math.abs(ctx.parsed.y).toLocaleString("en-US", { maximumFractionDigits: 2 })}` } },
                    },
                    scales: {
                        x: { ticks: { font: { size: 10.5, family: "Poppins" }, color: "#7C8B8D", maxTicksLimit: 8, autoSkip: true, padding: 4 }, grid: { display: false }, border: { display: false } },
                        y: {
                            title: { display: true, text: topVar.unit || "", font: { size: 10.5, family: "Poppins", weight: "500" }, color: "#7C8B8D" },
                            grid: { color: (ctx) => (ctx.tick.value === 0 ? "#C9D6D7" : "#EEF3F3"), lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 1) },
                            border: { display: false },
                            ticks: { font: { size: 10.5, family: "Poppins" }, callback: (v) => Math.abs(v) },
                        },
                    },
                },
            });

            renderGraphStats(plottable, false);
            graphLegend.innerHTML = plottable.map((v) => `
                <div class="opd-graph-legend-item"><span class="opd-graph-legend-ring" style="border-color:${v.color}"></span><span>${esc(v.label)}</span></div>
            `).join("");
            // "Compare" is always single-group (findComparePair bails
            // otherwise) -- use the pair's OWN groupId rather than
            // whichever group is currently toggled, since the Operator
            // may have switched "Device:" after checking these vars.
            const compareGroupName = graphGroupName(topVar.groupId) || (activeGroup ? activeGroup.name : "");
            graphCaption.textContent =
                `${N} actual data points (daily average, ${labels[0]} to ${labels[N - 1]}) from ${compareGroupName}` +
                (nonPlottable.length ? ` — ${nonPlottable.length} non-numeric variable(s) excluded from the graph.` : ".") +
                " Data is sourced directly from the data logger, not sample data.";
            syncVarPanelHeight();
            return;
        }

        // ---- Line / Bar (existing behavior) ----
        // Group plottable vars by unit AND rough magnitude — two vars
        // can share a unit but differ by 100x, so put those on
        // separate axes or the smaller one gets squashed flat.
        const { axisGroups, varKeyToAxis } = computeAxisGroups(plottable, graphRealSeries);

        const scales = {};
        axisGroups.forEach((g, i) => {
            scales[g.key] = {
                type: "linear",
                position: i === 0 ? "left" : "right",
                title: { display: true, text: g.unit, font: { size: 10.5, family: "Poppins", weight: "500" }, color: "#7C8B8D" },
                grid: { drawOnChartArea: i === 0, color: "#EEF3F3", drawTicks: false },
                border: { display: false, dash: [3, 3] },
                ticks: { font: { size: 10.5, family: "Poppins" }, color: "#7C8B8D", padding: 6 },
                offset: true,
            };
        });

        const fillTopAlpha = plottable.length === 1 ? 0.30 : plottable.length === 2 ? 0.20 : 0.12;

        // When the selection mixes groups (e.g. Grup 1's Battery Voltage
        // + Grup 2's Battery Voltage in one comparison chart), append the
        // group name to each dataset's label so the legend/tooltip can
        // still tell them apart -- with a single group it stays exactly
        // as before ("Battery Voltage (V)").
        // Auto-contrast colors, NOT the vars' stored .color -- see
        // assignContrastColors() above. Keeps the preview matching what
        // the saved card will actually render, including cases like the
        // same catalog variable picked from two different device groups.
        const previewContrastColors = assignContrastColors(plottable.length);
        const datasets = plottable.map((v, i) => {
            const color = previewContrastColors[i];
            return {
                label: v.label + (v.unit ? " (" + v.unit + ")" : "") + (isMultiGroup ? " — " + graphGroupName(v.groupId) : ""),
                data: graphRealSeries(v),
                spanGaps: true,
                borderColor: color,
                backgroundColor: gChartType === "bar"
                    ? color + "cc"
                    : (ctx) => {
                        const { chart } = ctx;
                        const { ctx: canvasCtx, chartArea } = chart;
                        if (!chartArea) return hexToRgba(color, fillTopAlpha);
                        return makeAreaGradient(canvasCtx, chartArea, color, fillTopAlpha);
                    },
                fill: gChartType === "line" ? "origin" : false,
                pointRadius: gChartType === "line" ? (labels.length > 45 ? 0 : 2.5) : 0,
                pointHoverRadius: gChartType === "line" ? 5 : 0,
                pointBackgroundColor: color,
                pointBorderColor: "#fff",
                pointBorderWidth: gChartType === "line" ? 1.5 : 0,
                pointHoverBorderWidth: 2,
                pointHitRadius: 10,
                borderWidth: 2.5,
                borderDash: (gChartType === "line" && plottable.length === 2 && i === 1) ? [6, 4] : [],
                borderCapStyle: "round",
                borderJoinStyle: "round",
                borderRadius: gChartType === "bar" ? 6 : 0,
                maxBarThickness: 34,
                tension: 0.38,
                cubicInterpolationMode: "monotone",
                yAxisID: varKeyToAxis[v.key],
            };
        });

        const config = {
            type: gChartType,
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                animation: { duration: 500, easing: "easeOutQuart" },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true,
                        backgroundColor: "#25343F",
                        titleColor: "#fff",
                        titleFont: { size: 12, family: "Poppins", weight: "600" },
                        bodyColor: "#E4F1F1",
                        bodyFont: { size: 11.5, family: "Poppins" },
                        padding: 10,
                        cornerRadius: 8,
                        displayColors: true,
                        boxWidth: 8,
                        boxHeight: 8,
                        boxPadding: 4,
                        usePointStyle: true,
                    },
                },
                scales: {
                    x: {
                        ticks: {
                            font: { size: 10.5, family: "Poppins" },
                            color: "#7C8B8D",
                            maxTicksLimit: 8,
                            autoSkip: true,
                            padding: 4,
                        },
                        grid: { display: false },
                        border: { display: false },
                    },
                    ...scales,
                },
            },
        };

        if (gPreviewChart) gPreviewChart.destroy();
        gPreviewChart = new Chart(graphCanvas.getContext("2d"), config);
        renderGraphStats(plottable, isMultiGroup);

        graphLegend.innerHTML = "";
        // Same auto-contrast palette as the datasets above (same count
        // in, same colors out) so the legend ring always matches its
        // line.
        const legendContrastColors = assignContrastColors(plottable.length);
        plottable.forEach((v, i) => {
            const item = document.createElement("div");
            item.className = "opd-graph-legend-item";
            const ring = document.createElement("span");
            ring.className = "opd-graph-legend-ring";
            ring.style.borderColor = legendContrastColors[i];
            item.appendChild(ring);
            const text = document.createElement("span");
            text.textContent = v.label + (isMultiGroup ? " — " + graphGroupName(v.groupId) : "");
            item.appendChild(text);
            graphLegend.appendChild(item);
        });

        // Multi-group selections pull data from more than one device --
        // list every DISTINCT group actually involved instead of just
        // whichever one happens to be toggled in "Device:" right now.
        const fromLabel = isMultiGroup
            ? Array.from(new Set(plottable.map((v) => graphGroupName(v.groupId)))).join(", ")
            : (activeGroup ? activeGroup.name : "");

        graphCaption.textContent =
            `${N} actual data points (daily average, ${labels[0]} to ${labels[N - 1]}) from ${fromLabel}` +
            (nonPlottable.length ? ` — ${nonPlottable.length} non-numeric variable(s) excluded from the graph.` : ".") +
            " Data is sourced directly from the data logger, not sample data.";

        syncVarPanelHeight();
    }

    // ---------- keep the left variable list flush with the right side ----------
    // Right column's height (title → type toggle → stats chips → chart →
    // legend → caption) changes as variables get checked/unchecked, so the
    // left checklist's height is set to match it exactly, right down to the
    // caption line, instead of using a fixed px value. offsetHeight (not
    // getBoundingClientRect) is used because it isn't thrown off by the
    // modal's open/close scale-transform transition. Below the 760px
    // breakpoint the two columns stack into one, so the inline height is
    // cleared there and the stylesheet's own 220px mobile cap takes over.
    function syncVarPanelHeight() {
        if (window.innerWidth <= 760) {
            graphVarPanel.style.maxHeight = "";
            return;
        }
        const h = graphChartPanel.offsetHeight;
        if (h > 0) graphVarPanel.style.maxHeight = h + "px";
    }
    if (window.ResizeObserver) {
        new ResizeObserver(syncVarPanelHeight).observe(graphChartPanel);
    }
    window.addEventListener("resize", () => {
        if (graphModal.classList.contains("is-open")) syncVarPanelHeight();
    });

    // ---------- open / close ----------
    function resetGraphModalState() {
        gSelected = [];
        gChartType = "line";
        gTitleTouched = false;
        graphTitleInput.value = "";
        graphVarPanel.querySelectorAll(".opd-graph-var-row").forEach((row) => {
            row.classList.remove("is-checked");
            const cb = row.querySelector("input[type=checkbox]");
            if (cb) cb.checked = false;
        });
        graphTypeToggle.querySelectorAll(".opd-graph-seg-btn").forEach((b, i) => b.classList.toggle("is-active", i === 0));
        graphAddBtn.disabled = true;
    }

    // Toggle antara skeleton / konten asli / pesan error di dalam modal
    // "Create graph" — sama seperti setPdGraphModalPhase() di
    // js/project-detail.js. Dipanggil oleh openGraphModal() supaya
    // modal bisa langsung dibuka (tanpa nunggu fetch selesai) dan
    // Operator langsung tahu sesuatu sedang dimuat.
    function setGraphModalPhase(phase) {
        if (graphLoading) { graphLoading.classList.toggle("is-visible", phase === "loading"); graphLoading.setAttribute("aria-hidden", phase === "loading" ? "false" : "true"); }
        if (graphError) { graphError.classList.toggle("is-visible", phase === "error"); graphError.setAttribute("aria-hidden", phase === "error" ? "false" : "true"); }
        if (graphBody) graphBody.style.display = phase === "ready" ? "" : "none";
        if (graphDeviceSwitch) graphDeviceSwitch.style.display = phase === "ready" ? "" : "none";
        if (graphSubtitle) graphSubtitle.style.display = phase === "loading" || phase === "error" ? "none" : "";
        if (graphAddBtn) graphAddBtn.disabled = phase !== "ready" || !gSelected.filter((v) => v.unit).length;
    }

    // Modal chrome (title/button label) toggles between "Add graph"
    // mode and "Edit graph" mode depending on gEditingCardId — called
    // from openGraphModal() every time it (re)opens.
    function updateGraphModalChrome() {
        const titleEl = document.getElementById("opdGraphModalTitle");
        if (titleEl) titleEl.textContent = gEditingCardId ? "Edit graph" : "Create graph";
        if (graphAddBtn) graphAddBtn.textContent = gEditingCardId ? "Save changes" : "Add graph";
    }

    // Pre-fills the modal's selection/title/chart-type from an existing
    // chart card instead of the blank "Add graph" defaults — used when
    // the Operator clicks a card's title to edit it (see cardTitleClick
    // / the data-edit-card wiring in renderGrid). Matches the card's
    // saved variables back to the freshly-built catalog by (key,
    // groupId) rather than by the catalog's own v.id, since that id is
    // regenerated every time the catalog is rebuilt and isn't stable
    // across sessions/cards.
    function loadCardIntoGraphModal(editCard) {
        const allCatalogVars = graphCatalog.categories.flatMap((c) => c.vars);
        const cardVars = (Array.isArray(editCard.vars) && editCard.vars.length) ? editCard.vars
            : (Array.isArray(editCard.variables) && editCard.variables.length) ? editCard.variables
            : [];
        const fallbackGroupId = editCard.deviceGroupId || (graphCatalog.deviceGroups[0] && graphCatalog.deviceGroups[0].id) || null;

        gSelected = cardVars.map((cv) => {
            const gid = cv.groupId || fallbackGroupId;
            const match = allCatalogVars.find((v) => v.key === cv.key);
            return match ? Object.assign({}, match, { groupId: gid }) : Object.assign({}, cv, { groupId: gid, id: cv.key, plottable: !!cv.unit });
        });
        gCurrentGroupId = (gSelected[0] && gSelected[0].groupId) || fallbackGroupId;
        gChartType = editCard.chartType || "line";

        // Only lock the title (gTitleTouched = true, same flag set when
        // the Operator hand-types into the field) if the saved title is
        // NOT just what auto-generation would have produced for this
        // exact selection — i.e. it was actually customized. Otherwise
        // leave it untouched so it keeps following the selection while
        // editing, same as when adding a brand-new graph (this is what
        // was missing before: every saved title got treated as
        // "touched", so ticking/unticking a variable during an edit
        // never updated the title on the card afterwards).
        const autoTitle = computeGraphAutoTitle(gSelected, gChartType);
        gTitleTouched = !!(editCard.title && editCard.title !== autoTitle);

        graphTitleInput.value = editCard.title || autoTitle;
        graphTypeToggle.querySelectorAll(".opd-graph-seg-btn").forEach((b) => {
            b.classList.toggle("is-active", b.dataset.type === gChartType);
        });
        syncGraphVarPanelChecks();
        graphAddBtn.disabled = gSelected.filter((v) => v.unit).length === 0;
    }

    function openGraphModal(tab, editCard) {
        gTargetTab = tab || activeTab;
        gEditingCardId = editCard ? editCard.id : null;
        updateGraphModalChrome();

        // Modal dibuka LANGSUNG saat "Add Graph" diklik, tanpa nunggu
        // fetch selesai -- popup nongol duluan dengan skeleton, baru
        // diisi konten aslinya begitu telemetry-nya datang (lihat
        // setGraphModalPhase() di atas).
        graphModal.classList.add("is-open");
        graphModal.setAttribute("aria-hidden", "false");

        // Project aktif berubah sejak modal ini terakhir dibangun --
        // reset panel/toggle/grup supaya modal membangun ulang dari
        // katalog project yang SEKARANG aktif, bukan menyisakan daftar
        // variabel/Grup 1/Grup 2 milik project sebelumnya.
        if (graphCatalogProjectId !== opdActiveProjectId) {
            graphCatalog = null;
            gCurrentGroupId = null;
            gPanelBuilt = false;
        }

        const wasCached = !!graphCatalogByProject[opdActiveProjectId];
        setGraphModalPhase(wasCached ? "ready" : "loading");

        ensureGraphCatalog().then(() => {
            if (!gCurrentGroupId) gCurrentGroupId = graphCatalog.deviceGroups[0].id;
            if (!gPanelBuilt) {
                renderGraphVarPanel();
                gPanelBuilt = true;
            }
            if (editCard) {
                loadCardIntoGraphModal(editCard);
            } else {
                resetGraphModalState();
            }
            renderGraphDeviceToggle();
            updateGraphPreview();
            setGraphModalPhase("ready");
        }).catch((e) => {
            if (graphErrorMsg) graphErrorMsg.textContent = (e && e.message) ? e.message : "Periksa koneksi Anda lalu coba lagi.";
            setGraphModalPhase("error");
        });
    }

    if (graphRetryBtn) {
        graphRetryBtn.addEventListener("click", () => openGraphModal(gTargetTab));
    }

    function closeGraphModal() {
        graphModal.classList.remove("is-open");
        graphModal.setAttribute("aria-hidden", "true");
        gEditingCardId = null;
        updateGraphModalChrome();
    }

    graphCloseBtn.addEventListener("click", closeGraphModal);
    graphCancelBtn.addEventListener("click", closeGraphModal);
    graphModal.addEventListener("click", (e) => {
        if (e.target === graphModal) closeGraphModal();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && graphModal.classList.contains("is-open")) closeGraphModal();
    });
    graphTitleInput.addEventListener("input", () => { gTitleTouched = true; });

    graphAddBtn.addEventListener("click", () => {
        const plottable = gSelected.filter((v) => v.unit);
        if (!plottable.length) return;

        // Mode "Stack" pecah SATU variabel jadi 3 segmen turunan (PV/
        // Baterai/PLN) — judul default-nya pakai label deskriptif
        // stackDef, bukan nama variabel yang dicentang apa adanya (yang
        // cuma "Daily Consumption", kurang jelas buat kartu di grid).
        const stackDefForSave = gChartType === "stack" ? findStackDef(plottable) : null;
        const defaultTitle = stackDefForSave ? stackDefForSave.label : plottable.map((v) => v.label).join(" vs ");

        // deviceGroupId/deviceGroupName are kept as a fallback/primary
        // group (used for the "Custom" date-range bounds, and as the
        // default for any var without its own groupId, e.g. cards saved
        // before this field existed) -- but each variable below now also
        // carries its OWN groupId (see toggleGraphVar), since a card's
        // variables can come from different device groups now. Falls
        // back to the currently-toggled group for the (rare) case none
        // of the checked vars ended up with a groupId.
        const primary = plottable[0];
        const primaryGroupId = primary.groupId || gCurrentGroupId;
        const activeGroupForCard = graphCatalog.deviceGroups.find((g) => g.id === primaryGroupId);

        const varsForCard = plottable.map((v) => ({ key: v.key, label: v.label, unit: v.unit, color: v.color, groupId: v.groupId }));

        // Editing an existing card (opened by clicking its title, see
        // cardTitleClick below) updates it in place — same id, period
        // and wide/order state kept — instead of pushing a new one.
        if (gEditingCardId) {
            const existing = cardsByTab[gTargetTab].find((c) => c.id === gEditingCardId);
            if (existing) {
                existing.title = graphTitleInput.value.trim() || defaultTitle;
                existing.chartType = gChartType;
                existing.deviceGroupId = primaryGroupId;
                existing.deviceGroupName = activeGroupForCard ? activeGroupForCard.name : "";
                existing.vars = varsForCard;
                // Destroy the old Chart.js instance so renderCardChart
                // rebuilds it fresh with the (possibly very different)
                // new variable selection, instead of trying to reuse
                // stale datasets/axes.
                if (cardChartInstances[existing.id]) {
                    cardChartInstances[existing.id].destroy();
                    delete cardChartInstances[existing.id];
                }
                renderGrid(gTargetTab);
                if (gTargetTab === "project") persistCards();
            }
            closeGraphModal();
            return;
        }

        counterByTab[gTargetTab] = (counterByTab[gTargetTab] || 0) + 1;
        const card = {
            type: "chart",
            id: gTargetTab + "-chart-" + Date.now(),
            title: graphTitleInput.value.trim() || defaultTitle,
            chartType: gChartType,
            deviceGroupId: primaryGroupId,
            deviceGroupName: activeGroupForCard ? activeGroupForCard.name : "",
            // Full per-variable info (key/label/unit/color/groupId) —
            // needed so a card with 2+ variables selected can plot EACH
            // one with its own device group's data when groups are
            // mixed, same as Project Detail's saved cards.
            vars: varsForCard,
            // FIX: disamakan dengan Project Detail -- kartu baru
            // harusnya pertama kali tampil mode "24 Hours" dulu (histori
            // 1 hari yang sudah ke-fetch bareng katalog dasar), BUKAN
            // langsung "30 Days" yang baru ke-fetch belakangan/on-demand.
            period: { mode: "24h", dateFrom: null, dateTo: null },
        };
        addChartCard(gTargetTab, card);
        closeGraphModal();
    });

    activeTab = "project";
    renderAll();

    // Cards restored from localStorage render as bare tiles at first
    // (renderCardChart bails out until graphCatalog is fetched), so
    // once the catalog is ready re-render the grid to draw their
    // actual Chart.js charts.
    // FIX (disclaimer §5 poin 1 & 2): dulu di sini langsung
    // ensureGraphCatalog() (fetch PENUH -- 90 hari + 1 hari untuk SEMUA
    // unit sekaligus) begitu halaman ini dibuka, walau kartu-kartunya
    // default-nya mode "24 Hours" doang -- initial load harusnya cuma
    // narik data 24 jam. Diganti ke ensureHourlyCatalog() (cuma
    // history1d) -- ensureGraphCatalog() PENUH tetap dipanggil, tapi
    // murni on-demand begitu Operator beneran klik toggle 7D/30D/Custom
    // atau buka modal "Add Graph" (lihat setCardPeriodMode/openGraphModal).
    if (cardsByTab.project.some((c) => c.type === "chart")) {
        ensureHourlyCatalog()
            .then(() => renderGrid("project"))
            .catch(() => {
                // ensureHourlyCatalog already logs a warning; the cards
                // just stay as empty tiles until the next successful load.
            });
    }

    loadEnvironmentalImpact();
    opdBindEnvSettingsModalChrome();
    renderTodayDateBadge();

}

// ---------- Today's date badge (next to the "Dashboard" title) ----------
// Format: "20 Aug, 2026" — day, short month name, year — matching the
// date-pill style already used elsewhere in the app.
function renderTodayDateBadge() {
    const el = document.getElementById("opdDateBadgeText");
    if (!el) return;
    const now = new Date();
    const day = now.getDate();
    const month = now.toLocaleDateString("en-US", { month: "short" });
    const year = now.getFullYear();
    el.textContent = `${day} ${month}, ${year}`;
}

// ===========================================================
// Bill Savings tariff config -- shared with Project Overview Admin
// 360's Settings modal (js/project-detail.js) via the SAME
// localStorage key, keyed by project id, so whichever page an admin
// configures the PLN Tariff / Diesel Fuel Cost on, the OTHER page's
// Bill Savings figure agrees too.
// ===========================================================
const OPD_ENV_DIESEL_DEFAULT_RATE = 3500;  // Rp/kWh, indicative diesel genset fuel cost placeholder

const OPD_ENV_PLN_TARIFFS = [
    { id: "r1_900",      label: "R-1/TR 900 VA (Rumah Tangga)",       rate: 1352.00 },
    { id: "r1_1300",     label: "R-1/TR 1300 VA (Rumah Tangga)",      rate: 1444.70 },
    { id: "r1_2200",     label: "R-1/TR 2200 VA (Rumah Tangga)",      rate: 1444.70 },
    { id: "r1_3500",     label: "R-1/TR 3500-5500 VA (Rumah Tangga)", rate: 1699.53 },
    { id: "b2_bisnis",   label: "B-2/TR 6600 VA-200 kVA (Bisnis)",    rate: 1444.70 },
    { id: "i3_industri", label: "I-3/TM di atas 200 kVA (Industri)",  rate: 1114.74 },
];
const OPD_ENV_TARIFF_CFG_KEY = "edash-admin-env-tariff-cfg";

function opdFormatRupiahThousands(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function opdLoadEnvTariffCfgAll() {
    try {
        const raw = localStorage.getItem(OPD_ENV_TARIFF_CFG_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function opdEnvTariffCfgFor(projectId) {
    const all = opdLoadEnvTariffCfgAll();
    const cfg = all[projectId] || {};
    return {
        source: cfg.source === "manual" ? "manual" : "pln",
        plnId: cfg.plnId && OPD_ENV_PLN_TARIFFS.some((t) => t.id === cfg.plnId) ? cfg.plnId : OPD_ENV_PLN_TARIFFS[3].id,
        manualRate: Number.isFinite(Number(cfg.manualRate)) && Number(cfg.manualRate) > 0 ? Number(cfg.manualRate) : null,
    };
}

function opdPersistEnvTariffCfg(projectId, cfg) {
    const all = opdLoadEnvTariffCfgAll();
    all[projectId] = cfg;
    try { localStorage.setItem(OPD_ENV_TARIFF_CFG_KEY, JSON.stringify(all)); } catch {}
}

// Resolves the active { rate, label } for a project's saved config.
// Label is kept short (source only) -- the exact PLN category/rate is
// already visible inside the Settings modal.
function opdEnvActiveTariff(projectId) {
    const cfg = opdEnvTariffCfgFor(projectId);
    if (cfg.source === "manual") {
        return { rate: cfg.manualRate != null ? cfg.manualRate : OPD_ENV_DIESEL_DEFAULT_RATE, label: "Based on Diesel Fuel Cost" };
    }
    return { rate: (OPD_ENV_PLN_TARIFFS.find((t) => t.id === cfg.plnId) || OPD_ENV_PLN_TARIFFS[3]).rate, label: "Based on PLN Tariff" };
}

// Resolves the project id the Bill Savings settings modal should read/
// write for -- same "active project" resolution loadEnvironmentalImpact()
// itself uses below, so Settings always configures the tariff for
// whichever project is actually showing in the card.
function opdEnvSettingsProjectId() {
    const active = (typeof window.PC_getActiveProject === "function") ? window.PC_getActiveProject() : null;
    return active ? active.id : "tawabi";
}

// ===========================================================
// Environmental Impact card — same numbers/formula as Project
// Overview's (js/project-detail.js renderEnvironmental()).
//
// Project-aware sejak fitur "operator project auto-load": proyek
// aktif operator (apa pun itu, termasuk Tawabi) SELALU ditarik dari
// Core API GET /projects/:id/analytics -- endpoint generik yang SAMA
// dipakai Project Overview Admin 360 (js/project-detail.js) untuk
// lifetime energy/CO2/trees-nya (Bill Savings sendiri SELALU dihitung
// dari tarif yang diatur admin lewat Settings -- lihat
// opdEnvActiveTariff() di atas -- bukan lagi dari costSavingsIdr
// backend atau faktor tetap). Kalau API-nya gagal (backend down,
// proyek belum lengkap device-nya, dst), kartu jatuh ke angka 0
// (lihat catch block di bawah) alih-alih diam-diam menampilkan angka
// proyek lain.
// ===========================================================
async function loadEnvironmentalImpact() {
    const ENV_CO2_PER_KWH = 0.85;          // kg CO2 avoided per kWh
    const ENV_TREES_PER_KG_CO2 = 1 / 21;   // ~21 kg CO2 absorbed / tree / year

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    const active = (typeof window.PC_getActiveProject === "function") ? window.PC_getActiveProject() : null;
    const activeId = active ? active.id : "tawabi";
    const tariff = opdEnvActiveTariff(activeId);

    try {
        const analytics = await window.edashApiFetch(`/projects/${activeId}/analytics`);
        const lifetime = (analytics && analytics.lifetime) || {};
        const totalKwh = Number(lifetime.totalEnergyKwh || 0);
        const energyMwh = totalKwh / 1000;
        const co2Kg = lifetime.co2ReductionKg != null ? Number(lifetime.co2ReductionKg) : totalKwh * ENV_CO2_PER_KWH;
        const co2Ton = co2Kg / 1000;
        const trees = lifetime.treesEquivalent != null ? Math.round(Number(lifetime.treesEquivalent)) : Math.round(co2Kg * ENV_TREES_PER_KG_CO2);
        const moneySaved = Math.round(totalKwh * tariff.rate);

        setText("opdEnvEnergy", energyMwh >= 100 ? Math.round(energyMwh).toLocaleString("id-ID") : energyMwh.toFixed(1));
        setText("opdEnvBillSavings", `Rp ${moneySaved.toLocaleString("id-ID")}`);
        setText("opdEnvBillSavingsSource", tariff.label);
        setText("opdEnvCo2", co2Ton.toFixed(1));
        setText("opdEnvTrees", trees.toLocaleString("id-ID"));
    } catch (e) {
        console.warn(`[operator-dashboard] Gagal ambil environmental impact utk project ${activeId}:`, e.message);
        setText("opdEnvEnergy", "0.0");
        setText("opdEnvBillSavings", "Rp 0");
        setText("opdEnvBillSavingsSource", tariff.label);
        setText("opdEnvCo2", "0.0");
        setText("opdEnvTrees", "0");
    }
}

// ===========================================================
// BILL SAVINGS SETTINGS MODAL (Environmental Impact card)
// ===========================================================
function opdBindEnvSettingsModalChrome() {
    const modal = document.getElementById("opdEnvSettingsModal");
    const closeBtn = document.getElementById("opdEnvSettingsCloseBtn");
    const cancelBtn = document.getElementById("opdEnvSettingsCancelBtn");
    const saveBtn = document.getElementById("opdEnvSettingsSaveBtn");
    const plnSelect = document.getElementById("opdEnvPlnSelect");
    const manualInput = document.getElementById("opdEnvManualInput");
    const sourceRadios = document.querySelectorAll('input[name="opdEnvSource"]');

    if (plnSelect && !plnSelect.options.length) {
        plnSelect.innerHTML = OPD_ENV_PLN_TARIFFS.map((t) =>
            `<option value="${t.id}">${t.label} — Rp ${t.rate.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kWh</option>`
        ).join("");
    }

    if (closeBtn) closeBtn.onclick = opdCloseEnvSettingsModal;
    if (cancelBtn) cancelBtn.onclick = opdCloseEnvSettingsModal;
    if (modal) modal.onclick = (e) => { if (e.target === modal) opdCloseEnvSettingsModal(); };

    sourceRadios.forEach((radio) => {
        radio.onchange = () => {
            const plnField = document.getElementById("opdEnvPlnField");
            const manualField = document.getElementById("opdEnvManualField");
            if (radio.checked) {
                if (plnField) plnField.hidden = radio.value !== "pln";
                if (manualField) manualField.hidden = radio.value !== "manual";
            }
        };
    });

    // Plain text field with live "." thousand-separator formatting
    // instead of a native number spinner.
    if (manualInput) {
        manualInput.oninput = () => {
            const digits = manualInput.value.replace(/\D/g, "");
            manualInput.value = digits ? opdFormatRupiahThousands(digits) : "";
        };
    }

    if (saveBtn) saveBtn.onclick = opdSaveEnvSettings;

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal && modal.classList.contains("is-open")) opdCloseEnvSettingsModal();
    });

    const settingsBtn = document.getElementById("opdEnvSettingsBtn");
    if (settingsBtn) settingsBtn.onclick = opdOpenEnvSettingsModal;
}

function opdOpenEnvSettingsModal() {
    const modal = document.getElementById("opdEnvSettingsModal");
    if (!modal) return;

    const cfg = opdEnvTariffCfgFor(opdEnvSettingsProjectId());
    const plnRadio = document.getElementById("opdEnvSourcePln");
    const manualRadio = document.getElementById("opdEnvSourceManual");
    const plnSelect = document.getElementById("opdEnvPlnSelect");
    const manualInput = document.getElementById("opdEnvManualInput");
    const plnField = document.getElementById("opdEnvPlnField");
    const manualField = document.getElementById("opdEnvManualField");

    if (plnRadio) plnRadio.checked = cfg.source === "pln";
    if (manualRadio) manualRadio.checked = cfg.source === "manual";
    if (plnField) plnField.hidden = cfg.source !== "pln";
    if (manualField) manualField.hidden = cfg.source !== "manual";
    if (plnSelect) plnSelect.value = cfg.plnId;
    // Leave blank (showing the placeholder example) until an admin has
    // actually saved a value of their own.
    if (manualInput) manualInput.value = cfg.manualRate != null ? opdFormatRupiahThousands(String(cfg.manualRate)) : "";

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
}

function opdCloseEnvSettingsModal() {
    const modal = document.getElementById("opdEnvSettingsModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
}

function opdSaveEnvSettings() {
    const source = document.getElementById("opdEnvSourceManual").checked ? "manual" : "pln";
    const plnId = document.getElementById("opdEnvPlnSelect").value;
    const manualDigits = document.getElementById("opdEnvManualInput").value.replace(/\D/g, "");
    const manualRate = manualDigits ? Number(manualDigits) : null;

    opdPersistEnvTariffCfg(opdEnvSettingsProjectId(), { source, plnId, manualRate });
    opdCloseEnvSettingsModal();

    loadEnvironmentalImpact();
    if (typeof showToast === "function") showToast("Bill savings settings updated.");
}