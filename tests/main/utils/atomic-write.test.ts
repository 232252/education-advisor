// =============================================================
// atomic-write 残留清扫测试 — 后缀形态精确匹配 / 不误删 / 目录缺失静默
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { atomicWrite, sweepAtomicTmpResidue } from '../../../src/main/utils/atomic-write'

async function makeDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'ea-atomic-'))
}

describe('sweepAtomicTmpResidue', () => {
  it('删除崩溃残留形态的 tmp 文件,保留正常文件', async () => {
    const dir = await makeDir()
    await fsp.writeFile(path.join(dir, 'agents.user.yaml.tmp.1234.1788562215471.bpxom5'), 'x')
    await fsp.writeFile(path.join(dir, 'mcp.user.yaml.tmp.99.1000000.abc123'), 'x')
    await fsp.writeFile(path.join(dir, 'agents.user.yaml'), 'keep-me')
    await fsp.writeFile(path.join(dir, 'notes.txt'), 'keep-me')
    // 同形态后缀的目录不是 atomicWrite 产物(unlink 目录报错即跳过),不能误删
    await fsp.mkdir(path.join(dir, 'subdir.tmp.1.2.abcdef'), { recursive: true })

    const removed = await sweepAtomicTmpResidue([dir])

    expect(removed).toBe(2)
    const left = await fsp.readdir(dir)
    expect(left).toContain('agents.user.yaml')
    expect(left).toContain('notes.txt')
    expect(left).toContain('subdir.tmp.1.2.abcdef')
    expect(left).not.toContain('agents.user.yaml.tmp.1234.1788562215471.bpxom5')
  })

  it('跳过同 pid 的 tmp(boot 期在途写入,如 settings 频道迁移防抖落盘)', async () => {
    const dir = await makeDir()
    // 当前进程 pid 形态的 tmp = 可能正在写入,清扫不得删除
    const inFlight = `settings.json.tmp.${process.pid}.1789224496993.bpwe6k`
    await fsp.writeFile(path.join(dir, inFlight), 'x')

    const removed = await sweepAtomicTmpResidue([dir])

    expect(removed).toBe(0)
    const left = await fsp.readdir(dir)
    expect(left).toContain(inFlight)
  })

  it('目录不存在 → 返回 0 不抛出(首次运行场景)', async () => {
    const removed = await sweepAtomicTmpResidue([path.join(os.tmpdir(), 'ea-nonexistent-xyz')])
    expect(removed).toBe(0)
  })

  it('atomicWrite 正常完成后不留 tmp', async () => {
    const dir = await makeDir()
    await atomicWrite(path.join(dir, 'settings.json'), '{"a":1}')
    const left = await fsp.readdir(dir)
    expect(left).toEqual(['settings.json'])
    expect(await fsp.readFile(path.join(dir, 'settings.json'), 'utf-8')).toBe('{"a":1}')
  })
})
