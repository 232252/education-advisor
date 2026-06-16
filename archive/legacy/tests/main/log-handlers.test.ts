// =============================================================
// Logger单元测试（P0-1 / T3关键路径）
// - mock electron.app.getPath()指向 tmp目录
// -测纯函数: listLogFiles / readLogTail / readLogTailByLevel /
// searchLog / exportLog / clearAllLogs
// =============================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'

// hoisted mock：必须在 import logger之前生效
const tmp = vi.hoisted(() => {
 const sep = process.platform === 'win32' ? '\\' : '/'
 const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
 const dir =
 tmpBase +
 sep +
 `logger-test-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
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

//必须在 vi.mock之后
const logger = await import('../../src/main/utils/logger')

describe('logger', () => {
 beforeAll(() => {
 //真实创建 tmp目录(hoisted 不能 import fs)
 fs.mkdirSync(tmp.dir, { recursive: true })
 })

 afterAll(async () => {
 try {
 await fsp.rm(tmp.dir, { recursive: true, force: true })
 } catch {
 // ignore
 }
 })

 beforeEach(async () => {
 // 每个 case 前清空 logs目录
 logger.setLogLevel('debug')
 logger.initLogger('debug', tmp.dir)
 const files = await fsp.readdir(tmp.dir).catch(() => [] as string[])
 for (const f of files) {
 if (f.endsWith('.log')) {
 await fsp.unlink(path.join(tmp.dir, f))
 }
 }
 })

 // --------基础路径 --------
 describe('initLogger / getLogsDir', () => {
 it('getLogsDir 返回初始化目录', () => {
 logger.initLogger('info', tmp.dir)
 expect(logger.getLogsDir()).toBe(tmp.dir)
 })

 it('getLogLevel 默认是 info', () => {
 logger.initLogger('debug', tmp.dir)
 expect(logger.getLogLevel()).toBe('debug')
 })

 it('setLogLevel切换等级', () => {
 logger.setLogLevel('error')
 expect(logger.getLogLevel()).toBe('error')
 logger.setLogLevel('debug')
 })
 })

 // -------- listLogFiles --------
 describe('listLogFiles', () => {
 it('空目录返回 []', async () => {
 const files = await logger.listLogFiles()
 expect(files).toEqual([])
 })

 it('写入 main-YYYY-MM-DD.log 后能列出', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const file = path.join(tmp.dir, `main-${date}.log`)
 await fsp.writeFile(file, 'hello\n', 'utf-8')
 const files = await logger.listLogFiles()
 expect(files.length).toBe(1)
 expect(files[0].stream).toBe('main')
 expect(files[0].date).toBe(date)
 expect(files[0].sizeBytes).toBeGreaterThan(0)
 })

  it('chat- 与 renderer- 也都能被识别', async () => {
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  await fsp.writeFile(path.join(tmp.dir, `chat-${date}.log`), 'c\n', 'utf-8')
  await fsp.writeFile(path.join(tmp.dir, `renderer-${date}.log`), 'r\n', 'utf-8')
  const files = await logger.listLogFiles()
  const streams = files.map((f) => f.stream).sort()
  // initLogger() 不会主动写 main- 文件,只有 console.* 被调用时才追加。
  // 此 case 没调 console.*,所以 main 不存在,只有 chat + renderer。
  expect(streams).toEqual(['chat', 'renderer'])
  })

 it('非 .log 文件被忽略', async () => {
 await fsp.writeFile(path.join(tmp.dir, 'random.txt'), 'no', 'utf-8')
 const files = await logger.listLogFiles()
 expect(files.find((f) => f.name === 'random.txt')).toBeUndefined()
 })
 })

 // -------- readLogTail --------
 describe('readLogTail', () => {
 beforeEach(async () => {
 //写入一个5行的 main log
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const file = path.join(tmp.dir, `main-${date}.log`)
 const lines = ['line1', 'line2', 'line3', 'line4', 'line5']
 await fsp.writeFile(file, lines.join('\n') + '\n', 'utf-8')
 })

  it('读取存在的文件返回末尾 N 行', async () => {
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const out = await logger.readLogTail(`main-${date}.log`,3)
  // 文件内容: "line1\nline2\nline3\nline4\nline5\n"
  // source 的 readLogTail: content.split('\n').slice(-3).join('\n')
  //   split → 6 元素 ['line1','line2','line3','line4','line5','']
  //   slice(-3) → ['line4','line5','']
  //   join('\n') → "line4\nline5\n"
  // 测试 filter 掉空行,得到 2 个非空行
  const lines = out.split('\n').filter((l) => l.length >0)
  expect(lines).toEqual(['line4', 'line5'])
  })

 it('默认100 行不截断5 行文件', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const out = await logger.readLogTail(`main-${date}.log`)
 const lines = out.split('\n').filter((l) => l.length >0)
 expect(lines).toEqual(['line1', 'line2', 'line3', 'line4', 'line5'])
 })

 it('读取不存在的文件返回空字符串(不抛)', async () => {
 const out = await logger.readLogTail('does-not-exist.log')
 expect(out).toBe('')
 })
 })

 // -------- searchLog --------
 describe('searchLog', () => {
 beforeEach(async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const file = path.join(tmp.dir, `main-${date}.log`)
 const lines = [
 'INFO startup complete',
 'ERROR failed to connect db',
 'WARN retrying connection',
 'ERROR timeout occurred',
 'INFO recovered after retry',
 ]
 await fsp.writeFile(file, lines.join('\n') + '\n', 'utf-8')
 })

 it('搜索 "ERROR" 返回2 行', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const out = await logger.searchLog(`main-${date}.log`, 'ERROR',100)
 const matched = out.split('\n').filter((l) => l.length >0)
 expect(matched.length).toBe(2)
 expect(matched[0]).toContain('ERROR')
 expect(matched[1]).toContain('ERROR')
 })

 it('大小写不敏感', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const out = await logger.searchLog(`main-${date}.log`, 'error',100)
 const matched = out.split('\n').filter((l) => l.length >0)
 expect(matched.length).toBe(2)
 })

 it('空查询返回 readLogTail末尾', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const out = await logger.searchLog(`main-${date}.log`, ' ',100)
 expect(out.length).toBeGreaterThan(0)
 })

 it('无匹配返回空字符串', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const out = await logger.searchLog(`main-${date}.log`, 'NOMATCH_TOKEN_XYZ',100)
 expect(out).toBe('')
 })

 it('搜索不存在的文件返回空字符串', async () => {
 const out = await logger.searchLog('does-not-exist.log', 'foo')
 expect(out).toBe('')
 })
 })

 // -------- readLogTailByLevel --------
 describe('readLogTailByLevel', () => {
 beforeEach(async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const file = path.join(tmp.dir, `main-${date}.log`)
 const lines = [
 '2024-01-01T00:00:00.000Z [INFO] [boot] started',
 '2024-01-01T00:00:01.000Z [WARN] [boot] slow disk',
 '2024-01-01T00:00:02.000Z [ERROR] [boot] cannot mount',
 '2024-01-01T00:00:03.000Z [INFO] [boot] retried',
 '2024-01-01T00:00:04.000Z [ERROR] [boot] hard fail',
 '2024-01-01T00:00:05.000Z [DEBUG] [boot] shutdown',
 ]
 await fsp.writeFile(file, lines.join('\n') + '\n', 'utf-8')
 })

 it('levels=["ERROR"] 只返回 ERROR 行', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const out = await logger.readLogTailByLevel(`main-${date}.log`, ['ERROR'],100)
 const matched = out.split('\n').filter((l) => l.length >0)
 expect(matched.length).toBe(2)
 expect(matched.every((l) => l.includes('[ERROR]'))).toBe(true)
 })

 it('levels=["ERROR","WARN"] 返回 ERROR + WARN 行', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const out = await logger.readLogTailByLevel(`main-${date}.log`, ['ERROR', 'WARN'],100)
 const matched = out.split('\n').filter((l) => l.length >0)
 expect(matched.length).toBe(3)
 expect(matched.some((l) => l.includes('[ERROR]'))).toBe(true)
 expect(matched.some((l) => l.includes('[WARN]'))).toBe(true)
 })

 it('levels=[] 退化为 readLogTail', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const out = await logger.readLogTailByLevel(`main-${date}.log`, [],100)
 const matched = out.split('\n').filter((l) => l.length >0)
 expect(matched.length).toBe(6)
 })

 it('levels 大小写不敏感', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const out = await logger.readLogTailByLevel(`main-${date}.log`, ['error'],100)
 const matched = out.split('\n').filter((l) => l.length >0)
 expect(matched.length).toBe(2)
 })
 })

 // -------- exportLog --------
 describe('exportLog', () => {
 it('导出存在的文件返回字节数', async () => {
 const today = new Date()
 const date = `${today.getFullYear()}-${String(today.getMonth() +1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
 const src = path.join(tmp.dir, `main-${date}.log`)
 const content = 'export me\n'
 await fsp.writeFile(src, content, 'utf-8')
 const dst = path.join(tmp.dir, 'exported.log')
 const bytes = await logger.exportLog(`main-${date}.log`, dst)
 const expected = Buffer.byteLength(content, 'utf-8')
 expect(bytes).toBe(expected)
 const written = await fsp.readFile(dst, 'utf-8')
 expect(written).toBe(content)
 })

 it('导出不存在的文件返回0', async () => {
 const dst = path.join(tmp.dir, 'no-source-export.log')
 const bytes = await logger.exportLog('does-not-exist.log', dst)
 expect(bytes).toBe(0)
 })
 })

 // -------- clearAllLogs --------
 describe('clearAllLogs', () => {
 it('清除所有 .log 文件', async () => {
 await fsp.writeFile(path.join(tmp.dir, 'main-2024-01-01.log'), 'm', 'utf-8')
 await fsp.writeFile(path.join(tmp.dir, 'chat-2024-01-01.log'), 'c', 'utf-8')
 await fsp.writeFile(path.join(tmp.dir, 'keep.txt'), 'k', 'utf-8')
 const n = await logger.clearAllLogs()
 expect(n).toBeGreaterThanOrEqual(2)
 // keep.txt仍存在
 expect(fs.existsSync(path.join(tmp.dir, 'keep.txt'))).toBe(true)
 })
 })
})
