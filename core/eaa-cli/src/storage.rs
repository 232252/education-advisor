use crate::types::*;
use fs2::FileExt;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub fn get_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("EAA_DATA_DIR") {
        PathBuf::from(dir)
    } else {
        PathBuf::from("./data")
    }
}

pub fn get_schema_dir() -> PathBuf {
    let data_dir = get_data_dir();
    let candidate = data_dir.parent().map(|p| p.join("schema"));
    if let Some(ref s) = candidate {
        if s.join("reason_codes.json").exists() {
            return s.clone();
        }
    }
    PathBuf::from("./schema")
}

fn get_lock_path() -> PathBuf {
    get_data_dir().join(".lock")
}

/// RAII file lock that auto-releases on Drop
pub struct FileLock {
    _file: fs::File,
}

impl FileLock {
    /// 排他锁 (写操作用): 阻塞所有其他锁 (共享和排他)
    pub fn acquire() -> Result<Self, AppError> {
        let lock_path = get_lock_path();
        if let Some(parent) = lock_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let f = fs::File::create(&lock_path)?;
        f.lock_exclusive()?;
        Ok(Self { _file: f })
    }
}

/// v3.1.9: 共享锁 (读操作用): 允许多个并发读, 但阻塞写操作
/// 用于缓存读取, 确保 rename 不会在读操作进行时发生
pub struct SharedFileLock {
    _file: fs::File,
}

impl SharedFileLock {
    pub fn acquire() -> Result<Self, AppError> {
        let lock_path = get_lock_path();
        if let Some(parent) = lock_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let f = fs::File::create(&lock_path)?;
        f.lock_shared()?;
        Ok(Self { _file: f })
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = self._file.unlock();
    }
}

impl Drop for SharedFileLock {
    fn drop(&mut self) {
        let _ = self._file.unlock();
    }
}

/// v3.1.9: 带 retry 的 rename, 解决 Windows Defender / 文件锁导致 rename 偶发失败的问题
/// 失败时重试最多 30 次, 每次间隔 20ms, 总等待最多 ~600ms (覆盖 193K 事件 ~320ms 的读取时间)
fn rename_with_retry(from: &PathBuf, to: &PathBuf) -> Result<(), AppError> {
    let max_retries = 30;
    let mut last_err = None;
    for attempt in 0..max_retries {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                if attempt < max_retries - 1 {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
            }
        }
    }
    Err(AppError::Io(last_err.unwrap()))
}

pub fn atomic_write_json<T: Serialize + ?Sized>(path: &PathBuf, data: &T) -> Result<(), AppError> {
    let tmp = path.with_extension("tmp");
    let mut f = fs::File::create(&tmp)?;
    let json = serde_json::to_string_pretty(data)?;
    f.write_all(json.as_bytes())?;
    f.sync_all()?;
    rename_with_retry(&tmp, path)?;
    Ok(())
}

pub fn load_entities() -> Result<EntitiesFile, AppError> {
    let path = get_data_dir().join("entities/entities.json");
    let content = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&content)?)
}

/// 事件存储路径:优先用 events.jsonl(增量 append, O(1) 写),
/// 不存在则回退到 events.json(全量重写, O(n) 写)。
/// 首次 add 时由 cmd_add 触发迁移: 读 events.json → 写 events.jsonl → 删 events.json。
fn get_events_path() -> PathBuf {
    let jsonl = get_data_dir().join("events/events.jsonl");
    if jsonl.exists() {
        return jsonl;
    }
    get_data_dir().join("events/events.json")
}

fn get_events_jsonl_path() -> PathBuf {
    get_data_dir().join("events/events.jsonl")
}

fn get_events_json_path() -> PathBuf {
    get_data_dir().join("events/events.json")
}

pub fn load_events() -> Result<Vec<Event>, AppError> {
    let path = get_events_path();
    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        // JSONL: 逐行解析(每行一个 Event JSON)
        let content = fs::read_to_string(&path)?;
        let mut events = Vec::new();
        for (lineno, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str::<Event>(line) {
                Ok(e) => events.push(e),
                Err(_) => {
                    // 跳过损坏行(避免单行错误导致整个文件不可读),记录到 stderr
                    eprintln!("[storage] warn: events.jsonl 第 {} 行解析失败,跳过", lineno + 1);
                }
            }
        }
        Ok(events)
    } else {
        // 旧格式: events.json (数组)
        let content = fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&content)?)
    }
}

/// 增量 append 一个事件到 events.jsonl, O(1) 写入。
/// 如果 jsonl 不存在但 events.json 存在, 先迁移: 读 json → 写 jsonl → 删 json。
pub fn append_event(event: &Event) -> Result<(), AppError> {
    let jsonl_path = get_events_jsonl_path();
    let json_path = get_events_json_path();

    // 迁移: events.json 存在且 events.jsonl 不存在时, 先把 json 转为 jsonl
    if !jsonl_path.exists() && json_path.exists() {
        let old_events = {
            let content = fs::read_to_string(&json_path)?;
            let parsed: Vec<Event> = serde_json::from_str(&content)?;
            parsed
        };
        // 写 jsonl(全量, 一次性)
        {
            fs::create_dir_all(jsonl_path.parent().unwrap())?;
            let mut f = fs::File::create(&jsonl_path)?;
            for e in &old_events {
                let line = serde_json::to_string(e)?;
                f.write_all(line.as_bytes())?;
                f.write_all(b"\n")?;
            }
            f.sync_all()?;
        }
        // 迁移完成, 删除旧 json(失败不阻塞, 后续 load 会优先用 jsonl)
        let _ = fs::remove_file(&json_path);
    }

    // append 新事件
    fs::create_dir_all(jsonl_path.parent().unwrap())?;
    let line = serde_json::to_string(event)?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&jsonl_path)?;
    f.write_all(line.as_bytes())?;
    f.write_all(b"\n")?;
    f.sync_all()?;
    Ok(())
}

pub fn load_name_index() -> Result<HashMap<String, String>, AppError> {
    let path = get_data_dir().join("entities/name_index.json");
    let content = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn load_reason_codes() -> Result<ReasonCodesFile, AppError> {
    let path = get_schema_dir().join("reason_codes.json");
    let content = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn resolve_entity_id(name: &str, index: &HashMap<String, String>) -> Result<String, AppError> {
    index.get(name).cloned().ok_or_else(|| AppError::StudentNotFound(name.to_string()))
}

pub fn compute_scores(entities: &std::collections::HashMap<String, Entity>, events: &[Event]) -> HashMap<String, f64> {
    let mut scores: HashMap<String, f64> = entities.keys().map(|k| (k.clone(), BASE_SCORE)).collect();
    for evt in events {
        // 跳过已撤销事件 (reverted_by 已设置) 和撤销事件本身 (reason_code == "REVERT")
        // 否则会双重计算: 原事件被过滤掉 (-2 不算), revert 事件被计入 (+2 算),
        // 导致分数比预期高 2*|delta|。正确行为: 两者都不参与分数计算。
        if evt.is_valid && evt.reverted_by.is_none() && evt.reason_code != "REVERT" {
            *scores.entry(evt.entity_id.clone()).or_insert(BASE_SCORE) += evt.score_delta;
        }
    }
    scores
}

/// Compute cumulative scores at each event (for history JSON output)
///
/// v3.2.5: 与 `compute_scores` 的有效事件判定完全对齐:
/// - 软删除事件 (is_valid=false): 显示并以 `deleted: true` 标记, 不动累计分
/// - 已撤销事件 (reverted_by=Some): 显示并以 `reverted: true` 标记, 不动累计分
/// - 撤销操作事件 (reason_code=REVERT): 显示, 不动累计分 (它是撤销动作, 不是真实分变动)
/// 仅普通有效事件 (is_valid=true && reverted_by=None && reason_code!=REVERT) 才参与累计。
/// 这样 cumulative 的最终值与 score 命令返回的分数一致, 避免历史/分数显示不一致。
pub fn compute_cumulative_history(
    entity_id: &str,
    events: &[Event],
    base_score: f64,
) -> Vec<serde_json::Value> {
    let mut cum = base_score;
    let mut history = Vec::new();
    for evt in events {
        if evt.entity_id != entity_id { continue; }

        let is_deleted = !evt.is_valid;
        let is_reverted = evt.reverted_by.is_some();
        let is_revert_op = evt.reason_code == "REVERT";
        // 仅普通有效事件才动累计分 (与 compute_scores 一致)
        if !is_deleted && !is_reverted && !is_revert_op {
            cum += evt.score_delta;
        }

        history.push(serde_json::json!({
            "event_id": evt.event_id,
            "timestamp": evt.timestamp,
            "event_type": format!("{:?}", evt.event_type),
            "reason_code": evt.reason_code,
            "score_delta": evt.score_delta,
            "cumulative": cum,
            "note": evt.note,
            "tags": evt.category_tags,
            "reverted": is_reverted,
            "deleted": is_deleted,
        }));
    }
    history
}

pub fn save_events(events: &[Event]) -> Result<(), AppError> {
    // 优先写 jsonl(覆盖式), 兼容旧 json
    let jsonl_path = get_events_jsonl_path();
    let json_path = get_events_json_path();

    // 如果 jsonl 不存在但 json 存在, 删除旧 json(强制迁移到 jsonl)
    if !jsonl_path.exists() && json_path.exists() {
        let _ = fs::remove_file(&json_path);
    }

    fs::create_dir_all(jsonl_path.parent().unwrap())?;
    let tmp = jsonl_path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        for e in events {
            let line = serde_json::to_string(e)?;
            f.write_all(line.as_bytes())?;
            f.write_all(b"\n")?;
        }
        f.sync_all()?;
    }
    fs::rename(&tmp, &jsonl_path)?;
    Ok(())
}

// =============================================================
// v3.1.7 性能优化: revert_event_in_file 流式撤销
//
// 问题: cmd_revert 用 load_events() + save_events() 全量读写
//   192862 事件时 revert ~1765ms (load 320ms + save ~1400ms)
//   是唯一仍需全量 load+save 的写操作
//
// 优化: 只修改目标行 + append 撤销行, 不全量解析和序列化
//   1. 读 events.jsonl 为 String (IO 235ms, 不可避免)
//   2. 逐行扫描找目标 event_id (解析但不收集到 Vec, 省 17 万次 push)
//   3. 找到后: 修改该行 (set reverted_by), 重新序列化仅此 1 行
//   4. append 撤销事件行
//   5. 写回文件 (IO 235ms)
//   预期: ~550ms (3x 提升), 瓶颈从序列化转为纯 IO
//
// 一致性: 与 load_events + save_events 语义完全等价
//   - 目标行 reverted_by 被设置
//   - 撤销事件被 append
//   - 其他行不变
// =============================================================

/// v3.1.7: 流式查找单个事件 (不全量加载到 Vec), 用于 dry_run 等只读场景
pub fn find_event_by_id(event_id: &str) -> Result<Event, AppError> {
    let path = get_events_path();
    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        for (lineno, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() { continue; }
            match serde_json::from_str::<Event>(line) {
                Ok(e) => {
                    if e.event_id == event_id {
                        return Ok(e);
                    }
                }
                Err(_) => {
                    eprintln!("[storage] warn: events.jsonl 第 {} 行解析失败,跳过", lineno + 1);
                }
            }
        }
        Err(AppError::EventNotFound(event_id.to_string()))
    } else {
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        events.into_iter().find(|e| e.event_id == event_id)
            .ok_or_else(|| AppError::EventNotFound(event_id.to_string()))
    }
}

/// 流式撤销: 找到 target_event_id, 调用 build_revert 构建撤销事件, 修改目标行 + append 撤销行
/// build_revert 闭包接收找到的 target Event, 返回 revert Event (或错误, 此时不会写文件)
/// 返回 (原始 target Event, revert Event)
/// 仅支持 jsonl 格式; 旧 json 格式回退到 load_events + save_events
pub fn revert_event_in_file<F>(
    target_event_id: &str,
    build_revert: F,
) -> Result<(Event, Event), AppError>
where
    F: FnOnce(&Event) -> Result<Event, AppError>,
{
    let path = get_events_path();

    // 旧格式 (events.json): 回退到全量 load+save
    if !path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        let mut events: Vec<Event> = serde_json::from_str(&content)?;
        let target_idx = events.iter().position(|e| e.event_id == target_event_id)
            .ok_or_else(|| AppError::EventNotFound(target_event_id.to_string()))?;
        let target = events[target_idx].clone();
        let revert_event = build_revert(&target)?;
        events[target_idx].reverted_by = Some(revert_event.event_id.clone());
        events.push(revert_event.clone());
        save_events(&events)?;
        return Ok((target, revert_event));
    }

    // JSONL: 读为 String, 逐行扫描找目标, 修改仅该行, append 撤销行
    let content = fs::read_to_string(&path)?;
    let bytes = content.as_bytes();

    let mut target_event: Option<Event> = None;
    let mut target_line_start: usize = 0;
    let mut target_line_end: usize = 0;
    let mut found = false;

    let mut pos = 0usize;
    while pos < bytes.len() {
        // 找当前行结束位置 (下一个 \n 或文件末尾)
        let line_end = bytes[pos..].iter().position(|&b| b == b'\n')
            .map(|i| pos + i)
            .unwrap_or(bytes.len());

        // 行内容 [pos, line_end), 可能尾部有 \r
        let mut content_end = line_end;
        if content_end > pos && bytes[content_end - 1] == b'\r' {
            content_end -= 1;
        }

        let line_str = &content[pos..content_end];
        let trimmed = line_str.trim();
        if !trimmed.is_empty() {
            match serde_json::from_str::<Event>(trimmed) {
                Ok(e) => {
                    if e.event_id == target_event_id {
                        target_event = Some(e);
                        target_line_start = pos;
                        target_line_end = line_end; // 包含到 \n 位置
                        found = true;
                        break;
                    }
                }
                Err(_) => {
                    eprintln!("[storage] warn: events.jsonl 行解析失败,跳过");
                }
            }
        }

        pos = if line_end < bytes.len() { line_end + 1 } else { bytes.len() };
    }

    if !found {
        return Err(AppError::EventNotFound(target_event_id.to_string()));
    }

    let target = target_event.unwrap();

    // 调用闭包: 验证 + 构建撤销事件 (验证失败时不会写文件)
    let revert_event = build_revert(&target)?;

    // 修改目标行: set reverted_by, 重新序列化仅此 1 行
    let mut modified = target.clone();
    modified.reverted_by = Some(revert_event.event_id.clone());
    let modified_line = serde_json::to_string(&modified)?;

    // 构建新内容: [目标行之前] + [修改后的目标行] + [目标行之后的全部] + [撤销行]
    let revert_line = serde_json::to_string(&revert_event)?;
    let mut new_content = String::with_capacity(content.len() + revert_line.len() + modified_line.len() + 2);
    new_content.push_str(&content[..target_line_start]);
    new_content.push_str(&modified_line);
    // content[target_line_end..] 从 \n 开始, 保留它作为行分隔
    new_content.push_str(&content[target_line_end..]);
    // 确保末尾有 \n
    if !new_content.ends_with('\n') {
        new_content.push('\n');
    }
    new_content.push_str(&revert_line);
    new_content.push('\n');

    // 原子写 (v3.1.9: rename 带 retry)
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(new_content.as_bytes())?;
        f.sync_all()?;
    }
    rename_with_retry(&tmp, &path)?;

    Ok((target, revert_event))
}

/// v3.2.1: 流式软删除学生事件 — 不全量 load_events 到 Vec
/// 逐行扫描 events.jsonl, 对匹配行原地修改 (is_valid=false + tombstone tag)
/// 返回被软删除的事件数
pub fn soft_delete_events_for_entity(entity_id: &str, tombstone_tag: &str) -> Result<usize, AppError> {
    let path = get_events_path();

    if !path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        // 旧格式 (events.json): 回退到全量 load+save
        let content = fs::read_to_string(&path)?;
        let mut events: Vec<Event> = serde_json::from_str(&content)?;
        let mut count = 0;
        for evt in events.iter_mut() {
            if evt.entity_id == entity_id && evt.reverted_by.is_none() && evt.is_valid {
                evt.is_valid = false;
                evt.category_tags.push(tombstone_tag.to_string());
                count += 1;
            }
        }
        save_events(&events)?;
        return Ok(count);
    }

    // JSONL: 读为 String, 逐行扫描+修改匹配行, 不收集到 Vec
    let content = fs::read_to_string(&path)?;
    let bytes = content.as_bytes();

    let mut modified_count = 0usize;
    let mut new_content = String::with_capacity(content.len() + 1024);
    let mut pos = 0usize;

    while pos < bytes.len() {
        let line_end = bytes[pos..].iter().position(|&b| b == b'\n')
            .map(|i| pos + i)
            .unwrap_or(bytes.len());

        let mut content_end = line_end;
        if content_end > pos && bytes[content_end - 1] == b'\r' {
            content_end -= 1;
        }

        let line_str = &content[pos..content_end];
        let trimmed = line_str.trim();
        if trimmed.is_empty() {
            // 空行直接复制
            new_content.push_str(&content[pos..line_end]);
            if line_end < bytes.len() { new_content.push('\n'); }
        } else {
            match serde_json::from_str::<Event>(trimmed) {
                Ok(mut e) => {
                    if e.entity_id == entity_id && e.reverted_by.is_none() && e.is_valid {
                        // 匹配: 修改此行
                        e.is_valid = false;
                        e.category_tags.push(tombstone_tag.to_string());
                        let modified_line = serde_json::to_string(&e)?;
                        new_content.push_str(&modified_line);
                        modified_count += 1;
                    } else {
                        // 不匹配: 原样复制
                        new_content.push_str(&content[pos..content_end]);
                    }
                }
                Err(_) => {
                    // 解析失败: 原样保留
                    new_content.push_str(&content[pos..content_end]);
                }
            }
            if line_end < bytes.len() { new_content.push('\n'); }
        }

        pos = if line_end < bytes.len() { line_end + 1 } else { bytes.len() };
    }

    // 原子写 (v3.1.9: rename 带 retry)
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(new_content.as_bytes())?;
        f.sync_all()?;
    }
    rename_with_retry(&tmp, &path)?;

    Ok(modified_count)
}

pub fn save_entities(entities: &EntitiesFile) -> Result<(), AppError> {
    let path = get_data_dir().join("entities/entities.json");
    atomic_write_json(&path, entities)
}

pub fn save_name_index(index: &HashMap<String, String>) -> Result<(), AppError> {
    let path = get_data_dir().join("entities/name_index.json");
    atomic_write_json(&path, index)
}

// =============================================================
// v3.1.4 性能优化: scores.cache.json 持久化分数缓存
//
// 问题: 每次 ranking/score 都要 load_events() + compute_scores() 全量重算
//   32294 事件时 ranking=5080ms, score=511ms
//
// 优化: 维护 entity_id -> score 的缓存文件, add-event/revert 增量更新
//   ranking/score 直接读 cache, 不再 load_events
//   预期 ranking 从 5080ms 降到 ~200ms (25x 提升)
//
// 一致性:
//   - cache 丢失/损坏 → 自动从 events 重建
//   - add-event: cache[eid] += delta (事件 is_valid=true, reverted_by=None, reason_code != REVERT)
//   - revert: cache[eid] -= original_delta (原事件被标记 reverted_by, 分数影响移除)
//   - revert 事件本身 reason_code=REVERT 不计入 cache (与 compute_scores 逻辑一致)
// =============================================================

/// scores.cache.json 路径
fn get_scores_cache_path() -> PathBuf {
    get_data_dir().join("entities/scores.cache.json")
}

/// 读取分数缓存。文件不存在/损坏返回空 HashMap(调用方负责重建)
/// v3.1.9: 使用共享锁, 防止读操作期间被写操作的 rename 打断
pub fn load_scores_cache() -> Result<HashMap<String, f64>, AppError> {
    let _lock = SharedFileLock::acquire()?;
    load_scores_cache_nolock()
}

/// 无锁版本, 仅供已持有 FileLock 的写操作内部调用 (避免死锁)
pub fn load_scores_cache_nolock() -> Result<HashMap<String, f64>, AppError> {
    let path = get_scores_cache_path();
    if !path.exists() {
        return Ok(HashMap::new());
    }
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<HashMap<String, f64>>(&content) {
            Ok(m) => Ok(m),
            Err(_) => {
                // 损坏的 cache 文件: 删除并返回空, 让调用方重建
                let _ = fs::remove_file(&path);
                Ok(HashMap::new())
            }
        },
        Err(_) => Ok(HashMap::new()),
    }
}

/// 原子写分数缓存
pub fn save_scores_cache(scores: &HashMap<String, f64>) -> Result<(), AppError> {
    let path = get_scores_cache_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    atomic_write_json(&path, scores)
}

/// 增量更新分数: cache[eid] += delta, 然后写回文件
/// 用于 add-event 后的快速更新(避免下次 ranking 时全量重算)
pub fn update_score_delta(entity_id: &str, delta: f64) -> Result<(), AppError> {
    // v3.1.9: 用 nolock 版本避免与外层 FileLock 死锁
    let mut scores = load_scores_cache_nolock()?;
    let entry = scores.entry(entity_id.to_string()).or_insert(BASE_SCORE);
    *entry += delta;
    save_scores_cache(&scores)
}

/// 增量更新分数(反向): cache[eid] -= delta
/// 用于 revert 后移除原事件分数影响
pub fn revert_score_delta(entity_id: &str, original_delta: f64) -> Result<(), AppError> {
    // v3.1.9: 用 nolock 版本避免与外层 FileLock 死锁
    let mut scores = load_scores_cache_nolock()?;
    let entry = scores.entry(entity_id.to_string()).or_insert(BASE_SCORE);
    *entry -= original_delta;
    save_scores_cache(&scores)
}

// =============================================================
// v3.1.5 性能优化: event_stats.cache.json 事件统计缓存
//
// 问题: cmd_score/cmd_list_students 旧版用 DataContext (全量 load_events, 已废弃)
//   88522 事件时 score=188ms, list-students=286ms
//   但 score 只需 cache + events_count, list-students 只需 cache + events_count
//
// 优化: 维护 entity_id -> {count, last_ts} 的缓存文件
//   score/list-students 用 LightContext + event_stats cache, 不读 events
//   预期 score/list-students 从 188ms/286ms 降到 ~20ms
//
// 一致性:
//   - cache 丢失/损坏 → 自动从 events 重建
//   - add-event: stats[eid].count += 1, last_ts = max(last_ts, new_ts)
//   - revert: stats[eid].count -= 1 (原事件 is_valid=false 不再计入)
// =============================================================

/// 事件统计: (有效事件数, 最后事件时间戳)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EventStats {
    pub count: usize,
    pub last_ts: String,
}

/// event_stats.cache.json 路径
fn get_event_stats_cache_path() -> PathBuf {
    get_data_dir().join("entities/event_stats.cache.json")
}

/// 读取事件统计缓存。文件不存在/损坏返回空 HashMap(调用方负责重建)
/// v3.1.9: 使用共享锁, 防止读操作期间被写操作的 rename 打断
pub fn load_event_stats_cache() -> Result<HashMap<String, EventStats>, AppError> {
    let _lock = SharedFileLock::acquire()?;
    load_event_stats_cache_nolock()
}

/// 无锁版本, 仅供已持有 FileLock 的写操作内部调用 (避免死锁)
pub fn load_event_stats_cache_nolock() -> Result<HashMap<String, EventStats>, AppError> {
    let path = get_event_stats_cache_path();
    if !path.exists() {
        return Ok(HashMap::new());
    }
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<HashMap<String, EventStats>>(&content) {
            Ok(m) => Ok(m),
            Err(_) => {
                let _ = fs::remove_file(&path);
                Ok(HashMap::new())
            }
        },
        Err(_) => Ok(HashMap::new()),
    }
}

/// 原子写事件统计缓存
pub fn save_event_stats_cache(stats: &HashMap<String, EventStats>) -> Result<(), AppError> {
    let path = get_event_stats_cache_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    atomic_write_json(&path, stats)
}

/// 从 events 全量重建事件统计 (流式读取, 不全量加载到 Vec)
pub fn compute_event_stats() -> Result<HashMap<String, EventStats>, AppError> {
    let mut stats: HashMap<String, EventStats> = HashMap::new();
    let path = get_events_path();
    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        for (lineno, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() { continue; }
            match serde_json::from_str::<Event>(line) {
                Ok(e) => {
                    // 只统计有效且未撤销的事件 (与 score 计算逻辑一致)
                    if e.is_valid && e.reverted_by.is_none() && e.reason_code != "REVERT" {
                        let entry = stats.entry(e.entity_id.clone()).or_insert(EventStats {
                            count: 0,
                            last_ts: String::new(),
                        });
                        entry.count += 1;
                        if e.timestamp > entry.last_ts {
                            entry.last_ts = e.timestamp.clone();
                        }
                    }
                }
                Err(_) => {
                    eprintln!("[storage] warn: events.jsonl 第 {} 行解析失败,跳过", lineno + 1);
                }
            }
        }
    } else {
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        for e in &events {
            if e.is_valid && e.reverted_by.is_none() && e.reason_code != "REVERT" {
                let entry = stats.entry(e.entity_id.clone()).or_insert(EventStats {
                    count: 0,
                    last_ts: String::new(),
                });
                entry.count += 1;
                if e.timestamp > entry.last_ts {
                    entry.last_ts = e.timestamp.clone();
                }
            }
        }
    }
    Ok(stats)
}

/// 增量更新事件统计: count += 1, last_ts = max(last_ts, new_ts)
pub fn update_event_stats(entity_id: &str, timestamp: &str) -> Result<(), AppError> {
    // v3.1.9: 用 nolock 版本避免与外层 FileLock 死锁
    let mut stats = load_event_stats_cache_nolock()?;
    let entry = stats.entry(entity_id.to_string()).or_insert(EventStats {
        count: 0,
        last_ts: String::new(),
    });
    entry.count += 1;
    if timestamp > &entry.last_ts {
        entry.last_ts = timestamp.to_string();
    }
    save_event_stats_cache(&stats)
}

/// 增量更新事件统计(反向): count -= 1 (revert 时原事件不再计入)
pub fn revert_event_stats(entity_id: &str) -> Result<(), AppError> {
    // v3.1.9: 用 nolock 版本避免与外层 FileLock 死锁
    let mut stats = load_event_stats_cache_nolock()?;
    if let Some(entry) = stats.get_mut(entity_id) {
        if entry.count > 0 {
            entry.count -= 1;
        }
    }
    save_event_stats_cache(&stats)
}

/// v3.1.5: 流式读取指定学生的事件 (不全量加载到 Vec)
/// 用于 cmd_history, 避免加载全部事件再过滤
pub fn load_events_for_entity(entity_id: &str) -> Result<Vec<Event>, AppError> {
    let path = get_events_path();
    let mut result = Vec::new();
    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        for (lineno, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() { continue; }
            match serde_json::from_str::<Event>(line) {
                Ok(e) => {
                    if e.entity_id == entity_id {
                        result.push(e);
                    }
                }
                Err(_) => {
                    eprintln!("[storage] warn: events.jsonl 第 {} 行解析失败,跳过", lineno + 1);
                }
            }
        }
    } else {
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        for e in events {
            if e.entity_id == entity_id {
                result.push(e);
            }
        }
    }
    Ok(result)
}

// =============================================================
// v3.1.6 性能优化: daily_dedup.cache.json 当天重复检测缓存
//
// 问题: cmd_add 的重复检测每次扫描全部 events.jsonl (192110行 ~235ms)
//   批量录入 25 人时 25*235ms = 5.9s (文件锁串行化)
//
// 优化: 维护 date -> {eid|code -> count} 的缓存文件
//   首次查当天: 扫描一次填充 cache (235ms, 一次性)
//   后续查当天: O(1) 读 cache (<5ms)
//   批量录入 25 人: 第一人 235ms, 后续 24 人各 <5ms, 总 ~350ms (17x 提升)
//
// 一致性:
//   - cache 丢失/损坏 → 回退到 has_duplicate_today 扫描重建
//   - add: cache[date][eid|code] += 1
//   - revert: cache[date][eid|code] -= 1 (原事件不再计入)
//   - 旧日期不清理(每天几百条, 一年几 MB, 可接受)
// =============================================================

fn get_daily_dedup_cache_path() -> PathBuf {
    get_data_dir().join("entities/daily_dedup.cache.json")
}

/// daily_dedup cache: date -> (eid|code -> count)
/// v3.1.9: 使用共享锁, 防止读操作期间被写操作的 rename 打断
fn load_daily_dedup_cache() -> Result<HashMap<String, HashMap<String, usize>>, AppError> {
    let _lock = SharedFileLock::acquire()?;
    load_daily_dedup_cache_nolock()
}

/// 无锁版本, 仅供已持有 FileLock 的写操作内部调用 (避免死锁)
fn load_daily_dedup_cache_nolock() -> Result<HashMap<String, HashMap<String, usize>>, AppError> {
    let path = get_daily_dedup_cache_path();
    if !path.exists() {
        return Ok(HashMap::new());
    }
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<HashMap<String, HashMap<String, usize>>>(&content) {
            Ok(m) => Ok(m),
            Err(_) => {
                let _ = fs::remove_file(&path);
                Ok(HashMap::new())
            }
        },
        Err(_) => Ok(HashMap::new()),
    }
}

fn save_daily_dedup_cache(cache: &HashMap<String, HashMap<String, usize>>) -> Result<(), AppError> {
    let path = get_daily_dedup_cache_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    atomic_write_json(&path, cache)
}

/// 扫描全部事件, 构建指定日期的 eid|code -> count 映射 (一次性, 用于填充 cache)
fn scan_daily_dedup(date: &str) -> Result<HashMap<String, usize>, AppError> {
    let path = get_events_path();
    let mut map: HashMap<String, usize> = HashMap::new();
    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        for (lineno, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() { continue; }
            match serde_json::from_str::<Event>(line) {
                Ok(e) => {
                    if e.timestamp.starts_with(date) && e.reverted_by.is_none() && e.reason_code != "REVERT" {
                        let key = format!("{}|{}", e.entity_id, e.reason_code);
                        *map.entry(key).or_insert(0) += 1;
                    }
                }
                Err(_) => {
                    eprintln!("[storage] warn: events.jsonl 第 {} 行解析失败,跳过", lineno + 1);
                }
            }
        }
    } else {
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        for e in &events {
            if e.timestamp.starts_with(date) && e.reverted_by.is_none() && e.reason_code != "REVERT" {
                let key = format!("{}|{}", e.entity_id, e.reason_code);
                *map.entry(key).or_insert(0) += 1;
            }
        }
    }
    Ok(map)
}

/// 检查当天是否已有重复事件 (O(1) cache 查询, 首次扫描填充)
pub fn check_daily_dedup(entity_id: &str, reason_code: &str, today: &str) -> Result<bool, AppError> {
    let mut cache = load_daily_dedup_cache()?;
    // 首次查当天: 一次性扫描构建完整映射, 之后当天都 O(1)
    if !cache.contains_key(today) {
        let day_map = scan_daily_dedup(today)?;
        cache.insert(today.to_string(), day_map);
        save_daily_dedup_cache(&cache)?;
    }
    let key = format!("{}|{}", entity_id, reason_code);
    let count = cache.get(today).and_then(|m| m.get(&key)).copied().unwrap_or(0);
    Ok(count > 0)
}

/// add 后增量更新: cache[date][eid|code] += 1
pub fn update_daily_dedup(entity_id: &str, reason_code: &str, today: &str) -> Result<(), AppError> {
    // v3.1.9: 用 nolock 版本避免与外层 FileLock 死锁
    let mut cache = load_daily_dedup_cache_nolock()?;
    let key = format!("{}|{}", entity_id, reason_code);
    let day = cache.entry(today.to_string()).or_insert_with(HashMap::new);
    *day.entry(key).or_insert(0) += 1;
    save_daily_dedup_cache(&cache)
}

/// revert 后增量更新: cache[date][eid|code] -= 1 (原事件不再计入)
pub fn revert_daily_dedup(entity_id: &str, reason_code: &str, date: &str) -> Result<(), AppError> {
    // v3.1.9: 用 nolock 版本避免与外层 FileLock 死锁
    let mut cache = load_daily_dedup_cache_nolock()?;
    if let Some(day) = cache.get_mut(date) {
        let key = format!("{}|{}", entity_id, reason_code);
        if let Some(count) = day.get_mut(&key) {
            if *count > 0 { *count -= 1; }
        }
    }
    save_daily_dedup_cache(&cache)
}

/// v3.1.5: 流式统计事件 (用于 cmd_summary, 不全量加载到 Vec)
/// 返回 (valid_events_count, bonus_count, deduct_count, bonus_total, deduct_total, code_counts)
pub fn stream_event_summary(
    since: Option<&str>,
    until: Option<&str>,
) -> Result<(usize, usize, usize, f64, f64, HashMap<String, usize>), AppError> {
    let path = get_events_path();
    let mut total = 0usize;
    let mut bonus_count = 0usize;
    let mut deduct_count = 0usize;
    let mut bonus_total = 0.0f64;
    let mut deduct_total = 0.0f64;
    let mut code_counts: HashMap<String, usize> = HashMap::new();

    let process_event = |e: &Event,
                         total: &mut usize,
                         bonus_count: &mut usize,
                         deduct_count: &mut usize,
                         bonus_total: &mut f64,
                         deduct_total: &mut f64,
                         code_counts: &mut HashMap<String, usize>| {
        if !e.is_valid || e.reverted_by.is_some() { return; }
        let date = if e.timestamp.len() >= 10 { &e.timestamp[..10] } else { "" };
        if let Some(s) = since { if date < s { return; } }
        if let Some(u) = until { if date > u { return; } }
        *total += 1;
        if e.score_delta > 0.0 {
            *bonus_count += 1;
            *bonus_total += e.score_delta;
        } else if e.score_delta < 0.0 {
            *deduct_count += 1;
            *deduct_total += e.score_delta;
        }
        *code_counts.entry(e.reason_code.clone()).or_insert(0) += 1;
    };

    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        for (lineno, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() { continue; }
            match serde_json::from_str::<Event>(line) {
                Ok(e) => process_event(&e, &mut total, &mut bonus_count, &mut deduct_count, &mut bonus_total, &mut deduct_total, &mut code_counts),
                Err(_) => {
                    eprintln!("[storage] warn: events.jsonl 第 {} 行解析失败,跳过", lineno + 1);
                }
            }
        }
    } else {
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        for e in &events {
            process_event(e, &mut total, &mut bonus_count, &mut deduct_count, &mut bonus_total, &mut deduct_total, &mut code_counts);
        }
    }
    Ok((total, bonus_count, deduct_count, bonus_total, deduct_total, code_counts))
}

/// v3.1.7: 快速统计事件数 (只数行数, 不解析), 用于 cmd_info
pub fn count_events() -> Result<usize, AppError> {
    let path = get_events_path();
    if !path.exists() { return Ok(0); }
    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        // JSONL: 数非空行数, 不解析 (O(n) IO 但无解析开销)
        let content = fs::read_to_string(&path)?;
        Ok(content.lines().filter(|l| !l.trim().is_empty()).count())
    } else {
        // 旧 JSON: 需要解析才能数
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        Ok(events.len())
    }
}

/// v3.1.7: 流式验证事件 (不全量加载到 Vec), 用于 cmd_validate
/// 193K 事件时从 ~342ms 降到 ~250ms (省去 Vec 分配)
/// 返回 (total_events, errors, warnings)
pub fn stream_validate(
    entity_ids: &std::collections::HashSet<String>,
    code_keys: &std::collections::HashSet<String>,
) -> Result<(usize, Vec<String>, Vec<String>), AppError> {
    let path = get_events_path();
    let mut total = 0usize;
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        for (lineno, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() { continue; }
            match serde_json::from_str::<Event>(line) {
                Ok(e) => {
                    total += 1;
                    if !code_keys.contains(&e.reason_code) {
                        errors.push(format!("{} unknown reason_code: {}", e.event_id, e.reason_code));
                    }
                    if e.entity_id.is_empty() {
                        errors.push(format!("{} empty entity_id", e.event_id));
                    }
                    if !entity_ids.contains(&e.entity_id) {
                        errors.push(format!("{} unknown entity_id: {}", e.event_id, e.entity_id));
                    }
                    if e.reverted_by.is_none() && (e.score_delta < -50.0 || e.score_delta > 50.0) {
                        warnings.push(format!("{} extreme delta: {:+.1}", e.event_id, e.score_delta));
                    }
                }
                Err(_) => {
                    errors.push(format!("line {} parse error", lineno + 1));
                }
            }
        }
    } else {
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        for e in &events {
            total += 1;
            if !code_keys.contains(&e.reason_code) {
                errors.push(format!("{} unknown reason_code: {}", e.event_id, e.reason_code));
            }
            if e.entity_id.is_empty() {
                errors.push(format!("{} empty entity_id", e.event_id));
            }
            if !entity_ids.contains(&e.entity_id) {
                errors.push(format!("{} unknown entity_id: {}", e.event_id, e.entity_id));
            }
            if e.reverted_by.is_none() && (e.score_delta < -50.0 || e.score_delta > 50.0) {
                warnings.push(format!("{} extreme delta: {:+.1}", e.event_id, e.score_delta));
            }
        }
    }
    Ok((total, errors, warnings))
}

/// v3.2.2: 流式诊断检查 (不全量加载到 Vec), 用于 cmd_doctor
/// 3 项检查在一次流式扫描中完成:
///   1. 孤立事件 (entity_id 无对应实体)
///   2. 批量异常 (单分钟事件数, 返回最大值供调用方判断)
///   3. event_id 重复
/// 返回 (total_events, orphan_count, max_batch_per_minute, dup_id_count)
/// 200K 事件时避免 ~200MB Vec 分配, 内存仅 ts_counts HashMap (每分钟一个 entry)
pub fn stream_doctor_check(
    entity_ids: &std::collections::HashSet<String>,
) -> Result<(usize, usize, usize, usize), AppError> {
    let path = get_events_path();
    let mut total = 0usize;
    let mut orphan_events = 0usize;
    let mut dup_ids = 0usize;
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut ts_counts: HashMap<String, usize> = HashMap::new();

    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            match serde_json::from_str::<Event>(line) {
                Ok(e) => {
                    total += 1;
                    if !entity_ids.contains(&e.entity_id) { orphan_events += 1; }
                    if !seen_ids.insert(e.event_id.clone()) { dup_ids += 1; }
                    let ts = if e.timestamp.len() >= 16 { &e.timestamp[..16] } else { &e.timestamp };
                    *ts_counts.entry(ts.to_string()).or_insert(0) += 1;
                }
                Err(_) => { /* 跳过损坏行, load_events 也是跳过 */ }
            }
        }
    } else {
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        for e in &events {
            total += 1;
            if !entity_ids.contains(&e.entity_id) { orphan_events += 1; }
            if !seen_ids.insert(e.event_id.clone()) { dup_ids += 1; }
            let ts = if e.timestamp.len() >= 16 { &e.timestamp[..16] } else { &e.timestamp };
            *ts_counts.entry(ts.to_string()).or_insert(0) += 1;
        }
    }

    let max_batch = ts_counts.values().max().copied().unwrap_or(0);
    Ok((total, orphan_events, max_batch, dup_ids))
}

/// v3.2.8: 检测"孤儿有效事件" — is_valid=true 且 reverted_by=None 且 reason_code!="REVERT"
/// 但所属 entity 已被软删除 (EntityStatus::Deleted)。
///
/// 这种事件通常由以下原因产生:
///   1. cmd_add 在 v3.2.8 之前不检查 entity status, 可向已删除学生添加事件
///   2. 测试脚本先删除学生再添加事件
///
/// 影响: stats.total_delta 包含这些事件的 delta, 但 listStudents 排除已删除学生,
///       导致 stats.total_delta ≠ sum(listStudents.delta), 数据不一致。
///
/// 返回 (orphan_valid_count, orphan_valid_delta_sum, event_ids)
pub fn stream_check_orphan_valid_events(
    deleted_entity_ids: &std::collections::HashSet<String>,
) -> Result<(usize, f64, Vec<String>), AppError> {
    let path = get_events_path();
    let mut count = 0usize;
    let mut delta_sum = 0.0f64;
    let mut event_ids = Vec::new();

    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            if let Ok(e) = serde_json::from_str::<Event>(line) {
                if deleted_entity_ids.contains(&e.entity_id)
                    && e.is_valid
                    && e.reverted_by.is_none()
                    && e.reason_code != "REVERT"
                {
                    count += 1;
                    delta_sum += e.score_delta;
                    event_ids.push(e.event_id.clone());
                }
            }
        }
    } else {
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        for e in &events {
            if deleted_entity_ids.contains(&e.entity_id)
                && e.is_valid
                && e.reverted_by.is_none()
                && e.reason_code != "REVERT"
            {
                count += 1;
                delta_sum += e.score_delta;
                event_ids.push(e.event_id.clone());
            }
        }
    }

    Ok((count, delta_sum, event_ids))
}

pub fn append_operation_log(entry: &serde_json::Value) -> Result<(), AppError> {
    let log_dir = get_data_dir().join("logs");
    fs::create_dir_all(&log_dir)?;
    let log_path = log_dir.join("operations.jsonl");
    let mut f = fs::OpenOptions::new().create(true).append(true).open(log_path)?;
    let line = format!("{}\n", serde_json::to_string(entry)?);
    f.write_all(line.as_bytes())?;
    Ok(())
}

pub fn generate_event_id() -> String {
    let id = uuid::Uuid::new_v4();
    format!("evt_{}", &id.to_string().replace("-", "")[..12])
}

pub fn get_operator(cli_operator: Option<&str>) -> String {
    if let Some(op) = cli_operator {
        return op.to_string();
    }
    if let Ok(op) = std::env::var("EAA_OPERATOR") {
        return op;
    }
    "班主任".to_string()
}

/// Determine risk level from score
pub fn risk_level(score: f64) -> &'static str {
    if score >= 100.0 { "低" }
    else if score >= 80.0 { "中" }
    else if score >= 60.0 { "高" }
    else { "极高" }
}

// =============================================================
// v3.1.9: 全量重建缓存
// 用于修复因 rename 失败导致的缓存不一致
// 重建 scores.cache.json + event_stats.cache.json + daily_dedup.cache.json
// =============================================================

/// 重建所有缓存: scores + event_stats + daily_dedup
/// 返回 (学生数, 事件数)
pub fn rebuild_all_caches() -> Result<(usize, usize), AppError> {
    let _lock = FileLock::acquire()?;
    let entities = load_entities()?;
    let student_count = entities.entities.len();

    // 1. 重建 scores.cache.json
    let events = load_events()?;
    let event_count = events.len();
    let scores = compute_scores(&entities.entities, &events);
    save_scores_cache(&scores)?;

    // 2. 重建 event_stats.cache.json
    let event_stats = compute_event_stats()?;
    save_event_stats_cache(&event_stats)?;

    // 3. 重建 daily_dedup.cache.json
    let daily_dedup = compute_daily_dedup(&events)?;
    save_daily_dedup_cache(&daily_dedup)?;

    Ok((student_count, event_count))
}

/// 从 events 全量重建 daily_dedup cache
/// 格式: date -> (eid|code -> count), 与 scan_daily_dedup 一致
fn compute_daily_dedup(events: &[Event]) -> Result<HashMap<String, HashMap<String, usize>>, AppError> {
    let mut cache: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for e in events {
        if !e.is_valid || e.reverted_by.is_some() || e.reason_code == "REVERT" {
            continue;
        }
        let date = if e.timestamp.len() >= 10 { &e.timestamp[..10] } else { continue };
        let key = format!("{}|{}", e.entity_id, e.reason_code);
        *cache.entry(date.to_string())
            .or_insert_with(HashMap::new)
            .entry(key)
            .or_insert(0) += 1;
    }
    Ok(cache)
}

// =============================================================
// v3.1.8 性能优化: 流式 stats / search / tag / range
//
// 问题: cmd_stats/cmd_search/cmd_tag/cmd_range 旧版用 DataContext::load() (已废弃)
//   全量 load_events (193K 事件 ~320ms Vec 分配 + 解析)
//   cmd_stats: 245ms (主要是 load_events)
//   cmd_search/tag/range: 245ms (load_events) + 少量匹配
//
// 优化: 流式遍历 events.jsonl, 不分配 Vec<Event>
//   - stream_stats: 单次遍历累积所有计数器
//   - stream_filter: 单次遍历, 只把匹配的事件收集到 Vec
//   预期: load 部分从 320ms 降到 ~250ms (省去 Vec 分配/GC)
// =============================================================

/// v3.1.8: 流式统计聚合 (不全量加载 Vec<Event>), 用于 cmd_stats / cmd_tag(空标签)
/// - code_counts / tag_counts: 仅有效事件 (与原 cmd_stats 行为一致)
/// - tag_counts_all: 所有事件的标签计数 (与原 cmd_tag 行为一致, 含 reverted/invalid)
pub struct EventStatsAggregate {
    pub total_events: usize,
    pub valid_events: usize,
    pub reverted_events: usize,
    pub total_delta: f64,
    pub code_counts: HashMap<String, usize>,
    pub tag_counts: HashMap<String, usize>,
    pub tag_counts_all: HashMap<String, usize>,
}

pub fn stream_stats() -> Result<EventStatsAggregate, AppError> {
    let path = get_events_path();
    let mut agg = EventStatsAggregate {
        total_events: 0,
        valid_events: 0,
        reverted_events: 0,
        total_delta: 0.0,
        code_counts: HashMap::new(),
        tag_counts: HashMap::new(),
        tag_counts_all: HashMap::new(),
    };

    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            match serde_json::from_str::<Event>(line) {
                Ok(e) => {
                    agg.total_events += 1;
                    if e.reverted_by.is_some() {
                        agg.reverted_events += 1;
                    }
                    // tag_counts_all: 所有事件 (含 reverted/invalid), 与原 cmd_tag 一致
                    for t in &e.category_tags {
                        *agg.tag_counts_all.entry(t.clone()).or_insert(0) += 1;
                    }
                    if e.is_valid && e.reverted_by.is_none() && e.reason_code != "REVERT" {
                        agg.valid_events += 1;
                        agg.total_delta += e.score_delta;
                        *agg.code_counts.entry(e.reason_code.clone()).or_insert(0) += 1;
                        for t in &e.category_tags {
                            *agg.tag_counts.entry(t.clone()).or_insert(0) += 1;
                        }
                    }
                }
                Err(_) => {}
            }
        }
    } else {
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        for e in &events {
            agg.total_events += 1;
            if e.reverted_by.is_some() {
                agg.reverted_events += 1;
            }
            for t in &e.category_tags {
                *agg.tag_counts_all.entry(t.clone()).or_insert(0) += 1;
            }
            if e.is_valid && e.reverted_by.is_none() && e.reason_code != "REVERT" {
                agg.valid_events += 1;
                agg.total_delta += e.score_delta;
                *agg.code_counts.entry(e.reason_code.clone()).or_insert(0) += 1;
                for t in &e.category_tags {
                    *agg.tag_counts.entry(t.clone()).or_insert(0) += 1;
                }
            }
        }
    }
    Ok(agg)
}

/// v3.1.8: 流式过滤事件 (不全量加载 Vec<Event>), 用于 cmd_search / cmd_tag / cmd_range
/// predicate 返回 true 的事件会被收集到结果 (最多 limit 个, total 计所有匹配)
pub fn stream_filter<F>(
    limit: usize,
    mut predicate: F,
) -> Result<(usize, Vec<Event>), AppError>
where
    F: FnMut(&Event) -> bool,
{
    let path = get_events_path();
    let mut total = 0usize;
    let mut results: Vec<Event> = Vec::new();

    if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
        let content = fs::read_to_string(&path)?;
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            match serde_json::from_str::<Event>(line) {
                Ok(e) => {
                    if predicate(&e) {
                        total += 1;
                        if results.len() < limit {
                            results.push(e);
                        }
                    }
                }
                Err(_) => {}
            }
        }
    } else {
        let content = fs::read_to_string(&path)?;
        let events: Vec<Event> = serde_json::from_str(&content)?;
        for e in &events {
            if predicate(e) {
                total += 1;
                if results.len() < limit {
                    results.push(e.clone());
                }
            }
        }
    }
    Ok((total, results))
}
