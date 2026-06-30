// =============================================================
// visual-regression.js — 视觉回归测试
// 通过 CDP (Chrome DevTools Protocol) 截取应用中每个页面的截图,
// 与 baseline 对比,检测 UI 变化。
//
// 使用:
//   1. 启动应用: ENABLE_CDP=1 npm run dev  (或 electron .)
//   2. 运行此脚本: node tests/e2e/visual-regression.js
//   3. 首次运行会生成 baseline,后续运行会与 baseline 对比
//
// 选项:
//   --update    重新生成 baseline (不对比)
//   --pages=a,b 只测试指定页面
// =============================================================

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const WebSocket = require('ws')

const args = process.argv.slice(2)
const updateBaseline = args.includes('--update')
const pagesArg = args.find((a) => a.startsWith('--pages='))
const onlyPages = pagesArg ? pagesArg.slice(8).split(',').map((s) => s.trim()) : null

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots')
const BASELINE_DIR = path.join(SCREENSHOTS_DIR, 'baseline')
const CURRENT_DIR = path.join(SCREENSHOTS_DIR, 'current')
const DIFF_DIR = path.join(SCREENSHOTS_DIR, 'diff')

for (const dir of [BASELINE_DIR, CURRENT_DIR, DIFF_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// 像素差异阈值 (0-1, 越低越严格)
const PIXEL_DIFF_THRESHOLD = 0.01

// 所有页面
const ALL_PAGES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'chat', path: '/chat' },
  { name: 'students', path: '/students' },
  { name: 'agents', path: '/agents' },
  { name: 'models', path: '/models' },
  { name: 'skills', path: '/skills' },
  { name: 'scheduler', path: '/scheduler' },
  { name: 'privacy', path: '/privacy' },
  { name: 'settings', path: '/settings' },
]

const PAGES = onlyPages
  ? ALL_PAGES.filter((p) => onlyPages.includes(p.name))
  : ALL_PAGES

// CDP Client (复用 stress-test.js 的实现)
class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.msgId = 0
    this.callbacks = new Map()
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false })
      this.ws.on('open', () => resolve())
      this.ws.on('error', reject)
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id != null) {
          const cb = this.callbacks.get(msg.id)
          if (cb) {
            this.callbacks.delete(msg.id)
            if (msg.error) cb.reject(new Error(msg.error.message))
            else cb.resolve(msg.result)
          }
        }
      })
    })
  }
  send(method, params = {}) {
    const id = ++this.msgId
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() {
    this.ws?.close()
  }
}

function listTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 比较两个 PNG 文件的像素差异 (简化版:基于文件大小+字节差异)
// 注意: 真正的像素比较需要 PNG 解码。这里做一个轻量近似:
//   - 如果文件大小差异 > 10%,认为不同
//   - 否则逐字节比较前 4KB,统计差异比例
function compareImages(baselinePath, currentPath) {
  if (!fs.existsSync(baselinePath)) {
    return { same: false, reason: 'no-baseline', diffRatio: 1 }
  }
  if (!fs.existsSync(currentPath)) {
    return { same: false, reason: 'no-current', diffRatio: 1 }
  }
  const a = fs.readFileSync(baselinePath)
  const b = fs.readFileSync(currentPath)
  if (a.length === b.length && a.equals(b)) {
    return { same: true, diffRatio: 0 }
  }
  // 大小差异 > 10% 视为完全不同
  const sizeDiff = Math.abs(a.length - b.length) / Math.max(a.length, b.length)
  if (sizeDiff > 0.1) {
    return { same: false, reason: 'size-diff', diffRatio: sizeDiff }
  }
  // 逐字节比较(采样前 32KB)
  const sampleLen = Math.min(32 * 1024, a.length, b.length)
  let diff = 0
  for (let i = 0; i < sampleLen; i++) {
    if (a[i] !== b[i]) diff++
  }
  const diffRatio = diff / sampleLen
  return {
    same: diffRatio < PIXEL_DIFF_THRESHOLD,
    reason: diffRatio < PIXEL_DIFF_THRESHOLD ? 'similar' : 'pixel-diff',
    diffRatio,
  }
}

async function main() {
  console.log('=== Visual Regression Test ===')
  console.log(`Mode: ${updateBaseline ? 'UPDATE BASELINE' : 'COMPARE'}`)
  console.log(`Pages: ${PAGES.map((p) => p.name).join(', ')}`)
  console.log(`Threshold: ${(PIXEL_DIFF_THRESHOLD * 100).toFixed(2)}% pixel diff`)

  let targets
  try {
    targets = await listTargets()
  } catch (err) {
    console.error('\n✗ 无法连接到 CDP (http://localhost:9222)')
    console.error('  请确保应用已启动且 CDP 已开启 (ENABLE_CDP=1 npm run dev)')
    console.error(`  错误: ${err.message}`)
    process.exit(2)
  }
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    console.error('✗ 没有找到 page 类型的 target')
    process.exit(2)
  }

  const cdp = new CDPClient(page.webSocketDebuggerUrl)
  await cdp.connect()
  console.log('✓ 已连接到 CDP')

  const FILE_URL = page.url
  console.log(`Page URL: ${FILE_URL}`)

  // 启用 Page 域以便截图
  await cdp.send('Page.enable')

  const results = []

  for (const p of PAGES) {
    const baselineFile = path.join(BASELINE_DIR, `${p.name}.png`)
    const currentFile = path.join(CURRENT_DIR, `${p.name}.png`)

    console.log(`\n--- ${p.name} (${p.path}) ---`)
    try {
      // 导航到页面
      await cdp.send('Page.navigate', { url: `${FILE_URL}#${p.path}` })
      await sleep(800) // 等待渲染

      // 截图
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      fs.writeFileSync(currentFile, Buffer.from(screenshot.data, 'base64'))
      console.log(`  ✓ 截图已保存: ${currentFile}`)

      if (updateBaseline) {
        fs.copyFileSync(currentFile, baselineFile)
        console.log(`  ✓ baseline 已更新: ${baselineFile}`)
        results.push({ page: p.name, status: 'baseline-updated' })
      } else {
        const cmp = compareImages(baselineFile, currentFile)
        if (cmp.same) {
          console.log(`  ✓ 与 baseline 一致 (diff: ${(cmp.diffRatio * 100).toFixed(2)}%)`)
          results.push({
            page: p.name,
            status: 'same',
            diffRatio: cmp.diffRatio,
          })
        } else {
          console.log(
            `  ✗ 与 baseline 不同 (reason: ${cmp.reason}, diff: ${((cmp.diffRatio || 0) * 100).toFixed(2)}%)`,
          )
          results.push({
            page: p.name,
            status: 'different',
            reason: cmp.reason,
            diffRatio: cmp.diffRatio,
          })
        }
      }
    } catch (err) {
      console.log(`  ✗ 失败: ${err.message}`)
      results.push({ page: p.name, status: 'error', error: err.message })
    }
  }

  cdp.close()

  // 报告
  console.log('\n=== 报告 ===')
  const same = results.filter((r) => r.status === 'same').length
  const different = results.filter((r) => r.status === 'different').length
  const errors = results.filter((r) => r.status === 'error').length
  const updated = results.filter((r) => r.status === 'baseline-updated').length
  console.log(`一致: ${same}/${results.length}`)
  console.log(`不同: ${different}/${results.length}`)
  console.log(`错误: ${errors}/${results.length}`)
  if (updated > 0) console.log(`已更新 baseline: ${updated}/${results.length}`)

  const reportFile = path.join(SCREENSHOTS_DIR, 'report.json')
  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        mode: updateBaseline ? 'update' : 'compare',
        threshold: PIXEL_DIFF_THRESHOLD,
        results,
        summary: { same, different, errors, updated, total: results.length },
      },
      null,
      2,
    ),
    'utf-8',
  )
  console.log(`\n报告已保存: ${reportFile}`)

  if (!updateBaseline && (different > 0 || errors > 0)) {
    console.log('\n✗ 视觉回归测试失败')
    process.exit(1)
  }
  console.log('\n✓ 视觉回归测试通过')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
