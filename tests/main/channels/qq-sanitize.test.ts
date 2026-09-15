import { describe, expect, it } from 'vitest'
import {
  aggressiveSanitizeQqText,
  isQqUrlContentError,
  sanitizeQqText,
} from '../../../src/main/services/channels/adapters/qq/sanitize'

describe('qq sanitizeQqText (QwenPaw parity)', () => {
  it('strips http(s) and www URLs', () => {
    const r = sanitizeQqText(' dig 见 https://example.com/a 与 www.foo.cn/x 结束')
    expect(r.hadUrl).toBe(true)
    expect(r.text).not.toMatch(/https?:\/\//i)
    expect(r.text).not.toMatch(/www\./i)
    expect(r.text).toContain('[链接已省略]')
  })

  it('leaves plain text unchanged', () => {
    const r = sanitizeQqText('你好，作业交到班级群')
    expect(r.hadUrl).toBe(false)
    expect(r.text).toBe('你好，作业交到班级群')
  })

  it('aggressive catches bare domains', () => {
    const r = aggressiveSanitizeQqText('票务 12306.cn 或 google.com/search')
    expect(r.hadUrl).toBe(true)
    expect(r.text).not.toContain('12306.cn')
    expect(r.text).not.toContain('google.com')
  })

  it('detects QQ URL content errors', () => {
    expect(isQqUrlContentError(new Error('HTTP 400: 304003 不允许包含url'))).toBe(true)
    expect(isQqUrlContentError(new Error('40034028'))).toBe(true)
    expect(isQqUrlContentError(new Error('quota exceeded'))).toBe(false)
  })
})
