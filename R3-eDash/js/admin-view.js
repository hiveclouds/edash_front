// =============================
// Page: Admin View
// Sekarang connect penuh ke backend Hono (bukan dummy dataset lagi).
// Endpoint yang dipakai (lihat js/telemetry-api.js pola credentials:
// "include" yang sama):
//   GET    /api/v1/admin/users
//   POST   /api/v1/admin/users
//   DELETE /api/v1/admin/users/:id
//   PUT    /api/v1/admin/users/:id/role       (ganti role_key akun)
//   GET    /api/v1/admin/assignable-projects
//   PUT    /api/v1/admin/users/:id/reassign-project   (staff, 1 project)
//   POST   /api/v1/admin/users/:id/projects           (operator, tambah)
//   DELETE /api/v1/admin/users/:id/projects/:projectId (operator, lepas)
//
// Backend SUDAH menegakkan siapa boleh apa (root vs operator) --
// frontend ini cuma menyesuaikan tampilan (sembunyikan tombol yang
// pasti bakal ditolak backend), TIDAK jadi satu-satunya lapisan
// keamanan.
// =============================

function initAdminView() {

  const isRoot = sessionStorage.getItem('edash-role') === 'root';
  const isOperatorRole = sessionStorage.getItem('edash-role') === 'operator';
  // Dipakai untuk cegah admin menghapus/mengubah role akun dirinya sendiri
  // dari tabel ini (kalau mau, tetap bisa lewat halaman Setting) -- backend
  // juga sebaiknya menegakkan batasan yang sama, ini cuma guard di UI.
  const currentUserId = sessionStorage.getItem('edash-user-id') || '';

  const ROLE_LABELS = {
    root: '360master',
    biofloc_intern_lead: '360 Smart Biofloc Intern Lead',
    rems_intern_lead: '360 REMS Intern Lead',
    biofloc_intern: '360 Smart Biofloc Intern',
    rems_intern: '360 REMS Intern',
    operator: 'Operator',
    staff: 'Staff',
  };
  function roleLabel(roleKey) {
    return ROLE_LABELS[roleKey] || roleKey;
  }

  // Operator cuma boleh create/lihat "staff" -- sembunyikan pilihan
  // role lain dari form & filter, sesuai batasan yang sudah ditegakkan
  // backend juga.
  if (isOperatorRole) {
    document.querySelectorAll('#umRoleFilter option').forEach((opt) => {
      if (opt.value && opt.value !== 'staff') opt.remove();
    });
    document.querySelectorAll('#umNewRole option').forEach((opt) => {
      if (opt.value !== 'staff') opt.remove();
    });
    document.getElementById('umNewRole').value = 'staff';
    document.getElementById('umNewRole').disabled = true;

    // Kartu statistik "Admin 360" & "Intern" tidak relevan buat operator --
    // scope-nya cuma pernah lihat operator/staff LAIN di project yang sama
    // dengannya (lihat AdminService.listUsers cabang role_key === 'operator'
    // di backend), tidak pernah lihat akun root/intern sama sekali, jadi
    // kedua kartu itu SELALU "0" dan cuma bikin bingung/berantakan kalau
    // ditampilkan. root/internal (isRoot & tier internal) tetap lihat
    // ke-5 kartu seperti biasa -- ini hardcode khusus role operator saja.
    document.getElementById('statAdmin360').closest('.um-stat-card').style.display = 'none';
    document.getElementById('statIntern').closest('.um-stat-card').style.display = 'none';
  }

  // Pakai edashApiFetch (api-config.js) yang sudah dipakai konsisten di
  // seluruh halaman lain -- sebelumnya file ini punya apiFetch() sendiri
  // yang TIDAK auto-redirect ke login pas dapat 401 & tidak punya
  // timeout, jadi kalau sesi expired di halaman ini, yang kejadian cuma
  // error generik senyap, bukan diarahkan ke login kayak halaman lain.
  async function apiFetch(path, options = {}) {
    return window.edashApiFetch(path, options);
  }

  let users = [];
  let projects = [];

  // ---------- Rows-per-page (10/25/50/100, disimpan di localStorage) ----------
  const UM_PAGE_SIZE_KEY = 'edash-admin-view-page-size';
  const UM_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
  function loadPageSize() {
    const saved = Number(localStorage.getItem(UM_PAGE_SIZE_KEY));
    return UM_PAGE_SIZE_OPTIONS.includes(saved) ? saved : 10;
  }
  let PAGE_SIZE = loadPageSize();
  let currentPage = 1;

  const tbody = document.getElementById('umTableBody');
  const emptyState = document.getElementById('umEmpty');
  const countLabel = document.getElementById('umCount');
  const searchInput = document.getElementById('umSearch');
  const roleFilter = document.getElementById('umRoleFilter');
  const pagerEl = document.getElementById('umPager');
  const pageSizeSelect = document.getElementById('umPageSizeSelect');

  function initials(username) {
    const clean = (username || '').split('@')[0];
    const parts = clean.replace(/[._]/g, ' ').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return clean.slice(0, 2).toUpperCase();
  }

  // Sama seperti applyAvatar() di main.js (header) & renderAvatar() di
  // setting.js: pakai foto profil (user.photo_url dari backend) kalau ada,
  // fallback ke inisial kalau user belum pernah upload foto. Pembulatan
  // visualnya sendiri ditangani CSS (.um-avatar { overflow: hidden } +
  // .um-avatar img { object-fit: cover }), bukan di sini.
  function avatarMarkup(u) {
    if (u.photo_url) {
      return `<img src="${u.photo_url}" alt="${u.username}">`;
    }
    return initials(u.username);
  }

  const INTERN_ROLE_KEYS = ['biofloc_intern_lead', 'rems_intern_lead', 'biofloc_intern', 'rems_intern'];

  // "Online" kalau users.last_seen_at masih dalam 5 menit terakhir --
  // kolom itu di-update backend tiap kali /auth/me sukses (dipanggil
  // SETIAP pindah halaman + heartbeat 2 menit di js/main.js selagi tab
  // masih terbuka, lihat catatan di AuthService.refreshSession()), jadi
  // user yang tab-nya masih terbuka & login akan selalu ke-refresh
  // duluan sebelum kena batas 5 menit ini.
  const ADMIN_ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

  function umIsOnline(u) {
    if (!u.last_seen_at) return false;
    return Date.now() - new Date(u.last_seen_at).getTime() <= ADMIN_ONLINE_THRESHOLD_MS;
  }

  // "5 menit lalu" / "5 minutes ago" dst -- dipakai sebagai title/tooltip
  // pada status pill supaya admin tetap bisa lihat kapan persisnya user
  // itu terakhir aktif, bukan cuma titik hijau/abu-abu tanpa konteks.
  function umFormatLastSeen(iso, isId) {
    if (!iso) return isId ? 'Belum pernah login' : 'Never logged in';
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return isId ? 'Baru saja' : 'Just now';
    if (diffMin < 60) return isId ? `${diffMin} menit lalu` : `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return isId ? `${diffHour} jam lalu` : `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
    const diffDay = Math.floor(diffHour / 24);
    return isId ? `${diffDay} hari lalu` : `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  }

  function renderStats() {
    document.getElementById('statTotal').textContent = users.length;
    document.getElementById('statAdmin360').textContent = users.filter((u) => u.role_tier === 'root').length;
    document.getElementById('statIntern').textContent = users.filter((u) => INTERN_ROLE_KEYS.includes(u.role_key)).length;
    document.getElementById('statOperator').textContent = users.filter((u) => u.role_key === 'operator').length;
    document.getElementById('statViewer').textContent = users.filter((u) => u.role_key === 'staff').length;
  }

  function getFiltered() {
    const q = searchInput.value.trim().toLowerCase();
    const role = roleFilter.value;
    return users.filter((u) => {
      const matchesQuery = !q || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
      const matchesRole = !role || u.role_key === role;
      return matchesQuery && matchesRole;
    });
  }

  // Prev/next chevron + nomor halaman + ellipsis -- pola yang sama
  // dengan alRenderPagination() di activity-log.js dan
  // renderPagination() di ticketing.js, biar konsisten di seluruh
  // halaman eDash.
  function renderPager(totalPages) {
    pagerEl.innerHTML = '';
    if (totalPages <= 1) return;

    const mk = (label, page, opts = {}) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = label;
      if (opts.active) btn.classList.add('is-active');
      if (opts.disabled) btn.disabled = true;
      if (!opts.disabled) btn.addEventListener('click', () => { currentPage = page; renderRows(); });
      return btn;
    };
    const ell = () => {
      const s = document.createElement('span');
      s.className = 'um-pager-ellipsis';
      s.textContent = '…';
      return s;
    };

    pagerEl.appendChild(mk('<i class="fa-solid fa-chevron-left"></i>', currentPage - 1, { disabled: currentPage === 1 }));

    const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
    let prev = 0;
    [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b).forEach((p) => {
      if (prev && p - prev > 1) pagerEl.appendChild(ell());
      pagerEl.appendChild(mk(p, p, { active: p === currentPage }));
      prev = p;
    });

    pagerEl.appendChild(mk('<i class="fa-solid fa-chevron-right"></i>', currentPage + 1, { disabled: currentPage === totalPages }));
  }

  function renderRows() {
    const filtered = getFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, totalPages);
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);
    const isId = typeof getSavedLanguage === 'function' && getSavedLanguage() === 'id';

    tbody.innerHTML = '';
    pageItems.forEach((u) => {
      const tr = document.createElement('tr');
      const badgeTone = u.role_tier === 'root' ? 'is-admin' : (u.role_key === 'operator' ? 'is-operator' : 'is-viewer');
      const roleBadge = `<span class="um-badge ${badgeTone}">${roleLabel(u.role_key)}</span>`;
      const manageProjectsLabel = isId ? 'Kelola Proyek' : 'Manage Projects';
      const manageProjectsTitle = isId ? 'Kelola proyek untuk' : 'Manage projects for';

      // Kelola proyek cuma masuk akal untuk operator (banyak project)
      // dan staff (1 project). root/intern tidak punya konsep ini.
      const showProjectsBtn = u.role_key === 'operator' || u.role_key === 'staff';

      const online = umIsOnline(u);
      const statusPill = `<span class="um-status-pill ${online ? 'is-online' : 'is-offline'}" title="${umFormatLastSeen(u.last_seen_at, isId)}">
          <span class="um-status-dot"></span>${online ? 'Online' : 'Offline'}
        </span>`;

      tr.innerHTML = `
        <td>
          <div class="um-user-cell">
            <div class="um-avatar">${avatarMarkup(u)}</div>
            <div class="um-cell-name">${u.username}</div>
          </div>
        </td>
        <td><span class="um-cell-sub">${u.email}</span></td>
        <td><span class="um-cell-sub">${u.id}</span></td>
        <td>${roleBadge}</td>
        <td>${statusPill}</td>
        <td>
          ${showProjectsBtn ? `
            <button type="button" class="um-pill-btn" title="${manageProjectsTitle} ${u.username}">
              <i class="fa-solid fa-diagram-project"></i> ${manageProjectsLabel}
            </button>` : '<span class="um-cell-sub">—</span>'}
        </td>
        <td>
          <div class="um-row-actions">
            ${isRoot ? `
            <button type="button" class="um-icon-btn is-info um-edit-role-btn" title="Edit role ${u.username}" ${u.id === currentUserId ? 'disabled title="Tidak bisa mengubah role akun sendiri"' : ''}>
              <i class="fa-solid fa-user-pen"></i>
            </button>` : ''}
            <button type="button" class="um-icon-btn is-danger um-delete-btn" title="Delete ${u.username}" ${u.id === currentUserId ? 'disabled title="Tidak bisa menghapus akun sendiri"' : ''}>
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      `;

      if (showProjectsBtn) {
        tr.querySelector('.um-pill-btn').addEventListener('click', () => openAssignModal(u));
      }
      const editRoleBtn = tr.querySelector('.um-edit-role-btn');
      if (editRoleBtn) editRoleBtn.addEventListener('click', () => openEditRoleModal(u));
      tr.querySelector('.um-delete-btn').addEventListener('click', () => openDeleteModal(u));

      tbody.appendChild(tr);
    });

    emptyState.classList.toggle('hidden', pageItems.length > 0);
    countLabel.textContent = filtered.length === 0
      ? (isId ? 'Menampilkan 0 dari 0 pengguna' : 'Showing 0 of 0 users')
      : (isId
        ? `Menampilkan ${start + 1}-${Math.min(start + pageItems.length, filtered.length)} dari ${filtered.length} pengguna`
        : `Showing ${start + 1}-${Math.min(start + pageItems.length, filtered.length)} of ${filtered.length} users`);
    renderPager(totalPages);
  }

  document.addEventListener('edash:languagechange', () => renderRows());

  [searchInput, roleFilter].forEach((el) => {
    el.addEventListener('input', () => { currentPage = 1; renderRows(); });
  });

  if (pageSizeSelect) {
    pageSizeSelect.value = String(PAGE_SIZE);
    pageSizeSelect.addEventListener('change', () => {
      PAGE_SIZE = Number(pageSizeSelect.value) || 10;
      localStorage.setItem(UM_PAGE_SIZE_KEY, String(PAGE_SIZE));
      currentPage = 1;
      renderRows();
    });
  }

  // ---------- Assign Projects modal ----------
  const modalOverlay = document.getElementById('umModalOverlay');
  const modalUserName = document.getElementById('umModalUser');
  const modalList = document.getElementById('umModalList');
  const modalSearch = document.getElementById('umModalSearch');
  const modalClose = document.getElementById('umModalClose');
  const modalCancel = document.getElementById('umModalCancel');
  const modalSave = document.getElementById('umModalSave');

  let activeUser = null;
  let pendingProjectIds = new Set();

  function renderModalList() {
    const q = modalSearch.value.trim().toLowerCase();
    const filtered = projects.filter((p) => !q || p.project_name.toLowerCase().includes(q));
    const isStaffTarget = activeUser && activeUser.role_key === 'staff';

    if (!filtered.length) {
      modalList.innerHTML = '<div class="um-modal-empty">No projects match this search.</div>';
      return;
    }

    // Staff = radio (cuma 1 project boleh dipilih). Operator = checkbox (banyak boleh).
    const inputType = isStaffTarget ? 'radio' : 'checkbox';
    modalList.innerHTML = filtered.map((p) => `
      <label class="um-modal-item">
        <input type="${inputType}" name="umModalProject" value="${p.id}" ${pendingProjectIds.has(p.id) ? 'checked' : ''}>
        <span>${p.project_name}</span>
      </label>
    `).join('');

    modalList.querySelectorAll('input').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (isStaffTarget) {
          pendingProjectIds = new Set(cb.checked ? [cb.value] : []);
        } else if (cb.checked) {
          pendingProjectIds.add(cb.value);
        } else {
          pendingProjectIds.delete(cb.value);
        }
      });
    });
  }

  async function openAssignModal(user) {
    activeUser = user;
    modalUserName.textContent = user.username;
    modalSearch.value = '';
    modalList.innerHTML = '<div class="um-modal-empty">Loading…</div>';
    modalOverlay.classList.remove('hidden');

    try {
      const accessRows = await apiFetch(`/admin/users/${user.id}/projects`);
      pendingProjectIds = new Set(accessRows.map((r) => r.project_id));
      renderModalList();
    } catch (err) {
      modalList.innerHTML = `<div class="um-modal-empty">Gagal memuat: ${err.message}</div>`;
    }
  }

  function closeAssignModal() {
    modalOverlay.classList.add('hidden');
    activeUser = null;
  }

  modalSearch.addEventListener('input', renderModalList);
  modalClose.addEventListener('click', closeAssignModal);
  modalCancel.addEventListener('click', closeAssignModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeAssignModal(); });

  modalSave.addEventListener('click', async () => {
    if (!activeUser) return;
    modalSave.disabled = true;
    try {
      if (activeUser.role_key === 'staff') {
        // Staff: SELALU reassign (ganti), bukan tambah -- 1 staff 1 project.
        const [newProjectId] = [...pendingProjectIds];
        if (!newProjectId) {
          openNoticeModal('Perhatian', 'Staff wajib punya 1 project. Pilih salah satu.');
          modalSave.disabled = false;
          return;
        }
        await apiFetch(`/admin/users/${activeUser.id}/reassign-project`, {
          method: 'PUT',
          body: JSON.stringify({ projectId: newProjectId }),
        });
      } else {
        // Operator: diff antara project lama vs baru, tambah/lepas sesuai selisih.
        const before = new Set((await apiFetch(`/admin/users/${activeUser.id}/projects`)).map((r) => r.project_id));
        const after = pendingProjectIds;
        const toAdd = [...after].filter((id) => !before.has(id));
        const toRemove = [...before].filter((id) => !after.has(id));
        for (const projectId of toAdd) {
          await apiFetch(`/admin/users/${activeUser.id}/projects`, { method: 'POST', body: JSON.stringify({ projectId }) });
        }
        for (const projectId of toRemove) {
          await apiFetch(`/admin/users/${activeUser.id}/projects/${projectId}`, { method: 'DELETE' });
        }
      }
      closeAssignModal();
    } catch (err) {
      openNoticeModal('Gagal', err.message);
    } finally {
      modalSave.disabled = false;
    }
  });

  // ---------- Create user modal ----------
  const createModalOverlay = document.getElementById('umCreateModalOverlay');
  const createModalClose = document.getElementById('umCreateModalClose');
  const createModalCancel = document.getElementById('umCreateModalCancel');
  const openCreateBtn = document.getElementById('umOpenCreate');
  const createForm = document.getElementById('umCreateForm');
  const toggleBtn = document.getElementById('umTogglePass');
  const passInput = document.getElementById('umNewPassword');
  const passHint = document.getElementById('umPassHint');
  const roleSelect = document.getElementById('umNewRole');
  const projectField = document.getElementById('umNewProjectField');
  const projectSelect = document.getElementById('umNewProject');

  function updateProjectFieldVisibility() {
    const needsProject = roleSelect.value === 'staff' || roleSelect.value === 'operator';
    projectField.style.display = needsProject ? '' : 'none';
  }
  roleSelect.addEventListener('change', updateProjectFieldVisibility);

  function populateProjectSelect() {
    projectSelect.innerHTML = projects.length
      ? projects.map((p) => `<option value="${p.id}">${p.project_name}</option>`).join('')
      : '<option value="">Tidak ada project tersedia</option>';
  }

  function openCreateModal() {
    createForm.reset();
    if (isOperatorRole) roleSelect.value = 'staff';
    passInput.type = 'password';
    toggleBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
    passHint.textContent = 'Minimal 8 karakter.';
    passHint.classList.remove('is-ok');
    populateProjectSelect();
    updateProjectFieldVisibility();
    createModalOverlay.classList.remove('hidden');
    document.getElementById('umNewUsername').focus();
  }

  function closeCreateModal() {
    createModalOverlay.classList.add('hidden');
  }

  openCreateBtn.addEventListener('click', openCreateModal);
  createModalClose.addEventListener('click', closeCreateModal);
  createModalCancel.addEventListener('click', closeCreateModal);
  createModalOverlay.addEventListener('click', (e) => { if (e.target === createModalOverlay) closeCreateModal(); });

  toggleBtn.addEventListener('click', () => {
    const isPass = passInput.type === 'password';
    passInput.type = isPass ? 'text' : 'password';
    toggleBtn.innerHTML = isPass ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
  });

  passInput.addEventListener('input', () => {
    const ok = passInput.value.length >= 8;
    passHint.textContent = ok ? 'Panjang password sudah cukup.' : 'Minimal 8 karakter.';
    passHint.classList.toggle('is-ok', ok);
  });

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('umNewUsername').value.trim();
    const email = document.getElementById('umNewEmail').value.trim();
    const password = passInput.value;
    const roleKey = roleSelect.value;
    const projectId = projectSelect.value || undefined;

    if (!username) return openNoticeModal('Perhatian', 'Username tidak boleh kosong.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return openNoticeModal('Perhatian', 'Masukkan alamat email yang valid.');
    if (password.length < 8) return openNoticeModal('Perhatian', 'Password minimal harus 8 karakter.');
    if (roleKey === 'staff' && !projectId) return openNoticeModal('Perhatian', 'Staff wajib di-assign ke 1 project.');

    const submitBtn = createForm.querySelector('button[type="submit"]') || createModalOverlay.querySelector('.um-btn-primary');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const newUser = await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, email, password, roleKey, projectId }),
      });
      closeCreateModal();
      await loadUsers();
      openSuccessModal(newUser.username, newUser.role_key, newUser.id);
    } catch (err) {
      openNoticeModal('Gagal membuat akun', err.message);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // ---------- Notice modal ----------
  const noticeModalOverlay = document.getElementById('umNoticeModalOverlay');
  const noticeModalClose = document.getElementById('umNoticeModalClose');
  const noticeModalOk = document.getElementById('umNoticeModalOk');
  const noticeModalTitle = document.getElementById('umNoticeModalTitle');
  const noticeModalMessage = document.getElementById('umNoticeMessage');

  function openNoticeModal(title, message) {
    noticeModalTitle.textContent = title;
    noticeModalMessage.textContent = message;
    noticeModalOverlay.classList.remove('hidden');
  }
  function closeNoticeModal() { noticeModalOverlay.classList.add('hidden'); }

  noticeModalClose.addEventListener('click', closeNoticeModal);
  noticeModalOk.addEventListener('click', closeNoticeModal);
  noticeModalOverlay.addEventListener('click', (e) => { if (e.target === noticeModalOverlay) closeNoticeModal(); });

  // ---------- Delete confirmation modal ----------
  const deleteModalOverlay = document.getElementById('umDeleteModalOverlay');
  const deleteModalClose = document.getElementById('umDeleteModalClose');
  const deleteModalCancel = document.getElementById('umDeleteModalCancel');
  const deleteModalConfirm = document.getElementById('umDeleteModalConfirm');
  const deleteUserNameEl = document.getElementById('umDeleteUserName');
  let userPendingDelete = null;

  function openDeleteModal(user) {
    userPendingDelete = user;
    deleteUserNameEl.textContent = user.username;
    deleteModalOverlay.classList.remove('hidden');
  }
  function closeDeleteModal() {
    deleteModalOverlay.classList.add('hidden');
    userPendingDelete = null;
  }

  deleteModalClose.addEventListener('click', closeDeleteModal);
  deleteModalCancel.addEventListener('click', closeDeleteModal);
  deleteModalOverlay.addEventListener('click', (e) => { if (e.target === deleteModalOverlay) closeDeleteModal(); });

  deleteModalConfirm.addEventListener('click', async () => {
    if (!userPendingDelete) return;
    deleteModalConfirm.disabled = true;
    try {
      await apiFetch(`/admin/users/${userPendingDelete.id}`, { method: 'DELETE' });
      closeDeleteModal();
      await loadUsers();
    } catch (err) {
      closeDeleteModal();
      openNoticeModal('Gagal menghapus akun', err.message);
    } finally {
      deleteModalConfirm.disabled = false;
    }
  });

  // ---------- Edit Role modal ----------
  // Ganti role akun yang sudah ada. Berbeda dari Assign Projects (yang
  // cuma ngatur project mana yang bisa diakses), modal ini betulan
  // mengubah role_key user di tabel users (Postgres, lewat backend Hono)
  // -- PUT /admin/users/:id/role, pola sama dengan reassign-project di
  // atas (body JSON kecil, langsung apply).
  const editRoleModalOverlay = document.getElementById('umEditRoleModalOverlay');
  const editRoleModalClose = document.getElementById('umEditRoleModalClose');
  const editRoleModalCancel = document.getElementById('umEditRoleModalCancel');
  const editRoleForm = document.getElementById('umEditRoleForm');
  const editRoleUsernameEl = document.getElementById('umEditRoleUsername');
  const editRoleSelect = document.getElementById('umEditRoleSelect');
  const editRoleHint = document.getElementById('umEditRoleHint');
  const editRoleProjectField = document.getElementById('umEditRoleProjectField');
  const editRoleProjectSelect = document.getElementById('umEditRoleProject');
  let userPendingRoleEdit = null;

  function updateEditRoleProjectVisibility() {
    const needsProject = editRoleSelect.value === 'staff';
    editRoleProjectField.style.display = needsProject ? '' : 'none';
  }
  editRoleSelect.addEventListener('change', updateEditRoleProjectVisibility);

  function populateEditRoleProjectSelect(preselectProjectId) {
    editRoleProjectSelect.innerHTML = projects.length
      ? projects.map((p) => `<option value="${p.id}" ${p.id === preselectProjectId ? 'selected' : ''}>${p.project_name}</option>`).join('')
      : '<option value="">Tidak ada project tersedia</option>';
  }

  async function openEditRoleModal(user) {
    userPendingRoleEdit = user;
    editRoleUsernameEl.textContent = user.username;
    editRoleForm.reset();
    editRoleSelect.value = user.role_key;
    editRoleHint.textContent = 'Role menentukan hak akses akun ini di seluruh dashboard.';
    updateEditRoleProjectVisibility();
    editRoleModalOverlay.classList.remove('hidden');

    // Kalau target-nya sudah/mau jadi staff, tampilkan project yang
    // sedang dipegangnya sekarang biar admin bisa langsung lihat/ganti
    // tanpa harus buka modal Assign Projects secara terpisah.
    if (user.role_key === 'staff') {
      editRoleProjectSelect.innerHTML = '<option value="">Loading projects…</option>';
      try {
        const accessRows = await apiFetch(`/admin/users/${user.id}/projects`);
        populateEditRoleProjectSelect(accessRows[0]?.project_id);
      } catch (err) {
        populateEditRoleProjectSelect();
      }
    } else {
      populateEditRoleProjectSelect();
    }
  }

  function closeEditRoleModal() {
    editRoleModalOverlay.classList.add('hidden');
    userPendingRoleEdit = null;
  }

  editRoleModalClose.addEventListener('click', closeEditRoleModal);
  editRoleModalCancel.addEventListener('click', closeEditRoleModal);
  editRoleModalOverlay.addEventListener('click', (e) => { if (e.target === editRoleModalOverlay) closeEditRoleModal(); });

  editRoleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!userPendingRoleEdit) return;
    const newRoleKey = editRoleSelect.value;
    const projectId = editRoleProjectSelect.value || undefined;

    if (newRoleKey === 'staff' && !projectId) {
      return openNoticeModal('Perhatian', 'Staff wajib di-assign ke 1 project.');
    }
    if (newRoleKey === userPendingRoleEdit.role_key) {
      return closeEditRoleModal();
    }

    const submitBtn = editRoleForm.closest('.um-modal').querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      await apiFetch(`/admin/users/${userPendingRoleEdit.id}/role`, {
        method: 'PUT',
        body: JSON.stringify({ roleKey: newRoleKey, projectId }),
      });
      closeEditRoleModal();
      await loadUsers();
    } catch (err) {
      openNoticeModal('Gagal mengubah role', err.message);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // ---------- Create-user success modal ----------
  const successModalOverlay = document.getElementById('umSuccessModalOverlay');
  const successModalClose = document.getElementById('umSuccessModalClose');
  const successModalOk = document.getElementById('umSuccessModalOk');
  const successUsernameEl = document.getElementById('umSuccessUsername');
  const successRoleEl = document.getElementById('umSuccessRole');
  const successIdEl = document.getElementById('umSuccessId');
  const successCopyBtn = document.getElementById('umSuccessCopyId');

  function openSuccessModal(username, roleKey, id) {
    successUsernameEl.textContent = username;
    successRoleEl.textContent = roleLabel(roleKey);
    successIdEl.textContent = id;
    successModalOverlay.classList.remove('hidden');
  }
  function closeSuccessModal() { successModalOverlay.classList.add('hidden'); }

  successModalClose.addEventListener('click', closeSuccessModal);
  successModalOk.addEventListener('click', closeSuccessModal);
  successModalOverlay.addEventListener('click', (e) => { if (e.target === successModalOverlay) closeSuccessModal(); });

  successCopyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(successIdEl.textContent).then(() => {
      const original = successCopyBtn.innerHTML;
      successCopyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
      setTimeout(() => { successCopyBtn.innerHTML = original; }, 1200);
    });
  });

  if (window.__adminViewKeydownHandler) {
    document.removeEventListener('keydown', window.__adminViewKeydownHandler);
  }
  window.__adminViewKeydownHandler = (e) => {
    if (e.key !== 'Escape') return;
    if (!modalOverlay.classList.contains('hidden')) closeAssignModal();
    if (!createModalOverlay.classList.contains('hidden')) closeCreateModal();
    if (!deleteModalOverlay.classList.contains('hidden')) closeDeleteModal();
    if (!editRoleModalOverlay.classList.contains('hidden')) closeEditRoleModal();
    if (!successModalOverlay.classList.contains('hidden')) closeSuccessModal();
    if (!noticeModalOverlay.classList.contains('hidden')) closeNoticeModal();
  };
  document.addEventListener('keydown', window.__adminViewKeydownHandler);

  // ---------- Initial load ----------
  async function loadUsers() {
    tbody.innerHTML = `<tr><td colspan="7" class="um-loading-cell">Loading…</td></tr>`;
    try {
      users = await apiFetch('/admin/users');
      renderStats();
      renderRows();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="um-loading-cell">Gagal memuat: ${err.message}</td></tr>`;
    }
  }

  // Refresh senyap (tanpa nampilin "Loading…" ulang / reset tabel) --
  // dipanggil berkala supaya status Online/Offline (kolom Status)
  // tetap kepakai terbaru tanpa admin perlu reload halaman manual.
  // Gagal diam-diam (mis. lagi offline sebentar) -- data lama tetap
  // ditampilkan, dicoba lagi di interval berikutnya.
  async function refreshUsersQuietly() {
    try {
      users = await apiFetch('/admin/users');
      renderStats();
      renderRows();
    } catch (err) {
      console.warn('[admin-view] Gagal refresh status online:', err.message);
    }
  }

  async function loadProjects() {
    try {
      projects = await apiFetch('/admin/assignable-projects');
    } catch (err) {
      console.error('[admin-view] Gagal memuat project:', err);
      projects = [];
    }
  }

  (async function init() {
    await Promise.all([loadUsers(), loadProjects()]);
    setInterval(refreshUsersQuietly, 30 * 1000);
  })();

}