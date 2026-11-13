// =============================================================
// slash-commands — DSH 内置指令静态目录 + 输入解析（纯函数）
// 对照 @deepseek-ai/dsh-commands/builtin 的中英拼写，不依赖 SDK 列举接口。
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  isSlashInput,
  matchSlashCommands,
  parseSlashInput,
  SLASH_COMMANDS,
} from '../slash-commands'

describe('slash-commands 目录', () => {
  it('收录 DSH 六个内置指令，含中英拼写', () => {
    const names = SLASH_COMMANDS.map((c) => c.name)
    expect(names).toEqual(['goal', 'plan', 'feedback', 'compact', 'permission', 'export'])
    for (const c of SLASH_COMMANDS) {
      expect(c.zh.length).toBeGreaterThan(0)
      expect(c.description.length).toBeGreaterThan(0)
    }
  })

  it('目录不含密钥、name 全小写无斜杠', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.name).toBe(c.name.toLowerCase())
      expect(c.name).not.toContain('/')
    }
  })
})

describe('isSlashInput / parseSlashInput', () => {
  it('只有以 / 开头且非空才算指令输入', () => {
    expect(isSlashInput('/goal')).toBe(true)
    expect(isSlashInput('  /plan')).toBe(true)
    expect(isSlashInput('普通消息')).toBe(false)
    expect(isSlashInput('/')).toBe(false)
    expect(isSlashInput('')).toBe(false)
    expect(isSlashInput('a/b')).toBe(false)
  })

  it('拆出指令名与原始参数（保留参数原文）', () => {
    expect(parseSlashInput('/goal 提高及格率')).toEqual({ name: 'goal', args: '提高及格率' })
    expect(parseSlashInput('/compact')).toEqual({ name: 'compact', args: '' })
    expect(parseSlashInput('  /plan   先出计划  ')).toEqual({ name: 'plan', args: '先出计划' })
    expect(parseSlashInput('普通消息')).toBeNull()
  })

  it('中文拼写也能识别为指令名', () => {
    expect(parseSlashInput('/目标 提高及格率')).toEqual({ name: '目标', args: '提高及格率' })
  })
})

describe('matchSlashCommands 菜单过滤', () => {
  it('空查询返回全部', () => {
    expect(matchSlashCommands('')).toHaveLength(SLASH_COMMANDS.length)
    expect(matchSlashCommands('/')).toHaveLength(SLASH_COMMANDS.length)
  })

  it('按英文前缀过滤', () => {
    const m = matchSlashCommands('/co')
    expect(m.map((c) => c.name)).toEqual(['compact'])
  })

  it('按中文拼写过滤', () => {
    const m = matchSlashCommands('/压')
    expect(m.map((c) => c.name)).toEqual(['compact'])
  })

  it('无匹配返回空', () => {
    expect(matchSlashCommands('/zzz')).toEqual([])
  })
})
