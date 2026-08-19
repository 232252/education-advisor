// =============================================================
// parseStudentNames — 向导第 2 步学生名单解析(纯函数,可单测)
// 支持换行 / 逗号(中英) / 顿号 / 分号(中英) 分隔;去空行;去重保序。
// =============================================================

export function parseStudentNames(text: string): string[] {
  const parts = text.split(/\r?\n|,|，|、|;|；/)
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of parts) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}
