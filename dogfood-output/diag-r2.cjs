// 诊断脚本: 验证 R2 发现的问题
const http = require('http')
const WebSocket = require('ws')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find(t => t.type === 'page')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(r => this.ws.on('open', r))
    this.id = 0; this.pending = new Map()
    this.ws.on('message', msg => {
      const obj = JSON.parse(msg)
      if (obj.id && this.pending.has(obj.id)) {
        const { resolve, reject } = this.pending.get(obj.id)
        this.pending.delete(obj.id)
        if (obj.error) reject(new Error(JSON.stringify(obj.error)))
        else resolve(obj.result)
      }
    })
  }
  async send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  close() { if (this.ws) this.ws.close() }
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('=== 诊断 ===')

  // 1. window.api.class 是否存在 + assign/remove 类型
  const classCheck = await c.eval(`(function(){
    const cls = window.api.class
    return {
      hasClass: !!cls,
      classType: typeof cls,
      keys: cls ? Object.keys(cls) : [],
      assignType: cls ? typeof cls.assign : 'N/A',
      removeStudentType: cls ? typeof cls.removeStudent : 'N/A',
      removeType: cls ? typeof cls.remove : 'N/A'
    }
  })()`)
  console.log('class 模块:', JSON.stringify(classCheck, null, 2))

  // 2. eaa.revertEvent 签名
  const eaaCheck = await c.eval(`(function(){
    const eaa = window.api.eaa
    return {
      revertEventType: typeof eaa.revertEvent,
      revertEventLength: eaa.revertEvent.length,
      setStudentMetaType: typeof eaa.setStudentMeta,
      setStudentMetaLength: eaa.setStudentMeta.length,
      addStudentType: typeof eaa.addStudent,
      deleteStudentType: typeof eaa.deleteStudent
    }
  })()`)
  console.log('eaa 签名:', JSON.stringify(eaaCheck, null, 2))

  // 3. privacy.add 签名
  const privacyCheck = await c.eval(`(function(){
    const p = window.api.privacy
    return {
      addType: typeof p.add,
      addLength: p.add.length
    }
  })()`)
  console.log('privacy.add 签名:', JSON.stringify(privacyCheck, null, 2))

  // 4. eaa.setStudentMeta 用正确参数名测试
  // 先 addStudent 一个
  const testStu = `diag-${Date.now()}`
  await c.eval(`(async()=>{ await window.api.eaa.addStudent(${JSON.stringify(testStu)}) })()`)
  await sleep(100)
  // 看 setStudentMeta 的 handler 期望什么参数
  const setMeta1 = await c.eval(`(async()=>{
    try {
      return await window.api.eaa.setStudentMeta({ studentName: ${JSON.stringify(testStu)}, classId: 'T8-1' })
    } catch(e) { return 'ERR1: ' + e.message }
  })()`)
  console.log('setStudentMeta({studentName, classId}):', JSON.stringify(setMeta1).slice(0, 200))

  // 尝试其他参数名
  const setMeta2 = await c.eval(`(async()=>{
    try {
      return await window.api.eaa.setStudentMeta({ name: ${JSON.stringify(testStu)}, class_id: 'T8-1' })
    } catch(e) { return 'ERR2: ' + e.message }
  })()`)
  console.log('setStudentMeta({name, class_id}):', JSON.stringify(setMeta2).slice(0, 200))

  // 看 setStudentMeta 期望什么参数(看 handler)
  const setMeta3 = await c.eval(`(async()=>{
    try {
      // 直接传字符串试试
      return await window.api.eaa.setStudentMeta(${JSON.stringify(testStu)}, 'T8-1')
    } catch(e) { return 'ERR3: ' + e.message }
  })()`)
  console.log('setStudentMeta(name, classId):', JSON.stringify(setMeta3).slice(0, 200))

  // 5. eaa.info 看 deleteStudent 后是否真的删除
  const infoBefore = await c.eval(`(async()=>{ return await window.api.eaa.info() })()`)
  console.log('info before delete:', JSON.stringify(infoBefore).slice(0, 200))

  const listBefore = await c.eval(`(async()=>{ return await window.api.eaa.listStudents() })()`)
  const beforeCount = listBefore?.data?.students?.length || listBefore?.data?.length || 0
  console.log('listStudents before delete count:', beforeCount)

  const delRes = await c.eval(`(async()=>{ return await window.api.eaa.deleteStudent(${JSON.stringify(testStu)}, 'diag-test') })()`)
  console.log('deleteStudent result:', JSON.stringify(delRes).slice(0, 200))

  await sleep(200)

  const infoAfter = await c.eval(`(async()=>{ return await window.api.eaa.info() })()`)
  console.log('info after delete:', JSON.stringify(infoAfter).slice(0, 200))

  const listAfter = await c.eval(`(async()=>{ return await window.api.eaa.listStudents() })()`)
  const afterCount = listAfter?.data?.students?.length || listAfter?.data?.length || 0
  console.log('listStudents after delete count:', afterCount)

  // 6. chat.loadMessages 实现
  const sessionTest = `diag-session-${Date.now()}`
  const saveMsg = await c.eval(`(async()=>{
    return await window.api.chat.saveMessage({ sessionId: ${JSON.stringify(sessionTest)}, role: 'user', content: 'diag test', timestamp: Date.now() })
  })()`)
  console.log('chat.saveMessage:', JSON.stringify(saveMsg).slice(0, 200))

  const loadMsg = await c.eval(`(async()=>{
    return await window.api.chat.loadMessages(${JSON.stringify(sessionTest)})
  })()`)
  console.log('chat.loadMessages:', JSON.stringify(loadMsg).slice(0, 300))

  const listSess = await c.eval(`(async()=>{ return await window.api.chat.listSessions() })()`)
  console.log('chat.listSessions:', JSON.stringify(listSess).slice(0, 300))

  // 清理
  await c.eval(`(async()=>{ await window.api.chat.deleteSession(${JSON.stringify(sessionTest)}) })()`)

  // 7. eaa.revertEvent 正确签名: (eventId, reason)
  // 先 addEvent 拿到 eventId
  const addEv = await c.eval(`(async()=>{
    return await window.api.eaa.addEvent({ studentName: 'diag-test-stu', reasonCode: 'LATE' })
  })()`)
  console.log('addEvent result:', JSON.stringify(addEv).slice(0, 200))

  // addStudent first
  await c.eval(`(async()=>{ await window.api.eaa.addStudent('diag-test-stu') })()`)
  await sleep(100)
  const addEv2 = await c.eval(`(async()=>{
    return await window.api.eaa.addEvent({ studentName: 'diag-test-stu', reasonCode: 'LATE' })
  })()`)
  console.log('addEvent2 result:', JSON.stringify(addEv2).slice(0, 200))

  // 拿 history 找 event_id
  const hist = await c.eval(`(async()=>{ return await window.api.eaa.history('diag-test-stu') })()`)
  console.log('history:', JSON.stringify(hist).slice(0, 400))

  // 8. eaa.codes 返回结构
  const codes = await c.eval(`(async()=>{ return await window.api.eaa.codes() })()`)
  console.log('eaa.codes type:', typeof codes, 'isArray:', Array.isArray(codes), 'keys:', codes ? Object.keys(codes).slice(0, 5) : 'N/A')
  console.log('eaa.codes sample:', JSON.stringify(codes).slice(0, 300))

  // 清理
  await c.eval(`(async()=>{ await window.api.eaa.deleteStudent('diag-test-stu', 'cleanup') })()`)

  c.close()
  console.log('=== 诊断完成 ===')
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1) })
