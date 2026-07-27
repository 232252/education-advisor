import http from 'node:http'
let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }

const targets = await new Promise((res, rej) => {
  http.get('http://127.0.0.1:9222/json', (r) => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); r.on('error', rej)
  }).on('error', rej)
})
const t = targets.find(x => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('timeout')), 10000) })

const id = 1
// 先导航到设置页 (R121-8 在此页统计), 再检查未标注按钮
const expr = `(async()=>{
  window.location.hash = '#/settings';
  await new Promise(r => setTimeout(r, 800));
  const btns = Array.from(document.querySelectorAll('button'));
  const unlabeled = btns.filter(b => !b.getAttribute('aria-label') && !(b.innerText||'').trim() && !b.getAttribute('title'));
  return { total: btns.length, unlabeledCount: unlabeled.length, unlabeled: unlabeled.map(b => ({
    classes: (b.className||'').slice(0,90),
    html: b.outerHTML.slice(0,180),
    parentTag: b.parentElement?.tagName,
    parentClass: (b.parentElement?.className||'').slice(0,70),
  })) };
})()`
ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
ws.on('message', (m) => {
  const r = JSON.parse(m)
  if (r.id === id) {
    console.log(JSON.stringify(r.result?.result?.value, null, 2))
    ws.close()
    process.exit(0)
  }
})
