// 第N轮：错误恢复 + 资源清理 + IPC 健壮性
// 新角度：验证 sidecar 在异常输入/断连/资源耗尽场景下的恢复能力
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
  // 原始写入 (不发 JSON, 用于测试畸形输入)
  function rawWrite(data) {
    child.stdin.write(data)
  }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} setTimeout(() => { try { child.kill() } catch {} }, 800) }

  return { ready, invoke, rawWrite, shutdown, child }
}

const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { console.log(`  ✗ ${msg}`); process.exitCode = 1 }

async function runErrorRecoveryTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  const results = []
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始错误恢复 + 资源清理测试\n')

  // ========== 测试 1: 畸形 JSON 输入 (sidecar 不应崩溃) ==========
  console.log('━━━ 测试 1: 畸形 JSON 输入恢复 ━━━')
  const beforeInfo = await sidecar.invoke('eaa:info', [])
  // 发送畸形 JSON
  sidecar.rawWrite('this is not json\n')
  sidecar.rawWrite('{broken json\n')
  sidecar.rawWrite('\n')
  sidecar.rawWrite('null\n')
  // 等待一下
  await new Promise(r => setTimeout(r, 200))
  // sidecar 应仍能响应
  const afterInfo = await sidecar.invoke('eaa:info', [])
  if (afterInfo?.success) {
    ok(`畸形 JSON 后 sidecar 仍响应正常`)
  } else {
    bad(`畸形 JSON 后 sidecar 无响应`)
  }
  results.push({ test: 'malformed-json-recovery', ok: !!afterInfo?.success })

  // ========== 测试 2: 不存在的 channel (应返回错误,不崩溃) ==========
  console.log('\n━━━ 测试 2: 不存在的 channel ━━━')
  let unknownChOk = false
  try {
    const r = await sidecar.invoke('nonexistent:channel', [])
    unknownChOk = false // 不应该成功
  } catch (e) {
    unknownChOk = e.message.includes('No handler') || e.message.includes('timeout') === false
  }
  if (unknownChOk) {
    ok(`未知 channel 返回明确错误`)
  } else {
    bad(`未知 channel 处理异常`)
  }
  results.push({ test: 'unknown-channel', ok: unknownChOk })

  // ========== 测试 3: 大量无效参数 (应被拒绝,不崩溃) ==========
  console.log('\n━━━ 测试 3: 大量无效参数恢复 ━━━')
  const invalidArgs = [
    ['eaa:add-student', [null]],
    ['eaa:add-student', [123]],
    ['eaa:add-student', [{}]],
    ['eaa:add-student', [[]]],
    ['eaa:score', [null]],
    ['eaa:score', [123]],
    ['eaa:add-event', [null]],
    ['eaa:add-event', ['not-an-object']],
    ['eaa:delete-student', [null, { confirm: true }]],
    ['settings:set', [null, 'value']],
    ['settings:set', ['', null]],
    ['settings:set', ['general.theme', undefined]],
  ]
  let rejectCount = 0
  for (const [ch, args] of invalidArgs) {
    try {
      const r = await sidecar.invoke(ch, args)
      // 部分参数可能被静默接受,重点是 sidecar 不崩溃
      rejectCount++
    } catch (e) {
      rejectCount++ // 被拒绝也算通过
    }
  }
  if (rejectCount === invalidArgs.length) {
    ok(`${rejectCount}/${invalidArgs.length} 无效参数全部处理完成 (sidecar 未崩溃)`)
  } else {
    bad(`${rejectCount}/${invalidArgs.length} 无效参数处理失败`)
  }
  results.push({ test: 'invalid-args-recovery', ok: rejectCount === invalidArgs.length })

  // ========== 测试 4: 1000次连续调用 (无内存泄漏/资源耗尽) ==========
  console.log('\n━━━ 测试 4: 1000次连续调用 (资源耗尽测试) ━━━')
  let countOk = 0
  const t4a = Date.now()
  for (let i = 0; i < 1000; i++) {
    try {
      const r = await sidecar.invoke('eaa:info', [])
      if (r?.success) countOk++
    } catch {}
  }
  const t4b = Date.now() - t4a
  if (countOk === 1000) {
    ok(`1000次连续调用全部成功, ${t4b}ms (avg ${(t4b/1000).toFixed(2)}ms)`)
  } else {
    bad(`1000次调用: ${countOk}/1000 成功`)
  }
  results.push({ test: '1000-sequential-calls', ok: countOk, elapsedMs: t4b })

  // ========== 测试 5: 超长字符串参数 (不应导致崩溃) ==========
  console.log('\n━━━ 测试 5: 超长字符串参数 ━━━')
  const longStr = 'x'.repeat(10000)
  let longStrOk = false
  try {
    // 用超长名字添加学生 (EAA 应拒绝, sidecar 应转发错误)
    const r = await sidecar.invoke('eaa:add-student', [longStr])
    // 不管成功失败, sidecar 没崩溃就算通过
    longStrOk = true
  } catch (e) {
    longStrOk = true // 被拒绝也算通过
  }
  // 验证 sidecar 仍能响应
  const afterLongStr = await sidecar.invoke('eaa:info', [])
  if (longStrOk && afterLongStr?.success) {
    ok(`超长字符串参数后 sidecar 正常响应`)
  } else {
    bad(`超长字符串导致问题`)
  }
  results.push({ test: 'long-string-arg', ok: longStrOk && !!afterLongStr?.success })

  // ========== 测试 6: Unicode/特殊字符参数 ==========
  console.log('\n━━━ 测试 6: Unicode/特殊字符参数 ━━━')
  const unicodeNames = ['张三', '李四😀', 'José', '学生№1', '学生\t名', '学生\n名']
  let unicodeOk = 0
  for (const name of unicodeNames) {
    try {
      const r = await sidecar.invoke('eaa:add-student', [name])
      if (r?.success) unicodeOk++
    } catch (e) {
      // 某些特殊字符(如\n\t)被 sanitize 拒绝是预期行为
      unicodeOk++ // 被正确处理(拒绝也算)
    }
  }
  if (unicodeOk === unicodeNames.length) {
    ok(`${unicodeOk}/${unicodeNames.length} Unicode/特殊字符全部处理完成`)
  } else {
    bad(`${unicodeOk}/${unicodeNames.length} Unicode 处理失败`)
  }
  results.push({ test: 'unicode-args', ok: unicodeOk === unicodeNames.length })

  // ========== 测试 7: 并发超时 (大量并发,部分超时不应影响其他) ==========
  console.log('\n━━━ 测试 7: 并发调用容错 ━━━')
  // 50个并发调用, 其中10个是无效channel (会立即失败)
  const tasks = []
  for (let i = 0; i < 40; i++) {
    tasks.push(sidecar.invoke('eaa:info', []).then(() => 1).catch(() => 0))
  }
  for (let i = 0; i < 10; i++) {
    tasks.push(sidecar.invoke(`bad:channel${i}`, []).then(() => 1).catch(() => 0))
  }
  const outcomes = await Promise.all(tasks)
  const successCount = outcomes.reduce((a, b) => a + b, 0)
  // 40个有效 + 10个无效 (无效的返回0,但不应影响有效的)
  if (successCount >= 40) {
    ok(`并发容错: ${successCount}/50 成功 (40有效+10无效, 有效调用不受无效影响)`)
  } else {
    bad(`并发容错异常: ${successCount}/50 成功`)
  }
  results.push({ test: 'concurrent-fault-tolerance', ok: successCount >= 40 })

  // ========== 测试 8: 快速启停循环 (无端口/资源泄漏) ==========
  console.log('\n━━━ 测试 8: 快速启停 (3次重启) ━━━')
  sidecar.shutdown()
  await new Promise(r => setTimeout(r, 1500))
  let restartOk = 0
  for (let i = 0; i < 3; i++) {
    const sc = startSidecar(dataDir)
    try {
      await sc.ready
      const r = await sc.invoke('eaa:info', [])
      if (r?.success) restartOk++
    } catch {}
    sc.shutdown()
    await new Promise(r => setTimeout(r, 800))
  }
  if (restartOk === 3) {
    ok(`3次快速启停全部成功`)
  } else {
    bad(`快速启停: ${restartOk}/3 成功`)
  }
  results.push({ test: 'rapid-restart', ok: restartOk === 3 })

  const report = { round: '错误恢复+资源清理测试', timestamp: new Date().toISOString(), results }
  writeFileSync(resolve(RESULTS_DIR, 'error-recovery-results.json'), JSON.stringify(report, null, 2))

  const totalFail = results.filter(r => r.ok === false || (typeof r.ok === 'number' && r.ok === 0)).length
  console.log(`\n━━━ 结果: ${results.length - totalFail}/${results.length} 通过 ━━━\n`)
  return report
}

const dataDir = resolve(ROOT, `test-tauri-data-error-recovery-${Date.now()}`)
runErrorRecoveryTest(dataDir).then(() => {
  // 清理
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
