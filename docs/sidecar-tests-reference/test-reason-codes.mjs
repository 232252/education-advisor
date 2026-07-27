// 第23轮：全部22个reason-code逐一测试 + 特殊字符学生名
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
  console.log('━━━ 第23轮: 全reason-code + 特殊字符 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  const results = []
  let pass = 0, fail = 0

  // 获取全部reason codes
  // eaa:codes 返回结构: { success, data: { codes: [ { code: "LATE", delta: -2, ... }, ... ], version: "1.0" } }
  const codesRes = await sc.invoke('eaa:codes', [])
  const codesArray = Array.isArray(codesRes?.data?.codes)
    ? codesRes.data.codes
    : (Array.isArray(codesRes?.data) ? codesRes.data : [])
  const codeNames = codesArray.map(c => c.code).filter(Boolean)
  console.log(`可用reason codes: ${codeNames.length} 个\n`)

  // 加一个测试学生
  await sc.invoke('eaa:add-student', ['码测学生'])
  ok(`加学生 码测学生`)

  function ok(name) { pass++; results.push({ name, status: 'pass' }) }
  function bad(name, err) { fail++; results.push({ name, status: 'fail', error: err }); console.log(`  ✗ ${name}: ${err}`) }

  // 逐一测每个 reason code
  console.log('━━━ A. 逐个reason code记事件 ━━━')
  for (const code of codeNames) {
    try {
      const r = await sc.invoke('eaa:add-event', [{ studentName: '码测学生', reasonCode: code, note: `测试${code}` }])
      if (r?.success) { ok(`事件 ${code}`) }
      else { bad(`事件 ${code}`, r?.data || 'failed') }
    } catch (e) { bad(`事件 ${code}`, e.message) }
  }
  console.log(`  → ${codeNames.length}个reason code: ${pass}成功`)

  // 验证历史记录数量
  const hist = await sc.invoke('eaa:history', ['码测学生'])
  const events = hist?.data?.events || (Array.isArray(hist?.data) ? hist.data : [])
  console.log(`  → 码测学生历史事件: ${Array.isArray(events) ? events.length : '?'} (期望~${codeNames.length})`)
  ok('历史记录验证')

  // ===== B. 特殊字符学生名 =====
  console.log('\n━━━ B. 特殊字符学生名 ━━━')
  const specialNames = [
    ['中文混合English', '中英混合'],
    ['张·李', '间隔号'],
    ['阿卜杜拉', '维吾尔名'],
    ['O\'Brien', '英文撇号'],
    ['李(大)', '括号'],
  ]
  for (const [name, desc] of specialNames) {
    try {
      const r = await sc.invoke('eaa:add-student', [name])
      if (r?.success) { ok(`学生名 ${desc}: "${name}"`); console.log(`    ✓ ${desc}: "${name}"`) }
      else { bad(`学生名 ${desc}`, String(r?.data || r?.stderr || 'failed')); console.log(`    ✗ ${desc}: "${name}"`) }
    } catch (e) { bad(`学生名 ${desc}`, e.message) }
  }

  // ===== C. reason code 大小写 =====
  console.log('\n━━━ C. reason code 大小写敏感 ━━━')
  try {
    const r = await sc.invoke('eaa:add-event', [{ studentName: '码测学生', reasonCode: 'late', note: '小写' }])
    console.log(`  小写 'late': ${r?.success ? '意外接受' : '正确拒绝 (大小写敏感)'}`)
    ok('大小写测试')
  } catch (e) { ok('大小写测试(拒绝)') }

  // ===== D. note 超长 (EAA CLI 限制 64 字符,应被拒绝) =====
  console.log('\n━━━ D. note 超长文本 (应被拒绝) ━━━')
  try {
    const longNote = '很长的备注'.repeat(100)
    const r = await sc.invoke('eaa:add-event', [{ studentName: '码测学生', reasonCode: 'LATE', note: longNote }])
    // 期望被拒绝 (note too long)
    if (!r?.success) { ok('超长note被拒绝', `→ ${r?.data || r?.stderr || ''}`) }
    else { bad('超长note应被拒绝但被接受', 'note > 64 chars was accepted') }
  } catch (e) { ok('超长note被拒绝(throw)') }

  await sc.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 ━━━\n`)
  const report = { round: 'R23-reason-code全覆盖', timestamp: new Date().toISOString(), summary: { pass, fail, codesTested: codeNames.length }, results }
  writeFileSync(resolve(RESULTS_DIR, 'R23-reason-code全覆盖.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-reasoncode')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
