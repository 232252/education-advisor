// =============================================================
// e2e harness — 真实 EAA 二进制端到端测试的共用基建
//
// business-scenario / component-render / page-render /
// user-flow-simulation / stress-long 五份文件此前各自复制的
// setup/eaaRun/mockApi 在此收敛为单一实现,并随收敛修复三处副本漂移:
//   1. ranking 不传 n 时显式传 N=100000 拉全量(EAA CLI 默认 N=10 非全量)
//   2. class.create 的 id 带 random 后缀(防同毫秒并发撞号)
//   3. reset 走「全删重建」(只重写种子文件会残留缓存/jsonl,产生幽灵实体)
//
// 注意: vi.mock(...) 是编译期提升,只能留在各测试文件内,不放本文件。
// =============================================================

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, vi } from 'vitest'

// ---------- EAA 二进制解析(跨平台) ----------
const _dirName =
  process.platform === 'win32'
    ? 'win32-x64'
    : process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'darwin-arm64'
        : 'darwin-x64'
      : 'linux-x64'
const _binName = process.platform === 'win32' ? 'eaa.exe' : 'eaa'
export const EAA_BIN = join(
  __dirname,
  '..',
  '..',
  'resources',
  'eaa-binaries',
  _dirName,
  _binName,
)
// 平台二进制缺失(如 macOS 无 darwin 构建)时整组跳过,避免 CI 误报 ENOENT
export const describeE2E = existsSync(EAA_BIN) ? describe : describe.skip

// ---------- 测试环境(mkdtemp 根 + 种子 + schema) ----------
export interface EaaEnv {
  testRoot: string
  testData: string
  /** 绑定本 env 的 eaa 调用(带瞬态重试);json:true 时解析并返回 JSON */
  eaaRun: (args: string[], opts?: EaaRunOpts) => Promise<unknown>
  /** 全删重建种子结构(防幽灵实体,见 resetEaaData 注释) */
  resetEaaData: () => void
  /** afterAll 清理测试根目录 */
  cleanup: () => void
}

/** 建测试根: mkdtemp 前缀 + 空种子文件 + schema 拷贝(eaa 在 dataDir 父目录找 schema) */
export function createEaaEnv(prefix: string): EaaEnv {
  const testRoot = mkdtempSync(join(tmpdir(), prefix))
  const testData = join(testRoot, 'data')
  const schemaSrc = join(__dirname, '..', '..', 'core', 'eaa-cli', 'schema', 'reason_codes.json')

  const seed = () => {
    mkdirSync(join(testData, 'entities'), { recursive: true })
    mkdirSync(join(testData, 'events'), { recursive: true })
    writeFileSync(join(testData, 'entities', 'entities.json'), '{"entities":{}}')
    writeFileSync(join(testData, 'entities', 'name_index.json'), '{}')
    writeFileSync(join(testData, 'events', 'events.json'), '[]')
  }
  mkdirSync(join(testRoot, 'schema'), { recursive: true })
  seed()
  if (existsSync(schemaSrc)) {
    writeFileSync(join(testRoot, 'schema', 'reason_codes.json'), readFileSync(schemaSrc))
  }

  const env: EaaEnv = {
    testRoot,
    testData,
    eaaRun: (args, opts) => eaaRunImpl(env, args, opts),
    resetEaaData: () => {
      // 完整重置: eaa 实际存储是 events/events.jsonl + entities/*.cache.json + logs/,
      // 只重写 3 个种子文件会残留 scores 缓存和 jsonl 事件,产生"幽灵实体"(name="?")
      // 污染后续 ranking。直接删整个 data 目录再重建种子结构。
      try {
        rmSync(testData, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      seed()
    },
    cleanup: () => {
      try {
        rmSync(testRoot, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    },
  }
  return env
}

// ---------- eaa 进程调用(带瞬态重试) ----------
export interface EaaRunOpts {
  json?: boolean
  timeout?: number
}

function eaaRunOnce(env: EaaEnv, args: string[], opts: EaaRunOpts = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn(EAA_BIN, args, {
      env: { ...process.env, EAA_DATA_DIR: env.testData },
      timeout: opts.timeout ?? 10_000,
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d) => (stdout += d.toString()))
    proc.stderr?.on('data', (d) => (stderr += d.toString()))
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`eaa ${args[0]} exit ${code}: ${stderr.slice(0, 200)}`))
        return
      }
      if (opts.json) {
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new Error(`eaa ${args[0]} not JSON: ${stdout.slice(0, 200)}`))
        }
      } else {
        resolve(stdout)
      }
    })
  })
}

/** eaaRun 带重试实现 — 并发进程争用文件锁时 eaa 可能 exit 0 但 stdout 为空
 *  (或 JSON 解析失败)。自动重试最多 3 次,每次退避递增。 */
async function eaaRunImpl(env: EaaEnv, args: string[], opts: EaaRunOpts = {}): Promise<unknown> {
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const out = await eaaRunOnce(env, args, opts)
      if (typeof out === 'string' && out.trim() === '' && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 80 * (attempt + 1)))
        continue
      }
      return out
    } catch (err) {
      const msg = String(err)
      const isTransient =
        msg.includes('not JSON') ||
        msg.includes('Unexpected end of JSON') ||
        msg.includes('exit')
      if (attempt < MAX_RETRIES && isTransient) {
        await new Promise((r) => setTimeout(r, 80 * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error(`eaa ${args[0]} failed after ${MAX_RETRIES + 1} attempts`)
}

// ---------- mockApi(指向真实 eaa 的 window.api 替身) ----------
export interface MockClassEntity {
  id: string
  class_id: string
  name: string
  grade?: string
  teacher?: string
  note?: string
  archived: boolean
  created_at: number
}

/** 构建内存 classList + mockApi(eaa 域走真实二进制,class/sys 域内存实现) */
export function buildMockApi(env: EaaEnv) {
  const classList: MockClassEntity[] = []
  const { eaaRun } = env
  const eaaSetClass = async (name: string, classId: string) => {
    await eaaRun(['set-student-meta', name, '--class-id', classId])
  }

  const mockApi = {
    eaa: {
      listStudents: vi.fn(async () => {
        const r = await eaaRun(['list-students', '-O', 'json'])
        return { success: true, data: JSON.parse(r as string) }
      }),
      addStudent: vi.fn(async (name: string) => {
        try {
          await eaaRun(['add-student', name])
          return { success: true }
        } catch (e) {
          return { success: false, error: String(e) }
        }
      }),
      deleteStudent: vi.fn(async (name: string) => {
        try {
          await eaaRun(['delete-student', name, '--confirm'])
          return { success: true }
        } catch (e) {
          return { success: false, error: String(e) }
        }
      }),
      setStudentMeta: vi.fn(
        async (p: { name: string; classId?: string; clearClassId?: boolean }) => {
          try {
            if (p.clearClassId) await eaaRun(['set-student-meta', p.name, '--clear-class-id'])
            else if (p.classId) await eaaRun(['set-student-meta', p.name, '--class-id', p.classId])
            return { success: true }
          } catch (e) {
            return { success: false, error: String(e) }
          }
        },
      ),
      ranking: vi.fn(async (n?: number) => {
        // 不传 n 时显式拉全量(EAA CLI 默认 N=10 不是全量)
        const r = await eaaRun(['ranking', String(n ?? 100_000), '-O', 'json'])
        const data = JSON.parse(r as string) as {
          ranking: Array<{
            rank: number
            name: string
            entity_id: string
            class_id?: string | null
            score: number
          }>
        }
        // 增强: 用 listStudents 的 class_id 填充 ranking (与 IPC handler 逻辑一致)
        try {
          const studentsRaw = await eaaRun(['list-students', '-O', 'json'])
          const students = JSON.parse(studentsRaw as string) as {
            students: Array<{ entity_id: string; class_id?: string | null }>
          }
          const classIdMap: Record<string, string | null> = {}
          for (const s of students.students) {
            classIdMap[s.entity_id] = s.class_id ?? null
          }
          for (const item of data.ranking) {
            item.class_id = classIdMap[item.entity_id] ?? null
          }
        } catch {
          /* enrichment failure is non-fatal */
        }
        return { success: true, data }
      }),
      summary: vi.fn(async () => {
        const r = await eaaRun(['summary', '-O', 'json'])
        const data = JSON.parse(r as string) as Record<string, unknown>
        // 增强: 用 listStudents 的 class_id 填充 top_gainers/top_losers
        try {
          const studentsRaw = await eaaRun(['list-students', '-O', 'json'])
          const students = JSON.parse(studentsRaw as string) as {
            students: Array<{ name: string; class_id?: string | null }>
          }
          const nameToClassId: Record<string, string | null> = {}
          for (const s of students.students) {
            nameToClassId[s.name] = s.class_id ?? null
          }
          for (const group of ['top_gainers', 'top_losers'] as const) {
            const items = data[group]
            if (Array.isArray(items)) {
              for (const item of items as Array<{ name: string; class_id?: string | null }>) {
                item.class_id = nameToClassId[item.name] ?? null
              }
            }
          }
        } catch {
          /* enrichment failure is non-fatal */
        }
        return { success: true, data }
      }),
      stats: vi.fn(async () => {
        const r = await eaaRun(['info', '-O', 'json'])
        return { success: true, data: { ...JSON.parse(r as string), classes: classList.length } }
      }),
      listCodes: vi.fn(async () => ({ success: true, data: { codes: [] } })),
      range: vi.fn(async () => ({ success: true, data: { events: [] } })),
      tag: vi.fn(async () => ({ success: true, data: { tags: [] } })),
      exportFormats: vi.fn(async () => ['csv', 'jsonl', 'html']),
      import: vi.fn(async () => ({ success: true })),
      export: vi.fn(async () => ({ success: true })),
    },
    class: {
      list: vi.fn(async () => ({ success: true, data: classList })),
      create: vi.fn(
        async (params: {
          class_id: string
          name: string
          grade?: string
          teacher?: string
          note?: string
        }) => {
          // random 后缀防同毫秒并发创建撞 id
          const id = `cls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          classList.push({
            id,
            class_id: params.class_id,
            name: params.name,
            grade: params.grade,
            teacher: params.teacher,
            note: params.note,
            archived: false,
            created_at: Date.now(),
          })
          return { success: true, data: classList[classList.length - 1] }
        },
      ),
      update: vi.fn(async () => ({ success: true })),
      archive: vi.fn(async (id: string) => {
        const c = classList.find((x) => x.id === id)
        if (c) c.archived = true
        return { success: true }
      }),
      restore: vi.fn(async (id: string) => {
        const c = classList.find((x) => x.id === id)
        if (c) c.archived = false
        return { success: true }
      }),
      delete: vi.fn(async (id: string) => {
        const i = classList.findIndex((x) => x.id === id)
        if (i >= 0) classList.splice(i, 1)
        return { success: true }
      }),
      assign: vi.fn(async (params: { class_id: string; student_names: string[] }) => {
        const failed: string[] = []
        let assigned = 0
        for (const name of params.student_names) {
          try {
            await eaaSetClass(name, params.class_id)
            assigned++
          } catch (e) {
            failed.push(`${name}: ${e}`)
          }
        }
        return { success: true, assigned, failed }
      }),
      remove: vi.fn(async () => ({ success: true })),
    },
    sys: {
      openDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      saveDialog: vi.fn(async () => ({ canceled: true })),
    },
  }

  return { mockApi, classList }
}

/** 注入 window.api(jsdom 全局) + matchMedia 桩(jsdom 缺) */
export function installWindowApi(mockApi: unknown): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window = { api: mockApi }
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
