// ============================================================
// 360eDash — Activity Log backend (minimal, zero-dependency)
// ------------------------------------------------------------
// Dibuat sesuai permintaan: BUKAN Firebase/Firestore/SQL/Redis/
// localStorage/sessionStorage/IndexedDB. Storage adalah satu file
// JSON (data/activity-logs.json) yang dibaca/ditulis oleh backend
// ini, supaya:
//   - activity bisa dicatat dari browser/device manapun
//   - semua user menembak endpoint yang sama
//   - data tetap ada setelah browser ditutup / server di-restart
//
// Cara menjalankan:
//   node server/server.js
// (tidak butuh "npm install" — hanya modul bawaan Node.js)
//
// Server ini TERPISAH dari cara frontend dijalankan sekarang
// (VSCode Live Server, port 5502). Frontend tetap dijalankan
// seperti biasa; server ini hanya menyediakan API di port lain
// (default 3001) yang dipanggil oleh frontend lewat fetch().
//
// Endpoint:
//   POST /api/activity          -> catat 1 activity baru
//   GET  /api/activity          -> ambil seluruh activity (terbaru dulu)
//   GET  /api/activity/:id      -> ambil 1 activity berdasarkan id
//   POST /api/marketing-events  -> catat 1 mirror event Meta Pixel (storage TERPISAH,
//                                   lihat marketing-pixel-events.json — dipakai oleh
//                                   section "Marketing Analytics" di Activity Log)
//   GET  /api/marketing-events  -> ambil seluruh mirror event Meta Pixel (terbaru dulu)
//   GET  /api/systems           -> ambil seluruh data System Information
//   PUT  /api/systems           -> simpan seluruh data System Information
//   GET  /api/tasks             -> ambil seluruh data Task Maintenance
//   PUT  /api/tasks             -> simpan seluruh data Task Maintenance
//
// IP & Country:
//   - IP klien diambil dari request (getClientIp), BUKAN dari frontend.
//   - IP lokal/privat (::1, 127.0.0.1, 10.x, 192.168.x, dst.) -> country
//     diisi "-" TANPA memanggil ipwho.is sama sekali.
//   - IP publik -> di-lookup ke ipwho.is dari BACKEND (lookupCountry).
//   - Kalau nanti deployment ada di belakang reverse proxy/Vercel, set
//     env var EDASH_TRUST_PROXY=1 supaya getClientIp() membaca IP klien
//     asli dari header X-Forwarded-For / X-Real-IP (lihat komentar di
//     getClientIp). Default-nya OFF supaya header itu tidak bisa
//     dipalsukan klien saat server diakses langsung (mis. saat development).
// ============================================================

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.EDASH_API_PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "activity-logs.json");

// Storage TERPISAH untuk mirror event Meta Pixel (lihat blok
// "MARKETING PIXEL EVENTS MIRROR" di bawah) — sengaja file JSON lain,
// BUKAN activity-logs.json, supaya data Meta Pixel tidak pernah
// tercampur ke tabel Activity Log internal.
const MARKETING_DATA_FILE = path.join(DATA_DIR, "marketing-pixel-events.json");

// Storage untuk System Information (list system + detail + maintenance
// + alarm history), dibaca/ditulis lewat /api/systems. Selalu SATU
// ARRAY UTUH — sama semantik dengan localStorage.setItem yang dulu
// dipakai js/system-information.js.
const SYSTEMS_DATA_FILE = path.join(DATA_DIR, "systems.json");

// ------------------------------------------------------------
// Storage helpers — baca/tulis activity-logs.json dengan aman.
// Penulisan dilakukan lewat file temp lalu di-rename (atomic),
// dan diserialisasikan lewat writeQueue supaya dua request yang
// datang hampir bersamaan tidak saling menimpa (overwrite) satu
// sama lain / merusak isi file.
// ------------------------------------------------------------

function ensureStorage() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, "[]\n", "utf8");
    }
}

function readLogs() {
    ensureStorage();
    try {
        const raw = fs.readFileSync(DATA_FILE, "utf8");
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("[activity-log] Gagal membaca activity-logs.json, memakai array kosong:", err.message);
        return [];
    }
}

let writeQueue = Promise.resolve();

function appendLog(entry) {
    // Serialize semua penulisan lewat satu queue Promise supaya request
    // yang datang bersamaan tetap ditulis satu-satu (tidak overwrite).
    writeQueue = writeQueue.then(() => {
        const logs = readLogs();
        logs.unshift(entry); // terbaru di depan
        const tmpFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(logs, null, 2), "utf8");
        fs.renameSync(tmpFile, DATA_FILE); // rename = atomic di filesystem yang sama
        return entry;
    });
    return writeQueue;
}

// ------------------------------------------------------------
// MARKETING PIXEL EVENTS MIRROR — storage KHUSUS, terpisah total
// dari activity-logs.json.
// ------------------------------------------------------------
// LATAR BELAKANG / AUDIT (lihat juga js/marketing-pixel-client.js):
// Meta Pixel (fbq) yang sudah terpasang di pages/solar-calculator.html
// hanya mengirim event SATU ARAH ke server Meta (Ads Manager/Events
// Manager). Tidak ada Graph API / Conversions API / access token yang
// dikonfigurasi di proyek ini, sehingga dashboard TIDAK PUNYA cara
// untuk membaca balik data agregat dari Meta (jumlah visitor, funnel,
// dsb. yang "resmi"). Mengarang angka itu dilarang.
//
// Pendekatan yang dipakai: setiap kali kode Solar Calculator memanggil
// fbq(...) untuk mengirim event ke Meta, ia JUGA mengirim satu event
// "mirror" berisi nama event + parameter yang sama ke endpoint di
// bawah ini (lihat trackMarketingEvent() di
// js/marketing-pixel-client.js, dipanggil tepat di sebelah setiap
// fbq(...) yang sudah ada — implementasi Pixel itu sendiri tidak
// disentuh/diubah). Hasilnya: data 100% nyata (event yang benar-benar
// terjadi & benar-benar terkirim ke Meta), hanya saja sumber baca-nya
// server kita sendiri, bukan Meta Ads Manager. Keterbatasan ini
// dijelaskan ke pengguna di modal "View Details" pada section
// Marketing Analytics.
// ------------------------------------------------------------

function ensureMarketingStorage() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(MARKETING_DATA_FILE)) {
        fs.writeFileSync(MARKETING_DATA_FILE, "[]\n", "utf8");
    }
}

function readMarketingEvents() {
    ensureMarketingStorage();
    try {
        const raw = fs.readFileSync(MARKETING_DATA_FILE, "utf8");
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("[marketing-analytics] Gagal membaca marketing-pixel-events.json, memakai array kosong:", err.message);
        return [];
    }
}

let marketingWriteQueue = Promise.resolve();

function appendMarketingEvent(entry) {
    marketingWriteQueue = marketingWriteQueue.then(() => {
        const events = readMarketingEvents();
        events.unshift(entry);
        const tmpFile = `${MARKETING_DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(events, null, 2), "utf8");
        fs.renameSync(tmpFile, MARKETING_DATA_FILE);
        return entry;
    });
    return marketingWriteQueue;
}

// ------------------------------------------------------------
// SYSTEM INFORMATION — storage terpisah, selalu dibaca/ditulis
// sebagai satu array utuh (bukan append-only seperti activity log).
// ------------------------------------------------------------

function ensureSystemsStorage() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(SYSTEMS_DATA_FILE)) {
        fs.writeFileSync(SYSTEMS_DATA_FILE, "[]\n", "utf8");
    }
}

function readSystems() {
    ensureSystemsStorage();
    try {
        const raw = fs.readFileSync(SYSTEMS_DATA_FILE, "utf8");
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("[system-information] Gagal membaca systems.json, memakai array kosong:", err.message);
        return [];
    }
}

let systemsWriteQueue = Promise.resolve();

function writeSystems(systems) {
    systemsWriteQueue = systemsWriteQueue.then(() => {
        const tmpFile = `${SYSTEMS_DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(systems, null, 2), "utf8");
        fs.renameSync(tmpFile, SYSTEMS_DATA_FILE);
        return systems;
    });
    return systemsWriteQueue;
}

// ------------------------------------------------------------
// TASK MAINTENANCE — storage TERPISAH dari systems.json, khusus
// untuk state pekerjaan teknisi di halaman Task Maintenance
// (status pending/accepted/completed, progress %, progressNote,
// acceptedAt, submission { description, photos, itemsPurchased,
// submittedAt }).
//
// SENGAJA dipisah dari systems.json (bukan numpang di field
// futureMaintenance) supaya scalable: kalau nanti mau ganti storage
// task jadi database/queue sendiri, atau task punya siklus hidup/izin
// akses beda dari data system, tinggal ganti file/handler ini saja
// tanpa mengubah skema systems.json sama sekali.
//
// Tiap task tetap membawa referensi ke unit & jadwal aslinya lewat
// unitId + futureId (id dari entry di sys.futureMaintenance, lihat
// js/system-information.js genMaintId()) — BUKAN index array, supaya
// tidak rusak kalau array futureMaintenance diedit/dihapus dari
// halaman lain.
// ------------------------------------------------------------

const TASKS_DATA_FILE = path.join(DATA_DIR, "tasks.json");

function ensureTasksStorage() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(TASKS_DATA_FILE)) {
        fs.writeFileSync(TASKS_DATA_FILE, "[]\n", "utf8");
    }
}

function readTasks() {
    ensureTasksStorage();
    try {
        const raw = fs.readFileSync(TASKS_DATA_FILE, "utf8");
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("[task-maintenance] Gagal membaca tasks.json, memakai array kosong:", err.message);
        return [];
    }
}

let tasksWriteQueue = Promise.resolve();

function writeTasks(tasks) {
    tasksWriteQueue = tasksWriteQueue.then(() => {
        const tmpFile = `${TASKS_DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpFile, JSON.stringify(tasks, null, 2), "utf8");
        fs.renameSync(tmpFile, TASKS_DATA_FILE);
        return tasks;
    });
    return tasksWriteQueue;
}

// Event Pixel yang benar-benar dikirim oleh pages/solar-calculator.html
// / js/solar-calculator.js (lihat masing-masing pemanggilan fbq(...)
// di file itu). Hanya nama-nama ini yang diterima — mencegah data
// acak/tidak terkait Pixel ikut masuk ke storage ini.
const ALLOWED_MARKETING_EVENT_TYPES = new Set([
    "PageView",                        // fbq('track','PageView') — inline script di solar-calculator.html
    "ViewContent",                     // fbq('track','ViewContent') — klik "Calculate Estimate"
    "SolarCalculatorCalculate",        // fbq('trackCustom', ...) — sama momen dgn ViewContent di atas
    "SolarCalculatorInputChange",      // fbq('trackCustom', ...) — tiap field kalkulator diisi/diubah
    "SolarCalculatorBatteryScenario",  // fbq('trackCustom', ...) — toggle skenario baterai
    "Lead",                            // fbq('track','Lead') — submit email untuk unlock hasil
]);

// ------------------------------------------------------------
// IP geolocation — ipwho.is, dipanggil dari BACKEND (bukan dari
// frontend), sesuai instruksi. Kalau gagal/timeout, jangan
// mengarang negara — fallback aman "-".
// ------------------------------------------------------------

function lookupCountry(ip) {
    return new Promise((resolve) => {

        // IP lokal/private tidak bisa di-geolocate — langsung fallback,
        // tidak perlu memanggil ipwho.is sama sekali.
        if (!ip || isPrivateOrLocalIp(ip)) {
            resolve({ country: "-", countryCode: "-" });
            return;
        }

        const req = https.get(`https://ipwho.is/${encodeURIComponent(ip)}`, { timeout: 4000 }, (res) => {
            let body = "";
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => {
                try {
                    const json = JSON.parse(body);
                    if (json && json.success !== false && json.country) {
                        resolve({ country: json.country, countryCode: json.country_code || "-" });
                    } else {
                        resolve({ country: "-", countryCode: "-" });
                    }
                } catch (err) {
                    resolve({ country: "-", countryCode: "-" });
                }
            });
        });

        req.on("timeout", () => { req.destroy(); resolve({ country: "-", countryCode: "-" }); });
        req.on("error", () => { resolve({ country: "-", countryCode: "-" }); });

    });
}

function normalizeIp(ip) {
    // Node menulis alamat IPv4 klien sebagai "::ffff:x.x.x.x" (IPv4-mapped
    // IPv6) saat server listen dual-stack — dibersihkan supaya yang
    // tersimpan & dibandingkan konsisten "127.0.0.1", bukan "::ffff:127.0.0.1".
    return String(ip || "").trim().replace(/^::ffff:/i, "");
}

function isPrivateOrLocalIp(ip) {
    const clean = normalizeIp(ip);
    if (!clean || clean === "-") return true;
    return (
        clean === "::1" ||
        clean.startsWith("127.") ||               // loopback IPv4 (127.0.0.0/8)
        clean.startsWith("10.") ||                 // private IPv4
        clean.startsWith("192.168.") ||             // private IPv4
        clean.startsWith("169.254.") ||             // link-local IPv4
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(clean) || // private IPv4 (172.16.0.0/12)
        /^f[cd][0-9a-f]{2}:/i.test(clean) ||        // IPv6 unique local (fc00::/7)
        /^fe80:/i.test(clean)                        // IPv6 link-local
    );
}

// Diaktifkan lewat env var EDASH_TRUST_PROXY=1 hanya ketika backend ini
// benar-benar dijalankan DI BELAKANG reverse proxy tepercaya (mis. Vercel,
// Nginx, load balancer) yang MENIMPA header X-Forwarded-For/X-Real-IP
// dengan IP klien asli sebelum permintaan sampai ke sini.
//
// Kalau diaktifkan padahal server diakses langsung (seperti sekarang, saat
// development), siapa pun bisa memalsukan IP-nya sendiri hanya dengan
// mengirim header "X-Forwarded-For: 1.2.3.4" — makanya default-nya OFF,
// dan getClientIp() HANYA membaca header tsb saat env var ini eksplisit
// di-set ke "1"/"true".
const TRUST_PROXY = process.env.EDASH_TRUST_PROXY === "1" || process.env.EDASH_TRUST_PROXY === "true";

function getClientIp(req) {

    if (TRUST_PROXY) {
        // X-Forwarded-For: "client, proxy1, proxy2, ...". Entry paling kiri
        // = klien asli, SELAMA proxy di depan kita adalah proxy tepercaya
        // tunggal yang menulis ulang header ini (bukan meneruskan apa
        // adanya dari klien) — itulah asumsi di balik TRUST_PROXY di atas.
        const forwarded = req.headers["x-forwarded-for"];
        if (forwarded) {
            const first = String(forwarded).split(",")[0].trim();
            if (first) return normalizeIp(first);
        }
        // Fallback umum di beberapa platform/proxy (mis. Nginx, beberapa
        // edge network) yang menyertakan X-Real-IP selain X-Forwarded-For.
        const realIp = req.headers["x-real-ip"];
        if (realIp) return normalizeIp(realIp);
    }

    // Default (TRUST_PROXY off, atau tidak ada header proxy): pakai IP
    // koneksi TCP langsung — satu-satunya sumber yang tidak bisa
    // dipalsukan klien.
    return normalizeIp(req.socket.remoteAddress) || "-";
}

// ------------------------------------------------------------
// Device/browser parsing dari User-Agent header (sederhana,
// cukup untuk kolom "Perangkat & IP" — meniru format yang
// sebelumnya dipakai dummy data, mis. "Chrome · Windows").
// ------------------------------------------------------------

function parseDevice(userAgent) {
    const ua = userAgent || "";

    let browser = "Unknown Browser";
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\//.test(ua)) browser = "Opera";
    else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = "Safari";
    else if (ua) browser = "Browser";

    let os = "Unknown OS";
    if (/Windows/.test(ua)) os = "Windows";
    else if (/Mac OS X/.test(ua)) os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : "macOS";
    else if (/Android/.test(ua)) os = "Android";
    else if (/Linux/.test(ua)) os = "Linux";
    else if (ua) os = "Unknown OS";

    if (!ua) return "-";
    return `${browser} · ${os}`;
}

// ------------------------------------------------------------
// HTTP helpers
// ------------------------------------------------------------

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        // CORS: server ini sengaja terpisah dari frontend (port beda),
        // jadi butuh CORS terbuka untuk dipanggil dari halaman dashboard.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(body);
}

// 204 No Content TIDAK BOLEH punya body (RFC 9110). Dipakai khusus untuk
// menjawab CORS preflight (OPTIONS). Sebelumnya preflight ini salah
// dijawab lewat sendJson() yang menyertakan body "{}" + Content-Length
// di atas status 204 — beberapa browser (terutama Chrome) menganggap
// response semacam ini gagal/aneh dan MEMBATALKAN request POST
// sesungguhnya secara diam-diam, sehingga logActivity() dari frontend
// tidak pernah benar-benar sampai ke backend meskipun tidak error di UI.
function sendNoContent(res) {
    res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        let size = 0;
        const MAX_BYTES = 2 * 1024 * 1024; // 2MB cukup untuk payload activity

        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
                reject(new Error("Payload too large"));
                req.destroy();
                return;
            }
            data += chunk;
        });

        req.on("end", () => {
            if (!data) { resolve({}); return; }
            try {
                resolve(JSON.parse(data));
            } catch (err) {
                reject(new Error("Invalid JSON body"));
            }
        });

        req.on("error", reject);
    });
}

// ------------------------------------------------------------
// Validasi eventType yang diperbolehkan — mencegah data acak
// masuk ke activity-logs.json.
// ------------------------------------------------------------

const ALLOWED_EVENT_TYPES = new Set([
    "login",
    "logout",
    "admin_calculator",
    "admin_calculator_export",
    "calculator_calculate",
    "calculator_export",
    "project_report_export",
    "page_visit",
    "language_switch",
]);

// ------------------------------------------------------------
// Route handlers
// ------------------------------------------------------------

async function handleCreateActivity(req, res) {

    let body;
    try {
        body = await readBody(req);
    } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
    }

    const { eventType, user, userRole, status, detail, data } = body || {};

    if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
        sendJson(res, 400, { error: "eventType tidak valid atau tidak diperbolehkan." });
        return;
    }

    if (status !== "success" && status !== "failed") {
        sendJson(res, 400, { error: "status harus 'success' atau 'failed'." });
        return;
    }

    const ip = getClientIp(req);
    const { country, countryCode } = await lookupCountry(ip);
    const device = parseDevice(req.headers["user-agent"]);

    const entry = {
        id: crypto.randomUUID(),
        eventType,
        timestamp: new Date().toISOString(),
        user: (user && String(user).trim()) || "Anonymous",
        userRole: userRole || null,
        status,
        detail: detail || "",
        country,
        countryCode,
        ip,
        device,
        data: data && typeof data === "object" ? data : {},
    };

    try {
        await appendLog(entry);
        sendJson(res, 201, entry);
    } catch (err) {
        console.error("[activity-log] Gagal menyimpan activity:", err);
        sendJson(res, 500, { error: "Gagal menyimpan activity ke storage." });
    }

}

function handleListActivity(req, res) {
    const logs = readLogs();
    sendJson(res, 200, logs);
}

function handleGetActivityById(req, res, id) {
    const logs = readLogs();
    const found = logs.find((l) => l.id === id);
    if (!found) {
        sendJson(res, 404, { error: "Activity tidak ditemukan." });
        return;
    }
    sendJson(res, 200, found);
}

// ------------------------------------------------------------
// Route handlers — Marketing Pixel Events mirror (lihat blok
// storage di atas). Endpoint ini SENGAJA punya bentuk & alur yang
// mirip /api/activity supaya konsisten, tapi ditulis ke file JSON
// yang berbeda (marketing-pixel-events.json), bukan activity-logs.json.
// ------------------------------------------------------------

async function handleCreateMarketingEvent(req, res) {

    let body;
    try {
        body = await readBody(req);
    } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
    }

    const { eventName, sessionId, detail, data } = body || {};

    if (!eventName || !ALLOWED_MARKETING_EVENT_TYPES.has(eventName)) {
        sendJson(res, 400, { error: "eventName tidak valid atau bukan event Meta Pixel yang dikenal." });
        return;
    }

    const ip = getClientIp(req);
    const { country, countryCode } = await lookupCountry(ip);

    const entry = {
        id: crypto.randomUUID(),
        eventName,
        timestamp: new Date().toISOString(),
        // sessionId: id acak per-browser-tab (sessionStorage), dipakai HANYA
        // untuk menghitung "visitor unik" secara kasar — bukan identitas
        // pribadi, tidak bisa ditelusuri balik ke individu.
        sessionId: (sessionId && String(sessionId).trim()) || null,
        detail: detail || "",
        country,
        countryCode,
        data: data && typeof data === "object" ? data : {},
    };

    try {
        await appendMarketingEvent(entry);
        sendJson(res, 201, entry);
    } catch (err) {
        console.error("[marketing-analytics] Gagal menyimpan marketing event:", err);
        sendJson(res, 500, { error: "Gagal menyimpan marketing event ke storage." });
    }

}

function handleListMarketingEvents(req, res) {
    const events = readMarketingEvents();
    sendJson(res, 200, events);
}

// ------------------------------------------------------------
// Route handlers — System Information
// ------------------------------------------------------------

function handleListSystems(req, res) {
    const systems = readSystems();
    sendJson(res, 200, systems);
}

async function handleReplaceSystems(req, res) {
    let body;
    try {
        body = await readBody(req);
    } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
    }

    if (!Array.isArray(body)) {
        sendJson(res, 400, { error: "Body harus berupa array system." });
        return;
    }

    const invalidIndex = body.findIndex((s) => !s || typeof s !== "object" || typeof s.id !== "string" || !s.id.trim());
    if (invalidIndex !== -1) {
        sendJson(res, 400, { error: `Entry ke-${invalidIndex} tidak punya "id" (string) yang valid.` });
        return;
    }

    try {
        await writeSystems(body);
        sendJson(res, 200, body);
    } catch (err) {
        console.error("[system-information] Gagal menyimpan systems.json:", err);
        sendJson(res, 500, { error: "Gagal menyimpan data System Information ke storage." });
    }
}

// ------------------------------------------------------------
// Route handlers — Task Maintenance
// ------------------------------------------------------------

function handleListTasks(req, res) {
    const tasks = readTasks();
    sendJson(res, 200, tasks);
}

async function handleReplaceTasks(req, res) {
    let body;
    try {
        body = await readBody(req);
    } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
    }

    if (!Array.isArray(body)) {
        sendJson(res, 400, { error: "Body harus berupa array task." });
        return;
    }

    const invalidIndex = body.findIndex((t) => !t || typeof t !== "object" || typeof t.id !== "string" || !t.id.trim());
    if (invalidIndex !== -1) {
        sendJson(res, 400, { error: `Entry ke-${invalidIndex} tidak punya "id" (string) yang valid.` });
        return;
    }

    try {
        await writeTasks(body);
        sendJson(res, 200, body);
    } catch (err) {
        console.error("[task-maintenance] Gagal menyimpan tasks.json:", err);
        sendJson(res, 500, { error: "Gagal menyimpan data Task Maintenance ke storage." });
    }
}

// ------------------------------------------------------------
// Router
// ------------------------------------------------------------

const server = http.createServer(async (req, res) => {

    // Preflight CORS
    if (req.method === "OPTIONS") {
        sendNoContent(res);
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const segments = url.pathname.split("/").filter(Boolean); // ["api", "activity", ":id"?]

    try {

        if (req.method === "POST" && url.pathname === "/api/activity") {
            await handleCreateActivity(req, res);
            return;
        }

        if (req.method === "GET" && url.pathname === "/api/activity") {
            handleListActivity(req, res);
            return;
        }

        if (req.method === "GET" && segments[0] === "api" && segments[1] === "activity" && segments[2]) {
            handleGetActivityById(req, res, decodeURIComponent(segments[2]));
            return;
        }

        if (req.method === "POST" && url.pathname === "/api/marketing-events") {
            await handleCreateMarketingEvent(req, res);
            return;
        }

        if (req.method === "GET" && url.pathname === "/api/marketing-events") {
            handleListMarketingEvents(req, res);
            return;
        }

        if (req.method === "GET" && url.pathname === "/api/systems") {
            handleListSystems(req, res);
            return;
        }

        if (req.method === "PUT" && url.pathname === "/api/systems") {
            await handleReplaceSystems(req, res);
            return;
        }

        if (req.method === "GET" && url.pathname === "/api/tasks") {
            handleListTasks(req, res);
            return;
        }

        if (req.method === "PUT" && url.pathname === "/api/tasks") {
            await handleReplaceTasks(req, res);
            return;
        }

        if (req.method === "GET" && url.pathname === "/api/health") {
            sendJson(res, 200, { status: "ok" });
            return;
        }

        sendJson(res, 404, { error: "Not found" });

    } catch (err) {
        console.error("[activity-log] Unexpected error:", err);
        sendJson(res, 500, { error: "Internal server error" });
    }

});

server.listen(PORT, () => {
    ensureStorage();
    ensureMarketingStorage();
    ensureSystemsStorage();
    ensureTasksStorage();
    console.log(`[activity-log] Backend jalan di http://localhost:${PORT}`);
    console.log(`[activity-log] Storage: ${DATA_FILE}`);
    console.log(`[marketing-analytics] Storage: ${MARKETING_DATA_FILE}`);
    console.log(`[system-information] Storage: ${SYSTEMS_DATA_FILE}`);
    console.log(`[task-maintenance] Storage: ${TASKS_DATA_FILE}`);
});