// =============================================================
// json-file — JSON 文件读取与文件名净化的共享小工具
// 收口 academic-service / profile-service 等处逐字重复的
// readFile+JSON.parse+catch 回退 与 safeName 正则(2026-09-05 小工具收口轮)
// =============================================================

import fsp from 'node:fs/promises'

/** 净化文件名(防路径穿越 + 非法字符归一为下划线;保留中文) */
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
}

/** 读 JSON 文件;不存在/损坏(JSON.parse 抛错)时返回 fallback */
export async function readJsonOr<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}
