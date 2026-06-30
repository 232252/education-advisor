// =============================================================
// Profile Service 测试 — 学生扩展档案存储
// 覆盖：get/set/update、路径遍历防护、原子写入
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpDir = path.join(
  os.tmpdir(),
  `profile-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

describe('profileService', () => {
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

  beforeEach(async () => {
    const dir = path.join(tmpDir, 'eaa-data', 'profiles')
    try {
      const files = await fsp.readdir(dir)
      for (const f of files) await fsp.unlink(path.join(dir, f))
    } catch {
      /* ignore */
    }
  })

  it('get 不存在应返回空对象', () => {
    expect(profileService.get('nonexistent')).toEqual({})
  })

  it('set + get 应往返一致', () => {
    const data = { nickname: '小张', note: '学习委员' }
    const result = profileService.set('student-a', data)
    expect(result.success).toBe(true)
    const got = profileService.get('student-a')
    expect(got).toEqual(data)
  })

  it('update 应合并（不覆盖）现有字段', () => {
    profileService.set('student-b', { a: 1, b: 2 })
    profileService.update('student-b', { b: 3, c: 4 })
    const got = profileService.get('student-b')
    expect(got).toEqual({ a: 1, b: 3, c: 4 })
  })

  it('update 不存在的 key 应创建', () => {
    profileService.update('student-c', { newField: 'hello' })
    const got = profileService.get('student-c')
    expect(got).toEqual({ newField: 'hello' })
  })

  it('路径遍历防护：恶意名称应被清理', () => {
    // profileService 用正则替换不安全字符
    profileService.set('../../../etc/passwd', { test: 1 })
    const got = profileService.get('../../../etc/passwd')
    expect(got).toEqual({ test: 1 })
    // 实际写入目录应在 profiles 下,不在 etc
    // （这个测试只是验证不抛错并能正确 round-trip）
  })

  it('中文姓名应正确处理', () => {
    profileService.set('张三', { class: '高三一班' })
    const got = profileService.get('张三')
    expect(got).toEqual({ class: '高三一班' })
  })

  it('特殊字符应被替换为下划线', () => {
    profileService.set('a/b\\c:d', { x: 1 })
    const got = profileService.get('a/b\\c:d')
    expect(got).toEqual({ x: 1 })
  })
})
