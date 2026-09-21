// =============================
// Page: Add New Project
// Called by js/main.js's loadPage() every time this page is
// routed to — NOT on DOMContentLoaded, since this fragment is
// fetched and injected into #page-root long after that event
// has already fired. Sidebar/header are loaded once by
// index.html and must not be reloaded here.
// =============================

function initAddProject() {

  // ---------- Dynamic Inverter Tab Logic ----------
  const tabsNav = document.getElementById('apInverterTabs');
  const contentsContainer = document.getElementById('apInverterContents');
  const addInverterBtn = document.getElementById('apAddInverterBtn');

  // Switch Active Tab function
  function switchTab(inverterId) {
    // Tab buttons
    document.querySelectorAll('.ap-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === String(inverterId));
    });

    // Tab contents (only 1 visible at a time)
    document.querySelectorAll('.ap-tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.dataset.inverter === String(inverterId));
    });
  }

  // Handle Tab Click & Remove Click
  tabsNav.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.ap-tab-close');
    const tabBtn = e.target.closest('.ap-tab-btn');

    if (closeBtn) {
      e.stopPropagation();
      const targetId = closeBtn.dataset.close;
      openRemoveInverterConfirm(targetId);
      return;
    }

    if (tabBtn) {
      const targetId = tabBtn.dataset.tab;
      switchTab(targetId);
    }
  });

  // Add New Inverter Tab
  addInverterBtn.addEventListener('click', () => {
    const id = tabsNav.querySelectorAll('.ap-tab-btn').length + 1;

    // 1. Create Tab Button
    const newTabBtn = document.createElement('button');
    newTabBtn.type = 'button';
    newTabBtn.className = 'ap-tab-btn';
    newTabBtn.dataset.tab = id;
    newTabBtn.innerHTML = `
      <span>Inverter #${id}</span>
      <span class="ap-tab-close" data-close="${id}" title="Remove Inverter">
        <i class="fa-solid fa-xmark"></i>
      </span>
    `;
    tabsNav.appendChild(newTabBtn);

    // 2. Create Tab Pane Content
    const newPane = document.createElement('div');
    newPane.className = 'ap-tab-pane';
    newPane.id = `inverterPane-${id}`;
    newPane.dataset.inverter = id;
    newPane.innerHTML = `
      <div class="ap-pane-header">
        <h4>Inverter #${id} Details</h4>
      </div>

      <div class="ap-grid-2">
        <div class="ap-field">
          <label>Inverter Brand</label>
          <input type="text" class="inv-brand" placeholder="e.g. Sungrow, SMA..">
        </div>
        <div class="ap-field">
          <label>Max Output (kW)</label>
          <input type="text" class="inv-output" placeholder="e.g. 50">
        </div>
      </div>

      <div class="ap-field">
        <label>Communicational Protocol</label>
        <select class="inv-protocol">
          <option>Select Protocol Communicational Type</option>
          <option>Modbus TCP</option>
          <option>Modbus RTU</option>
          <option>RS-485</option>
        </select>
      </div>

      <div class="ap-field">
        <label>Inverter Manual (PDF)</label>
        <div class="ap-file-row">
          <label class="ap-file-btn">
            Pilih File
            <input type="file" accept="application/pdf" hidden>
          </label>
          <span class="ap-file-name">Tidak ada file yang dipilih</span>
        </div>
      </div>

      <p class="ap-subtitle">Solar Panel Properties</p>

      <div class="ap-grid-2">
        <div class="ap-field">
          <label>Model</label>
          <input type="text" class="pv-model" placeholder="Panel Model">
        </div>
        <div class="ap-field">
          <label>PV Installed (kW)</label>
          <input type="text" class="pv-installed" placeholder="e.g. 100">
        </div>
      </div>

      <div class="ap-grid-2">
        <div class="ap-field">
          <label>Panel Size (W)</label>
          <input type="text" class="pv-size" placeholder="e.g. 450">
        </div>
        <div class="ap-field">
          <label>Cell Type</label>
          <select class="pv-cell">
            <option>Select Cell Type</option>
            <option>Monocrystalline</option>
            <option>Polycrystalline</option>
            <option>Thin Film</option>
          </select>
        </div>
      </div>
    `;

    contentsContainer.appendChild(newPane);

    // Switch to newly created tab
    switchTab(id);
  });

  // ---------- Confirmation Pop-up: Remove Inverter ----------
  const removeInverterOverlay = document.getElementById('apRemoveInverterOverlay');
  const removeInverterTitle = document.getElementById('apRemoveInverterTitle');
  const cancelRemoveInverterBtn = document.getElementById('apCancelRemoveInverterBtn');
  const confirmRemoveInverterBtn = document.getElementById('apConfirmRemoveInverterBtn');

  let pendingRemoveId = null;

  function openRemoveInverterConfirm(id) {
    pendingRemoveId = id;
    const tabBtn = tabsNav.querySelector(`.ap-tab-btn[data-tab="${id}"]`);
    const label = tabBtn ? tabBtn.querySelector('span')?.textContent : `Inverter #${id}`;
    removeInverterTitle.textContent = `Hapus ${label}?`;
    removeInverterOverlay.classList.add('is-visible');
  }

  function closeRemoveInverterConfirm() {
    pendingRemoveId = null;
    removeInverterOverlay.classList.remove('is-visible');
  }

  cancelRemoveInverterBtn.addEventListener('click', closeRemoveInverterConfirm);

  removeInverterOverlay.addEventListener('click', (e) => {
    if (e.target === removeInverterOverlay) {
      closeRemoveInverterConfirm();
    }
  });

  confirmRemoveInverterBtn.addEventListener('click', () => {
    if (pendingRemoveId !== null) {
      removeInverterTab(pendingRemoveId);
    }
    closeRemoveInverterConfirm();
  });

  // Remove Inverter Tab
  function removeInverterTab(id) {
    const tabBtn = tabsNav.querySelector(`.ap-tab-btn[data-tab="${id}"]`);
    const pane = contentsContainer.querySelector(`.ap-tab-pane[data-inverter="${id}"]`);

    const isActive = tabBtn.classList.contains('active');

    if (tabBtn) tabBtn.remove();
    if (pane) pane.remove();

    // Renumber remaining tabs so they stay sequential (1, 2, 3...) instead of
    // keeping old numbers / jumping ahead
    renumberInverterTabs();

    // If removed tab was active, activate the last tab remaining
    if (isActive) {
      const remainingTabs = tabsNav.querySelectorAll('.ap-tab-btn');
      if (remainingTabs.length > 0) {
        const lastTabId = remainingTabs[remainingTabs.length - 1].dataset.tab;
        switchTab(lastTabId);
      }
    }
  }

  // Renumber all remaining inverter tabs/panes sequentially (1, 2, 3...)
  function renumberInverterTabs() {
    const tabBtns = Array.from(tabsNav.querySelectorAll('.ap-tab-btn'));

    tabBtns.forEach((tabBtn, idx) => {
      const oldId = tabBtn.dataset.tab;
      const newId = String(idx + 1);
      if (oldId === newId) return;

      const pane = contentsContainer.querySelector(`.ap-tab-pane[data-inverter="${oldId}"]`);

      // Update tab button
      tabBtn.dataset.tab = newId;
      const labelSpan = tabBtn.querySelector('span:not(.ap-tab-close)');
      if (labelSpan) labelSpan.textContent = `Inverter #${newId}`;
      const closeSpan = tabBtn.querySelector('.ap-tab-close');
      if (closeSpan) closeSpan.dataset.close = newId;

      // Update pane
      if (pane) {
        pane.dataset.inverter = newId;
        pane.id = `inverterPane-${newId}`;
        const heading = pane.querySelector('.ap-pane-header h4');
        if (heading) heading.textContent = `Inverter #${newId} Details`;
      }
    });
  }

  // File Input Name Preview listener (scoped to this page's own
  // wrapper, not `document` — this function re-runs every time the
  // user navigates back to this page, and a document-level listener
  // would otherwise keep piling up duplicates across visits)
  const apWrap = document.querySelector('.ap-wrap');
  apWrap.addEventListener('change', (e) => {
    if (e.target.matches('input[type="file"]')) {
      const nameSpan = e.target.closest('.ap-file-row').querySelector('.ap-file-name');
      nameSpan.textContent = e.target.files.length ? e.target.files[0].name : 'Tidak ada file yang dipilih';
    }
  });

  // ---------- Modal Pop-up on "Add New Project" submit ----------
  const apForm = document.getElementById('apForm');
  const modalOverlay = document.getElementById('apModalOverlay');
  const modalSummary = document.getElementById('apModalSummary');
  const closeModalBtn = document.getElementById('apCloseModalBtn');

  // Label kategori untuk ditampilkan di summary modal (value select
  // sudah sama persis dengan key yang dipakai project-selector.js:
  // bss / rooftop / fish-farm).
  const CATEGORY_LABELS = {
    bss: 'Solaris BSS',
    rooftop: 'Rooftop Solar',
    'fish-farm': 'Solar Fish Farm'
  };

  // Bikin object "system" (1 per tab inverter) dengan schema yang
  // sama seperti data System Information, supaya langsung kompatibel
  // dengan halaman System Information — cuma ditambah basic.projectId
  // supaya bisa difilter per proyek. Angka/telemetry yang belum ada
  // datanya diisi "-" (pola yang sama dipakai di seedSystems()).
  function buildSystemFromPane(pane, idx, projectId, projectName, projectLocation) {
    const brand = pane.querySelector('.inv-brand')?.value || `Inverter ${idx + 1}`;
    const output = pane.querySelector('.inv-output')?.value || '-';
    const protocol = pane.querySelector('.inv-protocol')?.value || '-';
    const pvModel = pane.querySelector('.pv-model')?.value || '-';
    const pvInstalled = pane.querySelector('.pv-installed')?.value || '-';
    const pvSize = pane.querySelector('.pv-size')?.value || '-';
    const cellType = pane.querySelector('.pv-cell')?.value || '-';
    const today = new Date().toISOString().slice(0, 10);

    const emptyChart = (typeof window.__siGenChartData === 'function')
      ? window.__siGenChartData(0)
      : {
          today: { labels: [], voltage: [], current: [], power: [] },
          week: { labels: [], voltage: [], current: [], power: [] },
          month: { labels: [], voltage: [], current: [], power: [] }
        };

    return {
      id: (window.PC_genId ? window.PC_genId('sys') : ('sys-' + Date.now() + '-' + idx)),
      status: 'pending',
      basic: {
        systemName: `${projectName} - Inverter ${idx + 1}`,
        inverter1: `Inverter ${idx + 1}`,
        inverterBrand: brand,
        projectId: projectId
      },
      systemOverview: { installedDate: today, lastUpdated: today, peakPowerKwp: pvInstalled, address: projectLocation },
      inverterOverview: {
        deviceId: '-', tbDeviceId: '-', deviceName: '-', deviceSn: '-', deviceType: 'Inverter', provider: '-',
        inverterType: '-', maximumOutputKw: output, communicationProtocol: protocol,
        installationDate: today, lastMaintenance: '-', nextMaintenance: '-', maintenanceFrequency: '-'
      },
      pvPanelOverview: {
        pvId: '-', pvModel: pvModel, cellType: cellType, individualPanelSizeM2: pvSize, pvInstalledKw: pvInstalled,
        installationDate: today, lastMaintenance: '-', nextMaintenance: '-', maintenanceFrequency: '-'
      },
      deviceOverview: { firmware: '-', modbusStatus: '-', uptimeSeconds: '-', lastSeen: '-', ambientTemperatureC: '-', humidityPct: '-', fanRelay: '-', alarmRegisterStatus: '-' },
      electricalQuality: { frequencyHz: '50', reactivePowerKvar: '-', powerFactor: '-' },
      diagnostics: { leakCurrentMa: '-', insulationResistanceKohm: '-', inverterStatus: '-', faultCode: '-' },
      futureMaintenance: [],
      historicalMaintenance: [],
      alarmHistory: [],
      chart: emptyChart,
      health: 0
    };
  }

  let apLastCreatedProject = null;

  apForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const projName = document.getElementById('apProjectName').value || '-';
    const projLoc = document.getElementById('apProjectLocation').value || '-';
    const categoryVal = document.getElementById('apCategory')?.value || '';
    const categoryLabel = CATEGORY_LABELS[categoryVal] || '-';
    const lat = parseFloat(document.getElementById('apLat')?.value) || 0;
    const lng = parseFloat(document.getElementById('apLng')?.value) || 0;
    const totalInverters = document.querySelectorAll('.ap-tab-pane').length;

    // Collect summary info of inverters
    let inverterBrands = [];
    document.querySelectorAll('.ap-tab-pane').forEach((pane, idx) => {
      const brandInput = pane.querySelector('.inv-brand');
      const brandVal = brandInput && brandInput.value ? brandInput.value : `Inverter #${idx + 1}`;
      inverterBrands.push(brandVal);
    });

    // ---- Persist: proyek baru + system (inverter) per tab ----
    let newProject = null;
    if (typeof window.PC_addUserProject === 'function') {
      newProject = window.PC_addUserProject({
        name: projName,
        location: projLoc,
        category: categoryVal || 'rooftop',
        lat, lng,
        status: 'online',
        alerts: 0,
        saved: false,
        capacityMWp: 0,
        generatedMWh: 0,
        co2AvoidedT: 0,
        dailyTargetMWh: 0,
        timezone: document.getElementById('apTimeZone')?.value || '-',
        partner: document.getElementById('apPartner')?.value || '-',
        partnerType: document.getElementById('apPartnerType')?.value || '-',
        projectSystem: document.getElementById('apProjectSystem')?.value || '-',
        projectSchema: document.getElementById('apProjectSchema')?.value || '-',
        projectType: document.getElementById('apProjectType')?.value || '-'
      });

      if (newProject && typeof window.PC_addUserSystems === 'function') {
        const newSystems = Array.from(document.querySelectorAll('.ap-tab-pane')).map((pane, idx) =>
          buildSystemFromPane(pane, idx, newProject.id, newProject.name, newProject.location)
        );
        window.PC_addUserSystems(newSystems);
      }

      if (newProject && typeof window.PC_setActiveProject === 'function') {
        window.PC_setActiveProject(newProject);
      }
    }
    apLastCreatedProject = newProject;

    modalSummary.innerHTML = `
      <div class="ap-modal-summary-item">
        <span class="ap-modal-summary-label">Project Name:</span>
        <span class="ap-modal-summary-val">${projName}</span>
      </div>
      <div class="ap-modal-summary-item">
        <span class="ap-modal-summary-label">Location:</span>
        <span class="ap-modal-summary-val">${projLoc}</span>
      </div>
      <div class="ap-modal-summary-item">
        <span class="ap-modal-summary-label">Category:</span>
        <span class="ap-modal-summary-val">${categoryLabel}</span>
      </div>
      <div class="ap-modal-summary-item">
        <span class="ap-modal-summary-label">Total Inverter:</span>
        <span class="ap-modal-summary-val">${totalInverters} Unit (${inverterBrands.join(', ')})</span>
      </div>
    `;

    // Show popup modal
    modalOverlay.classList.add('is-visible');
  });

  // Klik "OK, Lihat di Project Selector" -> tutup modal lalu bawa
  // user langsung ke Project Selector, dengan proyek yang baru saja
  // ditambahkan otomatis jadi proyek aktif (lihat PC_setActiveProject
  // di atas) sehingga langsung bisa lanjut ke Project Monitoring
  // (System Information, Battery Station, Task Management) dari sana.
  closeModalBtn.addEventListener('click', () => {
    modalOverlay.classList.remove('is-visible');
    if (apLastCreatedProject && typeof loadPage === 'function') {
      loadPage('pages/project-selector.html');
    }
  });

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.classList.remove('is-visible');
    }
  });

}