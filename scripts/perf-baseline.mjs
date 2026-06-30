// =============================================================
// perf-baseline.mjs — 性能基线测量
// 测量:
//   1. typecheck 时长
//   2. test:coverage 时长
//   3. build 时长
//   4. main bundle 大小
//   5. renderer bundle 大小
// 输出 perf-report.json + perf-report.md
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()

function timedRun(label, command) {
  console.log(`\n[perf] ${label}: ${command}`)
  const start = Date.now()
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    stdio: 'pipe',
    encoding: 'utf-8',
  })
  const elapsed = Date.now() - start
  const ok = result.status === 0
  console.log(`  -> ${ok ? 'OK' : 'FAIL'} in ${(elapsed / 1000).toFixed(2)}s`)
  if (!ok) {
    console.log(`  stderr: ${(result.stderr || '').split('\n').slice(0, 5).join('\n')}`)
  }
  return { label, command, elapsedMs: elapsed, ok, exitCode: result.status }
}

function getBundleSize(filePath) {
  try {
    const stat = fs.statSync(filePath)
    return stat.size
  } catch {
    return null
  }
}

function formatBytes(n) {
  if (n == null) return 'N/A'
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  if (n > 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${n} B`
}

async function main() {
  console.log('=== Performance Baseline ===')
  console.log(`Date: ${new Date().toISOString()}`)
  console.log(`Node: ${process.version}`)
  console.log(`Platform: ${process.platform}-${process.arch}`)

  // 防御:跳过实际重命令(避免 CI 上重复跑),只采集 bundle 大小
  const skipHeavy = process.env.PERF_SKIP_HEAVY === '1'
  const results = []

  if (!skipHeavy) {
    results.push(timedRun('typecheck', 'npm run typecheck'))
    results.push(timedRun('test:coverage', 'npm run test:coverage'))
    results.push(timedRun('build', 'npm run build'))
  } else {
    console.log('\n[perf] PERF_SKIP_HEAVY=1, 跳过重命令')
  }

  // Bundle 大小
  const mainPath = path.join(ROOT, 'dist', 'main', 'index.js')
  const rendererPath = path.join(ROOT, 'dist', 'renderer', 'assets')
  const mainSize = getBundleSize(mainPath)
  let rendererSize = 0
  if (fs.existsSync(rendererPath)) {
    for (const f of fs.readdirSync(rendererPath)) {
      if (f.endsWith('.js')) {
        rendererSize += getBundleSize(path.join(rendererPath, f)) || 0
      }
    }
  }

  const bundleInfo = {
    mainBundle: { path: mainPath, size: mainSize, formatted: formatBytes(mainSize) },
    rendererBundle: {
      path: rendererPath,
      size: rendererSize || null,
      formatted: formatBytes(rendererSize || null),
    },
  }
  console.log('\n[perf] Bundle 大小:')
  console.log(`  main: ${bundleInfo.mainBundle.formatted}`)
  console.log(`  renderer: ${bundleInfo.rendererBundle.formatted}`)

  // 测试数量统计
  let testCount = null
  try {
    // 从最近一次 test 输出推断(简化:直接看 tests/ 目录文件数)
    const testFiles = []
    function walk(dir) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name)
        if (f.isDirectory()) walk(full)
        else if (f.name.endsWith('.test.ts') || f.name.endsWith('.test.tsx')) {
          testFiles.push(full)
        }
      }
    }
    walk(path.join(ROOT, 'tests'))
    walk(path.join(ROOT, 'src'))
    testCount = testFiles.length
  } catch {
    /* ignore */
  }

  const report = {
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    steps: results.map((r) => ({
      label: r.label,
      elapsedMs: r.elapsedMs,
      ok: r.ok,
    })),
    bundle: bundleInfo,
    testFiles: testCount,
  }

  fs.writeFileSync(
    path.join(ROOT, 'perf-report.json'),
    JSON.stringify(report, null, 2),
    'utf-8',
  )

  // Markdown 报告
  const md = [
    '# 性能基线报告',
    '',
    `- 时间: ${report.timestamp}`,
    `- Node: ${report.node}`,
    `- 平台: ${report.platform}`,
    '',
    '## 步骤耗时',
    '',
    '| 步骤 | 耗时(s) | 状态 |',
    '|------|---------|------|',
    ...results.map(
      (r) =>
        `| ${r.label} | ${(r.elapsedMs / 1000).toFixed(2)} | ${r.ok ? '✓' : '✗'} |`,
    ),
    '',
    '## Bundle 大小',
    '',
    '| Bundle | 大小 |',
    '|--------|------|',
    `| main | ${bundleInfo.mainBundle.formatted} |`,
    `| renderer | ${bundleInfo.rendererBundle.formatted} |`,
    '',
    `## 测试文件数: ${testCount ?? 'N/A'}`,
    '',
  ].join('\n')
  fs.writeFileSync(path.join(ROOT, 'perf-report.md'), md, 'utf-8')

  console.log('\n[perf] 报告已写入 perf-report.json 和 perf-report.md')

  // 失败检测
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    console.error(`\n[perf] ${failed.length} 个步骤失败`)
    process.exit(1)
  }
  console.log('\n[perf] ✓ 全部通过')
}

main().catch((err) => {
  console.error('[perf] Fatal:', err)
  process.exit(1)
})
