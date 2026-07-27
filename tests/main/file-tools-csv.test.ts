// =============================================================
// File Tools — CSV 写入边界 / 转义 深度测试
// 覆盖: 特殊字符转义(逗号/引号/换行)、BOM、空字段、中文、超大行
// =============================================================

import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeCsvTool } from '../../src/main/services/file-tools'

const tmpRoot = path.join(
  os.tmpdir(),
  `file-tools-csv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

async function writeCsv(opts: {
  headers: string[]
  rows: string[][]
  encoding?: string
}): Promise<{ content: string; bytes: Buffer }> {
  const file = path.join(tmpRoot, `csv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.csv`)
  await writeCsvTool.execute('t', {
    path: file,
    headers: opts.headers,
    rows: opts.rows,
    encoding: opts.encoding,
  })
  const bytes = fs.readFileSync(file)
  return { content: bytes.toString('utf-8'), bytes }
}

describe('writeCsvTool — 转义边界', () => {
  it('包含逗号的字段应被双引号包裹', async () => {
    const { content } = await writeCsv({
      headers: ['name', 'note'],
      rows: [['张三', 'hello, world']],
    })
    expect(content).toContain('"hello, world"')
  })

  it('包含引号的字段应将引号转义为双引号并整体包裹', async () => {
    const { content } = await writeCsv({
      headers: ['msg'],
      rows: [['say "hi" please']],
    })
    // 应变成 "say ""hi"" please"
    expect(content).toContain('"say ""hi"" please"')
  })

  it('包含换行符的字段应被引号包裹', async () => {
    const { content } = await writeCsv({
      headers: ['multi'],
      rows: [['line1\nline2']],
    })
    expect(content).toContain('"line1\nline2"')
  })

  it('包含 CRLF 的字段应被引号包裹', async () => {
    const { content } = await writeCsv({
      headers: ['multi'],
      rows: [['a\r\nb']],
    })
    expect(content).toContain('"a\r\nb"')
  })

  it('同时包含逗号+引号+换行的复杂字段', async () => {
    const { content } = await writeCsv({
      headers: ['complex'],
      rows: [['a,b"c\nd']],
    })
    // 应被引号包裹且内部引号转义为双引号
    expect(content).toContain('"a,b""c')
    expect(content).toContain('\nd"') // 换行后紧跟 d 和结束引号
  })
})

describe('writeCsvTool — BOM 与编码', () => {
  it('默认编码 utf-8-sig 应写入 BOM', async () => {
    const { bytes } = await writeCsv({ headers: ['a'], rows: [['1']] })
    expect(bytes[0]).toBe(0xef) // BOM 第1字节
    expect(bytes[1]).toBe(0xbb)
    expect(bytes[2]).toBe(0xbf)
  })

  it('encoding=utf-8 (无 sig) 不写 BOM', async () => {
    const { bytes } = await writeCsv({
      headers: ['a'],
      rows: [['1']],
      encoding: 'utf-8',
    })
    expect(bytes[0]).not.toBe(0xef)
  })

  it('encoding=bom 也应写入 BOM', async () => {
    const { bytes } = await writeCsv({
      headers: ['a'],
      rows: [['1']],
      encoding: 'bom',
    })
    expect(bytes[0]).toBe(0xef)
  })

  it('中文字段应正确写入(UTF-8)', async () => {
    const { content } = await writeCsv({
      headers: ['姓名', '分数'],
      rows: [['张三', '10'], ['李四', '-5']],
    })
    expect(content).toContain('张三')
    expect(content).toContain('李四')
  })
})

describe('writeCsvTool — 空字段与边界', () => {
  it('空字符串字段应正常输出(无引号)', async () => {
    const { content } = await writeCsv({
      headers: ['a', 'b'],
      rows: [['', 'x']],
    })
    expect(content).toContain(',x')
  })

  it('全空行应输出为连续逗号(无值)', async () => {
    const { content } = await writeCsv({
      headers: ['a', 'b', 'c'],
      rows: [['', '', '']],
    })
    // 数据行应为 ",," (三个空字段用两个逗号分隔),无尾随 CRLF
    expect(content).toContain('a,b,c\r\n,,')
  })

  it('零行数据应只输出表头', async () => {
    const { content } = await writeCsv({
      headers: ['only', 'header'],
      rows: [],
    })
    const lines = content.split('\r\n').filter((l) => l.trim().length > 0)
    expect(lines.length).toBe(1) // 只有表头
  })

  it('数字字符串字段不需要引号', async () => {
    const { content } = await writeCsv({
      headers: ['score'],
      rows: [['42'], ['-5'], ['3.14']],
    })
    expect(content).toContain('42')
    expect(content).not.toContain('"42"')
  })

  it('超长字段(10000 字符)应正确写入', async () => {
    const long = 'x'.repeat(10000)
    const { content } = await writeCsv({
      headers: ['big'],
      rows: [[long]],
    })
    expect(content).toContain(long)
  })
})

describe('writeCsvTool — 行分隔符', () => {
  it('应使用 CRLF 作为行分隔符(Excel 兼容)', async () => {
    const { content } = await writeCsv({
      headers: ['a'],
      rows: [['1'], ['2'], ['3']],
    })
    expect(content).toContain('\r\n')
  })

  it('多行数据应有正确行数', async () => {
    const { content } = await writeCsv({
      headers: ['a'],
      rows: Array.from({ length: 50 }, (_, i) => [String(i)]),
    })
    const lines = content.split('\r\n')
    // 50 数据行 + 1 表头 = 51 行 (末尾可能有空行)
    expect(lines.filter((l) => l.trim()).length).toBe(51)
  })
})

describe('writeCsvTool — 路径安全', () => {
  it('含 .. 段的原始路径应被拒绝', async () => {
    // 注意: 必须用原始含 .. 的字符串(path.join 会把 .. 解析掉)
    await expect(
      writeCsvTool.execute('t', {
        path: `${tmpRoot}${path.sep}..${path.sep}..${path.sep}evil.csv`,
        headers: ['a'],
        rows: [['1']],
      }),
    ).rejects.toThrow()
  })
})
