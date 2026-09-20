// =============================================================
// Roster File — 名册文件解析测试
// xlsx/csv/md/yaml/txt 名册夹具 → StudentCandidate[]:
//   姓名列必中(表头启发),学号/考号并入 aliases;
// 坏文件/空表/不支持格式 → 教师可读错误;
// 纯函数(rosterFromMatrix/rosterFromText/rosterFromYamlData)定向覆盖。
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MAX_ROSTER_FILE_BYTES,
  parseRosterFile,
  rosterFromMatrix,
  rosterFromText,
  rosterFromYamlData,
} from '../../src/main/services/grading/roster-file'

const tmpRoot = path.join(
  os.tmpdir(),
  `roster-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)
const tmpRootAbs = path.resolve(tmpRoot)

/** 写夹具: 只接受纯 basename(白名单校验拒绝 ../ 与分隔符),resolve 后做根目录边界校验 */
async function writeFixture(name: string, data: Buffer | string): Promise<string> {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('fixture 名不能为空')
  }
  if (
    path.basename(name) !== name ||
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new Error(`fixture 名必须是纯 basename: ${name}`)
  }
  const target = path.resolve(tmpRootAbs, name)
  if (!target.startsWith(tmpRootAbs + path.sep)) {
    throw new Error(`fixture 路径越出临时目录: ${name}`)
  }
  await fsp.writeFile(target, data)
  return target
}

beforeAll(async () => {
  await fsp.mkdir(tmpRootAbs, { recursive: true })
})

afterAll(async () => {
  try {
    await fsp.rm(tmpRootAbs, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

// ---------- 纯函数 ----------

describe('rosterFromMatrix — 表头启发', () => {
  it('姓名列必中;学号/考号并入 aliases', () => {
    const roster = rosterFromMatrix([
      ['序号', '姓名', '学号', '考号', '性别'],
      ['1', '张三', '2026001', '01', '男'],
      ['2', '李四', '2026002', '02', '女'],
    ])
    expect(roster).toEqual([
      { name: '张三', aliases: ['2026001', '01'] },
      { name: '李四', aliases: ['2026002', '02'] },
    ])
  })

  it('英文表头别名(name/student_id/exam_number)与列序乱排', () => {
    const roster = rosterFromMatrix([
      ['exam_number', 'name', 'student_id'],
      ['07', '王五', 'S-003'],
    ])
    expect(roster).toEqual([{ name: '王五', aliases: ['S-003', '07'] }])
  })

  it('标题行在表头之上(学校核定表常见)也能定位;空名行跳过;重名保留首个', () => {
    const roster = rosterFromMatrix([
      ['某某中学 2026 年春季花名册'],
      ['姓名', '学号'],
      ['张三', '2026001'],
      ['', '2026009'],
      ['张三', '2026010'],
    ])
    expect(roster).toEqual([{ name: '张三', aliases: ['2026001'] }])
  })

  it('没有姓名列返回空数组', () => {
    expect(rosterFromMatrix([['学号', '分数'], ['001', '90']])).toEqual([])
  })
})

describe('rosterFromText — md 表格与按行', () => {
  it('Markdown 表格: 表头启发 + 学号考号进 aliases', () => {
    const md = [
      '# 九班名册',
      '',
      '| 姓名 | 学号 | 考号 |',
      '| --- | --- | --- |',
      '| 张三 | 2026001 | 01 |',
      '| 李四 | 2026002 | 02 |',
    ].join('\n')
    expect(rosterFromText(md)).toEqual([
      { name: '张三', aliases: ['2026001', '01'] },
      { name: '李四', aliases: ['2026002', '02'] },
    ])
  })

  it('按行模式: 每行首列为姓名,后续 token 进 aliases;# 标题行跳过', () => {
    const txt = ['# 名册', '王五', '赵六 2026003', '孙七,2026004,03']
    expect(rosterFromText(txt.join('\n'))).toEqual([
      { name: '王五', aliases: undefined },
      { name: '赵六', aliases: ['2026003'] },
      { name: '孙七', aliases: ['2026004', '03'] },
    ])
  })
})

describe('rosterFromYamlData — 结构化解析', () => {
  it('students 包装数组 + 键别名(name/student_id/exam_number/编号)', () => {
    const parsed = {
      class: '九班',
      students: [
        { name: '张三', student_id: '2026001', exam_number: '01' },
        { 姓名: '李四', 编号: '2026002' },
        '王五',
      ],
    }
    expect(rosterFromYamlData(parsed, 'r.yaml')).toEqual([
      { name: '张三', aliases: ['2026001', '01'] },
      { name: '李四', aliases: ['2026002'] },
      { name: '王五', aliases: undefined },
    ])
  })

  it('顶层数组直接是名单;数字学号转字符串', () => {
    const parsed = [{ name: '张三', student_id: 2026001 }]
    expect(rosterFromYamlData(parsed, 'r.yaml')).toEqual([
      { name: '张三', aliases: ['2026001'] },
    ])
  })

  it('非名单结构抛教师可读错误', () => {
    expect(() => rosterFromYamlData({ foo: 1 }, 'r.yaml')).toThrow('students 数组')
    expect(() => rosterFromYamlData('张三', 'r.yaml')).toThrow('students 数组')
  })
})

// ---------- parseRosterFile(真实文件) ----------

describe('parseRosterFile — 名册夹具', () => {
  it('xlsx 名册 → StudentCandidate[]', async () => {
    const XLSX = require('xlsx') as typeof import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['姓名', '学号', '考号'],
        ['张三', '2026001', '01'],
        ['李四', '2026002', '02'],
      ]),
      'students',
    )
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const p = await writeFixture('roster.xlsx', buf)
    await expect(parseRosterFile(p)).resolves.toEqual([
      { name: '张三', aliases: ['2026001', '01'] },
      { name: '李四', aliases: ['2026002', '02'] },
    ])
  })

  it('csv 名册(utf8) → StudentCandidate[]', async () => {
    const p = await writeFixture('roster.csv', '姓名,学号,考号\n张三,2026001,01\n李四,2026002,02\n')
    await expect(parseRosterFile(p)).resolves.toEqual([
      { name: '张三', aliases: ['2026001', '01'] },
      { name: '李四', aliases: ['2026002', '02'] },
    ])
  })

  it('GBK 编码 csv(中文 Windows ANSI 导出) → 不乱码', async () => {
    // 「姓名,学号\n张三,2026001\n」的 GBK 字节序列
    const gbk = Buffer.from([
      0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xd1, 0xa7, 0xba, 0xc5, 0x0a, 0xd5, 0xc5, 0xc8, 0xfd, 0x2c,
      0x32, 0x30, 0x32, 0x36, 0x30, 0x30, 0x31, 0x0a,
    ])
    const p = await writeFixture('roster-gbk.csv', gbk)
    await expect(parseRosterFile(p)).resolves.toEqual([{ name: '张三', aliases: ['2026001'] }])
  })

  it('md 名册(Markdown 表格) → StudentCandidate[]', async () => {
    const md = [
      '| 姓名 | 学号 | 考号 |',
      '| --- | --- | --- |',
      '| 张三 | 2026001 | 01 |',
      '| 李四 | 2026002 | 02 |',
    ].join('\n')
    const p = await writeFixture('roster.md', md)
    await expect(parseRosterFile(p)).resolves.toEqual([
      { name: '张三', aliases: ['2026001', '01'] },
      { name: '李四', aliases: ['2026002', '02'] },
    ])
  })

  it('txt 名册(每行一人) → StudentCandidate[]', async () => {
    const p = await writeFixture('roster.txt', '王五\n赵六 2026003\n')
    await expect(parseRosterFile(p)).resolves.toEqual([
      { name: '王五', aliases: undefined },
      { name: '赵六', aliases: ['2026003'] },
    ])
  })

  it('yaml 名册 → StudentCandidate[]', async () => {
    const yaml = [
      'students:',
      '  - name: 张三',
      "    student_id: '2026001'",
      "    exam_number: '01'",
      '  - name: 李四',
      "    exam_number: '02'",
    ].join('\n')
    const p = await writeFixture('roster.yaml', yaml)
    await expect(parseRosterFile(p)).resolves.toEqual([
      { name: '张三', aliases: ['2026001', '01'] },
      { name: '李四', aliases: ['02'] },
    ])
  })

  it('50 人花名册(xlsx)全量解析', async () => {
    const XLSX = require('xlsx') as typeof import('xlsx')
    const rows: unknown[][] = [['姓名', '学号', '考号']]
    for (let i = 1; i <= 50; i++) {
      rows.push([`学生${String(i).padStart(2, '0')}`, `2026${String(i).padStart(3, '0')}`, String(i).padStart(2, '0')])
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'students')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const p = await writeFixture('roster-50.xlsx', buf)
    const roster = await parseRosterFile(p)
    expect(roster).toHaveLength(50)
    expect(roster[0]).toEqual({ name: '学生01', aliases: ['2026001', '01'] })
    expect(roster[49]).toEqual({ name: '学生50', aliases: ['2026050', '50'] })
  })
})

describe('parseRosterFile — 错误路径(教师可读)', () => {
  it('坏文件(垃圾字节 xlsx) → 表格解析失败', async () => {
    const p = await writeFixture('bad.xlsx', Buffer.from([0x01, 0x02, 0x03, 0x04]))
    await expect(parseRosterFile(p)).rejects.toThrow('名册表格解析失败')
  })

  it('坏 yaml → YAML 解析失败', async () => {
    const p = await writeFixture('bad.yaml', 'students: [ 张三,')
    await expect(parseRosterFile(p)).rejects.toThrow('YAML 解析失败')
  })

  it('空表(无姓名列) → 名册中没有可解析的学生行', async () => {
    const XLSX = require('xlsx') as typeof import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['学号', '分数'], ['001', '90']]), 's')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const p = await writeFixture('no-name-col.xlsx', buf)
    await expect(parseRosterFile(p)).rejects.toThrow('找不到姓名列')
  })

  it('空 txt → 教师可读错误', async () => {
    const p = await writeFixture('empty.txt', '   \n \n')
    await expect(parseRosterFile(p)).rejects.toThrow('名册中没有可解析的学生行')
  })

  it('不支持扩展名 → 明确列出支持格式', async () => {
    const p = await writeFixture('roster.json', '{"students":[]}')
    await expect(parseRosterFile(p)).rejects.toThrow('不支持的名册格式')
  })

  it('文件不存在 → 教师可读错误', async () => {
    await expect(parseRosterFile(path.join(tmpRootAbs, 'no-such-roster.csv'))).rejects.toThrow(
      '不存在',
    )
  })

  it('超过大小上限(>25MB 零填充文件) → 拒绝且不读内容', async () => {
    expect(MAX_ROSTER_FILE_BYTES).toBe(25 * 1024 * 1024)
    const p = await writeFixture('huge.csv', Buffer.alloc(MAX_ROSTER_FILE_BYTES + 1))
    await expect(parseRosterFile(p)).rejects.toThrow('超过 25MB 上限')
  })
})
