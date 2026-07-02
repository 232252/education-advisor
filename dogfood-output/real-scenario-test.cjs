// 真实用户场景测试: 清理旧数据 → 创建3个班级 → 随机创建学生 → 分班 → 事件 → 各功能验证 → 删除
const http = require('http')
const WebSocket = require('ws')

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
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
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

  async function navigate(path) {
    await cdp.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, 1500))
  }

  async function getDom(selector) {
    return cdp.eval(`(function(){
      const el = document.querySelector('${selector}');
      if(!el) return null;
      return {tag: el.tagName, text: el.textContent?.slice(0,200), visible: el.offsetParent !== null};
    })()`)
  }

  const results = { pass: 0, fail: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  console.log('=== 真实用户场景测试: 3班级全生命周期 ===\n')

  // ========== 阶段1: 清理旧测试数据 ==========
  console.log('--- 阶段1: 清理旧测试班级 ---')
  const oldClasses = await call('class.list')
  const oldClassList = oldClasses?.data ?? []
  let deletedCount = 0
  for (const c of oldClassList) {
    const res = await call('class.delete', c.id)
    if (res.success) deletedCount++
  }
  ok('清理旧班级', `删除 ${deletedCount}/${oldClassList.length}`)

  // ========== 阶段2: 创建3个真实班级 ==========
  console.log('\n--- 阶段2: 创建3个真实班级 ---')
  const testClasses = [
    { class_id: 'G7-1', name: '七年级一班', grade: '七年级', teacher: '张老师', note: '重点班' },
    { class_id: 'G7-2', name: '七年级二班', grade: '七年级', teacher: '李老师', note: '普通班' },
    { class_id: 'G7-3', name: '七年级三班', grade: '七年级', teacher: '王老师', note: '普通班' },
  ]
  for (const tc of testClasses) {
    const res = await call('class.create', tc)
    if (res.success) {
      ok(`创建班级 ${tc.class_id}`, `${tc.name} (${tc.grade}/${tc.teacher})`)
    } else {
      fail(`创建班级 ${tc.class_id}`, '', res.error || 'unknown')
    }
  }

  // 验证班级列表
  const clsList = await call('class.list')
  const newClasses = clsList?.data ?? []
  ok('班级列表验证', `共 ${newClasses.length} 个班级`)
  for (const c of newClasses) {
    console.log(`    - ${c.class_id}: ${c.name} (grade=${c.grade ?? '-'}, teacher=${c.teacher ?? '-'})`)
  }

  // ========== 阶段3: 随机创建学生 ==========
  console.log('\n--- 阶段3: 随机创建15名学生 ---')
  const surnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴']
  const givenNames = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '霞', '平', '刚', '桂芳']
  const studentNames = []
  for (let i = 0; i < 15; i++) {
    const sn = surnames[Math.floor(Math.random() * surnames.length)]
    const gn = givenNames[Math.floor(Math.random() * givenNames.length)]
    const name = `${sn}${gn}${i+1}` // 加序号避免重名
    studentNames.push(name)
    const res = await call('eaa.addStudent', name)
    if (res.success) {
      ok(`创建学生 ${name}`, '')
    } else {
      fail(`创建学生 ${name}`, '', res.stderr || res.__error || 'unknown')
    }
  }

  // ========== 阶段4: 分班 (每班5人) ==========
  console.log('\n--- 阶段4: 分班 (每班5人) ---')
  for (let ci = 0; ci < 3; ci++) {
    const targetClass = testClasses[ci]
    const batch = studentNames.slice(ci * 5, (ci + 1) * 5)
    const res = await call('class.assign', { class_id: targetClass.class_id, student_names: batch })
    if (res.success) {
      ok(`分班 ${targetClass.name}`, `成功 ${res.assigned}/${batch.length}, 失败 ${res.failed.length}`)
    } else {
      fail(`分班 ${targetClass.name}`, '', res.error || 'unknown')
    }
  }

  // ========== 阶段5: 验证分班结果 ==========
  console.log('\n--- 阶段5: 验证分班结果 ---')
  const students = await call('eaa.listStudents')
  const stuList = students?.data?.students ?? []
  const classIdMap = {}
  for (const s of stuList) {
    const cid = s.class_id || '(null)'
    classIdMap[cid] = (classIdMap[cid] || 0) + 1
  }
  console.log('  class_id 分布:', JSON.stringify(classIdMap))

  for (const tc of testClasses) {
    const count = classIdMap[tc.class_id] ?? 0
    if (count === 5) {
      ok(`${tc.name} 学生数`, `${count} 人`)
    } else {
      fail(`${tc.name} 学生数`, `期望5, 实际${count}`)
    }
  }

  // ========== 阶段6: 添加操行事件 ==========
  console.log('\n--- 阶段6: 添加操行事件 (每个学生2-3条) ---')
  const reasonCodes = await call('eaa.codes')
  const deductCodes = (reasonCodes?.data?.codes ?? []).filter((c) => c.category === 'deduct').slice(0, 5)
  const bonusCodes = (reasonCodes?.data?.codes ?? []).filter((c) => c.category === 'bonus').slice(0, 5)
  console.log(`  可用扣分码: ${deductCodes.map((c) => c.code).join(', ')}`)
  console.log(`  可用加分码: ${bonusCodes.map((c) => c.code).join(', ')}`)

  let eventCount = 0
  for (const name of studentNames) {
    // 每个学生2-3条事件
    const numEvents = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < numEvents; i++) {
      const isDeduct = Math.random() > 0.4
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
  ok('添加操行事件', `共 ${eventCount} 条`)

  // ========== 阶段7: 验证学生分数和排名 ==========
  console.log('\n--- 阶段7: 验证分数和排名 ---')
  const ranking = await call('eaa.ranking', 10)
  const rankList = ranking?.data?.ranking ?? []
  ok('排行榜', `Top ${rankList.length}`)
  for (const r of rankList.slice(0, 5)) {
    console.log(`    #${r.rank}: ${r.name} (score=${r.score}, risk=${r.risk})`)
  }

  const stats = await call('eaa.stats')
  const s = stats?.data?.summary
  if (s) {
    ok('统计数据', `students=${s.students}, events=${s.valid_events}, delta=${s.total_delta?.toFixed(1)}`)
  }

  // ========== 阶段8: UI 功能验证 (导航 + DOM 检查) ==========
  console.log('\n--- 阶段8: UI 功能验证 ---')

  // 8.1 学生页班级筛选下拉
  await navigate('/students')
  await new Promise((r) => setTimeout(r, 2000))
  const classSelect = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(!classSel) return null;
    return {optionCount: classSel.options.length, options: Array.from(classSel.options).map(o => ({value: o.value, text: o.text}))};
  })()`)
  if (classSelect && classSelect.optionCount >= 5) {
    ok('学生页班级筛选下拉', `${classSelect.optionCount} 个选项 (全部+未分班+3班级)`)
  } else {
    fail('学生页班级筛选下拉', '', JSON.stringify(classSelect))
  }

  // 8.2 学生页表格班级列
  const classColumn = await cdp.eval(`(function(){
    const ths = document.querySelectorAll('th');
    for(const th of ths){ if(th.textContent?.trim() === '班级') return {found: true, text: th.textContent}; }
    return {found: false};
  })()`)
  if (classColumn?.found) {
    ok('学生页班级列', 'th=班级 已找到')
  } else {
    fail('学生页班级列', '', '未找到班级列')
  }

  // 8.3 选择"七年级一班"筛选
  if (classSelect) {
    await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      const classSel = Array.from(selects).find(s => {
        const opts = Array.from(s.options).map(o => o.value);
        return opts.includes('__ALL__') && opts.includes('__NONE__');
      });
      if(classSel){ classSel.value='G7-1'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
    })()`)
    await new Promise((r) => setTimeout(r, 1000))
    const filteredRows = await cdp.eval(`document.querySelectorAll('tbody tr').length`)
    if (filteredRows === 5) {
      ok('班级筛选 G7-1', `显示 ${filteredRows} 行 (期望5)`)
    } else {
      fail('班级筛选 G7-1', `显示 ${filteredRows} 行 (期望5)`)
    }
  }

  // 8.4 重置筛选
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(classSel){ classSel.value='__ALL__'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
  })()`)
  await new Promise((r) => setTimeout(r, 500))

  // 8.5 Dashboard 班级筛选
  await navigate('/dashboard')
  await new Promise((r) => setTimeout(r, 3000))
  const dashSelect = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(!classSel) return null;
    return {optionCount: classSel.options.length};
  })()`)
  if (dashSelect && dashSelect.optionCount >= 5) {
    ok('Dashboard 班级筛选', `${dashSelect.optionCount} 个选项`)
  } else {
    fail('Dashboard 班级筛选', '', JSON.stringify(dashSelect))
  }

  // 8.6 Dashboard 班级对比按钮
  const compareBtn = await cdp.eval(`(function(){
    const btns = document.querySelectorAll('button');
    const cb = Array.from(btns).find(b => b.textContent?.includes('班级对比'));
    return cb ? {found: true, text: cb.textContent} : {found: false};
  })()`)
  if (compareBtn?.found) {
    ok('Dashboard 班级对比按钮', '已找到')
  } else {
    fail('Dashboard 班级对比按钮', '', '未找到')
  }

  // 8.7 点击班级对比按钮
  await cdp.eval(`(function(){
    const btns = document.querySelectorAll('button');
    const cb = Array.from(btns).find(b => b.textContent?.includes('班级对比'));
    if(cb) cb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 1000))
  const compareTable = await cdp.eval(`(function(){
    const tables = document.querySelectorAll('table');
    for(const t of tables){
      if(t.textContent?.includes('学生数') && t.textContent?.includes('平均分')) return {found: true, rows: t.querySelectorAll('tbody tr').length};
    }
    return {found: false};
  })()`)
  if (compareTable?.found && compareTable.rows === 3) {
    ok('班级对比表', `${compareTable.rows} 行 (期望3)`)
  } else {
    fail('班级对比表', '', JSON.stringify(compareTable))
  }

  // 8.8 选择班级筛选 G7-1
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(classSel){ classSel.value='G7-1'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
  })()`)
  await new Promise((r) => setTimeout(r, 1000))
  const filteredRanking = await cdp.eval(`(function(){
    const rankingSection = Array.from(document.querySelectorAll('h3')).find(h => h.textContent?.includes('Top10'));
    if(!rankingSection) return {found: false};
    const container = rankingSection.parentElement;
    const buttons = container.querySelectorAll('button');
    return {found: true, count: buttons.length};
  })()`)
  if (filteredRanking?.found && filteredRanking.count <= 5) {
    ok('Dashboard 班级筛选排行', `G7-1 有 ${filteredRanking.count} 条 (<=5)`)
  } else {
    fail('Dashboard 班级筛选排行', '', JSON.stringify(filteredRanking))
  }

  // 8.9 Classes 页加载速度测试
  await navigate('/classes')
  const startTime = Date.now()
  await new Promise((r) => setTimeout(r, 500))
  // 等待表格出现
  let classTableFound = false
  for (let i = 0; i < 10; i++) {
    const tableExists = await cdp.eval(`document.querySelector('table tbody tr') !== null`)
    if (tableExists) { classTableFound = true; break }
    await new Promise((r) => setTimeout(r, 500))
  }
  const loadTime = Date.now() - startTime
  if (classTableFound && loadTime < 5000) {
    ok('班级页加载速度', `${loadTime}ms (< 5000ms)`)
  } else if (classTableFound) {
    fail('班级页加载速度', `${loadTime}ms (>= 5000ms, 仍然慢)`)
  } else {
    fail('班级页加载', '表格未出现')
  }

  // 8.10 验证班级学生数
  const studentCounts = await cdp.eval(`(function(){
    const rows = document.querySelectorAll('table tbody tr');
    const result = [];
    for(const row of rows){
      const cells = row.querySelectorAll('td');
      if(cells.length >= 5){
        result.push({classId: cells[0]?.textContent?.trim(), name: cells[1]?.textContent?.trim(), count: cells[4]?.textContent?.trim()});
      }
    }
    return result;
  })()`)
  console.log('  班级学生数:')
  for (const sc of studentCounts) {
    console.log(`    ${sc.classId} (${sc.name}): ${sc.count} 人`)
  }
  const allHaveStudents = studentCounts.every((sc) => parseInt(sc.count) === 5)
  if (allHaveStudents && studentCounts.length === 3) {
    ok('班级学生数正确', '3个班级各5人')
  } else {
    fail('班级学生数', '', JSON.stringify(studentCounts))
  }

  // ========== 阶段9: 班级生命周期操作 ==========
  console.log('\n--- 阶段9: 班级生命周期 (archive/restore/delete) ---')
  // 找到第一个班级的 UUID id
  const clsList2 = await call('class.list')
  const classes2 = clsList2?.data ?? []
  if (classes2.length > 0) {
    const testClass = classes2[0]
    console.log(`  测试班级: ${testClass.name} (id=${testClass.id})`)

    // archive
    const archRes = await call('class.archive', testClass.id)
    if (archRes.success) {
      ok('class.archive', `${testClass.name} 已存档`)
    } else {
      fail('class.archive', '', archRes.error || 'unknown')
    }

    // restore
    const restRes = await call('class.restore', testClass.id)
    if (restRes.success) {
      ok('class.restore', `${testClass.name} 已恢复`)
    } else {
      fail('class.restore', '', restRes.error || 'unknown')
    }

    // update
    const updRes = await call('class.update', testClass.id, { name: `${testClass.name}(已更新)`, grade: '八年级', teacher: '新老师' })
    if (updRes.success) {
      ok('class.update', '名称/年级/班主任 更新成功')
    } else {
      fail('class.update', '', updRes.error || 'unknown')
    }
  }

  // ========== 阶段10: 清理 (删除测试学生 + 班级) ==========
  console.log('\n--- 阶段10: 清理测试数据 ---')
  let deletedStudents = 0
  for (const name of studentNames) {
    const res = await call('eaa.deleteStudent', name)
    if (res.success) deletedStudents++
  }
  ok('删除测试学生', `${deletedStudents}/${studentNames.length}`)

  let deletedClasses = 0
  const clsList3 = await call('class.list')
  for (const c of (clsList3?.data ?? [])) {
    const res = await call('class.delete', c.id)
    if (res.success) deletedClasses++
  }
  ok('删除测试班级', `${deletedClasses} 个`)

  // 最终验证
  const finalInfo = await call('eaa.info')
  console.log(`\n  最终 EAA info: students=${finalInfo?.data?.students}, events=${finalInfo?.data?.events}`)

  console.log(`\n=== 测试汇总 ===`)
  console.log(`总计: ${results.pass + results.fail}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    for (const d of results.details.filter((x) => x.startsWith('✗'))) {
      console.log(`  ${d}`)
    }
  }

  await cdp.close()
  process.exit(results.fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
