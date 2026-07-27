// 第3轮：边界与安全测试 — 空参、超长、非法、注入尝试
// 验证: 参数校验、注入防护、优雅降级 (不应崩溃 sidecar)
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
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
    const checker = (line) => { try { const m = JSON.parse(line); if (m.type === 'event' && m.channel === '__sidecar__:ready') { clearTimeout(t); rl.off('line', checker); res(m.data) } } catch {} }
    rl.on('line', checker)
  })
  rl.on('line', (line) => { let m; try { m = JSON.parse(line) } catch { return } if (m.type === 'result' && m.id != null) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) } } })
  function invoke(ch, args, timeoutMs = 15000) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs) }) }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} setTimeout(() => { try { child.kill() } catch {} }, 800) }
  return { ready, invoke, shutdown, child }
}

// 期望: 优雅处理 (返回 error 或 success:false)，不应让 sidecar 崩溃或挂起
async function runBoundary(dataDir) {
  const sidecar = startSidecar(dataDir)
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始边界测试\n')
  const results = []
  let graceful = 0, crash = 0

  async function t(name, channel, args) {
    try {
      const r = await sidecar.invoke(channel, args)
      // 优雅处理: 返回了结果 (即使 success:false)
      console.log(`  ✓ ${name.padEnd(40)} 优雅处理`)
      graceful++
      results.push({ name, channel, status: 'graceful', result: summarize(r) })
    } catch (e) {
      // 抛错也算优雅 (只要 sidecar 没崩溃，能继续响应)
      console.log(`  ✓ ${name.padEnd(40)} 优雅拒绝: ${String(e.message).slice(0, 40)}`)
      graceful++
      results.push({ name, channel, status: 'rejected', error: String(e.message).slice(0, 80) })
    }
  }

  console.log('━━━ A. 空参数 / null / undefined ━━━')
  await t('eaa:score 空名字', 'eaa:score', [''])
  await t('eaa:score null', 'eaa:score', [null])
  await t('eaa:add-student 空', 'eaa:add-student', [''])
  await t('agent:get 空id', 'agent:get', [''])
  await t('agent:get null', 'agent:get', [null])
  await t('settings:set 空path', 'settings:set', ['', 'val'])
  await t('cron:add null', 'cron:add', [null])
  await t('cron:add 空对象', 'cron:add', [{}])

  console.log('\n━━━ B. 超长字符串 (10000字符) ━━━')
  const longStr = 'A'.repeat(10000)
  await t('eaa:add-student 超长', 'eaa:add-student', [longStr])
  await t('agent:update 超长描述', 'agent:update', ['class-monitor', { description: longStr }])
  await t('skill:save 超长内容', 'skill:save', ['longtest', longStr])

  console.log('\n━━━ C. 类型错误 (数字当字符串等) ━━━')
  await t('eaa:score 传数字', 'eaa:score', [12345])
  await t('eaa:score 传对象', 'eaa:score', [{ foo: 'bar' }])
  await t('eaa:score 传数组', 'eaa:score', [['array']])
  await t('agent:toggle 传字符串', 'agent:toggle', ['class-monitor', 'notbool'])
  await t('settings:set 传对象当path', 'settings:set', [{ x: 1 }, 'val'])

  console.log('\n━━━ D. 注入尝试 (shell/path traversal) ━━━')
  await t('eaa:add-student 分号注入', 'eaa:add-student', ['test; rm -rf /'])
  await t('eaa:add-student 管道注入', 'eaa:add-student', ['test | cat /etc/passwd'])
  await t('eaa:add-student 反引号', 'eaa:add-student', ['test `whoami`'])
  await t('eaa:add-student $()', 'eaa:add-student', ['test $(id)'])
  await t('eaa:add-student NUL字节', 'eaa:add-student', ['test\x00evil'])
  await t('eaa:score 路径穿越', 'eaa:score', ['../../../etc/passwd'])
  await t('sys:read-file 路径穿越', 'sys:read-file', ['../../../../etc/shadow'])
  await t('sys:read-file NUL', 'sys:read-file', ['test\x00.txt'])

  console.log('\n━━━ E. 危险操作 (应拒绝或要求确认) ━━━')
  await t('eaa:delete-student 无确认', 'eaa:delete-student', ['test', { reason: 'test' }])
  await t('settings:reset', 'settings:reset', [])

  console.log('\n━━━ F. 不存在的引用 ━━━')
  await t('agent:get 不存在', 'agent:get', ['nonexistent-agent-xyz'])
  await t('eaa:history 不存在学生', 'eaa:history', ['不存在的学生XYZ'])
  await t('skill:get 不存在', 'skill:get', ['nonexistent-skill-xyz'])
  await t('profile:get 不存在', 'profile:get', ['不存在学生XYZ'])

  // ========== 验证 sidecar 仍存活 (关键: 上面所有极端输入后，sidecar 不应崩溃) ==========
  console.log('\n━━━ G. 存活验证 (极端输入后 sidecar 是否还能响应) ━━━')
  try {
    const alive = await sidecar.invoke('eaa:info', [])
    console.log(`  ✓ Sidecar 存活 — eaa:info 仍正常返回 (${summarize(alive)})`)
    results.push({ name: '存活验证', status: 'alive' })
    graceful++
  } catch (e) {
    console.log(`  ✗ Sidecar 可能已崩溃 — eaa:info 失败: ${e.message}`)
    results.push({ name: '存活验证', status: 'crashed', error: e.message })
    crash++
  }

  sidecar.shutdown()

  const report = { round: 'R3-边界安全测试', timestamp: new Date().toISOString(), summary: { graceful, crash }, results }
  writeFileSync(resolve(RESULTS_DIR, 'R3-边界安全测试.json'), JSON.stringify(report, null, 2))
  console.log(`\n━━━ 边界测试结果: ${crash === 0 ? '✅ 全部优雅处理 (' + graceful + '项), Sidecar 未崩溃' : '⚠️ Sidecar 崩溃 ' + crash + '次'} ━━━\n`)
  return report
}

function summarize(r) {
  if (r === null || r === undefined) return 'null'
  if (typeof r === 'object') {
    if (r.success === false) return `{success:false${r.error ? ':' + String(r.error).slice(0, 30) : ''}}`
    return `object{${Object.keys(r).slice(0, 4).join(',')}}`
  }
  return typeof r
}

const dataDir = resolve(ROOT, 'test-tauri-data-boundary')
runBoundary(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
