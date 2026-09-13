// =============================================================
// image-tools(read_image) 测试 — P2-8 视觉通道
// 验证: 成功返回 ImageContent 块 / 各类错误路径 / 路径穿越拒绝
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readImageTool } from '../image-tools'

async function tmpPng(bytes = 64): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-img-'))
  const p = path.join(dir, 'sample.png')
  await fsp.writeFile(p, Buffer.alloc(bytes, 0x89))
  return p
}

describe('readImageTool — P2-8', () => {
  it('成功: 返回 text + image 两个内容块(base64 非空, mimeType 正确)', async () => {
    const p = await tmpPng()
    // biome-ignore lint/suspicious/noExplicitAny: 测试桩
    const result = (await readImageTool.execute('tc1', { path: p } as any, undefined)) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
      details: { path: string; size: number; mimeType: string }
    }
    expect(result.content).toHaveLength(2)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('sample.png')
    expect(result.content[1].type).toBe('image')
    expect(result.content[1].mimeType).toBe('image/png')
    expect(result.content[1].data?.length).toBeGreaterThan(0)
    expect(result.details.size).toBe(64)
  })

  it('文件不存在 → 报错含路径', async () => {
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: 测试桩
      readImageTool.execute('tc2', { path: 'C:\\definitely\\not\\exists.png' } as any, undefined),
    ).rejects.toThrow('文件不存在')
  })

  it('相对路径 → 拒绝(要求绝对路径)', async () => {
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: 测试桩
      readImageTool.execute('tc3', { path: 'relative/x.png' } as any, undefined),
    ).rejects.toThrow('绝对路径')
  })

  it('穿越路径(含 .. 段) → 拒绝', async () => {
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: 测试桩
      readImageTool.execute('tc4', { path: 'C:\\users\\..\\..\\etc\\x.png' } as any, undefined),
    ).rejects.toThrow('路径不安全')
  })

  it('非图片扩展名 → 拒绝并列出支持格式', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-img-'))
    const p = path.join(dir, 'notes.txt')
    await fsp.writeFile(p, 'hello')
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: 测试桩
      readImageTool.execute('tc5', { path: p } as any, undefined),
    ).rejects.toThrow('不支持的图片格式')
  })

  it('空文件(0 字节) → 拒绝', async () => {
    const p = await tmpPng(0)
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: 测试桩
      readImageTool.execute('tc6', { path: p } as any, undefined),
    ).rejects.toThrow('为空')
  })
})
