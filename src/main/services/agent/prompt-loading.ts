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

/**
 * 提示词文件缓存(mtime 签名): 每次 agent 运行都要读 SOUL/AGENTS/rules/project-context
 * 共 8 次同步 fs,内容几乎从不变 — 命中时只付 1 次 statSync,编辑保存后 mtime 变化自动失效。
 * (与 skill-service 的 dirSignature 缓存同思路)
 */
const promptCache = new Map<string, { mtimeMs: number; content: string }>()

function readWithCache(filePath: string): string {
  try {
    const stat = fs.statSync(filePath)
    const cached = promptCache.get(filePath)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.content
    const content = fs.readFileSync(filePath, 'utf-8')
    promptCache.set(filePath, { mtimeMs: stat.mtimeMs, content })
    return content
  } catch {
    // 文件不存在等价于旧 existsSync 分支的空串
    return ''
  }
}

/** 读取 agent 提示词文件，不存在返回空串 */
function readPromptFile(agentsDir: string, id: string, filename: string): string {
  const safeId = validateAgentId(id)
  return readWithCache(path.join(agentsDir, safeId, filename))
}

/** 写入 agent 提示词文件（自动创建目录;写后显式刷新缓存,防同毫秒 mtime 不变导致旧值） */
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
  try {
    promptCache.set(filePath, { mtimeMs: fs.statSync(filePath).mtimeMs, content })
  } catch {
    promptCache.delete(filePath)
  }
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
  return readWithCache(path.join(agentsDir, '_shared', 'rules.md'))
}

/**
 * 读取项目级背景知识(agents/_shared/project-context.md) — 让每个 Agent
 * 都知道"自己运行在什么系统里": 核心业务概念(操行分/事件/原因码/风险分级)、
 * Agent 体系分工、数据与工具约定。此前 AI 对项目的认知只有角色人格,
 * README/PROJECT_INTRO 等文档从不进入 prompt。
 */
export function loadProjectContext(agentsDir: string): string {
  return readWithCache(path.join(agentsDir, '_shared', 'project-context.md'))
}

export function loadRules(agentsDir: string, id: string): string {
  return readPromptFile(agentsDir, id, 'AGENTS.md')
}

export function saveRules(agentsDir: string, id: string, content: string): { success: boolean } {
  return writePromptFile(agentsDir, id, 'AGENTS.md', content)
}
