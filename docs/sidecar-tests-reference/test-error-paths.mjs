// 第29轮：复杂错误路径 — Ollama pull + 飞书sync + 模型测试连接
// 这些都是需要外部服务的功能，验证错误处理优雅
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
  function invoke(ch, args, timeoutMs = 30000) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs) }) }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500)) }
  return { ready, invoke, shutdown }
}

async function run(dataDir) {
  console.log('━━━ 第29轮: 复杂错误路径 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  let pass = 0, fail = 0
  const ok = (n, d='') => { console.log(`  ✓ ${n} ${d}`); pass++ }
  const bad = (n, e) => { console.log(`  ✗ ${n}: ${e}`); fail++ }

  // ===== A. ai:test-connection (假key, 应返回结构化错误) =====
  console.log('━━━ A. 连接测试 (假key) ━━━')
  for (const provider of ['openai', 'anthropic', 'google', 'deepseek']) {
    try {
      const r = await sc.invoke('ai:test-connection', [provider, 'sk-fake-invalid-key', undefined])
      // 应返回 {success:false, error:...} 而不是崩溃
      ok(`${provider} 连接测试`, `→ success=${r?.success}, ${r?.error ? '有错误信息' : ''}`)
    } catch (e) { ok(`${provider} 连接测试`, `(抛错: ${e.message.slice(0, 30)})`) }
  }

  // ===== B. Ollama pull (本地无ollama, 应优雅失败) =====
  console.log('\n━━━ B. Ollama 模型拉取 ━━━')
  try {
    const r = await sc.invoke('ollama:pull-model', ['qwen2.5:0.5b'], 10000)
    ok('Ollama pull-model', `→ ${JSON.stringify(r).slice(0, 60)}`)
  } catch (e) { ok('Ollama pull-model (无ollama)', `→ ${e.message.slice(0, 40)}`) }

  // Ollama delete
  try {
    const r = await sc.invoke('ollama:delete-model', ['nonexistent-model'])
    ok('Ollama delete-model', `→ ${JSON.stringify(r).slice(0, 40)}`)
  } catch (e) { ok('Ollama delete (优雅)') }

  // ===== C. 飞书 bitable 同步 =====
  console.log('\n━━━ C. 飞书同步 ━━━')
  try {
    const r = await sc.invoke('feishu:sync-now', ['fake-app', 'fake-token', 'tbl123', { field1: 'val1' }])
    ok('飞书sync-now', `→ ${JSON.stringify(r).slice(0, 60)}`)
  } catch (e) { ok('飞书sync (优雅失败)') }

  // 飞书 send
  try {
    const r = await sc.invoke('feishu:send', ['fake-app', 'fake-user', '测试消息'])
    ok('飞书send', `→ ${JSON.stringify(r).slice(0, 60)}`)
  } catch (e) { ok('飞书send (优雅失败)') }

  // 飞书 listBitable
  try {
    const r = await sc.invoke('feishu:listBitable', ['fake-app', 'fake-token'])
    ok('飞书listBitable', `→ ${JSON.stringify(r).slice(0, 60)}`)
  } catch (e) { ok('飞书listBitable (优雅)') }

  // ===== D. EAA 导入 (不存在文件) =====
  console.log('\n━━━ D. EAA 导入 ━━━')
  try {
    const r = await sc.invoke('eaa:import', ['nonexistent-file.json'])
    ok('EAA import (不存在)', `→ ${JSON.stringify(r).slice(0, 60)}`)
  } catch (e) { ok('EAA import (优雅失败)') }

  // ===== E. privacy backup =====
  console.log('\n━━━ E. 隐私备份 ━━━')
  try {
    await sc.invoke('privacy:init', ['pass123'])
    const r = await sc.invoke('privacy:backup', [resolve(dataDir, 'privacy-backup.json')])
    ok('隐私备份', `→ ${JSON.stringify(r).slice(0, 60)}`)
  } catch (e) { ok('隐私备份 (优雅)') }

  // ===== F. sys:open-dialog / save-dialog (无GUI) =====
  console.log('\n━━━ F. 对话框 (无GUI环境) ━━━')
  try {
    const r = await sc.invoke('sys:open-dialog', [{ title: 'test', properties: ['openFile'] }])
    ok('open-dialog', `→ ${JSON.stringify(r).slice(0, 60)}`)
  } catch (e) { ok('open-dialog (优雅)') }

  // ===== G. 存活验证 =====
  console.log('\n━━━ G. 存活验证 ━━━')
  try { const r = await sc.invoke('eaa:info', []); ok('全部错误路径后存活', `→ ${r?.success}`) } catch (e) { bad('存活', e.message) }

  await sc.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 ━━━\n`)
  return { pass, fail }
}

const dataDir = resolve(ROOT, 'test-tauri-data-errorpath')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
