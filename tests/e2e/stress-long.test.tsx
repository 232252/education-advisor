// =============================================================
// 持续压力测试（独立文件，方便单独跑）
// 用法: npx vitest run tests/e2e/stress-long.test.tsx
// 或: npx vitest run tests/e2e/stress-long.test.tsx -t "30 分钟"
// =============================================================

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// eaa 真实调用（跨平台）
const _dirName = process.platform === 'win32' ? 'win32-x64' : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64') : 'linux-x64'
const _binName = process.platform === 'win32' ? 'eaa.exe' : 'eaa'
const EAA_BIN = join(__dirname, '..', '..', 'resources', 'eaa-binaries', _dirName, _binName)
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'eaa-stress-'))
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

function eaaRun(args: string[]): Promise<string> {
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
      if (code !== 0) return reject(new Error(`eaa exit ${code}: ${err.slice(0, 200)}`))
      resolve(out)
    })
  })
}

async function resetEaa() {
  const lockFile = join(TEST_DATA, '.lock')
  if (existsSync(lockFile)) {
    try { rmSync(lockFile) } catch { /* ignore */ }
  }
  writeFileSync(join(TEST_DATA, 'entities', 'entities.json'), '{"entities":{}}')
  writeFileSync(join(TEST_DATA, 'entities', 'name_index.json'), '{}')
  writeFileSync(join(TEST_DATA, 'events', 'events.json'), '[]')
  await new Promise((r) => setTimeout(r, 100))
}

afterAll(() => {
  try { rmSync(TEST_ROOT, { recursive: true, force: true }) } catch { /* ignore */ }
})

beforeEach(async () => {
  await resetEaa()
})

describe('持续压力测试（容器内 10 分钟）', () => {
  it('10 分钟持续混合操作（班级/学生/事件/查询/筛选）', async () => {
    const mockApi = {
      eaa: {
        listStudents: vi.fn(async () => {
          try {
            const r = await eaaRun(['list-students', '-O', 'json'])
            return { success: true, data: JSON.parse(r) }
          } catch (e) {
            return { success: false, error: String(e) }
          }
        }),
        addStudent: vi.fn(async (name: string) => {
          try { await eaaRun(['add-student', name]); return { success: true } }
          catch (e) { return { success: false, error: String(e) } }
        }),
        deleteStudent: vi.fn(async (name: string) => {
          try { await eaaRun(['delete-student', name, '--confirm']); return { success: true } }
          catch (e) { return { success: false, error: String(e) } }
        }),
        setStudentMeta: vi.fn(async (p: { name: string; classId?: string; clearClassId?: boolean }) => {
          try {
            if (p.clearClassId) await eaaRun(['set-student-meta', p.name, '--clear-class-id'])
            else if (p.classId) await eaaRun(['set-student-meta', p.name, '--class-id', p.classId])
            return { success: true }
          } catch (e) { return { success: false, error: String(e) } }
        }),
        ranking: vi.fn(async (n: number) => {
          try {
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
          }
          catch (e) { return { success: false, error: String(e) } }
        }),
        summary: vi.fn(async () => {
          try {
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
          }
          catch (e) { return { success: false, error: String(e) } }
        }),
        stats: vi.fn(async () => {
          try { const r = await eaaRun(['info', '-O', 'json']); return { success: true, data: JSON.parse(r) } }
          catch (e) { return { success: false, error: String(e) } }
        }),
      },
    }

    const REASON_CODES = [
      { code: 'CLASS_MONITOR', delta: 10 },
      { code: 'CLASS_COMMITTEE', delta: 5 },
      { code: 'CIVILIZED_DORM', delta: 3 },
      { code: 'MONTHLY_ATTENDANCE', delta: 2 },
      { code: 'ACTIVITY_PARTICIPATION', delta: 1 },
      { code: 'SLEEP_IN_CLASS', delta: -2 },
      { code: 'LATE', delta: -2 },
      { code: 'PHONE_IN_CLASS', delta: -5 },
    ]

    // 创建 5 班（多种 grade）
    const classes: string[] = []
    for (let i = 0; i < 5; i++) {
      const gid = `STRESS-${i + 1}`
      classes.push(gid)
    }

    // 10 分钟持续运行
    const startTime = Date.now()
    const testDurationMs = 10 * 60 * 1000
    let ops = 0
    let errors = 0
    let totalEvents = 0
    let totalQueries = 0

    while (Date.now() - startTime < testDurationMs) {
      try {
        // 随机操作类型
        const op = Math.random()
        if (op < 0.4) {
          // 40% 添加学生
          const name = `长测${ops}_${Date.now()}`
          const r = await mockApi.eaa.addStudent(name)
          if (r.success) {
            // 60% 概率调班
            if (Math.random() > 0.4) {
              const cls = classes[Math.floor(Math.random() * classes.length)]
              await mockApi.eaa.setStudentMeta({ name, classId: cls })
            }
          }
        } else if (op < 0.7) {
          // 30% 加事件
          const r = (await mockApi.eaa.listStudents()) as {
            data: { students: Array<{ name: string }> }
          }
          if (r.data.students.length > 0) {
            const code = REASON_CODES[Math.floor(Math.random() * REASON_CODES.length)]
            const student = r.data.students[Math.floor(Math.random() * r.data.students.length)]
            try {
              await eaaRun(['add', student.name, code.code, '--delta', String(code.delta), '--note', `L${ops}`])
              totalEvents++
            } catch {
              /* 容忍重复 */
            }
          }
        } else if (op < 0.9) {
          // 20% 查询
          await mockApi.eaa.ranking(20)
          await mockApi.eaa.summary()
          totalQueries += 2
        } else {
          // 10% 删除（只删多余学生）
          const r = (await mockApi.eaa.listStudents()) as {
            data: { students: Array<{ name: string }> }
          }
          if (r.data.students.length > 100) {
            await mockApi.eaa.deleteStudent(r.data.students[0].name)
          }
        }
        ops++
      } catch {
        errors++
      }
    }

    const dt = Date.now() - startTime
    const opRate = (ops / (dt / 1000)).toFixed(2)
    const errRate = ((errors / ops) * 100).toFixed(2)

    // 输出统计
    console.log('\n=== 10 分钟压力测试报告 ===')
    console.log(`运行时间: ${(dt / 1000).toFixed(1)}s`)
    console.log(`总操作数: ${ops}`)
    console.log(`错误数: ${errors} (${errRate}%)`)
    console.log(`操作速率: ${opRate} ops/s`)
    console.log(`事件数: ${totalEvents}`)
    console.log(`查询数: ${totalQueries}`)

    // 验证：稳定运行
    expect(ops).toBeGreaterThan(100) // 至少 100 个操作
    expect(errors / ops).toBeLessThan(0.05) // 错误率 < 5%

    // 验证：eaa 数据状态正确
    const stu = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ name: string; class_id: string | null }> }
    }
    console.log(`最终学生数: ${stu.data.students.length}`)
    const withClass = stu.data.students.filter((s) => s.class_id).length
    console.log(`有班级的学生: ${withClass}`)

    expect(stu.data.students.length).toBeGreaterThan(0)
  }, 12 * 60 * 1000) // 12 分钟超时
})
