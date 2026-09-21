// ============================================================
// Stale-while-revalidate helper (js/stale-cache.js)
//
// Dipakai halaman yang datanya lambat diambil (Dashboard, Project
// Monitoring/Detail, Battery Station -- semua yang narik telemetry dari
// ThingsBoard). Bukan solusi buat lambatnya sendiri (itu ada di sisi
// backend/ThingsBoard, lihat catatan di thingsboard.service.ts &
// project.service.ts) -- ini murni PERSEPSI: begitu halaman dibuka lagi,
// tampilkan data TERAKHIR yang berhasil diambil (instan, dari
// sessionStorage) sambil data baru diambil di belakang layar, alih-alih
// blank/spinner sampai fetch selesai.
//
// Dipasang di halaman lewat window.EdashStaleCache & window.EdashUpdatingBanner.
// ============================================================

(function () {

    const PREFIX = "edash-stale-cache:";

    // ------------------------------------------------------------
    // Cache data per key (mis. "dashboard:overview",
    // "project-detail:<projectId>", "battery:<projectId>")
    // ------------------------------------------------------------
    function get(key) {
        try {
            const raw = sessionStorage.getItem(PREFIX + key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || !("data" in parsed)) return null;
            return parsed; // { data, savedAt }
        } catch (err) {
            return null;
        }
    }

    function set(key, data) {
        try {
            sessionStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }));
        } catch (err) {
            // Kuota sessionStorage penuh atau data nggak bisa di-JSON.stringify
            // (mis. ada fungsi/DOM node ikut ke-pass) -- ini cuma optimisasi
            // persepsi, aman diabaikan kalau gagal, jangan sampai bikin
            // halaman ikut error gara-gara ini.
            console.warn("[stale-cache] Gagal simpan cache untuk", key, err);
        }
    }

    function clear(key) {
        try {
            sessionStorage.removeItem(PREFIX + key);
        } catch (err) {
            // no-op
        }
    }

    // ------------------------------------------------------------
    // Banner "sedang update" -- pita tipis, TIDAK menutupi konten
    // (position: sticky di dalam container yang dikasih caller), jadi
    // data lama tetap keliatan & bisa diinteraksi selagi data baru
    // diambil di belakang layar.
    // ------------------------------------------------------------
    const BANNER_ID_PREFIX = "edashStaleBanner__";

    function ensureBannerStyle() {
        if (document.getElementById("edashStaleBannerStyle")) return;
        const style = document.createElement("style");
        style.id = "edashStaleBannerStyle";
        style.textContent = `
            .edash-stale-banner {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 14px;
                margin-bottom: 12px;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 500;
                position: sticky;
                top: 0;
                z-index: 20;
                background: #EEF6F6;
                color: #0F6A71;
                border: 1px solid #CFE8E9;
                transition: opacity 0.25s ease;
            }
            .edash-stale-banner.is-error {
                background: #FDEEEE;
                color: #A33;
                border-color: #F3D0D0;
            }
            .edash-stale-banner.is-fading { opacity: 0; }
            .edash-stale-banner .edash-stale-spinner {
                width: 13px;
                height: 13px;
                border-radius: 50%;
                border: 2px solid rgba(15,106,113,0.25);
                border-top-color: #0F6A71;
                animation: edashStaleSpin 0.7s linear infinite;
                flex-shrink: 0;
            }
            .edash-stale-banner.is-error .edash-stale-spinner { display: none; }
            @keyframes edashStaleSpin { to { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);
    }

    function resolveContainer(container) {
        if (typeof container === "string") return document.querySelector(container);
        return container || null;
    }

    // show(container, key, message) -- munculin pita "lagi update" di
    // paling atas container. `key` dipakai supaya kalau dipanggil 2x
    // untuk container yang sama, banner lama diganti bukan ditumpuk.
    function show(container, key, message) {
        const el = resolveContainer(container);
        if (!el) return;
        ensureBannerStyle();

        hide(container, key, { immediate: true });

        const banner = document.createElement("div");
        banner.id = BANNER_ID_PREFIX + key;
        banner.className = "edash-stale-banner";
        banner.innerHTML = `
            <span class="edash-stale-spinner"></span>
            <span>${message || "Memperbarui data..."}</span>
        `;
        el.prepend(banner);
    }

    // hideOk(container, key) -- fetch baru selesai sukses, ilangin pita
    // pelan-pelan (fade out).
    function hideOk(container, key) {
        hide(container, key, { immediate: false });
    }

    // showError(container, key, message) -- fetch baru GAGAL. Data lama
    // (yang sudah ditampilkan dari cache) TETAP dibiarkan keliatan --
    // banner cuma ganti jadi peringatan singkat lalu hilang sendiri,
    // BUKAN menghapus/mengosongkan konten yang sudah ada.
    function showError(container, key, message) {
        const el = resolveContainer(container);
        if (!el) return;
        ensureBannerStyle();

        const existing = document.getElementById(BANNER_ID_PREFIX + key);
        const banner = existing || document.createElement("div");
        banner.id = BANNER_ID_PREFIX + key;
        banner.className = "edash-stale-banner is-error";
        banner.innerHTML = `<span>${message || "Gagal memperbarui data, menampilkan data terakhir."}</span>`;
        if (!existing) el.prepend(banner);

        setTimeout(() => hide(container, key, { immediate: false }), 4000);
    }

    function hide(container, key, opts) {
        const banner = document.getElementById(BANNER_ID_PREFIX + key);
        if (!banner) return;
        if (opts && opts.immediate) {
            banner.remove();
            return;
        }
        banner.classList.add("is-fading");
        setTimeout(() => banner.remove(), 260);
    }

    window.EdashStaleCache = { get, set, clear };
    window.EdashUpdatingBanner = { show, hideOk, showError };

})();
