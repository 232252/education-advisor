// =============================================================
// ZIP 归档工具 — 纯 Node 内置实现(zlib + CRC32),无第三方依赖
//
// 用途: 全量数据备份/恢复 (backup-service)。
// 设计:
//   - 写入: deflate 压缩(method 8), 文件名 UTF-8 (GP bit 11)
//   - 读取: 从 EOCD 定位 central directory, 逐条目解压并校验 CRC32
//   - 安全: 条目名白名单校验(相对路径/无 .. /无盘符),防 zip-slip
//   - 限制: 不支持 zip64(单包 < 4GB,应用数据量级远小于此)
// =============================================================

import fsp from 'node:fs/promises'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const METHOD_DEFLATE = 8
const METHOD_STORE = 0
const GP_UTF8 = 0x0800
const MAX_ZIP_SIZE = 0xffffffff // 4GB - 1 (zip64 不支持)

// ---------- CRC32 ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// ---------- 条目名安全校验 ----------

/**
 * 校验 zip 条目名是否安全(防 zip-slip / 绝对路径 / 盘符 / 父目录穿越)。
 * 合法条目名: 相对路径, 正斜杠分隔, 无空段开头, 无 .. 段。
 */
export function isSafeEntryName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 1024) return false
  if (name.includes('\0')) return false
  if (name.includes('\\')) return false
  if (name.startsWith('/') || name.includes(':')) return false
  const segments = name.split('/')
  if (segments.includes('') || segments.includes('.')) return false
  if (segments.includes('..')) return false
  return true
}

// ---------- DOS 时间 ----------

function toDosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dateVal = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: dateVal }
}

// ---------- 写入 ----------

export interface ZipInput {
  name: string
  data: Buffer
}

/**
 * 在内存中构建 zip 归档。
 * 返回单个 Buffer(应用数据量级下内存可控,备份写入走 atomicWrite)。
 */
export function createZip(entries: ZipInput[], mtime = new Date()): Buffer {
  const { time, date } = toDosDateTime(mtime)
  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8')
    const crc = crc32(entry.data)
    const compressed = deflateRawSync(entry.data, { level: 6 })
    // 压缩无收益时退回 store,避免负优化
    const useDeflate = compressed.length < entry.data.length
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE
    const payload = useDeflate ? compressed : entry.data

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(GP_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra len

    localChunks.push(local, nameBuf, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(GP_UTF8, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra len
    central.writeUInt16LE(0, 32) // comment len
    central.writeUInt16LE(0, 34) // disk start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centralChunks.push(central, nameBuf)

    offset += local.length + nameBuf.length + payload.length
  }

  const centralBuf = Buffer.concat(centralChunks)
  if (offset + centralBuf.length + 22 > MAX_ZIP_SIZE) {
    throw new Error('zip size exceeds 4GB (zip64 unsupported)')
  }

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4) // disk
  eocd.writeUInt16LE(0, 6) // cd disk
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // comment len

  return Buffer.concat([...localChunks, centralBuf, eocd])
}

// ---------- 读取 ----------

export interface ZipEntry {
  name: string
  data: Buffer
}

/** 从 Buffer 解析 zip(整包读入内存后解析)。条目名不合法时抛错。 */
export function readZipBuffer(buf: Buffer): ZipEntry[] {
  // 1. 从尾部扫描 EOCD(倒序找签名,注释最长 64KB)
  const scanStart = Math.max(0, buf.length - 22 - 0xffff)
  let eocdPos = -1
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocdPos = i
      break
    }
  }
  if (eocdPos < 0) throw new Error('invalid zip: EOCD not found')

  const entryCount = buf.readUInt16LE(eocdPos + 10)
  const cdSize = buf.readUInt32LE(eocdPos + 12)
  const cdOffset = buf.readUInt32LE(eocdPos + 16)
  if (cdOffset + cdSize > eocdPos) throw new Error('invalid zip: central directory out of range')

  const entries: ZipEntry[] = []
  let pos = cdOffset

  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new Error(`invalid zip: bad central directory entry #${i}`)
    }
    const method = buf.readUInt16LE(pos + 10)
    const crc = buf.readUInt32LE(pos + 16)
    const csize = buf.readUInt32LE(pos + 20)
    const usize = buf.readUInt32LE(pos + 24)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localOffset = buf.readUInt32LE(pos + 42)
    const name = buf.toString('utf-8', pos + 46, pos + 46 + nameLen)
    if (!isSafeEntryName(name)) {
      throw new Error(`unsafe zip entry name: "${name}"`)
    }

    // 2. 定位 local header(local 头自身的 name/extra 长度可能与 central 不同,必须按 local 解析)
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`invalid zip: bad local header for "${name}"`)
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    if (dataStart + csize > buf.length) {
      throw new Error(`invalid zip: data out of range for "${name}"`)
    }
    const compressed = buf.subarray(dataStart, dataStart + csize)

    let data: Buffer
    if (method === METHOD_STORE) {
      data = Buffer.from(compressed)
    } else if (method === METHOD_DEFLATE) {
      data = inflateRawSync(compressed)
    } else {
      throw new Error(`unsupported compression method ${method} for "${name}"`)
    }

    if (data.length !== usize) {
      throw new Error(`zip entry "${name}" size mismatch`)
    }
    if (crc32(data) !== crc) {
      throw new Error(`zip entry "${name}" CRC mismatch`)
    }
    entries.push({ name, data })
    pos += 46 + nameLen + extraLen + commentLen
  }

  return entries
}

/** 读取 zip 文件并解析。 */
export async function readZipFile(zipPath: string): Promise<ZipEntry[]> {
  const buf = await fsp.readFile(zipPath)
  return readZipBuffer(buf)
}
