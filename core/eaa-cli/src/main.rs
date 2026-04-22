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
#[command(name = "eaa", about = "EAA 事件溯源操行分系统 - 教育顾问数据引擎", version)]
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
    /// 从JSON文件批量导入学生
    Import { file: String },
    /// 导出排行榜为CSV
    Export,
    /// 环境健康检查
    Doctor,
    /// 隐私脱敏引擎 (PII Shield)
    Privacy {
        #[command(subcommand)]
        sub: PrivacyCmd,
    },
}

#[derive(Subcommand)]
enum PrivacyCmd {
    /// 初始化隐私引擎（设置密码 + 可选自动扫描学生）
    Init {
        /// 加密密码（请牢记，丢失后无法恢复）
        password: String,
        /// 自动扫描现有学生数据
        #[arg(long)]
        auto_scan: bool,
    },
    /// 加载已有引擎（需要密码）
    Load {
        /// 加密密码
        password: String,
    },
    /// 全局启用脱敏
    Enable,
    /// 关闭脱敏（需要密码确认）
    Disable {
        password: String,
    },
    /// 添加敏感实体映射
    Add {
        /// 实体类型: student/parent/class/school/phone/idcard/address
        #[arg(long)]
        entity: String,
        /// 实体真实内容
        #[arg(long)]
        text: String,
    },
    /// 列出所有化名映射（真名 + 化名，仅本地可见）
    List,
    /// 脱敏文本（真名 → 化名）
    Anonymize {
        /// 待脱敏文本
        text: String,
    },
    /// 还原文本（化名 → 真名）
    Deanonymize {
        /// 待还原文本
        text: String,
    },
    /// 定向过滤（模拟发给某家长时的效果）
    Filter {
        /// 接收者真实姓名
        #[arg(long)]
        receiver: String,
        /// 待过滤文本
        text: String,
    },
    /// 往返测试（脱敏→还原→对比）
    DryRun {
        /// 测试文本
        text: String,
    },
    /// 备份加密映射表
    Backup {
        /// 备份文件路径
        path: String,
    },
}

fn get_data_dir() -> std::path::PathBuf {
    std::env::var("EAA_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("./data"))
}

fn main() -> Result<(), AppError> {
    let cli = Cli::parse();

    match &cli.command {
        Commands::Privacy { sub } => return handle_privacy(sub),
        Commands::Info => cmd_info()?,
        Commands::Score { name } => cmd_score(name)?,
        Commands::Validate => cmd_validate()?,
        Commands::Replay => cmd_replay()?,
        Commands::History { name } => cmd_history(name)?,
        Commands::Ranking { n } => cmd_ranking(*n)?,
        Commands::Add { name, reason_code, tags, delta, note, operator, dry_run, force } => {
            cmd_add(name, reason_code, tags, *delta, note, operator.as_deref(), *dry_run, *force)?
        }
        Commands::Revert { event_id, reason, operator, dry_run } => {
            cmd_revert(event_id, reason, operator.as_deref(), *dry_run)?
        }
        Commands::Codes => cmd_codes()?,
        Commands::Search { query, limit } => cmd_search(&query.join(" "), *limit)?,
        Commands::Stats => cmd_stats()?,
        Commands::Tag { tag } => cmd_tag(tag)?,
        Commands::Range { start, end, limit } => cmd_range(start, end, *limit)?,
        Commands::ListStudents => cmd_list_students()?,
        Commands::AddStudent { name } => cmd_add_student(name)?,
        Commands::Import { file } => cmd_import(file)?,
        Commands::Export => cmd_export()?,
        Commands::Doctor => cmd_doctor()?,
    }
    Ok(())
}

/// 创建并加载引擎
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
            engine
                .init(&data_dir, password)
                .map_err(|e| AppError::Validation(e.to_string()))?;
            println!("✅ 隐私脱敏引擎初始化成功");
            if *auto_scan {
                match engine.auto_scan_students(&data_dir) {
                    Ok(0) => println!("ℹ️ 未找到学生数据文件"),
                    Ok(n) => println!("✅ 已自动导入 {} 名学生", n),
                    Err(e) => println!("⚠️ 扫描失败: {}", e),
                }
            }
            let count = engine.mapping_count();
            if count > 0 {
                println!("📊 当前映射: {} 个实体", count);
            }
            println!("⚠️ 请牢记密码，丢失后无法恢复映射表");
            println!("💡 后续使用需要密码: eaa privacy load <密码>");
            Ok(())
        }

        PrivacyCmd::Load { password } => {
            match load_engine(&data_dir, password) {
                Ok(engine) => {
                    println!("✅ 引擎加载成功");
                    println!("📊 映射: {} 个实体", engine.mapping_count());
                    let entries = engine.list_mappings();
                    if !entries.is_empty() {
                        println!("\n{:<6} {:<12} {}", "类型", "化名", "真名");
                        println!("{}", "-".repeat(40));
                        for e in &entries {
                            println!("{:<6} {:<12} {}", e.entity_type, e.alias, e.real_name);
                        }
                    }
                    Ok(())
                }
                Err(e) => {
                    println!("❌ {}", e);
                    Ok(())
                }
            }
        }

        PrivacyCmd::Enable => {
            if !PrivacyEngine::is_initialized(&data_dir) {
                println!("❌ 引擎未初始化，请先运行 eaa privacy init <密码>");
                return Ok(());
            }
            println!("✅ 隐私脱敏已启用（需配合 load 使用）");
            Ok(())
        }

        PrivacyCmd::Disable { password } => {
            match load_engine(&data_dir, password) {
                Ok(_) => println!("⚠️ 脱敏引擎已关闭（仅限本地调试）"),
                Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }

        PrivacyCmd::Add { entity, text } => {
            // 密码从环境变量读取
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() {
                println!("❌ 添加映射需要密码，请设置环境变量 EAA_PRIVACY_PASSWORD");
                println!("   或使用: EAA_PRIVACY_PASSWORD=你的密码 eaa privacy add --entity {} --text {}", entity, text);
                return Ok(());
            }
            match load_engine(&data_dir, &pwd) {
                Ok(mut engine) => {
                    let et = privacy::EntityType::from_str(entity);
                    match engine.add_entity(&et, text) {
                        Ok(alias) => {
                            println!("✅ {} → {}", text, alias);
                            println!("📊 总映射: {} 个", engine.mapping_count());
                        }
                        Err(e) => println!("❌ {}", e),
                    }
                }
                Err(e) => println!("❌ 加载失败: {}（密码错误？）", e),
            }
            Ok(())
        }

        PrivacyCmd::List => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() {
                if !PrivacyEngine::is_initialized(&data_dir) {
                    println!("（无映射，请先运行 eaa privacy init <密码>）");
                    return Ok(());
                }
                println!("（需要密码查看，请设置 EAA_PRIVACY_PASSWORD）");
                return Ok(());
            }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => {
                    let entries = engine.list_mappings();
                    if entries.is_empty() {
                        println!("（无映射）");
                    } else {
                        println!("{:<6} {:<12} {}", "类型", "化名", "真名");
                        println!("{}", "-".repeat(40));
                        for e in &entries {
                            println!("{:<6} {:<12} {}", e.entity_type, e.alias, e.real_name);
                        }
                        println!("\n共 {} 个映射", entries.len());
                    }
                }
                Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }

        PrivacyCmd::Anonymize { text } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() {
                println!("⚠️ 引擎未加载，原文输出: {}", text);
                println!("💡 设置 EAA_PRIVACY_PASSWORD 环境变量以启用脱敏");
                return Ok(());
            }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => {
                    let result = engine.anonymize(text);
                    println!("{}", result);
                }
                Err(e) => {
                    println!("⚠️ 引擎加载失败，原文输出: {}", text);
                    println!("   错误: {}", e);
                }
            }
            Ok(())
        }

        PrivacyCmd::Deanonymize { text } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() {
                println!("⚠️ 引擎未加载，原文输出: {}", text);
                return Ok(());
            }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => {
                    let result = engine.deanonymize(text);
                    println!("{}", result);
                }
                Err(e) => {
                    println!("⚠️ 引擎加载失败: {}", e);
                }
            }
            Ok(())
        }

        PrivacyCmd::Filter { receiver, text } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() {
                println!("⚠️ 引擎未加载，原文输出");
                println!("原文: {}", text);
                return Ok(());
            }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => {
                    let filtered = engine.filter_for_receiver(text, receiver);
                    println!("接收者: {}", receiver);
                    println!("原文:   {}", text);
                    println!("过滤后: {}", filtered);
                }
                Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }

        PrivacyCmd::DryRun { text } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() {
                println!("⚠️ 引擎未加载，无法测试");
                println!("💡 设置 EAA_PRIVACY_PASSWORD 环境变量");
                return Ok(());
            }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => {
                    let anon = engine.anonymize(text);
                    let restored = engine.deanonymize(&anon);
                    println!("原文:   {}", text);
                    println!("脱敏:   {}", anon);
                    println!("还原:   {}", restored);
                    if restored == *text {
                        println!("✅ 往返测试通过");
                    } else {
                        println!("⚠️ 往返测试不匹配");
                        // 找出差异
                        for (i, (a, b)) in restored.chars().zip(text.chars()).enumerate() {
                            if a != b {
                                println!("   首个差异位置 {}: 还原='{}' 原文='{}'", i, a, b);
                                break;
                            }
                        }
                    }
                }
                Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }

        PrivacyCmd::Backup { path } => {
            let pwd = std::env::var("EAA_PRIVACY_PASSWORD").unwrap_or_default();
            if pwd.is_empty() {
                println!("❌ 需要密码，请设置 EAA_PRIVACY_PASSWORD");
                return Ok(());
            }
            match load_engine(&data_dir, &pwd) {
                Ok(engine) => {
                    let dest = std::path::PathBuf::from(path);
                    match engine.backup(&dest) {
                        Ok(_) => println!("✅ 映射表已备份到: {}", path),
                        Err(e) => println!("❌ {}", e),
                    }
                }
                Err(e) => println!("❌ {}", e),
            }
            Ok(())
        }
    }
}
