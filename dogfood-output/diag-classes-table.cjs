// 诊断: 列出班级页表格所有行的内容
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find(x => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = { id: 0, pending: new Map(), ws }
  ws.on('message', (data) => {
    try { const m = JSON.parse(data.toString()); if (m.id && cdp.pending.has(m.id)) { const { resolve, reject } = cdp.pending.get(m.id); cdp.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {}
  })
  cdp.send = (method, params = {}) => new Promise((r, j) => { const id = ++cdp.id; cdp.pending.set(id, { resolve: r, reject: j }); cdp.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (cdp.pending.has(id)) { cdp.pending.delete(id); j(new Error('timeout: ' + method)) } }, 30000) })
  cdp.eval = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }

  await cdp.eval("window.location.hash='/classes'")
  await new Promise(r => setTimeout(r, 3000))

  const rows = await cdp.eval("(function(){var rows=document.querySelectorAll('table tbody tr');var out=[];for(var i=0;i<rows.length;i++){var tds=rows[i].querySelectorAll('td');var tdTexts=[];for(var j=0;j<tds.length;j++){tdTexts.push(tds[j].textContent.trim())}out.push({i:i,tds:tdTexts,html:rows[i].innerHTML.slice(0,100)})}return JSON.stringify(out);})()")
  console.log('=== 班级页表格行 ===')
  JSON.parse(rows).forEach(r => {
    console.log('  行' + r.i + ':', r.tds.join(' | '))
    console.log('    HTML:', r.html)
  })

  // 也检查 API 返回的班级列表
  const apiList = await cdp.eval("(async()=>{try{const r=await window.api.class.list();return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  console.log('\n=== API class.list ===')
  const parsed = JSON.parse(apiList)
  if (parsed?.data) {
    parsed.data.forEach(c => {
      console.log('  ' + c.class_id + ' | ' + c.name + ' | id=' + c.id.slice(0, 8))
    })
  }

  ws.close()
}
main().catch(e => { console.error(e); process.exit(1) })
