// =============================================================
// File Tools 测试 — read_file / read_excel / list_dir / write_file / write_excel / write_csv
// 覆盖：实际文件 I/O、错误处理、CSV 转义、Excel 读写往返
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  allFileTools,
  listDirTool,
  readExcelTool,
  readFileTool,
  writeCsvTool,
  writeExcelTool,
  writeFileTool,
} from '../../src/main/services/file-tools'

const tmpRoot = path.join(
  os.tmpdir(),
  `file-tools-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

describe('file-tools', () => {
  describe('allFileTools 导出', () => {
    it('应包含 6 个工具', () => {
      expect(allFileTools).toHaveLength(6)
      expect(allFileTools.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'read_file',
          'read_excel',
          'list_dir',
          'write_file',
          'write_excel',
          'write_csv',
        ]),
      )
    })
  })

  describe('writeFileTool + readFileTool 往返', () => {
    it('写入文本文件后应能读回相同内容', async () => {
      const filePath = path.join(tmpRoot, 'hello.txt')
      const writeResult = await writeFileTool.execute('w1', {
        path: filePath,
        content: 'Hello, World!\n中文测试',
      })
      const writeText = (writeResult.content[0] as { text: string }).text
      expect(writeText).toContain('✅ 文件已写入')
      expect(writeText).toContain('bytes')

      const readResult = await readFileTool.execute('r1', { path: filePath })
      const readText = (readResult.content[0] as { text: string }).text
      expect(readText).toContain('📄 文件')
      expect(readText).toContain('Hello, World!')
      expect(readText).toContain('中文测试')
    })

    it('写入文件时应自动创建父目录', async () => {
      const filePath = path.join(tmpRoot, 'sub', 'nested', 'dir', 'file.txt')
      const result = await writeFileTool.execute('w2', {
        path: filePath,
        content: 'nested content',
      })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('✅ 文件已写入')
      expect(await fsp.readFile(filePath, 'utf-8')).toBe('nested content')
    })

    it('读取不存在的文件应抛错', async () => {
      await expect(
        readFileTool.execute('r2', { path: path.join(tmpRoot, 'no-such.txt') }),
      ).rejects.toThrow(/文件不存在/)
    })

    it('读取时应支持指定编码', async () => {
      const filePath = path.join(tmpRoot, 'utf8.txt')
      await fsp.writeFile(filePath, '内容', 'utf-8')
      const result = await readFileTool.execute('r3', { path: filePath, encoding: 'utf-8' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('内容')
    })
  })

  describe('readFileTool 大文件保护', () => {
    it('超过 5MB 应被拒绝', async () => {
      const filePath = path.join(tmpRoot, 'large.txt')
      // 写 6MB 数据
      const buf = Buffer.alloc(6 * 1024 * 1024, 'a')
      await fsp.writeFile(filePath, buf)
      await expect(readFileTool.execute('r4', { path: filePath })).rejects.toThrow(/文件过大/)
    })
  })

  describe('writeExcelTool + readExcelTool 往返', () => {
    it('写入 xlsx 后应能读回表头和行', async () => {
      const filePath = path.join(tmpRoot, 'data.xlsx')
      const writeResult = await writeExcelTool.execute('we1', {
        path: filePath,
        sheets: [
          {
            name: 'Sheet1',
            headers: ['姓名', '年龄', '城市'],
            rows: [
              ['张三', '18', '北京'],
              ['李四', '17', '上海'],
            ],
          },
        ],
      })
      const writeText = (writeResult.content[0] as { text: string }).text
      expect(writeText).toContain('✅ Excel 已写入')
      expect(writeText).toContain('Sheet1')
      expect(writeText).toContain('总行数: 2')

      const readResult = await readExcelTool.execute('re1', { path: filePath })
      const readText = (readResult.content[0] as { text: string }).text
      expect(readText).toContain('📊 Excel 文件')
      expect(readText).toContain('工作表: Sheet1')
      expect(readText).toContain('总行数: 3') // 表头 + 2 行
      expect(readText).toContain('表头: 姓名 | 年龄 | 城市')
      expect(readText).toContain('张三')
      expect(readText).toContain('李四')
    })

    it('多工作表时应列出全部工作表名', async () => {
      const filePath = path.join(tmpRoot, 'multi-sheet.xlsx')
      await writeExcelTool.execute('we2', {
        path: filePath,
        sheets: [
          { name: 'A', headers: ['x'], rows: [['1']] },
          { name: 'B', headers: ['y'], rows: [['2']] },
        ],
      })
      const result = await readExcelTool.execute('re2', { path: filePath })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('工作表列表: A, B')
      expect(text).toContain('工作表: A') // 默认读第一个
    })

    it('指定不存在的工作表应抛错并列出可用', async () => {
      const filePath = path.join(tmpRoot, 'sheets.xlsx')
      await writeExcelTool.execute('we3', {
        path: filePath,
        sheets: [{ name: 'Only', headers: ['h'], rows: [['v']] }],
      })
      await expect(
        readExcelTool.execute('re3', { path: filePath, sheet: 'Nonexistent' }),
      ).rejects.toThrow(/不存在.*可用工作表: Only/)
    })

    it('读取非 Excel 文件应抛错', async () => {
      const filePath = path.join(tmpRoot, 'not-excel.txt')
      await fsp.writeFile(filePath, 'plain text')
      await expect(readExcelTool.execute('re4', { path: filePath })).rejects.toThrow(
        /不支持的文件格式/,
      )
    })

    it('读取不存在的 Excel 应抛错', async () => {
      await expect(
        readExcelTool.execute('re5', { path: path.join(tmpRoot, 'missing.xlsx') }),
      ).rejects.toThrow(/文件不存在/)
    })

    it('maxRows 应截断数据行', async () => {
      const filePath = path.join(tmpRoot, 'many-rows.xlsx')
      await writeExcelTool.execute('we4', {
        path: filePath,
        sheets: [
          {
            name: 'S',
            headers: ['n'],
            rows: Array.from({ length: 100 }, (_, i) => [String(i + 1)]),
          },
        ],
      })
      const result = await readExcelTool.execute('re6', { path: filePath, maxRows: 10 })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('总行数: 101')
      expect(text).toContain('已截断为 10 行')
    })
  })

  describe('writeCsvTool', () => {
    it('应写入标准 CSV 含 BOM', async () => {
      const filePath = path.join(tmpRoot, 'data.csv')
      const result = await writeCsvTool.execute('wc1', {
        path: filePath,
        headers: ['name', 'age', 'city'],
        rows: [
          ['Alice', '30', 'NYC'],
          ['Bob', '25', 'LA'],
        ],
      })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('✅ CSV 已写入')
      expect(text).toContain('数据行: 2')
      expect(text).toContain('编码: utf-8-sig')

      const raw = await fsp.readFile(filePath, 'utf-8')
      expect(raw.startsWith('\uFEFF')).toBe(true)
      expect(raw).toContain('name,age,city')
      expect(raw).toContain('Alice,30,NYC')
    })

    it('应正确转义包含逗号/引号/换行的字段', async () => {
      const filePath = path.join(tmpRoot, 'escaped.csv')
      await writeCsvTool.execute('wc2', {
        path: filePath,
        headers: ['name', 'note'],
        rows: [
          ['Smith, John', 'Has "quotes" inside'],
          ['Jane\nDoe', 'Multi-line'],
        ],
      })
      const raw = await fsp.readFile(filePath, 'utf-8')
      expect(raw).toContain('"Smith, John"')
      expect(raw).toContain('"Has ""quotes"" inside"')
      expect(raw).toContain('"Jane\nDoe"')
    })

    it('应支持非 BOM 编码 (utf-8)', async () => {
      const filePath = path.join(tmpRoot, 'no-bom.csv')
      await writeCsvTool.execute('wc3', {
        path: filePath,
        headers: ['h'],
        rows: [['v']],
        encoding: 'utf-8',
      })
      const raw = await fsp.readFile(filePath, 'utf-8')
      expect(raw.startsWith('\uFEFF')).toBe(false)
      expect(raw).toContain('h\r\nv')
    })

    it('写入应自动创建父目录', async () => {
      const filePath = path.join(tmpRoot, 'csv-sub', 'x.csv')
      const result = await writeCsvTool.execute('wc4', {
        path: filePath,
        headers: ['a'],
        rows: [['1']],
      })
      expect((result.content[0] as { text: string }).text).toContain('✅ CSV 已写入')
      expect(await fsp.readFile(filePath, 'utf-8')).toContain('a')
    })
  })

  describe('listDirTool', () => {
    it('应列出目录下的子目录和文件', async () => {
      // 在 tmpRoot 下创建固定结构
      await fsp.mkdir(path.join(tmpRoot, 'listdir', 'sub1'), { recursive: true })
      await fsp.mkdir(path.join(tmpRoot, 'listdir', 'sub2'), { recursive: true })
      await fsp.writeFile(path.join(tmpRoot, 'listdir', 'file1.txt'), 'hello')
      await fsp.writeFile(path.join(tmpRoot, 'listdir', 'file2.json'), '{}')

      const result = await listDirTool.execute('l1', { path: path.join(tmpRoot, 'listdir') })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('📁 目录')
      expect(text).toContain('条目数: 4')
      expect(text).toContain('子目录 (2)')
      expect(text).toContain('📂 sub1/')
      expect(text).toContain('📂 sub2/')
      expect(text).toContain('文件 (2)')
      expect(text).toContain('📄 file1.txt')
      expect(text).toContain('📄 file2.json')
    })

    it('应显示文件大小(B/KB/MB)', async () => {
      await fsp.mkdir(path.join(tmpRoot, 'sizes'), { recursive: true })
      await fsp.writeFile(path.join(tmpRoot, 'sizes', 'small.txt'), 'a')
      await fsp.writeFile(path.join(tmpRoot, 'sizes', 'medium.txt'), Buffer.alloc(2048, 'x'))
      await fsp.writeFile(path.join(tmpRoot, 'sizes', 'large.bin'), Buffer.alloc(2 * 1024 * 1024, 'y'))

      const result = await listDirTool.execute('l2', { path: path.join(tmpRoot, 'sizes') })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('B') // small.txt 至少有 "1 B"
      expect(text).toContain('KB') // medium.txt
      expect(text).toContain('MB') // large.bin
    })

    it('不存在的路径应抛错', async () => {
      await expect(
        listDirTool.execute('l3', { path: path.join(tmpRoot, 'no-such-dir') }),
      ).rejects.toThrow(/目录不存在/)
    })

    it('传入文件路径(非目录)应抛错', async () => {
      const filePath = path.join(tmpRoot, 'not-a-dir.txt')
      await fsp.writeFile(filePath, 'x')
      await expect(listDirTool.execute('l4', { path: filePath })).rejects.toThrow(/不是目录/)
    })

    it('空目录应显示条目数 0', async () => {
      await fsp.mkdir(path.join(tmpRoot, 'empty-dir'), { recursive: true })
      const result = await listDirTool.execute('l5', { path: path.join(tmpRoot, 'empty-dir') })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('条目数: 0')
    })
  })
})
