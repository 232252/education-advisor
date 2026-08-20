// =============================================================
// 学生 Excel 批量导入测试（M30）
// 1. 纯解析单测: 合法/缺列/重名/空行/已存在/班级不存在/非法姓名
// 2. handler 集成测试: parse-excel / import-excel(进度推送+行级失败) /
//    import-template(模板生成), mock electron + eaaBridge + classService
// 3. 验证场景: 50 行样例(含 5 行问题数据) → 成功 45 + 失败清单 5
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as IPC from '../../src/shared/ipc-channels'

// ---------- hoisted mocks（必须在模块 import 前生效） ----------

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  eaaExecute: vi.fn(),
  classList: [] as Array<{
    id: string
    class_id: string
    name: string
    archived: boolean
    created_at: number
  }>,
  existingStudents: [] as Array<{ name: string; status: string }>,
  invalidate: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
}))

vi.mock('../../src/main/services/eaa-bridge', () => ({
  eaaBridge: { execute: mocks.eaaExecute },
}))

vi.mock('../../src/main/services/class-service', () => ({
  classService: { list: () => mocks.classList },
}))

vi.mock('../../src/main/ipc/eaa-handlers', () => ({
  invalidateStudentsCacheExternal: mocks.invalidate,
}))

const { registerStudentExcelHandlers } = await import(
  '../../src/main/ipc/students/excel-import-handlers'
)
const {
  buildClassIndex,
  parseStudentImportMatrix,
  resolveHeaderIndexes,
  validateExcelFilePath,
} = await import('../../src/main/ipc/students/excel-import')

// ---------- 测试基础设施 ----------

const tmpRoot = path.join(
  os.tmpdir(),
  `students-excel-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

/** 写一个单表 xlsx 到临时目录 */
function writeExcel(fileName: string, rows: unknown[][]): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx') as typeof import('xlsx')
  const filePath = path.join(tmpRoot, fileName)
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, 'students')
  XLSX.writeFile(workbook, filePath)
  return filePath
}

/** 已注册 handler 的通道 → 函数映射 */
const handlers = new Map<string, (...args: unknown[]) => unknown>()

/** 构造带 sender.send 的伪 IpcMainInvokeEvent（进度推送断言用） */
function makeEvent() {
  const sender = { send: vi.fn(), isDestroyed: () => false }
  return { event: { sender }, sender }
}

beforeAll(async () => {
  await fsp.mkdir(tmpRoot, { recursive: true })
  registerStudentExcelHandlers()
  for (const [channel, fn] of mocks.handle.mock.calls as Array<[string, unknown]>) {
    handlers.set(channel, fn as (...args: unknown[]) => unknown)
  }
})

afterAll(async () => {
  try {
    await fsp.rm(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.classList.length = 0
  mocks.classList.push(
    { id: '1', class_id: 'G7-1', name: '七年级1班', archived: false, created_at: 0 },
    { id: '2', class_id: 'G7-2', name: '七年级2班', archived: false, created_at: 0 },
  )
  mocks.existingStudents.length = 0
  // 默认: list-students 成功返回现有学生; 写命令全部成功
  mocks.eaaExecute.mockImplementation(async (cmd: { command: string }) => {
    if (cmd.command === 'list-students') {
      return { success: true, data: { students: mocks.existingStudents }, stderr: '', exitCode: 0 }
    }
    return { success: true, data: null, stderr: '', exitCode: 0 }
  })
})

// =============================================================
// 1. 纯解析单测 (parseStudentImportMatrix / resolveHeaderIndexes)
// =============================================================

describe('resolveHeaderIndexes — 表头识别', () => {
  it('标准表头: name 必填, student_id/class_name 可选', () => {
    const h = resolveHeaderIndexes(['name', 'student_id', 'class_name'])
    expect(h).toEqual({ name: 0, studentId: 1, className: 2 })
  })

  it('表头大小写与首尾空格不敏感, 列序可乱', () => {
    const h = resolveHeaderIndexes([' Class_Name ', 'NAME', 'Student_ID'])
    expect(h).toEqual({ name: 1, studentId: 2, className: 0 })
  })

  it('缺 name 列返回 null', () => {
    expect(resolveHeaderIndexes(['student_id', 'class_name'])).toBeNull()
    expect(resolveHeaderIndexes([])).toBeNull()
  })

  it('多余列被忽略', () => {
    const h = resolveHeaderIndexes(['备注', 'name', '学号'])
    expect(h?.name).toBe(1)
    expect(h?.studentId).toBe(-1)
    expect(h?.className).toBe(-1)
  })
})

describe('validateExcelFilePath — 路径防护', () => {
  it('xlsx/xls 通过', () => {
    expect(validateExcelFilePath('C:/data/students.xlsx').ok).toBe(true)
    expect(validateExcelFilePath('C:/data/students.xls').ok).toBe(true)
  })

  it('空路径 / NUL 字节 / 路径遍历 / 非法扩展名拒绝', () => {
    expect(validateExcelFilePath('').ok).toBe(false)
    expect(validateExcelFilePath('C:/a\x00b.xlsx').ok).toBe(false)
    expect(validateExcelFilePath('C:/../etc/passwd.xlsx').ok).toBe(false)
    expect(validateExcelFilePath('C:/data/students.json').ok).toBe(false)
  })

  it('自定义白名单(模板仅 .xlsx)', () => {
    expect(validateExcelFilePath('C:/t.xlsx', ['.xlsx']).ok).toBe(true)
    expect(validateExcelFilePath('C:/t.xls', ['.xlsx']).ok).toBe(false)
  })
})

describe('parseStudentImportMatrix — 行解析与冲突检测', () => {
  const emptyExisting = new Set<string>()
  const classIndex = buildClassIndex([
    { id: '1', class_id: 'G7-1', name: '七年级1班', archived: false, created_at: 0 },
  ])

  it('合法行: 全列解析 + 行号从 Excel 第 2 行起', () => {
    const preview = parseStudentImportMatrix(
      [['name', 'student_id', 'class_name'], ['张三', 'S-001', '七年级1班'], ['李四', '', '']],
      emptyExisting,
      classIndex,
    )
    expect(preview.success).toBe(true)
    expect(preview.totalRows).toBe(2)
    expect(preview.errors).toEqual([])
    expect(preview.rows).toEqual([
      { row: 2, name: '张三', studentId: 'S-001', className: '七年级1班', classId: 'G7-1' },
      { row: 3, name: '李四', studentId: '', className: '', classId: null },
    ])
  })

  it('缺 name 表头: 整表失败并提示模板列', () => {
    const preview = parseStudentImportMatrix(
      [['student_id', 'class_name'], ['S-001', '七年级1班']],
      emptyExisting,
      classIndex,
    )
    expect(preview.success).toBe(false)
    expect(preview.error).toContain('name')
  })

  it('空矩阵: 失败', () => {
    expect(parseStudentImportMatrix([], emptyExisting, classIndex).success).toBe(false)
  })

  it('空行: 记 empty_row 错误且不占可导入行', () => {
    const preview = parseStudentImportMatrix(
      [['name'], ['张三'], [' ', ' ', ' '], ['李四']],
      emptyExisting,
      classIndex,
    )
    expect(preview.rows.map((r) => r.name)).toEqual(['张三', '李四'])
    expect(preview.errors).toEqual([{ row: 3, name: '', reason: 'empty_row' }])
    expect(preview.totalRows).toBe(3)
  })

  it('缺 name: 记 missing_name', () => {
    const preview = parseStudentImportMatrix(
      [['name', 'class_name'], ['', '七年级1班']],
      emptyExisting,
      classIndex,
    )
    expect(preview.rows).toEqual([])
    expect(preview.errors).toEqual([{ row: 2, name: '', reason: 'missing_name' }])
  })

  it('文件内重名: 后出现的行记 duplicate_in_file', () => {
    const preview = parseStudentImportMatrix(
      [['name'], ['张三'], ['张三']],
      emptyExisting,
      classIndex,
    )
    expect(preview.rows.map((r) => r.name)).toEqual(['张三'])
    expect(preview.errors).toEqual([{ row: 3, name: '张三', reason: 'duplicate_in_file' }])
  })

  it('已存在学生(非 Deleted): 记 already_exists', () => {
    const preview = parseStudentImportMatrix(
      [['name'], ['王五']],
      new Set(['王五']),
      classIndex,
    )
    expect(preview.rows).toEqual([])
    expect(preview.errors).toEqual([{ row: 2, name: '王五', reason: 'already_exists' }])
  })

  it('班级不存在: 记 class_not_found; 班级编号可直接匹配', () => {
    const preview = parseStudentImportMatrix(
      [['name', 'class_name'], ['张三', '不存在的班'], ['李四', 'G7-1']],
      emptyExisting,
      classIndex,
    )
    expect(preview.rows).toEqual([
      { row: 3, name: '李四', studentId: '', className: 'G7-1', classId: 'G7-1' },
    ])
    expect(preview.errors).toEqual([{ row: 2, name: '张三', reason: 'class_not_found' }])
  })

  it('非法姓名(含路径分隔符): 记 invalid_name', () => {
    const preview = parseStudentImportMatrix(
      [['name'], ['张/三']],
      emptyExisting,
      classIndex,
    )
    expect(preview.rows).toEqual([])
    expect(preview.errors).toEqual([{ row: 2, name: '张/三', reason: 'invalid_name' }])
  })

  it('超出最大行数: 失败', () => {
    const matrix: unknown[][] = [['name']]
    for (let i = 0; i < 5001; i++) matrix.push([`学生${i}`])
    const preview = parseStudentImportMatrix(matrix, emptyExisting, classIndex)
    expect(preview.success).toBe(false)
    expect(preview.error).toContain('5000')
  })
})

// =============================================================
// 2. handler 集成测试 (真实 xlsx 文件 + mock eaaBridge/classService)
// =============================================================

describe('students:parse-excel handler', () => {
  const parse = (filePath: string) =>
    (handlers.get(IPC.IPC_STUDENTS_PARSE_EXCEL) as (e: unknown, p: string) => Promise<unknown>)(
      makeEvent().event,
      filePath,
    )

  it('真实 xlsx 文件: 解析返回预览 + class_name 解析为 class_id', async () => {
    const file = writeExcel('ok.xlsx', [
      ['name', 'student_id', 'class_name'],
      ['张三', 'S-001', '七年级1班'],
      ['李四', 'S-002', 'G7-2'],
    ])
    const preview = (await parse(file)) as {
      success: boolean
      rows: Array<{ name: string; classId: string | null }>
      errors: unknown[]
      totalRows: number
    }
    expect(preview.success).toBe(true)
    expect(preview.totalRows).toBe(2)
    expect(preview.errors).toEqual([])
    expect(preview.rows[0]).toMatchObject({ name: '张三', classId: 'G7-1' })
    expect(preview.rows[1]).toMatchObject({ name: '李四', classId: 'G7-2' })
  })

  it('list-students 失败: 返回解析失败', async () => {
    mocks.eaaExecute.mockResolvedValue({
      success: false,
      data: null,
      stderr: 'binary missing',
      exitCode: 1,
    })
    const file = writeExcel('eaa-down.xlsx', [['name'], ['张三']])
    const preview = (await parse(file)) as { success: boolean; error?: string }
    expect(preview.success).toBe(false)
    expect(preview.error).toContain('binary missing')
  })

  it('非法路径(.json 扩展名): 直接拒绝', async () => {
    const preview = (await parse('C:/data/students.json')) as { success: boolean; error?: string }
    expect(preview.success).toBe(false)
    expect(preview.error).toContain('extension')
  })

  it('文件不存在: 捕获读取异常返回失败', async () => {
    const preview = (await parse(path.join(tmpRoot, 'no-such-file.xlsx'))) as {
      success: boolean
      error?: string
    }
    expect(preview.success).toBe(false)
    expect(preview.error).toBeTruthy()
  })
})

describe('students:import-excel handler', () => {
  const importExcel = (params: unknown, ev?: unknown) =>
    (handlers.get(IPC.IPC_STUDENTS_IMPORT_EXCEL) as (e: unknown, p: unknown) => Promise<unknown>)(
      ev ?? makeEvent().event,
      params,
    )

  it('逐条 add-student + 有 class_id 时联动 set-student-meta + 进度推送', async () => {
    const { event, sender } = makeEvent()
    const result = (await importExcel(
      {
        rows: [
          { row: 2, name: '张三', classId: 'G7-1' },
          { row: 3, name: '李四', classId: null },
        ],
      },
      event,
    )) as { success: boolean; total: number; imported: number; failed: unknown[] }

    expect(result).toEqual({ success: true, total: 2, imported: 2, failed: [] })
    const calls = mocks.eaaExecute.mock.calls.map(([c]) => c) as Array<{
      command: string
      args: string[]
    }>
    expect(calls.filter((c) => c.command === 'add-student').map((c) => c.args)).toEqual([
      ['张三'],
      ['李四'],
    ])
    expect(calls.filter((c) => c.command === 'set-student-meta').map((c) => c.args)).toEqual([
      ['张三', '--class-id', 'G7-1'],
    ])
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
    // 进度推送: 0/total 起始 + 每行一次
    const sends = (sender.send as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, unknown]
    >
    expect(sends.map(([ch]) => ch)).toEqual(
      Array.from({ length: 3 }, () => IPC.IPC_STUDENTS_IMPORT_PROGRESS),
    )
    expect(sends[0][1]).toEqual({ current: 0, total: 2, imported: 0, lastName: '' })
    expect(sends[2][1]).toEqual({ current: 2, total: 2, imported: 2, lastName: '李四' })
  })

  it('行级失败收集: add-student 失败的行进入失败清单, 其余继续', async () => {
    mocks.eaaExecute.mockImplementation(async (cmd: { command: string; args: string[] }) => {
      if (cmd.command === 'add-student' && cmd.args[0] === '坏行') {
        return { success: false, data: null, stderr: 'name conflict', exitCode: 1 }
      }
      return { success: true, data: null, stderr: '', exitCode: 0 }
    })
    const result = (await importExcel({
      rows: [
        { row: 2, name: '好行', classId: null },
        { row: 3, name: '坏行', classId: null },
        { row: 4, name: '另一好行', classId: null },
      ],
    })) as { success: boolean; imported: number; failed: Array<{ row: number; error: string }> }

    expect(result.imported).toBe(2)
    expect(result.failed).toEqual([{ row: 3, name: '坏行', error: 'name conflict' }])
  })

  it('班级分配失败: 行计入失败清单并带原因', async () => {
    mocks.eaaExecute.mockImplementation(async (cmd: { command: string }) => {
      if (cmd.command === 'set-student-meta') {
        return { success: false, data: null, stderr: 'class locked', exitCode: 1 }
      }
      return { success: true, data: null, stderr: '', exitCode: 0 }
    })
    const result = (await importExcel({
      rows: [{ row: 2, name: '张三', classId: 'G7-1' }],
    })) as { imported: number; failed: Array<{ error: string }> }

    expect(result.imported).toBe(0)
    expect(result.failed[0].error).toContain('class assign failed')
    expect(result.failed[0].error).toContain('class locked')
  })

  it('入参内重名(防御): 后出现的行失败, 不重复调用 add-student', async () => {
    const result = (await importExcel({
      rows: [
        { row: 2, name: '张三', classId: null },
        { row: 3, name: '张三', classId: null },
      ],
    })) as { imported: number; failed: Array<{ row: number; error: string }> }

    expect(result.imported).toBe(1)
    expect(result.failed).toEqual([
      { row: 3, name: '张三', error: 'duplicate name in import request' },
    ])
    const calls = mocks.eaaExecute.mock.calls.map(([c]) => c) as Array<{
      command: string
      args: string[]
    }>
    expect(calls.filter((c) => c.command === 'add-student')).toHaveLength(1)
  })

  it('非法入参: rows 非数组/空数组返回失败', async () => {
    const r1 = (await importExcel(null)) as { success: boolean; error: string }
    expect(r1.success).toBe(false)
    const r2 = (await importExcel({ rows: [] })) as { success: boolean; error: string }
    expect(r2.success).toBe(false)
    expect(r2.error).toContain('empty')
  })

  it('非法姓名行: 收集错误不中断循环', async () => {
    const result = (await importExcel({
      rows: [{ row: 2, name: '张/三', classId: null }],
    })) as { imported: number; failed: Array<{ error: string }> }

    expect(result.imported).toBe(0)
    expect(result.failed[0].error).toContain('name')
  })
})

describe('students:import-template handler', () => {
  const template = (filePath: string) =>
    (handlers.get(IPC.IPC_STUDENTS_IMPORT_TEMPLATE) as (e: unknown, p: string) => Promise<unknown>)(
      makeEvent().event,
      filePath,
    )

  it('生成模板文件, 表头为 name/student_id/class_name', async () => {
    const file = path.join(tmpRoot, 'template.xlsx')
    const result = (await template(file)) as { success: boolean; filePath?: string }
    expect(result.success).toBe(true)
    expect(result.filePath).toBe(file)
    // 读回验证表头
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require('xlsx') as typeof import('xlsx')
    const wb = XLSX.readFile(file)
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
      defval: '',
    }) as unknown[][]
    expect(matrix).toEqual([['name', 'student_id', 'class_name']])
  })

  it('.xls 扩展名拒绝(模板仅 .xlsx)', async () => {
    const result = (await template(path.join(tmpRoot, 'template.xls'))) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('extension')
  })
})

// =============================================================
// 3. 验证场景: 50 行样例 Excel(含 5 行问题数据) → 成功 45 + 失败清单 5
// =============================================================

describe('M30 验证: 50 行样例导入', () => {
  it('解析: 45 可导入 + 5 问题行(空行/缺 name/重名/已存在)', async () => {
    // 现有学生: 已有甲 (already_exists 冲突源)
    mocks.existingStudents.push({ name: '样例甲', status: 'Active' })

    const rows: unknown[][] = [['name', 'student_id', 'class_name']]
    // 45 行合法数据(轮转两个班级)
    for (let i = 1; i <= 45; i++) {
      rows.push([`学生${String(i).padStart(2, '0')}`, `S-${String(i).padStart(3, '0')}`, i % 2 === 0 ? '七年级1班' : '七年级2班'])
    }
    // 5 行问题数据: 空行 / 缺 name / 缺 name / 文件内重名 / 已存在学生
    rows.push([' ', ' ', ' '])                       // 空行
    rows.push(['', 'S-046', '七年级1班'])             // 缺 name
    rows.push(['', 'S-047', '七年级2班'])             // 缺 name
    rows.push(['学生01', 'S-048', ''])               // 文件内重名(与第 1 条合法行同名)
    rows.push(['样例甲', 'S-049', ''])               // 已存在学生
    expect(rows).toHaveLength(51) // 表头 + 50 数据行

    const file = writeExcel('sample-50.xlsx', rows)
    const parse = handlers.get(IPC.IPC_STUDENTS_PARSE_EXCEL) as (
      e: unknown,
      p: string,
    ) => Promise<unknown>
    const preview = (await parse(makeEvent().event, file)) as {
      success: boolean
      rows: Array<{ name: string; classId: string | null }>
      errors: Array<{ row: number; reason: string }>
      totalRows: number
    }

    expect(preview.success).toBe(true)
    expect(preview.totalRows).toBe(50)
    expect(preview.rows).toHaveLength(45)
    expect(preview.errors).toHaveLength(5)
    expect(preview.errors.map((e) => e.reason).sort()).toEqual([
      'already_exists',
      'duplicate_in_file',
      'empty_row',
      'missing_name',
      'missing_name',
    ])

    // 导入确认: 45 行逐条 add-student → 成功 45 + 失败清单 0
    const { event } = makeEvent()
    const importExcel = handlers.get(IPC.IPC_STUDENTS_IMPORT_EXCEL) as (
      e: unknown,
      p: unknown,
    ) => Promise<unknown>
    const result = (await importExcel(event, {
      rows: preview.rows.map((r) => ({ row: r.row, name: r.name, classId: r.classId })),
    })) as { success: boolean; total: number; imported: number; failed: unknown[] }

    expect(result).toEqual({ success: true, total: 45, imported: 45, failed: [] })
    const calls = mocks.eaaExecute.mock.calls.map(([c]) => c) as Array<{
      command: string
      args: string[]
    }>
    expect(calls.filter((c) => c.command === 'add-student')).toHaveLength(45)
    // 45 行全部带班级 → 45 次 set-student-meta
    expect(calls.filter((c) => c.command === 'set-student-meta')).toHaveLength(45)
  })

  it('失败清单展示: 导入中 5 行 add-student 失败 → imported 40 + failed 5', async () => {
    const rows: Array<{ row: number; name: string; classId: null }> = []
    for (let i = 1; i <= 45; i++) rows.push({ row: i + 1, name: `补测${i}`, classId: null })
    mocks.eaaExecute.mockImplementation(async (cmd: { command: string; args: string[] }) => {
      if (cmd.command === 'add-student') {
        const n = Number(cmd.args[0].replace('补测', ''))
        if (n > 40) {
          return { success: false, data: null, stderr: `write failed ${n}`, exitCode: 1 }
        }
      }
      return { success: true, data: null, stderr: '', exitCode: 0 }
    })

    const { event } = makeEvent()
    const importExcel = handlers.get(IPC.IPC_STUDENTS_IMPORT_EXCEL) as (
      e: unknown,
      p: unknown,
    ) => Promise<unknown>
    const result = (await importExcel(event, { rows })) as {
      imported: number
      failed: Array<{ row: number; name: string; error: string }>
    }

    expect(result.imported).toBe(40)
    expect(result.failed).toHaveLength(5)
    expect(result.failed[0]).toEqual({ row: 42, name: '补测41', error: 'write failed 41' })
  })
})
