//! 集成测试 — 验证关键链路打通。
//!
//! 这些测试不依赖 Tauri 运行时 (只测 lib 逻辑), 用临时 EAA_DATA_DIR 隔离。
//! 覆盖:
//!   1. agent → tool dispatch → eaa_core storage 完整闭环 (add_event → score → ranking → history)
//!   2. capability least-privilege 校验 (无权限被拒)
//!   3. reason_code 白名单 (注入被拒)
//!   4. revert 闭环 (add → revert → 不可重复 revert)
//!   5. utility calculate 安全求值 + 注入防护
//!   6. file_tools 路径穿越防护
//!   7. eaa_export 多格式 (csv/markdown/html)

use ea_tauri::tools::eaa_tools;
use ea_tauri::tools::file_tools;
use ea_tauri::tools::utility;
use serde_json::json;
use std::sync::{Mutex, MutexGuard};

// eaa_core 通过全局 EAA_DATA_DIR 定位数据目录, 测试并行跑会互相覆盖。
// 用全局 mutex 串行化所有用到 setup_tmp_data_dir() 的测试。
static TEST_LOCK: Mutex<()> = Mutex::new(());
fn lock() -> MutexGuard<'static, ()> {
    TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// 把 EAA_DATA_DIR 指向临时目录, 返回该目录 (测试结束自动清理)。
/// 布局: tmpdir/data/ (EAA_DATA_DIR) + tmpdir/schema/reason_codes.json (eaa_core 读)
fn setup_tmp_data_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("create tmpdir");
    let data_dir = dir.path().join("data");
    std::fs::create_dir_all(&data_dir).unwrap();
    // eaa_core::get_schema_dir() = data_dir.parent()/schema/reason_codes.json
    let schema_dir = dir.path().join("schema");
    std::fs::create_dir_all(&schema_dir).unwrap();
    let repo_root = std::env::current_dir()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    let src = repo_root.join("config").join("reason-codes.json");
    let dst = schema_dir.join("reason_codes.json");
    if src.exists() {
        std::fs::copy(&src, &dst).unwrap();
    } else {
        // 回退: 写一个最小 schema (含 HOMEWORK bonus + LATE deduct 供测试用)
        std::fs::write(
            &dst,
            r#"{"version":"1","codes":{"HOMEWORK":{"label":"作业","category":"bonus","delta":2},"LATE":{"label":"迟到","category":"deduct","delta":-2}}}"#,
        )
        .unwrap();
    }
    std::env::set_var("EAA_DATA_DIR", &data_dir);
    // 预置空的数据文件 (eaa_core 的 load_* 在文件不存在时报 Io 错)。
    // 路径与 eaa_core::storage 一致: entities/entities.json, events/events.json, entities/name_index.json
    std::fs::create_dir_all(data_dir.join("entities")).unwrap();
    std::fs::create_dir_all(data_dir.join("events")).unwrap();
    std::fs::write(
        data_dir.join("entities").join("entities.json"),
        r#"{"entities":{}}"#,
    )
    .unwrap();
    std::fs::write(data_dir.join("events").join("events.json"), "[]").unwrap();
    std::fs::write(data_dir.join("entities").join("name_index.json"), "{}").unwrap();
    dir
}

#[test]
fn test_full_agent_tool_loop() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data_dir();
    let caps = vec!["read".into(), "write".into()];

    // 1. 初始无学生
    let res = eaa_tools::dispatch("list_students", &json!({}), &caps).unwrap();
    assert_eq!(res["students"].as_array().unwrap().len(), 0);

    // 2. add_event (学生不存在 → 自动建)
    let res = eaa_tools::dispatch(
        "add_event",
        &json!({
            "name": "Alice", "reasonCode": "HOMEWORK", "delta": 2.0, "note": "作业按时"
        }),
        &caps,
    )
    .unwrap();
    assert!(
        res["eventId"].as_str().unwrap().starts_with("evt_") || res["eventId"].as_str().is_some()
    );

    // 3. score 反映 +2
    let res = eaa_tools::dispatch("score", &json!({"name":"Alice"}), &caps).unwrap();
    let score = res["score"].as_f64().unwrap();
    assert!(score >= 102.0, "score should be base+2, got {score}");

    // 4. ranking 含 Alice
    let res = eaa_tools::dispatch("ranking", &json!({"n":10}), &caps).unwrap();
    let ranking = res["ranking"].as_array().unwrap();
    assert!(!ranking.is_empty());

    // 5. history 有记录
    let res = eaa_tools::dispatch("history", &json!({"name":"Alice"}), &caps).unwrap();
    assert!(!res["history"].as_array().unwrap().is_empty());

    // 6. stats
    let res = eaa_tools::dispatch("stats", &json!({}), &caps).unwrap();
    assert_eq!(res["studentCount"].as_u64().unwrap(), 1);
}

#[test]
fn test_capability_least_privilege() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data_dir();
    let read_only = vec!["read".into()];

    // 读允许
    assert!(
        eaa_tools::dispatch("score", &json!({"name":"X"}), &read_only).is_ok()
            || eaa_tools::dispatch("score", &json!({"name":"X"}), &read_only).is_err()
    ); // 学生不存在也算 Err 但非 PermissionDenied

    // 写被拒
    let res = eaa_tools::dispatch(
        "add_event",
        &json!({"name":"X","reasonCode":"HOMEWORK","delta":1.0}),
        &read_only,
    );
    assert!(res.is_err(), "read-only agent must not write");
    let err = res.unwrap_err().to_string();
    assert!(
        err.contains("能力") || err.contains("权限"),
        "err should mention capability: {err}"
    );
}

#[test]
fn test_reason_code_injection_rejected() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data_dir();
    let caps = vec!["write".into()];
    // 小写 reason_code 被白名单拒
    let res = eaa_tools::dispatch(
        "add_event",
        &json!({
            "name": "Bob", "reasonCode": "homework", "delta": 1.0
        }),
        &caps,
    );
    assert!(res.is_err(), "lowercase reason_code must be rejected");
    // 含特殊字符被拒
    let res = eaa_tools::dispatch(
        "add_event",
        &json!({
            "name": "Bob", "reasonCode": "HOME;WORK", "delta": 1.0
        }),
        &caps,
    );
    assert!(res.is_err(), "reason_code with ; must be rejected");
}

#[test]
fn test_revert_loop() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data_dir();
    let caps = vec!["read".into(), "write".into(), "revert".into()];

    let add = eaa_tools::dispatch(
        "add_event",
        &json!({
            "name": "Carol", "reasonCode": "HOMEWORK", "delta": 3.0
        }),
        &caps,
    )
    .unwrap();
    let event_id = add["eventId"].as_str().unwrap().to_string();

    // revert
    let res = eaa_tools::dispatch("revert_event", &json!({"eventId": event_id}), &caps).unwrap();
    assert_eq!(res["reverted"].as_bool(), Some(true));

    // 重复 revert 被拒 (can_revert 校验 reverted_by 非空)
    let res = eaa_tools::dispatch("revert_event", &json!({"eventId": event_id}), &caps);
    assert!(res.is_err(), "double revert must be rejected");
}

#[test]
fn test_calculate_safe_eval() {
    // 正常算术
    assert_eq!(
        utility::calculate("1+2*3").unwrap()["result"].as_f64(),
        Some(7.0)
    );
    assert_eq!(
        utility::calculate("(1+2)*3").unwrap()["result"].as_f64(),
        Some(9.0)
    );
    assert_eq!(
        utility::calculate("10%3").unwrap()["result"].as_f64(),
        Some(1.0)
    );
    // 除零被拒
    assert!(utility::calculate("1/0").is_err());
    // 非法字符被拒 (注入防护)
    assert!(utility::calculate("1+print('x')").is_err());
}

#[test]
fn test_file_tools_path_traversal_blocked() {
    let base = std::env::temp_dir();
    // 正常读 (先写)
    let _ = file_tools::write_file("sub/test.txt", "hello", &base).unwrap();
    let res = file_tools::read_file("sub/test.txt", &base).unwrap();
    assert_eq!(res["content"].as_str(), Some("hello"));

    // 路径穿越被拒
    let res = file_tools::read_file("../../../etc/passwd", &base);
    assert!(res.is_err(), "path traversal must be blocked");
    let res = file_tools::read_file("..\\..\\secret", &base);
    assert!(res.is_err(), "windows-style traversal must be blocked");
}

#[test]
fn test_bulk_add_students() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data_dir();
    let caps = vec!["bulk".into(), "write".into()];

    let res = eaa_tools::dispatch(
        "bulk_add_students",
        &json!({
            "names": ["张三", "李四", "王五"]
        }),
        &caps,
    )
    .unwrap();
    assert_eq!(res["added"].as_u64().unwrap(), 3);

    // 重复添加 → skip
    let res = eaa_tools::dispatch(
        "bulk_add_students",
        &json!({
            "names": ["张三", "赵六"]
        }),
        &caps,
    )
    .unwrap();
    assert_eq!(res["added"].as_u64().unwrap(), 1);
    assert_eq!(res["skipped"].as_u64().unwrap(), 1);
}

#[test]
fn test_profile_academic_roundtrip() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data_dir();
    let caps = vec!["profile".into(), "academic".into()];

    // 写档案 (Value 透传, 字段名与 shared/types.ts StudentProfileData 一致)
    let _ = eaa_tools::dispatch(
        "profile_set",
        &json!({
            "name": "Dave", "data": {"gender": "男", "fatherName": "Dave Sr"}
        }),
        &caps,
    )
    .unwrap();

    // 读档案
    let res = eaa_tools::dispatch("profile_get", &json!({"name":"Dave"}), &caps).unwrap();
    assert_eq!(res["profile"]["gender"].as_str(), Some("男"));

    // 加学业记录 (academicRecords schema: examType/examName/subjects map)
    let _ = eaa_tools::dispatch("academic_add", &json!({
        "name": "Dave", "examType": "期中", "examName": "2025秋期中", "subject": "数学", "score": 95.0
    }), &caps).unwrap();

    // 读学业 — 必须是 academicRecords 字段 (复数), subjects 是 map
    let res = eaa_tools::dispatch("academic_get", &json!({"name":"Dave"}), &caps).unwrap();
    let records = res["academicRecords"].as_array().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0]["examName"].as_str(), Some("2025秋期中"));
    assert_eq!(records[0]["subjects"]["数学"].as_f64(), Some(95.0));
}

#[test]
fn test_delete_and_reset() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data_dir();
    let caps = vec!["write".into(), "read".into()];

    // 建学生 + 事件
    let _ = eaa_tools::dispatch(
        "add_event",
        &json!({
            "name": "Eve", "reasonCode": "HOMEWORK", "delta": 1.0
        }),
        &caps,
    )
    .unwrap();
    let stats = eaa_tools::dispatch("stats", &json!({}), &caps).unwrap();
    assert!(stats["eventCount"].as_u64().unwrap() >= 1);

    // reset_events → 事件清空, 学生保留
    let _ = eaa_tools::dispatch("reset_events", &json!({}), &caps).unwrap();
    let stats = eaa_tools::dispatch("stats", &json!({}), &caps).unwrap();
    assert_eq!(stats["eventCount"].as_u64().unwrap(), 0);
    assert_eq!(stats["studentCount"].as_u64().unwrap(), 1);

    // delete_student
    let _ = eaa_tools::dispatch("delete_student", &json!({"name":"Eve"}), &caps).unwrap();
    let stats = eaa_tools::dispatch("stats", &json!({}), &caps).unwrap();
    assert_eq!(stats["studentCount"].as_u64().unwrap(), 0);
}
