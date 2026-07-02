// 诊断脚本: 验证级联清理是否真的工作
// 步骤: 创建班级 → 创建学生 → 分班 → 验证 class_id → 删除班级 → 验证 class_id 已清空
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try {
          const j = JSON.parse(d)
          const p = j.find((x) => x.type === 'page')
          resolve(p.webSocketDebuggerUrl)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id)
          this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id
      this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async api(code) {
    const expr = "(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"
    const v = await this.eval(expr)
    if (typeof v === 'string' && v.startsWith('ERR:')) throw new Error(v.slice(4))
    try { return v ? JSON.parse(v) : null } catch (e) { return v }
  }
}

const R = () => Math.floor(Math.random() * 100000).toString(36)

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== 级联清理诊断 ===\n')

  // Step 1: 创建测试班级
  const cid = 'C-DIAG-' + R()
  const className = '诊断班' + R().slice(0, 4)
  const createRes = await cdp.api("await window.api.class.create({class_id:'" + cid + "',name:'" + className + "',grade:'高一',teacher:'测试老师'})")
  console.log('1. 创建班级:', createRes?.success ? '✓ ' + className + ' (' + cid + ')' : '✗ ' + JSON.stringify(createRes))
  if (!createRes?.success) { process.exit(1) }

  // Step 1.5: 获取数据库 id (UUID) — class.delete 需要 id 不是 class_id
  const listCls = await cdp.api('await window.api.class.list()')
  const cls = (listCls?.data ?? []).find(c => c.class_id === cid)
  console.log('   数据库记录: id=' + cls?.id + ', class_id=' + cls?.class_id)
  if (!cls) { console.log('✗ 找不到刚创建的班级'); process.exit(1) }

  // Step 2: 创建测试学生
  const studentName = '诊断生' + R().slice(0, 5)
  const addRes = await cdp.api("await window.api.eaa.addStudent('" + studentName + "')")
  console.log('2. 创建学生:', addRes?.success ? '✓ ' + studentName : '✗ ' + JSON.stringify(addRes))

  // Step 3: 分班
  const assignRes = await cdp.api("await window.api.class.assign({class_id:'" + cid + "',student_names:['" + studentName + "']})")
  console.log('3. 分班:', assignRes?.success ? '✓ assigned=' + assignRes.assigned : '✗ ' + JSON.stringify(assignRes))

  // Step 4: 验证 class_id 已设置
  const listRes1 = await cdp.api('await window.api.eaa.listStudents()')
  const students1 = listRes1?.data?.students ?? []
  const student1 = students1.find(s => s.name === studentName)
  console.log('4. 验证 class_id:')
  console.log('   学生:', JSON.stringify(student1, null, 2))
  if (student1?.class_id === cid) {
    console.log('   ✓ class_id 正确设置: ' + student1.class_id)
  } else {
    console.log('   ✗ class_id 未设置! 期望=' + cid + ' 实际=' + student1?.class_id)
  }

  // Step 5: 删除班级 (应该触发级联清理) — 用数据库 id 不是 class_id
  console.log('\n5. 删除班级 (应触发级联清理)...')
  const deleteRes = await cdp.api("await window.api.class.delete('" + cls.id + "')")
  console.log('   删除结果:', JSON.stringify(deleteRes))
  console.log('   result.classId:', deleteRes?.classId, '(应为 ' + cid + ')')

  // Step 6: 验证 class_id 已被清空
  const listRes2 = await cdp.api('await window.api.eaa.listStudents()')
  const students2 = listRes2?.data?.students ?? []
  const student2 = students2.find(s => s.name === studentName)
  console.log('\n6. 删除后验证 class_id:')
  console.log('   学生:', JSON.stringify(student2, null, 2))
  if (student2 && student2.class_id === null) {
    console.log('   ✓ 级联清理成功! class_id 已清空')
  } else if (student2 && student2.class_id === cid) {
    console.log('   ✗ 级联清理失败! class_id 仍指向已删除班级: ' + student2.class_id)
  } else {
    console.log('   ? 意外状态: class_id=' + student2?.class_id)
  }

  // 清理: 删除测试学生
  await cdp.api("await window.api.eaa.deleteStudent('" + studentName + "','诊断清理')")
  console.log('\n7. 清理测试学生完成')

  ws.close()
  console.log('\n=== 诊断完成 ===')
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
