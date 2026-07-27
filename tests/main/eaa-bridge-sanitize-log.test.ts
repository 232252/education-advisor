// =============================================================
// eaa-bridge — sanitizeArgsForLog 直接单元测试
// 安全关键: 确保 privacy 子命令的密码参数不会泄露到日志
// 此前只通过 execute 间接覆盖,这里对静态方法做穷举测试
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

// mock electron: EAABridge 构造时调用 app.getPath('userData')
vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'eaabridge-sanitize-test'),
    isPackaged: false,
  },
}))

import { EAABridge } from '../../src/main/services/eaa-bridge'

describe('EAABridge.sanitizeArgsForLog — 非 privacy 命令', () => {
  it('add 命令原样返回(深拷贝)', () => {
    const args = ['张三', 'LATE', '--delta', '-2']
    expect(EAABridge.sanitizeArgsForLog('add', args)).toEqual(args)
  })

  it('list-students 命令原样返回', () => {
    const args = ['-O', 'json']
    expect(EAABridge.sanitizeArgsForLog('list-students', args)).toEqual(args)
  })

  it('返回的是新数组(不修改入参)', () => {
    const args = ['a', 'b']
    const out = EAABridge.sanitizeArgsForLog('add', args)
    expect(out).not.toBe(args)
    expect(out).toEqual(args)
  })

  it('空数组', () => {
    expect(EAABridge.sanitizeArgsForLog('info', [])).toEqual([])
  })
})

describe('EAABridge.sanitizeArgsForLog — privacy 非密码子命令', () => {
  it('privacy list 不脱敏(只读)', () => {
    const args = ['list']
    expect(EAABridge.sanitizeArgsForLog('privacy', args)).toEqual(['list'])
  })

  it('privacy enable 不脱敏', () => {
    const args = ['enable']
    expect(EAABridge.sanitizeArgsForLog('privacy', args)).toEqual(['enable'])
  })

  it('privacy filter 不脱敏', () => {
    const args = ['filter', 'parent']
    expect(EAABridge.sanitizeArgsForLog('privacy', args)).toEqual(['filter', 'parent'])
  })

  it('privacy dryrun 不脱敏', () => {
    const args = ['dryrun', 'someInput']
    expect(EAABridge.sanitizeArgsForLog('privacy', args)).toEqual(['dryrun', 'someInput'])
  })

  it('privacy anonymize 不脱敏', () => {
    const args = ['anonymize', 'output.txt']
    expect(EAABridge.sanitizeArgsForLog('privacy', args)).toEqual(['anonymize', 'output.txt'])
  })
})

describe('EAABridge.sanitizeArgsForLog — privacy 密码子命令 (includesCommand=false)', () => {
  // cmd.args 结构: [subcommand, password, ...]
  it('privacy init 脱敏第2个参数', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['init', 'super-secret-pwd'])
    expect(out).toEqual(['init', '***'])
    expect(out.join(' ')).not.toContain('super-secret-pwd')
  })

  it('privacy load 脱敏第2个参数', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['load', 'my-password-123'])
    expect(out).toEqual(['load', '***'])
  })

  it('privacy disable 脱敏第2个参数', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['disable', 'pass'])
    expect(out).toEqual(['disable', '***'])
  })

  it('privacy init 带额外参数(只脱敏密码)', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['init', 'pwd', '--extra', 'val'])
    expect(out).toEqual(['init', '***', '--extra', 'val'])
  })

  it('密码为空字符串时仍脱敏位置', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['init', ''])
    expect(out).toEqual(['init', '***'])
  })
})

describe('EAABridge.sanitizeArgsForLog — privacy 密码子命令 (includesCommand=true)', () => {
  // full args 结构: [command, subcommand, password, ...]
  it('privacy init 完整 args 脱敏第3个参数', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['privacy', 'init', 'secret'], true)
    expect(out).toEqual(['privacy', 'init', '***'])
  })

  it('privacy load 完整 args 脱敏', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['privacy', 'load', 'p4ss'], true)
    expect(out).toEqual(['privacy', 'load', '***'])
  })

  it('privacy disable 完整 args 脱敏', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['privacy', 'disable', 'x'], true)
    expect(out).toEqual(['privacy', 'disable', '***'])
  })

  it('完整 args 带额外参数', () => {
    const out = EAABridge.sanitizeArgsForLog(
      'privacy',
      ['privacy', 'init', 'pwd', '--flag'],
      true,
    )
    expect(out).toEqual(['privacy', 'init', '***', '--flag'])
  })
})

describe('EAABridge.sanitizeArgsForLog — 边界 / 防御', () => {
  it('privacy init 但 args 长度不足(cmd.args=只有 subcommand) → 原样返回', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['init'])
    expect(out).toEqual(['init'])
  })

  it('privacy init 完整 args 但长度不足(只有 command+sub) → 原样返回', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['privacy', 'init'], true)
    expect(out).toEqual(['privacy', 'init'])
  })

  it('privacy 未知子命令不脱敏', () => {
    const out = EAABridge.sanitizeArgsForLog('privacy', ['unknown', 'data'])
    expect(out).toEqual(['unknown', 'data'])
  })

  it('多次调用互不干扰(无共享状态)', () => {
    const a = EAABridge.sanitizeArgsForLog('privacy', ['init', 'pwd1'])
    const b = EAABridge.sanitizeArgsForLog('privacy', ['init', 'pwd2'])
    expect(a).toEqual(['init', '***'])
    expect(b).toEqual(['init', '***'])
  })

  it('includesCommand 默认为 false', () => {
    // 不传第3参数,结构按 [sub, pwd, ...] 处理
    const out = EAABridge.sanitizeArgsForLog('privacy', ['init', 'pwd'])
    expect(out).toEqual(['init', '***'])
  })
})
