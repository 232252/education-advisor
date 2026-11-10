// Read Electron asar archives from stock Node. The header matches the pickle
// format @electron/asar and electron-builder write, so the same reader opens
// app.asar and the single node_modules.asar archives this installer ships.

import { existsSync, readFileSync, statSync } from 'node:fs'

const archives = new Map()

function align(n, alignTo) {
  return n + ((alignTo - (n % alignTo)) % alignTo)
}

class PickleIter {
  constructor(buf, payloadOffset, payloadSize) {
    this.buf = buf
    this.payloadOffset = payloadOffset
    this.readIndex = 0
    this.endIndex = payloadSize
  }

  readInt() {
    return this.readBytes(4).readInt32LE(0)
  }

  readUInt32() {
    return this.readBytes(4).readUInt32LE(0)
  }

  readString() {
    return this.readBytes(this.readInt()).toString('utf8')
  }

  readBytes(len) {
    if (len > this.endIndex - this.readIndex) throw new Error('asar header truncated')
    const off = this.payloadOffset + this.readIndex
    this.readIndex += align(len, 4)
    return this.buf.subarray(off, off + len)
  }
}

function openArchive(archivePath) {
  const cached = archives.get(archivePath)
  if (cached) return cached
  const buf = readFileSync(archivePath)
  const sizeIter = new PickleIter(buf.subarray(0, 8), 4, buf.readUInt32LE(0))
  const headerSize = sizeIter.readUInt32()
  const headerIter = new PickleIter(buf.subarray(8, 8 + headerSize), 4, buf.readUInt32LE(8))
  const archive = {
    header: JSON.parse(headerIter.readString()),
    dataOffset: 8 + headerSize,
    buf,
  }
  archives.set(archivePath, archive)
  return archive
}

/** Longest `.asar` prefix that is a real archive file, plus the inner path. */
export function splitAsar(filePath) {
  const normalized = filePath.replaceAll('\\', '/')
  let found = null
  let search = 0
  while (search < normalized.length) {
    const at = normalized.indexOf('.asar', search)
    if (at < 0) break
    const boundary = at + 5
    const next = normalized[boundary]
    if (next === undefined || next === '/') {
      const archive = filePath.slice(0, boundary)
      try {
        if (existsSync(archive) && statSync(archive).isFile()) {
          const inner = filePath.slice(boundary + (next === '/' ? 1 : 0)).replaceAll('\\', '/')
          found = { archive, inner }
        }
      } catch {
        /* not an archive */
      }
    }
    search = at + 1
  }
  return found
}

function nodeAt(archive, inner) {
  if (!inner) return archive.header
  let cur = archive.header
  for (const part of inner.split('/')) {
    if (!part || part === '.') continue
    cur = cur?.files?.[part]
    if (!cur) return null
    if (cur.link) cur = nodeAt(archive, String(cur.link).replaceAll('\\', '/'))
  }
  return cur
}

export function asarEntry(filePath) {
  const split = splitAsar(filePath)
  if (!split) return null
  const archive = openArchive(split.archive)
  const node = nodeAt(archive, split.inner)
  if (!node) return null
  if (node.files) return { directory: true, archive: split.archive, inner: split.inner }
  return {
    directory: false,
    unpacked: Boolean(node.unpacked),
    archive: split.archive,
    inner: split.inner,
    bytes: node.unpacked
      ? null
      : archive.buf.subarray(archive.dataOffset + Number(node.offset), archive.dataOffset + Number(node.offset) + node.size),
  }
}

export function archiveContains(archivePath, innerPath) {
  const entry = asarEntry(`${archivePath}/${innerPath}`)
  return Boolean(entry)
}
