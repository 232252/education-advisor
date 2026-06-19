//! Student domain service: CSV/Excel-flavored batch import + sample data.

use anyhow::{anyhow, Result};
use chrono::Utc;
use uuid::Uuid;

use crate::db::Db;
use crate::models::{RiskLevel, Student, GradeEntry};

/// Parse CSV content and insert students. Expected header (any order):
/// name,grade,class,risk,gpa
/// `risk` is one of: low/medium/high/critical.
pub fn import_csv(db: &Db, content: &str) -> Result<usize> {
    let mut lines = content.lines();
    let header = lines.next().ok_or_else(|| anyhow!("空文件"))?;
    let cols: Vec<String> = header
        .split(',')
        .map(|c| c.trim().to_lowercase())
        .collect();
    let idx = |name: &str| cols.iter().position(|c| c == name);

    let n_name = idx("name").ok_or_else(|| anyhow!("缺少 name 列"))?;
    let n_grade = idx("grade").unwrap_or(1);
    let n_class = idx("class").unwrap_or(2);
    let n_risk = idx("risk");
    let n_gpa = idx("gpa");

    let mut added = 0usize;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(',').collect();
        let get = |i: Option<usize>| -> String {
            i.and_then(|i| fields.get(i)).map(|s| s.trim().to_string()).unwrap_or_default()
        };
        let name = get(Some(n_name));
        if name.is_empty() {
            continue;
        }
        let risk = n_risk
            .and_then(|i| fields.get(i))
            .map_or(RiskLevel::Low, |s| match s.trim().to_lowercase().as_str() {
                "medium" | "中" | "中风险" => RiskLevel::Medium,
                "high" | "高" | "高风险" => RiskLevel::High,
                "critical" | "危机" => RiskLevel::Critical,
                _ => RiskLevel::Low,
            });
        let gpa = n_gpa.and_then(|i| fields.get(i)).and_then(|s| s.trim().parse::<f32>().ok());
        let now = Utc::now();
        let s = Student {
            id: Uuid::new_v4(),
            name,
            grade: get(Some(n_grade)),
            class: get(Some(n_class)),
            birth_date: None,
            guardian_contact: None,
            risk_level: risk,
            gpa,
            tags: vec![],
            created_at: now,
            updated_at: now,
        };
        db.upsert_student(&s)?;
        added += 1;
    }
    Ok(added)
}

/// Seed a handful of demo students when the DB is empty (first run).
pub fn seed_demo(db: &Db) -> Result<()> {
    if !db.list_students()?.is_empty() {
        return Ok(());
    }
    let demo = [
        ("张明", "高三", "1班", RiskLevel::Medium, 3.4_f32),
        ("李华", "高三", "2班", RiskLevel::High, 2.8),
        ("王芳", "高二", "3班", RiskLevel::Low, 3.9),
        ("刘洋", "高二", "1班", RiskLevel::Critical, 2.1),
        ("陈静", "高一", "4班", RiskLevel::Low, 4.0),
        ("赵磊", "高一", "2班", RiskLevel::Medium, 3.2),
    ];
    let now = Utc::now();
    for (name, grade, class, risk, gpa) in demo {
        let id = Uuid::new_v4();
        db.upsert_student(&Student {
            id,
            name: name.into(),
            grade: grade.into(),
            class: class.into(),
            birth_date: None,
            guardian_contact: None,
            risk_level: risk,
            gpa: Some(gpa),
            tags: vec!["示例".into()],
            created_at: now,
            updated_at: now,
        })?;
        // a few grades
        let subjects = ["语文", "数学", "英语", "物理"];
        for (i, subj) in subjects.iter().enumerate() {
            let score = (gpa / 4.0).mul_add(100.0, (i as f32 - 1.5) * 6.0).clamp(40.0, 100.0);
            db.add_grade(&GradeEntry {
                id: Uuid::new_v4(),
                student_id: id,
                subject: (*subj).into(),
                score,
                max_score: 100.0,
                exam_date: chrono::Utc::now().date_naive(),
                recorded_at: now,
            })?;
        }
    }
    Ok(())
}
