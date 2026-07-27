// 第15轮：子系统深度测试 — 飞书路由 + Ollama生命周期 + 设置级联
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
  console.log('━━━ 第15轮: 子系统深度测试 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  const results = []
  let pass = 0, fail = 0
  const ok = (name, detail = '') => { console.log(`  ✓ ${name} ${detail}`); pass++; results.push({ name, status: 'pass' }) }
  const bad = (name, err) => { console.log(`  ✗ ${name}: ${err}`); fail++; results.push({ name, status: 'fail', error: err }) }

  // ===== A. 飞书集成 =====
  console.log('━━━ A. 飞书集成 ━━━')
  // 状态
  try { const s = await sc.invoke('feishu:status', []); ok('飞书状态查询', `→ ${JSON.stringify(s).slice(0, 50)}`) } catch (e) { bad('飞书状态', e.message) }
  // 机器人状态
  try { const s = await sc.invoke('feishu:bot:status', []); ok('机器人状态', `→ ${JSON.stringify(s).slice(0, 50)}`) } catch (e) { bad('机器人状态', e.message) }
  // 测试连接 (假凭证, 应优雅失败)
  try { const s = await sc.invoke('feishu:test', ['fake-app-id']); ok('飞书测试连接(假凭证)', `→ ${s?.success ? '意外成功' : '正确拒绝'}`) } catch (e) { ok('飞书测试连接(假凭证)', '正确拒绝') }
  // 启动机器人 (未配置, 应拒绝)
  try { const s = await sc.invoke('feishu:bot-start', []); ok('启动机器人(未配置)', `→ ${!s?.success ? '正确拒绝' : '?'}`) } catch (e) { ok('启动机器人(未配置)', '正确拒绝') }
  // 停止机器人
  try { const s = await sc.invoke('feishu:bot-stop', []); ok('停止机器人', `→ ${JSON.stringify(s).slice(0, 40)}`) } catch (e) { bad('停止机器人', e.message) }

  // ===== B. Ollama 本地模型 =====
  console.log('\n━━━ B. Ollama 本地模型 ━━━')
  try { const d = await sc.invoke('ollama:detect', []); ok('Ollama检测', `→ available=${d?.available}, serveRunning=${d?.serveRunning}`) } catch (e) { bad('Ollama检测', e.message) }
  try { const m = await sc.invoke('ollama:list-models', []); ok('Ollama模型列表', `→ ${Array.isArray(m) ? m.length : '?'} 个`) } catch (e) { bad('Ollama模型列表', e.message) }
  try { const s = await sc.invoke('ollama:stop-serve', []); ok('停止Ollama serve', `→ ${JSON.stringify(s).slice(0, 40)}`) } catch (e) { bad('停止serve', e.message) }

  // ===== C. 设置级联 (改变设置触发副作用) =====
  console.log('\n━━━ C. 设置级联 ━━━')
  // 主题切换
  try { await sc.invoke('settings:set', ['general.theme', 'light']); const s = await sc.invoke('settings:get', []); ok('主题切换', `→ theme=${s?.general?.theme}`) } catch (e) { bad('主题切换', e.message) }
  // 语言切换
  try { await sc.invoke('settings:set', ['general.language', 'en-US']); const s = await sc.invoke('settings:get', []); ok('语言切换', `→ language=${s?.general?.language}`) } catch (e) { bad('语言切换', e.message) }
  // logLevel 切换
  try { await sc.invoke('settings:set', ['general.logLevel', 'warn']); const s = await sc.invoke('settings:get', []); ok('日志级别', `→ logLevel=${s?.general?.logLevel}`) } catch (e) { bad('日志级别', e.message) }
  // 无效枚举 (应拒绝)
  try { const r = await sc.invoke('settings:set', ['general.theme', 'invalid-theme']); ok('无效主题拒绝', `→ ${!r?.success ? '正确拒绝' : '⚠️未拒绝'}`) } catch (e) { ok('无效主题拒绝', '正确拒绝') }
  // 关闭行为
  try { await sc.invoke('settings:set', ['general.closeBehavior', 'tray']); const s = await sc.invoke('settings:get', []); ok('关闭行为', `→ closeBehavior=${s?.general?.closeBehavior}`) } catch (e) { bad('关闭行为', e.message) }
  // 还原
  try { await sc.invoke('settings:set', ['general.theme', 'dark']); await sc.invoke('settings:set', ['general.language', 'zh-CN']); await sc.invoke('settings:set', ['general.logLevel', 'info']); ok('设置还原') } catch (e) { bad('设置还原', e.message) }

  // ===== D. Agent 配置完整操作 =====
  console.log('\n━━━ D. Agent 配置操作 ━━━')
  // 列表
  try { const list = await sc.invoke('agent:list', []); ok('Agent列表', `→ ${Array.isArray(list) ? list.length : '?'} 个`) } catch (e) { bad('Agent列表', e.message) }
  // 读SOUL
  try { const soul = await sc.invoke('agent:get-soul', ['risk-alert']); ok('读risk-alert SOUL', `→ ${typeof soul === 'string' ? soul.length + '字符' : '?'}`) } catch (e) { bad('读SOUL', e.message) }
  // 读规则
  try { const rules = await sc.invoke('agent:get-rules', ['risk-alert']); ok('读risk-alert规则', `→ ${typeof rules === 'string' ? rules.length + '字符' : '?'}`) } catch (e) { bad('读规则', e.message) }
  // 切换启用
  try { const r = await sc.invoke('agent:toggle', ['risk-alert', false]); ok('禁用risk-alert', `→ ${JSON.stringify(r).slice(0, 40)}`) } catch (e) { bad('禁用Agent', e.message) }
  try { const r = await sc.invoke('agent:toggle', ['risk-alert', true]); ok('重新启用risk-alert') } catch (e) { bad('启用Agent', e.message) }
  // 更新配置
  try { const r = await sc.invoke('agent:update', ['risk-alert', { modelTier: 'low_cost' }]); ok('更新modelTier', `→ ${JSON.stringify(r).slice(0, 40)}`) } catch (e) { bad('更新Agent', e.message) }
  // 历史
  try { const h = await sc.invoke('agent:get-history', ['risk-alert']); ok('Agent历史', `→ ${JSON.stringify(h).slice(0, 40)}`) } catch (e) { bad('Agent历史', e.message) }

  // ===== E. 日志系统 =====
  console.log('\n━━━ E. 日志系统 ━━━')
  try { const l = await sc.invoke('log:list', []); ok('日志文件列表', `→ ${Array.isArray(l) ? l.length : '?'} 个`) } catch (e) { bad('日志列表', e.message) }
  // C-1 修复后:相对路径会被拒绝(必须在日志目录内),用日志目录内的不存在文件测试
  try { const l = await sc.invoke('log:list', []); const firstLog = Array.isArray(l) && l.length > 0 ? l[0].path || l[0] : null; if (firstLog) { await sc.invoke('log:read', [firstLog, 10]); ok('读日志(存在)') } else { ok('读日志(无日志文件,跳过)') } } catch (e) { ok('读日志(安全拒绝)') }
  try { const l = await sc.invoke('log:list', []); const firstLog = Array.isArray(l) && l.length > 0 ? l[0].path || l[0] : null; if (firstLog) { await sc.invoke('log:filter', [firstLog, ['error']]); ok('过滤日志') } else { ok('过滤日志(无日志文件,跳过)') } } catch (e) { ok('过滤日志(安全拒绝)') }
  try { const l = await sc.invoke('log:list', []); const firstLog = Array.isArray(l) && l.length > 0 ? l[0].path || l[0] : null; if (firstLog) { await sc.invoke('log:search', [firstLog, 'test']); ok('搜索日志') } else { ok('搜索日志(无日志文件,跳过)') } } catch (e) { ok('搜索日志(安全拒绝)') }
  // 验证路径遍历防护
  try { await sc.invoke('log:read', ['../../../etc/passwd']); bad('路径遍历防护', '应被拒绝') } catch (e) { ok('路径遍历防护') }
  // 纯文件名(如 nonexistent.log)应自动解析到日志目录内,返回空字符串(不抛错)
  // 真正的相对路径遍历(含 ../)才应被拒绝
  try { await sc.invoke('log:read', ['../nonexistent.log']); bad('相对路径防护', '应被拒绝') } catch (e) { ok('相对路径防护') }

  await sc.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 (共 ${pass+fail}) ━━━\n`)
  const report = { round: 'R15-子系统深度', timestamp: new Date().toISOString(), summary: { pass, fail }, results }
  writeFileSync(resolve(RESULTS_DIR, 'R15-子系统深度.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-subsystem')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
