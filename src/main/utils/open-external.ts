// =============================================================
// openExternalUrl — 外链打开白名单(https/mailto 放行,其余拒绝)
// 渲染层任意 href 经 setWindowOpenHandler 到达这里;不带白名单直开
// 会把 file://、javascript:、smb:// 等交给系统处理(协议 handler 攻击面)
// =============================================================

import { shell } from 'electron'

const EXTERNAL_PROTOCOL_ALLOW = new Set(['https:', 'mailto:'])

/** 白名单内放行系统打开;白名单外/非法 URL 静默拒绝(调用点无需 try) */
export async function openExternalUrl(url: string): Promise<void> {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return
  }
  if (!EXTERNAL_PROTOCOL_ALLOW.has(protocol)) return
  await shell.openExternal(url)
}
