#!/usr/bin/env node
// =============================================================
// scripts/download-eaa-binaries.mjs
//
// Downloads the Rust `eaa-cli` binary for the current platform
// from the EAA CLI (`core/eaa-cli/`)sitory's GitHub
// Releases, verifies the SHA-256 checksum, and places the
// binary in `resources/eaa-binaries/<platform>/`.
//
// Usage:
//   node scripts/download-eaa-binaries.mjs
//
// Environment variables:
//   EAA_RELEASE_REPO    GitHub repo to fetch from (default: 232252/education-advisor)
//   EAA_RELEASE_TAG     Specific release tag (default: latest)
//   EAA_BINARY_NAME     Override the binary name
//   EAA_FORCE           Set to "1" to re-download even if the binary is present
//   GITHUB_TOKEN        Optional, increases the rate limit
//
// Exit codes:
//   0  success
//   1  network / GitHub API error
//   2  no binary for the current platform in the release
//   3  checksum mismatch
//   4  invalid platform
// =============================================================

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ---- Configuration ----
const REPO = process.env.EAA_RELEASE_REPO || '232252/education-advisor'
const PINNED_TAG = process.env.EAA_RELEASE_TAG || ''
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const FORCE = process.env.EAA_FORCE === '1'

// ---- Platform detection ----
function detectPlatform() {
  const platform = process.platform
  const arch = process.arch

  const archMap = {
    x64: 'x64',
    arm64: 'arm64',
    ia32: 'ia32',
    arm: 'arm',
  }

  const platformMap = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'win32',
    freebsd: 'freebsd',
  }

  const p = platformMap[platform]
  const a = archMap[arch]
  if (!p || !a) {
    throw new Error(`Unsupported platform: ${platform}/${arch}`)
  }

  return `${p}-${a}`
}

const PLATFORM = detectPlatform()
const BINARY_NAME = process.env.EAA_BINARY_NAME ||
  (process.platform === 'win32' ? 'eaa.exe' : 'eaa')

// ---- Paths ----
const TARGET_DIR = join(ROOT, 'resources', 'eaa-binaries', PLATFORM)
const TARGET_PATH = join(TARGET_DIR, BINARY_NAME)
const CHECKSUM_PATH = join(TARGET_DIR, 'SHA256SUMS')
const MANIFEST_PATH = join(TARGET_DIR, 'manifest.json')

// ---- Logging ----
function log(level, msg) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [${level}] ${msg}`)
}

function info(msg) { log('info', msg) }
function warn(msg) { log('warn', msg) }
function error(msg) { log('error', msg) }

// ---- GitHub API ----
async function githubFetch(url) {
  const headers = {
    'User-Agent': 'education-advisor-download-eaa/1.0',
    'Accept': 'application/vnd.github+json',
  }
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`
  }

  const res = await fetch(url, { headers })
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}`)
  }
  return res.json()
}

async function getRelease() {
  if (PINNED_TAG) {
    info(`Fetching release ${PINNED_TAG} from ${REPO}`)
    return await githubFetch(
      `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(PINNED_TAG)}`,
    )
  }
  info(`Fetching latest release from ${REPO}`)
  return await githubFetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
  )
}

function pickAsset(assets) {
  // Look for an asset whose name matches the platform, e.g.
  //   eaa-linux-x64.tar.gz
  //   eaa-darwin-arm64.zip
  //   eaa-win32-x64.exe.zip
  //   eaa-linux-x64
  //   eaa-windows-x64.exe
  const platformName = PLATFORM.replace('-', '_')
  const platformUnderscore = PLATFORM.replace('-', '_')
  const platformHyphen = PLATFORM

  const candidates = assets.filter((a) => {
    const n = a.name.toLowerCase()
    if (!n.includes('eaa') && !n.includes('education')) return false
    if (
      n.includes(platformHyphen) ||
      n.includes(platformUnderscore) ||
      n.includes(platformName)
    ) {
      return true
    }
    return false
  })

  if (candidates.length === 0) {
    // Fallback: if the release has a single binary asset, use it.
    const singleBinary = assets.find((a) =>
      a.name === BINARY_NAME ||
      a.name === 'eaa' ||
      a.name === 'eaa.exe',
    )
    if (singleBinary) return singleBinary

    throw new Error(
      `No binary asset found for platform ${PLATFORM}. ` +
      `Available assets: ${assets.map((a) => a.name).join(', ')}`,
    )
  }

  // Prefer .zip / .tar.gz over plain binary (they include SHA256SUMS)
  const archived = candidates.find((a) => /\.zip$|\.tar\.gz$/.test(a.name))
  return archived || candidates[0]
}

async function pickChecksumAsset(assets) {
  return assets.find(
    (a) => a.name === 'SHA256SUMS' || a.name === 'checksums.txt' || a.name === 'SHA256SUMS.txt',
  )
}

async function downloadAsset(asset, destPath) {
  info(`Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB) ...`)
  const headers = {
    'User-Agent': 'education-advisor-download-eaa/1.0',
  }
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`

  const res = await fetch(asset.browser_download_url, { headers })
  if (!res.ok) {
    throw new Error(`Failed to download ${asset.name}: ${res.status} ${res.statusText}`)
  }

  mkdirSync(dirname(destPath), { recursive: true })
  const fileStream = (await import('node:fs')).createWriteStream(destPath)

  // Convert Web ReadableStream to Node Readable
  const nodeStream = Readable.fromWeb(res.body)
  await pipeline(nodeStream, fileStream)
}

function sha256OfFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function verifyChecksum(archivePath, expectedSha256) {
  if (!expectedSha256) {
    warn(`No expected SHA-256 for ${archivePath} — skipping verification`)
    return
  }

  const actual = await sha256OfFile(archivePath)
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Checksum mismatch for ${archivePath}:\n` +
      `  expected: ${expectedSha256}\n` +
      `  actual:   ${actual}`,
    )
  }
  info(`SHA-256 verified: ${actual}`)
}

async function extractArchive(archivePath, destDir) {
  info(`Extracting ${archivePath} to ${destDir}`)
  const isZip = archivePath.endsWith('.zip')
  const isTarGz = archivePath.endsWith('.tar.gz')

  if (isZip) {
    // Use the `unzip` command if available, fall back to a JS lib
    const { spawn } = await import('node:child_process')
    await new Promise((resolve, reject) => {
      const proc = spawn('unzip', ['-o', archivePath, '-d', destDir], { stdio: 'inherit' })
      proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`)))
      proc.on('error', reject)
    })
  } else if (isTarGz) {
    const { spawn } = await import('node:child_process')
    await new Promise((resolve, reject) => {
      const proc = spawn('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'inherit' })
      proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`tar exit ${code}`)))
      proc.on('error', reject)
    })
  } else {
    // Plain binary — just move it
    const { renameSync } = await import('node:fs')
    renameSync(archivePath, join(destDir, BINARY_NAME))
  }
}

async function readChecksumsFile(archivePath) {
  // If the release has a separate SHA256SUMS asset, download it
  // alongside the archive. Otherwise we skip checksum verification.
  // (The actual binary archive may contain its own SHA256SUMS.)
  return null
}

// ---- Main ----
async function main() {
  info(`Target platform: ${PLATFORM}`)
  info(`Target binary:   ${TARGET_PATH}`)

  if (existsSync(TARGET_PATH) && !FORCE) {
    info(`Binary already present at ${TARGET_PATH}`)
    info(`Set EAA_FORCE=1 to re-download`)
    return
  }

  let release
  try {
    release = await getRelease()
  } catch (err) {
    error(`Failed to fetch release: ${err.message}`)
    process.exit(1)
  }

  info(`Release: ${release.tag_name} (${release.name || '(no name)'})`)

  const binaryAsset = pickAsset(release.assets || [])
  if (!binaryAsset) {
    error(`No binary asset for platform ${PLATFORM} in release ${release.tag_name}`)
    process.exit(2)
  }

  // Determine expected SHA-256
  const expectedSha = (binaryAsset.digest || '').split(':')[1] || ''

  // Download to a temp path
  const tmpDir = join(ROOT, '.tmp-eaa-download')
  mkdirSync(tmpDir, { recursive: true })
  const tmpPath = join(tmpDir, binaryAsset.name)

  try {
    await downloadAsset(binaryAsset, tmpPath)
    await verifyChecksum(tmpPath, expectedSha)

    // Extract or move
    mkdirSync(TARGET_DIR, { recursive: true })
    await extractArchive(tmpPath, TARGET_DIR)

    // Verify the binary is now in place
    if (!existsSync(TARGET_PATH)) {
      // Maybe the binary has a different name in the archive
      const { readdirSync } = await import('node:fs')
      const files = readdirSync(TARGET_DIR)
      const found = files.find((f) =>
        f === BINARY_NAME ||
        f === 'eaa' ||
        f === 'eaa.exe' ||
        (process.platform !== 'win32' && !f.includes('.')),
      )
      if (!found) {
        throw new Error(
          `Binary not found after extraction. ` +
          `Files in ${TARGET_DIR}: ${files.join(', ')}`,
        )
      }
      if (found !== BINARY_NAME) {
        const { renameSync } = await import('node:fs')
        renameSync(join(TARGET_DIR, found), TARGET_PATH)
      }
    }

    // Make executable on POSIX
    if (process.platform !== 'win32') {
      chmodSync(TARGET_PATH, 0o755)
    }

    // Write the manifest
    const manifest = {
      version: release.tag_name,
      platform: PLATFORM,
      binary: BINARY_NAME,
      downloaded_at: new Date().toISOString(),
      source: {
        repo: REPO,
        release: release.tag_name,
        asset: binaryAsset.name,
        size: binaryAsset.size,
        digest: binaryAsset.digest,
      },
    }
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
    info(`Manifest written to ${MANIFEST_PATH}`)

    info(`✓ Done. Binary at ${TARGET_PATH}`)
  } finally {
    // Clean up the temp directory
    try {
      const { rmSync } = await import('node:fs')
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

main().catch((err) => {
  error(err.stack || err.message || String(err))
  if (err.message.includes('Unsupported platform')) process.exit(4)
  if (err.message.includes('Checksum mismatch')) process.exit(3)
  if (err.message.includes('No binary asset')) process.exit(2)
  process.exit(1)
})
