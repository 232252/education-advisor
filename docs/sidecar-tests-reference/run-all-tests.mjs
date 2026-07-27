// 第18轮：综合测试套件 — 跑全部测试脚本，汇总报告
// 这是 "醒来看到测试报告" 的核心
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(ROOT, 'test-results')
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

const TESTS = [
  { name: 'R-全通道审计', file: 'harness.mjs', args: ['R18-综合-全通道', 'r18'], timeout: 120000 },
  { name: 'R-压力测试', file: 'test-stress.mjs', args: [], timeout: 180000 },
  { name: 'R-边界安全', file: 'test-boundary.mjs', args: [], timeout: 120000 },
  { name: 'R-持久化', file: 'test-persistence.mjs', args: [], timeout: 120000 },
  { name: 'R-子系统', file: 'test-subsystems.mjs', args: [], timeout: 90000 },
  { name: 'R-分数计算', file: 'test-score-math.mjs', args: [], timeout: 90000 },
  { name: 'R-混沌', file: 'test-chaos.mjs', args: [], timeout: 120000 },
  { name: 'R-并发', file: 'test-concurrent.mjs', args: [], timeout: 180000 },
  { name: 'R-缓存TTL', file: 'test-cache-ttl.mjs', args: [], timeout: 120000 },
  { name: 'R-错误恢复', file: 'test-error-recovery.mjs', args: [], timeout: 120000 },
  { name: 'R-数据一致性', file: 'test-data-consistency.mjs', args: [], timeout: 120000 },
  { name: 'R-全通道v2', file: 'test-all-channels-v2.mjs', args: [], timeout: 120000 },
  { name: 'R-写竞争', file: 'test-write-race.mjs', args: [], timeout: 180000 },
  { name: 'R-前端模拟', file: 'test-frontend-sim.mjs', args: [], timeout: 120000 },
  { name: 'R-边界编码', file: 'test-boundary-encoding.mjs', args: [], timeout: 120000 },
  { name: 'R-设置+隐私', file: 'test-settings-profile.mjs', args: [], timeout: 120000 },
  { name: 'R-Agent/Skill/Cron', file: 'test-agent-skill-cron.mjs', args: [], timeout: 120000 },
  { name: 'R-数据完整性', file: 'test-data-integrity.mjs', args: [], timeout: 120000 },
]

async function runOne(test) {
  return new Promise((resolveP) => {
    const t0 = Date.now()
    const child = spawn('node', [resolve(ROOT, 'sidecar', test.file), ...test.args], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, test.timeout)

    child.on('close', (code) => {
      clearTimeout(timer)
      const elapsed = Date.now() - t0
      // 解析结果
      const passMatch = stdout.match(/(\d+)\s*通过.*?(\d+)\s*失败/)
      const resultMatch = stdout.match(/结果[:：]\s*(\d+)\s*通过\s*\/\s*(\d+)\s*失败/)
      let pass = null, fail = null
      if (resultMatch) { pass = parseInt(resultMatch[1]); fail = parseInt(resultMatch[2]) }
      else if (passMatch) { pass = parseInt(passMatch[1]); fail = parseInt(passMatch[2]) }

      resolveP({
        name: test.name,
        file: test.file,
        exitCode: code,
        elapsed,
        pass, fail,
        status: code === 0 ? 'pass' : (code === 124 ? 'timeout' : 'fail'),
        stdoutTail: stdout.slice(-300),
      })
    })
  })
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗\n║   综合测试套件 — 全部测试脚本汇总              ║\n╚══════════════════════════════════════════════╝\n')
  const results = []
  for (const test of TESTS) {
    process.stdout.write(`▶ ${test.name}... `)
    const r = await runOne(test)
    results.push(r)
    const statusIcon = r.status === 'pass' ? '✓' : (r.status === 'timeout' ? '⏱' : '✗')
    const pfStr = r.pass !== null ? `${r.pass}/${r.pass + r.fail}` : `exit=${r.exitCode}`
    console.log(`${statusIcon} ${pfStr} (${(r.elapsed / 1000).toFixed(1)}s)`)
  }

  // 汇总
  const allPass = results.filter(r => r.status === 'pass')
  const allFail = results.filter(r => r.status === 'fail')
  const allTimeout = results.filter(r => r.status === 'timeout')
  const totalPass = results.reduce((a, r) => a + (r.pass || 0), 0)
  const totalFail = results.reduce((a, r) => a + (r.fail || 0), 0)

  console.log('\n╔══════════════════════════════════════════════════╗')
  console.log(`║  通过套件: ${allPass.length}/${TESTS.length}`)
  console.log(`║  总测试项: ${totalPass} 通过 / ${totalFail} 失败`)
  if (allTimeout.length) console.log(`║  超时套件: ${allTimeout.length}`)
  console.log(`║  状态: ${allFail.length === 0 ? '✅ 全部通过' : '⚠️ 有失败'}`)
  console.log('╚══════════════════════════════════════════════════╝\n')

  const report = { round: 'R18-综合汇总', timestamp: new Date().toISOString(),
    summary: { suites: TESTS.length, passed: allPass.length, failed: allFail.length, timeout: allTimeout.length, totalPass, totalFail },
    results }
  writeFileSync(resolve(RESULTS_DIR, 'R18-综合汇总.json'), JSON.stringify(report, null, 2))

  process.exit(allFail.length > 0 ? 1 : 0)
}

main()
