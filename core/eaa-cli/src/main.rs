use clap::{Parser, Subcommand};
use commands::*;

mod types;
mod storage;
mod validation;
mod commands;
mod privacy;

use privacy::PrivacyEngine;
use types::AppError;

static PRIVACY: once_cell::sync::Lazy<std::sync::RwLock<PrivacyEngine>> =
    once_cell::sync::Lazy::new(|| std::sync::RwLock::new(PrivacyEngine::default()));

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
    /// 隐私脱敏引擎
    Privacy {
        #[command(subcommand)]
        sub: PrivacyCmd,
    },
}

#[derive(Subcommand)]
enum PrivacyCmd {
    /// 初始化隐私引擎（设置密码，会扫描现有学生数据）
    Init {
        /// 加密密码
        password: String,
        /// 自动扫描现有学生数据
        #[arg(long)]
        auto_scan: bool,
    },
    /// 全局启用脱敏引擎
    Enable,
    /// 关闭脱敏引擎（需密码）
    Disable {
        password: String,
    },
    /// 添加敏感实体映射
    Add {
        /// 实体类型: student/parent/class/school/phone/idcard/address
        #[arg(long)]
        entity: String,
        /// 实体内容
        text: String,
    },
    /// 列出所有化名映射（仅显示化名）
    List,
    /// 脱敏一段文本
    Anonymize {
        text: String,
    },
    /// 还原一段文本
    Deanonymize {
        text: String,
    },
    /// 测试脱敏效果
    DryRun {
        text: String,
    },
}

fn main() -> Result<(), AppError> {
    let cli = Cli::parse();

    // 处理隐私子命令（不依赖数据目录）
    if let Commands::Privacy { sub } = &cli.command {
        return handle_privacy(sub);
    }

    match &cli.command {
        Commands::Info => cmd_info()?,
        Commands::Validate => cmd_validate()?,
        Commands::Replay => cmd_replay()?,
        Commands::History { name } => cmd_history(name)?,
        Commands::Ranking { n } => cmd_ranking(*n)?,
        Commands::Score { name } => cmd_score(name)?,
        Commands::Add { name, reason_code, tags, delta, note, operator, dry_run, force } =>
            cmd_add(name, reason_code, tags, *delta, note, operator.as_deref(), *dry_run, *force)?,
        Commands::Revert { event_id, reason, operator, dry_run } =>
            cmd_revert(event_id, reason, operator.as_deref(), *dry_run)?,
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
        Commands::Privacy { .. } => unreachable!(),
    }
    Ok(())
}

fn handle_privacy(cmd: &PrivacyCmd) -> Result<(), AppError> {
    use std::path::PathBuf;

    let data_dir = std::env::var("EAA_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./data"));

    match cmd {
        PrivacyCmd::Init { password, auto_scan } => {
            let mut engine = PRIVACY.write().unwrap();
            engine.init(data_dir.clone(), password)
                .map_err(|e| AppError::Validation(e.to_string()))?;
            println!("✅ 隐私脱敏引擎初始化成功");
            if *auto_scan {
                let entities_path = data_dir.join("entities/entities.json");
                if entities_path.exists() {
                    match engine.auto_scan_students(&entities_path) {
                        Ok(n) => println!("✅ 已扫描 {} 名学生", n),
                        Err(e) => println!("⚠️ 扫描失败: {}", e),
                    }
                }
            }
            println!("⚠️ 请牢记密码，丢失后无法恢复映射表");
            Ok(())
        }
        PrivacyCmd::Enable => {
            let mut engine = PRIVACY.write().unwrap();
            engine.enabled = true;
            println!("✅ 隐私脱敏引擎已启用");
            Ok(())
        }
        PrivacyCmd::Disable { password } => {
            let mut engine = PRIVACY.write().unwrap();
            match engine.load(data_dir, password) {
                Ok(_) => {
                    engine.enabled = false;
                    println!("⚠️ 隐私脱敏引擎已关闭（仅本地调试）");
                    Ok(())
                }
                Err(e) => {
                    println!("❌ 密码错误: {}", e);
                    Ok(())
                }
            }
        }
        PrivacyCmd::Add { entity, text } => {
            let et = privacy::EntityType::from_str(entity);
            let mut engine = PRIVACY.write().unwrap();
            match engine.add_entity(et, text) {
                Ok(alias) => {
                    println!("{} → {}", text, alias);
                    Ok(())
                }
                Err(e) => {
                    println!("❌ {}", e);
                    Ok(())
                }
            }
        }
        PrivacyCmd::List => {
            let engine = PRIVACY.read().unwrap();
            let aliases = engine.list_aliases();
            if aliases.is_empty() {
                println!("（无映射，请先运行 eaa privacy init）");
            } else {
                for (et, alias) in aliases {
                    println!("{}: {}", et, alias);
                }
            }
            Ok(())
        }
        PrivacyCmd::Anonymize { text } => {
            let engine = PRIVACY.read().unwrap();
            if !engine.enabled {
                println!("⚠️ 引擎未启用，原文输出");
            }
            println!("{}", engine.anonymize(text));
            Ok(())
        }
        PrivacyCmd::Deanonymize { text } => {
            let engine = PRIVACY.read().unwrap();
            if !engine.enabled {
                println!("⚠️ 引擎未启用，原文输出");
            }
            println!("{}", engine.deanonymize(text));
            Ok(())
        }
        PrivacyCmd::DryRun { text } => {
            let engine = PRIVACY.read().unwrap();
            if !engine.enabled {
                println!("⚠️ 引擎未启用，原文输出: {}", text);
            } else {
                let anon = engine.anonymize(text);
                println!("原文: {}", text);
                println!("脱敏: {}", anon);
                let restored = engine.deanonymize(&anon);
                println!("还原: {}", restored);
                if restored == *text {
                    println!("✅ 往返测试通过");
                } else {
                    println!("⚠️ 往返测试失败");
                }
            }
            Ok(())
        }
    }
}
