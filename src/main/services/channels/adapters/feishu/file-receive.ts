// =============================================================
// adapters/feishu/file-receive — 飞书附件接收(下载 + 落盘)
// (M3 从 feishu-bot/file-receive.ts 搬入;清洗/写盘/清理已上提
//  channels/runtime/attachment-store,此处保留飞书下载环节)
// =============================================================

import {
  cleanExpiredFiles as cleanExpiredFilesGeneric,
  type SavedAttachment,
  writeAttachmentBytes,
} from '../../runtime/attachment-store'
import { downloadResource } from './api'
import { RECEIVED_FILE_RETENTION_DAYS } from './constants'

export {
  formatBytes,
  type SavedAttachment,
  sanitizeFileName,
} from '../../runtime/attachment-store'

/**
 * 下载飞书消息附件并保存到本地目录。
 * 永不抛错:失败返回 { ok:false, error } 由调用方在回复中告知用户。
 */
export async function saveAttachment(opts: {
  getAccessToken: () => Promise<string | null>
  /** 附件所在消息的 message_id(下载接口按消息定位资源) */
  messageId: string
  fileKey: string
  kind: 'file' | 'image' | 'video' | 'audio'
  fileName?: string
  dir: string
}): Promise<{ ok: true; saved: SavedAttachment } | { ok: false; error: string }> {
  const displayName = opts.fileName ?? (opts.kind === 'image' ? '图片' : '文件')
  const token = await opts.getAccessToken()
  if (!token) {
    return { ok: false, error: `《${displayName}》无法获取访问令牌` }
  }
  const downloadKind = opts.kind === 'image' ? 'image' : 'file'
  const bytes = await downloadResource(token, opts.messageId, opts.fileKey, downloadKind)
  if (!bytes) {
    return {
      ok: false,
      error: `《${displayName}》下载失败(可能缺少「获取消息中的资源文件」权限,或文件已过期)`,
    }
  }
  return writeAttachmentBytes({
    bytes,
    fileName: opts.fileName,
    kind: opts.kind,
    dir: opts.dir,
    logScope: 'feishu-bot',
  })
}

/** 清理过期接收文件(保留 RECEIVED_FILE_RETENTION_DAYS 天);失败静默 */
export function cleanExpiredFiles(dir: string): Promise<void> {
  return cleanExpiredFilesGeneric(dir, RECEIVED_FILE_RETENTION_DAYS)
}
