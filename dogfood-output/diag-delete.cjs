// 详细诊断 deleteStudent 调用
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

  console.log('=== 诊断 deleteStudent ===')

  // 测试 1: 不带 options
  console.log('\n--- 测试 1: deleteStudent 不带 options ---')
  let r = await cdp.eval("(async()=>{try{const r=await window.api.eaa.deleteStudent('诊断学生X');return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  console.log('结果:', r)

  // 测试 2: 带 confirm:true
  console.log('\n--- 测试 2: deleteStudent 带 confirm:true ---')
  r = await cdp.eval("(async()=>{try{const r=await window.api.eaa.deleteStudent('诊断学生X',{confirm:true});return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  console.log('结果:', r)

  // 测试 3: 带 confirm:true 和 reason
  console.log('\n--- 测试 3: deleteStudent 带 confirm:true 和 reason ---')
  r = await cdp.eval("(async()=>{try{const r=await window.api.eaa.deleteStudent('诊断学生X',{confirm:true,reason:'测试清理'});return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  console.log('结果:', r)

  // 测试 4: 检查 preload 中 deleteStudent 的签名
  console.log('\n--- 测试 4: 检查 preload API ---')
  r = await cdp.eval("(typeof window.api.eaa.deleteStudent)")
  console.log('deleteStudent 类型:', r)
  r = await cdp.eval("window.api.eaa.deleteStudent.toString()")
  console.log('deleteStudent 实现:', r)

  // 测试 5: 检查 IPC 通道
  console.log('\n--- 测试 5: 直接调用 ipcRenderer ---')
  r = await cdp.eval("(async()=>{try{const {ipcRenderer}=require('electron');const r=await ipcRenderer.invoke('eaa:delete-student','诊断学生X',{confirm:true,reason:'测试清理'});return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  console.log('ipcRenderer 结果:', r)

  // 测试 6: 验证学生是否存在
  console.log('\n--- 测试 6: 验证学生 ---')
  r = await cdp.eval("(async()=>{try{const r=await window.api.eaa.listStudents();const s=(r.data?.students||[]).find(x=>x.name==='诊断学生X');return s?JSON.stringify(s):'NOT_FOUND'}catch(e){return 'ERR:'+e.message}})()")
  console.log('诊断学生X:', r)

  ws.close()
  process.exit(0)
}
main().catch(e => { console.log('ERR:', e.message); process.exit(1) })
