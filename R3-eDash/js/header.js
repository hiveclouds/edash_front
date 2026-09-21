// ============================================================
// Master Header Component — 360eDash
// Notification bell: dropdown panel with read/unread state.
// Called once from main.js after master/header/header.html loads.
//
// Notifications are logged (not re-derived from source data) the
// moment something notif-worthy happens elsewhere in the app:
//   - a new Alert is created (js/alert.js)                 -> pages/alert.html
//   - a new task is scheduled ("Ajukan Task Maintenance" /
//     "Tambah Unit Bermasalah", js/task-management.js)     -> Task tab
//   - a task's completion report is submitted
//     (js/task-maintenance.js)                              -> Task tab
// via window.hdLogAlertCreated(alert) / window.hdLogTaskCreated(kind, sys, idx, data).
//
// The log is persisted to localStorage (HD_NOTIF_STORAGE_KEY), so:
//   - the bell starts EMPTY the very first time (no dummy/demo
//     notifications), even though the rest of the app is seeded
//     with plenty of demo alerts/tasks;
//   - anything logged during a session survives a page refresh.
//
// Each entry stores raw fields (not baked title/message strings) so
// hdLocalizeNotif() can regenerate ID/EN text on demand — re-run on
// every render, and on the `edash:languagechange` event, so flipping
// the language updates notif text immediately without losing state.
//
// Time is shown relative ("X menit lalu" / "X hours ago") for
// anything under 24h old, based on the real addedAt timestamp —
// falling back to an absolute date after that. Re-rendered on a
// light interval so it stays roughly fresh while the app is open.
//
// Read state is persisted too — marking things read (or "Tandai
// Semua Dibaca") sticks across a refresh, same as the notifications
// themselves. HOWEVER, read entries are only kept around while the
// panel stays open — the moment the panel closes (clicking a notif,
// clicking outside, ESC, or the bell again), anything read at that
// point is purged from the log for good (see hdPurgeReadNotifs()).
// Unread entries are never touched by this and persist normally.
//
// Clicking a notification marks it read, briefly highlights it,
// then opens the exact page/item it's about and highlights that
// item too, so it's easy to find among everything else on that
// page.
// ============================================================

const HD_NOTIF_STORAGE_KEY = "edash_hd_notif_log_v1";
const HD_NOTIF_MAX_LOG = 200;
const HD_NOTIF_BADGE_MAX = 200;

let hdNotifLog = [];

// ---------- Persistence (localStorage) ----------

function hdLoadLog() {

    try {
        const raw = localStorage.getItem(HD_NOTIF_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn("[header] Gagal baca notif log dari localStorage:", e.message);
        return [];
    }

}

function hdSaveLog() {

    try {
        localStorage.setItem(HD_NOTIF_STORAGE_KEY, JSON.stringify(hdNotifLog));
    } catch (e) {
        console.warn("[header] Gagal simpan notif log ke localStorage:", e.message);
    }

}

// ---------- Log a new notification ----------
// Called from js/alert.js and js/task-management.js / js/task-maintenance.js
// the moment something notif-worthy actually happens — NOT re-derived
// from window.__alertData / window.__siSystems on every render, so demo
// seed rows never show up here and real entries survive a refresh.

function hdPushLogEntry(entry) {

    const existingIdx = hdNotifLog.findIndex((n) => n.id === entry.id);

    if (existingIdx !== -1) {
        // Re-logging the same id (shouldn't normally happen for a
        // fresh create) — update its raw data but keep the original
        // addedAt/read so it doesn't jump back to the top / unread.
        hdNotifLog[existingIdx] = {
            ...hdNotifLog[existingIdx],
            raw: entry.raw,
            page: entry.page,
            target: entry.target,
        };
    } else {
        hdNotifLog.unshift(entry);
        if (hdNotifLog.length > HD_NOTIF_MAX_LOG) {
            hdNotifLog.length = HD_NOTIF_MAX_LOG;
        }
    }

    hdSaveLog();
    hdRenderNotifications();

}

// entry.raw: { severity, title, category, projectName, desc }
window.hdLogAlertCreated = function (alert) {

    if (!alert) return;

    hdPushLogEntry({
        id: `alert-${alert.id}`,
        kind: "alert",
        addedAt: Date.now(),
        read: false,
        page: "pages/alert.html",
        target: { kind: "alert", alertId: alert.id },
        raw: {
            severity: alert.severity,
            title: alert.title,
            category: alert.category,
            projectName: (alert.projects && alert.projects[0]) || "",
            desc: alert.desc,
        },
    });

};

// Keeps a notif's displayed text in sync if the underlying alert
// gets edited later (title/desc/etc. changed) — does NOT touch
// addedAt or read, so editing doesn't resurrect/reorder the notif.
window.hdUpdateAlertNotifRaw = function (alert) {

    if (!alert) return;

    const id = `alert-${alert.id}`;
    const existing = hdNotifLog.find((n) => n.id === id);
    if (!existing) return;

    existing.raw = {
        severity: alert.severity,
        title: alert.title,
        category: alert.category,
        projectName: (alert.projects && alert.projects[0]) || "",
        desc: alert.desc,
    };

    hdSaveLog();
    hdRenderNotifications();

};

// An alert getting deleted should disappear from the bell too.
window.hdRemoveAlertNotif = function (alertId) {

    const id = `alert-${alertId}`;
    const idx = hdNotifLog.findIndex((n) => n.id === id);
    if (idx === -1) return;

    hdNotifLog.splice(idx, 1);
    hdSaveLog();
    hdRenderNotifications();

};

// kind: "task-future" (Task Dijadwalkan) | "task-history" (Laporan Task Diterima)
// data: the futureMaintenance/historicalMaintenance entry itself (has a
// stable .id from genMaintId()). idx: its current index in that array,
// used for on-click navigation only (see hdApplyNotifTarget below).
window.hdLogTaskCreated = function (kind, sys, idx, data) {

    if (!sys || !data) return;

    hdPushLogEntry({
        id: `${kind === "task-future" ? "future" : "hist"}-${data.id}`,
        kind,
        addedAt: Date.now(),
        read: false,
        page: "pages/project-monitoring.html",
        target: { kind, unitId: sys.id, idx },
        raw: {
            technician: data.technician,
            title: data.title,
            systemName: (sys.basic && sys.basic.systemName) || sys.id,
        },
    });

};

// Jadwal maintenance (futureMaintenance) diedit dari Task Management —
// data.id tetap sama (id tidak berubah saat edit), jadi dibubuhi
// timestamp supaya tiap edit tetap jadi entry notif baru, bukan
// menimpa notif "Task Dijadwalkan" yang asli.
window.hdLogTaskEdited = function (sys, idx, data) {

    if (!sys || !data) return;

    hdPushLogEntry({
        id: `edited-${data.id}-${Date.now()}`,
        kind: "task-edited",
        addedAt: Date.now(),
        read: false,
        page: "pages/project-monitoring.html",
        target: { kind: "task-future", unitId: sys.id, idx },
        raw: {
            technician: data.technician,
            title: data.title,
            systemName: (sys.basic && sys.basic.systemName) || sys.id,
        },
    });

};

// Jadwal maintenance dihapus dari Task Management — entry-nya sudah
// tidak ada lagi, jadi tidak ada item spesifik untuk disorot; klik
// notif ini cuma membawa user ke tab Task Management.
window.hdLogTaskDeleted = function (sys, data) {

    if (!sys || !data) return;

    hdPushLogEntry({
        id: `deleted-${data.id || "x"}-${Date.now()}`,
        kind: "task-deleted",
        addedAt: Date.now(),
        read: false,
        page: "pages/project-monitoring.html",
        target: { kind: "task-deleted" },
        raw: {
            technician: data.technician,
            title: data.title,
            systemName: (sys.basic && sys.basic.systemName) || sys.id,
        },
    });

};

// Teknisi menerima tugas ("Terima Tugas") di Task Maintenance. Cuma
// terjadi sekali per task (tombol hilang begitu status berubah dari
// pending), jadi id-nya aman dipakai apa adanya tanpa timestamp.
window.hdLogTaskAccepted = function (sys, task) {

    if (!sys || !task) return;

    hdPushLogEntry({
        id: `accepted-${task.id}`,
        kind: "task-accepted",
        addedAt: Date.now(),
        read: false,
        page: "pages/task-maintenance.html",
        target: { kind: "task-maintenance-item", taskId: task.id },
        raw: {
            technician: task.technician,
            title: task.title,
            systemName: (sys.basic && sys.basic.systemName) || sys.id,
        },
    });

};

// Progress pekerjaan diupdate di Task Maintenance — bisa terjadi
// berkali-kali untuk task yang sama (25% -> 50% -> 90%, dst.), jadi
// tiap update dibubuhi timestamp supaya masing-masing tercatat
// sebagai notif tersendiri, bukan menimpa update sebelumnya.
window.hdLogTaskProgress = function (sys, task) {

    if (!sys || !task) return;

    hdPushLogEntry({
        id: `progress-${task.id}-${Date.now()}`,
        kind: "task-progress",
        addedAt: Date.now(),
        read: false,
        page: "pages/task-maintenance.html",
        target: { kind: "task-maintenance-item", taskId: task.id },
        raw: {
            technician: task.technician,
            title: task.title,
            systemName: (sys.basic && sys.basic.systemName) || sys.id,
            progress: task.progress,
        },
    });

};

// Ticket baru disubmit dari tab Ticketing (js/ticketing.js, tombol
// "Submit Ticket") -- dipanggil untuk SEMUA role yang submit, TIDAK
// cuma role tertentu. Yang membatasi notif ini supaya cuma KELIHATAN
// buat role "360 REMS Intern" adalah hdIsNotifVisible() di bawah, bukan
// di titik logging ini -- jadi tiket tetap tercatat apa adanya di log
// (kalau role aktif berubah/di-switch, riwayatnya tidak hilang), cuma
// disaring pas ditampilkan.
window.hdLogTicketCreated = function (ticket) {

    if (!ticket) return;

    hdPushLogEntry({
        id: `ticket-${ticket.id}`,
        kind: "ticket-submitted",
        addedAt: Date.now(),
        read: false,
        page: "pages/ticketing.html",
        target: { kind: "ticket", ticketId: ticket.id },
        raw: {
            submitter: ticket.submittedBy,
            title: ticket.title,
            team: ticket.team,
            type: ticket.type,
        },
    });

};

// ---------- Server-backed notifications (ticket approval flow) ----------
// BEDA dari semua hdLog* di atas (yang murni localStorage, cuma
// kelihatan di BROWSER yang sama tempat aksinya terjadi) -- entry di
// bawah ini datang dari backend (tabel `notifications`, lihat
// ticket.service.ts: notifyApprovers()/notifyTicketDecision()), jadi
// BENERAN lintas browser/device selama user login-nya sama. Dipakai
// buat: tiket masuk "Waiting Approval" (notif ke 360master/REMS Intern
// Lead), dan tiket di-approve/reject (notif balik ke pembuat/assignee).
//
// entry.serverId nyimpen notifications.id (UUID asli di DB) supaya
// klik/"Tandai Semua Dibaca" bisa PUT /notifications/:id/read balik ke
// backend -- id lokal (`entry.id`, dipakai buat key React-less render
// list di atas) sengaja DIPREFIX "server-" supaya tidak pernah
// tabrakan sama id lokal punya hdLogAlertCreated dkk (yang prefix-nya
// "alert-"/"task-"/"ticket-").
const HD_SERVER_EVENT_TO_KIND = {
    TICKET_CREATED: "server-ticket-created",
    TICKET_WAITING_APPROVAL: "server-ticket-waiting-approval",
    TICKET_APPROVED: "server-ticket-approved",
    TICKET_REJECTED: "server-ticket-rejected",
};

function hdMapServerNotifToEntry(row) {

    return {
        id: `server-${row.id}`,
        serverId: row.id,
        kind: HD_SERVER_EVENT_TO_KIND[row.event_type] || "server-generic",
        addedAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        read: !!row.is_read,
        page: "pages/ticketing.html",
        target: { kind: "ticket", ticketId: row.entity_id },
        // Backend sudah generate title/message final (Bahasa Indonesia
        // saja untuk sekarang) -- BEDA dari entry lokal lain yang nyimpen
        // raw field mentah lalu di-localize ID/EN di hdLocalizeNotif().
        // Belum ada terjemahan EN dari server, lihat catatan di
        // hdLocalizeNotif() bagian "server-*".
        raw: { title: row.title, message: row.message },
    };

}

// Tarik notif BELUM DIBACA dari backend dan gabung ke hdNotifLog kalau
// belum ada (dicek lewat id, BUKAN overwrite -- device ini yang paling
// tahu status read notif yang sudah pernah ditampilkan sebelum fetch
// berikutnya). Dipanggil sekali saat init + di-poll berkala supaya
// notif dari aksi role LAIN (approve tiket lewat browser lain, mis.)
// ikut muncul tanpa perlu refresh manual.
async function hdFetchServerNotifs() {

    if (typeof window.edashApiFetch !== "function") return;

    let rows;
    try {
        rows = await window.edashApiFetch("/notifications?isRead=false");
    } catch (e) {
        console.warn("[header] Gagal ambil notifikasi dari server:", e.message);
        return;
    }

    if (!Array.isArray(rows) || rows.length === 0) return;

    let changed = false;

    rows.forEach((row) => {
        const entry = hdMapServerNotifToEntry(row);
        const alreadyLogged = hdNotifLog.some((n) => n.id === entry.id);
        if (!alreadyLogged) {
            hdNotifLog.unshift(entry);
            changed = true;
        }
    });

    if (hdNotifLog.length > HD_NOTIF_MAX_LOG) {
        hdNotifLog.length = HD_NOTIF_MAX_LOG;
    }

    if (changed) {
        hdSaveLog();
        hdRenderNotifications();
    }

}

// Best-effort -- gagal PUT /read TIDAK boleh gagalkan UI (notif tetap
// hilang dari panel begini, cuma bisa balik muncul di fetch berikutnya
// kalau ternyata gagal di server).
function hdMarkServerNotifRead(serverId) {

    if (!serverId || typeof window.edashApiFetch !== "function") return;

    window.edashApiFetch(`/notifications/${encodeURIComponent(serverId)}/read`, { method: "PUT" })
        .catch((e) => console.warn("[header] Gagal tandai notifikasi server dibaca:", e.message));

}

// ---------- Role-based visibility (notif tetap dilog utuh, cuma ----------
// ---------- disaring saat DITAMPILKAN, berdasar role yang aktif) ----------

// Notif "Tiket Baru Disubmit" sengaja HANYA ditampilkan ke role "360
// REMS Intern" (role key: rems_intern) -- role lain yang submit ticket
// tetap memicu logging di atas, tapi bell mereka sendiri tidak
// menampilkannya. Kind lain (alert/task-*) tidak dibatasi apa pun,
// jadi selalu lolos di sini.
function hdIsNotifVisible(entry) {

    if (entry.kind === "ticket-submitted") {
        return (sessionStorage.getItem("edash-role") || "") === "rems_intern";
    }

    return true;

}

function hdVisibleLog() {
    return hdNotifLog.filter(hdIsNotifVisible);
}

// ---------- Localize + format for display (computed at render time) ----------

function hdIsIndonesian() {
    return typeof getSavedLanguage === "function" ? getSavedLanguage() === "id" : true;
}

function hdSeverityToType(severity) {

    if (severity === "high") return "danger";
    if (severity === "medium") return "warning";
    return "info";

}

function hdLocalizeNotif(entry) {

    const isId = hdIsIndonesian();
    const r = entry.raw || {};

    if (entry.kind === "alert") {
        return {
            type: hdSeverityToType(r.severity),
            icon: "fa-solid fa-triangle-exclamation",
            title: r.title,
            message: `${r.category} — ${r.projectName || (isId ? "Proyek" : "Project")}: ${r.desc}`,
        };
    }

    if (entry.kind === "task-future") {
        // Ikon disamakan dengan tab "Ajukan Task Maintenance" di halaman
        // Task Management (fa-calendar-plus).
        return {
            type: "info",
            icon: "fa-solid fa-calendar-plus",
            title: isId ? "Task Dijadwalkan" : "Task Scheduled",
            message: isId
                ? `${r.technician || "Teknisi"} ditugaskan untuk \u201c${r.title}\u201d (${r.systemName}).`
                : `${r.technician || "Technician"} was assigned to \u201c${r.title}\u201d (${r.systemName}).`,
        };
    }

    if (entry.kind === "task-edited") {
        // Ikon disamakan dengan tombol "Edit Schedule" di Task Management.
        return {
            type: "info",
            icon: "fa-solid fa-pen",
            title: isId ? "Jadwal Diubah" : "Schedule Edited",
            message: isId
                ? `Jadwal maintenance \u201c${r.title}\u201d (${r.systemName}) telah diubah.`
                : `Maintenance schedule \u201c${r.title}\u201d (${r.systemName}) was edited.`,
        };
    }

    if (entry.kind === "task-deleted") {
        // Ikon disamakan dengan tombol "Delete" di Task Management.
        return {
            type: "danger",
            icon: "fa-solid fa-trash",
            title: isId ? "Jadwal Dihapus" : "Schedule Deleted",
            message: isId
                ? `Jadwal maintenance \u201c${r.title}\u201d (${r.systemName}) telah dihapus.`
                : `Maintenance schedule \u201c${r.title}\u201d (${r.systemName}) was deleted.`,
        };
    }

    if (entry.kind === "task-accepted") {
        // Ikon disamakan dengan subtab "Sedang Dikerjakan" di Task
        // Maintenance (fa-person-digging).
        return {
            type: "warning",
            icon: "fa-solid fa-person-digging",
            title: isId ? "Tugas Diterima" : "Task Accepted",
            message: isId
                ? `${r.technician || "Teknisi"} menerima tugas \u201c${r.title}\u201d (${r.systemName}).`
                : `${r.technician || "Technician"} accepted the task \u201c${r.title}\u201d (${r.systemName}).`,
        };
    }

    if (entry.kind === "task-progress") {
        // Ikon disamakan dengan tombol "Update Progress" di Task
        // Maintenance (fa-gauge-high). Persentase dicantumkan di judul
        // supaya langsung kelihatan tanpa perlu baca pesan lengkap.
        return {
            type: "warning",
            icon: "fa-solid fa-gauge-high",
            title: isId ? `Progress Diperbarui ke ${r.progress}%` : `Progress Updated to ${r.progress}%`,
            message: isId
                ? `${r.technician || "Teknisi"} memperbarui progress \u201c${r.title}\u201d (${r.systemName}) ke ${r.progress}%.`
                : `${r.technician || "Technician"} updated progress on \u201c${r.title}\u201d (${r.systemName}) to ${r.progress}%.`,
        };
    }

    if (entry.kind === "ticket-submitted") {
        // Ikon disamakan dengan tombol "Submit Ticket" di modal "Submit
        // New Ticket" pada tab Ticketing (fa-paper-plane).
        return {
            type: "info",
            icon: "fa-solid fa-paper-plane",
            title: isId ? "Tiket Baru Disubmit" : "New Ticket Submitted",
            message: isId
                ? `${r.submitter || "Seseorang"} mensubmit tiket \u201c${r.title}\u201d (${r.team || "-"}).`
                : `${r.submitter || "Someone"} submitted the ticket \u201c${r.title}\u201d (${r.team || "-"}).`,
        };
    }

    // ---- Server-backed (lihat "Server-backed notifications" di atas) ----
    // Title/message SUDAH JADI dari backend (r.title/r.message), belum
    // ada versi EN terpisah -- TODO kalau nanti mau bilingual penuh,
    // backend perlu kirim 2 versi teks atau field terjemahan terpisah.
    if (entry.kind === "server-ticket-created") {
        return {
            type: "info",
            icon: "fa-solid fa-paper-plane",
            title: r.title,
            message: r.message,
        };
    }

    if (entry.kind === "server-ticket-waiting-approval") {
        return {
            type: "warning",
            icon: "fa-solid fa-hourglass-half",
            title: r.title,
            message: r.message,
        };
    }

    if (entry.kind === "server-ticket-approved") {
        return {
            type: "success",
            icon: "fa-solid fa-circle-check",
            title: r.title,
            message: r.message,
        };
    }

    if (entry.kind === "server-ticket-rejected") {
        return {
            type: "danger",
            icon: "fa-solid fa-circle-xmark",
            title: r.title,
            message: r.message,
        };
    }

    if (entry.kind === "server-generic") {
        return {
            type: "info",
            icon: "fa-solid fa-bell",
            title: r.title,
            message: r.message,
        };
    }

    // task-history — ikon disamakan dengan subtab "Selesai" di Task
    // Maintenance (fa-circle-check).
    return {
        type: "success",
        icon: "fa-solid fa-circle-check",
        title: isId ? "Laporan Task Diterima" : "Task Report Received",
        message: isId
            ? `${r.technician || "Teknisi"} melaporkan penyelesaian \u201c${r.title}\u201d (${r.systemName}).`
            : `${r.technician || "Technician"} reported completion of \u201c${r.title}\u201d (${r.systemName}).`,
    };

}

// Relative time under 24h ("1 menit lalu" / "1 minute ago", "6 jam
// lalu" / "6 hours ago"), absolute date beyond that.
function hdRelativeTime(ts) {

    if (!ts) return "-";

    const isId = hdIsIndonesian();
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));

    if (diffSec < 60) {
        return isId ? "Baru saja" : "Just now";
    }

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
        return isId
            ? `${diffMin} menit lalu`
            : `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
    }

    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) {
        return isId
            ? `${diffHour} jam lalu`
            : `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;
    }

    const dt = new Date(ts);
    return dt.toLocaleDateString(isId ? "id-ID" : "en-US", { day: "2-digit", month: "short", year: "numeric" });

}

// ---------- Render ----------

function hdRenderNotifications() {

    const list = document.getElementById("hdNotifList");
    const empty = document.getElementById("hdNotifEmpty");
    const markAllBtn = document.getElementById("hdNotifMarkAll");

    if (!list) return;

    // Newest first -- disaring dulu lewat hdVisibleLog() supaya notif
    // yang dibatasi role (mis. "Tiket Baru Disubmit", cuma buat 360
    // REMS Intern) tidak ikut kelihatan/dihitung di role lain, walau
    // tetap tersimpan utuh di hdNotifLog/localStorage.
    const sorted = [...hdVisibleLog()].sort((a, b) => b.addedAt - a.addedAt);

    if (sorted.length === 0) {
        list.innerHTML = "";
        list.hidden = true;
        if (empty) empty.hidden = false;
        if (markAllBtn) markAllBtn.disabled = true;
        hdUpdateBadge();
        return;
    }

    list.hidden = false;
    if (empty) empty.hidden = true;

    list.innerHTML = sorted.map((n) => {
        const view = hdLocalizeNotif(n);
        return `
        <button
            type="button"
            class="hd-notif-item ${n.read ? "" : "is-unread"}"
            data-notif-id="${n.id}"
            data-notif-page="${n.page}"
            data-notif-target="${encodeURIComponent(JSON.stringify(n.target))}"
        >
            <span class="hd-notif-item-icon type-${view.type}">
                <i class="${view.icon}"></i>
            </span>
            <span class="hd-notif-item-body">
                <span class="hd-notif-item-title">
                    <span>${view.title}</span>
                    ${n.read ? "" : `<span class="hd-notif-item-dot" aria-hidden="true"></span>`}
                </span>
                <span class="hd-notif-item-msg">${view.message}</span>
                <span class="hd-notif-item-time">${hdRelativeTime(n.addedAt)}</span>
            </span>
        </button>
    `;
    }).join("");

    const unreadCount = sorted.filter((n) => !n.read).length;
    if (markAllBtn) markAllBtn.disabled = unreadCount === 0;

    hdUpdateBadge();

}

function hdUpdateBadge() {

    const badge = document.getElementById("hdNotifBadge");

    if (!badge) return;

    const unreadCount = hdVisibleLog().filter((n) => !n.read).length;

    if (unreadCount === 0) {
        badge.hidden = true;
        return;
    }

    badge.hidden = false;
    badge.textContent = unreadCount > HD_NOTIF_BADGE_MAX ? `${HD_NOTIF_BADGE_MAX}+` : String(unreadCount);

}

// ---------- Mark as read (persisted) ----------

// Updates the data WITHOUT re-rendering the list. Used on individual
// click so the brief "just clicked" highlight (added directly to
// that item's DOM node) doesn't get wiped out by a full re-render
// before the user gets to see it.
function hdMarkOneReadSilent(id) {

    const notif = hdNotifLog.find((n) => n.id === id);

    if (!notif) return;

    notif.read = true;
    hdSaveLog();

    // Entry dari server (lihat "Server-backed notifications") -- sinkronkan
    // status read-nya balik ke backend supaya browser/device lain yang
    // fetch /notifications tidak lihat ini sebagai unread lagi.
    if (notif.serverId) {
        hdMarkServerNotifRead(notif.serverId);
    }

}

function hdMarkAllRead() {

    // Cuma tandai yang KELIHATAN buat role aktif -- kalau ini nyapu
    // semua entry di hdNotifLog tanpa pandang bulu, role lain yang
    // notifnya disembunyikan (mis. "Tiket Baru Disubmit" buat role
    // selain 360 REMS Intern) bakal ikut ke-mark-read diam-diam padahal
    // orangnya belum pernah lihat notif itu sama sekali.
    let changed = false;

    hdVisibleLog().forEach((n) => {
        if (!n.read) {
            n.read = true;
            changed = true;
            if (n.serverId) hdMarkServerNotifRead(n.serverId);
        }
    });

    if (!changed) return;

    hdSaveLog();
    hdRenderNotifications();

}

// Read entries (whether via "Tandai Semua Dibaca" or clicking one
// individually) are only PURGED from the log once the panel actually
// closes — not the moment they're marked read. This way the user can
// still glance at what they just read while the panel is open; it's
// only gone the next time they open the bell. Unread entries are
// never touched here, no matter how many read ones get cleared out.
function hdPurgeReadNotifs() {

    const before = hdNotifLog.length;
    hdNotifLog = hdNotifLog.filter((n) => !n.read);

    if (hdNotifLog.length === before) return;

    hdSaveLog();
    hdRenderNotifications();

}

// ---------- Navigate to the page/item a notification points to ----------

// Once we're on the destination page, open/scroll to the exact
// record the notification was about so it isn't lost among everything
// else on that page.
function hdApplyNotifTarget(target) {

    if (!target) return;

    if (target.kind === "alert" && typeof window.alertFocusEntry === "function") {
        window.alertFocusEntry(target.alertId);
        return;
    }

    if ((target.kind === "task-future" || target.kind === "task-history")
        && typeof window.pmGoToTaskEntry === "function") {
        window.pmGoToTaskEntry(target.kind, target.unitId, target.idx);
        return;
    }

    // Jadwal yang sudah dihapus tidak punya entry spesifik untuk
    // disorot — cukup bawa user ke tab Task Management-nya saja.
    if (target.kind === "task-deleted" && typeof window.pmGoToTaskTab === "function") {
        window.pmGoToTaskTab();
        return;
    }

    // "Tugas Diterima" / "Progress Diperbarui" — keduanya terjadi di
    // halaman Task Maintenance (bukan Task Management), jadi disorot
    // lewat window.tkmGoToTask (js/task-maintenance.js).
    if (target.kind === "task-maintenance-item" && typeof window.tkmGoToTask === "function") {
        window.tkmGoToTask(target.taskId);
        return;
    }

    // "Tiket Baru Disubmit" — buka modal Detail tiket yang bersangkutan
    // di tab Ticketing lewat window.tkGoToTicket (js/ticketing.js).
    if (target.kind === "ticket" && typeof window.tkGoToTicket === "function") {
        window.tkGoToTicket(target.ticketId);
    }

}

function hdNavigateToNotifPage(page, target) {

    if (!page) return;

    const navResult = (typeof loadPage === "function") ? loadPage(page) : null;

    // Keep the sidebar's active state in sync with where we just
    // navigated, the same way a normal sidebar click would.
    const dashboardBtn = document.getElementById("sbDashboardBtn");
    const navItems = document.querySelectorAll(".sb-nav-item");

    if (dashboardBtn) dashboardBtn.classList.remove("is-active");
    navItems.forEach((el) => el.classList.remove("is-active"));

    const matchingNavItem = Array.from(navItems)
        .find((el) => el.getAttribute("data-page") === page);

    if (matchingNavItem) {
        matchingNavItem.classList.add("is-active");
    }

    hdCloseNotifPanel();

    // Wait for the page (and its initializer) to actually finish
    // loading before trying to focus/highlight the specific item —
    // it doesn't exist in the DOM until then.
    Promise.resolve(navResult).then(() => {
        hdApplyNotifTarget(target);
    });

}

// ---------- Open / close panel ----------
// NOTE: the open/is-open class lives on .hd-notif-wrap (see CSS rule
// `.hd-notif-wrap.is-open .hd-notif-panel`), not on the panel element
// itself — every open-state check below reads it off the wrapper.

function hdOpenNotifPanel() {

    const wrap = document.querySelector(".hd-notif-wrap");
    const panel = document.getElementById("hdNotifPanel");
    const bell = document.getElementById("hdNotif");

    if (!wrap || !panel || !bell) return;

    wrap.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    bell.classList.add("is-active");
    bell.setAttribute("aria-expanded", "true");

    // Refresh relative-time labels the moment it's opened.
    hdRenderNotifications();

}

function hdCloseNotifPanel() {

    const wrap = document.querySelector(".hd-notif-wrap");
    const panel = document.getElementById("hdNotifPanel");
    const bell = document.getElementById("hdNotif");

    if (!wrap || !panel || !bell) return;

    wrap.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    bell.classList.remove("is-active");
    bell.setAttribute("aria-expanded", "false");

    // Whatever's been read (via "Tandai Semua Dibaca" or by clicking
    // a notif) gets cleared out the moment the panel closes — see
    // hdPurgeReadNotifs() above. Still-unread entries are left alone.
    hdPurgeReadNotifs();

}

function hdToggleNotifPanel() {

    const wrap = document.querySelector(".hd-notif-wrap");

    if (!wrap) return;

    if (wrap.classList.contains("is-open")) {
        hdCloseNotifPanel();
    } else {
        hdOpenNotifPanel();
    }

}

// ---------- Entry point ----------

function initHeaderNotifications() {

    const bell = document.getElementById("hdNotif");
    const wrap = document.querySelector(".hd-notif-wrap");
    const panel = document.getElementById("hdNotifPanel");
    const markAllBtn = document.getElementById("hdNotifMarkAll");
    const list = document.getElementById("hdNotifList");

    if (!bell || !wrap || !panel) return;

    hdNotifLog = hdLoadLog();
    hdRenderNotifications();

    // Tarik notif dari backend (approval/reject tiket, lihat "Server-
    // backed notifications" di atas) segera saat header dimuat, lalu
    // poll tiap 30 detik -- supaya notif dari aksi role LAIN (mis. tiket
    // di-approve lewat browser/device lain) muncul tanpa perlu refresh
    // manual. 30 detik dipilih sebagai kompromi (bukan real-time
    // websocket, tapi cukup responsif buat kebutuhan approval yang
    // memang tidak time-critical per detik).
    hdFetchServerNotifs();
    setInterval(hdFetchServerNotifs, 30000);

    // Re-render text (title/message/relative time) when the language
    // is switched — raw data is untouched, only the display strings.
    document.addEventListener("edash:languagechange", hdRenderNotifications);

    // Keep "X minutes/hours ago" reasonably fresh while the app is
    // open, without needing the panel open.
    setInterval(hdRenderNotifications, 60000);

    // Toggle panel from the bell button
    bell.addEventListener("click", (e) => {

        e.stopPropagation();
        hdToggleNotifPanel();

    });

    // Mark all notifications as read
    if (markAllBtn) {
        markAllBtn.addEventListener("click", (e) => {

            e.stopPropagation();
            hdMarkAllRead();

        });
    }

    // Clicking a notification: flash it briefly so the click feels
    // acknowledged, mark it read, then jump to the page/item it's
    // about.
    if (list) {
        list.addEventListener("click", (e) => {

            const item = e.target.closest(".hd-notif-item");

            if (!item || item.classList.contains("is-clicked")) return;

            const id = item.getAttribute("data-notif-id");
            const page = item.getAttribute("data-notif-page");

            let target = null;
            try {
                target = JSON.parse(decodeURIComponent(item.getAttribute("data-notif-target")));
            } catch (err) {
                target = null;
            }

            item.classList.add("is-clicked");
            item.classList.remove("is-unread");

            const dot = item.querySelector(".hd-notif-item-dot");
            if (dot) dot.remove();

            hdMarkOneReadSilent(id);
            hdUpdateBadge();

            setTimeout(() => {
                hdNavigateToNotifPage(page, target);
            }, 900);

        });
    }

    // Click anywhere outside the panel closes it — bell itself is
    // handled by its own toggle listener above, and the language
    // switcher is deliberately excluded so switching language
    // doesn't dismiss the panel.
    //
    // Open-state is checked on `wrap` (see the note above the
    // open/close functions) — checking it on `panel` here always
    // read as false, which was a bug that kept this listener from
    // ever actually closing anything.
    //
    // Registered on the CAPTURE phase (the `true` at the end) so it
    // always runs before other components on the page, even ones
    // (like the profile dropdown trigger) that call
    // e.stopPropagation() on their own bubble-phase click handler —
    // otherwise that stopPropagation would stop this listener from
    // ever seeing the click since it never reaches document.
    document.addEventListener("click", (e) => {

        if (!wrap.classList.contains("is-open")) return;

        if (e.target === bell || bell.contains(e.target)) return;

        if (panel.contains(e.target)) return;

        const langToggle = document.getElementById("hdLangToggle");
        if (langToggle && (e.target === langToggle || langToggle.contains(e.target))) return;

        hdCloseNotifPanel();

    }, true);

    // ESC closes the panel
    document.addEventListener("keydown", (e) => {

        if (e.key === "Escape") {
            hdCloseNotifPanel();
        }

    });

}