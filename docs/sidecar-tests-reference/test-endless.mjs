// 持续测试循环 — 反复跑综合套件直到手动中断
// 每轮用独立数据目录，记录结果到 test-results/endless-loop.log
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const LOG = resolve(ROOT, 'test-results', 'endless-loop.log')
if (!existsSync(resolve(ROOT, 'test-results'))) mkdirSync(resolve(ROOT, 'test-results'), { recursive: true })

function ts() { return new Date().toISOString() }

function log(msg) {
  const line = `[${ts()}] ${msg}`
  console.log(line)
  appendFileSync(LOG, line + '\n')
}

async function runOneRound(roundNum) {
  return new Promise((resolveP) => {
    const child = spawn('node', [resolve(ROOT, 'sidecar/run-all-tests.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', () => {}) // 丢弃 stderr
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 600000)
    child.on('close', (code) => {
      clearTimeout(timer)
      const passed = out.includes('✅ 全部通过')
      const match = out.match(/总测试项[:：]\s*(\d+)\s*通过\s*\/\s*(\d+)\s*失败/)
      const p = match ? parseInt(match[1]) : '?'
      const f = match ? parseInt(match[2]) : '?'
      resolveP({ round: roundNum, code, passed, testsPass: p, testsFail: f })
    })
  })
}

async function main() {
  log('═══ 持续测试循环启动 ═══')
  log('每轮跑 8 套件 (全通道/压力/边界/持久化/子系统/分数/混沌/并发)')
  log('Ctrl+C 中断\n')

  let round = 1
  let totalPass = 0, totalFail = 0
  while (true) {
    log(`▶ 第 ${round} 轮开始...`)
    const t0 = Date.now()
    try {
      const r = await runOneRound(round)
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      const icon = r.passed ? '✅' : '❌'
      log(`  ${icon} 第 ${round} 轮: exit=${r.code}, ${r.testsPass}通过/${r.testsFail}失败 (${elapsed}s)`)
      if (r.testsFail !== '?') { totalPass += r.testsPass; totalFail += r.testsFail }
      if (!r.passed) {
        log(`  ⚠️ 第 ${round} 轮有失败！检查上方输出`)
      }
    } catch (e) {
      log(`  ❌ 第 ${round} 轮异常: ${e.message}`)
    }
    log(`  累计: ${totalPass}通过 / ${totalFail}失败 (${round}轮)\n`)
    round++
    // 短暂休息
    await new Promise(r => setTimeout(r, 2000))
  }
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1) })
