// =============================================================
// 中国居民身份证号解析（15/18 位）
// 档案导入与档案页共用：校验 → 规范化 → 出生日期 / 性别
// =============================================================

export interface ParsedChineseIdCard {
  /** 18 位大写校验码；15 位旧证保留原 15 位 */
  idCard: string
  /** YYYY-MM-DD */
  birthDate: string
  gender: '男' | '女'
}

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const
const CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'] as const

/** 全角数字 → 半角；去空白、引号、尾部 X 统一大写 */
export function normalizeIdCard(raw: string): string {
  const half = raw.replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  )
  return half.replace(/[\s'"‘’“”]/g, '').replace(/x$/i, 'X')
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const dt = new Date(Date.UTC(year, month - 1, day))
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
}

function checksum18(body17: string): string {
  let sum = 0
  for (let i = 0; i < 17; i++) {
    sum += Number(body17[i]) * WEIGHTS[i]
  }
  return CHECK[sum % 11]
}

function centuryForTwoDigitYear(yy: number): number {
  const nowYy = new Date().getFullYear() % 100
  return yy > nowYy ? 1900 + yy : 2000 + yy
}

/** Excel 把 18 位身份证存成数字时会变成科学计数法，精度已丢失，不能当身份证用 */
export function isCorruptedIdCardCell(raw: string): boolean {
  return /^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(raw.trim())
}

/**
 * 解析中国居民身份证。非法 / 校验失败 / 科学计数法单元格返回 null。
 * 18 位必须通过 GB 11643 校验码；15 位旧证只校验日期与性别位。
 */
export function parseChineseIdCard(raw: unknown): ParsedChineseIdCard | null {
  if (raw === null || raw === undefined) return null
  const text = typeof raw === 'number' ? String(raw) : String(raw)
  if (!text.trim() || isCorruptedIdCardCell(text)) return null
  const id = normalizeIdCard(text)
  if (id.length === 18) {
    if (!/^\d{17}[\dX]$/.test(id)) return null
    if (checksum18(id.slice(0, 17)) !== id[17]) return null
    const year = Number(id.slice(6, 10))
    const month = Number(id.slice(10, 12))
    const day = Number(id.slice(12, 14))
    if (!isValidYmd(year, month, day)) return null
    const gender: '男' | '女' = Number(id[16]) % 2 === 1 ? '男' : '女'
    return {
      idCard: id,
      birthDate: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      gender,
    }
  }
  if (id.length === 15) {
    if (!/^\d{15}$/.test(id)) return null
    const year = centuryForTwoDigitYear(Number(id.slice(6, 8)))
    const month = Number(id.slice(8, 10))
    const day = Number(id.slice(10, 12))
    if (!isValidYmd(year, month, day)) return null
    const gender: '男' | '女' = Number(id[14]) % 2 === 1 ? '男' : '女'
    return {
      idCard: id,
      birthDate: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      gender,
    }
  }
  return null
}

/** 身份证脱敏：保留前 4 后 3 */
export function maskIdCard(id?: string): string {
  if (!id) return ''
  const n = normalizeIdCard(id)
  if (n.length < 8) return n
  return `${n.slice(0, 4)}${'*'.repeat(Math.max(n.length - 7, 3))}${n.slice(-3)}`
}

/** 手机号脱敏：保留前 3 后 4 */
export function maskPhone(phone?: string): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return phone
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}
