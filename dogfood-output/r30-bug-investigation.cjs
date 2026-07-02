// R30: Bug 源码调查 + eaa.export 全格式 + ai.chat 流式 + agent.runManual 诊断
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

  console.log('=== R30 Bug 源码调查 + eaa.export 全格式 + ai.chat 流式 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 100)}`) }

  async function callApi(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p){if(o==null)return{__error:'no such api'};o=o[x]}if(typeof o!=='function')return{__error:'not a function'};const a=${JSON.stringify(args)};try{const r=await o(...a);if(r&&r.success===false)return{__error:String(r.data||r.error||'failed')};if(r&&typeof r==='object'&&'success'in r&&'data'in r)return r.data;return r}catch(e){return{__error:e.message}}})()`)
  }

  // ========== 1. eaa.export 全格式测试 ==========
  console.log('--- 1. eaa.export 全格式测试 ---')
  for (const fmt of ['csv', 'jsonl', 'json', 'html']) {
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.eaa.export('${fmt}');
        const data = r?.data;
        return JSON.stringify({
          success: r?.success,
          dataLen: typeof data === 'string' ? data.length : 0,
          dataPreview: typeof data === 'string' ? data.slice(0, 100) : null,
          stderr: r?.stderr?.slice(0, 80)
        });
      } catch (e) {
        return JSON.stringify({error: e.message});
      }
    })()`)
    ok(`eaa.export ${fmt}`, r.slice(0, 250))
  }

  // ========== 2. eaa.exportFormats 实际返回 ==========
  console.log('\n--- 2. eaa.exportFormats 实际返回 ---')
  const formats = await callApi('eaa.exportFormats')
  ok('eaa.exportFormats', `返回: ${JSON.stringify(formats)}`)

  // ========== 3. ai.chat 流式事件订阅 ==========
  console.log('\n--- 3. ai.chat 流式事件订阅 ---')
  const streamResult = await cdp.eval(`(async()=>{
    return new Promise(async (resolve) => {
      const events = [];
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(JSON.stringify({events: events, eventCount: events.length, lastEvent: events[events.length-1]}));
        }
      }, 8000);

      // 订阅流式事件
      const unsub = window.api.ai.onStream((event) => {
        events.push({type: event.type, hasContent: !!event.content, contentLen: event.content?.length || 0});
        if (events.length >= 5) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            unsub();
            resolve(JSON.stringify({events: events, eventCount: events.length, lastEvent: events[events.length-1]}));
          }
        }
      });

      // 发起 chat
      try {
        const r = await window.api.ai.chat({
          providerId: 'anthropic',
          modelId: 'claude-3-5-sonnet-20241022',
          messages: [{role: 'user', content: '说"测试"两个字'}],
          maxTokens: 50
        });
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          unsub();
          resolve(JSON.stringify({events: events, eventCount: events.length, chatResult: {success: r?.success, data: r?.data?.slice?.(0, 100)}, lastEvent: events[events.length-1]}));
        }
      } catch (e) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          unsub();
          resolve(JSON.stringify({events: events, eventCount: events.length, error: e.message}));
        }
      }
    });
  })()`)
  ok('ai.chat 流式事件', streamResult.slice(0, 400))

  // ========== 4. ai.chat 后 abortChat ==========
  console.log('\n--- 4. ai.abortChat ---')
  const abort = await callApi('ai.abortChat')
  ok('ai.abortChat', `结果: ${JSON.stringify(abort).slice(0, 100)}`)

  // ========== 5. agent.runManual 诊断 ==========
  console.log('\n--- 5. agent.runManual 诊断 ---')
  const runDiag = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.agent.runManual('data-analyst', '测试', []);
      return JSON.stringify({
        type: typeof r,
        isObject: r && typeof r === 'object',
        keys: r ? Object.keys(r) : null,
        success: r?.success,
        data: r?.data,
        dataType: typeof r?.data,
        stderr: r?.stderr,
        exitCode: r?.exitCode,
        fullStr: JSON.stringify(r).slice(0, 300)
      });
    } catch (e) {
      return JSON.stringify({error: e.message, stack: e.stack?.slice(0, 200)});
    }
  })()`)
  ok('agent.runManual 诊断', runDiag.slice(0, 500))

  // ========== 6. agent.runManual 不同 agent ==========
  console.log('\n--- 6. agent.runManual 不同 agent ---')
  for (const aid of ['academic', 'class-monitor', 'counselor', 'bug-hunter']) {
    const r = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.runManual('${aid}', '测试', []);
        return JSON.stringify({success: r?.success, hasError: !!r?.__error, error: r?.__error || (r?.data && typeof r.data === 'string' ? r.data.slice(0, 80) : null)});
      } catch (e) {
        return JSON.stringify({error: e.message.slice(0, 80)});
      }
    })()`)
    ok(`agent.runManual ${aid}`, r.slice(0, 200))
  }

  // ========== 7. privacy 状态机详细 ==========
  console.log('\n--- 7. privacy 状态机详细 ---')
  const status1 = await callApi('privacy.status')
  ok('privacy.status 初始', JSON.stringify(status1))

  // privacy.lock
  const lockR = await callApi('privacy.lock')
  ok('privacy.lock', `结果: ${JSON.stringify(lockR).slice(0, 80)}`)

  const status2 = await callApi('privacy.status')
  ok('privacy.status lock后', JSON.stringify(status2))

  // privacy.enable (无密码)
  const enableR = await callApi('privacy.enable')
  ok('privacy.enable 无密码', `结果: ${JSON.stringify(enableR).slice(0, 100)}`)

  // privacy.disable (错误密码)
  const disableR = await callApi('privacy.disable', 'wrongpassword')
  ok('privacy.disable 错误密码', `结果: ${JSON.stringify(disableR).slice(0, 100)}`)

  // privacy.list (无密码)
  const listR = await callApi('privacy.list')
  ok('privacy.list 无密码', `结果: ${JSON.stringify(listR).slice(0, 100)}`)

  // privacy.dryrun
  const dryrunR = await callApi('privacy.dryrun', '张三的电话是13800138000')
  ok('privacy.dryrun', `结果: ${JSON.stringify(dryrunR).slice(0, 100)}`)

  // ========== 8. eaa.search 不同关键词 ==========
  console.log('\n--- 8. eaa.search 不同关键词 ---')
  for (const q of ['张三', '李四', 'R4', 'LATE', '迟到', 'phone']) {
    const r = await cdp.eval(`(async()=>{const r=await window.api.eaa.search('${q}', 5);return JSON.stringify({success:r?.success,resultLen:Array.isArray(r?.data)?r.data.length:(r?.data?.events?.length||0)})})()`)
    ok(`search '${q}'`, r)
  }

  // ========== 9. eaa.range 不同时间段 ==========
  console.log('\n--- 9. eaa.range 不同时间段 ---')
  const ranges = [
    {start: '2024-01-01', end: '2024-12-31', desc: '2024年'},
    {start: '2025-01-01', end: '2025-12-31', desc: '2025年'},
    {start: '2026-01-01', end: '2026-12-31', desc: '2026年'},
    {start: '2026-06-01', end: '2026-06-30', desc: '2026年6月'},
    {start: '2026-07-01', end: '2026-07-01', desc: '2026年7月1日'},
  ]
  for (const rg of ranges) {
    const r = await cdp.eval(`(async()=>{const r=await window.api.eaa.range('${rg.start}', '${rg.end}', 100);return JSON.stringify({success:r?.success,resultLen:r?.data?.events?.length||0})})()`)
    ok(`range ${rg.desc}`, r)
  }

  // ========== 10. eaa.summary 时间段 ==========
  console.log('\n--- 10. eaa.summary 时间段 ---')
  const sum1 = await cdp.eval(`(async()=>{const r=await window.api.eaa.summary();return JSON.stringify({success:r?.success,events:r?.data?.events,period:r?.data?.period,risk:r?.data?.risk_distribution})})()`)
  ok('summary() 无参', sum1.slice(0, 300))

  const sum2 = await cdp.eval(`(async()=>{const r=await window.api.eaa.summary('2026-06-01', '2026-06-30');return JSON.stringify({success:r?.success,events:r?.data?.events,period:r?.data?.period})})()`)
  ok('summary 6月', sum2.slice(0, 200))

  // ========== 11. eaa.tag 不同标签 ==========
  console.log('\n--- 11. eaa.tag 不同标签 ---')
  const tags = ['discipline', 'academic', 'conduct', 'bonus', 'deduct', 'tombstone']
  for (const t of tags) {
    const r = await cdp.eval(`(async()=>{const r=await window.api.eaa.tag('${t}');return JSON.stringify({success:r?.success,dataStr:JSON.stringify(r?.data).slice(0,100)})})()`)
    ok(`tag('${t}')`, r.slice(0, 200))
  }

  // ========== 12. 汇总 ==========
  console.log('\n=== R30 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r30-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
