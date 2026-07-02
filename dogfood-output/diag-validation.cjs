// 验证特殊字符是否被后端拒绝
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
  })
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })

  let id = 0
  const pending = new Map()
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString())
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
  })

  async function evalJS(expr) {
    const i = ++id
    return new Promise((r, j) => {
      pending.set(i, { resolve: r, reject: j })
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); j(new Error('timeout')) } }, 25000)
    })
  }

  // 清理
  await evalJS(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
  })()`)

  // 测试各种特殊字符 class_id
  const tests = [
    { id: 'NORMAL-1', name: '正常班' },
    { id: 'TEST<>"', name: '尖括号班' },
    { id: 'TEST&amp;', name: '实体班' },
    { id: 'TEST-QUOTE', name: '引号"班"' },
    { id: 'A'.repeat(200), name: '超长ID班' },
    { id: 'UNICODE-中文', name: '中文ID班' },
  ]

  for (const t of tests) {
    const r = await evalJS(`(async()=>{
      const res = await window.api.class.create({ class_id: '${t.id.replace(/'/g, "\\'")}', name: '${t.name.replace(/'/g, "\\'")}' });
      return JSON.parse(JSON.stringify(res));
    })()`)
    const val = r.result?.value
    console.log(`[${t.id.slice(0, 30)}] success=${val?.success} ${val?.success ? '✓' : '✗ ' + (val?.error || JSON.stringify(val).slice(0, 80))}`)
  }

  // 最终检查
  const finalList = await evalJS(`(async()=>{
    const r = await window.api.class.list();
    return r.data?.map(c => c.class_id);
  })()`)
  console.log('\n最终班级列表:', JSON.stringify(finalList.result?.value))

  // 清理
  await evalJS(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
  })()`)

  ws.close()
}
main().catch(e => console.error('FATAL:', e))
