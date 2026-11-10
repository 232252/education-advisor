// Which node_modules trees must be real files in the Windows installer.
//
// NSIS writes every unpacked file one by one; that write is the slow part
// of installing Education Advisor. Electron's main process can read JS from
// app.asar. The stock node.exe that launches dsh cannot, so the dsh/pnpm
// runtime closure has to stay unpacked. Everything else (pdfjs, fonts, the
// spreadsheet/mail stacks, TypeScript declarations) stays inside the single
// asar archive — same modules, far fewer files on disk.
//
// Native addons are always unpacked (`*.node` / `*.dll` / `*.exe`) even when
// the rest of their package stays in the asar. Electron redirects those.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './gate-utils.mjs'

const NATIVE_GLOBS = ['**/*.node', '**/*.dll', '**/*.exe', '**/*.dylib', '**/*.so']

const ROOTS = ['node_modules/@deepseek-ai/dsh', 'node_modules/pnpm']

function loadLock() {
  return JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')).packages
}

function resolveDep(pkgs, fromPath, name) {
  const parts = fromPath.split('/')
  while (true) {
    const base = parts.join('/')
    const candidate = `${base ? `${base}/` : ''}node_modules/${name}`
    if (pkgs[candidate]) return candidate
    if (parts.length === 0) return null
    parts.pop()
    if (parts[parts.length - 1] === 'node_modules') parts.pop()
  }
}

function metaOf(pkgs, pkgPath) {
  const meta = pkgs[pkgPath]
  if (meta?.link && meta.resolved && pkgs[meta.resolved]) return pkgs[meta.resolved]
  return meta
}

/** Top-level package paths the stock node subprocess can require. */
export function dshRuntimeClosure(pkgs = loadLock()) {
  const seen = new Set()
  const stack = [...ROOTS]
  while (stack.length > 0) {
    const pkgPath = stack.pop()
    if (!pkgPath || seen.has(pkgPath) || !pkgs[pkgPath]) continue
    seen.add(pkgPath)
    const meta = metaOf(pkgs, pkgPath)
    const names = new Set([
      ...Object.keys(meta?.dependencies ?? {}),
      ...Object.keys(meta?.optionalDependencies ?? {}),
      ...Object.keys(meta?.peerDependencies ?? {}),
    ])
    for (const name of names) {
      const resolved = resolveDep(pkgs, pkgPath, name)
      if (resolved) stack.push(resolved)
    }
  }
  return seen
}

function isTopLevelPackage(pkgPath) {
  const segs = pkgPath.split('/')
  if (segs[0] !== 'node_modules') return false
  if (segs[1].startsWith('@')) return segs.length === 3
  return segs.length === 2
}

export function asarUnpackPatterns(pkgs = loadLock()) {
  const packages = [...dshRuntimeClosure(pkgs)].filter(isTopLevelPackage).sort()
  return [...NATIVE_GLOBS, ...packages.map((pkgPath) => `${pkgPath}/**`)]
}

export function patternCoversPackage(patterns, name) {
  const file = `node_modules/${name}/package.json`
  return patterns.some((pattern) => matchGlob(pattern, file) || matchGlob(pattern, `node_modules/${name}/index.js`))
}

/** Minimal glob match for the patterns this module emits (`**` and a single `*`). */
function matchGlob(pattern, file) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE::/g, '.*')
  return new RegExp(`^${escaped}$`).test(file)
}

export function assertUnpackContract(patterns = asarUnpackPatterns()) {
  const mustUnpack = [
    '@deepseek-ai/dsh',
    '@deepseek-ai/libreoffice-kit-win32-x64',
    'pnpm',
    'node-pty',
    'koffi',
    'sharp',
    '@earendil-works/pi-ai',
    'openai',
  ]
  const mustStayInAsar = [
    'pdfjs-dist',
    'lxgw-wenkai-webfont',
    '@fontsource/jetbrains-mono',
    'better-sqlite3',
    'xlsx',
    '@larksuiteoapi/node-sdk',
    '@deepseek-ai/dsh-sdk-client',
  ]
  const problems = []
  if (patterns.includes('**/node_modules/**')) {
    problems.push('blanket **/node_modules/** unpack is back')
  }
  for (const glob of NATIVE_GLOBS) {
    if (!patterns.includes(glob)) problems.push(`missing native glob ${glob}`)
  }
  for (const name of mustUnpack) {
    if (!patternCoversPackage(patterns, name)) problems.push(`dsh closure missing ${name}`)
  }
  for (const name of mustStayInAsar) {
    if (patternCoversPackage(patterns, name)) problems.push(`${name} would be unpacked as loose files`)
  }
  return problems
}
