// =============================================================
// EAA 原因码 (reason-codes) 缓存
// 从 ipc/eaa-reason-codes.ts 移入 services 层(services/eaa 的工具与
// ipc/eaa/ 的 params.ts 均依赖它,原 ipc 路径改为纯 re-export 保持兼容)。
// 合并 eaa-handlers.ts 原本的 lookupReasonCodeDelta + getReasonCodeDef,
// 消除 90% 重复的"读 config/reason-codes.json 并缓存"逻辑。
// 导出签名保持不变。
// =============================================================

import fs from 'node:fs'
import path from 'node:path'

type ReasonCodeDef = { delta: number | null }
type ReasonCodeMap = Record<string, ReasonCodeDef>

/**
 * 单一缓存入口。eaa-handlers 原本 lookupReasonCodeDelta 和 getReasonCodeDef
 * 各自维护一份 cachedReasonCodes,逻辑重复。此处合并。
 *
 * 容错策略(来自源码 L33-36 / L67-70):
 * - 文件缺失:缓存空对象,避免每次调用都执行 2 次 sync stat
 * - 解析失败:同样缓存空对象,避免反复尝试读取损坏文件
 */
let cached: ReasonCodeMap | null = null

function resolveCodesPath(): string {
  const devPath = path.join(__dirname, '..', '..', 'config', 'reason-codes.json')
  // process.resourcesPath 仅在 Electron 主进程存在;测试环境(node)为 undefined,
  // 此时只走 dev 路径,避免 path.join 抛 TypeError。
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  const prodPath = resourcesPath ? path.join(resourcesPath, 'config', 'reason-codes.json') : ''
  if (fs.existsSync(devPath)) return devPath
  return prodPath // prodPath 为 '' 时 existsSync 返回 false,上层会缓存空对象
}

function loadReasonCodes(): ReasonCodeMap {
  if (cached) return cached
  try {
    const codesPath = resolveCodesPath()
    if (!fs.existsSync(codesPath)) {
      // 文件缺失:缓存空对象,避免反复 stat
      cached = {}
      return cached
    }
    cached = JSON.parse(fs.readFileSync(codesPath, 'utf-8')) as ReasonCodeMap
    return cached
  } catch {
    // 解析失败:同样缓存空对象,避免反复尝试读取损坏的文件
    cached = {}
    return cached
  }
}

/**
 * 查找原因码的默认 delta 值。
 * 当 addEvent 调用未提供 delta 时,从 config/reason-codes.json 读取默认值。
 * 这解决了 EAA 二进制不传 --delta 时默认 0.0 导致校验失败的问题。
 *
 * v3.2.7 fix: 导出供 addEventTool 使用 — Agent 路径同样需要
 * 在 LLM 未提供 delta 时从 reason-codes.json 查默认值,否则 EAA CLI 默认 0.0
 * 会导致固定分值原因码 (如 LATE=-2.0) 校验失败。
 */
export function lookupReasonCodeDelta(reasonCode: string): number | undefined {
  const entry = loadReasonCodes()[reasonCode]
  if (entry && typeof entry.delta === 'number') return entry.delta
  return undefined
}

/**
 * 返回原因码的完整定义(含 delta 字段,可能为 null 表示变量分值)。
 * 用于判断是否为固定分值原因码 (delta !== null),固定分值原因码不允许 delta 覆盖。
 *
 * v3.2.7: 修复 BUG#2 — 固定分值原因码 (如 LATE=-2.0) 不应被前端传入的 delta 覆盖。
 */
export function getReasonCodeDef(reasonCode: string): ReasonCodeDef | undefined {
  return loadReasonCodes()[reasonCode]
}

/**
 * 仅供测试重置缓存使用。生产代码不要调用。
 */
export function resetReasonCodesCache(): void {
  cached = null
}
