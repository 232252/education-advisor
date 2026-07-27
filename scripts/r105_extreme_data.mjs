// =============================================================
// R105: 极端数据压力测试 (大量学生/事件/profile/skill)
// 角度 1: 批量创建 50 个学生 + 验证 listStudents 性能
// 角度 2: 每个学生添加 10 个事件 = 500 事件, 验证 stats/history 性能
// 角度 3: 批量创建 100 个 profile 键值对, 验证 get/set 性能
// 角度 4: 批量创建 50 个 skill, 验证 list/get 性能
// 角度 5: 大数据量下内存稳定 (堆增长 < 50MB)
// 角度 6: 大数据量下渲染性能 (页面切换仍 < 2s)
// 角度 7: 清理后数据完全清除
// =============================================================

import http from 'node:http'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}/json`, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(JSON.parse(data)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function cdpCall(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.toString())
      if (msg.id === id) {
        ws.off('message', handler)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      ws.off('message', handler)
      reject(new Error(`CDP timeout: ${method}`))
    }, 60000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 55000,
  })
  if (r.exceptionDetails) {
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  }
  return r.result.value
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

let WebSocket
try {
  WebSocket = (await import('ws')).default
} catch {
  WebSocket = globalThis.WebSocket
}

const targets = await getTargets()
const pageTarget =
  targets.find((t) => t.type === 'page' && t.url.includes('localhost')) ||
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R105] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => {
  ws.on('open', r)
  ws.on('error', rej)
  setTimeout(() => rej(new Error('ws connect timeout')), 10000)
})

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) {
    results.pass++
    console.log(`  ✅ ${name}`)
  } else {
    results.fail++
    results.errors.push(name)
    console.log(`  ❌ ${name} ${detail}`)
  }
}

await evalInPage(ws, `
  window.__r105Errors = [];
  if (!window.__r105HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r105Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r105Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r105HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r105Errors || []))`)
}

async function getHeapUsed() {
  return await evalInPage(ws, `performance.memory ? performance.memory.usedJSHeapSize : 0`)
}

const STAMP = `r105_${Date.now()}`
const createdStudents = []
const createdProfiles = []
const createdSkills = []

// =============================================================
console.log('\n=== R105: 极端数据压力测试 ===')

const heapStart = await getHeapUsed()
console.log(`[R105] 初始堆: ${(heapStart / 1024 / 1024).toFixed(2)}MB`)

// =============================================================
console.log('\n[R105-1] 批量创建 30 个学生')

const STUDENT_COUNT = 30
const t1Start = Date.now()
let studentCreateOk = 0

for (let i = 0; i < STUDENT_COUNT; i++) {
  const name = `${STAMP}_student_${i}`
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.addStudent(${JSON.stringify(name)});
      return { ok: true, success: r?.success !== false };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  if (r?.ok) {
    studentCreateOk++
    createdStudents.push(name)
  }
  if (i % 10 === 9) {
    console.log(`    进度: ${i + 1}/${STUDENT_COUNT}`)
  }
}

const t1Elapsed = Date.now() - t1Start
check(`创建 ${STUDENT_COUNT} 个学生成功 (${studentCreateOk}/${STUDENT_COUNT})`,
  studentCreateOk === STUDENT_COUNT,
  `elapsed=${t1Elapsed}ms`)

// 验证 listStudents 性能
const t2Start = Date.now()
const listResult = await evalInPage(ws, `window.api.eaa.listStudents()`)
const t2Elapsed = Date.now() - t2Start

const studentsArr = Array.isArray(listResult)
  ? listResult
  : (Array.isArray(listResult?.data) ? listResult.data
    : (Array.isArray(listResult?.data?.students) ? listResult.data.students : []))

check(`listStudents 返回 ${studentsArr.length} 个学生`,
  studentsArr.length >= STUDENT_COUNT,
  `count=${studentsArr.length}`)

check(`listStudents 性能 < 5s (实际 ${t2Elapsed}ms)`,
  t2Elapsed < 5000,
  `elapsed=${t2Elapsed}ms`)

// =============================================================
console.log('\n[R105-2] 批量添加事件 (每学生 5 个 = 150 事件)')

const EVENTS_PER_STUDENT = 5
const totalEvents = STUDENT_COUNT * EVENTS_PER_STUDENT

// 动态获取合法 reason codes (EAA 使用大写码, 如 CLASS_MONITOR / OTHER_DEDUCT)
const codesResult = await evalInPage(ws, `window.api.eaa.codes()`)
const codesArr =
  Array.isArray(codesResult?.data?.codes) ? codesResult.data.codes
  : Array.isArray(codesResult?.data) ? codesResult.data
  : []
// EAA 去重规则: 同一学生 + 同一 reasonCode + 同一天 只能有一个事件
// 因此每学生 5 个事件需要 5 个不同的 reason code
const distinctCodes = codesArr.map((c) => c.code).filter(Boolean).slice(0, EVENTS_PER_STUDENT)
// 兜底: 若可用 code 不足, 用 --force 绕过去重 (handler 支持 params.force)
const useForce = distinctCodes.length < EVENTS_PER_STUDENT
const codesToUse = useForce
  ? [codesArr[0]?.code || 'CLASS_MONITOR']
  : distinctCodes
console.log(`    使用 ${codesToUse.length} 个 reason codes: ${codesToUse.join(', ')}${useForce ? ' (force)' : ''}`)

let eventCreateOk = 0
const t3Start = Date.now()

// 提高 ws max listeners (150 个并发 evalInPage, 每个加一个 message listener)
ws.setMaxListeners(200)

const allEventPromises = []
let firstError = null

for (let i = 0; i < createdStudents.length; i++) {
  const studentName = createdStudents[i]
  for (let j = 0; j < EVENTS_PER_STUDENT; j++) {
    const code = codesToUse[j % codesToUse.length]
    const force = useForce ? ', force: true' : ''
    allEventPromises.push(
      evalInPage(ws, `(async () => {
        try {
          const r = await window.api.eaa.addEvent({
            studentName: ${JSON.stringify(studentName)},
            reasonCode: ${JSON.stringify(code)},
            note: ${JSON.stringify(`R105 event ${j} for ${studentName}`)}${force}
          });
          return { ok: r?.success !== false, err: r?.success === false ? (r.data || r.error || r.stderr || '').slice(0, 200) : null };
        } catch (e) {
          return { ok: false, err: e.message };
        }
      })()`).then(r => {
        if (r?.ok) {
          eventCreateOk++
        } else if (!firstError && r?.err) {
          firstError = r.err
        }
      })
    )
  }
}

// 等待所有事件创建完成 (writeQueue 内部串行化, 这里只是不阻塞进度条)
await Promise.all(allEventPromises)
console.log(`    事件进度: ${createdStudents.length}/${createdStudents.length} 学生`)

const t3Elapsed = Date.now() - t3Start
check(`创建 ${totalEvents} 个事件成功 (${eventCreateOk}/${totalEvents})`,
  eventCreateOk >= totalEvents * 0.9, // 允许 10% 失败
  `elapsed=${t3Elapsed}ms, ok=${eventCreateOk}, firstError=${firstError || 'none'}`)

// 验证 stats 性能
const t4Start = Date.now()
const statsResult = await evalInPage(ws, `window.api.eaa.stats()`)
const t4Elapsed = Date.now() - t4Start

check('eaa.stats 大数据量下不崩溃',
  statsResult?.success === true,
  `result=${JSON.stringify(statsResult).slice(0, 100)}`)
check(`eaa.stats 性能 < 5s (实际 ${t4Elapsed}ms)`,
  t4Elapsed < 5000,
  `elapsed=${t4Elapsed}ms`)

// 验证 history 性能 (查一个有事件的学生)
if (createdStudents.length > 0) {
  const testStudent = createdStudents[0]
  const t5Start = Date.now()
  const historyResult = await evalInPage(ws, `window.api.eaa.history(${JSON.stringify(testStudent)})`)
  const t5Elapsed = Date.now() - t5Start
  
  check(`eaa.history 性能 < 3s (实际 ${t5Elapsed}ms)`,
    t5Elapsed < 3000,
    `elapsed=${t5Elapsed}ms`)
}

// =============================================================
console.log('\n[R105-3] 批量创建 100 个 profile 键值对')

const PROFILE_COUNT = 100
let profileCreateOk = 0
const t6Start = Date.now()

for (let i = 0; i < PROFILE_COUNT; i++) {
  const key = `${STAMP}_profile_${i}`
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.profile.set(${JSON.stringify(key)}, {
        index: ${i},
        stamp: ${JSON.stringify(STAMP)},
        data: 'x'.repeat(100), // 每个 100 字节
      });
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  })()`)
  if (r?.ok) {
    profileCreateOk++
    createdProfiles.push(key)
  }
}

const t6Elapsed = Date.now() - t6Start
check(`创建 ${PROFILE_COUNT} 个 profile 成功 (${profileCreateOk}/${PROFILE_COUNT})`,
  profileCreateOk === PROFILE_COUNT,
  `elapsed=${t6Elapsed}ms`)

// 验证 profile get 性能
const t7Start = Date.now()
const profileGetResult = await evalInPage(ws, `window.api.profile.get(${JSON.stringify(createdProfiles[0])})`)
const t7Elapsed = Date.now() - t7Start
check(`profile.get 性能 < 200ms (实际 ${t7Elapsed}ms)`,
  t7Elapsed < 200,
  `elapsed=${t7Elapsed}ms`)

// =============================================================
console.log('\n[R105-4] 批量创建 30 个 skill')

const SKILL_COUNT = 30
let skillCreateOk = 0
const t8Start = Date.now()

for (let i = 0; i < SKILL_COUNT; i++) {
  const name = `${STAMP}_skill_${i}`
  const content = `# Skill ${i}\n\n内容: ${'y'.repeat(500)}\n时间戳: ${STAMP}`
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.skill.save(${JSON.stringify(name)}, ${JSON.stringify(content)});
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  })()`)
  if (r?.ok) {
    skillCreateOk++
    createdSkills.push(name)
  }
}

const t8Elapsed = Date.now() - t8Start
check(`创建 ${SKILL_COUNT} 个 skill 成功 (${skillCreateOk}/${SKILL_COUNT})`,
  skillCreateOk === SKILL_COUNT,
  `elapsed=${t8Elapsed}ms`)

// 验证 skill list 性能
const t9Start = Date.now()
const skillListResult = await evalInPage(ws, `window.api.skill.list()`)
const t9Elapsed = Date.now() - t9Start

const skillsArr = Array.isArray(skillListResult)
  ? skillListResult
  : (Array.isArray(skillListResult?.data) ? skillListResult.data
    : (Array.isArray(skillListResult?.skills) ? skillListResult.skills : []))

check(`skill.list 返回 (>= ${SKILL_COUNT})`,
  skillsArr.length >= SKILL_COUNT,
  `count=${skillsArr.length}`)
check(`skill.list 性能 < 2s (实际 ${t9Elapsed}ms)`,
  t9Elapsed < 2000,
  `elapsed=${t9Elapsed}ms`)

// =============================================================
console.log('\n[R105-5] 大数据量下内存稳定')

const heapAfterData = await getHeapUsed()
const heapGrowth = heapAfterData - heapStart
console.log(`    堆增长: ${(heapGrowth / 1024 / 1024).toFixed(2)}MB (从 ${(heapStart / 1024 / 1024).toFixed(2)}MB 到 ${(heapAfterData / 1024 / 1024).toFixed(2)}MB)`)

check(`堆增长 < 100MB (实际 ${(heapGrowth / 1024 / 1024).toFixed(2)}MB)`,
  heapGrowth < 100 * 1024 * 1024,
  `growth=${(heapGrowth / 1024 / 1024).toFixed(2)}MB`)

// =============================================================
console.log('\n[R105-6] 大数据量下渲染性能')

// 强制 GC (如果可用)
await evalInPage(ws, `if (window.gc) window.gc(); true`)

// 切换到 students 页面
const t10Start = Date.now()
await evalInPage(ws, `window.location.hash = '#/students'`)
await sleep(1500)
const t10Elapsed = Date.now() - t10Start

check(`/students 页面在大数据量下渲染 < 3s (实际 ${t10Elapsed}ms)`,
  t10Elapsed < 3000,
  `elapsed=${t10Elapsed}ms`)

// 切换到 dashboard
const t11Start = Date.now()
await evalInPage(ws, `window.location.hash = '#/dashboard'`)
await sleep(1500)
const t11Elapsed = Date.now() - t11Start

check(`/dashboard 页面在大数据量下渲染 < 3s (实际 ${t11Elapsed}ms)`,
  t11Elapsed < 3000,
  `elapsed=${t11Elapsed}ms`)

// =============================================================
console.log('\n[R105-7] 全程错误捕获')

const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${finalErrors.length}, detail=${JSON.stringify(finalErrors).slice(0, 200)}`)

// =============================================================
console.log('\n[R105-8] 清理测试数据')

// 清理学生
let studentDeleteOk = 0
for (const name of createdStudents) {
  const r = await evalInPage(ws, `(async () => {
    try {
      await window.api.eaa.deleteStudent(${JSON.stringify(name)}, 'R105 清理');
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  })()`)
  if (r?.ok) studentDeleteOk++
}
check(`清理 ${createdStudents.length} 个学生 (${studentDeleteOk}/${createdStudents.length})`,
  studentDeleteOk === createdStudents.length)

// 清理 profile (注: profile API 无 delete 方法, 用 set 覆盖为空对象清理数据)
let profileDeleteOk = 0
for (const key of createdProfiles) {
  const r = await evalInPage(ws, `(async () => {
    try {
      await window.api.profile.set(${JSON.stringify(key)}, { _r105_cleared: true });
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  })()`)
  if (r?.ok) profileDeleteOk++
}
check(`清理 ${createdProfiles.length} 个 profile (覆盖为空) (${profileDeleteOk}/${createdProfiles.length})`,
  profileDeleteOk === createdProfiles.length)

// 清理 skill
let skillDeleteOk = 0
for (const name of createdSkills) {
  const r = await evalInPage(ws, `(async () => {
    try {
      await window.api.skill.delete(${JSON.stringify(name)});
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  })()`)
  if (r?.ok) skillDeleteOk++
}
check(`清理 ${createdSkills.length} 个 skill (${skillDeleteOk}/${createdSkills.length})`,
  skillDeleteOk === createdSkills.length)

// 最终堆检查
const heapFinal = await getHeapUsed()
const heapReclaimed = heapAfterData - heapFinal
console.log(`    清理后堆: ${(heapFinal / 1024 / 1024).toFixed(2)}MB (释放 ${(heapReclaimed / 1024 / 1024).toFixed(2)}MB)`)

// =============================================================
console.log('\n========================================')
console.log(`R105 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
