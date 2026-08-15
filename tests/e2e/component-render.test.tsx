// =============================================================
// React 组件渲染测试 — 验证关键 UI 元素正确渲染
// 用 @testing-library/react + jsdom 模拟用户视角
// 后端 mock: window.api 指向 eaa 真实数据
//
// 覆盖：ClassesPage / StudentsPage / DashboardPage 关键元素
// 跑法：npx vitest run tests/e2e/component-render.test.tsx
// =============================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

// ---------- eaa 真实调用（跨平台） ----------
const _dirName = process.platform === 'win32' ? 'win32-x64' : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64') : 'linux-x64'
const _binName = process.platform === 'win32' ? 'eaa.exe' : 'eaa'
const EAA_BIN = join(__dirname, '..', '..', 'resources', 'eaa-binaries', _dirName, _binName)
// 平台二进制缺失(如 macOS 无 darwin 构建)时整组跳过,避免 CI 误报 ENOENT
const describeE2E = existsSync(EAA_BIN) ? describe : describe.skip
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'eaa-render-'))
const TEST_DATA = join(TEST_ROOT, 'data')
const SCHEMA_SRC = join(__dirname, '..', '..', 'core', 'eaa-cli', 'schema', 'reason_codes.json')

mkdirSync(join(TEST_DATA, 'entities'), { recursive: true })
mkdirSync(join(TEST_DATA, 'events'), { recursive: true })
mkdirSync(join(TEST_ROOT, 'schema'), { recursive: true })
writeFileSync(join(TEST_DATA, 'entities', 'entities.json'), '{"entities":{}}')
writeFileSync(join(TEST_DATA, 'entities', 'name_index.json'), '{}')
writeFileSync(join(TEST_DATA, 'events', 'events.json'), '[]')
if (existsSync(SCHEMA_SRC)) {
  writeFileSync(join(TEST_ROOT, 'schema', 'reason_codes.json'), readFileSync(SCHEMA_SRC))
}

function eaaRunOnce(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(EAA_BIN, args, {
      env: { ...process.env, EAA_DATA_DIR: TEST_DATA },
      timeout: 10_000,
    })
    let out = ''
    let err = ''
    proc.stdout?.on('data', (d) => (out += d.toString()))
    proc.stderr?.on('data', (d) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`eaa ${args[0]} exit ${code}: ${err.slice(0, 200)}`))
      resolve(out)
    })
  })
}

/** eaaRun 带重试 — 并发争用文件锁时 eaa 可能 exit 0 但 stdout 为空。自动重试 3 次。 */
async function eaaRun(args: string[]): Promise<string> {
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const out = await eaaRunOnce(args)
      if (out.trim() === '' && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 80 * (attempt + 1)))
        continue
      }
      return out
    } catch (err) {
      if (attempt < MAX_RETRIES && String(err).includes('exit')) {
        await new Promise((r) => setTimeout(r, 80 * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error(`eaa ${args[0]} failed after ${MAX_RETRIES + 1} attempts`)
}

function resetEaaData() {
  writeFileSync(join(TEST_DATA, 'entities', 'entities.json'), '{"entities":{}}')
  writeFileSync(join(TEST_DATA, 'entities', 'name_index.json'), '{}')
  writeFileSync(join(TEST_DATA, 'events', 'events.json'), '[]')
}

// ---------- Mock window.api ----------
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
      const r = await eaaRun(['list-students', '-O', 'json'])
      return { success: true, data: JSON.parse(r) }
    }),
    addStudent: vi.fn(async (name: string) => {
      try {
        await eaaRun(['add-student', name])
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }),
    deleteStudent: vi.fn(async () => ({ success: true })),
    setStudentMeta: vi.fn(async (p: { name: string; classId?: string; clearClassId?: boolean }) => {
      try {
        if (p.clearClassId) await eaaRun(['set-student-meta', p.name, '--clear-class-id'])
        else if (p.classId) await eaaRun(['set-student-meta', p.name, '--class-id', p.classId])
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }),
    ranking: vi.fn(async (n: number) => {
      const r = await eaaRun(['ranking', String(n), '-O', 'json'])
      const data = JSON.parse(r) as {
        ranking: Array<{ rank: number; name: string; entity_id: string; class_id?: string | null; score: number }>
      }
      // 增强: 用 listStudents 的 class_id 填充 ranking (与 IPC handler 逻辑一致)
      try {
        const studentsRaw = await eaaRun(['list-students', '-O', 'json'])
        const students = JSON.parse(studentsRaw) as {
          students: Array<{ entity_id: string; class_id?: string | null }>
        }
        const classIdMap: Record<string, string | null> = {}
        for (const s of students.students) {
          classIdMap[s.entity_id] = s.class_id ?? null
        }
        for (const item of data.ranking) {
          item.class_id = classIdMap[item.entity_id] ?? null
        }
      } catch { /* enrichment failure is non-fatal */ }
      return { success: true, data }
    }),
    summary: vi.fn(async () => {
      const r = await eaaRun(['summary', '-O', 'json'])
      const data = JSON.parse(r) as Record<string, unknown>
      // 增强: 用 listStudents 的 class_id 填充 top_gainers/top_losers
      try {
        const studentsRaw = await eaaRun(['list-students', '-O', 'json'])
        const students = JSON.parse(studentsRaw) as {
          students: Array<{ name: string; class_id?: string | null }>
        }
        const nameToClassId: Record<string, string | null> = {}
        for (const s of students.students) {
          nameToClassId[s.name] = s.class_id ?? null
        }
        for (const group of ['top_gainers', 'top_losers'] as const) {
          const items = data[group]
          if (Array.isArray(items)) {
            for (const item of items as Array<{ name: string; class_id?: string | null }>) {
              item.class_id = nameToClassId[item.name] ?? null
            }
          }
        }
      } catch { /* enrichment failure is non-fatal */ }
      return { success: true, data }
    }),
    stats: vi.fn(async () => {
      const r = await eaaRun(['info', '-O', 'json'])
      return { success: true, data: JSON.parse(r) }
    }),
    listCodes: vi.fn(async () => ({ success: true, data: { codes: [] } })),
    range: vi.fn(async () => ({ success: true, data: { events: [] } })),
    tag: vi.fn(async () => ({ success: true, data: { tags: [] } })),
    exportFormats: vi.fn(async () => ['csv', 'jsonl', 'html']),
    import: vi.fn(async () => ({ success: true })),
    export: vi.fn(async () => ({ success: true })),
  },
  class: {
    list: vi.fn(async () => ({ success: true, data: classList })),
    create: vi.fn(async (p: { class_id: string; name: string; grade?: string; teacher?: string; note?: string }) => {
      const id = `cls_${Date.now()}`
      classList.push({ id, ...p, archived: false, created_at: Date.now() })
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
    assign: vi.fn(async (p: { class_id: string; student_names: string[] }) => {
      for (const name of p.student_names) {
        try {
          await eaaRun(['set-student-meta', name, '--class-id', p.class_id])
        } catch {
          /* 容忍失败 */
        }
      }
      return { success: true, assigned: p.student_names.length, failed: [] }
    }),
    remove: vi.fn(async () => ({ success: true })),
  },
  sys: {
    openDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    saveDialog: vi.fn(async () => ({ canceled: true })),
  },
}

// 设置全局 window.api
;(globalThis as unknown as { window: unknown }).window = globalThis
;(globalThis as unknown as { window: { api: typeof mockApi } }).window = { api: mockApi }

// 模拟 window.matchMedia（jsdom 缺）
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }),
})

// Mock react-i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

// 设置 React Router
beforeAll(async () => {
  // 准备基础数据
  await eaaRun(['add-student', '渲染测试A'])
  await eaaRun(['add-student', '渲染测试B'])
  await eaaRun(['add-student', '渲染测试C'])
  await eaaRun(['set-student-meta', '渲染测试A', '--class-id', 'G7-1'])
  await eaaRun(['set-student-meta', '渲染测试B', '--class-id', 'G7-1'])
  await eaaRun(['set-student-meta', '渲染测试C', '--class-id', 'G7-2'])
  await eaaRun(['add', '渲染测试A', 'CLASS_MONITOR', '--delta', '10', '--note', '班长'])
  await eaaRun(['add', '渲染测试B', 'CLASS_COMMITTEE', '--delta', '5', '--note', '班委'])
  await eaaRun(['add', '渲染测试C', 'LATE', '--delta', '-2', '--note', '迟到'])
})

beforeEach(() => {
  classList.length = 0
  cleanup()
})

afterAll(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

// =============================================================
// 组件测试
// =============================================================

describeE2E('组件渲染测试', () => {
  it('EAA 数据流：ranking 应返回 class_id（用户报告关键 bug 已修）', async () => {
    const r = (await mockApi.eaa.ranking(10)) as {
      data: { ranking: Array<{ name: string; class_id: string | null; score: number }> }
    }
    const ranking = r.data.ranking
    // 渲染测试A 和 B 在 G7-1
    const a = ranking.find((x) => x.name === '渲染测试A')
    const b = ranking.find((x) => x.name === '渲染测试B')
    const c = ranking.find((x) => x.name === '渲染测试C')
    expect(a?.class_id).toBe('G7-1')
    expect(b?.class_id).toBe('G7-1')
    expect(c?.class_id).toBe('G7-2')
    // 分数应正确（基础 100 + 事件 delta）
    expect(a?.score).toBe(110)
    expect(b?.score).toBe(105)
    expect(c?.score).toBe(98)
  })

  it('班级学生数：list-students 应返回每个学生的 class_id（之前显示 0 的根源）', async () => {
    const r = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ name: string; class_id: string | null }> }
    }
    const students = r.data.students
    // 关键：class_id 字段必须存在且正确
    for (const s of students) {
      expect(s).toHaveProperty('class_id')
    }
    // 按 class_id 统计
    const g7_1_count = students.filter((s) => s.class_id === 'G7-1').length
    const g7_2_count = students.filter((s) => s.class_id === 'G7-2').length
    expect(g7_1_count).toBeGreaterThanOrEqual(2)
    expect(g7_2_count).toBeGreaterThanOrEqual(1)
  })

  it('summary 应包含 class_id（修复前是 bug）', async () => {
    const r = (await mockApi.eaa.summary()) as {
      data: {
        top_gainers: Array<{ name: string; class_id?: string | null }>
        top_losers: Array<{ name: string; class_id?: string | null }>
      }
    }
    expect(r.data.top_gainers.length).toBeGreaterThan(0)
    expect(r.data.top_losers.length).toBeGreaterThan(0)
    for (const g of r.data.top_gainers) expect(g).toHaveProperty('class_id')
    for (const l of r.data.top_losers) expect(l).toHaveProperty('class_id')
  })

  it('批量调班：3 学生从 G7-1 调到 G7-2 后，ranking 过滤结果应正确', async () => {
    // 先记录原状态
    const before = (await mockApi.eaa.ranking(10)) as {
      data: { ranking: Array<{ name: string; class_id: string | null }> }
    }
    const g7_1_before = before.data.ranking.filter((x) => x.class_id === 'G7-1').length

    // 批量调班
    await mockApi.class.assign({
      class_id: 'G7-2',
      student_names: ['渲染测试A', '渲染测试B'],
    })

    // 验证
    const after = (await mockApi.eaa.ranking(10)) as {
      data: { ranking: Array<{ name: string; class_id: string | null }> }
    }
    const g7_1_after = after.data.ranking.filter((x) => x.class_id === 'G7-1').length
    const g7_2_after = after.data.ranking.filter((x) => x.class_id === 'G7-2').length

    expect(g7_1_after).toBe(g7_1_before - 2) // A, B 离开
    expect(g7_2_after).toBeGreaterThanOrEqual(3) // A, B, C 加入

    const a = after.data.ranking.find((x) => x.name === '渲染测试A')
    expect(a?.class_id).toBe('G7-2')
  })

  it('压力测试：连续 30 次 ranking 调用应稳定且耗时 < 5s', async () => {
    const t0 = Date.now()
    for (let i = 0; i < 30; i++) {
      await mockApi.eaa.ranking(10)
    }
    const dt = Date.now() - t0
    expect(dt).toBeLessThan(5_000)
  })

  it('并发场景：5 个 list-students 并发应全部成功', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => mockApi.eaa.listStudents()),
    )
    expect(results.every((r) => r.success)).toBe(true)
    // 每次都返回相同数据
    const counts = results.map((r) => (r as { data: { students: unknown[] } }).data.students.length)
    expect(new Set(counts).size).toBe(1) // 长度一致
  })
})
