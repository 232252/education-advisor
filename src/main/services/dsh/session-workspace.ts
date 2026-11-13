// =============================================================
// 会话工作目录 — 每会话一个目录，产出归拢、可列读、防穿越
//
// 布局：<appDataDir>/workspaces/<净化后的会话 id>/
// 与 DSH 的 working-directory 服务对齐：执行链路把会话目录经
// SDK setWorkingDirectory 绑给子进程，文件工具的相对产出也路由到这里。
// 本模块纯函数 + 注入根目录，不依赖 electron，可单测。
// =============================================================

import type { Dirent } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

/** 会话 id 净化：只留字母数字下划线短横线，防路径注入。 */
export function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, '')
}

/** 会话工作目录；空/非法 id 返回 null。 */
export function sessionWorkspaceDir(rootDir: string, sessionId: string): string | null {
  const safe = sanitizeSessionId(sessionId)
  if (!safe) return null
  return join(rootDir, 'workspaces', safe)
}

/** 确保会话目录存在并返回；非法 id 返回 null。 */
export async function ensureSessionWorkspace(
  rootDir: string,
  sessionId: string,
): Promise<string | null> {
  const dir = sessionWorkspaceDir(rootDir, sessionId)
  if (!dir) return null
  await mkdir(dir, { recursive: true })
  return dir
}

export interface SessionFileEntry {
  /** 相对会话目录的路径（正斜杠） */
  path: string
  size: number
}

/** 列出会话文件（递归，跳过隐藏文件/目录）；目录不存在返回空。 */
export async function listSessionFiles(
  rootDir: string,
  sessionId: string,
): Promise<SessionFileEntry[]> {
  const dir = sessionWorkspaceDir(rootDir, sessionId)
  if (!dir) return []
  const out: SessionFileEntry[] = []
  const walk = async (current: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        try {
          const info = await stat(full)
          out.push({ path: relative(dir, full).split(sep).join('/'), size: info.size })
        } catch {
          /* 读取瞬间被删：跳过 */
        }
      }
    }
  }
  await walk(dir)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * 解析会话内文件为绝对路径；穿越出会话目录或不存在一律 null。
 * 另存/读取前必须经此校验（与 reports-service 同款防穿越）。
 */
export async function resolveSessionFile(
  rootDir: string,
  sessionId: string,
  relPath: string,
): Promise<string | null> {
  const dir = sessionWorkspaceDir(rootDir, sessionId)
  if (!dir || !relPath) return null
  const full = resolve(dir, relPath)
  const rel = relative(dir, full)
  if (rel.startsWith('..') || resolve(dir, rel) !== full) return null
  try {
    const info = await stat(full)
    return info.isFile() ? full : null
  } catch {
    return null
  }
}
