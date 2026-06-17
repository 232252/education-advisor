//! Agent 运行 trace 模型
//!
//! 供 Evaluation Harness 收集并评分使用。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 单个工具调用的 trace
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TraceToolCall {
    pub name: String,
    pub args: Value,
    pub result: Option<Value>,
    pub is_write: bool,
    /// 风险等级 ("low" | "medium" | "high" | "destructive")
    pub risk: String,
    /// 状态 ("executed" | "rejected" | "failed")
    pub status: String,
    /// 错误信息 (失败时)
    pub error: Option<String>,
}

/// 单 case 的运行 trace
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunTrace {
    pub case_id: String,
    pub final_text: String,
    pub tool_calls: Vec<TraceToolCall>,
    pub rounds: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd_micros: u64,
    /// "success" | "aborted" | "failure" | "blocked"
    pub status: String,
    pub error: Option<String>,
    pub latency_ms: u64,
}

impl Default for RunTrace {
    fn default() -> Self {
        Self {
            case_id: String::new(),
            final_text: String::new(),
            tool_calls: Vec::new(),
            rounds: 0,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd_micros: 0,
            status: "failure".to_string(),
            error: None,
            latency_ms: 0,
        }
    }
}

impl RunTrace {
    pub fn is_success(&self) -> bool {
        self.status == "success"
    }

    pub fn is_blocked(&self) -> bool {
        self.status == "blocked"
    }

    pub fn tool_names(&self) -> Vec<&str> {
        self.tool_calls.iter().map(|t| t.name.as_str()).collect()
    }
}
