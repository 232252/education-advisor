// =============================================================
// SOUL.md / AGENTS.md 提示词文件读写
// （从 agent-service.ts 抽出，纯重构零行为变化）
// =============================================================

import fs from 'node:fs'
import path from 'node:path'

/** 校验 agent id，防止 path traversal（允许小写字母、数字、连字符、下划线） */
export function validateAgentId(id: string): string {
  if (!/^[a-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid agent id: ${JSON.stringify(id)}`)
  }
  // 双保险：即便正则通过，也用 basename 去掉任何潜在的分隔符
  return path.basename(id)
}

/** 读取 agent 提示词文件，不存在返回空串 */
function readPromptFile(agentsDir: string, id: string, filename: string): string {
  const safeId = validateAgentId(id)
  const filePath = path.join(agentsDir, safeId, filename)
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
}

/** 写入 agent 提示词文件（自动创建目录） */
function writePromptFile(
  agentsDir: string,
  id: string,
  filename: string,
  content: string,
): { success: boolean } {
  const safeId = validateAgentId(id)
  const filePath = path.join(agentsDir, safeId, filename)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
  return { success: true }
}

export function loadSoul(agentsDir: string, id: string): string {
  return readPromptFile(agentsDir, id, 'SOUL.md')
}

export function saveSoul(agentsDir: string, id: string, content: string): { success: boolean } {
  return writePromptFile(agentsDir, id, 'SOUL.md', content)
}

/**
 * 读取全角色公共规则(agents/_shared/rules.md),由 execution.ts 统一注入
 * system prompt,消除 18 份 AGENTS.md 中逐字复制的公共段。
 */
export function loadSharedRules(agentsDir: string): string {
  const filePath = path.join(agentsDir, '_shared', 'rules.md')
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
}

export function loadRules(agentsDir: string, id: string): string {
  return readPromptFile(agentsDir, id, 'AGENTS.md')
}

export function saveRules(agentsDir: string, id: string, content: string): { success: boolean } {
  return writePromptFile(agentsDir, id, 'AGENTS.md', content)
}
