// =============================================================
// mcp-helpers — 从 mcp-service.ts 提取的纯函数
//
// MCP client 管理器中存在大量网络/进程副作用(stdio spawn、SSE、
// WebSocket),难以单元测试。这里抽出三类无副作用的纯逻辑:
//   1. 环境变量插值 (${VAR} 替换)
//   2. 配置完整性校验 (9 条件 type guard)
//   3. 深度对象遍历
//
// 这些是 config/mcp.yaml 加载链路上的关键纯函数,出 bug 会静默
// 导致所有 MCP server 连接失败,因此值得单独测试覆盖。
// =============================================================

import type { McpServerConfig } from '../../shared/types'

/**
 * 环境变量插值: ${VAR} 或 ${env.VAR} → process.env[VAR]
 * 未定义的环境变量替换为空字符串。
 * 支持两种写法以兼容 mcp.yaml 文档约定与预设模板:
 *   ${USERPROFILE}     → process.env.USERPROFILE
 *   ${env.USERPROFILE} → process.env.USERPROFILE (剥离 env. 前缀)
 * @example interpolateEnv('${env.USERPROFILE}/Documents') → 'C:\\Users\\sq\\Documents'
 * @example interpolateEnv('http://${HOST}') → 'http://example.com'(当 HOST=example.com)
 */
export function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, rawName: string) => {
    // 剥离可选的 env. 前缀(预设模板 mcp-presets.ts 使用 ${env.VAR} 写法)
    const name = rawName.startsWith('env.') ? rawName.slice(4) : rawName
    return process.env[name] ?? ''
  })
}

/**
 * 危险的原型污染 key(在对象展开/重建时过滤,防止 __proto__/constructor 污染)。
 * R1-5 修复: deepInterpolate 与 mcp-service 的 spread 合并都会复制 enumerable own
 * 属性,若配置含 __proto__/constructor 字段会污染运行时对象。这里统一过滤。
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * 深度插值:递归处理对象/数组中的所有字符串值。
 * 非字符串原样返回。同时过滤原型污染 key(__proto__/constructor/prototype)。
 */
export function deepInterpolate<T>(obj: T): T {
  if (typeof obj === 'string') return interpolateEnv(obj) as unknown as T
  if (Array.isArray(obj)) return obj.map(deepInterpolate) as unknown as T
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      // 跳过原型污染 key,防止 mcp.user.yaml 注入 __proto__ 等
      if (FORBIDDEN_KEYS.has(key)) continue
      result[key] = deepInterpolate(value)
    }
    return result as unknown as T
  }
  return obj
}

/**
 * 过滤对象中的原型污染 key,返回安全副本(浅拷贝)。
 * 用于 mcp-service add/update 合并前对 patch/config 做净化,
 * 防止 IPC 传入的 __proto__/constructor 字段经 spread 污染运行时对象。
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    result[key] = value
  }
  return result as T
}

/**
 * 校验 server 配置完整性(9 条件 type guard)。
 *
 * 这是从 mcp.yaml 加载到 connectTransport 之间的唯一类型安全屏障——
 * 任何一条失败都意味着配置不完整,connectTransport 会在运行时崩溃。
 *
 * 规则:
 *   - 必须是非空对象
 *   - id 必须是非空字符串
 *   - name 必须是字符串
 *   - enabled 必须是 boolean
 *   - transport 必须是 'stdio' | 'sse' | 'websocket' 之一
 *   - stdio 传输必须有 command
 *   - sse/websocket 传输必须有 url
 */
export function validateServerConfig(server: unknown): server is McpServerConfig {
  if (!server || typeof server !== 'object') return false
  const s = server as Record<string, unknown>
  if (typeof s.id !== 'string' || s.id.length === 0) return false
  // R5-ERR-4 修复: id 长度上限,与 mcp-handlers.ts 的 validateServerId 一致
  if (s.id.length > 128) return false
  // R15-2 修复: id 拒 null byte（防注入到下游 YAML 解析 / 文件名）
  if (s.id.includes('\0')) return false
  if (typeof s.name !== 'string') return false
  // R15-2: name 拒 null byte
  if (s.name.includes('\0')) return false
  if (typeof s.enabled !== 'boolean') return false
  const transport = s.transport
  if (transport !== 'stdio' && transport !== 'sse' && transport !== 'websocket') return false
  // stdio 需要 command
  if (transport === 'stdio' && typeof s.command !== 'string') return false
  // R15-2: command 拒 null byte（防 stdio spawn 命令注入）
  if (transport === 'stdio' && typeof s.command === 'string' && s.command.includes('\0'))
    return false
  // R15-2: args 数组每项拒 null byte
  if (Array.isArray(s.args)) {
    for (const a of s.args) {
      if (typeof a === 'string' && a.includes('\0')) return false
    }
  }
  // sse/websocket 需要 url 且非空(拒空字符串/纯空白)
  // R5-ERR-3 修复: typeof 'string' 接受空串,要求 trim 后非空
  if (
    (transport === 'sse' || transport === 'websocket') &&
    (typeof s.url !== 'string' || s.url.trim().length === 0)
  ) {
    return false
  }
  return true
}

/** 危险 shell 元字符黑名单(用于校验 stdio server 的 command 字段,防注入) */
const SHELL_METACHAR_RE = /[;&|`$<>]/

/**
 * 校验命令安全性(防 shell 注入)。
 * 规则:
 *   - 必须是非空字符串(trim 后非空)
 *   - 长度 ≤ 512
 *   - 不含危险元字符: ; & | ` $ < >
 *   - 不含 $(...) 或 ${...} 命令替换
 * 注意:Windows 路径分隔符 \ 和盘符 C: 允许。
 */
export function validateCommandSafe(command: unknown): boolean {
  if (typeof command !== 'string') return false
  const trimmed = command.trim()
  if (trimmed.length === 0 || trimmed.length > 512) return false
  if (SHELL_METACHAR_RE.test(trimmed)) return false
  // 拒绝命令替换 $(...) 和 ${...}(但允许环境变量引用在 args/env 中,这里只管 command 本身)
  if (/\$\(|\$\{/.test(trimmed)) return false
  return true
}

/**
 * SSRF 防护:校验 MCP sse/websocket 的 URL 是否指向内网/敏感地址。
 * 返回 true = 安全(可连),false = 危险(应拒绝)。
 *
 * 拒绝:私有 IP 段(10/172.16-31/192.168)、loopback(127,但 localhost 域名放行)、
 *      link-local(169.254,云元数据)、IPv6 unique-local(fc/fd)、0.0.0.0、多播/保留段(224+)。
 * 允许:公网域名、localhost 字符串、公网 IP。
 *
 * R4-SSRF-1 修复:防止 sidecar 被诱导连接云元数据服务或扫描内网。
 */
export function isSafeMcpUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  // 只允许 http/https/ws/wss 协议
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return false
  const host = parsed.hostname.toLowerCase()
  // IPv6 在 URL 里带方括号(如 [::1]),new URL().hostname 保留 bracket,这里去掉便于判断
  const hostNoBracket = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  // 显式允许 localhost(本地开发 MCP server 常用)
  if (host === 'localhost') return true
  // R1-4 修复: 拦截短格式/十进制 IP 形式的危险地址
  //   - 纯数字主机(如 "0", "0x7f000001", "2130706433")多数系统会当 IP 解析,
  //     可能绕过下面的 4 段 IPv4 正则,直接拒绝。
  //   - "0" / "0.0.0.0" / "[::]" 等绑定所有接口的地址拒绝。
  if (/^\d+$/.test(host)) return false
  // IPv4 解析
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])]
    if (
      a === 10 || // 10.0.0.0/8 私有
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 私有
      (a === 192 && b === 168) || // 192.168.0.0/16 私有
      a === 127 || // 127.0.0.0/8 loopback(IP 形式,localhost 域名已放行)
      (a === 169 && b === 254) || // 169.254.0.0/16 link-local(含 AWS/Azure 元数据)
      a === 0 || // 0.0.0.0/8
      a >= 224 // 224+ 多播/保留
    ) {
      return false
    }
    return true
  }
  // IPv6 loopback / unique-local
  if (hostNoBracket === '::1') return false
  if (/^f[cd][0-9a-f]{2}(?::|$)/.test(hostNoBracket)) return false // fc00::/7 unique-local
  // 公网域名放行
  return true
}
