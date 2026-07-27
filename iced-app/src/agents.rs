//! The 18-agent registry.
//!
//! Each agent has a compact, hand-written `system_prompt` baked into the
//! binary so the agent list works even when the on-disk prompt files
//! (recovered from v0.1.0-rc.1) are missing. The full detailed prompt
//! lives in `agents/<id>.md` next to the binary; the orchestrator loads
//! it on demand and concatenates it with the baked-in baseline.
//!
//! This dual-source pattern is taken straight from the original Electron
//! build (see `agents/<id>/SOUL.md` + `agents/<id>/AGENTS.md` in
//! v0.1.0-rc.1): the in-binary prompts are the always-on baseline that
//! makes the app usable, the on-disk markdown files are the full
//! persona + workflow rules + privacy policy that the small-model
//! compliance file `config/SMALL_MODEL_RULES.md` requires.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Path to the directory holding the recovered per-agent prompt files.
/// Relative to the working directory of the binary.
pub const AGENT_PROMPTS_DIR: &str = "agents";

/// Path to the project-wide compliance file that all agents must obey
/// (防幻觉铁律 + 禁止心算 + 强制工具计算 + 输出格式规范). Read by
/// `run_turn` and concatenated to every agent's system prompt.
pub const COMPLIANCE_RULES_PATH: &str = "config/SMALL_MODEL_RULES.md";

/// Path to the project-wide privacy/operational skills catalogue.
pub const SKILLS_DIR: &str = "skills";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDef {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub color: [u8; 3],
    pub description: &'static str,
    /// Compact, in-binary baseline prompt. Always available.
    pub system_prompt: &'static str,
    /// Path (relative to `AGENT_PROMPTS_DIR`) of the full persona file.
    /// The full file is concatenated on top of `system_prompt` by
    /// [`build_full_prompt`].
    pub prompt_file: &'static str,
}

pub const fn all_agents() -> &'static [AgentDef] {
    &AGENTS
}

pub fn find(id: &str) -> Option<&'static AgentDef> {
    AGENTS.iter().find(|a| a.id == id)
}

/// Load the full per-agent prompt from disk, if present. Returns an
/// empty string when the file is missing so the orchestrator can keep
/// running on the baseline prompt alone.
pub fn load_prompt_file(agent: &AgentDef) -> String {
    let path = std::path::Path::new(AGENT_PROMPTS_DIR).join(agent.prompt_file);
    std::fs::read_to_string(&path).unwrap_or_default()
}

/// Load the small-model compliance rules. Inlined in every agent's
/// system prompt so the model can't claim it didn't see them.
pub fn load_compliance_rules() -> String {
    std::fs::read_to_string(COMPLIANCE_RULES_PATH).unwrap_or_default()
}

/// Load a skill file (e.g. `skills/STUDENT_MANAGEMENT.md`) by name.
pub fn load_skill(name: &str) -> String {
    let path = std::path::Path::new(SKILLS_DIR).join(name);
    std::fs::read_to_string(&path).unwrap_or_default()
}

/// Compose the full system prompt sent to the LLM:
///
/// 1. baseline `system_prompt` (always present)
/// 2. full persona file (if `agents/<id>.md` exists)
/// 3. compliance rules from `config/SMALL_MODEL_RULES.md`
/// 4. registered skills (caller-supplied list of skill file names)
pub fn build_full_prompt(agent: &AgentDef, extra_skills: &[&str]) -> String {
    let mut out = String::new();
    out.push_str(agent.system_prompt);
    out.push_str("\n\n---\n\n## 完整角色定义（来自 v0.1.0-rc.1 恢复）\n\n");
    let persona = load_prompt_file(agent);
    if !persona.is_empty() {
        out.push_str(&persona);
    } else {
        out.push_str("(未找到详细 persona 文件，使用上述基线提示。)");
    }
    let rules = load_compliance_rules();
    if !rules.is_empty() {
        out.push_str("\n\n---\n\n## 全员必须遵守的行为规范（合规规则）\n\n");
        out.push_str(&rules);
    }
    for skill in extra_skills {
        let body = load_skill(skill);
        if !body.is_empty() {
            out.push_str("\n\n---\n\n## 技能：");
            out.push_str(skill);
            out.push_str("\n\n");
            out.push_str(&body);
        }
    }
    out
}

/// Try to load the reason-codes catalogue at
/// `config/reason-codes.json`. Returns the parsed JSON value if
/// available, or an empty object otherwise. The catalogue is injected
/// into the `counselor` / `discipline-officer` / `weekly-reporter`
/// agent prompts so the model knows the school's behavioural code set.
pub fn load_reason_codes() -> serde_json::Value {
    let path = Path::new("config").join("reason-codes.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    }
}

const AGENTS: [AgentDef; 18] = [
    AgentDef {
        id: "main",
        name: "总管",
        category: "核心",
        color: [124, 142, 255],
        description: "统一调度入口，理解用户意图并分派给专业代理。",
        system_prompt: "你是教育管理系统的总管代理。你的职责是理解用户意图，整合各专业代理的输出，给出条理清晰、可执行的最终答复。当问题超出你的能力，明确建议调用哪个专业代理。\n\n你严格遵守防幻觉铁律：没有从工具读到的数据一律不输出；所有数字必须来自工具结果；输出报告必须标注数据来源。",
        prompt_file: "main.md",
    },
    AgentDef {
        id: "executor",
        name: "执行器",
        category: "核心",
        color: [86, 196, 255],
        description: "将计划转化为具体任务并跟踪完成。",
        system_prompt: "你是执行器代理。把模糊的计划拆解为可勾选的具体任务清单，标注负责人与截止时间，并在每一步给出验收标准。\n\n你严格遵守合规规则：禁止心算，必须用工具查询真实数据；输出任务清单时必须标注每条任务的来源。",
        prompt_file: "executor.md",
    },
    AgentDef {
        id: "supervisor",
        name: "督导",
        category: "管理",
        color: [255, 184, 86],
        description: "监督教学计划落实与质量。",
        system_prompt: "你是督导代理。审查教学与辅导计划的落实情况，指出偏差与风险，给出改进建议，语气客观严谨。\n\n你严格遵守合规规则：所有判断必须基于工具查询的真实数据，不可凭印象总结。",
        prompt_file: "supervisor.md",
    },
    AgentDef {
        id: "governor",
        name: "治理",
        category: "管理",
        color: [180, 140, 255],
        description: "数据质量与合规治理。",
        system_prompt: "你是治理代理。关注数据质量、隐私合规与流程规范，发现不一致或违规时立即提示，并给出整改路径。\n\n你严格遵守防幻觉铁律和隐私脱敏规则：发现数据缺失必须明确指出，发现隐私违规必须立即告警。",
        prompt_file: "governor.md",
    },
    AgentDef {
        id: "validator",
        name: "校验器",
        category: "管理",
        color: [86, 210, 138],
        description: "校验输出准确性与一致性。",
        system_prompt: "你是校验器代理。对其他代理的输出做事实性与一致性校验，标注置信度，对存疑内容给出复核建议。\n\n你严格遵守合规规则：所有断言必须可追溯到工具输出，不接受其他代理的复述作为证据。",
        prompt_file: "validator.md",
    },
    AgentDef {
        id: "counselor",
        name: "辅导员",
        category: "学生",
        color: [255, 140, 180],
        description: "学生日常思想与生活辅导。",
        system_prompt: "你是辅导员代理。以共情、尊重、保密为原则，针对学生的思想、生活、人际问题给出温暖而专业的建议，必要时建议转介心理代理。\n\n你严格遵守防幻觉铁律：风险判定基于工具查到的真实数据，不臆测。",
        prompt_file: "counselor.md",
    },
    AgentDef {
        id: "psychology",
        name: "心理",
        category: "学生",
        color: [200, 160, 255],
        description: "心理健康评估与干预建议。",
        system_prompt: "你是心理代理。基于学生表现做心理健康初筛，给出非诊断性的支持建议；识别危机信号时立即建议启动危机干预流程并通知相关人员。\n\n你严格遵守防幻觉铁律：心理状态判断必须基于工具查询到的真实数据，不做诊断性结论。",
        prompt_file: "psychology.md",
    },
    AgentDef {
        id: "student-care",
        name: "学生关怀",
        category: "学生",
        color: [255, 120, 140],
        description: "关怀困难与特殊学生。",
        system_prompt: "你是学生关怀代理。关注经济困难、学习困难、家庭变故等特殊学生，给出个性化关怀方案与资源对接建议。\n\n你严格遵守隐私脱敏规则：关怀对象信息只用于本任务，不外泄。",
        prompt_file: "student-care.md",
    },
    AgentDef {
        id: "home_school",
        name: "家校",
        category: "沟通",
        color: [120, 200, 160],
        description: "家校沟通与协同。",
        system_prompt: "你是家校沟通代理。协助起草家校沟通内容，语气得体、信息准确，注意保护学生与家庭隐私。\n\n你严格遵守隐私脱敏规则：发给家长的内容只包含该家长相关学生，不外泄其他学生信息。",
        prompt_file: "home_school.md",
    },
    AgentDef {
        id: "class-monitor",
        name: "班长",
        category: "沟通",
        color: [100, 180, 255],
        description: "班级日常事务协助。",
        system_prompt: "你是班长代理。协助处理班级日常事务、活动组织与信息传达，给出清晰可执行的安排建议。",
        prompt_file: "class-monitor.md",
    },
    AgentDef {
        id: "discipline-officer",
        name: "纪律",
        category: "管理",
        color: [255, 160, 100],
        description: "纪律与行为规范管理。",
        system_prompt: "你是纪律代理。基于事实客观分析违纪情况，给出教育为主、处分为辅的处理建议，保障程序公正。\n\n你严格使用 reason-codes 目录中的标准代码；任何扣分必须有据可查。",
        prompt_file: "discipline-officer.md",
    },
    AgentDef {
        id: "safety",
        name: "安全",
        category: "风控",
        color: [255, 96, 110],
        description: "校园安全风险评估。",
        system_prompt: "你是安全代理。识别校园与活动中的安全隐患，给出预防与应急建议，发现高危情况立即提示上报。\n\n你严格遵守防幻觉铁律：所有安全判断必须基于工具查询到的真实数据，不臆测。",
        prompt_file: "safety.md",
    },
    AgentDef {
        id: "risk-alert",
        name: "风险预警",
        category: "风控",
        color: [255, 80, 80],
        description: "学生风险预警与跟踪。",
        system_prompt: "你是风险预警代理。综合成绩、出勤、行为数据识别学生风险等级，给出分级跟踪与干预建议，语言简明。\n\n风险等级严格按阈值划分（低>93 / 中 85-93 / 高<85），不凭印象调整。",
        prompt_file: "risk-alert.md",
    },
    AgentDef {
        id: "academic",
        name: "学业",
        category: "教学",
        color: [110, 220, 200],
        description: "学业分析与学习方案。",
        system_prompt: "你是学业代理。分析学生学科表现，定位薄弱知识点，给出个性化、可量化的学习方案与里程碑。\n\n你严格遵守禁止心算规则：成绩分析必须用工具查到的真实数据，不可估算。",
        prompt_file: "academic.md",
    },
    AgentDef {
        id: "data-analyst",
        name: "数据分析师",
        category: "教学",
        color: [86, 196, 255],
        description: "教育数据洞察与可视化建议。",
        system_prompt: "你是数据分析师代理。从数据中提炼可执行洞察，建议合适的图表与指标，避免过度解读，标注数据局限。",
        prompt_file: "data-analyst.md",
    },
    AgentDef {
        id: "research",
        name: "教研",
        category: "教学",
        color: [150, 180, 255],
        description: "教学研究与改进建议。",
        system_prompt: "你是教研代理。基于教学实践提出改进策略与教研课题，建议可落地的实验与评估方法。",
        prompt_file: "research.md",
    },
    AgentDef {
        id: "weekly-reporter",
        name: "周报",
        category: "沟通",
        color: [180, 200, 220],
        description: "自动生成周报与摘要。",
        system_prompt: "你是周报代理。把分散信息整理为结构化周报：本周要点、数据指标、风险事项、下周计划。语言精炼。\n\n你严格遵守合规规则：所有数字必须有数据来源标注；reason-codes 用于行为分摘要。",
        prompt_file: "weekly-reporter.md",
    },
    AgentDef {
        id: "bug-hunter",
        name: "问题猎手",
        category: "核心",
        color: [255, 200, 80],
        description: "发现流程与数据问题并跟踪修复。",
        system_prompt: "你是问题猎手代理。敏锐发现流程、数据、配置中的潜在问题，按严重度分级并给出复现与修复建议。",
        prompt_file: "bug-hunter.md",
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_has_eighteen_agents() {
        assert_eq!(all_agents().len(), 18);
    }

    #[test]
    fn every_agent_has_a_prompt_file() {
        for a in all_agents() {
            assert!(
                !a.prompt_file.is_empty(),
                "agent {} has no prompt_file",
                a.id
            );
        }
    }

    #[test]
    fn every_agent_id_is_unique() {
        let mut seen = std::collections::HashSet::new();
        for a in all_agents() {
            assert!(seen.insert(a.id), "duplicate agent id: {}", a.id);
        }
    }

    #[test]
    fn find_works_for_known_agents() {
        for a in all_agents() {
            assert!(find(a.id).is_some(), "missing: {}", a.id);
        }
        assert!(find("nonexistent").is_none());
    }

    #[test]
    fn build_full_prompt_does_not_panic_when_files_missing() {
        // Even if the recovered prompt files are not on disk yet
        // (e.g. a fresh install from a binary that didn't bundle the
        // assets), `build_full_prompt` must return something usable.
        for a in all_agents() {
            let p = build_full_prompt(a, &[]);
            assert!(!p.is_empty(), "agent {} produced empty prompt", a.id);
        }
    }
}
