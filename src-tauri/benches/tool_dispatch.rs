//! 基准测试 — 工具分发性能: 缓存 vs 无缓存。
//!
//! 运行: cargo +1.95.0 bench --bench tool_dispatch
//! 产物: target/criterion/tool_dispatch/report.html (含火焰图/统计)
//!
//! 预期: dispatch_cached (缓存版) 在"10 个只读工具的循环"场景下
//!       比 dispatch (无缓存) 快 5-10x (消除重复文件 IO + JSON 解析)。

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use ea_tauri::tools::data_cache::DataCache;
use ea_tauri::tools::eaa_tools::{dispatch, dispatch_cached};
use serde_json::json;
use std::sync::Mutex;

/// 临时数据目录 (全局, 避免并行测试互相覆盖)。
static SETUP_LOCK: Mutex<()> = Mutex::new(());

fn setup_data_with_students(n: usize) -> tempfile::TempDir {
    let _g = SETUP_LOCK.lock().unwrap();
    let dir = tempfile::tempdir().expect("tmpdir");
    let data_dir = dir.path().join("data");
    std::fs::create_dir_all(data_dir.join("entities")).unwrap();
    std::fs::create_dir_all(data_dir.join("events")).unwrap();

    // n 个学生
    let mut entities = serde_json::json!({"entities":{}});
    let mut index = serde_json::json!({});
    for i in 0..n {
        let name = format!("学生{i}");
        let id = format!("S_{i:04}");
        entities["entities"][&name] = json!({
            "id": id, "name": name, "aliases": [],
            "status": "ACTIVE",
            "created_at": "2026-01-01T00:00:00Z",
            "metadata": {}, "groups": [], "roles": []
        });
        index[&name] = json!(id);
    }
    std::fs::write(
        data_dir.join("entities").join("entities.json"),
        entities.to_string(),
    )
    .unwrap();
    std::fs::write(
        data_dir.join("entities").join("name_index.json"),
        index.to_string(),
    )
    .unwrap();
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

/// 模拟一次 agent 工具循环里的 10 个只读工具调用。
fn bench_tool_loop_no_cache(c: &mut Criterion) {
    let _dir = setup_data_with_students(50);

    let caps = vec!["all".to_string()];
    let tools: Vec<(&str, serde_json::Value)> = vec![
        ("score", json!({"name":"学生0"})),
        ("ranking", json!({"n":10})),
        ("stats", json!({})),
        ("codes", json!({})),
        ("list_students", json!({})),
        ("summary", json!({})),
        ("score", json!({"name":"学生1"})),
        ("history", json!({"name":"学生2"})),
        ("search", json!({"query":"学生"})),
        ("stats", json!({})),
    ];

    c.bench_function("tool_loop_no_cache_10_calls", |b| {
        b.iter(|| {
            for (name, args) in &tools {
                let _ = black_box(dispatch(name, args, &caps));
            }
        });
    });
}

/// 同样的 10 个只读工具, 但用 dispatch_cached (DataCache 缓存)。
fn bench_tool_loop_cached(c: &mut Criterion) {
    let _dir = setup_data_with_students(50);

    let caps = vec!["all".to_string()];
    let cache = DataCache::new();
    let tools: Vec<(&str, serde_json::Value)> = vec![
        ("score", json!({"name":"学生0"})),
        ("ranking", json!({"n":10})),
        ("stats", json!({})),
        ("codes", json!({})),
        ("list_students", json!({})),
        ("summary", json!({})),
        ("score", json!({"name":"学生1"})),
        ("history", json!({"name":"学生2"})),
        ("search", json!({"query":"学生"})),
        ("stats", json!({})),
    ];

    c.bench_function("tool_loop_cached_10_calls", |b| {
        b.iter(|| {
            for (name, args) in &tools {
                let _ = black_box(dispatch_cached(name, args, &caps, &cache));
            }
        });
    });
}

/// 单个工具调用的开销对比 (不同数据规模)。
fn bench_single_dispatch_by_scale(c: &mut Criterion) {
    let mut group = c.benchmark_group("single_score_dispatch");
    group.sample_size(50);

    for n in [10, 100, 500].iter() {
        let _dir = setup_data_with_students(*n);
        let caps = vec!["all".to_string()];
        let args = json!({"name":"学生0"});

        group.bench_with_input(BenchmarkId::new("no_cache", n), n, |b, _| {
            b.iter(|| {
                let _ = black_box(dispatch("score", &args, &caps));
            });
        });

        let cache = DataCache::new();
        group.bench_with_input(BenchmarkId::new("cached", n), n, |b, _| {
            b.iter(|| {
                let _ = black_box(dispatch_cached("score", &args, &caps, &cache));
            });
        });
    }
    group.finish();
}

criterion_group!(
    benches,
    bench_tool_loop_no_cache,
    bench_tool_loop_cached,
    bench_single_dispatch_by_scale
);
criterion_main!(benches);
