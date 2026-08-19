// =============================================================
// home-school — 家校沟通域纯函数
// buildCommunicationPrompt: 沟通话术生成 prompt(场景×语气)
// splitEventsForParent: 家长报告事件分组(亮点/关注)
// =============================================================

import type { EAAHistoryEvent, EAAStudent, StudentProfileData } from '@shared/types'

export type CommScenario = 'phone' | 'wechat' | 'meeting'
export type CommTone = 'praise' | 'neutral' | 'concern'

export const COMM_SCENARIOS: Array<{ id: CommScenario; labelKey: string; label: string }> = [
  { id: 'phone', labelKey: 'homeSchool.scenario.phone', label: '电话沟通' },
  { id: 'wechat', labelKey: 'homeSchool.scenario.wechat', label: '微信留言' },
  { id: 'meeting', labelKey: 'homeSchool.scenario.meeting', label: '面谈提纲' },
]

export const COMM_TONES: Array<{ id: CommTone; labelKey: string; label: string }> = [
  { id: 'praise', labelKey: 'homeSchool.tone.praise', label: '鼓励表扬' },
  { id: 'neutral', labelKey: 'homeSchool.tone.neutral', label: '中性反馈' },
  { id: 'concern', labelKey: 'homeSchool.tone.concern', label: '委婉关注' },
]

const SCENARIO_DESC: Record<CommScenario, string> = {
  phone: '电话沟通 — 输出一段通话话术: 开场问候、2-3 个沟通要点、约定后续配合、礼貌结束语',
  wechat: '微信留言 — 输出一条可直接发送的微信消息(150字内),语气亲切自然,附一条具体配合建议',
  meeting:
    '面谈提纲 — 输出家长会/约谈的面谈提纲: 开场、孩子的3个具体表现(先扬后抑)、需家长配合的2件事、结束语',
}

const TONE_DESC: Record<CommTone, string> = {
  praise: '以正向鼓励为主基调,突出孩子最近的进步与闪光点,让家长感到被认可',
  neutral: '客观中性地陈述近期表现,优点与待改进并重,不渲染情绪',
  concern: '委婉表达需要关注的方面,用"我们一起来帮助孩子"的协作口吻,避免指责性措辞',
}

export interface CommunicationContext {
  student: EAAStudent
  events: EAAHistoryEvent[]
  profileData: StudentProfileData
}

/** 近期事件格式化为 prompt 片段(默认最近 10 条,倒序;撤销事件不参与) */
function formatEventsForPrompt(events: EAAHistoryEvent[], limit = 10): string {
  const valid = events.filter((e) => !e.reverted)
  if (valid.length === 0) return '(暂无事件记录)'
  const recent = [...valid].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit)
  return recent
    .map(
      (e) =>
        `- ${e.timestamp.slice(0, 10)} [${e.event_type === 'ConductBonus' ? '加分' : '扣分'}] ${e.note || e.reason_code}`,
    )
    .join('\n')
}

/**
 * 构建家校沟通话术生成 prompt。
 * 内部风险术语(如风险等级原始标签)不直接抛给家长,由 Agent 转译为友好措辞。
 */
export function buildCommunicationPrompt(
  ctx: CommunicationContext,
  scenario: CommScenario,
  tone: CommTone,
): string {
  const { student, events, profileData } = ctx
  const parentName = profileData.parentName?.trim()
  const lines = [
    '你是班主任的家校沟通助手。请根据以下学生情况,生成一份发给家长的沟通话术。',
    '',
    '## 学生情况',
    `- 姓名: ${student.name}`,
    student.class_id ? `- 班级: ${student.class_id}` : null,
    `- 操行分数: ${student.score.toFixed(1)}(近期变化: ${student.delta >= 0 ? '+' : ''}${student.delta.toFixed(1)})`,
    `- 需要关注的程度: ${student.risk}(内部参考,输出时请转化为自然语言,如"表现稳定"/"近期有起伏")`,
    `- 事件总数: ${student.events_count}`,
    parentName ? `- 家长: ${parentName}(称呼"XX家长"或"您")` : null,
    '',
    '## 近期事件记录(最新在前)',
    formatEventsForPrompt(events),
    '',
    '## 输出要求',
    `- 沟通场景: ${SCENARIO_DESC[scenario]}`,
    `- 语气基调: ${TONE_DESC[tone]}`,
    '- 只输出最终话术本身,不要输出分析过程或任何前缀说明。',
    '- 不得出现"风险等级""扣分""内部记录"等管理术语。',
    '- 涉及具体事件时只描述行为本身,不给学生贴标签。',
  ].filter((l): l is string => l != null)
  return lines.join('\n')
}

export interface ParentEventGroups {
  /** 正面亮点事件(加分且未撤销) */
  highlights: EAAHistoryEvent[]
  /** 需要关注的方面(扣分且未撤销) */
  concerns: EAAHistoryEvent[]
}

/**
 * 家长报告事件分组: 有效事件按加分/扣分归类,各取最近 N 条。
 * 家长版报告只呈现事实性事件,不呈现累计分值。
 */
export function splitEventsForParent(
  events: EAAHistoryEvent[],
  limitPerGroup = 5,
): ParentEventGroups {
  const valid = events.filter((e) => !e.reverted)
  const sorted = [...valid].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return {
    highlights: sorted.filter((e) => e.event_type === 'ConductBonus').slice(0, limitPerGroup),
    concerns: sorted.filter((e) => e.event_type === 'ConductDeduct').slice(0, limitPerGroup),
  }
}

/** 内部风险等级 → 家长友好措辞(家长版报告不呈现风险术语) */
export function riskToParentTerm(risk: string): string {
  switch (risk) {
    case '低':
      return '表现稳定'
    case '中':
      return '总体良好，偶有起伏'
    case '高':
      return '近期需要多加关注'
    case '极高':
      return '需要家校重点陪伴'
    default:
      return '—'
  }
}
