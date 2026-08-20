// =============================================================
// EAA 错误翻译层测试 — D9 错误可观测性
// 正向: 已知英文模式翻译为当前语言; 反向: 中文/未知消息原样透传
// =============================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLang } from '../../i18n'
import { translateEaaError } from '../eaa-error-messages'

describe('translateEaaError — 已知模式翻译(zh)', () => {
  beforeEach(() => setLang('zh'))

  it('Student not found 翻译并保留学生名', () => {
    expect(translateEaaError('Student not found: 张三')).toBe('未找到学生: 张三')
  })

  it('Event not found 翻译并保留事件 ID', () => {
    expect(translateEaaError('Event not found: evt_123')).toBe('未找到事件: evt_123')
  })

  it('Validation failed 翻译并保留细节', () => {
    expect(translateEaaError('Validation failed: delta 超出范围')).toBe('校验失败: delta 超出范围')
  })

  it('IO error 翻译', () => {
    expect(translateEaaError('IO error: Permission denied')).toBe('数据读写错误: Permission denied')
  })

  it('JSON error 翻译', () => {
    expect(translateEaaError('JSON error: unexpected token')).toBe('数据解析错误: unexpected token')
  })

  it('二进制缺失消息翻译为用户指引', () => {
    const msg =
      "EAA binary not found for win32-x64 (expected at x or y). Please run 'npm run build:eaa'."
    expect(translateEaaError(msg)).toBe('EAA 数据引擎缺失，请重新安装应用或联系管理员')
  })

  it('EAA_EMPTY_STDOUT 标记翻译为可重试提示', () => {
    expect(translateEaaError('some stderr\n[EAA_EMPTY_STDOUT]')).toBe(
      'EAA 引擎暂无返回（可能正忙），请稍后重试',
    )
  })

  it('aborted 翻译', () => {
    expect(translateEaaError('aborted')).toBe('操作已中止')
  })

  it('剥离 CLI 顶层"错误:"前缀后匹配', () => {
    expect(translateEaaError('错误: Student not found: 李四')).toBe('未找到学生: 李四')
  })
})

describe('translateEaaError — 透传(不猜测)', () => {
  beforeEach(() => setLang('zh'))

  it('已是中文的 CLI 校验消息原样返回 null', () => {
    expect(translateEaaError('重复事件：同一学生今日同一原因码已存在')).toBeNull()
  })

  it('未知英文消息返回 null(由调用方原样展示)', () => {
    expect(translateEaaError('some unknown failure')).toBeNull()
  })

  it('空消息返回 null', () => {
    expect(translateEaaError('')).toBeNull()
    expect(translateEaaError('   ')).toBeNull()
  })
})

describe('translateEaaError — en 语言', () => {
  beforeEach(() => setLang('en'))
  afterEach(() => setLang('zh'))

  it('Student not found 在 en 下保持英文措辞', () => {
    expect(translateEaaError('Student not found: Alice')).toBe('Student not found: Alice')
  })

  it('二进制缺失消息翻译为英文指引', () => {
    expect(translateEaaError('EAA binary not available for linux-x64.')).toContain(
      'please reinstall',
    )
  })
})
