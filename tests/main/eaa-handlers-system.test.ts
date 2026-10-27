// =============================================================
// eaa handlers-system — 系统诊断/静态数据域 IPC 边界测试
// 真 TtlLruCache/sanitize/日期校验/失败信封 + 假 eaaBridge/cache 模块。
// 覆盖: 静态缓存命中不重执行、tag 复合键与注入防御、doctor fix
// 绕缓存并失效 info/codes、summary 类型与 ISO 日期校验、ranking 参数
// 矩阵与 1000 封顶/100000 全量、list-students 只缓存成功、四缓存联动
// 失效、写钩子防重入守卫、invalidate-cache 通道。
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown> | unknown>()

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  onWriteCommand: vi.fn(),
  invalidateStudentsCacheNow: vi.fn(),
  prefillScoreCacheFromRanking: vi.fn(),
  setInvalidateStudentsCacheFn: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: { getPath: vi.fn(() => 'C:/tmp/eaa-sys-test'), isPackaged: false },
}))
vi.mock('../../src/main/services/eaa-bridge', () => ({
  eaaBridge: { execute: mocks.execute, onWriteCommand: mocks.onWriteCommand },
}))
vi.mock('../../src/main/ipc/eaa/cache', () => ({
  invalidateStudentsCacheNow: mocks.invalidateStudentsCacheNow,
  prefillScoreCacheFromRanking: mocks.prefillScoreCacheFromRanking,
  setInvalidateStudentsCacheFn: mocks.setInvalidateStudentsCacheFn,
}))

import { TtlLruCache } from '../../src/main/services/eaa-cache'
import { registerSystemHandlers } from '../../src/main/ipc/eaa/handlers-system'
import * as IPC from '@shared/ipc-channels'

let staticCache: TtlLruCache<unknown>
let scoreCache: TtlLruCache<unknown>
let invalidate: () => void

function register() {
  staticCache = new TtlLruCache<unknown>({ ttlMs: 30_000, maxEntries: 32 })
  scoreCache = new TtlLruCache<unknown>({ ttlMs: 3_000, maxEntries: 64 })
  const r = registerSystemHandlers({
    staticCache,
    scoreCache,
    setStaticCacheIfSuccess: (key, data) => {
      if (data && typeof data === 'object' && (data as { success?: boolean }).success) {
        staticCache.set(key, data)
      }
    },
  })
  invalidate = r.invalidateStudentsCache
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error('handler not registered: ' + channel)
  return (await fn({} as never, ...args)) as T
}

const OK = { success: true, data: { x: 1 } }

describe('eaa handlers-system', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlers.clear()
    mocks.execute.mockResolvedValue(OK)
    register()
  })

  it('写钩子防重入: 重复注册只挂一次 onWriteCommand(模块级守卫)', () => {
    register()
    register()
    expect(mocks.onWriteCommand).toHaveBeenCalledTimes(1)
  })

  it('静态缓存: 命中不重执行,仅 success 结果写缓存', async () => {
    const r1 = await call(IPC.IPC_EAA_INFO)
    expect(r1).toEqual(OK)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    const r2 = await call(IPC.IPC_EAA_INFO)
    expect(r2).toEqual(OK)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('tag: 复合缓存键按标签分缓存;注入字符标签走失败信封', async () => {
    await call(IPC.IPC_EAA_TAG, 'math')
    await call(IPC.IPC_EAA_TAG, 'math')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await call(IPC.IPC_EAA_TAG, 'english')
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute).toHaveBeenLastCalledWith({ command: 'tag', args: ['english'] })
    await call(IPC.IPC_EAA_TAG)
    expect(mocks.execute).toHaveBeenLastCalledWith({ command: 'tag', args: [] })

    const bad = await call<{ success: boolean; error: string }>(IPC.IPC_EAA_TAG, 'a;b')
    expect(bad.success).toBe(false)
    expect(bad.error).toContain('illegal characters')
  })

  it('doctor: fix=true 绕读写缓存并失效 info/codes;fix=false 走缓存', async () => {
    await call(IPC.IPC_EAA_INFO)
    await call(IPC.IPC_EAA_DOCTOR, true)
    expect(mocks.execute).toHaveBeenLastCalledWith({ command: 'doctor', args: ['--fix'] })
    // info 缓存被 fix 失效 → 重新执行
    await call(IPC.IPC_EAA_INFO)
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    // doctor fix 结果不缓存: 再次 fix 仍执行
    await call(IPC.IPC_EAA_DOCTOR, true)
    expect(mocks.execute).toHaveBeenCalledTimes(4)
    // 非 fix 走缓存
    await call(IPC.IPC_EAA_DOCTOR)
    await call(IPC.IPC_EAA_DOCTOR)
    expect(mocks.execute).toHaveBeenCalledTimes(5)
  })

  it('summary: 非字符串与非法 ISO 日期拒绝;合法范围按组合键缓存', async () => {
    const bad1 = await call<{ success: boolean }>(IPC.IPC_EAA_SUMMARY, 5)
    expect(bad1.success).toBe(false)
    const bad2 = await call<{ success: boolean; error: string }>(IPC.IPC_EAA_SUMMARY, '2026-01-01', 'not-a-date')
    expect(bad2.success).toBe(false)
    expect(bad2.error).toContain('YYYY-MM-DD')

    await call(IPC.IPC_EAA_SUMMARY, '2026-01-01', '2026-01-31')
    await call(IPC.IPC_EAA_SUMMARY, '2026-01-01', '2026-01-31')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledWith({
      command: 'summary',
      args: ['--since', '2026-01-01', '--until', '2026-01-31'],
    })
    await call(IPC.IPC_EAA_SUMMARY, '2026-02-01', '2026-02-28')
    expect(mocks.execute).toHaveBeenCalledTimes(2)
  })

  it('ranking: 参数矩阵 + 1000 封顶 + 全量 100000 + 预填与只缓存成功', async () => {
    for (const bad of ['x', -1, Number.NaN, Infinity]) {
      const r = await call<{ success: boolean }>(IPC.IPC_EAA_RANKING, bad)
      expect(r.success).toBe(false)
    }
    expect(mocks.execute).not.toHaveBeenCalled()

    await call(IPC.IPC_EAA_RANKING)
    expect(mocks.execute).toHaveBeenLastCalledWith({ command: 'ranking', args: ['100000'] })
    await call(IPC.IPC_EAA_RANKING, 0)
    expect(mocks.execute).toHaveBeenLastCalledWith({ command: 'ranking', args: ['100000'] })
    await call(IPC.IPC_EAA_RANKING, 5)
    expect(mocks.execute).toHaveBeenLastCalledWith({ command: 'ranking', args: ['5'] })
    await call(IPC.IPC_EAA_RANKING, 5.9)
    expect(mocks.execute).toHaveBeenLastCalledWith({ command: 'ranking', args: ['5'] })
    await call(IPC.IPC_EAA_RANKING, 5000)
    expect(mocks.execute).toHaveBeenLastCalledWith({ command: 'ranking', args: ['1000'] })

    expect(mocks.prefillScoreCacheFromRanking).toHaveBeenCalledWith(scoreCache, OK)
    // 同 n 命中缓存不再执行
    await call(IPC.IPC_EAA_RANKING, 5000)
    expect(mocks.execute).toHaveBeenCalledTimes(5)

    // 失败结果不缓存
    mocks.execute.mockResolvedValueOnce({ success: false, error: 'boom' })
    register()
    await call(IPC.IPC_EAA_RANKING, 7)
    await call(IPC.IPC_EAA_RANKING, 7)
    expect(mocks.execute).toHaveBeenCalledTimes(7)
  })

  it('list-students: 成功缓存去重,失败不缓存', async () => {
    await call(IPC.IPC_EAA_LIST_STUDENTS)
    await call(IPC.IPC_EAA_LIST_STUDENTS)
    expect(mocks.execute).toHaveBeenCalledTimes(1)

    register()
    mocks.execute.mockResolvedValueOnce({ success: false, error: 'x' })
    await call(IPC.IPC_EAA_LIST_STUDENTS)
    await call(IPC.IPC_EAA_LIST_STUDENTS)
    expect(mocks.execute).toHaveBeenCalledTimes(3)
  })

  it('invalidateStudentsCache: 四缓存联动失效', async () => {
    await call(IPC.IPC_EAA_INFO)
    await call(IPC.IPC_EAA_LIST_STUDENTS)
    await call(IPC.IPC_EAA_RANKING, 3)
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    invalidate()
    await call(IPC.IPC_EAA_INFO)
    await call(IPC.IPC_EAA_LIST_STUDENTS)
    await call(IPC.IPC_EAA_RANKING, 3)
    expect(mocks.execute).toHaveBeenCalledTimes(6)
    expect(mocks.setInvalidateStudentsCacheFn).toHaveBeenCalledWith(invalidate)
  })

  it('invalidate-cache 通道: 调全局失效并返回 success', async () => {
    const r = await call<{ success: boolean }>(IPC.IPC_EAA_INVALIDATE_CACHE)
    expect(r.success).toBe(true)
    expect(mocks.invalidateStudentsCacheNow).toHaveBeenCalledTimes(1)
  })
})