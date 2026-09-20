// =============================================================
// Roster File — 花名册文件 → StudentCandidate[](批改归组名单)
// xlsx/xls/csv(SheetJS) / md/txt(Markdown 表格或按行) / yaml(结构化)。
// 表头启发复用 @shared/roster-profile 的别名字典(姓名/学号/考号),
// 学号/考号并入 aliases 供卷面身份匹配(matchIdentityToStudents)。
// 类型 StudentCandidate 只读 import 自 @shared/grading-helpers
// —— 本文件是 ingest 面 loadRoster 接线点(roster_paths 参数)。
// 解析前限文件大小(与样卷摄取同口径 25MB);坏文件/空表抛教师可读错误。
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import type { StudentCandidate } from '@shared/grading-helpers'
import { findRosterHeaderRow } from '@shared/roster-profile'
import { decodeTextBuffer } from './sample-ingest'

/** 名册文件大小上限(与 sample-ingest 的 MAX_EXTRACT_FILE_BYTES 同口径) */
export const MAX_ROSTER_FILE_BYTES = 25 * 1024 * 1024

const ROSTER_SHEET_EXTS = new Set(['.xlsx', '.xls', '.csv'])
const ROSTER_TEXT_EXTS = new Set(['.md', '.txt'])
const ROSTER_YAML_EXTS = new Set(['.yaml', '.yml'])

export function isRosterExt(ext: string): boolean {
  return ROSTER_SHEET_EXTS.has(ext) || ROSTER_TEXT_EXTS.has(ext) || ROSTER_YAML_EXTS.has(ext)
}

function cellText(cells: unknown[], col: number): string {
  if (col < 0) return ''
  const v = cells[col]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

/** 姓名+学号+考号 → StudentCandidate(学号/考号进 aliases);姓名空返回 null */
function toCandidate(name: string, studentId: string, examNumber: string): StudentCandidate | null {
  const n = name.trim()
  if (n.length === 0) return null
  const aliases = [studentId, examNumber]
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== n)
  return { name: n, aliases: aliases.length > 0 ? aliases : undefined }
}

function dedupeCandidates(items: StudentCandidate[]): StudentCandidate[] {
  const seen = new Set<string>()
  const out: StudentCandidate[] = []
  for (const c of items) {
    if (seen.has(c.name)) continue
    seen.add(c.name)
    out.push(c)
  }
  return out
}

/**
 * 矩阵(xlsx/csv 读出,或 md 表格解析出) → 候选名单。
 * 表头行由 findRosterHeaderRow 启发定位(扫前 15 行找姓名列);
 * 找不到表头返回 [](由调用方决定报错文案);文件内重名保留首个。
 */
export function rosterFromMatrix(matrix: unknown[][]): StudentCandidate[] {
  const located = findRosterHeaderRow(matrix)
  if (!located) return []
  const out: StudentCandidate[] = []
  for (const row of matrix.slice(located.rowIndex + 1)) {
    const cells = Array.isArray(row) ? row : []
    const cand = toCandidate(
      cellText(cells, located.indexes.name),
      cellText(cells, located.indexes.studentId),
      cellText(cells, located.indexes.examNumber),
    )
    if (cand) out.push(cand)
  }
  return dedupeCandidates(out)
}

/** Markdown 表格行 → 单元格(去掉首尾竖线围栏) */
function pipeRowCells(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** 表格分隔行(| --- | --- |) */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c))
}

/** 文本名册(md/txt) → 候选名单: Markdown 表格优先,否则按行(首列姓名) */
export function rosterFromText(content: string): StudentCandidate[] {
  const lines = content.split(/\r?\n/)
  const pipeLines = lines.map((l) => l.trim()).filter((l) => l.startsWith('|'))
  if (pipeLines.length >= 2) {
    const rows = pipeLines
      .map(pipeRowCells)
      .filter((cells) => !isSeparatorRow(cells) && cells.some((c) => c.length > 0))
    const fromTable = rosterFromMatrix(rows)
    if (fromTable.length > 0) return fromTable
  }
  // 按行模式: 每行首 token 为姓名,其余 token(学号/考号等)进 aliases
  const out: StudentCandidate[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const tokens = line.split(/[\s,，;；、\t]+/).filter((t) => t.length > 0)
    const cand = toCandidate(
      tokens[0] ?? '',
      (tokens[1] ?? '').length <= 32 ? (tokens[1] ?? '') : '',
      (tokens[2] ?? '').length <= 32 ? (tokens[2] ?? '') : '',
    )
    if (cand) out.push(cand)
  }
  return dedupeCandidates(out)
}

/** YAML 名册键别姓(小写去空白/下划线后匹配) */
const YAML_NAME_KEYS = ['name', '姓名', '学生姓名', '名字', 'studentname']
const YAML_STUDENT_ID_KEYS = ['studentid', '学号', '学生学号', '学籍号', '学籍编号', '编号']
const YAML_EXAM_KEYS = ['examnumber', 'examno', '考号', '考生号', '准考证号', '考试号']

function normalizeYamlKey(k: string): string {
  return k
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
}

function pickYamlField(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = item[key]
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return ''
}

/** YAML 名册(名单数组或 {students: [...]}) → 候选名单;结构不对抛教师可读错误 */
export function rosterFromYamlData(parsed: unknown, label: string): StudentCandidate[] {
  const items = Array.isArray(parsed)
    ? parsed
    : parsed !== null &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { students?: unknown }).students)
      ? ((parsed as { students: unknown[] }).students as unknown[])
      : null
  if (!items) {
    throw new Error(`YAML 名册需为学生数组或含 students 数组: ${label}`)
  }
  const out: StudentCandidate[] = []
  for (const item of items) {
    if (typeof item === 'string') {
      const cand = toCandidate(item, '', '')
      if (cand) out.push(cand)
      continue
    }
    if (typeof item !== 'object' || item === null) continue
    const record: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(item)) record[normalizeYamlKey(k)] = v
    const cand = toCandidate(
      pickYamlField(record, YAML_NAME_KEYS),
      pickYamlField(record, YAML_STUDENT_ID_KEYS),
      pickYamlField(record, YAML_EXAM_KEYS),
    )
    if (cand) out.push(cand)
  }
  return dedupeCandidates(out)
}

/**
 * 名册文件 → StudentCandidate[]。
 * 逐级校验(存在/大小/扩展名),坏文件/空表抛教师可读错误。
 */
export async function parseRosterFile(filePath: string): Promise<StudentCandidate[]> {
  const ext = path.extname(filePath).toLowerCase()
  const label = path.basename(filePath)
  if (!isRosterExt(ext)) {
    throw new Error(`不支持的名册格式: ${label}(支持 xlsx/xls/csv/md/txt/yaml)`)
  }
  let stat: Awaited<ReturnType<typeof fsp.stat>>
  try {
    stat = await fsp.stat(filePath)
  } catch {
    throw new Error(`名册文件不存在或无法访问: ${label}`)
  }
  if (!stat.isFile()) throw new Error(`不是文件: ${label}`)
  if (stat.size > MAX_ROSTER_FILE_BYTES) {
    throw new Error(`名册文件超过 ${MAX_ROSTER_FILE_BYTES / 1024 / 1024}MB 上限: ${label}`)
  }
  let buf: Buffer
  try {
    buf = await fsp.readFile(filePath)
  } catch {
    throw new Error(`无法读取名册文件: ${label}`)
  }

  const noStudents = (why: string): never => {
    throw new Error(`名册中没有可解析的学生行(${why}): ${label}`)
  }

  if (ROSTER_SHEET_EXTS.has(ext)) {
    // .xlsx 必为 zip 结构: 垃圾字节直接报解析失败(SheetJS 对任意字节
    // 都按 CSV 宽容解析,不报错,会退成「找不到姓名列」的误导文案)
    if (ext === '.xlsx' && (buf.length < 4 || buf.toString('latin1', 0, 4) !== 'PK\x03\x04')) {
      throw new Error(`名册表格解析失败(${label}): 文件不是有效的 xlsx`)
    }
    const XLSX = await import('xlsx')
    let wb: import('xlsx').WorkBook
    try {
      // csv 是文本: 先过 GBK 兜底解码再按字符串读,中文 Windows 导出的 ANSI csv 才不乱码
      wb =
        ext === '.csv'
          ? XLSX.read(decodeTextBuffer(buf), { type: 'string' })
          : XLSX.read(buf, { type: 'buffer' })
    } catch (err) {
      throw new Error(
        `名册表格解析失败(${label}): ${err instanceof Error ? err.message : '无法读取'}`,
      )
    }
    const candidates: StudentCandidate[] = []
    for (const name of wb.SheetNames) {
      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], {
        header: 1,
        defval: '',
        blankrows: true,
        raw: false,
      }) as unknown[][]
      candidates.push(...rosterFromMatrix(matrix))
    }
    const roster = dedupeCandidates(candidates)
    if (roster.length === 0) noStudents('找不到姓名列')
    return roster
  }

  const text = decodeTextBuffer(buf)
  if (ROSTER_YAML_EXTS.has(ext)) {
    let parsed: unknown
    try {
      const YAML = await import('yaml')
      parsed = YAML.parse(text)
    } catch (err) {
      throw new Error(`YAML 解析失败(${label}): ${err instanceof Error ? err.message : '无法读取'}`)
    }
    const roster = rosterFromYamlData(parsed, label)
    if (roster.length === 0) noStudents('没有学生条目')
    return roster
  }

  const roster = rosterFromText(text)
  if (roster.length === 0) noStudents(text.trim().length === 0 ? '文件为空' : '找不到姓名列')
  return roster
}
