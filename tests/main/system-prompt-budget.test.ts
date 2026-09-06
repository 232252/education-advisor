// =============================================================
// System Prompt 体积预算门禁(智能调优可评估性·防膨胀)
//
// 背景: system prompt 是逐片段拼接的——SOUL/公共规则/角色规则/项目背景/
// 技能清单/记忆段各自演化,任何一处悄悄变长都会推高每次请求的固定 token
// 成本、挤占对话空间并提前触发压缩。本门禁把"提示词不失控"变成断言:
// 各源文件有体积上限,拼装产物有总预算,段落头部不得重复注入。
// =============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../../src/main/services/agent/system-prompt'

const REPO_ROOT = path.resolve(__dirname, '../..')
const AGENTS_DIR = path.join(REPO_ROOT, 'agents')

/** 各源文件的字符预算(留 ~50% 余量;现值见各用例) */
const BUDGETS = {
  soul: 9000, // 当前最大 bug-hunter 6201
  agentsRules: 6000, // 当前最大 main 3057
  sharedRules: 7000, // 当前 4475
  projectContext: 6000, // 当前 3448
  assembled: 30000, // main 满配拼装(含技能清单+记忆最坏情形)
}

function agentDirs(): string[] {
  return readdirSync(AGENTS_DIR).filter((name) => {
    const full = path.join(AGENTS_DIR, name)
    return statSync(full).isDirectory() && name !== '_shared'
  })
}

function readIfExists(file: string): string {
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return ''
  }
}

describe('System Prompt 体积预算', () => {
  it('每个角色的 SOUL.md 不超预算', () => {
    const problems: string[] = []
    for (const dir of agentDirs()) {
      const content = readIfExists(path.join(AGENTS_DIR, dir, 'SOUL.md'))
      if (content.length > BUDGETS.soul) {
        problems.push(`${dir}/SOUL.md: ${content.length} > ${BUDGETS.soul}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('每个角色的 AGENTS.md 不超预算', () => {
    const problems: string[] = []
    for (const dir of agentDirs()) {
      const content = readIfExists(path.join(AGENTS_DIR, dir, 'AGENTS.md'))
      if (content.length > BUDGETS.agentsRules) {
        problems.push(`${dir}/AGENTS.md: ${content.length} > ${BUDGETS.agentsRules}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('共享规则与项目背景不超预算', () => {
    const rules = readIfExists(path.join(AGENTS_DIR, '_shared', 'rules.md'))
    const project = readIfExists(path.join(AGENTS_DIR, '_shared', 'project-context.md'))
    expect(rules.length).toBeLessThanOrEqual(BUDGETS.sharedRules)
    expect(project.length).toBeLessThanOrEqual(BUDGETS.projectContext)
  })

  it('main 满配拼装产物不超总预算,且各段落头部至多出现一次', () => {
    const soul = readIfExists(path.join(AGENTS_DIR, 'main', 'SOUL.md'))
    const rules = readIfExists(path.join(AGENTS_DIR, 'main', 'AGENTS.md'))
    const sharedRules = readIfExists(path.join(AGENTS_DIR, '_shared', 'rules.md'))
    const project = readIfExists(path.join(AGENTS_DIR, '_shared', 'project-context.md'))
    // 记忆段最坏情形 = MAX_SECTION_CHARS(4000) + 段落头
    const memoryWorstCase = `${'\n--- 长期记忆 ---\n以下是你(main)在与用户的历次交互中沉淀的记忆,已自动加载。'.padEnd(
      4300,
      '记',
    )}`
    const skillsWorstCase = `--- 技能 ---\n${Array.from(
      { length: 8 },
      (_, i) => `- SKILL_${i}: 示例技能描述,占据实际技能清单的典型篇幅。`,
    ).join('\n')}`

    const prompt = buildSystemPrompt({
      config: { name: 'main', role: '主协调', description: '教育参谋' },
      soulContent: soul,
      projectContextContent: project,
      classContextSection: '--- 当前班级 ---\n- 班级：示例中学 7 年级 3 班\n- 学生人数：50',
      skillsSection: skillsWorstCase,
      sharedRulesContent: sharedRules,
      rulesContent: rules,
      memorySection: memoryWorstCase,
      riskThresholds: { high: 85, medium: 93, low: 100 },
      steeringMode: 'all',
      followUpMode: 'all',
      showImages: false,
    })

    expect(prompt.length).toBeLessThanOrEqual(BUDGETS.assembled)

    // 双事实来源防线: 每个结构性段落头部只允许出现一次
    // (风险阈值曾是双注入: project-context 硬编码 + yaml 注入各一份)
    for (const header of [
      '--- 项目背景 ---',
      '--- 公共规则 ---',
      '--- 角色规则 ---',
      '--- 当前班级 ---',
      '--- 长期记忆 ---',
    ]) {
      const count = prompt.split(header).length - 1
      expect(count, `段落 ${header} 出现了 ${count} 次`).toBeLessThanOrEqual(1)
    }
    // 注入的分级标准行(formatRiskThresholds 产物)至多一次;
    // 散文里"以系统注入的「操行分风险分级标准」为准"这类引用不算重复
    expect(prompt.split('为高风险;').length - 1).toBeLessThanOrEqual(1)
    // project-context 不得再硬编码具体阈值数字(单源: yaml 注入)
    expect(project).not.toMatch(/<\s*85|85[–-]93|93[–-]100/)
  })
})
