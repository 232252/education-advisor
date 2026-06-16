// =============================================================
// Skill Service — 技能发现与加载
// 技术方向：SKILL.md 标准，兼容 Pi 和 EAA 的技能目录
//
// 错误回退策略 (P2-15):
// - 单个 skill 文件损坏/读取失败 → 跳过该文件 + 记录日志,不影响整体
// - 单个目录扫描失败 → 返回空数组 + 记录日志,不影响其他目录
// - save/delete 失败 → 返回 { success: false, error },不抛异常
// - 加载时输出进度日志,便于排查
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { Skill } from '../../shared/types'

/** P7: 用户对 skill 的启用/禁用状态(覆盖文件系统的 frontmatter) */
type SkillEnabledState = Record<string, boolean>

/** P7: frontmatter 解析的辅助字段 */
interface ParsedFrontmatter {
  description: string
  enabled: boolean | undefined
  triggers: string[]
}

class SkillService {
  private userSkillsDir: string
  private projectSkillsDir: string
  /** P7: skills-state.json 路径(用户启用状态) */
  private stateFilePath: string
  /** P7: 缓存的 enabled 状态,避免每次 list 都读盘 */
  private enabledState: SkillEnabledState = {}

  constructor() {
    // 用户级: ~/.education-advisor/skills/
    this.userSkillsDir = path.join(app.getPath('userData'), 'skills')
    // 项目级: resources/skills/ (打包后) 或项目根目录 skills/ (开发)
    this.projectSkillsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'skills')
      : path.join(__dirname, '..', '..', 'skills')
    // P7: 用户级启用状态(与 skills 文件同级目录)
    this.stateFilePath = path.join(app.getPath('userData'), 'skills-state.json')

    console.log(`[SkillService] Initialized`)
    console.log(`[SkillService]   user dir:    ${this.userSkillsDir}`)
    console.log(`[SkillService]   project dir: ${this.projectSkillsDir}`)
    console.log(`[SkillService]   state file:  ${this.stateFilePath}`)

    this.loadEnabledState()
  }

  /** 扫描并列出所有技能 */
  listSkills(): Skill[] {
    const skills: Skill[] = []

    // 扫描用户级技能 (单个目录失败不影响另一个)
    try {
      const userSkills = this.scanDir(this.userSkillsDir, 'user')
      skills.push(...userSkills)
      console.log(
        `[SkillService] Loaded ${userSkills.length} user skills from ${this.userSkillsDir}`,
      )
    } catch (err) {
      console.error(`[SkillService] Failed to scan user skills dir ${this.userSkillsDir}:`, err)
    }

    // 扫描项目级技能
    try {
      const projectSkills = this.scanDir(this.projectSkillsDir, 'project')
      skills.push(...projectSkills)
      console.log(
        `[SkillService] Loaded ${projectSkills.length} project skills from ${this.projectSkillsDir}`,
      )
    } catch (err) {
      console.error(
        `[SkillService] Failed to scan project skills dir ${this.projectSkillsDir}:`,
        err,
      )
    }

    // P7: 套用用户启/禁状态 + 解析 frontmatter
    for (const s of skills) {
      // 优先: 用户显式 state; 次之: 文件 frontmatter; 再次: 默认 true
      const stateOverride = this.enabledState[s.name]
      if (stateOverride !== undefined) {
        s.enabled = stateOverride
      } else {
        s.enabled = (s as Skill & { _frontmatterEnabled?: boolean })._frontmatterEnabled ?? true
      }
    }

    console.log(`[SkillService] Total: ${skills.length} skills`)
    return skills
  }

  // ---- P7: 启用/禁用状态管理 ----

  /**
   * 设置 skill 启用/禁用,持久化到 skills-state.json
   * - 该文件覆盖文件系统的 frontmatter(用户对用户级和项目级都生效)
   * - 返回 { success } 结构,失败时不抛
   */
  setSkillEnabled(name: string, enabled: boolean): { success: boolean; error?: string } {
    try {
      if (!name || typeof name !== 'string') {
        return { success: false, error: 'Invalid skill name' }
      }
      // 验证 skill 存在
      const skill = this.getSkill(name)
      if (!skill) {
        return { success: false, error: `Skill not found: ${name}` }
      }
      this.enabledState[name] = enabled
      this.saveEnabledState()
      console.log(`[SkillService] setSkillEnabled(${name}, ${enabled})`)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[SkillService] setSkillEnabled failed for ${name}:`, err)
      return { success: false, error: msg }
    }
  }

  /** 从 skills-state.json 加载 */
  private loadEnabledState(): void {
    try {
      if (!fs.existsSync(this.stateFilePath)) {
        this.enabledState = {}
        return
      }
      const raw = fs.readFileSync(this.stateFilePath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: SkillEnabledState = {}
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'boolean') out[k] = v
        }
        this.enabledState = out
        console.log(`[SkillService] Loaded ${Object.keys(out).length} enabled states`)
      } else {
        console.warn(`[SkillService] skills-state.json is not an object, ignoring`)
        this.enabledState = {}
      }
    } catch (err) {
      console.error(`[SkillService] Failed to load skills-state.json:`, err)
      this.enabledState = {}
    }
  }

  /** 持久化到 skills-state.json */
  private saveEnabledState(): void {
    try {
      fs.mkdirSync(path.dirname(this.stateFilePath), { recursive: true })
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.enabledState, null, 2), 'utf-8')
    } catch (err) {
      console.error(`[SkillService] Failed to save skills-state.json:`, err)
    }
  }

  /** 读取指定技能内容 */
  getSkill(name: string): Skill | null {
    try {
      const skills = this.listSkills()
      return skills.find((s) => s.name === name) ?? null
    } catch (err) {
      console.error(`[SkillService] Failed to get skill ${name}:`, err)
      return null
    }
  }

  /**
   * P3: 按 skillIds 白名单过滤该 Agent 可用的 skills
   *
   * @param skillIds undefined 或 null → 返回全部 skills(向后兼容)
   *                  [] (空数组)      → 返回空数组(明确不绑定任何 skill)
   *                  ['a', 'b']        → 只返回 name 匹配的元素
   * @returns 过滤后的 Skill 数组(保持 listSkills 顺序)
   */
  getSkillsForAgent(skillIds: string[] | undefined | null): Skill[] {
    const all = this.listSkills()
    // P7: 过滤已禁用的 skill — agent 永远不应该使用禁用的 skill
    const enabled = all.filter((s) => s.enabled)
    if (skillIds === undefined || skillIds === null) {
      return enabled
    }
    if (skillIds.length === 0) {
      return []
    }
    const idSet = new Set(skillIds)
    const matched = enabled.filter((s) => idSet.has(s.name))
    // 保留 yaml 声明的顺序,而非扫描顺序 — 用户配置优先
    const ordered: Skill[] = []
    for (const id of skillIds) {
      const skill = matched.find((s) => s.name === id)
      if (skill) ordered.push(skill)
    }
    return ordered
  }

  /** 保存技能（写入用户级目录） */
  saveSkill(name: string, content: string): { success: boolean; error?: string } {
    try {
      if (!name || typeof name !== 'string' || /[/\\:*?"<>|]/.test(name)) {
        return { success: false, error: 'Invalid skill name (contains reserved characters)' }
      }
      if (typeof content !== 'string') {
        return { success: false, error: 'Invalid content (must be a string)' }
      }
      fs.mkdirSync(this.userSkillsDir, { recursive: true })
      const filePath = path.join(this.userSkillsDir, `${name}.md`)
      fs.writeFileSync(filePath, content, 'utf-8')
      console.log(`[SkillService] Saved skill: ${name}`)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[SkillService] Failed to save skill ${name}:`, err)
      return { success: false, error: msg }
    }
  }

  /** 删除技能（仅允许删除用户级） */
  deleteSkill(name: string): { success: boolean; error?: string } {
    try {
      if (!name || typeof name !== 'string' || /[/\\:*?"<>|]/.test(name)) {
        return { success: false, error: 'Invalid skill name (contains reserved characters)' }
      }
      const filePath = path.join(this.userSkillsDir, `${name}.md`)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        console.log(`[SkillService] Deleted skill: ${name}`)
        return { success: true }
      }
      return { success: false, error: 'Skill not found or is project-level (read-only)' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[SkillService] Failed to delete skill ${name}:`, err)
      return { success: false, error: msg }
    }
  }

  /** 扫描目录中的 .md 技能文件 — 单个文件失败不影响其他 */
  private scanDir(dir: string, source: 'user' | 'project'): Skill[] {
    let entries: fs.Dirent[]
    try {
      if (!fs.existsSync(dir)) return []
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      console.error(`[SkillService] Failed to readdir ${dir}:`, err)
      return []
    }

    const skills: Skill[] = []
    let skipped = 0

    for (const entry of entries) {
      try {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = path.join(dir, entry.name)
          const content = this.safeReadFile(filePath)
          if (content === null) {
            skipped++
            continue
          }
          const name = entry.name.replace(/\.md$/, '')

          // P7: 解析 frontmatter (description / enabled / triggers)
          const fm = this.parseFrontmatter(content)

          skills.push({
            name,
            description: fm.description,
            content,
            source,
            filePath,
            enabled: true, // 先填占位,后被 listSkills 套用真实状态
            triggers: fm.triggers,
            // 内部字段:用于 listSkills 判断"用户未显式设置时"是否启用
            ...({ _frontmatterEnabled: fm.enabled } as object),
          })
        }

        // 子目录中有 SKILL.md 的也算一个技能
        if (entry.isDirectory()) {
          const skillMd = path.join(dir, entry.name, 'SKILL.md')
          if (fs.existsSync(skillMd)) {
            const content = this.safeReadFile(skillMd)
            if (content === null) {
              skipped++
              continue
            }
            const fm = this.parseFrontmatter(content)
            skills.push({
              name: entry.name,
              description: fm.description,
              content,
              source,
              filePath: skillMd,
              enabled: true,
              triggers: fm.triggers,
              ...({ _frontmatterEnabled: fm.enabled } as object),
            })
          }
        }
      } catch (err) {
        // 单个 entry 失败不影响其他 entry
        console.error(`[SkillService] Failed to process ${entry.name} in ${dir}:`, err)
        skipped++
      }
    }

    if (skipped > 0) {
      console.warn(`[SkillService] Skipped ${skipped} invalid entries in ${dir}`)
    }

    return skills
  }

  /** 安全读取文件 — 失败返回 null 而不是抛异常 */
  private safeReadFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch (err) {
      console.error(`[SkillService] Failed to read ${filePath}:`, err)
      return null
    }
  }

  /** P7: 解析 Markdown frontmatter,返回 description / enabled / triggers */
  private parseFrontmatter(content: string): ParsedFrontmatter {
    const fallback: ParsedFrontmatter = {
      description: this.fallbackDescription(content),
      enabled: undefined,
      triggers: [],
    }
    if (typeof content !== 'string' || content.length === 0) {
      return fallback
    }
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (!fmMatch) return fallback

    const body = fmMatch[1]
    let description = fallback.description
    let enabled: boolean | undefined
    const triggers: string[] = []

    for (const raw of body.split('\n')) {
      const line = raw.trimEnd()
      if (!line) continue
      // description
      const descMatch = line.match(/^description:\s*(.*)$/)
      if (descMatch) {
        const val = descMatch[1].trim()
        if (val) description = val
        continue
      }
      // enabled: true / false
      const enabledMatch = line.match(/^enabled:\s*(.+)$/i)
      if (enabledMatch) {
        const v = enabledMatch[1].trim().toLowerCase()
        if (v === 'true' || v === 'yes' || v === 'on') enabled = true
        else if (v === 'false' || v === 'no' || v === 'off') enabled = false
        continue
      }
      // triggers: 接受 YAML 列表(- 关键字)或逗号分隔字符串
      const triggersListMatch = line.match(/^triggers:\s*(.*)$/i)
      if (triggersListMatch) {
        const inline = triggersListMatch[1].trim()
        if (inline.startsWith('[') && inline.endsWith(']')) {
          // 简化版:仅识别带引号的字符串
          for (const m of inline.matchAll(/"([^"]+)"|'([^']+)'/g)) {
            const token = m[1] ?? m[2]
            if (token) triggers.push(token)
          }
        } else if (inline) {
          triggers.push(
            ...inline
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      }
    }

    // 处理 triggers 的列表项(- xxx)
    if (triggers.length === 0) {
      const items = body.match(/^\s*-\s+(.+)$/gm) ?? []
      for (const it of items) {
        const m = it.match(/^\s*-\s+(.+)$/)
        if (m) triggers.push(m[1].trim().replace(/^["']|["']$/g, ''))
      }
    }

    return { description, enabled, triggers }
  }

  /** 回退描述:首段非空文字 */
  private fallbackDescription(content: string): string {
    if (typeof content !== 'string' || content.length === 0) return 'No description'
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
        return trimmed.slice(0, 200)
      }
    }
    return 'No description'
  }
}

export const skillService = new SkillService()
