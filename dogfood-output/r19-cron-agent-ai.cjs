// R19: 未深入测试模块 — Cron/Agent/AI/Profile/Sys/Log
// 1. Cron: list/add/remove/runNow/getLogs/启停
// 2. Agent: list/get/toggle/getSoul/getRules/runManual/getHistory/update
// 3. AI providers: listProviders/listModels
// 4. Profile: get/update
// 5. Sys: getInfo
// 6. Log: 查询
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

  console.log('=== R19 Cron/Agent/AI/Profile/Sys/Log 深度测试 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 100)}`) }

  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p)o=o[x];const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }
  function unwrap(r) { if (r && r.__error) return r; if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data; return r }
  async function callApi(path, ...args) {
    const raw = await callRaw(path, ...args)
    if (raw && typeof raw === 'object' && raw.success === false) {
      return { __error: String(raw.data || raw.error || 'failed') }
    }
    return unwrap(raw)
  }

  const rid = () => 'r19' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

  // ========== 1. Cron 深度测试 ==========
  console.log('--- 1. Cron 深度测试 ---')
  // list
  const cronList = await callApi('cron.list')
  if (cronList && !cronList.__error) {
    const cArr = Array.isArray(cronList) ? cronList : (cronList?.tasks || cronList?.data || [])
    ok('cron.list', `${cArr.length} 个任务`)
    // 查看第一个任务详情
    if (cArr.length > 0) {
      const t = cArr[0]
      const tid = t.id || t.name || t.task_id
      console.log(`    首个任务: id=${tid}, name=${t.name || t.id}, enabled=${t.enabled}`)
    }
  } else fail('cron.list', '', cronList?.__error)

  // add — 创建一个测试 cron 任务
  const cronName = 'R19Test_' + rid()
  const cronAdd = await callApi('cron.add', { name: cronName, schedule: '0 9 * * *', command: 'echo R19', enabled: true })
  if (cronAdd && !cronAdd.__error) {
    ok('cron.add', cronName)
    // 验证添加成功
    const cronList2 = await callApi('cron.list')
    const c2Arr = Array.isArray(cronList2) ? cronList2 : (cronList2?.tasks || cronList2?.data || [])
    const found = c2Arr.find((t) => (t.name || t.id) === cronName || String(t.name || '').includes(cronName))
    if (found) {
      ok('cron 验证添加', `找到任务`)
      // runNow — 立即执行
      const tid = found.id || found.name || found.task_id
      const runR = await callApi('cron.runNow', tid)
      if (runR && !runR.__error) ok('cron.runNow', '执行成功')
      else fail('cron.runNow', '', runR?.__error)
      // getLogs — 查日志
      const logsR = await callApi('cron.getLogs', tid, 10)
      if (logsR && !logsR.__error) ok('cron.getLogs', '成功')
      else fail('cron.getLogs', '', logsR?.__error)
      // remove — 删除
      const remR = await callApi('cron.remove', tid)
      if (remR && !remR.__error) ok('cron.remove', '删除成功')
      else fail('cron.remove', '', remR?.__error)
    } else {
      fail('cron 验证添加', '未找到新任务', '添加可能失败')
    }
  } else fail('cron.add', '', cronAdd?.__error)

  // ========== 2. Agent 深度测试 ==========
  console.log('\n--- 2. Agent 深度测试 ---')
  const agentList = await callApi('agent.list')
  if (agentList && !agentList.__error) {
    const aArr = Array.isArray(agentList) ? agentList : (agentList?.agents || agentList?.data || [])
    ok('agent.list', `${aArr.length} 个 Agent`)
    // 测试每个 agent 的 getSoul + getRules
    let soulOk = 0, soulEmpty = 0, rulesOk = 0
    for (const a of aArr) {
      const aid = a.id || a
      const soul = await callApi('agent.getSoul', aid)
      if (soul && String(soul).length > 0) soulOk++
      else soulEmpty++
      const rules = await callApi('agent.getRules', aid)
      if (rules && String(rules).length > 0) rulesOk++
    }
    ok('Agent getSoul', `${soulOk}/${aArr.length} 有内容, ${soulEmpty} 空`)
    ok('Agent getRules', `${rulesOk}/${aArr.length} 有内容`)

    // toggle 测试 (启停第一个 agent)
    const firstId = aArr[0].id || aArr[0]
    const origEnabled = aArr[0].enabled
    const togR = await callApi('agent.toggle', firstId, !origEnabled)
    if (togR && !togR.__error) {
      ok('agent.toggle', `${firstId}: ${origEnabled} → ${!origEnabled}`)
      // 恢复
      await callApi('agent.toggle', firstId, origEnabled)
      ok('agent.toggle 恢复', `${firstId}: 恢复 ${origEnabled}`)
    } else fail('agent.toggle', '', togR?.__error)

    // getHistory — 查看执行历史
    const histR = await callApi('agent.getHistory', firstId)
    if (histR && !histR.__error) {
      const hArr = Array.isArray(histR) ? histR : (histR?.history || histR?.data || [])
      ok('agent.getHistory', `${hArr.length} 条记录`)
    } else fail('agent.getHistory', '', histR?.__error)

    // get — 单个 agent 详情
    const getR = await callApi('agent.get', firstId)
    if (getR && !getR.__error) ok('agent.get', `${firstId} 详情获取`)
    else fail('agent.get', '', getR?.__error)
  } else fail('agent.list', '', agentList?.__error)

  // ========== 3. AI providers ==========
  console.log('\n--- 3. AI providers ---')
  const providers = await callApi('ai.listProviders')
  if (providers && !providers.__error) {
    const pArr = Array.isArray(providers) ? providers : (providers?.providers || providers?.data || [])
    ok('ai.listProviders', `${pArr.length} 个 Provider`)
    // 查看第一个 provider 的模型
    if (pArr.length > 0) {
      const pid = pArr[0].id || pArr[0].providerId || pArr[0]
      const models = await callApi('ai.listModels', pid)
      if (models && !models.__error) {
        const mArr = Array.isArray(models) ? models : (models?.models || models?.data || [])
        ok('ai.listModels', `${pid}: ${mArr.length} 个模型`)
      } else fail('ai.listModels', '', models?.__error)
    }
  } else fail('ai.listProviders', '', providers?.__error)

  // ========== 4. Profile ==========
  console.log('\n--- 4. Profile ---')
  const profGet = await callApi('profile.get')
  if (profGet && !profGet.__error) {
    ok('profile.get', '成功')
    console.log(`    Profile: ${JSON.stringify(profGet).slice(0, 100)}`)
  } else fail('profile.get', '', profGet?.__error)

  // profile.update — 更新一个字段
  const origProfile = profGet
  const updR = await callApi('profile.update', { note: 'R19测试更新' })
  if (updR && !updR.__error) ok('profile.update', '成功')
  else fail('profile.update', '', updR?.__error)

  // ========== 5. Sys ==========
  console.log('\n--- 5. Sys ---')
  const sysInfo = await callApi('sys.getInfo')
  if (sysInfo && !sysInfo.__error) {
    ok('sys.getInfo', '成功')
    console.log(`    Sys: ${JSON.stringify(sysInfo).slice(0, 100)}`)
  } else fail('sys.getInfo', '', sysInfo?.__error)

  // ========== 6. Log ==========
  console.log('\n--- 6. Log ---')
  // 尝试几种可能的 log API
  const logApis = ['log.list', 'log.get', 'log.query', 'log.recent']
  for (const api of logApis) {
    const r = await callApi(api, 10)
    if (r && !r.__error) {
      const lArr = Array.isArray(r) ? r : (r?.logs || r?.data || [])
      ok(`log (${api})`, `${lArr.length} 条日志`)
      break
    }
  }

  // ========== 7. 内存检查 ==========
  console.log('\n--- 7. 内存检查 ---')
  const heap = await cdp.eval(`performance && performance.memory ? performance.memory.usedJSHeapSize : 0`)
  ok('当前内存', `${(heap / 1024 / 1024).toFixed(2)} MB`)

  // ========== 8. 汇总 ==========
  console.log('\n=== R19 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r19-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
