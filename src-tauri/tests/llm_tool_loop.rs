//! LLM tool_call 解析单测 — 验证 OpenAI/Anthropic/Gemini 多 chunk 拼接。
//!
//! 不依赖网络, 直接喂 SSE chunk JSON 给 parse 函数, 收集 emit 事件序列。

use ea_tauri::services::llm_service::{
    parse_anthropic_chunk, parse_openai_chunk, AnthropicChunkState, OpenAIChunkState,
    StreamEvent,
};
use std::sync::{Arc, Mutex};

/// 把多个事件收集到一个 Vec 里, 便于断言。
fn collector() -> (Arc<Mutex<Vec<StreamEvent>>>, impl Fn(StreamEvent) + Clone) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let events2 = events.clone();
    let cb = move |ev: StreamEvent| events2.lock().unwrap().push(ev);
    (events, cb)
}

fn events_of(v: Arc<Mutex<Vec<StreamEvent>>>) -> Vec<StreamEvent> {
    let g = v.lock().unwrap();
    g.clone()
}

// ============================================================
// OpenAI 工具调用多 chunk 拼接
// ============================================================

#[test]
fn test_openai_tool_call_split_into_3_chunks() {
    let (events, cb) = collector();
    let mut state = OpenAIChunkState::new();

    // Chunk 1: ToolcallStart (id + name)
    let chunk1: serde_json::Value = serde_json::from_str(r#"{
        "choices": [{
            "delta": {
                "tool_calls": [{
                    "index": 0,
                    "id": "call_abc123",
                    "function": {"name": "add_event", "arguments": ""}
                }]
            }
        }]
    }"#).unwrap();
    parse_openai_chunk(&chunk1, &cb, &mut state);

    // Chunk 2: arguments 部分 1
    let chunk2: serde_json::Value = serde_json::from_str(r#"{
        "choices": [{
            "delta": {
                "tool_calls": [{
                    "index": 0,
                    "function": {"arguments": "{\"name\":"}
                }]
            }
        }]
    }"#).unwrap();
    parse_openai_chunk(&chunk2, &cb, &mut state);

    // Chunk 3: arguments 部分 2 + finish_reason
    let chunk3: serde_json::Value = serde_json::from_str(r#"{
        "choices": [{
            "delta": {
                "tool_calls": [{
                    "index": 0,
                    "function": {"arguments": "\"Alice\",\"reasonCode\":\"HOMEWORK\"}"}
                }]
            },
            "finish_reason": "tool_calls"
        }]
    }"#).unwrap();
    parse_openai_chunk(&chunk3, &cb, &mut state);

    let evs = events_of(events);
    // 应有: ToolcallStart, ToolcallDelta(2次), ToolcallEnd, Done
    assert!(matches!(evs[0], StreamEvent::ToolcallStart { ref id, ref name } if id == "call_abc123" && name == "add_event"),
        "第一个事件应为 ToolcallStart, 实际: {:?}", evs[0]);

    let has_end = evs.iter().any(|e| matches!(e, StreamEvent::ToolcallEnd { id } if id == "call_abc123"));
    assert!(has_end, "finish_reason=tool_calls 应触发 ToolcallEnd");

    // 累计 args 应包含完整 JSON
    let deltas: Vec<String> = evs.iter().filter_map(|e| match e {
        StreamEvent::ToolcallDelta { args_delta, .. } => Some(args_delta.clone()),
        _ => None,
    }).collect();
    assert!(!deltas.is_empty(), "至少应有 1 个 ToolcallDelta");
    // 最终一次 delta 应含完整 args (因为我们发的是累计 buf)
    let last = deltas.last().unwrap();
    assert!(last.contains("Alice"), "args_delta 应含完整 args, got: {last}");
    assert!(last.contains("HOMEWORK"));
}

#[test]
fn test_openai_text_delta_passthrough() {
    let (events, cb) = collector();
    let mut state = OpenAIChunkState::new();
    let chunk: serde_json::Value = serde_json::from_str(r#"{
        "choices": [{"delta": {"content": "Hello world"}}]
    }"#).unwrap();
    parse_openai_chunk(&chunk, &cb, &mut state);
    let evs = events_of(events);
    assert_eq!(evs.len(), 1);
    match &evs[0] {
        StreamEvent::TextDelta { delta } => assert_eq!(delta, "Hello world"),
        _ => panic!("expected TextDelta"),
    }
}

#[test]
fn test_openai_done_event_with_usage() {
    let (events, cb) = collector();
    let mut state = OpenAIChunkState::new();
    let chunk: serde_json::Value = serde_json::from_str(r#"{
        "choices": [{}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20}
    }"#).unwrap();
    parse_openai_chunk(&chunk, &cb, &mut state);
    let evs = events_of(events);
    assert!(evs.iter().any(|e| matches!(e, StreamEvent::Done { usage, cost }
        if usage.input_tokens == 10 && usage.output_tokens == 20 && *cost == 0.0)));
}

#[test]
fn test_openai_finish_reason_triggers_toolcall_end() {
    let (events, cb) = collector();
    let mut state = OpenAIChunkState::new();

    // 先 start
    let chunk1: serde_json::Value = serde_json::from_str(r#"{
        "choices": [{
            "delta": {"tool_calls": [{"index": 0, "id": "x", "function": {"name": "f", "arguments": ""}}]}
        }]
    }"#).unwrap();
    parse_openai_chunk(&chunk1, &cb, &mut state);

    // finish_reason → 应触发 End
    let chunk2: serde_json::Value = serde_json::from_str(r#"{
        "choices": [{"delta": {}, "finish_reason": "tool_calls"}]
    }"#).unwrap();
    parse_openai_chunk(&chunk2, &cb, &mut state);

    let evs = events_of(events);
    let has_end = evs.iter().any(|e| matches!(e, StreamEvent::ToolcallEnd { id } if id == "x"));
    assert!(has_end, "finish_reason=tool_calls 必须触发 ToolcallEnd");
}

// ============================================================
// Anthropic tool_use 解析
// ============================================================

#[test]
fn test_anthropic_tool_use_full_cycle() {
    let (events, cb) = collector();
    let mut state = AnthropicChunkState::new();

    // content_block_start (tool_use)
    let c1: serde_json::Value = serde_json::from_str(r#"{
        "type": "content_block_start",
        "index": 0,
        "content_block": {"type": "tool_use", "id": "toolu_abc", "name": "get_score"}
    }"#).unwrap();
    parse_anthropic_chunk(&c1, &cb, &mut state);

    // content_block_delta (input_json_delta)
    let c2: serde_json::Value = serde_json::from_str(r#"{
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "input_json_delta", "partial_json": "{\"name\":"}
    }"#).unwrap();
    parse_anthropic_chunk(&c2, &cb, &mut state);

    let c3: serde_json::Value = serde_json::from_str(r#"{
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "input_json_delta", "partial_json": "\"Alice\"}"}
    }"#).unwrap();
    parse_anthropic_chunk(&c3, &cb, &mut state);

    // content_block_stop → ToolcallEnd
    let c4: serde_json::Value = serde_json::from_str(r#"{
        "type": "content_block_stop",
        "index": 0
    }"#).unwrap();
    parse_anthropic_chunk(&c4, &cb, &mut state);

    let evs = events_of(events);
    let start = evs.iter().find(|e| matches!(e, StreamEvent::ToolcallStart { id, .. } if id == "toolu_abc"));
    assert!(start.is_some(), "ToolcallStart 必须");
    let end = evs.iter().find(|e| matches!(e, StreamEvent::ToolcallEnd { id } if id == "toolu_abc"));
    assert!(end.is_some(), "ToolcallEnd 必须");

    // args 应累计完整
    let deltas: Vec<String> = evs.iter().filter_map(|e| match e {
        StreamEvent::ToolcallDelta { args_delta, .. } => Some(args_delta.clone()),
        _ => None,
    }).collect();
    let last = deltas.last().unwrap();
    assert!(last.contains("Alice"), "args_delta 应含完整 args: {last}");
}

#[test]
fn test_anthropic_text_delta_passthrough() {
    let (events, cb) = collector();
    let mut state = AnthropicChunkState::new();
    let chunk: serde_json::Value = serde_json::from_str(r#"{
        "type": "content_block_delta",
        "delta": {"type": "text_delta", "text": "Hi"}
    }"#).unwrap();
    parse_anthropic_chunk(&chunk, &cb, &mut state);
    let evs = events_of(events);
    assert!(evs.iter().any(|e| matches!(e, StreamEvent::TextDelta { delta } if delta == "Hi")));
}