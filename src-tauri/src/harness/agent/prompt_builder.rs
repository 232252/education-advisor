//! PromptBuilder — 组装 system prompt
//!
//! # 阶段二职责
//! - 拼接 SOUL.md + AGENTS.md + capabilities 描述 + skill 列表 + 工具描述
//! - 不做隐私脱敏 (阶段三 Guardrails)
//! - 不做应用状态注入 (阶段五)
//!
//! # 与 agent_runner.rs 旧实现的关系
//! 旧 `agent_runner::run` 在 line 130-145 手工拼 system prompt, 这里抽出来
//! 集中管理, 后续加新元素不需要改 runner。

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::harness::tools::ToolDescription;

/// 应用运行时上下文（阶段五：上下文感知 Prompt）
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppContext {
    #[serde(rename = "currentPage")]
    pub current_page: Option<String>,
    #[serde(rename = "selectedStudent")]
    pub selected_student: Option<String>,
    #[serde(rename = "openSettings")]
    pub open_settings: Option<String>,
}

/// PromptBuilder 输入
#[derive(Debug, Clone)]
pub struct PromptInputs<'a> {
    pub soul: &'a str,        // SOUL.md 内容
    pub rules: &'a str,       // AGENTS.md (规则) 内容
    pub capabilities: &'a [String],
    pub skills: &'a [SkillPromptEntry],
    pub tools: &'a [ToolDescription],
    pub agent_id: &'a str,
    pub memory: &'a str,      // 跨会话记忆文本（可为空）
    pub app_context: &'a AppContext, // 应用运行时上下文
}

/// Skill 列表项 (从 SkillService 拿)
#[derive(Debug, Clone)]
pub struct SkillPromptEntry {
    pub name: String,
    pub description: String,
    pub enabled: bool,
}

pub struct PromptBuilder;

impl PromptBuilder {
    /// 拼装 system prompt
    ///
    /// 输出结构:
    /// ```text
    /// # 角色 (SOUL)
    /// <soul>
    ///
    /// # 行为规则 (RULES)
    /// <rules>
    ///
    /// # 能力 (Capabilities)
    /// <cap 列表>
    ///
    /// # 工具 (Tools)
    /// <工具描述 + JSON Schema>
    ///
    /// # 可用 Skills
    /// <skill 列表 (仅 enabled)>
    ///
    /// # Agent ID
    /// <agent_id>
    /// ```
    pub fn build(inputs: &PromptInputs) -> String {
        let mut out = String::new();

        out.push_str("# 角色 (SOUL)\n");
        out.push_str(inputs.soul);
        out.push_str("\n\n");

        if !inputs.rules.trim().is_empty() {
            out.push_str("# 行为规则 (RULES)\n");
            out.push_str(inputs.rules);
            out.push_str("\n\n");
        }

        out.push_str("# 能力 (Capabilities)\n");
        out.push_str("你拥有以下能力 (least-privilege):\n");
        for cap in inputs.capabilities {
            out.push_str(&format!("- {cap}\n"));
        }
        out.push('\n');

        out.push_str("# 工具 (Tools)\n");
        out.push_str("你可以通过工具调用以下系统能力. 严格按 JSON Schema 传参.\n");
        for t in inputs.tools {
            let write_tag = if t.is_write { " ⚠️ 写操作 (需用户审批)" } else { "" };
            out.push_str(&format!("\n## {}{}\n", t.name, write_tag));
            out.push_str(&t.description);
            out.push_str("\nSchema: ");
            out.push_str(&t.schema.to_string());
            out.push('\n');
        }
        out.push('\n');

        let enabled_skills: Vec<_> = inputs.skills.iter().filter(|s| s.enabled).collect();
        if !enabled_skills.is_empty() {
            out.push_str("# 可用 Skills\n");
            for s in enabled_skills {
                out.push_str(&format!("- {}: {}\n", s.name, s.description));
            }
            out.push('\n');
        }

        if !inputs.memory.is_empty() {
            out.push_str(inputs.memory);
            out.push('\n');
        }

        out.push_str("# 应用当前上下文\n");
        if let Some(page) = &inputs.app_context.current_page {
            out.push_str(&format!("当前页面: {page}\n"));
        }
        if let Some(student) = &inputs.app_context.selected_student {
            out.push_str(&format!("选中/关注学生: {student}\n"));
        }
        if let Some(setting) = &inputs.app_context.open_settings {
            out.push_str(&format!("当前设置项: {setting}\n"));
        }
        if inputs.app_context.current_page.is_none()
            && inputs.app_context.selected_student.is_none()
            && inputs.app_context.open_settings.is_none()
        {
            out.push_str("无额外上下文\n");
        }
        out.push('\n');

        out.push_str("# 当前 Agent\n");
        out.push_str(&format!("agent_id: {}\n", inputs.agent_id));

        out
    }

    /// 仅给前端调试用的纯文本导出 (无 Markdown)
    pub fn build_plain(inputs: &PromptInputs) -> String {
        // 与 build() 一样, 但不写 Markdown 标题, 用于 debug log
        let mut out = String::new();
        out.push_str("SOUL:\n");
        out.push_str(inputs.soul);
        out.push_str("\n\nRULES:\n");
        out.push_str(inputs.rules);
        out.push_str("\n\nCAPS: ");
        out.push_str(&json!(inputs.capabilities).to_string());
        out.push_str("\n\nTOOLS: ");
        let names: Vec<&str> = inputs.tools.iter().map(|t| t.name.as_str()).collect();
        out.push_str(&format!("[{}]", names.join(", ")));
        out
    }
}