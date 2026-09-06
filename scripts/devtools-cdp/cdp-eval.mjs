// CDP eval utility — connects to the running Electron app's CDP endpoint (port 9222),
// evaluates a JS expression in the renderer page, and prints the JSON result.
// Usage:
//   node scripts/cdp-eval.mjs "<js expression>"
//   node scripts/cdp-eval.mjs --file <path-to-js-file>
//   node scripts/cdp-eval.mjs --await "<async js expression>"
import { connectCdp } from '../lib/cdp-client.mjs'

// 经共用库连接;--await 由调用方包裹 IIFE 后统一走 awaitPromise 求值
// (原实现把 timeout 误传进 Runtime.evaluate params,现由 send 层真正生效)
async function evalInPage(expression, { awaitPromise = false, timeout = 30000 } = {}) {
  const { send, close } = await connectCdp()
  const result = await send(
    'Runtime.evaluate',
    { expression, awaitPromise, returnByValue: true },
    timeout,
  )
  close()
  if (result.result?.exceptionDetails) {
    const d = result.result.exceptionDetails
    return { __error: d.exception?.description || d.text }
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
  // --await 时把表达式包进 async IIFE：
  // Runtime.evaluate 在非模块上下文执行，顶层 `await` 会抛 SyntaxError；
  // 包成 (async()=>{ return (expr) })() 后，由 CDP 的 awaitPromise 等待结果。
  // 若表达式已自带 async(如 (async()=>{...})() 或 ;-prefixed IIFE)，则不再包裹。
  if (awaitPromise && !/\basync\b/.test(expression)) {
    expression = `(async () => { return (${expression}); })()`
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
