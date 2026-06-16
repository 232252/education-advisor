// =============================================================
// logger.ts 纯函数单元测试
// - 3 个核心路径:
//   1) readLogTail 读取不存在的文件 → 返回空字符串(不抛)
//   2) searchLog 在测试日志里查找关键词 → 返回匹配行
//   3) readLogTailByLevel 过滤 ERROR 级别 → 只返回 ERROR 行
// - 额外: listLogFiles / 末尾 N 行截断 / 大小写不敏感(防御性覆盖)
// - electron.app.getPath() 通过 vi.hoisted 桩到 tmp 目录
// - 测试日志文件用 mkdtempSync + writeFileSync 写入,rmSync 清理
// =============================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// hoisted mock: 必须在 import logger 之前生效
// 不能在这里调 fs.mkdtempSync(hoisted 阶段对 fs 的可访问性视环境而定),
// 也不能用 os.tmpdir()(hoisted 阶段 os 模块还在 TDZ,引用会抛
// "Cannot access __vi_import_X__ before initialization")。
// 改用 process.env 兜底,这些变量在 hoist 阶段已经可用。
const tmp = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase =
    process.env.TEMP || process.env.TMP || process.env.TMPDIR || '/tmp'
  const dir =
    tmpBase + sep + `logger-utils-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    dir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return dir
      throw new Error(`Unexpected getPath: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: { getPath: tmp.getPath },
}))

// 必须在 vi.mock 之后
const logger = await import('../../src/main/utils/logger')

// 复用一个本地 today 字符串函数(避免依赖模块内私有 helper)
const todayStr = (d: Date = new Date()): string => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

describe('logger.ts 纯函数 (listLogFiles / readLogTail / searchLog / readLogTailByLevel)', () => {
  beforeAll(() => {
    // mkdtempSync 风格: 真实创建一个干净的 tmp 目录
    fs.mkdirSync(tmp.dir, { recursive: true })
  })

  afterAll(async () => {
    // rmSync 清理
    try {
      await fsp.rm(tmp.dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  beforeEach(async () => {
    // 把 logger 内部 logsDir 重新指向我们的 tmp 目录,并清空残留
    logger.initLogger('debug', tmp.dir)
    const files = await fsp.readdir(tmp.dir).catch(() => [] as string[])
    for (const f of files) {
      if (f.endsWith('.log')) {
        await fsp.unlink(path.join(tmp.dir, f))
      }
    }
  })

  // =================================================================
  // 核心路径 #1: readLogTail 读取不存在的文件 → 空字符串,不抛
  // =================================================================
  describe('readLogTail 核心路径', () => {
    it('读取不存在的文件 → 返回空字符串(不抛错)', async () => {
      const out = await logger.readLogTail('does-not-exist.log')
      expect(out).toBe('')
    })

    it('读取存在的文件 → 返回末尾 N 行(用 writeFileSync 写入的测试日志)', () => {
      const date = todayStr()
      const file = path.join(tmp.dir, `main-${date}.log`)
      fs.writeFileSync(file, ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n') + '\n', 'utf-8')

      return logger.readLogTail(`main-${date}.log`, 3).then((out) => {
        // source: content.split('\n').slice(-3).join('\n')
        //   "l1\nl2\nl3\nl4\nl5\n" → ['l1','l2','l3','l4','l5','']  (6 元素)
        //   slice(-3) → ['l4','l5','']  (末尾空元素是 split 出来的)
        //   filter 掉空行 → ['l4','l5']
        const lines = out.split('\n').filter((l) => l.length > 0)
        expect(lines).toEqual(['l4', 'l5'])
      })
    })
  })

  // =================================================================
  // 核心路径 #2: searchLog 在测试日志里查找关键词 → 返回匹配行
  // =================================================================
  describe('searchLog 核心路径', () => {
    it('在测试日志中查找关键词 "ERROR" → 返回 2 个匹配行', async () => {
      const date = todayStr()
      const file = path.join(tmp.dir, `main-${date}.log`)
      const content =
        [
          'INFO startup complete',
          'ERROR failed to connect db',
          'WARN retrying connection',
          'ERROR timeout occurred',
          'INFO recovered after retry',
        ].join('\n') + '\n'
      fs.writeFileSync(file, content, 'utf-8')

      const out = await logger.searchLog(`main-${date}.log`, 'ERROR', 100)
      const matched = out.split('\n').filter((l) => l.length > 0)
      expect(matched.length).toBe(2)
      expect(matched.every((l) => l.includes('ERROR'))).toBe(true)
    })

    it('大小写不敏感: 传 "error" 也能匹配到 "ERROR" 行', async () => {
      const date = todayStr()
      const file = path.join(tmp.dir, `main-${date}.log`)
      fs.writeFileSync(file, 'ERROR boom\ninfo ok\n', 'utf-8')

      const out = await logger.searchLog(`main-${date}.log`, 'error', 100)
      const matched = out.split('\n').filter((l) => l.length > 0)
      expect(matched.length).toBe(1)
      expect(matched[0]).toContain('ERROR')
    })
  })

  // =================================================================
  // 核心路径 #3: readLogTailByLevel 过滤 ERROR 级别
  // =================================================================
  describe('readLogTailByLevel 核心路径', () => {
    it('levels=["ERROR"] → 只返回 [ERROR] 行(2 条)', async () => {
      const date = todayStr()
      const file = path.join(tmp.dir, `main-${date}.log`)
      const content =
        [
          '2024-01-01T00:00:00.000Z [INFO] [boot] started',
          '2024-01-01T00:00:01.000Z [WARN] [boot] slow disk',
          '2024-01-01T00:00:02.000Z [ERROR] [boot] cannot mount',
          '2024-01-01T00:00:03.000Z [INFO] [boot] retried',
          '2024-01-01T00:00:04.000Z [ERROR] [boot] hard fail',
        ].join('\n') + '\n'
      fs.writeFileSync(file, content, 'utf-8')

      const out = await logger.readLogTailByLevel(`main-${date}.log`, ['ERROR'], 100)
      const matched = out.split('\n').filter((l) => l.length > 0)
      expect(matched.length).toBe(2)
      expect(matched.every((l) => l.includes('[ERROR]'))).toBe(true)
    })
  })

  // =================================================================
  // 防御性覆盖: listLogFiles 基础场景
  // (任务里把 listLogFiles 也列在接口清单中,确保它至少能跑通一个 case)
  // =================================================================
  describe('listLogFiles 防御性覆盖', () => {
    it('写入 main-YYYY-MM-DD.log 后能被 listLogFiles 识别', async () => {
      const date = todayStr()
      fs.writeFileSync(path.join(tmp.dir, `main-${date}.log`), 'hello\n', 'utf-8')

      const files = await logger.listLogFiles()
      expect(files.length).toBe(1)
      expect(files[0]).toMatchObject({ stream: 'main', date })
      expect(files[0].sizeBytes).toBeGreaterThan(0)
    })
  })
})
