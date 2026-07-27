// 角度9：真实 MCP 传输角度循环测试
// 派生子代理（弱模型）视角：stdio/sse/websocket 三种 transport 的配置写盘 + connect 路径
// 验证：① 三种 transport 写入 mcp.user.yaml 字段正确 ② connect 时 SSRF 拒接内网 ③ stdio spawn 不真跑（验证 spawn 路径不崩）
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-transport-${Date.now().toString().slice(-6)}`)
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
  console.log(`\n${'='.repeat(75)}\n  角度9：真实 MCP 传输角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)
  const sidecar = startSidecar()
  try {
    await sidecar.ready
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    console.log(`✅ Sidecar 就绪\n`)

    // ============================================
    // A) stdio transport 写盘字段正确
    // ============================================
    console.log('【A. stdio transport 写盘】')
    await sidecar.invoke('mcp:add', [{
      id: 'stdio-srv', name: 'Stdio测试', enabled: true,
      transport: 'stdio', command: 'node', args: ['-e', 'console.log(0)'],
      env: { NODE_ENV: 'test' },
    }])
    await check('mcp.user.yaml 含 stdio-srv 字段正确', () => {
      const yaml = readFileSync(resolve(DATA_DIR, 'mcp.user.yaml'), 'utf-8')
      if (!yaml.includes('id: stdio-srv')) throw new Error('缺 id')
      if (!yaml.includes('transport: stdio')) throw new Error('缺 transport')
      if (!yaml.includes('command: node')) throw new Error('缺 command')
      if (!yaml.includes('-e')) throw new Error('缺 args -e')
      if (!yaml.includes('NODE_ENV')) throw new Error('缺 env NODE_ENV')
    })

    // ============================================
    // B) sse transport 写盘字段正确
    // ============================================
    console.log('\n【B. sse transport 写盘】')
    await sidecar.invoke('mcp:add', [{
      id: 'sse-srv', name: 'SSE测试', enabled: true,
      transport: 'sse', url: 'https://example.com/sse',
      headers: { Authorization: 'Bearer xxx' },
    }])
    await check('mcp.user.yaml 含 sse-srv 字段正确', () => {
      const yaml = readFileSync(resolve(DATA_DIR, 'mcp.user.yaml'), 'utf-8')
      if (!yaml.includes('id: sse-srv')) throw new Error('缺 id')
      if (!yaml.includes('transport: sse')) throw new Error('缺 transport')
      if (!yaml.includes('url: https://example.com/sse')) throw new Error('缺 url')
      if (!yaml.includes('Authorization')) throw new Error('缺 headers Authorization')
    })

    // ============================================
    // C) websocket transport 写盘字段正确
    // ============================================
    console.log('\n【C. websocket transport 写盘】')
    await sidecar.invoke('mcp:add', [{
      id: 'ws-srv', name: 'WS测试', enabled: true,
      transport: 'websocket', url: 'wss://example.com/ws',
    }])
    await check('mcp.user.yaml 含 ws-srv 字段正确', () => {
      const yaml = readFileSync(resolve(DATA_DIR, 'mcp.user.yaml'), 'utf-8')
      if (!yaml.includes('id: ws-srv')) throw new Error('缺 id')
      if (!yaml.includes('transport: websocket')) throw new Error('缺 transport')
      if (!yaml.includes('wss://example.com/ws')) throw new Error('缺 url')
    })

    // ============================================
    // D) connect 时 SSRF 拒接内网（sse + websocket）
    // ============================================
    console.log('\n【D. SSRF 拒接内网】')
    // sse 指向 127.0.0.1
    await sidecar.invoke('mcp:add', [{ id: 'ssrf-loop', name: 'L', enabled: true, transport: 'sse', url: 'http://127.0.0.1:9999/sse' }])
    await expectShape('connect sse 127.0.0.1 → success=false（SSRF 拒接）', () => sidecar.invoke('mcp:connect', ['ssrf-loop']), (r) => r?.success === false)
    // websocket 指向 169.254.169.254（云元数据）
    await sidecar.invoke('mcp:add', [{ id: 'ssrf-meta', name: 'M', enabled: true, transport: 'websocket', url: 'ws://169.254.169.254/mcp' }])
    await expectShape('connect ws 169.254.169.254 → success=false（SSRF 拒接）', () => sidecar.invoke('mcp:connect', ['ssrf-meta']), (r) => r?.success === false)
    // sse 指向 192.168.x
    await sidecar.invoke('mcp:add', [{ id: 'ssrf-priv', name: 'P', enabled: true, transport: 'sse', url: 'http://192.168.1.1/sse' }])
    await expectShape('connect sse 192.168.1.1 → success=false（SSRF 拒接）', () => sidecar.invoke('mcp:connect', ['ssrf-priv']), (r) => r?.success === false)

    // ============================================
    // E) stdio connect 启动 spawn（command=node 内置不真跑业务，应 connect 失败但不崩 sidecar）
    // ============================================
    console.log('\n【E. stdio spawn 路径不崩】')
    // connect stdio-srv 启动 spawn node -e console.log(0)，无 JSON-RPC 握手 → connect 超时失败但不崩 sidecar
    const connectR = await sidecar.invoke('mcp:connect', ['stdio-srv']).catch((e) => ({ success: false, err: e.message }))
    await check('connect stdio spawn 不崩 sidecar（success 或 graceful）', () => {
      if (typeof connectR?.success !== 'boolean') throw new Error(`shape: ${JSON.stringify(connectR).slice(0, 80)}`)
    })
    // 验证 sidecar 仍可用（后续 invoke 仍响应）
    await expectShape('stdio spawn 后 sidecar 仍响应', () => sidecar.invoke('mcp:list'), (r) => r?.success === true)

    // ============================================
    // F) 环境变量插值（${VAR} 语法）
    // ============================================
    console.log('\n【F. 环境变量插值】')
    // 写一个含 ${PATH} 的 stdio server env，验证插值后 PATH 非空
    await sidecar.invoke('mcp:add', [{
      id: 'env-interp', name: 'E', enabled: true,
      transport: 'stdio', command: 'node', args: ['-e', '0'],
      env: { MY_VAR: '${PATH}' },
    }])
    await check('mcp.user.yaml 含 ${PATH} 插值语法（未插值保存）', () => {
      const yaml = readFileSync(resolve(DATA_DIR, 'mcp.user.yaml'), 'utf-8')
      if (!yaml.includes('${PATH}')) throw new Error('缺 ${PATH} 插值语法')
    })

    // 清理所有 server
    for (const id of ['stdio-srv', 'sse-srv', 'ws-srv', 'ssrf-loop', 'ssrf-meta', 'ssrf-priv', 'env-interp']) {
      await sidecar.invoke('mcp:remove', [id])
    }
    await expectShape('清理后 mcp:list=0', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.length === 0)
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
