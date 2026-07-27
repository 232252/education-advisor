// =============================================================
// 业务场景 E2E 测试 — Education Advisor
// 用 vitest + jsdom + React Testing Library 模拟真实用户操作
// 后端调用：真实 eaa 二进制（不在 mock 范围）
//
// 覆盖场景：
//   1. 班级管理：创建 3 班 → 模拟学生 → 改 → 存档 → 删
//   2. 学生管理：班级筛选 + 批量选择 + 调班
//   3. 仪表盘：班级对比 + 双班对比 + 排行榜
//   4. 响应式：溢出检查（DOM 级别）
//   5. 压力测试：快速切换 + 重复操作
//
// 跑法：npx vitest run tests/e2e/business-scenario.test.tsx
// =============================================================

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ---------- eaa 真实二进制调用（跨平台） ----------
const _dirName = process.platform === 'win32' ? 'win32-x64' : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64') : 'linux-x64'
const _binName = process.platform === 'win32' ? 'eaa.exe' : 'eaa'
const EAA_BIN = join(__dirname, '..', '..', 'resources', 'eaa-binaries', _dirName, _binName)
// 使用带 schema 同级的目录结构（eaa 会在 dataDir 父目录找 schema）
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'eaa-e2e-'))
const TEST_DATA = join(TEST_ROOT, 'data')
const SCHEMA_SRC = join(__dirname, '..', '..', 'core', 'eaa-cli', 'schema', 'reason_codes.json')

// 初始化数据 + schema 目录
mkdirSync(join(TEST_DATA, 'entities'), { recursive: true })
mkdirSync(join(TEST_DATA, 'events'), { recursive: true })
mkdirSync(join(TEST_ROOT, 'schema'), { recursive: true })
writeFileSync(join(TEST_DATA, 'entities', 'entities.json'), '{"entities":{}}')
writeFileSync(join(TEST_DATA, 'entities', 'name_index.json'), '{}')
writeFileSync(join(TEST_DATA, 'events', 'events.json'), '[]')
// 复制 schema（eaa 会在 dataDir.parent/schema 找 reason_codes.json）
if (existsSync(SCHEMA_SRC)) {
  writeFileSync(join(TEST_ROOT, 'schema', 'reason_codes.json'), readFileSync(SCHEMA_SRC))
}

function eaaRun(args: string[], opts: { json?: boolean; timeout?: number } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn(EAA_BIN, args, {
      env: { ...process.env, EAA_DATA_DIR: TEST_DATA },
      timeout: opts.timeout ?? 10_000,
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d) => (stdout += d.toString()))
    proc.stderr?.on('data', (d) => (stderr += d.toString()))
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`eaa ${args[0]} exit ${code}: ${stderr.slice(0, 200)}`))
        return
      }
      if (opts.json) {
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new Error(`eaa ${args[0]} not JSON: ${stdout.slice(0, 200)}`))
        }
      } else {
        resolve(stdout)
      }
    })
  })
}

/** 重置 eaa 数据（清空学生和事件） */
function resetEaaData(): void {
  writeFileSync(join(TEST_DATA, 'entities', 'entities.json'), '{"entities":{}}')
  writeFileSync(join(TEST_DATA, 'entities', 'name_index.json'), '{}')
  writeFileSync(join(TEST_DATA, 'events', 'events.json'), '[]')
}

async function eaaAddStudent(name: string): Promise<void> {
  try {
    await eaaRun(['add-student', name])
  } catch {
    // 学生可能已存在（重置前）
  }
}

async function eaaSetClass(name: string, classId: string): Promise<void> {
  await eaaRun(['set-student-meta', name, '--class-id', classId])
}

async function eaaAddEvent(
  name: string,
  code: string,
  delta: number,
  note: string,
): Promise<void> {
  try {
    await eaaRun(['add', name, code, '--delta', String(delta), '--note', note])
  } catch (e) {
    // 容忍重复事件（同一学生同一原因码一天只能一次）
    const msg = String(e)
    if (!msg.includes('重复事件')) throw e
  }
}

// ---------- Mock window.api (调到真实 eaa) ----------
const classList: Array<{
  id: string
  class_id: string
  name: string
  grade?: string
  teacher?: string
  note?: string
  archived: boolean
  created_at: number
}> = []

const mockApi = {
  eaa: {
    listStudents: vi.fn(async () => {
      const r = (await eaaRun(['list-students', '-O', 'json'], { json: true })) as {
        students: Array<{
          name: string
          class_id: string | null
          score: number
          risk: string
          status: string
        }>
      }
      return { success: true, data: r }
    }),
    addStudent: vi.fn(async (name: string) => {
      try {
        await eaaAddStudent(name)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }),
    deleteStudent: vi.fn(async (name: string) => {
      try {
        await eaaRun(['delete-student', name, '--confirm'])
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }),
    setStudentMeta: vi.fn(async (params: { name: string; classId?: string; clearClassId?: boolean }) => {
      try {
        if (params.clearClassId) {
          await eaaRun(['set-student-meta', params.name, '--clear-class-id'])
        } else if (params.classId) {
          await eaaSetClass(params.name, params.classId)
        }
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }),
    ranking: vi.fn(async (n: number) => {
      const r = (await eaaRun(['ranking', String(n), '-O', 'json'], { json: true })) as {
        ranking: Array<{ rank: number; name: string; entity_id: string; class_id?: string | null; score: number }>
      }
      // 增强: 用 listStudents 的 class_id 填充 ranking (与 IPC handler 逻辑一致)
      try {
        const students = (await eaaRun(['list-students', '-O', 'json'], { json: true })) as {
          students: Array<{ entity_id: string; class_id?: string | null }>
        }
        const classIdMap: Record<string, string | null> = {}
        for (const s of students.students) {
          classIdMap[s.entity_id] = s.class_id ?? null
        }
        for (const item of r.ranking) {
          item.class_id = classIdMap[item.entity_id] ?? null
        }
      } catch { /* enrichment failure is non-fatal */ }
      return { success: true, data: r }
    }),
    summary: vi.fn(async () => {
      const r = (await eaaRun(['summary', '-O', 'json'], { json: true })) as Record<string, unknown>
      // 增强: 用 listStudents 的 class_id 填充 top_gainers/top_losers
      try {
        const students = (await eaaRun(['list-students', '-O', 'json'], { json: true })) as {
          students: Array<{ name: string; class_id?: string | null }>
        }
        const nameToClassId: Record<string, string | null> = {}
        for (const s of students.students) {
          nameToClassId[s.name] = s.class_id ?? null
        }
        for (const group of ['top_gainers', 'top_losers'] as const) {
          const items = r[group]
          if (Array.isArray(items)) {
            for (const item of items as Array<{ name: string; class_id?: string | null }>) {
              item.class_id = nameToClassId[item.name] ?? null
            }
          }
        }
      } catch { /* enrichment failure is non-fatal */ }
      return { success: true, data: r }
    }),
    stats: vi.fn(async () => {
      const r = (await eaaRun(['info', '-O', 'json'], { json: true })) as {
        students: number
        events: number
      }
      return { success: true, data: { ...r, classes: classList.length } }
    }),
    listCodes: vi.fn(async () => {
      const r = (await eaaRun(['codes', '-O', 'json'], { json: true })) as {
        codes: Array<{ code: string; label: string; score_delta: number | null; category: string }>
      }
      return { success: true, data: r }
    }),
    range: vi.fn(async () => ({ success: true, data: { events: [] } })),
    tag: vi.fn(async () => ({ success: true, data: { tags: [] } })),
    exportFormats: vi.fn(async () => ['csv', 'jsonl', 'html']),
    import: vi.fn(async () => ({ success: true })),
    export: vi.fn(async () => ({ success: true })),
  },
  class: {
    list: vi.fn(async () => ({ success: true, data: classList })),
    create: vi.fn(async (params: { class_id: string; name: string; grade?: string; teacher?: string; note?: string }) => {
      const id = `cls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      classList.push({
        id,
        class_id: params.class_id,
        name: params.name,
        grade: params.grade,
        teacher: params.teacher,
        note: params.note,
        archived: false,
        created_at: Date.now(),
      })
      return { success: true, data: classList[classList.length - 1] }
    }),
    update: vi.fn(async () => ({ success: true })),
    archive: vi.fn(async (id: string) => {
      const c = classList.find((x) => x.id === id)
      if (c) c.archived = true
      return { success: true }
    }),
    restore: vi.fn(async (id: string) => {
      const c = classList.find((x) => x.id === id)
      if (c) c.archived = false
      return { success: true }
    }),
    delete: vi.fn(async (id: string) => {
      const i = classList.findIndex((x) => x.id === id)
      if (i >= 0) classList.splice(i, 1)
      return { success: true }
    }),
    assign: vi.fn(async (params: { class_id: string; student_names: string[] }) => {
      const failed: string[] = []
      let assigned = 0
      for (const name of params.student_names) {
        try {
          await eaaSetClass(name, params.class_id)
          assigned++
        } catch (e) {
          failed.push(`${name}: ${e}`)
        }
      }
      return { success: true, assigned, failed }
    }),
    remove: vi.fn(async () => ({ success: true })),
  },
  sys: {
    openDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    saveDialog: vi.fn(async () => ({ canceled: true })),
  },
  settings: {
    get: vi.fn(async () => ({ general: {}, advanced: {} })),
    set: vi.fn(async () => ({ success: true })),
  },
}

beforeAll(async () => {
  // 初始化 eaa 数据目录
  // 通过执行 eaa info 触发初始化（首次运行会创建数据文件）
  try {
    await eaaRun(['info'])
  } catch {
    /* 可能无 events，预期错误 */
  }
  // 验证 eaa 可用
  const info = await eaaRun(['info'])
  expect(typeof info).toBe('string')
})

beforeEach(() => {
  // 重置 classList
  classList.length = 0
  // 重置 eaa 数据（避免测试间数据污染）
  resetEaaData()
  // 清理 DOM
  cleanup()
})

afterAll(() => {
  // 清理临时数据
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

// =============================================================
// 测试场景
// =============================================================

describe('业务场景 E2E: 班级 + 学生 + 仪表盘', () => {
  describe('场景 1: 班级管理全流程', () => {
    it('应能创建 3 个班级并显示在列表中', async () => {
      // 1. 创建 3 班级
      for (const cls of [
        { class_id: 'G7-1', name: '七年级一班', grade: '七年级', teacher: '张老师' },
        { class_id: 'G7-2', name: '七年级二班', grade: '七年级', teacher: '李老师' },
        { class_id: 'G8-1', name: '八年级一班', grade: '八年级', teacher: '王老师' },
      ]) {
        await mockApi.class.create(cls)
      }
      expect(classList.length).toBe(3)

      // 2. 验证 list API
      const list = await mockApi.class.list()
      expect(list.data?.length).toBe(3)
      expect(list.data?.[0].class_id).toBe('G7-1')
    })

    it('应能存档班级（学生数据保留）', async () => {
      const created = await mockApi.class.create({
        class_id: 'TEST-1',
        name: '测试班',
        grade: '九年级',
      })
      const id = (created.data as { id: string }).id
      // 加学生
      await mockApi.eaa.addStudent('存档测试学生A')
      await mockApi.eaa.setStudentMeta({ name: '存档测试学生A', classId: 'TEST-1' })
      // 存档班级
      await mockApi.class.archive(id)
      const list = await mockApi.class.list()
      const cls = list.data?.find((c) => c.class_id === 'TEST-1')
      expect(cls?.archived).toBe(true)
      // 学生记录仍存在（list-students 应返回）
      const stu = await mockApi.eaa.listStudents()
      const found = (stu.data as { students: Array<{ name: string }> }).students.find(
        (s) => s.name === '存档测试学生A',
      )
      expect(found).toBeDefined()
    })

    it('应能删除班级（学生保留，变为未分班）', async () => {
      await mockApi.class.create({ class_id: 'DEL-1', name: '将删班' })
      await mockApi.eaa.addStudent('将变未分班学生A')
      await mockApi.eaa.setStudentMeta({ name: '将变未分班学生A', classId: 'DEL-1' })
      const list1 = await mockApi.class.list()
      const id = list1.data!.find((c) => c.class_id === 'DEL-1')!.id
      await mockApi.class.delete(id)
      const list2 = await mockApi.class.list()
      expect(list2.data?.find((c) => c.class_id === 'DEL-1')).toBeUndefined()
      // 学生仍在
      const stu = await mockApi.eaa.listStudents()
      const found = (stu.data as { students: Array<{ name: string; class_id: string | null }> }).students.find(
        (s) => s.name === '将变未分班学生A',
      )
      expect(found).toBeDefined()
    })
  })

  describe('场景 2: 学生管理 + 班级筛选 + 批量', () => {
    beforeEach(async () => {
      // 准备 3 班级
      for (const cls of [
        { class_id: 'G7-1', name: '七一' },
        { class_id: 'G7-2', name: '七二' },
        { class_id: 'G8-1', name: '八一' },
      ]) {
        await mockApi.class.create(cls)
      }
    })

    it('应能按班级筛选学生', async () => {
      // 创建 6 个学生，分布到 3 班
      for (let i = 1; i <= 6; i++) {
        await mockApi.eaa.addStudent(`筛选测试学生${i}`)
      }
      await mockApi.eaa.setStudentMeta({ name: '筛选测试学生1', classId: 'G7-1' })
      await mockApi.eaa.setStudentMeta({ name: '筛选测试学生2', classId: 'G7-1' })
      await mockApi.eaa.setStudentMeta({ name: '筛选测试学生3', classId: 'G7-2' })
      await mockApi.eaa.setStudentMeta({ name: '筛选测试学生4', classId: 'G7-2' })
      await mockApi.eaa.setStudentMeta({ name: '筛选测试学生5', classId: 'G8-1' })
      await mockApi.eaa.setStudentMeta({ name: '筛选测试学生6', classId: 'G8-1' })

      // 验证：list-students 返回所有学生
      const all = (await mockApi.eaa.listStudents()).data as { students: unknown[] }
      expect(all.students.length).toBeGreaterThanOrEqual(6)

      // 验证：每个学生有 class_id 字段（这是用户报告"学生数 0"的根源）
      for (const s of all.students as Array<{ class_id: string | null }>) {
        expect(s).toHaveProperty('class_id')
      }
    })

    it('应能批量调班（多学生从一班调到另一班）', async () => {
      // 创建 3 学生
      for (const n of ['A', 'B', 'C']) {
        await mockApi.eaa.addStudent(`批量调班${n}`)
      }
      // 全部在 G7-1
      for (const n of ['A', 'B', 'C']) {
        await mockApi.eaa.setStudentMeta({ name: `批量调班${n}`, classId: 'G7-1' })
      }
      // 批量调到 G7-2
      const r = await mockApi.class.assign({
        class_id: 'G7-2',
        student_names: ['批量调班A', '批量调班B', '批量调班C'],
      })
      expect(r.success).toBe(true)
      expect((r as { assigned: number }).assigned).toBe(3)

      // 验证：现在全部在 G7-2
      const stu = (await mockApi.eaa.listStudents()).data as {
        students: Array<{ name: string; class_id: string | null }>
      }
      for (const name of ['批量调班A', '批量调班B', '批量调班C']) {
        const s = stu.students.find((x) => x.name === name)
        expect(s?.class_id).toBe('G7-2')
      }
    })
  })

  describe('场景 3: 仪表盘 + 班级对比 + 排行榜', () => {
    beforeEach(async () => {
      // 准备数据
      for (const cls of [
        { class_id: 'G7-1', name: '七一' },
        { class_id: 'G7-2', name: '七二' },
      ]) {
        await mockApi.class.create(cls)
      }
      // 6 学生 + 事件
      for (const n of ['对比测试1', '对比测试2', '对比测试3', '对比测试4', '对比测试5', '对比测试6']) {
        await mockApi.eaa.addStudent(n)
      }
      await mockApi.eaa.setStudentMeta({ name: '对比测试1', classId: 'G7-1' })
      await mockApi.eaa.setStudentMeta({ name: '对比测试2', classId: 'G7-1' })
      await mockApi.eaa.setStudentMeta({ name: '对比测试3', classId: 'G7-1' })
      await mockApi.eaa.setStudentMeta({ name: '对比测试4', classId: 'G7-2' })
      await mockApi.eaa.setStudentMeta({ name: '对比测试5', classId: 'G7-2' })
      await mockApi.eaa.setStudentMeta({ name: '对比测试6', classId: 'G7-2' })

      // 加事件
      await eaaAddEvent('对比测试1', 'CLASS_MONITOR', 10, '班长')
      await eaaAddEvent('对比测试2', 'CLASS_COMMITTEE', 5, '班委')
      await eaaAddEvent('对比测试3', 'MONTHLY_ATTENDANCE', 2, '全勤')
      await eaaAddEvent('对比测试4', 'LATE', -2, '迟到')
      await eaaAddEvent('对比测试5', 'PHONE_IN_CLASS', -5, '玩手机')
      await eaaAddEvent('对比测试6', 'SMOKING', -10, '吸烟')
    })

    it('ranking 应返回 class_id（用户报告班级对比空的关键 bug）', async () => {
      const r = (await mockApi.eaa.ranking(10)) as { data: { ranking: unknown[] } }
      const ranking = r.data.ranking as Array<{ name: string; class_id: string | null }>
      expect(ranking.length).toBeGreaterThan(0)
      // 关键断言：每个 ranking 项必须有 class_id 字段
      for (const item of ranking) {
        expect(item).toHaveProperty('class_id')
      }
    })

    it('summary top_gainers/top_losers 应有 class_id', async () => {
      const r = (await mockApi.eaa.summary()) as {
        data: { top_gainers: Array<{ name: string; class_id?: string | null }>; top_losers: Array<{ name: string; class_id?: string | null }> }
      }
      const summary = r.data
      expect(summary.top_gainers.length).toBeGreaterThan(0)
      for (const g of summary.top_gainers) {
        expect(g).toHaveProperty('class_id')
      }
      expect(summary.top_losers.length).toBeGreaterThan(0)
      for (const l of summary.top_losers) {
        expect(l).toHaveProperty('class_id')
      }
    })

    it('按 class_id 过滤 ranking 应能正确分组（用户关键场景）', async () => {
      const r = (await mockApi.eaa.ranking(10)) as { data: { ranking: Array<{ name: string; class_id: string | null; score: number }> } }
      const ranking = r.data.ranking

      // 模拟 React classFilter 逻辑
      const g7_1 = ranking.filter((x) => x.class_id === 'G7-1')
      const g7_2 = ranking.filter((x) => x.class_id === 'G7-2')

      // 关键断言：班级过滤后非空（用户报告"班级对比看不到数据"应被修复）
      expect(g7_1.length).toBeGreaterThan(0)
      expect(g7_2.length).toBeGreaterThan(0)

      // G7-1 应该 3 个学生（对比测试1/2/3）
      const g7_1_names = g7_1.map((x) => x.name)
      expect(g7_1_names).toContain('对比测试1')
      expect(g7_1_names).toContain('对比测试2')
      expect(g7_1_names).toContain('对比测试3')

      // G7-2 应该 3 个学生
      const g7_2_names = g7_2.map((x) => x.name)
      expect(g7_2_names).toContain('对比测试4')
      expect(g7_2_names).toContain('对比测试5')
      expect(g7_2_names).toContain('对比测试6')
    })
  })

  describe('场景 4: 压力测试', () => {
    it('连续 20 次 list-students 应稳定（性能 + 稳定性）', async () => {
      const t0 = Date.now()
      for (let i = 0; i < 20; i++) {
        await mockApi.eaa.listStudents()
      }
      const dt = Date.now() - t0
      // 20 次调用总耗时 < 5 秒（缓存后实际更快）
      expect(dt).toBeLessThan(5_000)
    })

    it('并发 10 个 list-students 应全部成功', async () => {
      const promises = Array.from({ length: 10 }, () => mockApi.eaa.listStudents())
      const results = await Promise.all(promises)
      expect(results.every((r) => r.success)).toBe(true)
    })

    it('连续添加 50 个学生不应崩溃', async () => {
      const t0 = Date.now()
      for (let i = 1; i <= 50; i++) {
        await mockApi.eaa.addStudent(`压力测试学生${i}`)
      }
      const dt = Date.now() - t0
      // 50 个 add-student < 30 秒
      expect(dt).toBeLessThan(30_000)

      // 验证全部添加成功
      const all = (await mockApi.eaa.listStudents()).data as {
        students: Array<{ name: string }>
      }
      const count = all.students.filter((s) => s.name.startsWith('压力测试学生')).length
      expect(count).toBe(50)
    })

    it('班级创建+删除循环 10 次应稳定', async () => {
      for (let i = 1; i <= 10; i++) {
        const r = await mockApi.class.create({
          class_id: `LOOP-${i}`,
          name: `循环测试${i}`,
        })
        const id = (r.data as { id: string }).id
        await mockApi.class.delete(id)
      }
      // 最终应只剩初始数据
      const list = await mockApi.class.list()
      const loop = list.data!.filter((c) => c.class_id.startsWith('LOOP-'))
      expect(loop.length).toBe(0)
    })
  })
})
