// =============================================================
// 用户按键流模拟测试 — 真实模拟用户在软件上的每个操作
// 用 vitest + 真实 eaa 二进制 + mock window.api
// 覆盖：班级管理 / 学生管理 / 仪表盘 / 排行榜 / 压力测试
//
// 跑法: npx vitest run tests/e2e/user-flow-simulation.test.tsx
// =============================================================

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// =============================================================
// 1. eaa 真实二进制调用
// =============================================================
const EAA_BIN = join(__dirname, '..', '..', 'resources', 'eaa-binaries', 'linux-x64', 'eaa')
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'eaa-userflow-'))
const TEST_DATA = join(TEST_ROOT, 'data')
const SCHEMA_SRC = join(
  __dirname,
  '..',
  '..',
  'core',
  'eaa-cli',
  'schema',
  'reason_codes.json',
)

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
  // 清理可能残留的 .lock 文件
  const lockFile = join(TEST_DATA, '.lock')
  if (existsSync(lockFile)) {
    try { rmSync(lockFile) } catch { /* ignore */ }
  }
  writeFileSync(join(TEST_DATA, 'entities', 'entities.json'), '{"entities":{}}')
  writeFileSync(join(TEST_DATA, 'entities', 'name_index.json'), '{}')
  writeFileSync(join(TEST_DATA, 'events', 'events.json'), '[]')
  // 等一下让 eaa 旧进程完全退出
  await new Promise((r) => setTimeout(r, 100))
}

// =============================================================
// 2. 随机数据生成器
// =============================================================
const FIRST_NAMES = [
  '张', '李', '王', '赵', '钱', '孙', '周', '吴', '郑', '陈', '林', '黄',
  '何', '高', '马', '罗', '宋', '韩', '冯', '邓', '曹', '彭', '曾', '萧',
]
const GIVEN_NAMES = [
  '伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳',
  '杰', '娟', '涛', '明', '超', '秀英', '霞', '平', '刚', '桂英', '俊', '志强',
]
const GRADES = ['七年级', '八年级', '九年级', '高一', '高二', '高三']
const CLASS_PREFIX = ['实验', '普通', '重点', '国际']
const TEACHER_FAMILIES = ['王', '李', '张', '刘', '陈', '杨', '黄', '赵', '周', '吴', '徐', '孙']

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomName(): string {
  return randomPick(FIRST_NAMES) + randomPick(GIVEN_NAMES) + (Math.random() > 0.5 ? randomPick(GIVEN_NAMES) : '')
}

function randomClassId(grade: string, n: number): string {
  const g = grade.includes('七') ? 'G7' : grade.includes('八') ? 'G8' : grade.includes('九') ? 'G9' : grade.includes('高一') ? 'G10' : grade.includes('高二') ? 'G11' : 'G12'
  return `${g}-${n}`
}

function randomClass(): { class_id: string; name: string; grade: string; teacher: string } {
  const grade = randomPick(GRADES)
  const n = Math.floor(Math.random() * 10) + 1
  return {
    class_id: randomClassId(grade, n),
    name: `${grade}${randomPick(CLASS_PREFIX)}班${n}`,
    grade,
    teacher: randomPick(TEACHER_FAMILIES) + '老师',
  }
}

const REASON_CODES = [
  { code: 'CLASS_MONITOR', delta: 10 },
  { code: 'CLASS_COMMITTEE', delta: 5 },
  { code: 'CIVILIZED_DORM', delta: 3 },
  { code: 'MONTHLY_ATTENDANCE', delta: 2 },
  { code: 'ACTIVITY_PARTICIPATION', delta: 1 },
  { code: 'BONUS_VARIABLE', delta: 3 },
  { code: 'LAB_CLEAN_UP', delta: -1 },
  { code: 'DESK_UNALIGNED', delta: -1 },
  { code: 'OTHER_DEDUCT', delta: -1 },
  { code: 'SLEEP_IN_CLASS', delta: -2 },
  { code: 'MAKEUP', delta: -2 },
  { code: 'LATE', delta: -2 },
  { code: 'SPEAK_IN_CLASS', delta: -2 },
  { code: 'APPEARANCE_VIOLATION', delta: -2 },
  { code: 'LAB_UNSAFE_BEHAVIOR', delta: -5 },
  { code: 'PHONE_IN_CLASS', delta: -5 },
  { code: 'SMOKING', delta: -10 },
]

// =============================================================
// 3. Mock window.api (指向真实 eaa)
// =============================================================
const classStore: Array<{
  id: string
  class_id: string
  name: string
  grade?: string
  teacher?: string
  archived: boolean
  created_at: number
}> = []

// 用户操作流水（每个 UI 按键的记录）
const userActions: Array<{ action: string; target: string; ts: number; result: 'ok' | 'fail' }> = []

function logAction(action: string, target: string, result: 'ok' | 'fail' = 'ok') {
  userActions.push({ action, target, ts: Date.now(), result })
}

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
      try {
        await eaaRun(['add-student', name])
        logAction('addStudent', name, 'ok')
        return { success: true }
      } catch (e) {
        logAction('addStudent', name, 'fail')
        return { success: false, error: String(e) }
      }
    }),
    deleteStudent: vi.fn(async (name: string) => {
      try {
        await eaaRun(['delete-student', name, '--confirm'])
        logAction('deleteStudent', name, 'ok')
        return { success: true }
      } catch (e) {
        logAction('deleteStudent', name, 'fail')
        return { success: false, error: String(e) }
      }
    }),
    setStudentMeta: vi.fn(async (p: { name: string; classId?: string; clearClassId?: boolean }) => {
      try {
        if (p.clearClassId) {
          await eaaRun(['set-student-meta', p.name, '--clear-class-id'])
        } else if (p.classId) {
          await eaaRun(['set-student-meta', p.name, '--class-id', p.classId])
        }
        logAction('setStudentMeta', `${p.name}->${p.classId ?? 'clear'}`, 'ok')
        return { success: true }
      } catch (e) {
        logAction('setStudentMeta', p.name, 'fail')
        return { success: false, error: String(e) }
      }
    }),
    ranking: vi.fn(async (n: number) => {
      try {
        const r = await eaaRun(['ranking', String(n), '-O', 'json'])
        return { success: true, data: JSON.parse(r) }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }),
    summary: vi.fn(async () => {
      try {
        const r = await eaaRun(['summary', '-O', 'json'])
        return { success: true, data: JSON.parse(r) }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }),
    stats: vi.fn(async () => {
      try {
        const r = await eaaRun(['info', '-O', 'json'])
        return { success: true, data: JSON.parse(r) }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }),
    listCodes: vi.fn(async () => ({ success: true, data: { codes: [] } })),
    range: vi.fn(async () => ({ success: true, data: { events: [] } })),
    tag: vi.fn(async () => ({ success: true, data: { tags: [] } })),
    exportFormats: vi.fn(async () => ['csv', 'jsonl', 'html']),
    import: vi.fn(async () => ({ success: true })),
    export: vi.fn(async () => ({ success: true })),
  },
  class: {
    list: vi.fn(async () => {
      logAction('listClasses', 'all')
      return { success: true, data: classStore }
    }),
    create: vi.fn(async (p: { class_id: string; name: string; grade?: string; teacher?: string }) => {
      const id = `cls_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      classStore.push({ id, ...p, archived: false, created_at: Date.now() })
      logAction('createClass', `${p.class_id} (${p.name})`)
      return { success: true, data: classStore[classStore.length - 1] }
    }),
    update: vi.fn(async () => ({ success: true })),
    archive: vi.fn(async (id: string) => {
      const c = classStore.find((x) => x.id === id)
      if (c) c.archived = true
      logAction('archiveClass', c?.class_id ?? id)
      return { success: true }
    }),
    restore: vi.fn(async (id: string) => {
      const c = classStore.find((x) => x.id === id)
      if (c) c.archived = false
      logAction('restoreClass', c?.class_id ?? id)
      return { success: true }
    }),
    delete: vi.fn(async (id: string) => {
      const c = classStore.find((x) => x.id === id)
      const classId = c?.class_id
      classStore.splice(classStore.findIndex((x) => x.id === id), 1)
      logAction('deleteClass', classId ?? id)
      // 级联清理：清除 eaa 中 class_id 指向该班的学生（与 class-handlers 行为一致）
      if (classId) {
        try {
          const r = await eaaRun(['list-students', '-O', 'json'])
          const data = JSON.parse(r) as { students: Array<{ name: string; class_id: string | null }> }
          for (const s of data.students) {
            if (s.class_id === classId) {
              try {
                await eaaRun(['set-student-meta', s.name, '--clear-class-id'])
              } catch {
                /* ignore */
              }
            }
          }
        } catch {
          /* ignore */
        }
      }
      return { success: true, classId }
    }),
    assign: vi.fn(async (p: { class_id: string; student_names: string[] }) => {
      let ok = 0
      for (const name of p.student_names) {
        try {
          await eaaRun(['set-student-meta', name, '--class-id', p.class_id])
          ok++
        } catch {
          /* ignore */
        }
      }
      logAction('assignClass', `${p.student_names.length} students -> ${p.class_id}`)
      return { success: true, assigned: ok, failed: [] }
    }),
    remove: vi.fn(async () => ({ success: true })),
  },
  sys: {
    openDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    saveDialog: vi.fn(async () => ({ canceled: true })),
  },
}

// =============================================================
// 4. 用户场景函数（每个对应 UI 按键）
// =============================================================
async function userClickCreateClass(cls: { class_id: string; name: string; grade?: string; teacher?: string }) {
  // 用户在 ClassesPage 点 "+ 新建" 按钮 → 填表 → 保存
  const r = await mockApi.class.create(cls)
  if (!r.success) throw new Error('用户操作：创建班级失败')
  if (!r.data) throw new Error('用户操作：创建班级返回 data 为空')
  return r.data
}

async function userClickAddStudent(name: string) {
  // 用户在 StudentsPage 点 "+ 添加" → 输入名字 → 确定
  const r = await mockApi.eaa.addStudent(name)
  if (!r.success) throw new Error('用户操作：添加学生失败')
  return r
}

async function userSelectClassFilter(classId: string) {
  // 用户在 StudentsPage 班级筛选下拉选某班
  const r = (await mockApi.eaa.listStudents()) as {
    data: { students: Array<{ class_id: string | null }> }
  }
  if (classId === '__ALL__') return r.data.students
  return r.data.students.filter((s) => s.class_id === classId)
}

async function userClickBatchAssign(studentNames: string[], targetClassId: string) {
  // 用户在批量选择模式选学生 → 选目标班 → 点 "调入"
  const r = await mockApi.class.assign({ class_id: targetClassId, student_names: studentNames })
  if (!r.success) throw new Error('用户操作：批量调班失败')
  return r
}

async function userClickBatchDelete(studentNames: string[]) {
  // 用户在批量选择模式选学生 → 点 "删除"
  let ok = 0
  for (const name of studentNames) {
    const r = await mockApi.eaa.deleteStudent(name)
    if (r.success) ok++
  }
  logAction('batchDelete', `${ok}/${studentNames.length}`)
  return ok
}

async function userClickArchiveClass(id: string) {
  // 用户在 ClassesPage 行点 "存档"
  return await mockApi.class.archive(id)
}

async function userClickDeleteClass(id: string) {
  // 用户在 ClassesPage 行点 "删除"
  return await mockApi.class.delete(id)
}

async function userClickRefresh() {
  // 用户点 "刷新" 按钮
  await mockApi.class.list()
  await mockApi.eaa.listStudents()
  logAction('refresh', 'all')
}

async function userSelectClassCompare(classA: string, classB: string) {
  // 用户在 Dashboard 点 "班级对比" → 选 A 班 → 选 B 班
  const r = (await mockApi.eaa.ranking(10)) as {
    data: { ranking: Array<{ name: string; class_id: string | null; score: number }> }
  }
  const a = r.data.ranking.filter((x) => x.class_id === classA)
  const b = r.data.ranking.filter((x) => x.class_id === classB)
  return { a, b, all: r.data.ranking }
}

async function userClickRankingItem(name: string) {
  // 用户点排行榜某行 → 跳转到学生详情
  const all = (await mockApi.eaa.listStudents()) as {
    data: { students: Array<{ name: string }> }
  }
  return all.data.students.find((s) => s.name === name)
}

// =============================================================
// 5. 测试套件
// =============================================================
beforeEach(async () => {
  classStore.length = 0
  userActions.length = 0
  await resetEaa()
})

afterAll(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('用户按键流模拟：班级管理（创建 3 班 + 全流程）', () => {
  it('场景 1: 随机创建 3 个班级', async () => {
    const classes = [randomClass(), randomClass(), randomClass()]
    for (const cls of classes) {
      await userClickCreateClass(cls)
    }
    expect(classStore.length).toBe(3)
    // 验证每个班级字段完整
    for (const c of classStore) {
      expect(c.class_id).toBeTruthy()
      expect(c.name).toBeTruthy()
      expect(c.grade).toBeTruthy()
      expect(c.teacher).toBeTruthy()
      expect(c.archived).toBe(false)
    }
  })

  it('场景 2: 随机创建 3 班 + 模拟 30 个学生 + 分配到 3 班', async () => {
    // 1. 创建 3 班
    const classes = [randomClass(), randomClass(), randomClass()]
    for (const cls of classes) await userClickCreateClass(cls)

    // 2. 加 30 学生
    const students: string[] = []
    for (let i = 0; i < 30; i++) {
      const name = `随机测试学生${i + 1}号`
      students.push(name)
      await userClickAddStudent(name)
    }

    // 3. 分配到 3 班（10 个/班）
    for (let i = 0; i < 30; i++) {
      const classIdx = i % 3
      const classId = classes[classIdx].class_id
      await mockApi.eaa.setStudentMeta({ name: students[i], classId })
    }

    // 4. 验证
    const stu = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ name: string; class_id: string | null }> }
    }
    for (let i = 0; i < 30; i++) {
      const s = stu.data.students.find((x) => x.name === students[i])
      expect(s).toBeDefined()
      expect(s?.class_id).toBe(classes[i % 3].class_id)
    }

    // 5. 验证每班 10 人
    for (const cls of classes) {
      const count = stu.data.students.filter((s) => s.class_id === cls.class_id).length
      expect(count).toBe(10)
    }
  })

  it('场景 3: 班级全流程：创建 → 加学生 → 加事件 → 存档 → 恢复 → 删', async () => {
    // 创建 1 个班
    const cls = randomClass()
    await userClickCreateClass(cls)

    // 加 5 学生
    const students = Array.from({ length: 5 }, (_, i) => `生命周期学生${i + 1}`)
    for (const name of students) {
      await userClickAddStudent(name)
      await mockApi.eaa.setStudentMeta({ name, classId: cls.class_id })
    }

    // 加 10 事件
    for (let i = 0; i < 10; i++) {
      const code = randomPick(REASON_CODES)
      try {
        await eaaRun(['add', randomPick(students), code.code, '--delta', String(code.delta), '--note', `事件${i}`])
      } catch {
        /* 容忍重复 */
      }
    }

    // 存档
    const list = (await mockApi.class.list()) as { data: Array<{ id: string; class_id: string; archived: boolean }> }
    const target = list.data.find((c) => c.class_id === cls.class_id)!
    await userClickArchiveClass(target.id)

    // 验证存档状态
    const after = (await mockApi.class.list()) as { data: Array<{ class_id: string; archived: boolean }> }
    expect(after.data.find((c) => c.class_id === cls.class_id)?.archived).toBe(true)

    // 学生仍存在
    const stu = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ name: string; class_id: string | null }> }
    }
    const stillThere = stu.data.students.filter((s) => s.class_id === cls.class_id)
    expect(stillThere.length).toBe(5)

    // 恢复
    await mockApi.class.restore(target.id)
    const after2 = (await mockApi.class.list()) as { data: Array<{ class_id: string; archived: boolean }> }
    expect(after2.data.find((c) => c.class_id === cls.class_id)?.archived).toBe(false)

    // 删除班级
    await userClickDeleteClass(target.id)
    const after3 = (await mockApi.class.list()) as { data: Array<{ class_id: string }> }
    expect(after3.data.find((c) => c.class_id === cls.class_id)).toBeUndefined()
    // 学生变未分班
    const stu2 = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ name: string; class_id: string | null }> }
    }
    const orphan = stu2.data.students.filter((s) => students.includes(s.name))
    expect(orphan.every((s) => !s.class_id)).toBe(true)
  })
})

describe('用户按键流模拟：学生管理（班级筛选 + 批量 + 调班）', () => {
  let classes: Array<{ class_id: string }>

  beforeEach(async () => {
    classes = [randomClass(), randomClass(), randomClass()]
    for (const cls of classes) await userClickCreateClass(cls)
    for (let i = 1; i <= 15; i++) {
      await userClickAddStudent(`学生筛选测试${i}号`)
      await mockApi.eaa.setStudentMeta({ name: `学生筛选测试${i}号`, classId: classes[(i - 1) % 3].class_id })
    }
  })

  it('场景 4: 用户在 StudentsPage 班级筛选下拉选某班', async () => {
    // 用户打开 StudentsPage → 点班级筛选下拉 → 选第一班
    const filtered = await userSelectClassFilter(classes[0].class_id)
    // 验证筛选结果只包含第一班学生
    expect(filtered.length).toBe(5)
    for (const s of filtered) {
      expect(s.class_id).toBe(classes[0].class_id)
    }
  })

  it('场景 5: 用户选 "全部班级" 看到 15 个', async () => {
    const all = await userSelectClassFilter('__ALL__')
    expect(all.length).toBe(15)
  })

  it('场景 6: 批量选择 3 学生 + 调入第二班', async () => {
    // 用户在 StudentsPage 点 ☑ 批量 → 勾选 3 个 → 选目标班 → 调入
    const first3 = ['学生筛选测试1号', '学生筛选测试2号', '学生筛选测试3号']
    const r = await userClickBatchAssign(first3, classes[1].class_id)
    expect(r.success).toBe(true)
    expect((r as { assigned: number }).assigned).toBe(3)

    // 验证
    const stu = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ name: string; class_id: string | null }> }
    }
    for (const name of first3) {
      const s = stu.data.students.find((x) => x.name === name)
      expect(s?.class_id).toBe(classes[1].class_id)
    }
  })

  it('场景 7: 批量删除 3 学生', async () => {
    const first3 = ['学生筛选测试1号', '学生筛选测试2号', '学生筛选测试3号']
    const ok = await userClickBatchDelete(first3)
    expect(ok).toBe(3)
    const stu = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ name: string; status: string }> }
    }
    // 软删除：status=Deleted，过滤后不应出现
    const active = stu.data.students.filter((s) => s.status !== 'Deleted')
    for (const name of first3) {
      expect(active.find((s) => s.name === name)).toBeUndefined()
    }
  })
})

describe('用户按键流模拟：仪表盘班级对比 + 排行榜', () => {
  it('场景 8: 班级对比模式：双班数据完整性', async () => {
    // 1. 创建 2 班
    const cls1 = randomClass()
    const cls2 = randomClass()
    await userClickCreateClass(cls1)
    await userClickCreateClass(cls2)
    // 2. 各加 3 学生
    for (let i = 0; i < 3; i++) {
      await userClickAddStudent(`对比班1学生${i + 1}`)
      await mockApi.eaa.setStudentMeta({ name: `对比班1学生${i + 1}`, classId: cls1.class_id })
    }
    for (let i = 0; i < 3; i++) {
      await userClickAddStudent(`对比班2学生${i + 1}`)
      await mockApi.eaa.setStudentMeta({ name: `对比班2学生${i + 1}`, classId: cls2.class_id })
    }
    // 3. 加事件
    for (let i = 0; i < 5; i++) {
      try {
        await eaaRun(['add', `对比班1学生${(i % 3) + 1}`, 'CLASS_COMMITTEE', '--delta', '5', '--note', `e${i}`])
      } catch {
        /* ignore */
      }
    }

    // 4. 用户在 Dashboard 点 "班级对比" 按钮 → 选 A=cls1 B=cls2
    const r = await userSelectClassCompare(cls1.class_id, cls2.class_id)
    expect(r.a.length).toBe(3) // 班 1 有 3 学生
    expect(r.b.length).toBe(3) // 班 2 有 3 学生
    // 班 1 平均分 > 班 2 平均分（因为加了 5 分事件）
    const avgA = r.a.reduce((s, x) => s + x.score, 0) / r.a.length
    const avgB = r.b.reduce((s, x) => s + x.score, 0) / r.b.length
    expect(avgA).toBeGreaterThan(avgB)
  })

  it('场景 9: 用户点排行榜某行 → 跳转到学生详情', async () => {
    // 准备数据
    for (let i = 0; i < 3; i++) {
      await userClickAddStudent(`排行跳转测试${i + 1}`)
    }
    // 用户在 Dashboard 看排行榜 → 点第一行
    const s = await userClickRankingItem('排行跳转测试1')
    expect(s).toBeDefined()
  })
})

describe('用户按键流模拟：压力 + 长时间', () => {
  it('场景 10: 50 轮随机操作 — 班级/学生/事件混合', async () => {
    // 创建 3 班
    const classes = [randomClass(), randomClass(), randomClass()]
    for (const cls of classes) await userClickCreateClass(cls)
    const t0 = Date.now()

    // 50 轮随机操作
    for (let i = 0; i < 50; i++) {
      const op = randomPick(['addStudent', 'addEvent', 'assign', 'refresh', 'deleteStudent'] as const)
      switch (op) {
        case 'addStudent': {
          const name = `压力测试${i}_${Date.now()}`
          await userClickAddStudent(name)
          // 50% 概率调班
          if (Math.random() > 0.5) {
            await mockApi.eaa.setStudentMeta({
              name,
              classId: randomPick(classes).class_id,
            })
          }
          break
        }
        case 'addEvent': {
          const r = (await mockApi.eaa.listStudents()) as {
            data: { students: Array<{ name: string }> }
          }
          if (r.data.students.length > 0) {
            const code = randomPick(REASON_CODES)
            const name = randomPick(r.data.students).name
            try {
              await eaaRun(['add', name, code.code, '--delta', String(code.delta), '--note', `p${i}`])
            } catch {
              /* ignore */
            }
          }
          break
        }
        case 'assign': {
          const r = (await mockApi.eaa.listStudents()) as {
            data: { students: Array<{ name: string }> }
          }
          if (r.data.students.length >= 3) {
            const names = r.data.students.slice(0, 3).map((s) => s.name)
            await userClickBatchAssign(names, randomPick(classes).class_id)
          }
          break
        }
        case 'refresh': {
          await userClickRefresh()
          break
        }
        case 'deleteStudent': {
          const r = (await mockApi.eaa.listStudents()) as {
            data: { students: Array<{ name: string }> }
          }
          if (r.data.students.length > 5) {
            await mockApi.eaa.deleteStudent(r.data.students[0].name)
          }
          break
        }
      }
    }
    const dt = Date.now() - t0
    expect(dt).toBeLessThan(60_000) // 50 轮混合操作 < 60s

    // 验证数据完整性
    const stu = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ name: string; class_id: string | null }> }
    }
    expect(stu.data.students.length).toBeGreaterThan(0)
    // 至少 1 个有 class_id
    const withClass = stu.data.students.filter((s) => s.class_id)
    expect(withClass.length).toBeGreaterThan(0)
  })

  it('场景 11: 20 轮班级创建/删除循环', async () => {
    for (let i = 0; i < 20; i++) {
      const cls = randomClass()
      const created = (await userClickCreateClass(cls)) as { id: string }
      await userClickDeleteClass(created.id)
    }
    expect(classStore.length).toBe(0)
  })

  it('场景 12: 100 次仪表盘刷新 + 班级筛选切换', async () => {
    // 创建 3 班 + 30 学生
    const classes = [randomClass(), randomClass(), randomClass()]
    for (const cls of classes) await userClickCreateClass(cls)
    for (let i = 0; i < 30; i++) {
      await userClickAddStudent(`刷新测试${i}`)
      await mockApi.eaa.setStudentMeta({ name: `刷新测试${i}`, classId: classes[i % 3].class_id })
    }

    const t0 = Date.now()
    for (let i = 0; i < 100; i++) {
      // 用户来回切班级筛选
      await userSelectClassFilter(classes[i % 3].class_id)
      await mockApi.eaa.ranking(10)
      await mockApi.eaa.summary()
    }
    const dt = Date.now() - t0
    expect(dt).toBeLessThan(30_000) // 100 轮 < 30s
  })

  it('场景 13: 10 并发 list-students（模拟应用初始化时 3 页同时挂载）', async () => {
    // 准备数据
    for (let i = 0; i < 10; i++) {
      await userClickAddStudent(`并发测试${i}`)
    }
    // 模拟应用初次加载：Dashboard / Classes / Students 同时挂载
    const t0 = Date.now()
    const results = await Promise.all([
      mockApi.eaa.listStudents(),
      mockApi.eaa.listStudents(),
      mockApi.eaa.listStudents(),
      mockApi.class.list(),
      mockApi.eaa.ranking(10),
      mockApi.eaa.summary(),
      mockApi.eaa.listStudents(),
      mockApi.class.list(),
      mockApi.eaa.ranking(10),
    ])
    const dt = Date.now() - t0
    expect(dt).toBeLessThan(5_000) // 并发应 < 5s
    expect(results.every((r) => r.success)).toBe(true)
  })
})

describe('用户报告 Bug 验证（数据流层）', () => {
  it('Bug 1: 班级学生数列（之前显示 0）— 现已正确', async () => {
    const cls = randomClass()
    await userClickCreateClass(cls)
    for (let i = 0; i < 5; i++) {
      await userClickAddStudent(`Bug1学生${i}`)
      await mockApi.eaa.setStudentMeta({ name: `Bug1学生${i}`, classId: cls.class_id })
    }
    // 模拟 ClassesPage 计算学生数
    const stu = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ class_id: string | null }> }
    }
    const count = stu.data.students.filter((s) => s.class_id === cls.class_id).length
    expect(count).toBe(5) // 关键：不为 0
  })

  it('Bug 2: 仪表盘班级对比空 — ranking 包含 class_id，可正确过滤', async () => {
    const cls1 = randomClass()
    const cls2 = randomClass()
    await userClickCreateClass(cls1)
    await userClickCreateClass(cls2)
    for (const name of ['A', 'B', 'C']) {
      await userClickAddStudent(name)
      await mockApi.eaa.setStudentMeta({ name, classId: cls1.class_id })
    }
    for (const name of ['D', 'E', 'F']) {
      await userClickAddStudent(name)
      await mockApi.eaa.setStudentMeta({ name, classId: cls2.class_id })
    }
    // 模拟 React classFilter 过滤 ranking
    const r = (await mockApi.eaa.ranking(10)) as {
      data: { ranking: Array<{ name: string; class_id: string | null }> }
    }
    const filtered1 = r.data.ranking.filter((x) => x.class_id === cls1.class_id)
    const filtered2 = r.data.ranking.filter((x) => x.class_id === cls2.class_id)
    expect(filtered1.length).toBe(3) // 不再为 0
    expect(filtered2.length).toBe(3)
    // 所有 ranking 项必须有 class_id
    for (const item of r.data.ranking) {
      expect(item).toHaveProperty('class_id')
    }
  })

  it('Bug 3: 排行榜/周期摘要响应式 — CSS 修复已包含', async () => {
    // 验证 DashboardPage.tsx 含 truncate + min-w-0 修复
    const fs = await import('node:fs')
    const content = fs.readFileSync(
      join(__dirname, '..', '..', 'src', 'renderer', 'pages', 'Dashboard', 'DashboardPage.tsx'),
      'utf-8',
    )
    // 排行榜渲染入口
    const rankingIdx = content.indexOf('filteredRanking.slice')
    // 周期摘要渲染入口（用更精确的 'top_gainers' 标志）
    const periodIdx = content.indexOf('top_gainers.slice')
    expect(rankingIdx).toBeGreaterThan(0)
    expect(periodIdx).toBeGreaterThan(0)
    // 检查 truncate 在两个部分都用了
    const rankingPart = content.slice(rankingIdx, rankingIdx + 1500)
    const periodPart = content.slice(periodIdx, periodIdx + 1500)
    expect(rankingPart).toContain('truncate')
    expect(rankingPart).toContain('min-w-0')
    expect(periodPart).toContain('truncate')
    expect(periodPart).toContain('min-w-0')
  })

  it('Bug 4: 班级加载慢 — listStudents 有缓存', async () => {
    const fs = await import('node:fs')
    const content = fs.readFileSync(
      join(__dirname, '..', '..', 'src', 'main', 'ipc', 'eaa-handlers.ts'),
      'utf-8',
    )
    expect(content).toContain('studentsCache')
    expect(content).toContain('STUDENTS_CACHE_TTL_MS')
    expect(content).toContain('invalidateStudentsCache')
  })
})

describe('长时间持续运行（无时间限制，按用户要求）', () => {
  it('场景 14: 3 分钟持续随机操作，验证稳定性', async () => {
    // 创建 3 班
    const classes = [randomClass(), randomClass(), randomClass()]
    for (const cls of classes) await userClickCreateClass(cls)

    const startTime = Date.now()
    const testDurationMs = 3 * 60 * 1000 // 3 分钟
    let ops = 0
    let errors = 0

    while (Date.now() - startTime < testDurationMs) {
      try {
        const op = randomPick(['add', 'add', 'event', 'query', 'batch'] as const)
        switch (op) {
          case 'add': {
            const name = `长测${ops}_${Date.now()}`
            await userClickAddStudent(name)
            if (Math.random() > 0.3) {
              await mockApi.eaa.setStudentMeta({ name, classId: randomPick(classes).class_id })
            }
            break
          }
          case 'event': {
            const r = (await mockApi.eaa.listStudents()) as {
              data: { students: Array<{ name: string }> }
            }
            if (r.data.students.length > 0) {
              const code = randomPick(REASON_CODES)
              try {
                await eaaRun(['add', randomPick(r.data.students).name, code.code, '--delta', String(code.delta), '--note', `L${ops}`])
              } catch {
                /* ignore */
              }
            }
            break
          }
          case 'query': {
            await userSelectClassFilter(randomPick([classes[0].class_id, classes[1].class_id, classes[2].class_id]))
            await mockApi.eaa.ranking(5)
            break
          }
          case 'batch': {
            const r = (await mockApi.eaa.listStudents()) as {
              data: { students: Array<{ name: string }> }
            }
            if (r.data.students.length >= 2) {
              const names = r.data.students.slice(0, 2).map((s) => s.name)
              await userClickBatchAssign(names, randomPick(classes).class_id)
            }
            break
          }
        }
        ops++
      } catch {
        errors++
      }
    }

    // 验证：3 分钟内完成了大量操作
    expect(ops).toBeGreaterThan(50) // 至少 50 个操作
    expect(errors / ops).toBeLessThan(0.1) // 错误率 < 10%

    // 验证数据完整性
    const stu = (await mockApi.eaa.listStudents()) as {
      data: { students: Array<{ name: string; class_id: string | null }> }
    }
    expect(stu.data.students.length).toBeGreaterThan(0)
  }, 4 * 60 * 1000) // 4 分钟超时（留 buffer）
})
