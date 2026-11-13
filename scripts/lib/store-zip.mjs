// STORE-method zip (method 0). NSIS then LZMA-compresses the installer once.
// A deflated zip inside that 7z barely compresses again and the Setup grows.
import { closeSync, fstatSync, fsyncSync, openSync, readSync, writeSync } from 'node:fs'
import { crc32 } from 'node:zlib'

const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const EOCD = 0x06054b50
// DOS date 1980-01-01, time 00:00 — stable bytes when the tree is unchanged.
const DOS_TIME = 0
const DOS_DATE = 33

function dosName(name) {
  const normalized = name.replaceAll('\\', '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`zip path is not relative: ${name}`)
  }
  return normalized
}

/**
 * @param {string} outPath
 * @param {{ name: string, data: Buffer, mode?: number }[]} entries
 */
export function writeStoreZip(outPath, entries) {
  if (entries.length > 0xffff) {
    throw new Error(`zip has ${entries.length} files; classic zip holds at most 65535`)
  }
  const fd = openSync(outPath, 'w')
  const locals = []
  let offset = 0
  try {
    for (const entry of entries) {
      const name = Buffer.from(dosName(entry.name), 'utf8')
      const data = entry.data
      const crc = crc32(data) >>> 0
      const mode = entry.mode ?? 0o644
      const local = Buffer.alloc(30 + name.length)
      local.writeUInt32LE(LOCAL, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(0x0800, 6)
      local.writeUInt16LE(0, 8)
      local.writeUInt16LE(DOS_TIME, 10)
      local.writeUInt16LE(DOS_DATE, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(data.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(name.length, 26)
      local.writeUInt16LE(0, 28)
      name.copy(local, 30)
      writeSync(fd, local)
      writeSync(fd, data)
      locals.push({ name, crc, size: data.length, offset, mode })
      offset += local.length + data.length
      if (offset > 0xffffffff) throw new Error('zip exceeds 4 GiB')
    }
    const centralStart = offset
    for (const item of locals) {
      const central = Buffer.alloc(46 + item.name.length)
      central.writeUInt32LE(CENTRAL, 0)
      central.writeUInt16LE((3 << 8) | 20, 4)
      central.writeUInt16LE(20, 6)
      central.writeUInt16LE(0x0800, 8)
      central.writeUInt16LE(0, 10)
      central.writeUInt16LE(DOS_TIME, 12)
      central.writeUInt16LE(DOS_DATE, 14)
      central.writeUInt32LE(item.crc, 16)
      central.writeUInt32LE(item.size, 20)
      central.writeUInt32LE(item.size, 24)
      central.writeUInt16LE(item.name.length, 28)
      central.writeUInt16LE(0, 30)
      central.writeUInt16LE(0, 32)
      central.writeUInt16LE(0, 34)
      central.writeUInt16LE(0, 36)
      central.writeUInt32LE((item.mode & 0xffff) << 16, 38)
      central.writeUInt32LE(item.offset, 42)
      item.name.copy(central, 46)
      writeSync(fd, central)
      offset += central.length
    }
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(EOCD, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(locals.length, 8)
    eocd.writeUInt16LE(locals.length, 10)
    eocd.writeUInt32LE(offset - centralStart, 12)
    eocd.writeUInt32LE(centralStart, 16)
    eocd.writeUInt16LE(0, 20)
    writeSync(fd, eocd)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Method of the first local file header. STORE is 0. Does not inflate. */
export function firstZipMethod(zipPath) {
  const fd = openSync(zipPath, 'r')
  try {
    const head = Buffer.alloc(30)
    const n = readSync(fd, head, 0, 30, 0)
    if (n < 30 || head.readUInt32LE(0) !== LOCAL) return null
    return head.readUInt16LE(8)
  } finally {
    closeSync(fd)
  }
}

/** Central-directory names. Enough for the packaging check; does not inflate. */
export function listZipEntries(zipPath) {
  const fd = openSync(zipPath, 'r')
  try {
    const size = fstatSync(fd).size
    const tailLen = Math.min(size, 22 + 0xffff)
    const tail = Buffer.alloc(tailLen)
    readSync(fd, tail, 0, tailLen, size - tailLen)
    let eocdAt = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) {
        eocdAt = i
        break
      }
    }
    if (eocdAt < 0) throw new Error('zip is missing its end record')
    const count = tail.readUInt16LE(eocdAt + 10)
    const centralSize = tail.readUInt32LE(eocdAt + 12)
    const centralOffset = tail.readUInt32LE(eocdAt + 16)
    const central = Buffer.alloc(centralSize)
    readSync(fd, central, 0, centralSize, centralOffset)
    const names = []
    let cursor = 0
    for (let i = 0; i < count; i++) {
      if (central.readUInt32LE(cursor) !== CENTRAL) throw new Error('zip central directory is truncated')
      const nameLen = central.readUInt16LE(cursor + 28)
      const extra = central.readUInt16LE(cursor + 30)
      const comment = central.readUInt16LE(cursor + 32)
      names.push(central.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8'))
      cursor += 46 + nameLen + extra + comment
    }
    return names
  } finally {
    closeSync(fd)
  }
}
