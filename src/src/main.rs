//! CoPaw v2.0 —— 类型驱动的事件溯源操行分系统
//!
//! 架构：AI (按 Schema 生成) → 强类型 Struct (Serde 拦截) → CLI (状态机校验) → 原子写入

mod types;
mod storage;
mod validation;
mod schema;

use clap::{Parser, Subcommand};
use types::newtypes::{EventId, ScoreDelta};
use types::event::SchoolEvent;
use types::entity::Entity;
use types::envelope::{EventEnvelope, EventPayload};
use types::enums::*;
use types::error::AIRejectError;

use storage::{
    load_entities, load_events, load_name_index, load_reason_codes,
    compute_scores, build_id_to_name, resolve_entity_id, append_events_atomic,
};

// ─── CLI 定义 ───

#[derive(Parser)]
#[command(name = "copaw", about = "CoPaw 类型驱动事件溯源 CLI v2.0")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 系统信息
    Info,
    /// 校验所有事件
    Validate,
    /// 重放分数排行榜
    Replay,
    /// 学生事件时间线
    History { name: String },
    /// 排行榜
    Ranking { #[arg(default_value = "10")] n: usize },
    /// 查询单个学生分数
    Score { name: String },
    /// 添加事件（强类型 JSON）
    Add {
        /// 学生姓名
        name: String,
        /// 原因码
        reason_code: String,
        /// 分值变化
        #[arg(long, default_value_t = 0.0)]
        delta: f64,
        /// 标签（逗号分隔）
        #[arg(long, default_value = "班主任")]
        tags: String,
        /// 备注
        #[arg(long, default_value = "")]
        note: String,
    },
    /// 撤销事件
    Revert {
        event_id: String,
        #[arg(long, default_value = "")]
        reason: String,
    },
    /// 列出所有原因码
    Codes,
    /// 搜索事件
    Search { query: Vec<String> },
    /// 统计概览
    Stats,
    /// 标签管理
    Tag { #[arg(default_value = "")] tag: String },
    /// 日期范围查询
    Range { start: String, end: String },
    /// 导出 JSON Schema（供 AI 平台使用）
    Schema,
    /// 迁移旧版数据
    MigrateLegacy,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Info => cmd_info()?,
        Commands::Validate => cmd_validate()?,
        Commands::Replay => cmd_replay()?,
        Commands::History { name } => cmd_history(&name)?,
        Commands::Ranking { n } => cmd_ranking(n)?,
        Commands::Score { name } => cmd_score(&name)?,
        Commands::Add { name, reason_code, delta, tags, note } => cmd_add(&name, &reason_code, delta, &tags, &note)?,
        Commands::Revert { event_id, reason } => cmd_revert(&event_id, &reason)?,
        Commands::Codes => cmd_codes()?,
        Commands::Search { query } => cmd_search(&query.join(" "))?,
        Commands::Stats => cmd_stats()?,
        Commands::Tag { tag } => cmd_tag(&tag)?,
        Commands::Range { start, end } => cmd_range(&start, &end)?,
        Commands::Schema => schema::print_schema(),
        Commands::MigrateLegacy => cmd_migrate_legacy()?,
    }

    Ok(())
}

// ─── 命令实现 ───

fn cmd_info() -> Result<(), AIRejectError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let legacy_count = events.iter().filter(|e| e.is_legacy()).count();

    println!("╔══════════════════════════════════════╗");
    println!("║   CoPaw 类型驱动事件溯源系统 v2.0    ║");
    println!("╠══════════════════════════════════════╣");
    println!("║ 学生总数: {:>4}                       ║", entities.len());
    println!("║ 事件总数: {:>4}                       ║", events.len());
    println!("║ 遗留数据: {:>4}                       ║", legacy_count);
    println!("║ 数据目录: /vol2/copaw-data           ║");
    println!("║ Schema版本: 2                        ║");
    println!("╚══════════════════════════════════════╝");
    Ok(())
}

fn cmd_validate() -> Result<(), AIRejectError> {
    let events = load_events()?;
    let codes = load_reason_codes()?;
    let mut errors = 0;
    let mut legacy = 0;

    for evt in &events {
        if evt.is_legacy() {
            legacy += 1;
            continue;
        }
        if let EventPayload::Current(ref school_event) = evt.payload {
            if let Err(e) = school_event.validate() {
                println!("✗ {} 校验失败: {}", evt.event_id, e);
                errors += 1;
            }
        }
    }

    println!("✓ 强类型事件: {} 条", events.len() - legacy);
    if legacy > 0 {
        println!("⚠ 遗留数据: {} 条（可用 `copaw migrate-legacy` 迁移）", legacy);
    }
    if errors == 0 {
        println!("✓ 所有强类型事件校验通过");
    } else {
        println!("✗ {} 条校验错误", errors);
    }
    Ok(())
}

fn cmd_replay() -> Result<(), AIRejectError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let scores = compute_scores(&entities, &events);
    let index = load_name_index()?;
    let id_to_name = build_id_to_name(&index);

    let mut sorted: Vec<_> = scores.iter().collect();
    sorted.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap());

    println!("{:<20} {:>8} {:>6}", "姓名", "分数", "变动");
    println!("{}", "-".repeat(36));
    for (eid, score) in &sorted {
        let name = id_to_name.get(eid.as_str()).map(|s| s.as_str()).unwrap_or("?");
        let delta = **score - 100.0;
        println!("{:<20} {:>8.1} {:>+6.1}", name, score, delta);
    }
    Ok(())
}

fn cmd_history(name: &str) -> Result<(), AIRejectError> {
    let index = load_name_index()?;
    let eid = resolve_entity_id(name, &index)?;
    let events = load_events()?;
    let id_to_name = build_id_to_name(&index);

    let student_events: Vec<_> = events.iter().filter(|e| e.entity_id == eid).collect();
    if student_events.is_empty() {
        println!("无事件记录");
        return Ok(());
    }

    println!("{} 的事件时间线 ({}条):", name, student_events.len());
    println!("{}", "-".repeat(60));
    let mut running = 100.0;
    for evt in &student_events {
        let delta = evt.score_delta();
        running += delta;
        let desc = match &evt.payload {
            EventPayload::Current(e) => e.description().to_string(),
            EventPayload::Legacy(l) => l.reason_code.clone().unwrap_or_default(),
        };
        let date = if evt.timestamp.len() >= 10 { &evt.timestamp[..10] } else { &evt.timestamp };
        println!("{:<12} {:>+6.1} → {:>6.1}  [{}] {}", date, delta, running, evt.event_id, desc);
    }
    Ok(())
}

fn cmd_ranking(n: usize) -> Result<(), AIRejectError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let scores = compute_scores(&entities, &events);
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

fn cmd_score(name: &str) -> Result<(), AIRejectError> {
    let entities = load_entities()?;
    let index = load_name_index()?;
    let eid = resolve_entity_id(name, &index)?;
    let events = load_events()?;
    let scores = compute_scores(&entities, &events);
    let score = scores.get(&eid).unwrap_or(&0.0);
    println!("{}: {:.1} 分", name, score);
    Ok(())
}

fn cmd_add(name: &str, reason_code: &str, delta: f64, _tags: &str, note: &str) -> Result<(), AIRejectError> {
    let codes = load_reason_codes()?;
    let code_def = codes.codes.get(reason_code)
        .ok_or_else(|| AIRejectError::invalid_value("reason_code", &format!("未知原因码: {}", reason_code)))?;

    // 确定实际分值
    let actual_delta = if delta == 0.0 {
        code_def.score_delta.unwrap_or(0.0)
    } else {
        delta
    };

    let score_delta = ScoreDelta::new(actual_delta)
        .map_err(|e| AIRejectError::invalid_value("score_delta", &e))?;

    // 构建强类型事件
    let school_event = match code_def.category.as_str() {
        "deduct" | "lab" => {
            let category: DisciplineCategory = serde_json::from_value(
                serde_json::Value::String(reason_code.to_string())
            ).map_err(|e| AIRejectError::type_mismatch(&e.to_string()))?;

            SchoolEvent::Discipline(types::event::DisciplinePayload {
                category,
                score_delta,
                location: Location::Classroom,
                severity: if score_delta.value().abs() >= 10.0 { Severity::Critical }
                         else if score_delta.value().abs() >= 5.0 { Severity::Major }
                         else { Severity::Minor },
                description: code_def.label.clone(),
                opponent_id: None,
                evidence_refs: vec!["cli:manual".to_string()],
                operator: "班主任".to_string(),
                note: note.to_string(),
            })
        }
        "bonus" => {
            let category: BonusCategory = serde_json::from_value(
                serde_json::Value::String(reason_code.to_string())
            ).map_err(|e| AIRejectError::type_mismatch(&e.to_string()))?;

            SchoolEvent::Bonus(types::event::BonusPayload {
                category,
                score_delta,
                description: code_def.label.clone(),
                operator: "班主任".to_string(),
                note: note.to_string(),
            })
        }
        _ => {
            SchoolEvent::System(types::event::SystemPayload {
                action: reason_code.to_string(),
                description: code_def.label.clone(),
                operator: "系统".to_string(),
            })
        }
    };

    // 校验
    school_event.validate().map_err(|e| AIRejectError::business_rule(&e))?;

    let index = load_name_index()?;
    let eid = resolve_entity_id(name, &index)?;
    let entities = load_entities()?;
    let entity = entities.get(&eid)
        .ok_or_else(|| AIRejectError::student_not_found(name))?;
    
    validation::validate_add_event(entity, &school_event, reason_code)?;

    // 构建信封
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let envelope = EventEnvelope {
        event_id: EventId::generate(),
        entity_id: eid,
        timestamp: now,
        schema_version: 2,
        payload: EventPayload::Current(school_event),
        is_valid: true,
        reverted_by: None,
    };

    println!("✓ 事件已创建: {} {} {:+.1}", envelope.event_id, name, score_delta.value());
    append_events_atomic(&[envelope])?;
    println!("✓ 已原子写入 events.json");
    Ok(())
}

fn cmd_revert(event_id: &str, reason: &str) -> Result<(), AIRejectError> {
    let mut events = load_events()?;
    let target_idx = events.iter().position(|e| e.event_id.as_str() == event_id)
        .ok_or_else(|| AIRejectError::invalid_value("event_id", &format!("事件 {} 不存在", event_id)))?;

    if events[target_idx].reverted_by.is_some() {
        return Err(AIRejectError::business_rule(&format!("事件 {} 已被撤销", event_id)));
    }

    let revert_id = EventId::generate();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let original_delta = events[target_idx].score_delta();

    // 标记原事件为已撤销
    events[target_idx].reverted_by = Some(revert_id.clone());

    // 创建撤销事件
    let revert_event = SchoolEvent::System(types::event::SystemPayload {
        action: "REVERT".to_string(),
        description: format!("撤销 {} (原因: {})", event_id, if reason.is_empty() { "未填写" } else { reason }),
        operator: "系统".to_string(),
    });

    let revert_envelope = EventEnvelope {
        event_id: revert_id.clone(),
        entity_id: events[target_idx].entity_id.clone(),
        timestamp: now,
        schema_version: 2,
        payload: EventPayload::Current(revert_event),
        is_valid: true,
        reverted_by: None,
    };

    // 附带对冲分值的 Legacy 载荷（保持向后兼容）
    events.push(revert_envelope);

    println!("✓ 撤销事件: {} 对冲 {}", revert_id, event_id);
    append_events_atomic_from_vec(&events)?;
    println!("✓ 已原子写入");
    Ok(())
}

fn append_events_atomic_from_vec(events: &[EventEnvelope]) -> Result<(), AIRejectError> {
    let path = std::path::PathBuf::from("/vol2/copaw-data/data/events/events.json");
    let tmp_path = path.with_extension("tmp");

    let json = serde_json::to_string_pretty(events)
        .map_err(|e| AIRejectError::malformed_json(&format!("序列化失败: {}", e)))?;

    let mut f = std::fs::File::create(&tmp_path)
        .map_err(|e| AIRejectError::malformed_json(&format!("创建临时文件失败: {}", e)))?;
    use std::io::Write;
    f.write_all(json.as_bytes())
        .map_err(|e| AIRejectError::malformed_json(&format!("写入失败: {}", e)))?;
    f.sync_all().map_err(|e| AIRejectError::malformed_json(&format!("sync失败: {}", e)))?;
    drop(f);

    std::fs::rename(&tmp_path, &path)
        .map_err(|e| AIRejectError::malformed_json(&format!("重命名失败: {}", e)))?;

    Ok(())
}

fn cmd_codes() -> Result<(), AIRejectError> {
    let codes = load_reason_codes()?;
    println!("{:<25} {:>6}  {}", "代码", "标准分", "说明");
    println!("{}", "-".repeat(50));
    for (code, def) in &codes.codes {
        let delta = match def.score_delta {
            Some(d) => format!("{:+.0}", d),
            None => "变量".to_string(),
        };
        println!("{:<25} {:>6}  {}", code, delta, def.label);
    }
    Ok(())
}

fn cmd_search(query: &str) -> Result<(), AIRejectError> {
    let events = load_events()?;
    let index = load_name_index()?;
    let id_to_name = build_id_to_name(&index);

    let results: Vec<_> = events.iter()
        .filter(|e| {
            let name = id_to_name.get(&e.entity_id).map(|s| s.as_str()).unwrap_or("");
            let desc = match &e.payload {
                EventPayload::Current(ev) => ev.description().to_string(),
                EventPayload::Legacy(l) => l.reason_code.clone().unwrap_or_default(),
            };
            name.contains(query) || desc.contains(query) || e.event_id.as_str().contains(query)
        })
        .collect();

    if results.is_empty() {
        println!("未找到与 \"{}\" 相关的事件", query);
        return Ok(());
    }

    println!("找到 {} 条相关事件:", results.len());
    println!("{}", "-".repeat(75));
    for evt in &results {
        let name = id_to_name.get(&evt.entity_id).map(|s| s.as_str()).unwrap_or("?");
        let date = if evt.timestamp.len() >= 10 { &evt.timestamp[..10] } else { &evt.timestamp };
        let desc = match &evt.payload {
            EventPayload::Current(e) => e.description(),
            EventPayload::Legacy(l) => l.reason_code.as_deref().unwrap_or("?"),
        };
        println!("{:<10} {:<12} {:<24} {:+.1} {}",
            name, date, desc, evt.score_delta(),
            if evt.is_legacy() { "[遗留]" } else { "" });
    }
    Ok(())
}

fn cmd_stats() -> Result<(), AIRejectError> {
    let entities = load_entities()?;
    let events = load_events()?;
    let scores = compute_scores(&entities, &events);

    let valid = events.iter().filter(|e| e.is_valid && e.reverted_by.is_none()).count();
    let reverted = events.iter().filter(|e| e.reverted_by.is_some()).count();
    let legacy = events.iter().filter(|e| e.is_legacy()).count();

    // 分数分布
    let ranges = [110.0, 100.0, 90.0, 80.0];
    let labels = ["110+", "100-110", "90-100", "80-90", "<80"];
    let mut counts = [0usize; 5];
    for s in scores.values() {
        if *s >= ranges[0] { counts[0] += 1; }
        else if *s >= ranges[1] { counts[1] += 1; }
        else if *s >= ranges[2] { counts[2] += 1; }
        else if *s >= ranges[3] { counts[3] += 1; }
        else { counts[4] += 1; }
    }

    println!("╔══════════════════════════════════════╗");
    println!("║       CoPaw 数据统计 v2.0            ║");
    println!("╠══════════════════════════════════════╣");
    println!("║ 学生总数: {:>6}                     ║", entities.len());
    println!("║ 事件总数: {:>6}                     ║", events.len());
    println!("║ 有效事件: {:>6}                     ║", valid);
    println!("║ 撤销事件: {:>6}                     ║", reverted);
    println!("║ 遗留数据: {:>6}                     ║", legacy);
    println!("╠══════════════════════════════════════╣");
    println!("║ 分数区间分布:");
    for i in 0..5 {
        if counts[i] > 0 {
            println!("║   {:<28} {:>4}人", labels[i], counts[i]);
        }
    }
    println!("╚══════════════════════════════════════╝");
    Ok(())
}

fn cmd_tag(tag: &str) -> Result<(), AIRejectError> {
    let events = load_events()?;
    if tag.is_empty() {
        // TODO: 从强类型事件中提取标签
        println!("标签功能待完善（v2 类型系统中标签从 payload 自动生成）");
        return Ok(());
    }
    println!("标签 \"{}\" 查询功能待完善", tag);
    Ok(())
}

fn cmd_range(start: &str, end: &str) -> Result<(), AIRejectError> {
    let events = load_events()?;
    let index = load_name_index()?;
    let id_to_name = build_id_to_name(&index);

    let matched: Vec<_> = events.iter()
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
    for evt in &matched {
        let name = id_to_name.get(&evt.entity_id).map(|s| s.as_str()).unwrap_or("?");
        let date = if evt.timestamp.len() >= 10 { &evt.timestamp[..10] } else { &evt.timestamp };
        println!("{:<10} {:<12} {:>6.1} {}", name, date, evt.score_delta(), evt.event_id);
    }
    Ok(())
}

fn cmd_migrate_legacy() -> Result<(), AIRejectError> {
    let events = load_events()?;
    let legacy_count = events.iter().filter(|e| e.is_legacy()).count();

    if legacy_count == 0 {
        println!("✓ 没有遗留数据需要迁移");
        return Ok(());
    }

    println!("发现 {} 条遗留数据", legacy_count);
    println!("提示：遗留数据已保留在 Legacy 载荷中，分数计算正常。");
    println!("如需手动迁移，请使用 copaw add 逐条补录。");
    Ok(())
}
