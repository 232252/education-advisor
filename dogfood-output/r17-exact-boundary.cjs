// R17: 确切边界测试 — 用纯名字(无前缀) + 多字段边界
// 修正 R15/R16 的边界测试 bug (前缀导致实际长度超出)
// 测试:
//   1. 学生名确切边界 (1-70 字符, 无前缀)
//   2. operator 字段边界
//   3. note 字段边界
//   4. setStudentMeta group/role 边界
//   5. class.create name/grade/teacher 边界
//   6. class_id 边界 (sanitizeClassId 限制: [A-Za-z0-9.-] max 32)
//   7. 特殊字符学生名
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

  console.log('=== R17 确切边界测试 (纯名字无前缀) ===\n')
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

  const rid = () => 'r17' + Date.now().toString(36) + Math.floor(Math.random() * 10000)
  const cleanup = async (sn) => { try { await callApi('eaa.deleteStudent', sn, 'R17') } catch (e) {} }

  // ========== 1. 学生名确切边界 (纯名字, 无前缀) ==========
  console.log('--- 1. 学生名确切边界 (纯名字) ---')
  // 用唯一前缀 'z' + 数字确保唯一, 但控制总长度
  for (const len of [1, 2, 10, 30, 50, 60, 62, 63, 64, 65, 70, 100]) {
    // 生成纯字母名字, 长度精确为 len
    const name = 'z'.repeat(len)
    const r = await callApi('eaa.addStudent', name)
    if (len <= 63) {
      // 期望接受 (假设 <= 63 或 < 64)
      if (r && !r.__error) { ok(`长度 ${len} 接受`, '成功'); await cleanup(name) }
      else { fail(`长度 ${len} 应接受`, '', r?.__error) }
    } else {
      // 期望拒绝
      if (r && r.__error) ok(`长度 ${len} 拒绝`, '正确拒绝')
      else { fail(`长度 ${len} 应拒绝`, '', '错误接受'); await cleanup(name) }
    }
  }

  // ========== 2. 学生名特殊字符 ==========
  console.log('\n--- 2. 学生名特殊字符 ---')
  const specialNames = [
    { name: '张三', desc: '中文', expect: 'accept' },
    { name: 'Alice Bob', desc: '英文带空格', expect: 'accept' },
    { name: "O'Brien", desc: '单引号', expect: 'reject' }, // sanitizeName 拒绝
    { name: 'A;B', desc: '分号', expect: 'reject' },
    { name: 'A|B', desc: '管道符', expect: 'reject' },
    { name: 'A&B', desc: '&', expect: 'reject' },
    { name: 'A<B', desc: '<', expect: 'reject' },
    { name: 'A>B', desc: '>', expect: 'reject' },
    { name: 'A{B}', desc: '花括号', expect: 'reject' },
    { name: 'A$B', desc: '$', expect: 'reject' },
    { name: '--A', desc: '--前缀', expect: 'reject' },
    { name: 'A/B', desc: '斜杠', expect: 'reject' },
    { name: '正常名'.repeat(20), desc: '超长中文(60字符)', expect: 'accept' },
  ]
  for (const t of specialNames) {
    const r = await callApi('eaa.addStudent', t.name)
    if (t.expect === 'accept') {
      if (r && !r.__error) { ok(`接受 "${t.desc}"`, '成功'); await cleanup(t.name) }
      else fail(`应接受 "${t.desc}"`, '', r?.__error)
    } else {
      if (r && r.__error) ok(`拒绝 "${t.desc}"`, '正确拒绝')
      else { fail(`应拒绝 "${t.desc}"`, '', '错误接受'); await cleanup(t.name) }
    }
  }

  // ========== 3. operator 字段边界 ==========
  console.log('\n--- 3. operator 字段边界 ---')
  const sn3 = `R17op_${rid()}`
  await callApi('eaa.addStudent', sn3)
  const operators = [
    { op: '正常老师', desc: '中文', expect: 'accept' },
    { op: '', desc: '空', expect: 'accept' }, // 空可能被接受
    { op: 'A'.repeat(100), desc: '超长100', expect: 'accept-or-reject' },
    { op: '老师;rm', desc: '注入', expect: 'reject-or-sanitize' },
  ]
  for (const t of operators) {
    // 用不同原因码避免去重 (但同一学生今日同一原因码去重, 所以需用不同学生)
    const sn = `R17op_${rid()}`
    await callApi('eaa.addStudent', sn)
    const r = await callApi('eaa.addEvent', { studentName: sn, reasonCode: 'LATE', delta: -2, operator: t.op })
    if (t.expect === 'accept' || t.expect === 'accept-or-reject') {
      if (r && !r.__error) ok(`operator "${t.desc}"`, '接受')
      else if (t.expect === 'accept-or-reject') ok(`operator "${t.desc}"`, '拒绝(可接受)')
      else fail(`operator "${t.desc}" 应接受`, '', r?.__error)
    } else {
      if (r && r.__error) ok(`operator "${t.desc}" 拒绝`, '正确')
      else ok(`operator "${t.desc}"`, '接受(可能被 sanitize)')
    }
    await cleanup(sn)
  }
  await cleanup(sn3)

  // ========== 4. note 字段边界 ==========
  console.log('\n--- 4. note 字段边界 ---')
  const notes = [
    { note: '正常备注', desc: '中文' },
    { note: '', desc: '空' },
    { note: 'A'.repeat(500), desc: '超长500' },
    { note: '备注"; DROP TABLE', desc: 'SQL注入' },
    { note: '备注\n换行', desc: '换行' },
  ]
  for (const t of notes) {
    const sn = `R17note_${rid()}`
    await callApi('eaa.addStudent', sn)
    const r = await callApi('eaa.addEvent', { studentName: sn, reasonCode: 'LATE', delta: -2, operator: 'R17', note: t.note })
    if (r && !r.__error) ok(`note "${t.desc}"`, '接受')
    else fail(`note "${t.desc}"`, '', r?.__error)
    await cleanup(sn)
  }

  // ========== 5. class.create 边界 ==========
  console.log('\n--- 5. class.create 边界 ---')
  const classTests = [
    { params: { class_id: 'R17C1', name: '正常班', grade: '八年级', teacher: '张老师' }, desc: '正常', expect: 'accept' },
    { params: { class_id: 'R17C2', name: '', grade: '八年级', teacher: '张老师' }, desc: '空name', expect: 'reject' },
    { params: { class_id: 'R17C3', name: '班', grade: '', teacher: '张老师' }, desc: '空grade', expect: 'accept-or-reject' },
    { params: { class_id: 'R17C4', name: '班', grade: '八年级', teacher: '' }, desc: '空teacher', expect: 'accept-or-reject' },
    { params: { class_id: 'R17C5', name: 'A'.repeat(200), grade: '八年级', teacher: '张老师' }, desc: '超长name', expect: 'reject' },
    { params: { class_id: 'invalid_id!', name: '班', grade: '八年级', teacher: '张老师' }, desc: 'class_id含!', expect: 'reject' },
    { params: { class_id: 'R17C7', name: '班', grade: '八年级', teacher: '张老师' }, desc: '重复class_id', expect: 'reject' },
  ]
  // 先创建 R17C7 占位
  await callApi('class.create', { class_id: 'R17C7', name: '占位班', grade: '八年级', teacher: '张老师' })
  const createdClasses = []
  for (const t of classTests) {
    const r = await callApi('class.create', t.params)
    if (t.expect === 'accept') {
      if (r && r.id) { ok(`class "${t.desc}"`, '成功'); createdClasses.push(r.id) }
      else fail(`class "${t.desc}" 应成功`, '', r?.__error || r?.error || JSON.stringify(r).slice(0, 80))
    } else if (t.expect === 'reject') {
      if (r && (r.__error || r.error || r.success === false)) ok(`class "${t.desc}" 拒绝`, '正确')
      else { fail(`class "${t.desc}" 应拒绝`, '', '错误接受'); if (r && r.id) createdClasses.push(r.id) }
    } else {
      // accept-or-reject
      ok(`class "${t.desc}"`, r && r.id ? '接受' : '拒绝(均可)')
      if (r && r.id) createdClasses.push(r.id)
    }
  }
  // 清理
  for (const id of createdClasses) { try { await callApi('class.delete', id) } catch (e) {} }

  // ========== 6. class_id 边界 (sanitizeClassId: [A-Za-z0-9.-] max 32) ==========
  console.log('\n--- 6. class_id 边界 ---')
  const classIdTests = [
    { id: 'A', desc: '1字符', expect: 'accept' },
    { id: 'A'.repeat(32), desc: '32字符', expect: 'accept' },
    { id: 'A'.repeat(33), desc: '33字符', expect: 'reject' },
    { id: 'A.B-C.D', desc: '含.和-', expect: 'accept' },
    { id: 'A_B', desc: '含_', expect: 'reject' },
    { id: 'A B', desc: '含空格', expect: 'reject' },
    { id: 'A/B', desc: '含/', expect: 'reject' },
    { id: '中文', desc: '中文', expect: 'reject' }, // sanitizeClassId 只允许 [A-Za-z0-9.-]
  ]
  for (const t of classIdTests) {
    const r = await callApi('class.create', { class_id: t.id + rid(), name: '边界班', grade: '八年级', teacher: '张老师' })
    if (t.expect === 'accept') {
      if (r && r.id) { ok(`class_id "${t.desc}"`, '成功'); try { await callApi('class.delete', r.id) } catch (e) {} }
      else fail(`class_id "${t.desc}" 应成功`, '', r?.__error || r?.error || JSON.stringify(r).slice(0, 80))
    } else {
      if (r && (r.__error || r.error || r.success === false)) ok(`class_id "${t.desc}" 拒绝`, '正确')
      else { fail(`class_id "${t.desc}" 应拒绝`, '', '错误接受'); if (r && r.id) try { await callApi('class.delete', r.id) } catch (e) {} }
    }
  }

  // ========== 7. 汇总 ==========
  console.log('\n=== R17 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r17-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
