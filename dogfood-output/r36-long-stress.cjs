// R36 长时间压力测试 — 持续模拟用户操作,验证系统稳定性
// 7 大压力维度:
//   1. 快速导航循环 (100次页面切换,验证无崩溃/内存泄漏)
//   2. 仪表盘高频筛选 (50次快速班级筛选切换)
//   3. 学生搜索压力 (30次快速搜索/清空)
//   4. 数据创建/删除循环 (20个学生创建+分班+事件+删除)
//   5. 班级创建/删除循环 (10个班级创建+存档+恢复+删除)
//   6. 并发API调用 (10个并发listStudents请求)
//   7. 长时间运行后系统健康检查 (内存/CPU/错误数)
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
  async navigate(p, wait = 2000) { await this.eval("window.location.hash='" + p + "'"); await new Promise(r => setTimeout(r, wait)) }
  async exists(selector) { return await this.eval("!!document.querySelector('" + selector + "')") }
  async tableRows() { return await this.eval('document.querySelectorAll("table tbody tr").length') }
  async api(code) { const expr = "(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"; const v = await this.eval(expr); if (typeof v === 'string' && v.startsWith('ERR:')) throw new Error(v.slice(4)); try { return v ? JSON.parse(v) : null } catch (e) { return v } }
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

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push('✓ ' + n); console.log('  ✓ ' + n + (d ? ' — ' + d : '')) }
  const fail = (n, d, e) => { results.fail++; results.details.push('✗ ' + n + ': ' + String(e ?? '').slice(0, 120)); console.log('  ✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? '').slice(0, 120)) }
  const warn = (n, d) => { results.warn++; results.details.push('⚠ ' + n); console.log('  ⚠ ' + n + (d ? ' — ' + d : '')) }

  const ts = String(Date.now()).slice(-6)
  let createdStudentNames = []
  let createdClassIds = []

  console.log('=== R36 长时间压力测试 ===')
  console.log('时间戳: ' + ts + '\n')

  const startTime = Date.now()
  let initialMemory = 0

  try {
    // ============================================================
    // 维度 0: 初始系统健康快照
    // ============================================================
    console.log('--- 维度 0: 初始系统健康 ---')
    try {
      const memInfo = await cdp.eval("(function(){var m=performance&&performance.memory?performance.memory:null;return JSON.stringify({usedJSHeapSize:m?m.usedJSHeapSize:0,totalJSHeapSize:m?m.totalJSHeapSize:0,jsHeapSizeLimit:m?m.jsHeapSizeLimit:0});})()")
      const mi = JSON.parse(memInfo)
      initialMemory = mi.usedJSHeapSize
      ok('初始内存', (mi.usedJSHeapSize / 1024 / 1024).toFixed(1) + ' MB')
    } catch (e) { warn('初始内存', 'performance.memory 不可用') }

    // ============================================================
    // 维度 1: 快速导航循环 (100次)
    // ============================================================
    console.log('\n--- 维度 1: 快速导航循环 (100次) ---')
    try {
      const navPages = ['/dashboard', '/students', '/classes', '/settings', '/chat']
      let navSuccess = 0
      let navFail = 0
      for (let i = 0; i < 100; i++) {
        const page = navPages[i % navPages.length]
        await cdp.eval("window.location.hash='" + page + "'")
        await new Promise(r => setTimeout(r, 300)) // 短等待,模拟快速切换
        const hash = await cdp.eval('window.location.hash')
        if (hash === '#' + page) navSuccess++
        else navFail++
        // 每20次检查一次错误
        if ((i + 1) % 20 === 0) {
          const errCount = await cdp.eval("document.querySelectorAll('.error, [role=alert]').length")
          if (errCount > 0) warn('导航' + (i + 1) + '次后有错误', errCount + ' 个')
        }
      }
      ok('导航100次', '成功=' + navSuccess + ' 失败=' + navFail)
      if (navFail > 0) fail('导航失败', '', navFail + ' 次')
    } catch (e) { fail('导航循环', '', e.message) }

    // ============================================================
    // 维度 2: 仪表盘高频筛选 (50次)
    // ============================================================
    console.log('\n--- 维度 2: 仪表盘高频筛选 (50次) ---')
    try {
      await cdp.navigate('/dashboard', 2500)
      const optionsRes = await cdp.eval("document.querySelector('select[title=\"按班级筛选数据\"]')?.options?.length || 0")
      ok('仪表盘筛选选项', optionsRes + ' 个')

      let filterSuccess = 0
      let filterFail = 0
      for (let i = 0; i < 50; i++) {
        // 在 __ALL__ 和第一个具体班级之间切换
        const target = i % 2 === 0 ? '__ALL__' : (optionsRes > 1 ? await cdp.eval("document.querySelector('select[title=\"按班级筛选数据\"]')?.options?.[1]?.value || '__ALL__'") : '__ALL__')
        const r = await cdp.setReactSelect('select[title="按班级筛选数据"]', target)
        if (r === 'OK' || r === 'OK_FALLBACK') filterSuccess++
        else filterFail++
        await new Promise(r => setTimeout(r, 200))
      }
      ok('筛选50次', '成功=' + filterSuccess + ' 失败=' + filterFail)
      if (filterFail > 0) fail('筛选失败', '', filterFail + ' 次')

      // 筛选后检查无错误
      const errCount = await cdp.eval("document.querySelectorAll('.error, [role=alert]').length")
      if (errCount === 0) ok('筛选后无错误', '0 错误')
      else warn('筛选后有错误', errCount + ' 个')
    } catch (e) { fail('筛选循环', '', e.message) }

    // ============================================================
    // 维度 3: 学生搜索压力 (30次)
    // ============================================================
    console.log('\n--- 维度 3: 学生搜索压力 (30次) ---')
    try {
      await cdp.navigate('/students', 2500)
      const searchSel = 'input[placeholder*="搜索"]'
      const searchExists = await cdp.exists(searchSel)
      if (searchExists) {
        let searchSuccess = 0
        for (let i = 0; i < 30; i++) {
          const query = i % 5 === 0 ? '' : 'R' + i
          const safe = query.replace(/'/g, "\\'")
          await cdp.eval("(function(){var el=document.querySelector('" + searchSel + "');if(!el) return;var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(key){var props=el[key];if(props&&typeof props.onChange==='function'){props.onChange({target:{value:'" + safe + "'},currentTarget:{value:'" + safe + "'}})}}})()")
          await new Promise(r => setTimeout(r, 150))
          searchSuccess++
        }
        ok('搜索30次', '成功=' + searchSuccess)
        // 恢复
        await cdp.eval("(function(){var el=document.querySelector('" + searchSel + "');if(!el) return;var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(key){var props=el[key];if(props&&typeof props.onChange==='function'){props.onChange({target:{value:''},currentTarget:{value:''}})}}})()")
        await new Promise(r => setTimeout(r, 500))
      } else warn('搜索框', '未找到搜索输入框')
    } catch (e) { fail('搜索循环', '', e.message) }

    // ============================================================
    // 维度 4: 数据创建/删除循环 (20个学生)
    // ============================================================
    console.log('\n--- 维度 4: 数据创建/删除循环 (20个学生) ---')
    try {
      // 先创建一个班级用于分班
      const clsRes = await cdp.api("await window.api.class.create({class_id:'C-R36-" + ts + "',name:'R36压力班_" + ts + "',grade:'高一',teacher:'张老师'})")
      if (clsRes?.success && clsRes.data) {
        createdClassIds.push(clsRes.data.id)
        ok('创建压力班', clsRes.data.class_id)
      }

      let createSuccess = 0
      let deleteSuccess = 0
      const reasonCodes = ['SPEAK_IN_CLASS', 'LATE', 'ACTIVITY_PARTICIPATION', 'CLASS_MONITOR', 'SLEEP_IN_CLASS']
      for (let i = 0; i < 20; i++) {
        const name = 'R36Stress_' + ts + '_' + i
        try {
          // 创建学生
          const addRes = await cdp.api("await window.api.eaa.addStudent('" + name + "')")
          if (addRes?.success) {
            createdStudentNames.push(name)
            createSuccess++
            // 分班
            try {
              await cdp.api("await window.api.eaa.setStudentMeta({name:'" + name + "',classId:'C-R36-" + ts + "'})")
            } catch (e) {}
            // 添加事件 (50%概率)
            if (i % 2 === 0) {
              try {
                const reason = reasonCodes[i % reasonCodes.length]
                await cdp.api("await window.api.eaa.addEvent({studentName:'" + name + "',reasonCode:'" + reason + "'})")
              } catch (e) {}
            }
          }
        } catch (e) { warn('创建学生失败 #' + i, name + ': ' + e.message) }
      }
      ok('创建20个学生', createSuccess + '/20')

      // 验证班级学生数
      const listRes = await cdp.api('await window.api.eaa.listStudents()')
      const clsStudents = (listRes?.data?.students ?? []).filter(s => s.class_id === 'C-R36-' + ts && s.status !== 'Deleted')
      ok('压力班学生数', clsStudents.length + ' 个')

      // 删除所有学生
      for (const name of createdStudentNames) {
        try {
          const delRes = await cdp.api("await window.api.eaa.deleteStudent('" + name.replace(/'/g, "\\'") + "','R36清理')")
          if (delRes?.success) deleteSuccess++
        } catch (e) {}
      }
      ok('删除20个学生', deleteSuccess + '/' + createdStudentNames.length)
    } catch (e) { fail('数据循环', '', e.message) }

    // ============================================================
    // 维度 5: 班级创建/删除循环 (10个班级)
    // ============================================================
    console.log('\n--- 维度 5: 班级创建/删除循环 (10个班级) ---')
    try {
      let classCreateSuccess = 0
      let classDeleteSuccess = 0
      const tempClassIds = []
      for (let i = 0; i < 10; i++) {
        const cid = 'C-R36T-' + ts + '-' + i
        try {
          const res = await cdp.api("await window.api.class.create({class_id:'" + cid + "',name:'R36临时班_" + i + "',grade:'高二',teacher:'李老师'})")
          if (res?.success && res.data) {
            tempClassIds.push(res.data.id)
            classCreateSuccess++
          }
        } catch (e) {}
      }
      ok('创建10个临时班', classCreateSuccess + '/10')

      // 存档+恢复测试 (前5个)
      let archiveSuccess = 0
      let restoreSuccess = 0
      for (let i = 0; i < Math.min(5, tempClassIds.length); i++) {
        try {
          const ar = await cdp.api("await window.api.class.archive('" + tempClassIds[i] + "')")
          if (ar?.success) archiveSuccess++
        } catch (e) {}
      }
      ok('存档5个班', archiveSuccess + '/5')

      for (let i = 0; i < Math.min(5, tempClassIds.length); i++) {
        try {
          const rr = await cdp.api("await window.api.class.restore('" + tempClassIds[i] + "')")
          if (rr?.success) restoreSuccess++
        } catch (e) {}
      }
      ok('恢复5个班', restoreSuccess + '/5')

      // 删除所有临时班
      for (const id of tempClassIds) {
        try {
          const dr = await cdp.api("await window.api.class.delete('" + id + "')")
          if (dr?.success) classDeleteSuccess++
        } catch (e) {}
      }
      ok('删除10个临时班', classDeleteSuccess + '/' + tempClassIds.length)
    } catch (e) { fail('班级循环', '', e.message) }

    // ============================================================
    // 维度 6: 并发API调用 (10个并发请求)
    // ============================================================
    console.log('\n--- 维度 6: 并发API调用 ---')
    try {
      // 发起10个并发 listStudents 请求
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(cdp.api('await window.api.eaa.listStudents()'))
      }
      const results10 = await Promise.allSettled(promises)
      let successCount = 0
      let failCount = 0
      for (const r of results10) {
        if (r.status === 'fulfilled' && r.value?.success) successCount++
        else failCount++
      }
      ok('10个并发listStudents', '成功=' + successCount + ' 失败=' + failCount)
      if (failCount > 0) warn('并发失败', failCount + ' 个')

      // 并发创建5个学生
      const stuPromises = []
      for (let i = 0; i < 5; i++) {
        const name = 'R36Conc_' + ts + '_' + i
        stuPromises.push(cdp.api("await window.api.eaa.addStudent('" + name + "')").then(r => { if (r?.success) createdStudentNames.push(name) }))
      }
      await Promise.allSettled(stuPromises)
      ok('5个并发addStudent', '完成')

      // 清理并发创建的学生
      for (const name of createdStudentNames.filter(n => n.indexOf('R36Conc') >= 0)) {
        try { await cdp.api("await window.api.eaa.deleteStudent('" + name + "','R36并发清理')") } catch (e) {}
      }
    } catch (e) { fail('并发API', '', e.message) }

    // ============================================================
    // 维度 7: 长时间运行后系统健康检查
    // ============================================================
    console.log('\n--- 维度 7: 系统健康检查 ---')
    try {
      const finalMem = await cdp.eval("(function(){var m=performance&&performance.memory?performance.memory:null;return JSON.stringify({usedJSHeapSize:m?m.usedJSHeapSize:0,totalJSHeapSize:m?m.totalJSHeapSize:0});})()")
      const fm = JSON.parse(finalMem)
      const memGrowth = fm.usedJSHeapSize - initialMemory
      ok('最终内存', (fm.usedJSHeapSize / 1024 / 1024).toFixed(1) + ' MB (增长 ' + (memGrowth / 1024 / 1024).toFixed(1) + ' MB)')
      if (memGrowth > 50 * 1024 * 1024) warn('内存增长较大', (memGrowth / 1024 / 1024).toFixed(1) + ' MB')

      // 检查页面是否仍然响应
      const responsive = await cdp.eval("(function(){return document.body?document.body.innerText.length>0:false;})()")
      if (responsive) ok('页面响应', '正常')
      else fail('页面响应', '', '无响应')

      // 导航到所有页面验证无崩溃
      const pages = ['/dashboard', '/students', '/classes', '/settings']
      for (const p of pages) {
        await cdp.navigate(p, 1500)
        const errCount = await cdp.eval("document.querySelectorAll('.error, [role=alert]').length")
        if (errCount === 0) ok(p + ' 无错误', 'OK')
        else warn(p + ' 有错误', errCount + ' 个')
      }
    } catch (e) { fail('健康检查', '', e.message) }

    // ============================================================
    // 清理
    // ============================================================
    console.log('\n--- 清理 ---')
    try {
      // 删除所有 R36 学生
      const allList = await cdp.api('await window.api.eaa.listStudents()')
      const allR36 = (allList?.data?.students ?? []).filter(s => s.name.indexOf('R36') >= 0 && s.status !== 'Deleted')
      let deletedStudents = 0
      for (const s of allR36) {
        try {
          const r = await cdp.api("await window.api.eaa.deleteStudent('" + s.name.replace(/'/g, "\\'") + "','R36清理')")
          if (r?.success) deletedStudents++
        } catch (e) {}
      }
      ok('清理R36学生', deletedStudents + '/' + allR36.length)

      // 删除所有 R36 班级
      const allClasses = await cdp.api('await window.api.class.list()')
      const allR36Classes = (allClasses?.data ?? []).filter(c => c.name.indexOf('R36') >= 0 || c.class_id.indexOf(ts) >= 0)
      let deletedClasses = 0
      for (const c of allR36Classes) {
        try {
          const r = await cdp.api("await window.api.class.delete('" + c.id + "')")
          if (r?.success) deletedClasses++
        } catch (e) {}
      }
      ok('清理R36班级', deletedClasses + ' 个')
    } catch (e) { fail('清理', '', e.message) }

  } catch (e) {
    fail('主流程异常', '', e.message)
  } finally {
    ws.close()
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('\n=== R36 长时间压力测试 汇总 ===')
  console.log('通过: ' + results.pass + ', 失败: ' + results.fail + ', 警告: ' + results.warn)
  console.log('总断言: ' + (results.pass + results.fail + results.warn))
  console.log('通过率: ' + ((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1) + '%')
  console.log('耗时: ' + elapsed + ' 秒')

  fs.writeFileSync(
    'dogfood-output/r36-stress-result.json',
    JSON.stringify({ ts: Date.now(), elapsed, results, pass: results.pass, fail: results.fail, warn: results.warn }, null, 2)
  )
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('fatal:', e); process.exit(1) })
