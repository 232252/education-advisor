//! Student domain service: CSV/Excel-flavored batch import + sample data.

use std::collections::HashMap;

use anyhow::{anyhow, Result};
use calamine::{Reader, Xlsx};
use chrono::Utc;
use std::io::Cursor;
use uuid::Uuid;

use crate::db::Db;
use crate::models::{ExportScope, GradeEntry, RiskLevel, Student};

/// Parse CSV content and insert students. Expected header (any order):
/// `name,gender,grade,class,id_number,risk,gpa`
/// `risk` is one of: low/medium/high/critical.
pub fn import_csv(db: &Db, content: &str) -> Result<usize> {
    let mut lines = content.lines();
    let header = lines.next().ok_or_else(|| anyhow!("空文件"))?;
    let cols: Vec<String> = header.split(',').map(|c| c.trim().to_lowercase()).collect();
    let idx = |name: &str| cols.iter().position(|c| c == name);

    let n_name = idx("name").ok_or_else(|| anyhow!("缺少 name 列"))?;
    let n_gender = idx("gender");
    let n_grade = idx("grade").unwrap_or(1);
    let n_class = idx("class").unwrap_or(2);
    let n_number = idx("id_number");
    let n_risk = idx("risk");
    let n_gpa = idx("gpa");

    let mut added = 0usize;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split(',').collect();
        let get = |i: Option<usize>| -> Option<String> {
            i.and_then(|i| fields.get(i))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let name = get(Some(n_name)).ok_or_else(|| anyhow!("姓名为空"))?;
        let risk = n_risk
            .and_then(|i| fields.get(i))
            .map_or(RiskLevel::Low, |s| match s.trim().to_lowercase().as_str() {
                "medium" | "中" | "中风险" => RiskLevel::Medium,
                "high" | "高" | "高风险" => RiskLevel::High,
                "critical" | "危机" => RiskLevel::Critical,
                _ => RiskLevel::Low,
            });
        let gpa = n_gpa
            .and_then(|i| fields.get(i))
            .and_then(|s| s.trim().parse::<f32>().ok());
        let now = Utc::now();
        let s = Student {
            id: Uuid::new_v4(),
            name,
            gender: get(n_gender),
            grade: get(Some(n_grade)).unwrap_or_default(),
            class: get(Some(n_class)).unwrap_or_default(),
            id_number: get(n_number),
            birth_date: None,
            enrollment_date: None,
            guardian_name: None,
            guardian_contact: None,
            guardian_relation: None,
            home_address: None,
            emergency_contact: None,
            risk_level: risk,
            gpa,
            tags: vec![],
            notes: None,
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
        (
            "张明",
            "男",
            "高三",
            "1班",
            "2021001",
            RiskLevel::Medium,
            3.4_f32,
        ),
        ("李华", "女", "高三", "2班", "2021002", RiskLevel::High, 2.8),
        ("王芳", "女", "高二", "3班", "2022003", RiskLevel::Low, 3.9),
        (
            "刘洋",
            "男",
            "高二",
            "1班",
            "2022004",
            RiskLevel::Critical,
            2.1,
        ),
        ("陈静", "女", "高一", "4班", "2023005", RiskLevel::Low, 4.0),
        (
            "赵磊",
            "男",
            "高一",
            "2班",
            "2023006",
            RiskLevel::Medium,
            3.2,
        ),
    ];
    let now = Utc::now();
    for (name, gender, grade, class, number, risk, gpa) in demo {
        let id = Uuid::new_v4();
        db.upsert_student(&Student {
            id,
            name: name.into(),
            gender: Some(gender.into()),
            grade: grade.into(),
            class: class.into(),
            id_number: Some(number.into()),
            birth_date: None,
            enrollment_date: None,
            guardian_name: None,
            guardian_contact: None,
            guardian_relation: None,
            home_address: None,
            emergency_contact: None,
            risk_level: risk,
            gpa: Some(gpa),
            tags: vec!["示例".into()],
            notes: Some("这是示例学生数据".into()),
            created_at: now,
            updated_at: now,
        })?;
        // a few grades
        let subjects = ["语文", "数学", "英语", "物理"];
        for (i, subj) in subjects.iter().enumerate() {
            let score = (gpa / 4.0)
                .mul_add(100.0, (i as f32 - 1.5) * 6.0)
                .clamp(40.0, 100.0);
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
#[allow(dead_code)]
pub fn import_excel(bytes: &[u8]) -> Result<String> {
    let cursor = Cursor::new(bytes);
    let mut workbook: Xlsx<_> =
        calamine::open_workbook_from_rs(cursor).map_err(|e| anyhow!("无法打开 Excel: {e}"))?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_import_parses_header_and_rows() {
        let db = Db::open_in_memory().unwrap();
        let csv = "name,grade,class,risk,gpa\n孙悦,高三,1班,low,3.7\n周杰,高二,2班,high,2.5\n";
        let added = import_csv(&db, csv).unwrap();
        assert_eq!(added, 2);
        let list = db.list_students().unwrap();
        assert!(list.iter().any(|s| s.name == "孙悦"));
    }

    #[test]
    fn export_csv_respects_scope() {
        let s1 = Student {
            id: Uuid::new_v4(),
            name: "A".into(),
            gender: None,
            grade: "高一".into(),
            class: "1班".into(),
            id_number: None,
            birth_date: None,
            enrollment_date: None,
            guardian_name: None,
            guardian_contact: None,
            guardian_relation: None,
            home_address: None,
            emergency_contact: None,
            risk_level: RiskLevel::Low,
            gpa: Some(3.5),
            tags: vec![],
            notes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let s2 = Student {
            id: Uuid::new_v4(),
            name: "B".into(),
            gender: None,
            grade: "高一".into(),
            class: "2班".into(),
            id_number: None,
            birth_date: None,
            enrollment_date: None,
            guardian_name: None,
            guardian_contact: None,
            guardian_relation: None,
            home_address: None,
            emergency_contact: None,
            risk_level: RiskLevel::Low,
            gpa: Some(3.0),
            tags: vec![],
            notes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let students = vec![s1.clone(), s2];
        let grades = HashMap::new();
        let all = export_csv(&students, &grades, ExportScope::All, None);
        assert_eq!(all.lines().count(), 3);
        let one = export_csv(
            &students,
            &grades,
            ExportScope::SelectedStudent,
            Some(s1.id),
        );
        assert_eq!(one.lines().count(), 2);
        assert!(one.contains('A'));
        assert!(!one.contains('B'));
    }
}
