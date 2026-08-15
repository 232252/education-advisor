// =============================================================
// EAA Bridge — 平台自适应二进制路径解析
// 从 eaa-bridge.ts 拆分(纯重构,逻辑逐字搬移)
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

// 平台 → 二进制目录名映射
const PLATFORM_DIR: Record<string, string> = {
  'win32-x64': 'win32-x64',
  'win32-arm64': 'win32-x64', // ARM 回退到 x64
  'darwin-x64': 'darwin-x64',
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
}

// 平台 → 可执行文件名
const BINARY_NAME: Record<string, string> = {
  win32: 'eaa.exe',
  darwin: 'eaa',
  linux: 'eaa',
}

/**
 * 平台自适应解析二进制路径（找不到时抛错，不回退到 PATH）。
 * @param mainDir 主进程模块目录(eaa-bridge.ts 的 __dirname,用于定位项目根;
 *               在编排层求值后传入,保证与拆分前 __dirname 的语义一致)
 */
export function resolveBinaryPath(mainDir: string): string {
  const platform = process.platform
  const arch = process.arch
  const platformKey = `${platform}-${arch}`
  const dirName = PLATFORM_DIR[platformKey]
  const binName = BINARY_NAME[platform]

  if (!dirName || !binName) {
    throw new Error(
      `EAA binary not available for platform ${platform}-${arch}. ` +
        `Supported: win32-x64, win32-arm64, darwin-x64, darwin-arm64, linux-x64, linux-arm64.`,
    )
  }

  // 优先检查 dev 路径(项目根 resources/eaa-binaries/) — 即使 app.isPackaged 为 true,
  // 用 `electron .` 启动 packaged-asar 之外的项目时,app.isPackaged 不可靠,
  // 此时 process.resourcesPath 指向 electron 自带的 resources 目录,而非项目 resources/。
  const devResourcePath = path.join(
    mainDir,
    '..',
    '..',
    'resources',
    'eaa-binaries',
    dirName,
    binName,
  )
  if (fs.existsSync(devResourcePath)) return devResourcePath

  // Packaged 模式:用 process.resourcesPath/eaa-binaries/
  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, 'eaa-binaries', dirName, binName)
    if (fs.existsSync(packagedPath)) return packagedPath
  }

  // 回退：直接链接 education-advisor 的编译产物
  const fallbackPath = path.join(
    mainDir,
    '..',
    '..',
    '..',
    'education-advisor',
    'core',
    'eaa-cli',
    'target',
    'release',
    binName,
  )
  if (fs.existsSync(fallbackPath)) return fallbackPath

  throw new Error(
    `EAA binary not found for ${platform}-${arch} (expected at ${devResourcePath} or ${fallbackPath}). ` +
      `Please run 'npm run build:eaa' or download the binary from the releases page.`,
  )
}
