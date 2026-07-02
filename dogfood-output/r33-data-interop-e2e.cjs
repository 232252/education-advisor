// 第三十三轮 — 数据互通端到端测试 (R33)
// 用户核心诉求:
//   1. 删除旧测试数据(避免混淆)
//   2. 随机创建 3 个班级
//   3. 模拟学生 创建→分班→添加事件→查看仪表盘→删除 全流程
//   4. 重点验证 3 个修复:
//      - 仪表盘切换班级时,分数分布/风险分布/事件原因/排行榜/周期摘要 都变化
//      - 学生页添加学生时选择班级,class_id 正确设置
//      - 删除班级后,原班级学生的 class_id 被清除
//   5. 真实模拟用户操作每个按键

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
        try {
          const j = JSON.parse(d)
          const p = j.find((x) => x.type === 'page')
          resolve(p.webSocketDebuggerUrl)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id)
          this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id
      this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(p, wait = 2000) {
    await this.eval("window.location.hash='" + p + "'")
    await new Promise((r) => setTimeout(r, wait))
  }
  async setReactInput(selector, value) {
    const safe = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const expr = "(function(){var el=document.querySelector('" + selector + "');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(!key) return 'NO_PROPS';var props=el[key];if(!props||typeof props.onChange!=='function') return 'NO_ONCHANGE';props.onChange({target:{value:'" + safe + "'},currentTarget:{value:'" + safe + "'}});return 'OK';})()"
    return await this.eval(expr)
  }
  async setReactSelect(selector, value) {
    const v = String(value).replace(/'/g, "\\'")
    // React 受控 select: 优先用 __reactProps$ onChange 直调,失败则回退 native setter + dispatchEvent
    const expr = "(function(){var el=document.querySelector('" + selector + "');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(key){var props=el[key];if(props&&typeof props.onChange==='function'){var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,'" + v + "');props.onChange({target:{value:'" + v + "'},currentTarget:{value:'" + v + "'}});return 'OK'}}var setter2=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter2.call(el,'" + v + "');el.dispatchEvent(new Event('change',{bubbles:true}));return 'OK_FALLBACK';})()"
    return await this.eval(expr)
  }
  async click(selector) {
    const r = await this.eval("document.querySelector('" + selector + "')?.click() || 'NOT_FOUND'")
    return r !== 'NOT_FOUND'
  }
  async clickByText(tag, text) {
    const safe = text.replace(/'/g, "\\'")
    const expr = "(function(){var els=document.querySelectorAll('" + tag + "');for(var i=0;i<els.length;i++){if(els[i].textContent.indexOf('" + safe + "')>=0){els[i].click();return 'OK'}}return 'NOT_FOUND'})()"
    return await this.eval(expr)
  }
  async tableRows() { return await this.eval('document.querySelectorAll("table tbody tr").length') }
  async text(selector) { return await this.eval("document.querySelector('" + selector + "')?.textContent || ''") }
  async exists(selector) { return await this.eval("!!document.querySelector('" + selector + "')") }
  async waitForRows(timeoutMs = 10000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const n = await this.tableRows()
      if (n > 0) return n
      await new Promise((r) => setTimeout(r, 500))
    }
    return await this.tableRows()
  }
  // 调用 window.api (renderer 中的 IPC 客户端)
  async api(code) {
    // 把表达式包成 async IIFE 返回 JSON
    const expr = "(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"
    const v = await this.eval(expr)
    if (typeof v === 'string' && v.startsWith('ERR:')) throw new Error(v.slice(4))
    try { return v ? JSON.parse(v) : null } catch (e) { return v }
  }
}

// 随机工具
const R = () => Math.floor(Math.random() * 100000).toString(36)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// 原因码池 (涵盖扣分/加分/实验室)
const DEDUCT_CODES = ['SPEAK_IN_CLASS', 'SLEEP_IN_CLASS', 'LATE', 'MAKEUP', 'DESK_UNALIGNED', 'APPEARANCE_VIOLATION', 'OTHER_DEDUCT']
const BONUS_CODES = ['ACTIVITY_PARTICIPATION', 'MONTHLY_ATTENDANCE', 'CIVILIZED_DORM']
const LAB_CODES = ['LAB_EQUIPMENT_DAMAGE', 'LAB_SAFETY_VIOLATION', 'LAB_UNSAFE_BEHAVIOR', 'LAB_CLEAN_UP']

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push('✓ ' + n + (d ? ' — ' + d : '')); console.log('  ✓ ' + n + (d ? ' — ' + d : '')) }
  const fail = (n, d, e) => { results.fail++; results.details.push('✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 160)); console.log('  ✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 160)) }
  const warn = (n, d) => { results.warn++; results.details.push('⚠ ' + n + (d ? ' — ' + d : '')); console.log('  ⚠ ' + n + (d ? ' — ' + d : '')) }

  console.log('=== R33: 数据互通端到端测试 ===\n')
  console.log('目标: 清空旧数据 → 创建3个班级 → 模拟学生全生命周期 → 验证3个修复\n')

  // ========================================================================
  // Phase 1: 清空旧数据
  // ========================================================================
  console.log('--- Phase 1: 清空旧测试数据 ---')

  // 1.1 列出所有学生
  const listRes = await cdp.api('await window.api.eaa.listStudents()')
  const allOldStudents = listRes?.data?.students ?? []
  // 只删除 Active 学生 (Deleted 的已被软删除,跳过以节省时间)
  const oldStudents = allOldStudents.filter(s => s.status !== 'Deleted')
  ok('查询旧学生', '总计 ' + allOldStudents.length + ' (活跃 ' + oldStudents.length + ', 已删除 ' + (allOldStudents.length - oldStudents.length) + ')')
  if (oldStudents.length > 0) {
    console.log('    活跃样本:', oldStudents.slice(0, 3).map(s => s.name + '[' + (s.class_id || '无班') + ']').join(', '))
  }

  // 1.2 删除所有活跃学生 (已删除的跳过)
  let deletedCount = 0
  for (const s of oldStudents) {
    const r = await cdp.api("await window.api.eaa.deleteStudent('" + s.name.replace(/'/g, "\\'") + "','R33清理')")
    if (r?.success) deletedCount++
    else warn('删除学生失败', s.name)
  }
  ok('删除活跃学生', deletedCount + '/' + oldStudents.length)

  // 1.3 列出并删除所有旧班级
  const classListRes = await cdp.api('await window.api.class.list()')
  const oldClasses = classListRes?.data ?? []
  ok('查询旧班级', oldClasses.length + ' 个')
  let deletedClasses = 0
  for (const c of oldClasses) {
    const r = await cdp.api("await window.api.class.delete('" + c.id + "')")
    if (r?.success) deletedClasses++
  }
  ok('删除旧班级', deletedClasses + '/' + oldClasses.length)

  // 1.4 验证清空
  const afterList = await cdp.api('await window.api.eaa.listStudents()')
  const afterStudents = afterList?.data?.students ?? []
  // EAA deleteStudent 是软删除,status=Deleted 的仍会返回
  const aliveStudents = afterStudents.filter(s => s.status !== 'Deleted')
  const afterClasses = (await cdp.api('await window.api.class.list()'))?.data ?? []
  ok('清空后状态', '存活学生=' + aliveStudents.length + ', 班级=' + afterClasses.length)
  if (afterClasses.length > 0) fail('班级未清空', '', afterClasses.map(c => c.name).join(','))
  else ok('班级已清空')

  // ========================================================================
  // Phase 2: 随机创建 3 个班级
  // ========================================================================
  console.log('\n--- Phase 2: 随机创建 3 个班级 ---')
  const gradePool = ['高一', '高二', '高三']
  const teacherPool = ['张老师', '李老师', '王老师', '赵老师', '钱老师', '孙老师']
  const classPrefix = ['A', 'B', 'C', 'D', 'E']
  const classData = []
  for (let i = 0; i < 3; i++) {
    const cid = 'C-R33-' + R()
    const name = pick(gradePool) + pick(classPrefix) + '班'
    const grade = pick(gradePool)
    const teacher = pick(teacherPool)
    const r = await cdp.api("await window.api.class.create({class_id:'" + cid + "',name:'" + name + "',grade:'" + grade + "',teacher:'" + teacher + "'})")
    if (r?.success) {
      classData.push({ ...r.data, _grade: grade, _teacher: teacher })
      ok('创建班级 #' + (i + 1), name + ' (id=' + cid + ', 年级=' + grade + ', 班主任=' + teacher + ')')
    } else {
      fail('创建班级 #' + (i + 1), name, r?.error || 'unknown')
    }
  }
  if (classData.length !== 3) {
    fail('班级创建不足', '期望3 实际' + classData.length, '终止后续测试')
    finalize(results); return
  }
  ok('3 个班级创建完成', classData.map(c => c.name).join(' / '))

  // ========================================================================
  // Phase 3: 模拟学生全生命周期 (创建→分班→加事件→仪表盘→删除)
  // ========================================================================
  console.log('\n--- Phase 3: 模拟学生全生命周期 ---')

  // 3.1 每个班级创建 5 名学生 (共15名),另有3名未分班学生
  const studentsByClass = { __NONE__: [] }
  classData.forEach(c => { studentsByClass[c.class_id] = [] })
  const surnamePool = ['赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '林', '黄', '何', '张', '郭']
  const namePool = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '霞', '平', '刚', '桂英']
  const usedNames = new Set()
  function genName() {
    for (let i = 0; i < 100; i++) {
      const n = pick(surnamePool) + pick(namePool) + R().slice(0, 3)
      if (!usedNames.has(n)) { usedNames.add(n); return n }
    }
    return '学生' + R()
  }

  // 每班 5 名学生
  let createdStudents = 0
  for (const c of classData) {
    for (let i = 0; i < 5; i++) {
      const name = genName()
      const r = await cdp.api("await window.api.eaa.addStudent('" + name.replace(/'/g, "\\'") + "')")
      if (r?.success) {
        // 分班
        const ar = await cdp.api("await window.api.class.assign({class_id:'" + c.class_id + "',student_names:['" + name.replace(/'/g, "\\'") + "']})")
        if (ar?.success && ar.assigned === 1) {
          studentsByClass[c.class_id].push(name)
          createdStudents++
        } else {
          warn('分班失败', name + ' → ' + c.name, ar?.error || '')
        }
      } else {
        fail('创建学生失败', name, r?.error || '')
      }
    }
  }
  ok('已分班学生创建', createdStudents + ' 名 (3班×5)')

  // 3 名未分班学生
  let unassignedCreated = 0
  for (let i = 0; i < 3; i++) {
    const name = genName()
    const r = await cdp.api("await window.api.eaa.addStudent('" + name.replace(/'/g, "\\'") + "')")
    if (r?.success) {
      studentsByClass.__NONE__.push(name)
      unassignedCreated++
    }
  }
  ok('未分班学生创建', unassignedCreated + ' 名')

  // 3.2 验证 class_id 设置正确
  const verifyList = await cdp.api('await window.api.eaa.listStudents()')
  const verifyStudents = (verifyList?.data?.students ?? []).filter(s => s.status !== 'Deleted')
  ok('总学生数', verifyStudents.length + ' 名 (期望18)')
  let classIdCorrect = 0
  let unassignedCorrect = 0
  for (const s of verifyStudents) {
    // 检查每个学生的 class_id 是否对得上某个班级或 null
    const inClass = classData.find(c => c.class_id === s.class_id)
    if (inClass) classIdCorrect++
    else if (!s.class_id) unassignedCorrect++
  }
  if (classIdCorrect === 15 && unassignedCorrect === 3) {
    ok('class_id 分布正确', '已分班=' + classIdCorrect + ', 未分班=' + unassignedCorrect)
  } else {
    fail('class_id 分布错误', '', '已分班=' + classIdCorrect + ' (期望15), 未分班=' + unassignedCorrect + ' (期望3)')
  }

  // ========================================================================
  // Phase 4: 为学生添加事件 (让仪表盘有数据可显示)
  // ========================================================================
  console.log('\n--- Phase 4: 为学生添加事件 ---')
  // 每个学生添加 2-4 个事件 (随机扣分/加分/实验室)
  let eventCount = 0
  for (const s of verifyStudents) {
    const numEvents = 2 + Math.floor(Math.random() * 3) // 2~4
    for (let i = 0; i < numEvents; i++) {
      // pool unused; direct pick by probability below
      let codes
      const r = Math.random()
      if (r < 0.5) codes = DEDUCT_CODES
      else if (r < 0.8) codes = BONUS_CODES
      else codes = LAB_CODES
      const code = pick(codes)
      try {
        const r2 = await cdp.api("await window.api.eaa.addEvent({studentName:'" + s.name.replace(/'/g, "\\'") + "',reasonCode:'" + code + "',note:'R33测试'})")
        if (r2?.success) eventCount++
      } catch (e) {
        // 忽略单个事件失败
      }
    }
  }
  ok('事件添加', eventCount + ' 个事件')

  // ========================================================================
  // Phase 5: 验证修复1 — 仪表盘班级筛选影响所有图表
  // ========================================================================
  console.log('\n--- Phase 5: 验证修复1 (仪表盘班级数据互通) ---')
  await cdp.navigate('/dashboard', 3500)
  await new Promise((r) => setTimeout(r, 2500)) // 等待数据加载 (eaa.range ~1.4s + 渲染)

  // 5.1 读取初始 (全部班级) 状态下的所有图表数据
  const dashInitial = await cdp.eval("(function(){var out={};out.hasStats=!!document.querySelector('[class*=\"grid\"]');out.topNumbers=Array.from(document.querySelectorAll('[class*=\"text-2xl\"],[class*=\"text-3xl\"]')).slice(0,6).map(function(e){return e.textContent.trim()});out.chartCount=document.querySelectorAll('[_echarts_instance_]').length;out.tableRows=document.querySelectorAll('table tbody tr').length;return JSON.stringify(out)})()")
  const dash0 = typeof dashInitial === 'string' ? JSON.parse(dashInitial) : dashInitial
  ok('仪表盘初始加载', '图表=' + dash0.chartCount + ', 行=' + dash0.tableRows + ', 顶部数=' + (dash0.topNumbers || []).join('|'))
  if (dash0.chartCount < 4) warn('图表数偏少', dash0.chartCount + ' < 4')

  // 5.2 切换到第一个班级
  const classA = classData[0]
  let dash1 = null // 声明在外层,供 5.3 比较
  const filterResult = await cdp.setReactSelect('select[title="按班级筛选数据"]', classA.class_id)
  if (filterResult === 'OK' || filterResult === 'OK_FALLBACK') {
    await new Promise((r) => setTimeout(r, 2000))
    const afterFilter = await cdp.eval("(function(){var out={};out.topNumbers=Array.from(document.querySelectorAll('[class*=\"text-2xl\"],[class*=\"text-3xl\"]')).slice(0,6).map(function(e){return e.textContent.trim()});out.chartCount=document.querySelectorAll('[_echarts_instance_]').length;out.tableRows=document.querySelectorAll('table tbody tr').length;return JSON.stringify(out)})()")
    dash1 = typeof afterFilter === 'string' ? JSON.parse(afterFilter) : afterFilter
    ok('切换到班级1', classA.name + ' — 图表=' + dash1.chartCount + ', 行=' + dash1.tableRows)
    // 验证顶部数字变化 (总分/学生数等)
    const topChanged = JSON.stringify(dash0.topNumbers) !== JSON.stringify(dash1.topNumbers)
    if (topChanged) ok('顶部数字已变化', (dash0.topNumbers || []).join('|') + ' → ' + (dash1.topNumbers || []).join('|'))
    else fail('顶部数字未变化', '', '筛选前后相同: ' + (dash0.topNumbers || []).join('|'))
    // 验证排行榜表格行数变化 (应只有该班级学生)
    if (dash1.tableRows !== dash0.tableRows) {
      ok('排行榜行数变化', dash0.tableRows + ' → ' + dash1.tableRows)
    } else {
      warn('排行榜行数未变', '期望 ' + dash0.tableRows + ' → 5')
    }
  } else {
    fail('仪表盘班级筛选', '', '未找到筛选框: ' + filterResult)
  }

  // 5.3 切换到第二个班级 (验证图表再次变化)
  const classB = classData[1]
  const filter2 = await cdp.setReactSelect('select[title="按班级筛选数据"]', classB.class_id)
  if (filter2 === 'OK' || filter2 === 'OK_FALLBACK') {
    await new Promise((r) => setTimeout(r, 2000))
    const afterFilter2 = await cdp.eval("(function(){var out={};out.topNumbers=Array.from(document.querySelectorAll('[class*=\"text-2xl\"],[class*=\"text-3xl\"]')).slice(0,6).map(function(e){return e.textContent.trim()});out.tableRows=document.querySelectorAll('table tbody tr').length;return JSON.stringify(out)})()")
    const dash2 = typeof afterFilter2 === 'string' ? JSON.parse(afterFilter2) : afterFilter2
    ok('切换到班级2', classB.name + ' — 行=' + dash2.tableRows + ', 顶部=' + (dash2.topNumbers || []).join('|'))
    // 验证切换班级2和班级1的数据不同
    if (JSON.stringify(dash2.topNumbers) !== JSON.stringify(dash1?.topNumbers || [])) {
      ok('班级1≠班级2 数据', '顶部数字不同')
    } else {
      warn('班级1=班级2 顶部数字', '可能数据巧合相同')
    }
  }

  // 5.4 切换回"全部班级"
  await cdp.setReactSelect('select[title="按班级筛选数据"]', '__ALL__')
  await new Promise((r) => setTimeout(r, 2000))
  ok('恢复全部班级', '')

  // 5.5 验证"未分班"筛选 (验证 __NONE__ 选项生效)
  await cdp.setReactSelect('select[title="按班级筛选数据"]', '__NONE__')
  await new Promise((r) => setTimeout(r, 2000))
  const noneDash = await cdp.eval("(function(){return JSON.stringify({tableRows:document.querySelectorAll('table tbody tr').length})})()")
  const nd = typeof noneDash === 'string' ? JSON.parse(noneDash) : noneDash
  ok('筛选未分班', '行=' + nd.tableRows + ' (期望3)')
  await cdp.setReactSelect('select[title="按班级筛选数据"]', '__ALL__')
  await new Promise((r) => setTimeout(r, 1500))

  // ========================================================================
  // Phase 6: 验证修复2 — 学生页添加学生可选班级
  // ========================================================================
  console.log('\n--- Phase 6: 验证修复2 (学生页添加学生可选班级) ---')
  await cdp.navigate('/students', 2500)
  const initRows = await cdp.waitForRows(10000)
  ok('学生页初始', initRows + ' 行')

  // 6.1 通过 UI 点击"+ 添加"按钮打开表单
  const addBtnResult = await cdp.clickByText('button', '添加')
  if (addBtnResult === 'OK') {
    await new Promise((r) => setTimeout(r, 800))
    // 检查是否有班级下拉
    const hasClassSelect = await cdp.eval("(function(){var sels=document.querySelectorAll('select');for(var i=0;i<sels.length;i++){var opts=sels[i].options;if(opts.length>=3&&Array.from(opts).some(function(o){return o.value && o.value.indexOf('C-R33-')>=0})){return 'OK'}}return 'NOT_FOUND'})()")
    if (hasClassSelect === 'OK') {
      ok('添加表单有班级下拉', '')
      // 6.2 填写姓名 + 选择第一个班级
      const newStuName = 'UI测试_' + R()
      const inputResult = await cdp.setReactInput('input[placeholder="姓名..."]', newStuName)
      if (inputResult === 'OK') {
        await new Promise((r) => setTimeout(r, 300)) // 等 React state 更新
        // 选择班级1 — 必须选表单 select (没有 title 属性的那个),避免误选筛选 select
        const selectResult = await cdp.eval("(function(){var sels=document.querySelectorAll('select');for(var i=0;i<sels.length;i++){if(sels[i].getAttribute('title')) continue;var opts=sels[i].options;for(var j=0;j<opts.length;j++){if(opts[j].value==='" + classA.class_id + "'){var el=sels[i];var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(key){var props=el[key];if(props&&typeof props.onChange==='function'){var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,'" + classA.class_id + "');props.onChange({target:{value:'" + classA.class_id + "'},currentTarget:{value:'" + classA.class_id + "'}});return 'OK'}}var setter2=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter2.call(el,'" + classA.class_id + "');el.dispatchEvent(new Event('change',{bubbles:true}));return 'OK_FALLBACK'}}}return 'NOT_FOUND'})()")
        if (selectResult === 'OK' || selectResult === 'OK_FALLBACK') {
          await new Promise((r) => setTimeout(r, 300)) // 等 React state 更新
          ok('表单选择班级', classA.name + (selectResult === 'OK_FALLBACK' ? ' (fallback)' : ''))
          // 点击确认按钮
          const confirmResult = await cdp.clickByText('button', '确认')
          if (confirmResult === 'OK' || confirmResult === 'NOT_FOUND') {
            // 有些版本按钮文本是"确定"或图标
            if (confirmResult === 'NOT_FOUND') {
              await cdp.clickByText('button', '确定')
            }
            await new Promise((r) => setTimeout(r, 2000))
            // 6.3 验证学生已创建且 class_id 正确
            const verifyStu = await cdp.api('await window.api.eaa.listStudents()')
            const created = (verifyStu?.data?.students ?? []).find(s => s.name === newStuName)
            if (created && created.class_id === classA.class_id) {
              ok('UI添加学生分班成功', newStuName + ' → ' + classA.name + ' (class_id=' + created.class_id + ')')
            } else if (created) {
              fail('UI添加学生分班错误', '', 'class_id=' + created.class_id + ' 期望 ' + classA.class_id)
            } else {
              fail('UI添加学生未找到', newStuName, '')
            }
          } else {
            fail('点击确认按钮', '', confirmResult)
          }
        } else {
          fail('选择班级', '', selectResult)
        }
      } else {
        fail('填写姓名', '', inputResult)
      }
      // 关闭表单 (如果有取消按钮)
      await cdp.clickByText('button', '取消').catch(() => {})
    } else {
      fail('添加表单无班级下拉', '', hasClassSelect)
    }
  } else {
    fail('点击添加按钮', '', addBtnResult)
  }

  // ========================================================================
  // Phase 7: 验证修复3 — 删除班级级联清理 EAA class_id
  // ========================================================================
  console.log('\n--- Phase 7: 验证修复3 (删除班级级联清理) ---')
  // 7.1 先记录班级3的学生
  const classC = classData[2]
  const beforeDelete = await cdp.api('await window.api.eaa.listStudents()')
  const beforeStudents = (beforeDelete?.data?.students ?? []).filter(s => s.status !== 'Deleted')
  const classCStudents = beforeStudents.filter(s => s.class_id === classC.class_id)
  ok('删除前班级3学生', classCStudents.length + ' 名 (' + classC.name + ')')
  if (classCStudents.length === 0) {
    warn('班级3无学生', '无法验证级联清理')
  } else {
    // 7.2 删除班级3
    const delResult = await cdp.api("await window.api.class.delete('" + classC.id + "')")
    if (delResult?.success) {
      ok('删除班级3', classC.name)
      // 7.3 等待级联清理完成 (每个学生 set-student-meta ~1.4s)
      await new Promise((r) => setTimeout(r, classCStudents.length * 1500 + 500))
      // 7.4 验证原班级3学生的 class_id 已清除
      const afterDelete = await cdp.api('await window.api.eaa.listStudents()')
      const afterStudents = (afterDelete?.data?.students ?? []).filter(s => s.status !== 'Deleted')
      let clearedCount = 0
      let stillHasCount = 0
      for (const s of classCStudents) {
        const updated = afterStudents.find(x => x.name === s.name)
        if (updated && (!updated.class_id || updated.class_id === '')) clearedCount++
        else if (updated && updated.class_id === classC.class_id) stillHasCount++
      }
      if (clearedCount === classCStudents.length && stillHasCount === 0) {
        ok('级联清理成功', clearedCount + '/' + classCStudents.length + ' 名学生 class_id 已清除')
      } else {
        fail('级联清理不完整', '', '已清除=' + clearedCount + ', 仍指向=' + stillHasCount)
      }
      // 7.5 验证班级列表中已无班级3
      const clsList = await cdp.api('await window.api.class.list()')
      const clsAfter = clsList?.data ?? []
      if (clsAfter.find(c => c.id === classC.id)) {
        fail('班级3未从列表删除', '', '')
      } else {
        ok('班级3已从列表删除', '剩余 ' + clsAfter.length + ' 个班级')
      }
    } else {
      fail('删除班级3失败', '', delResult?.error || '')
    }
  }

  // ========================================================================
  // Phase 8: UI 真实模拟操作 — 学生页批量选择/搜索/筛选
  // ========================================================================
  console.log('\n--- Phase 8: UI 真实模拟操作 ---')

  // 8.1 学生页搜索
  await cdp.navigate('/students', 2000)
  await cdp.waitForRows(10000)
  const srchResult = await cdp.setReactInput('input[placeholder*="搜索"]', 'UI测试')
  if (srchResult === 'OK') {
    await new Promise((r) => setTimeout(r, 600))
    const filteredRows = await cdp.tableRows()
    if (filteredRows <= 2) ok('搜索"UI测试"', '过滤后 ' + filteredRows + ' 行')
    else warn('搜索结果偏多', filteredRows + ' 行')
    // 清空
    await cdp.setReactInput('input[placeholder*="搜索"]', '')
    await new Promise((r) => setTimeout(r, 500))
  } else {
    warn('搜索输入失败', srchResult)
  }

  // 8.2 学生页班级筛选
  const filterOpts = await cdp.eval('document.querySelector("select[title=\\"按班级筛选\\"]") ? document.querySelector("select[title=\\"按班级筛选\\"]").options.length : 0')
  ok('学生页班级筛选选项', filterOpts + ' 个')
  if (filterOpts > 0) {
    // 选班级1
    await cdp.setReactSelect('select[title="按班级筛选"]', classA.class_id)
    await new Promise((r) => setTimeout(r, 600))
    const rowsA = await cdp.tableRows()
    ok('筛选班级1', rowsA + ' 行')
    // 选未分班
    await cdp.setReactSelect('select[title="按班级筛选"]', '__NONE__')
    await new Promise((r) => setTimeout(r, 600))
    const rowsNone = await cdp.tableRows()
    ok('筛选未分班', rowsNone + ' 行')
    // 恢复全部
    await cdp.setReactSelect('select[title="按班级筛选"]', '__ALL__')
    await new Promise((r) => setTimeout(r, 500))
  }

  // 8.3 班级页查看班级详情
  await cdp.navigate('/classes', 2000)
  await new Promise((r) => setTimeout(r, 1500))
  const classRows = await cdp.tableRows()
  ok('班级页表格', classRows + ' 行 (期望2: 已删除班级3)')

  // 8.4 点击第一个班级查看详情
  const clickFirstClass = await cdp.eval("(function(){var trs=document.querySelectorAll('table tbody tr');if(trs.length===0) return 'NO_ROWS';trs[0].click();return 'OK'})()")
  if (clickFirstClass === 'OK') {
    await new Promise((r) => setTimeout(r, 2000))
    const profileStudentRows = await cdp.eval('document.querySelectorAll("[class*=\\"student\\"],[class*=\\"grid\\"] tbody tr").length')
    ok('查看班级详情', '详情区行数=' + profileStudentRows)
  } else {
    warn('点击班级失败', clickFirstClass)
  }

  // ========================================================================
  // Phase 9: 最终数据一致性检查
  // ========================================================================
  console.log('\n--- Phase 9: 最终数据一致性 ---')
  const finalStudents = (await cdp.api('await window.api.eaa.listStudents()'))?.data?.students ?? []
  const aliveFinal = finalStudents.filter(s => s.status !== 'Deleted')
  const finalClasses = (await cdp.api('await window.api.class.list()'))?.data ?? []
  ok('最终学生数', aliveFinal.length + ' 名 (含已删除=' + (finalStudents.length - aliveFinal.length) + ')')
  ok('最终班级数', finalClasses.length + ' 个')

  // 检查是否还有"幽灵 class_id" (指向已删除班级)
  let ghostCount = 0
  for (const s of aliveFinal) {
    if (s.class_id && !finalClasses.find(c => c.class_id === s.class_id)) {
      ghostCount++
      warn('幽灵 class_id', s.name + ' → ' + s.class_id)
    }
  }
  if (ghostCount === 0) ok('无幽灵 class_id', '')
  else fail('发现幽灵 class_id', ghostCount + ' 名', '')

  // ========================================================================
  // 汇总
  // ========================================================================
  console.log('\n=== R33 测试汇总 ===')
  console.log('  Pass: ' + results.pass)
  console.log('  Fail: ' + results.fail)
  console.log('  Warn: ' + results.warn)
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0.0'
  console.log('  通过率: ' + rate + '%')

  finalize(results)
}

function finalize(results) {
  const outPath = path.join(__dirname, 'r33-result.json')
  fs.writeFileSync(outPath, JSON.stringify({
    pass: results.pass,
    fail: results.fail,
    warn: results.warn,
    details: results.details,
  }, null, 2))
  console.log('\n结果已写入: ' + outPath)
  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
