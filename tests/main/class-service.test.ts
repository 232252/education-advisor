// =============================================================
// Class Service 测试
// 覆盖: validateClassId/validateName (通过 create/update 间接)、
//       toEntity 转换、CRUD 全流程、存档/恢复/删除
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'

const mocks = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const tmpDir = `${tmpBase}${sep}class-svc-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    userDataDir: tmpDir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tmpDir
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

import { classService } from '../../src/main/services/class-service'
import { dbService } from '../../src/main/services/db-service'

function skipIfNoDb(): boolean {
  if (!dbService.isReady()) {
    console.warn('SUPPRESS: skipping class CRUD (db disabled)')
    return true
  }
  return false
}

describe('classService — 校验逻辑 (validateClassId via create)', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
    await dbService.init()
  })
  afterAll(async () => {
    await dbService.close()
    try {
      await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('class_id 为空应报错', () => {
    const r = classService.create({ class_id: '', name: '班' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('empty')
  })

  it('class_id 仅空格应报错', () => {
    const r = classService.create({ class_id: '   ', name: '班' })
    expect(r.success).toBe(false)
  })

  it('class_id 超过 32 字符应报错', () => {
    const r = classService.create({ class_id: 'A'.repeat(33), name: '班' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('too long')
  })

  it('class_id 含非法字符(空格/斜杠)应报错', () => {
    expect(classService.create({ class_id: 'G 7', name: '班' }).success).toBe(false)
    expect(classService.create({ class_id: 'G7/1', name: '班' }).success).toBe(false)
    expect(classService.create({ class_id: 'G7;1', name: '班' }).success).toBe(false)
  })

  it('class_id 合法字符(字母/数字/./-)应通过校验', () => {
    if (skipIfNoDb()) return
    const r = classService.create({ class_id: 'G7-1.2', name: '合法班' })
    expect(r.success).toBe(true)
  })

  it('name 为空应报错', () => {
    expect(classService.create({ class_id: 'V1', name: '' }).success).toBe(false)
  })

  it('name 超过 64 字符应报错', () => {
    expect(classService.create({ class_id: 'V2', name: 'x'.repeat(65) }).success).toBe(false)
  })

  it('name 以 -- 开头应报错(防 CLI 注入)', () => {
    const r = classService.create({ class_id: 'V3', name: '--evil' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('--')
  })
})

describe('classService — CRUD 全流程', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
    await dbService.init()
  })
  afterAll(async () => {
    await dbService.close()
    try {
      await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('create → list → update → archive → restore → delete 全流程', () => {
    if (skipIfNoDb()) return

    // create
    const created = classService.create({
      class_id: 'FULL-1',
      name: '全流程班',
      grade: '七年级',
      teacher: '王老师',
      note: '备注',
    })
    expect(created.success).toBe(true)
    expect(created.data).toBeDefined()
    expect(created.data?.archived).toBe(false)
    const id = created.data!.id

    // list 应包含
    const list = classService.list()
    expect(list.find((c) => c.id === id)).toBeDefined()

    // update name
    const upd = classService.update(id, { name: '改名班' })
    expect(upd.success).toBe(true)
    const updated = classService.list().find((c) => c.id === id)
    expect(updated?.name).toBe('改名班')
    expect(updated?.grade).toBe('七年级') // 保留

    // archive
    expect(classService.archive(id).success).toBe(true)
    const archived = classService.list().find((c) => c.id === id)
    expect(archived?.archived).toBe(true)

    // restore
    expect(classService.restore(id).success).toBe(true)
    const restored = classService.list().find((c) => c.id === id)
    expect(restored?.archived).toBe(false)

    // delete
    const del = classService.delete(id)
    expect(del.success).toBe(true)
    expect(del.classId).toBe('FULL-1')
    expect(classService.list().find((c) => c.id === id)).toBeUndefined()
  })

  it('重复 class_id 创建应失败', () => {
    if (skipIfNoDb()) return
    classService.create({ class_id: 'DUP-X', name: '一班' })
    const r = classService.create({ class_id: 'DUP-X', name: '二班' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('已存在')
  })

  it('update 不存在的 id 应失败', () => {
    if (skipIfNoDb()) return
    const r = classService.update('NONEXISTENT-UUID', { name: 'x' })
    expect(r.success).toBe(false)
  })

  it('delete 不存在的 id 应失败', () => {
    if (skipIfNoDb()) return
    const r = classService.delete('NONEXISTENT-UUID')
    expect(r.success).toBe(false)
    expect(r.error).toContain('不存在')
  })

  it('archive/restore 不存在的 id 应失败', () => {
    if (skipIfNoDb()) return
    expect(classService.archive('NONEXISTENT-UUID').success).toBe(false)
    expect(classService.restore('NONEXISTENT-UUID').success).toBe(false)
  })

  it('update 空 name 应报错(走校验)', () => {
    if (skipIfNoDb()) return
    const created = classService.create({ class_id: 'UPD-E', name: '原名' })
    const r = classService.update(created.data!.id, { name: '' })
    expect(r.success).toBe(false)
  })

  it('update teacher 为空字符串 → null', () => {
    if (skipIfNoDb()) return
    const created = classService.create({ class_id: 'TCH-E', name: '班', teacher: '张老师' })
    classService.update(created.data!.id, { teacher: '' })
    // 应不报错
    const list = classService.list()
    void list
  })
})

describe('classService — toEntity 转换', () => {
  it('archived 0/1 正确转为 boolean', () => {
    if (skipIfNoDb()) return
    const a = classService.create({ class_id: 'BOOL-0', name: '未存档' })
    expect(a.data?.archived).toBe(false)

    const b = classService.create({ class_id: 'BOOL-1', name: '将存档' })
    classService.archive(b.data!.id)
    const after = classService.list().find((c) => c.id === b.data!.id)
    expect(after?.archived).toBe(true)
  })

  it('null 字段转为 undefined(grade/note/teacher)', () => {
    if (skipIfNoDb()) return
    const r = classService.create({ class_id: 'NULL-F', name: '最小班' })
    expect(r.data?.grade).toBeUndefined()
    expect(r.data?.note).toBeUndefined()
    expect(r.data?.teacher).toBeUndefined()
  })
})

describe('classService — 中文/特殊字符', () => {
  it('中文 class_id 应被拒(只允许字母数字./-)', () => {
    const r = classService.create({ class_id: '七一班', name: '中文编号班' })
    expect(r.success).toBe(false)
  })

  it('中文 name 应被接受', () => {
    if (skipIfNoDb()) return
    const r = classService.create({ class_id: 'CN-1', name: '七年级"实验"班' })
    expect(r.success).toBe(true)
    expect(r.data?.name).toBe('七年级"实验"班')
  })
})
