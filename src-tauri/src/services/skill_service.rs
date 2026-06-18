//! Skill 服务 — Rust 重写自 `src/main/services/skill-service.ts` (412 行)。
//!
//! Skill 是用户自定义的 Markdown 提示词片段 (类似 SOUL.md/AGENTS.md 但更轻量),
//! 存在 `{userData}/skills/<name>.md`, frontmatter 含 enabled 标志。
//! Agent 在运行时可引用 skill_id 把内容拼进 system prompt。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Markdown 正文 (去掉 frontmatter)。
    pub content: String,
    /// 完整源 (含 frontmatter), 用于保存往返。
    #[serde(skip)]
    pub raw: String,
}

fn default_true() -> bool {
    true
}

pub struct SkillService {
    skills: HashMap<String, Skill>,
    dir: PathBuf,
}

impl SkillService {
    pub fn load(resources: &Path) -> Result<Self> {
        // skill 目录: 优先 userData/skills, 回退 resources/skills。
        let dir = resources.join("skills");
        let mut skills = HashMap::new();
        if dir.exists() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    if let Some(name) = path.file_stem().and_then(|n| n.to_str()) {
                        if let Ok(skill) = Self::parse_file(name, &path) {
                            skills.insert(name.to_string(), skill);
                        }
                    }
                }
            }
        }
        Ok(Self { skills, dir })
    }

    pub fn list(&self) -> Vec<Skill> {
        self.skills.values().cloned().collect()
    }

    pub fn get(&self, name: &str) -> Option<Skill> {
        self.skills.get(name).cloned()
    }

    pub fn save(&mut self, name: &str, content: &str) -> Result<()> {
        let path = self.dir.join(format!("{name}.md"));
        std::fs::create_dir_all(&self.dir)?;
        atomic_write(&path, content)?;
        let skill = Self::parse_file(name, &path)?;
        self.skills.insert(name.to_string(), skill);
        Ok(())
    }

    pub fn delete(&mut self, name: &str) -> Result<()> {
        let path = self.dir.join(format!("{name}.md"));
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        self.skills.remove(name);
        Ok(())
    }

    pub fn set_enabled(&mut self, name: &str, enabled: bool) -> Result<()> {
        let skill = self
            .skills
            .get_mut(name)
            .ok_or_else(|| AppError::NotFound(format!("skill {name}")))?;
        skill.enabled = enabled;
        // 重写文件 (更新 frontmatter)
        let raw = if skill.raw.starts_with("---\n") {
            // 替换 frontmatter 里的 enabled
            let end = skill.raw[4..]
                .find("\n---\n")
                .map(|i| i + 4)
                .unwrap_or(skill.raw.len());
            let body = &skill.raw[end..];
            format!("---\nenabled: {enabled}\n---{body}")
        } else {
            format!("---\nenabled: {enabled}\n---\n{}", skill.content)
        };
        let path = self.dir.join(format!("{name}.md"));
        atomic_write(&path, &raw)?;
        skill.raw = raw;
        Ok(())
    }

    fn parse_file(name: &str, path: &Path) -> Result<Skill> {
        let raw = std::fs::read_to_string(path)?;
        let (enabled, content) = if let Some(rest) = raw.strip_prefix("---\n") {
            if let Some(end) = rest.find("\n---\n") {
                let fm = &rest[..end];
                let body = &rest[end + 5..];
                let en = fm
                    .lines()
                    .find_map(|l| {
                        l.strip_prefix("enabled:")
                            .and_then(|s| s.trim().parse::<bool>().ok())
                    })
                    .unwrap_or(true);
                (en, body.to_string())
            } else {
                (true, raw.clone())
            }
        } else {
            (true, raw.clone())
        };
        Ok(Skill {
            name: name.to_string(),
            description: String::new(),
            enabled,
            content,
            raw,
        })
    }
}

fn atomic_write(path: &Path, content: &str) -> Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("md.tmp");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// =============================================================
// 单元测试 — Skill 解析/保存/启用切换 (用 tempfile 隔离文件 IO)。
// 覆盖点: frontmatter 解析 / 默认 enabled=true / 原子写往返 / set_enabled 重写。
// headless CI 可跑 (不依赖 Tauri 运行时)。
// =============================================================
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 用临时目录造一个 resources 目录 + 测试 skill 文件。
    fn fixture(skill_md: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let resources = dir.path().to_path_buf();
        let skills_dir = resources.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(skills_dir.join("greet.md"), skill_md).unwrap();
        (dir, resources)
    }

    #[test]
    fn parses_skill_with_frontmatter() {
        let md = "---\nenabled: false\n---\n你好,我是问候技能。";
        let (_tmp, resources) = fixture(md);
        let svc = SkillService::load(&resources).unwrap();
        let s = svc.get("greet").unwrap();
        assert!(!s.enabled, "frontmatter enabled: false 应被解析");
        assert_eq!(s.content.trim(), "你好,我是问候技能。");
        assert_eq!(s.name, "greet");
    }

    #[test]
    fn parses_skill_without_frontmatter_defaults_enabled() {
        // 没有 frontmatter → enabled 默认 true (default_true)。
        let md = "纯正文,无 frontmatter。";
        let (_tmp, resources) = fixture(md);
        let svc = SkillService::load(&resources).unwrap();
        let s = svc.get("greet").unwrap();
        assert!(s.enabled);
        assert_eq!(s.content, md);
    }

    #[test]
    fn list_returns_all_parsed_skills() {
        let dir = tempfile::tempdir().unwrap();
        let resources = dir.path().to_path_buf();
        let skills_dir = resources.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(skills_dir.join("a.md"), "A").unwrap();
        fs::write(skills_dir.join("b.md"), "B").unwrap();
        // 非 .md 文件应被忽略。
        fs::write(skills_dir.join("c.txt"), "C").unwrap();
        let svc = SkillService::load(&resources).unwrap();
        let names: Vec<String> = svc.list().into_iter().map(|s| s.name).collect();
        assert!(names.contains(&"a".to_string()));
        assert!(names.contains(&"b".to_string()));
        assert!(!names.contains(&"c".to_string()));
        assert_eq!(names.len(), 2);
    }

    #[test]
    fn save_creates_file_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let resources = dir.path().to_path_buf();
        // skills 目录不存在时 save 应自动创建 (atomic_write → create_dir_all)。
        let mut svc = SkillService::load(&resources).unwrap();
        svc.save("newbie", "---\nenabled: true\n---\n新技能正文")
            .unwrap();
        assert!(resources.join("skills").join("newbie.md").exists());
        // 重新 load 应能读回。
        let svc2 = SkillService::load(&resources).unwrap();
        assert_eq!(svc2.get("newbie").unwrap().content.trim(), "新技能正文");
    }

    #[test]
    fn delete_removes_file_and_memory() {
        let (_tmp, resources) = fixture("---\n---\n待删除");
        let mut svc = SkillService::load(&resources).unwrap();
        assert!(svc.get("greet").is_some());
        svc.delete("greet").unwrap();
        assert!(svc.get("greet").is_none());
        assert!(!resources.join("skills").join("greet.md").exists());
    }

    #[test]
    fn delete_nonexistent_is_idempotent() {
        // 删不存在的 skill 不应报错 (幂等)。
        let dir = tempfile::tempdir().unwrap();
        let resources = dir.path().to_path_buf();
        let mut svc = SkillService::load(&resources).unwrap();
        assert!(svc.delete("ghost").is_ok());
    }

    #[test]
    fn set_enabled_toggles_frontmatter() {
        let md = "---\nenabled: false\n---\n正文";
        let (_tmp, resources) = fixture(md);
        let mut svc = SkillService::load(&resources).unwrap();
        assert!(!svc.get("greet").unwrap().enabled, "初始应为 false");
        // false → true
        svc.set_enabled("greet", true).unwrap();
        assert!(svc.get("greet").unwrap().enabled, "改 true 后内存应为 true");
        // 文件应被重写, 重新 load 仍是 true。
        let svc2 = SkillService::load(&resources).unwrap();
        assert!(svc2.get("greet").unwrap().enabled, "重新 load 应为 true");
        // true → false (在同一实例上再切回)
        svc.set_enabled("greet", false).unwrap();
        assert!(
            !svc.get("greet").unwrap().enabled,
            "改 false 后内存应为 false"
        );
    }

    #[test]
    fn set_enabled_on_unknown_skill_errors() {
        let dir = tempfile::tempdir().unwrap();
        let resources = dir.path().to_path_buf();
        let mut svc = SkillService::load(&resources).unwrap();
        let err = svc.set_enabled("nope", true).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn malformed_markdown_is_skipped_not_fatal() {
        // 损坏的 .md 不应让整个 load 崩溃 (parse_file 返回 Err 时静默跳过)。
        let dir = tempfile::tempdir().unwrap();
        let resources = dir.path().to_path_buf();
        let skills_dir = resources.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(skills_dir.join("good.md"), "正常").unwrap();
        // 写一个不可读的文件 (权限问题模拟: 这里用一个二进制垃圾)。
        fs::write(skills_dir.join("bad.md"), [0xff, 0xfe, 0xfd]).unwrap();
        // load 不应 panic。
        let svc = SkillService::load(&resources).unwrap();
        assert!(svc.get("good").is_some());
    }
}
