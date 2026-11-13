import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  buildAgentsInstructionBudgetPatch,
  EAA_AGENTS_INSTRUCTION_BYTES,
  writeRoleAgentsHome,
} from '../agents-home'

describe('角色 AGENTS.md', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('写到该角色自己的 DSH_AGENTS_HOME，不碰别的角色', async () => {
    dir = await mkdtemp(join(tmpdir(), 'eaa-agents-home-'))
    const home = writeRoleAgentsHome(dir, 'main', '你是主协调')
    expect(home).toBe(join(dir, 'agents', 'main'))
    expect(await readFile(join(home, 'AGENTS.md'), 'utf8')).toBe('你是主协调')
    writeRoleAgentsHome(dir, 'academic', '你是学业')
    expect(await readFile(join(dir, 'agents', 'main', 'AGENTS.md'), 'utf8')).toBe('你是主协调')
    expect(await readFile(join(dir, 'agents', 'academic', 'AGENTS.md'), 'utf8')).toBe('你是学业')
  })

  it('只放宽 agent-instructions 的字节上限', () => {
    const rows = parse(buildAgentsInstructionBudgetPatch()) as Array<{
      id: string
      config: { maxBytes: number }
    }>
    expect(rows).toEqual([
      { id: 'agent-instructions', config: { maxBytes: EAA_AGENTS_INSTRUCTION_BYTES } },
    ])
  })

  it('只改字节上限，已安装的其它字段留下', () => {
    const rows = parse(
      buildAgentsInstructionBudgetPatch({ maxBytes: 65536, note: 'keep' }),
    ) as Array<{
      config: { maxBytes: number; note: string }
    }>
    expect(rows[0]?.config).toEqual({ note: 'keep', maxBytes: EAA_AGENTS_INSTRUCTION_BYTES })
  })
})
