// =============================================================
// 原子写盘 — 唯一权威实现(M17b 收敛)
// 此前 fd+writeFile+fsync+close+rename 序列有三份手写副本:
//   - keystore-service.ts save()(密钥落盘)
//   - settings/persistence.ts saveNow()(设置落盘)
//   - 本模块(但缺 fsync,A6 之前的旧序列)
// 现统一为本模块的 fd+fsync 序列 + EPERM/EACCES/EBUSY/ENOENT 重试,
// 三处消费者共享同一实现——半路上断电/崩溃场景只有一份代码要修。
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'

const RENAME_MAX_RETRIES = 5
const RENAME_RETRY_DELAY_MS = 100
const WRITE_MAX_RETRIES = 3
const WRITE_RETRY_DELAY_MS = 50

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function renameWithRetry(src: string, dest: string, attempt = 0): Promise<void> {
  try {
    await fsp.rename(src, dest)
  } catch (err) {
    const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined
    if (
      (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') &&
      attempt < RENAME_MAX_RETRIES
    ) {
      await delay(RENAME_RETRY_DELAY_MS * (attempt + 1))
      return renameWithRetry(src, dest, attempt + 1)
    }
    throw err
  }
}

/**
 * fd 打开 → 写入 → fsync → close(A6 序列,确保数据真正落盘后再 rename)。
 * fsync 是收敛的核心收益: keystore/settings 此前的手写副本都带 fsync,
 * 防止 Windows 文件缓存在 SIGKILL/断电时丢失刚 rename 的内容(R4 同类问题)。
 */
async function fdWriteWithSync(
  tmpPath: string,
  data: string | Buffer,
  encoding: BufferEncoding | undefined,
): Promise<void> {
  const fd = await fsp.open(tmpPath, 'w')
  try {
    await fd.writeFile(data, encoding)
    await fd.sync()
  } finally {
    await fd.close()
  }
}

/**
 * 写 tmp 文件,对 EPERM/EACCES/EBUSY 重试 (与 rename 同策略)。
 * 这些错误在某些环境下会被沙箱/杀毒软件间歇性触发 (如 TRAE Sandbox 拦截 Electron 主进程的 .tmp 写入)。
 * ENOENT 时重建父目录后重试(父目录可能被并发清理)。
 * 重试不影响生产环境,只是让写入更健壮。
 */
async function writeWithRetry(
  tmpPath: string,
  data: string | Buffer,
  encoding: BufferEncoding | undefined,
  attempt = 0,
): Promise<void> {
  try {
    await fdWriteWithSync(tmpPath, data, encoding)
  } catch (writeErr) {
    const code = writeErr instanceof Error ? (writeErr as NodeJS.ErrnoException).code : undefined
    if (code === 'ENOENT') {
      // 父目录可能被并发清理,重新创建后重试
      await fsp.mkdir(path.dirname(tmpPath), { recursive: true })
      return writeWithRetry(tmpPath, data, encoding, attempt)
    }
    if (
      (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') &&
      attempt < WRITE_MAX_RETRIES
    ) {
      await delay(WRITE_RETRY_DELAY_MS * (attempt + 1))
      return writeWithRetry(tmpPath, data, encoding, attempt + 1)
    }
    throw writeErr
  }
}

export async function atomicWrite(
  filePath: string,
  data: string | Buffer,
  encoding: BufferEncoding = 'utf-8',
): Promise<void> {
  const dir = path.dirname(filePath)
  await fsp.mkdir(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  try {
    await writeWithRetry(tmpPath, data, encoding)
  } catch (writeErr) {
    // 重试仍失败,清理 tmp 后抛出
    fsp.unlink(tmpPath).catch(() => {})
    throw writeErr
  }
  await renameWithRetry(tmpPath, filePath)
  fsp.unlink(tmpPath).catch(() => {})
}
