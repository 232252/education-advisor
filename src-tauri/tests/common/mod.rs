//! 测试公共 helper — 抽自 integration.rs / tools_integration.rs / links.rs 的重复样板。
//!
//! 用法:
//! ```ignore
//! mod common;
//! use common::*;
//!
//! #[test]
//! fn my_test() {
//!     let _g = lock();
//!     let _dir = setup_data_dir();
//!     // ... 调用 dispatch / service 方法
//! }
//! ```
//!
//! 设计要点:
//!   - `EAA_DATA_DIR` 是进程级全局变量, 并行测试会互相覆盖。
//!     → 用 `static TEST_LOCK` 串行化所有用到它的测试, 每个测试开头 `let _g = lock();`。
//!   - `TempDir` 必须持有到测试结束 (Drop 时自动清理), 所以返回 `TempDir` 不是 `PathBuf`。
//!   - schema 文件复制从仓库根 `config/reason-codes.json`; 找不到时回退最小 schema。

use std::sync::{Mutex, MutexGuard};

/// 全局测试串行化锁 (EAA_DATA_DIR 是进程级全局变量)。
static TEST_LOCK: Mutex<()> = Mutex::new(());

/// 拿锁 — 测试开头调用, 持有 `_g` 到作用域结束。
pub fn lock() -> MutexGuard<'static, ()> {
    TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// 准备一个临时 EAA 数据目录。返回 `TempDir`, 调用方**必须**持有它到测试结束。
///
/// 目录布局:
/// ```text
/// tmpdir/
/// ├─ data/                        ← 设到 EAA_DATA_DIR
/// │  ├─ entities/
/// │  │  ├─ entities.json (空)
/// │  │  └─ name_index.json ({})
/// │  ├─ events/events.json ([])
/// │  ├─ profiles/
/// │  ├─ logs/
/// │  └─ privacy/
/// └─ schema/reason_codes.json    ← eaa_core 从 EAA_DATA_DIR.parent()/schema/ 找
/// ```
pub fn setup_data_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("create tmpdir");
    let data_dir = dir.path().join("data");
    for sub in ["entities", "events", "profiles", "logs", "privacy"] {
        std::fs::create_dir_all(data_dir.join(sub)).expect("mkdir");
    }
    std::fs::write(
        data_dir.join("entities/entities.json"),
        r#"{"entities":{}}"#,
    )
    .expect("write");
    std::fs::write(data_dir.join("entities/name_index.json"), "{}").expect("write");
    std::fs::write(data_dir.join("events/events.json"), "[]").expect("write");

    // schema 目录: eaa_core::get_schema_dir() = EAA_DATA_DIR.parent()/schema/
    let schema_dir = dir.path().join("schema");
    std::fs::create_dir_all(&schema_dir).expect("mkdir schema");
    let repo_root = std::env::current_dir()
        .expect("cwd")
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let real_schema = repo_root.join("config").join("reason-codes.json");
    let dst = schema_dir.join("reason_codes.json");
    if real_schema.exists() {
        std::fs::copy(&real_schema, &dst).expect("copy reason_codes.json");
    } else {
        // 回退最小 schema (HOMEWORK +LATE +BONUS_VARIABLE +DEDUCT_VARIABLE)
        std::fs::write(
            &dst,
            r#"{"version":"1","codes":{
                "HOMEWORK":{"label":"作业","category":"bonus","delta":2},
                "LATE":{"label":"迟到","category":"deduct","delta":-2},
                "BONUS_VARIABLE":{"label":"奖励","category":"bonus","delta":0},
                "DEDUCT_VARIABLE":{"label":"扣分","category":"deduct","delta":0}
            }}"#,
        )
        .expect("write fallback schema");
    }

    std::env::set_var("EAA_DATA_DIR", &data_dir);
    dir
}

/// JSON 值断言: 实际必须包含期望的所有键值对 (允许有额外键)。
#[allow(dead_code)]
pub fn assert_json_contains(actual: &serde_json::Value, expected: &serde_json::Value) {
    match (actual, expected) {
        (serde_json::Value::Object(a), serde_json::Value::Object(e)) => {
            for (k, v) in e {
                let av = a
                    .get(k)
                    .unwrap_or_else(|| panic!("missing key `{k}` in {actual}"));
                assert_json_contains(av, v);
            }
        }
        (serde_json::Value::Array(a), serde_json::Value::Array(e)) => {
            assert_eq!(
                a.len(),
                e.len(),
                "array length mismatch: {actual:?} vs {e:?}"
            );
            for (i, item) in e.iter().enumerate() {
                assert_json_contains(&a[i], item);
            }
        }
        (a, e) => assert_eq!(a, e, "json mismatch"),
    }
}
