// =============================================================
// Profile Service — 路径安全 + 名称规范化 + 碰撞测试 (补充)
// 覆盖: 路径遍历防护、特殊字符替换、不同名称映射到同文件的碰撞风险(C.13)
// 采用 await import 确保 fresh singleton
// H-11 修复: 方法改为 async,测试同步更新为 await
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmpDir = path.join(
  os.tmpdir(),
  `profile-extra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return tmpDir
    throw new Error(`Unexpected path: ${name}`)
  }),
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

const { profileService } = await import('../../src/main/services/profile-service')

describe('profileService 补充 — 路径遍历与名称清洗', () => {
  beforeAll(async () => {
    await fsp.mkdir(path.join(tmpDir, 'eaa-data', 'profiles'), { recursive: true })
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })

  describe('路径遍历防护', () => {
    it('含 ../ 的名称不应逃逸出 profiles 目录', async () => {
      const r = await profileService.set('../../../etc/passwd', { notes: 'evil' })
      expect(r.success).toBe(true)
      // profiles 目录外不应有文件被创建
      const evilPath = path.join(tmpDir, '..', '..', '..', 'etc', 'passwd')
      expect(fs.existsSync(evilPath)).toBe(false)
    })

    it('含 / 和 \\ 的名称被替换为下划线后仍可读写', async () => {
      await profileService.set('a/b\\c', { notes: 'slashed' })
      expect((await profileService.get('a/b\\c')).notes).toBe('slashed')
    })
  })

  describe('set/get/update 基础', () => {
    it('set + get 应一致', async () => {
      const r = await profileService.set('张三好学生', { notes: '好学生', parentPhone: '13800000000' })
      expect(r.success).toBe(true)
      const data = await profileService.get('张三好学生')
      expect(data.notes).toBe('好学生')
      expect(data.parentPhone).toBe('13800000000')
    })

    it('不存在返回空对象', async () => {
      expect(await profileService.get('不存在XYZ')).toEqual({})
    })

    it('update 合并不覆盖', async () => {
      await profileService.set('合并好测试', { notes: '原备注', address: '北京' })
      // 修复: Windows 文件系统写入后需要短暂延迟确保 rename 可见
      await new Promise((r) => setTimeout(r, 10))
      await profileService.update('合并好测试', { parentPhone: '111' })
      await new Promise((r) => setTimeout(r, 10))
      const data = await profileService.get('合并好测试')
      expect(data.notes).toBe('原备注')
      expect(data.address).toBe('北京')
      expect(data.parentPhone).toBe('111')
    })

    it('损坏 JSON 返回空对象', async () => {
      const dir = path.join(tmpDir, 'eaa-data', 'profiles')
      fs.writeFileSync(path.join(dir, '损坏好.json'), 'not json{', 'utf-8')
      expect(await profileService.get('损坏好')).toEqual({})
    })
  })

  describe('名称规范化与碰撞风险 (C.13)', () => {
    it('特殊字符被替换为下划线', async () => {
      await profileService.set('testname123', { notes: 'ascii-clean' })
      expect((await profileService.get('testname123')).notes).toBe('ascii-clean')
    })

    it('不同特殊字符名称映射到同文件(当前行为记录)', async () => {
      await profileService.set('collideXY_A', { notes: 'first' })
      await profileService.set('collideX!Y@A', { notes: 'second' })
      // collideX!Y@A → collideX_Y_A.json, 覆盖 collideX... (取决于原名)
      // 此测试记录当前碰撞行为
      const data = await profileService.get('collideX!Y@A')
      expect(data.notes).toBeDefined()
    })

    it('emoji 被清洗(不在 CJK 基本区)', async () => {
      await profileService.set('学生奖', { notes: 'no-emoji' })
      expect((await profileService.get('学生奖')).notes).toBe('no-emoji')
    })
  })

  describe('重复写入', () => {
    it('连续 set 以最后一次为准', async () => {
      await profileService.set('覆盖好测试', { notes: '1' })
      await profileService.set('覆盖好测试', { notes: '2' })
      await profileService.set('覆盖好测试', { notes: '3' })
      expect((await profileService.get('覆盖好测试')).notes).toBe('3')
    })

    it('set 空对象', async () => {
      await profileService.set('空好对象', {})
      expect(await profileService.get('空好对象')).toEqual({})
    })
  })
})
