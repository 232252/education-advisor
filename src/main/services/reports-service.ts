// =============================================================
// 报告服务(R2-12) — data_archive/agent_outputs 产物的统一读写
// 产物由 agent(weekly-reporter/counselor/risk-alert 等)经 write_file
// 相对路径写入;本服务是消费侧(报告中心页)。
// dev 落点=项目根/data_archive/agent_outputs(与 agent 工具 cwd 一致),
// 打包落点=userData/data_archive/agent_outputs(接 R2-17 后与写侧统一)。
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import type { ReportEntry, ReportListResult, ReportReadResult } from '@shared/types/reports'
import { app } from 'electron'

const MAX_READ_BYTES = 5 * 1024 * 1024 // 5MB 上限,防超大文件拖垮渲染层

/** 产物目录解析(与 skill-service 同款 dev/packaged 判定) */
export function getAgentOutputsDir(): string {
  const resourcesPath = process.resourcesPath || ''
  const isRealPackaged =
    !resourcesPath.includes('node_modules') && !resourcesPath.includes('electron')
  if (isRealPackaged) {
    return path.join(app.getPath('userData'), 'data_archive', 'agent_outputs')
  }
  return path.resolve(__dirname, '..', '..', 'data_archive', 'agent_outputs')
}

/** 列出全部产物(按修改时间倒序) */
export function listReports(): ReportListResult {
  const dir = getAgentOutputsDir()
  let entries: fs.Dirent[]
  try {
    if (!fs.existsSync(dir)) {
      return { success: true, entries: [] }
    }
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, entries: [], error: msg }
  }

  const reports: ReportEntry[] = []
  for (const e of entries) {
    if (!e.isFile()) continue
    const ext = path.extname(e.name).toLowerCase()
    if (!['.md', '.json', '.txt'].includes(ext)) continue
    try {
      const st = fs.statSync(path.join(dir, e.name))
      reports.push({ name: e.name, size: st.size, mtimeMs: st.mtimeMs, ext })
    } catch {
      // 单个文件 stat 失败跳过
    }
  }
  reports.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { success: true, entries: reports }
}

/** 读取单个产物(文件名必须落在产物目录内,防路径穿越) */
export function readReport(fileName: string): ReportReadResult {
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    return { success: false, error: '非法文件名' }
  }
  const dir = getAgentOutputsDir()
  const filePath = path.join(dir, fileName)
  // 目录边界防御:解析后仍在产物目录下
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    return { success: false, error: '路径越界' }
  }
  try {
    const st = fs.statSync(resolved)
    if (!st.isFile()) return { success: false, error: '不是文件' }
    if (st.size > MAX_READ_BYTES) {
      return { success: false, error: `文件超过 ${MAX_READ_BYTES / 1024 / 1024}MB,请在应用外查看` }
    }
    return { success: true, content: fs.readFileSync(resolved, 'utf-8') }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: msg }
  }
}
