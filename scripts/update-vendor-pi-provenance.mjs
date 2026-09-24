#!/usr/bin/env node
// =============================================================
// scripts/update-vendor-pi-provenance.mjs
//
// 为 vendored 的 pi-ai / pi-agent-core 生成 UPSTREAM.json 溯源清单:
//   repo / package / version / upstreamDir / license / 每文件 sha256
//
// 为什么要它:
//   这两个包是 `file:./vendor/*` 本地依赖,不随 npm 发布,因此没有 lockfile
//   兜底。1,100+ 个文件被直接提交进仓库,升级时无从判断"哪些文件被动过"。
//   UPSTREAM.json 给每个文件记 sha256,让 verify:vendor / 漂移测试能做
//   tamper 检测(与 vendor/submitty 的做法一致)。
//
// 用法:
//   node scripts/update-vendor-pi-provenance.mjs         生成/刷新两个清单
//   node scripts/update-vendor-pi-provenance.mjs --check 只校验,不写盘(CI 用)
// =============================================================

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK_ONLY = process.argv.includes('--check')

/** 上游信息: 与 vendor/<dir>/package.json 的 repository 字段保持一致 */
const TARGETS = [
  {
    dir: 'vendor/pi-ai',
    packageName: '@earendil-works/pi-ai',
    repo: 'https://github.com/earendil-works/pi.git',
    upstreamDir: 'packages/ai',
    note: 'Vendored copy. dist/ + package.json are taken verbatim from the published npm tarball; LICENSE is the upstream repository license (MIT, Copyright (c) 2025 Mario Zechner).',
  },
  {
    dir: 'vendor/pi-agent-core',
    packageName: '@earendil-works/pi-agent-core',
    repo: 'https://github.com/earendil-works/pi.git',
    upstreamDir: 'packages/agent',
    note: 'Vendored copy. dist/ + package.json are taken verbatim from the published npm tarball; LICENSE is the upstream repository license (MIT, Copyright (c) 2025 Mario Zechner).',
  },
]

/** 生成清单时排除的东西: 清单自己、以及任何非发布内容 */
const EXCLUDE = new Set(['UPSTREAM.json', 'node_modules'])

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, out)
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'))
  }
  return out
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function build(target) {
  const abs = join(ROOT, target.dir)
  const pkg = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf-8'))
  const files = walk(abs).sort()
  const entries = files.map((rel) => {
    const full = join(abs, rel)
    return { path: rel, sha256: sha256(full), bytes: statSync(full).size }
  })
  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0)
  // 清单本身不参与自哈希,只对内容做一次整体指纹(便于快速比对)
  const manifestSha256 = createHash('sha256')
    .update(entries.map((e) => `${e.path}:${e.sha256}`).join('\n'))
    .digest('hex')

  return {
    repo: target.repo,
    package: target.packageName,
    version: pkg.version,
    upstreamDir: target.upstreamDir,
    license: pkg.license ?? 'MIT',
    licenseFile: 'LICENSE',
    note: target.note,
    fileCount: entries.length,
    totalBytes,
    manifestSha256,
    files: entries,
  }
}

function stableJson(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`
}

let failed = 0
for (const target of TARGETS) {
  const outPath = join(ROOT, target.dir, 'UPSTREAM.json')
  const next = stableJson(build(target))

  if (CHECK_ONLY) {
    if (!existsSync(outPath)) {
      console.error(`✗ ${target.dir}/UPSTREAM.json 缺失`)
      failed++
      continue
    }
    const current = readFileSync(outPath, 'utf-8')
    if (current !== next) {
      console.error(`✗ ${target.dir}/UPSTREAM.json 与 vendor 内容不一致(有文件被改动或新增)`)
      failed++
    } else {
      console.log(`✓ ${target.dir}/UPSTREAM.json 一致`)
    }
    continue
  }

  writeFileSync(outPath, next)
  const parsed = JSON.parse(next)
  console.log(
    `✓ 写入 ${target.dir}/UPSTREAM.json (${parsed.version}, ${parsed.fileCount} 文件, ` +
      `${(parsed.totalBytes / 1024 / 1024).toFixed(1)} MB)`,
  )
}

if (CHECK_ONLY && failed > 0) {
  console.error(`\n${failed} 个溯源清单需要刷新: node scripts/update-vendor-pi-provenance.mjs`)
  process.exit(1)
}
