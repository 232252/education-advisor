// =============================================================
// 会话工作目录 — 每会话一个目录，产出归拢、可列读、防穿越
// =============================================================

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listSessionFiles,
  resolveSessionFile,
  sanitizeSessionId,
  sessionWorkspaceDir,
} from '../session-workspace'

let root: string
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = ''
})

describe('会话工作目录', () => {
  it('会话 id 净化：只留安全字符，防路径注入', () => {
    expect(sanitizeSessionId('1794-abc_123')).toBe('1794-abc_123')
    expect(sanitizeSessionId('../../etc')).toBe('etc')
    expect(sanitizeSessionId('a/b\\c:d')).toBe('abcd')
    expect(sanitizeSessionId('')).toBe('')
  })

  it('目录按会话隔离，空 id 返回 null', () => {
    expect(sessionWorkspaceDir('/data', 's1')).toBe(join('/data', 'workspaces', 's1'))
    expect(sessionWorkspaceDir('/data', '../evil')).toBe(join('/data', 'workspaces', 'evil'))
    expect(sessionWorkspaceDir('/data', '')).toBeNull()
  })

  it('列出会话文件（相对路径+大小），跳过隐藏文件', async () => {
    root = await mkdtemp(join(tmpdir(), 'eaa-ws-'))
    const dir = sessionWorkspaceDir(root, 's1')
    if (!dir) throw new Error('expected workspace dir')
    await writeFile(join(dir, '报告.md'), '# 周报', 'utf8').catch(async () => {
      // 目录尚未建：先建再写
      const { mkdir } = await import('node:fs/promises')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, '报告.md'), '# 周报', 'utf8')
    })
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'sub', '数据.csv'), 'a,b', 'utf8')
    await writeFile(join(dir, '.hidden'), 'x', 'utf8')

    const files = await listSessionFiles(root, 's1')
    const names = files.map((f) => f.path).sort()
    expect(names).toEqual(['sub/数据.csv', '报告.md'])
    expect(files.find((f) => f.path === '报告.md')?.size).toBeGreaterThan(0)
  })

  it('不存在的会话返回空列表，不抛', async () => {
    root = await mkdtemp(join(tmpdir(), 'eaa-ws-'))
    expect(await listSessionFiles(root, 'nope')).toEqual([])
  })

  it('resolveSessionFile 防穿越：逃出会话目录一律 null', async () => {
    root = await mkdtemp(join(tmpdir(), 'eaa-ws-'))
    const dir = sessionWorkspaceDir(root, 's1')
    if (!dir) throw new Error('expected workspace dir')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'ok.txt'), 'ok', 'utf8')

    expect(await resolveSessionFile(root, 's1', 'ok.txt')).toBe(join(dir, 'ok.txt'))
    expect(await resolveSessionFile(root, 's1', '../s2/secret.txt')).toBeNull()
    expect(await resolveSessionFile(root, 's1', '../../etc/passwd')).toBeNull()
    expect(await resolveSessionFile(root, 's1', 'missing.txt')).toBeNull()
  })
})
