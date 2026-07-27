// 第26轮：多 sidecar 实例隔离 — 3个 sidecar 同时跑，各自独立数据目录
// 检测: 进程间隔离、数据不串扰、资源竞争
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
  const ready = new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('ready timeout')), 25000); const c = (l) => { try { const m = JSON.parse(l); if (m.type === 'event' && m.channel === '__sidecar__:ready') { clearTimeout(t); rl.off('line', c); res(m.data) } } catch {} }; rl.on('line', c) })
  rl.on('line', (l) => { let m; try { m = JSON.parse(l) } catch { return } if (m.type === 'result' && m.id != null) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) } } })
  function invoke(ch, args) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 15000) }) }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500)) }
  return { ready, invoke, shutdown }
}

async function run(dataDirs) {
  console.log('━━━ 第26轮: 多 sidecar 实例隔离 (3实例同时) ━━━\n')
  const results = []

  // 同时启动 3 个 sidecar，各用独立数据目录
  console.log('启动 3 个 sidecar 实例...')
  const sidecars = await Promise.all(dataDirs.map(async (dd, i) => {
    const sc = startSidecar(dd)
    await sc.ready
    console.log(`  实例${i+1} 就绪 (数据: ${dd.split(/[\\/]/).pop()})`)
    return { sc, index: i, dataDir: dd }
  }))
  console.log('  全部 3 实例就绪\n')

  // 各实例写入不同的学生
  console.log('各实例写入独立数据...')
  for (const { sc, index } of sidecars) {
    await sc.invoke('eaa:add-student', [`实例${index+1}专属学生`])
    await sc.invoke('settings:set', ['general.theme', index === 0 ? 'dark' : index === 1 ? 'light' : 'system'])
  }
  ok('3实例各写入1学生+1设置')

  // 验证隔离: 每个实例只看到自己的学生
  console.log('\n验证数据隔离...')
  let isolated = 0
  for (const { sc, index } of sidecars) {
    const list = await sc.invoke('eaa:list-students', [])
    const students = list?.data?.students || []
    const ownStudent = students.find(s => s.name === `实例${index+1}专属学生`)
    const otherStudents = students.filter(s => s.name.match(/^实例[123]专属学生$/) && s.name !== `实例${index+1}专属学生`)
    console.log(`  实例${index+1}: ${students.length}学生, 含自己=${!!ownStudent}, 含他人=${otherStudents.length}`)
    if (ownStudent && otherStudents.length === 0) isolated++
  }
  if (isolated === 3) ok('数据完全隔离 (3/3)'); else bad('数据隔离', `只有${isolated}/3隔离`)

  // 验证设置隔离
  console.log('\n验证设置隔离...')
  let settingsIsolated = 0
  const expectedThemes = ['dark', 'light', 'system']
  for (const { sc, index } of sidecars) {
    const s = await sc.invoke('settings:get', [])
    if (s?.general?.theme === expectedThemes[index]) settingsIsolated++
    console.log(`  实例${index+1} theme=${s?.general?.theme} (期望${expectedThemes[index]})`)
  }
  if (settingsIsolated === 3) ok('设置完全隔离'); else bad('设置隔离', `${settingsIsolated}/3`)

  // 并发调用 (3实例同时调用不同通道)
  console.log('\n3实例并发调用...')
  const t0 = Date.now()
  const concurrent = []
  for (const { sc } of sidecars) {
    concurrent.push(sc.invoke('eaa:info', []).then(() => 1).catch(() => 0))
    concurrent.push(sc.invoke('agent:list', []).then(() => 1).catch(() => 0))
    concurrent.push(sc.invoke('eaa:ranking', [10]).then(() => 1).catch(() => 0))
  }
  const outcomes = await Promise.all(concurrent)
  const ok3 = outcomes.reduce((a, b) => a + b, 0)
  console.log(`  9个并发调用: ${ok3}/9 成功 (${Date.now() - t0}ms)`)
  if (ok3 === 9) ok('并发调用全成功'); else bad('并发调用', `${ok3}/9`)

  // 关闭全部
  for (const { sc } of sidecars) await sc.shutdown()

  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 ━━━\n`)
  const report = { round: 'R26-多实例隔离', timestamp: new Date().toISOString(), summary: { pass, fail, instances: 3 }, results }
  writeFileSync(resolve(RESULTS_DIR, 'R26-多实例隔离.json'), JSON.stringify(report, null, 2))
  return report
}

let pass = 0, fail = 0
function ok(name) { console.log(`  ✓ ${name}`); pass++ }
function bad(name, err) { console.log(`  ✗ ${name}: ${err}`); fail++ }

const dirs = [0, 1, 2].map(i => resolve(ROOT, `test-tauri-data-multi-${i}`))
for (const d of dirs) if (existsSync(d)) rmSync(d, { recursive: true, force: true })
run(dirs).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
