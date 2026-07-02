// 清理 R53 测试残留学生
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find(x => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = { ws, id: 0, pending: new Map() }
  ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && cdp.pending.has(m.id)) { const { resolve, reject } = cdp.pending.get(m.id); cdp.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} })
  cdp.send = (method, params = {}) => new Promise((r, j) => { const id = ++cdp.id; cdp.pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (cdp.pending.has(id)) { cdp.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 30000) })
  cdp.eval = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  cdp.apiSafe = async (code) => { const v = await cdp.eval("(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"); try { return v ? JSON.parse(v) : null } catch (e) { return v } }

  console.log('=== 清理 R53 残留 ===')
  const list = await cdp.apiSafe('await window.api.eaa.listStudents()')
  const allStudents = list?.data?.students ?? []
  console.log('当前学生总数:', allStudents.length)

  // 删除所有非 Deleted 的测试学生 (R53*, 诊断*)
  const toDelete = allStudents.filter(s => s.status !== 'Deleted' && (s.name.indexOf('R53') >= 0 || s.name.indexOf('诊断') >= 0 || s.name.indexOf('测试') >= 0))
  console.log('待删除:', toDelete.length, '个')
  let deleted = 0
  for (const s of toDelete) {
    const safeName = s.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    // preload 签名: deleteStudent(name, reason?) — preload 自动加 confirm:true
    let r = await cdp.apiSafe("await window.api.eaa.deleteStudent('" + safeName + "','cleanup')")
    if (r?.success) {
      deleted++
      console.log('  删除:', s.name)
    } else {
      console.log('  失败:', s.name, '-', (r?.data || r?.stderr || '').slice(0, 100))
    }
  }
  console.log('清理完成:', deleted + '/' + toDelete.length)

  // 验证
  const list2 = await cdp.apiSafe('await window.api.eaa.listStudents()')
  const remaining = (list2?.data?.students ?? []).filter(s => s.status !== 'Deleted')
  console.log('剩余 Active 学生:', remaining.length)
  if (remaining.length > 0) {
    console.log('样例:', remaining.slice(0, 5).map(s => s.name).join(', '))
  }

  // 清理班级
  const cls = await cdp.apiSafe('await window.api.class.list()')
  const allClasses = cls?.data ?? []
  const toDeleteCls = allClasses.filter(c => c.name && (c.name.indexOf('R53') >= 0 || c.name.indexOf('测试') >= 0))
  let clsDeleted = 0
  for (const c of toDeleteCls) {
    const r = await cdp.apiSafe("await window.api.class.delete('" + c.id + "')")
    if (r?.success) clsDeleted++
  }
  console.log('清理班级:', clsDeleted + '/' + toDeleteCls.length)

  ws.close()
  process.exit(0)
}
main().catch(e => { console.log('ERR:', e.message); process.exit(1) })
