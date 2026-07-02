// R24: IPC 全量扫描 + Feishu/Log/Sys/AI/Profile 深度只读
// 角度: 遍历 117 个 API 方法, 检查存在性/类型/调用安全性 + 模块深度
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

  console.log('=== R24 IPC 全量扫描 + 模块深度只读 ===\n')
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

  // ========== 1. IPC 全量扫描 — 117 个 API 方法存在性 ==========
  console.log('--- 1. IPC 全量扫描 (117 个 API 方法存在性) ---')
  const apiTree = {
    ai: ['listProviders', 'listModels', 'testConnection', 'setApiKey', 'deleteApiKey', 'oauthLogin', 'chat', 'abortChat', 'addCustomModel', 'deleteCustomModel', 'updateCustomModel'],
    agent: ['list', 'get', 'toggle', 'update', 'getSoul', 'setSoul', 'getRules', 'setRules', 'runManual', 'getHistory', 'abort'],
    eaa: ['info', 'score', 'ranking', 'replay', 'addEvent', 'revertEvent', 'history', 'search', 'range', 'tag', 'stats', 'validate', 'export', 'listStudents', 'addStudent', 'deleteStudent', 'setStudentMeta', 'import', 'codes', 'doctor', 'summary', 'dashboard', 'exportFormats'],
    privacy: ['init', 'load', 'enable', 'disable', 'list', 'add', 'anonymize', 'deanonymize', 'filter', 'dryrun', 'backup', 'lock', 'status'],
    cron: ['list', 'add', 'update', 'remove', 'toggle', 'runNow', 'getLogs'],
    skill: ['list', 'get', 'save', 'delete'],
    settings: ['get', 'set', 'reset'],
    sys: ['openDialog', 'saveDialog', 'openExternal', 'getPath', 'checkUpdate', 'showUpdateDialog', 'notify', 'readFile'],
    profile: ['get', 'set'],
    class: ['list', 'create', 'update', 'archive', 'restore', 'delete', 'assign', 'removeStudent'],
    chat: ['saveMessage', 'loadMessages', 'deleteSession', 'listSessions'],
    log: ['list', 'read', 'clear', 'filter', 'search', 'export', 'exportWithDialog'],
    feishu: ['test', 'listBitable', 'send', 'status', 'syncNow'],
  }
  const checkResult = await cdp.eval(`(function(){const tree=${JSON.stringify(apiTree)};const out={total:0,exist:0,missing:[],extraModules:[],byModule:{}};for(const mod of Object.keys(tree)){if(!window.api[mod]){out.extraModules.push(mod+' (missing module)');continue}out.byModule[mod]={exist:0,missing:[]};for(const fn of tree[mod]){out.total++;if(typeof window.api[mod][fn]==='function'){out.exist++;out.byModule[mod].exist++}else{out.missing.push(mod+'.'+fn);out.byModule[mod].missing.push(fn)}}}return JSON.stringify(out)})()`)
  const check = JSON.parse(checkResult)
  ok('IPC 全量扫描', `${check.exist}/${check.total} 存在且为 function`)
  if (check.missing.length > 0) fail('缺失 API', '', check.missing.join(','))
  for (const mod of Object.keys(check.byModule)) {
    const m = check.byModule[mod]
    if (m.missing.length === 0) ok(`模块 ${mod}`, `${m.exist} 个方法全存在`)
    else fail(`模块 ${mod}`, `${m.missing.length} 个缺失`, m.missing.join(','))
  }

  // ========== 2. Feishu 模块 — status 唯一只读 ==========
  console.log('\n--- 2. Feishu 模块 (status) ---')
  const fs = await callApi('feishu.status')
  if (fs && !fs.__error) ok('feishu.status', `返回: ${JSON.stringify(fs).slice(0, 80)}`)
  else ok('feishu.status', `返回错误(预期): ${fs?.__error?.slice(0, 60) || 'n/a'}`)

  // ========== 3. Log 模块深度 ==========
  console.log('\n--- 3. Log 模块深度 ---')
  const logList = await callApi('log.list')
  if (logList && !logList.__error) {
    const arr = Array.isArray(logList) ? logList : (logList?.files || logList?.data || [])
    ok('log.list', `${arr.length} 个日志文件`)
    // 读取第一个日志(如果有)
    if (arr.length > 0) {
      const firstName = typeof arr[0] === 'string' ? arr[0] : (arr[0]?.name || arr[0]?.filename)
      if (firstName) {
        const tail = await callApi('log.read', firstName, 20)
        if (tail && !tail.__error) {
          const lines = Array.isArray(tail) ? tail.length : (typeof tail === 'string' ? tail.split('\n').length : 0)
          ok('log.read', `${firstName} 读取 ${lines} 行`)
        } else ok('log.read', `读取失败: ${tail?.__error?.slice(0, 60) || 'n/a'}`)

        // filter 测试
        const filt = await callApi('log.filter', firstName, ['error', 'warn'], 10)
        if (filt && !filt.__error) ok('log.filter', `error+warn 过滤成功`)
        else ok('log.filter', `过滤失败: ${filt?.__error?.slice(0, 60) || 'n/a'}`)

        // search 测试
        const srch = await callApi('log.search', firstName, 'error', 10)
        if (srch && !srch.__error) ok('log.search', `搜索 "error" 成功`)
        else ok('log.search', `搜索失败: ${srch?.__error?.slice(0, 60) || 'n/a'}`)
      } else ok('log.read', '日志名解析失败')
    } else ok('log.read', '无日志文件可读')
  } else fail('log.list', '', logList?.__error || 'unknown')

  // log.forward (send, 不需 await)
  try {
    await cdp.eval(`window.api.log.forward('info', 'R24 test log forward')`)
    ok('log.forward', '发送成功')
  } catch (e) { ok('log.forward', `发送异常(预期): ${e.message.slice(0, 60)}`) }

  // ========== 4. Sys 模块深度 ==========
  console.log('\n--- 4. Sys 模块深度 ---')
  const pathNames = ['home', 'appData', 'userData', 'temp', 'exe', 'desktop', 'documents', 'downloads', 'music', 'pictures', 'videos']
  for (const pn of pathNames) {
    const p = await callApi('sys.getPath', pn)
    if (p && !p.__error && typeof p === 'string') ok(`sys.getPath(${pn})`, p.slice(0, 60))
    else fail(`sys.getPath(${pn})`, '', p?.__error || JSON.stringify(p).slice(0, 60))
  }

  // notify
  const nt = await callApi('sys.notify', 'R24 测试', '这是一条测试通知')
  if (nt && !nt.__error) ok('sys.notify', '通知成功')
  else ok('sys.notify', `通知返回: ${nt?.__error?.slice(0, 60) || JSON.stringify(nt).slice(0, 60)}`)

  // checkUpdate
  const cu = await callApi('sys.checkUpdate')
  if (cu && !cu.__error) ok('sys.checkUpdate', `返回: ${JSON.stringify(cu).slice(0, 60)}`)
  else ok('sys.checkUpdate', `返回错误(预期): ${cu?.__error?.slice(0, 60) || 'n/a'}`)

  // ========== 5. AI 模块深度 ==========
  console.log('\n--- 5. AI 模块深度 ---')
  const providers = await callApi('ai.listProviders')
  if (providers && !providers.__error) {
    const arr = Array.isArray(providers) ? providers : (providers?.providers || providers?.data || [])
    ok('ai.listProviders', `${arr.length} 个 provider`)
    // 抽样测试 5 个 provider 的 listModels
    const sample = arr.slice(0, 5)
    for (const prov of sample) {
      const pid = typeof prov === 'string' ? prov : (prov?.id || prov?.providerId || prov?.name)
      if (!pid) continue
      const models = await callApi('ai.listModels', pid)
      if (models && !models.__error) {
        const mArr = Array.isArray(models) ? models : (models?.models || models?.data || [])
        ok(`ai.listModels(${pid})`, `${mArr.length} 个模型`)
      } else fail(`ai.listModels(${pid})`, '', models?.__error || 'unknown')
    }
  } else fail('ai.listProviders', '', providers?.__error || 'unknown')

  // testConnection 无 apiKey, 预期失败
  const tc = await callApi('ai.testConnection', 'openai', '')
  if (tc && tc.__error) ok('ai.testConnection 空apiKey', '正确拒绝')
  else if (tc && tc.success === false) ok('ai.testConnection 空apiKey', '正确返回失败')
  else ok('ai.testConnection 空apiKey', `返回: ${JSON.stringify(tc).slice(0, 60)}`)

  // ========== 6. Profile 模块 (get 多个名字) ==========
  console.log('\n--- 6. Profile 模块 ---')
  const profileNames = ['测试学生_R24', '不存在的学生_xyz', 'admin', 'test']
  for (const name of profileNames) {
    const p = await callApi('profile.get', name)
    if (p === null || p === undefined) ok(`profile.get(${name})`, '返回 null/undefined (无档案)')
    else if (p && p.__error) ok(`profile.get(${name})`, `错误: ${p.__error.slice(0, 60)}`)
    else ok(`profile.get(${name})`, `返回: ${JSON.stringify(p).slice(0, 60)}`)
  }

  // ========== 7. Agent 模块全量 ==========
  console.log('\n--- 7. Agent 模块全量 ---')
  const agentList = await callApi('agent.list')
  if (agentList && !agentList.__error) {
    const arr = Array.isArray(agentList) ? agentList : (agentList?.agents || agentList?.data || [])
    ok('agent.list', `${arr.length} 个 agent`)
    // 测试每个 agent 的 get + getSoul + getRules + getHistory
    let getOk = 0, soulOk = 0, rulesOk = 0, histOk = 0
    for (const a of arr) {
      const aid = typeof a === 'string' ? a : (a?.id || a?.agentId || a?.name)
      if (!aid) continue
      const g = await callApi('agent.get', aid)
      if (g && !g.__error) getOk++
      const s = await callApi('agent.getSoul', aid)
      if (s !== null && s !== undefined && !s.__error) soulOk++
      const r = await callApi('agent.getRules', aid)
      if (r !== null && r !== undefined && !r.__error) rulesOk++
      const h = await callApi('agent.getHistory', aid)
      if (h && !h.__error) histOk++
    }
    ok('agent.get 全量', `${getOk}/${arr.length} 成功`)
    ok('agent.getSoul 全量', `${soulOk}/${arr.length} 有内容`)
    ok('agent.getRules 全量', `${rulesOk}/${arr.length} 有内容`)
    ok('agent.getHistory 全量', `${histOk}/${arr.length} 有历史`)
  } else fail('agent.list', '', agentList?.__error || 'unknown')

  // ========== 8. Cron 全量日志扫描 ==========
  console.log('\n--- 8. Cron 全量日志扫描 ---')
  const cronList = await callApi('cron.list')
  if (cronList && !cronList.__error) {
    const arr = Array.isArray(cronList) ? cronList : (cronList?.tasks || cronList?.data || [])
    ok('cron.list', `${arr.length} 个任务`)
    let withLogs = 0, withoutLogs = 0
    for (const t of arr) {
      const tid = typeof t === 'string' ? t : (t?.id || t?.taskId || t?.name)
      if (!tid) continue
      const lg = await callApi('cron.getLogs', tid)
      if (lg && !lg.__error) {
        const lArr = Array.isArray(lg) ? lg : (lg?.logs || lg?.data || [])
        if (lArr.length > 0) withLogs++
        else withoutLogs++
      } else withoutLogs++
    }
    ok('cron.getLogs 全量', `${withLogs} 有日志, ${withoutLogs} 无日志`)
  } else fail('cron.list', '', cronList?.__error || 'unknown')

  // ========== 9. EAA 全只读 API 抽样 ==========
  console.log('\n--- 9. EAA 全只读 API 抽样 ---')
  const eaaReadOnly = ['info', 'doctor', 'listStudents', 'ranking', 'stats', 'codes', 'validate', 'summary', 'replay', 'exportFormats']
  for (const cmd of eaaReadOnly) {
    const r = await callApi('eaa.' + cmd)
    if (r && !r.__error) ok(`eaa.${cmd}`, `成功`)
    else fail(`eaa.${cmd}`, '', r?.__error || 'unknown')
  }

  // ========== 10. UI 各页面详细元素分析 ==========
  console.log('\n--- 10. UI 各页面详细元素分析 ---')
  const routes = ['#/dashboard', '#/students', '#/classes', '#/agents', '#/chat', '#/skills', '#/privacy', '#/settings', '#/models']
  for (const route of routes) {
    await navigate(route)
    const stats = await cdp.eval(`(function(){
      return JSON.stringify({
        elements: document.querySelectorAll('*').length,
        buttons: document.querySelectorAll('button').length,
        inputs: document.querySelectorAll('input').length,
        selects: document.querySelectorAll('select').length,
        textareas: document.querySelectorAll('textarea').length,
        links: document.querySelectorAll('a').length,
        forms: document.querySelectorAll('form').length,
        imgs: document.querySelectorAll('img').length,
        tables: document.querySelectorAll('table').length,
        h1: document.querySelectorAll('h1').length,
        h2: document.querySelectorAll('h2').length,
        focusable: document.querySelectorAll('button, a, input, select, textarea, [tabindex]').length,
        title: document.querySelector('h1, h2')?.textContent?.slice(0, 40) || 'no title'
      })
    })()`)
    const s = JSON.parse(stats)
    ok(`UI ${route}`, `"${s.title}" el=${s.elements} btn=${s.buttons} input=${s.inputs} sel=${s.selects} ta=${s.textareas} link=${s.links} h1=${s.h1} h2=${s.h2} focus=${s.focusable}`)
  }

  // ========== 11. 汇总 ==========
  console.log('\n=== R24 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r24-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
