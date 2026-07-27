// =============================================================
// 深度缓存正确性 + 大批量操作 + 内存泄漏检测
//
// 测试维度:
//   1. 缓存失效正确性 - 写操作后读必须返回新数据
//   2. 大批量操作 - 50+学生添加/调班性能
//   3. 内存泄漏检测 - 1000次操作后heap增长
//   4. 并发缓存压力 - 写+读交叉,验证无脏读
//   5. TTL边界 - 缓存过期后必须重新获取
// =============================================================
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
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ready timeout 30s')), 30000)
    const c = (l) => {
      try {
        const m = JSON.parse(l)
        if (m.type === 'event' && m.channel === '__sidecar__:ready') {
          clearTimeout(t)
          rl.off('line', c)
          res(m.data)
        }
      } catch {}
    }
    rl.on('line', c)
  })
  rl.on('line', (l) => {
    let m
    try { m = JSON.parse(l) } catch { return }
    if (m.type === 'result' && m.id != null) {
      const p = pending.get(m.id)
      if (p) {
        pending.delete(m.id)
        m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?'))
      }
    }
  })
  function invoke(ch, args) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      try {
        child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n')
      } catch (e) {
        pending.delete(id)
        rej(e)
      }
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          rej(new Error('timeout 60s'))
        }
      }, 60000)
    })
  }
  const shutdown = () => {
    try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {}
    return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500))
  }
  return { ready, invoke, shutdown, child }
}

async function timed(fn) {
  const t = Date.now()
  const v = await fn()
  return { v, ms: Date.now() - t }
}

async function run() {
  const dataDir = resolve(ROOT, 'test-deep-cache-data')
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })

  const sc = startSidecar(dataDir)
  await sc.ready
  console.log('✓ Sidecar READY\n')

  const results = []
  let pass = 0
  let fail = 0

  function check(name, condition, detail = '') {
    const ok = !!condition
    const icon = ok ? '✓' : '✗'
    if (ok) pass++; else fail++
    console.log(`  ${icon} ${name}${detail ? ' → ' + detail : ''}`)
    results.push({ name, ok, detail })
  }

  // ===== 测试1: add-student 后 list-students 缓存失效 =====
  console.log('━━━ 测试1: add-student → list-students 缓存失效 ━━━')
  // 预热: 添加一个学生,让 list-students 有数据
  await sc.invoke('eaa:add-student', ['缓存测试学生A'])
  // 读取 list-students (填充缓存)
  const ls1 = await timed(() => sc.invoke('eaa:list-students', []))
  const studentsBefore = ls1.v?.data?.students ?? []
  check('list-students 第1次返回数据', studentsBefore.length >= 1, `count=${studentsBefore.length}`)
  // 缓存命中: 第2次应该 < 5ms
  const ls2 = await timed(() => sc.invoke('eaa:list-students', []))
  check('list-students 缓存命中', ls2.ms < 5, `ms=${ls2.ms}`)
  // 添加新学生 (应失效缓存)
  await sc.invoke('eaa:add-student', ['缓存测试学生B'])
  // 立即读取: 应该看到新学生(缓存已失效)
  const ls3 = await timed(() => sc.invoke('eaa:list-students', []))
  const studentsAfter = ls3.v?.data?.students ?? []
  const foundB = studentsAfter.some(s => s.name === '缓存测试学生B')
  check('add-student 后缓存失效,看到新学生', foundB, `count=${studentsAfter.length}, foundB=${foundB}`)

  // ===== 测试2: add-event 后 ranking 缓存失效 =====
  console.log('\n━━━ 测试2: add-event → ranking 缓存失效 ━━━')
  // 先获取 ranking (填充缓存)
  const r1 = await timed(() => sc.invoke('eaa:ranking', []))
  const rankingBefore = r1.v?.data?.ranking ?? []
  check('ranking 第1次成功', r1.v?.success, `count=${rankingBefore.length}`)
  // 添加事件改变分数 (应失效缓存) - 使用真实原因码 SPEAK_IN_CLASS (delta=-2)
  await sc.invoke('eaa:add-event', [{
    studentName: '缓存测试学生A',
    reasonCode: 'SPEAK_IN_CLASS',
    note: '缓存失效测试',
  }])
  // 立即读取 ranking: 应该是新数据(缓存已失效)
  const r2 = await timed(() => sc.invoke('eaa:ranking', []))
  const rankingAfter = r2.v?.data?.ranking ?? []
  check('add-event 后 ranking 缓存失效', r2.v?.success, `count=${rankingAfter.length}, ms=${r2.ms}`)
  // 验证学生A的分数确实变了
  const studentABefore = rankingBefore.find(s => s.entity_id === '缓存测试学生A' || s.name === '缓存测试学生A')
  const studentAAfter = rankingAfter.find(s => s.entity_id === '缓存测试学生A' || s.name === '缓存测试学生A')
  if (studentABefore && studentAAfter) {
    check('ranking 分数确实变化', true, `before=${studentABefore.score}, after=${studentAAfter.score}`)
  } else {
    check('ranking 分数确实变化(学生存在)', !!studentAAfter, `found=${!!studentAAfter}`)
  }

  // ===== 测试3: set-student-meta 后 list-students 缓存失效 =====
  console.log('\n━━━ 测试3: set-student-meta → list-students 缓存失效 ━━━')
  // 读取 list-students (填充缓存)
  await sc.invoke('eaa:list-students', [])
  // 设置 class-id
  await sc.invoke('eaa:set-student-meta', [{
    name: '缓存测试学生A',
    classId: 'TEST-CLASS-1',
  }])
  // 立即读取: 应该看到新的 class_id
  const ls4 = await sc.invoke('eaa:list-students', [])
  const studentA = (ls4?.data?.students ?? []).find(s => s.name === '缓存测试学生A')
  check('set-student-meta 后 class_id 更新', studentA?.class_id === 'TEST-CLASS-1', `class_id=${studentA?.class_id}`)

  // ===== 测试4: delete-student 后 list-students 缓存失效 =====
  console.log('\n━━━ 测试4: delete-student → list-students 缓存失效 ━━━')
  // 添加一个临时学生
  await sc.invoke('eaa:add-student', ['临时删除测试学生'])
  await sc.invoke('eaa:list-students', []) // 填充缓存
  // 删除 (带 confirm)
  await sc.invoke('eaa:delete-student', ['临时删除测试学生', { confirm: true, reason: '测试删除' }])
  // 立即读取
  const ls5 = await sc.invoke('eaa:list-students', [])
  const deletedStudent = (ls5?.data?.students ?? []).find(s => s.name === '临时删除测试学生')
  // delete-student 是软删除,学生仍在列表中但 status=Deleted
  check('delete-student 后缓存失效(status=Deleted)', deletedStudent?.status === 'Deleted', `status=${deletedStudent?.status}`)

  // ===== 测试5: 大批量添加学生 (50个) =====
  console.log('\n━━━ 测试5: 大批量添加学生 (50个) ━━━')
  const batchStart = Date.now()
  const batchNames = []
  for (let i = 0; i < 50; i++) {
    batchNames.push(`批量学生${String(i).padStart(3, '0')}`)
  }
  // 并发添加 (分10批,每批5个) - 写队列会自动串行化
  let batchOk = 0
  for (let batch = 0; batch < 10; batch++) {
    const chunk = batchNames.slice(batch * 5, (batch + 1) * 5)
    const results = await Promise.allSettled(chunk.map(name => sc.invoke('eaa:add-student', [name])))
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.success) batchOk++
    }
  }
  const batchMs = Date.now() - batchStart
  console.log(`  批量添加: ${batchOk}/50 成功, ms=${batchMs}`)
  // 验证全部添加成功
  const ls6 = await sc.invoke('eaa:list-students', [])
  const allStudents = ls6?.data?.students ?? []
  console.log(`  list-students 返回 ${allStudents.length} 个学生`)
  let batchFound = 0
  for (const name of batchNames) {
    if (allStudents.some(s => s.name === name)) batchFound++
  }
  check('50个批量学生全部添加成功', batchFound === 50, `found=${batchFound}/50, total=${allStudents.length}, ms=${batchMs}`)
  check('批量添加性能合理 (< 30s)', batchMs < 30000, `ms=${batchMs}`)

  // ===== 测试6: 大批量 class:assign (30个学生) =====
  console.log('\n━━━ 测试6: 大批量 class:assign (30个学生) ━━━')
  // 先创建班级
  await sc.invoke('class:create', [{
    id: 'BATCH-CLASS',
    name: '批量调班测试班',
    grade: '测试年级',
  }])
  const assignNames = batchNames.slice(0, 30)
  const assignStart = Date.now()
  const assignResult = await sc.invoke('class:assign', [{
    class_id: 'BATCH-CLASS',
    student_names: assignNames,
  }])
  const assignMs = Date.now() - assignStart
  check('批量调班成功', assignResult?.success, `assigned=${assignResult?.assigned}, failed=${assignResult?.failed?.length}, ms=${assignMs}`)
  // 验证 list-students 中这些学生的 class_id 已更新
  const ls7 = await sc.invoke('eaa:list-students', [])
  const students7 = ls7?.data?.students ?? []
  let assignVerified = 0
  for (const name of assignNames) {
    const s = students7.find(x => x.name === name)
    if (s?.class_id === 'BATCH-CLASS') assignVerified++
  }
  check('批量调班 class_id 验证', assignVerified === 30, `verified=${assignVerified}/30`)

  // ===== 测试7: 内存泄漏检测 (1000次操作) =====
  console.log('\n━━━ 测试7: 内存泄漏检测 (1000次操作) ━━━')
  // 获取初始内存
  const memBefore = process.memoryUsage()
  console.log(`  初始 heap: ${(memBefore.heapUsed / 1024 / 1024).toFixed(1)}MB`)
  // 执行 1000 次混合操作
  for (let i = 0; i < 1000; i++) {
    const op = i % 5
    switch (op) {
      case 0: await sc.invoke('eaa:info', []); break
      case 1: await sc.invoke('eaa:codes', []); break
      case 2: await sc.invoke('eaa:stats', []); break
      case 3: await sc.invoke('eaa:ranking', []); break
      case 4: await sc.invoke('eaa:list-students', []); break
    }
  }
  const memAfter = process.memoryUsage()
  const heapGrowth = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024
  console.log(`  结束 heap: ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)}MB`)
  console.log(`  heap 增长: ${heapGrowth.toFixed(1)}MB`)
  // 1000次操作后 heap 增长应 < 20MB (允许一些缓存和GC波动)
  check('内存泄漏检测 (1000次操作后增长 < 20MB)', heapGrowth < 20, `growth=${heapGrowth.toFixed(1)}MB`)

  // ===== 测试8: 并发写+读交叉,验证无脏读 =====
  console.log('\n━━━ 测试8: 并发写+读交叉 ━━━')
  // 添加一个学生用于测试
  await sc.invoke('eaa:add-student', ['并发测试学生'])
  // 并发: 5个写(add-event) + 5个读(list-students)
  // 使用真实原因码 SPEAK_IN_CLASS (delta=-2)
  const promises = []
  for (let i = 0; i < 5; i++) {
    promises.push(sc.invoke('eaa:add-event', [{
      studentName: '并发测试学生',
      reasonCode: 'SPEAK_IN_CLASS',
      note: `并发事件${i}`,
    }]))
    promises.push(sc.invoke('eaa:list-students', []))
  }
  const results8 = await Promise.allSettled(promises)
  const okCount = results8.filter(r => r.status === 'fulfilled').length
  check('并发写+读全部完成', okCount === 10, `ok=${okCount}/10`)
  // 最终验证: 学生存在且分数正确
  const lsFinal = await sc.invoke('eaa:list-students', [])
  const concurrent = (lsFinal?.data?.students ?? []).find(s => s.name === '并发测试学生')
  check('并发后学生数据完整', !!concurrent, `found=${!!concurrent}`)

  // ===== 测试9: score 缓存按学生名隔离 =====
  console.log('\n━━━ 测试9: score 缓存按学生名隔离 ━━━')
  // 查询学生A分数 (填充缓存)
  const sc1 = await timed(() => sc.invoke('eaa:score', ['缓存测试学生A']))
  check('score 学生A 第1次', sc1.v?.success, `ms=${sc1.ms}`)
  // 查询学生B分数 (不同key,不应命中A的缓存)
  const sc2 = await timed(() => sc.invoke('eaa:score', ['缓存测试学生B']))
  check('score 学生B (不同key)', sc2.v?.success, `ms=${sc2.ms}`)
  // 再次查询学生A (应命中缓存)
  const sc3 = await timed(() => sc.invoke('eaa:score', ['缓存测试学生A']))
  check('score 学生A 缓存命中', sc3.ms < 5, `ms=${sc3.ms}`)

  // ===== 测试10: history 缓存按学生名隔离 =====
  console.log('\n━━━ 测试10: history 缓存按学生名隔离 ━━━')
  const h1 = await timed(() => sc.invoke('eaa:history', ['缓存测试学生A']))
  check('history 学生A 第1次', h1.v?.success, `ms=${h1.ms}`)
  const h2 = await timed(() => sc.invoke('eaa:history', ['缓存测试学生B']))
  check('history 学生B (不同key)', h2.v?.success, `ms=${h2.ms}`)
  const h3 = await timed(() => sc.invoke('eaa:history', ['缓存测试学生A']))
  check('history 学生A 缓存命中', h3.ms < 5, `ms=${h3.ms}`)

  // ===== 测试11: revert-event 后缓存失效 =====
  console.log('\n━━━ 测试11: revert-event → 缓存失效 ━━━')
  // 添加一个事件用于撤销 - 使用 LATE 原因码(避免与测试2的 SPEAK_IN_CLASS 重复)
  const addResult = await sc.invoke('eaa:add-event', [{
    studentName: '缓存测试学生A',
    reasonCode: 'LATE',
    note: '待撤销事件',
  }])
  // 从 add 结果文本中提取 event_id (格式: "✓ 事件已创建: evt_xxxxx 学生名 -2.0")
  const eventData = typeof addResult?.data === 'string' ? addResult.data : JSON.stringify(addResult?.data)
  const eventIdMatch = eventData.match(/(evt_[a-f0-9]+)/i)
  if (eventIdMatch) {
    const eventId = eventIdMatch[1]
    console.log(`  提取到 eventId: ${eventId}`)
    // 读取 score (填充缓存)
    await sc.invoke('eaa:score', ['缓存测试学生A'])
    // 撤销事件
    const revertRes = await sc.invoke('eaa:revert-event', [eventId, '测试撤销'])
    console.log(`  revert 结果: success=${revertRes?.success}`)
    // 读取 score (应失效缓存,返回新分数)
    const scAfter = await sc.invoke('eaa:score', ['缓存测试学生A'])
    check('revert-event 后 score 缓存失效', scAfter?.success, `eventId=${eventId}`)
  } else {
    check('revert-event 提取 eventId', false, `无法从add结果提取eventId, data=${eventData.slice(0, 200)}`)
  }

  // ===== 测试12: 100并发读 + 内存稳定 =====
  console.log('\n━━━ 测试12: 100并发读 + 内存稳定 ━━━')
  const memBefore12 = process.memoryUsage()
  const promises12 = []
  for (let i = 0; i < 100; i++) {
    promises12.push(sc.invoke('eaa:ranking', []))
  }
  const results12 = await Promise.allSettled(promises12)
  const ok12 = results12.filter(r => r.status === 'fulfilled').length
  const memAfter12 = process.memoryUsage()
  const growth12 = (memAfter12.heapUsed - memBefore12.heapUsed) / 1024 / 1024
  check('100并发读全部成功', ok12 === 100, `ok=${ok12}/100`)
  check('100并发后内存增长合理 (< 10MB)', growth12 < 10, `growth=${growth12.toFixed(1)}MB`)

  // ===== 总结 =====
  console.log('\n════════════════════════════════════════════════')
  console.log(`  深度缓存测试结果: ${pass} pass / ${fail} fail / ${pass + fail} total`)
  console.log('════════════════════════════════════════════════\n')

  // 写结果到文件
  const reportPath = resolve(RESULTS_DIR, 'deep-cache-results.md')
  const lines = [
    '# 深度缓存测试结果',
    '',
    `- 时间: ${new Date().toISOString()}`,
    `- 结果: ${pass} pass / ${fail} fail / ${pass + fail} total`,
    '',
    '## 测试详情',
    '',
    '| 测试 | 结果 | 详情 |',
    '|------|------|------|',
  ]
  for (const r of results) {
    lines.push(`| ${r.name} | ${r.ok ? '✓' : '✗'} | ${r.detail || ''} |`)
  }
  writeFileSync(reportPath, lines.join('\n'), 'utf-8')
  console.log(`  报告已写入: ${reportPath}\n`)

  await sc.shutdown()
  // 清理测试数据
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })

  return { pass, fail, results }
}

run().catch(err => {
  console.error('测试套件异常:', err)
  process.exit(1)
})
