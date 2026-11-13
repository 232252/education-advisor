// =============================================================
// 对话模式预设表 — 模式 = 一组 cordis 行开关（稳定面，升级友好）
//
// standard：与现行加固一致（plan-mode 关、native 执行器）。
// plan：重开 plan-mode 行并给 section 引导；评审走已接好的提问通道。
// ptc：互换两执行器行开关，模型可见 run_code（教师显式选择才启用）。
// 模式 patch 排在加固层之后（同 id 后写覆盖），只写配置不写密钥。
// =============================================================

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  buildChatModePatch,
  CHAT_MODES,
  ensureChatModePatch,
  normalizeChatMode,
} from '../chat-modes'

interface Row {
  id?: string
  disabled?: boolean
  config?: Record<string, unknown>
}

const rows = (mode: string): Row[] => parse(buildChatModePatch(mode)) as Row[]
const row = (mode: string, id: string): Row | undefined => rows(mode).find((r) => r.id === id)

let dir: string
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

describe('对话模式预设表', () => {
  it('三个模式：standard / plan / ptc，未知值回落 standard', () => {
    expect(CHAT_MODES).toEqual(['standard', 'plan', 'ptc'])
    expect(normalizeChatMode('plan')).toBe('plan')
    expect(normalizeChatMode('ptc')).toBe('ptc')
    expect(normalizeChatMode('bogus')).toBe('standard')
    expect(normalizeChatMode(undefined)).toBe('standard')
  })

  it('standard 不改任何行（空数组），与现行加固完全一致', () => {
    expect(rows('standard')).toEqual([])
  })

  it('plan 模式重开 plan-mode 行并带 section 引导', () => {
    const plan = row('plan', 'plan-mode')
    expect(plan?.disabled).toBe(false)
    const section = plan?.config?.section
    expect(typeof section).toBe('string')
    expect(String(section).length).toBeGreaterThan(0)
    // 不碰执行器：计划模式仍是 native
    expect(row('plan', 'tool-executor-native')).toBeUndefined()
    expect(row('plan', 'tool-executor-ptc')).toBeUndefined()
  })

  it('ptc 模式互换执行器：native 关、ptc 开', () => {
    expect(row('ptc', 'tool-executor-native')?.disabled).toBe(true)
    expect(row('ptc', 'tool-executor-ptc')?.disabled).toBe(false)
    // 不顺手开 plan-mode
    expect(row('ptc', 'plan-mode')).toBeUndefined()
  })

  it('落盘幂等：内容一致不重写；standard 不建文件', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-chat-mode-'))
    expect(ensureChatModePatch(dir, 'standard')).toBeNull()
    expect(existsSync(join(dir, 'eaa-chat-mode.cordis.patch.yml'))).toBe(false)

    const path = ensureChatModePatch(dir, 'plan')
    expect(path).toBe(join(dir, 'eaa-chat-mode.cordis.patch.yml'))
    if (!path) throw new Error('expected patch path')
    const { stat } = await import('node:fs/promises')
    const first = await readFile(path, 'utf8')
    const before = (await stat(path)).mtimeMs
    ensureChatModePatch(dir, 'plan')
    expect((await stat(path)).mtimeMs).toBe(before)
    expect(await readFile(path, 'utf8')).toBe(first)

    ensureChatModePatch(dir, 'ptc')
    const ptc = parse(await readFile(path, 'utf8')) as Row[]
    expect(ptc.find((r) => r.id === 'tool-executor-ptc')?.disabled).toBe(false)
  })

  it('模式 patch 不含密钥、不含 insert（只按行 id 开关）', () => {
    for (const mode of CHAT_MODES) {
      const text = buildChatModePatch(mode)
      expect(text).not.toContain('apiKey')
      for (const r of rows(mode)) {
        expect(r).not.toHaveProperty('insert')
        expect(typeof r.id).toBe('string')
      }
    }
  })
})
