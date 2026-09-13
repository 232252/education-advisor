// CDP clipped screenshot — captures a DOM element region at 2x scale.
// Usage: EA_CDP_PORT=9223 node scripts/devtools-cdp/cdp-shot-clip.mjs <selector> <out.png>
import fs from 'node:fs'
import path from 'node:path'
import { connectCdp } from '../lib/cdp-client.mjs'

const [selector, out] = process.argv.slice(2)
if (!selector || !out) {
  console.error('Usage: node cdp-shot-clip.mjs <css-selector> <out.png>')
  process.exit(1)
}

const { send, close } = await connectCdp()
await send('Page.enable')
const rect = await send('Runtime.evaluate', {
  expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`,
  returnByValue: true,
})
const box = rect.result?.result?.value
if (!box) {
  console.error(`element not found: ${selector}`)
  process.exit(1)
}
// clip 超出视口会让 captureScreenshot 挂起,与视口取交集并封顶(超宽屏下元素可达 6000px+)
const vp = await send('Runtime.evaluate', {
  expression: '({ w: window.innerWidth, h: window.innerHeight })',
  returnByValue: true,
})
const viewport = vp.result?.result?.value
box.height = Math.min(box.height, viewport.h - box.y - 4, 1500)
box.width = Math.min(box.width, viewport.w - box.x - 4, 1100)
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 },
})
close()
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log(`saved ${out} (${(box.width * 2).toFixed(0)}x${(box.height * 2).toFixed(0)})`)
process.exit(0)
