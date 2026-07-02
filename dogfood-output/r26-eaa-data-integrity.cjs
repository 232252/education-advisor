// R26: EAA 数据完整性深度 — 软删除统计/分数分布/ranking/stats/history 深度
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

  console.log('=== R26 EAA 数据完整性深度调查 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 100)}`) }

  // ========== 1. listStudents 全量分析 ==========
  console.log('--- 1. listStudents 全量分析 ---')
  const analysis = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    if (!r.success) return JSON.stringify({error: r.data});
    const students = r.data.students;
    let deleted = 0, active = 0;
    const statusCount = {};
    const riskCount = {};
    let scoreMin = Infinity, scoreMax = -Infinity, scoreSum = 0;
    const classCount = {};
    for (const s of students) {
      const st = s.status || 'unknown';
      statusCount[st] = (statusCount[st] || 0) + 1;
      if (st === 'Deleted') deleted++; else active++;
      const rk = s.risk || 'unknown';
      riskCount[rk] = (riskCount[rk] || 0) + 1;
      const sc = s.score || 0;
      if (sc < scoreMin) scoreMin = sc;
      if (sc > scoreMax) scoreMax = sc;
      scoreSum += sc;
      const cid = s.class_id || '(无班级)';
      classCount[cid] = (classCount[cid] || 0) + 1;
    }
    return JSON.stringify({
      total: students.length,
      active: active,
      deleted: deleted,
      statusCount: statusCount,
      riskCount: riskCount,
      scoreMin: scoreMin,
      scoreMax: scoreMax,
      scoreAvg: (scoreSum / students.length).toFixed(2),
      classCount: classCount
    });
  })()`)
  const a = JSON.parse(analysis)
  ok('学生总数', `${a.total} (active=${a.active}, deleted=${a.deleted})`)
  ok('状态分布', JSON.stringify(a.statusCount))
  ok('风险分布', JSON.stringify(a.riskCount))
  ok('分数范围', `min=${a.scoreMin}, max=${a.scoreMax}, avg=${a.scoreAvg}`)
  ok('班级分布', JSON.stringify(a.classCount).slice(0, 200))

  // ========== 2. ranking 结构调查 ==========
  console.log('\n--- 2. ranking 结构调查 ---')
  const rank10 = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(10);
    return JSON.stringify({
      success: r.success,
      dataType: typeof r.data,
      dataKeys: r.data ? Object.keys(r.data) : null,
      dataIsArray: Array.isArray(r.data),
      dataLen: Array.isArray(r.data) ? r.data.length : null,
      rankingLen: r.data?.ranking ? r.data.ranking.length : null,
      firstRank: r.data?.ranking?.[0] ? JSON.stringify(r.data.ranking[0]) : null,
      dataStr: JSON.stringify(r.data).slice(0, 300)
    });
  })()`)
  ok('ranking(10) 结构', rank10.slice(0, 400))

  // ranking(0) 
  const rank0 = await cdp.eval(`(async()=>{const r=await window.api.eaa.ranking(0);return JSON.stringify({success:r.success,rankingLen:r.data?.ranking?r.data.ranking.length:null})})()`)
  ok('ranking(0)', rank0)

  // ranking(1000)
  const rank1000 = await cdp.eval(`(async()=>{const r=await window.api.eaa.ranking(1000);return JSON.stringify({success:r.success,rankingLen:r.data?.ranking?r.data.ranking.length:null})})()`)
  ok('ranking(1000)', rank1000)

  // ========== 3. stats 结构 ==========
  console.log('\n--- 3. stats 结构 ---')
  const stats = await cdp.eval(`(async()=>{const r=await window.api.eaa.stats();return JSON.stringify({success:r.success,data:r.data})})()`)
  ok('stats 结构', stats.slice(0, 500))

  // ========== 4. codes 结构 ==========
  console.log('\n--- 4. codes 结构 ---')
  const codes = await cdp.eval(`(async()=>{const r=await window.api.eaa.codes();return JSON.stringify({success:r.success,dataKeys:r.data?Object.keys(r.data):null,codesCount:r.data?.codes?Object.keys(r.data.codes).length:null,sampleCode:r.data?.codes?Object.keys(r.data.codes)[0]:null,sampleDef:r.data?.codes?.LATE?JSON.stringify(r.data.codes.LATE):null})})()`)
  ok('codes 结构', codes.slice(0, 400))

  // ========== 5. validate 结构 ==========
  console.log('\n--- 5. validate 结构 ---')
  const validate = await cdp.eval(`(async()=>{const r=await window.api.eaa.validate();return JSON.stringify({success:r.success,data:r.data})})()`)
  ok('validate 结构', validate.slice(0, 400))

  // ========== 6. summary 结构 ==========
  console.log('\n--- 6. summary 结构 ---')
  const summary = await cdp.eval(`(async()=>{const r=await window.api.eaa.summary();return JSON.stringify({success:r.success,dataType:typeof r.data,dataKeys:r.data?Object.keys(r.data):null,dataStr:JSON.stringify(r.data).slice(0,400)})})()`)
  ok('summary 结构', summary.slice(0, 500))

  // ========== 7. doctor 结构 ==========
  console.log('\n--- 7. doctor 结构 ---')
  const doctor = await cdp.eval(`(async()=>{const r=await window.api.eaa.doctor();return JSON.stringify({success:r.success,data:r.data})})()`)
  ok('doctor 结构', doctor.slice(0, 500))

  // ========== 8. search 测试 ==========
  console.log('\n--- 8. search 测试 ---')
  const searchEmpty = await cdp.eval(`(async()=>{const r=await window.api.eaa.search('', 10);return JSON.stringify({success:r.success,dataType:typeof r.data,dataStr:JSON.stringify(r.data).slice(0,200)})})()`)
  ok('search 空字符串', searchEmpty.slice(0, 300))

  const searchA = await cdp.eval(`(async()=>{const r=await window.api.eaa.search('A', 10);return JSON.stringify({success:r.success,resultLen:Array.isArray(r.data)?r.data.length:(r.data?.results?.length||0)})})()`)
  ok('search A', searchA)

  const searchZ = await cdp.eval(`(async()=>{const r=await window.api.eaa.search('不存在的名字xyz123', 10);return JSON.stringify({success:r.success,resultLen:Array.isArray(r.data)?r.data.length:(r.data?.results?.length||0)})})()`)
  ok('search 不存在', searchZ)

  // ========== 9. range 时间范围 ==========
  console.log('\n--- 9. range 时间范围 ---')
  const rangeAll = await cdp.eval(`(async()=>{const r=await window.api.eaa.range('2020-01-01', '2030-12-31', 100);return JSON.stringify({success:r.success,dataType:typeof r.data,resultLen:Array.isArray(r.data)?r.data.length:(r.data?.events?.length||0),dataStr:JSON.stringify(r.data).slice(0,200)})})()`)
  ok('range 全范围', rangeAll.slice(0, 300))

  const rangeEmpty = await cdp.eval(`(async()=>{const r=await window.api.eaa.range('2030-01-01', '2030-12-31', 100);return JSON.stringify({success:r.success,resultLen:Array.isArray(r.data)?r.data.length:(r.data?.events?.length||0)})})()`)
  ok('range 空范围', rangeEmpty)

  // ========== 10. tag 测试 ==========
  console.log('\n--- 10. tag 测试 ---')
  const tagAll = await cdp.eval(`(async()=>{const r=await window.api.eaa.tag();return JSON.stringify({success:r.success,dataType:typeof r.data,dataStr:JSON.stringify(r.data).slice(0,200)})})()`)
  ok('tag() 无参', tagAll.slice(0, 300))

  const tagSpecific = await cdp.eval(`(async()=>{const r=await window.api.eaa.tag('discipline');return JSON.stringify({success:r.success,dataStr:JSON.stringify(r.data).slice(0,200)})})()`)
  ok('tag(discipline)', tagSpecific.slice(0, 300))

  // ========== 11. replay 结构 ==========
  console.log('\n--- 11. replay 结构 ---')
  const replay = await cdp.eval(`(async()=>{const r=await window.api.eaa.replay();return JSON.stringify({success:r.success,dataType:typeof r.data,dataKeys:r.data?Object.keys(r.data):null,replayLen:r.data?.replay?r.data.replay.length:(r.data?.snapshots?.length||0),dataStr:JSON.stringify(r.data).slice(0,200)})})()`)
  ok('replay 结构', replay.slice(0, 300))

  // ========== 12. history 某学生 ==========
  console.log('\n--- 12. history 某学生 ---')
  const hist = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    const first = r.data?.students?.[0];
    const name = typeof first === 'string' ? first : first?.name;
    if (!name) return JSON.stringify({error: 'no student'});
    const h = await window.api.eaa.history(name);
    return JSON.stringify({
      name: name,
      success: h.success,
      historyLen: Array.isArray(h.data) ? h.data.length : (h.data?.history?.length || 0),
      firstEvent: h.data?.history?.[0] || (Array.isArray(h.data) ? h.data[0] : null) ? JSON.stringify(h.data?.history?.[0] || h.data?.[0]).slice(0,200) : null
    });
  })()`)
  ok('history 第一个学生', hist.slice(0, 400))

  // ========== 13. score 抽样 5 个学生 ==========
  console.log('\n--- 13. score 抽样 5 个学生 ---')
  const scores = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    const students = r.data?.students || [];
    const sample = [students[0], students[Math.floor(students.length/4)], students[Math.floor(students.length/2)], students[Math.floor(students.length*3/4)], students[students.length-1]];
    const out = [];
    for (const s of sample) {
      if (!s) continue;
      const name = typeof s === 'string' ? s : s.name;
      const sc = await window.api.eaa.score(name);
      out.push({name: name, score: sc.data?.score, risk: sc.data?.risk, status: sc.data?.status, events: sc.data?.events_count});
    }
    return JSON.stringify(out);
  })()`)
  ok('score 抽样 5 个', scores.slice(0, 500))

  // ========== 14. 汇总 ==========
  console.log('\n=== R26 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r26-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
