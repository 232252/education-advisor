import http from 'node:http'
async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(JSON.parse(data)))
      res.on('error', reject)
    }).on('error', reject)
  })
}
const t = await getTargets()
const page = t.find((x) => x.type === 'page')
console.log('URL:', page?.url)
console.log('Title:', page?.title)
// check if it's dev (vite) or built
let WebSocket = (await import('ws')).default
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('timeout')), 5000) })
const id = 1
ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: '({url: location.href, hasVite: !!window.__vite__, scripts: [...document.scripts].map(s=>s.src).slice(0,5)})', returnByValue: true } }))
ws.on('message', (ev) => {
  const msg = JSON.parse(ev.toString())
  if (msg.id === id) {
    console.log('Page info:', JSON.stringify(msg.result?.result?.value, null, 2))
    process.exit(0)
  }
})
