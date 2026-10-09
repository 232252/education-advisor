// =============================================================
// 把本次运行看得到的技能交给 dsh 的 skill 插件
//
// dsh 只接受小写短横线技能名，并且会扫描项目目录和用户主目录。
// 这里复制一份只含该角色技能的目录，改好名字和工具名，再用补丁
// 把 skill-filesystem 钉在这个目录上。技能原文仍留在 skills/。
// =============================================================

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { rewriteToolNames } from './tool-names'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const EAA_SKILL_PATCH_FILE = 'eaa-skills.cordis.patch.yml'

export interface DshSkillSource {
  name: string
  description: string
  content: string
}

export function toDshSkillName(name: string, used: Set<string>): string {
  const base = name
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

export function buildEaaSkillPatch(skillDir: string): string {
  const dir = skillDir.replace(/\\/g, '/')
  return stringify(
    [
      {
        id: 'skill-filesystem',
        config: {
          includeDefaultRoots: false,
          customSkillDirs: [dir],
          watch: false,
          dshHome: dir,
          agentsHome: dir,
        },
      },
    ],
    { lineWidth: 0 },
  )
}

export function ensureEaaSkillPatch(patchDir: string, skillDir: string): string {
  const patchPath = join(patchDir, EAA_SKILL_PATCH_FILE)
  writeFileSync(patchPath, buildEaaSkillPatch(skillDir), 'utf8')
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
  return content.slice(0, start) + `---\n${fm}\n---` + content.slice(start + match[0].length)
}
