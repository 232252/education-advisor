// =============================================================
// 把 eaa 工具集暴露成 MCP「Streamable HTTP」服务端
//
// 为什么需要它：dsh 是独立子进程，而 SDK 只有 initialize/session/prompt/shutdown
// 三个方法，没有注册工具的入口。dsh 侧的 @deepseek-ai/dsh-mcp-client 支持
// transport: stdio | streamable-http（见其 transport.ts），其中
// StreamableHTTPClientTransport 连的是 URL —— 因此本服务在主进程内起 HTTP，
// 工具仍然直接命中 app 的 service 单例（db / eaa-bridge / keystore）。
//
// 为什么按 profile 分端点：mcp-client 的 Config 里没有工具白名单/过滤项
// （只有 serverName/url/headers/超时/重连），一个实例会把它看到的工具全量注册。
// 而 app 侧是按 capability 给每个 agent 挑工具子集的（getToolsByCapability），
// 且 delegate_to 之类只允许注入 main。所以每个 agent 运行独占一个端点 + 独立
// token，它的 dsh 子进程只挂这一份 patch —— 官方注释正是「多个 server 就加载多个实例」。
//
// 端点可以在服务已监听后 register/unregister：patch 文件是子进程启动时读一次的，
// 所以「跑一次挂一次、结束就撤」是唯一能做到逐角色最小权限的形状。
//
// 安全：只绑 127.0.0.1，每个端点各带自己的 Bearer token。这些工具会真实读写
// 学生数据，绝不能对内网或本机其它用户开放。
// =============================================================

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

/**
 * 本模块只依赖这个自有接口，不 import pi：任何满足它的对象都能被暴露，
 * 现在唯一来源是 allEAATools（AgentTool<any>[]，结构上兼容）。
 */
export interface ExposedTool {
  name: string
  description: string
  /** typebox TSchema 本身就是 JSON Schema 形状 */
  parameters: unknown
  execute: (toolCallId: string, params: never) => Promise<{ content: unknown[]; details?: unknown }>
}

/** 一组工具 = 一个能力档 = 一个端点；name 需满足 mcp-client 的 serverName 约束 */
export interface EaaMcpProfile {
  name: string
  tools: readonly ExposedTool[]
}

export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** dsh 侧 MCP 客户端带自己支持的版本来协商 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_NAME = 'education-advisor-eaa'
const SERVER_VERSION = '1.0.0'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const PATH_PREFIX = '/mcp/'

interface JsonRpcMessage {
  jsonrpc?: '2.0'
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

export interface EaaMcpEndpoint {
  url: string
  token: string
  toolCount: number
}

export interface EaaMcpServerHandle {
  port: number
  /** key = profile.name；随 register/unregister 增删 */
  endpoints: Record<string, EaaMcpEndpoint>
  /** 已监听后追加一组工具 = 新端点 + 新 token；name 非法或重复即抛 */
  register: (profile: EaaMcpProfile) => EaaMcpEndpoint
  /** 撤掉端点：路径立刻 404，旧 token 不再被接受 */
  unregister: (name: string) => void
  close: () => Promise<void>
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        rejectBody(err instanceof Error ? err : new Error(String(err)))
      }
    })
    req.on('error', rejectBody)
  })
}

/** 定长比较，避免通过响应时间猜 token */
function tokenEquals(expected: string, given: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  // 长度不等直接返回：长度本身不是秘密，而 timingSafeEqual 要求等长
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function callTool(
  tools: readonly ExposedTool[],
  params: Record<string, unknown> | undefined,
  requestId: string | number,
): Promise<JsonRpcResponse> {
  const name = typeof params?.name === 'string' ? params.name : ''
  const tool = tools.find((t) => t.name === name)
  if (!tool) return rpcError(requestId, -32602, `unknown tool: ${name}`)

  try {
    const result = await tool.execute(String(requestId), (params?.arguments ?? {}) as never)
    const payload: Record<string, unknown> = { content: result.content, isError: false }
    // structuredContent 必须 JSON 可序列化；工具私有 details 不一定满足
    if (result.details !== undefined) {
      try {
        payload.structuredContent = JSON.parse(JSON.stringify(result.details))
      } catch {
        /* 不可序列化就只回 content，别让一次成功调用变成协议错误 */
      }
    }
    return { jsonrpc: '2.0', id: requestId, result: payload }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      jsonrpc: '2.0',
      id: requestId,
      result: { content: [{ type: 'text', text: message }], isError: true },
    }
  }
}

async function handleRpc(
  tools: readonly ExposedTool[],
  profileName: string,
  message: JsonRpcMessage,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null
  // 通知（无 id）按协议不回响应
  if (id === null || id === undefined) return null

  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.protocolVersion
      const protocolVersion =
        typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0]
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: `${SERVER_NAME}/${profileName}`, version: SERVER_VERSION },
        },
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters,
          })),
        },
      }
    case 'tools/call':
      return await callTool(tools, message.params, id)
    default:
      return rpcError(id, -32601, `method not found: ${message.method ?? ''}`)
  }
}

function badRequest(res: ServerResponse, init: number, body: string): void {
  res.writeHead(init, { 'content-type': 'application/json' }).end(body)
}

/** 只监听 loopback；port 传 0 由系统分配。每个 profile 一个端点、一个 token */
export async function startEaaMcpServer(opts: {
  profiles?: readonly EaaMcpProfile[]
  port?: number
  /** 测试可固定 token；生产留空按 profile 随机生成 */
  tokens?: Record<string, string>
}): Promise<EaaMcpServerHandle> {
  const host = '127.0.0.1'
  const profiles = opts.profiles ?? []
  const byName = new Map<string, EaaMcpProfile>()
  const tokens = new Map<string, string>()
  const endpoints: Record<string, EaaMcpEndpoint> = {}

  const addProfile = (
    profile: EaaMcpProfile,
    listenPort: number,
    token?: string,
  ): EaaMcpEndpoint => {
    if (!MCP_SERVER_NAME_PATTERN.test(profile.name)) {
      throw new Error(`profile name 不符合 serverName 约束 [A-Za-z0-9_-]{1,32}: ${profile.name}`)
    }
    if (byName.has(profile.name)) throw new Error(`重复的 profile name: ${profile.name}`)
    byName.set(profile.name, profile)
    const value = token ?? randomBytes(24).toString('hex')
    tokens.set(profile.name, value)
    const endpoint: EaaMcpEndpoint = {
      url: `http://${host}:${listenPort}${PATH_PREFIX}${profile.name}`,
      token: value,
      toolCount: profile.tools.length,
    }
    endpoints[profile.name] = endpoint
    return endpoint
  }

  // 名字在监听前逐个校验：一个非法 profile 不该留下没人能连的端口
  const seen = new Set<string>()
  for (const profile of profiles) {
    if (!MCP_SERVER_NAME_PATTERN.test(profile.name)) {
      throw new Error(`profile name 不符合 serverName 约束 [A-Za-z0-9_-]{1,32}: ${profile.name}`)
    }
    if (seen.has(profile.name)) throw new Error(`重复的 profile name: ${profile.name}`)
    seen.add(profile.name)
  }

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const pathname = (req.url ?? '').split('?')[0]
      const profileName = pathname.startsWith(PATH_PREFIX) ? pathname.slice(PATH_PREFIX.length) : ''
      const profile = byName.get(profileName)
      const expectedToken = tokens.get(profileName)
      if (!profile || !expectedToken) {
        badRequest(res, 404, JSON.stringify(rpcError(null, -32601, 'unknown endpoint')))
        return
      }
      if (req.method !== 'POST') {
        // 不做服务端主动推流(GET)，也不支持会话终止(DELETE)
        res.writeHead(405, { allow: 'POST' }).end()
        return
      }
      const auth = req.headers.authorization ?? ''
      if (!tokenEquals(expectedToken, auth.replace(/^Bearer\s+/i, ''))) {
        badRequest(res, 401, JSON.stringify(rpcError(null, -32000, 'unauthorized')))
        return
      }

      let body: unknown
      try {
        body = await readJsonBody(req)
      } catch {
        badRequest(res, 400, JSON.stringify(rpcError(null, -32700, 'parse error')))
        return
      }

      const isBatch = Array.isArray(body)
      const messages = (isBatch ? body : [body]) as JsonRpcMessage[]
      const responses = (
        await Promise.all(messages.map((m) => handleRpc(profile.tools, profileName, m)))
      ).filter((r): r is JsonRpcResponse => r !== null)

      if (!responses.length) {
        res.writeHead(202).end()
        return
      }
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(isBatch ? responses : responses[0]))
    })()
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(opts.port ?? 0, host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  for (const profile of profiles) {
    addProfile(profile, port, opts.tokens?.[profile.name])
  }

  return {
    port,
    endpoints,
    register: (profile) => addProfile(profile, port),
    unregister: (name) => {
      byName.delete(name)
      tokens.delete(name)
      delete endpoints[name]
    },
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()))
      }),
  }
}
