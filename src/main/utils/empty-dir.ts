// =============================================================
// 清空目录内容（保留目录本身）。目录不存在则忽略。
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'

export async function emptyDir(dir: string): Promise<void> {
  let entries: Array<{ name: string }>
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    throw err
  }
  await Promise.all(
    entries.map((e) => fsp.rm(path.join(dir, e.name), { recursive: true, force: true })),
  )
}
