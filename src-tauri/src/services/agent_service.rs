//! Agent 服务 — Rust 重写自 `src/main/services/agent-service.ts` (1278 行)。
//!
//! 负责加载 `config/agents.yaml` + 每个 agent 的 `agents/<id>/SOUL.md` & `AGENTS.md`。
//! 不含 LLM 调用循环本身 (那在 llm_service.rs + tools/eaa_tools.rs), 本服务只管
//! agent 注册表元数据 + capability 校验 + prompt 组装 + SOUL/Rules 文件读写。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml;

use crate::error::{AppError, Result};

// =============================================================
// Agent 配置类型 (与 config/agents.yaml 与 shared/types.ts 同构)
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEntry {
    pub id: String,
    pub name: String,
    pub role: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub model_tier: ModelTier,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub schedule: Schedule,
    #[serde(default)]
    pub risk_thresholds: RiskThresholds,
    #[serde(default)]
    pub skill_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ModelTier {
    HighQuality,
    LowCost,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Schedule {
    #[serde(default)]
    pub cron: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskThresholds {
    #[serde(default)]
    pub high: f64,
    #[serde(default)]
    pub medium: f64,
    #[serde(default)]
    pub low: f64,
}

impl Default for RiskThresholds {
    fn default() -> Self {
        Self {
            high: 85.0,
            medium: 93.0,
            low: 93.0,
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentsFile {
    pub agents: Vec<AgentEntry>,
}

/// 运行时使用的 agent 详情 (含 last_run_at, next_run_at 等)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDetail {
    #[serde(flatten)]
    pub entry: AgentEntry,
    /// 最近一次运行时间 (ms epoch)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<i64>,
    /// SOUL.md 内容。
    #[serde(default)]
    pub soul: String,
    /// AGENTS.md 内容。
    #[serde(default)]
    pub rules: String,
}

// =============================================================
// AgentService
// =============================================================

pub struct AgentService {
    agents: Vec<AgentEntry>,
    /// id -> entry 的索引, 加速查找。
    index: HashMap<String, usize>,
    /// resources 根 (agents/<id>/SOUL.md, config/agents.yaml 都在这里)。
    resources: PathBuf,
    /// 最后一次运行时间 (运行时填充)。
    last_run: HashMap<String, i64>,
}

impl AgentService {
    /// 从 resources 加载 agents.yaml。
    pub fn load(resources: &Path) -> Result<Self> {
        let yaml_path = resources.join("config").join("agents.yaml");
        let raw = std::fs::read_to_string(&yaml_path)
            .map_err(|e| AppError::Config(format!("读取 agents.yaml 失败: {e}")))?;
        let file: AgentsFile = serde_yaml::from_str(&raw)
            .map_err(|e| AppError::Config(format!("解析 agents.yaml 失败: {e}")))?;
        let index = file
            .agents
            .iter()
            .enumerate()
            .map(|(i, a)| (a.id.clone(), i))
            .collect();
        tracing::info!(target: "agent_service", "loaded {} agents", file.agents.len());
        Ok(Self {
            agents: file.agents,
            index,
            resources: resources.to_path_buf(),
            last_run: HashMap::new(),
        })
    }

    pub fn list(&self) -> Vec<AgentListItem> {
        self.agents
            .iter()
            .map(|a| AgentListItem {
                id: a.id.clone(),
                name: a.name.clone(),
                role: a.role.clone(),
                enabled: a.enabled,
                model_tier: a.model_tier,
                schedule: a.schedule.clone(),
                capabilities_count: a.capabilities.len() as u32,
                last_run_at: self.last_run.get(&a.id).copied(),
            })
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<AgentDetail> {
        let entry = self.agents.get(*self.index.get(id)?)?.clone();
        let soul = self.read_md(id, "SOUL.md").unwrap_or_default();
        let rules = self.read_md(id, "AGENTS.md").unwrap_or_default();
        Some(AgentDetail {
            entry,
            last_run_at: self.last_run.get(id).copied(),
            soul,
            rules,
        })
    }

    pub fn toggle(&mut self, id: &str, enabled: bool) -> Result<()> {
        let idx = *self
            .index
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("agent {id}")))?;
        self.agents[idx].enabled = enabled;
        self.persist()?;
        Ok(())
    }

    pub fn update(&mut self, id: &str, patch: &serde_json::Value) -> Result<()> {
        let idx = *self
            .index
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("agent {id}")))?;
        let entry = &mut self.agents[idx];
        if let Some(n) = patch.get("name").and_then(|v| v.as_str()) {
            entry.name = n.to_string();
        }
        if let Some(d) = patch.get("description").and_then(|v| v.as_str()) {
            entry.description = d.to_string();
        }
        if let Some(t) = patch.get("modelTier").and_then(|v| v.as_str()) {
            entry.model_tier = match t {
                "high_quality" => ModelTier::HighQuality,
                "low_cost" => ModelTier::LowCost,
                _ => return Err(AppError::Validation(format!("未知 modelTier: {t}"))),
            };
        }
        if let Some(c) = patch.get("capabilities").and_then(|v| v.as_array()) {
            entry.capabilities = c
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
        }
        if let Some(s) = patch.get("skillIds").and_then(|v| v.as_array()) {
            entry.skill_ids = s
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
        }
        self.persist()?;
        Ok(())
    }

    pub fn get_soul(&self, id: &str) -> Result<String> {
        self.read_md(id, "SOUL.md")
    }
    pub fn set_soul(&self, id: &str, content: &str) -> Result<()> {
        self.write_md(id, "SOUL.md", content)
    }
    pub fn get_rules(&self, id: &str) -> Result<String> {
        self.read_md(id, "AGENTS.md")
    }
    pub fn set_rules(&self, id: &str, content: &str) -> Result<()> {
        self.write_md(id, "AGENTS.md", content)
    }

    pub fn record_run(&mut self, id: &str, at_ms: i64) {
        self.last_run.insert(id.to_string(), at_ms);
    }

    /// 校验 agent 是否拥有指定 capability (least-privilege)。
    pub fn has_capability(&self, id: &str, cap: &str) -> bool {
        match self.agents.get(*self.index.get(id).unwrap_or(&usize::MAX)) {
            Some(e) => e
                .capabilities
                .iter()
                .any(|c| c == cap || c == "all" || c == "*"),
            None => false,
        }
    }

    pub fn capabilities(&self, id: &str) -> Vec<String> {
        self.agents
            .get(*self.index.get(id).unwrap_or(&usize::MAX))
            .map(|e| e.capabilities.clone())
            .unwrap_or_default()
    }

    fn read_md(&self, id: &str, file: &str) -> Result<String> {
        let p = self.resources.join("agents").join(id).join(file);
        std::fs::read_to_string(&p).map_err(|e| AppError::Io(e))
    }
    fn write_md(&self, id: &str, file: &str, content: &str) -> Result<()> {
        let p = self.resources.join("agents").join(id).join(file);
        use std::io::Write;
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = p.with_extension("md.tmp");
        {
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(content.as_bytes())?;
            f.sync_all()?;
        }
        std::fs::rename(&tmp, &p)?;
        Ok(())
    }

    fn persist(&self) -> Result<()> {
        let yaml_path = self.resources.join("config").join("agents.yaml");
        let file = AgentsFile {
            agents: self.agents.clone(),
        };
        let data = serde_yaml::to_string(&file)
            .map_err(|e| AppError::Config(format!("序列化 agents.yaml: {e}")))?;
        let tmp = yaml_path.with_extension("yaml.tmp");
        std::fs::write(&tmp, data)?;
        std::fs::rename(&tmp, &yaml_path)?;
        Ok(())
    }

    /// 拿 entry 引用 (供 llm_service 组装 prompt 用)。
    pub fn entry(&self, id: &str) -> Option<&AgentEntry> {
        self.agents.get(*self.index.get(id)?)
    }
}

/// 列表项 (前端 AgentListItem 同构)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentListItem {
    pub id: String,
    pub name: String,
    pub role: String,
    pub enabled: bool,
    pub model_tier: ModelTier,
    pub schedule: Schedule,
    pub capabilities_count: u32,
    pub last_run_at: Option<i64>,
}
