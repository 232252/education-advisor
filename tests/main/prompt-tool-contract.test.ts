// =============================================================
// 提示词↔工具 契约测试（R2-02 防回归）
//
// 使命：AGENTS.md 里向模型声明的每个 eaa_* 工具，运行时必须真实可得
//       （由 agents.yaml capabilities 经 getToolsByCapability 展开）。
//       此前 main / discipline-officer 的 AGENTS.md 承诺了未授权的
//       eaa_revert_event，模型会照提示词调用却发现无此工具。
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// mock electron：registry → tool 模块 → eaa-bridge 构造时调用 app.getPath
vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'prompt-tool-contract-test'),
    isPackaged: false,
  },
}))

import yaml from 'yaml'
import { getToolsByCapability } from '../../src/main/services/eaa/tools/registry'
import type { AgentTool } from '@main/services/llm-contracts'

const ROOT = path.resolve(__dirname, '../..')
const AGENTS_YAML = path.join(ROOT, 'config', 'agents.yaml')
const AGENTS_DIR = path.join(ROOT, 'agents')

interface YamlAgent {
  id: string
  enabled?: boolean
  capabilities?: string[]
}

describe('提示词声明的 eaa_* 工具必须真实可用（R2-02）', () => {
  const doc = yaml.parse(fs.readFileSync(AGENTS_YAML, 'utf-8')) as { agents: YamlAgent[] }
  const agents: YamlAgent[] = doc.agents ?? []

  it('agents.yaml 解析出 18 个 agent', () => {
    expect(agents.length).toBe(18)
  })

  for (const agent of agents) {
    it(`${agent.id}：AGENTS.md 工具声明 ⊆ capability 实际授权`, () => {
      const mdPath = path.join(AGENTS_DIR, agent.id, 'AGENTS.md')
      expect(fs.existsSync(mdPath)).toBe(true)

      const content = fs.readFileSync(mdPath, 'utf-8')

      // 跳过「不在本角色工具集内」这类否定式说明行（如 safety/AGENTS.md）
      const effectiveLines = content
        .split('\n')
        .filter((line) => !/不在.{0,12}工具集|未授予|无权/.test(line))
        .join('\n')

      // 收集全文出现的 eaa_xxx 标记（表格行与行文同等对待——模型读到就会尝试调用）
      const declared = new Set<string>()
      for (const m of effectiveLines.matchAll(/eaa_[a-z_]+/g)) declared.add(m[0])

      if (declared.size === 0) return

      // 展开实际授权工具集
      const available = new Set<string>(
        getToolsByCapability(agent.capabilities ?? []).map((t) => (t as AgentTool).name as string),
      )

      const missing = [...declared].filter((t) => !available.has(t))
      expect(missing, `${agent.id} 的 AGENTS.md 声明了未授权工具`).toEqual([])
    })
  }

  it('反向校验：revert 授权后 main/discipline-officer 确实获得 eaa_revert_event', () => {
    for (const id of ['main', 'discipline-officer']) {
      const agent = agents.find((a) => a.id === id)!
      const names = getToolsByCapability(agent.capabilities ?? []).map(
        (t) => (t as AgentTool).name,
      )
      expect(names).toContain('eaa_revert_event')
    }
  })
})
