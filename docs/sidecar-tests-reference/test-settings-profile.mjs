// 设置持久化 + Profile + 隐私引擎测试 — 验证非EAA子系统的完整性
// 新角度: settings 节流保存 / profile CRUD / privacy 状态 / chat 持久化
// 注意: settings:set 签名是 (path: string, value: unknown),不是 ({key,value})
//       chat:save-message 签名是 (msg: {sessionId?, role, content, ...}),不是 (sessionId, msg)
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
  // invokeQuiet: 不抛异常,返回 {ok, data, error}
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

async function runSettingsProfileTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始设置+Profile+隐私测试\n')

  // ========== 测试1: Settings 基本读写 ==========
  console.log('━━━ 测试1: Settings 基本读写 ━━━')
  const get1 = await sidecar.invoke('settings:get', [])
  report(get1 != null && typeof get1 === 'object', `settings:get 初始值: ${get1 != null ? '成功' : '失败'}`)

  // settings:set 签名: (path: string, value: unknown)
  const set1 = await sidecar.invokeQuiet('settings:set', ['general.theme', 'light'])
  report(set1.ok && set1.data?.success !== false, `settings:set general.theme=light: ${set1.ok ? '成功' : set1.error}`)

  // 验证值已保存
  const get2 = await sidecar.invoke('settings:get', [])
  report(get2?.general?.theme === 'light', `settings:get 验证: general.theme=${get2?.general?.theme || '?'}`)

  // ========== 测试2: Settings 批量设置 (逐条) ==========
  console.log('\n━━━ 测试2: Settings 批量设置 (逐条) ━━━')
  const batchOps = [
    ['general.theme', 'dark'],
    ['general.language', 'en-US'],
    ['general.logLevel', 'warn'],
    ['general.autoStart', true],
    ['chat.thinkingLevel', 'high'],
  ]
  let batchOk = 0
  for (const [p, v] of batchOps) {
    const r = await sidecar.invokeQuiet('settings:set', [p, v])
    if (r.ok && r.data?.success !== false) batchOk++
  }
  report(batchOk === batchOps.length, `settings:set 批量: ${batchOk}/${batchOps.length} 成功`)

  const get3 = await sidecar.invoke('settings:get', [])
  report(get3?.general?.theme === 'dark' && get3?.general?.language === 'en-US',
    `settings:get 批量后验证: theme=${get3?.general?.theme}, lang=${get3?.general?.language}`)

  // ========== 测试3: Settings 快速连续更新 (节流测试) ==========
  console.log('\n━━━ 测试3: Settings 快速连续更新 (节流) ━━━')
  const t3a = Date.now()
  for (let i = 0; i < 20; i++) {
    await sidecar.invokeQuiet('settings:set', ['general.logLevel', i % 2 === 0 ? 'info' : 'warn'])
  }
  // 等待节流保存完成 (300ms debounce)
  await new Promise(r => setTimeout(r, 500))
  const t3b = Date.now() - t3a
  const get4 = await sidecar.invoke('settings:get', [])
  report(get4 != null, `20次快速设置后读取: ${get4 != null ? '成功' : '失败'} (${t3b}ms)`)

  // ========== 测试4: Settings 枚举校验 (非法值应被拒绝) ==========
  console.log('\n━━━ 测试4: Settings 枚举校验 ━━━')
  const badTheme = await sidecar.invokeQuiet('settings:set', ['general.theme', 'INVALID_THEME_XYZ'])
  report(badTheme.ok && badTheme.data?.success === false, `settings:set 非法theme被拒绝: ${badTheme.data?.success === false ? '是' : '否'}`)

  const badLevel = await sidecar.invokeQuiet('settings:set', ['general.logLevel', 'VERBOSE'])
  report(badLevel.ok && badLevel.data?.success === false, `settings:set 非法logLevel被拒绝: ${badLevel.data?.success === false ? '是' : '否'}`)

  // 非法路径 (typo 防护)
  const badPath = await sidecar.invokeQuiet('settings:set', ['general.nonExistentField', 'x'])
  report(badPath.ok === false || badPath.data?.success === false, `settings:set 非法路径被拒绝`)

  // ========== 测试5: Profile CRUD ==========
  console.log('\n━━━ 测试5: Profile CRUD ━━━')
  // 设置 profile
  const profileData = { name: '张三', grade: '七年级', class: '3班', age: 13 }
  const setP1 = await sidecar.invokeQuiet('profile:set', ['测试学生A', profileData])
  report(setP1.ok, `profile:set: ${setP1.ok ? '成功' : setP1.error}`)

  // 获取 profile
  const getP1 = await sidecar.invokeQuiet('profile:get', ['测试学生A'])
  report(getP1.ok && getP1.data?.success !== false, `profile:get: ${getP1.ok ? '成功' : getP1.error}`)

  // 更新 profile
  const setP2 = await sidecar.invokeQuiet('profile:set', ['测试学生A', { name: '张三', grade: '八年级' }])
  report(setP2.ok, `profile:set 更新: ${setP2.ok ? '成功' : setP2.error}`)

  // 获取不存在的 profile
  const getP2 = await sidecar.invokeQuiet('profile:get', ['不存在的学生XYZ'])
  report(getP2.ok, `profile:get 不存在: 返回成功 (data=${getP2.data?.data == null ? 'null' : '有值'})`)

  // 空 name (应被拒绝) — handler 不抛异常,返回 {success:false, error:...}
  const emptyName = await sidecar.invokeQuiet('profile:set', ['', { data: 'test' }])
  report(emptyName.data?.success === false, `profile:set 空名字被拒绝: ${emptyName.data?.success === false ? '是' : '否'}`)

  // null data (应被拒绝)
  const nullData = await sidecar.invokeQuiet('profile:set', ['test', null])
  report(nullData.data?.success === false, `profile:set null数据被拒绝: ${nullData.data?.success === false ? '是' : '否'}`)

  // ========== 测试6: Privacy 状态 ==========
  console.log('\n━━━ 测试6: Privacy 状态 ━━━')
  const privStatus = await sidecar.invokeQuiet('privacy:status', [])
  report(privStatus.ok, `privacy:status: ${privStatus.ok ? '成功' : privStatus.error}`)

  // ========== 测试7: Privacy dryrun ==========
  console.log('\n━━━ 测试7: Privacy dryrun ━━━')
  const dryrunRes = await sidecar.invokeQuiet('privacy:dryrun', ['这是一段包含张三的文本'])
  report(dryrunRes.ok, `privacy:dryrun: ${dryrunRes.ok ? '成功' : dryrunRes.error}`)

  // 空文本 (应失败)
  const emptyDry = await sidecar.invokeQuiet('privacy:dryrun', [''])
  report(emptyDry.ok === false, `privacy:dryrun 空文本被拒绝: ${emptyDry.ok === false ? '是' : '否'}`)

  // ========== 测试8: Chat 会话持久化 ==========
  console.log('\n━━━ 测试8: Chat 会话持久化 ━━━')
  // chat:save-message 签名: (msg: {sessionId?, role, content, ...})
  // 列出会话
  const list1 = await sidecar.invokeQuiet('chat:list-sessions', [])
  report(list1.ok, `chat:list-sessions: ${list1.ok ? '成功' : list1.error}`)

  // 保存消息
  const saveMsg1 = await sidecar.invokeQuiet('chat:save-message', [{ sessionId: 'session-test-1', role: 'user', content: '你好' }])
  report(saveMsg1.ok && saveMsg1.data?.success !== false, `chat:save-message #1: ${saveMsg1.ok ? '成功' : saveMsg1.error}`)

  // 保存更多消息
  const saveMsg2 = await sidecar.invokeQuiet('chat:save-message', [{ sessionId: 'session-test-1', role: 'assistant', content: '你好！有什么可以帮你的？' }])
  report(saveMsg2.ok, `chat:save-message #2: ${saveMsg2.ok ? '成功' : saveMsg2.error}`)

  const saveMsg3 = await sidecar.invokeQuiet('chat:save-message', [{ sessionId: 'session-test-1', role: 'user', content: '查询学生张三的分数' }])
  report(saveMsg3.ok, `chat:save-message #3: ${saveMsg3.ok ? '成功' : saveMsg3.error}`)

  // 加载消息
  const loadMsg = await sidecar.invokeQuiet('chat:load-messages', ['session-test-1'])
  report(loadMsg.ok && loadMsg.data?.success !== false, `chat:load-messages: ${loadMsg.ok ? '成功' : loadMsg.error}`)

  // 验证消息数量
  const msgCount = loadMsg.data?.messages?.length || 0
  report(msgCount === 3, `chat:load-messages 消息数: ${msgCount}/3`)

  // 删除会话
  const delSession = await sidecar.invokeQuiet('chat:delete-session', ['session-test-1'])
  report(delSession.ok, `chat:delete-session: ${delSession.ok ? '成功' : delSession.error}`)

  // 验证删除后消息为空
  const loadAfterDel = await sidecar.invokeQuiet('chat:load-messages', ['session-test-1'])
  const afterDelCount = loadAfterDel.data?.messages?.length || 0
  report(afterDelCount === 0, `chat:load-messages 删除后: ${afterDelCount} 条消息`)

  // ========== 测试9: Log 查询 ==========
  console.log('\n━━━ 测试9: Log 查询 ━━━')
  // log:list 签名: () — 无参数
  const logList = await sidecar.invokeQuiet('log:list', [])
  report(logList.ok, `log:list: ${logList.ok ? '成功' : logList.error}`)

  // ========== 测试10: Settings reset ==========
  console.log('\n━━━ 测试10: Settings reset ━━━')
  const resetRes = await sidecar.invokeQuiet('settings:reset', [])
  report(resetRes.ok && resetRes.data?.success !== false, `settings:reset: ${resetRes.ok ? '成功' : resetRes.error}`)

  const getAfterReset = await sidecar.invoke('settings:get', [])
  // reset 后 theme 应回到 DEFAULT_SETTINGS 中的默认值 light (见 settings-service.ts:21)
  report(getAfterReset?.general?.theme === 'light', `settings:get reset后: theme=${getAfterReset?.general?.theme} (应=light 默认值)`)

  // ========== 测试11: 跨调用一致性 ==========
  console.log('\n━━━ 测试11: 跨调用一致性 ━━━')
  // 设置 profile 后立即获取,验证一致性
  await sidecar.invokeQuiet('profile:set', ['一致性测试', { value: 42 }])
  const prof1 = await sidecar.invokeQuiet('profile:get', ['一致性测试'])
  await sidecar.invokeQuiet('profile:set', ['一致性测试', { value: 100 }])
  const prof2 = await sidecar.invokeQuiet('profile:get', ['一致性测试'])
  const v1 = prof1.data?.data?.value ?? prof1.data?.value
  const v2 = prof2.data?.data?.value ?? prof2.data?.value
  report(v1 === 42 && v2 === 100, `Profile 跨调用一致性: ${v1} → ${v2}`)

  // ========== 测试12: 非法 Settings 路径注入防护 ==========
  console.log('\n━━━ 测试12: 非法 Settings 路径注入防护 ━━━')
  // 空路径 — handler 不抛异常,返回 {success:false, error}
  const emptyPath = await sidecar.invokeQuiet('settings:set', ['', 'x'])
  report(emptyPath.data?.success === false, `settings:set 空路径被拒绝: ${emptyPath.data?.success === false ? '是' : '否'}`)

  // 非字符串路径
  const objPath = await sidecar.invokeQuiet('settings:set', [{ key: 'x' }, 'val'])
  report(objPath.data?.success === false, `settings:set 对象路径被拒绝: ${objPath.data?.success === false ? '是' : '否'}`)

  // 最终: sidecar 正常响应
  const finalCheck = await sidecar.invokeQuiet('eaa:info', [])
  report(finalCheck.ok && finalCheck.data?.success === true, '子系统测试后 sidecar 正常响应')

  sidecar.shutdown()

  const testResults = {
    round: '设置+Profile+隐私测试',
    timestamp: new Date().toISOString(),
    summary: { pass: passCount, fail: failCount },
  }
  writeFileSync(resolve(RESULTS_DIR, 'settings-profile-results.json'), JSON.stringify(testResults, null, 2))
  console.log(`\n━━━ 结果: ${passCount}通过 / ${failCount}失败 ━━━\n`)
}

const dataDir = resolve(ROOT, `test-tauri-data-settings-profile-${Date.now()}`)
runSettingsProfileTest(dataDir).then(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(failCount > 0 ? 1 : 0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
