// =============================================================
// MCP 连接池 — 客户端连接管理/传输(stdio/sse/ws)/JSON-RPC 协议
// 从 mcp-service.ts 抽出。逻辑零修改(逐行对照搬迁)。
//
// 职责边界:
//   - 管理 clients Map<serverId, MCPClient> + connecting 互斥锁
//   - ensureConnected/disconnectAll 等连接生命周期
//   - connectStdio/connectSse/connectWebSocket 三种传输
//   - sendJsonRpc/handleJsonRpcMessage/requestListTools/callToolInternal 协议
//   - buildSpawnEnv/resolveSpawnCommand spawn 辅助
//   - 不碰配置(那是 McpConfigStore 的职责)
//
// 历史修复标记全部保留: R1-3/B1(互斥锁)、R5-1/泄漏#2(失败清理)、
// 泄漏#3(disconnectAll)、R4-SSRF-1(URL 校验)。
// =============================================================

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { McpServerConfig, McpTool } from '../../shared/types'
import {
  assertSafeMcpUrl,
  CALL_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  MAX_RESPONSE_SIZE,
  type MCPClient,
  type McpCallResult,
} from './mcp-types'

export class McpClientPool {
  private clients: Map<string, MCPClient> = new Map()
  /**
   * 每个 serverId 的"正在连接"互斥锁(R1-3 / B1 修复)。
   * 并发 ensureConnected 同一 server 时,后续调用方复用同一个进行中的连接 Promise,
   * 避免产生重复子进程 / 孤儿进程。
   */
  private connecting: Map<string, Promise<MCPClient>> = new Map()

  /** 暴露 clients 给协调器(listServers 读连接状态) */
  get clientsMap(): ReadonlyMap<string, MCPClient> {
    return this.clients
  }

  /** 暴露 connecting 给协调器(update/remove/reload 需清理锁) */
  get connectingMap(): ReadonlyMap<string, Promise<MCPClient>> {
    return this.connecting
  }

  /**
   * 从 clients map 移除指定 server 的条目(供协调器 update/remove/disconnect 后清理)。
   * 仅删 map 条目,不断开连接(断开用 disconnectClient)。clientsMap 是只读视图,
   * 协调器不能直接 delete,必须走此方法。
   */
  deleteClientEntry(serverId: string): void {
    this.clients.delete(serverId)
  }

  /**
   * 清理所有进行中的连接锁(供 reloadConfig/destroy 调用)。
   * R5-1 / 泄漏 #3 修复:避免 inflight doConnect 在 disconnectAll 后又把
   * stale client 插回 this.clients(用旧 config)。
   */
  clearConnectingLocks(): void {
    this.connecting.clear()
  }

  /**
   * 确保 server 已连接(惰性连接)。
   *
   * R1-3 / B1 修复: 用 per-serverId 互斥锁串行化连接。
   * 并发调用同一 server 时,第二个调用方会 await 同一个进行中的连接 Promise,
   * 而不是各自走 check→disconnect→connect 流程(否则会产生重复子进程、孤儿进程)。
   */
  async ensureConnected(server: McpServerConfig): Promise<MCPClient> {
    // 已连接:直接复用
    const existing = this.clients.get(server.id)
    if (existing?.connected) return existing

    // 已有进行中的连接:复用同一 Promise(关键: 防并发重复 spawn)
    const inflight = this.connecting.get(server.id)
    if (inflight) return inflight

    // 发起新连接,把 Promise 缓存,无论成功失败都清理
    const p = this.doConnect(server).finally(() => {
      this.connecting.delete(server.id)
    })
    this.connecting.set(server.id, p)
    return p
  }

  /** ensureConnected 的实际连接实现(由 ensureConnected 保证单线程进入) */
  private async doConnect(server: McpServerConfig): Promise<MCPClient> {
    const existing = this.clients.get(server.id)
    if (existing?.connected) return existing
    if (existing) await this.disconnectClient(existing)

    const client: MCPClient = {
      serverId: server.id,
      config: server,
      connected: false,
      tools: [],
      requestId: 1,
      pending: new Map(),
    }

    // R5-1 / 泄漏 #2 修复: connectTransport 可能在 spawn/ws.open 之后再失败
    // (initialize 握手超时/错误/transport closed)。此时 client.childProcess/ws 已存在,
    // 但 client 还没进 this.clients,disconnectAll 看不到 → 子进程/ws 泄漏。
    // 这里用 try/catch 包裹,失败时主动 disconnectClient 清理已持有的 transport 资源。
    try {
      await this.connectTransport(client, server)
    } catch (err) {
      // 清理已 spawn 的子进程 / 已打开的 ws,避免泄漏
      try {
        await this.disconnectClient(client)
      } catch {
        // 清理失败不掩盖原始连接错误
      }
      throw err
    }
    this.clients.set(server.id, client)

    // 连接成功后列出工具
    try {
      const tools = await this.requestListTools(client)
      client.tools = tools
      console.log(`[McpService] Server ${server.id} connected, ${tools.length} tools available`)
    } catch (err) {
      console.warn(`[McpService] Server ${server.id} connected but listTools failed:`, err)
      client.lastError = `listTools failed: ${(err as Error).message}`
    }

    return client
  }

  /**
   * 根据传输方式连接
   */
  private async connectTransport(client: MCPClient, server: McpServerConfig): Promise<void> {
    // R4-SSRF-1 修复: sse/websocket 连接前校验 URL,拒绝内网/云元数据地址
    if (server.transport === 'sse' || server.transport === 'websocket') {
      assertSafeMcpUrl(server.url, server.id)
    }
    const connectPromise = (() => {
      switch (server.transport) {
        case 'stdio':
          return this.connectStdio(client, server)
        case 'sse':
          return this.connectSse(client, server)
        case 'websocket':
          return this.connectWebSocket(client, server)
        default:
          return Promise.reject(new Error(`Unsupported transport: ${server.transport}`))
      }
    })()

    // 连接超时。
    // R5-1 / 泄漏 #1 修复: 成功连接后主动 clearTimeout,避免 timer 持有 reject 闭包
    // 长达 CONNECT_TIMEOUT_MS(此前每次成功 connect 都会泄漏一个 30s timer)。
    let connectTimer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        connectPromise,
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(
            () => reject(new Error(`Connect timeout after ${CONNECT_TIMEOUT_MS}ms`)),
            CONNECT_TIMEOUT_MS,
          )
        }),
      ])
    } finally {
      if (connectTimer) clearTimeout(connectTimer)
    }

    client.connected = true
  }

  /**
   * stdio 传输:spawn 子进程 + stdin/stdout JSON-RPC
   */
  private connectStdio(client: MCPClient, server: McpServerConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!server.command) {
        reject(new Error(`stdio server ${server.id} missing command`))
        return
      }
      // R52 修复: sidecar 的 PATH 不含用户系统的 npm/npx 路径,
      // 导致 spawn npx 报 ENOENT。用 buildSpawnEnv 合并常见 Node.js 安装路径,
      // 用 resolveSpawnCommand 在 Windows 上解析 npx → npx.cmd / npx.ps1。
      const env = this.buildSpawnEnv(server.env)
      const resolvedCommand = this.resolveSpawnCommand(server.command, env)
      const child = spawn(resolvedCommand, server.args || [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      client.childProcess = child
      client.buffer = ''

      child.on('error', (err) => {
        client.lastError = `spawn error: ${err.message}`
        reject(err)
      })

      child.on('exit', (code, signal) => {
        if (!client.connected) {
          reject(new Error(`stdio server exited before connect (code=${code}, signal=${signal})`))
          return
        }
        console.warn(
          `[McpService] stdio server ${server.id} exited (code=${code}, signal=${signal})`,
        )
        client.connected = false
        // 拒绝所有待响应请求
        for (const [, entry] of client.pending) {
          clearTimeout(entry.timer)
          entry.reject(new Error(`Server exited (code=${code})`))
        }
        client.pending.clear()
      })

      child.stdout?.on('data', (chunk: Buffer) => {
        if (!client.buffer) client.buffer = ''
        client.buffer += chunk.toString('utf-8')
        // 按行解析 JSON-RPC
        let newlineIdx = client.buffer.indexOf('\n')
        while (newlineIdx >= 0) {
          const line = client.buffer.slice(0, newlineIdx).trim()
          client.buffer = client.buffer.slice(newlineIdx + 1)
          if (line) this.handleJsonRpcMessage(client, line)
          newlineIdx = client.buffer.indexOf('\n')
        }
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim()
        if (text) console.warn(`[McpService] stdio ${server.id} stderr: ${text}`)
      })

      // 发送 initialize 请求
      this.sendJsonRpc(client, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'education-advisor', version: '1.0.0' },
      })
        .then(() => {
          // 发送 initialized 通知
          this.sendNotification(client, 'notifications/initialized', {})
          resolve()
        })
        .catch(reject)
    })
  }

  /**
   * SSE 传输:使用 HTTP POST 发送请求
   * 注意:完整 SSE 传输需要 EventSource 接收 server 推送
   * 这里实现简化版:POST 请求/响应模式(适用于大多数 MCP SSE server)
   */
  private async connectSse(client: MCPClient, server: McpServerConfig): Promise<void> {
    if (!server.url) throw new Error(`sse server ${server.id} missing url`)

    // 验证 URL 可达性(发送 initialize 请求)
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...server.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: client.requestId++,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'education-advisor', version: '1.0.0' },
        },
      }),
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(
        `SSE server ${server.id} responded ${response.status}: ${response.statusText}`,
      )
    }

    // 存储连接信息(SSE 使用 fetch 发送每个请求)
    client.lastError = undefined
  }

  /**
   * WebSocket 传输:使用 ws 库
   */
  private connectWebSocket(client: MCPClient, server: McpServerConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      void (async () => {
        if (!server.url) {
          reject(new Error(`websocket server ${server.id} missing url`))
          return
        }
        try {
          const { default: WebSocket } = await import('ws')
          const ws = new WebSocket(server.url, { headers: server.headers })
          client.ws = ws

          const timeout = setTimeout(() => {
            reject(new Error(`WebSocket connect timeout after ${CONNECT_TIMEOUT_MS}ms`))
            ws.close()
          }, CONNECT_TIMEOUT_MS)

          ws.on('open', () => {
            clearTimeout(timeout)
            // 发送 initialize 请求
            this.sendJsonRpc(client, 'initialize', {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'education-advisor', version: '1.0.0' },
            })
              .then(() => {
                this.sendNotification(client, 'notifications/initialized', {})
                resolve()
              })
              .catch(reject)
          })

          ws.on('message', (...args: unknown[]) => {
            const raw = args[0] as Buffer
            const text = raw.toString('utf-8').trim()
            if (text) this.handleJsonRpcMessage(client, text)
          })

          ws.on('error', (...args: unknown[]) => {
            const err = args[0] as Error
            clearTimeout(timeout)
            client.lastError = `ws error: ${err.message}`
            if (!client.connected) reject(err)
            else {
              client.connected = false
              // 拒绝所有待响应请求
              for (const [, entry] of client.pending) {
                clearTimeout(entry.timer)
                entry.reject(new Error(`WebSocket error: ${err.message}`))
              }
              client.pending.clear()
            }
          })

          ws.on('close', () => {
            console.warn(`[McpService] websocket server ${server.id} closed`)
            client.connected = false
            for (const [, entry] of client.pending) {
              clearTimeout(entry.timer)
              entry.reject(new Error('WebSocket closed'))
            }
            client.pending.clear()
          })
        } catch (err) {
          reject(err)
        }
      })()
    })
  }

  /**
   * 发送 JSON-RPC 请求(stdio/websocket)
   */
  private sendJsonRpc(client: MCPClient, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = client.requestId++
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })

      const timer = setTimeout(() => {
        client.pending.delete(id)
        reject(new Error(`Request ${method} timeout after ${CALL_TIMEOUT_MS}ms`))
      }, CALL_TIMEOUT_MS)

      client.pending.set(id, { resolve, reject, timer })

      if (client.childProcess?.stdin?.writable) {
        client.childProcess.stdin.write(`${message}\n`)
      } else if (client.ws?.readyState === 1 /* OPEN */) {
        client.ws.send(message)
      } else {
        clearTimeout(timer)
        client.pending.delete(id)
        reject(new Error(`Server ${client.serverId} not writable (transport closed)`))
      }
    })
  }

  /**
   * 发送 JSON-RPC 通知(无 id,无响应)
   */
  private sendNotification(client: MCPClient, method: string, params: unknown): void {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params })
    if (client.childProcess?.stdin?.writable) {
      client.childProcess.stdin.write(`${message}\n`)
    } else if (client.ws?.readyState === 1) {
      client.ws.send(message)
    }
  }

  /**
   * 处理 JSON-RPC 响应消息
   */
  private handleJsonRpcMessage(client: MCPClient, raw: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      console.warn(`[McpService] Invalid JSON from server ${client.serverId}: ${raw.slice(0, 200)}`)
      return
    }

    const m = msg as { id?: number; result?: unknown; error?: { message: string }; method?: string }
    // 响应(有 id)
    if (m.id !== undefined && client.pending.has(m.id)) {
      const entry = client.pending.get(m.id)
      if (!entry) return
      client.pending.delete(m.id)
      clearTimeout(entry.timer)
      if (m.error) {
        entry.reject(new Error(m.error.message || 'JSON-RPC error'))
      } else {
        entry.resolve(m.result)
      }
    }
    // 通知/请求(无 id 或有 method)— 当前不处理 server→client 请求
  }

  /**
   * 请求工具列表。
   *
   * R1-2 / B3 修复: SSE 传输没有 stdin/ws 通道,sendJsonRpc 对 SSE 会直接 reject
   * "transport closed",导致 SSE server 静默显示"已连接 0 工具"。
   * 这里对 SSE 单独走 HTTP POST(与 callToolSse 同一通道)。
   */
  async requestListTools(client: MCPClient): Promise<McpTool[]> {
    const result = await this.requestListToolsInternal(client)
    const typed = result as {
      tools?: Array<{ name: string; description?: string; inputSchema?: object }>
    }
    if (!typed?.tools) return []
    return typed.tools.map((t) => ({
      serverId: client.serverId,
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {},
    }))
  }

  /** requestListTools 的分派实现: SSE 走 HTTP,stdio/websocket 走 JSON-RPC */
  private async requestListToolsInternal(client: MCPClient): Promise<unknown> {
    if (client.config.transport === 'sse') {
      return this.requestSse(client, 'tools/list', {})
    }
    return this.sendJsonRpc(client, 'tools/list', {})
  }

  /**
   * SSE 通用 JSON-RPC 请求(HTTP POST)。
   * R1-2 / B3: 让 listTools 与 callTool 共用同一 SSE 通道。
   */
  private async requestSse(client: MCPClient, method: string, params: unknown): Promise<unknown> {
    if (!client.config.url) {
      throw new Error(`sse server ${client.serverId} missing url`)
    }
    const response = await fetch(client.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...client.config.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: client.requestId++,
        method,
        params,
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`SSE ${method} failed: ${response.status} ${response.statusText}`)
    }
    const msg = (await response.json()) as { result?: unknown; error?: { message: string } }
    if (msg.error) throw new Error(msg.error.message)
    return msg.result
  }

  /**
   * 内部工具调用实现
   */
  async callToolInternal(
    client: MCPClient,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    // SSE 传输使用 HTTP POST
    if (client.config.transport === 'sse') {
      return this.callToolSse(client, toolName, args)
    }

    // stdio / websocket 使用 JSON-RPC
    const result = (await this.sendJsonRpc(client, 'tools/call', {
      name: toolName,
      arguments: args,
    })) as McpCallResult | undefined

    if (!result) {
      return { content: [{ type: 'text', text: '(empty result)' }] }
    }

    // 大小限制
    const resultStr = JSON.stringify(result)
    if (resultStr.length > MAX_RESPONSE_SIZE) {
      return {
        content: [
          {
            type: 'text',
            text: `响应过大 (${(resultStr.length / 1024 / 1024).toFixed(1)} MB),超过 ${MAX_RESPONSE_SIZE / 1024 / 1024} MB 上限`,
          },
        ],
        isError: true,
      }
    }

    return result
  }

  /**
   * SSE 工具调用(HTTP POST)
   */
  private async callToolSse(
    client: MCPClient,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    if (!client.config.url) {
      throw new Error(`sse server ${client.serverId} missing url`)
    }
    const response = await fetch(client.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...client.config.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: client.requestId++,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`SSE callTool ${toolName} failed: ${response.status}`)
    }

    const msg = (await response.json()) as { result?: McpCallResult; error?: { message: string } }
    if (msg.error) throw new Error(msg.error.message)
    return msg.result || { content: [{ type: 'text', text: '(empty)' }] }
  }

  /**
   * 断开单个 client
   */
  async disconnectClient(client: MCPClient): Promise<void> {
    client.connected = false

    // 清理 pending
    for (const [, entry] of client.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Client disconnected'))
    }
    client.pending.clear()

    // stdio: kill 子进程
    // R4-MAP-LEAK-3 修复: 用局部变量捕获 childProcess,避免 setTimeout 触发时
    // client.childProcess 已被置 undefined 导致可选链 no-op,SIGKILL fallback 永不执行
    const cp = client.childProcess
    if (cp) {
      try {
        cp.kill('SIGTERM')
        // 给 1s 优雅退出,然后 SIGKILL
        const killTimer = setTimeout(() => {
          if (!cp.killed) {
            cp.kill('SIGKILL')
          }
        }, 1000)
        // R1-10 / B10 修复: unref 让该 timer 不阻止进程优雅退出
        // (SIGTERM 成功但子进程不 emit exit 的极端情况下,避免事件循环多挂 1s)
        killTimer.unref?.()
        // 子进程已退出则清理 timer,避免内存泄漏
        cp.once('exit', () => clearTimeout(killTimer))
      } catch {
        // ignore
      }
      client.childProcess = undefined
    }

    // websocket: close
    if (client.ws) {
      try {
        client.ws.close()
      } catch {
        // ignore
      }
      client.ws = undefined
    }
  }

  /**
   * 构建 spawn 子进程的 env,合并常见 Node.js 安装路径到 PATH。
   *
   * R52 修复: sidecar 由 Tauri Rust 启动,用打包的 node.exe,其 PATH 不包含
   * 用户系统的 npm/npx 路径。当 MCP server 配置用 `npx -y @modelcontextprotocol/server-echo`
   * 时,spawn 报 `spawn npx ENOENT`。
   *
   * 策略:在当前 process.env.PATH 基础上追加平台相关的 Node.js 常见安装路径,
   * 仅传给 spawn 的 env,不改全局 process.env.PATH。
   * 合并失败时 graceful:log warn 后返回原始 env,不阻塞 spawn。
   */
  private buildSpawnEnv(serverEnv?: Record<string, string>): Record<string, string> {
    // 从 process.env 浅拷贝(避免全局副作用),再叠加 server 级 env
    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...serverEnv }

    try {
      const extraPaths: string[] = []
      const homeDir = os.homedir()
      const platform = process.platform

      if (platform === 'win32') {
        // Windows 常见 Node.js 路径
        // %APPDATA%\npm — npm 全局安装目录(npx.cmd 通常在此)
        const appData = process.env.APPDATA
        if (appData) extraPaths.push(path.join(appData, 'npm'))
        // %ProgramFiles%\nodejs — Node.js 官方安装目录
        const programFiles = process.env.ProgramFiles
        if (programFiles) extraPaths.push(path.join(programFiles, 'nodejs'))
        const programFilesX86 = process.env['ProgramFiles(x86)']
        if (programFilesX86) extraPaths.push(path.join(programFilesX86, 'nodejs'))
        // scoop 安装:~/scoop/apps/nodejs/current/bin 及 ~/scoop/shims
        extraPaths.push(path.join(homeDir, 'scoop', 'apps', 'nodejs', 'current', 'bin'))
        extraPaths.push(path.join(homeDir, 'scoop', 'apps', 'nodejs', 'current'))
        extraPaths.push(path.join(homeDir, 'scoop', 'shims'))
        // nvm-windows:经常安装在 %APPDATA%\nvm\vXX.XX.X
        if (appData) {
          const nvmDir = path.join(appData, 'nvm')
          try {
            // nvm-windows 的 symlink 指向当前版本,直接加 nvm 目录即可
            if (fs.existsSync(nvmDir)) extraPaths.push(nvmDir)
          } catch {
            /* ignore */
          }
        }
        // Volta:~/AppData/Local/Volta/bin
        const localAppData = process.env.LOCALAPPDATA
        if (localAppData) extraPaths.push(path.join(localAppData, 'Volta', 'bin'))
      } else {
        // macOS / Linux 常见 Node.js 路径
        extraPaths.push('/usr/local/bin')
        extraPaths.push('/opt/homebrew/bin')
        extraPaths.push(path.join(homeDir, '.npm-global', 'bin'))
        // nvm:~/.nvm/versions/node/*/bin(取当前激活版本或最新版本)
        const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node')
        try {
          const versions = fs.readdirSync(nvmDir).sort().reverse()
          if (versions.length > 0) {
            // 取排序后最新版本的 bin 目录
            extraPaths.push(path.join(nvmDir, versions[0], 'bin'))
          }
        } catch {
          /* nvm 目录不存在,忽略 */
        }
        // fnm:~/.local/share/fnm/multishells/*/bin 或 ~/.fnm
        extraPaths.push(path.join(homeDir, '.local', 'share', 'fnm'))
        extraPaths.push(path.join(homeDir, '.fnm'))
        // Volta:~/.volta/bin
        extraPaths.push(path.join(homeDir, '.volta', 'bin'))
      }

      // 过滤掉不存在的路径(减少无效 PATH 条目)
      const validPaths = extraPaths.filter((p) => {
        try {
          return fs.existsSync(p)
        } catch {
          return false
        }
      })

      if (validPaths.length > 0) {
        const pathKey = platform === 'win32' ? 'Path' : 'PATH'
        // Windows env 大小写不敏感,但 process.env 中 key 可能是 'Path' 或 'PATH'
        // 优先用已有 key,不存在则用平台默认
        const existingKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || pathKey
        const existingPath = env[existingKey] || ''
        // 追加新路径(放在末尾,不覆盖系统已有路径)
        const separator = platform === 'win32' ? ';' : ':'
        env[existingKey] = existingPath
          ? existingPath + separator + validPaths.join(separator)
          : validPaths.join(separator)
        console.log(
          `[McpService] buildSpawnEnv: appended ${validPaths.length} PATH entries for spawn`,
        )
      }
    } catch (err) {
      // graceful:合并 PATH 失败不阻塞 spawn,log warn 后继续用原始 env
      console.warn('[McpService] buildSpawnEnv: failed to merge PATH, using original env:', err)
    }

    return env
  }

  /**
   * 解析 spawn 的 command,处理 Windows 上 npx/npm 需要 .cmd/.ps1 后缀的问题。
   *
   * R52 修复: Windows 的 spawn('npx', ...) 报 ENOENT,因为 Windows 上 npx
   * 实际是 npx.cmd 或 npx.ps1(不在 PATHEXT 搜索路径时)。
   * 本方法在 Windows 上对 npx/npm 尝试在 spawnEnv(已含合并后的 PATH)中
   * 找 .cmd/.ps1 后缀的真实可执行路径,
   * 找不到则返回原始 command(保留原 spawn 行为)。
   *
   * @param command 原始 command(如 'npx')
   * @param spawnEnv buildSpawnEnv 构建的 env(已含合并后的 PATH)
   */
  private resolveSpawnCommand(command: string, spawnEnv: Record<string, string>): string {
    // 仅在 Windows 且 command 是裸 npx/npm 时处理
    if (process.platform !== 'win32') return command
    const needsResolve = ['npx', 'npm']
    if (!needsResolve.includes(command.toLowerCase())) return command

    // 从 spawnEnv 中提取 PATH(已经过 buildSpawnEnv 合并)
    const pathKey = Object.keys(spawnEnv).find((k) => k.toLowerCase() === 'path') || 'Path'
    const pathEnv = spawnEnv[pathKey] || ''
    const separator = ';'
    const extensions = ['.cmd', '.ps1']

    // 遍历 PATH 目录寻找 npx.cmd / npm.cmd / npx.ps1 / npm.ps1
    for (const dir of pathEnv.split(separator)) {
      if (!dir) continue
      for (const ext of extensions) {
        const candidate = path.join(dir, `${command}${ext}`)
        try {
          if (fs.existsSync(candidate)) {
            console.log(`[McpService] resolveSpawnCommand: ${command} → ${candidate}`)
            return candidate
          }
        } catch {
          /* ignore */
        }
      }
    }

    // 找不到 .cmd/.ps1,返回原始 command(保留原 spawn 行为,可能仍然 ENOENT)
    console.warn(
      `[McpService] resolveSpawnCommand: could not find ${command}.cmd/.ps1 in PATH, ` +
        `using original command (may still ENOENT)`,
    )
    return command
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises: Promise<void>[] = []
    for (const [, client] of this.clients) {
      disconnectPromises.push(this.disconnectClient(client))
    }
    await Promise.allSettled(disconnectPromises)
    this.clients.clear()
  }
}
