//! 集成测试 — 验证关键链路打通 (不需要 Tauri 运行时, 测纯逻辑层)。
//!
//! 用临时 EAA_DATA_DIR 隔离, 不污染真实数据。

use ea_tauri::tools::eaa_tools;
use ea_tauri::tools::file_tools;
use ea_tauri::tools::utility;
use serde_json::json;
use std::sync::{Mutex, MutexGuard};

// eaa_core 通过全局 EAA_DATA_DIR 环境变量定位数据目录, 测试并行跑会互相覆盖。
// 用一个全局 mutex 串行化所有用到 setup_tmp_data() 的测试。
static TEST_LOCK: Mutex<()> = Mutex::new(());

/// 拿锁 (测试开始时调用, 持有到 _guard 离开作用域)。
fn lock() -> MutexGuard<'static, ()> {
    TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// 把 EAA_DATA_DIR 指向临时目录, 返回 TempDir (调用方必须持有它直到测试结束)。
fn setup_tmp_data() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tmpdir");
    let data_dir = dir.path().join("data");
    std::fs::create_dir_all(data_dir.join("entities")).unwrap();
    std::fs::create_dir_all(data_dir.join("events")).unwrap();
    std::fs::create_dir_all(data_dir.join("profiles")).unwrap();
    std::fs::write(data_dir.join("entities").join("entities.json"), r#"{"entities":{}}"#).unwrap();
    std::fs::write(data_dir.join("entities").join("name_index.json"), "{}").unwrap();
    std::fs::write(data_dir.join("events").join("events.json"), "[]").unwrap();
    // schema
    let schema_dir = dir.path().join("schema");
    std::fs::create_dir_all(&schema_dir).unwrap();
    std::fs::write(
        schema_dir.join("reason_codes.json"),
        r#"{"version":"1","codes":{"HOMEWORK":{"label":"作业","category":"bonus","delta":2},"LATE":{"label":"迟到","category":"deduct","delta":-2}}}"#,
    )
    .unwrap();
    std::env::set_var("EAA_DATA_DIR", &data_dir);
    dir
}

/// 工具 capability 校验: all 应允许所有工具 (用缺参数的 Validation 错误区分 PermissionDenied)。
#[test]
fn test_capability_all_allows_everything() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data();
    let caps = vec!["all".to_string()];
    // score 需要 name 参数, 报 Validation (不是 PermissionDenied) 说明权限通过
    let err = eaa_tools::dispatch("eaa_score", &json!({}), &caps).unwrap_err();
    assert!(err.to_string().contains("缺少参数"), "all 应允许 score, 实际: {err}");
}

/// 工具 capability 校验: read 不应允许写工具。
#[test]
fn test_capability_read_blocks_write() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data();
    let caps = vec!["read".to_string()];
    let err = eaa_tools::dispatch("eaa_add_event", &json!({}), &caps).unwrap_err();
    assert!(err.to_string().contains("缺少调用"), "read 不应允许 add_event: {err}");
}

/// 工具 capability 校验: read 允许只读工具。
#[test]
fn test_capability_read_allows_readonly() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data();
    let caps = vec!["read".to_string()];
    let err = eaa_tools::dispatch("eaa_score", &json!({}), &caps).unwrap_err();
    assert!(!err.to_string().contains("缺少调用"), "read 应允许 score: {err}");
}

/// calculate 工具: 基本四则运算 (参数 key 是 "expression")。
#[test]
fn test_calculate_basic() {
    let r = utility::calculate_value(&json!({ "expression": "2 + 3 * 4" })).unwrap();
    assert_eq!(r["result"], json!(14.0));

    let r = utility::calculate_value(&json!({ "expression": "(2 + 3) * 4" })).unwrap();
    assert_eq!(r["result"], json!(20.0));

    let r = utility::calculate_value(&json!({ "expression": "100 / 4 - 5" })).unwrap();
    assert_eq!(r["result"], json!(20.0));
}

/// calculate 工具: 除以零应报错。
#[test]
fn test_calculate_div_zero() {
    let err = utility::calculate_value(&json!({ "expression": "1 / 0" })).unwrap_err();
    assert!(err.to_string().contains("除以零"));
}

/// calculate 工具: 非法字符应拒绝 (防注入)。
#[test]
fn test_calculate_rejects_injection() {
    let err = utility::calculate_value(&json!({ "expression": "1; rm -rf /" })).unwrap_err();
    assert!(err.to_string().contains("非法字符"));
}

/// get_current_time: 返回有效时间字段。
#[test]
fn test_get_current_time() {
    let t = utility::get_current_time();
    assert!(t.get("iso8601").is_some());
    assert!(t.get("timestampMs").is_some());
}

/// file_tools 路径穿越防护: 拒绝 ../。
#[test]
fn test_file_tools_path_traversal_blocked() {
    let base = std::env::temp_dir().join("ea_traversal_test");
    std::fs::create_dir_all(&base).ok();
    let r = file_tools::read_file("../../../etc/passwd", &base);
    assert!(r.is_err(), "应拒绝路径穿越");
    let _ = std::fs::remove_dir_all(&base);
}

/// file_tools 正常读写。
#[test]
fn test_file_tools_read_write() {
    let base = std::env::temp_dir().join("ea_rw_test");
    std::fs::create_dir_all(&base).ok();

    let w = file_tools::write_file("test.txt", "hello", &base).unwrap();
    assert!(w.get("bytes").is_some());

    let r = file_tools::read_file("test.txt", &base).unwrap();
    assert_eq!(r["content"], json!("hello"));

    let _ = std::fs::remove_dir_all(&base);
}

/// eaa_tools 命名兼容: eaa_ 前缀和无前缀都能识别。
#[test]
fn test_tool_name_compat() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data();
    let caps = vec!["all".to_string()];
    let err1 = eaa_tools::dispatch("score", &json!({}), &caps).unwrap_err();
    let err2 = eaa_tools::dispatch("eaa_score", &json!({}), &caps).unwrap_err();
    assert!(err1.to_string().contains("缺少参数"));
    assert!(err2.to_string().contains("缺少参数"));
}

/// capability 组合: academic 组允许 academic_get。
#[test]
fn test_capability_academic_group() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data();
    let caps = vec!["academic".to_string()];
    let err = eaa_tools::dispatch("eaa_academic_get", &json!({}), &caps).unwrap_err();
    assert!(!err.to_string().contains("缺少调用"), "academic 应允许 academic_get: {err}");
}

/// 完整链路: add_event (写) → score (读) 验证数据真的写进去了。
#[test]
fn test_full_write_read_chain() {
    let _g = lock(); // 串行化 (EAA_DATA_DIR 全局变量)
    let _dir = setup_tmp_data();
    let caps = vec!["all".to_string()];

    // 1. 先加一个学生
    let r = eaa_tools::dispatch("eaa_add_student", &json!({ "name": "张三" }), &caps).unwrap();
    assert_eq!(r["name"], json!("张三"));

    // 2. 加事件 +2
    let r = eaa_tools::dispatch(
        "eaa_add_event",
        &json!({ "name": "张三", "reasonCode": "HOMEWORK", "delta": 2.0, "note": "作业按时" }),
        &caps,
    )
    .unwrap();
    assert_eq!(r["delta"], json!(2.0));

    // 3. 查分数应为 102 (base 100 + 2)
    let r = eaa_tools::dispatch("eaa_score", &json!({ "name": "张三" }), &caps).unwrap();
    assert_eq!(r["score"], json!(102.0), "分数应为 102, 实际: {r}");

    // 4. 排行榜应包含张三
    let r = eaa_tools::dispatch("eaa_ranking", &json!({ "n": 10 }), &caps).unwrap();
    let ranking = r["ranking"].as_array().unwrap();
    assert!(ranking.iter().any(|x| x["name"] == json!("张三")), "排行榜应含张三: {r}");
}

/// 完整链路: revert 后分数恢复。
#[test]
fn test_revert_chain() {
    let _g = lock();
    let _dir = setup_tmp_data();
    let caps = vec!["all".to_string()];

    eaa_tools::dispatch("eaa_add_student", &json!({ "name": "李四" }), &caps).unwrap();
    let r = eaa_tools::dispatch(
        "eaa_add_event",
        &json!({ "name": "李四", "reasonCode": "HOMEWORK", "delta": 3.0 }),
        &caps,
    )
    .unwrap();
    let event_id = r["eventId"].as_str().unwrap().to_string();

    // 分数应为 103
    let r = eaa_tools::dispatch("eaa_score", &json!({ "name": "李四" }), &caps).unwrap();
    assert_eq!(r["score"], json!(103.0));

    // revert
    eaa_tools::dispatch("eaa_revert_event", &json!({ "eventId": event_id }), &caps).unwrap();

    // 分数应恢复 100
    let r = eaa_tools::dispatch("eaa_score", &json!({ "name": "李四" }), &caps).unwrap();
    assert_eq!(r["score"], json!(100.0), "revert 后分数应恢复 100: {r}");
}
