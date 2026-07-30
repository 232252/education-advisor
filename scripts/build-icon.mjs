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
  // 清晰度优化:
  //  - 小尺寸(≤48)禁用 palette 量化,避免颜色精度损失导致发灰/模糊;
  //    用较低 compressionLevel 减少压缩伪影(小图本就很小,无需激进压缩)。
  //  - 大尺寸用 palette 提升压缩效率,compressionLevel 9。
  //  - density 768(v2 从 384 提升) 让矢量曲线/渐变在缩放时保留更多细节,边缘更锐利。
  const buffers = []
  for (const size of SIZES) {
    const small = size <= 48
    const buf = await sharp(svg, { density: 768 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
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
  // 高清 PNG: density 提到 72*4=288 已足够,但用更高 density(512)让细节更锐利。
  // 同时把每个 ICO 帧导出为独立 PNG (icon-16..icon-256), 供运行时按需取精确尺寸:
  //  - 托盘图标用 16@1x + 32@2x 多分辨率 NativeImage, 高 DPI 下不模糊
  //  - 每个帧都是直接从 SVG 按目标尺寸栅格化, 比从 512 缩小更清晰
  for (let i = 0; i < SIZES.length; i++) {
    writeFileSync(join(ROOT, 'resources', `icon-${SIZES[i]}.png`), buffers[i])
  }
  writeFileSync(PNG_256, buffers[SIZES.indexOf(256)])
  writeFileSync(PNG_512, await sharp(svg, { density: 1024 })
    .resize(512, 512).png({ compressionLevel: 9, palette: false }).toBuffer())
  writeFileSync(PNG_1024, await sharp(svg, { density: 1024 })
    .resize(1024, 1024).png({ compressionLevel: 9, palette: false }).toBuffer())
  writeFileSync(PNG_PATH, await sharp(svg, { density: 1024 })
    .resize(512, 512).png({ compressionLevel: 9, palette: false }).toBuffer())
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
