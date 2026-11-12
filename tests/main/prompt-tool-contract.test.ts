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

  it('main 的 SOUL 与 AGENTS 不宣传未授权的 eaa 工具', () => {
    const agent = agents.find((a) => a.id === 'main')!
    const available = new Set<string>(
      getToolsByCapability(agent.capabilities ?? []).map((t) => (t as AgentTool).name as string),
    )
    for (const file of ['SOUL.md', 'AGENTS.md']) {
      const content = fs.readFileSync(path.join(AGENTS_DIR, 'main', file), 'utf-8')
      const declared = new Set<string>()
      for (const m of content.matchAll(/eaa_[a-z0-9_]+/g)) declared.add(m[0])
      const missing = [...declared].filter((t) => !available.has(t))
      expect(missing, `main/${file}`).toEqual([])
    }
    expect(available.has('eaa_delete_student')).toBe(false)
  })

  it('内建技能声明的工具都真实存在', () => {
    const known = new Set<string>([
      ...getToolsByCapability(['all', 'delete']).map((t) => (t as AgentTool).name as string),
      'read_file',
      'read_excel',
      'read_image',
      'list_dir',
      'write_file',
      'write_excel',
      'write_csv',
      'get_current_time',
      'calculate',
      'save_memory',
    ])
    const skillDir = path.join(ROOT, 'skills')
    for (const name of fs.readdirSync(skillDir).filter((n) => n.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(skillDir, name), 'utf-8')
      const fm = content.match(/^---\n([\s\S]*?)\n---/)
      expect(fm, name).toBeTruthy()
      const toolsLine = fm?.[1].match(/tools:\s*\[([^\]]*)\]/)
      expect(toolsLine, name).toBeTruthy()
      const tools = (toolsLine?.[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const unknown = tools.filter((t) => !known.has(t))
      expect(unknown, name).toEqual([])
    }
  })

  it('批改与学业技能写明策略、改分和教师点击，而不是模型自填 confirm', () => {
    const grading = fs.readFileSync(path.join(ROOT, 'skills', 'AI_GRADING.md'), 'utf-8')
    expect(grading).toContain('grading_strategy')
    expect(grading).toContain('fast')
    expect(grading).toContain('standard')
    expect(grading).toContain('dual')
    expect(grading).toContain('extreme')
    expect(grading).toContain('grading_mode')
    expect(grading).toContain('strict')
    expect(grading).toContain('lenient')
    expect(grading).toContain('不要自己把 `confirm` 设成教师已同意')
    expect(grading).toContain('eaa_grading_from_files')
    expect(grading).toContain('eaa_grading_set_strategy')
    expect(grading).toContain('read_image')

    const academic = fs.readFileSync(path.join(ROOT, 'skills', 'ACADEMIC_ANALYSIS.md'), 'utf-8')
    expect(academic).toContain('eaa_import_grades')
    expect(academic).toContain('eaa_set_grade')
    expect(academic).toContain('eaa_delete_exam')
    expect(academic).toContain('不要传 confirm')

    const students = fs.readFileSync(path.join(ROOT, 'skills', 'STUDENT_MANAGEMENT.md'), 'utf-8')
    expect(students).toContain('eaa_restore_class')

    const soul = fs.readFileSync(path.join(AGENTS_DIR, 'main', 'SOUL.md'), 'utf-8')
    expect(soul).toContain('eaa_import_grades')
    expect(soul).toContain('eaa_grading_from_files')
    expect(soul).toContain('delegate_to')
    expect(soul).toContain('read_image')
    expect(soul).toContain('eaa_restore_class')
    expect(soul).toContain('save_memory')
    expect(soul).not.toContain('eaa_delete_student')

    const bug = fs.readFileSync(path.join(AGENTS_DIR, 'bug-hunter', 'SOUL.md'), 'utf-8')
    expect(bug).toContain('没有 shell')
    expect(bug).not.toContain('跑全量')
    expect(bug).toContain('validator` 已停用')

    const executor = fs.readFileSync(path.join(AGENTS_DIR, 'executor', 'SOUL.md'), 'utf-8')
    expect(executor).not.toContain('备份管理')
    expect(executor).toContain('不能备份')
  })

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
