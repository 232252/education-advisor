// 批量遍历路由截图: node scripts/cdp-tour.mjs <outDir> [waitMs]
import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'

const ROUTES = [
  'dashboard', 'chat', 'students', 'classes', 'academics', 'agents',
  'models', 'skills', 'scheduler', 'privacy', 'settings',
]

const outDir = process.argv[2] || '.tmp/cdp-tour'
const waitMs = Number.parseInt(process.argv[3] || '1800', 10)
fs.mkdirSync(outDir, { recursive: true })

async function getPageTarget() {
  const res = await fetch(`http://localhost:${process.env.EA_CDP_PORT || '9222'}/json`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
  if (!page) throw new Error('no page target')
  return page
}

async function main() {
  const page = await getPageTarget()
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
  let id = 0
  const pending = new Map()
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Page.enable')
  const results = []
  for (const route of ROUTES) {
    await send('Runtime.evaluate', { expression: `location.hash = '#/${route}'` })
    await new Promise((r) => setTimeout(r, waitMs))
    // 收集控制台错误
    const errCheck = await send('Runtime.evaluate', {
      expression: `window.__lastRenderError || null`,
      returnByValue: true,
    })
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(outDir, `${route}.png`)
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
    results.push({ route, file, err: errCheck.result?.result?.value ?? null })
    console.log(`[tour] ${route} -> ${file}`)
  }
  console.log(JSON.stringify(results))
  ws.close()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
