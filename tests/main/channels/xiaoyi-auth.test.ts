import { describe, expect, it } from 'vitest'
import {
  generateAuthHeaders,
  generateSignature,
} from '../../../src/main/services/channels/adapters/xiaoyi/auth'

describe('xiaoyi auth', () => {
  it('signature is base64 HMAC', () => {
    const sig = generateSignature('sk', '1710000000000')
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(Buffer.from(sig, 'base64').length).toBe(32)
  })

  it('headers include ak/sign/ts/agent', () => {
    const h = generateAuthHeaders('ak', 'sk', 'agent-1', 1710000000000)
    expect(h['x-access-key']).toBe('ak')
    expect(h['x-agent-id']).toBe('agent-1')
    expect(h['x-ts']).toBe('1710000000000')
    expect(h['x-sign']).toBe(generateSignature('sk', '1710000000000'))
  })
})
