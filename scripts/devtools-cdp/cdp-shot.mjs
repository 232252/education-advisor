// CDP screenshot utility — connects to the running Electron app's CDP endpoint,
// optionally evaluates a JS expression (e.g. navigate), waits, then captures a PNG.
// Usage:
//   node scripts/cdp-shot.mjs <out.png> [waitMs] [evalExpr]
// Example:
//   node scripts/cdp-shot.mjs shots/dashboard.png 800 "location.hash='#/dashboard'"
import fs from 'node:fs'
import path from 'node:path'
import { connectCdp } from '../lib/cdp-client.mjs'

async function main() {
  const [out, waitMsArg, ...exprParts] = process.argv.slice(2)
  if (!out) {
    console.error('Usage: node scripts/cdp-shot.mjs <out.png> [waitMs] [evalExpr]')
    process.exit(1)
  }
  const waitMs = Number.parseInt(waitMsArg || '800', 10) || 800
  const expr = exprParts.join(' ').trim()

  const { send, close } = await connectCdp()

  await send('Page.enable')
  if (expr) {
    await send('Runtime.evaluate', { expression: expr, awaitPromise: false })
  }
  await new Promise((r) => setTimeout(r, waitMs))
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  close()
  if (!shot.result?.data) throw new Error('captureScreenshot returned no data')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log(`saved ${out} (${fs.statSync(out).length} bytes)`)
  // 显式退出: ws 关闭握手在等待服务端 close frame 时会挂住事件循环
  process.exit(0)
}

main().catch((e) => {
  console.error('cdp-shot failed:', e.message)
  process.exit(1)
})
