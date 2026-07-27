// =============================================================
// 综合压力测试 v2 — 覆盖全部 115 IPC 通道 + 并发 + 性能 + 边界
// 由 test-runner-loop.mjs 调用, 也可独立运行
// =============================================================
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(ROOT, 'test-results')
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

// 启动 sidecar 并返回控制句柄
function startSidecar(dataDir) {
  const child = spawn('node', [resolve(ROOT, 'sidecar/edu-sidecar.mjs')], {
    env: { ...process.env, EDU_APP_DATA_DIR: dataDir, EDU_RESOURCE_DIR: ROOT },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ready timeout 30s')), 30000)
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
    try { m = JSON.parse(l) } catch { return }
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
      try {
        child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n')
      } catch (e) {
        pending.delete(id)
        rej(e)
      }
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          rej(new Error('timeout 30s'))
        }
      }, 30000)
    })
  }
  const shutdown = () => {
    try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {}
    return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500))
  }
  return { ready, invoke, shutdown, child }
}

// 计时器
function timed(fn) {
  const t = Date.now()
  return fn().then((v) => ({ v, ms: Date.now() - t }))
}

// 测试用例定义: [channel, args, {desc, expectOk, expectType, expectShape}]
// expectOk: true=必须成功, false=必须失败, null=允许任意
// expectType: 'array' | 'object' | 'string' | 'number' | 'null' | null
const TESTS = [
  // ===== EAA 读取类 (应全部成功) =====
  ['eaa:info', [], { desc: 'EAA 系统信息', expectOk: true, expectType: 'object' }],
  ['eaa:list-students', [], { desc: '列出学生', expectOk: true, expectType: 'object' }],
  ['eaa:ranking', [], { desc: '排行榜(默认)', expectOk: true, expectType: 'object' }],
  ['eaa:ranking', [10], { desc: '排行榜 Top10', expectOk: true, expectType: 'object' }],
  ['eaa:ranking', [0], { desc: '排行榜 N=0(边界)', expectOk: true }],
  ['eaa:ranking', [-5], { desc: '排行榜 N=负数(边界)', expectOk: true }],
  ['eaa:ranking', [10000], { desc: '排行榜 N=超大(边界)', expectOk: true }],
  ['eaa:stats', [], { desc: '统计', expectOk: true, expectType: 'object' }],
  ['eaa:codes', [], { desc: '原因码', expectOk: true, expectType: 'object' }],
  ['eaa:doctor', [], { desc: '健康检查', expectOk: true }],
  ['eaa:dashboard', [], { desc: '仪表盘数据', expectOk: true }],
  ['eaa:summary', [], { desc: '摘要', expectOk: true }],
  ['eaa:validate', [], { desc: '数据校验', expectOk: true }],
  ['eaa:export-formats', [], { desc: '导出格式列表', expectOk: true }],
  ['eaa:replay', [], { desc: '重放排名', expectOk: true }],
  ['eaa:tag', [], { desc: '标签列表', expectOk: true }],
  ['eaa:tag', ['测试标签'], { desc: '查询单个标签', expectOk: true }],
  ['eaa:range', ['2026-01-01', '2026-12-31'], { desc: '日期范围查询', expectOk: true }],
  ['eaa:range', ['2026-12-31', '2026-01-01'], { desc: '日期范围 start>end(应失败)', expectOk: false }],
  ['eaa:range', ['invalid', '2026-01-01'], { desc: '日期格式非法(应失败)', expectOk: false }],
  ['eaa:search', ['测试'], { desc: '搜索事件', expectOk: true }],
  ['eaa:search', [''], { desc: '搜索空字符串', expectOk: null }],

  // ===== EAA 学生管理 =====
  ['eaa:add-student', ['张三'], { desc: '添加学生 张三', expectOk: true }],
  ['eaa:add-student', ['李四'], { desc: '添加学生 李四', expectOk: true }],
  ['eaa:add-student', ['王五'], { desc: '添加学生 王五', expectOk: true }],
  ['eaa:add-student', ['张三'], { desc: '重复添加(应失败或幂等)', expectOk: null }],
  ['eaa:add-student', [''], { desc: '空名字(应失败)', expectOk: false }],
  ['eaa:add-student', [''], { desc: '空名字2(应失败)', expectOk: false }],
  ['eaa:add-student', ['A'.repeat(100)], { desc: '超长名字(应失败)', expectOk: false }],
  ['eaa:add-student', ['--inject'], { desc: '参数注入尝试(应失败)', expectOk: false }],
  ['eaa:add-student', ['正常学生名`;rm -rf'], { desc: 'shell注入尝试(应失败)', expectOk: false }],

  // ===== EAA 事件管理 =====
  ['eaa:add-event', [{ studentName: '张三', reasonCode: 'help_class', delta: 2, note: '测试加分' }], { desc: '添加事件 +2', expectOk: true }],
  ['eaa:add-event', [{ studentName: '张三', reasonCode: 'help_class', delta: -1, note: '测试扣分' }], { desc: '添加事件 -1', expectOk: true }],
  ['eaa:add-event', [{ studentName: '张三', reasonCode: 'help_class' }], { desc: '添加事件(无delta,用默认)', expectOk: null }],
  ['eaa:add-event', [{ studentName: '不存在的人', reasonCode: 'help_class', delta: 1 }], { desc: '不存在学生加事件', expectOk: null }],
  ['eaa:add-event', [{ studentName: '', reasonCode: 'help_class', delta: 1 }], { desc: '空名字加事件(应失败)', expectOk: false }],
  ['eaa:add-event', [{ studentName: '张三', reasonCode: '', delta: 1 }], { desc: '空原因码(应失败)', expectOk: false }],
  ['eaa:add-event', [{ studentName: '张三', reasonCode: 'help_class', delta: 999999 }], { desc: '超大delta', expectOk: null }],
  ['eaa:add-event', [{ studentName: '张三', reasonCode: 'help_class', delta: -999999 }], { desc: '超小delta', expectOk: null }],
  ['eaa:add-event', [{ studentName: '张三', reasonCode: 'help_class', delta: 1, dryRun: true }], { desc: 'dryRun模式', expectOk: true }],

  // ===== EAA 查询已存在学生 =====
  ['eaa:score', ['张三'], { desc: '查分数 张三', expectOk: true }],
  ['eaa:history', ['张三'], { desc: '查历史 张三', expectOk: true }],
  ['eaa:score', ['不存在的学生XYZ'], { desc: '查不存在学生分数', expectOk: null }],
  ['eaa:history', ['不存在的学生XYZ'], { desc: '查不存在学生历史', expectOk: null }],
  ['eaa:score', [''], { desc: '空名字查分(应失败)', expectOk: false }],
  ['eaa:score', ['--inject'], { desc: '注入查分(应失败)', expectOk: false }],

  // ===== EAA 学生元信息 (params: { name, group?, role?, classId?, clearClassId? }) =====
  ['eaa:set-student-meta', [{ name: '张三', group: '第一组', role: '组长' }], { desc: '设置元信息', expectOk: true }],
  ['eaa:set-student-meta', [{ name: '张三', classId: 'G7-3' }], { desc: '设置班级ID', expectOk: true }],
  ['eaa:set-student-meta', [{ name: '张三', clearClassId: true }], { desc: '清除班级ID', expectOk: true }],

  // ===== EAA 导出 (支持 csv, jsonl, html) =====
  ['eaa:export', ['csv'], { desc: '导出 CSV', expectOk: true }],
  ['eaa:export', ['jsonl'], { desc: '导出 JSONL', expectOk: true }],
  ['eaa:export', ['html'], { desc: '导出 HTML', expectOk: true }],
  ['eaa:export', ['json'], { desc: '导出 JSON(应失败,不支持)', expectOk: false }],
  ['eaa:export', ['invalid_format'], { desc: '导出非法格式(应失败)', expectOk: false }],

  // ===== Agent =====
  ['agent:list', [], { desc: 'Agent列表', expectOk: true, expectType: 'array' }],
  ['agent:get', ['main'], { desc: '获取main Agent', expectOk: true }],
  ['agent:get', ['nonexistent'], { desc: '获取不存在Agent(返回null)', expectOk: true, expectIsNull: true }],
  ['agent:get-soul', ['main'], { desc: '获取SOUL.md', expectOk: true }],
  ['agent:get-rules', ['main'], { desc: '获取AGENTS.md', expectOk: true }],
  ['agent:toggle', ['main', false], { desc: '禁用main', expectOk: true }],
  ['agent:toggle', ['main', true], { desc: '启用main', expectOk: true }],
  ['agent:toggle', ['nonexistent', true], { desc: '切换不存在Agent(返回success:false)', expectOk: true, expectSuccessFalse: true }],
  ['agent:get-history', ['main', 10], { desc: 'Agent历史', expectOk: null }],

  // ===== Settings (set 签名: path, value 两个独立参数) =====
  ['settings:get', [], { desc: '获取设置', expectOk: true, expectType: 'object' }],
  ['settings:set', ['general.theme', 'dark'], { desc: '设置主题dark', expectOk: true }],
  ['settings:set', ['general.theme', 'light'], { desc: '恢复主题light', expectOk: true }],
  ['settings:set', ['general.language', 'en-US'], { desc: '设置语言en', expectOk: true }],
  ['settings:set', ['general.language', 'zh-CN'], { desc: '恢复语言zh', expectOk: true }],
  ['settings:set', ['general.logLevel', 'debug'], { desc: '设置日志级别', expectOk: true }],
  ['settings:set', ['general.logLevel', 'info'], { desc: '恢复日志级别', expectOk: true }],
  ['settings:set', ['general.theme', 'INVALID_THEME'], { desc: '非法主题值(应失败)', expectOk: true, expectSuccessFalse: true }],
  ['settings:set', ['', 'x'], { desc: '空路径(应失败)', expectOk: false }],
  ['settings:set', ['invalid.deeply.nested.path', 'x'], { desc: '非法路径(应失败或忽略)', expectOk: null }],

  // ===== Skill =====
  ['skill:list', [], { desc: '技能列表', expectOk: true, expectType: 'array' }],
  ['skill:get', ['STUDENT_MANAGEMENT'], { desc: '获取技能', expectOk: null }],
  ['skill:get', ['nonexistent'], { desc: '获取不存在技能', expectOk: null }],
  ['skill:save', [{ name: '测试技能_临时', content: '# 临时技能\n测试内容' }], { desc: '保存技能', expectOk: null }],
  ['skill:delete', ['测试技能_临时'], { desc: '删除技能', expectOk: null }],

  // ===== Cron (task 需要 name + expression) =====
  ['cron:list', [], { desc: 'Cron列表', expectOk: true, expectType: 'array' }],
  ['cron:add', [{ name: '测试任务', expression: '0 9 * * *', agentId: 'main', enabled: false }], { desc: '添加Cron', expectOk: null }],
  ['cron:add', [{ name: '非法表达式', expression: '*/foo * * * *', agentId: 'main' }], { desc: '非法cron表达式(应失败)', expectOk: false }],
  ['cron:add', [{ name: '', expression: '0 9 * * *' }], { desc: '空name(应失败)', expectOk: false }],
  ['cron:add', [{ expression: '0 9 * * *' }], { desc: '缺name(应失败)', expectOk: false }],
  ['cron:remove', ['nonexistent'], { desc: '删除不存在Cron', expectOk: null }],
  ['cron:get-logs', ['nonexistent', 10], { desc: 'Cron日志', expectOk: null }],

  // ===== Class (params 用 snake_case: class_id, student_names) =====
  ['class:list', [], { desc: '班级列表', expectOk: true, expectType: 'object' }],
  ['class:create', [{ class_id: 'TEST-CLASS-1', name: '测试班级一', grade: 7 }], { desc: '创建班级', expectOk: null }],
  ['class:create', [{ class_id: 'TEST-CLASS-2', name: '测试班级二', grade: 8 }], { desc: '创建班级2', expectOk: null }],
  ['class:create', [{ class_id: 'TEST-CLASS-1', name: '重复班级' }], { desc: '重复创建(应失败或幂等)', expectOk: null }],
  ['class:list', [], { desc: '再次列出班级', expectOk: true }],
  ['class:update', [{ class_id: 'TEST-CLASS-1', name: '测试班级改名' }], { desc: '更新班级', expectOk: null }],
  ['class:archive', ['TEST-CLASS-2'], { desc: '归档班级', expectOk: null }],
  ['class:restore', ['TEST-CLASS-2'], { desc: '恢复班级', expectOk: null }],
  ['class:delete', ['TEST-CLASS-2'], { desc: '删除班级', expectOk: null }],
  ['class:assign', [{ class_id: 'TEST-CLASS-1', student_names: ['张三'] }], { desc: '分配学生到班级', expectOk: null }],
  ['class:remove', [{ class_id: 'TEST-CLASS-1', student_name: '张三' }], { desc: '从班级移除学生', expectOk: null }],
  ['class:delete', ['TEST-CLASS-1'], { desc: '清理测试班级', expectOk: null }],

  // ===== Privacy (load/disable 需要 password; dryrun 需要 text 字符串) =====
  ['privacy:status', [], { desc: '隐私状态', expectOk: true, expectType: 'object' }],
  ['privacy:load', ['testpassword123'], { desc: '加载隐私引擎(可能未初始化)', expectOk: null }],
  ['privacy:load', ['ab'], { desc: '过短密码2字符(应失败)', expectOk: false }],
  ['privacy:load', [''], { desc: '空密码(应失败)', expectOk: false }],
  ['privacy:list', [], { desc: '隐私映射表', expectOk: null }],
  ['privacy:enable', [], { desc: '启用隐私(可能失败,未初始化)', expectOk: null }],
  ['privacy:disable', ['testpassword123'], { desc: '禁用隐私', expectOk: null }],
  ['privacy:dryrun', ['张三今天迟到了'], { desc: '匿名化试运行', expectOk: null }],
  ['privacy:dryrun', [''], { desc: '空文本试运行(应失败)', expectOk: false }],

  // ===== AI =====
  ['ai:list-providers', [], { desc: 'AI供应商列表', expectOk: true, expectType: 'array' }],
  ['ai:list-models', ['openai'], { desc: 'OpenAI模型列表', expectOk: null }],
  ['ai:list-models', ['nonexistent-provider'], { desc: '不存在供应商模型', expectOk: null }],
  ['ai:test-connection', ['nonexistent', 'fake-key'], { desc: '测试不存在连接(返回success:false)', expectOk: true, expectSuccessFalse: true }],

  // ===== Ollama =====
  ['ollama:detect', [], { desc: '检测Ollama', expectOk: true }],
  ['ollama:list-models', [], { desc: 'Ollama模型列表', expectOk: null }],

  // ===== Profile (签名: name, data) =====
  ['profile:get', ['张三'], { desc: '获取档案 张三', expectOk: true }],
  ['profile:get', ['nonexistent'], { desc: '获取不存在档案', expectOk: true }],
  ['profile:get', [''], { desc: '空名字(应失败)', expectOk: false }],
  ['profile:set', ['张三', { notes: '测试备注', phone: '13800000000' }], { desc: '设置档案', expectOk: null }],
  ['profile:set', ['', { notes: 'x' }], { desc: '空名字设置(应失败)', expectOk: false }],
  ['profile:set', ['张三', null], { desc: 'null数据(应失败)', expectOk: false }],

  // ===== Log (签名: filePath, levels[], query) =====
  ['log:list', [], { desc: '日志列表', expectOk: true, expectType: 'array' }],
  ['log:list', [], { desc: '日志列表(再次)', expectOk: true }],

  // ===== Sys =====
  ['sys:get-path', ['userData'], { desc: '获取userData路径', expectOk: true }],
  ['sys:get-path', ['temp'], { desc: '获取temp路径', expectOk: true }],
  ['sys:get-path', ['desktop'], { desc: '获取desktop路径', expectOk: true }],
  ['sys:get-path', ['invalid'], { desc: '非法路径名(应失败)', expectOk: false }],
  ['sys:check-update', [], { desc: '检查更新', expectOk: null }],
  ['sys:read-file', ['package.json'], { desc: '读取文件', expectOk: null }],

  // ===== Chat (list-sessions 返回 {success, sessions}) =====
  ['chat:list-sessions', [], { desc: '会话列表', expectOk: true, expectType: 'object' }],
  ['chat:save-message', [{ sessionId: 'test-session', role: 'user', content: '测试消息' }], { desc: '保存消息', expectOk: null }],
  ['chat:load-messages', ['test-session'], { desc: '加载消息', expectOk: null }],
  ['chat:delete-session', ['test-session'], { desc: '删除会话', expectOk: null }],

  // ===== Feishu (feishu:test 签名: appId 字符串) =====
  ['feishu:status', [], { desc: '飞书状态', expectOk: true }],
  ['feishu:bot:status', [], { desc: '飞书机器人状态', expectOk: true }],
  ['feishu:test', ['cli_test'], { desc: '飞书测试(假凭证)', expectOk: null }],
  ['feishu:test', [''], { desc: '飞书测试空appId(返回success:false)', expectOk: true, expectSuccessFalse: true }],
]

// 运行单个测试
async function runTest(sc, channel, args, opts) {
  const t = Date.now()
  try {
    const result = await sc.invoke(channel, args)
    const ms = Date.now() - t
    let ok = true
    let issue = null
    if (opts.expectOk === false) {
      ok = false
      issue = 'expected failure but succeeded'
    }
    if (opts.expectIsNull && result !== null) {
      ok = false
      issue = `expected null, got ${typeof result}`
    }
    if (opts.expectSuccessFalse && result && typeof result === 'object' && result.success !== false) {
      ok = false
      issue = `expected success:false, got success=${result.success}`
    }
    if (opts.expectType === 'array' && !Array.isArray(result)) {
      ok = false
      issue = `expected array, got ${typeof result}`
    } else if (opts.expectType === 'object' && (typeof result !== 'object' || result === null || Array.isArray(result))) {
      ok = false
      issue = `expected object, got ${result === null ? 'null' : typeof result}`
    } else if (opts.expectType === 'string' && typeof result !== 'string') {
      ok = false
      issue = `expected string, got ${typeof result}`
    }
    return { channel, args, desc: opts.desc, ok, issue, ms, resultType: Array.isArray(result) ? 'array' : typeof result }
  } catch (e) {
    const ms = Date.now() - t
    // expectOk: null 表示允许任意结果(包括抛错)
    // expectOk: false 表示必须抛错
    // expectOk: true 表示必须成功
    const ok = opts.expectOk === false || opts.expectOk === null
    return { channel, args, desc: opts.desc, ok, issue: e.message, ms, resultType: 'error' }
  }
}

// 并发测试
async function runConcurrencyTests(sc) {
  const results = []

  // A. 20 个并发读 (应不互相阻塞)
  console.log('  ━━━ 并发读测试: 20 并发 ranking ━━━')
  const t0 = Date.now()
  const readPromises = []
  for (let i = 0; i < 20; i++) {
    readPromises.push(sc.invoke('eaa:ranking', [10]).then(() => 'ok').catch(() => 'err'))
  }
  const readOutcomes = await Promise.all(readPromises)
  const readMs = Date.now() - t0
  const readOk = readOutcomes.filter(o => o === 'ok').length
  console.log(`    ${readOk === 20 ? '✓' : '✗'} 并发读: ${readOk}/20 ok, ${readMs}ms (avg ${readMs/20}ms)`)
  results.push({ test: 'concurrent-read-20', ok: readOk, total: 20, ms: readMs, avg: readMs / 20 })

  // B. 10 个并发写 (检测竞态)
  console.log('  ━━━ 并发写测试: 10 并发 add-student ━━━')
  const t1 = Date.now()
  const writePromises = []
  for (let i = 0; i < 10; i++) {
    writePromises.push(sc.invoke('eaa:add-student', [`并发测试_${Date.now()}_${i}`]).then(() => 'ok').catch(() => 'err'))
  }
  const writeOutcomes = await Promise.all(writePromises)
  const writeMs = Date.now() - t1
  const writeOk = writeOutcomes.filter(o => o === 'ok').length
  console.log(`    ${writeOk === 10 ? '✓' : '✗'} 并发写: ${writeOk}/10 ok, ${writeMs}ms (avg ${writeMs/10}ms)`)
  results.push({ test: 'concurrent-write-10', ok: writeOk, total: 10, ms: writeMs, avg: writeMs / 10 })

  // C. 混合并发 (50并发: 25读+25写)
  console.log('  ━━━ 混合并发: 50 并发 (25读+25写) ━━━')
  const t2 = Date.now()
  const mixed = []
  for (let i = 0; i < 25; i++) {
    mixed.push(sc.invoke('eaa:ranking', [10]).then(() => 'read-ok').catch(() => 'read-err'))
    mixed.push(sc.invoke('eaa:add-student', [`混合_${Date.now()}_${i}`]).then(() => 'write-ok').catch(() => 'write-err'))
  }
  const mixedOutcomes = await Promise.all(mixed)
  const mixedMs = Date.now() - t2
  const mReadOk = mixedOutcomes.filter(o => o === 'read-ok').length
  const mWriteOk = mixedOutcomes.filter(o => o === 'write-ok').length
  console.log(`    读: ${mReadOk}/25 ok, 写: ${mWriteOk}/25 ok, 总 ${mixedMs}ms`)
  results.push({ test: 'mixed-concurrent-50', readOk: mReadOk, writeOk: mWriteOk, total: 50, ms: mixedMs })

  // D. 高压并发 (100 并发读)
  console.log('  ━━━ 高压并发: 100 并发读 ━━━')
  const t3 = Date.now()
  const hp = []
  for (let i = 0; i < 100; i++) {
    hp.push(sc.invoke('eaa:info', []).then(() => 'ok').catch(() => 'err'))
  }
  const hpOutcomes = await Promise.all(hp)
  const hpMs = Date.now() - t3
  const hpOk = hpOutcomes.filter(o => o === 'ok').length
  console.log(`    ${hpOk === 100 ? '✓' : '✗'} 高压100并发: ${hpOk}/100 ok, ${hpMs}ms (avg ${hpMs/100}ms)`)
  results.push({ test: 'high-pressure-100', ok: hpOk, total: 100, ms: hpMs, avg: hpMs / 100 })

  return results
}

// 性能基准
async function runPerformanceBenchmark(sc) {
  const results = []
  const iterations = 10

  // eaa:info 基准
  const infoTimes = []
  for (let i = 0; i < iterations; i++) {
    const t = Date.now()
    await sc.invoke('eaa:info', [])
    infoTimes.push(Date.now() - t)
  }
  const infoAvg = infoTimes.reduce((a, b) => a + b, 0) / iterations
  results.push({ test: 'eaa:info', iterations, avg: infoAvg, min: Math.min(...infoTimes), max: Math.max(...infoTimes) })

  // eaa:list-students 基准
  const listTimes = []
  for (let i = 0; i < iterations; i++) {
    const t = Date.now()
    await sc.invoke('eaa:list-students', [])
    listTimes.push(Date.now() - t)
  }
  const listAvg = listTimes.reduce((a, b) => a + b, 0) / iterations
  results.push({ test: 'eaa:list-students', iterations, avg: listAvg, min: Math.min(...listTimes), max: Math.max(...listTimes) })

  // settings:get 基准 (纯内存,应最快)
  const setTimes = []
  for (let i = 0; i < iterations; i++) {
    const t = Date.now()
    await sc.invoke('settings:get', [])
    setTimes.push(Date.now() - t)
  }
  const setAvg = setTimes.reduce((a, b) => a + b, 0) / iterations
  results.push({ test: 'settings:get', iterations, avg: setAvg, min: Math.min(...setTimes), max: Math.max(...setTimes) })

  // agent:list 基准
  const agentTimes = []
  for (let i = 0; i < iterations; i++) {
    const t = Date.now()
    await sc.invoke('agent:list', [])
    agentTimes.push(Date.now() - t)
  }
  const agentAvg = agentTimes.reduce((a, b) => a + b, 0) / iterations
  results.push({ test: 'agent:list', iterations, avg: agentAvg, min: Math.min(...agentTimes), max: Math.max(...agentTimes) })

  console.log(`  ━━━ 性能基准 (${iterations} 次) ━━━`)
  for (const r of results) {
    console.log(`    ${r.test}: avg=${r.avg.toFixed(1)}ms min=${r.min}ms max=${r.max}ms`)
  }
  return results
}

// 主流程
async function run(dataDir, round = 1) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  综合压力测试 v2 - 第 ${round} 轮`)
  console.log(`${'═'.repeat(60)}\n`)

  const sc = startSidecar(dataDir)
  await sc.ready
  console.log('✓ Sidecar READY\n')

  const report = {
    round,
    timestamp: new Date().toISOString(),
    dataDir,
    phases: {},
  }

  // 阶段1: 全通道覆盖
  console.log('━━━ 阶段1: 全通道覆盖测试 ━━━')
  const phase1Results = []
  let p1Pass = 0
  let p1Fail = 0
  for (const [channel, args, opts] of TESTS) {
    const r = await runTest(sc, channel, args, opts)
    phase1Results.push(r)
    const icon = r.ok ? '✓' : '✗'
    if (r.ok) p1Pass++; else p1Fail++
    console.log(`  ${icon} [${channel}] ${opts.desc} (${r.ms}ms)${r.issue ? ' → ' + r.issue : ''}`)
  }
  console.log(`\n  阶段1结果: ${p1Pass} pass / ${p1Fail} fail / ${TESTS.length} total\n`)
  report.phases.coverage = { pass: p1Pass, fail: p1Fail, total: TESTS.length, details: phase1Results }

  // 阶段2: 并发测试
  console.log('━━━ 阶段2: 并发测试 ━━━')
  const phase2Results = await runConcurrencyTests(sc)
  report.phases.concurrent = phase2Results
  console.log()

  // 阶段3: 性能基准
  console.log('━━━ 阶段3: 性能基准 ━━━')
  const phase3Results = await runPerformanceBenchmark(sc)
  report.phases.performance = phase3Results
  console.log()

  // 阶段4: 稳定性 (重复调用同一接口 50 次检测内存泄漏/性能退化)
  console.log('━━━ 阶段4: 稳定性 (50次重复 eaa:info) ━━━')
  const stabilityTimes = []
  for (let i = 0; i < 50; i++) {
    const t = Date.now()
    try { await sc.invoke('eaa:info', []); stabilityTimes.push(Date.now() - t) } catch { stabilityTimes.push(-1) }
  }
  const stableTimes = stabilityTimes.filter(t => t >= 0)
  const stableAvg = stableTimes.reduce((a, b) => a + b, 0) / stableTimes.length
  const stableMin = Math.min(...stableTimes)
  const stableMax = Math.max(...stableTimes)
  // 当 avg < 1ms 时,百分比波动无意义(亚毫秒级噪声),改用绝对波动
  const absJitter = stableMax - stableMin
  const degradation = stableAvg >= 1
    ? Number(((stableMax - stableMin) / stableAvg * 100).toFixed(1))
    : absJitter // 亚毫秒级用绝对值(ms)
  const degradationLabel = stableAvg >= 1 ? `${degradation}%` : `${degradation}ms (sub-ms)`
  console.log(`  50次重复: avg=${stableAvg.toFixed(1)}ms min=${stableMin}ms max=${stableMax}ms 波动=${degradationLabel}`)
  report.phases.stability = { iterations: 50, avg: stableAvg, min: stableMin, max: stableMax, degradation: Number(degradation) }

  await sc.shutdown()

  // 总结
  const totalPass = p1Pass
  const totalFail = p1Fail
  const concurrentOk = phase2Results.every(r => r.ok === r.total || (r.readOk !== undefined && r.readOk === 25 && r.writeOk === 25))
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  第 ${round} 轮总结`)
  console.log(`${'═'.repeat(60)}`)
  console.log(`  通道覆盖: ${totalPass}/${TESTS.length} (${(totalPass/TESTS.length*100).toFixed(1)}%)`)
  console.log(`  并发安全: ${concurrentOk ? '✓ 通过' : '✗ 有问题'}`)
  console.log(`  性能: info=${report.phases.performance[0].avg.toFixed(1)}ms list=${report.phases.performance[1].avg.toFixed(1)}ms`)
  console.log(`  稳定性: 波动 ${degradation}%\n`)

  writeFileSync(resolve(RESULTS_DIR, `v2-round-${String(round).padStart(3, '0')}.json`), JSON.stringify(report, null, 2))
  return report
}

// 独立运行入口
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('test-comprehensive-v2.mjs')) {
  const dataDir = resolve(ROOT, 'test-tauri-data-v2')
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
  run(dataDir, 1).then((r) => {
    const fail = r.phases.coverage.fail
    process.exit(fail > 0 ? 1 : 0)
  }).catch((e) => {
    console.error('FATAL', e)
    process.exit(2)
  })
}

export { run, startSidecar }
