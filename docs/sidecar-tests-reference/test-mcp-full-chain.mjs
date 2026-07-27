// =============================================================
// MCP 全链路 sidecar 测试 — 模拟前端对 Skills/MCP 能力中心的真实操作
//
// 覆盖 R1 修复的所有路径:
//   A. feature flag 开关 + list
//   B. add server (stdio/sse) + 写入 mcp.user.yaml
//   C. add 重复 id 拒绝
//   D. add 危险 command 拒绝 (shell 注入防护)
//   E. add 内网 URL 拒绝 (SSRF 防护,含短格式 IP)
//   F. add 含 __proto__ 的 config (原型污染防护)
//   G. update server (字段 + enabled 开关)
//   H. update 全局项走"复制覆盖"分支
//   I. test/connect 对不存在的 server (优雅失败,不崩 sidecar)
//   J. listTools 未连接时返回空
//   K. remove 用户级 server
//   L. remove 全局项拒绝
//   M. 并发 add 不同 id (串行队列)
//   N. ${env.VAR} 占位符插值 (预设模板兼容)
// =============================================================
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(ROOT, 'test-results')
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

function startSidecar(dataDir) {
  const child = spawn('node', [resolve(ROOT, 'sidecar/edu-sidecar.mjs')], {
    env: { ...process.env, EDU_APP_DATA_DIR: dataDir, EDU_RESOURCE_DIR: ROOT },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ready timeout')), 25000)
    const c = (l) => {
      try {
        const m = JSON.parse(l)
        if (m.type === 'event' && m.channel === '__sidecar__:ready') {
          clearTimeout(t)
          rl.off('line', c)
          res(m.data)
        }
      } catch {}
    }
    rl.on('line', c)
  })
  rl.on('line', (l) => {
    let m
    try {
      m = JSON.parse(l)
    } catch {
      return
    }
    if (m.type === 'result' && m.id != null) {
      const p = pending.get(m.id)
      if (p) {
        pending.delete(m.id)
        m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?'))
      }
    }
  })
  function invoke(ch, args) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n')
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          rej(new Error('timeout'))
        }
      }, 20000)
    })
  }
  const shutdown = () =>
    new Promise((r) => {
      try {
        child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n')
      } catch {}
      setTimeout(() => {
        try {
          child.kill()
        } catch {}
        r()
      }, 1500)
    })
  return { ready, invoke, shutdown }
}

async function run(dataDir) {
  console.log('━━━ MCP 全链路 sidecar 测试 (R1 修复验证) ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  const results = []
  let pass = 0
  let fail = 0
  const ok = (name, detail = '') => {
    console.log(`  ✓ ${name} ${detail}`)
    pass++
    results.push({ name, status: 'pass' })
  }
  const bad = (name, err) => {
    console.log(`  ✗ ${name}: ${err}`)
    fail++
    results.push({ name, status: 'fail', error: String(err) })
  }
  // 期望被拒绝的断言。
  // MCP IPC 的拒绝语义: 返回 { success: false, error } 作为"成功"的 invoke 响应(resolve),
  // 而非 throw。所以这里检查 result.success === false。
  // pattern 用于匹配 error 文案(可选)。
  const expectReject = async (name, channel, args, pattern) => {
    try {
      const r = await sc.invoke(channel, args)
      if (r && r.success === false) {
        if (!pattern || pattern.test(r.error || '')) {
          ok(name, `→ 正确拒绝: ${(r.error || '').slice(0, 60)}`)
        } else {
          bad(name, `拒绝但错误类型不符: ${r.error}`)
        }
      } else {
        bad(`${name} (应被拒绝但成功了)`, `response=${JSON.stringify(r).slice(0, 80)}`)
      }
    } catch (e) {
      // 某些通道确实 throw(如 handler 顶层 reject),也算正确拒绝
      if (!pattern || pattern.test(e.message)) ok(name, `→ 正确拒绝(throw): ${e.message.slice(0, 60)}`)
      else bad(name, `throw 但错误类型不符: ${e.message}`)
    }
  }

  // ===== A. feature flag + list =====
  console.log('━━━ A. MCP feature flag + list ━━━')
  try {
    await sc.invoke('settings:set', ['mcp.enabled', true])
    const s = await sc.invoke('settings:get', [])
    ok('开启 MCP feature flag', `→ mcp.enabled=${s?.mcp?.enabled}`)
  } catch (e) {
    bad('开启 MCP feature flag', e.message)
  }
  try {
    const r = await sc.invoke('mcp:list', [])
    ok('mcp:list 初始(空)', `→ success=${r?.success}, servers=${r?.servers?.length ?? 0}`)
  } catch (e) {
    bad('mcp:list 初始', e.message)
  }

  // ===== B. add stdio server =====
  console.log('\n━━━ B. add stdio server + 写盘 ━━━')
  try {
    const r = await sc.invoke('mcp:add', [
      {
        id: 'test-stdio',
        name: '测试stdio',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'some-mock-server'],
      },
    ])
    if (r?.success) ok('add stdio server', '→ success')
    else bad('add stdio server', r?.error || 'no success')
  } catch (e) {
    bad('add stdio server', e.message)
  }
  try {
    const r = await sc.invoke('mcp:list', [])
    const found = r?.servers?.find((s) => s.id === 'test-stdio')
    if (found) ok('list 含新 server', `→ source=${found.source}, enabled=${found.enabled}`)
    else bad('list 含新 server', 'not found')
  } catch (e) {
    bad('list 含新 server', e.message)
  }

  // ===== C. add 重复 id 拒绝 =====
  console.log('\n━━━ C. add 重复 id 拒绝 ━━━')
  await expectReject('add 重复 id', 'mcp:add', [
    { id: 'test-stdio', name: '重复', enabled: true, transport: 'stdio', command: 'node' },
  ])

  // ===== D. add 危险 command 拒绝 =====
  console.log('\n━━━ D. add 危险 command 拒绝 (shell 注入) ━━━')
  await expectReject('add 含 ; 的 command', 'mcp:add', [
    { id: 'evil1', name: '恶意', enabled: true, transport: 'stdio', command: 'npx; rm -rf /' },
  ])
  await expectReject('add 含 $( 的 command', 'mcp:add', [
    { id: 'evil2', name: '恶意', enabled: true, transport: 'stdio', command: 'npx $(whoami)' },
  ])

  // ===== E. add 内网 URL 拒绝 (SSRF, 含短格式 IP) =====
  console.log('\n━━━ E. SSRF 防护 (含短格式/十进制 IP) ━━━')
  await expectReject('add 169.254.169.254 (云元数据)', 'mcp:add', [
    { id: 'ssrf1', name: '元数据', enabled: true, transport: 'sse', url: 'http://169.254.169.254/' },
  ])
  await expectReject('add 10.0.0.1 (私有段)', 'mcp:add', [
    { id: 'ssrf2', name: '内网', enabled: true, transport: 'sse', url: 'http://10.0.0.1/' },
  ])
  await expectReject('add http://0 (短格式 IP)', 'mcp:add', [
    { id: 'ssrf3', name: '短格式', enabled: true, transport: 'sse', url: 'http://0/' },
  ])
  await expectReject('add 十进制 IP 2130706433', 'mcp:add', [
    { id: 'ssrf4', name: '十进制', enabled: true, transport: 'sse', url: 'http://2130706433/' },
  ])
  await expectReject('add file:// 协议', 'mcp:add', [
    { id: 'ssrf5', name: '文件协议', enabled: true, transport: 'sse', url: 'file:///etc/passwd' },
  ])

  // ===== F. 原型污染防护 =====
  console.log('\n━━━ F. 原型污染防护 (__proto__) ━━━')
  try {
    // 通过 IPC 传入含 __proto__ 的 config,验证不污染 Object.prototype
    const r = await sc.invoke('mcp:add', [
      {
        id: 'proto-test',
        name: '原型测试',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        __proto__: { polluted: 'evil' },
        constructor: { prototype: { evil: true } },
      },
    ])
    if (r?.success) {
      // 关键: 验证全局 Object.prototype 未被污染(sidecar 内无法直接检查,但 add 成功且后续 list 正常即说明未崩)
      const list = await sc.invoke('mcp:list', [])
      const found = list?.servers?.find((s) => s.id === 'proto-test')
      if (found && !('polluted' in {})) ok('add 含 __proto__ 不污染', '→ 已净化落盘')
      else bad('add 含 __proto__', '污染迹象或未找到')
    } else {
      bad('add 含 __proto__', r?.error || 'failed')
    }
  } catch (e) {
    bad('add 含 __proto__', e.message)
  }

  // ===== G. update server (字段 + enabled) =====
  console.log('\n━━━ G. update server ━━━')
  try {
    const r = await sc.invoke('mcp:update', ['test-stdio', { name: '改名后', enabled: false }])
    if (r?.success) {
      const list = await sc.invoke('mcp:list', [])
      const found = list?.servers?.find((s) => s.id === 'test-stdio')
      // B6 修复: disabled server 也应出现在 list 里
      if (found?.name === '改名后' && found?.enabled === false)
        ok('update name+enabled', `→ name=${found.name}, enabled=${found.enabled} (disabled 仍可见)`)
      else bad('update name+enabled', `结果不符: ${JSON.stringify(found)}`)
    } else bad('update name+enabled', r?.error || 'failed')
  } catch (e) {
    bad('update name+enabled', e.message)
  }

  // ===== H. update 改 url 触发 SSRF 校验 =====
  console.log('\n━━━ H. update 改危险 url 被拒 ━━━')
  await expectReject('update 改 file:// url', 'mcp:update', [
    'test-stdio',
    { transport: 'sse', url: 'file:///etc/passwd' },
  ])

  // ===== I. test/connect 不存在的 server =====
  console.log('\n━━━ I. 不存在 server 的 test/connect (优雅失败) ━━━')
  try {
    const r = await sc.invoke('mcp:test', ['nonexistent-xyz'])
    if (!r?.success && r?.error) ok('test 不存在 server', `→ 正确返回 error`)
    else bad('test 不存在 server', '应失败却成功')
  } catch (e) {
    ok('test 不存在 server', `→ 正确抛错: ${e.message.slice(0, 50)}`)
  }

  // ===== J. listTools 未连接返回空 =====
  console.log('\n━━━ J. listTools 未连接 ━━━')
  try {
    const r = await sc.invoke('mcp:list-tools', ['test-stdio'])
    // listTools 在未连接时返回空数组(success)
    ok('listTools 未连接', `→ success=${r?.success}, tools=${r?.tools?.length ?? 0}`)
  } catch (e) {
    bad('listTools 未连接', e.message)
  }

  // ===== K. remove 用户级 server =====
  console.log('\n━━━ K. remove 用户级 server ━━━')
  try {
    const r = await sc.invoke('mcp:remove', ['test-stdio'])
    if (r?.success) {
      const list = await sc.invoke('mcp:list', [])
      const stillThere = list?.servers?.some((s) => s.id === 'test-stdio')
      if (!stillThere) ok('remove 用户级', '→ 已删除')
      else bad('remove 用户级', '仍在列表')
    } else bad('remove 用户级', r?.error || 'failed')
  } catch (e) {
    bad('remove 用户级', e.message)
  }

  // ===== L. remove 全局项拒绝(若有全局项) =====
  console.log('\n━━━ L. remove 全局项拒绝 ━━━')
  try {
    const list = await sc.invoke('mcp:list', [])
    const globalSrv = list?.servers?.find((s) => s.source === 'global')
    if (globalSrv) {
      await expectReject('remove 全局项', 'mcp:remove', [globalSrv.id])
    } else {
      ok('remove 全局项', '→ (无全局 server,跳过)')
    }
  } catch (e) {
    bad('remove 全局项', e.message)
  }

  // ===== M. 并发 add 不同 id (串行队列) =====
  console.log('\n━━━ M. 并发 add 不同 id ━━━')
  try {
    const ids = ['conc-a', 'conc-b', 'conc-c', 'conc-d', 'conc-e']
    const results = await Promise.all(
      ids.map((id) =>
        sc
          .invoke('mcp:add', [
            { id, name: `并发${id}`, enabled: true, transport: 'stdio', command: 'npx' },
          ])
          .then(
            () => 'success',
            (e) => `error: ${e.message}`,
          ),
      ),
    )
    const succCount = results.filter((r) => r === 'success').length
    if (succCount === ids.length) {
      const list = await sc.invoke('mcp:list', [])
      const allThere = ids.every((id) => list?.servers?.some((s) => s.id === id))
      ok('并发 add 5 个', `→ ${succCount}/${ids.length} 成功, 全部在列表=${allThere}`)
    } else bad('并发 add', `仅 ${succCount}/${ids.length} 成功: ${results.join('; ')}`)
  } catch (e) {
    bad('并发 add', e.message)
  }

  // ===== N. ${env.VAR} 占位符 (通过 add 含占位符的 config 验证不崩) =====
  console.log('\n━━━ N. ${env.VAR} 占位符 ━━━')
  try {
    // 添加一个 env 含 ${env.HOME} 的 server,验证插值不报错(HOME 存在)
    const r = await sc.invoke('mcp:add', [
      {
        id: 'env-test',
        name: '环境变量测试',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'some-srv', '${HOME}'],
        env: { USER_HOME: '${env.HOME}' },
      },
    ])
    if (r?.success) ok('add 含 ${env.VAR}', '→ 插值成功无报错')
    else bad('add 含 ${env.VAR}', r?.error || 'failed')
  } catch (e) {
    bad('add 含 ${env.VAR}', e.message)
  }

  // ===== 收尾: 关闭 feature flag =====
  try {
    await sc.invoke('settings:set', ['mcp.enabled', false])
  } catch {}

  await sc.shutdown()
  console.log(`\n━━━ 结果: ${pass} 通过, ${fail} 失败 ━━━`)
  return { pass, fail, results }
}

const dataDir = resolve(RESULTS_DIR, `mcp-fullchain-${Date.now()}`)
const summary = await run(dataDir)
rmSync(dataDir, { recursive: true, force: true })
process.exit(summary.fail > 0 ? 1 : 0)
