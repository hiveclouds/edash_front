// ============================================================
// Loading bar overlay (js/loading-bar.js)
//
// Beda tujuan dari js/stale-cache.js:
// - stale-cache.js -> ada data LAMA yang sudah ditampilkan, backend
//   lagi ambil data baru diam-diam di belakang layar (pita tipis, non-
//   blocking, konten lama tetap kelihatan).
// - loading-bar.js (file ini) -> BELUM ADA apapun buat ditampilkan
//   (kunjungan pertama / cache kosong), jadi user butuh tahu halaman
//   ini SEDANG memuat, bukan cuma diam nunjukin 0/kosong. Overlay
//   penuh, di tengah container, dengan progress bar.
//
// Progress bar-nya SIMULASI (bukan persentase asli dari network) --
// fetch biasa tidak punya cara akurat mengukur "berapa persen lagi",
// jadi dipakai pola umum: isi cepat ke ~90%, macet di situ selama
// masih menunggu, lalu begitu data BENERAN selesai, lompat ke 100% dan
// overlay-nya hilang. Ini pola yang sama dipakai YouTube/GitHub dkk.
//
// Dipasang lewat window.EdashLoadingBar.show(container, key, message)
// dan .done(container, key).
// ============================================================

(function () {

    const OVERLAY_ID_PREFIX = "edashLoadingBar__";
    const timers = {};

    function ensureStyle() {
        if (document.getElementById("edashLoadingBarStyle")) return;
        const style = document.createElement("style");
        style.id = "edashLoadingBarStyle";
        style.textContent = `
            /* Theme-aware tokens: default = light mode (matches
               --page-bg/--ink/--muted from global.css). Overridden below
               for html[data-theme="dark"], same pattern used in
               dark-mode-v8.css. Kept self-contained here (instead of
               reaching into global.css) so this overlay always renders
               correctly regardless of stylesheet load order. */
            .edash-loading-overlay {
                --edash-loading-bg: rgba(244, 247, 247, 0.82);
                --edash-loading-text: #25343F;
                --edash-loading-track: rgba(37, 52, 63, 0.10);
                --edash-loading-pct: #7C8B8D;
                --edash-loading-card: rgba(255, 255, 255, 0.72);
                --edash-loading-card-border: rgba(37, 52, 63, 0.08);
                --edash-loading-shadow: rgba(37, 52, 63, 0.12);

                position: absolute;
                inset: 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 18px;
                background: var(--edash-loading-bg);
                backdrop-filter: blur(6px) saturate(1.1);
                -webkit-backdrop-filter: blur(6px) saturate(1.1);
                z-index: 30;
                min-height: 220px;
                border-radius: 12px;
                transition: opacity 0.25s ease;
                animation: edashLoadingFadeIn 0.35s ease;
            }
            html[data-theme="dark"] .edash-loading-overlay {
                --edash-loading-bg: rgba(10, 20, 25, 0.78);
                --edash-loading-text: #E8EEF0;
                --edash-loading-track: rgba(255, 255, 255, 0.12);
                --edash-loading-pct: #8FA3A6;
                --edash-loading-card: rgba(24, 39, 44, 0.65);
                --edash-loading-card-border: rgba(255, 255, 255, 0.08);
                --edash-loading-shadow: rgba(0, 0, 0, 0.35);
            }
            @keyframes edashLoadingFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .edash-loading-overlay.is-fading { opacity: 0; }
            .edash-loading-overlay .edash-loading-card {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 16px;
                padding: 28px 34px;
                border-radius: 18px;
                background: var(--edash-loading-card);
                border: 1px solid var(--edash-loading-card-border);
                box-shadow: 0 12px 32px -12px var(--edash-loading-shadow);
                animation: edashLoadingPopIn 0.4s cubic-bezier(0.22, 1, 0.36, 1);
            }
            @keyframes edashLoadingPopIn {
                from { opacity: 0; transform: translateY(6px) scale(0.96); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .edash-loading-overlay .edash-loading-text {
                color: var(--edash-loading-text);
                font-size: 14px;
                font-weight: 600;
                letter-spacing: 0.02em;
                display: inline-flex;
                align-items: baseline;
                gap: 2px;
            }
            .edash-loading-overlay .edash-loading-dots span {
                animation: edashLoadingDots 1.2s infinite;
                opacity: 0;
            }
            .edash-loading-overlay .edash-loading-dots span:nth-child(2) { animation-delay: 0.2s; }
            .edash-loading-overlay .edash-loading-dots span:nth-child(3) { animation-delay: 0.4s; }
            @keyframes edashLoadingDots {
                0%, 100% { opacity: 0; }
                50% { opacity: 1; }
            }
            .edash-loading-overlay .edash-loading-track {
                position: relative;
                width: 220px;
                height: 7px;
                border-radius: 999px;
                background: var(--edash-loading-track);
                overflow: hidden;
            }
            .edash-loading-overlay .edash-loading-fill {
                position: relative;
                height: 100%;
                width: 4%;
                border-radius: 999px;
                background: linear-gradient(90deg, #0F6A71, #3FBFB0, #0F6A71);
                background-size: 200% 100%;
                animation: edashLoadingShimmer 1.6s linear infinite;
                transition: width 0.35s ease;
                overflow: hidden;
            }
            @keyframes edashLoadingShimmer {
                0% { background-position: 0% 0; }
                100% { background-position: -200% 0; }
            }
            .edash-loading-overlay .edash-loading-pct {
                color: var(--edash-loading-pct);
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.03em;
                font-variant-numeric: tabular-nums;
            }
        `;
        document.head.appendChild(style);
    }

    function resolveContainer(container) {
        const el = typeof container === "string" ? document.querySelector(container) : container;
        if (el && getComputedStyle(el).position === "static") {
            // Overlay pakai position:absolute -- container-nya butuh jadi
            // positioning context, atau nanti overlay-nya nempel ke body.
            //
            // BUG FIX: sebelumnya `el.style.position = "relative"` ini
            // ditulis permanen dan TIDAK PERNAH dilepas lagi setelah
            // overlay-nya hilang (done()). Kalau container yang dipakai
            // adalah elemen yang dipakai BERSAMA oleh banyak halaman (mis.
            // #page-root, yang di-reuse main.js->loadPage() setiap kali
            // route SPA berpindah -- isinya diganti tapi elemen #page-root
            // itu sendiri TIDAK PERNAH dibuat ulang), inline style ini
            // nempel selamanya di #page-root walau sudah pindah ke halaman
            // lain. Project Selector ("pages/project-selector.html") punya
            // .ps-page { position:absolute; inset:-24px } yang butuh
            // .edash-content (bukan #page-root) sebagai containing block --
            // begitu #page-root kebagian position:relative "nyasar" ini,
            // #page-root (yang tingginya collapse ke 0 karena isinya cuma
            // elemen absolute) JADI containing block-nya, dan peta jadi
            // cuma setinggi ~48px alih-alih fullscreen (persis bug "peta
            // kepotong/kegeser ke atas" yang cuma normal lagi setelah hard
            // refresh, karena refresh bikin #page-root fresh tanpa inline
            // style ini).
            //
            // Fix: cuma tandai + lepas lagi inline style ini KHUSUS kalau
            // fungsi ini sendiri yang barusan menambahkannya (jangan sentuh
            // position:relative yang memang sengaja ditulis lewat CSS/kode
            // lain di container itu).
            el.style.position = "relative";
            el.dataset.edashLoadingBarPositionSet = "1";
        }
        return el;
    }

    // Lepas lagi position:relative yang KHUSUS ditambahkan resolveContainer()
    // di atas -- dipanggil dari done() begitu overlay terakhir di container
    // itu sudah benar-benar hilang dari DOM, supaya container yang dipakai
    // ulang oleh halaman lain (mis. #page-root) balik ke state semula.
    function releaseContainerPositionIfOwned(el) {
        if (!el || el.dataset.edashLoadingBarPositionSet !== "1") return;
        // Masih ada overlay lain (key berbeda) yang aktif di container yang
        // sama -- jangan lepas dulu, masih dibutuhkan.
        if (el.querySelector(".edash-loading-overlay")) return;
        el.style.position = "";
        delete el.dataset.edashLoadingBarPositionSet;
    }

    // resolveMessage(msgOrKey) -- kalau msgOrKey adalah i18n key yang
    // dikenal main.js punya global t()), dipakai teks hasil terjemahan
    // sesuai bahasa aktif. Kalau bukan key yang dikenal (atau t() belum
    // ke-load), dipakai apa adanya sebagai teks literal -- jadi caller
    // lama yang masih kirim teks Indonesia langsung tetap jalan normal.
    function resolveMessage(msgOrKey) {
        if (!msgOrKey) msgOrKey = "loading.default";
        if (typeof window.t === "function") {
            const resolved = window.t(msgOrKey);
            if (resolved && resolved !== msgOrKey) return resolved;
        }
        return msgOrKey === "loading.default" ? "Memuat data" : msgOrKey;
    }

    // show(container, key, message) -- munculin overlay + mulai animasi
    // progress simulasi. `key` supaya bisa show/done dipanggil untuk
    // beberapa overlay independen dalam 1 container kalau perlu.
    // `message` boleh berupa i18n key (mis. "loading.dashboard") supaya
    // ikut berubah bahasa live lewat edash:languagechange, atau teks
    // literal biasa untuk kompatibilitas lama.
    function show(container, key, message) {
        const el = resolveContainer(container);
        if (!el) return;
        ensureStyle();

        done(container, key, { immediate: true });
        if (timers[key]) { clearInterval(timers[key]); delete timers[key]; }

        // Callers historically pass messages with a trailing "..." (e.g.
        // "Memuat data dashboard..."); strip it so it doesn't double up
        // with the new animated dots below.
        const rawMessage = message || "loading.default";
        const cleanMessage = resolveMessage(rawMessage).replace(/\.{2,}\s*$/, "");

        const overlay = document.createElement("div");
        overlay.id = OVERLAY_ID_PREFIX + key;
        overlay.className = "edash-loading-overlay";
        overlay.dataset.i18nSource = rawMessage;
        overlay.innerHTML = `
            <div class="edash-loading-card">
                <div class="edash-loading-text">${cleanMessage}<span class="edash-loading-dots"><span>.</span><span>.</span><span>.</span></span></div>
                <div class="edash-loading-track"><div class="edash-loading-fill"></div></div>
                <div class="edash-loading-pct">0%</div>
            </div>
        `;
        el.appendChild(overlay);

        const fillEl = overlay.querySelector(".edash-loading-fill");
        const pctEl = overlay.querySelector(".edash-loading-pct");
        let pct = 4;
        timers[key] = setInterval(() => {
            // Makin dekat 90%, makin pelan nambahnya (kesan "menunggu
            // beneran", bukan cuma animasi lurus) -- macet di 90% sampai
            // done() dipanggil.
            const step = pct < 60 ? 9 : pct < 80 ? 3 : 0.6;
            pct = Math.min(90, pct + step);
            fillEl.style.width = pct + "%";
            pctEl.textContent = Math.round(pct) + "%";
        }, 220);
    }

    // Overlay yang lagi tampil ikut berganti bahasa langsung tanpa perlu
    // reload/re-fetch, dengan membaca ulang dataset.i18nSource tiap
    // overlay aktif saat event edash:languagechange ditembak main.js
    // (lihat switchLanguage() di main.js).
    document.addEventListener("edash:languagechange", () => {
        document.querySelectorAll(".edash-loading-overlay").forEach((overlay) => {
            const textEl = overlay.querySelector(".edash-loading-text");
            if (!textEl) return;
            const cleanMessage = resolveMessage(overlay.dataset.i18nSource).replace(/\.{2,}\s*$/, "");
            textEl.innerHTML = `${cleanMessage}<span class="edash-loading-dots"><span>.</span><span>.</span><span>.</span></span>`;
        });
    });

    // done(container, key) -- data sudah siap, lompat ke 100% sebentar
    // lalu overlay hilang (fade out + dibuang dari DOM).
    function done(container, key, opts) {
        if (timers[key]) { clearInterval(timers[key]); delete timers[key]; }

        const overlay = document.getElementById(OVERLAY_ID_PREFIX + key);
        if (!overlay) return;

        const el = typeof container === "string" ? document.querySelector(container) : container;

        if (opts && opts.immediate) {
            overlay.remove();
            releaseContainerPositionIfOwned(el);
            return;
        }

        const fillEl = overlay.querySelector(".edash-loading-fill");
        const pctEl = overlay.querySelector(".edash-loading-pct");
        if (fillEl) fillEl.style.width = "100%";
        if (pctEl) pctEl.textContent = "100%";

        setTimeout(() => {
            overlay.classList.add("is-fading");
            setTimeout(() => {
                overlay.remove();
                releaseContainerPositionIfOwned(el);
            }, 260);
        }, 200);
    }

    window.EdashLoadingBar = { show, done };

})();