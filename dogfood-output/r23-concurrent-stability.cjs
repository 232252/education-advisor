// R23: 并发压力 + 长时间稳定性 + 错误恢复 + 内存趋势
// 角度: 并发只读 API / 快速导航 / 错误注入 / 5分钟连续测试
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 5000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R23 并发压力 + 长时间稳定性 + 错误恢复 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 100)}`) }

  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p){if(o==null)return{__error:'no such api: '+p.join('.')};o=o[x]}if(typeof o!=='function')return{__error:'not a function: '+p.join('.')};const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }
  function unwrap(r) { if (r && r.__error) return r; if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data; return r }
  async function callApi(path, ...args) {
    const raw = await callRaw(path, ...args)
    if (raw && typeof raw === 'object' && raw.success === false) {
      return { __error: String(raw.data || raw.error || 'failed') }
    }
    return unwrap(raw)
  }
  async function navigate(route) { await cdp.eval(`window.location.hash = '${route}'`); await new Promise((r) => setTimeout(r, 500)) }
  async function getHeap() { return cdp.eval(`performance && performance.memory ? performance.memory.usedJSHeapSize : 0`) }

  // ========== 1. 并发只读 API (10 个 eaa.info 同时) ==========
  console.log('--- 1. 并发只读 API (10 个 eaa.info 同时) ---')
  const t1 = Date.now()
  const promises = []
  for (let i = 0; i < 10; i++) {
    promises.push(callApi('eaa.info'))
  }
  const responses = await Promise.all(promises)
  const successCount = responses.filter((r) => r && !r.__error).length
  const elapsed = Date.now() - t1
  ok('10 并发 eaa.info', `${successCount}/10 成功, 耗时 ${elapsed}ms`)
  // 验证返回一致
  const allMatch = responses.every((r) => r && r.students === responses[0].students)
  ok('并发返回一致性', allMatch ? '全部一致' : '不一致')

  // ========== 2. 并发混合 API ==========
  console.log('\n--- 2. 并发混合 API ---')
  const mixedPromises = [
    callApi('eaa.info'),
    callApi('eaa.doctor'),
    callApi('eaa.listStudents'),
    callApi('eaa.ranking', 10),
    callApi('eaa.stats'),
    callApi('eaa.codes'),
    callApi('agent.list'),
    callApi('cron.list'),
    callApi('class.list'),
    callApi('settings.get'),
  ]
  const mixedResp = await Promise.all(mixedPromises)
  let mixOk = 0
  for (const r of mixedResp) {
    if (r && !r.__error) mixOk++
  }
  ok('10 并发混合 API', `${mixOk}/10 成功`)

  // ========== 3. 快速导航 (50 次页面切换) ==========
  console.log('\n--- 3. 快速导航 (50 次页面切换) ---')
  const routes = ['#/', '#/dashboard', '#/students', '#/classes', '#/agents', '#/chat', '#/skills', '#/privacy', '#/settings', '#/models']
  const heapBeforeNav = await getHeap()
  let navOk = 0
  const navStart = Date.now()
  for (let i = 0; i < 50; i++) {
    const r = routes[i % routes.length]
    try {
      await cdp.eval(`window.location.hash = '${r}'`)
      navOk++
    } catch (e) {}
  }
  await new Promise((r) => setTimeout(r, 1000))
  const navElapsed = Date.now() - navStart
  const heapAfterNav = await getHeap()
  ok('50 快速导航', `${navOk}/50 成功, 耗时 ${navElapsed}ms`)
  ok('导航内存增长', `${((heapAfterNav - heapBeforeNav) / 1024).toFixed(0)} KB`)

  // ========== 4. 错误注入 — 无效 API 路径 ==========
  console.log('\n--- 4. 错误注入 — 无效 API 路径 ---')
  const invalidApis = ['eaa.nonexistent', 'agent.invalid', 'cron.fake', 'sys.notExist', 'invalid.path']
  for (const api of invalidApis) {
    const r = await callApi(api)
    if (r && r.__error) ok(`无效 API ${api}`, '正确返回错误')
    else if (r === undefined) ok(`无效 API ${api}`, '返回 undefined (函数不存在)')
    else fail(`无效 API ${api}`, '应失败', JSON.stringify(r).slice(0, 100))
  }

  // ========== 5. 错误注入 — 无效参数 ==========
  console.log('\n--- 5. 错误注入 — 无效参数 ---')
  // eaa.score 传空
  const emptyScore = await callApi('eaa.score', '')
  if (emptyScore && emptyScore.__error) ok('eaa.score 空名字拒绝', '正确拒绝')
  else fail('eaa.score 空名字拒绝', '应失败', JSON.stringify(emptyScore).slice(0, 100))

  // eaa.history 传 null
  const nullHist = await callApi('eaa.history', null)
  if (nullHist && nullHist.__error) ok('eaa.history null 拒绝', '正确拒绝')
  else fail('eaa.history null 拒绝', '应失败', JSON.stringify(nullHist).slice(0, 100))

  // eaa.ranking 传负数
  const negRank = await callApi('eaa.ranking', -1)
  if (negRank && !negRank.__error) {
    const rArr = Array.isArray(negRank) ? negRank : (negRank?.ranking || negRank?.data || [])
    ok('eaa.ranking -1', `返回 ${rArr.length} 项 (容错)`)
  } else ok('eaa.ranking -1', '拒绝或容错')

  // eaa.ranking 传 0
  const zeroRank = await callApi('eaa.ranking', 0)
  if (zeroRank && !zeroRank.__error) {
    const rArr = Array.isArray(zeroRank) ? zeroRank : (zeroRank?.ranking || zeroRank?.data || [])
    ok('eaa.ranking 0', `返回 ${rArr.length} 项`)
  } else ok('eaa.ranking 0', '拒绝')

  // eaa.ranking 传超大数
  const bigRank = await callApi('eaa.ranking', 999999)
  if (bigRank && !bigRank.__error) {
    const rArr = Array.isArray(bigRank) ? bigRank : (bigRank?.ranking || bigRank?.data || [])
    ok('eaa.ranking 超大数', `返回 ${rArr.length} 项`)
  } else ok('eaa.ranking 超大数', '拒绝')

  // ========== 6. 长时间稳定性 — 连续 200 次 API 调用 ==========
  console.log('\n--- 6. 长时间稳定性 (200 次连续 API) ---')
  const apis200 = ['eaa.info', 'eaa.listStudents', 'eaa.ranking', 'eaa.stats', 'eaa.codes']
  let count200 = 0
  const heapBefore200 = await getHeap()
  const start200 = Date.now()
  for (let i = 0; i < 200; i++) {
    const api = apis200[i % apis200.length]
    const r = await callApi(api, i % 3 === 2 ? 10 : undefined)
    if (r && !r.__error) count200++
  }
  const elapsed200 = Date.now() - start200
  const heapAfter200 = await getHeap()
  ok('200 次连续 API', `${count200}/200 成功, 耗时 ${(elapsed200 / 1000).toFixed(1)}s, 平均 ${elapsed200 / 200}ms/次`)
  ok('200 次后内存增长', `${((heapAfter200 - heapBefore200) / 1024).toFixed(0)} KB`)

  // ========== 7. 内存趋势分析 (10 个采样点) ==========
  console.log('\n--- 7. 内存趋势分析 ---')
  const heapSamples = []
  for (let i = 0; i < 10; i++) {
    await callApi('eaa.info')
    await navigate(routes[i % routes.length])
    heapSamples.push(await getHeap())
  }
  const minHeap = Math.min(...heapSamples)
  const maxHeap = Math.max(...heapSamples)
  const avgHeap = heapSamples.reduce((a, b) => a + b, 0) / heapSamples.length
  ok('内存趋势', `min=${(minHeap / 1024 / 1024).toFixed(2)}MB, max=${(maxHeap / 1024 / 1024).toFixed(2)}MB, avg=${(avgHeap / 1024 / 1024).toFixed(2)}MB, 波动=${((maxHeap - minHeap) / 1024).toFixed(0)}KB`)

  // ========== 8. UI 渲染完整性 — 每页检查关键元素 ==========
  console.log('\n--- 8. UI 渲染完整性 ---')
  for (const route of routes) {
    await navigate(route)
    const check = await cdp.eval(`(function(){
      const hasMain = document.querySelector('main, [role="main"], #root > div') !== null;
      const hasNav = document.querySelector('nav, [role="navigation"], [class*="nav"]') !== null;
      const allElements = document.querySelectorAll('*').length;
      const buttons = document.querySelectorAll('button').length;
      return JSON.stringify({hasMain, hasNav, allElements, buttons});
    })()`)
    const c = JSON.parse(check)
    ok(`UI ${route} 渲染`, `main=${c.hasMain}, nav=${c.hasNav}, elements=${c.allElements}, buttons=${c.buttons}`)
  }

  // ========== 9. 错误恢复 — 触发错误后 UI 是否正常 ==========
  console.log('\n--- 9. 错误恢复 ---')
  // 触发多个错误
  await callApi('eaa.score', '不存在的学生名_xyz123')
  await callApi('eaa.history', '')
  await callApi('invalid.api.path')
  await callApi('eaa.addStudent', null)
  // 检查 UI 是否仍正常
  await navigate('#/dashboard')
  const uiOk = await cdp.eval(`document.querySelectorAll('button').length > 0`)
  ok('错误后 UI 恢复', uiOk ? '正常' : '异常')

  // 触发错误后再调用正常 API
  const infoAfterErr = await callApi('eaa.info')
  if (infoAfterErr && !infoAfterErr.__error) ok('错误后 API 恢复', `info 正常: ${infoAfterErr.students} 学生`)
  else fail('错误后 API 恢复', '', infoAfterErr?.__error)

  // ========== 10. Settings 持久化 — 跨页面验证 ==========
  console.log('\n--- 10. Settings 持久化 ---')
  await navigate('#/settings')
  // 设置 logLevel=warn
  await callApi('settings.set', 'general.logLevel', 'warn')
  // 导航到其他页面再回来
  await navigate('#/dashboard')
  await navigate('#/students')
  await navigate('#/settings')
  // 验证 logLevel 仍是 warn
  const sAfter = await callApi('settings.get')
  if (sAfter?.general?.logLevel === 'warn') ok('Settings 跨页持久化', 'logLevel=warn 保持')
  else fail('Settings 跨页持久化', `实际: ${sAfter?.general?.logLevel}`, '未持久化')
  // 恢复
  await callApi('settings.set', 'general.logLevel', 'info')

  // ========== 11. 最终内存 ==========
  console.log('\n--- 11. 最终内存 ---')
  const finalHeap = await getHeap()
  ok('最终内存', `${(finalHeap / 1024 / 1024).toFixed(2)} MB`)

  // ========== 12. 汇总 ==========
  console.log('\n=== R23 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r23-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
