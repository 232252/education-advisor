// 缓存预预热测试 — 验证 sidecar 启动后缓存已被预填充
// 新角度: 验证性能优化的实际效果,不仅验证功能正确,更验证"第一次调用就快"
// 测试: sidecar ready 后立即调用 EAA 读命令,验证响应时间 < 阈值 (缓存命中)
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync } from 'node:fs'
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
  const logs = []

  const ready = new Promise((resolveR, reject) => {
    const t = setTimeout(() => reject(new Error('ready timeout')), 25000)
    const checker = (line) => {
      try {
        const m = JSON.parse(line)
        // 捕获日志帧 (用于验证 pre-warm 消息)
        if (m.type === 'log') logs.push(m.data)
        if (m.type === 'event' && m.channel === '__sidecar__:ready') {
          clearTimeout(t); rl.off('line', checker); resolveR(m.data)
        }
      } catch {}
    }
    rl.on('line', checker)
  })

  // 后续日志捕获 (ready 之后)
  rl.on('line', (line) => {
    try {
      const m = JSON.parse(line)
      if (m.type === 'log') logs.push(m.data)
      if (m.type === 'result' && m.id != null) {
        const p = pending.get(m.id)
        if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) }
      }
    } catch {}
  })

  function invoke(ch, args, timeoutMs = 30000) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args }) + '\n')
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs)
    })
  }
  function invokeQuiet(ch, args, timeoutMs = 30000) {
    return invoke(ch, args, timeoutMs).then(
      (data) => ({ ok: true, data }),
      (error) => ({ ok: false, error: error.message }),
    )
  }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} setTimeout(() => { try { child.kill() } catch {} }, 800) }
  return { ready, invoke, invokeQuiet, shutdown, child, logs }
}

const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { console.log(`  ✗ ${msg}`); process.exitCode = 1 }
let passCount = 0, failCount = 0
const report = (cond, msg) => { if (cond) { ok(msg); passCount++ } else { bad(msg); failCount++ } }

async function runPreWarmTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  await sidecar.ready
  console.log('✅ Sidecar 就绪,开始缓存预预热测试\n')

  // ========== 测试1: pre-warm 日志消息出现 ==========
  console.log('━━━ 测试1: pre-warm 日志消息 ━━━')
  // 等待 pre-warm 完成 (它是在 ready 后异步触发的)
  // 最多等 5 秒
  let prewarmLogFound = false
  for (let i = 0; i < 50; i++) {
    if (sidecar.logs.some((l) => l.includes('cache pre-warm'))) {
      prewarmLogFound = true
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  report(prewarmLogFound, `pre-warm 日志消息出现: ${prewarmLogFound ? '是' : '否'}`)

  if (prewarmLogFound) {
    const prewarmLog = sidecar.logs.find((l) => l.includes('cache pre-warm'))
    console.log(`    日志: ${prewarmLog}`)
    // 验证格式: "X/4 ok, Y failed, Zms"
    const match = prewarmLog.match(/(\d+)\/(\d+) ok, (\d+) failed, (\d+)ms/)
    report(match !== null, `pre-warm 日志格式正确`)
    if (match) {
      const [_, okCount, total, failCount, ms] = match
      report(Number(okCount) === 4, `pre-warm 4个通道全部成功: ${okCount}/${total}`)
      report(Number(failCount) === 0, `pre-warm 无失败: ${failCount} failed`)
      report(Number(ms) < 3000, `pre-warm 耗时合理: ${ms}ms (< 3000ms)`)
    }
  }

  // ========== 测试2: 第一次调用 EAA 读命令应命中缓存 (快速) ==========
  console.log('\n━━━ 测试2: 第一次调用命中缓存 (快速响应) ━━━')
  // pre-warm 已填充缓存,第一次调用应命中缓存
  // 缓存命中的响应时间应 < 5ms (无 spawn),未命中需 spawn (~40-200ms)
  const CACHE_HIT_THRESHOLD_MS = 10 // 10ms 阈值 (留余量)

  const channels = [
    { name: 'eaa:info', args: [] },
    { name: 'eaa:codes', args: [] },
    { name: 'eaa:list-students', args: [] },
    { name: 'eaa:ranking', args: [10] },
  ]

  for (const { name, args } of channels) {
    const start = Date.now()
    const r = await sidecar.invokeQuiet(name, args)
    const elapsed = Date.now() - start
    report(r.ok, `${name} 调用成功: ${r.ok ? '是' : r.error}`)
    report(elapsed < CACHE_HIT_THRESHOLD_MS,
      `${name} 响应时间: ${elapsed}ms (${elapsed < CACHE_HIT_THRESHOLD_MS ? '缓存命中' : '可能未命中'}, 阈值 ${CACHE_HIT_THRESHOLD_MS}ms)`)
  }

  // ========== 测试3: 连续多次调用保持快速 (缓存持续有效) ==========
  console.log('\n━━━ 测试3: 连续多次调用保持快速 ━━━')
  for (let i = 0; i < 5; i++) {
    const start = Date.now()
    const r = await sidecar.invokeQuiet('eaa:info', [])
    const elapsed = Date.now() - start
    report(r.ok && elapsed < CACHE_HIT_THRESHOLD_MS,
      `eaa:info 第${i + 1}次调用: ${elapsed}ms ${r.ok ? '✓' : '✗'}`)
  }

  // ========== 测试4: score 命令应被 ranking 预填充 (如果有学生) ==========
  console.log('\n━━━ 测试4: score 缓存预填充验证 ━━━')
  // ranking 预热会预填充 scoreCache,如果有学生的话
  const studentsRes = await sidecar.invokeQuiet('eaa:list-students', [])
  if (studentsRes.ok) {
    const studentsData = studentsRes.data?.data?.students || []
    if (studentsData.length > 0) {
      // 有学生,验证 score 缓存被预填充
      const firstStudent = studentsData[0]
      const studentName = firstStudent.name || firstStudent.entity_id
      if (studentName) {
        const start = Date.now()
        const scoreRes = await sidecar.invokeQuiet('eaa:score', [studentName])
        const elapsed = Date.now() - start
        report(scoreRes.ok, `eaa:score "${studentName}" 成功: ${scoreRes.ok ? '是' : scoreRes.error}`)
        report(elapsed < CACHE_HIT_THRESHOLD_MS,
          `eaa:score 缓存命中: ${elapsed}ms (预填充生效, 阈值 ${CACHE_HIT_THRESHOLD_MS}ms)`)
      } else {
        ok('跳过: 学生无 name 字段')
        passCount++
      }
    } else {
      ok('跳过: 无学生数据 (score 预填充需学生存在)')
      passCount++
    }
  } else {
    ok('跳过: list-students 失败')
    passCount++
  }

  // ========== 测试5: 写操作后缓存失效,但后续读会重新填充 ==========
  console.log('\n━━━ 测试5: 写操作后缓存失效与重新填充 ━━━')
  // 添加学生 (写操作,应使 studentsCache/rankingCache/scoreCache 失效)
  const testStudent = `预热测试学生${Date.now()}`
  const addRes = await sidecar.invokeQuiet('eaa:add-student', [testStudent])
  report(addRes.ok, `eaa:add-student "${testStudent}": ${addRes.ok ? '成功' : addRes.error}`)

  // 写操作后第一次 list-students 应 spawn (缓存已失效)
  const start1 = Date.now()
  const listRes1 = await sidecar.invokeQuiet('eaa:list-students', [])
  const elapsed1 = Date.now() - start1
  report(listRes1.ok, `写后 list-students 成功: ${listRes1.ok ? '是' : listRes1.error}`)
  // 注意: 写后第一次可能 spawn (正常),我们只验证它成功
  console.log(`    写后第一次 list-students: ${elapsed1}ms (可能 spawn,正常)`)

  // 立即第二次调用,应命中新填充的缓存
  const start2 = Date.now()
  const listRes2 = await sidecar.invokeQuiet('eaa:list-students', [])
  const elapsed2 = Date.now() - start2
  report(listRes2.ok, `写后第二次 list-students 成功: ${listRes2.ok ? '是' : listRes2.error}`)
  report(elapsed2 < CACHE_HIT_THRESHOLD_MS,
    `写后第二次 list-students 缓存命中: ${elapsed2}ms (阈值 ${CACHE_HIT_THRESHOLD_MS}ms)`)

  // 验证新学生在列表中
  if (listRes2.ok) {
    const students = listRes2.data?.data?.students || []
    const found = students.some((s) => s.name === testStudent)
    report(found, `新学生 "${testStudent}" 在列表中: ${found ? '是' : '否'}`)
  }

  // ========== 测试6: 并发读命令性能 (缓存命中时) ==========
  console.log('\n━━━ 测试6: 并发读命令性能 (缓存命中) ━━━')
  // 并发调用 4 个不同的读命令,验证总时间接近单个时间 (缓存命中时并发无瓶颈)
  const start = Date.now()
  const concurrent = await Promise.all([
    sidecar.invokeQuiet('eaa:info', []),
    sidecar.invokeQuiet('eaa:codes', []),
    sidecar.invokeQuiet('eaa:list-students', []),
    sidecar.invokeQuiet('eaa:ranking', [10]),
  ])
  const elapsed = Date.now() - start
  const allOk = concurrent.every((r) => r.ok)
  report(allOk, `4个并发读全部成功: ${allOk ? '是' : '否'}`)
  report(elapsed < 50,
    `4个并发读总时间: ${elapsed}ms (缓存命中应 < 50ms)`)

  // ========== 清理 ==========
  console.log('\n━━━ 清理测试数据 ━━━')
  const delRes = await sidecar.invokeQuiet('eaa:delete-student', [testStudent, { confirm: true, reason: '测试清理' }])
  report(delRes.ok, `清理测试学生: ${delRes.ok ? '成功' : delRes.error}`)

  sidecar.shutdown()

  console.log(`\n━━━ 测试结果: ${passCount} 通过 / ${failCount} 失败 ━━━`)
  return failCount === 0
}

// 主入口
const args = process.argv.slice(2)
const dataDir = args[0] || resolve(RESULTS_DIR, `prewarm-test-${Date.now()}`)

runPreWarmTest(dataDir)
  .then((ok) => {
    process.exit(ok ? 0 : 1)
  })
  .catch((err) => {
    console.error('测试异常:', err)
    process.exit(1)
  })
