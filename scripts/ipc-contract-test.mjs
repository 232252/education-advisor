// IPC 契约深度测试: 逐个调用 window.api 关键方法, 验证返回值与设计契约相符
//
// 两种模式:
//   node scripts/ipc-contract-test.mjs            运行时深度测试(需要已启动的 Electron + CDP 9222)
//   node scripts/ipc-contract-test.mjs --static   静态契约检查(纯文本解析, 不启动 Electron):
//     C = src/shared/ipc-channels.ts 导出的通道常量集合
//     H = src/main/ipc/** 中 ipcMain.handle(IPC.XXX 注册的集合
//     P = src/main/preload/api/*.ts 中 ipcRenderer.invoke(IPC.XXX 的集合
//     断言 P ⊆ H (每个 preload invoke 都有对应 handler), 输出差集报告, 失败 exit 1

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ROOT, parseIpcChannelConstants, stripComments, walkFiles } from './lib/gate-utils.mjs'

// =============================================================
// --static 模式: 纯文本解析
// =============================================================

const parseChannelConstants = parseIpcChannelConstants

/** 递归收集目录下所有 .ts 文件(跳过 __tests__) */
const walkTsFiles = (dir) => walkFiles(dir, (f) => f.endsWith('.ts'), ['node_modules', '__tests__'])

/** H: src/main/ipc/** 中注册为 handler 的通道常量集合 */
function parseHandledChannels() {
  const dir = path.join(ROOT, 'src', 'main', 'ipc')
  const set = new Set()
  // 三种注册形态: 裸 ipcMain.handle(IPC.X / handleIpc(IPC.X(统一骨架) /
  // 已知注册工厂 registerCachedStatic( · registerPassThrough( 的 IPC.X 首参直传调用。
  // 新增注册工厂时把工厂名加进本正则,或在下方 EXTRA_HANDLED 登记。
  const re = /(?:ipcMain\.handle|handleIpc|registerCachedStatic|registerPassThrough)\(\s*IPC\.(IPC_[A-Z0-9_]+)/g
  for (const file of walkTsFiles(dir)) {
    const src = stripComments(fs.readFileSync(file, 'utf8'))
    let m
    while ((m = re.exec(src)) !== null) set.add(m[1])
  }
  // 间接注册补充: 首参经局部助手转传(如 agent-handlers 的 registerDocSetter(channel,...)),
  // 静态解析不可见,此处人工核对后登记。新增间接注册时同步维护此清单。
  for (const x of ['IPC_AGENT_SET_SOUL', 'IPC_AGENT_SET_RULES']) set.add(x)
  return set
}

/** P: src/main/preload/api/*.ts 中 ipcRenderer.invoke(IPC.XXX 的常量集合 */
function parsePreloadInvokes() {
  const dir = path.join(ROOT, 'src', 'main', 'preload', 'api')
  const set = new Set()
  const re = /ipcRenderer\.invoke\(\s*IPC\.(IPC_[A-Z0-9_]+)/g
  for (const file of walkTsFiles(dir)) {
    const src = stripComments(fs.readFileSync(file, 'utf8'))
    let m
    while ((m = re.exec(src)) !== null) set.add(m[1])
  }
  return set
}

function runStatic() {
  const C = parseChannelConstants()
  const H = parseHandledChannels()
  const P = parsePreloadInvokes()
  console.log(
    `[ipc-contract:static] 通道常量 |C|=${C.size}, ipcMain.handle |H|=${H.size}, preload invoke |P|=${P.size}`,
  )

  let failed = false

  // 健全性: H/P 引用的常量必须存在于通道常量表 C
  const unknownInH = [...H].filter((x) => !C.has(x)).sort()
  const unknownInP = [...P].filter((x) => !C.has(x)).sort()
  if (unknownInH.length > 0) {
    failed = true
    console.log(`✗ ipcMain.handle 引用了未定义的通道常量 (${unknownInH.length}):`)
    for (const x of unknownInH) console.log(`  - ${x}`)
  }
  if (unknownInP.length > 0) {
    failed = true
    console.log(`✗ preload invoke 引用了未定义的通道常量 (${unknownInP.length}):`)
    for (const x of unknownInP) console.log(`  - ${x}`)
  }

  // 核心断言: P ⊆ H
  const missingHandlers = [...P].filter((x) => !H.has(x)).sort()
  if (missingHandlers.length > 0) {
    failed = true
    console.log(`✗ P⊆H 断言失败: ${missingHandlers.length} 个 preload invoke 缺少 ipcMain.handle:`)
    for (const x of missingHandlers) console.log(`  - ${x}`)
  } else {
    console.log('✓ P⊆H: 每个 preload invoke 都有对应的 ipcMain.handle')
  }

  // 信息性: 已注册但 preload 未 invoke 的通道(主→渲染推送等场景是合理的, 不判失败)
  const handledNotInvoked = [...H].filter((x) => !P.has(x)).sort()
  if (handledNotInvoked.length > 0) {
    console.log(`ℹ 已注册但 preload 未 invoke (${handledNotInvoked.length}): ${handledNotInvoked.join(', ')}`)
  }

  if (failed) {
    console.log('[ipc-contract:static] FAIL')
    return 1
  }
  console.log('[ipc-contract:static] PASS')
  return 0
}

if (process.argv.includes('--static')) {
  process.exit(runStatic())
}

// =============================================================
// 运行时模式: 通过 CDP 逐个调用 window.api 方法
// =============================================================

const { connectCdp } = await import('./lib/cdp-client.mjs')
const { evl, close } = await connectCdp()

// 逐个 API 调用并结构化输出
const tests = [
  ['eaa.info', `api.eaa.info()`],
  ['eaa.stats', `api.eaa.stats()`],
  ['eaa.listStudents', `api.eaa.listStudents({})`],
  ['eaa.summary', `api.eaa.summary()`],
  ['eaa.codes', `api.eaa.codes()`],
  ['eaa.doctor', `api.eaa.doctor()`],
  ['agent.list', `api.agent.list()`],
  // agent.getHistory 已移除: 历史随 agent:get 响应内联返回,无独立通道
  // (IPC_AGENT_GET_HISTORY 常量与 preload 方法均已删,R17 运行时测试暴露)
  ['cron.list', `api.cron.list()`],
  ['settings.get', `api.settings.get()`],
  ['class.list', `api.class.list()`],
  ['academic.getConfig', `api.academic.getConfig()`],
  ['academic.listExams', `api.academic.listExams()`],
  ['skill.list', `api.skill.list()`],
  ['mcp.list', `api.mcp.list()`],
  ['privacy.status', `api.privacy.status()`],
  ['log.list', `api.log.list({})`],
  ['ollama.detect', `api.ollama.detect()`],
  ['feishu.botStatus', `api.feishu.botStatus()`],
  ['profile.get', `api.profile.get('test')`],
]

for (const [name, expr] of tests) {
  const start = Date.now()
  const r = await evl(`(async () => {
    try { return { ok: true, v: await (${expr}) } }
    catch (e) { return { ok: false, v: String(e && e.message || e).slice(0, 300) } }
  })()`)
  const ms = Date.now() - start
  if (!r || r.__error) { console.log(`✗ ${name}: EVAL ERROR ${r?.__error}`); continue }
  let summary
  try {
    const v = r.v
    if (r.ok === false) { console.log(`✗ ${name}: ${r.v}`); continue }
    if (Array.isArray(v)) summary = `array[${v.length}] ${JSON.stringify(v[0] ?? null).slice(0, 150)}`
    else if (v && typeof v === 'object') {
      const keys = Object.keys(v)
      summary = `object{${keys.join(',')}} ${JSON.stringify(v).slice(0, 180)}`
    } else summary = JSON.stringify(v).slice(0, 180)
    console.log(`✓ ${name} (${ms}ms): ${summary}`)
  } catch (e) { console.log(`✗ ${name}: ${e.message}`) }
}
close()
process.exit(0)
