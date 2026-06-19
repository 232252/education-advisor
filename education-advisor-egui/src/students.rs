//! Student domain service: CSV/Excel-flavored batch import + sample data.

use std::collections::HashMap;

use anyhow::{anyhow, Result};
use calamine::{Reader, Xlsx};
use chrono::Utc;
use std::io::Cursor;
use uuid::Uuid;

use crate::db::Db;
use crate::models::{RiskLevel, Student, GradeEntry, ExportScope};

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

/// Convert the first worksheet of an Excel file to a CSV string compatible
/// with `import_csv`.
pub fn import_excel(bytes: &[u8]) -> Result<String> {
    let cursor = Cursor::new(bytes);
    let mut workbook: Xlsx<_> = calamine::open_workbook_from_rs(cursor)
        .map_err(|e| anyhow!("无法打开 Excel: {e}"))?;
    let sheet_name = workbook.sheet_names().first().cloned()
        .ok_or_else(|| anyhow!("Excel 无工作表"))?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|e| anyhow!("读取工作表失败: {e}"))?;

    let mut csv = String::new();
    for row in range.rows() {
        let cells: Vec<String> = row
            .iter()
            .map(|c| match c {
                calamine::Data::Float(f) => format!("{f}"),
                calamine::Data::Int(i) => i.to_string(),
                calamine::Data::String(s) => s.clone(),
                calamine::Data::Bool(b) => b.to_string(),
                _ => String::new(),
            })
            .collect();
        csv.push_str(&cells.join(","));
        csv.push('\n');
    }
    Ok(csv)
}

/// Export students and their grades to CSV.
pub fn export_csv(
    students: &[Student],
    grades: &HashMap<Uuid, Vec<GradeEntry>>,
    scope: ExportScope,
    selected: Option<Uuid>,
) -> String {
    let filtered: Vec<&Student> = match scope {
        ExportScope::All => students.iter().collect(),
        ExportScope::SelectedStudent => selected
            .and_then(|id| students.iter().find(|s| s.id == id))
            .into_iter()
            .collect(),
    };
    let mut lines = vec!["id,name,grade,class,risk_level,gpa,subject,score,max_score".to_string()];
    for s in filtered {
        let entries = grades.get(&s.id).cloned().unwrap_or_default();
        if entries.is_empty() {
            lines.push(format!(
                "{},{},{},{},{},{},,",
                s.id,
                s.name,
                s.grade,
                s.class,
                s.risk_level as i32,
                s.gpa.map_or_else(String::new, |g| format!("{g:.2}"))
            ));
        } else {
            for g in &entries {
                lines.push(format!(
                    "{},{},{},{},{},{},{},{},{}",
                    s.id,
                    s.name,
                    s.grade,
                    s.class,
                    s.risk_level as i32,
                    s.gpa.map_or_else(String::new, |v| format!("{v:.2}")),
                    g.subject,
                    g.score,
                    g.max_score
                ));
            }
        }
    }
    lines.join("\n")
}
