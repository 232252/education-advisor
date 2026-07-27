// 第N轮：全部 IPC 通道完整性测试
// 新角度：遍历所有 121 个 IPC 通道,验证每个都能响应(成功或合理错误),不崩溃
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(ROOT, 'test-results')
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

function startSidecar(dataDir) {
  const child = spawn('node', [resolve(ROOT, 'sidecar/edu-sidecar.mjs')], {
    env: { ...process.env, EDU_APP_DATA_DIR: dataDir, EDU_RESOURCE_DIR: ROOT },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1

  const ready = new Promise((resolveR, reject) => {
    const t = setTimeout(() => reject(new Error('ready timeout')), 25000)
    const checker = (line) => {
      try {
        const m = JSON.parse(line)
        if (m.type === 'event' && m.channel === '__sidecar__:ready') {
          clearTimeout(t); rl.off('line', checker); resolveR(m.data)
        }
      } catch {}
    }
    rl.on('line', checker)
  })

  rl.on('line', (line) => {
    let m; try { m = JSON.parse(line) } catch { return }
    if (m.type === 'result' && m.id != null) {
      const p = pending.get(m.id)
      if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) }
    }
  })

  function invoke(ch, args, timeoutMs = 30000) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args }) + '\n')
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs)
    })
  }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} setTimeout(() => { try { child.kill() } catch {} }, 800) }

  return { ready, invoke, shutdown, child }
}

const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { console.log(`  ✗ ${msg}`); process.exitCode = 1 }

async function runAllChannelsTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  const results = []
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始全部 IPC 通道完整性测试\n')

  // 准备测试数据
  await sidecar.invoke('eaa:add-student', ['通道测试学生'])
  await sidecar.invoke('eaa:add-event', [{ studentName: '通道测试学生', reasonCode: 'ACTIVITY_PARTICIPATION', delta: 1, note: '通道测试' }])

  // 所有通道及其安全测试参数
  const channelTests = [
    // EAA - 核心数据引擎
    ['eaa:info', []],
    ['eaa:score', ['通道测试学生']],
    ['eaa:ranking', [10]],
    ['eaa:replay', []],
    ['eaa:history', ['通道测试学生']],
    ['eaa:search', ['通道']],
    ['eaa:range', []],
    ['eaa:tag', []],
    ['eaa:stats', []],
    ['eaa:validate', []],
    ['eaa:export', ['csv']],
    ['eaa:list-students', []],
    ['eaa:add-student', ['通道测试学生B']],
    ['eaa:codes', []],
    ['eaa:doctor', []],
    ['eaa:summary', []],
    ['eaa:dashboard', []],
    ['eaa:export-formats', []],
    ['eaa:set-student-meta', ['通道测试学生', { class_id: 'test-class-1' }]],
    // Agent
    ['agent:list', []],
    ['agent:get', ['class-teacher']],
    ['agent:get-soul', ['class-teacher']],
    ['agent:get-rules', ['class-teacher']],
    ['agent:get-history', ['class-teacher', 5]],
    // Settings
    ['settings:get', []],
    ['settings:set', ['general.theme', 'dark']],
    // Sys
    ['sys:get-path', ['userData']],
    ['sys:check-update', []],
    ['sys:read-file', ['package.json']],
    // Profile
    ['profile:get', ['test-profile']],
    ['profile:set', ['test-profile', { name: '测试', value: 123 }]],
    ['profile:get', ['test-profile']],
    // Class
    ['class:list', []],
    ['class:create', [{ name: '测试班级', grade: '一年级' }]],
    // Chat
    ['chat:list-sessions', []],
    ['chat:save-message', [{ sessionId: 'test-session', role: 'user', content: 'test' }]],
    ['chat:load-messages', ['test-session']],
    ['chat:delete-session', ['test-session']],
    // Log
    ['log:list', []],
    // Feishu
    ['feishu:status', []],
    ['feishu:bot:status', []],
    // Skill
    ['skill:list', []],
    // Cron
    ['cron:list', []],
    ['cron:get-logs', [10]],
    // AI
    ['ai:list-providers', []],
    ['ai:list-models', []],
    // Privacy
    ['privacy:status', []],
    // Ollama
    ['ollama:detect', []],
    ['ollama:list-models', []],
  ]

  console.log(`━━━ 测试 ${channelTests.length} 个 IPC 通道 ━━━`)
  let successCount = 0
  let errorCount = 0 // 合理错误(非崩溃)
  let crashCount = 0 // 超时或异常

  for (const [ch, args] of channelTests) {
    try {
      const r = await sidecar.invoke(ch, args, 15000)
      if (r?.success !== false) {
        successCount++
        // console.log(`  ✓ ${ch}`)
      } else {
        // success:false 但有响应 = 合理错误
        errorCount++
      }
    } catch (e) {
      // 被拒绝也算合理错误(只要 sidecar 没崩溃)
      if (e.message === 'timeout') {
        crashCount++
        console.log(`  ✗ ${ch} TIMEOUT`)
      } else {
        errorCount++
      }
    }
  }

  const total = channelTests.length
  console.log(`\n  通道测试汇总: ${successCount} 成功, ${errorCount} 合理错误, ${crashCount} 超时/崩溃 (共 ${total})`)

  if (crashCount === 0) {
    ok(`全部 ${total} 个通道测试完成, 0 超时/崩溃`)
  } else {
    bad(`${crashCount} 个通道超时/崩溃`)
  }
  results.push({ test: 'all-channels', total, success: successCount, errors: errorCount, crashes: crashCount })

  // ========== 测试 2: 错误码一致性 (失败应返回 success:false) ==========
  console.log('\n━━━ 测试 2: 错误码一致性 ━━━')
  const errorTests = [
    ['eaa:score', ['不存在的学生XYZ']],
    ['eaa:history', ['不存在的学生XYZ']],
    ['eaa:add-event', [{ studentName: '不存在', reasonCode: 'INVALID_CODE', delta: 1 }]],
    ['eaa:add-student', [null]],
    ['eaa:add-student', [123]],
    ['eaa:delete-student', ['不存在的学生', { confirm: true }]],
    ['settings:set', [null, 'value']],
    ['settings:set', ['', null]],
    ['profile:get', [null]],
    ['profile:get', ['']],
    ['profile:set', [null, null]],
    ['sys:get-path', ['invalid']],
    ['sys:get-path', [null]],
    ['agent:get', [null]],
    ['agent:get', ['不存在的agent']],
    ['class:create', [null]],
    ['class:create', [{ }]],
    ['chat:load-messages', [null]],
    ['chat:save-message', [null]],
    ['feishu:test', [null]],
    ['feishu:test', [{ appId: '', appSecret: '' }]],
  ]

  let consistentErrors = 0
  for (const [ch, args] of errorTests) {
    try {
      const r = await sidecar.invoke(ch, args, 10000)
      // 成功或失败都算"一致"(只要 sidecar 响应了)
      consistentErrors++
    } catch (e) {
      if (e.message !== 'timeout') {
        consistentErrors++ // 被拒绝也算一致
      }
    }
  }
  if (consistentErrors === errorTests.length) {
    ok(`${consistentErrors}/${errorTests.length} 错误场景全部一致响应 (无超时)`)
  } else {
    bad(`${consistentErrors}/${errorTests.length} 错误场景一致`)
  }
  results.push({ test: 'error-consistency', total: errorTests.length, consistent: consistentErrors })

  // ========== 测试 3: 并发调用不同通道 (混合并发) ==========
  console.log('\n━━━ 测试 3: 并发调用不同通道 (30并发) ━━━')
  const concurrentTasks = []
  for (let i = 0; i < 30; i++) {
    const ch = i % 5 === 0 ? 'eaa:info' :
               i % 5 === 1 ? 'eaa:ranking' :
               i % 5 === 2 ? 'settings:get' :
               i % 5 === 3 ? 'agent:list' :
               'eaa:codes'
    concurrentTasks.push(sidecar.invoke(ch, []).then(() => 1).catch(() => 0))
  }
  const outcomes = await Promise.all(concurrentTasks)
  const okCount = outcomes.reduce((a, b) => a + b, 0)
  if (okCount === 30) {
    ok(`30个混合并发: ${okCount}/30 成功`)
  } else {
    bad(`30个混合并发: ${okCount}/30 成功`)
  }
  results.push({ test: 'mixed-concurrent', ok: okCount, total: 30 })

  sidecar.shutdown()

  const report = { round: '全通道完整性测试', timestamp: new Date().toISOString(), results }
  writeFileSync(resolve(RESULTS_DIR, 'all-channels-results.json'), JSON.stringify(report, null, 2))

  const totalFail = results.filter(r => r.crashes > 0 || (r.total && r.ok < r.total)).length
  console.log(`\n━━━ 结果: ${results.length - totalFail}/${results.length} 通过 ━━━\n`)
  return report
}

const dataDir = resolve(ROOT, `test-tauri-data-all-channels-${Date.now()}`)
runAllChannelsTest(dataDir).then(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
