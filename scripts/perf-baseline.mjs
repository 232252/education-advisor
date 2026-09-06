// 性能基线: 内存/堆/DOM节点/路由切换耗时
// 需要已启动且开启 CDP 的 Electron 实例(本地 npm run dev,端口 9222,
// EA_CDP_PORT 可覆盖;.env 里 ENABLE_CDP=0 时需显式 ENABLE_CDP=1)。
// CI 无头环境没有 Electron 实例,优雅跳过(exit 0)避免误报失败。
//
// R17: 固定 1200ms sleep 改为路由就绪轮询——此前测得的"切换耗时"实为
// sleep 上限(全部 ~1206ms),掩盖真实差异。就绪判据: 路由稳定特征元素
// 出现 + 双 rAF 首绘提交;8s 超时兜底并在汇总告警。
import { connectCdp, fetchTargets, sleep } from './lib/cdp-client.mjs'

const targets = await fetchTargets()
if (!targets || targets.length === 0) {
  console.log(
    '[perf-baseline] no CDP target — skipping (headless CI). Run `npm run dev` locally to collect metrics.',
  )
  process.exit(0)
}
const { evl, close } = await connectCdp()
const routes = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/academics', '#/agents', '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings']

// 每个路由的稳定特征选择器(就绪 = 元素存在),区分"hash 变了"和"页面渲染了"
const ROUTE_READY_SELECTOR = {
  '#/dashboard': 'main, h1, h2, [class*=dashboard]',
  '#/chat': 'textarea, input, [class*=session]',
  '#/students': 'table, h1, h2, [class*=student]',
  '#/classes': 'table, h1, h2, [class*=class]',
  '#/academics': 'table, h1, h2, [class*=academics]',
  '#/agents': 'h1, h2, [class*=agent]',
  '#/models': 'input, h1, h2, [class*=provider]',
  '#/skills': 'h1, h2, [class*=skill]',
  '#/scheduler': 'h1, h2, [class*=scheduler], [class*=task]',
  '#/privacy': 'h1, h2, input[type=password], [class*=privacy]',
  '#/settings': 'h1, h2, [class*=settings]',
}
const NAV_TIMEOUT_MS = 8000

// 预热首路由
await evl(`location.hash = '#/dashboard'`)
await sleep(1500)

async function navReady(route) {
  const sel = ROUTE_READY_SELECTOR[route] || 'main, h1, h2'
  const t0 = Date.now()
  await evl(`location.hash = '${route}'`)
  for (;;) {
    const ready = await evl(`!!document.querySelector('${sel}')`)
    if (ready === true) break
    if (Date.now() - t0 > NAV_TIMEOUT_MS) return { ms: Date.now() - t0, timeout: true }
    await sleep(50)
  }
  await evl('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
  return { ms: Date.now() - t0, timeout: false }
}

const base = await evl(`(() => {
  const mem = performance.memory ? { usedJS: Math.round(performance.memory.usedJSHeapSize/1048576), totalJS: Math.round(performance.memory.totalJSHeapSize/1048576) } : null
  return { mem, domNodes: document.querySelectorAll('*').length, listeners: performance.getEntriesByType('resource').length }
})()`)
console.log('baseline:', JSON.stringify(base))

const navTimes = {}
let timeouts = 0
for (const r of routes) {
  const res = await navReady(r)
  navTimes[r] = res.ms
  if (res.timeout) timeouts++
}
console.log('nav times (ready-poll):', JSON.stringify(navTimes))
if (timeouts > 0) console.log(`[perf-baseline] warn: ${timeouts} route(s) hit ${NAV_TIMEOUT_MS}ms timeout`)

await evl(`location.hash = '#/students'`)
await sleep(2500)
const after = await evl(`(() => {
  const mem = performance.memory ? { usedJS: Math.round(performance.memory.usedJSHeapSize/1048576), totalJS: Math.round(performance.memory.totalJSHeapSize/1048576) } : null
  return { mem, domNodes: document.querySelectorAll('*').length }
})()`)
console.log('after nav:', JSON.stringify(after))
close(); process.exit(0)
