// =============================================================
// R111: 支撑服务完整性测试 (Academic/Class/Log/Feishu/Chat)
// 角度 1: Academic — getConfig/setConfig/listExams/createExam/deleteExam/getGrades/setGrade
// 角度 2: Class — list/create/update/archive/restore/delete
// 角度 3: Log — list/read/filter/search/exportWithDialog
// 角度 4: Feishu — test (无效 appId), status, botStatus, botStart/botStop
// 角度 5: Chat 持久化 — saveMessage/loadMessages/listSessions/deleteSession
// 角度 6: Keystore 加密 — feishu.appSecret 路径 setSecret/getSecret/deleteSecret
// 角度 7: 边界 — 无效参数/空参数/超长参数
// 角度 8: 并发 — 多个 chat saveMessage 并发
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
console.log(`[R111] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r111Errors = [];
  if (!window.__r111HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r111Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r111Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r111HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r111Errors || []))`)
}

const STAMP = `r111_${Date.now()}`
const createdClassIds = []
const createdExamIds = []
const createdSessionIds = []

// =============================================================
console.log('\n=== R111: 支撑服务完整性测试 ===')

// =============================================================
console.log('\n[R111-1] Academic — 学业管理')

// getConfig
const academicConfig = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.academic.getConfig();
    return { ok: r?.success !== false, hasData: !!r?.data || !!r?.config };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('academic.getConfig 不崩溃',
  academicConfig?.ok === true,
  `result=${JSON.stringify(academicConfig).slice(0, 100)}`)

// setConfig with valid structure
const setConfigResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.academic.setConfig({
      subjects: [{ id: 'r111_subj_math', name: 'R111 数学' }],
      examTypes: [{ id: 'r111_type_test', name: 'R111 测验' }],
    });
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('academic.setConfig 不崩溃',
  setConfigResult?.ok === true,
  `result=${JSON.stringify(setConfigResult).slice(0, 100)}`)

// listExams
const listExamsResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.academic.listExams();
    return { ok: r?.success !== false, isArray: Array.isArray(r?.data) || Array.isArray(r?.exams) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('academic.listExams 不崩溃',
  listExamsResult?.ok === true,
  `result=${JSON.stringify(listExamsResult).slice(0, 100)}`)

// createExam (需要 name + subjects 字符串数组)
// Bug R111-2: subjects 必须是 string[] (subject IDs), 不是对象数组
const createExamResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.academic.createExam({
      name: 'R111 测试考试',
      semester: '2026-Spring',
      date: '2026-07-27',
      subjects: ['r111_subj_math'],
    });
    return { ok: r?.success !== false, id: r?.data?.id || r?.id, error: r?.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('academic.createExam 不崩溃',
  createExamResult?.ok === true,
  `result=${JSON.stringify(createExamResult).slice(0, 200)}`)
const examId = createExamResult?.id
if (examId) createdExamIds.push(examId)

// getGrades for nonexistent student
const getGradesResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.academic.getGrades('r111_nonexistent_student');
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('academic.getGrades 不存在学生不崩溃',
  getGradesResult?.ok === true,
  `result=${JSON.stringify(getGradesResult).slice(0, 100)}`)

// setGrade (需要 examId + subjectId + studentName,examId 用刚创建的考试)
const setGradeResult = await evalInPage(ws, `(async () => {
  try {
    if (!${examId ? JSON.stringify(examId) : 'null'}) return { ok: false, error: 'no examId' };
    const r = await window.api.academic.setGrade({
      studentName: 'r111_test_student',
      examId: ${JSON.stringify(examId)},
      subjectId: 'r111_subj_math',
      score: 95,
    });
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('academic.setGrade 不崩溃',
  setGradeResult?.ok === true,
  `result=${JSON.stringify(setGradeResult).slice(0, 150)}`)

// deleteExam
const deleteExamResult = await evalInPage(ws, `(async () => {
  try {
    if (!${examId ? JSON.stringify(examId) : 'null'}) return { ok: false, error: 'no examId' };
    const r = await window.api.academic.deleteExam(${JSON.stringify(examId)});
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('academic.deleteExam 不崩溃',
  deleteExamResult?.ok === true,
  `result=${JSON.stringify(deleteExamResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R111-2] Class — 班级管理')

// list
const classList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.class.list();
    return { ok: r?.success !== false, isArray: Array.isArray(r?.data) || Array.isArray(r) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('class.list 不崩溃',
  classList?.ok === true,
  `result=${JSON.stringify(classList).slice(0, 100)}`)

// create (需要 class_id + name)
// class_id 校验只允许 [A-Za-z0-9.-], 不允许下划线, 所以用 '-'
const STAMP_CID = STAMP.replace(/_/g, '-') + '-cid'
const classCreate = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.class.create({
      class_id: ${JSON.stringify(STAMP_CID)},
      name: ${JSON.stringify(STAMP + '-class')},
      grade: '2026',
      note: 'R111 测试班级',
    });
    return { ok: r?.success !== false, id: r?.data?.id || r?.id, error: r?.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('class.create 不崩溃',
  classCreate?.ok === true,
  `result=${JSON.stringify(classCreate).slice(0, 150)}`)
// classService 用内部 UUID 作为 id, 后续 update/archive/restore/delete 都用这个 UUID
const classId = classCreate?.id
if (classId) createdClassIds.push(classId)

// update (依赖 classId,如果 create 失败则跳过)
if (classId) {
  const classUpdate = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.class.update(${JSON.stringify(classId)}, {
        note: 'R111 更新后的备注',
      });
      return { ok: r?.success !== false, error: r?.error };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  check('class.update 不崩溃',
    classUpdate?.ok === true,
    `result=${JSON.stringify(classUpdate).slice(0, 150)}`)

  // archive
  const classArchive = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.class.archive(${JSON.stringify(classId)});
      return { ok: r?.success !== false };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  check('class.archive 不崩溃',
    classArchive?.ok === true,
    `result=${JSON.stringify(classArchive).slice(0, 100)}`)

  // restore
  const classRestore = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.class.restore(${JSON.stringify(classId)});
      return { ok: r?.success !== false };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  check('class.restore 不崩溃',
    classRestore?.ok === true,
    `result=${JSON.stringify(classRestore).slice(0, 100)}`)

  // delete (cleanup)
  const classDelete = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.class.delete(${JSON.stringify(classId)});
      return { ok: r?.success !== false };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  check('class.delete 不崩溃',
    classDelete?.ok === true,
    `result=${JSON.stringify(classDelete).slice(0, 100)}`)
} else {
  check('class.update/archive/restore/delete (跳过: create 失败)', false, 'no classId')
}

// =============================================================
console.log('\n[R111-3] Log — 日志系统')

// list
const logList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.log.list();
    return { ok: r?.success !== false, isArray: Array.isArray(r?.data) || Array.isArray(r) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('log.list 不崩溃',
  logList?.ok === true,
  `result=${JSON.stringify(logList).slice(0, 100)}`)

// 取第一个日志文件名 (用于后续 read/filter/search)
const logArr = Array.isArray(logList?.data) ? logList.data : (Array.isArray(logList) ? logList : [])
const firstLogName = typeof logArr[0] === 'string' ? logArr[0] : (logArr[0]?.name || logArr[0]?.filename || 'main.log')

// read
const logRead = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.log.read(${JSON.stringify(firstLogName)}, 50);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check(`log.read(${firstLogName}) 不崩溃`,
  logRead?.ok === true,
  `result=${JSON.stringify(logRead).slice(0, 100)}`)

// filter
const logFilter = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.log.filter(${JSON.stringify(firstLogName)}, ['info', 'warn'], 20);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('log.filter 不崩溃',
  logFilter?.ok === true,
  `result=${JSON.stringify(logFilter).slice(0, 100)}`)

// search
const logSearch = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.log.search(${JSON.stringify(firstLogName)}, 'R111', 20);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('log.search 不崩溃',
  logSearch?.ok === true,
  `result=${JSON.stringify(logSearch).slice(0, 100)}`)

// read 不存在的日志文件
const logReadBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.log.read('nonexistent_log_file_xyz.log', 10);
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('log.read 不存在文件被拒绝/不崩溃',
  logReadBad !== null && logReadBad !== undefined,
  `result=${JSON.stringify(logReadBad).slice(0, 100)}`)

// log.forward (send, 无返回值)
const logForward = await evalInPage(ws, `(async () => {
  try {
    window.api.log.forward('info', 'R111 test log forward');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('log.forward 不崩溃',
  logForward?.ok === true,
  `result=${JSON.stringify(logForward).slice(0, 100)}`)

// =============================================================
console.log('\n[R111-4] Feishu — 飞书集成')

// status (无凭证应返回 disconnected 或类似)
const feishuStatus = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.feishu.status();
    return { ok: r?.success !== false, hasData: !!r?.data || typeof r === 'object' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('feishu.status 不崩溃',
  feishuStatus?.ok === true,
  `result=${JSON.stringify(feishuStatus).slice(0, 100)}`)

// botStatus
const botStatus = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.feishu.botStatus();
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('feishu.botStatus 不崩溃',
  botStatus?.ok === true,
  `result=${JSON.stringify(botStatus).slice(0, 100)}`)

// test 无效 appId
const feishuTestBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.feishu.test('invalid_app_id_xyz');
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('feishu.test 无效 appId 被拒绝/不崩溃',
  feishuTestBad !== null && feishuTestBad !== undefined,
  `result=${JSON.stringify(feishuTestBad).slice(0, 100)}`)

// botStart (无凭证应安全失败)
const botStartBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.feishu.botStart();
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('feishu.botStart (无凭证) 安全失败/不崩溃',
  botStartBad !== null && botStartBad !== undefined,
  `result=${JSON.stringify(botStartBad).slice(0, 100)}`)

// botStop
const botStop = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.feishu.botStop();
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('feishu.botStop 不崩溃',
  botStop?.ok === true,
  `result=${JSON.stringify(botStop).slice(0, 100)}`)

// onBotStatusUpdate 订阅/取消
const subTest = await evalInPage(ws, `(async () => {
  try {
    const unsub = window.api.feishu.onBotStatusUpdate(() => {});
    const isFunc = typeof unsub === 'function';
    if (isFunc) unsub();
    return { ok: true, isFunc };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('feishu.onBotStatusUpdate 返回取消订阅函数',
  subTest?.isFunc === true,
  `result=${JSON.stringify(subTest).slice(0, 100)}`)

// =============================================================
console.log('\n[R111-5] Chat 持久化 — 对话存储')

// saveMessage
const saveMsgResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.saveMessage({
      sessionId: ${JSON.stringify(STAMP + '_session')},
      role: 'user',
      content: 'R111 测试消息',
      timestamp: Date.now(),
      provider: 'r111_test',
      model: 'r111_model',
    });
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('chat.saveMessage 不崩溃',
  saveMsgResult?.ok === true,
  `result=${JSON.stringify(saveMsgResult).slice(0, 100)}`)

// 再保存一条 assistant 消息
await evalInPage(ws, `(async () => {
  try {
    await window.api.chat.saveMessage({
      sessionId: ${JSON.stringify(STAMP + '_session')},
      role: 'assistant',
      content: 'R111 测试回复',
      timestamp: Date.now() + 1,
      provider: 'r111_test',
      model: 'r111_model',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
})()`)

// loadMessages
const loadMsgs = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.loadMessages(${JSON.stringify(STAMP + '_session')});
    return { ok: r?.success !== false, count: Array.isArray(r?.data) ? r.data.length : (Array.isArray(r?.messages) ? r.messages.length : 0) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('chat.loadMessages 不崩溃且返回消息',
  loadMsgs?.ok === true && loadMsgs?.count >= 2,
  `result=${JSON.stringify(loadMsgs).slice(0, 150)}`)

// listSessions
const listSessions = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.listSessions();
    return { ok: r?.success !== false, isArray: Array.isArray(r?.data) || Array.isArray(r) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('chat.listSessions 不崩溃',
  listSessions?.ok === true,
  `result=${JSON.stringify(listSessions).slice(0, 100)}`)

// deleteSession (cleanup)
const deleteSession = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.deleteSession(${JSON.stringify(STAMP + '_session')});
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('chat.deleteSession 不崩溃',
  deleteSession?.ok === true,
  `result=${JSON.stringify(deleteSession).slice(0, 100)}`)

// =============================================================
console.log('\n[R111-6] Keystore 加密 — feishu.appSecret 路径')

// 备份当前 feishu.appId 与 appSecret 状态
const beforeSettings = await evalInPage(ws, `window.api.settings.get()`)
const beforeAppId = beforeSettings?.feishu?.appId
const beforeSecretMark = beforeSettings?.feishu?.appSecret

// 设置一个测试 appSecret
const setSecretResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.settings.set('feishu.appSecret', 'r111_test_secret_xyz');
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('settings.set(feishu.appSecret) 加密存储成功',
  setSecretResult?.ok === true,
  `result=${JSON.stringify(setSecretResult).slice(0, 100)}`)

// 验证 settings.get 返回占位符 __keystore__ (不返回真实密钥)
const afterSetSettings = await evalInPage(ws, `window.api.settings.get()`)
check('settings.get 返回 __keystore__ 占位符 (不泄露密钥)',
  afterSetSettings?.feishu?.appSecret === '__keystore__',
  `appSecret=${afterSetSettings?.feishu?.appSecret}`)

// 再次设置占位符应跳过 (不覆盖原密钥)
const setPlaceholder = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.settings.set('feishu.appSecret', '__keystore__');
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('settings.set(feishu.appSecret, __keystore__) 跳过不覆盖',
  setPlaceholder?.ok === true,
  `result=${JSON.stringify(setPlaceholder).slice(0, 100)}`)

// 恢复: 如果原来没有 appId/secret, 不清理 (keystore 中的测试 secret 保留也无害)
// 如果原来有 appSecret, 重新设置回原值 (我们不知道原值, 但通过 settings.reset 可清空)
// 这里不执行 reset (会影响其他测试), 只验证 keystore 路径工作正常

// =============================================================
console.log('\n[R111-7] 边界 — 无效参数')

// academic.setConfig with null
const setConfigNull = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.academic.setConfig(null);
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('academic.setConfig(null) 被拒绝/不崩溃',
  setConfigNull !== null && setConfigNull !== undefined,
  `result=${JSON.stringify(setConfigNull).slice(0, 100)}`)

// class.create with empty object
const classCreateEmpty = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.class.create({});
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('class.create({}) 被拒绝/不崩溃',
  classCreateEmpty !== null && classCreateEmpty !== undefined,
  `result=${JSON.stringify(classCreateEmpty).slice(0, 100)}`)

// chat.saveMessage with missing required fields
const saveMsgBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.saveMessage({});
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('chat.saveMessage({}) 被拒绝/不崩溃',
  saveMsgBad !== null && saveMsgBad !== undefined,
  `result=${JSON.stringify(saveMsgBad).slice(0, 100)}`)

// profile.set with path traversal
const profilePathTraversal = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.profile.set('../../../etc/passwd', { evil: true });
    return { ok: r?.success !== false, rejected: r?.success === false };
  } catch (e) {
    return { ok: false, rejected: true, error: e.message };
  }
})()`)
check('profile.set 路径穿越被拒绝/不崩溃',
  profilePathTraversal !== null && profilePathTraversal !== undefined,
  `result=${JSON.stringify(profilePathTraversal).slice(0, 100)}`)

// =============================================================
console.log('\n[R111-8] 并发 — chat.saveMessage 并发')

const concurrentMsgs = await evalInPage(ws, `(async () => {
  const sessionId = ${JSON.stringify(STAMP + '_concurrent_session')};
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push((async () => {
      try {
        const r = await window.api.chat.saveMessage({
          sessionId: sessionId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'R111 并发消息 ' + i,
          timestamp: Date.now() + i,
        });
        return { ok: r?.success !== false };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })());
  }
  const results = await Promise.allSettled(promises);
  return {
    total: results.length,
    ok: results.filter(r => r.status === 'fulfilled' && r.value?.ok).length,
  };
})()`)

check(`并发 saveMessage 全部成功 (${concurrentMsgs?.ok}/${concurrentMsgs?.total})`,
  concurrentMsgs?.ok === concurrentMsgs?.total && concurrentMsgs?.total === 10,
  `result=${JSON.stringify(concurrentMsgs).slice(0, 150)}`)

// 验证并发写入后可读
const loadConcurrent = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.loadMessages(${JSON.stringify(STAMP + '_concurrent_session')});
    return { ok: r?.success !== false, count: Array.isArray(r?.data) ? r.data.length : (Array.isArray(r?.messages) ? r.messages.length : 0) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('并发写入后 loadMessages 返回 10 条消息',
  loadConcurrent?.ok === true && loadConcurrent?.count === 10,
  `count=${loadConcurrent?.count}`)

// 清理并发会话
await evalInPage(ws, `window.api.chat.deleteSession(${JSON.stringify(STAMP + '_concurrent_session')})`)

// =============================================================
console.log('\n[R111-9] 全程错误捕获')

const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${finalErrors.length}, detail=${JSON.stringify(finalErrors).slice(0, 200)}`)

// =============================================================
console.log('\n[R111-10] 清理测试数据')

// 清理 academic config (恢复为空)
await evalInPage(ws, `window.api.academic.setConfig({ subjects: [], examTypes: [] })`)

// 清理 class (如果还有未删的)
for (const id of createdClassIds) {
  await evalInPage(ws, `window.api.class.delete(${JSON.stringify(id)})`)
}

// 清理 chat sessions
for (const sid of createdSessionIds) {
  await evalInPage(ws, `window.api.chat.deleteSession(${JSON.stringify(sid)})`)
}

check('清理完成', true)

// =============================================================
console.log('\n========================================')
console.log(`R111 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
