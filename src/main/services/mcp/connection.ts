// =============================================================
// MCP — 单连接生命周期: 传输建立(stdio/sse/websocket) + initialize 握手 + 断开清理
// 从 mcp-client-pool.ts 拆出。逻辑零修改(逐行对照搬迁)。
// 原私有方法改为模块函数,首参 client 显式传入。
// 历史修复标记全部保留: R4-SSRF-1(URL 校验)、R5-1/泄漏#1(timer 清理)、
// R52(spawn env)、R4-MAP-LEAK-3/R1-10/B10(kill timer)。
// =============================================================

import { spawn } from 'node:child_process'
import type { McpServerConfig } from '@shared/types'
import { handleJsonRpcMessage, sendJsonRpc, sendNotification } from './protocol'
import { buildSpawnEnv, resolveSpawnCommand } from './spawn-env'
import { assertSafeMcpUrl, CONNECT_TIMEOUT_MS, type MCPClient } from './types'

/**
 * 根据传输方式连接
 */
export async function connectTransport(client: MCPClient, server: McpServerConfig): Promise<void> {
  // R4-SSRF-1 修复: sse/websocket 连接前校验 URL,拒绝内网/云元数据地址
  if (server.transport === 'sse' || server.transport === 'websocket') {
    assertSafeMcpUrl(server.url, server.id)
  }
  const connectPromise = (() => {
    switch (server.transport) {
      case 'stdio':
        return connectStdio(client, server)
      case 'sse':
        return connectSse(client, server)
      case 'websocket':
        return connectWebSocket(client, server)
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
function connectStdio(client: MCPClient, server: McpServerConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.command) {
      reject(new Error(`stdio server ${server.id} missing command`))
      return
    }
    // R52 修复: sidecar 的 PATH 不含用户系统的 npm/npx 路径,
    // 导致 spawn npx 报 ENOENT。用 buildSpawnEnv 合并常见 Node.js 安装路径,
    // 用 resolveSpawnCommand 在 Windows 上解析 npx → npx.cmd / npx.ps1。
    const env = buildSpawnEnv(server.env)
    const resolvedCommand = resolveSpawnCommand(server.command, env)
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
      console.warn(`[McpService] stdio server ${server.id} exited (code=${code}, signal=${signal})`)
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
        if (line) handleJsonRpcMessage(client, line)
        newlineIdx = client.buffer.indexOf('\n')
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim()
      if (text) console.warn(`[McpService] stdio ${server.id} stderr: ${text}`)
    })

    // 发送 initialize 请求
    sendJsonRpc(client, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'education-advisor', version: '1.0.0' },
    })
      .then(() => {
        // 发送 initialized 通知
        sendNotification(client, 'notifications/initialized', {})
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
async function connectSse(client: MCPClient, server: McpServerConfig): Promise<void> {
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
    throw new Error(`SSE server ${server.id} responded ${response.status}: ${response.statusText}`)
  }

  // 存储连接信息(SSE 使用 fetch 发送每个请求)
  client.lastError = undefined
}

/**
 * WebSocket 传输:使用 ws 库
 */
function connectWebSocket(client: MCPClient, server: McpServerConfig): Promise<void> {
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
          sendJsonRpc(client, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'education-advisor', version: '1.0.0' },
          })
            .then(() => {
              sendNotification(client, 'notifications/initialized', {})
              resolve()
            })
            .catch(reject)
        })

        ws.on('message', (...args: unknown[]) => {
          const raw = args[0] as Buffer
          const text = raw.toString('utf-8').trim()
          if (text) handleJsonRpcMessage(client, text)
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
 * 断开单个 client
 */
export async function disconnectClient(client: MCPClient): Promise<void> {
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
