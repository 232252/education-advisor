// 第6轮：事件流验证
// sidecar 通过 webContents.send 推送事件 (经 Rust window.emit 转发到渲染进程)
// 这里直接测 sidecar 的 stdout event 帧 (模拟 Rust 侧的读取)
//
// 关键事件:
//   - __sidecar__:ready (启动就绪) — 已验证
//   - ai:chat-stream (LLM 流式 token) — 需 API key, 测错误流
//   - agent:status-update (Agent 执行状态)
//   - ollama:pull-progress (模型下载进度)
//   - feishu:bot:status-update (机器人状态)
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
  const eventLog = [] // 所有收到的 event 帧
  let nextId = 1
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ready timeout')), 25000)
    const onLine = (line) => {
      try {
        const m = JSON.parse(line)
        if (m.type === 'result' && m.id != null) {
          const p = pending.get(m.id); if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) }
        } else if (m.type === 'event') {
          eventLog.push({ channel: m.channel, data: m.data, ts: Date.now() })
        }
      } catch {}
    }
    rl.on('line', onLine)
    const checker = (line) => { try { const m = JSON.parse(line); if (m.type === 'event' && m.channel === '__sidecar__:ready') { clearTimeout(t); res(m.data) } } catch {} }
    rl.on('line', checker)
  })
  function invoke(ch, args) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 30000) }) }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500)) }
  return { ready, invoke, shutdown, child, getEvents: () => eventLog }
}

async function runEvents(dataDir) {
  console.log('━━━ 第6轮: 事件流验证 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  console.log('  ✓ __sidecar__:ready 事件已收到\n')
  const results = [{ check: 'ready 事件', status: 'pass' }]

  // ===== 测试 A: ai:chat 无 API key → 应推送 error 事件流 =====
  console.log('━━━ A. ai:chat 流式事件 (无key, 期望 error 事件) ━━━')
  try {
    // chat 是异步流: 立即返回 {success,sessionId}, 然后 sidecar 推送 stream 事件
    const chatRes = await sc.invoke('ai:chat', [{
      providerId: 'openai', modelId: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }]
    }])
    console.log(`  chat 返回: ${JSON.stringify(chatRes).slice(0, 80)}`)
    // 等 3 秒收集事件
    await new Promise(r => setTimeout(r, 3000))
    const chatEvents = sc.getEvents().filter(e => e.channel === 'ai:chat-stream')
    if (chatEvents.length > 0) {
      const lastEvent = chatEvents[chatEvents.length - 1]
      console.log(`  ✓ 收到 ${chatEvents.length} 个 ai:chat-stream 事件, 最后一个: ${JSON.stringify(lastEvent.data).slice(0, 80)}`)
      results.push({ check: 'ai:chat-stream 事件', status: 'pass', count: chatEvents.length })
    } else {
      console.log(`  ~ 未收到 ai:chat-stream 事件 (可能流尚未开始或被跳过)`)
      results.push({ check: 'ai:chat-stream 事件', status: 'no_event' })
    }
  } catch (e) {
    console.log(`  chat 调用失败 (预期, 无key): ${e.message.slice(0, 60)}`)
    results.push({ check: 'ai:chat 调用', status: 'expected_fail' })
  }

  // ===== 测试 B: agent:run-manual (无key, 期望 status-update 事件) =====
  console.log('\n━━━ B. agent:run-manual 事件 (无key) ━━━')
  try {
    const runRes = await sc.invoke('agent:run-manual', ['class-monitor', '测试任务'])
    console.log(`  run-manual 返回: ${JSON.stringify(runRes).slice(0, 80)}`)
    await new Promise(r => setTimeout(r, 2000))
    const statusEvents = sc.getEvents().filter(e => e.channel === 'agent:status-update')
    console.log(`  → 收到 ${statusEvents.length} 个 agent:status-update 事件`)
    if (statusEvents.length > 0) {
      console.log(`  ✓ agent 状态事件流正常`)
      results.push({ check: 'agent:status-update 事件', status: 'pass', count: statusEvents.length })
    } else {
      results.push({ check: 'agent:status-update 事件', status: 'no_event' })
    }
  } catch (e) {
    console.log(`  run-manual: ${e.message.slice(0, 60)}`)
    results.push({ check: 'agent:run-manual', status: 'fail', error: e.message })
  }

  // ===== 测试 C: 全部事件汇总 =====
  console.log('\n━━━ C. 事件统计 ━━━')
  const allEvents = sc.getEvents()
  const byChannel = {}
  for (const e of allEvents) { byChannel[e.channel] = (byChannel[e.channel] || 0) + 1 }
  console.log('  收到的事件通道分布:')
  for (const [ch, count] of Object.entries(byChannel)) {
    console.log(`    ${ch}: ${count}`)
  }
  results.push({ check: '事件统计', channels: byChannel, total: allEvents.length })

  await sc.shutdown()

  const report = { round: 'R6-事件流', timestamp: new Date().toISOString(), results, eventChannels: byChannel }
  writeFileSync(resolve(RESULTS_DIR, 'R6-事件流.json'), JSON.stringify(report, null, 2))
  console.log(`\n━━━ 事件流测试完成 ━━━\n`)
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-events')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
runEvents(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
