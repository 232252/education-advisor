// R7: 软删除学生仍被 info/listStudents 计入 — 验证是否 bug
// 步骤:
//   1. 记录初始 info.students / listStudents 数量
//   2. 创建一个测试学生
//   3. 验证 info.students 增加 1,listStudents 包含新学生
//   4. 调用 deleteStudent(预览模式,confirm=false) — 不应实际删除
//   5. 验证 info.students 仍包含该学生
//   6. 调用 deleteStudent(confirm=true) — 实际删除
//   7. 验证 info.students 减少 1,listStudents 不再包含该学生
//   8. 多次删除同一学生 — 应幂等或报错
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

const LOG_FILE = path.join(__dirname, 'r7-output.log')
try { fs.writeFileSync(LOG_FILE, '') } catch {}
function logProgress(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`
  process.stdout.write(line)
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
}

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find(t => t.type === 'page')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(r => this.ws.on('open', r))
    this.id = 0; this.pending = new Map()
    this.ws.on('message', msg => {
      const obj = JSON.parse(msg)
      if (obj.id && this.pending.has(obj.id)) {
        const { resolve, reject } = this.pending.get(obj.id)
        this.pending.delete(obj.id)
        if (obj.error) reject(new Error(JSON.stringify(obj.error)))
        else resolve(obj.result)
      }
    })
  }
  async send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  async callApi(p, ...args) {
    return this.eval(`(async () => {
      const parts = ${JSON.stringify(p)}.split('.')
      let obj = window.api
      for (const x of parts) obj = obj[x]
      const a = ${JSON.stringify(args)}
      try { return await obj(...a) } catch(e) { return { __error: e.message } }
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

const stats = { total: 0, pass: 0, fail: 0, errors: [] }
function record(name, ok, detail = '') {
  stats.total++
  if (ok) stats.pass++
  else { stats.fail++; stats.errors.push({ name, detail: String(detail).slice(0, 250) }) }
  logProgress(`  ${ok ? 'OK' : 'FAIL'}: ${name}${detail ? ' :: ' + String(detail).slice(0, 150) : ''}`)
}

async function getInfo(c) {
  const r = await c.callApi('eaa.info')
  return r?.data?.students
}
async function listStudents(c) {
  const r = await c.callApi('eaa.listStudents')
  return r?.data?.students || []
}
async function studentExists(c, name) {
  const list = await listStudents(c)
  return list.some(s => s.name === name)
}

async function main() {
  logProgress('============================================================')
  logProgress('ROUND 7 (R7): 软删除学生计数验证')
  logProgress('============================================================')

  const c = new CDPClient()
  await c.connect()

  // ============================================================
  // [1] 初始状态
  // ============================================================
  logProgress('\n[1] 初始状态')
  const initialInfoCount = await getInfo(c)
  const initialListCount = (await listStudents(c)).length
  logProgress(`  info.students = ${initialInfoCount}`)
  logProgress(`  listStudents.length = ${initialListCount}`)
  // 两者应该相等 (都是当前活跃学生数)
  // 注意: 如果初始就不一致,说明历史软删除数据有出入
  const initialConsistent = initialInfoCount === initialListCount
  record('initial_consistency', initialConsistent, `info=${initialInfoCount}, list=${initialListCount}`)

  // ============================================================
  // [2] 创建测试学生
  // ============================================================
  logProgress('\n[2] 创建测试学生')
  const testStu = `R7Test_${Date.now()}`
  const createRes = await c.callApi('eaa.addStudent', testStu)
  record('create_student', createRes?.success === true, JSON.stringify(createRes).slice(0, 100))

  const afterCreateInfoCount = await getInfo(c)
  const afterCreateListCount = (await listStudents(c)).length
  const afterCreateExists = await studentExists(c, testStu)
  logProgress(`  info.students = ${afterCreateInfoCount} (预期 ${initialInfoCount + 1})`)
  logProgress(`  listStudents.length = ${afterCreateListCount} (预期 ${initialListCount + 1})`)
  logProgress(`  student in list = ${afterCreateExists}`)
  record('after_create_info_incremented', afterCreateInfoCount === initialInfoCount + 1, `${initialInfoCount} → ${afterCreateInfoCount}`)
  record('after_create_list_incremented', afterCreateListCount === initialListCount + 1, `${initialListCount} → ${afterCreateListCount}`)
  record('after_create_student_in_list', afterCreateExists === true)

  // ============================================================
  // [3] deleteStudent 预览模式 — preload 强制 confirm:true,无法测预览
  // ============================================================
  logProgress('\n[3] deleteStudent 预览模式 (preload 强制 confirm:true,不可达)')
  // preload 签名: deleteStudent(name, reason?) 总是传 { confirm: true, reason }
  // 所以预览模式从渲染进程不可达 — 这是设计行为
  // 跳过此测试,记录设计事实
  record('preview_unreachable_by_design', true, 'preload always sets confirm:true')

  // 用错误签名 (object 作为 reason) 应被 sanitizeName 拒绝
  const badReasonRes = await c.callApi('eaa.deleteStudent', testStu, { notAString: true })
  logProgress(`  bad reason result: ${JSON.stringify(badReasonRes).slice(0, 200)}`)
  const badReasonRejected = badReasonRes?.__error || badReasonRes?.success === false
  record('bad_reason_rejected', badReasonRejected, JSON.stringify(badReasonRes).slice(0, 150))

  const afterPreviewInfoCount = await getInfo(c)
  const afterPreviewListCount = (await listStudents(c)).length
  const afterPreviewExists = await studentExists(c, testStu)
  logProgress(`  info.students = ${afterPreviewInfoCount} (应保持 ${afterCreateInfoCount})`)
  logProgress(`  listStudents.length = ${afterPreviewListCount} (应保持 ${afterCreateListCount})`)
  record('bad_reason_no_delete_info', afterPreviewInfoCount === afterCreateInfoCount, `${afterCreateInfoCount} → ${afterPreviewInfoCount}`)
  record('bad_reason_no_delete_list', afterPreviewListCount === afterCreateListCount, `${afterCreateListCount} → ${afterPreviewListCount}`)
  record('bad_reason_student_still_in_list', afterPreviewExists === true)

  // ============================================================
  // [4] deleteStudent 实际删除 (preload 会自动传 confirm:true)
  // ============================================================
  logProgress('\n[4] deleteStudent 实际删除 (preload 自动 confirm:true)')
  // 正确签名: deleteStudent(name, reasonString)
  const deleteRes = await c.callApi('eaa.deleteStudent', testStu, 'R7测试删除')
  logProgress(`  delete result: ${JSON.stringify(deleteRes).slice(0, 200)}`)
  record('delete_success', deleteRes?.success === true, JSON.stringify(deleteRes).slice(0, 150))

  const afterDeleteInfoCount = await getInfo(c)
  const afterDeleteListCount = (await listStudents(c)).length
  const afterDeleteExists = await studentExists(c, testStu)
  logProgress(`  info.students = ${afterDeleteInfoCount} (预期回到 ${initialInfoCount})`)
  logProgress(`  listStudents.length = ${afterDeleteListCount} (预期回到 ${initialListCount})`)
  logProgress(`  student in list = ${afterDeleteExists} (预期 false)`)
  record('after_delete_info_decremented', afterDeleteInfoCount === initialInfoCount, `${initialInfoCount} → ${afterCreateInfoCount} → ${afterDeleteInfoCount}`)
  record('after_delete_list_decremented', afterDeleteListCount === initialListCount, `${initialListCount} → ${afterCreateListCount} → ${afterDeleteListCount}`)
  record('after_delete_student_removed', afterDeleteExists === false)

  // 关键: info 与 list 是否一致
  const afterDeleteConsistent = afterDeleteInfoCount === afterDeleteListCount
  record('after_delete_consistency', afterDeleteConsistent, `info=${afterDeleteInfoCount}, list=${afterDeleteListCount}`)

  // ============================================================
  // [5] 重复删除同一学生 (应幂等失败)
  // ============================================================
  logProgress('\n[5] 重复删除同一学生')
  const redeleteRes = await c.callApi('eaa.deleteStudent', testStu, 'R7重复')
  logProgress(`  redelete result: ${JSON.stringify(redeleteRes).slice(0, 200)}`)
  // 期望: 失败 (学生不存在)
  const redeleteRejected = redeleteRes?.success === false || redeleteRes?.__error
  record('redelete_rejected', redeleteRejected, JSON.stringify(redeleteRes).slice(0, 150))

  // ============================================================
  // [6] 删除不存在的学生
  // ============================================================
  logProgress('\n[6] 删除不存在的学生')
  const ghostRes = await c.callApi('eaa.deleteStudent', 'R7_NonExistent_' + Date.now(), 'R7不存在')
  logProgress(`  ghost delete: ${JSON.stringify(ghostRes).slice(0, 200)}`)
  const ghostRejected = ghostRes?.success === false || ghostRes?.__error
  record('ghost_delete_rejected', ghostRejected, JSON.stringify(ghostRes).slice(0, 150))

  // ============================================================
  // [7] 最终一致性
  // ============================================================
  logProgress('\n[7] 最终一致性')
  const finalInfoCount = await getInfo(c)
  const finalListCount = (await listStudents(c)).length
  logProgress(`  final info.students = ${finalInfoCount}`)
  logProgress(`  final listStudents.length = ${finalListCount}`)
  const finalConsistent = finalInfoCount === finalListCount
  record('final_consistency', finalConsistent, `info=${finalInfoCount}, list=${finalListCount}`)
  const returnedToInitial = finalInfoCount === initialInfoCount && finalListCount === initialListCount
  record('returned_to_initial', returnedToInitial, `initial=${initialInfoCount}, final_info=${finalInfoCount}, final_list=${finalListCount}`)

  // ============================================================
  // 汇总
  // ============================================================
  logProgress('\n============================================================')
  logProgress('R7 SUMMARY')
  logProgress('============================================================')
  logProgress(`Total: ${stats.total}, Pass: ${stats.pass}, Fail: ${stats.fail}`)
  logProgress(`Initial: info=${initialInfoCount}, list=${initialListCount}`)
  logProgress(`Final:   info=${finalInfoCount}, list=${finalListCount}`)
  if (stats.errors.length > 0) {
    logProgress(`Failures:`)
    for (const e of stats.errors) {
      logProgress(`  ${e.name}: ${e.detail}`)
    }
  }

  // 结论
  logProgress('\n结论:')
  if (!initialConsistent) {
    logProgress('  ⚠️ 初始状态 info 与 list 不一致 — 可能是历史软删除残留 (软删除学生仍被一方计入)')
  } else {
    logProgress('  ✓ 初始状态 info 与 list 一致')
  }
  if (afterDeleteInfoCount === initialInfoCount && afterDeleteListCount === initialListCount) {
    logProgress('  ✓ 删除学生后 info/list 都正确减少 — 软删除不影响计数 (硬删除行为)')
  } else {
    logProgress('  ⚠️ 删除学生后 info/list 未正确减少 — 可能存在软删除残留问题')
  }

  try {
    fs.writeFileSync(path.join(__dirname, 'r7-results.json'), JSON.stringify({
      ...stats,
      initial: { info: initialInfoCount, list: initialListCount },
      afterCreate: { info: afterCreateInfoCount, list: afterCreateListCount },
      afterDelete: { info: afterDeleteInfoCount, list: afterDeleteListCount },
      final: { info: finalInfoCount, list: finalListCount },
    }, null, 2))
  } catch {}

  c.close()
}

main().catch(e => { logProgress('FATAL: ' + e.message); logProgress(e.stack || ''); process.exit(1) })
