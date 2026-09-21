// ============================================================
// Marketing Analytics (Meta Pixel) — section di dalam Activity Log
// ------------------------------------------------------------
// AUDIT — dibaca sebelum kode di bawah ditulis (ringkasan, lihat juga
// komentar di js/marketing-pixel-client.js):
//
//   1. Meta Pixel (fbq) di pages/solar-calculator.html HANYA mengirim
//      event satu arah ke server Meta (Ads Manager/Events Manager).
//      Tidak ada Graph API / Conversions API / access token yang
//      dikonfigurasi di proyek ini untuk membaca balik data agregat
//      dari Meta — jadi dashboard ini TIDAK BISA menampilkan angka
//      "resmi" dari Meta Ads Manager tanpa integrasi tambahan itu.
//   2. Yang BISA dipakai, dan memang benar-benar tersedia: event yang
//      sama persis dengan yang dikirim ke fbq(...) di
//      js/solar-calculator.js, di-mirror ke storage kita sendiri
//      (tabel marketing_pixel_events di edashboard_api, lewat
//      js/marketing-pixel-client.js) setiap kali event itu benar-benar
//      terjadi. Section ini membaca GET /marketing-pixel-events dan
//      HANYA menghitung dari data itu — tidak ada angka dikarang.
//   3. Storage ini terpisah total dari tabel Activity Log — tidak
//      pernah ditulis campur.
//
// Event yang tersedia (lihat ALLOWED_MARKETING_EVENT_TYPES di
// edashboard_api/src/services/marketing-pixel.service.ts): PageView,
// ViewContent, SolarCalculatorCalculate, SolarCalculatorInputChange,
// SolarCalculatorBatteryScenario, Lead.
// ============================================================

const MKT_RANGE_DAYS = 30;

const MktState = {
    events: [],
    loading: false,
    loadError: false,
    chart: null,
};

// ---------------------------------------------------------------
// 1. Sumber data — GET /api/marketing-events
// ---------------------------------------------------------------

// Data diambil lewat edashApiFetch() ke backend Hono + PostgreSQL
// (edashboard_api, GET /marketing-pixel-events, tabel
// marketing_pixel_events). Bentuk tiap item
// (eventName/timestamp/sessionId/detail/country/countryCode/data)
// mengikuti skema di marketing-pixel.service.ts (edashboard_api), jadi logika di
// bawah ini tidak perlu diubah selain sumber fetch-nya.
async function mktFetchEvents() {
    const raw = await edashApiFetch("/marketing-pixel-events");
    return (raw || []).map((e) => ({ ...e, timestamp: new Date(e.timestamp) }));
}

function mktInRange(events, from, to) {
    return events.filter((e) => e.timestamp >= from && e.timestamp <= to);
}

// ---------------------------------------------------------------
// 2. Perhitungan metrik — semua dari MktState.events (data nyata),
//    dikelompokkan per sessionId supaya "visitor" dihitung sekali per
//    sesi browser, bukan per event. Kalau sessionId tidak ada (mis.
//    sessionStorage diblokir), event itu tetap dihitung sebagai 1
//    visitor tersendiri supaya tidak hilang dari total.
// ---------------------------------------------------------------

function mktUniqueSessions(events, eventName) {
    const matches = events.filter((e) => e.eventName === eventName);
    const withSession = new Set(matches.filter((e) => e.sessionId).map((e) => e.sessionId));
    const withoutSession = matches.filter((e) => !e.sessionId).length;
    return withSession.size + withoutSession;
}

function mktComputeStats(events) {

    const visitors = mktUniqueSessions(events, "PageView");
    const engaged = new Set([
        ...events.filter((e) => e.eventName === "SolarCalculatorInputChange" && e.sessionId).map((e) => e.sessionId),
        ...events.filter((e) => e.eventName === "SolarCalculatorBatteryScenario" && e.sessionId).map((e) => e.sessionId),
    ]);
    const engagedCount = engaged.size + events.filter((e) =>
        (e.eventName === "SolarCalculatorInputChange" || e.eventName === "SolarCalculatorBatteryScenario") && !e.sessionId
    ).length;

    const calculateClicks = events.filter((e) => e.eventName === "ViewContent").length;
    const calculatedSessions = mktUniqueSessions(events, "ViewContent");
    const leads = events.filter((e) => e.eventName === "Lead").length;

    const engagementRate = visitors > 0 ? Math.round((engagedCount / visitors) * 100) : 0;
    const conversionRate = visitors > 0 ? Math.round((leads / visitors) * 100) : 0;

    return {
        visitors,
        engagedCount,
        calculateClicks,
        calculatedSessions,
        leads,
        engagementRate,
        conversionRate,
        totalEvents: events.length,
    };

}

// ---------------------------------------------------------------
// 3. Render — stat cards, rate chips, funnel, trend chart
// ---------------------------------------------------------------

function mktRenderStats(stats) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("mktStatVisitors", stats.visitors.toLocaleString("en-US"));
    set("mktStatEngagement", stats.engagedCount.toLocaleString("en-US"));
    set("mktStatCalculate", stats.calculateClicks.toLocaleString("en-US"));
    set("mktStatLeads", stats.leads.toLocaleString("en-US"));
    set("mktRateEngagement", `${stats.engagementRate}%`);
    set("mktRateConversion", `${stats.conversionRate}%`);
}

function mktFunnelStageHtml(label, value, max, icon) {
    const pct = max > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0;
    return `
        <div class="mkt-funnel-stage">
            <div class="mkt-funnel-stage-head">
                <span><i class="fa-solid ${icon}"></i> ${label}</span>
                <span class="mkt-funnel-stage-val">${value.toLocaleString("en-US")}</span>
            </div>
            <div class="mkt-funnel-bar-track">
                <div class="mkt-funnel-bar-fill" style="width:${pct}%"></div>
            </div>
        </div>
    `;
}

function mktIsId() {
    return typeof getSavedLanguage === "function" && getSavedLanguage() === "id";
}

function mktRenderFunnel(stats) {
    const wrap = document.getElementById("mktFunnel");
    if (!wrap) return;
    const id = mktIsId();
    const max = Math.max(stats.visitors, 1);
    wrap.innerHTML = [
        mktFunnelStageHtml(id ? "Pengunjung" : "Visitors", stats.visitors, max, "fa-users"),
        mktFunnelStageHtml(id ? "Berinteraksi dengan kalkulator" : "Engaged with calculator", stats.engagedCount, max, "fa-sliders"),
        mktFunnelStageHtml(id ? "Klik Hitung Estimasi" : "Clicked Calculate Estimate", stats.calculateClicks, max, "fa-calculator"),
        mktFunnelStageHtml(id ? "Lead terkirim (email)" : "Submitted lead (email)", stats.leads, max, "fa-envelope-circle-check"),
    ].join("");
}

function mktBuildDailySeries(events, eventName, from, to) {
    const byDay = new Map();
    events.filter((e) => e.eventName === eventName).forEach((e) => {
        const d = e.timestamp;
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        byDay.set(key, (byDay.get(key) || 0) + 1);
    });
    const labels = [];
    const values = [];
    let d = new Date(from);
    while (d <= to) {
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        labels.push(d.toLocaleDateString(mktIsId() ? "id-ID" : "en-GB", { day: "numeric", month: "short" }));
        values.push(byDay.get(key) || 0);
        d = new Date(d.getTime() + 864e5);
    }
    return { labels, values };
}

function mktDrawChart(events, from, to) {

    const canvas = document.getElementById("mktTrendChart");
    if (!canvas) return;

    if (typeof Chart === "undefined") {
        // Chart.js belum selesai dimuat — coba lagi sebentar, mengikuti
        // pola amWatchChartJsReady() di js/activity-log.js.
        setTimeout(() => mktDrawChart(events, from, to), 300);
        return;
    }

    const visitors = mktBuildDailySeries(events, "PageView", from, to);
    const calculated = mktBuildDailySeries(events, "ViewContent", from, to);
    const leads = mktBuildDailySeries(events, "Lead", from, to);
    const id = mktIsId();

    if (MktState.chart) { MktState.chart.destroy(); MktState.chart = null; }

    MktState.chart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels: visitors.labels,
            datasets: [
                { label: id ? "Pengunjung (PageView)" : "Visitors (PageView)", data: visitors.values, borderColor: "#0F6A71", backgroundColor: "rgba(15,106,113,.10)", tension: 0.3, fill: true, pointRadius: 2 },
                { label: id ? "Hitung Estimasi" : "Calculate Estimate", data: calculated.values, borderColor: "#FA891A", backgroundColor: "rgba(250,137,26,.08)", tension: 0.3, fill: true, pointRadius: 2 },
                { label: id ? "Lead" : "Leads", data: leads.values, borderColor: "#2F9E6E", backgroundColor: "rgba(47,158,110,.08)", tension: 0.3, fill: true, pointRadius: 2 },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11.5 } } } },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
            },
        },
    });

}

function mktRangeDates() {
    const to = new Date(); to.setHours(23, 59, 59, 999);
    const from = new Date(); from.setDate(from.getDate() - (MKT_RANGE_DAYS - 1)); from.setHours(0, 0, 0, 0);
    return [from, to];
}

// ---------------------------------------------------------------
// 4. Load
// ---------------------------------------------------------------

function mktLoad() {

    const root = document.getElementById("mktRoot");
    const empty = document.getElementById("mktEmptyState");
    if (!root) return;

    const [from, to] = mktRangeDates();
    const events = mktInRange(MktState.events, from, to);

    const rangeLbl = document.getElementById("mktRangeLbl");
    if (rangeLbl) {
        const isId = typeof getSavedLanguage === "function" && getSavedLanguage() === "id";
        rangeLbl.textContent = MktState.loadError
            ? (isId ? "backend tidak dapat dihubungi" : "backend unreachable")
            : (isId ? `${MKT_RANGE_DAYS} hari terakhir` : `last ${MKT_RANGE_DAYS} days`);
    }

    const stats = mktComputeStats(events);
    mktRenderStats(stats);
    mktRenderFunnel(stats);
    mktDrawChart(events, from, to);

    const hasData = events.length > 0;
    if (empty) empty.hidden = hasData && !MktState.loadError;
    root.classList.toggle("mkt-is-empty", !hasData);

}

async function mktRefresh() {
    try {
        MktState.events = await mktFetchEvents();
        MktState.loadError = false;
    } catch (err) {
        console.warn("[marketing-analytics] Gagal memuat marketing events dari backend:", err.message);
        MktState.loadError = true;
        MktState.events = [];
    }
    mktLoad();
}

// ---------------------------------------------------------------
// 5. Details modal — rincian metrik, periode, sumber data, & catatan
//    keterbatasan (lihat audit di kepala file ini).
// ---------------------------------------------------------------

function mktEventLabel(name) {
    const id = mktIsId();
    const map = {
        PageView: id ? "Page View (mengunjungi Kalkulator Solar)" : "Page View (visited Solar Calculator)",
        ViewContent: id ? "Klik Hitung Estimasi" : "Calculate Estimate click",
        SolarCalculatorCalculate: id ? "Klik Hitung Estimasi (event khusus)" : "Calculate Estimate click (custom event)",
        SolarCalculatorInputChange: id ? "Kolom kalkulator berubah" : "Calculator field changed",
        SolarCalculatorBatteryScenario: id ? "Skenario baterai diubah" : "Battery scenario toggled",
        Lead: id ? "Lead (email terkirim)" : "Lead (email submitted)",
    };
    return map[name] || name;
}

function mktRenderDetailModal() {

    const [from, to] = mktRangeDates();
    const events = mktInRange(MktState.events, from, to);
    const stats = mktComputeStats(events);
    const id = mktIsId();

    const byEvent = new Map();
    events.forEach((e) => byEvent.set(e.eventName, (byEvent.get(e.eventName) || 0) + 1));

    const eventRows = [...byEvent.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `
            <div class="al-detail-row">
                <span>${alEscape(mktEventLabel(name))}</span>
                <span>${count.toLocaleString("en-US")}</span>
            </div>
        `).join("") || `<div class="al-detail-empty">${id ? "Tidak ada event Meta Pixel yang tercatat pada periode ini." : "No Meta Pixel events recorded in this period."}</div>`;

    const body = document.getElementById("mktDetailModalBody");
    if (!body) return;

    body.innerHTML = `
        <div class="al-detail-section">
            <div class="al-detail-section-title">${id ? "Periode & Data yang Digunakan" : "Period & Data Used"}</div>
            <div class="al-detail-row"><span>${id ? "Rentang tanggal" : "Date range"}</span><span>${alFormatDate(from)} &ndash; ${alFormatDate(to)}</span></div>
            <div class="al-detail-row"><span>${id ? "Total event Meta Pixel" : "Total Meta Pixel events"}</span><span>${stats.totalEvents.toLocaleString("en-US")}</span></div>
            <div class="al-detail-row"><span>${id ? "Sumber data" : "Data source"}</span><span>${id ? "Mirror event Meta Pixel (server kami)" : "Meta Pixel event mirror (our own server)"}</span></div>
        </div>

        <div class="al-detail-section">
            <div class="al-detail-section-title">${id ? "Metrik" : "Metrics"}</div>
            <div class="al-detail-row"><span>${id ? "Total Pengunjung" : "Total Visitors"}</span><span>${stats.visitors.toLocaleString("en-US")}</span></div>
            <div class="al-detail-row"><span>${id ? "Interaksi Kalkulator" : "Calculator Engagement"}</span><span>${stats.engagedCount.toLocaleString("en-US")}</span></div>
            <div class="al-detail-row"><span>${id ? "Klik Hitung Estimasi" : "Calculate Estimate Clicks"}</span><span>${stats.calculateClicks.toLocaleString("en-US")}</span></div>
            <div class="al-detail-row"><span>${id ? "Lead (Pengiriman Email)" : "Leads (Email Submissions)"}</span><span>${stats.leads.toLocaleString("en-US")}</span></div>
            <div class="al-detail-row"><span>${id ? "Rasio interaksi" : "Engagement Rate"}</span><span>${stats.engagementRate}% (${id ? "pengunjung yang berinteraksi ÷ pengunjung" : "engaged ÷ visitors"})</span></div>
            <div class="al-detail-row"><span>${id ? "Rasio konversi" : "Conversion Rate"}</span><span>${stats.conversionRate}% (${id ? "lead ÷ pengunjung" : "leads ÷ visitors"})</span></div>
        </div>

        <div class="al-detail-section">
            <div class="al-detail-section-title">${id ? "Rincian Event Mentah" : "Raw Event Breakdown"}</div>
            ${eventRows}
        </div>

        <div class="al-detail-section">
            <div class="al-detail-section-title">${id ? "Cara Data Ini Dikumpulkan" : "How This Data Is Collected"}</div>
            <p class="mkt-modal-note">
                ${id
                    ? `Angka ini berasal dari Meta Pixel yang sudah terpasang pada halaman Kalkulator Solar (<code>fbq(...)</code> di <code>js/solar-calculator.js</code>). Meta Pixel hanya mengirim event satu arah ke server Meta &mdash; proyek ini tidak memiliki Graph API / Conversions API / access token yang dikonfigurasi, sehingga tidak dapat membaca kembali angka agregat resmi dari Meta Ads Manager. Sebaliknya, setiap kali event Pixel benar-benar berjalan, nama event dan parameternya juga dicerminkan ke backend kami (tabel <code>marketing_pixel_events</code> di edashboard_api), sepenuhnya terpisah dari tabel/storage Activity Log. Yang ditampilkan di sini adalah aktivitas nyata yang teramati dari aplikasi ini &mdash; bukan pengganti laporan Meta Ads Manager, yang dapat menampilkan angka sedikit berbeda karena deduplikasi, penyaringan bot, dan jendela atribusi milik Meta.`
                    : `These numbers come from the Meta Pixel that is already installed on the Solar Calculator page (<code>fbq(...)</code> in <code>js/solar-calculator.js</code>). Meta Pixel only sends events one-way to Meta's servers &mdash; this project has no Graph API / Conversions API / access token configured, so it cannot read back official aggregate numbers from Meta Ads Manager. Instead, every time a Pixel event actually fires, the same event name and parameters are also mirrored to our own backend (the <code>marketing_pixel_events</code> table in edashboard_api), completely separate from the Activity Log table/storage. What you see here is real, observed activity from this app &mdash; not a substitute for Meta Ads Manager's own reporting, which may show slightly different numbers due to Meta's own deduplication, bot filtering, and attribution windows.`}
            </p>
        </div>
    `;

}

function mktOpenDetailModal() {
    mktRenderDetailModal();
    const overlay = document.getElementById("mktDetailModalOverlay");
    if (overlay) overlay.classList.remove("hidden");
}

function mktCloseDetailModal() {
    const overlay = document.getElementById("mktDetailModalOverlay");
    if (overlay) overlay.classList.add("hidden");
}

// ---------------------------------------------------------------
// 6. Init — dipanggil dari initActivityLog() (js/activity-log.js) dan
//    dari alRefresh() supaya tombol "Refresh" di header memuat ulang
//    Marketing Analytics juga.
// ---------------------------------------------------------------

function initMarketingAnalytics() {

    const root = document.getElementById("mktRoot");
    if (!root) return;

    mktRefresh();

    const detailsBtn = document.getElementById("mktDetailsBtn");
    const overlay = document.getElementById("mktDetailModalOverlay");
    const closeBtn = document.getElementById("mktDetailModalClose");

    if (detailsBtn) detailsBtn.addEventListener("click", mktOpenDetailModal);
    if (closeBtn) closeBtn.addEventListener("click", mktCloseDetailModal);
    if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) mktCloseDetailModal(); });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && overlay && !overlay.classList.contains("hidden")) mktCloseDetailModal();
    });

}


document.addEventListener("edash:languagechange", () => {
  try { if (typeof mktLoad === "function") mktLoad(); } catch (e) {}
});
