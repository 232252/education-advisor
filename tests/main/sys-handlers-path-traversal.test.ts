// =============================================================
// H-2 回归测试 — sys-handlers IPC_SYS_READ_FILE 路径穿越防御
// 验证 handler 对包含 .. 段和 null bytes 的路径返回结构化错误 { success: false, error }
// (Bug #2 修复: 从 throw 改为 return 结构化错误,与其他 IPC 处理器一致)
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return path.join(os.tmpdir(), 'sys-h3-test')
    if (name === 'home') return os.homedir()
    if (name === 'temp') return os.tmpdir()
    throw new Error(`Unexpected path: ${name}`)
  }),
  isPackaged: false,
}))

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
    isPackaged: mocks.isPackaged,
  },
  BrowserWindow: class {},
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn(),
  },
  Notification: class {
    static isSupported() { return false }
    show() {}
  },
  shell: {
    openExternal: vi.fn(),
  },
}))

vi.mock('../../src/main/services/update-service', () => ({
  updateService: {
    checkForUpdates: vi.fn(),
    showUpdateDialog: vi.fn(),
    // M31: 下载/安装层新方法 (sys-handlers 注册进度推送 + 新 IPC handler)
    setProgressListener: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
  },
}))

import { registerSysHandlers } from '../../src/main/ipc/sys-handlers'
import * as IPC from '@shared/ipc-channels'

describe('H-2: IPC_SYS_READ_FILE 路径穿越防御', () => {
  beforeAll(() => {
    // 注册 handler,捕获到 handlers map 中
    registerSysHandlers({} as never)
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('handler 应已注册', () => {
    expect(handlers.has(IPC.IPC_SYS_READ_FILE)).toBe(true)
  })

  it('空字符串应返回结构化错误', async () => {
    const handler = handlers.get(IPC.IPC_SYS_READ_FILE)!
    const result = await handler({}, '')
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('non-empty string') })
  })

  it('null bytes 应返回结构化错误', async () => {
    const handler = handlers.get(IPC.IPC_SYS_READ_FILE)!
    const result = await handler({}, 'evil\0path.txt')
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('null bytes') })
  })

  it('包含 .. 段的路径应返回结构化错误', async () => {
    const handler = handlers.get(IPC.IPC_SYS_READ_FILE)!
    const result = await handler({}, '../../../etc/passwd')
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('path traversal') })
  })

  it('Windows 风格 .. 段应返回结构化错误', async () => {
    const handler = handlers.get(IPC.IPC_SYS_READ_FILE)!
    const result = await handler({}, '..\\..\\windows\\system32')
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('path traversal') })
  })

  it('中间包含 .. 段的路径应返回结构化错误', async () => {
    const handler = handlers.get(IPC.IPC_SYS_READ_FILE)!
    const result = await handler({}, '/tmp/foo/../bar/file.txt')
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('path traversal') })
  })

  it('不存在的文件应返回 success: false(不抛穿越错)', async () => {
    const handler = handlers.get(IPC.IPC_SYS_READ_FILE)!
    // 这个路径不包含 .., 应通过校验但 statSync 失败
    const result = await handler({}, '/tmp/nonexistent-file-xyz-12345.txt')
    expect(result).toEqual({
      success: false,
      error: expect.any(String),
      path: '/tmp/nonexistent-file-xyz-12345.txt',
    })
  })
})
