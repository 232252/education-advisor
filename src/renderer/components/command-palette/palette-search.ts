// =============================================================
// palette-search — 命令面板纯搜索逻辑
// 类型 / 匹配评分 / 结果排序分组,无 React 依赖,便于单测。
// 数据源: 学生(EAA) / 班级 / Agent / EAA事件 / 页面导航。
// =============================================================

import type { AgentListItem, ClassEntity, EAAEventRecord, EAAStudent } from '@shared/types'

export type PaletteResultKind = 'nav' | 'student' | 'class' | 'agent' | 'event'

export interface PaletteResult {
  /** 唯一 id(kind + ':' + 业务id) */
  id: string
  kind: PaletteResultKind
  /** 主标题(学生姓名/班级名/Agent名/页面名) */
  title: string
  /** 副标题(分数·风险 / 年级·学生数 / 描述 / 路径) */
  subtitle?: string
  /** 匹配得分,越高越靠前 */
  score: number
  /** 跳转 URL(含 query param,由各页面 useEffect 消费) */
  target: string
}

export interface NavCommand {
  path: string
  label: string
  keywords?: string
}

export interface PaletteData {
  students: EAAStudent[]
  classes: ClassEntity[]
  agents: AgentListItem[]
  navCommands: NavCommand[]
}

/** 每类结果在面板中的展示上限 */
export const LIMITS = {
  students: 5,
  classes: 3,
  agents: 4,
  events: 5,
} as const

/**
 * 大小写不敏感的匹配评分。
 * - 前缀匹配 100 / 子串匹配 80 / 其余(调用方自定义,如 id 匹配) 40
 * - 不匹配返回 -1
 */
export function matchScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t === q) return 120
  if (t.startsWith(q)) return 100
  const idx = t.indexOf(q)
  if (idx >= 0) return 80 - Math.min(idx, 20) // 越靠前得分越高
  return -1
}

function takeTop<T>(items: T[], n: number): T[] {
  return items.length <= n ? items : items.slice(0, n)
}

export function searchStudents(query: string, students: EAAStudent[]): PaletteResult[] {
  const out: PaletteResult[] = []
  for (const s of students) {
    const nameScore = matchScore(query, s.name)
    const idScore = nameScore < 0 ? matchScore(query, s.entity_id) : -1
    const score = Math.max(nameScore, idScore * 0.6) // id 命中权重低于姓名
    if (score < 0) continue
    const subtitleParts = [`分数 ${s.score}`]
    if (s.class_id) subtitleParts.push(s.class_id)
    out.push({
      id: `student:${s.entity_id}`,
      kind: 'student',
      title: s.name,
      subtitle: subtitleParts.join(' · '),
      score,
      target: `/students?entity_id=${encodeURIComponent(s.entity_id)}`,
    })
  }
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh'))
  return takeTop(out, LIMITS.students)
}

export function searchClasses(query: string, classes: ClassEntity[]): PaletteResult[] {
  const out: PaletteResult[] = []
  for (const c of classes) {
    const nameScore = matchScore(query, c.name)
    const idScore = nameScore < 0 ? matchScore(query, c.class_id) : -1
    const score = Math.max(nameScore, idScore * 0.6)
    if (score < 0) continue
    out.push({
      id: `class:${c.class_id}`,
      kind: 'class',
      title: c.name,
      subtitle: `${c.class_id}${c.archived ? ' · 已存档' : ''}`,
      score,
      target: `/classes?class_id=${encodeURIComponent(c.class_id)}`,
    })
  }
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh'))
  return takeTop(out, LIMITS.classes)
}

export function searchAgents(query: string, agents: AgentListItem[]): PaletteResult[] {
  const out: PaletteResult[] = []
  for (const a of agents) {
    const nameScore = matchScore(query, a.name)
    const descScore = nameScore < 0 ? matchScore(query, a.description) * 0.5 : -1
    const score = Math.max(nameScore, descScore)
    if (score < 0) continue
    out.push({
      id: `agent:${a.id}`,
      kind: 'agent',
      title: a.name,
      subtitle: a.description,
      score,
      target: `/agents?agent_id=${encodeURIComponent(a.id)}`,
    })
  }
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh'))
  return takeTop(out, LIMITS.agents)
}

export function searchNav(query: string, navCommands: NavCommand[]): PaletteResult[] {
  const out: PaletteResult[] = []
  for (const n of navCommands) {
    const labelScore = matchScore(query, n.label)
    const kwScore = n.keywords && labelScore < 0 ? matchScore(query, n.keywords) * 0.7 : -1
    const score = Math.max(labelScore, kwScore)
    if (score < 0) continue
    out.push({
      id: `nav:${n.path}`,
      kind: 'nav',
      title: n.label,
      subtitle: n.path,
      score: score * 0.9, // 同分时业务实体优先于页面导航
      target: n.path,
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

export function buildEventResults(events: EAAEventRecord[]): PaletteResult[] {
  return takeTop(events, LIMITS.events).map((e) => ({
    id: `event:${e.event_id}`,
    kind: 'event' as const,
    title: e.name,
    subtitle: `${e.reason_code}${e.score_delta >= 0 ? '+' : ''}${e.score_delta} · ${e.timestamp.slice(0, 10)}${e.is_valid ? '' : ' · 已撤销'}`,
    score: 60, // 异步事件结果排在本地实体之后
    target: `/students?entity_id=${encodeURIComponent(e.entity_id)}`,
  }))
}

/**
 * 汇总本地(同步)搜索结果: 空查询时只返回导航命令;
 * 有查询时按 学生 > 班级 > Agent > 导航 顺序拼接。
 */
export function searchLocal(query: string, data: PaletteData): PaletteResult[] {
  const q = query.trim()
  if (!q) return searchNav('', data.navCommands)
  return [
    ...searchStudents(q, data.students),
    ...searchClasses(q, data.classes),
    ...searchAgents(q, data.agents),
    ...searchNav(q, data.navCommands),
  ]
}

/** 按面板展示顺序分组(保持传入相对顺序) */
export function groupResults(
  results: PaletteResult[],
): Array<{ kind: PaletteResultKind; items: PaletteResult[] }> {
  const order: PaletteResultKind[] = ['student', 'class', 'agent', 'nav', 'event']
  const groups: Array<{ kind: PaletteResultKind; items: PaletteResult[] }> = []
  for (const kind of order) {
    const items = results.filter((r) => r.kind === kind)
    if (items.length > 0) groups.push({ kind, items })
  }
  return groups
}
