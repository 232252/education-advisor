import type { WebUiStatus } from '@shared/types'

/**
 * 手机扫码用局域网地址。只在本机监听时返回空，避免扫出来打不开。
 */
export function webUiPhoneUrl(
  status: Pick<WebUiStatus, 'listening' | 'urls' | 'lanIpv4'> | null,
): string | null {
  if (!status?.listening || status.urls.length === 0) return null
  const lan = status.lanIpv4[0]
  if (!lan) return null
  return status.urls.find((url) => url.includes(lan)) ?? null
}
