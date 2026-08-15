// =============================================================
// 日志导出 — 导出到指定路径(含系统关键目录安全约束)
//
// T3: 导出日志到指定路径(返回写出字节数)
// H-3 修复: 对 targetPath 做安全约束,防止渲染进程被攻破后覆盖任意系统文件
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import { loggerState } from './state'

/** T3: 导出日志到指定路径(返回写出字节数)
 *  H-3 修复: 对 targetPath 做安全约束,防止渲染进程被攻破后覆盖任意系统文件 */
export async function exportLog(name: string, targetPath: string): Promise<number> {
  try {
    // See readLogTail for why we use path.relative rather than startsWith.
    const file = path.resolve(loggerState.logsDir, name)
    const rel = path.relative(loggerState.logsDir, file)
    if (rel.startsWith('..') || path.isAbsolute(rel)) return 0
    // H-3: targetPath 安全校验
    if (typeof targetPath !== 'string' || targetPath.length === 0) return 0
    if (targetPath.includes('\0')) return 0
    // 拒绝路径中包含 .. 段(路径穿越)
    const targetSegments = targetPath.split(/[\\/]/)
    if (targetSegments.includes('..')) return 0
    // 必须是绝对路径(防止相对路径写到意外位置)
    if (!path.isAbsolute(targetPath)) return 0
    // 拒绝写入到系统关键目录(防止覆盖系统文件)
    const sysBlockedPrefixes = getSystemBlockedPrefixes()
    const normalizedTarget = path.normalize(targetPath)
    for (const blocked of sysBlockedPrefixes) {
      if (
        normalizedTarget === blocked ||
        normalizedTarget.startsWith(blocked + path.sep) ||
        normalizedTarget.startsWith(`${blocked}/`)
      ) {
        return 0
      }
    }
    const content = await fsp.readFile(file, 'utf-8')
    await fsp.writeFile(targetPath, content, 'utf-8')
    return Buffer.byteLength(content, 'utf-8')
  } catch {
    return 0
  }
}

/** H-3: 返回系统关键目录列表(导出到这些路径会破坏系统) */
export function getSystemBlockedPrefixes(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const prefixes: string[] = []
  if (process.platform === 'win32') {
    prefixes.push('C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData')
    if (home) {
      prefixes.push(
        path.join(
          home,
          'AppData',
          'Roaming',
          'Microsoft',
          'Windows',
          'Start Menu',
          'Programs',
          'Startup',
        ),
      )
    }
  } else {
    // Unix-like (linux / macOS)
    prefixes.push('/etc', '/usr', '/bin', '/sbin', '/boot', '/var', '/sys', '/dev', '/proc')
    if (home) {
      prefixes.push(path.join(home, '.ssh'))
    }
  }
  return prefixes
}
