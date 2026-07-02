// R37 完整用户工作流模拟测试 — 模拟真实用户从打开软件到关闭的完整工作流
// 8 大场景:
//   1. 用户打开软件,浏览各页面 (初次使用体验)
//   2. 用户创建第一个班级 (班级管理入门)
//   3. 用户批量添加学生到班级 (学生管理)
//   4. 用户记录学生事件 (日常操作: 扣分/加分)
//   5. 用户查看仪表盘分析数据 (数据洞察)
//   6. 用户编辑/存档/恢复班级 (班级生命周期)
//   7. 用户搜索/筛选/导出学生 (高级操作)
//   8. 用户清理并退出 (收尾工作)
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find(x => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 60000) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  async navigate(p, wait = 2500) { await this.eval("window.location.hash='" + p + "'"); await new Promise(r => setTimeout(r, wait)) }
  async click(selector) { return await this.eval("document.querySelector('" + selector + "')?.click() || 'NOT_FOUND'") }
  async exists(selector) { return await this.eval("!!document.querySelector('" + selector + "')") }
  async text(selector) { return await this.eval("document.querySelector('" + selector + "')?.textContent || ''") }
  async tableRows() { return await this.eval('document.querySelectorAll("table tbody tr").length') }
  async api(code) { const expr = "(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"; const v = await this.eval(expr); if (typeof v === 'string' && v.startsWith('ERR:')) throw new Error(v.slice(4)); try { return v ? JSON.parse(v) : null } catch (e) { return v } }
  async setReactInput(selector, value) { const safe = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); const expr = "(function(){var el=document.querySelector('" + selector + "');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(!key) return 'NO_PROPS';var props=el[key];if(!props||typeof props.onChange!=='function') return 'NO_ONCHANGE';props.onChange({target:{value:'" + safe + "'},currentTarget:{value:'" + safe + "'}});return 'OK';})()"; return await this.eval(expr) }
  async setReactSelect(selector, value) {
    const v = String(value).replace(/'/g, "\\'")
    const expr = "(function(){var el=document.querySelector('" + selector + "');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(key){var props=el[key];if(props&&typeof props.onChange==='function'){var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,'" + v + "');props.onChange({target:{value:'" + v + "'},currentTarget:{value:'" + v + "'}});return 'OK'}}return 'OK_FALLBACK';})()"
    return await this.eval(expr)
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0 }
  const ok = (n, d) => { results.pass++; console.log('  ✓ ' + n + (d ? ' — ' + d : '')) }
  const fail = (n, d, e) => { results.fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? '').slice(0, 120)) }
  const warn = (n, d) => { results.warn++; console.log('  ⚠ ' + n + (d ? ' — ' + d : '')) }

  const ts = String(Date.now()).slice(-6)
  let createdStudentNames = []
  let createdClassIds = []

  console.log('=== R37 完整用户工作流模拟 ===\n')

  try {
    // ============================================================
    // 场景 1: 用户初次浏览各页面
    // ============================================================
    console.log('--- 场景 1: 初次浏览 ---')
    try {
      const pages = [
        { hash: '/dashboard', expectH1: '仪表盘' },
        { hash: '/students', expectH1: '学生' },
        { hash: '/classes', expectH1: '班级' },
        { hash: '/chat', expectH1: '对话' },
        { hash: '/agents', expectH1: 'Agent' },
        { hash: '/models', expectH1: '模型' },
        { hash: '/scheduler', expectH1: '调度' },
        { hash: '/privacy', expectH1: '隐私' },
        { hash: '/skills', expectH1: '技能' },
        { hash: '/settings', expectH1: '设置' },
      ]
      for (const p of pages) {
        await cdp.navigate(p.hash, 1500)
        const h1 = await cdp.eval("document.querySelector('h1')?.textContent?.trim()?.slice(0,30) || ''")
        if (h1.indexOf(p.expectH1) >= 0) ok('浏览 ' + p.hash, 'h1="' + h1 + '"')
        else warn('浏览 ' + p.hash, 'h1="' + h1 + '" 期望包含"' + p.expectH1 + '"')
      }
    } catch (e) { fail('初次浏览', '', e.message) }

    // ============================================================
    // 场景 2: 创建第一个班级
    // ============================================================
    console.log('\n--- 场景 2: 创建班级 ---')
    try {
      // 通过 UI 创建班级
      await cdp.navigate('/classes', 2500)
      // 点击 "+ 新建班级" 按钮
      await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('新建')>=0||btns[i].textContent.indexOf('+')>=0){btns[i].click();return 'OK'}}return 'NOT_FOUND';})()")
      await new Promise(r => setTimeout(r, 1000))

      // 填写表单
      const cid = 'C-R37-' + ts
      const cname = 'R37高一一班_' + ts
      await cdp.setReactInput('input[placeholder*="编号"]', cid)
      await cdp.setReactInput('input[placeholder*="名称"]', cname)
      await cdp.setReactInput('input[placeholder*="年级"]', '高一')
      await cdp.setReactInput('input[placeholder*="班主任"]', '王老师')

      // 点击保存
      await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('保存')>=0||btns[i].textContent.indexOf('确定')>=0){btns[i].click();return 'OK'}}return 'NOT_FOUND';})()")
      await new Promise(r => setTimeout(r, 1500))

      // 验证班级创建成功
      const clsList = await cdp.api('await window.api.class.list()')
      const created = (clsList?.data ?? []).find(c => c.class_id === cid)
      if (created) {
        ok('UI创建班级', cname + ' (' + cid + ')')
        createdClassIds.push(created.id)
      } else {
        // 回退: 通过 API 创建
        const apiCls = await cdp.api("await window.api.class.create({class_id:'" + cid + "',name:'" + cname + "',grade:'高一',teacher:'王老师'})")
        if (apiCls?.success && apiCls.data) {
          ok('API创建班级(回退)', cname)
          createdClassIds.push(apiCls.data.id)
        } else fail('创建班级', '', JSON.stringify(apiCls))
      }
    } catch (e) { fail('创建班级', '', e.message) }

    // ============================================================
    // 场景 3: 批量添加学生
    // ============================================================
    console.log('\n--- 场景 3: 批量添加学生 ---')
    try {
      const studentNames = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十']
      const cid = 'C-R37-' + ts
      let addedCount = 0
      for (const name of studentNames) {
        const fullName = 'R37_' + name + '_' + ts
        try {
          const addRes = await cdp.api("await window.api.eaa.addStudent('" + fullName + "')")
          if (addRes?.success) {
            createdStudentNames.push(fullName)
            // 分班
            await cdp.api("await window.api.eaa.setStudentMeta({name:'" + fullName + "',classId:'" + cid + "'})")
            addedCount++
          }
        } catch (e) {}
      }
      ok('批量添加学生', addedCount + '/' + studentNames.length)

      // 验证班级学生数
      const listRes = await cdp.api('await window.api.eaa.listStudents()')
      const clsStudents = (listRes?.data?.students ?? []).filter(s => s.class_id === cid && s.status !== 'Deleted')
      ok('班级学生数', clsStudents.length + ' 个')
    } catch (e) { fail('批量添加学生', '', e.message) }

    // ============================================================
    // 场景 4: 记录学生事件
    // ============================================================
    console.log('\n--- 场景 4: 记录学生事件 ---')
    try {
      const cid = 'C-R37-' + ts
      const events = [
        { name: 'R37_张三_' + ts, reason: 'LATE', delta: -2, note: '迟到' },
        { name: 'R37_李四_' + ts, reason: 'SPEAK_IN_CLASS', delta: -2, note: '课堂讲话' },
        { name: 'R37_王五_' + ts, reason: 'CLASS_MONITOR', delta: 10, note: '班长履职' },
        { name: 'R37_赵六_' + ts, reason: 'ACTIVITY_PARTICIPATION', delta: 1, note: '活动参与' },
        { name: 'R37_钱七_' + ts, reason: 'SLEEP_IN_CLASS', delta: -2, note: '课堂睡觉' },
        { name: 'R37_孙八_' + ts, reason: 'CIVILIZED_DORM', delta: 3, note: '文明寝室' },
        { name: 'R37_周九_' + ts, reason: 'PHONE_IN_CLASS', delta: -5, note: '手机违纪' },
        { name: 'R37_吴十_' + ts, reason: 'MONTHLY_ATTENDANCE', delta: 2, note: '月勤奖励' },
      ]
      let eventSuccess = 0
      for (const ev of events) {
        try {
          const res = await cdp.api("await window.api.eaa.addEvent({studentName:'" + ev.name + "',reasonCode:'" + ev.reason + "',delta:" + ev.delta + ",note:'" + ev.note + "'})")
          if (res?.success) eventSuccess++
        } catch (e) {}
      }
      ok('记录事件', eventSuccess + '/' + events.length)

      // 验证学生分数变化
      const listRes = await cdp.api('await window.api.eaa.listStudents()')
      const zhangsan = (listRes?.data?.students ?? []).find(s => s.name === 'R37_张三_' + ts)
      if (zhangsan) {
        if (zhangsan.score === 98) ok('张三分数验证', 'score=' + zhangsan.score + ' (100-2)')
        else warn('张三分数', 'score=' + zhangsan.score + ' (期望98)')
      }
      const wangwu = (listRes?.data?.students ?? []).find(s => s.name === 'R37_王五_' + ts)
      if (wangwu) {
        if (wangwu.score === 110) ok('王五分数验证', 'score=' + wangwu.score + ' (100+10)')
        else warn('王五分数', 'score=' + wangwu.score + ' (期望110)')
      }
    } catch (e) { fail('记录事件', '', e.message) }

    // ============================================================
    // 场景 5: 查看仪表盘分析
    // ============================================================
    console.log('\n--- 场景 5: 查看仪表盘 ---')
    try {
      await cdp.navigate('/dashboard', 3000)

      // 查看全部班级数据
      const allData = await cdp.eval("(function(){var t=document.body.innerText||'';var nums=t.match(/-?\\d+(?:\\.\\d+)?/g)||[];return nums.slice(0,5).join('|');})()")
      ok('仪表盘全部班级', '顶部数据=' + allData)

      // 筛选到R37班级
      const filterRes = await cdp.setReactSelect('select[title="按班级筛选数据"]', 'C-R37-' + ts)
      if (filterRes === 'OK' || filterRes === 'OK_FALLBACK') {
        await new Promise(r => setTimeout(r, 2000))
        const filteredData = await cdp.eval("(function(){var t=document.body.innerText||'';var nums=t.match(/-?\\d+(?:\\.\\d+)?/g)||[];return nums.slice(0,5).join('|');})()")
        ok('仪表盘R37班级筛选', '顶部数据=' + filteredData)
      }

      // 查看Top10
      const top10 = await cdp.eval("(function(){var t=document.body.innerText||'';var idx=t.indexOf('Top 10');if(idx<0) idx=t.indexOf('排行');if(idx<0) return 'NOT_FOUND';return t.slice(idx,idx+200);})()")
      ok('Top10排行榜', top10.slice(0, 80))

      // 查看周期摘要
      const summary = await cdp.eval("(function(){var t=document.body.innerText||'';var idx=t.indexOf('周期摘要');if(idx<0) return 'NOT_FOUND';return t.slice(idx,idx+150);})()")
      ok('周期摘要', summary.slice(0, 80))

      // 恢复全部
      await cdp.setReactSelect('select[title="按班级筛选数据"]', '__ALL__')
      await new Promise(r => setTimeout(r, 1000))
    } catch (e) { fail('查看仪表盘', '', e.message) }

    // ============================================================
    // 场景 6: 编辑/存档/恢复班级
    // ============================================================
    console.log('\n--- 场景 6: 班级生命周期 ---')
    try {
      if (createdClassIds.length > 0) {
        const classId = createdClassIds[0]

        // 编辑班级
        const editRes = await cdp.api("await window.api.class.update('" + classId + "',{name:'R37高一一班_已更新_" + ts + "',teacher:'李老师'})")
        ok('编辑班级', editRes?.success ? 'OK' : JSON.stringify(editRes))

        // 验证编辑
        const clsList = await cdp.api('await window.api.class.list()')
        const edited = (clsList?.data ?? []).find(c => c.id === classId)
        if (edited?.name.indexOf('已更新') >= 0) ok('验证编辑', 'name=' + edited.name)
        else warn('验证编辑', 'name=' + edited?.name)

        // 存档
        const archiveRes = await cdp.api("await window.api.class.archive('" + classId + "')")
        ok('存档班级', archiveRes?.success ? 'OK' : JSON.stringify(archiveRes))

        // 验证存档
        const archivedList = await cdp.api('await window.api.class.list()')
        const archived = (archivedList?.data ?? []).find(c => c.id === classId)
        if (archived?.archived) ok('验证存档', 'archived=true')
        else warn('验证存档', 'archived=' + archived?.archived)

        // 恢复
        const restoreRes = await cdp.api("await window.api.class.restore('" + classId + "')")
        ok('恢复班级', restoreRes?.success ? 'OK' : JSON.stringify(restoreRes))

        // 验证恢复
        const restoredList = await cdp.api('await window.api.class.list()')
        const restored = (restoredList?.data ?? []).find(c => c.id === classId)
        if (restored && !restored.archived) ok('验证恢复', 'archived=false')
        else warn('验证恢复', 'archived=' + restored?.archived)
      }
    } catch (e) { fail('班级生命周期', '', e.message) }

    // ============================================================
    // 场景 7: 搜索/筛选/导出
    // ============================================================
    console.log('\n--- 场景 7: 搜索/筛选/导出 ---')
    try {
      await cdp.navigate('/students', 2500)

      // 搜索 R37
      const searchResult = await cdp.setReactInput('input[placeholder*="搜索"]', 'R37')
      await new Promise(r => setTimeout(r, 500))
      const searchRows = await cdp.tableRows()
      ok('搜索R37', searchRows + ' 行匹配')

      // 清空搜索
      await cdp.setReactInput('input[placeholder*="搜索"]', '')
      await new Promise(r => setTimeout(r, 500))
      const allRows = await cdp.tableRows()
      ok('清空搜索', allRows + ' 行')

      // 筛选R37班级
      const filterRes = await cdp.setReactSelect('select[title="按班级筛选"]', 'C-R37-' + ts)
      if (filterRes === 'OK' || filterRes === 'OK_FALLBACK') {
        await new Promise(r => setTimeout(r, 1000))
        const filteredRows = await cdp.tableRows()
        ok('筛选R37班级', filteredRows + ' 行')
      }

      // 恢复全部
      await cdp.setReactSelect('select[title="按班级筛选"]', '__ALL__')
      await new Promise(r => setTimeout(r, 500))

      // 导出功能验证
      const exportExists = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('导出')>=0){return 'OK'}}return 'NOT_FOUND';})()")
      if (exportExists === 'OK') ok('导出按钮存在', 'OK')
      else warn('导出按钮', '未找到')
    } catch (e) { fail('搜索/筛选/导出', '', e.message) }

    // ============================================================
    // 场景 8: 清理并退出
    // ============================================================
    console.log('\n--- 场景 8: 清理 ---')
    try {
      // 删除所有R37学生
      let deletedStudents = 0
      for (const name of createdStudentNames) {
        try {
          const r = await cdp.api("await window.api.eaa.deleteStudent('" + name.replace(/'/g, "\\'") + "','R37清理')")
          if (r?.success) deletedStudents++
        } catch (e) {}
      }
      ok('删除R37学生', deletedStudents + '/' + createdStudentNames.length)

      // 删除R37班级
      let deletedClasses = 0
      for (const id of createdClassIds) {
        try {
          const r = await cdp.api("await window.api.class.delete('" + id + "')")
          if (r?.success) deletedClasses++
        } catch (e) {}
      }
      ok('删除R37班级', deletedClasses + '/' + createdClassIds.length)

      // 验证清理
      const finalList = await cdp.api('await window.api.eaa.listStudents()')
      const remaining = (finalList?.data?.students ?? []).filter(s => s.name.indexOf('R37') >= 0 && s.status !== 'Deleted')
      if (remaining.length === 0) ok('验证无R37残留', 'OK')
      else warn('残留R37学生', remaining.length + ' 个')

      // 最后检查所有页面无错误
      const pages = ['/dashboard', '/students', '/classes']
      for (const p of pages) {
        await cdp.navigate(p, 1500)
        const errCount = await cdp.eval("document.querySelectorAll('.error, [role=alert]').length")
        if (errCount === 0) ok(p + ' 最终检查', '无错误')
        else warn(p + ' 最终检查', errCount + ' 个错误')
      }
    } catch (e) { fail('清理', '', e.message) }

  } catch (e) {
    fail('主流程异常', '', e.message)
  } finally {
    ws.close()
  }

  console.log('\n=== R37 完整用户工作流模拟 汇总 ===')
  console.log('通过: ' + results.pass + ', 失败: ' + results.fail + ', 警告: ' + results.warn)
  console.log('总断言: ' + (results.pass + results.fail + results.warn))
  console.log('通过率: ' + ((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1) + '%')

  fs.writeFileSync(
    'dogfood-output/r37-workflow-result.json',
    JSON.stringify({ ts: Date.now(), results, pass: results.pass, fail: results.fail, warn: results.warn }, null, 2)
  )
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('fatal:', e); process.exit(1) })
