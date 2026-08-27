// =============================================================
// 时间戳格式化(R2-21 收敛备份域 4 处重复 pad 实现)
// 统一格式: YYYYMMDD-HHMMSS(文件系统安全,无空格/斜杠/冒号)
// =============================================================

/** 当前时间戳(文件系统安全),如 20260827-143001 */
export function formatTimestampFileSafe(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}
