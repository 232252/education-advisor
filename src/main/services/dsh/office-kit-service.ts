// =============================================================
// office-kit-service — libreoffice-kit 平台二进制的按需补装
//
// @deepseek-ai/libreoffice-kit-win32-x64（内含 178MB 的 libreoffice-kit.exe，
// 压缩后是安装包最大单项）不随安装包分发：它是 dsh-office-to-pdf /
// dsh-skill-office 的 optionalDependency，只有真的做 office→PDF 转换时才
// 需要。装机后由本服务从 GitHub Release 资产下载补齐（构建期
// scripts/build-office-kit-asset.mjs 打 zip + sha256 清单 config/
// office-kit.json，随 app 分发）。
//
// 落位：userData/dsh-extra-modules/@deepseek-ai/libreoffice-kit-win32-x64/，
// dsh 子进程（教师对话 sdk 与连接中心 web）经 NODE_PATH 解析到它 —— 不写
// 安装目录，应用升级不丢。
//
// 本模块不 import electron（单测跑在纯 node 里），路径由 bootstrap 注入。
// =============================================================

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'

export const OFFICE_KIT_PKG = '@deepseek-ai/libreoffice-kit-win32-x64'
/** Windows 平台包里的主二进制（存在即视为就绪）。 */
const KIT_BINARY = 'libreoffice-kit.exe'
/** zip 内的顶层目录名（build-office-kit-asset.mjs 固定按此打包）。 */
const ZIP_ROOT_DIR = 'libreoffice-kit-win32-x64'
/** 下载校验通过的戳，内容 = 清单 sha256。升级换清单后自动重下。 */
const KIT_STAMP = 'office-kit.stamp'

export interface OfficeKitManifest {
  /** zip 资产文件名（office-kit-win32-x64-<kitVersion>.zip） */
  asset: string
  sha256: string
  bytes: number
  kitVersion: string
}

export interface OfficeKitConfig {
  /** 组件解压根：userData/dsh-extra-modules */
  extraModulesDir: string
  /** config/office-kit.json（extraResources，构建期生成） */
  manifestPath: string
  /** app 版本（不带 v 前缀）—— 资产挂在发布本版的 release 上 */
  appVersion: string
  /** 打包/开发态 bundled 平台包目录（存在则无需下载；开发态就在 node_modules） */
  bundledPkgDir: string
  /** 安装包内的 zip 目录（resources/office-kit）。有则本机解压，不联网。 */
  bundledZipDir?: string
}

export type OfficeKitState =
  | { state: 'ready'; source: 'bundled' | 'downloaded'; kitVersion?: string }
  | { state: 'installing'; message?: string }
  | { state: 'missing' }
  | { state: 'unknown'; message: string }

export interface OfficeKitEnsureResult {
  ok: boolean
  error?: string
}

let configured: OfficeKitConfig | null = null
let inflight: { progress: string; promise: Promise<OfficeKitEnsureResult> } | null = null

export function configureOfficeKit(config: OfficeKitConfig): void {
  configured = config
}

/** 测试用：清掉注入的配置与在途任务。 */
export function resetOfficeKitConfig(): void {
  configured = null
  inflight = null
}

/** dsh 子进程环境的 NODE_PATH 值；目录不存在返回 null（不注入）。 */
export function extraModulesNodePath(): string | null {
  const dir = configured?.extraModulesDir
  return dir && existsSync(dir) ? dir : null
}

function bundledKitBinary(): string | null {
  const dir = configured?.bundledPkgDir
  if (!dir) return null
  const exe = join(dir, KIT_BINARY)
  return existsSync(exe) ? exe : null
}

function bundledZipFile(manifest: OfficeKitManifest): string | null {
  const dir = configured?.bundledZipDir
  if (!dir) return null
  const zip = join(dir, manifest.asset)
  return existsSync(zip) ? zip : null
}

function downloadedKitBinary(): string | null {
  const dir = configured?.extraModulesDir
  if (!dir) return null
  const exe = join(dir, OFFICE_KIT_PKG, KIT_BINARY)
  return existsSync(exe) ? exe : null
}

function readManifest(): OfficeKitManifest | null {
  if (!configured) return null
  try {
    const raw = JSON.parse(readFileSync(configured.manifestPath, 'utf8')) as OfficeKitManifest
    if (raw?.asset && raw?.sha256 && raw.bytes > 0) return raw
    return null
  } catch {
    return null
  }
}

export function officeKitStatus(): OfficeKitState {
  if (inflight) return { state: 'installing', message: inflight.progress }
  if (bundledKitBinary()) return { state: 'ready', source: 'bundled' }
  if (downloadedKitBinary()) {
    const manifest = readManifest()
    return { state: 'ready', source: 'downloaded', kitVersion: manifest?.kitVersion }
  }
  if (!configured) return { state: 'unknown', message: '组件服务未配置' }
  if (!readManifest()) return { state: 'unknown', message: '找不到组件清单 config/office-kit.json' }
  return { state: 'missing' }
}

/** 依次尝试的下载源：GitHub 直连 → ghfast 国内加速（同官网下载页口径）。 */
export function officeKitDownloadUrls(manifest: OfficeKitManifest, appVersion: string): string[] {
  const base = `https://github.com/232252/education-advisor/releases/download/v${appVersion}/${manifest.asset}`
  return [base, `https://ghfast.top/${base}`]
}

export function ensureOfficeKit(
  onProgress?: (message: string) => void,
): Promise<OfficeKitEnsureResult> {
  if (bundledKitBinary() || downloadedKitBinary()) return Promise.resolve({ ok: true })
  const manifest = readManifest()
  if (!configured || !manifest) {
    return Promise.resolve({ ok: false, error: '缺少组件清单，无法下载 office 转换组件' })
  }
  if (inflight) return inflight.promise

  const cfg = configured
  const report = (message: string) => {
    if (inflight) inflight.progress = message
    onProgress?.(message)
  }
  const promise = downloadAndExtract(cfg, manifest, report).finally(() => {
    inflight = null
  })
  inflight = { progress: '准备下载…', promise }
  return promise
}

async function downloadAndExtract(
  cfg: OfficeKitConfig,
  manifest: OfficeKitManifest,
  report: (message: string) => void,
): Promise<OfficeKitEnsureResult> {
  mkdirSync(cfg.extraModulesDir, { recursive: true })
  const stampPath = join(cfg.extraModulesDir, KIT_STAMP)
  const stampWanted = `${manifest.sha256}\n`
  const stampMatches = () => {
    try {
      return readFileSync(stampPath, 'utf8') === stampWanted
    } catch {
      return false
    }
  }

  const zipPath = join(cfg.extraModulesDir, manifest.asset)
  const localZip = bundledZipFile(manifest)
  if (!existsSync(zipPath) || !stampMatches()) {
    if (localZip) {
      report('正在从安装包读取 office 组件…')
      copyFileSync(localZip, zipPath)
    } else {
    const urls = officeKitDownloadUrls(manifest, cfg.appVersion)
    let lastError = ''
    let downloaded = false
    for (let i = 0; i < urls.length && !downloaded; i++) {
      try {
        report(`正在下载 office 组件（源 ${i + 1}/${urls.length}）…`)
        await downloadTo(urls[i], zipPath, manifest.bytes, report)
        downloaded = true
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
    if (!downloaded) return { ok: false, error: `office 组件下载失败：${lastError}` }
    }
  }

  report('正在校验组件…')
  const sha = await sha256Of(zipPath)
  if (sha !== manifest.sha256) {
    rmSync(zipPath, { force: true })
    return { ok: false, error: 'office 组件校验失败（sha256 不匹配），已删除损坏文件' }
  }

  report('正在解压组件…')
  const staging = mkdtempSync(join(tmpdir(), 'office-kit-'))
  try {
    const { default: extractZip } = await import('extract-zip')
    await extractZip(zipPath, { dir: staging })
    const extracted = join(staging, ZIP_ROOT_DIR)
    const target = join(cfg.extraModulesDir, OFFICE_KIT_PKG)
    if (!existsSync(extracted)) {
      return { ok: false, error: `office 组件包结构异常（缺 ${ZIP_ROOT_DIR}/）` }
    }
    mkdirSync(dirname(target), { recursive: true })
    rmSync(target, { recursive: true, force: true })
    renameSync(extracted, target)
    if (!existsSync(join(target, KIT_BINARY))) {
      return { ok: false, error: 'office 组件解压后缺少主程序' }
    }
    writeFileSync(stampPath, stampWanted, 'utf8')
    report('office 组件就绪')
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: `office 组件解压失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

async function downloadTo(
  url: string,
  target: string,
  expectedBytes: number,
  report: (message: string) => void,
): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length')) || expectedBytes
  let received = 0
  let lastReport = 0
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length
      // 每 8MB 汇报一次，别把事件流刷爆
      if (received - lastReport > 8 * 1024 * 1024) {
        lastReport = received
        const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
        report(`office 组件下载中 ${percent}%（${(received / 1024 / 1024).toFixed(0)}MB）`)
      }
      cb(null, chunk)
    },
  })
  const tmp = `${target}.download`
  const { Readable } = await import('node:stream')
  await pipeline(
    Readable.fromWeb(response.body as unknown as NodeWebReadableStream),
    counter,
    createWriteStream(tmp),
  )
  renameSync(tmp, target)
  if (expectedBytes > 0 && received !== expectedBytes) {
    throw new Error(`字节数不符（${received} ≠ ${expectedBytes}）`)
  }
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** 闲时预热：失败静默（插件中心卡片与真实使用路径会带进度重试）。 */
export function prewarmOfficeKit(): void {
  void ensureOfficeKit().catch((err: unknown) => {
    console.warn('[office-kit] 预热失败（使用时会重试）:', err)
  })
}
