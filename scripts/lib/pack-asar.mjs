// Test helper. Writes an asar in the same pickle layout as @electron/asar so
// asar-node and scripts/asar-preload/asar-read.mjs can both open it.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function align(n, alignTo) {
  return n + ((alignTo - (n % alignTo)) % alignTo)
}

function Pickle() {
  this.header = Buffer.alloc(0)
  this.headerSize = 4
  this.capacityAfterHeader = 0
  this.writeOffset = 0
  this.resize(64)
  this.setPayloadSize(0)
}
Pickle.prototype.setPayloadSize = function (n) {
  this.header.writeUInt32LE(n, 0)
}
Pickle.prototype.resize = function (n) {
  n = align(n, 64)
  this.header = Buffer.concat([this.header, Buffer.alloc(n)])
  this.capacityAfterHeader = n
}
Pickle.prototype.writeBytes = function (data, len, writer) {
  const padded = align(len, 4)
  const end = this.writeOffset + padded
  if (end > this.capacityAfterHeader) this.resize(Math.max(this.capacityAfterHeader * 2, end))
  if (writer) writer.call(this.header, data, this.headerSize + this.writeOffset)
  else this.header.write(data, this.headerSize + this.writeOffset, len)
  const zeroAt = this.headerSize + this.writeOffset + len
  this.header.fill(0, zeroAt, zeroAt + padded - len)
  this.setPayloadSize(end)
  this.writeOffset = end
  return true
}
Pickle.prototype.writeUInt32 = function (v) {
  return this.writeBytes(v, 4, Buffer.prototype.writeUInt32LE)
}
Pickle.prototype.writeInt = function (v) {
  return this.writeBytes(v, 4, Buffer.prototype.writeInt32LE)
}
Pickle.prototype.writeString = function (s) {
  const len = Buffer.byteLength(s, 'utf8')
  return this.writeInt(len) && this.writeBytes(s, len)
}
Pickle.prototype.toBuffer = function () {
  return this.header.subarray(0, this.headerSize + this.header.readUInt32LE(0))
}

export function packAsar(root, out) {
  const tree = { files: {} }
  const blobs = []
  let offset = 0
  const setFile = (rel, node) => {
    const parts = rel.split('/')
    let cur = tree
    for (let i = 0; i < parts.length - 1; i++) {
      cur.files[parts[i]] = cur.files[parts[i]] || { files: {} }
      cur = cur.files[parts[i]]
    }
    cur.files[parts[parts.length - 1]] = node
  }
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      const next = rel ? `${rel}/${name}` : name
      if (statSync(abs).isDirectory()) {
        setFile(next, { files: {} })
        walk(abs, next)
      } else {
        const buf = readFileSync(abs)
        setFile(next, { size: buf.length, offset: String(offset) })
        blobs.push(buf)
        offset += buf.length
      }
    }
  }
  walk(root, '')
  const headerPickle = new Pickle()
  headerPickle.writeString(JSON.stringify(tree))
  const headerBuf = Buffer.from(headerPickle.toBuffer())
  const sizePickle = new Pickle()
  sizePickle.writeUInt32(headerBuf.length)
  writeFileSync(out, Buffer.concat([Buffer.from(sizePickle.toBuffer()), headerBuf, ...blobs]))
}
