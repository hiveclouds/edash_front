// ============================================================
// Konfigurasi base URL untuk backend eDash.
// ------------------------------------------------------------
// ADA 2 BACKEND BERBEDA, jangan tertukar:
//
// 1. EDASH_BACKEND_API_BASE -> Backend Hono (edashboard_api),
//    urus Auth, Devices, Telemetry, Projects, Systems, dst.
//    Di production, di-proxy nginx lewat path /api/v1/ ke
//    container port 3005 (lihat konfigurasi nginx di VPS).
//    Karena proxy-nya same-origin (satu domain sama dengan
//    frontend), cukup path relatif "/api/v1" -- TIDAK perlu
//    tulis domain penuh, browser otomatis pakai origin
//    halaman yang lagi dibuka.
//
// 2. EDASH_API_BASE -> Backend Node.js lama (server/server.js),
//    urus Activity Log, Marketing Pixel, System Information,
//    Tasks (sebelum semuanya pindah ke Postgres). Di production
//    di-proxy nginx lewat path /api/ ke container port 3001.
//
// Untuk dev lokal (buka file langsung / Live Server), override
// window.EDASH_BACKEND_API_BASE / window.EDASH_API_BASE SEBELUM
// file ini di-load kalau backend-nya jalan di port/host lain.
// ============================================================

window.EDASH_BACKEND_API_BASE = window.EDASH_BACKEND_API_BASE || "/api/v1";
window.EDASH_API_BASE = window.EDASH_API_BASE || "/api";

// ------------------------------------------------------------
// edashApiFetch(path, options) — helper fetch terpusat ke Core API
// (EDASH_BACKEND_API_BASE, backend Hono + PostgreSQL + ThingsBoard).
//
// - selalu credentials: 'include' supaya cookie session_token ikut
// - selalu Content-Type: application/json kalau ada body
// - selalu parse body JSON standar { success, data } / { success, error }
// - kalau success !== true, throw Error dengan .message + .code + .status
// - kalau HTTP 401 (UNAUTHORIZED), redirect otomatis ke halaman login
// - TIMEOUT 20 detik (bisa di-override lewat options.timeoutMs) --
//   sebelumnya fetch() di sini nggak punya batas waktu sama sekali, jadi
//   kalau backend/ThingsBoard nge-hang, halaman ikut nge-hang tanpa
//   batas & tanpa pesan error yang jelas ke user. Sekarang request yang
//   ngegantung lebih dari batas waktu di-abort otomatis dan throw error
//   yang jelas ("Request timeout...").
// ------------------------------------------------------------
async function edashApiFetch(path, options = {}) {
    const url = `${window.EDASH_BACKEND_API_BASE}${path}`;
    const { timeoutMs = 20000, ...restOptions } = options;

    // FIX (ticketing file upload, 2026-08-26): jangan paksa
    // "Content-Type: application/json" kalau body-nya FormData (dipakai
    // create ticket sekarang, karena attachment wajib & bisa berupa
    // video sampai 25MB x 10 file -- lihat js/ticketing.js). Browser
    // WAJIB yang generate Content-Type multipart/form-data sendiri
    // (butuh boundary unik yang di-generate saat itu juga); kalau kita
    // override manual jadi application/json, body multipart-nya jadi
    // tidak bisa di-parse backend sama sekali.
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

    const finalOptions = {
        credentials: "include",
        ...restOptions,
        headers: {
            ...(isFormData ? {} : { "Content-Type": "application/json" }),
            ...(options.headers || {}),
        },
    };

    const controller = new AbortController();
    // Kalau caller sudah bawa signal sendiri (mis. mau cancel manual),
    // hormati itu juga -- abort kalau salah satu (timeout ATAU signal
    // caller) trigger duluan.
    const callerSignal = options.signal;
    if (callerSignal) {
        if (callerSignal.aborted) controller.abort();
        else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    finalOptions.signal = controller.signal;

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
        res = await fetch(url, finalOptions);
    } catch (err) {
        if (err.name === "AbortError" && !(callerSignal && callerSignal.aborted)) {
            const timeoutErr = new Error(`Request timeout setelah ${Math.round(timeoutMs / 1000)} detik: ${path}`);
            timeoutErr.code = "REQUEST_TIMEOUT";
            throw timeoutErr;
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }

    let body = null;
    try {
        body = await res.json();
    } catch (_) {
        // Response tanpa body JSON (mis. 204 No Content) -> biarkan null
    }

    if (res.status === 401) {
        if (!window.location.pathname.includes("login.html")) {
            window.location.href = "/pages/login.html";
        }
    }

    // 2xx TANPA body (mis. 204 No Content) -> ini SUKSES, bukan error --
    // sebelumnya body === null selalu jatuh ke cabang error di bawah
    // ("Request gagal (HTTP 204)") walau requestnya sebenarnya berhasil.
    if (res.ok && body === null) {
        return null;
    }

    if (!body || body.success !== true) {
        const message = body?.error?.message || `Request gagal (HTTP ${res.status})`;
        const err = new Error(message);
        err.code = body?.error?.code || null;
        err.status = res.status;
        throw err;
    }

    return body.data;
}
window.edashApiFetch = edashApiFetch;
