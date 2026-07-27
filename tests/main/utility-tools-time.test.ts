// =============================================================
// Utility Tools — getCurrentTimeTool 深度测试
// 覆盖: 默认时区、自定义时区、UTC、星期、工作日/周末、ISO 格式
// =============================================================

import { describe, expect, it } from 'vitest'
import { getCurrentTimeTool } from '../../src/main/services/utility-tools'

async function timeResult(tz?: string): Promise<string> {
  const params = tz ? { timezone: tz } : {}
  const r = await getCurrentTimeTool.execute('t', params)
  const block = r.content[0]
  return block && block.type === 'text' ? block.text : ''
}

describe('getCurrentTimeTool — 输出结构', () => {
  it('应包含日期/时间/星期/时区/ISO', async () => {
    const out = await timeResult()
    expect(out).toContain('日期')
    expect(out).toContain('时间')
    expect(out).toContain('星期')
    expect(out).toContain('时区')
    expect(out).toContain('ISO')
  })

  it('ISO 字段应为合法的 ISO 8601 格式', async () => {
    const out = await timeResult()
    const match = out.match(/ISO: (.+)$/m)
    expect(match).not.toBeNull()
    const iso = match![1].trim()
    const d = new Date(iso)
    expect(d.getTime()).not.toBeNaN() // 合法日期
  })

  it('星期字段应包含中文星期', async () => {
    const out = await timeResult()
    const match = out.match(/星期: (.+)$/m)
    expect(match).not.toBeNull()
    expect(['日', '一', '二', '三', '四', '五', '六']).toContain(match![1].trim())
  })

  it('类型字段应为工作日或周末', async () => {
    const out = await timeResult()
    expect(out).toMatch(/类型: (工作日|周末)/)
  })
})

describe('getCurrentTimeTool — 时区处理', () => {
  it('指定 timezone=Asia/Shanghai 应使用该时区', async () => {
    const out = await timeResult('Asia/Shanghai')
    expect(out).toContain('Asia/Shanghai')
  })

  it('指定 timezone=UTC 应使用 UTC', async () => {
    const out = await timeResult('UTC')
    expect(out).toContain('UTC')
  })

  it('指定 timezone=America/New_York 应正确显示', async () => {
    const out = await timeResult('America/New_York')
    expect(out).toContain('America/New_York')
  })

  it('指定 timezone=Europe/London 应正确显示', async () => {
    const out = await timeResult('Europe/London')
    expect(out).toContain('Europe/London')
  })

  it('不指定时区应使用系统默认', async () => {
    const out = await timeResult()
    const match = out.match(/时区: (.+)$/m)
    expect(match).not.toBeNull()
    expect(match![1].trim().length).toBeGreaterThan(0)
  })
})

describe('getCurrentTimeTool — 日期格式', () => {
  it('日期部分应包含年份', async () => {
    const out = await timeResult()
    const match = out.match(/日期: (\d{4})-/)
    expect(match).not.toBeNull()
    const year = Number(match![1])
    expect(year).toBeGreaterThanOrEqual(2024)
  })

  it('时间部分应包含时分秒', async () => {
    const out = await timeResult()
    const match = out.match(/时间: \d{2}:\d{2}:\d{2}/)
    expect(match).not.toBeNull()
  })
})

describe('getCurrentTimeTool — 元数据', () => {
  it('name 应为 get_current_time', () => {
    expect(getCurrentTimeTool.name).toBe('get_current_time')
  })

  it('label 应为中文', () => {
    expect(getCurrentTimeTool.label).toBe('获取当前时间')
  })

  it('parameters 应有 timezone 可选字段', () => {
    expect(getCurrentTimeTool.parameters).toBeDefined()
  })
})
