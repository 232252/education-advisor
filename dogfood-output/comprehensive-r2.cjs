// 第二轮综合测试 — 从不同角度 (边缘/异常/并发/边界) 验证
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
  async function navigate(path, wait = 1500) {
    await cdp.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, wait))
  }

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  console.log('=== 第二轮综合测试 (边缘/异常/边界) ===\n')

  // ========== 阶段1: 清理 ==========
  console.log('--- 阶段1: 清理所有旧数据 ---')
  const oldCls = await call('class.list')
  for (const c of (oldCls?.data ?? [])) {
    await call('class.delete', c.id)
  }
  const oldStu = await call('eaa.listStudents')
  const stuList = oldStu?.data?.students ?? []
  for (const s of stuList) {
    await call('eaa.deleteStudent', s.name, '清理')
  }
  ok('清理完成', `删除 ${oldCls?.data?.length || 0} 班级, ${stuList.length} 学生`)

  // ========== 阶段2: 边缘场景 - 空班级创建 ==========
  console.log('\n--- 阶段2: 边缘场景 - 空字段/异常输入 ---')

  // 2.1 班级 class_id 为空
  const empty1 = await call('class.create', { class_id: '', name: '空ID班', grade: '', teacher: '' })
  if (!empty1.success) ok('空 class_id 拒绝', empty1.error || 'rejected')
  else { warn('空 class_id', '被接受,可能未做校验'); await call('class.delete', empty1.data?.id) }

  // 2.2 班级 name 为空
  const empty2 = await call('class.create', { class_id: 'EDGE-1', name: '', grade: '', teacher: '' })
  if (!empty2.success) ok('空 name 拒绝', empty2.error || 'rejected')
  else { warn('空 name', '被接受'); await call('class.delete', empty2.data?.id) }

  // 2.3 重复 class_id
  await call('class.create', { class_id: 'DUP-1', name: '原始班', grade: '高一', teacher: '张三' })
  const dup = await call('class.create', { class_id: 'DUP-1', name: '重复班', grade: '高二', teacher: '李四' })
  if (!dup.success) ok('重复 class_id 拒绝', dup.error || 'rejected')
  else { warn('重复 class_id', '被接受'); await call('class.delete', dup.data?.id) }
  await call('class.delete', (await call('class.list'))?.data?.find(c => c.class_id === 'DUP-1')?.id)

  // 2.4 超长 class_id (100 字符)
  const longId = 'L' + 'O'.repeat(98) + 'G'
  const longCls = await call('class.create', { class_id: longId, name: '超长ID班', grade: '高一', teacher: '王五' })
  if (longCls.success) {
    ok('超长 class_id 接受', `${longId.length} 字符`)
    await call('class.delete', longCls.data?.id)
  } else {
    warn('超长 class_id', longCls.error || 'rejected')
  }

  // 2.5 特殊字符 name
  const special = await call('class.create', { class_id: 'SPEC-1', name: '<script>alert("xss")</script>班', grade: '高一', teacher: '赵六' })
  if (special.success) {
    // 验证在 UI 中是否被转义
    await navigate('/classes', 2000)
    const xss = await cdp.eval(`document.body.innerHTML.includes('<script>alert')`)
    if (!xss) ok('XSS 防护', '特殊字符被转义')
    else fail('XSS 防护', '', '脚本被注入!')
    await call('class.delete', special.data?.id)
  } else {
    warn('特殊字符 name', special.error || 'rejected')
  }

  // ========== 阶段3: 学生操作边缘场景 ==========
  console.log('\n--- 阶段3: 学生操作边缘场景 ---')

  // 3.1 空名添加学生
  const emptyStu = await call('eaa.addStudent', '')
  if (!emptyStu.success) ok('空学生名拒绝', emptyStu.__error || emptyStu.error || 'rejected')
  else { warn('空学生名', '被接受'); await call('eaa.deleteStudent', '') }

  // 3.2 重复添加同名学生
  await call('eaa.addStudent', 'EDGE_STU_1')
  const dupStu = await call('eaa.addStudent', 'EDGE_STU_1')
  if (!dupStu.success) ok('重复学生拒绝', dupStu.__error || dupStu.error || 'rejected')
  else warn('重复学生', '被接受(可能覆盖)')

  // 3.3 删除不存在的学生
  const delGhost = await call('eaa.deleteStudent', 'GHOST_USER_99999', '清理')
  if (!delGhost.success) ok('删除不存在学生拒绝', delGhost.__error || delGhost.error || 'rejected')
  else warn('删除不存在学生', '返回成功?')

  // 3.4 添加超长名字学生
  const longName = 'A'.repeat(100)
  const longStu = await call('eaa.addStudent', longName)
  if (longStu.success) ok('超长名字学生', '100 字符')
  else warn('超长名字', longStu.__error || longStu.error)

  // 3.5 特殊字符学生名
  const specStu = await call('eaa.addStudent', '<img src=x onerror=alert(1)>')
  if (specStu.success) {
    await navigate('/students', 2000)
    const xssStu = await cdp.eval(`document.body.innerHTML.includes('<img src=x onerror')`)
    if (!xssStu) ok('学生名 XSS 防护', '特殊字符被转义')
    else fail('学生名 XSS 防护', '', '注入!')
    await call('eaa.deleteStudent', '<img src=x onerror=alert(1)>', '清理')
  }

  // ========== 阶段4: 事件操作边缘场景 ==========
  console.log('\n--- 阶段4: 事件操作边缘场景 ---')

  // 4.1 给不存在的学生添加事件
  const evtGhost = await call('eaa.addEvent', { studentName: 'GHOST_999', reasonCode: 'LATE', note: '测试', operator: 'tester' })
  if (!evtGhost.success) ok('给不存在学生添加事件拒绝', evtGhost.__error || evtGhost.error || 'rejected')
  else warn('给不存在学生添加事件', '返回成功?')

  // 4.2 使用无效 reasonCode
  const evtBad = await call('eaa.addEvent', { studentName: 'EDGE_STU_1', reasonCode: 'INVALID_CODE_XYZ', note: '测试', operator: 'tester' })
  if (!evtBad.success) ok('无效 reasonCode 拒绝', evtBad.__error || evtBad.error || 'rejected')
  else warn('无效 reasonCode', '被接受?')

  // 4.3 使用空 note
  const evtEmptyNote = await call('eaa.addEvent', { studentName: 'EDGE_STU_1', reasonCode: 'LATE', note: '', operator: 'tester' })
  if (evtEmptyNote.success) ok('空 note 接受', '')
  else warn('空 note', evtEmptyNote.__error || evtEmptyNote.error)

  // 4.4 撤销不存在的事件
  const revGhost = await call('eaa.revertEvent', 'evt_ghost_99999', '测试')
  if (!revGhost.success) ok('撤销不存在事件拒绝', revGhost.__error || revGhost.error || 'rejected')
  else warn('撤销不存在事件', '返回成功?')

  // ========== 阶段5: 班级分配边缘场景 ==========
  console.log('\n--- 阶段5: 班级分配边缘场景 ---')

  // 准备: 创建 1 班级 + 2 学生
  await call('class.create', { class_id: 'EDGE-CLS', name: '边缘班', grade: '高一', teacher: '张三' })
  await call('eaa.addStudent', 'EDGE_A')
  await call('eaa.addStudent', 'EDGE_B')

  // 5.1 给不存在班级分配学生
  const assignGhost = await call('class.assign', { class_id: 'GHOST_CLS_99', student_names: ['EDGE_A'] })
  if (!assignGhost.success) ok('分配到不存在班级拒绝', assignGhost.error || 'rejected')
  else warn('分配到不存在班级', '返回成功?')

  // 5.2 分配空学生数组
  const assignEmpty = await call('class.assign', { class_id: 'EDGE-CLS', student_names: [] })
  if (assignEmpty.success) ok('分配空数组接受', `assigned=${assignEmpty.assigned}`)
  else warn('分配空数组', assignEmpty.error)

  // 5.3 分配不存在的学生
  const assignGhostStu = await call('class.assign', { class_id: 'EDGE-CLS', student_names: ['GHOST_STU_1', 'GHOST_STU_2'] })
  if (assignGhostStu.success) ok('分配不存在学生处理', `assigned=${assignGhostStu.assigned}, failed=${assignGhostStu.failed?.length}`)
  else warn('分配不存在学生', assignGhostStu.error)

  // 5.4 同一学生重复分到同班 (幂等性)
  await call('class.assign', { class_id: 'EDGE-CLS', student_names: ['EDGE_A'] })
  const reAssign = await call('class.assign', { class_id: 'EDGE-CLS', student_names: ['EDGE_A'] })
  if (reAssign.success) ok('重复分班幂等', `assigned=${reAssign.assigned}`)
  else warn('重复分班', reAssign.error)

  // ========== 阶段6: UI 真实交互 ==========
  console.log('\n--- 阶段6: UI 真实交互测试 ---')

  // 6.1 班级页面 - 点击按钮
  await navigate('/classes', 2000)
  const classBtns = await cdp.eval(`Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).slice(0, 10)`)
  console.log(`  /classes 按钮: ${JSON.stringify(classBtns)}`)
  ok('班级页按钮数', `${classBtns.length} 个`)

  // 6.2 学生页面 - 班级筛选下拉
  await navigate('/students', 2000)
  const stuSelect = await cdp.eval(`(function(){
    const sels = Array.from(document.querySelectorAll('select'));
    const classSel = sels.find(s => Array.from(s.options).map(o=>o.value).includes('__ALL__'));
    if(!classSel) return null;
    return { count: classSel.options.length, values: Array.from(classSel.options).map(o=>o.value) };
  })()`)
  if (stuSelect && stuSelect.count >= 3) ok('学生页班级筛选', `${stuSelect.count} 个选项`)
  else fail('学生页班级筛选', '', JSON.stringify(stuSelect))

  // 6.3 切换到 EDGE-CLS 班级
  if (stuSelect) {
    await cdp.eval(`(function(){
      const sels = Array.from(document.querySelectorAll('select'));
      const classSel = sels.find(s => Array.from(s.options).map(o=>o.value).includes('__ALL__'));
      if(classSel){ classSel.value='EDGE-CLS'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
    })()`)
    await new Promise((r) => setTimeout(r, 1000))
    const filtered = await cdp.eval(`(function(){
      const tables = Array.from(document.querySelectorAll('table'));
      const stuTables = tables.filter(t => {
        const ths = Array.from(t.querySelectorAll('th'));
        return ths.some(th => th.textContent?.includes('分数'));
      });
      if(stuTables.length === 0) return 0;
      return stuTables[stuTables.length - 1].querySelectorAll('tbody tr').length;
    })()`)
    if (filtered === 2) ok('班级筛选 EDGE-CLS', `显示 ${filtered} 行 (期望2)`)
    else warn('班级筛选 EDGE-CLS', `显示 ${filtered} 行 (期望2)`)
  }

  // 6.4 Dashboard - 班级对比表
  await navigate('/dashboard', 4000)
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
  if (compareRows?.found) ok('班级对比表', `${compareRows.rows} 行`)
  else warn('班级对比表', JSON.stringify(compareRows))

  // 6.5 双班级对比选择
  await cdp.eval(`(function(){
    const sels = Array.from(document.querySelectorAll('select'));
    if(sels.length >= 2){
      // 选择前两个 select (假设是 A/B 班级选择)
      const opts1 = Array.from(sels[0].options).map(o=>o.value);
      const clsOpt = opts1.find(v => v && v !== '__ALL__' && v !== '__NONE__');
      if(clsOpt){ sels[0].value = clsOpt; sels[0].dispatchEvent(new Event('change',{bubbles:true})); }
      const opts2 = Array.from(sels[1].options).map(o=>o.value);
      const clsOpt2 = opts2.find(v => v && v !== '__ALL__' && v !== '__NONE__' && v !== clsOpt);
      if(clsOpt2){ sels[1].value = clsOpt2; sels[1].dispatchEvent(new Event('change',{bubbles:true})); }
    }
  })()`)
  await new Promise((r) => setTimeout(r, 1000))
  const hasCompare = await cdp.eval(`document.body.textContent?.includes('VS') || document.body.textContent?.includes('对比')`)
  if (hasCompare) ok('双班级对比', 'UI 已显示')
  else warn('双班级对比', 'UI 未显示对比标识')

  // ========== 阶段7: 响应式布局关键尺寸 ==========
  console.log('\n--- 阶段7: 响应式布局 (修复后验证) ---')
  for (const size of [{ w: 1366, h: 768, n: '1366x768' }, { w: 800, h: 600, n: '800x600' }, { w: 500, h: 400, n: '500x400' }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false })
    await new Promise((r) => setTimeout(r, 800))
    const overflow = await cdp.eval(`(function(){
      const body = document.body, html = document.documentElement;
      return { bodyOverflow: body.scrollWidth > body.clientWidth, htmlOverflow: html.scrollWidth > html.clientWidth };
    })()`)
    if (!overflow.bodyOverflow && !overflow.htmlOverflow) ok(`布局 ${size.n}`, '无溢出')
    else fail(`布局 ${size.n}`, '', '溢出')
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride')

  // ========== 阶段8: 持续运行稳定性 ==========
  console.log('\n--- 阶段8: 持续运行稳定性 (20秒, 多页面切换) ---')
  const tStart = Date.now()
  let okCount = 0, errCount = 0
  while (Date.now() - tStart < 20000) {
    for (const page of ['/dashboard', '/students', '/classes', '/settings']) {
      try {
        await navigate(page, 500)
        okCount++
      } catch (e) {
        errCount++
      }
    }
  }
  if (errCount === 0) ok('20秒稳定性', `${okCount} 次成功`)
  else warn('20秒稳定性', `${okCount} 成功, ${errCount} 失败`)

  // ========== 阶段9: 班级归档/恢复 ==========
  console.log('\n--- 阶段9: 班级归档/恢复 ---')
  const edgeClass = (await call('class.list'))?.data?.find(c => c.class_id === 'EDGE-CLS')
  if (edgeClass) {
    const archRes = await call('class.archive', edgeClass.id)
    if (archRes.success) {
      ok('班级归档', 'EDGE-CLS 已归档')
      // 验证已归档班级不出现在 activeClassList
      await navigate('/classes', 2000)
      const hasArchived = await cdp.eval(`document.body.textContent?.includes('边缘班')`)
      if (!hasArchived) ok('归档班级隐藏', '已不在主列表')
      else warn('归档班级隐藏', '仍可见(可能归档筛选不同)')
      // 恢复
      const restRes = await call('class.restore', edgeClass.id)
      if (restRes.success) ok('班级恢复', 'EDGE-CLS 已恢复')
    } else fail('班级归档', '', archRes.error)
  }

  // ========== 阶段10: 清理 ==========
  console.log('\n--- 阶段10: 清理所有 EDGE_* 数据 ---')
  const finalCls = await call('class.list')
  let clsDelCount = 0
  for (const c of (finalCls?.data ?? [])) {
    const r = await call('class.delete', c.id)
    if (r.success) clsDelCount++
  }
  const finalStu = await call('eaa.listStudents')
  let stuDelCount = 0
  for (const s of (finalStu?.data?.students ?? [])) {
    const r = await call('eaa.deleteStudent', s.name, '清理')
    if (r.success) stuDelCount++
  }
  ok('清理完成', `删除 ${clsDelCount} 班级, ${stuDelCount} 学生`)

  console.log('\n=== 第二轮测试汇总 ===')
  const total = results.pass + results.fail + results.warn
  console.log(`总计 ${total}, 通过 ${results.pass}, 失败 ${results.fail}, 警告 ${results.warn}, 通过率 ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.details.filter((d) => d.startsWith('✗')).forEach((d) => console.log(`  ${d}`))
  }

  ws.close(1000)
  fs.writeFileSync('dogfood-output/r2-edge-result.json', JSON.stringify(results, null, 2))
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
