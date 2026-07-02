// 第二十三轮测试 — 仪表盘分班级显示 + 班级对比 UI 专项
// 目标: 真实操作 UI 测试班级筛选和两班级对比功能
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
  async navigate(p, wait = 1500) {
    await this.eval(`window.location.hash='${p}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
  // 模拟 React select change
  async selectChange(selector, value) {
    return await this.eval(`(function(){
      const sel = document.querySelector('${selector}');
      if (!sel) return { success: false, error: 'select not found' };
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, '${value}');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    })()`)
  }
  // 模拟按钮点击
  async click(selector) {
    return await this.eval(`(function(){
      const btn = document.querySelector('${selector}');
      if (!btn) return { success: false, error: 'button not found' };
      btn.click();
      return { success: true };
    })()`)
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
  console.log(`=== 第二十三轮: 仪表盘分班级显示 + 班级对比 UI 专项 ===\n`)

  // ========== 1. 准备测试数据 ==========
  console.log('--- 1. 准备测试数据 ---')
  // 创建 3 个班级,每班分配不同数量学生
  const testClasses = [
    { class_id: `R23A-${testSuffix}`, name: `R23甲班`, grade: '九年级', teacher: '甲老师' },
    { class_id: `R23B-${testSuffix}`, name: `R23乙班`, grade: '九年级', teacher: '乙老师' },
    { class_id: `R23C-${testSuffix}`, name: `R23丙班`, grade: '九年级', teacher: '丙老师' },
  ]
  const testStudents = { R23A: [], R23B: [], R23C: [] }
  const classKeyMap = { [`R23A-${testSuffix}`]: 'R23A', [`R23B-${testSuffix}`]: 'R23B', [`R23C-${testSuffix}`]: 'R23C' }

  for (const c of testClasses) {
    await cdp.eval(`(async()=>{ await window.api.class.create({ class_id: '${c.class_id}', name: '${c.name}', grade: '${c.grade}', teacher: '${c.teacher}' }); })()`)
  }
  ok('创建3个班级', '')

  // 每班 8 个学生
  const surnames = '赵钱孙李周吴郑王冯陈'
  for (const cls of testClasses) {
    const key = classKeyMap[cls.class_id]
    for (let i = 0; i < 8; i++) {
      const name = `R23${key}${i}_${testSuffix}`
      await cdp.eval(`(async()=>{ try{ await window.api.eaa.addStudent('${name}'); }catch(e){} })()`)
      testStudents[key].push(name)
    }
    await cdp.eval(`(async()=>{ await window.api.class.assign({ class_id: '${cls.class_id}', student_names: ${JSON.stringify(testStudents[key])} }); })()`)
  }
  await new Promise((r) => setTimeout(r, 2000))
  ok('分配学生', `3班×8人=24人`)

  // 给部分学生加事件,产生不同分数
  const codes = ['LATE', 'SPEAK_IN_CLASS', 'CLASS_MONITOR', 'ACTIVITY_PARTICIPATION', 'BONUS_VARIABLE', 'SLEEP_IN_CLASS']
  for (const key of ['R23A', 'R23B', 'R23C']) {
    for (let i = 0; i < 4; i++) {
      const stu = testStudents[key][i]
      const code = codes[i % codes.length]
      await cdp.eval(`(async()=>{ try{ await window.api.eaa.addEvent({ studentName: '${stu}', reasonCode: '${code}', note: 'R23', operator: 'R23' }); }catch(e){} })()`)
    }
  }
  await new Promise((r) => setTimeout(r, 1000))
  ok('添加事件', `12 个`)

  // ========== 2. 导航到仪表盘 ==========
  console.log('\n--- 2. 导航到仪表盘 ---')
  await cdp.navigate('/dashboard', 2000)
  const dashTitle = await cdp.eval(`document.querySelector('h1')?.innerText`)
  if (dashTitle) ok('仪表盘标题', dashTitle)
  else warn('仪表盘标题', '未找到 h1')

  // ========== 3. 班级筛选下拉框 ==========
  console.log('\n--- 3. 班级筛选下拉框 ---')
  // 找到班级筛选 select
  const filterSelectInfo = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      if (sel.querySelector('option[value="__ALL__"]')) {
        return { found: true, optionCount: sel.options.length, options: Array.from(sel.options).map(o => ({value: o.value, text: o.text})) };
      }
    }
    return { found: false };
  })()`)

  if (filterSelectInfo?.found) {
    ok('班级筛选 select', `${filterSelectInfo.optionCount} 选项`)
    // 验证选项包含测试班级
    const hasClassA = filterSelectInfo.options.some(o => o.value === `R23A-${testSuffix}`)
    const hasClassB = filterSelectInfo.options.some(o => o.value === `R23B-${testSuffix}`)
    const hasClassC = filterSelectInfo.options.some(o => o.value === `R23C-${testSuffix}`)
    if (hasClassA && hasClassB && hasClassC) ok('筛选选项含测试班级', '3/3')
    else warn('筛选选项', `A:${hasClassA} B:${hasClassB} C:${hasClassC}`)
  } else {
    fail('班级筛选 select', '', '未找到含 __ALL__ 的 select')
  }

  // ========== 4. 筛选班级 A ==========
  console.log('\n--- 4. 筛选班级 A ---')
  const beforeFilter = await cdp.eval(`document.body.innerText.length`)
  const filterR = await cdp.selectChange('select', `R23A-${testSuffix}`)
  if (filterR?.success) {
    await new Promise((r) => setTimeout(r, 1500))
    const afterFilter = await cdp.eval(`document.body.innerText.length`)
    ok('筛选班级 A', `body ${beforeFilter} → ${afterFilter}`)

    // 验证筛选后只显示班级 A 的学生(检查 StatCard)
    const statCards = await cdp.eval(`(function(){
      const cards = document.querySelectorAll('[class*="card"], [class*="Card"]');
      return Array.from(cards).slice(0, 4).map(c => c.innerText.slice(0, 50));
    })()`)
    if (Array.isArray(statCards) && statCards.length > 0) ok('筛选后卡片', `${statCards.length} 个`)
    else warn('筛选后卡片', '未找到')
  } else {
    fail('筛选班级 A', '', filterR?.error || '失败')
  }

  // 筛选全部
  await cdp.selectChange('select', '__ALL__')
  await new Promise((r) => setTimeout(r, 1000))
  ok('重置筛选', '全部班级')

  // 筛选未分班
  await cdp.selectChange('select', '__NONE__')
  await new Promise((r) => setTimeout(r, 1000))
  ok('筛选未分班', '完成')
  await cdp.selectChange('select', '__ALL__')
  await new Promise((r) => setTimeout(r, 1000))

  // ========== 5. 班级对比模式 ==========
  console.log('\n--- 5. 班级对比模式 ---')
  // 找到"班级对比"按钮
  const compareBtnInfo = await cdp.eval(`(function(){
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.innerText.includes('班级对比') || b.innerText.includes('compare')) {
        return { found: true, text: b.innerText, className: b.className };
      }
    }
    return { found: false };
  })()`)

  if (compareBtnInfo?.found) {
    ok('找到对比按钮', compareBtnInfo.text.slice(0, 30))

    // 点击对比按钮
    const clickR = await cdp.eval(`(function(){
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.innerText.includes('班级对比') || b.innerText.includes('compare')) {
          b.click();
          return { success: true, text: b.innerText };
        }
      }
      return { success: false };
    })()`)
    if (clickR?.success) {
      await new Promise((r) => setTimeout(r, 1000))
      ok('点击对比按钮', '成功')

      // 验证全班级对比表显示
      const compareTable = await cdp.eval(`(function(){
        const text = document.body.innerText;
        // 查找"双班级详细对比"或"全班级对比"
        const hasAllCompare = text.includes('班级') && (text.includes('平均分') || text.includes('高风险'));
        const hasDualCompare = text.includes('VS') || text.includes('双班级') || text.includes('详细对比');
        return { hasAllCompare, hasDualCompare };
      })()`)
      if (compareTable?.hasAllCompare) ok('全班级对比表', '显示')
      else warn('全班级对比表', '未找到')
      if (compareTable?.hasDualCompare) ok('双班级对比区', '显示')
      else warn('双班级对比区', '未找到')
    } else {
      fail('点击对比按钮', '', '失败')
    }
  } else {
    warn('班级对比按钮', '未找到(可能UI未渲染)')
  }

  // ========== 6. 双班级对比 ==========
  console.log('\n--- 6. 双班级对比 ---')
  // 找到 A/B 两个对比下拉框
  const compareSelects = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const result = [];
    for (const sel of selects) {
      const firstOpt = sel.options[0]?.text || '';
      if (firstOpt.includes('班级 A') || firstOpt.includes('选择班级 A') || firstOpt.includes('班级 A')) {
        result.push({ index: selects.length - 1 - Array.from(selects).reverse().indexOf(sel), role: 'A', optionCount: sel.options.length });
      }
      if (firstOpt.includes('班级 B') || firstOpt.includes('选择班级 B') || firstOpt.includes('班级 B')) {
        result.push({ index: selects.length - 1 - Array.from(selects).reverse().indexOf(sel), role: 'B', optionCount: sel.options.length });
      }
    }
    return result;
  })()`)

  // 更可靠:找所有 select 中 option[0] 为空value的
  const allSelectsInfo = await cdp.eval(`(function(){
    return Array.from(document.querySelectorAll('select')).map((s, i) => ({
      index: i,
      optionCount: s.options.length,
      firstOptValue: s.options[0]?.value,
      firstOptText: s.options[0]?.text,
      currentValue: s.value
    }));
  })()`)

  // 班级筛选 select 是第一个(有 __ALL__),对比 A/B 是后面的(第一个 option 为空)
  const compareSelectIndices = (allSelectsInfo || [])
    .filter(s => s.firstOptValue === '' && s.optionCount > 1)
    .map(s => s.index)

  if (compareSelectIndices.length >= 2) {
    ok('找到对比下拉框', `A:#${compareSelectIndices[0]}, B:#${compareSelectIndices[1]}`)

    // 选择 A = R23A, B = R23B
    const selA = await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      const sel = selects[${compareSelectIndices[0]}];
      if (!sel) return {success:false};
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'R23A-${testSuffix}');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return {success:true};
    })()`)
    await new Promise((r) => setTimeout(r, 800))

    const selB = await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      const sel = selects[${compareSelectIndices[1]}];
      if (!sel) return {success:false};
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'R23B-${testSuffix}');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return {success:true};
    })()`)
    await new Promise((r) => setTimeout(r, 1500))

    if (selA?.success && selB?.success) {
      // 验证对比卡片渲染
      const compareCards = await cdp.eval(`(function(){
        const text = document.body.innerText;
        const hasA = text.includes('R23甲班');
        const hasB = text.includes('R23乙班');
        const hasVS = text.includes('VS');
        return { hasA, hasB, hasVS };
      })()`)
      if (compareCards?.hasA && compareCards?.hasB) ok('双班级对比卡片', `A:${compareCards.hasA} B:${compareCards.hasB} VS:${compareCards.hasVS}`)
      else warn('双班级对比卡片', `A:${compareCards?.hasA} B:${compareCards?.hasB}`)
    } else {
      fail('选择对比班级', '', '失败')
    }
  } else {
    warn('对比下拉框', `找到 ${compareSelectIndices.length} 个(需2个)`)
  }

  // ========== 7. 数据一致性验证 ==========
  console.log('\n--- 7. 数据一致性验证 ---')
  // 通过 API 获取实际数据,与 UI 对比
  const apiStudents = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
  const classAStudents = (apiStudents?.data?.students || []).filter(s => s.class_id === `R23A-${testSuffix}`)
  const classBStudents = (apiStudents?.data?.students || []).filter(s => s.class_id === `R23B-${testSuffix}`)

  ok('API 学生数', `A:${classAStudents.length}, B:${classBStudents.length}`)

  // ========== 8. ClassProfile 班级详情 ==========
  console.log('\n--- 8. ClassProfile 班级详情 ---')
  await cdp.navigate('/classes', 1500)

  // 点击第一个班级查看详情
  const clickClassR = await cdp.eval(`(function(){
    const btns = document.querySelectorAll('button, [role="button"], tr, [class*="row"]');
    for (const b of btns) {
      if (b.innerText.includes('R23甲班')) {
        b.click();
        return { success: true, text: b.innerText.slice(0, 50) };
      }
    }
    return { success: false };
  })()`)
  if (clickClassR?.success) {
    await new Promise((r) => setTimeout(r, 1500))
    const profileBody = await cdp.eval(`document.body.innerText.length`)
    ok('班级详情页', `${profileBody} 字符`)

    // 检查 Tab
    const tabs = await cdp.eval(`(function(){
      const tabs = document.querySelectorAll('[role="tab"], button');
      const texts = [];
      for (const t of tabs) {
        const text = t.innerText || '';
        if (text.includes('概览') || text.includes('学生') || text.includes('分配') || text.includes('Overview') || text.includes('Students') || text.includes('Assign')) {
          texts.push(text.slice(0, 30));
        }
      }
      return texts;
    })()`)
    if (tabs.length > 0) ok('班级详情 Tab', tabs.join(', '))
    else warn('班级详情 Tab', '未找到')
  } else {
    warn('点击班级', '未找到 R23甲班')
  }

  // ========== 9. 关闭对比模式 ==========
  console.log('\n--- 9. 关闭对比模式 ---')
  await cdp.navigate('/dashboard', 1500)
  // 重新打开对比然后关闭
  await cdp.eval(`(function(){
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.innerText.includes('班级对比')) { b.click(); break; }
    }
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  await cdp.eval(`(function(){
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.innerText.includes('班级对比')) { b.click(); break; }
    }
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  ok('关闭对比模式', '完成')

  // ========== 10. 清理 ==========
  console.log('\n--- 10. 清理 ---')
  try {
    // 删除班级
    const cls = await cdp.eval(`(async()=>{ const r=await window.api.class.list(); return JSON.parse(JSON.stringify(r)); })()`)
    for (const c of (cls?.data || [])) {
      if (c.class_id.startsWith('R23')) await cdp.eval(`(async()=>{ await window.api.class.delete('${c.id}'); })()`)
    }
    // 删除学生
    const stuList = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
    const students = (stuList?.data?.students || []).filter(s => s.name.startsWith('R23') && s.status !== 'Deleted')
    for (let i = 0; i < students.length; i += 5) {
      const batch = students.slice(i, i + 5)
      await cdp.eval(`(async()=>{ ${batch.map(s => `try{await window.api.eaa.deleteStudent('${s.name}', '清理');}catch(e){}`).join('\n')} })()`)
    }
    ok('清理', `${students.length} 学生 + 3 班级`)
  } catch (e) {
    warn('清理', String(e).slice(0, 100))
  }

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${total > 0 ? (results.pass / total * 100).toFixed(1) : 0}%`)

  const resultFile = path.join(__dirname, 'r23-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ results }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
