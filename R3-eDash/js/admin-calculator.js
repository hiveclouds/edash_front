// Admin Calculator — calculation engine
// Catalog is read from the same localStorage store used by Catalog page.
// Inputs recalculate the active design reactively; Calculate finalizes the current design and opens the results.

const ADMIN_CATALOG_STORAGE_KEY = 'edash4_catalog_rows_v2';
const VAT_RATE = 0.11;
const MONTH_FACTORS = [0.82,0.90,1.02,0.98,1.06,1.14,1.18,1.10,1.02,0.96,0.88,0.84];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let spActiveConfigId = '';
let spCalculation = null;
let spCatalogRows = [];
// Snapshot of the most recent calculation kept around specifically so the
// Export PDF / Export Excel / Export Customer Offer / Save PDF buttons can
// build a document on demand without forcing a recalculation.
let spLastCalc = null;

// Notice/validation popup — replaces the browser's native alert() with a
// centered modal that matches the rest of the app (same markup/classes as
// the delete-confirm modal already used on the Catalog page).
function spNotify(message){
  const modal=document.getElementById('spNoticeModal');
  if(!modal){ alert(message); return; } // fallback safety net if markup is missing
  const text=document.getElementById('spNoticeText');
  if(text) text.textContent=message;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden','false');
  const okBtn=document.getElementById('spNoticeOkBtn');
  const close=()=>{ modal.classList.remove('is-open'); modal.setAttribute('aria-hidden','true'); };
  if(okBtn && !okBtn._spBound){
    okBtn._spBound=true;
    okBtn.addEventListener('click',close);
    modal.addEventListener('click',e=>{ if(e.target===modal) close(); });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape' && modal.classList.contains('is-open')) close(); });
  }
}
let spLastRab = null;
let spLastComponents = null;
// Single source of truth for the user-selected battery model.
let spActiveBatteryId = '';

// =============================
// BOQ / Customer / Summary tab language support
// -----------------------------
// These three tabs are built entirely with innerHTML template strings
// (not data-i18n markup), so the generic dictionary/DOM-walker translator
// in main.js never touches them. spT() gives every label used by
// spRenderRab / spRenderCustomer / spRenderSummary an ID/EN pair, and
// spCurrentLang() reads whatever language is currently active so these
// tabs redraw correctly whenever the header language toggle is used.
function spCurrentLang(){
  try{
    if(typeof getSavedLanguage==='function') return getSavedLanguage();
    return localStorage.getItem('edash-lang')||'en';
  }catch(e){ return 'en'; }
}
const SP_I18N = {
  boqFor:{en:'BOQ for:',id:'RAB untuk:'},
  priceColon:{en:'Price:',id:'Harga:'},
  activeCatalogPrice:{en:'Active Catalog Price',id:'Harga Katalog Aktif'},
  sectionParts:{en:'I. Parts',id:'I. Komponen'},
  sectionInstallation:{en:'II. Installation Materials',id:'II. Material Instalasi'},
  sectionServices:{en:'III. Services',id:'III. Jasa'},
  subtotalPreVat:{en:'Subtotal (pre-VAT)',id:'Subtotal (sebelum PPN)'},
  vat11:{en:'VAT 11%',id:'PPN 11%'},
  totalIncludingVat:{en:'TOTAL (including VAT)',id:'TOTAL (termasuk PPN)'},
  profitMargin:{en:'Profit Margin',id:'Margin Keuntungan'},
  sellingPricePreVat:{en:'Selling Price (pre-VAT)',id:'Harga Jual (sebelum PPN)'},
  totalCustomerInvoice:{en:'TOTAL CUSTOMER INVOICE',id:'TOTAL TAGIHAN PELANGGAN'},
  createdOn:{en:'Created',id:'Dibuat'},
  notYetCalculated:{en:'Not yet calculated',id:'Belum dihitung'},
  summaryIntro:{
    en:(kwp,panelCount,panelW,conf,ratio)=>`<p>The Solar PV system <b>${kwp} kWp</b> (${panelCount} panels ${panelW}Wp) uses the <b>${conf}</b> inverter configuration with a DC/AC ratio of <b>${ratio}×</b>.</p>`,
    id:(kwp,panelCount,panelW,conf,ratio)=>`<p>Sistem PLTS <b>${kwp} kWp</b> (${panelCount} panel ${panelW}Wp) menggunakan konfigurasi inverter <b>${conf}</b> dengan rasio DC/AC <b>${ratio}×</b>.</p>`
  },
  summaryProduction:{
    en:(mwh,daily)=>`Estimated production: <b>${mwh} MWh/year</b> (${daily} kWh/day)`,
    id:(mwh,daily)=>`Estimasi produksi: <b>${mwh} MWh/tahun</b> (${daily} kWh/hari)`
  },
  summaryCost:{
    en:(rp,rpPerKwp)=>`Total installed cost (pre-VAT): <b>${rp}</b> (${rpPerKwp}/kWp)`,
    id:(rp,rpPerKwp)=>`Total biaya terpasang (sebelum PPN): <b>${rp}</b> (${rpPerKwp}/kWp)`
  },
  summaryHybridNote:{en:'The hybrid system uses an inverter configuration optimized from the catalog and a battery from the catalog.',id:'Sistem hybrid menggunakan konfigurasi inverter yang dioptimalkan dari katalog dan baterai dari katalog.'},
  summaryOffgridNote:{en:'The off-grid system uses a hybrid inverter and a battery from the catalog.',id:'Sistem off-grid menggunakan inverter hybrid dan baterai dari katalog.'},
  summaryOngridNote:{en:'The on-grid system does not use a battery.',id:'Sistem on-grid tidak menggunakan baterai.'},
  cardProjectOverview:{en:'Project Overview',id:'Ringkasan Proyek'},
  cardPvArray:{en:'PV Array Configuration',id:'Konfigurasi Array PV'},
  cardSelectedConfig:{en:'Selected Configuration',id:'Konfigurasi Terpilih'},
  cardCabling:{en:'Cabling',id:'Pengkabelan'},
  cardEnergyProduction:{en:'Energy Production Estimate',id:'Estimasi Produksi Energi'},
  cardCostBudget:{en:'Cost Budget Summary',id:'Ringkasan Anggaran Biaya'},
  cardBattery:{en:'Battery Storage',id:'Penyimpanan Baterai'},
  rowTargetCapacity:{en:'Target capacity',id:'Kapasitas target'},
  rowActualArrayCapacity:{en:'Actual array capacity',id:'Kapasitas array aktual'},
  rowSystemType:{en:'System type',id:'Tipe sistem'},
  rowPsh:{en:'Peak sun hours (PSH)',id:'Jam matahari puncak (PSH)'},
  rowPanelModel:{en:'Panel model',id:'Model panel'},
  rowTotalPanels:{en:'Total panels',id:'Total panel'},
  rowStringConfig:{en:'String configuration',id:'Konfigurasi string'},
  rowVmppString:{en:'Vmpp string (STC)',id:'Vmpp string (STC)'},
  rowVocString:{en:'Voc string (cold check)',id:'Voc string (cek dingin)'},
  rowArrayArea:{en:'Array area',id:'Luas array'},
  rowTotalInvRating:{en:'Total inverter rating',id:'Rating inverter total'},
  rowDcAcRatio:{en:'DC/AC ratio',id:'Rasio DC/AC'},
  rowQuantity:{en:'Quantity',id:'Jumlah'},
  rowTotalMppt:{en:'Total MPPT inputs',id:'Total input MPPT'},
  rowPeakAcOutput:{en:'Peak AC output',id:'Output AC puncak'},
  rowClippingStc:{en:'Clipping STC',id:'Clipping STC'},
  rowInvEfficiency:{en:'Inverter efficiency',id:'Efisiensi inverter'},
  rowDcCableType:{en:'DC cable type',id:'Tipe kabel DC'},
  rowTotalDcCable:{en:'Total DC cable',id:'Total kabel DC'},
  rowAcCableType:{en:'AC cable type',id:'Tipe kabel AC'},
  rowTotalAcCable:{en:'Total AC cable',id:'Total kabel AC'},
  rowPeakDcPower:{en:'Peak DC power',id:'Daya DC puncak'},
  rowEstDaily:{en:'Estimated daily energy',id:'Estimasi energi harian'},
  rowEstMonthly:{en:'Estimated monthly energy',id:'Estimasi energi bulanan'},
  rowEstAnnual:{en:'Estimated annual energy',id:'Estimasi energi tahunan'},
  row20yEstimate:{en:'20-year estimate',id:'Estimasi 20 tahun'},
  rowPriceBasis:{en:'Price basis',id:'Dasar harga'},
  rowActiveConfig:{en:'Active configuration',id:'Konfigurasi aktif'},
  rowCostPerKwp:{en:'Cost per kWp installed',id:'Biaya per kWp terpasang'},
  row20yEnergyCost:{en:'20-year energy cost (proxy)',id:'Estimasi biaya energi 20 tahun'},
  rowTargetStorage:{en:'Target storage',id:'Target penyimpanan'},
  rowBatteryModel:{en:'Battery model',id:'Model baterai'},
  rowTotalNominalCapacity:{en:'Total nominal capacity',id:'Total kapasitas nominal'},
  rowUsableCapacity:{en:'Usable capacity',id:'Kapasitas terpakai'},
  rowSizingReference:{en:'Sizing reference',id:'Referensi ukuran'},
  valSafe:{en:'✓ Safe',id:'✓ Aman'},
  valExceedsLimit:{en:'✕ Exceeds limit',id:'✕ Melebihi batas'},
  valPotentialClipping:{en:'Potential clipping',id:'Berpotensi clipping'},
  valMinorMinimal:{en:'Minor / minimal',id:'Minor / minimal'},
  valNotSpecified:{en:'Not specified in catalog',id:'Tidak dicantumkan di katalog'}
};
function spT(key){
  const lang=spCurrentLang()==='id'?'id':'en';
  const entry=SP_I18N[key];
  if(!entry) return key;
  return entry[lang]!==undefined?entry[lang]:entry.en;
}
function spSectionLabel(section){
  if(section==='I. Parts') return spT('sectionParts');
  if(section==='II. Installation Materials') return spT('sectionInstallation');
  if(section==='III. Services') return spT('sectionServices');
  return section;
}

function spFmtRp(n){ return 'Rp ' + Math.round(Number(n)||0).toLocaleString('id-ID'); }
function spFmtRpMillion(n){ return 'Rp ' + Math.round((Number(n)||0)/1000000).toLocaleString('id-ID') + 'M'; }
function spFmtNum(n,d=0){ return (Number(n)||0).toLocaleString('id-ID',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function spNum(v){
  if(v===null||v===undefined||v==='') return 0;
  let t=String(v).trim().replace(/[^0-9,.-]/g,'');
  // Accept Indonesian decimal input such as 0,998 and 1,5.
  if(t.includes(',') && t.includes('.')) {
    if(t.lastIndexOf(',')>t.lastIndexOf('.')) t=t.replace(/\./g,'').replace(',','.');
    else t=t.replace(/,/g,'');
  } else if(t.includes(',')) t=t.replace(',','.');
  const n=Number(t); return Number.isFinite(n)?n:0;
}
function spLoadCatalogRows(){
  try { if(typeof ensureEdashCompanyCatalog==='function') ensureEdashCompanyCatalog(); const raw=localStorage.getItem(ADMIN_CATALOG_STORAGE_KEY); const rows=raw?JSON.parse(raw):[]; return Array.isArray(rows)?rows:[]; }
  catch(e){ console.warn('Catalog read failed',e); return []; }
}
// Single source of truth for "active price" — shared with the Catalog page.
// "Most updated price (live)" (row.livePrice, set by a CSV upload or a
// direct table edit on the Catalog page) always wins once a row has one;
// otherwise falls back to the historical HPP -> Des '25 -> Sep '25 chain
// (first field that actually has a value wins; this is NOT a
// minimum-of-available-fields calculation). When window.EdashPricing
// (exposed by catalog.js) is available, it is used directly so Catalog and
// Admin Calculator can never read a different price for the same catalog
// row. A local fallback with the exact same algorithm is kept for when this
// page is opened without catalog.js having executed first (e.g. Admin
// Calculator visited directly).
function spActivePriceValue(row){
  if(!row) return 0;
  if(window.EdashPricing && typeof window.EdashPricing.getActivePrice==='function'){
    return window.EdashPricing.getActivePrice(row) || 0;
  }
  const toNum=(v)=>{
    if(v===null||v===undefined) return NaN;
    const cleaned=String(v).replace(/[^\d]/g,'');
    return cleaned===''?NaN:Number(cleaned);
  };
  if(!isNaN(toNum(row.livePrice))) return toNum(row.livePrice);
  if(!isNaN(toNum(row.hpp))) return toNum(row.hpp);
  if(!isNaN(toNum(row.des25))) return toNum(row.des25);
  if(!isNaN(toNum(row.sep25))) return toNum(row.sep25);
  return 0;
}
function spPrice(row){ return spActivePriceValue(row); }
function spCat(c){ return spCatalogRows.filter(r=>String(r.kategori||'').trim()===c); }
function spFind(id){ return spCatalogRows.find(r=>String(r.id)===String(id)); }
// Falls back to the 'ukuran' (Ukuran (kW)) field when 'kapasitas' (the
// technical-spec column, only populated when "Tampilkan Spesifikasi Teknik"
// has been filled in) is empty. Without this fallback, any inverter whose
// size was only entered in the main Ukuran (kW) column — e.g. imported via
// CSV, which maps to 'ukuran' — reads as 0 kW here and gets silently
// dropped from spBuildAutoConfigurations()'s `.filter(r=>spCapacity(r)>0...)`
// inverter pool. That was why the combo optimizer could only ever pick from
// whichever inverters happened to have 'kapasitas' filled in (e.g. 40/50 kW),
// landing on a 3-unit combo like 50+50+40 for a 140 kWp target instead of a
// cheaper 2-unit 60+80 combo that dummy.html's hardcoded catalog would find.
function spCapacity(row){ return spNum(row?.kapasitas) || spNum(row?.ukuran); }
// Battery planning is based on the requested nominal capacity target (kWh), not
// inverter output. Usable capacity is shown only where the project/catalog has a
// confirmed value; we do not invent a usable-capacity percentage for other models.
function spBatteryUsableKwh(row){
  if(!row)return 0;
  if(String(row.id)==='BAT-001')return 55.29; // confirmed planning reference: 61.44 kWh nominal / 55.29 kWh usable
  return 0; // do not invent usable capacity when the active catalog does not provide it
}
function spRenderBatteryTarget(calc){
  const el=document.getElementById('spBatteryTargetLive');
  if(!el||!calc)return;
  const type=calc.type||spSystemType();
  const mode=calc.batterySizingMode||document.getElementById('spBatterySizingMode')?.value||'auto';
  if(mode==='capacity'){
    el.textContent=`Target storage: ${spFmtNum(calc.batteryTargetKwh||0,2)} kWh · manual target capacity`;
    const direct=document.getElementById('spBatteryCapacityTargetLive');
    if(direct)direct.textContent=`Target storage: ${spFmtNum(calc.batteryTargetKwh||0,2)} kWh`;
    return;
  }
  const basis=type==='Off-Grid'?'estimated daily production':'estimated daily excess';
  el.textContent=`Target storage: ${spFmtNum(calc.batteryTargetKwh||0,2)} kWh · ${basis}`;
}
function spTariffEstimate(){
  const label=(document.querySelector('[data-section="project-info"] .sp-field:nth-of-type(5) select')?.value||'').toLowerCase();
  if(label.includes('i-3'))return 1114.74;
  return 1444.70;
}
function spEstimatedDailyLoad(){
  const bill=spNum(document.getElementById('spMonthlyBill')?.value||0);
  const tariff=spTariffEstimate();
  return bill>0?bill/(30*tariff):0;
}
function spBatteryRequiredKwh(calc){
  if(!calc)return 0;
  const type=calc.type||spSystemType();
  const load=spEstimatedDailyLoad();
  const production=Math.max(0,spNum(calc.daily));
  const mode=document.getElementById('spBatterySizingMode')?.value||'auto';

  if(mode==='capacity'){
    return Math.max(0,spNum(document.getElementById('spBatteryTargetCapacityKwh')?.value||0));
  }

  // Auto basis follows the system type: Hybrid uses estimated excess energy,
  // while Off-Grid uses the daily production/load basis because there is no PLN fallback.
  const excess=Math.max(0,production-load);
  const basis=type==='Off-Grid' ? (production>0?production:load) : excess;
  return Math.max(0,basis);
}

function spSelectedBatteryId(){
  const selectId=document.getElementById('spBatteryModelSelect')?.value || '';
  return spActiveBatteryId || selectId || '';
}

function spSyncBatteryPlan(calc){
  if(!calc) return calc;
  const plan=spBatterySizing(calc);
  calc.battery=plan.row||null;
  calc.batteryUnitKwh=plan.unit||0;
  calc.batterySizingMode=plan.mode;
  calc.batteryQty=plan.qty||0;
  calc.batteryTotalKwh=plan.nominal||0;
  calc.batteryUsableKwh=plan.usable||0;
  calc.batteryTargetKwh=plan.target||0;
  calc.batteryRequiredExcessKwh=plan.requiredExcessKwh||plan.target||0;
  calc.batteryCoverageHours=calc.totalInv>0?calc.batteryTotalKwh/calc.totalInv:0;
  calc.batteryCost=plan.cost||0;
  calc.batteryOptions=plan.options||[];
  calc.batteryPlan=plan;
  return calc;
}

function spBatteryOptions(targetKwh=0){
  const rows=spCatalogRows.filter(r=>String(r.kategori||'').trim()==='Battery'&&spCapacity(r)>0&&spPrice(r)>0);
  return rows.map(row=>{
    const unit=spCapacity(row), usableUnit=spBatteryUsableKwh(row);
    // A confirmed usable capacity is the sizing constraint; otherwise the
    // catalog nominal capacity is used. The nominal total is always shown.
    const sizingUnit=usableUnit>0?usableUnit:unit;
    const qty=targetKwh>0?Math.max(1,Math.ceil(targetKwh/sizingUnit)):0;
    const nominal=unit*qty, usable=usableUnit>0?usableUnit*qty:0;
    return {
      row,unit,qty,nominal,usable,usableUnit,sizingUnit,
      cost:spPrice(row)*qty,
      meets:targetKwh<=0 || usable+1e-9>=targetKwh || (usableUnit<=0 && nominal+1e-9>=targetKwh)
    };
  }).sort((a,b)=>a.cost-b.cost||Math.abs((a.usableUnit>0?a.usable:a.nominal)-targetKwh)-Math.abs((b.usableUnit>0?b.usable:b.nominal)-targetKwh)||a.qty-b.qty);
}

function spBatterySizing(calc){
  const mode=document.getElementById('spBatterySizingMode')?.value||'auto';
  const target=spBatteryRequiredKwh(calc);
  const options=spBatteryOptions(target);
  const selectedId=spSelectedBatteryId();
  const selected=target>0
    ? (options.find(x=>String(x.row.id)===String(selectedId)) || options[0])
    : null;

  return {
    mode,target,
    row:selected?.row||null,
    unit:selected?.unit||0,
    qty:selected?.qty||0,
    nominal:selected?.nominal||0,
    usableUnit:selected?.usableUnit||0,
    usable:selected?.usable||0,
    cost:selected?.cost||0,
    selectedId:selected?.row?.id||selectedId||'',
    options,
    requiredExcessKwh:target
  };
}

function spApplyAutoBattery(calc){
  return spBatterySizing(calc).row||null;
}

function spRenderBatteryComparison(calc){
  const wrap=document.getElementById('spBatteryComparison');
  const note=document.getElementById('spBatteryComparisonNote');
  if(!wrap||!calc)return;
  spRenderBatteryTarget(calc);

  // Use the exact battery plan stored on the current calculation snapshot.
  // Do not recalculate a second independent selection for the table.
  spSyncBatteryPlan(calc);
  const target=Math.max(0,spNum(calc.batteryTargetKwh));
  const opts=spBatteryOptions(target);
  calc.batteryOptions=opts;
  const selectedId=target>0&&calc.battery&&calc.batteryQty>0?String(calc.battery.id):String(spSelectedBatteryId()||'');

  if(!opts.length){
    wrap.innerHTML='<div class="sp-battery-empty">No battery with active catalog capacity and price is available.</div>';
    if(note)note.textContent='Battery sizing requires an active Battery catalog row with capacity and active price.';
    return;
  }

  wrap.innerHTML=`<div class="sp-battery-comparison-title">Battery options for ${spFmtNum(target,2)} kWh target</div>
    <div class="sp-battery-comparison-table">
      <div class="sp-battery-comparison-row head"><span>Battery</span><span>kWh/unit</span><span>Qty</span><span>Total kWh</span><span>Usable</span><span>Total Cost</span></div>
      ${opts.map(o=>{
        const isSel=selectedId&&String(o.row.id)===selectedId;
        return `<div class="sp-battery-comparison-row${isSel?' selected':''}">
          <span>${o.row.nama||o.row.id}${isSel?' <b>✓ Selected</b>':''}</span>
          <span>${spFmtNum(o.unit,2)}</span>
          <span>${o.qty}×</span>
          <span>${spFmtNum(o.nominal,2)}</span>
          <span>${o.usableUnit>0?spFmtNum(o.usable,2)+' kWh':'—'}</span>
          <span>${spFmtRp(o.cost)}</span>
        </div>`;
      }).join('')}
    </div>`;

  if(note){
    const type=calc.type||spSystemType();
    const sizingMode=calc.batterySizingMode||'auto';
    const mode=sizingMode==='capacity'
      ? `Manual — Target Capacity (${spFmtNum(target,2)} kWh)`
      : sizingMode==='auto'
        ? (type==='Off-Grid'?'Auto — Full Estimated Daily Production':'Auto — Full Estimated Excess')
        : 'Manual — Target Capacity';
    const load=spEstimatedDailyLoad();
    const excess=Math.max(0,spNum(calc.daily)-load);
    const basis=sizingMode==='capacity'?'manual target capacity':(type==='Off-Grid'?'daily production':'daily excess');
    const u=calc.batteryUsableKwh>0
      ? `Usable reference: ${spFmtNum(calc.batteryUsableKwh,2)} kWh total.`
      : 'Usable capacity is not specified in the catalog for the selected model.';
    note.textContent=target>0
      ? `${mode}. Estimated daily load: ${spFmtNum(load,1)} kWh/day; estimated daily production: ${spFmtNum(spNum(calc.daily),1)} kWh/day; daily excess: ${spFmtNum(excess,1)} kWh/day; target storage: ${spFmtNum(target,2)} kWh (${basis}). ${u}`
      : `${mode}. Estimated daily load: ${spFmtNum(load,1)} kWh/day; estimated daily production: ${spFmtNum(spNum(calc.daily),1)} kWh/day; daily excess: ${spFmtNum(excess,1)} kWh/day; target storage: ${spFmtNum(target,2)} kWh. No battery is required at the current ${sizingMode==='capacity'?'manual target capacity':type==='Off-Grid'?'production basis':'excess level'}.`;
  }
}

function spPanelW(row){ return spCapacity(row) || 585; }
function spUnitPrice(row){ return spPrice(row); }
function spCatalogLabel(row){
  if(!row) return '';
  const unit=spCapacity(row)?` · ${spFmtNum(spCapacity(row), row.kategori==='Panel Surya'?0:2)} ${row.kategori==='Panel Surya'?'Wp':row.kategori==='Battery'?'kWh':'kW'}`:'';
  return `${row.id||''} — ${row.nama||'Unnamed'}${unit}`;
}
function spPopulateCatalogSelect(id, rows, empty='Select from Catalog'){
  const s=document.getElementById(id); if(!s)return;
  s.innerHTML=''; const o=document.createElement('option'); o.value=''; o.textContent=rows.length?empty:'Catalog is empty — upload CSV first'; s.appendChild(o);
  rows.forEach(r=>{const x=document.createElement('option');x.value=r.id||'';x.textContent=spCatalogLabel(r);s.appendChild(x);});
}
// Meta line shown under the Battery Model select. For a specific catalog
// ID this is just spMeta(row). For the "auto" sentinel there is no single
// row to describe up front, so it reports the battery actually resolved by
// the most recent calculation (spCalculation.battery, set by spSyncBatteryPlan
// via the normal spBatterySizing fallback) instead of duplicating that logic.
function spBatteryModelMetaText(value){
  if(value==='auto'){
    if(spCalculation && spCalculation.battery){
      return `Auto — Cheapest Battery · currently selecting ${spMeta(spCalculation.battery)}`;
    }
    return 'Auto — Cheapest Battery · the lowest total-cost catalog battery option for the target storage is selected automatically after Calculate.';
  }
  return spMeta(spFind(value));
}
function spMeta(row){
  if(!row)return 'No catalog item selected.';
  const a=[]; if(row.kapasitas)a.push(`Capacity: ${row.kapasitas}`); if(row.voc)a.push(`Voc ${row.voc} V`); if(row.vmpp)a.push(`Vmpp ${row.vmpp} V`); if(row.impp)a.push(`Impp ${row.impp} A`); if(row.mppt)a.push(`${row.mppt} MPPT`); if(spPrice(row))a.push(`Price ${spFmtRp(spPrice(row))}`); return `${row.id} · ${a.join(' · ')}`;
}
// Historical HPP / Des '25 / Sep '25 reference for the catalog row currently
// selected, shown as a hover tooltip next to the live-price meta line (see
// spInitCatalogInputs below) so an admin can compare the live price the
// calculator is actually using against the historical chain — without
// changing anything about how the price used in calculations is picked
// (that stays livePrice-first, per spActivePriceValue/spPrice).
function spHistoricalPriceNote(row){
  if(!row) return '';
  const toNum=(v)=>{ if(v===null||v===undefined) return NaN; const c=String(v).replace(/[^\d]/g,''); return c===''?NaN:Number(c); };
  const parts=[];
  if(!isNaN(toNum(row.hpp))) parts.push(`HPP ${spFmtRp(toNum(row.hpp))}`);
  if(!isNaN(toNum(row.des25))) parts.push(`Des '25 ${spFmtRp(toNum(row.des25))}`);
  if(!isNaN(toNum(row.sep25))) parts.push(`Sep '25 ${spFmtRp(toNum(row.sep25))}`);
  if(!parts.length) return '';
  const liveNote=!isNaN(toNum(row.livePrice))?'Live price is used for this calculation. ':'';
  return `${liveNote}Historical reference — ${parts.join(' · ')}`;
}
function spInitCatalogInputs(){
  spCatalogRows=spLoadCatalogRows();
  const by=(cats)=>spCatalogRows.filter(r=>cats.includes(String(r.kategori||'').trim()));
  spPopulateCatalogSelect('spPanelCatalogSelect',by(['Panel Surya']));
  spPopulateCatalogSelect('spInverterCatalogSelect',by(['Inverter On-Grid','Inverter Hybrid']));
  const batteryRows=by(['Battery']);
  spPopulateCatalogSelect('spBatteryModelSelect',batteryRows);
  const batterySelect=document.getElementById('spBatteryModelSelect');
  if(batterySelect && batteryRows.length){
    // Replace the generic empty placeholder with an explicit "Auto — Cheapest
    // Battery" choice, which is now the default. It carries no catalog ID of
    // its own, so spSelectedBatteryId()/spBatterySizing() fall through to
    // options[0] — the lowest total-cost battery option for the target
    // storage (spBatteryOptions() already sorts ascending by cost) — the
    // same fallback path already used when a stored ID no longer matches
    // any catalog row. No duplicate "cheapest" logic is introduced.
    const placeholder=batterySelect.querySelector('option[value=""]');
    if(placeholder){ placeholder.value='auto'; placeholder.textContent='Auto — Cheapest Battery'; }
    if(!batterySelect.value || (batterySelect.value!=='auto' && !spFind(batterySelect.value))){
      batterySelect.value='auto';
    }
    spActiveBatteryId=batterySelect.value;
    const initMeta=document.getElementById('spBatteryModelMeta');
    if(initMeta){ initMeta.textContent=spBatteryModelMetaText(batterySelect.value); initMeta.title=spHistoricalPriceNote(spFind(batterySelect.value)); }
    batterySelect.dispatchEvent(new Event('change',{bubbles:true}));
  }
  const map={spMountingCatalogSelect:['Mounting'],spDcCableCatalogSelect:['Kabel DC'],spAcCableCatalogSelect:['Kabel AC'],spPdiCatalogSelect:['PDI'],spPddcCatalogSelect:['PDDC'],spPdcCatalogSelect:['PDC'],spAccCatalogSelect:['Acc.'],spJasaCatalogSelect:['Jasa'],spSloCatalogSelect:['SLO/NIDI']};
  Object.entries(map).forEach(([id,c])=>spPopulateCatalogSelect(id,by(c)));
  [['spPanelCatalogSelect','spPanelCatalogMeta'],['spInverterCatalogSelect','spInverterCatalogMeta'],['spBatteryModelSelect','spBatteryModelMeta']].forEach(([sid,mid])=>{
    const s=document.getElementById(sid),m=document.getElementById(mid); if(!s||!m)return;
    s.addEventListener('change',()=>{m.textContent=sid==='spBatteryModelSelect'?spBatteryModelMetaText(s.value):spMeta(spFind(s.value));m.title=spHistoricalPriceNote(spFind(s.value));});
  });
  document.getElementById('spInverterCatalogSelect')?.addEventListener('change',e=>{if(!e.currentTarget._spSettingAuto)e.currentTarget.dataset.spAuto='false';});
}

const PACKAGE_DEFS={};

function spDefaultCatalogComponents(){
  // Keep the existing catalog-backed defaults, but no longer bind them to a fixed
  // package. The optimizer is responsible for choosing the inverter combination.
  const defaults={
    panel:'PV-001', mounting:'MNT-001', dc:'KDC-001', pdc:'PDC-002',
  };
  Object.entries(defaults).forEach(([k,id])=>{
    const map={panel:'spPanelCatalogSelect',mounting:'spMountingCatalogSelect',dc:'spDcCableCatalogSelect',pdc:'spPdcCatalogSelect'};
    const el=document.getElementById(map[k]);
    if(el && !el.value && spFind(id)) { el.value=id; el.dispatchEvent(new Event('change',{bubbles:true})); }
  });
}

function spAutoSupportForInverter(inv){
  const kw=spCapacity(inv);
  const pick=(cat, predicate)=>{
    const rows=spCatalogRows.filter(r=>String(r.kategori||'').trim()===cat).filter(predicate||(()=>true)).filter(r=>spPrice(r)>0);
    if(!rows.length)return null;
    rows.sort((a,b)=>{
      const da=Math.abs((spCapacity(a)||spNum(a.ukuran)||0)-kw), db=Math.abs((spCapacity(b)||spNum(b.ukuran)||0)-kw);
      return da-db || spPrice(a)-spPrice(b);
    });
    return rows[0];
  };
  const pdi=pick('PDI',r=>(spCapacity(r)||spNum(r.ukuran))>=kw);
  const pddc=pick('PDDC',r=>(spCapacity(r)||spNum(r.ukuran))>=Math.min(kw,80));
  const acc=pick('Acc.',r=>(spNum(r.ukuran)||0)>=Math.min(kw,80));
  const jasa=pick('Jasa',r=>(spNum(r.ukuran)||0)>=Math.min(kw,80));
  const slo=pick('SLO/NIDI',r=>{
    const text=String(r.nama||'');
    const nums=(text.match(/\d+/g)||[]).map(Number);
    return nums.length?nums.some(n=>n>=Math.min(kw,80)):true;
  });
  let ac=null;
  if(kw<=20) ac=spFind('KAC-001');
  else if(kw<=50) ac=spFind('KAC-002')||spFind('KAC-004');
  else ac=spFind('KAC-003')||spFind('KAC-005');
  return {pdi,pddc,acc,jasa,slo,ac};
}

function spApplyAutoSupport(inv, base){
  const auto=spAutoSupportForInverter(inv);
  const out={...base};
  // Pure resolver: candidate scoring must never mutate the live form.
  const ids={ac:'spAcCableCatalogSelect',pdi:'spPdiCatalogSelect',pddc:'spPddcCatalogSelect',acc:'spAccCatalogSelect',jasa:'spJasaCatalogSelect',slo:'spSloCatalogSelect'};
  Object.entries(auto).forEach(([k,row])=>{
    const el=document.getElementById(ids[k]);
    const manual=el && el.dataset.spAuto!=='true' && el.value;
    out[k]=manual?spFind(el.value):(row||out[k]||null);
  });
  return out;
}

function spRecommendationForValue(list, mode){
  if(!list||!list.length)return null;
  if(mode==='price')return list.reduce((a,b)=>b.dummyCost<a.dummyCost?b:a);
  if(mode==='quality')return list.reduce((a,b)=>b.technicalScore>a.technicalScore?b:a);
  // 'recommended' (default): mirrors the Doctype reference's "🎯 Target Fit" —
  // among configs whose total inverter capacity lands within ±5% of the
  // requested Target kWp, pick the cheapest one. This is what stops the
  // optimizer from favoring a smaller total (e.g. 60+50=110kW for a 120kWp
  // target) just because its DC/AC ratio happens to sit closer to rPref, when
  // a config that actually matches the catalog target (e.g. 60+60=120kW) is
  // available. Only falls back to the blended value score when nothing is
  // close enough to the target. "Cheapest" here is dummyCost (dummy.html's
  // simplified panel+mounting+inverter+overhead formula), not the full RAB
  // total, so the winning combo always matches what dummy.html would pick.
  const target=spNum(document.getElementById('spTargetKwp')?.value||0);
  if(target>0){
    const closeFit=list.filter(x=>Math.abs((x.total||0)-target)<=target*0.05);
    if(closeFit.length)return closeFit.reduce((a,b)=>b.dummyCost<a.dummyCost?b:a);
  }
  return list.reduce((a,b)=>b.valueScore>a.valueScore?b:a);
}

function spPackageSetup(){
  const s=document.getElementById('spPackageSelect'),summary=document.getElementById('spPackageSummary'),info=document.getElementById('spPackageInfo');
  if(!s)return;
  const renderPlaceholder=()=>{
    if(summary){
      const mode=s.value||'recommended';
      const text=mode==='price'?'Lowest-cost valid configuration.':mode==='quality'?'Highest technical-fit valid configuration.':'Best balance between cost and technical fit.';
      summary.innerHTML=`<strong>Automatic optimization</strong><span>${text}</span>`;
    }
    if(info)info.dataset.info='The system automatically calculates inverter combinations from the catalog based on target kWp, technical fit, and cost. Customize Components remains available for manual override.';
  };
  s.addEventListener('change',()=>{
    renderPlaceholder();
    if(spCalculation){
      const calc=spCalculate();
      if(calc){ document.getElementById('spEmptyState')?.classList.add('hidden'); document.getElementById('spResultContent')?.classList.remove('hidden'); }
    }
  });
  renderPlaceholder();
  [['spCustomizeToggle','spPrimaryCatalogComponents'],['spAdvancedCustomizeToggle','spAdvancedCatalogComponents']].forEach(([a,b])=>{const t=document.getElementById(a),x=document.getElementById(b);if(t&&x)t.addEventListener('click',()=>{const open=t.getAttribute('aria-expanded')==='true';t.setAttribute('aria-expanded',String(!open));t.classList.toggle('is-open',!open);x.classList.toggle('is-visible',!open);});});
  if(!window.__spInfoPopoverInitialized){
    window.__spInfoPopoverInitialized=true;
    let activeBtn=null;
    const closeInfo=()=>{document.querySelectorAll('.sp-info-popover').forEach(p=>p.remove());if(activeBtn)activeBtn.setAttribute('aria-expanded','false');activeBtn=null;};
    const positionInfo=(btn,p)=>{const r=btn.getBoundingClientRect(),gap=8;p.style.left='0px';p.style.top='0px';const pw=Math.min(320,Math.max(220,window.innerWidth-24));p.style.width=`${pw}px`;const measured=p.getBoundingClientRect();let left=r.left;if(left+measured.width>window.innerWidth-12)left=window.innerWidth-12-measured.width;left=Math.max(12,left);let top=r.bottom+gap;if(top+measured.height>window.innerHeight-12)top=r.top-gap-measured.height;if(top<12)top=12;p.style.left=`${left}px`;p.style.top=`${top}px`;};
    document.addEventListener('click',e=>{const btn=e.target.closest('.sp-info-btn');if(!btn){if(!e.target.closest('.sp-info-popover'))closeInfo();return;}e.preventDefault();e.stopPropagation();if(activeBtn===btn){closeInfo();return;}closeInfo();const pp=document.createElement('div');pp.className='sp-info-popover';pp.textContent=btn.dataset.info||'';pp.setAttribute('role','tooltip');document.body.appendChild(pp);activeBtn=btn;btn.setAttribute('aria-expanded','true');positionInfo(btn,pp);},true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeInfo();});
    window.addEventListener('resize',()=>{const pp=document.querySelector('.sp-info-popover');if(pp&&activeBtn)positionInfo(activeBtn,pp);});
    window.addEventListener('scroll',()=>{const pp=document.querySelector('.sp-info-popover');if(pp&&activeBtn)positionInfo(activeBtn,pp);},true);
  }
}

function spSelectedComponents(){
  const ids={panel:'spPanelCatalogSelect',inverter:'spInverterCatalogSelect',mounting:'spMountingCatalogSelect',dc:'spDcCableCatalogSelect',ac:'spAcCableCatalogSelect',pdi:'spPdiCatalogSelect',pddc:'spPddcCatalogSelect',pdc:'spPdcCatalogSelect',acc:'spAccCatalogSelect',jasa:'spJasaCatalogSelect',slo:'spSloCatalogSelect'};
  const out={};Object.entries(ids).forEach(([k,id])=>{const el=document.getElementById(id);out[k]=(el?.dataset.spAuto==='true'&&k==='inverter')?null:spFind(el?.value);});return out;
}
function spSetAutoSelect(id,row){
  const el=document.getElementById(id);if(!el||!row)return;el._spSettingAuto=true;el.value=row.id||'';el.dataset.spAuto='true';el.dispatchEvent(new Event('change',{bubbles:true}));el._spSettingAuto=false;
}
function spSystemType(){return document.getElementById('spSystemType')?.value || 'On-Grid';}

// =====================================================================
// Admin Visual Chart Reference Data — kept aligned with Solar Calculator
// =====================================================================
const SP_ADMIN_PV_POTENTIAL_DATA = {
    "Aceh": 3.873, "Sumatera Utara": 3.621, "Sumatera Barat": 3.180, "Riau": 3.594,
    "Kepulauan Riau": 3.555, "Jambi": 3.408, "Sumatera Selatan": 3.454, "Bengkulu": 3.687,
    "Lampung": 3.589, "Kepulauan Bangka Belitung": 3.621, "DKI Jakarta": 3.824,
    "Jawa Barat": 3.950, "Jawa Tengah": 4.048, "DI Yogyakarta": 3.519, "Jawa Timur": 4.226,
    "Banten": 3.774, "Bali": 4.317, "Nusa Tenggara Barat": 4.310, "Nusa Tenggara Timur": 4.353,
    "Kalimantan Barat": 3.355, "Kalimantan Tengah": 3.165, "Kalimantan Selatan": 3.303,
    "Kalimantan Timur": 3.404, "Kalimantan Utara": 3.684, "Sulawesi Utara": 4.119,
    "Sulawesi Tengah": 3.877, "Gorontalo": 4.054, "Sulawesi Selatan": 3.853,
    "Sulawesi Tenggara": 3.790, "Sulawesi Barat": 3.721, "Maluku": 3.924,
    "Maluku Utara": 3.767, "Papua Barat": 3.987, "Papua": 3.691, "Papua Selatan": 4.1,
    "Papua Tengah": 3.7, "Papua Pegunungan": 3.2, "Papua Barat Daya": 4.0
};

// City/Regency list per province — used to populate the public location select.

const SP_ADMIN_CITY_DATA = {
    "Aceh": ["Aceh Barat","Aceh Barat Daya","Aceh Besar","Aceh Jaya","Aceh Selatan","Aceh Singkil","Aceh Tamiang","Aceh Tengah","Aceh Tenggara","Aceh Timur","Aceh Utara","Banda Aceh","Bener Meriah","Bireuen","Gayo Lues","Langsa","Lhokseumawe","Nagan Raya","Pidie","Pidie Jaya","Sabang","Simeulue","Subulussalam"],
    "Sumatera Utara": ["Asahan","Batu Bara","Binjai","Dairi","Deli Serdang","Gunungsitoli","Humbang Hasundutan","Karo","Labuhanbatu","Labuhanbatu Selatan","Labuhanbatu Utara","Langkat","Mandailing Natal","Medan","Nias","Nias Barat","Nias Selatan","Nias Utara","Padang Lawas","Padang Lawas Utara","Padangsidimpuan","Pakpak Bharat","Pematangsiantar","Samosir","Serdang Bedagai","Sibolga","Simalungun","Tanjungbalai","Tapanuli Selatan","Tapanuli Tengah","Tapanuli Utara","Tebing Tinggi","Toba"],
    "Sumatera Barat": ["Agam","Bukittinggi","Dharmasraya","Kepulauan Mentawai","Lima Puluh Kota","Padang","Padang Panjang","Padang Pariaman","Pariaman","Pasaman","Pasaman Barat","Payakumbuh","Pesisir Selatan","Sawahlunto","Sijunjung","Solok","Solok Selatan","Tanah Datar"],
    "Riau": ["Bengkalis","Dumai","Indragiri Hilir","Indragiri Hulu","Kampar","Kepulauan Meranti","Kuantan Singingi","Pekanbaru","Pelalawan","Rokan Hilir","Rokan Hulu","Siak"],
    "Jambi": ["Batanghari","Bungo","Jambi","Kerinci","Merangin","Muaro Jambi","Sarolangun","Sungai Penuh","Tanjung Jabung Barat","Tanjung Jabung Timur","Tebo"],
    "Sumatera Selatan": ["Banyuasin","Empat Lawang","Lahat","Lubuklinggau","Muara Enim","Musi Banyuasin","Musi Rawas","Musi Rawas Utara","Ogan Ilir","Ogan Komering Ilir","Ogan Komering Ulu","Ogan Komering Ulu Selatan","Ogan Komering Ulu Timur","Pagar Alam","Palembang","Penukal Abab Lematang Ilir","Prabumulih"],
    "Bengkulu": ["Bengkulu","Bengkulu Selatan","Bengkulu Tengah","Bengkulu Utara","Kaur","Kepahiang","Lebong","Mukomuko","Rejang Lebong","Seluma"],
    "Lampung": ["Bandar Lampung","Lampung Barat","Lampung Selatan","Lampung Tengah","Lampung Timur","Lampung Utara","Mesuji","Metro","Pesawaran","Pesisir Barat","Pringsewu","Tanggamus","Tulang Bawang","Tulang Bawang Barat","Way Kanan"],
    "Kepulauan Bangka Belitung": ["Bangka","Bangka Barat","Bangka Selatan","Bangka Tengah","Belitung","Belitung Timur","Pangkal Pinang"],
    "Kepulauan Riau": ["Batam","Bintan","Karimun","Kepulauan Anambas","Lingga","Natuna","Tanjung Pinang"],
    "DKI Jakarta": ["Jakarta Barat","Jakarta Pusat","Jakarta Selatan","Jakarta Timur","Jakarta Utara","Kepulauan Seribu"],
    "Jawa Barat": ["Bandung","Bandung Barat","Banjar","Bekasi","Bogor","Ciamis","Cianjur","Cimahi","Cirebon","Depok","Garut","Indramayu","Karawang","Kuningan","Majalengka","Pangandaran","Purwakarta","Subang","Sukabumi","Sumedang","Tasikmalaya"],
    "Jawa Tengah": ["Banjarnegara","Banyumas","Batang","Blora","Boyolali","Brebes","Cilacap","Demak","Grobogan","Jepara","Karanganyar","Kebumen","Kendal","Klaten","Kudus","Magelang","Pati","Pekalongan","Pemalang","Purbalingga","Purworejo","Rembang","Salatiga","Semarang","Sragen","Sukoharjo","Surakarta","Tegal","Temanggung","Wonogiri","Wonosobo"],
    "DI Yogyakarta": ["Bantul","Gunungkidul","Kulon Progo","Sleman","Yogyakarta"],
    "Jawa Timur": ["Bangkalan","Banyuwangi","Batu","Blitar","Bojonegoro","Bondowoso","Gresik","Jember","Jombang","Kediri","Lamongan","Lumajang","Madiun","Magetan","Malang","Mojokerto","Nganjuk","Ngawi","Pacitan","Pamekasan","Pasuruan","Ponorogo","Probolinggo","Sampang","Sidoarjo","Situbondo","Sumenep","Surabaya","Trenggalek","Tuban","Tulungagung"],
    "Banten": ["Cilegon","Lebak","Pandeglang","Serang","Tangerang","Tangerang Selatan"],
    "Bali": ["Badung","Bangli","Buleleng","Denpasar","Gianyar","Jembrana","Karangasem","Klungkung","Tabanan"],
    "Nusa Tenggara Barat": ["Bima","Dompu","Lombok Barat","Lombok Tengah","Lombok Timur","Lombok Utara","Mataram","Sumbawa","Sumbawa Barat"],
    "Nusa Tenggara Timur": ["Alor","Belu","Ende","Flores Timur","Kupang","Lembata","Malaka","Manggarai","Manggarai Barat","Manggarai Timur","Nagekeo","Ngada","Rote Ndao","Sabu Raijua","Sikka","Sumba Barat","Sumba Barat Daya","Sumba Tengah","Sumba Timur","Timor Tengah Selatan","Timor Tengah Utara"],
    "Kalimantan Barat": ["Bengkayang","Kapuas Hulu","Kayong Utara","Ketapang","Kubu Raya","Landak","Melawi","Mempawah","Pontianak","Sambas","Sanggau","Sekadau","Singkawang","Sintang"],
    "Kalimantan Tengah": ["Barito Selatan","Barito Timur","Barito Utara","Gunung Mas","Kapuas","Katingan","Kotawaringin Barat","Kotawaringin Timur","Lamandau","Murung Raya","Palangka Raya","Pulang Pisau","Seruyan","Sukamara"],
    "Kalimantan Selatan": ["Balangan","Banjar","Banjarbaru","Banjarmasin","Barito Kuala","Hulu Sungai Selatan","Hulu Sungai Tengah","Hulu Sungai Utara","Kotabaru","Tabalong","Tanah Bumbu","Tanah Laut","Tapin"],
    "Kalimantan Timur": ["Balikpapan","Berau","Bontang","Kutai Barat","Kutai Kartanegara","Kutai Timur","Mahakam Ulu","Paser","Penajam Paser Utara","Samarinda"],
    "Kalimantan Utara": ["Bulungan","Malinau","Nunukan","Tana Tidung","Tarakan"],
    "Sulawesi Utara": ["Bitung","Bolaang Mongondow","Bolaang Mongondow Selatan","Bolaang Mongondow Timur","Bolaang Mongondow Utara","Kepulauan Sangihe","Kepulauan Siau Tagulandang Biaro","Kepulauan Talaud","Kotamobagu","Manado","Minahasa","Minahasa Selatan","Minahasa Tenggara","Minahasa Utara","Tomohon"],
    "Sulawesi Tengah": ["Banggai","Banggai Kepulauan","Banggai Laut","Buol","Donggala","Morowali","Morowali Utara","Palu","Parigi Moutong","Poso","Sigi","Tojo Una-Una","Tolitoli"],
    "Sulawesi Selatan": ["Bantaeng","Barru","Bone","Bulukumba","Enrekang","Gowa","Jeneponto","Kepulauan Selayar","Luwu","Luwu Timur","Luwu Utara","Makassar","Maros","Palopo","Pangkajene dan Kepulauan","Parepare","Pinrang","Sidenreng Rappang","Sinjai","Soppeng","Takalar","Tana Toraja","Toraja Utara","Wajo"],
    "Sulawesi Tenggara": ["Baubau","Bombana","Buton","Buton Selatan","Buton Tengah","Buton Utara","Kendari","Kolaka","Kolaka Timur","Kolaka Utara","Konawe","Konawe Kepulauan","Konawe Selatan","Konawe Utara","Muna","Muna Barat","Wakatobi"],
    "Gorontalo": ["Boalemo","Bone Bolango","Gorontalo","Gorontalo Utara","Pohuwato"],
    "Sulawesi Barat": ["Majene","Mamasa","Mamuju","Mamuju Tengah","Pasangkayu","Polewali Mandar"],
    "Maluku": ["Ambon","Buru","Buru Selatan","Kepulauan Aru","Kepulauan Tanimbar","Maluku Barat Daya","Maluku Tengah","Maluku Tenggara","Seram Bagian Barat","Seram Bagian Timur","Tual"],
    "Maluku Utara": ["Halmahera Barat","Halmahera Selatan","Halmahera Tengah","Halmahera Timur","Halmahera Utara","Kepulauan Sula","Pulau Morotai","Pulau Taliabu","Ternate","Tidore Kepulauan"],
    "Papua Selatan": ["Asmat","Boven Digoel","Mappi","Merauke"],
    "Papua Tengah": ["Deiyai","Dogiyai","Intan Jaya","Mimika","Nabire","Paniai","Puncak","Puncak Jaya"],
    "Papua Pegunungan": ["Jayawijaya","Lanny Jaya","Mamberamo Tengah","Nduga","Pegunungan Bintang","Tolikara","Yahukimo","Yalimo"],
    "Papua": ["Biak Numfor","Jayapura","Keerom","Kepulauan Yapen","Mamberamo Raya","Sarmi","Supiori","Waropen"],
    "Papua Barat": ["Fakfak","Kaimana","Manokwari","Manokwari Selatan","Pegunungan Arfak","Teluk Bintuni","Teluk Wondama"],
    "Papua Barat Daya": ["Maybrat","Raja Ampat","Sorong","Sorong Selatan","Tambrauw"]
};
const SP_ADMIN_FACILITY_PROFILES = {
    restaurant: {
        label: "Restaurant", opening: 9, closing: 22,
        includePeaks: true, peaks: [{ start: 12, end: 14 }, { start: 19, end: 21 }],
        rampDurationMin: 60,
        includePrep: true, prepStart: 6, prepEnd: 9, prepLoadPercent: 50,
        idleLoadPercent: 20,
        peakMultiplier: 1.35
    },
    office: {
        label: "Office", opening: 8, closing: 18,
        includePeaks: true, peaks: [{ start: 9, end: 17 }],
        rampDurationMin: 120,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 15,
        peakMultiplier: 1.25
    },
    mall: {
        label: "Mall / Retail", opening: 10, closing: 22,
        includePeaks: true, peaks: [{ start: 12, end: 21 }],
        rampDurationMin: 60,
        includePrep: true, prepStart: 9, prepEnd: 10, prepLoadPercent: 50,
        idleLoadPercent: 25,
        peakMultiplier: 1.3
    },
    hospital: {
        label: "Hospital", opening: 0, closing: 23.9833,
        includePeaks: false, peaks: [],
        rampDurationMin: 60,
        includePrep: true, prepStart: 8, prepEnd: 20, prepLoadPercent: 110,
        idleLoadPercent: 100,
        peakMultiplier: 1.15
    },
    industrial_247: {
        label: "24/7 Factory", opening: 0, closing: 23.9833,
        includePeaks: false, peaks: [],
        rampDurationMin: 0,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 100,
        peakMultiplier: 1.0
    },
    industrial_1shift: {
        label: "1-Shift Factory", opening: 7, closing: 17,
        includePeaks: true, peaks: [{ start: 7.5, end: 16.5 }],
        rampDurationMin: 60,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 5,
        peakMultiplier: 1.3
    },
    residential: {
        label: "Residential Complex", opening: 6, closing: 23,
        includePeaks: true, peaks: [{ start: 7, end: 9 }, { start: 18, end: 21 }],
        rampDurationMin: 60,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 70,
        peakMultiplier: 1.2
    },
    streetlights: {
        label: "Street Lighting", opening: 0, closing: 23.9833, nightOnly: true,
        includePeaks: true, peaks: [{ start: 0, end: 6 }, { start: 18, end: 23.9833 }],
        rampDurationMin: 15,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 0,
        peakMultiplier: 1.0
    },
    // Not present in the internal tool — generic fallback for "Other".
    other: {
        label: "Other Facility", opening: 9, closing: 18,
        includePeaks: false, peaks: [],
        rampDurationMin: 60,
        includePrep: false, prepStart: 0, prepEnd: 0, prepLoadPercent: 0,
        idleLoadPercent: 20,
        peakMultiplier: 1.25
    }
};



function spAdminProvinceSelect(){return document.getElementById('spPshSelect');}
function spAdminCitySelect(){return document.getElementById('spCitySelect');}
function spAdminFacilitySelect(){return document.getElementById('spFacilitySelect');}
function spAdminFacilityProfile(){
  const key=spAdminFacilitySelect()?.value || 'other';
  return SP_ADMIN_FACILITY_PROFILES[key] || SP_ADMIN_FACILITY_PROFILES.other;
}
function spAdminPsh(){
  const select=spAdminProvinceSelect();
  if(!select)return 3.824;
  const match=String(select.value||'').match(/PSH\s*([\d.]+)/i);
  return match?spNum(match[1]):(SP_ADMIN_PV_POTENTIAL_DATA[select.value]||3.824);
}
function spAdminPopulateCities(){
  const rawProvince=spAdminProvinceSelect()?.value||'DKI Jakarta';
  const province=String(rawProvince).replace(/\s*\(PSH\s*[^)]*\)\s*$/i,'').trim();
  const city=spAdminCitySelect();
  if(!city)return;
  const cities=SP_ADMIN_CITY_DATA[province] || [];
  const current=city.value;
  city.innerHTML=cities.map(v=>`<option value="${String(v).replace(/"/g,'&quot;')}">${v}</option>`).join('');
  if(cities.includes(current)) city.value=current;
  else if(cities.length) city.value=cities[0];
}
function spAdminInitProjectInputs(){
  const fields=document.querySelectorAll('[data-section="project-info"] .sp-field');
  const province=fields[0]?.querySelector('select');
  const city=fields[1]?.querySelector('select');
  const facility=fields[2]?.querySelector('select');
  if(province)province.id='spPshSelect';
  if(city)city.id='spCitySelect';
  if(facility)facility.id='spFacilitySelect';
  if(province){
    const preferred='DKI Jakarta';
    province.innerHTML=Object.entries(SP_ADMIN_PV_POTENTIAL_DATA).map(([name,psh])=>`<option value="${name} (PSH ${psh})">${name} (PSH: ${psh})</option>`).join('');
    province.value=[...province.options].some(o=>o.value.startsWith(preferred+' '))?[...province.options].find(o=>o.value.startsWith(preferred+' ')).value:province.options[0]?.value||'';
  }
  spAdminPopulateCities();
  if(facility){
    const current=facility.value;
    facility.innerHTML=Object.entries(SP_ADMIN_FACILITY_PROFILES).map(([key,p])=>`<option value="${key}">${p.label}</option>`).join('');
    if([...facility.options].some(o=>o.value===current))facility.value=current;
  }
  province?.addEventListener('change',()=>{spAdminPopulateCities();spAdminRefreshChartOnly();});
  city?.addEventListener('change',spAdminRefreshChartOnly);
  facility?.addEventListener('change',spAdminRefreshChartOnly);
}
function spAdminRefreshChartOnly(){
  if(spCalculation)spRenderSolarProductionChart(spCalculation);
}

function spPsh(){return spAdminPsh();}
// Electrical defaults ported from the standalone PLTS design tool. The catalog CSV has no
// per-panel temperature coefficients and no per-inverter MPPT voltage window, so — exactly
// like the standalone tool does when a catalog row is missing these fields — we fall back to
// its universal defaults instead of inventing per-row values we don't actually have.
const SP_ELEC = {
  Tstc: 25, Tmin: 20, Tcmax: 70,                 // °C — tropical Indonesia design points
  alphaVoc: -0.27, alphaVmp: -0.30,              // %/°C — generic mono-Si temp coefficients
  vInvMax: 1100, vMpptMax: 950, vMpptMin: 200,   // V — inverter DC voltage window
  sPerMppt: 2,                                    // string inputs per MPPT tracker
  rPref: 1.15                                     // fallback preferred DC/AC ratio, used only if #spDcAcRatio is missing from the DOM
};

// Preferred DC/AC (array-to-inverter) oversizing ratio, read live from the
// "Target DC/AC Oversizing Ratio" field. Typical EPC practice targets
// 1.10x-1.30x (the PV array is intentionally larger than the inverter's AC
// nameplate) rather than sizing the array 1:1 with inverter capacity — this
// is the single source used both for inverter-combo selection and for how
// many panels are put on each inverter, so the two stay consistent.
function spDcAcRatio(){
  const v=spNum(document.getElementById('spDcAcRatio')?.value);
  if(!v||v<1) return SP_ELEC.rPref;
  return Math.min(1.5,Math.max(1,v));
}

// Port of findTopo()/the allTopos search from the standalone tool: for ONE inverter unit,
// search N = Ntarget..Ntarget+15 panels for the best string topology — preferring perfectly
// uniform strings first, then fewest extra panels vs target, then DC/AC ratio closest to
// rPref, then fewest strings. This is why panel count sometimes jumps by several panels
// beyond the bare minimum, and why some targets land on a uniform layout while others end
// up with a "long" + "short" string mix.
function spTopology(targetKwpUnit,panel,inv){
  const rPref=spDcAcRatio();
  const Ppanel=spPanelW(panel);
  const vmpStc=spNum(panel.vmpp)||41.5, vocStc=spNum(panel.voc)||49.5;
  const VocCold=vocStc*(1+(SP_ELEC.alphaVoc/100)*(SP_ELEC.Tmin-SP_ELEC.Tstc));
  const VmpHot=vmpStc*(1+(SP_ELEC.alphaVmp/100)*(SP_ELEC.Tcmax-SP_ELEC.Tstc));
  const Lmax=Math.max(1,Math.min(Math.floor(SP_ELEC.vInvMax/VocCold),Math.floor(SP_ELEC.vMpptMax/VocCold)));
  const Lmin=Math.max(1,Math.ceil(SP_ELEC.vMpptMin/VmpHot));
  const mpptCount=Math.max(1,Math.round(spNum(inv.mppt)||1));
  const totalInputs=mpptCount*SP_ELEC.sPerMppt;
  const invKW=spCapacity(inv)||1;
  const Ntarget=Math.max(1,Math.ceil(targetKwpUnit*1000/Ppanel));
  function findTopo(N){
    if(N>totalInputs*Lmax) return null;
    const cands=[];
    for(let k=1;k<=totalInputs;k++){
      const baseLen=Math.floor(N/k), rem=N%k;
      const shortLen=baseLen, longLen=baseLen+1;
      const nShort=k-rem, nLong=rem, isEqual=rem===0;
      if(shortLen<Lmin) continue;
      if(longLen>Lmax) continue;
      cands.push({nStrings:k,shortLen,longLen:isEqual?shortLen:longLen,nShort,nLong,isEqual,ratio:(N*Ppanel)/(invKW*1000),N});
    }
    if(!cands.length) return null;
    cands.sort((a,b)=>{
      if(a.nLong!==b.nLong) return a.nLong-b.nLong;
      const rA=Math.abs(a.ratio-rPref), rB=Math.abs(b.ratio-rPref);
      if(Math.abs(rA-rB)>1e-9) return rA-rB;
      const sA=a.ratio>=rPref?0:1, sB=b.ratio>=rPref?0:1;
      if(sA!==sB) return sA-sB;
      if(a.nStrings!==b.nStrings) return a.nStrings-b.nStrings;
      return b.shortLen-a.shortLen;
    });
    return cands[0];
  }
  const all=[];
  for(let delta=0;delta<=15;delta++){const t=findTopo(Ntarget+delta);if(t)all.push({topo:t,N:Ntarget+delta,delta});}
  if(!all.length){for(let delta=1;delta<=5;delta++){const t=findTopo(Ntarget-delta);if(t){all.push({topo:t,N:Ntarget-delta,delta:-delta});break;}}}
  all.sort((a,b)=>{
    if(a.topo.nLong!==b.topo.nLong) return a.topo.nLong-b.topo.nLong;
    if(a.delta!==b.delta) return a.delta-b.delta;
    const rA=Math.abs(a.topo.ratio-rPref), rB=Math.abs(b.topo.ratio-rPref);
    if(Math.abs(rA-rB)>1e-9) return rA-rB;
    return a.topo.nStrings-b.topo.nStrings;
  });
  let chosen=all[0];
  if(!chosen){
    const Lfall=Lmax||14;
    const k=Math.max(1,Math.ceil(targetKwpUnit*1000/Ppanel/Lfall));
    chosen={topo:{nStrings:k,shortLen:Lfall,longLen:Lfall,nShort:k,nLong:0,isEqual:true,ratio:k*Lfall*Ppanel/(invKW*1000),N:k*Lfall},N:k*Lfall,delta:0};
  }
  const t=chosen.topo;
  return {N:chosen.N,Ntarget,delta:chosen.delta,nStrings:t.nStrings,shortLen:t.shortLen,longLen:t.longLen,
    nShort:t.nShort,nLong:t.nLong,isUniform:t.isEqual,ratio:t.ratio,Lmin,Lmax,VocCold,VmpHot,vmpStc,vocStc,mpptCount,totalInputs};
}

// Port of the MPPT assignment loop from the standalone tool: strings are sorted longest-first
// and packed sPerMppt at a time, starting a new tracker whenever the string length changes —
// so a "long" group and a "short" group never share one MPPT input (avoids current mismatch).
function spMpptAssign(topo){
  const allStr=[];
  for(let i=0;i<topo.nLong;i++) allStr.push(topo.longLen);
  for(let i=0;i<topo.nShort;i++) allStr.push(topo.shortLen);
  allStr.sort((a,b)=>b-a);
  const assign=[]; let mpId=1,slot=1,prevLen=null;
  for(const len of allStr){
    if(prevLen!==null && len!==prevLen){mpId++;slot=1;}
    if(slot>SP_ELEC.sPerMppt){mpId++;slot=1;}
    assign.push({mppt:mpId,slot,nPanels:len});
    slot++; prevLen=len;
  }
  return assign;
}
function spDesign(target,components,forceQty){
  const panel=components.panel, inv=components.inverter;
  if(!panel||!inv)return {valid:false,message:'Select a panel and inverter from the catalog first.'};
  const panelW=spPanelW(panel);
  const invKW=spCapacity(inv)||1;

  // Unit-level design helper: the optimizer supplies an inverter model and quantity,
  // while the public calculator now chooses the best model combination automatically.
  const targetAcKw=target/spDcAcRatio();
  const invCount=Math.max(1,forceQty||Math.ceil(targetAcKw/invKW));
  const targetKwpPerInv=target/invCount;

  // §4-§9 (ported): the exact string-topology + MPPT-assignment search from the
  // standalone PLTS Design Tool, run once per inverter unit (every unit is identical
  // and independent). This is what makes "6 string/inv × 17p" react to Target kWp,
  // panel Wp, and the selected inverter's MPPT/voltage window — previously this page
  // guessed panels/string from a fixed "600V / Vmpp" rule of thumb that never matched
  // the standalone tool's real Lmin/Lmax + best-topology search.
  const topo=spTopology(targetKwpPerInv,panel,inv);
  const mpptAssign=spMpptAssign(topo);
  const mpptActive=mpptAssign.reduce((m,a)=>Math.max(m,a.mppt),0);

  const panelCountPerInv=topo.N;
  const panelCount=panelCountPerInv*invCount;
  const actualPerInv=panelCountPerInv*panelW/1000;
  const actual=actualPerInv*invCount;
  const totalInv=invKW*invCount;
  const ratio=actual/totalInv;
  const eff=Math.max(0.5,Math.min(1,spNum(document.getElementById('spInvEff')?.value||0.998)));
  const peakAC=Math.min(actual,totalInv)*eff;

  const vmpp=topo.vmpStc, voc=topo.vocStc, impp=spNum(panel.impp)||0;
  const stringsPerInv=topo.nStrings, strings=stringsPerInv*invCount;
  const panelsPerString=topo.shortLen; // base/primary string length (what the standalone tool shows as "N")
  const longLen=topo.longLen, shortLen=topo.shortLen, nLong=topo.nLong, nShort=topo.nShort, isUniform=topo.isUniform;
  const L=longLen||shortLen; // longest string — used for the worst-case voltage check
  const vString=vmpp*L, vocCold=topo.VocCold*L;
  // Kept for any older UI copy expecting a single "last string" length; with the ported
  // topology there's no single shorter tail string, so this now represents the longer
  // group's length whenever the layout is non-uniform (long/short groups sit on separate
  // MPPT trackers, exactly like the standalone tool's diagram).
  const last=isUniform?panelsPerString:longLen;

  const roofArea=spNum(document.getElementById('spRoofArea')?.value||0), roofPct=spNum(document.getElementById('spRoofPct')?.value||44)/100;
  const systemType=spSystemType();
  const panelLengthCm=spNum(panel.lCm ?? panel.l ?? 0); const panelWidthCm=spNum(panel.wCm ?? panel.w ?? 0);
  const panelArea=(panelLengthCm>0&&panelWidthCm>0?panelLengthCm*panelWidthCm:1)/10000; const footprint=panelArea*panelCount;
  const roofOK=!document.getElementById('spLimitRoof')?.checked || footprint<=roofArea*roofPct;
  const dcLen=Math.max(1,spNum(document.getElementById('spDcCableLength')?.value||5))*strings;
  const acLen=Math.max(1,spNum(document.getElementById('spAcCableLength')?.value||15));
  const pr=Math.max(0,Math.min(1.2,spNum(document.getElementById('spSystemPr')?.value||0.89)));
  const psh=spPsh();
  const clipLoss=ratio>1?Math.min(0.12,(ratio-1)*0.08):0;
  const daily=actual*psh*pr*eff*(1-clipLoss);
  const annualMwh=daily*365/1000, monthlyKwh=annualMwh*1000/12;
  const batteryPlan=(systemType==='Hybrid'||systemType==='Off-Grid')?spBatterySizing({daily}):{mode:'auto',target:0,row:null,unit:0,qty:0,nominal:0,usableUnit:0,usable:0,cost:0,options:[]};
  const battery=batteryPlan.target>0?batteryPlan.row:null;
  const batteryUnitKwh=spCapacity(battery);
  const batterySizingMode=batteryPlan.mode;
  const batteryQty=batteryPlan.qty;
  const batteryTotalKwh=batteryPlan.nominal;
  const batteryUsableKwh=batteryPlan.usable;
  const batteryTargetKwh=batteryPlan.target;
  const batteryRequiredExcessKwh=batteryPlan.requiredExcessKwh||batteryPlan.target||0;
  const batteryCoverageHours=totalInv>0?batteryTotalKwh/totalInv:0;
  const batteryCost=batteryPlan.cost;
  const voltageOK=vocCold<=1000, stringOK=stringsPerInv>0, valid=voltageOK&&stringOK&&roofOK;
  return {valid, target,panel,inv,panelW,panelLengthCm,panelWidthCm,panelCount,actual,invKW,invCount,totalInv,ratio,peakAC,
    mppt:topo.mpptCount,mpptActive,vmpp,voc,impp,maxStringByVoc:topo.Lmax,panelsPerString,strings,last,vString,vocCold,
    roofArea,roofPct,panelArea,footprint,roofOK,dcLen,acLen,pr,eff,psh,clipLoss,daily,annualMwh,monthlyKwh,energy20:annualMwh*20,
    topo,mpptAssign,stringsPerInv,panelCountPerInv,actualPerInv,isUniform,longLen,shortLen,nLong,nShort,
    type:systemType,battery,batteryUnitKwh,batterySizingMode,batteryQty,batteryTotalKwh,batteryUsableKwh,batteryTargetKwh:batteryPlan.target,batteryRequiredExcessKwh:batteryPlan.requiredExcessKwh||batteryPlan.target||0,batteryCoverageHours,batteryCost,batteryOptions:batteryPlan.options,batteryPlan};
}
function spBuildRAB(calc,c){
  const price=r=>spUnitPrice(r); const items=[];
  const add=(section,no,row,unit,qty,name)=>{if(!row||!qty)return;items.push({section,no,name:name||row.nama,unit,qty,price:price(row),total:price(row)*qty});};
  add('I. Parts',1,c.panel,'pcs',calc.panelCount);
  let no=2;
  if(Array.isArray(calc.inverterBreakdown)&&calc.inverterBreakdown.length){
    calc.inverterBreakdown.forEach(g=>{add('',no++,g.inv,g.inv.satuan||'pcs',g.qty);});
  }else add('',no++,c.inverter,'pcs',calc.invCount);
  if((calc.type==='Hybrid'||calc.type==='Off-Grid')&&calc.battery&&calc.batteryQty>0) {
    const rabBattery=calc.battery;
    add('',no++,rabBattery,rabBattery.satuan||'unit',calc.batteryQty);
  }
  add('',no++,c.mounting,'pcs',calc.panelCount);
  add('II. Installation Materials',no++,c.ac,'mtr',calc.acLen); add('',no++,c.dc,'mtr',calc.dcLen);
  if(Array.isArray(calc.inverterBreakdown)&&calc.inverterBreakdown.length){
    calc.inverterBreakdown.forEach(g=>{const support=spAutoSupportForInverter(g.inv);const pdi=c.pdi&&String(c.pdi.id)===String(support.pdi?.id)?c.pdi:(support.pdi||c.pdi);add('',no++,pdi,'pc',g.qty);});
  }else add('',no++,c.pdi,'pc',calc.invCount);
  add('',no++,c.pddc,'pc',1); add('',no++,c.pdc,'pcs',Math.ceil(calc.strings/2)); add('',no++,c.acc,'lot',1);
  add('III. Services',no++,c.jasa,'lot',1); add('',no++,c.slo,'lot',1);
  const subtotal=items.reduce((s,x)=>s+x.total,0),ppn=subtotal*VAT_RATE,total=subtotal+ppn;
  return {items,subtotal,ppn,total,costPerKwp:subtotal/calc.actual};
}
function spMonthly(calc){const raw=MONTH_FACTORS.map(x=>x);const sum=raw.reduce((a,b)=>a+b,0);return raw.map((f,i)=>({month:MONTHS[i],kwh:calc.annualMwh*1000*(f/sum)}));}
// Round a value up to a "nice" chart-axis ceiling (1/2/2.5/5/10 x 10^n) so the Monthly Energy
// Chart's Y-axis actually reflects the current calculation instead of the old fixed 4.5k scale.
function spNiceAxisMax(v){
  if(!(v>0)) return 100;
  const mag=Math.pow(10,Math.floor(Math.log10(v)));
  const norm=v/mag;
  let nice; if(norm<=1)nice=1; else if(norm<=2)nice=2; else if(norm<=2.5)nice=2.5; else if(norm<=5)nice=5; else nice=10;
  return nice*mag;
}
function spAxisLabel(v){ if(v<=0) return '0'; return v>=1000?`${spFmtNum(v/1000,v%1000===0?0:1)}k`:spFmtNum(v,0); }
function spRenderDesign(calc){
  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};
  const conf=spConfigForActive(calc);
  if(calc.type==='Hybrid'||calc.type==='Off-Grid')spRenderBatteryComparison(calc);
  const invName=conf.inv?.nama||calc.inv?.nama||'Inverter';
  const panelName=calc.panel?.nama||'Panel Surya';
  const invLabel=spConfLabel(conf);
  set('spDesignPanelCount',spFmtNum(calc.panelCount));
  // Show the real string distribution from the ported topology search — a uniform
  // layout ("6 str × 17p"), or the long/short group split when it isn't perfectly even.
  const stringSub = calc.isUniform
    ? `${calc.strings} str × ${calc.panelsPerString}p`
    : `${calc.nShort}×${calc.shortLen}p + ${calc.nLong}×${calc.longLen}p`;
  set('spDesignPanelCountSub',stringSub);
  set('spDesignActualArray',spFmtNum(calc.actual,2));
  set('spDesignActualArraySub',`kWp (target ${spFmtNum(calc.target,0)})`);
  set('spDesignPeakDc',spFmtNum(calc.actual,2));
  set('spDesignPeakDcSub',`kW — ${calc.panelCount} panel`);
  set('spDesignPeakAc',spFmtNum(conf.peak,2));
  set('spDesignPeakAcSub',`kW — ${spFmtNum(conf.total,0)}kW inv.`);
  set('spDesignActiveLabel',`Active Configuration — ${invLabel}`);
  set('spDesignConfigTitle',`${invLabel} — ${spFmtNum(calc.actual,2)} kWp`);
  set('spDesignConfigComponents',`Panel: ${panelName} · ${spFmtNum(calc.panelW,0)} Wp · PV Inverter: ${invName}${(calc.type==='Hybrid'||calc.type==='Off-Grid')&&calc.battery?` · Battery: ${calc.batteryQty}× ${calc.battery.nama} (${spFmtNum(calc.batteryUnitKwh,2)} kWh/unit)`:''}`);
  const designBadge=document.querySelector('#spDesignConfigTitle')?.parentElement?.querySelector('.sp-badge');
  if(designBadge){
    const activeCfg=document.getElementById('spConfigList')?._configs?.find(x=>x.id===spActiveConfigId);
    const isRecommended=activeCfg&&document.getElementById('spConfigList')?._configs?.some(x=>x.id===spActiveConfigId&&x.valueScore===Math.max(...document.getElementById('spConfigList')._configs.map(y=>y.valueScore)));
    designBadge.textContent=(calc.type==='Hybrid'||calc.type==='Off-Grid')?(isRecommended?`${calc.type} · Recommended`:calc.type):(isRecommended?'Recommended':'Active');
  }

  const active=document.querySelector('.sp-tab-pane[data-pane="design"]'); if(!active)return;
  const rows=active.querySelectorAll('tbody tr:not(.sp-table-section)');
  if(rows[0]){rows[0].children[1].textContent=`${spFmtNum(conf.total,0)}kW`;rows[0].children[2].innerHTML=`<span class="sp-badge sp-badge-${conf.ratio<=1.15?'success':'warning'}">DC/AC ${conf.ratio.toFixed(3)}x ${conf.ratio<=1.15?'no major clipping':'clipping risk'}</span>`;}
  if(rows[1]){
    const layoutText = calc.isUniform
      ? `${calc.strings}×${calc.panelsPerString}p`
      : `${calc.nShort}×${calc.shortLen}p + ${calc.nLong}×${calc.longLen}p`;
    rows[1].children[1].textContent = layoutText;
    rows[1].children[2].innerHTML=`<span class="sp-badge sp-badge-info">${calc.mpptActive}/${calc.mppt} MPPT active</span>`;
  }
  if(rows[2]){rows[2].children[1].innerHTML=`${calc.panelsPerString} panel/str <span class="sp-sub">Lmax_abs=${calc.maxStringByVoc}</span>`;rows[2].children[2].innerHTML=`<span class="sp-badge sp-badge-primary">N_target=${calc.panelCount}p</span>`;}
  const vc=active.querySelector('[data-design-row="voc"]');
  if(vc){vc.children[1].textContent=`${spFmtNum(calc.vocCold,1)} V ≤ 1000 V`;vc.children[2].innerHTML=`<span class="sp-badge sp-badge-${calc.vocCold<=1000?'success':'danger'}">${calc.vocCold<=1000?'✓ PASS':'✕ FAIL'}</span>`;}
  const ar=active.querySelector('[data-design-row="footprint"]');
  if(ar){
    const lengthM=calc.panelLengthCm*calc.panelsPerString/100;
    const widthM=calc.panelWidthCm*Math.ceil(calc.strings/Math.max(1,calc.panelsPerString))/100;
    const footprint=calc.footprint;
    ar.children[1].textContent=`${spFmtNum(lengthM,1)} × ${spFmtNum(widthM,1)} m`;
    ar.children[2].innerHTML=`<span class="sp-badge sp-badge-info">${spFmtNum(footprint,1)} m²</span>`;
  }
  const dc=active.querySelector('[data-design-row="dc-cable"]');
  if(dc){dc.children[1].textContent=`${spFmtNum(spNum(document.getElementById('spDcCableLength')?.value||5),1)} m/str → ${spFmtNum(calc.dcLen,0)} m`;dc.children[2].innerHTML='<span class="sp-badge sp-badge-info">user input</span>';}
}
// Mirrors buildDiagramSVG() from the standalone PLTS system design tool (the
// Doctype reference): one Array PV -> DC Combiner -> Inverter row per active
// inverter unit, all rows merging into a single AC bus that continues on to
// AC Distribution -> Load. Every connector is a single continuous <line> with
// marker-end="url(#...)" so the arrowhead sits flush on the wire's own end
// point and inherits the wire's colour (see CSS #spFlowArrow* path{fill:...}) —
// it must never read as a separate ">" glyph floating next to the line.
// Inverter count/topology always comes from the active configuration
// (calc == the optimizer's selected design for spActiveConfigId); nothing
// here is hardcoded.
function spBuildFlowHTML(calc,conf){
  const groups=(calc.inverterBreakdown&&calc.inverterBreakdown.length?calc.inverterBreakdown:null)
    ||(conf&&conf.inverterBreakdown&&conf.inverterBreakdown.length?conf.inverterBreakdown:null)
    ||calc.units||[{inv:conf.inv||calc.inv,qty:conf.qty||1,calc}];
  const units=[];let globalIndex=1;
  groups.forEach(g=>{
    const unitCalc=g.calc||calc;
    for(let i=0;i<g.qty;i++,globalIndex++){
      const invKw=spFmtNum(spCapacity(g.inv),0);
      const nPan=Math.floor(unitCalc.panelCount/g.qty)+(i<(unitCalc.panelCount%g.qty)?1:0);
      const nStr=Math.floor(unitCalc.strings/g.qty)+(i<(unitCalc.strings%g.qty)?1:0);
      const kwpUnit=nPan*unitCalc.panelW/1000;
      units.push({idx:globalIndex,invKw,nPan,nStr,kwpUnit,unitCalc});
    }
  });
  const nUnits=Math.max(units.length,1);

  const type=calc.type||'';
  const isHybrid=type==='Hybrid', isOffGrid=type==='Off-Grid';
  const hasBattery=(isHybrid||isOffGrid)&&calc.battery&&calc.batteryQty>0;

  // ---- shared per-row geometry (identical for all three system types) ----
  const nodeH=64, rowH=100, top=26, bottom=28;
  const pvX=20,pvW=148, cbX=222,cbW=148, invX=424,invW=160;
  const busX=invX+invW+130; // vertical merge line all inverter rows feed into
  const mid=v=>v+nodeH/2;
  const firstY=mid(top), lastY=mid(top+(nUnits-1)*rowH);

  const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const NODE_FILL={
    pv:'rgba(15,106,113,.06)', comb:'rgba(15,106,113,.035)', inv:'rgba(47,158,110,.07)',
    ac:'rgba(124,58,237,.07)', battery:'rgba(217,119,6,.09)', load:'#f4f7f7', default:'#f4f7f7'
  };
  const NODE_STROKE={
    pv:'rgba(15,106,113,.45)', comb:'rgba(15,106,113,.30)', inv:'rgba(47,158,110,.45)',
    ac:'rgba(124,58,237,.48)', battery:'rgba(217,119,6,.55)', load:'#e7edee', default:'#e7edee'
  };
  const rectNode=(x,y,w,title,sub,cls)=>{
    const titleStr=String(title??'');
    const maxTitleW=w-14; // available width inside the box for the title line
    const estTitleW=titleStr.length*7.3; // rough estimate for 12px bold Poppins
    const titleAttr=estTitleW>maxTitleW?` textLength="${maxTitleW}" lengthAdjust="spacingAndGlyphs"`:'';
    const fill=NODE_FILL[cls]||NODE_FILL.default, stroke=NODE_STROKE[cls]||NODE_STROKE.default;
    return `<g class="sp-flow-svg-node ${cls||''}"><rect x="${x}" y="${y}" width="${w}" height="${nodeH}" rx="11" fill="${fill}" stroke="${stroke}" stroke-width="1.2"></rect><text x="${x+w/2}" y="${y+25}" class="t1"${titleAttr} fill="#25343F" font-size="12" font-weight="700" text-anchor="middle">${esc(titleStr)}</text><text x="${x+w/2}" y="${y+45}" class="t2" fill="#7c8b8d" font-size="10.2" text-anchor="middle">${esc(sub)}</text></g>`;
  };
  // One marker per wire colour so the tip always matches the line it ends —
  // this is what keeps the arrowhead visually attached to its connector.
  const MARK={default:'spFlowArrow',charge:'spFlowArrowOrange',discharge:'spFlowArrowViolet'};
  const WIRE_COLOR={default:'#0f6a71',charge:'#d97706',discharge:'#8b5cf6'};
  const arrow=(x1,y1,x2,y2,cls='',mk='default')=>{
    const color=WIRE_COLOR[mk]||WIRE_COLOR.default;
    return `<line class="sp-flow-svg-link ${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" marker-end="url(#${MARK[mk]||MARK.default})"></line>`;
  };
  const plainLine=(x1,y1,x2,y2,cls='')=>`<line class="sp-flow-svg-link ${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0f6a71" stroke-width="${cls==='bus'?2.4:2}" fill="none" stroke-linecap="round" opacity="${cls==='bus'?0.85:1}"></line>`;
  const dot=(x,y)=>`<circle class="sp-flow-svg-link junction-dot" cx="${x}" cy="${y}" r="3.4" fill="#0f6a71" stroke="none"></circle>`;
  const label=(x,y,text,cls='')=>`<text x="${x}" y="${y}" class="sp-flow-svg-label ${cls}" fill="${cls.includes('is-discharge')?'#8b5cf6':cls.includes('battery-label')?'#d97706':'#7c8b8d'}" font-size="9.5" text-anchor="middle">${esc(text)}</text>`;

  // ---- layout that depends on system type (kept orthogonal — no diagonals,
  // no boxes sharing both an x- and y-range, so nothing can overlap) ----
  let distX,distW=160,loadX,loadW=120,batX=0,batW=190,battTopY=0,W,H;
  if(isOffGrid&&hasBattery){
    // Battery is truly in series on the supply path: bus -> Battery -> AC
    // Distribution -> Load. Nothing else taps the bus.
    batX=busX+90;
    distX=batX+batW+90;
    loadX=distX+distW+100;
    W=loadX+loadW+30;
    H=top+nUnits*rowH+bottom;
  } else if(isHybrid&&hasBattery){
    // AC-coupled: the main path runs straight bus -> AC Distribution -> Load;
    // the battery hangs off the bus as a bidirectional tap (charge down /
    // discharge up), drawn as two parallel vertical lines so both directions
    // of energy flow are explicit instead of one ambiguous arrow.
    distX=busX+90;
    loadX=distX+distW+100;
    battTopY=lastY+nodeH/2+52;
    W=Math.max(loadX+loadW+30,busX+batW/2+30);
    H=battTopY+nodeH+bottom+18;
  } else {
    distX=busX+90;
    loadX=distX+distW+100;
    W=loadX+loadW+30;
    H=Math.max(230,top+nUnits*rowH+bottom);
  }

  let svg=`<div class="sp-flow-svg-wrap"><svg class="sp-flow-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="System flow diagram">
    <defs>
      <marker id="spFlowArrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 Z" fill="#0f6a71"></path></marker>
      <marker id="spFlowArrowOrange" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 Z" fill="#d97706"></path></marker>
      <marker id="spFlowArrowViolet" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 Z" fill="#8b5cf6"></path></marker>
    </defs>`;

  // PV → DC Combiner → Inverter, one row per active inverter unit.
  units.forEach((u,i)=>{
    const y=top+i*rowH;
    const cy=mid(y);
    const pvTitle=nUnits>1?`Array PV ${u.idx}`:'Array PV';
    const invTypeLabel=(isHybrid||isOffGrid)?'Inverter Hybrid':'Inverter';
    const invTitle=nUnits>1?`${u.invKw}kW ${invTypeLabel} ${u.idx}`:`${u.invKw}kW ${invTypeLabel}`;
    svg+=rectNode(pvX,y,pvW,pvTitle,`${spFmtNum(u.nPan,0)} panel · ${spFmtNum(u.kwpUnit,2)} kWp`,'pv');
    svg+=rectNode(cbX,y,cbW,'DC Combiner',`${spFmtNum(u.nStr,0)} string · ${spFmtNum(u.unitCalc.vString,0)} V/string`,'comb');
    svg+=rectNode(invX,y,invW,invTitle,`DC/AC ${u.unitCalc.ratio.toFixed(3)}× · ${spFmtNum(u.unitCalc.mppt,0)} MPPT`,'inv');
    svg+=arrow(pvX+pvW,cy,cbX,cy);
    svg+=arrow(cbX+cbW,cy,invX,cy);
    svg+=arrow(invX+invW,cy,busX,cy,'to-bus');
  });

  // Shared AC bus: a plain (arrowless) vertical merge line, exactly like the
  // Doctype's dashed inverter/MPPT bus — several inputs converging, so no
  // single arrowhead applies to it.
  if(nUnits>1) svg+=plainLine(busX,firstY,busX,lastY,'bus');

  if(isOffGrid&&hasBattery){
    const cy=lastY;
    svg+=arrow(busX,cy,batX,cy,'to-battery','charge');
    svg+=label((busX+batX)/2,cy-nodeH/2-8,'Charge','battery-label');
    svg+=rectNode(batX,cy-nodeH/2,batW,'Hybrid Battery Storage',`${calc.batteryQty}× ${spFmtNum(calc.batteryUnitKwh,2)} kWh · ${spFmtNum(calc.batteryTotalKwh,2)} kWh total`,'battery');
    svg+=arrow(batX+batW,cy,distX,cy,'from-battery','discharge');
    svg+=label((batX+batW+distX)/2,cy-nodeH/2-8,'Discharge','battery-label is-discharge');
    svg+=rectNode(distX,cy-nodeH/2,distW,'AC Distribution',`${spFmtNum(conf.total,0)} kW · ${spFmtNum(conf.peak,2)} kW output`,'ac');
    svg+=arrow(distX+distW,cy,loadX,cy,'to-load');
    svg+=rectNode(loadX,cy-nodeH/2,loadW,'Load','Off-Grid Load','load');
    svg+=`<text x="${W/2}" y="${H-8}" class="sp-flow-svg-footer" fill="#7c8b8d" font-size="9" text-anchor="middle">Off-Grid · Array → Inverter → Battery (in series) → AC Distribution → Load</text>`;
  } else {
    const acY=lastY;
    svg+=arrow(busX,acY,distX,acY,'bus-to-ac');
    svg+=rectNode(distX,acY-nodeH/2,distW,'AC Distribution',`${spFmtNum(conf.total,0)} kW · ${spFmtNum(conf.peak,2)} kW output`,'ac');
    svg+=arrow(distX+distW,acY,loadX,acY,'to-load');
    svg+=rectNode(loadX,acY-nodeH/2,loadW,'Load','Facilities','load');

    if(isHybrid&&hasBattery){
      // Bidirectional tap off the AC bus: two parallel vertical lines offset
      // either side of the bus so charge (down, orange) and discharge (up,
      // violet) never overlap the same pixels, and both stay clear of the
      // horizontal PV/Combiner/Inverter rows above them.
      const tapDownX=busX-11, tapUpX=busX+11;
      const battX=busX-batW/2, battY=battTopY;
      svg+=dot(busX,acY);
      svg+=arrow(tapDownX,acY,tapDownX,battY,'charge-path','charge');
      svg+=arrow(tapUpX,battY,tapUpX,acY,'discharge-path','discharge');
      svg+=label(tapDownX-30,(acY+battY)/2,'Charge','battery-label');
      svg+=label(tapUpX+34,(acY+battY)/2,'Discharge','battery-label is-discharge');
      svg+=rectNode(battX,battY,batW,'Hybrid Battery Storage',`${calc.batteryQty}× ${spFmtNum(calc.batteryUnitKwh,2)} kWh · ${spFmtNum(calc.batteryTotalKwh,2)} kWh total`,'battery');
    }
    const footer=isHybrid&&hasBattery
      ?'Hybrid · AC-coupled — Array → Inverter → AC Bus ⇄ Battery → AC Distribution → Load'
      :isHybrid?'Hybrid · AC-coupled — Array → Inverter → AC Distribution → Load'
      :'On-Grid · Array → Inverter → AC Distribution → Load';
    svg+=`<text x="${W/2}" y="${H-8}" class="sp-flow-svg-footer" fill="#7c8b8d" font-size="9" text-anchor="middle">${esc(footer)}</text>`;
  }

  svg+='</svg></div>';
  return svg;
}

// Mirrors the "String Layout per MPPT" panel from the standalone PLTS tool:

// real per-string panel blocks per MPPT tracker, plus a voltage range gauge.

// (The standalone tool also plots a temperature-derated "Vmp hot" point and an

// inverter MPPT voltage window; this app's simpler catalog/model doesn't carry

// panel temp-coefficients or per-inverter MPPT min/max, so the gauge here uses

// the two voltages this calculator actually derives: Vmp STC and Voc cold.)

function spBuildStringLayoutHTML(calc){
  const rows=[];
  const groups=calc.unitCalcs||[{qty:calc.invCount||1,calc}];
  let invIndex=1;
  groups.forEach(g=>{
    for(let u=0;u<g.qty;u++,invIndex++){
      const unit=g.calc||calc,assign=unit.mpptAssign||[],mpptMap={};
      assign.forEach(a=>{(mpptMap[a.mppt]=mpptMap[a.mppt]||[]).push(a.nPanels);});
      for(let i=0;i<unit.mppt;i++){
        const m=i+1,lens=mpptMap[m]||[],active=lens.length>0;
        const groupsHtml=lens.map(len=>`<div class="sp-string-group">${`<span class="sp-string-dot${len<unit.longLen?' is-short':''}"></span>`.repeat(len)}</div>`).join('');
        const uniform=lens.every(l=>l===lens[0]);
        const label=(groups.length>1||calc.invCount>1)?`Inv${invIndex} MPPT ${m}`:`MPPT ${m}`;
        const metaTxt=active?`${lens.length}×${lens[0]}p${uniform?'':' (mixed)'} · ${spFmtNum(unit.vString,0)}V Vmp · ${spFmtNum(unit.vocCold,0)}V Voc`:'inactive';
        rows.push(`<div class="sp-string-row"><span class="sp-string-label">${label}</span><div class="sp-string-dots">${groupsHtml}</div><span class="sp-string-meta">${metaTxt}</span></div>`);
      }
    }
  });
  const absMax=1000;
  const vmpPct=Math.max(0,Math.min(100,calc.vString/absMax*100));
  const vocPct=Math.max(0,Math.min(100,calc.vocCold/absMax*100));
  const gauge=`<div class="sp-volt-gauge"><div class="sp-volt-track"><div class="sp-volt-track-safe" style="width:${vocPct}%"></div><div class="sp-volt-marker is-vmp" style="left:${vmpPct}%" title="Vmp STC ${spFmtNum(calc.vString,0)}V"></div><div class="sp-volt-marker" style="left:${vocPct}%" title="Voc cold ${spFmtNum(calc.vocCold,0)}V"></div></div><div class="sp-volt-labels"><span>0V</span><span><b>Vmp STC: ${spFmtNum(calc.vString,0)}V</b></span><span><b style="color:var(--danger)">Voc cold: ${spFmtNum(calc.vocCold,0)}V</b></span><span>Abs. limit: ${absMax}V</span></div></div>`;
  const summary=`<div class="sp-string-summary">${calc.invCount||1} inverter · ${calc.strings} string total · ${spFmtNum(calc.panelCount,0)} panel · ${spFmtNum(calc.footprint,1)} m²</div>`;
  const notes=(calc.unitCalcs||[]).map(g=>g.calc||calc).map(unit=>unit.isUniform
    ? `Uniform string configuration: ${unit.stringsPerInv} string × ${unit.panelsPerString} panel/string.`
    : `Non-uniform configuration: ${unit.nShort} string ${unit.shortLen}p + ${unit.nLong} string ${unit.longLen}p.`).filter((v,i,a)=>a.indexOf(v)===i).join(' ');
  const note=`<div class="sp-string-note">${notes||'String layout is calculated automatically from the catalog parameters.'} ${calc.vocCold<=absMax?`Voc cold ${spFmtNum(calc.vocCold,0)}V is still below the ${absMax}V limit.`:`⚠ Voc cold ${spFmtNum(calc.vocCold,0)}V exceeds the ${absMax}V limit.`}</div>`;
  return rows.join('')+gauge+summary+note;
}
// =====================================================================

// Solar production vs. consumption visualization

// Visual logic is ported from the public Solar Calculator chart so the

// Admin Calculator uses the same chart geometry, colors, hatch treatment,

// 5-minute resolution, and battery charge/discharge presentation.

// =====================================================================

const SP_SOLAR_DT = 5 / 60;

const SP_SOLAR_START = 7;

const SP_SOLAR_PEAK = 12.5;

const SP_SOLAR_END = 18;



function spSolarShape(t){

  if(t<SP_SOLAR_START||t>SP_SOLAR_END)return 0;

  const sigma=t<SP_SOLAR_PEAK

    ?(SP_SOLAR_PEAK-SP_SOLAR_START)/3

    :(SP_SOLAR_END-SP_SOLAR_PEAK)/3;

  if(sigma<=0)return 0;

  return Math.exp(-Math.pow(t-SP_SOLAR_PEAK,2)/(2*sigma*sigma));

}



function spBuildSolarChartPoints(calc){
  // The Admin Calculator visual chart intentionally follows the public
  // Solar Calculator's load-profile logic: facility type controls the
  // consumption shape, while province PSH controls the total PV production.
  const profile=spAdminFacilityProfile();
  const dailyLoad=Math.max(0,spEstimatedDailyLoad());
  const dailyProduction=Math.max(0,spNum(calc?.actual))*Math.max(0,spAdminPsh());
  const raw=[];
  let loadIntegral=0,solarIntegral=0;
  const DT=SP_SOLAR_DT;

  function shapeAt(t){
    const opening=profile.opening, closing=profile.closing;
    let operating=false;
    if(opening===0 && closing>=23.9) operating=true;
    else if(closing>opening) operating=t>=opening && t<closing;
    else operating=t>=opening || t<closing;

    let multiplier=profile.nightOnly?0:(operating?1:Math.max(0,profile.idleLoadPercent/100));
    if(profile.includePrep && t>=profile.prepStart && t<profile.prepEnd){
      multiplier=Math.max(multiplier,profile.prepLoadPercent/100);
    }
    if(profile.includePeaks){
      for(const peak of profile.peaks||[]){
        if(t>=peak.start && t<peak.end){
          multiplier=Math.max(multiplier,profile.peakMultiplier||1.35);
        }
      }
    }
    return Math.max(0,multiplier);
  }

  for(let i=0;i<288;i++){
    const t=i*DT;
    const loadShape=shapeAt(t);
    const solarShape=spSolarShape(t);
    raw.push({t,loadShape,solarShape});
    loadIntegral+=loadShape*DT;
    solarIntegral+=solarShape*DT;
  }

  const loadScale=loadIntegral>0?dailyLoad/loadIntegral:0;
  const solarScale=solarIntegral>0?dailyProduction/solarIntegral:0;
  return raw.map(p=>({
    t:p.t,
    consumption:Math.max(0,p.loadShape*loadScale),
    solarProduction:Math.max(0,p.solarShape*solarScale),
    overlay:0
  }));
}

function spSolarBatteryScenario(points,calc){

  const catalogueCapacity=Math.max(0,spNum(calc?.batteryTotalKwh));

  const roundTripEfficiency=.92;

  const chargeEfficiency=Math.sqrt(roundTripEfficiency);

  const dischargeEfficiency=Math.sqrt(roundTripEfficiency);

  let socKwh=0,energyStoredKwh=0,energyDischargedKwh=0,remainingSurplusKwh=0;

  const batteryPoints=points.map(p=>{

    const directKwh=Math.min(p.consumption,p.solarProduction)*SP_SOLAR_DT;

    const surplusKwh=Math.max(0,p.solarProduction-p.consumption)*SP_SOLAR_DT;

    const deficitKwh=Math.max(0,p.consumption-p.solarProduction)*SP_SOLAR_DT;

    const availableCapacity=Math.max(0,catalogueCapacity-socKwh);

    const chargeInputKwh=Math.min(surplusKwh,availableCapacity/chargeEfficiency);

    const storedKwh=chargeInputKwh*chargeEfficiency;

    socKwh+=storedKwh;

    const batteryDrawKwh=Math.min(deficitKwh/dischargeEfficiency,socKwh);

    const batteryDeliveredKwh=batteryDrawKwh*dischargeEfficiency;

    socKwh=Math.max(0,socKwh-batteryDrawKwh);

    const remainingKwh=Math.max(0,surplusKwh-chargeInputKwh);

    energyStoredKwh+=storedKwh;

    energyDischargedKwh+=batteryDeliveredKwh;

    remainingSurplusKwh+=remainingKwh;

    return {...p,

      directSelfConsumed:p.overlay,

      batteryChargeKw:SP_SOLAR_DT>0?chargeInputKwh/SP_SOLAR_DT:0,

      batteryDeliveredKw:SP_SOLAR_DT>0?batteryDeliveredKwh/SP_SOLAR_DT:0,

      remainingSurplusKw:SP_SOLAR_DT>0?remainingKwh/SP_SOLAR_DT:0,

      batterySocKwh:socKwh,

      directKwh

    };

  });

  return {points:batteryPoints,capacityKwh:catalogueCapacity,roundTripEfficiency,chargeEfficiency,dischargeEfficiency,energyStoredKwh,energyDischargedKwh,remainingSurplusKwh};

}



function spSolarAreaPathForKey(points,key,x,y){

  if(!points.length)return '';

  const first=points[0];

  const top=points.map((p,i)=>`${i===0?'M':'L'}${x(p.t).toFixed(1)},${y(Math.max(0,p[key]||0)).toFixed(1)}`).join(' ');

  return `${top} L${x(points[points.length-1].t).toFixed(1)},${y(0).toFixed(1)} L${x(first.t).toFixed(1)},${y(0).toFixed(1)} Z`;

}



function spSolarStepBandPath(points,topFn,bottomFn,x,y){

  if(!points.length)return '';

  const top=[],bottom=[];

  points.forEach((p,i)=>{

    const xi=x(p.t),xNext=i<points.length-1?x(points[i+1].t):xi;

    top.push([xi,y(Math.max(0,topFn(p)))]);bottom.push([xi,y(Math.max(0,bottomFn(p)))]);

    if(i<points.length-1){top.push([xNext,y(Math.max(0,topFn(p)))]);bottom.push([xNext,y(Math.max(0,bottomFn(p)))]);}

  });

  const upper=top.map((c,i)=>`${i===0?'M':'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');

  const lower=bottom.slice().reverse().map(c=>`L${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');

  return `${upper} ${lower} Z`;

}



function spSolarNiceChartMax(value){

  const safe=Math.max(1,value),exponent=Math.pow(10,Math.floor(Math.log10(safe))),fraction=safe/exponent;

  const niceFraction=fraction<=1?1:fraction<=2?2:fraction<=5?5:10;

  return niceFraction*exponent;

}



function spBuildSolarProductionChartSvg(points,scenario=null,dims=null){

  const width=dims&&dims.width>0?dims.width:1000;

  const height=dims&&dims.height>0?dims.height:300;

  const marginL=58,marginR=18,marginT=24,marginB=38;

  const innerW=width-marginL-marginR,innerH=height-marginT-marginB;

  const plotPoints=scenario?scenario.points:points;

  const maxData=Math.max(1,...plotPoints.map(p=>Math.max(p.consumption||0,p.solarProduction||0)));

  const maxVal=spSolarNiceChartMax(maxData*1.08);

  const x=t=>marginL+(t/24)*innerW;

  const y=v=>marginT+innerH-(Math.max(0,v)/maxVal)*innerH;

  const linePath=key=>plotPoints.map((p,i)=>`${i===0?'M':'L'}${x(p.t).toFixed(1)},${y(p[key]||0).toFixed(1)}`).join(' ');

  const overlayAreaPath=spSolarAreaPathForKey(plotPoints,scenario?'directSelfConsumed':'overlay',x,y);

  let batteryStorePath='',batteryDischargePath='';

  if(scenario){

    batteryStorePath=spSolarStepBandPath(plotPoints,

      p=>Math.min(Math.max(0,p.solarProduction||0),Math.max(0,p.directSelfConsumed||0)+Math.max(0,p.batteryChargeKw||0)),

      p=>Math.min(Math.max(0,p.solarProduction||0),Math.max(0,p.directSelfConsumed||0)),x,y);

    batteryDischargePath=spSolarStepBandPath(plotPoints,

      p=>Math.max(0,p.consumption||0),

      p=>Math.max(0,Math.max(0,p.consumption||0)-Math.min(Math.max(0,p.batteryDeliveredKw||0),Math.max(0,p.consumption||0))),x,y);

  }

  let gridlines='';

  const ySteps=5;

  for(let i=0;i<=ySteps;i++){

    const value=maxVal*(i/ySteps),yy=y(value);

    gridlines+=`<line x1="${marginL}" y1="${yy.toFixed(1)}" x2="${(marginL+innerW).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="var(--border)" stroke-width="1" />`;

    gridlines+=`<text x="${marginL-9}" y="${(yy+4).toFixed(1)}" font-size="10.5" fill="var(--muted)" text-anchor="end" font-family="Poppins, sans-serif">${spFmtNum(value,0)}</text>`;

  }

  for(let h=0;h<=24;h+=4){

    const xx=x(h);

    gridlines+=`<line x1="${xx.toFixed(1)}" y1="${marginT}" x2="${xx.toFixed(1)}" y2="${(marginT+innerH).toFixed(1)}" stroke="var(--border)" stroke-width="1" opacity="0.65" />`;

    gridlines+=`<text x="${xx.toFixed(1)}" y="${height-12}" font-size="10.5" fill="var(--muted)" text-anchor="middle" font-family="Poppins, sans-serif">${h===24?'24:00':String(h).padStart(2,'0')+':00'}</text>`;

  }

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Estimated daily solar production and electricity consumption">

    <defs><pattern id="spBatteryHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(139,92,246,0.13)"></rect><line x1="0" y1="0" x2="0" y2="8" stroke="rgba(139,92,246,0.34)" stroke-width="3"></line></pattern></defs>

    ${gridlines}

    <path d="${overlayAreaPath}" fill="rgba(16,185,129,0.20)" stroke="none"></path>

    ${scenario?`<path d="${batteryStorePath}" fill="url(#spBatteryHatch)" stroke="none"></path>`:''}

    ${scenario?`<path d="${batteryDischargePath}" fill="rgba(139,92,246,0.18)" stroke="none"></path>`:''}

    <path d="${linePath('consumption')}" fill="none" stroke="#2f80ed" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"></path>

    <path d="${linePath('solarProduction')}" fill="none" stroke="#e78a12" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"></path>

  </svg>`;

}



function spRenderSolarProductionChart(calc){

  const card=document.getElementById('spSolarProductionChartCard');

  const container=document.getElementById('spSolarProductionChart');

  const toggle=document.getElementById('spSolarBatteryChartToggle');

  if(!card||!container)return;

  const show=(calc?.type==='Hybrid'||calc?.type==='Off-Grid')&&calc?.battery&&calc.batteryQty>0;

  card.classList.toggle('hidden',!show);

  if(!show){container.innerHTML='';return;}

  const points=spBuildSolarChartPoints(calc);

  points.forEach(p=>{p.overlay=Math.min(p.consumption,p.solarProduction);p.directSelfConsumed=p.overlay;});

  const scenario=toggle?.checked!==false?spSolarBatteryScenario(points,calc):null;

  const rect=container.getBoundingClientRect();
  const width=rect.width>20?rect.width:Math.max(720,container.parentElement?.getBoundingClientRect().width||720);

  container.innerHTML=spBuildSolarProductionChartSvg(points,scenario,{width,height:rect.height||300});

  const batteryLegend=document.getElementById('spSolarBatteryLegend');

  const dischargeLegend=document.getElementById('spSolarDischargeLegend');

  if(batteryLegend)batteryLegend.style.display=scenario?'flex':'none';

  if(dischargeLegend)dischargeLegend.style.display=scenario?'flex':'none';

}




function spRenderVisual(calc){
  const pane=document.querySelector('.sp-tab-pane[data-pane="visual"]');if(!pane)return;
  const vals=pane.querySelectorAll('.sp-metric-card .sp-metric-value');const subs=pane.querySelectorAll('.sp-metric-card .sp-metric-sub');
  if(vals[0])vals[0].textContent=spFmtNum(calc.actual,2);if(subs[0])subs[0].textContent=`kW — ${calc.panelCount} panel`;
  const conf=spConfigForActive(calc);
  if(vals[1])vals[1].textContent=spFmtNum(conf.peak,2);if(subs[1])subs[1].textContent=`kW — ${spFmtNum(conf.total,0)}kW inv.`;
  if(vals[2])vals[2].textContent=spFmtNum(calc.daily,1);if(subs[2])subs[2].textContent=`kWh/day — PSH ${calc.psh.toFixed(3)}`;
  if(vals[3])vals[3].textContent=spFmtNum(calc.annualMwh,2);if(subs[3])subs[3].textContent='MWh/year';
  const plot=document.getElementById('spBarPlot');let monthlyMax=0;
  if(plot){
    const data=spMonthly(calc);
    monthlyMax=Math.max(...data.map(x=>x.kwh));
    const axisMax=spNiceAxisMax(monthlyMax);
    plot.innerHTML=data.map(x=>{
      const pct=Math.max(4,Math.min(100,(x.kwh/axisMax)*100));
      const valueLabel=x.kwh>=1000?`${spFmtNum(x.kwh/1000,1)}k`:spFmtNum(x.kwh,0);
      return `<div class="sp-bar" style="height:${pct}%" title="${spFmtNum(x.kwh,0)} kWh"><span class="sp-bar-value">${valueLabel}</span><span class="sp-bar-month">${x.month}</span></div>`;
    }).join('');
  }
  // The Y-axis scale was static dummy text (4.5k…0); rebuild it from this calc's monthly output.
  const yaxis=document.getElementById('spBarYAxis');
  if(yaxis){const niceMax=spNiceAxisMax(monthlyMax),steps=9,labels=[];for(let i=0;i<=steps;i++)labels.push(niceMax-(niceMax/steps)*i);yaxis.innerHTML=labels.map(v=>`<span>${spAxisLabel(v)}</span>`).join('');}
  const flow=document.getElementById('spFlow')||pane.querySelector('.sp-flow');
  if(flow) flow.innerHTML=spBuildFlowHTML(calc,conf);
  spRenderSolarProductionChart(calc);

  const scenarioCard=document.getElementById('spBatteryScenarioCard');
  if(scenarioCard){
    const showScenario=(calc.type==='Hybrid'||calc.type==='Off-Grid')&&Number(calc.batteryQty||0)>0;
    scenarioCard.classList.toggle('hidden',!showScenario);
    if(showScenario){
      const points=spBuildSolarChartPoints(calc);
      points.forEach(p=>{p.overlay=Math.min(p.consumption,p.solarProduction);p.directSelfConsumed=p.overlay;});
      const scenario=spSolarBatteryScenario(points,calc);
      const excess=Math.max(0,spNum(calc.daily)-spEstimatedDailyLoad());
      const set=(id,text)=>{const el=document.getElementById(id);if(el)el.textContent=text;};
      set('spScenarioExcess',`${spFmtNum(excess,1)} kWh/day`);
      set('spScenarioCapacity',`${spFmtNum(calc.batteryTotalKwh,1)} kWh`);
      set('spScenarioStored',`${spFmtNum(scenario.energyStoredKwh,1)} kWh/day`);
      set('spScenarioDischarged',`${spFmtNum(scenario.energyDischargedKwh,1)} kWh/day`);
      set('spScenarioEfficiency',`${Math.round((scenario.roundTripEfficiency||0)*100)}%`);
    }
  }
  const batteryCard=document.getElementById('spBatteryVisualCard');
  const batteryGrid=document.getElementById('spBatteryVisualGrid');
  const batteryNote=document.getElementById('spBatteryVisualNote');
  const batterySub=document.getElementById('spBatteryVisualSub');
  if(batteryCard){
    const show=(calc.type==='Hybrid'||calc.type==='Off-Grid')&&calc.battery&&calc.batteryQty>0;
    batteryCard.classList.toggle('hidden',!show);
    if(show){
      if(batterySub) batterySub.textContent=`${calc.battery.nama||'Battery'} · target ${spFmtNum(calc.batteryTargetKwh,2)} kWh`;
      if(batteryGrid) batteryGrid.innerHTML=[
        ['Battery Model',calc.battery.nama||'-',calc.batteryQty+' unit'],
        ['Target Capacity',spFmtNum(calc.batteryTargetKwh,2)+' kWh','planning target'],
        ['Nominal Capacity',spFmtNum(calc.batteryTotalKwh,2)+' kWh',calc.batteryQty+' × '+spFmtNum(calc.batteryUnitKwh,2)+' kWh'],
        ['Usable Capacity',calc.batteryUsableKwh>0?spFmtNum(calc.batteryUsableKwh,2)+' kWh':'Not specified','catalog/reference data'],
        ['Nominal Coverage',spFmtNum(calc.batteryCoverageHours,2)+' h','at inverter rated output']
      ].map(([l,v,u])=>`<div class="sp-battery-metric"><label>${l}</label><strong>${v}</strong><span>${u}</span></div>`).join('');
      if(batteryNote){
        const bm=calc.batterySizingMode||'auto';
        const batterySizingLabel=bm==='capacity'
          ? `Manual — target capacity ${spFmtNum(calc.batteryTargetKwh,2)} kWh.`
          : bm==='auto'
            ? (calc.type==='Off-Grid'?'Auto — full estimated daily load.':'Auto — full estimated daily excess.')
            : 'Manual — selected target capacity.';
        batteryNote.textContent=`Battery sizing: ${batterySizingLabel} ${calc.batteryUsableKwh>0?`${calc.battery?.nama||'Selected battery'} usable capacity: ${spFmtNum(calc.batteryUsableKwh,2)} kWh total.`:'Usable capacity is not specified for the selected battery in the active catalog.'}`;
      }
      spRenderBatteryComparison(calc);
    }
  }
  const layout=document.getElementById('spStringLayoutRows');if(layout)layout.innerHTML=spBuildStringLayoutHTML(calc);
  const clipCap=pane.querySelector('#spClipInvCap');if(clipCap)clipCap.textContent=`${spFmtNum(conf.total,0)}kW`;
  const clipLine=pane.querySelector('#spClipActual');const clipCaption=pane.querySelector('#spClipCaption');if(clipLine){const severity=Math.min(1,Math.max(0,conf.ratio-1)*2);clipLine.setAttribute('d',severity>0?'M 20 175 C 150 175, 210 80, 280 60 L 420 60 C 490 80, 550 175, 680 175':'M 20 175 C 150 175, 200 25, 350 20 C 500 25, 550 175, 680 175');}if(clipCaption)clipCaption.textContent=conf.ratio>1?'DC output may exceed the inverter AC capacity at peak production; the clipping estimate is included in the annual energy figure.':'Inverter capacity is sufficient for the array output under design conditions; there is no indication of significant clipping in this estimate.';
}
function spEnumerateInverterCombos(invs,maxUnits=6){
  const out=[];
  function walk(start,units){
    if(units.length>0)out.push(units.slice());
    if(units.length>=maxUnits)return;
    for(let i=start;i<invs.length;i++)walk(i,units.concat(invs[i]));
  }
  walk(0,[]);
  return out;
}

function spBuildMixedConfig(target,components,units){
  if(!units||!units.length)return null;
  const totalInv=units.reduce((s,u)=>s+spCapacity(u),0);
  if(!(totalInv>0))return null;
  const grouped=[];
  for(let i=0;i<units.length;){
    const inv=units[i];let j=i+1;while(j<units.length&&String(units[j].id)===String(inv.id))j++;
    grouped.push({inv,qty:j-i});i=j;
  }
  const unitCalcs=grouped.map(g=>{
    const share=target*(spCapacity(g.inv)*g.qty/totalInv);
    return {...g,calc:spDesign(share,{...components,inverter:g.inv},g.qty)};
  });
  if(unitCalcs.some(x=>!x.calc||!x.calc.valid&&x.calc.vocCold>1000))return null;
  const panelCount=unitCalcs.reduce((s,x)=>s+x.calc.panelCount,0);
  const actual=unitCalcs.reduce((s,x)=>s+x.calc.actual,0);
  const strings=unitCalcs.reduce((s,x)=>s+x.calc.strings,0);
  const mppt=unitCalcs.reduce((s,x)=>s+(x.calc.mppt*x.qty),0);
  const mpptActive=unitCalcs.reduce((s,x)=>s+(x.calc.mpptActive*x.qty),0);
  const footprint=unitCalcs.reduce((s,x)=>s+x.calc.footprint,0);
  const dcLen=unitCalcs.reduce((s,x)=>s+x.calc.dcLen,0);
  const acLen=Math.max(...unitCalcs.map(x=>x.calc.acLen));
  const ratio=actual/totalInv;
  const eff=Math.max(0.5,Math.min(1,spNum(document.getElementById('spInvEff')?.value||0.998)));
  const pr=Math.max(0,Math.min(1.2,spNum(document.getElementById('spSystemPr')?.value||0.89)));
  const psh=spPsh();
  const clipLoss=ratio>1?Math.min(.12,(ratio-1)*.08):0;
  const daily=actual*psh*pr*eff*(1-clipLoss);
  const annualMwh=daily*365/1000;
  const voltageOK=unitCalcs.every(x=>x.calc.vocCold<=1000);
  const roofArea=spNum(document.getElementById('spRoofArea')?.value||0), roofPct=spNum(document.getElementById('spRoofPct')?.value||44)/100;
  const roofOK=!document.getElementById('spLimitRoof')?.checked || footprint<=roofArea*roofPct;
  const first=unitCalcs[0].calc;
  // Size the battery once from the aggregated system energy. Per-inverter unit
  // calculations are only used for PV/string design; battery sizing must use
  // the total daily production so it remains consistent when inverter count or
  // model changes.
  const batteryPlan=(spSystemType()==='Hybrid'||spSystemType()==='Off-Grid')?spBatterySizing({daily,type:spSystemType()}):{mode:'auto',target:0,row:null,unit:0,qty:0,nominal:0,usableUnit:0,usable:0,cost:0,options:[]};
  const battery=batteryPlan.target>0?batteryPlan.row:null;
  const batteryUnitKwh=spCapacity(battery);
  const batterySizingMode=batteryPlan.mode;
  const batteryQty=batteryPlan.qty;
  const batteryTotalKwh=batteryPlan.nominal;
  const batteryUsableKwh=batteryPlan.usable;
  const batteryCoverageHours=totalInv>0?batteryTotalKwh/totalInv:0;
  const batteryCost=batteryPlan.cost;
  const invCount=units.length;
  const inverterBreakdown=unitCalcs.map(g=>({inv:g.inv,qty:g.qty,calc:g.calc}));
  const isUniform=unitCalcs.length===1&&first.isUniform;
  return {
    ...first,target,panel:components.panel,inv:grouped[0].inv,invCount,totalInv,ratio,peakAC:unitCalcs.reduce((s,x)=>s+x.calc.peakAC,0),
    panelCount,actual,strings,mppt,mpptActive,footprint,dcLen,acLen,eff,pr,psh,clipLoss,daily,annualMwh,energy20:annualMwh*20,
    roofArea,roofPct,roofOK,voltageOK,valid:voltageOK&&roofOK,
    unitCalcs,inverterBreakdown,units:grouped,battery,batteryUnitKwh,batterySizingMode,batteryQty,batteryTotalKwh,batteryUsableKwh,batteryTargetKwh:batteryPlan.target,batteryRequiredExcessKwh:batteryPlan.requiredExcessKwh||batteryPlan.target||0,batteryCoverageHours,batteryCost,batteryOptions:batteryPlan.options,
    panelCountPerInv:first.panelCountPerInv,actualPerInv:first.actualPerInv,stringsPerInv:first.stringsPerInv,panelsPerString:first.panelsPerString,
    isUniform,longLen:first.longLen,shortLen:first.shortLen,nLong:first.nLong,nShort:first.nShort,
    vString:Math.max(...unitCalcs.map(x=>x.calc.vString)),vocCold:Math.max(...unitCalcs.map(x=>x.calc.vocCold)),
    mpptAssign:first.mpptAssign,topo:first.topo,maxStringByVoc:Math.max(...unitCalcs.map(x=>x.calc.maxStringByVoc)),
  };
}


function spEnumerateRepeatedInverterCombos(invs,maxUnits=12){
  // Hybrid/Off-Grid catalogs may contain only one inverter model. Reusing that
  // catalog model is valid when the design needs multiple units.
  const sorted=[...invs].sort((a,b)=>spCapacity(a)-spCapacity(b)||spPrice(a)-spPrice(b));
  const combos=[];
  function walk(start,units,total){
    if(units.length){
      combos.push(units.slice());
    }
    if(units.length>=maxUnits)return;
    for(let i=start;i<sorted.length;i++){
      const nextTotal=total+spCapacity(sorted[i]);
      units.push(sorted[i]);
      walk(i,units,nextTotal);
      units.pop();
    }
  }
  walk(0,[],0);
  return combos;
}

function spBuildAutoConfigurations(target,components,type){
  // Configuration optimizer follows the Doctype reference logic:
  // - On-Grid uses the On-Grid inverter catalog pool.
  // - Hybrid and Off-Grid both use the Hybrid inverter catalog pool.
  // - Enumerate single-type, two-type mixed, targeted, and three-type combinations.
  // - Validate each candidate by DC/AC fit and string/topology feasibility.
  // - Rank candidates from the resulting catalog-backed total system cost.
  // Battery sizing remains handled by the existing Battery Optimizer and is not
  // allowed to create a second independent battery selection path.
  const requestedPool=document.getElementById('spInverterPoolMode')?.value||'ongrid';
  const poolCategory=type==='On-Grid'?'Inverter On-Grid':(requestedPool==='hybrid'?'Inverter Hybrid':'Inverter On-Grid');
  const invs=spCatalogRows
    .filter(r=>String(r.kategori||'').trim()===poolCategory)
    .filter(r=>spCapacity(r)>0&&spPrice(r)>0)
    .sort((a,b)=>spCapacity(a)-spCapacity(b)||spPrice(a)-spPrice(b));
  if(!invs.length)return[];

  const panel=components.panel;
  if(!panel)return[];
  const pWp=spCapacity(panel)||spNum(panel.wp)||0;
  const rPref=spDcAcRatio();
  const rMin=SP_ELEC.rMin||0.90;
  const rMax=SP_ELEC.rMax||1.40;

  const getStrLims=inv=>{
    const vocCold=(()=>{
      const voc=spNum(panel.voc)||49.5;
      const alpha=((spNum(panel.alphaVoc)||-0.27)/100);
      const tmin=spNum(document.getElementById('spTMin')?.value||20);
      return voc*(1+alpha*(tmin-25));
    })();
    const vmpHot=(()=>{
      const vmpp=spNum(panel.vmpp)||41.5;
      const alpha=((spNum(panel.alphaVmp)||-0.30)/100);
      const tcmax=spNum(document.getElementById('spTCellMax')?.value||70);
      return vmpp*(1+alpha*(tcmax-25));
    })();
    const Vi=spNum(inv.vInvMax)||1100;
    const Vx=spNum(inv.vMpptMax)||1000;
    const Vm=spNum(inv.vMpptMin)||200;
    return{Lmin:Math.ceil(Vm/vmpHot),Lmax:Math.min(Math.floor(Vi/vocCold),Math.floor(Vx/vocCold))};
  };

  const maxPanels=inv=>{
    const {Lmax}=getStrLims(inv);
    return (spNum(inv.mppt)||2)*(spNum(inv.sPerMppt)||2)*Lmax;
  };

  const findBestTopo=(NminPerUnit,inv,Lmin,Lmax)=>{
    const totalInputs=(spNum(inv.mppt)||2)*(spNum(inv.sPerMppt)||2);
    const all=[];
    for(let d=0;d<=15;d++){
      const N=NminPerUnit+d;
      if(N>totalInputs*Lmax)break;
      for(let k=1;k<=totalInputs;k++){
        const base=Math.floor(N/k),rem=N%k;
        const sL=base,lL=base+1,nS=k-rem,nL=rem,eq=rem===0;
        if(sL<Lmin||lL>Lmax)continue;
        all.push({nStrings:k,shortLen:sL,longLen:eq?sL:lL,nShort:nS,nLong:nL,isEqual:eq,
          ratio:(N*pWp)/(spCapacity(inv)*1000),N,delta:d});
      }
    }
    if(!all.length)return null;
    all.sort((a,b)=>{
      if(a.nLong!==b.nLong)return a.nLong-b.nLong;
      if(a.delta!==b.delta)return a.delta-b.delta;
      const da=Math.abs(a.ratio-rPref),db=Math.abs(b.ratio-rPref);
      if(Math.abs(da-db)>1e-9)return da-db;
      return a.nStrings!==b.nStrings?a.nStrings-b.nStrings:b.shortLen-a.shortLen;
    });
    return all[0];
  };

  const tryGroup=groups=>{
    const totalAcKw=groups.reduce((s,[inv,cnt])=>s+spCapacity(inv)*cnt,0);
    if(!(totalAcKw>0))return null;
    const dcac=target/totalAcKw;
    if(dcac<rMin*0.72||dcac>rMax*1.25)return null;

    let totalN=0;
    const unitResults=[];
    for(const [inv,cnt] of groups){
      const {Lmin,Lmax}=getStrLims(inv);
      if(Lmin>Lmax)return null;
      const tKwpUnit=target*(spCapacity(inv)/totalAcKw);
      const NminUnit=Math.ceil(tKwpUnit*1000/pWp);
      if(NminUnit>maxPanels(inv))return null;
      const topo=findBestTopo(NminUnit,inv,Lmin,Lmax);
      if(!topo)return null;
      unitResults.push({inv,cnt,topo,NperUnit:topo.N});
      totalN+=topo.N*cnt;
    }

    const actKwp=totalN*pWp/1000;
    const actualDcAc=actKwp/totalAcKw;
    if(actualDcAc<rMin*0.72||actualDcAc>rMax*1.25)return null;

    const units=[];
    groups.forEach(([inv,cnt])=>{for(let i=0;i<cnt;i++)units.push(inv);});
    const calc=spBuildMixedConfig(target,components,units);
    // Only gate candidate generation on electrical feasibility (voltage), mirroring
    // dummy.html's tryGroup(): roof-area fit is never part of its ranking filter,
    // it's surfaced separately as a warning once a config is already selected.
    if(!calc||!calc.voltageOK)return null;

    // Use the existing catalog-backed support resolver and RAB so the candidate
    // cost remains consistent with the rest of Admin Calc.
    const dominant=groups.reduce((a,b)=>spCapacity(a[0])>=spCapacity(b[0])?a:b);
    const support=spApplyAutoSupport(dominant[0],components);
    const rab=spBuildRAB(calc,{...support,inverter:calc.inv,battery:calc.battery||null});
    const totalCost=rab.subtotal;

    // Mirrors configCost() in dummy.html exactly: panel + mounting + inverter
    // nameplate prices (all via spPrice / spActivePriceValue, the shared
    // HPP -> Des '25 -> Sep '25 active-price helper) plus the same flat
    // Rp 200,000,000 placeholder overhead.
    // Combo ranking (cheapest/recommended) uses THIS figure — not the full RAB
    // subtotal above, which varies by combo unit-count (extra PDI panels,
    // cabling, accessories) in ways dummy.html's simplified model never
    // accounts for. That mismatch was why a 3-unit combo could out-rank a
    // 2-unit combo here while dummy.html picked the 2-unit one, or vice versa.
    // Keeping totalCost/rab for the real project price shown elsewhere.
    const dummyCost=(totalN*spPrice(components.panel))
      +(totalN*(spPrice(components.mounting)||1298077))
      +groups.reduce((s,[inv,cnt])=>s+spPrice(inv)*cnt,0)
      +200000000;

    const ratio=calc.ratio;
    const peakAcEff=Math.min(actKwp*(calc.eff||0.998),totalAcKw);
    const clipping=Math.max(0,actKwp*(calc.eff||0.998)-totalAcKw);
    const clipPct=actKwp*(calc.eff||0.998)>totalAcKw
      ?(1-totalAcKw/(actKwp*(calc.eff||0.998)))*100:0;
    const technicalPenalty=Math.min(55,Math.abs(ratio-rPref)*70);
    const mismatchPenalty=calc.unitCalcs?.some(x=>!x.calc?.isUniform)?8:0;
    const clippingPenalty=Math.min(20,clipPct*0.6);
    const voltagePenalty=calc.vocCold>1000?45:0;
    // Prefer combos whose total inverter nameplate AC capacity lands close to
    // the target DC/AC-implied AC size (target / rPref) — e.g. for a 120kWp
    // target at rPref 1.15x, ~104.3kW of inverter AC is the ideal fit, not
    // 120kW of inverter AC. Sizing inverter AC ≈ target kWp 1:1 (the old
    // behavior) forced a ~1.0x DC/AC ratio regardless of rPref, undercutting
    // the oversizing this field is meant to control. Catalog-matching still
    // takes priority over exactly hitting rPref (this is a soft preference,
    // combined with technicalPenalty below), consistent with the original
    // intent of this penalty term.
    const targetAcForFit=target/rPref;
    const capacityFitPenalty=Math.min(35,Math.abs(totalAcKw-targetAcForFit)/targetAcForFit*160);
    const technicalScore=Math.max(0,100-technicalPenalty-mismatchPenalty-clippingPenalty-voltagePenalty-capacityFitPenalty);

    const invLabel=groups.map(([inv,cnt])=>(cnt>1?cnt+'×':'')+spCapacity(inv)+'kW').join(' + ');
    const topoLabel=unitResults.map(({inv,cnt,topo})=>{
      const t=topo.isEqual?topo.nStrings+'×'+topo.shortLen+'p':(topo.nLong+'×'+topo.longLen+'p+'+topo.nShort+'×'+topo.shortLen+'p');
      return (cnt>1?cnt+'×':'')+'['+t+']';
    }).join(' + ');
    const id=groups.map(([inv,cnt])=>`${cnt}x${inv.id}`).sort().join('|');
    const qty=groups.reduce((s,[,cnt])=>s+cnt,0);

    return {
      id,
      inv:groups[0][0],
      qty,
      total:totalAcKw,
      ratio,
      peak:peakAcEff,
      energy:calc.daily,
      cost:totalCost,
      dummyCost,
      technicalScore,
      batteryQty:calc.batteryQty,
      batteryTotalKwh:calc.batteryTotalKwh,
      invs,
      groups,
      unitResults,
      invLabel,
      topoLabel,
      clipping,
      clipPct,
      components:{...support,battery:calc.battery||null},
      design:calc,
      inverterBreakdown:calc.inverterBreakdown,
      totalN,
      actKwp,
      cpp:actKwp>0?totalCost/actKwp:0,
      coe:calc.energy20>0?totalCost/(calc.energy20*1000):0,
      isMixed:groups.length>1||groups[0][1]>1
    };
  };

  const seen=new Set(),results=[];
  const addIfNew=cfg=>{
    if(!cfg||seen.has(cfg.id))return;
    seen.add(cfg.id);results.push(cfg);
  };

  // 1. Single-type parallel combinations.
  const maxUnitsGlobal=Math.min(20,Math.max(1,Math.ceil(target/(Math.max(1,invs[0].kw||spCapacity(invs[0]))*(rMin*0.72)))));
  for(const inv of invs){
    const maxN=Math.min(maxUnitsGlobal,20,Math.max(1,Math.ceil(target/(spCapacity(inv)*(rMin*0.72)))));
    for(let n=1;n<=maxN;n++)addIfNew(tryGroup([[inv,n]]));
  }

  // 2. Two-type combinations, matching Doctype search space.
  for(let i=0;i<invs.length;i++){
    for(let j=i;j<invs.length;j++){
      const invA=invs[i],invB=invs[j];
      const maxNA=Math.min(10,Math.max(1,Math.ceil(target/(spCapacity(invA)*(rMin*0.72)))));
      const maxNB=Math.min(10,Math.max(1,Math.ceil(target/(spCapacity(invB)*(rMin*0.72)))));
      for(let nA=1;nA<=maxNA;nA++){
        for(let nB=(invA.id===invB.id?nA:1);nB<=maxNB;nB++){
          if(invA.id===invB.id&&nB===nA)continue;
          addIfNew(tryGroup([[invA,nA],[invB,nB]]));
        }
      }
    }
  }

  // 3. Targeted close-to-target combinations ±25 kW.
  for(let i=0;i<invs.length;i++){
    for(let j=i;j<invs.length;j++){
      const invA=invs[i],invB=invs[j];
      for(let nA=1;nA<=8;nA++)for(let nB=1;nB<=8;nB++){
        if(invA.id===invB.id&&nB<=nA)continue;
        const totKw=spCapacity(invA)*nA+spCapacity(invB)*nB;
        if(Math.abs(totKw-target)<=25)addIfNew(tryGroup([[invA,nA],[invB,nB]]));
      }
    }
  }
  for(const inv of invs){
    for(let n=1;n<=15;n++){
      const totKw=spCapacity(inv)*n;
      if(Math.abs(totKw-target)<=25)addIfNew(tryGroup([[inv,n]]));
    }
  }

  // 4. Three-type combinations, same bounded search pattern as Doctype.
  if(invs.length>=2){
    for(let ai=0;ai<invs.length;ai++){
      for(let bi=ai;bi<invs.length;bi++){
        for(let ci=bi;ci<invs.length;ci++){
          const a=invs[ai],b=invs[bi],c=invs[ci];
          for(let na=1;na<=3;na++)for(let nb=1;nb<=3;nb++)for(let nc=1;nc<=3;nc++){
            if(na+nb+nc>10)continue;
            addIfNew(tryGroup([[a,na],[b,nb],[c,nc]]));
          }
        }
      }
    }
  }

  if(!results.length)return[];

  const minCost=Math.min(...results.map(x=>x.dummyCost));
  const maxCost=Math.max(...results.map(x=>x.dummyCost));
  results.forEach(x=>{
    const costScore=maxCost===minCost?100:100-((x.dummyCost-minCost)/(maxCost-minCost))*100;
    x.valueScore=x.technicalScore*.55+costScore*.45;
  });

  // Keep the Doctype-style result ranking available to the existing preference UI.
  return results;
}

function spApplyRecommendation(calc,mode){
  const list=document.getElementById('spConfigList');const arr=list?list._configs:null;if(!arr||!arr.length)return null;
  const x=spRecommendationForValue(arr,mode||'recommended');
  if(!x)return null;
  spActiveConfigId=x.id;
  const c=x.components||spSelectedComponents();
  // Keep the automatically selected support components visible in the Customize area.
  Object.entries({ac:'spAcCableCatalogSelect',pdi:'spPdiCatalogSelect',pddc:'spPddcCatalogSelect',acc:'spAccCatalogSelect',jasa:'spJasaCatalogSelect',slo:'spSloCatalogSelect'}).forEach(([k,id])=>{
    const el=document.getElementById(id),row=c[k];if(el&&row&&(!el.value||el.dataset.spAuto==='true')){el.value=row.id;el.dataset.spAuto='true';el.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  return x;
}


function spConfigRoleMap(configs){
  const roles={recommended:spRecommendationForValue(configs,'recommended'),price:spRecommendationForValue(configs,'price'),quality:spRecommendationForValue(configs,'quality')};
  const byId=new Map();
  Object.entries(roles).forEach(([role,x])=>{
    if(!x)return;
    if(!byId.has(x.id))byId.set(x.id,[]);
    byId.get(x.id).push(role);
  });
  return {roles,byId};
}
function spConfigLabelForRoles(x,roles){
  const names=[];
  if(roles.includes('recommended'))names.push('⭐ Recommended · Best Value');
  if(roles.includes('price'))names.push('💰 Best Price');
  if(roles.includes('quality'))names.push('🏆 Best Quality');
  return names.length?names.join(' + '):'Alternative';
}
function spSyncPreferenceSelect(configs,preferredId){
  const s=document.getElementById('spPackageSelect');
  if(!s||!configs?.length)return;
  const {byId}=spConfigRoleMap(configs);
  const ranked=[];
  byId.forEach((roles,id)=>{
    const x=configs.find(c=>c.id===id);
    if(x)ranked.push({x,roles});
  });
  ranked.sort((a,b)=>{
    const order=v=>v.includes('recommended')?0:v.includes('price')?1:2;
    return order(a.roles)-order(b.roles)||b.x.valueScore-a.x.valueScore;
  });
  const current=preferredId||s.value;
  s.innerHTML=ranked.map(({x,roles})=>`<option value="${x.id}">${spConfigLabelForRoles(x,roles)}</option>`).join('');
  if(ranked.some(v=>v.x.id===current))s.value=current;
  else if(ranked[0])s.value=ranked[0].x.id;
}

function spRenderConfigCards(calc,c){
  const list=document.getElementById('spConfigList');if(!list)return;
  const configs=spBuildAutoConfigurations(calc.target,{...spSelectedComponents(),panel:calc.panel},calc.type||c);
  if(!configs.length){list.innerHTML='<div class="sp-empty"><p>No inverter combination meets the technical/catalog constraints for this target.</p></div>';list._configs=[];return;}
  const bestValue=spRecommendationForValue(configs,'recommended');
  const bestPrice=spRecommendationForValue(configs,'price');
  const bestQuality=spRecommendationForValue(configs,'quality');
  const pref=document.getElementById('spPackageSelect');
  const preferredId=pref?.value && configs.some(x=>x.id===pref.value) ? pref.value : '';
  spSyncPreferenceSelect(configs,preferredId);
  const selectedId=document.getElementById('spPackageSelect')?.value||'';
  const selected=configs.find(x=>x.id===selectedId)||bestValue||bestPrice||bestQuality;
  spActiveConfigId=selected.id;
  const sameId=selected.id;
  const roleMap=spConfigRoleMap(configs);
  const selectedRoles=roleMap.byId.get(selected.id)||[];
  const modeLabel=spConfigLabelForRoles(selected,selectedRoles);
  const summary=document.getElementById('spPackageSummary');
  if(summary){
    const cc=selected.components||{};
    const lines=[];
    const addLine=(label,row,extra='')=>{if(row)lines.push(`<span><b>${label}:</b> ${row.nama||row.id}${extra?` · ${extra}`:''}</span>`);};
    addLine('Panel',cc.panel||selected.design?.panel,cc.panel?`${spFmtNum(spCapacity(cc.panel),0)} Wp`:'');
    lines.push(`<span><b>PV Inverter:</b> ${selected.inverterBreakdown.map(g=>`${g.qty}×${g.inv.nama||g.inv.id}`).join(' + ')}</span>`);
    if((calc.type==='Hybrid'||calc.type==='Off-Grid')&&selected.design?.battery) addLine('Battery',selected.design.battery,`${selected.design.batteryQty}× ${spFmtNum(selected.design.batteryUnitKwh,2)} kWh/unit`);
    addLine('Mounting',cc.mounting); addLine('DC Cable',cc.dc); addLine('AC Cable',cc.ac); addLine('PDI',cc.pdi); addLine('PDDC',cc.pddc); addLine('PDC',cc.pdc); addLine('Accessories',cc.acc); addLine('Installation',cc.jasa); addLine('SLO / NIDI',cc.slo);
    summary.innerHTML=`<strong>Components used</strong><span class="sp-package-active-label">${modeLabel}</span><div class="sp-package-component-preview">${lines.join('')}</div><span class="sp-package-total">${spFmtRp(selected.cost)} pre-VAT</span>`;
  }
  // Rank by badge priority first (Recommended/Best Value, then Best Quality,
  // then Best Price take the top slots regardless of raw valueScore — mirrors
  // dummy.html always showing its "Target Fit" card first), then fall back to
  // valueScore for everything else so the remaining alternatives stay sensibly
  // ordered.
  const rolePriority=x=>{
    if(x.id===bestValue.id)return 0;
    if(x.id===bestQuality.id)return 1;
    if(x.id===bestPrice.id)return 2;
    return 3;
  };
  list.innerHTML=configs.sort((a,b)=>rolePriority(a)-rolePriority(b)||b.valueScore-a.valueScore).slice(0,10).map(x=>{
    const tags=[];
    if(x.id===bestValue.id)tags.push('<span class="sp-config-tag rec">⭐ Recommended · Best Value</span>');
    if(x.id===bestPrice.id)tags.push('<span class="sp-config-tag price">💰 Best Price</span>');
    if(x.id===bestQuality.id)tags.push('<span class="sp-config-tag quality">🏆 Best Quality</span>');
    if(!tags.length)tags.push('<span class="sp-config-tag alt">Alternative</span>');
    const mix=x.inverterBreakdown.map(g=>`${g.qty}×${spFmtNum(spCapacity(g.inv),0)}kW`).join(' + ');
    const isActive=x.id===sameId;
    return `<div class="sp-option-card${isActive?' is-active':''}" data-config-id="${x.id}">
      <div class="sp-config-tags">${tags.join('')}</div>
      <h4>${mix}</h4>
      <p class="sp-option-desc">PV inverter ${mix} · DC/AC ${x.ratio.toFixed(3)}. ${x.ratio>1.2?'Potential clipping at peak production.':'DC/AC ratio is still within a practical range.'}</p>
      <div class="sp-option-stats">
        <div class="sp-option-stat"><label>Total Inverter Capacity</label><strong>${spFmtNum(x.total,0)} kW</strong><span>${x.qty} unit</span></div>
        <div class="sp-option-stat"><label>Peak AC</label><strong>${spFmtNum(x.peak,2)} kW</strong></div>
        <div class="sp-option-stat"><label>Daily Energy</label><strong>${spFmtNum(x.energy,1)} kWh/day</strong><span>${spFmtNum(x.energy*365/1000,2)} MWh/yr</span></div>
        <div class="sp-option-stat"><label>Estimated Cost</label><strong>${spFmtRp(x.cost)}</strong><span>pre-VAT</span></div>
      </div>
      ${(calc.type==='Hybrid'||calc.type==='Off-Grid')?`<div class="sp-battery-inline"><strong>Battery:</strong> ${x.batteryQty} unit · ${spFmtNum(x.batteryTotalKwh,2)} kWh nominal</div>`:''}
      <div class="sp-option-footer"><span class="sp-pill-outline">DC/AC: ${x.ratio.toFixed(3)}x</span><span class="sp-pill-outline">Technical ${spFmtNum(x.technicalScore,0)}/100</span><span class="sp-desc">${x.inverterBreakdown.map(g=>`${spNum(g.inv.mppt)||1} MPPT × ${g.qty}`).join(' · ')}</span><button type="button" class="sp-btn sp-btn-outline" data-action="view-rab" data-config-id="${x.id}">${isActive?'Active BOQ':'View BOQ'} <i class="fa-solid fa-arrow-right"></i></button></div>
    </div>`;
  }).join('');
  list.dataset.generated='true';list._configs=configs;
  return selected;
}

function spConfigForActive(calc){
  const list=document.getElementById('spConfigList'),arr=list?list._configs:null;
  const x=arr?.find(v=>v.id===spActiveConfigId)||arr?.[0];
  if(!x) return {
    inv:calc.inv,
    qty:calc.selectedInvQty||calc.invCount,
    total:calc.selectedInvTotal||calc.totalInv,
    ratio:calc.selectedInvRatio??calc.ratio,
    peak:calc.selectedInvPeak??calc.peakAC,
    inverterBreakdown:calc.inverterBreakdown||[]
  };
  return {inv:x.inv,qty:x.qty,total:x.total,ratio:x.ratio,peak:x.peak,inverterBreakdown:x.inverterBreakdown||[]};
}
function spConfLabel(conf){
  if(conf?.inverterBreakdown?.length) return conf.inverterBreakdown.map(g=>`${g.qty}×${spFmtNum(spCapacity(g.inv),0)}kW`).join(' + ');
  return `${conf?.qty||1}×${spFmtNum(spCapacity(conf?.inv),0)}kW`;
}
function spRenderRab(calc,c){
  if(calc&&(calc.type==='Hybrid'||calc.type==='Off-Grid')) spSyncBatteryPlan(calc);
  const conf=spConfigForActive(calc);const cc={...c,battery:calc?.battery||c?.battery||null,inverter:conf.inv};const rab=spBuildRAB(calc,cc);const label=document.getElementById('spRabActiveLabel');if(label)label.innerHTML=`${spT('boqFor')} <b>${spConfLabel(conf)}</b> · ${spT('priceColon')} <b>${spT('activeCatalogPrice')}</b>`;
  const body=document.getElementById('spRabTableBody');if(body)body.innerHTML=rab.items.map(it=>`${it.section?`<tr class="sp-table-section"><td colspan="6">${spSectionLabel(it.section)}</td></tr>`:''}<tr><td>${it.no}</td><td>${it.name}</td><td>${it.unit}</td><td>${spFmtNum(it.qty)}</td><td>${spFmtRp(it.price)}</td><td>${spFmtRp(it.total)}</td></tr>`).join('')+`<tr class="sp-rab-summary-row"><td colspan="5">${spT('subtotalPreVat')}</td><td>${spFmtRp(rab.subtotal)}</td></tr><tr class="sp-rab-summary-row"><td colspan="5">${spT('vat11')}</td><td>${spFmtRp(rab.ppn)}</td></tr><tr class="sp-rab-summary-row sp-rab-total-row"><td colspan="5">${spT('totalIncludingVat')}</td><td>${spFmtRp(rab.total)}</td></tr>`;
  const a=document.getElementById('spRabCostPerKwp');if(a)a.textContent=spFmtRp(rab.costPerKwp);const b=document.getElementById('spRabSubtotalMini');if(b)b.textContent=spFmtRpMillion(rab.subtotal);const d=document.getElementById('spRabTotalMini');if(d)d.textContent=spFmtRpMillion(rab.total);
  return rab;
}
function spRenderCustomer(rab){
  const slider=document.getElementById('spMarginSlider');if(!slider||!rab)return;
  const pct=spNum(slider.value||21);
  const margin=rab.subtotal*pct/100;
  // Selling Price (DPP) = Subtotal + Margin. VAT is applied here, on the selling price to
  // the customer — not on the base/BOQ cost. This is intentionally different from the BOQ tab,
  // whose VAT is calculated from the base subtotal for internal procurement cost estimation purposes.
  const dpp=rab.subtotal+margin;
  const ppnJual=dpp*VAT_RATE;
  const sell=dpp+ppnJual;
  const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};
  set('spBaseCost',spFmtRp(rab.subtotal));
  set('spMarginValue',pct);
  set('spMarginAmount',`${spFmtRp(margin)} (${pct}%)`);
  set('spCustomerDpp',spFmtRp(dpp));
  set('spCustomerPpn',spFmtRp(ppnJual));
  set('spSellingPrice',spFmtRp(sell));
  const table=document.querySelector('.sp-tab-pane[data-pane="customer"] .sp-table-mini tbody');
  if(table){table.innerHTML=rab.items.map(it=>`${it.section?`<tr class="sp-table-section"><td colspan="6">${spSectionLabel(it.section)}</td></tr>`:''}<tr><td>${it.no}</td><td>${it.name}</td><td>${it.unit}</td><td>${spFmtNum(it.qty)}</td><td>${spFmtRp(it.price)}</td><td>${spFmtRp(it.total)}</td></tr>`).join('')+`<tr class="sp-rab-summary-row"><td colspan="5">${spT('subtotalPreVat')}</td><td>${spFmtRp(rab.subtotal)}</td></tr><tr class="sp-rab-summary-row"><td colspan="5">${spT('profitMargin')} (${pct}%)</td><td>${spFmtRp(margin)}</td></tr><tr class="sp-rab-summary-row"><td colspan="5">${spT('sellingPricePreVat')}</td><td>${spFmtRp(dpp)}</td></tr><tr class="sp-rab-summary-row"><td colspan="5">${spT('vat11')}</td><td>${spFmtRp(ppnJual)}</td></tr><tr class="sp-rab-summary-row sp-rab-total-row"><td colspan="5">${spT('totalCustomerInvoice')}</td><td>${spFmtRp(sell)}</td></tr>`;}
}
function spRenderSummary(calc,rab,c){
  const type=spSystemType();const conf=spConfigForActive(calc);const set=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};
  const dateLocale=spCurrentLang()==='id'?'id-ID':'en-US';
  set('spSummarySub',`${spT('createdOn')}: ${new Date().toLocaleDateString(dateLocale,{day:'2-digit',month:'short',year:'numeric'})} · ${spT('activeCatalogPrice')}`);
  const typeNote=type==='Hybrid'?spT('summaryHybridNote'):type==='Off-Grid'?spT('summaryOffgridNote'):spT('summaryOngridNote');
  const text=document.getElementById('spSummaryText');
  if(text)text.innerHTML=SP_I18N.summaryIntro[spCurrentLang()==='id'?'id':'en'](spFmtNum(calc.actual,2),calc.panelCount,spFmtNum(calc.panelW,0),spConfLabel(conf),conf.ratio.toFixed(3))
    +`<ul><li>${SP_I18N.summaryProduction[spCurrentLang()==='id'?'id':'en'](spFmtNum(calc.annualMwh,2),spFmtNum(calc.daily,1))}</li>`
    +`<li>${SP_I18N.summaryCost[spCurrentLang()==='id'?'id':'en'](spFmtRp(rab.subtotal),spFmtRp(rab.costPerKwp))}</li>`
    +`<li>${typeNote}</li></ul>`;
  const grid=document.getElementById('spSummaryGrid');if(!grid)return;const rows=[[spT('cardProjectOverview'),[[spT('rowTargetCapacity'),`${spFmtNum(spNum(document.getElementById('spTargetKwp')?.value||0),0)} kWp`],[spT('rowActualArrayCapacity'),`${spFmtNum(calc.actual,2)} kWp`],[spT('rowSystemType'),type],[spT('rowPsh'),`${calc.psh.toFixed(3)} h/day`]]],[spT('cardPvArray'),[[spT('rowPanelModel'),c.panel?.nama||'-'],[spT('rowTotalPanels'),`${calc.panelCount} pcs`],[spT('rowStringConfig'),`${calc.strings} string × ${calc.panelsPerString} panel/string`],[spT('rowVmppString'),`${spFmtNum(calc.vString,1)} V`],[spT('rowVocString'),`${spFmtNum(calc.vocCold,1)} V — ${calc.vocCold<=1000?spT('valSafe'):spT('valExceedsLimit')}`],[spT('rowArrayArea'),`${spFmtNum(calc.footprint,1)} m²`]]],[spT('cardSelectedConfig'),[[spT('rowTotalInvRating'),`${spFmtNum(conf.total,0)} kW`],[spT('rowDcAcRatio'),`${conf.ratio.toFixed(3)}×`],[spT('rowQuantity'),`${conf.qty} unit`],[spT('rowTotalMppt'),`${spNum(calc.mppt)||1}`],[spT('rowPeakAcOutput'),`${spFmtNum(conf.peak,2)} kW`],[spT('rowClippingStc'),conf.ratio>1.15?spT('valPotentialClipping'):spT('valMinorMinimal')],[spT('rowInvEfficiency'),`${spFmtNum(calc.eff*100,1)}%`]]],[spT('cardCabling'),[[spT('rowDcCableType'),c.dc?.nama||'-'],[spT('rowTotalDcCable'),`${spFmtNum(calc.dcLen,0)} m`],[spT('rowAcCableType'),c.ac?.nama||'-'],[spT('rowTotalAcCable'),`${spFmtNum(calc.acLen,0)} m`]]],[spT('cardEnergyProduction'),[[spT('rowPeakDcPower'),`${spFmtNum(calc.actual,2)} kW`],[spT('rowPeakAcOutput'),`${spFmtNum(conf.peak,2)} kW`],[spT('rowEstDaily'),`${spFmtNum(calc.daily,1)} kWh/day`],[spT('rowEstMonthly'),`${spFmtNum(calc.annualMwh*1000/12,0)} kWh/month`],[spT('rowEstAnnual'),`${spFmtNum(calc.annualMwh,2)} MWh/yr`],[spT('row20yEstimate'),`${spFmtNum(calc.energy20,1)} MWh`]]],[spT('cardCostBudget'),[[spT('rowPriceBasis'),spT('activeCatalogPrice')],[spT('rowActiveConfig'),spConfLabel(conf)],[spT('subtotalPreVat'),spFmtRp(rab.subtotal)],[spT('vat11'),spFmtRp(rab.ppn)],[spT('totalIncludingVat'),spFmtRp(rab.total)],[spT('rowCostPerKwp'),`${spFmtRp(rab.costPerKwp)}/kWp`],[spT('row20yEnergyCost'),`${spFmtRp(rab.total/(calc.energy20*1000))}/kWh`]]]];
  if((type==='Hybrid'||type==='Off-Grid')&&calc.battery){ rows.splice(4,0,[spT('cardBattery'),[[spT('rowTargetStorage'),`${spFmtNum(calc.batteryTargetKwh,2)} kWh`],[spT('rowBatteryModel'),calc.battery.nama||'-'],[spT('rowQuantity'),`${calc.batteryQty} unit`],[spT('rowTotalNominalCapacity'),`${spFmtNum(calc.batteryTotalKwh,2)} kWh`],[spT('rowUsableCapacity'),calc.batteryUsableKwh>0?`${spFmtNum(calc.batteryUsableKwh,2)} kWh`:spT('valNotSpecified')],[spT('rowSizingReference'),`${spFmtNum(calc.batteryCoverageHours,2)} h @ inverter rated output`]]]); }
  grid.innerHTML=rows.map(([title,rr])=>`<div class="sp-summary-card"><p class="sp-summary-card-title">${title}</p>${rr.map(([a,b])=>`<div class="sp-summary-card-row"><span>${a}</span><span>${b}</span></div>`).join('')}</div>`).join('');
}
function spSetCalcWarning(messages=[]){
  const box=document.getElementById('spCalcWarning');
  if(!box)return !messages.length;
  const msgs=Array.isArray(messages)?messages.filter(Boolean):[String(messages||'')].filter(Boolean);
  box.innerHTML=msgs.length?`<strong>⚠ Configuration needs review</strong><ul>${msgs.map(x=>`<li>${x}</li>`).join('')}</ul>`:'<strong>✓ Initial configuration is valid.</strong>';
  box.classList.toggle('is-error',msgs.length>0);
  return !msgs.length;
}
function spWarn(calc, extraMessages=[]){
  calc.vocOK = calc.vocCold <= 1000;
  calc.roofOK = calc.roofOK;
  const msgs=[...extraMessages];
  if(!calc.vocOK)msgs.push('Voc string exceeds the 1000 V limit; reduce the panels per string or choose different components/inverter.');
  if(!calc.roofOK)msgs.push('Array area exceeds the usable roof area. Reduce the target kWp or increase the usable roof area.');
  return spSetCalcWarning(msgs);
}

function spClearCalculationState(message){
  spCalculation=null;
  spLastCalc=null;
  spLastRab=null;
  spLastComponents=null;
  spActiveConfigId='';
  const list=document.getElementById('spConfigList');
  if(list){list._configs=[];list.innerHTML=message?`<div class="sp-empty"><p>${message}</p></div>`:'';}
  const summary=document.getElementById('spPackageSummary');
  if(summary)summary.innerHTML='<strong>Automatic optimization</strong><span>Waiting for a valid catalog configuration.</span>';
  document.getElementById('spEmptyState')?.classList.remove('hidden');
  document.getElementById('spResultContent')?.classList.add('hidden');
}

function spCalculate(){
  const target=spNum(document.getElementById('spTargetKwp')?.value||0);
  if(!target || target<=0){ spNotify('Enter a valid Target kWp.'); return null; }
  spDefaultCatalogComponents();
  let c=spSelectedComponents();
  const type=spSystemType();
  if(!c.panel){ spNotify('Select a panel from the active catalog first.'); return null; }

  // Inverter selection is now automatic. The engine evaluates catalog combinations
  // (including mixed sizes such as 80 + 40 kW) and then applies the selected
  // recommendation preference: Best Value, Best Price, or Best Quality.
  const configs=spBuildAutoConfigurations(target,c,type);
  if(!configs.length){
    spClearCalculationState();
    spWarn({vocCold:0,roofOK:true},[
      `No catalog inverter combination meets target ${spFmtNum(target,2)} kWp. For ${type}, check that the active catalog contains sufficient inverter capacity and active pricing.`
    ]);
    return null;
  }
  const list=document.getElementById('spConfigList');if(list)list._configs=configs;
  const prefSelect=document.getElementById('spPackageSelect');
  const selectedId=prefSelect?.value && configs.some(x=>x.id===prefSelect.value) ? prefSelect.value : '';
  const chosen=configs.find(x=>x.id===selectedId)
    ||spRecommendationForValue(configs,'recommended')
    ||spRecommendationForValue(configs,'price')
    ||spRecommendationForValue(configs,'quality');
  if(!chosen){ spNotify('The automatic configuration could not be determined.'); return null; }
  spActiveConfigId=chosen.id;

  // Push the automatically chosen support components into the customize panel,
  // but mark them as auto so they do not become a hidden manual constraint later.
  const autoComponents={...(chosen.components||spApplyAutoSupport(chosen.inv,c)),battery:chosen.design?.battery||null};
  ['ac','pdi','pddc','acc','jasa','slo'].forEach(k=>{
    const map={ac:'spAcCableCatalogSelect',pdi:'spPdiCatalogSelect',pddc:'spPddcCatalogSelect',acc:'spAccCatalogSelect',jasa:'spJasaCatalogSelect',slo:'spSloCatalogSelect'};
    if(autoComponents[k])spSetAutoSelect(map[k],autoComponents[k]);
  });
  spSetAutoSelect('spInverterCatalogSelect',chosen.inv);

  const calc=chosen.design;
  calc.type=type;
  // Re-sync the exact user-selected battery model before the calculation snapshot
  // becomes the source for Design, Configuration, Visual and RAB.
  if(type==='Hybrid'||type==='Off-Grid') spSyncBatteryPlan(calc);
  calc.selectedInvQty=chosen.qty;
  calc.selectedInvTotal=chosen.total;
  calc.selectedInvRatio=chosen.ratio;
  calc.selectedInvPeak=chosen.peak;
  calc.selectedConfigId=chosen.id;
  calc.components=autoComponents;
  if(!spWarn(calc)) return null;
  spCalculation=calc;
  const bfs=document.getElementById('spBatteryFormSummaryText');if(bfs&&(type==='Hybrid'||type==='Off-Grid')) bfs.textContent=(type==='Hybrid'||type==='Off-Grid')?(calc.battery?`Target storage ${spFmtNum(calc.batteryTargetKwh,2)} kWh · ${calc.battery.nama} · ${calc.batteryQty} unit · ${spFmtNum(calc.batteryTotalKwh,2)} kWh nominal`:`Target storage ${spFmtNum(calc.batteryTargetKwh,2)} kWh · No battery required at the current storage target.`):'';

  spRenderConfigCards(calc,type);
  // spRenderConfigCards can re-sort/rebuild the recommendation list; restore the exact
  // active choice from the preference selector and use its design object for all tabs.
  const rebuilt=document.getElementById('spConfigList')?._configs||[];
  const active=rebuilt.find(x=>x.id===chosen.id)||spRecommendationForValue(rebuilt,'recommended')||chosen;
  spActiveConfigId=active.id;
  spCalculation=active.design||calc;
  spCalculation.type=type;
  spCalculation.selectedInvQty=active.qty;
  spCalculation.selectedInvTotal=active.total;
  spCalculation.selectedInvRatio=active.ratio;
  spCalculation.selectedInvPeak=active.peak;
  if(spCalculation.type==='Hybrid'||spCalculation.type==='Off-Grid') spSyncBatteryPlan(spCalculation);
  const activeComponents={...(active.components||autoComponents),battery:spCalculation.battery||null};
  spLastComponents=activeComponents;

  spRenderDesign(spCalculation);
  spRenderVisual(spCalculation);
  const rab=spRenderRab(spCalculation,activeComponents);
  spRenderCustomer(rab);
  spRenderSummary(spCalculation,rab,activeComponents);
  spLastCalc=spCalculation;
  spLastRab=rab;
  // If Battery Model is on "Auto — Cheapest Battery", refresh its meta line
  // now that spCalculation.battery reflects the model actually resolved.
  const batModelSelectNow=document.getElementById('spBatteryModelSelect'),batModelMetaNow=document.getElementById('spBatteryModelMeta');
  if(batModelSelectNow?.value==='auto'&&batModelMetaNow) batModelMetaNow.textContent=spBatteryModelMetaText('auto');

  if(typeof logActivity==='function'){
    logActivity({
      eventType:'admin_calculator',
      user:sessionStorage.getItem('edash-user')||'Anonymous',
      userRole:sessionStorage.getItem('edash-role')||null,
      status:'success',
      detail:`Calculated PLTS design: ${spFmtNum(spCalculation.actual,2)} kWp (${spCalculation.panelCount} panels), ${type} system`,
      data:{calculatorInput:{targetKwp:target,systemType:type,preference:chosen.id},calculatorResult:spCalculation}
    });
  }
  return spCalculation;
}

// =====================================================================
// Export: RAB (PDF/Excel), Customer Offer (PDF), Summary (Save PDF /
// Print PDF). All four read from the spLastCalc/spLastRab/spLastComponents
// snapshot taken above at the end of spCalculate(), so they always export
// exactly what's currently on screen instead of recomputing anything.
// =====================================================================
function spFileStamp(){
  const d=new Date();
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function spExportGuard(){
  if(!spLastCalc||!spLastRab){ spNotify('Click "Calculate" first before exporting.'); return false; }
  return true;
}
function spEnsureJsPDF(){
  const ok=window.jspdf&&window.jspdf.jsPDF;
  if(!ok) spNotify('The PDF export module has not loaded yet. Reload the page and try again.');
  return ok;
}
function spEnsureXLSX(){
  const ok=!!window.XLSX;
  if(!ok) spNotify('The Excel export module has not loaded yet. Reload the page and try again.');
  return ok;
}
// Shared PDF header used by both the RAB export and the Customer Offer export.
function spPdfHeader(doc,title,marginX){
  doc.setFontSize(16); doc.setFont(undefined,'bold'); doc.setTextColor(11,79,84);
  doc.text(title,marginX,50);
  doc.setFontSize(9.5); doc.setFont(undefined,'normal'); doc.setTextColor(90,100,102);
  doc.text('360Energy (PT. Pionir Energi Hijau) — Solar Planning Tool',marginX,66);
  doc.text(`Date: ${new Date().toLocaleDateString('en-US',{day:'2-digit',month:'long',year:'numeric'})}`,marginX,80);
  doc.setTextColor(0,0,0);
}
// Shared item-table body builder (RAB rows -> jsPDF-AutoTable body array).
function spPdfRabBody(rab){
  const body=[];
  rab.items.forEach(it=>{
    if(it.section) body.push([{content:spPdfSafe(it.section),colSpan:6,styles:{fillColor:[15,106,113],textColor:255,fontStyle:'bold'}}]);
    body.push([it.no,spPdfSafe(it.name),spPdfSafe(it.unit),spFmtNum(it.qty),spFmtRp(it.price),spFmtRp(it.total)]);
  });
  return body;
}

function spExportRabPdf(){
  if(!spExportGuard()||!spEnsureJsPDF())return;
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'pt',format:'a4'});
  const marginX=40,pageW=doc.internal.pageSize.getWidth();
  const conf=spConfigForActive(spLastCalc);
  spPdfHeader(doc,'Bill of Quantities (BOQ)',marginX);
  doc.setFontSize(9.5); doc.setTextColor(0,0,0);
  doc.text(`Configuration: ${spConfLabel(conf)}  ·  Price Basis: Active Catalog Price`,marginX,96);
  doc.autoTable({
    startY:110,
    head:[['No','Item','Unit','Qty','Unit Price','Total']],
    body:spPdfRabBody(spLastRab),
    styles:{fontSize:8.5,cellPadding:5,overflow:'linebreak'},
    headStyles:{fillColor:[228,241,241],textColor:[11,79,84],fontStyle:'bold'},
    columnStyles:{0:{cellWidth:24},1:{cellWidth:'auto'},4:{halign:'right'},5:{halign:'right'}},
    margin:{left:marginX,right:marginX},
  });
  let y=doc.lastAutoTable.finalY+18;
  const rows=[['Subtotal (pre-VAT)',spFmtRp(spLastRab.subtotal),false],['VAT 11%',spFmtRp(spLastRab.ppn),false],['TOTAL (including VAT)',spFmtRp(spLastRab.total),true]];
  rows.forEach(([label,val,bold])=>{
    doc.setFont(undefined,bold?'bold':'normal'); doc.setFontSize(bold?11:9.5);
    doc.text(label,marginX,y); doc.text(val,pageW-marginX,y,{align:'right'});
    y+=bold?20:16;
  });
  doc.save(`BOQ-${spFileStamp()}.pdf`);

  if(typeof logActivity==='function'){
    logActivity({
      eventType:'admin_calculator_export',
      user: sessionStorage.getItem('edash-user') || 'Anonymous',
      userRole: sessionStorage.getItem('edash-role') || null,
      status:'success',
      detail:'Exported BOQ (Bill of Quantities) report to PDF',
      data:{
        calculatorInput:{ systemType: spLastCalc?.type || null, components: spLastComponents },
        calculatorResult: spLastCalc,
        export:{ type:'PDF', report:'BOQ', status:'success' },
      },
    });
  }
}

function spExportRabExcel(){
  if(!spExportGuard()||!spEnsureXLSX())return;
  const conf=spConfigForActive(spLastCalc);
  const aoa=[
    ['Bill of Quantities (BOQ)'],
    [`Configuration: ${spConfLabel(conf)}`],
    ['Price Basis: Active Catalog Price'],
    [`Date: ${new Date().toLocaleDateString('en-US',{day:'2-digit',month:'long',year:'numeric'})}`],
    [],
    ['No','Item','Unit','Qty','Unit Price','Total'],
  ];
  spLastRab.items.forEach(it=>{
    if(it.section) aoa.push([it.section]);
    aoa.push([it.no,it.name,it.unit,it.qty,it.price,it.total]);
  });
  aoa.push([]);
  aoa.push(['','','','','Subtotal (pre-VAT)',spLastRab.subtotal]);
  aoa.push(['','','','','VAT 11%',spLastRab.ppn]);
  aoa.push(['','','','','TOTAL (including VAT)',spLastRab.total]);
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=[{wch:5},{wch:44},{wch:8},{wch:8},{wch:16},{wch:16}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'BOQ');
  XLSX.writeFile(wb,`BOQ-${spFileStamp()}.xlsx`);

  if(typeof logActivity==='function'){
    logActivity({
      eventType:'admin_calculator_export',
      user: sessionStorage.getItem('edash-user') || 'Anonymous',
      userRole: sessionStorage.getItem('edash-role') || null,
      status:'success',
      detail:'Exported BOQ (Bill of Quantities) report to Excel',
      data:{
        calculatorInput:{ systemType: spLastCalc?.type || null, components: spLastComponents },
        calculatorResult: spLastCalc,
        export:{ type:'Excel', report:'BOQ', status:'success' },
      },
    });
  }
}

function spExportCustomerOffer(){
  if(!spExportGuard()||!spEnsureJsPDF())return;
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'pt',format:'a4'});
  const marginX=40,pageW=doc.internal.pageSize.getWidth();
  const pct=spNum(document.getElementById('spMarginSlider')?.value||21);
  const margin=spLastRab.subtotal*pct/100;
  // Selling Price (DPP) = Subtotal + Margin, then VAT 11% is calculated from that —
  // same as spRenderCustomer(). The VAT here is NOT the VAT in the
  // rab object (that's VAT on the base cost, used in the BOQ tab for internal
  // procurement cost estimation, not for the selling price to the customer).
  const dpp=spLastRab.subtotal+margin;
  const ppnJual=dpp*VAT_RATE;
  const sell=dpp+ppnJual;
  spPdfHeader(doc,'Price Quotation — Solar PV System',marginX);
  doc.autoTable({
    startY:96,
    head:[['No','Item','Unit','Qty','Unit Price','Total']],
    body:spPdfRabBody(spLastRab),
    styles:{fontSize:8.5,cellPadding:5,overflow:'linebreak'},
    headStyles:{fillColor:[228,241,241],textColor:[11,79,84],fontStyle:'bold'},
    columnStyles:{0:{cellWidth:24},1:{cellWidth:'auto'},4:{halign:'right'},5:{halign:'right'}},
    margin:{left:marginX,right:marginX},
  });
  let y=doc.lastAutoTable.finalY+18;
  const rows=[['Subtotal (pre-VAT)',spFmtRp(spLastRab.subtotal)],[`Profit Margin (${pct}%)`,spFmtRp(margin)],['Selling Price (pre-VAT)',spFmtRp(dpp)],['VAT 11%',spFmtRp(ppnJual)]];
  doc.setFontSize(9.5);
  rows.forEach(([label,val])=>{
    doc.setFont(undefined,'normal'); doc.text(label,marginX,y); doc.text(val,pageW-marginX,y,{align:'right'}); y+=16;
  });
  y+=4; doc.setDrawColor(15,106,113); doc.setLineWidth(1); doc.line(marginX,y,pageW-marginX,y); y+=22;
  doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(11,79,84);
  doc.text('Total Customer Invoice (Including VAT)',marginX,y);
  doc.text(spFmtRp(sell),pageW-marginX,y,{align:'right'});
  doc.setTextColor(0,0,0);
  doc.save(`Customer-Offer-${spFileStamp()}.pdf`);

  if(typeof logActivity==='function'){
    logActivity({
      eventType:'admin_calculator_export',
      user: sessionStorage.getItem('edash-user') || 'Anonymous',
      userRole: sessionStorage.getItem('edash-role') || null,
      status:'success',
      detail:'Exported Customer Offer report to PDF',
      data:{
        calculatorInput:{ systemType: spLastCalc?.type || null, components: spLastComponents, marginPercent: pct },
        calculatorResult: spLastCalc,
        export:{ type:'PDF', report:'Customer Offer', status:'success', sellingPrice: sell },
      },
    });
  }
}

// jsPDF's built-in core fonts (Helvetica) only cover WinAnsi/Latin-1 glyphs —
// symbols like ✓ ✕ ⚠ ≤ or the superscript ² silently render as garbage
// (usually a stray apostrophe) or vanish. Swap them for ASCII-safe
// equivalents before any text hits doc.text()/splitTextToSize().
function spPdfSafe(str){
  return String(str)
    .replace(/✓/g,'OK')
    .replace(/✕/g,'X')
    .replace(/⚠/g,'!')
    .replace(/≤/g,'<=')
    .replace(/≥/g,'>=')
    .replace(/m²/g,'m2');
}

// Render a DOM node's text as wrapped lines in the PDF, preserving <b>/<strong>
// runs as bold segments inline (word-by-word layout with simple line wrap).
// Returns the y position after the last line drawn.
function spRichText(doc,node,x,y,maxWidth,fontSize,color){
  const lineHeight=fontSize*1.45;
  doc.setFontSize(fontSize);
  doc.setTextColor(color[0],color[1],color[2]);
  let cx=x,cy=y;
  const walk=n=>{
    n.childNodes.forEach(cn=>{
      if(cn.nodeType===3){ // text node
        pushText(cn.textContent,false);
      }else if(cn.nodeType===1){
        const bold=/^(B|STRONG)$/i.test(cn.tagName);
        if(bold) pushText(cn.textContent,true);
        else walk(cn);
      }
    });
  };
  const pushText=(text,bold)=>{
    const tokens=spPdfSafe(text).split(/(\s+)/).filter(t=>t!=='');
    tokens.forEach(tok=>{
      doc.setFont(undefined,bold?'bold':'normal');
      if(/^\s+$/.test(tok)){
        if(cx===x) return; // don't let a leading space indent a wrapped line
        cx+=doc.getTextWidth(tok);
        return;
      }
      const w=doc.getTextWidth(tok);
      if(cx+w>x+maxWidth){ cy+=lineHeight; cx=x; }
      doc.text(tok,cx,cy);
      cx+=w;
    });
  };
  walk(node);
  return cy+lineHeight;
}

// Measure a summary card's total box height (without drawing), so pairs of
// cards placed side-by-side in a 2-column row can share the same height.
function spMeasureSummaryCard(doc,width,rows){
  const padding=14,titleH=26;
  const innerW=width-padding*2,labelW=innerW*0.56,valueW=innerW*0.44;
  doc.setFontSize(8.8);
  const rowMeta=rows.map(([label,val])=>{
    const labelLines=doc.splitTextToSize(spPdfSafe(label),labelW);
    const valLines=doc.splitTextToSize(spPdfSafe(val),valueW);
    const lines=Math.max(labelLines.length,valLines.length,1);
    const h=lines*11+9;
    return {labelLines,valLines,h};
  });
  const bodyH=rowMeta.reduce((a,r)=>a+r.h,0);
  return {totalH:padding+titleH+bodyH+padding*0.7,rowMeta,padding,titleH,labelW,valueW};
}

// Draw one bordered, rounded-corner summary card (title + label/value rows
// with hairline separators) — mirrors the on-screen .sp-summary-card look.
function spDrawSummaryCard(doc,x,y,width,title,rows){
  const {totalH,rowMeta,padding,titleH,labelW,valueW}=spMeasureSummaryCard(doc,width,rows);
  doc.setDrawColor(224,232,232);
  doc.setLineWidth(1);
  doc.roundedRect(x,y,width,totalH,6,6,'S');

  doc.setFontSize(9.3); doc.setFont(undefined,'bold'); doc.setTextColor(11,79,84);
  doc.text(String(title).toUpperCase(),x+padding,y+padding+2);

  let cy=y+titleH+padding*0.3;
  const lineStep=11; // fixed line-height step shared by BOTH columns so wrapped
                      // labels and wrapped values always stay on the same baselines.
  rowMeta.forEach((r,idx)=>{
    const rowTop=cy;
    doc.setFontSize(8.8); doc.setFont(undefined,'normal'); doc.setTextColor(120,130,132);
    r.labelLines.forEach((ln,i)=>doc.text(ln,x+padding,rowTop+9+i*lineStep));
    doc.setFont(undefined,'bold'); doc.setTextColor(30,42,44);
    r.valLines.forEach((ln,i)=>doc.text(ln,x+width-padding,rowTop+9+i*lineStep,{align:'right'}));
    cy+=r.h;
    if(idx<rowMeta.length-1){
      doc.setDrawColor(240,244,244); doc.setLineWidth(0.6);
      doc.line(x+padding,cy-1,x+width-padding,cy-1);
    }
  });
  return totalH;
}

function spExportSummaryPdf(){
  if(!spExportGuard()||!spEnsureJsPDF())return;
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:'pt',format:'a4'});
  const marginX=40,pageW=doc.internal.pageSize.getWidth(),pageH=doc.internal.pageSize.getHeight();
  let y=50;
  doc.setFontSize(16); doc.setFont(undefined,'bold'); doc.setTextColor(11,79,84);
  doc.text('Executive Summary — Solar PV System Design',marginX,y); y+=18;
  doc.setFontSize(9.5); doc.setFont(undefined,'normal'); doc.setTextColor(90,100,102);
  doc.text(document.getElementById('spSummarySub')?.textContent||'',marginX,y); y+=26;

  // Intro paragraph + bullet list, rendered from the live DOM so bold spans
  // (kWp, panel count, etc.) carry over into the PDF instead of flattening
  // everything to plain text.
  const textEl=document.getElementById('spSummaryText');
  if(textEl){
    const p=textEl.querySelector('p');
    if(p){ y=spRichText(doc,p,marginX,y,pageW-marginX*2,10,[30,42,44])+2; }
    const items=Array.from(textEl.querySelectorAll('ul > li'));
    items.forEach(li=>{
      doc.setFontSize(9.5); doc.setFont(undefined,'normal'); doc.setTextColor(30,42,44);
      doc.text('•',marginX+2,y);
      y=spRichText(doc,li,marginX+14,y,pageW-marginX*2-14,9.5,[30,42,44]);
    });
    y+=14;
  }

  // Card grid — two columns, laid out in reading-order pairs (1&2, 3&4, ...)
  // to match the on-screen grid, with each pair sharing one row height.
  const cards=Array.from(document.querySelectorAll('#spSummaryGrid .sp-summary-card')).map(card=>({
    title:card.querySelector('.sp-summary-card-title')?.textContent||'',
    rows:Array.from(card.querySelectorAll('.sp-summary-card-row')).map(r=>{
      const spans=r.querySelectorAll('span');
      return [spans[0]?.textContent||'',spans[1]?.textContent||''];
    }),
  }));
  const gap=16,colW=(pageW-marginX*2-gap)/2;
  for(let i=0;i<cards.length;i+=2){
    const left=cards[i],right=cards[i+1];
    const leftH=left?spMeasureSummaryCard(doc,colW,left.rows).totalH:0;
    const rightH=right?spMeasureSummaryCard(doc,colW,right.rows).totalH:0;
    const rowH=Math.max(leftH,rightH);
    if(y+rowH>pageH-40){ doc.addPage(); y=50; }
    if(left) spDrawSummaryCard(doc,marginX,y,colW,left.title,left.rows);
    if(right) spDrawSummaryCard(doc,marginX+colW+gap,y,colW,right.title,right.rows);
    y+=rowH+gap;
  }

  doc.setTextColor(0,0,0);
  doc.save(`Summary-PLTS-${spFileStamp()}.pdf`);

  if(typeof logActivity==='function'){
    logActivity({
      eventType:'admin_calculator_export',
      user: sessionStorage.getItem('edash-user') || 'Anonymous',
      userRole: sessionStorage.getItem('edash-role') || null,
      status:'success',
      detail:'Exported Executive Summary report to PDF',
      data:{
        calculatorInput:{ systemType: spLastCalc?.type || null, components: spLastComponents },
        calculatorResult: spLastCalc,
        export:{ type:'PDF', report:'Executive Summary', status:'success' },
      },
    });
  }
}

function spPrintSummary(){
  if(!spExportGuard())return;
  const w=window.open('','_blank');
  if(!w){ spNotify('Popup blocked by the browser. Allow popups for this page in order to print.'); return; }
  const title='Executive Summary — Solar PV System Design';
  const cardsHtml=Array.from(document.querySelectorAll('#spSummaryGrid .sp-summary-card')).map(card=>{
    const t=card.querySelector('.sp-summary-card-title')?.textContent||'';
    const rows=Array.from(card.querySelectorAll('.sp-summary-card-row')).map(r=>{
      const spans=r.querySelectorAll('span');
      return `<div class="row"><span>${spans[0]?.textContent||''}</span><strong>${spans[1]?.textContent||''}</strong></div>`;
    }).join('');
    return `<div class="card"><div class="card-title">${t}</div>${rows}</div>`;
  }).join('');
  w.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title>
<style>
  *{box-sizing:border-box;}
  body{font-family:Arial,Helvetica,sans-serif;color:#25343F;padding:36px;}
  h1{font-size:20px;margin:0 0 4px;}
  .sub{color:#7c8b8d;font-size:12px;margin-bottom:20px;}
  .summary-text{margin-bottom:24px;line-height:1.6;font-size:13px;}
  .summary-text ul{margin:8px 0 0 18px;padding:0;}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  .card{border:1px solid #e7edee;border-radius:8px;padding:14px;break-inside:avoid;}
  .card-title{font-weight:700;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:#0b4f54;margin-bottom:8px;}
  .row{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:4px 0;border-bottom:1px solid #f0f3f3;}
  .row span{color:#7c8b8d;}
  @media print{ .grid{grid-template-columns:1fr 1fr;} }
</style></head><body>
<h1>${title}</h1>
<div class="sub">${document.getElementById('spSummarySub')?.textContent||''}</div>
<div class="summary-text">${document.getElementById('spSummaryText')?.innerHTML||''}</div>
<div class="grid">${cardsHtml}</div>
</body></html>`);
  w.document.close();
  const doPrint=()=>{ try{ w.focus(); w.print(); }catch(e){} };
  w.onload=doPrint;
  setTimeout(doPrint,300);
}

function spInitExportButtons(){
  document.getElementById('spRabExportPdfBtn')?.addEventListener('click',spExportRabPdf);
  document.getElementById('spRabExportExcelBtn')?.addEventListener('click',spExportRabExcel);
  document.getElementById('spCustomerExportBtn')?.addEventListener('click',spExportCustomerOffer);
  document.getElementById('spSummarySavePdfBtn')?.addEventListener('click',spExportSummaryPdf);
  document.getElementById('spSummaryPrintPdfBtn')?.addEventListener('click',spPrintSummary);
}

function spActivateTab(tabName){
  const b=document.querySelector(`.sp-tab-btn[data-tab="${tabName}"]`);
  if(!b)return false;
  b.disabled=false;
  document.querySelectorAll('.sp-tab-btn').forEach(x=>x.classList.toggle('active',x===b));
  document.querySelectorAll('.sp-tab-pane').forEach(x=>x.classList.toggle('active',x.dataset.pane===tabName));
  return true;
}
function spInitTabs(){const nav=document.getElementById('spTabs');nav?.addEventListener('click',e=>{const b=e.target.closest('.sp-tab-btn');if(!b||b.disabled)return;spActivateTab(b.dataset.tab);});}
// BOQ/Customer/Summary are built with hardcoded-language innerHTML (see spT() above),
// so switching the header language toggle needs to explicitly re-render them —
// the generic main.js DOM-walker translator doesn't cover this markup.
if(!window._spLanguageChangeBound){
  window._spLanguageChangeBound=true;
  document.addEventListener('edash:languagechange',()=>{
    if(!spCalculation)return;
    const c=spLastComponents||(typeof spSelectedComponents==='function'?spSelectedComponents():null);
    if(!c)return;
    const rab=spRenderRab(spCalculation,c);
    spRenderCustomer(rab);
    spRenderSummary(spCalculation,rab,c);
  });
}
function spEnsureBatterySizingOptions(){
  const select=document.getElementById('spBatterySizingMode');
  if(!select) return;
  // Latest design has only the two agreed sizing modes. Remove any stale
  // Remove stale coverage mode from older cached fragments.
  select.querySelectorAll('option[value="manual"]').forEach(o=>o.remove());
  if(!select.querySelector('option[value="auto"]')){
    const opt=document.createElement('option');opt.value='auto';opt.textContent='Auto — Recommended';select.insertBefore(opt,select.firstChild);
  }
  if(!select.querySelector('option[value="capacity"]')){
    const opt=document.createElement('option');opt.value='capacity';opt.textContent='Manual — Target Capacity';select.appendChild(opt);
  }
  select.dataset.batterySizingModes='auto,capacity';

  // Cached fragments from older versions may omit the capacity field. Inject it
  // only when missing; never recreate or restore the removed coverage field.
  if(!document.getElementById('spBatteryManualCapacityRow')){
    const field=document.createElement('div');
    field.className='sp-field';
    field.id='spBatteryManualCapacityRow';
    field.style.display='none';
    field.innerHTML=`<div class="sp-label-row"><label for="spBatteryTargetCapacityKwh">Target Battery Capacity (kWh)</label><button type="button" class="sp-info-btn" aria-expanded="false" data-info="Set the target storage capacity directly. The selected catalog battery model is kept and the quantity is calculated automatically.">i</button></div><div class="sp-number-wrap"><input type="number" id="spBatteryTargetCapacityKwh" value="0" min="0" step="0.01"><div class="sp-number-arrows"><button type="button" data-target="spBatteryTargetCapacityKwh" data-dir="1"><i class="fa-solid fa-chevron-up"></i></button><button type="button" data-target="spBatteryTargetCapacityKwh" data-dir="-1"><i class="fa-solid fa-chevron-down"></i></button></div></div><div class="sp-catalog-meta sp-battery-target-live" id="spBatteryCapacityTargetLive">Target storage: 0.00 kWh</div>`;
    const selectionField=document.getElementById('spBatterySelectionField');
    if(selectionField?.parentNode) selectionField.parentNode.insertBefore(field,selectionField.nextSibling);
  }
}


function spInitAdmin(){
  spEnsureBatterySizingOptions();
  spAdminInitProjectInputs();
  const sys=document.querySelector('[data-section="primary-inputs"] .sp-field:nth-child(2) select');if(sys)sys.id='spSystemType';
  const pshSelect=document.querySelector('[data-section="project-info"] .sp-field:first-of-type select');if(pshSelect)pshSelect.id='spPshSelect';
  const citySelect=document.querySelector('[data-section="project-info"] .sp-field:nth-of-type(2) select');if(citySelect)citySelect.id='spCitySelect';
  const facilitySelect=document.querySelector('[data-section="project-info"] .sp-field:nth-of-type(3) select');if(facilitySelect)facilitySelect.id='spFacilitySelect';
  spInitCatalogInputs();spPackageSetup();spInitTabs();spInitExportButtons();
  document.querySelectorAll('.sp-accordion-btn').forEach(b=>b.addEventListener('click',()=>b.closest('.sp-accordion')?.classList.toggle('is-open')));
  document.querySelectorAll('.sp-number-arrows button').forEach(b=>b.addEventListener('click',()=>{const i=document.getElementById(b.dataset.target);if(!i)return;const step=spNum(b.dataset.dir),next=spNum(i.value)+step;i.value=Number(next.toFixed((String(b.dataset.dir).split('.')[1]||'').length));i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}));
  const roof=document.getElementById('spRoofPct'),badge=document.getElementById('spRoofPctBadge');roof?.addEventListener('input',()=>badge.textContent=`${roof.value}%`);
  const batMode=document.getElementById('spBatterySizingMode'),batPlan=document.getElementById('spBatterySizingMeta'),batCapacityRow=document.getElementById('spBatteryManualCapacityRow'),batCapacity=document.getElementById('spBatteryTargetCapacityKwh'),batCapacityLive=document.getElementById('spBatteryCapacityTargetLive');
  const batModel=document.getElementById('spBatteryModelSelect'),batModelMeta=document.getElementById('spBatteryModelMeta');
  const invPool=document.getElementById('spInverterPoolMode'),invPoolField=document.getElementById('spInverterPoolField'),invPoolMeta=document.getElementById('spInverterPoolMeta');
  const syncBatteryVisibility=()=>{
    const active=['Hybrid','Off-Grid'].includes(spSystemType());
    const field=document.getElementById('spBatterySelectionField');if(field)field.style.display=active?'block':'none';
    const modelField=document.getElementById('spBatteryModelField');if(modelField)modelField.style.display=active?'block':'none';
    if(invPoolField)invPoolField.style.display=active?'block':'none';
    const card=document.getElementById('spBatteryComparisonCard');if(card)card.classList.toggle('hidden',!active);
    if(!active){
      const cmp=document.getElementById('spBatteryComparison');if(cmp)cmp.innerHTML='';
      const note=document.getElementById('spBatteryComparisonNote');if(note)note.textContent='';
    }
  };
  const syncBatteryMode=()=>{
    const mode=batMode?.value||'auto';
    const manualCapacity=mode==='capacity';
    if(batCapacityRow)batCapacityRow.style.display=manualCapacity?'block':'none';
    if(batPlan)batPlan.textContent=manualCapacity
      ? 'Set a target battery capacity in kWh. The selected catalog battery model is kept and quantity is calculated automatically.'
      : 'The system uses 100% of the selected energy basis and calculates the quantity for the selected catalog battery model.';
    if(batCapacityLive)batCapacityLive.textContent=`Target storage: ${spFmtNum(Math.max(0,spNum(batCapacity?.value||0)),2)} kWh`;
    syncBatteryVisibility();
  };
  const syncPool=()=>{
    const active=['Hybrid','Off-Grid'].includes(spSystemType());
    if(invPoolField)invPoolField.style.display=active?'block':'none';
    if(invPoolMeta){
      invPoolMeta.textContent=(invPool?.value==='hybrid')
        ? 'Using the Hybrid inverter catalog for calculations.'
        : 'Using the On-Grid inverter catalog for calculations (default).';
    }
  };
  batModel?.addEventListener('change',()=>{ spActiveBatteryId=batModel.value||''; if(batModelMeta)batModelMeta.textContent=spBatteryModelMetaText(batModel.value); refreshBatteryLive(); });
  invPool?.addEventListener('change',()=>{syncPool();refreshBatteryLive();});
  batMode?.addEventListener('change',()=>{syncBatteryMode();refreshBatteryLive();});
  batCapacity?.addEventListener('input',()=>{
    if(batCapacity)batCapacity.value=String(Math.max(0,spNum(batCapacity.value)));
    if(batCapacityLive)batCapacityLive.textContent=`Target storage: ${spFmtNum(Math.max(0,spNum(batCapacity?.value||0)),2)} kWh`;
    refreshBatteryLive();
  });
  batCapacity?.addEventListener('change',()=>{
    if(batCapacity)batCapacity.value=String(Math.max(0,spNum(batCapacity.value)));
    if(batCapacityLive)batCapacityLive.textContent=`Target storage: ${spFmtNum(Math.max(0,spNum(batCapacity?.value||0)),2)} kWh`;
    refreshBatteryLive();
  });
  syncBatteryMode();
  syncPool();
  document.getElementById('spSolarBatteryChartToggle')?.addEventListener('change',()=>{ if(spCalculation) spRenderSolarProductionChart(spCalculation); });
  window.addEventListener('resize',()=>{ if(spCalculation) spRenderSolarProductionChart(spCalculation); });
  document.getElementById('spSystemType')?.addEventListener('change',()=>{syncBatteryVisibility();syncBatteryMode();refreshBatteryLive();});
  function refreshBatteryLive(){const target=spNum(document.getElementById('spTargetKwp')?.value||0);const panel=spFind(document.getElementById('spPanelCatalogSelect')?.value);if(!target||!panel)return;const calc=spCalculate();if(calc){document.getElementById('spEmptyState')?.classList.add('hidden');document.getElementById('spResultContent')?.classList.remove('hidden');document.querySelectorAll('.sp-tab-btn').forEach(b=>b.disabled=false);}}
  const margin=document.getElementById('spMarginSlider');margin?.addEventListener('input',()=>spCalculation&&spRenderCustomer(spRenderRab(spCalculation,spLastComponents||spSelectedComponents())));
  document.getElementById('spConfigList')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-action="view-rab"]');
    if(!b)return;
    e.preventDefault();
    e.stopPropagation();
    spActiveConfigId=b.dataset.configId;
    const list=document.getElementById('spConfigList'),x=list&&list._configs?list._configs.find(v=>v.id===spActiveConfigId):null;
    if(spCalculation&&x){
      const calc=x.design;
      calc.type=spSystemType();
      calc.selectedInvQty=x.qty;
      calc.selectedInvTotal=x.total;
      calc.selectedInvRatio=x.ratio;
      calc.selectedInvPeak=x.peak;
      spCalculation=calc;
      if(calc.type==='Hybrid'||calc.type==='Off-Grid') spSyncBatteryPlan(calc);
      spSetAutoSelect('spInverterCatalogSelect',x.inv);
      const c={...(x.components||spSelectedComponents()),battery:calc.battery||null};
      spLastComponents=c;
      spRenderBatteryTarget(calc);
      spRenderDesign(calc);
      spRenderVisual(calc);
      const rab=spRenderRab(calc,c);
      spRenderCustomer(rab);
      spRenderSummary(calc,rab,c);
      spLastCalc=calc;
      spLastRab=rab;
      const pref=document.getElementById('spPackageSelect');
      if(pref){spSyncPreferenceSelect(list._configs,x.id);pref.value=x.id;}
    }
    spActivateTab('rab');
  });
  document.getElementById('spRabGantiBtn')?.addEventListener('click',()=>spActivateTab('configuration'));
  const calcBtn=document.getElementById('spCalculateBtn');calcBtn?.addEventListener('click',()=>{const original=calcBtn.innerHTML;calcBtn.disabled=true;calcBtn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Calculating...';setTimeout(()=>{const calc=spCalculate();if(calc){document.getElementById('spEmptyState')?.classList.add('hidden');document.getElementById('spResultContent')?.classList.remove('hidden');document.querySelectorAll('.sp-tab-btn').forEach(b=>b.disabled=false);document.getElementById('spStepper')?.querySelectorAll('.sp-step').forEach(x=>x.classList.add('is-done'));document.getElementById('spLine2')?.classList.add('is-done');document.getElementById('spLine3')?.classList.add('is-done');}calcBtn.disabled=false;calcBtn.innerHTML=original;},350);});

  // Keep calculated outputs, including Monthly Energy Chart, synchronized with
  // the current catalog-backed inputs. The chart used to remain on the previous
  // calculation until the Calculate button was pressed again.
  const liveInputIds=['spTargetKwp','spSystemPr','spInvEff','spRoofPct','spDcCableLength','spAcCableLength','spVocFactor','spPshSelect','spSystemType','spPanelCatalogSelect','spInverterCatalogSelect','spBatterySizingMode','spBatteryModelSelect','spInverterPoolMode','spBatteryTargetCapacityKwh','spMonthlyBill','spDcAcRatio','spMountingCatalogSelect','spDcCableCatalogSelect','spAcCableCatalogSelect','spPdiCatalogSelect','spPddcCatalogSelect','spPdcCatalogSelect','spAccCatalogSelect','spJasaCatalogSelect','spSloCatalogSelect'];
  let liveTimer=null;
  const refreshLiveResults=()=>{
    clearTimeout(liveTimer);
    liveTimer=setTimeout(()=>{
      const target=spNum(document.getElementById('spTargetKwp')?.value||0);
      const c=spSelectedComponents();
      const type=spSystemType();
      // Inverter is optimizer-owned now; it is intentionally null in
      // spSelectedComponents() until a configuration has been chosen.
      if(!target || !c.panel) return;
      const calc=spCalculate();
      if(calc){
        document.getElementById('spEmptyState')?.classList.add('hidden');
        document.getElementById('spResultContent')?.classList.remove('hidden');
        document.querySelectorAll('.sp-tab-btn').forEach(b=>b.disabled=false);
      }
    },120);
  };
  liveInputIds.forEach(id=>{
    const el=document.getElementById(id); if(!el)return;
    el.addEventListener('input',refreshLiveResults);
    el.addEventListener('change',refreshLiveResults);
  });
}
function initAdminCalculator(){spInitAdmin();}