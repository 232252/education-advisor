// =============================================================
// DB Service — 班级表 CRUD 测试 (insertClass/updateClass/getClassById/
// getClassByClassId/listClasses/deleteClass)
// 此前这些方法零覆盖。用 better-sqlite3 真机跑,降级时验证 no-op 路径
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'

const mocks = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const tmpDir = `${tmpBase}${sep}db-class-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

import { dbService, type ClassRecord } from '../../src/main/services/db-service'

function makeClass(overrides: Partial<ClassRecord> = {}): ClassRecord {
  const n = Math.floor(Math.random() * 1e9)
  return {
    id: `cls_${n}`,
    class_id: `G7-${n}`,
    name: `七年级${n}班`,
    grade: '七年级',
    note: null,
    archived: 0,
    created_at: Date.now(),
    teacher: '张老师',
    ...overrides,
  }
}

describe('dbService 班级 CRUD', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
    await dbService.init()
    if (!dbService.isReady()) {
      console.warn('SUPPRESS: dbService not ready (better-sqlite3 binding missing?)')
    }
  })

  afterAll(async () => {
    await dbService.close()
    try {
      await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  // 降级模式(no better-sqlite3): 全部 no-op
  function skipIfDisabled() {
    if (!dbService.isReady()) {
      console.warn('SUPPRESS: skipping class CRUD assertions (db disabled)')
      return true
    }
    return false
  }

  describe('insertClass + getClassById 往返', () => {
    it('插入后应能按 id 查回', () => {
      if (skipIfDisabled()) {
        expect(dbService.insertClass(makeClass())).toBe(false)
        return
      }
      const c = makeClass({ id: 'c1', class_id: 'G7-1', name: '七年级一班' })
      expect(dbService.insertClass(c)).toBe(true)
      const got = dbService.getClassById('c1')
      expect(got).not.toBeNull()
      expect(got?.id).toBe('c1')
      expect(got?.class_id).toBe('G7-1')
      expect(got?.name).toBe('七年级一班')
      expect(got?.archived).toBe(0)
    })

    it('插入重复 id 应失败(主键冲突)', () => {
      if (skipIfDisabled()) return
      const c = makeClass({ id: 'dup', class_id: 'DUP-1' })
      expect(dbService.insertClass(c)).toBe(true)
      expect(dbService.insertClass(c)).toBe(false)
    })

    it('可选字段缺失时用 null 填充', () => {
      if (skipIfDisabled()) return
      const c: ClassRecord = {
        id: 'minimal',
        class_id: 'MIN-1',
        name: '最小班级',
        archived: 0,
        created_at: 1,
      }
      expect(dbService.insertClass(c)).toBe(true)
      const got = dbService.getClassById('minimal')
      expect(got?.grade).toBeNull()
      expect(got?.note).toBeNull()
      expect(got?.teacher).toBeNull()
    })

    it('中文/特殊字符名称应正确存取', () => {
      if (skipIfDisabled()) return
      const c = makeClass({ id: 'zh', class_id: '中-1', name: '七年级"特殊"班' })
      expect(dbService.insertClass(c)).toBe(true)
      const got = dbService.getClassById('zh')
      expect(got?.name).toBe('七年级"特殊"班')
      expect(got?.class_id).toBe('中-1')
    })
  })

  describe('getClassByClassId', () => {
    it('按 class_id 查询', () => {
      if (skipIfDisabled()) return
      dbService.insertClass(makeClass({ id: 'bycid', class_id: 'UNIQUE-CID', name: '唯一班' }))
      const got = dbService.getClassByClassId('UNIQUE-CID')
      expect(got?.id).toBe('bycid')
    })

    it('不存在的 class_id 返回 null', () => {
      if (skipIfDisabled()) {
        expect(dbService.getClassByClassId('nope')).toBeNull()
        return
      }
      expect(dbService.getClassByClassId('NONEXISTENT-CID-999')).toBeNull()
    })
  })

  describe('listClasses', () => {
    it('应返回所有班级,未存档排前面', () => {
      if (skipIfDisabled()) {
        expect(dbService.listClasses()).toEqual([])
        return
      }
      dbService.insertClass(makeClass({ id: 'lst-a', class_id: 'LST-A', archived: 1 }))
      dbService.insertClass(makeClass({ id: 'lst-b', class_id: 'LST-B', archived: 0 }))
      const list = dbService.listClasses()
      const ids = list.map((c) => c.id)
      expect(ids).toContain('lst-a')
      expect(ids).toContain('lst-b')
      // 未存档(lst-b, archived=0) 应在已存档(lst-a, archived=1) 之前
      const idxB = ids.indexOf('lst-b')
      const idxA = ids.indexOf('lst-a')
      // 只有当两者都在结果里时才比较顺序
      if (idxB >= 0 && idxA >= 0) {
        // 未存档组整体在已存档组之前,但组内可能包含其他记录,所以只验证 lst-b <= lst-a
        expect(idxB).toBeLessThanOrEqual(idxA)
      }
    })
  })

  describe('updateClass', () => {
    it('更新 name 应生效', () => {
      if (skipIfDisabled()) return
      dbService.insertClass(makeClass({ id: 'upd-1', class_id: 'UPD-1', name: '原名' }))
      expect(dbService.updateClass('upd-1', { name: '新名' })).toBe(true)
      expect(dbService.getClassById('upd-1')?.name).toBe('新名')
    })

    it('存档操作: archived=1 + archived_at', () => {
      if (skipIfDisabled()) return
      dbService.insertClass(makeClass({ id: 'arc-1', class_id: 'ARC-1', archived: 0 }))
      const ts = Date.now()
      expect(dbService.updateClass('arc-1', { archived: 1, archived_at: ts })).toBe(true)
      const got = dbService.getClassById('arc-1')
      expect(got?.archived).toBe(1)
      expect(got?.archived_at).toBe(ts)
    })

    it('恢复: archived=0 + archived_at=null', () => {
      if (skipIfDisabled()) return
      dbService.insertClass(makeClass({ id: 'rst-1', class_id: 'RST-1', archived: 1, archived_at: 1000 }))
      expect(dbService.updateClass('rst-1', { archived: 0, archived_at: null })).toBe(true)
      const got = dbService.getClassById('rst-1')
      expect(got?.archived).toBe(0)
    })

    it('未提供的字段保留原值(grade/note)', () => {
      if (skipIfDisabled()) return
      dbService.insertClass(
        makeClass({ id: 'keep-1', class_id: 'KEEP-1', grade: '八年级', note: '备注' }),
      )
      dbService.updateClass('keep-1', { name: '改名' })
      const got = dbService.getClassById('keep-1')
      expect(got?.name).toBe('改名')
      expect(got?.grade).toBe('八年级') // 保留
      expect(got?.note).toBe('备注') // 保留
    })

    it('更新不存在的 id 返回 false', () => {
      if (skipIfDisabled()) {
        expect(dbService.updateClass('no-exist', { name: 'x' })).toBe(false)
        return
      }
      expect(dbService.updateClass('NONEXISTENT-ID-999', { name: 'x' })).toBe(false)
    })

    it('更新 teacher 字段', () => {
      if (skipIfDisabled()) return
      dbService.insertClass(makeClass({ id: 'tch-1', class_id: 'TCH-1', teacher: '王老师' }))
      dbService.updateClass('tch-1', { teacher: '李老师' })
      expect(dbService.getClassById('tch-1')?.teacher).toBe('李老师')
    })
  })

  describe('deleteClass', () => {
    it('删除存在的班级返回 true', () => {
      if (skipIfDisabled()) return
      dbService.insertClass(makeClass({ id: 'del-1', class_id: 'DEL-1' }))
      expect(dbService.deleteClass('del-1')).toBe(true)
      expect(dbService.getClassById('del-1')).toBeNull()
    })

    it('删除不存在的 id 返回 false', () => {
      if (skipIfDisabled()) {
        expect(dbService.deleteClass('no-exist')).toBe(false)
        return
      }
      expect(dbService.deleteClass('NONEXISTENT-ID-999')).toBe(false)
    })

    it('删除后 listClasses 不再包含', () => {
      if (skipIfDisabled()) return
      dbService.insertClass(makeClass({ id: 'del-2', class_id: 'DEL-2' }))
      dbService.deleteClass('del-2')
      const list = dbService.listClasses()
      expect(list.find((c) => c.id === 'del-2')).toBeUndefined()
    })
  })

  describe('降级模式(isReady=false) 行为', () => {
    it('所有写操作返回 false, 读操作返回空', () => {
      // 此测试在 db 可用时也验证 API 形状一致
      const ready = dbService.isReady()
      if (ready) {
        // db 可用时跳过降级断言,但确认 API 存在
        expect(typeof dbService.insertClass(makeClass({ id: 'shape' }))).toBe('boolean')
        expect(Array.isArray(dbService.listClasses())).toBe(true)
        return
      }
      expect(dbService.insertClass(makeClass({ id: 'shape' }))).toBe(false)
      expect(dbService.updateClass('shape', { name: 'x' })).toBe(false)
      expect(dbService.deleteClass('shape')).toBe(false)
      expect(dbService.getClassById('shape')).toBeNull()
      expect(dbService.getClassByClassId('shape')).toBeNull()
      expect(dbService.listClasses()).toEqual([])
    })
  })
})
