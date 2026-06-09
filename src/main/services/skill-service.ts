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

class SkillService {
  private userSkillsDir: string
  private projectSkillsDir: string

  constructor() {
    // 用户级: ~/.education-advisor/skills/
    this.userSkillsDir = path.join(app.getPath('userData'), 'skills')
    // 项目级: resources/skills/ (打包后) 或项目根目录 skills/ (开发)
    this.projectSkillsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'skills')
      : path.join(__dirname, '..', '..', 'skills')

    console.log(`[SkillService] Initialized`)
    console.log(`[SkillService]   user dir:   ${this.userSkillsDir}`)
    console.log(`[SkillService]   project dir: ${this.projectSkillsDir}`)
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

    console.log(`[SkillService] Total: ${skills.length} skills`)
    return skills
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

          // 尝试解析 YAML frontmatter 获取 description
          const description = this.extractDescription(content)

          skills.push({ name, description, content, source, filePath })
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
            skills.push({
              name: entry.name,
              description: this.extractDescription(content),
              content,
              source,
              filePath: skillMd,
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

  /** 从 Markdown 内容中提取描述（YAML frontmatter 或首段文字） */
  private extractDescription(content: string): string {
    if (typeof content !== 'string' || content.length === 0) {
      return 'No description'
    }

    // 尝试 YAML frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (fmMatch) {
      const descMatch = fmMatch[1].match(/description:\s*(.+)/)
      if (descMatch) return descMatch[1].trim()
    }

    // 回退：取第一行非空非标题文字
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
