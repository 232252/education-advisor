// 全量 IPC 验证 — 模拟渲染进程会调用的所有 window.api 方法
// 覆盖 13 个 namespace 的核心方法 (含读 + 写操作)
import { spawn as spawnFn } from 'node:child_process'
import readline from 'node:readline'

const env = {
  ...process.env,
  EDU_APP_DATA_DIR: process.argv[2] || `${process.cwd()}/test-tauri-data`,
  EDU_RESOURCE_DIR: process.cwd(),
}

const child = spawnFn('node', ['sidecar/edu-sidecar.mjs'], {
  env,
  stdio: ['pipe', 'pipe', 'inherit'],
})

const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
const pending = new Map()
let nextId = 1

function waitForReady() {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ready timeout 20s')), 20000)
    const checker = (line) => {
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'event' && msg.channel === '__sidecar__:ready') {
          clearTimeout(t)
          rl.off('line', checker)
          resolve(msg.data)
        }
      } catch {
        /* ignore */
      }
    }
    rl.on('line', checker)
  })
}

rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.type === 'result' && msg.id != null) {
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.data)
      else p.reject(new Error(msg.error || 'unknown'))
    }
  }
})

function invoke(channel, ...args) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ id, type: 'invoke', channel, args }) + '\n')
  })
}

function summarize(result) {
  if (result === null || result === undefined) return 'null'
  if (Array.isArray(result)) return `array[${result.length}]`
  if (typeof result === 'object') {
    const keys = Object.keys(result).slice(0, 4)
    return `object{${keys.join(',')}}`
  }
  return typeof result
}

async function main() {
  const readyData = await waitForReady()
  console.log(`\n✅ Sidecar READY — ${readyData.channels.length} channels registered\n`)

  const tests = [
    // ---------- EAA 核心 (读) ----------
    ['eaa:info', '系统信息', []],
    ['eaa:list-students', '学生列表', []],
    ['eaa:ranking', '排行榜', [10]],
    ['eaa:stats', '统计', []],
    ['eaa:codes', '原因码', []],
    ['eaa:doctor', '健康检查', []],
    ['eaa:export-formats', '导出格式', []],
    ['eaa:validate', '数据校验', []],
    // ---------- EAA 写操作 ----------
    ['eaa:add-student', '新增学生', [`测试学生_${Date.now()}`]],
    // ---------- Agent ----------
    ['agent:list', 'Agent列表(18)', []],
    ['agent:get', 'Agent详情', ['class-monitor']],
    ['agent:get-soul', 'Agent SOUL', ['class-monitor']],
    // ---------- AI / LLM ----------
    ['ai:list-providers', 'Provider列表', []],
    // ---------- Settings ----------
    ['settings:get', '读取设置', []],
    // ---------- Skill ----------
    ['skill:list', '技能列表', []],
    // ---------- Cron ----------
    ['cron:list', '定时任务', []],
    // ---------- Class ----------
    ['class:list', '班级列表', []],
    ['class:create', '创建班级', [{ name: `测试班级_${Date.now()}`, grade: 'G7' }]],
    // ---------- Privacy ----------
    ['privacy:status', '隐私状态', []],
    // ---------- Profile ----------
    ['profile:get', '学生档案', ['测试学生']],
    // ---------- Ollama ----------
    ['ollama:detect', 'Ollama检测', []],
    // ---------- Chat ----------
    ['chat:list-sessions', '会话列表', []],
    // ---------- Log ----------
    ['log:list', '日志文件', []],
    // ---------- Feishu ----------
    ['feishu:status', '飞书状态', []],
  ]

  console.log('=== 全量 IPC 功能验证 ===\n')
  let pass = 0
  let fail = 0
  const failures = []
  for (const [channel, desc, args] of tests) {
    try {
      const result = await Promise.race([
        invoke(channel, ...args),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 15s')), 15000)),
      ])
      console.log(`  ✓ [${desc}] ${channel} → ${summarize(result)}`)
      pass++
    } catch (e) {
      console.log(`  ✗ [${desc}] ${channel} → ${e.message}`)
      failures.push(`${channel}: ${e.message}`)
      fail++
    }
  }

  console.log(`\n=== 结果: ${pass} pass / ${fail} fail (共 ${tests.length}) ===`)
  if (failures.length > 0) {
    console.log('\n失败明细:')
    for (const f of failures) console.log(`  - ${f}`)
  }

  child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n')
  setTimeout(() => {
    child.kill()
    process.exit(fail > 0 ? 1 : 0)
  }, 1000)
}

main().catch((e) => {
  console.error('FATAL', e)
  child.kill()
  process.exit(1)
})
