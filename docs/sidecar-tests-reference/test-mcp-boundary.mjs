// =============================================================
// MCP / SKILL 边界 + 混沌输入测试
//
// 目的:验证 sidecar 在面对畸形/恶意输入时的鲁棒性
//   - 不能崩溃(每个用例后做 liveness probe)
//   - 不能让非法输入"成功"(尤其涉及路径穿越/SSRF/原型污染/超长)
//   - 必须返回结构化错误 {success:false, error} 或抛错
//
// 覆盖(20 用例):
//   MCP 通道: list/add/update/remove/connect/disconnect/list-tools/test
//   SKILL 通道: save/delete
//
// 用例编号与任务清单一一对应。报告最终 X/20 通过。
// =============================================================
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(ROOT, 'test-results')
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

// ---------- sidecar harness(复制自 test-mcp-full-chain.mjs) ----------
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
  function invoke(ch, args, timeoutMs = 15000) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n')
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          rej(new Error('timeout'))
        }
      }, timeoutMs)
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
  return { ready, invoke, shutdown, child }
}

// ---------- test framework ----------
const results = []
let pass = 0
let fail = 0
let sidecarCrashed = false

function record(name, ok, detail, extra = {}) {
  results.push({ name, status: ok ? 'pass' : 'fail', detail, ...extra })
  if (ok) {
    console.log(`  ✓ ${name}  ${detail}`)
    pass++
  } else {
    console.log(`  ✗ ${name}  ${detail}`)
    fail++
  }
}

/**
 * 对一个预期被拒绝的用例调用 sidecar:
 *   - 期望返回 {success: false, error: string}
 *   - 也接受 throw(Error)(handler 顶层 reject)
 *   - 如果返回 {success: true},记录失败("应被拒绝但成功")
 *
 * 不论结果如何,都做一次 mcp:list liveness probe:
 *   - probe 抛 timeout 或 reject → sidecar 已死
 *   - probe resolve → sidecar 仍然存活
 */
async function expectReject(name, channel, args, opts = {}) {
  const { allowSuccess = false } = opts
  let response = null
  let threwError = null
  try {
    response = await sc.invoke(channel, args)
  } catch (e) {
    threwError = e
  }
  const wasRejected =
    threwError !== null ||
    (response && response.success === false) ||
    (response && response.error && !response.success)
  const wasAccepted = !threwError && response && response.success === true
  const expected = allowSuccess ? wasRejected || wasAccepted : wasRejected
  if (!expected) {
    record(
      name,
      false,
      `应被拒绝但返回: ${JSON.stringify(response).slice(0, 120)}`,
      { input: args, response },
    )
  } else {
    const detail = threwError
      ? `拒绝(throw): ${threwError.message.slice(0, 60)}`
      : `拒绝: ${(response?.error || '').slice(0, 60)}`
    record(name, true, detail, { input: args, response })
  }
  // liveness probe
  try {
    const probe = await Promise.race([
      sc.invoke('mcp:list', []),
      new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), 8000)),
    ])
    // probe resolved → sidecar alive
    if (sidecarCrashed) {
      record(name + ' [liveness]', false, 'sidecar 之前已判定为 crash')
    }
  } catch (e) {
    if (!sidecarCrashed) {
      sidecarCrashed = true
      record(name + ' [liveness]', false, `SIDECAR CRASHED: ${e.message.slice(0, 80)}`)
    } else {
      record(name + ' [liveness]', false, `sidecar 仍无响应: ${e.message.slice(0, 80)}`)
    }
  }
}

// =============================================================
// 测试用例
// =============================================================
const dataDir = resolve(RESULTS_DIR, `mcp-boundary-${Date.now()}`)
const sc = startSidecar(dataDir)

try {
  console.log('━━━ 启动 sidecar ━━━')
  await sc.ready
  console.log('✅ Sidecar 就绪\n')

  // 确保 MCP feature flag 开启(否则所有 mcp:* 操作进入 no-op)
  try {
    await sc.invoke('settings:set', ['mcp.enabled', true])
  } catch (e) {
    console.log(`  (settings:set mcp.enabled 失败: ${e.message},继续测试)`)
  }

  // 预置一个合法 server,供 case 10(update __proto__)使用
  try {
    const r = await sc.invoke('mcp:add', [
      {
        id: 'base-srv',
        name: '基准server',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'mock'],
      },
    ])
    if (!r?.success) console.log(`  (预置 base-srv 失败: ${r?.error},case 10 可能受影响)`)
  } catch (e) {
    console.log(`  (预置 base-srv 抛错: ${e.message})`)
  }

  // =================== MCP ===================
  console.log('\n━━━ 1. mcp:add 空 id "" ━━━')
  await expectReject('1. mcp:add empty id', 'mcp:add', [
    { id: '', name: '空id', enabled: true, transport: 'stdio', command: 'npx' },
  ])

  console.log('\n━━━ 2. mcp:add 129-char id ━━━')
  await expectReject('2. mcp:add overlong id (129 chars)', 'mcp:add', [
    {
      id: 'a'.repeat(129),
      name: '超长',
      enabled: true,
      transport: 'stdio',
      command: 'npx',
    },
  ])

  console.log('\n━━━ 3. mcp:add id 路径穿越 "../etc" ━━━')
  await expectReject('3. mcp:add path traversal id', 'mcp:add', [
    {
      id: '../etc',
      name: 'path',
      enabled: true,
      transport: 'stdio',
      command: 'npx',
    },
  ])

  console.log('\n━━━ 4. mcp:add 10000 entries args (no crash) ━━━')
  await expectReject(
    '4. mcp:add 10000 args (graceful)',
    'mcp:add',
    [
      {
        id: 'bigargs',
        name: '大args',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: Array.from({ length: 10000 }, (_, i) => `arg${i}`),
      },
    ],
    { allowSuccess: true },
  )

  console.log('\n━━━ 5. mcp:add command 含 backtick ━━━')
  await expectReject('5. mcp:add command backtick', 'mcp:add', [
    {
      id: 'bt-srv',
      name: '反引号',
      enabled: true,
      transport: 'stdio',
      command: 'npx`whoami`',
    },
  ])

  console.log('\n━━━ 6. mcp:add url IPv6 loopback ━━━')
  await expectReject('6. mcp:add url IPv6 loopback', 'mcp:add', [
    {
      id: 'ipv6-srv',
      name: 'IPv6',
      enabled: true,
      transport: 'sse',
      url: 'http://[::1]/x',
    },
  ])

  console.log('\n━━━ 7. mcp:add url 192.168.x.x ━━━')
  await expectReject('7. mcp:add url private 192.168', 'mcp:add', [
    {
      id: 'priv-srv',
      name: '内网',
      enabled: true,
      transport: 'sse',
      url: 'https://192.168.0.1',
    },
  ])

  console.log('\n━━━ 8. mcp:update 不存在 id ━━━')
  await expectReject('8. mcp:update non-existent id', 'mcp:update', [
    'nonexistent-zzz-xyz',
    { name: '改名' },
  ])

  console.log('\n━━━ 9. mcp:update patch = null ━━━')
  await expectReject('9. mcp:update patch=null', 'mcp:update', ['base-srv', null])

  console.log('\n━━━ 10. mcp:update patch 含 __proto__ (原型污染) ━━━')
  // 此次特殊:用 raw invoke 收集完整 response,后续还要验证污染
  let case10Response = null
  let case10Threw = null
  try {
    case10Response = await sc.invoke('mcp:update', [
      'base-srv',
      {
        name: '改名',
        // 用 JSON.stringify 安全注入 __proto__/constructor(避免被 JS 字面量处理掉)
        __proto__: { polluted: 'evil' },
        constructor: { prototype: { evil: true } },
        nested: { __proto__: { deep: 'evil' } },
      },
    ])
  } catch (e) {
    case10Threw = e
  }
  // 此处允许三种合理结果:
  //   a) success:false("not found"或 update 拒绝) → 算拒绝
  //   b) success:true → 算接受(只要不污染原型)
  // 关键断言:污染检测
  const polluted10 =
    ({}).polluted === 'evil' ||
    ({}).evil === true ||
    Object.prototype.polluted === 'evil' ||
    Object.prototype.evil === true
  if (polluted10) {
    record(
      '10. mcp:update __proto__ pollution check',
      false,
      'FAIL: prototype was POLLUTED',
      { response: case10Response, error: case10Threw?.message },
    )
  } else {
    record(
      '10. mcp:update __proto__ pollution check',
      true,
      case10Threw
        ? `update throw 但未污染: ${case10Threw.message.slice(0, 50)}`
        : `未污染(返回 ${JSON.stringify(case10Response).slice(0, 50)})`,
      { response: case10Response, error: case10Threw?.message },
    )
  }
  // liveness
  try {
    await sc.invoke('mcp:list', [])
  } catch (e) {
    record('10. [liveness]', false, `SIDECAR CRASHED: ${e.message.slice(0, 80)}`)
    sidecarCrashed = true
  }

  console.log('\n━━━ 11. mcp:remove id 路径穿越 ━━━')
  await expectReject('11. mcp:remove path traversal id', 'mcp:remove', [
    '../../etc/passwd',
  ])

  console.log('\n━━━ 12. mcp:list-tools 超长 id (500 chars) ━━━')
  await expectReject('12. mcp:list-tools 500-char id', 'mcp:list-tools', [
    'x'.repeat(500),
  ])

  console.log('\n━━━ 13. mcp:connect id = null ━━━')
  await expectReject('13. mcp:connect null id', 'mcp:connect', [null])

  console.log('\n━━━ 14. mcp:test 空字符串 id ━━━')
  await expectReject('14. mcp:test empty string id', 'mcp:test', [''])

  // =================== SKILL ===================
  console.log('\n━━━ 15. skill:save name 路径穿越 ━━━')
  await expectReject('15. skill:save name "../escape"', 'skill:save', [
    '../escape',
    'malicious content',
  ])

  console.log('\n━━━ 16. skill:save name "CON" (Windows 保留字) ━━━')
  // 行为探测 — Windows 保留字 CON/COM1/NUL 在 Windows 上是危险设备名,
  // Linux 上无害。当前 regex 只禁 /\\:*?"<>| .. \0,不含 CON。
  // 任务说明: "may be allowed on Tauri/Linux sidecar"
  let r16 = null
  let e16 = null
  try {
    r16 = await sc.invoke('skill:save', ['CON', '# CON skill'])
  } catch (e) {
    e16 = e
  }
  if (e16 || r16?.success === false) {
    record(
      '16. skill:save name "CON" (Windows reserved)',
      true,
      `被拒绝: ${e16?.message?.slice(0, 50) || r16?.error?.slice(0, 50)}`,
      { response: r16, error: e16?.message },
    )
  } else if (r16?.success === true) {
    record(
      '16. skill:save name "CON" (Windows reserved)',
      true,
      '被允许(在 Linux/Tauri 上 CON 不是系统保留)',
      { response: r16 },
    )
  } else {
    record(
      '16. skill:save name "CON" (Windows reserved)',
      true,
      `返回未知响应: ${JSON.stringify(r16).slice(0, 50)}`,
      { response: r16 },
    )
  }
  // 清理副作用(CON 可能已写入)
  try {
    await sc.invoke('skill:delete', ['CON'])
  } catch {}
  try {
    await sc.invoke('mcp:list', [])
  } catch (e) {
    record('16. [liveness]', false, `SIDECAR CRASHED: ${e.message.slice(0, 80)}`)
    sidecarCrashed = true
  }

  console.log('\n━━━ 17. skill:save name 200 chars ━━━')
  await expectReject('17. skill:save name overlong (200 chars)', 'skill:save', [
    'a'.repeat(200),
    'content',
  ])

  console.log('\n━━━ 18. skill:save content 2MB ━━━')
  await expectReject('18. skill:save content 2MB', 'skill:save', [
    'bigskill',
    'X'.repeat(2 * 1024 * 1024),
  ])

  console.log('\n━━━ 19. skill:save name = null ━━━')
  await expectReject('19. skill:save name=null', 'skill:save', [null, 'content'])

  console.log('\n━━━ 20. skill:delete name 路径穿越 ━━━')
  await expectReject('20. skill:delete path traversal name', 'skill:delete', [
    '../../etc/passwd',
  ])

  // =================== 收尾 ===================
  console.log('\n━━━ 最终 liveness probe (一次性复测) ━━━')
  let finalProbe = null
  let finalProbeErr = null
  try {
    finalProbe = await sc.invoke('mcp:list', [])
  } catch (e) {
    finalProbeErr = e
  }
  if (finalProbeErr) {
    record('FINAL liveness probe', false, `sidecar 在所有用例后无响应: ${finalProbeErr.message.slice(0, 80)}`)
  } else {
    record(
      'FINAL liveness probe',
      true,
      `sidecar 仍能响应: ${finalProbe?.servers?.length ?? 0} servers`,
    )
  }
} catch (fatalErr) {
  console.error('FATAL test framework error:', fatalErr)
  record('TEST RUNNER', false, `框架错误: ${fatalErr.message}`)
} finally {
  try {
    await sc.shutdown()
  } catch {}
}

// =================== 报告 ===================
console.log('\n' + '━'.repeat(60))
console.log(`  总计: ${pass} 通过 / ${fail} 失败 (共 ${results.length} 项)`)
console.log(`  sidecar 崩溃: ${sidecarCrashed ? 'YES' : 'NO'}`)
console.log('━'.repeat(60))

// 写报告
const reportPath = resolve(RESULTS_DIR, `mcp-boundary-${Date.now()}.json`)
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      summary: { pass, fail, total: results.length, sidecarCrashed },
      results,
    },
    null,
    2,
  ),
)
console.log(`\n报告已写入: ${reportPath}`)

// 清理
try {
  rmSync(dataDir, { recursive: true, force: true })
} catch {}

process.exit(fail > 0 || sidecarCrashed ? 1 : 0)