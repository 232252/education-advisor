// =============================================================
// 持续循环测试运行器 — 直到用户停止 (Ctrl+C 或 写入 stop 文件)
// 每轮使用全新数据目录, 综合测试 + 性能基准 + 并发
// =============================================================
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { run as runComprehensive } from './test-comprehensive-v2.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(ROOT, 'test-results')
const STOP_FILE = resolve(ROOT, 'test-results', 'STOP')
const SUMMARY_FILE = resolve(ROOT, 'test-results', 'loop-summary.md')
const ISSUES_FILE = resolve(ROOT, 'test-results', 'issues-found.md')

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

// 删除旧的停止标记
if (existsSync(STOP_FILE)) rmSync(STOP_FILE)

// 轮次变化: 每轮用不同的数据目录, 避免数据污染
function getDataDir(round) {
  return resolve(ROOT, `test-loop-data/round-${String(round).padStart(3, '0')}`)
}

// 收集所有失败用例 (跨轮聚合)
const issueMap = new Map() // key: channel|desc → { count, firstRound, lastIssue }

function recordIssue(round, detail) {
  const key = `${detail.channel}|${detail.desc}`
  if (!issueMap.has(key)) {
    issueMap.set(key, {
      channel: detail.channel,
      desc: detail.desc,
      count: 0,
      firstRound: round,
      lastRound: round,
      firstIssue: detail.issue,
      lastIssue: detail.issue,
    })
  }
  const e = issueMap.get(key)
  e.count++
  e.lastRound = round
  e.lastIssue = detail.issue
}

// 检查停止信号
function shouldStop() {
  return existsSync(STOP_FILE)
}

// 写总结
function writeSummary(rounds) {
  const lines = []
  lines.push(`# 持续测试总结\n`)
  lines.push(`- 完成轮次: ${rounds.length}`)
  lines.push(`- 时间: ${new Date().toISOString()}\n`)
  lines.push(`## 各轮概况\n`)
  lines.push(`| 轮次 | 通道覆盖 | 并发 | 性能(info) | 稳定性波动 |`)
  lines.push(`|------|----------|------|-----------|-----------|`)
  for (const r of rounds) {
    const cov = r.phases.coverage
    const conc = r.phases.concurrent
    const perf = r.phases.performance
    const stab = r.phases.stability
    const concOk = conc.every(x => x.ok === x.total || (x.readOk === 25 && x.writeOk === 25))
    const infoAvg = perf.find(p => p.test === 'eaa:info')?.avg?.toFixed(1) ?? '?'
    lines.push(`| ${r.round} | ${cov.pass}/${cov.total} | ${concOk ? '✓' : '✗'} | ${infoAvg}ms | ${stab.degradation}% |`)
  }
  lines.push(`\n## 反复出现的问题 (≥3 轮)\n`)
  const recurring = [...issueMap.values()].filter(e => e.count >= 3).sort((a, b) => b.count - a.count)
  if (recurring.length === 0) {
    lines.push(`_无反复出现的问题_\n`)
  } else {
    for (const e of recurring) {
      lines.push(`- **[${e.channel}] ${e.desc}** — 失败 ${e.count} 次 (轮次 ${e.firstRound}-${e.lastRound})`)
      lines.push(`  - 最近: ${e.lastIssue}`)
    }
  }
  lines.push(`\n## 所有出现过的问题\n`)
  const all = [...issueMap.values()].sort((a, b) => b.count - a.count)
  if (all.length === 0) {
    lines.push(`_全部通过_\n`)
  } else {
    for (const e of all) {
      lines.push(`- [${e.channel}] ${e.desc} — ${e.count} 次 — ${e.lastIssue}`)
    }
  }
  writeFileSync(SUMMARY_FILE, lines.join('\n'))
}

// 主循环
async function main() {
  const rounds = []
  let round = 1

  console.log('╔' + '═'.repeat(58) + '╗')
  console.log('║' + ' 持续循环测试 — 写入 STOP 文件或 Ctrl+C 停止 '.padEnd(58) + '║')
  console.log('╚' + '═'.repeat(58) + '╝\n')

  while (!shouldStop()) {
    const dataDir = getDataDir(round)
    if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })

    try {
      const report = await runComprehensive(dataDir, round)
      rounds.push(report)

      // 记录失败用例
      for (const d of report.phases.coverage.details) {
        if (!d.ok) recordIssue(round, d)
      }

      // 每 5 轮写一次中期总结
      if (round % 5 === 0) {
        writeSummary(rounds)
        console.log(`\n[已写中期总结到 loop-summary.md, 完成 ${round} 轮]\n`)
      }

      round++
    } catch (e) {
      console.error(`\n第 ${round} 轮 FATAL: ${e.message}`)
      appendFileSync(ISSUES_FILE, `\n## 轮次 ${round} FATAL\n- ${e.message}\n- ${e.stack}\n`)
      // 继续, 不退出
      round++
    }

    // 短暂暂停, 让 OS 回收资源
    await new Promise(r => setTimeout(r, 500))
  }

  writeSummary(rounds)
  console.log(`\n已停止, 共完成 ${rounds.length} 轮`)
  console.log(`总结: ${SUMMARY_FILE}`)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
