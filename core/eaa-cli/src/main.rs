use clap::{Parser, Subcommand};
use commands::*;

mod types;
mod storage;
mod validation;
mod commands;

use types::AppError;

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
}

fn main() -> Result<(), AppError> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Info => cmd_info()?,
        Commands::Validate => cmd_validate()?,
        Commands::Replay => cmd_replay()?,
        Commands::History { name } => cmd_history(&name)?,
        Commands::Ranking { n } => cmd_ranking(n)?,
        Commands::Score { name } => cmd_score(&name)?,
        Commands::Add { name, reason_code, tags, delta, note, operator, dry_run, force } =>
            cmd_add(&name, &reason_code, &tags, delta, &note, operator.as_deref(), dry_run, force)?,
        Commands::Revert { event_id, reason, operator, dry_run } =>
            cmd_revert(&event_id, &reason, operator.as_deref(), dry_run)?,
        Commands::Codes => cmd_codes()?,
        Commands::Search { query, limit } => cmd_search(&query.join(" "), limit)?,
        Commands::Stats => cmd_stats()?,
        Commands::Tag { tag } => cmd_tag(&tag)?,
        Commands::Range { start, end, limit } => cmd_range(&start, &end, limit)?,
        Commands::ListStudents => cmd_list_students()?,
        Commands::AddStudent { name } => cmd_add_student(&name)?,
        Commands::Import { file } => cmd_import(&file)?,
        Commands::Export => cmd_export()?,
        Commands::Doctor => cmd_doctor()?,
    }
    Ok(())
}
