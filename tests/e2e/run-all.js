// =============================================================
// E2E 测试总览脚本 — 一键运行所有 CDP 测试
// =============================================================

const { spawn } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const cwd = root

const tests = [
  { name: 'UI 基本', script: 'tests/e2e/cdp-client.js', env: {} },
  { name: 'UI 交互', script: 'tests/e2e/cdp-interactions.js', env: {} },
  { name: '状态持久化', script: 'tests/e2e/cdp-persistence.js', env: {} },
  { name: '边界 & 错误', script: 'tests/e2e/cdp-edge-cases.js', env: {} },
]

async function runScript(scriptPath) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [path.join(root, scriptPath)], {
      cwd,
      env: { ...process.env },
      stdio: 'inherit',
    })
    proc.on('exit', (code) => resolve(code))
    proc.on('error', (err) => {
      console.error('Spawn error:', err)
      resolve(1)
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  const filter = args[0] // 可选,只跑指定名称
  console.log('=== E2E Test Suite ===')
  console.log(`Filter: ${filter || 'all'}\n`)

  let totalPass = 0
  let totalFail = 0
  const results = []

  for (const t of tests) {
    if (filter && !t.name.includes(filter)) continue
    console.log(`\n${'='.repeat(60)}`)
    console.log(`  ${t.name}  (${t.script})`)
    console.log('='.repeat(60))
    const code = await runScript(t.script)
    const pass = code === 0
    results.push({ name: t.name, pass, code })
    if (pass) totalPass++
    else totalFail++
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('  E2E 套件总结')
  console.log('='.repeat(60))
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}`)
  }
  console.log(`\n通过: ${totalPass}/${results.length}`)
  if (totalFail > 0) {
    console.log(`失败: ${totalFail}`)
    process.exit(1)
  }
}

main()
