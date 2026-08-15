// =============================================================
// utils/log/ 模块测试 — levels / format / state / file-transport /
//                      query / rotation / api / export
// =============================================================

import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'

const mocks = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const tmpDir = `${tmpBase}${sep}log-mods-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

import { LEVEL_RANK, shouldLog, setLogLevel, getLogLevel, levelState } from '../../src/main/utils/log/levels'
import { fmt, stringify, todayStr } from '../../src/main/utils/log/format'
import { loggerState, getLogsDir } from '../../src/main/utils/log/state'
import { ensureDir, writeLine, clearAllLogs, ROTATE_CHECK_INTERVAL } from '../../src/main/utils/log/file-transport'
import { listLogFiles, readLogTail, readLogTailByLevel, searchLog } from '../../src/main/utils/log/query'
import { rotateLogsIfNeeded, doRotateLogs } from '../../src/main/utils/log/rotation'
import { log, logChat, logRenderer } from '../../src/main/utils/log/api'
import { exportLog, getSystemBlockedPrefixes } from '../../src/main/utils/log/export'

const logsDir = path.join(mocks.userDataDir, 'logs')

beforeAll(async () => {
  await fsp.mkdir(logsDir, { recursive: true })
})
afterAll(async () => {
  try {
    await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('log/levels — 级别控制', () => {
  afterEach(() => {
    setLogLevel('info')
  })

  it('初始级别为 info', () => {
    expect(getLogLevel()).toBe('info')
  })

  it('LEVEL_RANK 单调递增且 off 最大', () => {
    expect(LEVEL_RANK.debug).toBeLessThan(LEVEL_RANK.info)
    expect(LEVEL_RANK.info).toBeLessThan(LEVEL_RANK.warn)
    expect(LEVEL_RANK.warn).toBeLessThan(LEVEL_RANK.error)
    expect(LEVEL_RANK.error).toBeLessThan(LEVEL_RANK.off)
  })

  it('shouldLog 按当前级别过滤', () => {
    setLogLevel('warn')
    expect(shouldLog('debug')).toBe(false)
    expect(shouldLog('info')).toBe(false)
    expect(shouldLog('warn')).toBe(true)
    expect(shouldLog('error')).toBe(true)
    expect(shouldLog('off')).toBe(true)

    setLogLevel('debug')
    expect(shouldLog('debug')).toBe(true)
    expect(shouldLog('info')).toBe(true)

    setLogLevel('off')
    expect(shouldLog('error')).toBe(false)
    expect(shouldLog('off')).toBe(true)
  })

  it('setLogLevel 修改共享 levelState', () => {
    setLogLevel('error')
    expect(levelState.currentLevel).toBe('error')
    expect(getLogLevel()).toBe('error')
  })
})

describe('log/format — 格式化', () => {
  it('fmt 输出 ISO 时间 + 级别 + scope + 消息', () => {
    const line = fmt('warn', 'cron', '任务触发')
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(line).toContain('[WARN] [cron] 任务触发')
  })

  it('stringify: 字符串原样,对象 JSON 序列化,循环引用回退 String()', () => {
    expect(stringify('plain')).toBe('plain')
    expect(stringify({ a: 1 })).toBe('{"a":1}')
    expect(stringify([1, 2])).toBe('[1,2]')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(stringify(circular)).toBe(String(circular))
  })

  it('todayStr 输出 YYYY-MM-DD', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const d = new Date()
    expect(todayStr()).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
  })
})

describe('log/state — 共享状态', () => {
  it('logsDir 初始为 userData/logs', () => {
    expect(getLogsDir()).toBe(logsDir)
    expect(loggerState.logsDir.endsWith('logs')).toBe(true)
  })
})

describe('log/file-transport — 写入与清空', () => {
  it('writeLine 按 stream 追加到对应日期文件', async () => {
    loggerState.writeCounter = 0
    await writeLine('main', 'line-1')
    await writeLine('main', 'line-2')
    const content = await fsp.readFile(path.join(logsDir, `main-${todayStr()}.log`), 'utf-8')
    expect(content).toBe('line-1\nline-2\n')
    expect(loggerState.writeCounter).toBe(2)

    await writeLine('chat', 'chat-line')
    const chat = await fsp.readFile(path.join(logsDir, `chat-${todayStr()}.log`), 'utf-8')
    expect(chat).toBe('chat-line\n')
  })

  it('writeLine 达到 ROTATE_CHECK_INTERVAL 时重置计数', async () => {
    loggerState.writeCounter = ROTATE_CHECK_INTERVAL - 1
    loggerState.lastRotateCheck = 0
    await writeLine('renderer', 'trigger-rotate-check')
    expect(loggerState.writeCounter).toBe(0)
  })

  it('ensureDir 幂等创建目录', () => {
    expect(() => ensureDir()).not.toThrow()
    expect(fs.existsSync(logsDir)).toBe(true)
  })

  it('clearAllLogs 仅删除 .log 文件并返回数量', async () => {
    await fsp.writeFile(path.join(logsDir, 'main-2026-01-01.log'), 'x', 'utf-8')
    await fsp.writeFile(path.join(logsDir, 'chat-2026-01-01.log'), 'x', 'utf-8')
    await fsp.writeFile(path.join(logsDir, 'keep.txt'), 'x', 'utf-8')
    const n = await clearAllLogs()
    expect(n).toBeGreaterThanOrEqual(2)
    expect(fs.existsSync(path.join(logsDir, 'keep.txt'))).toBe(true)
    expect(fs.existsSync(path.join(logsDir, 'main-2026-01-01.log'))).toBe(false)
  })
})
describe('log/query — 列表/tail/过滤/搜索', () => {
  beforeAll(async () => {
    // 构造测试文件集
    await fsp.writeFile(
      path.join(logsDir, 'main-2026-01-02.log'),
      'l1 [INFO] [a] first\nl2 [WARN] [b] second\nl3 [ERROR] [c] third\nl4 [INFO] [d] fourth',
      'utf-8',
    )
    await fsp.writeFile(path.join(logsDir, 'main-2026-01-01.log'), 'old', 'utf-8')
    await fsp.writeFile(path.join(logsDir, 'chat-2026-01-03.log'), 'chat', 'utf-8')
    await fsp.writeFile(path.join(logsDir, 'not-a-log.txt'), 'x', 'utf-8')
    await fsp.writeFile(path.join(logsDir, 'badname.log'), 'x', 'utf-8')
  })

  it('listLogFiles: 仅匹配 (main|chat|renderer)-YYYY-MM-DD.log,按日期倒序', async () => {
    const files = await listLogFiles()
    const names = files.map((f) => f.name)
    expect(names).toContain('main-2026-01-02.log')
    expect(names).toContain('main-2026-01-01.log')
    expect(names).toContain('chat-2026-01-03.log')
    expect(names).not.toContain('not-a-log.txt')
    expect(names).not.toContain('badname.log')
    // 倒序
    expect(names.indexOf('chat-2026-01-03.log')).toBeLessThan(names.indexOf('main-2026-01-01.log'))
    const m = files.find((f) => f.name === 'main-2026-01-02.log')
    expect(m?.stream).toBe('main')
    expect(m?.date).toBe('2026-01-02')
    expect(m?.sizeBytes).toBeGreaterThan(0)
  })

  it('readLogTail: 返回末尾 N 行', async () => {
    const tail = await readLogTail('main-2026-01-02.log', 2)
    expect(tail).toBe('l3 [ERROR] [c] third\nl4 [INFO] [d] fourth')
    const all = await readLogTail('main-2026-01-02.log', 100)
    expect(all.split('\n').length).toBe(4)
  })

  it('readLogTail: 路径穿越返回空串', async () => {
    expect(await readLogTail('../evil.log', 10)).toBe('')
    expect(await readLogTail('..\\evil.log', 10)).toBe('')
    expect(await readLogTail('../../outside.txt', 10)).toBe('')
  })

  it('readLogTail: 不存在文件返回空串', async () => {
    expect(await readLogTail('main-1999-12-31.log')).toBe('')
  })

  it('readLogTailByLevel: 按 [LEVEL] 过滤,空数组不过滤', async () => {
    const warns = await readLogTailByLevel('main-2026-01-02.log', ['warn'])
    expect(warns).toBe('l2 [WARN] [b] second')

    const warnErr = await readLogTailByLevel('main-2026-01-02.log', ['warn', 'error'])
    expect(warnErr).toBe('l2 [WARN] [b] second\nl3 [ERROR] [c] third')

    const none = await readLogTailByLevel('main-2026-01-02.log', ['debug'])
    expect(none).toBe('')

    const all = await readLogTailByLevel('main-2026-01-02.log', [])
    expect(all.split('\n').length).toBe(4)
  })

  it('searchLog: 子串匹配大小写不敏感;空查询回退 tail', async () => {
    const r1 = await searchLog('main-2026-01-02.log', 'FOURTH')
    expect(r1).toBe('l4 [INFO] [d] fourth')
    const r2 = await searchLog('main-2026-01-02.log', 'warn')
    expect(r2).toBe('l2 [WARN] [b] second')
    const r3 = await searchLog('main-2026-01-02.log', '   ')
    expect(r3.split('\n').length).toBe(4)
  })
})

describe('log/rotation — 过期清理', () => {
  it('doRotateLogs: 删除 30 天前的日志,保留近期与无日期文件', async () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 3_600_000)
    const oldName = `main-${oldDate.toISOString().slice(0, 10)}.log`
    const recentName = `main-${todayStr()}.log`
    await fsp.writeFile(path.join(logsDir, oldName), 'old', 'utf-8')
    await fsp.writeFile(path.join(logsDir, recentName), 'new', 'utf-8')
    await fsp.writeFile(path.join(logsDir, 'no-date.log'), 'x', 'utf-8')

    await doRotateLogs()

    expect(fs.existsSync(path.join(logsDir, oldName))).toBe(false)
    expect(fs.existsSync(path.join(logsDir, recentName))).toBe(true)
    expect(fs.existsSync(path.join(logsDir, 'no-date.log'))).toBe(true)
  })

  it('rotateLogsIfNeeded: 1 小时内不重复轮转', async () => {
    loggerState.lastRotateCheck = Date.now() // 刚检查过
    const oldDate = new Date(Date.now() - 40 * 24 * 3_600_000)
    const oldName = `chat-${oldDate.toISOString().slice(0, 10)}.log`
    await fsp.writeFile(path.join(logsDir, oldName), 'old', 'utf-8')

    await rotateLogsIfNeeded()
    // 被节流跳过,文件仍在
    expect(fs.existsSync(path.join(logsDir, oldName))).toBe(true)

    // 超过 1 小时后执行轮转
    loggerState.lastRotateCheck = Date.now() - 3_600_001
    await rotateLogsIfNeeded()
    expect(fs.existsSync(path.join(logsDir, oldName))).toBe(false)
    expect(loggerState.rotateInFlight).toBeNull()
  })

  it('rotateLogsIfNeeded: 复用 in-flight Promise 不重复执行', async () => {
    // 悬挂的 in-flight Promise: 若被复用,则不会启动新的轮转
    const pending = new Promise<void>(() => {})
    loggerState.lastRotateCheck = 0
    loggerState.rotateInFlight = pending

    const oldDate = new Date(Date.now() - 40 * 24 * 3_600_000)
    const oldName = `main-${oldDate.toISOString().slice(0, 10)}.log`
    await fsp.writeFile(path.join(logsDir, oldName), 'old', 'utf-8')

    void rotateLogsIfNeeded()
    await new Promise((r) => setTimeout(r, 30))

    // 未启动新轮转: 文件未删、状态中的 in-flight 仍为原 Promise、检查时间未刷新
    expect(fs.existsSync(path.join(logsDir, oldName))).toBe(true)
    expect(loggerState.rotateInFlight).toBe(pending)

    // 清理悬挂状态,避免影响后续用例
    loggerState.rotateInFlight = null
  })
})

describe('log/api — 公开写入 API', () => {
  afterEach(() => {
    setLogLevel('info')
  })

  it('log(): 按级别写入 main 流', async () => {
    const name = `main-${todayStr()}.log`
    await clearAllLogs()
    log('error', 'scope-x', '错误消息')
    // writeLine 是 fire-and-forget,等待落盘
    await new Promise((r) => setTimeout(r, 50))
    const content = await fsp.readFile(path.join(logsDir, name), 'utf-8')
    expect(content).toContain('[ERROR] [scope-x] 错误消息')

    // 级别被过滤时不写入(文件不产生)
    await clearAllLogs()
    setLogLevel('warn')
    log('info', 'scope-x', '不应写入')
    await new Promise((r) => setTimeout(r, 50))
    expect(fs.existsSync(path.join(logsDir, name))).toBe(false)
  })

  it('logChat(): 写入 chat 流,payload 序列化', async () => {
    await clearAllLogs()
    logChat('in', { text: '你好' })
    await new Promise((r) => setTimeout(r, 50))
    const content = await fsp.readFile(path.join(logsDir, `chat-${todayStr()}.log`), 'utf-8')
    expect(content).toContain('[INFO] [chat-in] {"text":"你好"}')

    // off 级别不写入(文件不产生)
    await clearAllLogs()
    setLogLevel('off')
    logChat('out', 'x')
    await new Promise((r) => setTimeout(r, 50))
    expect(fs.existsSync(path.join(logsDir, `chat-${todayStr()}.log`))).toBe(false)
  })

  it('logRenderer(): 写入 renderer 流', async () => {
    await clearAllLogs()
    logRenderer('warn', '渲染告警')
    await new Promise((r) => setTimeout(r, 50))
    const content = await fsp.readFile(path.join(logsDir, `renderer-${todayStr()}.log`), 'utf-8')
    expect(content).toContain('[WARN] [renderer] 渲染告警')
  })
})

describe('log/export — 导出与安全约束', () => {
  beforeAll(async () => {
    await fsp.writeFile(path.join(logsDir, 'main-2026-01-02.log'), 'export-me', 'utf-8')
  })

  it('导出到合法绝对路径返回字节数', async () => {
    const target = path.join(mocks.userDataDir, 'exported.log')
    const n = await exportLog('main-2026-01-02.log', target)
    expect(n).toBe(Buffer.byteLength('export-me', 'utf-8'))
    expect(await fsp.readFile(target, 'utf-8')).toBe('export-me')
  })

  it('源文件名路径穿越返回 0', async () => {
    expect(await exportLog('../evil.log', path.join(mocks.userDataDir, 'x.log'))).toBe(0)
  })

  it('目标路径非法(空/含NUL/相对路径/含..)返回 0', async () => {
    const abs = path.join(mocks.userDataDir, 'y.log')
    expect(await exportLog('main-2026-01-02.log', '')).toBe(0)
    expect(await exportLog('main-2026-01-02.log', 'bad\0path')).toBe(0)
    expect(await exportLog('main-2026-01-02.log', 'relative.log')).toBe(0)
    // 注意不能用 path.join 构造(会被规范化移除 ..),用原始拼接保留 .. 段
    const traversal = `${mocks.userDataDir}${path.sep}..${path.sep}escape.log`
    expect(await exportLog('main-2026-01-02.log', traversal)).toBe(0)
    void abs
  })

  it('目标为系统关键目录返回 0(H-3)', async () => {
    if (process.platform === 'win32') {
      expect(await exportLog('main-2026-01-02.log', 'C:\\Windows\\system32\\evil.log')).toBe(0)
      expect(await exportLog('main-2026-01-02.log', 'C:\\Program Files\\evil.log')).toBe(0)
    } else {
      expect(await exportLog('main-2026-01-02.log', '/etc/evil.log')).toBe(0)
      expect(await exportLog('main-2026-01-02.log', '/usr/bin/evil')).toBe(0)
    }
  })

  it('源文件不存在返回 0', async () => {
    expect(await exportLog('main-1999-01-01.log', path.join(mocks.userDataDir, 'z.log'))).toBe(0)
  })

  it('getSystemBlockedPrefixes 按平台返回关键目录', () => {
    const prefixes = getSystemBlockedPrefixes()
    if (process.platform === 'win32') {
      expect(prefixes).toContain('C:\\Windows')
      expect(prefixes).toContain('C:\\Program Files')
    } else {
      expect(prefixes).toContain('/etc')
      expect(prefixes).toContain('/usr')
    }
  })
})