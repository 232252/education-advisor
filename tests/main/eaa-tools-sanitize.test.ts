// =============================================================
// EAA Tools 安全测试（P1-14 safeExecute / sanitizeArg / P1-16 tokenizeQuery）
// - 通过 mock ./eaa-bridge 拦截真实 EAA CLI 调用
// - 通过公共 tool.execute() 触发内部 safeExecute / sanitizeArg / tokenizeQuery
//
// 覆盖矩阵（对应 task add-eaa-sanitize-tests 的 6 个 must-have 场景）：
//   [1] 正常 ASCII / 中文名字通过        → "正常 ASCII / 中文名字通过" describe 块
//   [2] 拒绝控制字符 (NULL/BELL/ESC)     → "拒绝控制字符" describe 块
//   [3] 拒绝 shell 元字符 (; & | $ ` ...) → "拒绝 shell 元字符" describe 块
//   [4] 拒绝 -- 开头                     → "拒绝 --开头" describe 块
//   [5] 换行 / 回车 / Tab 处理           → "换行 / 回车 / Tab 处理" describe 块
//                                         （见该块内注：当前源码保留 LF/CR/Tab，与 task 描述略有差异）
//   [6] flags 参数（程序硬编码）跳过 sanitize → "flags 参数（程序硬编码）跳过 sanitize" describe 块
// 额外：错误路径透传 + tokenizeQuery（8 例）
// 总计 34 个 it() 用例（it.each 中的每一行计 1）
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// hoisted mock：必须在 import eaa-tools之前生效
// 同时 mock getErrorMessage:eaa-tools 在 safeExecute 里会调它把
// success=false 的 result 转成 throw 出去的 Error.message
const bridge = vi.hoisted(() => ({
 execute: vi.fn(),
}))

vi.mock('../../src/main/services/eaa-bridge', () => ({
 eaaBridge: bridge,
 // 简化版 getErrorMessage:失败时优先取 result.error,再取 stderr,最后 fallback
 getErrorMessage: (result: { success: boolean; error?: string; stderr?: string }, fallback: string) =>
  !result?.success ? (result?.error || result?.stderr || fallback) : fallback,
}))

//重要：import 必须发生在 vi.mock之后
const { queryScoreTool, addEventTool, searchEventsTool, historyTool, addStudentTool } =
 await import('../../src/main/services/eaa-tools')

describe('eaa-tools: safeExecute / sanitizeArg', () => {
 beforeEach(() => {
 bridge.execute.mockReset()
 bridge.execute.mockResolvedValue({
 success: true,
 data: { ok: true },
 stderr: '',
 exitCode:0,
 })
 })

 afterEach(() => {
 vi.restoreAllMocks()
 })

 // --------正常 ASCII / 中文名字 --------
 describe('正常 ASCII / 中文名字通过', () => {
 it('中文名 "张三" 不抛错并传给 eaaBridge.execute', async () => {
 await queryScoreTool.execute('tc-1', { name: '张三' })
 expect(bridge.execute).toHaveBeenCalledTimes(1)
 const call = bridge.execute.mock.calls[0][0]
 expect(call.command).toBe('score')
 expect(call.args).toEqual(['张三'])
 })

 it('英文名 "Alice" 不抛错', async () => {
 await queryScoreTool.execute('tc-2', { name: 'Alice' })
 expect(bridge.execute).toHaveBeenCalledTimes(1)
 expect(bridge.execute.mock.calls[0][0].args).toEqual(['Alice'])
 })

 it('中文 +数字混合 "陈7" 不抛错', async () => {
 await queryScoreTool.execute('tc-3', { name: '陈7' })
 expect(bridge.execute.mock.calls[0][0].args).toEqual(['陈7'])
 })
 })

 // -------- 控制字符 --------
 describe('拒绝控制字符', () => {
 it('"abc\\u0000def" 应抛错（NULL byte）', async () => {
 await expect(queryScoreTool.execute('tc', { name: 'abc\u0000def' })).rejects.toThrow(
 /控制字符/,
 )
 expect(bridge.execute).not.toHaveBeenCalled()
 })

 it('"abc\\u0007def" 应抛错（BELL \\x07）', async () => {
 await expect(queryScoreTool.execute('tc', { name: 'abc\u0007def' })).rejects.toThrow(
 /控制字符/,
 )
 expect(bridge.execute).not.toHaveBeenCalled()
 })

 it('"\\u001b[31m" 应抛错（ESC）', async () => {
 await expect(queryScoreTool.execute('tc', { name: '\u001b[31m' })).rejects.toThrow(
 /控制字符/,
 )
 expect(bridge.execute).not.toHaveBeenCalled()
 })
 })

 // -------- shell 元字符 --------
 describe('拒绝 shell 元字符', () => {
 it.each([
 ['"a;b"', ';'],
 ['"a&b"', '&'],
 ['"a|b"', '|'],
 ['"$(rm -rf /)"', '$('],
 ['"a`b"', '`'],
 ['"a>b"', '>'],
 ['"a<b"', '<'],
 ['"a*b"', '*'],
 ['"a?b"', '?'],
 ['"a\\b"', '\\'],
])('%s 应抛错（包含元字符 %s）', async (input) => {
 await expect(queryScoreTool.execute('tc', { name: input })).rejects.toThrow(
 /shell 元字符/,
 )
 expect(bridge.execute).not.toHaveBeenCalled()
 })
 })

 // -------- --开头 --------
 describe('拒绝 --开头', () => {
  it('"--version" 应抛错', async () => {
  await expect(queryScoreTool.execute('tc', { name: '--version' })).rejects.toThrow(
  /以 -- 开头/,
  )
  expect(bridge.execute).not.toHaveBeenCalled()
  })

  it('"--help" 应抛错', async () => {
  await expect(queryScoreTool.execute('tc', { name: '--help' })).rejects.toThrow(
  /以 -- 开头/,
  )
  expect(bridge.execute).not.toHaveBeenCalled()
  })

  it('addEventTool 中 student_name="--xxx" 也应抛错', async () => {
  await expect(
  addEventTool.execute('tc', {
  student_name: '--evil',
  reason_code: 'LATE',
  }),
  ).rejects.toThrow(/以 -- 开头/)
  expect(bridge.execute).not.toHaveBeenCalled()
  })
 })

  // --------换行 / 回车 / Tab --------
  // 注：sanitizeArg 实现 (eaa-tools.ts:43-49) 注释明确写明 "保留 \t \n \r"
  // 即 LF (0x0A) / CR (0x0D) / TAB (0x09) 是被放行的，只有 <0x20 且不在 9/10/13 之列的控制字符才拒绝。
  // 下述测试反映当前源码行为,如有收紧需求需先改源码。
  describe('换行 / 回车 / Tab 处理', () => {
  it('"a\\nb" 不抛错（源码保留 LF charCode=10）', async () => {
  await queryScoreTool.execute('tc', { name: 'a\nb' })
  expect(bridge.execute).toHaveBeenCalledTimes(1)
  expect(bridge.execute.mock.calls[0][0].args).toEqual(['a\nb'])
  })

  it('"a\\rb" 不抛错（源码保留 CR charCode=13）', async () => {
  await queryScoreTool.execute('tc', { name: 'a\rb' })
  expect(bridge.execute).toHaveBeenCalledTimes(1)
  expect(bridge.execute.mock.calls[0][0].args).toEqual(['a\rb'])
  })

  it('"a\\tb" 不抛错（tab 是允许的, charCode9）', async () => {
  await queryScoreTool.execute('tc', { name: 'a\tb' })
  expect(bridge.execute.mock.calls[0][0].args).toEqual(['a\tb'])
  })
  })

 // -------- flags跳过 sanitize --------
 describe('flags 参数（程序硬编码）跳过 sanitize', () => {
 it('"--from=2024-01-01" 通过 addEventTool 不抛错（来自 --delta 等内置 flags路径）', async () => {
 // 这里测试 addEventTool 因为它通过 flags传 "--delta" 等
 // 同时 flags路径走的是同样的 safeExecute(values, flags)，但 flags 不 sanitize
 await addEventTool.execute('tc', {
 student_name: '张三',
 reason_code: 'LATE',
 delta: -5,
 note: '--from=2024-01-01',
 })
 expect(bridge.execute).toHaveBeenCalledTimes(1)
 const call = bridge.execute.mock.calls[0][0]
 // values 部分应被 sanitize 后传入（合法）
 expect(call.command).toBe('add')
 expect(call.args[0]).toBe('张三')
 expect(call.args[1]).toBe('LATE')
 // flags 部分（含 --delta / --note 等）原样保留
 expect(call.args).toContain('--delta')
 expect(call.args).toContain('-5')
 expect(call.args).toContain('--note')
 expect(call.args).toContain('--from=2024-01-01')
 })

 it('historyTool传入合法 name 直接转给 eaaBridge', async () => {
 await historyTool.execute('tc', { name: 'Bob' })
 const call = bridge.execute.mock.calls[0][0]
 expect(call.command).toBe('history')
 expect(call.args).toEqual(['Bob'])
 })

 it('addStudentTool合法名直接转给 eaaBridge', async () => {
 await addStudentTool.execute('tc', { name: 'Newbie' })
 const call = bridge.execute.mock.calls[0][0]
 expect(call.command).toBe('add-student')
 expect(call.args).toEqual(['Newbie'])
 })
 })

 // -------- error透传 --------
 describe('错误路径透传', () => {
 it('eaaBridge 返回 success=false 时抛错', async () => {
 bridge.execute.mockResolvedValueOnce({
 success: false,
 data: null,
 stderr: 'student not found',
 exitCode:1,
 })
 await expect(queryScoreTool.execute('tc', { name: 'Bob' })).rejects.toThrow(
 /student not found/,
 )
 })
 })
})

// =============================================================
// eaa-tools: tokenizeQuery（P1-16 通过 searchEventsTool间接测）
// =============================================================

describe('eaa-tools: tokenizeQuery (via searchEventsTool)', () => {
 let receivedArgs: string[]

 beforeEach(() => {
 receivedArgs = []
 bridge.execute.mockReset()
 bridge.execute.mockImplementation(async (cmd: { args: string[] }) => {
 receivedArgs = cmd.args
 return { success: true, data: [], stderr: '', exitCode:0 }
 })
 })

 afterEach(() => {
 vi.restoreAllMocks()
 })

  it('空格分隔 "张三 迟到" → ["张三", "迟到"]', async () => {
  await searchEventsTool.execute('tc', { query: '张三 迟到' })
  expect(receivedArgs).toEqual(['张三', '迟到'])
  })

 it('双引号包裹复合词 "\\"张三迟到\\"" → ["张三迟到"]', async () => {
 await searchEventsTool.execute('tc', { query: '"张三迟到"' })
 expect(receivedArgs).toEqual(['张三迟到'])
 })

 it('混合 "a \\"b c\\" d" → ["a", "b c", "d"]', async () => {
 await searchEventsTool.execute('tc', { query: 'a "b c" d' })
 expect(receivedArgs).toEqual(['a', 'b c', 'd'])
 })

 it('空字符串 "" → []', async () => {
 await searchEventsTool.execute('tc', { query: '' })
 expect(receivedArgs).toEqual([])
 })

 it('仅有空格 " " → []', async () => {
 await searchEventsTool.execute('tc', { query: ' ' })
 expect(receivedArgs).toEqual([])
 })

 it('query 带 limit 参数时 args末尾追加 --limit <n>', async () => {
 await searchEventsTool.execute('tc', { query: 'a b', limit:25 })
 expect(receivedArgs).toEqual(['a', 'b', '--limit', '25'])
 })

 it('单 token "迟到" → ["迟到"]', async () => {
 await searchEventsTool.execute('tc', { query: '迟到' })
 expect(receivedArgs).toEqual(['迟到'])
 })

 it('只有引号 """""" → []', async () => {
  // """""" = "" + "" + "" (三对空引号) → token都被吃完
  await searchEventsTool.execute('tc', { query: '""""""' })
  expect(receivedArgs).toEqual([])
  })

  it('query 含 shell 元字符应被 safeExecute 拒绝', async () => {
  // RISK 验证：searchEventsTool 现在走 safeExecute,query 中的 ; 应抛错
  await expect(searchEventsTool.execute('tc', { query: 'foo;rm -rf /' })).rejects.toThrow(
  /shell 元字符/,
  )
  })

  it('query 含 -- 开头应被 safeExecute 拒绝', async () => {
  // RISK 验证：-- 开头在 tokenizeQuery 后可能变成 args 第一个元素,被 safeExecute 拒绝
  await expect(searchEventsTool.execute('tc', { query: '--bad-flag' })).rejects.toThrow(
  /\-\-/,
  )
  })
})
