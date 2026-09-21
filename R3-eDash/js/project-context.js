/* ============================================================
   Project Context — 360eDash
   Modul kecil bersama (di-load lebih dulu di index.html, sebelum
   add-project.js / project-selector.js / dashboard.js /
   project-detail.js / system-information.js / battery-station.js /
   task-management.js) supaya semua halaman itu bisa:

     1. Tahu proyek apa saja yang baru ditambahkan user lewat
        halaman "Add New Project" (disimpan di localStorage, karena
        daftar proyek bawaan adalah data statis yang tidak bisa
        ditulis balik dari browser).
     2. Tahu proyek mana yang sedang "aktif" (terakhir dipilih di
        Project Selector, atau baru saja ditambahkan) supaya
        System Information / Battery Station / Task Management di
        dalam Project Monitoring ikut ke-filter sesuai proyek itu.

   Storage:
     - localStorage["edash-user-projects"]  -> array proyek baru
       (schema field-nya SAMA dengan data proyek bawaan:
        name, location, category, lat, lng, status, alerts, saved,
        capacityMWp, generatedMWh, co2AvoidedT, dailyTargetMWh)
       + field tambahan: id, timezone, partner, partnerType,
         projectSystem, projectSchema, projectType, inverters[]
     - localStorage["edash-user-systems"]   -> array "system" (per
       inverter) yang dibuat dari form Add Project, dengan schema
       SAMA dengan data System Information + field basic.projectId
       supaya System Information bisa filter per proyek.
     - localStorage["edash-active-project"] -> { id, name, category }
       proyek yang sedang dipantau di Project Monitoring.

   "tawabi" (PLTS Tawabi) dan proyek dummy/legacy lain yang sudah
   ada sebelumnya TIDAK disentuh oleh modul ini — mereka tetap
   dianggap "builtin" dan tetap tampil apa adanya kalau belum ada
   proyek aktif yang dipilih (supaya behaviour lama tidak berubah).
============================================================= */

(function () {

  const LS_PROJECTS = "edash-user-projects";
  const LS_SYSTEMS = "edash-user-systems";
  const LS_ACTIVE = "edash-active-project";

  // Kategori proyek yang tersedia di form "Add New Project".
  // value HARUS sama dengan key yang sudah dipakai di
  // js/project-selector.js (PS_CATEGORY_COLORS/LABELS/ICONS).
  const CATEGORIES = [
    { value: "bss", label: "Solaris BSS" },
    { value: "rooftop", label: "Rooftop Solar" },
    { value: "fish-farm", label: "Solar Fish Farm" }
  ];

  function safeParse(raw, fallback) {
    try {
      const v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function getUserProjects() {
    return safeParse(localStorage.getItem(LS_PROJECTS), []);
  }

  function saveUserProjects(list) {
    try {
      localStorage.setItem(LS_PROJECTS, JSON.stringify(list));
    } catch (e) {
      console.warn("[project-context] Gagal menyimpan edash-user-projects:", e.message);
    }
  }

  function getUserSystems() {
    return safeParse(localStorage.getItem(LS_SYSTEMS), []);
  }

  function saveUserSystems(list) {
    try {
      localStorage.setItem(LS_SYSTEMS, JSON.stringify(list));
    } catch (e) {
      console.warn("[project-context] Gagal menyimpan edash-user-systems:", e.message);
    }
  }

  function genId(prefix) {
    return (prefix || "proj") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  // Tambah 1 proyek baru (dari form Add Project). Mengembalikan
  // object proyek lengkap (sudah punya id) supaya bisa langsung
  // dipakai caller (mis. buat systems / set active project).
  function addUserProject(project) {
    const list = getUserProjects();
    const withId = Object.assign({ id: genId("proj") }, project);
    list.push(withId);
    saveUserProjects(list);
    return withId;
  }

  // Tambah beberapa system sekaligus (dari tab-tab inverter di form
  // Add Project). Setiap system WAJIB sudah punya basic.projectId.
  function addUserSystems(systems) {
    if (!Array.isArray(systems) || !systems.length) return;
    const list = getUserSystems();
    systems.forEach((s) => list.push(s));
    saveUserSystems(list);

    // Kalau System Information sudah pernah dibuka di sesi ini
    // (window.__siSystems sudah ada di memori), langsung suntikkan
    // juga supaya user tidak perlu refresh untuk melihatnya.
    if (Array.isArray(window.__siSystems)) {
      systems.forEach((s) => {
        if (!window.__siSystems.some((existing) => existing.id === s.id)) {
          window.__siSystems.unshift(s);
        }
      });
    }
  }

  // "tawabi" adalah satu-satunya proyek "builtin" yang punya data
  // real/dummy lengkap di seluruh halaman (Project Overview, System
  // Information seed, Battery Station). Proyek lain yang TIDAK ada
  // di localStorage user-projects (mis. dummy list PS_DUMMY_PROJECTS
  // di project-selector.js) juga diperlakukan sebagai "builtin" —
  // supaya perilaku lama (sebelum fitur Add Project ini) tidak
  // berubah untuk proyek-proyek yang sudah ada duluan.
  function isUserProjectId(id) {
    if (!id) return false;
    return getUserProjects().some((p) => p.id === id);
  }

  function isBuiltinProject(id) {
    return !isUserProjectId(id);
  }

  function getActiveProject() {
    return safeParse(localStorage.getItem(LS_ACTIVE), null);
  }

  // Terima object proyek (harus punya id & name) ATAU sebuah id
  // string (dicari dulu ke user-projects, kalau tidak ketemu
  // dianggap proyek builtin dan cuma id-nya yang disimpan).
  function setActiveProject(projectOrId) {
    let project = null;

    if (projectOrId && typeof projectOrId === "object") {
      project = {
        id: projectOrId.id || projectOrId.name,
        name: projectOrId.name,
        category: projectOrId.category || null
      };
    } else if (typeof projectOrId === "string") {
      const match = getUserProjects().find((p) => p.id === projectOrId);
      project = match
        ? { id: match.id, name: match.name, category: match.category }
        : { id: projectOrId, name: projectOrId, category: null };
    }

    if (!project || !project.id) return;

    try {
      localStorage.setItem(LS_ACTIVE, JSON.stringify(project));
    } catch (e) {
      console.warn("[project-context] Gagal menyimpan edash-active-project:", e.message);
    }

    document.dispatchEvent(new CustomEvent("edash:activeprojectchange", { detail: project }));
  }

  window.PC_CATEGORIES = CATEGORIES;
  window.PC_genId = genId;
  window.PC_getUserProjects = getUserProjects;
  window.PC_addUserProject = addUserProject;
  window.PC_getUserSystems = getUserSystems;
  window.PC_addUserSystems = addUserSystems;
  window.PC_getActiveProject = getActiveProject;
  window.PC_setActiveProject = setActiveProject;
  window.PC_isBuiltinProject = isBuiltinProject;

})();
