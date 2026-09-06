// CDP i18n UI 审计 — 连接运行中的 Electron 实例,按语言逐路由收集
// 可见文本与 aria-label/title,输出"等于字典 zh 值的渲染"(en 模式下
// 即硬编码/未接线嫌疑)与统计,供 i18n 清理轮取证。
//
// 前置: 应用以 CDP 启动(npm run dev 或 electron .,默认端口 9222,
// EA_CDP_PORT 可覆盖;.env 里 ENABLE_CDP=0 时需显式 ENABLE_CDP=1)。
// 用法:
//   EA_CDP_PORT=9444 node scripts/devtools-cdp/cdp-i18n-audit.mjs [en|zh] [每路由等待ms]
// 说明:
//   - localhost 解析到 ::1 而 CDP 只绑 IPv4,这里统一重写 127.0.0.1
//   - zh 模式的价值是回归: t() 返回裸 key(字典缺键)会与字典值同帧可见
import { connectCdp, fetchTargets, sleep } from '../lib/cdp-client.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const realFetch = globalThis.fetch
globalThis.fetch = (url, ...a) => realFetch(String(url).replace('localhost', '127.0.0.1'), ...a)

const LANG = process.argv[2] === 'zh' ? 'zh' : 'en'
const WAIT = Number.parseInt(process.argv[3] || '1400', 10) || 1400
const ROUTES = [
  '#/dashboard', '#/students', '#/classes', '#/academics', '#/chat', '#/agents',
  '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings', '#/reports',
]
const LANG_KEY = 'education-advisor.lang'

const targets = await fetchTargets()
if (!targets || targets.length === 0) {
  console.log('[cdp-i18n-audit] no CDP target — 启动应用并开启 CDP 后再跑')
  process.exit(0)
}
const { evl, close } = await connectCdp()

await evl(`localStorage.setItem('${LANG_KEY}', '${LANG}'); location.hash = '#/dashboard'; location.reload()`)
await sleep(3000)

const findings = []
for (const r of ROUTES) {
  await evl(`location.hash = '${r}'`)
  await sleep(WAIT)
  const res = await evl(`(() => {
    const els = document.querySelectorAll('body *')
    const out = []
    for (const el of els) {
      const txt = (el.children.length === 0 ? el.textContent : '').trim()
      if (txt && txt.length < 80) out.push({ t: txt, tag: el.tagName })
      const a = el.getAttribute('aria-label') || ''
      const ti = el.getAttribute('title') || ''
      if (a) out.push({ t: a, tag: el.tagName + '[aria]' })
      if (ti) out.push({ t: ti, tag: el.tagName + '[title]' })
    }
    return JSON.stringify(out.slice(0, 1500))
  })()`)
  let items = []
  try { items = JSON.parse(res) } catch { console.log('[audit] eval fail', r, String(res).slice(0, 100)) }
  for (const it of items) {
    if (/[\u4e00-\u9fff]/.test(it.t)) findings.push({ route: r, tag: it.tag, text: it.t.slice(0, 60) })
  }
}

// 字典 zh 值反查: en 模式下渲染出 zh 字典值 = 硬编码渲染实锤
const zhDict = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/i18n/zh.json'), 'utf-8'))
const zhVals = new Set(Object.values(zhDict))
const uniq = [...new Set(findings.map((f) => f.text))]
const hardcoded = uniq.filter((t) => LANG === 'en' && zhVals.has(t))

console.log(`[cdp-i18n-audit] lang=${LANG} 路由=${ROUTES.length}`)
console.log(`  中文文本: ${findings.length} 处 / 唯一 ${uniq.length}`)
if (LANG === 'en') {
  console.log(`  其中 == zh 字典值(硬编码嫌疑): ${hardcoded.length}`)
  for (const t of hardcoded) console.log('   ·', t)
  const byRoute = {}
  for (const f of findings) if (zhVals.has(f.text)) byRoute[f.route] = (byRoute[f.route] || 0) + 1
  console.log('  分布:', JSON.stringify(byRoute))
  console.log('  注: EAA CLI 表格列头/AI 回复/agent 角色名/班级学生事件名均为数据,保持原文属预期')
}
close()
