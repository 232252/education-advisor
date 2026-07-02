// =============================================================
// R59 多轮连续运行器 — 自动运行多轮回归套件
// 每轮运行 R53→R54→R55→R56→R57→R58, 汇总结果
// 当 R57 耗时超过阈值时提醒重置 (不自动重启 Electron)
// =============================================================
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROUNDS = parseInt(process.argv[2] || '3', 10)
const R57_RESET_THRESHOLD = 150000 // R57 超过 150s 提醒重置

const SUITES = [
  { name: 'R53', file: 'r53-boundary-exception.cjs' },
  { name: 'R54', file: 'r54-data-integrity.cjs' },
  { name: 'R55', file: 'r55-real-user-flow.cjs' },
  { name: 'R56', file: 'r56-e2e-user-journey.cjs' },
  { name: 'R57', file: 'r57-stress-test.cjs' },
  { name: 'R58', file: 'r58-ui-deep.cjs' },
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

function runSuite(name, file) {
  const t0 = Date.now()
  try {
    const out = execSync(`node dogfood-output\\${file}`, {
      cwd: __dirname + '\\..',
      timeout: 600000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const t1 = Date.now()
    const duration = t1 - t0
    const parsed = parseResult(out)
    return { name, ...parsed, duration, success: parsed.fail === 0, needReset: name === 'R57' && duration > R57_RESET_THRESHOLD }
  } catch (e) {
    const out = e.stdout || e.stderr || ''
    const parsed = parseResult(out)
    return { name, ...parsed, duration: Date.now() - t0, success: parsed.fail === 0, error: e.message.slice(0, 200) }
  }
}

function main() {
  console.log('=== R59 多轮连续运行器 ===')
  console.log(`计划运行 ${ROUNDS} 轮`)
  console.log(`开始时间: ${new Date().toISOString()}`)
  console.log('')

  const allRounds = []
  let needReset = false

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`▶ 第 ${round} 轮 / ${ROUNDS}`)
    console.log(`${'='.repeat(60)}`)

    const roundStart = Date.now()
    const suites = []
    for (const s of SUITES) {
      process.stdout.write(`  运行 ${s.name}...`)
      const r = runSuite(s.name, s.file)
      suites.push(r)
      console.log(` ${r.pass}P/${r.fail}F/${r.warn}W (${r.rate}) - ${(r.duration / 1000).toFixed(1)}s${r.needReset ? ' ⚠需要重置' : ''}`)
      if (r.fail > 0) {
        console.log(`    !! ${r.name} 失败!`)
        break
      }
      if (r.needReset) needReset = true
    }
    const roundDuration = Date.now() - roundStart
    const totalPass = suites.reduce((a, b) => a + b.pass, 0)
    const totalFail = suites.reduce((a, b) => a + b.fail, 0)
    const totalWarn = suites.reduce((a, b) => a + b.warn, 0)
    const overallRate = (totalPass + totalFail + totalWarn) > 0 ? ((totalPass / (totalPass + totalFail + totalWarn)) * 100).toFixed(1) : '0.0'
    console.log(`\n  第 ${round} 轮汇总: ${totalPass}P/${totalFail}F/${totalWarn}W (${overallRate}%) - ${(roundDuration / 1000).toFixed(1)}s ${totalFail === 0 ? '✓' : '✗'}`)
    allRounds.push({ round, totalPass, totalFail, totalWarn, duration: roundDuration, suites })

    // 写入结果
    fs.writeFileSync(
      path.join(__dirname, 'r59-stability-result.json'),
      JSON.stringify({
        test: 'R59-multi',
        timestamp: new Date().toISOString(),
        round,
        totalDuration: `${(roundDuration / 1000).toFixed(1)}s`,
        summary: { pass: totalPass, fail: totalFail, warn: totalWarn, rate: ((totalPass / (totalPass + totalFail + totalWarn)) * 100).toFixed(1) + '%' },
        suites: suites.map((s) => ({ name: s.name, pass: s.pass, fail: s.fail, warn: s.warn, rate: s.rate, duration: `${(s.duration / 1000).toFixed(1)}s`, success: s.success })),
        allPassed: totalFail === 0,
      }, null, 2),
    )

    // 如果需要重置或失败, 停止
    if (totalFail > 0) {
      console.log(`\n!! 检测到失败, 停止运行`)
      break
    }
    if (needReset && round < ROUNDS) {
      console.log(`\n⚠ R57 耗时超过阈值, 建议重置 EAA 数据后继续`)
      break
    }
  }

  // 最终汇总
  console.log(`\n${'='.repeat(60)}`)
  console.log('=== 全部轮次汇总 ===')
  console.log(`${'='.repeat(60)}`)
  let grandPass = 0,
    grandFail = 0,
    grandWarn = 0
  for (const r of allRounds) {
    console.log(`  第 ${r.round} 轮: ${r.totalPass}P/${r.totalFail}F/${r.totalWarn}W - ${(r.duration / 1000).toFixed(1)}s ${r.totalFail === 0 ? '✓' : '✗'}`)
    grandPass += r.totalPass
    grandFail += r.totalFail
    grandWarn += r.totalWarn
  }
  console.log(`\n  总计: ${grandPass}P/${grandFail}F/${grandWarn}W`)
  console.log(`  完成 ${allRounds.length} 轮`)
  console.log(`  结束时间: ${new Date().toISOString()}`)
  if (grandFail === 0) console.log('\n  🎉 全部通过!系统稳定!')
}

main()
