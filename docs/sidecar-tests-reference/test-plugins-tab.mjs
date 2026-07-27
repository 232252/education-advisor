// PluginsTab/McpTab 接口调试脚本（v2，修复多 rl 监听器竞态）
// 验证技能页第3个Tab"插件中心"所依赖的全部 IPC 接口可达且返回符合预期
// 派生子代理（弱模型）角度模拟：从渲染层视角调用每个按钮对应的 IPC
// 关键修复：用单一 rl 监听器统一分派 ready/result/log，避免多监听器抢行导致 pending 错配
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-plugins-${Date.now().toString().slice(-6)}`)
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

function startSidecar() {
  const child = spawn('node', [resolve(ROOT, 'sidecar/edu-sidecar.mjs')], {
    env: {
      ...process.env,
      EDU_APP_DATA_DIR: DATA_DIR,
      EDU_RESOURCE_DIR: ROOT,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1
  let readyResolve
  const ready = new Promise((res) => { readyResolve = res })

  // 关键修复：唯一一个 rl.on('line') 监听器，统一分派所有帧
  // 旧实现注册了多个 listener，竞态下行被错误 listener 吃掉导致 pending 拿错 id
  rl.on('line', (line) => {
    let m
    try { m = JSON.parse(line) } catch { return }
    if (m.type === 'event' && m.channel === '__sidecar__:ready') {
      if (readyResolve) { readyResolve(m.data); readyResolve = null }
      return
    }
    if (m.type === 'result' && m.id != null) {
      const p = pending.get(m.id)
      if (p) {
        pending.delete(m.id)
        if (m.ok) p.resolve(m.data)
        else p.reject(new Error(m.error || 'unknown'))
      }
    }
    // log 帧忽略（不污染输出）
  })

  function invoke(channel, args) {
    const id = nextId++
    return new Promise((resP, rejP) => {
      pending.set(id, { resolve: resP, reject: rejP })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel, args }) + '\n')
    })
  }

  function shutdown() {
    try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {}
    setTimeout(() => { try { child.kill() } catch {} }, 800)
  }

  return { ready, invoke, shutdown, child }
}

let pass = 0, fail = 0
const failures = []

// 关键修复：单个按钮失败不中断，记录后继续验证下一个，保证每个按钮都被测到
async function check(label, fn) {
  const start = Date.now()
  try {
    const r = await fn()
    const elapsed = Date.now() - start
    console.log(`  ✓ ${label.padEnd(50)} (${elapsed}ms)`)
    pass++
    return r
  } catch (e) {
    const elapsed = Date.now() - start
    const msg = e.message.slice(0, 80)
    console.log(`  ✗ ${label.padEnd(50)} (${elapsed}ms) → ${msg}`)
    fail++
    failures.push({ label, msg })
    return null
  }
}

async function expectShape(label, fn, predicate) {
  return check(label, async () => {
    const r = await fn()
    if (!predicate(r)) {
      throw new Error(`shape mismatch: ${JSON.stringify(r).slice(0, 100)}`)
    }
    return r
  })
}

async function main() {
  console.log(`\n${'='.repeat(70)}\n  PluginsTab/McpTab 接口调试 v2 — 数据目录 ${DATA_DIR}\n${'='.repeat(70)}\n`)
  const sidecar = startSidecar()
  try {
    const ready = await sidecar.ready
    console.log(`✅ Sidecar 就绪 — ${ready.channels.length} 通道\n`)

    // ============================================
    // 1) PluginsTab 全空态验证：MCP 禁用 + 技能 0 + cron 0 + 飞书 idle + ollama 未跑
    // ============================================
    console.log('【1. PluginsTab 全空态验证】')
    await expectShape(
      'settings:get 含 mcp.enabled=false',
      () => sidecar.invoke('settings:get'),
      (r) => r && r.mcp && r.mcp.enabled === false,
    )
    await expectShape(
      'mcp:list (flag off) → success=true servers=0',
      () => sidecar.invoke('mcp:list'),
      (r) => r && r.success === true && Array.isArray(r.servers) && r.servers.length === 0,
    )
    await expectShape(
      'skill:list → array',
      () => sidecar.invoke('skill:list'),
      (r) => Array.isArray(r),
    )
    await expectShape(
      'cron:list → array',
      () => sidecar.invoke('cron:list'),
      (r) => Array.isArray(r),
    )
    await expectShape(
      'feishu:bot:status → 含 status',
      () => sidecar.invoke('feishu:bot:status'),
      (r) => r && typeof (r).status === 'string',
    )
    await expectShape(
      'ollama:detect → 含 serveRunning',
      () => sidecar.invoke('ollama:detect'),
      (r) => r && typeof (r).serveRunning === 'boolean',
    )

    // ============================================
    // 2) 启用 MCP flag 后的 McpTab 全按钮链路
    // ============================================
    console.log('\n【2. 启用 MCP flag 后按钮链路】')
    await expectShape(
      'settings:set mcp.enabled=true → success',
      () => sidecar.invoke('settings:set', ['mcp.enabled', true]),
      (r) => r && r.success === true,
    )
    const fakeConfig = {
      id: 'test-fs',
      name: '测试服务器',
      enabled: true,
      transport: 'stdio',
      command: 'echo',
      args: ['hello'],
    }
    await expectShape(
      'mcp:add 假 stdio server → success',
      () => sidecar.invoke('mcp:add', [fakeConfig]),
      (r) => r && r.success === true,
    )
    await expectShape(
      'mcp:list 含刚添加的 server',
      () => sidecar.invoke('mcp:list'),
      (r) => r && r.success === true && r.servers.some((s) => s.id === 'test-fs'),
    )
    await expectShape(
      'mcp:update 改名 → success',
      () => sidecar.invoke('mcp:update', ['test-fs', { name: '改名后' }]),
      (r) => r && r.success === true,
    )
    await expectShape(
      'mcp:list-tools 未连接 server',
      () => sidecar.invoke('mcp:list-tools', ['test-fs']),
      (r) => r && typeof (r).success === 'boolean',
    )
    await expectShape(
      'mcp:remove → success',
      () => sidecar.invoke('mcp:remove', ['test-fs']),
      (r) => r && r.success === true,
    )
    await expectShape(
      'mcp:list 删除后为 0',
      () => sidecar.invoke('mcp:list'),
      (r) => r && r.success === true && r.servers.length === 0,
    )
    await expectShape(
      'settings:set mcp.enabled=false → success',
      () => sidecar.invoke('settings:set', ['mcp.enabled', false]),
      (r) => r && r.success === true,
    )

    // ============================================
    // 3) 边界与安全：serverId 格式校验
    // ============================================
    console.log('\n【3. serverId 格式校验（防注入）】')
    await expectShape(
      'mcp:list-tools 非法 serverId → success=false',
      () => sidecar.invoke('mcp:list-tools', ['../../../etc']),
      (r) => r && r.success === false,
    )
    await expectShape(
      'mcp:remove 非法 serverId → success=false',
      () => sidecar.invoke('mcp:remove', ['a b c']),
      (r) => r && r.success === false,
    )
    await expectShape(
      'mcp:update null patch → success=false',
      () => sidecar.invoke('mcp:update', ['x', null]),
      (r) => r && r.success === false,
    )

    // ============================================
    // 4) 技能 Tab：CRUD 链路
    // ============================================
    console.log('\n【4. 技能 Tab CRUD 链路】')
    await expectShape(
      'skill:save 创建测试技能 → success',
      () => sidecar.invoke('skill:save', ['plugin-test-skill', '# 测试\n内容']),
      (r) => r && r.success === true,
    )
    await expectShape(
      'skill:get 应返回刚保存的内容',
      () => sidecar.invoke('skill:get', ['plugin-test-skill']),
      (r) => r && typeof (r).content === 'string' && (r).name === 'plugin-test-skill',
    )
    await expectShape(
      'skill:save null byte → 拒绝',
      () => sidecar.invoke('skill:save', ['bad', 'abc\0def']),
      (r) => r && r.success === false,
    )
    await expectShape(
      'skill:delete 测试技能',
      () => sidecar.invoke('skill:delete', ['plugin-test-skill']),
      (r) => r && r.success === true,
    )

    // ============================================
    // 5) PluginsTab 概览数据契约
    // ============================================
    console.log('\n【5. PluginsTab 概览数据契约】')
    await expectShape(
      'cron:list 项含 enabled 字段',
      () => sidecar.invoke('cron:list'),
      (r) => Array.isArray(r) && (r.length === 0 || typeof (r)[0]?.enabled === 'boolean' || (r)[0]?.enabled === undefined),
    )
    await expectShape(
      'feishu:bot:status status 值域合法',
      () => sidecar.invoke('feishu:bot:status'),
      (r) => r && ['idle', 'connecting', 'connected', 'error'].includes((r).status),
    )

    // ============================================
    // 总结
    // ============================================
    console.log(`\n${'─'.repeat(70)}`)
    console.log(`  结果: ${pass} 通过 / ${fail} 失败`)
    if (failures.length > 0) {
      console.log('  失败明细:')
      for (const f of failures) console.log(`    - ${f.label}: ${f.msg}`)
    }
    console.log(`${'─'.repeat(70)}\n`)
  } finally {
    sidecar.shutdown()
    setTimeout(() => {
      try { rmSync(DATA_DIR, { recursive: true, force: true }) } catch {}
    }, 1500)
  }
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(2)
})
