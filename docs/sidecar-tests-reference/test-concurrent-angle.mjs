// 角度3：并发角度循环测试
// 派生子代理（弱模型）视角：模拟渲染层多 Tab 并发拉取、快速 flag 切换、并发 add/remove 竞态
// 验证：① 5 个 PluginsTab 概览请求并发不冲突 ② flag 快速切换20次稳定 ③ 10路并发 add/remove 无竞态
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-concurrent-${Date.now().toString().slice(-6)}`)
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

function startSidecar() {
  const child = spawn('node', [resolve(ROOT, 'sidecar/edu-sidecar.mjs')], {
    env: { ...process.env, EDU_APP_DATA_DIR: DATA_DIR, EDU_RESOURCE_DIR: ROOT },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1
  let readyResolve
  const ready = new Promise((res) => { readyResolve = res })
  rl.on('line', (line) => {
    try {
      const m = JSON.parse(line)
      if (m.type === 'event' && m.channel === '__sidecar__:ready') { if (readyResolve) { readyResolve(m.data); readyResolve = null }; return }
      if (m.type === 'result' && m.id != null) {
        const p = pending.get(m.id)
        if (p) { pending.delete(m.id); if (m.ok) p.resolve(m.data); else p.reject(new Error(m.error || '?')) }
      }
    } catch {}
  })
  function invoke(ch, args) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args }) + '\n') }) }
  function shutdown() { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {}; setTimeout(() => { try { child.kill() } catch {} }, 800) }
  return { ready, invoke, shutdown }
}

let pass = 0, fail = 0
const failures = []
async function check(label, fn) {
  const s = Date.now()
  try { await fn(); console.log(`  ✓ ${label.padEnd(55)} (${Date.now() - s}ms)`); pass++ }
  catch (e) { console.log(`  ✗ ${label.padEnd(55)} (${Date.now() - s}ms) → ${e.message.slice(0, 90)}`); fail++; failures.push({ label, msg: e.message }) }
}
async function expectShape(label, fn, p) { return check(label, async () => { const r = await fn(); if (!p(r)) throw new Error(`shape: ${JSON.stringify(r).slice(0, 100)}`) }) }

async function main() {
  console.log(`\n${'='.repeat(75)}\n  角度3：并发角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)
  const sidecar = startSidecar()
  try {
    await sidecar.ready
    console.log(`✅ Sidecar 就绪\n`)

    // ============================================
    // A) 5 个 PluginsTab 概览请求并发（模拟多 Tab 同时挂载）
    // ============================================
    console.log('【A. 5 路概览并发】')
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    const results = await Promise.allSettled([
      sidecar.invoke('settings:get'),
      sidecar.invoke('mcp:list'),
      sidecar.invoke('skill:list'),
      sidecar.invoke('cron:list'),
      sidecar.invoke('feishu:bot:status'),
    ])
    await check('5 路概览并发全 fulfilled', () => {
      const rejected = results.filter((r) => r.status === 'rejected')
      if (rejected.length > 0) throw new Error(`${rejected.length} rejected: ${rejected[0].reason?.message}`)
    })
    // 形状仍正确
    await expectShape('并发后 settings:get 仍含 mcp.enabled', () => sidecar.invoke('settings:get'), (r) => r && typeof r.mcp?.enabled === 'boolean')

    // ============================================
    // B) flag 快速切换 20 次（模拟用户狂点启用/禁用按钮）
    // ============================================
    console.log('\n【B. flag 快速切换 20 次】')
    let toggleOk = 0
    for (let i = 0; i < 20; i++) {
      const r = await sidecar.invoke('settings:set', ['mcp.enabled', i % 2 === 0])
      if (r?.success === true) toggleOk++
    }
    await check(`20 次切换全 success（实 ${toggleOk}/20）`, () => {
      if (toggleOk !== 20) throw new Error(`only ${toggleOk}/20`)
    })
    // 最终态可读且一致
    await sidecar.invoke('settings:set', ['mcp.enabled', false])
    await expectShape('20 次切换后 settings.mcp.enabled=false', () => sidecar.invoke('settings:get'), (r) => r?.mcp?.enabled === false)

    // ============================================
    // C) 10 路并发 add/remove 竞态（模拟多 Tab 同时操作 MCP）
    // ============================================
    console.log('\n【C. 10 路并发 add/remove 竞态】')
    const addTasks = []
    for (let i = 0; i < 10; i++) {
      addTasks.push(sidecar.invoke('mcp:add', [{
        id: `race-${i}`, name: `R${i}`, enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'],
      }]))
    }
    const addResults = await Promise.allSettled(addTasks)
    await check('10 路并发 add 全 success', () => {
      const fail = addResults.filter((r) => r.status !== 'fulfilled' || !r.value?.success)
      if (fail.length > 0) throw new Error(`${fail.length} failed`)
    })
    // 验证 10 个全在
    await expectShape('10 路并发后 mcp:list 长度=10', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.length === 10)
    // 10 路并发 remove
    const rmTasks = []
    for (let i = 0; i < 10; i++) rmTasks.push(sidecar.invoke('mcp:remove', [`race-${i}`]))
    const rmResults = await Promise.allSettled(rmTasks)
    await check('10 路并发 remove 全 success', () => {
      const fail = rmResults.filter((r) => r.status !== 'fulfilled' || !r.value?.success)
      if (fail.length > 0) throw new Error(`${fail.length} failed`)
    })
    await expectShape('10 路并发 remove 后 mcp:list=0', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.length === 0)

    // ============================================
    // D) 同 server 并发 update 竞态（模拟双 Tab 同时改名）
    // ============================================
    console.log('\n【D. 同 server 并发 update 竞态）')
    await sidecar.invoke('mcp:add', [{ id: 'dup-update', name: 'D', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }])
    const updTasks = []
    for (let i = 0; i < 5; i++) updTasks.push(sidecar.invoke('mcp:update', ['dup-update', { name: `Name${i}` }]))
    const updResults = await Promise.allSettled(updTasks)
    await check('5 路同 server 并发 update 全 success', () => {
      const fail = updResults.filter((r) => r.status !== 'fulfilled' || !r.value?.success)
      if (fail.length > 0) throw new Error(`${fail.length} failed`)
    })
    // 终态应是 5 个之一（无锁保证最后值，只验证存在且有 server）
    await expectShape('并发 update 后 server 仍存在', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.some((s) => s.id === 'dup-update'))
    await sidecar.invoke('mcp:remove', ['dup-update'])

    // ============================================
    // E) 并发 add 同 id（模拟双 Tab 同时加同 id server）
    // ============================================
    console.log('\n【E. 并发 add 同 id 冲突）')
    const dupAddTasks = []
    for (let i = 0; i < 3; i++) dupAddTasks.push(sidecar.invoke('mcp:add', [{ id: 'same-id', name: `S${i}`, enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }]))
    const dupAddResults = await Promise.allSettled(dupAddTasks)
    // 第一个应 success，后两个应失败（id 已存在）—— 至少一个 success
    await check('3 路同 id 并发 add 至少 1 个 success', () => {
      const ok = dupAddResults.filter((r) => r.status === 'fulfilled' && r.value?.success).length
      if (ok < 1) throw new Error(`none succeeded`)
    })
    // 终态只应 1 个 same-id
    await expectShape('并发 add 同 id 后只 1 个 same-id', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.filter((s) => s.id === 'same-id').length === 1)
    await sidecar.invoke('mcp:remove', ['same-id'])
    await sidecar.invoke('settings:set', ['mcp.enabled', false])

    console.log(`\n${'─'.repeat(75)}`)
    console.log(`  结果: ${pass} 通过 / ${fail} 失败`)
    if (failures.length) { console.log('  失败:'); for (const f of failures) console.log(`    - ${f.label}: ${f.msg}`) }
    console.log(`${'─'.repeat(75)}\n`)
  } finally {
    sidecar.shutdown()
    setTimeout(() => { try { rmSync(DATA_DIR, { recursive: true, force: true }) } catch {} }, 1500)
  }
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(2) })
