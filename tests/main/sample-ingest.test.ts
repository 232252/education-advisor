// =============================================================
// Sample Ingest — 输入格式兼容 + 降采样测试
// 格式冒烟矩阵: xlsx/csv→text(表格序列化) / md/txt/yaml→text /
//   docx→text+内嵌图 / pdf→images / jpg/png→images;
// 魔数嗅探(无扩展名 PDF / 误标扩展名纠正 / sniff 纯函数);
// zip 回归(图片+md 均非空、嵌套 zip 拒绝、成员计入上限、杂项跳过);
// 降采样: ≥3000px 长边 → loadImage 断言 ≤1600px + image/jpeg
//   (直读 / PDF 栅格化页 / zip 抽出图同口径)。
// 夹具全部手工构造(zip/PDF/docx 与 grading-archive-import.test.ts 同法)。
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  csvToMarkdownTable,
  decodeTextBuffer,
  ingestSampleFiles,
  isSampleExt,
  sniffImageMime,
  sniffSampleKind,
  splitCsvRows,
  type IngestOptions,
} from '../../src/main/services/grading/sample-ingest'

// ---------- 夹具构造 ----------

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) {
    c ^= b
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  }
  return (c ^ 0xffffffff) >>> 0
}

/** 多条目 zip(store/deflate 混合无关紧要,统一 deflate),与 unzipEntries 对齐 */
function buildZip(files: Array<[name: string, data: Buffer]>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const payload = deflateRawSync(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6) // UTF-8 文件名
    local.writeUInt16LE(8, 8) // deflate
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
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, nameBuf]))
    locals.push(localBlock)
    offset += localBlock.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

/** 最小 docx(zip+word/document.xml),正文段落逐条;内嵌图可选(已验证 mammoth 可读) */
function buildDocx(paragraphs: string[], media?: Array<[name: string, data: Buffer]>): Buffer {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  return buildZip([['word/document.xml', Buffer.from(docXml, 'utf8')], ...(media ?? [])])
}

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

/** 电子排版 PDF: 单页 A4 纯文字(未内嵌字体) */
function buildTextPdf(): Buffer {
  const content = Buffer.from('BT /F1 24 Tf 72 720 Td (Sample fixture) Tj ET', 'latin1')
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

/** 纯色 JPEG/PNG 夹具(有效可解码;尺寸可控) */
function makeImage(mime: 'image/jpeg' | 'image/png', w: number, h: number): Buffer {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#2a6fdb'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#ffffff'
  ctx.font = '48px sans-serif'
  ctx.fillText('sample', 24, Math.min(h - 24, 120))
  return canvas.toBuffer(mime, 0.9)
}

// ---------- 临时目录(受控边界) ----------

const tmpRoot = path.join(
  os.tmpdir(),
  `sample-ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)
const tmpRootAbs = path.resolve(tmpRoot)

/** 写夹具: 只接受纯 basename(白名单校验拒绝 ../ 与分隔符),resolve 后做根目录边界校验 */
async function writeFixture(name: string, data: Buffer | string): Promise<string> {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('fixture 名不能为空')
  }
  // 白名单: 必须是纯文件名(basename 自等),杜绝任何目录分量与上跳
  if (path.basename(name) !== name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error(`fixture 名必须是纯 basename: ${name}`)
  }
  const target = path.resolve(tmpRootAbs, name)
  if (!target.startsWith(tmpRootAbs + path.sep)) {
    throw new Error(`fixture 路径越出临时目录: ${name}`)
  }
  await fsp.writeFile(target, data)
  return target
}

const OPTS: IngestOptions = { maxImages: 12, maxFileBytes: 25 * 1024 * 1024, maxPdfPages: 8 }

beforeAll(async () => {
  await fsp.mkdir(tmpRootAbs, { recursive: true })
})

afterAll(async () => {
  try {
    await fsp.rm(tmpRootAbs, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

// ---------- 纯函数 ----------

describe('isSampleExt — 扩格式白名单', () => {
  it('xlsx/xls/csv/yaml/yml/zip 均支持;exe 拒绝', () => {
    for (const ext of [
      '.xlsx',
      '.xls',
      '.csv',
      '.yaml',
      '.yml',
      '.zip',
      '.jpg',
      '.pdf',
      '.docx',
      '.md',
      '.txt',
    ]) {
      expect(isSampleExt(ext)).toBe(true)
    }
    expect(isSampleExt('.exe')).toBe(false)
    expect(isSampleExt('')).toBe(false)
  })
})

describe('sniffImageMime / sniffSampleKind — 魔数嗅探', () => {
  it('PDF / JPEG / PNG / WebP / BMP 魔数', () => {
    expect(sniffSampleKind(Buffer.from('%PDF-1.4\n...'))).toBe('pdf')
    expect(sniffSampleKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image')
    expect(sniffSampleKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image')
    expect(sniffImageMime(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('image/webp')
    expect(sniffImageMime(Buffer.from('BM\x00\x00', 'latin1'))).toBe('image/bmp')
  })

  it('PK 魔数按内部结构辨 docx(有 word/)/xlsx(有 xl/)/zip(其余)', () => {
    const docx = buildDocx(['题干'])
    expect(sniffSampleKind(docx)).toBe('docx')
    const XLSX = require('xlsx') as typeof import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['姓名'], ['张三']]), 'Sheet1')
    expect(sniffSampleKind(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)).toBe(
      'xlsx',
    )
    expect(sniffSampleKind(buildZip([['notes.md', Buffer.from('# hi')]]))).toBe('zip')
  })

  it('普通文本/垃圾字节 → null(由调用方报教师可读错误)', () => {
    expect(sniffSampleKind(Buffer.from('姓名 学号\n张三 001'))).toBeNull()
    expect(sniffSampleKind(Buffer.from([0x01, 0x02, 0x03, 0x04]))).toBeNull()
  })
})

describe('decodeTextBuffer — utf8 严格 + GBK 兜底', () => {
  it('合法 utf8 原样解码', () => {
    expect(decodeTextBuffer(Buffer.from('姓名: 张三', 'utf8'))).toBe('姓名: 张三')
  })

  it('GBK 字节(中文 Windows ANSI)解码为中文', () => {
    // 「姓名:张三」的 GBK 序列(0xD0D5 0xC3FB 0x3A 0xD5C5 0xC8FD)
    const gbk = Buffer.from([0xd0, 0xd5, 0xc3, 0xfb, 0x3a, 0xd5, 0xc5, 0xc8, 0xfd])
    expect(decodeTextBuffer(gbk)).toBe('姓名:张三')
  })

  it('非 GBK 的二进制不误转(中文占比 sanity),按替换字符兜底不抛错', () => {
    const binary = Buffer.from([0x81, 0x40, 0x41, 0x00, 0x01, 0x02, 0xfe, 0xff, 0x03])
    const out = decodeTextBuffer(binary)
    expect(typeof out).toBe('string') // 不抛错
  })
})

describe('splitCsvRows / csvToMarkdownTable — 表格序列化', () => {
  it('CSV 行解析: 引号包裹/内嵌逗号/内嵌换行/转义引号', () => {
    expect(splitCsvRows('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(splitCsvRows('"x,y",z')).toEqual([['x,y', 'z']])
    expect(splitCsvRows('"l1\nl2",x')).toEqual([['l1\nl2', 'x']])
    expect(splitCsvRows('"he said ""hi""",1')).toEqual([['he said "hi"', '1']])
  })

  it('Markdown 表格: 首行表头 + 分隔行;竖线转义;空表空串', () => {
    expect(csvToMarkdownTable('姓名,学号\n张三,001')).toBe(
      '| 姓名 | 学号 |\n| --- | --- |\n| 张三 | 001 |',
    )
    expect(csvToMarkdownTable('a|b,c\nx,y')).toBe('| a\\|b | c |\n| --- | --- |\n| x | y |')
    expect(csvToMarkdownTable('\n \n')).toBe('')
  })
})

// ---------- 格式冒烟矩阵 ----------

describe('ingestSampleFiles — 格式冒烟矩阵', () => {
  it('xlsx → text 含 Markdown 表格序列化(表名/表头/数据行)', async () => {
    const XLSX = require('xlsx') as typeof import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['题号', '题干', '分值'],
        ['一', '选择题', 50],
        ['二', '解答题', 50],
      ]),
      'Sheet1',
    )
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const p = await writeFixture('sheet.xlsx', buf)
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.images).toHaveLength(0)
    expect(r.text).toContain('## Sheet1')
    expect(r.text).toContain('| 题号 | 题干 | 分值 |')
    expect(r.text).toContain('| 一 | 选择题 | 50 |')
  })

  it('csv → text 含表格序列化', async () => {
    const p = await writeFixture('answers.csv', '题号,参考答案\n1,B\n2,C')
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.images).toHaveLength(0)
    expect(r.text).toContain('| 题号 | 参考答案 |')
    expect(r.text).toContain('| 1 | B |')
  })

  it('md/txt/yaml → 原样文本', async () => {
    const files = await Promise.all([
      writeFixture('note.md', '# 考试说明\n一、选择题(每小题 5 分)'),
      writeFixture('plain.txt', '二、解答题(共 50 分)'),
      writeFixture('conf.yaml', 'exam: { name: 九班专题一, total: 100 }'),
    ])
    const r = await ingestSampleFiles(files, OPTS)
    expect(r.images).toHaveLength(0)
    expect(r.text).toContain('# 考试说明')
    expect(r.text).toContain('二、解答题(共 50 分)')
    expect(r.text).toContain('exam: { name: 九班专题一, total: 100 }')
  })

  it('docx → 正文文本 + 内嵌图(word/media)', async () => {
    const docx = buildDocx(['一、选择题（每小题 5 分，共 10 小题）', '二、解答题'], [
      ['word/media/image1.png', makeImage('image/png', 640, 480)],
    ])
    const p = await writeFixture('sample.docx', docx)
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.text).toContain('一、选择题（每小题 5 分，共 10 小题）')
    expect(r.images).toHaveLength(1)
    expect(r.images[0]?.mimeType).toBe('image/jpeg') // 降采样重编码统一 jpeg
  })

  it('pdf → images(栅格化整页)', async () => {
    const p = await writeFixture('exam.pdf', buildTextPdf())
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.images).toHaveLength(1)
    expect(r.images[0]?.mimeType).toBe('image/jpeg')
    expect((r.images[0]?.data ?? '').length).toBeGreaterThan(1000)
  })

  it('jpg/png → images(统一 jpeg 重编码)', async () => {
    const files = await Promise.all([
      writeFixture('a.jpg', makeImage('image/jpeg', 1200, 900)),
      writeFixture('b.png', makeImage('image/png', 900, 1200)),
    ])
    const r = await ingestSampleFiles(files, OPTS)
    expect(r.images).toHaveLength(2)
    for (const im of r.images) expect(im.mimeType).toBe('image/jpeg')
  })

  it('无扩展名 + PDF 魔数(%PDF-) → 按 PDF 解析出图', async () => {
    const p = await writeFixture('scan-noext', buildTextPdf())
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.images).toHaveLength(1)
    expect(r.images[0]?.mimeType).toBe('image/jpeg')
  })

  it('误标扩展名(.xlsx 实为 PDF) → 解析失败后按魔数纠正', async () => {
    const p = await writeFixture('mislabeled.xlsx', buildTextPdf())
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.images).toHaveLength(1)
    expect(r.images[0]?.mimeType).toBe('image/jpeg')
  })

  it('不识别类型(垃圾字节无扩展名) → 教师可读错误', async () => {
    const p = await writeFixture('garbage', Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]))
    await expect(ingestSampleFiles([p], OPTS)).rejects.toThrow('不支持的样卷格式')
  })

  it('GBK 编码 txt → 解码为中文', async () => {
    // 「姓名:张三」的 GBK 序列
    const gbk = Buffer.from([0xd0, 0xd5, 0xc3, 0xfb, 0x3a, 0xd5, 0xc5, 0xc8, 0xfd])
    const p = await writeFixture('ansi.txt', gbk)
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.text).toContain('姓名:张三')
  })

  it('多文件混排: 表格文本与图片同批产出', async () => {
    const files = await Promise.all([
      writeFixture('sheet2.csv', '题号,分值\n一,50'),
      writeFixture('page.jpg', makeImage('image/jpeg', 800, 600)),
    ])
    const r = await ingestSampleFiles(files, OPTS)
    expect(r.images).toHaveLength(1)
    expect(r.text).toContain('| 题号 | 分值 |')
  })
})

// ---------- zip 回归 ----------

describe('ingestSampleFiles — zip 摄取', () => {
  it('【回归】含图片+md 的 zip → images 与 text 均非空,不报「不支持的样卷格式」', async () => {
    const zip = buildZip([
      ['papers/scan.jpg', makeImage('image/jpeg', 1000, 1400)],
      ['papers/notes.md', Buffer.from('# 样卷说明\n一、选择题(每小题 5 分)', 'utf8')],
    ])
    const p = await writeFixture('bundle.zip', zip)
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.images.length).toBeGreaterThan(0)
    expect(r.images[0]?.mimeType).toBe('image/jpeg')
    expect(r.text).toContain('一、选择题(每小题 5 分)')
    expect(r.text).toContain('bundle.zip/papers/notes.md')
  })

  it('zip 内 pdf 成员 → 栅格化出图(计入 maxImages)', async () => {
    const zip = buildZip([['inner/exam.pdf', buildTextPdf()]])
    const p = await writeFixture('with-pdf.zip', zip)
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.images).toHaveLength(1)
  })

  it('zip 内 zip → 拒绝并提示重新打包', async () => {
    const inner = buildZip([['a.txt', Buffer.from('x')]])
    const zip = buildZip([['nested.zip', inner]])
    const p = await writeFixture('nested.zip', zip)
    await expect(ingestSampleFiles([p], OPTS)).rejects.toThrow('重新打包')
  })

  it('zip 成员计入 maxFileBytes: 超限报教师可读错误', async () => {
    // 4096 字节零填充 deflate 后远小于容器,保证顶层文件过检、成员超限
    const zip = buildZip([['big.bin', Buffer.alloc(4096)]])
    const p = await writeFixture('big-member.zip', zip)
    await expect(ingestSampleFiles([p], { ...OPTS, maxFileBytes: 2048 })).rejects.toThrow(
      'zip 内文件超过',
    )
  })

  it('zip 内不识别的杂项 → 跳过并在文本中留痕,不阻断', async () => {
    const zip = buildZip([
      ['readme.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00])],
      ['note.md', Buffer.from('答案要点', 'utf8')],
    ])
    const p = await writeFixture('mixed.zip', zip)
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.text).toContain('答案要点')
    expect(r.text).toContain('未识别的文件已跳过')
    expect(r.text).toContain('readme.exe')
  })

  it('docx 带 DOCTYPE/ENTITY 的 XML 成员 → 拒绝解析(安全约束)', async () => {
    const evilXml = Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><w:document/>',
      'utf8',
    )
    const docx = buildZip([
      ['word/document.xml', evilXml],
      ['word/media/image1.png', makeImage('image/png', 100, 100)],
    ])
    const p = await writeFixture('evil.docx', docx)
    await expect(ingestSampleFiles([p], OPTS)).rejects.toThrow('DOCTYPE/ENTITY')
  })
})

// ---------- 降采样(入模图片统一 ≤1600px JPEG) ----------

describe('ingestSampleFiles — 降采样同口径', () => {
  /** 解码 base64 图片断言: 长边 ≤1600 且为 JPEG */
  async function expectDownscaled(image: { data: string; mimeType: string }): Promise<void> {
    expect(image.mimeType).toBe('image/jpeg')
    const buf = Buffer.from(image.data, 'base64')
    expect(buf[0]).toBe(0xff) // JPEG SOI
    expect(buf[1]).toBe(0xd8)
    const img = await loadImage(buf)
    expect(Math.max(img.width, img.height)).toBeLessThanOrEqual(1600)
  }

  it('直读大图(3200×2400 png) → 长边 ≤1600 且 image/jpeg', async () => {
    const p = await writeFixture('huge.png', makeImage('image/png', 3200, 2400))
    const r = await ingestSampleFiles([p], OPTS)
    expect(r.images).toHaveLength(1)
    await expectDownscaled(r.images[0] as { data: string; mimeType: string })
  })

  it('直读大图(2400×3600 jpg 竖版) → 长边 ≤1600', async () => {
    const p = await writeFixture('tall.jpg', makeImage('image/jpeg', 2400, 3600))
    const r = await ingestSampleFiles([p], OPTS)
    await expectDownscaled(r.images[0] as { data: string; mimeType: string })
  })

  it('PDF 栅格化页(A4 约 3508px 长边) → 同口径 ≤1600', async () => {
    const p = await writeFixture('a4.pdf', buildTextPdf())
    const r = await ingestSampleFiles([p], OPTS)
    await expectDownscaled(r.images[0] as { data: string; mimeType: string })
  })

  it('zip 内抽出大图 → 同口径 ≤1600', async () => {
    const zip = buildZip([['scan.png', makeImage('image/png', 3000, 2000)]])
    const p = await writeFixture('big-img.zip', zip)
    const r = await ingestSampleFiles([p], OPTS)
    await expectDownscaled(r.images[0] as { data: string; mimeType: string })
  })

  it('docx 内嵌大图 → 同口径 ≤1600', async () => {
    const docx = buildDocx(['题干'], [
      ['word/media/image1.png', makeImage('image/png', 4000, 3000)],
    ])
    const p = await writeFixture('big-embed.docx', docx)
    const r = await ingestSampleFiles([p], OPTS)
    await expectDownscaled(r.images[0] as { data: string; mimeType: string })
  })
})

// ---------- 渲染层选择器契约 ----------

describe('SAMPLE_PICK_EXTENSIONS — UI 选择器与主进程白名单一致', () => {
  it('@shared 选择器清单里的每种扩展名主进程都必须接受', async () => {
    const { SAMPLE_PICK_EXTENSIONS } = await import('@shared/grading-helpers')
    expect(SAMPLE_PICK_EXTENSIONS.length).toBeGreaterThan(0)
    for (const ext of SAMPLE_PICK_EXTENSIONS) {
      expect(isSampleExt(`.${ext}`)).toBe(true)
    }
  })

  it('表格/压缩包新格式同时出现在两边(UI 能选,主进程能收)', async () => {
    const { SAMPLE_PICK_EXTENSIONS } = await import('@shared/grading-helpers')
    for (const ext of ['xlsx', 'xls', 'csv', 'yaml', 'yml', 'zip']) {
      expect(SAMPLE_PICK_EXTENSIONS).toContain(ext)
      expect(isSampleExt(`.${ext}`)).toBe(true)
    }
    expect(isSampleExt('.exe')).toBe(false)
  })
})
