// ============================================================
// Marketing Analytics — mirror event Meta Pixel (client-side helper)
// ------------------------------------------------------------
// AUDIT SINGKAT (lihat juga js/marketing-analytics.js): Meta Pixel
// (fbq) di pages/solar-calculator.html hanya mengirim data SATU ARAH
// ke server Meta — dashboard ini tidak punya Graph API/Conversions
// API/access token untuk membaca balik data agregat dari Meta Ads
// Manager. Supaya section "Marketing Analytics" tetap bisa menampilkan
// angka NYATA (bukan dummy), setiap event yang berhasil dikirim ke
// fbq(...) juga dikirim ke sini.
//
// Endpoint ini menembak backend Hono + PostgreSQL (edashboard_api,
// EDASH_BACKEND_API_BASE) lewat edashApiFetch(), ke tabel
// marketing_pixel_events -- TERPISAH TOTAL dari activity_logs.
//
// trackMarketingEvent() TIDAK PERNAH mengubah/menggantikan pemanggilan
// fbq(...) yang sudah ada — ia hanya dipanggil TEPAT DI SEBELAHNYA,
// dengan nama event & parameter yang sama, sebagai catatan tambahan.
// Sama seperti logActivity(), fungsi ini fire-and-forget dan menelan
// error-nya sendiri supaya gagal terhubung ke backend tidak pernah
// mengganggu flow kalkulator/Pixel yang sudah berjalan. POST
// /marketing-pixel-events tetap endpoint PUBLIC di backend (halaman
// solar-calculator.html bisa diakses sebelum login).
// ============================================================

// Id acak per tab/sesi browser — HANYA dipakai untuk mengelompokkan
// event "visitor unik" secara kasar di dashboard (mis. berapa banyak
// sesi berbeda yang menekan "Calculate Estimate"). Bukan data pribadi,
// tidak terhubung ke email/nama, dan tidak dikirim ke Meta.
function getMarketingSessionId() {
    const key = "edash-marketing-session-id";
    try {
        let id = sessionStorage.getItem(key);
        if (!id) {
            id = (crypto.randomUUID && crypto.randomUUID()) ||
                `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            sessionStorage.setItem(key, id);
        }
        return id;
    } catch (err) {
        // sessionStorage tidak tersedia (mis. private mode) — tetap
        // jalan, hanya saja tanpa pengelompokan sesi.
        return null;
    }
}

async function trackMarketingEvent(eventName, data = {}, detail = "") {

    try {

        return await edashApiFetch("/marketing-pixel-events", {
            method: "POST",
            body: JSON.stringify({
                eventName,
                sessionId: getMarketingSessionId(),
                detail,
                data: data || {},
            }),
        });

    } catch (err) {
        // Backend belum jalan / tidak terjangkau — jangan sampai
        // mengganggu Pixel/kalkulator yang sedang berjalan.
        console.warn(`[marketing-analytics] Gagal mengirim event "${eventName}":`, err.message);
        return null;
    }

}
