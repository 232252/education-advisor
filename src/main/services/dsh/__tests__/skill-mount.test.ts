import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  buildEaaSkillPatch,
  dshSkillScanDirs,
  dshVisibleSkillDir,
  materializeDshSkills,
  toDshSkillName,
} from '../skill-mount'

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
    expect(rows[0].config.customSkillDirs).toEqual(['C:/skills/run', 'C:/skills'])
    expect(rows[0].config).not.toHaveProperty('dshHome')
    expect(rows[0].config).not.toHaveProperty('agentsHome')
  })

  it('已安装的技能配置字段留下，扫描范围仍钉在这次的目录', () => {
    const rows = parse(
      buildEaaSkillPatch('C:/skills/run', { providerName: 'filesystem' }),
    ) as Array<{
      config: { providerName: string; includeDefaultRoots: boolean; customSkillDirs: string[] }
    }>
    expect(rows[0]?.config.providerName).toBe('filesystem')
    expect(rows[0]?.config.includeDefaultRoots).toBe(false)
    expect(rows[0]?.config.customSkillDirs).toEqual(['C:/skills/run', 'C:/skills'])
    expect(dshSkillScanDirs('C:/tmp/run')).toEqual(['C:/tmp/run'])
  })

  it('技能落在 DSH_HOME/skills 下，不进临时目录', () => {
    expect(dshVisibleSkillDir('C:/dsh-home', 'main')).toBe(join('C:/dsh-home', 'skills', 'main'))
    expect(dshVisibleSkillDir('C:/dsh-home', '周报助手')).toBe(
      join('C:/dsh-home', 'skills', 'zhou-bao-zhu-shou'),
    )
  })

  it('中文技能名转成拼音短横线名，重名才加序号', () => {
    const used = new Set<string>()
    expect(toDshSkillName('周报', used)).toBe('zhou-bao')
    expect(toDshSkillName('周报', used)).toBe('zhou-bao-2')
    expect(toDshSkillName('学生操行管理', used)).toBe('xue-sheng-cao-xing-guan-li')
  })

  it('拼音后仍不合法的名字才退回 skill 序号', () => {
    const used = new Set<string>()
    expect(toDshSkillName('①②③', used)).toBe('skill')
    expect(toDshSkillName('①②③', used)).toBe('skill-2')
  })
})
