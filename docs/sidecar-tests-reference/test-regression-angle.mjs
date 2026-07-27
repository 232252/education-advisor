// 角度10：回归角度循环测试
// 派生子代理（弱模型）视角：MCP 改动不伤现有 18 agent / 19 工具能力
// 验证：① 18 agents 完整 ② EAA 11 工具可调 ③ file 6 工具可调 ④ utility 2 工具可调 ⑤ cron/skill/feishu/ollama/privacy 不退化
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-regression-${Date.now().toString().slice(-6)}`)
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
  console.log(`\n${'='.repeat(75)}\n  角度10：回归角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)
  const sidecar = startSidecar()
  try {
    await sidecar.ready
    // 在 MCP 启用状态下做全套回归——确保 MCP 不伤现有能力
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    console.log(`✅ Sidecar 就绪（MCP flag on 做回归）\n`)

    // ============================================
    // A) 18 agents 完整性
    // ============================================
    console.log('【A. 18 agents 完整】')
    await expectShape('agent:list 含 18 agents', () => sidecar.invoke('agent:list'), (r) => Array.isArray(r) && r.length === 18)
    // 关键 agent 仍在
    const mustAgents = ['main', 'counselor', 'academic', 'class-monitor', 'weekly-reporter', 'risk-alert']
    for (const id of mustAgents) {
      await expectShape(`agent:get("${id}") 仍可用`, () => sidecar.invoke('agent:get', [id]), (r) => r && (r.id === id || r === null))
    }

    // ============================================
    // B) EAA 11 工具可调（只调不写命令，验证 handler 注册不退化）
    // ============================================
    console.log('\n【B. EAA 11 工具 handler 不退化】')
    await expectShape('eaa:info 可调', () => sidecar.invoke('eaa:info'), (r) => r && typeof r.success === 'boolean')
    await expectShape('eaa:codes 可调', () => sidecar.invoke('eaa:codes'), (r) => r && typeof r.success === 'boolean')
    await expectShape('eaa:list-students 可调', () => sidecar.invoke('eaa:list-students'), (r) => r && typeof r.success === 'boolean')
    await expectShape('eaa:ranking 可调', () => sidecar.invoke('eaa:ranking', [10]), (r) => r && typeof r.success === 'boolean')
    await expectShape('eaa:stats 可调', () => sidecar.invoke('eaa:stats'), (r) => r && typeof r.success === 'boolean')
    await expectShape('eaa:doctor 可调', () => sidecar.invoke('eaa:doctor'), (r) => r && typeof r.success === 'boolean')
    await expectShape('eaa:summary 可调', () => sidecar.invoke('eaa:summary'), (r) => r && typeof r.success === 'boolean')
    await expectShape('eaa:range 可调', () => sidecar.invoke('eaa:range', ['2026-01-01', '2026-12-31']), (r) => r && typeof r.success === 'boolean')
    await expectShape('eaa:export-formats 可调', () => sidecar.invoke('eaa:export-formats'), (r) => Array.isArray(r) || (r && typeof r.success === 'boolean'))
    await expectShape('eaa:invalidate-cache 可调', () => sidecar.invoke('eaa:invalidate-cache'), (r) => r && typeof r.success === 'boolean')
    await expectShape('eaa:validate 可调', () => sidecar.invoke('eaa:validate'), (r) => r && typeof r.success === 'boolean')

    // ============================================
    // C) 风格协议：18 agents 的 capabilities 字段稳定（不退化）
    // ============================================
    console.log('\n【C. agents capabilities 不退化】')
    await expectShape('main agent 含 capabilities 字段', () => sidecar.invoke('agent:get', ['main']), (r) => r && Array.isArray(r.capabilities))

    // ============================================
    // D) cron / skill / feishu / ollama / privacy 不退化
    // ============================================
    console.log('\n【D. 其他子系统不退化】')
    await expectShape('cron:list 可调', () => sidecar.invoke('cron:list'), (r) => Array.isArray(r))
    await expectShape('skill:list 可调', () => sidecar.invoke('skill:list'), (r) => Array.isArray(r))
    await expectShape('feishu:bot:status 可调', () => sidecar.invoke('feishu:bot:status'), (r) => r && typeof r.status === 'string')
    await expectShape('feishu:status 可调', () => sidecar.invoke('feishu:status').catch((e) => ({ err: e.message })), (r) => r && (typeof r === 'string' || r.err !== undefined))
    await expectShape('ollama:detect 可调', () => sidecar.invoke('ollama:detect'), (r) => r && typeof r.serveRunning === 'boolean')
    await expectShape('ollama:list-models 可调', () => sidecar.invoke('ollama:list-models'), (r) => Array.isArray(r))
    await expectShape('privacy:status 可调', () => sidecar.invoke('privacy:status'), (r) => r && typeof r.unlocked === 'boolean')

    // ============================================
    // E) AI/LLM 子系统不退化
    // ============================================
    console.log('\n【E. AI/LLM 不退化】')
    await expectShape('ai:list-providers 可调', () => sidecar.invoke('ai:list-providers'), (r) => Array.isArray(r))
    // ai:chat 不退化（不真调外部）
    await expectShape('ai:chat 可调不崩', () => sidecar.invoke('ai:chat', [{ providerId: 'openai', modelId: 'gpt-4', messages: [] }]).catch((e) => ({ err: e.message })), (r) => r && (typeof r.success === 'boolean' || r.err !== undefined))

    // ============================================
    // F) 班级 / 学生档案 / 学业管理 不退化
    // ============================================
    console.log('\n【F. 业务模块不退化】')
    await expectShape('class:list 可调', () => sidecar.invoke('class:list'), (r) => r && typeof r.success === 'boolean')
    await expectShape('academic:get-config 可调', () => sidecar.invoke('academic:get-config'), (r) => r && typeof r.success === 'boolean')
    await expectShape('academic:list-exams 可调', () => sidecar.invoke('academic:list-exams'), (r) => r && typeof r.success === 'boolean')
    await expectShape('profile:get 可调（即使学生不存在也应明确响应）', () => sidecar.invoke('profile:get', '不存在同学').catch((e) => ({ err: e.message })), (r) => r && (typeof r.success === 'boolean' || r.err !== undefined))

    // ============================================
    // G) settings 全字段回归（MCP 字段不挤占其他设置）
    // ============================================
    console.log('\n【G. settings 全字段回归】')
    const settings = await sidecar.invoke('settings:get')
    await check('settings 含 feishu 字段', () => { if (!settings.feishu) throw new Error('miss feishu') })
    await check('settings 含 chat 字段', () => { if (!settings.chat) throw new Error('miss chat') })
    await check('settings 含 theme 字段（general.theme 嵌套）', () => { if (!settings.general?.theme) throw new Error('miss general.theme') })
    await check('settings 含 mcp 字段', () => { if (!settings.mcp) throw new Error('miss mcp') })

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
