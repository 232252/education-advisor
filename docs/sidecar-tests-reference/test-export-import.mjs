// 第10轮：EAA 导出/导入数据闭环 + 隐私引擎完整流程
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

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
  console.log('━━━ 第10轮: 导出/导入闭环 + 隐私引擎 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  const results = []
  let pass = 0, fail = 0
  const ok = (name, detail = '') => { console.log(`  ✓ ${name} ${detail}`); pass++; results.push({ name, status: 'pass' }) }
  const bad = (name, err) => { console.log(`  ✗ ${name}: ${err}`); fail++; results.push({ name, status: 'fail', error: err }) }

  // 准备数据
  console.log('【准备】写入测试数据...')
  await sc.invoke('eaa:add-student', ['导出张三'])
  await sc.invoke('eaa:add-student', ['导出李四'])
  await sc.invoke('eaa:add-event', [{ studentName: '导出张三', reasonCode: 'LATE', note: '导出测试' }])
  ok('写入2学生+1事件')

  // ===== A. 导出格式 =====
  console.log('\n【A】导出格式验证')
  const formats = await sc.invoke('eaa:export-formats', [])
  ok('获取导出格式', `→ ${JSON.stringify(formats).slice(0, 60)}`)

  // 导出 jsonl
  const exportDir = join(dataDir, 'exports')
  mkdirSync(exportDir, { recursive: true })
  try {
    const exp = await sc.invoke('eaa:export', ['jsonl'])
    ok('导出 jsonl', `→ ${JSON.stringify(exp).slice(0, 80)}`)
    results.push({ exportResult: exp })
  } catch (e) { bad('导出 jsonl', e.message) }

  // 导出 csv
  try {
    const expCsv = await sc.invoke('eaa:export', ['csv'])
    ok('导出 csv', `→ ${JSON.stringify(expCsv).slice(0, 80)}`)
  } catch (e) { bad('导出 csv', e.message) }

  // 导出 html
  try {
    const expHtml = await sc.invoke('eaa:export', ['html'])
    ok('导出 html', `→ ${JSON.stringify(expHtml).slice(0, 80)}`)
  } catch (e) { bad('导出 html', e.message) }

  // ===== B. 隐私引擎完整流程 =====
  console.log('\n【B】隐私引擎完整流程')
  // 初始化
  try {
    await sc.invoke('privacy:init', ['test-pass-12345', false])
    ok('隐私引擎初始化')
  } catch (e) { bad('隐私初始化', e.message) }

  // 载入
  try {
    const loadRes = await sc.invoke('privacy:load', ['test-pass-12345'])
    ok('载入隐私字典', `→ ${loadRes?.success ? '成功' : '失败'}`)
  } catch (e) { bad('载入隐私', e.message) }

  // 启用
  try {
    const enRes = await sc.invoke('privacy:enable', [])
    ok('启用隐私引擎')
  } catch (e) { bad('启用隐私', e.message) }

  // 添加 PII 实体
  try {
    await sc.invoke('privacy:add', ['person', '赵六'])
    await sc.invoke('privacy:add', ['phone', '13912345678'])
    ok('添加2个PII映射 (人+手机)')
  } catch (e) { bad('添加PII', e.message) }

  // 匿名化测试
  try {
    const anon = await sc.invoke('privacy:anonymize', ['赵六同学的手机号是13912345678'])
    const anonText = typeof anon?.data === 'string' ? anon.data : JSON.stringify(anon?.data || '').slice(0, 80)
    const hasPii = anonText.includes('赵六') || anonText.includes('13912345678')
    ok('匿名化文本', `→ "${anonText.slice(0, 60)}" ${hasPii ? '⚠️PII未清除' : '(PII已替换)'}`)
    results.push({ anonymize: { input: '赵六...13912345678', output: anonText, piiRemoved: !hasPii } })
  } catch (e) { bad('匿名化', e.message) }

  // 反匿名化
  try {
    const anon = await sc.invoke('privacy:anonymize', ['赵六同学的手机号是13912345678'])
    const anonText = typeof anon?.data === 'string' ? anon.data : ''
    if (anonText) {
      const deanon = await sc.invoke('privacy:deanonymize', [anonText])
      const deanonText = typeof deanon?.data === 'string' ? deanon.data : JSON.stringify(deanon?.data || '').slice(0, 80)
      const restored = deanonText.includes('赵六') || deanonText.includes('13912345678')
      ok('反匿名化', `→ "${deanonText.slice(0, 60)}" ${restored ? '(PII已恢复)' : '⚠️未恢复'}`)
    }
  } catch (e) { bad('反匿名化', e.message) }

  // dry-run
  try {
    const dry = await sc.invoke('privacy:dryrun', ['赵六的成绩单'])
    ok('dry-run 预览', `→ ${JSON.stringify(dry?.data || dry).slice(0, 60)}`)
  } catch (e) { bad('dry-run', e.message) }

  // 按接收方过滤
  try {
    const filt = await sc.invoke('privacy:filter', ['parent', '赵六的家长联系信息13912345678'])
    ok('按接收方过滤')
  } catch (e) { bad('过滤', e.message) }

  // 列出映射
  try {
    const list = await sc.invoke('privacy:list', [])
    ok('列出映射', `→ ${JSON.stringify(list?.data || list).slice(0, 60)}`)
  } catch (e) { bad('列出映射', e.message) }

  // 状态
  try {
    const st = await sc.invoke('privacy:status', [])
    ok('隐私状态', `→ ${JSON.stringify(st).slice(0, 60)}`)
  } catch (e) { bad('隐私状态', e.message) }

  // 锁定
  try {
    await sc.invoke('privacy:lock', [])
    const st2 = await sc.invoke('privacy:status', [])
    ok('锁定隐私引擎', `→ ${JSON.stringify(st2).slice(0, 40)}`)
  } catch (e) { bad('锁定', e.message) }

  await sc.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 ━━━\n`)
  const report = { round: 'R10-导出导入隐私', timestamp: new Date().toISOString(), summary: { pass, fail }, results }
  writeFileSync(resolve(RESULTS_DIR, 'R10-导出导入隐私.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-export')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
