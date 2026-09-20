// =============================================================
// WebUI 上传落盘 — 文件名清洗 / 大小上限 / 路径不逃出暂存目录
// =============================================================

import { describe, expect, it } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import {
  MAX_UPLOAD_BYTES,
  receiveUpload,
  sanitizeUploadFilename,
  saveUploadedBuffer,
} from '../../src/main/services/webui/upload'

function reqWith(body: Buffer, headers: Record<string, string>): IncomingMessage {
  const r = Readable.from(body.length > 0 ? [body] : []) as IncomingMessage
  r.headers = headers
  r.resume = Readable.prototype.resume
  return r
}

describe('sanitizeUploadFilename', () => {
  it('去掉路径段,只留文件名', () => {
    expect(sanitizeUploadFilename('../../etc/passwd')).toBe('etcpasswd')
    // Windows 上 path.basename 会吃掉盘符,所以 C:\Windows\a.xlsx → Windowsa.xlsx
    expect(sanitizeUploadFilename('C:\\Windows\\a.xlsx')).not.toMatch(/[/\\]/)
    expect(sanitizeUploadFilename('C:\\Windows\\a.xlsx')).toMatch(/\.xlsx$/)
  })

  it('空、点、点点都落到 upload.bin', () => {
    expect(sanitizeUploadFilename('')).toBe('upload.bin')
    expect(sanitizeUploadFilename('..')).toBe('upload.bin')
    expect(sanitizeUploadFilename('.')).toBe('upload.bin')
  })

  it('保留中文花名册文件名', () => {
    expect(sanitizeUploadFilename('高一4班.xlsx')).toBe('高一4班.xlsx')
  })

  it('decodeURIComponent 一次', () => {
    expect(sanitizeUploadFilename(encodeURIComponent('notes.txt'))).toBe('notes.txt')
  })
})

describe('saveUploadedBuffer / receiveUpload', () => {
  it('写入暂存目录且文件名带时间戳前缀', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-up-'))
    const saved = await saveUploadedBuffer(dir, 'roster.xlsx', Buffer.from('PK'))
    expect(saved.ok).toBe(true)
    expect(saved.name).toBe('roster.xlsx')
    expect(saved.size).toBe(2)
    expect(path.dirname(saved.path)).toBe(dir)
    expect(path.basename(saved.path)).toMatch(/^\d+-[a-f0-9]{8}-roster\.xlsx$/)
    expect(await fsp.readFile(saved.path)).toEqual(Buffer.from('PK'))
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('POST 正文落盘,穿越文件名被清洗', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-up-'))
    const result = await receiveUpload(
      reqWith(Buffer.from('hello'), {
        'content-length': '5',
        'x-filename': encodeURIComponent('../evil.txt'),
      }),
      dir,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('evil.txt')
      expect(path.dirname(result.path)).toBe(dir)
      expect(await fsp.readFile(result.path, 'utf8')).toBe('hello')
    }
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('上传上限为 200MB(对齐 zip 导入总量口径)', () => {
    expect(MAX_UPLOAD_BYTES).toBe(200 * 1024 * 1024)
  })

  it('Content-Length 超过上限 → 413', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-up-'))
    const result = await receiveUpload(
      reqWith(Buffer.alloc(0), {
        'content-length': String(MAX_UPLOAD_BYTES + 1),
        'x-filename': 'big.bin',
      }),
      dir,
    )
    expect(result).toMatchObject({ ok: false, status: 413 })
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('正向边界: content-length=MAX_UPLOAD_BYTES-1 + 小正文放行,走 saveUploadedBuffer 落盘', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-up-'))
    const result = await receiveUpload(
      reqWith(Buffer.from('small-body'), {
        'content-length': String(MAX_UPLOAD_BYTES - 1),
        'x-filename': 'scan-bundle.pdf',
      }),
      dir,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('scan-bundle.pdf')
      expect(result.size).toBe(10)
      expect(await fsp.readFile(result.path, 'utf8')).toBe('small-body')
    }
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('空正文 → 400', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-up-'))
    const result = await receiveUpload(reqWith(Buffer.alloc(0), { 'content-length': '0' }), dir)
    expect(result).toMatchObject({ ok: false, status: 400 })
    await fsp.rm(dir, { recursive: true, force: true })
  })
})
