// Agent/Skill/Cron/Export 子系统测试 — 验证非EAA非Settings子系统的完整性
// 新角度: Agent CRUD / Skill CRUD / Cron 验证 / Export 格式 / Ollama 检测 / 跨子系统稳定性
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'

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

  const ready = new Promise((resolveR, reject) => {
    const t = setTimeout(() => reject(new Error('ready timeout')), 25000)
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

  function invoke(ch, args, timeoutMs = 30000) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args }) + '\n')
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs)
    })
  }
  function invokeQuiet(ch, args, timeoutMs = 30000) {
    return invoke(ch, args, timeoutMs).then(
      (data) => ({ ok: true, data }),
      (error) => ({ ok: false, error: error.message }),
    )
  }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} setTimeout(() => { try { child.kill() } catch {} }, 800) }
  return { ready, invoke, invokeQuiet, shutdown, child }
}

const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { console.log(`  ✗ ${msg}`); process.exitCode = 1 }
let passCount = 0, failCount = 0
const report = (cond, msg) => { if (cond) { ok(msg); passCount++ } else { bad(msg); failCount++ } }

async function runAgentSkillCronTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始 Agent/Skill/Cron/Export 测试\n')

  // ========== 测试1: Agent 列表 ==========
  console.log('━━━ 测试1: Agent 列表 ━━━')
  const agentList = await sidecar.invokeQuiet('agent:list', [])
  report(agentList.ok, `agent:list: ${agentList.ok ? '成功' : agentList.error}`)
  const agents = Array.isArray(agentList.data) ? agentList.data : (agentList.data?.agents || [])
  report(agents.length > 0, `Agent 数量: ${agents.length} (应>0)`)
  if (agents.length > 0) {
    console.log(`    首个 Agent: id=${agents[0].id || agents[0].name || '?'}, name=${agents[0].name || '?'}`)
  }

  // ========== 测试2: Agent 详情 ==========
  console.log('\n━━━ 测试2: Agent 详情 ━━━')
  const firstAgentId = agents[0]?.id || agents[0]?.name
  if (firstAgentId) {
    const agentGet = await sidecar.invokeQuiet('agent:get', [firstAgentId])
    report(agentGet.ok, `agent:get: ${agentGet.ok ? '成功' : agentGet.error}`)

    // 不存在的 agent
    const agentBad = await sidecar.invokeQuiet('agent:get', ['non-existent-agent-xyz'])
    report(agentBad.ok, `agent:get 不存在: 返回 (不崩溃)`)
  } else {
    report(false, '无法测试 agent:get (无可用 agent)')
  }

  // ========== 测试3: Agent toggle ==========
  console.log('\n━━━ 测试3: Agent toggle ━━━')
  if (firstAgentId) {
    // 获取当前状态
    const before = agents[0]
    const beforeEnabled = before?.enabled
    // toggle 为相反值
    const toggleRes = await sidecar.invokeQuiet('agent:toggle', [firstAgentId, !beforeEnabled])
    report(toggleRes.ok, `agent:toggle ${firstAgentId} → ${!beforeEnabled}: ${toggleRes.ok ? '成功' : toggleRes.error}`)
    // 恢复原状态
    const restoreRes = await sidecar.invokeQuiet('agent:toggle', [firstAgentId, beforeEnabled])
    report(restoreRes.ok, `agent:toggle 恢复: ${restoreRes.ok ? '成功' : restoreRes.error}`)
  } else {
    report(false, '无法测试 agent:toggle')
  }

  // ========== 测试4: Agent update 验证 ==========
  console.log('\n━━━ 测试4: Agent update 验证 ━━━')
  // 空 id (应被拒绝)
  const updateBadId = await sidecar.invokeQuiet('agent:update', ['', { name: 'test' }])
  report(updateBadId.ok && updateBadId.data?.success === false, `agent:update 空id被拒绝`)
  // null patch (应被拒绝)
  const updateBadPatch = await sidecar.invokeQuiet('agent:update', [firstAgentId || 'test', null])
  report(updateBadPatch.ok && updateBadPatch.data?.success === false, `agent:update null patch被拒绝`)
  // 合法更新
  if (firstAgentId) {
    const updateOk = await sidecar.invokeQuiet('agent:update', [firstAgentId, { description: '测试描述' }])
    report(updateOk.ok, `agent:update 合法: ${updateOk.ok ? '成功' : updateOk.error}`)
  }

  // ========== 测试5: Agent SOUL/RULES 读写 ==========
  console.log('\n━━━ 测试5: Agent SOUL/RULES 读写 ━━━')
  if (firstAgentId) {
    const getSoul = await sidecar.invokeQuiet('agent:get-soul', [firstAgentId])
    report(getSoul.ok, `agent:get-soul: ${getSoul.ok ? '成功' : getSoul.error}`)

    const getRules = await sidecar.invokeQuiet('agent:get-rules', [firstAgentId])
    report(getRules.ok, `agent:get-rules: ${getRules.ok ? '成功' : getRules.error}`)

    // 类型验证: 非字符串 content 应被拒绝
    const setSoulBad = await sidecar.invokeQuiet('agent:set-soul', [firstAgentId, 123])
    report(setSoulBad.ok && setSoulBad.data?.success === false, `agent:set-soul 非字符串被拒绝`)
    const setRulesBad = await sidecar.invokeQuiet('agent:set-rules', [firstAgentId, null])
    report(setRulesBad.ok && setRulesBad.data?.success === false, `agent:set-rules null被拒绝`)
  } else {
    report(false, '无法测试 agent SOUL/RULES')
  }

  // ========== 测试6: Skill 列表与 CRUD ==========
  console.log('\n━━━ 测试6: Skill 列表与 CRUD ━━━')
  const skillList = await sidecar.invokeQuiet('skill:list', [])
  report(skillList.ok, `skill:list: ${skillList.ok ? '成功' : skillList.error}`)
  const skills = Array.isArray(skillList.data) ? skillList.data : (skillList.data?.skills || [])
  console.log(`    现有技能: ${skills.length} 个`)

  // 保存新技能
  const skillName = `test-skill-${Date.now()}`
  const saveSkill = await sidecar.invokeQuiet('skill:save', [skillName, '# 测试技能\n这是一个测试技能内容。'])
  report(saveSkill.ok, `skill:save ${skillName}: ${saveSkill.ok ? '成功' : saveSkill.error}`)

  // 获取技能
  const getSkill = await sidecar.invokeQuiet('skill:get', [skillName])
  report(getSkill.ok, `skill:get: ${getSkill.ok ? '成功' : getSkill.error}`)

  // 验证内容
  const skillContent = getSkill.data?.content || getSkill.data
  report(typeof skillContent === 'string' && skillContent.includes('测试技能'),
    `skill:get 内容验证: ${typeof skillContent === 'string' ? '包含"测试技能"' : '内容类型错误'}`)

  // 删除技能
  const delSkill = await sidecar.invokeQuiet('skill:delete', [skillName])
  report(delSkill.ok, `skill:delete: ${delSkill.ok ? '成功' : delSkill.error}`)

  // 验证删除后获取返回空
  const getAfterDel = await sidecar.invokeQuiet('skill:get', [skillName])
  report(getAfterDel.ok, `skill:get 删除后: 返回 (不崩溃)`)

  // ========== 测试7: Cron 列表与验证 ==========
  console.log('\n━━━ 测试7: Cron 列表与验证 ━━━')
  const cronList = await sidecar.invokeQuiet('cron:list', [])
  report(cronList.ok, `cron:list: ${cronList.ok ? '成功' : cronList.error}`)
  const cronTasks = Array.isArray(cronList.data) ? cronList.data : (cronList.data?.tasks || [])
  console.log(`    现有 cron 任务: ${cronTasks.length} 个`)

  // ========== 测试8: Cron add 验证 ==========
  console.log('\n━━━ 测试8: Cron add 验证 ━━━')
  // 合法任务 — CronTask 必填字段: name, agentId, expression (prompt/modelTier 可选)
  const cronName = `test-cron-${Date.now()}`
  const addCron = await sidecar.invokeQuiet('cron:add', [{
    name: cronName,
    agentId: firstAgentId || 'test-agent',
    expression: '*/30 * * * *',
    prompt: 'test prompt',
    enabled: false,
  }])
  report(addCron.ok && addCron.data?.success !== false, `cron:add 合法: ${addCron.ok ? '成功' : addCron.error}`)

  // 空 name (应被拒绝) — handler 不抛异常,返回 {success:false, error}
  const addCronBadName = await sidecar.invokeQuiet('cron:add', [{ name: '', agentId: firstAgentId || 'test', expression: '* * * * *' }])
  report(addCronBadName.data?.success === false, `cron:add 空name被拒绝`)

  // 无效 cron 表达式 (应被拒绝)
  const addCronBadExpr = await sidecar.invokeQuiet('cron:add', [{ name: 'bad', agentId: firstAgentId || 'test', expression: '*/foo * * * *' }])
  report(addCronBadExpr.ok === false || addCronBadExpr.data?.success === false, `cron:add 无效表达式被拒绝`)

  // null task (应被拒绝)
  const addCronNull = await sidecar.invokeQuiet('cron:add', [null])
  report(addCronNull.data?.success === false, `cron:add null被拒绝`)

  // ========== 测试9: Cron update/remove ==========
  console.log('\n━━━ 测试9: Cron update/remove ━━━')
  const cronId = addCron.data?.id
  if (cronId) {
    // update
    const updateCron = await sidecar.invokeQuiet('cron:update', [cronId, { name: `${cronName}-updated` }])
    report(updateCron.ok, `cron:update: ${updateCron.ok ? '成功' : updateCron.error}`)

    // 无效 expression update (应被拒绝)
    const updateCronBad = await sidecar.invokeQuiet('cron:update', [cronId, { expression: 'invalid' }])
    report(updateCronBad.ok === false || updateCronBad.data?.success === false, `cron:update 无效表达式被拒绝`)

    // remove
    const removeCron = await sidecar.invokeQuiet('cron:remove', [cronId])
    report(removeCron.ok, `cron:remove: ${removeCron.ok ? '成功' : removeCron.error}`)
  } else {
    report(false, '无法测试 cron:update/remove (无 cron id)')
  }

  // ========== 测试10: Export 格式 ==========
  console.log('\n━━━ 测试10: Export 格式 ━━━')
  const exportFormats = await sidecar.invokeQuiet('eaa:export-formats', [])
  report(exportFormats.ok, `eaa:export-formats: ${exportFormats.ok ? '成功' : exportFormats.error}`)
  const formats = Array.isArray(exportFormats.data) ? exportFormats.data : []
  console.log(`    支持的格式: ${formats.join(', ') || '(空)'}`)
  report(formats.length > 0, `导出格式数量: ${formats.length} (应>0)`)

  // ========== 测试11: Export 执行 ==========
  console.log('\n━━━ 测试11: Export 执行 ━━━')
  // 先添加测试数据
  await sidecar.invokeQuiet('eaa:add-student', ['导出测试学生'])
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '导出测试学生', reasonCode: 'ACTIVITY_PARTICIPATION', delta: 1 }])

  // 合法导出 (csv 格式到临时文件)
  const exportFile = join(dataDir, `export-${Date.now()}.csv`)
  let exportFormat = formats.includes('csv') ? 'csv' : (formats[0] || 'csv')
  const exportRes = await sidecar.invokeQuiet('eaa:export', [exportFormat, exportFile])
  report(exportRes.ok, `eaa:export ${exportFormat}: ${exportRes.ok ? '成功' : exportRes.error}`)

  // 非法格式 (应被拒绝)
  const exportBad = await sidecar.invokeQuiet('eaa:export', ['INVALID_FORMAT_XYZ'])
  report(exportBad.ok === false, `eaa:export 非法格式被拒绝: ${exportBad.ok === false ? '是' : '否'}`)

  // ========== 测试12: Ollama 检测 ==========
  console.log('\n━━━ 测试12: Ollama 检测 ━━━')
  const ollamaDetect = await sidecar.invokeQuiet('ollama:detect', [])
  // Ollama 可能未安装,不报错即可
  report(ollamaDetect.ok, `ollama:detect: ${ollamaDetect.ok ? '成功' : ollamaDetect.error}`)
  if (ollamaDetect.ok) {
    console.log(`    Ollama: ${ollamaDetect.data?.installed ? '已安装' : '未安装'} v${ollamaDetect.data?.version || '?'}`)
  }

  // ========== 测试13: 跨子系统稳定性 ==========
  console.log('\n━━━ 测试13: 跨子系统稳定性 ━━━')
  // 连续调用多个子系统,验证 sidecar 不崩溃
  const crossTests = [
    { ch: 'agent:list', args: [] },
    { ch: 'skill:list', args: [] },
    { ch: 'cron:list', args: [] },
    { ch: 'eaa:info', args: [] },
    { ch: 'settings:get', args: [] },
    { ch: 'eaa:export-formats', args: [] },
  ]
  let crossOk = 0
  for (const t of crossTests) {
    const r = await sidecar.invokeQuiet(t.ch, t.args)
    if (r.ok) crossOk++
  }
  report(crossOk === crossTests.length, `跨子系统连续调用: ${crossOk}/${crossTests.length} 成功`)

  // ========== 测试14: 并行子系统调用 ==========
  console.log('\n━━━ 测试14: 并行子系统调用 ━━━')
  const t14a = Date.now()
  const parallelResults = await Promise.allSettled([
    sidecar.invoke('agent:list', []),
    sidecar.invoke('skill:list', []),
    sidecar.invoke('cron:list', []),
    sidecar.invoke('eaa:info', []),
    sidecar.invoke('eaa:export-formats', []),
    sidecar.invoke('eaa:ranking', [10]),
    sidecar.invoke('settings:get', []),
    sidecar.invoke('privacy:status', []),
  ])
  const t14b = Date.now() - t14a
  const parallelOk = parallelResults.filter(r => r.status === 'fulfilled').length
  report(parallelOk === 8, `8并行子系统调用: ${parallelOk}/8 成功 (${t14b}ms)`)

  // ========== 测试15: 清理测试数据 ==========
  console.log('\n━━━ 测试15: 清理测试数据 ━━━')
  const cleanup = await sidecar.invokeQuiet('eaa:delete-student', ['导出测试学生', { confirm: true, reason: '测试清理' }])
  report(cleanup.ok, `清理导出测试学生: ${cleanup.ok ? '成功' : cleanup.error}`)

  // 最终检查
  const finalCheck = await sidecar.invokeQuiet('eaa:info', [])
  report(finalCheck.ok && finalCheck.data?.success === true, '子系统测试后 sidecar 正常响应')

  sidecar.shutdown()

  const testResults = {
    round: 'Agent/Skill/Cron/Export 测试',
    timestamp: new Date().toISOString(),
    summary: { pass: passCount, fail: failCount },
  }
  writeFileSync(resolve(RESULTS_DIR, 'agent-skill-cron-results.json'), JSON.stringify(testResults, null, 2))
  console.log(`\n━━━ 结果: ${passCount}通过 / ${failCount}失败 ━━━\n`)
}

const dataDir = resolve(ROOT, `test-tauri-data-agent-skill-${Date.now()}`)
runAgentSkillCronTest(dataDir).then(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(failCount > 0 ? 1 : 0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
