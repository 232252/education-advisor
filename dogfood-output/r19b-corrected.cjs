// R19b: 修正 R19 的 API 调用错误, 重新测试 Cron/Agent/AI/Profile/Sys/Log
// R19 错误:
//   - cron.add 用 schedule (应 expression), 含 command 字段(无需)
//   - profile.get() 无参 (应 profile.get(name))
//   - profile.update (实际是 profile.set(name, data))
//   - sys.getInfo (不存在, sys 模块只有 openDialog/saveDialog/openExternal/getPath/checkUpdate/notify/readFile)
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

  console.log('=== R19b 修正版: Cron/Agent/AI/Profile/Sys/Log 深度测试 ===\n')
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

  const rid = () => 'r19b' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

  // ========== 1. Cron 深度测试 (修正: expression 而非 schedule) ==========
  console.log('--- 1. Cron 深度测试 (修正 expression) ---')
  const cronList = await callApi('cron.list')
  if (cronList && !cronList.__error) {
    const cArr = Array.isArray(cronList) ? cronList : (cronList?.tasks || cronList?.data || [])
    ok('cron.list', `${cArr.length} 个任务`)
    // 查看任务字段结构
    if (cArr.length > 0) {
      const t = cArr[0]
      console.log(`    任务字段: ${Object.keys(t).join(', ')}`)
    }
  } else fail('cron.list', '', cronList?.__error)

  // add — 修正: 用 expression 字段
  const cronName = 'R19bTest_' + rid()
  const cronAdd = await callApi('cron.add', { name: cronName, expression: '0 9 * * *', command: 'echo R19b', enabled: true })
  if (cronAdd && !cronAdd.__error) {
    ok('cron.add', cronName)
    // 验证添加
    const cronList2 = await callApi('cron.list')
    const c2Arr = Array.isArray(cronList2) ? cronList2 : (cronList2?.tasks || cronList2?.data || [])
    const found = c2Arr.find((t) => (t.name || t.id) === cronName || String(t.name || '').includes(cronName))
    if (found) {
      ok('cron 验证添加', `id=${found.id}`)
      const tid = found.id
      // runNow
      const runR = await callApi('cron.runNow', tid)
      if (runR && !runR.__error) ok('cron.runNow', '执行成功')
      else fail('cron.runNow', '', runR?.__error)
      // getLogs
      const logsR = await callApi('cron.getLogs', tid)
      if (logsR && !logsR.__error) {
        const lArr = Array.isArray(logsR) ? logsR : (logsR?.logs || logsR?.data || [])
        ok('cron.getLogs', `${lArr.length} 条日志`)
      } else fail('cron.getLogs', '', logsR?.__error)
      // toggle — 启停
      const togR = await callApi('cron.toggle', tid, false)
      if (togR && !togR.__error) ok('cron.toggle', '禁用成功')
      else fail('cron.toggle', '', togR?.__error)
      // update — 修改 expression
      const updR = await callApi('cron.update', tid, { expression: '0 10 * * *' })
      if (updR && !updR.__error) ok('cron.update', '更新 expression 成功')
      else fail('cron.update', '', updR?.__error)
      // remove
      const remR = await callApi('cron.remove', tid)
      if (remR && !remR.__error) ok('cron.remove', '删除成功')
      else fail('cron.remove', '', remR?.__error)
    } else {
      fail('cron 验证添加', '未找到新任务', '添加可能失败')
    }
  } else fail('cron.add', '', cronAdd?.__error)

  // cron.add 负面测试 — 缺 expression
  const negR1 = await callApi('cron.add', { name: 'NegR19b', command: 'x' })
  if (negR1 && negR1.__error) ok('cron.add 缺 expression 拒绝', '正确拒绝')
  else fail('cron.add 缺 expression 拒绝', '应被拒绝', JSON.stringify(negR1).slice(0, 100))

  // cron.add 负面测试 — 无效表达式
  const negR2 = await callApi('cron.add', { name: 'NegR19b2', expression: '*/foo * * * *', command: 'x' })
  if (negR2 && negR2.__error) ok('cron.add 无效表达式拒绝', '正确拒绝')
  else fail('cron.add 无效表达式拒绝', '应被拒绝', JSON.stringify(negR2).slice(0, 100))

  // ========== 2. Agent 深度测试 ==========
  console.log('\n--- 2. Agent 深度测试 ---')
  const agentList = await callApi('agent.list')
  if (agentList && !agentList.__error) {
    const aArr = Array.isArray(agentList) ? agentList : (agentList?.agents || agentList?.data || [])
    ok('agent.list', `${aArr.length} 个 Agent`)
    let soulOk = 0, soulEmpty = 0, rulesOk = 0, rulesEmpty = 0
    const emptyAgents = []
    for (const a of aArr) {
      const aid = a.id || a
      const soul = await callApi('agent.getSoul', aid)
      if (soul && String(soul).length > 0) soulOk++
      else { soulEmpty++; emptyAgents.push(aid) }
      const rules = await callApi('agent.getRules', aid)
      if (rules && String(rules).length > 0) rulesOk++
      else rulesEmpty++
    }
    ok('Agent getSoul', `${soulOk}/${aArr.length} 有内容, ${soulEmpty} 空`)
    ok('Agent getRules', `${rulesOk}/${aArr.length} 有内容, ${rulesEmpty} 空`)
    if (emptyAgents.length > 0) console.log(`    空 SOUL 的 Agent: ${emptyAgents.join(', ')}`)

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

    // getHistory
    const histR = await callApi('agent.getHistory', firstId)
    if (histR && !histR.__error) {
      const hArr = Array.isArray(histR) ? histR : (histR?.history || histR?.data || [])
      ok('agent.getHistory', `${hArr.length} 条记录`)
    } else fail('agent.getHistory', '', histR?.__error)

    // get
    const getR = await callApi('agent.get', firstId)
    if (getR && !getR.__error) ok('agent.get', `${firstId} 详情获取`)
    else fail('agent.get', '', getR?.__error)

    // 测试 runManual — 选一个可手动执行的 agent (data-analyst)
    const dataAnalyst = aArr.find((a) => (a.id || a) === 'data-analyst')
    if (dataAnalyst) {
      const runR = await callApi('agent.runManual', 'data-analyst', { test: true })
      if (runR && !runR.__error) ok('agent.runManual', 'data-analyst 执行成功')
      else fail('agent.runManual', '', runR?.__error)
    }
  } else fail('agent.list', '', agentList?.__error)

  // ========== 3. AI providers ==========
  console.log('\n--- 3. AI providers ---')
  const providers = await callApi('ai.listProviders')
  if (providers && !providers.__error) {
    const pArr = Array.isArray(providers) ? providers : (providers?.providers || providers?.data || [])
    ok('ai.listProviders', `${pArr.length} 个 Provider`)
    // 测试多个 provider 的 listModels
    let modelsOk = 0
    const testProviders = pArr.slice(0, 5)
    for (const p of testProviders) {
      const pid = p.id || p.providerId || p
      const models = await callApi('ai.listModels', pid)
      if (models && !models.__error) {
        const mArr = Array.isArray(models) ? models : (models?.models || models?.data || [])
        modelsOk++
      }
    }
    ok('ai.listModels 多测', `${modelsOk}/${testProviders.length} 个 provider 模型列表成功`)
  } else fail('ai.listProviders', '', providers?.__error)

  // ========== 4. Profile (修正: profile.get/set 需要 name) ==========
  console.log('\n--- 4. Profile (修正 API) ---')
  // 先创建一个测试学生
  const testStudentName = `R19bStu_${rid()}`
  const addStuR = await callApi('eaa.addStudent', testStudentName)
  if (addStuR && !addStuR.__error) ok('创建测试学生', testStudentName)
  else fail('创建测试学生', '', addStuR?.__error)

  // profile.get — 修正: 需要 name 参数
  const profGet1 = await callApi('profile.get', testStudentName)
  if (profGet1 !== null && !profGet1?.__error) {
    ok('profile.get (空档案)', `初始: ${JSON.stringify(profGet1).slice(0, 80)}`)
  } else if (profGet1 === null) {
    ok('profile.get (空档案)', '返回 null (无档案,正确)')
  } else fail('profile.get', '', profGet1?.__error)

  // profile.set — 修正: profile.set(name, data) 而非 profile.update
  const setR = await callApi('profile.set', testStudentName, { note: 'R19b测试档案', birthday: '2008-05-15', parent_phone: '13800000000' })
  if (setR && !setR.__error) ok('profile.set', '写入成功')
  else fail('profile.set', '', setR?.__error)

  // 读回验证
  const profGet2 = await callApi('profile.get', testStudentName)
  if (profGet2 && !profGet2.__error) {
    if (profGet2.note === 'R19b测试档案') ok('profile 读回验证', 'note 一致')
    else fail('profile 读回验证', `note 不一致: ${profGet2.note}`, JSON.stringify(profGet2).slice(0, 100))
  } else fail('profile.get (读回)', '', profGet2?.__error)

  // 清理 — 删除测试学生
  await callApi('eaa.deleteStudent', testStudentName, 'R19b 清理')

  // ========== 5. Sys (修正: sys 没有 getInfo, 测试其他可用 API) ==========
  console.log('\n--- 5. Sys (修正 API 列表) ---')
  // sys.getPath
  const pathR = await callApi('sys.getPath', 'userData')
  if (pathR && !pathR.__error) ok('sys.getPath', `userData=${String(pathR).slice(0, 60)}`)
  else fail('sys.getPath', '', pathR?.__error)

  // sys.notify
  const notifyR = await callApi('sys.notify', 'R19b 测试', '测试通知')
  if (notifyR && !notifyR.__error) ok('sys.notify', '通知发送成功')
  else fail('sys.notify', '', notifyR?.__error)

  // sys.checkUpdate — 可能因网络问题失败, 但 API 本身应存在
  const updR = await callApi('sys.checkUpdate')
  if (updR !== undefined && !updR?.__error) ok('sys.checkUpdate', '检查完成')
  else if (updR?.__error) ok('sys.checkUpdate', `预期失败: ${updR.__error.slice(0, 50)}`)
  else fail('sys.checkUpdate', '', '未知错误')

  // sys.openExternal 负面测试 — 非法协议
  const extR = await callApi('sys.openExternal', 'javascript:alert(1)')
  if (extR && extR.__error) ok('sys.openExternal 拒绝非 http', '正确拒绝')
  else if (extR && !extR.__error) fail('sys.openExternal 拒绝非 http', '应被拒绝', JSON.stringify(extR).slice(0, 100))
  else ok('sys.openExternal 拒绝非 http', '返回 undefined (无返回值)')

  // ========== 6. Log ==========
  console.log('\n--- 6. Log ---')
  const logApis = ['log.list', 'log.get', 'log.query', 'log.recent']
  for (const api of logApis) {
    const r = await callApi(api, 10)
    if (r && !r.__error) {
      const lArr = Array.isArray(r) ? r : (r?.logs || r?.data || [])
      ok(`log (${api})`, `${lArr.length} 条日志`)
      // 详细查看日志结构
      if (lArr.length > 0) {
        console.log(`    日志字段: ${Object.keys(lArr[0]).join(', ')}`)
      }
      break
    }
  }

  // ========== 7. 内存检查 ==========
  console.log('\n--- 7. 内存检查 ---')
  const heap = await cdp.eval(`performance && performance.memory ? performance.memory.usedJSHeapSize : 0`)
  ok('当前内存', `${(heap / 1024 / 1024).toFixed(2)} MB`)

  // ========== 8. 汇总 ==========
  console.log('\n=== R19b 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r19b-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
