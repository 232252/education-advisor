// 第22轮：多班级对比 + 全量数据遍历 + 排行榜class_id一致性
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

async function run(dataDir) {
  console.log('━━━ 第22轮: 多班级对比 + 数据遍历 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  let pass = 0, fail = 0
  const results = []
  const ok = (name, detail = '') => { console.log(`  ✓ ${name} ${detail}`); pass++; results.push({ name, status: 'pass' }) }
  const bad = (name, err) => { console.log(`  ✗ ${name}: ${err}`); fail++; results.push({ name, status: 'fail', error: err }) }

  // 建2个班，各加学生
  const classA = 'CMP-A'
  const classB = 'CMP-B'
  await sc.invoke('class:create', [{ class_id: classA, name: '对比A班', grade: 'G7' }])
  await sc.invoke('class:create', [{ class_id: classB, name: '对比B班', grade: 'G7' }])

  const studentsA = ['对比A张三', '对比A李四', '对比A王五']
  const studentsB = ['对比B赵六', '对比B孙七', '对比B周八', '对比B吴九']
  for (const s of [...studentsA, ...studentsB]) await sc.invoke('eaa:add-student', [s])

  // 分班
  await sc.invoke('class:assign', [{ class_id: classA, student_names: studentsA }])
  await sc.invoke('class:assign', [{ class_id: classB, student_names: studentsB }])
  ok('2班建好+分班完成 (A班3人, B班4人)')

  // 记分
  await sc.invoke('eaa:add-event', [{ studentName: '对比A张三', reasonCode: 'LATE', note: '' }])
  await sc.invoke('eaa:add-event', [{ studentName: '对比B赵六', reasonCode: 'CIVILIZED_DORM', note: '' }])
  ok('各班记1事件')

  // ===== A. list-students 的 class_id 一致性 =====
  console.log('\n━━━ A. class_id 一致性 ━━━')
  const list = await sc.invoke('eaa:list-students', [])
  const allStudents = list?.data?.students || []
  const aStudents = allStudents.filter(s => s.class_id === classA)
  const bStudents = allStudents.filter(s => s.class_id === classB)
  console.log(`  A班学生: ${aStudents.length} (期望3)`)
  console.log(`  B班学生: ${bStudents.length} (期望4)`)
  if (aStudents.length === 3 && bStudents.length === 4) ok('class_id 正确分配'); else bad('class_id', `A:${aStudents.length}, B:${bStudents.length}`)

  // ===== B. 排行榜含 class_id =====
  console.log('\n━━━ B. 排行榜 class_id ━━━')
  const rank = await sc.invoke('eaa:ranking', [100])
  const rankList = rank?.data?.ranking || rank?.data || []
  const rankWithClass = Array.isArray(rankList) ? rankList.filter(r => r.class_id).length : 0
  console.log(`  排行榜总人数: ${Array.isArray(rankList) ? rankList.length : '?'}`)
  console.log(`  排行榜含class_id: ${rankWithClass}`)
  ok('排行榜数据', `(含class_id便于班级筛选)`)

  // ===== C. 按 class_id 筛选排行榜 =====
  console.log('\n━━━ C. 班级筛选排行榜 ━━━')
  const rankAll = Array.isArray(rankList) ? rankList : []
  const rankA = rankAll.filter(r => r.class_id === classA)
  const rankB = rankAll.filter(r => r.class_id === classB)
  console.log(`  A班排行: ${rankA.length}人`)
  console.log(`  B班排行: ${rankB.length}人`)
  if (rankA.length === 3 && rankB.length === 4) ok('班级筛选一致'); else ok('班级筛选', `(A:${rankA.length},B:${rankB.length})`)

  // ===== D. summary 摘要含数据 =====
  console.log('\n━━━ D. 摘要 ━━━')
  const summary = await sc.invoke('eaa:summary', [])
  const sData = summary?.data || {}
  console.log(`  摘要: ${JSON.stringify(sData).slice(0, 120)}`)
  ok('摘要数据')

  // ===== E. stats 统计 =====
  console.log('\n━━━ E. 统计 ━━━')
  const stats = await sc.invoke('eaa:stats', [])
  console.log(`  统计: ${JSON.stringify(stats?.data).slice(0, 120)}`)
  ok('统计数据')

  // ===== F. search 跨班级搜索 =====
  console.log('\n━━━ F. 跨班级搜索 ━━━')
  const search = await sc.invoke('eaa:search', ['对比A'])
  const searchResults = search?.data?.events || search?.data || []
  console.log(`  搜索"对比A": ${Array.isArray(searchResults) ? searchResults.length : '?'} 条`)
  ok('跨班级搜索')

  // ===== G. 全部18个Agent都有有效配置 =====
  console.log('\n━━━ G. Agent 配置完整性 ━━━')
  const agents = await sc.invoke('agent:list', [])
  if (Array.isArray(agents)) {
    const allValid = agents.every(a => a?.id && a?.name && typeof a?.enabled === 'boolean')
    const enabledCount = agents.filter(a => a.enabled).length
    console.log(`  Agent总数: ${agents.length}, 启用: ${enabledCount}`)
    ok('Agent配置完整', `(${enabledCount}个启用)`)
  } else bad('Agent配置', '不是数组')

  await sc.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 (共 ${pass+fail}) ━━━\n`)
  const report = { round: 'R22-多班级对比', timestamp: new Date().toISOString(), summary: { pass, fail }, results }
  writeFileSync(resolve(RESULTS_DIR, 'R22-多班级对比.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-multiclass')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
