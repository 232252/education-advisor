//! Append-only audit log for security-sensitive operations.
//!
//! Every line is a JSON object, one per line (JSON-Lines), written to
//! `<data-dir>/education-advisor/audit.log`. The log is intentionally
//! machine-readable rather than human-readable so it can be ingested by
//! log-shipping tools (Loki, Vector, syslog, …).
//!
//! What gets logged:
//!   - Student record create / update / delete
//!   - LLM provider add / delete (and API key rotations)
//!   - Backup export and restore
//!   - All tool calls made by an agent (tool name + duration + status)

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Categories of audited events. Kept short so log lines stay compact.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditKind {
    StudentCreate,
    StudentUpdate,
    StudentDelete,
    ProviderCreate,
    ProviderUpdate,
    ProviderDelete,
    BackupExport,
    BackupRestore,
    ToolCall,
    SettingsChange,
    /// A user tried to perform an action they were not authorized for.
    AuthDenied,
}

impl AuditKind {
    #[allow(dead_code)]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StudentCreate => "student.create",
            Self::StudentUpdate => "student.update",
            Self::StudentDelete => "student.delete",
            Self::ProviderCreate => "provider.create",
            Self::ProviderUpdate => "provider.update",
            Self::ProviderDelete => "provider.delete",
            Self::BackupExport => "backup.export",
            Self::BackupRestore => "backup.restore",
            Self::ToolCall => "tool.call",
            Self::SettingsChange => "settings.change",
            Self::AuthDenied => "auth.denied",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub ts: DateTime<Utc>,
    pub kind: AuditKind,
    /// One-line free-form description (e.g. "张三 (id=...)").
    pub summary: String,
    /// Optional structured detail (e.g. tool name, status).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<serde_json::Value>,
    /// UUID of the actor — typically the conversation id for tool calls,
    /// or `Uuid::nil()` for system-level events.
    #[serde(default)]
    pub actor: Uuid,
    /// Free-form client version string, e.g. "0.2.0".
    #[serde(default = "default_version")]
    pub version: String,
}

fn default_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Thread-safe writer that appends one JSON line per event. Errors are
/// silently dropped (with a stderr log) so a write failure can never crash
/// the UI; the worst that happens is one event goes missing.
pub struct AuditLog {
    inner: Mutex<Option<File>>,
    path: PathBuf,
}

impl AuditLog {
    /// Open (or create) the audit log at `<data_dir>/audit.log`.
    pub fn open(data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(data_dir)
            .with_context(|| format!("create audit dir {}", data_dir.display()))?;
        let path = data_dir.join("audit.log");
        let f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("open {}", path.display()))?;
        Ok(Self {
            inner: Mutex::new(Some(f)),
            path,
        })
    }

    /// Append one entry. Errors are written to stderr but not propagated.
    pub fn append(&self, entry: &AuditEntry) {
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if let Some(f) = guard.as_mut() {
            match serde_json::to_string(entry) {
                Ok(line) => {
                    let _ = writeln!(f, "{line}");
                    let _ = f.flush();
                }
                Err(e) => eprintln!("[audit] serialize: {e}"),
            }
        }
    }

    /// Convenience: build + append an entry in one call.
    pub fn log(&self, kind: AuditKind, summary: impl Into<String>) {
        self.append(&AuditEntry {
            ts: Utc::now(),
            kind,
            summary: summary.into(),
            detail: None,
            actor: Uuid::nil(),
            version: default_version(),
        });
    }

    pub fn log_with(&self, kind: AuditKind, summary: impl Into<String>, detail: serde_json::Value) {
        self.append(&AuditEntry {
            ts: Utc::now(),
            kind,
            summary: summary.into(),
            detail: Some(detail),
            actor: Uuid::nil(),
            version: default_version(),
        });
    }

    /// Path to the underlying file (used by the UI to show a "reveal in
    /// folder" button).
    #[allow(dead_code)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Snapshot the last N entries by tail-reading the file. Best-effort:
    /// corrupt lines are skipped.
    #[allow(dead_code)]
    pub fn tail(&self, n: usize) -> Vec<AuditEntry> {
        let Ok(content) = std::fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        content
            .lines()
            .rev()
            .filter_map(|l| serde_json::from_str(l).ok())
            .take(n)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_dir() -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ea-audit-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn append_and_tail_round_trip() {
        let dir = fresh_dir();
        let log = AuditLog::open(&dir).unwrap();
        log.log(AuditKind::StudentCreate, "张三 (id=...)");
        log.log_with(
            AuditKind::ToolCall,
            "lookup_student",
            serde_json::json!({ "duration_ms": 12, "status": "ok" }),
        );
        let entries = log.tail(10);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].kind, AuditKind::ToolCall);
        assert_eq!(entries[1].kind, AuditKind::StudentCreate);
        assert!(entries[0].detail.is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn corrupt_lines_are_skipped() {
        let dir = fresh_dir();
        let log = AuditLog::open(&dir).unwrap();
        // write one corrupt line + one good line
        std::fs::write(log.path(), "this is not json\n").unwrap();
        log.log(AuditKind::ProviderCreate, "openai");
        let entries = log.tail(10);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, AuditKind::ProviderCreate);
        let _ = std::fs::remove_dir_all(dir);
    }
}
