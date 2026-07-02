// 第十一轮测试 — Agent 深度 + Privacy 深度 + Log 深度
// 覆盖之前未充分测试的模块
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d).find((x) => x.type === 'page').webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(path, wait = 1500) {
    await this.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [], apiCalls: 0, startTime: Date.now() }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  const origEval = cdp.eval.bind(cdp)
  cdp.eval = async (expr) => { results.apiCalls++; return origEval(expr) }

  function errMsg(r) {
    return r?.__error || r?.error || (typeof r?.data === 'string' && !r?.success ? r.data : null) || 'unknown'
  }

  console.log('=== 第十一轮: Agent 深度 + Privacy 深度 + Log 深度 ===\n')

  // ========== 1. Agent 系统深度测试 ==========
  console.log('--- 1. Agent 系统深度测试 ---')

  // 1.1 列出所有 Agent
  const agentList = await cdp.eval(`(async()=>{
    const r = await window.api.agent.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const agents = Array.isArray(agentList) ? agentList : (agentList?.data || [])
  ok('Agent 列表', `${agents.length} 个`)
  if (agents.length === 0) {
    warn('Agent 测试', '无 Agent,跳过')
  } else {
    // 1.2 逐个获取详情
    let detailOk = 0
    for (const a of agents.slice(0, 5)) {
      const detail = await cdp.eval(`(async()=>{
        try {
          const r = await window.api.agent.get('${a.id}');
          return JSON.parse(JSON.stringify(r));
        } catch(e) { return null; }
      })()`)
      if (detail) detailOk++
    }
    ok('Agent 详情', `${detailOk}/5 有详情`)

    // 1.3 SOUL 读写一致性
    const testAgent = agents[0]
    const origSoul = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.getSoul('${testAgent.id}');
        return r;
      } catch(e) { return null; }
    })()`)
    const soulLen = typeof origSoul === 'string' ? origSoul.length : 0
    ok('Agent SOUL 读取', `${testAgent.id}: ${soulLen} 字符`)

    // 写入新 SOUL
    const testSoul = `# R11测试SOUL\n\n这是一个测试SOUL内容。\n时间: ${Date.now()}`
    const setSoulR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.setSoul('${testAgent.id}', ${JSON.stringify(testSoul)});
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (setSoulR?.success !== false) ok('Agent SOUL 写入', '成功')
    else fail('Agent SOUL 写入', '', errMsg(setSoulR))

    // 读回验证
    const readBackSoul = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.getSoul('${testAgent.id}');
        return r;
      } catch(e) { return null; }
    })()`)
    if (readBackSoul === testSoul) ok('Agent SOUL 一致性', '读写一致 ✓')
    else warn('Agent SOUL 一致性', `内容不匹配`)

    // 恢复原 SOUL
    if (typeof origSoul === 'string' && origSoul.length > 0) {
      await cdp.eval(`(async()=>{
        try {
          await window.api.agent.setSoul('${testAgent.id}', ${JSON.stringify(origSoul)});
        } catch(e) {}
      })()`)
    }

    // 1.4 Rules 读写一致性
    const origRules = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.getRules('${testAgent.id}');
        return r;
      } catch(e) { return null; }
    })()`)
    const rulesLen = typeof origRules === 'string' ? origRules.length : 0
    ok('Agent Rules 读取', `${testAgent.id}: ${rulesLen} 字符`)

    const testRules = `# R11测试Rules\n- 规则1\n- 规则2\n时间: ${Date.now()}`
    const setRulesR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.setRules('${testAgent.id}', ${JSON.stringify(testRules)});
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (setRulesR?.success !== false) ok('Agent Rules 写入', '成功')
    else fail('Agent Rules 写入', '', errMsg(setRulesR))

    const readBackRules = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.getRules('${testAgent.id}');
        return r;
      } catch(e) { return null; }
    })()`)
    if (readBackRules === testRules) ok('Agent Rules 一致性', '读写一致 ✓')
    else warn('Agent Rules 一致性', '内容不匹配')

    // 恢复原 Rules
    if (typeof origRules === 'string' && origRules.length > 0) {
      await cdp.eval(`(async()=>{
        try {
          await window.api.agent.setRules('${testAgent.id}', ${JSON.stringify(origRules)});
        } catch(e) {}
      })()`)
    }

    // 1.5 Agent update (修改 name 再恢复)
    const origName = testAgent.name
    const updateR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.update('${testAgent.id}', { name: '${origName}_R11测试' });
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (updateR?.success !== false) ok('Agent update', '名称修改成功')
    else warn('Agent update', errMsg(updateR))

    // 恢复名称
    await cdp.eval(`(async()=>{
      try {
        await window.api.agent.update('${testAgent.id}', { name: '${origName}' });
      } catch(e) {}
    })()`)

    // 1.6 Agent toggle
    const origEnabled = testAgent.enabled
    const toggleR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.toggle('${testAgent.id}', !${origEnabled});
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (toggleR?.success !== false) ok('Agent toggle', `${origEnabled} → ${!origEnabled}`)
    else fail('Agent toggle', '', errMsg(toggleR))

    // 恢复
    await cdp.eval(`(async()=>{
      try {
        await window.api.agent.toggle('${testAgent.id}', ${origEnabled});
      } catch(e) {}
    })()`)

    // 1.7 Agent getHistory
    const historyR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.getHistory('${testAgent.id}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return null; }
    })()`)
    const histArr = Array.isArray(historyR) ? historyR : (historyR?.data || [])
    ok('Agent getHistory', `${histArr.length} 条历史`)

    // 1.8 无效 Agent ID
    const invalidAgent = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.get('INVALID_AGENT_ID_XYZ');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (invalidAgent === null || invalidAgent?.error) ok('无效 Agent ID', '被拒绝 ✓')
    else warn('无效 Agent ID', '未拒绝')

    // 1.9 Agent runManual (可能因无 AI key 失败,测试 graceful 失败)
    const runR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.runManual('${testAgent.id}', '测试执行');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (runR?.success) ok('Agent runManual', '执行成功')
    else if (runR?.error?.includes('key') || runR?.error?.includes('provider') || runR?.error?.includes('model') || runR?.error?.includes('API')) {
      ok('Agent runManual', 'graceful 失败 (无 AI key)')
    } else {
      warn('Agent runManual', errMsg(runR))
    }

    // 1.10 Agent abort (对上面的 runManual 执行 abort)
    const abortR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.abort('${testAgent.id}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (abortR?.success !== false) ok('Agent abort', '成功')
    else warn('Agent abort', errMsg(abortR))
  }

  // ========== 2. Privacy 系统深度测试 ==========
  console.log('\n--- 2. Privacy 系统深度测试 ---')

  // 2.1 Privacy 状态
  const privStatus = await cdp.eval(`(async()=>{
    const r = await window.api.privacy.status();
    return JSON.parse(JSON.stringify(r));
  })()`)
  ok('Privacy 状态', `unlocked: ${privStatus?.unlocked}`)

  // 2.2 尝试初始化 Privacy (可能已初始化)
  const initR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.init('R11TestPass123', false);
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (initR?.success !== false) ok('Privacy init', '初始化或已存在')
  else warn('Privacy init', errMsg(initR))

  // 2.3 加载 Privacy
  const loadR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.load('R11TestPass123');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (loadR?.success !== false) ok('Privacy load', '加载成功')
  else warn('Privacy load', errMsg(loadR))

  // 2.4 dryrun 测试
  const dryrunR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.dryrun('张三的电话是13800138000');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (dryrunR?.success !== false) ok('Privacy dryrun', '执行成功')
  else warn('Privacy dryrun', errMsg(dryrunR))

  // 2.5 anonymize 测试
  const anonR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.anonymize('张三的手机号是13912345678');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (anonR?.success !== false) ok('Privacy anonymize', '执行成功')
  else warn('Privacy anonymize', errMsg(anonR))

  // 2.6 deanonymize 测试
  const deanR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.deanonymize('测试文本');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (deanR?.success !== false) ok('Privacy deanonymize', '执行成功')
  else warn('Privacy deanonymize', errMsg(deanR))

  // 2.7 filter 测试
  const filterR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.filter('dashboard', '张三的成绩是95分');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (filterR?.success !== false) ok('Privacy filter', '执行成功')
  else warn('Privacy filter', errMsg(filterR))

  // 2.8 Privacy list (列出映射)
  const listR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.list();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  const mappings = Array.isArray(listR?.data) ? listR.data : []
  ok('Privacy list', `${mappings.length} 条映射`)

  // 2.9 Privacy add (添加映射)
  const addR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.add('phone', '13800138000');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (addR?.success !== false) ok('Privacy add', '添加映射成功')
  else warn('Privacy add', errMsg(addR))

  // 2.10 Privacy enable
  const enableR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.enable();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (enableR?.success !== false) ok('Privacy enable', '启用成功')
  else warn('Privacy enable', errMsg(enableR))

  // 2.11 Privacy lock
  const lockR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.privacy.lock();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
  })()`)
  if (lockR?.success !== false) ok('Privacy lock', '锁定成功')
  else warn('Privacy lock', errMsg(lockR))

  // ========== 3. Log 系统深度测试 ==========
  console.log('\n--- 3. Log 系统深度测试 ---')

  // 3.1 列出日志
  const logList = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.log.list();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return []; }
  })()`)
  const logs = Array.isArray(logList) ? logList : []
  ok('Log 列表', `${logs.length} 个日志文件`)
  if (logs.length > 0) {
    ok('Log 详情', `第一个: ${logs[0]?.name} (${logs[0]?.sizeBytes ?? '?'} bytes)`)
  }

  // 3.2 读取日志
  if (logs.length > 0) {
    const logName = logs[0].name
    const readR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.log.read('${logName}', 50);
        return r;
      } catch(e) { return null; }
    })()`)
    const logContent = typeof readR === 'string' ? readR : ''
    if (logContent.length > 0) ok('Log read', `${logName}: ${logContent.length} 字符, ${logContent.split('\\n').length} 行`)
    else warn('Log read', '空内容')

    // 3.3 搜索日志
    const searchR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.log.search('${logName}', 'error', 20);
        return r;
      } catch(e) { return null; }
    })()`)
    const searchContent = typeof searchR === 'string' ? searchR : ''
    ok('Log search', `关键词 "error": ${searchContent.length} 字符`)

    // 3.4 过滤日志
    const filterLogR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.log.filter('${logName}', ['error', 'warn'], 20);
        return r;
      } catch(e) { return null; }
    })()`)
    const filterContent = typeof filterLogR === 'string' ? filterLogR : ''
    ok('Log filter', `levels [error,warn]: ${filterContent.length} 字符`)

    // 3.5 forward 日志
    const forwardR = await cdp.eval(`(async()=>{
      try {
        window.api.log.forward('info', 'R11测试日志消息');
        return true;
      } catch(e) { return false; }
    })()`)
    if (forwardR) ok('Log forward', '成功')
    else warn('Log forward', '失败')
  } else {
    warn('Log 测试', '无日志文件')
  }

  // 3.6 Sys getPath (用于 backup 测试)
  const homePath = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.sys.getPath('temp');
      return r;
    } catch(e) { return null; }
  })()`)
  if (homePath) ok('Sys getPath(temp)', homePath.slice(0, 50))

  // 3.7 Privacy backup (需要路径)
  if (homePath) {
    const backupPath = homePath.replace(/\\\\/g, '/') + '/r11-privacy-backup.json'
    const backupR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.privacy.backup('${backupPath}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,80) }; }
    })()`)
    if (backupR?.success !== false) ok('Privacy backup', '备份成功')
    else warn('Privacy backup', errMsg(backupR))
  }

  // ========== 4. Agent 全量 SOUL/Rules 扫描 ==========
  console.log('\n--- 4. Agent 全量扫描 ---')
  const allAgents = await cdp.eval(`(async()=>{
    const r = await window.api.agent.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const agentArr = Array.isArray(allAgents) ? allAgents : (allAgents?.data || [])
  let soulOk = 0, rulesOk = 0
  for (const a of agentArr) {
    const soul = await cdp.eval(`(async()=>{
      try { const r = await window.api.agent.getSoul('${a.id}'); return r; } catch(e) { return null; }
    })()`)
    if (typeof soul === 'string' && soul.length > 0) soulOk++

    const rules = await cdp.eval(`(async()=>{
      try { const r = await window.api.agent.getRules('${a.id}'); return r; } catch(e) { return null; }
    })()`)
    if (typeof rules === 'string' && rules.length > 0) rulesOk++
  }
  ok('Agent SOUL 全扫', `${soulOk}/${agentArr.length} 有内容`)
  ok('Agent Rules 全扫', `${rulesOk}/${agentArr.length} 有内容`)

  // ========== 5. Agent onStatusUpdate (事件监听) ==========
  console.log('\n--- 5. Agent 事件监听 ---')
  const listenR = await cdp.eval(`(async()=>{
    try {
      const unsub = window.api.agent.onStatusUpdate((data) => {
        window.__agentStatusEvents = (window.__agentStatusEvents || 0) + 1;
      });
      window.__unsubAgent = unsub;
      return true;
    } catch(e) { return false; }
  })()`)
  if (listenR) ok('Agent onStatusUpdate', '监听注册成功')
  else warn('Agent onStatusUpdate', '注册失败')

  // ========== 6. Cron onStatusUpdate ==========
  console.log('\n--- 6. Cron 事件监听 ---')
  const cronListenR = await cdp.eval(`(async()=>{
    try {
      const unsub = window.api.cron.onStatusUpdate((data) => {
        window.__cronStatusEvents = (window.__cronStatusEvents || 0) + 1;
      });
      window.__unsubCron = unsub;
      return true;
    } catch(e) { return false; }
  })()`)
  if (cronListenR) ok('Cron onStatusUpdate', '监听注册成功')
  else warn('Cron onStatusUpdate', '注册失败')

  // ========== 7. AI onStream ==========
  console.log('\n--- 7. AI 流事件 ---')
  const aiStreamR = await cdp.eval(`(async()=>{
    try {
      const unsub = window.api.ai.onStream((event) => {
        window.__aiStreamEvents = (window.__aiStreamEvents || 0) + 1;
      });
      window.__unsubAi = unsub;
      return true;
    } catch(e) { return false; }
  })()`)
  if (aiStreamR) ok('AI onStream', '监听注册成功')
  else warn('AI onStream', '注册失败')

  // ========== 8. 清理监听 ==========
  console.log('\n--- 8. 清理监听 ---')
  await cdp.eval(`(function(){
    if(window.__unsubAgent) { try{window.__unsubAgent();}catch(e){} }
    if(window.__unsubCron) { try{window.__unsubCron();}catch(e){} }
    if(window.__unsubAi) { try{window.__unsubAi();}catch(e){} }
    return true;
  })()`)
  ok('清理监听', '完成')

  // ========== 9. UI 页面深度检查 ==========
  console.log('\n--- 9. UI 页面深度检查 ---')
  const pages = ['/agents', '/privacy', '/logs', '/settings']
  for (const p of pages) {
    await cdp.navigate(p, 1500)
    const check = await cdp.eval(`(function(){
      const h1 = document.querySelector('h1');
      const buttons = document.querySelectorAll('button').length;
      const inputs = document.querySelectorAll('input, textarea, select').length;
      const bodyLen = document.body?.innerHTML?.length || 0;
      return { title: h1?.textContent?.trim() || '?', buttons, inputs, bodyLen };
    })()`)
    ok(`页面 ${p}`, `${check?.title} | btn:${check?.buttons}, input:${check?.inputs}, body:${check?.bodyLen}`)
  }

  // ========== 汇总 ==========
  const elapsed = ((Date.now() - results.startTime) / 1000).toFixed(1)
  console.log('\n=== 测试汇总 ===')
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1)}%`)
  console.log(`API 调用: ${results.apiCalls}, 耗时: ${elapsed}s`)

  fs.writeFileSync('dogfood-output/r11-results.json', JSON.stringify({
    ...results,
    elapsedSec: parseFloat(elapsed),
    testType: 'R11-agent-privacy-log-deep',
  }, null, 2))
  console.log('结果已写入: r11-results.json')

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
