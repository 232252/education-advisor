#!/usr/bin/env node
// =============================================================
// scripts/update-vendor-submitty.mjs
//
// 更新 vendor/submitty（Submitty PostgreSQL schema 参照面）。
// 只拷贝上游的建表 dump 与许可证，不 vendor 上游本体（~100MB PHP）。
//
// 用法:
//   npm run update:vendor:submitty                    # 跟最新 release tag
//   npm run update:vendor:submitty -- --tag v26.08.01 # 指定 tag
//   npm run update:vendor:submitty -- --from /path/to/local/clone [--tag v26.08.01]
//                                                     # 复用已有本地克隆(慢网络/离线场景,
//                                                       需为同一仓库的对应 tag checkout)
//
// 步骤:
//   1. 解析目标 tag（默认 git ls-remote 取最新 v* tag）
//   2. 浅克隆该 tag 到系统临时目录
//   3. 校验并拷贝 migration/migrator/data/{course_tables,submitty_db}.sql + LICENSE.md
//   4. 生成 vendor/submitty/UPSTREAM.json（repo/tag/commit/fetchedAt/每文件 sha256）
//   5. 提示跑漂移测试（tests/main/submitty-vendor-drift.test.ts）与 verify:vendor
//
// 退出码: 0 成功 / 1 失败
// =============================================================

import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const REPO_URL = 'https://github.com/Submitty/Submitty.git'
const VENDOR_DIR = join(ROOT, 'vendor', 'submitty')
const SQL_DIR = join(VENDOR_DIR, 'sql')

// 从上游拷贝的固定子集（数据源插件的同步 SQL 依赖这些 dump 里的表/列）
const UPSTREAM_FILES = [
  {
    src: 'migration/migrator/data/course_tables.sql',
    dest: 'sql/course_tables.sql',
    why: '每学期每课程库的建表 dump（gradeable/submission/批改/成绩链路）',
  },
  {
    src: 'migration/migrator/data/submitty_db.sql',
    dest: 'sql/submitty_db.sql',
    why: '主库建表 dump（terms/courses/courses_users/users）',
  },
  {
    src: 'LICENSE.md',
    dest: 'LICENSE.md',
    why: 'BSD-3-Clause 许可证（随 vendor 分发必须保留）',
  },
]

function log(level, msg) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] [submitty-vendor:${level}] ${msg}`)
}
const info = (m) => log('info', m)
const error = (m) => log('error', m)

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    ...opts,
  })
  if (result.status !== 0) {
    error(`命令失败: ${cmd} ${args.join(' ')}\n${result.stderr || result.stdout || ''}`)
    process.exit(1)
  }
  return result.stdout
}

function parseArgs(argv) {
  const tagIdx = argv.indexOf('--tag')
  const fromIdx = argv.indexOf('--from')
  return {
    tag: tagIdx !== -1 && argv[tagIdx + 1] ? argv[tagIdx + 1] : null,
    from: fromIdx !== -1 && argv[fromIdx + 1] ? argv[fromIdx + 1] : null,
  }
}

/** 取上游最新 v* release tag（Submitty 按月发版 vX.YY.NN） */
function latestTag() {
  const out = run('git', ['ls-remote', '--tags', '--sort=-v:refname', REPO_URL])
  for (const line of out.split('\n')) {
    const m = line.match(/refs\/tags\/(v\d+\.\d+\.\d+)$/)
    if (m) return m[1]
  }
  error('未能从 ls-remote 解析出任何 v* tag')
  process.exit(1)
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// ---- 主流程 ----
const args = parseArgs(process.argv.slice(2))
let tag = args.tag
let tmpClone = null
let clonedByUs = false

if (args.from) {
  // 复用已有本地克隆：校验是其 tag checkout，避免拷错源
  const described = run('git', ['-C', args.from, 'describe', '--tags', '--exact-match', 'HEAD']).trim()
  if (!described) {
    error(`--from ${args.from} 不是干净的 tag checkout`)
    process.exit(1)
  }
  if (tag && tag !== described) {
    error(`--from 克隆的 tag 是 ${described}，与请求的 --tag ${tag} 不一致`)
    process.exit(1)
  }
  tag = described
  tmpClone = args.from
  info(`复用本地克隆: ${tmpClone} (${tag})`)
} else {
  tag = tag ?? latestTag()
  tmpClone = join(tmpdir(), 'submitty-vendor-tmp')
  clonedByUs = true
  rmSync(tmpClone, { recursive: true, force: true })
  info(`目标 tag: ${tag}`)
  info(`浅克隆到临时目录: ${tmpClone}`)
  run('git', ['clone', '--depth', '1', '--branch', tag, REPO_URL, tmpClone])
}

const commit = run('git', ['-C', tmpClone, 'rev-parse', 'HEAD']).trim()
info(`commit: ${commit}`)

// 拷贝子集
mkdirSync(SQL_DIR, { recursive: true })
const files = []
for (const f of UPSTREAM_FILES) {
  const src = join(tmpClone, f.src)
  if (!existsSync(src)) {
    error(`上游 ${tag} 中缺少 ${f.src}（${f.why}）— 子集清单需要同步上游结构调整`)
    process.exit(1)
  }
  const dest = join(VENDOR_DIR, f.dest)
  cpSync(src, dest)
  const bytes = statSync(dest).size
  files.push({ path: f.dest, sha256: sha256(dest), bytes })
  info(`已拷贝 ${f.src} → ${f.dest} (${bytes} bytes)`)
}

// 生成 UPSTREAM.json（漂移测试与 verify:vendor 以它为准做 tamper 检测）
const upstream = {
  repo: REPO_URL,
  tag,
  commit,
  fetchedAt: new Date().toISOString(),
  files,
}
// JSON.stringify 保持人类可读的 2 空格缩进，与仓库其它 JSON 一致
const upstreamPath = join(VENDOR_DIR, 'UPSTREAM.json')
// atomic-write 模式：先写临时文件再 rename，避免中断留下半截 JSON
const tmpJson = `${upstreamPath}.tmp`
writeFileSync(tmpJson, `${JSON.stringify(upstream, null, 2)}\n`)
renameSync(tmpJson, upstreamPath)
info(`已生成 ${upstreamPath}`)

if (clonedByUs) {
  rmSync(tmpClone, { recursive: true, force: true })
}

info('──────── 完成 ────────')
console.log(`  vendor/submitty 已更新到 ${tag} (${commit.slice(0, 8)})`)
console.log('')
console.log('  下一步:')
console.log('    1. npx vitest run tests/main/submitty-vendor-drift.test.ts   # schema 漂移测试')
console.log('       — 若红了：按 diff 更新同步 SQL / 解析器后再提交')
console.log('    2. npm run verify:vendor                                     # 完整 vendor 校验')
console.log('    3. git add vendor/submitty && git commit')
