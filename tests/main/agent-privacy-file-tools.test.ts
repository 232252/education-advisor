// =============================================================
// R2-07/R2-08 测试 — 脱敏旁路封堵与记忆双向脱敏
// 覆盖: (a) 只读文件工具(read_file)结果经 wrapTool 脱敏
//       (b) 写类文件工具(write_file)不被包装(本地落盘保留真名)
//       (c) save_memory 落盘前化名→真名
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const bridgeMock = vi.hoisted(() => ({
  execute: vi.fn(),
  hasPrivacyPassword: vi.fn(),
}))

vi.mock('../../src/main/services/eaa-bridge', () => ({ eaaBridge: bridgeMock }))

const memoryMock = vi.hoisted(() => ({
  addEntry: vi.fn((agentId: string, content: string, category: string) => ({
    category,
    content,
  })),
  getMemorySection: vi.fn(() => ''),
}))

vi.mock('../../src/main/services/agent/memory-service', () => ({
  memoryService: memoryMock,
}))

// tools.ts → privacy-guard → settings-service 顶层构造需要 app.getPath
vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'privacy-file-tools-electron'),
    isPackaged: false,
  },
}))

import { PrivacyGuard } from '../../src/main/services/agent/privacy-guard'
import { buildAgentTools } from '../../src/main/services/agent/tools'
import { createMemoryTool } from '../../src/main/services/agent/memory-tool'

const LIST_OUTPUT = [
  '类型           化名         真名',
  '学生           S_001       王小明',
].join('\n')

async function makeGuard(): Promise<PrivacyGuard> {
  bridgeMock.execute.mockResolvedValue({ success: true, data: LIST_OUTPUT, stderr: '', exitCode: 0 })
  return PrivacyGuard.create()
}

describe('R2-07 只读文件工具纳入脱敏', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-file-tools-'))

  it('read_file 结果中的真名被替换为化名', async () => {
    const file = path.join(tmpDir, 'roster.txt')
    fs.writeFileSync(file, '王小明 迟到 -2', 'utf-8')

    const guard = await makeGuard()
    const tools = await buildAgentTools(
      { id: 'test-agent', name: 't', role: 'r', description: 'd', capabilities: [] } as unknown as Parameters<typeof buildAgentTools>[0],
      'test-agent',
      undefined,
      undefined,
      undefined,
      guard,
    )
    // biome-ignore lint/suspicious/noExplicitAny: 测试直接驱动执行
    const readTool = tools.find((t: any) => t.name === 'read_file')
    expect(readTool).toBeDefined()

    // 工具需要真实写盘路径 — 直接以文件路径为参数调用
    // biome-ignore lint/suspicious/noExplicitAny: 测试直接驱动执行
    const result = await readTool.execute('call-1', { path: file } as any)
    const text = typeof result === 'string' ? result : JSON.stringify(result)
    expect(text).toContain('S_001')
    expect(text).not.toContain('王小明')
  })

  it('write_file 不被包装 — 落盘保留真名', async () => {
    const guard = await makeGuard()
    const tools = await buildAgentTools(
      { id: 'test-agent', name: 't', role: 'r', description: 'd', capabilities: [] } as unknown as Parameters<typeof buildAgentTools>[0],
      'test-agent',
      undefined,
      undefined,
      undefined,
      guard,
    )
    // biome-ignore lint/suspicious/noExplicitAny: 测试直接驱动执行
    const writeTool = tools.find((t: any) => t.name === 'write_file')
    expect(writeTool).toBeDefined()

    const out = path.join(tmpDir, 'out.md')
    // biome-ignore lint/suspicious/noExplicitAny: 测试直接驱动执行
    const result = await writeTool.execute('call-2', { path: out, content: '王小明 已与家长沟通' } as any)
    expect(result).toBeDefined()
    expect(fs.readFileSync(out, 'utf-8')).toContain('王小明') // 不还原 => 原文保留
  })
})

describe('R2-08 save_memory 落盘前化名→真名', () => {
  it('脱敏运行下记忆内容被 deanonymize 后写入', async () => {
    const guard = await makeGuard()
    const tool = createMemoryTool('main', guard)
    // biome-ignore lint/suspicious/noExplicitAny: 测试直接驱动执行
    await tool.execute('call-3', { content: 'S_001 家长倾向晚间联系' } as any)
    expect(memoryMock.addEntry).toHaveBeenCalledWith('main', '王小明 家长倾向晚间联系', 'fact')
  })

  it('非脱敏运行下原样写入', async () => {
    const tool = createMemoryTool('main')
    // biome-ignore lint/suspicious/noExplicitAny: 测试直接驱动执行
    await tool.execute('call-4', { content: '王小明 家长倾向晚间联系' } as any)
    expect(memoryMock.addEntry).toHaveBeenCalledWith('main', '王小明 家长倾向晚间联系', 'fact')
  })
})
