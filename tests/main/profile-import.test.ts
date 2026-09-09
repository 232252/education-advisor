// =============================================================
// 花名册档案写入 + 隐私登记
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  profileUpdate: vi.fn(),
  eaaExecute: vi.fn(),
  hasPrivacyPassword: vi.fn(() => false),
  invalidate: vi.fn(),
}))

vi.mock('../../src/main/services/profile-service', () => ({
  profileService: { update: mocks.profileUpdate },
}))

vi.mock('../../src/main/services/eaa-bridge', () => ({
  eaaBridge: {
    execute: mocks.eaaExecute,
    hasPrivacyPassword: () => mocks.hasPrivacyPassword(),
  },
}))

vi.mock('../../src/main/services/agent/privacy-guard', () => ({
  invalidatePrivacyGuardCache: mocks.invalidate,
}))

const { applyStudentRosterProfile, registerRosterPrivacy, isAlreadyExistsError } = await import(
  '../../src/main/services/profile-import'
)

describe('applyStudentRosterProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.profileUpdate.mockResolvedValue({ success: true })
  })

  it('空补丁不写盘', async () => {
    expect(await applyStudentRosterProfile('张三', {})).toEqual({ written: false })
    expect(mocks.profileUpdate).not.toHaveBeenCalled()
  })

  it('有字段时合并写入档案', async () => {
    const result = await applyStudentRosterProfile('张三', {
      idCard: '990000200801011232',
      phone: '13800001111',
    })
    expect(result).toEqual({ written: true })
    expect(mocks.profileUpdate).toHaveBeenCalledWith(
      '张三',
      expect.objectContaining({
        idCard: '990000200801011232',
        gender: '男',
        birthDate: '2008-01-01',
        phone: '13800001111',
      }),
    )
  })
})

describe('registerRosterPrivacy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.eaaExecute.mockResolvedValue({ success: true, data: 'ok' })
  })

  it('未解锁则跳过', async () => {
    mocks.hasPrivacyPassword.mockReturnValue(false)
    const result = await registerRosterPrivacy([
      { name: '张三', patch: { idCard: '990000200801011232' } },
    ])
    expect(result).toEqual({ registered: 0, skippedLocked: true })
    expect(mocks.eaaExecute).not.toHaveBeenCalled()
  })

  it('已解锁则登记姓名与身份证', async () => {
    mocks.hasPrivacyPassword.mockReturnValue(true)
    const result = await registerRosterPrivacy([
      { name: '张三', patch: { idCard: '990000200801011232', phone: '13800001111' } },
    ])
    expect(result.skippedLocked).toBe(false)
    expect(result.registered).toBeGreaterThanOrEqual(2)
    expect(mocks.invalidate).toHaveBeenCalled()
    const entities = mocks.eaaExecute.mock.calls.map((c) => (c[0] as { args: string[] }).args[2])
    expect(entities).toEqual(expect.arrayContaining(['person', 'id_card', 'phone']))
  })
})

describe('isAlreadyExistsError', () => {
  it('识别中英已存在', () => {
    expect(isAlreadyExistsError('student already exists', null)).toBe(true)
    expect(isAlreadyExistsError('学生已存在', null)).toBe(true)
    expect(isAlreadyExistsError('write failed', null)).toBe(false)
  })
})
