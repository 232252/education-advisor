// CDP diagnostic script — captures page state and console errors
import WebSocket from 'ws'

const CDP_HTTP = `http://localhost:${process.env.EA_CDP_PORT || '9222'}`

async function getPageTarget() {
  const res = await fetch(`${CDP_HTTP}/json`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('No page target found')
  return page
}

async function main() {
  const page = await getPageTarget()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  let id = 1
  const pending = new Map()
  const logs = []
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown' || msg.method === 'Log.entryAdded') {
      logs.push({ method: msg.method, params: msg.params })
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = id++
      pending.set(myId, resolve)
      ws.send(JSON.stringify({ id: myId, method, params }))
      setTimeout(() => reject(new Error(`${method} timeout`)), 15000)
    })

  await send('Runtime.enable')
  await send('Console.enable')
  await send('Log.enable')

  // Collect log entries
  await send('Log.startViolationsReport', { config: [{ name: 'longTask', threshold: 200 }] })

  const expr = `(() => {
    const root = document.getElementById('root');
    const bodyText = document.body ? document.body.innerText.substring(0, 1000) : 'no body';
    const errorElements = document.querySelectorAll('[class*="error"], [class*="Error"]');
    const errorTexts = Array.from(errorElements).map(e => e.innerText.substring(0, 300));
    const hasContent = root && root.children.length > 0;
    const rootHTML = root ? root.innerHTML.substring(0, 2000) : 'no root';
    return JSON.stringify({
      url: location.href,
      readyState: document.readyState,
      title: document.title,
      hasContent,
      bodyText,
      errorTexts,
      rootHTMLPreview: rootHTML
    });
  })()`

  const result = await send('Runtime.evaluate', { expression: expr, returnByValue: true })

  // Wait a bit for log collection
  await new Promise((r) => setTimeout(r, 2000))

  ws.close()

  console.log('=== PAGE STATE ===')
  console.log(result.result?.result?.value || result.result)

  console.log('\n=== CONSOLE LOGS / EXCEPTIONS ===')
  for (const log of logs) {
    if (log.method === 'Runtime.exceptionThrown') {
      console.log('EXCEPTION:', log.params.exceptionDetails?.exception?.description || log.params.exceptionDetails?.text)
    } else if (log.method === 'Runtime.consoleAPICalled') {
      const args = (log.params.args || []).map((a) => a.value || a.description || a.type).join(' ')
      console.log(`CONSOLE.${log.params.type}:`, args)
    } else if (log.method === 'Log.entryAdded') {
      console.log('LOG:', log.params.entry?.level, log.params.entry?.text)
    }
  }

  process.exit(0)
}

main().catch((e) => {
  console.error('diag failed:', e.message)
  process.exit(1)
})
