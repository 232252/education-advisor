// =============================================================
// Memory Service — Agent 持久化记忆
// 目标: 让 Agent 拥有跨会话记忆 — 用户偏好、重要结论、班级关键事实
// 在运行时沉淀(save_memory 工具),在下次运行时自动注入 system prompt。
//
// 存储: 每 agent 一个 JSON 文件
//   开发模式: .app-data/memory/<agentId>.json(与 skill-service 同模式,
//             避免开发环境写 %APPDATA%)
//   打包模式: userData/memory/<agentId>.json
//
// 错误策略(与 skill-service 一致):
//   - 读取失败 → 返回空记忆(不影响 agent 运行)
//   - 写入失败 → { success: false, error },不抛异常
//   - 原子写: tmp + rename,防止进程退出截断 JSON
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { getAppPaths } from '../paths'

/** 单条记忆 */
export interface MemoryEntry {
  id: string
  content: string
  category: string
  createdAt: number
}

interface MemoryFile {
  version: 1
  entries: MemoryEntry[]
}

/** 注入约束: 条数/单条长度/总长度上限(控制 token 成本) */
const MAX_ENTRIES_INJECTED = 30
const MAX_ENTRY_CHARS_INJECTED = 200
const MAX_SECTION_CHARS = 4000
/** 存储上限: 单 agent 最多保留条数(超出丢弃最旧) */
const MAX_ENTRIES_STORED = 100
const MAX_CONTENT_CHARS_STORED = 500

function resolveMemoryDir(): string {
  // R2-17: 统一经 path-resolver(dev:.app-data/memory / prod:userData/memory)
  return getAppPaths().memoryDir
}

export class MemoryService {
  private readonly memoryDir: string

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir ?? resolveMemoryDir()
  }

  /** 供测试/诊断 */
  get dir(): string {
    return this.memoryDir
  }

  private filePathFor(agentId: string): string {
    // agentId 已由上层 validateAgentId 校验;此处再防御一次路径分隔符
    if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      throw new Error(`Invalid agent id: ${agentId}`)
    }
    return path.join(this.memoryDir, `${agentId}.json`)
  }

  private readMemoryFile(agentId: string): MemoryFile {
    try {
      const filePath = this.filePathFor(agentId)
      if (!fs.existsSync(filePath)) return { version: 1, entries: [] }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<MemoryFile>
      if (!parsed || !Array.isArray(parsed.entries)) return { version: 1, entries: [] }
      // 防御单条畸形: 只保留结构完整的条目
      const entries = parsed.entries.filter(
        (e) => e && typeof e.id === 'string' && typeof e.content === 'string',
      )
      return { version: 1, entries }
    } catch (err) {
      console.warn(`[MemoryService] Failed to read memory for ${agentId}:`, err)
      return { version: 1, entries: [] }
    }
  }

  private writeMemoryFile(agentId: string, file: MemoryFile): void {
    fs.mkdirSync(this.memoryDir, { recursive: true })
    const filePath = this.filePathFor(agentId)
    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  }

  /** 列出全部记忆(按时间升序) */
  listEntries(agentId: string): MemoryEntry[] {
    return this.readMemoryFile(agentId).entries
  }

  /** 列出所有 agent 的记忆(记忆管理入口用;无记忆文件的 agent 不出现) */
  listAllEntries(): Array<{ agentId: string; entries: MemoryEntry[] }> {
    try {
      const files = fs.readdirSync(this.memoryDir).filter((f) => f.endsWith('.json'))
      const result: Array<{ agentId: string; entries: MemoryEntry[] }> = []
      for (const f of files) {
        const agentId = f.replace(/\.json$/, '')
        if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) continue
        const entries = this.readMemoryFile(agentId).entries
        if (entries.length > 0) result.push({ agentId, entries })
      }
      return result
    } catch {
      return []
    }
  }

  /**
   * 追加一条记忆。返回新增条目;content 超 500 字符截断,超出存储上限时丢弃最旧。
   */
  addEntry(agentId: string, content: string, category = 'general'): MemoryEntry {
    const trimmed = content.trim().slice(0, MAX_CONTENT_CHARS_STORED)
    if (!trimmed) throw new Error('记忆内容不能为空')
    const safeCategory = category.trim().slice(0, 32) || 'general'
    const file = this.readMemoryFile(agentId)
    const entry: MemoryEntry = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: trimmed,
      category: safeCategory,
      createdAt: Date.now(),
    }
    file.entries.push(entry)
    if (file.entries.length > MAX_ENTRIES_STORED) {
      file.entries.splice(0, file.entries.length - MAX_ENTRIES_STORED)
    }
    this.writeMemoryFile(agentId, file)
    console.log(`[MemoryService] Saved memory for ${agentId} (${file.entries.length} entries)`)
    return entry
  }

  /** 删除指定条目(未找到返回 false) */
  deleteEntry(agentId: string, entryId: string): boolean {
    const file = this.readMemoryFile(agentId)
    const idx = file.entries.findIndex((e) => e.id === entryId)
    if (idx === -1) return false
    file.entries.splice(idx, 1)
    this.writeMemoryFile(agentId, file)
    return true
  }

  /** 清空某 agent 的全部记忆 */
  clear(agentId: string): void {
    this.writeMemoryFile(agentId, { version: 1, entries: [] })
  }

  /**
   * 生成注入 system prompt 的记忆段落(空记忆返回 '')。
   * 只取最近 MAX_ENTRIES_INJECTED 条,单条截断,整段封顶 — 控制 token 成本。
   */
  getMemorySection(agentId: string): string {
    const entries = this.readMemoryFile(agentId).entries
    if (entries.length === 0) return ''

    const recent = entries.slice(-MAX_ENTRIES_INJECTED)
    const lines: string[] = []
    let total = 0
    for (const e of recent) {
      const date = new Date(e.createdAt).toISOString().slice(0, 10)
      const content = e.content.slice(0, MAX_ENTRY_CHARS_INJECTED)
      const line = `- [${date}][${e.category}] ${content}`
      if (total + line.length > MAX_SECTION_CHARS) break
      lines.push(line)
      total += line.length
    }
    if (lines.length === 0) return ''

    return (
      `\n--- 长期记忆 ---\n` +
      `以下是你(${agentId})在与用户的历次交互中沉淀的记忆,已自动加载。` +
      `其中"用户偏好"类内容直接影响你本次的行事方式;事实类内容如与工具查询结果冲突,以工具实时结果为准。\n` +
      lines.join('\n')
    )
  }
}

export const memoryService = new MemoryService()
