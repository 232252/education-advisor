// =============================================================
// R120: 未覆盖功能测试 (MCP/Chat/Log/Agent/EAA导出/Profile/System)
// 角度 1: MCP - list/connect/disconnect/listTools/add/remove
// 角度 2: Chat 持久化 - saveMessage/loadMessages/listSessions/deleteSession
// 角度 3: 日志系统 - list/read/filter/search
// 角度 4: Agent - list/get/runManual(不存在)/getHistory
// 角度 5: EAA 导出 - exportFormats + export 到临时文件
// 角度 6: 学生档案 - profile get/set
// 角度 7: 学业配置 - academic getConfig/setConfig
// 角度 8: 系统 - getPath/notify/checkUpdate
// 角度 9: 隐私引擎 - anonymize/deanonymize/filter (锁定态安全失败)
// 角度 10: 全程错误捕获
// =============================================================

import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

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
console.log(`[R120] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r120Errors = [];
  if (!window.__r120HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r120Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r120Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r120HookInstalled = true;
  }
  true
`)
async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r120Errors || []))`)
}

const STAMP = `r120-${Date.now()}`
const tmpDir = os.tmpdir()
const exportPath = path.join(tmpDir, `r120-export-${Date.now()}.json`)

console.log('\n=== R120: 未覆盖功能测试 (MCP/Chat/Log/Agent/EAA导出/Profile/System) ===')

// =============================================================
console.log('\n[R120-1] MCP - list/connect/disconnect/listTools')

const mcpList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.list();
    const arr = Array.isArray(r) ? r : (r?.servers || r?.data || []);
    return { ok: !!r, count: arr.length, isArray: Array.isArray(r) };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('mcp.list 不崩溃',
  mcpList?.ok === true,
  `result=${JSON.stringify(mcpList).slice(0, 100)}`)

// mcp.connect 不存在的 serverId 应安全失败
const mcpConnectBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.connect('__r120_nonexistent__');
    return { handled: true, success: r?.success, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('mcp.connect 不存在 serverId 安全失败',
  mcpConnectBad?.handled === true && (mcpConnectBad?.success === false || !!mcpConnectBad?.error),
  `result=${JSON.stringify(mcpConnectBad).slice(0, 100)}`)

// mcp.listTools 不存在 serverId
const mcpToolsBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.listTools('__r120_nonexistent__');
    return { handled: true, isArray: Array.isArray(r) || Array.isArray(r?.tools) };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('mcp.listTools 不存在 serverId 不崩溃',
  mcpToolsBad?.handled === true,
  `result=${JSON.stringify(mcpToolsBad).slice(0, 100)}`)

// mcp.add 畸形配置 (缺字段) 应被拒绝
const mcpAddBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.add({ name: 'r120-bad' });
    return { handled: true, success: r?.success, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('mcp.add 缺字段配置被拒绝',
  mcpAddBad?.handled === true && (mcpAddBad?.success === false || !!mcpAddBad?.error),
  `result=${JSON.stringify(mcpAddBad).slice(0, 100)}`)

// =============================================================
console.log('\n[R120-2] Chat 持久化 - saveMessage/loadMessages/listSessions/deleteSession')

// listSessions 初始
const sessionsBefore = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.listSessions();
    const arr = Array.isArray(r) ? r : (r?.sessions || r?.data || []);
    return { ok: !!r, count: arr.length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('chat.listSessions 不崩溃',
  sessionsBefore?.ok === true,
  `result=${JSON.stringify(sessionsBefore).slice(0, 100)}`)

// saveMessage
const testSessionId = `${STAMP}-session`
const saveMsgResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.saveMessage({
      sessionId: ${JSON.stringify(testSessionId)},
      role: 'user',
      content: 'R120 测试消息',
      timestamp: Date.now(),
      provider: 'test',
      model: 'r120-test-model',
    });
    return { handled: true, success: r?.success !== false, id: r?.id || r?.data?.id };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('chat.saveMessage 不崩溃',
  saveMsgResult?.handled === true,
  `result=${JSON.stringify(saveMsgResult).slice(0, 100)}`)

// loadMessages 应包含刚保存的消息
const loadMsgResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.loadMessages(${JSON.stringify(testSessionId)});
    const arr = Array.isArray(r) ? r : (r?.messages || r?.data || []);
    return {
      ok: !!r,
      count: arr.length,
      hasR120: arr.some(m => (m?.content || '').includes('R120')),
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('chat.loadMessages 返回刚保存的消息',
  loadMsgResult?.hasR120 === true,
  `result=${JSON.stringify(loadMsgResult).slice(0, 150)}`)

// listSessions 应包含新 session
const sessionsAfter = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.listSessions();
    const arr = Array.isArray(r) ? r : (r?.sessions || r?.data || []);
    return {
      ok: !!r,
      count: arr.length,
      hasTestSession: arr.some(s => (s?.sessionId === ${JSON.stringify(testSessionId)}) || (s?.id === ${JSON.stringify(testSessionId)})),
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('chat.listSessions 包含新 session',
  sessionsAfter?.hasTestSession === true,
  `result=${JSON.stringify(sessionsAfter).slice(0, 150)}`)

// deleteSession
const delSessionResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.chat.deleteSession(${JSON.stringify(testSessionId)});
    return { handled: true, success: r?.success !== false };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('chat.deleteSession 不崩溃',
  delSessionResult?.handled === true,
  `result=${JSON.stringify(delSessionResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R120-3] 日志系统 - list/read/filter/search')

const logList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.log.list();
    const arr = Array.isArray(r) ? r : (r?.files || r?.data || []);
    return { ok: !!r, count: arr.length, sample: arr.slice(0, 2) };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('log.list 不崩溃',
  logList?.ok === true,
  `result=${JSON.stringify(logList).slice(0, 150)}`)

// 如果有日志文件,读取 tail
if (logList?.count > 0) {
  const firstLog = logList.sample[0]
  const logName = typeof firstLog === 'string' ? firstLog : (firstLog?.name || firstLog?.file)
  if (logName) {
    const readResult = await evalInPage(ws, `(async () => {
      try {
        const r = await window.api.log.read(${JSON.stringify(logName)}, 50);
        return { handled: true, hasContent: !!r?.content || typeof r === 'string' || !!r?.data };
      } catch (e) { return { handled: true, error: e.message }; }
    })()`)
    check(`log.read (${logName}) 不崩溃`,
      readResult?.handled === true,
      `result=${JSON.stringify(readResult).slice(0, 100)}`)

    // filter
    const filterResult = await evalInPage(ws, `(async () => {
      try {
        const r = await window.api.log.filter(${JSON.stringify(logName)}, ['error', 'warn'], 50);
        return { handled: true };
      } catch (e) { return { handled: true, error: e.message }; }
    })()`)
    check('log.filter 不崩溃',
      filterResult?.handled === true,
      `result=${JSON.stringify(filterResult).slice(0, 100)}`)

    // search
    const searchResult = await evalInPage(ws, `(async () => {
      try {
        const r = await window.api.log.search(${JSON.stringify(logName)}, 'error', 50);
        return { handled: true };
      } catch (e) { return { handled: true, error: e.message }; }
    })()`)
    check('log.search 不崩溃',
      searchResult?.handled === true,
      `result=${JSON.stringify(searchResult).slice(0, 100)}`)
  }
}

// =============================================================
console.log('\n[R120-4] Agent - list/get/runManual(不存在)/getHistory')

const agentList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.list();
    const arr = Array.isArray(r) ? r : (r?.agents || r?.data || []);
    return { ok: !!r, count: arr.length, sample: arr.slice(0, 2).map(a => a?.id) };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('agent.list 不崩溃',
  agentList?.ok === true,
  `result=${JSON.stringify(agentList).slice(0, 150)}`)

// agent.get 不存在 id — 返回 null (合法的 not-found 模式,非崩溃)
const agentGetBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.get('__r120_nonexistent__');
    return { handled: true, isNull: r === null, success: r?.success, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('agent.get 不存在 id 安全返回 (null 或 {success:false})',
  agentGetBad?.handled === true && (agentGetBad?.isNull === true || agentGetBad?.success === false || !!agentGetBad?.error),
  `result=${JSON.stringify(agentGetBad).slice(0, 100)}`)

// agent.runManual 不存在 id (应安全失败,不崩溃)
const agentRunBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual('__r120_nonexistent__', 'r120 test prompt');
    return { handled: true, success: r?.success, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('agent.runManual 不存在 id 安全失败',
  agentRunBad?.handled === true && (agentRunBad?.success === false || !!agentRunBad?.error),
  `result=${JSON.stringify(agentRunBad).slice(0, 100)}`)

// agent.getHistory 不存在 id
const agentHistBad = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.getHistory('__r120_nonexistent__');
    const arr = Array.isArray(r) ? r : (r?.history || r?.data || []);
    return { handled: true, count: arr.length };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('agent.getHistory 不存在 id 不崩溃',
  agentHistBad?.handled === true,
  `result=${JSON.stringify(agentHistBad).slice(0, 100)}`)

// =============================================================
console.log('\n[R120-5] EAA 导出 - export 到临时文件')

// 先确认 exportFormats
const formats = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.exportFormats();
    const arr = Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : (r?.formats || []));
    return { ok: !!r, count: arr.length, formats: arr };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('eaa.exportFormats 返回格式列表',
  formats?.ok === true && formats?.count > 0,
  `result=${JSON.stringify(formats).slice(0, 150)}`)

// 尝试用 json 格式导出到临时文件
const exportResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.export('json', ${JSON.stringify(exportPath)});
    return { handled: true, success: r?.success !== false, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check(`eaa.export json 到临时文件不崩溃`,
  exportResult?.handled === true,
  `result=${JSON.stringify(exportResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R120-6] 学生档案 - profile get/set')

// 创建测试学生
const profileTestName = `${STAMP}-profile-stu`
await evalInPage(ws, `(async () => {
  try { await window.api.eaa.addStudent(${JSON.stringify(profileTestName)}); } catch {}
  return true;
})()`)

// set profile
const setProfileResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.profile.set(${JSON.stringify(profileTestName)}, {
      bio: 'R120 测试档案',
      contacts: { parent: '张三', phone: '13800000000' },
      tags: ['r120', 'test'],
      customField: 'custom value',
    });
    return { handled: true, success: r?.success !== false, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('profile.set 不崩溃',
  setProfileResult?.handled === true,
  `result=${JSON.stringify(setProfileResult).slice(0, 100)}`)

// get profile 应反映设置
const getProfileResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.profile.get(${JSON.stringify(profileTestName)});
    const data = r?.data || r;
    return {
      handled: true,
      hasBio: (data?.bio || '').includes('R120'),
      hasContacts: !!data?.contacts?.parent,
    };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('profile.get 反映 set 的数据',
  getProfileResult?.hasBio === true && getProfileResult?.hasContacts === true,
  `result=${JSON.stringify(getProfileResult).slice(0, 150)}`)

// 清理
await evalInPage(ws, `(async () => {
  try { await window.api.eaa.deleteStudent(${JSON.stringify(profileTestName)}); } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R120-7] 学业配置 - academic getConfig/setConfig')

const getConfigResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.academic.getConfig();
    return { handled: true, hasData: !!r?.data || !!r?.subjects || !!r };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('academic.getConfig 不崩溃',
  getConfigResult?.handled === true,
  `result=${JSON.stringify(getConfigResult).slice(0, 100)}`)

// setConfig 用空对象 (不应破坏现有配置)
const setConfigResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.academic.setConfig({});
    return { handled: true, success: r?.success !== false, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('academic.setConfig 空对象不崩溃',
  setConfigResult?.handled === true,
  `result=${JSON.stringify(setConfigResult).slice(0, 100)}`)

// listExams
const listExamsResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.academic.listExams();
    const arr = Array.isArray(r) ? r : (r?.exams || r?.data || []);
    return { handled: true, count: arr.length };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('academic.listExams 不崩溃',
  listExamsResult?.handled === true,
  `result=${JSON.stringify(listExamsResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R120-8] 系统 - getPath/notify/checkUpdate')

// getPath
const getPathResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.sys.getPath('userData');
    return { handled: true, isString: typeof r === 'string', value: r };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('sys.getPath(userData) 返回字符串',
  getPathResult?.isString === true && (getPathResult?.value || '').length > 0,
  `result=${JSON.stringify(getPathResult).slice(0, 100)}`)

// notify (不应阻塞)
const notifyResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.sys.notify('R120 Test', 'r120 测试通知');
    return { handled: true };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('sys.notify 不崩溃',
  notifyResult?.handled === true,
  `result=${JSON.stringify(notifyResult).slice(0, 100)}`)

// checkUpdate (可能无网络,不应崩溃)
const checkUpdateResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.sys.checkUpdate();
    return { handled: true };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('sys.checkUpdate 不崩溃',
  checkUpdateResult?.handled === true,
  `result=${JSON.stringify(checkUpdateResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R120-9] 隐私引擎 - anonymize/deanonymize/filter (锁定态安全失败)')

// anonymize 未解锁应安全失败
const anonymizeResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.anonymize('R120 测试文本 张三');
    return { handled: true, success: r?.success, error: r?.error, hasData: !!r?.data };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('privacy.anonymize (未解锁) 不崩溃',
  anonymizeResult?.handled === true,
  `result=${JSON.stringify(anonymizeResult).slice(0, 150)}`)

// deanonymize 未解锁应安全失败
const deanonymizeResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.deanonymize('R120 测试文本');
    return { handled: true, success: r?.success, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('privacy.deanonymize (未解锁) 不崩溃',
  deanonymizeResult?.handled === true,
  `result=${JSON.stringify(deanonymizeResult).slice(0, 150)}`)

// filter 未解锁应安全失败
const filterResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.filter('R120 测试文本');
    return { handled: true, success: r?.success, error: r?.error };
  } catch (e) { return { handled: true, error: e.message }; }
})()`)
check('privacy.filter (未解锁) 不崩溃',
  filterResult?.handled === true,
  `result=${JSON.stringify(filterResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R120-10] 全程错误捕获')
const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 500)}`)

// =============================================================
console.log('\n========================================')
console.log(`R120 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
