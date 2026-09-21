// =============================
// Feature: Graph Builder popup — 360eDash Operator Dashboard
// js/operator/graph-builder.js
//
// This is the "Buat grafik" popup (from the buat-grafik-real-data
// package) ported into 360eDash and wired to the "Add Graph" button
// / dashed "+" tile on pages/operator/operator-dashboard.html (see
// js/operator/operator-dashboard.js). It reuses the SAME real Tawabi
// logger data as the standalone popup (js/operator/graph-builder-data.js
// -> REAL_DATA, loaded before this file), instead of any mock/sample
// data, and renders with the already-loaded vendor/chartjs library
// (see index.html) — no separate chart.umd.min.js copy needed.
//
// Everything here is namespaced under the "gb-" CSS prefix and the
// window.OpdGraphBuilder object so it can't collide with the rest of
// the app (e.g. the existing .modal-header rules in css/alert.css).
//
// Public API:
//   OpdGraphBuilder.open(onAdd)
//     Opens the popup. When the user clicks "Tambahkan grafik",
//     onAdd(config) fires with:
//       {
//         title, chartType,               // "line" | "bar"
//         deviceGroupId, deviceGroupName,
//         variables: [{ key, label, unit, color }]
//       }
//     then the popup closes itself.
//
//   OpdGraphBuilder.renderCardChart(canvasEl, config)
//     Draws a compact version of that same config into a small
//     dashboard-card canvas. Returns the Chart.js instance so the
//     caller can .destroy() it later (e.g. on card removal or grid
//     re-render).
// =============================

const OpdGraphBuilder = (function () {

    // ---------- palette (same as the standalone popup) ----------
    // Accent Orange (--accent) is intentionally NOT used here — per the
    // design system, orange is reserved for a single personal accent
    // (e.g. the "Hello, operator!" greeting), not repeating chart series.
    const PALETTE = [
        "#0F6A71", // Primary Teal
        "#6DC3BB", // Primary Header
        "#2F9E6E", // Success
        "#3E7CB1", // Info
        "#E3A21A", // Warning
        "#D64545", // Danger
        "#0B4F54", // Primary Dark
        "#7C8B8D", // Muted
    ];
    let colorCursor = 0;
    function nextColor() {
        const c = PALETTE[colorCursor % PALETTE.length];
        colorCursor++;
        return c;
    }

    const CATEGORY_ORDER = [
        "DEVICE",
        "ENERGY",
        "BATTERY PERFORMANCE",
        "BATTERY BMS",
        "BATTERY ENERGY",
        "BATTERY STATUS",
        "INVERTER",
        "PV STRING VOLTAGE",
        "PV STRING CURRENT",
        "PV STRING POWER",
    ];

    // ---------- build variable catalogue from REAL_DATA ----------
    // REAL_DATA comes from js/operator/graph-builder-data.js, loaded
    // before this file (see index.html).
    let CATEGORIES = [];
    let DEVICE_GROUPS = [];

    function buildCatalogue() {
        if (typeof REAL_DATA === "undefined") {
            console.error("[graph-builder] REAL_DATA tidak ditemukan — pastikan js/operator/graph-builder-data.js dimuat sebelum js/operator/graph-builder.js.");
            return;
        }

        const numericVars = REAL_DATA.meta.vars.map((v) => ({
            label: v.label, unit: v.unit, category: v.category, key: v.key, plottable: true,
        }));
        const statusVars = REAL_DATA.meta.status_vars.map((v) => ({
            label: v.label, unit: "", category: v.category, key: v.key, plottable: false,
        }));
        const allVars = [...numericVars, ...statusVars];

        CATEGORIES = CATEGORY_ORDER
            .map((catName) => ({ name: catName, vars: allVars.filter((v) => v.category === catName) }))
            .filter((cat) => cat.vars.length > 0);

        let uid = 0;
        CATEGORIES.forEach((cat) => {
            cat.vars.forEach((v) => {
                v.id = "gbv" + (uid++);
                v.color = nextColor();
            });
        });

        DEVICE_GROUPS = Object.keys(REAL_DATA.groups).map((gid) => ({
            id: gid,
            name: REAL_DATA.groups[gid].name,
            sn: REAL_DATA.groups[gid].sn,
        }));
    }

    // ---------- real data lookup ----------
    function getGroupData(groupId) {
        return REAL_DATA.groups[groupId].data;
    }
    function dateLabels(groupId) {
        return getGroupData(groupId).labels;
    }
    function realSeries(groupId, v) {
        const data = getGroupData(groupId);
        return data[v.key] || [];
    }

    // ---------- color helpers ----------
    function hexToRgba(hex, alpha) {
        let h = hex.replace("#", "");
        if (h.length === 3) h = h.split("").map((c) => c + c).join("");
        const num = parseInt(h, 16);
        const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
        return `rgba(${r},${g},${b},${alpha})`;
    }
    function makeAreaGradient(ctx, chartArea, hexColor, topAlpha) {
        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, hexToRgba(hexColor, topAlpha));
        gradient.addColorStop(1, hexToRgba(hexColor, 0));
        return gradient;
    }

    // ---------- shared Chart.js config builder ----------
    // Builds datasets + multi-axis scales for a set of plottable
    // variables against one device group's real data. `mini` trims
    // the chart down for the small dashboard-card canvas (no axis
    // ticks/titles, no legend, no tooltip, thinner lines).
    function buildChartConfig(vars, chartType, groupId, mini) {
        const labels = dateLabels(groupId);

        const varStats = vars.map((v) => {
            const arr = realSeries(groupId, v).filter((x) => typeof x === "number" && isFinite(x));
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
                    current = { key: unit + "_g" + axisGroups.length, unit, varIds: new Set(), repMax: item.maxAbs };
                    axisGroups.push(current);
                }
                current.varIds.add(item.v.id);
            });
        });
        const varIdToAxis = {};
        axisGroups.forEach((g) => g.varIds.forEach((id) => { varIdToAxis[id] = g.key; }));

        const scales = {};
        axisGroups.forEach((g, i) => {
            scales[g.key] = {
                type: "linear",
                position: i === 0 ? "left" : "right",
                display: !mini,
                title: mini ? undefined : { display: true, text: g.unit, font: { size: 10.5, family: "Poppins", weight: "500" }, color: "#7C8B8D" },
                grid: { drawOnChartArea: !mini && i === 0, color: "#EEF3F3", drawTicks: false },
                border: { display: false },
                ticks: { display: !mini, font: { size: 10.5, family: "Poppins" }, color: "#7C8B8D", padding: 6 },
                offset: true,
            };
        });

        const fillTopAlpha = vars.length === 1 ? 0.30 : vars.length === 2 ? 0.20 : 0.12;

        const datasets = vars.map((v, i) => ({
            label: v.label + (v.unit ? " (" + v.unit + ")" : ""),
            data: realSeries(groupId, v),
            spanGaps: true,
            borderColor: v.color,
            backgroundColor: chartType === "bar"
                ? v.color + "cc"
                : (ctx) => {
                    const { chart } = ctx;
                    const { ctx: canvasCtx, chartArea } = chart;
                    if (!chartArea) return hexToRgba(v.color, fillTopAlpha);
                    return makeAreaGradient(canvasCtx, chartArea, v.color, fillTopAlpha);
                },
            fill: chartType === "line" ? "origin" : false,
            pointRadius: chartType === "line" ? (mini ? 0 : (labels.length > 45 ? 0 : 2.5)) : 0,
            pointHoverRadius: chartType === "line" ? (mini ? 0 : 5) : 0,
            pointBackgroundColor: v.color,
            pointBorderColor: "#fff",
            pointBorderWidth: chartType === "line" ? 1.5 : 0,
            pointHitRadius: mini ? 0 : 10,
            borderWidth: mini ? 1.75 : 2.5,
            borderCapStyle: "round",
            borderJoinStyle: "round",
            borderRadius: chartType === "bar" ? (mini ? 3 : 6) : 0,
            maxBarThickness: mini ? 16 : 34,
            tension: 0.38,
            cubicInterpolationMode: "monotone",
            yAxisID: varIdToAxis[v.id],
        }));

        return {
            type: chartType,
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                animation: mini ? false : { duration: 500, easing: "easeOutQuart" },
                plugins: {
                    legend: { display: false },
                    tooltip: mini ? { enabled: false } : {
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
                        display: !mini,
                        ticks: { font: { size: 10.5, family: "Poppins" }, color: "#7C8B8D", maxTicksLimit: 8, autoSkip: true, padding: 4 },
                        grid: { display: false },
                        border: { display: false },
                    },
                    ...scales,
                },
            },
        };
    }

    // =========================================================
    // Public: render a compact chart into a dashboard-card canvas
    // =========================================================
    function renderCardChart(canvasEl, config) {
        if (typeof Chart === "undefined" || !canvasEl) return null;
        const vars = config.variables || [];
        if (!vars.length) return null;
        const chartConfig = buildChartConfig(vars, config.chartType || "line", config.deviceGroupId, true);
        return new Chart(canvasEl.getContext("2d"), chartConfig);
    }

    // =========================================================
    // Modal (built once, lazily, then shown/hidden on open/close)
    // =========================================================
    let modalBuilt = false;
    let els = {};
    let selected = [];
    let chartType = "line";
    let titleTouched = false;
    let previewChart = null;
    let currentGroupId = null;
    let activeOnAdd = null;

    function buildModal() {
        if (modalBuilt) return;
        buildCatalogue();
        currentGroupId = DEVICE_GROUPS.length ? DEVICE_GROUPS[0].id : null;

        const backdrop = document.createElement("div");
        backdrop.className = "gb-backdrop";
        backdrop.id = "gbBackdrop";
        backdrop.innerHTML = `
      <div class="gb-modal" role="dialog" aria-modal="true" aria-labelledby="gbModalTitle">
        <div class="gb-modal-header">
          <h1 id="gbModalTitle">Buat grafik</h1>
          <button type="button" class="gb-close-btn" id="gbCloseBtn" aria-label="Tutup">&times;</button>
        </div>
        <p class="gb-modal-subtitle">Variabel yang tercatat di device ini.</p>

        <div class="gb-device-switch" id="gbDeviceSwitch">
          <span class="gb-device-switch-label">Device:</span>
          <div class="gb-segmented" id="gbDeviceToggle"></div>
          <span class="gb-device-sn" id="gbDeviceSn"></span>
        </div>

        <div class="gb-header-divider"></div>

        <div class="gb-modal-body">
          <div class="gb-var-panel" id="gbVarPanel"></div>

          <div class="gb-chart-panel">
            <div class="gb-field-row">
              <div class="gb-field gb-field-title">
                <label for="gbChartTitle">Judul grafik</label>
                <input type="text" id="gbChartTitle" placeholder="Pilih variabel di sebelah kiri…">
              </div>
              <div class="gb-field gb-field-chart-type" id="gbChartTypeField" style="display:none;">
                <label>Tipe grafik</label>
                <div class="gb-segmented" id="gbChartTypeToggle">
                  <button type="button" class="gb-seg-btn is-active" data-type="line">Line</button>
                  <button type="button" class="gb-seg-btn" data-type="bar">Bar</button>
                </div>
              </div>
            </div>

            <div class="gb-preview-label">Pratinjau</div>
            <div class="gb-stats-row" id="gbStatsRow"></div>

            <div class="gb-preview-box" id="gbPreviewBox">
              <div class="gb-empty-state" id="gbEmptyState">
                <div class="gb-empty-icon">📈</div>
                <p><strong>Belum ada variabel dipilih</strong></p>
                <p class="gb-empty-sub">Centang satu atau lebih variabel di sebelah kiri untuk melihat pratinjau grafik di sini. Data yang dipakai adalah data aktual dari logger PLTS TAWABI (rata-rata per hari).</p>
              </div>
              <canvas id="gbPreviewChart" style="display:none;"></canvas>
            </div>

            <div class="gb-legend" id="gbLegend"></div>
            <p class="gb-preview-caption" id="gbPreviewCaption"></p>
          </div>
        </div>

        <div class="gb-modal-footer">
          <button type="button" class="gb-btn gb-btn-ghost" id="gbCancelBtn">Batal</button>
          <button type="button" class="gb-btn gb-btn-primary" id="gbAddBtn" disabled>Tambahkan grafik</button>
        </div>
      </div>
    `;
        document.body.appendChild(backdrop);

        els = {
            backdrop,
            varPanel: backdrop.querySelector("#gbVarPanel"),
            chartTitleInput: backdrop.querySelector("#gbChartTitle"),
            chartTypeToggleEl: backdrop.querySelector("#gbChartTypeField"),
            canvasEl: backdrop.querySelector("#gbPreviewChart"),
            emptyState: backdrop.querySelector("#gbEmptyState"),
            legendEl: backdrop.querySelector("#gbLegend"),
            captionEl: backdrop.querySelector("#gbPreviewCaption"),
            statsRowEl: backdrop.querySelector("#gbStatsRow"),
            addBtn: backdrop.querySelector("#gbAddBtn"),
            cancelBtn: backdrop.querySelector("#gbCancelBtn"),
            closeBtn: backdrop.querySelector("#gbCloseBtn"),
            deviceToggle: backdrop.querySelector("#gbDeviceToggle"),
            deviceSnEl: backdrop.querySelector("#gbDeviceSn"),
        };

        renderDeviceToggle();
        renderVarPanel();

        els.chartTitleInput.addEventListener("input", () => { titleTouched = true; });

        backdrop.querySelectorAll("#gbChartTypeToggle .gb-seg-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                backdrop.querySelectorAll("#gbChartTypeToggle .gb-seg-btn").forEach((b) => b.classList.remove("is-active"));
                btn.classList.add("is-active");
                chartType = btn.dataset.type;
                updatePreview();
            });
        });

        els.closeBtn.addEventListener("click", closeModal);
        els.cancelBtn.addEventListener("click", closeModal);
        backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });

        els.addBtn.addEventListener("click", () => {
            const activeGroup = DEVICE_GROUPS.find((g) => g.id === currentGroupId);
            const plottable = selected.filter((v) => v.unit);
            if (!plottable.length) return;
            const config = {
                title: els.chartTitleInput.value || plottable.map((v) => v.label).join(" vs "),
                chartType,
                deviceGroupId: currentGroupId,
                deviceGroupName: activeGroup ? activeGroup.name : "",
                variables: plottable.map((v) => ({ key: v.key, label: v.label, unit: v.unit, color: v.color })),
            };
            const cb = activeOnAdd;
            closeModal();
            if (typeof cb === "function") cb(config);
        });

        modalBuilt = true;
    }

    function renderDeviceToggle() {
        els.deviceToggle.innerHTML = "";
        DEVICE_GROUPS.forEach((g) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "gb-seg-btn" + (g.id === currentGroupId ? " is-active" : "");
            btn.textContent = g.name.replace(/^PLTS TAWABI\s*/i, "");
            btn.addEventListener("click", () => {
                currentGroupId = g.id;
                renderDeviceToggle();
                updatePreview();
            });
            els.deviceToggle.appendChild(btn);
        });
        const activeGroup = DEVICE_GROUPS.find((g) => g.id === currentGroupId);
        els.deviceSnEl.textContent = activeGroup && activeGroup.sn ? "SN: " + activeGroup.sn : "";
    }

    function renderVarPanel() {
        els.varPanel.innerHTML = "";
        CATEGORIES.forEach((cat) => {
            const wrap = document.createElement("div");
            wrap.className = "gb-var-category";

            const title = document.createElement("p");
            title.className = "gb-cat-title";
            title.textContent = cat.name;
            wrap.appendChild(title);

            cat.vars.forEach((v) => {
                const row = document.createElement("label");
                row.className = "gb-var-row";
                row.dataset.id = v.id;

                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.addEventListener("change", () => toggleVar(v, cb.checked, row));

                const dot = document.createElement("span");
                dot.className = "gb-dot";
                dot.style.background = v.color;

                const label = document.createElement("span");
                label.className = "gb-var-label";
                label.textContent = v.label;

                const unit = document.createElement("span");
                unit.className = "gb-var-unit";
                unit.textContent = v.unit;

                row.appendChild(cb);
                row.appendChild(dot);
                row.appendChild(label);
                row.appendChild(unit);
                wrap.appendChild(row);
            });

            els.varPanel.appendChild(wrap);
        });
    }

    function toggleVar(v, isChecked, rowEl) {
        if (isChecked) {
            selected.push(v);
            rowEl.classList.add("is-checked");
        } else {
            selected = selected.filter((s) => s.id !== v.id);
            rowEl.classList.remove("is-checked");
        }
        updateTitle();
        updatePreview();
    }

    function updateTitle() {
        if (titleTouched) return;
        if (selected.length === 0) {
            els.chartTitleInput.value = "";
            els.chartTitleInput.placeholder = "Pilih variabel di sebelah kiri…";
            return;
        }
        const names = selected.map((s) => s.label);
        els.chartTitleInput.value = names.length <= 2
            ? names.join(" vs ")
            : names.slice(0, 2).join(" vs ") + ` +${names.length - 2} lainnya`;
    }

    function renderStats(plottable) {
        els.statsRowEl.innerHTML = "";
        plottable.forEach((v) => {
            const raw = realSeries(currentGroupId, v).filter((n) => n !== null && n !== undefined && !Number.isNaN(n));
            if (!raw.length) return;
            const min = Math.min(...raw);
            const max = Math.max(...raw);
            const avg = raw.reduce((a, b) => a + b, 0) / raw.length;
            const now = raw[raw.length - 1];
            const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 });

            const chip = document.createElement("div");
            chip.className = "gb-stat-chip";
            chip.style.borderColor = hexToRgba(v.color, 0.35);

            const dot = document.createElement("span");
            dot.className = "gb-stat-dot";
            dot.style.background = v.color;
            chip.appendChild(dot);

            const label = document.createElement("span");
            label.className = "gb-stat-label";
            label.textContent = v.label;
            chip.appendChild(label);

            const nowEl = document.createElement("span");
            nowEl.className = "gb-stat-now";
            nowEl.style.background = hexToRgba(v.color, 0.16);
            nowEl.style.color = v.color;
            nowEl.textContent = `${fmt(now)} ${v.unit} Now`;
            chip.appendChild(nowEl);

            const minmax = document.createElement("span");
            minmax.className = "gb-stat-minmax";
            minmax.textContent = `Min ${fmt(min)} · Max ${fmt(max)} · Avg ${fmt(avg)}`;
            chip.appendChild(minmax);

            els.statsRowEl.appendChild(chip);
        });
    }

    function updatePreview() {
        const plottable = selected.filter((v) => v.unit);
        const nonPlottable = selected.filter((v) => !v.unit);

        if (selected.length === 0) {
            els.emptyState.style.display = "block";
            els.emptyState.querySelector("strong").textContent = "Belum ada variabel dipilih";
            els.emptyState.querySelector(".gb-empty-sub").textContent =
                "Centang satu atau lebih variabel di sebelah kiri untuk melihat pratinjau grafik di sini. Data yang dipakai adalah data aktual dari logger PLTS TAWABI (dirata-rata per hari).";
            els.legendEl.innerHTML = "";
            els.captionEl.textContent = "";
            els.statsRowEl.innerHTML = "";
            els.addBtn.disabled = true;
            els.chartTypeToggleEl.style.display = "none";
            if (previewChart) { previewChart.destroy(); previewChart = null; }
            els.canvasEl.style.display = "none";
            return;
        }

        els.addBtn.disabled = plottable.length === 0;

        if (plottable.length === 0) {
            els.emptyState.style.display = "block";
            els.emptyState.querySelector("strong").textContent = "Variabel ini tidak berupa angka";
            els.emptyState.querySelector(".gb-empty-sub").textContent =
                "Field seperti " + nonPlottable.map((v) => v.label).join(", ") +
                " bersifat status/teks, jadi tidak bisa digambar sebagai grafik garis/batang.";
            els.legendEl.innerHTML = "";
            els.captionEl.textContent = "";
            els.statsRowEl.innerHTML = "";
            els.chartTypeToggleEl.style.display = "none";
            if (previewChart) { previewChart.destroy(); previewChart = null; }
            els.canvasEl.style.display = "none";
            return;
        }

        if (typeof Chart === "undefined") {
            els.emptyState.style.display = "block";
            els.emptyState.querySelector("strong").textContent = "Library grafik gagal dimuat";
            els.emptyState.querySelector(".gb-empty-sub").textContent =
                "vendor/chartjs/chart.umd.min.js tidak berhasil dimuat. Refresh halaman dan coba lagi.";
            els.canvasEl.style.display = "none";
            els.legendEl.innerHTML = "";
            els.captionEl.textContent = "";
            els.statsRowEl.innerHTML = "";
            els.chartTypeToggleEl.style.display = "none";
            return;
        }

        els.emptyState.style.display = "none";
        els.chartTypeToggleEl.style.display = "flex";
        els.canvasEl.style.display = "block";

        const labels = dateLabels(currentGroupId);
        const N = labels.length;

        const chartConfig = buildChartConfig(plottable, chartType, currentGroupId, false);
        if (previewChart) previewChart.destroy();
        previewChart = new Chart(els.canvasEl.getContext("2d"), chartConfig);
        renderStats(plottable);

        els.legendEl.innerHTML = "";
        plottable.forEach((v) => {
            const item = document.createElement("div");
            item.className = "gb-legend-item";
            const ring = document.createElement("span");
            ring.className = "gb-ring";
            ring.style.borderColor = v.color;
            item.appendChild(ring);
            const text = document.createElement("span");
            text.textContent = v.label;
            item.appendChild(text);
            els.legendEl.appendChild(item);
        });

        const activeGroup = DEVICE_GROUPS.find((g) => g.id === currentGroupId);
        els.captionEl.textContent =
            `${N} titik data aktual (rata-rata harian, ${labels[0]} s/d ${labels[N - 1]}) dari ${activeGroup.name}` +
            (nonPlottable.length ? ` — ${nonPlottable.length} variabel non-angka diabaikan dari grafik.` : ".") +
            " Data bersumber langsung dari data logger, bukan data contoh.";
    }

    function resetState() {
        selected = [];
        chartType = "line";
        titleTouched = false;
        if (els.varPanel) {
            els.varPanel.querySelectorAll(".gb-var-row").forEach((row) => {
                row.classList.remove("is-checked");
                const cb = row.querySelector("input[type=checkbox]");
                if (cb) cb.checked = false;
            });
        }
        if (els.chartTitleInput) {
            els.chartTitleInput.value = "";
            els.chartTitleInput.placeholder = "Pilih variabel di sebelah kiri…";
        }
        if (els.backdrop) {
            els.backdrop.querySelectorAll("#gbChartTypeToggle .gb-seg-btn").forEach((b, i) => {
                b.classList.toggle("is-active", i === 0);
            });
        }
        updatePreview();
    }

    function closeModal() {
        if (els.backdrop) els.backdrop.classList.remove("is-open");
        document.body.classList.remove("gb-no-scroll");
        activeOnAdd = null;
    }

    function open(onAdd) {
        buildModal();
        if (!DEVICE_GROUPS.length) {
            console.error("[graph-builder] Tidak ada device group di REAL_DATA.");
            return;
        }
        activeOnAdd = onAdd;
        resetState();
        els.backdrop.classList.add("is-open");
        document.body.classList.add("gb-no-scroll");
    }

    return { open, renderCardChart };

})();
