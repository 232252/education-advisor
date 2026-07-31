// scripts/build-icon.mjs
// =============================================================
// Reads resources/icon.svg, rasterizes it to multiple PNG sizes,
// embeds them in a single .ico file (Windows) using PNG-in-ICO,
// and also writes resources/icon.png at 512×512 (macOS / Linux).
//
// Windows uses the .ico; macOS and Linux prefer the .png.
// electron-builder picks the right one per platform automatically.
//
// Why we hand-roll the .ico writer: most npm ICO packages convert
// the PNG to uncompressed BMP internally, ballooning 256×256 PNGs
// from 5 KB to ~260 KB. PNG-in-ICO is supported by Windows Vista
// and later, and keeps the file tiny.
// =============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SVG_PATH = join(ROOT, 'resources', 'icon.svg')
const ICO_PATH = join(ROOT, 'resources', 'icon.ico')
const PNG_PATH = join(ROOT, 'resources', 'icon.png')
const PNG_256 = join(ROOT, 'resources', 'icon-256.png')
const PNG_512 = join(ROOT, 'resources', 'icon-512.png')
const PNG_1024 = join(ROOT, 'resources', 'icon-1024.png')

// ICO entries are limited to 256×256 (width/height are uint8 in the
// ICONDIRENTRY; 0 means 256). Larger sizes are emitted as separate
// PNGs for macOS / Linux.
const SIZES = [16, 24, 32, 48, 64, 128, 256]

function buildPngInIco(buffers) {
  // Each entry: 6 (ICONDIR) + 16*n (ICONDIRENTRYs) + sum of PNG sizes
  const n = buffers.length
  const headerSize = 6 + 16 * n
  let totalSize = headerSize
  for (const buf of buffers) totalSize += buf.length

  const out = Buffer.alloc(totalSize)
  // ICONDIR
  out.writeUInt16LE(0, 0)            // reserved
  out.writeUInt16LE(1, 2)            // type: 1 = icon
  out.writeUInt16LE(n, 4)            // count

  let offset = headerSize
  for (let i = 0; i < n; i++) {
    const png = buffers[i]
    // We need the actual width / height. Read the PNG IHDR.
    // PNG signature is 8 bytes, then 4-byte length, then 'IHDR', then
    // 4-byte width, 4-byte height, ...
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    const w = width >= 256 ? 0 : width
    const h = height >= 256 ? 0 : height

    const entryOff = 6 + i * 16
    out.writeUInt8(w, entryOff)              // width (0 = 256)
    out.writeUInt8(h, entryOff + 1)          // height
    out.writeUInt8(0, entryOff + 2)           // color count
    out.writeUInt8(0, entryOff + 3)          // reserved
    out.writeUInt16LE(1, entryOff + 4)       // planes
    out.writeUInt16LE(32, entryOff + 6)      // bit count
    out.writeUInt32LE(png.length, entryOff + 8)  // bytes in resource
    out.writeUInt32LE(offset, entryOff + 12)     // image offset

    png.copy(out, offset)
    offset += png.length
  }
  return out
}

async function main() {
  console.log(`Reading ${SVG_PATH}`)
  const svg = readFileSync(SVG_PATH)

  // Rasterize each size.
  // 清晰度优化 (v4):
  //  - 超采样: 每个目标尺寸从 ~4x 源位图缩小 (lanczos3), 边缘抗锯齿显著优于 1:1 栅格化。
  //    density 是 DPI 语义: 1024 viewBox 下 sourcePx = 1024 * density/72。
  //    源边长钳制在 [256, 4096], 避免超出 sharp 像素上限 (29127px @ density 2048 的教训)。
  //  - 小尺寸(≤48)加轻微 sharpen 抵消缩小软化; 禁用 palette 量化避免发灰。
  //  - 大尺寸 compressionLevel 9。
  const SVG_UNITS = 1024
  const densityFor = (sourcePx) => (sourcePx / SVG_UNITS) * 72
  const sourceFor = (size) => Math.min(Math.max(size * 4, 256), 4096)
  const rasterize = (size) =>
    sharp(svg, { density: densityFor(sourceFor(size)) }).resize(size, size, {
      fit: 'contain',
      kernel: 'lanczos3',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
  const buffers = []
  for (const size of SIZES) {
    const small = size <= 48
    let pipeline = rasterize(size)
    if (small) pipeline = pipeline.sharpen({ sigma: 0.6, m1: 0.8, m2: 0.3 })
    const buf = await pipeline
      .png({
        compressionLevel: small ? 6 : 9,
        palette: false, // 全尺寸保留完整 RGBA,不再对任何尺寸做调色板量化
        quality: 100,
      })
      .toBuffer()
    buffers.push(buf)
    console.log(`  ${size}×${size}  →  ${buf.length} bytes`)
  }

  // Save the 256/512/1024 PNGs for macOS / Linux.
  // 高清 PNG: v4 同样走 rasterize() 的 4x 超采样管线。
  // 同时把每个 ICO 帧导出为独立 PNG (icon-16..icon-256), 供运行时按需取精确尺寸:
  //  - 托盘图标用 16@1x + 32@2x 多分辨率 NativeImage, 高 DPI 下不模糊
  //  - 每个帧都是直接从 SVG 按目标尺寸栅格化, 比从 512 缩小更清晰
  for (let i = 0; i < SIZES.length; i++) {
    writeFileSync(join(ROOT, 'resources', `icon-${SIZES[i]}.png`), buffers[i])
  }
  writeFileSync(PNG_256, buffers[SIZES.indexOf(256)])
  writeFileSync(PNG_512, await rasterize(512).png({ compressionLevel: 9, palette: false }).toBuffer())
  writeFileSync(PNG_1024, await rasterize(1024).png({ compressionLevel: 9, palette: false }).toBuffer())
  writeFileSync(PNG_PATH, await rasterize(512).png({ compressionLevel: 9, palette: false }).toBuffer())
  console.log(`Wrote ${PNG_PATH} (512×512)`)

  // Build the .ico (PNG-in-ICO, hand-rolled).
  console.log(`Building ${ICO_PATH} ...`)
  const ico = buildPngInIco(buffers)
  writeFileSync(ICO_PATH, ico)
  console.log(`Wrote ${ICO_PATH} (${ico.length} bytes, ${SIZES.length} sizes)`)

  const totalPng = buffers.reduce((s, b) => s + b.length, 0)
  console.log(`\nDone. Total PNG payload: ${totalPng} bytes, ICO payload: ${ico.length} bytes.`)
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err))
  process.exit(1)
})
