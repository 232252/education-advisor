// =============================================================
// 18 个 agent 的 dsh 装配功能测试（跑真实 config/agents.yaml 与真实提示词）
//
// dsh 侧的三条硬约束都来自「配置文件写错、代码看不出来」这类问题：
//  1. 能力表要真能解析出工具 —— 空工具集的 agent 在 dsh 下会被挂一个空端点，
//     模型除了空谈无法动手；
//  2. 工具名要能被改写成 mcp__<server>__<raw>，且 agent id 清洗后的 serverName
//     合法且互不相同（两个 agent 撞同一个 serverName = 撞同一个 MCP 插件实例）；
//  3. 提示词里提到的 eaa 工具必须是该 agent 真有的 —— 否则模型按提示去调一个
//     不在它工具表里的名字，dsh 直接 ToolNotFoundError（pi 路径同样调不到，
//     但 dsh 下连「名字对不对」都变成硬失败）。
// =============================================================

import { readFileSync } from 'node:fs'
import os from 'node:os'
import { vi } from 'vitest'

// eaa 工具表会牵进 utils/log（模块级 app.getPath）；这里只读配置与名字规则，
// 打一个最小 electron 桩即可，不必起真 app。
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  ipcMain: { handle: () => {}, on: () => {} },
  shell: { openExternal: () => {} },
}))
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { MCP_SERVER_NAME_PATTERN } from '../../src/main/services/dsh/eaa-mcp-server'
// 只 import 无 electron 依赖的那半边：tool-bridge 会牵进 utils/log（模块级 app.getPath）
import { mcpToolNameMap, rewriteToolNames } from '../../src/main/services/dsh/tool-names'
import {
  allEAATools,
  dangerousEAATools,
  getToolsByCapability,
} from '../../src/main/services/eaa/tools/registry'

// vitest 以仓库根为 cwd 跑（见 vitest.config.ts 的 projects）
const ROOT = process.cwd()

interface AgentDef {
  id: string
  name?: string
  capabilities?: string[]
  enabled?: boolean
}

const roster = parse(readFileSync(join(ROOT, 'config', 'agents.yaml'), 'utf8')) as {
  agents?: AgentDef[]
}
const allAgents = roster.agents ?? []
const agents = allAgents.filter((a) => a.enabled !== false)

/** 声明为 0 能力的角色：用文件工具做代码巡检，不碰学生数据 */
const NO_EAA_CAPABILITY_BY_DESIGN = new Set(['bug-hunter'])

/** 花名册里被显式关掉的角色：改动这里要连带改断言（见下） */
const DISABLED_BY_DESIGN = ['supervisor', 'validator']

/** 与 tool-bridge 的 agentServerName 同一条清洗规则（那份实现是模块私有的） */
function slug(label: string): string {
  return label.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'agent'
}

function readFiles(files: string[]): string {
  return files
    .map((f) => {
      try {
        return readFileSync(join(ROOT, f), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')
}

/** 角色自己写的提示词（决定「这个角色被教去用哪些工具」） */
function readOwnPrompt(id: string): string {
  return readFiles([join('agents', id, 'AGENTS.md'), join('agents', id, 'SOUL.md')])
}

/** 角色提示词 + 公共规则：dsh 下发给模型的完整 system prompt */
function readPromptParts(id: string): string {
  const files = [
    join('agents', id, 'AGENTS.md'),
    join('agents', id, 'SOUL.md'),
    join('agents', '_shared', 'rules.md'),
    join('agents', '_shared', 'project-context.md'),
  ]
  return files
    .map((f) => {
      try {
        return readFileSync(join(ROOT, f), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')
}

/** 只在「不是更长标识符的一部分」时算命中，与 rewriteToolNames 的口径一致 */
function mentions(text: string, name: string): boolean {
  const isWord = /[A-Za-z0-9_]/
  let from = 0
  for (;;) {
    const at = text.indexOf(name, from)
    if (at < 0) return false
    const before = at === 0 ? '' : text[at - 1]
    const afterIdx = at + name.length
    const after = afterIdx >= text.length ? '' : text[afterIdx]
    const free = (c: string) => c === '' || !isWord.test(c)
    if (free(before) && free(after)) return true
    from = at + 1
  }
}

/** 否定/边界措辞：出现即视为「禁止使用」而非「授权使用」 */
const DENIAL = /不在|不属于|不可|不得|不要|请勿|禁止|无权|没有/

const allToolNames = [...allEAATools, ...dangerousEAATools].map((t) => t.name)

describe('18 个 agent 的 dsh 装配', () => {
  it('18 个角色全在册、id 非空，且关停的只有设计上调走的那两个', () => {
    expect(allAgents).toHaveLength(18)
    for (const a of allAgents) expect(a.id.trim().length).toBeGreaterThan(0)
    const disabled = allAgents.filter((a) => a.enabled === false).map((a) => a.id).sort()
    expect(disabled).toEqual(DISABLED_BY_DESIGN)
    expect(agents).toHaveLength(18 - DISABLED_BY_DESIGN.length)
  })

  it('每个在册角色的能力表都能解析出 eaa 工具（除按设计不碰学生数据的）', () => {
    const empty = agents
      .filter((a) => getToolsByCapability(a.capabilities ?? []).length === 0)
      .map((a) => a.id)
      .filter((id) => !NO_EAA_CAPABILITY_BY_DESIGN.has(id))
    expect(empty).toEqual([])
  })

  it('serverName 合法且互不相同（撞名即撞同一个 MCP 插件实例）', () => {
    const names = agents.map((a) => slug(a.id))
    for (const n of names) expect(MCP_SERVER_NAME_PATTERN.test(n)).toBe(true)
    const dupes = names.filter((n, i) => names.indexOf(n) !== i)
    expect([...new Set(dupes)]).toEqual([])
  })

  it('提示词里出现的 eaa 工具名，都在该 agent 自己的工具表里', () => {
    const offenders: string[] = []
    for (const a of agents) {
      const owned = new Set(getToolsByCapability(a.capabilities ?? []).map((t) => t.name))
      const text = readOwnPrompt(a.id)
      for (const name of allToolNames) {
        if (owned.has(name) || !text) continue
        if (!mentions(text, name)) continue
        // 提示词可以「点名禁止」一个本角色没有的工具，那是授权边界而不是 bug；
        // 不允许的是把它当成本角色能用的工具来教 —— 所以要求每一次出现都在
        // 含否定词的句子里。
        const unowned = text
          .split(String.fromCharCode(10))
          .filter((line) => mentions(line, name))
          .filter((line) => !DENIAL.test(line))
        for (const line of unowned) {
          offenders.push(`${a.id} 把没有的 ${name} 当可用工具来教：${line.trim().slice(0, 60)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('提示词确实在被检查（非空文件 + 语料里真有足量工具名引用）', () => {
    const missing = agents
      .map((a) => a.id)
      .filter((id) => readOwnPrompt(id).trim().length <= 200)
    expect(missing).toEqual([])
    // 「提到未挂载工具」那条断言要有牙：语料里被引用的 eaa 工具名数量必须可观
    const mentioned = allToolNames.filter((name) =>
      agents.some((a) => mentions(readOwnPrompt(a.id), name)),
    )
    expect(mentioned.length).toBeGreaterThanOrEqual(15)
  })

  it('改写后不残留任何本角色工具的裸名（残留＝模型会去调不存在的名字）', () => {
    const offenders: string[] = []
    for (const a of agents) {
      const tools = getToolsByCapability(a.capabilities ?? [])
      if (!tools.length) continue
      const map = mcpToolNameMap(tools, slug(a.id))
      const rewritten = rewriteToolNames(readPromptParts(a.id), map)
      for (const t of tools) {
        if (mentions(rewritten, t.name)) offenders.push(`${a.id} 仍残留裸名 ${t.name}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
