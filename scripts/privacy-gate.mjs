#!/usr/bin/env node
// =============================================================
// 隐私门禁 (privacy gate)
// 阻止真实学生/个人隐私信息进入本仓库。发现即退出码 1，拦截提交/推送。
//
// 用法:
//   node scripts/privacy-gate.mjs --staged          # pre-commit: 扫描暂存区
//   node scripts/privacy-gate.mjs --all             # CI: 扫描全部已跟踪文件
//   node scripts/privacy-gate.mjs --files a b c     # 扫描指定文件
//
// 规则:
//   1. 哈希黑名单 (scripts/privacy-denylist.txt): 已知真实姓名/地名的
//      SHA-256,明文不入库;按行内汉字 2-5 字滑动窗口 + 6 位以上数字串哈希比对
//   2. 手机号: 1[3-9]开头的 11 位数字(白名单里的虚构号除外)
//   3. 身份证: 15/18 位(区号 99/00 开头的虚构号除外,见 tests/PRIVACY.md)
//   4. 邮箱: 非占位域名(example.com / noreply.github.com 等除外)
//   5. 数据文件: 禁止提交 .xlsx/.csv/.db/.env/.pem 等真实数据文件
//   6. 本地花名册交叉比对: 若本机存在真实 EAA 数据库(.eaa-data/ 等,已被
//      gitignore),把库里的真实学生姓名逐个拿来比对。这条规则不依赖黑名单,
//      能抓住"从没进过黑名单"的新泄漏 —— 2026-09 的 benchmark/ 泄漏正是
//      因为只有黑名单才漏掉的。库不存在时(CI/全新 clone)自动跳过。
// =============================================================
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(SCRIPT_DIR, '..')

const DENY_HASHES = new Set(readList('privacy-denylist.txt'))
const ALLOW = new Set(readList('privacy-allowlist.txt'))

function readList(name) {
  const p = path.join(SCRIPT_DIR, name)
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

const SKIP_PATH = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)(Cargo\.lock|pnpm-lock\.yaml|yarn\.lock)$/,
  /\.min\.(js|css)$/, // 压缩 vendored 库,数字串均为内部常量
  /^vendor\//, // 第三方上游 vendored 代码
  /^scripts\/privacy-denylist\.txt$/, // 本文件全部为 sha256 十六进制,无明文可泄露
]
const DATAFILE_EXT = /\.(xlsx|xls|csv|tsv|db|sqlite3?|env|pem|key|p12|pfx)$/i

const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g
const ID18_RE = /(?<!\d)\d{17}[\dXx](?!\d)/g
const ID15_RE = /(?<!\d)\d{15}(?!\d)/g
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const EMAIL_OK =
  /@(?:[a-z0-9-]+\.)*(?:example|example\.(?:com|org|net|cn)|localhost|invalid|test\.local|noreply\.github\.com)$/i
// "包名@版本号"(如 electron@43.2.0)不是邮箱:末段以数字开头视为版本
const isVersionSpec = (email) => /\d[\w.-]*$/.test(email.split('.').pop())
const HAN_RUN_RE = /[\u4e00-\u9fff]+/g
const DIGIT_RUN_RE = /\d{6,}/g

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const isSyntheticId = (id) => id.startsWith('99') || id.startsWith('00')

/**
 * 加载本机真实花名册(仅本地存在,不入库)。
 * 返回 2 字以上的真实姓名集合;任何读不到的情况都返回空集(不阻塞 CI)。
 */
function loadLocalRoster() {
  const names = new Set()
  const candidates = [
    '.eaa-data/entities/name_index.json', // EAA 引擎的姓名索引(键即姓名)
    '.app-data/workstation.db', // SQLite 里的学生表(见下,需额外解析)
  ]
  // 1. name_index.json: {"姓名": ...}
  const idxPath = path.join(ROOT, candidates[0])
  if (existsSync(idxPath)) {
    try {
      const idx = JSON.parse(readFileSync(idxPath, 'utf8'))
      for (const name of Object.keys(idx)) {
        if (typeof name === 'string' && name.length >= 2) names.add(name)
      }
    } catch {
      /* 解析失败则忽略这一来源 */
    }
  }
  // 2. entities.json: 姓名可能出现在实体字段里 → 宽松收集看起来像姓名的串
  const entPath = path.join(ROOT, '.eaa-data/entities/entities.json')
  if (existsSync(entPath)) {
    try {
      const raw = readFileSync(entPath, 'utf8')
      for (const m of raw.matchAll(/"(?:name|studentName|student_name)"\s*:\s*"([^"]{2,20})"/g)) {
        const n = m[1].trim()
        if (n && !/[\s{}[\]<>/\\]/.test(n)) names.add(n)
      }
    } catch {
      /* ignore */
    }
  }
  return names
}

const LOCAL_ROSTER = loadLocalRoster()
const ROSTER_MIN = 2

function* lineHits(line) {
  for (const m of line.matchAll(PHONE_RE))
    if (!ALLOW.has(m[0])) yield ['手机号', m[0]]
  for (const m of line.matchAll(ID18_RE))
    if (!isSyntheticId(m[0]) && !ALLOW.has(m[0])) yield ['18位身份证号', m[0]]
  for (const m of line.matchAll(ID15_RE))
    if (!isSyntheticId(m[0]) && !ALLOW.has(m[0])) yield ['15位身份证号', m[0]]
  for (const m of line.matchAll(EMAIL_RE))
    if (!isVersionSpec(m[0]) && !EMAIL_OK.test(m[0]) && !ALLOW.has(m[0])) yield ['邮箱', m[0]]
  if (DENY_HASHES.size > 0) {
    for (const run of line.matchAll(HAN_RUN_RE)) {
      const s = run[0]
      for (let n = 2; n <= 5; n++)
        for (let i = 0; i + n <= s.length; i++) {
          const h = sha256(s.slice(i, i + n))
          if (DENY_HASHES.has(h)) yield ['黑名单(真实姓名/地名)', s.slice(i, i + n)]
        }
    }
    for (const run of line.matchAll(DIGIT_RUN_RE)) {
      if (ALLOW.has(run[0])) continue
      if (DENY_HASHES.has(sha256(run[0]))) yield ['黑名单(真实编号)', run[0]]
    }
  }
  // 本地花名册交叉比对(不依赖黑名单): 直接查这一行里有没有本机真实学生姓名
  if (LOCAL_ROSTER.size > 0) {
    for (const run of line.matchAll(HAN_RUN_RE)) {
      const s = run[0]
      for (const name of LOCAL_ROSTER) {
        if (name.length < ROSTER_MIN) continue
        if (s.includes(name)) yield ['真实学生姓名(本地花名册命中)', name]
      }
    }
  }
}

function scanContent(rel, text, violations) {
  if (DATAFILE_EXT.test(rel) && !ALLOW.has(rel)) {
    violations.push({ rel, ln: 0, rule: '数据文件(禁止入库的扩展名)', hit: rel })
    return
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    for (const [rule, hit] of lineHits(lines[i]))
      violations.push({ rel, ln: i + 1, rule, hit })
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 })
}

function isBinary(buf) {
  return buf.includes(0)
}

function collectTargets(mode, files) {
  if (mode === 'files') return files.map((f) => ({ rel: f, staged: false }))
  const list =
    mode === 'staged'
      ? git(['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'])
      : git(['ls-files', '-z'])
  const rels = list.toString('utf8').split('\0').filter(Boolean)
  return rels.map((rel) => ({ rel, staged: mode === 'staged' }))
}

function run() {
  const args = process.argv.slice(2)
  const mode = args.includes('--staged')
    ? 'staged'
    : args.includes('--files')
      ? 'files'
      : 'all'
  const files = mode === 'files' ? args.filter((a) => !a.startsWith('--')) : []

  const targets = collectTargets(mode, files)
  const violations = []
  let scanned = 0
  for (const { rel, staged } of targets) {
    if (SKIP_PATH.some((re) => re.test(rel))) continue
    let buf
    try {
      buf = staged ? git(['show', `:${rel}`]) : readFileSync(path.join(ROOT, rel))
    } catch {
      continue
    }
    if (isBinary(buf)) continue
    scanned++
    scanContent(rel, buf.toString('utf8'), violations)
  }

  if (violations.length > 0) {
    console.error(`\n🚨 隐私门禁拦截:发现 ${violations.length} 处疑似真实隐私信息,禁止提交。\n`)
    for (const v of violations.slice(0, 50)) {
      const pos = v.ln ? `${v.rel}:${v.ln}` : v.rel
      console.error(`  [${v.rule}] ${pos}  →  ${v.hit}`)
    }
    if (violations.length > 50) console.error(`  ...另有 ${violations.length - 50} 处`)
    console.error('\n处理方式:')
    console.error('  1. 真实数据 → 换成虚构数据(命名用 测试甲/测试乙,身份证用 99 开头虚构区号,见 tests/PRIVACY.md)')
    console.error('  2. 确属虚构常量 → 加入 scripts/privacy-allowlist.txt 并注明理由')
    console.error('  3. 误报 → 在 scripts/privacy-gate.mjs 提 issue 修正规则\n')
    process.exit(1)
  }
  console.log(
    `✅ privacy-gate 通过:已扫描 ${scanned} 个文件,未发现真实隐私信息` +
      (LOCAL_ROSTER.size > 0
        ? `(含本地花名册交叉比对:${LOCAL_ROSTER.size} 个真实姓名)`
        : '(本机无真实花名册,仅用黑名单/格式规则)'),
  )
}

run()
