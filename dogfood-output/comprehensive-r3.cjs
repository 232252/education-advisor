// 第三轮测试 — 真实用户场景模拟 (3班级+15学生+完整生命周期+UI交互)
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

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
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try { const m = JSON.parse(data.toString())
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  async function call(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      const p='${apiPath}'.split('.');
      let o=window.api;
      for(const x of p){if(o==null)return{__error:'no such api'};o=o[x]}
      if(typeof o!=='function')return{__error:'not a function'};
      const a=${JSON.stringify(args)};
      try{const r=await o(...a);return r}catch(e){return{__error:e.message}}
    })()`)
  }

  // 辅助: 从 EAA 返回值中提取错误信息
  function errMsg(r) {
    return r?.__error || r?.error || r?.stderr || (typeof r?.data === 'string' && !r?.success ? r.data : null) || 'unknown'
  }
  async function navigate(path, wait = 1500) {
    await cdp.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, wait))
  }

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  console.log('=== 第三轮: 真实用户场景模拟 ===\n')

  // ========== 阶段1: 创建3班级 ==========
  console.log('--- 阶段1: 创建3个真实班级 ---')
  const testClasses = [
    { class_id: 'G7-1', name: '七年级一班', grade: '七年级', teacher: '张老师', note: '重点班' },
    { class_id: 'G7-2', name: '七年级二班', grade: '七年级', teacher: '李老师', note: '普通班' },
    { class_id: 'G7-3', name: '七年级三班', grade: '七年级', teacher: '王老师', note: '普通班' },
  ]
  for (const tc of testClasses) {
    const res = await call('class.create', tc)
    if (res.success) ok(`创建 ${tc.class_id}`, tc.name)
    else fail(`创建 ${tc.class_id}`, '', res.error)
  }

  // ========== 阶段2: 创建15学生并分班 ==========
  console.log('\n--- 阶段2: 创建15学生并分班 ---')
  const surnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴']
  const givenNames = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋']
  const testSuffix = String(Date.now()).slice(-4)
  const studentNames = []
  for (let i = 0; i < 15; i++) {
    const sn = surnames[i % surnames.length]
    const gn = givenNames[i % givenNames.length]
    const name = `${sn}${gn}${i+1}_${testSuffix}` // 加序号+随机后缀避免重名
    studentNames.push(name)
    const res = await call('eaa.addStudent', name)
    if (!res.success) fail(`创建学生 ${name}`, '', errMsg(res))
  }
  ok('创建15学生', `${studentNames.length} 个`)

  // 分班 (每班5人)
  for (let ci = 0; ci < 3; ci++) {
    const targetClass = testClasses[ci]
    const batch = studentNames.slice(ci * 5, (ci + 1) * 5)
    const res = await call('class.assign', { class_id: targetClass.class_id, student_names: batch })
    if (res.success) ok(`分班 ${targetClass.name}`, `成功 ${res.assigned}/${batch.length}`)
    else fail(`分班 ${targetClass.name}`, '', res.error)
  }

  // ========== 阶段3: 验证班级页学生数 ==========
  console.log('\n--- 阶段3: 验证班级页学生数 ---')
  await navigate('/classes', 2000)
  // 等待 EAA 异步加载学生 (1.4s + 缓冲)
  await new Promise((r) => setTimeout(r, 2500))
  const classPageStu = await cdp.eval(`(function(){
    const tables = Array.from(document.querySelectorAll('table'));
    for(const t of tables){
      const ths = Array.from(t.querySelectorAll('th'));
      if(ths.some(th => th.textContent?.includes('学生数'))){
        const rows = Array.from(t.querySelectorAll('tbody tr'));
        return rows.map(r => {
          const tds = r.querySelectorAll('td');
          return { name: tds[1]?.textContent?.trim(), count: tds[4]?.textContent?.trim() };
        });
      }
    }
    return null;
  })()`)
  if (classPageStu && classPageStu.length === 3) {
    let allCorrect = true
    for (const c of classPageStu) {
      if (c.count === '5') ok(`${c.name} 学生数`, c.count)
      else { fail(`${c.name} 学生数`, `期望5, 实际${c.count}`); allCorrect = false }
    }
    if (allCorrect) ok('所有班级学生数', '全部正确')
  } else {
    fail('班级页学生数', '', JSON.stringify(classPageStu))
  }

  // ========== 阶段4: 班级页加载速度 ==========
  console.log('\n--- 阶段4: 班级页加载速度 ---')
  const tLoadStart = Date.now()
  await cdp.eval(`window.location.hash='/dashboard'`)
  await new Promise((r) => setTimeout(r, 500))
  await cdp.eval(`window.location.hash='/classes'`)
  let classLoaded = false
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 200))
    const hasRow = await cdp.eval(`document.querySelector('table tbody tr') !== null`)
    if (hasRow) { classLoaded = true; break }
  }
  const loadTime = Date.now() - tLoadStart
  if (classLoaded && loadTime < 3000) ok('班级页加载', `${loadTime}ms (< 3000ms)`)
  else if (classLoaded) warn('班级页加载', `${loadTime}ms (> 3000ms)`)
  else fail('班级页加载', '', '超时')

  // ========== 阶段5: 学生页班级筛选 ==========
  console.log('\n--- 阶段5: 学生页班级筛选 ---')
  await navigate('/students', 2500)
  const stuSelect = await cdp.eval(`(function(){
    const sels = Array.from(document.querySelectorAll('select'));
    const classSel = sels.find(s => Array.from(s.options).map(o=>o.value).includes('__ALL__'));
    if(!classSel) return null;
    return { count: classSel.options.length };
  })()`)
  if (stuSelect && stuSelect.count === 5) ok('学生页班级筛选', `${stuSelect.count} 个选项 (全部+未分班+3班)`)
  else fail('学生页班级筛选', '', JSON.stringify(stuSelect))

  // 切换到 G7-1
  await cdp.eval(`(function(){
    const sels = Array.from(document.querySelectorAll('select'));
    const classSel = sels.find(s => Array.from(s.options).map(o=>o.value).includes('__ALL__'));
    if(classSel){ classSel.value='G7-1'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
  })()`)
  await new Promise((r) => setTimeout(r, 1000))
  const g71Rows = await cdp.eval(`(function(){
    const tables = Array.from(document.querySelectorAll('table'));
    const stuTables = tables.filter(t => {
      const ths = Array.from(t.querySelectorAll('th'));
      return ths.some(th => th.textContent?.includes('分数'));
    });
    if(stuTables.length === 0) return 0;
    return stuTables[stuTables.length - 1].querySelectorAll('tbody tr').length;
  })()`)
  if (g71Rows === 5) ok('筛选 G7-1', `显示 ${g71Rows} 行`)
  else fail('筛选 G7-1', `显示 ${g71Rows} 行 (期望5)`)

  // ========== 阶段6: 学生页批量操作按钮 ==========
  console.log('\n--- 阶段6: 学生页批量操作按钮 ---')
  const batchBtns = await cdp.eval(`Array.from(document.querySelectorAll('button')).filter(b => 
    b.textContent?.includes('批量') || b.textContent?.includes('删除') || b.textContent?.includes('导出') || b.textContent?.includes('调入')
  ).map(b => b.textContent?.trim())`)
  if (batchBtns.length >= 2) ok('批量操作按钮', `${batchBtns.length} 个: ${batchBtns.join(', ')}`)
  else warn('批量操作按钮', `仅 ${batchBtns.length} 个`)

  // ========== 阶段7: Dashboard 班级筛选 + 对比 ==========
  console.log('\n--- 阶段7: Dashboard 班级筛选 + 对比 ---')
  await navigate('/dashboard', 4000)
  const dashSelect = await cdp.eval(`(function(){
    const sels = Array.from(document.querySelectorAll('select'));
    const classSel = sels.find(s => Array.from(s.options).map(o=>o.value).includes('__ALL__'));
    if(!classSel) return null;
    return { count: classSel.options.length };
  })()`)
  if (dashSelect && dashSelect.count >= 5) ok('Dashboard 班级筛选', `${dashSelect.count} 个选项`)
  else fail('Dashboard 班级筛选', '', JSON.stringify(dashSelect))

  // 开启对比模式
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('班级对比'));
    if(cb) cb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  const compareRows = await cdp.eval(`(function(){
    const tables = Array.from(document.querySelectorAll('table'));
    for(const t of tables){
      if(t.textContent?.includes('学生数') && t.textContent?.includes('平均分')){
        return { found: true, rows: t.querySelectorAll('tbody tr').length };
      }
    }
    return { found: false };
  })()`)
  if (compareRows?.found && compareRows.rows === 3) ok('班级对比表', `${compareRows.rows} 行`)
  else fail('班级对比表', '', JSON.stringify(compareRows))

  // ========== 阶段8: 添加事件并验证排行 ==========
  console.log('\n--- 阶段8: 添加事件并验证排行 ---')
  const codes = await call('eaa.codes')
  const deductCodes = (codes?.data?.codes ?? []).filter((c) => c.category === 'deduct')
  const bonusCodes = (codes?.data?.codes ?? []).filter((c) => c.category === 'bonus')
  let eventCount = 0
  for (const name of studentNames) {
    // 每个学生2条事件
    for (let i = 0; i < 2; i++) {
      const isDeduct = Math.random() > 0.5
      const code = isDeduct ? deductCodes[Math.floor(Math.random() * deductCodes.length)] : bonusCodes[Math.floor(Math.random() * bonusCodes.length)]
      if (!code) continue
      const res = await call('eaa.addEvent', {
        studentName: name,
        reasonCode: code.code,
        note: `测试事件-${i+1}`,
        operator: '测试教师',
      })
      if (res.success) eventCount++
    }
  }
  ok('添加事件', `共 ${eventCount} 条`)

  // 验证排行榜
  const ranking = await call('eaa.ranking', 10)
  const rankList = ranking?.data?.ranking ?? []
  if (rankList.length > 0) ok('排行榜', `Top ${rankList.length}`)
  else warn('排行榜', '空')

  // 验证统计 (>=15 因为可能有其他测试残留)
  const stats = await call('eaa.stats')
  const s = stats?.data?.summary
  if (s && s.students >= 15) ok('统计数据', `students=${s.students}, events=${s.valid_events}`)
  else fail('统计数据', '', JSON.stringify(s))

  // ========== 阶段9: 撤销事件 ==========
  console.log('\n--- 阶段9: 撤销事件 ---')
  // 取第一个学生的事件历史
  const firstStuHistory = await call('eaa.history', studentNames[0])
  const events = firstStuHistory?.data?.events ?? firstStuHistory?.data?.history ?? []
  if (events.length > 0) {
    const evtId = events[0].event_id
    const revRes = await call('eaa.revertEvent', evtId, '测试撤销')
    if (revRes.success) ok('撤销事件', `eventId=${evtId.slice(0, 16)}...`)
    else fail('撤销事件', '', revRes.__error || revRes.error)
  } else {
    warn('撤销事件', '无事件可撤销')
  }

  // ========== 阶段10: 响应式布局 ==========
  console.log('\n--- 阶段10: 响应式布局 (Top10/周期摘要) ---')
  await navigate('/dashboard', 4000)
  for (const size of [{ w: 800, h: 600, n: '800x600' }, { w: 500, h: 400, n: '500x400' }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false })
    await new Promise((r) => setTimeout(r, 1000))
    const overflow = await cdp.eval(`(function(){
      const body = document.body, html = document.documentElement;
      return { bodyOverflow: body.scrollWidth > body.clientWidth, htmlOverflow: html.scrollWidth > html.clientWidth, bodyW: body.scrollWidth, clientW: body.clientWidth };
    })()`)
    if (!overflow.bodyOverflow && !overflow.htmlOverflow) ok(`布局 ${size.n}`, '无溢出')
    else fail(`布局 ${size.n}`, '', `溢出 ${overflow.bodyW} > ${overflow.clientWidth}`)
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride')

  // ========== 阶段11: 清理 ==========
  console.log('\n--- 阶段11: 清理 ---')
  for (const c of (await call('class.list'))?.data ?? []) {
    await call('class.delete', c.id)
  }
  for (const s of (await call('eaa.listStudents'))?.data?.students ?? []) {
    await call('eaa.deleteStudent', s.name, '清理')
  }
  ok('清理完成', '')

  console.log('\n=== 第三轮测试汇总 ===')
  const total = results.pass + results.fail + results.warn
  console.log(`总计 ${total}, 通过 ${results.pass}, 失败 ${results.fail}, 警告 ${results.warn}, 通过率 ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.details.filter((d) => d.startsWith('✗')).forEach((d) => console.log(`  ${d}`))
  }

  ws.close(1000)
  fs.writeFileSync('dogfood-output/r3-realuser-result.json', JSON.stringify(results, null, 2))
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
