// 对话工具栏的思考档。目录里写成 null 的档，dsh 不会发送，整轮会按关闭处理。

/** 与 dsh 0.2.1 的 THINKING_LEVELS 一致，含目录里的 max。 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ThinkingLevelName = (typeof THINKING_LEVELS)[number]

/**
 * 模型目录里有非空档位值的才显示。没有目录时返回全部，自定义模型无从判断。
 * 「关」始终保留：不发送 reasoning effort。
 */
export function visibleThinkingLevels(
  map: Partial<Record<string, string | null | undefined>> | undefined,
): ThinkingLevelName[] {
  if (!map) return [...THINKING_LEVELS]
  const levels: ThinkingLevelName[] = ['off']
  for (const level of THINKING_LEVELS) {
    if (level === 'off') continue
    const value = map[level]
    if (typeof value === 'string' && value) levels.push(level)
  }
  return levels
}

/** 当前模型没有教师选的那一档时，下拉显示关闭，和这一轮实际发送一致。 */
export function effectiveThinkingLevel(selected: string, visible: readonly string[]): string {
  return visible.includes(selected) ? selected : 'off'
}
