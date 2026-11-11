// =============================================================
// scripts/bench-install.mjs — 安装耗时基准（本地开发工具）
//
// NSIS 安装的耗时由两段构成：
//   (a) 壳内解出 $PLUGINSDIR/app-64.7z（solid LZMA 顺序解码 → 单大文件写盘）
//   (b) 用 7z 把 app-64.7z 解到 $INSTDIR（约 1.8 万个小文件的写盘风暴 +
//       杀软逐文件扫描 —— 教师机上的绝对大头）
// 本脚本用系统 7z 复刻这两段（不含 NSIS UI/注册表/快捷键等固定开销），
// 输出「耗时 / 文件数 / 字节数」作为安装时间的可复现代理指标。
// 瘦身前后各跑一次即可对比（同机同盘才可比）。
//
// 用法: node scripts/bench-install.mjs [Setup.exe 路径] [--keep]
//   Setup 默认取 release-v11/ 下最新的 Education-Advisor-Setup*.exe
// 依赖: PATH 里有 7z（Git Bash/Windows 常见；没有会明确报错）
// 退出码: 0 成功, 1 失败
// =============================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const setupArg = argv.find((a) => !a.startsWith('--'))

function fail(msg) {
  console.error(`[bench-install] ${msg}`)
  process.exit(1)
}

function pickSetup() {
  if (setupArg) {
    const p = resolve(setupArg)
    if (!existsSync(p)) fail(`找不到安装包：${p}`)
    return p
  }
  const outDir = join(ROOT, 'release-v11')
  if (!existsSync(outDir)) fail(`默认产物目录不存在：${outDir}（先出包或显式传路径）`)
  const cands = readdirSync(outDir)
    .filter((n) => /^Education-Advisor-Setup.*\.exe$/i.test(n))
    .map((n) => join(outDir, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (cands.length === 0) fail(`release-v11/ 下没有 Setup.exe（先出包或显式传路径）`)
  return cands[0]
}

// ---- 7z 探测：PATH 上的 7z；Git Bash 里通常没有，给出明确指引 ----
function probe7z() {
  for (const exe of ['7z', '7z.exe', '7za']) {
    const probe = spawnSync(exe, ['i'], { stdio: 'pipe' })
    if (probe.status === 0) return exe
  }
  fail('PATH 上找不到 7z。请安装 7-Zip 或把 7z.exe 加入 PATH 后重试。')
}
const SEVENZIP = probe7z()

function run7z(args, label) {
  const t0 = performance.now()
  const r = spawnSync(SEVENZIP, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const ms = performance.now() - t0
  if (r.status !== 0) {
    fail(`${label} 失败（exit ${r.status}）：\n${String(r.stderr || r.stdout).slice(-2000)}`)
  }
  return ms
}

function walkStats(dir) {
  let files = 0
  let bytes = 0
  const walk = (d) => {
    let entries
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      const p = join(d, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p)
      else {
        files += 1
        bytes += st.size
      }
    }
  }
  walk(dir)
  return { files, bytes }
}

const fmt = (ms) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)}min` : `${(ms / 1000).toFixed(1)}s`)
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)}MB`

const setup = pickSetup()
console.log(`[bench-install] 目标：${setup}（${mb(statSync(setup).size)}）`)

const outer = mkdtempSync(join(tmpdir(), 'bench-payload-'))
const instdir = mkdtempSync(join(tmpdir(), 'bench-instdir-'))

try {
  // (a) 壳解包：从 Setup 里解出 $PLUGINSDIR/app-64.7z（solid LZMA → 单大文件）。
  //     条目过滤必须用 -i! 开关（NSIS 条目名带 $ 与反斜杠，直写路径参数匹配不上）
  const list = spawnSync(SEVENZIP, ['l', '-slt', setup], { stdio: 'pipe' })
  const listing = String(list.stdout || '')
  const payload = listing.match(/^Path = \$PLUGINSDIR[\\/](app-\d+\.7z)\s*$/m)
  if (!payload) fail(`Setup 里找不到 $PLUGINSDIR/app-*.7z（不是标准 NSIS 产物？）`)
  const payloadName = payload[1]
  const aMs = run7z(
    ['x', '-y', `-o${outer}`, `-i!$PLUGINSDIR\\${payloadName}`, setup],
    '壳解包',
  )
  const payloadPath = join(outer, '$PLUGINSDIR', payloadName)
  if (!existsSync(payloadPath)) fail(`解包后找不到 ${payloadPath}`)
  const payloadBytes = statSync(payloadPath).size

  // (b) 落盘风暴：app-64.7z 解到"安装目录"（小文件写盘 + 杀软扫描大头）
  const bMs = run7z(['x', '-y', `-o${instdir}`, payloadPath], '安装落盘')
  const stats = walkStats(instdir)

  console.log('='.repeat(64))
  console.log(`(a) 壳解出 ${payloadName}：${fmt(aMs)}  （${mb(payloadBytes)} 单文件）`)
  console.log(
    `(b) 安装落盘：${fmt(bMs)}  （${stats.files.toLocaleString()} 文件 / ${mb(stats.bytes)}，${(stats.bytes / 1024 / 1024 / (bMs / 1000)).toFixed(0)}MB/s）`,
  )
  console.log(`合计（安装耗时代理，不含 NSIS 固定开销）：${fmt(aMs + bMs)}`)
  console.log('='.repeat(64))
} finally {
  if (keep) {
    console.log(`[bench-install] --keep：保留 ${outer}\n                 保留 ${instdir}`)
  } else {
    rmSync(outer, { recursive: true, force: true })
    rmSync(instdir, { recursive: true, force: true })
  }
}
