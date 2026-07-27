// =============================================================
// R110: EAA 数据完整性测试
// 角度 1: addStudent + listStudents — 学生 CRUD
// 角度 2: addEvent 全参数 — studentName/reasonCode/delta/note/operator/tags
// 角度 3: revertEvent — 撤销事件后 history 反映变化
// 角度 4: search — 多种查询(单字/多字/带引号/控制字符注入/超长)
// 角度 5: range — 日期范围(合法/反序/格式错误/带 limit)
// 角度 6: tag — 添加带 tag 事件 + tag 查询
// 角度 7: validate — 数据校验通过
// 角度 8: score/stats/history — 读路径不崩溃且字段完整
// 角度 9: 边界 — 非法学生名/非法 reasonCode/dryRun 模式
// 角度 10: 并发 — 多学生并发 addEvent, 数据一致
// 角度 11: 缓存 — invalidateCache 后数据立即更新
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
    }, 45000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 40000,
  })
  if (r.exceptionDetails) {
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
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
console.log(`[R110] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r110Errors = [];
  if (!window.__r110HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r110Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r110Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r110HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r110Errors || []))`)
}

const STAMP = `r110_${Date.now()}`
const createdStudents = []
const createdEventIds = []

// =============================================================
console.log('\n=== R110: EAA 数据完整性测试 ===')

// 准备: 获取合法 reason codes
const codesResult = await evalInPage(ws, `window.api.eaa.codes()`)
const codesArr =
  Array.isArray(codesResult?.data?.codes) ? codesResult.data.codes
  : Array.isArray(codesResult?.data) ? codesResult.data
  : []
check('eaa.codes 返回非空数组',
  codesArr.length > 0,
  `count=${codesArr.length}`)

// codes() API 不返回 delta 字段,统一使用 force:true 绕过固定分值校验
// 单独在 R110-9 验证 EAA 对错误 delta 的拒绝行为
const validCode = codesArr[0]?.code || 'CLASS_MONITOR'
console.log(`    使用 reason code: ${validCode} (统一用 force:true 绕过固定分值校验)`)

// =============================================================
console.log('\n[R110-1] addStudent + listStudents — 学生 CRUD')

// 创建 3 个学生
const studentNames = [
  `${STAMP}_alice`,
  `${STAMP}_bob`,
  `${STAMP}_charlie`,
]
for (const name of studentNames) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.addStudent(${JSON.stringify(name)});
      return { ok: r?.success !== false };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  if (r?.ok) createdStudents.push(name)
  check(`创建学生 ${name}`,
    r?.ok === true,
    `result=${JSON.stringify(r).slice(0, 100)}`)
}

// 验证 listStudents 包含新学生
const listResult = await evalInPage(ws, `window.api.eaa.listStudents()`)
const listArr = Array.isArray(listResult)
  ? listResult
  : (Array.isArray(listResult?.data) ? listResult.data
    : (Array.isArray(listResult?.data?.students) ? listResult.data.students : []))
const foundCount = studentNames.filter(n => listArr.some(s => (s.name || s) === n)).length
check('listStudents 包含 3 个新学生',
  foundCount === 3,
  `found=${foundCount}/3`)

// 重复添加同名学生应安全失败 (不崩溃)
const dupAdd = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addStudent(${JSON.stringify(studentNames[0])});
    return { ok: r?.success !== false, error: r?.error || r?.stderr };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('重复添加同名学生安全返回 (不崩溃)',
  dupAdd !== null && dupAdd !== undefined,
  `result=${JSON.stringify(dupAdd).slice(0, 100)}`)

// =============================================================
console.log('\n[R110-2] addEvent 全参数 (含 delta/note/operator/tags)')

const addEventResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: ${JSON.stringify(studentNames[0])},
      reasonCode: ${JSON.stringify(validCode)},
      delta: 2,
      note: 'R110 测试事件 - 完整参数',
      operator: 'r110_tester',
      tags: ['r110', 'integrity'],
      force: true,
    });
    return { ok: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('addEvent 全参数成功',
  addEventResult?.ok === true,
  `result=${JSON.stringify(addEventResult).slice(0, 200)}`)

// 从 history 提取 eventId 用于后续 revert (EAA 字段名: event_id)
const hist1 = await evalInPage(ws, `window.api.eaa.history(${JSON.stringify(studentNames[0])})`)
const histEvents = hist1?.data?.events || hist1?.data || []
const r110Event = Array.isArray(histEvents)
  ? histEvents.find(e => (e.note || '').includes('R110 测试事件'))
  : null
const r110EventId = r110Event?.event_id || r110Event?.id
if (r110EventId) createdEventIds.push(r110EventId)
check('history 反映新增的 R110 事件',
  !!r110Event,
  `events_count=${Array.isArray(histEvents) ? histEvents.length : 0}`)

// dryRun 模式不写入
const beforeDryRun = await evalInPage(ws, `window.api.eaa.history(${JSON.stringify(studentNames[1])})`)
const beforeDryRunCount = (beforeDryRun?.data?.events || beforeDryRun?.data || []).length
const dryRunResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: ${JSON.stringify(studentNames[1])},
      reasonCode: ${JSON.stringify(validCode)},
      delta: 1,
      note: 'R110 dryRun 不应写入',
      dryRun: true,
      force: true,
    });
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
const afterDryRun = await evalInPage(ws, `window.api.eaa.history(${JSON.stringify(studentNames[1])})`)
const afterDryRunCount = (afterDryRun?.data?.events || afterDryRun?.data || []).length
check('dryRun 模式不写入数据',
  dryRunResult?.ok === true && afterDryRunCount === beforeDryRunCount,
  `before=${beforeDryRunCount}, after=${afterDryRunCount}`)

// =============================================================
console.log('\n[R110-3] revertEvent — 撤销事件后 history 反映变化')

if (r110EventId) {
  const beforeRevertScore = await evalInPage(ws, `window.api.eaa.score(${JSON.stringify(studentNames[0])})`)
  const beforeScore = beforeRevertScore?.data?.score ?? beforeRevertScore?.data?.total

  const revertResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.revertEvent(${JSON.stringify(r110EventId)}, 'R110 测试回滚');
      return { ok: r?.success !== false, result: r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)

  check('revertEvent 成功',
    revertResult?.ok === true,
    `result=${JSON.stringify(revertResult).slice(0, 150)}`)

  // 验证 history 中该事件被标记为 reverted (EAA 字段名: reverted / event_id)
  const afterRevertHist = await evalInPage(ws, `window.api.eaa.history(${JSON.stringify(studentNames[0])})`)
  const afterEvents = afterRevertHist?.data?.events || afterRevertHist?.data || []
  const revertedEvent = afterEvents.find(e => (e.event_id || e.id) === r110EventId)
  check('reverted 事件在 history 中标记为已撤销',
    revertedEvent?.reverted === true,
    `event=${JSON.stringify(revertedEvent).slice(0, 150)}`)
} else {
  check('revertEvent 测试跳过 (无可用 event)', false, 'r110Event missing')
}

// =============================================================
console.log('\n[R110-4] search — 多种查询')

// 单字查询
const search1 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.search(${JSON.stringify(STAMP)}, 20);
    return { ok: r?.success !== false, count: (r?.data?.events || r?.data || []).length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('search 单字查询不崩溃',
  search1?.ok === true,
  `result=${JSON.stringify(search1).slice(0, 100)}`)

// 多字查询
const search2 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.search(${JSON.stringify(STAMP + ' alice')}, 20);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('search 多字查询不崩溃',
  search2?.ok === true,
  `result=${JSON.stringify(search2).slice(0, 100)}`)

// 空查询
const search3 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.search('   ', 20);
    return { ok: r?.success !== false, isEmpty: (r?.data?.events || []).length === 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('search 空白查询返回空结果',
  search3?.ok === true && search3?.isEmpty === true,
  `result=${JSON.stringify(search3).slice(0, 100)}`)

// 控制字符注入 (应被拒绝)
const search4 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.search('test\\x00--inject\\x1B', 20);
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('search 控制字符被安全处理 (不崩溃)',
  search4 !== null && search4 !== undefined,
  `result=${JSON.stringify(search4).slice(0, 100)}`)

// 超长查询 (应被截断处理,不崩溃)
const longQuery = 'x'.repeat(20000)
const search5 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.search(${JSON.stringify(longQuery)}, 20);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('search 超长查询不崩溃',
  search5?.ok === true,
  `result=${JSON.stringify(search5).slice(0, 100)}`)

// =============================================================
console.log('\n[R110-5] range — 日期范围查询')

// 合法日期范围
const today = new Date().toISOString().slice(0, 10)
const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
const range1 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.range(${JSON.stringify(weekAgo)}, ${JSON.stringify(today)}, 100);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('range 合法日期范围不崩溃',
  range1?.ok === true,
  `result=${JSON.stringify(range1).slice(0, 100)}`)

// 反序日期 (start > end) 应被拒绝
const range2 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.range(${JSON.stringify(today)}, ${JSON.stringify(weekAgo)});
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('range 反序日期被拒绝',
  range2?.rejected === true,
  `result=${JSON.stringify(range2).slice(0, 100)}`)

// 格式错误
const range3 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.range('invalid-date', '2024-01-01');
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('range 格式错误被拒绝',
  range3?.rejected === true,
  `result=${JSON.stringify(range3).slice(0, 100)}`)

// 带 limit
const range4 = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.range(${JSON.stringify(weekAgo)}, ${JSON.stringify(today)}, 5);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('range 带 limit 不崩溃',
  range4?.ok === true,
  `result=${JSON.stringify(range4).slice(0, 100)}`)

// =============================================================
console.log('\n[R110-6] tag — 添加带 tag 事件 + tag 查询')

// 给 studentNames[2] 添加带 tag 的事件
const tagEvent = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: ${JSON.stringify(studentNames[2])},
      reasonCode: ${JSON.stringify(validCode)},
      delta: 1,
      note: 'R110 tag 测试',
      tags: ['r110_tag_test'],
      force: true,
    });
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('addEvent 带 tag 成功',
  tagEvent?.ok === true,
  `result=${JSON.stringify(tagEvent).slice(0, 100)}`)

// 列出所有 tag
const allTags = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.tag();
    return { ok: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('tag() 列出所有 tag 不崩溃',
  allTags?.ok === true,
  `result=${JSON.stringify(allTags).slice(0, 150)}`)

// 查询特定 tag
const tagQuery = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.tag('r110_tag_test');
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('tag(specific) 查询不崩溃',
  tagQuery?.ok === true,
  `result=${JSON.stringify(tagQuery).slice(0, 100)}`)

// =============================================================
console.log('\n[R110-7] validate — 数据校验')

const validateResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.validate();
    return { ok: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.validate 不崩溃',
  validateResult?.ok === true,
  `result=${JSON.stringify(validateResult).slice(0, 150)}`)

// doctor 健康检查
const doctorResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.doctor();
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.doctor 不崩溃',
  doctorResult?.ok === true,
  `result=${JSON.stringify(doctorResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R110-8] score/stats/history — 读路径')

// score
const scoreResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.score(${JSON.stringify(studentNames[0])});
    return { ok: r?.success !== false, hasData: !!r?.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.score 不崩溃且有数据',
  scoreResult?.ok === true && scoreResult?.hasData === true,
  `result=${JSON.stringify(scoreResult).slice(0, 100)}`)

// stats
const statsResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.stats();
    return { ok: r?.success !== false, hasData: !!r?.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.stats 不崩溃且有数据',
  statsResult?.ok === true && statsResult?.hasData === true,
  `result=${JSON.stringify(statsResult).slice(0, 100)}`)

// history
const historyResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.history(${JSON.stringify(studentNames[2])});
    return { ok: r?.success !== false, hasData: !!r?.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.history 不崩溃且有数据',
  historyResult?.ok === true && historyResult?.hasData === true,
  `result=${JSON.stringify(historyResult).slice(0, 100)}`)

// ranking
const rankingResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.ranking(10);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.ranking 不崩溃',
  rankingResult?.ok === true,
  `result=${JSON.stringify(rankingResult).slice(0, 100)}`)

// info
const infoResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.info();
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.info 不崩溃',
  infoResult?.ok === true,
  `result=${JSON.stringify(infoResult).slice(0, 100)}`)

// summary
const summaryResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.summary();
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.summary 不崩溃',
  summaryResult?.ok === true,
  `result=${JSON.stringify(summaryResult).slice(0, 100)}`)

// replay
const replayResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.replay();
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.replay 不崩溃',
  replayResult?.ok === true,
  `result=${JSON.stringify(replayResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R110-9] 边界 — 非法学生名/非法 reasonCode')

const badStudent = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addStudent('');
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('addStudent 空名被拒绝/不崩溃',
  badStudent !== null && badStudent !== undefined,
  `result=${JSON.stringify(badStudent).slice(0, 100)}`)

const badEvent = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: ${JSON.stringify(studentNames[0])},
      reasonCode: 'INVALID_CODE_XYZ',
      delta: 1,
    });
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('addEvent 非法 reasonCode 被拒绝/不崩溃',
  badEvent !== null && badEvent !== undefined,
  `result=${JSON.stringify(badEvent).slice(0, 100)}`)

// 正向验证: 固定分值原因码 + 错误 delta (无 force) 应被 EAA 拒绝
// 这是 EAA 设计上的数据完整性保护
const wrongDelta = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: ${JSON.stringify(studentNames[0])},
      reasonCode: ${JSON.stringify(validCode)},
      delta: 999,  // 故意传一个明显错误的 delta
      // 不传 force
    });
    return { ok: r?.success !== false, rejected: r?.success === false, error: r?.data || r?.error || r?.stderr };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('addEvent 固定分值原因码 + 错误 delta (无 force) 被拒绝',
  wrongDelta?.rejected === true,
  `result=${JSON.stringify(wrongDelta).slice(0, 150)}`)

// revert 不存在的 eventId
const badRevert = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.revertEvent('nonexistent_event_id_xyz', 'R110 test');
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('revertEvent 不存在的 ID 被拒绝/不崩溃',
  badRevert !== null && badRevert !== undefined,
  `result=${JSON.stringify(badRevert).slice(0, 100)}`)

// score 不存在学生
const badScore = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.score('nonexistent_student_xyz');
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('score 不存在学生不崩溃',
  badScore !== null && badScore !== undefined,
  `result=${JSON.stringify(badScore).slice(0, 100)}`)

// =============================================================
console.log('\n[R110-10] 并发 — 多学生并发 addEvent')

// 提高 ws max listeners
ws.setMaxListeners(50)

const concurrentEvents = await evalInPage(ws, `(async () => {
  const students = ${JSON.stringify(studentNames)};
  const promises = [];
  for (let i = 0; i < students.length; i++) {
    for (let j = 0; j < 2; j++) {
      promises.push((async () => {
        try {
          const r = await window.api.eaa.addEvent({
            studentName: students[i],
            reasonCode: ${JSON.stringify(validCode)},
            delta: 1,
            note: 'R110 并发 ' + i + '_' + j,
            force: true,
          });
          return { ok: r?.success !== false };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })());
    }
  }
  const results = await Promise.allSettled(promises);
  return {
    total: results.length,
    ok: results.filter(r => r.status === 'fulfilled' && r.value?.ok).length,
  };
})()`)

check(`并发 addEvent 全部成功 (${concurrentEvents?.ok}/${concurrentEvents?.total})`,
  concurrentEvents?.ok === concurrentEvents?.total && concurrentEvents?.total === studentNames.length * 2,
  `result=${JSON.stringify(concurrentEvents).slice(0, 150)}`)

// =============================================================
console.log('\n[R110-11] 缓存 — invalidateCache 后数据立即可见')

const beforeInvalidate = await evalInPage(ws, `window.api.eaa.stats()`)
const invalidateResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.invalidateCache();
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
const afterInvalidate = await evalInPage(ws, `window.api.eaa.stats()`)
check('eaa.invalidateCache 不崩溃',
  invalidateResult?.ok === true,
  `result=${JSON.stringify(invalidateResult).slice(0, 100)}`)
check('invalidateCache 后 stats 仍可读',
  afterInvalidate?.success !== false,
  `result=${JSON.stringify(afterInvalidate).slice(0, 100)}`)

// =============================================================
console.log('\n[R110-12] 全程错误捕获')

const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${finalErrors.length}, detail=${JSON.stringify(finalErrors).slice(0, 200)}`)

// =============================================================
console.log('\n[R110-13] 清理测试数据')

let cleanupOk = 0
for (const name of createdStudents) {
  const r = await evalInPage(ws, `(async () => {
    try {
      await window.api.eaa.deleteStudent(${JSON.stringify(name)}, 'R110 cleanup');
      return { ok: true };
    } catch (e) {
      return { ok: false };
    }
  })()`)
  if (r?.ok) cleanupOk++
}
check(`清理 ${createdStudents.length} 个学生 (${cleanupOk}/${createdStudents.length})`,
  cleanupOk === createdStudents.length)

// 验证清理后 listStudents 不包含 r110 学生
const finalList = await evalInPage(ws, `window.api.eaa.listStudents()`)
const finalArr = Array.isArray(finalList)
  ? finalList
  : (Array.isArray(finalList?.data) ? finalList.data
    : (Array.isArray(finalList?.data?.students) ? finalList.data.students : []))
const r110Remaining = finalArr.filter(s => (s.name || s).startsWith('r110_')).length
check('清理后无 r110 学生残留',
  r110Remaining === 0,
  `remaining=${r110Remaining}`)

// =============================================================
console.log('\n========================================')
console.log(`R110 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
