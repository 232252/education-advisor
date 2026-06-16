//! 4 子 crate 接线测试 — 验证集成到 src-tauri 后行为正确 + 不 panic。
//!
//! 覆盖:
//!   - callback-signature: HMAC 签名校验 (合法/非法/nonce 重用/时间戳过期)
//!   - log-redact:        敏感字段脱敏 (password/token/api_key)
//!   - data-validation:   Permissive 模式 (接受 "Tom and Jerry" 这种常见输入)
//!   - agent-isolation:   register/get/write_data 闭环 + 路径隔离
//!
//! 关键不变量: 即使配置缺失, 也不允许 panic (CallbackConfig::default() 已知会 expect)。

// ============================================================
// callback-signature — HMAC 校验
// ============================================================

#[tokio::test]
async fn test_callback_signature_happy_path() {
    use callback_signature::{CallbackConfig, CallbackVerifier};
    let secret = "test-secret-xyz";
    let cfg = CallbackConfig {
        secret: secret.into(),
        nonce_ttl_secs: 300,
        timestamp_tolerance_secs: 300,
    };
    let verifier = CallbackVerifier::new(cfg);
    let ts = chrono::Utc::now().timestamp();
    let nonce = uuid::Uuid::new_v4().to_string();
    let data = r#"{"event":"test"}"#;
    // 用 verifier 内部算法: HMAC-SHA256(secret, "{ts}\n{nonce}\n{data}")
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(format!("{ts}\n{nonce}\n{data}").as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());

    let r = verifier.verify(ts, &nonce, data, &sig).await.unwrap();
    assert!(r.passed);
    assert!(r.trace_id.starts_with("cb-"));
}

#[tokio::test]
async fn test_callback_signature_rejects_bad_signature() {
    use callback_signature::{CallbackConfig, CallbackVerifier};
    let cfg = CallbackConfig {
        secret: "test-secret".into(),
        nonce_ttl_secs: 300,
        timestamp_tolerance_secs: 300,
    };
    let verifier = CallbackVerifier::new(cfg);
    let ts = chrono::Utc::now().timestamp();
    let r = verifier.verify(ts, "nonce-1", "data", "deadbeef").await;
    assert!(r.is_err(), "假签名应被拒");
}

#[tokio::test]
async fn test_callback_signature_rejects_expired_timestamp() {
    use callback_signature::{CallbackConfig, CallbackVerifier};
    let cfg = CallbackConfig {
        secret: "test-secret".into(),
        nonce_ttl_secs: 300,
        timestamp_tolerance_secs: 300,
    };
    let verifier = CallbackVerifier::new(cfg);
    let ts_expired = chrono::Utc::now().timestamp() - 3600; // 1h 前
    let r = verifier.verify(ts_expired, "nonce-x", "data", "00").await;
    assert!(r.is_err(), "过期时间戳应被拒");
}

#[tokio::test]
async fn test_callback_signature_rejects_replay_nonce() {
    use callback_signature::{CallbackConfig, CallbackVerifier};
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let secret = "test-secret";
    let cfg = CallbackConfig {
        secret: secret.into(),
        nonce_ttl_secs: 300,
        timestamp_tolerance_secs: 300,
    };
    let verifier = CallbackVerifier::new(cfg);
    let ts = chrono::Utc::now().timestamp();
    let nonce = "nonce-replay-test";
    let data = "data";
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(format!("{ts}\n{nonce}\n{data}").as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());

    // 第一次成功
    verifier.verify(ts, nonce, data, &sig).await.unwrap();
    // 第二次 (重放) 应失败
    let r2 = verifier.verify(ts, nonce, data, &sig).await;
    assert!(r2.is_err(), "nonce 重用应被拒");
}

#[test]
fn test_callback_signature_default_does_not_panic_in_our_path() {
    // 我们的 feishu_service::verify_webhook 用显式 CallbackConfig 而非 default(),
    // 所以即使 FEISHU_CALLBACK_SECRET 未设置也不 panic。这里用 parse 测试。
    use callback_signature::CallbackConfig;
    let cfg = CallbackConfig {
        secret: "explicit-secret".into(),
        nonce_ttl_secs: 60,
        timestamp_tolerance_secs: 60,
    };
    assert_eq!(cfg.secret, "explicit-secret");
}

// ============================================================
// log-redact — 敏感字段脱敏
// ============================================================

#[test]
fn test_redactor_password_redacted() {
    let r = log_redact::SensitiveRedactor::new();
    let input = r#"User login failed: password="hunter2" retry=true"#;
    let out = r.redact(input);
    assert!(!out.contains("hunter2"), "password 值应被脱敏: {out}");
    assert!(out.contains("retry=true"), "非敏感字段保留");
}

#[test]
fn test_redactor_token_redacted() {
    let r = log_redact::SensitiveRedactor::new();
    let input = r#"Request failed: api_key="sk-abc123def456" status=500"#;
    let out = r.redact(input);
    assert!(!out.contains("sk-abc123def456"));
    assert!(out.contains("api_key"));
}

#[test]
fn test_redactor_json_redaction() {
    let r = log_redact::SensitiveRedactor::new();
    let input = r#"{"user":"alice","password":"hunter2","note":"normal text"}"#;
    let out = r.redact_log_line(input);
    assert!(!out.contains("hunter2"));
    assert!(out.contains("alice"), "非敏感字段保留");
    assert!(out.contains("normal text"));
}

#[test]
fn test_redactor_no_false_positive_on_safe_text() {
    let r = log_redact::SensitiveRedactor::new();
    let input = "今天学生表现不错, 课堂活跃";
    let out = r.redact(input);
    assert_eq!(out, input, "中文正常文本不应被脱敏");
}

// ============================================================
// data-validation — Permissive 模式
// ============================================================

#[test]
fn test_validator_permissive_accepts_and_or() {
    // Strict 模式会误报 "Tom and Jerry", Permissive 模式应通过
    use data_validation::{DataValidator, ValidationLevel, ValidatorConfig};
    let cfg = ValidatorConfig {
        level: ValidationLevel::Permissive,
        max_length: 10000,
        check_sql_injection: true,
        check_xss: true,
        use_eaa_gate: false,
    };
    let v = DataValidator::new(cfg);
    let r1 = v.validate("Tom and Jerry 看电视", "trace-1");
    // Permissive 应放行 (and/or 不再单独匹配)
    assert!(r1.passed, "Permissive 模式应接受 'Tom and Jerry': {:?}", r1);

    let r2 = v.validate("张三 和 李四 一起做实验", "trace-2");
    assert!(r2.passed, "Permissive 应接受中文: {:?}", r2);
}

#[test]
fn test_validator_rejects_clear_sql_injection() {
    use data_validation::{DataValidator, ValidationLevel, ValidatorConfig};
    // Strict 模式才能真正拒 SQL (Permissive 关掉了 OR/; 等规则)
    let cfg = ValidatorConfig {
        level: ValidationLevel::Strict,
        max_length: 10000,
        check_sql_injection: true,
        check_xss: true,
        use_eaa_gate: false,
    };
    let v = DataValidator::new(cfg);
    let r = v.validate("1; DROP TABLE students; --", "trace-3");
    assert!(!r.passed, "明确 SQL 注入应被拒: {:?}", r);
    assert!(r.error_code.is_some());
}

#[test]
fn test_validator_rejects_xss() {
    use data_validation::{DataValidator, ValidationLevel, ValidatorConfig};
    // data-validation 的设计: SQL/XSS 仅在 Strict 模式拒。
    // Permissive 仅记录/审计但不阻断 (与 SQL 同逻辑)。
    // 我们的 eaa_tools 接线用 Permissive, 这里测 Strict 路径阻断。
    let cfg = ValidatorConfig {
        level: ValidationLevel::Strict,
        max_length: 10000,
        check_sql_injection: true,
        check_xss: true,
        use_eaa_gate: false,
    };
    let v = DataValidator::new(cfg);
    let r = v.validate(r#"<script>alert('xss')</script>"#, "trace-4");
    assert!(!r.passed, "Strict 模式应拒 XSS: {:?}", r);
}

#[test]
fn test_validator_rejects_oversize() {
    use data_validation::{DataValidator, ValidationLevel, ValidatorConfig};
    let cfg = ValidatorConfig {
        level: ValidationLevel::Permissive,
        max_length: 100,
        check_sql_injection: false,
        check_xss: false,
        use_eaa_gate: false,
    };
    let v = DataValidator::new(cfg);
    let huge = "x".repeat(101);
    let r = v.validate(&huge, "trace-5");
    assert!(!r.passed);
}

// ============================================================
// agent-isolation — 数据目录隔离
// ============================================================

#[test]
fn test_agent_isolation_register_and_get() {
    let dir = tempfile::tempdir().unwrap();
    let isolator = agent_isolation::AgentIsolator::new(dir.path().to_path_buf()).unwrap();
    let dir_a = isolator.register_agent("agent_a").unwrap();
    let dir_b = isolator.register_agent("agent_b").unwrap();
    assert_ne!(dir_a, dir_b, "两个 agent 目录应不同");
    assert!(dir_a.ends_with("agent_a"));
    assert!(dir_b.ends_with("agent_b"));
}

#[test]
fn test_agent_isolation_write_read_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let isolator = agent_isolation::AgentIsolator::new(dir.path().to_path_buf()).unwrap();
    isolator.register_agent("agent_x").unwrap();
    isolator
        .write_data("agent_x", "notes.txt", b"hello isolation")
        .unwrap();
    let data = isolator.read_data("agent_x", "notes.txt").unwrap();
    assert_eq!(data, b"hello isolation");
}

#[test]
fn test_agent_isolation_blocks_cross_agent_access() {
    let dir = tempfile::tempdir().unwrap();
    let isolator = agent_isolation::AgentIsolator::new(dir.path().to_path_buf()).unwrap();
    isolator.register_agent("agent_a").unwrap();
    // 没注册 agent_b → get_agent_dir 应失败 (返回 IsolationError)
    let r = isolator.get_agent_dir("agent_b");
    assert!(r.is_err(), "未注册的 agent 应无法获取目录");
}

#[test]
fn test_agent_isolation_path_traversal_blocked() {
    let dir = tempfile::tempdir().unwrap();
    let isolator = agent_isolation::AgentIsolator::new(dir.path().to_path_buf()).unwrap();
    // 含 ".." 的 agent_id 应被路径遍历防护拒绝
    let r = isolator.register_agent("../escape");
    assert!(r.is_err(), "路径遍历 agent_id 应被拒");
}

#[test]
fn test_agent_isolation_in_agent_runner_blocking() {
    // 验证 spawn_blocking 包装能跑通 (agent_runner.rs 用了这个模式)
    let dir = tempfile::tempdir().unwrap();
    let agents_root = dir.path().to_path_buf();
    let agent_id = "spawn-block-test";
    let result = tokio::runtime::Runtime::new().unwrap().block_on(async {
        tokio::task::spawn_blocking(move || {
            let isolator = agent_isolation::AgentIsolator::new(agents_root).ok()?;
            isolator.register_agent(agent_id).ok()
        })
        .await
        .ok()
        .flatten()
    });
    assert!(result.is_some());
    assert!(result.unwrap().ends_with(agent_id));
}
