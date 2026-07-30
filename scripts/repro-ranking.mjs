// 复现 business-scenario 场景3 失败: 按 class_id 过滤 ranking
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EAA_BIN = join(process.cwd(), 'resources', 'eaa-binaries', 'win32-x64', 'eaa.exe')
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'eaa-repro-'))
const TEST_DATA = join(TEST_ROOT, 'data')
const SCHEMA_SRC = join(process.cwd(), 'core', 'eaa-cli', 'schema', 'reason_codes.json')

mkdirSync(join(TEST_DATA, 'entities'), { recursive: true })
mkdirSync(join(TEST_DATA, 'events'), { recursive: true })
mkdirSync(join(TEST_ROOT, 'schema'), { recursive: true })

function resetData() {
  writeFileSync(join(TEST_DATA, 'entities', 'entities.json'), '{"entities":{}}')
  writeFileSync(join(TEST_DATA, 'entities', 'name_index.json'), '{}')
  writeFileSync(join(TEST_DATA, 'events', 'events.json'), '[]')
}
resetData()
if (existsSync(SCHEMA_SRC)) {
  writeFileSync(join(TEST_ROOT, 'schema', 'reason_codes.json'), readFileSync(SCHEMA_SRC))
}

function eaaRun(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(EAA_BIN, args, {
      env: { ...process.env, EAA_DATA_DIR: TEST_DATA },
      timeout: 10000,
    })
    let out = '', err = ''
    proc.stdout?.on('data', (d) => (out += d.toString()))
    proc.stderr?.on('data', (d) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`eaa ${args[0]} exit ${code}: ${err.slice(0, 300)}`))
      resolve(out)
    })
  })
}

async function main() {
  // 模拟 场景3 beforeEach
  for (const n of ['对比测试1', '对比测试2', '对比测试3']) {
    console.log(await eaaRun(['add-student', n]))
  }
  for (const n of ['对比测试1', '对比测试2', '对比测试3']) {
    console.log(await eaaRun(['set-student-meta', n, '--class-id', 'G7-1']))
  }
  // 加事件
  try {
    console.log('add event:', await eaaRun(['add', '对比测试1', 'CLASS_MONITOR', '--delta', '10', '--note', '班长']))
  } catch (e) {
    console.log('ADD EVENT FAILED:', String(e))
  }
  console.log('=== files after add ===')
  const { readdirSync, statSync } = await import('node:fs')
  function walk(dir, prefix = '') {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p, `${prefix}${f}/`)
      else console.log(`${prefix}${f} (${statSync(p).size}B)`)
    }
  }
  walk(TEST_DATA)

  // ranking 全量
  const rankingOut = await eaaRun(['ranking', '-O', 'json'])
  console.log('=== ranking ===')
  console.log(rankingOut)

  const r = JSON.parse(rankingOut)
  const g7_1 = r.ranking.filter((x) => x.class_id === 'G7-1')
  console.log('g7_1 count:', g7_1.length)

  rmSync(TEST_ROOT, { recursive: true, force: true })
}
main().catch((e) => { console.error(e); process.exit(1) })
