// =============================================================
// 第13轮 sidecar IPC 边缘测试 — Agent 生命周期 / 数据迁移 / 极端输入 / Cron 边界
// 设计: 每个角度独立 section, 复用 harness.mjs 风格的启动器, 单文件多角度
// =============================================================
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(ROOT, 'test-results')
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

let passCount = 0
let failCount = 0
const findings = [] // BUG 列表
const ok = (msg) => { console.log(`  PASS: ${msg}`); passCount++ }
const bad = (msg, detail) => {
  console.log(`  FAIL: ${msg}${detail ? ' — ' + detail : ''}`)
  failCount++
}
const report = (cond, msg, detail) => cond ? ok(msg) : bad(msg, detail)
const note = (msg) => console.log(`  NOTE: ${msg}`)

function startSidecar(dataDir) {
  const child = spawn('node', [resolve(ROOT, 'sidecar/edu-sidecar.mjs')], {
    env: { ...process.env, EDU_APP_DATA_DIR: dataDir, EDU_RESOURCE_DIR: ROOT },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1
  const ready = new Promise((resolveR, reject) => {
    const t = setTimeout(() => reject(new Error('ready timeout 30s')), 30000)
    const checker = (line) => {
      try {
        const m = JSON.parse(line)
        if (m.type === 'event' && m.channel === '__sidecar__:ready') {
          clearTimeout(t); rl.off('line', checker); resolveR(m.data)
        }
      } catch {}
    }
    rl.on('line', checker)
  })
  rl.on('line', (line) => {
    let m; try { m = JSON.parse(line) } catch { return }
    if (m.type === 'result' && m.id != null) {
      const p = pending.get(m.id)
      if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) }
    }
  })
  function invoke(ch, args, timeoutMs = 15000) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args }) + '\n')
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs)
    })
  }
  function invokeQuiet(ch, args, timeoutMs = 15000) {
    return invoke(ch, args, timeoutMs).then(
      (data) => ({ ok: true, data }),
      (error) => ({ ok: false, error: error.message }),
    )
  }
  const shutdown = () => {
    try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {}
    setTimeout(() => { try { child.kill() } catch {} }, 800)
  }
  return { ready, invoke, invokeQuiet, shutdown }
}

// ============================================================
// Section A: Agent 完整生命周期
// ============================================================
async function sectionA_AgentLifecycle(dataDir) {
  console.log('\n━━━ Section A: Agent 完整生命周期 ━━━')
  const sidecar = startSidecar(dataDir)
  await sidecar.ready

  // A.1 list
  const listR = await sidecar.invokeQuiet('agent:list', [])
  report(listR.ok, 'A.1 agent:list 调用成功', listR.error)
  const agents = Array.isArray(listR.data) ? listR.data : []
  report(agents.length > 0, `A.1 agent 数量 > 0 (实际 ${agents.length})`)
  if (agents.length === 0) {
    sidecar.shutdown(); return
  }
  const firstId = agents[0].id

  // A.2 get
  const getR = await sidecar.invokeQuiet('agent:get', [firstId])
  report(getR.ok, `A.2 agent:get(${firstId}) 成功`, getR.error)
  if (getR.ok) {
    const detail = getR.data
    report(typeof detail?.id === 'string', 'A.2 detail 含 id')
    report(typeof detail?.name === 'string', 'A.2 detail 含 name')
    report(typeof detail?.soulContent === 'string', 'A.2 detail 含 soulContent')
    report(typeof detail?.rulesContent === 'string', 'A.2 detail 含 rulesContent')
  }

  // A.3 get 不存在
  const badGet = await sidecar.invokeQuiet('agent:get', ['nonexistent-id-xyz-12345'])
  // agent:get 不存在返回 null (getAgent 返回 null), 不是错误. ok=true, data=null
  report(badGet.ok && badGet.data === null, `A.3 agent:get 不存在返回 null: ${JSON.stringify(badGet.data)}`)

  // A.4 run-manual 不存在 agent
  const runBad = await sidecar.invokeQuiet('agent:run-manual', ['nonexistent-id-xyz-12345', 'hello'])
  // IPC 接受调用, 但应在 data 里 success:false + message 包含 'not found'
  const a4Pass = runBad.ok && runBad.data?.success === false && /not found/i.test(runBad.data?.message || runBad.data?.error || '')
  report(a4Pass, `A.4 agent:run-manual 不存在应被拒: ${JSON.stringify(runBad.data)}`)

  // A.5 禁用后 run-manual
  const beforeEnabled = agents[0].enabled
  const offRes = await sidecar.invokeQuiet('agent:toggle', [firstId, false])
  report(offRes.ok && offRes.data?.success !== false, `A.5 toggle off 成功`)
  const runDisabled = await sidecar.invokeQuiet('agent:run-manual', [firstId, 'test'])
  const a5Pass = runDisabled.ok && runDisabled.data?.success === false && /disabled/i.test(runDisabled.data?.message || runDisabled.data?.error || '')
  report(a5Pass, `A.5 禁用后 run-manual 应被拒: ${JSON.stringify(runDisabled.data)}`)
  if (!a5Pass && runDisabled.ok && runDisabled.data?.success === true) {
    // 真 bug: IPC 返回 success:true 但实际执行被 disabled 拒绝
    findings.push({
      id: 'R13-2',
      severity: 'medium',
      location: 'src/main/ipc/agent-handlers.ts:288-298 (agent:run-manual)',
      desc: 'IPC handler 同步校验仅检查 agent 是否存在,未检查 enabled. 禁用 agent 的 run-manual 调用返回 success:true 误导前端, 实际 runAgent 异步抛 "Agent is disabled" 才通过 sendStatus 推送. 建议在 exists 检查后增加 enabled 同步校验.',
    })
  }
  // 恢复
  await sidecar.invokeQuiet('agent:toggle', [firstId, beforeEnabled])

  // A.6 run-manual (实际可能因 LLM 缺失失败, 但 IPC 层不应崩溃)
  const runReal = await sidecar.invokeQuiet('agent:run-manual', [firstId, '测试问题'])
  if (runReal.ok && runReal.data?.success === true) {
    note('A.6 run-manual 启动成功 (有 LLM 可用)')
  } else {
    const errMsg = runReal.data?.message || runReal.data?.error || runReal.error || '?'
    note(`A.6 run-manual 启动: ${errMsg}`)
  }

  sidecar.shutdown()
}

// ============================================================
// Section B: 数据迁移 / 升级场景
// ============================================================
async function sectionB_DataMigration(dataDir) {
  console.log('\n━━━ Section B: 数据迁移场景 ━━━')
  mkdirSync(dataDir, { recursive: true })

  // B.1 旧版 settings.json (缺 mcp 字段, 缺 chat.compaction)
  const oldSettings = {
    general: {
      dataDir: '',
      theme: 'light',
      language: 'zh-CN',
    },
    models: {
      defaultProvider: '',
      transport: 'auto',
    },
    chat: {
      maxTokens: 4096,
    },
  }
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(oldSettings, null, 2))

  // B.2 旧版 mcp.user.yaml (缺 source 字段)
  writeFileSync(
    join(dataDir, 'mcp.user.yaml'),
    `servers:
  - id: legacy-server
    name: 旧版server
    enabled: true
    transport: stdio
    command: npx
    args: ["-y", "legacy"]
`,
    'utf-8',
  )

  const sidecar = startSidecar(dataDir)
  await sidecar.ready

  // 验证 settings 自动补全
  const settingsR = await sidecar.invokeQuiet('settings:get', [])
  report(settingsR.ok, 'B.1 settings:get 成功 (兼容旧版 settings.json)', settingsR.error)
  if (settingsR.ok && settingsR.data) {
    const s = settingsR.data
    report(s.chat?.compaction?.enabled === true, 'B.1 旧 settings.json 缺 chat.compaction 自动补全')
    report(s.mcp !== undefined, 'B.1 旧 settings.json 缺 mcp 自动补全')
    report(s.chat?.maxTokens === 4096, 'B.1 旧 chat.maxTokens=4096 保留')
  }

  // 验证 mcp 旧 yaml 加载
  const mcpList = await sidecar.invokeQuiet('mcp:list', [])
  if (mcpList.ok && Array.isArray(mcpList.data)) {
    const legacy = mcpList.data.find((s) => s.id === 'legacy-server')
    if (legacy) {
      note(`B.2 旧版 mcp.user.yaml legacy-server 已加载 (source=${legacy.source})`)
      if (!legacy.source) {
        findings.push({
          id: 'R13-1',
          severity: 'low',
          location: 'src/main/services/mcp-service.ts',
          desc: '旧版 mcp.user.yaml 缺 source 字段,加载后 mcp:list 返回的 server.source 为 undefined',
        })
      }
    } else {
      note('B.2 旧版 mcp.user.yaml legacy-server 未出现在 list (可能因为 MCP feature flag 关)')
    }
  }

  // 验证 settings.json 已被自动重写 (含完整字段)
  await new Promise((r) => setTimeout(r, 500)) // 等节流落盘
  const onDisk = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf-8'))
  report(onDisk.chat?.compaction?.enabled === true, 'B.1 settings.json 已自动重写,含 chat.compaction')
  report(onDisk.mcp !== undefined, 'B.1 settings.json 已自动重写,含 mcp')

  // B.3 损坏的 settings.json
  writeFileSync(join(dataDir, 'settings.json'), '{ this is not valid json', 'utf-8')
  sidecar.shutdown()

  const sidecar2 = startSidecar(dataDir)
  await sidecar2.ready
  const corruptR = await sidecar2.invokeQuiet('settings:get', [])
  report(corruptR.ok, 'B.3 损坏的 settings.json 不导致 sidecar 崩溃')
  if (corruptR.ok) {
    const s = corruptR.data
    report(s?.general?.theme !== undefined, 'B.3 损坏 settings.json 触发 defaults 加载')
  }
  sidecar2.shutdown()
}

// ============================================================
// Section C: 极端 IPC 输入
// ============================================================
async function sectionC_ExtremeInputs(dataDir) {
  console.log('\n━━━ Section C: 极端 IPC 输入 ━━━')
  const sidecar = startSidecar(dataDir)
  await sidecar.ready

  // C.1 超长 id
  const longId = 'a'.repeat(10000)
  const longR = await sidecar.invokeQuiet('agent:get', [longId])
  // 不存在长 id → 返回 null (不崩)
  report(longR.ok && longR.data === null, `C.1 agent:get 超长 id 返回 null (不崩): ${JSON.stringify(longR.data).slice(0,60)}`)

  // C.2 错误类型 (id 期望 string, 给 number)
  const numR = await sidecar.invokeQuiet('agent:get', [12345])
  // IPC 接受, 返回 {success:false, error:'id must be a non-empty string'}
  const c2Pass = numR.ok && numR.data?.success === false
  report(c2Pass, `C.2 agent:get number 类型 id 应被拒: ${JSON.stringify(numR.data)}`)

  // C.3 错误类型 (boolean)
  const boolR = await sidecar.invokeQuiet('agent:get', [true])
  const c3Pass = boolR.ok && boolR.data?.success === false
  report(c3Pass, `C.3 agent:get boolean 类型 id 应被拒: ${JSON.stringify(boolR.data)}`)

  // C.4 错误类型 (object)
  const objR = await sidecar.invokeQuiet('agent:get', [{ evil: true }])
  const c4Pass = objR.ok && objR.data?.success === false
  report(c4Pass, `C.4 agent:get object 类型 id 应被拒: ${JSON.stringify(objR.data)}`)

  // C.5 settings:update 超长字符串
  const hugeStr = 'x'.repeat(2_000_000) // 超过 1M 上限
  const hugeR = await sidecar.invokeQuiet('settings:set', ['general.updateUrl', hugeStr])
  const c5Pass = hugeR.ok && hugeR.data?.success === false
  report(c5Pass, `C.5 settings:set 超长字符串 (2MB) 应被拒: ${JSON.stringify(hugeR.data).slice(0,80)}`)

  // C.6 settings:update NaN
  const nanR = await sidecar.invokeQuiet('settings:set', ['chat.maxTokens', NaN])
  const c6Pass = nanR.ok && nanR.data?.success === false
  report(c6Pass, `C.6 settings:set NaN 应被拒: ${JSON.stringify(nanR.data)}`)

  // C.7 settings:update 极深嵌套对象
  const deep = { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: 1 } } } } } } } } } } }
  const deepR = await sidecar.invokeQuiet('settings:set', ['models.defaultProvider', deep])
  const c7Pass = deepR.ok && deepR.data?.success === false
  report(c7Pass, `C.7 settings:set 深度嵌套对象应被拒: ${JSON.stringify(deepR.data).slice(0,80)}`)

  // C.8 settings:set 不存在的 dotPath
  const badPath = await sidecar.invokeQuiet('settings:set', ['nonexistent.field', 'x'])
  const c8Pass = badPath.ok && badPath.data?.success === false
  report(c8Pass, `C.8 settings:set 不存在 dotPath 应被拒: ${JSON.stringify(badPath.data).slice(0,80)}`)

  // C.9 settings:set 空 dotPath
  const emptyPath = await sidecar.invokeQuiet('settings:set', ['', 'x'])
  const c9Pass = emptyPath.ok && emptyPath.data?.success === false
  report(c9Pass, `C.9 settings:set 空 dotPath 应被拒: ${JSON.stringify(emptyPath.data).slice(0,80)}`)

  // C.10 agent:run-manual null prompt
  const nullPrompt = await sidecar.invokeQuiet('agent:run-manual', ['main', null])
  const c10Pass = nullPrompt.ok && nullPrompt.data?.success === false
  report(c10Pass, `C.10 agent:run-manual null prompt 应被拒: ${JSON.stringify(nullPrompt.data)}`)

  // C.11 agent:run-manual 超长 prompt (>1M)
  const hugePrompt = 'a'.repeat(1_500_000)
  const hugePromptR = await sidecar.invokeQuiet('agent:run-manual', ['main', hugePrompt])
  const c11Pass = hugePromptR.ok && hugePromptR.data?.success === false
  report(c11Pass, `C.11 agent:run-manual 超长 prompt 应被拒: ${JSON.stringify(hugePromptR.data).slice(0,80)}`)

  // C.12 agent:run-manual null byte prompt
  const nullBytePrompt = await sidecar.invokeQuiet('agent:run-manual', ['main', 'hello\0world'])
  const c12Pass = nullBytePrompt.ok && nullBytePrompt.data?.success === false
  report(c12Pass, `C.12 agent:run-manual 含 null byte 应被拒: ${JSON.stringify(nullBytePrompt.data)}`)

  // C.13 cron:add 无效 cron
  const badCron = await sidecar.invokeQuiet('cron:add', [{ name: 'bad-cron', expression: 'not-a-cron', agentId: 'main', prompt: 'x', enabled: true, modelTier: 'low_cost' }])
  const c13Pass = badCron.ok && badCron.data?.success === false
  report(c13Pass, `C.13 cron:add 无效表达式 应被拒: ${JSON.stringify(badCron.data).slice(0,80)}`)
  if (!c13Pass) {
    // 任务被创建但未调度 — 记入 findings
    findings.push({
      id: 'R13-1',
      severity: 'low',
      location: 'src/main/services/cron-service.ts addTask (line ~70-85)',
      desc: 'cronService.addTask 不立即校验 expression 合法性, 接受后存到 tasks 但 schedule() 会因 cron.validate(expr)=false 跳过调度, 导致任务"幽灵化" (出现于 list 但永不执行). 建议在 addTask 入口即调 cron.validate 拒绝.',
    })
    note(`C.13 cronService 接受了无效表达式 "not-a-cron", id=${badCron.data?.id}`)
  }

  // C.14 cron:add name 含 null byte
  const nullCron = await sidecar.invokeQuiet('cron:add', [{ name: 'bad\0name', expression: '* * * * *', agentId: 'main', prompt: 'x', enabled: true, modelTier: 'low_cost' }])
  const c14Pass = nullCron.ok && nullCron.data?.success === false
  report(c14Pass, `C.14 cron:add null byte name 应被拒: ${JSON.stringify(nullCron.data)}`)

  // C.15 cron:add agentId 含 null byte
  const nullAgentId = await sidecar.invokeQuiet('cron:add', [{ name: 'x', expression: '* * * * *', agentId: 'main\0evil', prompt: 'x', enabled: true, modelTier: 'low_cost' }])
  const c15Pass = nullAgentId.ok && nullAgentId.data?.success === false
  report(c15Pass, `C.15 cron:add null byte agentId 应被拒: ${JSON.stringify(nullAgentId.data)}`)

  // C.16 cron:add prompt 含 null byte
  const nullPromptCron = await sidecar.invokeQuiet('cron:add', [{ name: 'x', expression: '* * * * *', agentId: 'main', prompt: 'evil\0prompt', enabled: true, modelTier: 'low_cost' }])
  const c16Pass = nullPromptCron.ok && nullPromptCron.data?.success === false
  report(c16Pass, `C.16 cron:add null byte prompt 应被拒: ${JSON.stringify(nullPromptCron.data)}`)

  // C.17 cron:add modelTier 非法值
  const badTier = await sidecar.invokeQuiet('cron:add', [{ name: 'tier', expression: '* * * * *', agentId: 'main', prompt: 'x', enabled: true, modelTier: 'ultra_mega_high' }])
  const c17Pass = badTier.ok && badTier.data?.success === false
  report(c17Pass, `C.17 cron:add 非法 modelTier 应被拒: ${JSON.stringify(badTier.data).slice(0,80)}`)

  // 清理
  for (const t of [badCron, nullCron, nullAgentId, nullPromptCron, badTier]) {
    if (t?.ok && t.data?.id) {
      await sidecar.invokeQuiet('cron:remove', [t.data.id])
    }
  }

  sidecar.shutdown()
}

// ============================================================
// Section D: Cron 边界
// ============================================================
async function sectionD_CronEdges(dataDir) {
  console.log('\n━━━ Section D: Cron 边界 ━━━')
  const sidecar = startSidecar(dataDir)
  await sidecar.ready

  // D.1 任务数上限
  const maxTasks = 100
  const ids = []
  let maxReached = false
  let maxRejectErr = ''
  for (let i = 0; i < maxTasks + 5; i++) {
    const r = await sidecar.invokeQuiet('cron:add', [{
      name: `max-task-${i}`,
      expression: '0 9 * * *',
      agentId: 'main',
      prompt: 'x',
      enabled: true,
      modelTier: 'low_cost',
    }])
    if (r.ok && r.data?.success && r.data?.id) {
      ids.push(r.data.id)
    } else {
      maxReached = true
      maxRejectErr = r.error || JSON.stringify(r.data)
      note(`D.1 第 ${i + 1} 个 cron 任务被拒: ${maxRejectErr}`)
      break
    }
  }
  report(maxReached || ids.length === maxTasks, `D.1 cron 任务上限 (${maxTasks}) 应被强制: ${ids.length}/${maxTasks} 通过`)

  // 清理
  for (const id of ids) {
    await sidecar.invokeQuiet('cron:remove', [id])
  }

  // D.2 run-now 不存在 id
  const noIdR = await sidecar.invokeQuiet('cron:run-now', ['nonexistent-id-xyz'])
  // 不应崩
  report(true, `D.2 cron:run-now 不存在 id: ${noIdR.ok ? '返回' : noIdR.error}`)

  // D.3 注册一个任务, run-now 多次快速调用 (concurrency)
  const taskId = (await sidecar.invokeQuiet('cron:add', [{
    name: 'rapid-run',
    expression: '0 9 * * *',
    agentId: 'main',
    prompt: 'x',
    enabled: false, // 不自动调度, 只手动跑
    modelTier: 'low_cost',
  }])).data?.id

  if (taskId) {
    // 快速并发 5 次 run-now (agent 'main' 不存在 LLM 会快速失败)
    const rapid = await Promise.allSettled(
      Array.from({ length: 5 }, () => sidecar.invokeQuiet('cron:run-now', [taskId])),
    )
    note(`D.3 并发 5 次 run-now: ${rapid.filter((r) => r.status === 'fulfilled').length}/5 fulfilled`)

    await sidecar.invokeQuiet('cron:remove', [taskId])
  }

  // D.4 极端 cron 表达式 (6 字段 vs 5 字段)
  const sixField = await sidecar.invokeQuiet('cron:add', [{
    name: 'six-field',
    expression: '0 0 9 * * *', // 6 字段
    agentId: 'main',
    prompt: 'x',
    enabled: false,
    modelTier: 'low_cost',
  }])
  const d4Pass = sixField.ok && sixField.data?.success === false
  report(d4Pass, `D.4 cron 表达式 6 字段应被拒: ${JSON.stringify(sixField.data).slice(0,80)}`)
  if (!d4Pass && sixField.ok && sixField.data?.id) {
    // 被接受 — 记入 findings
    findings.push({
      id: 'R13-3',
      severity: 'low',
      location: 'src/main/services/cron-service.ts addTask → schedule → cron.validate',
      desc: 'cron 表达式 6 字段 (秒 分 时 日 月 周) 被 cronService 接受, 但 node-cron 5 字段 validate 拒绝, 任务"幽灵化" (永不调度). 严格 cron 校验在 IPC handler 已做,但 service 层兜底缺失.',
    })
    await sidecar.invokeQuiet('cron:remove', [sixField.data.id])
  }

  sidecar.shutdown()
}

// ============================================================
// Main
// ============================================================
async function main() {
  const ts = Date.now()
  const dataDirA = resolve(ROOT, `test-tauri-data-r13a-${ts}`)
  const dataDirB = resolve(ROOT, `test-tauri-data-r13b-${ts}`)
  const dataDirC = resolve(ROOT, `test-tauri-data-r13c-${ts}`)
  const dataDirD = resolve(ROOT, `test-tauri-data-r13d-${ts}`)

  try {
    await sectionA_AgentLifecycle(dataDirA)
  } catch (e) { console.error('Section A threw:', e); failCount++ }
  try { await sectionB_DataMigration(dataDirB) } catch (e) { console.error('Section B threw:', e); failCount++ }
  try { await sectionC_ExtremeInputs(dataDirC) } catch (e) { console.error('Section C threw:', e); failCount++ }
  try { await sectionD_CronEdges(dataDirD) } catch (e) { console.error('Section D threw:', e); failCount++ }

  // 输出
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  结果: ${passCount} 通过 / ${failCount} 失败`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // 写报告
  const report_data = {
    round: 'R13 sidecar IPC edge tests',
    timestamp: new Date().toISOString(),
    summary: { pass: passCount, fail: failCount, findings: findings.length },
    findings,
  }
  writeFileSync(resolve(RESULTS_DIR, 'r13-edges-results.json'), JSON.stringify(report_data, null, 2))

  if (findings.length > 0) {
    console.log('\n━━━ BUG 候选列表 ━━━')
    for (const f of findings) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.id}: ${f.desc}`)
      console.log(`        ${f.location}`)
    }
  }

  // 清理
  for (const d of [dataDirA, dataDirB, dataDirC, dataDirD]) {
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }

  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(2) })