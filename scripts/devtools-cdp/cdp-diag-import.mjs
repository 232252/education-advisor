// 诊断: 在运行中的应用内动态导入各模块,检查默认导出解析为什么
// 用法: node scripts/cdp-eval-module.mjs
const { send, close } = await import('../lib/cdp-client.mjs').then((m) => m.connectCdp())

// 找到 DashboardPage chunk 并检查其图表 chunk 引用
const expr = `(async () => {
  // 通过 webpackChunk 不可行(vite),改为直接检查全局错误
  // 抓取最近 console.error 内容已由日志覆盖;这里改为:
  // 动态 import 构建产物中的 DashboardPage chunk,触发同样的错误并捕获完整 message
  try {
    const mods = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('DashboardPage'))
    return { mods }
  } catch (e) { return { err: String(e) } }
})()`
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(r.result?.result?.value ?? r, null, 2).slice(0, 2000))
close()
process.exit(0)
