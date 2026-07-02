// 第二十二轮测试 — AI provider 故障 + Chat 异常场景
// 目标: 测试 AI 模块在异常情况下的降级行为和 Chat 模块的健壮性
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
  async navigate(p, wait = 1200) {
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

  console.log(`=== 第二十二轮: AI provider 故障 + Chat 异常场景 ===\n`)

  // ========== 1. AI Provider 列表与模型 ==========
  console.log('--- 1. AI Provider 列表与模型 ---')
  const providers = await cdp.eval(`(async()=>{ try{ const r=await window.api.ai.listProviders(); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,150)}} })()`)
  if (Array.isArray(providers)) {
    ok('AI providers', `${providers.length} 个`)
    // 检查结构
    if (providers.length > 0) {
      const p = providers[0]
      ok('provider 结构', `id=${p.id}, name=${p.name}`)
    }
  } else {
    fail('AI providers', '', providers?.error || '非数组')
  }

  // 获取每个 provider 的模型(采样3个)
  if (Array.isArray(providers)) {
    const sampleProviders = providers.slice(0, Math.min(3, providers.length))
    for (const p of sampleProviders) {
      const models = await cdp.eval(`(async()=>{ try{ const r=await window.api.ai.listModels('${p.id}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,150)}} })()`)
      if (Array.isArray(models)) ok(`models for ${p.id}`, `${models.length} 个`)
      else warn(`models for ${p.id}`, models?.error || '失败')
    }
  }

  // ========== 2. AI 连接测试(无效 key) ==========
  console.log('\n--- 2. AI 连接测试(无效 key) ---')
  const testProviders = ['openai', 'anthropic', 'deepseek', 'nonexistent-provider']
  for (const pid of testProviders) {
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.ai.testConnection('${pid}', 'sk-invalid-key-12345');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
    })()`)
    // 无效 key 应该失败但不崩溃
    if (r?.success === false || r?.error) ok(`testConnection ${pid}`, `graceful 失败: ${(r.error || r.message || '').slice(0, 50)}`)
    else if (r?.success === true) warn(`testConnection ${pid}`, '意外成功')
    else warn(`testConnection ${pid}`, `返回: ${JSON.stringify(r).slice(0, 80)}`)
  }

  // ========== 3. AI 连接测试(空 key) ==========
  console.log('\n--- 3. AI 连接测试(空 key) ---')
  const emptyKeyR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.testConnection('openai', '');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
  })()`)
  if (emptyKeyR?.success === false || emptyKeyR?.error) ok('空 key', 'graceful 失败')
  else warn('空 key', `返回: ${JSON.stringify(emptyKeyR).slice(0, 80)}`)

  // ========== 4. AI 连接测试(超长 key) ==========
  console.log('\n--- 4. AI 连接测试(超长 key) ---')
  const longKey = 'sk-' + 'A'.repeat(10000)
  const longKeyR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.testConnection('openai', '${longKey.slice(0, 200)}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
  })()`)
  if (longKeyR?.success === false || longKeyR?.error) ok('超长 key', 'graceful 失败')
  else warn('超长 key', `返回: ${JSON.stringify(longKeyR).slice(0, 80)}`)

  // ========== 5. setApiKey / deleteApiKey ==========
  console.log('\n--- 5. setApiKey / deleteApiKey ---')
  // 设置无效 key(应该能设置但不验证)
  const setR = await cdp.eval(`(async()=>{ try{ const r=await window.api.ai.setApiKey('openai', 'sk-test-r22'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,150)}} })()`)
  if (setR?.success !== false) ok('setApiKey', '成功')
  else warn('setApiKey', setR?.error)

  // 删除 key
  const delR = await cdp.eval(`(async()=>{ try{ const r=await window.api.ai.deleteApiKey('openai'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,150)}} })()`)
  if (delR?.success !== false) ok('deleteApiKey', '成功')
  else warn('deleteApiKey', delR?.error)

  // 删除不存在的 provider key
  const delNonexistR = await cdp.eval(`(async()=>{ try{ const r=await window.api.ai.deleteApiKey('nonexistent-xyz'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,150)}} })()`)
  if (delNonexistR?.success !== false) ok('deleteApiKey 不存在', 'graceful')
  else warn('deleteApiKey 不存在', delNonexistR?.error)

  // ========== 6. Chat 调用(无有效 key) ==========
  console.log('\n--- 6. Chat 调用(无有效 key) ---')
  const chatR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.chat({
        providerId: 'openai',
        modelId: 'gpt-4',
        messages: [{ role: 'user', content: '测试消息' }]
      });
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
  })()`)
  if (chatR?.success === false || chatR?.error) ok('Chat 无 key', 'graceful 失败')
  else warn('Chat 无 key', `返回: ${JSON.stringify(chatR).slice(0, 80)}`)

  // Chat 无效 provider
  const chatInvalidR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.chat({
        providerId: 'nonexistent',
        modelId: 'xyz',
        messages: [{ role: 'user', content: '测试' }]
      });
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
  })()`)
  if (chatInvalidR?.success === false || chatInvalidR?.error) ok('Chat 无效 provider', 'graceful 失败')
  else warn('Chat 无效 provider', `返回: ${JSON.stringify(chatInvalidR).slice(0, 80)}`)

  // Chat 空消息
  const chatEmptyR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.chat({
        providerId: 'openai',
        modelId: 'gpt-4',
        messages: []
      });
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
  })()`)
  if (chatEmptyR?.success === false || chatEmptyR?.error) ok('Chat 空消息', 'graceful 失败')
  else warn('Chat 空消息', `返回: ${JSON.stringify(chatEmptyR).slice(0, 80)}`)

  // ========== 7. abortChat ==========
  console.log('\n--- 7. abortChat ---')
  const abortR = await cdp.eval(`(async()=>{ try{ const r=await window.api.ai.abortChat(); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,150)}} })()`)
  if (abortR?.success !== false) ok('abortChat', '成功(即使无进行中的chat)')
  else warn('abortChat', abortR?.error)

  // ========== 8. Custom Model CRUD ==========
  console.log('\n--- 8. Custom Model CRUD ---')
  const customModel = {
    providerId: 'openai',
    modelId: 'r22-custom-model',
    name: 'R22测试模型',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    supportsReasoning: false
  }
  const addModelR = await cdp.eval(`(async()=>{ try{ const r=await window.api.ai.addCustomModel(${JSON.stringify(customModel)}); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,150)}} })()`)
  if (addModelR?.success !== false || addModelR?.id) ok('addCustomModel', '成功')
  else warn('addCustomModel', addModelR?.error)

  // 验证能查到
  const modelsR = await cdp.eval(`(async()=>{ const r=await window.api.ai.listModels('openai'); return JSON.parse(JSON.stringify(r)); })()`)
  const found = (Array.isArray(modelsR) ? modelsR : []).find(m => m.id === 'r22-custom-model' || m.modelId === 'r22-custom-model')
  if (found) ok('custom model 可查', '找到')
  else warn('custom model 可查', '未找到')

  // 删除 custom model
  const delModelR = await cdp.eval(`(async()=>{ try{ const r=await window.api.ai.deleteCustomModel('openai', 'r22-custom-model'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,150)}} })()`)
  if (delModelR?.success !== false) ok('deleteCustomModel', '成功')
  else warn('deleteCustomModel', delModelR?.error)

  // 删除不存在的 custom model
  const delNonexistModelR = await cdp.eval(`(async()=>{ try{ const r=await window.api.ai.deleteCustomModel('openai', 'nonexistent-model'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,150)}} })()`)
  if (delNonexistModelR?.success !== false) ok('deleteCustomModel 不存在', 'graceful')
  else warn('deleteCustomModel 不存在', delNonexistModelR?.error)

  // ========== 9. Stream 事件监听 ==========
  console.log('\n--- 9. Stream 事件监听 ---')
  const streamReg = await cdp.eval(`(async()=>{
    try {
      window.__streamEvents = [];
      const unsub = window.api.ai.onStream((ev) => { window.__streamEvents.push(ev); });
      window.__unsubStream = unsub;
      return { success: true };
    } catch(e) { return { success: false, error: String(e.message||e).slice(0,150) }; }
  })()`)
  if (streamReg?.success !== false) ok('onStream 注册', '成功')
  else fail('onStream 注册', '', streamReg?.error)

  // 注销
  const unreg = await cdp.eval(`(async()=>{ try{ if(window.__unsubStream) window.__unsubStream(); return {success:true}; }catch(e){return {success:false,error:String(e.message||e).slice(0,150)}} })()`)
  if (unreg?.success !== false) ok('onStream 注销', '成功')
  else warn('onStream 注销', unreg?.error)

  // ========== 10. Chat 页面 UI ==========
  console.log('\n--- 10. Chat 页面 UI ---')
  await cdp.navigate('/chat', 1500)

  // 检查 chat 输入框
  const hasTextarea = await cdp.eval(`document.querySelectorAll('textarea').length`)
  if (hasTextarea > 0) ok('Chat textarea', `${hasTextarea} 个`)
  else warn('Chat textarea', '未找到')

  // 检查发送按钮
  const hasSendBtn = await cdp.eval(`document.querySelectorAll('button').length`)
  if (hasSendBtn > 0) ok('Chat buttons', `${hasSendBtn} 个`)
  else warn('Chat buttons', '未找到')

  // 尝试输入文字
  const inputR = await cdp.eval(`(function(){
    const ta = document.querySelector('textarea');
    if (!ta) return {success: false, error: 'no textarea'};
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'R22测试消息');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return {success: true, value: ta.value};
    } catch(e) { return {success: false, error: String(e.message||e).slice(0,100)}; }
  })()`)
  if (inputR?.success) ok('Chat 输入', '成功')
  else warn('Chat 输入', inputR?.error)

  // ========== 11. Settings 页 AI 配置 ==========
  console.log('\n--- 11. Settings 页 AI 配置 ---')
  await cdp.navigate('/settings', 1500)
  const settingsBody = await cdp.eval(`document.body.innerText.length`)
  if (settingsBody > 100) ok('Settings 页', `${settingsBody} 字符`)
  else fail('Settings 页', '', '渲染异常')

  // ========== 12. 异常后系统完整性 ==========
  console.log('\n--- 12. 异常后系统完整性 ---')
  const infoR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.info(); return JSON.parse(JSON.stringify(r)); })()`)
  if (infoR?.success !== false) ok('AI 异常后 EAA 正常', 'info 可用')
  else fail('AI 异常后 EAA 正常', '', 'info 失败')

  const classList = await cdp.eval(`(async()=>{ const r=await window.api.class.list(); return JSON.parse(JSON.stringify(r)); })()`)
  if (classList?.success !== false) ok('AI 异常后 Class 正常', 'list 可用')
  else fail('AI 异常后 Class 正常', '', 'list 失败')

  const settings = await cdp.eval(`(async()=>{ const r=await window.api.settings.get(); return JSON.parse(JSON.stringify(r)); })()`)
  if (settings?.general) ok('AI 异常后 Settings 正常', 'get 可用')
  else fail('AI 异常后 Settings 正常', '', 'get 失败')

  // ========== 13. 内存检查 ==========
  console.log('\n--- 13. 内存检查 ---')
  const memR = await cdp.eval(`(function(){ if(performance && performance.memory){ return { used: Math.round(performance.memory.usedJSHeapSize/1024/1024), total: Math.round(performance.memory.totalJSHeapSize/1024/1024) }; } return null; })()`)
  if (memR) ok('内存', `${memR.used} MB / ${memR.total} MB`)
  else warn('内存', '不可用')

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${total > 0 ? (results.pass / total * 100).toFixed(1) : 0}%`)

  const resultFile = path.join(__dirname, 'r22-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ results }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
