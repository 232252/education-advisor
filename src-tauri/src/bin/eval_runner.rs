//! `eval-runner` CLI — Evaluation Harness 命令行入口
//!
//! # 用法
//! ```text
//! eval-runner --dataset eval/datasets/safety.jsonl --out-dir reports/safety
//! eval-runner --dataset-dir eval/datasets --out-dir reports/all --pass-rate 0.8 --judge-model gpt-4o-mini
//! eval-runner --dataset eval/datasets/privacy.jsonl --stub-judge   # 烟雾测试, 不发真 LLM
//! ```
//!
//! # 行为
//! 1. 加载 JSONL 数据集 (单文件 / 整个目录)
//! 2. 构造 EvalRunner (4 个内置 Scorer + 可选 LLM Judge)
//! 3. 跑全部 case, 写 `report.html` + `report.json` 到 out-dir
//! 4. 按 `--pass-rate` 阈值判定 exit code
//!
//! # 退出码
//! - 0: pass_rate ≥ threshold
//! - 1: pass_rate < threshold (CI fail)
//! - 2: 参数 / 数据集 / 报告写盘错误
//!
//! # 真实 LLM
//! 默认走 `StubTraceProvider` (返回空 trace + 0 cost) + 跳过 Judge
//! (因为 EvalRunner 缺生产 `TraceProvider` 接入, 需要 AppHandle 启动 AgentHarness)。
//! 接入真实跑批留到 `AgentRunTraceProvider` (阶段五)。

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

use ea_tauri::harness::eval::dataset::Dataset;
use ea_tauri::harness::eval::judge::{Judge, JudgeClient};
use ea_tauri::harness::eval::report::ReportWriter;
use ea_tauri::harness::agent::trace::RunTrace;
use ea_tauri::harness::eval::runner::{EvalRunner, StubTraceProvider};
use ea_tauri::harness::eval::scorer::{
    BudgetScorer, PiiLeakScorer, SchemaValidatorScorer, ToolCallMatchScorer,
};

// =============================================================
// Args — 手写解析, 避免新增 clap 依赖
// =============================================================

struct Args {
    dataset: Option<PathBuf>,
    dataset_dir: Option<PathBuf>,
    out_dir: PathBuf,
    pass_rate: f32,
    judge_model: Option<String>,
    stub_judge: bool,
    only_tags: Vec<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args {
        dataset: None,
        dataset_dir: None,
        out_dir: PathBuf::from("reports/eval"),
        pass_rate: 0.8,
        judge_model: None,
        stub_judge: false,
        only_tags: Vec::new(),
    };
    let mut argv = std::env::args().skip(1);
    while let Some(a) = argv.next() {
        match a.as_str() {
            "--dataset" => {
                args.dataset = Some(PathBuf::from(argv.next().ok_or("--dataset needs value")?));
            }
            "--dataset-dir" => {
                args.dataset_dir = Some(PathBuf::from(
                    argv.next().ok_or("--dataset-dir needs value")?,
                ));
            }
            "--out-dir" => {
                args.out_dir = PathBuf::from(argv.next().ok_or("--out-dir needs value")?);
            }
            "--pass-rate" => {
                args.pass_rate = argv
                    .next()
                    .ok_or("--pass-rate needs value")?
                    .parse()
                    .map_err(|e| format!("invalid --pass-rate: {e}"))?;
                if !(0.0..=1.0).contains(&args.pass_rate) {
                    return Err("--pass-rate must be 0.0..=1.0".into());
                }
            }
            "--judge-model" => {
                args.judge_model = Some(argv.next().ok_or("--judge-model needs value")?);
            }
            "--stub-judge" => args.stub_judge = true,
            "--only-tags" => {
                let v = argv.next().ok_or("--only-tags needs value")?;
                args.only_tags = v.split(',').map(|s| s.trim().to_string()).collect();
            }
            "-h" | "--help" => {
                print_help();
                std::process::exit(0);
            }
            other => return Err(format!("unknown arg: {other}")),
        }
    }
    if args.dataset.is_none() && args.dataset_dir.is_none() {
        return Err("must provide --dataset <file.jsonl> or --dataset-dir <dir>".into());
    }
    Ok(args)
}

fn print_help() {
    println!("eval-runner — Evaluation Harness CLI");
    println!();
    println!("USAGE:");
    println!("  eval-runner --dataset <file.jsonl> [--out-dir DIR] [--pass-rate 0.8]");
    println!("  eval-runner --dataset-dir <dir>   [--out-dir DIR] [--pass-rate 0.8]");
    println!();
    println!("OPTIONS:");
    println!("  --dataset <file.jsonl>     单个 JSONL 数据集文件");
    println!("  --dataset-dir <dir>        加载目录下所有 .jsonl 文件");
    println!("  --out-dir <dir>            报告输出目录 (默认: reports/eval)");
    println!("  --pass-rate <0.0-1.0>      通过阈值 (默认: 0.8)");
    println!("  --judge-model <name>       Judge 模型名 (留空 = 跳过 Judge)");
    println!("  --stub-judge               用固定 verdict 跑 Judge, 不发真 LLM");
    println!("  --only-tags t1,t2          只跑含任一 tag 的 case");
    println!("  -h, --help                 打印此帮助");
}

// =============================================================
// StubJudge — 固定返回 pass verdict, 用于烟雾测试
// =============================================================

struct StubJudge;

#[async_trait::async_trait]
impl JudgeClient for StubJudge {
    async fn chat(&self, _sys: &str, _user: &str, _max: u64) -> Result<String, String> {
        Ok(r#"{"score": 1.0, "passed": true, "reasoning": "stub"}"#.into())
    }
}

// =============================================================
// 入口
// =============================================================

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("error: {e}");
            eprintln!();
            print_help();
            return ExitCode::from(2);
        }
    };

    // 1. 加载数据集
    let mut ds = Dataset::default();
    match (&args.dataset, &args.dataset_dir) {
        (Some(p), _) => {
            ds = Dataset::load(p).unwrap_or_else(|e| {
                eprintln!("failed to load {}: {e}", p.display());
                std::process::exit(2);
            });
        }
        (_, Some(d)) => {
            let entries = std::fs::read_dir(d).unwrap_or_else(|e| {
                eprintln!("failed to read dir {}: {e}", d.display());
                std::process::exit(2);
            });
            for entry in entries {
                let p = entry.unwrap().path();
                if p.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                    let part = Dataset::load(&p).unwrap_or_else(|e| {
                        eprintln!("failed to load {}: {e}", p.display());
                        std::process::exit(2);
                    });
                    ds = Dataset::merge(vec![ds, part]);
                }
            }
        }
        _ => unreachable!(),
    }
    if !args.only_tags.is_empty() {
        ds = ds.filter_tags(&args.only_tags);
    }
    println!("loaded {} cases", ds.len());
    if ds.is_empty() {
        eprintln!("no cases to run");
        return ExitCode::from(2);
    }

    // 2. 构造 EvalRunner
    let trace = RunTrace::default();
    let mut runner = EvalRunner::new(Arc::new(StubTraceProvider(trace)))
        .with_scorer(Arc::new(PiiLeakScorer))
        .with_scorer(Arc::new(ToolCallMatchScorer))
        .with_scorer(Arc::new(SchemaValidatorScorer))
        .with_scorer(Arc::new(BudgetScorer));

    if let Some(model) = &args.judge_model {
        use ea_tauri::harness::eval::judge::LlmJudge;
        let client: Box<dyn JudgeClient> = if args.stub_judge {
            Box::new(StubJudge)
        } else {
            eprintln!(
                "warning: --judge-model set but real LLM client is not wired in this build; \
                 falling back to StubJudge (set --stub-judge to silence this)"
            );
            Box::new(StubJudge)
        };
        let judge: Arc<dyn Judge> = Arc::new(LlmJudge::new(client, model.clone()));
        runner = runner.with_judge(judge);
    } else if args.stub_judge {
        eprintln!("warning: --stub-judge ignored (no --judge-model set)");
    }

    // 3. 跑
    let report = runner.run_dataset(ds.cases.to_vec()).await;

    // 4. 写报告
    std::fs::create_dir_all(&args.out_dir).unwrap_or_else(|e| {
        eprintln!("failed to create out dir: {e}");
        std::process::exit(2);
    });
    let json_path = args.out_dir.join("report.json");
    let html_path = args.out_dir.join("report.html");
    ReportWriter::write_json(&report, &json_path).unwrap_or_else(|e| {
        eprintln!("failed to write json report: {e}");
        std::process::exit(2);
    });
    ReportWriter::write_html(&report, &html_path).unwrap_or_else(|e| {
        eprintln!("failed to write html report: {e}");
        std::process::exit(2);
    });

    // 5. 打印汇总 + 判定 exit code
    println!();
    println!("Eval Summary");
    println!("============");
    println!("Total      : {}", report.total);
    println!("Passed     : {}", report.passed);
    println!("Failed     : {}", report.failed);
    println!("Pass rate  : {:.1}%", report.pass_rate * 100.0);
    println!("Avg score  : {:.2}", report.avg_combined_score);
    println!(
        "Total cost : ${:.4}",
        report.total_cost_usd_micros as f64 / 1_000_000.0
    );
    println!();
    println!("JSON  : {}", json_path.display());
    println!("HTML  : {}", html_path.display());

    if report.is_passing(args.pass_rate) {
        println!();
        println!(
            "✅ pass_rate {:.1}% >= threshold {:.1}%",
            report.pass_rate * 100.0,
            args.pass_rate * 100.0
        );
        ExitCode::from(0)
    } else {
        println!();
        println!(
            "❌ pass_rate {:.1}% < threshold {:.1}%",
            report.pass_rate * 100.0,
            args.pass_rate * 100.0
        );
        ExitCode::from(1)
    }
}
