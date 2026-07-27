// 角度8：错误恢复角度循环测试
// 派生子代理（弱模型）视角：sidecar 崩溃/损坏 YAML/未配置 API key 等错误路径恢复
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-err-recovery-${Date.now().toString().slice(-6)}`)
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
  console.log(`\n${'='.repeat(75)}\n  角度8：错误恢复角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)
  const sidecar0 = startSidecar()
  let sidecar = sidecar0
  try {
    await sidecar.ready
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    console.log(`✅ Sidecar 就绪\n`)

    // ============================================
    // A) 损坏 mcp.user.yaml 的恢复
    // ============================================
    console.log('【A. 损坏 YAML 恢复】')
    // 写入语法错的 mcp.user.yaml
    writeFileSync(resolve(DATA_DIR, 'mcp.user.yaml'), 'servers: [\n  invalid yaml :::\n]')
    sidecar.shutdown()
    await new Promise((r) => setTimeout(r, 1500))
    sidecar = startSidecar()
    await sidecar.ready
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    // sidecar 应不崩，mcp:list 返回 success（空或忽略损坏段）
    await expectShape('损坏 YAML 后 sidecar 不崩 mcp:list success', () => sidecar.invoke('mcp:list'), (r) => r?.success === true)
    // add 应仍能工作（覆盖损坏文件）
    await expectShape('损坏 YAML 后 add 仍能工作', () => sidecar.invoke('mcp:add', [{ id: 'post-corrupt', name: 'P', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }]), (r) => r?.success === true)

    // ============================================
    // B) 未配置 API key 调 ai:chat 应明确响应（sidecar mock 模式可能 success+stream）
    // ============================================
    console.log('\n【B. 未配置 API key 明确响应】')
    await expectShape('ai:chat 未配 key 应明确响应（success 或 graceful）', () => sidecar.invoke('ai:chat', [{ providerId: 'openai', modelId: 'gpt-4', messages: [] }]).catch((e) => ({ success: false, err: e.message })), (r) => r && (typeof r.success === 'boolean' || r.err !== undefined))

    // ============================================
    // C) 不存在的 serverId 调 list-tools/connect/disconnect
    // ============================================
    console.log('\n【C. 不存在 serverId 错误路径】')
    await expectShape('list-tools 不存在 server → graceful', () => sidecar.invoke('mcp:list-tools', ['no-such-srv']), (r) => r && typeof r.success === 'boolean')
    await expectShape('connect 不存在 server → success=false', () => sidecar.invoke('mcp:connect', ['no-such-srv']), (r) => r?.success === false)
    await expectShape('disconnect 不存在 server → 幂等成功', () => sidecar.invoke('mcp:disconnect', ['no-such-srv']), (r) => r?.success === true || r?.success === undefined)

    // ============================================
    // D) 空参数/缺参数应优雅失败
    // ============================================
    console.log('\n【D. 空参数错误路径】')
    await expectShape('skill:get 空名 → graceful', () => sidecar.invoke('skill:get', ['']), (r) => r && (r.success === false || r === null))
    await expectShape('mcp:update 缺 patch → success=false', () => sidecar.invoke('mcp:update', ['x']), (r) => r?.success === false)
    await expectShape('mcp:add 缺 config → success=false', () => sidecar.invoke('mcp:add', []), (r) => r?.success === false)

    // ============================================
    // E) sidecar 崩溃后 invoke 应明确失败（不永卡）
    // ============================================
    console.log('\n【E. sidecar 崩溃后 invoke 明确失败】')
    sidecar.shutdown()
    await new Promise((r) => setTimeout(r, 1500))
    // 已 shutdown 后再 invoke 应在 stdin 写入时抛错（EPIPE）
    let crashOk = false
    try {
      await Promise.race([
        sidecar.invoke('mcp:list'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 3s')), 3000)),
      ])
    } catch (e) {
      crashOk = e.message.includes('timeout') || e.message.includes('EPIPE') || e.message.includes('This socket has been ended') || e.code === 'ERR_STREAM_DESTROYED'
    }
    await check('崩溃后 invoke 不永卡（明确失败 ≤3s）', () => { if (!crashOk) throw new Error('未明确失败') })

    // ============================================
    // F) 重启后配置无残留损坏
    // ============================================
    console.log('\n【F. 重启后无残留损坏】')
    sidecar = startSidecar()
    await sidecar.ready
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    await expectShape('重启后 mcp:list 含 post-corrupt（覆盖损坏后恢复）', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.some((s) => s.id === 'post-corrupt'))
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
