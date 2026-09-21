// 360energy company catalog seed — source of truth for the Admin Calculator.
// IDs are stable application identifiers; all product/spec/price values come from the latest company catalog.
(function(){
  const rows = [
    {id:'PV-001',kategori:'Panel Surya',nama:'Panel Surya Mono 585 Wp — Phono SNI',satuan:'pcs',ukuran:'',hpp:'1675000',des25:'2277000',sep25:'2847000',kapasitas:'585',voc:'51.9',vmpp:'43.4',impp:'13.48',isc:'13.86',lCm:'202',wCm:'100',mppt:'',rPerKm:'',catatan:''},
    {id:'PV-002',kategori:'Panel Surya',nama:'Panel Surya Mono 580 Wp — Generic alt.',satuan:'pcs',ukuran:'',hpp:'',des25:'2150000',sep25:'2500000',kapasitas:'580',voc:'51.7',vmpp:'43.1',impp:'13.46',isc:'13.84',lCm:'202',wCm:'100',mppt:'',rPerKm:'',catatan:'Alternative'},
    {id:'INV-001',kategori:'Inverter On-Grid',nama:'On-Grid Inverter 20 kW 3-phase',satuan:'pcs',ukuran:'20',hpp:'',des25:'35500000',sep25:'',kapasitas:'20',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'2',rPerKm:'',catatan:''},
    {id:'INV-002',kategori:'Inverter On-Grid',nama:'On-Grid Inverter 40 kW 3-phase',satuan:'pcs',ukuran:'40',hpp:'59750000',des25:'54775000',sep25:'68469000',kapasitas:'40',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'4',rPerKm:'',catatan:''},
    {id:'INV-003',kategori:'Inverter On-Grid',nama:'On-Grid Inverter 50 kW 3-phase',satuan:'pcs',ukuran:'50',hpp:'59984375',des25:'59750000',sep25:'',kapasitas:'50',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'3',rPerKm:'',catatan:''},
    {id:'INV-004',kategori:'Inverter On-Grid',nama:'On-Grid Inverter 60 kW 3-phase',satuan:'pcs',ukuran:'60',hpp:'',des25:'79175000',sep25:'',kapasitas:'60',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'3',rPerKm:'',catatan:''},
    {id:'INV-005',kategori:'Inverter On-Grid',nama:'On-Grid Inverter 80 kW 3-phase',satuan:'pcs',ukuran:'80',hpp:'95975000',des25:'95975000',sep25:'147654000',kapasitas:'80',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'4',rPerKm:'',catatan:''},
    {id:'HYB-001',kategori:'Inverter Hybrid',nama:'Hybrid Inverter 20 kW 3-phase',satuan:'pcs',ukuran:'20',hpp:'',des25:'69750000',sep25:'87188000',kapasitas:'20',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'2',rPerKm:'',catatan:''},
    {id:'BAT-001',kategori:'Battery',nama:'Battery Lithium HV 61.44 kWh (set)',satuan:'set',ukuran:'',hpp:'',des25:'245000000',sep25:'306250000',kapasitas:'61.44',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'BAT-002',kategori:'Battery',nama:'Willindots LiFePO4 160Ah 12.8V (2.048 kWh/unit)',satuan:'unit',ukuran:'',hpp:'',des25:'5577000',sep25:'',kapasitas:'2.048',voc:'14.6',vmpp:'12.8',impp:'160',isc:'',lCm:'33',wCm:'17',mppt:'',rPerKm:'',catatan:'Willindots Baterai Lithium Iron 160AH 12.8V'},
    {id:'MNT-001',kategori:'Mounting',nama:'Mounting Galvanis (per panel)',satuan:'pcs',ukuran:'',hpp:'1200000',des25:'1298077',sep25:'',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'RCK-001',kategori:'Rack',nama:'Rack Outdoor (battery cabinet)',satuan:'lot',ukuran:'',hpp:'',des25:'59000000',sep25:'73750000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'100',wCm:'80',mppt:'',rPerKm:'',catatan:''},
    {id:'PDI-001',kategori:'PDI',nama:'Panel Distribusi Inverter 20 kW',satuan:'pc',ukuran:'20',hpp:'',des25:'29500000',sep25:'',kapasitas:'20',voc:'',vmpp:'',impp:'',isc:'',lCm:'80',wCm:'60',mppt:'',rPerKm:'',catatan:''},
    {id:'PDI-002',kategori:'PDI',nama:'Panel Distribusi Inverter 40 kW',satuan:'pc',ukuran:'40',hpp:'23175000',des25:'33500000',sep25:'41875000',kapasitas:'40',voc:'',vmpp:'',impp:'',isc:'',lCm:'100',wCm:'80',mppt:'',rPerKm:'',catatan:''},
    {id:'PDI-003',kategori:'PDI',nama:'Panel Distribusi Inverter 50 kW',satuan:'pc',ukuran:'50',hpp:'',des25:'37917000',sep25:'',kapasitas:'50',voc:'',vmpp:'',impp:'',isc:'',lCm:'100',wCm:'80',mppt:'',rPerKm:'',catatan:''},
    {id:'PDI-004',kategori:'PDI',nama:'Panel Distribusi Inverter 60 kW',satuan:'pc',ukuran:'60',hpp:'25750000',des25:'25750000',sep25:'',kapasitas:'60',voc:'',vmpp:'',impp:'',isc:'',lCm:'120',wCm:'80',mppt:'',rPerKm:'',catatan:''},
    {id:'PDI-005',kategori:'PDI',nama:'Panel Distribusi Inverter 80 kW',satuan:'pc',ukuran:'80',hpp:'25750000',des25:'25750000',sep25:'42917000',kapasitas:'80',voc:'',vmpp:'',impp:'',isc:'',lCm:'120',wCm:'100',mppt:'',rPerKm:'',catatan:''},
    {id:'PDDC-001',kategori:'PDDC',nama:'Panel Distribusi DC Combiner 40 kW',satuan:'pc',ukuran:'40',hpp:'17950000',des25:'17950000',sep25:'',kapasitas:'40',voc:'',vmpp:'',impp:'',isc:'',lCm:'60',wCm:'40',mppt:'',rPerKm:'',catatan:''},
    {id:'PDDC-002',kategori:'PDDC',nama:'Panel Distribusi DC Combiner 60 kW',satuan:'pc',ukuran:'60',hpp:'17950000',des25:'17950000',sep25:'',kapasitas:'60',voc:'',vmpp:'',impp:'',isc:'',lCm:'60',wCm:'40',mppt:'',rPerKm:'',catatan:''},
    {id:'PDDC-003',kategori:'PDDC',nama:'Panel Distribusi DC Combiner 80 kW',satuan:'pc',ukuran:'80',hpp:'21950000',des25:'21950000',sep25:'36584000',kapasitas:'80',voc:'',vmpp:'',impp:'',isc:'',lCm:'80',wCm:'60',mppt:'',rPerKm:'',catatan:''},
    {id:'PDC-001',kategori:'PDC',nama:'Panel DC Combiner (string box) std',satuan:'pcs',ukuran:'',hpp:'9750000',des25:'5000000',sep25:'',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'PDC-002',kategori:'PDC',nama:'Panel DC Combiner 20kW spec',satuan:'pcs',ukuran:'',hpp:'',des25:'6250000',sep25:'6250000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'50',wCm:'40',mppt:'',rPerKm:'',catatan:''},
    {id:'PDC-003',kategori:'PDC',nama:'Panel DC Combiner 80kW spec',satuan:'pcs',ukuran:'',hpp:'9750000',des25:'9750000',sep25:'15000000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'80',wCm:'60',mppt:'',rPerKm:'',catatan:''},
    {id:'KDC-001',kategori:'Kabel DC',nama:'Kabel PV 1×4 mm²',satuan:'mtr',ukuran:'',hpp:'15000',des25:'24000',sep25:'30000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'4.61',catatan:''},
    {id:'KAC-001',kategori:'Kabel AC',nama:'Kabel NYY 4×16 mm² (≤20 kW)',satuan:'mtr',ukuran:'',hpp:'',des25:'215000',sep25:'269000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'1.15',catatan:''},
    {id:'KAC-002',kategori:'Kabel AC',nama:'Kabel NYY 4×25 mm² (40–50 kW)',satuan:'mtr',ukuran:'',hpp:'',des25:'550000',sep25:'688000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'0.727',catatan:''},
    {id:'KAC-003',kategori:'Kabel AC',nama:'Kabel NYY 4×35 mm² Brickstone (60–80 kW)',satuan:'mtr',ukuran:'',hpp:'',des25:'485000',sep25:'809000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'0.524',catatan:''},
    {id:'KAC-004',kategori:'Kabel AC',nama:'Kabel NYY 4×25 mm² Laskar Jaya alt',satuan:'mtr',ukuran:'',hpp:'',des25:'235000',sep25:'',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'0.727',catatan:''},
    {id:'KAC-005',kategori:'Kabel AC',nama:'Kabel NYY 4×35 mm² Laskar Jaya alt',satuan:'mtr',ukuran:'',hpp:'',des25:'275000',sep25:'',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'0.524',catatan:''},
    {id:'ACC-001',kategori:'Acc.',nama:'Accessories Instalasi 20 kW',satuan:'lot',ukuran:'20',hpp:'',des25:'24000000',sep25:'30000000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'ACC-002',kategori:'Acc.',nama:'Accessories Instalasi 40 kW',satuan:'lot',ukuran:'40',hpp:'',des25:'27000000',sep25:'33750000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'ACC-003',kategori:'Acc.',nama:'Accessories Instalasi 50 kW',satuan:'lot',ukuran:'50',hpp:'',des25:'35000000',sep25:'',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'ACC-004',kategori:'Acc.',nama:'Accessories Instalasi 60 kW',satuan:'lot',ukuran:'60',hpp:'',des25:'28600000',sep25:'',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'ACC-005',kategori:'Acc.',nama:'Accessories Instalasi 80 kW',satuan:'lot',ukuran:'80',hpp:'',des25:'35000000',sep25:'50000000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'JAS-001',kategori:'Jasa',nama:'Jasa Instalasi 20 kW',satuan:'lot',ukuran:'20',hpp:'',des25:'50000000',sep25:'50000000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'JAS-002',kategori:'Jasa',nama:'Jasa Instalasi 40 kW',satuan:'lot',ukuran:'40',hpp:'',des25:'80000000',sep25:'80000000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'JAS-003',kategori:'Jasa',nama:'Jasa Instalasi 50 kW',satuan:'lot',ukuran:'50',hpp:'',des25:'95000000',sep25:'',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'JAS-004',kategori:'Jasa',nama:'Jasa Instalasi 60 kW',satuan:'lot',ukuran:'60',hpp:'145000000',des25:'145000000',sep25:'',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'JAS-005',kategori:'Jasa',nama:'Jasa Instalasi 80 kW',satuan:'lot',ukuran:'80',hpp:'175000000',des25:'175000000',sep25:'200000000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'SLO-001',kategori:'SLO/NIDI',nama:'SLO / NIDI 20 kW',satuan:'lot',ukuran:'20',hpp:'',des25:'32000000',sep25:'32000000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'SLO-002',kategori:'SLO/NIDI',nama:'SLO / NIDI 40 kW',satuan:'lot',ukuran:'40',hpp:'',des25:'37500000',sep25:'37500000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'SLO-003',kategori:'SLO/NIDI',nama:'SLO / NIDI 50 kW',satuan:'lot',ukuran:'50',hpp:'',des25:'37050000',sep25:'',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''},
    {id:'SLO-004',kategori:'SLO/NIDI',nama:'SLO / NIDI 60–80 kW',satuan:'lot',ukuran:'',hpp:'26000000',des25:'26000000',sep25:'26000000',kapasitas:'',voc:'',vmpp:'',impp:'',isc:'',lCm:'',wCm:'',mppt:'',rPerKm:'',catatan:''}
  ];
  window.EDASH_DEFAULT_CATALOG = rows;
  window.EDASH_CATALOG_STORAGE_KEY = 'edash4_catalog_rows_v2';
  window.ensureEdashCompanyCatalog = function(){
    try {
      const key=window.EDASH_CATALOG_STORAGE_KEY;
      const marker='edash4_company_catalog_version';
      const version='2026-08-company-catalog-v1';
      const raw=localStorage.getItem(key);
      const current=raw?JSON.parse(raw):[];
      const hasStableIds=Array.isArray(current) && ['PV-001','INV-001','HYB-001','BAT-001'].every(id=>current.some(r=>String(r.id)===id));
      // One-time migration from the older p1/inv20og/bat1 prototype IDs.
      // After migration, Catalog page edits remain authoritative in localStorage.
      if(localStorage.getItem(marker)!==version || !hasStableIds){
        localStorage.setItem(key, JSON.stringify(rows));
        localStorage.setItem(marker, version);
        return rows;
      }
      return current;
    } catch(e) { console.warn('Company catalog seed failed',e); return rows; }
  };
})();
