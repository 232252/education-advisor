// =============================================================
// 脱敏引擎 × dsh 工具桥 —— 跨进程边界仍然成立
//
// 自动脱敏是在 `buildAgentTools(..., privacyGuard)` 里靠 wrapTool 包在工具外面的，
// dsh 后端不共享 Agent 进程内存：它是另一个进程，通过 HTTP 调这座桥。
// 所以"包装发生在哪一层"必须被证明，而不是靠"两条链路用的是同一份 tools 数组"来推。
// =============================================================

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrivacyGuard } from '../../agent/privacy-guard'
import type { ExposedTool } from '../eaa-mcp-server'
import {
  ensureActiveEaaToolBridge,
  mountEaaAgentTools,
  stopActiveEaaToolBridge,
} from '../tool-bridge'

const bridgeMock = vi.hoisted(() => ({
  execute: vi.fn(),
  hasPrivacyPassword: vi.fn(),
}))

vi.mock('../../eaa-bridge', () => ({ eaaBridge: bridgeMock }))
vi.mock('../../settings-service', () => ({
  settingsService: { getSettings: () => ({ privacy: { enabled: false, autoAnonymize: false } }) },
}))

const { invalidatePrivacyGuardCache, PrivacyGuard: GuardCtor } = await import(
  '../../agent/privacy-guard'
)

const LIST_OUTPUT = ['类型           化名         真名', '学生           S_001       王小明'].join(
  '\n',
)

async function makeGuard(): Promise<PrivacyGuard> {
  invalidatePrivacyGuardCache()
  bridgeMock.execute.mockResolvedValue({
    success: true,
    data: LIST_OUTPUT,
    stderr: '',
    exitCode: 0,
  })
  return GuardCtor.create()
}

async function callTool(
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = (await res.json()) as {
    result?: { content?: { type: string; text?: string }[] }
    error?: { message?: string }
  }
  if (body.error) throw new Error(`MCP 调用失败: ${body.error.message}`)
  const parts = body.result?.content ?? []
  return { text: parts.map((p) => p.text ?? '').join('\n') }
}

/**
 * 生产里 execution 交给桥的就是 wrapTool 之后的那批工具；wrapTool 原地改写
 * execute 并把同一个对象返回，所以这里只需要过一次类型转接（两边的 execute
 * 形参宽窄不同：ExposedTool 是 params: never，wrapTool 约束是 params: any）。
 */
function guardedTool(guard: PrivacyGuard, tool: ExposedTool): ExposedTool {
  return guard.wrapTool(
    // biome-ignore lint/suspicious/noExplicitAny: wrapTool 的约束就是 params: any
    tool as unknown as { execute: (id: string, params: any) => Promise<unknown> },
  ) as unknown as ExposedTool
}

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eaa-bridge-privacy-'))
})

afterEach(async () => {
  await stopActiveEaaToolBridge()
  invalidatePrivacyGuardCache()
  await rm(dir, { recursive: true, force: true })
})

describe('脱敏 × dsh 工具桥', () => {
  it('工具结果出域时被化名替换：桥另一端的 dsh 看不到真实姓名', async () => {
    await ensureActiveEaaToolBridge({ patchDir: dir })
    const guard = await makeGuard()
    const raw: ExposedTool = {
      name: 'query_score',
      description: '查成绩',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({
        content: [{ type: 'text', text: '王小明 数学 92 分，年级第 3' }],
      }),
    }
    const mount = await mountEaaAgentTools({
      label: 'academic',
      tools: [guardedTool(guard, raw)],
    })
    try {
      const { text } = await callTool(mount.endpoint.url, mount.endpoint.token, 'query_score', {})
      expect(text).toContain('S_001')
      expect(text).not.toContain('王小明')
    } finally {
      await mount.release()
    }
  })

  it('模型给的化名在工具内被还原成真名（否则查不到数据）', async () => {
    await ensureActiveEaaToolBridge({ patchDir: dir })
    const guard = await makeGuard()
    let seenByTool = ''
    const raw: ExposedTool = {
      name: 'student_detail',
      description: '看学生详情',
      parameters: { type: 'object', properties: { name: { type: 'string' } } },
      execute: async (_id: string, params: { name?: string }) => {
        seenByTool = String(params?.name ?? '')
        return { content: [{ type: 'text', text: `${seenByTool} 操行 2 条` }] }
      },
    }
    const mount = await mountEaaAgentTools({ label: 'safety', tools: [guardedTool(guard, raw)] })
    try {
      const { text } = await callTool(mount.endpoint.url, mount.endpoint.token, 'student_detail', {
        name: 'S_001',
      })
      expect(seenByTool).toBe('王小明') // 入域：化名 → 真名
      expect(text).toContain('S_001') // 出域：真名 → 化名
      expect(text).not.toContain('王小明')
    } finally {
      await mount.release()
    }
  })

  it('未开脱敏的运行不改动内容（两条后端都按原样）', async () => {
    await ensureActiveEaaToolBridge({ patchDir: dir })
    await makeGuard()
    invalidatePrivacyGuardCache()
    bridgeMock.execute.mockResolvedValue({ success: true, data: '', stderr: '', exitCode: 0 })
    const bare: ExposedTool = {
      name: 'class_summary',
      description: '班级小结',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ content: [{ type: 'text', text: '王小明 进步' }] }),
    }
    const mount = await mountEaaAgentTools({ label: 'main', tools: [bare] })
    try {
      const { text } = await callTool(mount.endpoint.url, mount.endpoint.token, 'class_summary', {})
      expect(text).toBe('王小明 进步')
    } finally {
      await mount.release()
    }
  })
})
