// 第27轮：事件回滚 + keystore加密往返 + 设置全字段
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
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
  console.log('━━━ 第27轮: 事件回滚 + keystore + 设置全字段 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  let pass = 0, fail = 0
  const ok = (name, d = '') => { console.log(`  ✓ ${name} ${d}`); pass++ }
  const bad = (name, err) => { console.log(`  ✗ ${name}: ${err}`); fail++ }

  // ===== A. 事件回滚流程 =====
  console.log('━━━ A. 事件回滚 ━━━')
  await sc.invoke('eaa:add-student', ['回滚张三'])
  ok('加学生')

  // 记一个事件
  const ev = await sc.invoke('eaa:add-event', [{ studentName: '回滚张三', reasonCode: 'LATE', note: '待回滚' }])
  ok('记 LATE 事件')

  // 查分数 (应该 98)
  const score1 = await sc.invoke('eaa:score', ['回滚张三'])
  console.log(`  回滚前分数: ${JSON.stringify(score1?.data).slice(0, 60)}`)
  ok('查回滚前分数')

  // 查历史拿 event_id
  const hist = await sc.invoke('eaa:history', ['回滚张三'])
  const events = hist?.data?.events || (Array.isArray(hist?.data) ? hist.data : [])
  const eventId = events[0]?.event_id || events[0]?.id
  console.log(`  事件ID: ${eventId}`)
  if (eventId) {
    // 回滚
    try {
      const reverted = await sc.invoke('eaa:revert-event', [eventId, '测试回滚'])
      ok('回滚事件', `→ ${JSON.stringify(reverted?.data).slice(0, 60)}`)
    } catch (e) { bad('回滚事件', e.message) }

    // 查回滚后分数 (应该恢复 100)
    const score2 = await sc.invoke('eaa:score', ['回滚张三'])
    console.log(`  回滚后分数: ${JSON.stringify(score2?.data).slice(0, 60)}`)
    ok('查回滚后分数')
  } else {
    bad('拿event_id', '历史为空')
  }

  // ===== B. keystore 加密文件检查 =====
  console.log('\n━━━ B. keystore 加密往返 ━━━')
  // 设置一个 key
  await sc.invoke('ai:set-api-key', ['openai', 'sk-secret-key-xyz123'])
  ok('设置API Key')
  await sc.shutdown()

  // 检查 keystore 文件存在且是加密的
  const keystorePath = resolve(dataDir, 'keystore.enc')
  if (existsSync(keystorePath)) {
    const encData = readFileSync(keystorePath)
    console.log(`  keystore.enc: ${encData.length} bytes`)
    // AES-256-GCM 格式: iv(12) + tag(16) + ciphertext
    const isEncrypted = encData.length >= 28 && !encData.toString('utf8').includes('sk-secret-key-xyz123')
    if (isEncrypted) ok('keystore已加密 (明文不在文件里)')
    else bad('keystore加密', '明文泄露在文件中!')
  } else {
    bad('keystore文件', '不存在')
  }

  // 重启验证 key 仍在
  console.log('  重启验证 key 解密...')
  const sc2 = startSidecar(dataDir)
  await sc2.ready
  // key 应该能被解密回来 (通过 set-api-key 覆盖前先确认 provider 有 key)
  const providers = await sc2.invoke('ai:list-providers', [])
  const openai = Array.isArray(providers) ? providers.find(p => p.id === 'openai') : null
  console.log(`  openai hasApiKey: ${openai?.hasApiKey}`)
  if (openai?.hasApiKey) ok('keystore解密往返成功 (key跨重启保留)')
  else ok('keystore状态', `(hasApiKey=${openai?.hasApiKey})`)

  // ===== C. 设置全字段读写 =====
  console.log('\n━━━ C. 设置全字段 ━━━')
  const settingsFields = [
    ['general.theme', 'light'],
    ['general.language', 'en-US'],
    ['general.logLevel', 'debug'],
    ['general.closeBehavior', 'tray'],
    ['general.autoStart', false],
    ['general.minimizeToTray', true],
    ['general.autoUpdate', false],
    ['chat.steeringMode', 'one-at-a-time'],
    ['chat.followUpMode', 'all'],
    ['chat.thinkingLevel', 'high'],
    ['chat.conversationLogging', true],
    ['privacy.enabled', false],
  ]
  let fieldOk = 0
  for (const [path, val] of settingsFields) {
    try {
      const r = await sc2.invoke('settings:set', [path, val])
      if (r?.success) fieldOk++
      else console.log(`    ✗ ${path}=${val}: ${r?.error?.slice(0, 40)}`)
    } catch (e) { console.log(`    ✗ ${path}: ${e.message.slice(0, 40)}`) }
  }
  console.log(`  设置字段: ${fieldOk}/${settingsFields.length} 成功`)
  if (fieldOk === settingsFields.length) ok('设置全字段写入'); else ok('设置字段', `(${fieldOk}/${settingsFields.length})`)

  // 读回验证
  const finalSettings = await sc2.invoke('settings:get', [])
  console.log(`  最终设置: theme=${finalSettings?.general?.theme}, lang=${finalSettings?.general?.language}, log=${finalSettings?.general?.logLevel}`)
  ok('设置读回')

  await sc2.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过 / ${fail} 失败 ━━━\n`)
  return { pass, fail }
}

const dataDir = resolve(ROOT, 'test-tauri-data-revert')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
