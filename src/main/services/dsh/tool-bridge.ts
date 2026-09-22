// =============================================================
// 把「主进程内的 eaa 工具」接到「独立 dsh 子进程」的桥
//
// dsh SDK 没有注册工具的入口，因此走 dsh 自己的 MCP 客户端插件：
// @deepseek-ai/dsh-mcp-client 的 streamable-http transport 连一个 URL，
// URL 由本桥在 app 主进程里起的 HTTP 服务端提供 —— 工具因此仍然直接命中
// app 的 service 单例。
//
// 为什么「一次运行挂一个端点」而不是一套全局 profile：
// mcp-client 没有工具白名单（一个实例把它看到的工具全量注册），而 patch 是
// 子进程启动时读一次的。app 的最小权限恰恰按角色不同（getToolsByCapability、
// delegate_to 只给 main、开脱敏时工具是本次运行包装出来的实例）。所以每次
// agent 运行 register 一个只含该角色工具的端点 + 写一份只含该端点的 patch，
// 运行结束 unregister 并删文件。
//
// patch 行格式取自 dsh 官方示例（apps/cli/config/examples/mcp-memory/*.cordis.yml）：
//   - insert: [ { id, name: '@deepseek-ai/dsh-mcp-client', config: {...} } ]
// 配置字段与 packages/mcp/mcp-client/src/index.ts 的 Config 校验一致。
//
// 注意（会影响提示词）：mcp-client 强制把模型可见的工具名改写成
// `mcp__<serverName>__<rawName>`，没有关闭前缀的开关。所以 agent 的 system
// prompt 里提到的工具名必须按 mcpPublicName() 映射，否则模型看到的是提示里的
// 旧名字、可调用列表里却是新名字。
//
// harness 自带工具由 hardening.ts 那份 patch 关掉，且由 createDshRuntime 保证
// 排在本次挂载之前 —— 这里只生成挂载行。
// =============================================================

import { readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify } from 'yaml'

import {
  type EaaMcpEndpoint,
  type EaaMcpServerHandle,
  type ExposedTool,
  startEaaMcpServer,
} from './eaa-mcp-server'
import { mcpToolNameMap } from './tool-names'

const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client'
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 120_000
/** 每个挂载一份 patch：文件名含 serverName，release 时删除 */
const PATCH_FILE_PREFIX = 'eaa-mcp-'
const PATCH_FILE_SUFFIX = '.cordis.patch.yml'
/** mcp-client 要求 [A-Za-z0-9_-]{1,32} 且同进程实例间唯一 */
const SERVER_NAME_MAX = 32

export interface EaaMcpMountInput {
  serverName: string
  url: string
  token: string
  instanceId?: string
  toolCallTimeoutMs?: number
}

/** 模型可见名（dsh 侧注册名），用于重写 agent 提示词里的工具名 */
export function mcpPublicName(rawName: string, serverName: string): string {
  return `mcp__${serverName}__${rawName}`
}

export function eaaMcpPatchFileName(serverName: string): string {
  return `${PATCH_FILE_PREFIX}${serverName}${PATCH_FILE_SUFFIX}`
}

/** 生成 cordis patch YAML 文本（用 yaml 序列化，避免手写引号出错） */
export function buildEaaMcpPatch(mount: EaaMcpMountInput): string {
  return stringify(
    [
      {
        insert: [
          {
            id: mount.instanceId ?? `eaa-mcp-${mount.serverName}`,
            name: MCP_CLIENT_PACKAGE,
            config: {
              serverName: mount.serverName,
              transport: 'streamable-http',
              url: mount.url,
              headers: { authorization: `Bearer ${mount.token}` },
              toolCallTimeoutMs: mount.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
              // 桥在 dsh 之前就已监听，连不上说明配置错了 —— 按 dsh 约定响亮失败
              failOnStartupError: true,
            },
          },
        ],
      },
    ],
    { lineWidth: 0 },
  )
}

/** 上一次运行崩溃遗留的 patch 文件（内含 token）在起桥时清扫 */
async function sweepStalePatches(patchDir: string): Promise<void> {
  const names = await readdir(patchDir).catch(() => [] as string[])
  await Promise.all(
    names
      .filter((n) => n.startsWith(PATCH_FILE_PREFIX) && n.endsWith(PATCH_FILE_SUFFIX))
      .map((n) => unlink(join(patchDir, n)).catch(() => {})),
  )
}

/**
 * agent id → serverName。label 只允许 [A-Za-z0-9_-]，其它字符（含中文角色名）
 * 换成下划线；尾部序号保证同一角色的多次运行不撞名，所以截断不会造成冲突。
 */
function agentServerName(label: string, seq: number): string {
  const slug = label.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'agent'
  const suffix = `-${seq}`
  return `${slug.slice(0, SERVER_NAME_MAX - suffix.length)}${suffix}`
}

export interface EaaToolMount {
  serverName: string
  /** 交给 DshRuntime 的 patches —— 该次运行的 dsh 子进程只看得到这份 */
  patchPath: string
  /** 原名 → 模型可见名，用于重写 system prompt */
  toolNameMap: Record<string, string>
  endpoint: EaaMcpEndpoint
  /** 撤端点 + 删 patch；运行结束（含异常）必须调用 */
  release: () => Promise<void>
}

interface ActiveBridge {
  server: EaaMcpServerHandle
  patchDir: string
  seq: number
}

/** 对外可见的桥信息：不外露 token，只给端口 */
export interface EaaToolBridgeInfo {
  port: number
  patchDir: string
  close: () => Promise<void>
}

let activeBridge: ActiveBridge | null = null
let startingBridge: Promise<ActiveBridge> | null = null

/**
 * 幂等起桥：整个进程一个 HTTP 监听，每次 agent 运行在它上面挂自己的端点。
 * 多个 dsh 子进程并发各连一个端点，互相看不到对方的工具集。
 */
export async function ensureActiveEaaToolBridge(opts: {
  patchDir: string
}): Promise<EaaToolBridgeInfo> {
  if (!activeBridge) {
    if (!startingBridge) {
      startingBridge = (async () => {
        const server = await startEaaMcpServer({ port: 0 })
        const bridge: ActiveBridge = { server, patchDir: opts.patchDir, seq: 0 }
        await sweepStalePatches(bridge.patchDir)
        activeBridge = bridge
        return bridge
      })()
      // 一次失败不能留在记忆里，否则之后永远起不了桥
      startingBridge.catch(() => {
        startingBridge = null
      })
    }
    await startingBridge
  }
  const bridge = activeBridge as ActiveBridge
  return {
    port: bridge.server.port,
    patchDir: bridge.patchDir,
    close: () => stopActiveEaaToolBridge(),
  }
}

export async function stopActiveEaaToolBridge(): Promise<void> {
  const bridge = activeBridge
  activeBridge = null
  startingBridge = null
  if (bridge) await bridge.server.close().catch(() => {})
}

/**
 * 为一次 agent 运行挂载它自己那份工具集。
 *
 * patchPath 内含该端点的 token，release() 删除它；进程崩溃时可能残留，
 * 但这些 token 只对 127.0.0.1 上的这一次监听有效，且下次起桥时被清扫。
 */
export async function mountEaaAgentTools(opts: {
  label: string
  tools: readonly ExposedTool[]
  toolCallTimeoutMs?: number
}): Promise<EaaToolMount> {
  const bridge = activeBridge
  if (!bridge) throw new Error('eaa 工具桥未启动，无法挂载 dsh agent 工具')

  const serverName = agentServerName(opts.label, ++bridge.seq)
  const endpoint = bridge.server.register({ name: serverName, tools: opts.tools })
  const patchPath = join(bridge.patchDir, eaaMcpPatchFileName(serverName))
  try {
    await writeFile(
      patchPath,
      buildEaaMcpPatch({
        serverName,
        url: endpoint.url,
        token: endpoint.token,
        toolCallTimeoutMs: opts.toolCallTimeoutMs,
      }),
      'utf8',
    )
  } catch (err) {
    // patch 写失败就别留一个挂着的端点
    bridge.server.unregister(serverName)
    throw err
  }

  return {
    serverName,
    patchPath,
    toolNameMap: mcpToolNameMap(opts.tools, serverName),
    endpoint,
    release: async () => {
      bridge.server.unregister(serverName)
      await unlink(patchPath).catch(() => {})
    },
  }
}
