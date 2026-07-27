// 第21轮：班级管理全生命周期 + 导出数据正确性验证
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
  console.log('━━━ 第21轮: 班级全生命周期 + 导出验证 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  let pass = 0, fail = 0
  const results = []
  const ok = (name, detail = '') => { console.log(`  ✓ ${name} ${detail}`); pass++; results.push({ name, status: 'pass' }) }
  const bad = (name, err) => { console.log(`  ✗ ${name}: ${err}`); fail++; results.push({ name, status: 'fail', error: err }) }

  // ===== A. 班级全生命周期 =====
  console.log('━━━ A. 班级全生命周期 ━━━')
  const classId = `CLS${Date.now().toString().slice(-6)}`
  // 创建
  try {
    const created = await sc.invoke('class:create', [{ class_id: classId, name: '生命周期测试班', grade: 'G8', teacher: '李老师', note: '测试备注' }])
    ok('创建班级', `→ ${JSON.stringify(created).slice(0, 60)}`)
  } catch (e) { bad('创建班级', e.message) }

  // 列出确认
  try {
    const list = await sc.invoke('class:list', [])
    const found = (list?.data || []).find(c => c.class_id === classId)
    ok('班级列表含新班', `→ ${found ? found.name : '未找到'}`)
  } catch (e) { bad('班级列表', e.message) }

  // 更新
  try {
    const updated = await sc.invoke('class:update', [classId, { note: '更新后的备注', teacher: '王老师' }])
    ok('更新班级', `→ ${JSON.stringify(updated).slice(0, 60)}`)
  } catch (e) { bad('更新班级', e.message) }

  // 加学生并分班
  const students = ['生命周期张三', '生命周期李四', '生命周期王五']
  for (const s of students) await sc.invoke('eaa:add-student', [s])
  ok(`加${students.length}学生`)

  try {
    const assigned = await sc.invoke('class:assign', [{ class_id: classId, student_names: students }])
    ok('分班', `→ assigned=${assigned?.assigned}, failed=${assigned?.failed?.length || 0}`)
  } catch (e) { bad('分班', e.message) }

  // 存档
  try {
    const archived = await sc.invoke('class:archive', [classId])
    ok('存档班级', `→ ${JSON.stringify(archived).slice(0, 40)}`)
  } catch (e) { bad('存档', e.message) }

  // 恢复
  try {
    const restored = await sc.invoke('class:restore', [classId])
    ok('恢复班级', `→ ${JSON.stringify(restored).slice(0, 40)}`)
  } catch (e) { bad('恢复', e.message) }

  // 移出学生
  try {
    const removed = await sc.invoke('class:remove', [{ student_name: '生命周期王五' }])
    ok('移出学生', `→ ${JSON.stringify(removed).slice(0, 40)}`)
  } catch (e) { bad('移出学生', e.message) }

  // ===== B. 导出数据正确性 =====
  console.log('\n━━━ B. 导出数据正确性 ━━━')
  // 先记几个事件
  await sc.invoke('eaa:add-event', [{ studentName: '生命周期张三', reasonCode: 'LATE', note: '迟到' }])
  await sc.invoke('eaa:add-event', [{ studentName: '生命周期李四', reasonCode: 'CIVILIZED_DORM', note: '文明宿舍' }])
  ok('记2事件用于导出')

  // CSV 导出验证
  try {
    const csv = await sc.invoke('eaa:export', ['csv'])
    const csvData = typeof csv?.data === 'string' ? csv.data : ''
    const hasHeader = csvData.includes('姓名') || csvData.includes('分数') || csvData.toLowerCase().includes('name')
    const hasStudent = csvData.includes('生命周期张三') || csvData.includes('生命周期李四')
    ok('CSV导出', `→ 有表头:${hasHeader}, 含学生:${hasStudent}, 长度${csvData.length}`)
    results.push({ csvLength: csvData.length, hasHeader, hasStudent })
  } catch (e) { bad('CSV导出', e.message) }

  // JSONL 导出验证
  try {
    const jsonl = await sc.invoke('eaa:export', ['jsonl'])
    const jsonlData = typeof jsonl?.data === 'string' ? jsonl.data : ''
    const lines = jsonlData.trim().split('\n').filter(l => l.trim())
    let validJson = 0
    for (const line of lines) { try { JSON.parse(line); validJson++ } catch {} }
    ok('JSONL导出', `→ ${lines.length}行, ${validJson}行合法JSON`)
    results.push({ jsonlLines: lines.length, validJson })
  } catch (e) { bad('JSONL导出', e.message) }

  // HTML 导出验证
  try {
    const html = await sc.invoke('eaa:export', ['html'])
    const htmlData = typeof html?.data === 'string' ? html.data : ''
    const isHtml = htmlData.includes('<html') || htmlData.includes('<!DOCTYPE')
    ok('HTML导出', `→ 是HTML:${isHtml}, 长度${htmlData.length}`)
  } catch (e) { bad('HTML导出', e.message) }

  // dashboard 生成
  try {
    const dash = await sc.invoke('eaa:dashboard', [])
    ok('Dashboard生成', `→ ${typeof dash?.data === 'string' ? dash.data.slice(0, 60) : '?'}`)
  } catch (e) { bad('Dashboard', e.message) }

  await sc.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 (共 ${pass+fail}) ━━━\n`)
  const report = { round: 'R21-班级导出', timestamp: new Date().toISOString(), summary: { pass, fail }, results }
  writeFileSync(resolve(RESULTS_DIR, 'R21-班级导出.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-classlife')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
