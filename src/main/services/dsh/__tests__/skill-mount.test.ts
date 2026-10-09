import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { buildEaaSkillPatch, materializeDshSkills, toDshSkillName } from '../skill-mount'

describe('dsh 技能目录', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('大写技能名改成 dsh 能加载的短横线，工具名按这次挂载改写', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-skills-'))
    const mounted = materializeDshSkills({
      destDir: join(dir, 'visible'),
      skills: [
        {
          name: 'STUDENT_MANAGEMENT',
          description: '操行手册',
          content:
            '---\nname: STUDENT_MANAGEMENT\ndescription: 何时用 eaa_score\ntools: [eaa_score, eaa_list_students]\n---\n先调用 eaa_score。',
        },
      ],
      toolNameMap: {
        eaa_score: 'mcp__eaa__eaa_score',
        eaa_list_students: 'mcp__roster__eaa_list_students',
      },
    })
    expect(mounted.names).toEqual(['student-management'])
    const text = await readFile(join(mounted.dir, 'student-management.md'), 'utf8')
    expect(text).toContain('name: student-management')
    expect(text).toContain('mcp__eaa__eaa_score')
    expect(text).toContain('mcp__roster__eaa_list_students')
    expect(text).not.toContain('调用 eaa_score')
  })

  it('补丁只扫描这次的目录，不扫用户主目录', () => {
    const rows = parse(buildEaaSkillPatch('C:/skills/run')) as Array<{
      id: string
      config: { includeDefaultRoots: boolean; customSkillDirs: string[]; watch: boolean }
    }>
    expect(rows[0].id).toBe('skill-filesystem')
    expect(rows[0].config.includeDefaultRoots).toBe(false)
    expect(rows[0].config.watch).toBe(false)
    expect(rows[0].config.customSkillDirs).toEqual(['C:/skills/run'])
  })

  it('中文技能名也能落到合法名字上', () => {
    const used = new Set<string>()
    expect(toDshSkillName('周报', used)).toBe('skill')
    expect(toDshSkillName('周报', used)).toBe('skill-2')
  })
})
