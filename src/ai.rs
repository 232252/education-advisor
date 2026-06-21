//! The agent orchestration loop.
//!
//! Implements a lightweight `ReAct` cycle that works with any streaming LLM
//! provider without requiring native function-calling: the system prompt lets
//! the model emit `<tool name="..." args="JSON"/>` tags inline. We parse those
//! out of the stream, execute the registered tool against the DB, append the
//! result as a user message, and continue until the model produces a final
//! answer or the iteration budget is exhausted.
//!
//! Tool surface is provided by [`crate::tools::ToolRegistry`], which keeps
//! tool definitions, JSON-Schemas, and executor logic in one place.
//!
//! The whole loop runs on the background runtime. Every micro-state (token,
//! tool start/end, completion, error) is emitted as an event so the UI can
//! reflect it in real time without ever blocking.

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use crossbeam_channel::Sender;
use serde_json::Value;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::llm::{ChatMessage, LlmRequest};
use crate::models::{Message, Role, ToolCallRecord, ToolStatus};
use crate::runtime::{Event, RuntimeCtx};
use crate::tools::{ToolRegistry, ToolResult};

/// Hard ceiling for a single tool execution. If a tool hangs longer than this
/// (e.g. due to a buggy DB query or a misbehaving LLM-generated call), the
/// runtime cancels it and reports a timeout to the UI.
const TOOL_TIMEOUT: Duration = Duration::from_secs(15);

/// Maximum size of a single tool-args payload (raw text from the model). Anything
/// larger is almost certainly a prompt-injection attempt or a runaway LLM.
const MAX_TOOL_ARGS_BYTES: usize = 16 * 1024;

/// Maximum total tool payload streamed into the next turn (defence against
/// context-window blow-ups via accumulator abuse).
const MAX_TOTAL_TOOL_RESULT_BYTES: usize = 256 * 1024;

/// Run one full agent turn for a conversation.
pub async fn run_turn(
    ctx: Arc<RuntimeCtx>,
    evt_tx: Sender<Event>,
    conversation_id: Uuid,
    agent_id: String,
    student_id: Option<Uuid>,
    cancel: CancellationToken,
) -> anyhow::Result<()> {
    // ---- 1. Resolve agent + provider (active first, then any enabled). ----
    let agent =
        crate::agents::find(&agent_id).ok_or_else(|| anyhow::anyhow!("未知代理: {agent_id}"))?;
    let providers = ctx.db.list_providers()?;
    let settings = ctx.settings.read().clone();
    let provider = if let Some(active_id) = settings.active_provider_id.clone() {
        providers
            .iter()
            .find(|p| p.id == active_id && p.enabled)
            .cloned()
            .or_else(|| providers.into_iter().find(|p| p.enabled))
    } else {
        providers.into_iter().find(|p| p.enabled)
    }
    .ok_or_else(|| anyhow::anyhow!("未配置可用的 LLM 提供商，请在设置中添加"))?;

    // ---- 2. Build the message history. ----
    let history = ctx.db.messages_for(conversation_id)?;
    let mut messages = Vec::with_capacity(history.len() + 4);

    // System prompt: identity + tool surface.
    let registry = ToolRegistry::with_defaults();
    let mut system = String::from(agent.system_prompt);
    system
        .push_str("\n\n你可以调用以下工具，格式为：<tool name=\"工具名\" args='{...JSON...}'/>。");
    system.push_str("\n可用工具（name + 一句话用途 + JSON 形参）：");
    for t in registry.list() {
        system.push_str(&format!(
            "\n- {}: {} | args: {}",
            t.name, t.purpose, t.args_schema_hint
        ));
    }
    system.push_str("\n工具结果会以 <tool_result name=\"工具名\">...</tool_result> 形式回传。");
    system.push_str("\n给出最终答复时不要包含 <tool> 标签；如需调用工具则只输出标签，等待结果。");
    messages.push(ChatMessage::system(system));

    // attach student context if provided
    if let Some(sid) = student_id {
        if let Ok(students) = ctx.db.list_students() {
            if let Some(s) = students.into_iter().find(|s| s.id == sid) {
                let ctx_line = format!(
                    "当前关注学生：{}，{}{}，风险等级：{}，GPA：{}",
                    s.name,
                    s.grade,
                    s.class,
                    s.risk_level.label(),
                    s.gpa.map_or_else(|| "未知".into(), |g| format!("{g:.2}"))
                );
                messages.push(ChatMessage::system(ctx_line));
            }
        }
    }

    for m in &history {
        match m.role {
            Role::User => {
                // PII redaction: mask phone/ID/email before sending to the LLM.
                // The original text is persisted in the DB; only the LLM sees
                // the redacted version. Respect the user's privacy toggle.
                let content = if settings.privacy_enabled {
                    ctx.redactor.redact(&m.content).0
                } else {
                    m.content.clone()
                };
                messages.push(ChatMessage::user(&content));
            }
            Role::Assistant => messages.push(ChatMessage::assistant(&m.content)),
            Role::System => {}
            Role::Tool => messages.push(ChatMessage::user(&m.content)),
        }
    }

    // ---- 3. Iterate the ReAct loop. ----
    let max_iter = settings.max_tool_iterations.clamp(1, 12);
    let mut iteration = 0u32;
    let assistant_id = Uuid::new_v4();
    let _ = evt_tx.send(Event::StreamStart {
        conversation_id,
        message_id: assistant_id,
    });

    let mut accumulated = String::new();
    let mut all_tool_records: Vec<ToolCallRecord> = Vec::new();
    let mut total_tool_bytes = 0usize;

    loop {
        if cancel.is_cancelled() {
            let _ = evt_tx.send(Event::StreamError {
                conversation_id,
                error: "生成已取消".into(),
            });
            return Ok(());
        }
        iteration += 1;
        let req = LlmRequest {
            provider: provider.clone(),
            messages: messages.clone(),
            temperature: settings.temperature,
            max_tokens: 2048,
        };

        let tx = evt_tx.clone();
        let msg_id = assistant_id;
        let mut cancelled = false;
        let mut on_token = |delta: &str| {
            if cancel.is_cancelled() {
                cancelled = true;
                return;
            }
            let _ = tx.send(Event::StreamToken {
                conversation_id,
                message_id: msg_id,
                delta: delta.to_string(),
            });
        };
        let full = ctx.llm.stream(&req, &ctx.cipher, &mut on_token).await?;

        if cancelled || cancel.is_cancelled() {
            let _ = evt_tx.send(Event::StreamError {
                conversation_id,
                error: "生成已取消".into(),
            });
            return Ok(());
        }

        // ---- 4. Parse & execute tool calls (if any). ----
        let (clean, parsed_calls) = parse_tool_calls(&full);
        if parsed_calls.is_empty() || iteration >= max_iter {
            accumulated.push_str(&clean);
            break;
        }

        accumulated.push_str(&clean);
        let mut iteration_records: Vec<ToolCallRecord> = Vec::new();

        for tc in parsed_calls {
            if cancel.is_cancelled() {
                let _ = evt_tx.send(Event::StreamError {
                    conversation_id,
                    error: "生成已取消".into(),
                });
                return Ok(());
            }

            // Validate call before executing: registry membership + args size.
            if registry.get(&tc.name).is_none() {
                let record = ToolCallRecord {
                    message_id: assistant_id,
                    name: tc.name.clone(),
                    args: tc.args.clone(),
                    result: format!("未知工具: {}", tc.name),
                    status: ToolStatus::Failed,
                    duration_ms: 0,
                };
                iteration_records.push(record.clone());
                all_tool_records.push(record.clone());
                let _ = evt_tx.send(Event::StreamTool {
                    conversation_id,
                    message_id: assistant_id,
                    call: record,
                });
                continue;
            }
            if tc.args.len() > MAX_TOOL_ARGS_BYTES {
                let record = ToolCallRecord {
                    message_id: assistant_id,
                    name: tc.name.clone(),
                    args: tc.args.chars().take(200).collect::<String>() + "…",
                    result: format!("args 超过 {MAX_TOOL_ARGS_BYTES} 字节上限，已拒绝执行"),
                    status: ToolStatus::Failed,
                    duration_ms: 0,
                };
                iteration_records.push(record.clone());
                all_tool_records.push(record.clone());
                let _ = evt_tx.send(Event::StreamTool {
                    conversation_id,
                    message_id: assistant_id,
                    call: record,
                });
                continue;
            }

            // Phase 1: emit "Running" so the UI shows progress.
            let start = Instant::now();
            let _ = evt_tx.send(Event::StreamTool {
                conversation_id,
                message_id: assistant_id,
                call: ToolCallRecord {
                    message_id: assistant_id,
                    name: tc.name.clone(),
                    args: tc.args.clone(),
                    result: String::new(),
                    status: ToolStatus::Running,
                    duration_ms: 0,
                },
            });

            // Phase 2: run with a hard timeout. Cancellation cooperates.
            let args_value: Value =
                serde_json::from_str(&tc.args).unwrap_or_else(|_| Value::String(tc.args.clone()));
            let ToolResult { output, status } = match timeout(
                TOOL_TIMEOUT,
                registry.execute(&ctx, &tc.name, &args_value, cancel.clone()),
            )
            .await
            {
                Ok(res) => res,
                Err(_) => ToolResult {
                    output: format!(
                        "工具 {} 执行超过 {:?} 未返回，已超时取消",
                        tc.name, TOOL_TIMEOUT
                    ),
                    status: ToolStatus::Failed,
                },
            };

            // Truncate oversized results so the next turn's context window
            // doesn't blow up. The full result is still persisted.
            let mut output = output;
            if output.len() + total_tool_bytes > MAX_TOTAL_TOOL_RESULT_BYTES {
                output = crate::util::truncate(&output, 2048);
            }
            total_tool_bytes += output.len();

            let dur = start.elapsed().as_millis() as u64;
            let record = ToolCallRecord {
                message_id: assistant_id,
                name: tc.name.clone(),
                args: tc.args.clone(),
                result: output.clone(),
                status,
                duration_ms: dur,
            };
            iteration_records.push(record.clone());
            all_tool_records.push(record.clone());
            let _ = evt_tx.send(Event::StreamTool {
                conversation_id,
                message_id: assistant_id,
                call: record,
            });
            // brief pause to keep the UI responsive and show tool progress
            tokio::time::sleep(Duration::from_millis(20)).await;
        }

        // Feed tool results back into the conversation as user messages
        // (multi-modal LLMs expect tool-role, but most non-OpenAI providers
        // accept user role with the same content).
        messages.push(ChatMessage::assistant(&clean));
        for tc in &iteration_records {
            let block = format!(
                "<tool_result name=\"{}\">{}</tool_result>",
                tc.name, tc.result
            );
            messages.push(ChatMessage::user(block));
        }
    }

    // ---- 5. Persist the assistant message with full tool-call history. ----
    let now = Utc::now();
    let assistant_msg = Message {
        id: assistant_id,
        conversation_id,
        role: Role::Assistant,
        content: accumulated.trim().to_string(),
        tool_calls: all_tool_records,
        created_at: now,
    };
    ctx.db.insert_message(&assistant_msg)?;
    let _ = ctx.db.touch_conversation(conversation_id);
    let _ = evt_tx.send(Event::StreamDone {
        conversation_id,
        message_id: assistant_id,
    });
    Ok(())
}

// ============================================================================
// Tool-call parsing
// ============================================================================

/// A parsed `<tool name="…" args="…"/>` invocation.
#[derive(Debug, Clone)]
pub struct ParsedTool {
    pub name: String,
    pub args: String,
}

/// Extract zero or more tool calls from the streamed text. Returns
/// (`clean_text_without_tool_tags`, `parsed_calls`).
///
/// Grammar (intentionally permissive — different LLMs format slightly
/// differently):
///
///   <tool name="IDENT" args='{...}'/>     <- single-quoted JSON (preferred)
///   <tool name="IDENT" args="{...}"/>     <- double-quoted JSON
///   <tool name="IDENT" args="..." />      <- legacy string-only args
///
/// The matching is greedy on the first `/>` after `<tool `, which matches the
/// vast majority of LLM output. If a stray `<tool ` is left unterminated, the
/// rest of the stream is preserved verbatim in `clean_text` so the user at
/// least sees what the model said.
pub fn parse_tool_calls(text: &str) -> (String, Vec<ParsedTool>) {
    let mut tools = Vec::new();
    let mut clean = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("<tool ") {
        clean.push_str(&rest[..start]);
        let after = &rest[start..];
        // Find the end of the tag: /> takes priority, otherwise ">" ends it.
        let end_rel = after.find("/>").or_else(|| after.find('>'));
        let Some(end_rel) = end_rel else {
            clean.push_str(after);
            break;
        };
        let tag = &after[..end_rel];
        if let (Some(name), Some(args)) = (extract_attr(tag, "name"), extract_attr(tag, "args")) {
            if !name.is_empty() {
                tools.push(ParsedTool { name, args });
            }
        }
        // Skip past the tag terminator. If we matched ">", the tag itself is
        // a stray open-tag with no body; if we matched "/>", advance past it.
        let skip = if after[end_rel..].starts_with("/>") {
            2
        } else {
            1
        };
        rest = &after[end_rel + skip..];
    }
    clean.push_str(rest);
    (clean, tools)
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    // Match either single or double quotes: attr='…' or attr="…".
    for quote in ['\'', '"'] {
        let needle = format!("{attr}={quote}");
        if let Some(s_rel) = tag.find(&needle) {
            let s = s_rel + needle.len();
            if let Some(e_rel) = tag[s..].find(quote) {
                return Some(tag[s..s + e_rel].to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_quoted_args() {
        let (clean, calls) = parse_tool_calls(
            r#"I'll look that up. <tool name="lookup_student" args='{"name":"张三"}'/> Done."#,
        );
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "lookup_student");
        assert_eq!(calls[0].args, r#"{"name":"张三"}"#);
        assert_eq!(clean, "I'll look that up.  Done.");
    }

    #[test]
    fn parses_double_quoted_args() {
        let (_, calls) = parse_tool_calls(r#"<tool name="count_students" args="{}"/>"#);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "count_students");
    }

    #[test]
    fn handles_no_tool_calls() {
        let (clean, calls) = parse_tool_calls("plain text");
        assert_eq!(clean, "plain text");
        assert!(calls.is_empty());
    }

    #[test]
    fn handles_unterminated_tag() {
        let (clean, calls) = parse_tool_calls("before <tool name=\"x\" args=\"{\" after");
        assert!(calls.is_empty());
        assert!(clean.contains("before"));
        assert!(clean.contains("after"));
    }

    #[test]
    fn handles_multiple_tool_calls() {
        let (_, calls) =
            parse_tool_calls(r#"<tool name="a" args="{}"/><tool name="b" args="{}"/>"#);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "a");
        assert_eq!(calls[1].name, "b");
    }
}
