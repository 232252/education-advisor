// =============================================================
// 把「主进程内的 eaa 工具」接到「独立 dsh 子进程」的桥
//
// dsh SDK 没有注册工具的入口，因此走 dsh 自己的 MCP 客户端插件：
// @deepseek-ai/dsh-mcp-client 的 streamable-http transport 连一个 URL，
// URL 由本桥在 app 主进程里起的 HTTP 服务端提供 —— 工具因此仍然直接命中
// app 的 service 单例。
//
// 为什么「一次运行挂一个端点」而不是一套全局 profile：
// mcp-client 没有工具白名单（一个实例把它看到的工具全量注册）。app 的最小
// 权限按角色不同（getToolsByCapability、delegate_to 只给 main、开脱敏时工具
// 是本次运行包装出来的实例）。所以每次运行 register 一个只含该角色工具的
// 端点，把地址交给 profile 里已经装好的四个 dsh-mcp-client 插件，运行结束
// unregister。不再为每次运行另插一行客户端。
//
// 挂载只走 profile 里预装的四个 dsh-mcp-client 插件（官方插件标准 §1.2），
// 不再为每次运行另插一行客户端。上次崩溃留下的 eaa-mcp-*.cordis.patch.yml
// 在起桥时清掉。
//
// 注意（会影响提示词）：mcp-client 强制把模型可见的工具名改写成
// `mcp__<serverName>__<rawName>`，没有关闭前缀的开关。所以 agent 的 system
// prompt 里提到的工具名必须按 mcpPublicName() 映射，否则模型看到的是提示里的
// 旧名字、可调用列表里却是新名字。
//
// harness 自带工具由 hardening.ts 那份 patch 关掉，且由 createDshRuntime 保证
// 排在本次挂载之前 —— 这里只生成挂载行。
// =============================================================

import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import {
  type EaaMcpEndpoint,
  type EaaMcpServerHandle,
  type ExposedTool,
  startEaaMcpServer,
} from './eaa-mcp-server'
import { EAA_PLUGINS, pluginForToolName } from './eaa-tools-contract'
import { mcpToolNameMap } from './tool-names'

/** 旧版逐运行 patch 的文件名特征，仅用于起桥时清扫崩溃残留 */
const PATCH_FILE_PREFIX = 'eaa-mcp-'
const PATCH_FILE_SUFFIX = '.cordis.patch.yml'
/** mcp-client 要求 [A-Za-z0-9_-]{1,32} 且同进程实例间唯一 */
const SERVER_NAME_MAX = 32

export { mcpPublicName } from './tool-names'

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

/** plugin 模式下一组工具对应一个已安装插件的环境变量。 */
export interface EaaPluginEndpoint {
  serverName: string
  urlEnv: string
  tokenEnv: string
  url: string
  token: string
}

export function pluginProcessEnv(endpoints: readonly EaaPluginEndpoint[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const ep of endpoints) {
    env[ep.urlEnv] = ep.url
    env[ep.tokenEnv] = ep.token
  }
  return env
}

export interface EaaToolMount {
  serverName: string
  /** 原名 → 模型可见名，用于重写 system prompt */
  toolNameMap: Record<string, string>
  endpoint: EaaMcpEndpoint
  /**
   * plugin 模式：每个非空工具组一条。没出现的组不要注入环境变量，
   * 对应插件保持关闭。patch 模式为空。
   */
  pluginEndpoints: EaaPluginEndpoint[]
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
 * 工具按名字分到花名册、成绩、批改、操行四个已安装插件。
 * 公开名是 mcp__roster__*、mcp__grades__*、mcp__grading__*、mcp__eaa__*。
 * 某组这次没有工具，就不给它地址。
 */
export async function mountEaaAgentTools(opts: {
  label: string
  tools: readonly ExposedTool[]
}): Promise<EaaToolMount> {
  const bridge = activeBridge
  if (!bridge) throw new Error('eaa 工具桥未启动，无法挂载 dsh agent 工具')
  // 只走已经装进 profile 的四个 dsh-mcp-client 插件。不再为每次运行另插一行客户端。
  return mountViaPlugins(bridge, opts.label, opts.tools)
}

function mountViaPlugins(
  bridge: ActiveBridge,
  label: string,
  tools: readonly ExposedTool[],
): EaaToolMount {
  const grouped = new Map<string, ExposedTool[]>()
  for (const tool of tools) {
    const plugin = pluginForToolName(tool.name)
    const list = grouped.get(plugin.serverName) ?? []
    list.push(tool)
    grouped.set(plugin.serverName, list)
  }
  const plugins = EAA_PLUGINS.filter((plugin) => grouped.has(plugin.serverName))
  if (plugins.length === 0) throw new Error('没有可挂载的工具')

  const names: string[] = []
  const pluginEndpoints: EaaPluginEndpoint[] = []
  const toolNameMap: Record<string, string> = {}
  try {
    for (const plugin of plugins) {
      const pathName = agentServerName(`${label}-${plugin.serverName}`, ++bridge.seq)
      const endpoint = bridge.server.register({
        name: pathName,
        tools: grouped.get(plugin.serverName) ?? [],
      })
      names.push(pathName)
      pluginEndpoints.push({
        serverName: plugin.serverName,
        urlEnv: plugin.urlEnv,
        tokenEnv: plugin.tokenEnv,
        url: endpoint.url,
        token: endpoint.token,
      })
      Object.assign(
        toolNameMap,
        mcpToolNameMap(grouped.get(plugin.serverName) ?? [], plugin.serverName),
      )
    }
  } catch (err) {
    for (const name of names) bridge.server.unregister(name)
    throw err
  }

  const primary = pluginEndpoints[0]
  if (!primary) throw new Error('没有可挂载的工具')
  return {
    serverName: primary.serverName,
    toolNameMap,
    endpoint: {
      url: primary.url,
      token: primary.token,
      toolCount: tools.length,
    },
    pluginEndpoints,
    release: async () => {
      for (const name of names) bridge.server.unregister(name)
    },
  }
}
