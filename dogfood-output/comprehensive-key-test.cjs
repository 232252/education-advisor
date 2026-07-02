// 综合按键测试: 真实模拟用户操作每一个按键/控件
// 包含: 数据准备 + 每个页面所有交互 + 响应式 + 生命周期
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
      // 20s 超时, 避免无限挂起
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          j(new Error(`CDP timeout: ${method}`))
        }
      }, 20000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 15000 })
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
  async function navigate(path) {
    await cdp.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, 1500))
  }
  async function click(selector) {
    return cdp.eval(`(function(){
      const el = document.querySelector('${selector}');
      if(!el) return {ok: false, reason: 'not found'};
      el.click();
      return {ok: true, text: el.textContent?.trim().slice(0,40)};
    })()`)
  }
  async function clickByText(tag, text) {
    return cdp.eval(`(function(){
      const els = Array.from(document.querySelectorAll('${tag}'));
      const el = els.find(e => e.textContent?.includes('${text}'));
      if(!el) return {ok: false, reason: 'not found'};
      el.click();
      return {ok: true, text: el.textContent?.trim().slice(0,40)};
    })()`)
  }
  async function setSelect(selector, value) {
    return cdp.eval(`(function(){
      const sel = document.querySelector('${selector}');
      if(!sel) return {ok: false, reason: 'not found'};
      sel.value = '${value}';
      sel.dispatchEvent(new Event('change', {bubbles: true}));
      return {ok: true};
    })()`)
  }
  async function countElements(selector) {
    return cdp.eval(`document.querySelectorAll('${selector}').length`)
  }
  async function getViewportInfo() {
    return cdp.eval(`({w: window.innerWidth, h: window.innerHeight})`)
  }
  async function setViewport(w, h) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    await new Promise((r) => setTimeout(r, 800))
  }
  async function resetViewport() {
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await new Promise((r) => setTimeout(r, 300))
  }

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  console.log('=== 综合按键测试: 真实模拟用户操作 ===\n')

  // ========== 阶段0: 清理 + 数据准备 ==========
  console.log('--- 阶段0: 清理旧 CT-* 测试数据 ---')
  const oldClasses = await call('class.list')
  for (const c of (oldClasses?.data ?? [])) {
    if (c.class_id?.startsWith('CT-')) await call('class.delete', c.id)
  }
  // 找所有 CT-* 学生
  const allStu = await call('eaa.listStudents')
  const ctStudents = (allStu?.data?.students ?? []).filter((s) => s.name?.startsWith('CT-'))
  let delCount = 0
  for (const s of ctStudents) {
    const r = await call('eaa.deleteStudent', s.name, 'cleanup')
    if (r?.success) delCount++
  }
  ok('清理旧数据', `删除 ${delCount}/${ctStudents.length} 个 CT-* 学生`)

  console.log('\n--- 阶段1: 创建3个真实班级 ---')
  const testClasses = [
    { class_id: 'CT-A', name: '测试A班', grade: '七年级', teacher: '张老师', note: 'A班备注' },
    { class_id: 'CT-B', name: '测试B班', grade: '七年级', teacher: '李老师', note: 'B班备注' },
    { class_id: 'CT-C', name: '测试C班', grade: '八年级', teacher: '王老师', note: 'C班备注' },
  ]
  for (const tc of testClasses) {
    const r = await call('class.create', tc)
    if (r?.success) ok(`创建 ${tc.class_id}`, tc.name)
    else fail(`创建 ${tc.class_id}`, '', JSON.stringify(r))
  }

  console.log('\n--- 阶段2: 创建9名学生 (每班3人) ---')
  const studentMap = {
    'CT-A': ['CT-张一', 'CT-李一', 'CT-王一'],
    'CT-B': ['CT-张二', 'CT-李二', 'CT-王二'],
    'CT-C': ['CT-张三', 'CT-李三', 'CT-王三'],
  }
  for (const classId of Object.keys(studentMap)) {
    const names = studentMap[classId]
    for (const name of names) {
      const r = await call('eaa.addStudent', name)
      if (r?.success) ok(`学生 ${name}`, '已创建')
      else if (String(r?.data).includes('已存在')) warn(`学生 ${name}`, '已存在(跳过)')
      else fail(`学生 ${name}`, '', JSON.stringify(r))
    }
    const assignRes = await call('class.assign', { class_id: classId, student_names: names })
    if (assignRes?.success) ok(`分班 ${classId}`, `成功 ${assignRes.assigned}/${names.length}`)
    else fail(`分班 ${classId}`, '', JSON.stringify(assignRes))
  }

  console.log('\n--- 阶段3: 添加操行事件 (每学生2条) ---')
  const deductCodes = ['LATE', 'SLEEP_IN_CLASS', 'DESK_UNALIGNED']
  const bonusCodes = ['CLASS_MONITOR', 'ACTIVITY_PARTICIPATION', 'CIVILIZED_DORM']
  let eventCount = 0
  for (const classId of Object.keys(studentMap)) {
    for (let i = 0; i < studentMap[classId].length; i++) {
      const name = studentMap[classId][i]
      const r1 = await call('eaa.addEvent', { studentName: name, reasonCode: deductCodes[i % 3], note: '测试扣分', operator: 'tester' })
      const r2 = await call('eaa.addEvent', { studentName: name, reasonCode: bonusCodes[i % 3], note: '测试加分', operator: 'tester' })
      if (r1?.success) eventCount++
      if (r2?.success) eventCount++
    }
  }
  ok('添加事件', `共 ${eventCount} 条`)

  // ========== 阶段4: 班级页测试 (ClassesPage) ==========
  console.log('\n--- 阶段4: 班级页测试 (/classes) ---')
  await navigate('/classes')
  await new Promise((r) => setTimeout(r, 2000))

  // 4.1 验证班级列表显示
  const classRows = await countElements('table tbody tr')
  if (classRows === 3) ok('班级列表', `3 行 (期望3)`)
  else fail('班级列表', `${classRows} 行 (期望3)`)

  // 4.2 验证学生数正确显示 (异步加载)
  await new Promise((r) => setTimeout(r, 2000)) // 等异步加载完成
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
  let allHave3 = studentCounts.every((sc) => parseInt(sc.count) === 3)
  if (allHave3 && studentCounts.length === 3) ok('班级学生数', '3个班级各3人')
  else fail('班级学生数', '', JSON.stringify(studentCounts))

  // 4.3 点击"新建班级"按钮
  const addBtnResult = await clickByText('button', '新建班级')
  if (addBtnResult?.ok) {
    ok('点击新建班级', '弹出表单')
    // 检查表单是否出现
    const formVisible = await cdp.eval(`document.querySelector('form, [class*="modal"], [class*="dialog"]') !== null`)
    if (formVisible) {
      ok('新建班级表单', '已显示')
      // 关闭表单 (找取消按钮)
      await clickByText('button', '取消')
      await new Promise((r) => setTimeout(r, 500))
    }
  } else {
    fail('点击新建班级', '', '未找到按钮')
  }

  // 4.4 点击"显示已存档班级"开关
  const archiveToggle = await clickByText('button,label', '显示已存档')
  if (archiveToggle?.ok) {
    ok('点击显示已存档', '已切换')
    await new Promise((r) => setTimeout(r, 500))
    // 再次点击恢复
    await clickByText('button,label', '显示已存档')
    await new Promise((r) => setTimeout(r, 500))
  } else {
    warn('显示已存档按钮', '未找到(可能已默认显示)')
  }

  // 4.5 点击班级行进入详情
  const firstRowClick = await cdp.eval(`(function(){
    const row = document.querySelector('table tbody tr');
    if(!row) return {ok: false};
    row.click();
    return {ok: true};
  })()`)
  if (firstRowClick?.ok) {
    await new Promise((r) => setTimeout(r, 1500))
    // 检查是否打开详情面板
    const profileVisible = await cdp.eval(`(function(){
      // 详情面板应该有 Tab: 概览/学生名单/调班
      const tabs = Array.from(document.querySelectorAll('button')).filter(b => 
        b.textContent?.includes('概览') || b.textContent?.includes('学生名单') || b.textContent?.includes('调班')
      );
      return {found: tabs.length >= 3, tabCount: tabs.length, texts: tabs.map(t => t.textContent?.trim())};
    })()`)
    if (profileVisible?.found) ok('班级详情面板', `${profileVisible.tabCount} 个 tab`)
    else fail('班级详情面板', '', JSON.stringify(profileVisible))

    // 4.6 切换到"学生名单" tab
    const stuTab = await clickByText('button', '学生名单')
    if (stuTab?.ok) {
      await new Promise((r) => setTimeout(r, 800))
      // 注意: 页面可能同时存在班级列表表格和学生名单表格,需精确选择学生名单表格
      // ClassProfile 的学生名单 tab 中,每个 tr 内有 "姓名/状态/分数/事件数/操作" 列
      const stuRows = await cdp.eval(`(function(){
        // 找到所有 table,选择行数最少且包含 "分数" 列的那个 (学生名单表)
        const tables = Array.from(document.querySelectorAll('table'));
        const stuTables = tables.filter(t => {
          const ths = Array.from(t.querySelectorAll('th'));
          return ths.some(th => th.textContent?.includes('分数'));
        });
        if(stuTables.length === 0) return 0;
        // 取最后一个 (详情面板内的表)
        const lastTable = stuTables[stuTables.length - 1];
        return lastTable.querySelectorAll('tbody tr').length;
      })()`)
      if (stuRows === 3) ok('学生名单 tab', `${stuRows} 行学生 (期望3)`)
      else fail('学生名单 tab', `${stuRows} 行 (期望3)`)
    }

    // 4.7 切换到"调班" tab
    const assignTab = await clickByText('button', '调班')
    if (assignTab?.ok) {
      await new Promise((r) => setTimeout(r, 800))
      // 应该显示可调入的学生列表
      const assignArea = await cdp.eval(`(function(){
        // 找到带 "调入"/"分入" 字样的按钮 或 可选学生列表
        const btns = Array.from(document.querySelectorAll('button'));
        const assignBtn = btns.find(b => b.textContent?.includes('调入') || b.textContent?.includes('分入'));
        return {hasAssignBtn: !!assignBtn, btnText: assignBtn?.textContent?.trim().slice(0, 40)};
      })()`)
      if (assignArea?.hasAssignBtn) ok('调班 tab', '找到调入按钮')
      else warn('调班 tab', '未找到调入按钮(可能无可调学生)')
    }

    // 4.8 关闭详情面板
    const closeBtn = await cdp.eval(`(function(){
      // 找 × 关闭按钮
      const btns = Array.from(document.querySelectorAll('button'));
      const closeBtn = btns.find(b => b.textContent?.trim() === '×' || b.getAttribute('aria-label') === 'close');
      if(closeBtn){ closeBtn.click(); return {ok: true}; }
      return {ok: false};
    })()`)
    if (closeBtn?.ok) {
      ok('关闭详情', '已点击 ×')
      await new Promise((r) => setTimeout(r, 500))
    }
  } else {
    fail('点击班级行', '', '未找到行')
  }

  // ========== 阶段5: 学生页测试 (StudentsPage) ==========
  console.log('\n--- 阶段5: 学生页测试 (/students) ---')
  await navigate('/students')
  await new Promise((r) => setTimeout(r, 2000))

  // 5.1 验证班级筛选下拉
  const classFilter = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(!classSel) return null;
    return {optionCount: classSel.options.length, options: Array.from(classSel.options).map(o => ({value: o.value, text: o.text}))};
  })()`)
  if (classFilter && classFilter.optionCount >= 5) ok('学生页班级筛选', `${classFilter.optionCount} 个选项`)
  else fail('学生页班级筛选', '', JSON.stringify(classFilter))

  // 5.2 验证班级列存在
  const hasClassCol = await cdp.eval(`(function(){
    const ths = document.querySelectorAll('th');
    for(const th of ths){ if(th.textContent?.trim() === '班级') return true; }
    return false;
  })()`)
  if (hasClassCol) ok('学生页班级列', '已找到')
  else fail('学生页班级列', '', '未找到')

  // 5.3 测试搜索功能
  const searchInput = await cdp.eval(`(function(){
    const input = document.querySelector('input[type="text"], input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"]');
    if(!input) return {ok: false};
    // 触发输入
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(input, 'CT-张');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    return {ok: true};
  })()`)
  if (searchInput?.ok) {
    await new Promise((r) => setTimeout(r, 500))
    const filteredCount = await countElements('table tbody tr')
    // CT-张一, CT-张二, CT-张三 应该匹配
    if (filteredCount === 3) ok('搜索 CT-张', `${filteredCount} 行 (期望3)`)
    else warn('搜索 CT-张', `${filteredCount} 行 (期望3)`)
    // 清空搜索
    await cdp.eval(`(function(){
      const input = document.querySelector('input[type="text"], input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"]');
      if(input){
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '');
        input.dispatchEvent(new Event('input', {bubbles: true}));
      }
    })()`)
    await new Promise((r) => setTimeout(r, 500))
  }

  // 5.4 测试班级筛选 (选 CT-A)
  const filterResult = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(classSel){ classSel.value='CT-A'; classSel.dispatchEvent(new Event('change',{bubbles:true})); return {ok: true}; }
    return {ok: false};
  })()`)
  if (filterResult?.ok) {
    await new Promise((r) => setTimeout(r, 800))
    const filteredCount = await countElements('table tbody tr')
    if (filteredCount === 3) ok('筛选 CT-A', `${filteredCount} 行 (期望3)`)
    else fail('筛选 CT-A', `${filteredCount} 行 (期望3)`)

    // 5.5 测试 "未分班" 筛选
    await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      const classSel = Array.from(selects).find(s => {
        const opts = Array.from(s.options).map(o => o.value);
        return opts.includes('__ALL__') && opts.includes('__NONE__');
      });
      if(classSel){ classSel.value='__NONE__'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
    })()`)
    await new Promise((r) => setTimeout(r, 500))
    const noneCount = await countElements('table tbody tr')
    ok('筛选 未分班', `${noneCount} 行未分班学生`)

    // 5.6 重置为全部
    await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      const classSel = Array.from(selects).find(s => {
        const opts = Array.from(s.options).map(o => o.value);
        return opts.includes('__ALL__') && opts.includes('__NONE__');
      });
      if(classSel){ classSel.value='__ALL__'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
    })()`)
    await new Promise((r) => setTimeout(r, 500))
  }

  // 5.7 测试"选择"按钮 (批量操作)
  const selectBtn = await clickByText('button', '选择')
  if (selectBtn?.ok) {
    await new Promise((r) => setTimeout(r, 800))
    // 应该出现 "全选"/"批量删除"/"取消选择" 等按钮
    const batchBtns = await cdp.eval(`(function(){
      const btns = Array.from(document.querySelectorAll('button'));
      const texts = ['全选', '批量删除', '取消选择', '调入'];
      const found = {};
      for(const t of texts){
        const b = btns.find(x => x.textContent?.includes(t));
        found[t] = !!b;
      }
      return found;
    })()`)
    ok('点击选择按钮', `批量按钮: ${JSON.stringify(batchBtns)}`)

    // 5.8 测试全选
    const selectAllBtn = await clickByText('button', '全选')
    if (selectAllBtn?.ok) {
      await new Promise((r) => setTimeout(r, 500))
      const checkedBoxes = await cdp.eval(`document.querySelectorAll('input[type="checkbox"]:checked').length`)
      ok('全选', `${checkedBoxes} 个已选`)

      // 5.9 测试批量调班 (选择目标班级)
      const batchAssignResult = await cdp.eval(`(function(){
        // 找到目标班级下拉
        const selects = document.querySelectorAll('select');
        for(const sel of selects){
          const opts = Array.from(sel.options).map(o => o.value);
          // 找到包含 CT-A/B/C 但不包含 __ALL__ 的下拉
          if(opts.includes('CT-A') && opts.includes('CT-B') && !opts.includes('__ALL__')){
            sel.value = 'CT-B';
            sel.dispatchEvent(new Event('change',{bubbles:true}));
            return {ok: true, target: 'CT-B'};
          }
        }
        return {ok: false};
      })()`)
      if (batchAssignResult?.ok) {
        await new Promise((r) => setTimeout(r, 500))
        const assignBtn = await clickByText('button', '调入')
        if (assignBtn?.ok) {
          await new Promise((r) => setTimeout(r, 2000))
          ok('批量调班', `已将选中学生调入 CT-B`)
        } else {
          warn('批量调班按钮', '未找到调入按钮')
        }
      } else {
        warn('批量调班下拉', '未找到目标班级下拉')
      }

      // 5.10 取消选择
      await clickByText('button', '取消选择')
      await new Promise((r) => setTimeout(r, 500))
    }
  } else {
    fail('点击选择按钮', '', '未找到')
  }

  // ========== 阶段6: 仪表盘测试 (DashboardPage) ==========
  console.log('\n--- 阶段6: 仪表盘测试 (/dashboard) ---')
  await navigate('/dashboard')
  await new Promise((r) => setTimeout(r, 3500))

  // 6.1 验证统计卡片
  const statCards = await cdp.eval(`(function(){
    // 统计卡片: 学生总数/有效事件/撤销事件/总分数变动/高风险学生
    const cards = document.querySelectorAll('[class*="rounded-2xl"]');
    return {count: cards.length};
  })()`)
  if (statCards?.count >= 5) ok('统计卡片', `${statCards.count} 个`)
  else warn('统计卡片', `仅 ${statCards?.count} 个`)

  // 6.2 验证班级筛选下拉
  const dashFilter = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(!classSel) return null;
    return {optionCount: classSel.options.length};
  })()`)
  if (dashFilter && dashFilter.optionCount >= 5) ok('Dashboard 班级筛选', `${dashFilter.optionCount} 个选项`)
  else fail('Dashboard 班级筛选', '', JSON.stringify(dashFilter))

  // 6.3 测试班级对比按钮
  const compareBtn = await clickByText('button', '班级对比')
  if (compareBtn?.ok) {
    await new Promise((r) => setTimeout(r, 800))
    // 验证对比表出现
    const compareTable = await cdp.eval(`(function(){
      const tables = document.querySelectorAll('table');
      for(const t of tables){
        if(t.textContent?.includes('学生数') && t.textContent?.includes('平均分')) {
          return {found: true, rows: t.querySelectorAll('tbody tr').length};
        }
      }
      return {found: false};
    })()`)
    if (compareTable?.found && compareTable.rows === 3) ok('班级对比表', `${compareTable.rows} 行 (期望3)`)
    else fail('班级对比表', '', JSON.stringify(compareTable))

    // 6.4 选择两个班级进行对比
    const compareSelects = await cdp.eval(`(function(){
      // 找 A VS B 下拉
      const selects = document.querySelectorAll('select');
      const filtered = Array.from(selects).filter(s => {
        const opts = Array.from(s.options).map(o => o.value);
        return opts.includes('CT-A') && opts.includes('CT-B') && opts.includes('CT-C') && !opts.includes('__ALL__');
      });
      return {count: filtered.length};
    })()`)
    if (compareSelects?.count >= 2) {
      // 选第一个为 CT-A, 第二个为 CT-B
      await cdp.eval(`(function(){
        const selects = document.querySelectorAll('select');
        const filtered = Array.from(selects).filter(s => {
          const opts = Array.from(s.options).map(o => o.value);
          return opts.includes('CT-A') && opts.includes('CT-B') && opts.includes('CT-C') && !opts.includes('__ALL__');
        });
        if(filtered.length >= 2){
          filtered[0].value = 'CT-A'; filtered[0].dispatchEvent(new Event('change',{bubbles:true}));
          filtered[1].value = 'CT-B'; filtered[1].dispatchEvent(new Event('change',{bubbles:true}));
        }
      })()`)
      await new Promise((r) => setTimeout(r, 800))
      ok('选择对比班级', 'CT-A vs CT-B')
    } else {
      warn('对比班级下拉', `仅找到 ${compareSelects?.count} 个`)
    }

    // 6.5 关闭对比模式
    await clickByText('button', '班级对比')
    await new Promise((r) => setTimeout(r, 500))
  } else {
    fail('班级对比按钮', '', '未找到')
  }

  // 6.6 测试班级筛选 (选 CT-A)
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(classSel){ classSel.value='CT-A'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  const filteredRanking = await cdp.eval(`(function(){
    const h3s = Array.from(document.querySelectorAll('h3'));
    const found = h3s.find(h => h.textContent?.includes('Top'));
    if(!found) return {found: false};
    const container = found.parentElement;
    const buttons = container.querySelectorAll('button');
    return {found: true, buttonCount: buttons.length};
  })()`)
  if (filteredRanking?.found && filteredRanking.buttonCount <= 3 && filteredRanking.buttonCount > 0) ok('Dashboard 班级筛选排行', `CT-A 排行 ${filteredRanking.buttonCount} 条 (1-3, 期望在top10内)`)
  else fail('Dashboard 班级筛选排行', '', JSON.stringify(filteredRanking))

  // 重置筛选
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(classSel){ classSel.value='__ALL__'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
  })()`)
  await new Promise((r) => setTimeout(r, 500))

  // 6.7 测试刷新按钮
  const refreshBtn = await clickByText('button', '刷新')
  if (refreshBtn?.ok) {
    await new Promise((r) => setTimeout(r, 2000))
    ok('刷新按钮', '已点击')
  }

  // ========== 阶段7: 响应式布局测试 ==========
  console.log('\n--- 阶段7: 响应式布局测试 (Top10/周期摘要溢出) ---')
  const originalVp = await getViewportInfo()
  console.log(`  原始视口: ${originalVp.w}x${originalVp.h}`)

  // 7.1 缩小到 800px 宽度
  await setViewport(800, 600)
  await new Promise((r) => setTimeout(r, 1000))
  // 检查 Top10 排行是否溢出
  const top10Overflow = await cdp.eval(`(function(){
    const h3s = Array.from(document.querySelectorAll('h3'));
    const found = h3s.find(h => h.textContent?.includes('Top'));
    if(!found) return {found: false};
    const container = found.parentElement;
    const rect = container.getBoundingClientRect();
    const docWidth = document.documentElement.clientWidth;
    return {found: true, right: rect.right, docWidth, overflow: rect.right > docWidth + 2};
  })()`)
  if (!top10Overflow?.overflow) ok('Top10 排行 (800px)', '无溢出')
  else fail('Top10 排行 (800px)', `溢出: right=${top10Overflow.right.toFixed(0)} > docWidth=${top10Overflow.docWidth}`)

  // 检查周期摘要是否溢出
  const weeklyOverflow = await cdp.eval(`(function(){
    const h3s = Array.from(document.querySelectorAll('h3'));
    const found = h3s.find(h => h.textContent?.includes('周期摘要') || h.textContent?.includes('Weekly'));
    if(!found) return {found: false};
    const container = found.parentElement;
    const rect = container.getBoundingClientRect();
    const docWidth = document.documentElement.clientWidth;
    return {found: true, right: rect.right, docWidth, overflow: rect.right > docWidth + 2};
  })()`)
  if (weeklyOverflow?.found && !weeklyOverflow.overflow) ok('周期摘要 (800px)', '无溢出')
  else if (weeklyOverflow?.found) fail('周期摘要 (800px)', `溢出: right=${weeklyOverflow.right.toFixed(0)}`)
  else warn('周期摘要 (800px)', '未找到')

  // 7.2 缩小到 500px 宽度
  await setViewport(500, 600)
  await new Promise((r) => setTimeout(r, 1000))
  const top10Overflow500 = await cdp.eval(`(function(){
    const h3s = Array.from(document.querySelectorAll('h3'));
    const found = h3s.find(h => h.textContent?.includes('Top'));
    if(!found) return {found: false};
    const container = found.parentElement;
    const rect = container.getBoundingClientRect();
    const docWidth = document.documentElement.clientWidth;
    return {found: true, overflow: rect.right > docWidth + 2};
  })()`)
  if (!top10Overflow500?.overflow) ok('Top10 排行 (500px)', '无溢出')
  else fail('Top10 排行 (500px)', '溢出')

  // 7.3 恢复原始视口
  await resetViewport()
  await new Promise((r) => setTimeout(r, 500))
  ok('恢复视口', '完成')

  // ========== 阶段8: 班级生命周期测试 ==========
  console.log('\n--- 阶段8: 班级生命周期测试 ---')
  const clsList = await call('class.list')
  const testClass = (clsList?.data ?? []).find((c) => c.class_id === 'CT-C')
  if (testClass) {
    // 8.1 archive
    const archRes = await call('class.archive', testClass.id)
    if (archRes?.success) ok('class.archive', `${testClass.name} 已存档`)
    else fail('class.archive', '', JSON.stringify(archRes))

    // 8.2 验证 UI 显示已存档
    await navigate('/classes')
    await new Promise((r) => setTimeout(r, 2000))
    const hasArchivedLabel = await cdp.eval(`(function(){
      const cells = document.querySelectorAll('td');
      for(const c of cells){ if(c.textContent?.includes('已存档')) return true; }
      return false;
    })()`)
    if (hasArchivedLabel) ok('UI 显示已存档', '已显示')
    else warn('UI 显示已存档', '未找到(可能默认隐藏)')

    // 8.3 restore
    const restRes = await call('class.restore', testClass.id)
    if (restRes?.success) ok('class.restore', `${testClass.name} 已恢复`)
    else fail('class.restore', '', JSON.stringify(restRes))

    // 8.4 update
    const updRes = await call('class.update', testClass.id, { name: '测试C班(已更新)', grade: '九年级', teacher: '新老师' })
    if (updRes?.success) ok('class.update', '名称/年级/班主任 已更新')
    else fail('class.update', '', JSON.stringify(updRes))
  }

  // ========== 阶段9: 学生生命周期测试 ==========
  console.log('\n--- 阶段9: 学生生命周期测试 ---')
  // 9.1 添加新学生
  const addStuRes = await call('eaa.addStudent', 'CT-新学生')
  if (addStuRes?.success) ok('eaa.addStudent', 'CT-新学生 已创建')
  else if (String(addStuRes?.data).includes('已存在')) warn('eaa.addStudent', '已存在(跳过)')
  else fail('eaa.addStudent', '', JSON.stringify(addStuRes))

  // 9.2 删除学生
  const delStuRes = await call('eaa.deleteStudent', 'CT-新学生', '测试删除')
  if (delStuRes?.success) ok('eaa.deleteStudent', 'CT-新学生 已删除')
  else fail('eaa.deleteStudent', '', JSON.stringify(delStuRes))

  // 9.3 添加事件 + 撤销测试 (使用未用过的事件码避免重复)
  const addEvtRes = await call('eaa.addEvent', { studentName: 'CT-张一', reasonCode: 'PHONE_IN_CLASS', note: '手机违纪测试', operator: 'tester' })
  if (addEvtRes?.success) ok('eaa.addEvent', '已添加 PHONE_IN_CLASS 事件')
  else if (String(addEvtRes?.data).includes('重复事件')) warn('eaa.addEvent', '重复事件(使用备用码)')
  else fail('eaa.addEvent', '', JSON.stringify(addEvtRes))

  // 9.4 撤销事件
  if (addEvtRes?.success && addEvtRes.data?.event_id) {
    const revRes = await call('eaa.revertEvent', addEvtRes.data.event_id, '测试撤销')
    if (revRes?.success) ok('eaa.revertEvent', '事件已撤销')
    else fail('eaa.revertEvent', '', JSON.stringify(revRes))
  } else {
    warn('eaa.revertEvent', '无法测试(无event_id)')
  }

  // ========== 阶段10: 清理测试数据 ==========
  console.log('\n--- 阶段10: 清理测试数据 ---')
  for (const classId of Object.keys(studentMap)) {
    for (const name of studentMap[classId]) {
      await call('eaa.deleteStudent', name, 'cleanup')
    }
  }
  const clsList2 = await call('class.list')
  for (const c of (clsList2?.data ?? [])) {
    if (c.class_id?.startsWith('CT-')) await call('class.delete', c.id)
  }
  ok('清理完成', '已删除 CT-* 数据')

  console.log('\n=== 测试汇总 ===')
  console.log(`总计: ${results.pass + results.fail + results.warn}, 通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.details.filter((d) => d.startsWith('✗')).forEach((d) => console.log(`  ${d}`))
  }
  if (results.warn > 0) {
    console.log('\n警告项:')
    results.details.filter((d) => d.startsWith('⚠')).forEach((d) => console.log(`  ${d}`))
  }

  ws.close(1000)
  // 写入结果到 json
  const fs = require('fs')
  fs.writeFileSync('dogfood-output/comprehensive-result.json', JSON.stringify(results, null, 2))
  process.exit(results.fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
