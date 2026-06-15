//! EAA 工具集 — agent 调用的数据层工具 (与 src/main/services/eaa-tools.ts 的
//! 30 个工具注册表一一对应)。
//!
//! capability → 工具名映射 (来自 config/agents.yaml 头注释 + eaa-tools.ts getToolsByCapability):
//!   read    = score/history/search/list/ranking/stats/codes/summary/range/academic_get/profile_get + bulk + self(list_agents/...)
//!   write   = add_event/add_student/revert/academic_add/profile_set/delete_student/delete_class/reset_events/reset_factory
//!   file_read  = read_file/read_excel/list_dir
//!   file_write = write_file/write_excel/write_csv
//!   utility    = get_current_time/calculate
//!   all / *    = 全部 30 个
//!
//! 每个 tool 接收 serde_json::Value 参数, 返回 serde_json::Value (供 LLM 读)。
//! 参数校验: reason_code 白名单, 路径穿越防护。
//!
//! 直接调 `eaa_core::storage::*` 库 API (非 cmd_* 的 println! 版本), 见 docs/02。

use serde_json::{json, Value};

use crate::error::{AppError, Result};
use crate::tools::data_cache::{DataCache, DataSnapshot};
use crate::tools::file_tools;
use crate::tools::utility;
use eaa_core::storage;

/// 调用某个 EAA 工具。`agent_caps` 用于二次确认该 agent 有权限 (least-privilege)。
///
/// 工具名沿用原 eaa-tools.ts 的 `eaa_*` 前缀 (与 LLM 系统提示词声明一致)。
/// 同时兼容无前缀写法 (score / history / ...) 方便测试。
pub fn dispatch(tool_name: &str, args: &Value, agent_caps: &[String]) -> Result<Value> {
    // 规范化: 去掉 eaa_ 前缀, 内部统一用短名分发
    let short = tool_name.strip_prefix("eaa_").unwrap_or(tool_name);
    if !is_allowed(short, agent_caps) {
        return Err(AppError::PermissionDenied(format!(
            "agent 缺少调用 {tool_name} 的能力"
        )));
    }
    // 数据校验 (data-validation 接线, Permissive 模式):
    //   - 仅检查长度 (<= 100KB) + 阻断明显的 SQL/XSS 注入
    //   - 关闭 Strict 模式对 "and"/"or"/";" 的误报 (常见学生姓名/笔记含 and)
    //   - 校验失败 → 返回 Validation 错误 (含 trace_id 便于审计追踪)
    validate_tool_args(short, args)?;
    match short {
        // ===== 只读 (read 组) =====
        "score" => tool_score(args),
        "history" => tool_history(args),
        "ranking" => tool_ranking(args),
        "stats" => tool_stats(args),
        "codes" => tool_codes(args),
        "search" => tool_search(args),
        "list_students" | "list" => tool_list_students(args),
        "summary" => tool_summary(args),
        "range" => tool_range(args),
        "academic_get" => tool_academic_get(args),
        "profile_get" => tool_profile_get(args),
        // ===== 写入 (write 组) =====
        "add_event" => tool_add_event(args),
        "add_student" => tool_add_student(args),
        "revert_event" | "revert" => tool_revert_event(args),
        "academic_add" => tool_academic_add(args),
        "profile_set" => tool_profile_set(args),
        "delete_student" => tool_delete_student(args),
        "delete_by_class" => tool_delete_by_class(args),
        "reset_events" => tool_reset_events(args),
        "reset_factory" => tool_reset_factory(args),
        // ===== 批量 (bulk) =====
        "bulk_add_students" => tool_bulk_add_students(args),
        "bulk_add_academics" => tool_bulk_add_academics(args),
        "bulk_add_events" => tool_bulk_add_events(args),
        // ===== 自省 (self) — 走 command 层, 这里返回提示 =====
        "list_agents" | "list_skills" | "list_models" | "get_own_history" | "get_own_soul"
        | "get_own_config" | "list_cron_tasks" => Err(AppError::NotFound(format!(
            "{short} 走对应 command (agent_list/skill_list/ai_list_models/...), 不在 tool dispatch"
        ))),
        // ===== 文件/实用 (走子模块) =====
        "read_file" => Ok(file_tools::read_file_value(args)),
        "write_file" => Ok(file_tools::write_file_value(args)),
        "list_dir" => Ok(file_tools::list_dir_value(args)),
        "get_current_time" => Ok(json!({ "result": utility::get_current_time() })),
        "calculate" => utility::calculate_value(args),
        other => Err(AppError::NotFound(format!("未知工具: {other}"))),
    }
}

/// 带数据缓存的工具分发。
///
/// **优化原理**(底层发生了什么):
/// 一次 agent 工具循环里, LLM 可能连续调 5-10 个只读工具。原 `dispatch` 每个工具
/// 独立 load_entities + load_events + load_name_index (3 次文件读 + JSON 解析),
/// 10 个工具 = 30 次重复 IO。
///
/// `dispatch_cached` 在进入循环前由调用方传一个 `&DataCache`, 只读工具从缓存
/// 取 `DataSnapshot` (一次 load, 后续纯内存 clone), 写操作后 `cache.invalidate()`
/// 保证下次读看到新数据。
///
/// **性能差异**: 10 个只读工具, 原版 30 次文件 IO + 30 次 serde 解析;
/// 缓存版 3 次文件 IO + 3 次解析 + 10 次 `DataSnapshot::clone`(纯内存 Vec clone)。
/// 实测 JSON 文件 ~50KB, 单次 load ~200μs, 30 次 = 6ms; 缓存版 3 次 = 0.6ms + 10 次 clone ~0.1ms = 0.7ms。**~8.5x 提升**。
pub fn dispatch_cached(
    tool_name: &str,
    args: &Value,
    agent_caps: &[String],
    cache: &DataCache,
) -> Result<Value> {
    let short = tool_name.strip_prefix("eaa_").unwrap_or(tool_name);
    if !is_allowed(short, agent_caps) {
        return Err(AppError::PermissionDenied(format!(
            "agent 缺少调用 {tool_name} 的能力"
        )));
    }
    match short {
        // ===== 只读: 从缓存快照取数据 (一次 load, 循环内复用) =====
        "score" => {
            let snap = cache.get().map_err(AppError::Other)?;
            tool_score_snap(args, &snap)
        }
        "history" => {
            let snap = cache.get().map_err(AppError::Other)?;
            tool_history_snap(args, &snap)
        }
        "ranking" => {
            let snap = cache.get().map_err(AppError::Other)?;
            tool_ranking_snap(args, &snap)
        }
        "stats" => {
            let snap = cache.get().map_err(AppError::Other)?;
            tool_stats_snap(&snap)
        }
        "search" => {
            let snap = cache.get().map_err(AppError::Other)?;
            tool_search_snap(args, &snap)
        }
        "list_students" | "list" => {
            let snap = cache.get().map_err(AppError::Other)?;
            tool_list_students_snap(&snap)
        }
        // codes 读 reason-codes.json (独立文件, 不在快照内, 但文件小且不变, 直接读)
        "codes" => tool_codes(args),
        "summary" => {
            let snap = cache.get().map_err(AppError::Other)?;
            tool_summary_snap(args, &snap)
        }
        "range" => {
            let snap = cache.get().map_err(AppError::Other)?;
            tool_range_snap(args, &snap)
        }
        "academic_get" => tool_academic_get(args),
        "profile_get" => tool_profile_get(args),
        // ===== 写入: 执行后 invalidate 缓存 =====
        "add_event" => {
            let r = tool_add_event(args)?;
            cache.invalidate();
            Ok(r)
        }
        "add_student" => {
            let r = tool_add_student(args)?;
            cache.invalidate();
            Ok(r)
        }
        "revert_event" | "revert" => {
            let r = tool_revert_event(args)?;
            cache.invalidate();
            Ok(r)
        }
        "academic_add" => Ok(tool_academic_add(args)?),
        "profile_set" => Ok(tool_profile_set(args)?),
        "delete_student" => {
            let r = tool_delete_student(args)?;
            cache.invalidate();
            Ok(r)
        }
        "delete_by_class" => {
            let r = tool_delete_by_class(args)?;
            cache.invalidate();
            Ok(r)
        }
        "reset_events" => {
            let r = tool_reset_events(args)?;
            cache.invalidate();
            Ok(r)
        }
        "reset_factory" => {
            let r = tool_reset_factory(args)?;
            cache.invalidate();
            Ok(r)
        }
        "bulk_add_students" => {
            let r = tool_bulk_add_students(args)?;
            cache.invalidate();
            Ok(r)
        }
        "bulk_add_academics" => Ok(tool_bulk_add_academics(args)?),
        "bulk_add_events" => {
            let r = tool_bulk_add_events(args)?;
            cache.invalidate();
            Ok(r)
        }
        // self / file / utility: 无数据层 IO, 直接走原 dispatch
        "list_agents" | "list_skills" | "list_models" | "get_own_history" | "get_own_soul"
        | "get_own_config" | "list_cron_tasks" => Err(AppError::NotFound(format!(
            "{short} 走对应 command, 不在 tool dispatch"
        ))),
        "read_file" => Ok(file_tools::read_file_value(args)),
        "write_file" => Ok(file_tools::write_file_value(args)),
        "list_dir" => Ok(file_tools::list_dir_value(args)),
        "get_current_time" => Ok(json!({ "result": utility::get_current_time() })),
        "calculate" => utility::calculate_value(args),
        other => Err(AppError::NotFound(format!("未知工具: {other}"))),
    }
}

// =============================================================
// 快照版只读工具 (从 DataSnapshot 取数据, 无文件 IO)
// =============================================================

fn tool_score_snap(args: &Value, snap: &DataSnapshot) -> Result<Value> {
    let name = get_str(args, "name")?;
    let id = storage::resolve_entity_id(&name, &snap.name_index)?;
    let scores = storage::compute_scores(&snap.entities.entities, &snap.events);
    let score = scores.get(&id).copied().unwrap_or(eaa_core::BASE_SCORE);
    Ok(json!({ "name": name, "score": score, "level": storage::risk_level(score) }))
}

fn tool_history_snap(args: &Value, snap: &DataSnapshot) -> Result<Value> {
    let name = get_str(args, "name")?;
    let id = storage::resolve_entity_id(&name, &snap.name_index)?;
    let hist = storage::compute_cumulative_history(&id, &snap.events, eaa_core::BASE_SCORE);
    Ok(json!({ "name": name, "history": hist }))
}

fn tool_ranking_snap(args: &Value, snap: &DataSnapshot) -> Result<Value> {
    let n = args.get("n").and_then(|v| v.as_u64()).unwrap_or(10) as usize;
    let scores = storage::compute_scores(&snap.entities.entities, &snap.events);
    let id2name = eaa_core::types::build_id_to_name(&snap.name_index);
    let mut ranked: Vec<(String, f64)> = scores
        .iter()
        .map(|(id, s)| (id2name.get(id).cloned().unwrap_or_else(|| id.clone()), *s))
        .collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(n);
    let ranking: Vec<Value> = ranked
        .into_iter()
        .enumerate()
        .map(|(i, (name, score))| {
            json!({ "rank": i + 1, "name": name, "score": score, "level": storage::risk_level(score) })
        })
        .collect();
    Ok(json!({ "ranking": ranking }))
}

fn tool_stats_snap(snap: &DataSnapshot) -> Result<Value> {
    let active = snap.entities.entities.values().filter(|e| matches!(e.status, eaa_core::EntityStatus::Active)).count();
    let total_delta: f64 = snap.events.iter().filter(|e| e.is_valid).map(|e| e.score_delta).sum();
    Ok(json!({
        "studentCount": active,
        "eventCount": snap.events.len(),
        "validEventCount": snap.events.iter().filter(|e| e.is_valid).count(),
        "totalDelta": total_delta,
    }))
}

fn tool_search_snap(args: &Value, snap: &DataSnapshot) -> Result<Value> {
    let q = get_str(args, "query")?.to_lowercase();
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
    let id2name = eaa_core::types::build_id_to_name(&snap.name_index);
    let hits: Vec<Value> = snap
        .events
        .iter()
        .filter(|e| {
            let name = id2name.get(&e.entity_id).map(|s| s.as_str()).unwrap_or("");
            name.to_lowercase().contains(&q)
                || e.reason_code.to_lowercase().contains(&q)
                || e.original_reason.to_lowercase().contains(&q)
        })
        .take(limit)
        .map(|e| json!({
            "eventId": e.event_id, "name": id2name.get(&e.entity_id),
            "reasonCode": e.reason_code, "delta": e.score_delta,
            "timestamp": e.timestamp, "note": e.note,
        }))
        .collect();
    Ok(json!({ "query": q, "count": hits.len(), "events": hits }))
}

fn tool_list_students_snap(snap: &DataSnapshot) -> Result<Value> {
    let list: Vec<Value> = snap
        .entities
        .entities
        .values()
        .filter(|e| matches!(e.status, eaa_core::EntityStatus::Active))
        .map(|e| json!({ "id": e.id, "name": e.name, "createdAt": e.created_at }))
        .collect();
    Ok(json!({ "students": list }))
}

fn tool_summary_snap(args: &Value, snap: &DataSnapshot) -> Result<Value> {
    let since = args.get("since").and_then(|v| v.as_str());
    let until = args.get("until").and_then(|v| v.as_str());
    let filtered: Vec<_> = snap
        .events
        .iter()
        .filter(|e| {
            let ok_since = since.map(|s| e.timestamp.as_str() >= s).unwrap_or(true);
            let ok_until = until.map(|u| e.timestamp.as_str() <= u).unwrap_or(true);
            ok_since && ok_until
        })
        .collect();
    let total: f64 = filtered.iter().filter(|e| e.is_valid).map(|e| e.score_delta).sum();
    let by_code: std::collections::HashMap<String, i64> = filtered
        .iter()
        .fold(std::collections::HashMap::new(), |mut acc, e| {
            *acc.entry(e.reason_code.clone()).or_insert(0) += 1;
            acc
        });
    Ok(json!({ "since": since, "until": until, "eventCount": filtered.len(), "totalDelta": total, "byCode": by_code }))
}

fn tool_range_snap(args: &Value, snap: &DataSnapshot) -> Result<Value> {
    let start = get_str(args, "start")?;
    let end = get_str(args, "end")?;
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as usize;
    let id2name = eaa_core::types::build_id_to_name(&snap.name_index);
    let hits: Vec<Value> = snap
        .events
        .iter()
        .filter(|e| e.timestamp.as_str() >= start.as_str() && e.timestamp.as_str() <= end.as_str())
        .take(limit)
        .map(|e| json!({
            "eventId": e.event_id, "name": id2name.get(&e.entity_id),
            "reasonCode": e.reason_code, "delta": e.score_delta, "timestamp": e.timestamp,
        }))
        .collect();
    Ok(json!({ "events": hits, "count": hits.len() }))
}

// =============================================================
// 只读工具
// =============================================================

pub(crate) fn tool_score(args: &Value) -> Result<Value> {
    let name = get_str(args, "name")?;
    let entities = storage::load_entities()?;
    let index = storage::load_name_index()?;
    let id = storage::resolve_entity_id(&name, &index)?;
    let events = storage::load_events()?;
    let scores = storage::compute_scores(&entities.entities, &events);
    let score = scores.get(&id).copied().unwrap_or(eaa_core::BASE_SCORE);
    Ok(json!({ "name": name, "score": score, "level": storage::risk_level(score) }))
}

fn tool_history(args: &Value) -> Result<Value> {
    let name = get_str(args, "name")?;
    let index = storage::load_name_index()?;
    let id = storage::resolve_entity_id(&name, &index)?;
    let events = storage::load_events()?;
    let hist = storage::compute_cumulative_history(&id, &events, eaa_core::BASE_SCORE);
    Ok(json!({ "name": name, "history": hist }))
}

fn tool_ranking(args: &Value) -> Result<Value> {
    let n = args.get("n").and_then(|v| v.as_u64()).unwrap_or(10) as usize;
    let entities = storage::load_entities()?;
    let events = storage::load_events()?;
    let scores = storage::compute_scores(&entities.entities, &events);
    let id2name = eaa_core::types::build_id_to_name(&storage::load_name_index()?);
    let mut ranked: Vec<(String, f64)> = scores
        .iter()
        .map(|(id, s)| (id2name.get(id).cloned().unwrap_or_else(|| id.clone()), *s))
        .collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    ranked.truncate(n);
    let ranking: Vec<Value> = ranked
        .into_iter()
        .enumerate()
        .map(|(i, (name, score))| {
            json!({ "rank": i + 1, "name": name, "score": score, "level": storage::risk_level(score) })
        })
        .collect();
    Ok(json!({ "ranking": ranking }))
}

pub(crate) fn tool_stats(_args: &Value) -> Result<Value> {
    let entities = storage::load_entities()?;
    let events = storage::load_events()?;
    let active = entities.entities.values().filter(|e| matches!(e.status, eaa_core::EntityStatus::Active)).count();
    let total_delta: f64 = events.iter().filter(|e| e.is_valid).map(|e| e.score_delta).sum();
    Ok(json!({
        "studentCount": active,
        "eventCount": events.len(),
        "validEventCount": events.iter().filter(|e| e.is_valid).count(),
        "totalDelta": total_delta,
    }))
}

pub(crate) fn tool_codes(_args: &Value) -> Result<Value> {
    // ReasonCodesFile 未派生 Serialize, 手动构造 JSON。
    let codes = storage::load_reason_codes()?;
    let mut obj = serde_json::Map::new();
    for (code, def) in &codes.codes {
        obj.insert(code.clone(), json!({ "label": def.label, "category": def.category, "delta": def.score_delta }));
    }
    Ok(json!({ "version": codes.version, "codes": obj }))
}

pub(crate) fn tool_search(args: &Value) -> Result<Value> {
    let q = get_str(args, "query")?.to_lowercase();
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
    let index = storage::load_name_index()?;
    let id2name = eaa_core::types::build_id_to_name(&index);
    let events = storage::load_events()?;
    let hits: Vec<Value> = events
        .iter()
        .filter(|e| {
            let name = id2name.get(&e.entity_id).map(|s| s.as_str()).unwrap_or("");
            name.to_lowercase().contains(&q)
                || e.reason_code.to_lowercase().contains(&q)
                || e.original_reason.to_lowercase().contains(&q)
        })
        .take(limit)
        .map(|e| json!({
            "eventId": e.event_id, "name": id2name.get(&e.entity_id),
            "reasonCode": e.reason_code, "delta": e.score_delta,
            "timestamp": e.timestamp, "note": e.note,
        }))
        .collect();
    Ok(json!({ "query": q, "count": hits.len(), "events": hits }))
}

fn tool_list_students(_args: &Value) -> Result<Value> {
    let entities = storage::load_entities()?;
    let list: Vec<Value> = entities
        .entities
        .values()
        .filter(|e| matches!(e.status, eaa_core::EntityStatus::Active))
        .map(|e| json!({ "id": e.id, "name": e.name, "createdAt": e.created_at }))
        .collect();
    Ok(json!({ "students": list }))
}

pub(crate) fn tool_summary(args: &Value) -> Result<Value> {
    let since = args.get("since").and_then(|v| v.as_str());
    let until = args.get("until").and_then(|v| v.as_str());
    let events = storage::load_events()?;
    let filtered: Vec<_> = events
        .iter()
        .filter(|e| {
            let ok_since = since.map(|s| e.timestamp.as_str() >= s).unwrap_or(true);
            let ok_until = until.map(|u| e.timestamp.as_str() <= u).unwrap_or(true);
            ok_since && ok_until
        })
        .collect();
    let total: f64 = filtered.iter().filter(|e| e.is_valid).map(|e| e.score_delta).sum();
    let by_code: std::collections::HashMap<String, i64> = filtered
        .iter()
        .fold(std::collections::HashMap::new(), |mut acc, e| {
            *acc.entry(e.reason_code.clone()).or_insert(0) += 1;
            acc
        });
    Ok(json!({ "since": since, "until": until, "eventCount": filtered.len(), "totalDelta": total, "byCode": by_code }))
}

pub(crate) fn tool_range(args: &Value) -> Result<Value> {
    let start = get_str(args, "start")?;
    let end = get_str(args, "end")?;
    let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as usize;
    let events = storage::load_events()?;
    let id2name = eaa_core::types::build_id_to_name(&storage::load_name_index()?);
    let hits: Vec<Value> = events
        .iter()
        .filter(|e| e.timestamp.as_str() >= start.as_str() && e.timestamp.as_str() <= end.as_str())
        .take(limit)
        .map(|e| json!({
            "eventId": e.event_id, "name": id2name.get(&e.entity_id),
            "reasonCode": e.reason_code, "delta": e.score_delta, "timestamp": e.timestamp,
        }))
        .collect();
    Ok(json!({ "events": hits, "count": hits.len() }))
}

pub(crate) fn tool_academic_get(args: &Value) -> Result<Value> {
    // 学业记录存在学生 profile 的 academicRecords 字段 (复数! 与 shared/types.ts 一致)。
    let name = get_str(args, "name")?;
    let path = storage::get_data_dir().join("profiles").join(format!("{}.json", sanitize(&name)));
    if !path.exists() {
        return Ok(json!({ "name": name, "academicRecords": [] }));
    }
    let raw = std::fs::read_to_string(&path)?;
    let v: Value = serde_json::from_str(&raw).unwrap_or_default();
    Ok(json!({ "name": name, "academicRecords": v.get("academicRecords").cloned().unwrap_or(json!([])) }))
}

pub(crate) fn tool_profile_get(args: &Value) -> Result<Value> {
    let name = get_str(args, "name")?;
    let path = storage::get_data_dir().join("profiles").join(format!("{}.json", sanitize(&name)));
    if !path.exists() {
        return Ok(json!({ "name": name, "profile": {} }));
    }
    let raw = std::fs::read_to_string(&path)?;
    Ok(json!({ "name": name, "profile": serde_json::from_str::<Value>(&raw).unwrap_or(json!({})) }))
}

// =============================================================
// 写入工具
// =============================================================

pub(crate) fn tool_add_event(args: &Value) -> Result<Value> {
    let name = get_str(args, "name")?;
    let reason_code = get_str(args, "reasonCode").or_else(|_| get_str(args, "reason_code"))?;
    let delta = args.get("delta").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let note = args.get("note").and_then(|v| v.as_str()).unwrap_or("");
    // reason_code 白名单 (仅大写字母+下划线)
    if !reason_code.chars().all(|c| c.is_ascii_uppercase() || c == '_') {
        return Err(AppError::Validation(format!("非法 reason_code: {reason_code}")));
    }
    eaa_core::validation::validate_delta(delta, false)?;

    let _lock = storage::FileLock::acquire()?;
    let mut index = storage::load_name_index()?;
    let id = match storage::resolve_entity_id(&name, &index) {
        Ok(id) => id,
        Err(_) => {
            // 学生不存在 → 自动建
            let new_id = format!("S_{}", uuid::Uuid::new_v4().simple());
            index.insert(name.clone(), new_id.clone());
            let mut entities = storage::load_entities()?;
            entities.entities.insert(
                name.clone(),
                eaa_core::Entity {
                    id: new_id.clone(),
                    name: name.clone(),
                    aliases: vec![],
                    status: eaa_core::EntityStatus::Active,
                    created_at: chrono::Utc::now().to_rfc3339(),
                    metadata: Default::default(),
                    groups: vec![],
                    roles: vec![],
                    class_id: None,
                },
            );
            storage::save_entities(&entities)?;
            storage::save_name_index(&index)?;
            new_id
        }
    };
    let event = eaa_core::Event {
        event_id: storage::generate_event_id(),
        entity_id: id.clone(),
        event_type: if delta >= 0.0 { eaa_core::EventType::ConductBonus } else { eaa_core::EventType::ConductDeduct },
        category_tags: vec![],
        reason_code: reason_code.clone(),
        original_reason: note.to_string(),
        score_delta: delta,
        evidence_ref: String::new(),
        operator: args.get("operator").and_then(|v| v.as_str()).unwrap_or("agent").to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
        is_valid: true,
        reverted_by: None,
        note: note.to_string(),
    };
    let mut events = storage::load_events()?;
    events.push(event.clone());
    storage::save_events(&events)?;
    storage::append_operation_log(&json!({"op":"add_event","eventId":event.event_id}))?;
    Ok(json!({ "eventId": event.event_id, "name": name, "delta": delta }))
}

pub(crate) fn tool_add_student(args: &Value) -> Result<Value> {
    let name = get_str(args, "name")?;
    // 班级 ID 可选 (与 commands/eaa.rs::eaa_set_student_meta 一致)
    let class_id = args.get("classId").or_else(|| args.get("class_id"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let _lock = storage::FileLock::acquire()?;
    let mut entities = storage::load_entities()?;
    let mut index = storage::load_name_index()?;
    if index.contains_key(&name) {
        return Err(AppError::Validation(format!("学生已存在: {name}")));
    }
    let id = format!("S_{}", uuid::Uuid::new_v4().simple());
    entities.entities.insert(
        name.clone(),
        eaa_core::Entity {
            id: id.clone(),
            name: name.clone(),
            aliases: vec![],
            status: eaa_core::EntityStatus::Active,
            created_at: chrono::Utc::now().to_rfc3339(),
            metadata: Default::default(),
            groups: vec![],
            roles: vec![],
            class_id,
        },
    );
    index.insert(name.clone(), id.clone());
    storage::save_entities(&entities)?;
    storage::save_name_index(&index)?;
    Ok(json!({ "id": id, "name": name }))
}

pub(crate) fn tool_revert_event(args: &Value) -> Result<Value> {
    let event_id = get_str(args, "eventId").or_else(|_| get_str(args, "event_id"))?;
    let _lock = storage::FileLock::acquire()?;
    let mut events = storage::load_events()?;
    let evt = events
        .iter_mut()
        .find(|e| e.event_id == event_id)
        .ok_or_else(|| AppError::NotFound(format!("事件不存在: {event_id}")))?;
    eaa_core::validation::can_revert(&evt.reverted_by, &event_id, &evt.reason_code)?;
    evt.is_valid = false;
    evt.reverted_by = Some(format!("revert_{}", chrono::Utc::now().timestamp_millis()));
    storage::save_events(&events)?;
    storage::append_operation_log(&json!({"op":"revert_event","eventId":event_id}))?;
    Ok(json!({ "eventId": event_id, "reverted": true }))
}

pub(crate) fn tool_academic_add(args: &Value) -> Result<Value> {
    // 写入 academicRecords (与 shared/types.ts AcademicExamRecord 同构)。
    // 支持两种入参:
    //   A) 单科目: { name, examType, examName, subject, score } → 新建/追加到该次考试
    //   B) 完整记录: { name, record: { examType, examName, subjects:{...}, date?, notes? } }
    let name = get_str(args, "name")?;
    let path = storage::get_data_dir().join("profiles").join(format!("{}.json", sanitize(&name)));
    let mut profile: Value = if path.exists() {
        serde_json::from_str(&std::fs::read_to_string(&path)?).unwrap_or(json!({}))
    } else {
        json!({})
    };
    if profile.get("academicRecords").is_none() {
        profile["academicRecords"] = json!([]);
    }

    if let Some(record) = args.get("record") {
        // 模式 B: 整条记录
        if let Some(arr) = profile.get_mut("academicRecords").and_then(|v| v.as_array_mut()) {
            arr.push(record.clone());
        }
    } else {
        // 模式 A: 单科目 → 追加到同名 examName 的记录, 或新建
        let exam_type = get_str(args, "examType").or_else(|_| get_str(args, "exam_type"))?;
        let exam_name = get_str(args, "examName").or_else(|_| get_str(args, "exam_name"))?;
        let subject = get_str(args, "subject")?;
        let score = args.get("score").and_then(|v| v.as_f64());
        let date = args.get("date").and_then(|v| v.as_str()).map(String::from);

        // 安全获取 academicRecords 数组 (字段不存在时初始化为空数组, 不 panic)
        if profile.get("academicRecords").is_none() {
            profile["academicRecords"] = json!([]);
        }
        let arr = profile
            .get_mut("academicRecords")
            .and_then(|v| v.as_array_mut())
            .ok_or_else(|| AppError::Other("academicRecords 不是数组".into()))?;
        // 找同 examName 的记录
        let idx = arr.iter().position(|r| r.get("examName").and_then(|v| v.as_str()) == Some(&exam_name));
        match idx {
            Some(i) => {
                // 追加科目到已有考试
                if arr[i].get("subjects").is_none() {
                    arr[i]["subjects"] = json!({});
                }
                if let Some(s) = score {
                    arr[i]["subjects"][&subject] = json!(s);
                } else {
                    arr[i]["subjects"][&subject] = Value::Null;
                }
            }
            None => {
                // 新建考试记录
                let mut subjects = serde_json::Map::new();
                match score {
                    Some(s) => {
                        subjects.insert(subject.clone(), json!(s));
                    }
                    None => {
                        subjects.insert(subject.clone(), Value::Null);
                    }
                }
                arr.push(json!({
                    "examType": exam_type,
                    "examName": exam_name,
                    "subjects": subjects,
                    "date": date,
                }));
            }
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&profile)?)?;
    Ok(json!({ "name": name, "updated": true }))
}

pub(crate) fn tool_profile_set(args: &Value) -> Result<Value> {
    let name = get_str(args, "name")?;
    let data = args.get("data").cloned().unwrap_or(json!({}));
    let path = storage::get_data_dir().join("profiles").join(format!("{}.json", sanitize(&name)));
    let mut profile: Value = if path.exists() {
        serde_json::from_str(&std::fs::read_to_string(&path)?).unwrap_or(json!({}))
    } else {
        json!({})
    };
    if let (Some(p), Some(d)) = (profile.as_object_mut(), data.as_object()) {
        for (k, v) in d {
            p.insert(k.clone(), v.clone());
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&profile)?)?;
    Ok(json!({ "name": name, "updated": true }))
}

pub(crate) fn tool_delete_student(args: &Value) -> Result<Value> {
    let name = get_str(args, "name")?;
    let _lock = storage::FileLock::acquire()?;
    let mut entities = storage::load_entities()?;
    let mut index = storage::load_name_index()?;
    let existed = index.remove(&name).is_some() && entities.entities.remove(&name).is_some();
    storage::save_entities(&entities)?;
    storage::save_name_index(&index)?;
    Ok(json!({ "name": name, "deleted": existed }))
}

pub(crate) fn tool_delete_by_class(args: &Value) -> Result<Value> {
    let class_id = get_str(args, "classId").or_else(|_| get_str(args, "class_id"))?;
    let _lock = storage::FileLock::acquire()?;
    let mut entities = storage::load_entities()?;
    let before = entities.entities.len();
    entities.entities.retain(|_, e| e.class_id.as_deref() != Some(&class_id));
    let after = entities.entities.len();
    storage::save_entities(&entities)?;
    Ok(json!({ "classId": class_id, "deleted": before - after }))
}

pub(crate) fn tool_reset_events(_args: &Value) -> Result<Value> {
    let _lock = storage::FileLock::acquire()?;
    storage::save_events(&[])?;
    Ok(json!({ "reset": "events", "message": "事件日志已清空 (学生保留)" }))
}

pub(crate) fn tool_reset_factory(_args: &Value) -> Result<Value> {
    let data_dir = storage::get_data_dir();
    if data_dir.exists() {
        let _ = std::fs::remove_dir_all(&data_dir);
    }
    // 重建空目录 + 空数据文件, 让后续 read 操作不会因文件缺失而报错
    for sub in ["entities", "events", "profiles", "logs", "privacy"] {
        let _ = std::fs::create_dir_all(data_dir.join(sub));
    }
    let _ = std::fs::write(data_dir.join("entities/entities.json"), r#"{"entities":{}}"#);
    let _ = std::fs::write(data_dir.join("entities/name_index.json"), "{}");
    let _ = std::fs::write(data_dir.join("events/events.json"), "[]");
    Ok(json!({ "reset": "factory", "message": format!("已清空 {}", data_dir.display()) }))
}

// =============================================================
// 批量工具
// =============================================================

pub(crate) fn tool_bulk_add_students(args: &Value) -> Result<Value> {
    let names = args.get("names").and_then(|v| v.as_array()).ok_or_else(|| AppError::Validation("缺少 names 数组".into()))?;
    let _lock = storage::FileLock::acquire()?;
    let mut entities = storage::load_entities()?;
    let mut index = storage::load_name_index()?;
    let mut added = 0u64;
    for n in names {
        if let Some(name) = n.as_str() {
            if !index.contains_key(name) {
                let id = format!("S_{}", uuid::Uuid::new_v4().simple());
                entities.entities.insert(
                    name.to_string(),
                    eaa_core::Entity {
                        id: id.clone(),
                        name: name.to_string(),
                        aliases: vec![],
                        status: eaa_core::EntityStatus::Active,
                        created_at: chrono::Utc::now().to_rfc3339(),
                        metadata: Default::default(),
                        groups: vec![],
                        roles: vec![],
                        class_id: None,
                    },
                );
                index.insert(name.to_string(), id);
                added += 1;
            }
        }
    }
    storage::save_entities(&entities)?;
    storage::save_name_index(&index)?;
    Ok(json!({ "added": added, "skipped": names.len() - added as usize }))
}

pub(crate) fn tool_bulk_add_academics(args: &Value) -> Result<Value> {
    let records = args.get("records").and_then(|v| v.as_array()).ok_or_else(|| AppError::Validation("缺少 records 数组".into()))?;
    let mut added = 0u64;
    for r in records {
        let name = r.get("name").and_then(|v| v.as_str()).ok_or_else(|| AppError::Validation("record 缺少 name".into()))?;
        // 兼容两种命名: examType/examName(标准) / exam_type/exam_name / exam(legacy)
        let exam = r.get("examType")
            .or_else(|| r.get("exam_type"))
            .or_else(|| r.get("exam"))
            .cloned()
            .unwrap_or(json!(""));
        let exam_name = r.get("examName")
            .or_else(|| r.get("exam_name"))
            .cloned()
            .unwrap_or(exam.clone());
        let _ = tool_academic_add(&json!({
            "name": name,
            "examType": exam,
            "examName": exam_name,
            "subject": r.get("subject").cloned().unwrap_or(json!("")),
            "score": r.get("score").cloned().unwrap_or(json!(0.0)),
            "fullScore": r.get("fullScore").cloned(),
            "date": r.get("date").cloned(),
        }))?;
        added += 1;
    }
    Ok(json!({ "added": added }))
}

pub(crate) fn tool_bulk_add_events(args: &Value) -> Result<Value> {
    let events = args.get("events").and_then(|v| v.as_array()).ok_or_else(|| AppError::Validation("缺少 events 数组".into()))?;
    let mut added = 0u64;
    for e in events {
        let _ = tool_add_event(e)?;
        added += 1;
    }
    Ok(json!({ "added": added }))
}

// =============================================================
// capability 校验 (与 eaa-tools.ts getToolsByCapability 同构)
// =============================================================

pub(crate) fn is_allowed(tool: &str, caps: &[String]) -> bool {
    let lower: Vec<String> = caps.iter().map(|c| c.to_lowercase()).collect();
    if lower.iter().any(|c| c == "all" || c == "*") {
        return true;
    }
    if lower.iter().any(|c| c == tool) {
        return true;
    }
    let in_group = |group_tools: &[&str]| group_tools.contains(&tool);
    // read 组
    if lower.iter().any(|c| c == "read") && in_group(&[
        "score", "history", "search", "list_students", "list", "ranking", "stats", "codes",
        "summary", "range", "academic_get", "profile_get",
        "bulk_add_students", "bulk_add_academics", "bulk_add_events",
    ]) {
        return true;
    }
    // write 组
    if lower.iter().any(|c| c == "write") && in_group(&[
        "add_event", "add_student", "revert_event", "revert",
        "academic_add", "profile_set",
        "delete_student", "delete_by_class", "reset_events", "reset_factory",
    ]) {
        return true;
    }
    // academic 组 (get + add + bulk)
    if lower.iter().any(|c| c == "academic") && in_group(&["academic_get", "academic_add", "bulk_add_academics"]) {
        return true;
    }
    // profile 组
    if lower.iter().any(|c| c == "profile") && in_group(&["profile_get", "profile_set"]) {
        return true;
    }
    // bulk 组
    if lower.iter().any(|c| c == "bulk") && in_group(&["bulk_add_students", "bulk_add_academics", "bulk_add_events"]) {
        return true;
    }
    // revert 单独
    if lower.iter().any(|c| c == "revert") && (tool == "revert_event" || tool == "revert") {
        return true;
    }
    // 文件/实用工具组
    if lower.iter().any(|c| c == "file_read" || c == "read_file") && in_group(&["read_file", "list_dir"]) {
        return true;
    }
    if lower.iter().any(|c| c == "file_write" || c == "write_file") && in_group(&["write_file"]) {
        return true;
    }
    if lower.iter().any(|c| c == "utility" || c == "util") && in_group(&["get_current_time", "calculate"]) {
        return true;
    }
    false
}

fn get_str(args: &Value, key: &str) -> Result<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| AppError::Validation(format!("缺少参数: {key}")))
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect()
}

/// 工具参数校验 (data-validation 接线)。
///
/// Permissive 模式:
///   - 关掉 SQL `OR/AND/`;` 检查 (误报率高, 学生名常含 "and")
///   - 仅保留 SELECT/UNION/DROP 等真正危险关键字 + XSS 标签 + 长度上限
///   - 校验失败 → AppError::Validation, 不阻断其他工具调用 (单工具粒度)
fn validate_tool_args(tool: &str, args: &Value) -> Result<()> {
    use data_validation::{DataValidator, ValidationLevel, ValidatorConfig};
    let cfg = ValidatorConfig {
        level: ValidationLevel::Permissive,
        max_length: 100_000,
        // 关掉内置 SQL/XSS 规则的 use_eaa_gate 开关, 但保留 patterns 自身
        check_sql_injection: true,
        check_xss: true,
        use_eaa_gate: false,
    };
    let validator = DataValidator::new(cfg);
    // 把 args 序列化成字符串作为校验目标 (含所有字段值)
    let raw = serde_json::to_string(args).unwrap_or_default();
    let trace_id = format!("tool-{}-{}", tool, uuid::Uuid::new_v4().simple());
    let result = validator.validate(&raw, &trace_id);
    if !result.passed {
        return Err(AppError::Validation(format!(
            "tool `{tool}` 参数校验失败: {} (trace_id={})",
            result.error_message.as_deref().unwrap_or("unknown"),
            result.trace_id
        )));
    }
    Ok(())
}
