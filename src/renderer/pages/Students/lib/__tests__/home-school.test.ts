// =============================================================
// home-school — 家校沟通域纯函数测试
// buildCommunicationPrompt / splitEventsForParent / riskToParentTerm
// =============================================================

import type { EAAHistoryEvent, EAAStudent, StudentProfileData } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  buildCommunicationPrompt,
  type CommTone,
  riskToParentTerm,
  splitEventsForParent,
} from '../home-school'

function mkStudent(overrides?: Partial<EAAStudent>): EAAStudent {
  return {
    name: '张三',
    entity_id: 'e1',
    score: 82.5,
    delta: 3.2,
    risk: '中',
    status: 'Active',
    events_count: 12,
    groups: [],
    roles: [],
    class_id: 'G7-3',
    ...overrides,
  }
}

function mkEvent(
  id: string,
  type: 'ConductBonus' | 'ConductDeduct',
  timestamp: string,
  note = '',
  reverted = false,
): EAAHistoryEvent {
  return {
    event_id: id,
    timestamp,
    event_type: type,
    reason_code: 'R01',
    score_delta: type === 'ConductBonus' ? 2 : -2,
    cumulative: 80,
    note,
    tags: [],
    reverted,
  }
}

const PROFILE: StudentProfileData = { parentName: '李四' }

describe('buildCommunicationPrompt', () => {
  it('包含学生核心信息(姓名/班级/分数/变化/事件数)', () => {
    const prompt = buildCommunicationPrompt(
      { student: mkStudent(), events: [], profileData: PROFILE },
      'phone',
      'praise',
    )
    expect(prompt).toContain('张三')
    expect(prompt).toContain('G7-3')
    expect(prompt).toContain('82.5')
    expect(prompt).toContain('+3.2')
    expect(prompt).toContain('12')
  })

  it('包含家长称呼', () => {
    const prompt = buildCommunicationPrompt(
      { student: mkStudent(), events: [], profileData: PROFILE },
      'phone',
      'praise',
    )
    expect(prompt).toContain('家长: 李四')
  })

  it('近期事件按时间倒序、标注加分/扣分、限10条', () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      mkEvent(
        `e${i}`,
        i % 2 === 0 ? 'ConductBonus' : 'ConductDeduct',
        `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
        `事件${i}`,
      ),
    )
    const prompt = buildCommunicationPrompt(
      { student: mkStudent(), events, profileData: PROFILE },
      'phone',
      'praise',
    )
    // 最新事件在前
    const firstIdx = prompt.indexOf('事件14')
    const lastIdx = prompt.indexOf('事件5')
    expect(firstIdx).toBeGreaterThan(-1)
    expect(lastIdx).toBeGreaterThan(firstIdx)
    // 超过10条的最旧事件被截断
    expect(prompt).not.toContain('事件0')
    expect(prompt).toContain('[加分]')
    expect(prompt).toContain('[扣分]')
  })

  it('撤销事件不进入 prompt', () => {
    const events = [mkEvent('e1', 'ConductDeduct', '2026-01-01T10:00:00Z', '已撤销的记录', true)]
    const prompt = buildCommunicationPrompt(
      { student: mkStudent(), events, profileData: PROFILE },
      'phone',
      'praise',
    )
    expect(prompt).not.toContain('已撤销的记录')
  })

  it('空事件显示占位文案', () => {
    const prompt = buildCommunicationPrompt(
      { student: mkStudent(), events: [], profileData: PROFILE },
      'phone',
      'praise',
    )
    expect(prompt).toContain('暂无事件记录')
  })

  it('场景描述随 scenario 变化', () => {
    const ctx = { student: mkStudent(), events: [], profileData: PROFILE }
    const phone = buildCommunicationPrompt(ctx, 'phone', 'praise')
    const wechat = buildCommunicationPrompt(ctx, 'wechat', 'praise')
    const meeting = buildCommunicationPrompt(ctx, 'meeting', 'praise')
    expect(phone).toContain('电话沟通')
    expect(wechat).toContain('微信留言')
    expect(meeting).toContain('面谈提纲')
  })

  it('语气描述随 tone 变化', () => {
    const ctx = { student: mkStudent(), events: [], profileData: PROFILE }
    for (const tone of ['praise', 'neutral', 'concern'] as CommTone[]) {
      const prompt = buildCommunicationPrompt(ctx, 'phone', tone)
      expect(prompt).toContain('语气基调')
    }
    expect(buildCommunicationPrompt(ctx, 'phone', 'praise')).toContain('正向鼓励')
    expect(buildCommunicationPrompt(ctx, 'phone', 'concern')).toContain('委婉')
  })

  it('包含输出约束(禁内部术语/不贴标签)', () => {
    const prompt = buildCommunicationPrompt(
      { student: mkStudent(), events: [], profileData: PROFILE },
      'phone',
      'praise',
    )
    expect(prompt).toContain('不得出现"风险等级"')
    expect(prompt).toContain('不给学生贴标签')
  })

  it('无班级/无家长时对应行省略', () => {
    const student = mkStudent({ class_id: null })
    const prompt = buildCommunicationPrompt(
      { student, events: [], profileData: {} },
      'phone',
      'praise',
    )
    expect(prompt).not.toContain('班级:')
    expect(prompt).not.toContain('家长:')
  })

  it('delta 为负时带负号', () => {
    const prompt = buildCommunicationPrompt(
      { student: mkStudent({ delta: -2.5 }), events: [], profileData: PROFILE },
      'phone',
      'praise',
    )
    expect(prompt).toContain('-2.5')
  })
})

describe('splitEventsForParent', () => {
  it('加分事件 → highlights,扣分事件 → concerns', () => {
    const events = [
      mkEvent('b1', 'ConductBonus', '2026-01-02T10:00:00Z', '帮助同学'),
      mkEvent('d1', 'ConductDeduct', '2026-01-03T10:00:00Z', '迟到'),
      mkEvent('b2', 'ConductBonus', '2026-01-04T10:00:00Z', '课堂发言'),
    ]
    const { highlights, concerns } = splitEventsForParent(events)
    expect(highlights.map((e) => e.event_id)).toEqual(['b2', 'b1'])
    expect(concerns.map((e) => e.event_id)).toEqual(['d1'])
  })

  it('撤销事件被排除', () => {
    const events = [
      mkEvent('b1', 'ConductBonus', '2026-01-02T10:00:00Z', '帮助同学'),
      mkEvent('d1', 'ConductDeduct', '2026-01-03T10:00:00Z', '迟到', true),
    ]
    const { highlights, concerns } = splitEventsForParent(events)
    expect(highlights).toHaveLength(1)
    expect(concerns).toHaveLength(0)
  })

  it('各组默认取最近 5 条', () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      mkEvent(`b${i}`, 'ConductBonus', `2026-01-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    )
    const { highlights } = splitEventsForParent(events)
    expect(highlights).toHaveLength(5)
    expect(highlights[0].event_id).toBe('b7') // 最新在前
  })
})

describe('riskToParentTerm', () => {
  it('四个风险等级映射为友好措辞,不含"风险"字样', () => {
    expect(riskToParentTerm('低')).toBe('表现稳定')
    expect(riskToParentTerm('中')).toBe('总体良好，偶有起伏')
    expect(riskToParentTerm('高')).toBe('近期需要多加关注')
    expect(riskToParentTerm('极高')).toBe('需要家校重点陪伴')
    for (const term of ['低', '中', '高', '极高']) {
      expect(riskToParentTerm(term)).not.toContain('风险')
    }
  })

  it('未知等级显示占位符', () => {
    expect(riskToParentTerm('unknown')).toBe('—')
  })
})
