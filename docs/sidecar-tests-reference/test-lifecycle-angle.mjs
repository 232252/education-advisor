// 角度4：生命周期角度循环测试
// 派生子代理（弱模型）视角：模拟 sidecar 重启后配置恢复、flag 一致、destroy 后无残留
// 验证：① sidecar 重启后 mcp.user.yaml 配置恢复 ② flag 状态跨重启一致 ③ destroy 后无 stdin 残留响应
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-lifecycle-${Date.now().toString().slice(-6)}`)
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
  return { ready, invoke, shutdown, child }
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
  console.log(`\n${'='.repeat(75)}\n  角度4：生命周期角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)

  // ============================================
  // A) 第一轮 sidecar：写入配置 + flag + server
  // ============================================
  console.log('【A. 第一轮：写入配置】')
  let sidecar = startSidecar()
  await sidecar.ready
  await sidecar.invoke('settings:set', ['mcp.enabled', true])
  await sidecar.invoke('mcp:add', [{ id: 'persist-srv', name: '持久', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }])
  await sidecar.invoke('skill:save', ['persist-skill', '# 持久技能\n测试'])
  await expectShape('写入后 mcp:list 含 persist-srv', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.some((s) => s.id === 'persist-srv'))
  sidecar.shutdown()
  // 等子进程退出
  await new Promise((r) => setTimeout(r, 1500))

  // ============================================
  // B) 第二轮 sidecar：验证配置恢复
  // ============================================
  console.log('\n【B. 第二轮：配置恢复】')
  sidecar = startSidecar()
  await sidecar.ready
  await expectShape('重启后 mcp.enabled=true', () => sidecar.invoke('settings:get'), (r) => r?.mcp?.enabled === true)
  await expectShape('重启后 mcp:list 含 persist-srv', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.some((s) => s.id === 'persist-srv'))
  await expectShape('重启后 skill:get persist-skill', () => sidecar.invoke('skill:get', ['persist-skill']), (r) => r && r.name === 'persist-skill' && typeof r.content === 'string')
  // 18 agents 跨重启稳定
  await expectShape('重启后 agent:list 仍 18', () => sidecar.invoke('agent:list'), (r) => Array.isArray(r) && r.length === 18)

  // ============================================
  // C) destroy 后无残留：shutdown 信号优雅退出
  // ============================================
  console.log('\n【C. destroy 优雅退出】')
  // 发 shutdown 后子进程应在 3s 内退出
  const exitPromise = new Promise((res) => sidecar.child.on('exit', (code) => res(code)))
  sidecar.shutdown()
  const exitCode = await Promise.race([
    exitPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('exit timeout 5s')), 5000)),
  ]).catch((e) => `ERR:${e.message}`)
  await check(`子进程退出（exit=${exitCode}）`, () => {
    if (typeof exitCode !== 'number') throw new Error(`未正常退出: ${exitCode}`)
  })

  // ============================================
  // D) 重复启动 sidecar 不冲突（模拟用户重启 app）
  // ============================================
  console.log('\n【D. 重复启动不冲突】')
  for (let i = 0; i < 3; i++) {
    const s = startSidecar()
    await s.ready
    await expectShape(`第 ${i + 1} 次重启后 mcp:list 含 persist-srv`, () => s.invoke('mcp:list'), (r) => r?.success && r.servers.some((x) => x.id === 'persist-srv'))
    s.shutdown()
    await new Promise((r) => setTimeout(r, 1200))
  }

  // ============================================
  // E) 跨轮 flag 状态一致
  // ============================================
  console.log('\n【E. 跨轮 flag 一致】')
  sidecar = startSidecar()
  await sidecar.ready
  await sidecar.invoke('settings:set', ['mcp.enabled', false])
  sidecar.shutdown()
  await new Promise((r) => setTimeout(r, 1500))
  sidecar = startSidecar()
  await sidecar.ready
  await expectShape('关 flag 重启后 mcp.enabled=false', () => sidecar.invoke('settings:get'), (r) => r?.mcp?.enabled === false)
  // flag off 时 mcp:list 应 success 但 servers=[]（no-op 模式不读 yaml）
  await expectShape('flag off 时 mcp:list servers=0', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.length === 0)
  sidecar.shutdown()
  await new Promise((r) => setTimeout(r, 1500))

  console.log(`\n${'─'.repeat(75)}`)
  console.log(`  结果: ${pass} 通过 / ${fail} 失败`)
  if (failures.length) { console.log('  失败:'); for (const f of failures) console.log(`    - ${f.label}: ${f.msg}`) }
  console.log(`${'─'.repeat(75)}\n`)

  try { rmSync(DATA_DIR, { recursive: true, force: true }) } catch {}
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(2) })
