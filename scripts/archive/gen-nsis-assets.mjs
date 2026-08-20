import sharp from 'sharp';
import { copyFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1e3a8a"/>
      <stop offset="50%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#e0e7ff" stop-opacity="0.8"/>
    </linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#bg)"/>
  <circle cx="130" cy="40" r="60" fill="#ffffff" opacity="0.05"/>
  <circle cx="30" cy="280" r="50" fill="#ffffff" opacity="0.05"/>
  <circle cx="140" cy="260" r="30" fill="#ffffff" opacity="0.03"/>
  <g transform="translate(52, 70)">
    <rect width="60" height="60" rx="14" fill="url(#logoGrad)" opacity="0.95"/>
    <path d="M12 38V22L30 15L48 22V38L30 45L12 38Z" stroke="#3b82f6" stroke-width="2.5" stroke-linejoin="round" fill="none"/>
    <path d="M30 27V38" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="30" cy="22" r="2" fill="#3b82f6"/>
  </g>
  <text x="82" y="170" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">Education</text>
  <text x="82" y="192" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">Advisor</text>
  <text x="82" y="225" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="10" fill="#bfdbfe">让教育更智能</text>
  <text x="82" y="242" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="10" fill="#bfdbfe">让教师更轻松</text>
  <text x="82" y="290" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="9" fill="#93c5fd" opacity="0.8">v0.1.0 · Tauri 2</text>
</svg>`;

const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <defs>
    <linearGradient id="hbg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="150" height="57" rx="4" fill="url(#hbg)"/>
  <g transform="translate(12, 14)">
    <rect width="28" height="28" rx="6" fill="#ffffff" opacity="0.2"/>
    <path d="M7 20V11L14 8L21 11V20L14 23L7 20Z" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round" fill="none"/>
  </g>
  <text x="50" y="35" font-family="Microsoft YaHei, sans-serif" font-size="13" font-weight="bold" fill="#ffffff">Education Advisor</text>
</svg>`;

async function pngToBmp(pngBuffer, width, height) {
  const raw = await sharp(pngBuffer).raw().toBuffer();
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buf = Buffer.alloc(fileSize);
  
  // BMP Header
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10);
  
  // DIB Header (BITMAPINFOHEADER)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(0, 46);
  buf.writeUInt32LE(0, 50);
  
  // Pixel data (BMP is bottom-up, BGR)
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const src = srcRow + x * 4;
      const dst = dstRow + x * 3;
      buf[dst] = raw[src + 2];     // B
      buf[dst + 1] = raw[src + 1]; // G
      buf[dst + 2] = raw[src];     // R
    }
  }
  
  return buf;
}

const outDir = join('src-tauri', 'nsis');

// Generate sidebar BMP (164x314)
const sidebarPng = await sharp(Buffer.from(sidebarSvg)).resize(164, 314).png().toBuffer();
const sidebarBmp = await pngToBmp(sidebarPng, 164, 314);
writeFileSync(join(outDir, 'sidebar.bmp'), sidebarBmp);

// Generate header BMP (150x57)
const headerPng = await sharp(Buffer.from(headerSvg)).resize(150, 57).png().toBuffer();
const headerBmp = await pngToBmp(headerPng, 150, 57);
writeFileSync(join(outDir, 'header.bmp'), headerBmp);

// Copy icon
copyFileSync('src-tauri/icons/icon.ico', join(outDir, 'installer.ico'));

console.log('NSIS resources generated successfully');
console.log('  sidebar.bmp: 164x314');
console.log('  header.bmp:  150x57');
console.log('  installer.ico: copied from icons/');
