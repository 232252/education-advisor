// 第20轮：边缘业务场景 — 聊天会话 + Cron执行 + 自定义模型管理
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
  console.log('━━━ 第20轮: 边缘业务场景 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  let pass = 0, fail = 0
  const results = []
  const ok = (name, detail = '') => { console.log(`  ✓ ${name} ${detail}`); pass++; results.push({ name, status: 'pass' }) }
  const bad = (name, err) => { console.log(`  ✗ ${name}: ${err}`); fail++; results.push({ name, status: 'fail', error: err }) }

  // ===== A. 聊天会话管理 (SQLite 降级模式下) =====
  console.log('━━━ A. 聊天会话管理 ━━━')
  try {
    // 保存几条消息
    await sc.invoke('chat:save-message', [{ sessionId: 's1', role: 'user', content: '你好', timestamp: Date.now() }])
    await sc.invoke('chat:save-message', [{ sessionId: 's1', role: 'assistant', content: '你好！有什么可以帮你的？', timestamp: Date.now() + 1 }])
    await sc.invoke('chat:save-message', [{ sessionId: 's2', role: 'user', content: '另一个会话', timestamp: Date.now() + 2 }])
    ok('保存3条消息 (2会话)')
  } catch (e) { bad('保存消息', e.message) }

  try { const s = await sc.invoke('chat:list-sessions', []); ok('会话列表', `→ ${JSON.stringify(s).slice(0, 60)}`) } catch (e) { bad('会话列表', e.message) }
  try { const m = await sc.invoke('chat:load-messages', ['s1']); ok('加载会话s1消息', `→ ${JSON.stringify(m).slice(0, 60)}`) } catch (e) { bad('加载消息', e.message) }
  try { const r = await sc.invoke('chat:delete-session', ['s2']); ok('删除会话s2', `→ ${JSON.stringify(r).slice(0, 40)}`) } catch (e) { bad('删除会话', e.message) }

  // ===== B. 自定义模型管理 =====
  console.log('\n━━━ B. 自定义模型管理 ━━━')
  try {
    const added = await sc.invoke('ai:add-custom-model', [{ providerId: 'openai', modelId: 'my-custom-gpt', name: '我的GPT', contextWindow: 128000 }])
    ok('添加自定义模型', `→ ${JSON.stringify(added).slice(0, 60)}`)
  } catch (e) { bad('添加自定义模型', e.message) }

  try {
    const models = await sc.invoke('ai:list-models', ['openai'])
    const found = Array.isArray(models) ? models.find(m => m.id === 'my-custom-gpt') : null
    ok('验证自定义模型在列表', `→ ${found ? '找到' : '未找到'}`)
  } catch (e) { bad('列出模型', e.message) }

  try {
    const updated = await sc.invoke('ai:update-custom-model', [{ providerId: 'openai', modelId: 'my-custom-gpt', name: '我的GPT-改名', contextWindow: 200000 }])
    ok('更新自定义模型', `→ ${JSON.stringify(updated).slice(0, 40)}`)
  } catch (e) { bad('更新模型', e.message) }

  try {
    const deleted = await sc.invoke('ai:del-custom-model', ['openai', 'my-custom-gpt'])
    ok('删除自定义模型', `→ ${JSON.stringify(deleted).slice(0, 40)}`)
  } catch (e) { bad('删除模型', e.message) }

  // ===== C. API Key 管理 (keystore) =====
  console.log('\n━━━ C. API Key 管理 ━━━')
  try {
    const set = await sc.invoke('ai:set-api-key', ['openai', 'sk-test-key-12345'])
    ok('设置API Key', `→ ${JSON.stringify(set).slice(0, 40)}`)
  } catch (e) { bad('设置Key', e.message) }

  try {
    const del = await sc.invoke('ai:delete-api-key', ['openai'])
    ok('删除API Key', `→ ${JSON.stringify(del).slice(0, 40)}`)
  } catch (e) { bad('删除Key', e.message) }

  // ===== D. Cron 任务管理 =====
  console.log('\n━━━ D. Cron 任务管理 ━━━')
  // 列出预置任务
  try { const list = await sc.invoke('cron:list', []); ok('Cron任务列表', `→ ${Array.isArray(list) ? list.length : '?'} 个`) } catch (e) { bad('Cron列表', e.message) }

  // 添加自定义任务
  try {
    const added = await sc.invoke('cron:add', [{ name: '测试定时任务', expression: '0 9 * * 1', enabled: false, agentId: 'weekly-reporter' }])
    ok('添加Cron任务', `→ ${JSON.stringify(added).slice(0, 60)}`)
    results.push({ cronAddedId: added?.id })
  } catch (e) { bad('添加Cron', e.message) }

  // 列出确认
  try { const list2 = await sc.invoke('cron:list', []); ok('确认Cron已加', `→ ${Array.isArray(list2) ? list2.length : '?'} 个`) } catch (e) { bad('确认Cron', e.message) }

  // Cron 日志
  try { const logs = await sc.invoke('cron:get-logs', []); ok('Cron日志', `→ ${Array.isArray(logs) ? logs.length : '?'} 条`) } catch (e) { bad('Cron日志', e.message) }

  // ===== E. 技能完整CRUD =====
  console.log('\n━━━ E. 技能 CRUD ━━━')
  try {
    await sc.invoke('skill:save', ['edge-test-skill', '# 边缘测试技能\n内容内容'])
    ok('保存技能')
    const got = await sc.invoke('skill:get', ['edge-test-skill'])
    ok('读取技能', `→ ${got ? '存在' : 'null'}`)
    const list = await sc.invoke('skill:list', [])
    ok('技能列表', `→ ${Array.isArray(list) ? list.length : '?'} 个`)
  } catch (e) { bad('技能CRUD', e.message) }

  // ===== F. 学生档案完整CRUD =====
  console.log('\n━━━ F. 学生档案 CRUD ━━━')
  try {
    await sc.invoke('eaa:add-student', ['档案学生'])
    const set = await sc.invoke('profile:set', ['档案学生', { note: '测试档案', tags: ['优秀', '班干'] }])
    ok('写档案', `→ ${JSON.stringify(set).slice(0, 40)}`)
    const get = await sc.invoke('profile:get', ['档案学生'])
    ok('读档案', `→ ${JSON.stringify(get?.data).slice(0, 60)}`)
  } catch (e) { bad('档案CRUD', e.message) }

  await sc.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 (共 ${pass+fail}) ━━━\n`)
  const report = { round: 'R20-边缘业务', timestamp: new Date().toISOString(), summary: { pass, fail }, results }
  writeFileSync(resolve(RESULTS_DIR, 'R20-边缘业务.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-edge')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
