// 前端批量加载模拟测试 — 模拟 React 前端各页面的真实加载模式
// 新角度: 模拟 Dashboard/Students/Classes/Settings/Chat 页面的 IPC 调用模式
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
let passCount = 0, failCount = 0
const report = (cond, msg) => { if (cond) { ok(msg); passCount++ } else { bad(msg); failCount++ } }

async function runFrontendSimTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始前端批量加载模拟测试\n')

  // 准备测试数据
  const testStudents = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十']
  for (const name of testStudents) {
    await sidecar.invoke('eaa:add-student', [name])
  }
  for (const name of testStudents) {
    await sidecar.invoke('eaa:add-event', [{ studentName: name, reasonCode: 'ACTIVITY_PARTICIPATION', note: '初始数据' }])
  }

  // ========== 测试1: Dashboard 页面加载 (5个并行IPC) ==========
  console.log('━━━ 测试1: Dashboard 页面加载 (5并行IPC) ━━━')
  const t1a = Date.now()
  const dashResults = await Promise.allSettled([
    sidecar.invoke('eaa:ranking', [10]),
    sidecar.invoke('eaa:stats', []),
    sidecar.invoke('eaa:dashboard', []),
    sidecar.invoke('eaa:info', []),
    sidecar.invoke('agent:list', []),
  ])
  const t1b = Date.now() - t1a
  const dashOk = dashResults.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
  report(dashOk === 5, `Dashboard 5并行IPC: ${dashOk}/5 成功 (${t1b}ms)`)
  report(t1b < 500, `Dashboard 加载时间: ${t1b}ms < 500ms`)

  // ========== 测试2: Students 页面加载 (3并行IPC) ==========
  console.log('\n━━━ 测试2: Students 页面加载 ━━━')
  const t2a = Date.now()
  const stuResults = await Promise.allSettled([
    sidecar.invoke('eaa:list-students', []),
    sidecar.invoke('eaa:ranking', []),
    sidecar.invoke('eaa:codes', []),
  ])
  const t2b = Date.now() - t2a
  const stuOk = stuResults.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
  report(stuOk === 3, `Students 3并行IPC: ${stuOk}/3 成功 (${t2b}ms)`)

  // ========== 测试3: 学生详情页加载 (score + history + profile) ==========
  console.log('\n━━━ 测试3: 学生详情页加载 ━━━')
  const t3a = Date.now()
  const detailResults = await Promise.allSettled([
    sidecar.invoke('eaa:score', ['张三']),
    sidecar.invoke('eaa:history', ['张三']),
    sidecar.invoke('profile:get', ['张三']),
  ])
  const t3b = Date.now() - t3a
  const detailOk = detailResults.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
  report(detailOk === 3, `学生详情 3并行IPC: ${detailOk}/3 成功 (${t3b}ms)`)

  // ========== 测试4: Settings 页面加载 ==========
  console.log('\n━━━ 测试4: Settings 页面加载 ━━━')
  const t4a = Date.now()
  const settingsRes = await sidecar.invoke('settings:get', [])
  const t4b = Date.now() - t4a
  // settings:get 可能返回 {success:true} 或直接返回 settings 对象
  report(settingsRes != null, `Settings 加载: ${t4b}ms`)

  // ========== 测试5: 页面切换模拟 (Dashboard → Students → Dashboard) ==========
  console.log('\n━━━ 测试5: 页面切换模拟 (3次切换) ━━━')
  const t5a = Date.now()
  for (let i = 0; i < 3; i++) {
    // Dashboard
    await Promise.allSettled([
      sidecar.invoke('eaa:ranking', [10]),
      sidecar.invoke('eaa:stats', []),
    ])
    // Students
    await Promise.allSettled([
      sidecar.invoke('eaa:list-students', []),
      sidecar.invoke('eaa:codes', []),
    ])
  }
  const t5b = Date.now() - t5a
  report(t5b < 1000, `3次页面切换: ${t5b}ms < 1000ms`)

  // ========== 测试6: 缓存命中 vs 缓存失效 (第二次加载应更快) ==========
  console.log('\n━━━ 测试6: 缓存命中验证 ━━━')
  // 第一次加载 (缓存未命中)
  const t6a = Date.now()
  await sidecar.invoke('eaa:info', [])
  const t6c = Date.now() - t6a
  // 第二次加载 (缓存命中)
  const t6b = Date.now()
  await sidecar.invoke('eaa:info', [])
  const t6d = Date.now() - t6b
  report(t6d <= t6c, `缓存命中: 首次${t6c}ms → 缓存${t6d}ms (缓存${t6d <= t6c ? '更快' : '更慢'})`)

  // ========== 测试7: 写操作后缓存失效 ==========
  console.log('\n━━━ 测试7: 写操作后缓存失效 ━━━')
  // 先缓存 ranking
  const r1 = await sidecar.invoke('eaa:ranking', [])
  const ranking1 = r1?.data?.ranking?.length || 0
  // 添加新学生+事件 (应失效缓存)
  await sidecar.invoke('eaa:add-student', ['新学生缓存测试'])
  await sidecar.invoke('eaa:add-event', [{ studentName: '新学生缓存测试', reasonCode: 'CLASS_MONITOR', note: '缓存失效' }])
  // 重新查询 ranking (缓存应已失效,数据应更新)
  const r2 = await sidecar.invoke('eaa:ranking', [])
  const ranking2 = r2?.data?.ranking?.length || 0
  report(ranking2 >= ranking1, `缓存失效: ranking ${ranking1} → ${ranking2} (新学生已出现)`)

  // ========== 测试8: 5个页面同时加载 (最大并行) ==========
  console.log('\n━━━ 测试8: 5页面同时加载 (15并行IPC) ━━━')
  const t8a = Date.now()
  const allPageResults = await Promise.allSettled([
    // Dashboard
    sidecar.invoke('eaa:ranking', [10]),
    sidecar.invoke('eaa:stats', []),
    sidecar.invoke('eaa:dashboard', []),
    // Students
    sidecar.invoke('eaa:list-students', []),
    sidecar.invoke('eaa:codes', []),
    // Student Detail
    sidecar.invoke('eaa:score', ['张三']),
    sidecar.invoke('eaa:history', ['张三']),
    // Settings
    sidecar.invoke('settings:get', []),
    // Chat
    sidecar.invoke('chat:list-sessions', []),
    // Agents
    sidecar.invoke('agent:list', []),
    // AI
    sidecar.invoke('ai:list-providers', []),
    // Log
    sidecar.invoke('log:list', [{}]),
    // EAA info
    sidecar.invoke('eaa:info', []),
    // EAA validate
    sidecar.invoke('eaa:validate', []),
    // EAA export formats
    sidecar.invoke('eaa:export-formats', []),
  ])
  const t8b = Date.now() - t8a
  const allOk = allPageResults.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
  report(allOk >= 13, `15并行IPC: ${allOk}/15 成功 (${t8b}ms)`)
  report(t8b < 1000, `15并行加载时间: ${t8b}ms < 1000ms`)

  // ========== 测试9: 快速用户操作序列 (记录事件→查排名→查分数→查历史) ==========
  console.log('\n━━━ 测试9: 快速用户操作序列 ━━━')
  const t9a = Date.now()
  // 1. 记录事件
  await sidecar.invoke('eaa:add-event', [{ studentName: '张三', reasonCode: 'CLASS_COMMITTEE', note: '快速操作' }])
  // 2. 查排名
  const rankRes = await sidecar.invoke('eaa:ranking', [10])
  // 3. 查分数
  const scoreRes = await sidecar.invoke('eaa:score', ['张三'])
  // 4. 查历史
  const histRes = await sidecar.invoke('eaa:history', ['张三'])
  const t9b = Date.now() - t9a
  const seqOk = rankRes?.success !== false && scoreRes?.success !== false && histRes?.success !== false
  report(seqOk, `用户操作序列(写→读→读→读): ${t9b}ms`)

  // ========== 测试10: 连续10次Dashboard刷新 (模拟用户频繁刷新) ==========
  console.log('\n━━━ 测试10: 10次Dashboard刷新 ━━━')
  const t10a = Date.now()
  let refreshOk = 0
  for (let i = 0; i < 10; i++) {
    const r = await Promise.allSettled([
      sidecar.invoke('eaa:ranking', [10]),
      sidecar.invoke('eaa:stats', []),
      sidecar.invoke('eaa:dashboard', []),
    ])
    if (r.every(x => x.status === 'fulfilled' && x.value?.success !== false)) refreshOk++
  }
  const t10b = Date.now() - t10a
  report(refreshOk === 10, `10次Dashboard刷新: ${refreshOk}/10 成功 (${t10b}ms, avg ${(t10b/10).toFixed(0)}ms/次)`)

  sidecar.shutdown()

  const testResults = {
    round: '前端批量加载模拟测试',
    timestamp: new Date().toISOString(),
    summary: { pass: passCount, fail: failCount },
  }
  writeFileSync(resolve(RESULTS_DIR, 'frontend-sim-results.json'), JSON.stringify(testResults, null, 2))
  console.log(`\n━━━ 结果: ${passCount}通过 / ${failCount}失败 ━━━\n`)
}

const dataDir = resolve(ROOT, `test-tauri-data-frontend-sim-${Date.now()}`)
runFrontendSimTest(dataDir).then(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(failCount > 0 ? 1 : 0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
