#!/usr/bin/env python3
"""Migrate data from Bitable exports to event-sourced format."""
import json, os

DATA_DIR = "${EAA_DATA_DIR:-./data}"
SCHEMA_DIR = "${EAA_SCHEMA_DIR:-./schema}"

# Load raw records
with open("/tmp/bitable_records.json") as f:
    raw_records = json.load(f)

# Overview table data (embedded from API response)
overview_raw = []  # will be loaded from file
with open("/tmp/overview_records.json") as f:
    overview_raw = json.load(f)

# --- Step 1: Build entity map from overview ---
entities = {}
name_to_id = {}
sorted_names = sorted(set(r["fields"]["姓名"] for r in overview_raw))

for idx, name in enumerate(sorted_names, 1):
    sid = f"stu_{idx:03d}"
    # find matching overview record
    ov = next(r for r in overview_raw if r["fields"]["姓名"] == name)
    risk = ov["fields"].get("风险标签", "正常") or "正常"
    entities[sid] = {
        "id": sid,
        "name": name,
        "aliases": [],
        "status": "ACTIVE",
        "created_at": "2025-09-01T08:00:00Z",
        "metadata": {"class": "高二5班", "risk": risk}
    }
    name_to_id[name] = sid

# Save entities
with open(f"{DATA_DIR}/entities/entities.json", "w") as f:
    json.dump({"entities": entities}, f, ensure_ascii=False, indent=2)

with open(f"{DATA_DIR}/entities/name_index.json", "w") as f:
    json.dump(name_to_id, f, ensure_ascii=False, indent=2)

print(f"Entities: {len(entities)} students")

# --- Step 2: Map reasons to reason_codes ---
def classify_reason(reason, score_delta, source):
    reason_lower = reason.lower() if reason else ""
    if score_delta < 0:
        if "睡觉" in reason or "sleep" in reason_lower:
            return "SLEEP_IN_CLASS"
        if "讲话" in reason or "说话" in reason:
            if "补差" in reason:
                return "MAKEUP"
            return "SPEAK_IN_CLASS"
        if "迟到" in reason:
            if "补差" in reason:
                return "MAKEUP"
            return "LATE"
        if "饮酒" in reason or "喝酒" in reason:
            return "DRINKING_DORM"
        if "抽烟" in reason or "吸烟" in reason or "烟" in reason:
            if "反省" in reason:
                return "SMOKING"
            return "SMOKING"
        if "手机" in reason:
            return "PHONE_IN_CLASS"
        if "桌" in reason and ("齐" in reason or "对齐" in reason):
            return "DESK_UNALIGNED"
        if "仪容" in reason or "仪表" in reason or "理发" in reason or "化妆" in reason:
            return "APPEARANCE_VIOLATION"
        if "校服" in reason:
            return "APPEARANCE_VIOLATION"
        if "跑操" in reason and "未到" in reason:
            return "SCHOOL_CAUGHT"
        if "学校抓" in reason or "学校拍到" in reason or source == "学校抓拍":
            if "补差" in reason:
                return "MAKEUP"
            return "SCHOOL_CAUGHT"
        if "补差" in reason or "补录" in reason:
            return "MAKEUP"
        if "违纪" in reason and "补差" not in reason:
            return "OTHER_DEDUCT"
        if "换座位" in reason:
            return "OTHER_DEDUCT"
        if "玩球" in reason:
            return "OTHER_DEDUCT"
        return "OTHER_DEDUCT"
    else:  # positive
        if "班长履职" in reason:
            return "CLASS_MONITOR"
        if "班委履职" in reason:
            return "CLASS_COMMITTEE"
        if "文明寝室" in reason:
            return "CIVILIZED_DORM"
        if "月勤" in reason:
            return "MONTHLY_ATTENDANCE"
        if "学业奖励" in reason:
            return "BONUS_VARIABLE"
        if "跑操" in reason:
            return "ACTIVITY_PARTICIPATION"
        if "防震" in reason:
            return "ACTIVITY_PARTICIPATION"
        return "ACTIVITY_PARTICIPATION"

def determine_event_type(delta):
    return "CONDUCT_BONUS" if delta >= 0 else "CONDUCT_DEDUCT"

def ms_to_iso(ms):
    if ms is None:
        return "2026-03-01T08:00:00Z"
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ms/1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# --- Step 3: Build events ---
events = []
for idx, rec in enumerate(raw_records, 1):
    name, delta, reason, source, ts_ms, rec_id, note = rec
    
    eid = f"stu_{name_to_id[name]}" if name in name_to_id else None
    if eid is None:
        print(f"WARNING: Unknown student '{name}', skipping")
        continue
    
    entity_id = name_to_id[name]
    reason_code = classify_reason(reason, delta, source)
    event_type = determine_event_type(delta)
    
    events.append({
        "event_id": f"evt_{idx:05d}",
        "entity_id": entity_id,
        "event_type": event_type,
        "category_tags": [source, "日常"],
        "reason_code": reason_code,
        "original_reason": reason,
        "score_delta": delta,
        "evidence_ref": f"bitable:{rec_id}",
        "operator": source,
        "timestamp": ms_to_iso(ts_ms),
        "is_valid": True,
        "reverted_by": None,
        "note": note if note else ""
    })

with open(f"{DATA_DIR}/events/events.json", "w") as f:
    json.dump(events, f, ensure_ascii=False, indent=2)

print(f"Events: {len(events)} records")

# --- Step 4: Cross-validate ---
# Replay scores
scores = {}
for eid, ent in entities.items():
    scores[eid] = 100.0

for evt in events:
    if evt["is_valid"] and evt["reverted_by"] is None:
        scores[evt["entity_id"]] += evt["score_delta"]

# Compare with overview
print("\n=== Cross Validation ===")
mismatches = 0
for ov in overview_raw:
    name = ov["fields"]["姓名"]
    expected = float(ov["fields"]["当前总分"])
    eid = name_to_id[name]
    actual = scores[eid]
    match = "✓" if abs(actual - expected) < 0.01 else "✗"
    if match == "✗":
        mismatches += 1
        print(f"  {match} {name}: replay={actual}, bitable={expected}, diff={actual-expected:.1f}")

if mismatches == 0:
    print("All 52 students match!")
else:
    print(f"\n{mismatches} mismatches found")

# Save validation report
report = []
for ov in sorted(overview_raw, key=lambda x: float(x["fields"]["当前总分"])):
    name = ov["fields"]["姓名"]
    expected = float(ov["fields"]["当前总分"])
    eid = name_to_id[name]
    actual = scores[eid]
    report.append({"name": name, "replay": actual, "bitable": expected, "match": abs(actual-expected)<0.01})

with open(f"{DATA_DIR}/logs/validation_report.json", "w") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
