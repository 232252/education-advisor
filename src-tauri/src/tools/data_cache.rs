//! 数据快照缓存 — 优化数据层 I/O。
//!
//! 问题: 每个 tool 调用 (score/ranking/stats/search...) 都独立 load_entities +
//! load_events + load_name_index (3 次文件读)。一次 agent 工具循环里可能调 5-10 个
//! 工具, 就是 15-30 次重复 JSON 解析。
//!
//! 解法: DataSnapshot 一次性 load 全部三个文件, 缓存在内存, 同一次工具循环复用。
//! 写操作 (add_event/add_student/...) 通过 invalidate() 标记失效, 下次读时重新 load。
//!
//! 线程安全: Arc<RwLock<Option<DataSnapshot>>>, 读多写少。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use eaa_core::storage;
use eaa_core::types::{EntitiesFile, Event};

/// 内存数据快照 (entities + events + name_index 一次性 load)。
#[derive(Clone)]
pub struct DataSnapshot {
    pub entities: EntitiesFile,
    pub events: Vec<Event>,
    pub name_index: HashMap<String, String>,
}

impl DataSnapshot {
    /// 从 eaa_data 目录一次性 load 三个文件。
    pub fn load() -> Result<Self, String> {
        let entities = storage::load_entities().map_err(|e| e.to_string())?;
        let events = storage::load_events().map_err(|e| e.to_string())?;
        let name_index = storage::load_name_index().map_err(|e| e.to_string())?;
        Ok(Self {
            entities,
            events,
            name_index,
        })
    }

    /// id → name 反向索引。
    pub fn id_to_name(&self) -> HashMap<String, String> {
        eaa_core::types::build_id_to_name(&self.name_index)
    }
}

/// 线程安全的缓存快照。None = 失效, 下次 get() 重新 load。
#[derive(Clone)]
pub struct DataCache {
    inner: Arc<RwLock<Option<DataSnapshot>>>,
}

impl Default for DataCache {
    fn default() -> Self {
        Self::new()
    }
}

impl DataCache {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(None)),
        }
    }

    /// 拿一份当前快照 (若失效则重新 load)。写操作后应调 invalidate()。
    pub fn get(&self) -> Result<DataSnapshot, String> {
        // 快路径: 读锁, 若有缓存直接 clone 返回
        {
            let guard = self.inner.read().map_err(|e| e.to_string())?;
            if let Some(snap) = guard.as_ref() {
                return Ok(snap.clone());
            }
        }
        // 慢路径: 写锁, 重新 load
        let mut guard = self.inner.write().map_err(|e| e.to_string())?;
        // double-check (可能其他线程已 load)
        if let Some(snap) = guard.as_ref() {
            return Ok(snap.clone());
        }
        let snap = DataSnapshot::load()?;
        *guard = Some(snap.clone());
        Ok(snap)
    }

    /// 标记缓存失效 (写操作后调用)。下次 get() 会重新 load。
    pub fn invalidate(&self) {
        if let Ok(mut guard) = self.inner.write() {
            *guard = None;
        }
    }
}

// =============================================================
// 单元测试 — DataCache 失效/重载语义 + DataSnapshot 聚合。
// 覆盖点: 新建 cache 为空 / get 触发 load / invalidate 后重新 load / clone 共享。
//
// 隔离策略: 通过 EAA_DATA_DIR env 指向临时目录。eaa_core::storage 的
// save_entities/save_name_index/save_events 内部读这个 env, 我们借它写合法数据,
// 避免手搓 JSON 漏字段 (Entity 有 status/created_at 必填)。
//
// 串行化: 用 parking_lot::Mutex (不会因 panic 中毒, 比 std Mutex 更稳)。
// EAA_DATA_DIR 是进程级全局 env, 必须串行所有用到它的测试。
// =============================================================
#[cfg(test)]
mod tests {
    use super::*;
    use eaa_core::storage;
    use eaa_core::types::{EntitiesFile, Entity, EntityStatus};
    use parking_lot::Mutex;
    use std::collections::HashMap;
    use std::sync::OnceLock;

    /// 全局互斥锁: 串行所有读写 EAA_DATA_DIR 的测试 (进程级 env)。
    static ENV_GUARD: OnceLock<Mutex<()>> = OnceLock::new();
    fn lock() -> &'static Mutex<()> {
        ENV_GUARD.get_or_init(|| Mutex::new(()))
    }

    /// RAII: 持有锁 + 临时目录, Drop 时恢复 EAA_DATA_DIR。
    struct EnvScope {
        _dir: tempfile::TempDir,
        _guard: parking_lot::MutexGuard<'static, ()>,
    }
    impl Drop for EnvScope {
        fn drop(&mut self) {
            std::env::remove_var("EAA_DATA_DIR");
        }
    }

    /// 在临时目录用 eaa_core 自己的 save_* 写入合法数据 (含必填字段)。
    fn seed() -> EnvScope {
        let guard = lock().lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("EAA_DATA_DIR", dir.path());
        // eaa_core::storage::atomic_write_json 不建父目录,
        // save_entities 写到 {data}/entities/entities.json, 必须先建 entities/。
        std::fs::create_dir_all(dir.path().join("entities")).unwrap();
        std::fs::create_dir_all(dir.path().join("events")).unwrap();
        let mut entities = HashMap::new();
        entities.insert(
            "S001".to_string(),
            Entity {
                id: "S001".into(),
                name: "张三".into(),
                aliases: vec![],
                status: EntityStatus::Active,
                created_at: "2026-01-01T00:00:00Z".into(),
                metadata: HashMap::new(),
                groups: vec![],
                roles: vec![],
                class_id: None,
            },
        );
        storage::save_entities(&EntitiesFile { entities }).expect("save_entities");
        let mut idx = HashMap::new();
        idx.insert("张三".to_string(), "S001".to_string());
        storage::save_name_index(&idx).expect("save_name_index");
        storage::save_events(&[]).expect("save_events");
        EnvScope {
            _dir: dir,
            _guard: guard,
        }
    }

    #[test]
    fn id_to_name_builds_reverse_index() {
        // 纯函数: DataSnapshot::id_to_name 把 {"张三":"S001"} 反转为 {"S001":"张三"}。
        let mut name_index = HashMap::new();
        name_index.insert("张三".to_string(), "S001".to_string());
        name_index.insert("李四".to_string(), "S002".to_string());
        let snap = DataSnapshot {
            entities: EntitiesFile {
                entities: HashMap::new(),
            },
            events: vec![],
            name_index: name_index.clone(),
        };
        let id2name = snap.id_to_name();
        assert_eq!(id2name.get("S001"), Some(&"张三".to_string()));
        assert_eq!(id2name.get("S002"), Some(&"李四".to_string()));
        assert_eq!(id2name.len(), 2);
    }

    #[test]
    fn cache_get_loads_and_caches() {
        let _scope = seed();
        let cache = DataCache::new();
        let snap1 = cache.get().expect("first get");
        assert!(
            snap1.entities.entities.contains_key("S001"),
            "应加载到种子实体"
        );
        // 第二次 get → 命中缓存 (不重新读文件)。
        let snap2 = cache.get().expect("second get");
        assert!(snap2.entities.entities.contains_key("S001"));
    }

    #[test]
    fn invalidate_forces_reload() {
        let _scope = seed();
        let cache = DataCache::new();
        let _ = cache.get().expect("prime");
        cache.invalidate();
        let snap = cache.get().expect("reload");
        assert!(snap.entities.entities.contains_key("S001"));
    }

    #[test]
    fn cache_is_cloneable_and_shares_state() {
        // DataCache 内部 Arc<RwLock<..>>, clone 后共享同一底层缓存。
        let _scope = seed();
        let cache = DataCache::new();
        let cache2 = cache.clone();
        let _ = cache.get().expect("prime cache");
        let snap = cache2.get().expect("shared get");
        assert!(snap.entities.entities.contains_key("S001"));
    }

    #[test]
    fn load_missing_dir_errors() {
        // 数据目录不存在 → load 应返回错误而非 panic。
        let _guard = lock().lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("EAA_DATA_DIR", dir.path().join("nonexistent"));
        let cache = DataCache::new();
        let result = cache.get();
        assert!(result.is_err(), "目录缺失应返回 Err");
    }

    #[test]
    fn new_cache_construction_does_not_panic() {
        // 构造空 cache (不触发 load) 不应 panic, 也不读文件。
        let _guard = lock().lock();
        std::env::remove_var("EAA_DATA_DIR");
        let _cache = DataCache::new();
    }
}
