// =============================================================
// H-3 回归测试 — exportLog targetPath 安全校验
// 验证 exportLog 拒绝写入系统关键路径、相对路径、包含 .. 的路径
// =============================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const dir =
    tmpBase +
    sep +
    `log-export-h3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    dir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return dir
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: tmp.getPath,
  },
}))

const logger = await import('../../src/main/utils/logger')

describe('H-3: exportLog targetPath 安全校验', () => {
  beforeAll(() => {
    fs.mkdirSync(tmp.dir, { recursive: true })
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmp.dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })

  beforeEach(async () => {
    logger.setLogLevel('debug')
    logger.initLogger('debug', tmp.dir)
    // 清空 logs 目录
    const files = await fsp.readdir(tmp.dir).catch(() => [] as string[])
    for (const f of files) {
      if (f.endsWith('.log')) {
        await fsp.unlink(path.join(tmp.dir, f))
      }
    }
  })

  it('合法绝对路径应成功导出', async () => {
    // 先写一条日志
    logger.log('info', 'test', 'hello for export')
    // 等待异步写入完成
    await new Promise((r) => setTimeout(r, 50))
    // 导出到合法路径
    const targetPath = path.join(tmp.dir, 'exported.log')
    const bytes = await logger.exportLog(`main-${todayStr()}.log`, targetPath)
    expect(bytes).toBeGreaterThan(0)
    // 验证文件确实写出
    const content = await fsp.readFile(targetPath, 'utf-8')
    expect(content).toContain('hello for export')
  })

  it('空 targetPath 应返回 0', async () => {
    logger.log('info', 'test', 'content')
    await new Promise((r) => setTimeout(r, 50))
    const bytes = await logger.exportLog(`main-${todayStr()}.log`, '')
    expect(bytes).toBe(0)
  })

  it('包含 null bytes 的 targetPath 应返回 0', async () => {
    logger.log('info', 'test', 'content')
    await new Promise((r) => setTimeout(r, 50))
    const bytes = await logger.exportLog(
      `main-${todayStr()}.log`,
      path.join(tmp.dir, 'evil\0.log'),
    )
    expect(bytes).toBe(0)
  })

  it('包含 .. 段的 targetPath 应返回 0', async () => {
    logger.log('info', 'test', 'content')
    await new Promise((r) => setTimeout(r, 50))
    // 直接构造包含 .. 的原始字符串(不用 path.join,否则会被规范化)
    const evilPath = tmp.dir + path.sep + '..' + path.sep + 'evil-export.log'
    const bytes = await logger.exportLog(`main-${todayStr()}.log`, evilPath)
    expect(bytes).toBe(0)
  })

  it('相对路径 targetPath 应返回 0', async () => {
    logger.log('info', 'test', 'content')
    await new Promise((r) => setTimeout(r, 50))
    const bytes = await logger.exportLog(`main-${todayStr()}.log`, 'relative/path.log')
    expect(bytes).toBe(0)
  })

  it('sourcePath 包含 .. 应返回 0 (源路径穿越防御)', async () => {
    logger.log('info', 'test', 'content')
    await new Promise((r) => setTimeout(r, 50))
    const targetPath = path.join(tmp.dir, 'out.log')
    const bytes = await logger.exportLog('../../../etc/passwd', targetPath)
    expect(bytes).toBe(0)
  })

  it('sourcePath 绝对路径应返回 0', async () => {
    logger.log('info', 'test', 'content')
    await new Promise((r) => setTimeout(r, 50))
    const targetPath = path.join(tmp.dir, 'out.log')
    const bytes = await logger.exportLog('/etc/passwd', targetPath)
    expect(bytes).toBe(0)
  })

  it('不存在的 sourcePath 应返回 0', async () => {
    const targetPath = path.join(tmp.dir, 'out.log')
    const bytes = await logger.exportLog('nonexistent-2026-01-01.log', targetPath)
    expect(bytes).toBe(0)
  })
})

// 平台相关: 系统关键路径拒绝
describe('H-3: exportLog 系统关键路径拒绝', () => {
  beforeAll(() => {
    fs.mkdirSync(tmp.dir, { recursive: true })
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmp.dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  beforeEach(async () => {
    logger.setLogLevel('debug')
    logger.initLogger('debug', tmp.dir)
    const files = await fsp.readdir(tmp.dir).catch(() => [] as string[])
    for (const f of files) {
      if (f.endsWith('.log')) {
        await fsp.unlink(path.join(tmp.dir, f))
      }
    }
  })

  if (process.platform === 'win32') {
    it('Windows: C:\\Windows\\ 下文件应被拒绝', async () => {
      logger.log('info', 'test', 'content')
      await new Promise((r) => setTimeout(r, 50))
      const bytes = await logger.exportLog(
        `main-${todayStr()}.log`,
        'C:\\Windows\\evil.log',
      )
      expect(bytes).toBe(0)
    })

    it('Windows: C:\\Program Files\\ 下文件应被拒绝', async () => {
      logger.log('info', 'test', 'content')
      await new Promise((r) => setTimeout(r, 50))
      const bytes = await logger.exportLog(
        `main-${todayStr()}.log`,
        'C:\\Program Files\\evil.log',
      )
      expect(bytes).toBe(0)
    })
  } else {
    it('Unix: /etc/ 下文件应被拒绝', async () => {
      logger.log('info', 'test', 'content')
      await new Promise((r) => setTimeout(r, 50))
      const bytes = await logger.exportLog(
        `main-${todayStr()}.log`,
        '/etc/evil.log',
      )
      expect(bytes).toBe(0)
    })

    it('Unix: /usr/ 下文件应被拒绝', async () => {
      logger.log('info', 'test', 'content')
      await new Promise((r) => setTimeout(r, 50))
      const bytes = await logger.exportLog(
        `main-${todayStr()}.log`,
        '/usr/local/evil.log',
      )
      expect(bytes).toBe(0)
    })

    it('Unix: ~/.ssh/ 下文件应被拒绝', async () => {
      logger.log('info', 'test', 'content')
      await new Promise((r) => setTimeout(r, 50))
      const home = process.env.HOME || '/tmp'
      const bytes = await logger.exportLog(
        `main-${todayStr()}.log`,
        path.join(home, '.ssh', 'authorized_keys'),
      )
      expect(bytes).toBe(0)
    })
  }
})

// 辅助: 返回今天的日期字符串(与 logger 内部 todayStr 一致)
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
