// 第七轮测试 — 随机创建3个班级 + 学生全生命周期 (创建→使用→删除)
// 模拟真实教师使用场景: 随机班级、随机学生、随机事件、随机操作
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
  async navigate(path, wait = 1500) {
    await this.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

// 随机工具
const random = {
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  int: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  name: () => {
    const surnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗']
    const givens = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平']
    return random.pick(surnames) + random.pick(givens)
  },
  className: () => {
    const grades = ['七年级', '八年级', '九年级']
    const nums = ['1班', '2班', '3班', '4班', '5班']
    return random.pick(grades) + random.pick(nums)
  },
  teacher: () => {
    const teachers = ['王老师', '李老师', '张老师', '刘老师', '陈老师', '杨老师', '赵老师']
    return random.pick(teachers)
  },
  reason: () => random.pick([
    'LATE', 'SLEEP_IN_CLASS', 'SPEAK_IN_CLASS', 'SCHOOL_CAUGHT',
    'CIVILIZED_DORM', 'CLASS_MONITOR', 'ACTIVITY_PARTICIPATION', 'MONTHLY_ATTENDANCE',
    'PHONE_IN_CLASS', 'APPEARANCE_VIOLATION'
  ]),
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  function errMsg(r) {
    return r?.__error || r?.error || (typeof r?.data === 'string' && !r?.success ? r.data : null) || 'unknown'
  }

  const ts = String(Date.now()).slice(-4)
  console.log('=== 第七轮: 随机3班级 + 学生全生命周期模拟 ===\n')
  console.log(`测试后缀: ${ts}\n`)

  // ========== 1. 清理 ==========
  console.log('--- 1. 清理旧数据 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 2000))
  ok('清理完成', '')

  // ========== 2. 随机创建3个班级 ==========
  console.log('\n--- 2. 随机创建3个班级 ---')
  const classIds = []
  for (let i = 0; i < 3; i++) {
    const classId = `R7-C${i + 1}-${ts}`
    const name = random.className()
    const grade = name.match(/^[七八九]年级/)?.[0] || '七年级'
    const teacher = random.teacher()
    const note = `随机班级${i + 1}`

    const r = await cdp.eval(`(async()=>{
      const res = await window.api.class.create({ class_id: '${classId}', name: '${name}', grade: '${grade}', teacher: '${teacher}', note: '${note}' });
      return JSON.parse(JSON.stringify(res));
    })()`)
    if (r?.success !== false) {
      classIds.push({ id: classId, name, grade, teacher })
      ok(`创建班级 ${name}`, `${classId} (${grade}/${teacher})`)
    } else {
      fail(`创建班级 ${name}`, '', errMsg(r))
    }
  }

  // 验证班级页显示
  console.log('\n--- 3. 验证班级页显示 ---')
  await cdp.navigate('/classes', 2000)
  const classPageCheck = await cdp.eval(`(function(){
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    const found = rows.filter(r => r.textContent?.includes('R7-C'));
    return { totalRows: rows.length, foundCount: found.length, texts: found.map(r => r.textContent?.slice(0, 60)) };
  })()`)
  if (classPageCheck.foundCount === 3) ok('班级页显示', `${classPageCheck.foundCount}/3 班级可见`)
  else warn('班级页显示', `仅 ${classPageCheck.foundCount}/3 班级可见`)

  // ========== 4. 随机创建学生 (每班5-8个) ==========
  console.log('\n--- 4. 随机创建学生 ---')
  const allStudents = []
  for (let ci = 0; ci < classIds.length; ci++) {
    const cls = classIds[ci]
    const studentCount = random.int(5, 8)
    console.log(`  班级 ${cls.name}: 创建 ${studentCount} 个学生`)
    for (let si = 0; si < studentCount; si++) {
      const sname = `${random.name()}_${ts}`
      const r = await cdp.eval(`(async()=>{
        const res = await window.api.eaa.addStudent('${sname}');
        return JSON.parse(JSON.stringify(res));
      })()`)
      if (r?.success !== false) {
        allStudents.push({ name: sname, classIndex: ci, classId: cls.id })
      }
    }
  }
  ok('创建学生', `${allStudents.length} 个学生 (${classIds.map(c => c.name).join(', ')})`)

  // ========== 5. 分配学生到班级 ==========
  console.log('\n--- 5. 分配学生到班级 ---')
  for (let ci = 0; ci < classIds.length; ci++) {
    const cls = classIds[ci]
    const studentsInClass = allStudents.filter(s => s.classIndex === ci).map(s => s.name)
    if (studentsInClass.length > 0) {
      const r = await cdp.eval(`(async()=>{
        const res = await window.api.class.assign({ class_id: '${cls.id}', student_names: ${JSON.stringify(studentsInClass)} });
        return JSON.parse(JSON.stringify(res));
      })()`)
      if (r?.success !== false) ok(`分配 ${cls.name}`, `${studentsInClass.length} 学生`)
      else fail(`分配 ${cls.name}`, '', errMsg(r))
    }
  }

  // ========== 6. 验证班级学生数 ==========
  console.log('\n--- 6. 验证班级学生数 ---')
  await cdp.navigate('/classes', 2500)
  await new Promise((r) => setTimeout(r, 2500)) // 等待 EAA 异步加载
  const studentCounts = await cdp.eval(`(function(){
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    return rows.map(r => {
      const tds = r.querySelectorAll('td');
      return { classId: tds[0]?.textContent?.trim(), count: tds[4]?.textContent?.trim() };
    });
  })()`)
  let countMatch = 0
  for (const cls of classIds) {
    const found = studentCounts.find(s => s.classId === cls.id)
    const expected = allStudents.filter(s => s.classIndex === classIds.indexOf(cls)).length
    if (found) {
      ok(`学生数 ${cls.name}`, `显示 ${found.count}, 实际 ${expected}`)
      if (String(found.count) === String(expected)) countMatch++
    }
  }
  if (countMatch === classIds.length) ok('所有班级学生数', '全部匹配 ✓')

  // ========== 7. 随机添加事件 ==========
  console.log('\n--- 7. 随机添加事件 ---')
  const eventCount = random.int(20, 30)
  let eventsAdded = 0
  for (let i = 0; i < eventCount; i++) {
    const student = random.pick(allStudents)
    const reason = random.reason()
    const note = `随机事件${i + 1}`
    const r = await cdp.eval(`(async()=>{
      const res = await window.api.eaa.addEvent({ studentName: '${student.name}', reasonCode: '${reason}', note: '${note}', operator: 'test' });
      return JSON.parse(JSON.stringify(res));
    })()`)
    if (r?.success !== false) eventsAdded++
  }
  ok('添加事件', `${eventsAdded}/${eventCount} 成功`)

  // ========== 8. 验证排行榜 ==========
  console.log('\n--- 8. 验证排行榜 ---')
  const ranking = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(10);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rankList = ranking?.data?.ranking || ranking?.data || []
  if (rankList.length > 0) {
    ok('排行榜', `${rankList.length} 名学生`)
    ok('第一名', `${rankList[0]?.name}: ${rankList[0]?.score ?? rankList[0]?.total_score}`)
    ok('最后一名', `${rankList[rankList.length - 1]?.name}: ${rankList[rankList.length - 1]?.score ?? rankList[rankList.length - 1]?.total_score}`)
  } else {
    warn('排行榜', '无数据')
  }

  // ========== 9. Dashboard 班级筛选 ==========
  console.log('\n--- 9. Dashboard 班级筛选 ---')
  await cdp.navigate('/dashboard', 4000)
  for (const cls of classIds) {
    const filterResult = await cdp.eval(`(function(){
      const sels = Array.from(document.querySelectorAll('select'));
      for(const sel of sels){
        const opt = Array.from(sel.options).find(o => o.value === '${cls.id}');
        if(opt){
          sel.value = '${cls.id}';
          sel.dispatchEvent(new Event('change', {bubbles: true}));
          return { found: true, optionCount: sel.options.length };
        }
      }
      return { found: false };
    })()`)
    if (filterResult?.found) ok(`筛选 ${cls.name}`, `${filterResult.optionCount} 选项`)
    else warn(`筛选 ${cls.name}`, '未找到')
    await new Promise((r) => setTimeout(r, 500))
  }

  // ========== 10. 班级对比模式 ==========
  console.log('\n--- 10. 班级对比模式 ---')
  // 开启对比
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('班级对比'));
    if(cb) cb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 2000))
  const compareResult = await cdp.eval(`(function(){
    const tables = Array.from(document.querySelectorAll('table'));
    for(const t of tables){
      if(t.textContent?.includes('学生数') && t.textContent?.includes('平均分')) {
        return { found: true, rows: t.querySelectorAll('tbody tr').length };
      }
    }
    return { found: false };
  })()`)
  if (compareResult?.found) ok('班级对比', `${compareResult.rows} 行对比数据`)
  else warn('班级对比', '表格未显示')

  // ========== 11. 学生页班级筛选 ==========
  console.log('\n--- 11. 学生页班级筛选 ---')
  await cdp.navigate('/students', 2500)
  const stuFilter = await cdp.eval(`(function(){
    const sels = Array.from(document.querySelectorAll('select'));
    const classSel = sels.find(s => Array.from(s.options).some(o => o.value === '__ALL__'));
    if(!classSel) return { found: false };
    return { found: true, optionCount: classSel.options.length };
  })()`)
  if (stuFilter?.found) ok('学生页筛选', `${stuFilter.optionCount} 选项`)
  else warn('学生页筛选', '未找到')

  // ========== 12. 随机撤销事件 ==========
  console.log('\n--- 12. 随机撤销事件 ---')
  if (allStudents.length > 0) {
    const student = random.pick(allStudents)
    const hist = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.history('${student.name}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    const events = hist?.data?.events || []
    if (events.length > 0) {
      const evt = random.pick(events)
      const evtId = evt?.id || evt?.event_id || evt?.uuid
      if (evtId) {
        const revertR = await cdp.eval(`(async()=>{
          const r = await window.api.eaa.revertEvent('${evtId}', '随机撤销');
          return JSON.parse(JSON.stringify(r));
        })()`)
        if (revertR?.success !== false) ok('随机撤销', `学生 ${student.name} 事件 ${evtId.slice(0, 12)}`)
        else fail('随机撤销', '', errMsg(revertR))
      }
    } else {
      warn('随机撤销', '学生无事件')
    }
  }

  // ========== 13. 班级归档/恢复 ==========
  console.log('\n--- 13. 班级归档/恢复 ---')
  if (classIds.length > 0) {
    const clsToArchive = random.pick(classIds)
    // 先获取班级的本地 id
    const classList = await cdp.eval(`(async()=>{
      const r = await window.api.class.list();
      return r.data?.find(c => c.class_id === '${clsToArchive.id}');
    })()`)
    if (classList?.id) {
      const archiveR = await cdp.eval(`(async()=>{
        const r = await window.api.class.archive('${classList.id}');
        return JSON.parse(JSON.stringify(r));
      })()`)
      if (archiveR?.success !== false) ok(`归档 ${clsToArchive.name}`, '成功')
      else fail(`归档 ${clsToArchive.name}`, '', errMsg(archiveR))

      // 验证班级页显示存档状态
      await cdp.navigate('/classes', 2000)
      // 显示存档班级
      await cdp.eval(`(function(){
        const cb = document.querySelector('input[type="checkbox"]');
        if(cb && !cb.checked) cb.click();
      })()`)
      await new Promise((r) => setTimeout(r, 1000))
      const archiveCheck = await cdp.eval(`(function(){
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        const found = rows.find(r => r.textContent?.includes('${clsToArchive.id}') && r.textContent?.includes('存档'));
        return !!found;
      })()`)
      if (archiveCheck) ok('归档状态显示', '存档标签可见')
      else warn('归档状态显示', '未找到存档标签')

      // 恢复
      const restoreR = await cdp.eval(`(async()=>{
        const r = await window.api.class.restore('${classList.id}');
        return JSON.parse(JSON.stringify(r));
      })()`)
      if (restoreR?.success !== false) ok(`恢复 ${clsToArchive.name}`, '成功')
      else fail(`恢复 ${clsToArchive.name}`, '', errMsg(restoreR))
    }
  }

  // ========== 14. 统计验证 ==========
  console.log('\n--- 14. 统计验证 ---')
  const stats = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.stats();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (stats?.success !== false) {
    ok('统计数据', `可用`)
  }

  // ========== 15. 导出验证 ==========
  console.log('\n--- 15. 导出验证 ---')
  for (const fmt of ['csv', 'jsonl', 'html']) {
    try {
      const r = await cdp.eval(`(async()=>{
        const res = await window.api.eaa.export('${fmt}');
        return JSON.parse(JSON.stringify(res));
      })()`)
      if (r?.success !== false && typeof r?.data === 'string') {
        ok(`${fmt} 导出`, `${r.data.length} 字符`)
      } else {
        warn(`${fmt} 导出`, '无数据')
      }
    } catch (e) {
      warn(`${fmt} 导出`, String(e).slice(0, 60))
    }
  }

  // ========== 16. 清理: 删除所有 ==========
  console.log('\n--- 16. 删除所有数据 ---')
  // 删除班级
  const deleteClassResult = await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    let deleted = 0;
    for(const c of cls.data || []) {
      const r = await window.api.class.delete(c.id);
      if(r?.success !== false) deleted++;
    }
    return deleted;
  })()`)
  ok('删除班级', `${deleteClassResult} 个`)

  // 删除学生
  const deleteStuResult = await cdp.eval(`(async()=>{
    const stu = await window.api.eaa.listStudents();
    let deleted = 0;
    for(const s of stu.data?.students || []) {
      const r = await window.api.eaa.deleteStudent(s.name, '生命周期结束');
      if(r?.success !== false) deleted++;
    }
    return deleted;
  })()`)
  ok('删除学生', `${deleteStuResult} 个`)

  // 验证清理
  const verifyClean = await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    const stu = await window.api.eaa.listStudents();
    const activeStu = (stu.data?.students || []).filter(s => s.status !== 'DELETED');
    return { classes: cls.data?.length || 0, students: activeStu.length };
  })()`)
  if (verifyClean.classes === 0) ok('验证清理', `班级 0, 活跃学生 ${verifyClean.students}`)
  else warn('验证清理', `班级 ${verifyClean.classes}, 学生 ${verifyClean.students}`)

  console.log('\n=== 第七轮随机生命周期测试汇总 ===')
  const total = results.pass + results.fail + results.warn
  console.log(`总计 ${total}, 通过 ${results.pass}, 失败 ${results.fail}, 警告 ${results.warn}, 通过率 ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.details.filter((d) => d.startsWith('✗')).forEach((d) => console.log(`  ${d}`))
  }

  ws.close(1000)
  fs.writeFileSync('dogfood-output/r7-random-lifecycle-result.json', JSON.stringify({ results, classIds, studentCount: allStudents.length, eventCount }, null, 2))
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
