// 测量 Dashboard 各 API 调用耗时
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try { const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) }
      }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
}

async function timeCall(cdp, name) {
  const t0 = Date.now()
  const result = await cdp.eval(`(async()=>{
    const t0=Date.now();
    try {
      const r = await window.api.eaa.${name}();
      return { ok: r.success, ms: Date.now()-t0, err: r.error || null };
    } catch(e) {
      return { ok: false, ms: Date.now()-t0, err: e.message };
    }
  })()`)
  return { name, ...result, totalMs: Date.now() - t0 }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== Dashboard API 调用耗时分析 ===\n')

  // 1. 顺序调用各API
  const apis = ['stats', 'summary', 'ranking', 'info', 'tag', 'listStudents']
  for (const api of apis) {
    const r = await timeCall(cdp, api)
    console.log(`  eaa.${api}: ok=${r.ok}, time=${r.ms}ms (total=${r.totalMs}ms)${r.err ? ', err=' + r.err : ''}`)
  }

  // 2. class.list
  const tCls = Date.now()
  const clsRes = await cdp.eval(`(async()=>{ const t0=Date.now(); const r=await window.api.class.list(); return {ok:r.success, ms:Date.now()-t0, count: r.data?.length || 0}; })()`)
  console.log(`  class.list: ok=${clsRes.ok}, time=${clsRes.ms}ms, count=${clsRes.count}`)

  // 3. 并行调用 (模拟 Dashboard 的 Promise.allSettled)
  console.log('\n--- 并行调用 (模拟 Dashboard loadData) ---')
  const tParallel = Date.now()
  const parallelRes = await cdp.eval(`(async()=>{
    const t0=Date.now();
    const results = await Promise.allSettled([
      window.api.eaa.stats(),
      window.api.eaa.summary(),
      window.api.eaa.ranking(10),
      window.api.eaa.info(),
      window.api.eaa.tag(),
      window.api.eaa.listStudents(),
      window.api.class.list(),
    ]);
    return {
      totalMs: Date.now() - t0,
      counts: results.map(r => r.status === 'fulfilled' ? (r.value?.success ? 'ok' : 'fail') : 'reject'),
    };
  })()`)
  console.log(`  并行总耗时: ${parallelRes.totalMs}ms`)
  console.log(`  各项状态: ${JSON.stringify(parallelRes.counts)}`)

  // 4. 测量完整 Dashboard 渲染时间
  console.log('\n--- 完整 Dashboard 渲染时间 ---')
  await cdp.eval(`window.location.hash='/dashboard'`)
  const tNav = Date.now()
  // 轮询 h1 出现
  let h1Found = false
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200))
    const hasH1 = await cdp.eval(`document.querySelector('h1') !== null`)
    if (hasH1) { h1Found = true; console.log(`  h1 出现在 ${(i + 1) * 200}ms`); break }
  }
  if (!h1Found) console.log('  h1 6秒内未出现!')

  // 等待 3 秒看 ECharts 是否渲染
  await new Promise((r) => setTimeout(r, 3000))
  const chartCount = await cdp.eval(`document.querySelectorAll('canvas, [_echarts_instance_]').length`)
  console.log(`  ECharts canvas/instance 数: ${chartCount}`)
  console.log(`  总渲染时间(到h1+3s): ${Date.now() - tNav}ms`)

  ws.close(1000)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
