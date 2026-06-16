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
    pub op: String, // anonymize|deanonymize|filter|dryrun|init|disable
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
                *by_kind
                    .entry(e.entity_type.clone().unwrap_or_else(|| "unknown".into()))
                    .or_default() += 1;
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
            period: Period {
                start: start_ms,
                end: end_ms,
                label: label.to_string(),
            },
            summary: Summary {
                total_calls: total,
                success_calls: success,
                failed_calls: failed,
                anonymize_calls: *by_op.get("anonymize").unwrap_or(&0),
                deanonymize_calls: *by_op.get("deanonymize").unwrap_or(&0),
                filter_calls: *by_op.get("filter").unwrap_or(&0),
                dry_run_calls: *by_op.get("dryrun").unwrap_or(&0),
                config_calls: *by_op.get("init").unwrap_or(&0)
                    + *by_op.get("disable").unwrap_or(&0),
                avg_duration_ms: avg_duration,
            },
            by_op,
            by_recipient,
            by_entity,
            pii_stats: PiiStats {
                total_pii_hits,
                calls_with_pii,
                by_kind,
            },
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

// =============================================================
// 单元测试 — 隐私审计日志的 append / read / sha256 / 季度合规报告。
// 覆盖点: JSON-Lines 追加 / 倒序读取 / 时间窗口过滤 / 聚合统计 / manifest SHA。
// 合规报告是审计闭环的核心产物, 错一个聚合数都是合规事故。
// 用 tempfile 隔离, headless CI 可跑。
// =============================================================
#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一条审计条目。
    fn entry(ts: i64, op: &str, pii: bool, pii_count: usize, success: bool) -> AuditEntry {
        AuditEntry {
            ts,
            op: op.into(),
            input_len: 100,
            output_len: 90,
            has_pii: pii,
            pii_count,
            receiver: Some("llm".into()),
            entity_type: Some("student".into()),
            duration_ms: 5,
            success,
            error: None,
        }
    }

    fn open_tmp() -> (tempfile::TempDir, PrivacyAuditService) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("privacy").join("audit.log");
        let svc = PrivacyAuditService::open(path).unwrap();
        (dir, svc)
    }

    #[test]
    fn open_creates_parent_dirs_and_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deeply").join("nested").join("audit.log");
        let _svc = PrivacyAuditService::open(path.clone()).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn append_and_read_round_trip() {
        let (_tmp, svc) = open_tmp();
        svc.append(&entry(1000, "anonymize", true, 3, true))
            .unwrap();
        svc.append(&entry(2000, "filter", false, 0, true)).unwrap();
        let entries = svc.read(10).unwrap();
        // read 是倒序 (最新在前)。
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].ts, 2000);
        assert_eq!(entries[1].ts, 1000);
    }

    #[test]
    fn read_respects_limit() {
        let (_tmp, svc) = open_tmp();
        for i in 0..10 {
            svc.append(&entry(i, "anonymize", false, 0, true)).unwrap();
        }
        let entries = svc.read(3).unwrap();
        assert_eq!(entries.len(), 3);
        // 倒序: 最新 3 条是 ts = 9, 8, 7。
        assert_eq!(entries[0].ts, 9);
        assert_eq!(entries[2].ts, 7);
    }

    #[test]
    fn read_empty_log_returns_empty() {
        let (_tmp, svc) = open_tmp();
        let entries = svc.read(10).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn line_count_counts_non_empty_lines() {
        let (_tmp, svc) = open_tmp();
        svc.append(&entry(1, "anonymize", false, 0, true)).unwrap();
        svc.append(&entry(2, "filter", false, 0, true)).unwrap();
        assert_eq!(svc.line_count().unwrap(), 2);
    }

    #[test]
    fn sha256_changes_on_append() {
        let (_tmp, svc) = open_tmp();
        let h1 = svc.sha256().unwrap();
        svc.append(&entry(1, "anonymize", false, 0, true)).unwrap();
        let h2 = svc.sha256().unwrap();
        assert_ne!(h1, h2, "追加内容后 SHA 必须变化");
        // SHA 是 64 位 hex 字符。
        assert_eq!(h2.len(), 64);
        assert!(h2.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generate_report_filters_by_time_window() {
        let (_tmp, svc) = open_tmp();
        // 窗口 [1000, 3000): 只含 ts=1000, 2000。
        svc.append(&entry(1000, "anonymize", true, 2, true))
            .unwrap();
        svc.append(&entry(2000, "filter", false, 0, true)).unwrap();
        svc.append(&entry(500, "anonymize", false, 0, true))
            .unwrap(); // 窗口外
        svc.append(&entry(3000, "anonymize", false, 0, true))
            .unwrap(); // 窗口外 (右开)
        let report = svc.generate_report(1000, 3000, "Q2").unwrap();
        assert_eq!(report.summary.total_calls, 2);
        assert_eq!(report.period.label, "Q2");
    }

    #[test]
    fn generate_report_aggregates_by_op() {
        let (_tmp, svc) = open_tmp();
        svc.append(&entry(100, "anonymize", false, 0, true))
            .unwrap();
        svc.append(&entry(110, "anonymize", false, 0, true))
            .unwrap();
        svc.append(&entry(120, "filter", false, 0, true)).unwrap();
        svc.append(&entry(130, "dryrun", false, 0, true)).unwrap();
        svc.append(&entry(140, "init", false, 0, true)).unwrap();
        let report = svc.generate_report(0, 1000, "all").unwrap();
        assert_eq!(report.summary.anonymize_calls, 2);
        assert_eq!(report.summary.filter_calls, 1);
        assert_eq!(report.summary.dry_run_calls, 1);
        // init + disable 合计为 config_calls。
        assert_eq!(report.summary.config_calls, 1);
    }

    #[test]
    fn generate_report_counts_pii() {
        let (_tmp, svc) = open_tmp();
        svc.append(&entry(1, "anonymize", true, 5, true)).unwrap();
        svc.append(&entry(2, "anonymize", true, 3, true)).unwrap();
        svc.append(&entry(3, "filter", false, 0, true)).unwrap();
        let report = svc.generate_report(0, 1000, "all").unwrap();
        assert_eq!(report.pii_stats.total_pii_hits, 8);
        assert_eq!(report.pii_stats.calls_with_pii, 2);
    }

    #[test]
    fn generate_report_tracks_success_failure() {
        let (_tmp, svc) = open_tmp();
        svc.append(&entry(1, "anonymize", false, 0, true)).unwrap();
        svc.append(&entry(2, "anonymize", false, 0, true)).unwrap();
        svc.append(&entry(3, "anonymize", false, 0, false)).unwrap();
        let report = svc.generate_report(0, 1000, "all").unwrap();
        assert_eq!(report.summary.success_calls, 2);
        assert_eq!(report.summary.failed_calls, 1);
    }

    #[test]
    fn generate_report_populates_manifest() {
        let (_tmp, svc) = open_tmp();
        svc.append(&entry(1, "anonymize", false, 0, true)).unwrap();
        let report = svc.generate_report(0, 1000, "all").unwrap();
        // manifest 的 sha256 不应为空 (基于真实文件内容算出)。
        assert!(!report.manifest.audit_log_sha256.is_empty());
        assert!(!report.manifest.report_sha256.is_empty());
        assert_eq!(report.manifest.audit_log_line_count, 1);
        assert!(report.manifest.generated_at > 0);
    }

    #[test]
    fn generate_report_on_empty_log_is_safe() {
        let (_tmp, svc) = open_tmp();
        let report = svc.generate_report(0, 1000, "all").unwrap();
        assert_eq!(report.summary.total_calls, 0);
        assert_eq!(report.summary.avg_duration_ms, 0);
        assert_eq!(report.pii_stats.total_pii_hits, 0);
    }

    #[test]
    fn report_serializes_to_json() {
        // 合规报告要能导出存档, 锁定可序列化。
        let (_tmp, svc) = open_tmp();
        svc.append(&entry(1, "anonymize", true, 1, true)).unwrap();
        let report = svc.generate_report(0, 1000, "Q1").unwrap();
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"schema_version\":1"));
        assert!(json.contains("\"total_calls\":1"));
        assert!(json.contains("\"report_sha256\""));
    }

    #[test]
    fn audit_entry_round_trips_json() {
        // JSON-Lines 格式: 每行一个独立 JSON 对象, 必须能反序列化回来。
        let e = entry(999, "deanonymize", true, 4, true);
        let line = serde_json::to_string(&e).unwrap();
        let back: AuditEntry = serde_json::from_str(&line).unwrap();
        assert_eq!(back.ts, 999);
        assert_eq!(back.op, "deanonymize");
        assert!(back.has_pii);
        assert_eq!(back.pii_count, 4);
    }
}
