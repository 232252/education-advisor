use clap::{Parser, Subcommand};
use commands::*;
use privacy::PrivacyEngine;
use types::AppError;

mod commands;
mod privacy;
mod storage;
mod types;
mod validation;

#[derive(Parser)]
#[command(name = "eaa", about = "EAA 事件溯源操行分系统 v3.1.2", version)]
struct Cli {
    /// 输出格式: text(默认) 或 json
    #[arg(short = 'O', long, global = true, default_value = "text")]
    output: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 系统信息
    Info,
    /// 校验所有事件
    Validate,
    /// 重算并显示排行榜
    Replay,
    /// 学生事件时间线
    History { name: String },
    /// 排行榜
    Ranking { #[arg(default_value = "10")] n: usize },
    /// 查询单个学生分数
    Score { name: String },
    /// 新增事件（严格校验）
    Add {
        name: String,
        reason_code: String,
        #[arg(long, default_value = "")]
        tags: String,
        #[arg(long, default_value_t = 0.0, allow_negative_numbers = true)]
        delta: f64,
        #[arg(long, default_value = "")]
        note: String,
        #[arg(long)]
        operator: Option<String>,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        force: bool,
    },
    /// 撤销事件
    Revert {
        event_id: String,
        #[arg(long, default_value = "")]
        reason: String,
        #[arg(long)]
        operator: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
    /// 列出所有原因码
    Codes,
    /// 按关键词搜索事件
    Search {
        query: Vec<String>,
        #[arg(long, default_value = "50")]
        limit: usize,
    },
    /// 数据统计摘要
    Stats,
    /// 标签管理
    Tag { #[arg(default_value = "")] tag: String },
    /// 按日期范围查询事件
    Range {
        start: String,
        end: String,
        #[arg(long, default_value = "100")]
        limit: usize,
    },
    /// 列出所有学生
    ListStudents,
    /// 添加新学生
    AddStudent { name: String },
    /// 删除学生（保留历史事件，标记归档）
    DeleteStudent {
        name: String,
        #[arg(long)]
        confirm: bool,
        #[arg(long, default_value = "")]
        reason: String,
        #[arg(long)]
        dry_run: bool,
    },
    /// 从JSON文件批量导入学生
    Import { file: String },
    /// 导出排行榜 (csv/jsonl/html)
    Export {
        /// 导出格式: csv(默认), jsonl, html
        #[arg(long, default_value = "csv")]
        format: String,
        /// 输出文件路径（默认stdout）
        #[arg(long)]
        output_file: Option<String>,
    },
    /// 环境健康检查
    Doctor,
    /// 隐私脱敏引擎 (PII Shield)
    Privacy {
        #[command(subcommand)]
        sub: PrivacyCmd,
    },
    /// [NEW] 区间汇总视图
    Summary {
        /// 起始日期 (YYYY-MM-DD)
        #[arg(long)]
        since: Option<String>,
        /// 结束日期 (YYYY-MM-DD)
        #[arg(long)]
        until: Option<String>,
    },
    /// [NEW] 设置学生实体属性（分组/角色/班级）
    SetStudentMeta {
        name: String,
        #[arg(long)]
        group: Option<String>,
        #[arg(long)]
        role: Option<String>,
        #[arg(long)]
        class_id: Option<String>,
    },
    /// [NEW] 生成静态HTML仪表盘
    Dashboard {
        /// 输出目录（默认 ./eaa-dashboard）
        #[arg(long)]
        output_dir: Option<String>,
        /// 自动打开浏览器
        #[arg(long)]
        open: bool,
    },
}

#[derive(Subcommand)]
enum PrivacyCmd {
    Init { password: String, #[arg(long)] auto_scan: bool },
    Load { password: String },
    Enable,
    Disable { password: String },
    Add { #[arg(long)] entity: String, #[arg(long)] text: String },
    List,
    Anonymize { text: String },
    Deanonymize { text: String },
    Filter { #[arg(long)] receiver: String, text: String },
    DryRun { text: String },
    Backup { path: String },
}

fn parse_output(s: &str) -> types::OutputMode {
    s.parse().unwrap_or(types::OutputMode::Text)
}

fn get_data_dir() -> std::path::PathBuf {
    std::env::var("EAA_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("./data"))
}

fn main() -> Result<(), AppError> {
    let cli = Cli::parse();
    let output = parse_output(&cli.output);

    match &cli.command {
        Commands::Privacy { sub } => return handle_privacy(sub),
        Commands::Info => cmd_info(output)?,
        Commands::Score { name } => cmd_score(name, output)?,
        Commands::Validate => cmd_validate(output)?,
        Commands::Replay => cmd_replay(output)?,
        Commands::History { name } => cmd_history(name, output)?,
        Commands::Ranking { n } => cmd_ranking(*n, output)?,
        Commands::Add { name, reason_code, tags, delta, note, operator, dry_run, force } =>
            cmd_add(name, reason_code, tags, *delta, note, operator.as_deref(), *dry_run, *force)?,
        Commands::Revert { event_id, reason, operator, dry_run } =>
            cmd_revert(event_id, reason, operator.as_deref(), *dry_run)?,
        Commands::Codes => cmd_codes(output)?,
        Commands::Search { query, limit } => cmd_search(&query.join(" "), *limit, output)?,
        Commands::Stats => cmd_stats(output)?,
        Commands::Tag { tag } => cmd_tag(tag, output)?,
        Commands::Range { start, end, limit } => cmd_range(start, end, *limit, output)?,
        Commands::ListStudents => cmd_list_students(output)?,
        Commands::AddStudent { name } => cmd_add_student(name)?,
        Commands::DeleteStudent { name, confirm, reason, dry_run } =>
            cmd_delete_student(name, *confirm, reason, *dry_run)?,
        Commands::Import { file } => cmd_import(file)?,
        Commands::Export { format, output_file } =>
            cmd_export(format, output_file.as_deref())?,
        Commands::Doctor => cmd_doctor(output)?,
        Commands::Summary { since, until } =>
            cmd_summary(since.as_deref(), until.as_deref(), output)?,
        Commands::SetStudentMeta { name, group, role, class_id } =>
            cmd_set_student_meta(name, group.as_deref(), role.as_deref(), class_id.as_deref())?,
        Commands::Dashboard { output_dir, open } =>
            cmd_dashboard(output_dir.as_deref(), *open)?,
    }
    Ok(())
}

fn load_engine(data_dir: &std::path::PathBuf, password: &str) -> Result<PrivacyEngine, String> {
    let mut engine = PrivacyEngine::default();
    engine.load(data_dir, password).map_err(|e| e.to_string())?;
    Ok(engine)
}

fn handle_privacy(cmd: &PrivacyCmd) -> Result<(), AppError> {
    let data_dir = get_data_dir();
    match cmd {
        PrivacyCmd::Init { password, auto_scan } => {
            let mut engine = PrivacyEngine::default();
            engine.init(&data_dir, password).map_err(|e| AppError::Validation(e.to_string()))?;
            println!("✅ 隐私脱敏引擎初始化成功");
            if *auto_scan {
                match engine.auto_scan_students(&data_dir) {
                    Ok(0) => println!("ℹ️ 未找到学生数据文件"),
                    Ok(n) => println!("✅ 已自动导入 {} 名学生", n),
                    Err(e) => println!("⚠️ 扫描失败: {}", e),
                }
            }
            println!("📊 映射: {} 个实体", engine.mapping_count());
            Ok(())
        }
        PrivacyCmd::Load { password } => {
            match load_engine(&data_dir, password) {
                Ok(engine) => {
                    println!("✅ 引擎加载成功，映射: {} 个实体", engine.mapping_count());
                    Ok(())
                }
                Err(e) => { println!("❌ {}", e); Ok(()) }
            }
        }
        PrivacyCmd::Enable => { println!("✅ 脱敏已启用"); Ok(()) }
        PrivacyCmd::Disable { password } => {
            match load_engine(&data_dir, password) {
                Ok(_) => println!("⚠️ 脱敏已关闭"), Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }
        PrivacyCmd::Add { entity, text } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() { println!("❌ 请设置 EAA_PRIVACY_PASSWORD"); return Ok(()); }
            match load_engine(&data_dir, &pwd) {
                Ok(mut engine) => match engine.add_entity(&privacy::EntityType::from_str(entity), text) {
                    Ok(alias) => println!("✅ {} → {}", text, alias),
                    Err(e) => println!("❌ {}", e),
                },
                Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }
        PrivacyCmd::List => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() { println!("（需要 EAA_PRIVACY_PASSWORD）"); return Ok(()); }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => {
                    let entries = engine.list_mappings();
                    if entries.is_empty() { println!("（无映射）"); }
                    else {
                        println!("{:<6} {:<12} {}", "类型", "化名", "真名");
                        println!("{}", "-".repeat(40));
                        for e in &entries { println!("{:<6} {:<12} {}", e.entity_type, e.alias, e.real_name); }
                        println!("共 {} 个", entries.len());
                    }
                }
                Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }
        PrivacyCmd::Anonymize { text } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() { println!("{}", text); return Ok(()); }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => println!("{}", engine.anonymize(text)),
                Err(_) => println!("{}", text),
            }
            Ok(())
        }
        PrivacyCmd::Deanonymize { text } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() { println!("{}", text); return Ok(()); }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => println!("{}", engine.deanonymize(text)),
                Err(_) => println!("{}", text),
            }
            Ok(())
        }
        PrivacyCmd::Filter { receiver, text } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() { println!("{}", text); return Ok(()); }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => println!("{}", engine.filter_for_receiver(text, receiver)),
                Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }
        PrivacyCmd::DryRun { text } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() { println!("⚠️ 需要设置 EAA_PRIVACY_PASSWORD"); return Ok(()); }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => {
                    let anon = engine.anonymize(text);
                    let restored = engine.deanonymize(&anon);
                    println!("原文:   {}", text);
                    println!("脱敏:   {}", anon);
                    println!("还原:   {}", restored);
                    if restored == *text { println!("✅ 往返通过"); }
                    else { println!("⚠️ 不匹配"); }
                }
                Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }
        PrivacyCmd::Backup { path } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() { println!("❌ 需要 EAA_PRIVACY_PASSWORD"); return Ok(()); }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => match engine.backup(&std::path::PathBuf::from(path)) {
                    Ok(_) => println!("✅ 已备份: {}", path),
                    Err(e) => println!("❌ {}", e),
                },
                Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }
    }
}
