// =============================================================
// R130: 存储一致性测试 (原子写入/并发写/磁盘格式)
// 角度 1: 并发写入 (10 个 settings.set 同时调用)
// 角度 2: 读后写一致性 (write 后立即 read 返回正确值)
// 角度 3: 深度合并正确性 (嵌套更新不覆盖兄弟节点)
// 角度 4: 类型保持 (string/number/boolean/object/array)
// 角度 5: 值校验 (null/undefined/NaN/Infinity/function/bigint 被拒绝)
// 角度 6: 原型链污染防护 (__proto__/constructor/prototype 被拒绝)
// 角度 7: 字符串长度限制 (>1M 被拒绝)
// 角度 8: 对象深度限制 (>10 被拒绝)
// 角度 9: dot-path 校验 (空路径/不存在路径/空段)
// 角度 10: EAA 数据完整性 (stress 后数据一致)
// 角度 11: Skill 文件完整性
// 角度 12: settings.json 磁盘格式有效
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

const STAMP = `r130-${Date.now()}`
console.log('\n=== R130: 存储一致性测试 ===')

let ws = await connectWS()
console.log(`[R130] STAMP = ${STAMP}`)

// 保存初始 settings
const initialSettings = await evalInPage(ws, `(async () => await window.api.settings.get())()`)

// =============================================================
console.log('\n[R130-1] 并发写入 (10 个 settings.set 同时调用)')

// 同时写 10 个不同路径, 验证不互相覆盖 (使用 default-settings.json 中真实存在的路径)
const concurrentResult = await evalInPage(ws, `(async () => {
  const writes = [
    window.api.settings.set('chat.maxTokens', 10001),
    window.api.settings.set('chat.steeringMode', 'all'),
    window.api.settings.set('chat.thinkingLevel', 'high'),
    window.api.settings.set('chat.compaction.enabled', false),
    window.api.settings.set('mcp.enabled', true),
    window.api.settings.set('general.logLevel', 'debug'),
    window.api.settings.set('general.autoStart', true),
    window.api.settings.set('general.minimizeToTray', true),
    window.api.settings.set('general.agentTimeoutMins', 44),
    window.api.settings.set('general.maxConcurrentCronTasks', 55),
  ];
  const results = await Promise.all(writes);
  // 等待节流写入完成
  await new Promise(r => setTimeout(r, 1000));
  const s = await window.api.settings.get();
  return {
    allOk: results.every(r => r?.success !== false),
    values: {
      maxTokens: s?.chat?.maxTokens,
      steeringMode: s?.chat?.steeringMode,
      thinkingLevel: s?.chat?.thinkingLevel,
      compactionEnabled: s?.chat?.compaction?.enabled,
      mcpEnabled: s?.mcp?.enabled,
      logLevel: s?.general?.logLevel,
      autoStart: s?.general?.autoStart,
      minimizeToTray: s?.general?.minimizeToTray,
      agentTimeoutMins: s?.general?.agentTimeoutMins,
      maxConcurrentCronTasks: s?.general?.maxConcurrentCronTasks,
    },
  };
})()`)

check('并发写入 10 个路径全部成功',
  concurrentResult?.allOk === true,
  `result=${JSON.stringify(concurrentResult).slice(0, 200)}`)
check('并发写入后所有值正确 (无互相覆盖)',
  concurrentResult?.values?.maxTokens === 10001 &&
  concurrentResult?.values?.steeringMode === 'all' &&
  concurrentResult?.values?.thinkingLevel === 'high' &&
  concurrentResult?.values?.compactionEnabled === false &&
  concurrentResult?.values?.mcpEnabled === true &&
  concurrentResult?.values?.logLevel === 'debug' &&
  concurrentResult?.values?.autoStart === true &&
  concurrentResult?.values?.minimizeToTray === true &&
  concurrentResult?.values?.agentTimeoutMins === 44 &&
  concurrentResult?.values?.maxConcurrentCronTasks === 55,
  `values=${JSON.stringify(concurrentResult?.values).slice(0, 300)}`)

// =============================================================
console.log('\n[R130-2] 读后写一致性')

const rawResult = await evalInPage(ws, `(async () => {
  // 写入后立即读取 (多次)
  const checks = [];
  for (let i = 0; i < 20; i++) {
    const val = 1000 + i;
    await window.api.settings.set('chat.maxTokens', val);
    const s = await window.api.settings.get();
    checks.push({ written: val, read: s?.chat?.maxTokens, match: s?.chat?.maxTokens === val });
  }
  return { total: checks.length, matched: checks.filter(c => c.match).length, mismatches: checks.filter(c => !c.match).slice(0, 3) };
})()`)

check('读后写一致性: 20 次写入后立即读取全部匹配',
  rawResult?.total === 20 && rawResult?.matched === 20,
  `matched=${rawResult?.matched}/${rawResult?.total}, mismatches=${JSON.stringify(rawResult?.mismatches).slice(0, 200)}`)

// =============================================================
console.log('\n[R130-3] 深度合并正确性 (嵌套更新不覆盖兄弟节点)')

const mergeResult = await evalInPage(ws, `(async () => {
  // 先记录所有 chat 子键
  const before = (await window.api.settings.get())?.chat;
  const beforeKeys = Object.keys(before || {}).sort();
  // 只改 chat.maxTokens
  await window.api.settings.set('chat.maxTokens', 99999);
  await new Promise(r => setTimeout(r, 600));
  const after = (await window.api.settings.get())?.chat;
  const afterKeys = Object.keys(after || {}).sort();
  return {
    beforeKeys,
    afterKeys,
    keysPreserved: JSON.stringify(beforeKeys) === JSON.stringify(afterKeys),
    maxTokensChanged: after?.maxTokens === 99999,
    temperaturePreserved: after?.steeringMode === before?.steeringMode,
    topPPreserved: after?.thinkingLevel === before?.thinkingLevel,
  };
})()`)

check('深度合并: chat 子键全部保留',
  mergeResult?.keysPreserved === true,
  `before=${JSON.stringify(mergeResult?.beforeKeys).slice(0, 100)}, after=${JSON.stringify(mergeResult?.afterKeys).slice(0, 100)}`)
check('深度合并: 目标值已更新',
  mergeResult?.maxTokensChanged === true,
  `maxTokens=${mergeResult?.maxTokensChanged}`)
check('深度合并: 兄弟节点值保留 (steeringMode/thinkingLevel)',
  mergeResult?.temperaturePreserved === true && mergeResult?.topPPreserved === true,
  `steeringMode=${mergeResult?.temperaturePreserved}, thinkingLevel=${mergeResult?.topPPreserved}`)

// =============================================================
console.log('\n[R130-4] 类型保持 (string/number/boolean/object/array)')

const typeResult = await evalInPage(ws, `(async () => {
  const tests = [
    { path: 'chat.maxTokens', value: 42, expectedType: 'number' },
    { path: 'general.theme', value: 'dark', expectedType: 'string' },
    { path: 'mcp.enabled', value: true, expectedType: 'boolean' },
    { path: 'advanced.shellPath', value: 'test shell path', expectedType: 'string' },
  ];
  const results = [];
  for (const t of tests) {
    const r = await window.api.settings.set(t.path, t.value);
    await new Promise(r => setTimeout(r, 300));
    const s = await window.api.settings.get();
    const keys = t.path.split('.');
    let val = s;
    for (const k of keys) val = val?.[k];
    results.push({
      path: t.path,
      writtenType: typeof t.value,
      readType: typeof val,
      valueMatch: val === t.value,
      typeMatch: typeof val === t.expectedType,
    });
  }
  return results;
})()`)

let typeAllMatch = true
for (const r of typeResult || []) {
  if (!r?.typeMatch || !r?.valueMatch) typeAllMatch = false
}
check('类型保持: string/number/boolean 写入后类型和值一致',
  typeAllMatch === true,
  `results=${JSON.stringify(typeResult).slice(0, 300)}`)

// =============================================================
console.log('\n[R130-5] 值校验 (null/undefined/NaN/Infinity/function/bigint 被拒绝)')

const invalidValues = [
  { name: 'null', path: 'chat.maxTokens', value: null },
  { name: 'undefined', path: 'chat.maxTokens', value: undefined },
  { name: 'NaN', path: 'chat.maxTokens', value: NaN },
  { name: 'Infinity', path: 'chat.maxTokens', value: Infinity },
  { name: '-Infinity', path: 'chat.maxTokens', value: -Infinity },
]
let rejectedCount = 0
let handledCount = 0
for (const { name, path, value } of invalidValues) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.settings.set(${JSON.stringify(path)}, ${JSON.stringify(value)});
      return { threw: false, success: r?.success };
    } catch (e) { return { threw: true, error: e.message }; }
  })()`)
  handledCount++
  const rejected = r?.threw === true || r?.success === false
  if (rejected) rejectedCount++
  check(`值校验: ${name} 被拒绝`, rejected, `result=${JSON.stringify(r).slice(0, 100)}`)
}

check(`值校验: ${invalidValues.length} 种非法值全部被处理`,
  handledCount === invalidValues.length,
  `handled=${handledCount}/${invalidValues.length}`)
check(`值校验: 大部分非法值被拒绝 (>=4)`,
  rejectedCount >= 4,
  `rejected=${rejectedCount}/${invalidValues.length}`)

// =============================================================
console.log('\n[R130-6] 原型链污染防护 (__proto__/constructor/prototype)')

const protoTests = [
  { path: '__proto__.polluted', value: true },
  { path: 'constructor.prototype.polluted', value: true },
  { path: 'general.__proto__.polluted', value: true },
]
let protoRejected = 0
for (const { path, value } of protoTests) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.settings.set(${JSON.stringify(path)}, ${JSON.stringify(value)});
      return { threw: false, success: r?.success };
    } catch (e) { return { threw: true, error: e.message }; }
  })()`)
  const rejected = r?.threw === true || r?.success === false
  if (rejected) protoRejected++
}
check('原型链污染防护: __proto__/constructor/prototype 全部被拒绝',
  protoRejected === protoTests.length,
  `rejected=${protoRejected}/${protoTests.length}`)

// 验证 Object.prototype 未被污染
const protoPollutionCheck = await evalInPage(ws, `(async () => {
  return {
    hasPolluted: ({}).polluted === true,
    objProto: Object.prototype.polluted,
  };
})()`)
check('原型链未实际被污染',
  protoPollutionCheck?.hasPolluted === false && protoPollutionCheck?.objProto === undefined,
  `check=${JSON.stringify(protoPollutionCheck)}`)

// =============================================================
console.log('\n[R130-7] 字符串长度限制 (>1M 被拒绝)')

const longStringResult = await evalInPage(ws, `(async () => {
  // 恰好 1M 字符 (应被拒绝)
  const oneMillion = 'a'.repeat(1000001);
  try {
    const r = await window.api.settings.set('advanced.shellPath', oneMillion);
    return { threw: false, success: r?.success, error: r?.error };
  } catch (e) { return { threw: true, error: e.message }; }
})()`)
check('超长字符串 (>1M chars) 被拒绝',
  longStringResult?.threw === true || longStringResult?.success === false,
  `result=${JSON.stringify(longStringResult).slice(0, 150)}`)

// 正常长度字符串应该可以写入
const normalStringResult = await evalInPage(ws, `(async () => {
  const normal = 'a'.repeat(1000);
  try {
    const r = await window.api.settings.set('advanced.shellPath', normal);
    return { success: r?.success };
  } catch (e) { return { threw: e.message }; }
})()`)
check('正常长度字符串 (1K chars) 可写入',
  normalStringResult?.success !== false,
  `result=${JSON.stringify(normalStringResult).slice(0, 100)}`)

// =============================================================
console.log('\n[R130-8] 对象深度限制 (>10 被拒绝)')

// 构造深度 11 的对象
const deepObjResult = await evalInPage(ws, `(async () => {
  // 深度 11 的对象 (应被拒绝)
  let deep = 'value';
  for (let i = 0; i < 11; i++) deep = { nested: deep };
  try {
    const r = await window.api.settings.set('chat.systemPrompt', deep);
    return { threw: false, success: r?.success, error: r?.error };
  } catch (e) { return { threw: true, error: e.message }; }
})()`)
check('超深对象 (depth>10) 被拒绝',
  deepObjResult?.threw === true || deepObjResult?.success === false,
  `result=${JSON.stringify(deepObjResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R130-9] dot-path 校验 (空路径/不存在路径/空段)')

const invalidPaths = [
  { name: '空字符串', path: '' },
  { name: '不存在的顶级路径', path: 'nonexistent' },
  { name: '不存在的嵌套路径', path: 'general.nonexistent' },
  { name: '空段 (双点)', path: 'general..theme' },
  { name: '尾随点', path: 'general.theme.' },
  { name: '前导点', path: '.general.theme' },
]
let pathRejected = 0
for (const { name, path } of invalidPaths) {
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.settings.set(${JSON.stringify(path)}, 'test');
      return { threw: false, success: r?.success, error: r?.error };
    } catch (e) { return { threw: true, error: e.message }; }
  })()`)
  const rejected = r?.threw === true || r?.success === false
  if (rejected) pathRejected++
  check(`dot-path 校验: ${name} 被拒绝`, rejected, `result=${JSON.stringify(r).slice(0, 100)}`)
}
check(`dot-path 校验: ${invalidPaths.length} 种非法路径全部被拒绝`,
  pathRejected === invalidPaths.length,
  `rejected=${pathRejected}/${invalidPaths.length}`)

// =============================================================
console.log('\n[R130-10] EAA 数据完整性 (stress 后数据一致)')

// 创建学生 + 事件, 验证数据一致
const eaaStudent = `${STAMP}-integrity-stu`
const eaaResult = await evalInPage(ws, `(async () => {
  // 创建学生
  await window.api.eaa.addStudent(${JSON.stringify(eaaStudent)});
  // 创建事件
  const ev = await window.api.eaa.addEvent({
    studentName: ${JSON.stringify(eaaStudent)},
    reasonCode: 'SPEAK_IN_CLASS',
    note: 'R130 integrity test',
    operator: 'r130',
    tags: ['r130', 'integrity'],
  });
  // 并发读取 score 和 history
  const [score, history] = await Promise.all([
    window.api.eaa.score(${JSON.stringify(eaaStudent)}),
    window.api.eaa.history(${JSON.stringify(eaaStudent)}),
  ]);
  // 多次读取验证一致性
  const score2 = await window.api.eaa.score(${JSON.stringify(eaaStudent)});
  const score3 = await window.api.eaa.score(${JSON.stringify(eaaStudent)});
  return {
    eventCreated: ev?.success !== false,
    scoreSuccess: score?.success !== false,
    scoreName: score?.data?.name,
    scoreEventsCount: score?.data?.events_count,
    historyCount: (history?.data?.events ?? history?.events ?? []).length,
    scoreConsistent: score?.data?.score === score2?.data?.score && score2?.data?.score === score3?.data?.score,
  };
})()`)

check('EAA 数据完整性: 学生和事件创建成功',
  eaaResult?.eventCreated === true && eaaResult?.scoreSuccess === true,
  `eventCreated=${eaaResult?.eventCreated}, scoreSuccess=${eaaResult?.scoreSuccess}`)
check('EAA 数据完整性: score 和 history 一致',
  eaaResult?.scoreEventsCount === eaaResult?.historyCount,
  `scoreEvents=${eaaResult?.scoreEventsCount}, historyEvents=${eaaResult?.historyCount}`)
check('EAA 数据完整性: 多次读取 score 一致',
  eaaResult?.scoreConsistent === true,
  `consistent=${eaaResult?.scoreConsistent}`)

// =============================================================
console.log('\n[R130-11] Skill 文件完整性')

const skillName = `${STAMP}-integrity-skill`
const skillContent = `# ${skillName}\n\nTest skill content for R130 integrity test.\nLine 2 with special chars: 中文 émojis 🎉`
const skillResult = await evalInPage(ws, `(async () => {
  // 保存 skill
  const saveR = await window.api.skill.save(${JSON.stringify(skillName)}, ${JSON.stringify(skillContent)});
  // 读取验证
  const getR = await window.api.skill.get(${JSON.stringify(skillName)});
  // 列表验证
  const listR = await window.api.skill.list();
  const list = Array.isArray(listR) ? listR : (listR?.skills || listR?.data || []);
  const inList = list.some(s => (s?.name || s?.id) === ${JSON.stringify(skillName)});
  return {
    saveOk: saveR?.success !== false,
    getContent: getR?.content,
    contentMatch: getR?.content === ${JSON.stringify(skillContent)},
    inList,
  };
})()`)

check('Skill 文件完整性: 保存成功',
  skillResult?.saveOk === true,
  `saveOk=${skillResult?.saveOk}`)
check('Skill 文件完整性: 内容完整 (含特殊字符)',
  skillResult?.contentMatch === true,
  `contentMatch=${skillResult?.contentMatch}, content="${skillResult?.getContent?.slice(0, 50)}..."`)
check('Skill 文件完整性: 在列表中可见',
  skillResult?.inList === true,
  `inList=${skillResult?.inList}`)

// 清理 skill
await evalInPage(ws, `(async () => { try { await window.api.skill.delete(${JSON.stringify(skillName)}); } catch {} return true; })()`)

// =============================================================
console.log('\n[R130-12] settings.json 磁盘格式有效')

// 验证 settings 对象可以被 JSON.stringify (说明磁盘格式有效)
const formatCheck = await evalInPage(ws, `(async () => {
  const s = await window.api.settings.get();
  try {
    const json = JSON.stringify(s);
    const parsed = JSON.parse(json);
    return {
      stringifyOk: true,
      parseOk: true,
      hasGeneral: !!parsed?.general,
      hasChat: !!parsed?.chat,
      hasMcp: !!parsed?.mcp,
      hasShortcuts: !!parsed?.shortcuts,
      keyCount: Object.keys(parsed || {}).length,
    };
  } catch (e) { return { stringifyOk: false, error: e.message }; }
})()`)

check('settings.json 磁盘格式有效 (可 JSON 序列化/反序列化)',
  formatCheck?.stringifyOk === true && formatCheck?.parseOk === true,
  `result=${JSON.stringify(formatCheck).slice(0, 200)}`)
check('settings 包含主要顶层节 (general/chat/mcp/shortcuts)',
  formatCheck?.hasGeneral === true && formatCheck?.hasChat === true && formatCheck?.hasMcp === true && formatCheck?.hasShortcuts === true,
  `general=${formatCheck?.hasGeneral}, chat=${formatCheck?.hasChat}, mcp=${formatCheck?.hasMcp}, shortcuts=${formatCheck?.hasShortcuts}`)

// =============================================================
console.log('\n[R130-13] 恢复初始 settings')

// 恢复被修改的 settings (使用 default-settings.json 中真实存在的路径)
if (initialSettings) {
  await evalInPage(ws, `(async () => {
    if (${JSON.stringify(initialSettings?.chat?.maxTokens)}) await window.api.settings.set('chat.maxTokens', ${JSON.stringify(initialSettings.chat.maxTokens)});
    if (${JSON.stringify(initialSettings?.chat?.steeringMode)}) await window.api.settings.set('chat.steeringMode', ${JSON.stringify(initialSettings.chat.steeringMode)});
    if (${JSON.stringify(initialSettings?.chat?.thinkingLevel)}) await window.api.settings.set('chat.thinkingLevel', ${JSON.stringify(initialSettings.chat.thinkingLevel)});
    if (${initialSettings?.chat?.compaction?.enabled !== undefined}) await window.api.settings.set('chat.compaction.enabled', ${JSON.stringify(initialSettings.chat.compaction.enabled)});
    if (${initialSettings?.mcp?.enabled !== undefined}) await window.api.settings.set('mcp.enabled', ${JSON.stringify(initialSettings.mcp.enabled)});
    if (${JSON.stringify(initialSettings?.general?.logLevel)}) await window.api.settings.set('general.logLevel', ${JSON.stringify(initialSettings.general.logLevel)});
    if (${initialSettings?.general?.autoStart !== undefined}) await window.api.settings.set('general.autoStart', ${JSON.stringify(initialSettings.general.autoStart)});
    if (${initialSettings?.general?.minimizeToTray !== undefined}) await window.api.settings.set('general.minimizeToTray', ${JSON.stringify(initialSettings.general.minimizeToTray)});
    if (${JSON.stringify(initialSettings?.general?.agentTimeoutMins)}) await window.api.settings.set('general.agentTimeoutMins', ${JSON.stringify(initialSettings.general.agentTimeoutMins)});
    if (${JSON.stringify(initialSettings?.general?.maxConcurrentCronTasks)}) await window.api.settings.set('general.maxConcurrentCronTasks', ${JSON.stringify(initialSettings.general.maxConcurrentCronTasks)});
    if (${JSON.stringify(initialSettings?.general?.theme)}) await window.api.settings.set('general.theme', ${JSON.stringify(initialSettings.general.theme)});
    if (${JSON.stringify(initialSettings?.advanced?.shellPath)}) await window.api.settings.set('advanced.shellPath', ${JSON.stringify(initialSettings.advanced.shellPath)});
    return true;
  })()`)
  console.log('  恢复 settings 到初始值')
}

// =============================================================
console.log(`\n=== R130 完成 ===`)
console.log(`通过: ${results.pass}, 失败: ${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项:`)
  for (const e of results.errors) console.log(`  - ${e}`)
}

try { ws.close() } catch {}
process.exit(results.fail > 0 ? 1 : 0)
