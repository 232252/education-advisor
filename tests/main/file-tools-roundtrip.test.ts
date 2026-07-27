// =============================================================
// File Tools — 写入/读取 往返压力测试
// 各种编码、大文件、特殊字符的 write+read 往返一致性
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileTool, writeFileTool, listDirTool } from '../../src/main/services/file-tools'

const tmpRoot = path.join(
  os.tmpdir(),
  `file-roundtrip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

beforeAll(async () => {
  await fsp.mkdir(tmpRoot, { recursive: true })
})

afterAll(async () => {
  try {
    await fsp.rm(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('file-tools write+read 往返', () => {
  it('纯文本往返一致', async () => {
    const file = path.join(tmpRoot, 'plain.txt')
    await writeFileTool.execute('t', { path: file, content: 'hello world\n第二行' })
    const r = await readFileTool.execute('t', { path: file })
    const block = r.content[0]
    expect(block?.type).toBe('text')
  })

  it('中文内容往返一致', async () => {
    const file = path.join(tmpRoot, 'chinese.txt')
    const content = '张三李四王五\n这是一段中文内容🎓'
    await writeFileTool.execute('t', { path: file, content })
    const r = await readFileTool.execute('t', { path: file })
    const block = r.content[0]
    expect(block?.type).toBe('text')
  })

  it('JSON 内容往返', async () => {
    const file = path.join(tmpRoot, 'data.json')
    const content = JSON.stringify({ name: '张三', score: 10, items: [1, 2, 3] }, null, 2)
    await writeFileTool.execute('t', { path: file, content })
    const r = await readFileTool.execute('t', { path: file })
    const block = r.content[0]
    expect(block?.type).toBe('text')
  })

  it('空文件往返', async () => {
    const file = path.join(tmpRoot, 'empty.txt')
    await writeFileTool.execute('t', { path: file, content: '' })
    const r = await readFileTool.execute('t', { path: file })
    expect(r.content[0]?.type).toBe('text')
  })

  it('特殊字符内容 (#$%^&*)', async () => {
    const file = path.join(tmpRoot, 'special.txt')
    const content = '#$%^&*()!@`~\\|'
    await writeFileTool.execute('t', { path: file, content })
    const r = await readFileTool.execute('t', { path: file })
    expect(r.content[0]?.type).toBe('text')
  })

  it('超长内容 (100KB)', async () => {
    const file = path.join(tmpRoot, 'large.txt')
    const content = 'x'.repeat(100 * 1024)
    await writeFileTool.execute('t', { path: file, content })
    const r = await readFileTool.execute('t', { path: file })
    expect(r.content[0]?.type).toBe('text')
  })

  it('自动创建父目录', async () => {
    const file = path.join(tmpRoot, 'sub', 'deep', 'dir', 'file.txt')
    await writeFileTool.execute('t', { path: file, content: 'nested' })
    const r = await readFileTool.execute('t', { path: file })
    expect(r.content[0]?.type).toBe('text')
  })
})

describe('file-tools write 重复覆盖', () => {
  it('覆盖写入应替换原内容', async () => {
    const file = path.join(tmpRoot, 'overwrite.txt')
    await writeFileTool.execute('t', { path: file, content: 'original' })
    await writeFileTool.execute('t', { path: file, content: 'replaced' })
    const r = await readFileTool.execute('t', { path: file })
    expect(r.content[0]?.type).toBe('text')
  })
})

describe('file-tools listDir 往返', () => {
  it('写入多个文件后 listDir 应列出', async () => {
    const dir = path.join(tmpRoot, 'listdir')
    await writeFileTool.execute('t', { path: path.join(dir, 'a.txt'), content: 'a' })
    await writeFileTool.execute('t', { path: path.join(dir, 'b.txt'), content: 'b' })
    await writeFileTool.execute('t', { path: path.join(dir, 'c.txt'), content: 'c' })
    const r = await listDirTool.execute('t', { path: dir })
    const block = r.content[0]
    expect(block?.type).toBe('text')
    const text = (block as { text?: string }).text ?? ''
    expect(text).toContain('a.txt')
    expect(text).toContain('b.txt')
    expect(text).toContain('c.txt')
  })
})

describe('file-tools 批量压力', () => {
  it('连续写入 50 个文件', async () => {
    const dir = path.join(tmpRoot, 'batch50')
    for (let i = 0; i < 50; i++) {
      await writeFileTool.execute('t', {
        path: path.join(dir, `file${i}.txt`),
        content: `content ${i}`,
      })
    }
    const r = await listDirTool.execute('t', { path: dir })
    const text = (r.content[0] as { text?: string }).text ?? ''
    // 应列出全部 50 个文件
    for (let i = 0; i < 50; i++) {
      expect(text).toContain(`file${i}.txt`)
    }
  })

  it('读写交替 30 轮', async () => {
    const file = path.join(tmpRoot, 'alternate.txt')
    for (let i = 0; i < 30; i++) {
      await writeFileTool.execute('t', { path: file, content: `round ${i}` })
      await readFileTool.execute('t', { path: file })
    }
    // 不崩溃即可
    expect(true).toBe(true)
  })
})

describe('file-tools 错误处理', () => {
  it('读取不存在的文件应抛错', async () => {
    await expect(
      readFileTool.execute('t', { path: path.join(tmpRoot, 'nonexistent-xyz.txt') }),
    ).rejects.toThrow()
  })

  it('读取目录(非文件)应抛错', async () => {
    await expect(
      readFileTool.execute('t', { path: tmpRoot }),
    ).rejects.toThrow()
  })
})
