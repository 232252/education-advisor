/** 表头归一化: 去首尾空白、转小写、去掉空白/下划线/连字符 */
export function normalizeHeader(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
}

/** 矩阵行取单元格文本; 列越界或空值返回空串 */
export function cellText(cells: unknown[], col: number): string {
  if (col < 0) return ''
  const v = cells[col]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}
