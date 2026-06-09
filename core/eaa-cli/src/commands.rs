use crate::storage::*;
use crate::types::*;
use crate::validation::*;
use std::collections::HashMap;
use std::io::Write;

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

struct DataContext {
    entities: EntitiesFile,
    events: Vec<Event>,
    index: HashMap<String, String>,
    id_to_name: HashMap<String, String>,
    scores: HashMap<String, f64>,
}

impl DataContext {
    fn load() -> Result<Self, AppError> {
        let entities = load_entities()?;
        let events = load_events()?;
        let index = load_name_index()?;
        let id_to_name = build_id_to_name(&index);
        let scores = compute_scores(&entities.entities, &events);
        Ok(Self { entities, events, index, id_to_name, scores })
    }
}

pub fn cmd_info(output: OutputMode) -> Result<(), AppError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let data_dir = get_data_dir();
    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "version": "3.1.2",
                "students": entities.entities.len(),
                "events": events.len(),
                "data_dir": data_dir.display().to_string(),
            }));
        }
        OutputMode::Text => {
            println!("╔══════════════════════════════════════╗");
            println!("║     EAA 事件溯源操行分系统 v3.1.2    ║");
            println!("╠══════════════════════════════════════╣");
            println!("║ 学生总数: {:>4}                       ║", entities.entities.len());
            println!("║ 事件总数: {:>4}                       ║", events.len());
            println!("║ 数据目录: {:<26}║", data_dir.display());
            println!("╚══════════════════════════════════════╝");
        }
    }
    Ok(())
}

pub fn cmd_validate(output: OutputMode) -> Result<(), AppError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let codes = load_reason_codes()?;
    let entity_ids: std::collections::HashSet<&str> = entities.entities.keys().map(|k| k.as_str()).collect();
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    for evt in &events {
        if !codes.codes.contains_key(&evt.reason_code) {
            errors.push(format!("{} unknown reason_code: {}", evt.event_id, evt.reason_code));
        }
        if evt.entity_id.is_empty() {
            errors.push(format!("{} empty entity_id", evt.event_id));
        }
        if !entity_ids.contains(evt.entity_id.as_str()) {
            errors.push(format!("{} unknown entity_id: {}", evt.event_id, evt.entity_id));
        }
        if evt.reverted_by.is_none() && (evt.score_delta < -50.0 || evt.score_delta > 50.0) {
            warnings.push(format!("{} extreme delta: {:+.1}", evt.event_id, evt.score_delta));
        }
    }
    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "valid": errors.is_empty(),
                "total_events": events.len(),
                "errors": errors,
                "warnings": warnings,
            }));
        }
        OutputMode::Text => {
            for e in &errors { println!("✗ {}", e); }
            for w in &warnings { println!("⚠ {}", w); }
            if errors.is_empty() { println!("✓ All {} events valid", events.len()); }
            else { println!("✗ {} errors found", errors.len()); }
        }
    }
    Ok(())
}

pub fn cmd_replay(output: OutputMode) -> Result<(), AppError> {
    let ctx = DataContext::load()?;
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
    let ctx = DataContext::load()?;
    let eid = resolve_entity_id(name, &ctx.index)?;
    let student_events: Vec<&Event> = ctx.events.iter().filter(|e| e.entity_id == eid).collect();
    match output {
        OutputMode::Json => {
            let history = compute_cumulative_history(&eid, &ctx.events, BASE_SCORE);
            let score = ctx.scores.get(&eid).unwrap_or(&BASE_SCORE);
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
                for evt in &student_events {
                    running += evt.score_delta;
                    println!("{:<12} {:>+6.1} → {:>6.1}  [{}] {}",
                        &evt.timestamp[..10], evt.score_delta, running,
                        evt.reason_code, evt.original_reason);
                    if !evt.note.is_empty() { println!("             📝 {}", evt.note); }
                }
            }
        }
    }
    Ok(())
}

pub fn cmd_ranking(n: usize, output: OutputMode) -> Result<(), AppError> {
    let ctx = DataContext::load()?;
    let mut sorted: Vec<_> = ctx.scores.iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let take_n = n.min(sorted.len());
    match output {
        OutputMode::Json => {
            let ranking: Vec<serde_json::Value> = sorted.iter().take(take_n).enumerate().map(|(i, (eid, score))| {
                let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
                serde_json::json!({
                    "rank": i + 1, "name": name, "entity_id": eid,
                    "score": score, "delta": **score - BASE_SCORE, "risk": risk_level(**score),
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
    let ctx = DataContext::load()?;
    let eid = resolve_entity_id(name, &ctx.index)?;
    let score = ctx.scores.get(&eid).unwrap_or(&BASE_SCORE);
    let entity = ctx.entities.entities.get(&eid).unwrap();
    let risk = entity.metadata.get("risk").and_then(|v| v.as_str()).unwrap_or("未知");
    let student_events: Vec<&Event> = ctx.events.iter().filter(|e| e.entity_id == eid && e.reverted_by.is_none()).collect();
    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "name": name, "entity_id": eid, "score": score,
                "delta": *score - BASE_SCORE, "risk": risk_level(*score),
                "risk_stored": risk, "status": format!("{:?}", entity.status),
                "events_count": student_events.len(),
                "last_event_at": student_events.last().map(|e| e.timestamp.clone()).unwrap_or_default(),
                "groups": entity.groups, "roles": entity.roles, "class_id": entity.class_id,
            }));
        }
        OutputMode::Text => {
            println!("{}: {:.1} 分 (风险: {})", name, score, risk);
        }
    }
    Ok(())
}

// add, revert unchanged from v2 - keep as-is
pub fn cmd_add(name: &str, reason_code: &str, tags: &str, delta: f64, note: &str,
              operator: Option<&str>, dry_run: bool, force: bool) -> Result<(), AppError> {
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
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let all_events = load_events()?;
    let duplicate = all_events.iter().any(|e| {
        e.entity_id == eid && e.reason_code == reason_code &&
        e.timestamp.starts_with(&today) && e.reverted_by.is_none()
    });
    if duplicate {
        return Err(AppError::Validation("重复事件：同一学生今日同一原因码已存在".into()));
    }
    let new_id = generate_event_id();
    let tag_list: Vec<String> = if tags.is_empty() { vec![] } else { tags.split(',').map(|s| s.trim().to_string()).collect() };
    let op = get_operator(operator);
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    let new_event = Event {
        event_id: new_id.clone(), entity_id: eid,
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
    println!("✓ 事件已创建: {} {} {:+.1}", new_event.event_id, name, delta);
    let _lock = FileLock::acquire()?;
    let mut all_events = load_events()?;
    all_events.push(new_event);
    save_events(&all_events)?;
    let log_entry = serde_json::json!({"action":"add","event_id":new_id,"student":name,"reason_code":reason_code,"delta":delta,"operator":op,"timestamp":now});
    let _ = append_operation_log(&log_entry);
    Ok(())
}

pub fn cmd_revert(event_id: &str, reason: &str, operator: Option<&str>, dry_run: bool) -> Result<(), AppError> {
    let _lock = FileLock::acquire()?;
    let mut all_events = load_events()?;
    let target_idx = all_events.iter().position(|e| e.event_id == event_id)
        .ok_or_else(|| AppError::EventNotFound(event_id.to_string()))?;
    can_revert(&all_events[target_idx].reverted_by, event_id, &all_events[target_idx].reason_code)?;
    let entity_id = all_events[target_idx].entity_id.clone();
    let score_delta = all_events[target_idx].score_delta;
    if dry_run {
        println!("[DRY-RUN] target:{} delta:{:+.1}→{:+.1} reason:{}", event_id, score_delta, -score_delta, reason);
        return Ok(());
    }
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    let revert_id = generate_event_id();
    let op = get_operator(operator);
    let revert_event = Event {
        event_id: revert_id.clone(), entity_id,
        event_type: if score_delta >= 0.0 { EventType::ConductDeduct } else { EventType::ConductBonus },
        category_tags: vec!["系统纠正".to_string()], reason_code: "REVERT".to_string(),
        original_reason: format!("撤销 {}", event_id), score_delta: -score_delta,
        evidence_ref: format!("revert:{}", event_id), operator: op.clone(),
        timestamp: now.clone(), is_valid: true, reverted_by: None, note: reason.to_string(),
    };
    all_events[target_idx].reverted_by = Some(revert_id.clone());
    all_events.push(revert_event);
    save_events(&all_events)?;
    println!("✓ 撤销事件: {} 对冲 {}", revert_id, event_id);
    let _ = append_operation_log(&serde_json::json!({"action":"revert","revert_id":revert_id,"target_id":event_id,"operator":op,"timestamp":now}));
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
    let ctx = DataContext::load()?;
    let query_upper = query.to_uppercase();
    let mut results: Vec<&Event> = Vec::new();
    for evt in &ctx.events {
        let name = ctx.id_to_name.get(&evt.entity_id).map(|s| s.as_str()).unwrap_or("");
        if name.contains(query) || evt.reason_code.contains(&query_upper) ||
           evt.category_tags.iter().any(|t| t.contains(query)) || evt.original_reason.contains(query) {
            results.push(evt);
        }
    }
    if results.is_empty() { println!("未找到与 \"{}\" 相关的事件", query); return Ok(()); }
    match output {
        OutputMode::Json => {
            let items: Vec<serde_json::Value> = results.iter().take(limit).map(|e| event_to_json(e, &ctx.id_to_name)).collect();
            print_json(&serde_json::json!({"query":query,"total":results.len(),"showing":items.len(),"events":items}));
        }
        OutputMode::Text => {
            let is_name = ctx.index.contains_key(query);
            if is_name { println!("{} 的所有事件 ({}条):", query, results.len()); }
            else { println!("找到 {} 条\"{}\"相关事件:", results.len(), query); }
            println!("{}", "-".repeat(75));
            for evt in results.iter().take(limit) { print_event_line(evt, &ctx.id_to_name); }
            if results.len() > limit { println!("... (共{}条，显示前{}条)", results.len(), limit); }
        }
    }
    Ok(())
}

pub fn cmd_stats(output: OutputMode) -> Result<(), AppError> {
    let ctx = DataContext::load()?;
    let valid: Vec<_> = ctx.events.iter().filter(|e| e.is_valid && e.reverted_by.is_none()).collect();
    let reverted_count = ctx.events.iter().filter(|e| e.reverted_by.is_some()).count();
    let total_delta: f64 = valid.iter().map(|e| e.score_delta).sum();
    let mut code_counts: HashMap<&str, usize> = HashMap::new();
    for e in &valid { *code_counts.entry(&e.reason_code).or_insert(0) += 1; }
    let mut tag_counts: HashMap<&str, usize> = HashMap::new();
    for e in &valid { for t in &e.category_tags { *tag_counts.entry(t).or_insert(0) += 1; } }
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
            let mut code_dist: Vec<serde_json::Value> = code_counts.iter()
                .map(|(k, v)| serde_json::json!({"code":k,"count":v})).collect();
            code_dist.sort_by(|a, b| b["count"].as_u64().cmp(&a["count"].as_u64()));
            let mut tag_dist: Vec<serde_json::Value> = tag_counts.iter()
                .map(|(k, v)| serde_json::json!({"tag":k,"count":v})).collect();
            tag_dist.sort_by(|a, b| b["count"].as_u64().cmp(&a["count"].as_u64()));
            print_json(&serde_json::json!({
                "summary": {"students":ctx.entities.entities.len(),"total_events":ctx.events.len(),
                    "valid_events":valid.len(),"reverted_events":reverted_count,"total_delta":total_delta},
                "reason_distribution": code_dist, "tag_distribution": tag_dist, "score_intervals": intervals,
            }));
        }
        OutputMode::Text => {
            println!("╔══════════════════════════════════════╗");
            println!("║       EAA 数据统计 v3.1.2            ║");
            println!("╠══════════════════════════════════════╣");
            println!("║ 学生总数:     {:>4}                   ║", ctx.entities.entities.len());
            println!("║ 事件总数:    {:>4}                   ║", ctx.events.len());
            println!("║ 有效事件:    {:>4}                   ║", valid.len());
            println!("║ 撤销事件:      {:>4}                   ║", reverted_count);
            println!("║ 总变动:    {:>+6.1}                  ║", total_delta);
            println!("╠══════════════════════════════════════╣");
            println!("║ 分数区间:");
            for (k, v) in &intervals { println!("║   {:<30}{:>3}人", k, v); }
            println!("╠══════════════════════════════════════╣");
            println!("║ 原因码 TOP8:");
            let mut sc: Vec<_> = code_counts.iter().collect(); sc.sort_by(|a,b| b.1.cmp(a.1));
            for (code, count) in sc.iter().take(8) { println!("║   {:<28}{:>3}次", code, count); }
            println!("╚══════════════════════════════════════╝");
        }
    }
    Ok(())
}

pub fn cmd_tag(tag: &str, output: OutputMode) -> Result<(), AppError> {
    let ctx = DataContext::load()?;
    let mut tag_counts: HashMap<&str, usize> = HashMap::new();
    for evt in &ctx.events { for t in &evt.category_tags { *tag_counts.entry(t).or_insert(0) += 1; } }
    if tag.is_empty() {
        match output {
            OutputMode::Json => {
                let tags: Vec<serde_json::Value> = tag_counts.iter().map(|(k,v)| serde_json::json!({"tag":k,"count":v})).collect();
                print_json(&serde_json::json!({"tags":tags}));
            }
            OutputMode::Text => {
                println!("所有标签:"); println!("{}", "-".repeat(30));
                let mut s: Vec<_> = tag_counts.iter().collect(); s.sort_by(|a,b| b.1.cmp(a.1));
                for (t, c) in s { println!("  {:<20}{}次", t, c); }
            }
        }
        return Ok(());
    }
    let matched: Vec<&Event> = ctx.events.iter().filter(|e| e.category_tags.iter().any(|t| t == tag)).collect();
    if matched.is_empty() { println!("标签 [{}] 下无事件", tag); return Ok(()); }
    match output {
        OutputMode::Json => {
            let items: Vec<serde_json::Value> = matched.iter().map(|e| event_to_json(e, &ctx.id_to_name)).collect();
            print_json(&serde_json::json!({"tag":tag,"total":matched.len(),"events":items}));
        }
        OutputMode::Text => {
            println!("标签 [{}] 的事件 ({}条):", tag, matched.len());
            println!("{}", "-".repeat(75));
            for evt in &matched { print_event_line(evt, &ctx.id_to_name); }
        }
    }
    Ok(())
}

pub fn cmd_range(start: &str, end: &str, limit: usize, output: OutputMode) -> Result<(), AppError> {
    let ctx = DataContext::load()?;
    let matched: Vec<&Event> = ctx.events.iter()
        .filter(|e| { let d = if e.timestamp.len()>=10 {&e.timestamp[..10]} else {&e.timestamp}; d >= start && d <= end })
        .collect();
    if matched.is_empty() { println!("{} ~ {} 之间无事件", start, end); return Ok(()); }
    match output {
        OutputMode::Json => {
            let items: Vec<serde_json::Value> = matched.iter().take(limit).map(|e| event_to_json(e, &ctx.id_to_name)).collect();
            print_json(&serde_json::json!({"start":start,"end":end,"total":matched.len(),"showing":items.len(),"events":items}));
        }
        OutputMode::Text => {
            println!("{} ~ {} 的事件 ({}条):", start, end, matched.len());
            println!("{}", "-".repeat(75));
            for evt in matched.iter().take(limit) { print_event_line(evt, &ctx.id_to_name); }
            if matched.len() > limit { println!("... (共{}条)", matched.len()); }
        }
    }
    Ok(())
}

pub fn cmd_list_students(output: OutputMode) -> Result<(), AppError> {
    let ctx = DataContext::load()?;
    let mut sorted: Vec<_> = ctx.entities.entities.iter().collect::<Vec<_>>();
    sorted.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    match output {
        OutputMode::Json => {
            let students: Vec<serde_json::Value> = sorted.iter().map(|(eid, ent)| {
                let score = ctx.scores.get(*eid).unwrap_or(&BASE_SCORE);
                let name = ctx.id_to_name.get(*eid).map(|s| s.as_str()).unwrap_or(&ent.name);
                serde_json::json!({
                    "name":name,"entity_id":eid,"score":score,"delta":*score-BASE_SCORE,
                    "risk":risk_level(*score),"status":format!("{:?}",ent.status),
                    "events_count": ctx.events.iter().filter(|e|e.entity_id==**eid && e.reverted_by.is_none()).count(),
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
                    EntityStatus::Active => "在读", EntityStatus::Transferred => "转出", EntityStatus::Suspended => "休学",
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
    if index.contains_key(name) { return Err(AppError::Validation(format!("学生 {} 已存在", name))); }
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
    let mut index = load_name_index()?;
    let events = load_events()?;
    let eid = resolve_entity_id(name, &index)?;
    let student_events: Vec<_> = events.iter().filter(|e| e.entity_id == eid && e.reverted_by.is_none()).collect();
    if !confirm {
        println!("⚠️ 需要使用 --confirm 确认"); println!("   学生: {} | 事件: {} 条", name, student_events.len());
        return Ok(());
    }
    if dry_run { println!("[DRY-RUN] 删除: {} 事件:{}", name, student_events.len()); return Ok(()); }
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();
    entities.entities.remove(&eid); index.remove(name);
    save_entities(&entities)?; save_name_index(&index)?;
    let _ = append_operation_log(&serde_json::json!({"action":"delete_student","entity_id":eid,"name":name,"reason":reason,"timestamp":now}));
    println!("✓ 学生已删除: {} (保留{}条历史事件)", name, student_events.len());
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
    let ctx = DataContext::load()?;
    let mut sorted: Vec<_> = ctx.scores.iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let out_file = output_path.unwrap_or("-");

    match format {
        "csv" => {
            let mut csv = String::from("姓名,分数,变动,风险\n");
            for (eid, score) in &sorted {
                let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
                csv.push_str(&format!("{},{:.1},{:+.1},{}\n", name, score, **score - BASE_SCORE, risk_level(**score)));
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
    let ctx = DataContext::load()?;
    let valid_events: Vec<&Event> = ctx.events.iter()
        .filter(|e| {
            if !e.is_valid || e.reverted_by.is_some() { return false; }
            let date = if e.timestamp.len() >= 10 { &e.timestamp[..10] } else { return true; };
            if let Some(s) = since { if date < s { return false; } }
            if let Some(u) = until { if date > u { return false; } }
            true
        })
        .collect();

    let bonus_count = valid_events.iter().filter(|e| e.score_delta > 0.0).count();
    let deduct_count = valid_events.iter().filter(|e| e.score_delta < 0.0).count();
    let bonus_total: f64 = valid_events.iter().filter(|e| e.score_delta > 0.0).map(|e| e.score_delta).sum();
    let deduct_total: f64 = valid_events.iter().filter(|e| e.score_delta < 0.0).map(|e| e.score_delta).sum();

    // Risk distribution
    let mut risk_dist = HashMap::new();
    risk_dist.insert("极高", 0usize); risk_dist.insert("高", 0); risk_dist.insert("中", 0); risk_dist.insert("低", 0);
    for score in ctx.scores.values() {
        let key = risk_level(*score);
        *risk_dist.get_mut(key).unwrap() += 1;
    }

    // Top reason codes
    let mut code_counts: HashMap<&str, usize> = HashMap::new();
    for e in &valid_events { *code_counts.entry(&e.reason_code).or_insert(0) += 1; }
    let mut top_codes: Vec<_> = code_counts.iter().collect();
    top_codes.sort_by(|a, b| b.1.cmp(a.1));

    // Students with biggest changes
    let mut deltas: Vec<(&String, f64)> = ctx.scores.iter().map(|(k, v)| (k, *v - BASE_SCORE)).collect();
    deltas.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let top_gainers: Vec<serde_json::Value> = deltas.iter().take(5).map(|(eid, d)| {
        let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
        serde_json::json!({"name":name,"delta":d})
    }).collect();
    let top_losers: Vec<serde_json::Value> = deltas.iter().rev().take(5).map(|(eid, d)| {
        let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
        serde_json::json!({"name":name,"delta":d})
    }).collect();

    match output {
        OutputMode::Json => {
            print_json(&serde_json::json!({
                "period": {"since": since, "until": until},
                "events": {"total": valid_events.len(), "bonus_count": bonus_count, "deduct_count": deduct_count,
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
            println!("║ 事件数:     {:>4}                   ║", valid_events.len());
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
pub fn cmd_set_student_meta(name: &str, group: Option<&str>, role: Option<&str>, class_id: Option<&str>) -> Result<(), AppError> {
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
    if let Some(c) = class_id { entity.class_id = Some(c.to_string()); }

    save_entities(&entities)?;
    let log_entry = serde_json::json!({
        "action":"set_student_meta","student":name,"group":group,"role":role,"class_id":class_id,
        "timestamp":chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string()
    });
    let _ = append_operation_log(&log_entry);
    println!("✓ 学生属性已更新: {}", name);
    if let Some(g) = group { println!("  group: {}", g); }
    if let Some(r) = role { println!("  role: {}", r); }
    if let Some(c) = class_id { println!("  class_id: {}", c); }
    Ok(())
}

// === NEW: dashboard (static HTML) ===
pub fn cmd_dashboard(output_dir: Option<&str>, open_browser: bool) -> Result<(), AppError> {
    let ctx = DataContext::load()?;
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

fn generate_dashboard_html(ctx: &DataContext, sorted: &Vec<(&String, &f64)>) -> Result<String, AppError> {
    let _valid_events: Vec<&Event> = ctx.events.iter().filter(|e| e.is_valid && e.reverted_by.is_none()).collect();
    let mut risk_dist = HashMap::new();
    risk_dist.insert("极高", 0usize); risk_dist.insert("高", 0); risk_dist.insert("中", 0); risk_dist.insert("低", 0);
    for score in ctx.scores.values() { *risk_dist.get_mut(risk_level(*score)).unwrap() += 1; }

    let names: Vec<&str> = sorted.iter().map(|(eid,_)| ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?")).collect();
    let scores: Vec<f64> = sorted.iter().map(|(_,s)|**s).collect();

    let mut rows = String::new();
    for (i,(eid,score)) in sorted.iter().enumerate() {
        let name = ctx.id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
        let cls = match risk_level(**score) { "极高"=>"risk-extreme", "高"=>"risk-high", "中"=>"risk-mid", _=>"risk-low" };
        rows.push_str(&format!("<tr><td>{}</td><td>{}</td><td>{:.1}</td><td class=\"{}\">{}</td></tr>\n", i+1, name, score, cls, risk_level(**score)));
    }

    let rl = risk_dist.get("低").unwrap_or(&0);
    let rm = risk_dist.get("中").unwrap_or(&0);
    let rh = risk_dist.get("高").unwrap_or(&0);
    let rx = risk_dist.get("极高").unwrap_or(&0);
    let total_s = ctx.entities.entities.len();
    let total_e = ctx.events.len();

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

// === Enhanced doctor ===
pub fn cmd_doctor(output: OutputMode) -> Result<(), AppError> {
    let mut ok = 0; let mut warn = 0; let mut issues = Vec::new();
    let data_dir = get_data_dir();
    if data_dir.exists() { ok += 1; } else { warn += 1; issues.push(format!("数据目录不存在: {}", data_dir.display())); }
    let schema_path = get_schema_dir().join("reason_codes.json");
    if schema_path.exists() { ok += 1; } else { warn += 1; issues.push("原因码Schema缺失".into()); }
    for (name, path) in [("entities","entities/entities.json"),("events","events/events.json"),("name_index","entities/name_index.json")] {
        if data_dir.join(path).exists() { ok += 1; } else { warn += 1; issues.push(format!("{} 文件缺失", name)); }
    }
    let entities_result = load_entities();
    let events_result = load_events();
    let ent_count = match &entities_result { Ok(e) => { ok += 1; e.entities.len() } Err(e) => { warn += 1; issues.push(format!("实体加载失败: {}", e)); 0 } };
    let evt_count = match &events_result { Ok(ev) => { ok += 1; ev.len() } Err(e) => { warn += 1; issues.push(format!("事件加载失败: {}", e)); 0 } };

    // v3.1.2 enhanced checks
    if let (Ok(entities), Ok(events)) = (&entities_result, &events_result) {
        // Check entity reference integrity
        let entity_ids: std::collections::HashSet<&str> = entities.entities.keys().map(|k| k.as_str()).collect();
        let mut orphan_events = 0;
        for evt in events {
            if !entity_ids.contains(evt.entity_id.as_str()) { orphan_events += 1; }
        }
        if orphan_events > 0 { warn += 1; issues.push(format!("{} 条孤立事件(entity_id无对应实体)", orphan_events)); }
        else { ok += 1; }

        // Check event distribution anomaly (batch same-timestamp)
        let mut ts_counts: HashMap<&str, usize> = HashMap::new();
        for evt in events {
            let ts = if evt.timestamp.len() >= 16 { &evt.timestamp[..16] } else { &evt.timestamp };
            *ts_counts.entry(ts).or_insert(0) += 1;
        }
        let max_batch = ts_counts.values().max().copied().unwrap_or(0);
        if max_batch > 50 { warn += 1; issues.push(format!("异常批量: 单分钟最多{}条事件（阈值50）", max_batch)); } else { ok += 1; if max_batch > 20 { issues.push(format!("ℹ 批量录入: 单分钟{}条事件（正常操作）", max_batch)); } }

        // Check event_id uniqueness
        let mut seen_ids = std::collections::HashSet::new();
        let mut dup_ids = 0;
        for evt in events {
            if !seen_ids.insert(&evt.event_id) { dup_ids += 1; }
        }
        if dup_ids > 0 { warn += 1; issues.push(format!("{} 个重复event_id", dup_ids)); }
        else { ok += 1; }
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
