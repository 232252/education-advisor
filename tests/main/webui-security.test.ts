import { describe, expect, it } from 'vitest'
import {
  expandIpv6,
  generateAccessToken,
  isLoopbackAddress,
  isPrivateOrLoopbackAddress,
  isUsableAccessToken,
  ipv6Prefix64,
  listenHost,
  remoteAllowed,
  tokenBits,
  tokensMatch,
} from '../../src/main/services/webui/security'

describe('webui security', () => {
  it('生成 256-bit 令牌且定长比较', () => {
    const token = generateAccessToken()
    expect(isUsableAccessToken(token)).toBe(true)
    expect(tokenBits(token)).toBe(256)
    expect(tokensMatch(token, token)).toBe(true)
    expect(tokensMatch(token, `${token}x`)).toBe(false)
    expect(tokensMatch('', token)).toBe(false)
  })

  it('私网 / 回环判定', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isPrivateOrLoopbackAddress('192.168.1.8')).toBe(true)
    expect(isPrivateOrLoopbackAddress('10.0.0.2')).toBe(true)
    expect(isPrivateOrLoopbackAddress('172.16.0.1')).toBe(true)
    expect(isPrivateOrLoopbackAddress('100.64.0.1')).toBe(true)
    expect(isPrivateOrLoopbackAddress('8.8.8.8')).toBe(false)
    expect(isPrivateOrLoopbackAddress('fd12:3456:789a::1')).toBe(true)
    expect(isPrivateOrLoopbackAddress('fe80::1')).toBe(true)
    expect(isPrivateOrLoopbackAddress('2001:4860:4860::8888')).toBe(false)
  })

  it('IPv6 /64 前缀展开', () => {
    expect(expandIpv6('2001:db8:1:2::3')).toBe('2001:0db8:0001:0002:0000:0000:0000:0003')
    expect(ipv6Prefix64('2001:db8:1:2::3')).toBe('2001:0db8:0001:0002')
  })

  it('lan 绑定拒绝公网，放行同 /64', () => {
    const prefixes = ['2001:0db8:0001:0002']
    expect(remoteAllowed('8.8.8.8', 'lan', prefixes)).toBe(false)
    expect(remoteAllowed('192.168.1.20', 'lan', prefixes)).toBe(true)
    expect(remoteAllowed('2001:db8:1:2::9', 'lan', prefixes)).toBe(true)
    expect(remoteAllowed('2001:db8:ffff::1', 'lan', prefixes)).toBe(false)
    expect(remoteAllowed('8.8.8.8', 'all', prefixes)).toBe(true)
    expect(remoteAllowed('192.168.1.20', 'loopback', prefixes)).toBe(false)
    expect(remoteAllowed('127.0.0.1', 'loopback', prefixes)).toBe(true)
  })

  it('listenHost 随绑定与 IPv6 变化', () => {
    expect(listenHost('loopback', false)).toBe('127.0.0.1')
    expect(listenHost('loopback', true)).toBe('127.0.0.1 / ::1')
    expect(listenHost('lan', true)).toBe('::')
    expect(listenHost('lan', false)).toBe('0.0.0.0')
  })
})
