// 诊断 Toast 创建问题
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

  // 导航到班级页
  await evalJS(`window.location.hash='/classes'`)
  await new Promise(r => setTimeout(r, 1500))

  // 清空
  await evalJS(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
  })()`)
  await new Promise(r => setTimeout(r, 1000))

  // 点击新建班级
  const openResult = await evalJS(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('新建班级'));
    if(!cb) return { error: 'no button' };
    cb.click();
    return { ok: true };
  })()`)
  console.log('打开表单:', JSON.stringify(openResult))
  await new Promise(r => setTimeout(r, 800))

  // 填写表单
  const fillResult = await evalJS(`(function(){
    const inputs = Array.from(document.querySelectorAll('input'));
    if(inputs.length < 2) return { error: 'no inputs', count: inputs.length };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], 'TOAST-VERIFY');
    setter.call(inputs[1], 'Toast验证班');
    inputs[0].dispatchEvent(new Event('input', {bubbles: true}));
    inputs[1].dispatchEvent(new Event('input', {bubbles: true}));
    return { ok: true, count: inputs.length };
  })()`)
  console.log('填写表单:', JSON.stringify(fillResult))

  // 点击保存
  const saveResult = await evalJS(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const sb = btns.find(b => b.textContent?.includes('保存') || b.textContent?.includes('确定'));
    if(!sb) return { error: 'no save button' };
    sb.click();
    return { ok: true };
  })()`)
  console.log('点击保存:', JSON.stringify(saveResult))

  await new Promise(r => setTimeout(r, 2000))

  // 验证
  const verify = await evalJS(`(async()=>{
    const cls = await window.api.class.list();
    const found = cls.data?.find(c => c.class_id === 'TOAST-VERIFY');
    const tableRows = document.querySelectorAll('table tbody tr').length;
    const tableText = Array.from(document.querySelectorAll('table tbody tr')).map(r => r.textContent?.slice(0, 50));
    return { apiFound: !!found, apiName: found?.name, tableRows, tableText };
  })()`)
  console.log('验证结果:', JSON.stringify(verify, null, 2))

  ws.close()
}
main().catch(e => console.error('FATAL:', e))
