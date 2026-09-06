// =============================================================
// 技能文档 ↔ 工具 schema 一致性校验(智能调优可评估性基础设施)
//
// 背景: STUDENT_MANAGEMENT.md 曾把 eaa_score/eaa_history 的参数教成
// student_name(真实 schema 是 name),模型照技能调用必然 validation failed,
// 更糟的是框架不拒绝多余属性 → 传错参数会"静默成功但参数没生效"。
// 本测试把这类漂移变成门禁: 技能/角色文档里引用的工具必须真实存在,
// 参数语境下出现的参数名必须是某个工具 schema 的真实属性。
// =============================================================

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  execute: vi.fn(),
}))

vi.mock('../../src/main/services/eaa-bridge', () => ({
  eaaBridge: bridge,
  getErrorMessage: (r: { success: boolean; data?: string; stderr?: string }, f: string) =>
    typeof r.data === 'string' && r.data ? r.data : r.stderr || f,
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/skills-consistency-test'),
    isPackaged: false,
  },
}))

const { allEAATools } = await import('../../src/main/services/eaa/tools/registry')
const { allFileTools } = await import('../../src/main/services/file-tools')
const { allUtilityTools } = await import('../../src/main/services/utility-tools')
const { createMemoryTool } = await import('../../src/main/services/agent/memory-tool')
const { createDelegateToTool } = await import('../../src/main/services/agent/delegate-tool')
const { createEscalateToMainTool } = await import('../../src/main/services/agent/escalation-tool')

/** 参数语境白名单: 出现在文档里但不是工具参数的标识符(工具结果字段等) */
const RESULT_FIELD_WHITELIST = new Set([
  'events_truncated', // eaa_search/eaa_range/eaa_history 的截断标记(结果字段)
  'students_truncated', // eaa_list_students 的截断标记(结果字段)
  'events_count', // eaa_score/eaa_history 的完整条数(结果字段)
])

const REPO_ROOT = path.resolve(__dirname, '../..')

/** 全量工具目录(含工厂创建的 agent 工具,统一起见 catalog 用假 deps 构建) */
const catalog = [
  ...allEAATools,
  ...allFileTools,
  ...allUtilityTools,
  createMemoryTool('consistency-test'),
  createDelegateToTool(
    {
      validateTarget: () => null,
      isDelegationInProgress: () => false,
      runDelegatedTask: async () => ({}) as never,
      abortDelegatedAgent: () => {},
    },
    { sourceAgentId: 'main' },
  ),
  createEscalateToMainTool(
    { enqueueMainReport: async () => true },
    { sourceAgentId: 'consistency-test' },
  ),
]

const catalogNames = new Set(catalog.map((t) => t.name))

/** 工具 schema 的真实参数名集合 */
function paramNamesOf(toolName: string): Set<string> {
  const tool = catalog.find((t) => t.name === toolName)
  const props = (tool?.parameters as { properties?: Record<string, unknown> })?.properties ?? {}
  return new Set(Object.keys(props))
}

const allParamNames: Set<string> = new Set(
  catalog.flatMap((t) => [...paramNamesOf(t.name)]),
)

/** 递归收集目录下全部 .md 文件 */
function mdFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...mdFilesUnder(full))
    else if (name.endsWith('.md')) out.push(full)
  }
  return out
}

describe('技能文档 ↔ 工具目录一致性', () => {
  beforeEach(() => vi.clearAllMocks())

  it('目录应当已收集到足够工具(防止 import 失败导致空转通过)', () => {
    expect(catalogNames.size).toBeGreaterThanOrEqual(25)
    expect(catalogNames).toContain('eaa_score')
    expect(catalogNames).toContain('eaa_set_student_meta')
    expect(catalogNames).toContain('save_memory')
    expect(catalogNames).toContain('delegate_to')
    expect(catalogNames).toContain('escalate_to_main')
  })

  it('技能 frontmatter tools 列表里的工具必须真实存在', () => {
    const skillsDir = path.join(REPO_ROOT, 'skills')
    const problems: string[] = []
    for (const file of mdFilesUnder(skillsDir)) {
      const content = readFileSync(file, 'utf-8')
      const fm = content.match(/^---\n([\s\S]*?)\n---/)
      if (!fm) continue
      const toolsLine = fm[1].match(/^tools:\s*\[(.*)\]\s*$/m)
      if (!toolsLine) continue
      for (const raw of toolsLine[1].split(',')) {
        const name = raw.trim()
        if (!name) continue
        if (!catalogNames.has(name)) problems.push(`${path.relative(REPO_ROOT, file)}: 未知工具 ${name}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('技能与角色文档中反引号引用的 eaa_* 工具必须真实存在', () => {
    const dirs = [path.join(REPO_ROOT, 'skills'), path.join(REPO_ROOT, 'agents')]
    const problems: string[] = []
    for (const dir of dirs) {
      for (const file of mdFilesUnder(dir)) {
        const content = readFileSync(file, 'utf-8')
        for (const m of content.matchAll(/`((?:eaa)_[a-z0-9_]+)`/g)) {
          if (!catalogNames.has(m[1])) {
            problems.push(`${path.relative(REPO_ROOT, file)}: 引用了不存在的工具 ${m[1]}`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('技能参数表格行里反引号引用的参数名必须是该行任一工具的真实参数', () => {
    // 行形如: | `eaa_score` | 单生分数 | `name` |
    // 首格可含多个工具(如 `eaa_tag` / `eaa_range`) — 参数按该行全部工具的并集校验。
    // 参数格同时提取反引号标识符与裸 snake_case 标识符(原始 bug 的 student_name 就是裸写)。
    const skillsDir = path.join(REPO_ROOT, 'skills')
    const problems: string[] = []
    for (const file of mdFilesUnder(skillsDir)) {
      const content = readFileSync(file, 'utf-8')
      for (const line of content.split('\n')) {
        if (!line.trimStart().startsWith('|')) continue
        const cells = line.split('|').map((c) => c.trim())
        const toolNames = [...cells[1]?.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1])
        if (toolNames.length === 0 || !toolNames.some((n) => catalogNames.has(n))) continue
        const validParams = new Set(
          toolNames.filter((n) => catalogNames.has(n)).flatMap((n) => [...paramNamesOf(n)]),
        )
        // 校验参数格(第 3 格起): 反引号标识符(任意长度) + 裸 latin 标识符(≥3 字符,避开散文单字母)
        const paramCell = cells.slice(3).join('|')
        const idents = new Set<string>()
        for (const m of paramCell.matchAll(/`([a-z][a-z0-9_]+)`/g)) idents.add(m[1])
        for (const m of paramCell.matchAll(/(?<![a-zA-Z0-9_`])([a-z][a-z0-9_]{2,})(?![a-zA-Z0-9_`])/g)) {
          idents.add(m[1])
        }
        for (const ident of idents) {
          if (validParams.has(ident) || RESULT_FIELD_WHITELIST.has(ident)) continue
          if (catalogNames.has(ident)) continue // 参数格里交叉引用工具名,合法
          problems.push(
            `${path.relative(REPO_ROOT, file)}: ${toolNames.join('/')} 的参数格出现未知参数 \`${ident}\`(真实参数: ${[...validParams].join(', ') || '无'})`,
          )
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('技能写入类 bullet 里"参数"语境的反引号参数名必须是某工具的真实参数', () => {
    const skillsDir = path.join(REPO_ROOT, 'skills')
    const problems: string[] = []
    for (const file of mdFilesUnder(skillsDir)) {
      const content = readFileSync(file, 'utf-8')
      for (const line of content.split('\n')) {
        if (!line.includes('参数')) continue
        for (const m of line.matchAll(/`([a-z][a-z0-9_]+)`/g)) {
          const ident = m[1]
          if (catalogNames.has(ident) || RESULT_FIELD_WHITELIST.has(ident)) continue
          if (!allParamNames.has(ident)) {
            problems.push(`${path.relative(REPO_ROOT, file)}: 参数语境出现未知标识符 \`${ident}\``)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('EAA 工具 schema 的每个参数都必须有 description(模型选参依据)', () => {
    const problems: string[] = []
    for (const tool of allEAATools) {
      const props = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {}
      for (const [name, schema] of Object.entries(props)) {
        const hasDesc =
          typeof schema === 'object' &&
          schema !== null &&
          typeof (schema as { description?: unknown }).description === 'string' &&
          ((schema as { description?: string }).description ?? '').length > 0
        if (!hasDesc) problems.push(`${tool.name}.${name}: 缺少 description`)
      }
    }
    expect(problems).toEqual([])
  })
})
