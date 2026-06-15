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
        Ok(Self { entities, events, name_index })
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

impl DataCache {
    pub fn new() -> Self {
        Self { inner: Arc::new(RwLock::new(None)) }
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
