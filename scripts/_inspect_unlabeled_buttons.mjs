// 临时脚本: 枚举各页面缺少可访问名称的按钮
import http from 'node:http'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`

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
    setTimeout(() => {
      ws.off('message', handler)
      reject(new Error(`CDP timeout: ${method}`))
    }, 30000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 25000,
  })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  return r.result.value
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }

const targets = await getTargets()
const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('timeout')), 10000) })

const routes = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/academics', '#/agents', '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings']

console.log('=== 未标记按钮清单 ===\n')
const allUnlabeled = []
for (const hash of routes) {
  await evalInPage(ws, `window.location.hash = '${hash}'; true`)
  await sleep(700)
  const r = await evalInPage(ws, `(async () => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const unlabeled = [];
    for (const b of buttons) {
      const text = (b.innerText || '').trim();
      const aria = b.getAttribute('aria-label');
      const title = b.getAttribute('title');
      const svg = b.querySelector('svg');
      const svgClass = svg ? svg.getAttribute('class') || '' : '';
      const parent = b.parentElement;
      const parentClass = parent ? (parent.getAttribute('class') || '').slice(0, 80) : '';
      if (!text && !aria && !title) {
        // 收集诊断信息
        const cls = (b.getAttribute('class') || '').slice(0, 100);
        const role = b.getAttribute('role');
        const dataTest = b.getAttribute('data-testid');
        unlabeled.push({
          cls,
          role,
          dataTest,
          hasSvg: !!svg,
          svgClass,
          parentClass,
          outerHTML: b.outerHTML.slice(0, 250),
        });
      }
    }
    return { route: window.location.hash, total: buttons.length, unlabeled };
  })()`)
  if (r?.unlabeled?.length > 0) {
    console.log(`\n[${r.route}] total=${r.total}, unlabeled=${r.unlabeled.length}`)
    for (const u of r.unlabeled) {
      console.log(`  - class="${u.cls}" role=${u.role} hasSvg=${u.hasSvg} parent="${u.parentClass}"`)
      console.log(`    html: ${u.outerHTML}`)
      allUnlabeled.push({ route: r.route, ...u })
    }
  }
}

console.log(`\n\n=== 总计: ${allUnlabeled.length} 个未标记按钮 ===`)
ws.close()
process.exit(0)
