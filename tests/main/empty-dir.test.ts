// =============================================================
// emptyDir — 清空目录内容、目录不存在则忽略
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyDir } from '../../src/main/utils/empty-dir'

describe('emptyDir', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
  })

  it('清空子文件与子目录，保留根目录', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-empty-dir-'))
    dirs.push(dir)
    await fsp.writeFile(path.join(dir, 'a.txt'), 'x')
    await fsp.mkdir(path.join(dir, 'sub'))
    await fsp.writeFile(path.join(dir, 'sub', 'b.txt'), 'y')
    await emptyDir(dir)
    const left = await fsp.readdir(dir)
    expect(left).toEqual([])
  })

  it('目录不存在时不抛错', async () => {
    await expect(emptyDir(path.join(os.tmpdir(), 'ea-empty-dir-missing-xyz'))).resolves.toBeUndefined()
  })
})
