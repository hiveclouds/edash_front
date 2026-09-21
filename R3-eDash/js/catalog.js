// =============================
// Page: Catalog
// Called by js/main.js's loadPage() every time this page is
// routed to — NOT on DOMContentLoaded, since this fragment is
// fetched and injected into #page-root long after that event
// has already fired. Sidebar/header are loaded once by
// index.html and must not be reloaded here.
//
// Data model: array of row objects persisted in localStorage,
// so switching tabs/filters never loses data, and data survives
// page reloads / navigation to other pages too.
// =============================

// v2 intentionally starts empty; catalog data is stored in browser localStorage after CSV import/editing.
const CATALOG_STORAGE_KEY = window.EDASH_CATALOG_STORAGE_KEY || 'edash4_catalog_rows_v2';
// Clear the previous prototype dataset once so the new catalog starts empty.
try { localStorage.removeItem('edash4_catalog_rows_v1'); } catch (e) {}

const CATALOG_CATEGORIES = [
  'Panel Surya',
  'Inverter On-Grid',
  'Inverter Hybrid',
  'Battery',
  'Mounting',
  'Rack',
  'PDI',
  'PDDC',
  'PDC',
  'Kabel DC',
  'Kabel AC',
  'Acc.',
  'Jasa',
  'SLO/NIDI',
];

// Kolom spesifikasi teknik: ditampilkan sebagai kolom tabel sungguhan (bukan satu teks note)
// saat tombol "Tampilkan Spesifikasi Teknik" aktif. Tiap kategori biasanya hanya mengisi
// sebagian kolom ini — sisanya dibiarkan kosong ("–"), sama seperti referensi PLTS System
// Design Tool.
const CATALOG_TECH_FIELDS = [
  { key: 'kapasitas', label: 'Kapasitas (kW/Wp/kWh)' },
  { key: 'voc', label: 'Voc (V)' },
  { key: 'vmpp', label: 'Vmpp (V)' },
  { key: 'impp', label: 'Impp (A)' },
  { key: 'isc', label: 'Isc (A)' },
  { key: 'mppt', label: 'MPPT' },
  { key: 'lCm', label: 'L (cm)' },
  { key: 'wCm', label: 'W (cm)' },
  { key: 'rPerKm', label: 'R (Ω/km)' },
];

const CATALOG_ID_PREFIXES = {
  'Panel Surya': 'PV',
  'Inverter On-Grid': 'INV',
  'Inverter Hybrid': 'HYB',
  'Battery': 'BAT',
  'Mounting': 'MNT',
  'Rack': 'RCK',
  'PDI': 'PDI',
  'PDDC': 'PDDC',
  'PDC': 'PDC',
  'Kabel DC': 'KDC',
  'Kabel AC': 'KAC',
  'Acc.': 'ACC',
  'Jasa': 'JAS',
  'SLO/NIDI': 'SLO',
};

const CATALOG_CSV_HEADERS = [
  'ID', 'Kategori', 'Nama', 'Satuan', 'Ukuran (kW)', 'HPP', "Des '25", "Sep '25", 'Catatan',
  ...CATALOG_TECH_FIELDS.map((f) => f.label),
];

// Alias map: nama kategori "panjang" (mis. dari file export/sheet lain) -> nama kategori
// singkat yang dipakai sebagai chip di tabel ini. Upload CSV akan mencocokkan nilai kolom
// "Kategori" ke salah satu key di bawah ini (case-insensitive), lalu memetakannya ke chip
// kategori yang sesuai. Tambahkan alias baru di sini kalau ada sumber data lain.
const CATALOG_CATEGORY_ALIASES = {
  'panel surya': 'Panel Surya',
  // English / bilingual category aliases
  'solar panel': 'Panel Surya',
  'solar panel': 'Panel Surya',
  'solar panels': 'Panel Surya',
  'galvanized mounting': 'Mounting',
  'galvanized mounting per panel': 'Mounting',
  'mounting galvanized': 'Mounting',
  'outdoor rack': 'Rack',
  'outdoor battery cabinet': 'Rack',
  'rack outdoor': 'Rack',
  'panel distribusi inverter': 'PDI',
  'inverter distribution panel': 'PDI',
  'panel distribusi dc combiner': 'PDDC',
  'dc combiner distribution panel': 'PDDC',
  'panel dc combiner': 'PDC',
  'dc combiner panel': 'PDC',
  'pv cable (dc)': 'Kabel DC',
  'pv cable dc': 'Kabel DC',
  'dc cable': 'Kabel DC',
  'kabel pv (dc)': 'Kabel DC',
  'nyy cable (ac)': 'Kabel AC',
  'nyy cable ac': 'Kabel AC',
  'ac cable': 'Kabel AC',
  'kabel nyy (ac)': 'Kabel AC',
  'installation accessories': 'Acc.',
  'installation service': 'Jasa',
  'service installation': 'Jasa',
  'slo / nidi service': 'SLO/NIDI',
  'on-grid inverter': 'Inverter On-Grid',
  'on grid inverter': 'Inverter On-Grid',
  'grid-tied inverter': 'Inverter On-Grid',
  'hybrid inverter': 'Inverter Hybrid',
  'battery': 'Battery',
  'batteries': 'Battery',
  'galvanized mounting': 'Mounting',
  'outdoor rack': 'Rack',
  'inverter distribution panel': 'PDI',
  'dc combiner distribution panel': 'PDDC',
  'dc combiner': 'PDC',
  'pv cable (dc)': 'Kabel DC',
  'pv cable dc': 'Kabel DC',
  'n yy cable (ac)': 'Kabel AC',
  'nyy cable (ac)': 'Kabel AC',
  'accessories': 'Acc.',
  'installation service': 'Jasa',
  'installation': 'Jasa',
  'slo / nidi service': 'SLO/NIDI',
  'slo / nidi': 'SLO/NIDI',
  'inverter on-grid': 'Inverter On-Grid',
  'inverter ongrid': 'Inverter On-Grid',
  'inverter hybrid': 'Inverter Hybrid',
  'battery': 'Battery',
  'baterai': 'Battery',
  'mounting': 'Mounting',
  'mounting galvanis': 'Mounting',
  'rack': 'Rack',
  'rack outdoor': 'Rack',
  'pdi': 'PDI',
  'panel distribusi inverter': 'PDI',
  'pddc': 'PDDC',
  'panel distribusi dc combiner': 'PDDC',
  'pdc': 'PDC',
  'panel dc combiner': 'PDC',
  'kabel dc': 'Kabel DC',
  'kabel pv (dc)': 'Kabel DC',
  'kabel pv dc': 'Kabel DC',
  'kabel ac': 'Kabel AC',
  'kabel nyy (ac)': 'Kabel AC',
  'kabel nyy ac': 'Kabel AC',
  'acc.': 'Acc.',
  'acc': 'Acc.',
  'accessories': 'Acc.',
  'accessories instalasi': 'Acc.',
  'jasa': 'Jasa',
  'jasa instalasi': 'Jasa',
  'slo/nidi': 'SLO/NIDI',
  'slo / nidi': 'SLO/NIDI',
  'slo - nidi': 'SLO/NIDI',
  'slo nidi': 'SLO/NIDI',
};

function normalizeCsvKey(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ');
}

function compactCsvKey(value) {
  return normalizeCsvKey(value)
    .replace(/[()\[\]{}'"`]/g, '')
    .replace(/[.:,;_\-\/\\]+/g, ' ')
    .replace(/\s+/g, '')
    .replace(/Ω/g, 'ohm');
}

function csvValue(raw, aliases) {
  const keys = Object.keys(raw || {});
  const exact = new Map(keys.map(k => [normalizeCsvKey(k), k]));
  const compact = new Map(keys.map(k => [compactCsvKey(k), k]));
  for (const alias of aliases) {
    const a = normalizeCsvKey(alias);
    if (exact.has(a)) return raw[exact.get(a)] ?? '';
    const c = compactCsvKey(alias);
    if (compact.has(c)) return raw[compact.get(c)] ?? '';
  }
  return '';
}

function resolveCategory(rawValue) {
  const key = normalizeCsvKey(rawValue);
  if (!key) return null;
  if (CATALOG_CATEGORY_ALIASES[key]) return CATALOG_CATEGORY_ALIASES[key];
  const compact = compactCsvKey(key);
  const alias = Object.entries(CATALOG_CATEGORY_ALIASES).find(([k]) => compactCsvKey(k) === compact);
  if (alias) return alias[1];
  const direct = CATALOG_CATEGORIES.find((c) => normalizeCsvKey(c) === key || compactCsvKey(c) === compact);
  return direct || null;
}

// ---------- shared active-price helpers ----------
// Single source of truth for "what is the active price of a catalog row",
// used by BOTH this page (Catalog) and Admin Calculator.
//
// Pricing model (v3 — live price):
//   - HPP, Des '25, Sep '25 are kept purely as HISTORICAL reference columns.
//     Their stored values are never silently rewritten by a later CSV
//     import — they stay exactly as first recorded, so the user can always
//     compare "what did we charge back then".
//   - `livePrice` / `liveDate` are a separate pair of fields, managed only
//     by the web app (never expected/read from an uploaded CSV), that track
//     the single most-up-to-date price for a row and when it last changed.
//     They are updated in exactly two situations:
//       1. A CSV is uploaded (new item, or an existing item re-uploaded —
//          "every new CSV upload is the newest price source").
//       2. HPP / Des '25 / Sep '25 is edited directly in the table (an
//          explicit admin action recording a new price).
//   - `catalogActivePriceValue()` is the single source of truth for "what
//     price do we actually use" (sorting, recommendations, Admin
//     Calculator, the Harga Terbaru (Live) column): livePrice wins whenever
//     it has been set; otherwise it falls back to the historical
//     HPP -> Des '25 -> Sep '25 chain so legacy/never-touched rows keep
//     behaving exactly as before.
// Exposed on window.EdashPricing so Admin Calculator (a separate page
// script) can call the exact same implementation instead of keeping its
// own parallel copy that can drift out of sync with this one.
function catalogToNumber(val) {
  if (val === null || val === undefined) return NaN;
  const cleaned = String(val).replace(/[^\d]/g, '');
  if (cleaned === '') return NaN;
  return Number(cleaned);
}
function catalogFormatIDR(val) {
  const n = catalogToNumber(val);
  if (isNaN(n)) return '–';
  return 'Rp ' + n.toLocaleString('id-ID');
}
// Human-readable "date of updated price", Indonesian locale. '–' when unset.
function catalogFormatDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '–';
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// Raw historical chain price (HPP -> Des '25 -> Sep '25), ignoring
// `livePrice` entirely. Used (a) as the fallback when a row has no live
// price yet, and (b) to compute what the NEW live price should become
// whenever a historical field is edited or (re-)imported from CSV.
function catalogHistoricalChainPrice(row) {
  if (!row) return 0;
  if (!isNaN(catalogToNumber(row.hpp))) return catalogToNumber(row.hpp);
  if (!isNaN(catalogToNumber(row.des25))) return catalogToNumber(row.des25);
  if (!isNaN(catalogToNumber(row.sep25))) return catalogToNumber(row.sep25);
  return 0;
}
// Returns the numeric active price (0 if nothing usable is known yet).
// `livePrice` (most updated price) always wins once it has been set by an
// upload or a direct edit; otherwise falls back to the historical chain.
function catalogActivePriceValue(row) {
  if (!row) return 0;
  if (!isNaN(catalogToNumber(row.livePrice))) return catalogToNumber(row.livePrice);
  return catalogHistoricalChainPrice(row);
}
function computeHargaAktif(row) {
  const v = catalogActivePriceValue(row);
  return v > 0 ? catalogFormatIDR(v) : '–';
}
function computeLiveDateDisplay(row) {
  return catalogFormatDate(row && row.liveDate);
}
// Plain-number (Indonesian thousands separator, no "Rp" prefix) string shown
// inside the editable "Harga Terbaru (Live)" input — same underlying value
// as computeHargaAktif(), just without the currency prefix since that's
// rendered as a separate static "Rp" label next to the input.
function liveInputValue(row) {
  const v = catalogActivePriceValue(row);
  return v > 0 ? v.toLocaleString('id-ID') : '';
}
// Applies a new "most updated price (live)" to a row, shifting the
// previously-active price down into the historical Des '25 / Sep '25 chain
// so the vendor's price history stays visible (Live = newest, Des '25 =
// previous, Sep '25 = the one before that). Shared by both the manual
// in-table edit (Catalog page, after user confirmation) and a CSV
// re-upload of an existing item (the vendor's newest quoted price).
// No-op-safe: if the row had no usable price yet (oldActive === 0, e.g. a
// brand-new row), there is nothing to shift — the new value simply becomes
// the row's first recorded price.
function catalogApplyLivePriceUpdate(row, newValue, timestampIso) {
  if (!row || !(newValue > 0)) return;
  const oldActive = catalogActivePriceValue(row);
  if (oldActive > 0 && oldActive !== newValue) {
    row.sep25 = row.des25;
    row.des25 = oldActive;
  }
  row.livePrice = newValue;
  row.liveDate = timestampIso || new Date().toISOString();
}
window.EdashPricing = window.EdashPricing || {};
window.EdashPricing.getActivePrice = window.EdashPricing.getActivePrice || catalogActivePriceValue;
window.EdashPricing.formatIDR = window.EdashPricing.formatIDR || catalogFormatIDR;
window.EdashPricing.formatDate = window.EdashPricing.formatDate || catalogFormatDate;
window.EdashPricing.toNumber = window.EdashPricing.toNumber || catalogToNumber;

function initCatalog() {

  // Catalog starts empty until the user explicitly uploads a CSV — no
  // auto-seeded default data. (Previously this called
  // ensureEdashCompanyCatalog() whenever the catalog was empty, which
  // silently repopulated the full company catalog — so a cleared/never-
  // uploaded catalog would "come back" on its own the moment any page
  // that reads catalog rows, e.g. Admin Calculator, loaded.)
  let catalogRows = loadCatalogRows();
  let activeCategory = 'Semua';

  const filtersEl = document.getElementById('spCatalogFilters');
  const tbody = document.getElementById('spCatalogTableBody');
  const tableWrap = document.getElementById('spCatalogTableWrap');
  const specToggleBtn = document.getElementById('spSpecToggleBtn');
  const addRowBar = document.getElementById('spAddRowBar');
  const addRowSelect = document.getElementById('spAddRowCategory');
  const addRowBtn = document.getElementById('spAddRowBtn');
  const addRowCount = document.getElementById('spAddRowCount');
  const csvUploadInput = document.getElementById('spCsvUploadInput');
  const csvUploadBtn = document.getElementById('spCsvUploadBtn');
  const csvDownloadBtn = document.getElementById('spCsvDownloadBtn');

  // Delete confirmation modal elements
  const deleteModal = document.getElementById('spDeleteConfirmModal');
  const deleteTitleEl = document.getElementById('spDeleteConfirmTitle');
  const deleteDescEl = document.getElementById('spDeleteConfirmDesc');
  const deleteCancelBtn = document.getElementById('spDeleteCancelBtn');
  const deleteConfirmBtn = document.getElementById('spDeleteConfirmBtn');
  const deleteAllBtn = document.getElementById('spDeleteAllBtn');
  let pendingDeleteId = null;
  let pendingDeleteAll = false;

  if (!tbody) return; // page fragment not fully loaded yet

  // ---------- storage helpers ----------
  function loadCatalogRows() {
    try {
      const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const normalizedRows = [];
      parsed.forEach((row) => {
        const normalized = normalizeRow(row, null, normalizedRows);
        if (!normalizedRows.some((existing) => String(existing.id).toUpperCase() === String(normalized.id).toUpperCase())) {
          normalizedRows.push(normalized);
        } else {
          normalized.id = makeId(normalized.kategori, normalizedRows);
          normalizedRows.push(normalized);
        }
      });
      return normalizedRows;
    } catch (e) {
      console.warn('Gagal memuat data katalog dari localStorage:', e);
      return [];
    }
  }

  function saveCatalogRows() {
    try {
      localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalogRows));
    } catch (e) {
      console.warn('Gagal menyimpan data katalog ke localStorage:', e);
    }
  }

  function makeId(category, rowsForId = catalogRows) {
    const prefix = CATALOG_ID_PREFIXES[category] || 'CAT';
    const used = new Set(rowsForId.map((r) => String(r.id || '').trim().toUpperCase()).filter(Boolean));
    let max = 0;
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$', 'i');
    used.forEach((id) => {
      const match = id.match(re);
      if (match) max = Math.max(max, Number(match[1]));
    });
    let next = max + 1;
    let candidate = `${prefix}-${String(next).padStart(3, '0')}`;
    while (used.has(candidate.toUpperCase())) {
      next += 1;
      candidate = `${prefix}-${String(next).padStart(3, '0')}`;
    }
    return candidate;
  }

  function normalizeRow(row, categoryOverride, rowsForId = catalogRows) {
    const kategori = resolveCategory(categoryOverride || row.kategori) || categoryOverride || row.kategori || CATALOG_CATEGORIES[0];
    return {
      id: String(row.id || '').trim() || makeId(kategori, rowsForId),
      kategori,
      nama: row.nama || '',
      satuan: row.satuan || 'pcs',
      ukuran: row.ukuran || '',
      hpp: row.hpp ?? '',
      des25: row.des25 ?? '',
      sep25: row.sep25 ?? '',
      // "Most updated price (live)" + when it last changed. Managed only by
      // the web app — not read from / required in uploaded CSVs. Defaults
      // to '' for rows that predate this feature or have never had a price
      // change recorded yet; catalogActivePriceValue() falls back to the
      // historical HPP/Des'25/Sep'25 chain in that case.
      livePrice: row.livePrice ?? '',
      liveDate: row.liveDate ?? '',
      kapasitas: row.kapasitas ?? '',
      voc: row.voc ?? '',
      vmpp: row.vmpp ?? '',
      impp: row.impp ?? '',
      isc: row.isc ?? '',
      mppt: row.mppt ?? '',
      lCm: row.lCm ?? '',
      wCm: row.wCm ?? '',
      rPerKm: row.rPerKm ?? '',
      catatan: row.catatan || '',
    };
  }

  // ---------- price helpers ----------
  // toNumber / formatIDR / computeHargaAktif now live at module top-level
  // (as catalogToNumber / catalogFormatIDR / computeHargaAktif) so Admin
  // Calculator can share the exact same active-price logic via
  // window.EdashPricing. Local aliases kept so the rest of this closure
  // doesn't need to change.
  const toNumber = catalogToNumber;
  const formatIDR = catalogFormatIDR;

  // Format angka pakai titik ribuan ala Indonesia, mis. "1675000" -> "1.675.000".
  // Non-digit dibuang dulu (lewat toNumber), jadi aman dipanggil berkali-kali.
  function formatThousands(val) {
    const n = toNumber(val);
    if (isNaN(n)) return '';
    return n.toLocaleString('id-ID');
  }

  // ---------- toast ----------
  let toastTimer = null;
  function showToast(message) {
    let toastEl = document.getElementById('spCatalogToast');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'spCatalogToast';
      toastEl.className = 'sp-catalog-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
  }

  // ---------- populate add-row category select ----------
  function populateAddRowSelect() {
    addRowSelect.innerHTML = CATALOG_CATEGORIES
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join('');
  }

  function syncAddRowSelectWithFilter() {
    if (activeCategory !== 'Semua') {
      addRowSelect.value = activeCategory;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- render ----------
  function totalColumnCount() {
    return document.querySelectorAll('#spCatalogTable thead th').length || 1;
  }

  function renderTable() {
    const visibleRows = activeCategory === 'Semua'
      ? catalogRows
      : catalogRows.filter((r) => r.kategori === activeCategory);

    if (visibleRows.length === 0) {
      tbody.innerHTML = `
        <tr class="sp-empty-row">
          <td colspan="${totalColumnCount()}">
            Belum ada data pada kategori ini. Gunakan "Tambah Baris" di bawah tabel, atau upload CSV.
          </td>
        </tr>`;
    } else if (activeCategory === 'Semua') {
      // group rows by category (in the order of CATALOG_CATEGORIES) and insert a
      // divider row before each group, so "Semua" reads like a sectioned catalog.
      const colspan = totalColumnCount();
      let html = '';
      CATALOG_CATEGORIES.forEach((cat) => {
        const rowsInCat = visibleRows.filter((r) => r.kategori === cat);
        if (rowsInCat.length === 0) return;
        html += `<tr class="sp-cat-divider"><td colspan="${colspan}">${escapeHtml(cat)}<span class="sp-cat-divider-count">${rowsInCat.length} item</span></td></tr>`;
        html += rowsInCat.map((row) => rowToHtml(row)).join('');
      });
      // catch any rows whose kategori doesn't match a known chip (shouldn't normally happen)
      const known = new Set(CATALOG_CATEGORIES);
      const orphanRows = visibleRows.filter((r) => !known.has(r.kategori));
      if (orphanRows.length) {
        html += `<tr class="sp-cat-divider"><td colspan="${colspan}">Lainnya<span class="sp-cat-divider-count">${orphanRows.length} item</span></td></tr>`;
        html += orphanRows.map((row) => rowToHtml(row)).join('');
      }
      tbody.innerHTML = html;
    } else {
      tbody.innerHTML = visibleRows.map((row) => rowToHtml(row)).join('');
    }

    // counts on chips
    filtersEl.querySelectorAll('.sp-filter-chip').forEach((chip) => {
      const cat = chip.dataset.category;
      const count = cat === 'Semua' ? catalogRows.length : catalogRows.filter((r) => r.kategori === cat).length;
      chip.dataset.count = count;
    });

    addRowCount.textContent = `${catalogRows.length} baris total`;

    attachRowListeners();
  }

  function techFieldsToHtml(row) {
    return CATALOG_TECH_FIELDS.map((f) => `
        <td class="sp-col-tech"><input type="text" class="sp-cell-input sp-cell-input-sm" data-field="${f.key}" value="${escapeHtml(row[f.key] || '')}" placeholder="–"></td>`).join('');
  }

  function rowToHtml(row) {
    return `
      <tr data-category="${escapeHtml(row.kategori)}" data-id="${row.id}">
        <td class="sp-id-cell"><span class="sp-catalog-id">${escapeHtml(row.id)}</span></td>
        <td>${escapeHtml(row.kategori)}</td>
        <td>
          <textarea class="sp-cell-input sp-cell-textarea" data-field="nama" rows="1" placeholder="Nama produk">${escapeHtml(row.nama || '')}</textarea>
        </td>
        <td><input type="text" class="sp-cell-input sp-cell-input-sm" data-field="satuan" value="${escapeHtml(row.satuan || '')}" placeholder="pcs"></td>
        <td><input type="text" class="sp-cell-input sp-cell-input-sm" data-field="ukuran" value="${escapeHtml(row.ukuran || '')}" placeholder="–"></td>
        <td><input type="text" class="sp-cell-input sp-cell-input-sm" data-field="hpp" value="${escapeHtml(formatThousands(row.hpp) || row.hpp || '')}" placeholder="–"></td>
        <td class="sp-harga-aktif-cell">
          <div class="sp-live-price-wrap">
            <span class="sp-live-price-prefix">Rp</span>
            <input type="text" inputmode="numeric" class="sp-cell-input sp-cell-input-sm sp-live-price-input" data-field="livePrice" value="${escapeHtml(liveInputValue(row))}" placeholder="–" title="Input harga terbaru (live) dari vendor. Menyimpan nilai baru di sini akan meminta konfirmasi lalu otomatis menggeser harga lama ke Des '25 / Sep '25.">
          </div>
        </td>
        <td class="sp-live-date" title="Kapan harga terbaru di atas terakhir berubah">${computeLiveDateDisplay(row)}</td>
        <td><input type="text" class="sp-cell-input sp-cell-input-sm" data-field="des25" value="${escapeHtml(formatThousands(row.des25) || row.des25 || '')}" placeholder="–"></td>
        <td><input type="text" class="sp-cell-input sp-cell-input-sm" data-field="sep25" value="${escapeHtml(formatThousands(row.sep25) || row.sep25 || '')}" placeholder="–"></td>${techFieldsToHtml(row)}
        <td><input type="text" class="sp-cell-input" data-field="catatan" value="${escapeHtml(row.catatan || '')}" placeholder="–"></td>
        <td class="sp-col-del">
          <button type="button" class="sp-del-btn" data-id="${row.id}" title="Hapus baris">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>`;
  }

  // Bikin tinggi textarea ngikutin isi teks (auto-grow), dipanggil saat
  // render awal & tiap kali user ngetik, supaya nama produk yang panjang
  // wrap ke bawah dan gak kepotong / geser ke samping.
  function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function attachRowListeners() {
    tbody.querySelectorAll('.sp-cell-textarea').forEach((el) => autoResizeTextarea(el));

    tbody.querySelectorAll('.sp-cell-input').forEach((input) => {
      const field = input.dataset.field;
      // "Harga Terbaru (Live)" has its own dedicated flow below (typed
      // value is only committed after a confirmation popup, and shifts the
      // old price into the Des '25 / Sep '25 history) — never wired to the
      // generic per-keystroke autosave used by the other fields.
      if (field === 'livePrice') return;

      input.addEventListener('input', (e) => {
        const tr = e.target.closest('tr');
        const id = tr.dataset.id;
        const row = catalogRows.find((r) => r.id === id);
        if (!row) return;
        row[field] = e.target.value;
        // HPP / Des '25 / Sep '25 are purely historical reference columns —
        // editing them here only corrects/records that historical value and
        // never touches livePrice/liveDate. The only ways to change the
        // active "Harga Terbaru (Live)" price are: (1) editing the Harga
        // Terbaru (Live) input directly (see attachLivePriceListeners), or
        // (2) a CSV re-upload of an existing item.
        saveCatalogRows();
        if (e.target.classList.contains('sp-cell-textarea')) autoResizeTextarea(e.target);
      });

      // Untuk kolom harga (hpp/des25/sep25): rapikan jadi format titik ribuan
      // begitu user selesai ngetik (blur), biar gak ganggu posisi kursor
      // saat masih lagi ngetik.
      if (['hpp', 'des25', 'sep25'].includes(field)) {
        input.addEventListener('blur', (e) => {
          const formatted = formatThousands(e.target.value);
          e.target.value = formatted;
        });
      }
    });

    attachLivePriceListeners();

    tbody.querySelectorAll('.sp-del-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        openDeleteConfirm(id);
      });
    });
  }

  // ---------- Harga Terbaru (Live) — editable input + confirmation popup ----------
  function attachLivePriceListeners() {
    tbody.querySelectorAll('.sp-live-price-input').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        } else if (e.key === 'Escape') {
          const tr = e.target.closest('tr');
          const row = catalogRows.find((r) => r.id === tr.dataset.id);
          e.target.value = row ? liveInputValue(row) : '';
          e.target.blur();
        }
      });

      input.addEventListener('blur', (e) => {
        const tr = e.target.closest('tr');
        const id = tr.dataset.id;
        const row = catalogRows.find((r) => r.id === id);
        if (!row) return;

        const oldActive = catalogActivePriceValue(row);
        const newValue = toNumber(e.target.value);

        if (isNaN(newValue) || newValue <= 0) {
          // kosong / tidak valid -> kembalikan ke nilai aktif saat ini, tanpa popup
          e.target.value = liveInputValue(row);
          return;
        }
        if (newValue === oldActive) {
          // tidak ada perubahan -> cuma rapikan format, tanpa popup
          e.target.value = liveInputValue(row);
          return;
        }

        openPriceUpdateConfirm(row, oldActive, newValue, e.target);
      });
    });
  }

  // ---------- Live price update confirmation modal ----------
  const priceConfirmModal = document.getElementById('spPriceConfirmModal');
  const priceConfirmDescEl = document.getElementById('spPriceConfirmDesc');
  const priceConfirmCancelBtn = document.getElementById('spPriceConfirmCancelBtn');
  const priceConfirmOkBtn = document.getElementById('spPriceConfirmOkBtn');
  let pendingPriceUpdate = null; // { rowId, oldActive, newValue, inputEl }

  function openPriceUpdateConfirm(row, oldActive, newValue, inputEl) {
    pendingPriceUpdate = { rowId: row.id, oldActive, newValue, inputEl };
    const itemLabel = row.nama ? `"${row.nama}"` : row.id;
    if (oldActive > 0) {
      priceConfirmDescEl.innerHTML =
        `Harga terbaru untuk ${escapeHtml(itemLabel)} akan diubah dari ` +
        `<strong>${escapeHtml(catalogFormatIDR(oldActive))}</strong> menjadi ` +
        `<strong>${escapeHtml(catalogFormatIDR(newValue))}</strong>. Harga lama otomatis tersimpan sebagai ` +
        `riwayat di kolom Des '25 (dan nilai Des '25 sebelumnya bergeser ke Sep '25), dan tanggal Update Terakhir ` +
        `akan diperbarui ke sekarang.`;
    } else {
      priceConfirmDescEl.innerHTML =
        `Set harga terbaru untuk ${escapeHtml(itemLabel)} menjadi ` +
        `<strong>${escapeHtml(catalogFormatIDR(newValue))}</strong>. Tanggal Update Terakhir akan otomatis tercatat.`;
    }
    priceConfirmModal?.classList.add('is-open');
    priceConfirmModal?.setAttribute('aria-hidden', 'false');
  }

  function closePriceUpdateConfirm(revert) {
    if (revert && pendingPriceUpdate && pendingPriceUpdate.inputEl) {
      const row = catalogRows.find((r) => r.id === pendingPriceUpdate.rowId);
      pendingPriceUpdate.inputEl.value = row ? liveInputValue(row) : '';
    }
    pendingPriceUpdate = null;
    priceConfirmModal?.classList.remove('is-open');
    priceConfirmModal?.setAttribute('aria-hidden', 'true');
  }

  priceConfirmCancelBtn?.addEventListener('click', () => closePriceUpdateConfirm(true));
  priceConfirmModal?.addEventListener('click', (e) => {
    if (e.target === priceConfirmModal) closePriceUpdateConfirm(true);
  });
  priceConfirmOkBtn?.addEventListener('click', () => {
    if (!pendingPriceUpdate) return;
    const { rowId, oldActive, newValue } = pendingPriceUpdate;
    const row = catalogRows.find((r) => r.id === rowId);
    if (row) {
      catalogApplyLivePriceUpdate(row, newValue, new Date().toISOString());
      saveCatalogRows();
      renderTable();
      showToast(
        oldActive > 0
          ? `Harga terbaru diperbarui: ${catalogFormatIDR(oldActive)} → ${catalogFormatIDR(newValue)}.`
          : `Harga terbaru disimpan: ${catalogFormatIDR(newValue)}.`
      );
    }
    pendingPriceUpdate = null;
    priceConfirmModal?.classList.remove('is-open');
    priceConfirmModal?.setAttribute('aria-hidden', 'true');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && priceConfirmModal?.classList.contains('is-open')) closePriceUpdateConfirm(true);
  });

  // ---------- Delete confirmation modal ----------
  function openDeleteConfirm(id) {
    const row = catalogRows.find((r) => r.id === id);
    if (!row) return;
    pendingDeleteId = id;
    pendingDeleteAll = false;
    deleteTitleEl.textContent = 'Hapus baris ini?';
    deleteDescEl.textContent = row.nama ? `${row.nama} (${row.kategori})` : row.kategori;
    deleteModal.classList.add('is-open');
    deleteModal.setAttribute('aria-hidden', 'false');
  }

  function openDeleteAllConfirm() {
    if (catalogRows.length === 0) {
      showToast('Belum ada data untuk dihapus.');
      return;
    }
    pendingDeleteId = null;
    pendingDeleteAll = true;
    deleteTitleEl.textContent = 'Hapus semua data katalog?';
    deleteDescEl.textContent = `Seluruh ${catalogRows.length} baris data pada katalog ini akan dihapus permanen, termasuk yang diimpor dari CSV.`;
    deleteModal.classList.add('is-open');
    deleteModal.setAttribute('aria-hidden', 'false');
  }

  function closeDeleteConfirm() {
    pendingDeleteId = null;
    pendingDeleteAll = false;
    deleteModal.classList.remove('is-open');
    deleteModal.setAttribute('aria-hidden', 'true');
  }

  deleteAllBtn?.addEventListener('click', openDeleteAllConfirm);

  deleteCancelBtn?.addEventListener('click', closeDeleteConfirm);
  deleteModal?.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteConfirm();
  });
  deleteConfirmBtn?.addEventListener('click', () => {
    if (pendingDeleteAll) {
      const count = catalogRows.length;
      catalogRows = [];
      saveCatalogRows();
      renderTable();
      showToast(`${count} baris data katalog dihapus.`);
    } else if (pendingDeleteId !== null) {
      catalogRows = catalogRows.filter((r) => r.id !== pendingDeleteId);
      saveCatalogRows();
      renderTable();
      showToast('Baris dihapus.');
    }
    closeDeleteConfirm();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && deleteModal.classList.contains('is-open')) closeDeleteConfirm();
  });

  // ---------- filter chips ----------
  if (filtersEl) {
    filtersEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.sp-filter-chip');
      if (!chip) return;
      filtersEl.querySelectorAll('.sp-filter-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
      activeCategory = chip.dataset.category;
      syncAddRowSelectWithFilter();
      renderTable();
    });
  }

  // ---------- spec toggle ----------
  if (specToggleBtn && tableWrap) {
    specToggleBtn.addEventListener('click', () => {
      const isOn = tableWrap.classList.toggle('is-spec-mode');
      specToggleBtn.innerHTML = isOn
        ? '<i class="fa-solid fa-gear"></i> Sembunyikan Spesifikasi Teknik'
        : '<i class="fa-solid fa-gear"></i> Tampilkan Spesifikasi Teknik';
    });
  }

  // ---------- add row ----------
  if (addRowBtn) {
    addRowBtn.addEventListener('click', () => {
      const category = addRowSelect.value || CATALOG_CATEGORIES[0];
      const newRow = {
        id: makeId(category),
        kategori: category,
        nama: '',
        satuan: 'pcs',
        ukuran: '',
        hpp: '',
        des25: '',
        sep25: '',
        livePrice: '',
        liveDate: '',
        catatan: '',
      };
      CATALOG_TECH_FIELDS.forEach((f) => { newRow[f.key] = ''; });
      catalogRows.push(newRow);
      saveCatalogRows();

      // jump the filter to that category so the new row is visible
      activeCategory = category;
      filtersEl.querySelectorAll('.sp-filter-chip').forEach((c) => {
        c.classList.toggle('is-active', c.dataset.category === category);
      });

      renderTable();

      // focus the "Nama" field of the newly added row
      const newTr = tbody.querySelector(`tr[data-id="${newRow.id}"]`);
      if (newTr) {
        const nameInput = newTr.querySelector('input[data-field="nama"]');
        if (nameInput) nameInput.focus();
        newTr.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  // ---------- download CSV ----------
  if (csvDownloadBtn) {
    csvDownloadBtn.addEventListener('click', () => {
      if (catalogRows.length === 0) {
        showToast('Belum ada data untuk diunduh.');
        return;
      }
      const csvData = catalogRows.map((r) => {
        const obj = {
          'ID': r.id,
          'Kategori': r.kategori,
          'Nama': r.nama,
          'Satuan': r.satuan,
          "Ukuran (kW)": r.ukuran,
          'HPP': r.hpp,
          "Des '25": r.des25,
          "Sep '25": r.sep25,
          'Catatan': r.catatan,
        };
        CATALOG_TECH_FIELDS.forEach((f) => { obj[f.label] = r[f.key] || ''; });
        return obj;
      });
      const csv = window.Papa ? window.Papa.unparse(csvData) : manualCsvUnparse(csvData);
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `katalog-plts-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Berhasil mengunduh ${catalogRows.length} baris data.`);
    });
  }

  function manualCsvUnparse(data) {
    const lines = [CATALOG_CSV_HEADERS.join(',')];
    data.forEach((row) => {
      const line = CATALOG_CSV_HEADERS.map((h) => {
        const val = (row[h] ?? '').toString().replace(/"/g, '""');
        return /[",\n]/.test(val) ? `"${val}"` : val;
      }).join(',');
      lines.push(line);
    });
    return lines.join('\n');
  }

  // ---------- upload CSV (shared by the Upload CSV button and drag & drop) ----------
  function processCsvFile(file) {
      if (!file) return;

      const handleParsedRows = (parsedRows) => {
        let addedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        const uploadTimestamp = new Date().toISOString();

        parsedRows.forEach((raw) => {
          const get = (...keys) => csvValue(raw, keys);

          const kategoriRaw = String(get('Kategori', 'Category', 'category', 'kategori') || '').trim();
          const matchedCategory = resolveCategory(kategoriRaw);

          if (!matchedCategory) {
            skippedCount++;
            return;
          }

          const importedId = String(get('ID', 'id', 'Catalog ID', 'catalog id') || '').trim();
          const newRow = {
            id: importedId || makeId(matchedCategory),
            kategori: matchedCategory,
            nama: get('Nama', 'Name', 'name', 'Item Name', 'Product Name', 'Nama Item', 'nama item'),
            satuan: get('Satuan', 'Unit', 'unit', 'satuan', 'UoM', 'Unit of Measure') || 'pcs',
            ukuran: get('Ukuran (kW)', 'Size (kW)', 'size (kw)', 'ukuran', 'ukuran (kw)', 'For kW', 'forKw', 'forKw (kW)', 'Rated Size (kW)', 'Daya (kW)', 'daya (kw)'),
            hpp: get('HPP', 'hpp', 'HPP (Rp)', 'Cost Price', 'Cost', 'Harga Pokok Penjualan'),
            des25: get("Des '25", 'Dec 25', "Dec '25", 'December 25', 'December 2025', 'dec25', 'des25', "des '25", 'des', "Des '25 (Rp)"),
            sep25: get("Sep '25", 'Sep 25', "Sep'25", 'sep25', "sep '25", 'sep', "Sep '25 (Rp)"),
            catatan: get('Catatan', 'Notes', 'Note', 'notes', 'catatan', 'Remarks', 'Remark', 'Description'),
          };

          const techAliases = {
            kapasitas: ['Kapasitas (kW/Wp/kWh)', 'Capacity (kW/Wp/kWh)', 'kW/Wp/kWh', 'Kapasitas', 'Capacity', 'Daya Panel (Wp)', 'Panel Power (Wp)', 'Power (kW)', 'Kapasitas (kWh)', 'Capacity (kWh)', 'kapasitas'],
            voc: ['Voc (V)', 'Voc', 'Open-Circuit Voltage (V)', 'voc'],
            vmpp: ['Vmpp (V)', 'Vmpp', 'Maximum Power Voltage (V)', 'vmpp'],
            impp: ['Impp (A)', 'Impp', 'impp', 'MPP Current (A)'],
            isc: ['Isc (A)', 'Isc', 'isc', 'Short-Circuit Current (A)'],
            mppt: ['MPPT', 'MPPT Count', 'Number of MPPT', 'Jml MPPT', 'jml mppt', 'mppt'],
            lCm: ['L (cm)', 'Length (cm)', 'Panjang (cm)', 'l (cm)', 'Length'],
            wCm: ['W (cm)', 'Width (cm)', 'Lebar (cm)', 'w (cm)', 'Width'],
            rPerKm: ['R (Ω/km)', 'R (Ohm/km)', 'Resistance (Ω/km)', 'Resistance (Ohm/km)', 'rPerKm', 'r per km'],
          };
          CATALOG_TECH_FIELDS.forEach((f) => {
            newRow[f.key] = get(...(techAliases[f.key] || [f.label]));
          });

          const normalized = normalizeRow(newRow, matchedCategory);

          // Every new CSV upload is treated as the newest price source. The
          // price this row carries in *this* CSV line (HPP -> Des '25 ->
          // Sep '25, first non-empty wins) becomes the candidate "most
          // updated price (live)" for the item.
          const csvChainPrice = catalogHistoricalChainPrice(normalized);

          const existingIndex = catalogRows.findIndex(
            (r) => String(r.id).toUpperCase() === String(normalized.id).toUpperCase()
          );

          if (existingIndex !== -1) {
            // ID already exists in the catalog: this is a price refresh from
            // the vendor, not a new item. The row's own HPP field stays as
            // originally recorded, but the "most updated price (live)" this
            // CSV line carries pushes the previously-active price down into
            // the Des '25 / Sep '25 history chain (same shift used by a
            // manual in-table edit on this page) — so every re-upload keeps
            // a rolling record of how the vendor's price has moved.
            if (csvChainPrice > 0) {
              catalogApplyLivePriceUpdate(catalogRows[existingIndex], csvChainPrice, uploadTimestamp);
              updatedCount++;
            } else {
              skippedCount++;
            }
            return;
          }

          // New item: store the historical fields as given, and seed the
          // live price/date from this same upload so it has an initial
          // "most updated price" right away (nothing to shift yet, since
          // this row has no prior price history).
          catalogApplyLivePriceUpdate(normalized, csvChainPrice, uploadTimestamp);
          catalogRows.push(normalized);
          addedCount++;
        });

        saveCatalogRows();
        renderTable();

        if (addedCount === 0 && updatedCount === 0) {
          showToast('Tidak ada baris valid ditemukan. Periksa kolom Kategori pada CSV.');
        } else {
          const parts = [];
          if (addedCount > 0) parts.push(`${addedCount} baris baru ditambahkan`);
          if (updatedCount > 0) parts.push(`${updatedCount} harga item diperbarui (live)`);
          if (skippedCount > 0) parts.push(`${skippedCount} baris dilewati`);
          showToast(`Berhasil impor CSV: ${parts.join(', ')}.`);
        }
      };

      if (window.Papa) {
        window.Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => handleParsedRows(results.data),
          error: () => showToast('Gagal membaca file CSV.'),
        });
      } else {
        const reader = new FileReader();
        reader.onload = () => handleParsedRows(manualCsvParse(String(reader.result)));
        reader.onerror = () => showToast('Gagal membaca file CSV.');
        reader.readAsText(file);
      }
  }

  if (csvUploadBtn && csvUploadInput) {
    csvUploadBtn.addEventListener('click', () => csvUploadInput.click());

    csvUploadInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      processCsvFile(file);
      csvUploadInput.value = '';
    });
  }

  // ---------- drag & drop CSV ----------
  // Dropping a .csv file anywhere on the Catalog page updates the data
  // immediately, without needing to click "Upload CSV" first.
  const catalogWrapEl = document.getElementById('spCatalogWrap');
  if (catalogWrapEl) {
    let dragCounter = 0;

    const isCsvDrag = (e) => {
      const types = e.dataTransfer && e.dataTransfer.types;
      return !!types && Array.from(types).includes('Files');
    };

    catalogWrapEl.addEventListener('dragenter', (e) => {
      if (!isCsvDrag(e)) return;
      e.preventDefault();
      dragCounter++;
      catalogWrapEl.classList.add('is-dragging-csv');
    });

    catalogWrapEl.addEventListener('dragover', (e) => {
      if (!isCsvDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    catalogWrapEl.addEventListener('dragleave', (e) => {
      if (!isCsvDrag(e)) return;
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) catalogWrapEl.classList.remove('is-dragging-csv');
    });

    catalogWrapEl.addEventListener('drop', (e) => {
      if (!isCsvDrag(e)) return;
      e.preventDefault();
      dragCounter = 0;
      catalogWrapEl.classList.remove('is-dragging-csv');

      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;

      const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel';
      if (!isCsv) {
        showToast('Format file tidak didukung. Harap drop file CSV (.csv).');
        return;
      }

      processCsvFile(file);
    });
  }

  function manualCsvParse(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (ch === '"') {
        if (quoted && next === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) { row.push(cell); cell = '';
      } else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(v => String(v).trim() !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); if (row.some(v => String(v).trim() !== '')) rows.push(row); }
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => String(h).replace(/^\uFEFF/, '').trim());
    return rows.slice(1).map(cells => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = String(cells[i] ?? '').trim(); });
      return obj;
    });
  }

  // ---------- init ----------
  populateAddRowSelect();
  syncAddRowSelectWithFilter();
  renderTable();
}