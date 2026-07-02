// R16: 验证 R15 发现 + 导出数据一致性 + 并发一致性 + 撤销链
// 1. 确认换行符/Tab 原因码是否被 trim (检查 history 实际 reason_code)
// 2. 确认学生名确切边界 (63/64/65 字符)
// 3. 导出数据一致性 (CSV/JSONL/HTML 中原因码正确)
// 4. 并发 addEvent 一致性 (同时添加多个事件)
// 5. 撤销链 (撤销已被撤销的事件 — 应防止)
// 6. EAA tag/replay 功能验证
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

  console.log('=== R16 验证发现 + 导出一致性 + 并发 + 撤销链 ===\n')
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

  const rid = () => 'r16' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

  // ========== 1. 换行符/Tab 原因码实际写入 ==========
  console.log('--- 1. 换行符/Tab 原因码实际写入 ---')
  for (const [desc, code] of [['换行符', 'LATE\n'], ['Tab', 'LATE\t'], ['CR', 'LATE\r'], ['组合', ' LATE \n']]) {
    const sn = `R16nl_${rid()}`
    await callApi('eaa.addStudent', sn)
    const r = await callApi('eaa.addEvent', { studentName: sn, reasonCode: code, delta: -2, operator: 'R16' })
    if (r && !r.__error) {
      const hist = await callApi('eaa.history', sn)
      const histArr = Array.isArray(hist) ? hist : (hist?.events || hist?.data || [])
      if (histArr.length > 0) {
        const actual = histArr[0].reason_code || histArr[0].reasonCode || histArr[0].code
        const isTrimmed = actual === 'LATE'
        if (isTrimmed) ok(`"${desc}" 被 trim`, `"${code.replace(/\n/g,'\\n').replace(/\t/g,'\\t').replace(/\r/g,'\\r')}" → "LATE"`)
        else fail(`"${desc}" 未 trim`, `实际: "${actual}" (含控制字符)`, 'BUG: 应 trim 控制字符')
      }
    } else {
      fail(`"${desc}" 被拒`, '', r?.__error)
    }
    await callApi('eaa.deleteStudent', sn, 'R16 清理')
  }

  // ========== 2. 学生名确切边界 ==========
  console.log('\n--- 2. 学生名确切边界 ---')
  for (const len of [62, 63, 64, 65, 100]) {
    const name = 'A'.repeat(len)
    const sn = `R16L_${name}`
    const r = await callApi('eaa.addStudent', sn)
    if (len < 64) {
      if (r && !r.__error) ok(`长度 ${len} 接受`, '成功')
      else fail(`长度 ${len} 应接受`, '', r?.__error)
    } else {
      if (r && r.__error) ok(`长度 ${len} 拒绝`, '正确拒绝')
      else fail(`长度 ${len} 应拒绝`, '', '错误接受')
    }
    if (r && !r.__error) await callApi('eaa.deleteStudent', sn, 'R16 清理')
  }

  // ========== 3. 导出数据一致性 ==========
  console.log('\n--- 3. 导出数据一致性 ---')
  // 创建学生 + 添加事件 + 导出 + 验证导出内容包含正确原因码
  const sn3 = `R16exp_${rid()}`
  await callApi('eaa.addStudent', sn3)
  await callApi('eaa.addEvent', { studentName: sn3, reasonCode: 'LATE', delta: -2, operator: 'R16', note: 'R16测试导出' })

  // 导出 JSONL (最容易验证)
  const expR = await callApi('eaa.export', 'jsonl')
  if (expR && !expR.__error) {
    const expStr = typeof expR === 'string' ? expR : JSON.stringify(expR)
    if (expStr.includes(sn3) && expStr.includes('LATE')) {
      ok('JSONL 导出包含数据', `${sn3} + LATE 均在导出中`)
    } else {
      fail('JSONL 导出缺失数据', '', '学生或原因码不在导出中')
    }
    // 检查是否有控制字符 (如果有, 说明 trim 问题)
    if (expStr.includes('LATE\n') || expStr.includes('LATE\t')) {
      fail('JSONL 含控制字符', '', 'BUG: 导出含未 trim 的控制字符')
    } else {
      ok('JSONL 无异常控制字符', '原因码格式干净')
    }
  } else fail('JSONL 导出失败', '', expR?.__error)

  // CSV 导出
  const csvR = await callApi('eaa.export', 'csv')
  if (csvR && !csvR.__error) ok('CSV 导出成功', '')
  else fail('CSV 导出失败', '', csvR?.__error)

  // HTML 导出
  const htmlR = await callApi('eaa.export', 'html')
  if (htmlR && !htmlR.__error) ok('HTML 导出成功', '')
  else fail('HTML 导出失败', '', htmlR?.__error)

  await callApi('eaa.deleteStudent', sn3, 'R16 清理')

  // ========== 4. 并发 addEvent 一致性 ==========
  console.log('\n--- 4. 并发 addEvent 一致性 ---')
  const sn4 = `R16conc_${rid()}`
  await callApi('eaa.addStudent', sn4)
  // 并发添加 5 个不同原因码的事件 (用不同原因码避免去重)
  const concEvents = [
    { reasonCode: 'LATE', delta: -2 },
    { reasonCode: 'SLEEP_IN_CLASS', delta: -2 },
    { reasonCode: 'CIVILIZED_DORM', delta: 3 },
    { reasonCode: 'ACTIVITY_PARTICIPATION', delta: 1 },
    { reasonCode: 'MONTHLY_ATTENDANCE', delta: 2 },
  ]
  const concResults = await Promise.all(
    concEvents.map((e) => callApi('eaa.addEvent', { studentName: sn4, ...e, operator: 'R16' }))
  )
  let concSuccess = 0
  for (const r of concResults) {
    if (r && !r.__error) concSuccess++
  }
  // 期望分数: 100 - 2 - 2 + 3 + 1 + 2 = 102
  const sc4 = await callApi('eaa.score', sn4)
  const score4 = sc4?.score ?? sc4
  if (concSuccess === 5 && score4 === 102) {
    ok('并发 5 事件一致', `全部成功, 分数 ${score4} (期望 102)`)
  } else {
    fail('并发不一致', `成功 ${concSuccess}/5, 分数 ${score4} (期望 102)`, '并发数据不一致')
  }
  // 验证历史事件数
  const hist4 = await callApi('eaa.history', sn4)
  const hist4Arr = Array.isArray(hist4) ? hist4 : (hist4?.events || hist4?.data || [])
  if (hist4Arr.length === 5) ok('并发历史一致', `5 条事件`)
  else fail('并发历史不一致', `期望 5 条, 实际 ${hist4Arr.length}`, '事件丢失')
  await callApi('eaa.deleteStudent', sn4, 'R16 清理')

  // ========== 5. 撤销链 (撤销已被撤销的事件) ==========
  console.log('\n--- 5. 撤销链 ---')
  const sn5 = `R16rev_${rid()}`
  await callApi('eaa.addStudent', sn5)
  const evR = await callApi('eaa.addEvent', { studentName: sn5, reasonCode: 'LATE', delta: -2, operator: 'R16' })
  // 获取事件 ID
  const hist5 = await callApi('eaa.history', sn5)
  const hist5Arr = Array.isArray(hist5) ? hist5 : (hist5?.events || hist5?.data || [])
  if (hist5Arr.length > 0) {
    const evtId = String(hist5Arr[0].id || hist5Arr[0].event_id)
    // 第一次撤销 (应成功)
    const rev1 = await callApi('eaa.revertEvent', evtId, '第一次撤销')
    if (rev1 && !rev1.__error) ok('第一次撤销', '成功')
    else fail('第一次撤销', '', rev1?.__error)
    // 第二次撤销同一事件 (应被拒绝, 防止无限循环)
    const rev2 = await callApi('eaa.revertEvent', evtId, '第二次撤销')
    if (rev2 && rev2.__error) {
      ok('重复撤销被拒', '正确防止无限循环')
    } else {
      // 检查分数是否被重复扣除
      const sc5 = await callApi('eaa.score', sn5)
      const score5 = sc5?.score ?? sc5
      if (score5 === 100) {
        ok('重复撤销幂等', `分数仍 100 (撤销未重复执行)`)
      } else {
        fail('重复撤销异常', `分数 ${score5} (应 100)`, 'BUG: 重复撤销导致分数错误')
      }
    }
  }
  await callApi('eaa.deleteStudent', sn5, 'R16 清理')

  // ========== 6. EAA tag/replay 功能 ==========
  console.log('\n--- 6. EAA tag/replay 功能 ---')
  const tagR = await callApi('eaa.tag')
  if (tagR && !tagR.__error) {
    const tagArr = Array.isArray(tagR) ? tagR : (tagR?.tags || tagR?.data || [])
    ok('tag 查询', `返回 ${tagArr.length} 个标签`)
  } else fail('tag 查询', '', tagR?.__error)

  const replayR = await callApi('eaa.replay')
  if (replayR && !replayR.__error) {
    ok('replay 查询', '成功')
  } else fail('replay 查询', '', replayR?.__error)

  // ========== 7. 汇总 ==========
  console.log('\n=== R16 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r16-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
