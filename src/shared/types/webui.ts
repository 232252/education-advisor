// =============================================================
// WebUI 状态 — 设置页 / sys:webui-status 共用
// =============================================================

export type WebUiMode = 'off' | 'always' | 'scheduled'
export type WebUiProtocol = 'http' | 'https'
export type WebUiBind = 'loopback' | 'lan' | 'all'

export interface WebUiStatus {
  mode: WebUiMode
  listening: boolean
  protocol: WebUiProtocol
  bind: WebUiBind
  listenHost: string
  ipv6: boolean
  port: number
  /** 含令牌的可打开地址(本机教师复制用) */
  urls: string[]
  lanIpv4: string[]
  lanIpv6: string[]
  inSchedule: boolean
  fingerprintSha256: string | null
  usingCustomCert: boolean
  /** 访问令牌熵（bit），256 为默认 */
  tokenBits: number
  /** 持久访问令牌（仅本机设置页展示） */
  accessToken: string
  error: string | null
}
