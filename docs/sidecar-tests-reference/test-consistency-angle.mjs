// 角度7：数据一致性角度循环测试
// 派生子代理（弱模型）视角：MCP 三层配置合并优先级、跨文件一致性、edge case
// 验证：① 全局 mcp.yaml + 用户 mcp.user.yaml 合并语义 ② 同 id 覆盖优先级 ③ listServers 不漏不重
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-consistency-${Date.now().toString().slice(-6)}`)
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
  console.log(`\n${'='.repeat(75)}\n  角度7：数据一致性角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)
  const sidecar0 = startSidecar()
  let sidecar = sidecar0
  try {
    await sidecar.ready
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    console.log(`✅ Sidecar 就绪\n`)

    // ============================================
    // A) 全局 mcp.yaml 与用户 mcp.user.yaml 合并
    // ============================================
    console.log('【A. 全局 + 用户 合并语义】')
    // 全局 mcp.yaml 默认 servers:[]（安全默认），用户 add 后应只在用户层
    const before = await sidecar.invoke('mcp:list')
    await sidecar.invoke('mcp:add', [{ id: 'user-srv-1', name: 'U1', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }])
    await expectShape('add 后 mcp:list 长度 +1', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.length === before.servers.length + 1)
    // 验证 source 字段标记用户层
    await expectShape('user-srv-1 source="user"', () => sidecar.invoke('mcp:list'), (r) => r?.servers.find((s) => s.id === 'user-srv-1' && s.source === 'user'))

    // ============================================
    // B) 同 id 覆盖优先级（用户层覆盖全局层）
    // ============================================
    console.log('\n【B. 同 id 覆盖优先级】')
    // 手写全局 mcp.yaml 含 g-srv，验证用户层 add 同 id 应拒（已有 id 重复）
    const globalYaml = `
servers:
  - id: g-srv
    name: 全局服务器
    enabled: true
    transport: stdio
    command: node
    args: ['-e', '0']
`
    writeFileSync(resolve(ROOT, 'config/mcp.yaml'), globalYaml)
    // 重启 sidecar 加载新全局配置
    sidecar.shutdown()
    await new Promise((r) => setTimeout(r, 1500))
    sidecar = startSidecar()
    await sidecar.ready
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    await expectShape('全局 g-srv 出现且 source="global"', () => sidecar.invoke('mcp:list'), (r) => r?.servers.find((s) => s.id === 'g-srv' && s.source === 'global'))
    // 用户 add 同 id g-srv 应拒（id 唯一）
    await expectShape('add 同 id g-srv 拒绝', () => sidecar.invoke('mcp:add', [{ id: 'g-srv', name: '覆盖', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }]), (r) => r?.success === false)

    // ============================================
    // C) listServers 不漏不重（去重语义）
    // ============================================
    console.log('\n【C. listServers 去重】')
    // 当前应有 g-srv(全局) + user-srv-1(用户)
    await expectShape('listServers 去重后 2 个', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.length === 2)
    await expectShape('无重复 id', () => sidecar.invoke('mcp:list'), (r) => {
      if (!r?.success) return false
      const ids = r.servers.map((s) => s.id)
      return new Set(ids).size === ids.length
    })

    // ============================================
    // D) remove 全局 server 的语义（全局层只读，应拒删——防用户误删内置配置）
    // ============================================
    console.log('\n【D. remove 全局 server 语义（只读拒删）】')
    const rmR = await sidecar.invoke('mcp:remove', ['g-srv'])
    await expectShape('remove 全局 g-srv 应拒（read-only）', () => sidecar.invoke('mcp:remove', ['g-srv']), (r) => r?.success === false)
    // 验证 mcp:list 仍含 g-srv（全局只读，删不掉）
    await expectShape('list 仍含 g-srv（全局只读）', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.some((s) => s.id === 'g-srv'))

    // ============================================
    // E) update 全局 server 字段（应写入用户 override）
    // ============================================
    console.log('\n【E. update 全局 server 写入用户 override】')
    // 重新写全局 yaml 含 g-srv2
    const globalYaml2 = `
servers:
  - id: g-srv2
    name: 全局2
    enabled: true
    transport: stdio
    command: node
    args: ['-e', '0']
`
    writeFileSync(resolve(ROOT, 'config/mcp.yaml'), globalYaml2)
    sidecar.shutdown()
    await new Promise((r) => setTimeout(r, 1500))
    sidecar = startSidecar()
    await sidecar.ready
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    // update g-srv2 改名
    await expectShape('update 全局 g-srv2 改名', () => sidecar.invoke('mcp:update', ['g-srv2', { name: '改名全局2' }]), (r) => r?.success === true)
    // list 应显示改名后
    await expectShape('list 显示 g-srv2 改名后', () => sidecar.invoke('mcp:list'), (r) => r?.servers.find((s) => s.id === 'g-srv2' && s.name === '改名全局2'))

    // ============================================
    // F) 跨重启一致性（全局 + 用户 override 都恢复）
    // ============================================
    console.log('\n【F. 跨重启一致性】')
    sidecar.shutdown()
    await new Promise((r) => setTimeout(r, 1500))
    sidecar = startSidecar()
    await sidecar.ready
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    await expectShape('重启后 g-srv2 改名仍生效', () => sidecar.invoke('mcp:list'), (r) => r?.servers.find((s) => s.id === 'g-srv2' && s.name === '改名全局2'))

    // 清理：还原 config/mcp.yaml 到安全默认
    writeFileSync(resolve(ROOT, 'config/mcp.yaml'), '# MCP Server 全局配置（安全默认：空）\nservers: []\n')
    await sidecar.invoke('settings:set', ['mcp.enabled', false])

    console.log(`\n${'─'.repeat(75)}`)
    console.log(`  结果: ${pass} 通过 / ${fail} 失败`)
    if (failures.length) { console.log('  失败:'); for (const f of failures) console.log(`    - ${f.label}: ${f.msg}`) }
    console.log(`${'─'.repeat(75)}\n`)
  } catch (e) {
    console.error('TEST ERROR:', e)
    // 兜底清理
    try { writeFileSync(resolve(ROOT, 'config/mcp.yaml'), '# MCP Server 全局配置（安全默认：空）\nservers: []\n') } catch {}
  } finally {
    sidecar.shutdown()
    setTimeout(() => { try { rmSync(DATA_DIR, { recursive: true, force: true }) } catch {} }, 1500)
  }
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(2) })
