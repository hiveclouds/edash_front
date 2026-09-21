import pickle, json, statistics, gc
from datetime import datetime, timezone
from collections import defaultdict, Counter

def f(v):
    try:
        if v in (None, ''): return None
        return float(v)
    except: return None

def parse_ts(v):
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        s = str(v).replace('Z', '+00:00')
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except:
        return None

def is_fault(code):
    if code is None: return False
    digits = ''.join(ch for ch in str(code) if ch.isdigit())
    return digits != '' and digits != '0' * len(digits)

def mode_str(values):
    vals = [str(v).strip() for v in values if v not in (None, '')]
    if not vals: return None
    return Counter(vals).most_common(1)[0][0]

NOW = datetime(2026, 8, 15, tzinfo=timezone.utc)

# Field-level existing manual overrides to preserve (loaded from current
# server/data/systems.json so edits made through the System Information UI
# are not clobbered by this ETL re-run).
EXISTING = {s["id"]: s for s in json.load(open("/home/claude/work/edash_json/server/data/systems.json"))}

def dc_current_sum(r):
    vals = [f(r.get('DC1')), f(r.get('DC2')), f(r.get('DC3')), f(r.get('DC4'))]
    return sum(v for v in vals if v is not None)

def build(rows, sys_id, station_name, device_sn_fallback, inverter_index, device_id_col=None):
    parsed = []
    for r in rows:
        ts = parse_ts(r['ts'])
        if ts is None: continue
        parsed.append((ts, r))
    parsed.sort(key=lambda x: x[0])

    first_ts, first_row = parsed[0]
    last_ts, last_row = parsed[-1]
    age_hours = (NOW - last_ts).total_seconds() / 3600
    status = "connected" if age_hours < 2 else ("pending" if age_hours < 48 else "offline")

    tail = [r for _, r in parsed[-500:]]

    pr_vals = [f(r.get('Pr1')) for r in tail if f(r.get('Pr1'))]
    rated_kw = round((statistics.median(pr_vals) if pr_vals else 0) / 1000, 1)

    freq_vals = [f(r.get('A_Fo1')) for r in tail if f(r.get('A_Fo1')) is not None]
    freq = round(statistics.median(freq_vals), 2) if freq_vals else None

    rp_vals = [f(r.get('RP_1')) for r in tail if f(r.get('RP_1')) is not None]
    reactive_power = round(statistics.median(rp_vals), 2) if rp_vals else None

    pf_vals = [f(r.get('FV_P')) for r in tail if f(r.get('FV_P')) is not None]
    power_factor = round(statistics.median(pf_vals), 2) if pf_vals else None

    clk_vals = [f(r.get('Clk1')) for r in tail if f(r.get('Clk1')) is not None]
    leak_current = round(statistics.median(clk_vals), 1) if clk_vals else None

    dcir_vals = [f(r.get('DCIR')) for r in tail if f(r.get('DCIR')) is not None]
    insulation_r = round(statistics.median(dcir_vals), 1) if dcir_vals else None

    fan_vals = [f(r.get('FAN_MPPT_C1')) for r in tail if f(r.get('FAN_MPPT_C1')) is not None]
    fan_on = any(v and v > 0 for v in fan_vals)
    fan_relay = ("ON" if fan_on else "OFF") if fan_vals else "-"

    inv_status = mode_str([r.get('INV_ST1') for r in tail]) or "-"
    comm_protocol = mode_str([r.get('PTC_NUM1') for r in tail]) or "-"
    pv_model = mode_str([r.get('PM1') for r in tail]) or "-"
    firmware = mode_str([r.get('I_SVN') for r in tail]) or "-"
    device_sn = mode_str([r.get('SN1') for r in tail]) or device_sn_fallback
    device_id = mode_str([r.get(device_id_col) for r in tail]) if device_id_col else None

    last_fault_code = None
    for _, r in reversed(parsed):
        c = r.get('Fault_Code1')
        if c not in (None, ''):
            last_fault_code = c
            break

    # ---- daily energy (Etdy_ge1 resets daily -> take max per date) ----
    daily_energy = defaultdict(float)
    daily_rows = defaultdict(list)
    for ts, r in parsed:
        d = ts.date().isoformat()
        v = f(r.get('Etdy_ge1'))
        if v is not None and v > daily_energy[d]:
            daily_energy[d] = v
        daily_rows[d].append((ts, r))
    all_days = sorted(daily_energy.keys())

    # PAKAI SISI DC/PV (DV1, DC1-4, PVTP), BUKAN AC-side (AV1/AC1/T_AC_OP):
    # kedua device ini status inverter = "Off-grid" terus & AC-side nyaris 0
    # sepanjang puluhan ribu baris data (lihat electricalQuality — A_Fo1/
    # RP_1/FV_P juga nyaris konstan karena AC output tidak dipakai di
    # konfigurasi ini). DC/PV side yang beneran punya variasi produksi.
    def day_hourly(d):
        rs = daily_rows[d]
        hourly = defaultdict(lambda: {"v": [], "i": [], "p": []})
        for ts, r in rs:
            h = ts.hour
            v = f(r.get('DV1')); i = dc_current_sum(r); p = f(r.get('PVTP'))
            if v is not None: hourly[h]["v"].append(v)
            hourly[h]["i"].append(i)
            if p is not None: hourly[h]["p"].append(p / 1000)
        labels = [f"{h:02d}:00" for h in range(24)]
        voltage = [round(statistics.mean(hourly[h]["v"]), 1) if hourly[h]["v"] else 0 for h in range(24)]
        current = [round(statistics.mean(hourly[h]["i"]), 1) if hourly[h]["i"] else 0 for h in range(24)]
        power = [round(statistics.mean(hourly[h]["p"]), 2) if hourly[h]["p"] else 0 for h in range(24)]
        return {"labels": labels, "voltage": voltage, "current": current, "power": power}

    def day_label(d):
        return datetime.fromisoformat(d).strftime('%a %d %b')

    def range_series(days):
        labels, voltage, current, power = [], [], [], []
        for d in days:
            rs = daily_rows[d]
            volts = [f(r.get('DV1')) for _, r in rs if f(r.get('DV1'))]
            currs = [dc_current_sum(r) for _, r in rs]
            pw = [f(r.get('PVTP')) for _, r in rs if f(r.get('PVTP')) is not None]
            labels.append(day_label(d))
            voltage.append(round(statistics.mean(volts), 1) if volts else 0)
            current.append(round(statistics.mean(currs), 1) if currs else 0)
            power.append(round((statistics.mean(pw) if pw else 0) / 1000, 2))
        return {"labels": labels, "voltage": voltage, "current": current, "power": power}

    last_day = all_days[-1]
    today_chart = day_hourly(last_day)
    week_chart = range_series(all_days[-7:])
    month_chart = range_series(all_days[-30:])

    # Per-day hourly series for the WHOLE available range, so the UI can
    # let the user pick literally any day ("custom hari") and still see
    # hourly voltage/current/power for that day, not just today/7d/30d.
    by_day = {d: day_hourly(d) for d in all_days}

    # ---- faults -> alarm history (scan full dataset, cap 10 most recent) ----
    alarms = []
    for ts, r in reversed(parsed):
        code = r.get('Fault_Code1')
        if is_fault(code):
            alarms.append({
                "time": ts.strftime("%Y-%m-%d %H:%M"),
                "description": f"Fault code {code} terdeteksi pada inverter",
                "status": "warning"
            })
        if len(alarms) >= 10: break

    fault_count_recent = sum(1 for r in tail if is_fault(r.get('Fault_Code1')))
    health = max(0, 100 - fault_count_recent * 5)

    total_energy_vals = [f(r.get('Et_ge0')) for r in tail if f(r.get('Et_ge0'))]
    total_energy = max(total_energy_vals) if total_energy_vals else None

    prev = EXISTING.get(sys_id, {})
    def keep(section, key, default="-"):
        return (prev.get(section, {}) or {}).get(key, default)

    return {
        "id": sys_id,
        "status": status,
        "basic": {
            "systemName": station_name.title(),
            "inverter1": f"Inverter {inverter_index}",
            "inverterBrand": keep("basic", "inverterBrand", "INVT")
        },
        "systemOverview": {
            "installedDate": first_ts.date().isoformat(),
            "lastUpdated": last_ts.date().isoformat(),
            "peakPowerKwp": str(rated_kw),
            "address": keep("systemOverview", "address", "-")
        },
        "inverterOverview": {
            "deviceId": device_id or keep("inverterOverview", "deviceId", "-"),
            "tbDeviceId": keep("inverterOverview", "tbDeviceId", "-"),
            "deviceName": station_name.title(),
            "deviceSn": device_sn,
            "deviceType": "INVERTER",
            "provider": keep("inverterOverview", "provider", "-"),
            "inverterType": inv_status,
            "maximumOutputKw": str(rated_kw),
            "communicationProtocol": comm_protocol,
            "installationDate": first_ts.date().isoformat(),
            "lastMaintenance": keep("inverterOverview", "lastMaintenance", "-"),
            "nextMaintenance": keep("inverterOverview", "nextMaintenance", "-"),
            "maintenanceFrequency": keep("inverterOverview", "maintenanceFrequency", "-")
        },
        "pvPanelOverview": {
            "pvId": keep("pvPanelOverview", "pvId", "-"),
            "pvModel": pv_model,
            "cellType": keep("pvPanelOverview", "cellType", "-"),
            "individualPanelSizeM2": keep("pvPanelOverview", "individualPanelSizeM2", "-"),
            "pvInstalledKw": keep("pvPanelOverview", "pvInstalledKw", "-"),
            "installationDate": first_ts.date().isoformat(),
            "lastMaintenance": keep("pvPanelOverview", "lastMaintenance", "-"),
            "nextMaintenance": keep("pvPanelOverview", "nextMaintenance", "-"),
            "maintenanceFrequency": keep("pvPanelOverview", "maintenanceFrequency", "-")
        },
        "deviceOverview": {
            "firmware": firmware,
            "modbusStatus": "Online" if status == "connected" else ("Delayed" if status == "pending" else "Offline"),
            "uptimeSeconds": keep("deviceOverview", "uptimeSeconds", "-"),
            "lastSeen": last_ts.isoformat(),
            "ambientTemperatureC": keep("deviceOverview", "ambientTemperatureC", "-"),
            "humidityPct": keep("deviceOverview", "humidityPct", "-"),
            "fanRelay": fan_relay,
            "alarmRegisterStatus": keep("deviceOverview", "alarmRegisterStatus", "-")
        },
        "electricalQuality": {
            "frequencyHz": str(freq) if freq is not None else "-",
            "reactivePowerKvar": str(reactive_power) if reactive_power is not None else "-",
            "powerFactor": str(power_factor) if power_factor is not None else "-"
        },
        "diagnostics": {
            "leakCurrentMa": str(leak_current) if leak_current is not None else "-",
            "insulationResistanceKohm": str(insulation_r) if insulation_r is not None else "-",
            "inverterStatus": inv_status,
            "faultCode": last_fault_code or "-"
        },
        "futureMaintenance": prev.get("futureMaintenance", []),
        "historicalMaintenance": prev.get("historicalMaintenance", []),
        "alarmHistory": alarms,
        "chart": {
            "today": today_chart,
            "week": week_chart,
            "month": month_chart,
            "byDay": by_day,
            "range": {"firstDate": all_days[0], "lastDate": all_days[-1]}
        },
        "health": health,
        "meta": {
            "deviceSn": device_sn,
            "deviceType": "INVERTER",
            "rowCount": len(parsed),
            "firstCollectTimeUtc": first_ts.isoformat(),
            "lastCollectTimeUtc": last_ts.isoformat(),
            "dailyEnergyKwhLatest": f(last_row.get('Etdy_ge1')),
            "totalEnergyKwh": total_energy,
            "source": "data_logger_export"
        }
    }

print("loading slim1...")
rows1 = pickle.load(open("slim1.pkl", "rb"))
sys1 = build(rows1, "sys-tawabi-grup1", "PLTS TAWABI GRUP 1", "F01257000589", 1, device_id_col=None)
del rows1
gc.collect()
print("sys1 built:", sys1["status"], sys1["health"], "days:", len(sys1["chart"]["byDay"]))

print("loading slim2...")
rows2 = pickle.load(open("slim2.pkl", "rb"))
sys2 = build(rows2, "sys-tawabi-grup2", "PLTS TAWABI GRUP 2", "F01257000590", 2, device_id_col="Device ID")
del rows2
gc.collect()
print("sys2 built:", sys2["status"], sys2["health"], "days:", len(sys2["chart"]["byDay"]))

out = [sys1, sys2]
with open("real_systems_v2.json", "w") as fp:
    json.dump(out, fp, indent=2, default=str)

import os
print("file size MB:", round(os.path.getsize("real_systems_v2.json")/1024/1024, 2))
print(json.dumps(sys1["inverterOverview"], indent=2))
print(json.dumps(sys1["electricalQuality"], indent=2))
print(json.dumps(sys1["diagnostics"], indent=2))
print(json.dumps(sys1["deviceOverview"], indent=2))
print(json.dumps(sys2["inverterOverview"], indent=2))
