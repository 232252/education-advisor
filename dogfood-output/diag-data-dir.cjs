// 诊断 EAA 数据目录和 events.json
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
  cdp.send = (method, params = {}) => new Promise((r, j) => { const id = ++cdp.id; cdp.pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (cdp.pending.has(id)) { cdp.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 15000) })
  cdp.eval = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 12000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }

  console.log('=== 诊断 EAA 数据目录 ===')
  // 通过 sys API 获取数据目录
  const dataDir = await cdp.eval("(async()=>{try{return await window.api.system.getDataDir()}catch(e){return 'ERR:'+e.message}})()")
  console.log('getDataDir:', dataDir)

  // 通过 settings API 获取
  const settings = await cdp.eval("(async()=>{try{const s=await window.api.settings.getAll();return JSON.stringify({dataDir:s.general?.dataDir,eaaDataDir:s.general?.eaaDataDir,general:s.general})}catch(e){return 'ERR:'+e.message}})()")
  console.log('settings:', settings)

  // 调用 EAA info 看看
  const info = await cdp.eval("(async()=>{try{const r=await window.api.eaa.info();return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  console.log('eaa.info:', info?.slice(0, 400))

  // 调用 EAA doctor
  const doctor = await cdp.eval("(async()=>{try{const r=await window.api.eaa.doctor();return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  console.log('eaa.doctor:', doctor?.slice(0, 400))

  // 尝试 addEvent 看看错误细节
  const addEv = await cdp.eval("(async()=>{try{const r=await window.api.eaa.addEvent({studentName:'测试诊断',reasonCode:'LATE',delta:-2});return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  console.log('addEvent:', addEv?.slice(0, 400))

  // 尝试 addStudent
  const addSt = await cdp.eval("(async()=>{try{const r=await window.api.eaa.addStudent('诊断学生X');return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  console.log('addStudent:', addSt?.slice(0, 400))

  // 检查 EAA bridge 数据目录
  const bridgeInfo = await cdp.eval("(async()=>{try{const r=await window.api.system.getInfo();return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  console.log('sys.getInfo:', bridgeInfo?.slice(0, 400))

  ws.close()
  process.exit(0)
}
main().catch(e => { console.log('ERR:', e.message); process.exit(1) })
