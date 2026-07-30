// 复现完整污染: 多轮 (部分reset + 加学生 + 加事件) 后 ranking 过滤为空
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EAA_BIN = join(process.cwd(), 'resources', 'eaa-binaries', 'win32-x64', 'eaa.exe')
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'eaa-repro2-'))
const TEST_DATA = join(TEST_ROOT, 'data')
const SCHEMA_SRC = join(process.cwd(), 'core', 'eaa-cli', 'schema', 'reason_codes.json')

mkdirSync(join(TEST_DATA, 'entities'), { recursive: true })
mkdirSync(join(TEST_DATA, 'events'), { recursive: true })
mkdirSync(join(TEST_ROOT, 'schema'), { recursive: true })
if (existsSync(SCHEMA_SRC)) writeFileSync(join(TEST_ROOT, 'schema', 'reason_codes.json'), readFileSync(SCHEMA_SRC))

// 与测试 resetEaaData 完全一致: 只重置3个文件
function resetData() {
  writeFileSync(join(TEST_DATA, 'entities', 'entities.json'), '{"entities":{}}')
  writeFileSync(join(TEST_DATA, 'entities', 'name_index.json'), '{}')
  writeFileSync(join(TEST_DATA, 'events', 'events.json'), '[]')
}

function eaaRun(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(EAA_BIN, args, { env: { ...process.env, EAA_DATA_DIR: TEST_DATA }, timeout: 10000 })
    let out = '', err = ''
    proc.stdout?.on('data', (d) => (out += d.toString()))
    proc.stderr?.on('data', (d) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('exit', (code) => code !== 0 ? reject(new Error(`eaa ${args[0]} exit ${code}: ${err.slice(0, 200)}`)) : resolve(out))
  })
}

async function tryRun(args, tolerate = []) {
  try { return await eaaRun(args) } catch (e) {
    const msg = String(e)
    if (tolerate.some((t) => msg.includes(t))) return `(tolerated: ${msg.slice(0, 60)})`
    throw e
  }
}

function walk(dir, prefix = '') {
  const lines = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) lines.push(...walk(p, `${prefix}${f}/`))
    else lines.push(`${prefix}${f} (${statSync(p).size}B)`)
  }
  return lines
}

async function round(label) {
  console.log(`\n===== ROUND ${label} =====`)
  resetData()  // 测试的 beforeEach
  // 场景3 beforeEach: 6 学生 + 分班 + 事件
  for (const n of ['对比测试1', '对比测试2', '对比测试3', '对比测试4', '对比测试5', '对比测试6']) {
    await tryRun(['add-student', n])
  }
  for (const [n, c] of [['对比测试1', 'G7-1'], ['对比测试2', 'G7-1'], ['对比测试3', 'G7-1'], ['对比测试4', 'G7-2'], ['对比测试5', 'G7-2'], ['对比测试6', 'G7-2']]) {
    await tryRun(['set-student-meta', n, '--class-id', c])
  }
  for (const [n, code, d] of [['对比测试1', 'CLASS_MONITOR', 10], ['对比测试2', 'CLASS_COMMITTEE', 5], ['对比测试3', 'MONTHLY_ATTENDANCE', 2], ['对比测试4', 'LATE', -2], ['对比测试5', 'PHONE_IN_CLASS', -5], ['对比测试6', 'SMOKING', -10]]) {
    const r = await tryRun(['add', n, code, '--delta', String(d), '--note', 'x'], ['重复', 'dedup', 'duplicate'])
    console.log(`add ${n} ${code}: ${String(r).slice(0, 80).replace(/\n/g, ' ')}`)
  }
  const ranking = JSON.parse(await eaaRun(['ranking', '-O', 'json']))
  const g7_1 = ranking.ranking.filter((x) => x.class_id === 'G7-1')
  console.log(`round ${label}: total ranking=${ranking.ranking.length}, g7_1=${g7_1.length}`)
  console.log('files:', walk(TEST_DATA).join(' | '))
}

async function main() {
  await round(1)
  await round(2)
  await round(3)
  rmSync(TEST_ROOT, { recursive: true, force: true })
}
main().catch((e) => { console.error(e); process.exit(1) })
