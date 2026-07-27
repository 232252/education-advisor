// 危险操作: 清理测试脏数据
// ⚠️ 此脚本会软删除所有匹配测试模式的"学生"记录
// ⚠️ 运行前请确认你的真实学生命名不匹配这些模式
// ⚠️ 软删除 (status=Deleted),数据仍在磁盘上,可恢复
//
// 用法:
//   node scripts/cleanup_test_data.mjs --dry-run   # 仅统计,不删
//   node scripts/cleanup_test_data.mjs --apply      # 实际软删
//
// 匹配模式 (任一命中即视为测试数据):
//   - r21_stress_, r25_single_, r27_conA_, r27_conB_, r28_bulk_, r24_trend_,
//     r26_conflict_, r20_wr_ (各轮压测脚本命名)
//   - R35批量, R35并发, R33Bulk, R36NoDedup (中文测试名)
//   - r39b (R39 大数据量压测,1000 条)
//   - rXX_<时间戳> 模式 (压测脚本通用命名)
//   - stress_, test_, _test (通用测试前缀)
//   - R<数字> 开头但不含中文 (R35/R36 等英文测试)
import { Cdp } from './_cdp_lib.mjs'

const args = new Set(process.argv.slice(2))
const DRY_RUN = !args.has('--apply')
const TAG = `Cleanup_${Date.now()}`

const TEST_PATTERNS = [
  /^r\d+[_-]\d+$/,            // r21_stress_123, r25_single_456
  /^r\d+[A-Z]?[_-]/i,          // r21stress, r27conA
  /^r39b/i,                    // R39 大批量
  /^R35(批量|并发|元数据|学生|恢复)/,           // 中文测试名
  /^R36(传递|日常|班主任|班级A|班级B|纪律|错误|预警)/,
  /^R33Bulk/i,
  /^R36NoDedup/i,
  /^(R22RW|R22Write|DeepTest|stressTest|Deep)/,
  /^(stress|test|tmp|debug)_/i,
  /^test-/i,
  /_test$/i,
  /^R\d{2}[A-Z]?[-_]/,        // R35-xxx, R36b-xxx (英文测试)
  /^Cmp\d+_stu[A-Z]/i,        // 班级对比测试
  /^student_\d+$/i,
  /_\d{13}([_-]\d+)?$/,        // 13 位时间戳结尾 (压测脚本通用)
]

async function main() {
  console.log(`mode: ${DRY_RUN ? '🔍 DRY-RUN (不删除,加 --apply 实际执行)' : '🔴 APPLY (将软删)'}`)
  const cdp = await Cdp.connect()

  const r = await cdp.callAPI('eaa', 'listStudents')
  const arr = r?.data?.students || []
  console.log(`total students: ${arr.length}`)

  const dirty = arr.filter((s) => TEST_PATTERNS.some((re) => re.test(s.name)))
  const activeDirty = dirty.filter((s) => s.status === 'Active')
  console.log(`matched test pattern: ${dirty.length} (Active=${activeDirty.length})`)

  // 按模式分组
  const byPat = {}
  for (const s of dirty) {
    const matched = TEST_PATTERNS.find((re) => re.test(s.name))
    const key = matched ? matched.toString() : '?'
    byPat[key] = (byPat[key] || 0) + 1
  }
  console.log('\nby pattern:')
  for (const [k, v] of Object.entries(byPat)) console.log(`  ${v.toString().padStart(5)}  ${k}`)

  if (DRY_RUN) {
    console.log(`\n样本 (前 10):`)
    for (const s of dirty.slice(0, 10)) console.log(`  ${s.name.padEnd(30)} status=${s.status} score=${s.score}`)
    console.log(`\n⚠️ 这是 DRY-RUN,未删除任何数据。加 --apply 实际执行软删。`)
    cdp.ws.close()
    process.exit(0)
  }

  // 实际软删
  console.log(`\n开始软删 ${dirty.length} 条...`)
  let ok = 0, fail = 0
  const errors = []
  for (let i = 0; i < dirty.length; i++) {
    const s = dirty[i]
    try {
      const r = await cdp.callAPI('eaa', 'deleteStudent', s.name, `cleanup test data ${TAG}`)
      if (r?.success !== false) ok++
      else { fail++; if (errors.length < 5) errors.push(`${s.name}: ${JSON.stringify(r).slice(0, 80)}`) }
    } catch (e) {
      fail++
      if (errors.length < 5) errors.push(`${s.name}: ${e.message.slice(0, 80)}`)
    }
    if ((i + 1) % 50 === 0) process.stdout.write(`\r  ${i + 1}/${dirty.length} (ok=${ok}, fail=${fail})`)
  }
  console.log(`\n\n结果: ok=${ok} fail=${fail} total=${dirty.length}`)
  if (errors.length) {
    console.log('错误样本:')
    for (const e of errors) console.log(`  ${e}`)
  }

  cdp.ws.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(2) })
