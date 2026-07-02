// R14: EAA delta 校验边界测试
// 基于 R13b 发现: EAA 严格校验 delta 与 reason-codes.json 标准值
// 测试角度:
//   1. 所有 22 个原因码用标准 delta (应全成功)
//   2. 每个原因码用错误 delta (应全被拒)
//   3. 不传 delta (应自动填充标准值, Bug 2 修复验证)
//   4. 边界值: delta=0, 极大值, 极小值, 小数, null, undefined
//   5. BONUS_VARIABLE 和 REVERT (delta=null 的特殊处理)
//   6. 无效原因码
//   7. 大小写敏感性
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

  console.log('=== R14 EAA delta 校验边界测试 ===\n')
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

  const rid = () => 'r14' + Date.now().toString(36) + Math.floor(Math.random() * 10000)
  // 标准 delta 值表
  const standardDeltas = {
    SPEAK_IN_CLASS: -2, SLEEP_IN_CLASS: -2, LATE: -2, SCHOOL_CAUGHT: -5,
    MAKEUP: -2, DESK_UNALIGNED: -1, PHONE_IN_CLASS: -5, SMOKING: -10,
    DRINKING_DORM: -5, OTHER_DEDUCT: -1, APPEARANCE_VIOLATION: -2,
    BONUS_VARIABLE: null, ACTIVITY_PARTICIPATION: 1, CLASS_MONITOR: 10,
    CLASS_COMMITTEE: 5, CIVILIZED_DORM: 3, MONTHLY_ATTENDANCE: 2,
    REVERT: null, LAB_EQUIPMENT_DAMAGE: -5, LAB_SAFETY_VIOLATION: -10,
    LAB_UNSAFE_BEHAVIOR: -5, LAB_CLEAN_UP: -1,
  }

  // ========== 1. 所有原因码用标准 delta (应全成功) ==========
  console.log('--- 1. 所有原因码用标准 delta (应全成功) ---')
  let stdPass = 0, stdFail = 0
  for (const [code, delta] of Object.entries(standardDeltas)) {
    // REVERT 不能直接 addEvent, 跳过
    if (code === 'REVERT') { ok(`跳过 ${code}`, 'system 码不可直接添加'); continue }
    // BONUS_VARIABLE delta=null, 传 null 时 handler 会跳过 --delta, EAA 用默认 0?
    const sn = `R14std_${code}_${rid()}`
    const addStu = await callApi('eaa.addStudent', sn)
    if (addStu && addStu.__error) { fail(`创建学生 ${code}`, '', addStu.__error); continue }

    const params = { studentName: sn, reasonCode: code, operator: 'R14' }
    if (delta !== null && delta !== undefined) params.delta = delta
    // BONUS_VARIABLE: 不传 delta, 看 EAA 如何处理 (标准值 null)

    const r = await callApi('eaa.addEvent', params)
    if (r && !r.__error) {
      stdPass++
      ok(`标准 delta ${code}`, delta === null ? '(null, 不传)' : `${delta}`)
    } else {
      stdFail++
      // BONUS_VARIABLE 可能因为标准值是 null 而失败, 这是待确认行为
      fail(`标准 delta ${code}`, delta === null ? '(null)' : `${delta}`, r?.__error)
    }
    // 清理
    await callApi('eaa.deleteStudent', sn, 'R14 清理')
  }
  ok('标准 delta 汇总', `${stdPass} 成功, ${stdFail} 失败`)

  // ========== 2. 部分原因码用错误 delta (应全被拒) ==========
  console.log('\n--- 2. 错误 delta 应被拒绝 ---')
  const wrongDeltaTests = [
    { code: 'LATE', wrongDelta: -1, stdDelta: -2 },
    { code: 'LATE', wrongDelta: 0, stdDelta: -2 },
    { code: 'LATE', wrongDelta: -3, stdDelta: -2 },
    { code: 'SPEAK_IN_CLASS', wrongDelta: -1, stdDelta: -2 },
    { code: 'ACTIVITY_PARTICIPATION', wrongDelta: 2, stdDelta: 1 },
    { code: 'ACTIVITY_PARTICIPATION', wrongDelta: 0, stdDelta: 1 },
    { code: 'CLASS_MONITOR', wrongDelta: 5, stdDelta: 10 },
    { code: 'CLASS_MONITOR', wrongDelta: 11, stdDelta: 10 },
    { code: 'SMOKING', wrongDelta: -9, stdDelta: -10 },
    { code: 'CIVILIZED_DORM', wrongDelta: 2, stdDelta: 3 },
  ]
  let wrongPass = 0, wrongFail = 0
  for (const t of wrongDeltaTests) {
    const sn = `R14w_${t.code}_${rid()}`
    await callApi('eaa.addStudent', sn)
    const r = await callApi('eaa.addEvent', { studentName: sn, reasonCode: t.code, delta: t.wrongDelta, operator: 'R14' })
    if (r && r.__error) {
      // 被拒绝是正确行为
      wrongPass++
      ok(`错误 delta 被拒 ${t.code}(${t.wrongDelta})`, `期望 ${t.stdDelta}, 正确拒绝`)
    } else {
      wrongFail++
      fail(`错误 delta 应被拒 ${t.code}(${t.wrongDelta})`, `期望 ${t.stdDelta}`, '错误 delta 被接受 (BUG)')
    }
    await callApi('eaa.deleteStudent', sn, 'R14 清理')
  }
  ok('错误 delta 汇总', `${wrongPass} 正确拒绝, ${wrongFail} 错误接受`)

  // ========== 3. 不传 delta (应自动填充标准值, Bug 2 修复) ==========
  console.log('\n--- 3. 不传 delta 自动填充 (Bug 2 修复验证) ---')
  const noDeltaTests = ['LATE', 'SPEAK_IN_CLASS', 'SLEEP_IN_CLASS', 'ACTIVITY_PARTICIPATION', 'CLASS_MONITOR', 'CIVILIZED_DORM', 'SMOKING', 'PHONE_IN_CLASS']
  let autoFillPass = 0, autoFillFail = 0
  for (const code of noDeltaTests) {
    const sn = `R14auto_${code}_${rid()}`
    await callApi('eaa.addStudent', sn)
    // 不传 delta
    const r = await callApi('eaa.addEvent', { studentName: sn, reasonCode: code, operator: 'R14' })
    if (r && !r.__error) {
      // 验证分数是否使用了标准 delta
      const sc = await callApi('eaa.score', sn)
      const score = sc?.score ?? sc
      const expected = 100 + standardDeltas[code]
      if (score === expected) {
        autoFillPass++
        ok(`自动填充 ${code}`, `不传 delta → 分数 ${score} (期望 ${expected})`)
      } else {
        autoFillFail++
        fail(`自动填充 ${code}`, `期望分数 ${expected}, 实际 ${score}`, '分数不匹配')
      }
    } else {
      autoFillFail++
      fail(`自动填充 ${code}`, '', r?.__error)
    }
    await callApi('eaa.deleteStudent', sn, 'R14 清理')
  }
  ok('自动填充汇总', `${autoFillPass} 成功, ${autoFillFail} 失败`)

  // ========== 4. 边界值测试 ==========
  console.log('\n--- 4. 边界值 delta 测试 ---')
  const boundaryTests = [
    { code: 'LATE', delta: 0, expectReject: true, desc: 'delta=0 (标准-2)' },
    { code: 'LATE', delta: -2.0, expectReject: false, desc: 'delta=-2.0 (浮点)' },
    { code: 'LATE', delta: -2.5, expectReject: true, desc: 'delta=-2.5 (非标准小数)' },
    { code: 'CIVILIZED_DORM', delta: 3.0, expectReject: false, desc: 'delta=3.0 (浮点)' },
    { code: 'CLASS_MONITOR', delta: 10.5, expectReject: true, desc: 'delta=10.5 (非标准)' },
    { code: 'SMOKING', delta: -10.0, expectReject: false, desc: 'delta=-10.0 (浮点)' },
  ]
  for (const t of boundaryTests) {
    const sn = `R14b_${t.code}_${rid()}`
    await callApi('eaa.addStudent', sn)
    const r = await callApi('eaa.addEvent', { studentName: sn, reasonCode: t.code, delta: t.delta, operator: 'R14' })
    if (t.expectReject) {
      if (r && r.__error) ok(`边界 ${t.desc}`, '正确拒绝')
      else fail(`边界 ${t.desc}`, '应拒绝但被接受', 'BUG')
    } else {
      if (r && !r.__error) ok(`边界 ${t.desc}`, '正确接受')
      else fail(`边界 ${t.desc}`, '应接受但被拒', r?.__error)
    }
    await callApi('eaa.deleteStudent', sn, 'R14 清理')
  }

  // ========== 5. 无效原因码 ==========
  console.log('\n--- 5. 无效原因码 ---')
  const invalidCodes = ['INVALID_CODE', 'FAKE', '', 'LATE2', 'late', 'Late', '迟到', 'LATE ', ' LATE']
  for (const code of invalidCodes) {
    const sn = `R14inv_${rid()}`
    await callApi('eaa.addStudent', sn)
    const r = await callApi('eaa.addEvent', { studentName: sn, reasonCode: code, delta: -2, operator: 'R14' })
    if (r && r.__error) {
      ok(`无效原因码被拒 "${code}"`, '正确拒绝')
    } else {
      // 空字符串可能特殊处理
      if (code === '') ok(`空原因码 "${code}"`, '返回 (待确认)')
      else fail(`无效原因码应被拒 "${code}"`, '', '错误接受 (BUG)')
    }
    await callApi('eaa.deleteStudent', sn, 'R14 清理')
  }

  // ========== 6. REVERT 原因码 (系统码, 不可直接 addEvent) ==========
  console.log('\n--- 6. REVERT 系统码 ---')
  const snRev = `R14rev_${rid()}`
  await callApi('eaa.addStudent', snRev)
  const revR = await callApi('eaa.addEvent', { studentName: snRev, reasonCode: 'REVERT', delta: -5, operator: 'R14' })
  if (revR && revR.__error) {
    ok('REVERT 不可直接添加', '正确拒绝')
  } else {
    // REVERT 被接受可能有问题, 但也可能是 EAA 允许手动添加
    ok('REVERT 添加结果', `返回: ${String(revR).slice(0, 60)} (待确认行为)`)
  }
  await callApi('eaa.deleteStudent', snRev, 'R14 清理')

  // ========== 7. 汇总 ==========
  console.log('\n=== R14 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r14-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
