// =============================================================
// System Prompt 新段落 + Schedule 解析测试
// 覆盖: (a) buildSystemPrompt 注入 项目背景/长期记忆/风险阈值(可选输入)
//       (b) 缺省输入时输出与旧版一致(向后兼容)
//       (c) parseScheduleEntries 字符串/对象混合解析
//       (d) syncAgentScheduleTasks 消费 schedulePrompts
//       (e) parseEnvContent (.env 加载器)
// =============================================================

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  if (!process.resourcesPath) {
    Object.defineProperty(process, 'resourcesPath', {
      value: require('node:path').join(require('node:os').tmpdir(), 'fake-resources'),
      configurable: true,
    })
  }
  return {
    userDataDir: require('node:path').join(require('node:os').tmpdir(), 'eaa-prompt-test'),
    getPath: vi.fn((n: string) => (n === 'userData' ? mocks.userDataDir : '')),
  }
})

// task-persistence → utils/logger → log/state 在模块顶层调用 app.getPath,
// 必须先 mock electron
vi.mock('electron', () => ({ app: { getPath: mocks.getPath, isPackaged: false } }))

import {
  buildSystemPrompt,
  formatRiskThresholds,
} from '../../src/main/services/agent/system-prompt'
import { parseScheduleEntries } from '../../src/main/services/agent/config'
import { syncAgentScheduleTasks } from '../../src/main/services/cron/task-persistence'
import { parseEnvContent } from '../../src/main/utils/load-dev-env'
import type { CronTask } from '../../src/shared/types'

const BASE_INPUT = {
  config: { name: '测试员', role: 'test', description: '测试角色' },
  soulContent: '你是测试员。',
  sharedRulesContent: '公共规则内容',
  rulesContent: '角色规则内容',
  skillsSection: '\n--- 可用技能 ---\n### X\n描述',
  steeringMode: 'all',
  followUpMode: 'all',
  showImages: true,
}

describe('buildSystemPrompt 新段落注入', () => {
  it('注入项目背景/长期记忆/风险阈值', () => {
    const prompt = buildSystemPrompt({
      ...BASE_INPUT,
      projectContextContent: '你运行在 Education Advisor 中。',
      memorySection: '\n--- 长期记忆 ---\n- [2026-08-27][fact] 用户偏好简洁回复',
      riskThresholds: { high: 85, medium: 93, low: 100 },
    })
    expect(prompt).toContain('--- 项目背景 ---')
    expect(prompt).toContain('你运行在 Education Advisor 中。')
    expect(prompt).toContain('--- 长期记忆 ---')
    expect(prompt).toContain('用户偏好简洁回复')
    expect(prompt).toContain('操行分风险分级标准(全系统统一)')
    expect(prompt).toContain('分数 < 85 为高风险')
  })

  it('可选输入缺省时输出与旧版一致(无新段落残留)', () => {
    const prompt = buildSystemPrompt(BASE_INPUT)
    expect(prompt).not.toContain('项目背景')
    expect(prompt).not.toContain('长期记忆')
    expect(prompt).not.toContain('风险分级标准')
    // 既有段落仍在
    expect(prompt).toContain('你是测试员。')
    expect(prompt).toContain('--- 公共规则 ---')
    expect(prompt).toContain('--- 角色规则 ---')
    expect(prompt).toContain('--- 运行环境 ---')
  })

  it('formatRiskThresholds 输出完整四段标准', () => {
    const s = formatRiskThresholds({ high: 85, medium: 93, low: 100 })
    expect(s).toContain('< 85 为高风险')
    expect(s).toContain('85–93 为中风险')
    expect(s).toContain('93–100 为低风险')
    expect(s).toContain('≥ 100 为优秀')
  })
})

describe('parseScheduleEntries 混合解析', () => {
  it('字符串条目 → 表达式 + undefined prompt', () => {
    const r = parseScheduleEntries(['0 6 * * *', '0 12 * * *'])
    expect(r.expressions).toEqual(['0 6 * * *', '0 12 * * *'])
    expect(r.prompts).toEqual([undefined, undefined])
  })

  it('对象条目 → 表达式 + prompt', () => {
    const r = parseScheduleEntries([
      { cron: '0 6 * * *', prompt: '执行晨间检查。' },
      { cron: '0 12 * * *', prompt: '  ' }, // 空白 prompt 回退 undefined
    ])
    expect(r.expressions).toEqual(['0 6 * * *', '0 12 * * *'])
    expect(r.prompts).toEqual(['执行晨间检查。', undefined])
  })

  it('字符串与对象混合(向后兼容)', () => {
    const r = parseScheduleEntries(['0 6 * * *', { cron: '0 12 * * *', prompt: '午检。' }])
    expect(r.expressions).toEqual(['0 6 * * *', '0 12 * * *'])
    expect(r.prompts).toEqual([undefined, '午检。'])
  })

  it('畸形条目被跳过', () => {
    const r = parseScheduleEntries([null, 42, { cron: 123 }, { cron: '0 6 * * *' }, 'not-cron'])
    expect(r.expressions).toEqual(['0 6 * * *', 'not-cron'])
  })

  it('非数组输入返回空', () => {
    expect(parseScheduleEntries(undefined).expressions).toEqual([])
    expect(parseScheduleEntries(null).expressions).toEqual([])
  })
})

describe('syncAgentScheduleTasks 消费 schedulePrompts', () => {
  it('对象条目的 prompt 进入 CronTask,缺省回退泛化提示', () => {
    const tasks = new Map<string, CronTask>()
    const scheduled: string[] = []
    const mapping = syncAgentScheduleTasks(
      [
        {
          id: 'governor',
          name: '督导',
          schedule: ['0 6 * * *', '0 12 * * *'],
          schedulePrompts: ['执行晨间数据质量检查。', undefined],
          modelTier: 'low_cost' as const,
        },
      ],
      {
        tasks,
        schedule: (id) => scheduled.push(id),
        unschedule: () => {},
      },
    )
    expect(mapping.get('governor')).toEqual([
      'agent-schedule-governor-0',
      'agent-schedule-governor-1',
    ])
    expect(tasks.get('agent-schedule-governor-0')?.prompt).toBe('执行晨间数据质量检查。')
    expect(tasks.get('agent-schedule-governor-1')?.prompt).toBe('执行 督导 的定时任务')
  })
})

describe('parseEnvContent', () => {
  it('解析 KEY=VALUE,跳过注释与空行,去引号', () => {
    const entries = parseEnvContent([
      '# 注释',
      '',
      'ENABLE_CDP=0',
      'DEBUG_AGENT="true"',
      "NAME='education'",
      'INVALID-KEY=x',
      'NO_EQUALS_SIGN',
    ].join('\n'))
    expect(entries).toEqual([
      { key: 'ENABLE_CDP', value: '0' },
      { key: 'DEBUG_AGENT', value: 'true' },
      { key: 'NAME', value: 'education' },
    ])
  })
})
