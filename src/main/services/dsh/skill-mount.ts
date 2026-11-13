// =============================================================
// 把本次运行看得到的技能交给 dsh 的 skill 插件
//
// dsh 只接受小写短横线技能名。默认还会扫项目目录。
// 这里把角色技能写进 $DSH_HOME/skills/<角色>，补丁只扫这个目录和
// $DSH_HOME/skills 本身，这样 DSH 自己放在 skills 根上的技能还在，
// 项目目录和用户主目录不扫。
// =============================================================

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { pinyin } from 'pinyin-pro'
import { stringify } from 'yaml'
import { readInstalledRowConfig } from './hardening'
import { rewriteToolNames } from './tool-names'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const EAA_SKILL_PATCH_FILE = 'eaa-skills.cordis.patch.yml'

/**
 * 名字里的汉字转无声调拼音（逐字短横线），其余字符原样保留。
 * dsh 只认小写短横线名；中文角色/技能名直接清洗会退化成 skill-2 这类
 * 无语义序号，模型与教师都认不出是哪份技能。拼音保留语义且结果确定。
 */
function transliterate(name: string): string {
  if (!/[一-鿿]/.test(name)) return name
  return pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('-')
}

/**
 * DSH 能长期读到的技能目录：`$DSH_HOME/skills/<scope>`。
 * 不放系统临时目录。skill-filesystem 用 customSkillDirs 指到这里，
 * 不改 dshHome / agentsHome，避免把 AGENTS.md 的查找路径指走。
 */
export function dshVisibleSkillDir(home: string, scope: string): string {
  const safe =
    transliterate(scope)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  return join(home, 'skills', safe)
}

export interface DshSkillSource {
  name: string
  description: string
  content: string
}

export function toDshSkillName(name: string, used: Set<string>): string {
  const base = transliterate(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  let candidate = base && SKILL_NAME.test(base) ? base : 'skill'
  let n = 2
  while (used.has(candidate) || !SKILL_NAME.test(candidate)) {
    candidate = `${base && SKILL_NAME.test(base) ? base : 'skill'}-${n}`
    n += 1
  }
  used.add(candidate)
  return candidate
}

/** 写成 dsh 能发现的扁平 Markdown。工具名按这次挂载改写。 */
export function materializeDshSkills(opts: {
  destDir: string
  skills: readonly DshSkillSource[]
  toolNameMap: Readonly<Record<string, string>>
}): { dir: string; names: string[] } {
  rmSync(opts.destDir, { recursive: true, force: true })
  mkdirSync(opts.destDir, { recursive: true })
  const used = new Set<string>()
  const names: string[] = []
  for (const skill of opts.skills) {
    const dshName = toDshSkillName(skill.name, used)
    const withName = ensureFrontmatter(skill.content, dshName, skill.description)
    const rewritten = rewriteToolNames(withName, opts.toolNameMap)
    writeFileSync(join(opts.destDir, `${dshName}.md`), rewritten, 'utf8')
    names.push(dshName)
  }
  return { dir: opts.destDir, names }
}

/** 角色目录，以及它的上一级 skills 根（DSH 自己的技能放在这里）。 */
export function dshSkillScanDirs(skillDir: string): string[] {
  const role = skillDir.replace(/\\/g, '/')
  const parent = dirname(skillDir)
  if (basename(parent).toLowerCase() !== 'skills') return [role]
  const official = parent.replace(/\\/g, '/')
  return official === role ? [role] : [role, official]
}

export function buildEaaSkillPatch(skillDir: string, installed?: Record<string, unknown>): string {
  return stringify(
    [
      {
        id: 'skill-filesystem',
        config: {
          ...(installed ?? {}),
          includeDefaultRoots: false,
          customSkillDirs: dshSkillScanDirs(skillDir),
          watch: false,
        },
      },
    ],
    { lineWidth: 0 },
  )
}

export function ensureEaaSkillPatch(patchDir: string, skillDir: string, dshBin?: string): string {
  const patchPath = join(patchDir, EAA_SKILL_PATCH_FILE)
  const installed = readInstalledRowConfig(dshBin, '@deepseek-ai/dsh-base', 'skill-filesystem')
  writeFileSync(patchPath, buildEaaSkillPatch(skillDir, installed), 'utf8')
  return patchPath
}

export function removeDshSkillDir(dir: string | null | undefined): void {
  if (!dir) return
  rmSync(dir, { recursive: true, force: true })
}

function ensureFrontmatter(content: string, dshName: string, description: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const fallback = description.replace(/\s+/g, ' ').trim().slice(0, 200) || dshName
  if (!match) {
    return `---\nname: ${dshName}\ndescription: ${JSON.stringify(fallback)}\n---\n${content}`
  }
  let fm = match[1]
  if (/^name:\s*.+$/m.test(fm)) fm = fm.replace(/^name:\s*.+$/m, `name: ${dshName}`)
  else fm = `name: ${dshName}\n${fm}`
  if (!/^description:\s*\S+/m.test(fm)) fm = `${fm}\ndescription: ${JSON.stringify(fallback)}`
  const start = match.index ?? 0
  return `${content.slice(0, start)}---\n${fm}\n---${content.slice(start + match[0].length)}`
}
