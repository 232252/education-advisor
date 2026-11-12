// Scan a packed app.asar for require() calls in dist/main and check those
// packages exist in the asar or in app.asar.unpacked. Used by afterPack so a
// missing module like cross-spawn fails the build instead of the teacher's PC.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const builtin = new Set([
  ...createRequire(import.meta.url)('module').builtinModules,
  ...createRequire(import.meta.url)('module').builtinModules.map((b) => `node:${b}`),
  'electron',
])

function packageName(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/')
  return spec.split('/')[0]
}

function walkHeader(node, prefix, files, pkgs) {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) {
      walkHeader(child, prefix ? `${prefix}/${name}` : name, files, pkgs)
    }
    return
  }
  if (node.size != null && node.offset != null && !node.unpacked) {
    files.push({ path: prefix, offset: Number(node.offset), size: Number(node.size) })
  }
  const m = prefix && prefix.match(/^node_modules\/(@[^/]+\/[^/]+|[^/]+)/)
  if (m) pkgs.add(m[1])
}

function unpackedPackages(unpackedNm) {
  const pkgs = new Set()
  if (!existsSync(unpackedNm)) return pkgs
  for (const name of readdirSync(unpackedNm)) {
    const p = join(unpackedNm, name)
    try {
      if (!statSync(p).isDirectory()) continue
    } catch {
      continue
    }
    if (name.startsWith('@')) {
      for (const child of readdirSync(p)) {
        if (existsSync(join(p, child, 'package.json'))) pkgs.add(`${name}/${child}`)
      }
    } else if (existsSync(join(p, 'package.json'))) {
      pkgs.add(name)
    }
  }
  return pkgs
}

function readAsarHeader(fd) {
  const preamble = Buffer.alloc(8)
  readSync(fd, preamble, 0, 8, 0)
  const headerBufLength = preamble.readUInt32LE(4)
  if (headerBufLength <= 0 || headerBufLength > 50 * 1024 * 1024) {
    throw new Error(`bad asar headerBufLength=${headerBufLength}`)
  }
  const dataOffset = 8 + headerBufLength
  const headerBuf = Buffer.alloc(headerBufLength)
  readSync(fd, headerBuf, 0, headerBufLength, 8)
  const jsonSize = headerBuf.readUInt32LE(4)
  if (jsonSize <= 0 || jsonSize > headerBufLength) {
    throw new Error(`bad asar jsonSize=${jsonSize}`)
  }
  let text = headerBuf.subarray(8, 8 + jsonSize).toString('utf8')
  const end = text.lastIndexOf('}')
  if (end >= 0) text = text.slice(0, end + 1)
  return { header: JSON.parse(text), dataOffset }
}

export function missingMainProcessModules(asarPath, unpackedNm) {
  const fd = openSync(asarPath, 'r')
  try {
    const { header, dataOffset } = readAsarHeader(fd)
    const files = []
    const pkgs = unpackedPackages(unpackedNm)
    walkHeader(header, '', files, pkgs)
    const reqs = new Set()
    for (const f of files.filter((x) => /^dist\/main\/.*\.(c?js|mjs)$/.test(x.path))) {
      const b = Buffer.alloc(f.size)
      const n = readSync(fd, b, 0, f.size, dataOffset + f.offset)
      const src = b.slice(0, n).toString('utf8')
      const re = /require\((['"])([^'"]+)\1\)/g
      let m
      while ((m = re.exec(src))) {
        const spec = m[2]
        if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || builtin.has(spec)) continue
        reqs.add(packageName(spec))
      }
    }
    // Also keep production deps of packages that actually shipped in the asar.
    // electron-updater stayed in the asar but js-yaml/semver were excluded.
    const pkgJsonRe = /^node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/
    for (const f of files.filter((x) => pkgJsonRe.test(x.path) && x.size < 1024 * 1024)) {
      const b = Buffer.alloc(f.size)
      const n = readSync(fd, b, 0, f.size, dataOffset + f.offset)
      let meta
      try {
        meta = JSON.parse(b.slice(0, n).toString('utf8'))
      } catch {
        continue
      }
      for (const dep of Object.keys(meta.dependencies ?? {})) {
        if (!builtin.has(dep)) reqs.add(dep)
      }
    }
    return [...reqs].filter((name) => !pkgs.has(name)).sort()
  } finally {
    closeSync(fd)
  }
}

export function assertMainProcessModulesPresent(resourcesDir) {
  const asarPath = join(resourcesDir, 'app.asar')
  if (!existsSync(asarPath)) {
    console.error(`[after-pack-trim] 找不到 ${asarPath}，无法检查主进程依赖`)
    process.exit(1)
  }
  const missing = missingMainProcessModules(asarPath, join(resourcesDir, 'app.asar.unpacked', 'node_modules'))
  if (missing.length > 0) {
    console.error(`[after-pack-trim] 主进程还在 require 这些包，但 app.asar 里没有：${missing.join(', ')}`)
    process.exit(1)
  }
}