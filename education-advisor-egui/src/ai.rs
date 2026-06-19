//! The agent orchestration loop.
//!
//! Implements a lightweight `ReAct` cycle that works with any streaming LLM
//! provider without requiring native function-calling: the system prompt lets
//! the model emit `<tool name="..." args="JSON"/>` tags inline. We parse those
//! out of the stream, execute the tool against the DB, append the result as a
//! tool message, and continue until the model produces a final answer or the
//! iteration budget is exhausted.
//!
//! The whole loop runs on the background runtime. Every micro-state (token,
//! tool start/end, completion, error) is emitted as an event so the UI can
//! reflect it in real time without ever blocking.

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use crossbeam_channel::Sender;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::llm::{ChatMessage, LlmRequest};
use crate::models::{Message, RiskLevel, Role, ToolCallRecord, ToolStatus};
use crate::runtime::{Event, RuntimeCtx};

/// Run one full agent turn for a conversation.
pub async fn run_turn(
    ctx: Arc<RuntimeCtx>,
    evt_tx: Sender<Event>,
    conversation_id: Uuid,
    agent_id: String,
    student_id: Option<Uuid>,
    cancel: CancellationToken,
) -> anyhow::Result<()> {
    // 1. Resolve agent + provider (active provider first, then any enabled).
    let agent =
        crate::agents::find(&agent_id).ok_or_else(|| anyhow::anyhow!("未知代理: {agent_id}"))?;
    let providers = ctx.db.list_providers()?;
    let settings = ctx.settings.read().clone();
    let provider = if let Some(active_id) = settings.active_provider_id {
        providers
            .iter()
            .find(|p| p.id == active_id && p.enabled)
            .cloned()
            .or_else(|| providers.into_iter().find(|p| p.enabled))
    } else {
        providers.into_iter().find(|p| p.enabled)
    }
    .ok_or_else(|| anyhow::anyhow!("未配置可用的 LLM 提供商，请在设置中添加"))?;

    // 3. Build the message history.
    let history = ctx.db.messages_for(conversation_id)?;
    let mut messages = Vec::with_capacity(history.len() + 2);
    let mut system = String::from(agent.system_prompt);
    system.push_str(
        "\n\n你可以使用工具，格式为：<tool name=\"工具名\" args='{\"k\":\"v\"}'/>。可用工具：",
    );
    system.push_str("\n- lookup_student: 查询学生档案，args: {\"name\":\"姓名\"}");
    system.push_str("\n- get_grades: 查询学生成绩，args: {\"id\":\"学生UUID\"}");
    system.push_str("\n- list_risk_students: 列出高风险学生，args: {}");
    system.push_str("\n- count_students: 统计学生总数与风险分布，args: {}");
    system.push_str(
        "\n工具结果会以 <tool_result>...</tool_result> 形式返回。给出最终答复时不要包含工具标签。",
    );
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
                // The original text is persisted in the DB; only the LLM sees the
                // redacted version. Respect the user's privacy toggle.
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

    // 4. Iterate the ReAct loop.
    let max_iter = settings.max_tool_iterations.clamp(1, 12);
    let mut iteration = 0u32;
    let assistant_id = Uuid::new_v4();
    let _ = evt_tx.send(Event::StreamStart {
        conversation_id,
        message_id: assistant_id,
    });

    let mut accumulated = String::new();
    let mut all_tool_records: Vec<ToolCallRecord> = Vec::new();
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

        // Try to extract & execute tool calls.
        let (clean, tool_calls) = parse_tool_calls(&full);
        if tool_calls.is_empty() || iteration >= max_iter {
            accumulated.push_str(&clean);
            break;
        }

        // We had tool calls: execute them and continue.
        accumulated.push_str(&clean);
        let mut iteration_records: Vec<ToolCallRecord> = Vec::new();
        for tc in tool_calls {
            if cancel.is_cancelled() {
                let _ = evt_tx.send(Event::StreamError {
                    conversation_id,
                    error: "生成已取消".into(),
                });
                return Ok(());
            }
            let start = Instant::now();
            let _ = evt_tx.send(Event::StreamTool {
                conversation_id,
                message_id: assistant_id,
                call: ToolCallRecord {
                    name: tc.name.clone(),
                    args: tc.args.clone(),
                    result: String::new(),
                    status: ToolStatus::Running,
                    duration_ms: 0,
                },
            });
            let (result, status) = execute_tool(&ctx, &tc);
            let dur = start.elapsed().as_millis() as u64;
            let record = ToolCallRecord {
                name: tc.name.clone(),
                args: tc.args.clone(),
                result: result.clone(),
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

        // feed tool results back into the conversation
        messages.push(ChatMessage::assistant(&clean));
        for tc in &iteration_records {
            messages.push(ChatMessage::user(format!(
                "<tool_result name=\"{}\">{}</tool_result>",
                tc.name, tc.result
            )));
        }
    }

    // 5. Persist the assistant message with full tool-call history.
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

// ---- Tool parsing & execution ----

struct ParsedTool {
    name: String,
    args: String,
}

fn parse_tool_calls(text: &str) -> (String, Vec<ParsedTool>) {
    let mut tools = Vec::new();
    let mut clean = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("<tool ") {
        clean.push_str(&rest[..start]);
        let after = &rest[start..];
        let Some(end) = after.find("/>") else {
            clean.push_str(after);
            break;
        };
        let tag = &after[..end + 2];
        if let (Some(name), Some(args)) = (extract_attr(tag, "name"), extract_attr(tag, "args")) {
            tools.push(ParsedTool { name, args });
        }
        rest = &after[end + 2..];
    }
    clean.push_str(rest);
    (clean, tools)
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=\"");
    let s = tag.find(&needle)? + needle.len();
    let e = tag[s..].find('"')? + s;
    Some(tag[s..e].to_string())
}

fn execute_tool(ctx: &Arc<RuntimeCtx>, tc: &ParsedTool) -> (String, ToolStatus) {
    match tc.name.as_str() {
        "lookup_student" => {
            let name = parse_str_field(&tc.args, "name");
            match ctx.db.list_students() {
                Ok(list) => {
                    let found: Vec<_> = list
                        .into_iter()
                        .filter(|s| s.name.contains(&name))
                        .collect();
                    if found.is_empty() {
                        (
                            format!("未找到姓名包含「{name}」的学生"),
                            ToolStatus::Success,
                        )
                    } else {
                        let s = &found[0];
                        (
                            format!(
                                "学生：{}（{}{}），风险：{}，GPA：{}",
                                s.name,
                                s.grade,
                                s.class,
                                s.risk_level.label(),
                                s.gpa.map_or_else(|| "未知".into(), |g| format!("{g:.2}"))
                            ),
                            ToolStatus::Success,
                        )
                    }
                }
                Err(e) => (format!("查询失败: {e}"), ToolStatus::Failed),
            }
        }
        "get_grades" => {
            let id = parse_str_field(&tc.args, "id");
            match Uuid::parse_str(&id) {
                Ok(uid) => match ctx.db.grades_for(uid) {
                    Ok(g) => {
                        if g.is_empty() {
                            ("暂无成绩记录".into(), ToolStatus::Success)
                        } else {
                            let lines: Vec<String> = g
                                .iter()
                                .map(|x| format!("{}: {:.1}/{}", x.subject, x.score, x.max_score))
                                .collect();
                            (lines.join("\n"), ToolStatus::Success)
                        }
                    }
                    Err(e) => (format!("查询失败: {e}"), ToolStatus::Failed),
                },
                Err(_) => ("无效的学生ID".into(), ToolStatus::Failed),
            }
        }
        "list_risk_students" => match ctx.db.list_students() {
            Ok(list) => {
                let high: Vec<_> = list
                    .into_iter()
                    .filter(|s| matches!(s.risk_level, RiskLevel::High | RiskLevel::Critical))
                    .collect();
                if high.is_empty() {
                    ("当前无高/危机风险学生".into(), ToolStatus::Success)
                } else {
                    let lines: Vec<String> = high
                        .iter()
                        .map(|s| {
                            format!(
                                "{}（{}{}）- {}",
                                s.name,
                                s.grade,
                                s.class,
                                s.risk_level.label()
                            )
                        })
                        .collect();
                    (lines.join("\n"), ToolStatus::Success)
                }
            }
            Err(e) => (format!("查询失败: {e}"), ToolStatus::Failed),
        },
        "count_students" => match ctx.db.dashboard_stats() {
            Ok(st) => (
                format!(
                    "学生总数：{}，风险分布：低{} 中{} 高{} 危机{}",
                    st.total_students,
                    st.risk_distribution[0],
                    st.risk_distribution[1],
                    st.risk_distribution[2],
                    st.risk_distribution[3]
                ),
                ToolStatus::Success,
            ),
            Err(e) => (format!("统计失败: {e}"), ToolStatus::Failed),
        },
        other => (format!("未知工具: {other}"), ToolStatus::Failed),
    }
}

fn parse_str_field(args: &str, field: &str) -> String {
    // tolerant JSON-ish parse: {"field":"value"}
    let needle = format!("\"{field}\":\"");
    if let Some(s) = args.find(&needle) {
        let start = s + needle.len();
        if let Some(e) = args[start..].find('"') {
            return args[start..start + e].to_string();
        }
    }
    String::new()
}
