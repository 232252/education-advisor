// =============================================================
// R117: EAA 数据完整性 + 隐私引擎边界测试
// 角度 1: EAA 学生 CRUD - add/list/delete 一致性
// 角度 2: EAA 学生元数据 - setStudentMeta/getStudent
// 角度 3: EAA 事件 - addEvent/history/range
// 角度 4: EAA 边界 - 空名/超长名/特殊字符
// 角度 5: EAA 缓存 - invalidateCache 后立即读取
// 角度 6: 隐私引擎 - status/list/addEntity
// 角度 7: 隐私引擎 - 边界 (空名/路径穿越)
// 角度 8: EAA doctor - 健康检查
// 角度 9: EAA reason-codes - 返回非空
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
  targets.find((t) => t.type === 'page' && t.url.includes('index')) ||
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R117] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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

// 错误捕获
await evalInPage(ws, `
  window.__r117Errors = [];
  if (!window.__r117HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r117Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r117Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r117HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r117Errors || []))`)
}

const STAMP = `r117-${Date.now()}`
const createdStudents = []

console.log('\n=== R117: EAA 数据完整性 + 隐私引擎边界测试 ===')

// =============================================================
console.log('\n[R117-1] EAA 学生 CRUD - add/list/delete 一致性')

// 初始 list
const listBefore = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.listStudents();
    return { ok: r?.success === true, count: r?.data?.students?.length ?? 0 };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.listStudents 初始加载成功',
  listBefore?.ok === true,
  `result=${JSON.stringify(listBefore).slice(0, 100)}`)

// add 3 个测试学生
for (let i = 0; i < 3; i++) {
  const name = `${STAMP}-stu-${i}`
  const addResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.addStudent(${JSON.stringify(name)});
      return { ok: r?.success !== false, error: r?.error };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  check(`eaa.addStudent #${i} (${name})`,
    addResult?.ok === true,
    `result=${JSON.stringify(addResult).slice(0, 100)}`)
  if (addResult?.ok) createdStudents.push(name)
}

// list 应包含新学生
const listAfterAdd = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.listStudents();
    const students = r?.data?.students ?? [];
    const found = students.filter(s => ${JSON.stringify(createdStudents)}.includes(s.name));
    return { ok: r?.success === true, foundCount: found.length, totalCount: students.length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check(`eaa.listStudents 包含 ${createdStudents.length} 个新学生`,
  listAfterAdd?.foundCount === createdStudents.length,
  `found=${listAfterAdd?.foundCount}, expected=${createdStudents.length}`)

// delete 一个学生
if (createdStudents.length > 0) {
  const delName = createdStudents[0]
  const delResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.deleteStudent(${JSON.stringify(delName)});
      return { ok: r?.success !== false, error: r?.error };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  check(`eaa.deleteStudent (${delName})`,
    delResult?.ok === true,
    `result=${JSON.stringify(delResult).slice(0, 100)}`)

  // list 不再包含
  const listAfterDel = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.listStudents();
      const students = r?.data?.students ?? [];
      const found = students.find(s => s.name === ${JSON.stringify(delName)});
      // 注意: deleteStudent 是软删除 (status=Deleted), 仍在 list 中但 status 变化
      const deletedStu = students.find(s => s.name === ${JSON.stringify(delName)} && s.status === 'Deleted');
      return { found: !!found, isDeleted: !!deletedStu };
    } catch (e) { return { found: 'error' }; }
  })()`)
  // 软删除: 学生仍在 list 但 status=Deleted, 或完全消失 (取决于实现)
  check('eaa.deleteStudent 后学生状态变更或消失',
    listAfterDel?.isDeleted === true || listAfterDel?.found === false,
    `found=${listAfterDel?.found}, isDeleted=${listAfterDel?.isDeleted}`)

  createdStudents.shift()
}

// 清理剩余学生
for (const name of createdStudents) {
  await evalInPage(ws, `(async () => {
    try { await window.api.eaa.deleteStudent(${JSON.stringify(name)}); } catch {}
    return true;
  })()`)
}

// =============================================================
console.log('\n[R117-2] EAA 学生元数据 - setStudentMeta/getStudent')

const metaTestName = `${STAMP}-meta-stu`
await evalInPage(ws, `(async () => {
  try { await window.api.eaa.addStudent(${JSON.stringify(metaTestName)}); } catch {}
  return true;
})()`)

// SetStudentMetaParams: { name, group?, role?, classId?, clearClassId? }
const setMetaResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.setStudentMeta({
      name: ${JSON.stringify(metaTestName)},
      group: 'r117-test-group',
      role: 'student',
      classId: 'r117-test-class',
    });
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.setStudentMeta 不崩溃',
  setMetaResult?.ok === true,
  `result=${JSON.stringify(setMetaResult).slice(0, 100)}`)

// list 应反映 meta (EAAStudent.class_id 字段)
const listWithMeta = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.listStudents();
    const stu = (r?.data?.students ?? []).find(s => s.name === ${JSON.stringify(metaTestName)});
    return {
      found: !!stu,
      classId: stu?.class_id ?? null,
      groups: stu?.groups ?? [],
      roles: stu?.roles ?? [],
    };
  } catch (e) { return { found: false, error: e.message }; }
})()`)
check('eaa.listStudents 反映 setStudentMeta (class_id/groups/roles)',
  listWithMeta?.found === true &&
    listWithMeta?.classId === 'r117-test-class' &&
    (listWithMeta?.groups || []).includes('r117-test-group') &&
    (listWithMeta?.roles || []).includes('student'),
  `result=${JSON.stringify(listWithMeta).slice(0, 200)}`)

// 清理
await evalInPage(ws, `(async () => {
  try { await window.api.eaa.deleteStudent(${JSON.stringify(metaTestName)}); } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R117-3] EAA 事件 - addEvent/history/range')

const eventTestName = `${STAMP}-event-stu`
await evalInPage(ws, `(async () => {
  try { await window.api.eaa.addStudent(${JSON.stringify(eventTestName)}); } catch {}
  return true;
})()`)

// addEvent — AddEventParams: { studentName, reasonCode, delta?, note?, operator?, tags?, dryRun?, force? }
const addEventResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: ${JSON.stringify(eventTestName)},
      reasonCode: 'SPEAK_IN_CLASS',
      note: 'R117 测试事件描述',
      operator: 'r117-tester',
      tags: ['r117', 'test'],
    });
    return { ok: r?.success !== false, id: r?.data?.id || r?.id, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.addEvent 不崩溃',
  addEventResult?.ok === true,
  `result=${JSON.stringify(addEventResult).slice(0, 100)}`)

// history (按学生查询) — EAAHistoryEvent 字段: event_id, timestamp, event_type, reason_code, score_delta, cumulative, note, tags, reverted
const historyResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.history(${JSON.stringify(eventTestName)});
    const events = r?.data?.events ?? r?.events ?? [];
    return {
      ok: r?.success !== false || Array.isArray(events),
      count: events.length,
      hasR117: events.some(e => (e?.note || '').includes('R117') || (e?.tags || []).includes('r117')),
      hasReasonCode: events.some(e => e?.reason_code === 'SPEAK_IN_CLASS'),
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.history 返回新添加的事件',
  historyResult?.hasR117 === true && historyResult?.hasReasonCode === true,
  `result=${JSON.stringify(historyResult).slice(0, 200)}`)

// range (按日期范围查询)
const rangeResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.range('2026-07-01', '2026-07-31', 1000);
    const events = r?.data?.events ?? r?.events ?? [];
    return {
      ok: r?.success !== false || Array.isArray(events),
      count: events.length,
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.range 不崩溃',
  rangeResult?.ok === true,
  `result=${JSON.stringify(rangeResult).slice(0, 100)}`)

// 清理
await evalInPage(ws, `(async () => {
  try { await window.api.eaa.deleteStudent(${JSON.stringify(eventTestName)}); } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R117-4] EAA 边界 - 空名/超长名/特殊字符')

// 空名
const emptyName = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addStudent('');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.addStudent 空名被拒绝',
  emptyName?.ok === false || (emptyName?.error && emptyName.error.length > 0),
  `result=${JSON.stringify(emptyName).slice(0, 100)}`)

// null 名
const nullName = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addStudent(null);
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.addStudent null 被拒绝',
  nullName?.ok === false || (nullName?.error && nullName.error.length > 0),
  `result=${JSON.stringify(nullName).slice(0, 100)}`)

// 超长名 (1000 字符)
const longName = 'x'.repeat(1000)
const longNameResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addStudent(${JSON.stringify(longName)});
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.addStudent 超长名 (1000字符) 不崩溃',
  longNameResult?.ok === true || (longNameResult?.error && longNameResult.error.length > 0),
  `result=${JSON.stringify(longNameResult).slice(0, 100)}`)

// 清理超长名学生 (如果创建成功)
if (longNameResult?.ok === true) {
  await evalInPage(ws, `(async () => {
    try { await window.api.eaa.deleteStudent(${JSON.stringify(longName)}); } catch {}
    return true;
  })()`)
}

// 路径穿越名
const pathName = '../../../etc/passwd'
const pathNameResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addStudent(${JSON.stringify(pathName)});
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.addStudent 路径穿越名被拒绝',
  pathNameResult?.ok === false || (pathNameResult?.error && pathNameResult.error.length > 0),
  `result=${JSON.stringify(pathNameResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R117-5] EAA 缓存 - invalidateCache 后立即读取')

// invalidateCache 不崩溃
const invalidateResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.invalidateCache();
    return { ok: r?.success !== false || r === undefined || r === true };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.invalidateCache 不崩溃',
  invalidateResult?.ok === true,
  `result=${JSON.stringify(invalidateResult).slice(0, 100)}`)

// invalidate 后 list 仍正常
const listAfterInvalidate = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.listStudents();
    return { ok: r?.success === true };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.invalidateCache 后 listStudents 仍正常',
  listAfterInvalidate?.ok === true,
  `result=${JSON.stringify(listAfterInvalidate).slice(0, 100)}`)

// =============================================================
console.log('\n[R117-6] 隐私引擎 - status/list/addEntity')

// status
const privacyStatus = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.status();
    return { ok: !!r, isInitialized: r?.isInitialized, unlocked: r?.unlocked };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('privacy.status 不崩溃',
  privacyStatus?.ok === true,
  `result=${JSON.stringify(privacyStatus).slice(0, 100)}`)

// list (可能未解锁, 不应崩溃)
// 未解锁时返回 { success: false, data: '隐私引擎已锁定...' } — 这是正常响应,非崩溃
const privacyList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.list();
    return {
      hasResponse: !!r,
      success: r?.success,
      hasData: r?.data !== undefined,
      dataType: typeof r?.data,
      error: r?.error,
    };
  } catch (e) { return { hasResponse: false, error: e.message }; }
})()`)
check('privacy.list 不崩溃 (即使未解锁)',
  privacyList?.hasResponse === true,
  `result=${JSON.stringify(privacyList).slice(0, 200)}`)

// =============================================================
console.log('\n[R117-7] 隐私引擎 - 边界')

// addEntity 空名
const addEntityEmpty = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.addEntity({ name: '', type: 'student' });
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('privacy.addEntity 空名被拒绝或安全失败',
  addEntityEmpty?.ok === false || (addEntityEmpty?.error && addEntityEmpty.error.length > 0),
  `result=${JSON.stringify(addEntityEmpty).slice(0, 100)}`)

// addEntity null
const addEntityNull = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.addEntity(null);
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('privacy.addEntity null 被拒绝',
  addEntityNull?.ok === false || (addEntityNull?.error && addEntityNull.error.length > 0),
  `result=${JSON.stringify(addEntityNull).slice(0, 100)}`)

// =============================================================
console.log('\n[R117-8] EAA doctor - 健康检查')

const doctorResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.doctor();
    return {
      ok: r?.success !== false || !!r,
      hasChecks: !!r?.checks || !!r?.data?.checks,
      success: r?.success,
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.doctor 不崩溃',
  doctorResult?.ok === true,
  `result=${JSON.stringify(doctorResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R117-9] EAA reason-codes - 返回非空')

const codesResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.codes();
    const codes = r?.data?.codes ?? r?.codes ?? r ?? [];
    return {
      ok: Array.isArray(codes) || r?.success !== false,
      count: Array.isArray(codes) ? codes.length : 0,
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.codes 返回非空数组',
  codesResult?.ok === true && codesResult?.count > 0,
  `result=${JSON.stringify(codesResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R117-10] EAA export-formats - 返回格式列表')

const formatsResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.exportFormats();
    const formats = r?.data?.formats ?? r?.formats ?? r ?? [];
    return {
      ok: Array.isArray(formats) || r?.success !== false,
      count: Array.isArray(formats) ? formats.length : 0,
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.exportFormats 不崩溃',
  formatsResult?.ok === true,
  `result=${JSON.stringify(formatsResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R117-11] EAA stats - 统计数据')

const statsResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.stats();
    return {
      ok: r?.success !== false || !!r,
      hasData: !!r?.data || !!r,
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.stats 不崩溃',
  statsResult?.ok === true,
  `result=${JSON.stringify(statsResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R117-12] 全程错误捕获')
const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 300)}`)

// =============================================================
console.log('\n========================================')
console.log(`R117 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
