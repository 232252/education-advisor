// 测试运行器 — 通用框架
// 启动 sidecar, 按矩阵调用每个通道, 报告结果
// 支持多轮: 每轮用独立数据目录, 避免污染
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { CHANNEL_MATRIX, TESTABLE } from './test-all-channels.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(ROOT, 'test-results')
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

function startSidecar(dataDir) {
  const child = spawn('node', [resolve(ROOT, 'sidecar/edu-sidecar.mjs')], {
    env: {
      ...process.env,
      EDU_APP_DATA_DIR: dataDir,
      EDU_RESOURCE_DIR: ROOT,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1

  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ready timeout 25s')), 25000)
    const checker = (line) => {
      try {
        const m = JSON.parse(line)
        if (m.type === 'event' && m.channel === '__sidecar__:ready') {
          clearTimeout(t)
          rl.off('line', checker)
          resolve(m.data)
        }
      } catch {}
    }
    rl.on('line', checker)
  })

  rl.on('line', (line) => {
    let m
    try { m = JSON.parse(line) } catch { return }
    if (m.type === 'result' && m.id != null) {
      const p = pending.get(m.id)
      if (p) {
        pending.delete(m.id)
        if (m.ok) p.resolve(m.data)
        else p.reject(new Error(m.error || 'unknown'))
      }
    }
  })

  function invoke(channel, args) {
    const id = nextId++
    return new Promise((resolveP, rejectP) => {
      pending.set(id, { resolve: resolveP, reject: rejectP })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel, args }) + '\n')
    })
  }

  function shutdown() {
    try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {}
    setTimeout(() => { try { child.kill() } catch {} }, 800)
  }

  return { ready, invoke, shutdown, child }
}

async function runRound(roundName, dataDir, timeoutMs = 120000) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  测试轮次: ${roundName}`)
  console.log(`  数据目录: ${dataDir}`)
  console.log(`${'='.repeat(60)}\n`)

  const sidecar = startSidecar(dataDir)
  const results = []
  let pass = 0, fail = 0, expectedFail = 0, unexpectedFail = 0

  try {
    const readyData = await sidecar.ready
    console.log(`✅ Sidecar 就绪 — ${readyData.channels.length} 通道\n`)

    for (const t of TESTABLE) {
      const started = Date.now()
      try {
        const result = await Promise.race([
          sidecar.invoke(t.ch, t.args),
          new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)),
        ])
        const elapsed = Date.now() - started
        const summary = summarize(result)
        console.log(`  ✓ ${t.ch.padEnd(24)} ${t.desc.padEnd(20)} (${elapsed}ms) → ${summary}`)
        pass++
        results.push({ ch: t.ch, desc: t.desc, status: 'pass', elapsed, summary })
      } catch (e) {
        const elapsed = Date.now() - started
        const msg = e.message
        if (t.expectFail) {
          console.log(`  ~ ${t.ch.padEnd(24)} ${t.desc.padEnd(20)} (${elapsed}ms) → 预期失败: ${msg.slice(0, 60)}`)
          expectedFail++
          results.push({ ch: t.ch, desc: t.desc, status: 'expected_fail', elapsed, error: msg })
        } else {
          console.log(`  ✗ ${t.ch.padEnd(24)} ${t.desc.padEnd(20)} (${elapsed}ms) → 意外失败: ${msg.slice(0, 80)}`)
          fail++
          unexpectedFail++
          results.push({ ch: t.ch, desc: t.desc, status: 'fail', elapsed, error: msg })
        }
      }
    }
  } finally {
    sidecar.shutdown()
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  结果: ${pass} 通过 / ${expectedFail} 预期失败 / ${fail} 意外失败 (共 ${TESTABLE.length})`)
  console.log(`${'─'.repeat(60)}\n`)

  // 写结果文件
  const report = {
    round: roundName,
    timestamp: new Date().toISOString(),
    dataDir,
    summary: { total: TESTABLE.length, pass, expectedFail, fail: unexpectedFail },
    results,
  }
  const safeName = roundName.replace(/[^a-zA-Z0-9_-]/g, '_')
  writeFileSync(resolve(RESULTS_DIR, `${safeName}.json`), JSON.stringify(report, null, 2))

  return report
}

function summarize(result) {
  if (result === null || result === undefined) return 'null'
  if (Array.isArray(result)) return `array[${result.length}]`
  if (typeof result === 'object') {
    const keys = Object.keys(result).slice(0, 5)
    if (result.success === false) return `{success:false${result.error ? ',error}' : '}'}`.replace('}', `:${String(result.error).slice(0, 30)}}`)
    return `object{${keys.join(',')}}`
  }
  return typeof result
}

// 命令行: node harness.mjs <roundName> [dataDirSuffix]
const roundName = process.argv[2] || 'round-default'
const suffix = process.argv[3] || Date.now().toString().slice(-6)
const dataDir = resolve(ROOT, `test-tauri-data-${suffix}`)

runRound(roundName, dataDir)
  .then((r) => process.exit(r.summary.fail > 0 ? 1 : 0))
  .catch((e) => { console.error('FATAL', e); process.exit(2) })

export { runRound, startSidecar }
