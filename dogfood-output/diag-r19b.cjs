// 诊断 R19b 的 PermissionDenied 错误
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

  console.log('=== R19b PermissionDenied 诊断 ===\n')

  // 1. 检查 EAA info
  const info = await cdp.eval(`(async()=>{try{const r=await window.api.eaa.info();return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`)
  console.log('EAA.info:', info)

  // 2. 检查 EAA doctor
  const doc = await cdp.eval(`(async()=>{try{const r=await window.api.eaa.doctor();return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`)
  console.log('EAA.doctor:', doc)

  // 3. 尝试 addStudent
  const tname = 'DiagR19b_' + Date.now().toString(36)
  const addR = await cdp.eval(`(async()=>{try{const r=await window.api.eaa.addStudent(${JSON.stringify(tname)});return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`)
  console.log(`EAA.addStudent(${tname}):`, addR)

  // 4. 尝试 listStudents
  const listR = await cdp.eval(`(async()=>{try{const r=await window.api.eaa.listStudents();return JSON.stringify({len: r?.students?.length || r?.length, type: typeof r, keys: Object.keys(r||{})})}catch(e){return 'ERR:'+e.message}})()`)
  console.log('EAA.listStudents:', listR)

  // 5. 检查 profile 文件路径
  const profPath = await cdp.eval(`(async()=>{try{const r=await window.api.sys.getPath('userData');return r}catch(e){return 'ERR:'+e.message}})()`)
  console.log('sys.getPath(userData):', profPath)

  // 6. 检查 .lock 文件
  const lockCheck = await cdp.eval(`(async()=>{try{const fs=require('fs');const p=${JSON.stringify('C:/Users/sq199/AppData/Roaming/Education Advisor/eaa-data/.lock')};const stat=fs.statSync(p);return JSON.stringify({size:stat.size,mtime:stat.mtime,exists:true})}catch(e){return 'ERR:'+e.message}})()`)
  console.log('.lock file:', lockCheck)

  // 7. 尝试读取 entities.json (EAA 数据文件)
  const entRead = await cdp.eval(`(async()=>{try{const fs=require('fs');const p='C:/Users/sq199/AppData/Roaming/Education Advisor/eaa-data/entities/entities.json';const data=JSON.parse(fs.readFileSync(p,'utf-8'));return JSON.stringify({len: data?.length || Object.keys(data||{}).length, type: typeof data})}catch(e){return 'ERR:'+e.message}})()`)
  console.log('entities.json:', entRead)

  // 8. 尝试 profile.set 写入一个临时文件
  const writeTest = await cdp.eval(`(async()=>{try{const fs=require('fs');const p='C:/Users/sq199/AppData/Roaming/Education Advisor/eaa-data/profiles/test-diag.json';fs.writeFileSync(p, JSON.stringify({test: true}));return 'OK'}catch(e){return 'ERR:'+e.message}})()`)
  console.log('write test to profiles/:', writeTest)

  // 9. 测试 profile.set 通过 IPC
  const profSet = await cdp.eval(`(async()=>{try{const r=await window.api.profile.set('DiagStudent', {note:'test'});return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`)
  console.log('profile.set(DiagStudent):', profSet)

  // 10. 检查日志
  const logCheck = await cdp.eval(`(async()=>{try{const fs=require('fs');const p='C:/Users/sq199/AppData/Roaming/Education Advisor/logs/main-2026-07-01.log';const data=fs.readFileSync(p,'utf-8');const lines=data.split('\\n').slice(-30);return lines.join('\\n')}catch(e){return 'ERR:'+e.message}})()`)
  console.log('\n--- main 日志最后 30 行 ---')
  console.log(logCheck)

  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
