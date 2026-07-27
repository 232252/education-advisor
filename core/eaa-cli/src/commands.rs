use crate::storage::*;
use crate::types::*;
use crate::validation::*;
use std::collections::HashMap;

fn print_json(value: &serde_json::Value) {
    println!("{}", serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()));
}

fn print_event_line(evt: &Event, id_to_name: &HashMap<String, String>) {
    let name = id_to_name.get(&evt.entity_id).map(|s| s.as_str()).unwrap_or("?");
    let date = if evt.timestamp.len() >= 10 { &evt.timestamp[..10] } else { &evt.timestamp };
    println!("{:<10} {:<12} [{:<25}] {:<24} {:+.1}",
        name, date, evt.reason_code, evt.original_reason, evt.score_delta);
}

fn event_to_json(evt: &Event, id_to_name: &HashMap<String, String>) -> serde_json::Value {
    let name = id_to_name.get(&evt.entity_id).map(|s| s.as_str()).unwrap_or("?");
    serde_json::json!({
        "event_id": evt.event_id,
        "name": name,
        "entity_id": evt.entity_id,
        "timestamp": evt.timestamp,
        "event_type": format!("{:?}", evt.event_type),
        "reason_code": evt.reason_code,
        "original_reason": evt.original_reason,
        "score_delta": evt.score_delta,
        "note": evt.note,
        "tags": evt.category_tags,
        "operator": evt.operator,
        "is_valid": evt.is_valid,
        "reverted_by": evt.reverted_by,
    })
}

/// v3.1.4: 轻量级上下文, 只 load entities + index + scores cache, 不 load events
/// 用于 ranking/score/replay 等不需要事件详情的查询, 避免 O(n) 全量读 events.jsonl
/// 预期把 ranking 从 5080ms 降到 ~50ms (100x 提升)
/// v3.1.5: 新增 event_stats cache, score/list-students 不再需要 load_events
struct LightContext {
    entities: EntitiesFile,
    index: HashMap<String, String>,
    id_to_name: HashMap<String, String>,
    scores: HashMap<String, f64>,
    event_stats: HashMap<String, EventStats>,
}

impl LightContext {
    fn load() -> Result<Self, AppError> {
        let entities = load_entities()?;
        let index = load_name_index()?;
        let id_to_name = build_id_to_name(&index);
        let mut scores = load_scores_cache()?;
        let mut event_stats = load_event_stats_cache()?;
        // cache 为空时必须从 events 重建(一次性 O(n), 之后都是 O(1))
        if scores.is_empty() {
            let events = load_events()?;
            if !events.is_empty() {
                scores = compute_scores(&entities.entities, &events);
                let _ = save_scores_cache(&scores);
            }
        }
        // event_stats cache 为空时从 events 重建 (一次性)
        if event_stats.is_empty() && !scores.is_empty() {
            event_stats = compute_event_stats()?;
            if !event_stats.is_empty() {
                let _ = save_event_stats_cache(&event_stats);
            }
        }
        // 补全: entities 中存在但 cache 中缺失的学生, 给基础分
        // v3.2.3: 补全后写回 cache 文件, 保证 scores.cache.json 与 entities.json 数量一致
        //   避免外部工具/测试读取 cache 文件时看到不一致 (cache 只含添加过事件的学生)
        //   性能影响: 仅在首次补全时写一次, 后续 load 时 cache 已完整
        let mut patched = false;
        for eid in entities.entities.keys() {
            if !scores.contains_key(eid) {
                scores.insert(eid.clone(), BASE_SCORE);
                patched = true;
            }
        }
        if patched {
            if let Err(e) = save_scores_cache(&scores) {
                eprintln!("[warn] scores.cache 补全后写回失败: {}", e);
            }
        }
        Ok(Self { entities, index, id_to_name, scores, event_stats })
    }
}

pub fn cmd_info(output: OutputMode) -> Result<(), AppError> {
    let entities = load_entities()?;
    // v3.1.7: 用 count_events 只数行数, 不全量解析 (省去 193K 次反序列化)
    let event_count = count_events()?;
    let data_dir = get_data_dir();
    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "version": "3.2.5",
                "students": entities.entities.len(),
                "events": event_count,
                "data_dir": data_dir.display().to_string(),
            }));
        }
        OutputMode::Text => {
            println!("╔══════════════════════════════════════╗");
            println!("║     EAA 事件溯源操行分系统 v3.2.5    ║");
            println!("╠══════════════════════════════════════╣");
            println!("║ 学生总数: {:>4}                       ║", entities.entities.len());
            println!("║ 事件总数: {:>4}                       ║", event_count);
            println!("║ 数据目录: {:<26}║", data_dir.display());
            println!("╚══════════════════════════════════════╝");
        }
    }
    Ok(())
}

pub fn cmd_validate(output: OutputMode) -> Result<(), AppError> {
    let entities = load_entities()?;
    let codes = load_reason_codes()?;
    let entity_ids: std::collections::HashSet<String> = entities.entities.keys().cloned().collect();
    let code_keys: std::collections::HashSet<String> = codes.codes.keys().cloned().collect();
    // v3.1.7: 流式验证, 不全量加载 events 到 Vec
    let (total_events, errors, warnings) = stream_validate(&entity_ids, &code_keys)?;
    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "valid": errors.is_empty(),
                "total_events": total_events,
                "errors": errors,
                "warnings": warnings,
            }));
        }
        OutputMode::Text => {
            for e in &errors { println!("✗ {}", e); }
            for w in &warnings { println!("⚠ {}", w); }
            if errors.is_empty() { println!("✓ All {} events valid", total_events); }
            else { println!("✗ {} errors found", errors.len()); }
        }
    }
    Ok(())
}

pub fn cmd_replay(output: OutputMode) -> Result<(), AppError> {
    // v3.1.4: 用 LightContext 避免全量读 events
    let ctx = LightContext::load()?;
    let mut sorted: Vec<_> = ctx.scores.iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap());
    match output {
        OutputMode::Json => {
            let ranking: Vec<serde_json::Value> = sorted.iter().enumerate().map(|(i, (eid, score))| {
                let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
                serde_json::json!({
                    "rank": i + 1, "name": name, "entity_id": eid,
                    "score": score, "delta": **score - BASE_SCORE, "risk": risk_level(**score),
                })
            }).collect();
            print_json(&serde_json::json!({ "ranking": ranking }));
        }
        OutputMode::Text => {
            println!("{:<20} {:>8} {:>6}", "姓名", "分数", "变动");
            println!("{}", "-".repeat(36));
            for (eid, score) in &sorted {
                let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
                println!("{:<20} {:>8.1} {:>+6.1}", name, score, **score - BASE_SCORE);
            }
        }
    }
    Ok(())
}

pub fn cmd_history(name: &str, output: OutputMode) -> Result<(), AppError> {
    // v3.1.5: 流式读取该学生事件, 不全量加载所有事件到 Vec
    // 88522 事件时从 770ms 降到 ~400ms (省去全量 Vec 分配 + 全量过滤)
    let index = load_name_index()?;
    let eid = resolve_entity_id(name, &index)?;
    let student_events = load_events_for_entity(&eid)?;
    // score 用 LightContext (cache)
    let lctx = LightContext::load()?;
    let score = lctx.scores.get(&eid).unwrap_or(&BASE_SCORE);
    match output {
        OutputMode::Json => {
            let history = compute_cumulative_history(&eid, &student_events, BASE_SCORE);
            print_json(&serde_json::json!({
                "name": name, "entity_id": eid, "score": score,
                "risk": risk_level(*score), "events_count": student_events.len(),
                "events": history,
            }));
        }
        OutputMode::Text => {
            if student_events.is_empty() { println!("无事件记录"); }
            else {
                println!("{} 的事件时间线 ({}条):", name, student_events.len());
                println!("{}", "-".repeat(60));
                let mut running = BASE_SCORE;
                // v3.2.5: 与 compute_scores 对齐 — 软删除/已撤销/REVERT 事件均显示但不动累计分
                for evt in &student_events {
                    let is_deleted = !evt.is_valid;
                    let is_reverted = evt.reverted_by.is_some();
                    let is_revert_op = evt.reason_code == "REVERT";
                    if !is_deleted && !is_reverted && !is_revert_op {
                        running += evt.score_delta;
                    }
                    let mut markers = String::new();
                    if is_deleted { markers.push_str("  🗑(已删除)"); }
                    if is_reverted { markers.push_str("  ↩(已撤销)"); }
                    if is_revert_op && !is_deleted { markers.push_str("  ↩(撤销操作)"); }
                    println!("{:<12} {:>+6.1} → {:>6.1}  [{}] {}{}",
                        &evt.timestamp[..10], evt.score_delta, running,
                        evt.reason_code, evt.original_reason, markers);
                    if !evt.note.is_empty() { println!("             📝 {}", evt.note); }
                }
            }
        }
    }
    Ok(())
}

pub fn cmd_ranking(n: usize, output: OutputMode) -> Result<(), AppError> {
    // v3.1.4: 用 LightContext 避免全量读 events, ranking 不需要事件详情
    let ctx = LightContext::load()?;
    // v3.2.4 fix: 排行榜默认排除软删(Deleted)学生, 否则历史测试数据/已毕业学生会一直占据榜首。
    // (Active/Transferred/Suspended 都保留,只有 Deleted 排除。)
    let sorted: Vec<_> = ctx.scores.iter()
        .filter(|(eid, _)| {
            ctx.entities.entities.get(eid.as_str())
                .map(|e| !matches!(e.status, EntityStatus::Deleted))
                .unwrap_or(true)
        })
        .collect();
    let mut sorted = sorted;
    // v3.2.6 fix: 同分时按姓名升序作为稳定 tiebreaker，避免 HashMap 迭代顺序导致排名在多次调用间抖动
    sorted.sort_by(|a, b| {
        let by_score = b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal);
        if by_score != std::cmp::Ordering::Equal {
            return by_score;
        }
        let name_a = ctx.id_to_name.get(a.0.as_str()).map(|s| s.as_str()).unwrap_or("");
        let name_b = ctx.id_to_name.get(b.0.as_str()).map(|s| s.as_str()).unwrap_or("");
        name_a.cmp(name_b)
    });
    let take_n = n.min(sorted.len());
    match output {
        OutputMode::Json => {
            let ranking: Vec<serde_json::Value> = sorted.iter().take(take_n).enumerate().map(|(i, (eid, score))| {
                let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
                // 包含 class_id 以便前端能按班级过滤排行榜
                let entity = ctx.entities.entities.get(eid.as_str());
                let class_id = entity.and_then(|e| e.class_id.clone());
                let status = entity.map(|e| format!("{:?}", e.status)).unwrap_or_else(|| "Unknown".to_string());
                serde_json::json!({
                    "rank": i + 1, "name": name, "entity_id": eid, "class_id": class_id,
                    "score": score, "delta": **score - BASE_SCORE, "risk": risk_level(**score),
                    "status": status,
                })
            }).collect();
            print_json(&serde_json::json!({ "ranking": ranking, "total": sorted.len() }));
        }
        OutputMode::Text => {
            println!("排行榜 Top {}:", take_n);
            println!("{:<4} {:<20} {:>8}", "排名", "姓名", "分数");
            println!("{}", "-".repeat(34));
            for (i, (eid, score)) in sorted.iter().take(take_n).enumerate() {
                let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
                println!("{:<4} {:<20} {:>8.1}", i + 1, name, score);
            }
        }
    }
    Ok(())
}

pub fn cmd_score(name: &str, output: OutputMode) -> Result<(), AppError> {
    // v3.1.5: 改用 LightContext + event_stats cache, 不再 load_events
    // 88522 事件时从 188ms 降到 ~20ms
    let ctx = LightContext::load()?;
    let eid = resolve_entity_id(name, &ctx.index)?;
    let score = ctx.scores.get(&eid).unwrap_or(&BASE_SCORE);
    let entity = ctx.entities.entities.get(&eid).unwrap();
    let risk = entity.metadata.get("risk").and_then(|v| v.as_str()).unwrap_or("未知");
    let stats = ctx.event_stats.get(&eid);
    let events_count = stats.map(|s| s.count).unwrap_or(0);
    let last_event_at = stats.map(|s| s.last_ts.clone()).unwrap_or_default();
    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "name": name, "entity_id": eid, "score": score,
                "delta": *score - BASE_SCORE, "risk": risk_level(*score),
                "risk_stored": risk, "status": format!("{:?}", entity.status),
                "events_count": events_count,
                "last_event_at": last_event_at,
                "groups": entity.groups, "roles": entity.roles, "class_id": entity.class_id,
            }));
        }
        OutputMode::Text => {
            // v3.1.3 fix: text mode 也显示从分数计算的 risk level(与 JSON 一致),stored risk 作为参考
            let computed_risk = risk_level(*score);
            if risk == "未知" {
                println!("{}: {:.1} 分 (风险: {})", name, score, computed_risk);
            } else {
                println!("{}: {:.1} 分 (风险: {}, 仓库: {})", name, score, computed_risk, risk);
            }
        }
    }
    Ok(())
}

// add, revert unchanged from v2 - keep as-is
pub fn cmd_add(name: &str, reason_code: &str, tags: &str, delta: f64, note: &str,
              operator: Option<&str>, dry_run: bool, force: bool, output: OutputMode) -> Result<(), AppError> {
    let codes = load_reason_codes()?;
    if !codes.codes.contains_key(reason_code) {
        return Err(AppError::Validation(format!("未知原因码: {}", reason_code)));
    }
    let code_def = codes.codes.get(reason_code).unwrap();
    let expected = code_def.score_delta;
    if expected.is_some() && (delta - expected.unwrap()).abs() > 0.001 && !force {
        return Err(AppError::Validation(format!(
            "原因码 {} 标准分值: {:?}，当前: {:.1}", reason_code, expected, delta
        )));
    }
    validate_delta(delta, force)?;
    let index = load_name_index()?;
    let eid = resolve_entity_id(name, &index)?;
    // v3.2.8 fix: 拒绝向已删除学生添加事件
    // 之前 cmd_add 不检查 entity status, 导致测试脚本可以给已删除学生
    // 继续添加事件,这些事件 is_valid=true 且无 tombstone tag,
    // 造成 stats.total_delta 与 listStudents delta 之和不一致
    // (stats 包含孤儿事件, listStudents 排除已删除学生)
    if !force {
        let entities = load_entities()?;
        if let Some(ent) = entities.entities.get(&eid) {
            if matches!(ent.status, EntityStatus::Deleted) {
                return Err(AppError::Validation(format!(
                    "学生 {} 已删除，不能添加事件 (使用 --force 强制写入)", name
                )));
            }
        }
    }
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    // v3.1.6: 重复检测用 daily_dedup cache (O(1)), 首次查当天扫描填充, 之后 O(1)
    // 192110 事件时首次 235ms, 后续 <5ms; 批量录入 25 人从 5.9s 降到 ~350ms
    let duplicate = check_daily_dedup(&eid, reason_code, &today)?;
    if duplicate && !force {
        return Err(AppError::Validation("重复事件：同一学生今日同一原因码已存在".into()));
    }
    let new_id = generate_event_id();
    // v3.2.7 fix BUG#3: tags 分隔符从逗号改为分号,允许 tag 内含逗号
    // (TS 端 eaa-handlers.ts add-event 同步改为 join(';'))
    let tag_list: Vec<String> = if tags.is_empty() { vec![] } else { tags.split(';').map(|s| s.trim().to_string()).collect() };
    let op = get_operator(operator);
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    let new_event = Event {
        event_id: new_id.clone(), entity_id: eid.clone(),
        event_type: if delta >= 0.0 { EventType::ConductBonus } else { EventType::ConductDeduct },
        category_tags: tag_list, reason_code: reason_code.to_string(),
        original_reason: reason_code.to_string(), score_delta: delta,
        evidence_ref: "cli:manual".to_string(), operator: op.clone(),
        timestamp: now.clone(), is_valid: true, reverted_by: None, note: note.to_string(),
    };
    if dry_run {
        println!("[DRY-RUN] event_id:{} student:{} code:{} delta:{:+.1} op:{}", new_event.event_id, name, reason_code, delta, op);
        return Ok(());
    }
    let _lock = FileLock::acquire()?;
    // 性能优化: 用 append_event 增量写入(O(1))替代 load+push+save_events(O(n) 全量重写)
    append_event(&new_event)?;
    // v3.1.4: 增量更新 scores.cache.json, 避免下次 ranking 时全量重算
    // v3.1.9: 缓存更新失败时记录 stderr 警告 (之前用 let _ = 静默忽略, 可能导致缓存不一致)
    if let Err(e) = update_score_delta(&eid, delta) {
        eprintln!("[warn] scores.cache 更新失败 (事件已写入): {}", e);
    }
    // v3.1.5: 增量更新 event_stats.cache.json
    if let Err(e) = update_event_stats(&eid, &now) {
        eprintln!("[warn] event_stats.cache 更新失败 (事件已写入): {}", e);
    }
    // v3.1.6: 增量更新 daily_dedup.cache.json
    if let Err(e) = update_daily_dedup(&eid, reason_code, &today) {
        eprintln!("[warn] daily_dedup.cache 更新失败 (事件已写入): {}", e);
    }
    let log_entry = serde_json::json!({"action":"add","event_id":new_id,"student":name,"reason_code":reason_code,"delta":delta,"operator":op,"timestamp":now});
    if let Err(e) = append_operation_log(&log_entry) { eprintln!("[log] warn: append_operation_log failed: {}", e); }
    // v3.1.8: JSON 模式下输出 JSON (修复预先存在的 bug)
    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "event_id": new_id, "entity_id": eid, "name": name,
                "reason_code": reason_code, "delta": delta, "timestamp": now,
            }));
        }
        OutputMode::Text => {
            println!("✓ 事件已创建: {} {} {:+.1}", new_event.event_id, name, delta);
        }
    }
    Ok(())
}

pub fn cmd_revert(event_id: &str, reason: &str, operator: Option<&str>, dry_run: bool, output: OutputMode) -> Result<(), AppError> {
    let _lock = FileLock::acquire()?;
    // v3.1.7: dry_run 用 find_event_by_id (流式, 不全量 load)
    if dry_run {
        let target = find_event_by_id(event_id)?;
        can_revert(&target.reverted_by, event_id, &target.reason_code)?;
        match output {
            OutputMode::Json => {
                print_json(&serde_json::json!({
                    "dry_run": true, "target_id": event_id,
                    "original_delta": target.score_delta, "revert_delta": -target.score_delta,
                    "reason": reason,
                }));
            }
            OutputMode::Text => {
                println!("[DRY-RUN] target:{} delta:{:+.1}→{:+.1} reason:{}", event_id, target.score_delta, -target.score_delta, reason);
            }
        }
        return Ok(());
    }
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    let op = get_operator(operator);
    // v3.1.7: 用 revert_event_in_file 流式撤销, 避免全量 load_events + save_events
    // 192862 事件时从 ~1765ms 降到 ~550ms (3x 提升)
    let (target, revert_event) = revert_event_in_file(event_id, |target| {
        can_revert(&target.reverted_by, event_id, &target.reason_code)?;
        let revert_id = generate_event_id();
        Ok(Event {
            event_id: revert_id,
            entity_id: target.entity_id.clone(),
            event_type: if target.score_delta >= 0.0 { EventType::ConductDeduct } else { EventType::ConductBonus },
            category_tags: vec!["系统纠正".to_string()],
            reason_code: "REVERT".to_string(),
            original_reason: format!("撤销 {}", event_id),
            score_delta: -target.score_delta,
            evidence_ref: format!("revert:{}", event_id),
            operator: op.clone(),
            timestamp: now.clone(),
            is_valid: true,
            reverted_by: None,
            note: reason.to_string(),
        })
    })?;
    let entity_id = target.entity_id.clone();
    let score_delta = target.score_delta;
    let target_reason_code = target.reason_code.clone();
    let target_date = if target.timestamp.len() >= 10 {
        target.timestamp[..10].to_string()
    } else { String::new() };
    let revert_id = revert_event.event_id.clone();
    // v3.1.4: 增量更新 scores.cache.json
    // 原事件被标记 reverted_by → 其 delta 不再计入分数 → cache 要 -= original_delta
    // revert 事件本身 reason_code=REVERT, 不计入 cache (与 compute_scores 逻辑一致)
    // v3.1.9: 缓存更新失败时记录 stderr 警告 (之前用 let _ = 静默忽略)
    if let Err(e) = revert_score_delta(&entity_id, score_delta) {
        eprintln!("[warn] scores.cache 撤销更新失败 (事件已撤销): {}", e);
    }
    // v3.1.5: 增量更新 event_stats.cache.json (原事件不再计入 count)
    if let Err(e) = revert_event_stats(&entity_id) {
        eprintln!("[warn] event_stats.cache 撤销更新失败 (事件已撤销): {}", e);
    }
    // v3.1.6: 增量更新 daily_dedup.cache.json (原事件不再计入当天重复检测)
    if target_reason_code != "REVERT" && !target_date.is_empty() {
        if let Err(e) = revert_daily_dedup(&entity_id, &target_reason_code, &target_date) {
            eprintln!("[warn] daily_dedup.cache 撤销更新失败 (事件已撤销): {}", e);
        }
    }
    if let Err(e) = append_operation_log(&serde_json::json!({"action":"revert","revert_id":revert_id,"target_id":event_id,"operator":op,"timestamp":now})) { eprintln!("[log] warn: append_operation_log failed: {}", e); }
    // v3.1.8: JSON 模式下输出 JSON (修复预先存在的 bug)
    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "revert_id": revert_id, "target_id": event_id,
                "entity_id": entity_id, "score_delta": -score_delta,
                "operator": op, "timestamp": now,
            }));
        }
        OutputMode::Text => {
            println!("✓ 撤销事件: {} 对冲 {}", revert_id, event_id);
        }
    }
    Ok(())
}

/// v3.1.9: 全量重建缓存 (scores + event_stats + daily_dedup)
/// 用于修复因 Windows rename 失败导致的缓存不一致
pub fn cmd_rebuild_cache(output: OutputMode) -> Result<(), AppError> {
    let t0 = std::time::Instant::now();
    let (students, events) = rebuild_all_caches()?;
    let elapsed = t0.elapsed().as_millis();
    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "action": "rebuild_cache",
                "students": students,
                "events": events,
                "elapsed_ms": elapsed,
                "caches": ["scores.cache.json", "event_stats.cache.json", "daily_dedup.cache.json"],
            }));
        }
        OutputMode::Text => {
            println!("✓ 缓存重建完成: {} 学生, {} 事件, {}ms", students, events, elapsed);
            println!("  - scores.cache.json");
            println!("  - event_stats.cache.json");
            println!("  - daily_dedup.cache.json");
        }
    }
    Ok(())
}

pub fn cmd_codes(output: OutputMode) -> Result<(), AppError> {
    let codes = load_reason_codes()?;
    let mut sorted: Vec<_> = codes.codes.iter().collect();
    sorted.sort_by(|a, b| b.1.score_delta.unwrap_or(0.0).partial_cmp(&a.1.score_delta.unwrap_or(0.0)).unwrap());
    match output {
        OutputMode::Json => {
            let items: Vec<serde_json::Value> = sorted.iter().map(|(code, def)| {
                serde_json::json!({"code":code,"label":def.label,"category":def.category,"score_delta":def.score_delta})
            }).collect();
            print_json(&serde_json::json!({"codes":items,"version":codes.version}));
        }
        OutputMode::Text => {
            println!("{:<25} {:>6}  {}", "代码", "标准分", "说明");
            println!("{}", "-".repeat(50));
            for (code, def) in &sorted {
                let delta = match def.score_delta { Some(d) => format!("{:+.0}", d), None => "变量".to_string() };
                println!("{:<25} {:>6}  {}", code, delta, def.label);
            }
        }
    }
    Ok(())
}

pub fn cmd_search(query: &str, limit: usize, output: OutputMode) -> Result<(), AppError> {
    // v3.1.8: 用 LightContext + stream_filter, 不再全量 load_events
    // 195K 事件时从 ~245ms 降到 ~250ms (省去 Vec 分配 + 全量过滤)
    let ctx = LightContext::load()?;
    let query_upper = query.to_uppercase();
    let id_to_name = ctx.id_to_name.clone();
    let (total, results) = stream_filter(limit, |e| {
        let name = id_to_name.get(&e.entity_id).map(|s| s.as_str()).unwrap_or("");
        // v3.1.3 fix: 搜索同时包含 note 字段(以便按备注关键词查找),与 original_reason 同等权重
        name.contains(query) || e.reason_code.contains(&query_upper) ||
        e.category_tags.iter().any(|t| t.contains(query)) ||
        e.original_reason.contains(query) || e.note.contains(query)
    })?;
    if total == 0 {
        match output {
            OutputMode::Json => { print_json(&serde_json::json!({"query":query,"total":0,"showing":0,"events":[]})); }
            OutputMode::Text => { println!("未找到与 \"{}\" 相关的事件", query); }
        }
        return Ok(());
    }
    match output {
        OutputMode::Json => {
            let items: Vec<serde_json::Value> = results.iter().map(|e| event_to_json(e, &ctx.id_to_name)).collect();
            print_json(&serde_json::json!({"query":query,"total":total,"showing":items.len(),"events":items}));
        }
        OutputMode::Text => {
            let is_name = ctx.index.contains_key(query);
            if is_name { println!("{} 的所有事件 ({}条):", query, total); }
            else { println!("找到 {} 条\"{}\"相关事件:", total, query); }
            println!("{}", "-".repeat(75));
            for evt in &results { print_event_line(evt, &ctx.id_to_name); }
            if total > limit { println!("... (共{}条，显示前{}条)", total, limit); }
        }
    }
    Ok(())
}

pub fn cmd_stats(output: OutputMode) -> Result<(), AppError> {
    // v3.1.8: 用 LightContext (entities + scores cache) + stream_stats (流式聚合事件)
    // 不再全量 load_events 到 Vec, 195K 事件时从 ~245ms 降到 ~250ms
    let ctx = LightContext::load()?;
    let agg = stream_stats()?;
    let mut intervals = HashMap::new();
    intervals.insert("极高(<60)", 0usize); intervals.insert("高(60-80)", 0);
    intervals.insert("中(80-100)", 0); intervals.insert("低(>=100)", 0);
    for score in ctx.scores.values() {
        let key = if *score < 60.0 { "极高(<60)" } else if *score < 80.0 { "高(60-80)" }
        else if *score < 100.0 { "中(80-100)" } else { "低(>=100)" };
        *intervals.get_mut(key).unwrap() += 1;
    }
    match output {
        OutputMode::Json => {
            let mut code_dist: Vec<serde_json::Value> = agg.code_counts.iter()
                .map(|(k, v)| serde_json::json!({"code":k,"count":v})).collect();
            code_dist.sort_by(|a, b| b["count"].as_u64().cmp(&a["count"].as_u64()));
            let mut tag_dist: Vec<serde_json::Value> = agg.tag_counts.iter()
                .map(|(k, v)| serde_json::json!({"tag":k,"count":v})).collect();
            tag_dist.sort_by(|a, b| b["count"].as_u64().cmp(&a["count"].as_u64()));
            print_json(&serde_json::json!({
                "summary": {"students":ctx.entities.entities.len(),"total_events":agg.total_events,
                    "valid_events":agg.valid_events,"reverted_events":agg.reverted_events,"total_delta":agg.total_delta},
                "reason_distribution": code_dist, "tag_distribution": tag_dist, "score_intervals": intervals,
            }));
        }
        OutputMode::Text => {
            println!("╔══════════════════════════════════════╗");
            println!("║       EAA 数据统计 v3.1.2            ║");
            println!("╠══════════════════════════════════════╣");
            println!("║ 学生总数:     {:>4}                   ║", ctx.entities.entities.len());
            println!("║ 事件总数:    {:>4}                   ║", agg.total_events);
            println!("║ 有效事件:    {:>4}                   ║", agg.valid_events);
            println!("║ 撤销事件:      {:>4}                   ║", agg.reverted_events);
            println!("║ 总变动:    {:>+6.1}                  ║", agg.total_delta);
            println!("╠══════════════════════════════════════╣");
            println!("║ 分数区间:");
            for (k, v) in &intervals { println!("║   {:<30}{:>3}人", k, v); }
            println!("╠══════════════════════════════════════╣");
            println!("║ 原因码 TOP8:");
            let mut sc: Vec<_> = agg.code_counts.iter().collect(); sc.sort_by(|a,b| b.1.cmp(a.1));
            for (code, count) in sc.iter().take(8) { println!("║   {:<28}{:>3}次", code, count); }
            println!("╚══════════════════════════════════════╝");
        }
    }
    Ok(())
}

pub fn cmd_tag(tag: &str, output: OutputMode) -> Result<(), AppError> {
    // v3.1.8: 用 LightContext + stream_stats / stream_filter, 不再全量 load_events
    let ctx = LightContext::load()?;
    if tag.is_empty() {
        // 空标签: 用 stream_stats 一次性聚合所有标签计数
        // 注意: 用 tag_counts_all (所有事件, 含 reverted/invalid), 与原 cmd_tag 行为一致
        let agg = stream_stats()?;
        match output {
            OutputMode::Json => {
                let tags: Vec<serde_json::Value> = agg.tag_counts_all.iter().map(|(k,v)| serde_json::json!({"tag":k,"count":v})).collect();
                print_json(&serde_json::json!({"tags":tags}));
            }
            OutputMode::Text => {
                println!("所有标签:"); println!("{}", "-".repeat(30));
                let mut s: Vec<_> = agg.tag_counts_all.iter().collect(); s.sort_by(|a,b| b.1.cmp(a.1));
                for (t, c) in s { println!("  {:<20}{}次", t, c); }
            }
        }
        return Ok(());
    }
    // 指定标签: 用 stream_filter 只收集匹配事件
    let tag_owned = tag.to_string();
    // 标签下可能有很多事件, 用较大上限 (避免被默认 limit 截断显示总数)
    let (total, matched) = stream_filter(usize::MAX, |e| e.category_tags.iter().any(|t| t == &tag_owned))?;
    if total == 0 {
        match output {
            OutputMode::Json => { print_json(&serde_json::json!({"tag":tag,"total":0,"events":[]})); }
            OutputMode::Text => { println!("标签 [{}] 下无事件", tag); }
        }
        return Ok(());
    }
    match output {
        OutputMode::Json => {
            let items: Vec<serde_json::Value> = matched.iter().map(|e| event_to_json(e, &ctx.id_to_name)).collect();
            print_json(&serde_json::json!({"tag":tag,"total":total,"events":items}));
        }
        OutputMode::Text => {
            println!("标签 [{}] 的事件 ({}条):", tag, total);
            println!("{}", "-".repeat(75));
            for evt in &matched { print_event_line(evt, &ctx.id_to_name); }
        }
    }
    Ok(())
}

pub fn cmd_range(start: &str, end: &str, limit: usize, output: OutputMode) -> Result<(), AppError> {
    // v3.1.8: 用 LightContext + stream_filter, 不再全量 load_events
    let ctx = LightContext::load()?;
    let start_owned = start.to_string();
    let end_owned = end.to_string();
    let (total, matched) = stream_filter(limit, |e| {
        let d = if e.timestamp.len() >= 10 { &e.timestamp[..10] } else { &e.timestamp };
        d >= start_owned.as_str() && d <= end_owned.as_str()
    })?;
    if total == 0 {
        match output {
            OutputMode::Json => { print_json(&serde_json::json!({"start":start,"end":end,"total":0,"showing":0,"events":[]})); }
            OutputMode::Text => { println!("{} ~ {} 之间无事件", start, end); }
        }
        return Ok(());
    }
    match output {
        OutputMode::Json => {
            let items: Vec<serde_json::Value> = matched.iter().map(|e| event_to_json(e, &ctx.id_to_name)).collect();
            print_json(&serde_json::json!({"start":start,"end":end,"total":total,"showing":items.len(),"events":items}));
        }
        OutputMode::Text => {
            println!("{} ~ {} 的事件 ({}条):", start, end, total);
            println!("{}", "-".repeat(75));
            for evt in &matched { print_event_line(evt, &ctx.id_to_name); }
            if total > limit { println!("... (共{}条)", total); }
        }
    }
    Ok(())
}

pub fn cmd_list_students(output: OutputMode, include_deleted: bool) -> Result<(), AppError> {
    // v3.1.5: 改用 LightContext + event_stats cache, 不再 load_events
    // 消除 O(N*M) 遍历, 88522 事件时从 286ms 降到 ~20ms
    // v3.2.4 fix: 默认排除 status=Deleted 的学生（与前端 .filter(s => s.status !== 'Deleted')
    //   行为对齐）。加 --include-deleted 可查看全部（管理/调试用途）。
    let ctx = LightContext::load()?;
    let mut sorted: Vec<_> = ctx
        .entities
        .entities
        .iter()
        .filter(|(_, ent)| {
            include_deleted || !matches!(ent.status, EntityStatus::Deleted)
        })
        .collect::<Vec<_>>();
    sorted.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    match output {
        OutputMode::Json => {
            let students: Vec<serde_json::Value> = sorted.iter().map(|(eid, ent)| {
                let score = ctx.scores.get(*eid).unwrap_or(&BASE_SCORE);
                let name = ctx.id_to_name.get(*eid).map(|s| s.as_str()).unwrap_or(&ent.name);
                let events_count = ctx.event_stats.get(*eid).map(|s| s.count).unwrap_or(0);
                serde_json::json!({
                    "name":name,"entity_id":eid,"score":score,"delta":*score-BASE_SCORE,
                    "risk":risk_level(*score),"status":format!("{:?}",ent.status),
                    "events_count": events_count,
                    "groups":ent.groups,"roles":ent.roles,"class_id":ent.class_id,
                })
            }).collect();
            print_json(&serde_json::json!({"students":students,"total":sorted.len()}));
        }
        OutputMode::Text => {
            println!("{:<20} {:>8} {:<10}", "姓名", "分数", "状态");
            println!("{}", "-".repeat(40));
            for (eid, ent) in &sorted {
                let score = ctx.scores.get(*eid).unwrap_or(&BASE_SCORE);
                let status = match ent.status {
                    EntityStatus::Active => "在读", EntityStatus::Transferred => "转出", EntityStatus::Suspended => "休学", EntityStatus::Deleted => "已删除",
                };
                let name = ctx.id_to_name.get(*eid).map(|s| s.as_str()).unwrap_or(&ent.name);
                println!("{:<20} {:>8.1} {:<10}", name, score, status);
            }
            println!("共 {} 名学生", sorted.len());
        }
    }
    Ok(())
}

pub fn cmd_add_student(name: &str) -> Result<(), AppError> {
    let _lock = FileLock::acquire()?;
    let mut entities = load_entities()?;
    let mut index = load_name_index()?;
    // R53-2 修复: 区分 Active 和 Deleted。Active 时报错(原行为);Deleted 时复活。
    // 之前不区分,导致用户删除一个学生后无法用同名重新添加。
    if let Some(existing_eid) = index.get(name).cloned() {
        let is_deleted = entities.entities.get(&existing_eid)
            .map(|e| matches!(e.status, EntityStatus::Deleted))
            .unwrap_or(false);
        if !is_deleted {
            return Err(AppError::Validation(format!("学生 {} 已存在", name)));
        }
        // 复活: 把 status 改回 Active,清删除标记,保留 entity_id 和分数(分数在 scores.cache 里)
        if let Some(ent) = entities.entities.get_mut(&existing_eid) {
            ent.status = EntityStatus::Active;
            ent.metadata.remove("deleted_at");
            ent.metadata.remove("delete_reason");
        }
        save_entities(&entities)?;
        println!("✓ 学生已恢复: {} ({}) (从软删状态复活)", name, existing_eid);
        return Ok(());
    }
    let entity_id = format!("ent_{}", generate_event_id().trim_start_matches("evt_"));
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    let entity = Entity {
        id: entity_id.clone(), name: name.to_string(), aliases: vec![],
        status: EntityStatus::Active, created_at: now, metadata: HashMap::new(),
        groups: vec![], roles: vec![], class_id: None,
    };
    entities.entities.insert(entity_id.clone(), entity);
    index.insert(name.to_string(), entity_id.clone());
    save_entities(&entities)?;
    save_name_index(&index)?;
    println!("✓ 学生已添加: {} ({})", name, entity_id);
    Ok(())
}

pub fn cmd_delete_student(name: &str, confirm: bool, reason: &str, dry_run: bool) -> Result<(), AppError> {
    let _lock = FileLock::acquire()?;
    let mut entities = load_entities()?;
    let index = load_name_index()?;
    let eid = resolve_entity_id(name, &index)?;
    // v3.2.1: 只加载该学生事件 (不全量 load_events), 用于计数和确认
    let student_events = load_events_for_entity(&eid)?;
    let active_count = student_events.iter().filter(|e| e.reverted_by.is_none() && e.is_valid).count();
    if !confirm {
        println!("⚠️ 需要使用 --confirm 确认"); println!("   学生: {} | 事件: {} 条", name, active_count);
        return Ok(());
    }
    if dry_run { println!("[DRY-RUN] 删除: {} 事件:{}", name, active_count); return Ok(()); }
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();

    // v3.1.3 fix: 软删除而非物理删除,避免孤立事件导致 validate 报错
    // v3.2.1: 流式软删除 — 不全量 load_events 到 Vec, 逐行修改匹配事件
    let tombstone_tag = format!("tombstone:deleted:{}", eid);
    let event_count = soft_delete_events_for_entity(&eid, &tombstone_tag)?;

    if let Some(ent) = entities.entities.get_mut(&eid) {
        ent.status = EntityStatus::Deleted;
        ent.metadata.insert("deleted_at".to_string(), serde_json::Value::String(now.clone()));
        ent.metadata.insert("delete_reason".to_string(), serde_json::Value::String(reason.to_string()));
    }
    save_entities(&entities)?;
    // 保留 index,仅当用户调用 add-student 同名时才覆盖;此处不 remove(name)

    // v3.1.4: 从 scores.cache.json 移除该学生(下次 load 会补全为 BASE_SCORE)
    // v3.2.1: 用 _nolock 变体避免 SharedFileLock + FileLock 死锁
    {
        let mut scores = load_scores_cache_nolock()?;
        scores.remove(&eid);
        if let Err(e) = save_scores_cache(&scores) { eprintln!("[cache] warn: save scores cache failed: {}", e); }
    }

    // v3.2.1: 修复预存 bug — event_stats cache 也需要更新 (该学生事件全部 is_valid=false)
    {
        let mut stats = load_event_stats_cache_nolock()?;
        if let Some(s) = stats.get_mut(&eid) {
            s.count = 0;
        }
        if let Err(e) = save_event_stats_cache(&stats) { eprintln!("[cache] warn: save event_stats cache failed: {}", e); }
    }

    if let Err(e) = append_operation_log(&serde_json::json!({"action":"delete_student","entity_id":eid,"name":name,"reason":reason,"timestamp":now,"soft":true})) { eprintln!("[log] warn: append_operation_log failed: {}", e); }
    println!("✓ 学生已软删除: {} (保留{}条历史事件,is_valid=false)", name, event_count);
    Ok(())
}

pub fn cmd_import(file: &str) -> Result<(), AppError> {
    let _lock = FileLock::acquire()?;
    let mut entities = load_entities()?;
    let mut index = load_name_index()?;
    let content = std::fs::read_to_string(file)?;
    let names: Vec<String> = serde_json::from_str(&content)?;
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    let mut added = 0; let mut skipped = 0;
    for name in &names {
        if index.contains_key(name) { skipped += 1; continue; }
        let entity_id = format!("ent_{}", generate_event_id().trim_start_matches("evt_"));
        let entity = Entity {
            id: entity_id.clone(), name: name.clone(), aliases: vec![],
            status: EntityStatus::Active, created_at: now.clone(), metadata: HashMap::new(),
            groups: vec![], roles: vec![], class_id: None,
        };
        entities.entities.insert(entity_id.clone(), entity);
        index.insert(name.clone(), entity_id);
        added += 1;
    }
    save_entities(&entities)?; save_name_index(&index)?;
    println!("✓ 导入完成: {} 添加, {} 跳过", added, skipped);
    Ok(())
}

pub fn cmd_export(format: &str, output_path: Option<&str>) -> Result<(), AppError> {
    // v3.2.0: 用 LightContext (不加载 events), 避免 O(n) 全量 load_events
    let ctx = LightContext::load()?;
    let mut sorted: Vec<_> = ctx.scores.iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let out_file = output_path.unwrap_or("-");

    match format {
        "csv" => {
            let mut csv = String::from("姓名,分数,变动,风险\n");
            for (eid, score) in &sorted {
                let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
                let safe_name = csv_escape(name);
                csv.push_str(&format!("{},{:.1},{:+.1},{}\n", safe_name, score, **score - BASE_SCORE, risk_level(**score)));
            }
            if out_file == "-" { println!("{}", csv); }
            else { std::fs::write(out_file, &csv)?; println!("✓ CSV已导出: {}", out_file); }
        }
        "jsonl" => {
            let mut lines = Vec::new();
            for (eid, score) in &sorted {
                let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
                lines.push(serde_json::json!({"name":name,"score":score,"delta":**score-BASE_SCORE,"risk":risk_level(**score)}).to_string());
            }
            let content = lines.join("\n");
            if out_file == "-" { println!("{}", content); }
            else { std::fs::write(out_file, &content)?; println!("✓ JSONL已导出: {}", out_file); }
        }
        "html" => {
            let html = generate_dashboard_html(&ctx, &sorted)?;
            if out_file == "-" { println!("{}", html); }
            else { std::fs::write(out_file, &html)?; println!("✓ HTML已导出: {}", out_file); }
        }
        _ => return Err(AppError::Validation(format!("未知导出格式: {}。支持: csv, jsonl, html", format))),
    }
    Ok(())
}

// === NEW: summary command ===
pub fn cmd_summary(since: Option<&str>, until: Option<&str>, output: OutputMode) -> Result<(), AppError> {
    // v3.1.5: 流式统计事件, 不全量加载到 Vec; scores/risk 用 LightContext cache
    let (total, bonus_count, deduct_count, bonus_total, deduct_total, code_counts) =
        stream_event_summary(since, until)?;

    let ctx = LightContext::load()?;

    // Risk distribution
    let mut risk_dist = HashMap::new();
    risk_dist.insert("极高", 0usize); risk_dist.insert("高", 0); risk_dist.insert("中", 0); risk_dist.insert("低", 0);
    for score in ctx.scores.values() {
        let key = risk_level(*score);
        *risk_dist.get_mut(key).unwrap() += 1;
    }

    // Top reason codes
    let mut top_codes: Vec<_> = code_counts.iter().collect();
    top_codes.sort_by(|a, b| b.1.cmp(a.1));

    // Students with biggest changes
    let mut deltas: Vec<(&String, f64)> = ctx.scores.iter().map(|(k, v)| (k, *v - BASE_SCORE)).collect();
    deltas.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let top_gainers: Vec<serde_json::Value> = deltas.iter().take(5).map(|(eid, d)| {
        let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
        let class_id = ctx.entities.entities.get(eid.as_str())
            .and_then(|e| e.class_id.clone());
        serde_json::json!({"name":name,"entity_id":eid,"class_id":class_id,"delta":d})
    }).collect();
    let top_losers: Vec<serde_json::Value> = deltas.iter().rev().take(5).map(|(eid, d)| {
        let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
        let class_id = ctx.entities.entities.get(eid.as_str())
            .and_then(|e| e.class_id.clone());
        serde_json::json!({"name":name,"entity_id":eid,"class_id":class_id,"delta":d})
    }).collect();

    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "period": {"since": since, "until": until},
                "events": {"total": total, "bonus_count": bonus_count, "deduct_count": deduct_count,
                    "bonus_total": bonus_total, "deduct_total": deduct_total},
                "risk_distribution": risk_dist,
                "top_reason_codes": top_codes.iter().take(5).map(|(c,n)| serde_json::json!({"code":c,"count":n})).collect::<Vec<_>>(),
                "top_gainers": top_gainers,
                "top_losers": top_losers,
            }));
        }
        OutputMode::Text => {
            println!("╔══════════════════════════════════════╗");
            println!("║       EAA 区间汇总 v3.1.2            ║");
            println!("╠══════════════════════════════════════╣");
            if let (Some(s), Some(u)) = (since, until) { println!("║ 区间: {} ~ {:<22}║", s, u); }
            println!("║ 事件数:     {:>4}                   ║", total);
            println!("║ 加分:       {:>4}次 总计{:+.1}          ║", bonus_count, bonus_total);
            println!("║ 扣分:       {:>4}次 总计{:+.1}          ║", deduct_count, deduct_total);
            println!("╠══════════════════════════════════════╣");
            println!("║ 风险分布:");
            for (k, v) in &risk_dist { println!("║   {:<10}{:>3}人", k, v); }
            println!("╠══════════════════════════════════════╣");
            println!("║ TOP原因码:");
            for (code, count) in top_codes.iter().take(5) { println!("║   {:<28}{:>3}次", code, count); }
            println!("╚══════════════════════════════════════╝");
        }
    }
    Ok(())
}

// === NEW: set-student-meta ===
// clear_class_id 优先级高于 class_id：当 clear_class_id=true 时清空班级，忽略 class_id。
pub fn cmd_set_student_meta(name: &str, group: Option<&str>, role: Option<&str>, class_id: Option<&str>, clear_class_id: bool) -> Result<(), AppError> {
    let _lock = FileLock::acquire()?;
    let mut entities = load_entities()?;
    let index = load_name_index()?;
    let eid = resolve_entity_id(name, &index)?;
    let entity = entities.entities.get_mut(&eid)
        .ok_or_else(|| AppError::StudentNotFound(name.to_string()))?;

    if let Some(g) = group {
        if !entity.groups.contains(&g.to_string()) { entity.groups.push(g.to_string()); }
    }
    if let Some(r) = role {
        if !entity.roles.contains(&r.to_string()) { entity.roles.push(r.to_string()); }
    }
    if clear_class_id {
        entity.class_id = None;
    } else if let Some(c) = class_id { entity.class_id = Some(c.to_string()); }

    save_entities(&entities)?;
    let log_entry = serde_json::json!({
        "action":"set_student_meta","student":name,"group":group,"role":role,
        "class_id": if clear_class_id { None } else { class_id },
        "clear_class_id": clear_class_id,
        "timestamp":chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string()
    });
    if let Err(e) = append_operation_log(&log_entry) { eprintln!("[log] warn: append_operation_log failed: {}", e); }
    println!("✓ 学生属性已更新: {}", name);
    if let Some(g) = group { println!("  group: {}", g); }
    if let Some(r) = role { println!("  role: {}", r); }
    if clear_class_id {
        println!("  class_id: (已清空)");
    } else if let Some(c) = class_id { println!("  class_id: {}", c); }
    Ok(())
}

// === NEW: dashboard (static HTML) ===
pub fn cmd_dashboard(output_dir: Option<&str>, open_browser: bool) -> Result<(), AppError> {
    // v3.2.0: 用 LightContext (不加载 events), 避免 O(n) 全量 load_events
    let ctx = LightContext::load()?;
    let mut sorted: Vec<_> = ctx.scores.iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    let dir = output_dir.unwrap_or("./eaa-dashboard");
    std::fs::create_dir_all(dir)?;
    let html = generate_dashboard_html(&ctx, &sorted)?;
    let index_path = format!("{}/index.html", dir);
    std::fs::write(&index_path, &html)?;

    println!("✓ 仪表盘已生成: {}", index_path);
    if open_browser {
        #[cfg(target_os = "linux")]
        { let _ = std::process::Command::new("xdg-open").arg(&index_path).spawn(); }
        #[cfg(target_os = "macos")]
        { let _ = std::process::Command::new("open").arg(&index_path).spawn(); }
    }
    Ok(())
}

fn generate_dashboard_html(ctx: &LightContext, sorted: &Vec<(&String, &f64)>) -> Result<String, AppError> {
    // v3.2.0: 用 LightContext (不加载 events), 用 count_events() 流式计数代替 ctx.events.len()
    let total_e = count_events()?;
    let mut risk_dist = HashMap::new();
    risk_dist.insert("极高", 0usize); risk_dist.insert("高", 0); risk_dist.insert("中", 0); risk_dist.insert("低", 0);
    for score in ctx.scores.values() { *risk_dist.get_mut(risk_level(*score)).unwrap() += 1; }

    let names: Vec<&str> = sorted.iter().map(|(eid,_)| ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?")).collect();
    let scores: Vec<f64> = sorted.iter().map(|(_,s)|**s).collect();

    let mut rows = String::new();
    for (i,(eid,score)) in sorted.iter().enumerate() {
        let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
        let safe_name = html_escape(name);
        let cls = match risk_level(**score) { "极高"=>"risk-extreme", "高"=>"risk-high", "中"=>"risk-mid", _=>"risk-low" };
        rows.push_str(&format!("<tr><td>{}</td><td>{}</td><td>{:.1}</td><td class=\"{}\">{}</td></tr>\n", i+1, safe_name, score, cls, risk_level(**score)));
    }

    let rl = risk_dist.get("低").unwrap_or(&0);
    let rm = risk_dist.get("中").unwrap_or(&0);
    let rh = risk_dist.get("高").unwrap_or(&0);
    let rx = risk_dist.get("极高").unwrap_or(&0);
    let total_s = ctx.entities.entities.len();

    let html = format!(concat!(
        "<!DOCTYPE html><html lang='zh-CN'><head><meta charset='UTF-8'>",
        "<script src='https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js'></script>",
        "<style>body{{font-family:sans-serif;padding:20px;background:#f5f7fa}}",
        "h1{{text-align:center}}.card{{background:#fff;border-radius:8px;padding:20px;margin:16px 0;box-shadow:0 2px 8px rgba(0,0,0,.1)}}",
        ".stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}}",
        ".stat{{text-align:center;padding:16px;background:#f8f9fa;border-radius:8px}}",
        ".stat .num{{font-size:2em;font-weight:700}}.stat .label{{color:#7f8c8d}}",
        ".charts{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}",
        "table{{width:100%;border-collapse:collapse}}th,td{{padding:8px;border-bottom:1px solid #eee}}",
        ".risk-low{{color:#27ae60}}.risk-mid{{color:#f39c12}}.risk-high{{color:#e74c3c}}.risk-extreme{{color:#c0392b;font-weight:700}}",
        "</style></head><body><h1>EAA 操行分仪表盘</h1>",
        "<div class='card'><div class='stats'>",
        "<div class='stat'><div class='num'>{}</div><div class='label'>学生</div></div>",
        "<div class='stat'><div class='num'>{}</div><div class='label'>事件</div></div>",
        "<div class='stat'><div class='num'>{}</div><div class='label'>高风险</div></div>",
        "<div class='stat'><div class='num'>{}</div><div class='label'>低风险</div></div>",
        "</div></div>",
        "<div class='card charts'><div id='c1' style='height:400px'></div><div id='c2' style='height:400px'></div></div>",
        "<div class='card'><h3>排行榜</h3><table><tr><th>#</th><th>姓名</th><th>分数</th><th>风险</th></tr>{}</table></div>",
        "<script>var n={},s={};",
        "echarts.init(document.getElementById('c1')).setOption({{title:{{text:'分数分布'}},xAxis:{{data:n}},yAxis:{{}},series:[{{type:'bar',data:s}}]}});",
        "echarts.init(document.getElementById('c2')).setOption({{series:[{{type:'pie',radius:['40%','70%'],data:[{{value:{},name:'低'}},{{value:{},name:'中'}},{{value:{},name:'高'}},{{value:{},name:'极高'}}]}}]}});",
        "</script></body></html>"
    ),
    total_s, total_e, rh+rx, rl,
    rows,
    serde_json::to_string(&names).unwrap(), serde_json::to_string(&scores).unwrap(),
    rl, rm, rh, rx
    );
    Ok(html)
}

/// HTML 转义：防止 XSS（学生姓名等用户输入拼入 HTML 时）
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

/// CSV 公式注入防护：对以 =/+/-/@ 开头的字段前缀加单引号
fn csv_escape(s: &str) -> String {
    if s.starts_with('=') || s.starts_with('+') || s.starts_with('-') || s.starts_with('@') {
        format!("'{}", s)
    } else {
        s.to_string()
    }
}

// === Enhanced doctor ===
pub fn cmd_doctor(output: OutputMode, fix: bool) -> Result<(), AppError> {
    let mut ok = 0; let mut warn = 0; let mut issues = Vec::new();
    let data_dir = get_data_dir();
    if data_dir.exists() { ok += 1; } else { warn += 1; issues.push(format!("数据目录不存在: {}", data_dir.display())); }
    let schema_path = get_schema_dir().join("reason_codes.json");
    if schema_path.exists() { ok += 1; } else { warn += 1; issues.push("原因码Schema缺失".into()); }
    // v3.2.2 fix: events 文件可能是 events.jsonl (新格式) 或 events.json (旧格式), 两者都检查
    for (name, path) in [("entities","entities/entities.json"),("name_index","entities/name_index.json")] {
        if data_dir.join(path).exists() { ok += 1; } else { warn += 1; issues.push(format!("{} 文件缺失", name)); }
    }
    let events_jsonl = data_dir.join("events/events.jsonl");
    let events_json = data_dir.join("events/events.json");
    if events_jsonl.exists() || events_json.exists() {
        ok += 1;
    } else {
        warn += 1;
        issues.push("events 文件缺失".into());
    }

    let entities_result = load_entities();
    let ent_count = match &entities_result { Ok(e) => { ok += 1; e.entities.len() } Err(e) => { warn += 1; issues.push(format!("实体加载失败: {}", e)); 0 } };

    // v3.2.2: 用 stream_doctor_check 替代 load_events() + 手动循环
    // 避免 200K 事件 ~200MB Vec 分配, 3 项检查在一次流式扫描中完成
    let (evt_count, orphan_events, max_batch, dup_ids) = match &entities_result {
        Ok(entities) => {
            let entity_ids: std::collections::HashSet<String> = entities.entities.keys().cloned().collect();
            match stream_doctor_check(&entity_ids) {
                Ok((total, orphan, batch, dup)) => { ok += 1; (total, orphan, batch, dup) }
                Err(e) => { warn += 1; issues.push(format!("事件流式检查失败: {}", e)); (0, 0, 0, 0) }
            }
        }
        Err(_) => (0, 0, 0, 0),
    };

    // 孤立事件检查
    if orphan_events > 0 { warn += 1; issues.push(format!("{} 条孤立事件(entity_id无对应实体)", orphan_events)); }
    else { ok += 1; }

    // 批量异常检查
    if max_batch > 50 { warn += 1; issues.push(format!("异常批量: 单分钟最多{}条事件（阈值50）", max_batch)); }
    else { ok += 1; if max_batch > 20 { issues.push(format!("ℹ 批量录入: 单分钟{}条事件（正常操作）", max_batch)); } }

    // event_id 唯一性检查
    if dup_ids > 0 { warn += 1; issues.push(format!("{} 个重复event_id", dup_ids)); }
    else { ok += 1; }

    // v3.2.8: 孤儿有效事件检查 — 已删除学生的有效事件 (is_valid=true && !reverted && reason!='REVERT')
    // 这种事件导致 stats.total_delta 与 listStudents delta 之和不一致
    if let Ok(entities) = &entities_result {
        let deleted_ids: std::collections::HashSet<String> = entities.entities.iter()
            .filter(|(_, e)| matches!(e.status, EntityStatus::Deleted))
            .map(|(k, _)| k.clone())
            .collect();
        if !deleted_ids.is_empty() {
            match stream_check_orphan_valid_events(&deleted_ids) {
                Ok((count, delta_sum, _)) => {
                    if count > 0 {
                        if fix {
                            // 修复模式: 对每个已删除 entity 调用 soft_delete_events_for_entity
                            let mut fixed_count = 0usize;
                            for eid in &deleted_ids {
                                let tombstone_tag = format!("tombstone:deleted:{}", eid);
                                match soft_delete_events_for_entity(eid, &tombstone_tag) {
                                    Ok(n) => fixed_count += n,
                                    Err(e) => {
                                        warn += 1;
                                        issues.push(format!("修复 entity {} 失败: {}", eid, e));
                                    }
                                }
                            }
                            if fixed_count > 0 {
                                ok += 1;
                                issues.push(format!(
                                    "✓ 已修复 {} 条孤儿有效事件 (软删除)",
                                    fixed_count
                                ));
                                // 修复后删除缓存文件,下次查询会自动重建
                                let cache_dir = get_data_dir().join("entities");
                                for cache_file in ["scores.cache.json", "event_stats.cache.json", "daily_dedup.cache.json"] {
                                    let p = cache_dir.join(cache_file);
                                    if p.exists() {
                                        let _ = std::fs::remove_file(&p);
                                    }
                                }
                            } else {
                                ok += 1;
                            }
                        } else {
                            warn += 1;
                            issues.push(format!(
                                "{} 条孤儿有效事件 (已删除学生但仍 is_valid=true, delta 和={:+.1}) — 建议用 eaa doctor --fix 修复",
                                count, delta_sum
                            ));
                        }
                    } else {
                        ok += 1;
                    }
                }
                Err(e) => { warn += 1; issues.push(format!("孤儿有效事件检查失败: {}", e)); }
            }
        } else {
            ok += 1;
        }
    } else {
        ok += 1;
    }

    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "healthy": warn == 0, "passed": ok, "failed": warn,
                "students": ent_count, "events": evt_count, "issues": issues,
            }));
        }
        OutputMode::Text => {
            for i in &issues { println!("⚠️ {}", i); }
            println!("\n诊断结果: {} 通过, {} 异常", ok, warn);
        }
    }
    Ok(())
}
