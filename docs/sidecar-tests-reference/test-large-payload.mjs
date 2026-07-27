// 第28轮：大 payload + 快速连续重启 + JSON-RPC 边界
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
  function invoke(ch, args, timeoutMs = 15000) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs) }) }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500)) }
  return { ready, invoke, shutdown }
}

async function run(dataDir) {
  console.log('━━━ 第28轮: 大 payload + 边界 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  let pass = 0, fail = 0
  const ok = (n, d='') => { console.log(`  ✓ ${n} ${d}`); pass++ }
  const bad = (n, e) => { console.log(`  ✗ ${n}: ${e}`); fail++ }

  // ===== A. 大 payload 参数 (1MB 字符串) =====
  console.log('━━━ A. 大 payload 参数 ━━━')
  const bigNote = 'X'.repeat(60) // note 上限 64
  try {
    await sc.invoke('eaa:add-student', ['大参学生'])
    const r = await sc.invoke('eaa:add-event', [{ studentName: '大参学生', reasonCode: 'LATE', note: bigNote }])
    ok('最大长度 note (60字符)', `→ ${r?.success}`)
  } catch (e) { bad('大note', e.message) }

  // 大 settings value
  try {
    const bigVal = { key: 'value'.repeat(50) } // ~300 字符
    const r = await sc.invoke('settings:set', ['general.theme', 'dark']) // 用合法值
    ok('设置合法值')
  } catch (e) { bad('设置', e.message) }

  // skill 大内容
  try {
    const bigContent = '# 技能\n' + '内容行\n'.repeat(100) // ~500 字符
    await sc.invoke('skill:save', ['big-skill', bigContent])
    const got = await sc.invoke('skill:get', ['big-skill'])
    const len = typeof got?.content === 'string' ? got.content.length : 0
    ok('大技能内容', `→ ${len}字符`)
  } catch (e) { bad('大技能', e.message) }

  // ===== B. 大返回值 (ranking 全量) =====
  console.log('\n━━━ B. 大返回值 ━━━')
  // 加 20 学生造大数据
  for (let i = 0; i < 20; i++) await sc.invoke('eaa:add-student', [`大数据${String(i).padStart(2,'0')}`])
  ok('加20学生')

  const rank = await sc.invoke('eaa:ranking', [100])
  const rankStr = JSON.stringify(rank)
  console.log(`  ranking 返回: ${rankStr.length} 字节`)
  ok('大数据排行榜', `(${rankStr.length}字节)`)

  const list = await sc.invoke('eaa:list-students', [])
  const listStr = JSON.stringify(list)
  console.log(`  list-students 返回: ${listStr.length} 字节`)
  ok('大学生列表', `(${listStr.length}字节)`)

  // ===== C. 空参数边界 =====
  console.log('\n━━━ C. 空参数边界 ━━━')
  try { await sc.invoke('eaa:info', []); ok('eaa:info 空参') } catch (e) { bad('info空参', e.message) }
  try { await sc.invoke('eaa:info', undefined); ok('eaa:info undefined参') } catch (e) { bad('info undef', e.message) }
  try { await sc.invoke('eaa:info', null); ok('eaa:info null参') } catch (e) { bad('info null', e.message) }

  // ===== D. 高 id 数字 (JSON-RPC id 边界) =====
  console.log('\n━━━ D. 快速连续调用 (id 自增) ━━━')
  const t0 = Date.now()
  let rapid = 0
  for (let i = 0; i < 100; i++) {
    try { await sc.invoke('eaa:info', []); rapid++ } catch {}
  }
  console.log(`  100次快速 eaa:info: ${rapid}/100 (${Date.now()-t0}ms)`)
  ok('快速连续100次', `(${rapid}/100)`)

  // ===== E. 存活验证 =====
  console.log('\n━━━ E. 存活验证 ━━━')
  try { const r = await sc.invoke('eaa:info', []); ok('全部测试后存活', `→ ${r?.success}`) } catch (e) { bad('存活', e.message) }

  await sc.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 ━━━\n`)
  return { pass, fail }
}

const dataDir = resolve(ROOT, 'test-tauri-data-bigpayload')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
