// =============================================================
// 缓存行为验证测试 — 验证 EAA 静态数据缓存和 ranking 缓存
// 测试内容:
//   1. 连续调用 eaa:info 验证缓存命中 (第1次~30ms, 第2次<1ms)
//   2. 写操作后缓存自动失效
//   3. ranking 缓存验证
//   4. 缓存 TTL 过期验证
//   5. stats/codes/doctor 缓存验证
// =============================================================
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
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ready timeout 30s')), 30000)
    const c = (l) => {
      try {
        const m = JSON.parse(l)
        if (m.type === 'event' && m.channel === '__sidecar__:ready') {
          clearTimeout(t)
          rl.off('line', c)
          res(m.data)
        }
      } catch {}
    }
    rl.on('line', c)
  })
  rl.on('line', (l) => {
    let m
    try { m = JSON.parse(l) } catch { return }
    if (m.type === 'result' && m.id != null) {
      const p = pending.get(m.id)
      if (p) {
        pending.delete(m.id)
        m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?'))
      }
    }
  })
  function invoke(ch, args) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      try {
        child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n')
      } catch (e) {
        pending.delete(id)
        rej(e)
      }
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          rej(new Error('timeout 30s'))
        }
      }, 30000)
    })
  }
  const shutdown = () => {
    try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {}
    return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500))
  }
  return { ready, invoke, shutdown, child }
}

async function timed(fn) {
  const t = Date.now()
  const v = await fn()
  return { v, ms: Date.now() - t }
}

async function run() {
  const dataDir = resolve(ROOT, 'test-cache-data')
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })

  const sc = startSidecar(dataDir)
  await sc.ready
  console.log('✓ Sidecar READY\n')

  const results = []
  let pass = 0
  let fail = 0

  function check(name, condition, detail = '') {
    const ok = !!condition
    const icon = ok ? '✓' : '✗'
    if (ok) pass++; else fail++
    console.log(`  ${icon} ${name}${detail ? ' → ' + detail : ''}`)
    results.push({ name, ok, detail })
  }

  console.log('━━━ 测试1: eaa:info 缓存命中 ━━━')
  // 第1次调用: 缓存未命中, 需要spawn子进程
  const t1 = await timed(() => sc.invoke('eaa:info', []))
  console.log(`  第1次 eaa:info: ${t1.ms}ms`)
  check('eaa:info 第1次成功', t1.v && t1.v.success, `ms=${t1.ms}`)

  // 第2次调用: 应命中缓存, < 5ms
  const t2 = await timed(() => sc.invoke('eaa:info', []))
  console.log(`  第2次 eaa:info: ${t2.ms}ms (应 < 5ms)`)
  check('eaa:info 缓存命中 (< 5ms)', t2.ms < 5, `ms=${t2.ms}`)

  // 第3次调用: 仍然命中缓存
  const t3 = await timed(() => sc.invoke('eaa:info', []))
  console.log(`  第3次 eaa:info: ${t3.ms}ms`)
  check('eaa:info 缓存持续命中', t3.ms < 5, `ms=${t3.ms}`)

  console.log('\n━━━ 测试2: eaa:codes 缓存命中 ━━━')
  const c1 = await timed(() => sc.invoke('eaa:codes', []))
  console.log(`  第1次 eaa:codes: ${c1.ms}ms`)
  check('eaa:codes 第1次成功', c1.v && c1.v.success)

  const c2 = await timed(() => sc.invoke('eaa:codes', []))
  console.log(`  第2次 eaa:codes: ${c2.ms}ms (应 < 5ms)`)
  check('eaa:codes 缓存命中 (< 5ms)', c2.ms < 5, `ms=${c2.ms}`)

  console.log('\n━━━ 测试3: eaa:doctor 缓存命中 ━━━')
  const d1 = await timed(() => sc.invoke('eaa:doctor', []))
  console.log(`  第1次 eaa:doctor: ${d1.ms}ms`)
  check('eaa:doctor 第1次成功', d1.v && d1.v.success)

  const d2 = await timed(() => sc.invoke('eaa:doctor', []))
  console.log(`  第2次 eaa:doctor: ${d2.ms}ms (应 < 5ms)`)
  check('eaa:doctor 缓存命中 (< 5ms)', d2.ms < 5, `ms=${d2.ms}`)

  console.log('\n━━━ 测试4: eaa:stats 缓存命中 ━━━')
  const s1 = await timed(() => sc.invoke('eaa:stats', []))
  console.log(`  第1次 eaa:stats: ${s1.ms}ms`)
  check('eaa:stats 第1次成功', s1.v && s1.v.success)

  const s2 = await timed(() => sc.invoke('eaa:stats', []))
  console.log(`  第2次 eaa:stats: ${s2.ms}ms (应 < 5ms)`)
  check('eaa:stats 缓存命中 (< 5ms)', s2.ms < 5, `ms=${s2.ms}`)

  console.log('\n━━━ 测试5: 写操作后缓存失效 ━━━')
  // 先确保 info 缓存命中
  await sc.invoke('eaa:info', [])
  // 执行写操作 (add-student)
  await sc.invoke('eaa:add-student', ['缓存测试学生'])
  console.log('  已执行 add-student, 缓存应已失效')
  // 再次调用 info, 应该需要重新spawn
  const t4 = await timed(() => sc.invoke('eaa:info', []))
  console.log(`  写操作后 eaa:info: ${t4.ms}ms (应 > 5ms, 缓存已失效)`)
  check('写操作后缓存失效 (info 需重新加载)', t4.ms > 5, `ms=${t4.ms}`)

  console.log('\n━━━ 测试6: ranking 缓存验证 ━━━')
  // 第1次 ranking
  const r1 = await timed(() => sc.invoke('eaa:ranking', []))
  console.log(`  第1次 eaa:ranking: ${r1.ms}ms`)
  check('ranking 第1次成功', r1.v && r1.v.success)

  // 第2次 ranking (相同参数, 应命中缓存)
  const r2 = await timed(() => sc.invoke('eaa:ranking', []))
  console.log(`  第2次 eaa:ranking: ${r2.ms}ms (应 < 5ms)`)
  check('ranking 缓存命中 (< 5ms)', r2.ms < 5, `ms=${r2.ms}`)

  // 不同参数的 ranking (应缓存未命中)
  const r3 = await timed(() => sc.invoke('eaa:ranking', [10]))
  console.log(`  eaa:ranking Top10: ${r3.ms}ms (新参数, 应 > 5ms)`)
  check('ranking 不同参数缓存未命中', r3.ms > 5, `ms=${r3.ms}`)

  // Top10 第2次 (应命中缓存)
  const r4 = await timed(() => sc.invoke('eaa:ranking', [10]))
  console.log(`  第2次 eaa:ranking Top10: ${r4.ms}ms (应 < 5ms)`)
  check('ranking Top10 缓存命中', r4.ms < 5, `ms=${r4.ms}`)

  console.log('\n━━━ 测试7: 写操作后 ranking 缓存失效 ━━━')
  await sc.invoke('eaa:add-event', [{ studentName: '缓存测试学生', reasonCode: 'HELP_PEER', delta: 2 }])
  const r5 = await timed(() => sc.invoke('eaa:ranking', []))
  console.log(`  写操作后 eaa:ranking: ${r5.ms}ms (应 > 5ms, 缓存已失效)`)
  check('写操作后 ranking 缓存失效', r5.ms > 5, `ms=${r5.ms}`)

  console.log('\n━━━ 测试8: list-students 缓存验证 ━━━')
  const l1 = await timed(() => sc.invoke('eaa:list-students', []))
  console.log(`  第1次 list-students: ${l1.ms}ms`)
  check('list-students 第1次成功', l1.v && l1.v.success)

  const l2 = await timed(() => sc.invoke('eaa:list-students', []))
  console.log(`  第2次 list-students: ${l2.ms}ms (应 < 5ms)`)
  check('list-students 缓存命中 (< 5ms)', l2.ms < 5, `ms=${l2.ms}`)

  await sc.shutdown()

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  缓存行为测试结果: ${pass} pass / ${fail} fail / ${pass + fail} total`)
  console.log(`${'═'.repeat(60)}\n`)

  writeFileSync(resolve(RESULTS_DIR, 'cache-test.json'), JSON.stringify({ pass, fail, total: pass + fail, details: results }, null, 2))

  process.exit(fail > 0 ? 1 : 0)
}

run().catch((e) => {
  console.error('FATAL', e)
  process.exit(2)
})
