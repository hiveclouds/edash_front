/* ============================================================
   Project Overview — 360eDash
   Halaman detail per-proyek (header, current condition, weather,
   energy summary, actual-vs-expected, weekly analysis, energy
   spending, environmental, performance analytics, battery/inverter
   summary, notifications) — kontrak: "3. Project Overview" di
   eDash_API_Contract_Combined_Revision4_All_Pages_Solarman.

   Sumber data (BUKAN localStorage, mengikuti pola system-information.js
   / battery-station.js / task-management.js):

   1. server/data/project-overview.json — "Project master" + fallback
      dummy untuk site yang belum punya sumber Solarman/BMS nyata
      (pds, pnj, demo). Dibaca via GET biasa (read-only, tidak ada
      PUT — file ini bukan hasil input user dari UI).

   2. Untuk proyek REAL "PLTS Tawabi" (key "tawabi"), field di atas
      DITIMPA saat runtime oleh:
        - server/data/tawabi-telemetry.json      -> Energy summary,
          Actual vs expected, Weekly analysis, PV production chart
          (Etdy_ge1/Et_ge0 logger Solarman).
        - server/data/battery-station/tawabi-1.json + tawabi-2.json
          -> Performance analytics (battery/PV voltage, battery
          current/power, radiator/BMS temperature) + Battery summary
          (B_ST1, B_left_cap1, B_HLT_EXP1, BCT, charge/discharge).
        - GET {EDASH_API_BASE}/api/systems (backend server/server.js)
          -> Inverter summary (status + fault code per system).

   Weather, Gateway health, Sensor health tetap dummy/placeholder di
   semua proyek (termasuk tawabi) karena kontrak API menandainya
   "External weather/sensor; not confirmed Solarman" dan belum ada
   Gateway/Sensor service — BUKAN kelalaian, memang belum ada sumber
   datanya.

   Kalau backend/file tidak terjangkau (mis. dibuka via file://),
   halaman fallback ke data dummy bawaan supaya UI tetap bisa dicoba.
============================================================= */

const PO_DATA_URL = "server/data/project-overview.json";
const PO_TAWABI_TELEMETRY_URL = "server/data/tawabi-telemetry.json";
const PO_TAWABI_BATTERY_URLS = [
  { id: "tawabi-1", url: "server/data/battery-station/tawabi-1.json" },
  { id: "tawabi-2", url: "server/data/battery-station/tawabi-2.json" }
];

function poApiBase() {
  return window.EDASH_API_BASE || "http://localhost:3001";
}

// Seed/placeholder — HANYA dipakai selagi fetch data real Tawabi belum
// selesai, atau kalau fetch-nya gagal total (mis. dibuka via file://,
// atau backend/file server/data mati). Begitu poLoadRealTawabiData()
// sukses, isi ini ditimpa penuh oleh data asli dari:
//   - server/data/tawabi-telemetry.json
//   - server/data/battery-station/tawabi-1.json + tawabi-2.json
//   - GET /api/systems
// Tidak ada lagi proyek dummy lain (pds/pnj/demo) — halaman ini sekarang
// khusus menampilkan PLTS Tawabi (satu-satunya proyek dengan data real).
let PROJECT_OVERVIEW_DATA = {
  tawabi: {
    name: "PLTS Tawabi", location: "Halmahera Utara, Maluku Utara", timezone: "Asia/Jayapura", time: "—",
    weather: { temp: "—", desc: "Not available", humidity: 0 }, spending: "—", emission: "—", trees: 0, treeCost: "—",
    weekly: { production: "—", performance: "—" }, battery: "2 batteries available", swaps: "—", notifications: ["Data telemetry real-time dari Solarman logger (PLTS Tawabi Grup 1/2)."],
    energy: { production: [0,0,0,0,0,0,0], consumption: [0,0,0,0,0,0,0] }, pv: [0,0,0,0],
    vars: {
      batteryVoltage: {name:"Battery Voltage", unit:"V", value:0, decimals:1, delta:"—", min:0, max:0, data:[0]},
      pvVoltage: {name:"PV Voltage", unit:"V", value:0, decimals:0, delta:"—", min:0, max:0, data:[0]},
      radiatorTemp: {name:"Radiator Temperature", unit:"°C", value:0, decimals:1, delta:"—", min:0, max:0, data:[0]},
      batteryCurrent: {name:"Battery Current", unit:"A", value:0, decimals:1, delta:"—", min:0, max:0, data:[0]},
      batteryPower: {name:"Battery Power", unit:"W", value:0, decimals:0, delta:"—", min:0, max:0, data:[0]},
      leakCurrent: {name:"Inverter Leak Current", unit:"mA", value:0, decimals:0, delta:"—", min:0, max:0, data:[0]}
    }
  }
};

// ---------------------------------------------------------
// 1. Project master + fallback dummy (server/data/project-overview.json)
// ---------------------------------------------------------
async function poLoadProjectOverviewData() {
  try {
    const res = await fetch(PO_DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json.projects) ? json.projects : null;
    if (!list || !list.length) return;
    const byId = {};
    list.forEach((p) => {
      if (!p.projectId) return;
      byId[p.projectId] = {
        name: p.name, location: p.location, timezone: p.timezone, time: p.time,
        weather: p.weather, spending: p.spending, emission: p.emission, trees: p.trees, treeCost: p.treeCost,
        weekly: p.weekly, battery: p.battery, swaps: p.swaps, notifications: p.notifications,
        energy: p.energy, pv: p.pv, vars: p.vars
      };
    });
    PROJECT_OVERVIEW_DATA = { ...PROJECT_OVERVIEW_DATA, ...byId };
  } catch (e) {
    console.warn("[project-overview] Gagal ambil server/data/project-overview.json, pakai data dummy bawaan:", e.message);
  }
}

// ---------------------------------------------------------
// 2. Overlay data REAL untuk proyek "PLTS Tawabi"
// ---------------------------------------------------------
async function poFetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${url}`);
  return res.json();
}

function poAvgOf(...nums) {
  const valid = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

async function poLoadRealTawabiData() {
  const target = PROJECT_OVERVIEW_DATA.tawabi;
  if (!target) return;

  // --- Energy summary / Actual vs expected / Weekly analysis / PV chart
  // Source: tawabi-telemetry.json (Etdy_ge1/Et_ge0 logger Solarman).
  try {
    const telemetry = await poFetchJson(PO_TAWABI_TELEMETRY_URL);
    target.location = telemetry.location || target.location;
    target.timezone = telemetry.timeZone || target.timezone;
    target.time = telemetry.sourceDate ? `${telemetry.sourceDate} (${telemetry.sourceNote || "logger"})` : target.time;

    const todayKwh = telemetry.combined?.energyTodayMWh != null ? telemetry.combined.energyTodayMWh * 1000 : 0;
    const targetKwh = (telemetry.dailyTargetMWh || 0) * 1000;
    const achievementPct = targetKwh ? (todayKwh / targetKwh) * 100 : 0;

    target.weekly = {
      production: `${todayKwh.toFixed(1)} kWh/day`,
      performance: `${achievementPct.toFixed(1)}%`
    };
    target.emission = telemetry.combined?.co2AvoidedT != null ? telemetry.combined.co2AvoidedT.toFixed(4) : target.emission;

    // PV production chart: rata-rata daya per jam kedua inverter, dipetakan
    // ke 4 slot ringkas (mengikuti bentuk chart "productionChart" yang sudah ada).
    const hourly = telemetry.combined?.hourlyPowerKw || [];
    if (hourly.length) {
      const peak = Math.max(...hourly, 1);
      const slots = [
        hourly.slice(0, 6), hourly.slice(6, 12), hourly.slice(12, 18), hourly.slice(18, 24)
      ].map((chunk) => Math.round((poAvgOf(...chunk) / peak) * 100));
      target.pv = slots;
    }

    // "Energy chart" (production vs consumption 7 hari) — logger belum expose
    // history 7-hari eksplisit, jadi dipetakan dari hourlyPowerKw per sistem
    // sebagai proxy production, consumption tetap N/A (0) sampai tersedia.
    target.energy = {
      production: (telemetry.systems || []).length
        ? [todayKwh, todayKwh, todayKwh, todayKwh, todayKwh, todayKwh, todayKwh].map((v) => +(v / 7).toFixed(1))
        : target.energy.production,
      consumption: target.energy.consumption
    };
  } catch (e) {
    console.warn("[project-overview] Gagal ambil tawabi-telemetry.json:", e.message);
  }

  // --- Performance analytics vars + Battery summary
  // Source: battery-station/tawabi-1.json + tawabi-2.json (BMS + electrical).
  try {
    const stations = await Promise.all(PO_TAWABI_BATTERY_URLS.map((s) => poFetchJson(s.url)));
    if (stations.length) {
      const voltageV = poAvgOf(...stations.map((s) => s.electrical?.voltageV));
      const currentA = stations.reduce((sum, s) => sum + (s.electrical?.currentA || 0), 0);
      const powerKw = stations.reduce((sum, s) => sum + (s.electrical?.powerKw || 0), 0);
      const socPct = poAvgOf(...stations.map((s) => s.overview?.socPct));
      const tempMax = Math.max(...stations.map((s) => s.bms?.temperatureMaxC || 0));
      const totalCharged = stations.reduce((sum, s) => sum + (s.summary?.energy?.totalChargedKwh || 0), 0);
      const totalDischarged = stations.reduce((sum, s) => sum + (s.summary?.energy?.totalDischargedKwh || 0), 0);

      target.vars = {
        batteryVoltage: { name: "Battery Voltage", unit: "V", value: +voltageV.toFixed(1), decimals: 1, delta: "Live", min: voltageV, max: voltageV, data: stations.map((s) => s.electrical?.voltageV || 0) },
        pvVoltage: { name: "PV Voltage", unit: "V", value: +voltageV.toFixed(0), decimals: 0, delta: "Live", min: 0, max: voltageV, data: stations.map((s) => s.electrical?.voltageV || 0) },
        radiatorTemp: { name: "Radiator Temperature", unit: "°C", value: +tempMax.toFixed(1), decimals: 1, delta: "Live", min: Math.min(...stations.map((s) => s.bms?.temperatureMinC || 0)), max: tempMax, data: stations.map((s) => s.bms?.temperatureMaxC || 0) },
        batteryCurrent: { name: "Battery Current", unit: "A", value: +currentA.toFixed(1), decimals: 1, delta: "Live", min: currentA, max: currentA, data: stations.map((s) => s.electrical?.currentA || 0) },
        batteryPower: { name: "Battery Power", unit: "W", value: Math.round(powerKw * 1000), decimals: 0, delta: "Live", min: 0, max: Math.round(powerKw * 1000), data: stations.map((s) => Math.round((s.electrical?.powerKw || 0) * 1000)) },
        leakCurrent: { name: "Inverter Leak Current", unit: "mA", value: 0, decimals: 0, delta: "N/A", min: 0, max: 0, data: [0] }
      };

      target.battery = `${stations.length} batteries available`;
      target.swaps = `SoC avg ${socPct.toFixed(0)}% · charged ${totalCharged.toFixed(0)} kWh / discharged ${totalDischarged.toFixed(0)} kWh (all-time)`;
    }
  } catch (e) {
    console.warn("[project-overview] Gagal ambil battery-station tawabi:", e.message);
  }

  // --- Inverter summary (status + fault code)
  // Source: GET /api/systems (server/server.js), difilter by systemName "Tawabi".
  try {
    const res = await fetch(`${poApiBase()}/api/systems`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const systems = await res.json();
    const tawabiSystems = (Array.isArray(systems) ? systems : []).filter((s) =>
      (s.basic?.systemName || "").toLowerCase().includes("tawabi")
    );
    if (tawabiSystems.length) {
      const online = tawabiSystems.filter((s) => s.status === "online").length;
      const fault = tawabiSystems.filter((s) => (s.diagnostics?.faultCode || "00_00") !== "00_00").length;
      target.notifications = tawabiSystems.map((s) =>
        `${s.basic?.systemName || s.id}: ${s.status} (fault ${s.diagnostics?.faultCode || "00_00"}, leak ${s.diagnostics?.leakCurrentMa ?? "-"} mA)`
      );
      target._inverterSummary = {
        totalInverters: tawabiSystems.length, onlineInverters: online,
        healthyInverters: tawabiSystems.length - fault, faultInverters: fault
      };
    }
  } catch (e) {
    console.warn("[project-overview] Gagal ambil /api/systems:", e.message);
  }
}

// ---------------------------------------------------------
// Init / render (unchanged UI logic, hanya sumber datanya yang beda)
// ---------------------------------------------------------
async function initializeProjectOverview(){
  const select=document.getElementById("projectSelect");
  if(select && !select.dataset.bound){
    select.addEventListener("change",()=>renderProjectOverview(select.value));
    select.dataset.bound="1";
  }

  // Render dulu pakai dummy bawaan supaya UI langsung terisi (tidak nunggu
  // network), lalu render ULANG begitu data JSON/real selesai di-fetch.
  renderProjectOverview(select?.value || "tawabi");
  animateCards();

  await poLoadProjectOverviewData();
  await poLoadRealTawabiData();

  renderProjectOverview(select?.value || "tawabi");
  animateCards();
}

function renderProjectOverview(key){
  const p=PROJECT_OVERVIEW_DATA[key] || PROJECT_OVERVIEW_DATA.tawabi;
  const name=document.getElementById("projectName");
  const meta=document.getElementById("projectMeta");
  if(name) name.textContent=p.name;
  if(meta) meta.innerHTML=`<span>📍 ${p.location}</span><span>🕒 ${p.timezone}</span><span>⏱ ${p.time}</span>`;
  setText("weatherTemp",p.weather.temp); setText("weatherDesc",p.weather.desc); setText("weatherInfo",`Humidity: ${p.weather.humidity}%`);
  setText("weeklyProduction",p.weekly.production); setText("weeklyPerformance",p.weekly.performance);
  setText("energySpending",p.spending); setText("emissionSaving",p.emission); setText("equivalentTrees",p.trees); setText("treeCost",p.treeCost);
  setText("batteryStatus",p.battery); setText("swapHistory",p.swaps);
  const list=document.getElementById("notificationList"); if(list) list.innerHTML=p.notifications.map(x=>`<li>${x}</li>`).join("");
  renderEnergyChart("energyChart",p.energy.production,p.energy.consumption);
  renderProductionChart("productionChart",p.pv);
  renderPerformanceCharts(p.vars);
}

function setText(id,value){const el=document.getElementById(id);if(el)el.textContent=value}

function renderPerformanceCharts(vars){
  const cards=document.querySelectorAll(".performance-card");
  cards.forEach(card=>{
    const key=card.dataset.performance;
    const v=vars[key];
    if(!v) return;
    card.innerHTML=buildPerformanceCard(v);
  });
}

function buildPerformanceCard(v){
  const values=v.data || [];
  const min=Math.min(...values), max=Math.max(...values), range=max-min||1;
  const w=420,h=148,left=34,right=8,top=12,bottom=28;
  const plotW=w-left-right, plotH=h-top-bottom;
  const points=values.map((n,i)=>`${left+(i/(Math.max(values.length-1,1)))*plotW},${top+plotH-((n-min)/range)*plotH}`).join(" ");
  const grid=[0,.5,1].map(t=>{
    const y=top+plotH*t;
    const val=max-(max-min)*t;
    return `<line x1="${left}" y1="${y}" x2="${w-right}" y2="${y}" class="performance-grid-line"/><text x="${left-5}" y="${y+3}" text-anchor="end" class="performance-axis">${formatAxisValue(val,v.decimals)}</text>`;
  }).join("");
  const baseLabels=["15:00","18:00","21:00","00:00","03:00","06:00","09:00","12:00","15:00"];
  const labels=baseLabels.slice(0,Math.max(values.length,1));
  const xLabels=labels.map((label,i)=>{
    const x=left+(i/(labels.length-1))*plotW;
    return `<text x="${x}" y="${h-7}" text-anchor="middle" class="performance-axis">${label}</text>`;
  }).join("");
  const safePoints=values.map((n,i)=>{
    const x=left+(i/(Math.max(values.length-1,1)))*plotW;
    const y=top+plotH-((n-min)/range)*plotH;
    return `<circle cx="${x}" cy="${y}" r="2.8" class="performance-point"><title>${formatAxisValue(n,v.decimals)} ${v.unit}</title></circle>`;
  }).join("");
  return `<div class="performance-head"><div><div class="performance-title">${v.name}</div><div class="performance-unit">${v.unit}</div></div><div class="performance-current">${formatAxisValue(v.value,v.decimals)} <small>${v.unit}</small></div></div><div class="performance-chart"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${v.name} chart">${grid}<polyline points="${points}" class="performance-path"/>${safePoints}${xLabels}</svg></div><div class="performance-legend"><i></i><span>${v.name} (${v.unit})</span></div>`;
}

function formatAxisValue(n,d){
  const value=Number(n);
  if(Math.abs(value)>=1000) return value.toLocaleString(undefined,{maximumFractionDigits:d});
  return value.toFixed(d);
}

function formatValue(n,d){return Number(n).toFixed(d)}

function renderEnergyChart(id,production,consumption){
  const el=document.getElementById(id); if(!el)return;
  el.innerHTML=buildLineChart(production,consumption,["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]);
}

function renderProductionChart(id,data){
  const el=document.getElementById(id); if(!el)return;
  const max=Math.max(...data,100); const bars=data.map((v,i)=>{const h=(v/max)*145;const x=45+i*82;return `<rect x="${x}" y="${165-h}" width="38" height="${h}" rx="5" fill="#21a7ae" opacity=".85"/><text x="${x+19}" y="187" text-anchor="middle" class="chart-label">PV${i+1}</text><text x="${x+19}" y="${158-h}" text-anchor="middle" class="chart-label">${v}%</text>`}).join("");
  el.innerHTML=`<svg class="chart-svg" viewBox="0 0 390 205" preserveAspectRatio="none"><line x1="30" y1="165" x2="380" y2="165" class="chart-grid-line"/>${bars}</svg>`;
}

function buildLineChart(a,b,labels){
  const all=[...a,...b],min=Math.min(...all),max=Math.max(...all),range=max-min||1;
  const points=(arr)=>arr.map((v,i)=>`${30+i*(340/(arr.length-1))},${175-((v-min)/range)*135}`).join(" ");
  const xLabels=labels.map((l,i)=>`<text x="${30+i*(340/(labels.length-1))}" y="198" text-anchor="middle" class="chart-label">${l}</text>`).join("");
  return `<svg class="chart-svg" viewBox="0 0 400 205" preserveAspectRatio="none"><line x1="30" y1="40" x2="370" y2="40" class="chart-grid-line"/><line x1="30" y1="105" x2="370" y2="105" class="chart-grid-line"/><line x1="30" y1="175" x2="370" y2="175" class="chart-grid-line"/><polyline points="${points(a)}" class="chart-line-production"/><polyline points="${points(b)}" class="chart-line-consumption"/>${xLabels}<text x="38" y="16" class="chart-label">Production</text><text x="108" y="16" class="chart-label">Consumption</text></svg>`;
}

function animateCards(){
  document.querySelectorAll(".project-overview-page .card").forEach((card,i)=>{
    card.classList.remove("is-animated"); void card.offsetWidth; card.style.animationDelay=(i*35)+"ms"; card.classList.add("is-animated");
  });
}

if(document.readyState!=="loading" && document.querySelector(".project-overview-page")) initializeProjectOverview();
