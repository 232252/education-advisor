// 性能基线: 内存/堆/DOM节点/路由切换耗时
// 需要已启动且开启 CDP 的 Electron 实例(本地 npm run dev,端口 9222)。
// CI 无头环境没有 Electron 实例,优雅跳过(exit 0)避免误报失败。
import { connectCdp, fetchTargets, sleep } from './lib/cdp-client.mjs'

const targets = await fetchTargets()
if (!targets || targets.length === 0) {
  console.log(
    '[perf-baseline] no CDP target at localhost:9222 — skipping (headless CI). Run `npm run dev` locally to collect metrics.',
  )
  process.exit(0)
}
const { evl, close } = await connectCdp()
const routes = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/academics', '#/agents', '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings']
// 首次基线
const base = await evl(`(() => {
  const mem = performance.memory ? { usedJS: Math.round(performance.memory.usedJSHeapSize/1048576), totalJS: Math.round(performance.memory.totalJSHeapSize/1048576) } : null
  return { mem, domNodes: document.querySelectorAll('*').length, listeners: performance.getEntriesByType('resource').length }
})()`)
console.log('baseline:', JSON.stringify(base))
// 路由切换耗时(预热一次后)
await evl(`location.hash = '#/dashboard'`); await sleep(1500)
const navTimes = {}
for (const r of routes) {
  const t0 = Date.now()
  await evl(`location.hash = '${r}'`)
  // 等待内容渲染(轮询 body 变化或固定等待)
  await sleep(1200)
  navTimes[r] = Date.now() - t0
}
console.log('nav times:', JSON.stringify(navTimes))
// 切换后的内存
await evl(`location.hash = '#/students'`); await sleep(2500)
const after = await evl(`(() => {
  const mem = performance.memory ? { usedJS: Math.round(performance.memory.usedJSHeapSize/1048576), totalJS: Math.round(performance.memory.totalJSHeapSize/1048576) } : null
  return { mem, domNodes: document.querySelectorAll('*').length }
})()`)
console.log('after nav:', JSON.stringify(after))
close(); process.exit(0)
