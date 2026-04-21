use clap::{Parser, Subcommand};
use commands::*;

mod types;
mod storage;
mod validation;
mod commands;

use types::AppError;

#[derive(Parser)]
#[command(name = "eaa", about = "EAA conduct score event-sourced CLI v2.0")]
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
    /// Revert an event
    Revert {
        event_id: String,
        #[arg(long, default_value = "")]
        reason: String,
        #[arg(long)]
        operator: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
    /// List all reason codes
    Codes,
    /// Search events by keyword
    Search { query: Vec<String> },
    /// Show statistics summary
    Stats,
    /// Tag management
    Tag { #[arg(default_value = "")] tag: String },
    /// Query events in a date range
    Range { start: String, end: String },
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
        Commands::Search { query } => cmd_search(&query.join(" "))?,
        Commands::Stats => cmd_stats()?,
        Commands::Tag { tag } => cmd_tag(&tag)?,
        Commands::Range { start, end } => cmd_range(&start, &end)?,
    }
    Ok(())
}
