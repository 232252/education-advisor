// One-shot: open connection center panel, wait for mount, capture light+dark zoomed clips.
// Usage: EA_CDP_PORT=9223 node scripts/devtools-cdp/cdp-shot-panel.mjs <out-light.png> <out-dark.png>
import fs from 'node:fs'
import path from 'node:path'
import { connectCdp, sleep } from '../lib/cdp-client.mjs'

const [outLight, outDark] = process.argv.slice(2)

const { send, close } = await connectCdp()
await send('Page.enable')

const evl = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
  return r.result?.result?.value
}

async function captureClip(selector, out) {
  const box = await evl(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`,
  )
  if (!box) return false
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 },
  })
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log(`saved ${out} (${Math.round(box.width * 2)}x${Math.round(box.height * 2)})`)
  return true
}

// 打开面板(已开则不重复点击,toggle 会关) → 轮询等挂载(懒 chunk 冷加载可能 >1s) → 稳定后连拍浅/深两张
await evl(`(() => { const b = document.querySelector('button[aria-label="连接中心"]'); if (!b) throw new Error('entry button not found'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true })()`)
let ok = false
for (let i = 0; i < 50 && !ok; i++) {
  await sleep(200)
  ok = await evl(`!!document.querySelector('[data-testid="connection-center-panel"]')`)
}
if (!ok) throw new Error('panel did not mount within 10s')
await sleep(400)

await captureClip('[data-testid="connection-center-panel"]', outLight)
await evl(`document.documentElement.classList.add('dark')`)
await sleep(200)
await captureClip('[data-testid="connection-center-panel"]', outDark)
close()
process.exit(0)
