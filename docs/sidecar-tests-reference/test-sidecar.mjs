// Sidecar 验证测试: 发送几个 invoke 请求, 校验返回
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import readline from 'node:readline'

const env = {
  ...process.env,
  EDU_APP_DATA_DIR: process.argv[2] || `${process.cwd()}/test-tauri-data`,
  EDU_RESOURCE_DIR: process.cwd(),
}

const child = spawn('node', ['sidecar/edu-sidecar.mjs'], {
  env,
  stdio: ['pipe', 'pipe', 'inherit'],
})

const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })

let ready = false
const pending = new Map() // id → {resolve, reject, channel}

async function waitForReady() {
  return new Promise((resolve) => {
    const checker = (line) => {
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'event' && msg.channel === '__sidecar__:ready') {
          rl.off('line', checker)
          resolve(msg.data)
        }
      } catch {
        /* not json */
      }
    }
    rl.on('line', checker)
  })
}

rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.type === 'result' && msg.id != null) {
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.data)
      else p.reject(new Error(msg.error || 'unknown'))
    }
  }
})

let nextId = 1
function invoke(channel, ...args) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, channel })
    child.stdin.write(JSON.stringify({ id, type: 'invoke', channel, args }) + '\n')
  })
}

async function main() {
  const readyData = await waitForReady()
  console.log(`\n✅ Sidecar READY — ${readyData.channels.length} channels`)

  const tests = [
    ['eaa:info', []],
    ['eaa:list-students', []],
    ['eaa:ranking', [10]],
    ['eaa:stats', []],
    ['eaa:codes', []],
    ['agent:list', []],
    ['settings:get', []],
    ['skill:list', []],
    ['cron:list', []],
    ['class:list', []],
    ['privacy:status', []],
    ['ai:list-providers', []],
  ]

  let pass = 0
  let fail = 0
  for (const [channel, args] of tests) {
    try {
      const result = await Promise.race([
        invoke(channel, ...args),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 10s')), 10000)),
      ])
      const summary =
        result === null
          ? 'null'
          : Array.isArray(result)
            ? `array[${result.length}]`
            : typeof result === 'object'
              ? `object{${Object.keys(result).slice(0, 5).join(',')}}`
              : typeof result
      console.log(`  ✓ ${channel} → ${summary}`)
      pass++
    } catch (e) {
      console.log(`  ✗ ${channel} → ${e.message}`)
      fail++
    }
  }

  console.log(`\n结果: ${pass} pass / ${fail} fail (共 ${tests.length})`)
  child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n')
  setTimeout(() => {
    child.kill()
    process.exit(fail > 0 ? 1 : 0)
  }, 1000)
}

main().catch((e) => {
  console.error('FATAL', e)
  child.kill()
  process.exit(1)
})
