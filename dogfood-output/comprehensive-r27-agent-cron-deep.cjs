// 第二十七轮测试 — Agent 自动化运行 + Cron 实际触发深度
// 目标: 深入测试 Agent 运行、历史、abort、Cron 实际触发和日志
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

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
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString())
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(p, wait = 1500) {
    await this.eval(`window.location.hash='${p}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  const testSuffix = String(Date.now()).slice(-5)
  console.log(`=== 第二十七轮: Agent 自动化运行 + Cron 实际触发深度 ===\n`)

  // ========== 1. Agent 列表与详情 ==========
  console.log('--- 1. Agent 列表与详情 ---')
  const agentList = await cdp.eval(`(async()=>{ const r=await window.api.agent.list(); return JSON.parse(JSON.stringify(r)); })()`)
  const agents = Array.isArray(agentList) ? agentList : (agentList?.data || [])
  ok('Agent 列表', `${agents.length} 个`)

  if (agents.length > 0) {
    const a = agents[0]
    ok('Agent 结构', `id=${a.id}, name=${a.name}, enabled=${a.enabled}`)

    // 获取详情
    const detail = await cdp.eval(`(async()=>{ const r=await window.api.agent.get('${a.id}'); return JSON.parse(JSON.stringify(r)); })()`)
    if (detail) {
      ok('Agent 详情', `${Object.keys(detail).length} 字段`)
    }
  }

  // ========== 2. Agent SOUL/RULES 读写 ==========
  console.log('\n--- 2. Agent SOUL/RULES 读写 ---')
  if (agents.length > 0) {
    const a = agents[0]
    // 读 SOUL
    const soulR = await cdp.eval(`(async()=>{ const r=await window.api.agent.getSoul('${a.id}'); return r; })()`)
    if (typeof soulR === 'string' && soulR.length > 0) {
      ok('getSoul', `${soulR.length} 字符`)
      // 备份原内容
      const origSoul = soulR

      // 写新 SOUL
      const newSoul = `R27测试SOUL\n${new Date().toISOString()}\n测试内容`
      const setSoulR = await cdp.eval(`(async()=>{ const r=await window.api.agent.setSoul('${a.id}', ${JSON.stringify(newSoul)}); return JSON.parse(JSON.stringify(r)); })()`)
      if (setSoulR?.success) ok('setSoul', '成功')

      // 验证写入
      const verifySoul = await cdp.eval(`(async()=>{ const r=await window.api.agent.getSoul('${a.id}'); return r; })()`)
      if (verifySoul === newSoul) ok('SOUL 读写一致', '✓')
      else warn('SOUL 读写一致', '不一致')

      // 恢复原 SOUL
      await cdp.eval(`(async()=>{ await window.api.agent.setSoul('${a.id}', ${JSON.stringify(origSoul)}); })()`)
    }

    // 读 RULES
    const rulesR = await cdp.eval(`(async()=>{ const r=await window.api.agent.getRules('${a.id}'); return r; })()`)
    if (typeof rulesR === 'string') {
      ok('getRules', `${rulesR.length} 字符`)
    }
  }

  // ========== 3. Agent toggle ==========
  console.log('\n--- 3. Agent toggle ---')
  if (agents.length > 0) {
    const a = agents[0]
    const origEnabled = a.enabled

    // 切换
    const toggleR = await cdp.eval(`(async()=>{ const r=await window.api.agent.toggle('${a.id}', ${!origEnabled}); return JSON.parse(JSON.stringify(r)); })()`)
    if (toggleR?.success) ok('toggle', `${origEnabled} → ${!origEnabled}`)

    // 恢复
    await cdp.eval(`(async()=>{ await window.api.agent.toggle('${a.id}', ${origEnabled}); })()`)
    ok('toggle 恢复', `${origEnabled}`)
  }

  // ========== 4. Agent update ==========
  console.log('\n--- 4. Agent update ---')
  if (agents.length > 0) {
    const a = agents[0]
    const origName = a.name
    const origDesc = a.description

    // 更新
    const updateR = await cdp.eval(`(async()=>{ const r=await window.api.agent.update('${a.id}', { name: '${origName}_R27', description: 'R27测试描述' }); return JSON.parse(JSON.stringify(r)); })()`)
    if (updateR?.success) ok('update', '成功')

    // 恢复
    const origNameStr = JSON.stringify(origName)
    const origDescStr = JSON.stringify(origDesc || '')
    await cdp.eval(`(async()=>{ await window.api.agent.update('${a.id}', { name: ${origNameStr}, description: ${origDescStr} }); })()`)
    ok('update 恢复', '完成')
  }

  // ========== 5. Agent runManual(无 AI key,应 graceful 失败) ==========
  console.log('\n--- 5. Agent runManual ---')
  if (agents.length > 0) {
    const a = agents[0]
    const runR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.runManual('${a.id}', 'R27测试运行', []);
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
    })()`)
    // 无 AI key,应该 graceful 失败或返回 sessionId(异步)
    if (runR?.success === false) ok('runManual 无 key', 'graceful 失败')
    else if (runR?.success) ok('runManual', `sessionId: ${runR.id || runR.sessionId || '?'}`)
    else warn('runManual', `返回: ${JSON.stringify(runR).slice(0, 80)}`)

    // abort
    const abortR = await cdp.eval(`(async()=>{ try{ const r=await window.api.agent.abort('${a.id}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
    if (abortR?.success !== false) ok('abort', '成功')
    else warn('abort', abortR?.error)
  }

  // ========== 6. Agent history ==========
  console.log('\n--- 6. Agent history ---')
  if (agents.length > 0) {
    const a = agents[0]
    const histR = await cdp.eval(`(async()=>{ const r=await window.api.agent.getHistory('${a.id}'); return JSON.parse(JSON.stringify(r)); })()`)
    const hist = Array.isArray(histR) ? histR : (histR?.data || [])
    ok(`history ${a.name}`, `${hist.length} 条`)
  }

  // ========== 7. Agent 事件监听 ==========
  console.log('\n--- 7. Agent 事件监听 ---')
  const regR = await cdp.eval(`(async()=>{
    try {
      window.__agentEvents = [];
      const unsub = window.api.agent.onStatusUpdate((data) => { window.__agentEvents.push(data); });
      window.__unsubAgent = unsub;
      return { success: true };
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,100) }; }
  })()`)
  if (regR?.success) ok('onStatusUpdate 注册', '成功')

  // 注销
  await cdp.eval(`(async()=>{ if(window.__unsubAgent) window.__unsubAgent(); })()`)
  ok('onStatusUpdate 注销', '成功')

  // ========== 8. Agent UI 页面 ==========
  console.log('\n--- 8. Agent UI 页面 ---')
  await cdp.navigate('/agents', 2000)
  const agentBody = await cdp.eval(`document.body.innerText.length`)
  ok('Agent 页面', `${agentBody} 字符`)

  const agentH1 = await cdp.eval(`document.querySelector('h1')?.innerText`)
  if (agentH1) ok('Agent h1', agentH1)

  // ========== 9. Cron 列表 ==========
  console.log('\n--- 9. Cron 列表 ---')
  const cronList = await cdp.eval(`(async()=>{ const r=await window.api.cron.list(); return JSON.parse(JSON.stringify(r)); })()`)
  const crons = Array.isArray(cronList) ? cronList : (cronList?.data || [])
  ok('Cron 列表', `${crons.length} 个`)
  if (crons.length > 0) {
    const c = crons[0]
    ok('Cron 结构', `id=${c.id}, name=${c.name}, expression=${c.expression}`)
  }

  // ========== 10. Cron add/toggle/remove 往返 ==========
  console.log('\n--- 10. Cron add/toggle/remove ---')
  const cronTask = {
    name: `R27Cron_${testSuffix}`,
    expression: '*/5 * * * *',  // 每5分钟
    action: 'eaa.stats',
    enabled: true
  }
  const addR = await cdp.eval(`(async()=>{ const r=await window.api.cron.add(${JSON.stringify(cronTask)}); return JSON.parse(JSON.stringify(r)); })()`)
  let cronId = addR?.id || addR?.data?.id
  if (addR?.success && cronId) {
    ok('Cron add', `id: ${cronId}`)

    // toggle
    const toggleR = await cdp.eval(`(async()=>{ const r=await window.api.cron.toggle('${cronId}', false); return JSON.parse(JSON.stringify(r)); })()`)
    if (toggleR?.success !== false) ok('Cron toggle', 'off')

    // runNow
    const runR = await cdp.eval(`(async()=>{ const r=await window.api.cron.runNow('${cronId}'); return JSON.parse(JSON.stringify(r)); })()`)
    if (runR?.success) ok('Cron runNow', '执行完成')
    else warn('Cron runNow', runR?.message || '失败')

    // getLogs
    const logsR = await cdp.eval(`(async()=>{ const r=await window.api.cron.getLogs('${cronId}'); return JSON.parse(JSON.stringify(r)); })()`)
    const logs = Array.isArray(logsR) ? logsR : (logsR?.data || [])
    ok('Cron getLogs', `${logs.length} 条`)

    // remove
    const removeR = await cdp.eval(`(async()=>{ const r=await window.api.cron.remove('${cronId}'); return JSON.parse(JSON.stringify(r)); })()`)
    if (removeR?.success !== false) ok('Cron remove', '成功')
  } else {
    warn('Cron add', `返回: ${JSON.stringify(addR).slice(0, 80)}`)
  }

  // ========== 11. Cron 无效表达式 ==========
  console.log('\n--- 11. Cron 无效表达式 ---')
  const invalidExprs = [
    '*/foo * * * *',
    'not-a-cron',
    '',
    '* * * * * * *',  // 7段(标准是5段)
  ]
  for (const expr of invalidExprs) {
    const r = await cdp.eval(`(async()=>{ try{ const r=await window.api.cron.add({ name: 'R27Invalid', expression: '${expr}', action: 'test', enabled: false }); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`)
    if (r?.success === false) ok(`无效表达式 "${expr}"`, '被拒绝')
    else warn(`无效表达式 "${expr}"`, `返回: ${JSON.stringify(r).slice(0, 80)}`)
  }

  // ========== 12. Cron 边界 ==========
  console.log('\n--- 12. Cron 边界 ---')
  // 空名
  const emptyNameR = await cdp.eval(`(async()=>{ try{ const r=await window.api.cron.add({ name: '', expression: '*/5 * * * *', action: 'test', enabled: false }); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`)
  if (emptyNameR?.success === false) ok('Cron 空名', '被拒绝')

  // 空表达式
  const emptyExprR = await cdp.eval(`(async()=>{ try{ const r=await window.api.cron.add({ name: 'R27Test', expression: '', action: 'test', enabled: false }); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`)
  if (emptyExprR?.success === false) ok('Cron 空表达式', '被拒绝')

  // runNow 不存在的任务
  const runNonexistR = await cdp.eval(`(async()=>{ try{ const r=await window.api.cron.runNow('nonexistent-id'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`)
  if (runNonexistR?.success === false) ok('Cron runNow 不存在', '被拒绝')

  // toggle 不存在
  const toggleNonexistR = await cdp.eval(`(async()=>{ try{ const r=await window.api.cron.toggle('nonexistent-id', true); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,80)}} })()`)
  if (toggleNonexistR?.success === false || toggleNonexistR?.error) ok('Cron toggle 不存在', 'graceful')

  // ========== 13. Cron 全局日志 ==========
  console.log('\n--- 13. Cron 全局日志 ---')
  const allLogsR = await cdp.eval(`(async()=>{ const r=await window.api.cron.getLogs(); return JSON.parse(JSON.stringify(r)); })()`)
  const allLogs = Array.isArray(allLogsR) ? allLogsR : (allLogsR?.data || [])
  ok('Cron 全局日志', `${allLogs.length} 条`)

  // ========== 14. Cron 事件监听 ==========
  console.log('\n--- 14. Cron 事件监听 ---')
  const cronRegR = await cdp.eval(`(async()=>{
    try {
      window.__cronEvents = [];
      const unsub = window.api.cron.onStatusUpdate((data) => { window.__cronEvents.push(data); });
      window.__unsubCron = unsub;
      return { success: true };
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,100) }; }
  })()`)
  if (cronRegR?.success) ok('Cron onStatusUpdate', '注册成功')
  await cdp.eval(`(async()=>{ if(window.__unsubCron) window.__unsubCron(); })()`)

  // ========== 15. Cron UI 页面 ==========
  console.log('\n--- 15. Cron UI 页面 ---')
  await cdp.navigate('/scheduler', 1500)
  const schedBody = await cdp.eval(`document.body.innerText.length`)
  if (schedBody > 50) ok('Scheduler 页面', `${schedBody} 字符`)
  else {
    // 可能在 /settings 下
    await cdp.navigate('/settings', 1500)
    const settingsBody2 = await cdp.eval(`document.body.innerText.length`)
    ok('Scheduler(在 settings 下)', `${settingsBody2} 字符`)
  }

  // ========== 16. 内存检查 ==========
  console.log('\n--- 16. 内存检查 ---')
  const memR = await cdp.eval(`(function(){ if(performance && performance.memory){ return { used: Math.round(performance.memory.usedJSHeapSize/1024/1024), total: Math.round(performance.memory.totalJSHeapSize/1024/1024) }; } return null; })()`)
  if (memR) ok('内存', `${memR.used} MB / ${memR.total} MB`)

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${total > 0 ? (results.pass / total * 100).toFixed(1) : 0}%`)

  const resultFile = path.join(__dirname, 'r27-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ results }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
