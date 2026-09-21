// =====================================================================
// Solar Calculator (public, pre-login) — 360eDash
// Estimator aligned with the internal Smart Solar Planner's core
// engine (facility load-curve profiles, Gaussian solar production
// curve, end-user/direct-purchase financial model) — kept to the same
// 6-field public form. Two simplifications vs. the internal tool:
//   1. Solar day window (start/peak/end) is fixed at 07:00 / 12:30 /
//      18:00 instead of being solved for — production is still scaled
//      so its daily total matches the province's PV potential exactly.
//   2. Roof-area limits, financing/BOT/leasing options, and the
//      admin-only developer model are out of scope for this public,
//      pre-login lead-gen page.
// =====================================================================

// =====================================================================
// Nominal (Rupiah) input formatting — adds thousand-separator dots as
// the user types (e.g. "16800000" -> "16.800.000"), while the actual
// numeric value used by the calculator is parsed back from the
// formatted string (dots stripped) wherever it's read.
// =====================================================================

function formatThousands(digitsOnly) {
    return digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseFormattedNumber(str) {
    return parseFloat(String(str || "").replace(/\./g, "")) || 0;
}

function initNominalInputFormatting(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener("input", () => {
        const digitsOnly = input.value.replace(/\D/g, "");
        input.value = digitsOnly ? formatThousands(digitsOnly) : "";
    });
}

document.addEventListener("DOMContentLoaded", () => {

    if (typeof trackPageVisit === "function") trackPageVisit();
    if (typeof trackMarketingPageView === "function") trackMarketingPageView();
    if (typeof captureUtmParams === "function") captureUtmParams();
    initProvinces();
    initTariffToggle();
    initEnergyInputToggle();
    initRoofAreaToggle();
    initTealFillSlider("usableRoofPercent", "usableRoofPercentValue");
    initTealFillSlider("solarDiscountInput", "solarDiscountInputValue");
    initAdminSettingsModal();
    initNominalInputFormatting("billInput");
    initNominalInputFormatting("costPerKwpInput");
    initCalcForm();
    initReactiveCalcInputs();
    initBatteryScenario();
    initBatteryInfoPopover();
    initInputInfoPopovers();
    initInputTracking();
    initEmailGate();
    initPdfDownload();
    initLangToggle();
    initYearlyTableToggle();
    initWaWidget();
    initChartResize();
    initDetailTabs();
    initFinanceSubTabs();
    preloadPdfLogo();

});

// ---------------------------------------------------------------------
// Preloads the 360energy logo (same file as the topbar's <img
// class="calc-topbar__logo">) as a data URL so the PDF watermark can
// stamp the actual logo image instead of a text wordmark. Fetched once
// on page load and cached in PDF_LOGO_DATA_URL — by the time the user
// reaches the (gated) PDF download button this has long since resolved,
// but pdfWatermark() still falls back to the old text wordmark if for
// any reason the image isn't ready yet.
// ---------------------------------------------------------------------
let PDF_LOGO_DATA_URL = null;
let PDF_LOGO_ASPECT = 1;

function preloadPdfLogo() {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        try {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext("2d").drawImage(img, 0, 0);
            PDF_LOGO_DATA_URL = canvas.toDataURL("image/png");
            PDF_LOGO_ASPECT = img.naturalWidth / img.naturalHeight;
        } catch (err) {
            console.warn("PDF logo preload failed:", err);
        }
    };
    img.onerror = () => console.warn("PDF logo image failed to load");
    img.src = "../assets/logo2.png";
}

// ---------------------------------------------------------------
// Activity Log (internal) — catat 1 kunjungan setiap kali halaman
// publik ini di-load. Ini yang mengisi "Visitors from Indonesia /
// United States / elsewhere" pada Dashboard Activity Analytics
// (negara ditentukan backend dari IP request, bukan dikarang di sini).
// ---------------------------------------------------------------
function trackPageVisit() {
    if (typeof logActivity !== "function") return;
    logActivity({
        eventType: "page_visit",
        user: sessionStorage.getItem("edash-solar-lead-email") || "Anonymous",
        status: "success",
        detail: "Visited the Solar Calculator landing page",
    });
}

// ---------------------------------------------------------------
// Marketing Analytics (Meta Pixel mirror) — mencatat "PageView" yang
// sama dengan yang dikirim fbq('track','PageView') di inline script
// pages/solar-calculator.html, ke storage kita sendiri (lihat
// js/marketing-pixel-client.js). TIDAK mengubah/menyentuh Pixel itu
// sendiri, hanya observer tambahan di sebelahnya.
// ---------------------------------------------------------------
function trackMarketingPageView() {
    if (typeof trackMarketingEvent !== "function") return;
    if (typeof fbq !== "function") return; // hanya catat kalau Pixel benar-benar aktif/terkirim
    trackMarketingEvent("PageView", { ...getUtmParams() }, "Solar Calculator landing page loaded");
}


// Keep the Daily Production and Annual Bills charts matched to their
// container's real width (see buildProductionChartSvg / buildAnnualBillsChartSvg)
// even after the initial render - e.g. when the browser window is resized,
// or the layout reflows for any other reason. Debounced so a resize drag
// doesn't force a re-render on every intermediate frame.
// Ringkasan / Finansial / Teknis tabs inside the unlocked breakdown.
// Charts measure their container's real width via getBoundingClientRect()
// at render time, which returns 0 while a tab is [hidden] — so switching
// tabs re-fires the same renderers initChartResize() uses, otherwise the
// chart in a tab you hadn't opened yet would render blank/squashed.
// Moves the single #lockOverlay (email-gate card) so it always lives
// inside the currently-active tab panel's .calc-tab-locked wrapper.
// That wrapper is position:relative and #lockOverlay is position:absolute
// inset:0 (see CSS), so the overlay only ever covers that panel's locked
// portion — never the tab nav or the free-preview block above it, which
// is what keeps tab-switching and the preview stats clickable while
// the section is still locked.
function placeLockOverlayInActiveTab() {
    const overlay = document.getElementById("lockOverlay");
    const activePanel = document.querySelector(".calc-tab-panel:not([hidden])");
    if (!overlay || !activePanel) return;
    const target = activePanel.querySelector(".calc-tab-locked");
    if (target && overlay.parentElement !== target) {
        target.appendChild(overlay);
    }
}

function initDetailTabs() {
    const tabs = document.getElementById("detailTabs");
    if (!tabs) return;

    tabs.addEventListener("click", (e) => {
        const btn = e.target.closest(".calc-tab");
        if (!btn) return;
        const target = btn.dataset.tab;

        tabs.querySelectorAll(".calc-tab").forEach((b) => {
            const active = b === btn;
            b.classList.toggle("is-active", active);
            b.setAttribute("aria-selected", active ? "true" : "false");
        });

        document.querySelectorAll(".calc-tab-panel").forEach((panel) => {
            const active = panel.dataset.tabPanel === target;
            panel.classList.toggle("is-active", active);
            panel.hidden = !active;
        });

        placeLockOverlayInActiveTab();

        if (!lastResult) return;
        if (target === "summary") {
            renderProductionChart(lastResult);
        } else if (target === "financial") {
            renderAnnualBillsChart(lastResult);
        } else if (target === "technical") {
            renderConsumptionChart(lastResult);
            updateBatteryScenarioInfo(lastResult);
        }
    });
}

function initFinanceSubTabs() {
    const switcher = document.getElementById("financeSwitch");
    if (!switcher) return;

    switcher.addEventListener("click", (e) => {
        const btn = e.target.closest(".calc-finance-switch__btn");
        if (!btn) return;
        const target = btn.dataset.financeTab;

        switcher.querySelectorAll(".calc-finance-switch__btn").forEach((b) => {
            const active = b === btn;
            b.classList.toggle("is-active", active);
            b.setAttribute("aria-selected", active ? "true" : "false");
        });

        document.querySelectorAll(".calc-finance-panel").forEach((panel) => {
            const active = panel.dataset.financePanel === target;
            panel.classList.toggle("is-active", active);
            panel.hidden = !active;
        });
    });
}

function initChartResize() {
    let resizeTimer = null;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (!lastResult) return;
            renderProductionChart(lastResult);
            renderAnnualBillsChart(lastResult);
            renderConsumptionChart(lastResult);
            updateBatteryScenarioInfo(lastResult);
        }, 150);
    });
}

// =====================================================================
// UTM capture — dibaca sekali dari URL saat halaman dibuka (mis. link
// iklan Instagram: ?utm_source=instagram&utm_medium=cpc&utm_campaign=...),
// lalu disimpan ke sessionStorage supaya tetap "nempel" sepanjang sesi
// (kalau user pindah-pindah tab/step di halaman ini, param URL aslinya
// bisa aja udah nggak ada lagi). Dipakai oleh trackCalculatorEvent(),
// trackLeadEvent(), dan submitLeadToBackend() di bawah.
// =====================================================================

function captureUtmParams() {

    const params = new URLSearchParams(window.location.search);
    const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    const storageKey = "edash-solar-utm";

    // Hanya overwrite kalau URL saat ini benar-benar bawa UTM param baru,
    // supaya UTM pertama kali (dari klik iklan) nggak ketimpa kalau nanti
    // user reload halaman tanpa UTM di URL-nya.
    const hasNewUtm = keys.some((k) => params.get(k));

    if (hasNewUtm) {
        const utm = {};
        keys.forEach((k) => { if (params.get(k)) utm[k] = params.get(k); });
        try { sessionStorage.setItem(storageKey, JSON.stringify(utm)); } catch (err) { /* non-critical */ }
    }

    console.log("UTM Source:", params.get("utm_source"));

}

function getUtmParams() {
    try {
        return JSON.parse(sessionStorage.getItem("edash-solar-utm") || "{}");
    } catch (err) {
        return {};
    }
}

// =====================================================================
// Solar Calculator language switcher
// The public calculator does not load main.js, so it cannot use the
// dashboard's universal i18n layer. Keep a self-contained EN/ID layer here
// and apply it to static + dynamically rendered calculator content.
// =====================================================================
const SOLAR_I18N = [
    ["360eDash — Solar Calculator", "360eDash — Kalkulator Surya"],
    ["Smart Solar Planner", "Perencana Surya Cerdas"],
    ["Calculate your facility's rooftop solar potential in seconds.", "Hitung potensi tenaga surya atap fasilitas Anda dalam hitungan detik."],
    ["Home", "Beranda"], ["Sign In", "Masuk"], ["Enter Your Project Details", "Masukkan Detail Proyek Anda"],
    ["Initial estimate — for an official quote, our team will conduct a further site survey.", "Estimasi awal — untuk penawaran resmi, tim kami akan melakukan survei lokasi lebih lanjut."],
    ["Country", "Negara"], ["Country Name", "Nama Negara"], ["Facility Province", "Provinsi Fasilitas"], ["City / Regency", "Kota / Kabupaten"],
    ["Facility Type", "Jenis Fasilitas"], ["Restaurant", "Restoran"], ["Office", "Kantor"], ["Mall / Retail", "Mal / Ritel"], ["Hospital", "Rumah Sakit"],
    ["Factory 24/7", "Pabrik 24/7"], ["Factory 1 Shift", "Pabrik 1 Shift"], ["Residential Complex", "Kompleks Perumahan"], ["Street Lighting", "Penerangan Jalan"], ["Other", "Lainnya"],
    ["Installed PLN Power Capacity (kVA)", "Kapasitas Daya PLN Terpasang (kVA)"], ["PLN Tariff Category", "Kategori Tarif PLN"], ["Custom PLN Tariff (Rp/kWh)", "Tarif PLN Kustom (Rp/kWh)"],
    ["Isi data tagihan listrik bulanan Anda", "Isi data tagihan listrik bulanan Anda"], ["Daily Energy (kWh)", "Energi Harian (kWh)"], ["Monthly Bill (IDR)", "Tagihan Bulanan (IDR)"],
    ["Total Daily Energy Use (kWh)", "Total Penggunaan Energi Harian (kWh)"], ["Total Monthly Electricity Bill (Rp)", "Total Tagihan Listrik Bulanan (Rp)"],
    ["Limit by Roof Area", "Batasi berdasarkan Luas Atap"], ["Total Roof Area (m²)", "Total Luas Atap (m²)"], ["Usable Roof Area (%)", "Luas Atap yang Dapat Digunakan (%)"],
    ["Calculate Estimate", "Hitung Estimasi"], ["Your estimate will appear here", "Estimasi Anda akan muncul di sini"],
    ["Fill in the form and click \"Calculate Estimate\" to see your facility's solar system potential.", "Isi formulir dan klik \"Hitung Estimasi\" untuk melihat potensi sistem surya fasilitas Anda."],
    ["Estimated Monthly Savings", "Perkiraan Penghematan Bulanan"], ["Solar System Size", "Ukuran Sistem Surya"], ["Save up to", "Hemat hingga"], ["on your electricity costs over 20 years", "dari biaya listrik Anda selama 20 tahun"],
    ["Unlock your full report for production charts, investment breakdown, payback period, and environmental impact.", "Buka laporan lengkap untuk melihat grafik produksi, rincian investasi, periode pengembalian modal, dan dampak lingkungan."],
    ["Full Breakdown & Investment Projection", "Rincian Lengkap & Proyeksi Investasi"], ["Summary", "Ringkasan"], ["Financial", "Finansial"], ["Technical", "Teknis"],
    ["Payback Period (Planner NCF)", "Periode Pengembalian Modal (NCF Planner)"], ["your estimated investment payback", "perkiraan pengembalian investasi Anda"],
    ["Solar Energy Coverage", "Cakupan Energi Surya"], ["of total daily electricity consumption", "dari total konsumsi listrik harian"],
    ["If you go solar, over 20 years you'll save", "Jika Anda menggunakan tenaga surya, selama 20 tahun Anda akan menghemat"], ["that's", "yaitu"], ["off your total bill vs. staying 100% on PLN", "dari total tagihan dibandingkan tetap 100% menggunakan PLN"],
    ["Monthly bill", "Tagihan bulanan"], ["System size", "Ukuran sistem"], ["solar panels", "panel surya"], ["Tariff", "Tarif"], ["Offset", "Pengurangan emisi"], ["like planting", "setara dengan menanam"], ["mangrove", "mangrove"],
    ["Stay on PLN", "Tetap menggunakan PLN"], ["Go solar", "Beralih ke surya"], ["Estimated Daily Production vs. Consumption", "Perkiraan Produksi Harian vs. Konsumsi"], ["Battery Storage", "Penyimpanan Baterai"],
    ["Consumption", "Konsumsi"], ["Solar Production", "Produksi Surya"], ["Self-consumed", "Digunakan sendiri"], ["Environmental Impact & CSR Equivalent (20 Years)", "Dampak Lingkungan & Setara CSR (20 Tahun)"],
    ["Total Emission Reduction", "Total Pengurangan Emisi"], ["Average Annual Reduction", "Rata-rata Pengurangan Tahunan"], ["Mangrove Forest Equivalent", "Setara Hutan Mangrove"], ["Equivalent Trees", "Setara Pohon"],
    ["Solar Leasing Tariff (BOT)", "Tarif Sewa Surya (BOT)"], ["Choose How You'd Like to Go Solar", "Pilih Cara Anda Beralih ke Tenaga Surya"], ["Solar Leasing", "Sewa Surya"], ["No upfront cost", "Tanpa biaya di muka"], ["Direct Purchase", "Pembelian Langsung"], ["You own the system", "Sistem menjadi milik Anda"],
    ["Pay a lower monthly rate than PLN with", "Bayar tarif bulanan lebih rendah dari PLN dengan"], ["zero upfront investment", "tanpa investasi di muka"], ["— 360energy owns, installs, and maintains the system for you.", "— 360energy memiliki, memasang, dan memelihara sistem untuk Anda."],
    ["new monthly bill", "tagihan bulanan baru"], ["Total Project Savings (20yr)", "Total Penghematan Proyek (20 tahun)"], ["Pay for the system upfront and", "Bayar sistem di muka dan"], ["own it outright", "miliki sepenuhnya"],
    ["— the biggest long-term savings, with your investment paid back in just a few years.", "— penghematan jangka panjang terbesar, dengan investasi Anda kembali dalam beberapa tahun."], ["Estimated system investment", "Perkiraan investasi sistem"],
    ["Year 0", "Tahun 0"], ["Year 20", "Tahun 20"], ["Paying off investment", "Pelunasan investasi"], ["Pure savings, no more payments", "Penghematan murni, tanpa pembayaran lagi"],
    ["NPV (Planner NCF, 8%)", "NPV (NCF Planner, 8%)"], ["IRR (Planner NCF)", "IRR (NCF Planner)"], ["Planner NCF Payback", "Payback NCF Planner"], ["Planner Discounted Payback", "Payback Diskonto Planner"], ["Planner NPV", "NPV Planner"], ["Planner IRR (NCF)", "IRR Planner (NCF)"], ["Direct Purchase Payback", "Payback Pembelian Langsung"], ["Total savings over 20 years", "Total penghematan selama 20 tahun"],
    ["Electricity Bill: Now vs. Solar", "Tagihan Listrik: Sekarang vs. Surya"], ["Your electricity bill goes up every year as PLN tariffs increase. Here's how your annual bill compares at a few points in time, with and without solar.", "Tagihan listrik Anda naik setiap tahun seiring kenaikan tarif PLN. Berikut perbandingan tagihan tahunan Anda pada beberapa titik waktu, dengan dan tanpa tenaga surya."],
    ["Save Rp -- in Year 1 → save Rp --/year by Year 20", "Hemat Rp -- pada Tahun 1 → hemat Rp --/tahun pada Tahun 20"], ["With Solar", "Dengan Surya"], ["Outright Purchase: Annual Financial Breakdown", "Pembelian Langsung: Rincian Keuangan Tahunan"], ["Expand Table", "Buka Tabel"],
    ["Year", "Tahun"], ["Savings (Rp)", "Penghematan (Rp)"], ["OpEx (Rp)", "OpEx (Rp)"], ["NCF (Rp)", "NCF (Rp)"], ["Cum. NCF (Rp)", "NCF Kumulatif (Rp)"], ["Load & Billing Snapshot", "Ringkasan Beban & Tagihan"], ["Base Load", "Beban Dasar"], ["Additional Peak Load", "Beban Puncak Tambahan"], ["Installed PLN Capacity", "Kapasitas PLN Terpasang"], ["Prep / Idle Load", "Beban Persiapan / Idle"], ["Daily Cost (Pre-Solar)", "Biaya Harian (Pra-Surya)"], ["Monthly Bill (Pre-Solar)", "Tagihan Bulanan (Pra-Surya)"],
    ["Solar PV System", "Sistem PV Surya"], ["Number of Panels", "Jumlah Panel"], ["Total Panel Area", "Total Luas Panel"], ["Max Output Power", "Daya Output Maksimal"], ["Estimated Energy Performance (Year 1)", "Perkiraan Performa Energi (Tahun 1)"], ["Daily Solar Consumption", "Konsumsi Surya Harian"], ["Daily Grid Import", "Impor Grid Harian"], ["Daily Excess Surplus", "Surplus Berlebih Harian"], ["Energy Stored in Battery", "Energi Tersimpan dalam Baterai"], ["Total Daily Production", "Total Produksi Harian"], ["Daily Specific Yield", "Hasil Spesifik Harian"], ["Daily Solar Mix", "Bauran Surya Harian"],
    ["Battery Storage Scenario", "Skenario Penyimpanan Baterai"], ["(Estimate)", "(Estimasi)"], ["Available Solar Surplus", "Surplus Surya Tersedia"], ["Estimated Battery Capacity", "Perkiraan Kapasitas Baterai"], ["Stored Energy", "Energi Tersimpan"], ["Discharged Energy", "Energi yang Dikeluarkan"], ["Battery Round-trip Efficiency", "Efisiensi Siklus Baterai"],
    ["Unlock the full breakdown & report", "Buka rincian lengkap & laporan"], ["Enter your email to view investment details, payback period, and download the estimate report as a PDF.", "Masukkan email Anda untuk melihat detail investasi, periode pengembalian modal, dan mengunduh laporan estimasi sebagai PDF."],
    ["Type", "Tipe"], ["Personal", "Pribadi"], ["Company", "Perusahaan"], ["Government", "Pemerintah"], ["Unlock Details & Report", "Buka Detail & Laporan"], ["All your information is only used to provide your solar estimate and quotation.", "Semua informasi Anda hanya digunakan untuk memberikan estimasi dan penawaran tenaga surya."], ["Download Report (PDF)", "Unduh Laporan (PDF)"], ["Continue to Official Quote", "Lanjutkan ke Penawaran Resmi"],
    ["Privacy Policy", "Kebijakan Privasi"], ["Settings", "Pengaturan"], ["Sign in to view and adjust settings for this calculator.", "Masuk untuk melihat dan menyesuaikan pengaturan kalkulator ini."], ["Username", "Nama Pengguna"], ["Password", "Kata Sandi"], ["Gunakan Harga Live dari Katalog", "Gunakan Harga Live dari Katalog"], ["Cost per kWp & biaya SLO/NIDI dihitung otomatis dari harga", "Cost per kWp & biaya SLO/NIDI dihitung otomatis dari harga"], ["Terbaru (Live)", "Terbaru (Live)"], ["Reset ke Harga Katalog", "Reset ke Harga Katalog"],
    ["Direct Purchase Profit Margin (%)", "Margin Keuntungan Pembelian Langsung (%)"], ["Cost per kWp (Rp)", "Biaya per kWp (Rp)"], ["BOT Tariff Efficiency Savings (%)", "Penghematan Efisiensi Tarif BOT (%)"], ["Min. BOT Threshold — Jabodetabek (kWp)", "Ambang Minimum BOT — Jabodetabek (kWp)"], ["Min. BOT Threshold — Java, Non-Jabodetabek (kWp)", "Ambang Minimum BOT — Jawa, Non-Jabodetabek (kWp)"], ["Min. BOT Threshold — Outside Java (kWp)", "Ambang Minimum BOT — Luar Jawa (kWp)"], ["Max Direct Purchase Payback (Years)", "Maks. Payback Pembelian Langsung (Tahun)"], ["Done", "Selesai"], ["Invalid username or password.", "Nama pengguna atau kata sandi tidak valid."],
    ["Latest", "Terbaru"], ["Active Catalog Price", "Harga Katalog Aktif"], ["Price", "Harga"], ["Created", "Dibuat"], ["Cost per kWp (live)", "Biaya per kWp (live)"], ["system", "sistem"], ["kWp", "kWp"], ["No data", "Tidak ada data"], ["Category", "Kategori"], ["Not found in catalog", "Tidak ditemukan di katalog"],
];

const SOLAR_I18N_MAP = new Map();
SOLAR_I18N.forEach(([en, id]) => {
    SOLAR_I18N_MAP.set(en, { en, id });
    SOLAR_I18N_MAP.set(id, { en, id });
});

function solarGetLanguage() {
    try { return localStorage.getItem("edash-lang") === "id" ? "id" : "en"; } catch (_) { return "en"; }
}

function solarTranslateValue(value, lang) {
    if (!value || !value.trim()) return value;
    let out = value;
    const trimmed = value.trim();
    const pair = SOLAR_I18N_MAP.get(trimmed);
    if (pair) return value.replace(trimmed, pair[lang]);

    const replacements = lang === "id" ? [
        ["Estimated system investment", "Perkiraan investasi sistem"], ["new monthly bill", "tagihan bulanan baru"], ["save", "hemat"],
        ["per year", "per tahun"], ["Year", "Tahun"], ["years", "tahun"], ["year", "tahun"], ["Monthly", "Bulanan"], ["Daily", "Harian"],
        ["Solar", "Surya"], ["Consumption", "Konsumsi"], ["Production", "Produksi"], ["Savings", "Penghematan"], ["Investment", "Investasi"],
        ["Battery", "Baterai"], ["Stored", "Tersimpan"], ["Discharged", "Dikeluarkan"], ["Available", "Tersedia"], ["Estimated", "Perkiraan"], ["Total", "Total"],
        ["Average", "Rata-rata"], ["Reduction", "Pengurangan"], ["Equivalent", "Setara"], ["Installed", "Terpasang"], ["Power", "Daya"], ["Capacity", "Kapasitas"],
        ["Tariff", "Tarif"], ["Cost", "Biaya"], ["Purchase", "Pembelian"], ["Direct", "Langsung"], ["Leasing", "Sewa"], ["Payback", "Payback"], ["Report", "Laporan"],
    ] : [
        ["Perkiraan investasi sistem", "Estimated system investment"], ["tagihan bulanan baru", "new monthly bill"], ["hemat", "save"], ["per tahun", "per year"], ["Tahun", "Year"],
        ["tahun", "years"], ["Bulanan", "Monthly"], ["Harian", "Daily"], ["Surya", "Solar"], ["Konsumsi", "Consumption"], ["Produksi", "Production"], ["Penghematan", "Savings"],
        ["Investasi", "Investment"], ["Baterai", "Battery"], ["Tersimpan", "Stored"], ["Dikeluarkan", "Discharged"], ["Tersedia", "Available"], ["Perkiraan", "Estimated"],
        ["Rata-rata", "Average"], ["Pengurangan", "Reduction"], ["Setara", "Equivalent"], ["Terpasang", "Installed"], ["Daya", "Power"], ["Kapasitas", "Capacity"],
        ["Pembelian", "Purchase"], ["Langsung", "Direct"], ["Sewa", "Leasing"], ["Laporan", "Report"],
    ];
    replacements.forEach(([a, b]) => { out = out.replace(new RegExp(`\\b${a.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "g"), b); });
    return out;
}

function applyWaLanguage(lang = solarGetLanguage()) {
    const normalized = lang === "id" ? "id" : "en";
    const text = document.getElementById("waPopupText");
    const sign = document.getElementById("waPopupSign");
    const close = document.getElementById("waPopupClose");
    const chatBtn = document.getElementById("waWidgetBtn");

    if (text) {
        text.textContent = normalized === "id"
            ? "Hai, terima kasih telah mengunjungi 360energy. Kami membantu bisnis merancang & memasang sistem panel surya yang tepat untuk memaksimalkan penghematan listrik mereka. Jangan ragu untuk menghubungi kami melalui chat ini."
            : "Hi, thanks for visiting 360energy. We help businesses design & install the right solar panel system to maximize their electricity savings. Feel free to reach out through this chat.";
    }
    if (sign) sign.textContent = normalized === "id" ? "Tim 360energy" : "360energy Team";
    if (close) close.setAttribute("aria-label", normalized === "id" ? "Tutup" : "Close");

    const message = normalized === "id"
        ? "Hai 360energy, saya ingin bertanya tentang panel surya untuk fasilitas saya."
        : "Hi 360energy, I'd like to ask about solar panels for my facility.";
    const href = "https://wa.me/6287775760575?text=" + encodeURIComponent(message);

    const popupLink = document.querySelector(".wa-popup__link");
    if (popupLink) popupLink.href = href;
    if (chatBtn) {
        chatBtn.href = href;
        chatBtn.setAttribute("aria-label", normalized === "id" ? "Chat melalui WhatsApp" : "Chat via WhatsApp");
    }
}

function solarApplyLanguage(lang = solarGetLanguage()) {
    const normalized = lang === "id" ? "id" : "en";
    const label = document.getElementById("calcLangCurrent");
    if (label) label.textContent = normalized.toUpperCase();
    document.documentElement.setAttribute("lang", normalized === "id" ? "id" : "en");

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
        const parent = node.parentElement;
        if (!node.nodeValue || !node.nodeValue.trim() || (parent && ["SCRIPT", "STYLE"].includes(parent.tagName))) return;
        const next = solarTranslateValue(node.nodeValue, normalized);
        if (next !== node.nodeValue) node.nodeValue = next;
    });

    document.querySelectorAll("input[placeholder], textarea[placeholder], [aria-label], [title]").forEach(el => {
        ["placeholder", "aria-label", "title"].forEach(attr => {
            const v = el.getAttribute(attr);
            if (!v) return;
            const next = solarTranslateValue(v, normalized);
            if (next !== v) el.setAttribute(attr, next);
        });
    });

    document.querySelectorAll("option").forEach(option => {
        const next = solarTranslateValue(option.textContent, normalized);
        if (next !== option.textContent) option.textContent = next;
    });

    applyWaLanguage(normalized);
    try { localStorage.setItem("edash-lang", normalized); } catch (_) {}
}

function initLangToggle() {
    const btn = document.getElementById("calcLangToggle");
    if (!btn) return;
    const initial = solarGetLanguage();
    solarApplyLanguage(initial);
    btn.addEventListener("click", () => {
        const next = solarGetLanguage() === "id" ? "en" : "id";
        solarApplyLanguage(next);
    });

    if (!window.__solarLanguageObserver && document.body) {
        window.__solarLanguageObserver = new MutationObserver(() => {
            clearTimeout(window.__solarLanguageTimer);
            window.__solarLanguageTimer = setTimeout(() => solarApplyLanguage(solarGetLanguage()), 0);
        });
        window.__solarLanguageObserver.observe(document.body, { childList: true, subtree: true });
    }
}

// =====================================================================
// Floating WhatsApp chat widget — auto-opens a greeting bubble 5s after
// the page loads (once per session), closable via its own button.
// =====================================================================

function initWaWidget() {
    applyWaLanguage(solarGetLanguage());

    const popup = document.getElementById("waPopup");
    const closeBtn = document.getElementById("waPopupClose");
    if (!popup) return;

    const dismissedKey = "edash-solar-wa-popup-dismissed";

    if (!sessionStorage.getItem(dismissedKey)) {
        setTimeout(() => {
            popup.hidden = false;
        }, 5000);
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            popup.hidden = true;
            try { sessionStorage.setItem(dismissedKey, "1"); } catch (err) { /* non-critical */ }
        });
    }

}

// =====================================================================
// Public-calculator reference data — approximate regional solar-yield estimates
// =====================================================================

// Approximate province-level PV yield used for the public estimate (kWh/kWp/day).
// City/Regency is collected for location context; it does not override the
// province-level yield unless a future site-specific dataset is added.
const PV_POTENTIAL_DATA = {
    "Aceh": 3.873, "Sumatera Utara": 3.621, "Sumatera Barat": 3.180, "Riau": 3.594,
    "Kepulauan Riau": 3.555, "Jambi": 3.408, "Sumatera Selatan": 3.454, "Bengkulu": 3.687,
    "Lampung": 3.589, "Kepulauan Bangka Belitung": 3.621, "DKI Jakarta": 3.824,
    "Jawa Barat": 3.950, "Jawa Tengah": 4.048, "DI Yogyakarta": 3.519, "Jawa Timur": 4.226,
    "Banten": 3.774, "Bali": 4.317, "Nusa Tenggara Barat": 4.310, "Nusa Tenggara Timur": 4.353,
    "Kalimantan Barat": 3.355, "Kalimantan Tengah": 3.165, "Kalimantan Selatan": 3.303,
    "Kalimantan Timur": 3.404, "Kalimantan Utara": 3.684, "Sulawesi Utara": 4.119,
    "Sulawesi Tengah": 3.877, "Gorontalo": 4.054, "Sulawesi Selatan": 3.853,
    "Sulawesi Tenggara": 3.790, "Sulawesi Barat": 3.721, "Maluku": 3.924,
    "Maluku Utara": 3.767, "Papua Barat": 3.987, "Papua": 3.691, "Papua Selatan": 4.1,
    "Papua Tengah": 3.7, "Papua Pegunungan": 3.2, "Papua Barat Daya": 4.0
};

// City/Regency list per province — used to populate the public location select.
const CITY_DATA = {
    "Aceh": ["Aceh Barat","Aceh Barat Daya","Aceh Besar","Aceh Jaya","Aceh Selatan","Aceh Singkil","Aceh Tamiang","Aceh Tengah","Aceh Tenggara","Aceh Timur","Aceh Utara","Banda Aceh","Bener Meriah","Bireuen","Gayo Lues","Langsa","Lhokseumawe","Nagan Raya","Pidie","Pidie Jaya","Sabang","Simeulue","Subulussalam"],
    "Sumatera Utara": ["Asahan","Batu Bara","Binjai","Dairi","Deli Serdang","Gunungsitoli","Humbang Hasundutan","Karo","Labuhanbatu","Labuhanbatu Selatan","Labuhanbatu Utara","Langkat","Mandailing Natal","Medan","Nias","Nias Barat","Nias Selatan","Nias Utara","Padang Lawas","Padang Lawas Utara","Padangsidimpuan","Pakpak Bharat","Pematangsiantar","Samosir","Serdang Bedagai","Sibolga","Simalungun","Tanjungbalai","Tapanuli Selatan","Tapanuli Tengah","Tapanuli Utara","Tebing Tinggi","Toba"],
    "Sumatera Barat": ["Agam","Bukittinggi","Dharmasraya","Kepulauan Mentawai","Lima Puluh Kota","Padang","Padang Panjang","Padang Pariaman","Pariaman","Pasaman","Pasaman Barat","Payakumbuh","Pesisir Selatan","Sawahlunto","Sijunjung","Solok","Solok Selatan","Tanah Datar"],
    "Riau": ["Bengkalis","Dumai","Indragiri Hilir","Indragiri Hulu","Kampar","Kepulauan Meranti","Kuantan Singingi","Pekanbaru","Pelalawan","Rokan Hilir","Rokan Hulu","Siak"],
    "Jambi": ["Batanghari","Bungo","Jambi","Kerinci","Merangin","Muaro Jambi","Sarolangun","Sungai Penuh","Tanjung Jabung Barat","Tanjung Jabung Timur","Tebo"],
    "Sumatera Selatan": ["Banyuasin","Empat Lawang","Lahat","Lubuklinggau","Muara Enim","Musi Banyuasin","Musi Rawas","Musi Rawas Utara","Ogan Ilir","Ogan Komering Ilir","Ogan Komering Ulu","Ogan Komering Ulu Selatan","Ogan Komering Ulu Timur","Pagar Alam","Palembang","Penukal Abab Lematang Ilir","Prabumulih"],
    "Bengkulu": ["Bengkulu","Bengkulu Selatan","Bengkulu Tengah","Bengkulu Utara","Kaur","Kepahiang","Lebong","Mukomuko","Rejang Lebong","Seluma"],
    "Lampung": ["Bandar Lampung","Lampung Barat","Lampung Selatan","Lampung Tengah","Lampung Timur","Lampung Utara","Mesuji","Metro","Pesawaran","Pesisir Barat","Pringsewu","Tanggamus","Tulang Bawang","Tulang Bawang Barat","Way Kanan"],
    "Kepulauan Bangka Belitung": ["Bangka","Bangka Barat","Bangka Selatan","Bangka Tengah","Belitung","Belitung Timur","Pangkal Pinang"],
    "Kepulauan Riau": ["Batam","Bintan","Karimun","Kepulauan Anambas","Lingga","Natuna","Tanjung Pinang"],
    "DKI Jakarta": ["Jakarta Barat","Jakarta Pusat","Jakarta Selatan","Jakarta Timur","Jakarta Utara","Kepulauan Seribu"],
    "Jawa Barat": ["Bandung","Bandung Barat","Banjar","Bekasi","Bogor","Ciamis","Cianjur","Cimahi","Cirebon","Depok","Garut","Indramayu","Karawang","Kuningan","Majalengka","Pangandaran","Purwakarta","Subang","Sukabumi","Sumedang","Tasikmalaya"],
    "Jawa Tengah": ["Banjarnegara","Banyumas","Batang","Blora","Boyolali","Brebes","Cilacap","Demak","Grobogan","Jepara","Karanganyar","Kebumen","Kendal","Klaten","Kudus","Magelang","Pati","Pekalongan","Pemalang","Purbalingga","Purworejo","Rembang","Salatiga","Semarang","Sragen","Sukoharjo","Surakarta","Tegal","Temanggung","Wonogiri","Wonosobo"],
    "DI Yogyakarta": ["Bantul","Gunungkidul","Kulon Progo","Sleman","Yogyakarta"],
    "Jawa Timur": ["Bangkalan","Banyuwangi","Batu","Blitar","Bojonegoro","Bondowoso","Gresik","Jember","Jombang","Kediri","Lamongan","Lumajang","Madiun","Magetan","Malang","Mojokerto","Nganjuk","Ngawi","Pacitan","Pamekasan","Pasuruan","Ponorogo","Probolinggo","Sampang","Sidoarjo","Situbondo","Sumenep","Surabaya","Trenggalek","Tuban","Tulungagung"],
    "Banten": ["Cilegon","Lebak","Pandeglang","Serang","Tangerang","Tangerang Selatan"],
    "Bali": ["Badung","Bangli","Buleleng","Denpasar","Gianyar","Jembrana","Karangasem","Klungkung","Tabanan"],
    "Nusa Tenggara Barat": ["Bima","Dompu","Lombok Barat","Lombok Tengah","Lombok Timur","Lombok Utara","Mataram","Sumbawa","Sumbawa Barat"],
    "Nusa Tenggara Timur": ["Alor","Belu","Ende","Flores Timur","Kupang","Lembata","Malaka","Manggarai","Manggarai Barat","Manggarai Timur","Nagekeo","Ngada","Rote Ndao","Sabu Raijua","Sikka","Sumba Barat","Sumba Barat Daya","Sumba Tengah","Sumba Timur","Timor Tengah Selatan","Timor Tengah Utara"],
    "Kalimantan Barat": ["Bengkayang","Kapuas Hulu","Kayong Utara","Ketapang","Kubu Raya","Landak","Melawi","Mempawah","Pontianak","Sambas","Sanggau","Sekadau","Singkawang","Sintang"],
    "Kalimantan Tengah": ["Barito Selatan","Barito Timur","Barito Utara","Gunung Mas","Kapuas","Katingan","Kotawaringin Barat","Kotawaringin Timur","Lamandau","Murung Raya","Palangka Raya","Pulang Pisau","Seruyan","Sukamara"],
    "Kalimantan Selatan": ["Balangan","Banjar","Banjarbaru","Banjarmasin","Barito Kuala","Hulu Sungai Selatan","Hulu Sungai Tengah","Hulu Sungai Utara","Kotabaru","Tabalong","Tanah Bumbu","Tanah Laut","Tapin"],
    "Kalimantan Timur": ["Balikpapan","Berau","Bontang","Kutai Barat","Kutai Kartanegara","Kutai Timur","Mahakam Ulu","Paser","Penajam Paser Utara","Samarinda"],
    "Kalimantan Utara": ["Bulungan","Malinau","Nunukan","Tana Tidung","Tarakan"],
    "Sulawesi Utara": ["Bitung","Bolaang Mongondow","Bolaang Mongondow Selatan","Bolaang Mongondow Timur","Bolaang Mongondow Utara","Kepulauan Sangihe","Kepulauan Siau Tagulandang Biaro","Kepulauan Talaud","Kotamobagu","Manado","Minahasa","Minahasa Selatan","Minahasa Tenggara","Minahasa Utara","Tomohon"],
    "Sulawesi Tengah": ["Banggai","Banggai Kepulauan","Banggai Laut","Buol","Donggala","Morowali","Morowali Utara","Palu","Parigi Moutong","Poso","Sigi","Tojo Una-Una","Tolitoli"],
    "Sulawesi Selatan": ["Bantaeng","Barru","Bone","Bulukumba","Enrekang","Gowa","Jeneponto","Kepulauan Selayar","Luwu","Luwu Timur","Luwu Utara","Makassar","Maros","Palopo","Pangkajene dan Kepulauan","Parepare","Pinrang","Sidenreng Rappang","Sinjai","Soppeng","Takalar","Tana Toraja","Toraja Utara","Wajo"],
    "Sulawesi Tenggara": ["Baubau","Bombana","Buton","Buton Selatan","Buton Tengah","Buton Utara","Kendari","Kolaka","Kolaka Timur","Kolaka Utara","Konawe","Konawe Kepulauan","Konawe Selatan","Konawe Utara","Muna","Muna Barat","Wakatobi"],
    "Gorontalo": ["Boalemo","Bone Bolango","Gorontalo","Gorontalo Utara","Pohuwato"],
    "Sulawesi Barat": ["Majene","Mamasa","Mamuju","Mamuju Tengah","Pasangkayu","Polewali Mandar"],
    "Maluku": ["Ambon","Buru","Buru Selatan","Kepulauan Aru","Kepulauan Tanimbar","Maluku Barat Daya","Maluku Tengah","Maluku Tenggara","Seram Bagian Barat","Seram Bagian Timur","Tual"],
    "Maluku Utara": ["Halmahera Barat","Halmahera Selatan","Halmahera Tengah","Halmahera Timur","Halmahera Utara","Kepulauan Sula","Pulau Morotai","Pulau Taliabu","Ternate","Tidore Kepulauan"],
    "Papua Selatan": ["Asmat","Boven Digoel","Mappi","Merauke"],
    "Papua Tengah": ["Deiyai","Dogiyai","Intan Jaya","Mimika","Nabire","Paniai","Puncak","Puncak Jaya"],
    "Papua Pegunungan": ["Jayawijaya","Lanny Jaya","Mamberamo Tengah","Nduga","Pegunungan Bintang","Tolikara","Yahukimo","Yalimo"],
    "Papua": ["Biak Numfor","Jayapura","Keerom","Kepulauan Yapen","Mamberamo Raya","Sarmi","Supiori","Waropen"],
    "Papua Barat": ["Fakfak","Kaimana","Manokwari","Manokwari Selatan","Pegunungan Arfak","Teluk Bintuni","Teluk Wondama"],
    "Papua Barat Daya": ["Maybrat","Raja Ampat","Sorong","Sorong Selatan","Tambrauw"]
};

// ---------------------------------------------------------------------
// United States reference data (used when Country = "United States")
// ---------------------------------------------------------------------

// Avg. specific PV yield per state (kWh/kWp/day) — approximate,
// derived from typical NREL/PVWatts national irradiance averages.
// Used the same way as PV_POTENTIAL_DATA above.
const US_PV_POTENTIAL_DATA = {
    "Alabama": 4.2, "Alaska": 2.8, "Arizona": 5.9, "Arkansas": 4.3, "California": 5.5,
    "Colorado": 5.3, "Connecticut": 4.0, "Delaware": 4.1, "Florida": 4.8, "Georgia": 4.4,
    "Hawaii": 5.2, "Idaho": 4.6, "Illinois": 4.2, "Indiana": 4.1, "Iowa": 4.3,
    "Kansas": 4.9, "Kentucky": 4.0, "Louisiana": 4.5, "Maine": 3.9, "Maryland": 4.1,
    "Massachusetts": 4.0, "Michigan": 3.9, "Minnesota": 4.4, "Mississippi": 4.4, "Missouri": 4.4,
    "Montana": 4.6, "Nebraska": 4.7, "Nevada": 5.9, "New Hampshire": 3.9, "New Jersey": 4.1,
    "New Mexico": 5.8, "New York": 3.9, "North Carolina": 4.5, "North Dakota": 4.5, "Ohio": 3.9,
    "Oklahoma": 5.0, "Oregon": 4.0, "Pennsylvania": 3.9, "Rhode Island": 4.0, "South Carolina": 4.5,
    "South Dakota": 4.6, "Tennessee": 4.2, "Texas": 5.1, "Utah": 5.4, "Vermont": 3.8,
    "Virginia": 4.2, "Washington": 3.5, "West Virginia": 3.7, "Wisconsin": 4.1, "Wyoming": 5.1,
    "District of Columbia": 4.1
};

// Major cities per state — same purpose as CITY_DATA above (a
// representative, non-exhaustive shortlist per state). The state
// capital is always listed first, so it's the one auto-selected when
// a state is picked (see populateCities()).
const US_CITY_DATA = {
    "Alabama": ["Montgomery", "Birmingham", "Huntsville", "Mobile", "Tuscaloosa"],
    "Alaska": ["Juneau", "Anchorage", "Fairbanks", "Sitka", "Wasilla"],
    "Arizona": ["Phoenix", "Tucson", "Mesa", "Chandler", "Scottsdale", "Tempe"],
    "Arkansas": ["Little Rock", "Fayetteville", "Fort Smith", "Springdale", "Jonesboro"],
    "California": ["Sacramento", "Los Angeles", "San Diego", "San Jose", "San Francisco", "Fresno", "Long Beach", "Oakland"],
    "Colorado": ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Boulder"],
    "Connecticut": ["Hartford", "Bridgeport", "New Haven", "Stamford", "Waterbury"],
    "Delaware": ["Dover", "Wilmington", "Newark", "Middletown"],
    "Florida": ["Tallahassee", "Jacksonville", "Miami", "Tampa", "Orlando", "St. Petersburg"],
    "Georgia": ["Atlanta", "Augusta", "Columbus", "Savannah", "Athens"],
    "Hawaii": ["Honolulu", "Hilo", "Kailua", "Kapolei"],
    "Idaho": ["Boise", "Meridian", "Nampa", "Idaho Falls"],
    "Illinois": ["Springfield", "Chicago", "Aurora", "Naperville", "Peoria"],
    "Indiana": ["Indianapolis", "Fort Wayne", "Evansville", "South Bend"],
    "Iowa": ["Des Moines", "Cedar Rapids", "Davenport", "Sioux City"],
    "Kansas": ["Topeka", "Wichita", "Overland Park", "Kansas City"],
    "Kentucky": ["Frankfort", "Louisville", "Lexington", "Bowling Green", "Owensboro"],
    "Louisiana": ["Baton Rouge", "New Orleans", "Shreveport", "Lafayette"],
    "Maine": ["Augusta", "Portland", "Lewiston", "Bangor"],
    "Maryland": ["Annapolis", "Baltimore", "Columbia", "Silver Spring"],
    "Massachusetts": ["Boston", "Worcester", "Springfield", "Cambridge"],
    "Michigan": ["Lansing", "Detroit", "Grand Rapids", "Ann Arbor"],
    "Minnesota": ["Saint Paul", "Minneapolis", "Rochester", "Duluth"],
    "Mississippi": ["Jackson", "Gulfport", "Southaven", "Hattiesburg"],
    "Missouri": ["Jefferson City", "Kansas City", "St. Louis", "Springfield", "Columbia"],
    "Montana": ["Helena", "Billings", "Missoula", "Great Falls", "Bozeman"],
    "Nebraska": ["Lincoln", "Omaha", "Bellevue", "Grand Island"],
    "Nevada": ["Carson City", "Las Vegas", "Henderson", "Reno", "North Las Vegas"],
    "New Hampshire": ["Concord", "Manchester", "Nashua", "Dover"],
    "New Jersey": ["Trenton", "Newark", "Jersey City", "Paterson"],
    "New Mexico": ["Santa Fe", "Albuquerque", "Las Cruces", "Roswell"],
    "New York": ["Albany", "New York City", "Buffalo", "Rochester", "Syracuse"],
    "North Carolina": ["Raleigh", "Charlotte", "Greensboro", "Durham"],
    "North Dakota": ["Bismarck", "Fargo", "Grand Forks", "Minot"],
    "Ohio": ["Columbus", "Cleveland", "Cincinnati", "Toledo"],
    "Oklahoma": ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow"],
    "Oregon": ["Salem", "Portland", "Eugene", "Bend"],
    "Pennsylvania": ["Harrisburg", "Philadelphia", "Pittsburgh", "Allentown", "Erie"],
    "Rhode Island": ["Providence", "Cranston", "Warwick", "Pawtucket"],
    "South Carolina": ["Columbia", "Charleston", "North Charleston", "Greenville"],
    "South Dakota": ["Pierre", "Sioux Falls", "Rapid City", "Aberdeen"],
    "Tennessee": ["Nashville", "Memphis", "Knoxville", "Chattanooga"],
    "Texas": ["Austin", "Houston", "San Antonio", "Dallas", "Fort Worth", "El Paso"],
    "Utah": ["Salt Lake City", "West Valley City", "Provo", "Ogden"],
    "Vermont": ["Montpelier", "Burlington", "South Burlington", "Rutland"],
    "Virginia": ["Richmond", "Virginia Beach", "Norfolk", "Arlington"],
    "Washington": ["Olympia", "Seattle", "Spokane", "Tacoma", "Vancouver"],
    "West Virginia": ["Charleston", "Huntington", "Morgantown", "Parkersburg"],
    "Wisconsin": ["Madison", "Milwaukee", "Green Bay", "Kenosha"],
    "Wyoming": ["Cheyenne", "Casper", "Laramie", "Gillette"],
    "District of Columbia": ["Washington"]
};

// Facility-type load-curve profiles — ported from the internal
// planner's `profileData` (opening/closing hours, prep & idle load as
// a % of base load, peak-load windows, ramp duration in minutes).
// Times are decimal hours (e.g. 12.5 = 12:30). "other" is a generic
// fallback the internal tool doesn't have (no custom profile there).
const FACILITY_PROFILES = {
    restaurant: {
        label: "Restaurant", opening: 9, closing: 22,
        includePeaks: true, peaks: [{ start: 12, end: 14 }, { start: 19, end: 21 }],
        rampDurationMin: 60,
        includePrep: true, prepStart: 6, prepEnd: 9, prepLoadPercent: 50,
        idleLoadPercent: 20,
        peakMultiplier: 1.35
    },
    office: {
        label: "Office", opening: 8, closing: 18,
        includePeaks: true, peaks: [{ start: 9, end: 17 }],
        rampDurationMin: 120,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 15,
        peakMultiplier: 1.25
    },
    mall: {
        label: "Mall / Retail", opening: 10, closing: 22,
        includePeaks: true, peaks: [{ start: 12, end: 21 }],
        rampDurationMin: 60,
        includePrep: true, prepStart: 9, prepEnd: 10, prepLoadPercent: 50,
        idleLoadPercent: 25,
        peakMultiplier: 1.3
    },
    hospital: {
        label: "Hospital", opening: 0, closing: 23.9833,
        includePeaks: false, peaks: [],
        rampDurationMin: 60,
        includePrep: true, prepStart: 8, prepEnd: 20, prepLoadPercent: 110,
        idleLoadPercent: 100,
        peakMultiplier: 1.15
    },
    industrial_247: {
        label: "24/7 Factory", opening: 0, closing: 23.9833,
        includePeaks: false, peaks: [],
        rampDurationMin: 0,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 100,
        peakMultiplier: 1.0
    },
    industrial_1shift: {
        label: "1-Shift Factory", opening: 7, closing: 17,
        includePeaks: true, peaks: [{ start: 7.5, end: 16.5 }],
        rampDurationMin: 60,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 5,
        peakMultiplier: 1.3
    },
    residential: {
        label: "Residential Complex", opening: 6, closing: 23,
        includePeaks: true, peaks: [{ start: 7, end: 9 }, { start: 18, end: 21 }],
        rampDurationMin: 60,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 70,
        peakMultiplier: 1.2
    },
    streetlights: {
        label: "Street Lighting", opening: 0, closing: 23.9833, nightOnly: true,
        includePeaks: true, peaks: [{ start: 0, end: 6 }, { start: 18, end: 23.9833 }],
        rampDurationMin: 15,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 0,
        peakMultiplier: 1.0
    },
    // Not present in the internal tool — generic fallback for "Other".
    other: {
        label: "Other Facility", opening: 9, closing: 18,
        includePeaks: false, peaks: [],
        rampDurationMin: 60,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 20,
        peakMultiplier: 1.25
    }
};

// Assumptions — same defaults as the internal planner's end-user /
// direct-purchase model.
const PANEL_WATT_PEAK = 580;              // Wp per panel
const MAX_IRRADIANCE_WM2 = 850;           // W/m², used for peak-output sizing
const SINGLE_PANEL_PEAK_KW = (PANEL_WATT_PEAK / 1000) * (MAX_IRRADIANCE_WM2 / 1000);
const PANEL_AREA_M2 = 2.02 * 1.0;         // m² per panel (2.02m x 1.0m)
const FIXED_PERMIT_COST = 26000000;       // Rp, fixed permitting costs
const COST_PER_KWP = 10806717;            // Rp / kWp, turnkey EPC cost
const PROFIT_MARGIN = 0.35;               // Direct-purchase profit margin
const ANNUAL_OPEX_PER_KWP = 100000;       // Rp / kWp / year
const PLN_TARIFF_INCREASE = 0.02;         // 2%/yr escalation
const PANEL_DEGRADATION = 0.007;          // 0.7%/yr
const OPERATING_YEARS = 20;
const GRID_EMISSION_FACTOR = 0.6789984307; // kgCO2e / kWh

// Environmental / CSR equivalency — same source as the internal
// planner (mangrove-based sequestration & planting-cost proxy).
const MANGROVE_SEQUESTRATION_KG_HA = 513300; // kgCO2e / hectare
const MANGROVE_DENSITY_TREES_HA = 10000;     // trees / hectare
const MANGROVE_COST_PER_TREE = 20000;        // Rp / tree

// BOT / ZeroCapEx Solar Leasing model — tariff discount applied to
// the escalated PLN tariff each year (same default as the internal tool).
const SOLAR_LEASING_DISCOUNT = 0.10; // 10%

// Fixed solar-day window — the internal tool solves for the end time
// so the specific yield matches the province's PV potential exactly;
// here the production curve is scaled directly to hit that same
// target, so a fixed 07:00-12:30-18:00 window is a fair simplification.
const SOLAR_START = 7, SOLAR_PEAK = 12.5, SOLAR_END = 18;

const DT = 5 / 60; // 5-minute simulation step, in hours
const STEPS = Math.round(24 / DT);

let lastResult = null; // kept around so the PDF export can reuse it
let lastComputeParams = null; // kept around so admin pricing changes can recompute the shown result
let hasRevealedResult = false; // only auto-scroll to the results the first time they appear, not on every reactive update
let batteryScenarioEnabled = true;

// =====================================================================
// Setup
// =====================================================================

// Per-country config for the Country / Province / City block. Indonesia
// and the United States both use the cascading province->city dropdowns
// (same UX, different reference data); "Other" swaps both fields to
// free-text inputs since we don't hold a location dataset for it.
const COUNTRY_CONFIG = {
    ID: {
        label: "Indonesia", mode: "dropdown",
        provinceLabel: "Facility Province", cityLabel: "City / Regency",
        pvData: PV_POTENTIAL_DATA, cityData: CITY_DATA,
        defaultProvince: "DKI Jakarta"
    },
    US: {
        label: "United States", mode: "dropdown",
        provinceLabel: "Facility State", cityLabel: "City",
        pvData: US_PV_POTENTIAL_DATA, cityData: US_CITY_DATA,
        defaultProvince: "California"
    },
    OTHER: {
        label: "Other", mode: "manual",
        provinceLabel: "Province / State", cityLabel: "City"
    }
};

function initProvinces() {

    const countrySelect = document.getElementById("countrySelect");
    if (!countrySelect) return;

    applyCountryMode(countrySelect.value || "ID");

    countrySelect.addEventListener("change", () => {
        applyCountryMode(countrySelect.value);
    });

}

// Switches the Province/City block between dropdown mode (Indonesia,
// United States) and manual free-text mode ("Other"), (re)populating
// the province dropdown with the right dataset when applicable.
function applyCountryMode(countryCode) {

    const config = COUNTRY_CONFIG[countryCode] || COUNTRY_CONFIG.OTHER;

    const provinceLabel = document.getElementById("provinceLabel");
    const cityLabel = document.getElementById("cityLabel");
    const provinceSelectWrap = document.getElementById("provinceSelectWrap");
    const provinceInputWrap = document.getElementById("provinceInputWrap");
    const cityInputWrap = document.getElementById("cityInputWrap");
    const cityInputTextWrap = document.getElementById("cityInputTextWrap");
    const otherCountryGroup = document.getElementById("otherCountryGroup");

    const provinceSelect = document.getElementById("provinceSelect");
    const citySelect = document.getElementById("cityInput");
    const provinceInput = document.getElementById("provinceInput");
    const cityInputText = document.getElementById("cityInputText");

    if (provinceLabel) provinceLabel.textContent = config.provinceLabel;
    if (cityLabel) cityLabel.textContent = config.cityLabel;
    if (otherCountryGroup) otherCountryGroup.hidden = countryCode !== "OTHER";

    if (config.mode === "dropdown") {

        // Show the dropdowns, hide the manual text inputs.
        if (provinceSelectWrap) provinceSelectWrap.hidden = false;
        if (cityInputWrap) cityInputWrap.hidden = false;
        if (provinceInputWrap) provinceInputWrap.hidden = true;
        if (cityInputTextWrap) cityInputTextWrap.hidden = true;
        if (provinceSelect) provinceSelect.required = true;
        if (citySelect) citySelect.required = true;
        if (provinceInput) provinceInput.required = false;
        if (cityInputText) cityInputText.required = false;

        // Repopulate the province dropdown with this country's dataset.
        if (provinceSelect) {
            provinceSelect.innerHTML = "";
            const provinces = Object.keys(config.pvData).sort();
            provinces.forEach((name) => {
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                if (name === config.defaultProvince) opt.selected = true;
                provinceSelect.appendChild(opt);
            });

            // Auto-fill the city dropdown for whichever province ends up
            // selected, then keep it in sync as the province changes.
            if (citySelect) {
                populateCities(provinceSelect.value, citySelect, config.cityData);
                provinceSelect.onchange = () => populateCities(provinceSelect.value, citySelect, config.cityData);
            }
        }

    } else {

        // "Other": hide the dropdowns, show manual text inputs instead —
        // no dataset to pick from, so the user just types both fields in.
        if (provinceSelectWrap) provinceSelectWrap.hidden = true;
        if (cityInputWrap) cityInputWrap.hidden = true;
        if (provinceInputWrap) provinceInputWrap.hidden = false;
        if (cityInputTextWrap) cityInputTextWrap.hidden = false;
        if (provinceSelect) provinceSelect.required = false;
        if (citySelect) citySelect.required = false;
        if (provinceInput) provinceInput.required = true;
        if (cityInputText) cityInputText.required = true;

    }

}

// Fills the City/Regency select for a given province/state, mirroring
// the internal planner's populateCities(). `cityData` lets this be
// reused across countries (Indonesia's CITY_DATA, the US's US_CITY_DATA).
function populateCities(province, citySelect, cityData) {

    citySelect.innerHTML = "";
    const cities = (cityData && cityData[province]) || [province];

    cities.forEach((city) => {
        const opt = document.createElement("option");
        opt.value = city;
        opt.textContent = city;
        citySelect.appendChild(opt);
    });

}

function initTariffToggle() {

    const tariffSelect = document.getElementById("tariffSelect");
    const customGroup = document.getElementById("customTariffGroup");

    if (!tariffSelect || !customGroup) return;

    tariffSelect.addEventListener("change", () => {
        customGroup.hidden = tariffSelect.value !== "custom";
    });

}

// "Isi data tagihan listrik bulanan Anda" — lets the visitor supply
// either their average daily energy use (kWh) or their typical
// monthly PLN bill (IDR), mirroring the internal planner's
// energyInputMethod toggle. Whichever is hidden is excluded from
// validation/calculation in initCalcForm()'s submit handler below.
function initEnergyInputToggle() {

    const methodSelect = document.getElementById("energyInputMethod");
    const kwhGroup = document.getElementById("kwhInputGroup");
    const billGroup = document.getElementById("billInputGroup");

    if (!methodSelect || !kwhGroup || !billGroup) return;

    const applyMethod = () => {
        const isKwh = methodSelect.value === "kwh";
        kwhGroup.hidden = !isKwh;
        billGroup.hidden = isKwh;
    };

    methodSelect.addEventListener("change", applyMethod);
    applyMethod();

}

// "Batasi berdasarkan Area Atap" — optional roof-area cap, mirrors the
// internal planner's limitByArea / totalRoofArea / usableRoofPercent
// inputs. When enabled, the two fields below it (total roof area +
// usable roof %) appear so the system size can be capped to what
// actually fits on the roof.
function initRoofAreaToggle() {

    const limitByArea = document.getElementById("limitByArea");
    const totalRoofAreaGroup = document.getElementById("roofAreaInputsContainer");
    const usableRoofPercentGroup = document.getElementById("usableRoofPercentGroup");

    if (!limitByArea || !totalRoofAreaGroup || !usableRoofPercentGroup) return;

    const applyState = () => {
        totalRoofAreaGroup.hidden = !limitByArea.checked;
        usableRoofPercentGroup.hidden = !limitByArea.checked;
    };

    limitByArea.addEventListener("change", applyState);
    applyState();

}

// Keeps a slider + its editable value box in sync both ways — dragging
// the slider updates the box, and typing a number in the box (clamped
// to min–max) moves the slider and refreshes the teal track fill. Used
// for both "Usable Roof Area %" and "BOT Tariff Efficiency Savings %".
function initTealFillSlider(sliderId, valueBoxId) {

    const slider = document.getElementById(sliderId);
    const valueBox = document.getElementById(valueBoxId);

    if (!slider || !valueBox) return;

    const sliderTeal = "#0f6a71";
    const trackColor = "var(--border)";
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;

    const paintTrack = () => {
        const pct = ((parseFloat(slider.value) - min) / (max - min)) * 100;
        slider.style.background =
            `linear-gradient(to right, ${sliderTeal} 0%, ${sliderTeal} ${pct}%, ${trackColor} ${pct}%, ${trackColor} 100%)`;
    };

    // Slider dragged -> update the box + track fill.
    slider.addEventListener("input", () => {
        valueBox.value = slider.value;
        paintTrack();
    });

    // Box edited -> update the slider + track fill, clamped to range.
    const applyBoxValue = () => {
        let val = parseFloat(valueBox.value);
        if (isNaN(val)) val = parseFloat(slider.value) || min;
        val = Math.min(max, Math.max(min, val));
        valueBox.value = val;
        slider.value = val;
        paintTrack();
    };

    valueBox.addEventListener("input", () => {
        // Live-drag the slider thumb as the user types, without
        // clamping mid-typing so e.g. "1" -> "10" isn't fought.
        const raw = parseFloat(valueBox.value);
        if (!isNaN(raw)) {
            slider.value = Math.min(max, Math.max(min, raw));
            paintTrack();
        }
    });
    valueBox.addEventListener("blur", applyBoxValue);
    valueBox.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            applyBoxValue();
            valueBox.blur();
        }
    });

    valueBox.value = slider.value;
    paintTrack();

}

// Opens/closes the "Admin: Pricing Controls" modal (gear button in the
// top-right actions bar). A simple client-side login gate (username
// "admin" / password "123" / role "admin360") sits in front of the
// pricing form — this page has no real backend yet, so it's just
// enough to keep casual visitors from poking at pricing assumptions.
// Once signed in for this page session, reopening the modal goes
// straight to the pricing form again. Pricing fields keep their
// original input IDs, so computeEstimate()/getFormValues() etc. read
// them exactly as before.
const ADMIN_PRICING_STORAGE_KEY = "calcAdminPricingSettings";

// Restores a previously-saved admin margin/cost-per-kWp into the input
// fields on page load, so the override survives reloads and is shared
// across visitors on this browser/device (not just the current tab).
// Silently falls back to the built-in defaults (already set as the
// inputs' HTML `value`) if nothing was saved or storage is unavailable.
function loadSavedAdminPricingSettings() {
    try {
        const raw = localStorage.getItem(ADMIN_PRICING_STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        const profitMarginInput = document.getElementById("profitMarginInput");
        const costPerKwpInput = document.getElementById("costPerKwpInput");
        const useCatalogPricingToggle = document.getElementById("useCatalogPricingToggle");
        if (profitMarginInput && saved.profitMargin != null && saved.profitMargin !== "") {
            profitMarginInput.value = saved.profitMargin;
        }
        // Default ON (checked in the HTML) when nothing has been saved yet.
        if (useCatalogPricingToggle && saved.useCatalogPricing != null) {
            useCatalogPricingToggle.checked = !!saved.useCatalogPricing;
        }
        catalogPricingManualOverride = !!saved.costPerKwpManualOverride;
        // The live catalog value is recomputed fresh on every calculation
        // (see computeEstimate), so the saved costPerKwp is only restored
        // when catalog pricing is off, or the admin had explicitly
        // overridden it — otherwise a stale saved number would briefly
        // show before the first calculation replaces it anyway.
        const shouldRestoreManualValue = !useCatalogPricingToggle?.checked || catalogPricingManualOverride;
        if (costPerKwpInput && shouldRestoreManualValue && saved.costPerKwp != null && saved.costPerKwp !== "") {
            costPerKwpInput.value = saved.costPerKwp;
        }
    } catch (err) {
        console.warn("Could not load saved admin pricing settings:", err);
    }
}

// Persists the admin's current margin/cost-per-kWp field values (plus
// the catalog-pricing toggle and override state) so they survive a
// reload. Called when the admin clicks "Done" in the pricing modal
// (see initAdminSettingsModal below).
function saveAdminPricingSettings() {
    try {
        const profitMarginInput = document.getElementById("profitMarginInput");
        const costPerKwpInput = document.getElementById("costPerKwpInput");
        const useCatalogPricingToggle = document.getElementById("useCatalogPricingToggle");
        localStorage.setItem(ADMIN_PRICING_STORAGE_KEY, JSON.stringify({
            profitMargin: profitMarginInput?.value ?? "",
            costPerKwp: costPerKwpInput?.value ?? "",
            useCatalogPricing: useCatalogPricingToggle ? !!useCatalogPricingToggle.checked : true,
            costPerKwpManualOverride: catalogPricingManualOverride,
        }));
    } catch (err) {
        console.warn("Could not save admin pricing settings:", err);
    }
}

// =====================================================================
// Catalog live pricing integration — Full BOM
// -----------------------------------------------------------------
// Turns the Katalog page's "Harga Terbaru (Live)" prices into the
// system's estimated cost, instead of the hardcoded COST_PER_KWP /
// FIXED_PERMIT_COST constants above:
//   - The catalog and this calculator share the SAME localStorage key
//     (window.EDASH_CATALOG_STORAGE_KEY) and the SAME active-price rule
//     (window.EdashPricing.getActivePrice, exposed by catalog.js) —
//     "livePrice wins once set, else the historical HPP -> Des'25 ->
//     Sep'25 chain" — so a price update on the Catalog page is reflected
//     here without any duplicate pricing logic to keep in sync.
//   - For each core BOM category (Panel Surya, Inverter On-Grid,
//     Mounting, Kabel DC/AC, PDI, PDDC, PDC, Acc., Jasa) the CHEAPEST
//     catalog item in that category is picked automatically and
//     multiplied by how many units the modeled system needs (panel
//     count for Panel Surya/Mounting, 1 set for everything else — same
//     quantities already shown in the PDF's Bill of Quantities table).
//     Summed and divided by systemSizeKwp, this becomes the live
//     "Cost per kWp" used in the Direct Purchase / BOT financial model.
//   - SLO/NIDI is kept OUT of that per-kWp rate (it's a flat
//     permitting/certification service, not something that scales with
//     panel/inverter count) and instead replaces the flat
//     FIXED_PERMIT_COST constant directly.
//   - Battery/Rack are intentionally NOT priced here: the on-page
//     battery scenario is explicitly illustrative and, like before this
//     change, does not feed into the investment figure.
// If the catalog is empty, or a category has no priced item yet, the
// affected figure (costPerKwp and/or permitCost) falls back to the
// original constant/manual input rather than under-pricing a quote —
// see computeCatalogBom()'s `missing` flags below.
// =====================================================================

const CATALOG_BOM_CATEGORIES = [
    { key: "panel", category: "Panel Surya", label: "Panel Surya", qty: (ctx) => ctx.panelCount },
    { key: "inverter", category: "Inverter On-Grid", label: "Inverter On-Grid", qty: () => 1 },
    { key: "mounting", category: "Mounting", label: "Mounting", qty: (ctx) => ctx.panelCount },
    { key: "kabelDc", category: "Kabel DC", label: "Kabel DC", qty: () => 1 },
    { key: "kabelAc", category: "Kabel AC", label: "Kabel AC", qty: () => 1 },
    { key: "pdi", category: "PDI", label: "Panel Distribusi Inverter (PDI)", qty: () => 1 },
    { key: "pddc", category: "PDDC", label: "Panel Distribusi DC Combiner (PDDC)", qty: () => 1 },
    { key: "pdc", category: "PDC", label: "Panel DC Combiner (PDC)", qty: () => 1 },
    { key: "acc", category: "Acc.", label: "Aksesoris Instalasi", qty: () => 1 },
    { key: "jasa", category: "Jasa", label: "Jasa Instalasi", qty: () => 1 },
];
const CATALOG_SLO_CATEGORY = "SLO/NIDI";

// Session-level state for the admin's manual-override toggle. Persisted
// in ADMIN_PRICING_STORAGE_KEY alongside profitMargin/costPerKwp (see
// loadSavedAdminPricingSettings / saveAdminPricingSettings below) so it
// survives reloads on this browser/device, same as the other admin
// pricing fields.
let catalogPricingManualOverride = false;
// Guards the costPerKwpInput "input" listener from mistaking our own
// programmatic sync (writing the live catalog value into the field for
// transparency) for the admin actually typing an override.
let catalogPricingSyncing = false;

function catalogPricingGetRows() {
    try {
        const key = window.EDASH_CATALOG_STORAGE_KEY || "edash4_catalog_rows_v2";
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

// Delegates to catalog.js's window.EdashPricing.getActivePrice when
// available (same page load, Catalog script present) so there is a
// single source of truth for "what does this catalog row currently
// cost". Falls back to a local copy of the exact same rule if
// catalog.js hasn't been loaded on this page.
function catalogPricingActivePrice(row) {
    if (window.EdashPricing && typeof window.EdashPricing.getActivePrice === "function") {
        return window.EdashPricing.getActivePrice(row) || 0;
    }
    const toNum = (v) => {
        const cleaned = String(v ?? "").replace(/[^\d]/g, "");
        return cleaned === "" ? NaN : Number(cleaned);
    };
    const candidates = [row?.livePrice, row?.hpp, row?.des25, row?.sep25];
    for (const c of candidates) {
        const n = toNum(c);
        if (!isNaN(n) && n > 0) return n;
    }
    return 0;
}

// Cheapest priced item within a category — the "automatic, no
// extra admin setup" item-selection rule.
function catalogPricingCheapestInCategory(rows, category) {
    let best = null, bestPrice = Infinity;
    rows.forEach((row) => {
        if (row?.kategori !== category) return;
        const price = catalogPricingActivePrice(row);
        if (price > 0 && price < bestPrice) { bestPrice = price; best = row; }
    });
    return best ? { row: best, price: bestPrice } : null;
}

// Builds the full BOM from live catalog prices for the given system.
// Returns null only when the catalog has no rows at all. Otherwise
// always returns per-line detail (used by the admin status panel),
// with `costPerKwp` / `permitCost` set to null whenever their inputs
// aren't fully priced yet, so callers know to fall back rather than
// silently under-costing a quote.
function computeCatalogBom(panelCount, systemSizeKwp) {
    const rows = catalogPricingGetRows();
    if (!rows.length) return null;

    const ctx = { panelCount };
    const lines = CATALOG_BOM_CATEGORIES.map((def) => {
        const qty = def.qty(ctx);
        const picked = qty > 0 ? catalogPricingCheapestInCategory(rows, def.category) : null;
        if (!picked) {
            return { key: def.key, category: def.category, label: def.label, qty, item: null, unitPrice: 0, total: 0, missing: true };
        }
        return { key: def.key, category: def.category, label: def.label, qty, item: picked.row, unitPrice: picked.price, total: picked.price * qty, missing: false };
    });

    const sloPicked = catalogPricingCheapestInCategory(rows, CATALOG_SLO_CATEGORY);
    const sloLine = sloPicked
        ? { key: "slo", category: CATALOG_SLO_CATEGORY, label: "SLO/NIDI", qty: 1, item: sloPicked.row, unitPrice: sloPicked.price, total: sloPicked.price, missing: false }
        : { key: "slo", category: CATALOG_SLO_CATEGORY, label: "SLO/NIDI", qty: 1, item: null, unitPrice: 0, total: 0, missing: true };

    const corePresent = lines.every((l) => !l.missing);
    const costPerKwp = corePresent && systemSizeKwp > 0
        ? lines.reduce((sum, l) => sum + l.total, 0) / systemSizeKwp
        : null;
    const permitCost = !sloLine.missing ? sloLine.total : null;

    return { lines: [...lines, sloLine], costPerKwp, permitCost, hasRows: true };
}

function isCatalogPricingEnabled() {
    const el = document.getElementById("useCatalogPricingToggle");
    return el ? el.checked : true;
}

// Re-renders the "Sumber Harga" status panel inside the admin Pricing
// Controls modal from the last computed result (if any) — shows which
// catalog item/price was picked per category, and the resulting live
// Cost per kWp, so the admin can see exactly what's driving the number
// before clicking Done.
function refreshCatalogPricingUI() {
    const panelCount = lastResult?.panelCount || 0;
    const systemSizeKwp = lastResult?.systemSizeKwp || 0;
    const bom = isCatalogPricingEnabled() ? computeCatalogBom(panelCount, systemSizeKwp) : null;
    renderCatalogPricingStatus(bom, systemSizeKwp);
}

function renderCatalogPricingStatus(bom, systemSizeKwp) {
    const box = document.getElementById("calcCatalogPricingStatus");
    const hint = document.getElementById("costPerKwpCatalogHint");
    const resetBtn = document.getElementById("calcCatalogPricingResetBtn");
    if (!box) return;

    if (!isCatalogPricingEnabled()) {
        box.innerHTML = '<p class="calc-catalog-pricing__muted">Mode manual aktif — Cost per kWp memakai nilai yang diisi di bawah.</p>';
        if (hint) hint.textContent = "";
        if (resetBtn) resetBtn.hidden = true;
        return;
    }

    if (!bom || !bom.hasRows) {
        box.innerHTML = '<p class="calc-catalog-pricing__warn"><i class="fa-solid fa-triangle-exclamation"></i> Belum ada data di halaman Katalog. Cost per kWp memakai nilai default/manual sampai katalog diisi.</p>';
        if (hint) hint.textContent = "Katalog kosong — memakai nilai manual/default.";
        if (resetBtn) resetBtn.hidden = true;
        return;
    }

    if (!lastResult) {
        box.innerHTML = '<p class="calc-catalog-pricing__muted">Hitung estimasi dulu (isi form &amp; klik Calculate) untuk melihat rincian BOM dari katalog di sini.</p>';
        if (hint) hint.textContent = "";
        if (resetBtn) resetBtn.hidden = !catalogPricingManualOverride;
        return;
    }

    const rowsHtml = bom.lines.map((l) => {
        const valueText = l.missing
            ? "Tidak ditemukan di katalog"
            : `${l.item?.nama || l.category} · Rp ${Math.round(l.unitPrice).toLocaleString("id-ID")} × ${l.qty}`;
        return `<li class="${l.missing ? "is-missing" : ""}"><span class="calc-catalog-pricing__line-label">${l.label}</span><span class="calc-catalog-pricing__line-value">${valueText}</span></li>`;
    }).join("");

    const missingCount = bom.lines.filter((l) => l.missing).length;
    const summaryHtml = bom.costPerKwp != null
        ? `<p class="calc-catalog-pricing__total">Cost per kWp (live): <strong>Rp ${Math.round(bom.costPerKwp).toLocaleString("id-ID")}</strong> / kWp${systemSizeKwp ? ` · sistem ${systemSizeKwp.toFixed ? systemSizeKwp.toFixed(1) : systemSizeKwp} kWp` : ""}</p>`
        : `<p class="calc-catalog-pricing__warn"><i class="fa-solid fa-triangle-exclamation"></i> ${missingCount} kategori belum ada harga di katalog — Cost per kWp memakai nilai manual/default sampai katalog lengkap.</p>`;

    box.innerHTML = `<ul class="calc-catalog-pricing__list">${rowsHtml}</ul>${summaryHtml}`;

    if (hint) {
        hint.textContent = catalogPricingManualOverride
            ? "Override manual aktif — angka ini tidak lagi otomatis mengikuti katalog."
            : (bom.costPerKwp != null ? "Terisi otomatis dari harga live katalog." : "");
    }
    if (resetBtn) resetBtn.hidden = !catalogPricingManualOverride;
}

function initCatalogPricingControls() {
    const toggle = document.getElementById("useCatalogPricingToggle");
    const costInput = document.getElementById("costPerKwpInput");
    const resetBtn = document.getElementById("calcCatalogPricingResetBtn");
    if (!toggle || !costInput) return;

    refreshCatalogPricingUI();

    toggle.addEventListener("change", () => {
        catalogPricingManualOverride = false;
        refreshCatalogPricingUI();
        recomputeWithCurrentSettings();
    });

    // A real keystroke from the admin (not our own programmatic sync)
    // means they want to override the live catalog value for this
    // session — stop auto-overwriting the field until they hit Reset.
    costInput.addEventListener("input", () => {
        if (catalogPricingSyncing || !isCatalogPricingEnabled()) return;
        catalogPricingManualOverride = true;
        refreshCatalogPricingUI();
    });

    resetBtn?.addEventListener("click", () => {
        catalogPricingManualOverride = false;
        refreshCatalogPricingUI();
        recomputeWithCurrentSettings();
    });

    // Multi-tab support: if the Catalog page updates a price in another
    // tab, reflect it here immediately without needing a manual reload.
    window.addEventListener("storage", (e) => {
        const key = window.EDASH_CATALOG_STORAGE_KEY || "edash4_catalog_rows_v2";
        if (e.key !== key) return;
        refreshCatalogPricingUI();
        if (isCatalogPricingEnabled() && !catalogPricingManualOverride) recomputeWithCurrentSettings();
    });
}

// Re-runs the last calculation with whatever pricing settings are
// currently set (admin toggle, override, or manual field edits) — if a
// result is already on screen, refreshes it in place instead of waiting
// for the visitor to resubmit the form. Shared by the admin modal's
// Done button and the catalog pricing controls above.
function recomputeWithCurrentSettings() {
    if (!lastComputeParams) return;
    const result = computeEstimate(lastComputeParams);
    lastResult = result;
    renderResult(result);
    refreshCatalogPricingUI();
}

function initAdminSettingsModal() {

    loadSavedAdminPricingSettings();
    initCatalogPricingControls();

    const openBtn = document.getElementById("calcAdminSettingsBtn");
    const modal = document.getElementById("calcAdminSettingsModal");
    const backdrop = document.getElementById("calcAdminSettingsBackdrop");
    const closeBtn = document.getElementById("calcAdminSettingsClose");
    const doneBtn = document.getElementById("calcAdminSettingsDone");
    const foot = document.getElementById("calcAdminSettingsFoot");
    const loginView = document.getElementById("calcAdminLoginView");
    const pricingView = document.getElementById("calcAdminPricingView");
    const loginForm = document.getElementById("calcAdminLoginForm");
    const usernameInput = document.getElementById("calcAdminUsername");
    const passwordInput = document.getElementById("calcAdminPassword");
    const loginError = document.getElementById("calcAdminLoginError");

    if (!openBtn || !modal) return;

    // FIX (security, 2026-09-03): dulu di sini ada ADMIN_USERNAME/ADMIN_PASSWORD
    // hardcoded ("admin" / "123") langsung di source JS -- bisa dibaca siapa saja
    // lewat View Source/DevTools, dan tidak benar-benar melindungi apa-apa (login
    // cuma dicek di client, gampang di-bypass lewat Console). Sekarang login form
    // ini memanggil endpoint asli backend (POST {EDASH_BACKEND_API_BASE}/auth/login,
    // Hono + PostgreSQL, sama persis yang dipakai pages/login.html) lewat
    // edashApiFetch() dari js/api-config.js -- kredensial divalidasi di server
    // terhadap tabel users (bcrypt hash), BUKAN dibandingkan string di browser.
    // authenticated di sini cuma dipakai untuk INGAT status login SELAMA sesi
    // halaman ini terbuka (biar re-open modal tidak minta login ulang) --
    // otorisasi sesungguhnya tetap dipegang backend lewat cookie session_token
    // (HttpOnly) yang di-set backend setelah login sukses.
    let authenticated = false;
    let loginInFlight = false;
    const loginSubmitBtn = document.getElementById("calcAdminLoginSubmit");

    const showLogin = () => {
        loginView.hidden = false;
        pricingView.hidden = true;
        foot.hidden = true;
        loginError.textContent = "";
        loginError.classList.remove("is-visible");
        passwordInput.value = "";
        window.setTimeout(() => usernameInput?.focus(), 0);
    };

    const showPricing = () => {
        loginView.hidden = true;
        pricingView.hidden = false;
        foot.hidden = false;
    };

    const open = () => {
        modal.hidden = false;
        openBtn.setAttribute("aria-expanded", "true");
        document.addEventListener("keydown", onKeydown);
        authenticated ? showPricing() : showLogin();
        // Catalog prices may have changed (e.g. another tab) since this
        // modal was last opened — refresh the status panel every time.
        refreshCatalogPricingUI();
    };

    const close = () => {
        modal.hidden = true;
        openBtn.setAttribute("aria-expanded", "false");
        document.removeEventListener("keydown", onKeydown);
        openBtn.focus();
    };

    const onKeydown = (e) => {
        if (e.key === "Escape") close();
    };

    openBtn.addEventListener("click", open);
    closeBtn?.addEventListener("click", close);
    doneBtn?.addEventListener("click", () => {
        saveAdminPricingSettings();
        recomputeWithCurrentSettings();
        close();
    });
    backdrop?.addEventListener("click", close);

    loginForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (loginInFlight) return;

        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        loginError.textContent = "";
        loginError.classList.remove("is-visible");

        if (!username || !password) {
            loginError.textContent = "Username dan password wajib diisi.";
            loginError.classList.add("is-visible");
            return;
        }

        loginInFlight = true;
        if (loginSubmitBtn) loginSubmitBtn.disabled = true;

        try {
            // edashApiFetch (js/api-config.js) -> POST /api/v1/auth/login,
            // credentials: "include" supaya cookie session_token (HttpOnly)
            // dari backend tersimpan. Sama persis alur js/login.js.
            const data = await window.edashApiFetch("/auth/login", {
                method: "POST",
                body: JSON.stringify({ username, password }),
            });

            authenticated = true;

            if (typeof logActivity === "function") {
                logActivity({
                    eventType: "login",
                    user: data.user.username,
                    userRole: data.user.roleKey,
                    status: "success",
                    detail: "Logged in to Solar Calculator admin pricing settings",
                });
            }

            showPricing();
        } catch (err) {
            if (typeof logActivity === "function") {
                logActivity({
                    eventType: "login",
                    user: username,
                    userRole: null,
                    status: "failed",
                    detail: `Failed admin login on Solar Calculator — ${err.message || "invalid username or password"}`,
                });
            }
            loginError.textContent = err.message || "Username atau password salah.";
            loginError.classList.add("is-visible");
        } finally {
            loginInFlight = false;
            if (loginSubmitBtn) loginSubmitBtn.disabled = false;
        }
    });

}

// =====================================================================
// Load-curve simulation (ported from the internal planner)
// =====================================================================

// Builds the day's keyframes (time -> load in kW) for a given base
// load, mirroring the internal tool's keyframe list exactly (later
// entries win on time collisions, same as its Map-based de-dupe).
function buildKeyframes(profile, baseLoad, idleLoad, prepLoad, peakAddon) {

    const frames = [{ t: 0, load: idleLoad }, { t: 24, load: idleLoad }];

    if (profile.includePrep) {
        frames.push({ t: profile.prepStart, load: prepLoad });
        frames.push({ t: profile.prepEnd, load: baseLoad });
    } else {
        frames.push({ t: profile.opening, load: baseLoad });
    }

    if (profile.includePeaks) {
        profile.peaks.forEach((p) => {
            frames.push({ t: p.start, load: peakAddon });
            frames.push({ t: p.end, load: baseLoad });
        });
    }

    frames.push({ t: profile.closing, load: idleLoad });

    const byTime = new Map();
    frames.forEach((f) => byTime.set(f.t, f));
    return Array.from(byTime.values()).sort((a, b) => a.t - b.t);

}

// Load at time t (hours), with linear ramping into the next keyframe
// over the last `rampHours` before it — same approach as the internal
// tool's d3.scaleLinear ramp.
function getLoadAt(keyframes, t, rampHours) {

    let current = keyframes[0];
    for (const k of keyframes) {
        if (k.t <= t) current = k; else break;
    }
    const next = keyframes.find((k) => k.t > t);

    let load = current.load;
    if (next && rampHours >= 0 && t > next.t - rampHours && t <= next.t) {
        const frac = rampHours > 0 ? (t - (next.t - rampHours)) / rampHours : 1;
        load = current.load + (next.load - current.load) * Math.min(1, Math.max(0, frac));
    }
    return load;

}

// Fits a realistic facility load profile to the estimated daily energy.
// The selected facility determines the shape, while PLN capacity acts as
// the physical upper limit. This keeps the chart responsive to Calculate
// inputs without pretending that city-level load data exists.
function simulateLoadCurve(profile, totalEnergyKwh, maxPossibleLoadKva) {

    const capacity = Math.max(0.1, Number(maxPossibleLoadKva) || 0.1);
    const shapeAt = (t) => {
        const opening = profile.opening;
        const closing = profile.closing;
        let operating = false;

        if (opening === 0 && closing >= 23.9) {
            operating = true;
        } else if (closing > opening) {
            operating = t >= opening && t < closing;
        } else {
            operating = t >= opening || t < closing;
        }

        let multiplier = profile.nightOnly ? 0 : (operating ? 1 : Math.max(0, profile.idleLoadPercent / 100));

        if (profile.includePrep && t >= profile.prepStart && t < profile.prepEnd) {
            multiplier = Math.max(multiplier, profile.prepLoadPercent / 100);
        }

        if (profile.includePeaks) {
            for (const peak of profile.peaks || []) {
                if (t >= peak.start && t < peak.end) {
                    multiplier = Math.max(multiplier, profile.peakMultiplier || 1.35);
                }
            }
        }

        return Math.max(0, multiplier);
    };

    const raw = [];
    let rawIntegral = 0;
    for (let i = 0; i < STEPS; i++) {
        const t = i * DT;
        const shape = shapeAt(t);
        raw.push({ t, shape });
        rawIntegral += shape * DT;
    }

    const requestedEnergy = Math.max(0, totalEnergyKwh);
    let scale = rawIntegral > 0 ? requestedEnergy / rawIntegral : 0;
    const rawPeak = Math.max(...raw.map((p) => p.shape), 0);
    if (rawPeak > 0) scale = Math.min(scale, capacity / rawPeak);

    const points = raw.map((p) => ({
        t: p.t,
        consumption: Math.min(capacity, p.shape * scale)
    }));

    const actualDailyEnergy = points.reduce((sum, p) => sum + p.consumption * DT, 0);
    const baseLoad = points.length ? Math.min(...points.map((p) => p.consumption)) : 0;
    const peakLoad = points.length ? Math.max(...points.map((p) => p.consumption)) : 0;
    const actualPeakAddon = Math.max(0, peakLoad - baseLoad);
    // Keep the public calculator's existing sizing convention: target PV
    // capacity follows the available PLN headroom above the base load.
    const sizingPeakAddon = Math.max(0, capacity - baseLoad);
    const requestedEnergyLimited = actualDailyEnergy + 0.01 < requestedEnergy;

    return {
        points,
        baseLoad,
        peakAddon: actualPeakAddon,
        sizingPeakAddon,
        peakLoad,
        actualDailyEnergy,
        requestedEnergyLimited
    };

}

// Unit Gaussian solar-day shape (peak = 1), zero outside the window.
function solarShape(t) {
    if (t < SOLAR_START || t > SOLAR_END) return 0;
    const sigma = t < SOLAR_PEAK
        ? (SOLAR_PEAK - SOLAR_START) / 3
        : (SOLAR_END - SOLAR_PEAK) / 3;
    if (sigma <= 0) return 0;
    return Math.exp(-Math.pow(t - SOLAR_PEAK, 2) / (2 * sigma * sigma));
}

function findPaybackYear(series) {
    if (series.length < 2 || series[0].value > 0) return Infinity;
    for (let i = 1; i < series.length; i++) {
        if (series[i].value >= 0) {
            const prev = series[i - 1].value;
            const flow = series[i].value - prev;
            if (flow <= 0) continue;
            return series[i - 1].year + (-prev / flow);
        }
    }
    return Infinity;
}

// =====================================================================
// Calculation
// =====================================================================

// Small debounce helper — used so reactive recompute (on every input
// change) doesn't fire computeEstimate() on every single keystroke, and
// so marketing/analytics tracking only fires once the visitor has
// settled on a value rather than once per change.
function debounce(fn, wait) {
    let t = null;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

// Reads the current form state, validates it, and returns computeEstimate()
// params — or null if required fields aren't filled in yet. Shared by the
// explicit "Calculate" submit and by reactive (auto-recompute) triggers so
// both read the form exactly the same way.
function readCalcFormParams({ showErrors } = {}) {

    const errorEl = document.getElementById("calcFormError");
    const setError = (msg) => {
        if (!showErrors || !errorEl) return;
        errorEl.textContent = msg;
        errorEl.classList.add("is-visible");
    };
    if (showErrors && errorEl) {
        errorEl.textContent = "";
        errorEl.classList.remove("is-visible");
    }

    const countryCode = document.getElementById("countrySelect").value || "ID";
    const isManualLocation = (COUNTRY_CONFIG[countryCode] || COUNTRY_CONFIG.OTHER).mode === "manual";

    const province = isManualLocation
        ? document.getElementById("provinceInput").value.trim() || "your province"
        : document.getElementById("provinceSelect").value;
    const city = isManualLocation
        ? document.getElementById("cityInputText").value.trim() || "your city"
        : document.getElementById("cityInput").value.trim() || "your city";
    const countryName = countryCode === "OTHER"
        ? (document.getElementById("countryOtherInput").value.trim() || "Other")
        : (COUNTRY_CONFIG[countryCode] || {}).label || countryCode;

    const facilityKey = document.getElementById("facilitySelect").value;
    const kva = parseFloat(document.getElementById("kvaInput").value) || 0;
    const tariffSelect = document.getElementById("tariffSelect");
    const tariff = tariffSelect.value === "custom"
        ? parseFloat(document.getElementById("customTariffInput").value) || 0
        : parseFloat(tariffSelect.value);
    // "Isi data tagihan listrik bulanan Anda" — same energyInputMethod
    // toggle as the internal planner: 'kwh' takes daily energy use
    // directly, 'bill' (default) takes the monthly Rp bill and derives
    // daily energy from it. Either way, monthlyBill below is what
    // feeds computeEstimate(), so the formula (monthlyBill / (30 x
    // tariff) = daily kWh) matches the internal planner exactly —
    // for 'kwh' input we simply run that formula in reverse to get
    // an equivalent monthlyBill for the rest of the calculation.
    const energyInputMethod = document.getElementById("energyInputMethod")?.value || "bill";
    let monthlyBill;
    if (energyInputMethod === "kwh") {
        const totalEnergyKwh = parseFloat(document.getElementById("totalEnergyInput").value) || 0;
        monthlyBill = totalEnergyKwh * 30 * tariff;
    } else {
        monthlyBill = parseFormattedNumber(document.getElementById("billInput").value);
    }

    if (monthlyBill <= 0 || tariff <= 0 || kva <= 0) {
        setError(energyInputMethod === "kwh"
            ? "Please fill in the kVA capacity, tariff, and daily energy use with valid numbers."
            : "Please fill in the kVA capacity, tariff, and monthly bill with valid numbers.");
        return null;
    }

    if (isManualLocation && (!province || !city)) {
        setError("Please fill in the province/state and city.");
        return null;
    }

    // "Batasi berdasarkan Area Atap" — optional roof-area cap (off by
    // default, same as the internal planner's unchecked limitByArea).
    const limitByArea = document.getElementById("limitByArea")?.checked || false;
    const totalRoofArea = parseFloat(document.getElementById("totalRoofArea")?.value) || 0;
    const usableRoofPercent = parseFloat(document.getElementById("usableRoofPercent")?.value) || 0;

    if (limitByArea && totalRoofArea <= 0) {
        setError("Please fill in your total roof area, or turn off the roof-area limit.");
        return null;
    }

    return { countryCode, countryName, province, city, facilityKey, kva, tariff, monthlyBill, limitByArea, totalRoofArea, usableRoofPercent };
}

// Runs computeEstimate() + renderResult() for the current form state.
// trackEvent=true (explicit "Calculate" click) also fires the marketing
// pixel + internal activity log — reactive auto-recompute (trackEvent
// false, called via the debounced listeners below) intentionally skips
// those so every keystroke doesn't spam Meta/TikTok Ads Manager or the
// Activity Log; a separate, longer-debounced tracking call (see
// initReactiveCalcInputs) still records one event once the visitor
// settles on a set of values.
function runCalculation({ showErrors = false, trackEvent = false } = {}) {

    const computeParams = readCalcFormParams({ showErrors });
    if (!computeParams) return null;

    const result = computeEstimate(computeParams);
    lastResult = result;
    lastComputeParams = computeParams; // so a later admin pricing change (Done button) can recompute this same result
    if (typeof refreshCatalogPricingUI === "function") refreshCatalogPricingUI(); // update admin panel's BOM status, if open

    if (trackEvent) {
        // --- Meta Pixel / TikTok Pixel: catat event kalkulasi ---
        // Ini HANYA mengirim data ke Meta/TikTok Ads Manager (untuk
        // mengukur efektivitas iklan). Ini TIDAK menyimpan data ke
        // Activity Log atau database internal — itu ditangani terpisah
        // oleh submitLeadToBackend() di bawah, saat email di-submit.
        trackCalculatorEvent(result, getCalculatorInputSnapshot());

        // --- Activity Log (internal) ---
        // Email bersifat opsional di Solar Calculator; kalau user belum
        // mengisi email lewat email-gate sesi ini, catat sebagai "Anonymous".
        if (typeof logActivity === "function") {
            logActivity({
                eventType: "calculator_calculate",
                user: sessionStorage.getItem("edash-solar-lead-email") || "Anonymous",
                status: "success",
                detail: `Calculated solar estimate for ${computeParams.city}, ${computeParams.countryName}`,
                data: {
                    calculatorInput: getCalculatorInputSnapshot(),
                    calculatorResult: result,
                },
            });
        }
    }

    renderResult(result, { scrollToResult: !hasRevealedResult });
    hasRevealedResult = true;
    return result;

}

function initCalcForm() {

    const form = document.getElementById("solarCalcForm");
    if (!form) return;

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        runCalculation({ showErrors: true, trackEvent: true });
    });

}

// Makes every field in the form reactive: changing any input recomputes
// and re-renders the result immediately, without needing a separate
// "Calculate" click. Two things are intentionally preserved so this
// doesn't fight the existing UX:
//   1. The slider+textbox pairs (Usable Roof Area %, BOT Tariff Efficiency
//      Savings %) still only commit a typed value on blur/Enter — see
//      initTealFillSlider(). We hook into that same commit point rather
//      than firing on every keystroke, so typing "1" -> "10" -> "100"
//      isn't fought mid-edit. Dragging the slider itself still recomputes
//      live (no fight there, there's nothing to type).
//   2. Marketing/analytics tracking (trackCalculatorEvent / logActivity)
//      is NOT fired on every reactive recompute — only the visible result
//      updates live. A separate, longer debounce fires one tracking event
//      after the visitor settles, so ad-attribution/activity-log data
//      stays one-event-per-edit-session instead of one-per-keystroke.
function initReactiveCalcInputs() {

    const form = document.getElementById("solarCalcForm");
    if (!form) return;

    const recomputeLive = debounce(() => runCalculation({ showErrors: false, trackEvent: false }), 250);
    const recomputeAndTrack = debounce(() => runCalculation({ showErrors: false, trackEvent: true }), 1500);
    // Reactive auto-recompute only kicks in AFTER the user has clicked
    // "Calculate" at least once (hasRevealedResult becomes true inside
    // runCalculation()). Before that, input changes are ignored here —
    // the first result can only come from the explicit submit handler
    // in initCalcForm().
    const reactiveTrigger = () => {
        if (!hasRevealedResult) return;
        recomputeLive();
        recomputeAndTrack();
    };

    // Free-typed number/text fields without their own blur-commit
    // behavior (billInput's thousand-separator formatting doesn't clamp
    // or "fight" mid-typing, so live 'input' is safe here).
    ["kvaInput", "customTariffInput", "totalEnergyInput", "billInput", "totalRoofArea", "provinceInput", "cityInputText", "countryOtherInput"]
        .forEach((id) => document.getElementById(id)?.addEventListener("input", reactiveTrigger));

    // Selects, checkboxes, and the "Country" driven location fields —
    // 'change' fires as soon as a choice is made, no debounce needed for
    // the value itself, though we still keep it inside the same debounced
    // trigger for consistency.
    ["countrySelect", "provinceSelect", "cityInput", "facilitySelect", "tariffSelect", "energyInputMethod", "limitByArea"]
        .forEach((id) => document.getElementById(id)?.addEventListener("change", reactiveTrigger));

    // Usable Roof Area % — the range slider itself recomputes live while
    // dragging (no typing to fight); its paired textbox only recomputes
    // once its value is committed on blur/Enter, matching
    // initTealFillSlider()'s existing commit point exactly.
    document.getElementById("usableRoofPercent")?.addEventListener("input", reactiveTrigger);
    const usableRoofPercentValue = document.getElementById("usableRoofPercentValue");
    usableRoofPercentValue?.addEventListener("blur", reactiveTrigger);
    usableRoofPercentValue?.addEventListener("keydown", (e) => { if (e.key === "Enter") reactiveTrigger(); });

}

function computeEstimate({ countryCode, countryName, province, city, facilityKey, kva, tariff, monthlyBill, limitByArea = false, totalRoofArea = 0, usableRoofPercent = 0 }) {

    // IMPORTANT: this function intentionally mirrors the internal
    // Smart Solar Planner calculation order and formulas.  The public

    // calculator keeps its existing UI, but the numbers come from the
    // same 1-minute load simulation, Gaussian PV sizing/production and
    // financial models as the planner.

    const profile = FACILITY_PROFILES[facilityKey] || FACILITY_PROFILES.other;
    const pvDataset = countryCode === "US" ? US_PV_POTENTIAL_DATA
        : countryCode === "ID" ? PV_POTENTIAL_DATA : {};
    const pvPotential = pvDataset[province] || 0;

    // 1. Energy input — exactly the planner's bill -> daily kWh conversion.
    const totalEnergyKwh = monthlyBill / (30 * tariff);

    // 2. Exact planner load simulation: base load is iteratively fitted to
    // the requested daily energy, with P_max = PLN capacity - base load.
    const maxPossibleLoad = Number(kva) || 0;
    const openingTime = profile.opening;
    const closingTime = profile.closing;
    const prepStartTime = profile.prepStart;
    const prepEndTime = profile.prepEnd;
    const prepLoadPercent = profile.prepLoadPercent;
    const idleLoadPercent = profile.idleLoadPercent;
    const rampDuration = (profile.rampDurationMin || 0) / 60;
    const includePrep = !!profile.includePrep;
    const includePeaks = !!profile.includePeaks;
    const peaks = profile.peaks || [];

    let operatingHours;
    if (closingTime > openingTime) operatingHours = closingTime - openingTime;
    else if (closingTime < openingTime) operatingHours = (24 - openingTime) + closingTime;
    else operatingHours = 24;
    if (operatingHours <= 0) operatingHours = 24;

    let baseLoad = (totalEnergyKwh / operatingHours) * 0.5;
    let consumptionData = [];
    let calculatedEnergy = 0;
    const timeStep = 1 / 60;
    const formatFrames = (base) => {
        const peakLoadAddon = Math.max(0, maxPossibleLoad - base);
        const prepLoad = includePrep ? base * (prepLoadPercent / 100) : 0;
        const idleLoad = base * (idleLoadPercent / 100);
        const frames = [{ time: 0, load: idleLoad }, { time: 24, load: idleLoad }];
        if (includePrep) {
            frames.push({ time: prepStartTime, load: prepLoad });
            frames.push({ time: prepEndTime, load: base });
        } else {
            frames.push({ time: openingTime, load: base });
        }
        if (includePeaks) {
            peaks.forEach(p => {
                frames.push({ time: p.start, load: peakLoadAddon });
                frames.push({ time: p.end, load: base });
            });
        }
        frames.push({ time: closingTime, load: idleLoad });
        const unique = new Map();
        frames.forEach(k => unique.set(k.time, k));
        return Array.from(unique.values()).sort((a,b) => a.time - b.time);
    };

    const loadAt = (frames, t) => {
        const current = [...frames].reverse().find(k => k.time <= t) || frames[0];
        const next = frames.find(k => k.time > t);
        let load = current.load;
        if (next && t > next.time - rampDuration && t <= next.time) {
            if (rampDuration > 0) {
                const frac = Math.min(1, Math.max(0, (t - (next.time - rampDuration)) / rampDuration));
                load = current.load + (next.load - current.load) * frac;
            } else {
                load = next.load;
            }
        }
        return load;
    };

    for (let iter = 0; iter < 10; iter++) {
        const frames = formatFrames(baseLoad);
        consumptionData = [];
        for (let i = 0; i < 24 * 60; i++) {
            const t = i * timeStep;
            consumptionData.push({ t, consumption: loadAt(frames, t) });
        }
        calculatedEnergy = consumptionData.reduce((sum, d) => sum + d.consumption * timeStep, 0);
        const error = totalEnergyKwh - calculatedEnergy;
        baseLoad += error / operatingHours;
        if (baseLoad < 0) baseLoad = 0;
    }

    const peakLoadAddon = Math.max(0, maxPossibleLoad - baseLoad);
    const prepLoadKw = includePrep ? baseLoad * (prepLoadPercent / 100) : 0;
    const idleLoadKw = baseLoad * (idleLoadPercent / 100);

    // 3. Exact planner PV sizing.
    const panelPowerWp = PANEL_WATT_PEAK;
    const maxIrradiance = MAX_IRRADIANCE_WM2;
    const singlePanelPeakOutputKw = (panelPowerWp / 1000) * (maxIrradiance / 1000);
    const targetLoad = Math.max(0, peakLoadAddon);
    let panelCount = singlePanelPeakOutputKw > 0 && targetLoad > 0
        ? Math.ceil(targetLoad / singlePanelPeakOutputKw) : 0;

    const singlePanelArea = PANEL_AREA_M2;
    const maxUsableArea = Number(totalRoofArea || 0) * (Number(usableRoofPercent || 0) / 100);
    if (limitByArea && singlePanelArea > 0) {
        panelCount = Math.min(panelCount, Math.floor(maxUsableArea / singlePanelArea));
    }
    const systemSizeKwp = panelCount * panelPowerWp / 1000;
    const panelAreaM2 = panelCount * singlePanelArea;
    const theoreticalMaxOutputPowerKw = singlePanelPeakOutputKw * panelCount;

    // 4. Exact planner Gaussian production. The planner searches for the
    // latest solar end time whose specific yield does not exceed the
    // province PV potential, using 1-minute integration.
    const solarStartTime = 7;
    const solarPeakTime = 12.5;
    let bestFit = { endTime: solarPeakTime, yield: 0 };

    if (systemSizeKwp > 0 && theoreticalMaxOutputPowerKw > 0 && solarPeakTime > solarStartTime) {
        for (let minute = 1; minute <= (22 - solarPeakTime) * 60; minute++) {
            const potentialEndTime = solarPeakTime + minute / 60;
            const sigmaRise = (solarPeakTime - solarStartTime) / 3;
            const sigmaFall = (potentialEndTime - solarPeakTime) / 3;
            if (sigmaRise <= 0 || sigmaFall <= 0) continue;
            let tempTotalProduction = 0;
            for (let i = Math.round(solarStartTime * 60); i <= Math.round(potentialEndTime * 60); i++) {
                const t = i / 60;
                const sigma = t < solarPeakTime ? sigmaRise : sigmaFall;
                const exponent = -Math.pow(t - solarPeakTime, 2) / (2 * Math.pow(sigma, 2));
                tempTotalProduction += theoreticalMaxOutputPowerKw * Math.exp(exponent) * timeStep;
            }
            const calculatedSpecificYield = tempTotalProduction / systemSizeKwp;
            if (calculatedSpecificYield <= pvPotential) bestFit = { endTime: potentialEndTime, yield: calculatedSpecificYield };
            else break;
        }
    }

    const solarEndTime = bestFit.endTime;
    const sigmaRiseFinal = (solarPeakTime - solarStartTime) > 0 ? (solarPeakTime - solarStartTime) / 3 : 0.1;
    const sigmaFallFinal = (solarEndTime - solarPeakTime) > 0 ? (solarEndTime - solarPeakTime) / 3 : 0.1;
    let dailySolarProduction = 0;
    let dailySolarConsumed = 0;

    consumptionData.forEach(d => {
        let production = 0;
        if (d.t >= solarStartTime && d.t <= solarEndTime && systemSizeKwp > 0) {
            const sigma = d.t < solarPeakTime ? sigmaRiseFinal : sigmaFallFinal;
            const exponent = -Math.pow(d.t - solarPeakTime, 2) / (2 * Math.pow(sigma, 2));
            production = theoreticalMaxOutputPowerKw * Math.exp(exponent);
        }
        d.solarProduction = production;
        d.overlay = Math.min(d.consumption, production);
        dailySolarProduction += production * timeStep;
        dailySolarConsumed += d.overlay * timeStep;
    });

    // 5. Financial assumptions exactly as the planner defaults.
    // Catalog live-pricing integration (see computeCatalogBom above):
    // when enabled and not manually overridden, fixedCosts (SLO/NIDI)
    // and costPerKwp (Panel+Inverter+Mounting+Kabel+PDI+PDDC+PDC+Acc+Jasa,
    // ÷ systemSizeKwp) come from the Katalog page's live prices instead
    // of the constants below.
    const catalogBom = (typeof isCatalogPricingEnabled === "function" && isCatalogPricingEnabled())
        ? computeCatalogBom(panelCount, systemSizeKwp)
        : null;

    const fixedCosts = (catalogBom && catalogBom.permitCost != null) ? catalogBom.permitCost : FIXED_PERMIT_COST;

    let costPerKwp;
    if (catalogBom && catalogBom.costPerKwp != null && !catalogPricingManualOverride) {
        costPerKwp = catalogBom.costPerKwp;
        // Reflect the live value back into the input for transparency.
        // Guarded so this programmatic write isn't mistaken for the
        // admin typing a manual override (see the costInput "input"
        // listener in initCatalogPricingControls).
        const costPerKwpInputEl = document.getElementById("costPerKwpInput");
        if (costPerKwpInputEl) {
            catalogPricingSyncing = true;
            costPerKwpInputEl.value = formatThousands(String(Math.round(costPerKwp)));
            catalogPricingSyncing = false;
        }
    } else {
        // Admin-configurable "Cost per kWp (Rp)" (Admin: Pricing Controls
        // modal) — formatted with thousand-separator dots same as the bill
        // input, so it's parsed back with parseFormattedNumber(). Falls
        // back to the COST_PER_KWP default if the field is empty/invalid.
        const costPerKwpFieldValue = parseFormattedNumber(document.getElementById("costPerKwpInput")?.value);
        costPerKwp = costPerKwpFieldValue > 0 ? costPerKwpFieldValue : COST_PER_KWP;
    }
    const plnIncrease = PLN_TARIFF_INCREASE;
    // Admin-configurable "BOT Tariff Efficiency Savings (%)" — same field
    // the reference Smart Solar Planner reads (solarDiscount / 100).
    // Falls back to the SOLAR_LEASING_DISCOUNT default if the field is
    // missing/invalid.
    const solarDiscountFieldValue = parseFloat(document.getElementById("solarDiscountInput")?.value);
    const solarDiscount = !isNaN(solarDiscountFieldValue) ? solarDiscountFieldValue / 100 : SOLAR_LEASING_DISCOUNT;
    const opex = systemSizeKwp * ANNUAL_OPEX_PER_KWP;
    const degradationRate = PANEL_DEGRADATION;
    const operatingYears = OPERATING_YEARS;
    const discountRate = 0.08;
    const taxRate = 0.11;
    const capexPrePpn = fixedCosts + systemSizeKwp * costPerKwp;
    // Admin-configurable "Direct Purchase Profit Margin (%)" — same field
    // the reference Smart Solar Planner reads (endUserCapex = capexPrePpn
    // / (1 - profitMargin)). Falls back to PROFIT_MARGIN if invalid.
    // NOTE: in the reference Smart Solar Planner, profit margin is ONLY
    // applied to the Direct Purchase (end-user sale) price — the
    // Planner/BOT investment uses capexPrePpn/capexPostPpn directly
    // (equityAmount = capexPostPpn when not borrowing). Matched here so
    // Planner NCF Payback lines up with the reference tool's NCF Payback.
    const profitMarginFieldValue = parseFloat(document.getElementById("profitMarginInput")?.value);
    const profitMargin = !isNaN(profitMarginFieldValue) ? profitMarginFieldValue / 100 : PROFIT_MARGIN;
    const capexWithMargin = capexPrePpn / (1 - profitMargin);
    const ppnAmount = capexPrePpn * 0.11;
    const plannerInvestment = capexPrePpn + ppnAmount;
    const annualDda = operatingYears > 0 ? capexPrePpn / operatingYears : 0;

    const plannerCashFlows = [-plannerInvestment];
    const plannerCumulativeNcf = [{ year: 0, value: -plannerInvestment }];
    const plannerCumulativePv = [{ year: 0, value: -plannerInvestment }];
    const plannerRows = [];
    const annualBillsPln = [];
    const annualBillsSolar = [];
    const directRows = [];
    const directCashFlows = [-capexWithMargin];
    const directCumulative = [{ year: 0, value: directCashFlows[0] }];
    let plannerRevenueY1 = 0;
    let plannerTotalRevenue = 0;
    let directTotalSavings = 0;
    let totalBotSavings = 0;
    let totalEmissionsReductionKg = 0;

    for (let year = 1; year <= operatingYears; year++) {
        const degradationFactor = Math.pow(1 - degradationRate, year - 1);
        const annualSolarConsumed = dailySolarConsumed * 365 * degradationFactor;
        const escalatedPlnTariff = tariff * Math.pow(1 + plnIncrease, year - 1);
        const escalatedSolarTariff = escalatedPlnTariff * (1 - solarDiscount);
        const annualRevenue = annualSolarConsumed * escalatedSolarTariff;
        const EBITDA = annualRevenue - opex;
        const EBIT = EBITDA - annualDda;
        const taxableIncome = EBIT;
        const tax = taxableIncome > 0 ? taxableIncome * taxRate : 0;
        const netIncome = taxableIncome - tax;
        const annualCashFlow = netIncome + annualDda;
        plannerCashFlows.push(annualCashFlow);
        plannerCumulativeNcf.push({ year, value: plannerCumulativeNcf[year - 1].value + annualCashFlow });
        const discountFactor = 1 / Math.pow(1 + discountRate, year);
        const discountedNcf = annualCashFlow * discountFactor;
        plannerCumulativePv.push({ year, value: plannerCumulativePv[year - 1].value + discountedNcf });
        plannerRows.push({ year, savings: annualRevenue, opex, ncf: annualCashFlow, accumNcf: plannerCumulativeNcf[year].value, revenue: annualRevenue, ebitda: EBITDA, dda: annualDda, ebit: EBIT, tax, netIncome, discountedNcf, cumulativePv: plannerCumulativePv[year].value });
        if (year === 1) plannerRevenueY1 = annualRevenue;
        plannerTotalRevenue += annualRevenue;

        // Direct Purchase model from the planner's End User section.
        const annualDirectSavings = annualSolarConsumed * escalatedPlnTariff;
        const annualDirectNcf = annualDirectSavings - opex;
        directTotalSavings += annualDirectSavings;
        directCashFlows.push(annualDirectNcf);
        directCumulative.push({ year, value: directCumulative[year - 1].value + annualDirectNcf });
        directRows.push({ year, savings: annualDirectSavings, opex, ncf: annualDirectNcf, accumNcf: directCumulative[year].value });

        // BOT model.
        totalBotSavings += annualSolarConsumed * (escalatedPlnTariff - escalatedSolarTariff);
        totalEmissionsReductionKg += annualSolarConsumed * GRID_EMISSION_FACTOR;

        // Keep the public annual-bill chart, but calculate its solar series
        // from the exact planner energy/tariff model.
        const annualTotalConsumption = totalEnergyKwh * 365;
        const annualGridImport = Math.max(0, annualTotalConsumption - annualSolarConsumed);
        annualBillsPln.push({ year, cost: annualTotalConsumption * escalatedPlnTariff });
        annualBillsSolar.push({ year, cost: annualGridImport * escalatedPlnTariff + opex });
    }

    const findPayback = (series) => {
        if (series.length < 2 || series[0].value > 0) return Infinity;
        for (let i = 1; i < series.length; i++) {
            if (series[i].value >= 0) {
                const lastNeg = series[i - 1].value;
                const flowThisYear = series[i].value - lastNeg;
                if (flowThisYear > 0) return series[i - 1].year + (-lastNeg / flowThisYear);
            }
        }
        return Infinity;
    };
    const calculateIRRExact = (cashFlows, guess = 0.1) => {
        let x0 = guess;
        for (let i = 0; i < 100; i++) {
            let npv = 0, derivative = 0;
            cashFlows.forEach((cf, t) => {
                npv += cf / Math.pow(1 + x0, t);
                if (t > 0) derivative += -t * cf / Math.pow(1 + x0, t + 1);
            });
            if (Math.abs(npv) < 1e-7) return x0;
            if (derivative === 0) break;
            const x1 = x0 - npv / derivative;
            if (Math.abs(x1 - x0) < 1e-7) return x1;
            x0 = x1;
        }
        return NaN;
    };

    const plannerNcfPayback = findPayback(plannerCumulativeNcf);
    const plannerDiscountedPayback = findPayback(plannerCumulativePv);
    const plannerNpv = plannerCumulativePv[plannerCumulativePv.length - 1].value;
    const plannerIrr = calculateIRRExact(plannerCashFlows);
    const directPurchasePayback = findPayback(directCumulative);
    const directPurchaseNpv = directCashFlows.reduce((acc, cf, year) => acc + cf / Math.pow(1 + discountRate, year), 0);
    const directPurchaseIrr = calculateIRRExact(directCashFlows);
    const directPurchaseInvestment = directCashFlows[0] * -1;

    const monthlyPlannerSavings = plannerRevenueY1 / 12;
    const monthlyDirectSavings = (directRows[0]?.savings || 0) / 12;
    const monthlyBotSavings = (dailySolarConsumed * 365 * (tariff - tariff * (1 - solarDiscount))) / 12;
    const solarLeasingTariff = tariff * (1 - solarDiscount);
    const botNewMonthlyBill = Math.max(0, monthlyBill - monthlyBotSavings);
    const directNewMonthlyBill = Math.max(0, monthlyBill - monthlyDirectSavings);

    const dailyGridImport = Math.max(0, calculatedEnergy - dailySolarConsumed);
    const dailyExcessSurplus = Math.max(0, dailySolarProduction - dailySolarConsumed);
    const coveragePct = calculatedEnergy > 0 ? (dailySolarConsumed / calculatedEnergy) * 100 : 0;
    const specificYield = systemSizeKwp > 0 ? dailySolarProduction / systemSizeKwp : 0;
    const maxOutputKw = Math.max(0, ...consumptionData.map(p => p.solarProduction || 0));
    const total20yDirectSavings = directTotalSavings;
    const total20yConventional = annualBillsPln.reduce((sum, row) => sum + row.cost, 0);
    const total20yWithSolar = annualBillsSolar.reduce((sum, row) => sum + row.cost, 0);

    const totalEmissionsReductionTon = totalEmissionsReductionKg / 1000;
    const avgEmissionsReductionTon = totalEmissionsReductionTon / operatingYears;
    const totalMangroveHectares = MANGROVE_SEQUESTRATION_KG_HA > 0 ? totalEmissionsReductionKg / MANGROVE_SEQUESTRATION_KG_HA : 0;
    const totalMangroveTrees = totalMangroveHectares * MANGROVE_DENSITY_TREES_HA;
    const totalCsrValue = totalMangroveTrees * MANGROVE_COST_PER_TREE;

    const firstBotSavings = dailySolarConsumed * 365 * tariff * solarDiscount;
    const avgBotSavings = operatingYears > 0 ? totalBotSavings / operatingYears : 0;

    return {
        countryCode, countryName, province, city,
        locationLabel: countryCode === "ID" ? `${city}, ${province}` : `${city}, ${province}, ${countryName}`,
        facilityLabel: profile.label, kva, tariff, monthlyBill,
        totalEnergyKwh,
        newMonthlyBill: directNewMonthlyBill,
        systemSizeKwp, coveragePct,
        monthlySavings: monthlyPlannerSavings,
        investment: plannerInvestment,
        paybackYears: plannerNcfPayback,
        lifetimeSavings: total20yDirectSavings,
        annualCo2Ton: avgEmissionsReductionTon,
        equivalentTrees: Math.round(totalMangroveTrees / operatingYears),
        panelCount, panelAreaM2,
        catalogBom,
        chartData: consumptionData,
        dailySolarProduction, dailySolarConsumed,
        baseLoadKw: baseLoad,
        idleLoadDisplayKw: idleLoadKw,
        prepLoadDisplayKw: prepLoadKw,
        peakAddonKw: peakLoadAddon,
        idleLoadKw: idleLoadKw,
        maxOutputKw,
        dailyCostPrePv: calculatedEnergy * tariff,
        monthlyBillPrePv: calculatedEnergy * tariff * 30,
        simulatedDailyConsumptionKwh: calculatedEnergy,
        loadCapacityLimited: calculatedEnergy + 0.01 < totalEnergyKwh,
        dailyGridImport, dailyExcessSurplus, specificYield,
        prodVsPotentialPct: pvPotential > 0 ? (specificYield / pvPotential) * 100 : 0,
        prodUtilizedPct: dailySolarProduction > 0 ? (dailySolarConsumed / dailySolarProduction) * 100 : 0,
        prodSurplusPct: dailySolarProduction > 0 ? (dailyExcessSurplus / dailySolarProduction) * 100 : 0,
        solarLeasingTariff, botY1Savings: firstBotSavings, totalBotSavings, avgBotSavings,
        botMonthlySavings: monthlyBotSavings, botNewMonthlyBill,
        totalEmissionsReductionTon, avgEmissionsReductionTon,
        totalMangroveHectares, totalMangroveTrees, totalCsrValue,
        yearlyRows: directRows,
        annualBillsPln,
        annualBillsDp: annualBillsSolar,
        annualBillsBot: annualBillsSolar,
        plannerRows,
        plannerNcfPayback,
        plannerDiscountedPayback,
        plannerNpv,
        plannerIrr,
        directPurchasePayback,
        directPurchaseNpv,
        directPurchaseIrr,
        directPurchaseInvestment,
        directMonthlySavings: monthlyDirectSavings,
        directNewMonthlyBill,
        solarEndTime,
        solarPotential: pvPotential,
        plannerRevenueY1,
        plannerTotalRevenue,
        total20yConventional,
        total20yWithSolar,
        total20yDirectSavings
    };
}

// =====================================================================
// Production vs. consumption chart (inline SVG, no chart library)
// =====================================================================

// Public-calculator battery scenario: intentionally simple and illustrative.
// It auto-sizes a battery from the estimated daily solar production so the
// public calculator stays simple for non-technical visitors.
function getBatteryScenario(r) {

    const points = r.chartData || [];

    // Public Solar Calculator battery scenario:
    // Instead of forcing the public preview into one fixed 61.44 kWh battery,
    // size the battery package from the actual simulated PV surplus. This keeps
    // the chart honest: every modeled surplus interval can be shown as stored
    // energy, while the scenario card reports how much catalogue capacity would
    // be needed to support that profile.
    const catalogueBatteryKwh = 61.44; // Battery Lithium HV 61.44 kWh (set)
    const roundTripEfficiency = 0.92;  // public estimate assumption
    const chargeEfficiency = Math.sqrt(roundTripEfficiency);
    const dischargeEfficiency = Math.sqrt(roundTripEfficiency);

    // First pass: determine the usable battery energy required if all PV
    // surplus is retained. This is the maximum state-of-charge reached during
    // the simulated day, after charging losses.
    let sizingSocKwh = 0;
    let requiredCapacityKwh = 0;
    let rawExcessSolarKwh = 0;

    points.forEach((p) => {
        const surplusKwh = Math.max(0, (p.solarProduction || 0) - (p.consumption || 0)) * DT;
        const storedKwh = surplusKwh * chargeEfficiency;
        sizingSocKwh += storedKwh;
        requiredCapacityKwh = Math.max(requiredCapacityKwh, sizingSocKwh);
        rawExcessSolarKwh += surplusKwh;

        // Discharge sizing pass: the public scenario assumes the stored energy
        // is available later whenever PV cannot cover the load. This prevents
        // the visual from artificially limiting storage just because a single
        // catalogue battery set is smaller than the modeled surplus.
        const deficitKwh = Math.max(0, (p.consumption || 0) - (p.solarProduction || 0)) * DT;
        sizingSocKwh = Math.max(0, sizingSocKwh - Math.min(deficitKwh / dischargeEfficiency, sizingSocKwh));
    });

    const batterySetCount = requiredCapacityKwh > 0
        ? Math.max(1, Math.ceil(requiredCapacityKwh / catalogueBatteryKwh))
        : 0;
    const capacityKwh = batterySetCount * catalogueBatteryKwh;

    let socKwh = 0;
    let energyStoredKwh = 0;
    let energyDischargedKwh = 0;
    let remainingSurplusKwh = 0;
    let directSolarUsedKwh = 0;
    let batterySolarDeliveredKwh = 0;
    let gridImportKwh = 0;

    const batteryPoints = points.map((p) => {
        const directKwh = Math.min(p.consumption, p.solarProduction) * DT;
        const surplusKwh = Math.max(0, p.solarProduction - p.consumption) * DT;
        const deficitKwh = Math.max(0, p.consumption - p.solarProduction) * DT;

        // Public visualization assumes the selected battery package is sized
        // to absorb all modeled PV surplus. No artificial 20 kW charge cap is
        // applied here; the formal design stage will select the appropriate
        // inverter/battery power rating after site survey.
        const availableCapacityKwh = Math.max(0, capacityKwh - socKwh);
        const chargeInputKwh = Math.min(surplusKwh, availableCapacityKwh / chargeEfficiency);
        const storedKwh = chargeInputKwh * chargeEfficiency;
        socKwh += storedKwh;

        // Use stored energy later when PV is unavailable or insufficient.
        const batteryDrawKwh = Math.min(deficitKwh / dischargeEfficiency, socKwh);
        const batteryDeliveredKwh = batteryDrawKwh * dischargeEfficiency;
        socKwh = Math.max(0, socKwh - batteryDrawKwh);

        const gridKwh = Math.max(0, deficitKwh - batteryDeliveredKwh);
        const remainingKwh = Math.max(0, surplusKwh - chargeInputKwh);

        energyStoredKwh += storedKwh;
        energyDischargedKwh += batteryDeliveredKwh;
        remainingSurplusKwh += remainingKwh;
        directSolarUsedKwh += directKwh;
        batterySolarDeliveredKwh += batteryDeliveredKwh;
        gridImportKwh += gridKwh;

        return {
            ...p,
            directSelfConsumed: p.overlay,
            batteryChargeKw: DT > 0 ? chargeInputKwh / DT : 0,
            remainingSurplusKw: DT > 0 ? remainingKwh / DT : 0,
            batteryDeliveredKw: DT > 0 ? batteryDeliveredKwh / DT : 0,
            batterySocKwh: socKwh
        };
    });

    return {
        points: batteryPoints,
        capacityKwh,
        requiredCapacityKwh,
        catalogueBatteryKwh,
        batterySetCount,
        maxChargePowerKw: null,
        maxDischargePowerKw: null,
        roundTripEfficiency,
        chargeEfficiency,
        dischargeEfficiency,
        excessSolarAvailableKwh: rawExcessSolarKwh,
        energyStoredKwh,
        energyDischargedKwh,
        remainingSurplusKwh,
        directSolarUsedKwh,
        batterySolarDeliveredKwh,
        solarUsedKwh: directSolarUsedKwh + batterySolarDeliveredKwh,
        gridImportKwh
    };
}

function areaPathForKey(points, key, x, y) {
    if (!points.length) return "";
    const first = points[0];
    const topPath = points
        .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(Math.max(0, p[key] || 0)).toFixed(1)}`)
        .join(" ");
    return `${topPath} L${x(points[points.length - 1].t).toFixed(1)},${y(0).toFixed(1)} L${x(first.t).toFixed(1)},${y(0).toFixed(1)} Z`;
}

// buildBandPath (diagonal-interpolated band) was only used for the battery
// charge/discharge shading, which now uses buildStepBandPath below for a
// flat, accurate representation of each interval's real value - see that
// function for why. Removed here to avoid two competing band-drawing
// approaches in the same file.
// Flat/"water level" band builder for the battery charge & discharge shading.
// Unlike buildBandPath (which draws a diagonal line between each pair of
// points, so the band edge follows whatever curve the underlying values
// trace), this holds each interval's real value flat across its width and
// only steps vertically at the boundary between two intervals - like a
// staircase. That keeps the shaded band an honest, literal picture of each
// interval's real simulated kW (never interpolated, never implying a value
// between two real readings), and it naturally collapses to zero height
// (invisible) whenever topFn/bottomFn are equal - so a band never appears
// "hanging" with no real charge/discharge behind it.
function buildStepBandPath(points, topFn, bottomFn, x, y) {
    if (!points.length) return "";
    const top = [];
    const bottom = [];
    points.forEach((p, i) => {
        const xi = x(p.t);
        const xNext = i < points.length - 1 ? x(points[i + 1].t) : xi;
        const topV = Math.max(0, topFn(p));
        const botV = Math.max(0, bottomFn(p));
        top.push([xi, y(topV)]);
        bottom.push([xi, y(botV)]);
        if (i < points.length - 1) {
            top.push([xNext, y(topV)]);
            bottom.push([xNext, y(botV)]);
        }
    });
    const upperPath = top.map((c, i) => `${i === 0 ? "M" : "L"}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(" ");
    const lowerPath = bottom.slice().reverse().map((c) => `L${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(" ");
    return `${upperPath} ${lowerPath} Z`;
}

function niceChartMax(value) {
    const safe = Math.max(1, value);
    const exponent = Math.pow(10, Math.floor(Math.log10(safe)));
    const fraction = safe / exponent;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return niceFraction * exponent;
}

function buildProductionChartSvg(points, scenario = null, dims = null) {

    // Designed for the wide calculator card: the viewBox width now matches the
    // chart box's actual rendered pixel width (measured by the caller), while
    // height stays pinned to the CSS-defined box height (300). Previously this
    // used a fixed 1000x300 viewBox with preserveAspectRatio="xMidYMid meet",
    // which only matches a ~3.33:1 container - on any wider/narrower container
    // the drawing got letterboxed with empty gutters instead of filling the
    // available width. Matching the viewBox to the real box removes the
    // letterboxing entirely, so the plot always uses the full container width.
    const width = (dims && dims.width > 0) ? dims.width : 1000;
    const height = (dims && dims.height > 0) ? dims.height : 300;
    const marginL = 58, marginR = 18, marginT = 24, marginB = 38;
    const innerW = width - marginL - marginR;
    const innerH = height - marginT - marginB;
    const plotPointsRaw = scenario ? scenario.points : points;
    // Use the full 5-minute simulation resolution. Sampling every 15 minutes
    // made the battery shading skip real intervals and reduced visual accuracy.
    const plotPoints = plotPointsRaw;
    const maxData = Math.max(1, ...plotPoints.map((p) => Math.max(p.consumption || 0, p.solarProduction || 0)));
    const maxVal = niceChartMax(maxData * 1.08);

    const x = (t) => marginL + (t / 24) * innerW;
    const y = (v) => marginT + innerH - (Math.max(0, v) / maxVal) * innerH;
    const linePath = (key) => plotPoints
        .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p[key] || 0).toFixed(1)}`)
        .join(" ");

    const overlayAreaPath = areaPathForKey(plotPoints, scenario ? "directSelfConsumed" : "overlay", x, y);
    let batteryStorePath = "";
    let batteryDischargePath = "";

    if (scenario) {
        /*
         * Battery visuals use FLAT/STEP bands (see buildStepBandPath) instead
         * of interpolating a diagonal line between points, so each band reads
         * like a literal, per-interval water level rather than a smoothed
         * curve. The values themselves come straight from the already-computed
         * simulation (batteryChargeKw / batteryDeliveredKw from getBatteryScenario,
         * which already respects the catalogue battery's capacity and power
         * ceiling) - the chart no longer applies any additional hardcoded cap.
         *
         * Storage band: sits directly on top of the existing "Solar Used"
         * green area, from directSelfConsumed up to directSelfConsumed +
         * batteryChargeKw. Because batteryChargeKw can never exceed the real
         * PV surplus at that interval, this top edge can never exceed the
         * solar production curve - so the shading never claims more energy
         * than was actually available.
         *
         * Discharge band: the slice of the consumption line, from
         * (consumption - batteryDeliveredKw) up to consumption, that was met
         * by the battery rather than the grid. It is zero-height (invisible)
         * whenever the battery isn't discharging, so it only appears exactly
         * when PV alone can't cover the load.
         */
        batteryStorePath = buildStepBandPath(
            plotPoints,
            (p) => Math.min(
                Math.max(0, p.solarProduction || 0),
                Math.max(0, p.directSelfConsumed || 0) + Math.max(0, p.batteryChargeKw || 0)
            ),
            (p) => Math.min(
                Math.max(0, p.solarProduction || 0),
                Math.max(0, p.directSelfConsumed || 0)
            ),
            x, y
        );
        batteryDischargePath = buildStepBandPath(
            plotPoints,
            (p) => Math.max(0, p.consumption || 0),
            (p) => Math.max(
                0,
                Math.max(0, p.consumption || 0) - Math.min(
                    Math.max(0, p.batteryDeliveredKw || 0),
                    Math.max(0, p.consumption || 0)
                )
            ),
            x, y
        );
    }

    let gridlines = "";
    const ySteps = 5;
    for (let i = 0; i <= ySteps; i++) {
        const value = maxVal * (i / ySteps);
        const yy = y(value);
        gridlines += `<line x1="${marginL}" y1="${yy.toFixed(1)}" x2="${(marginL + innerW).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="var(--border)" stroke-width="1" />`;
        gridlines += `<text x="${marginL - 9}" y="${(yy + 4).toFixed(1)}" font-size="10.5" fill="var(--muted)" text-anchor="end" font-family="Poppins, sans-serif">${formatNumber(value)}</text>`;
    }
    for (let h = 0; h <= 24; h += 4) {
        const xx = x(h);
        gridlines += `<line x1="${xx.toFixed(1)}" y1="${marginT}" x2="${xx.toFixed(1)}" y2="${(marginT + innerH).toFixed(1)}" stroke="var(--border)" stroke-width="1" opacity="0.65" />`;
        gridlines += `<text x="${xx.toFixed(1)}" y="${height - 12}" font-size="10.5" fill="var(--muted)" text-anchor="middle" font-family="Poppins, sans-serif">${h === 24 ? "24:00" : `${String(h).padStart(2, "0")}:00`}</text>`;
    }

    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Estimated daily solar production and electricity consumption">
        <defs>
            <pattern id="batteryHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                <rect width="8" height="8" fill="rgba(139,92,246,0.13)"></rect>
                <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(139,92,246,0.34)" stroke-width="3"></line>
            </pattern>
        </defs>
        ${gridlines}
        <path d="${overlayAreaPath}" fill="rgba(16,185,129,0.20)" stroke="none"></path>
        ${scenario ? `<path d="${batteryStorePath}" fill="url(#batteryHatch)" stroke="none"></path>` : ""}
        ${scenario ? `<path d="${batteryDischargePath}" fill="rgba(139,92,246,0.18)" stroke="none"></path>` : ""}
        <path d="${linePath("consumption")}" fill="none" stroke="#2f80ed" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"></path>
        <path d="${linePath("solarProduction")}" fill="none" stroke="#e78a12" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"></path>
    </svg>`;
}

function renderProductionChart(r) {
    const container = document.getElementById("productionChart");
    if (!container) return;

    // Measure the real rendered box so the SVG viewBox can match it exactly
    // (see buildProductionChartSvg) - falls back to the design-time default
    // when the container isn't laid out yet (e.g. still hidden).
    const rect = container.getBoundingClientRect();
    const dims = { width: rect.width, height: rect.height };

    if (!batteryScenarioEnabled) {
        container.innerHTML = buildProductionChartSvg(r.chartData, null, dims);
        return;
    }

    const scenario = getBatteryScenario(r);
    container.innerHTML = buildProductionChartSvg(r.chartData, scenario, dims);
}

function updateBatteryScenarioInfo(r) {
    const storedCard = document.getElementById("eBatteryStoredCard");
    const storedValue = document.getElementById("eBatteryStored");
    const solarConsumedLabel = document.getElementById("eSolarConsumedLabel");
    const excessLabel = document.getElementById("eExcessSurplusLabel");
    const scenarioSection = document.getElementById("batteryScenarioInfo");

    if (!batteryScenarioEnabled) {
        if (storedCard) storedCard.hidden = true;
        if (scenarioSection) scenarioSection.hidden = true;
        if (solarConsumedLabel) solarConsumedLabel.textContent = "Daily Solar Consumption";
        if (excessLabel) excessLabel.textContent = "Daily Excess Surplus";
        document.getElementById("eSolarConsumed").textContent = `${formatNumber(r.dailySolarConsumed)} kWh`;
        document.getElementById("eGridImport").textContent = `${formatNumber(r.dailyGridImport)} kWh`;
        document.getElementById("eExcessSurplus").textContent = `${formatNumber(r.dailyExcessSurplus)} kWh`;
        document.getElementById("eSolarMix").textContent = `${formatNumber(r.coveragePct)}%`;
        renderEnergyMixDonut({ consumed: r.dailySolarConsumed, gridImport: r.dailyGridImport, excess: r.dailyExcessSurplus });
        return;
    }

    const scenario = getBatteryScenario(r);
    if (storedCard) storedCard.hidden = true;
    if (scenarioSection) scenarioSection.hidden = false;
    if (solarConsumedLabel) solarConsumedLabel.textContent = "Daily Solar Used";
    if (excessLabel) excessLabel.textContent = "Remaining Solar Surplus";

    // Keep the existing Energy Mix section compact; the dedicated scenario cards
    // below the chart now carry the battery-specific metrics.
    if (storedValue) storedValue.textContent = `${formatNumber(scenario.energyStoredKwh)} kWh`;
    document.getElementById("eSolarConsumed").textContent = `${formatNumber(scenario.solarUsedKwh)} kWh`;
    document.getElementById("eGridImport").textContent = `${formatNumber(scenario.gridImportKwh)} kWh`;
    document.getElementById("eExcessSurplus").textContent = `${formatNumber(scenario.remainingSurplusKwh)} kWh`;
    document.getElementById("eSolarMix").textContent = `${formatNumber(r.simulatedDailyConsumptionKwh > 0 ? Math.min(100, (scenario.solarUsedKwh / r.simulatedDailyConsumptionKwh) * 100) : 0)}%`;
    renderEnergyMixDonut({ consumed: scenario.solarUsedKwh, gridImport: scenario.gridImportKwh, excess: scenario.remainingSurplusKwh });

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    setText("bscExcess", `${formatNumber(scenario.excessSolarAvailableKwh)} kWh/day`);
    setText("bscCapacity", `${formatNumber(scenario.capacityKwh)} kWh`);
    setText("bscStored", `${formatNumber(scenario.energyStoredKwh)} kWh/day`);
    setText("bscDischarged", `${formatNumber(scenario.energyDischargedKwh)} kWh/day`);
    setText("bscEfficiency", `${formatNumber(scenario.roundTripEfficiency * 100)}%`);
}

const BATTERY_INFO_COPY = {
    excess: {
        title: "Available Solar Surplus",
        text: "Estimated solar energy available after the facility's direct daytime consumption is met. This is the energy that can be routed to battery storage in this scenario."
    },
    capacity: {
        title: "Estimated Battery Capacity",
        text: "Estimated battery capacity sized to the modeled solar surplus. The calculator rounds the requirement up to multiples of the catalog battery unit (61.44 kWh) so the scenario shown can accommodate the full modeled surplus without an unrealistic fixed capacity cap."
    },
    stored: {
        title: "Stored Energy",
        text: "Estimated solar energy stored in the battery when solar production exceeds direct consumption."
    },
    discharged: {
        title: "Discharged Energy",
        text: "Estimated energy discharged from the battery later to help meet consumption when solar production is unavailable or insufficient."
    },
    efficiency: {
        title: "Battery Round-trip Efficiency",
        text: "Public calculator assumption for battery round-trip efficiency. The catalog does not list a specific battery efficiency figure, so this estimate uses 92%; actual performance depends on the battery, inverter, operating conditions, and chosen system design."
    }
};

function initBatteryInfoPopover() {
    if (window.__batteryInfoPopoverInitialized) return;
    window.__batteryInfoPopoverInitialized = true;

    let activeBtn = null;

    const closeInfo = () => {
        document.querySelectorAll('.calc-battery-info-popover').forEach((p) => p.remove());
        if (activeBtn) activeBtn.setAttribute('aria-expanded', 'false');
        activeBtn = null;
    };

    const positionInfo = (btn, popover) => {
        const r = btn.getBoundingClientRect();
        const gap = 8;
        popover.style.left = '0px';
        popover.style.top = '0px';
        const pw = Math.min(320, Math.max(220, window.innerWidth - 24));
        popover.style.width = `${pw}px`;
        const measured = popover.getBoundingClientRect();

        let left = r.left + r.width - measured.width;
        if (left < 12) left = 12;
        if (left + measured.width > window.innerWidth - 12) {
            left = window.innerWidth - 12 - measured.width;
        }

        let top = r.bottom + gap;
        if (top + measured.height > window.innerHeight - 12) {
            top = r.top - gap - measured.height;
        }
        if (top < 12) top = 12;

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    };

    document.addEventListener('click', (event) => {
        const btn = event.target.closest('.calc-battery-info-btn');
        if (!btn) {
            if (!event.target.closest('.calc-battery-info-popover')) closeInfo();
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (activeBtn === btn) {
            closeInfo();
            return;
        }

        closeInfo();
        const popover = document.createElement('div');
        popover.className = 'calc-battery-info-popover';
        popover.textContent = btn.dataset.info || '';
        popover.setAttribute('role', 'tooltip');
        document.body.appendChild(popover);
        activeBtn = btn;
        btn.setAttribute('aria-expanded', 'true');
        positionInfo(btn, popover);
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeInfo();
    });

    window.addEventListener('resize', () => {
        const popover = document.querySelector('.calc-battery-info-popover');
        if (popover && activeBtn) positionInfo(activeBtn, popover);
    });

    window.addEventListener('scroll', () => {
        const popover = document.querySelector('.calc-battery-info-popover');
        if (popover && activeBtn) positionInfo(activeBtn, popover);
    }, true);
}


function initInputInfoPopovers() {
    if (window.__inputInfoPopoversInitialized) return;
    window.__inputInfoPopoversInitialized = true;

    let activeBtn = null;

    const closeInfo = () => {
        document.querySelectorAll('.calc-input-info-popover').forEach((p) => p.remove());
        if (activeBtn) activeBtn.setAttribute('aria-expanded', 'false');
        activeBtn = null;
    };

    const positionInfo = (btn, popover) => {
        const r = btn.getBoundingClientRect();
        const gap = 8;
        popover.style.left = '0px';
        popover.style.top = '0px';
        const pw = Math.min(320, Math.max(220, window.innerWidth - 24));
        popover.style.width = `${pw}px`;
        const measured = popover.getBoundingClientRect();

        let left = r.left;
        if (left + measured.width > window.innerWidth - 12) {
            left = window.innerWidth - 12 - measured.width;
        }
        if (left < 12) left = 12;

        let top = r.bottom + gap;
        if (top + measured.height > window.innerHeight - 12) {
            top = r.top - gap - measured.height;
        }
        if (top < 12) top = 12;

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    };

    document.addEventListener('click', (event) => {
        const btn = event.target.closest('.calc-input-info-btn');
        if (!btn) {
            if (!event.target.closest('.calc-input-info-popover')) closeInfo();
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (activeBtn === btn) {
            closeInfo();
            return;
        }

        closeInfo();
        const popover = document.createElement('div');
        popover.className = 'calc-input-info-popover';
        popover.textContent = btn.dataset.info || '';
        popover.setAttribute('role', 'tooltip');
        document.body.appendChild(popover);
        activeBtn = btn;
        btn.setAttribute('aria-expanded', 'true');
        positionInfo(btn, popover);
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeInfo();
    });

    const reposition = () => {
        const popover = document.querySelector('.calc-input-info-popover');
        if (popover && activeBtn) positionInfo(activeBtn, popover);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
}

function updateBatteryChartLegend() {
    const legend = document.getElementById("productionChartLegend");
    if (!legend) return;
    const old = document.getElementById("chartBatteryLegend");
    if (old) old.remove();
    const oldDischarge = document.getElementById("chartBatteryDischargeLegend");
    if (oldDischarge) oldDischarge.remove();

    if (batteryScenarioEnabled) {
        const stored = document.createElement("span");
        stored.className = "calc-chart-legend__item";
        stored.id = "chartBatteryLegend";
        stored.innerHTML = '<i class="calc-chart-dot calc-chart-dot--battery"></i> Stored in Battery';
        legend.appendChild(stored);

        const discharge = document.createElement("span");
        discharge.className = "calc-chart-legend__item";
        discharge.id = "chartBatteryDischargeLegend";
        discharge.innerHTML = '<i class="calc-chart-dot calc-chart-dot--battery-discharge"></i> Battery Discharged';
        legend.appendChild(discharge);
    }

    const overlay = document.getElementById("chartOverlayLegend");
    if (overlay) overlay.innerHTML = batteryScenarioEnabled
        ? '<i class="calc-chart-dot calc-chart-dot--overlay"></i> Solar Used'
        : '<i class="calc-chart-dot calc-chart-dot--overlay"></i> Self-consumed';
}

function initBatteryScenario() {
    const toggle = document.getElementById("batteryScenarioToggle");
    if (!toggle) return;

    toggle.checked = batteryScenarioEnabled;
    updateBatteryChartLegend();

    toggle.addEventListener("change", () => {
        batteryScenarioEnabled = toggle.checked;
        updateBatteryChartLegend();
        if (lastResult) {
            renderProductionChart(lastResult);
            updateBatteryScenarioInfo(lastResult);
        }
        trackBatteryScenarioEvent(batteryScenarioEnabled, lastResult);
    });
}

// =====================================================================
// Input tracking
// =====================================================================

function getCalculatorInputSnapshot() {
    const countryCode = document.getElementById("countrySelect")?.value || "ID";
    const manual = (COUNTRY_CONFIG[countryCode] || COUNTRY_CONFIG.OTHER).mode === "manual";
    const tariffSelect = document.getElementById("tariffSelect");

    return {
        country_code: countryCode,
        country: countryCode === "OTHER"
            ? (document.getElementById("countryOtherInput")?.value || "Other")
            : (COUNTRY_CONFIG[countryCode] || {}).label || countryCode,
        province: manual
            ? (document.getElementById("provinceInput")?.value || "")
            : (document.getElementById("provinceSelect")?.value || ""),
        city: manual
            ? (document.getElementById("cityInputText")?.value || "")
            : (document.getElementById("cityInput")?.value || ""),
        facility_type: document.getElementById("facilitySelect")?.value || "",
        installed_pln_kva: Number(document.getElementById("kvaInput")?.value || 0),
        tariff_category: tariffSelect?.value || "",
        custom_tariff_rp_kwh: tariffSelect?.value === "custom"
            ? Number(document.getElementById("customTariffInput")?.value || 0)
            : null,
        energy_input_method: document.getElementById("energyInputMethod")?.value || "bill",
        daily_energy_kwh: document.getElementById("energyInputMethod")?.value === "kwh"
            ? Number(document.getElementById("totalEnergyInput")?.value || 0)
            : null,
        monthly_bill_rp: parseFormattedNumber(document.getElementById("billInput")?.value),
        limit_by_area: document.getElementById("limitByArea")?.checked || false,
        total_roof_area_m2: Number(document.getElementById("totalRoofArea")?.value || 0),
        usable_roof_percent: Number(document.getElementById("usableRoofPercent")?.value || 0),
        battery_storage: batteryScenarioEnabled
    };
}

function initInputTracking() {
    const form = document.getElementById("solarCalcForm");
    if (!form) return;

    form.querySelectorAll("input, select").forEach((field) => {
        field.addEventListener("change", () => {
            trackCalculatorInputChange(field);
        });
    });
}

function trackCalculatorInputChange(field) {
    try {
        if (typeof fbq !== "function") return;
        const snapshot = getCalculatorInputSnapshot();
        const fieldName = field.id || field.name || "unknown";
        let value = field.value;
        if (field.type === "number") value = Number(value || 0);
        fbq("trackCustom", "SolarCalculatorInputChange", {
            content_name: "Solar Calculator",
            field: fieldName,
            value,
            ...snapshot,
            ...getUtmParams()
        });
        // Mirror ke Marketing Analytics — lihat js/marketing-pixel-client.js
        if (typeof trackMarketingEvent === "function") {
            trackMarketingEvent("SolarCalculatorInputChange", { field: fieldName }, `Changed field "${fieldName}"`);
        }
    } catch (err) {
        console.warn("Meta Pixel input tracking failed:", err);
    }
}

function trackBatteryScenarioEvent(enabled, result) {
    try {
        if (typeof fbq !== "function") return;
        fbq("trackCustom", "SolarCalculatorBatteryScenario", {
            content_name: "Solar Calculator",
            battery_storage: enabled,
            system_size_kwp: result?.systemSizeKwp ?? null,
            daily_solar_production_kwh: result?.dailySolarProduction ?? null,
            ...getUtmParams()
        });
        // Mirror ke Marketing Analytics — lihat js/marketing-pixel-client.js
        if (typeof trackMarketingEvent === "function") {
            trackMarketingEvent("SolarCalculatorBatteryScenario", { battery_storage: enabled }, "Toggled battery storage scenario");
        }
    } catch (err) {
        console.warn("Meta Pixel battery tracking failed:", err);
    }
}

// =====================================================================
// Annual electricity bill comparison chart (PLN-only vs PLTS 360energy /
// Beli Putus, over the 20-year horizon) — inline SVG grouped bar chart.
// Two plain bars per sampled year (PLN in blue, With Solar in orange,
// matching the external legend chips) so the two totals read as a direct
// side-by-side comparison, with a "Save Xjt" callout above each pair.
// =====================================================================

const BILLS_CHART_COLOR_PLN = "#2f80ed";   // matches .calc-chart-dot--consumption
const BILLS_CHART_COLOR_SOLAR = "#e78a12"; // matches .calc-chart-dot--solar

function buildAnnualBillsChartSvg(pln, dp, dims = null) {

    // Same fix as buildProductionChartSvg: match the viewBox to the chart
    // box's real rendered size instead of a fixed 1000x300 canvas, so the
    // plot fills the container width without letterboxing or stretching.
    const width = (dims && dims.width > 0) ? dims.width : 1000;
    const height = (dims && dims.height > 0) ? dims.height : 300;

    // Scale text/margins down on narrow (mobile) containers — on top of
    // the container itself rendering smaller (see .calc-chart-box--tall's
    // mobile breakpoint in CSS), tighter fonts leave each "SaveXjt"/value
    // label proportionally more breathing room so neighbouring groups
    // stop colliding instead of just shrinking everything uniformly.
    const narrow = width < 480;
    const tiny = width < 380;
    const axisFont = tiny ? 9 : narrow ? 9.5 : 10.5;
    const valueFont = tiny ? 9 : narrow ? 10 : 11;
    const saveFont = tiny ? 9.5 : narrow ? 10.5 : 11.5;
    const xLabelFont = tiny ? 9 : narrow ? 10 : 11;

    const marginL = tiny ? 40 : narrow ? 46 : 56;
    const marginR = 12;
    const marginT = narrow ? 62 : 56;
    const marginB = 26;
    const innerW = width - marginL - marginR;
    const innerH = height - marginT - marginB;

    const years = pln.length;
    if (!years) {
        return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%"></svg>`;
    }

    // Sample a handful of evenly-spaced years (always including Year 1 and
    // the final year) instead of plotting all 20 — clearer as bar groups
    // than a dense 20-point line chart would be. Fewer groups on narrow
    // (mobile) containers so bars/labels don't crowd.
    const groupCount = Math.max(2, Math.min(years, tiny ? 3 : narrow ? 4 : 5));
    const idxSet = new Set();
    for (let i = 0; i < groupCount; i++) {
        idxSet.add(Math.round((i / (groupCount - 1)) * (years - 1)));
    }
    const idxs = Array.from(idxSet).sort((a, b) => a - b);

    // Extra headroom above the tallest bar on narrow screens — there are
    // two stacked labels ("SaveXjt" + the bar's own value label) above
    // each bar group, so they need more vertical room to avoid stacking
    // on top of each other or the top gridline.
    const maxCost = Math.max(1, ...pln.map((d) => d.cost)) * (narrow ? 1.55 : 1.3);
    const yScale = (v) => marginT + innerH - (Math.max(0, v) / maxCost) * innerH;
    const yZero = marginT + innerH;

    const fmtJt = (v) => `${Math.round(v / 1e6)}jt`;

    let gridlines = "";
    const yTicks = narrow ? 3 : 4;
    for (let i = 0; i <= yTicks; i++) {
        const v = (maxCost / yTicks) * i;
        const yPos = yScale(v);
        gridlines += `<line x1="${marginL}" y1="${yPos.toFixed(1)}" x2="${width - marginR}" y2="${yPos.toFixed(1)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3,4" />`;
        gridlines += `<text x="${marginL - 8}" y="${(yPos + 3).toFixed(1)}" font-size="${axisFont}" fill="var(--muted)" text-anchor="end" font-family="Poppins, sans-serif">${fmtJt(v)}</text>`;
    }

    const groupN = idxs.length;
    const groupGap = Math.max(narrow ? 10 : 14, innerW * 0.05);
    const groupW = (innerW - groupGap * (groupN - 1)) / groupN;
    const barGap = Math.max(narrow ? 4 : 6, groupW * 0.12);
    const barW = Math.max(narrow ? 8 : 10, (groupW - barGap) / 2);

    let bars = "";
    let xLabels = "";
    let saveLabels = "";

    // One plain bar per series, per sampled year — a direct height-vs-height
    // comparison rather than a stacked paid/saved split. A value label
    // ("204jt") sits just above each bar.
    const valueGap = narrow ? 6 : 8;
    const plainBar = (barX, cost, color) => {
        const barY = yScale(cost);
        const barH = Math.max(0, yZero - barY);
        const rect = `<rect x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="6" fill="${color}"></rect>`;
        const label = `<text x="${(barX + barW / 2).toFixed(1)}" y="${(barY - valueGap).toFixed(1)}" font-size="${valueFont}" font-weight="700" fill="var(--ink)" text-anchor="middle" font-family="Poppins, sans-serif">${fmtJt(cost)}</text>`;
        return rect + label;
    };

    const saveGap = narrow ? 20 : 24;
    idxs.forEach((idx, gi) => {
        const groupX = marginL + gi * (groupW + groupGap);
        const plnCost = pln[idx].cost;
        const dpCost = dp[idx] ? dp[idx].cost : 0;
        const groupCenter = groupX + groupW / 2;

        bars += plainBar(groupX, plnCost, BILLS_CHART_COLOR_PLN);
        bars += plainBar(groupX + barW + barGap, dpCost, BILLS_CHART_COLOR_SOLAR);

        const saveY = yScale(Math.max(plnCost, dpCost)) - saveGap - valueGap;
        saveLabels += `<text x="${groupCenter.toFixed(1)}" y="${Math.max(marginT - 8, saveY).toFixed(1)}" font-size="${saveFont}" font-weight="700" fill="var(--success)" text-anchor="middle" font-family="Poppins, sans-serif">Save ${fmtJt(Math.max(0, plnCost - dpCost))}</text>`;

        xLabels += `<text x="${groupCenter.toFixed(1)}" y="${height - 8}" font-size="${xLabelFont}" font-weight="600" fill="var(--ink)" text-anchor="middle" font-family="Poppins, sans-serif">Year ${idx + 1}</text>`;
    });

    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
        ${gridlines}
        ${bars}
        ${saveLabels}
        ${xLabels}
    </svg>`;

}

function renderAnnualBillsChart(r) {

    const container = document.getElementById("annualBillsChart");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    container.innerHTML = buildAnnualBillsChartSvg(r.annualBillsPln, r.annualBillsDp, { width: rect.width, height: rect.height });

    const headline = document.getElementById("billsSavingsHeadline");
    if (headline && r.annualBillsPln.length && r.annualBillsDp.length) {
        const firstSave = Math.max(0, r.annualBillsPln[0].cost - r.annualBillsDp[0].cost);
        const lastIdx = r.annualBillsPln.length - 1;
        const lastSave = Math.max(0, r.annualBillsPln[lastIdx].cost - r.annualBillsDp[lastIdx].cost);
        headline.innerHTML = `Save ${formatRupiah(firstSave)} in Year 1 &rarr; save ${formatRupiah(lastSave)}/year by Year ${lastIdx + 1}`;
    }

}

// =====================================================================
// Small section charts (bar / donut) for Solar PV System, Consumption,
// Estimated Energy Performance (Year 1), ZeroCapEx Solar Leasing (BOT) and
// Environmental Impact & CSR Equivalency — inline SVG, same no-library
// approach as the charts above, purely additive visualizations layered on
// top of the existing detail cards (which keep populating as before).
// =====================================================================

// Horizontal bar chart used for the Consumption load comparison and the
// BOT Year 1 vs. Average Annual Savings comparison.
function buildBarChartSvg(items, dims = null) {

    const width = (dims && dims.width > 0) ? dims.width : 560;

    // Below this container width there isn't enough room to fit a label
    // like "Additional Peak Load" next to the bar without the bar/value
    // overlapping the tail end of the text (SVG <text> doesn't wrap or
    // clip on its own). Below the threshold, stack each row as label
    // on its own line, then bar + value beneath it — label always gets
    // the full row width, so nothing ever gets covered.
    const stacked = width < 480;

    const barH = 24;
    const rowGap = stacked ? 20 : 18;
    const labelRowH = stacked ? 16 : 0;
    const topPad = 8;
    const labelFont = stacked ? 11 : 11.5;
    const valueW = Math.max(70, Math.min(120, width * (stacked ? 0.26 : 0.24)));
    const labelW = stacked ? 0 : Math.max(100, Math.min(180, width * 0.34));
    const trackX = stacked ? 0 : labelW + 8;
    const trackW = Math.max(24, width - trackX - valueW - 8);

    const height = topPad * 2 + items.length * (labelRowH + barH + rowGap) - rowGap;
    const maxVal = Math.max(1, ...items.map((it) => it.value || 0));

    let rows = "";
    items.forEach((it, i) => {
        const rowY = topPad + i * (labelRowH + barH + rowGap);
        const barY = rowY + labelRowH;
        const barW = Math.max(2, ((it.value || 0) / maxVal) * trackW);
        const labelY = stacked ? (rowY + 11) : (barY + barH / 2 + 4);
        rows += `
            <text x="0" y="${labelY.toFixed(1)}" font-size="${labelFont}" font-weight="500" fill="var(--ink)" font-family="Poppins, sans-serif">${escapeHtml(it.label)}</text>
            <rect x="${trackX}" y="${barY}" width="${trackW.toFixed(1)}" height="${barH}" rx="7" fill="var(--border)" opacity="0.45"></rect>
            <rect x="${trackX}" y="${barY}" width="${barW.toFixed(1)}" height="${barH}" rx="7" fill="${it.color}"></rect>
            <text x="${(trackX + trackW + 10).toFixed(1)}" y="${(barY + barH / 2 + 4).toFixed(1)}" font-size="12" font-weight="700" fill="var(--ink)" font-family="Poppins, sans-serif">${escapeHtml(it.display)}</text>`;
    });

    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="false">${rows}</svg>`;
}

// Donut chart used for the daily energy mix (Solar Used / Grid Import /
// Excess Surplus) in the Estimated Energy Performance section.
function buildDonutChartSvg(slices, dims = null) {

    const size = Math.max(120, Math.round(Math.min((dims && dims.width) || 168, (dims && dims.height) || 168)));
    const cx = size / 2, cy = size / 2;
    const strokeW = size * 0.19;
    const radius = (size / 2) - (strokeW / 2) - 2;
    const circumference = 2 * Math.PI * radius;
    const total = Math.max(0, slices.reduce((sum, s) => sum + (s.value || 0), 0));

    let segments = "";
    if (total <= 0) {
        segments = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="var(--border)" stroke-width="${strokeW}"></circle>`;
    } else {
        let offset = 0;
        slices.forEach((s) => {
            const value = Math.max(0, s.value || 0);
            if (value <= 0) return;
            const dash = (value / total) * circumference;
            segments += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${s.color}" stroke-width="${strokeW}"
                stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
                stroke-dashoffset="${(-offset).toFixed(2)}"
                transform="rotate(-90 ${cx} ${cy})"></circle>`;
            offset += dash;
        });
    }

    const centerLabel = total > 0 ? formatNumber(total) : "--";

    return `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="false">
        ${segments}
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="${(size * 0.145).toFixed(1)}" font-weight="700" fill="var(--ink)" font-family="Poppins, sans-serif">${centerLabel}</text>
        <text x="${cx}" y="${(cy + size * 0.115).toFixed(1)}" text-anchor="middle" font-size="${(size * 0.075).toFixed(1)}" fill="var(--muted)" font-family="Poppins, sans-serif">kWh/day</text>
    </svg>`;
}

function renderConsumptionChart(r) {
    const container = document.getElementById("consumptionLoadChart");
    if (!container) return;
    const items = [
        { label: "Base Load", value: r.baseLoadKw || 0, display: `${formatNumber(r.baseLoadKw)} kW`, color: "var(--primary)" },
        { label: "Additional Peak Load", value: r.peakAddonKw || 0, display: `${formatNumber(r.peakAddonKw)} kW`, color: "var(--accent)" },
        { label: "Installed PLN Capacity", value: r.kva || 0, display: `${formatNumber(r.kva)} kVA`, color: "#2f80ed" }
    ];
    const rect = container.getBoundingClientRect();
    container.innerHTML = buildBarChartSvg(items, { width: rect.width });
}

// Renders the daily energy-mix donut + its legend. Always uses three slices
// (Solar Used, Grid Import, Excess/Remaining Surplus) so the total honestly
// sums to the day's production + grid import in both the plain and
// battery-scenario cases — energy stored in the battery is not drawn as a
// separate slice since it is already folded into "Solar Used" once it's
// delivered later in the day (see getBatteryScenario's solarUsedKwh).
function renderEnergyMixDonut(vals) {
    const container = document.getElementById("energyMixDonut");
    const legend = document.getElementById("energyMixDonutLegend");
    if (!container) return;

    const slices = [
        { label: batteryScenarioEnabled ? "Solar Used" : "Solar Consumed", value: Math.max(0, vals.consumed || 0), color: "var(--success)" },
        { label: "Grid Import", value: Math.max(0, vals.gridImport || 0), color: "#ef4444" },
        { label: batteryScenarioEnabled ? "Remaining Surplus" : "Excess Surplus", value: Math.max(0, vals.excess || 0), color: "#2f80ed" }
    ];

    const rect = container.getBoundingClientRect();
    container.innerHTML = buildDonutChartSvg(slices, { width: rect.width, height: rect.height });

    if (!legend) return;
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    legend.innerHTML = slices.map((s) => {
        const pct = total > 0 ? (s.value / total) * 100 : 0;
        return `<div class="calc-donut-legend__item">
            <span class="calc-donut-legend__dot" style="background:${s.color}"></span>
            <span class="calc-donut-legend__label">${escapeHtml(s.label)}</span>
            <span class="calc-donut-legend__value">${formatNumber(s.value)} kWh <small>(${formatNumber(pct)}%)</small></span>
        </div>`;
    }).join("");
}

// =====================================================================
// Year-by-year table (Direct Purchase) + expand/collapse toggle
// =====================================================================

function renderYearlyTable(r) {

    const body = document.getElementById("yearlyTableBody");
    if (!body) return;

    body.innerHTML = r.yearlyRows.map((row) => `
        <tr>
            <td>${row.year}</td>
            <td>${formatRupiah(row.savings)}</td>
            <td>${formatRupiah(row.opex)}</td>
            <td>${formatRupiah(row.ncf)}</td>
            <td>${formatRupiah(row.accumNcf)}</td>
        </tr>
    `).join("");

}

function initYearlyTableToggle() {

    const btn = document.getElementById("toggleYearlyTable");
    const wrap = document.getElementById("yearlyTableWrap");
    if (!btn || !wrap) return;

    btn.addEventListener("click", () => {
        const isOpen = !wrap.hidden;
        wrap.hidden = isOpen;
        btn.classList.toggle("is-open", !isOpen);
        btn.innerHTML = isOpen
            ? `Expand Table <i class="fa-solid fa-chevron-down"></i>`
            : `Collapse Table <i class="fa-solid fa-chevron-down"></i>`;
    });

}

// =====================================================================
// Render
// =====================================================================

function renderResult(r, { scrollToResult = true } = {}) {

    document.getElementById("emptyState").hidden = true;
    const output = document.getElementById("calcOutput");
    output.hidden = false;

    document.getElementById("summaryBanner").innerHTML =
        `For <b>${escapeHtml(r.facilityLabel)}</b> in <b>${escapeHtml(r.locationLabel)}</b> ` +
        `with an installed PLN power capacity of <b>${formatNumber(r.kva)} kVA</b> and a monthly bill of <b>${formatRupiah(r.monthlyBill)}</b>, ` +
        `here's your estimated solar PV system:`;

    document.getElementById("statSystemSize").textContent = `${formatNumber(r.systemSizeKwp)} kWp`;
    document.getElementById("statPanelCountShort").textContent = `± ${r.panelCount} solar panels`;
    document.getElementById("statCoverage").textContent = `${formatNumber(r.coveragePct)}%`;
    document.getElementById("statMonthlySavings").textContent = formatRupiah(r.monthlySavings);
    document.getElementById("statBillCompare").textContent =
        `Bill drops from ${formatRupiah(r.monthlyBill)} to ± ${formatRupiah(r.newMonthlyBill)}`;

    renderProductionChart(r);

    // --- BOT / Leasing tariff strip (unlocked, above the chart) ---
    document.getElementById("statPlnTariff").textContent = `Rp ${formatNumber(r.tariff)}/kWh`;
    document.getElementById("statSolarTariff").textContent = `Rp ${formatNumber(r.solarLeasingTariff)}/kWh`;

    // --- Sales pitch: conventional (PLN-only) vs. solar, 20-year outlook.
    // Uses the ongoing-cost totals only (grid + opex) so the upfront
    // investment figure stays a reason to unlock the full breakdown.
    const total20yConventional = r.annualBillsPln.reduce((sum, row) => sum + row.cost, 0);
    const total20yWithSolar = r.annualBillsDp.reduce((sum, row) => sum + row.cost, 0);
    const total20ySavings = Math.max(0, total20yConventional - total20yWithSolar);
    const total20ySavingsPct = total20yConventional > 0
        ? (total20ySavings / total20yConventional) * 100 : 0;

    document.getElementById("pitchConventionalCost").textContent = formatRupiah(total20yConventional);
    document.getElementById("pitchSolarCost").textContent = formatRupiah(total20yWithSolar);
    document.getElementById("pitchSavingsAmount").textContent = formatRupiah(total20ySavings);
    document.getElementById("pitchSavingsPct").textContent = `${formatNumber(total20ySavingsPct)}%`;
    document.getElementById("pitchSavingsPctTeaser").textContent = `${formatNumber(total20ySavingsPct)}%`;
    document.getElementById("pitchCo2").textContent = `${formatNumber(r.totalEmissionsReductionTon)} tCO2e`;
    document.getElementById("pitchTrees").textContent = `± ${formatNumber(Math.round(r.totalMangroveTrees))}`;

    // --- Savings-hero info grid (monthly bill / system size / tariff) ---
    document.getElementById("heroMonthlyBillOld").textContent = formatRupiah(r.monthlyBill);
    document.getElementById("heroMonthlyBillNew").textContent = `± ${formatRupiah(r.newMonthlyBill)}`;
    document.getElementById("heroSystemSize").textContent = `${formatNumber(r.systemSizeKwp)} kWp`;
    document.getElementById("heroPanelCount").textContent = `${r.panelCount}`;
    document.getElementById("heroTariffOld").textContent = `Rp ${formatNumber(r.tariff)}/kWh`;
    document.getElementById("heroTariffNew").textContent = `Rp ${formatNumber(r.solarLeasingTariff)}/kWh`;

    // --- Savings-hero PLN vs. Solar comparison bars ---
    const heroBarMax = Math.max(total20yConventional, total20yWithSolar, 1);
    document.getElementById("heroBarPln").style.width = `${(total20yConventional / heroBarMax) * 100}%`;
    document.getElementById("heroBarSolar").style.width = `${(total20yWithSolar / heroBarMax) * 100}%`;

    // --- Consumption breakdown ---
    document.getElementById("cBaseLoad").textContent = `${formatNumber(r.baseLoadKw)} kW`;
    document.getElementById("cPeakLoad").textContent = `${formatNumber(r.peakAddonKw)} kW`;
    document.getElementById("cMaxLoad").textContent = `${formatNumber(r.kva)} kVA`;
    document.getElementById("cPrepIdleLoad").textContent =
        `${formatNumber(r.prepLoadDisplayKw)} / ${formatNumber(r.idleLoadDisplayKw)} kW`;
    document.getElementById("cDailyCostPrePv").textContent = formatRupiah(r.dailyCostPrePv);
    document.getElementById("cMonthlyBillPrePv").textContent = formatRupiah(r.monthlyBillPrePv);
    renderConsumptionChart(r);

    // --- Solar PV system ---
    document.getElementById("sIdealPanels").textContent = r.panelCount;
    document.getElementById("sSystemSize").textContent = `${formatNumber(r.systemSizeKwp)} kWp`;
    document.getElementById("sTotalArea").textContent = `${formatNumber(r.panelAreaM2)} m²`;
    document.getElementById("sMaxOutput").textContent = `${formatNumber(r.maxOutputKw)} kW`;

    // --- Energy mix ---
    document.getElementById("eSolarConsumed").textContent = `${formatNumber(r.dailySolarConsumed)} kWh`;
    document.getElementById("eGridImport").textContent = `${formatNumber(r.dailyGridImport)} kWh`;
    document.getElementById("eExcessSurplus").textContent = `${formatNumber(r.dailyExcessSurplus)} kWh`;
    document.getElementById("eTotalProduction").textContent = `${formatNumber(r.dailySolarProduction)} kWh`;
    document.getElementById("eSpecificYield").textContent = `${formatNumber(r.specificYield)} kWh/kWp`;
    document.getElementById("eSolarMix").textContent = `${formatNumber(r.coveragePct)}%`;
    updateBatteryScenarioInfo(r);

    // --- BOT / Leasing ---
    const leaseSavePct = r.monthlyBill > 0 ? (r.botMonthlySavings / r.monthlyBill) * 100 : 0;
    document.getElementById("leaseOldBill").textContent = formatRupiah(r.monthlyBill);
    document.getElementById("leaseSavePct").textContent = `save ${formatNumber(leaseSavePct)}%`;
    document.getElementById("botNewBill").textContent = formatRupiah(r.botNewMonthlyBill);
    document.getElementById("botMonthlySavings").textContent = `save ${formatRupiah(r.botMonthlySavings)}/mo`;
    document.getElementById("botTotalSavings").textContent = formatRupiah(r.totalBotSavings);

    // --- Direct purchase ---
    const dpSavePct = r.monthlyBill > 0 ? (r.monthlySavings / r.monthlyBill) * 100 : 0;
    document.getElementById("dpOldBill").textContent = formatRupiah(r.monthlyBill);
    document.getElementById("dpSavePct").textContent = `save ${formatNumber(dpSavePct)}%`;
    document.getElementById("dpNewBill").textContent = formatRupiah(r.newMonthlyBill);
    document.getElementById("dpMonthlySavings").textContent = `save ${formatRupiah(r.monthlySavings)}/mo`;
    // Primary financial output follows the Planner NCF model — this card
    // also shows "NPV (Planner NCF)" / "IRR (Planner NCF)" / "Payback NCF
    // Planner" right below, so the headline investment + payback bar must
    // use the SAME model (r.plannerInvestment / r.plannerNcfPayback), not
    // Direct Purchase, or the numbers in one card won't reconcile with
    // each other (previously: investment + bar from Direct Purchase, but
    // NPV/IRR from Planner — different capex base, so nothing lined up).
    // The Direct Purchase sub-tab's own numbers (dpOldBill, dpNewBill,
    // dpMonthlySavings, and the separately-labeled "directPurchasePayback"
    // id below) are untouched and still reflect the Direct Purchase model.
    document.getElementById("statPayback").textContent = formatPaybackYears(r.plannerNcfPayback);
    document.getElementById("statPaybackTeaser").textContent = formatPaybackYears(r.plannerNcfPayback).replace(" yrs", " years");
    document.getElementById("statLifetimeSavings").textContent = formatRupiah(r.lifetimeSavings);
    document.getElementById("statInvestment").textContent = formatRupiah(r.plannerInvestment);

    // Expose all planner-vs-direct-purchase metrics explicitly. This avoids
    // the previous 9.36 vs 10.7 ambiguity: 9.36 is Planner NCF Payback,
    // while the separate Direct Purchase Payback is the end-user model.
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText("statNpv", formatRupiah(r.plannerNpv));
    setText("statIrr", `${formatNumber(r.plannerIrr * 100)}%`);
    setText("plannerNcfPayback", formatPaybackYears(r.plannerNcfPayback));
    setText("plannerDiscountedPayback", formatPaybackYears(r.plannerDiscountedPayback));
    setText("plannerNpv", formatRupiah(r.plannerNpv));
    setText("plannerIrr", `${formatNumber(r.plannerIrr * 100)}%`);
    setText("directPurchasePayback", formatPaybackYears(r.directPurchasePayback));

    // Payback bar: red segment = years still paying off the investment,
    // green segment = years of pure savings after payback, over the
    // OPERATING_YEARS (20yr) horizon. Marker sits at the payback point.
    // Uses the Planner NCF payback (matches statPayback/statInvestment
    // above and the NPV/IRR figures in this same card).
    const paybackPct = Math.min(100, Math.max(0, (r.plannerNcfPayback / OPERATING_YEARS) * 100));
    document.getElementById("paybackFillPaid").style.width = `${paybackPct}%`;
    document.getElementById("paybackFillFree").style.width = `${100 - paybackPct}%`;
    document.getElementById("paybackMarker").style.left = `${paybackPct}%`;


    // --- Environmental / CSR ---
    document.getElementById("envTotalEmissions").textContent = `${formatNumber(r.totalEmissionsReductionTon)} tCO2e`;
    document.getElementById("envAvgEmissions").textContent = `${formatNumber(r.avgEmissionsReductionTon)} tCO2e`;
    document.getElementById("envMangroveHa").textContent = `${formatNumber(r.totalMangroveHectares)} ha`;
    document.getElementById("envMangroveTrees").textContent = `± ${formatNumber(r.totalMangroveTrees)} trees`;

    renderAnnualBillsChart(r);
    renderYearlyTable(r);

    // Detail section stays locked until an email has been captured this
    // session — once unlocked, later recalculations stay unlocked too.
    const detailWrap = document.querySelector(".calc-detail-wrap");
    const isUnlocked = sessionStorage.getItem("edash-solar-lead-email");
    detailWrap.classList.toggle("is-locked", !isUnlocked);
    document.getElementById("unlockedActions").hidden = !isUnlocked;
    placeLockOverlayInActiveTab();

    if (scrollToResult) output.scrollIntoView({ behavior: "smooth", block: "start" });

}

// =====================================================================
// Email gate (dummy — no backend yet)
// =====================================================================

function initEmailGate() {

    const form = document.getElementById("emailGateForm");
    if (!form) return;

    form.addEventListener("submit", (e) => {

        e.preventDefault();

        const nameInput = document.getElementById("leadNameInput");
        const typeInput = document.getElementById("leadTypeInput");
        const input = document.getElementById("emailGateInput");
        const phoneInput = document.getElementById("leadPhoneInput");
        const addressInput = document.getElementById("leadAddressInput");
        const errorEl = document.getElementById("emailGateError");
        const submitBtn = document.getElementById("emailGateSubmit");

        const name = nameInput.value.trim();
        const leadType = typeInput.value;
        const email = input.value.trim();
        const phone = phoneInput.value.trim();
        const address = addressInput.value.trim();

        errorEl.textContent = "";
        errorEl.classList.remove("is-visible");

        if (!name || !leadType || !phone || !address) {
            errorEl.textContent = "Please fill in all fields.";
            errorEl.classList.add("is-visible");
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errorEl.textContent = "Please enter a valid email address.";
            errorEl.classList.add("is-visible");
            return;
        }

        const lead = { name, leadType, email, phone, address };

        const label = submitBtn.querySelector(".btn-login__label");
        submitBtn.disabled = true;
        if (label) label.textContent = "Verifying...";

        // 1) Simpan lead ke backend/database internal (Activity Log,
        //    daftar reach-out per negara/kota, dsb). Ini sumber data
        //    "sungguhan" yang diminta mentor kamu — TIDAK melalui Pixel.
        // 2) Tembak event Pixel Meta & TikTok, khusus untuk mengukur
        //    efektivitas iklan di Ads Manager masing-masing platform.
        Promise.resolve(submitLeadToBackend(lead))
            .catch((err) => console.warn("Lead gagal disimpan ke backend:", err))
            .finally(() => {

                saveLeadDummy(lead); // fallback lokal, aman dihapus setelah backend siap
                sessionStorage.setItem("edash-solar-lead-email", email);
                // Simpan seluruh data lead (bukan cuma email) supaya PDF
                // penawaran (generatePdf) bisa langsung pakai nama/alamat/
                // no. telp/tipe pelanggan yang diisi user di form unlock ini,
                // tanpa perlu query ulang ke localStorage.
                try { sessionStorage.setItem("edash-solar-lead-info", JSON.stringify(lead)); } catch (err) { /* non-critical */ }

                document.querySelector(".calc-detail-wrap").classList.remove("is-locked");
                document.getElementById("unlockedActions").hidden = false;

                submitBtn.disabled = false;
                if (label) label.textContent = "Unlock Details & Report";

            });

    });

}

// =====================================================================
// Pixel events (Meta & TikTok) — HANYA untuk Ads Manager, bukan untuk
// Activity Log / database internal. Dipanggil dengan objek "result"
// dari computeEstimate(), yang sudah punya countryCode/countryName/
// province/city yang benar baik untuk mode dropdown (Indonesia, US)
// maupun mode manual ("Other").
// =====================================================================

function trackCalculatorEvent(result, inputs = {}) {
    const { countryCode, countryName, province, city, facilityLabel } = result || {};
    const utm = getUtmParams();
    const payload = {
        content_name: "Solar Calculator",
        content_category: facilityLabel,
        country: countryName, country_code: countryCode,
        province, city,
        ...inputs,
        ...utm,
    };

    try {
        if (typeof fbq === "function") {
            fbq("track", "ViewContent", payload);
            fbq("trackCustom", "SolarCalculatorCalculate", payload);
            // Mirror ke Marketing Analytics — lihat js/marketing-pixel-client.js.
            // Ini yang mengisi metrik "Calculate Estimate" di section Marketing
            // Analytics (Activity Log), TIDAK ditulis ke activity-logs.json.
            if (typeof trackMarketingEvent === "function") {
                trackMarketingEvent("ViewContent", {
                    content_category: facilityLabel, country_code: countryCode,
                }, "Clicked \"Calculate Estimate\"");
            }
        }
    } catch (err) { console.warn("Meta Pixel event failed:", err); }

    try {
        if (typeof ttq !== "undefined" && ttq.track) {
            ttq.track("ViewContent", {
                content_name: "Solar Calculator",
                content_category: facilityLabel,
                ...inputs,
                ...utm,
            });
        }
    } catch (err) { console.warn("TikTok Pixel event failed:", err); }
}

function trackLeadEvent(email, result) {
    const { countryCode, countryName, province, city } = result || {};
    const utm = getUtmParams();

    try {
        if (typeof fbq === "function") {
            // fbq('track', ...) mengirim event "Lead" ke Meta Ads Manager
            // untuk pengukuran konversi iklan Instagram. Ini TIDAK
            // membuat data ini muncul di Activity Log internal kamu.
            fbq("track", "Lead", { country: countryName, country_code: countryCode, province, city, ...utm });
            // Mirror ke Marketing Analytics — lihat js/marketing-pixel-client.js.
            // Sengaja TIDAK menyertakan email (PII) di sini — hanya dipakai
            // untuk menghitung jumlah/rasio konversi, bukan menyimpan identitas.
            if (typeof trackMarketingEvent === "function") {
                trackMarketingEvent("Lead", { country_code: countryCode, province, city }, "Submitted email to unlock the estimate");
            }
        }
    } catch (err) { console.warn("Meta Pixel Lead event failed:", err); }

    try {
        if (typeof ttq !== "undefined" && ttq.track) {
            ttq.track("SubmitForm", { content_name: "Solar Calculator Lead", ...utm });
        }
    } catch (err) { console.warn("TikTok Pixel Lead event failed:", err); }
}

// =====================================================================
// Backend lead capture — INI yang mengisi Activity Log & database
// internal (per negara/kota) yang diminta mentor kamu. Pixel di atas
// TIDAK bisa melakukan ini; endpoint di bawah harus dibuat oleh tim
// backend kamu.
// =====================================================================

async function submitLeadToBackend(lead) {

    const { name, leadType, email, phone, address } = lead;

    // Pixel event untuk Ads Manager (Meta & TikTok) — jalan bersamaan
    // dengan pengiriman ke backend, tapi dua jalur data yang terpisah.
    trackLeadEvent(email, lastResult);

    // TODO: ganti URL di bawah dengan endpoint backend/API asli kamu,
    // mis. POST /api/leads. Backend itu yang bertanggung jawab menulis
    // baris baru ke tabel Activity Log / leads di database, termasuk
    // country/city, supaya bisa dipakai untuk reach-out.
    const endpoint = "/api/leads";

    const payload = {
        name,
        leadType,
        email,
        phone,
        address,
        countryCode: lastResult?.countryCode,
        country: lastResult?.countryName,
        province: lastResult?.province,
        city: lastResult?.city,
        facilityType: lastResult?.facilityLabel,
        source: "solar_calculator",
        utm: getUtmParams(),
        capturedAt: new Date().toISOString(),
        result: lastResult,
    };

    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Backend lead capture failed: ${response.status}`);
    }

    return response.json().catch(() => null);

}

function saveLeadDummy(lead) {

    try {
        const key = "edash-solar-leads";
        const existing = JSON.parse(localStorage.getItem(key) || "[]");
        existing.push({ ...lead, capturedAt: new Date().toISOString(), result: lastResult });
        localStorage.setItem(key, JSON.stringify(existing));
    } catch (err) {
        // Storage can fail (quota/private mode) — non-critical for the demo.
        console.warn("Could not save dummy lead:", err);
    }

}

// =====================================================================
// PDF export
// =====================================================================

function initPdfDownload() {

    const btn = document.getElementById("downloadPdfBtn");
    if (!btn) return;

    btn.addEventListener("click", () => {

        if (!lastResult) return;

        // Enforce the email gate at the logic level too — not just via the
        // button's [hidden] state — so the PDF can never be generated
        // before a lead email has been captured this session.
        const isUnlocked = sessionStorage.getItem("edash-solar-lead-email");
        if (!isUnlocked) {
            const lockOverlay = document.getElementById("lockOverlay");
            const emailInput = document.getElementById("emailGateInput");
            if (lockOverlay) lockOverlay.scrollIntoView({ behavior: "smooth", block: "center" });
            if (emailInput) emailInput.focus();
            return;
        }

        generatePdf(lastResult);

    });

}

// ---------------------------------------------------------------------
// PDF export — "Penawaran" (offer letter) format matching 360energy's
// official quotation document: Page 1 is the formal offer letter
// (facsimile of the real PLTS penawaran letterhead) filled with the
// lead's own unlock-form data + the calculator's headline numbers.
// Page 2 onward mirrors the on-page "Ringkasan / Finansial / Teknis"
// result tabs field-for-field (same computed result object r / lastResult,
// same formatNumber/formatRupiah helpers the page itself uses), covering:
//   Ringkasan — system size/coverage, 20yr PLN-vs-solar pitch, annual
//               bill comparison chart
//   Finansial — PLN vs. Solar Leasing tariff, ZeroCapEx Solar Leasing
//               (BOT) bill compare + savings chart + stat cards
//   Teknis — energy-mix chart, consumption / PV system / energy
//            performance figures ("Desain Sistem PLTS")
//   Finansial — Direct Purchase (Beli Putus) investment, payback,
//               lifetime savings, bill compare
//   Bill of Quantities (BOQ)
//   Direct Purchase 20-year year-by-year projection table
//   Environmental Impact & CSR Equivalency (4 cards, matches the
//   Ringkasan tab's CSR grid exactly)
//   Year-by-year emissions reduction table (supplementary detail)
// These sections flow continuously — a section only breaks onto a new
// page when it would otherwise run past the footer (see pdfEnsureSpace),
// so short sections share a page instead of one topic per page. The
// final page count is therefore dynamic, not fixed. Every page,
// including page 1, carries the translucent "360energy" watermark
// (opacity 20%).
// ---------------------------------------------------------------------

const PDF_PAGE_W = 210, PDF_PAGE_H = 297;
const PDF_MARGIN = 14, PDF_RIGHT = 196, PDF_CONTENT_W = 182;

const PDF_C = {
    primary: [15, 106, 113],
    primaryDark: [9, 66, 71],
    text: [37, 52, 63],
    muted: [110, 124, 127],
    mutedLight: [156, 168, 170],
    border: [223, 231, 232],
    green: [22, 124, 73],
    greenBg: [231, 247, 238],
    greenBorder: [178, 224, 199],
    red: [176, 44, 36],
    redBg: [253, 235, 233],
    redBorder: [242, 190, 184],
    tableAlt: [246, 249, 249],
    watermark: [124, 139, 141], // #7C8B8D; actual fade comes from GState opacity, not this color


    blue: [139, 181, 235],
    orange: [247, 190, 110],

    // Energy-mix donut palette — matches the on-page donut exactly
    // (CSS var(--success) #2F9E6E, #ef4444, #2f80ed), not the muted
    // blue/orange pair above used elsewhere in this report.
    donutGreen: [47, 158, 110],
    donutRed: [239, 68, 68],
    donutBlue: [47, 128, 237],

    // Battery storage scenario — same purple reserved for battery
    // charge/discharge on the web chart (rgba(139,92,246,*)).
    purple: [139, 92, 246],
    purpleBg: [238, 233, 254],
    purpleBorder: [214, 201, 250]
};

const ID_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const FACILITY_LABEL_ID = {
    "Restaurant": "Restoran", "Office": "Kantor", "Mall / Retail": "Pusat Perbelanjaan/Ritel",
    "Hospital": "Rumah Sakit", "24/7 Factory": "Pabrik (Operasi 24/7)", "1-Shift Factory": "Pabrik (1 Shift)",
    "Residential Complex": "Kompleks Perumahan", "Street Lighting": "Penerangan Jalan Umum", "Other Facility": "Fasilitas"
};

function pdfFmtTanggalID(date) {
    return `${date.getDate()} ${ID_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
function pdfAddDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
function pdfFmtRupiahDash(n) {
    return "Rp" + Math.round(n || 0).toLocaleString("id-ID") + ",-";
}
function pdfFmtInt(n) {
    return Math.round(n || 0).toLocaleString("id-ID");
}
function pdfFmtCompactRp(v) {
    const abs = Math.abs(v || 0);
    if (abs >= 1e9) return `Rp${(v / 1e9).toFixed(1)}M`;
    if (abs >= 1e6) return `Rp${Math.round(v / 1e6)}Jt`;
    if (abs >= 1e3) return `Rp${Math.round(v / 1e3)}Rb`;
    return `Rp${Math.round(v)}`;
}

// Indonesian number-to-words ("terbilang"), used for the offer price.
function pdfAngkaTerbilang(num) {
    const satuan = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
    function eja(n) {
        n = Math.floor(n);
        if (n < 12) return satuan[n];
        if (n < 20) return `${eja(n - 10)} belas`;
        if (n < 100) return `${eja(Math.floor(n / 10))} puluh${n % 10 ? " " + eja(n % 10) : ""}`;
        if (n < 200) return `seratus${n % 100 ? " " + eja(n % 100) : ""}`;
        if (n < 1000) return `${eja(Math.floor(n / 100))} ratus${n % 100 ? " " + eja(n % 100) : ""}`;
        if (n < 2000) return `seribu${n % 1000 ? " " + eja(n % 1000) : ""}`;
        if (n < 1000000) return `${eja(Math.floor(n / 1000))} ribu${n % 1000 ? " " + eja(n % 1000) : ""}`;
        if (n < 1000000000) return `${eja(Math.floor(n / 1000000))} juta${n % 1000000 ? " " + eja(n % 1000000) : ""}`;
        if (n < 1000000000000) return `${eja(Math.floor(n / 1000000000))} miliar${n % 1000000000 ? " " + eja(n % 1000000000) : ""}`;
        return `${eja(Math.floor(n / 1000000000000))} triliun${n % 1000000000000 ? " " + eja(n % 1000000000000) : ""}`;
    }
    const n = Math.round(num || 0);
    if (n === 0) return "Nol";
    const words = eja(n).trim().replace(/\s+/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}
function pdfTerbilangRupiah(n) {
    return `${pdfAngkaTerbilang(n)} Rupiah`;
}

// Reads the lead's own unlock-form answers (name/type/phone/address)
// captured by initEmailGate() above, so the letter is addressed to the
// actual person who unlocked the report — not a placeholder.
function pdfGetLeadInfo() {
    let info = {};
    try { info = JSON.parse(sessionStorage.getItem("edash-solar-lead-info") || "{}"); } catch (err) { info = {}; }
    return {
        name: info.name || "Pelanggan 360energy",
        leadType: info.leadType || "personal",
        email: info.email || sessionStorage.getItem("edash-solar-lead-email") || "-",
        phone: info.phone || "-",
        address: info.address || "-"
    };
}
function pdfLeadSalutation(lead) {
    if (lead.leadType === "company") return `Yth. Pimpinan ${lead.name}`;
    if (lead.leadType === "government") return `Yth. ${lead.name}`;
    return `Yth. Bapak/Ibu ${lead.name}`;
}

// --- Low-level drawing helpers -----------------------------------------

// Translucent centered 360energy logo watermark (falls back to the old
// text wordmark if the logo image hasn't finished preloading — see
// preloadPdfLogo()). opacity is 0-1 (default 0.2, i.e. 20%). Only drawn
// on page 1 (the offer letter); pages 2-8 stay clean since they're the
// client-facing calculation report. Uses jsPDF's GState for true alpha
// transparency, falling back to a light solid color on older builds
// without GState.
function pdfWatermark(doc, opacity = 0.2) {
    const hasGState = typeof doc.GState === "function" && typeof doc.setGState === "function";
    if (hasGState) {
        doc.saveGraphicsState();
        doc.setGState(new doc.GState({ opacity }));
    }
    if (PDF_LOGO_DATA_URL) {
        const w = 150;
        const h = w / PDF_LOGO_ASPECT;
        doc.addImage(PDF_LOGO_DATA_URL, "PNG", PDF_PAGE_W / 2 - w / 2, PDF_PAGE_H / 2 - h / 2, w, h, undefined, "FAST");
    } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(80);
        doc.setTextColor(...PDF_C.watermark);
        doc.text("360energy", PDF_PAGE_W / 2, PDF_PAGE_H / 2 + 10, { angle: 35, align: "center" });
    }
    if (hasGState) {
        doc.restoreGraphicsState();
    }
}

// Small "360energy" wordmark in the header — drawn immediately when a
// content page starts (position is fixed, independent of flowed content).
function pdfPageLogo(doc) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_C.primary);
    doc.text("360energy", PDF_MARGIN, 11);
}

// "Halaman X dari Y" label. Total page count isn't known until every
// section has finished flowing (pages are only added when content actually
// needs them), so this is applied in a second pass over the finished
// document rather than while content is being drawn.
function pdfPageNumberLabel(doc, pageNum, totalPages) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_C.mutedLight);
    doc.text(`Halaman ${pageNum} dari ${totalPages}`, PDF_RIGHT, 11, { align: "right" });
}

function pdfPageFootnote(doc) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(6.8);
    doc.setTextColor(...PDF_C.red);
    const note = doc.splitTextToSize(
        "CATATAN: Seluruh data dan proyeksi dalam dokumen ini adalah hasil studi cepat sistem Smart Solar Planner dan bersifat estimasi. Angka final dan spesifikasi teknis bergantung pada hasil survei teknis di lokasi serta analisis detail profil konsumsi energi. Syarat dan ketentuan berlaku.",
        PDF_CONTENT_W
    );
    doc.text(note, PDF_MARGIN, 288);
}

// Lowest y a content block may end at before it needs a new page (leaves
// clearance above the footnote at y=288).
const PDF_CONTENT_BOTTOM = 281;

// Mirrors pdfNotice's own height formula so callers can check available
// space *before* drawing (pdfNotice only reports height as a side effect
// of actually drawing, which is too late to decide on a page break).
function pdfNoticeHeight(doc, w, text) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.3);
    const lines = doc.splitTextToSize(text, w - 17);
    return Math.max(11, lines.length * 4 + 5.5);
}

// Starts a fresh report content page: watermark (same translucent
// "360energy" wordmark as page 1) + header logo + the disclaimer
// footnote, all drawn immediately since their position never depends on
// how much content ends up on the page. Returns the y content should
// start at.
function pdfStartContentPage(doc) {
    doc.addPage();
    pdfWatermark(doc, 0.2);
    pdfPageLogo(doc);
    pdfPageFootnote(doc);
    return 24;
}

// Advances the flow: if `neededH` mm won't fit before PDF_CONTENT_BOTTOM,
// starts a new page and returns the reset y; otherwise returns y
// unchanged so the next block continues on the same page. This is what
// lets report sections run on continuously instead of one topic per page.
function pdfEnsureSpace(doc, y, neededH) {
    if (y + neededH > PDF_CONTENT_BOTTOM) {
        return pdfStartContentPage(doc);
    }
    return y;
}

function pdfCard(doc, x, y, w, h) {
    doc.setDrawColor(...PDF_C.border);
    doc.setLineWidth(0.3);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, h, 2.5, 2.5, "FD");
}

function pdfCardTitle(doc, x, y, w, text) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...PDF_C.text);
    doc.text(text, x, y);
    doc.setDrawColor(...PDF_C.border);
    doc.setLineWidth(0.25);
    doc.line(x, y + 2.6, x + w, y + 2.6);
}

function pdfStatBox(doc, x, y, w, h, value, label, opts = {}) {
    doc.setFillColor(...(opts.bg || [246, 249, 249]));
    doc.setDrawColor(...PDF_C.border);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, w, h, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(opts.valueSize || 15);
    doc.setTextColor(...(opts.valueColor || PDF_C.green));
    doc.text(String(value), x + w / 2, y + h / 2 - (opts.labelLines ? 2 : 0.5), { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(...PDF_C.muted);
    const labelLines = doc.splitTextToSize(label, w - 6);
    doc.text(labelLines, x + w / 2, y + h / 2 + 5, { align: "center" });
}

// Rounded notice/callout box (green info or red warning); returns the
// height actually used so the caller can advance its running y cursor.
function pdfNotice(doc, x, y, w, text, opts = {}) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.3);
    const lines = doc.splitTextToSize(text, w - 17);
    const lineH = 4;
    const h = Math.max(11, lines.length * lineH + 5.5);
    doc.setFillColor(...(opts.bg || PDF_C.greenBg));
    doc.setDrawColor(...(opts.border || PDF_C.greenBorder));
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...(opts.iconColor || PDF_C.green));
    doc.text(opts.icon || "i", x + 5, y + h / 2 + 1.05, { align: "center" });
    doc.circle(x + 5, y + h / 2, 3, "S");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.3);
    doc.setTextColor(...(opts.textColor || PDF_C.text));
    doc.text(lines, x + 11, y + 5.2);
    return h;
}

function pdfLegendItem(doc, x, y, color, label) {
    doc.setFillColor(...color);
    doc.rect(x, y - 2.6, 3.2, 3.2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.3);
    doc.setTextColor(...PDF_C.text);
    doc.text(label, x + 5, y);
}

// Two-row horizontal bar comparison (mirrors the web's small bar-chart
// widget used for e.g. "Year 1 vs. Average Annual Savings"). items:
// [{ label, value, display, color }, ...]. Returns the height used.
function pdfHBarCompare(doc, x, y, w, items) {
    const rowH = 8, gap = 6, labelW = w * 0.34, valueW = w * 0.28;
    const trackX = x + labelW, trackW = Math.max(10, w - labelW - valueW);
    const maxVal = Math.max(1, ...items.map((it) => it.value || 0));
    let cy = y;
    items.forEach((it) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...PDF_C.text);
        doc.text(it.label, x, cy + rowH / 2 + 1);
        doc.setFillColor(...PDF_C.border);
        doc.roundedRect(trackX, cy, trackW, rowH, 1.5, 1.5, "F");
        const barW = Math.max(2, (Math.max(0, it.value || 0) / maxVal) * trackW);
        doc.setFillColor(...it.color);
        doc.roundedRect(trackX, cy, barW, rowH, 1.5, 1.5, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.4);
        doc.setTextColor(...PDF_C.text);
        doc.text(it.display, trackX + trackW + 4, cy + rowH / 2 + 1);
        cy += rowH + gap;
    });
    return cy - y - gap;
}

// label: value line where the label is muted/normal and the value is
// bold + colored, laid out inline (used in the "Desain Sistem PLTS" grid).
function pdfKvLine(doc, x, y, label, value, valueColor) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(...PDF_C.muted);
    const prefix = `${label}: `;
    doc.text(prefix, x, y);
    const pw = doc.getTextWidth(prefix);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...(valueColor || PDF_C.text));
    doc.text(String(value), x + pw, y);
}

function pdfTable(doc, { x, y, colWidths, headers, rows, rowH = 6.5, align = [], fontSize = 8 }) {
    const totalW = colWidths.reduce((a, b) => a + b, 0);
    let cy = y;
    doc.setFillColor(...PDF_C.primary);
    doc.rect(x, cy, totalW, rowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fontSize);
    doc.setTextColor(255, 255, 255);
    let cx = x;
    headers.forEach((h, i) => {
        const a = align[i] || "left";
        const tx = a === "right" ? cx + colWidths[i] - 2.5 : a === "center" ? cx + colWidths[i] / 2 : cx + 2.5;
        doc.text(String(h), tx, cy + rowH / 2 + 1.2, { align: a });
        cx += colWidths[i];
    });
    cy += rowH;
    doc.setFont("helvetica", "normal");
    rows.forEach((row, ri) => {
        if (ri % 2 === 1) {
            doc.setFillColor(...PDF_C.tableAlt);
            doc.rect(x, cy, totalW, rowH, "F");
        }
        doc.setTextColor(...PDF_C.text);
        cx = x;
        row.forEach((cell, ci) => {
            const a = align[ci] || "left";
            const tx = a === "right" ? cx + colWidths[ci] - 2.5 : a === "center" ? cx + colWidths[ci] / 2 : cx + 2.5;
            doc.text(String(cell), tx, cy + rowH / 2 + 1.2, { align: a });
            cx += colWidths[ci];
        });
        cy += rowH;
    });
    doc.setDrawColor(...PDF_C.border);
    doc.setLineWidth(0.2);
    doc.rect(x, y, totalW, cy - y, "S");
    return cy;
}

// Like pdfTable, but splits the row set across pages when it doesn't fit
// in what's left of the current page — drawing as many rows as fit, then
// starting a fresh content page (new watermark/logo/footnote) and
// continuing with the header repeated, rather than pushing the entire
// table onto a new page and leaving a gap behind it. Returns the final y.
function pdfTableFlow(doc, { x, y, colWidths, headers, rows, rowH = 6.5, align = [], fontSize = 8 }) {
    let remaining = rows.slice();
    let cy = y;
    while (true) {
        const availableRows = Math.floor((PDF_CONTENT_BOTTOM - cy - rowH) / rowH);
        if (availableRows < 1) {
            cy = pdfStartContentPage(doc);
            continue;
        }
        const chunk = remaining.slice(0, availableRows);
        cy = pdfTable(doc, { x, y: cy, colWidths, headers, rows: chunk, rowH, align, fontSize });
        remaining = remaining.slice(availableRows);
        if (remaining.length === 0) break;
        cy = pdfStartContentPage(doc);
    }
    return cy;
}

// Annual PLN-only vs. PLTS 360energy (Beli Putus) bill comparison —
// grouped bar chart, mirroring the web's CURRENT buildAnnualBillsChartSvg
// design: plain (non-legend-box) bars in the blue/orange brand pair, a
// per-bar compact value label, a green "Hemat Xjt" callout per group
// (translated from the web's "Save Xjt"), and dashed gridlines — replacing
// this report's older orange/teal + separate-legend-box style.
const PDF_C_BILLS_PLN = [47, 128, 237];   // #2f80ed — matches .calc-chart-dot--consumption
const PDF_C_BILLS_SOLAR = [231, 138, 18]; // #e78a12 — matches .calc-chart-dot--solar

function pdfBillsBarChart(doc, x, y, w, h, plnSeries, dpSeries) {
    const padL = 16, padB = 8, padT = 10, padR = 2;
    const plotX = x + padL, plotY = y + padT;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const years = plnSeries.length;
    if (!years) return;
    const maxCost = Math.max(1, ...plnSeries.map((d) => d.cost)) * 1.3;

    doc.setDrawColor(...PDF_C.border);
    doc.setLineWidth(0.15);
    doc.setLineDashPattern([0.8, 1], 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    doc.setTextColor(...PDF_C.muted);
    for (let i = 0; i <= 4; i++) {
        const v = (maxCost / 4) * i;
        const ty = plotY + plotH - (v / maxCost) * plotH;
        doc.line(plotX, ty, plotX + plotW, ty);
        doc.text(pdfFmtCompactRp(v), plotX - 2, ty + 1, { align: "right" });
    }
    doc.setLineDashPattern([], 0);

    // Sample a handful of evenly-spaced years (always Year 1 + final year),
    // same logic as the web chart, so bars stay readable instead of
    // cramming all 20 years into a print-width chart.
    const groupCount = Math.max(2, Math.min(years, 7));
    const idxSet = new Set();
    for (let i = 0; i < groupCount; i++) {
        idxSet.add(Math.round((i / (groupCount - 1)) * (years - 1)));
    }
    const idxs = Array.from(idxSet).sort((a, b) => a - b);

    const groupN = idxs.length;
    const groupGap = Math.max(2, plotW * 0.03);
    const groupW = (plotW - groupGap * (groupN - 1)) / groupN;
    const barGap = Math.max(0.8, groupW * 0.12);
    const barW = Math.max(1.2, (groupW - barGap) / 2);
    const yZero = plotY + plotH;

    const bar = (barX, cost, color) => {
        const barY = plotY + plotH - (Math.min(cost, maxCost) / maxCost) * plotH;
        const barH = Math.max(0, yZero - barY);
        doc.setFillColor(...color);
        doc.roundedRect(barX, barY, barW, barH, 0.6, 0.6, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(5.6);
        doc.setTextColor(...PDF_C.text);
        doc.text(pdfFmtCompactRp(cost), barX + barW / 2, barY - 1.4, { align: "center" });
    };

    idxs.forEach((idx, gi) => {
        const groupX = plotX + gi * (groupW + groupGap);
        const groupCenter = groupX + groupW / 2;
        const plnCost = plnSeries[idx].cost;
        const dpCost = dpSeries[idx] ? dpSeries[idx].cost : 0;

        bar(groupX, plnCost, PDF_C_BILLS_PLN);
        bar(groupX + barW + barGap, dpCost, PDF_C_BILLS_SOLAR);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(6);
        doc.setTextColor(...PDF_C.green);
        const saveY = plotY + plotH - (Math.min(Math.max(plnCost, dpCost), maxCost) / maxCost) * plotH - 6.5;
        doc.text(`Hemat ${pdfFmtCompactRp(Math.max(0, plnCost - dpCost))}`, groupCenter, Math.max(plotY - 1, saveY), { align: "center" });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.3);
        doc.setTextColor(...PDF_C.muted);
        doc.text(`Tahun ${idx + 1}`, groupCenter, plotY + plotH + 4, { align: "center" });
    });

    doc.setDrawColor(...PDF_C.mutedLight);
    doc.setLineWidth(0.2);
    doc.line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);
}

// Daily energy-mix donut chart (Solar Consumed/Used, Grid Import,
// Excess/Remaining Surplus) — mirrors the on-page "Estimated Energy
// Performance (Year 1)" donut (buildDonutChartSvg / renderEnergyMixDonut)
// field-for-field, including its 3-slice model and success/red/blue
// palette. Drawn as a pie of small triangular wedges (jsPDF has no native
// arc primitive) with a white circle punched in the middle for the ring,
// since jsPDF can't do CSS stroke-dasharray like the web SVG version.
function pdfDonutChart(doc, cx, cy, outerR, innerR, slices) {
    const total = Math.max(0, slices.reduce((sum, s) => sum + Math.max(0, s.value || 0), 0));
    if (total <= 0) {
        doc.setDrawColor(...PDF_C.border);
        doc.setLineWidth(0.4);
        doc.circle(cx, cy, outerR, "S");
    } else {
        // Starts at 12 o'clock and sweeps clockwise, matching the web
        // donut's rotate(-90) + stroke-dashoffset approach.
        let angle = -Math.PI / 2;
        slices.forEach((s) => {
            const value = Math.max(0, s.value || 0);
            if (value <= 0) return;
            const sweep = (value / total) * Math.PI * 2;
            const steps = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * 120));
            const pts = [];
            for (let i = 0; i <= steps; i++) {
                const a = angle + (sweep * i) / steps;
                pts.push([cx + outerR * Math.cos(a), cy + outerR * Math.sin(a)]);
            }
            // Polygon path: center -> along the outer arc -> back to
            // center (closed=true), filled as one pie wedge per slice.
            const segs = [[pts[0][0] - cx, pts[0][1] - cy]];
            for (let i = 1; i < pts.length; i++) {
                segs.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
            }
            doc.setFillColor(...s.color);
            doc.lines(segs, cx, cy, [1, 1], "F", true);
            angle += sweep;
        });
    }
    // Punch the donut hole + center label (total kWh/day, same as the
    // web version's center text).
    doc.setFillColor(255, 255, 255);
    doc.circle(cx, cy, innerR, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_C.text);
    doc.text(total > 0 ? pdfFmtInt(total) : "--", cx, cy, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.6);
    doc.setTextColor(...PDF_C.muted);
    doc.text("kWh/hari", cx, cy + 4.2, { align: "center" });
}

// One legend row for the donut: colored dot + label (bold) + value/share
// (muted, below) — matches the web legend's dot/label/value layout
// (renderEnergyMixDonut's <div class="calc-donut-legend__item">).
function pdfDonutLegendRow(doc, x, y, color, label, value, pct) {
    doc.setFillColor(...color);
    doc.roundedRect(x, y - 2.8, 3.4, 3.4, 0.7, 0.7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.6);
    doc.setTextColor(...PDF_C.text);
    doc.text(label, x + 5.5, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...PDF_C.muted);
    doc.text(`${formatNumber(value)} kWh (${formatNumber(pct)}%)`, x + 5.5, y + 4);
}

// Battery storage scenario — hourly stacked bars showing how consumption
// is met (direct solar / battery discharge / grid import), so the printed
// report reflects the same "battery reduces grid import" story as the
// on-page battery scenario chart. Uses getBatteryScenario's `points`
// (each point already carries batteryDeliveredKw for that interval).
// Line/area version of the battery chart, redrawn to match the on-page
// "Estimated Daily Production vs. Consumption" chart (buildProductionChartSvg)
// pixel-for-pixel in spirit: a smooth Gaussian solar-production curve, a
// stepped blue consumption line, a green "Solar Used" fill, a hatched
// purple "Stored in Battery" band and a solid light-purple "Battery
// Discharged" band. Replaces the previous stacked-bar rendering, which
// only sampled 25 hourly points and therefore looked blocky/faceted next
// to the smooth curve shown on the web page.
function pdfBatteryChart(doc, x, y, w, h, batteryPoints) {
    const padL = 15, padB = 8, padT = 3, padR = 2;
    const plotX = x + padL, plotY = y + padT;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    if (!batteryPoints || !batteryPoints.length) return;

    // Full simulation resolution (same points the web SVG chart draws),
    // not a 25-point hourly downsample - this is what actually produces
    // the smooth, rounded bell curve instead of straight faceted segments.
    const points = batteryPoints;
    const maxData = Math.max(1, ...points.map((p) => Math.max(p.consumption || 0, p.solarProduction || 0)));
    const maxVal = niceChartMax(maxData * 1.08);

    const px = (t) => plotX + (t / 24) * plotW;
    const py = (v) => plotY + plotH - (Math.max(0, v) / maxVal) * plotH;

    const hasGState = typeof doc.GState === "function" && typeof doc.setGState === "function";
    const setOpacity = (o) => { if (hasGState) doc.setGState(new doc.GState({ opacity: o })); };

    // --- Gridlines + axis labels (same 5 horizontal / 4-hourly vertical
    // layout as the web chart's gridlines) ---
    doc.setDrawColor(...PDF_C.border);
    doc.setLineWidth(0.15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.3);
    doc.setTextColor(...PDF_C.muted);
    for (let i = 0; i <= 5; i++) {
        const v = (maxVal / 5) * i;
        const ty = py(v);
        doc.line(plotX, ty, plotX + plotW, ty);
        doc.text(pdfFmtInt(v), plotX - 2, ty + 1, { align: "right" });
    }
    for (let hh = 0; hh <= 24; hh += 4) {
        const tx = px(hh);
        doc.line(tx, plotY, tx, plotY + plotH);
        doc.text(hh === 24 ? "24:00" : `${String(hh).padStart(2, "0")}:00`, tx, plotY + plotH + 4, { align: "center" });
    }

    // --- Path builders (mirror areaPathForKey / buildStepBandPath / linePath) ---
    const areaPolygon = (fn) => {
        const top = points.map((p) => [px(p.t), py(Math.max(0, fn(p)))]);
        return top.concat([
            [px(points[points.length - 1].t), py(0)],
            [px(points[0].t), py(0)]
        ]);
    };
    const bandPolygon = (topFn, bottomFn) => {
        const top = points.map((p) => [px(p.t), py(Math.max(0, topFn(p)))]);
        const bottom = points.map((p) => [px(p.t), py(Math.max(0, bottomFn(p)))]).reverse();
        return top.concat(bottom);
    };
    const linePoints = (key) => points.map((p) => [px(p.t), py(p[key] || 0)]);

    const fillPolygon = (poly, color, opacity) => {
        if (poly.length < 3) return;
        doc.saveGraphicsState();
        setOpacity(opacity);
        doc.setFillColor(...color);
        const rel = [];
        for (let i = 1; i < poly.length; i++) rel.push([poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]]);
        doc.lines(rel, poly[0][0], poly[0][1], [1, 1], "F", true);
        doc.restoreGraphicsState();
    };
    const strokePolyline = (poly, color, lineWidth) => {
        if (poly.length < 2) return;
        doc.setDrawColor(...color);
        doc.setLineWidth(lineWidth);
        doc.setLineJoin("round");
        doc.setLineCap("round");
        const rel = [];
        for (let i = 1; i < poly.length; i++) rel.push([poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]]);
        doc.lines(rel, poly[0][0], poly[0][1], [1, 1], "S", false);
    };
    // Diagonal hatch, clipped to a polygon - visually matches the web
    // chart's 45deg <pattern id="batteryHatch"> used for "Stored in Battery".
    const hatchPolygon = (poly, color) => {
        if (poly.length < 3) return;
        doc.saveGraphicsState();
        doc.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) doc.lineTo(poly[i][0], poly[i][1]);
        doc.close();
        doc.clip();
        doc.discardPath();
        setOpacity(0.13);
        doc.setFillColor(...color);
        doc.rect(plotX, plotY, plotW, plotH, "F");
        setOpacity(0.4);
        doc.setDrawColor(...color);
        doc.setLineWidth(0.35);
        const step = 3.1, diag = plotW + plotH;
        for (let d = -plotH; d <= diag; d += step) {
            doc.line(plotX + d, plotY + plotH, plotX + d + plotH, plotY);
        }
        doc.restoreGraphicsState();
    };

    const CONSUMPTION_RGB = [47, 128, 237];  // #2f80ed
    const SOLAR_RGB = [231, 138, 18];        // #e78a12
    const GREEN_RGB = [16, 185, 129];
    const PURPLE_RGB = [139, 92, 246];

    // Solar Used (green fill), then battery bands, then the two lines on top -
    // same draw order as buildProductionChartSvg.
    fillPolygon(areaPolygon((p) => Math.min(Math.max(0, p.consumption || 0), Math.max(0, p.directSelfConsumed != null ? p.directSelfConsumed : p.solarProduction || 0))), GREEN_RGB, 0.20);
    hatchPolygon(bandPolygon(
        (p) => Math.min(Math.max(0, p.solarProduction || 0), Math.max(0, p.directSelfConsumed || 0) + Math.max(0, p.batteryChargeKw || 0)),
        (p) => Math.min(Math.max(0, p.solarProduction || 0), Math.max(0, p.directSelfConsumed || 0))
    ), PURPLE_RGB);
    fillPolygon(bandPolygon(
        (p) => Math.max(0, p.consumption || 0),
        (p) => Math.max(0, Math.max(0, p.consumption || 0) - Math.min(Math.max(0, p.batteryDeliveredKw || 0), Math.max(0, p.consumption || 0)))
    ), PURPLE_RGB, 0.18);

    strokePolyline(linePoints("consumption"), CONSUMPTION_RGB, 0.55);
    strokePolyline(linePoints("solarProduction"), SOLAR_RGB, 0.55);

    doc.setDrawColor(...PDF_C.mutedLight);
    doc.setLineWidth(0.2);
    doc.line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);
}

// =========================================================================
// Main entry point
// =========================================================================

function generatePdf(r) {

    if (!window.jspdf || !window.jspdf.jsPDF) {
        console.error("jsPDF not loaded");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const lead = pdfGetLeadInfo();
    const today = new Date();
    const validUntil = pdfAddDays(today, 5);
    const facilityId = FACILITY_LABEL_ID[r.facilityLabel] || r.facilityLabel;

    // ---------------------------------------------------------------
    // PAGE 1 — Offer letter ("Surat Penawaran"), matching the official
    // 360energy quotation letterhead. Carries the translucent "360energy"
    // watermark (drawn first so the letter text sits on top of it).
    // ---------------------------------------------------------------
    pdfWatermark(doc, 0.2);

    let y = 20;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...PDF_C.primary);
    doc.text("PT PIONIR ENERGI HIJAU (360ENERGY)", PDF_MARGIN, y);

    y += 5.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_C.muted);
    doc.text("Telp: (021) 502128888     e-mail: admin@360energy.io", PDF_MARGIN, y);
    doc.setTextColor(...PDF_C.text);
    doc.text(`Jakarta, ${pdfFmtTanggalID(today)}`, PDF_RIGHT, 20, { align: "right" });

    y += 6;
    doc.setDrawColor(...PDF_C.border);
    doc.setLineWidth(0.3);
    doc.line(PDF_MARGIN, y, PDF_RIGHT, y);

    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...PDF_C.text);
    const perihalLines = doc.splitTextToSize(
        `Perihal: Penawaran Sistem Pembangkit Listrik Tenaga Surya (PLTS) On-Grid ${formatNumber(r.systemSizeKwp)} kWp`,
        PDF_CONTENT_W
    );
    doc.text(perihalLines, PDF_MARGIN, y);
    y += perihalLines.length * 5 + 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text("Kepada", PDF_MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.text(pdfLeadSalutation(lead), PDF_MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const addressLines = doc.splitTextToSize(lead.address, PDF_CONTENT_W);
    doc.text(addressLines, PDF_MARGIN, y);
    y += addressLines.length * 4.6;
    doc.text(`Telp: ${lead.phone}`, PDF_MARGIN, y);
    y += 8;

    doc.text("Dengan hormat,", PDF_MARGIN, y);
    y += 5.5;
    const introText = `Sehubungan dengan rencana pemasangan sistem energi terbarukan untuk efisiensi biaya listrik pada ${facilityId.toLowerCase()} di ${r.locationLabel}, bersama ini kami dari PT Pionir Energi Hijau (360energy) menyampaikan penawaran untuk Pembangkit Listrik Tenaga Surya (PLTS) Atap dengan sistem On-Grid berkapasitas ${formatNumber(r.systemSizeKwp)} kWp dengan harga penawaran sebesar:`;
    const introLines = doc.splitTextToSize(introText, PDF_CONTENT_W);
    doc.text(introText, PDF_MARGIN, y, { maxWidth: PDF_CONTENT_W, align: "justify" });
    y += introLines.length * 4.6 + 5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...PDF_C.primary);
    doc.text(pdfFmtRupiahDash(r.directPurchaseInvestment), PDF_PAGE_W / 2, y, { align: "center" });
    y += 6;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.8);
    doc.setTextColor(...PDF_C.muted);
    const terbilangLines = doc.splitTextToSize(`(${pdfTerbilangRupiah(r.directPurchaseInvestment)})`, 170);
    terbilangLines.forEach((line) => { doc.text(line, PDF_PAGE_W / 2, y, { align: "center" }); y += 4.2; });
    y += 4;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_C.text);
    const boqText = "Rincian teknis dan material untuk sistem tersebut terlampir dalam Bill of Quantity (BOQ) bersama surat ini.";
    const boqLines = doc.splitTextToSize(boqText, PDF_CONTENT_W);
    doc.text(boqText, PDF_MARGIN, y, { maxWidth: PDF_CONTENT_W, align: "justify" });
    y += boqLines.length * 4.6 + 5;

    doc.setFont("helvetica", "bold");
    doc.text("Kondisi Penawaran:", PDF_MARGIN, y);
    y += 5.5;

    const conditions = [
        "Harga belum termasuk PPN 11%.",
        "Syarat pembayaran: Down Payment (DP) 50% pada saat PO, pelunasan 50% sebelum material dikirim.",
        "Estimasi waktu instalasi: 14-21 hari kerja setelah DP diterima.",
        "Garansi Produk: Panel Surya 12 Tahun, Inverter 5 Tahun.",
        "Garansi Instalasi: 1 Tahun.",
        `Penawaran berlaku selama 5 hari, hingga ${pdfFmtTanggalID(validUntil)}.`
    ];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.3);
    conditions.forEach((cond, i) => {
        const lines = doc.splitTextToSize(`${i + 1}. ${cond}`, PDF_CONTENT_W - 4);
        doc.text(lines, PDF_MARGIN + 2, y);
        y += lines.length * 4.4 + 0.8;
    });

    y += 3;
    const closingText = "Demikian penawaran ini kami sampaikan. Besar harapan kami untuk dapat bekerjasama dalam penyediaan sistem PLTS yang andal dan efisien bagi perusahaan Bapak/Ibu. Atas perhatian dan kerjasamanya kami ucapkan terima kasih.";
    const closingLines = doc.splitTextToSize(closingText, PDF_CONTENT_W);
    doc.text(closingText, PDF_MARGIN, y, { maxWidth: PDF_CONTENT_W, align: "justify" });
    y += closingLines.length * 4.6 + 8;

    doc.text("Hormat kami,", PDF_MARGIN, y);
    y += 18;
    doc.setFont("helvetica", "bold");
    doc.text("PT PIONIR ENERGI HIJAU (360ENERGY)", PDF_MARGIN, y);

    // ---------------------------------------------------------------
    // PAGES 2+ — Client-facing calculation report. Content flows
    // continuously (pdfEnsureSpace only breaks to a new page when a
    // block would otherwise run past the footer), so sections share a
    // page whenever they fit instead of a fixed one-topic-per-page
    // layout. Every page below carries the same translucent "360energy"
    // watermark as page 1 (drawn by pdfStartContentPage/pdfEnsureSpace).
    //   Ringkasan: system size/coverage, 20yr PLN-vs-solar pitch,
    //              annual bill comparison chart
    //   Finansial: PLN vs. Solar Leasing tariff, ZeroCapEx Solar
    //              Leasing (BOT) bill compare + savings chart + stat cards
    //   Teknis: energy-mix chart, consumption / PV system / energy
    //           performance figures ("Desain Sistem PLTS")
    //   Finansial: Direct Purchase (Beli Putus) investment, payback,
    //              lifetime savings, bill compare
    //   Bill of Quantities (BOQ)
    //   Direct Purchase 20-year year-by-year projection table
    //   Environmental Impact & CSR Equivalency (4 cards, matches
    //   the Ringkasan tab's CSR grid exactly)
    //   Year-by-year emissions reduction table (supplementary detail)
    // ---------------------------------------------------------------
    y = pdfStartContentPage(doc);

    // --- Ringkasan Sistem PLTS Anda -----------------------------------
    pdfCardTitle(doc, PDF_MARGIN, y, PDF_CONTENT_W, "Ringkasan Sistem PLTS Anda");
    y += 6;
    const half = (PDF_CONTENT_W - 4) / 2;
    pdfStatBox(doc, PDF_MARGIN, y, half, 22, `${formatNumber(r.systemSizeKwp)} kWp`, "Ukuran sistem PLTS", { valueColor: PDF_C.green });
    pdfStatBox(doc, PDF_MARGIN + half + 4, y, half, 22, `${formatNumber(r.coveragePct)}%`, "Penggunaan energi yang dicakup oleh PLTS", { valueColor: PDF_C.green });
    y += 28;

    const schemeText = `Untuk ${facilityId} di ${r.locationLabel} dengan kapasitas daya PLN terpasang ${formatNumber(r.kva)} kVA dan tagihan listrik bulanan ${formatRupiah(r.monthlyBill)}, Anda memiliki opsi skema pendanaan PLTS berikut: Beli Putus dan ZeroCapEx Solar Leasing (BOT).`;
    y = pdfEnsureSpace(doc, y, pdfNoticeHeight(doc, PDF_CONTENT_W, schemeText) + 5);
    y += pdfNotice(doc, PDF_MARGIN, y, PDF_CONTENT_W, schemeText, { bg: PDF_C.greenBg, border: PDF_C.greenBorder, iconColor: PDF_C.green, icon: "i" });
    y += 5;

    // --- "Staying on PLN vs. Going Solar — 20-Year Outlook" sales pitch,
    // same figures as the on-page summary tab pitch card.
    const total20yConventional = (r.annualBillsPln || []).reduce((sum, row) => sum + row.cost, 0);
    const total20yWithSolar = (r.annualBillsDp || []).reduce((sum, row) => sum + row.cost, 0);
    const total20ySavings = Math.max(0, total20yConventional - total20yWithSolar);
    const total20ySavingsPct = total20yConventional > 0 ? (total20ySavings / total20yConventional) * 100 : 0;

    const pitchH = 40;
    y = pdfEnsureSpace(doc, y, pitchH + 4 + 9.2 + 7);
    pdfCard(doc, PDF_MARGIN, y, PDF_CONTENT_W, pitchH);
    pdfCardTitle(doc, PDF_MARGIN + 4, y + 7, PDF_CONTENT_W - 8, "Bertahan di PLN vs. Beralih ke Surya — Proyeksi 20 Tahun");
    const thirdP = (PDF_CONTENT_W - 8 - 4) / 2;
    pdfStatBox(doc, PDF_MARGIN + 4, y + 11, thirdP, 24, formatRupiah(total20yConventional), "100% PLN Konvensional", { valueColor: PDF_C.red, bg: PDF_C.redBg, valueSize: 11 });
    pdfStatBox(doc, PDF_MARGIN + 4 + thirdP + 4, y + 11, thirdP, 24, formatRupiah(total20yWithSolar), "Dengan Solar 360energy", { valueColor: PDF_C.green, bg: PDF_C.greenBg, valueSize: 11 });
    y += pitchH + 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.setTextColor(...PDF_C.green);
    doc.text(`Hemat ${formatRupiah(total20ySavings)} (${formatNumber(total20ySavingsPct)}%) dari biaya listrik selama 20 tahun`, PDF_MARGIN, y);
    y += 4.6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_C.text);
    doc.text(`Mengurangi ${formatNumber(r.totalEmissionsReductionTon)} tCO2e — setara menanam ± ${formatNumber(Math.round(r.totalMangroveTrees))} pohon bakau`, PDF_MARGIN, y);
    y += 7;

    const chartH = 68;
    y = pdfEnsureSpace(doc, y, chartH + 12 + 5);
    pdfCard(doc, PDF_MARGIN, y, PDF_CONTENT_W, chartH + 12);
    pdfCardTitle(doc, PDF_MARGIN + 4, y + 7, PDF_CONTENT_W - 8, "Perbandingan Tagihan Listrik Tahunan");
    pdfLegendItem(doc, PDF_MARGIN + 4, y + 13.5, PDF_C_BILLS_PLN, "PLN");
    pdfLegendItem(doc, PDF_MARGIN + 30, y + 13.5, PDF_C_BILLS_SOLAR, "PLTS 360energy");
    pdfBillsBarChart(doc, PDF_MARGIN + 4, y + 17, PDF_CONTENT_W - 8, chartH - 12, r.annualBillsPln, r.annualBillsDp);
    y += chartH + 12 + 5;

    const validityText = `Penawaran berlaku hingga ${pdfFmtTanggalID(validUntil)}. Harap diperhatikan bahwa penawaran ini bersifat awal dan rinciannya dapat berubah.`;
    y = pdfEnsureSpace(doc, y, pdfNoticeHeight(doc, PDF_CONTENT_W, validityText));
    y += pdfNotice(doc, PDF_MARGIN, y, PDF_CONTENT_W, validityText,
        { bg: PDF_C.redBg, border: PDF_C.redBorder, iconColor: PDF_C.red, textColor: PDF_C.text, icon: "!" });
    y += 8;

    // --- Finansial: Tarif & ZeroCapEx Solar Leasing (BOT) -------------
    y = pdfEnsureSpace(doc, y, 8 + 20);
    pdfCardTitle(doc, PDF_MARGIN, y, PDF_CONTENT_W, "Finansial: Tarif & ZeroCapEx Solar Leasing (BOT)");
    y += 8;

    const halfT = (PDF_CONTENT_W - 4) / 2;
    pdfStatBox(doc, PDF_MARGIN, y, halfT, 20, `Rp ${formatNumber(r.tariff)}/kWh`, "Tarif PLN", { valueColor: PDF_C.text, valueSize: 12.5 });
    pdfStatBox(doc, PDF_MARGIN + halfT + 4, y, halfT, 20, `Rp ${formatNumber(r.solarLeasingTariff)}/kWh`, "Tarif Solar Leasing (BOT)", { valueColor: PDF_C.green, bg: PDF_C.greenBg, valueSize: 12.5 });
    y += 26;

    y = pdfEnsureSpace(doc, y, 5 + 28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.4);
    doc.setTextColor(...PDF_C.text);
    doc.text("ZEROCAPEX SOLAR LEASING (BOT)", PDF_MARGIN, y);
    y += 5;

    const thirdBot = (PDF_CONTENT_W - 8) / 3;
    pdfStatBox(doc, PDF_MARGIN, y, thirdBot, 22, formatRupiah(r.monthlyBill), "Tagihan Bulanan (Lama)", { valueColor: PDF_C.red, bg: PDF_C.redBg, valueSize: 10.5 });
    pdfStatBox(doc, PDF_MARGIN + thirdBot + 4, y, thirdBot, 22, `${formatRupiah(r.botMonthlySavings)}/bln`, "Penghematan / Bulan", { valueColor: PDF_C.text, valueSize: 10.5 });
    pdfStatBox(doc, PDF_MARGIN + (thirdBot + 4) * 2, y, thirdBot, 22, formatRupiah(r.botNewMonthlyBill), "Tagihan Bulanan (Baru)", { valueColor: PDF_C.green, bg: PDF_C.greenBg, valueSize: 10.5 });
    y += 28;

    y = pdfEnsureSpace(doc, y, 30);
    pdfStatBox(doc, PDF_MARGIN, y, thirdBot, 22, formatRupiah(r.botY1Savings), "Penghematan Tahun 1", { valueColor: PDF_C.green, valueSize: 10.5 });
    pdfStatBox(doc, PDF_MARGIN + thirdBot + 4, y, thirdBot, 22, formatRupiah(r.totalBotSavings), "Total Penghematan Proyek (20 Tahun)", { valueColor: PDF_C.green, valueSize: 10.5 });
    pdfStatBox(doc, PDF_MARGIN + (thirdBot + 4) * 2, y, thirdBot, 22, formatRupiah(r.avgBotSavings), "Rata-rata Penghematan Tahunan", { valueColor: PDF_C.green, valueSize: 10.5 });
    y += 30;

    const botNoticeText = "Skema ZeroCapEx Solar Leasing (BOT) tidak memerlukan investasi di muka — 360energy membangun dan mengoperasikan sistem, Anda cukup membayar tarif listrik surya yang lebih rendah dari tarif PLN.";
    y = pdfEnsureSpace(doc, y, pdfNoticeHeight(doc, PDF_CONTENT_W, botNoticeText));
    y += pdfNotice(doc, PDF_MARGIN, y, PDF_CONTENT_W, botNoticeText,
        { bg: PDF_C.greenBg, border: PDF_C.greenBorder, iconColor: PDF_C.green, icon: "i" });
    y += 8;

    // --- Teknis: bauran energi (donut) + desain sistem PLTS -----------
    // Mirrors the on-page "Estimated Energy Performance (Year 1)" donut
    // exactly (renderEnergyMixDonut): same 3 slices, same battery-aware
    // label swap, same success/red/blue palette — replacing the old
    // hourly bar breakdown this report used to draw here.
    const mixBattery = batteryScenarioEnabled ? getBatteryScenario(r) : null;
    const mixSlices = [
        {
            label: batteryScenarioEnabled ? "Listrik Surya Digunakan" : "Listrik Surya Dikonsumsi",
            value: Math.max(0, mixBattery ? mixBattery.solarUsedKwh : (r.dailySolarConsumed || 0)),
            color: PDF_C.donutGreen
        },
        {
            label: "Impor Jaringan (PLN)",
            value: Math.max(0, mixBattery ? mixBattery.gridImportKwh : (r.dailyGridImport || 0)),
            color: PDF_C.donutRed
        },
        {
            label: batteryScenarioEnabled ? "Sisa Surplus Solar" : "Surplus Berlebih",
            value: Math.max(0, mixBattery ? mixBattery.remainingSurplusKwh : (r.dailyExcessSurplus || 0)),
            color: PDF_C.donutBlue
        }
    ];
    const mixTotal = mixSlices.reduce((sum, s) => sum + s.value, 0);

    const mixCardH = 58;
    y = pdfEnsureSpace(doc, y, mixCardH + 6);
    pdfCard(doc, PDF_MARGIN, y, PDF_CONTENT_W, mixCardH);
    pdfCardTitle(doc, PDF_MARGIN + 4, y + 7, PDF_CONTENT_W - 8, "Estimasi Kinerja Energi (Tahun 1)");
    const donutCx = PDF_MARGIN + 4 + 24, donutCy = y + 34;
    pdfDonutChart(doc, donutCx, donutCy, 18, 10.5, mixSlices);
    let mixLegendY = y + 20;
    mixSlices.forEach((s) => {
        const pct = mixTotal > 0 ? (s.value / mixTotal) * 100 : 0;
        pdfDonutLegendRow(doc, PDF_MARGIN + 4 + 50, mixLegendY, s.color, s.label, s.value, pct);
        mixLegendY += 11;
    });
    y += mixCardH + 6;

    const designCardH = 66;
    y = pdfEnsureSpace(doc, y, designCardH + 8);
    pdfCard(doc, PDF_MARGIN, y, PDF_CONTENT_W, designCardH);
    pdfCardTitle(doc, PDF_MARGIN + 4, y + 8, PDF_CONTENT_W - 8, "Desain Sistem PLTS");
    const colW = (PDF_CONTENT_W - 8) / 3;
    const col1X = PDF_MARGIN + 4, col2X = col1X + colW, col3X = col2X + colW;
    let ky = y + 16;
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.6); doc.setTextColor(...PDF_C.muted);
    doc.text("KONSUMSI", col1X, ky);
    doc.text("SISTEM PLTS", col2X, ky);
    doc.text("KINERJA BAURAN ENERGI", col3X, ky);
    doc.text("(TAHUN 1)", col3X, ky + 3.8);

    const col1Rows = [
        ["Beban Dasar", `${formatNumber(r.baseLoadKw)} kW`],
        ["Tambahan Beban Puncak", `${formatNumber(r.peakAddonKw)} kW`],
        ["Konsumsi Maks (PLN)", `${formatNumber(r.kva)} kVA`],
        ["Beban Persiapan / Idle", `${formatNumber(r.prepLoadDisplayKw)} / ${formatNumber(r.idleLoadDisplayKw)} kW`],
        ["Biaya Harian (Pra-PLTS)", formatRupiah(r.dailyCostPrePv)],
        ["Tagihan Bulanan (Pra-PLTS)", formatRupiah(r.monthlyBillPrePv)]
    ];
    const col2Rows = [
        ["Jumlah Panel", `${r.panelCount}`],
        ["Ukuran Sistem Total", `${formatNumber(r.systemSizeKwp)} kWp`],
        ["Total Area", `${formatNumber(r.panelAreaM2)} m²`],
        ["Daya Keluaran Maks", `${formatNumber(r.maxOutputKw)} kW`]
    ];
    const col3Rows = [
        ["Konsumsi Surya Harian", `${formatNumber(r.dailySolarConsumed)} kWh`],
        ["Impor Jaringan Harian", `${formatNumber(r.dailyGridImport)} kWh`],
        ["Surplus Berlebih Harian", `${formatNumber(r.dailyExcessSurplus)} kWh`],
        ["Produksi Harian Total", `${formatNumber(r.dailySolarProduction)} kWh`],
        ["Hasil Spesifik Harian", `${formatNumber(r.specificYield)} kWh/kWp`],
        ["Bauran Surya Harian", `${formatNumber(r.coveragePct)}%`]
    ];
    let ry1 = ky + 8.5, ry2 = ky + 8.5, ry3 = ky + 8.5;
    col1Rows.forEach(([l, v]) => { pdfKvLine(doc, col1X, ry1, l, v, PDF_C.text); ry1 += 6.8; });
    col2Rows.forEach(([l, v]) => { pdfKvLine(doc, col2X, ry2, l, v, PDF_C.text); ry2 += 6.8; });
    col3Rows.forEach(([l, v]) => { pdfKvLine(doc, col3X, ry3, l, v, PDF_C.green); ry3 += 6.8; });
    y += designCardH + 8;

    // --- Skenario Penyimpanan Baterai (opsional) ----------------------
    // Mirrors the on-page "Battery Storage Scenario" cards + chart, shown
    // only when the visitor left the battery toggle on for this estimate.
    if (batteryScenarioEnabled) {
        const battery = getBatteryScenario(r);

        y = pdfEnsureSpace(doc, y, 8 + 24);
        pdfCardTitle(doc, PDF_MARGIN, y, PDF_CONTENT_W, "Skenario Penyimpanan Baterai (Opsional)");
        y += 8;

        const fifth = (PDF_CONTENT_W - 16) / 5;
        const batteryStats = [
            [`${formatNumber(battery.excessSolarAvailableKwh)}`, "Surplus Solar Tersedia (kWh/hari)"],
            [`${formatNumber(battery.capacityKwh)}`, "Estimasi Kapasitas Baterai (kWh)"],
            [`${formatNumber(battery.energyStoredKwh)}`, "Energi Tersimpan (kWh/hari)"],
            [`${formatNumber(battery.energyDischargedKwh)}`, "Energi Dikeluarkan (kWh/hari)"],
            [`${formatNumber(battery.roundTripEfficiency * 100)}%`, "Efisiensi Round-trip Baterai"]
        ];
        batteryStats.forEach(([value, label], i) => {
            pdfStatBox(doc, PDF_MARGIN + i * (fifth + 4), y, fifth, 24, value, label, { valueColor: PDF_C.purple, bg: PDF_C.purpleBg, valueSize: 10.5, labelLines: true });
        });
        y += 30;

        const battChartH = 66;
        y = pdfEnsureSpace(doc, y, battChartH + 14 + 6);
        pdfCard(doc, PDF_MARGIN, y, PDF_CONTENT_W, battChartH + 14);
        pdfCardTitle(doc, PDF_MARGIN + 4, y + 7, PDF_CONTENT_W - 8, "Bagaimana Baterai Mengurangi Impor Jaringan");
        pdfLegendItem(doc, PDF_MARGIN + 4, y + 13.5, [110, 196, 160], "Langsung dari Surya");
        pdfLegendItem(doc, PDF_MARGIN + 52, y + 13.5, PDF_C.purple, "Dikeluarkan dari Baterai");
        pdfLegendItem(doc, PDF_MARGIN + 104, y + 13.5, PDF_C.blue, "Impor Jaringan (PLN)");
        pdfBatteryChart(doc, PDF_MARGIN + 4, y + 18, PDF_CONTENT_W - 8, battChartH - 12, battery.points);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.6);
        doc.setTextColor(...PDF_C.muted);
        doc.text("Sumber Pemenuhan Konsumsi (kW) vs. Jam dalam Sehari", PDF_MARGIN + PDF_CONTENT_W / 2, y + battChartH + 12, { align: "center" });
        y += battChartH + 14 + 6;

        const batteryNoticeText = `Skenario ini bersifat ilustratif: baterai diasumsikan berukuran ${formatNumber(battery.batterySetCount)} unit modul katalog (61,44 kWh/unit) agar dapat menampung surplus solar harian yang termodelkan, dengan asumsi efisiensi round-trip 92%. Ukuran dan spesifikasi baterai final akan disesuaikan setelah survei teknis.`;
        y = pdfEnsureSpace(doc, y, pdfNoticeHeight(doc, PDF_CONTENT_W, batteryNoticeText));
        y += pdfNotice(doc, PDF_MARGIN, y, PDF_CONTENT_W, batteryNoticeText,
            { bg: PDF_C.purpleBg, border: PDF_C.purpleBorder, iconColor: PDF_C.purple, icon: "i" });
        y += 8;
    }

    // --- Beli Putus: Ringkasan Keuangan -------------------------------
    y = pdfEnsureSpace(doc, y, 8 + 4 + 22 + 30);
    pdfCardTitle(doc, PDF_MARGIN, y, PDF_CONTENT_W, "Beli Putus: Ringkasan Keuangan");
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    doc.setTextColor(...PDF_C.muted);
    doc.text("RINGKASAN INVESTASI", PDF_MARGIN, y);
    y += 4;

    const third4 = (PDF_CONTENT_W - 8) / 3;
    pdfStatBox(doc, PDF_MARGIN, y, third4, 22, pdfFmtRupiahDash(r.directPurchaseInvestment), "Total Biaya Pembelian", { valueColor: PDF_C.green, valueSize: 11.5 });
    pdfStatBox(doc, PDF_MARGIN + third4 + 4, y, third4, 22, Number.isFinite(r.directPurchasePayback) ? `${formatNumber(r.directPurchasePayback)} tahun` : "> 20 tahun", "Estimasi Periode Balik Modal", { valueColor: PDF_C.green, valueSize: 11.5 });
    pdfStatBox(doc, PDF_MARGIN + (third4 + 4) * 2, y, third4, 22, formatRupiah(r.lifetimeSavings), "Total Penghematan 20 Tahun", { valueColor: PDF_C.green, valueSize: 11.5 });
    y += 30;

    y = pdfEnsureSpace(doc, y, 6 + 24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.4);
    doc.setTextColor(...PDF_C.text);
    doc.text("PENGURANGAN TAGIHAN LISTRIK BULANAN DENGAN BELI PUTUS", PDF_PAGE_W / 2, y, { align: "center" });
    y += 6;

    const third = (PDF_CONTENT_W - 8) / 3;
    pdfStatBox(doc, PDF_MARGIN, y, third, 24, formatRupiah(r.monthlyBill), "Tagihan Listrik Bulanan (Lama)", { valueColor: PDF_C.red, bg: PDF_C.redBg, valueSize: 11.5 });
    pdfStatBox(doc, PDF_MARGIN + third + 4, y, third, 24, formatRupiah(r.monthlySavings), "Penghematan / Bulan", { valueColor: PDF_C.text, valueSize: 11.5 });
    pdfStatBox(doc, PDF_MARGIN + (third + 4) * 2, y, third, 24, formatRupiah(r.newMonthlyBill), "Tagihan Listrik Bulanan (Baru)", { valueColor: PDF_C.green, bg: PDF_C.greenBg, valueSize: 11.5 });
    y += 32;
    // (Diskon promosi sengaja tidak ditampilkan di PDF ini.)

    // --- Bill of Quantities (BOQ) --------------------------------------
    // Uses the real catalog item name + live unit price picked by
    // computeCatalogBom() for each line when available (Katalog page has
    // priced data for it), so the exported quote matches the actual
    // system cost instead of just naming a generic category. Falls back
    // to the original generic BOQ (no pricing column) whenever catalog
    // pricing wasn't used or a category has no priced item yet.
    const catalogBoqLines = r.catalogBom?.lines?.filter((l) => l.key !== "slo") || [];
    const hasCatalogBoqPricing = catalogBoqLines.length > 0 && catalogBoqLines.some((l) => !l.missing);
    const boqUnitLabel = (l) => (l.key === "panel" || l.key === "mounting") ? "unit" : "set";

    let boqHeaders, boqColWidths, boqAlign, boqRows;
    if (hasCatalogBoqPricing) {
        boqHeaders = ["Item", "Jumlah", "Harga Satuan"];
        boqColWidths = [94, 40, 48];
        boqAlign = ["left", "center", "right"];
        boqRows = catalogBoqLines.map((l) => [
            l.missing ? l.label : (l.item?.nama || l.label),
            `${l.qty} ${boqUnitLabel(l)}`,
            l.missing ? "–" : `Rp ${Math.round(l.unitPrice).toLocaleString("id-ID")}`
        ]);
    } else {
        boqHeaders = ["Item", "Jumlah"];
        boqColWidths = [130, 52];
        boqAlign = ["left", "center"];
        boqRows = [
            ["Inverter On-Grid", "1 set"],
            ["Mounting System (Atap)", `${r.panelCount} set`],
            [`Panel Surya Mono ${PANEL_WATT_PEAK}Wp, Tier-1`, `${r.panelCount} unit`],
            ["Kabel AC", "1 set"],
            ["Kabel DC", "1 set"],
            ["Panel Distribusi Inverter (AC)", "1 set"],
            ["Panel Distribusi DC Combiner", "1 set"],
            ["Panel DC Combiner", "1 set"],
            ["Aksesoris Instalasi", "1 set"],
            ["Jasa Instalasi 360energy", "1 set"]
        ];
    }
    const boqRowH = 8;
    y = pdfEnsureSpace(doc, y, 10 + (boqRows.length + 1) * boqRowH);
    pdfCardTitle(doc, PDF_MARGIN, y, PDF_CONTENT_W, "Bill of Quantities (RAB)");
    y += 10;
    y = pdfTable(doc, {
        x: PDF_MARGIN, y, colWidths: boqColWidths, headers: boqHeaders,
        rows: boqRows, rowH: boqRowH, align: boqAlign, fontSize: 9
    });
    y += 8;

    // --- Tabel Proyeksi Keuntungan Beli Putus (20 tahun) ----------------
    const projRows = [["0", "-", "-", pdfFmtRupiahDash(-r.directPurchaseInvestment), pdfFmtRupiahDash(-r.directPurchaseInvestment)]];
    (r.yearlyRows || []).forEach((row) => {
        projRows.push([
            String(row.year), formatRupiah(row.savings), formatRupiah(row.opex),
            formatRupiah(row.ncf), formatRupiah(row.accumNcf)
        ]);
    });
    const projRowH = 6.1;
    // Only the title + a few rows need to fit before starting — the table
    // itself is allowed to split across pages via pdfTableFlow below, so
    // it never forces a mostly-empty page the way requiring its full
    // height up front would.
    y = pdfEnsureSpace(doc, y, 9 + projRowH * 3);
    pdfCardTitle(doc, PDF_MARGIN, y, PDF_CONTENT_W, "Tabel Proyeksi Keuntungan Direct Purchase");
    y += 9;
    y = pdfTableFlow(doc, {
        x: PDF_MARGIN, y,
        colWidths: [18, 42, 34, 42, 46],
        headers: ["Tahun", "Penghematan (Rp)", "OpEx (Rp)", "NCF (Rp)", "Akum. NCF (Rp)"],
        rows: projRows, rowH: projRowH, align: ["center", "right", "right", "right", "right"], fontSize: 6.9
    });
    y += 8;

    // --- Dampak Lingkungan & Kesetaraan CSR (20 Tahun) ------------------
    y = pdfEnsureSpace(doc, y, 10 + 26);
    pdfCardTitle(doc, PDF_MARGIN, y, PDF_CONTENT_W, "Dampak Lingkungan & Kesetaraan CSR (20 Tahun)");
    y += 10;

    const quart8 = (PDF_CONTENT_W - 12) / 4;
    pdfStatBox(doc, PDF_MARGIN, y, quart8, 26, `${formatNumber(r.totalEmissionsReductionTon)} Ton CO2e`, "Total Pengurangan Emisi", { bg: PDF_C.greenBg, valueColor: PDF_C.green, valueSize: 11.5 });
    pdfStatBox(doc, PDF_MARGIN + (quart8 + 4), y, quart8, 26, `${formatNumber(r.avgEmissionsReductionTon)} Ton CO2e`, "Rata-rata Pengurangan Tahunan", { bg: PDF_C.greenBg, valueColor: PDF_C.green, valueSize: 11.5 });
    pdfStatBox(doc, PDF_MARGIN + (quart8 + 4) * 2, y, quart8, 26, `${formatNumber(r.totalMangroveHectares)} Ha`, "Setara Hutan Bakau (Mangrove)", { bg: PDF_C.greenBg, valueColor: PDF_C.green, valueSize: 11.5 });
    pdfStatBox(doc, PDF_MARGIN + (quart8 + 4) * 3, y, quart8, 26, `± ${formatNumber(r.totalMangroveTrees)}`, "Setara dengan Menanam Pohon", { bg: PDF_C.greenBg, valueColor: PDF_C.green, valueSize: 11.5 });
    y += 26 + 8;

    // --- Tabel Pengurangan Emisi Tahun-ke-Tahun (20 tahun) --------------
    const emissionRows = [];
    for (let year = 1; year <= OPERATING_YEARS; year++) {
        const degradationFactor = Math.pow(1 - PANEL_DEGRADATION, year - 1);
        const annualSolarConsumed = (r.dailySolarConsumed || 0) * 365 * degradationFactor;
        const reductionKg = annualSolarConsumed * GRID_EMISSION_FACTOR;
        const reductionTon = reductionKg / 1000;
        const mangroveHa = MANGROVE_SEQUESTRATION_KG_HA > 0 ? reductionKg / MANGROVE_SEQUESTRATION_KG_HA : 0;
        const trees = Math.round(mangroveHa * MANGROVE_DENSITY_TREES_HA);
        const csr = trees * MANGROVE_COST_PER_TREE;
        emissionRows.push([
            String(year), pdfFmtInt(annualSolarConsumed), pdfFmtInt(reductionKg),
            reductionTon.toFixed(2).replace(".", ","), mangroveHa.toFixed(4).replace(".", ","),
            pdfFmtInt(trees), formatRupiah(csr)
        ]);
    }
    const emissionRowH = 6.1;
    y = pdfEnsureSpace(doc, y, 9 + emissionRowH * 3);
    pdfCardTitle(doc, PDF_MARGIN, y, PDF_CONTENT_W, "Tabel Pengurangan Emisi Tahun-ke-Tahun");
    y += 9;
    y = pdfTableFlow(doc, {
        x: PDF_MARGIN, y,
        colWidths: [14, 26, 30, 26, 24, 22, 40],
        headers: ["Tahun", "Produksi (kWh)", "Pengurangan (kgCO2e)", "Pengurangan (MTCO2e)", "Mangrove (ha)", "Pohon Setara", "Biaya CSR (Rp)"],
        rows: emissionRows, rowH: emissionRowH, align: ["center", "right", "right", "right", "right", "right", "right"], fontSize: 6.3
    });

    // ---------------------------------------------------------------
    // Second pass: now that every section has flowed and the actual
    // page count is known, stamp "Halaman X dari Y" on each report
    // page. Page 1 (the offer letter) is left as-is — it has its own
    // letterhead, not this report chrome.
    // ---------------------------------------------------------------
    const totalPages = doc.getNumberOfPages();
    for (let p = 2; p <= totalPages; p++) {
        doc.setPage(p);
        pdfPageNumberLabel(doc, p, totalPages);
    }

    // ---------------------------------------------------------------
    const fileSlug = (lead.name || r.city || "estimate").trim().replace(/\s+/g, "_").replace(/[^\w\-]/g, "") || "estimate";
    doc.save(`Penawaran_PLTS_360energy_${fileSlug}.pdf`);

    if (typeof logActivity === "function") {
        logActivity({
            eventType: "calculator_export",
            user: sessionStorage.getItem("edash-solar-lead-email") || "Anonymous",
            status: "success",
            detail: `Exported solar offer PDF report for ${r?.city || "-"}, ${r?.countryName || "-"}`,
            data: {
                calculatorInput: typeof getCalculatorInputSnapshot === "function" ? getCalculatorInputSnapshot() : {},
                calculatorResult: r,
                export: { type: "PDF", status: "success" },
            },
        });
    }

}

// =====================================================================
// Formatting helpers
// =====================================================================

function formatRupiah(n) {
    return "Rp" + Math.round(n || 0).toLocaleString("id-ID");
}

function formatNumber(n) {
    return (n || 0).toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

// Payback years can legitimately never resolve within the 20-year modeling
// horizon (findPayback() returns Infinity) — e.g. a low-PSH location with a
// high cost/kWp and high margin. Showing the raw "∞" symbol reads like a
// broken calculator to a customer, so this mirrors the reference tool's
// "N/A" treatment but keeps a size hint (>20 yrs) since we know the
// investment genuinely doesn't pay back within the modeled window.
function formatPaybackYears(n) {
    if (!Number.isFinite(n)) return "> 20 yrs";
    return `${formatNumber(n)} yrs`;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}