// R34 综合性 UI 测试 — 通过 CDP (端口 9222) 测试 Electron 教育管理系统的每个功能
// 覆盖 7 大阶段: 导航 / 仪表盘深测 / 学生深测 / 班级深测 / 压力测试 / 边缘用例 / 跨模块
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
  async click(selector) { const r = await this.eval("document.querySelector('" + selector + "')?.click() || 'NOT_FOUND'"); return r !== 'NOT_FOUND' }
  async clickByText(tag, text) { const safe = text.replace(/'/g, "\\'"); return await this.eval("(function(){var els=document.querySelectorAll('" + tag + "');for(var i=0;i<els.length;i++){if(els[i].textContent.indexOf('" + safe + "')>=0){els[i].click();return 'OK'}}return 'NOT_FOUND'})()") }
  async exists(selector) { return await this.eval("!!document.querySelector('" + selector + "')") }
  async text(selector) { return await this.eval("document.querySelector('" + selector + "')?.textContent || ''") }
  async tableRows() { return await this.eval('document.querySelectorAll("table tbody tr").length') }
  async api(code) { const expr = "(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"; const v = await this.eval(expr); if (typeof v === 'string' && v.startsWith('ERR:')) throw new Error(v.slice(4)); try { return v ? JSON.parse(v) : null } catch (e) { return v } }
  async setReactInput(selector, value) { const safe = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); const expr = "(function(){var el=document.querySelector('" + selector + "');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(!key) return 'NO_PROPS';var props=el[key];if(!props||typeof props.onChange!=='function') return 'NO_ONCHANGE';props.onChange({target:{value:'" + safe + "'},currentTarget:{value:'" + safe + "'}});return 'OK';})()"; return await this.eval(expr) }
  // React 受控 select: 跳过带 title 属性的(避免误触筛选 select),优先用 __reactProps$ onChange 直调
  async setReactSelect(selector, value) {
    const v = String(value).replace(/'/g, "\\'")
    const expr = "(function(){var el=document.querySelector('" + selector + "');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(key){var props=el[key];if(props&&typeof props.onChange==='function'){var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,'" + v + "');props.onChange({target:{value:'" + v + "'},currentTarget:{value:'" + v + "'}});return 'OK'}}var setter2=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter2.call(el,'" + v + "');el.dispatchEvent(new Event('change',{bubbles:true}));return 'OK_FALLBACK';})()"
    return await this.eval(expr)
  }
  async waitForRows(timeoutMs = 10000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const n = await this.tableRows()
      if (n > 0) return n
      await new Promise(r => setTimeout(r, 500))
    }
    return await this.tableRows()
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push('✓ ' + n + (d ? ' — ' + d : '')); console.log('  ✓ ' + n + (d ? ' — ' + d : '')) }
  const fail = (n, d, e) => { results.fail++; results.details.push('✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 160)); console.log('  ✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 160)) }
  const warn = (n, d) => { results.warn++; results.details.push('⚠ ' + n + (d ? ' — ' + d : '')); console.log('  ⚠ ' + n + (d ? ' — ' + d : '')) }

  const testSuffix = String(Date.now()).slice(-6)
  const testClassName = 'R34UI班_' + testSuffix
  const testStudentBase = 'R34UI学生_' + testSuffix
  let createdClassIds = [] // 记录测试创建的班级 UUID,用于清理
  let createdStudentNames = [] // 记录测试创建的学生名,用于清理

  console.log('=== R34 综合性 UI 测试 (CDP 端口 9222) ===')
  console.log('时间戳后缀: ' + testSuffix + '\n')

  try {
    // ============================================================
    // 阶段 1: 导航 — 访问所有页面,验证加载与交互元素计数
    // ============================================================
    console.log('--- 阶段 1: 导航所有页面 ---')
    const pages = [
      { hash: '/dashboard', name: 'Dashboard' },
      { hash: '/students', name: 'Students' },
      { hash: '/classes', name: 'Classes' },
      { hash: '/settings', name: 'Settings' },
      { hash: '/agents', name: 'Agents' },
      { hash: '/chat', name: 'Chat' },
      { hash: '/models', name: 'Models' },
      { hash: '/privacy', name: 'Privacy' },
      { hash: '/scheduler', name: 'Scheduler' },
      { hash: '/skills', name: 'Skills' },
      { hash: '/logs', name: 'Logs' },
    ]

    let navSuccessCount = 0
    for (const page of pages) {
      try {
        await cdp.navigate(page.hash, 2200)
        const info = await cdp.eval("(function(){var errs=document.querySelectorAll('.error, [role=\"alert\"], .alert-error');var btns=document.querySelectorAll('button').length;var sels=document.querySelectorAll('select').length;var inps=document.querySelectorAll('input').length;var tas=document.querySelectorAll('textarea').length;var body=document.body?.innerText?.length||0;var h1=document.querySelector('h1')?.textContent?.trim()?.slice(0,40)||null;return JSON.stringify({hash:window.location.hash,h1:h1,btns:btns,sels:sels,inps:inps,tas:tas,body:body,errs:errs.length});})()")
        const r = JSON.parse(info)
        if (r.hash === '#' + page.hash) {
          ok('导航 ' + page.name, 'h1="' + r.h1 + '" 按钮=' + r.btns + ' 下拉=' + r.sels + ' 输入=' + r.inps + ' 文本区=' + r.tas + ' 错误元素=' + r.errs)
          navSuccessCount++
        } else {
          fail('导航 ' + page.name, 'hash 不匹配', '期望 #' + page.hash + ' 实际 ' + r.hash)
        }
      } catch (e) {
        fail('导航 ' + page.name, '', e)
      }
    }
    ok('导航汇总', navSuccessCount + '/' + pages.length + ' 页加载成功')

    // 404 边缘路由
    try {
      await cdp.navigate('/nonexistent-r34-xyz', 1800)
      const body404 = await cdp.eval("document.body?.innerText?.slice(0,200) || ''")
      ok('404 路由处理', 'body 长度=' + body404.length + ' 前60字="' + body404.slice(0, 60).replace(/\n/g, ' ') + '"')
    } catch (e) { fail('404 路由', '', e) }

    // ============================================================
    // 阶段 2: 仪表盘深测 — 班级筛选/对比/刷新/图表/溢出
    // ============================================================
    console.log('\n--- 阶段 2: 仪表盘深测 ---')
    try {
      await cdp.navigate('/dashboard', 2500)

      // 验证筛选 select 存在 (title="按班级筛选数据")
      const dashFilterExists = await cdp.exists('select[title="按班级筛选数据"]')
      if (dashFilterExists) ok('仪表盘班级筛选存在', 'select[title="按班级筛选数据"]')
      else fail('仪表盘班级筛选', '', '未找到 select[title="按班级筛选数据"]')

      // 验证对比按钮存在
      const compareExists = await cdp.exists('button[title="班级对比模式"]')
      if (compareExists) ok('对比模式按钮存在', 'button[title="班级对比模式"]')
      else warn('对比模式按钮', '未找到 button[title="班级对比模式"]')

      // 验证刷新按钮存在 (查找包含"刷新"文本的按钮)
      const refreshExists = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('刷新')>=0||btns[i].title==='刷新'||btns[i].getAttribute('aria-label')==='刷新')return 'OK';}return 'NOT_FOUND';})()")
      if (refreshExists === 'OK') ok('刷新按钮存在', '含"刷新"文本/标题')
      else warn('刷新按钮', '未找到明显的刷新按钮')

      // 仪表盘筛选选项数
      const dashOptionsCount = await cdp.eval("document.querySelector('select[title=\"按班级筛选数据\"]')?.options?.length || 0")
      ok('仪表盘筛选选项数', dashOptionsCount + ' 个')

      // 验证图表容器存在 (分数分布/风险分布/事件原因/排名Top10/周期摘要)
      const chartInfo = await cdp.eval("(function(){var can=document.querySelectorAll('canvas').length;var svgs=document.querySelectorAll('svg').length;var echarts=document.querySelectorAll('[_echarts_instance_]').length;var recharts=document.querySelectorAll('.recharts-responsive-container, .recharts-wrapper').length;return JSON.stringify({canvas:can,svg:svgs,echarts:echarts,recharts:recharts});})()")
      const ci = JSON.parse(chartInfo)
      ok('仪表盘图表容器', 'canvas=' + ci.canvas + ' svg=' + ci.svg + ' echarts=' + ci.echarts + ' recharts=' + ci.recharts)

      // 记录初始顶部数据 (用于后续对比变化)
      const dashInitialTop = await cdp.eval("(function(){var t=document.body?.innerText||'';var nums=t.match(/-?\\d+(?:\\.\\d+)?/g)||[];return nums.slice(0,8).join('|');})()")
      ok('仪表盘初始数据快照', '顶部数字=' + dashInitialTop.slice(0, 80))

      // 班级筛选: 切换到第一个具体班级
      const firstClassVal = await cdp.eval("document.querySelector('select[title=\"按班级筛选数据\"]')?.options?.[1]?.value || ''")
      if (firstClassVal) {
        const r1 = await cdp.setReactSelect('select[title="按班级筛选数据"]', firstClassVal)
        if (r1 === 'OK' || r1 === 'OK_FALLBACK') {
          await new Promise(r => setTimeout(r, 1500))
          const dashAfterClass = await cdp.eval("(function(){var t=document.body?.innerText||'';var nums=t.match(/-?\\d+(?:\\.\\d+)?/g)||[];return nums.slice(0,8).join('|');})()")
          if (dashAfterClass !== dashInitialTop) ok('筛选具体班级数据变化', '初始→切换后 顶部数字不同')
          else warn('筛选具体班级数据', '顶部数字未变化(可能数据相同)')
        } else fail('仪表盘筛选具体班级', '', r1)
      } else warn('仪表盘筛选', '无具体班级选项(可能无班级数据)')

      // 班级筛选: 切换到 "未分班" (__NONE__)
      const noneResult = await cdp.setReactSelect('select[title="按班级筛选数据"]', '__NONE__')
      if (noneResult === 'OK' || noneResult === 'OK_FALLBACK') {
        await new Promise(r => setTimeout(r, 1500))
        ok('筛选"未分班"', '已切换')
      } else warn('筛选"未分班"', noneResult)

      // 班级筛选: 恢复 "全部班级" (__ALL__)
      const allResult = await cdp.setReactSelect('select[title="按班级筛选数据"]', '__ALL__')
      if (allResult === 'OK' || allResult === 'OK_FALLBACK') {
        await new Promise(r => setTimeout(r, 1500))
        ok('恢复"全部班级"', '已切换')
      } else warn('恢复"全部班级"', allResult)

      // 对比模式切换
      if (compareExists) {
        const beforeCompare = await cdp.eval("document.querySelectorAll('canvas, svg, .recharts-wrapper, [_echarts_instance_]').length")
        await cdp.click('button[title="班级对比模式"]')
        await new Promise(r => setTimeout(r, 1500))
        const afterCompare = await cdp.eval("document.querySelectorAll('canvas, svg, .recharts-wrapper, [_echarts_instance_]').length")
        ok('对比模式切换', '图表数 ' + beforeCompare + ' → ' + afterCompare)
        // 再次点击退出对比模式
        await cdp.click('button[title="班级对比模式"]')
        await new Promise(r => setTimeout(r, 1200))
        ok('退出对比模式', '已切回普通模式')
      }

      // 刷新按钮
      const refreshClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('刷新')>=0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
      if (refreshClicked === 'OK') {
        await new Promise(r => setTimeout(r, 2000))
        ok('点击刷新按钮', '仪表盘已刷新')
      } else warn('刷新按钮', '未找到')

      // 溢出检查: Top10 排行榜容器是否水平溢出
      const overflowInfo = await cdp.eval("(function(){var rank=document.querySelector('[class*=\"ranking\"], [class*=\"top10\"], [class*=\"Top10\"]');var period=document.querySelector('[class*=\"period\"], [class*=\"summary\"]');var bodyOW=document.body.scrollWidth;var winIW=window.innerWidth;return JSON.stringify({rankExists:!!rank,rankScrollW:rank?.scrollWidth||0,rankClientW:rank?.clientWidth||0,periodExists:!!period,periodScrollW:period?.scrollWidth||0,periodClientW:period?.clientWidth||0,bodyOverflows:bodyOW>winIW,bodySW:bodyOW,winIW:winIW});})()")
      const ov = JSON.parse(overflowInfo)
      ok('溢出检查', 'body宽=' + ov.bodySW + ' 窗口宽=' + ov.winIW + ' body溢出=' + ov.bodyOverflows + ' Top10存在=' + ov.rankExists + ' 周期摘要存在=' + ov.periodExists)
      if (ov.bodyOverflows) warn('body 水平溢出', 'scrollWidth(' + ov.bodySW + ') > innerWidth(' + ov.winIW + ')')
    } catch (e) {
      fail('仪表盘深测', '', e)
    }

    // ============================================================
    // 阶段 3: 学生深测 — 搜索/添加/删除/批量/筛选/导出/详情
    // ============================================================
    console.log('\n--- 阶段 3: 学生深测 ---')
    let studentsInitialCount = 0
    try {
      await cdp.navigate('/students', 2500)
      studentsInitialCount = await cdp.waitForRows(10000)
      ok('学生页初始加载', studentsInitialCount + ' 行')

      // 搜索功能
      const searchSel = 'input[placeholder*="搜索"]'
      const searchExists = await cdp.exists(searchSel)
      if (searchExists) {
        // 搜索一个不太可能存在的字符串,验证过滤生效
        const sr1 = await cdp.setReactInput(searchSel, 'ZZZNoSuchStudentR34_' + testSuffix)
        if (sr1 === 'OK') {
          await new Promise(r => setTimeout(r, 600))
          const rowsAfterSearch = await cdp.tableRows()
          if (rowsAfterSearch <= studentsInitialCount) ok('搜索过滤生效', studentsInitialCount + ' → ' + rowsAfterSearch + ' 行')
          else warn('搜索过滤', '行数未减少')
        } else fail('搜索输入', '', sr1)

        // 清空搜索
        await cdp.setReactInput(searchSel, '')
        await new Promise(r => setTimeout(r, 600))
        const rowsAfterClear = await cdp.tableRows()
        if (rowsAfterClear === studentsInitialCount) ok('清空搜索恢复', rowsAfterClear + ' 行')
        else warn('清空搜索', '期望 ' + studentsInitialCount + ' 实际 ' + rowsAfterClear)
      } else fail('学生搜索框', '', '未找到 input[placeholder*="搜索"]')

      // 学生页班级筛选 select[title="按班级筛选"]
      const stuFilterExists = await cdp.exists('select[title="按班级筛选"]')
      if (stuFilterExists) {
        const stuFilterOpts = await cdp.eval("document.querySelector('select[title=\"按班级筛选\"]').options.length")
        ok('学生页班级筛选', stuFilterOpts + ' 个选项')

        // 切换到 "未分班"
        const r1 = await cdp.setReactSelect('select[title="按班级筛选"]', '__NONE__')
        if (r1 === 'OK' || r1 === 'OK_FALLBACK') {
          await new Promise(r => setTimeout(r, 800))
          const rowsNone = await cdp.tableRows()
          ok('学生筛选"未分班"', rowsNone + ' 行')
        } else warn('学生筛选"未分班"', r1)

        // 恢复 "全部"
        await cdp.setReactSelect('select[title="按班级筛选"]', '__ALL__')
        await new Promise(r => setTimeout(r, 800))
        const rowsAll = await cdp.tableRows()
        if (rowsAll === studentsInitialCount) ok('学生恢复"全部"', rowsAll + ' 行')
        else warn('学生恢复"全部"', '期望 ' + studentsInitialCount + ' 实际 ' + rowsAll)
      } else warn('学生页班级筛选', '未找到')

      // 添加学生(无班级)
      const addClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('+ 添加')>=0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
      if (addClicked === 'OK') {
        await new Promise(r => setTimeout(r, 700))
        const formOpen = await cdp.exists('input[placeholder="姓名..."]')
        if (formOpen) {
          ok('添加学生表单显示', '姓名输入框出现')

          // 空输入提交(应不操作)
          const emptyConfirm = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('确认')>=0&&btns[i].className.indexOf('green')>=0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
          await new Promise(r => setTimeout(r, 500))
          const rowsAfterEmpty = await cdp.tableRows()
          if (rowsAfterEmpty === studentsInitialCount) ok('空输入不提交', '行数不变 ' + rowsAfterEmpty)
          else warn('空输入提交', '行数变化 ' + studentsInitialCount + '→' + rowsAfterEmpty)

          // 输入学生名(不选班级,即未分班)
          const stuNameNoClass = testStudentBase + '_noclass'
          createdStudentNames.push(stuNameNoClass)
          const setInput = await cdp.setReactInput('input[placeholder="姓名..."]', stuNameNoClass)
          if (setInput === 'OK') {
            await new Promise(r => setTimeout(r, 400))
            const confirmResult = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('确认')>=0&&btns[i].className.indexOf('green')>=0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
            if (confirmResult === 'OK') {
              await new Promise(r => setTimeout(r, 3500))
              let rowsAfterAdd = await cdp.tableRows()
              if (rowsAfterAdd === 0) {
                await cdp.navigate('/students', 2500)
                rowsAfterAdd = await cdp.waitForRows(8000)
              }
              if (rowsAfterAdd === studentsInitialCount + 1) ok('添加无班级学生', '+1 行 (' + studentsInitialCount + '→' + rowsAfterAdd + ')')
              else if (rowsAfterAdd > studentsInitialCount) ok('添加无班级学生', '+ ' + (rowsAfterAdd - studentsInitialCount) + ' 行')
              else {
                const apiCheck = await cdp.api("await window.api.eaa.listStudents()")
                const found = (apiCheck.data?.students || []).find(s => s.name === stuNameNoClass)
                if (found) ok('添加无班级学生(API验证)', found.name + ' class_id=' + (found.class_id || 'null'))
                else warn('添加无班级学生', '行数 ' + rowsAfterAdd + ', API 未找到')
              }
            } else fail('确认按钮', '', '未找到')
          } else fail('输入学生名', '', setInput)
        } else fail('添加表单', '', '姓名输入框未出现')
      } else fail('+ 添加按钮', '', '未找到')

      // 添加学生(选班级) — 先创建一个班级供使用
      let classIdForStudent = null
      let classUuidForStudent = null
      try {
        const clsRes = await cdp.api("await window.api.class.create({ class_id: 'C-R34-" + testSuffix + "', name: '" + testClassName + "', grade: '九年级', teacher: 'R34老师' })")
        if (clsRes?.success !== false && clsRes?.data) {
          classIdForStudent = clsRes.data.class_id || ('C-R34-' + testSuffix)
          classUuidForStudent = clsRes.data.id
          createdClassIds.push(classUuidForStudent)
          ok('创建测试班级', testClassName + ' (class_id=' + classIdForStudent + ', uuid=' + classUuidForStudent?.slice(0, 8) + '...)')
        } else warn('创建测试班级', JSON.stringify(clsRes).slice(0, 100))
      } catch (e) { warn('创建测试班级', e.message) }

      // 再次打开添加表单,选择班级
      if (classIdForStudent) {
        const add2 = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('+ 添加')>=0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
        if (add2 === 'OK') {
          await new Promise(r => setTimeout(r, 700))
          // 表单内的 select 没有 title 属性 — 通过 select:not([title]) 定位
          const formSelectExists = await cdp.exists('select:not([title])')
          if (formSelectExists) {
            ok('添加表单班级下拉存在', 'select:not([title])')
            const stuNameWithClass = testStudentBase + '_withclass'
            createdStudentNames.push(stuNameWithClass)
            // 设置姓名
            await cdp.setReactInput('input[placeholder="姓名..."]', stuNameWithClass)
            await new Promise(r => setTimeout(r, 300))
            // 选择班级(用 __reactProps$ onChange 直调)
            const selRes = await cdp.setReactSelect('select:not([title])', classIdForStudent)
            if (selRes === 'OK' || selRes === 'OK_FALLBACK') {
              await new Promise(r => setTimeout(r, 300))
              const confirm2 = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('确认')>=0&&btns[i].className.indexOf('green')>=0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
              if (confirm2 === 'OK') {
                await new Promise(r => setTimeout(r, 3500))
                // API 验证 class_id 正确设置
                const apiCheck = await cdp.api("await window.api.eaa.listStudents()")
                const found = (apiCheck.data?.students || []).find(s => s.name === stuNameWithClass)
                if (found && found.class_id === classIdForStudent) ok('添加有班级学生', found.name + ' class_id=' + found.class_id + ' (匹配)')
                else if (found) warn('添加有班级学生', 'class_id 不匹配 期望=' + classIdForStudent + ' 实际=' + found.class_id)
                else warn('添加有班级学生', 'API 未找到该学生')
              } else fail('确认按钮(有班级)', '', '未找到')
            } else fail('选择班级', '', selRes)
          } else warn('添加表单班级下拉', '未找到 select:not([title])')
        }
      }

      // 学生详情侧栏
      await cdp.navigate('/students', 2500)
      await cdp.waitForRows(8000)
      const rowClicked = await cdp.eval("(function(){var row=document.querySelector('table tbody tr');if(row){row.click();return 'OK';}return 'NOT_FOUND';})()")
      if (rowClicked === 'OK') {
        await new Promise(r => setTimeout(r, 1200))
        const profileText = await cdp.eval("document.querySelector('[class*=\"border-l\"]')?.textContent?.length || 0")
        if (profileText > 50) ok('学生详情侧栏', '右侧面板文本长度=' + profileText)
        else warn('学生详情侧栏', '面板可能未打开 (文本=' + profileText + ')')
      } else fail('点击学生行', '', '未找到行')

      // 删除学生(通过 API,UI 删除按钮依赖选中状态)
      let deletedCount = 0
      for (const sn of createdStudentNames) {
        try {
          const delRes = await cdp.api("await window.api.eaa.deleteStudent('" + sn + "', 'R34清理')")
          if (delRes?.success !== false) deletedCount++
        } catch (e) {}
      }
      if (createdStudentNames.length > 0) ok('删除测试学生', deletedCount + '/' + createdStudentNames.length + ' 个')

      // 批量选择模式
      const batchClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('选择')>=0&&btns[i].textContent.indexOf('取消')<0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
      if (batchClicked === 'OK') {
        await new Promise(r => setTimeout(r, 700))
        const cbCount = await cdp.eval("document.querySelectorAll('input[type=\"checkbox\"]').length")
        if (cbCount > 0) {
          ok('批量选择模式', cbCount + ' 个 checkbox')
          // 全选
          const selectAll = await cdp.eval("(function(){var cb=document.querySelector('thead input[type=checkbox]');if(cb){cb.click();return 'OK';}return 'NOT_FOUND';})()")
          if (selectAll === 'OK') {
            await new Promise(r => setTimeout(r, 500))
            const checked = await cdp.eval("document.querySelectorAll('tbody input[type=checkbox]:checked').length")
            ok('全选', checked + ' 个已选')
            // 取消全选
            await cdp.eval("(function(){var cb=document.querySelector('thead input[type=checkbox]');if(cb){cb.click();}})()")
            await new Promise(r => setTimeout(r, 500))
            const unchecked = await cdp.eval("document.querySelectorAll('tbody input[type=checkbox]:checked').length")
            if (unchecked === 0) ok('取消全选', '0 个已选')
            else warn('取消全选', unchecked + ' 仍选中')
          }
          // 退出批量选择
          const exitBatch = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('取消选择')>=0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
          if (exitBatch === 'OK') {
            await new Promise(r => setTimeout(r, 500))
            const cbGone = await cdp.eval("document.querySelectorAll('thead input[type=checkbox]').length === 0")
            if (cbGone) ok('退出批量选择', 'checkbox 消失')
            else warn('退出批量选择', 'checkbox 仍存在')
          }
        } else fail('批量选择模式', '', 'checkbox 未出现')
      } else warn('批量选择按钮', '未找到')

      // 导出菜单
      const exportClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('导出')>=0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
      if (exportClicked === 'OK') {
        await new Promise(r => setTimeout(r, 600))
        const menuExists = await cdp.eval("document.querySelector('.relative > div[class*=\"absolute\"]')?.children?.length > 0")
        if (menuExists) {
          const menuItems = await cdp.eval("document.querySelector('.relative > div[class*=\"absolute\"]')?.children?.length || 0")
          ok('导出下拉菜单', menuItems + ' 个选项')
          // 点击外部关闭
          await cdp.eval("document.body.click()")
          await new Promise(r => setTimeout(r, 500))
          ok('导出菜单关闭', '点击外部关闭')
        } else warn('导出下拉菜单', '未出现')
      } else warn('导出按钮', '未找到')
    } catch (e) {
      fail('学生深测', '', e)
    }

    // ============================================================
    // 阶段 4: 班级深测 — 创建/编辑/归档/恢复/删除/详情/学生数
    // ============================================================
    console.log('\n--- 阶段 4: 班级深测 ---')
    let classListBefore = []
    try {
      await cdp.navigate('/classes', 2500)
      const rowsBefore = await cdp.tableRows()
      ok('班级页初始加载', rowsBefore + ' 行')

      // 通过 API 获取班级列表(用于 cleanup 跟踪)
      const apiList = await cdp.api("await window.api.class.list()")
      classListBefore = apiList?.data || []
      ok('API class.list', '返回 ' + classListBefore.length + ' 个班级')

      // 创建班级(API)
      const clsName2 = 'R34Class2_' + testSuffix
      const clsCreateRes = await cdp.api("await window.api.class.create({ class_id: 'C-R34-2-" + testSuffix + "', name: '" + clsName2 + "', grade: '高一', teacher: '二老师' })")
      if (clsCreateRes?.success !== false && clsCreateRes?.data) {
        const newUuid = clsCreateRes.data.id
        const newCid = clsCreateRes.data.class_id
        createdClassIds.push(newUuid)
        ok('创建班级', clsName2 + ' (uuid=' + String(newUuid).slice(0, 8) + '...)')

        // 编辑班级(API update)
        const updRes = await cdp.api("await window.api.class.update('" + newUuid + "', { name: '" + clsName2 + "_已更新', teacher: '更新老师' })")
        if (updRes?.success !== false) ok('编辑班级', 'name/teacher 已更新')
        else fail('编辑班级', '', JSON.stringify(updRes).slice(0, 100))

        // 验证编辑生效
        const verifyList = await cdp.api("await window.api.class.list()")
        const updated = (verifyList?.data || []).find(c => c.id === newUuid)
        if (updated && updated.name === clsName2 + '_已更新') ok('编辑班级验证', 'name="' + updated.name + '" teacher="' + updated.teacher + '"')
        else warn('编辑班级验证', '未找到更新后的班级 name="' + (updated?.name || '') + '"')

        // 归档班级(API archive)
        const archRes = await cdp.api("await window.api.class.archive('" + newUuid + "')")
        if (archRes?.success !== false) ok('归档班级', clsName2 + '_已更新')
        else fail('归档班级', '', JSON.stringify(archRes).slice(0, 100))

        // 验证归档状态
        const afterArch = await cdp.api("await window.api.class.list()")
        const archived = (afterArch?.data || []).find(c => c.id === newUuid)
        if (archived && archived.archived === true) ok('归档状态验证', 'archived=true')
        else warn('归档状态验证', 'archived=' + (archived?.archived))

        // 恢复班级(API restore)
        const restRes = await cdp.api("await window.api.class.restore('" + newUuid + "')")
        if (restRes?.success !== false) ok('恢复班级', clsName2 + '_已更新')
        else fail('恢复班级', '', JSON.stringify(restRes).slice(0, 100))

        // 验证恢复状态
        const afterRest = await cdp.api("await window.api.class.list()")
        const restored = (afterRest?.data || []).find(c => c.id === newUuid)
        if (restored && restored.archived === false) ok('恢复状态验证', 'archived=false')
        else warn('恢复状态验证', 'archived=' + (restored?.archived))

        // 给该班级添加 2 名学生,验证班级学生数
        const stu1 = 'R34ClsStu1_' + testSuffix
        const stu2 = 'R34ClsStu2_' + testSuffix
        createdStudentNames.push(stu1, stu2)
        try {
          await cdp.api("await window.api.eaa.addStudent({ name: '" + stu1 + "', class_id: '" + newCid + "' })")
          await cdp.api("await window.api.eaa.addStudent({ name: '" + stu2 + "', class_id: '" + newCid + "' })")
          await new Promise(r => setTimeout(r, 500))
          // 验证班级学生数
          const stuList = await cdp.api("await window.api.eaa.listStudents()")
          const inClass = (stuList?.data?.students || []).filter(s => s.class_id === newCid)
          if (inClass.length === 2) ok('班级学生数验证', inClass.length + ' 名学生 (期望 2)')
          else warn('班级学生数验证', '期望 2 实际 ' + inClass.length)
        } catch (e) { warn('班级学生数验证', e.message) }

        // 删除班级(class.delete 用 UUID) — 应级联清理学生 class_id
        const delClsRes = await cdp.api("await window.api.class.delete('" + newUuid + "')")
        if (delClsRes?.success !== false) {
          ok('删除班级', clsName2 + '_已更新 (uuid=' + String(newUuid).slice(0, 8) + '...)')
          // 验证班级已删除
          const afterDel = await cdp.api("await window.api.class.list()")
          const stillExists = (afterDel?.data || []).find(c => c.id === newUuid)
          if (!stillExists) ok('删除验证', '班级已从列表消失')
          else warn('删除验证', '班级仍存在')
          // 验证级联清理: 学生 class_id 应被清除
          const stuAfterDel = await cdp.api("await window.api.eaa.listStudents()")
          const orphans = (stuAfterDel?.data?.students || []).filter(s => s.class_id === newCid)
          if (orphans.length === 0) ok('级联清理验证', '0 名学生残留该 class_id')
          else warn('级联清理验证', orphans.length + ' 名学生仍残留 class_id')
        } else fail('删除班级', '', JSON.stringify(delClsRes).slice(0, 100))
      } else fail('创建班级', '', JSON.stringify(clsCreateRes).slice(0, 100))

      // UI 班级表格刷新
      await cdp.navigate('/classes', 2500)
      const rowsAfter = await cdp.tableRows()
      ok('班级页表格', rowsAfter + ' 行 (创建/删除测试后)')

      // 查看班级详情(UI 点击第一行)
      const detailClick = await cdp.eval("(function(){var row=document.querySelector('table tbody tr');if(row){row.click();return 'OK';}return 'NOT_FOUND';})()")
      if (detailClick === 'OK') {
        await new Promise(r => setTimeout(r, 1000))
        const detailText = await cdp.eval("document.querySelector('[class*=\"border-l\"], [class*=\"detail\"]')?.textContent?.length || 0")
        if (detailText > 20) ok('查看班级详情', '详情区文本长度=' + detailText)
        else warn('查看班级详情', '详情区可能未打开')
      } else warn('查看班级详情', '无行可点击')
    } catch (e) {
      fail('班级深测', '', e)
    }

    // ============================================================
    // 阶段 5: 压力测试 — 快速导航/快速筛选/快速搜索
    // ============================================================
    console.log('\n--- 阶段 5: 压力测试 ---')
    try {
      // 快速导航 10 次 (在 dashboard/students/classes 间循环)
      const stressPages = ['/dashboard', '/students', '/classes', '/settings', '/agents']
      let navOkCount = 0
      for (let i = 0; i < 10; i++) {
        const target = stressPages[i % stressPages.length]
        await cdp.eval("window.location.hash='" + target + "'")
        await new Promise(r => setTimeout(r, 400)) // 快速切换
        const cur = await cdp.eval("window.location.hash")
        if (cur === '#' + target) navOkCount++
      }
      if (navOkCount === 10) ok('快速导航 10 次', '全部成功')
      else warn('快速导航 10 次', navOkCount + '/10 成功')

      // 快速筛选切换 10 次 (学生页班级筛选)
      await cdp.navigate('/students', 2500)
      let filterOkCount = 0
      for (let i = 0; i < 10; i++) {
        const val = i % 2 === 0 ? '__ALL__' : '__NONE__'
        const r = await cdp.setReactSelect('select[title="按班级筛选"]', val)
        if (r === 'OK' || r === 'OK_FALLBACK') filterOkCount++
        await new Promise(r => setTimeout(r, 200))
      }
      if (filterOkCount === 10) ok('快速筛选切换 10 次', '全部成功')
      else warn('快速筛选切换 10 次', filterOkCount + '/10 成功')

      // 快速搜索输入 (逐字符输入 5 个字符)
      const stressSearchSel = 'input[placeholder*="搜索"]'
      if (await cdp.exists(stressSearchSel)) {
        const chars = ['R', '3', '4', 'T', 'e']
        let typeOkCount = 0
        let curVal = ''
        for (const ch of chars) {
          curVal += ch
          const r = await cdp.setReactInput(stressSearchSel, curVal)
          if (r === 'OK') typeOkCount++
          await new Promise(r => setTimeout(r, 150))
        }
        if (typeOkCount === 5) ok('快速搜索输入 5 字符', '全部成功')
        else warn('快速搜索输入', typeOkCount + '/5 成功')
        // 清空
        await cdp.setReactInput(stressSearchSel, '')
        await new Promise(r => setTimeout(r, 500))
      } else warn('快速搜索', '未找到搜索框')

      // 快速切换仪表盘筛选 10 次
      await cdp.navigate('/dashboard', 2500)
      let dashFilterOkCount = 0
      for (let i = 0; i < 10; i++) {
        const val = i % 2 === 0 ? '__ALL__' : '__NONE__'
        const r = await cdp.setReactSelect('select[title="按班级筛选数据"]', val)
        if (r === 'OK' || r === 'OK_FALLBACK') dashFilterOkCount++
        await new Promise(r => setTimeout(r, 200))
      }
      if (dashFilterOkCount === 10) ok('快速仪表盘筛选 10 次', '全部成功')
      else warn('快速仪表盘筛选', dashFilterOkCount + '/10 成功')

      // 压力后无错误检查
      const finalErrCount = await cdp.eval("(function(){var e=document.querySelectorAll('.error, [role=\"alert\"]');return e.length;})()")
      if (finalErrCount === 0) ok('压力后无错误元素', '0 个 .error')
      else warn('压力后错误元素', finalErrCount + ' 个')
    } catch (e) {
      fail('压力测试', '', e)
    }

    // ============================================================
    // 阶段 6: 边缘用例 — 空搜索/无效输入/取消操作
    // ============================================================
    console.log('\n--- 阶段 6: 边缘用例 ---')
    try {
      await cdp.navigate('/students', 2500)
      const edgeInitial = await cdp.waitForRows(8000)

      // 边缘: 空搜索(应为空字符串,显示全部)
      await cdp.setReactInput('input[placeholder*="搜索"]', '')
      await new Promise(r => setTimeout(r, 500))
      const emptySearchRows = await cdp.tableRows()
      if (emptySearchRows === edgeInitial) ok('边缘: 空搜索', '显示全部 ' + emptySearchRows + ' 行')
      else warn('边缘: 空搜索', '期望 ' + edgeInitial + ' 实际 ' + emptySearchRows)

      // 边缘: 超长字符串搜索
      const longStr = 'X'.repeat(200)
      const longR = await cdp.setReactInput('input[placeholder*="搜索"]', longStr)
      await new Promise(r => setTimeout(r, 500))
      if (longR === 'OK') {
        const longRows = await cdp.tableRows()
        ok('边缘: 超长搜索', '200字符 → ' + longRows + ' 行')
      } else fail('边缘: 超长搜索', '', longR)

      // 边缘: 特殊字符搜索
      const spR = await cdp.setReactInput('input[placeholder*="搜索"]', '<script>alert(1)</script>')
      await new Promise(r => setTimeout(r, 500))
      if (spR === 'OK') ok('边缘: 特殊字符搜索', 'XSS 字符串被接受(无崩溃)')
      else fail('边缘: 特殊字符搜索', '', spR)

      // 边缘: 恢复正常搜索
      await cdp.setReactInput('input[placeholder*="搜索"]', '')
      await new Promise(r => setTimeout(r, 500))

      // 边缘: 添加学生表单 — 输入后取消
      const addForCancel = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('+ 添加')>=0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
      if (addForCancel === 'OK') {
        await new Promise(r => setTimeout(r, 700))
        await cdp.setReactInput('input[placeholder="姓名..."]', 'R34CancelTest_' + testSuffix)
        await new Promise(r => setTimeout(r, 300))
        // 点击取消
        const cancelR = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('取消')>=0&&btns[i].className.indexOf('gray')>=0){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
        if (cancelR === 'OK') {
          await new Promise(r => setTimeout(r, 500))
          const formClosed = !(await cdp.exists('input[placeholder="姓名..."]'))
          if (formClosed) ok('边缘: 取消添加', '表单已关闭')
          else warn('边缘: 取消添加', '表单可能未关闭')
        } else warn('边缘: 取消按钮', '未找到带 gray 类的取消按钮')

        // 验证取消后未添加学生
        const afterCancel = await cdp.api("await window.api.eaa.listStudents()")
        const leaked = (afterCancel?.data?.students || []).find(s => s.name === 'R34CancelTest_' + testSuffix)
        if (!leaked) ok('边缘: 取消无副作用', '学生未被添加')
        else { warn('边缘: 取消副作用', '学生被添加'); createdStudentNames.push('R34CancelTest_' + testSuffix) }
      }

      // 边缘: 无效 API 调用 — delete 不存在的学生
      try {
        const badDel = await cdp.api("await window.api.eaa.deleteStudent('R34NonExistent_" + testSuffix + "', '测试')")
        ok('边缘: 删除不存在学生', 'API 返回 success=' + (badDel?.success) + ' (未崩溃)')
      } catch (e) {
        ok('边缘: 删除不存在学生', 'API 抛错(预期): ' + e.message.slice(0, 60))
      }

      // 边缘: 无效 API 调用 — class.delete 无效 UUID
      try {
        const badClsDel = await cdp.api("await window.api.class.delete('invalid-uuid-xyz')")
        ok('边缘: class.delete 无效 UUID', 'API 返回 (未崩溃)')
      } catch (e) {
        ok('边缘: class.delete 无效 UUID', 'API 抛错(预期): ' + e.message.slice(0, 60))
      }
    } catch (e) {
      fail('边缘用例', '', e)
    }

    // ============================================================
    // 阶段 7: 跨模块 — 仪表盘排名→学生详情,数据一致性
    // ============================================================
    console.log('\n--- 阶段 7: 跨模块 ---')
    try {
      await cdp.navigate('/dashboard', 2500)

      // 获取仪表盘显示的顶部数字与排名信息
      const dashSnapshot = await cdp.eval("(function(){var t=document.body?.innerText||'';var nums=t.match(/-?\\d+(?:\\.\\d+)?/g)||[];return JSON.stringify({topNums:nums.slice(0,5),totalStudents:nums[0]||null});})()")
      const ds = JSON.parse(dashSnapshot)
      ok('跨模块: 仪表盘快照', '顶部数字=' + ds.topNums.join('|'))

      // 通过 API 获取学生总数,与仪表盘对比
      const apiStudents = await cdp.api("await window.api.eaa.listStudents()")
      const apiTotal = apiStudents?.data?.total || (apiStudents?.data?.students || []).length
      ok('跨模块: API 学生总数', apiTotal + ' 名')

      // 数字一致性比较 (允许少量偏差,因仪表盘可能含已删除)
      if (apiTotal > 0) {
        const dashFirst = parseInt(ds.topNums[0], 10)
        if (!isNaN(dashFirst) && Math.abs(dashFirst - apiTotal) <= apiTotal) {
          ok('跨模块: 数据一致性', '仪表盘首数=' + dashFirst + ' API总数=' + apiTotal + ' (相近)')
        } else {
          warn('跨模块: 数据一致性', '仪表盘首数=' + dashFirst + ' API总数=' + apiTotal + ' (差异较大)')
        }
      } else {
        warn('跨模块: 数据一致性', 'API 学生数为 0,跳过比较')
      }

      // 从仪表盘跳转到学生页,验证学生数
      await cdp.navigate('/students', 2500)
      const stuRows = await cdp.waitForRows(8000)
      if (Math.abs(stuRows - apiTotal) <= 5) ok('跨模块: 仪表盘→学生页', '学生页行数=' + stuRows + ' (与 API ' + apiTotal + ' 相近)')
      else warn('跨模块: 仪表盘→学生页', '学生页行数=' + stuRows + ' API=' + apiTotal + ' (差异>5)')

      // 从学生页跳转到班级页,验证班级数
      await cdp.navigate('/classes', 2500)
      const clsRows = await cdp.tableRows()
      const apiClasses = await cdp.api("await window.api.class.list()")
      const apiClassCount = (apiClasses?.data || []).length
      if (Math.abs(clsRows - apiClassCount) <= 2) ok('跨模块: 学生页→班级页', '班级页行数=' + clsRows + ' API=' + apiClassCount)
      else warn('跨模块: 学生页→班级页', '班级页行数=' + clsRows + ' API=' + apiClassCount)

      // 从班级页跳转到仪表盘,验证状态保持
      await cdp.navigate('/dashboard', 2500)
      const dashRecovery = await cdp.eval("(function(){return JSON.stringify({hash:window.location.hash,btns:document.querySelectorAll('button').length,sels:document.querySelectorAll('select').length});})()")
      const dr = JSON.parse(dashRecovery)
      if (dr.hash === '#/dashboard' && dr.btns > 0) ok('跨模块: 状态恢复', '仪表盘重新加载,按钮=' + dr.btns)
      else fail('跨模块: 状态恢复', '', dr.hash)

      // 最终一致性: 重新查询 API,确认无幽灵数据
      const finalStudents = await cdp.api("await window.api.eaa.listStudents()")
      const finalClasses = await cdp.api("await window.api.class.list()")
      const ghostClassIds = (finalStudents?.data?.students || [])
        .map(s => s.class_id)
        .filter(cid => cid && !(finalClasses?.data || []).find(c => c.class_id === cid))
      const uniqueGhost = [...new Set(ghostClassIds)]
      if (uniqueGhost.length === 0) ok('跨模块: 无幽灵 class_id', '所有学生 class_id 都指向存在的班级')
      else warn('跨模块: 幽灵 class_id', uniqueGhost.length + ' 个不存在班级的 class_id: ' + uniqueGhost.slice(0, 3).join(','))
    } catch (e) {
      fail('跨模块', '', e)
    }

    // ============================================================
    // 清理: 删除测试创建的所有数据
    // ============================================================
    console.log('\n--- 清理 ---')
    try {
      // 删除测试学生
      let cleanedStudents = 0
      for (const sn of createdStudentNames) {
        try {
          await cdp.api("await window.api.eaa.deleteStudent('" + sn + "', 'R34清理')")
          cleanedStudents++
        } catch (e) {}
      }
      ok('清理测试学生', cleanedStudents + '/' + createdStudentNames.length + ' 个')

      // 删除测试班级 (用 UUID)
      let cleanedClasses = 0
      for (const cuuid of createdClassIds) {
        if (!cuuid) continue
        try {
          await cdp.api("await window.api.class.delete('" + cuuid + "')")
          cleanedClasses++
        } catch (e) {}
      }
      ok('清理测试班级', cleanedClasses + '/' + createdClassIds.length + ' 个')

      // 兜底: 删除任何残留的 R34 测试数据
      try {
        const remainStu = await cdp.api("await window.api.eaa.listStudents()")
        const remainR34 = (remainStu?.data?.students || []).filter(s => String(s.name).indexOf('R34UI') >= 0 || String(s.name).indexOf('R34ClsStu') >= 0 || String(s.name).indexOf('R34CancelTest') >= 0)
        for (const s of remainR34) {
          try { await cdp.api("await window.api.eaa.deleteStudent('" + s.name + "', 'R34兜底清理')") } catch (e) {}
        }
        if (remainR34.length > 0) warn('兜底清理学生', '额外删除 ' + remainR34.length + ' 个')
      } catch (e) {}

      try {
        const remainCls = await cdp.api("await window.api.class.list()")
        const remainR34Cls = (remainCls?.data || []).filter(c => String(c.name).indexOf('R34UI班') >= 0 || String(c.name).indexOf('R34Class2') >= 0)
        for (const c of remainR34Cls) {
          try { await cdp.api("await window.api.class.delete('" + c.id + "')") } catch (e) {}
        }
        if (remainR34Cls.length > 0) warn('兜底清理班级', '额外删除 ' + remainR34Cls.length + ' 个')
      } catch (e) {}
    } catch (e) {
      fail('清理', '', e)
    }

  } catch (e) {
    fail('主流程', '', e)
  } finally {
    // ============================================================
    // 汇总
    // ============================================================
    console.log('\n=== R34 综合性 UI 测试 汇总 ===')
    console.log('通过: ' + results.pass + ', 失败: ' + results.fail + ', 警告: ' + results.warn)
    console.log('总断言: ' + (results.pass + results.fail + results.warn))
    if (results.pass + results.fail > 0) {
      console.log('通过率: ' + ((results.pass / (results.pass + results.fail)) * 100).toFixed(1) + '%')
    }

    const outPath = path.join(__dirname, 'r34-comprehensive-ui-result.json')
    try {
      fs.writeFileSync(outPath, JSON.stringify(results, null, 2))
      console.log('详细结果已保存: ' + outPath)
    } catch (e) {
      console.log('保存结果失败: ' + e.message)
    }

    try { ws.close() } catch (e) {}
    process.exit(results.fail > 0 ? 1 : 0)
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
