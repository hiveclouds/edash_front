// ============================================================
// Page: Project Overview — 360eDash
// Default dashboard: map overview, Today/Weekly charts, Top
// Performing Sites, Points of Interest, Installed Capacity and
// Emissions Avoided trends.
// ============================================================

// Basemap "street" open-source & gratis tanpa limit (OpenFreeMap, vector
// tiles MapLibre — gantinya MapTiler yang sering kena limit).
const PO_STREET_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Full-Indonesia view (same framing used on Project Selector's overview map).
const PO_INITIAL_CENTER = [-2.5, 118];
const PO_INITIAL_ZOOM = 4;
const PO_DAILY_TARGET_MWH = 52.4;

// TKT-000045: kategori proyek diperluas — samakan persis dengan
// PS_CATEGORY_META di js/project-selector.js (key, warna, label) biar
// Dashboard & Project Selector konsisten. "rooftop" tetap didukung
// sebagai alias lama ke "on-grid" (lihat poGuessCategoryFromName &
// poCategoryKey) supaya data lama tidak nyasar/hilang.
const PO_CATEGORY_COLORS = {
    "bss": "#FA891A",
    "on-grid": "#2F80ED",
    "hybrid-on-grid": "#9B51E0",
    "hybrid-bss": "#F2994A",
    "off-grid-diesel": "#828282",
    "fish-farm": "#27AE60"
};

const PO_CATEGORY_LABELS = {
    "bss": "Solaris BSS",
    "on-grid": "ON Grid Solar PV",
    "hybrid-on-grid": "Hybrid ON Grid Solar",
    "hybrid-bss": "Hybrid + Solaris BSS",
    "off-grid-diesel": "Off-Grid + Diesel",
    "fish-farm": "Solar Fish Farm"
};

const PO_CATEGORY_ICONS = {
    "bss": "fa-solid fa-car-battery",
    "on-grid": "fa-solid fa-solar-panel",
    "hybrid-on-grid": "fa-solid fa-plug-circle-bolt",
    "hybrid-bss": "fa-solid fa-battery-three-quarters",
    "off-grid-diesel": "fa-solid fa-gas-pump",
    "fish-farm": "fa-solid fa-fish"
};

const PO_CATEGORY_TINTS = {
    "bss":             { bg: "#FEF4EA", border: "#FBE6CE", iconBg: "#FDECD8" },
    "on-grid":         { bg: "#EAF2FE", border: "#D6E6FC", iconBg: "#DCEAFD" },
    "hybrid-on-grid":  { bg: "#F4EEFC", border: "#E6D9F8", iconBg: "#EBDFF9" },
    "hybrid-bss":      { bg: "#FEF3E8", border: "#FBE1C6", iconBg: "#FCE6CE" },
    "off-grid-diesel": { bg: "#F2F2F2", border: "#E0E0E0", iconBg: "#E6E6E6" },
    "fish-farm":       { bg: "#EEF8F1", border: "#DCF0E2", iconBg: "#E1F5E8" }
};

// key kategori lama sebelum TKT-000045 -> key baru, dipakai poRenderLegend()
// & poGuessCategoryFromName() supaya data lama tetap dihitung dengan benar,
// bukan hilang begitu saja.
const PO_CATEGORY_ALIASES = { "rooftop": "on-grid" };

function poCategoryKey(category) {
    return PO_CATEGORY_ALIASES[category] || category;
}

// Widget "CATEGORY" di Dashboard cuma nampilin 4 tipe solar project ini
// (klarifikasi user di TKT-000045) -- "bss" & "fish-farm" SENGAJA tidak
// masuk sini walau entry-nya tetap ada di PO_CATEGORY_LABELS/COLORS/
// ICONS/TINTS supaya po-site-icon (poRenderSitesList) & pin peta masih
// bisa kasih warna/ikon yang benar buat proyek lama yang category-nya
// masih "bss"/"fish-farm".
const PO_CATEGORY_ORDER = ["on-grid", "hybrid-on-grid", "hybrid-bss", "off-grid-diesel"];

// Project list — NO static JSON/dummy fallback anymore. This starts empty
// and is filled ONLY from the real backend (GET /api/v1/projects +
// /analytics, see poLoadProjectsFromApi below), the exact same source
// js/project-selector.js uses (GET /projects there). If the API can't be
// reached, this simply stays empty instead of silently showing stale/fake
// numbers from a bundled JSON file — matching how Project Selector already
// behaves (psProjects = [] when GET /projects fails), so the two pages
// never disagree because one of them fell back to different static data.
// Online/offline status itself is decided the same way everywhere: the
// deterministic "status" field from GET /devices/:id/telemetry/latest
// (see poRefreshLiveStatuses below and its project-selector.js counterpart
// psRefreshLiveStatuses), so Dashboard / Project Selector / Project
// Overview / System Information all agree.
let PO_PROJECTS = [];

// Daily-target intensity used to back-fill targetMWh for a project the API
// doesn't return an explicit ML/expected-energy target for (MWh/day per
// MWp installed).
const PO_TARGET_INTENSITY_MWH_PER_MWP = 65;

// REAL DATA — PLTS Kasdam, dari DOKUMENTASI_API_eDASHBOARD_360ENERGY_
// KASDAM.pdf (§4.1/§4.2). Sama seperti fallback serupa di
// js/system-information.js, js/project-detail.js, js/project-selector.js:
// poExtractDeviceIds() di bawah SUDAH generik (baca systems[].devices/
// inverters ATAU devices/inverters langsung di root, buat SEMUA proyek,
// bukan cuma Tawabi) — jadi Kasdam SEHARUSNYA sudah otomatis ikut
// ke-agregasi di Today/Weekly chart tanpa kode khusus. Konstanta ini
// cuma fallback TERAKHIR kalau GET /projects/:id proyek Kasdam ternyata
// tidak membawa systems/devices ternested sama sekali — Device ID di
// bawah konkret dari dokumentasi (SN F01257000587/588), bukan tebakan.
const PO_KASDAM_NAME_RE = /kasdam/i;
const PO_KASDAM_FALLBACK_DEVICE_IDS = [
    "7ee849a0-9ad5-11f1-8c86-25274e65e397",
    "abe8c180-9ad7-11f1-8c86-25274e65e397"
];

// projectContext-shaped entry (from js/project-context.js, "Add New
// Project" page, localStorage — the ONE thing that legitimately isn't
// backend data yet) -> the same project shape used everywhere else on
// this page.
function poProjectFromJson(entry) {

    const targetMWh = typeof entry.dailyTargetMWh === "number"
        ? entry.dailyTargetMWh
        : (entry.status === "online"
            ? entry.generatedMWh || 0
            : +(entry.capacityMWp * PO_TARGET_INTENSITY_MWH_PER_MWP).toFixed(1));

    return {
        name: entry.name,
        region: entry.location,
        category: entry.category,
        lat: entry.lat,
        lng: entry.lng,
        status: entry.status,
        capacityMWp: entry.capacityMWp,
        generatedMWh: entry.generatedMWh,
        targetMWh,
        co2AvoidedT: entry.co2AvoidedT
    };

}

// Proyek yang baru dibuat lewat halaman "Add New Project" (disimpan di
// localStorage lewat js/project-context.js) ikut ditambahkan ke sini
// supaya langsung muncul di peta/daftar Dashboard, konsisten dengan
// Project Selector (yang melakukan hal sama).
function poMergeUserProjects() {
    if (typeof window.PC_getUserProjects !== "function") return;
    const userProjects = window.PC_getUserProjects();
    if (!userProjects.length) return;

    const existingNames = new Set(PO_PROJECTS.map((p) => p.name));
    userProjects.forEach((p) => {
        if (existingNames.has(p.name)) return;
        PO_PROJECTS.push(poProjectFromJson(p));
        existingNames.add(p.name);
    });
}

// =============================
// REAL API loader — GET /api/v1/projects + GET /api/v1/projects/:id/analytics
// (per DOKUMENTASI_API_eDASHBOARD_360ENERGY, section "Project Management").
// This is the ONLY data source for the project list/map/summary on this
// page now — no static-file fallback. If the backend can't be reached, the
// project list simply stays empty (see poInitProjects below), the same way
// js/project-selector.js already behaves when GET /projects fails — so the
// two pages can never disagree because one of them quietly fell back to
// different static numbers.
// =============================

// PENTING: dokumentasi PDF nulis semua nama field pakai camelCase
// (mis. "projectName", "totalPeakKwp"), tapi response ASLI dari backend
// (dicek langsung lewat Network tab tanggal 2026-08-25) ternyata pakai
// snake_case ("project_name", "total_peak_kwp", dst) di SEMUA endpoint
// /projects, /projects/:id, dan kemungkinan besar juga /analytics —
// lihat contoh raw response GET /projects/:id (field systems[].
// system_code, inverters[].device_name, pvModules[].pv_installed_kw, dll).
//
// Daripada nambal satu-satu nama field di setiap fungsi (rawan kelewat &
// bakal rusak lagi kalau backend suatu saat "dibetulkan" balik ke
// camelCase sesuai dokumentasi), setiap response API di-normalisasi lewat
// poSnakeToCamelDeep() SEKALI di titik masuknya (di poFetchProjectAnalytics
// / poLoadProjectsFromApi / poFetchProjectDeviceIds di bawah), supaya sisa
// kode yang sudah ditulis mengikuti dokumentasi (camelCase) tetap jalan
// APAPUN case yang dipakai backend — snake_case dikonversi ke camelCase,
// dan kalau backend-nya sudah camelCase duluan, konversi ini no-op aman.
function poSnakeToCamelDeep(value) {
    if (Array.isArray(value)) return value.map(poSnakeToCamelDeep);
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, v] of Object.entries(value)) {
            const camelKey = key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
            out[camelKey] = poSnakeToCamelDeep(v);
            // Simpan juga key aslinya (kalau beda) sebagai alias, jaga-jaga
            // ada kode lain yang masih baca nama snake_case-nya langsung.
            if (camelKey !== key) out[key] = out[camelKey];
        }
        return out;
    }
    return value;
}

// projectSystem/projectType (from the API) don't map to the Dashboard's
// visual category taxonomy (bss / rooftop / fish-farm — used only for the
// map pin color + legend icon + Installed Capacity/Emissions Avoided
// chart). The API has no such field yet.
const PO_API_DEFAULT_CATEGORY = "on-grid";

// TIDAK dipakai lagi di poProjectFromApi() sejak disamakan dengan
// project-selector.js (keduanya sekarang default flat ke "on-grid",
// bukan nebak dari nama) -- dibiarkan di sini kalau-kalau mau dipakai
// lagi nanti, bukan dead code yang harus dihapus.
function poGuessCategoryFromName(name) {
    const n = (name || "").toLowerCase();
    if (/\bbss\b/.test(n) || n.includes("battery swap")) return "bss";
    if (n.includes("fish") || n.includes("bubbler") || n.includes("tambak")) return "fish-farm";
    if (n.includes("hybrid") && n.includes("bss")) return "hybrid-bss";
    if (n.includes("hybrid")) return "hybrid-on-grid";
    if (n.includes("diesel") || n.includes("off-grid") || n.includes("off grid")) return "off-grid-diesel";
    return PO_API_DEFAULT_CATEGORY;
}

async function poFetchProjectAnalytics(projectId) {
    try {
        return poSnakeToCamelDeep(await edashApiFetch(`/projects/${projectId}/analytics`));
    } catch (err) {
        // One project's analytics failing (e.g. no inverters registered
        // yet) shouldn't take down the whole dashboard — just render that
        // project with zeroed-out generation stats instead.
        console.warn(`[dashboard] analytics gagal untuk project ${projectId}:`, err.message);
        return null;
    }
}

// Coba beberapa kemungkinan letak/nama field koordinat, dan paksa jadi
// number kalau ternyata datang sebagai string (umum terjadi dari
// PostgreSQL numeric/decimal columns yang di-serialize JSON sebagai
// string). Balikin null kalau semua kemungkinan gagal/bukan angka valid.
function poExtractCoord(project, keys) {
    for (const key of keys) {
        // Support nested path pakai titik, mis. "location.lat".
        const value = key.split(".").reduce((obj, k) => obj?.[k], project);
        if (value === null || value === undefined || value === "") continue;
        const num = Number(value);
        if (Number.isFinite(num)) return num;
    }
    return null;
}

// SAMA PERSIS PS_TAWABI_NAME_RE di js/project-selector.js.
const PO_TAWABI_NAME_RE = /tawabi/i;

function poProjectFromApi(project, analytics) {

    const totalPeakKwp = analytics?.totalPeakKwp ?? 0;
    const energyTodayKwh = analytics?.realtime?.energyTodayKwh ?? 0;
    const currentPowerKw = analytics?.realtime?.totalCurrentPowerKw ?? 0;
    // NOTE: co2AvoidedT is used everywhere else in this file (project
    // list, poRenderMapStat's CO2 badge, the Installed Capacity/Emissions
    // Avoided trend chart) as a CUMULATIVE/lifetime figure — not "today
    // only". Previously this read analytics.realtime.todayCo2ReductionKg
    // (today's CO2 avoided), which is 0 outside active generation hours and
    // made the Emissions Avoided chart show 0.00 T. Use
    // analytics.lifetime.co2ReductionKg instead, per
    // DOKUMENTASI_API_eDASHBOARD_360ENERGY sec. 5.2.
    const co2ReductionKg = analytics?.lifetime?.co2ReductionKg ?? 0;
    const expectedEnergyTodayKwh = analytics?.mlMetrics?.expectedEnergyTodayKwh;

    const capacityMWp = +(totalPeakKwp / 1000).toFixed(3);

    // No explicit daily target from the API when mlMetrics is unavailable —
    // fall back to the same capacity-based intensity used for JSON-sourced
    // projects (see PO_TARGET_INTENSITY_MWH_PER_MWP above), so both data
    // sources stay visually consistent.
    const targetMWh = typeof expectedEnergyTodayKwh === "number"
        ? +(expectedEnergyTodayKwh / 1000).toFixed(3)
        : +((capacityMWp * PO_TARGET_INTENSITY_MWH_PER_MWP)).toFixed(1);

    // "latitude"/"longitude" adalah nama field per DOKUMENTASI_API, tapi
    // dijaga toleran ke beberapa alias umum + nested "location.*" kalau
    // implementasi asli backend ternyata beda dari dokumentasi.
    const lat = poExtractCoord(project, ["latitude", "lat", "location.lat", "location.latitude", "geo.lat"]);
    const lng = poExtractCoord(project, ["longitude", "lng", "lon", "location.lng", "location.longitude", "geo.lng"]);

    // Dokumentasi bilang "projectName" (camelCase), tapi response asli
    // backend ternyata snake_case ("project_name") — lihat contoh raw
    // response GET /api/v1/projects. Dicek beberapa kemungkinan biar
    // tahan banting kalau backend-nya nanti disesuaikan ke dokumentasi.
    const name = project.project_name || project.projectName || project.name || "(Tanpa nama)";

    // PERBAIKAN: proyek Tawabi HARUS pakai id lokal literal "tawabi", SAMA
    // PERSIS dengan psBuildProjectFromApi() di js/project-selector.js --
    // sebelumnya Dashboard selalu pakai UUID asli dari backend apa adanya.
    // window.__psGetLiveDataForProject() / window.__siLoadSystemsForProject()
    // (dipanggil poRefreshLiveStatuses/poApplyInverterTypeCategories di bawah)
    // SAMA-SAMA meng-cache & meng-cabangkan logikanya berdasarkan id ini:
    //   - psGetLiveDataForProject() cuma jatuh ke fallback telemetry JSON
    //     lokal (satu-satunya proyek yang punya file itu) kalau id-nya
    //     PERSIS "tawabi"; UUID asli tidak akan
    //     pernah cocok, jadi Tawabi selalu berakhir "offline" kalau live
    //     device discovery-nya gagal/timeout, walau Project Selector (yang
    //     ID-nya sudah "tawabi") berhasil pakai fallback itu dan tampil
    //     "online" -- angka Online/Offline dua halaman jadi beda utk proyek
    //     yang sama persis.
    //   - system-information.js/findCoreApiProject() juga cuma memilih path
    //     resolusi khusus Tawabi (TAWABI_PROJECT_ID hardcode + fallback cari
    //     nama) kalau localProjectId === "tawabi"; UUID asli akan dicoba
    //     sebagai GET /projects/:id biasa, yang bisa 404/beda hasil,
    //     sehingga Type (On-grid/Off-grid/Hybrid) yang dipakai utk kartu
    //     CATEGORY juga bisa beda dari Project Selector untuk Tawabi.
    // Cache-nya (psLiveDataCache/psDeviceCache/window.__siSystems) di-key
    // pakai id ini juga, jadi menyamakan id = menyamakan entry cache yang
    // dipakai kedua halaman, bukan cuma menyamakan logikanya saja.
    const isTawabi = PO_TAWABI_NAME_RE.test(name);

    return {
        id: isTawabi ? "tawabi" : project.id,
        // UUID backend ASLI tetap disimpan terpisah -- dipakai
        // poFetchProjectDeviceIds() di bawah (GET /projects/:id LANGSUNG,
        // fitur khusus Dashboard buat Today/Weekly chart, TIDAK dipakai/
        // dibagi dengan Project Selector) yang untuk proyek Tawabi memang
        // butuh UUID asli, BUKAN id lokal "tawabi" di atas (yang sengaja
        // bukan UUID valid, lihat komentar `isTawabi` di atas).
        apiId: project.id,
        name,
        region: project.location,
        // Disamakan dengan project-selector.js (psBuildProjectFromApi):
        // TIDAK menebak dari nama proyek lagi (poGuessCategoryFromName
        // masih ada di bawah tapi sudah tidak dipanggil di sini) --
        // sebelumnya Dashboard menebak dari nama sementara Project
        // Selector selalu default ke "on-grid", jadi 2 halaman bisa
        // menghitung kategori proyek yang SAMA secara berbeda. Sampai
        // backend beneran ngirim field `category`, dua-duanya sama-sama
        // default ke "on-grid".
        category: project.category || PO_API_DEFAULT_CATEGORY,
        lat,
        lng,
        // Placeholder awal SEBELUM poRefreshLiveStatuses() jalan (yang
        // menimpa ini dengan field "status" deterministik dari
        // GET /devices/:id/telemetry/latest). currentPowerKw > 0 di sini
        // cuma tebakan sementara supaya UI tidak kosong saat baru dimuat.
        status: currentPowerKw > 0 ? "online" : "offline",
        capacityMWp,
        generatedMWh: +(energyTodayKwh / 1000).toFixed(3),
        targetMWh,
        co2AvoidedT: +(co2ReductionKg / 1000).toFixed(3)
    };

}

// Returns true if real API data was loaded and PO_PROJECTS was
// replaced with it; false if the API is unreachable (caller then clears
// PO_PROJECTS instead of falling back to any static JSON).
async function poLoadProjectsFromApi() {

    let rawProjects;
    try {
        // GET /api/v1/projects -> { success: true, data: [...] }
        rawProjects = poSnakeToCamelDeep(await edashApiFetch("/projects"));
    } catch (err) {
        // Backend down, not logged in yet (401 already redirects inside
        // edashApiFetch), CORS/dev environment, etc. — bail out quietly
        // and let the caller fall back to the static JSON/dummy data.
        console.warn("[dashboard] GET /api/v1/projects gagal, pakai fallback lokal:", err.message);
        return false;
    }

    const list = Array.isArray(rawProjects) ? rawProjects : (rawProjects?.projects || []);
    if (!list.length) return false;

    // Fetch analytics for every project in parallel (each call is
    // independently fault-tolerant via poFetchProjectAnalytics above).
    const analyticsList = await Promise.all(
        list.map((p) => poFetchProjectAnalytics(p.id))
    );

    const allMapped = list.map((p, i) => poProjectFromApi(p, analyticsList[i]));

    const mapped = allMapped
        // Projects without coordinates can't be pinned on the MapLibre map,
        // so exclude them from this dashboard view (they still exist via
        // Project Selector / Project Detail, which don't require lat/lng).
        .filter((p) => typeof p.lat === "number" && typeof p.lng === "number");

    if (!mapped.length) {
        console.warn("[dashboard] Semua proyek dari API gagal dipetakan (cek lat/lng). Raw:", list);
        console.warn("[dashboard] Hasil mapping poProjectFromApi:", allMapped);
        return false;
    }

    PO_PROJECTS = mapped;
    PO_USING_API = true;
    return true;

}

// True once poLoadProjectsFromApi() succeeds — gates poLoadRealTelemetryExtras()
// below, since device-level telemetry only makes sense when PO_PROJECTS
// actually holds real project.id values from the backend.
let PO_USING_API = false;

// Single entry point used by initDashboardPage() and the Refresh button:
// always the real backend, no static-JSON fallback. If it's unreachable,
// the project list is cleared (not swapped for stale/fake data) — same
// behavior as js/project-selector.js when GET /projects fails.
async function poInitProjects() {

    const apiOk = await poLoadProjectsFromApi();

    if (!apiOk) {
        PO_USING_API = false;
        // Clear anything a PREVIOUS successful API load left behind, so a
        // Refresh that suddenly fails doesn't keep showing stale real
        // curves/POI next to an empty project list.
        PO_TODAY_REAL_CURVE = null;
        PO_WEEKLY_REAL_DATA = null;
        PO_POI_REAL_LIST = null;
        PO_POI_API_FAILED = false;
        PO_PROJECTS = [];
    }

    // Locally-created projects (Add New Project page, saved to
    // localStorage — not yet POSTed to the backend) are merged in either
    // way, so they still show up immediately regardless of data source.
    poMergeUserProjects();

    // Timpa p.category tiap proyek dengan kategori yang diturunkan dari
    // Type (On-grid/Off-grid/Hybrid) di tab System Information — disamakan
    // persis dengan psApplyInverterTypeCategories() di js/project-selector.js
    // (lihat komentar di sana). Sebelumnya Dashboard selalu default ke
    // PO_API_DEFAULT_CATEGORY ("on-grid") apa adanya, makanya kartu
    // Category selalu membaca semua proyek sebagai ON Grid Solar PV.
    await poApplyInverterTypeCategories();

    // Timpa p.status tiap proyek dengan status Online/Offline DETERMINISTIK
    // langsung dari field "status" GET /devices/:id/telemetry/latest (lihat
    // poRefreshLiveStatuses() di bawah) -- sebelumnya Dashboard menebak dari
    // currentPowerKw > 0 (analytics) lalu masih dicocok-cocokkan lagi ke
    // Project Selector/System Information, yang rawan beda hasil kalau
    // device sempat flap di antara beberapa request terpisah. Sekarang
    // sumbernya tunggal & sudah dihitung backend, jadi tidak perlu
    // cross-check ke halaman lain lagi.
    //
    // Dipanggil TANPA syarat (tidak di-gate `if (PO_USING_API)`) supaya
    // status tetap ke-refresh walau daftar proyek sempat jatuh ke fallback.
    await poRefreshLiveStatuses();

}

// Ambil status "online"/"offline" SATU device langsung dari field
// deterministik baru GET /devices/:id/telemetry/latest -> data.status
// (lihat dokumentasi fitur "Indikator Deterministik Status Online/Offline").
// Backend yang menghitungnya (heartbeat: Date.now() - maxTs <= 15 menit),
// bukan frontend lagi -- jadi TIDAK ada tebak-tebakan dari currentPowerKw
// atau query atribut server ThingsBoard tambahan di sini.
async function poFetchDeviceOnlineStatus(deviceId) {
    try {
        const data = await edashApiFetch(`/devices/${deviceId}/telemetry/latest`);
        return data?.status === "online";
    } catch (e) {
        // Device tidak bisa dibaca sama sekali (timeout/404/dll) -> anggap
        // offline, konsisten dengan definisi "offline" di kontrak endpoint.
        return false;
    }
}

// Timpa p.status ("online"/"offline") tiap proyek di PO_PROJECTS
// memakai field "status" deterministik baru dari
// GET /devices/:id/telemetry/latest. Satu proyek dianggap "online" kalau
// MINIMAL SATU device-nya online. Device id-nya diambil dari
// window.__psGetProjectDeviceIds() (js/project-selector.js) BILA tersedia
// -- SATU sumber device-list yang sama dipakai kedua halaman (termasuk
// penanganan khusus Tawabi di sana), supaya angka Online/Offline Dashboard
// & Project Selector tidak pernah beda lagi untuk proyek yang sama.
// poFetchProjectDeviceIds() (dipakai Today/Weekly chart di file ini) cuma
// jadi fallback kalau project-selector.js entah kenapa belum termuat.
async function poRefreshLiveStatuses() {

    const getDeviceIds = typeof window.__psGetProjectDeviceIds === "function"
        ? window.__psGetProjectDeviceIds
        : (p) => poFetchProjectDeviceIds(p.apiId || p.id, p.name);

    await Promise.all(PO_PROJECTS.map(async (p) => {
        try {
            const deviceIds = await getDeviceIds(p);
            if (!deviceIds.length) {
                p.status = "offline";
                return;
            }
            const statuses = await Promise.all(deviceIds.map(poFetchDeviceOnlineStatus));
            p.status = statuses.some(Boolean) ? "online" : "offline";
        } catch (e) {
            p.status = "offline";
        }
    }));

}

// "On-grid"/"Off-grid"/"Hybrid" dari Core API (sys.inverterOverview.inverterType,
// SAMA PERSIS field yang ditampilkan tab System Information) bisa datang
// dalam beberapa variasi ejaan — normalisasi case/separator-insensitive
// sama persis seperti psNormalizeInverterType() di js/project-selector.js.
function poNormalizeInverterType(raw) {
    const norm = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s_-]+/g, "") : "";
    if (norm === "ongrid") return "on-grid";
    if (norm === "offgrid") return "off-grid";
    if (norm === "hybrid") return "hybrid";
    return null;
}

// Type System Information cuma 3 nilai, tapi kategori Dashboard/Project
// Selector ada 4 (on-grid/hybrid-on-grid/hybrid-bss/off-grid-diesel) --
// "Hybrid" dipetakan ke "hybrid-on-grid" (varian hybrid default/plain),
// sama persis psInverterTypeToCategory() di js/project-selector.js.
function poInverterTypeToCategory(normType) {
    if (normType === "on-grid") return "on-grid";
    if (normType === "off-grid") return "off-grid-diesel";
    if (normType === "hybrid") return "hybrid-on-grid";
    return null;
}

// Timpa p.category tiap proyek di PO_PROJECTS dengan kategori yang
// diturunkan dari Type System Information (sys.inverterOverview.inverterType)
// untuk system-system milik proyek itu -- dipanggil lewat
// window.__siLoadSystemsForProject() (diekspos oleh js/system-information.js
// = loadSystemsForProject() aslinya, lihat catatan di sana) supaya sumber
// datanya 100% SAMA dengan yang ditampilkan tab System Information, BUKAN
// nebak dari nama proyek atau default statis PO_API_DEFAULT_CATEGORY lagi.
// Kalau proyeknya belum punya system tercatat sama sekali / Core API-nya
// gagal dimuat, category dibiarkan default "on-grid" apa adanya.
async function poApplyInverterTypeCategories() {

    if (typeof window.__siLoadSystemsForProject !== "function") {
        console.warn("[dashboard] window.__siLoadSystemsForProject tidak tersedia (js/system-information.js belum termuat?), kategori Type dilewati.");
        return;
    }

    await Promise.all(PO_PROJECTS.map(async (p) => {
        try {
            // Pakai cache System Information dulu kalau proyek ini
            // kebetulan sudah pernah dimuat di sesi ini, supaya tidak
            // GET /projects/:id dua kali percuma.
            const cached = (window.__siSystems || []).filter((s) => s.basic && s.basic.projectId === p.id);
            const systems = cached.length ? cached : await window.__siLoadSystemsForProject(p.id);
            if (!systems || !systems.length) return;

            // PENTING: window.__siLoadSystemsForProject() cuma FETCH & RETURN,
            // tidak pernah nulis balik ke window.__siSystems sendiri -- kalau
            // hasil fetch di sini tidak disimpan, window.__siGetProjectOnlineStatus()
            // (dipakai poRefreshLiveStatuses di bawah utk cross-check status
            // Online/Offline) akan SELALU return null utk proyek ini, jadi
            // cross-check-nya percuma kecuali user kebetulan sudah pernah
            // buka tab System Information sendiri. Simpan di sini (dedup by
            // id, sama seperti psApplyInverterTypeCategories() di
            // js/project-selector.js) supaya cross-check itu aktif utk
            // SEMUA proyek sejak Dashboard pertama kali dimuat.
            if (!cached.length) {
                window.__siSystems = window.__siSystems || [];
                const existingIds = new Set(window.__siSystems.map((s) => s.id));
                systems.forEach((s) => { if (!existingIds.has(s.id)) window.__siSystems.push(s); });
            }

            const ownCategories = systems
                .map((s) => poInverterTypeToCategory(poNormalizeInverterType(s.inverterOverview && s.inverterOverview.inverterType)))
                .filter(Boolean);
            if (!ownCategories.length) return;

            const counts = {};
            ownCategories.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
            p.category = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        } catch (e) {
            console.warn(`[dashboard] Gagal ambil Type System Information utk proyek "${p.id}":`, e.message);
        }
    }));

}

// =============================
// REAL telemetry loader — Today curve, Weekly analysis & Points of
// Interest (GET /api/v1/projects/:id, GET /api/v1/devices/:id/telemetry/
// history, GET /api/v1/alerts — per DOKUMENTASI_API_eDASHBOARD_360ENERGY
// sections 4.5, 5.1 and 6.4). poLoadProjectsFromApi() above already gives
// real numbers for the map stats / site list (analytics endpoint); this
// section wires up the two charts and the POI panel that were previously
// fully synthetic (sine-wave "Today" curve, hardcoded weekly bars,
// hardcoded POI list) to the same live backend. No dummy fallback remains —
// each panel now shows an honest empty state if its endpoint hasn't
// returned real data yet.
//
// CATATAN untuk yang pegang backend: dokumentasi tidak menuliskan contoh
// body respons persis untuk GET /devices/:id/telemetry/history, maupun
// struktur field "systems"/"devices" di dalam GET /projects/:id (section
// 5.1 cuma menyebut ini naratif: "detail proyek lengkap beserta unit
// sistem dan inverter terpasang"). Fungsi poExtractDeviceIds() dan
// poParseHistoryPoints() di bawah menduga bentuk yang paling masuk akal
// mengikuti pola endpoint lain di dokumen ini (amplop {success,data}, key
// telemetri seperti pada /telemetry/latest & /telemetry/raw) dan mem-parse
// beberapa kemungkinan bentuk secara defensif. Kalau bentuk asli responsnya
// beda, sesuaikan dua fungsi itu saja — sisanya tidak perlu diubah.
// =============================

let PO_TODAY_REAL_CURVE = null;   // [{h:0..24, kw}] realized so far hari ini, atau null kalau API gagal
let PO_WEEKLY_REAL_DATA = null;   // [{day, thisWeek, lastWeek}], atau null kalau API gagal/belum ada histori
let PO_POI_REAL_LIST = null;      // daftar alarm aktif dari GET /alerts, atau null kalau API gagal/kosong
let PO_POI_API_FAILED = false;    // true khusus kalau endpoint /alerts error (bukan sekadar list kosong) —
                                   // dipakai poRenderPoiList() supaya menampilkan pesan error yang jujur,
                                   // bukan diam-diam kosong.

// Mencoba beberapa kemungkinan bentuk daftar inverter bersarang di dalam
// satu proyek (systems[].devices[] / systems[].inverters[] / devices[] /
// inverters[] langsung di root) dan kembalikan daftar thingsboardDeviceId.
function poExtractDeviceIds(projectDetail) {

    if (!projectDetail) return [];
    const out = new Set();

    const pushId = (d) => {
        const id = d?.thingsboardDeviceId || d?.id;
        if (id) out.add(id);
    };

    (projectDetail.systems || []).forEach((sys) => {
        (sys.devices || sys.inverters || []).forEach(pushId);
    });

    (projectDetail.devices || projectDetail.inverters || []).forEach(pushId);

    return Array.from(out);

}

async function poFetchProjectDeviceIds(projectId, projectName) {
    try {
        // GET /api/v1/projects/:id -> { success:true, data:{ ...systems, devices } }
        const detail = poSnakeToCamelDeep(await edashApiFetch(`/projects/${projectId}`));
        const ids = poExtractDeviceIds(detail);

        // Fallback KHUSUS Kasdam — lihat catatan PO_KASDAM_FALLBACK_DEVICE_IDS
        // di atas. Kalau proyek Kasdam ketemu tapi tidak ada device
        // ternested sama sekali, tetap sertakan 2 device ID dari dokumentasi
        // PDF supaya Today/Weekly chart di Overview tidak kehilangan
        // kontribusi Kasdam begitu saja.
        if (!ids.length && PO_KASDAM_NAME_RE.test(projectName || "")) {
            console.warn(`[dashboard] Proyek Kasdam (${projectId}) tidak membawa device ternested, pakai fallback PO_KASDAM_FALLBACK_DEVICE_IDS dari dokumentasi PDF.`);
            return PO_KASDAM_FALLBACK_DEVICE_IDS.slice();
        }

        return ids;
    } catch (err) {
        console.warn(`[dashboard] GET /projects/${projectId} gagal (device list):`, err.message);
        return [];
    }
}

// Menormalkan respons GET /devices/:id/telemetry/history?last=...
// (TANPA `keys=` -- lihat FIX 2026-08-26 di poFetchDeviceHistory)
// menjadi [{ts:number, value:number}]. Bentuk ASLI dikonfirmasi dari
// console log tanggal 2026-08-25 (lihat DevTools screenshot):
//   { deviceId, provider, inverterType, query: {...}, telemetry: {...} }
// — datanya ada di dalam field "telemetry", bukan "data"/"points"/"series"
// seperti yang tadinya diduga.
//
// FIX (2026-08-26): "telemetry" itu BUKAN keyed object flat seperti
// { "overview.energyToday": [...] } (dugaan sebelumnya, makanya kode lama
// coba raw.telemetry[key] dengan key string dotted apa adanya). Yang benar
// dikonfirmasi dari project-detail.js (pdBuildEnergyProduction dkk, yang
// TIDAK pernah kena "0 titik data" di console) -- telemetry dikelompokkan
// per KATEGORI dulu, baru per METRIK di dalamnya:
//   raw.telemetry.overview.energyToday   (bukan raw.telemetry["overview.energyToday"])
//   raw.telemetry.overview.currentPower
//   raw.telemetry.battery.voltage, dst.
// key yang dipakai poFetchDeviceHistory ("overview.energyToday", dst)
// sebenarnya sudah persis path itu, cuma perlu di-split "." dan dijalani
// nested, bukan dipakai sebagai satu string kunci datar. Urutan pencarian
// sekarang:
//   1. Jalani raw.telemetry via path bertitik (mis. "overview.energyToday"
//      -> raw.telemetry.overview.energyToday) -- ini bentuk yang benar.
//   2. raw.telemetry[key] apa adanya, jaga-jaga endpoint lain yang
//      memang pakai flat key literal.
//   3. raw.telemetry itu sendiri kalau sudah array, atau objek pertama di
//      dalamnya yang isinya array (jaga-jaga nama key echo balik beda).
//   4. Fallback ke pola amplop lain (raw[key]/points/data/series/result)
//      untuk jaga-jaga endpoint lain yang bentuknya beda dari /history.
// Field ts/value juga dicoba dengan beberapa alias nama umum
// (timestamp/time/x, value/val/y) supaya toleran walau namanya beda.
function poParseHistoryPoints(raw, key) {

    if (!raw) return [];

    let series;

    if (raw.telemetry && typeof raw.telemetry === "object") {
        // (1) Path bertitik nested -- bentuk yang sungguhan dipakai backend.
        if (key && key.includes(".")) {
            const nested = key
                .split(".")
                .reduce((obj, part) => (obj && typeof obj === "object" ? obj[part] : undefined), raw.telemetry);
            if (Array.isArray(nested)) series = nested;
        }
        // (2) Flat key literal apa adanya (jaga-jaga).
        if (!series && Array.isArray(raw.telemetry[key])) {
            series = raw.telemetry[key];
        } else if (!series && Array.isArray(raw.telemetry)) {
            series = raw.telemetry;
        } else if (!series) {
            const firstArrayValue = Object.values(raw.telemetry).find((v) => Array.isArray(v));
            series = firstArrayValue;
        }
    }

    if (!series) {
        series =
            raw[key] ??
            raw.points ?? raw.data ?? raw.series ?? raw.result ??
            raw;
    }

    if (!Array.isArray(series) && series && typeof series === "object") {
        const firstArrayValue = Object.values(series).find((v) => Array.isArray(v));
        series = firstArrayValue ?? Object.values(series)[0];
    }
    if (!Array.isArray(series)) return [];

    const points = series
        .map((p) => {
            if (p === null || typeof p !== "object") return null;
            const ts = Number(p.ts ?? p.timestamp ?? p.time ?? p.t ?? p.x);
            const value = Number(p.value ?? p.val ?? p.v ?? p.y);
            return { ts, value };
        })
        .filter((p) => p && Number.isFinite(p.ts) && Number.isFinite(p.value));

    if (!points.length && series.length) {
        // Fetch-nya sukses dan ADA data, tapi bentuknya tidak dikenali sama
        // sekali oleh parser di atas -> log bentuk aslinya supaya gampang
        // dicocokkan ke poParseHistoryPoints() alih-alih diam-diam jatuh ke
        // dummy tanpa jejak.
        console.warn(
            `[dashboard] telemetry/history untuk key "${key}" dapat data tapi bentuknya tak dikenali parser. Contoh item mentah:`,
            series[0],
            "Raw response:", raw
        );
    }

    return points;

}

// Batasi berapa banyak request telemetry/history yang boleh "in-flight"
// bersamaan (Laporan Optimasi Telemetry API §5 poin 2: Thundering Herd —
// Promise.all() untuk histori SELURUH device sekaligus membebani connection
// pool database). Dipakai sebagai pengganti Promise.all polos di
// poLoadTodayRealCurve/poLoadWeeklyRealData di bawah: device tetap diproses
// semua, tapi dalam batch kecil berurutan, bukan serentak dalam satu tembakan.
const PO_HISTORY_BATCH_SIZE = 5;

async function poRunInBatches(items, batchSize, worker) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(worker));
        results.push(...batchResults);
    }
    return results;
}

async function poFetchDeviceHistory(deviceId, key, last) {
    try {
        // FIX (kesesuaian kontrak Rev3, Laporan Optimasi Telemetry API §1, §3
        // & §4): `key` di sini SUDAH persis nama variabel logis Rev3
        // dot-notation (mis. "overview.currentPower", "overview.energyToday")
        // sesuai tabel "Daftar Lengkap Variabel Rev3" -- ini justru nama yang
        // WAJIB dikirim sebagai query param `keys=` ke backend, supaya Lean
        // Normalized-to-Raw Key Resolver di backend cukup menarik & menghitung
        // 1 metrik ini saja (bukan seluruh 57 register mentah) untuk tiap
        // device. Dashboard cuma butuh 2 variabel total (overview.currentPower
        // untuk Today chart, overview.energyToday untuk Weekly chart) --
        // TANPA keys= di sini, tujuan utama optimasi Rev3 (mencegah CPU VPS
        // 100%) batal untuk halaman ini.
        //
        // (Catatan histori: workaround "JANGAN kirim keys=" 2026-08-26 di atas
        // sudah tidak berlaku -- itu menghindari bug Key Resolver versi lama;
        // backend sekarang sudah memperbaikinya per laporan ini.)
        const raw = await edashApiFetch(
            `/devices/${deviceId}/telemetry/history?last=${last}&keys=${encodeURIComponent(key)}`
        );
        const points = poParseHistoryPoints(raw, key);
        if (!points.length) {
            console.warn(
                `[dashboard] telemetry/history "${key}" untuk device ${deviceId}: 0 titik data setelah parsing.`,
                "raw.telemetry:", raw?.telemetry,
                "raw.telemetry keys:", raw?.telemetry ? Object.keys(raw.telemetry) : null,
                "Full raw:", raw
            );
        }
        return points;
    } catch (err) {
        console.warn(`[dashboard] telemetry/history gagal untuk device ${deviceId}:`, err.message);
        return [];
    }
}

// --- Today chart: kurva daya per-jam REAL, dijumlah dari SEMUA inverter di
// SEMUA proyek, untuk 24 jam terakhir (overview.currentPower, satuan W per
// kamus data section 7 -> dikonversi ke kW di sini).
async function poLoadTodayRealCurve(allDeviceIds) {

    if (!allDeviceIds.length) { PO_TODAY_REAL_CURVE = null; return; }

    const pointSets = await poRunInBatches(
        allDeviceIds, PO_HISTORY_BATCH_SIZE,
        (id) => poFetchDeviceHistory(id, "overview.currentPower", "24h")
    );

    const allPoints = pointSets.flat();
    if (!allPoints.length) { PO_TODAY_REAL_CURVE = null; return; }

    // Bucket per jam-dalam-hari, dijumlah lintas device (kW), dirata-rata
    // dulu per device dalam jam yang sama sebelum dijumlah supaya device
    // yang kirim data lebih sering tidak mendominasi bucket-nya.
    const buckets = new Map(); // hour -> { sum, count }
    allPoints.forEach(({ ts, value }) => {
        const hour = new Date(ts).getHours();
        const b = buckets.get(hour) || { sum: 0, count: 0 };
        b.sum += value / 1000; // W -> kW
        b.count += 1;
        buckets.set(hour, b);
    });

    PO_TODAY_REAL_CURVE = Array.from(buckets.entries())
        .map(([h, b]) => ({ h, kw: b.sum / b.count }))
        .sort((a, b) => a.h - b.h);

}

// --- Weekly chart: energi harian REAL untuk 14 hari terakhir (minggu ini
// vs minggu lalu), dari overview.energyToday (kWh, reset tiap tengah malam
// per kamus data section 7) — nilai MAKS per device per hari mendekati
// total produksi hari itu untuk device tersebut, lalu dijumlah antar device.
async function poLoadWeeklyRealData(allDeviceIds) {

    if (!allDeviceIds.length) { PO_WEEKLY_REAL_DATA = null; return; }

    const perDevicePoints = await poRunInBatches(
        allDeviceIds, PO_HISTORY_BATCH_SIZE,
        (id) => poFetchDeviceHistory(id, "overview.energyToday", "14d")
    );

    const dailyTotals = new Map(); // "YYYY-MM-DD" -> kWh terjumlah lintas device

    perDevicePoints.forEach((points) => {
        const dayMaxForDevice = new Map();
        points.forEach(({ ts, value }) => {
            const dayKey = new Date(ts).toISOString().slice(0, 10);
            dayMaxForDevice.set(dayKey, Math.max(dayMaxForDevice.get(dayKey) || 0, value));
        });
        dayMaxForDevice.forEach((value, dayKey) => {
            dailyTotals.set(dayKey, (dailyTotals.get(dayKey) || 0) + value);
        });
    });

    // Kalau histori 14 hari kosong (device belum pernah lapor), biarkan
    // PO_WEEKLY_REAL_DATA null — poRenderWeeklyChart() menampilkan pesan
    // "belum tersedia" yang jujur, bukan angka contoh/dummy.
    if (!dailyTotals.size) { PO_WEEKLY_REAL_DATA = null; return; }

    // 14 hari kalender terakhir (lama -> baru), dipotong jadi "minggu lalu"
    // (hari ke -14..-8) vs "minggu ini" (hari ke -7..hari ini) — disejajarkan
    // berdasarkan POSISI hari (Sen..Min), bukan berdasarkan batas minggu
    // kalender.
    const days = [];
    for (let i = 13; i >= 0; i -= 1) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push({ key: d.toISOString().slice(0, 10), weekday: d.getDay() });
    }

    const thisWeekDays = days.slice(7);
    const lastWeekDays = days.slice(0, 7);

    const weekdayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const jsDayToLabel = (jsDay) => weekdayOrder[(jsDay + 6) % 7]; // 0=Min(Sun) -> "Sun"

    PO_WEEKLY_REAL_DATA = thisWeekDays.map((d, i) => ({
        day: jsDayToLabel(d.weekday),
        thisWeek: +(dailyTotals.get(d.key) || 0).toFixed(1),
        lastWeek: +(dailyTotals.get(lastWeekDays[i].key) || 0).toFixed(1)
    }));

}

// --- Points of Interest: alarm AKTIF sungguhan dari GET /api/v1/alerts
// (section 6.4) dipetakan ke bentuk panel POI yang sama.
const PO_ALERT_SEVERITY_TO_POI_TYPE = {
    CRITICAL: "repair",
    WARNING: "maintenance"
};

function poFormatAlertDate(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function poLoadPoiFromAlerts() {
    try {
        // FIX (2026-08-26): endpoint yang beneran ada di backend itu
        // GET /alerts/active (lihat alert.routes.ts -- routes.get('/active', ...)),
        // BUKAN GET /alerts?status=ACTIVE (query param "status" itu tidak
        // pernah dibaca controller-nya sama sekali, dan path "/alerts" tanpa
        // "/active" memang tidak ada route-nya -> 404 NOT_FOUND persis
        // seperti di console).
        const raw = poSnakeToCamelDeep(await edashApiFetch("/alerts/active"));
        const list = Array.isArray(raw) ? raw : (raw?.alerts || raw?.data || []);

        PO_POI_API_FAILED = false;
        if (!Array.isArray(list) || !list.length) { PO_POI_REAL_LIST = null; return; }

        PO_POI_REAL_LIST = list.slice(0, 8).map((a) => ({
            type: PO_ALERT_SEVERITY_TO_POI_TYPE[a.severity] || "status",
            site: a.deviceName || a.systemName || a.title || "—",
            region: a.projectName || a.location || "",
            date: poFormatAlertDate(a.createdAt || a.triggeredAt)
        }));
    } catch (err) {
        // Endpoint belum ada di backend (404 NOT_FOUND) atau error lain —
        // tandai gagal supaya poRenderPoiList() menampilkan pesan error yang
        // jujur, bukan diam-diam kosong atau data contoh/dummy.
        console.warn("[dashboard] GET /alerts gagal:", err.message, `(code: ${err.code || "-"})`);
        PO_POI_REAL_LIST = null;
        PO_POI_API_FAILED = true;
    }
}

// Entry point tunggal dipanggil dari initDashboardPage() dan tombol
// Refresh SETELAH poInitProjects() berhasil dari API asli (lihat
// PO_USING_API) — mengumpulkan device id dari semua proyek lalu menarik
// kurva hari-ini, data mingguan dan POI sekaligus secara paralel.
async function poLoadRealTelemetryExtras() {

    const projectsWithId = PO_PROJECTS.filter((p) => p.id);

    if (!projectsWithId.length) {
        PO_TODAY_REAL_CURVE = null;
        PO_WEEKLY_REAL_DATA = null;
    } else {
        // Pakai UUID backend asli (p.apiId) buat GET /projects/:id di sini,
        // BUKAN p.id -- p.id proyek Tawabi sekarang literal "tawabi" (lihat
        // komentar `isTawabi` di poProjectFromApi), yang bukan UUID valid
        // dan akan 404 kalau dipakai langsung ke endpoint ini.
        const deviceIdLists = await Promise.all(
            projectsWithId.map((p) => poFetchProjectDeviceIds(p.apiId || p.id, p.name))
        );
        const allDeviceIds = Array.from(new Set(deviceIdLists.flat()));

        await Promise.all([
            poLoadTodayRealCurve(allDeviceIds),
            poLoadWeeklyRealData(allDeviceIds)
        ]);
    }

    await poLoadPoiFromAlerts();

}

// "Points of Interest" — replace with real maintenance/permit/installation
// events from the backend. Site/region values reference PO_PROJECTS
// above so they line up with the same projects shown on the map.
const PO_POI_TYPES = {
    repair:       { label: "Upcoming Repair",        icon: "fa-solid fa-triangle-exclamation", color: "var(--po-danger)",  bg: "var(--po-danger-soft)" },
    maintenance:  { label: "Scheduled Maintenance",   icon: "fa-solid fa-screwdriver-wrench",   color: "var(--po-warning)", bg: "var(--po-warning-soft)" },
    permit:       { label: "Awaiting Permit",         icon: "fa-solid fa-file-signature",       color: "var(--po-info)",    bg: "var(--po-info-soft)" },
    installation: { label: "Installation Scheduled",  icon: "fa-solid fa-helmet-safety",        color: "var(--po-success)", bg: "var(--po-success-soft)" },
    status:       { label: "Status Update",           icon: "fa-solid fa-circle-info",          color: "var(--po-primary)", bg: "var(--po-primary-soft)" }
};

// This-week vs last-week generation, Monday to Sunday.
// Keep the weekday key language-neutral; the visible label is localized
// when the chart is rendered so it also updates when EN/ID is switched.

const PO_WEEKDAY_LABELS = {
    en: { Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu", Fri: "Fri", Sat: "Sat", Sun: "Sun" },
    id: { Mon: "Sen", Tue: "Sel", Wed: "Rab", Thu: "Kam", Fri: "Jum", Sat: "Sab", Sun: "Min" }
};

function poGetWeekdayLabel(day) {
    const lang = (typeof getSavedLanguage === "function" ? getSavedLanguage() : localStorage.getItem("edash-lang") || "en");
    return PO_WEEKDAY_LABELS[lang]?.[day] || PO_WEEKDAY_LABELS.en[day] || day;
}

// Cumulative Installed Capacity / Emissions Avoided.
//
// Previously this had 3 fictional "product lines" (EaaS / Solar Bubbler /
// Melasa Microgrid), then a 2022-current ramp curve to fake a multi-year
// trend. Neither is real: the API (GET /api/v1/projects/:id/analytics,
// DOKUMENTASI_API_eDASHBOARD_360ENERGY sec. 5.2) only returns a CURRENT
// snapshot — no per-year history exists in the backend at all.
//
// This still shows a 2022-current axis for the bar chart's shape, but
// years with no real backend history are shown as an HONEST ZERO instead
// of a fabricated ramp value — only the CURRENT year gets the real
// cumulative total (as of today) for each real project category present
// in PO_PROJECTS (live API data or its fallback). Once the backend
// adds a real per-year analytics endpoint, replace the zeros for past
// years with the actual per-year figures it returns.
const PO_TREND_START_YEAR = 2022;

function poGetTrendYears() {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = PO_TREND_START_YEAR; y <= currentYear; y += 1) years.push(y);
    return years;
}

function poBuildTrendData() {

    const trendYears = poGetTrendYears();
    const currentYear = trendYears[trendYears.length - 1];

    // Sum real capacity/CO2 per category from the currently-loaded project
    // list (includes PLTS Tawabi + the PNJ sites, whichever categories are
    // actually present) instead of hardcoded product-line names.
    const totalsByCategory = {};
    PO_PROJECTS.forEach((p) => {
        if (!p.category) return;
        const key = poCategoryKey(p.category);
        if (!totalsByCategory[key]) {
            totalsByCategory[key] = { capacityMWp: 0, co2AvoidedT: 0 };
        }
        totalsByCategory[key].capacityMWp += p.capacityMWp || 0;
        totalsByCategory[key].co2AvoidedT += p.co2AvoidedT || 0;
    });

    const categories = Object.keys(totalsByCategory)
        .filter((key) => totalsByCategory[key].capacityMWp > 0)
        .map((key) => ({
            key,
            label: PO_CATEGORY_LABELS[key] || key,
            color: PO_CATEGORY_COLORS[key] || "#7c8b8d"
        }));

    // Only currentYear gets the real number; every earlier year is an
    // honest 0 (no fabricated ramp) since there's no real history to show.
    const capacityData = trendYears.map((year) => {
        const row = { year };
        categories.forEach((c) => {
            row[c.key] = year === currentYear ? +(totalsByCategory[c.key].capacityMWp).toFixed(2) : 0;
        });
        return row;
    });

    const emissionsData = trendYears.map((year) => {
        const row = { year };
        categories.forEach((c) => {
            row[c.key] = year === currentYear ? Math.round(totalsByCategory[c.key].co2AvoidedT) : 0;
        });
        return row;
    });

    return { categories, capacityData, emissionsData };

}

// =============================
// Map stats (Projects / MWh / MWp / CO2)
// =============================

function poRenderMapStat() {

    const all = PO_PROJECTS.length;
    const totalMWh = PO_PROJECTS.reduce((sum, p) => sum + (p.generatedMWh || 0), 0);
    const totalMWp = PO_PROJECTS.reduce((sum, p) => sum + (p.capacityMWp || 0), 0);
    const totalCO2 = PO_PROJECTS.reduce((sum, p) => sum + (p.co2AvoidedT || 0), 0);
    // Real per-project daily target (from analytics.mlMetrics.expectedEnergyTodayKwh,
    // or the capacity-based estimate as fallback — see poProjectFromApi /
    // poProjectFromJson) summed across the CURRENT project list, instead of
    // the old hardcoded PO_DAILY_TARGET_MWH = 52.4 constant.
    const totalTargetMWh = PO_PROJECTS.reduce((sum, p) => sum + (p.targetMWh || 0), 0);

    const countEl = document.getElementById("poMapCount");
    const mwhEl = document.getElementById("poMapMWh");
    const mwpEl = document.getElementById("poMapMWp");
    const co2El = document.getElementById("poMapCO2");

    if (countEl) countEl.textContent = all;
    if (mwhEl) mwhEl.textContent = totalMWh.toFixed(1);
    if (mwpEl) mwpEl.textContent = totalMWp.toFixed(2);
    if (co2El) co2El.textContent = totalCO2.toFixed(1);

    return { totalMWh, totalTargetMWh };

}

// =============================
// Project summary (All Projects / Online / Offline / Active Alerts)
// -- disamakan dengan psRenderSummary() di js/project-selector.js.
// =============================

function poRenderSummary() {

    const all = PO_PROJECTS.length;
    const online = PO_PROJECTS.filter((p) => p.status === "online").length;
    const offline = all - online;
    const alerts = PO_PROJECTS.reduce((sum, p) => sum + (Number(p.alerts) || 0), 0);

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setVal("poSummaryAll", all);
    setVal("poSummaryOnline", online);
    setVal("poSummaryOffline", offline);
    setVal("poSummaryAlerts", alerts);

}

// =============================
// Category legend
// =============================

// TKT-000045: toggle "Show all" di sebelah judul "CATEGORY" pada
// widget Dashboard. Default false (unchecked) = kategori dengan 0
// proyek disembunyikan, sama seperti perilaku di Project Selector.
let poShowAllCategories = false;

function poRenderLegend() {

    const el = document.getElementById("poLegendList");
    if (!el) return;

    const counts = {};
    PO_CATEGORY_ORDER.forEach((key) => { counts[key] = 0; });
    PO_PROJECTS.forEach((p) => {
        const key = poCategoryKey(p.category);
        if (counts[key] !== undefined) counts[key] += 1;
    });

    const visibleKeys = poShowAllCategories
        ? PO_CATEGORY_ORDER
        : PO_CATEGORY_ORDER.filter((key) => counts[key] > 0);

    if (visibleKeys.length === 0) {
        el.innerHTML = `<div class="po-legend-empty">Belum ada proyek</div>`;
        return;
    }

    el.innerHTML = visibleKeys
        .map((key) => {

            const count = counts[key];
            const tint = PO_CATEGORY_TINTS[key] || {};

            const style = [
                `--cat-color:${PO_CATEGORY_COLORS[key]}`,
                `--cat-bg:${tint.bg || "#f7fafa"}`,
                `--cat-border:${tint.border || "#e7edee"}`,
                `--cat-icon-bg:${tint.iconBg || "#e4f1f1"}`
            ].join(";");

            return `
                <div class="po-legend-row" style="${style}">
                    <span class="po-legend-icon"><i class="${PO_CATEGORY_ICONS[key]}"></i></span>
                    <div class="po-legend-info">
                        <span class="po-legend-count">${count}</span>
                        <span class="po-legend-label">${PO_CATEGORY_LABELS[key]}</span>
                    </div>
                </div>
            `;

        })
        .join("");

}

// =============================
// "Today" generation chart (projected vs realized)
// =============================

function poGenerationCurve() {

    const points = [];

    for (let h = 0; h <= 24; h += 1) {
        const inDaylight = h >= 6 && h <= 18;
        const value = inDaylight ? Math.sin(Math.PI * (h - 6) / 12) : 0;
        points.push(Math.max(0, value));
    }

    return points;

}

function poRenderTodayChart(totalGeneratedMWh, totalTargetMWh) {

    const wrap = document.getElementById("poTodayChartWrap");
    const valueEl = document.getElementById("poTodayValue");
    const targetEl = document.getElementById("poTodayTarget");

    if (!wrap) return;

    const width = 520, height = 180, padLeft = 46, padTop = 10, padBottom = 22;
    const baseline = height - padBottom;
    // Selalu dipakai sebagai kurva proyeksi (garis putus-putus oranye) —
    // envelope bel teoretis siang hari, terlepas dari ada tidaknya data real.
    const curve = poGenerationCurve();

    const now = new Date();
    const nowHour = now.getHours() + now.getMinutes() / 60;

    const toXY = (h, value) => [
        padLeft + (h / 24) * (width - padLeft - 10),
        baseline - value * (height - padTop - padBottom)
    ];

    const projectedPts = curve.map((value, h) => toXY(h, value));
    const projectedPath = "M " + projectedPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ");

    let realizedHours;
    // peakKw dipakai juga buat label sumbu-Y (lihat yAxisLabels di bawah) —
    // dideklarasikan di luar blok if supaya tetap kebaca di luar situ.
    let peakKw = 0;

    if (PO_TODAY_REAL_CURVE && PO_TODAY_REAL_CURVE.length) {
        // REAL: garis solid teal mengikuti telemetri sungguhan dari
        // GET /devices/:id/telemetry/history (lihat poLoadTodayRealCurve).
        // Dinormalkan terhadap puncak kW yang benar-benar terekam hari ini
        // supaya BENTUK garisnya nyata; skala sumbu-Y memang relatif
        // terhadap puncak itu, sama seperti kurva proyeksi di sebelahnya.
        peakKw = Math.max(...PO_TODAY_REAL_CURVE.map((p) => p.kw), 0.001);
        realizedHours = PO_TODAY_REAL_CURVE
            .filter((p) => p.h <= nowHour)
            .map((p) => ({ h: p.h, value: p.kw / peakKw }));
        if (!realizedHours.length) realizedHours = [{ h: nowHour, value: 0 }];
    } else {
        // BELUM ADA histori real (device belum pernah lapor overview.currentPower
        // ke ThingsBoard — lihat poLoadTodayRealCurve). SEBELUMNYA di sini dipakai
        // pola sinus sintetis biar "keliatan ada produksi", tapi itu menyesatkan:
        // grafik jadi nunjukkin gunung mulus yang sebenarnya bukan data device
        // manapun. Sekarang ditampilkan JUJUR: garis datar di 0 dari jam 00:00
        // sampai sekarang. Begitu device mulai kirim data & poLoadTodayRealCurve
        // berhasil ngisi PO_TODAY_REAL_CURVE (tiap load/refresh dashboard selalu
        // dicoba ulang), cabang "REAL" di atas otomatis kepakai — tidak perlu
        // ubah kode ini lagi.
        realizedHours = [
            { h: 0, value: 0 },
            { h: nowHour, value: 0 }
        ];
    }

    const realizedPts = realizedHours.map((point) => toXY(point.h, point.value));
    const realizedLinePath = "M " + realizedPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ");
    const lastPt = realizedPts[realizedPts.length - 1];
    const firstPt = realizedPts[0];
    const realizedAreaPath = `${realizedLinePath} L ${lastPt[0].toFixed(1)},${baseline} L ${firstPt[0].toFixed(1)},${baseline} Z`;

    const nowX = toXY(nowHour, 0)[0];

    const gridLines = [0, 6, 12, 18, 24].map((h) => {
        const x = toXY(h, 0)[0];
        return `
            <line x1="${x.toFixed(1)}" y1="${padTop}" x2="${x.toFixed(1)}" y2="${baseline}" stroke="#eef2f2" stroke-width="1"></line>
            <text x="${x.toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="9" fill="#b6c2c3">${String(h).padStart(2, "0")}:00</text>
        `;
    }).join("");

    // Label sumbu-Y: 5 tick (0%, 25%, 50%, 75%, 100% dari puncak hari ini).
    // Kalau sudah ada histori real (peakKw > 0) angkanya ditampilkan dalam
    // kW terhadap puncak itu; kalau belum ada data sama sekali dibiarkan
    // dalam persen supaya tidak mengarang angka kW yang tidak nyata.
    // Satuan (kW / %) ditulis di SETIAP angka, bukan cuma sekali di atas.
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const [, y] = toXY(0, frac);
        const value = peakKw > 0
            ? (peakKw * frac).toFixed(peakKw * frac < 10 ? 1 : 0)
            : Math.round(frac * 100);
        const label = peakKw > 0 ? `${value} kW` : `${value}%`;
        return `
            <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${(width - 10).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#f3f6f6" stroke-width="1"></line>
            <text x="${(padLeft - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#b6c2c3">${label}</text>
        `;
    }).join("");
    wrap.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
            ${yTicks}
            ${gridLines}
            <path d="${realizedAreaPath}" fill="#0f6a71" opacity="0.12"></path>
            <path d="${projectedPath}" fill="none" stroke="#FA891A" stroke-width="1.8" stroke-dasharray="5 4" stroke-linecap="round"></path>
            <path d="${realizedLinePath}" fill="none" stroke="#0f6a71" stroke-width="2.4" stroke-linecap="round"></path>
            <line x1="${nowX.toFixed(1)}" y1="${padTop}" x2="${nowX.toFixed(1)}" y2="${baseline}" stroke="#25343F" stroke-width="1" stroke-dasharray="2 2" opacity="0.3"></line>
            <circle cx="${lastPt[0].toFixed(1)}" cy="${lastPt[1].toFixed(1)}" r="3.5" fill="#0f6a71"></circle>
        </svg>
    `;

    // Real target = sum of each project's own targetMWh (from the API's
    // mlMetrics.expectedEnergyTodayKwh, or the capacity-based fallback —
    // see poProjectFromApi). Falls back to the old fixed 52.4 MWh ONLY if
    // the current project list has no usable target at all (e.g. totally
    // empty project list), so the panel never shows "0% of 0 MWh".
    const effectiveTarget = totalTargetMWh > 0 ? totalTargetMWh : PO_DAILY_TARGET_MWH;
    const percentOfTarget = Math.round((totalGeneratedMWh / effectiveTarget) * 100);

    if (valueEl) valueEl.innerHTML = `${totalGeneratedMWh.toFixed(1)}<span>MWh</span>`;
    if (targetEl) targetEl.textContent = `${percentOfTarget}% of ${effectiveTarget.toFixed(1)} MWh target`;

}

// =============================
// Weekly Analysis (this week vs last week)
// =============================

function poRenderWeeklyChart() {

    const wrap = document.getElementById("poWeeklyChartWrap");
    const valueEl = document.getElementById("poWeeklyValue");
    const deltaEl = document.getElementById("poWeeklyDelta");

    if (!wrap) return;

    // REAL: pakai data hasil agregasi GET /devices/:id/telemetry/history
    // (lihat poLoadWeeklyRealData). Kalau belum tersedia (API belum jalan/
    // device belum ada histori), tampilkan pesan kosong yang jujur --
    // JANGAN pakai angka contoh/dummy lagi.
    if (!PO_WEEKLY_REAL_DATA || !PO_WEEKLY_REAL_DATA.length) {
        wrap.innerHTML = `
            <div class="po-weekly-empty" style="padding:16px;text-align:center;opacity:.6;font-size:13px;">
                Data mingguan belum tersedia dari server.
            </div>
        `;
        if (valueEl) valueEl.innerHTML = `0.0<span>MWh</span>`;
        if (deltaEl) deltaEl.textContent = "";
        return;
    }
    const weeklyData = PO_WEEKLY_REAL_DATA;

    const maxValue = Math.max(...weeklyData.flatMap((d) => [d.thisWeek, d.lastWeek]));
    // Guard: kalau semua nilai 0 (device belum ada histori — lihat
    // poLoadWeeklyRealData), niceMax jangan ikut 0, supaya perhitungan
    // tinggi bar (value / niceMax) tidak jadi NaN dan bikin grafik blank.
    const niceMax = Math.max(Math.ceil(maxValue / 10) * 10, 10);

    const width = 520, height = 180, padLeft = 30, padTop = 10, padBottom = 22;
    const chartW = width - padLeft - 10;
    const chartH = height - padTop - padBottom;
    const groupW = chartW / weeklyData.length;
    const barW = groupW * 0.3;
    const barGap = groupW * 0.08;

    const steps = 4;
    const gridLines = Array.from({ length: steps + 1 }, (_, i) => {
        const value = (niceMax / steps) * i;
        const y = padTop + chartH - (value / niceMax) * chartH;
        return `
            <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width}" y2="${y.toFixed(1)}" stroke="#eef2f2" stroke-width="1"></line>
            <text x="${(padLeft - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#b6c2c3">${value.toFixed(0)}</text>
        `;
    }).join("");

    const bars = weeklyData.map((d, i) => {

        const groupX = padLeft + i * groupW;
        const lastH = (d.lastWeek / niceMax) * chartH;
        const thisH = (d.thisWeek / niceMax) * chartH;
        const lastX = groupX + (groupW - barW * 2 - barGap) / 2;
        const thisX = lastX + barW + barGap;
        const lastY = padTop + chartH - lastH;
        const thisY = padTop + chartH - thisH;

        return `
            <rect x="${lastX.toFixed(1)}" y="${lastY.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(lastH, 1).toFixed(1)}" rx="3" fill="#3E7CB1"></rect>
            <rect x="${thisX.toFixed(1)}" y="${thisY.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(thisH, 1).toFixed(1)}" rx="3" fill="#7C5CE0"></rect>
            <text x="${(groupX + groupW / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="9" fill="#7c8b8d">${poGetWeekdayLabel(d.day)}</text>
        `;

    }).join("");

    wrap.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
            ${gridLines}
            ${bars}
        </svg>
    `;

    const totalThis = weeklyData.reduce((sum, d) => sum + d.thisWeek, 0);
    const totalLast = weeklyData.reduce((sum, d) => sum + d.lastWeek, 0);
    const deltaPct = totalLast ? Math.round(((totalThis - totalLast) / totalLast) * 100) : 0;

    if (valueEl) valueEl.innerHTML = `${totalThis.toFixed(1)}<span>MWh</span>`;

    if (deltaEl) {
        deltaEl.textContent = `${deltaPct >= 0 ? "+" : ""}${deltaPct}% vs last week`;
        deltaEl.classList.toggle("is-up", deltaPct >= 0);
        deltaEl.classList.toggle("is-down", deltaPct < 0);
    }

}

// =============================
// Top Performing Sites
// =============================

function poRenderSitesList() {

    const el = document.getElementById("poSitesList");
    if (!el) return;

    // "Top Performing Sites" itu soal seberapa banyak ENERGI yang
    // dihasilkan hari ini (generatedMWh), BUKAN soal apakah proyeknya lagi
    // live/online detik ini juga. Sebelumnya di-filter status==="online"
    // (currentPowerKw > 0) — tapi itu keliru: proyek yang sudah generate
    // energi banyak hari ini (misal Tawabi: 95.3 kWh) tapi live power-nya
    // kebetulan 0 pas di-cek (malam / device sesaat idle) jadi ke-exclude
    // total dari sini, padahal jelas "performing". Filter yang benar untuk
    // list ini: proyeknya sudah pernah generate energi (generatedMWh > 0),
    // bukan status real-time-nya.
    const top = [...PO_PROJECTS]
        .filter((p) => p.generatedMWh > 0)
        .sort((a, b) => b.generatedMWh - a.generatedMWh)
        .slice(0, 10);

    el.innerHTML = top
        .map((p, i) => {

            const percent = p.targetMWh > 0
                ? Math.round((p.generatedMWh / p.targetMWh) * 100)
                : null;
            const tint = PO_CATEGORY_TINTS[p.category] || {};
            const style = [
                `--cat-color:${PO_CATEGORY_COLORS[p.category]}`,
                `--cat-icon-bg:${tint.iconBg || "#e4f1f1"}`
            ].join(";");

            return `
                <div class="po-site-row">
                    <span class="po-site-rank">${i + 1}</span>
                    <span class="po-site-icon" style="${style}"><i class="${PO_CATEGORY_ICONS[p.category]}"></i></span>
                    <div class="po-site-info">
                        <div class="po-site-name">${p.name}</div>
                        <div class="po-site-region">${p.region}</div>
                    </div>
                    <div class="po-site-metric">
                        <div class="po-site-value">${p.generatedMWh.toFixed(1)} MWh</div>
                        <div class="po-site-percent">${percent === null ? "Belum ada inverter terdaftar" : `${percent}% of target`}</div>
                    </div>
                </div>
            `;

        })
        .join("");

}

// =============================
// Points of Interest
// =============================

function poRenderPoiList() {

    const el = document.getElementById("poPoiList");
    if (!el) return;

    // REAL: alarm aktif dari GET /api/v1/alerts (lihat poLoadPoiFromAlerts).
    // Kalau endpoint itu GAGAL (404/error) -> tampilkan pesan jujur, JANGAN
    // pakai data contoh/dummy (nanti dikira alarm sungguhan).
    if (PO_POI_API_FAILED) {
        el.innerHTML = `
            <div class="po-poi-empty" style="padding:16px;text-align:center;opacity:.6;font-size:13px;">
                Data alarm belum tersedia dari server.
            </div>
        `;
        return;
    }

    if (!PO_POI_REAL_LIST || !PO_POI_REAL_LIST.length) {
        el.innerHTML = `
            <div class="po-poi-empty" style="padding:16px;text-align:center;opacity:.6;font-size:13px;">
                Tidak ada alarm aktif saat ini.
            </div>
        `;
        return;
    }

    const poiList = PO_POI_REAL_LIST;

    el.innerHTML = poiList
        .map((item) => {

            const meta = PO_POI_TYPES[item.type] || PO_POI_TYPES.status;
            const style = [`--poi-color:${meta.color}`, `--poi-bg:${meta.bg}`].join(";");

            return `
                <div class="po-poi-row">
                    <span class="po-poi-icon" style="${style}"><i class="${meta.icon}"></i></span>
                    <div class="po-poi-info">
                        <div class="po-poi-title">${meta.label}</div>
                        <div class="po-poi-site">${item.site}</div>
                        <div class="po-poi-region">${item.region}</div>
                    </div>
                    <div class="po-poi-date">${item.date}</div>
                </div>
            `;

        })
        .join("");

}

// =============================
// Installed Capacity / Emissions Avoided (stacked bar, shared renderer)
// =============================

function poFormatCompact(value) {
    if (Math.abs(value) >= 1000) return (value / 1000).toFixed(1) + "k";
    return value.toFixed(value < 10 ? 2 : 1);
}

function poDownloadCSV(filename, data, categories) {

    const header = ["Year", ...categories.map((c) => c.label), "Total"].join(",");

    const rows = data.map((d) => {
        const values = categories.map((c) => d[c.key] || 0);
        const total = values.reduce((sum, v) => sum + v, 0);
        return [d.year, ...values, total].join(",");
    });

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

}

function poRenderTrendChart({ wrapId, legendId, data, categories, unit, downloadBtnId, filename }) {

    const wrap = document.getElementById(wrapId);
    const legendEl = document.getElementById(legendId);
    if (!wrap) return;

    const totals = data.map((d) => categories.reduce((sum, c) => sum + (d[c.key] || 0), 0));
    const maxTotal = Math.max(...totals);
    const niceMax = maxTotal * 1.15;

    const width = 560, height = 220, padLeft = 6, padTop = 24, padBottom = 24;
    const chartW = width - padLeft - 6;
    const chartH = height - padTop - padBottom;
    const barGap = 8;
    const barW = Math.max(10, (chartW - barGap * (data.length - 1)) / data.length);

    const bars = data.map((d, i) => {

        const x = padLeft + i * (barW + barGap);
        let yCursor = padTop + chartH;

        const segments = categories.map((cat) => {
            const value = d[cat.key] || 0;
            const segH = (value / niceMax) * chartH;
            const y = yCursor - segH;
            yCursor = y;
            return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(segH, 0.5).toFixed(1)}" fill="${cat.color}"></rect>`;
        }).join("");

        const topY = yCursor;

        return `
            ${segments}
            <text x="${(x + barW / 2).toFixed(1)}" y="${(topY - 6).toFixed(1)}" text-anchor="middle" font-size="8" fill="#7c8b8d">${poFormatCompact(totals[i])}</text>
            <text x="${(x + barW / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="8.5" fill="#7c8b8d">${d.year}</text>
        `;

    }).join("");

    wrap.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
            ${bars}
        </svg>
    `;

    if (legendEl) {

        const grandTotal = totals[totals.length - 1];

        legendEl.innerHTML = categories
            .map((cat) => {
                const latestValue = data[data.length - 1][cat.key] || 0;
                return `
                    <span class="po-trend-legend-item">
                        <span class="po-trend-legend-dot" style="background:${cat.color}"></span>
                        ${cat.label}: <span class="po-trend-legend-value">${poFormatCompact(latestValue)}${unit}</span>
                    </span>
                `;
            })
            .join("") + `
                <span class="po-trend-legend-item">
                    Total: <span class="po-trend-legend-value">${poFormatCompact(grandTotal)}${unit}</span>
                </span>
            `;

    }

    const downloadBtn = document.getElementById(downloadBtnId);
    if (downloadBtn && !downloadBtn._bound) {
        downloadBtn._bound = true;
        downloadBtn.addEventListener("click", () => poDownloadCSV(filename, data, categories));
    }

}

// =============================
// Refresh button
// =============================

function poBindRefresh() {

    const showAllToggle = document.getElementById("poShowAllCategories");
    if (showAllToggle && !showAllToggle._bound) {
        showAllToggle._bound = true;
        showAllToggle.checked = poShowAllCategories;
        showAllToggle.addEventListener("change", () => {
            poShowAllCategories = showAllToggle.checked;
            poRenderLegend();
        });
    }

    const btn = document.getElementById("poRefreshBtn");
    if (!btn || btn._bound) return;
    btn._bound = true;

    btn.addEventListener("click", async () => {

        const pageEl = document.querySelector(".po-page");

        btn.classList.add("is-loading");
        if (pageEl) pageEl.classList.add("is-refreshing");

        try {

            // Re-fetch from the live API (or the static fallback, see
            // poInitProjects) so "Refresh" actually pulls the latest data,
            // not just re-draws the same numbers.
            await poInitProjects();

            // Today curve / Weekly chart / POI only make sense against
            // real project ids, hence gated on PO_USING_API (set inside
            // poLoadProjectsFromApi).
            if (PO_USING_API) {
                await poLoadRealTelemetryExtras();
            }

            poRenderAll();

        } finally {

            btn.classList.remove("is-loading");
            if (pageEl) pageEl.classList.remove("is-refreshing");

        }

    });

}

// =============================
// Map (MapLibre GL JS + OpenFreeMap streets — same basemap style and pin
// markers used on the Project Selector page, for a consistent map look)
// =============================

function poCreatePinEl(color) {

    const el = document.createElement("div");
    el.className = "ps-pin-wrap";
    el.innerHTML = `<span class="ps-pin" style="--pin-color:${color}"></span>`;
    return el;

}

function poInitMap() {

    const mapEl = document.getElementById("poMap");
    if (!mapEl || typeof maplibregl === "undefined") return;

    // Avoid double initialization when navigating away and back to this page
    if (mapEl._maplibreMap) return;

    // Kalau halaman ini dibuka lewat navigasi SPA (bukan reload penuh
    // browser), #poMap kadang masih berukuran 0x0 di frame ini karena
    // layout/transisi container-nya belum selesai. Membuat instance
    // MapLibre di container 0x0 membuat WebGL context-nya gagal
    // permanen — resize() belakangan tidak bisa memperbaikinya lagi.
    // Solusinya: tunda pembuatan peta sampai container benar-benar
    // sudah punya ukuran nyata (sama seperti fix di project-selector.js).
    let poInitMapAttempts = 0;
    const tryCreateMap = () => {

        if (!document.body.contains(mapEl)) return; // halaman sudah ditinggalkan lagi

        if ((mapEl.offsetWidth === 0 || mapEl.offsetHeight === 0) && poInitMapAttempts < 300) {
            poInitMapAttempts += 1;
            requestAnimationFrame(tryCreateMap);
            return;
        }

        poCreateMapInstance(mapEl);

    };

    tryCreateMap();

}

function poCreateMapInstance(mapEl) {

    // MapLibre memakai WebGL, dan browser membatasi jumlah context WebGL
    // yang boleh hidup bersamaan (biasanya ~8-16). Kalau instance peta
    // SEBELUMNYA (dari kunjungan ke halaman ini sebelum ini) tidak pernah
    // di-.remove(), context WebGL-nya cuma "ditinggal" — bukan langsung
    // dibuang — dan lama-lama menghabiskan slot context itu sampai
    // instance peta yang baru gagal render sama sekali (makanya perlu
    // refresh browser buat "reset" semua context lama). Buang instance
    // lama secara eksplisit di sini sebelum bikin yang baru.
    if (PO_MAP_INSTANCE) {
        try { PO_MAP_INSTANCE.remove(); } catch (e) { /* sudah dilepas / rusak, abaikan */ }
        PO_MAP_INSTANCE = null;
    }

    const map = new maplibregl.Map({
        container: mapEl,
        style: PO_STREET_STYLE_URL,
        center: [PO_INITIAL_CENTER[1], PO_INITIAL_CENTER[0]], // MapLibre: [lng, lat]
        zoom: PO_INITIAL_ZOOM,
        scrollZoom: false,
        dragRotate: false,
        touchPitch: false,
        attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    mapEl._maplibreMap = map;
    PO_MAP_EL = mapEl;

    PO_MAP_INSTANCE = map;

    map.on("load", () => {

        PO_PROJECTS.forEach((project) => {

            const color = PO_CATEGORY_COLORS[project.category];
            const el = poCreatePinEl(color);

            new maplibregl.Marker({ element: el, anchor: "bottom" })
                .setLngLat([project.lng, project.lat])
                .addTo(map);

            const tooltip = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                offset: 30,
                className: "ps-pin-tooltip"
            }).setHTML(`<b>${project.name}</b><br>${PO_CATEGORY_LABELS[project.category]}`);

            el.addEventListener("mouseenter", () => {
                tooltip.setLngLat([project.lng, project.lat]).addTo(map);
            });
            el.addEventListener("mouseleave", () => tooltip.remove());

        });

    });

    // Container-nya masih bisa berubah ukuran setelahnya (sidebar toggle,
    // dst.) — ResizeObserver memastikan resize() selalu dipanggil ulang
    // tiap kali ukuran nyata container berubah, kapan pun itu terjadi.
    if (PO_MAP_RESIZE_OBSERVER) {
        PO_MAP_RESIZE_OBSERVER.disconnect();
        PO_MAP_RESIZE_OBSERVER = null;
    }
    if (typeof ResizeObserver !== "undefined") {
        PO_MAP_RESIZE_OBSERVER = new ResizeObserver(() => {
            if (PO_MAP_INSTANCE) PO_MAP_INSTANCE.resize();
        });
        PO_MAP_RESIZE_OBSERVER.observe(mapEl);
    }

    setTimeout(() => map.resize(), 200);

    // Buang peta ini SEGERA begitu halaman ditinggalkan (bukan menunggu
    // sampai halaman ini dibuka lagi lain kali) — main.js mengganti
    // #page-root.innerHTML setiap kali route berpindah, jadi mutasi pada
    // #page-root adalah sinyal paling awal & paling andal bahwa halaman
    // ini sudah tidak aktif lagi.
    if (!PO_PAGE_ROOT_OBSERVER) {
        const pageRoot = document.getElementById("page-root");
        if (pageRoot && typeof MutationObserver !== "undefined") {
            PO_PAGE_ROOT_OBSERVER = new MutationObserver(() => {
                if (PO_MAP_EL && !document.body.contains(PO_MAP_EL) && PO_MAP_INSTANCE) {
                    try { PO_MAP_INSTANCE.remove(); } catch (e) { /* abaikan */ }
                    PO_MAP_INSTANCE = null;
                    PO_MAP_EL = null;
                    if (PO_MAP_RESIZE_OBSERVER) { PO_MAP_RESIZE_OBSERVER.disconnect(); PO_MAP_RESIZE_OBSERVER = null; }
                }
            });
            PO_PAGE_ROOT_OBSERVER.observe(pageRoot, { childList: true });
        }
    }

}

// Keep the map correctly sized whenever the sidebar collapses/expands
// (desktop icon-rail toggle) — without this, the map canvas stays at its
// old width and renders cropped until the window is manually resized.
let PO_MAP_INSTANCE = null;
let PO_MAP_RESIZE_OBSERVER = null;
let PO_PAGE_ROOT_OBSERVER = null; // deteksi kapan #poMap dilepas dari DOM (pindah halaman) supaya WebGL context-nya dibuang, bukan cuma "ditinggal"
let PO_MAP_EL = null;             // referensi container peta yang sedang aktif, dipakai PO_PAGE_ROOT_OBSERVER
document.addEventListener("edash:sidebartoggle", () => {
    if (PO_MAP_INSTANCE && document.getElementById("poMap")) {
        PO_MAP_INSTANCE.resize();
    }
});

// =============================
// Init
// =============================

function poRenderAll() {

    poRenderSummary();
    poRenderLegend();

    const { totalMWh, totalTargetMWh } = poRenderMapStat();
    poRenderTodayChart(totalMWh, totalTargetMWh);
    poRenderWeeklyChart();
    poRenderSitesList();
    poRenderPoiList();

}

// ============================================================
// poRenderDashboardAll() dipanggil 2x pas kunjungan pertama (poRenderAll
// dasar + charts) -- poBindRefresh()/poInitMap() SENGAJA tidak ikut di
// sini, itu pasang event listener & init peta MapLibre, cuma boleh jalan
// SEKALI per kunjungan halaman (lihat initDashboardPage()).
// ============================================================
function poRenderDashboardAll() {

    poRenderAll();

    const { categories: poTrendCategories, capacityData: poCapacityData, emissionsData: poEmissionsData } = poBuildTrendData();

    poRenderTrendChart({
        wrapId: "poCapacityChartWrap",
        legendId: "poCapacityLegend",
        data: poCapacityData,
        categories: poTrendCategories,
        unit: " MWp",
        downloadBtnId: "poCapacityDownload",
        filename: "installed-capacity.csv"
    });

    poRenderTrendChart({
        wrapId: "poEmissionsChartWrap",
        legendId: "poEmissionsLegend",
        data: poEmissionsData,
        categories: poTrendCategories,
        unit: " T",
        downloadBtnId: "poEmissionsDownload",
        filename: "emissions-avoided.csv"
    });

}

const PO_STALE_CACHE_KEY = "dashboard:overview";

// Sama seperti pdRealDataLoadedOnce di project-detail.js -- kunjungan
// PERTAMA saja yang genuinely fetch+loading bar. Sesudahnya (pindah tab
// lain lalu balik ke Dashboard) SKIP TOTAL fetch-nya, langsung render
// instan dari state yang sudah ada di memori, tanpa indikator apapun.
// (Sebelumnya pola SWR: selalu fetch ulang diam-diam di belakang layar
// tiap kunjungan -- itu "aman" tapi tetap kerasa "loading lagi" karena
// selalu ada network activity + kadang keliatan pita "Memperbarui...".)
let poDataLoadedOnce = false;

async function initDashboardPage() {

    const containerEl = document.getElementById("page-root") || document.body;

    if (poDataLoadedOnce) {
        poRenderDashboardAll();
        poBindRefresh();
        poInitMap();
        return;
    }

    if (window.EdashLoadingBar) {
        window.EdashLoadingBar.show(containerEl, PO_STALE_CACHE_KEY, "loading.dashboard");
    }

    try {
        // Load real project data — lihat poInitProjects(): kalau API gagal,
        // daftar proyek cuma dikosongkan (tidak ada fallback data statis/
        // dummy lagi). poInitProjects() sendiri tidak melempar error, jadi
        // try/catch di sini menangkap kegagalan yang lebih tidak terduga,
        // mis. poLoadRealTelemetryExtras() error di tengah jalan.
        await poInitProjects();

        // Today curve, Weekly chart dan POI panel dari device-level
        // telemetry + alerts — cuma kalau memang lagi pakai backend asli.
        if (PO_USING_API) {
            await poLoadRealTelemetryExtras();
        }
    } catch (err) {
        console.warn("[dashboard] Gagal memuat data dashboard:", err);
        // Tetap lanjut render apa adanya (list proyek kosong kalau API
        // benar-benar tidak terjangkau, lihat poInitProjects()) -- jangan
        // biarkan halaman blank selamanya.
    }

    poDataLoadedOnce = true;
    poRenderDashboardAll();

    if (window.EdashLoadingBar) {
        window.EdashLoadingBar.done(containerEl, PO_STALE_CACHE_KEY);
    }

    // Sekali per kunjungan PERTAMA halaman, bukan per render.
    poBindRefresh();
    poInitMap();

}

// Redraw the SVG weekly chart immediately when EN/ID is switched.
// Bind this once at script load (instead of waiting for dashboard init) so
// the chart always reacts to the global language-change event without
// requiring a page refresh. The short defer lets the DOM language update
// finish first before the SVG is rebuilt.
if (!window._poWeeklyLanguageListenerBound) {
    window._poWeeklyLanguageListenerBound = true;
    document.addEventListener("edash:languagechange", () => {
        const chartWrap = document.getElementById("poWeeklyChartWrap");
        if (!chartWrap) return;

        requestAnimationFrame(() => {
            poRenderWeeklyChart();
        });
    });

}