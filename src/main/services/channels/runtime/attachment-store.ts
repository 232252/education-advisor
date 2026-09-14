// =============================================================
// channels/runtime/attachment-store — 附件落盘通用件(清洗/写盘/过期清理)
// (M2 从 feishu-bot/file-receive.ts 拆出的平台无关部分)
// 渠道差异(飞书 file_key 下载 / 钉钉 downloadCode 两跳 / 企微 aeskey 解密)
// 留在各 Adapter;这里只管"拿到字节后怎么安全落盘"。
// =============================================================

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { log } from '../../../utils/logger'

/** 保存成功的附件信息 */
export interface SavedAttachment {
  /** 原始文件名(显示用) */
  name: string
  /** 本机绝对路径(Agent 按此读取) */
  path: string
  bytes: number
}

/** 文件名清洗:去路径分隔符/非法字符/控制符,限长,兜底 "file" */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 有意清洗控制字符
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'file'
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned
}

/**
 * 在目标目录内拼接安全文件名,并做根目录边界校验:
 * 拼接结果必须仍位于 dir 之下(防 ../ 路径穿越;文件名已清洗,此处双保险)。
 */
export function joinWithinDir(dir: string, fileName: string): string | null {
  const root = path.resolve(dir)
  const target = path.resolve(root, fileName)
  if (target !== root && target.startsWith(root + path.sep)) return target
  return null
}

/** 人类可读的字节数 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 把已下载的附件字节安全落盘(时间戳前缀防重名覆盖)。
 * 永不抛错:失败返回 { ok:false, error } 由调用方在回复中告知用户。
 */
export async function writeAttachmentBytes(opts: {
  bytes: Uint8Array
  /** 原始文件名(清洗后保存);缺省用 kind-时间戳.bin */
  fileName?: string
  kind: 'file' | 'image' | 'video' | 'audio'
  dir: string
  /** 日志作用域(渠道 id) */
  logScope?: string
}): Promise<{ ok: true; saved: SavedAttachment } | { ok: false; error: string }> {
  const scope = opts.logScope ?? 'channel'
  const displayName = opts.fileName ?? (opts.kind === 'image' ? '图片' : '文件')
  try {
    await fsp.mkdir(opts.dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const safeName = sanitizeFileName(opts.fileName ?? `${opts.kind}-${stamp}.bin`)
    const full = joinWithinDir(opts.dir, `${stamp}_${safeName}`)
    if (!full) {
      return { ok: false, error: `《${displayName}》文件名不合法` }
    }
    await fsp.writeFile(full, opts.bytes)
    log('info', scope, `attachment saved: ${full} (${opts.bytes.byteLength} bytes)`)
    return { ok: true, saved: { name: safeName, path: full, bytes: opts.bytes.byteLength } }
  } catch (err) {
    log('error', scope, `save attachment failed: ${err}`)
    return { ok: false, error: `《${displayName}》保存到本地失败` }
  }
}

/** 清理过期接收文件(默认保留 7 天);失败静默 */
export async function cleanExpiredFiles(dir: string, retentionDays = 7): Promise<void> {
  try {
    const root = path.resolve(dir)
    const entries = await fsp.readdir(root)
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    for (const entry of entries) {
      try {
        const full = joinWithinDir(root, entry)
        if (!full) continue
        const stat = await fsp.stat(full)
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          await fsp.unlink(full)
        }
      } catch {
        /* 单个文件清理失败忽略 */
      }
    }
  } catch {
    /* 目录不存在等忽略 */
  }
}
