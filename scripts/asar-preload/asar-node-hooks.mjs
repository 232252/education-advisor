// ESM loader for files that live in an asar. CJS require() is handled by the
// vendored asar-node preload; this hook covers `import` from dsh (type:module)
// and from plugins whose dependencies are a single node_modules.asar.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { asarEntry } from './asar-read.mjs'

const CONDITIONS = new Set(['node', 'import', 'default'])

function entryOf(filePath) {
  return asarEntry(filePath)
}

function exists(filePath) {
  const entry = entryOf(filePath)
  if (entry) return true
  try {
    return existsSync(filePath)
  } catch {
    return false
  }
}

function readText(filePath) {
  const entry = entryOf(filePath)
  if (entry?.bytes) return entry.bytes.toString('utf8')
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
}

function unpackedSibling(filePath) {
  const entry = entryOf(filePath)
  if (!entry || entry.directory) return null
  const unpacked = path.join(`${entry.archive}.unpacked`, entry.inner)
  return existsSync(unpacked) ? unpacked : null
}

function alternateNodeModulesAsar(filePath) {
  const normalized = filePath.replaceAll('\\', '/')
  const needle = '/node_modules/'
  const at = normalized.lastIndexOf(needle)
  if (at < 0) return null
  return path.join(filePath.slice(0, at), 'node_modules.asar', filePath.slice(at + needle.length))
}

function packageType(file) {
  let dir = path.dirname(file)
  for (let i = 0; i < 40; i++) {
    const pkgPath = path.join(dir, 'package.json')
    if (exists(pkgPath)) {
      try {
        const json = JSON.parse(readText(pkgPath))
        if (json.type === 'module' || json.type === 'commonjs') return json.type
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return 'commonjs'
}

function finalizeTarget(base, target) {
  if (typeof target !== 'string') return null
  const resolved = path.resolve(base, target)
  if (exists(resolved)) return resolved
  for (const ext of ['.js', '.mjs', '.cjs', '.json', '.node']) {
    if (exists(resolved + ext)) return resolved + ext
  }
  return null
}

function resolveTarget(base, target, subpath) {
  if (target == null) return null
  if (typeof target === 'string') {
    if (subpath !== '.') return null
    return finalizeTarget(base, target)
  }
  if (Array.isArray(target)) {
    for (const item of target) {
      const hit = resolveTarget(base, item, subpath)
      if (hit) return hit
    }
    return null
  }
  if (typeof target !== 'object') return null
  const keys = Object.keys(target)
  const subpathMap = keys.length > 0 && keys.every((key) => key.startsWith('.'))
  if (!subpathMap) {
    for (const key of keys) {
      if (!CONDITIONS.has(key)) continue
      const hit = resolveTarget(base, target[key], '.')
      if (hit) return hit
    }
    return null
  }
  if (target[subpath]) return resolveTarget(base, target[subpath], '.')
  for (const key of keys) {
    if (!key.includes('*')) continue
    const star = key.indexOf('*')
    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue
    const mid = subpath.slice(prefix.length, subpath.length - suffix.length)
    const value = target[key]
    if (typeof value === 'string') return finalizeTarget(base, value.replaceAll('*', mid))
    return resolveTarget(base, value, '.')
  }
  return null
}

function resolvePackageEntry(base, subpath) {
  const pkgPath = path.join(base, 'package.json')
  if (!exists(pkgPath)) {
    if (subpath !== '.') return null
    for (const name of ['index.js', 'index.mjs', 'index.cjs', 'index.json']) {
      const candidate = path.join(base, name)
      if (exists(candidate)) return candidate
    }
    return null
  }
  const json = JSON.parse(readText(pkgPath))
  if (json.exports != null) {
    const fromExports = resolveTarget(base, json.exports, subpath)
    if (fromExports) return fromExports
    if (subpath !== '.') return null
  }
  if (subpath !== '.') {
    const direct = path.resolve(base, subpath)
    if (exists(direct)) return direct
    return null
  }
  if (json.main) {
    const main = finalizeTarget(base, json.main)
    if (main) return main
  }
  for (const name of ['index.js', 'index.mjs', 'index.cjs', 'index.json']) {
    const candidate = path.join(base, name)
    if (exists(candidate)) return candidate
  }
  return null
}

function splitSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    const name = parts.slice(0, 2).join('/')
    const rest = parts.slice(2)
    return { name, sub: rest.length ? `./${rest.join('/')}` : '.' }
  }
  const parts = specifier.split('/')
  return { name: parts[0], sub: parts.length > 1 ? `./${parts.slice(1).join('/')}` : '.' }
}

function resolveBare(specifier, parentFile) {
  const { name, sub } = splitSpecifier(specifier)
  let dir = path.dirname(parentFile)
  for (let i = 0; i < 48; i++) {
    for (const root of [path.join(dir, 'node_modules'), path.join(dir, 'node_modules.asar')]) {
      const hit = resolvePackageEntry(path.join(root, name), sub)
      if (hit) return hit
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function resolveInside(specifier, parentFile) {
  if (specifier.startsWith('file:')) return fileURLToPath(specifier)
  if (path.isAbsolute(specifier)) return specifier
  if (specifier.startsWith('.')) {
    if (!parentFile) return null
    const abs = path.resolve(path.dirname(parentFile), specifier)
    if (exists(abs)) return abs
    return alternateNodeModulesAsar(abs)
  }
  if (!parentFile) return null
  return resolveBare(specifier, parentFile)
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('node:') || specifier.startsWith('data:')) return nextResolve(specifier, context)
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const parentFile = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : ''
    const abs = resolveInside(specifier, parentFile)
    if (!abs) throw err
    const native = unpackedSibling(abs)
    const finalPath = native ?? abs
    if (!exists(finalPath) && !native) throw err
    return { url: pathToFileURL(finalPath).href, shortCircuit: true }
  }
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:')) return nextLoad(url)
  const file = fileURLToPath(url)
  const entry = entryOf(file)
  if (!entry || entry.directory || entry.unpacked || !entry.bytes) return nextLoad(url)
  const ext = path.extname(file)
  let format = 'module'
  if (ext === '.cjs') format = 'commonjs'
  else if (ext === '.json') format = 'json'
  else if (ext === '.mjs') format = 'module'
  else if (ext === '.js') format = packageType(file) === 'commonjs' ? 'commonjs' : 'module'
  return { format, source: entry.bytes, shortCircuit: true }
}
