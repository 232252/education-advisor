// =============================================================
// EAA Bridge — UTF-8 多字节 chunk 处理回归测试 (C.1)
// 验证: 当 stdout 的中文(多字节 UTF-8)字符被拆分到两个 data chunk 时,
//       最终 JSON.parse 仍能成功(不被 U+FFFD 替换符破坏)
// 此前 bug: 逐 chunk toString() 会把跨 chunk 的多字节字符变成替换符
// =============================================================

import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(os.tmpdir(), `eaa-utf8-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
const userDataDir = path.join(tmpRoot, 'userData')

class MockChildProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  killed = false
  constructor() {
    super()
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
  }
  kill() {
    this.killed = true
  }
}

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return userDataDir
    throw new Error(`Unexpected path: ${name}`)
  }),
  isPackaged: false,
  spawnImpl: vi.fn((_cmd: string, _args: string[], _options?: unknown) => new MockChildProcess()),
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath, isPackaged: mocks.isPackaged },
}))

vi.mock('cross-spawn', () => ({
  default: mocks.spawnImpl,
  __esModule: true,
}))

function isEaaBinaryPath(p: string): boolean {
  return (
    (p.includes('eaa-binaries') && (p.endsWith('eaa.exe') || p.endsWith('eaa'))) ||
    (p.includes('eaa-cli') && (p.endsWith('eaa.exe') || p.endsWith('eaa')))
  )
}

let existsSpy: ReturnType<typeof vi.spyOn> | null = null

beforeAll(async () => {
  await fsp.mkdir(userDataDir, { recursive: true })
  const origExists = fs.existsSync.bind(fs)
  existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    const ps = typeof p === 'string' ? p : ''
    if (isEaaBinaryPath(ps)) return true
    return origExists(p)
  })
})

afterAll(async () => {
  existsSpy?.mockRestore()
  try {
    await fsp.rm(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks()
})

// 辅助: 让 mock 在 setImmediate 中跨多 chunk emit 数据(模拟真实的分片到达)
function mockWithSplitChunks(chunks: Buffer[]) {
  mocks.spawnImpl.mockImplementationOnce(() => {
    const proc = new MockChildProcess()
    setImmediate(() => {
      for (const c of chunks) {
        proc.stdout.emit('data', c)
      }
      proc.emit('close', 0)
    })
    return proc
  })
}

describe('EAA Bridge — UTF-8 多字节 chunk 处理', () => {
  it('中文 JSON 跨 chunk 拆分时应正确解析', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const payload = {
      students: [
        { name: '张三', score: 10 },
        { name: '李四', score: -5 },
        { name: '王五', score: 8 },
      ],
    }
    const buf = Buffer.from(JSON.stringify(payload), 'utf8')

    // 找一个多字节延续字节位置切开(确保切在字符中间)
    let splitAt = -1
    for (let i = 1; i < buf.length - 1; i++) {
      if ((buf[i] & 0xc0) === 0x80 && (buf[i - 1] & 0xc0) === 0x80) {
        splitAt = i
        break
      }
    }
    expect(splitAt).toBeGreaterThan(0)

    mockWithSplitChunks([buf.subarray(0, splitAt), buf.subarray(splitAt)])
    const bridge = new mod.EAABridge()
    const result = await bridge.execute({ command: 'list-students', args: ['list-students'] })

    expect(result.success).toBe(true)
    expect(result.data).not.toBeNull()
    const data = result.data as { students: Array<{ name: string }> }
    expect(data.students.map((s) => s.name)).toEqual(['张三', '李四', '王五'])
    expect(JSON.stringify(data)).not.toContain('\uFFFD')
  })

  it('单个 chunk 的中文也应正确', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const buf = Buffer.from(JSON.stringify({ name: '赵六钱七' }), 'utf8')

    mockWithSplitChunks([buf])
    const bridge = new mod.EAABridge()
    const result = await bridge.execute({ command: 'info', args: ['info'] })
    expect((result.data as { name: string }).name).toBe('赵六钱七')
  })

  it('emoji(4字节 UTF-8)跨 chunk 拆分也应正确', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const buf = Buffer.from(JSON.stringify({ note: '🎓奖励' }), 'utf8')
    const emojiStart = buf.indexOf(Buffer.from([0xf0, 0x9f, 0x8e, 0x93]))
    expect(emojiStart).toBeGreaterThanOrEqual(0)
    const splitAt = emojiStart + 2

    mockWithSplitChunks([buf.subarray(0, splitAt), buf.subarray(splitAt)])
    const bridge = new mod.EAABridge()
    const result = await bridge.execute({ command: 'info', args: ['info'] })
    expect((result.data as { note: string }).note).toBe('🎓奖励')
    expect(JSON.stringify(result.data)).not.toContain('\uFFFD')
  })

  it('纯 ASCII 跨 chunk 不受影响', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const buf = Buffer.from(JSON.stringify({ abc: 'hello world 12345' }), 'utf8')
    const mid = Math.floor(buf.length / 2)

    mockWithSplitChunks([buf.subarray(0, mid), buf.subarray(mid)])
    const bridge = new mod.EAABridge()
    const result = await bridge.execute({ command: 'info', args: ['info'] })
    expect((result.data as { abc: string }).abc).toBe('hello world 12345')
  })

  it('多个小 chunk 串行拼接也应正确', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const buf = Buffer.from(
      JSON.stringify({ students: [{ name: '陈十一' }, { name: '林十二' }] }),
      'utf8',
    )
    const chunkSize = 5
    const chunks: Buffer[] = []
    for (let i = 0; i < buf.length; i += chunkSize) {
      chunks.push(buf.subarray(i, Math.min(i + chunkSize, buf.length)))
    }

    mockWithSplitChunks(chunks)
    const bridge = new mod.EAABridge()
    const result = await bridge.execute({ command: 'info', args: ['info'] })
    const data = result.data as { students: Array<{ name: string }> }
    expect(data.students.map((s) => s.name)).toEqual(['陈十一', '林十二'])
  })

  it('stdout 大量中文不产生替换符', async () => {
    vi.resetModules()
    const mod = await import('../../src/main/services/eaa-bridge')
    const names = Array.from({ length: 50 }, (_, i) => ({ name: `测试学生${i}号`, score: i }))
    const buf = Buffer.from(JSON.stringify({ students: names }), 'utf8')
    // 切成 7 字节一段(故意在多字节边界切)
    const chunks: Buffer[] = []
    for (let i = 0; i < buf.length; i += 7) {
      chunks.push(buf.subarray(i, Math.min(i + 7, buf.length)))
    }

    mockWithSplitChunks(chunks)
    const bridge = new mod.EAABridge()
    const result = await bridge.execute({ command: 'info', args: ['info'] })
    const data = result.data as { students: Array<{ name: string }> }
    expect(data.students.length).toBe(50)
    expect(data.students[0].name).toBe('测试学生0号')
    expect(data.students[49].name).toBe('测试学生49号')
    expect(JSON.stringify(data)).not.toContain('\uFFFD')
  })
})
