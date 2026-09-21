/* ============================================================
   Battery VPS Discovery — 360eDash
   ------------------------------------------------------------
   Project -> System -> Device discovery for Battery Station,
   talking to the real eDashboard Core API (VPS, PostgreSQL +
   ThingsBoard), via window.edashApiFetch() (js/api-config.js).

   This mirrors the exact pattern already proven working in
   js/system-information.js (findTawabiProject() / findCoreApiProject()
   / extractTawabiSystems() / extractDevicesForSystem()) instead of
   duplicating a new/untested approach. It is pulled out into its
   own file (rather than copy-pasted into battery-station.js)
   because both pages need the same discovery logic and it should
   not be duplicated.

   MULTI-PROJECT (Agustus 2026): sebelumnya file ini cuma menerima
   sebuah "name hint" (string dicari di nama proyek), jadi hanya
   pernah kepakai untuk Tawabi -- proyek real lain di VPS (mis.
   Kasdam) tidak pernah kepanggil dari Battery Station walau
   endpoint-nya (GET /projects, /projects/:id) generik untuk semua
   proyek. Sekarang discoverDevicesForActiveProject() menerima
   localProjectId (id proyek AKTIF, sama seperti yang dipakai
   system-information.js/project-selector.js -- "tawabi" tetap id
   lokal khusus, proyek lain memakai UUID asli dari GET /projects,
   lihat psBuildProjectFromApi() di project-selector.js), lalu:
     - "tawabi" (atau kosong) -> findTawabiProject() (ID contoh dari
       dokumentasi + fallback cari nama, TIDAK berubah).
     - id lain -> di-GET langsung ke /projects/:id (id-nya SUDAH UUID
       asli backend, tidak perlu ditebak/dicari by nama lagi).
   Ini SAMA PERSIS dengan findCoreApiProject() di system-information.js
   supaya kedua halaman konsisten memanggil proyek yang sama dari VPS.

   Endpoints used (API_DOCUMENTATION.md §3.3):
     GET /api/v1/projects/:id
     GET /api/v1/projects
   Both only require a logged-in session (any role) -- NOT
   Admin360. Telemetry itself (called separately, see
   js/battery-telemetry-adapter.js) is ALSO documented
   "Akses: Authenticated" (any logged-in role, §4.3/§4.5 of
   DOKUMENTASI_API_eDASHBOARD_360ENERGY.html) -- NOT Admin360-only.

   Response shape:
     { ...project, systems: [ { ...system, inverters: [...] } ] }
   Field names actually used by the backend (per schema.ts):
     project.project_name, system.system_name, device.device_name.
   Exact nested key names ("systems" vs "units", "inverters" vs
   "devices") are NOT guaranteed by the docs, so extractSystems()/
   extractDevicesForSystem() try several plausible variants rather
   than assuming one shape.

   KASDAM HARDCODED FALLBACK REMOVED (2026-08-26): this file used to
   fall back to two hardcoded Device IDs
   (7ee849a0-9ad5-11f1-8c86-25274e65e397 /
   abe8c180-9ad7-11f1-8c86-25274e65e397) whenever the Kasdam project
   was found but its /projects/:id response carried no nested
   systems/devices. Those IDs came from
   DOKUMENTASI_API_eDASHBOARD_360ENERGY_KASDAM.pdf (§4.1/§4.2) --
   which documents a SEPARATE, standalone Kasdam-only deployment
   (its own THINGSBOARD_URL=http://31.97.222.59:8080 and its own
   DB_NAME=edashboard_kasdam_db, per that PDF §1.2), and even reuses
   the exact same placeholder project ID
   ("b0000000-0000-0000-0000-000000000001") as the generic Tawabi
   example in the main API doc -- strong evidence those IDs are
   documentation-template samples for a different backend, not
   confirmed device IDs on the VPS this app actually talks to today.
   Calling GET /devices/<that id>/telemetry/latest against the
   currently active (now-unified, per backend team) VPS is what was
   causing the 20s timeout on the Battery Station Kasdam card --
   the backend's ThingsBoard call for an unknown device id was
   hanging instead of failing fast. Now that project data has been
   unified onto one shared VPS/DB, there is no more need to guess --
   /projects/:id is trusted directly for every project including
   Kasdam. If a project genuinely has no systems/devices registered
   yet on the VPS, that surfaces immediately as NO_DEVICES_FOUND
   instead of a 20s hang on a stale guess.

   Naming: BVD_* (Battery VPS Discovery).
============================================================= */

(function () {

  // Example project ID from the API documentation (§3.3/§5) for
  // "PLTS Kawasan Tawabi Halmahera Selatan" -- used ONLY as a
  // first-try shortcut when resolving the "tawabi" local project id,
  // same as system-information.js. Never used as a silent fallback if
  // it 404s; the code always falls through to the real search.
  const TAWABI_PROJECT_ID_HINT = "b0000000-0000-0000-0000-000000000001";

  function safeArray(v) {
    return Array.isArray(v) ? v : [];
  }

  // findTawabiProject() -> project detail object | null
  // Isolated exactly as before (previously inlined in
  // findProjectByHint()'s "tawabi" branch) so it can be reused as-is
  // by findCoreApiProject() below.
  async function findTawabiProject() {
    try {
      const project = await window.edashApiFetch(`/projects/${TAWABI_PROJECT_ID_HINT}`);
      console.log("[battery-vps-discovery] GET /projects/:id (Tawabi, direct ID) raw response:", project);
      return project;
    } catch (e) {
      console.warn("[battery-vps-discovery] ID Tawabi langsung tidak ditemukan, coba cari via /projects:", e.message);
    }

    try {
      const list = await window.edashApiFetch("/projects");
      const arr = safeArray(list);
      const found = arr.find((p) => (p.project_name || p.projectName || p.name || "").toLowerCase().includes("tawabi"));
      if (!found) return null;
      const detail = await window.edashApiFetch(`/projects/${found.id}`);
      console.log("[battery-vps-discovery] GET /projects/:id (Tawabi, hasil pencarian) raw response:", detail);
      return detail;
    } catch (e) {
      const err = new Error(`Gagal mengambil daftar proyek dari VPS: ${e.message}`);
      err.code = e.code || "PROJECT_DISCOVERY_FAILED";
      err.status = e.status;
      throw err;
    }
  }

  // findCoreApiProject(localProjectId) -> project detail object | null
  // Generalisasi dari findProjectByHint(nameHint) lama -- lihat
  // catatan "MULTI-PROJECT" di header file ini. localProjectId di
  // sini SUDAH id lokal yang sama dipakai halaman lain
  // (PC_getActiveProject().id): "tawabi" untuk proyek Tawabi, atau
  // UUID asli backend untuk proyek lain mana pun (Kasdam, dst) --
  // jadi proyek selain Tawabi cukup di-GET langsung by ID, tidak
  // perlu ditebak/dicari lewat nama lagi.
  async function findCoreApiProject(localProjectId) {
    if (!localProjectId || localProjectId === "tawabi") return findTawabiProject();
    try {
      const project = await window.edashApiFetch(`/projects/${localProjectId}`);
      console.log(`[battery-vps-discovery] GET /projects/${localProjectId} raw response:`, project);
      return project;
    } catch (e) {
      const err = new Error(`Gagal mengambil proyek ${localProjectId} dari VPS: ${e.message}`);
      err.code = e.code || "PROJECT_DISCOVERY_FAILED";
      err.status = e.status;
      throw err;
    }
  }

  // extractSystems(project) -> system[]  (nested "systems"/"units",
  // plus a couple of plausible variants seen across backend modules
  // -- e.g. /api/v1/systems is called "systems" in the docs, but a
  // /projects/:id response could reasonably nest it under a
  // differently-cased or pluralized key. Tries each in order and
  // uses the first non-empty array -- never assumes only one shape.)
  function extractSystems(project) {
    if (!project) return [];
    const candidates = [project.systems, project.units, project.systemUnits, project.plantUnits];
    for (const c of candidates) {
      if (safeArray(c).length) return safeArray(c);
    }
    return [];
  }

  // extractDevicesForSystem(...) -> device[]  (nested "inverters"/
  // "devices", falling back to project-level flat lists matched by
  // systemId, then to positional pairing -- same fallback chain as
  // system-information.js's extractDevicesForSystem()).
  function extractDevicesForSystem(project, system, systemIndex, totalSystems) {
    const nestedCandidates = system && [system.inverters, system.devices, system.deviceList];
    let nested = [];
    if (nestedCandidates) {
      for (const c of nestedCandidates) {
        if (safeArray(c).length) { nested = safeArray(c); break; }
      }
    }
    if (nested.length) return nested;

    let projectDevices = [];
    for (const c of [project.inverters, project.devices, project.deviceList]) {
      if (safeArray(c).length) { projectDevices = safeArray(c); break; }
    }
    const matched = projectDevices.filter((d) => (d.system_id || d.systemId) === (system && system.id));
    if (matched.length) return matched;

    if (projectDevices.length === totalSystems) {
      return projectDevices[systemIndex] ? [projectDevices[systemIndex]] : [];
    }

    // No safe way to pair devices to systems -- rather than guessing
    // (which previously caused duplicate device assignment bugs, see
    // system-information.js history), only attach the unmatched pool
    // to the first system, and give every other system nothing.
    if (systemIndex === 0) return projectDevices;
    return [];
  }

  // discoverDevicesForActiveProject(localProjectId) -> DiscoveredDevice[]
  //   DiscoveredDevice = { projectId, projectName, systemId,
  //                         systemName, deviceId, deviceName }
  // localProjectId: id proyek yang SEDANG AKTIF (PC_getActiveProject().id)
  // -- "tawabi" atau UUID asli proyek VPS lain (mis. Kasdam). Lihat
  // catatan "MULTI-PROJECT" di header file ini.
  // Throws (never returns a fabricated device) when the project
  // can't be found or has no devices at all -- callers must show
  // this as an explicit error state, never a silent empty UI.
  async function discoverDevicesForActiveProject(localProjectId) {
    const project = await findCoreApiProject(localProjectId);
    if (!project || !project.id) {
      const err = new Error("Proyek tidak ditemukan di VPS.");
      err.code = "PROJECT_NOT_FOUND";
      throw err;
    }

    const projectName = project.project_name || project.projectName || project.name || null;

    const systems = extractSystems(project);

    console.log(`[battery-vps-discovery] Proyek "${projectName}" (${project.id}) -- ${systems.length} system(s) ditemukan dari /projects/:id.`, project);

    const result = [];

    systems.forEach((system, i) => {
      const devices = extractDevicesForSystem(project, system, i, systems.length);
      devices.forEach((device) => {
        const deviceId = device.id || device.thingsboardDeviceId;
        if (!deviceId) return; // never invent an ID
        result.push({
          projectId: project.id,
          projectName,
          systemId: (system && system.id) || null,
          systemName: (system && (system.system_name || system.systemName || system.name)) || null,
          deviceId,
          deviceName: device.device_name || device.name || device.deviceName || deviceId,
        });
      });
    });

    if (!result.length) {
      const err = new Error(`Proyek "${projectName || localProjectId}" ditemukan di VPS, tapi /projects/:id belum membawa system/device (inverter) apa pun untuk proyek ini -- kemungkinan device-nya belum didaftarkan di database yang sekarang aktif (lihat POST /devices, /systems).`);
      err.code = "NO_DEVICES_FOUND";
      throw err;
    }

    return result;
  }

  window.BVD_discoverDevicesForActiveProject = discoverDevicesForActiveProject;

})();