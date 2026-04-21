use crate::storage::*;
use crate::types::*;
use crate::validation::*;
use std::collections::HashMap;

/// Format a single event for display
fn print_event_line(evt: &Event, id_to_name: &std::collections::HashMap<String, String>) {
    let name = id_to_name.get(&evt.entity_id).map(|s| s.as_str()).unwrap_or("?");
    let date = if evt.timestamp.len() >= 10 { &evt.timestamp[..10] } else { &evt.timestamp };
    println!("{:<10} {:<12} [{:<25}] {:<24} {:+.1}",
        name, date, evt.reason_code, evt.original_reason, evt.score_delta);
}

/// Show system info
pub fn cmd_info() -> Result<(), AppError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let data_dir = get_data_dir();
    println!("╔══════════════════════════════════════╗");
    println!("║     EAA 事件溯源操行分系统 v2.0    ║");
    println!("╠══════════════════════════════════════╣");
    println!("║ 学生总数: {:>4}                       ║", entities.entities.len());
    println!("║ 事件总数: {:>4}                       ║", events.len());
    println!("║ 数据目录: {:<26}║", data_dir.display());
    println!("╚══════════════════════════════════════╝");
    Ok(())
}

/// Validate all events against schema and entity references
pub fn cmd_validate() -> Result<(), AppError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let codes = load_reason_codes()?;
    let entity_ids: std::collections::HashSet<&str> = entities.entities.keys().map(|k| k.as_str()).collect();
    let mut errors = 0;
    for evt in &events {
        if !codes.codes.contains_key(&evt.reason_code) {
            println!("✗ {} unknown reason_code: {}", evt.event_id, evt.reason_code);
            errors += 1;
        }
        if evt.entity_id.is_empty() {
            println!("✗ {} empty entity_id", evt.event_id);
            errors += 1;
        }
        if !entity_ids.contains(evt.entity_id.as_str()) {
            println!("✗ {} unknown entity_id: {}", evt.event_id, evt.entity_id);
            errors += 1;
        }
        if evt.reverted_by.is_none() && (evt.score_delta < -50.0 || evt.score_delta > 50.0) {
            println!("⚠ {} extreme delta: {:+.1}", evt.event_id, evt.score_delta);
        }
    }
    if errors == 0 {
        println!("✓ All {} events valid", events.len());
    } else {
        println!("✗ {} errors found", errors);
    }
    Ok(())
}

/// Replay all events and display score ranking
pub fn cmd_replay() -> Result<(), AppError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let scores = compute_scores(&entities.entities, &events);
    let index = load_name_index()?;
    let id_to_name = build_id_to_name(&index);
    let mut sorted: Vec<_> = scores.iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap());
    println!("{:<20} {:>8} {:>6}", "姓名", "分数", "变动");
    println!("{}", "-".repeat(36));
    for (eid, score) in &sorted {
        let name = id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
        let delta = **score - BASE_SCORE;
        println!("{:<20} {:>8.1} {:>+6.1}", name, score, delta);
    }
    Ok(())
}

/// Show event timeline for a student
pub fn cmd_history(name: &str) -> Result<(), AppError> {
    let index = load_name_index()?;
    let eid = resolve_entity_id(name, &index)?;
    let events = load_events()?;
    let student_events: Vec<_> = events.iter().filter(|e| e.entity_id == eid).collect();
    if student_events.is_empty() {
        println!("无事件记录");
    } else {
        println!("{} 的事件时间线 ({}条):", name, student_events.len());
        println!("{}", "-".repeat(60));
        let mut running = BASE_SCORE;
        for evt in &student_events {
            running += evt.score_delta;
            println!("{:<12} {:>+6.1} → {:>6.1}  [{}] {}",
                &evt.timestamp[..10], evt.score_delta, running,
                evt.reason_code, evt.original_reason);
            if !evt.note.is_empty() {
                println!("             📝 {}", evt.note);
            }
        }
    }
    Ok(())
}

/// Show top-N ranking
pub fn cmd_ranking(n: usize) -> Result<(), AppError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let scores = compute_scores(&entities.entities, &events);
    let index = load_name_index()?;
    let id_to_name = build_id_to_name(&index);
    let mut sorted: Vec<_> = scores.into_iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    println!("排行榜 Top {}:", n.min(sorted.len()));
    println!("{:<4} {:<20} {:>8}", "排名", "姓名", "分数");
    println!("{}", "-".repeat(34));
    for (i, (eid, score)) in sorted.iter().take(n).enumerate() {
        let name = id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
        println!("{:<4} {:<20} {:>8.1}", i + 1, name, score);
    }
    Ok(())
}

/// Query single student score
pub fn cmd_score(name: &str) -> Result<(), AppError> {
    let entities = load_entities()?;
    let index = load_name_index()?;
    let eid = resolve_entity_id(name, &index)?;
    let events = load_events()?;
    let scores = compute_scores(&entities.entities, &events);
    let score = scores.get(&eid).unwrap_or(&0.0);
    let entity = entities.entities.get(&eid).unwrap();
    let risk = entity.metadata.get("risk").and_then(|v| v.as_str()).unwrap_or("未知");
    println!("{}: {:.1} 分 (风险: {})", name, score, risk);
    Ok(())
}

/// Add a new conduct event with strict validation
pub fn cmd_add(name: &str, reason_code: &str, tags: &str, delta: f64, note: &str,
              operator: Option<&str>, dry_run: bool, force: bool) -> Result<(), AppError> {
    // Validate reason_code exists in schema
    let codes = load_reason_codes()?;
    if !codes.codes.contains_key(reason_code) {
        return Err(AppError::Validation(format!("未知原因码: {}", reason_code)));
    }
    // Check standard delta match
    let code_def = codes.codes.get(reason_code).unwrap();
    let expected = code_def.score_delta;
    if expected.is_some() && (delta - expected.unwrap()).abs() > 0.001 && !force {
        println!("⚠️ 原因码 {} 标准分值: {:?}，当前 delta: {:.1}", reason_code, expected, delta);
        println!("   使用 --force 强制执行");
        return Err(AppError::Validation(format!(
            "原因码 {} 标准分值: {:?}，当前: {:.1}", reason_code, expected, delta
        )));
    }

    // Validate delta range
    validate_delta(delta, force)?;

    // Resolve student
    let index = load_name_index()?;
    let eid = resolve_entity_id(name, &index)?;

    // Dedup check: same student + same reason_code + same date
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let all_events = load_events()?;
    let duplicate = all_events.iter().any(|e| {
        e.entity_id == eid &&
        e.reason_code == reason_code &&
        e.timestamp.starts_with(&today) &&
        e.reverted_by.is_none()
    });
    if duplicate {
        return Err(AppError::Validation("重复事件：同一学生今日同一原因码已存在".into()));
    }

    let new_id = generate_event_id();
    let tag_list: Vec<String> = if tags.is_empty() { vec![] } else { tags.split(',').map(|s| s.trim().to_string()).collect() };
    let op = get_operator(operator);
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();

    let new_event = Event {
        event_id: new_id.clone(),
        entity_id: eid,
        event_type: if delta >= 0.0 { EventType::ConductBonus } else { EventType::ConductDeduct },
        category_tags: tag_list,
        reason_code: reason_code.to_string(),
        original_reason: reason_code.to_string(),
        score_delta: delta,
        evidence_ref: "cli:manual".to_string(),
        operator: op.clone(),
        timestamp: now.clone(),
        is_valid: true,
        reverted_by: None,
        note: note.to_string(),
    };

    if dry_run {
        println!("[DRY-RUN] 将创建事件:");
        println!("  event_id: {}", new_event.event_id);
        println!("  student:  {}", name);
        println!("  code:     {}", reason_code);
        println!("  delta:    {:+.1}", delta);
        println!("  operator: {}", op);
        println!("  note:     {}", note);
        return Ok(());
    }

    println!("✓ 事件已创建: {} {} {:+.1}", new_event.event_id, name, delta);

    let _lock = FileLock::acquire()?;
    let mut all_events = load_events()?;
    all_events.push(new_event);
    save_events(&all_events)?;

    let log_entry = serde_json::json!({
        "action": "add",
        "event_id": new_id,
        "student": name,
        "reason_code": reason_code,
        "delta": delta,
        "operator": op,
        "timestamp": now,
    });
    if let Err(e) = append_operation_log(&log_entry) {
        eprintln!("⚠️ 操作日志写入失败: {}", e);
    }

    Ok(())
}

/// Revert an existing event
pub fn cmd_revert(event_id: &str, reason: &str, operator: Option<&str>,
                  dry_run: bool) -> Result<(), AppError> {
    let _lock = FileLock::acquire()?;
    let mut all_events = load_events()?;

    let target_idx = all_events.iter().position(|e| e.event_id == event_id)
        .ok_or_else(|| AppError::EventNotFound(event_id.to_string()))?;

    can_revert(&all_events[target_idx].reverted_by, event_id, &all_events[target_idx].reason_code)?;

    let target = &all_events[target_idx];
    let entity_id = target.entity_id.clone();
    let score_delta = target.score_delta;

    if dry_run {
        println!("[DRY-RUN] 将撤销事件:");
        println!("  target:   {}", event_id);
        println!("  delta:    {:+.1} → {:+.1}", score_delta, -score_delta);
        println!("  reason:   {}", reason);
        return Ok(());
    }

    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    let revert_id = generate_event_id();
    let op = get_operator(operator);
    let revert_event = Event {
        event_id: revert_id.clone(),
        entity_id,
        event_type: if score_delta >= 0.0 { EventType::ConductDeduct } else { EventType::ConductBonus },
        category_tags: vec!["系统纠正".to_string()],
        reason_code: "REVERT".to_string(),
        original_reason: format!("撤销 {}", event_id),
        score_delta: -score_delta,
        evidence_ref: format!("revert:{}", event_id),
        operator: op.clone(),
        timestamp: now.clone(),
        is_valid: true,
        reverted_by: None,
        note: reason.to_string(),
    };

    all_events[target_idx].reverted_by = Some(revert_id.clone());
    all_events.push(revert_event);
    save_events(&all_events)?;

    println!("✓ 撤销事件: {} 对冲 {}", revert_id, event_id);

    let log_entry = serde_json::json!({
        "action": "revert",
        "revert_id": revert_id,
        "target_id": event_id,
        "operator": op,
        "timestamp": now,
    });
    if let Err(e) = append_operation_log(&log_entry) {
        eprintln!("⚠️ 操作日志写入失败: {}", e);
    }

    Ok(())
}

/// List all reason codes from schema
pub fn cmd_codes() -> Result<(), AppError> {
    let codes = load_reason_codes()?;
    let mut sorted: Vec<_> = codes.codes.iter().collect();
    sorted.sort_by(|a, b| {
        let da = a.1.score_delta.unwrap_or(0.0);
        let db = b.1.score_delta.unwrap_or(0.0);
        db.partial_cmp(&da).unwrap()
    });
    println!("{:<25} {:>6}  {}", "代码", "标准分", "说明");
    println!("{}", "-".repeat(50));
    for (code, def) in &sorted {
        let delta = match def.score_delta {
            Some(d) => format!("{:+.0}", d),
            None => "变量".to_string(),
        };
        println!("{:<25} {:>6}  {}", code, delta, def.label);
    }
    Ok(())
}

/// Search events by keyword with limit
pub fn cmd_search(query: &str, limit: usize) -> Result<(), AppError> {
    let events = load_events()?;
    let index = load_name_index()?;
    let id_to_name = build_id_to_name(&index);
    let query_upper = query.to_uppercase();
    let mut results: Vec<&Event> = Vec::new();

    for evt in &events {
        let name = id_to_name.get(&evt.entity_id).map(|s| s.as_str()).unwrap_or("");
        let name_match = name.contains(query);
        let code_match = evt.reason_code == query_upper || evt.reason_code.contains(&query_upper);
        let tag_match = evt.category_tags.iter().any(|t| t.contains(query));
        let reason_match = evt.original_reason.contains(query);
        if name_match || code_match || tag_match || reason_match {
            results.push(evt);
        }
    }

    if results.is_empty() {
        println!("未找到与 \"{}\" 相关的事件", query);
        return Ok(());
    }

    let is_name = index.contains_key(query);
    let is_code = results.iter().all(|e| e.reason_code == query_upper);

    if is_name {
        println!("{} 的所有事件 ({}条):", query, results.len());
    } else if is_code {
        println!("找到 {} 条[{}]事件:", results.len(), query_upper);
    } else {
        println!("找到 {} 条\"{}\"相关事件:", results.len(), query);
    }
    println!("{}", "-".repeat(75));
    let display_count = results.len().min(limit);
    for evt in results.iter().take(display_count) {
        print_event_line(evt, &id_to_name);
    }
    if results.len() > limit {
        println!("... (共{}条，显示前{}条，--limit 调整)", results.len(), limit);
    }
    Ok(())
}

/// Show statistics summary
pub fn cmd_stats() -> Result<(), AppError> {
    let entities = load_entities()?;
    let events = load_events()?;

    let valid: Vec<_> = events.iter().filter(|e| e.is_valid && e.reverted_by.is_none()).collect();
    let reverted: Vec<_> = events.iter().filter(|e| e.reverted_by.is_some()).collect();
    let total_delta: f64 = valid.iter().map(|e| e.score_delta).sum();

    println!("╔══════════════════════════════════════╗");
    println!("║       EAA 数据统计 v2.0            ║");
    println!("╠══════════════════════════════════════╣");
    println!("║ 学生总数:     {:>4}                   ║", entities.entities.len());
    println!("║ 事件总数:    {:>4}                   ║", events.len());
    println!("║ 有效事件:    {:>4}                   ║", valid.len());
    println!("║ 撤销事件:      {:>4}                   ║", reverted.len());
    println!("║ 总变动:    {:>+6.1}                  ║", total_delta);
    println!("╠══════════════════════════════════════╣");
    println!("║ 各原因码统计:");

    let mut code_counts: HashMap<&str, usize> = HashMap::new();
    for e in &valid {
        *code_counts.entry(&e.reason_code).or_insert(0) += 1;
    }
    let mut sorted_codes: Vec<_> = code_counts.iter().collect();
    sorted_codes.sort_by(|a, b| b.1.cmp(a.1));
    for (code, count) in sorted_codes.iter().take(8) {
        println!("║   {:<28}{:>3}次", format!("{}", code), count);
    }
    println!("╚══════════════════════════════════════╝");
    Ok(())
}

/// Tag management
pub fn cmd_tag(tag: &str) -> Result<(), AppError> {
    let events = load_events()?;
    let index = load_name_index()?;
    let id_to_name = build_id_to_name(&index);

    let mut tag_counts: HashMap<&str, usize> = HashMap::new();
    for evt in &events {
        for t in &evt.category_tags {
            *tag_counts.entry(t).or_insert(0) += 1;
        }
    }

    if tag.is_empty() {
        println!("所有标签:");
        println!("{}", "-".repeat(30));
        let mut sorted: Vec<_> = tag_counts.iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(a.1));
        for (t, c) in sorted {
            println!("  {:<20}{}次", t, c);
        }
        return Ok(());
    }

    let matched: Vec<&Event> = events.iter()
        .filter(|e| e.category_tags.iter().any(|t| t == tag))
        .collect();

    if matched.is_empty() {
        println!("标签 [{}] 下无事件", tag);
        return Ok(());
    }
    println!("标签 [{}] 的事件 ({}条):", tag, matched.len());
    println!("{}", "-".repeat(75));
    for evt in &matched {
        print_event_line(evt, &id_to_name);
    }
    Ok(())
}

/// Query events in a date range with limit
pub fn cmd_range(start: &str, end: &str, limit: usize) -> Result<(), AppError> {
    let events = load_events()?;
    let index = load_name_index()?;
    let id_to_name = build_id_to_name(&index);
    let matched: Vec<&Event> = events.iter()
        .filter(|e| {
            let date = if e.timestamp.len() >= 10 { &e.timestamp[..10] } else { &e.timestamp };
            date >= start && date <= end
        })
        .collect();

    if matched.is_empty() {
        println!("{} ~ {} 之间无事件", start, end);
        return Ok(());
    }
    println!("{} ~ {} 的事件 ({}条):", start, end, matched.len());
    println!("{}", "-".repeat(75));
    for evt in matched.iter().take(limit) {
        print_event_line(evt, &id_to_name);
    }
    if matched.len() > limit {
        println!("... (共{}条，显示前{}条，--limit 调整)", matched.len(), limit);
    }
    Ok(())
}

/// List all students with scores
pub fn cmd_list_students() -> Result<(), AppError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let scores = compute_scores(&entities.entities, &events);
    let index = load_name_index()?;
    let id_to_name = build_id_to_name(&index);
    let mut sorted: Vec<_> = entities.entities.iter().collect::<Vec<_>>();
    sorted.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    println!("{:<20} {:>8} {:<10}", "姓名", "分数", "状态");
    println!("{}", "-".repeat(40));
    for (eid, ent) in &sorted {
        let score = scores.get(*eid).unwrap_or(&BASE_SCORE);
        let status = match ent.status {
            EntityStatus::Active => "在读",
            EntityStatus::Transferred => "转出",
            EntityStatus::Suspended => "休学",
        };
        let name = id_to_name.get(*eid).map(|s| s.as_str()).unwrap_or(&ent.name);
        println!("{:<20} {:>8.1} {:<10}", name, score, status);
    }
    println!("共 {} 名学生", entities.entities.len());
    Ok(())
}

/// Add a new student
pub fn cmd_add_student(name: &str) -> Result<(), AppError> {
    let _lock = FileLock::acquire()?;
    let mut entities = load_entities()?;
    let mut index = load_name_index()?;
    if index.contains_key(name) {
        return Err(AppError::Validation(format!("学生 {} 已存在", name)));
    }
    let entity_id = format!("ent_{}", generate_event_id().trim_start_matches("evt_"));
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    let entity = Entity {
        id: entity_id.clone(),
        name: name.to_string(),
        aliases: vec![],
        status: EntityStatus::Active,
        created_at: now,
        metadata: HashMap::new(),
    };
    entities.entities.insert(entity_id.clone(), entity);
    index.insert(name.to_string(), entity_id.clone());
    save_entities(&entities)?;
    save_name_index(&index)?;
    println!("✓ 学生已添加: {} ({})", name, entity_id);
    Ok(())
}

/// Import students from JSON file
pub fn cmd_import(file: &str) -> Result<(), AppError> {
    let _lock = FileLock::acquire()?;
    let mut entities = load_entities()?;
    let mut index = load_name_index()?;
    let content = std::fs::read_to_string(file)?;
    let names: Vec<String> = serde_json::from_str(&content)?;
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    let mut added = 0;
    let mut skipped = 0;
    for name in &names {
        if index.contains_key(name) { skipped += 1; continue; }
        let entity_id = format!("ent_{}", generate_event_id().trim_start_matches("evt_"));
        let entity = Entity {
            id: entity_id.clone(),
            name: name.clone(),
            aliases: vec![],
            status: EntityStatus::Active,
            created_at: now.clone(),
            metadata: HashMap::new(),
        };
        entities.entities.insert(entity_id.clone(), entity);
        index.insert(name.clone(), entity_id);
        added += 1;
    }
    save_entities(&entities)?;
    save_name_index(&index)?;
    println!("✓ 导入完成: {} 名添加, {} 名跳过(已存在)", added, skipped);
    Ok(())
}

/// Export all scores as CSV
pub fn cmd_export() -> Result<(), AppError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let scores = compute_scores(&entities.entities, &events);
    let index = load_name_index()?;
    let id_to_name = build_id_to_name(&index);
    let mut sorted: Vec<_> = scores.into_iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    println!("姓名,分数,变动");
    for (eid, score) in &sorted {
        let name = id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
        let delta = *score - BASE_SCORE;
        println!("{},{:.1},{:+.1}", name, score, delta);
    }
    Ok(())
}

/// Doctor check - validate environment health
pub fn cmd_doctor() -> Result<(), AppError> {
    let mut ok = 0;
    let mut warn = 0;

    // Check data dir
    let data_dir = get_data_dir();
    if data_dir.exists() {
        println!("✅ 数据目录: {}", data_dir.display()); ok += 1;
    } else {
        println!("❌ 数据目录不存在: {}", data_dir.display()); warn += 1;
    }

    // Check schema
    let schema_path = get_schema_dir().join("reason_codes.json");
    if schema_path.exists() {
        println!("✅ 原因码Schema: {}", schema_path.display()); ok += 1;
    } else {
        println!("❌ 原因码Schema缺失"); warn += 1;
    }

    // Check data files
    for (name, path) in [("entities", "entities/entities.json"), ("events", "events/events.json"), ("name_index", "entities/name_index.json")] {
        let full = data_dir.join(path);
        if full.exists() { ok += 1; } else { println!("⚠️ {} 文件缺失", name); warn += 1; }
    }

    // Check data integrity
    match load_entities() {
        Ok(e) => { println!("✅ 实体加载: {} 名学生", e.entities.len()); ok += 1; }
        Err(e) => { println!("❌ 实体加载失败: {}", e); warn += 1; }
    }
    match load_events() {
        Ok(ev) => { println!("✅ 事件加载: {} 条", ev.len()); ok += 1; }
        Err(e) => { println!("❌ 事件加载失败: {}", e); warn += 1; }
    }

    // Check file permissions
    let events_path = data_dir.join("events/events.json");
    if events_path.exists() {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(&events_path) {
            Ok(meta) => {
                let mode = meta.permissions().mode() & 0o777;
                if mode & 0o200 != 0 {
                    println!("✅ 事件文件可写"); ok += 1;
                } else {
                    println!("❌ 事件文件不可写 (mode: {:o})", mode); warn += 1;
                }
            }
            Err(e) => { println!("⚠️ 无法检查文件权限: {}", e); warn += 1; }
        }
    }

    println!("\n诊断结果: {} 通过, {} 异常", ok, warn);
    if warn > 0 { return Err(AppError::Validation(format!("发现 {} 个异常", warn))); }
    Ok(())
}
