//! dispatch_cached 缓存一致性测试 — 防止 invalidate 失效导致读到脏数据。
//!
//! 核心场景:
//!   1. 连续只读 → 同一快照 (Arc clone, 无文件 IO)
//!   2. 写后 → 下次读必须看到新数据 (invalidate 必须触发)
//!   3. agent_runner 风格的"先 read → write → read" 链路正确性

mod common;

use common::*;
use ea_tauri::tools::data_cache::DataCache;
use ea_tauri::tools::eaa_tools::dispatch_cached;
use serde_json::json;

/// 连续两次只读应该拿到同一份快照 (Arc 引用, 内容一致)。
#[test]
fn test_cache_consistency_within_round() {
    let _g = lock();
    let _dir = setup_data_dir();
    let cache = DataCache::new();
    let caps = vec!["write".to_string(), "read".to_string()];

    // 初始写入一个学生
    dispatch_cached("add_student", &json!({"name": "CacheAlice"}), &caps, &cache).unwrap();

    // 连续 3 次只读: list_students → score → ranking
    let r1 = dispatch_cached("list_students", &json!({}), &caps, &cache).unwrap();
    let r2 = dispatch_cached("list_students", &json!({}), &caps, &cache).unwrap();
    let r3 = dispatch_cached("list_students", &json!({}), &caps, &cache).unwrap();

    // 内容必须完全一致
    assert_eq!(r1, r2);
    assert_eq!(r2, r3);
    // 且包含刚加的学生
    let students = r1["students"].as_array().unwrap();
    assert_eq!(students.len(), 1);
    assert_eq!(students[0]["name"], "CacheAlice");
}

/// 写操作后必须 invalidate, 下次只读能看到新数据 (核心一致性)。
#[test]
fn test_cache_invalidate_after_write() {
    let _g = lock();
    let _dir = setup_data_dir();
    let cache = DataCache::new();
    let caps = vec!["write".to_string(), "read".to_string()];

    // 1. 先 add_event (触发 invalidate)
    dispatch_cached(
        "add_event",
        &json!({"name": "CacheBob", "reasonCode": "HOMEWORK", "delta": 5.0}),
        &caps,
        &cache,
    )
    .unwrap();

    // 2. 预热缓存: 读 score
    let s1 = dispatch_cached("score", &json!({"name": "CacheBob"}), &caps, &cache).unwrap();
    let baseline = s1["score"].as_f64().unwrap();
    assert!(baseline >= 105.0, "baseline 应包含 +5, got {baseline}");

    // 3. 再次 add_event (触发 invalidate)
    dispatch_cached(
        "add_event",
        &json!({"name": "CacheBob", "reasonCode": "HOMEWORK", "delta": 3.0}),
        &caps,
        &cache,
    )
    .unwrap();

    // 4. 再次读 score — 必须看到新值 (+8 而非 +5)
    let s2 = dispatch_cached("score", &json!({"name": "CacheBob"}), &caps, &cache).unwrap();
    let updated = s2["score"].as_f64().unwrap();
    assert!(
        updated >= baseline + 3.0,
        "invalidate 后应见到新值, baseline={baseline} updated={updated}"
    );
}

/// 模拟 agent_runner 的执行路径: 先读 → 写 → 再读 (一次 round-trip)。
#[test]
fn test_cache_full_read_write_read_roundtrip() {
    let _g = lock();
    let _dir = setup_data_dir();
    let cache = DataCache::new();
    let caps = vec!["write".to_string(), "read".to_string()];

    // 阶段 1: 写入 3 个学生 (每次都 invalidate)
    for name in ["S1", "S2", "S3"] {
        dispatch_cached("add_student", &json!({"name": name}), &caps, &cache).unwrap();
    }

    // 阶段 2: 连续 5 个只读工具 (验证缓存复用, 内容稳定)
    for _ in 0..5 {
        let r = dispatch_cached("list_students", &json!({}), &caps, &cache).unwrap();
        assert_eq!(r["students"].as_array().unwrap().len(), 3);
    }

    // 阶段 3: 删除一个学生
    dispatch_cached("delete_student", &json!({"name": "S2"}), &caps, &cache).unwrap();

    // 阶段 4: 再次读 — 应只剩 2 个
    let r = dispatch_cached("list_students", &json!({}), &caps, &cache).unwrap();
    let students = r["students"].as_array().unwrap();
    assert_eq!(students.len(), 2, "delete 后 invalidate 必须生效");
    let names: Vec<&str> = students
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"S1"));
    assert!(names.contains(&"S3"));
    assert!(!names.contains(&"S2"));
}

/// 重置事件后 invalidate 必须生效 (回归 bug: reset_events 写入后缓存仍返回旧 events)。
#[test]
fn test_cache_invalidate_after_reset_events() {
    let _g = lock();
    let _dir = setup_data_dir();
    let cache = DataCache::new();
    let caps = vec!["write".to_string(), "read".to_string()];

    dispatch_cached(
        "add_event",
        &json!({"name": "ResetMe", "reasonCode": "HOMEWORK", "delta": 10.0}),
        &caps,
        &cache,
    )
    .unwrap();

    // 预热 stats 缓存
    let s1 = dispatch_cached("stats", &json!({}), &caps, &cache).unwrap();
    assert!(s1["eventCount"].as_u64().unwrap() >= 1);

    // 重置事件
    dispatch_cached("reset_events", &json!({}), &caps, &cache).unwrap();

    // 再次 stats — eventCount 必须为 0
    let s2 = dispatch_cached("stats", &json!({}), &caps, &cache).unwrap();
    assert_eq!(
        s2["eventCount"].as_u64().unwrap(),
        0,
        "reset_events 后 invalidate 必须生效, 否则读到旧 events"
    );
}
