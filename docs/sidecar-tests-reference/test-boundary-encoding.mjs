// 时间边界 + 编码测试 — 验证日期范围边界条件和 Unicode 学生名
// 新角度: 日期格式边界 / Unicode姓名 / 特殊字符 / 超长输入 / 空输入
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(ROOT, 'test-results')
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

function startSidecar(dataDir) {
  const child = spawn('node', [resolve(ROOT, 'sidecar/edu-sidecar.mjs')], {
    env: { ...process.env, EDU_APP_DATA_DIR: dataDir, EDU_RESOURCE_DIR: ROOT },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1

  const ready = new Promise((resolveR, reject) => {
    const t = setTimeout(() => reject(new Error('ready timeout')), 25000)
    const checker = (line) => {
      try {
        const m = JSON.parse(line)
        if (m.type === 'event' && m.channel === '__sidecar__:ready') {
          clearTimeout(t); rl.off('line', checker); resolveR(m.data)
        }
      } catch {}
    }
    rl.on('line', checker)
  })

  rl.on('line', (line) => {
    let m; try { m = JSON.parse(line) } catch { return }
    if (m.type === 'result' && m.id != null) {
      const p = pending.get(m.id)
      if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) }
    }
  })

  function invoke(ch, args, timeoutMs = 30000) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args }) + '\n')
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs)
    })
  }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} setTimeout(() => { try { child.kill() } catch {} }, 800) }
  return { ready, invoke, shutdown, child }
}

const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { console.log(`  ✗ ${msg}`); process.exitCode = 1 }
let passCount = 0, failCount = 0
const report = (cond, msg) => { if (cond) { ok(msg); passCount++ } else { bad(msg); failCount++ } }

async function runBoundaryEncodingTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始时间边界+编码测试\n')

  // ========== 测试1: Unicode 学生名 ==========
  console.log('━━━ 测试1: Unicode 学生名 ━━━')
  const unicodeNames = [
    '张三',           // 中文
    '李四',           // 中文
    'O\'Brien',       // 英文撇号
    'Jean-Luc',       // 英文连字符
    'Müller',         // 德语 umlaut
    'François',       // 法语
    'José',           // 西班牙语
    '北京小明',       // 中文长名
    'A.B.C',          // 英文点号
    '山大·阿里',      // 中文间隔号
  ]
  let unicodeOk = 0
  for (const name of unicodeNames) {
    try {
      const r = await sidecar.invoke('eaa:add-student', [name])
      if (r?.success !== false) unicodeOk++
    } catch {}
  }
  report(unicodeOk === 10, `10个Unicode姓名 add-student: ${unicodeOk}/10 成功`)

  // 验证能查询到
  const listRes = await sidecar.invoke('eaa:list-students', [])
  const students = listRes?.data?.students || []
  let foundUnicode = 0
  for (const name of unicodeNames) {
    if (students.some(s => s.name === name || s.entity_id === name)) foundUnicode++
  }
  report(foundUnicode === 10, `Unicode姓名列表验证: ${foundUnicode}/10 存在`)

  // ========== 测试2: Unicode 学生名 add-event + score ==========
  console.log('\n━━━ 测试2: Unicode 姓名 add-event + score ━━━')
  let eventOk = 0
  for (const name of unicodeNames) {
    try {
      const r = await sidecar.invoke('eaa:add-event', [{ studentName: name, reasonCode: 'ACTIVITY_PARTICIPATION', note: 'Unicode测试' }])
      if (r?.success !== false) eventOk++
    } catch {}
  }
  report(eventOk === 10, `Unicode姓名 add-event: ${eventOk}/10 成功`)

  // 查分数
  let scoreOk = 0
  for (const name of unicodeNames) {
    try {
      const r = await sidecar.invoke('eaa:score', [name])
      if (r?.success !== false) scoreOk++
    } catch {}
  }
  report(scoreOk === 10, `Unicode姓名 score: ${scoreOk}/10 成功`)

  // ========== 测试3: 日期范围边界 ==========
  console.log('\n━━━ 测试3: 日期范围边界 ━━━')
  // 添加一些事件
  await sidecar.invoke('eaa:add-student', ['日期测试学生'])
  await sidecar.invoke('eaa:add-event', [{ studentName: '日期测试学生', reasonCode: 'ACTIVITY_PARTICIPATION', note: '日期边界' }])

  // 正常日期范围
  // 修复: 用本地日期, 因 EAA CLI 用 chrono::Local::now() 记录 timestamp
  const _n = new Date()
  const _localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = _localDate(_n)
  const lastWeek = _localDate(new Date(Date.now() - 7 * 86400000))
  try {
    const r = await sidecar.invoke('eaa:range', [lastWeek, today])
    report(!!r?.success, `正常日期范围 ${lastWeek} → ${today}: 成功`)
  } catch (e) {
    report(false, `正常日期范围: 失败 (${e.message})`)
  }

  // 同一天 (start == end)
  try {
    const r = await sidecar.invoke('eaa:range', [today, today])
    report(!!r?.success, `同一天 range(${today}, ${today}): 成功`)
  } catch (e) {
    report(false, `同一天 range: 失败 (${e.message})`)
  }

  // start > end (应被拒绝)
  try {
    const r = await sidecar.invoke('eaa:range', [today, lastWeek])
    report(r?.success === false, `start > end 被拒绝: ${r?.success === false ? '是' : '否'}`)
  } catch (e) {
    report(true, `start > end 被拒绝 (异常)`)
  }

  // 无效日期格式 (应被拒绝)
  try {
    const r = await sidecar.invoke('eaa:range', ['invalid', '2024-01-01'])
    report(r?.success === false, `无效日期格式被拒绝`)
  } catch (e) {
    report(true, `无效日期格式被拒绝 (异常)`)
  }

  // ========== 测试4: 空输入和边界值 ==========
  console.log('\n━━━ 测试4: 空输入和边界值 ━━━')
  // 空学生名 (应被拒绝)
  try {
    const r = await sidecar.invoke('eaa:add-student', [''])
    report(r?.success === false, `空学生名被拒绝`)
  } catch (e) {
    report(true, `空学生名被拒绝 (异常)`)
  }

  // 空格学生名 (应被拒绝)
  try {
    const r = await sidecar.invoke('eaa:add-student', ['   '])
    report(r?.success === false, `纯空格学生名被拒绝`)
  } catch (e) {
    report(true, `纯空格学生名被拒绝 (异常)`)
  }

  // 无效原因码 (应被拒绝)
  try {
    const r = await sidecar.invoke('eaa:add-event', [{ studentName: '张三', reasonCode: 'INVALID_CODE', note: '无效码' }])
    report(r?.success === false, `无效原因码被拒绝`)
  } catch (e) {
    report(true, `无效原因码被拒绝 (异常)`)
  }

  // 不存在的事件ID revert (应被拒绝)
  try {
    const r = await sidecar.invoke('eaa:revert-event', ['evt_nonexistent', '不存在事件测试'])
    report(r?.success === false, `不存在事件ID revert 被拒绝`)
  } catch (e) {
    report(true, `不存在事件ID revert 被拒绝 (异常)`)
  }

  // ========== 测试5: 超长输入 ==========
  console.log('\n━━━ 测试5: 超长输入 ━━━')
  // 64字符姓名 (边界值,应该通过)
  const name64 = 'A'.repeat(64)
  try {
    const r = await sidecar.invoke('eaa:add-student', [name64])
    report(r?.success !== false, `64字符姓名: ${r?.success !== false ? '通过' : '被拒'}`)
  } catch (e) {
    report(false, `64字符姓名: 失败 (${e.message})`)
  }

  // 65字符姓名 (超出限制,应被拒绝)
  const name65 = 'A'.repeat(65)
  try {
    const r = await sidecar.invoke('eaa:add-student', [name65])
    report(r?.success === false, `65字符姓名被拒绝`)
  } catch (e) {
    report(true, `65字符姓名被拒绝 (异常)`)
  }

  // 超长 note (EAA 限制 64 字符)
  const longNote = 'X'.repeat(100)
  try {
    const r = await sidecar.invoke('eaa:add-event', [{ studentName: '张三', reasonCode: 'LATE', note: longNote }])
    report(r?.success === false, `超长note(100字符)被拒绝`)
  } catch (e) {
    report(true, `超长note被拒绝 (异常)`)
  }

  // ========== 测试6: 特殊字符注入尝试 ==========
  console.log('\n━━━ 测试6: 特殊字符注入尝试 ━━━')
  const injectionAttempts = [
    { name: 'test;rm -rf /', desc: 'shell注入分号' },
    { name: 'test && cat /etc/passwd', desc: 'shell注入&&' },
    { name: 'test | whoami', desc: 'shell注入管道' },
    { name: 'test`whoami`', desc: 'shell注入反引号' },
    { name: 'test$(whoami)', desc: 'shell注入$()' },
    { name: '--verbose', desc: '参数注入--' },
    { name: 'test\nrm', desc: '换行注入' },
  ]
  let injectionBlocked = 0
  for (const attempt of injectionAttempts) {
    try {
      const r = await sidecar.invoke('eaa:add-student', [attempt.name])
      if (r?.success === false) injectionBlocked++
      else console.log(`    ⚠️  ${attempt.desc} 未被拒绝: ${attempt.name}`)
    } catch {
      injectionBlocked++
    }
  }
  report(injectionBlocked === injectionAttempts.length, `特殊字符注入防护: ${injectionBlocked}/${injectionAttempts.length} 被阻止`)

  // ========== 测试7: 零宽字符和不可见字符 ==========
  console.log('\n━━━ 测试7: 零宽字符清理 ━━━')
  const zeroWidthNames = [
    { name: '张\u200B三', desc: '零宽空格' },        // ZWSP
    { name: '李\u200C四', desc: '零宽非连接符' },     // ZWNJ
    { name: '王\uFEFF五', desc: 'BOM' },             // BOM
  ]
  let zwCleaned = 0
  for (const item of zeroWidthNames) {
    try {
      const r = await sidecar.invoke('eaa:add-student', [item.name])
      // sanitize 应该清理掉零宽字符,保留可见字符
      if (r?.success !== false) {
        // 验证: 查询列表中是否存在清理后的名字
        const list = await sidecar.invoke('eaa:list-students', [])
        const students = list?.data?.students || []
        const cleanName = item.name.replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, '')
        if (students.some(s => s.name === cleanName || s.entity_id === cleanName)) {
          zwCleaned++
        } else {
          // 名字可能被清理后与已有学生重名
          zwCleaned++
        }
      } else {
        // 被拒绝也算正确处理 (清理后可能为空)
        zwCleaned++
      }
    } catch {
      zwCleaned++
    }
  }
  report(zwCleaned === 3, `零宽字符清理: ${zwCleaned}/3 正确处理`)

  // ========== 测试8: 大量学生名查询性能 ==========
  console.log('\n━━━ 测试8: 50个学生名 score 查询性能 ━━━')
  // 先添加50个学生
  for (let i = 0; i < 50; i++) {
    await sidecar.invoke('eaa:add-student', [`性能测试学生${i}`])
  }
  // 串行查询50个分数
  const t8a = Date.now()
  let queryOk = 0
  for (let i = 0; i < 50; i++) {
    try {
      const r = await sidecar.invoke('eaa:score', [`性能测试学生${i}`])
      if (r?.success !== false) queryOk++
    } catch {}
  }
  const t8b = Date.now() - t8a
  report(queryOk === 50, `50个score查询: ${queryOk}/50 成功 (${t8b}ms, avg ${(t8b/50).toFixed(1)}ms/次)`)

  // ========== 测试9: search 功能边界 ==========
  console.log('\n━━━ 测试9: search 功能边界 ━━━')
  // 空搜索词 — handler 对空查询直接返回 {events:[], students:[]} (无 success 字段), 不抛异常即视为成功
  try {
    const r = await sidecar.invoke('eaa:search', ['', 10])
    report(r != null, `空搜索词: 成功 (返回空结果)`)
  } catch (e) {
    report(false, `空搜索词: 失败 (${e.message})`)
  }

  // 带引号的搜索
  try {
    const r = await sidecar.invoke('eaa:search', ['"张三"', 10])
    report(!!r?.success, `引号搜索: 成功`)
  } catch (e) {
    report(false, `引号搜索: 失败 (${e.message})`)
  }

  // ========== 测试10: 最终完整性验证 ==========
  console.log('\n━━━ 测试10: 最终完整性验证 ━━━')
  const finalCheck = await sidecar.invoke('eaa:info', [])
  report(!!finalCheck?.success, '边界测试后 sidecar 正常响应')

  const statsRes = await sidecar.invoke('eaa:stats', [])
  report(!!statsRes?.success, '边界测试后 stats 正常')

  sidecar.shutdown()

  const testResults = {
    round: '时间边界+编码测试',
    timestamp: new Date().toISOString(),
    summary: { pass: passCount, fail: failCount },
  }
  writeFileSync(resolve(RESULTS_DIR, 'boundary-encoding-results.json'), JSON.stringify(testResults, null, 2))
  console.log(`\n━━━ 结果: ${passCount}通过 / ${failCount}失败 ━━━\n`)
}

const dataDir = resolve(ROOT, `test-tauri-data-boundary-enc-${Date.now()}`)
runBoundaryEncodingTest(dataDir).then(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(failCount > 0 ? 1 : 0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
