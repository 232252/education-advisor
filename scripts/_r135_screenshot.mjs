// Quick CDP screenshot capture for R135 UI assessment
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`
const OUT_DIR = path.join(process.cwd(), 'scripts', '_r135_shots')

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}/json`, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(JSON.parse(data)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function cdpCall(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.toString())
      if (msg.id === id) {
        ws.off('message', handler)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { ws.off('message', handler); reject(new Error(`timeout: ${method}`)) }, 30000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result.value
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }

fs.mkdirSync(OUT_DIR, { recursive: true })
const targets = await getTargets()
const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('timeout')), 10000) })

await cdpCall(ws, 'Page.enable')

const routes = [
  '#/dashboard', '#/chat', '#/students', '#/classes', '#/academics',
  '#/agents', '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings',
]

for (const route of routes) {
  await evalInPage(ws, `window.location.hash = ${JSON.stringify(route)}`)
  await sleep(1500) // allow render + lazy load
  const { data } = await cdpCall(ws, 'Page.captureScreenshot', { format: 'png' })
  const name = route.replace('#/', '')
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(data, 'base64'))
  // also capture computed theme + any console errors
  const info = await evalInPage(ws, `(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const themeEl = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    return { theme: themeEl, bg };
  })()`)
  console.log(`${name}: ${info?.theme} bg=${info?.bg}`)
}

ws.close()
console.log(`\nScreenshots saved to: ${OUT_DIR}`)
