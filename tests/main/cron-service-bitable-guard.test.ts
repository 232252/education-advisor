// B6-2 回归测试：bitableSync.syncInterval 校验
// 防止用户配置非法或过于激进的 cron 表达式(如 "* * * * *")导致 LLM/bitable 成本失控。
// 直接单测纯函数 isTooAggressiveCron,避免依赖 settings mock。
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// cron-service 顶层 import 会触发 logger.ts 加载(app.getPath),需 mock electron。
const tmpDir = path.join(os.tmpdir(), `cron-guard-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? tmpDir : ''),
    isPackaged: false,
  },
  BrowserWindow: class {},
}))

const { isTooAggressiveCron } = await import('../../src/main/services/cron-service')

describe('isTooAggressiveCron (B6-2 成本护栏)', () => {
  it('每分钟 "*" 应判定为激进', () => {
    expect(isTooAggressiveCron('* * * * *')).toBe(true)
  })

  it('步进 < 5 分钟应判定为激进', () => {
    expect(isTooAggressiveCron('*/1 * * * *')).toBe(true)
    expect(isTooAggressiveCron('*/2 * * * *')).toBe(true)
    expect(isTooAggressiveCron('*/4 * * * *')).toBe(true)
  })

  it('步进 >= 5 分钟应判定为安全', () => {
    expect(isTooAggressiveCron('*/5 * * * *')).toBe(false)
    expect(isTooAggressiveCron('*/10 * * * *')).toBe(false)
    expect(isTooAggressiveCron('*/30 * * * *')).toBe(false)
  })

  it('每小时/每 6 小时等长间隔应判定为安全', () => {
    expect(isTooAggressiveCron('0 * * * *')).toBe(false)
    expect(isTooAggressiveCron('0 */6 * * *')).toBe(false)
    expect(isTooAggressiveCron('0 9 * * *')).toBe(false)
    expect(isTooAggressiveCron('0 0 * * 0')).toBe(false)
  })

  it('指定分钟列表(非步进)不应被误判为激进', () => {
    // "0,15,30,45 * * * *" 每 15 分钟但用列表表达,分钟字段不是 * 也不是 */N
    expect(isTooAggressiveCron('0,15,30,45 * * * *')).toBe(false)
  })

  it('字段数不足 5 时不应误判(交由 node-cron.validate 拦截)', () => {
    expect(isTooAggressiveCron('* *')).toBe(false)
    expect(isTooAggressiveCron('')).toBe(false)
  })

  it('自定义 minMinutes 阈值应生效', () => {
    // 默认 5 分钟阈值下 */5 安全;阈值提高到 10 时 */5 应判定激进
    expect(isTooAggressiveCron('*/5 * * * *', 10)).toBe(true)
    expect(isTooAggressiveCron('*/5 * * * *', 5)).toBe(false)
  })
})
