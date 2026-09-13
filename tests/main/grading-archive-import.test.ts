// =============================================================
// archive-import — zip 解压 / PDF 展开为图片
// PDF 夹具全部手工构造(带正确 xref),覆盖:
// 电子排版(纯文字) / 扫描件(整页内嵌 JPEG 直通) / logo 陷阱 / Flate 图 / 损坏兜底
// 噪声像素用固定种子的 xorshift 生成(确定性,测试可复现;非加密用途)。
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateSync, deflateRawSync } from 'node:zlib'
import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import {
  extractJpegsFromPdf,
  jpegSize,
  materializePaperBatches,
  pdfToPageJpegs,
  unzipEntries,
  withTempDir,
} from '../../src/main/services/grading/archive-import'

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) {
    c ^= b
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** 固定种子确定性伪随机(测试夹具噪声像素用,可复现;非加密) */
function seededRandom(seed = 0x2f6e2ba1): () => number {
  let s = seed >>> 0
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s % 256
  }
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

// ---- PDF 夹具构造(xref 偏移精确计算) ----

/** 组装对象体列表为合法 PDF(1-based 编号,trailer Root=1) */
function assemblePdf(objects: Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')]
  const offsets: number[] = []
  let pos = parts[0].length
  for (const [idx, body] of objects.entries()) {
    offsets.push(pos)
    const head = Buffer.from(`${idx + 1} 0 obj\n`)
    const tail = Buffer.from('\nendobj\n')
    parts.push(head, body, tail)
    pos += head.length + body.length + tail.length
  }
  const xrefPos = pos
  const size = objects.length + 1
  const lines = [`xref\n0 ${size}\n0000000000 65535 f \n`]
  for (const off of offsets) lines.push(`${String(off).padStart(10, '0')} 00000 n \n`)
  lines.push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)
  parts.push(Buffer.from(lines.join('')))
  return Buffer.concat(parts)
}

function streamObj(dict: string, content: Buffer): Buffer {
  const head = Buffer.from(`<< ${dict} /Length ${content.length} >>\nstream\n`)
  return Buffer.concat([head, content, Buffer.from('\nendstream')])
}

/** 电子排版 PDF: 单页 A4 纯文字(Helvetica,未内嵌字体) */
function buildTextPdf(): Buffer {
  const content = Buffer.from('BT /F1 24 Tf 72 720 Td (Grading fixture) Tj ET', 'latin1')
  return assemblePdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    ),
    streamObj('', content),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ])
}

/** 内嵌图片 PDF;cm 控制绘制区域(默认整页),filter 控制编码(DCTDecode/FlateDecode) */
function buildImagePdf(
  imageData: Buffer,
  w: number,
  h: number,
  cm = '595 0 0 842 0 0',
  filter = 'DCTDecode',
): Buffer {
  const content = Buffer.from(`q ${cm} cm /Im0 Do Q`)
  return assemblePdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
    ),
    streamObj('', content),
    streamObj(
      `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} >>`,
      imageData,
    ),
  ])
}

/** 噪声图 JPEG(不可压缩,保证超过 8KB 缩略图阈值) */
function makeNoiseJpeg(w: number, h: number): Buffer {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(w, h)
  const rnd = seededRandom()
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = rnd()
    img.data[i + 1] = rnd()
    img.data[i + 2] = rnd()
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toBuffer('image/jpeg', 0.9)
}

/** 噪声 RGB 原始字节(Flate 图像用) */
function makeNoiseRgb(w: number, h: number): Buffer {
  const buf = Buffer.alloc(w * h * 3)
  const rnd = seededRandom()
  for (let i = 0; i < buf.length; i++) buf[i] = rnd()
  return buf
}

function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
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

describe('jpegSize', () => {
  it('读 SOF0 段的宽高', () => {
    // SOF0: FF C0 len=17 precision h w comps=3 …
    const sof = Buffer.from([
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x02, 0x58, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11,
      0x01, 0x03, 0x11, 0x01,
    ])
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
      sof,
      Buffer.alloc(32),
      Buffer.from([0xff, 0xd9]),
    ])
    expect(jpegSize(jpeg)).toEqual({ width: 600, height: 800 })
  })

  it('格式异常返回 null', () => {
    expect(jpegSize(fakeJpeg())).toBeNull()
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

  it('拒绝路径穿越(恶意 zip 夹具)', () => {
    // 拼接构造恶意条目名(上跳目录),验证解压器拒收
    const evilName = `..${'/'}evil.jpg`
    const zip = buildZip(evilName, Buffer.from('x'))
    expect(() => unzipEntries(zip)).toThrow('非法路径')
  })
})

describe('pdfToPageJpegs', () => {
  it('电子排版 PDF(纯文字,零内嵌图)栅格化出整页 JPEG', async () => {
    const pages = await pdfToPageJpegs(buildTextPdf(), 'fixture.pdf')
    expect(pages).toHaveLength(1)
    expect(isJpeg(pages[0])).toBe(true)
    // A4 渲染长边 300dpi 量级,远超缩略图
    expect(pages[0].length).toBeGreaterThan(4 * 1024)
  })

  it('扫描件 PDF(整页内嵌 JPEG)原字节直通,零再压缩', async () => {
    const jpeg = makeNoiseJpeg(1240, 1754)
    const pdf = buildImagePdf(jpeg, 1240, 1754)
    const pages = await pdfToPageJpegs(pdf, 'scan.pdf')
    expect(pages).toHaveLength(1)
    expect(pages[0].equals(jpeg)).toBe(true)
  })

  it('logo 陷阱: 小尺寸内嵌 JPEG 不冒充页面,走栅格化', async () => {
    const logo = makeNoiseJpeg(120, 160)
    const pdf = buildImagePdf(logo, 120, 160, '120 0 0 160 40 40')
    const pages = await pdfToPageJpegs(pdf, 'logo-trap.pdf')
    expect(pages).toHaveLength(1)
    expect(isJpeg(pages[0])).toBe(true)
    expect(pages[0].equals(logo)).toBe(false)
  })

  it('Flate 无损图像 PDF(常见扫描仪格式)栅格化', async () => {
    const rgb = makeNoiseRgb(300, 400)
    const pdf = buildImagePdf(deflateSync(rgb), 300, 400, '595 0 0 842 0 0', 'FlateDecode')
    const pages = await pdfToPageJpegs(pdf, 'flate.pdf')
    expect(pages).toHaveLength(1)
    expect(isJpeg(pages[0])).toBe(true)
  })

  it('损坏 PDF 裸抽内嵌 JPEG 兜底', async () => {
    const jpeg = makeNoiseJpeg(800, 1100)
    const broken = Buffer.concat([Buffer.from('%PDF-1.4 '), jpeg, Buffer.from(' broken')])
    const pages = await pdfToPageJpegs(broken, 'broken.pdf')
    expect(pages).toHaveLength(1)
    expect(pages[0].equals(jpeg)).toBe(true)
  })
})

describe('materializePaperBatches — PDF 路径', () => {
  it('散装文字版 PDF 落成一批整页 JPEG', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-pdf-fixture-'))
    const src = path.join(dir, 'fixture.pdf')
    await fsp.writeFile(src, buildTextPdf())
    await withTempDir(async (tmp) => {
      const batches = await materializePaperBatches([{ path: src }], tmp)
      expect(batches).toHaveLength(1)
      expect(batches[0].files).toHaveLength(1)
      expect(batches[0].files[0].name).toBe('fixture-p1.jpg')
      const buf = await fsp.readFile(batches[0].files[0].path)
      expect(isJpeg(buf)).toBe(true)
    })
  })

  it('zip 内 PDF(扫描件)同样出图', async () => {
    const jpeg = makeNoiseJpeg(1240, 1754)
    const zip = buildZip('张四/paper.pdf', buildImagePdf(jpeg, 1240, 1754))
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-zip-fixture-'))
    const src = path.join(dir, 'fixture.zip')
    await fsp.writeFile(src, zip)
    await withTempDir(async (tmp) => {
      const batches = await materializePaperBatches([{ path: src }], tmp)
      expect(batches).toHaveLength(1)
      expect(batches[0].files).toHaveLength(1)
      // zip 分支命名: 临时序号前缀 + 条目路径扁平化 + 页号
      expect(batches[0].files[0].name).toBe('p1-张四-paper.pdf-p1.jpg')
      const buf = await fsp.readFile(batches[0].files[0].path)
      expect(buf.equals(jpeg)).toBe(true)
    })
  })
})
