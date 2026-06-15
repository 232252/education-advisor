//! Agent 工具调用层 — 重写自 `src/main/services/eaa-tools.ts` (1318 行) +
//! `file-tools.ts` + `utility-tools.ts`。
//!
//! 当 LLM 返回 ToolCall 时, agent loop 在这里查找对应 capability 的 tool 实现,
//! 校验参数 (防 shell 注入/路径穿越), 调 eaa_core 写数据, 返回结构化结果。

pub mod data_cache;
pub mod eaa_tools;
pub mod file_tools;
pub mod utility;
