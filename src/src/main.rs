use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use thiserror::Error;

const DATA_DIR: &str = "/vol2/copaw-data/data";
const SCHEMA_DIR: &str = "/vol2/copaw-data/schema";

#[derive(Error, Debug)]
enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Student not found: {0}")]
    StudentNotFound(String),
    #[error("Event not found: {0}")]
    EventNotFound(String),
    #[error("Validation failed: {0}")]
    Validation(String),
}

// --- Types ---
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ReasonCode {
    SpeakInClass,
    SleepInClass,
    Late,
    SchoolCaught,
    Makeup,
    DeskUnaligned,
    PhoneInClass,
    Smoking,
    DrinkingDorm,
    OtherDeduct,
    AppearanceViolation,
    BonusVariable,
    ActivityParticipation,
    ClassMonitor,
    ClassCommittee,
    CivilizedDorm,
    MonthlyAttendance,
    Revert,
    // Lab domain
    LabEquipmentDamage,
    LabSafetyViolation,
    LabUnsafeBehavior,
    LabCleanUp,
}

impl fmt::Display for ReasonCode {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let s = serde_json::to_value(self).unwrap().as_str().unwrap().to_string();
        write!(f, "{}", s)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum EventType {
    ConductDeduct,
    ConductBonus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum EntityStatus {
    Active,
    Transferred,
    Suspended,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entity {
    id: String,
    name: String,
    #[serde(default)]
    aliases: Vec<String>,
    status: EntityStatus,
    created_at: String,
    #[serde(default)]
    metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Event {
    event_id: String,
    entity_id: String,
    event_type: EventType,
    #[serde(default)]
    category_tags: Vec<String>,
    reason_code: ReasonCode,
    original_reason: String,
    score_delta: f64,
    evidence_ref: String,
    operator: String,
    timestamp: String,
    is_valid: bool,
    reverted_by: Option<String>,
    #[serde(default)]
    note: String,
}

#[derive(Debug, Deserialize)]
struct EntitiesFile {
    entities: HashMap<String, Entity>,
}

#[derive(Debug, Deserialize)]
struct ReasonCodeDef {
    #[serde(default)]
    score_delta: Option<f64>,
    label: String,
    category: String,
}

#[derive(Debug, Deserialize)]
struct ReasonCodesFile {
    #[allow(dead_code)]
    version: String,
    codes: HashMap<String, ReasonCodeDef>,
}

// --- Data loading ---
fn load_entities() -> Result<EntitiesFile, AppError> {
    let path = PathBuf::from(DATA_DIR).join("entities/entities.json");
    let f = std::fs::File::open(path)?;
    Ok(serde_json::from_reader(f)?)
}

fn load_events() -> Result<Vec<Event>, AppError> {
    let path = PathBuf::from(DATA_DIR).join("events/events.json");
    let f = std::fs::File::open(path)?;
    Ok(serde_json::from_reader(f)?)
}

fn load_name_index() -> Result<HashMap<String, String>, AppError> {
    let path = PathBuf::from(DATA_DIR).join("entities/name_index.json");
    let f = std::fs::File::open(path)?;
    Ok(serde_json::from_reader(f)?)
}

fn load_reason_codes() -> Result<ReasonCodesFile, AppError> {
    let path = PathBuf::from(SCHEMA_DIR).join("reason_codes.json");
    let f = std::fs::File::open(path)?;
    Ok(serde_json::from_reader(f)?)
}

fn resolve_entity_id(name: &str, index: &HashMap<String, String>) -> Result<String, AppError> {
    index.get(name).cloned().ok_or_else(|| AppError::StudentNotFound(name.to_string()))
}

fn compute_scores(entities: &HashMap<String, Entity>, events: &[Event]) -> HashMap<String, f64> {
    let mut scores: HashMap<String, f64> = entities.keys().map(|k| (k.clone(), 100.0)).collect();
    for evt in events {
        if evt.is_valid && evt.reverted_by.is_none() {
            *scores.entry(evt.entity_id.clone()).or_insert(100.0) += evt.score_delta;
        }
    }
    scores
}

/// Build id->name map from name_index (value is entity_id)
fn build_id_to_name(index: &HashMap<String, String>) -> HashMap<String, String> {
    index.iter().map(|(k, v)| (v.clone(), k.clone())).collect()
}

// --- CLI ---
#[derive(Parser)]
#[command(name = "copaw", about = "CoPaw conduct score event-sourced CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// System info
    Info,
    /// Validate all events
    Validate,
    /// Replay scores
    Replay,
    /// Student event timeline
    History { name: String },
    /// Ranking
    Ranking { #[arg(default_value = "10")] n: usize },
    /// Single student score
    Score { name: String },
    /// Add event (strict validation)
    Add {
        name: String,
        reason_code: String,
        #[arg(long, default_value = "班主任")]
        tags: String,
        #[arg(long, default_value_t = 0.0)]
        delta: f64,
        #[arg(long, default_value = "")]
        note: String,
    },
    /// Revert an event
    Revert {
        event_id: String,
        #[arg(long, default_value = "")]
        reason: String,
    },
    /// List all reason codes
    Codes,
    /// Search events by keyword (name, reason code, tag, or reason text)
    Search { query: Vec<String> },
    /// Show statistics summary
    Stats,
    /// Tag management: list tags, or show events with a specific tag
    Tag { #[arg(default_value = "")] tag: String },
    /// Query events in a date range (YYYY-MM-DD YYYY-MM-DD)
    Range { start: String, end: String },
}

fn print_event_line(evt: &Event, id_to_name: &HashMap<String, String>) {
    let name = id_to_name.get(&evt.entity_id).map(|s| s.as_str()).unwrap_or("?");
    let date = if evt.timestamp.len() >= 10 { &evt.timestamp[..10] } else { &evt.timestamp };
    println!("{:<10} {:<12} [{:<25}] {:<24} {:+.1}",
        name, date, evt.reason_code.to_string(), evt.original_reason, evt.score_delta);
}

fn cmd_search(query: &str, events: &[Event], index: &HashMap<String, String>) {
    let id_to_name = build_id_to_name(index);
    let query_upper = query.to_uppercase();
    let mut results: Vec<&Event> = Vec::new();

    for evt in events {
        // Check student name
        let name = id_to_name.get(&evt.entity_id).map(|s| s.as_str()).unwrap_or("");
        let name_match = name.contains(query);

        // Check reason code
        let code_str = evt.reason_code.to_string();
        let code_match = code_str == query_upper || code_str.contains(&query_upper);

        // Check tags
        let tag_match = evt.category_tags.iter().any(|t| t.contains(query));

        // Check original reason text
        let reason_match = evt.original_reason.contains(query);

        if name_match || code_match || tag_match || reason_match {
            results.push(evt);
        }
    }

    if results.is_empty() {
        println!("未找到与 \"{}\" 相关的事件", query);
        return;
    }

    // Determine query type for header
    let is_name = index.contains_key(query);
    let is_code = results.iter().all(|e| e.reason_code.to_string() == query_upper);

    if is_name {
        println!("{} 的所有事件 ({}条):", query, results.len());
    } else if is_code {
        println!("找到 {} 条[{}]事件:", results.len(), query_upper);
    } else {
        println!("找到 {} 条\"{}\"相关事件:", results.len(), query);
    }
    println!("{}", "-".repeat(75));
    for evt in &results {
        print_event_line(evt, &id_to_name);
    }
}

fn cmd_stats(entities: &HashMap<String, Entity>, events: &[Event]) {
    let total_students = entities.len();
    let total_events = events.len();
    let valid_events = events.iter().filter(|e| e.is_valid && e.reverted_by.is_none()).count();
    let reverted = events.iter().filter(|e| e.reverted_by.is_some()).count();

    // Reason code stats
    let mut code_counts: HashMap<String, usize> = HashMap::new();
    for evt in events {
        if evt.is_valid && evt.reverted_by.is_none() {
            *code_counts.entry(evt.reason_code.to_string()).or_insert(0) += 1;
        }
    }
    let mut code_sorted: Vec<_> = code_counts.into_iter().collect();
    code_sorted.sort_by(|a, b| b.1.cmp(&a.1));

    // Tag stats
    let mut tag_counts: HashMap<String, usize> = HashMap::new();
    for evt in events {
        if evt.is_valid && evt.reverted_by.is_none() {
            for tag in &evt.category_tags {
                *tag_counts.entry(tag.clone()).or_insert(0) += 1;
            }
        }
    }
    let mut tag_sorted: Vec<_> = tag_counts.into_iter().collect();
    tag_sorted.sort_by(|a, b| b.1.cmp(&a.1));

    // Score distribution
    let scores = compute_scores(entities, events);
    let ranges = [110.0, 100.0, 90.0, 80.0];
    let range_labels = ["110+", "100-110", "90-100", "80-90", "<80"];
    let mut range_counts = [0usize; 5];
    for score in scores.values() {
        if *score >= ranges[0] { range_counts[0] += 1; }
        else if *score >= ranges[1] { range_counts[1] += 1; }
        else if *score >= ranges[2] { range_counts[2] += 1; }
        else if *score >= ranges[3] { range_counts[3] += 1; }
        else { range_counts[4] += 1; }
    }

    println!("╔══════════════════════════════════════╗");
    println!("║       CoPaw 数据统计 v2.0            ║");
    println!("╠══════════════════════════════════════╣");
    println!("║ 学生总数: {:>6}                     ║", total_students);
    println!("║ 事件总数: {:>6}                     ║", total_events);
    println!("║ 有效事件: {:>6}                     ║", valid_events);
    println!("║ 撤销事件: {:>6}                     ║", reverted);
    println!("╠══════════════════════════════════════╣");
    println!("║ 各原因码统计:");
    for (code, count) in &code_sorted {
        println!("║   {:<28} {:>4}次", code, count);
    }
    println!("╠══════════════════════════════════════╣");
    println!("║ 各标签统计:");
    for (tag, count) in &tag_sorted {
        println!("║   {:<28} {:>4}次", tag, count);
    }
    println!("╠══════════════════════════════════════╣");
    println!("║ 分数区间分布:");
    for i in 0..5 {
        if range_counts[i] > 0 {
            println!("║   {:<28} {:>4}人", range_labels[i], range_counts[i]);
        }
    }
    println!("╚══════════════════════════════════════╝");
}

fn cmd_tag(tag: &str, events: &[Event], index: &HashMap<String, String>) {
    if tag.is_empty() {
        // List all tags with counts
        let mut tag_counts: HashMap<String, usize> = HashMap::new();
        for evt in events {
            if evt.is_valid && evt.reverted_by.is_none() {
                for t in &evt.category_tags {
                    *tag_counts.entry(t.clone()).or_insert(0) += 1;
                }
            }
        }
        let mut sorted: Vec<_> = tag_counts.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));
        println!("所有标签:");
        println!("{}", "-".repeat(30));
        for (t, c) in &sorted {
            println!("  {:<20} {:>4}次", t, c);
        }
        return;
    }

    let id_to_name = build_id_to_name(index);
    let matched: Vec<&Event> = events.iter()
        .filter(|e| e.is_valid && e.reverted_by.is_none() && e.category_tags.iter().any(|t| t.contains(tag)))
        .collect();

    if matched.is_empty() {
        println!("标签 \"{}\" 下无事件", tag);
        return;
    }
    println!("标签 \"{}\" 下的所有事件 ({}条):", tag, matched.len());
    println!("{}", "-".repeat(75));
    for evt in &matched {
        print_event_line(evt, &id_to_name);
    }
}

fn cmd_range(start: &str, end: &str, events: &[Event], index: &HashMap<String, String>) {
    let id_to_name = build_id_to_name(index);
    let matched: Vec<&Event> = events.iter()
        .filter(|e| {
            let date = if e.timestamp.len() >= 10 { &e.timestamp[..10] } else { &e.timestamp };
            date >= start && date <= end
        })
        .collect();

    if matched.is_empty() {
        println!("{} ~ {} 之间无事件", start, end);
        return;
    }
    println!("{} ~ {} 的事件 ({}条):", start, end, matched.len());
    println!("{}", "-".repeat(75));
    for evt in &matched {
        print_event_line(evt, &id_to_name);
    }
}

fn main() -> Result<(), AppError> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Info => {
            let entities = load_entities()?;
            let events = load_events()?;
            println!("╔══════════════════════════════════════╗");
            println!("║     CoPaw 事件溯源操行分系统 v2.0    ║");
            println!("╠══════════════════════════════════════╣");
            println!("║ 学生总数: {:>4}                       ║", entities.entities.len());
            println!("║ 事件总数: {:>4}                       ║", events.len());
            println!("║ 数据目录: /vol2/copaw-data           ║");
            println!("╚══════════════════════════════════════╝");
        }
        Commands::Validate => {
            let events = load_events()?;
            let codes = load_reason_codes()?;
            let mut errors = 0;
            for evt in &events {
                let code_str = evt.reason_code.to_string();
                if !codes.codes.contains_key(&code_str) {
                    println!("✗ {} unknown reason_code: {}", evt.event_id, code_str);
                    errors += 1;
                }
                if evt.entity_id.is_empty() {
                    println!("✗ {} empty entity_id", evt.event_id);
                    errors += 1;
                }
            }
            if errors == 0 {
                println!("✓ All {} events valid", events.len());
            } else {
                println!("✗ {} errors found", errors);
            }
        }
        Commands::Replay => {
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
                let delta = **score - 100.0;
                println!("{:<20} {:>8.1} {:>+6.1}", name, score, delta);
            }
        }
        Commands::History { name } => {
            let index = load_name_index()?;
            let eid = resolve_entity_id(&name, &index)?;
            let events = load_events()?;
            let student_events: Vec<_> = events.iter().filter(|e| e.entity_id == eid).collect();
            if student_events.is_empty() {
                println!("无事件记录");
            } else {
                println!("{} 的事件时间线 ({}条):", name, student_events.len());
                println!("{}", "-".repeat(60));
                let mut running = 100.0;
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
        }
        Commands::Ranking { n } => {
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
        }
        Commands::Score { name } => {
            let entities = load_entities()?;
            let index = load_name_index()?;
            let eid = resolve_entity_id(&name, &index)?;
            let events = load_events()?;
            let scores = compute_scores(&entities.entities, &events);
            let score = scores.get(&eid).unwrap_or(&0.0);
            let entity = entities.entities.get(&eid).unwrap();
            let risk = entity.metadata.get("risk").and_then(|v| v.as_str()).unwrap_or("未知");
            println!("{}: {:.1} 分 (风险: {})", name, score, risk);
        }
        Commands::Add { name, reason_code, tags, delta, note } => {
            let codes = load_reason_codes()?;
            if !codes.codes.contains_key(&reason_code) {
                return Err(AppError::Validation(format!("未知原因码: {}", reason_code)));
            }
            let code_def = codes.codes.get(&reason_code).unwrap();
            let expected = code_def.score_delta;
            if expected.is_some() && (delta == 0.0 || (delta - expected.unwrap()).abs() > 0.001) {
                return Err(AppError::Validation(format!(
                    "原因码 {} 标准分值: {:?}，请使用正确的 delta", reason_code, expected
                )));
            }
            let index = load_name_index()?;
            let eid = resolve_entity_id(&name, &index)?;
            let events = load_events()?;
            let new_id = format!("evt_{:05}", events.len() + 1);
            let tag_list: Vec<String> = tags.split(',').map(|s| s.trim().to_string()).collect();
            let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
            let new_event = Event {
                event_id: new_id.clone(),
                entity_id: eid,
                event_type: if delta >= 0.0 { EventType::ConductBonus } else { EventType::ConductDeduct },
                category_tags: tag_list,
                reason_code: serde_json::from_value(serde_json::Value::String(reason_code.clone()))?,
                original_reason: reason_code.clone(),
                score_delta: delta,
                evidence_ref: "cli:manual".to_string(),
                operator: "班主任".to_string(),
                timestamp: now,
                is_valid: true,
                reverted_by: None,
                note,
            };
            println!("✓ 事件已创建: {} {} {:+.1}", new_event.event_id, name, delta);
            let mut all_events = events;
            all_events.push(new_event);
            let path = PathBuf::from(DATA_DIR).join("events/events.json");
            let f = std::fs::File::create(path)?;
            serde_json::to_writer_pretty(f, &all_events)?;
        }
        Commands::Revert { event_id, reason } => {
            let events = load_events()?;
            let target = events.iter().find(|e| e.event_id == event_id)
                .ok_or_else(|| AppError::EventNotFound(event_id.clone()))?;
            if target.reverted_by.is_some() {
                return Err(AppError::Validation(format!("{} 已被撤销", event_id)));
            }
            let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
            let revert_id = format!("evt_{:05}", events.len() + 1);
            let revert_event = Event {
                event_id: revert_id.clone(),
                entity_id: target.entity_id.clone(),
                event_type: if target.score_delta >= 0.0 { EventType::ConductDeduct } else { EventType::ConductBonus },
                category_tags: vec!["系统纠正".to_string()],
                reason_code: ReasonCode::Revert,
                original_reason: format!("撤销 {}", event_id),
                score_delta: -target.score_delta,
                evidence_ref: format!("revert:{}", event_id),
                operator: "系统".to_string(),
                timestamp: now,
                is_valid: true,
                reverted_by: None,
                note: reason,
            };
            println!("✓ 撤销事件: {} 对冲 {}", revert_id, event_id);
            let mut all_events = events;
            for e in all_events.iter_mut() {
                if e.event_id == event_id {
                    e.reverted_by = Some(revert_id.clone());
                }
            }
            all_events.push(revert_event);
            let path = PathBuf::from(DATA_DIR).join("events/events.json");
            let f = std::fs::File::create(path)?;
            serde_json::to_writer_pretty(f, &all_events)?;
        }
        Commands::Codes => {
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
        }
        Commands::Search { query } => {
            let q = query.join(" ");
            let events = load_events()?;
            let index = load_name_index()?;
            cmd_search(&q, &events, &index);
        }
        Commands::Stats => {
            let entities = load_entities()?;
            let events = load_events()?;
            cmd_stats(&entities.entities, &events);
        }
        Commands::Tag { tag } => {
            let events = load_events()?;
            let index = load_name_index()?;
            cmd_tag(&tag, &events, &index);
        }
        Commands::Range { start, end } => {
            let events = load_events()?;
            let index = load_name_index()?;
            cmd_range(&start, &end, &events, &index);
        }
    }
    Ok(())
}
