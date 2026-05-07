#!/usr/bin/env python3
"""
EAA → 飞书Bitable v2 自动同步脚本 v1.0
=========================================
功能：
1. 对比EAA事件库 vs 飞书评分记录表，自动补全缺失的事件明细
2. 更新学生操行分总览表（当前总分、加分/扣分统计、最后变动日期）
3. 记录证据链接（evidence_ref），避免重复同步

运行：python3 scripts/eaa_bitable_sync.py
"""

import json
import os
import sys
import time
import requests
from datetime import datetime, timezone
from collections import defaultdict

# ===== 配置 =====
APP_ID = "cli_a927154a7ef81cc6"
APP_SECRET = "FqHByIJjFlU7rtPXXwIq5ejV6JbaVi4Z"
BITABLE_APP_TOKEN = "EvFfbRrzEaFO9Ds7z06cstZLnae"
BITABLE_EVENTS_TABLE = "tbl7pU3vcwVPrzHn"   # 评分记录表
BITABLE_SCORES_TABLE = "tblSIC0qf1zsMqIr"    # 学生操行分总览表
EVENTS_JSON = os.path.join(os.environ.get("EAA_DATA_DIR", "./data"), "events", "events.json")
ENTITIES_JSON = os.path.join(os.environ.get("EAA_DATA_DIR", "./data"), "entities", "entities.json")
LOG_FILE = os.path.join(os.environ.get("EAA_DATA_DIR", "./data"), "logs", "bitable_sync.log")
BATCH_SIZE = 50  # 飞书API单次写入上限

# ===== 类别映射（EAA reason_code → Bitable 类别） =====
CATEGORY_MAP = {
    "SPEAK_IN_CLASS": "讲话",
    "SLEEP_IN_CLASS": "睡觉",
    "LATE": "迟到",
    "APPEARANCE_VIOLATION": "仪容",
    "DESK_UNALIGNED": "其他",
    "LAB_CLEAN_UP": "其他",
    "OTHER_DEDUCT": "其他",
    "DRINKING_DORM": "违纪",
    "SCHOOL_CAUGHT": "违纪",
    "LAB_EQUIPMENT_DAMAGE": "违纪",
    "LAB_UNSAFE_BEHAVIOR": "违纪",
    "PHONE_IN_CLASS": "违纪",
    "SMOKING": "违纪",
    "LAB_SAFETY_VIOLATION": "违纪",
    "BONUS_VARIABLE": "学业奖励",
    "CIVILIZED_DORM": "文明寝室",
    "MONTHLY_ATTENDANCE": "月勤",
    "CLASS_MONITOR": "班长履职",
    "CLASS_COMMITTEE": "班委履职",
    "TALK_COMPLETED": "其他",
    "MAKEUP": "月勤补差",
    "REVERT": "其他",
    "ACTIVITY_PARTICIPATION": "其他",
}

# ===== 来源映射（EAA category_tags → Bitable 来源） =====
SOURCE_MAP = {
    "班主任": "班主任",
    "学校抓拍": "学校抓拍",
    "政教处": "政教处",
    "科任老师": "科任老师",
    "系统纠正": "系统纠正",
    "寝室评比": "寝室评比",
    "考试成绩": "考试成绩",
}


def log(msg):
    """写日志"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def get_tenant_token():
    """获取飞书 tenant_access_token"""
    url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    resp = requests.post(url, json={"app_id": APP_ID, "app_secret": APP_SECRET}, timeout=10)
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"获取Token失败: {data.get('msg', '')}")
    return data["tenant_access_token"]


def get_bitable_records(token, table_id, page_size=500):
    """获取Bitable表所有记录"""
    records = {}
    page_token = None
    while True:
        url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{BITABLE_APP_TOKEN}/tables/{table_id}/records"
        params = {"page_size": min(page_size, 500)}
        if page_token:
            params["page_token"] = page_token
        headers = {"Authorization": f"Bearer {token}"}
        resp = requests.get(url, headers=headers, params=params, timeout=30)
        data = resp.json()
        if data.get("code") != 0:
            raise Exception(f"查询Bitable失败: {data.get('msg', '')}")
        for r in data.get("data", {}).get("items", []):
            rid = r["record_id"]
            fields = r.get("fields", {})
            # 用 日期+学生+原因+分值 构建唯一键
            date_ts = fields.get("日期")
            name = fields.get("学生姓名", "")
            reason = fields.get("原因", "")
            score = fields.get("分值")
            key = f"{date_ts}|{name}|{reason}|{score}"
            records[key] = rid
        if not data.get("data", {}).get("has_more"):
            break
        page_token = data["data"].get("page_token")
    return records


def get_all_students_scores(token):
    """获取总览表所有学生记录"""
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{BITABLE_APP_TOKEN}/tables/{BITABLE_SCORES_TABLE}/records"
    params = {"page_size": 500}
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(url, headers=headers, params=params, timeout=30)
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"查询总览表失败: {data.get('msg', '')}")
    
    students = {}
    for r in data.get("data", {}).get("items", []):
        fields = r.get("fields", {})
        name = fields.get("姓名", "")
        if name:
            students[name] = {
                "record_id": r["record_id"],
                "fields": fields
            }
    return students


def create_bitable_record(token, table_id, fields):
    """在Bitable中创建一条记录"""
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{BITABLE_APP_TOKEN}/tables/{table_id}/records"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {"fields": fields}
    resp = requests.post(url, headers=headers, json=payload, timeout=15)
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"创建记录失败: {data.get('msg', '')}, fields={fields}")
    return data["data"]["record"]["record_id"]


def update_bitable_record(token, table_id, record_id, fields):
    """更新Bitable中的一条记录"""
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{BITABLE_APP_TOKEN}/tables/{table_id}/records/{record_id}"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {"fields": fields}
    resp = requests.put(url, headers=headers, json=payload, timeout=15)
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"更新记录失败: {data.get('msg', '')}")


def parse_timestamp(ts_val):
    """将时间戳转为飞书日期时间戳（毫秒）"""
    if isinstance(ts_val, (int, float)):
        if ts_val > 1e12:  # 已经是毫秒
            return int(ts_val)
        return int(ts_val * 1000)
    # 字符串 ISO 格式
    try:
        dt = datetime.fromisoformat(ts_val.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except:
        return int(time.time() * 1000)


def determine_category(reason_code, original_reason, score_delta):
    """确定Bitable类别"""
    # 优先用reason_code映射
    if reason_code in CATEGORY_MAP:
        return CATEGORY_MAP[reason_code]
    # 根据描述和分值推断
    if score_delta > 0:
        return "学业奖励"
    if "迟到" in original_reason:
        return "迟到"
    if "讲话" in original_reason:
        return "讲话"
    if "睡觉" in original_reason:
        return "睡觉"
    return "其他"


def determine_source(tags, operator):
    """确定Bitable来源"""
    if tags:
        for tag in tags:
            if tag in SOURCE_MAP:
                return SOURCE_MAP[tag]
    if operator in SOURCE_MAP:
        return SOURCE_MAP[operator]
    return "班主任"


def sync_events():
    """同步事件到Bitable评分记录表"""
    log("=" * 60)
    log("EAA → 飞书Bitable v2 事件同步开始")
    
    # 1. 读取EAA事件
    with open(EVENTS_JSON, "r", encoding="utf-8") as f:
        events = json.load(f)
    with open(ENTITIES_JSON, "r", encoding="utf-8") as f:
        entities_data = json.load(f)["entities"]
    log(f"EAA事件库: {len(events)} 条事件, {len(entities_data)} 名学生")
    
    # 2. 获取飞书Token和现有记录
    token = get_tenant_token()
    existing_records = get_bitable_records(token, BITABLE_EVENTS_TABLE)
    log(f"飞书评分记录表: {len(existing_records)} 条现有记录")
    
    # 3. 找出需要同步的事件（没有bitable evidence_ref的）
    to_sync = []
    for event in events:
        if not event.get("is_valid", True):
            continue
        ref = event.get("evidence_ref", "")
        if ref and ref.startswith("bitable:"):
            continue  # 已同步
        
        entity_id = event.get("entity_id", "")
        student_name = entities_data.get(entity_id, {}).get("name", entity_id)
        reason_code = event.get("reason_code", "")
        original_reason = event.get("original_reason", "")
        score_delta = event.get("score_delta", 0)
        ts = parse_timestamp(event.get("timestamp", 0))
        note = event.get("note", "")
        tags = event.get("category_tags", [])
        
        # 构建Bitable字段
        category = determine_category(reason_code, original_reason, score_delta)
        source = determine_source(tags, event.get("operator", ""))
        
        # 原因字段：优先用note，否则用original_reason
        reason_text = original_reason if original_reason else ""
        if note:
            if reason_text:
                reason_text = f"{reason_text}（{note}）"
            else:
                reason_text = note
        
        fields = {
            "操行分管理系统v2": event.get("event_id", ""),
            "学生姓名": student_name,
            "日期": ts,
            "原因": reason_text,
            "分值": score_delta,
            "类别": category,
            "来源": source,
        }
        if note:
            fields["备注"] = note
        
        key = f"{ts}|{student_name}|{reason_text}|{score_delta}"
        if key in existing_records:
            # 已存在，更新evidence_ref
            event["evidence_ref"] = f"bitable:{existing_records[key]}"
            log(f"  已存在: {student_name} {reason_text} -> {event['event_id']}")
        else:
            to_sync.append((event, fields))
    
    log(f"待同步: {len(to_sync)} 条事件")
    if not to_sync:
        log("无需同步，完成。")
        return -1  # -1表示无变化
    
    # 4. 批量写入Bitable
    synced = 0
    failed = 0
    for i, (event, fields) in enumerate(to_sync):
        try:
            rid = create_bitable_record(token, BITABLE_EVENTS_TABLE, fields)
            event["evidence_ref"] = f"bitable:{rid}"
            synced += 1
            log(f"  ✅ [{i+1}/{len(to_sync)}] {fields['学生姓名']} {fields.get('原因','')} ({fields['分值']}分) -> {rid}")
        except Exception as e:
            failed += 1
            log(f"  ❌ [{i+1}/{len(to_sync)}] {fields['学生姓名']} {fields.get('原因','')}: {e}")
        
        # 每20条稍等，避免限流
        if (i + 1) % 20 == 0:
            time.sleep(1)
    
    # 5. 更新events.json中的evidence_ref
    save_events(events)
    
    log(f"同步完成: 成功{synced}条, 失败{failed}条")
    return failed if failed else (0 if synced else -1)


def save_events(events):
    """保存更新后的events.json"""
    with open(EVENTS_JSON, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2)
    log("events.json evidence_ref 已更新")


def sync_overview():
    """更新学生操行分总览表"""
    log("=" * 60)
    log("同步学生操行分总览表开始")
    
    # 1. 读取EAA事件数据
    with open(EVENTS_JSON, "r", encoding="utf-8") as f:
        events = json.load(f)
    with open(ENTITIES_JSON, "r", encoding="utf-8") as f:
        entities_data = json.load(f)["entities"]
    
    log(f"EAA事件库: {len(events)} 条")
    
    # 2. 计算每个学生的统计数据
    name_to_id = {v["name"]: k for k, v in entities_data.items()}
    student_stats = defaultdict(lambda: {
        "bonus_count": 0, "deduct_count": 0,
        "bonus_total": 0.0, "deduct_total": 0.0,
        "score": 100.0, "events": []
    })
    
    for event in events:
        if not event.get("is_valid", True):
            continue
        entity_id = event.get("entity_id", "")
        score_delta = event.get("score_delta", 0)
        ts = parse_timestamp(event.get("timestamp", 0))
        student_name = entities_data.get(entity_id, {}).get("name", entity_id)
        
        s = student_stats[student_name]
        s["score"] += score_delta
        s["events"].append({"ts": ts, "delta": score_delta})
        if score_delta > 0:
            s["bonus_count"] += 1
            s["bonus_total"] += score_delta
        else:
            s["deduct_count"] += 1
            s["deduct_total"] += abs(score_delta)
    
    log(f"共计算 {len(student_stats)} 名学生的统计")
    
    # 3. 获取总览表现有记录
    token = get_tenant_token()
    existing = get_all_students_scores(token)
    log(f"总览表现有记录: {len(existing)} 人")
    
    # 4. 更新每个学生的记录
    updated = 0
    created = 0
    for name, stats in sorted(student_stats.items()):
        # 计算最后变动日期
        last_event_ts = max(e["ts"] for e in stats["events"]) if stats["events"] else None
        
        # 计算风险标签
        score = stats["score"]
        if score < 60:
            risk = "极高"
        elif score < 80:
            risk = "高"
        elif score < 100:
            risk = "中"
        else:
            risk = "正常"
        
        fields = {
            "姓名": name,
            "当前总分": round(score, 1),
            "基础分": 100,
            "累计加分": round(stats["bonus_total"], 1),
            "累计扣分": round(stats["deduct_total"], 1),
            "加分次数": stats["bonus_count"],
            "扣分次数": stats["deduct_count"],
            "风险标签": risk,
        }
        if last_event_ts:
            fields["最后变动日期"] = last_event_ts
        
        if name in existing:
            # 更新现有记录
            try:
                update_bitable_record(token, BITABLE_SCORES_TABLE, existing[name]["record_id"], fields)
                updated += 1
            except Exception as e:
                log(f"  ❌ 更新 {name} 失败: {e}")
        else:
            # 新建记录
            try:
                create_bitable_record(token, BITABLE_SCORES_TABLE, fields)
                created += 1
            except Exception as e:
                log(f"  ❌ 创建 {name} 失败: {e}")
        
        if (updated + created) % 20 == 0:
            time.sleep(1)
    
    log(f"总览表更新完成: 更新{updated}人, 新增{created}人")


def main():
    """主函数"""
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    SYNC_STATE = os.path.join(os.environ.get("EAA_DATA_DIR", "./data"), "sync_state.json")
    
    start = time.time()
    log("=" * 60)
    log("EAA → 飞书Bitable v2 自动同步 启动")
    
    try:
        # Step 1: 同步事件明细
        synced = sync_events()
        
        # Step 2: 更新总览表（仅当有事件变更时）
        if synced != -1:  # -1 = 无新事件
            sync_overview()
        else:
            log("无新事件需同步，跳过总览表更新")
        
        elapsed = time.time() - start
        
        if synced and synced > 0:
            log(f"⚠️ 全量同步完成（失败{synced}条），耗时: {elapsed:.1f}秒")
            return 1
        elif synced == -1:
            log(f"✅ 无需同步（耗时{elapsed:.1f}秒）")
        else:
            log(f"✅ 全量同步完成，耗时: {elapsed:.1f}秒")
        return 0
    except Exception as e:
        elapsed = time.time() - start
        log(f"❌ 同步失败（耗时{elapsed:.1f}秒）: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
