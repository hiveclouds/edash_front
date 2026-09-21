// ============================================================
// Activity Log — client-side helper terpusat
// ------------------------------------------------------------
// Satu fungsi, logActivity(eventData), dipanggil dari SETIAP
// titik event nyata di aplikasi (login, logout, admin calculator,
// solar calculator, export report) supaya semua page memakai
// mekanisme logging yang sama menuju satu backend + satu storage
// terpusat.
//
// Endpoint ini menembak backend Hono + PostgreSQL (edashboard_api,
// EDASH_BACKEND_API_BASE) lewat edashApiFetch().
//
// Dipanggil HANYA setelah action yang bersangkutan benar-benar
// berhasil (atau, khusus login, juga saat gagal — supaya percobaan
// login yang gagal tetap tercatat sebagai "failed", bukan dihapus
// begitu saja).
//
// Gagal terhubung ke backend TIDAK BOLEH mengganggu flow existing
// (login/kalkulasi/export tetap jalan seperti biasa) — makanya
// fungsi ini menelan error-nya sendiri (fire-and-forget, aman
// untuk dipanggil tanpa await). POST /activity-log tetap endpoint
// PUBLIC di backend (tidak butuh session login), sama seperti
// sebelumnya, karena event login/page_visit/language_switch bisa
// terjadi sebelum user punya session.
// ============================================================

async function logActivity({ eventType, user, userRole, status, detail, data }) {

    try {

        return await edashApiFetch("/activity-log", {
            method: "POST",
            body: JSON.stringify({
                eventType,
                user: user || "Anonymous",
                userRole: userRole || null,
                status: status || "success",
                detail: detail || "",
                data: data || {},
            }),
        });

    } catch (err) {
        // Backend belum jalan / tidak terjangkau — jangan sampai
        // mengganggu action yang sedang berjalan (login, kalkulasi,
        // export, dll). Cukup catat di console untuk developer.
        console.warn(`[activity-log] Gagal mengirim activity "${eventType}":`, err.message);
        return null;
    }

}
