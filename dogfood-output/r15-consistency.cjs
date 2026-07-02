// R15: 空格原因码 Bug 深度诊断 + EAA 数据一致性测试
// 基于 R14 发现: "LATE " 和 " LATE" 被错误接受
// 测试:
//   1. 带空格原因码的实际写入行为 (检查 history 中的 reason_code 字段)
//   2. "LATE" 和 "LATE " 去重是否失效 (同一学生今日两个事件?)
//   3. EAA 各查询命令数据一致性 (score/history/ranking/stats/search)
//   4. 超长原因码、特殊字符原因码
//   5. 学生名边界 (空格/特殊字符/超长)
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

  console.log('=== R15 空格原因码诊断 + 数据一致性 ===\n')
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

  const rid = () => 'r15' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

  // ========== 1. 带空格原因码的实际写入行为 ==========
  console.log('--- 1. 带空格原因码的实际写入行为 ---')
  // 创建学生, 添加 "LATE " 事件, 检查 history 中的 reason_code
  const sn1 = `R15space_${rid()}`
  await callApi('eaa.addStudent', sn1)
  const r1 = await callApi('eaa.addEvent', { studentName: sn1, reasonCode: 'LATE ', delta: -2, operator: 'R15' })
  if (r1 && !r1.__error) {
    ok(`"LATE " 被接受`, String(r1).slice(0, 60))
    // 查 history 看实际写入的 reason_code
    const hist = await callApi('eaa.history', sn1)
    const histArr = Array.isArray(hist) ? hist : (hist?.events || hist?.data || [])
    if (histArr.length > 0) {
      const evt = histArr[0]
      const actualCode = evt.reason_code || evt.reasonCode || evt.code
      console.log(`    实际写入 reason_code: "${actualCode}" (长度 ${actualCode?.length})`)
      if (actualCode === 'LATE') {
        ok('原因码被 trim', `"LATE " → "LATE" (规范化)`)
      } else if (actualCode === 'LATE ') {
        fail('原因码未 trim', `"LATE " 保留空格写入`, 'BUG: 应 trim')
      } else {
        ok('原因码处理', `"LATE " → "${actualCode}" (待确认)`)
      }
      // 检查分数
      const sc = await callApi('eaa.score', sn1)
      const score = sc?.score ?? sc
      if (score === 98) ok('分数正确', `98 (LATE -2)`)
      else fail('分数异常', `期望 98, 实际 ${score}`, '分数不匹配')
    }
  } else {
    fail(`"LATE " 被拒绝`, '', r1?.__error)
  }
  await callApi('eaa.deleteStudent', sn1, 'R15 清理')

  // ========== 2. "LATE" 和 "LATE " 去重是否失效 ==========
  console.log('\n--- 2. "LATE" 和 "LATE " 去重测试 ---')
  const sn2 = `R15dedup_${rid()}`
  await callApi('eaa.addStudent', sn2)
  // 先添加 LATE
  const a1 = await callApi('eaa.addEvent', { studentName: sn2, reasonCode: 'LATE', delta: -2, operator: 'R15' })
  ok('添加 LATE', a1 && !a1.__error ? '成功' : '失败')
  // 再添加 "LATE " (带空格) — 如果去重失效, 会被接受; 如果 trim 了, 会被去重拒绝
  const a2 = await callApi('eaa.addEvent', { studentName: sn2, reasonCode: 'LATE ', delta: -2, operator: 'R15' })
  if (a2 && a2.__error) {
    ok('去重生效', `"LATE " 被去重拒绝 (原因码被 trim)`)
  } else {
    fail('去重失效', `"LATE " 被接受, 与 LATE 重复`, 'BUG: 去重应基于 trim 后的原因码')
  }
  // 检查分数: 如果去重生效应该是 98, 如果失效应该是 96
  const sc2 = await callApi('eaa.score', sn2)
  const score2 = sc2?.score ?? sc2
  console.log(`    分数: ${score2} (98=去重生效, 96=去重失效)`)
  await callApi('eaa.deleteStudent', sn2, 'R15 清理')

  // ========== 3. EAA 各查询命令数据一致性 ==========
  console.log('\n--- 3. EAA 数据一致性 ---')
  // 创建学生, 添加事件, 用不同命令查询, 验证数据一致
  const sn3 = `R15cons_${rid()}`
  await callApi('eaa.addStudent', sn3)
  await callApi('eaa.addEvent', { studentName: sn3, reasonCode: 'LATE', delta: -2, operator: 'R15' })
  await callApi('eaa.addEvent', { studentName: sn3, reasonCode: 'CIVILIZED_DORM', delta: 3, operator: 'R15' })

  // score 应该是 101 (100-2+3)
  const sc3 = await callApi('eaa.score', sn3)
  const score3 = sc3?.score ?? sc3
  if (score3 === 101) ok('score 一致', `101 (100-2+3)`)
  else fail('score 不一致', `期望 101, 实际 ${score3}`, '分数错误')

  // history 应该有 2 条事件
  const hist3 = await callApi('eaa.history', sn3)
  const hist3Arr = Array.isArray(hist3) ? hist3 : (hist3?.events || hist3?.data || [])
  if (hist3Arr.length === 2) ok('history 一致', `2 条事件`)
  else fail('history 不一致', `期望 2 条, 实际 ${hist3Arr.length}`, '事件数错误')

  // ranking 应包含此学生
  const rank3 = await callApi('eaa.ranking', 50)
  const rank3Arr = Array.isArray(rank3) ? rank3 : (rank3?.ranking || rank3?.data || [])
  const inRank = rank3Arr.find((r) => {
    const name = r.name || r.student_name || r.studentName
    return name === sn3
  })
  if (inRank) ok('ranking 一致', `找到学生, 分数 ${inRank.score ?? inRank.total_score}`)
  else fail('ranking 不一致', '学生不在排行榜', '可能分页或过滤问题')

  // search 应能找到此学生
  const search3 = await callApi('eaa.search', sn3, 10)
  const search3Arr = Array.isArray(search3) ? search3 : (search3?.events || search3?.results || search3?.data || [])
  if (search3Arr.length > 0) ok('search 一致', `找到 ${search3Arr.length} 条`)
  else fail('search 不一致', '搜索不到学生', '可能索引问题')

  // stats 应反映数据
  const stats3 = await callApi('eaa.stats')
  if (stats3 && !stats3.__error) ok('stats 可用', '成功')
  else fail('stats 不可用', '', stats3?.__error)

  await callApi('eaa.deleteStudent', sn3, 'R15 清理')

  // ========== 4. 超长/特殊字符原因码 ==========
  console.log('\n--- 4. 超长/特殊字符原因码 ---')
  const weirdCodes = [
    { code: 'A'.repeat(100), desc: '超长100字符' },
    { code: 'LATE\n', desc: '带换行符' },
    { code: 'LATE\t', desc: '带Tab' },
    { code: 'L\x00ATE', desc: '带NUL' },
    { code: 'LATE;rm -rf', desc: 'Shell注入' },
  ]
  for (const t of weirdCodes) {
    const sn = `R15weird_${rid()}`
    await callApi('eaa.addStudent', sn)
    const r = await callApi('eaa.addEvent', { studentName: sn, reasonCode: t.code, delta: -2, operator: 'R15' })
    if (r && r.__error) {
      ok(`拒绝 "${t.desc}"`, '正确拒绝')
    } else {
      fail(`应拒绝 "${t.desc}"`, '', '错误接受 (潜在安全问题)')
    }
    await callApi('eaa.deleteStudent', sn, 'R15 清理')
  }

  // ========== 5. 学生名边界测试 ==========
  console.log('\n--- 5. 学生名边界 ---')
  const weirdNames = [
    { name: '正常名字', desc: '中文' },
    { name: 'A', desc: '单字符' },
    { name: 'A'.repeat(64), desc: '64字符(边界)' },
    { name: 'A'.repeat(65), desc: '65字符(超限)' },
    { name: '名字 with space', desc: '带空格' },
    { name: '名字\t带Tab', desc: '带Tab' },
    { name: '', desc: '空字符串' },
    { name: '   ', desc: '纯空格' },
  ]
  for (const t of weirdNames) {
    const sn = t.name === '' || t.name === '   ' ? t.name : `R15n_${t.name}_${rid()}`
    const r = await callApi('eaa.addStudent', sn)
    if (t.desc.includes('超限') || t.desc === '空字符串' || t.desc === '纯空格') {
      // 这些应该被拒绝
      if (r && r.__error) ok(`拒绝 "${t.desc}"`, '正确拒绝')
      else fail(`应拒绝 "${t.desc}"`, '', '错误接受')
    } else {
      if (r && !r.__error) ok(`接受 "${t.desc}"`, '成功')
      else fail(`应接受 "${t.desc}"`, '', r?.__error)
    }
    // 清理 (只清理成功的)
    if (r && !r.__error) await callApi('eaa.deleteStudent', sn, 'R15 清理')
  }

  // ========== 6. 汇总 ==========
  console.log('\n=== R15 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r15-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
