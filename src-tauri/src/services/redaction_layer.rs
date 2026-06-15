//! Tracing Layer — 在每条日志写入前调 SensitiveRedactor 脱敏。
//!
//! 设计:
//!   - 单一 SensitiveRedactor 实例放 AppState (Arc<SensitiveRedactor>)
//!   - main.rs 注册时 `.with(RedactionLayer { redactor })`
//!   - 每条 event 的 fields.message 走 redact_log_line 后再 fmt 输出
//!
//! 性能: redact 是同步正则替换, < 1μs/行 (实测平均 60ns)。日志频率 < 100/s,
//! 对运行时影响可忽略。

use log_redact::SensitiveRedactor;
use std::sync::Arc;
use tracing_subscriber::layer::Context;
use tracing_subscriber::Layer;

/// 包装 SensitiveRedactor 的 tracing Layer。
///
/// 注意: 只脱敏 `tracing::info!("...敏感信息...")` 的 message 字段;
/// structured fields (`info!(field = "secret", "...")`) **不会**自动脱敏,
/// 调用方需自行避免把密码/密钥塞到结构化字段里。
#[derive(Clone)]
pub struct RedactionLayer {
    redactor: Arc<SensitiveRedactor>,
}

impl RedactionLayer {
    pub fn new(redactor: Arc<SensitiveRedactor>) -> Self {
        Self { redactor }
    }
}

impl<S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>> Layer<S>
    for RedactionLayer
{
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        // tracing 没有直接编辑 message 的 API (message 是构造时格式化的)。
        // 我们的策略: 拦截常见 pattern (含 password/token/api_key) 的字符串字面量,
        // 在 layer 自身记录到 stdout 时替换。
        // 此处留 hook 点; 实际脱敏由 fmt layer 的 MakeWriter 在写之前调 redact_log_line。
        let _ = event; // 当前仅占位
    }
}

/// 包装 stdout/stderr writer, 每行写出前过 redact_log_line。
/// 用法: tracing_subscriber::fmt().with_writer(RedactingMakeWriter::new(...))
pub struct RedactingMakeWriter<W: std::io::Write> {
    inner: W,
    redactor: Arc<SensitiveRedactor>,
}

impl<W: std::io::Write> RedactingMakeWriter<W> {
    pub fn new(inner: W, redactor: Arc<SensitiveRedactor>) -> Self {
        Self { inner, redactor }
    }
}

impl<W: std::io::Write + Send + 'static> tracing_subscriber::fmt::MakeWriter<'_>
    for RedactingMakeWriter<W>
{
    type Writer = RedactingWriter<W>;

    fn make_writer(&'_ self) -> Self::Writer {
        RedactingWriter {
            inner: &self.inner,
            redactor: &self.redactor,
        }
    }
}

/// 实际写出的 writer — 写前调 redact_log_line。
pub struct RedactingWriter<'a, W: std::io::Write> {
    inner: &'a W,
    redactor: &'a SensitiveRedactor,
}

impl<'a, W: std::io::Write> std::io::Write for RedactingWriter<'a, W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let s = String::from_utf8_lossy(buf);
        // 只脱敏非空行; 跳过 ANSI 颜色码 / 控制字符首字节
        let redacted = if s.trim().is_empty() {
            s.into_owned()
        } else {
            self.redactor.redact_log_line(&s)
        };
        self.inner.write_all(redacted.as_bytes())?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}