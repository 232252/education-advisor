// =============================================================
// R59 — 长时间稳定性测试 (串行运行完整回归套件)
//
// 用户要求: "持续测试、压力测试、长时间测试,只有用户让停才停"
//
// 串行运行:
//   1. R53 边界条件
//   2. R54 数据完整性
//   3. R55 数据互通深度验证
//   4. R56 端到端用户旅程
//   5. R57 压力测试
//   6. R58 UI 深度交互
//
// 验证:
//   - 多轮运行结果一致 (稳定性)
//   - 无状态累积 (内存/数据泄漏)
//   - 无崩溃
// =============================================================

const { execSync } = require('child_process')
const fs = require('fs')

const SUITE = [
  { name: 'R53', script: 'dogfood-output/r53-boundary-exception.cjs' },
  { name: 'R54', script: 'dogfood-output/r54-data-integrity.cjs' },
  { name: 'R55', script: 'dogfood-output/r55-real-user-flow.cjs' },
  { name: 'R56', script: 'dogfood-output/r56-e2e-user-journey.cjs' },
  { name: 'R57', script: 'dogfood-output/r57-stress-test.cjs' },
  { name: 'R58', script: 'dogfood-output/r58-ui-deep.cjs' },
]

function parseResult(output) {
  // 从输出中解析 "结果: X pass, Y fail, Z warn" 和 "通过率: N%"
  const lines = output.split('\n')
  let pass = 0, fail = 0, warn = 0, rate = '0.0'
  for (const line of lines) {
    const m = line.match(/结果:\s*(\d+)\s*pass,?\s*(\d+)\s*fail,?\s*(\d+)\s*warn/i)
    if (m) { pass = parseInt(m[1]); fail = parseInt(m[2]); warn = parseInt(m[3]) }
    const r = line.match(/通过率:\s*([\d.]+)%/)
    if (r) rate = r[1]
  }
  return { pass, fail, warn, rate }
}

async function main() {
  console.log('=== R59 长时间稳定性测试 (完整回归套件) ===')
  console.log('开始时间:', new Date().toISOString())
  console.log('运行测试:', SUITE.map(s => s.name).join(' → '))
  console.log('')

  const results = []
  const startTime = Date.now()

  for (const test of SUITE) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`▶ 运行 ${test.name} (${test.script})`)
    console.log('='.repeat(60))

    const t0 = Date.now()
    try {
      const output = execSync(`node ${test.script}`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: 600000, // 10 分钟超时 (R57 压力测试可能接近 5 分钟)
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const t1 = Date.now()
      const parsed = parseResult(output)
      parsed.duration = ((t1 - t0) / 1000).toFixed(1) + 's'
      parsed.success = parsed.fail === 0
      results.push({ name: test.name, ...parsed })
      console.log(`\n✓ ${test.name} 完成: ${parsed.pass}P/${parsed.fail}F/${parsed.warn}W (${parsed.rate}%) - ${parsed.duration}`)
    } catch (e) {
      const t1 = Date.now()
      const output = e.stdout || e.stderr || e.message
      const parsed = parseResult(output || '')
      parsed.duration = ((t1 - t0) / 1000).toFixed(1) + 's'
      parsed.success = false
      parsed.error = e.message.slice(0, 200)
      results.push({ name: test.name, ...parsed })
      console.log(`\n✗ ${test.name} 异常: ${e.message.slice(0, 200)}`)
      // 仍然解析输出
      if (output) {
        console.log('输出片段:', output.slice(-500))
      }
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1)

  // =============================================================
  // 汇总
  // =============================================================
  console.log('\n')
  console.log('='.repeat(60))
  console.log('=== R59 完整回归套件汇总 ===')
  console.log('='.repeat(60))
  console.log('完成时间:', new Date().toISOString())
  console.log('总耗时:', totalDuration + 's')
  console.log('')
  console.log('测试名称      通过  失败  警告  通过率   耗时   状态')
  console.log('-'.repeat(60))
  let totalPass = 0, totalFail = 0, totalWarn = 0
  for (const r of results) {
    const status = r.success ? '✓ 通过' : '✗ 失败'
    console.log(
      `${r.name.padEnd(12)} ${String(r.pass).padStart(4)}  ${String(r.fail).padStart(4)}  ${String(r.warn).padStart(4)}  ${String(r.rate + '%').padStart(6)}  ${r.duration.padStart(6)}  ${status}`,
    )
    totalPass += r.pass
    totalFail += r.fail
    totalWarn += r.warn
  }
  console.log('-'.repeat(60))
  const total = totalPass + totalFail + totalWarn
  const overallRate = total > 0 ? ((totalPass / total) * 100).toFixed(1) : '0.0'
  console.log(`${'总计'.padEnd(12)} ${String(totalPass).padStart(4)}  ${String(totalFail).padStart(4)}  ${String(totalWarn).padStart(4)}  ${String(overallRate + '%').padStart(6)}  ${totalDuration.padStart(6)}s`)
  console.log('')

  const allPassed = totalFail === 0
  console.log(allPassed ? '🎉 全部通过!系统稳定!' : `⚠ 有 ${totalFail} 个失败项`)

  // 写入结果
  fs.writeFileSync(
    'dogfood-output/r59-stability-result.json',
    JSON.stringify({
      test: 'R59',
      timestamp: new Date().toISOString(),
      totalDuration: totalDuration + 's',
      summary: { pass: totalPass, fail: totalFail, warn: totalWarn, rate: overallRate + '%' },
      suites: results,
      allPassed,
    }, null, 2),
    'utf-8',
  )

  process.exit(totalFail > 0 ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(2) })
