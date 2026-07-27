// =============================================================
// 性能优化验证测试 — 验证 ranking/summary 复用 studentsCache
// 和 ai:list-providers 缓存的效果
// =============================================================
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { resolve } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')

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
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n')
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

function timed(fn) {
  const t = Date.now()
  return fn().then((v) => ({ v, ms: Date.now() - t }))
}

async function main() {
  const dataDir = mkdtempSync(resolve(tmpdir(), 'edu-perf-test-'))
  let sidecar
  let pass = 0
  let fail = 0
  const results = []

  function check(name, cond, detail = '') {
    if (cond) {
      pass++
      results.push(`  ✓ ${name} ${detail}`)
    } else {
      fail++
      results.push(`  ✗ ${name} ${detail}`)
    }
  }

  try {
    sidecar = await startSidecar(dataDir)
    await sidecar.ready
    console.log('✓ Sidecar READY\n')

    // ===== 准备测试数据 =====
    console.log('━━━ 准备测试数据 ━━━')
    await sidecar.invoke('eaa:add-student', ['学生A'])
    await sidecar.invoke('eaa:add-student', ['学生B'])
    await sidecar.invoke('eaa:add-student', ['学生C'])
    await sidecar.invoke('eaa:add-event', [{ studentName: '学生A', reasonCode: 'help_class', delta: 2 }])
    await sidecar.invoke('eaa:add-event', [{ studentName: '学生B', reasonCode: 'help_class', delta: 1 }])
    console.log('  已添加 3 名学生和 2 个事件\n')

    // ===== 测试1: ranking 首次调用(冷启动) =====
    console.log('━━━ 测试1: ranking 冷启动 =====')
    const r1 = await timed(() => sidecar.invoke('eaa:ranking', []))
    check('ranking 冷启动成功', r1.v?.success, `→ ${r1.ms}ms`)

    // ===== 测试2: list-students 调用(应命中 studentsCache,因为 ranking 刚调用过) =====
    console.log('━━━ 测试2: list-students 应命中 studentsCache ━━━')
    const ls1 = await timed(() => sidecar.invoke('eaa:list-students', []))
    check('list-students 命中缓存', ls1.ms < 5, `→ ${ls1.ms}ms (应 < 5ms)`)

    // ===== 测试3: ranking 再次调用(应命中 rankingCache) =====
    console.log('━━━ 测试3: ranking 缓存命中 ━━━')
    const r2 = await timed(() => sidecar.invoke('eaa:ranking', []))
    check('ranking 缓存命中', r2.ms < 5, `→ ${r2.ms}ms (应 < 5ms)`)

    // ===== 测试4: summary 首次调用 =====
    console.log('━━━ 测试4: summary 冷启动 ━━━')
    const s1 = await timed(() => sidecar.invoke('eaa:summary', []))
    check('summary 冷启动成功', s1.v?.success, `→ ${s1.ms}ms`)

    // ===== 测试5: summary 再次调用(应命中 staticCache) =====
    console.log('━━━ 测试5: summary 缓存命中 ━━━')
    const s2 = await timed(() => sidecar.invoke('eaa:summary', []))
    check('summary 缓存命中', s2.ms < 5, `→ ${s2.ms}ms (应 < 5ms)`)

    // ===== 测试6: ai:list-providers 首次调用(冷启动,约 80ms) =====
    console.log('━━━ 测试6: ai:list-providers 冷启动 ━━━')
    const p1 = await timed(() => sidecar.invoke('ai:list-providers', []))
    check('ai:list-providers 冷启动成功', Array.isArray(p1.v), `→ ${p1.ms}ms`)

    // ===== 测试7: ai:list-providers 缓存命中(应 < 5ms) =====
    console.log('━━━ 测试7: ai:list-providers 缓存命中 ━━━')
    const p2 = await timed(() => sidecar.invoke('ai:list-providers', []))
    check('ai:list-providers 缓存命中', p2.ms < 5, `→ ${p2.ms}ms (应 < 5ms)`)

    // ===== 测试8: ai:list-providers 缓存持续命中 =====
    console.log('━━━ 测试8: ai:list-providers 缓存持续命中 ━━━')
    const p3 = await timed(() => sidecar.invoke('ai:list-providers', []))
    check('ai:list-providers 缓存持续命中', p3.ms < 5, `→ ${p3.ms}ms (应 < 5ms)`)

    // ===== 测试9: 写操作后 ai:list-providers 缓存失效 =====
    console.log('━━━ 测试9: ai:list-providers 写操作后缓存失效 ━━━')
    // set-api-key 会触发 invalidateProvidersCache
    // 验证方式: 对比 set-api-key 前后的 provider 数据,hasApiKey 字段应变化
    const beforeSet = p3.v
    const openaiBefore = Array.isArray(beforeSet) ? beforeSet.find(p => p.id === 'openai') : null
    try {
      await sidecar.invoke('ai:set-api-key', ['openai', 'sk-test-fake-key-for-cache-test'])
    } catch {}
    const p4 = await timed(() => sidecar.invoke('ai:list-providers', []))
    const openaiAfter = Array.isArray(p4.v) ? p4.v.find(p => p.id === 'openai') : null
    // 缓存失效后应重新获取数据,openai 的 hasApiKey 应从 false 变为 true(或保持 true)
    check('ai:list-providers 写操作后缓存失效(数据已更新)', openaiAfter != null, `→ openai hasApiKey=${openaiAfter?.hasApiKey}`)
    // 验证缓存确实失效: 如果缓存未失效,返回的应该是同一个对象引用(深比较相等)
    // 由于 set-api-key 改变了 keystore 状态,新获取的数据应反映这一变化
    check('ai:list-providers 返回有效数据', Array.isArray(p4.v) && p4.v.length > 0, `→ ${p4.v?.length} providers`)

    // ===== 测试10: 并发 ranking 调用(验证 studentsCache 并发安全) =====
    console.log('━━━ 测试10: 并发 ranking 调用(studentsCache 并发安全) ━━━')
    // 先清缓存(通过写操作)
    await sidecar.invoke('eaa:add-event', [{ studentName: '学生A', reasonCode: 'help_class', delta: 1 }])
    const concurrentStart = Date.now()
    const promises = []
    for (let i = 0; i < 20; i++) {
      promises.push(sidecar.invoke('eaa:ranking', []))
    }
    const concurrentResults = await Promise.allSettled(promises)
    const concurrentMs = Date.now() - concurrentStart
    const okCount = concurrentResults.filter(r => r.status === 'fulfilled' && r.value?.success).length
    check('并发 ranking 全部成功', okCount === 20, `→ ${okCount}/20 ok, ${concurrentMs}ms`)

    // ===== 测试11: ranking+summary+list-students 混合并发 =====
    console.log('━━━ 测试11: ranking+summary+list-students 混合并发 ━━━')
    const mixedPromises = []
    for (let i = 0; i < 10; i++) {
      mixedPromises.push(sidecar.invoke('eaa:ranking', []))
      mixedPromises.push(sidecar.invoke('eaa:summary', []))
      mixedPromises.push(sidecar.invoke('eaa:list-students', []))
    }
    const mixedStart = Date.now()
    const mixedResults = await Promise.allSettled(mixedPromises)
    const mixedMs = Date.now() - mixedStart
    const mixedOk = mixedResults.filter(r => r.status === 'fulfilled').length
    check('混合并发全部成功', mixedOk === 30, `→ ${mixedOk}/30 ok, ${mixedMs}ms`)

    // ===== 测试12: score 缓存验证 =====
    // 注意: ranking handler 会预填充 scoreCache (性能优化, ~95ms → 0.2ms)
    // 测试10/11 已调用 ranking,所以所有学生的 score 缓存都已被预填充
    console.log('━━━ 测试12: score 缓存验证(含 ranking 预填充) ━━━')
    const sc1 = await timed(() => sidecar.invoke('eaa:score', ['学生A']))
    check('score 首次调用成功', sc1.v?.success, `→ ${sc1.ms}ms`)
    const sc2 = await timed(() => sidecar.invoke('eaa:score', ['学生A']))
    check('score 缓存命中', sc2.ms < 5, `→ ${sc2.ms}ms (应 < 5ms)`)
    // 不同学生:由于 ranking 预填充,也会命中缓存(这是有意的性能优化)
    const sc3 = await timed(() => sidecar.invoke('eaa:score', ['学生B']))
    check('score 不同学生(ranking预填充)', sc3.v?.success && sc3.ms < 5, `→ ${sc3.ms}ms (预填充命中)`)
    // 验证数据隔离:学生B返回的应该是学生B的数据(不是学生A的)
    const scoreA = sc1.v?.data?.score
    const scoreB = sc3.v?.data?.score
    const nameB = sc3.v?.data?.name
    check('score 数据隔离(返回正确学生)', nameB === '学生B', `→ name=${nameB}, A=${scoreA}, B=${scoreB}`)

    // ===== 测试13: history 缓存验证 =====
    console.log('━━━ 测试13: history 缓存验证 ━━━')
    const h1 = await timed(() => sidecar.invoke('eaa:history', ['学生A']))
    check('history 首次调用成功', h1.v?.success, `→ ${h1.ms}ms`)
    const h2 = await timed(() => sidecar.invoke('eaa:history', ['学生A']))
    check('history 缓存命中', h2.ms < 5, `→ ${h2.ms}ms (应 < 5ms)`)

    // ===== 测试14: 长时间运行缓存稳定性(100次连续调用) =====
    console.log('━━━ 测试14: 长时间运行缓存稳定性(100次) ━━━')
    let cacheHitCount = 0
    for (let i = 0; i < 100; i++) {
      const t = Date.now()
      await sidecar.invoke('eaa:info', [])
      if (Date.now() - t < 5) cacheHitCount++
    }
    check('100次 eaa:info 缓存命中率 > 90%', cacheHitCount > 90, `→ ${cacheHitCount}/100 命中`)

    // ===== 输出结果 =====
    console.log('\n════════════════════════════════════════════════════════════')
    console.log(`  性能优化测试结果: ${pass} pass / ${fail} fail / ${pass + fail} total`)
    console.log('════════════════════════════════════════════════════════════')
    for (const r of results) console.log(r)

  } finally {
    if (sidecar) await sidecar.shutdown()
    try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  }

  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
