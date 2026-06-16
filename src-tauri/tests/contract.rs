//! 契约测试 — 验证 Rust 类型序列化后的 JSON 字段名与前端 TS 接口完全匹配。
//!
//! 这些测试构造 Rust 值, 序列化成 JSON, 断言字段名 (camelCase) 与
//! src/shared/types.ts 的 interface 一致。一旦 Rust 端改了 serde 配置,
//! 这些测试会立刻失败, 防止 TS↔Rust 契约悄悄断裂。

use ea_tauri::services::llm_service::{StreamEvent, TokenUsage};
use serde_json::json;

/// StreamEvent 序列化后的 type tag 必须与 chatStore.handleStreamEvent 的 switch 一致。
#[test]
fn test_stream_event_tags_match_frontend() {
    // TextDelta → { "type": "text_delta", "delta": "..." }
    let v = serde_json::to_value(StreamEvent::TextDelta { delta: "hi".into() }).unwrap();
    assert_eq!(v["type"], json!("text_delta"));
    assert_eq!(v["delta"], json!("hi"));

    // ThinkingDelta
    let v = serde_json::to_value(StreamEvent::ThinkingDelta {
        delta: "思考".into(),
    })
    .unwrap();
    assert_eq!(v["type"], json!("thinking_delta"));
    assert_eq!(v["delta"], json!("思考"));

    // Start
    let v = serde_json::to_value(StreamEvent::Start {
        model: "gpt-4o".into(),
        provider: "openai".into(),
    })
    .unwrap();
    assert_eq!(v["type"], json!("start"));
    assert_eq!(v["model"], json!("gpt-4o"));
    assert_eq!(v["provider"], json!("openai"));

    // TextStart / TextEnd
    assert_eq!(
        serde_json::to_value(StreamEvent::TextStart).unwrap()["type"],
        json!("text_start")
    );
    assert_eq!(
        serde_json::to_value(StreamEvent::TextEnd).unwrap()["type"],
        json!("text_end")
    );

    // ThinkingStart / ThinkingEnd
    assert_eq!(
        serde_json::to_value(StreamEvent::ThinkingStart).unwrap()["type"],
        json!("thinking_start")
    );
    assert_eq!(
        serde_json::to_value(StreamEvent::ThinkingEnd).unwrap()["type"],
        json!("thinking_end")
    );

    // ToolcallStart { id, name }
    let v = serde_json::to_value(StreamEvent::ToolcallStart {
        id: "tc_1".into(),
        name: "eaa_score".into(),
    })
    .unwrap();
    assert_eq!(v["type"], json!("toolcall_start"));
    assert_eq!(v["id"], json!("tc_1"));
    assert_eq!(v["name"], json!("eaa_score"));

    // ToolcallDelta { id, argsDelta } — 注意 camelCase
    let v = serde_json::to_value(StreamEvent::ToolcallDelta {
        id: "tc_1".into(),
        args_delta: "{\"name\":".into(),
    })
    .unwrap();
    assert_eq!(v["type"], json!("toolcall_delta"));
    assert_eq!(v["argsDelta"], json!("{\"name\":"));

    // ToolcallEnd { id }
    let v = serde_json::to_value(StreamEvent::ToolcallEnd { id: "tc_1".into() }).unwrap();
    assert_eq!(v["type"], json!("toolcall_end"));

    // ToolResult { id, result, isError } — 注意 camelCase
    let v = serde_json::to_value(StreamEvent::ToolResult {
        id: "tc_1".into(),
        result: "ok".into(),
        is_error: false,
    })
    .unwrap();
    assert_eq!(v["type"], json!("tool_result"));
    assert_eq!(v["isError"], json!(false));

    // Done { usage, cost }
    let v = serde_json::to_value(StreamEvent::Done {
        usage: TokenUsage {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
        },
        cost: 0.5,
    })
    .unwrap();
    assert_eq!(v["type"], json!("done"));
    assert_eq!(v["usage"]["inputTokens"], json!(10));
    assert_eq!(v["usage"]["outputTokens"], json!(20));
    assert_eq!(v["cost"], json!(0.5));

    // Error { message, retryable }
    let v = serde_json::to_value(StreamEvent::Error {
        message: "超时".into(),
        retryable: true,
    })
    .unwrap();
    assert_eq!(v["type"], json!("error"));
    assert_eq!(v["message"], json!("超时"));
    assert_eq!(v["retryable"], json!(true));
}

/// TokenUsage 字段名 camelCase。
#[test]
fn test_token_usage_camel_case() {
    let v = serde_json::to_value(TokenUsage {
        input_tokens: 100,
        output_tokens: 200,
        cache_read_tokens: 50,
        cache_write_tokens: 30,
    })
    .unwrap();
    assert_eq!(v["inputTokens"], json!(100));
    assert_eq!(v["outputTokens"], json!(200));
    assert_eq!(v["cacheReadTokens"], json!(50));
    assert_eq!(v["cacheWriteTokens"], json!(30));
}
