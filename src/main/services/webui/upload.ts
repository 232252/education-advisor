// =============================================================
// WebUI 浏览器上传 — 落盘到主机暂存目录,供 Agent 工具用绝对路径
// 聊天/花名册/批改在浏览器里选出的文件必须先到这台电脑上,
// 否则 read_excel / eaa_grading_from_files 看不到手机/另一台电脑的文件。
// =============================================================

import { randomBytes } from 'node:crypto'
import fsp from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'

/** 上传体量上限: 对齐 zip 导入 200MB 总量口径(50 页扫描 PDF 不在入口就被 413) */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const MAX_NAME_CHARS = 120

export type UploadOk = { ok: true; path: string; name: string; size: number }
export type UploadFail = { ok: false; status: number; error: string }
export type UploadResult = UploadOk | UploadFail

export function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

/** 只留文件名,去掉路径与 Windows 非法字符 */
export function sanitizeUploadFilename(raw: string): string {
  let name = raw.replace(/\0/g, '').trim()
  try {
    name = decodeURIComponent(name)
  } catch {
    /* 已是明文 */
  }
  name = name.replace(/[/\\]/g, '')
  const base = path.basename(name).replace(/[<>:"|?*]/g, '_')
  const cleaned = base.replace(/^\.+/, '').trim() || 'upload.bin'
  return cleaned.length > MAX_NAME_CHARS ? cleaned.slice(0, MAX_NAME_CHARS) : cleaned
}

export async function saveUploadedBuffer(
  uploadsDir: string,
  originalName: string,
  buf: Buffer,
): Promise<UploadResult> {
  const safeName = sanitizeUploadFilename(originalName)
  await fsp.mkdir(uploadsDir, { recursive: true })
  const destName = `${Date.now()}-${randomBytes(4).toString('hex')}-${safeName}`
  const dest = path.join(uploadsDir, destName)
  // 防御性兜底: 即便上游清洗失效,也拒绝写出暂存目录之外
  const root = path.resolve(uploadsDir)
  const resolved = path.resolve(dest)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return { ok: false, status: 400, error: 'invalid filename' }
  }
  await fsp.writeFile(dest, buf)
  return { ok: true, path: dest, name: safeName, size: buf.length }
}

function readBodyLimited(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > max) {
        req.off('data', onData)
        req.destroy()
        reject(Object.assign(new Error('too large'), { status: 413 }))
        return
      }
      chunks.push(buf)
    }
    req.on('data', onData)
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 从已鉴权的 POST /upload 读正文并落盘 */
export async function receiveUpload(
  req: IncomingMessage,
  uploadsDir: string,
): Promise<UploadResult> {
  const declared = Number(headerValue(req.headers['content-length']) || '0')
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    req.resume()
    return { ok: false, status: 413, error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` }
  }
  let buf: Buffer
  try {
    buf = await readBodyLimited(req, MAX_UPLOAD_BYTES)
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 413) {
      return { ok: false, status: 413, error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` }
    }
    return { ok: false, status: 400, error: err instanceof Error ? err.message : 'read failed' }
  }
  if (buf.length === 0) {
    return { ok: false, status: 400, error: 'empty body' }
  }
  const original = headerValue(req.headers['x-filename']) || 'upload.bin'
  return saveUploadedBuffer(uploadsDir, original, buf)
}
