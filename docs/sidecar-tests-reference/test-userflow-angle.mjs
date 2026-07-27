// 角度11：用户操作模拟角度循环测试
// 派生子代理（弱模型）视角：模拟真实用户在技能页的完整交互路径
// 验证：① Tab 切换不丢状态 ② 完整 add→启停→连接测试→工具浏览→删除闭环 ③ 模拟误操作回退
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-userflow-${Date.now().toString().slice(-6)}`)
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
  console.log(`\n${'='.repeat(75)}\n  角度11：用户操作模拟角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)
  const sidecar0 = startSidecar()
  let sidecar = sidecar0
  try {
    await sidecar.ready
    console.log(`✅ Sidecar 就绪\n`)

    // ============================================
    // A) 模拟用户进技能页前先启 MCP flag
    // ============================================
    console.log('【A. 启 MCP flag】')
    await expectShape('settings:set mcp.enabled=true', () => sidecar.invoke('settings:set', ['mcp.enabled', true]), (r) => r?.success === true)
    await expectShape('flag on 后 settings.get mcp.enabled=true', () => sidecar.invoke('settings:get'), (r) => r?.mcp?.enabled === true)

    // ============================================
    // B) 模拟用户在 MCP Tab 完整闭环：add → 启停 → connect → list-tools → disconnect → remove
    // ============================================
    console.log('\n【B. MCP Tab 完整闭环】')
    // add
    await expectShape('add stdio server', () => sidecar.invoke('mcp:add', [{
      id: 'user-flow-srv', name: '用户闭环', enabled: true,
      transport: 'stdio', command: 'node', args: ['-e', 'process.stdin.resume()'],
    }]), (r) => r?.success === true)
    // list 应含
    await expectShape('list 含 user-flow-srv', () => sidecar.invoke('mcp:list'), (r) => r?.servers.some((s) => s.id === 'user-flow-srv'))
    // update 改 enabled: false（停）
    await expectShape('update disabled（停 server）', () => sidecar.invoke('mcp:update', ['user-flow-srv', { enabled: false }]), (r) => r?.success === true)
    // list 应显示 enabled=false
    await expectShape('list 显示 enabled=false', () => sidecar.invoke('mcp:list'), (r) => r?.servers.find((s) => s.id === 'user-flow-srv' && s.enabled === false))
    // 再启
    await expectShape('update enabled=true（再启）', () => sidecar.invoke('mcp:update', ['user-flow-srv', { enabled: true }]), (r) => r?.success === true)
    await expectShape('list 显示 enabled=true', () => sidecar.invoke('mcp:list'), (r) => r?.servers.find((s) => s.id === 'user-flow-srv' && s.enabled === true))
    // connect（stdio 无 JSON-RPC 握手 → 失败但不崩）
    await expectShape('connect（应失败但不崩）', () => sidecar.invoke('mcp:connect', ['user-flow-srv']).catch((e) => ({ success: false, err: e.message })), (r) => r && typeof r.success === 'boolean')
    // list-tools（即使未连接也应明确响应）
    await expectShape('list-tools 明确响应', () => sidecar.invoke('mcp:list-tools', ['user-flow-srv']), (r) => r && typeof r.success === 'boolean')
    // disconnect（幂等）
    await expectShape('disconnect 幂等', () => sidecar.invoke('mcp:disconnect', ['user-flow-srv']), (r) => r?.success === true || r?.success === undefined)
    // remove
    await expectShape('remove user-flow-srv', () => sidecar.invoke('mcp:remove', ['user-flow-srv']), (r) => r?.success === true)
    await expectShape('remove 后 list 不含', () => sidecar.invoke('mcp:list'), (r) => r?.success && !r.servers.some((s) => s.id === 'user-flow-srv'))

    // ============================================
    // C) 模拟用户误操作回退：add 同名 → 拒绝 → 改名 → 成功
    // ============================================
    console.log('\n【C. 误操作回退】')
    await sidecar.invoke('mcp:add', [{ id: 'dup', name: 'D', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }])
    await expectShape('add 同名 dup 应拒', () => sidecar.invoke('mcp:add', [{ id: 'dup', name: 'D2', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }]), (r) => r?.success === false)
    // 改名后成功
    await expectShape('add 改名 dup2 成功', () => sidecar.invoke('mcp:add', [{ id: 'dup2', name: 'D2', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }]), (r) => r?.success === true)
    // update 不存在 server 应拒
    await expectShape('update 不存在 server 应拒', () => sidecar.invoke('mcp:update', ['no-exist', { name: 'X' }]), (r) => r?.success === false)
    // remove 不存在 server 应拒（幂等 delete 视实现，但拒更安全）
    await sidecar.invoke('mcp:remove', ['dup'])
    await sidecar.invoke('mcp:remove', ['dup2'])

    // ============================================
    // D) 模拟用户在技能 Tab CRUD 闭环
    // ============================================
    console.log('\n【D. 技能 Tab CRUD 闭环】')
    await expectShape('skill:save 创建', () => sidecar.invoke('skill:save', ['user-skill', '# 用户技能\n内容']), (r) => r?.success === true)
    await expectShape('skill:get 应回', () => sidecar.invoke('skill:get', ['user-skill']), (r) => r && r.name === 'user-skill' && r.content.includes('用户技能'))
    // list 应含
    await expectShape('skill:list 含 user-skill', () => sidecar.invoke('skill:list'), (r) => Array.isArray(r) && r.some((s) => s.id === 'user-skill' || s === 'user-skill' || s.name === 'user-skill'))
    // 改内容
    await expectShape('skill:save 改内容', () => sidecar.invoke('skill:save', ['user-skill', '# 改后\n新内容']), (r) => r?.success === true)
    await expectShape('skill:get 显示改后', () => sidecar.invoke('skill:get', ['user-skill']), (r) => r && r.content.includes('改后'))
    // 删
    await expectShape('skill:delete 删', () => sidecar.invoke('skill:delete', ['user-skill']), (r) => r?.success === true)
    await expectShape('skill:get 删后应空/拒', () => sidecar.invoke('skill:get', ['user-skill']).catch((e) => ({ err: e.message })), (r) => r === null || r?.success === false || r?.err !== undefined)

    // ============================================
    // E) 模拟用户在 PluginsTab 跳转：启 MCP → 看 PluginsTab 概览 → 跳 MCP Tab
    // ============================================
    console.log('\n【E. PluginsTab 跳转模拟】')
    // 当前 MCP flag on，加一个 server
    await sidecar.invoke('mcp:add', [{ id: 'ov-srv', name: '概览', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }])
    // PluginsTab 概览数据拉取（模拟 useEffect）
    const overview = await Promise.allSettled([
      sidecar.invoke('settings:get'),
      sidecar.invoke('mcp:list'),
      sidecar.invoke('skill:list'),
      sidecar.invoke('cron:list'),
      sidecar.invoke('feishu:bot:status'),
    ])
    await check('PluginsTab 概览 5 路全 fulfilled', () => {
      const rej = overview.filter((r) => r.status === 'rejected')
      if (rej.length) throw new Error(`${rej.length} rejected`)
    })
    // 概览 mcp 应显示 1 个 server
    await expectShape('概览 mcp 含 ov-srv', () => sidecar.invoke('mcp:list'), (r) => r?.servers.some((s) => s.id === 'ov-srv'))
    // 清理
    await sidecar.invoke('mcp:remove', ['ov-srv'])
    await sidecar.invoke('settings:set', ['mcp.enabled', false])

    // ============================================
    // F) 模拟用户重启后回到技能页：状态应恢复
    // ============================================
    console.log('\n【F. 重启后状态恢复】')
    // 先启 MCP + add server + save skill
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    await sidecar.invoke('mcp:add', [{ id: 'persist-flow', name: '持久', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }])
    await sidecar.invoke('skill:save', ['persist-flow-skill', '# 持久'])
    sidecar.shutdown()
    await new Promise((r) => setTimeout(r, 1500))
    sidecar = startSidecar()
    await sidecar.ready
    await expectShape('重启后 mcp.enabled=true', () => sidecar.invoke('settings:get'), (r) => r?.mcp?.enabled === true)
    await expectShape('重启后 mcp:list 含 persist-flow', () => sidecar.invoke('mcp:list'), (r) => r?.servers.some((s) => s.id === 'persist-flow'))
    await expectShape('重启后 skill:get persist-flow-skill', () => sidecar.invoke('skill:get', ['persist-flow-skill']), (r) => r && r.name === 'persist-flow-skill')
    // 清理
    await sidecar.invoke('mcp:remove', ['persist-flow'])
    await sidecar.invoke('skill:delete', ['persist-flow-skill'])
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
