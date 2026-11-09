// =============================================================
// office-kit-service — 按需补装 libreoffice-kit 的单元测试
//
// 下载→sha256 校验→解压→落位全链路：fetch 打桩返回内存里的 zip（测试自建
// 最小 stored zip，不依赖系统 tar），extract-zip 真解压。
// =============================================================

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configureOfficeKit,
  ensureOfficeKit,
  extraModulesNodePath,
  OFFICE_KIT_PKG,
  officeKitDownloadUrls,
  officeKitStatus,
  resetOfficeKitConfig,
} from '../office-kit-service'

// ---- 最小 zip 构造（stored，不压缩；yauzl/extract-zip 可读） ----

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function buildStoredZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8')
    const data = Buffer.from(content, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x21, 12) // date（合法 DOS 日期，全 0 会被当非法）
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += 30 + nameBuf.length + data.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(centrals.length / 2, 8) // 条目数（central 46B+name 各两块）
  eocd.writeUInt16LE(centrals.length / 2, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, eocd])
}

// ---- 测试环境 ----

const dirs: string[] = []
const realFetch = globalThis.fetch

function makeEnv(opts?: { kitInBundle?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), 'office-kit-'))
  dirs.push(root)
  const extraModulesDir = join(root, 'dsh-extra-modules')
  const bundledPkgDir = join(root, 'bundled', OFFICE_KIT_PKG)
  const manifestDir = join(root, 'config')
  mkdirSync(manifestDir, { recursive: true })
  if (opts?.kitInBundle) {
    mkdirSync(bundledPkgDir, { recursive: true })
    writeFileSync(join(bundledPkgDir, 'libreoffice-kit.exe'), 'bundled-kit')
  }
  return {
    root,
    extraModulesDir,
    bundledPkgDir,
    manifestPath: join(manifestDir, 'office-kit.json'),
  }
}

/** 真 sha256（service 侧用 crypto 校验，清单必须写真摘要）。 */
function shaLike(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}

afterEach(() => {
  resetOfficeKitConfig()
  globalThis.fetch = realFetch
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function kitZip(): Buffer {
  return buildStoredZip({
    'libreoffice-kit-win32-x64/libreoffice-kit.exe': 'fake-kit-binary',
    'libreoffice-kit-win32-x64/package.json':
      '{"name":"@deepseek-ai/libreoffice-kit-win32-x64","version":"0.1.5"}',
  })
}

describe('officeKitStatus', () => {
  it('bundled 平台包在（开发态）→ ready/bundled，ensure 直接 ok', async () => {
    const env = makeEnv({ kitInBundle: true })
    configureOfficeKit({
      extraModulesDir: env.extraModulesDir,
      manifestPath: env.manifestPath,
      appVersion: '3.3.5',
      bundledPkgDir: env.bundledPkgDir,
    })
    expect(officeKitStatus()).toEqual({ state: 'ready', source: 'bundled' })
    await expect(ensureOfficeKit()).resolves.toEqual({ ok: true })
  })

  it('未配置 / 无清单 → unknown；有清单无组件 → missing', () => {
    expect(officeKitStatus().state).toBe('unknown')
    const env = makeEnv()
    configureOfficeKit({
      extraModulesDir: env.extraModulesDir,
      manifestPath: env.manifestPath,
      appVersion: '3.3.5',
      bundledPkgDir: env.bundledPkgDir,
    })
    // 清单还没写 → unknown
    expect(officeKitStatus().state).toBe('unknown')
    writeFileSync(
      env.manifestPath,
      JSON.stringify({ asset: 'a.zip', sha256: 'a'.repeat(64), bytes: 10, kitVersion: '0.1.5' }),
      'utf8',
    )
    expect(officeKitStatus().state).toBe('missing')
  })
})

describe('officeKitDownloadUrls', () => {
  it('GitHub 直连 + ghfast 加速，挂在本版 release 上', () => {
    const urls = officeKitDownloadUrls(
      {
        asset: 'office-kit-win32-x64-0.1.5.zip',
        sha256: 'a'.repeat(64),
        bytes: 1,
        kitVersion: '0.1.5',
      },
      '3.3.5',
    )
    expect(urls).toEqual([
      'https://github.com/232252/education-advisor/releases/download/v3.3.5/office-kit-win32-x64-0.1.5.zip',
      'https://ghfast.top/https://github.com/232252/education-advisor/releases/download/v3.3.5/office-kit-win32-x64-0.1.5.zip',
    ])
  })
})

describe('ensureOfficeKit 下载→校验→解压', () => {
  it('全链路：下载、解压落位、写戳；二次调用直接 ok', async () => {
    const env = makeEnv()
    const zip = kitZip()
    writeFileSync(
      env.manifestPath,
      JSON.stringify({
        asset: 'office-kit-win32-x64-0.1.5.zip',
        sha256: shaLike(zip),
        bytes: zip.length,
        kitVersion: '0.1.5',
      }),
      'utf8',
    )
    configureOfficeKit({
      extraModulesDir: env.extraModulesDir,
      manifestPath: env.manifestPath,
      appVersion: '3.3.5',
      bundledPkgDir: env.bundledPkgDir,
    })

    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      return new Response(new Uint8Array(zip), {
        status: 200,
        headers: { 'content-length': String(zip.length) },
      })
    }) as typeof fetch

    const progress: string[] = []
    const result = await ensureOfficeKit((m) => progress.push(m))
    expect(result.ok).toBe(true)
    const exe = join(env.extraModulesDir, OFFICE_KIT_PKG, 'libreoffice-kit.exe')
    expect(existsSync(exe)).toBe(true)
    expect(readFileSync(exe, 'utf8')).toBe('fake-kit-binary')
    expect(existsSync(join(env.extraModulesDir, 'office-kit.stamp'))).toBe(true)
    expect(officeKitStatus()).toMatchObject({ state: 'ready', source: 'downloaded' })
    expect(progress.some((m) => m.includes('office 组件就绪'))).toBe(true)

    // 已就绪：再 ensure 不再发请求
    await ensureOfficeKit()
    expect(fetches).toBe(1)
    expect(extraModulesNodePath()).toBe(env.extraModulesDir)
  }, 30_000)

  it('首源 404 → ghfast 镜像兜底成功', async () => {
    const env = makeEnv()
    const zip = kitZip()
    writeFileSync(
      env.manifestPath,
      JSON.stringify({
        asset: 'office-kit-win32-x64-0.1.5.zip',
        sha256: shaLike(zip),
        bytes: zip.length,
        kitVersion: '0.1.5',
      }),
      'utf8',
    )
    configureOfficeKit({
      extraModulesDir: env.extraModulesDir,
      manifestPath: env.manifestPath,
      appVersion: '3.3.5',
      bundledPkgDir: env.bundledPkgDir,
    })
    const seen: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.startsWith('https://github.com/')) {
        return new Response('not found', { status: 404 })
      }
      return new Response(new Uint8Array(zip), { status: 200 })
    }) as typeof fetch

    const result = await ensureOfficeKit()
    expect(result.ok).toBe(true)
    expect(seen).toHaveLength(2)
    expect(seen[1]).toContain('ghfast.top')
  }, 30_000)

  it('sha256 不匹配 → 报错并删除损坏 zip', async () => {
    const env = makeEnv()
    const zip = kitZip()
    writeFileSync(
      env.manifestPath,
      JSON.stringify({
        asset: 'office-kit-win32-x64-0.1.5.zip',
        sha256: 'f'.repeat(64),
        bytes: zip.length,
        kitVersion: '0.1.5',
      }),
      'utf8',
    )
    configureOfficeKit({
      extraModulesDir: env.extraModulesDir,
      manifestPath: env.manifestPath,
      appVersion: '3.3.5',
      bundledPkgDir: env.bundledPkgDir,
    })
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(zip), { status: 200 })) as typeof fetch

    const result = await ensureOfficeKit()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('校验失败')
    expect(existsSync(join(env.extraModulesDir, 'office-kit-win32-x64-0.1.5.zip'))).toBe(false)
  }, 30_000)
})
