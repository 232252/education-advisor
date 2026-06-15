//! 隐私审计 + 合规报告 — Rust 重写自 `src/main/services/privacy-audit.ts` +
//! `compliance-report.ts` (共 ~432 行)。
//!
//! 每次隐私引擎操作 (anonymize/deanonymize/filter/dryrun/init/disable) 都追加一条
//! 审计行到 `{eaa_data}/privacy/audit.log`, 格式为 JSON-Lines。合规报告基于该日志
//! 按季度聚合, 含 SHA-256 manifest (audit log + report 自身)。

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub ts: i64,
    pub op: String,            // anonymize|deanonymize|filter|dryrun|init|disable
    pub input_len: usize,
    pub output_len: usize,
    pub has_pii: bool,
    pub pii_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receiver: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    pub duration_ms: u64,
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct PrivacyAuditService {
    path: PathBuf,
}

impl PrivacyAuditService {
    pub fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // 触摸文件确保存在
        if !path.exists() {
            std::fs::File::create(&path)?;
        }
        Ok(Self { path })
    }

    pub fn append(&self, entry: &AuditEntry) -> Result<()> {
        let mut f = std::fs::OpenOptions::new().append(true).open(&self.path)?;
        let line = serde_json::to_string(entry)?;
        writeln!(f, "{line}")?;
        // sync_all 是 std::fs::File 固有方法, 不需要 fs2::FileExt trait。
        f.sync_all()?;
        Ok(())
    }

    /// 读取审计行 (倒序, limit 条)。
    pub fn read(&self, limit: usize) -> Result<Vec<AuditEntry>> {
        let raw = std::fs::read_to_string(&self.path).unwrap_or_default();
        let mut entries: Vec<AuditEntry> = raw
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        entries.reverse(); // 倒序 (最新在前)
        entries.truncate(limit);
        Ok(entries)
    }

    pub fn line_count(&self) -> Result<usize> {
        let raw = std::fs::read_to_string(&self.path).unwrap_or_default();
        Ok(raw.lines().filter(|l| !l.trim().is_empty()).count())
    }

    /// 文件的 SHA-256 (用于合规报告 manifest)。
    pub fn sha256(&self) -> Result<String> {
        let raw = std::fs::read(&self.path)?;
        let mut h = Sha256::new();
        h.update(&raw);
        Ok(hex(&h.finalize()))
    }

    /// 生成季度合规报告。
    pub fn generate_report(
        &self,
        start_ms: i64,
        end_ms: i64,
        label: &str,
    ) -> Result<ComplianceReport> {
        let entries = self.read(usize::MAX)?;
        let period_entries: Vec<&AuditEntry> = entries
            .iter()
            .filter(|e| e.ts >= start_ms && e.ts < end_ms)
            .collect();

        let mut by_op: HashMap<String, u64> = HashMap::new();
        let mut by_recipient: HashMap<String, u64> = HashMap::new();
        let mut by_entity: HashMap<String, u64> = HashMap::new();
        let mut total_pii_hits = 0u64;
        let mut calls_with_pii = 0u64;
        let mut by_kind: HashMap<String, u64> = HashMap::new();
        let mut success = 0u64;
        let mut failed = 0u64;
        let mut total_duration = 0u64;

        for e in &period_entries {
            *by_op.entry(e.op.clone()).or_default() += 1;
            if let Some(r) = &e.receiver {
                *by_recipient.entry(r.clone()).or_default() += 1;
            }
            if let Some(t) = &e.entity_type {
                *by_entity.entry(t.clone()).or_default() += 1;
            }
            if e.has_pii {
                calls_with_pii += 1;
                total_pii_hits += e.pii_count as u64;
                *by_kind.entry(e.entity_type.clone().unwrap_or_else(|| "unknown".into())).or_default() += 1;
            }
            if e.success {
                success += 1;
            } else {
                failed += 1;
            }
            total_duration += e.duration_ms;
        }
        let total = period_entries.len() as u64;
        let avg_duration = if total > 0 { total_duration / total } else { 0 };

        let mut report = ComplianceReport {
            schema_version: 1,
            report_id: format!("cr_{}", uuid::Uuid::new_v4().simple()),
            generated_at: chrono::Utc::now().timestamp_millis(),
            period: Period { start: start_ms, end: end_ms, label: label.to_string() },
            summary: Summary {
                total_calls: total,
                success_calls: success,
                failed_calls: failed,
                anonymize_calls: *by_op.get("anonymize").unwrap_or(&0),
                deanonymize_calls: *by_op.get("deanonymize").unwrap_or(&0),
                filter_calls: *by_op.get("filter").unwrap_or(&0),
                dry_run_calls: *by_op.get("dryrun").unwrap_or(&0),
                config_calls: *by_op.get("init").unwrap_or(&0) + *by_op.get("disable").unwrap_or(&0),
                avg_duration_ms: avg_duration,
            },
            by_op,
            by_recipient,
            by_entity,
            pii_stats: PiiStats { total_pii_hits, calls_with_pii, by_kind },
            manifest: Manifest {
                audit_log_sha256: String::new(),
                report_sha256: String::new(),
                audit_log_line_count: 0,
                generated_at: 0,
            },
        };
        // manifest: 先序列化 report (manifest 字段暂空), 算 sha, 回填。
        report.manifest.audit_log_sha256 = self.sha256()?;
        report.manifest.audit_log_line_count = self.line_count()?;
        report.manifest.generated_at = report.generated_at;
        let report_json = serde_json::to_string(&report)?;
        let mut h = Sha256::new();
        h.update(report_json.as_bytes());
        report.manifest.report_sha256 = hex(&h.finalize());
        Ok(report)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceReport {
    pub schema_version: u32,
    pub report_id: String,
    pub generated_at: i64,
    pub period: Period,
    pub summary: Summary,
    pub by_op: HashMap<String, u64>,
    pub by_recipient: HashMap<String, u64>,
    pub by_entity: HashMap<String, u64>,
    pub pii_stats: PiiStats,
    pub manifest: Manifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Period {
    pub start: i64,
    pub end: i64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Summary {
    pub total_calls: u64,
    pub success_calls: u64,
    pub failed_calls: u64,
    pub anonymize_calls: u64,
    pub deanonymize_calls: u64,
    pub filter_calls: u64,
    pub dry_run_calls: u64,
    pub config_calls: u64,
    pub avg_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiiStats {
    pub total_pii_hits: u64,
    pub calls_with_pii: u64,
    pub by_kind: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub audit_log_sha256: String,
    pub report_sha256: String,
    pub audit_log_line_count: usize,
    pub generated_at: i64,
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}
