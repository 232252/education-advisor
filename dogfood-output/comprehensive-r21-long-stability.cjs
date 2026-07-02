// 第二十一轮测试 — 5分钟超长时间稳定性测试
// 目标: 持续混合操作,监控内存泄漏、错误累积、性能退化
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

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
  async navigate(p, wait = 800) {
    await this.eval(`window.location.hash='${p}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

const surnames = '赵钱孙李周吴郑王冯陈'
const givenNames = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋']
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function pick(arr) { return arr[rand(0, arr.length - 1)] }
function genName() { return pick(surnames.split('')) + pick(givenNames) + rand(1, 99) }

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  const testSuffix = String(Date.now()).slice(-5)
  console.log(`=== 第二十一轮: 5分钟超长时间稳定性测试 ===\n`)

  // ========== 0. 初始化:注入 console 错误监控 ==========
  await cdp.eval(`(function(){ window.__consoleErrors = []; const orig=console.error; console.error=function(){ window.__consoleErrors.push(Array.from(arguments).map(a=>String(a)).join(' ').slice(0,200)); orig.apply(console,arguments); }; })()`)

  // ========== 1. 准备测试数据 ==========
  console.log('--- 1. 准备测试数据 ---')
  const className = `R21Stab-${testSuffix}`
  const classId = `R21S-${testSuffix}`
  await cdp.eval(`(async()=>{ await window.api.class.create({ class_id: '${classId}', name: '${className}', grade: '九年级', teacher: '稳定性师' }); })()`)

  // 创建 20 个学生
  const students = []
  for (let i = 0; i < 20; i++) {
    const name = `R21Stu${i}_${testSuffix}`
    await cdp.eval(`(async()=>{ try{ await window.api.eaa.addStudent('${name}'); }catch(e){} })()`)
    students.push(name)
  }
  await cdp.eval(`(async()=>{ await window.api.class.assign({ class_id: '${classId}', student_names: ${JSON.stringify(students)} }); })()`)
  await new Promise((r) => setTimeout(r, 2000))
  ok('准备数据', `${students.length} 学生 + 1 班级`)

  // ========== 2. 5分钟混合操作 ==========
  console.log('\n--- 2. 5分钟混合操作 ---')
  const DURATION_MS = 5 * 60 * 1000  // 5 分钟
  const startTime = Date.now()
  let opCount = 0
  let errorCount = 0
  const memSamples = []
  const opStats = { navigate: 0, addEvent: 0, score: 0, ranking: 0, listStudents: 0, stats: 0, search: 0, history: 0, export: 0 }
  const pages = ['/dashboard', '/students', '/classes', '/chat', '/settings', '/agents', '/skills', '/privacy', '/logs', '/about']

  let lastReport = Date.now()
  const reasonCodes = ['SPEAK_IN_CLASS', 'LATE', 'BONUS_VARIABLE', 'CLASS_MONITOR', 'ACTIVITY_PARTICIPATION', 'SLEEP_IN_CLASS', 'CIVILIZED_DORM', 'LAB_CLEAN_UP']

  while (Date.now() - startTime < DURATION_MS) {
    const op = rand(0, 9)
    try {
      switch (op) {
        case 0: { // 页面切换
          const p = pick(pages)
          await cdp.navigate(p, 500)
          opStats.navigate++
          break
        }
        case 1: { // 添加事件
          const stu = pick(students)
          const code = pick(reasonCodes)
          await cdp.eval(`(async()=>{ try{ await window.api.eaa.addEvent({ studentName: '${stu}', reasonCode: '${code}', note: 'R21稳定性', operator: 'R21' }); }catch(e){} })()`)
          opStats.addEvent++
          break
        }
        case 2: { // 查询分数
          const stu = pick(students)
          await cdp.eval(`(async()=>{ try{ await window.api.eaa.score('${stu}'); }catch(e){} })()`)
          opStats.score++
          break
        }
        case 3: { // 排行榜
          await cdp.eval(`(async()=>{ try{ await window.api.eaa.ranking(50); }catch(e){} })()`)
          opStats.ranking++
          break
        }
        case 4: { // listStudents
          await cdp.eval(`(async()=>{ try{ await window.api.eaa.listStudents(); }catch(e){} })()`)
          opStats.listStudents++
          break
        }
        case 5: { // stats
          await cdp.eval(`(async()=>{ try{ await window.api.eaa.stats(); }catch(e){} })()`)
          opStats.stats++
          break
        }
        case 6: { // search
          const q = pick(students).slice(0, 3)
          await cdp.eval(`(async()=>{ try{ await window.api.eaa.search('${q}', 10); }catch(e){} })()`)
          opStats.search++
          break
        }
        case 7: { // history
          const stu = pick(students)
          await cdp.eval(`(async()=>{ try{ await window.api.eaa.history('${stu}'); }catch(e){} })()`)
          opStats.history++
          break
        }
        case 8: { // export
          const fmt = pick(['csv', 'jsonl', 'html'])
          await cdp.eval(`(async()=>{ try{ await window.api.eaa.export('${fmt}'); }catch(e){} })()`)
          opStats.export++
          break
        }
        case 9: { // 内存采样
          const mem = await cdp.eval(`(function(){ if(performance && performance.memory){ return Math.round(performance.memory.usedJSHeapSize/1024/1024); } return null; })()`)
          if (mem) memSamples.push(mem)
          break
        }
      }
      opCount++
    } catch (e) {
      errorCount++
    }

    // 每 30 秒报告一次
    if (Date.now() - lastReport > 30000) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
      const mem = memSamples[memSamples.length - 1] ?? '?'
      console.log(`  [${elapsed}s] ops=${opCount}, errors=${errorCount}, mem=${mem}MB`)
      lastReport = Date.now()
    }
  }

  // ========== 3. 分析结果 ==========
  console.log('\n--- 3. 分析结果 ---')

  // 总操作数
  ok('总操作数', `${opCount} 次, ${errorCount} 错误`)
  if (errorCount === 0) ok('错误率', '0%')
  else warn('错误率', `${(errorCount / opCount * 100).toFixed(2)}%`)

  // 操作分布
  const opDist = Object.entries(opStats).map(([k, v]) => `${k}:${v}`).join(', ')
  ok('操作分布', opDist)

  // 内存分析
  if (memSamples.length >= 5) {
    const firstMem = memSamples[0]
    const lastMem = memSamples[memSamples.length - 1]
    const maxMem = Math.max(...memSamples)
    const minMem = Math.min(...memSamples)
    const delta = lastMem - firstMem
    ok('内存采样', `${memSamples.length} 点: ${minMem}-${maxMem} MB, delta ${delta >= 0 ? '+' : ''}${delta} MB`)
    if (Math.abs(delta) <= 5) ok('内存泄漏', `无显著泄漏 (delta ${delta} MB)`)
    else if (delta > 5) warn('内存泄漏', `可能泄漏 (+${delta} MB)`)
    else ok('内存趋势', `内存下降 (${delta} MB, GC 工作)`)
  } else {
    warn('内存采样', `仅 ${memSamples.length} 点`)
  }

  // console 错误
  const consoleErrors = await cdp.eval(`(window.__consoleErrors || []).length`)
  if (consoleErrors === 0) ok('console 错误', '0 个')
  else {
    warn('console 错误', `${consoleErrors} 个`)
    const sampleErrors = await cdp.eval(`(window.__consoleErrors || []).slice(0, 3)`)
    if (Array.isArray(sampleErrors)) {
      sampleErrors.forEach((e, i) => console.log(`    [${i+1}] ${String(e).slice(0, 150)}`))
    }
  }

  // ========== 4. 系统完整性 ==========
  console.log('\n--- 4. 系统完整性 ---')

  // EAA validate + doctor
  const validateR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.validate(); return JSON.parse(JSON.stringify(r)); })()`)
  if (validateR?.success !== false) ok('EAA validate', '通过')
  else fail('EAA validate', '', validateR?.data)

  const doctorR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.doctor(); return JSON.parse(JSON.stringify(r)); })()`)
  if (doctorR?.success !== false) ok('EAA doctor', '通过')
  else fail('EAA doctor', '', doctorR?.data)

  // 最终 UI 渲染正常
  await cdp.navigate('/dashboard', 1500)
  const dashBody = await cdp.eval(`document.body.innerText.length`)
  if (dashBody > 100) ok('最终仪表盘', `${dashBody} 字符`)
  else fail('最终仪表盘', '', '渲染异常')

  await cdp.navigate('/students', 1500)
  const stuRows = await cdp.eval(`document.querySelectorAll('table tbody tr, [class*="row"]').length`)
  ok('最终学生页', `${stuRows} 行`)

  // ========== 5. 清理 ==========
  console.log('\n--- 5. 清理 ---')
  try {
    // 删除班级
    const cls = await cdp.eval(`(async()=>{ const r=await window.api.class.list(); return JSON.parse(JSON.stringify(r)); })()`)
    const target = (cls?.data || []).find(c => c.class_id === classId)
    if (target) await cdp.eval(`(async()=>{ await window.api.class.delete('${target.id}'); })()`)

    // 删除学生(分批)
    for (let i = 0; i < students.length; i += 5) {
      const batch = students.slice(i, i + 5)
      await cdp.eval(`(async()=>{ ${batch.map(s => `try{await window.api.eaa.deleteStudent('${s}', '清理');}catch(e){}`).join('\n')} })()`)
    }
    ok('清理', `${students.length} 学生 + 1 班级`)
  } catch (e) {
    warn('清理', String(e).slice(0, 100))
  }

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${total > 0 ? (results.pass / total * 100).toFixed(1) : 0}%`)
  console.log(`5分钟总操作: ${opCount}, 错误: ${errorCount}`)

  const resultFile = path.join(__dirname, 'r21-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ results, opStats, memSamples, opCount, errorCount }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
