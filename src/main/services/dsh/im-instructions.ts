// =============================================================
// 连接中心里那个 dsh web 进程的工作说明
//
// dsh 没有把 system 角色交给 session/prompt。web profile 靠
// $DSH_HOME/AGENTS.md 把说明交给模型。教师对话里拼出来的那一份
// 在这里重写工具名：mcp-client 注册出来的名字带 mcp__ 前缀。
// =============================================================

import type { SystemPromptInput } from '../agent/system-prompt'
import { buildSystemPrompt } from '../agent/system-prompt'
import { rewriteToolNames } from './tool-names'

const IM_APPENDIX = `
--- 即时消息 ---
你会在飞书、微信、企微、钉钉、QQ 这些渠道里直接回答。对面就是教师，按教师对话的同一套规则办事。
这个进程没有命令行。查操行、改档案、读写教师指定的文件，都用当前可用的工具，不要假设自己能跑 bash。
录入、撤销、导入、发布、删除之前，先用文字复述学生、事项和分值。教师明确同意后，再把工具要求的 confirm 设为 true。不要用加分去抵消已经记错的扣分。
`

/** 主协调的系统提示，工具名已换成这个挂载里模型真正能调用的名字。 */
export function composeImInstructions(
  input: SystemPromptInput,
  toolNameMap: Readonly<Record<string, string>>,
): string {
  return `${rewriteToolNames(buildSystemPrompt(input), toolNameMap).trim()}\n${IM_APPENDIX}`
}
