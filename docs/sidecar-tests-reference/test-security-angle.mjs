// 角度5：安全角度循环测试
// 派生子代理（弱模型）视角：MCP 工具调用路径的安全屏障
// 验证：① serverId 格式校验拒非法字符 ② MCP add 拒非法 transport ③ null byte 拒入 ④ 超长字段拒入
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-security-${Date.now().toString().slice(-6)}`)
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
  console.log(`\n${'='.repeat(75)}\n  角度5：安全角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)
  const sidecar = startSidecar()
  try {
    await sidecar.ready
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    console.log(`✅ Sidecar 就绪\n`)

    // ============================================
    // A) serverId 格式校验（只允许字母数字下划线连字符）
    // ============================================
    console.log('【A. serverId 格式校验】')
    const badIds = ['../../../etc', 'a b c', 'a;b', 'a|b', 'a&b', 'a$b', 'a`b', 'a(b)', 'a{b}', 'a\\b', 'a<b', 'a>b', 'a*b', 'a?b', 'a[b]', 'a#b', 'a~b', 'a!b', 'a/b', 'a.b', 'a,b', 'a@b']
    for (const id of badIds) {
      await expectShape(`mcp:remove 拒 "${id.slice(0, 20)}"`, () => sidecar.invoke('mcp:remove', [id]), (r) => r?.success === false)
    }
    // 长度上限 128
    await expectShape('mcp:remove 拒超长 id(129)', () => sidecar.invoke('mcp:remove', ['a'.repeat(129)]), (r) => r?.success === false)
    // 空 id
    await expectShape('mcp:remove 拒空 id', () => sidecar.invoke('mcp:remove', ['']), (r) => r?.success === false)
    // null id
    await expectShape('mcp:remove 拒 null id', () => sidecar.invoke('mcp:remove', [null]), (r) => r?.success === false)
    // 合法 id 应通过（先 add 再 remove）
    await expectShape('mcp:add 合法 id 通过', () => sidecar.invoke('mcp:add', [{ id: 'legal-id_1', name: 'L', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }]), (r) => r?.success === true)
    await expectShape('mcp:remove 合法 id 通过', () => sidecar.invoke('mcp:remove', ['legal-id_1']), (r) => r?.success === true)

    // ============================================
    // B) MCP add 拒非法 transport
    // ============================================
    console.log('\n【B. 拒非法 transport】')
    await expectShape('mcp:add 拒 transport=ftp', () => sidecar.invoke('mcp:add', [{ id: 'bad-tr', name: 'B', enabled: true, transport: 'ftp', command: 'x' }]), (r) => r?.success === false)
    await expectShape('mcp:add 拒 transport=空', () => sidecar.invoke('mcp:add', [{ id: 'bad-tr2', name: 'B', enabled: true, transport: '', command: 'x' }]), (r) => r?.success === false)
    await expectShape('mcp:add 拒 transport=null', () => sidecar.invoke('mcp:add', [{ id: 'bad-tr3', name: 'B', enabled: true, transport: null, command: 'x' }]), (r) => r?.success === false)

    // ============================================
    // C) stdio 必填 command；sse/websocket 必填 url
    // ============================================
    console.log('\n【C. 必填字段校验】')
    await expectShape('stdio 缺 command 拒', () => sidecar.invoke('mcp:add', [{ id: 'no-cmd', name: 'N', enabled: true, transport: 'stdio' }]), (r) => r?.success === false)
    await expectShape('sse 缺 url 拒', () => sidecar.invoke('mcp:add', [{ id: 'no-url', name: 'N', enabled: true, transport: 'sse' }]), (r) => r?.success === false)
    await expectShape('websocket 缺 url 拒', () => sidecar.invoke('mcp:add', [{ id: 'no-url2', name: 'N', enabled: true, transport: 'websocket' }]), (r) => r?.success === false)

    // ============================================
    // D) null byte 拒入（command / args / env）
    // ============================================
    console.log('\n【D. null byte 拒入】')
    await expectShape('command 含 null byte 拒', () => sidecar.invoke('mcp:add', [{ id: 'null-c', name: 'N', enabled: true, transport: 'stdio', command: 'a\0b', args: [] }]), (r) => r?.success === false)
    await expectShape('args 含 null byte 拒', () => sidecar.invoke('mcp:add', [{ id: 'null-a', name: 'N', enabled: true, transport: 'stdio', command: 'node', args: ['a\0b'] }]), (r) => r?.success === false)
    await expectShape('url 含 null byte 拒', () => sidecar.invoke('mcp:add', [{ id: 'null-u', name: 'N', enabled: true, transport: 'sse', url: 'http://a\0b' }]), (r) => r?.success === false)

    // ============================================
    // E) URL 格式校验（sse/websocket 必须http(s)://）
    // ============================================
    console.log('\n【E. URL 格式校验】')
    await expectShape('sse 拒非 http url', () => sidecar.invoke('mcp:add', [{ id: 'bad-url', name: 'N', enabled: true, transport: 'sse', url: 'ftp://x' }]), (r) => r?.success === false)
    await expectShape('sse 拒 javascript: url', () => sidecar.invoke('mcp:add', [{ id: 'bad-url2', name: 'N', enabled: true, transport: 'sse', url: 'javascript:alert(1)' }]), (r) => r?.success === false)

    // ============================================
    // F) 技能名安全校验（复用 isValidSkillName）
    // ============================================
    console.log('\n【F. 技能名安全校验】')
    await expectShape('skill:save 拒含路径技能名', () => sidecar.invoke('skill:save', ['../evil', 'x']), (r) => r?.success === false)
    await expectShape('skill:save 拒含空字节内容', () => sidecar.invoke('skill:save', ['ok-name', 'a\0b']), (r) => r?.success === false)
    await expectShape('skill:save 拒超 1MB 内容', () => sidecar.invoke('skill:save', ['big', 'a'.repeat(1024 * 1024 + 1)]), (r) => r?.success === false)

    // ============================================
    // G) settings.set 路径安全
    // ============================================
    console.log('\n【G. settings 路径校验】')
    await expectShape('settings:set 拒未知 dotPath', () => sidecar.invoke('settings:set', ['non.exist.key', true]), (r) => r?.success === false)
    await expectShape('settings:set mcp.enabled 合法', () => sidecar.invoke('settings:set', ['mcp.enabled', false]), (r) => r?.success === true)

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
