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
            let end = skill.raw[4..].find("\n---\n").map(|i| i + 4).unwrap_or(skill.raw.len());
            let body = &skill.raw[end..];
            format!(
                "---\nenabled: {enabled}\n---{body}"
            )
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
                    .find_map(|l| l.strip_prefix("enabled:").and_then(|s| s.trim().parse::<bool>().ok()))
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
