import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { X509Certificate } from 'node:crypto'
import fsp from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), isPackaged: false },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  protocol: { handle: vi.fn() },
}))

import { addWebUiFanoutListener, fanoutWebUi, sendToRenderer } from '../../src/main/ipc/broadcast'
import { handleIpc, invokeRegisteredHandler, createWebInvokeEvent } from '../../src/main/ipc/handle'
import { originAllowed, startWebUiGateway } from '../../src/main/services/webui/gateway'
import { ensureWebUiTls, loadTlsFromFiles } from '../../src/main/services/webui/tls'
import type { GatewayOptions } from '../../src/main/services/webui/gateway'

const tmpDir = path.join(os.tmpdir(), `webui-tls-${Date.now()}`)

beforeAll(async () => {
  await fsp.mkdir(tmpDir, { recursive: true })
  await fsp.writeFile(path.join(tmpDir, 'index.html'), '<!doctype html><title>ok</title>')
})

afterAll(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})

function startGw(tls: ReturnType<typeof ensureWebUiTls>, extra: Partial<GatewayOptions> = {}) {
  return startWebUiGateway({
    port: 0,
    token: 'secret-token',
    protocol: 'https',
    bind: 'lan',
    ipv6: true,
    tls,
    rendererRoot: tmpDir,
    uploadsDir: path.join(tmpDir, 'uploads'),
    ...extra,
  })
}

describe('webui tls / gateway', () => {
  it('ensureWebUiTls 写出可解析的自签证书', () => {
    const tls = ensureWebUiTls(tmpDir)
    expect(tls.cert).toContain('BEGIN CERTIFICATE')
    expect(tls.key).toContain('BEGIN')
    expect(tls.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(new X509Certificate(tls.cert).fingerprint256.replace(/:/g, '').toLowerCase()).toBe(
      tls.fingerprintSha256,
    )
    const loaded = loadTlsFromFiles(`${tmpDir}/key.pem`, `${tmpDir}/cert.pem`)
    expect(loaded?.fingerprintSha256).toBe(tls.fingerprintSha256)
    expect(loadTlsFromFiles('', '')).toBeNull()
  })

  it('loadTlsFromFiles 接受 PKCS#1 PEM 与 DER 证书/私钥', async () => {
    const tls = ensureWebUiTls(tmpDir)
    const pkcs1 = path.join(tmpDir, 'key.pkcs1.pem')
    const derKey = path.join(tmpDir, 'key.der')
    const derCert = path.join(tmpDir, 'cert.der')
    const { createPrivateKey } = await import('node:crypto')
    const pkcs1Pem = createPrivateKey(tls.key).export({ type: 'pkcs1', format: 'pem' }).toString()
    const pkcs8Der = createPrivateKey(tls.key).export({ type: 'pkcs8', format: 'der' }) as Buffer
    await fsp.writeFile(pkcs1, pkcs1Pem)
    await fsp.writeFile(derKey, pkcs8Der)
    await fsp.writeFile(derCert, new X509Certificate(tls.cert).raw)
    expect(loadTlsFromFiles(pkcs1, `${tmpDir}/cert.pem`)?.fingerprintSha256).toBe(tls.fingerprintSha256)
    expect(loadTlsFromFiles(derKey, derCert)?.fingerprintSha256).toBe(tls.fingerprintSha256)
    const bundle = path.join(tmpDir, 'bundle.pem')
    await fsp.writeFile(bundle, `${tls.cert}\n${tls.key}`)
    expect(loadTlsFromFiles(bundle, bundle)?.fingerprintSha256).toBe(tls.fingerprintSha256)
  })

  it('sendToRenderer 扇出到 WebUI 监听器且仍调用 webContents.send', () => {
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } } as never
    const seen: Array<[string, unknown]> = []
    const unsub = addWebUiFanoutListener((ch, payload) => seen.push([ch, payload]))
    sendToRenderer(win, 'agent:status-update', { ok: 1 })
    expect(send).toHaveBeenCalledWith('agent:status-update', { ok: 1 })
    expect(seen).toEqual([['agent:status-update', { ok: 1 }]])
    unsub()
    fanoutWebUi('x', 1)
    expect(seen).toHaveLength(1)
  })

  it('HTTPS 网关：无令牌 GET 401，有令牌 WSS 可调用', async () => {
    const tls = ensureWebUiTls(tmpDir)
    handleIpc('webui:ping', async () => ({ pong: true }))
    const gw = await startGw(tls)
    expect(gw.port).toBeGreaterThan(0)

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port: gw.port,
          path: '/',
          method: 'GET',
          rejectUnauthorized: false,
        },
        (res) => {
          try {
            expect(res.statusCode).toBe(401)
            res.resume()
            resolve()
          } catch (err) {
            reject(err)
          }
        },
      )
      req.on('error', reject)
      req.end()
    })

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`wss://127.0.0.1:${gw.port}/ws`, {
        rejectUnauthorized: false,
      })
      ws.on('open', () => {
        ws.close()
        reject(new Error('should not open without token'))
      })
      ws.on('error', () => resolve())
      ws.on('unexpected-response', () => {
        ws.terminate()
        resolve()
      })
    })

    const event = createWebInvokeEvent(() => {})
    const result = await invokeRegisteredHandler('webui:ping', event, [])
    expect(result).toEqual({ pong: true })

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`wss://127.0.0.1:${gw.port}/ws?k=secret-token`, {
        rejectUnauthorized: false,
      })
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: '1', type: 'invoke', channel: 'webui:ping', args: [] }))
      })
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string; data?: { pong?: boolean } }
        try {
          expect(msg.type).toBe('result')
          expect(msg.data).toEqual({ pong: true })
          ws.close()
          resolve()
        } catch (err) {
          reject(err)
        }
      })
      ws.on('error', reject)
    })

    await gw.close()
  })

  it('明文 HTTP 不能连上 HTTPS 网关；带令牌的 HTTPS GET 可以', async () => {
    const tls = ensureWebUiTls(tmpDir)
    const gw = await startGw(tls, { token: 't' })
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: gw.port,
          path: '/',
          method: 'GET',
        },
        () => {
          reject(new Error('plaintext HTTP must not receive a response from HTTPS gateway'))
        },
      )
      req.on('error', () => resolve())
      req.setTimeout(2000, () => {
        req.destroy()
        resolve()
      })
      req.end()
    })
    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port: gw.port,
          path: '/?k=t',
          method: 'GET',
          rejectUnauthorized: false,
        },
        (res) => {
          expect(res.statusCode).toBeGreaterThanOrEqual(200)
          expect(res.statusCode).toBeLessThan(400)
          const setCookie = res.headers['set-cookie']?.join(';') || ''
          expect(setCookie).toContain('ea_k=')
          expect(res.headers['x-content-type-options']).toBe('nosniff')
          res.resume()
          resolve()
        },
      )
      req.on('error', reject)
      req.end()
    })
    await gw.close()
  })

  it('originAllowed: 同源通过；Host 不一致拒绝；HTTP Origin 在 HTTPS 下拒绝', () => {
    expect(
      originAllowed(
        { headers: { origin: 'https://127.0.0.1:18765', host: '127.0.0.1:18765' } },
        'https',
      ),
    ).toBe(true)
    expect(
      originAllowed(
        { headers: { origin: 'https://webui.example.com', host: '127.0.0.1:18766' } },
        'https',
      ),
    ).toBe(false)
    expect(
      originAllowed(
        { headers: { origin: 'http://127.0.0.1:18766', host: '127.0.0.1:18766' } },
        'https',
      ),
    ).toBe(false)
    expect(
      originAllowed(
        { headers: { origin: 'http://127.0.0.1:18766', host: '127.0.0.1:18766' } },
        'http',
      ),
    ).toBe(true)
  })

  it('HTTP 协议网关可用令牌访问', async () => {
    const tls = ensureWebUiTls(tmpDir)
    handleIpc('webui:http-ping', async () => ({ pong: true }))
    const gw = await startGw(tls, { protocol: 'http', token: 'http-token', ipv6: false, bind: 'loopback' })
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: gw.port,
          path: '/?k=http-token',
          method: 'GET',
        },
        (res) => {
          expect(res.statusCode).toBeGreaterThanOrEqual(200)
          expect(res.statusCode).toBeLessThan(400)
          res.resume()
          resolve()
        },
      )
      req.on('error', reject)
      req.end()
    })
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/ws?k=http-token`)
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: '1', type: 'invoke', channel: 'webui:http-ping', args: [] }))
      })
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as { type: string; data?: { pong?: boolean } }
        try {
          expect(msg.type).toBe('result')
          expect(msg.data).toEqual({ pong: true })
          ws.close()
          resolve()
        } catch (err) {
          reject(err)
        }
      })
      ws.on('error', reject)
    })
    await gw.close()
  })

  it('POST /upload 把浏览器文件落到主机目录；无令牌 401；GET 405', async () => {
    const tls = ensureWebUiTls(tmpDir)
    const gw = await startGw(tls, {
      protocol: 'http',
      token: 'up-token',
      ipv6: false,
      bind: 'loopback',
    })
    const uploadsDir = path.join(tmpDir, 'uploads')

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: gw.port,
          path: '/upload',
          method: 'POST',
          headers: { 'Content-Length': '3', 'X-Filename': 'a.txt' },
        },
        (res) => {
          try {
            expect(res.statusCode).toBe(401)
            res.resume()
            resolve()
          } catch (err) {
            reject(err)
          }
        },
      )
      req.on('error', reject)
      req.end('abc')
    })

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: gw.port,
          path: '/upload?k=up-token',
          method: 'GET',
        },
        (res) => {
          try {
            expect(res.statusCode).toBe(405)
            res.resume()
            resolve()
          } catch (err) {
            reject(err)
          }
        },
      )
      req.on('error', reject)
      req.end()
    })

    const body = Buffer.from('roster-bytes')
    const saved = await new Promise<{ status: number; json: { success: boolean; path: string; name: string } }>(
      (resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: gw.port,
            path: '/upload',
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Length': body.length,
              'X-Filename': encodeURIComponent('花名册.xlsx'),
              'X-EA-Token': 'up-token',
            },
          },
          (res) => {
            const chunks: Buffer[] = []
            res.on('data', (c) => chunks.push(c as Buffer))
            res.on('end', () => {
              try {
                const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
                  success: boolean
                  path: string
                  name: string
                }
                resolve({ status: res.statusCode || 0, json })
              } catch (err) {
                reject(err)
              }
            })
          },
        )
        req.on('error', reject)
        req.end(body)
      },
    )
    expect(saved.status).toBe(200)
    expect(saved.json.success).toBe(true)
    expect(saved.json.name).toBe('花名册.xlsx')
    expect(path.dirname(saved.json.path)).toBe(uploadsDir)
    expect(await fsp.readFile(saved.json.path)).toEqual(body)

    await gw.close()
  })
})
