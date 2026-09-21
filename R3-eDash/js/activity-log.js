// ============================================================
// Activity Log — 360eDash
// ------------------------------------------------------------
// Halaman ini terhubung ke backend edashboard_api (Hono + PostgreSQL)
// lewat GET /activity-log (via edashApiFetch(), lihat js/api-config.js)
// — SATU log terpusat untuk seluruh aktivitas aplikasi (login, logout,
// admin calculator, solar calculator, export report, ticketing,
// settings). Tidak ada data dummy/static, dan TIDAK ADA penyimpanan
// lokal di file .json sama sekali di sini.
//
// Struktur data mentah dari API (lihat activity-log.service.ts di
// edashboard_api) di-map ke bentuk ALState.logs oleh
// alMapApiLogToViewModel() supaya seluruh logika render, filter,
// pagination, & export CSV di bawah ini tetap bekerja tanpa perlu
// diubah.
//
// "Tipe Aktivitas" di tabel & filter memakai 12 kategori tampilan
// (Login/Logout/Solar Calculator/Admin Calculator/Export Report/
// Visitors/Language/Change Theme/Change Password/Change Profile Info/
// Change Profile Photo/Ticketing) — beberapa eventType backend yang
// berbeda (mis. calculator_export, admin_calculator_export,
// project_report_export, atau ticket_submitted/ticket_edited/
// ticket_updated) sengaja dikelompokkan menjadi satu kategori tampilan
// ("Export Report" / "Ticketing") di tabel, karena isi Details-nya
// memang event-specific (lihat bagian J pada instruksi), bukan
// tabelnya.
//
// PENTING (konsistensi dengan tabel "Activity Summary" di atasnya,
// yang dibangun dari AM_ACTIVITIES/AM_ACTIVITY_MATCHERS lebih bawah):
// SETIAP eventType yang dikenal ALLOWED_EVENT_TYPES di backend harus
// punya pemetaan eksplisit di AL_EVENT_GROUP ini. Sebelumnya
// "page_visit" & "language_switch" (yang muncul sebagai baris
// "Visitors"/"Language" di Activity Summary) tidak dipetakan sama
// sekali di sini, sehingga jatuh ke fallback default dan malah
// tertampil sebagai "Export Report" di Activity History — dua tabel
// yang menunjukkan tipe berbeda untuk kejadian yang sama. Fallback
// sekarang diarahkan ke kategori "other" yang eksplisit (bukan
// menyamar jadi kategori lain) supaya kalau ada eventType baru di
// masa depan yang lupa dipetakan, itu langsung terlihat sebagai
// "Other" alih-alih diam-diam salah label.
// ============================================================

const ALState = {
    logs: [],
    filtered: [],
    page: 1,
    pageSize: 8,
    loading: false,
    loadError: false,
};

// ---------------------------------------------------------------
// 1. Sumber data — GET /api/activity, lalu di-map ke bentuk view
// ---------------------------------------------------------------

// Mengelompokkan eventType (raw, dari backend) ke kategori tampilan
// yang dipakai tabel/filter/stat card. Details modal tetap memakai
// eventType asli (event-specific), bukan grup ini.
const AL_EVENT_GROUP = {
    login: "login",
    logout: "logout",
    admin_calculator: "admin-calculator",
    admin_calculator_export: "export-report",
    calculator_calculate: "solar-calculator",
    calculator_export: "export-report",
    project_report_export: "export-report",
    page_visit: "visitors",
    language_switch: "language",
    // Ditambahkan supaya eventType dari Settings (Appearance/Profile/
    // Account) & Ticketing punya kategori sendiri-sendiri di kolom
    // "Activity Type", bukan jatuh ke fallback "Other" -- sebelumnya
    // kelima eventType di bawah ini TIDAK ada di AL_EVENT_GROUP sama
    // sekali, jadi selalu tampil sebagai "Other" di tabel Activity Log
    // walau backend sudah menerima & menyimpannya dengan benar.
    theme_change: "theme",
    password_change: "password",
    profile_update: "profile-info",
    profile_photo_update: "profile-photo",
    // ticket_submitted/edited/updated dikelompokkan jadi satu kategori
    // tampilan "Ticketing" (sama seperti calculator_export/
    // admin_calculator_export/project_report_export yang dikelompokkan
    // jadi satu "Export Report" di atas) -- isi Details modal tetap
    // event-specific lewat alBuildDetailHtml(), bukan tabelnya.
    ticket_submitted: "ticketing",
    ticket_edited: "ticketing",
    ticket_updated: "ticketing",
    // "Delete Ticket" & tombol Approve/Reject (js/ticketing.js) -- lihat
    // activity-log.service.ts ALLOWED_EVENT_TYPES & migration
    // 005_activity_log_ticket_events.sql. Dikelompokkan ke kategori
    // tampilan "Ticketing" yang sama seperti ticket_submitted/edited/
    // updated di atas.
    ticket_deleted: "ticketing",
    ticket_approved: "ticketing",
    ticket_rejected: "ticketing",
};

function alCountryFlagFromCode(code) {
    if (!code || code === "-" || code.length !== 2) return "";
    const points = [...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
    try {
        return String.fromCodePoint(...points);
    } catch (err) {
        return "";
    }
}

function alCountryMeta(countryName, countryCode) {
    if (!countryName || countryName === "-") {
        return { name: "-", flag: "" };
    }
    const known = AM_COUNTRY_META[countryCode];
    if (known) return { name: known.name, flag: known.flag };
    return { name: countryName, flag: alCountryFlagFromCode(countryCode) };
}

// Mengubah 1 log mentah dari API menjadi bentuk yang dipakai
// ALState.logs (sama persis dengan bentuk yang sebelumnya dipakai
// generator dummy) supaya alRenderTable/alApplyFilters/alRenderStats/
// alExportCsv/alPopulateCountryFilter tidak perlu diubah.
function alMapApiLogToViewModel(apiLog) {

    const countryMeta = alCountryMeta(apiLog.country, apiLog.countryCode);

    return {
        id: apiLog.id,
        timestamp: new Date(apiLog.timestamp),
        userName: apiLog.user || "Anonymous",
        userEmail: apiLog.userRole || "-",
        country: apiLog.countryCode || "-",
        countryName: countryMeta.name,
        countryFlag: countryMeta.flag,
        type: AL_EVENT_GROUP[apiLog.eventType] || "other",
        eventType: apiLog.eventType,
        status: apiLog.status === "failed" ? "failed" : "success",
        detail: apiLog.detail || "-",
        device: apiLog.device || "-",
        ip: apiLog.ip || "-",
        raw: apiLog,
    };

}

// Ambil log lewat edashApiFetch() ke backend Hono + PostgreSQL
// (edashboard_api, GET /activity-log, tabel activity_logs). Bentuk
// tiap item yang dikembalikan backend (id/eventType/timestamp/user/
// userRole/status/detail/country/countryCode/ip/device/data — lihat
// activity-log.service.ts di edashboard_api) dipetakan lewat
// alMapApiLogToViewModel() di atas.
async function alFetchLogs() {

    const apiLogs = await edashApiFetch("/activity-log");

    return (apiLogs || [])
        .map(alMapApiLogToViewModel)
        .sort((a, b) => b.timestamp - a.timestamp);

}

// ---------------------------------------------------------------
// 2. Formatting helpers
// ---------------------------------------------------------------

// Label "Visitors" & "Language" sengaja dipakai persis sama dengan teks
// kolom "Activity Type" pada tabel Activity Summary (lihat AM_ACTIVITIES
// lebih bawah) supaya kedua tabel konsisten untuk kejadian yang sama.
const AL_TYPE_META = {
    "login":              { label: "Login",            icon: "fa-right-to-bracket", css: "al-type-login" },
    "logout":             { label: "Logout",            icon: "fa-right-from-bracket", css: "al-type-logout" },
    "solar-calculator":   { label: "Solar Calculator",  icon: "fa-solar-panel",      css: "al-type-solar-calculator" },
    "admin-calculator":   { label: "Admin Calculator",  icon: "fa-calculator",       css: "al-type-admin-calculator" },
    "export-report":      { label: "Export Report",     icon: "fa-file-export",      css: "al-type-export-report" },
    "visitors":           { label: "Visitors",          icon: "fa-earth-americas",   css: "al-type-visitors" },
    "language":           { label: "Language",          icon: "fa-language",         css: "al-type-language" },
    // Kategori baru -- lihat AL_EVENT_GROUP di atas untuk pemetaan
    // eventType -> kategori tampilan ini.
    "theme":               { label: "Change Theme",         icon: "fa-circle-half-stroke", css: "al-type-theme" },
    "password":            { label: "Change Password",      icon: "fa-key",                css: "al-type-password" },
    "profile-info":        { label: "Change Profile Info",  icon: "fa-user-pen",           css: "al-type-profile-info" },
    "profile-photo":       { label: "Change Profile Photo", icon: "fa-image",              css: "al-type-profile-photo" },
    "ticketing":           { label: "Ticketing",            icon: "fa-ticket",             css: "al-type-ticketing" },
    "other":               { label: "Other",             icon: "fa-circle-question",  css: "al-type-other" },
};

function alFormatDate(date) {
    return date.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

function alFormatTime(date) {
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function alDateInputValue(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function alEscape(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// ---------------------------------------------------------------
// 3. Filtering
// ---------------------------------------------------------------

// Urutan value untuk multi-select "Activity Type" (sama seperti urutan
// checkbox di pages/activity-log.html #alTypeMsPanel). Dipakai untuk
// tahu apakah SEMUA tipe sedang tercentang (= "All Types", filter
// dilewati) dan untuk membangun teks tombol trigger-nya.
const AL_TYPE_FILTER_VALUES = [
    "login", "logout", "solar-calculator", "admin-calculator",
    "export-report", "visitors", "language", "theme", "password",
    "profile-info", "profile-photo", "ticketing", "other",
];

// Membaca state checkbox multi-select "Activity Type" langsung dari DOM
// (bukan disimpan duplikat di ALState) supaya UI checkbox selalu jadi
// satu-satunya sumber kebenaran -- sama pola dengan filter lain di
// toolbar ini yang juga dibaca langsung dari elemen form-nya.
function alGetSelectedTypes() {
    const items = [...document.querySelectorAll(".al-type-ms-item")];
    const checked = items.filter((cb) => cb.checked).map((cb) => cb.value);
    return { checked, total: items.length };
}

// Menyinkronkan tampilan tombol trigger ("All Types" / "Login" / "3
// Types Selected" / dst.) & state checkbox master "All Types"
// (checked/indeterminate) dengan checkbox individual yang sedang
// tercentang. Dipanggil setiap kali ada perubahan centang, dan juga
// saat bahasa EN/ID berganti (lihat listener edash:languagechange di
// bagian paling bawah file ini).
function alUpdateTypeMsUI() {

    const items = [...document.querySelectorAll(".al-type-ms-item")];
    const masterCb = document.getElementById("alTypeMsAll");
    const textEl = document.getElementById("alTypeMsText");
    if (!items.length || !textEl) return;

    const checkedItems = items.filter((cb) => cb.checked);
    const total = items.length;
    const isId = typeof getSavedLanguage === "function" && getSavedLanguage() === "id";

    if (masterCb) {
        masterCb.checked = checkedItems.length === total;
        masterCb.indeterminate = checkedItems.length > 0 && checkedItems.length < total;
    }

    if (checkedItems.length === total) {
        textEl.textContent = isId ? "Semua Tipe" : "All Types";
    } else if (checkedItems.length === 0) {
        textEl.textContent = isId ? "Tidak Ada Tipe Dipilih" : "No Types Selected";
    } else if (checkedItems.length === 1) {
        textEl.textContent = checkedItems[0].closest(".al-ms-option")?.querySelector("span")?.textContent || "";
    } else {
        textEl.textContent = isId ? `${checkedItems.length} Tipe Dipilih` : `${checkedItems.length} Types Selected`;
    }

}

// Mengisi opsi filter "Negara Asal" berdasarkan negara yang benar-benar
// muncul di ALState.logs, memakai nama & flag dari AM_COUNTRY_META —
// daftar negara yang sama dengan yang dipakai grafik analitik di atas —
// supaya kedua bagian tetap konsisten satu sama lain.
function alPopulateCountryFilter() {

    const select = document.getElementById("alCountryFilter");
    if (!select) return;

    const codes = [...new Set(ALState.logs.map((l) => l.country))]
        .sort((a, b) => (AM_COUNTRY_META[a]?.name || a).localeCompare(AM_COUNTRY_META[b]?.name || b));

    select.innerHTML = `<option value="all">All Countries</option>` + codes.map((code) => {
        const meta = AM_COUNTRY_META[code];
        const label = meta ? `${meta.flag} ${meta.name}` : code;
        return `<option value="${code}">${label}</option>`;
    }).join("");

}

function alApplyFilters() {

    const root = document.getElementById("alRoot");
    if (!root) return;

    const search = (document.getElementById("alSearchInput")?.value || "").trim().toLowerCase();
    const { checked: selectedTypes, total: totalTypes } = alGetSelectedTypes();
    const country = document.getElementById("alCountryFilter")?.value || "all";
    const status = document.getElementById("alStatusFilter")?.value || "all";
    const dateFrom = document.getElementById("alDateFrom")?.value || "";
    const dateTo = document.getElementById("alDateTo")?.value || "";

    ALState.filtered = ALState.logs.filter((log) => {

        // Semua tipe tercentang = tidak ada filter tipe yang diterapkan
        // (sama seperti "All Types" pada select lama). Kalau sebagian
        // tercentang, tampilkan baris yang tipenya ada di daftar
        // tercentang itu; kalau tidak ada satupun tercentang, tidak ada
        // baris yang cocok.
        if (selectedTypes.length !== totalTypes && !selectedTypes.includes(log.type)) return false;
        if (country !== "all" && log.country !== country) return false;
        if (status !== "all" && log.status !== status) return false;

        if (search) {
            const haystack = `${log.userName} ${log.userEmail} ${log.detail} ${log.countryName}`.toLowerCase();
            if (!haystack.includes(search)) return false;
        }

        if (dateFrom) {
            const from = new Date(dateFrom + "T00:00:00");
            if (log.timestamp < from) return false;
        }

        if (dateTo) {
            const to = new Date(dateTo + "T23:59:59");
            if (log.timestamp > to) return false;
        }

        return true;

    });

    ALState.page = 1;
    alRenderTable();

}

// ---------------------------------------------------------------
// 4. Rendering — stat cards
// ---------------------------------------------------------------

function alRenderStats() {

    const logs = ALState.logs;
    const total = logs.length;
    const loginCount = logs.filter((l) => l.type === "login" || l.type === "logout").length;
    const calcCount = logs.filter((l) => l.type === "solar-calculator" || l.type === "admin-calculator").length;

    const today = new Date();
    const activeToday = new Set(
        logs
            .filter((l) => l.timestamp.toDateString() === today.toDateString())
            .map((l) => l.userName)
    ).size;

    const elTotal = document.getElementById("alStatTotal");
    const elLogin = document.getElementById("alStatLogin");
    const elCalc = document.getElementById("alStatCalc");
    const elActiveToday = document.getElementById("alStatActiveToday");

    // Stat cards di atas toolbar sudah dihapus dari markup — guard supaya
    // fungsi ini tetap aman dipanggil (no-op) jika elemennya tidak ada.
    if (elTotal) elTotal.textContent = total;
    if (elLogin) elLogin.textContent = loginCount;
    if (elCalc) elCalc.textContent = calcCount;
    if (elActiveToday) elActiveToday.textContent = activeToday;

}

// ---------------------------------------------------------------
// 5. Rendering — table + pagination
// ---------------------------------------------------------------

function alRenderTable() {

    const tbody = document.getElementById("alTableBody");
    const emptyState = document.getElementById("alEmptyState");
    const resultCount = document.getElementById("alResultCount");
    const pageInfo = document.getElementById("alPageInfo");

    if (!tbody) return;

    const total = ALState.filtered.length;
    resultCount.textContent = `${total} activities`;

    const totalPages = Math.max(1, Math.ceil(total / ALState.pageSize));
    if (ALState.page > totalPages) ALState.page = totalPages;

    const start = (ALState.page - 1) * ALState.pageSize;
    const pageItems = ALState.filtered.slice(start, start + ALState.pageSize);

    if (total === 0) {
        tbody.innerHTML = "";
        emptyState.hidden = false;
        const emptyText = emptyState.querySelector("p");
        if (emptyText) {
            if (ALState.loading) {
                emptyText.textContent = "Loading activity log…";
            } else if (ALState.loadError) {
                emptyText.textContent = "Couldn't reach the Activity Log backend (edashboard_api). Make sure the API server is running, then click Refresh.";
            } else {
                emptyText.textContent = "No activity matches this filter.";
            }
        }
        pageInfo.textContent = "Showing 0-0 of 0 activities";
        document.getElementById("alPagination").innerHTML = "";
        return;
    }

    emptyState.hidden = true;

    tbody.innerHTML = pageItems.map((log, idx) => {

        const meta = AL_TYPE_META[log.type];
        const isId = typeof getSavedLanguage === "function" && getSavedLanguage() === "id";
        const statusPill = log.status === "success"
            ? `<span class="pill pill-success"><i class="fa-solid fa-check"></i> ${isId ? "Berhasil" : "Success"}</span>`
            : `<span class="pill pill-danger"><i class="fa-solid fa-xmark"></i> ${isId ? "Gagal" : "Failed"}</span>`;
        const detailText = typeof translateDynamicText === "function"
            ? translateDynamicText(log.detail, isId ? "id" : "en")
            : log.detail;

        return `
            <tr>
                <td>${start + idx + 1}</td>
                <td>
                    <div class="al-time-cell">
                        <span class="al-time-date">${alFormatDate(log.timestamp)}</span>
                        <span class="al-time-clock">${alFormatTime(log.timestamp)}</span>
                    </div>
                </td>
                <td>
                    <div class="al-user-cell">
                        <span class="al-user-name">${alEscape(log.userName)}</span>
                        <span class="al-user-email">${alEscape(log.userEmail)}</span>
                    </div>
                </td>
                <td>
                    <span class="al-country-badge">${log.countryFlag} ${alEscape(log.countryName)}</span>
                </td>
                <td>
                    <span class="al-type-badge ${meta.css}">
                        <i class="fa-solid ${meta.icon}"></i> ${meta.label}
                    </span>
                </td>
                <td class="al-detail-cell">
                    <span class="al-detail-text">${alEscape(detailText)}</span>
                    <button type="button" class="al-details-btn" data-log-id="${log.id}">
                        <i class="fa-solid fa-circle-info"></i> ${isId ? "Detail" : "Details"}
                    </button>
                </td>
                <td>
                    <div class="al-device-cell">
                        <span class="al-device-name">${alEscape(log.device)}</span>
                        <span class="al-device-ip">${log.ip}</span>
                    </div>
                </td>
                <td>${statusPill}</td>
            </tr>
        `;

    }).join("");

    pageInfo.textContent = `Showing ${start + 1}-${Math.min(start + ALState.pageSize, total)} of ${total} activities`;

    alRenderPagination(totalPages);

}

function alRenderPagination(totalPages) {

    const wrap = document.getElementById("alPagination");
    if (!wrap) return;

    if (totalPages <= 1) {
        wrap.innerHTML = "";
        return;
    }

    const current = ALState.page;
    let html = "";

    html += `<button class="al-page-btn" data-page="prev" ${current === 1 ? "disabled" : ""} aria-label="Sebelumnya"><i class="fa-solid fa-chevron-left"></i></button>`;

    const pages = [];
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - current) <= 1) {
            pages.push(p);
        } else if (pages[pages.length - 1] !== "...") {
            pages.push("...");
        }
    }

    pages.forEach((p) => {
        if (p === "...") {
            html += `<span class="al-page-dots">&hellip;</span>`;
        } else {
            html += `<button class="al-page-btn ${p === current ? "is-active" : ""}" data-page="${p}">${p}</button>`;
        }
    });

    html += `<button class="al-page-btn" data-page="next" ${current === totalPages ? "disabled" : ""} aria-label="Berikutnya"><i class="fa-solid fa-chevron-right"></i></button>`;

    wrap.innerHTML = html;

    wrap.querySelectorAll(".al-page-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const val = btn.getAttribute("data-page");
            if (val === "prev") ALState.page = Math.max(1, ALState.page - 1);
            else if (val === "next") ALState.page = Math.min(totalPages, ALState.page + 1);
            else ALState.page = parseInt(val, 10);
            alRenderTable();
        });
    });

}

// ---------------------------------------------------------------
// 5b. Activity Detail modal (bagian J — event-specific)
// ---------------------------------------------------------------

function alDetailRow(label, value) {
    const displayValue = (value === undefined || value === null || value === "") ? "-" : value;
    return `<div class="al-detail-row"><span>${alEscape(label)}</span><span>${alEscape(String(displayValue))}</span></div>`;
}

function alDetailSection(title, rowsHtml) {
    return `<div class="al-detail-section"><div class="al-detail-section-title">${alEscape(title)}</div>${rowsHtml}</div>`;
}

// Format angka supaya layak dibaca (pembulatan + pemisah ribuan),
// bukan presisi float mentah seperti "2553296856.7566085".
function alFormatMetric(value, opts) {
    const { decimals = 0, prefix = "", suffix = "" } = opts || {};
    if (value === undefined || value === null || value === "" || (typeof value === "number" && !isFinite(value))) return "-";
    if (typeof value !== "number") return String(value);
    const formatted = value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return `${prefix}${formatted}${suffix}`;
}

// Merender daftar key/value dari sebuah object secara generik — dipakai
// untuk object yang KECIL dan FLAT (mis. calculatorInput). Nilai berupa
// array atau object bersarang sengaja ditampilkan ringkas (bukan
// "[object Object]") karena data semacam itu (chart points, tabel
// tahunan, dsb.) memang tidak cocok dibaca sebagai daftar key/value.
function alDetailRowsFromObject(obj) {
    if (!obj || typeof obj !== "object" || Object.keys(obj).length === 0) {
        return `<div class="al-detail-empty">No data available.</div>`;
    }
    return Object.entries(obj).map(([key, value]) => {
        let displayValue = value;
        if (Array.isArray(value)) {
            displayValue = `${value.length} item${value.length === 1 ? "" : "s"}`;
        } else if (value && typeof value === "object") {
            displayValue = Object.entries(value)
                .filter(([, v]) => v === null || typeof v !== "object")
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ") || "-";
        }
        const label = key
            .replace(/_/g, " ")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/^./, (c) => c.toUpperCase());
        return alDetailRow(label, displayValue);
    }).join("");
}

// Ringkasan hasil Solar Calculator (publik) — dikurasi manual dari
// object computeEstimate() (js/solar-calculator.js), karena object
// aslinya berisi 50+ field termasuk beberapa array besar (chartData,
// yearlyRows, annualBillsPln/Dp/Bot) yang memang untuk grafik/PDF,
// bukan untuk dibaca sebagai daftar Details.
function alSolarResultRows(r) {
    if (!r || typeof r !== "object") return `<div class="al-detail-empty">No data available.</div>`;
    return [
        alDetailRow("Location", r.locationLabel),
        alDetailRow("Facility Type", r.facilityLabel),
        alDetailRow("Monthly Bill", alFormatMetric(r.monthlyBill, { prefix: "Rp " })),
        alDetailRow("Recommended System Size", alFormatMetric(r.systemSizeKwp, { decimals: 2, suffix: " kWp" })),
        alDetailRow("Panel Count", alFormatMetric(r.panelCount)),
        alDetailRow("Panel Area", alFormatMetric(r.panelAreaM2, { suffix: " m²" })),
        alDetailRow("Solar Coverage", alFormatMetric(r.coveragePct, { decimals: 1, suffix: "%" })),
        alDetailRow("Est. Monthly Savings", alFormatMetric(r.monthlySavings, { prefix: "Rp " })),
        alDetailRow("New Monthly Bill", alFormatMetric(r.newMonthlyBill, { prefix: "Rp " })),
        alDetailRow("Estimated Investment", alFormatMetric(r.investment, { prefix: "Rp " })),
        alDetailRow("Payback Period", alFormatMetric(r.paybackYears, { decimals: 1, suffix: " years" })),
        alDetailRow("Lifetime Savings (20yr)", alFormatMetric(r.lifetimeSavings, { prefix: "Rp " })),
        alDetailRow("Annual CO2 Reduction", alFormatMetric(r.annualCo2Ton, { decimals: 2, suffix: " ton/yr" })),
        alDetailRow("Equivalent Trees Planted", alFormatMetric(r.equivalentTrees, { suffix: "/yr" })),
    ].join("");
}

// Ringkasan hasil Admin Calculator — dikurasi dari object `calc`
// (js/admin-calculator.js, spDesign()), yang juga berisi field
// bersarang/array (panel, inv, battery, topo, mpptAssign, dst).
function alAdminCalcResultRows(r) {
    if (!r || typeof r !== "object") return `<div class="al-detail-empty">No data available.</div>`;
    const rows = [
        alDetailRow("System Type", r.type),
        alDetailRow("Panel", r.panel?.nama),
        alDetailRow("Inverter", r.inv?.nama),
        alDetailRow("Target Capacity", alFormatMetric(r.target, { decimals: 1, suffix: " kWp" })),
        alDetailRow("Actual Capacity", alFormatMetric(r.actual, { decimals: 2, suffix: " kWp" })),
        alDetailRow("Panel Count", alFormatMetric(r.panelCount)),
        alDetailRow("Inverter Count", alFormatMetric(r.invCount)),
        alDetailRow("Daily Production", alFormatMetric(r.daily, { decimals: 1, suffix: " kWh" })),
        alDetailRow("Annual Production", alFormatMetric(r.annualMwh, { decimals: 2, suffix: " MWh" })),
    ];
    if (r.type === "Hybrid" && r.battery) {
        rows.push(alDetailRow("Battery", r.battery?.nama));
        rows.push(alDetailRow("Battery Quantity", alFormatMetric(r.batteryQty)));
        rows.push(alDetailRow("Battery Capacity", alFormatMetric(r.batteryTotalKwh, { decimals: 2, suffix: " kWh" })));
    }
    return rows.join("");
}

// Membangun isi modal Details sesuai eventType si log (event-specific —
// tabel utamanya tetap satu, hanya isi modal ini yang berbeda-beda).
function alBuildDetailHtml(log) {

    const raw = log.raw || {};
    const data = raw.data || {};

    let html = "";

    html += alDetailSection("Activity Information", [
        alDetailRow("Time", `${alFormatDate(log.timestamp)} ${alFormatTime(log.timestamp)}`),
        alDetailRow("User", log.userName),
        alDetailRow("Country of Origin", log.countryName),
        alDetailRow("Device & IP", `${log.device} · ${log.ip}`),
        alDetailRow("Status", log.status === "success" ? "Success" : "Failed"),
    ].join(""));

    switch (log.eventType) {

        case "login":
        case "logout":
            html += alDetailSection("Session Information", [
                alDetailRow("Username", log.userName),
                alDetailRow("Role", log.userEmail), // userEmail field carries role for dashboard events
            ].join(""));
            break;

        case "admin_calculator":
            html += alDetailSection("Calculator Input", alDetailRowsFromObject(data.calculatorInput));
            html += alDetailSection("Calculator Result", alAdminCalcResultRows(data.calculatorResult));
            break;

        case "admin_calculator_export":
        case "project_report_export":
            html += alDetailSection("Export Information", [
                alDetailRow("Report", data.export?.report || data.projectName || "-"),
                alDetailRow("Export Type", data.export?.type),
                alDetailRow("Export Status", data.export?.status),
            ].join(""));
            if (data.calculatorInput) html += alDetailSection("Calculator Input", alDetailRowsFromObject(data.calculatorInput));
            if (data.calculatorResult) html += alDetailSection("Calculator Result", alAdminCalcResultRows(data.calculatorResult));
            if (data.projectId) html += alDetailSection("Report Information", alDetailRowsFromObject({
                projectId: data.projectId,
                projectName: data.projectName,
                period: data.periodLabel || data.period,
            }));
            break;

        case "calculator_calculate":
            html += alDetailSection("Calculator Input", alDetailRowsFromObject(data.calculatorInput));
            html += alDetailSection("Calculator Result", alSolarResultRows(data.calculatorResult));
            break;

        case "calculator_export":
            html += alDetailSection("Export Information", [
                alDetailRow("Export Type", data.export?.type),
                alDetailRow("Export Status", data.export?.status),
            ].join(""));
            html += alDetailSection("Calculator Input", alDetailRowsFromObject(data.calculatorInput));
            html += alDetailSection("Calculator Result", alSolarResultRows(data.calculatorResult));
            break;

        default:
            if (Object.keys(data).length > 0) {
                html += alDetailSection("Additional Information", alDetailRowsFromObject(data));
            }

    }

    return html;

}

function alOpenDetailModal(logId) {

    const log = ALState.logs.find((l) => String(l.id) === String(logId));
    if (!log) return;

    const overlay = document.getElementById("alDetailModalOverlay");
    const title = document.getElementById("alDetailModalTitle");
    const body = document.getElementById("alDetailModalBody");
    if (!overlay || !title || !body) return;

    const meta = AL_TYPE_META[log.type];
    title.innerHTML = `<i class="fa-solid ${meta.icon}"></i> ${meta.label} Details`;
    body.innerHTML = alBuildDetailHtml(log);

    overlay.classList.remove("hidden");

}

function alCloseDetailModal() {
    const overlay = document.getElementById("alDetailModalOverlay");
    if (overlay) overlay.classList.add("hidden");
}

function initActivityDetailModal() {

    const overlay = document.getElementById("alDetailModalOverlay");
    const closeBtn = document.getElementById("alDetailModalClose");
    const tbody = document.getElementById("alTableBody");
    if (!overlay || !closeBtn || !tbody) return;

    // Delegated click supaya tetap bekerja walau tbody dirender ulang.
    tbody.addEventListener("click", (e) => {
        const btn = e.target.closest(".al-details-btn");
        if (!btn) return;
        alOpenDetailModal(btn.getAttribute("data-log-id"));
    });

    closeBtn.addEventListener("click", alCloseDetailModal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) alCloseDetailModal(); });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !overlay.classList.contains("hidden")) alCloseDetailModal();
    });

}

// ---------------------------------------------------------------
// 6. Export CSV (dari data yang sedang difilter)
// ---------------------------------------------------------------

function alExportCsv() {

    if (!ALState.filtered.length) {
        if (typeof showToast === "function") showToast("No data to export.", "warning");
        return;
    }

    const header = ["Date", "Time", "Name", "Role/Email", "Country of Origin", "Activity Type", "Activity Detail", "Device", "IP Address", "Status"];

    const rows = ALState.filtered.map((log) => [
        alFormatDate(log.timestamp),
        alFormatTime(log.timestamp),
        log.userName,
        log.userEmail,
        log.countryName,
        AL_TYPE_META[log.type].label,
        log.detail,
        log.device,
        log.ip,
        log.status === "success" ? "Success" : "Failed",
    ]);

    const csvContent = [header, ...rows]
        .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\r\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `activity-log-${alDateInputValue(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (typeof showToast === "function") showToast(`Successfully exported ${ALState.filtered.length} activities to CSV.`, "success");

}

// ---------------------------------------------------------------
// 7. Refresh (simulasi reload data)
// ---------------------------------------------------------------

function alRefresh() {

    const root = document.getElementById("alRoot");
    const btn = document.getElementById("alRefreshBtn");
    if (!root || !btn) return;

    root.classList.add("is-loading");
    btn.disabled = true;
    const icon = btn.querySelector("i");
    icon.classList.add("fa-spin");

    alFetchLogs()
        .then((logs) => {
            ALState.logs = logs;
            ALState.loadError = false;
            alApplyFilters();
            alPopulateCountryFilter();
            if (typeof amRenderChart === "function") amRenderChart();
            if (typeof mktRefresh === "function") mktRefresh();
            if (typeof showToast === "function") showToast("Activity log updated.", "success");
        })
        .catch((err) => {
            console.warn("[activity-log] Refresh gagal:", err.message);
            if (typeof showToast === "function") {
                showToast("Failed to reach the Activity Log backend. Is it running?", "error");
            }
        })
        .finally(() => {
            root.classList.remove("is-loading");
            btn.disabled = false;
            icon.classList.remove("fa-spin");
        });

}

// ---------------------------------------------------------------
// 8. Init
// ---------------------------------------------------------------

// Menghubungkan interaksi dropdown multi-select "Activity Type":
// buka/tutup panel, checkbox master "All Types" (select/deselect
// semua), tiap checkbox individual, dan menutup panel saat klik di
// luar dropdown-nya. Dipanggil sekali dari initActivityLog().
function alInitTypeMultiSelect() {

    const wrap = document.getElementById("alTypeMs");
    const trigger = document.getElementById("alTypeMsTrigger");
    const panel = document.getElementById("alTypeMsPanel");
    const masterCb = document.getElementById("alTypeMsAll");
    const items = document.querySelectorAll(".al-type-ms-item");

    if (!wrap || !trigger || !panel || !masterCb) return;

    function closePanel() {
        panel.hidden = true;
        trigger.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
    }

    function togglePanel() {
        const willOpen = panel.hidden;
        panel.hidden = !willOpen;
        trigger.classList.toggle("is-open", willOpen);
        trigger.setAttribute("aria-expanded", String(willOpen));
    }

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePanel();
    });

    document.addEventListener("click", (e) => {
        if (!panel.hidden && !wrap.contains(e.target)) closePanel();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !panel.hidden) closePanel();
    });

    masterCb.addEventListener("change", () => {
        items.forEach((cb) => { cb.checked = masterCb.checked; });
        alUpdateTypeMsUI();
        alApplyFilters();
    });

    items.forEach((cb) => {
        cb.addEventListener("change", () => {
            alUpdateTypeMsUI();
            alApplyFilters();
        });
    });

    alUpdateTypeMsUI();

}

let alDebounceTimer = null;

function initActivityLog() {

    const root = document.getElementById("alRoot");
    if (!root) return;

    ALState.logs = [];
    ALState.filtered = [];
    ALState.page = 1;
    ALState.loading = true;

    alRenderStats();
    alRenderTable(); // renders the empty state immediately while loading

    alFetchLogs()
        .then((logs) => {
            ALState.logs = logs;
            ALState.loadError = false;
            ALState.loading = false;
            alPopulateCountryFilter();
            alApplyFilters();
            if (typeof amRenderChart === "function") amRenderChart();
        })
        .catch((err) => {
            console.warn("[activity-log] Gagal memuat activity dari backend:", err.message);
            ALState.loadError = true;
            ALState.loading = false;
            alRenderTable(); // shows the empty state with a helpful message
        });

    document.getElementById("alSearchInput").addEventListener("input", () => {
        clearTimeout(alDebounceTimer);
        alDebounceTimer = setTimeout(alApplyFilters, 250);
    });

    alInitTypeMultiSelect();
    document.getElementById("alCountryFilter").addEventListener("change", alApplyFilters);
    document.getElementById("alStatusFilter").addEventListener("change", alApplyFilters);
    document.getElementById("alDateFrom").addEventListener("change", alApplyFilters);
    document.getElementById("alDateTo").addEventListener("change", alApplyFilters);

    document.getElementById("alPageSizeSelect").addEventListener("change", (e) => {
        const val = e.target.value;
        // "All" dipetakan ke angka besar yang tetap terhingga (BUKAN
        // Infinity) supaya (page - 1) * pageSize di alRenderTable() tidak
        // pernah jadi NaN (0 * Infinity = NaN di JavaScript) -- Array.slice
        // sendiri sudah otomatis membatasi end index ke panjang array kalau
        // angkanya lebih besar dari total data, jadi tetap aman dipakai
        // sebagai "tampilkan semua baris".
        ALState.pageSize = val === "all" ? Number.MAX_SAFE_INTEGER : (parseInt(val, 10) || 8);
        ALState.page = 1;
        alRenderTable();
    });

    document.getElementById("alResetBtn").addEventListener("click", () => {
        document.getElementById("alSearchInput").value = "";
        document.getElementById("alTypeMsAll").checked = true;
        document.querySelectorAll(".al-type-ms-item").forEach((cb) => { cb.checked = true; });
        alUpdateTypeMsUI();
        document.getElementById("alCountryFilter").value = "all";
        document.getElementById("alStatusFilter").value = "all";
        document.getElementById("alDateFrom").value = "";
        document.getElementById("alDateTo").value = "";
        alApplyFilters();
    });

    document.getElementById("alRefreshBtn").addEventListener("click", alRefresh);
    document.getElementById("alExportBtn").addEventListener("click", alExportCsv);

    initActivityDetailModal();
    initDashboardActivityAnalytics();
    if (typeof initMarketingAnalytics === "function") initMarketingAnalytics();

}

// ============================================================
// DASHBOARD ACTIVITY ANALYTICS — infografis
// ------------------------------------------------------------
// Section ini BELUM terhubung ke backend. Semua data di bawah
// dibuat oleh amSeriesFor() (deterministic pseudo-random, sama
// triknya dengan admin.html) supaya prototipe ini terlihat identik
// setiap kali dimuat ulang, dan dua orang yang mereview di waktu
// berbeda tetap membicarakan angka yang sama.
//
// Pola interaksinya meniru tab "Overview" pada admin.html yang
// dijadikan referensi: SATU tabel berisi baris-baris aktivitas yang
// bisa dicentang untuk diplot ke satu grafik (Line / Bar / Stacked
// Bar / 100% Stacked), dengan rentang tanggal bebas (From/To) plus
// preset cepat (24h/7d/30d/90d/1y) — persis seperti kontrol grafik
// "Activity trends" pada admin.html.
//
// AM_ACTIVITIES berisi HANYA 8 unsur inti yang benar-benar ada pada
// dashboard 360eDash ini sendiri (bukan situs pemasaran seperti
// admin.html), yaitu:
//   1. Visitors from Indonesia   4. Switched to Indonesian  7. Simulated calculator
//   2. Visitors from United      5. Login                   8. Export monthly report
//      States                    6. Logout
//   3. Visitors from elsewhere
//
// Saat backend siap: ganti isi amSeriesFor() dengan hasil fetch
// GET /api/activity/series?key=&from=&to= yang mengembalikan array
// of { t: "YYYY-MM-DD", v: number } untuk key tsb. Semua render
// (tabel ringkasan, kartu KPI, grafik) bekerja dari bentuk itu saja
// sehingga tidak perlu diubah. AM_COUNTRY_META (di atas, dipakai
// System Activity Log) tetap terpisah dari data grafik ini.
// ============================================================

const AM_COUNTRY_META = {
    ID: { name: "Indonesia",     flag: "🇮🇩", base: 420 },
    US: { name: "United States", flag: "🇺🇸", base: 60  },
    CN: { name: "China",         flag: "🇨🇳", base: 35  },
    IN: { name: "India",         flag: "🇮🇳", base: 40  },
    JP: { name: "Japan",         flag: "🇯🇵", base: 25  },
    SG: { name: "Singapore",     flag: "🇸🇬", base: 55  },
    MY: { name: "Malaysia",      flag: "🇲🇾", base: 45  },
    AU: { name: "Australia",     flag: "🇦🇺", base: 20  },
};

// 8 unsur inti yang benar-benar ada pada dashboard 360eDash ini:
// Visitors & Language Switch diambil dari eventType "page_visit"
// (dicatat sekali per kunjungan pada halaman publik Solar Calculator)
// dan "language_switch" (dicatat saat toggle bahasa header/Settings
// benar-benar ditekan, bukan saat halaman di-load ulang) — lihat
// AM_ACTIVITY_MATCHERS di bawah untuk pemetaan lengkap ke eventType asli.
//
// Sumber region untuk baris "Visitors from ..." SEKARANG ADA DUA,
// digabung dengan OR (lihat amVisitorCountryCode() di bawah):
//   1. IP request (page_visit -> log.raw.countryCode, dari GeoIP
//      backend/ipwho.is — lihat request-meta.ts). Ini tetap sumber
//      utama karena tidak bisa dipalsukan dari client.
//   2. Negara yang DIPILIH USER SENDIRI lewat dropdown "Country" pada
//      Solar Calculator (ID/US/Other), dikirim sebagai
//      data.calculatorInput.country_code setiap kali user menekan
//      "Calculate" (eventType "calculator_calculate" — lihat
//      runCalculation()/getCalculatorInputSnapshot() di
//      js/solar-calculator.js). Ini melengkapi kasus di mana IP tidak
//      mencerminkan lokasi fasilitas yang sebenarnya sedang dihitung
//      user (mis. dipakai lewat VPN/kantor pusat), atau saat lookup
//      IP gagal ("-").
// Kedua sumber dihitung terpisah per event (satu page_visit + satu
// calculator_calculate pada kunjungan yang sama bisa menyumbang 2
// hitungan) — ini sengaja, karena keduanya tetap merepresentasikan
// dua signal region yang valid & independen, bukan duplikat.
const AM_ACTIVITIES = [
    { key: "visit_id",      type: "Visitors", detail: "Visitors from Indonesia",     icon: "fa-solid fa-flag",               color: "#0F6A71" },
    { key: "visit_us",      type: "Visitors", detail: "Visitors from United States", icon: "fa-solid fa-flag-usa",           color: "#3E7CB1" },
    { key: "visit_other",   type: "Visitors", detail: "Visitors from elsewhere",     icon: "fa-solid fa-earth-americas",     color: "#7C5CE0" },
    { key: "lang_id",       type: "Language", detail: "Switched to Indonesian",      icon: "fa-solid fa-language",           color: "#2F9E6E" },
    { key: "login",         type: "Session",  detail: "Login",                       icon: "fa-solid fa-right-to-bracket",   color: "#FA891A" },
    { key: "logout",        type: "Session",  detail: "Logout",                      icon: "fa-solid fa-right-from-bracket", color: "#E3A21A" },
    { key: "calc_sim",      type: "Tool",     detail: "Simulated calculator",        icon: "fa-solid fa-calculator",         color: "#D64545" },
    { key: "export_report", type: "Export",   detail: "Export monthly report",       icon: "fa-solid fa-file-export",        color: "#6DC3BB" },
];

// Negara yang dipilih USER SENDIRI di form Solar Calculator saat event
// "calculator_calculate" ini terjadi, kalau ada ("ID"/"US"/"OTHER" —
// persis nilai <select id="countrySelect"> di solar-calculator.js).
// null kalau log ini bukan calculator_calculate, atau field lama yang
// dicatat sebelum data.calculatorInput.country_code ada (jangan
// dianggap "elsewhere" hanya karena datanya kosong).
function amVisitorCalcCountryCode(log) {
    if (log.eventType !== "calculator_calculate") return null;
    const cc = log.raw?.data?.calculatorInput?.country_code;
    return cc ? String(cc).toUpperCase() : null;
}

// Memetakan tiap key di atas ke predikat atas log ASLI (ALState.logs,
// hasil GET /api/activity) — dipakai amSeriesFor() untuk menghitung
// jumlah kejadian per hari. "calc_sim" sengaja hanya memakai
// calculator_calculate (Solar Calculator publik, "simulasi") — bukan
// admin_calculator, karena itu tool bisnis internal, bukan simulasi
// publik. "export_report" menggabungkan ketiga jenis export (admin
// calculator, solar calculator, project report) — sama seperti
// kategori "Export Report" pada tabel Activity History di bawahnya.
const AM_ACTIVITY_MATCHERS = {
    visit_id:      (log) => (log.eventType === "page_visit" && log.raw.countryCode === "ID")
                          || amVisitorCalcCountryCode(log) === "ID",
    visit_us:      (log) => (log.eventType === "page_visit" && log.raw.countryCode === "US")
                          || amVisitorCalcCountryCode(log) === "US",
    visit_other:   (log) => (log.eventType === "page_visit" && log.raw.countryCode !== "ID" && log.raw.countryCode !== "US")
                          || (amVisitorCalcCountryCode(log) !== null && !["ID", "US"].includes(amVisitorCalcCountryCode(log))),
    lang_id:       (log) => log.eventType === "language_switch" && log.raw.data?.language === "id",
    login:         (log) => log.eventType === "login" && log.status === "success",
    logout:        (log) => log.eventType === "logout",
    calc_sim:      (log) => log.eventType === "calculator_calculate",
    export_report: (log) => ["calculator_export", "admin_calculator_export", "project_report_export"].includes(log.eventType),
};

function amActivityTypeLabel(type) {
    const isId = typeof getSavedLanguage === "function" && getSavedLanguage() === "id";
    if (!isId) return type;
    const map = { Visitors: "Pengunjung", Language: "Bahasa", Session: "Sesi", Tool: "Alat", Export: "Ekspor" };
    return map[type] || type;
}

// Activity Summary detail labels are part of the analytics UI. Keep the
// underlying AM_ACTIVITIES keys/data intact, but localize the visible
// labels immediately when the dashboard language changes.
function amActivityDetailLabel(detail) {
    const isId = typeof getSavedLanguage === "function" && getSavedLanguage() === "id";
    if (!isId) return detail;
    const map = {
        "Visitors from Indonesia": "Pengunjung dari Indonesia",
        "Visitors from United States": "Pengunjung dari Amerika Serikat",
        "Visitors from elsewhere": "Pengunjung dari wilayah lain",
        "Switched to Indonesian": "Beralih ke Bahasa Indonesia",
        "Login": "Masuk",
        "Logout": "Keluar",
        "Simulated calculator": "Simulasi kalkulator",
        "Export monthly report": "Ekspor laporan bulanan",
    };
    return map[detail] || detail;
}

function amLocalizeSummaryHint() {
    const hint = document.querySelector(".am-summary-hint");
    if (!hint) return;
    const isId = typeof getSavedLanguage === "function" && getSavedLanguage() === "id";
    hint.textContent = isId
        ? "Centang baris untuk menampilkannya pada grafik di bawah."
        : "Tick a row to plot it on the chart below.";
}

const AMState = {
    selected: new Set(["visit_id", "visit_us"]), // default: dua baris tercentang, sama seperti admin.html
    chartType: "line",                            // "line" | "bar" | "stacked" | "percent"
    chart: null,
    dayIndex: new Map(),                          // dibangun ulang di setiap amLoad() lewat amBuildDayIndex()
};

// ---------------------------------------------------------------
// 1. Data seri ASLI — dihitung dari ALState.logs (hasil GET
//    /api/activity), bukan lagi generator pseudo-random.
// ---------------------------------------------------------------

// Mengelompokkan ALState.logs ke dalam Map<"YYYY-MM-DD", log[]> sekali
// per amLoad(), supaya amSeriesFor() untuk 8 baris x banyak hari tidak
// perlu scan ulang seluruh log dari awal setiap kali.
function amBuildDayIndex() {
    const index = new Map();
    ALState.logs.forEach((log) => {
        const d = log.timestamp;
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(log);
    });
    return index;
}

function amSeriesFor(key, from, to) {
    const matcher = AM_ACTIVITY_MATCHERS[key];
    const out = [];
    let d = new Date(from);
    while (d <= to) {
        const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const dayLogs = AMState.dayIndex.get(dayKey) || [];
        const v = dayLogs.reduce((count, log) => count + (matcher(log) ? 1 : 0), 0);
        out.push({ t: new Date(d), v });
        d = new Date(d.getTime() + 864e5);
    }
    return out;
}

function amBucketOf(days) { return days <= 120 ? "day" : days <= 730 ? "week" : "month"; }

function amRollup(points, bucket) {
    if (bucket === "day") return points;
    const m = new Map();
    points.forEach((p) => {
        const d = new Date(p.t);
        if (bucket === "week") d.setDate(d.getDate() - d.getDay());
        else d.setDate(1);
        const k = d.getTime();
        m.set(k, (m.get(k) || 0) + p.v);
    });
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ t: new Date(k), v }));
}

function amFormatShort(d) {
    const isId = typeof getSavedLanguage === "function" && getSavedLanguage() === "id";
    const idMonths = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const enMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const months = isId ? idMonths : enMonths;
    return `${d.getDate()} ${months[d.getMonth()]}`;
}

// ---------------------------------------------------------------
// 2. Rentang tanggal (From/To + preset cepat)
// ---------------------------------------------------------------

function amRange() {
    const fromInput = document.getElementById("amFromDate");
    const toInput = document.getElementById("amToDate");
    if (!fromInput || !toInput || !fromInput.value || !toInput.value) return null;
    const f = new Date(fromInput.value + "T00:00:00");
    const t = new Date(toInput.value + "T00:00:00");
    if (isNaN(f) || isNaN(t) || f > t) return null;
    return [f, t];
}

function amSetPresetRange(days) {
    const to = new Date(); to.setHours(0, 0, 0, 0);
    const from = new Date(to.getTime() - (days - 1) * 864e5);
    document.getElementById("amFromDate").value = alDateInputValue(from);
    document.getElementById("amToDate").value = alDateInputValue(to);
}

function amPct(curr, prev) {
    if (prev > 0) return Math.round(((curr - prev) / prev) * 100);
    return curr > 0 ? 100 : 0;
}

// ---------------------------------------------------------------
// 3. Load: hitung semua baris untuk rentang aktif, lalu render
//    tabel ringkasan, kartu KPI, dan grafik sekaligus.
// ---------------------------------------------------------------

function amLoad() {

    const r = amRange();
    if (!r) return;
    const [from, to] = r;
    const days = Math.round((to - from) / 864e5) + 1;
    const bucket = amBucketOf(days);

    AMState.dayIndex = amBuildDayIndex();

    const rangeLbl = document.getElementById("amRangeLbl");
    if (rangeLbl) rangeLbl.textContent = `${amFormatShort(from)} ${typeof getSavedLanguage === "function" && getSavedLanguage() === "id" ? "sampai" : "to"} ${amFormatShort(to)} \u00B7 ${days} ${days === 1 ? (typeof getSavedLanguage === "function" && getSavedLanguage() === "id" ? "hari" : "day") : (typeof getSavedLanguage === "function" && getSavedLanguage() === "id" ? "hari" : "days")}`;

    const now = new Date(); now.setHours(0, 0, 0, 0);

    // Periode berjalan, per baris aktivitas.
    const rows = AM_ACTIVITIES.map((a) => {
        const all = amSeriesFor(a.key, from, to);
        const inRange = all.reduce((s, p) => s + p.v, 0);
        const d1 = amSeriesFor(a.key, new Date(now.getTime() - 864e5), now).reduce((s, p) => s + p.v, 0);
        const d7 = amSeriesFor(a.key, new Date(now.getTime() - 6 * 864e5), now).reduce((s, p) => s + p.v, 0);
        return Object.assign({}, a, { inRange, d1, d7, points: amRollup(all, bucket) });
    }).sort((a, b) => b.inRange - a.inRange);

    // Periode sebelumnya (rentang yang sama, digeser mundur) untuk delta KPI.
    const prevFrom = new Date(from.getTime() - days * 864e5);
    const prevTo = new Date(to.getTime() - days * 864e5);
    const prevRows = AM_ACTIVITIES.map((a) => ({
        key: a.key,
        inRange: amSeriesFor(a.key, prevFrom, prevTo).reduce((s, p) => s + p.v, 0),
    }));

    amRenderSummaryTable(rows);
    amLocalizeSummaryHint();
    amRenderStats(rows, prevRows);
    amDrawChart(rows.filter((r) => AMState.selected.has(r.key)), bucket);

}

// Alias publik (dipanggil dari alRefresh(), tombol "Coba Lagi", dan
// watcher Chart.js) — cukup memuat ulang semuanya dari state saat ini.
function amRenderChart() { amLoad(); }

// ---------------------------------------------------------------
// 4. Tabel ringkasan aktivitas — centang baris untuk memilih apa
//    yang tampil di grafik (persis pola tabel pada admin.html).
// ---------------------------------------------------------------

function amRenderSummaryTable(rows) {

    const body = document.getElementById("amSummaryTableBody");
    if (!body) return;

    body.innerHTML = rows.map((r) => `
        <tr class="${AMState.selected.has(r.key) ? "is-sel" : ""}" data-key="${r.key}">
            <td><input type="checkbox" class="am-pick-checkbox" data-k="${r.key}" ${AMState.selected.has(r.key) ? "checked" : ""} aria-label="Plot ${alEscape(r.detail)} on the chart"></td>
            <td>
                <div class="am-type-cell">
                    <span class="am-type-swatch" style="background:${r.color}"></span>
                    ${amActivityTypeLabel(r.type)}
                </div>
            </td>
            <td class="am-detail-cell">${amActivityDetailLabel(r.detail)}</td>
            <td class="am-num"><span class="am-inrange-val">${r.inRange.toLocaleString("en-US")}</span></td>
            <td class="am-num"><span class="am-day-chip">${r.d1.toLocaleString("en-US")}</span></td>
            <td class="am-num">${r.d7.toLocaleString("en-US")}</td>
        </tr>
    `).join("");

    // Klik di baris mana pun (selain langsung di checkbox) ikut men-toggle
    // baris itu, supaya tidak perlu mengarahkan kursor persis ke kotak kecil.
    body.querySelectorAll("tr").forEach((tr) => {
        tr.addEventListener("click", (e) => {
            if (e.target.matches(".am-pick-checkbox")) return;
            const cb = tr.querySelector(".am-pick-checkbox");
            if (cb) cb.click();
        });
    });

    body.querySelectorAll(".am-pick-checkbox").forEach((cb) => {
        cb.addEventListener("change", (e) => {
            const key = e.target.dataset.k;
            if (e.target.checked) {
                AMState.selected.add(key);
            } else {
                if (AMState.selected.size === 1) { e.target.checked = true; return; } // minimal satu baris tetap tercentang
                AMState.selected.delete(key);
            }
            amLoad();
        });
    });

}

// ---------------------------------------------------------------
// 5. Kartu KPI
// ---------------------------------------------------------------

function amRenderStats(rows, prevRows) {

    const byKey = {}; rows.forEach((r) => { byKey[r.key] = r; });
    const prevByKey = {}; prevRows.forEach((r) => { prevByKey[r.key] = r.inRange; });

    const visitors = byKey.visit_id.inRange + byKey.visit_us.inRange + byKey.visit_other.inRange;
    const prevVisitors = (prevByKey.visit_id || 0) + (prevByKey.visit_us || 0) + (prevByKey.visit_other || 0);
    const visitorsDelta = amPct(visitors, prevVisitors);

    const idShare = visitors > 0 ? Math.round((byKey.visit_id.inRange / visitors) * 100) : 0;

    const loginTotal = byKey.login.inRange;
    const loginDelta = amPct(loginTotal, prevByKey.login || 0);

    const calcTotal = byKey.calc_sim.inRange;
    const calcDelta = amPct(calcTotal, prevByKey.calc_sim || 0);

    const setDelta = (id, pct) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = typeof getSavedLanguage === "function" && getSavedLanguage() === "id" ? `${pct >= 0 ? "+" : ""}${pct}% dibanding periode sebelumnya` : `${pct >= 0 ? "+" : ""}${pct}% vs previous period`;
        el.classList.toggle("is-up", pct >= 0);
        el.classList.toggle("is-down", pct < 0);
    };

    const visitorsEl = document.getElementById("amStatVisitors");
    if (visitorsEl) visitorsEl.textContent = visitors.toLocaleString("en-US");
    setDelta("amStatVisitorsDelta", visitorsDelta);

    const idShareEl = document.getElementById("amStatTopCountry");
    if (idShareEl) idShareEl.textContent = `${idShare}%`;

    const loginEl = document.getElementById("amStatLoginTotal");
    if (loginEl) loginEl.textContent = loginTotal.toLocaleString("en-US");
    setDelta("amStatLoginDelta", loginDelta);

    const calcEl = document.getElementById("amStatCalcTotal");
    if (calcEl) calcEl.textContent = calcTotal.toLocaleString("en-US");
    setDelta("amStatCalcDelta", calcDelta);

}

// ---------------------------------------------------------------
// 6. Chart.js readiness watcher (dipertahankan dari versi
//    sebelumnya — supaya area grafik tidak kosong tanpa keterangan
//    kalau Chart.js belum selesai dimuat, dan otomatis pulih begitu
//    library-nya siap, tanpa perlu aksi dari pengguna).
// ---------------------------------------------------------------

let amChartJsReady = false;
let amChartJsWatching = false;
let amChartJsGaveUp = false;

function amWatchChartJsReady(wrap) {

    if (typeof Chart !== "undefined") {
        amChartJsReady = true;
        return;
    }

    if (amChartJsWatching) return;
    amChartJsWatching = true;

    let elapsed = 0;
    const intervalMs = 300;
    const softTimeoutMs = 8000;
    const hardStopMs = 60000;

    const tick = setInterval(() => {

        if (typeof Chart !== "undefined") {
            clearInterval(tick);
            amChartJsWatching = false;
            amChartJsReady = true;
            amChartJsGaveUp = false;
            const liveWrap = document.getElementById("amChartWrap");
            if (liveWrap) {
                liveWrap.classList.remove("am-chart-wrap-empty");
                liveWrap.innerHTML = `<canvas id="amMainChart"></canvas>`;
            }
            amRenderChart();
            return;
        }

        elapsed += intervalMs;

        if (elapsed >= softTimeoutMs && !amChartJsGaveUp) {
            amChartJsGaveUp = true;
            const liveWrap = document.getElementById("amChartWrap");
            if (liveWrap) {
                liveWrap.innerHTML = `
                    <div class="am-chart-empty">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <p>Chart is taking longer than usual to load.</p>
                        <button type="button" class="btn btn-secondary am-chart-retry-btn" id="amChartRetryBtn">
                            <i class="fa-solid fa-rotate-right"></i> Try Again
                        </button>
                    </div>
                `;
                const retryBtn = document.getElementById("amChartRetryBtn");
                if (retryBtn) {
                    retryBtn.addEventListener("click", () => {
                        retryBtn.disabled = true;
                        const icon = retryBtn.querySelector("i");
                        if (icon) icon.classList.add("fa-spin");
                        amRenderChart();
                    });
                }
            }
        }

        if (elapsed >= hardStopMs) {
            clearInterval(tick);
            amChartJsWatching = false;
        }

    }, intervalMs);

}

// ---------------------------------------------------------------
// 7. Menggambar grafik (Line / Bar / Stacked Bar / 100% Stacked)
//    dari baris-baris yang tercentang pada tabel ringkasan.
// ---------------------------------------------------------------

function amDrawChart(rows, bucket) {

    const canvas = document.getElementById("amMainChart");
    const wrap = document.getElementById("amChartWrap") || canvas?.closest(".am-chart-wrap");
    if (!canvas) return;

    if (typeof Chart === "undefined") {
        if (wrap && !wrap.querySelector(".am-chart-empty")) {
            wrap.classList.add("am-chart-wrap-empty");
            wrap.innerHTML = `
                <div class="am-chart-empty">
                    <i class="fa-solid fa-chart-line fa-spin"></i>
                    <p>Loading chart component&hellip;</p>
                </div>
            `;
        }
        amWatchChartJsReady(wrap);
        return;
    }

    amChartJsReady = true;

    const selLbl = document.getElementById("amSelLbl");
    if (selLbl) selLbl.textContent = typeof getSavedLanguage === "function" && getSavedLanguage() === "id" ? `${rows.length} seri dipilih` : `${rows.length} series selected`;

    if (AMState.chart) { AMState.chart.destroy(); AMState.chart = null; }

    if (!rows.length) {
        if (wrap) {
            wrap.classList.add("am-chart-wrap-empty");
            wrap.innerHTML = `<div class="am-chart-empty"><i class="fa-solid fa-table-list"></i><p>${typeof getSavedLanguage === "function" && getSavedLanguage() === "id" ? "Centang baris di atas untuk menampilkannya pada grafik." : "Tick a row above to plot it."}</p></div>`;
        }
        return;
    }

    if (!document.getElementById("amMainChart")) {
        wrap.classList.remove("am-chart-wrap-empty");
        wrap.innerHTML = `<canvas id="amMainChart"></canvas>`;
    }
    const freshCanvas = document.getElementById("amMainChart");

    const isPercent = AMState.chartType === "percent";
    const isStacked = AMState.chartType === "stacked" || isPercent;
    const chartJsType = AMState.chartType === "line" ? "line" : "bar";

    const isId = typeof getSavedLanguage === "function" && getSavedLanguage() === "id";
    const idMonths = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const enMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const months = isId ? idMonths : enMonths;
    const labels = rows[0].points.map((p) => {
        if (bucket === "month") return `${months[p.t.getMonth()]} ${String(p.t.getFullYear()).slice(-2)}`;
        return amFormatShort(p.t);
    });

    let plotDatasets;

    if (isPercent) {
        const dateTotals = labels.map((_, i) => rows.reduce((s, r) => s + r.points[i].v, 0) || 1);
        plotDatasets = rows.map((r) => ({
            label: amActivityDetailLabel(r.detail),
            data: r.points.map((p, i) => +((p.v / dateTotals[i]) * 100).toFixed(1)),
            backgroundColor: r.color,
            borderRadius: 3,
            stack: "s",
        }));
    } else {
        plotDatasets = rows.map((r) => {
            const base = {
                label: amActivityDetailLabel(r.detail),
                data: r.points.map((p) => p.v),
                borderColor: r.color,
                backgroundColor: chartJsType === "line" ? r.color + "26" : r.color,
            };
            if (chartJsType === "line") {
                Object.assign(base, { tension: 0.35, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2.2, fill: true });
            } else {
                Object.assign(base, { borderRadius: 4, stack: isStacked ? "s" : undefined });
            }
            return base;
        });
    }

    const config = {
        type: chartJsType,
        data: { labels, datasets: plotDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11, family: "Poppins" } } },
                tooltip: {
                    titleFont: { family: "Poppins", size: 12 },
                    bodyFont: { family: "Poppins", size: 11.5 },
                    callbacks: {
                        label(ctx) {
                            const suffix = isPercent ? "%" : "";
                            return `${ctx.dataset.label}: ${ctx.formattedValue}${suffix}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    stacked: isStacked,
                    grid: { display: false },
                    ticks: { font: { size: 10.5, family: "Poppins" }, color: "#7C8B8D", maxRotation: 0, autoSkip: true, maxTicksLimit: labels.length > 30 ? 10 : 12 },
                },
                y: {
                    stacked: isStacked,
                    beginAtZero: true,
                    max: isPercent ? 100 : undefined,
                    grid: { color: "#EEF2F2" },
                    ticks: {
                        font: { size: 10.5, family: "Poppins" }, color: "#7C8B8D",
                        callback: (v) => isPercent ? `${v}%` : v,
                    },
                },
            },
        },
    };

    AMState.chart = new Chart(freshCanvas.getContext("2d"), config);

}

// ---------------------------------------------------------------
// 8. Export (data seri yang sedang tercentang & terplot)
// ---------------------------------------------------------------

function amExportCsv() {

    const r = amRange();
    if (!r) { if (typeof showToast === "function") showToast("Set a valid date range first.", "warning"); return; }
    const [from, to] = r;
    const days = Math.round((to - from) / 864e5) + 1;
    const bucket = amBucketOf(days);

    const rows = AM_ACTIVITIES
        .filter((a) => AMState.selected.has(a.key))
        .map((a) => Object.assign({}, a, { points: amRollup(amSeriesFor(a.key, from, to), bucket) }));

    if (!rows.length) {
        if (typeof showToast === "function") showToast("Tick at least one activity to export.", "warning");
        return;
    }

    const header = ["Date", ...rows.map((r) => r.detail.replace(/,/g, " "))];
    const lines = [header.join(",")];

    rows[0].points.forEach((_, i) => {
        const dateStr = alDateInputValue(rows[0].points[i].t);
        const line = [dateStr, ...rows.map((r) => r.points[i].v)];
        lines.push(line.join(","));
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-activity-analytics-${alDateInputValue(from)}-to-${alDateInputValue(to)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (typeof showToast === "function") showToast("Activity analytics data exported.", "success");

}

// ---------------------------------------------------------------
// 9. Init
// ---------------------------------------------------------------

function initDashboardActivityAnalytics() {

    if (!document.getElementById("amMainChart")) return;

    amSetPresetRange(30); // sesuai preset "30d" yang aktif secara default pada HTML
    amLoad();

    document.getElementById("amChartTypeSeg").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-chart-type]");
        if (!btn) return;
        AMState.chartType = btn.dataset.chartType;
        document.querySelectorAll("#amChartTypeSeg .am-seg-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
        amLoad();
    });

    document.getElementById("amPresetSeg").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-preset]");
        if (!btn) return;
        document.querySelectorAll("#amPresetSeg .am-seg-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
        amSetPresetRange(parseInt(btn.dataset.preset, 10));
        amLoad();
    });

    ["amFromDate", "amToDate"].forEach((id) => {
        document.getElementById(id).addEventListener("change", () => {
            // Rentang diubah manual — lepaskan status "aktif" dari preset cepat
            // supaya tidak menyesatkan (rentangnya sudah bukan preset itu lagi).
            document.querySelectorAll("#amPresetSeg .am-seg-btn").forEach((b) => b.classList.remove("is-active"));
            amLoad();
        });
    });

    document.getElementById("amExportBtn").addEventListener("click", amExportCsv);

}


// Re-render language-sensitive Activity Log content immediately when EN/ID changes.
document.addEventListener("edash:languagechange", () => {
  try {
    if (typeof alRenderStats === "function") alRenderStats();
    if (typeof alRenderTable === "function") alRenderTable();
    if (typeof alUpdateTypeMsUI === "function") alUpdateTypeMsUI();
  } catch (e) {}
  try {
    amLocalizeSummaryHint();
    if (typeof amLoad === "function") amLoad();
  } catch (e) {}
});
