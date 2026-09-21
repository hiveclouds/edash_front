/* ============================================================
   Project Monitoring — 360eDash
   Mengatur 4 tab: Project Overview, System Information,
   Battery Station, Task Management. Setiap tab di-lazy-load
   sekali via fetch, lalu menjalankan initializer halaman aslinya.
============================================================= */

(function () {

  let pmActiveTab = "overview";

  // Cache promise supaya setiap tab hanya di-fetch sekali per
  // kunjungan ke halaman Project Monitoring.
  let overviewLoadPromise = null;
  let systemLoadPromise = null;
  let batteryLoadPromise = null;
  let taskLoadPromise = null;

  // Cache MARKUP HTML mentah tiap tab (bukan data, cuma kerangka
  // halamannya) -- ini SENGAJA TIDAK direset tiap initProjectMonitoring()
  // dipanggil ulang (beda dari *LoadPromise di atas), karena markupnya
  // sendiri statis/tidak pernah berubah dalam 1 sesi. Sebelumnya tiap
  // balik ke Project Monitoring dari halaman lain, ke-4 tab ini semua
  // fetch ulang lewat network (malah dengan cache:"no-store", jadi
  // browser cache pun dilewati) padahal isinya identik dgn sebelumnya --
  // itu salah satu sumber "kerasa loading lagi" yang dilaporkan, di luar
  // soal data (yang sudah macam-macam punya cache sendiri per tab, lihat
  // pdRealDataLoadedOnce/__siLoadedProjectIds/state.loadedProjectId).
  const htmlCache = { overview: null, system: null, battery: null, task: null };

  // Unit yang perlu dibuka otomatis di Task Management setelah
  // user klik "Ajukan Task Maintenance" dari System Information.
  let pmPendingUnitId = null;

  // ===========================================================
  // INIT (dipanggil main.js setiap halaman ini dimuat)
  // ===========================================================
  window.initProjectMonitoring = function () {
    pmActiveTab = "overview";

    // PENTING: reset cache PROMISE (bukan htmlCache di atas) setiap kali
    // halaman ini dimuat ulang. main.js mengganti seluruh isi #page-root
    // tiap pindah halaman, jadi DOM panel (pmPanel-overview/system/
    // battery/task) yang lama sudah hancur -- promise lama yang
    // nyimpen referensi ke panel LAMA itu harus dibuang. htmlCache
    // (string markup) tetap valid dipakai ulang karena tidak terikat ke
    // elemen DOM manapun.
    overviewLoadPromise = null;
    systemLoadPromise = null;
    batteryLoadPromise = null;
    taskLoadPromise = null;
    pmPendingUnitId = null;

    bindTabs();
    showPanel("overview");
    loadOverview();
  };

  function bindTabs() {
    document.querySelectorAll("#pmTabs .pm-tab").forEach((btn) => {
      btn.onclick = () => switchTab(btn.getAttribute("data-tab"));
    });
  }

  function switchTab(tab) {
    if (!tab) return;
    pmActiveTab = tab;

    document.querySelectorAll("#pmTabs .pm-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-tab") === tab);
    });

    showPanel(tab);

    if (tab === "overview") loadOverview();
    if (tab === "system") loadSystem();
    if (tab === "battery") loadBattery();
    if (tab === "task") {
      loadTask().then(() => {
        // Kalau tab ini sudah pernah di-load sebelumnya di kunjungan yang
        // sama, loadTask() TIDAK fetch/init ulang (lihat cache di atas) —
        // jadi refresh manual di sini supaya perubahan yang baru dibuat di
        // tab System Information (unit sama) langsung kelihatan tanpa
        // perlu reload halaman.
        if (typeof window.__tmRefresh === "function") window.__tmRefresh();
      });
    }
  }

  function showPanel(tab) {
    document.querySelectorAll(".pm-tab-panel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.getAttribute("data-panel") === tab);
    });
  }

  // ===========================================================
  // LAZY LOADERS
  // ===========================================================
  function loadOverview() {
    if (overviewLoadPromise) return overviewLoadPromise;

    const panel = document.getElementById("pmPanel-overview");
    if (!panel) {
      console.error("[project-monitoring] #pmPanel-overview tidak ditemukan di DOM.");
      return Promise.resolve();
    }

    // Markup sudah pernah di-fetch sebelumnya di sesi ini -> pasang
    // langsung dari cache, TANPA network round-trip. Ini SELAIN DARI
    // pdRealDataLoadedOnce di project-detail.js (yang cache DATA-nya) --
    // di sini yang di-cache kerangka HTML-nya sendiri.
    if (htmlCache.overview !== null) {
      panel.innerHTML = htmlCache.overview;
      if (typeof initProjectDetail === "function") {
        try {
          initProjectDetail();
        } catch (e) {
          console.error("[project-monitoring] initProjectDetail error:", e);
        }
      }
      if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
      overviewLoadPromise = Promise.resolve();
      return overviewLoadPromise;
    }

    overviewLoadPromise = fetch("pages/project-detail.html")
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status + " saat fetch project-detail.html");
        return res.text();
      })
      .then((html) => {
        htmlCache.overview = html;
        panel.innerHTML = html;
        if (typeof initProjectDetail === "function") {
          try {
            initProjectDetail();
          } catch (e) {
            console.error("[project-monitoring] initProjectDetail error:", e);
            panel.innerHTML += `<p style="padding:12px;color:red;">Sebagian konten Project Overview gagal dimuat (lihat console: ${esc(String(e.message || e))}).</p>`;
          }
        }
        if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
      })
      .catch((err) => {
        console.error("[project-monitoring] loadOverview error:", err);
        overviewLoadPromise = null; // supaya bisa dicoba fetch ulang, bukan stuck permanen
        panel.innerHTML = `<p style="padding:20px;color:red;">Gagal memuat Project Overview: ${esc(String(err.message || err))}</p>`;
      });

    return overviewLoadPromise;
  }

  function loadSystem() {
    if (systemLoadPromise) return systemLoadPromise;

    const panel = document.getElementById("pmPanel-system");
    if (!panel) {
      console.error("[project-monitoring] #pmPanel-system tidak ditemukan di DOM.");
      return Promise.resolve();
    }

    if (htmlCache.system !== null) {
      panel.innerHTML = htmlCache.system;
      if (typeof initSystemInformation === "function") {
        try {
          initSystemInformation();
        } catch (e) {
          console.error("[project-monitoring] initSystemInformation error:", e);
        }
      }
      if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
      bindNeedMaintenanceButton();
      systemLoadPromise = Promise.resolve();
      return systemLoadPromise;
    }

    systemLoadPromise = fetch("pages/system-information.html")
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status + " saat fetch system-information.html");
        return res.text();
      })
      .then((html) => {
        htmlCache.system = html;
        panel.innerHTML = html;
        if (typeof initSystemInformation === "function") {
          try {
            initSystemInformation();
          } catch (e) {
            console.error("[project-monitoring] initSystemInformation error:", e);
            panel.innerHTML += `<p style="padding:12px;color:red;">Sebagian konten System Information gagal dimuat (lihat console: ${esc(String(e.message || e))}).</p>`;
          }
        }
        if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
        bindNeedMaintenanceButton();
      })
      .catch((err) => {
        console.error("[project-monitoring] loadSystem error:", err);
        systemLoadPromise = null;
        panel.innerHTML = `<p style="padding:20px;color:red;">Gagal memuat System Information: ${esc(String(err.message || err))}</p>`;
      });

    return systemLoadPromise;
  }

  function loadBattery() {
    if (batteryLoadPromise) return batteryLoadPromise;

    const panel = document.getElementById("pmPanel-battery");
    if (!panel) {
      console.error("[project-monitoring] #pmPanel-battery tidak ditemukan di DOM.");
      return Promise.resolve();
    }

    if (htmlCache.battery !== null) {
      panel.innerHTML = htmlCache.battery;
      if (typeof initBatteryStation === "function") {
        try {
          initBatteryStation();
        } catch (e) {
          console.error("[project-monitoring] initBatteryStation error:", e);
        }
      }
      if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
      batteryLoadPromise = Promise.resolve();
      return batteryLoadPromise;
    }

    batteryLoadPromise = fetch("pages/battery-station.html")
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status + " saat fetch battery-station.html");
        return res.text();
      })
      .then((html) => {
        htmlCache.battery = html;
        panel.innerHTML = html;
        if (typeof initBatteryStation === "function") {
          try {
            initBatteryStation();
          } catch (e) {
            console.error("[project-monitoring] initBatteryStation error:", e);
            panel.innerHTML += `<p style="padding:12px;color:red;">Sebagian konten Battery Station gagal dimuat (lihat console: ${esc(String(e.message || e))}).</p>`;
          }
        }
        if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
      })
      .catch((err) => {
        console.error("[project-monitoring] loadBattery error:", err);
        batteryLoadPromise = null;
        panel.innerHTML = `<p style="padding:20px;color:red;">Gagal memuat Battery Station: ${esc(String(err.message || err))}</p>`;
      });

    return batteryLoadPromise;
  }

  function loadTask() {
    if (taskLoadPromise) return taskLoadPromise;

    const panel = document.getElementById("pmPanel-task");
    if (!panel) {
      console.error("[project-monitoring] #pmPanel-task tidak ditemukan di DOM.");
      return Promise.resolve();
    }

    if (htmlCache.task !== null) {
      panel.innerHTML = htmlCache.task;
      if (typeof initTaskManagement === "function") {
        try {
          initTaskManagement();
        } catch (e) {
          console.error("[project-monitoring] initTaskManagement error:", e);
        }
      }
      if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
      taskLoadPromise = Promise.resolve();
      return taskLoadPromise;
    }

    taskLoadPromise = fetch("pages/task-management.html")
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status + " saat fetch task-management.html");
        return res.text();
      })
      .then((html) => {
        htmlCache.task = html;
        panel.innerHTML = html;
        if (typeof initTaskManagement === "function") {
          try {
            initTaskManagement();
          } catch (e) {
            console.error("[project-monitoring] initTaskManagement error:", e);
            panel.innerHTML += `<p style="padding:12px;color:red;">Sebagian konten Task Management gagal dimuat (lihat console: ${esc(String(e.message || e))}).</p>`;
          }
        }
        if (typeof applyLanguage === "function") applyLanguage(getSavedLanguage());
      })
      .catch((err) => {
        console.error("[project-monitoring] loadTask error:", err);
        taskLoadPromise = null;
        panel.innerHTML = `<p style="padding:20px;color:red;">Gagal memuat Task Management: ${esc(String(err.message || err))}</p>`;
      });

    return taskLoadPromise;
  }

  // Helper escape kecil supaya pesan error aman ditaruh di innerHTML
  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ===========================================================
  // BRIDGE: System Information -> Task Management
  // Tombol "Ajukan Task Maintenance" di kartu bawah System
  // Information memanggil ini supaya pindah ke tab Task
  // Management dan langsung membuka form tambah jadwal untuk
  // unit yang sedang dilihat.
  // ===========================================================
  function bindNeedMaintenanceButton() {
    const btn = document.getElementById("siNeedMaintenanceBtn");
    if (!btn) return;

    btn.onclick = () => {
      const nameEl = document.getElementById("siDetailName");
      const unitName = nameEl ? nameEl.textContent.trim() : "";
      const sys = (window.__siSystems || []).find(
        (s) => s.basic && s.basic.systemName === unitName
      );
      window.pmGoToTaskManagement(sys ? sys.id : null);
    };
  }

  // Dipanggil dari tombol di atas (dan bisa dipanggil dari mana
  // saja) untuk pindah ke tab Task Management dengan unit
  // tertentu sudah terpilih di form "Tambah Unit Bermasalah".
  window.pmGoToTaskManagement = function (unitId) {
    pmPendingUnitId = unitId || null;
    switchTab("task");

    loadTask().then(() => {
      if (pmPendingUnitId && typeof window.tmOpenAddForUnit === "function") {
        const unitId2 = pmPendingUnitId;
        pmPendingUnitId = null;
        // beri jeda kecil supaya DOM task-management selesai ter-render
        setTimeout(() => window.tmOpenAddForUnit(unitId2), 30);
      }
    });
  };

  // Dipanggil dari master/header/header.js ketika user klik
  // notifikasi task ("Task Dijadwalkan" / "Laporan Task Diterima")
  // di bell — pindah ke tab Task Management lalu sorot entry yang
  // dimaksud lewat window.tmFocusEntry (js/task-management.js).
  window.pmGoToTaskEntry = function (kind, unitId, idx) {
    switchTab("task");

    loadTask().then(() => {
      if (typeof window.tmFocusEntry === "function") {
        // beri jeda kecil supaya DOM task-management selesai ter-render
        setTimeout(() => window.tmFocusEntry(kind, unitId, idx), 30);
      }
    });
  };

  // Dipanggil dari master/header/header.js untuk notifikasi "Jadwal
  // Dihapus" — entry-nya sudah tidak ada lagi jadi tidak ada yang bisa
  // disorot, cukup pindah ke tab Task Management saja.
  window.pmGoToTaskTab = function () {
    switchTab("task");
    return loadTask();
  };

})();