// 角度2：渲染角度循环测试
// 派生子代理（弱模型）视角：模拟渲染层 PluginsTab 组件的渲染契约
// 验证：① i18n 文案键全存在（zh+en 对齐）② PluginsTab 依赖的 ipc-client API 形状 ③ Tab 切换 localStorage 契约 ④ 跨 Tab 状态一致性
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-render-${Date.now().toString().slice(-6)}`)
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
  console.log(`\n${'='.repeat(75)}\n  角度2：渲染角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)
  const sidecar = startSidecar()
  try {
    await sidecar.ready
    console.log(`✅ Sidecar 就绪\n`)

    // ============================================
    // A) i18n 文案键完整性（zh+en 对齐）
    // ============================================
    console.log('【A. i18n 文案键完整性】')
    const zh = JSON.parse(readFileSync(resolve(ROOT, 'src/renderer/i18n/zh.json'), 'utf-8'))
    const en = JSON.parse(readFileSync(resolve(ROOT, 'src/renderer/i18n/en.json'), 'utf-8'))
    const pluginsKeys = Object.keys(zh).filter((k) => k.startsWith('page.skills.plugins.'))
    await check(`zh 含 plugins 文案键（${pluginsKeys.length}个）`, () => {
      if (pluginsKeys.length < 30) throw new Error(`pluginsKeys only ${pluginsKeys.length}, expected ≥30`)
    })
    await check('en 与 zh plugins 键对齐', () => {
      const missing = pluginsKeys.filter((k) => !(k in en))
      if (missing.length > 0) throw new Error(`en missing: ${missing.slice(0, 5).join(',')}`)
    })
    // 关键键必存在
    const must = [
      'page.skills.plugins.title', 'page.skills.plugins.subtitle',
      'page.skills.plugins.section.active', 'page.skills.plugins.section.future',
      'page.skills.plugins.card.mcp', 'page.skills.plugins.card.mcp.count',
      'page.skills.plugins.card.skills.count', 'page.skills.plugins.card.cron.count',
      'page.skills.plugins.card.feishu.count', 'page.skills.plugins.card.localModels.count',
      'page.skills.plugins.future.agentCapabilities', 'page.skills.plugins.future.skillMcp',
      'page.skills.plugins.future.pluginRegistry', 'page.skills.plugins.empty.title',
    ]
    await check('关键文案键 zh+en 均存在', () => {
      const missZh = must.filter((k) => !(k in zh))
      const missEn = must.filter((k) => !(k in en))
      if (missZh.length || missEn.length) throw new Error(`miss zh:${missZh} en:${missEn}`)
    })
    // 占位符 {count}/{active}/{enabled}/{status}/{running} 必须在对应文案里
    await check('占位符 {count} 在 card.mcp.count', () => {
      if (!zh['page.skills.plugins.card.mcp.count'].includes('{count}')) throw new Error('zh miss {count}')
      if (!en['page.skills.plugins.card.mcp.count'].includes('{count}')) throw new Error('en miss {count}')
    })

    // ============================================
    // B) PluginsTab 依赖的 ipc-client API 形状（渲染层 getAPI()）
    // ============================================
    console.log('\n【B. ipc-client API 形状（PluginsTab 依赖）】')
    // settings.get 返回 mcp.enabled
    await expectShape('settings:get 返回 mcp.enabled', () => sidecar.invoke('settings:get'), (r) => r && typeof r.mcp?.enabled === 'boolean')
    // mcp.list 返回 success + servers[]
    await expectShape('mcp:list → success + servers[]', () => sidecar.invoke('mcp:list'), (r) => r && typeof r.success === 'boolean' && Array.isArray(r.servers))
    // skill.list 返回数组
    await expectShape('skill:list → array（PluginsTab 依赖）', () => sidecar.invoke('skill:list'), (r) => Array.isArray(r))
    // cron.list 返回数组
    await expectShape('cron:list → array（PluginsTab 依赖）', () => sidecar.invoke('cron:list'), (r) => Array.isArray(r))
    // feishu.botStatus 返回 status 字段
    await expectShape('feishu:bot:status → 含 status（PluginsTab 依赖）', () => sidecar.invoke('feishu:bot:status'), (r) => r && typeof r.status === 'string')
    // ollama.detect 返回 serveRunning 字段
    await expectShape('ollama:detect → 含 serveRunning（PluginsTab 依赖）', () => sidecar.invoke('ollama:detect'), (r) => r && typeof r.serveRunning === 'boolean')
    // ollama.listModels 返回数组（PluginsTab 依赖）
    await expectShape('ollama:list-models → array', () => sidecar.invoke('ollama:list-models'), (r) => Array.isArray(r))

    // ============================================
    // C) Tab 切换 localStorage 契约（SkillsPage 用 'skills.activeTab' 键）
    // ============================================
    console.log('\n【C. Tab 切换 localStorage 契约】')
    await check('SkillsPage 用 skills.activeTab 键', () => {
      const src = readFileSync(resolve(ROOT, 'src/renderer/pages/Skills/SkillsPage.tsx'), 'utf-8')
      if (!src.includes("'skills.activeTab'")) throw new Error('SkillsPage 未用 skills.activeTab 键')
      // tab 类型必须是 'skills' | 'mcp' | 'plugins'
      if (!src.includes("'skills' | 'mcp' | 'plugins'")) throw new Error('TabKey 类型不对')
    })
    await check('PluginsTab 跳转写 skills.activeTab=mcp（路由 hash）', () => {
      const src = readFileSync(resolve(ROOT, 'src/renderer/pages/Skills/tabs/PluginsTab.tsx'), 'utf-8')
      // PluginCard 应支持 tabKey + tabValue props
      if (!src.includes('tabKey') || !src.includes('tabValue')) throw new Error('PluginCard 缺 tabKey/tabValue props')
      // MCP 卡应传 tabValue="mcp"
      if (!src.includes('tabValue="mcp"')) throw new Error('MCP 卡未传 tabValue=mcp')
      // 技能卡应传 tabValue="skills"
      if (!src.includes('tabValue="skills"')) throw new Error('技能卡未传 tabValue=skills')
    })

    // ============================================
    // D) 跨 Tab 状态一致性：MCP flag 切换影响 PluginsTab 概览
    // ============================================
    console.log('\n【D. 跨 Tab 状态一致性】')
    // flag off 时 PluginsTab 应显示 mcp disabled 文案
    await sidecar.invoke('settings:set', ['mcp.enabled', false])
    await expectShape('flag off 时 settings.mcp.enabled=false', () => sidecar.invoke('settings:get'), (r) => r?.mcp?.enabled === false)
    // flag on 时 PluginsTab 应显示 mcp enabled
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    await expectShape('flag on 时 settings.mcp.enabled=true', () => sidecar.invoke('settings:get'), (r) => r?.mcp?.enabled === true)
    // MCP add 后 PluginsTab 概览数应+1
    const before = await sidecar.invoke('mcp:list')
    await sidecar.invoke('mcp:add', [{ id: 'rt-consistency', name: 'R', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }])
    await expectShape('add 后 mcp:list 长度 +1', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.length === before.servers.length + 1)
    // remove 后回 -1
    await sidecar.invoke('mcp:remove', ['rt-consistency'])
    await expectShape('remove 后 mcp:list 长度复原', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.length === before.servers.length)
    // 关 flag 复原
    await sidecar.invoke('settings:set', ['mcp.enabled', false])

    // ============================================
    // E) 渲染角度：PluginsTab 组件本身源码契约
    // ============================================
    console.log('\n【E. PluginsTab 组件源码契约】')
    await check('PluginsTab 含 Promise.allSettled 并行拉取', () => {
      const src = readFileSync(resolve(ROOT, 'src/renderer/pages/Skills/tabs/PluginsTab.tsx'), 'utf-8')
      if (!src.includes('Promise.allSettled')) throw new Error('缺 Promise.allSettled 并行')
    })
    await check('PluginsTab 含 FutureCard 占位区', () => {
      const src = readFileSync(resolve(ROOT, 'src/renderer/pages/Skills/tabs/PluginsTab.tsx'), 'utf-8')
      if (!src.includes('FutureCard')) throw new Error('缺 FutureCard')
    })
    await check('PluginsTab 全空态 EmptyState 引导', () => {
      const src = readFileSync(resolve(ROOT, 'src/renderer/pages/Skills/tabs/PluginsTab.tsx'), 'utf-8')
      if (!src.includes('allEmpty')) throw new Error('缺 allEmpty 判定')
      if (!src.includes('EmptyState')) throw new Error('缺 EmptyState 引导')
    })

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
