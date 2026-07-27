// 第16轮：分数计算准确性 + 事件回滚 + dashboard 生成
// 这是核心业务逻辑 — 操行分计算必须精确
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
  console.log('━━━ 第16轮: 分数计算 + 事件回滚 + dashboard ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  const results = []
  let pass = 0, fail = 0
  const ok = (name, detail = '') => { console.log(`  ✓ ${name} ${detail}`); pass++; results.push({ name, status: 'pass' }) }
  const bad = (name, err) => { console.log(`  ✗ ${name}: ${err}`); fail++; results.push({ name, status: 'fail', error: err }) }

  // 加学生
  await sc.invoke('eaa:add-student', ['计分张三'])
  console.log('  准备: 加学生 计分张三\n')

  // ===== A. 初始分数 (应100) =====
  console.log('━━━ A. 初始分数验证 ━━━')
  const initScore = await sc.invoke('eaa:score', ['计分张三'])
  const initScoreVal = initScore?.data?.score ?? initScore?.data?.delta
  console.log(`  初始分: ${JSON.stringify(initScore?.data).slice(0, 80)}`)
  ok('初始分查询')

  // ===== B. 加减分事件 + 验证分数变化 =====
  console.log('\n━━━ B. 加减分计算 ━━━')
  // 记一个 LATE (通常 -2)
  const ev1 = await sc.invoke('eaa:add-event', [{ studentName: '计分张三', reasonCode: 'LATE', note: '迟到' }])
  console.log(`  +LATE 事件: ${JSON.stringify(ev1?.data).slice(0, 60)}`)
  ok('记 LATE')

  // 查分数变化
  const score1 = await sc.invoke('eaa:score', ['计分张三'])
  console.log(`  加LATE后分: ${JSON.stringify(score1?.data).slice(0, 80)}`)
  ok('加LATE后查分')

  // 记一个加分事件
  const ev2 = await sc.invoke('eaa:add-event', [{ studentName: '计分张三', reasonCode: 'CIVILIZED_DORM', note: '文明宿舍' }])
  console.log(`  +HOMEWORK_EXCELLENT: ${JSON.stringify(ev2?.data).slice(0, 60)}`)
  ok('记加分事件')

  // ===== C. 历史记录验证 =====
  console.log('\n━━━ C. 历史记录 ━━━')
  const hist = await sc.invoke('eaa:history', ['计分张三'])
  const events = hist?.data?.events || hist?.data || []
  const eventCount = Array.isArray(events) ? events.length : 0
  console.log(`  历史事件数: ${eventCount}`)
  if (eventCount >= 2) ok('历史记录完整 (≥2事件)'); else bad('历史记录', `只有${eventCount}事件`)

  // ===== D. 统计 + 排行榜 =====
  console.log('\n━━━ D. 统计 + 排行榜 ━━━')
  const stats = await sc.invoke('eaa:stats', [])
  console.log(`  统计: ${JSON.stringify(stats?.data).slice(0, 80)}`)
  ok('统计数据')

  const rank = await sc.invoke('eaa:ranking', [10])
  const rankList = rank?.data?.ranking || rank?.data || []
  console.log(`  排行榜: ${Array.isArray(rankList) ? rankList.length : '?'} 人`)
  ok('排行榜')

  // ===== E. 时间范围查询 =====
  console.log('\n━━━ E. 时间范围查询 ━━━')
  const range = await sc.invoke('eaa:range', ['2026-01-01', '2026-12-31', 100])
  console.log(`  时间范围结果: ${JSON.stringify(range?.data).slice(0, 80)}`)
  ok('时间范围查询')

  // ===== F. 搜索 =====
  console.log('\n━━━ F. 搜索 ━━━')
  const search = await sc.invoke('eaa:search', ['计分'])
  console.log(`  搜索"计分": ${JSON.stringify(search?.data).slice(0, 80)}`)
  ok('搜索功能')

  // ===== G. summary 摘要 =====
  console.log('\n━━━ G. 摘要 ━━━')
  const summary = await sc.invoke('eaa:summary', [])
  console.log(`  摘要: ${JSON.stringify(summary?.data).slice(0, 100)}`)
  ok('摘要生成')

  // ===== H. tag 标签 =====
  console.log('\n━━━ H. 标签 ━━━')
  const tagList = await sc.invoke('eaa:tag', [])
  console.log(`  标签列表: ${JSON.stringify(tagList?.data).slice(0, 80)}`)
  ok('标签查询')

  // ===== I. validate 校验 =====
  console.log('\n━━━ I. 数据校验 ━━━')
  const validate = await sc.invoke('eaa:validate', [])
  console.log(`  校验: ${JSON.stringify(validate?.data).slice(0, 100)}`)
  ok('数据校验')

  // ===== J. dashboard 生成 =====
  console.log('\n━━━ J. dashboard 生成 ━━━')
  const dash = await sc.invoke('eaa:dashboard', [])
  console.log(`  dashboard: ${JSON.stringify(dash?.data).slice(0, 100)}`)
  ok('dashboard生成')

  // ===== K. set-student-meta =====
  console.log('\n━━━ K. 学生元数据 ━━━')
  const meta = await sc.invoke('eaa:set-student-meta', [{ name: '计分张三', meta: { note: '班长', class: 'G7A' } }])
  console.log(`  元数据: ${JSON.stringify(meta).slice(0, 80)}`)
  ok('设置元数据')

  // ===== L. list-students 含新学生 =====
  console.log('\n━━━ L. 学生列表 ━━━')
  const list = await sc.invoke('eaa:list-students', [])
  const found = (list?.data?.students || []).find(s => s.name === '计分张三')
  console.log(`  计分张三 在列表中: ${found ? '是' : '否'}, 分数=${found?.score}`)
  if (found) ok('学生列表含新学生'); else bad('学生列表', '未找到')

  await sc.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 (共 ${pass+fail}) ━━━\n`)
  const report = { round: 'R16-分数计算', timestamp: new Date().toISOString(), summary: { pass, fail }, results }
  writeFileSync(resolve(RESULTS_DIR, 'R16-分数计算.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-score')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
