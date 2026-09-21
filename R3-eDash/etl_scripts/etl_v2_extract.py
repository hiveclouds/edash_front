import json, gc, pickle
from datetime import datetime, timezone
from python_calamine import CalamineWorkbook

NEEDED = [
    "DV1","DV2","DV3","DV4","DC1","DC2","DC3","DC4","DP1","DP2","DP3","DP4","PVTP",
    "AV1","AV2","AV3","AC1","AC2","AC3","T_AC_OP",
    "Etdy_ge1","Et_ge0","Pr1","A_Fo1","RP_1","FV_P","Clk1","DCIR","INV_ST1",
    "Fault_Code1","PTC_NUM1","PM1","SN1","I_SVN","FAN_MPPT_C1","ADD_COMM1"
]

def slim_extract(path, sheet, ts_field, extra_cols=None):
    wb = CalamineWorkbook.from_path(path)
    ws = wb.get_sheet_by_name(sheet)
    data = ws.to_python()
    headers = data[0]
    idx = {h: i for i, h in enumerate(headers)}
    cols = list(NEEDED) + (extra_cols or [])
    ts_i = idx[ts_field]
    col_idx = {c: idx.get(c) for c in cols}

    out = []
    for row in data[1:]:
        ts_raw = row[ts_i]
        rec = {"ts": ts_raw}
        for c, i in col_idx.items():
            rec[c] = row[i] if i is not None else None
        out.append(rec)
    n = len(out)
    del data, ws, wb
    gc.collect()
    return headers, out, n

print("extracting group1...")
h1, rows1, n1 = slim_extract(
    "/mnt/user-data/uploads/data_logger_tawabi_plts_group_1.xlsx",
    "Frame Data", "collectTimeUtc"
)
print("group1 rows:", n1)
with open("slim1.pkl", "wb") as f:
    pickle.dump(rows1, f)
del rows1
gc.collect()

print("extracting group2...")
h2, rows2, n2 = slim_extract(
    "/mnt/user-data/uploads/data_logger_tawabi_plts_grup_2.xlsx",
    "Data Logger", "Collect Time UTC",
    extra_cols=["Station ID", "Station Name", "Device ID", "Device SN", "Device Type"]
)
print("group2 rows:", n2)
with open("slim2.pkl", "wb") as f:
    pickle.dump(rows2, f)

print("done")
