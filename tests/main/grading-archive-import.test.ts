// =============================================================
// archive-import — zip 解压 / PDF 内嵌 JPEG 抽出
// =============================================================

import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { extractJpegsFromPdf, unzipEntries } from '../../src/main/services/grading/archive-import'

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) {
    c ^= b
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** 最小 store/deflate zip(单文件),供 unzipEntries 单测 */
function buildZip(name: string, data: Buffer, deflate = false): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const payload = deflate ? deflateRawSync(data) : data
  const crc = crc32(data)
  const method = deflate ? 8 : 0
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x800, 6) // UTF-8
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  const localBlock = Buffer.concat([local, nameBuf, payload])

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x800, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE(0, 42) // local header offset
  const cd = Buffer.concat([central, nameBuf])

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(localBlock.length, 16)
  return Buffer.concat([localBlock, cd, eocd])
}

function fakeJpeg(size = 9000): Buffer {
  const buf = Buffer.alloc(size, 0)
  buf[0] = 0xff
  buf[1] = 0xd8
  buf[2] = 0xff
  buf[3] = 0xe0
  buf[size - 2] = 0xff
  buf[size - 1] = 0xd9
  return buf
}

describe('extractJpegsFromPdf', () => {
  it('抽出内嵌 JPEG,丢掉过小的碎片', () => {
    const jpeg = fakeJpeg()
    const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9])
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4 '), tiny, jpeg, Buffer.from(' end')])
    const out = extractJpegsFromPdf(pdf)
    expect(out).toHaveLength(1)
    expect(out[0]?.length).toBe(jpeg.length)
  })
})

describe('unzipEntries', () => {
  it('解压 store 条目', () => {
    const data = Buffer.from('hello-zip')
    const zip = buildZip('张三/p1.jpg', data)
    const entries = unzipEntries(zip)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('张三/p1.jpg')
    expect(entries[0]?.data.toString()).toBe('hello-zip')
  })

  it('解压 deflate 条目', () => {
    const data = Buffer.from('deflated-payload-12345')
    const zip = buildZip('a.png', data, true)
    const entries = unzipEntries(zip)
    expect(entries[0]?.data.toString()).toBe('deflated-payload-12345')
  })

  it('拒绝路径穿越', () => {
    const zip = buildZip('../evil.jpg', Buffer.from('x'))
    expect(() => unzipEntries(zip)).toThrow('非法路径')
  })
})
