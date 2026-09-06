// 批量遍历路由截图: node scripts/cdp-tour.mjs <outDir> [waitMs]
import fs from 'node:fs'
import path from 'node:path'
import { connectCdp } from '../lib/cdp-client.mjs'

const ROUTES = [
  'dashboard', 'chat', 'students', 'classes', 'academics', 'agents',
  'models', 'skills', 'scheduler', 'privacy', 'settings',
]

const outDir = process.argv[2] || '.tmp/cdp-tour'
const waitMs = Number.parseInt(process.argv[3] || '1800', 10)
fs.mkdirSync(outDir, { recursive: true })

async function main() {
  const { send, close } = await connectCdp({
    pageFilter: (t) => t.type === 'page' && !t.url.startsWith('devtools'),
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
  close()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
