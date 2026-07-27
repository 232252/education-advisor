// 角度1：agent 调用 + 存储角度循环测试
// 派生子代理（弱模型）视角：模拟 AI 调用 MCP 工具 + 验证 mcp.user.yaml 落盘 + agents.yaml mcp_servers 字段
// 验证：① agent 能拿到 MCP 工具集 ② add/update/remove 后 mcp.user.yaml 持久化 ③ agent 配置 mcp_servers 持久化
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-agent-storage-${Date.now().toString().slice(-6)}`)
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
  function invoke(channel, args) {
    const id = nextId++
    return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel, args }) + '\n') })
  }
  function shutdown() { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {}; setTimeout(() => { try { child.kill() } catch {} }, 800) }
  return { ready, invoke, shutdown }
}

let pass = 0, fail = 0
const failures = []
async function check(label, fn) {
  const s = Date.now()
  try { await fn(); console.log(`  ✓ ${label.padEnd(55)} (${Date.now() - s}ms)`); pass++ }
  catch (e) { console.log(`  ✗ ${label.padEnd(55)} (${Date.now() - s}ms) → ${e.message.slice(0, 80)}`); fail++; failures.push({ label, msg: e.message }) }
}
async function expectShape(label, fn, p) { return check(label, async () => { const r = await fn(); if (!p(r)) throw new Error(`shape: ${JSON.stringify(r).slice(0, 100)}`) }) }

async function main() {
  console.log(`\n${'='.repeat(75)}\n  角度1：agent 调用 + 存储角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)
  const sidecar = startSidecar()
  try {
    await sidecar.ready
    console.log(`✅ Sidecar 就绪\n`)

    // ============================================
    // A) agent 调用角度：模拟 AI 通过 MCP 工具集调用
    // ============================================
    console.log('【A. agent 调用角度】')
    // 启用 MCP
    await expectShape('启用 MCP flag', () => sidecar.invoke('settings:set', ['mcp.enabled', true]), (r) => r?.success === true)
    // 添加 stdio MCP server（用 node 内置 echo 模拟工具暴露）
    await expectShape('添加 echo MCP server', () => sidecar.invoke('mcp:add', [{
      id: 'echo-srv', name: 'Echo', enabled: true, transport: 'stdio', command: 'node', args: ['-e', 'process.stdin.on("data",d=>{})'],
    }]), (r) => r?.success === true)
    // 模拟 AI 调用：agent:list 应能看到 18 agents（MCP 不影响 agent 数量）
    await expectShape('agent:list 仍含 18 agents', () => sidecar.invoke('agent:list'), (r) => Array.isArray(r) && r.length === 18)
    // 模拟 AI 调用：mcp:list-tools 应返回（未连接时空或失败）
    await expectShape('AI 调 mcp:list-tools 应答', () => sidecar.invoke('mcp:list-tools', ['echo-srv']), (r) => r && typeof r.success === 'boolean')
    // 模拟 AI：尝试调 agent:get 一个 main agent
    await expectShape('AI 调 agent:get("main")', () => sidecar.invoke('agent:get', ['main']), (r) => r && (r.id === 'main' || r === null))
    // agent:update 给 main 加 mcp_servers 字段（模拟 AI 配 agent 接 MCP）
    await expectShape('AI 调 agent:update main 加 mcp_servers', () => sidecar.invoke('agent:update', ['main', { mcpServers: ['echo-srv'] }]), (r) => r?.success === true)
    // agent:get 验 mcpServers 已回填
    await expectShape('agent:get 含 mcpServers=["echo-srv"]', () => sidecar.invoke('agent:get', ['main']), (r) => r && Array.isArray(r.mcpServers) && r.mcpServers.includes('echo-srv'))

    // ============================================
    // B) 存储角度：配置持久化到磁盘
    // ============================================
    console.log('\n【B. 存储角度：配置落盘】')
    // mcp.user.yaml 应含 echo-srv
    await check('mcp.user.yaml 含 echo-srv', () => {
      const p = resolve(DATA_DIR, 'mcp.user.yaml')
      if (!existsSync(p)) throw new Error('mcp.user.yaml not found')
      const txt = readFileSync(p, 'utf-8')
      if (!txt.includes('echo-srv')) throw new Error('echo-srv not in mcp.user.yaml')
    })
    // agents.user.yaml 应含 mcp_servers（agent:update 异步 rename，等 200ms 让原子写完成）
    await new Promise((r) => setTimeout(r, 200))
    await check('agents.user.yaml(.tmp) 含 mcp_servers 字段', () => {
      const dir = DATA_DIR
      const files = readdirSync(dir)
      const cand = files.filter((f) => f.startsWith('agents.user.yaml'))
      if (cand.length === 0) throw new Error('no agents.user.yaml* found')
      let found = false
      for (const f of cand) {
        const txt = readFileSync(resolve(dir, f), 'utf-8')
        if (txt.includes('mcp_servers') || txt.includes('mcpServers')) { found = true; break }
      }
      if (!found) throw new Error('mcp_servers not in any agents.user.yaml*')
    })
    // settings.json 应含 mcp.enabled=true
    await check('settings.json 含 mcp.enabled=true', () => {
      const p = resolve(DATA_DIR, 'settings.json')
      if (!existsSync(p)) throw new Error('settings.json not found')
      const txt = readFileSync(p, 'utf-8')
      if (!txt.includes('"enabled":true') && !txt.includes('"enabled": true')) throw new Error('mcp.enabled not true in settings.json')
    })
    // 移除 server 后 mcp.user.yaml 应不再含 echo-srv
    await sidecar.invoke('mcp:remove', ['echo-srv'])
    await check('remove 后 mcp.user.yaml 不含 echo-srv', () => {
      const p = resolve(DATA_DIR, 'mcp.user.yaml')
      if (!existsSync(p)) return // 文件被删空也接受
      const txt = readFileSync(p, 'utf-8')
      if (txt.includes('echo-srv')) throw new Error('echo-srv still in mcp.user.yaml')
    })

    // ============================================
    // C) 内存角度：handler 不泄漏
    // ============================================
    console.log('\n【C. 内存角度：连续 add/remove 不泄漏 handler〕')
    for (let i = 0; i < 20; i++) {
      await sidecar.invoke('mcp:add', [{ id: `leak-${i}`, name: 'L', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }])
      await sidecar.invoke('mcp:remove', [`leak-${i}`])
    }
    // 最后 mcp:list 应为 0
    await expectShape('20 轮 add/remove 后 mcp:list 为 0', () => sidecar.invoke('mcp:list'), (r) => r?.success === true && r.servers.length === 0)

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
