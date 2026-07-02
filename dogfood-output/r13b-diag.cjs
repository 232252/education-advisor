// R13b: 诊断 R13 中可疑的 "addEvent 显示成功但未写入" 现象
// 假设: SPEAK_IN_CLASS / ACTIVITY_PARTICIPATION / CLASS_MONITOR 的 delta 与 reason-codes.json 标准值不匹配,
//       EAA 返回 {success: false, error: "..."}, 但脚本因没有 !r.__error 而误判为成功
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

  console.log('=== R13b 诊断: addEvent 返回值与实际写入 ===\n')

  // 不 unwrap, 直接看原始返回
  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p)o=o[x];const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }
  // unwrap 版本 (与 R13 一致)
  function unwrap(r) { if (r && r.__error) return r; if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data; return r }
  async function callApi(path, ...args) { return unwrap(await callRaw(path, ...args)) }

  // 1. 先查 reason-codes 标准分值
  console.log('--- 1. reason-codes 标准分值 ---')
  const codes = await callApi('eaa.codes')
  const codesArr = Array.isArray(codes) ? codes : (codes?.codes || codes?.data || [])
  const interesting = ['LATE', 'SPEAK_IN_CLASS', 'ACTIVITY_PARTICIPATION', 'CLASS_MONITOR', 'CIVILIZED_DORM']
  for (const c of codesArr) {
    const code = c.code || c.reason_code || c.name
    if (interesting.includes(code)) {
      console.log(`  ${code}: delta=${c.delta}, desc=${(c.description || c.desc || '').slice(0, 40)}`)
    }
  }

  // 2. 创建一个测试学生
  console.log('\n--- 2. 创建测试学生 ---')
  const tName = 'R13bDiag_' + Date.now().toString(36)
  const addR = await callRaw('eaa.addStudent', tName)
  console.log(`  addStudent 原始返回:`, JSON.stringify(addR).slice(0, 200))
  const addU = unwrap(addR)
  console.log(`  addStudent unwrap:`, JSON.stringify(addU).slice(0, 200))

  // 3. 逐一测试 5 个原因码, 对比 R13 的参数
  console.log('\n--- 3. 逐一测试 5 个原因码 (R13 参数) ---')
  const testCases = [
    { code: 'LATE', delta: -2, label: 'R13 e1' },
    { code: 'SPEAK_IN_CLASS', delta: -1, label: 'R13 e2 (可疑)' },
    { code: 'ACTIVITY_PARTICIPATION', delta: 2, label: 'R13 e3 (可疑)' },
    { code: 'CLASS_MONITOR', delta: 5, label: 'R13 e4 (可疑)' },
    { code: 'CIVILIZED_DORM', delta: 3, label: 'R13 e5' },
  ]

  for (const tc of testCases) {
    console.log(`\n  [${tc.label}] ${tc.code} delta=${tc.delta}`)
    // 用不同的学生避免去重
    const sn = `R13bDiag_${tc.code}_${Date.now().toString(36)}`
    const addStu = await callRaw('eaa.addStudent', sn)
    console.log(`    addStudent:`, JSON.stringify(addStu).slice(0, 100))

    const rawR = await callRaw('eaa.addEvent', { studentName: sn, reasonCode: tc.code, delta: tc.delta, operator: '诊断', note: 'R13b' })
    console.log(`    addEvent 原始返回:`, JSON.stringify(rawR).slice(0, 300))

    const unwR = unwrap(rawR)
    console.log(`    addEvent unwrap:`, JSON.stringify(unwR).slice(0, 200))

    // R13 的判断逻辑: if (e && !e.__error) ok(...)
    const r13Judge = unwR && !unwR.__error ? '✓ (R13 会判定为成功)' : '✗ (R13 会判定为失败)'
    console.log(`    R13 判断逻辑: ${r13Judge}`)

    // 真实写入验证
    const histRaw = await callRaw('eaa.history', sn)
    const histU = unwrap(histRaw)
    const histArr = Array.isArray(histU) ? histU : (histU?.events || histU?.data || [])
    console.log(`    实际历史事件数: ${histArr.length}`)

    const scRaw = await callRaw('eaa.score', sn)
    const scU = unwrap(scRaw)
    const score = scU?.score ?? scU
    console.log(`    实际分数: ${score} (基础100, 期望 ${100 + tc.delta})`)
  }

  // 4. 清理
  console.log('\n--- 4. 清理 ---')
  await callApi('eaa.deleteStudent', tName, 'R13b 清理')

  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
