//! BudgetGuardrail — 限制 agent 的资源消耗
//!
//! 阶段二目标:
//! - max_rounds (硬上限, 默认 8)
//! - max_input_tokens / max_output_tokens (软上限, 超限记 warn 但不中断)
//! - max_cost_usd_micros (硬上限, 超限 abort)
//! - max_wall_time_sec (硬上限)
//!
//! 阶段三接入 Guardrails 时, 这个模块会被包成 Guardrail 中间件, 但 API 稳定。

use crate::harness::error::{BudgetKind, HarnessError, Result};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Budget {
    pub max_rounds: u64,
    pub max_input_tokens: u64,
    pub max_output_tokens: u64,
    pub max_cost_usd_micros: u64,
    pub max_wall_time_sec: u64,
}

impl Default for Budget {
    fn default() -> Self {
        Self {
            max_rounds: 8,
            max_input_tokens: 100_000,
            max_output_tokens: 50_000,
            max_cost_usd_micros: 1_000_000, // 1 USD
            max_wall_time_sec: 300, // 5 分钟
        }
    }
}

impl Budget {
    /// 软预算 (Phase 2 默认)
    pub fn soft() -> Self {
        Self::default()
    }

    /// 紧预算 (评估场景, 给 LLM-as-a-Judge 用)
    pub fn tight() -> Self {
        Self {
            max_rounds: 4,
            max_input_tokens: 30_000,
            max_output_tokens: 10_000,
            max_cost_usd_micros: 200_000,
            max_wall_time_sec: 60,
        }
    }

    pub fn from_env() -> Self {
        let mut b = Self::default();
        if let Ok(s) = std::env::var("AGENT_MAX_ROUNDS") {
            if let Ok(n) = s.parse() {
                b.max_rounds = n;
            }
        }
        if let Ok(s) = std::env::var("AGENT_MAX_COST_USD") {
            if let Ok(n) = s.parse::<f64>() {
                b.max_cost_usd_micros = (n * 1_000_000.0) as u64;
            }
        }
        b
    }
}

// =============================================================
// Tracker — 运行时跟踪使用量, 在每步前/后调 check
// =============================================================

#[derive(Debug, Clone)]
pub struct BudgetTracker {
    budget: Budget,
    started_at: std::time::Instant,
    rounds: u64,
    input_tokens: u64,
    output_tokens: u64,
    cost_usd_micros: u64,
}

impl BudgetTracker {
    pub fn new(budget: Budget) -> Self {
        Self {
            budget,
            started_at: std::time::Instant::now(),
            rounds: 0,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd_micros: 0,
        }
    }

    pub fn on_round_started(&mut self) -> Result<()> {
        self.rounds += 1;
        self.check(BudgetKind::Rounds)
    }

    pub fn on_usage(&mut self, in_tok: u64, out_tok: u64, cost_micros: u64) -> Result<()> {
        self.input_tokens += in_tok;
        self.output_tokens += out_tok;
        self.cost_usd_micros += cost_micros;
        // 硬上限
        self.check(BudgetKind::InputTokens)?;
        self.check(BudgetKind::OutputTokens)?;
        self.check(BudgetKind::CostUsd)
    }

    pub fn check_wall_time(&self) -> Result<()> {
        let elapsed = self.started_at.elapsed().as_secs();
        if elapsed > self.budget.max_wall_time_sec {
            return Err(HarnessError::BudgetExceeded {
                kind: BudgetKind::WallTimeSec,
                used: elapsed,
                limit: self.budget.max_wall_time_sec,
            });
        }
        Ok(())
    }

    fn check(&self, kind: BudgetKind) -> Result<()> {
        let (used, limit) = match kind {
            BudgetKind::Rounds => (self.rounds, self.budget.max_rounds),
            BudgetKind::InputTokens => (self.input_tokens, self.budget.max_input_tokens),
            BudgetKind::OutputTokens => (self.output_tokens, self.budget.max_output_tokens),
            BudgetKind::CostUsd => (self.cost_usd_micros, self.budget.max_cost_usd_micros),
            BudgetKind::WallTimeSec => {
                let elapsed = self.started_at.elapsed().as_secs();
                (elapsed, self.budget.max_wall_time_sec)
            }
        };
        if used > limit {
            return Err(HarnessError::BudgetExceeded { kind, used, limit });
        }
        Ok(())
    }

    pub fn snapshot(&self) -> BudgetSnapshot {
        BudgetSnapshot {
            rounds: self.rounds,
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            cost_usd_micros: self.cost_usd_micros,
            elapsed_sec: self.started_at.elapsed().as_secs(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BudgetSnapshot {
    pub rounds: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd_micros: u64,
    pub elapsed_sec: u64,
}