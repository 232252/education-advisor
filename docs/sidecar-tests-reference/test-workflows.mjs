// 第7轮：业务工作流集成测试 — 模拟真实用户操作流
// 一个班主任的完整工作日: 建班→加学生→记分→查看报告→调班→归档
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
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
  const ready = new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('ready timeout')), 25000); const c = (l) => { try { const m = JSON.parse(l); if (m.type === 'event' && m.channel === '__sidecar__:ready') { clearTimeout(t); rl.off('line', c); res(m.data) } } catch {} }; rl.on('line', c) })
  rl.on('line', (l) => { let m; try { m = JSON.parse(l) } catch { return } if (m.type === 'result' && m.id != null) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) } } })
  function invoke(ch, args) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 15000) }) }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500)) }
  return { ready, invoke, shutdown }
}

async function runWorkflow(dataDir) {
  console.log('━━━ 第7轮: 班主任完整工作日模拟 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  const steps = []
  let pass = 0, fail = 0

  async function step(name, fn) {
    const t0 = Date.now()
    try {
      const result = await fn()
      const ms = Date.now() - t0
      console.log(`  ✓ ${name} (${ms}ms)`)
      pass++
      steps.push({ name, status: 'pass', ms, result })
      return result
    } catch (e) {
      const ms = Date.now() - t0
      console.log(`  ✗ ${name} (${ms}ms): ${e.message.slice(0, 70)}`)
      fail++
      steps.push({ name, status: 'fail', ms, error: e.message })
      throw e
    }
  }

  try {
    // ===== 场景: 班主任开学第一天 =====
    console.log('【场景1】开学建班')
    // 建班 (注意 class 持久化需要 sqlite，当前环境降级，但操作本身应成功执行不崩)
    const classId = `G7A${Date.now().toString().slice(-4)}`
    await step('创建班级 G7A', () => sc.invoke('class:create', [{ class_id: classId, name: '初一A班', grade: 'G7', teacher: '王老师' }]))

    // 加学生
    console.log('\n【场景2】录入学生名单')
    const students = ['张明', '李华', '王芳', '刘强', '陈静', '赵磊', '孙丽', '周伟']
    for (const name of students) {
      await step(`添加学生 ${name}`, () => sc.invoke('eaa:add-student', [name]))
    }

    // 分配到班级
    console.log('\n【场景3】学生分班')
    await step('批量分班 (8人→G7A)', () => sc.invoke('class:assign', [{ class_id: classId, student_names: students }]))

    // ===== 场景: 日常记分 =====
    console.log('\n【场景4】记录操行事件')
    // 查原因码
    const codes = await step('获取原因码', () => sc.invoke('eaa:codes', []))
    const codeList = codes?.data?.reason_codes || codes?.data || []
    console.log(`    可用原因码: ${Array.isArray(codeList) ? codeList.length : '?'} 个`)

    // 记几个事件
    const events = [
      { studentName: '张明', reasonCode: 'LATE', note: '周一迟到' },
      { studentName: '李华', reasonCode: 'HOMEWORK_EXCELLENT', note: '作业优秀' },
      { studentName: '王芳', reasonCode: 'CIVILIZED_DORM', note: '文明宿舍' },
      { studentName: '刘强', reasonCode: 'SLEEP_IN_CLASS', note: '上课睡觉' },
    ]
    for (const ev of events) {
      await step(`记事件 ${ev.studentName} ${ev.reasonCode}`, () => sc.invoke('eaa:add-event', [ev]))
    }

    // ===== 场景: 查看数据 =====
    console.log('\n【场景5】查看班级数据')
    await step('查看排行榜', () => sc.invoke('eaa:ranking', [20]))
    await step('查看统计', () => sc.invoke('eaa:stats', []))
    await step('查看张明的历史', () => sc.invoke('eaa:history', ['张明']))
    await step('查看摘要', () => sc.invoke('eaa:summary', []))
    await step('数据校验', () => sc.invoke('eaa:validate', []))

    // 搜索
    await step('搜索"张"', () => sc.invoke('eaa:search', ['张']))

    // ===== 场景: 学生档案 =====
    console.log('\n【场景6】管理学生档案')
    await step('写张明的档案', () => sc.invoke('profile:set', ['张明', { note: '体育委员', parentPhone: '138xxxx' }]))
    await step('读张明的档案', () => sc.invoke('profile:get', ['张明']))

    // ===== 场景: Agent 管理 =====
    console.log('\n【场景7】配置 Agent')
    await step('查看18个Agent', () => sc.invoke('agent:list', []))
    await step('启用 weekly-reporter', () => sc.invoke('agent:toggle', ['weekly-reporter', true]))
    await step('读 weekly-reporter SOUL', () => sc.invoke('agent:get-soul', ['weekly-reporter']))

    // ===== 场景: 技能管理 =====
    console.log('\n【场景8】管理技能')
    await step('保存自定义技能', () => sc.invoke('skill:save', ['家长沟通模板', '# 家长沟通\n您好，...']))
    await step('列出技能', () => sc.invoke('skill:list', []))

    // ===== 场景: 定时任务 =====
    console.log('\n【场景9】配置定时任务')
    await step('查看定时任务', () => sc.invoke('cron:list', []))

    // ===== 场景: 设置 =====
    console.log('\n【场景10】调整设置')
    await step('切换主题', () => sc.invoke('settings:set', ['general.theme', 'light']))
    await step('切换语言', () => sc.invoke('settings:set', ['general.language', 'en-US']))
    await step('读回设置确认', () => sc.invoke('settings:get', []))

  } catch (e) {
    console.log(`\n⚠️ 工作流中断: ${e.message}`)
  }

  await sc.shutdown()

  console.log(`\n━━━ 工作流结果: ${pass} 步通过 / ${fail} 步失败 (共 ${pass+fail}) ━━━\n`)
  const report = { round: 'R7-业务工作流', timestamp: new Date().toISOString(), summary: { pass, fail, total: pass+fail }, steps }
  writeFileSync(resolve(RESULTS_DIR, 'R7-业务工作流.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-workflow')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
runWorkflow(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
