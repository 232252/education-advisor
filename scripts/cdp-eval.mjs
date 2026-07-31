// CDP eval utility — connects to the running Electron app's CDP endpoint (port 9222),
// evaluates a JS expression in the renderer page, and prints the JSON result.
// Usage:
//   node scripts/cdp-eval.mjs "<js expression>"
//   node scripts/cdp-eval.mjs --file <path-to-js-file>
//   node scripts/cdp-eval.mjs --await "<async js expression>"
import WebSocket from 'ws'

const CDP_HTTP = `http://localhost:${process.env.EA_CDP_PORT || '9222'}`

async function getPageTarget() {
  const res = await fetch(`${CDP_HTTP}/json`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('No page target found. Is the app running with CDP?')
  return page
}

async function evalInPage(expression, { awaitPromise = false, timeout = 30000 } = {}) {
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
    new Promise((resolve) => {
      const myId = id++
      pending.set(myId, resolve)
      ws.send(JSON.stringify({ id: myId, method, params }))
    })
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    timeout,
  })
  ws.close()
  if (result.result?.exceptionDetails) {
    return { __error: result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text }
  }
  return result.result?.result?.value
}

async function main() {
  const args = process.argv.slice(2)
  let expression = ''
  let awaitPromise = false
  let timeout = 30000
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--await') {
      awaitPromise = true
    } else if (args[i] === '--timeout') {
      timeout = Number.parseInt(args[++i], 10) || 30000
    } else if (args[i] === '--file') {
      expression = await import('node:fs').then((fs) => fs.readFileSync(args[++i], 'utf8'))
    } else {
      expression += args[i] + ' '
    }
  }
  expression = expression.trim()
  if (!expression) {
    console.error('Usage: node scripts/cdp-eval.mjs "<js expression>" [--await] [--timeout ms] [--file path]')
    process.exit(1)
  }
  try {
    const value = await evalInPage(expression, { awaitPromise, timeout })
    console.log(JSON.stringify(value, null, 2))
  } catch (e) {
    console.error('CDP eval failed:', e.message)
    process.exit(1)
  }
}

main()
