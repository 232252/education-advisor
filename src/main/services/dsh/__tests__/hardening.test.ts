import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  buildEaaHardeningPatch,
  EAA_DISABLED_DSH_ROWS,
  EAA_HARDENING_PATCH_FILE,
  eaaHardeningPatchRows,
  ensureEaaHardeningPatch,
} from '../hardening'

interface Row {
  id?: string
  disabled?: boolean
  insert?: unknown[]
  config?: { includeHarnessIdentity?: boolean; personaPrefix?: string; personaSuffix?: string }
}

const rows = (): Row[] => parse(buildEaaHardeningPatch()) as Row[]

describe('dsh harness 自带工具的关闭清单', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-hardening-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('每一行都是按 id 关闭，且这份 patch 自己不给任何工具', () => {
    const list = rows()
    expect(list.length).toBe(EAA_DISABLED_DSH_ROWS.length + 1)
    for (const row of list.slice(0, EAA_DISABLED_DSH_ROWS.length)) {
      expect(row.insert).toBeUndefined()
      expect(typeof row.id).toBe('string')
      expect(row.disabled).toBe(true)
    }
  })

  it('shell / 文件写 / 联网 / 子代理 / 计划模式都在清单里', () => {
    // 这些是 dsh-base 里模型可见的自带工具行；漏一项 = 该角色拿到越权能力
    for (const id of [
      'tool-bash',
      'tool-pwsh',
      'tool-fs',
      'tool-fs-search',
      'tool-jobs',
      'tool-web',
      'tool-subagent',
      'tool-subagent-fork',
      'tool-subagent-control',
      'tool-workflow',
      'tool-goal',
      'tool-todo',
      'tool-skill',
      'plan-mode',
      'mcp-resources',
    ]) {
      expect(EAA_DISABLED_DSH_ROWS).toContain(id)
    }
  })

  it("不禁 'tools' 行：那是工具注册表本身，MCP 工具也要往里注册", () => {
    expect(EAA_DISABLED_DSH_ROWS).not.toContain('tools')
  })

  it('去掉 harness 自己的身份与人格段，app 的 system prompt 才是唯一人格', () => {
    const persona = rows().at(-1)
    expect(persona?.id).toBe('system-prompt')
    expect(persona?.config).toEqual({
      includeHarnessIdentity: false,
      personaPrefix: '',
      personaSuffix: '',
    })
  })

  it('落盘幂等：内容一致时不重写，被改坏后重写回来', async () => {
    const path = ensureEaaHardeningPatch(dir)
    expect(path).toBe(join(dir, EAA_HARDENING_PATCH_FILE))
    expect(await readFile(path, 'utf8')).toBe(buildEaaHardeningPatch())

    const before = (await stat(path)).mtimeMs
    ensureEaaHardeningPatch(dir)
    expect((await stat(path)).mtimeMs).toBe(before)

    await writeFile(path, '- id: tool-bash\n  disabled: false\n', 'utf8')
    ensureEaaHardeningPatch(dir)
    expect(await readFile(path, 'utf8')).toBe(buildEaaHardeningPatch())
  })

  it('目录里没有该文件时也能建出来', async () => {
    expect(existsSync(join(dir, EAA_HARDENING_PATCH_FILE))).toBe(false)
    ensureEaaHardeningPatch(dir)
    expect(eaaHardeningPatchRows().length).toBe(EAA_DISABLED_DSH_ROWS.length + 1)
    expect(existsSync(join(dir, EAA_HARDENING_PATCH_FILE))).toBe(true)
  })
})
