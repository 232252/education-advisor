//! eaa_tools 集成测试 — 验证 agent 工具调用链路端到端打通。
//!
//! 覆盖:
//!   1. add_student → score → history → ranking 往返 (写入后能正确读出)
//!   2. add_event → search → revert 链路
//!   3. capability 校验 (least-privilege: read agent 不能调 add_event)
//!   4. 命名兼容 (eaa_ 前缀与无前缀)
//!   5. reason_code 白名单 (拒绝非法字符)
//!   6. academic_add → academic_get (academicRecords schema)
//!
//! 通过 EAA_DATA_DIR 环境变量指向临时目录隔离, 测试互不污染。

use ea_tauri::tools::eaa_tools::dispatch;
use serde_json::json;
use std::sync::{Mutex, MutexGuard};

// EAA_DATA_DIR 是全局环境变量, 测试并行会互相覆盖 → 用 mutex 串行化。
static TEST_LOCK: Mutex<()> = Mutex::new(());
fn lock() -> MutexGuard<'static, ()> {
    TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// 准备一个临时数据目录, 返回其路径 (调用方负责清理)。
/// 同时把仓库的 reason-codes.json 复制到 {tmp}/schema/, 让 eaa_core::storage 能校验。
fn setup_temp_data_dir(test_name: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("创建临时目录失败");
    let data = dir.path().join(test_name);
    std::env::set_var("EAA_DATA_DIR", &data);
    // 预建子目录 (eaa_core 的 atomic_write 不建父目录, save_entities 写 entities/entities.json)
    for sub in ["entities", "events", "profiles", "logs", "privacy"] {
        std::fs::create_dir_all(data.join(sub)).ok();
    }
    // 预填空 JSON (eaa_core 的 load_* 在文件不存在时报错, 模拟已 init 状态)
    std::fs::write(data.join("entities/entities.json"), r#"{"entities":{}}"#).ok();
    std::fs::write(data.join("entities/name_index.json"), r#"{}"#).ok();
    std::fs::write(data.join("events/events.json"), "[]").ok();
    // schema 目录 = data 的同级 schema/ → 放真实的 reason-codes.json
    let schema_dir = dir.path().join("schema");
    std::fs::create_dir_all(&schema_dir).ok();
    // 从仓库找 reason-codes.json (config/ 或 core/eaa-cli/schema/)
    let candidates = [
        "../../config/reason-codes.json",
        "../core/eaa-cli/schema/reason_codes.json",
        "../../core/eaa-cli/schema/reason_codes.json",
    ];
    for c in candidates {
        if std::path::Path::new(c).exists() {
            let _ = std::fs::copy(c, schema_dir.join("reason_codes.json"));
            break;
        }
    }
    dir
}

#[test]
fn test_student_add_then_score_history_ranking() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("student_roundtrip");

    // 1. 添加学生
    let r = dispatch(
        "add_student",
        &json!({ "name": "张三" }),
        &["write".to_string()],
    )
    .unwrap();
    assert_eq!(r["name"], "张三");
    assert!(r["id"].as_str().unwrap().starts_with("S_"));

    // 2. 加事件
    let r = dispatch(
        "add_event",
        &json!({ "name": "张三", "reasonCode": "BONUS_VARIABLE", "delta": 5.0, "note": "作业优秀" }),
        &["write".to_string()],
    )
    .unwrap();
    assert!(r["eventId"].as_str().unwrap().starts_with("evt_"));

    // 3. 查分数
    let r = dispatch("score", &json!({ "name": "张三" }), &["read".to_string()]).unwrap();
    assert_eq!(r["name"], "张三");
    // 基础分 100 + 5 = 105
    let score = r["score"].as_f64().unwrap();
    assert!((score - 105.0).abs() < 0.01, "score 应为 105, 实际 {score}");

    // 4. 查历史
    let r = dispatch("history", &json!({ "name": "张三" }), &["read".to_string()]).unwrap();
    assert!(r["history"].is_array());

    // 5. 排行
    let r = dispatch("ranking", &json!({ "n": 10 }), &["read".to_string()]).unwrap();
    assert!(r["ranking"].is_array());
    assert_eq!(r["ranking"][0]["name"], "张三");
}

#[test]
fn test_add_event_search_revert() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("event_chain");

    dispatch(
        "add_student",
        &json!({ "name": "李四" }),
        &["write".to_string()],
    )
    .unwrap();
    let added = dispatch(
        "add_event",
        &json!({ "name": "李四", "reasonCode": "LATE", "delta": -2.0 }),
        &["write".to_string()],
    )
    .unwrap();
    let event_id = added["eventId"].as_str().unwrap().to_string();

    // search 能找到
    let r = dispatch("search", &json!({ "query": "LATE" }), &["read".to_string()]).unwrap();
    assert!(r["count"].as_u64().unwrap() >= 1);

    // revert
    let r = dispatch(
        "revert_event",
        &json!({ "eventId": event_id }),
        &["write".to_string()],
    )
    .unwrap();
    assert_eq!(r["reverted"], true);
}

#[test]
fn test_capability_least_privilege() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("capability");

    dispatch(
        "add_student",
        &json!({ "name": "王五" }),
        &["write".to_string()],
    )
    .unwrap();

    // read agent 不能调 add_event (capability 校验)
    let r = dispatch(
        "add_event",
        &json!({ "name": "王五", "reasonCode": "LATE", "delta": -1.0 }),
        &["read".to_string()], // 只有 read, 没有 write/add_event
    );
    assert!(r.is_err(), "read agent 不应能调 add_event");
    let err = r.unwrap_err().to_string();
    assert!(
        err.contains("缺少") || err.contains("能力"),
        "错误信息应提示权限: {err}"
    );

    // read agent 能调 score
    let r = dispatch("score", &json!({ "name": "王五" }), &["read".to_string()]).unwrap();
    assert_eq!(r["name"], "王五");
}

#[test]
fn test_capability_all_wildcard() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("capability_all");

    dispatch(
        "add_student",
        &json!({ "name": "赵六" }),
        &["*".to_string()],
    )
    .unwrap();
    dispatch(
        "add_event",
        &json!({ "name": "赵六", "reasonCode": "BONUS_VARIABLE", "delta": 3.0 }),
        &["all".to_string()],
    )
    .unwrap();
    let r = dispatch("score", &json!({ "name": "赵六" }), &["*".to_string()]).unwrap();
    assert!((r["score"].as_f64().unwrap() - 103.0).abs() < 0.01);
}

#[test]
fn test_eaa_prefix_compatibility() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("prefix");

    // eaa_ 前缀和无前缀都应工作
    dispatch(
        "eaa_add_student",
        &json!({ "name": "孙七" }),
        &["write".to_string()],
    )
    .unwrap();
    let r = dispatch(
        "eaa_score",
        &json!({ "name": "孙七" }),
        &["read".to_string()],
    )
    .unwrap();
    assert_eq!(r["name"], "孙七");
}

#[test]
fn test_reason_code_whitelist() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("reason_code");

    dispatch(
        "add_student",
        &json!({ "name": "周八" }),
        &["write".to_string()],
    )
    .unwrap();

    // 合法 reason_code (大写字母+下划线)
    let r = dispatch(
        "add_event",
        &json!({ "name": "周八", "reasonCode": "BONUS_VARIABLE", "delta": 1.0 }),
        &["write".to_string()],
    );
    assert!(r.is_ok());

    // 非法 reason_code (含小写字母) — 拒绝
    let r = dispatch(
        "add_event",
        &json!({ "name": "周八", "reasonCode": "evil_code; rm -rf /", "delta": 1.0 }),
        &["write".to_string()],
    );
    assert!(r.is_err(), "非法 reason_code 必须拒绝");
}

#[test]
fn test_academic_add_get_academicrecords_schema() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("academic");

    dispatch(
        "add_student",
        &json!({ "name": "吴九" }),
        &["write".to_string()],
    )
    .unwrap();

    // 模式 A: 单科目追加
    let r = dispatch(
        "academic_add",
        &json!({
            "name": "吴九",
            "examType": "期中",
            "examName": "2025秋期中",
            "subject": "数学",
            "score": 95.0
        }),
        &["academic".to_string()],
    )
    .unwrap();
    assert_eq!(r["name"], "吴九");

    // 读回 — 必须是 academicRecords 字段 (不是 academic!), subjects 是 map
    let r = dispatch(
        "academic_get",
        &json!({ "name": "吴九" }),
        &["academic".to_string()],
    )
    .unwrap();
    assert!(
        r["academicRecords"].is_array(),
        "必须返回 academicRecords 字段"
    );
    let rec = &r["academicRecords"][0];
    assert_eq!(rec["examName"], "2025秋期中");
    assert_eq!(rec["examType"], "期中");
    assert_eq!(rec["subjects"]["数学"], 95.0);
}

#[test]
fn test_stats_codes_summary() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("aggregate");

    dispatch(
        "add_student",
        &json!({ "name": "A" }),
        &["write".to_string()],
    )
    .unwrap();
    dispatch(
        "add_event",
        &json!({ "name": "A", "reasonCode": "BONUS_VARIABLE", "delta": 2.0 }),
        &["write".to_string()],
    )
    .unwrap();

    let r = dispatch("stats", &json!({}), &["read".to_string()]).unwrap();
    assert!(r["studentCount"].as_u64().unwrap() >= 1);

    let r = dispatch("summary", &json!({}), &["read".to_string()]).unwrap();
    assert!(r["eventCount"].as_u64().unwrap() >= 1);
    assert!(r["byCode"].get("BONUS_VARIABLE").is_some());
}

#[test]
fn test_bulk_add_students() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("bulk");

    let r = dispatch(
        "bulk_add_students",
        &json!({ "names": ["甲", "乙", "丙"] }),
        &["bulk".to_string()],
    )
    .unwrap();
    assert_eq!(r["added"], 3);

    // 重复添加 → skip
    let r = dispatch(
        "bulk_add_students",
        &json!({ "names": ["甲", "丁"] }),
        &["bulk".to_string()],
    )
    .unwrap();
    assert_eq!(r["added"], 1);
    assert_eq!(r["skipped"], 1);
}

#[test]
fn test_unknown_tool_rejected() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("unknown");
    let r = dispatch("nonexistent_tool", &json!({}), &["all".to_string()]);
    assert!(r.is_err());
    assert!(r.unwrap_err().to_string().contains("未知工具"));
}

#[test]
fn test_delete_student() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_temp_data_dir("delete");

    dispatch(
        "add_student",
        &json!({ "name": "郑十" }),
        &["write".to_string()],
    )
    .unwrap();
    let r = dispatch(
        "delete_student",
        &json!({ "name": "郑十" }),
        &["delete_student".to_string()],
    )
    .unwrap();
    assert_eq!(r["deleted"], true);

    // 再删 → existed=false
    let r = dispatch(
        "delete_student",
        &json!({ "name": "郑十" }),
        &["delete_student".to_string()],
    )
    .unwrap();
    assert_eq!(r["deleted"], false);
}

// =============================================================
// P0 补测 — 6 个原未覆盖工具
// (这些在 dispatch 中确实可调, 但应直接测私有 fn 保证参数边界等)
// 注意: 这部分用 common/mod.rs 提供的 helper, 因为 setup_temp_data_dir
//       的 cwd 解析在 cargo test 下不可靠。
// =============================================================

// mod common; // 禁用: 与本文件 TEST_LOCK 冲突

#[test]
fn test_delete_by_class() {
    let _g = lock();
    let _dir = setup_temp_data_dir("p0_test");

    let write = vec!["write".to_string()];
    // 加 3 个学生, classId 不同
    dispatch(
        "add_student",
        &json!({"name": "A1", "classId": "三年级一班"}),
        &write,
    )
    .unwrap();
    dispatch(
        "add_student",
        &json!({"name": "A2", "classId": "三年级一班"}),
        &write,
    )
    .unwrap();
    dispatch(
        "add_student",
        &json!({"name": "B1", "classId": "三年级二班"}),
        &write,
    )
    .unwrap();

    // 删 "三年级一班" 全部
    let r = dispatch("delete_by_class", &json!({"classId": "三年级一班"}), &write).unwrap();
    assert_eq!(r["deleted"].as_u64().unwrap(), 2);

    // 验证: 仅 B1 留下
    let r = dispatch("list_students", &json!({}), &["read".to_string()]).unwrap();
    let names: Vec<&str> = r["students"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["B1"]);
}

#[test]
fn test_reset_factory() {
    let _g = lock();
    let _dir = setup_temp_data_dir("p0_test");

    let write = vec!["write".to_string()];
    dispatch("add_student", &json!({"name": "WillBeWiped"}), &write).unwrap();

    let r = dispatch("reset_factory", &json!({}), &write).unwrap();
    assert_eq!(r["reset"], "factory");

    // 列表应为空 (整个 data 目录被删重建)
    let r = dispatch("list_students", &json!({}), &["read".to_string()]).unwrap();
    assert_eq!(r["students"].as_array().unwrap().len(), 0);
}

#[test]
fn test_bulk_add_academics() {
    let _g = lock();
    let _dir = setup_temp_data_dir("p0_test");

    let bulk = vec!["bulk".to_string()];
    let academic = vec!["academic".to_string()];
    dispatch(
        "add_student",
        &json!({"name": "小测"}),
        &["write".to_string()],
    )
    .unwrap();

    let r = dispatch(
        "bulk_add_academics",
        &json!({"records": [
            {"name": "小测", "exam": "期中", "subject": "数学", "score": 92.0},
            {"name": "小测", "exam": "期中", "subject": "语文", "score": 88.0},
            {"name": "小测", "exam": "期中", "subject": "英语", "score": 95.0}
        ]}),
        &bulk,
    )
    .unwrap();
    assert_eq!(r["added"], 3);

    // 读回: 同一 examName 合并到 1 条记录, 含 3 个 subject
    let r = dispatch("academic_get", &json!({"name": "小测"}), &academic).unwrap();
    let records = r["academicRecords"].as_array().unwrap();
    assert_eq!(records.len(), 1, "同 examName 合并为 1 条");
    let subjects = records[0]["subjects"].as_object().unwrap();
    assert_eq!(subjects.len(), 3);
    assert_eq!(subjects["数学"].as_f64().unwrap(), 92.0);
    assert_eq!(subjects["语文"].as_f64().unwrap(), 88.0);
    assert_eq!(subjects["英语"].as_f64().unwrap(), 95.0);
}

#[test]
fn test_bulk_add_events() {
    let _g = lock();
    let _dir = setup_temp_data_dir("p0_test");

    let write = vec!["write".to_string()];
    let bulk = vec!["bulk".to_string()];
    dispatch("add_student", &json!({"name": "周测"}), &write).unwrap();

    let r = dispatch(
        "bulk_add_events",
        &json!({"events": [
            {"name": "周测", "reasonCode": "HOMEWORK", "delta": 2.0},
            {"name": "周测", "reasonCode": "HOMEWORK", "delta": 2.0},
            {"name": "周测", "reasonCode": "LATE", "delta": -2.0}
        ]}),
        &bulk,
    )
    .unwrap();
    assert_eq!(r["added"].as_u64().unwrap(), 3);

    // 分数: 100 + 2 + 2 - 2 = 102
    let r = dispatch("score", &json!({"name": "周测"}), &["read".to_string()]).unwrap();
    let s = r["score"].as_f64().unwrap();
    assert!((s - 102.0).abs() < 0.01, "score 应为 102, got {s}");
}

#[test]
fn test_range_query() {
    let _g = lock();
    let _dir = setup_temp_data_dir("p0_test");

    let write = vec!["write".to_string()];
    dispatch("add_student", &json!({"name": "区间测"}), &write).unwrap();

    // 写 3 个事件
    for _ in 0..3 {
        dispatch(
            "add_event",
            &json!({"name": "区间测", "reasonCode": "HOMEWORK", "delta": 1.0}),
            &write,
        )
        .unwrap();
        // 间隔 5ms, 保证 timestamp 不同
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    // 取一个极宽的时间区间, 应包含全部 3 条
    let r = dispatch(
        "range",
        &json!({"start": "2000-01-01T00:00:00Z", "end": "2100-01-01T00:00:00Z"}),
        &["read".to_string()],
    )
    .unwrap();
    let events = r["events"].as_array().unwrap();
    assert!(
        events.len() >= 3,
        "区间内应至少 3 条事件, got {}",
        events.len()
    );

    // 取一个未来区间, 应为空
    let r = dispatch(
        "range",
        &json!({"start": "2200-01-01T00:00:00Z", "end": "2300-01-01T00:00:00Z"}),
        &["read".to_string()],
    )
    .unwrap();
    assert_eq!(r["events"].as_array().unwrap().len(), 0);
}

#[test]
fn test_codes_lists_all_reason_codes() {
    let _g = lock();
    let _dir = setup_temp_data_dir("p0_test");

    let r = dispatch("codes", &json!({}), &["read".to_string()]).unwrap();
    let codes = r["codes"].as_object().unwrap();

    // 至少应包含仓库 reason-codes.json 里的常见 codes
    // (实际 schema 来自 config/reason-codes.json, 包含 LATE/BONUS_VARIABLE 等 22 项)
    assert!(
        codes.contains_key("LATE"),
        "codes 应含 LATE: {:?}",
        codes.keys().collect::<Vec<_>>()
    );
    assert!(codes.contains_key("BONUS_VARIABLE"));

    // 取一条检查 schema 字段
    let sample = codes.values().next().unwrap();
    assert!(sample["label"].is_string());
    assert!(sample["category"].is_string());
    assert!(sample["delta"].is_number());
}
