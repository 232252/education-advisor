// =============================================================
// verify:eaa —— Rust 数据引擎 + 隐私脱敏引擎的功能门禁
//
// 为什么要有它：这两个引擎是招牌能力，但走的是**独立子进程链路**
// （resources/eaa-binaries/<plat>/eaa + EAA_DATA_DIR），TS 侧单测一行都盖不到：
// 二进制改名、schema 布局漂移、事件溯源写协议变化，全都只能在真跑一次时暴露。
// dsh 那条链路的教训就是「裸 node 跑通 ≠ 打包态跑通」，所以这里也用真二进制。
//
// 数据目录布局按 app 自己的 ensureDataDirStructure 复刻：
//   <root>/eaa-data/{entities,events,logs} + <root>/schema/reason_codes.json
// （Rust 侧 get_schema_dir() 在 dataDir 的**父目录**找 schema/，
//   见 src/main/services/eaa/legacy-migration.ts:136 —— 放错位置就是 os error 3）
//
// 只写系统临时目录，不碰任何真实数据；EAA_PACKED=<win-unpacked/resources> 可
// 改验打包产物里的同一套二进制。
// =============================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = process.cwd()
// 默认验仓库内的随包二进制；--packed <dir> 指到 win-unpacked/resources 验安装态。
// 必须转成绝对路径：spawn 的 cwd 是临时数据目录，相对 BIN 会整个跑飞。
const packedFlag = process.argv.indexOf('--packed')
const PACKED =
  packedFlag >= 0 && process.argv[packedFlag + 1]
    ? resolve(REPO, process.argv[packedFlag + 1])
    : join(REPO, 'resources')
const PLAT = process.platform === 'win32' ? 'win32-x64' : process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64'
const BIN = join(PACKED, 'eaa-binaries', PLAT, process.platform === 'win32' ? 'eaa.exe' : 'eaa')
// 仓库态 config 在 <repo>/config，安装态在 <resources>/config（electron-builder 的
// extraResources 就是把它拷进 resources 的）
const CONFIG_DIR = packedFlag >= 0 ? join(PACKED, 'config') : join(REPO, 'config')
const SCHEMA_SOURCE = join(CONFIG_DIR, 'reason-codes.json')

if (!existsSync(BIN)) {
  // 随包引擎只有 win32-x64 / linux-x64 两份（macOS 用户跑的是自建数据目录）：
  // 缺二进制在这两个平台上是硬故障，在 darwin 上是「本就没有」—— 显式说明，不静默绿。
  if (process.platform === 'darwin') {
    console.log(`[eaa-gate] SKIP：随包引擎没有 darwin 构建（app 也不带），本平台不验。${BIN}`)
    process.exit(0)
  }
  console.error(`[eaa-gate] 找不到引擎二进制: ${BIN}`)
  process.exit(1)
}
if (!existsSync(SCHEMA_SOURCE)) {
  console.error(`[eaa-gate] 找不到随包原因码: ${SCHEMA_SOURCE}`)
  process.exit(1)
}

const ROOT = mkdtempSync(join(tmpdir(), 'eaa-gate-'))
const DATA = join(ROOT, 'eaa-data')
const PW = 'eaa-gate-not-a-real-password'
const env = { ...process.env, EAA_DATA_DIR: DATA, EAA_PRIVACY_PASSWORD: PW }
const results = []

/** 按 app 的初始化逻辑铺出 Rust 侧要求的目录与空结构 */
function provision() {
  for (const sub of ['entities', 'events', 'logs']) mkdirSync(join(DATA, sub), { recursive: true })
  mkdirSync(join(ROOT, 'schema'), { recursive: true })
  writeFileSync(join(DATA, 'entities/entities.json'), JSON.stringify({ version: '1.0', base_score: 100.0, entities: {} }, null, 2), 'utf8')
  writeFileSync(join(DATA, 'entities/name_index.json'), '{}', 'utf8')
  writeFileSync(join(DATA, 'events/events.json'), '[]', 'utf8')
  const flat = JSON.parse(readFileSync(SCHEMA_SOURCE, 'utf8'))
  const nested = flat?.codes && typeof flat.codes === 'object' ? flat : { version: '1.0', codes: flat }
  writeFileSync(join(ROOT, 'schema/reason_codes.json'), JSON.stringify(nested, null, 2), 'utf8')
  return Object.keys(nested.codes ?? {}).length
}

function run(args, label) {
  const r = spawnSync(BIN, args, { encoding: 'utf8', env, cwd: DATA, timeout: 30000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
  if (r.status !== 0) results.push({ ok: false, name: `退出码 ${label}`, detail: out.replace(/\s+/g, ' ').slice(0, 140) })
  return out
}

function jsonOf(args, label) {
  const out = run(args, label)
  const i = out.search(/[[{]/)
  if (i < 0) return { raw: out }
  try {
    return { data: JSON.parse(out.slice(i)) }
  } catch {
    return { raw: out }
  }
}

function expect(name, ok, detail = '') {
  results.push({ ok: !!ok, name, detail })
}

const schemaCodes = provision()
const codes = jsonOf(['codes', '-O', 'json'], 'codes').data
const codeList = Array.isArray(codes) ? codes : (codes?.codes ?? [])
const code = codeList.map((c) => (typeof c === 'string' ? c : c.code ?? c.id ?? c.key)).find(Boolean)
expect('原因码可读且与随包 schema 同源', !!code && codeList.length > 0, `CLI ${codeList.length} 条 / 随包 ${schemaCodes} 条`)
expect('CLI 目录条数 = 随包 schema 条数', codeList.length === schemaCodes, `${codeList.length} vs ${schemaCodes}`)

run(['add-student', '甲同学'], 'add-student')
run(['add-student', '乙同学'], 'add-student')
const students = JSON.stringify(jsonOf(['list-students', '-O', 'json'], 'list-students').data ?? '')
expect('两名学生在册', students.includes('甲同学') && students.includes('乙同学'))

run(['add', '甲同学', String(code), '--delta', '5', '--note', '课堂积极发言', '--operator', 'gate'], 'add +5')
run(['add', '乙同学', String(code), '--delta', '-3', '--note', '迟到', '--operator', 'gate'], 'add -3')
const score = jsonOf(['score', '甲同学', '-O', 'json'], 'score').data
expect('分数反映写入的增量', Number.isFinite(score?.delta) && score.delta === 5, JSON.stringify(score)?.slice(0, 80))
const ranking = JSON.stringify(jsonOf(['ranking', '-O', 'json'], 'ranking').data ?? '')
expect('排行榜按分数排序', ranking.indexOf('甲同学') >= 0 && ranking.indexOf('甲同学') < ranking.indexOf('乙同学'))

const validateOut = run(['validate', '-O', 'json'], 'validate')
expect('事件链校验全通过', /All 2 events valid|"valid"\s*:\s*true/i.test(validateOut), validateOut.replace(/\s+/g, ' ').slice(0, 90))
run(['replay'], 'replay')
run(['history', '甲同学'], 'history')
run(['search', '迟到'], 'search')
run(['range', '2000-01-01', '2099-12-31'], 'range')
run(['stats'], 'stats')
run(['summary'], 'summary')
run(['tag', 'list'], 'tag')
run(['rebuild-cache'], 'rebuild-cache')
const doctor = run(['doctor'], 'doctor')
expect('doctor 无异常', !/[1-9]\s*异常/.test(doctor), (doctor.match(/\d+ 通过[^\n]*/) ?? [''])[0])

/* 隐私脱敏引擎（PII Shield）*/
run(['privacy', 'init', PW, '--auto-scan'], 'privacy init')
run(['privacy', 'enable'], 'privacy enable')
run(['privacy', 'add', '--entity', 'stu-1', '--text', '甲同学'], 'privacy add')
const anon = run(['privacy', 'anonymize', '甲同学今天课堂表现很好'], 'privacy anonymize').split('\n').pop().trim()
expect('脱敏后看不到真名', !!anon && !anon.includes('甲同学'), anon)
const back = run(['privacy', 'deanonymize', anon], 'privacy deanonymize').split('\n').pop().trim()
expect('还原后拿回真名', back.includes('甲同学'), back)
run(['privacy', 'list'], 'privacy list')
run(['privacy', 'filter', anon, '--receiver', '家长'], 'privacy filter')
const dry = run(['privacy', 'dry-run', '甲同学的迟到记录'], 'privacy dry-run')
expect('dry-run 自证往返一致', /往返通过/.test(dry), dry.replace(/\s+/g, ' ').slice(0, 100))
run(['privacy', 'backup', join(ROOT, 'privacy-backup.json')], 'privacy backup')
expect('备份文件落盘', existsSync(join(ROOT, 'privacy-backup.json')))
run(['privacy', 'disable', PW], 'privacy disable')

const outFile = join(ROOT, 'ranking.jsonl')
run(['export', '--format', 'jsonl', '--output-file', outFile], 'export')
const lines = existsSync(outFile) ? readFileSync(outFile, 'utf8').trim().split('\n').length : 0
expect('导出 jsonl 每生一行', lines === 2, `${lines} 行`)

const bad = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  → ${r.detail}` : ''}`)
console.log(`\n[eaa-gate] ${results.length - bad.length}/${results.length} 通过  引擎=${BIN}`)
rmSync(ROOT, { recursive: true, force: true })
process.exit(bad.length === 0 ? 0 : 1)
