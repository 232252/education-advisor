// CDP page checker — navigates to each route, checks for errors, reports status
import WebSocket from 'ws'

const CDP_HTTP = 'http://localhost:9222'
const PAGES = ['dashboard', 'chat', 'students', 'classes', 'academics', 'agents', 'models', 'skills', 'scheduler', 'privacy', 'settings']

async function getPageTarget() {
  const res = await fetch(`${CDP_HTTP}/json`)
  const targets = await res.json()
  return targets.find((t) => t.type === 'page')
}

async function checkAll() {
  const page = await getPageTarget()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  let id = 1
  const pending = new Map()
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
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

  const results = []
  for (const route of PAGES) {
    // Navigate
    await send('Runtime.evaluate', {
      expression: `location.hash = '#/${route}'`,
    })
    // Wait for render
    await new Promise((r) => setTimeout(r, 1500))

    // Check page state
    const result = await send('Runtime.evaluate', {
      expression: `(() => {
        const body = document.body ? document.body.innerText : '';
        const hasError = body.includes('页面渲染出错了') || body.includes('Minified React error') || body.includes('Something went wrong');
        const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(e => e.innerText.trim()).filter(Boolean).slice(0, 5);
        const buttons = document.querySelectorAll('button').length;
        const links = document.querySelectorAll('a[href]').length;
        const inputs = document.querySelectorAll('input,select,textarea').length;
        return JSON.stringify({ hasError, headings, buttons, links, inputs, bodyPreview: body.substring(0, 200) });
      })()`,
      returnByValue: true,
    })

    const value = JSON.parse(result.result?.result?.value || '{}')
    results.push({ route, ...value })
    console.log(`[${value.hasError ? 'FAIL' : 'OK '}] /${route} — headings: ${value.headings?.join(' | ') || 'none'} — buttons:${value.buttons} links:${value.links} inputs:${value.inputs}`)
    if (value.hasError) {
      console.log(`       ERROR: ${value.bodyPreview}`)
    }
  }

  ws.close()
  console.log('\n=== SUMMARY ===')
  const failed = results.filter((r) => r.hasError)
  if (failed.length === 0) {
    console.log('All 11 pages rendered successfully!')
  } else {
    console.log(`${failed.length} pages failed: ${failed.map((r) => '/' + r.route).join(', ')}`)
  }
  process.exit(0)
}

checkAll().catch((e) => {
  console.error('check failed:', e.message)
  process.exit(1)
})
