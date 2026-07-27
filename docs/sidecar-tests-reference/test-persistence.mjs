// 第4轮：数据完整性 + 跨重启持久化
// 写入数据 → 重启 sidecar → 验证数据仍在
// 这模拟用户关闭应用再打开的场景
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
    const t = setTimeout(() => rej(new Error('ready timeout')), 25000)
    const checker = (line) => { try { const m = JSON.parse(line); if (m.type === 'event' && m.channel === '__sidecar__:ready') { clearTimeout(t); rl.off('line', checker); res(m.data) } } catch {} }
    rl.on('line', checker)
  })
  rl.on('line', (line) => { let m; try { m = JSON.parse(line) } catch { return } if (m.type === 'result' && m.id != null) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) } } })
  function invoke(ch, args) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 15000) }) }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1000)) }
  return { ready, invoke, shutdown, child }
}

async function runPersistence(dataDir) {
  const results = []
  console.log('━━━ 第4轮: 数据完整性 + 跨重启持久化 ━━━\n')

  // ===== 会话1: 写入数据 =====
  console.log('【会话1】写入数据...')
  let sc = startSidecar(dataDir)
  await sc.ready

  // 写学生
  const studentsToWrite = ['持久化张三', '持久化李四', '持久化王五']
  for (const name of studentsToWrite) {
    await sc.invoke('eaa:add-student', [name])
    console.log(`  + 学生 ${name}`)
  }
  // 写事件
  await sc.invoke('eaa:add-event', [{ studentName: '持久化张三', reasonCode: 'LATE', note: '迟到一次' }])
  console.log(`  + 事件 LATE → 持久化张三`)
  // 写技能
  await sc.invoke('skill:save', ['persist-test-skill', '# 持久化测试技能\n这是测试内容'])
  console.log(`  + 技能 persist-test-skill`)
  // 写设置
  await sc.invoke('settings:set', ['general.logLevel', 'debug'])
  console.log(`  + 设置 general.logLevel=debug`)
  // 写 Agent SOUL
  await sc.invoke('agent:set-soul', ['class-monitor', '# 持久化测试 SOUL'])
  console.log(`  + Agent SOUL (class-monitor)`)

  // 会话1读回验证
  const s1students = await sc.invoke('eaa:list-students', [])
  const s1count = s1students?.data?.students?.length || 0
  console.log(`  → 会话1 list-students: ${s1count} 学生`)
  results.push({ check: '会话1写后读', studentCount: s1count, expected: '>=3' })

  await sc.shutdown()
  console.log('\n【会话1关闭】\n')

  // ===== 会话2: 重启后验证数据仍在 =====
  console.log('【会话2】重启 sidecar，验证数据持久化...')
  sc = startSidecar(dataDir)
  await sc.ready

  const s2students = await sc.invoke('eaa:list-students', [])
  const s2list = s2students?.data?.students || []
  const s2names = s2list.map(s => s.name).filter(n => studentsToWrite.includes(n))
  console.log(`  → 重启后 list-students: ${s2list.length} 学生`)
  console.log(`  → 写入的3个学生中重启后仍在: ${s2names.length}/3 (${s2names.join(', ')})`)
  const studentsPersisted = s2names.length === 3
  results.push({ check: '学生跨重启持久化', persisted: studentsPersisted, found: s2names })

  // 验证事件持久化
  const s2history = await sc.invoke('eaa:history', ['持久化张三'])
  const s2events = s2history?.data?.events || s2history?.data || []
  const eventCount = Array.isArray(s2events) ? s2events.length : 0
  console.log(`  → 持久化张三 历史事件: ${eventCount}`)
  results.push({ check: '事件跨重启持久化', eventCount })

  // 验证技能持久化
  const s2skill = await sc.invoke('skill:get', ['persist-test-skill'])
  const skillPersisted = s2skill !== null && s2skill?.content?.includes('持久化测试技能')
  console.log(`  → 技能 persist-test-skill 重启后: ${skillPersisted ? '存在 ✓' : '丢失 ✗'}`)
  results.push({ check: '技能跨重启持久化', persisted: skillPersisted })

  // 验证设置持久化
  const s2settings = await sc.invoke('settings:get', [])
  const logLevelPersisted = s2settings?.general?.logLevel === 'debug'
  console.log(`  → 设置 logLevel 重启后: ${s2settings?.general?.logLevel} ${logLevelPersisted ? '(持久化 ✓)' : '(未持久化)'}`)
  results.push({ check: '设置跨重启持久化', persisted: logLevelPersisted, value: s2settings?.general?.logLevel })

  // 验证 Agent SOUL 持久化
  const s2soul = await sc.invoke('agent:get-soul', ['class-monitor'])
  const soulPersisted = typeof s2soul === 'string' && s2soul.includes('持久化测试 SOUL')
  console.log(`  → Agent SOUL 重启后: ${soulPersisted ? '持久化 ✓' : '未持久化 ✗'}`)
  results.push({ check: 'Agent SOUL 跨重启持久化', persisted: soulPersisted })

  await sc.shutdown()

  // 总结
  const checks = results.filter(r => r.check.includes('持久化'))
  const passed = checks.filter(r => r.persisted === true || (r.eventCount !== undefined && r.eventCount > 0)).length
  console.log(`\n━━━ 持久化结果: ${passed}/${checks.length} 持久化成功 ━━━`)

  const report = { round: 'R4-数据持久化', timestamp: new Date().toISOString(), results }
  writeFileSync(resolve(RESULTS_DIR, 'R4-数据持久化.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-persist')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
runPersistence(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
