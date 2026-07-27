// =============================================================
// Skill Service 补充 — 名称校验 / 描述解析 / 损坏文件容错
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = path.join(
  os.tmpdir(),
  `skill-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return tmpDir
    throw new Error(`Unexpected path: ${name}`)
  }),
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

const { skillService } = await import('../../src/main/services/skill-service')

describe('skillService — saveSkill 名称校验', () => {
  beforeAll(async () => {
    await fsp.mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })

  it('含 / 的名称应被拒', () => {
    expect(skillService.saveSkill('a/b', '# x').success).toBe(false)
  })

  it('含 \\ 的名称应被拒', () => {
    expect(skillService.saveSkill('a\\b', '# x').success).toBe(false)
  })

  it('含 : 的名称应被拒', () => {
    expect(skillService.saveSkill('a:b', '# x').success).toBe(false)
  })

  it('含 * 的名称应被拒', () => {
    expect(skillService.saveSkill('a*b', '# x').success).toBe(false)
  })

  it('含 ? 的名称应被拒', () => {
    expect(skillService.saveSkill('a?b', '# x').success).toBe(false)
  })

  it('含 " 的名称应被拒', () => {
    expect(skillService.saveSkill('a"b', '# x').success).toBe(false)
  })

  it('含 < > | 的名称应被拒', () => {
    expect(skillService.saveSkill('a<b>', '# x').success).toBe(false)
    expect(skillService.saveSkill('a|b', '# x').success).toBe(false)
  })

  it('空名称应被拒', () => {
    expect(skillService.saveSkill('', '# x').success).toBe(false)
  })

  it('合法名称应通过(字母数字中文-_)', () => {
    expect(skillService.saveSkill('valid-skill_1', '# 内容').success).toBe(true)
    expect(skillService.saveSkill('中文技能', '# 内容').success).toBe(true)
  })
})

describe('skillService — 描述解析', () => {
  it('YAML frontmatter 中的 description 应被提取', () => {
    const name = `fm-desc-${Date.now()}`
    const content = '---\ndescription: 这是一个测试技能\n---\n# 技能内容'
    skillService.saveSkill(name, content)
    const skill = skillService.getSkill(name)
    expect(skill?.description).toBe('这是一个测试技能')
  })

  it('无 frontmatter 时取首段非标题文本', () => {
    const name = `nofm-${Date.now()}`
    skillService.saveSkill(name, '# 标题\n\n这是正文描述')
    const skill = skillService.getSkill(name)
    expect(skill?.description).toBeTruthy()
  })

  it('仅有标题无正文时描述可为空或标题', () => {
    const name = `titleonly-${Date.now()}`
    skillService.saveSkill(name, '# 只有标题')
    const skill = skillService.getSkill(name)
    // 不抛错即可
    expect(skill).not.toBeNull()
  })

  it('中文 + emoji 描述应正常', () => {
    const name = `unicode-${Date.now()}`
    skillService.saveSkill(name, '# 技能 🎓\n\n描述内容')
    const skill = skillService.getSkill(name)
    expect(skill?.content).toContain('🎓')
  })
})

describe('skillService — 容错', () => {
  it('getSkill 不存在返回 null', () => {
    expect(skillService.getSkill('nonexistent-skill-xyz')).toBeNull()
  })

  it('listSkills 目录不存在时不抛错', () => {
    // userSkillsDir 可能不存在(首次运行)
    expect(() => skillService.listSkills()).not.toThrow()
  })

  it('saveSkill + deleteSkill 往返', () => {
    const name = `roundtrip-${Date.now()}`
    skillService.saveSkill(name, '# 内容')
    expect(skillService.getSkill(name)).not.toBeNull()
    const del = skillService.deleteSkill(name)
    expect(del.success).toBe(true)
  })

  it('deleteSkill 不存在的技能返回失败但不抛错', () => {
    const r = skillService.deleteSkill('nonexistent-delete-xyz')
    expect(r.success).toBe(false)
  })

  it('覆盖保存同名技能应替换内容', () => {
    const name = `overwrite-${Date.now()}`
    skillService.saveSkill(name, '# v1')
    skillService.saveSkill(name, '# v2 覆盖')
    const skill = skillService.getSkill(name)
    expect(skill?.content).toContain('v2 覆盖')
    expect(skill?.content).not.toContain('# v1')
  })
})

describe('skillService — 损坏文件容错', () => {
  it('损坏的 .md 文件不应导致 listSkills 崩溃', () => {
    // 写入一个二进制损坏文件到 user skills 目录
    const userDir = path.join(tmpDir, 'skills')
    fs.mkdirSync(userDir, { recursive: true })
    fs.writeFileSync(path.join(userDir, 'corrupt.md'), Buffer.from([0xff, 0xfe, 0x00]))
    expect(() => skillService.listSkills()).not.toThrow()
  })
})
