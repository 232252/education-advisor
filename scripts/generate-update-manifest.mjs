#!/usr/bin/env node
// =============================================================
// scripts/generate-update-manifest.mjs
//
// Generates the `latest.yml` / `latest-mac.yml` / `latest-linux.yml`
// files that `electron-updater` expects in the GitHub Release.
// Called from `.github/workflows/release.yml`.
//
// Usage:
//   node scripts/generate-update-manifest.mjs <release-tag> [release-notes-file]
// =============================================================

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

const TAG = process.argv[2] || ''
const NOTES_FILE = process.argv[3] || ''
const RELEASE_DIR = process.env.RELEASE_DIR || 'release'

if (!TAG) {
  console.error('Usage: generate-update-manifest.mjs <release-tag> [release-notes-file]')
  process.exit(1)
}

const VERSION = TAG.replace(/^v/, '')

function sha512OfFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('base64')))
    stream.on('error', reject)
  })
}

function blockMapOfFile(path) {
  // We don't generate block maps in the simple case; electron-updater
  // can fall back to differential = false.
  // For full differential support, use `7z` to create a block map.
  return null
}

async function buildManifest(platform, fileMatcher) {
  const files = readdirSync(RELEASE_DIR).filter(fileMatcher)

  const manifest = {
    version: VERSION,
    releaseDate: new Date().toISOString(),
    githubArtifactName: `AI-Workstation-${VERSION}-${platform}`,
    notes: NOTES_FILE && existsSync(NOTES_FILE)
      ? await readFile(NOTES_FILE, 'utf8')
      : `See https://github.com/232252/education-advisor/releases/tag/${TAG}`,
    path: `AI-Workstation-${VERSION}-${platform}-Setup.${platform === 'mac' ? 'dmg' : 'exe'}`,
    sha512: '',
    files: [],
  }

  for (const file of files) {
    const path = join(RELEASE_DIR, file)
    const sha512 = await sha512OfFile(path)
    const blockMapSize = blockMapOfFile(path)
    manifest.files.push({
      url: file,
      sha512,
      size: require('node:fs').statSync(path).size,
      ...(blockMapSize ? { blockMapSize } : {}),
    })

    // The main file is the .exe / .dmg
    if (/\.(exe|dmg)$/i.test(file)) {
      manifest.path = file
      manifest.sha512 = sha512
    }
  }

  return manifest
}

async function main() {
  // Windows
  const winManifest = await buildManifest('win', (f) => /\.(exe|zip)$/i.test(f))
  writeFileSync('latest.yml', yamlStringify(winManifest))
  console.log('Wrote latest.yml')

  // macOS
  const macManifest = await buildManifest('mac', (f) => /\.(dmg|zip)$/i.test(f))
  writeFileSync('latest-mac.yml', yamlStringify(macManifest))
  console.log('Wrote latest-mac.yml')

  // Linux
  const linuxManifest = await buildManifest('linux', (f) => /\.(AppImage|deb|rpm)$/i.test(f))
  writeFileSync('latest-linux.yml', yamlStringify(linuxManifest))
  console.log('Wrote latest-linux.yml')
}

// Minimal YAML serializer for the manifest format
// electron-updater uses the `js-yaml` format, but our needs are simple.
function yamlStringify(obj, indent = 0) {
  const lines = []
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${' '.repeat(indent)}${key}: []`)
        continue
      }
      lines.push(`${' '.repeat(indent)}${key}:`)
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          // First key on the same line as the dash
          const entries = Object.entries(item)
          if (entries.length > 0) {
            const [firstKey, firstVal] = entries[0]
            lines.push(`${' '.repeat(indent)}- ${firstKey}: ${yamlValue(firstVal)}`)
            for (const [k, v] of entries.slice(1)) {
              lines.push(`${' '.repeat(indent + 4)}${k}: ${yamlValue(v)}`)
            }
          }
        } else {
          lines.push(`${' '.repeat(indent)}- ${yamlValue(item)}`)
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${' '.repeat(indent)}${key}:`)
      lines.push(yamlStringify(value, indent + 2))
    } else {
      lines.push(`${' '.repeat(indent)}${key}: ${yamlValue(value)}`)
    }
  }
  return lines.join('\n')
}

function yamlValue(v) {
  if (typeof v === 'string') {
    // Use block scalar for multi-line strings
    if (v.includes('\n') && v.length > 60) {
      return `|\n${v.split('\n').map((l) => `    ${l}`).join('\n')}`
    }
    return `"${v.replace(/"/g, '\\"')}"`
  }
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return JSON.stringify(v)
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err))
  process.exit(1)
})
