//! ReAct 状态机 — 显式 "计划-执行-观察-思考" 循环
//!
//! # 状态机 (参考架构蓝图 01-architecture.md §3.2)
//! ```text
//! Init -> Act -> Observe -> Act -> ... -> Reflect -> Done
//! ```
//!
//! # 阶段二职责
//! - 状态枚举 + 转换合法性
//! - `parse_step()`: 把 LLM stream_chat 输出解析为 ToolCalls 或 FinalAnswer
//! - `build_tool_result_message()`: 构造回喂给 LLM 的 tool 角色消息
//!
//! # 阶段三接入
//! - GuardrailsPre/Post 钩子替换为真正的中间件调用
//! - HITL 审批流从队列里 await resolution

use serde::{Deserialize, Serialize};

use crate::harness::error::{HarnessError, Result};
use crate::services::llm_service::{ChatMessage, StreamEvent};

/// 单个 LLM 请求工具调用 (与 StreamEvent::ToolcallStart/Delta 收敛后的产物)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedToolCall {
    pub id: String,
    pub name: String,
    pub args: serde_json::Value,
}

/// 单步 LLM 响应的解析结果
#[derive(Debug, Clone)]
pub enum StepDecision {
    /// LLM 请求工具
    ToolCalls(Vec<ParsedToolCall>),
    /// LLM 直接给出最终回答
    FinalAnswer(String),
    /// 流尚未结束, 需继续累积
    Continue,
}

impl StepDecision {
    pub fn is_final(&self) -> bool {
        matches!(self, StepDecision::FinalAnswer(_))
    }
    pub fn is_tool_call(&self) -> bool {
        matches!(self, StepDecision::ToolCalls(_))
    }
}

/// ReAct 状态机的 phase
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReactPhase {
    Init,
    Act,
    Observe,
    Reflect,
    Done,
}

fn phase_str(p: ReactPhase) -> &'static str {
    match p {
        ReactPhase::Init => "Init",
        ReactPhase::Act => "Act",
        ReactPhase::Observe => "Observe",
        ReactPhase::Reflect => "Reflect",
        ReactPhase::Done => "Done",
    }
}

/// 状态机 (无状态 — phase 由 AgentHarness 持有, 这里只装转换规则 + 解析器)
pub struct ReActMachine;

impl ReActMachine {
    /// 校验状态转换合法性
    pub fn validate_transition(from: ReactPhase, to: ReactPhase) -> Result<()> {
        use ReactPhase::*;
        let ok = matches!(
            (from, to),
            (Init, Act)
                | (Act, Observe)
                | (Observe, Act)
                | (Observe, Reflect)
                | (Reflect, Done)
                | (Act, Done) // LLM 直接给最终回答 (无 tool_call)
                | (Observe, Done)
        );
        if ok {
            Ok(())
        } else {
            Err(HarnessError::InvalidStateTransition {
                from: phase_str(from),
                to: phase_str(to),
            })
        }
    }

    /// 把 LLM 的 stream_chat 输出解析为 StepDecision
    ///
    /// 累积 StreamEvent 序列:
    /// - TextDelta → 累积到 final_text
    /// - ToolcallStart(name) → 开启一个 tool_call
    /// - ToolcallDelta(args_delta) → 累积该 tool_call 的 args
    /// - Done → 收敛, 决定是 ToolCalls 还是 FinalAnswer
    pub fn parse_step(events: &[StreamEvent]) -> StepDecision {
        let mut text = String::new();
        // (id, name, args_str)
        let mut calls: Vec<(String, String, String)> = Vec::new();

        for ev in events {
            match ev {
                StreamEvent::TextDelta { delta } => text.push_str(delta),
                StreamEvent::ToolcallStart { id, name } => {
                    calls.push((id.clone(), name.clone(), String::new()));
                }
                StreamEvent::ToolcallDelta { id, args_delta } => {
                    // 按 id 找对应的 call, 若 id 匹配最后一个则累积
                    if let Some(last) = calls.iter_mut().find(|(cid, _, _)| cid == id) {
                        last.2.push_str(args_delta);
                    } else if let Some(last) = calls.last_mut() {
                        // 兜底: id 不匹配 (部分 provider 不发 id), 累积到最后一个
                        last.2.push_str(args_delta);
                    }
                }
                _ => {}
            }
        }

        if !calls.is_empty() {
            let parsed = calls
                .into_iter()
                .map(|(id, name, args_str)| {
                    let args = serde_json::from_str(&args_str)
                        .unwrap_or(serde_json::Value::String(args_str));
                    ParsedToolCall { id, name, args }
                })
                .collect();
            return StepDecision::ToolCalls(parsed);
        }

        if !text.is_empty() {
            return StepDecision::FinalAnswer(text);
        }

        StepDecision::Continue
    }

    /// 构造回喂给 LLM 的 tool 角色消息
    ///
    /// 注意: 现有 ChatMessage 只有 role + content, tool_call_id 字段在序列化时
    /// 通过 content 前缀携带 (与原 stream_chat_with_tool_loop 的协议一致)。
    pub fn build_tool_result_message(tool_call_id: &str, result_json: &str) -> ChatMessage {
        // 协议: role=tool, content="<json>"
        // tool_call_id 通过前缀携带: "<id>:::<json>"
        ChatMessage {
            role: "tool".into(),
            content: format!("{tool_call_id}:::{result_json}"),
        }
    }
}