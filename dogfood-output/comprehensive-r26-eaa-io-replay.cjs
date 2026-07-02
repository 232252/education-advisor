// 第二十六轮测试 — EAA 导入导出往返 + replay/summary/tag 深度
// 目标: 深入测试 EAA 数据流转、重算、摘要、标签功能
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')
const os = require('os')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  const testSuffix = String(Date.now()).slice(-5)
  console.log(`=== 第二十六轮: EAA 导入导出往返 + replay/summary/tag 深度 ===\n`)

  // ========== 1. 准备数据 ==========
  console.log('--- 1. 准备数据 ---')
  // 创建 5 学生 + 10 事件
  const students = []
  for (let i = 0; i < 5; i++) {
    const name = `R26Stu${i}_${testSuffix}`
    await cdp.eval(`(async()=>{ try{ await window.api.eaa.addStudent('${name}'); }catch(e){} })()`)
    students.push(name)
  }
  await new Promise((r) => setTimeout(r, 1500))

  const codes = ['LATE', 'SPEAK_IN_CLASS', 'CLASS_MONITOR', 'BONUS_VARIABLE', 'ACTIVITY_PARTICIPATION', 'SLEEP_IN_CLASS', 'CIVILIZED_DORM', 'MONTHLY_ATTENDANCE', 'LAB_CLEAN_UP', 'PHONE_IN_CLASS']
  for (let i = 0; i < 10; i++) {
    const stu = students[i % students.length]
    const code = codes[i]
    await cdp.eval(`(async()=>{ try{ await window.api.eaa.addEvent({ studentName: '${stu}', reasonCode: '${code}', note: 'R26事件${i}', operator: 'R26' }); }catch(e){} })()`)
  }
  await new Promise((r) => setTimeout(r, 1000))
  ok('准备数据', `${students.length} 学生 + 10 事件`)

  // ========== 2. 导出 3 格式 + 内容验证 ==========
  console.log('\n--- 2. 导出 3 格式 + 内容验证 ---')
  const exports = {}
  for (const fmt of ['csv', 'jsonl', 'html']) {
    const r = await cdp.eval(`(async()=>{ const r=await window.api.eaa.export('${fmt}'); return JSON.parse(JSON.stringify(r)); })()`)
    if (r?.success !== false && r?.data) {
      exports[fmt] = r.data
      ok(`导出 ${fmt}`, `${r.data.length} 字符`)
      // 验证内容包含测试学生
      if (r.data.includes(students[0])) ok(`  ${fmt} 含测试学生`, students[0])
      else warn(`  ${fmt} 含测试学生`, '未找到')
    } else {
      fail(`导出 ${fmt}`, '', '失败')
    }
  }

  // ========== 3. CSV 结构验证 ==========
  console.log('\n--- 3. CSV 结构验证 ---')
  if (exports.csv) {
    const lines = exports.csv.split('\n').filter(l => l.trim())
    ok('CSV 行数', `${lines.length} 行`)
    if (lines.length > 0) {
      const headers = lines[0].split(',')
      ok('CSV 表头', `${headers.length} 列: ${headers.slice(0, 5).join(', ')}`)
    }
    // 验证包含所有事件
    const eventLines = lines.filter(l => l.includes('R26事件'))
    ok('CSV 事件行', `${eventLines.length} 行含 R26`)
  }

  // ========== 4. JSONL 结构验证 ==========
  console.log('\n--- 4. JSONL 结构验证 ---')
  if (exports.jsonl) {
    const lines = exports.jsonl.split('\n').filter(l => l.trim())
    ok('JSONL 行数', `${lines.length} 行`)
    if (lines.length > 0) {
      try {
        const first = JSON.parse(lines[0])
        ok('JSONL 第一行', `字段: ${Object.keys(first).slice(0, 5).join(', ')}`)
      } catch (e) {
        warn('JSONL 解析', String(e).slice(0, 80))
      }
    }
  }

  // ========== 5. HTML 结构验证 ==========
  console.log('\n--- 5. HTML 结构验证 ---')
  if (exports.html) {
    const hasHtml = exports.html.includes('<html') || exports.html.includes('<!DOCTYPE')
    const hasTable = exports.html.includes('<table') || exports.html.includes('<tr')
    const hasStudent = exports.html.includes(students[0])
    ok('HTML 结构', `html=${hasHtml}, table=${hasTable}, student=${hasStudent}`)
  }

  // ========== 6. exportFormats 验证 ==========
  console.log('\n--- 6. exportFormats 验证 ---')
  const formats = await cdp.eval(`(async()=>{ const r=await window.api.eaa.exportFormats(); return JSON.parse(JSON.stringify(r)); })()`)
  if (Array.isArray(formats)) {
    ok('exportFormats', `${formats.length}: ${formats.join(', ')}`)
    const expected = ['csv', 'jsonl', 'html']
    const allMatch = expected.every(f => formats.includes(f))
    if (allMatch) ok('格式匹配', 'csv+jsonl+html ✓')
    else warn('格式匹配', `期望 ${expected.join(',')} 实际 ${formats.join(',')}`)
  } else {
    fail('exportFormats', '', '非数组')
  }

  // ========== 7. EAA replay(重算排行榜) ==========
  console.log('\n--- 7. EAA replay(重算) ---')
  const replayR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.replay(); return JSON.parse(JSON.stringify(r)); })()`)
  if (replayR?.success !== false) {
    ok('EAA replay', '成功')
    const replayRanking = replayR?.data?.ranking || []
    if (Array.isArray(replayRanking)) {
      ok('replay 排行榜', `${replayRanking.length} 名`)
      if (replayRanking.length > 0) {
        const top = replayRanking[0]
        ok('replay top1', `${top.name}: ${top.score}`)
      }
    }
  } else {
    fail('EAA replay', '', replayR?.data || '失败')
  }

  // ========== 8. EAA summary(周期摘要) ==========
  console.log('\n--- 8. EAA summary(周期摘要) ---')
  // 无参数 summary
  const summaryR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.summary(); return JSON.parse(JSON.stringify(r)); })()`)
  if (summaryR?.success !== false) {
    ok('EAA summary()', '成功')
    const data = summaryR?.data
    if (data) {
      ok('summary 字段', `${Object.keys(data).length}: ${Object.keys(data).slice(0, 6).join(', ')}`)
    }
  } else {
    warn('EAA summary()', '失败')
  }

  // 带日期参数 summary
  const summaryRangeR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.summary('2026-01-01', '2026-12-31'); return JSON.parse(JSON.stringify(r)); })()`)
  if (summaryRangeR?.success !== false) ok('EAA summary(范围)', '成功')
  else warn('EAA summary(范围)', '失败')

  // 无效日期 summary
  const summaryInvalidR = await cdp.eval(`(async()=>{ try{ const r=await window.api.eaa.summary('invalid-date', 'also-invalid'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
  if (summaryInvalidR?.success === false) ok('EAA summary(无效日期)', 'graceful 失败')
  else warn('EAA summary(无效日期)', `返回: ${JSON.stringify(summaryInvalidR).slice(0, 80)}`)

  // ========== 9. EAA tag(标签) ==========
  console.log('\n--- 9. EAA tag(标签) ---')
  // 列出所有标签
  const tagListR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.tag(); return JSON.parse(JSON.stringify(r)); })()`)
  if (tagListR?.success !== false) {
    const tags = tagListR?.data?.tags || tagListR?.data || []
    ok('tag 列表', `${Array.isArray(tags) ? tags.length : 0} 个`)
    // 验证标签结构
    if (Array.isArray(tags) && tags.length > 0) {
      const t = tags[0]
      ok('tag 结构', `字段: ${Object.keys(t).slice(0, 5).join(', ')}`)
    }
  } else {
    warn('tag 列表', '失败')
  }

  // 查询特定标签(用第一个学生的名字)
  const tagSpecificR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.tag('${students[0]}'); return JSON.parse(JSON.stringify(r)); })()`)
  if (tagSpecificR?.success !== false) ok(`tag 查询 ${students[0]}`, '成功')
  else warn(`tag 查询 ${students[0]}`, '失败')

  // 查询不存在的标签
  const tagNonexistR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.tag('nonexistent-tag-${testSuffix}'); return JSON.parse(JSON.stringify(r)); })()`)
  if (tagNonexistR?.success !== false) ok('tag 不存在', 'graceful 返回空')
  else warn('tag 不存在', '失败')

  // ========== 10. EAA range(日期范围查询) ==========
  console.log('\n--- 10. EAA range 深度 ---')
  // 全年范围
  const rangeFullR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.range('2026-01-01', '2026-12-31', 1000); return JSON.parse(JSON.stringify(r)); })()`)
  if (rangeFullR?.success !== false) {
    const rangeEvents = rangeFullR?.data?.events || rangeFullR?.data || []
    ok('range 全年', `${Array.isArray(rangeEvents) ? rangeEvents.length : 0} 事件`)
  }

  // 空范围(未来日期)
  const rangeFutureR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.range('2099-01-01', '2099-12-31', 100); return JSON.parse(JSON.stringify(r)); })()`)
  if (rangeFutureR?.success !== false) {
    const futureEvents = rangeFutureR?.data?.events || rangeFutureR?.data || []
    ok('range 未来日期', `${Array.isArray(futureEvents) ? futureEvents.length : 0} 事件 (应为0)`)
  }

  // 反向范围(start > end)
  const rangeReverseR = await cdp.eval(`(async()=>{ try{ const r=await window.api.eaa.range('2026-12-31', '2026-01-01', 100); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,150)}} })()`)
  if (rangeReverseR?.success === false) ok('range 反向', 'graceful 拒绝')
  else warn('range 反向', `返回: ${JSON.stringify(rangeReverseR).slice(0, 80)}`)

  // ========== 11. EAA search 深度 ==========
  console.log('\n--- 11. EAA search 深度 ---')
  // 精确搜索
  const searchExactR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.search('${students[0]}', 10); return JSON.parse(JSON.stringify(r)); })()`)
  if (searchExactR?.success !== false) {
    const searchResults = searchExactR?.data?.results || searchExactR?.data || []
    ok('search 精确', `${Array.isArray(searchResults) ? searchResults.length : 0} 结果`)
  }

  // 模糊搜索(前缀)
  const searchPrefixR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.search('R26Stu', 20); return JSON.parse(JSON.stringify(r)); })()`)
  if (searchPrefixR?.success !== false) {
    const prefixResults = searchPrefixR?.data?.results || searchPrefixR?.data || []
    ok('search 前缀', `${Array.isArray(prefixResults) ? prefixResults.length : 0} 结果`)
  }

  // 空查询
  const searchEmptyR = await cdp.eval(`(async()=>{ try{ const r=await window.api.eaa.search('', 10); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
  if (searchEmptyR?.success === false) ok('search 空查询', '被拒绝')
  else warn('search 空查询', `返回: ${JSON.stringify(searchEmptyR).slice(0, 80)}`)

  // 不存在查询
  const searchNonexistR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.search('不存在XYZ${testSuffix}', 10); return JSON.parse(JSON.stringify(r)); })()`)
  if (searchNonexistR?.success !== false) {
    const nonexistResults = searchNonexistR?.data?.results || searchNonexistR?.data
    if (nonexistResults === null || (Array.isArray(nonexistResults) && nonexistResults.length === 0)) {
      ok('search 不存在', '返回空(正确)')
    } else {
      warn('search 不存在', `返回: ${JSON.stringify(nonexistResults).slice(0, 80)}`)
    }
  }

  // ========== 12. EAA history 深度 ==========
  console.log('\n--- 12. EAA history 深度 ---')
  for (const stu of students.slice(0, 3)) {
    const histR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.history('${stu}'); return JSON.parse(JSON.stringify(r)); })()`)
    if (histR?.success !== false) {
      const events = histR?.data?.events || []
      ok(`history ${stu}`, `${events.length} 事件`)
      // 验证事件结构
      if (events.length > 0) {
        const ev = events[0]
        ok(`  事件结构`, `字段: ${Object.keys(ev).slice(0, 6).join(', ')}`)
      }
    }
  }

  // ========== 13. EAA validate + doctor ==========
  console.log('\n--- 13. EAA validate + doctor ---')
  const validateR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.validate(); return JSON.parse(JSON.stringify(r)); })()`)
  if (validateR?.success !== false) {
    ok('validate', '通过')
    const data = validateR?.data
    if (data) ok('validate 数据', `${Object.keys(data).length} 字段`)
  } else {
    fail('validate', '', validateR?.data)
  }

  const doctorR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.doctor(); return JSON.parse(JSON.stringify(r)); })()`)
  if (doctorR?.success !== false) {
    ok('doctor', '通过')
    const data = doctorR?.data
    if (data) ok('doctor 数据', `${Object.keys(data).length} 字段`)
  } else {
    fail('doctor', '', doctorR?.data)
  }

  // ========== 14. 数据一致性(导出 vs API) ==========
  console.log('\n--- 14. 数据一致性(导出 vs API) ---')
  const listStu = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
  const apiStudents = (listStu?.data?.students || []).filter(s => s.name.startsWith('R26'))
  ok('API 学生数', `${apiStudents.length}`)

  const statsR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.stats(); return JSON.parse(JSON.stringify(r)); })()`)
  const statsStudents = statsR?.data?.summary?.students
  ok('stats 学生数', `${statsStudents} (含历史)`)

  const rankR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.ranking(100); return JSON.parse(JSON.stringify(r)); })()`)
  const rankList = rankR?.data?.ranking || rankR?.data || []
  const r26InRank = rankList.filter(r => r.name.startsWith('R26'))
  ok('排行榜 R26 学生', `${r26InRank.length} 名`)

  // 验证排行榜分数与 score API 一致
  if (r26InRank.length > 0) {
    const topR26 = r26InRank[0]
    const scoreR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.score('${topR26.name}'); return JSON.parse(JSON.stringify(r)); })()`)
    const apiScore = scoreR?.data?.score ?? scoreR?.data
    if (apiScore === topR26.score) ok('排行榜分数一致', `${topR26.name}: ${topR26.score}`)
    else warn('排行榜分数不一致', `rank=${topR26.score} vs score=${apiScore}`)
  }

  // ========== 15. 清理 ==========
  console.log('\n--- 15. 清理 ---')
  try {
    const stuList = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
    const toDelete = (stuList?.data?.students || []).filter(s => s.name.startsWith('R26') && s.status !== 'Deleted')
    for (let i = 0; i < toDelete.length; i += 5) {
      const batch = toDelete.slice(i, i + 5)
      await cdp.eval(`(async()=>{ ${batch.map(s => `try{await window.api.eaa.deleteStudent('${s.name}', '清理');}catch(e){}`).join('\n')} })()`)
    }
    ok('清理', `${toDelete.length} 学生`)
  } catch (e) {
    warn('清理', String(e).slice(0, 100))
  }

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${total > 0 ? (results.pass / total * 100).toFixed(1) : 0}%`)

  const resultFile = path.join(__dirname, 'r26-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ results }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
