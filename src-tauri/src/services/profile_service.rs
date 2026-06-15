//! 学生档案服务 — Rust 重写自 `src/main/services/profile-service.ts` (388 行)。
//!
//! 每个 student 一份 JSON 档案 `{eaa_data}/profiles/<name>.json`。
//!
//! StudentProfileData 是开放对象 (shared/types.ts ~40 个可选字段 + `[key: string]: unknown`),
//! 这里用 serde_json::Value 透传, 不逐一镜像字段 — 前端任何字段 (gender/fatherName/
//! academicRecords/classRank/customSubjects/...) 都能正确往返。关键字段名必须与
//! shared/types.ts 一致:
//!   - academicRecords: AcademicExamRecord[] (注意是复数 Records, 不是 academic!)
//!   - 每条记录: { examType, examName, subjects: Record<科目, 分数|null>, date?, notes? }
//!
//! 隐私: 原版写入时逐字段 anonymize (privacy-preflight); 本版在 command 层按需调隐私引擎。
//! 并发: 原子写 tmp → fsync → rename。
//! agent 通过 profile.get / profile.set 读写, 学业 tab 直接消费 academicRecords。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::Result;

/// 成绩分数范围 (与原 profile-service 的 SCORE_MIN/MAX 一致)。
pub const SCORE_MIN: f64 = 0.0;
pub const SCORE_MAX: f64 = 150.0;

/// 一次考试的成绩记录 (与 shared/types.ts AcademicExamRecord 同构)。
/// subjects 是 "科目名 → 分数(null 表示缺考)" 的映射。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcademicExamRecord {
    #[serde(rename = "examType")]
    pub exam_type: String,
    #[serde(rename = "examName")]
    pub exam_name: String,
    #[serde(default)]
    pub subjects: HashMap<String, Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

pub struct ProfileService {
    dir: PathBuf,
    /// 内存缓存: name → 完整 profile (Value 透传)。读取时填充, 写入时更新。
    cache: HashMap<String, Value>,
}

impl ProfileService {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, cache: HashMap::new() }
    }

    /// 读学生完整档案 (Value 透传)。不存在则返回空对象。
    pub fn get(&mut self, name: &str) -> Result<Value> {
        if let Some(c) = self.cache.get(name) {
            return Ok(c.clone());
        }
        let path = self.dir.join(format!("{}.json", sanitize(name)));
        let data: Value = if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Default::default()))
        } else {
            Value::Object(Default::default())
        };
        self.cache.insert(name.to_string(), data.clone());
        Ok(data)
    }

    /// 写学生档案 (deep merge patch 到现有)。对齐原 profile.set: 前端传
    /// Partial<StudentProfileData>, 这里递归合并到现有对象 (数组/标量直接替换)。
    pub fn set(&mut self, name: &str, patch: Value) -> Result<()> {
        let mut current = self.get(name)?;
        merge_values(&mut current, &patch);
        std::fs::create_dir_all(&self.dir)?;
        let path = self.dir.join(format!("{}.json", sanitize(name)));
        atomic_write(&path, &current)?;
        self.cache.insert(name.to_string(), current);
        Ok(())
    }

    /// 校验学业记录数组 (与原 validateAcademicRecords 规则一致)。返回错误列表 (空=通过)。
    pub fn validate_academic(records: &[AcademicExamRecord]) -> Vec<String> {
        let mut errs = Vec::new();
        for (i, rec) in records.iter().enumerate() {
            if rec.exam_type.trim().is_empty() {
                errs.push(format!("[{i}] 考试类型不能为空"));
            }
            if rec.exam_name.trim().is_empty() {
                errs.push(format!("[{i}] 考试名称不能为空"));
            }
            if rec.subjects.is_empty() {
                errs.push(format!("[{i}] 至少需要一个科目的成绩"));
            } else {
                for (subject, score) in &rec.subjects {
                    if subject.trim().is_empty() {
                        errs.push(format!("[{i}] 科目名不能为空"));
                    }
                    if let Some(s) = score {
                        if s.is_nan() {
                            errs.push(format!("[{i}] {subject} 的成绩必须是数字或 null"));
                        } else if *s < SCORE_MIN || *s > SCORE_MAX {
                            errs.push(format!("[{i}] {subject} 的成绩 {s} 超出范围 ({SCORE_MIN}-{SCORE_MAX})"));
                        }
                    }
                }
            }
            if let Some(date) = &rec.date {
                if !date.is_empty() && !is_yyyy_mm_dd(date) {
                    errs.push(format!("[{i}] 日期格式不正确 (应为 YYYY-MM-DD)"));
                }
            }
        }
        errs
    }

    /// 清缓存 (隐私引擎 enable/disable 切换后调用, 强制重读)。
    pub fn invalidate(&mut self, name: Option<&str>) {
        match name {
            Some(n) => {
                self.cache.remove(n);
            }
            None => self.cache.clear(),
        }
    }
}

/// deep merge: b 合并进 a。两边都是 object → 递归; 否则 b 覆盖 a。
fn merge_values(a: &mut Value, b: &Value) {
    match (a, b) {
        (Value::Object(a_obj), Value::Object(b_obj)) => {
            for (k, v) in b_obj {
                if let Some(existing) = a_obj.get_mut(k) {
                    if existing.is_object() && v.is_object() {
                        merge_values(existing, v);
                        continue;
                    }
                }
                a_obj.insert(k.clone(), v.clone());
            }
        }
        (a, b) => {
            *a = b.clone();
        }
    }
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect()
}

fn atomic_write(path: &Path, data: &Value) -> Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(&serde_json::to_vec_pretty(data)?)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// 简单的 YYYY-MM-DD 校验 (不引入 regex crate, 手写)。
fn is_yyyy_mm_dd(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[..4].iter().all(|c| c.is_ascii_digit())
        && b[5..7].iter().all(|c| c.is_ascii_digit())
        && b[8..10].iter().all(|c| c.is_ascii_digit())
}
