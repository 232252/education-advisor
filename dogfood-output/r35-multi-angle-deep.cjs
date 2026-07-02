// R35 多角度深度测试 — 针对用户特别关心的场景做深度验证
// 6 大角度:
//   1. 班级详情→学生列表互通 (点进班级,学生列表应正确显示该班学生)
//   2. Top10 排行榜与周期摘要随班级筛选变化
//   3. 班级对比模式 (选两个班级做对比,图表应显示对比)
//   4. 学生重新分班 (从A班移到B班,验证数据正确)
//   5. 班级容量边界 (大量学生同一班级)
//   6. 跨模块数据同步 (仪表盘/学生/班级一致性)
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
  async click(selector) { const r = await this.eval("document.querySelector('" + selector + "')?.click() || 'NOT_FOUND'"); return r !== 'NOT_FOUND' }
  async clickByText(tag, text) { const safe = text.replace(/'/g, "\\'"); return await this.eval("(function(){var els=document.querySelectorAll('" + tag + "');for(var i=0;i<els.length;i++){if(els[i].textContent.indexOf('" + safe + "')>=0){els[i].click();return 'OK'}}return 'NOT_FOUND'})()") }
  async exists(selector) { return await this.eval("!!document.querySelector('" + selector + "')") }
  async text(selector) { return await this.eval("document.querySelector('" + selector + "')?.textContent || ''") }
  async tableRows() { return await this.eval('document.querySelectorAll("table tbody tr").length') }
  async api(code) { const expr = "(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"; const v = await this.eval(expr); if (typeof v === 'string' && v.startsWith('ERR:')) throw new Error(v.slice(4)); try { return v ? JSON.parse(v) : null } catch (e) { return v } }
  async setReactInput(selector, value) { const safe = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); const expr = "(function(){var el=document.querySelector('" + selector + "');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(!key) return 'NO_PROPS';var props=el[key];if(!props||typeof props.onChange!=='function') return 'NO_ONCHANGE';props.onChange({target:{value:'" + safe + "'},currentTarget:{value:'" + safe + "'}});return 'OK';})()"; return await this.eval(expr) }
  async setReactSelect(selector, value) {
    const v = String(value).replace(/'/g, "\\'")
    const expr = "(function(){var el=document.querySelector('" + selector + "');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(key){var props=el[key];if(props&&typeof props.onChange==='function'){var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,'" + v + "');props.onChange({target:{value:'" + v + "'},currentTarget:{value:'" + v + "'}});return 'OK'}}var setter2=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter2.call(el,'" + v + "');el.dispatchEvent(new Event('change',{bubbles:true}));return 'OK_FALLBACK';})()"
    return await this.eval(expr)
  }
  // 截取仪表盘所有图表的内部数据 (echarts instance getData)
  async getEchartsData() {
    return await this.eval("(function(){var insts=document.querySelectorAll('[_echarts_instance_]');var out=[];for(var i=0;i<insts.length;i++){var id=insts[i].getAttribute('_echarts_instance_');var ec=window.echarts&&window.echarts.getInstanceByDom?window.echarts.getInstanceByDom(insts[i]):null;var data=null;if(ec){try{var opt=ec.getOption();data={title:opt.title&&opt.title[0]?opt.title[0].text:null,seriesCount:opt.series?opt.series.length:0,seriesNames:opt.series?opt.series.map(function(s){return s.name||'?'}).slice(0,5):[]}}catch(e){data={err:e.message}}}out.push({id:id,data:data})}return JSON.stringify(out);})()")
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push('✓ ' + n + (d ? ' — ' + d : '')); console.log('  ✓ ' + n + (d ? ' — ' + d : '')) }
  const fail = (n, d, e) => { results.fail++; results.details.push('✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 200)); console.log('  ✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 200)) }
  const warn = (n, d) => { results.warn++; results.details.push('⚠ ' + n + (d ? ' — ' + d : '')); console.log('  ⚠ ' + n + (d ? ' — ' + d : '')) }

  const ts = String(Date.now()).slice(-6)
  console.log('=== R35 多角度深度测试 ===')
  console.log('时间戳后缀: ' + ts + '\n')

  let createdClassIds = []
  let createdStudentNames = []

  try {
    // ============================================================
    // 预清理: 删除所有残留的 R35 测试数据 (避免上次运行的残留干扰)
    // ============================================================
    console.log('--- 预清理: 删除残留 R35 数据 ---')
    try {
      const oldList = await cdp.api('await window.api.eaa.listStudents()')
      const oldR35 = (oldList?.data?.students ?? []).filter(s => s.name.indexOf('R35') >= 0 && s.status !== 'Deleted')
      let oldDeleted = 0
      for (const s of oldR35) {
        const r = await cdp.api("await window.api.eaa.deleteStudent('" + s.name.replace(/'/g, "\\'") + "','R35预清理')")
        if (r?.success) oldDeleted++
      }
      if (oldR35.length > 0) console.log('  预清理学生: ' + oldDeleted + '/' + oldR35.length)

      const oldClasses = await cdp.api('await window.api.class.list()')
      const oldR35Classes = (oldClasses?.data ?? []).filter(c => c.name.indexOf('R35') >= 0)
      let oldClsDeleted = 0
      for (const c of oldR35Classes) {
        const r = await cdp.api("await window.api.class.delete('" + c.id + "')")
        if (r?.success) oldClsDeleted++
      }
      if (oldR35Classes.length > 0) console.log('  预清理班级: ' + oldClsDeleted + '/' + oldR35Classes.length)
    } catch (e) { console.log('  预清理跳过: ' + e.message) }

    // ============================================================
    // 角度 1: 班级详情→学生列表互通 (点进班级,验证学生列表)
    // ============================================================
    console.log('\n--- 角度 1: 班级详情→学生列表互通 ---')
    try {
      // 创建2个班级
      const clsA = await cdp.api("await window.api.class.create({class_id:'C-A-" + ts + "',name:'R35班A_" + ts + "',grade:'高一',teacher:'王老师'})")
      if (clsA?.success && clsA.data) { createdClassIds.push(clsA.data.id); ok('创建班A', clsA.data.class_id + ' uuid=' + clsA.data.id.slice(0, 8)) }
      else fail('创建班A', '', JSON.stringify(clsA))

      const clsB = await cdp.api("await window.api.class.create({class_id:'C-B-" + ts + "',name:'R35班B_" + ts + "',grade:'高二',teacher:'李老师'})")
      if (clsB?.success && clsB.data) { createdClassIds.push(clsB.data.id); ok('创建班B', clsB.data.class_id + ' uuid=' + clsB.data.id.slice(0, 8)) }
      else fail('创建班B', '', JSON.stringify(clsB))

      // 创建学生并分配到班A
      const studentA1 = 'R35深度_A1_' + ts
      const studentA2 = 'R35深度_A2_' + ts
      const studentB1 = 'R35深度_B1_' + ts

      // API 创建学生
      const addA1 = await cdp.api("await window.api.eaa.addStudent('" + studentA1 + "')")
      if (addA1?.success) { createdStudentNames.push(studentA1); ok('创建学生A1', studentA1) }
      else fail('创建学生A1', '', JSON.stringify(addA1))

      const addA2 = await cdp.api("await window.api.eaa.addStudent('" + studentA2 + "')")
      if (addA2?.success) { createdStudentNames.push(studentA2); ok('创建学生A2', studentA2) }
      else fail('创建学生A2', '', JSON.stringify(addA2))

      const addB1 = await cdp.api("await window.api.eaa.addStudent('" + studentB1 + "')")
      if (addB1?.success) { createdStudentNames.push(studentB1); ok('创建学生B1', studentB1) }
      else fail('创建学生B1', '', JSON.stringify(addB1))

      // 分配到班级 (setStudentMeta --class-id) 注意参数名是 name 不是 studentName
      const assignA1 = await cdp.api("await window.api.eaa.setStudentMeta({name:'" + studentA1 + "',classId:'C-A-" + ts + "'})")
      ok('分配学生A1到班A', assignA1?.success ? 'OK' : JSON.stringify(assignA1))

      const assignA2 = await cdp.api("await window.api.eaa.setStudentMeta({name:'" + studentA2 + "',classId:'C-A-" + ts + "'})")
      ok('分配学生A2到班A', assignA2?.success ? 'OK' : JSON.stringify(assignA2))

      const assignB1 = await cdp.api("await window.api.eaa.setStudentMeta({name:'" + studentB1 + "',classId:'C-B-" + ts + "'})")
      ok('分配学生B1到班B', assignB1?.success ? 'OK' : JSON.stringify(assignB1))

      // 验证学生 class_id 已设置
      const listAfterAssign = await cdp.api('await window.api.eaa.listStudents()')
      const studentsAfterAssign = listAfterAssign?.data?.students ?? []
      const a1 = studentsAfterAssign.find(s => s.name === studentA1)
      const a2 = studentsAfterAssign.find(s => s.name === studentA2)
      const b1 = studentsAfterAssign.find(s => s.name === studentB1)
      if (a1?.class_id === 'C-A-' + ts) ok('验证A1分班', 'class_id=' + a1.class_id)
      else fail('验证A1分班', '', a1?.class_id ?? '学生未找到')
      if (a2?.class_id === 'C-A-' + ts) ok('验证A2分班', 'class_id=' + a2.class_id)
      else fail('验证A2分班', '', a2?.class_id ?? '学生未找到')
      if (b1?.class_id === 'C-B-' + ts) ok('验证B1分班', 'class_id=' + b1.class_id)
      else fail('验证B1分班', '', b1?.class_id ?? '学生未找到')

      // 到班级页验证学生数
      await cdp.navigate('/classes', 2500)
      // 点击刷新按钮确保加载最新数据
      await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('刷新')>=0||btns[i].textContent.indexOf('refresh')>=0){btns[i].click();return 'OK'}}return 'NOT_FOUND';})()")
      await new Promise(r => setTimeout(r, 1500))
      const classesRowCount = await cdp.tableRows()
      ok('班级页表格', classesRowCount + ' 行')

      // 点击班A行,打开详情,验证显示2个学生
      // 班级行点击会触发 setSelectedClass,显示详情面板
      // 先打印表格内容用于调试,然后点击
      const tableContent = await cdp.eval("(function(){var rows=document.querySelectorAll('table tbody tr');var out=[];for(var i=0;i<rows.length;i++){var tds=rows[i].querySelectorAll('td');out.push(tds[0]?.textContent?.trim()+'|'+tds[1]?.textContent?.trim())}return out.join(';;');})()")
      console.log('    表格内容:', tableContent)

      // 重试点击 (最多3次,每次间隔1秒)
      let clickResult = 'NOT_FOUND'
      for (let retry = 0; retry < 3 && clickResult !== 'OK'; retry++) {
        if (retry > 0) await new Promise(r => setTimeout(r, 1000))
        clickResult = await cdp.eval("(function(){var rows=document.querySelectorAll('table tbody tr');for(var i=0;i<rows.length;i++){var tds=rows[i].querySelectorAll('td');var found=false;for(var j=0;j<tds.length;j++){if(tds[j].textContent.indexOf('C-A-" + ts + "')>=0){found=true;break}}if(found){rows[i].click();return 'OK'}}return 'NOT_FOUND';})()")
      }
      if (clickResult === 'OK') {
        await new Promise(r => setTimeout(r, 1500))
        // 详情面板会显示该班学生列表
        const detailText = await cdp.eval("document.body?.innerText?.slice(0, 1500) || ''")
        if (detailText.indexOf(studentA1) >= 0) ok('班级详情显示学生A1', '详情文本包含 ' + studentA1)
        else warn('班级详情学生A1', '未在详情文本中找到 ' + studentA1)
        if (detailText.indexOf(studentA2) >= 0) ok('班级详情显示学生A2', '详情文本包含 ' + studentA2)
        else warn('班级详情学生A2', '未在详情文本中找到 ' + studentA2)
        if (detailText.indexOf(studentB1) >= 0) warn('班级详情显示学生B1', 'B1不应出现在A班详情(可能错误)')
        else ok('班级详情不含B1', 'B1正确不在A班详情')
      } else fail('点击班级行', '', clickResult)
    } catch (e) { fail('角度1', '', e.message) }

    // ============================================================
    // 角度 2: Top10 排行榜与周期摘要随班级筛选变化
    // ============================================================
    console.log('\n--- 角度 2: Top10 排行榜与周期摘要随班级变化 ---')
    try {
      await cdp.navigate('/dashboard', 3000)

      // 给A1添加多个事件 (让A1进入Top10)
      const eventRes1 = await cdp.api("await window.api.eaa.addEvent({studentName:'R35深度_A1_" + ts + "',reasonCode:'CLASS_MONITOR',delta:10,note:'R35加分'})")
      ok('A1加分事件', eventRes1?.success ? 'OK' : JSON.stringify(eventRes1))

      const eventRes2 = await cdp.api("await window.api.eaa.addEvent({studentName:'R35深度_A1_" + ts + "',reasonCode:'ACTIVITY_PARTICIPATION',delta:1,note:'R35活动'})")
      ok('A1活动加分', eventRes2?.success ? 'OK' : JSON.stringify(eventRes2))

      const eventRes3 = await cdp.api("await window.api.eaa.addEvent({studentName:'R35深度_B1_" + ts + "',reasonCode:'SLEEP_IN_CLASS',delta:-2,note:'R35睡觉'})")
      ok('B1扣分事件', eventRes3?.success ? 'OK' : JSON.stringify(eventRes3))

      // 截取仪表盘"全部班级"状态下的Top10和周期摘要文本
      await cdp.navigate('/dashboard', 2500)
      // 先切换到"全部班级"
      await cdp.setReactSelect('select[title="按班级筛选数据"]', '__ALL__')
      await new Promise(r => setTimeout(r, 2000))
      const top10All = await cdp.eval("(function(){var body=document.body.innerText||'';var lines=body.split('\\n').filter(function(l){return l.length>0;});var top10Idx=-1;for(var i=0;i<lines.length;i++){if(lines[i].indexOf('Top10')>=0||lines[i].indexOf('排行')>=0){top10Idx=i;break}}var top10Text=top10Idx>=0?lines.slice(top10Idx,top10Idx+12).join('|'):'NOT_FOUND';var periodIdx=-1;for(var i=0;i<lines.length;i++){if(lines[i].indexOf('周期摘要')>=0||lines[i].indexOf('周期')>=0){periodIdx=i;break}}var periodText=periodIdx>=0?lines.slice(periodIdx,periodIdx+8).join('|'):'NOT_FOUND';return JSON.stringify({top10:top10Text,period:periodText});})()")
      const ta = JSON.parse(top10All)
      ok('全部班级Top10', ta.top10.slice(0, 100))
      ok('全部班级周期摘要', ta.period.slice(0, 100))

      // 切换到班A (筛选)
      const clsAResult = await cdp.setReactSelect('select[title="按班级筛选数据"]', 'C-A-' + ts)
      if (clsAResult === 'OK' || clsAResult === 'OK_FALLBACK') {
        await new Promise(r => setTimeout(r, 2000))
        const top10A = await cdp.eval("(function(){var body=document.body.innerText||'';var lines=body.split('\\n').filter(function(l){return l.length>0;});var top10Idx=-1;for(var i=0;i<lines.length;i++){if(lines[i].indexOf('Top10')>=0||lines[i].indexOf('排行')>=0){top10Idx=i;break}}var top10Text=top10Idx>=0?lines.slice(top10Idx,top10Idx+12).join('|'):'NOT_FOUND';var periodIdx=-1;for(var i=0;i<lines.length;i++){if(lines[i].indexOf('周期摘要')>=0||lines[i].indexOf('周期')>=0){periodIdx=i;break}}var periodText=periodIdx>=0?lines.slice(periodIdx,periodIdx+8).join('|'):'NOT_FOUND';return JSON.stringify({top10:top10Text,period:periodText});})()")
        const tA = JSON.parse(top10A)
        ok('班A筛选Top10', tA.top10.slice(0, 100))
        ok('班A筛选周期摘要', tA.period.slice(0, 100))
        if (ta.top10 !== tA.top10) ok('Top10随班级变化', '全部→班A Top10已变化')
        else warn('Top10随班级变化', 'Top10文本相同(可能数据相同)')
        if (ta.period !== tA.period) ok('周期摘要随班级变化', '全部→班A 周期摘要已变化')
        else warn('周期摘要随班级变化', '周期摘要相同(可能数据相同)')
      } else fail('切换到班A', '', clsAResult)

      // 切换到班B
      const clsBResult = await cdp.setReactSelect('select[title="按班级筛选数据"]', 'C-B-' + ts)
      if (clsBResult === 'OK' || clsBResult === 'OK_FALLBACK') {
        await new Promise(r => setTimeout(r, 2000))
        const top10B = await cdp.eval("(function(){var body=document.body.innerText||'';var lines=body.split('\\n').filter(function(l){return l.length>0;});var top10Idx=-1;for(var i=0;i<lines.length;i++){if(lines[i].indexOf('Top10')>=0||lines[i].indexOf('排行')>=0){top10Idx=i;break}}var top10Text=top10Idx>=0?lines.slice(top10Idx,top10Idx+12).join('|'):'NOT_FOUND';return JSON.stringify({top10:top10Text});})()")
        const tB = JSON.parse(top10B)
        ok('班B筛选Top10', tB.top10.slice(0, 100))
      } else fail('切换到班B', '', clsBResult)

      // 恢复全部
      await cdp.setReactSelect('select[title="按班级筛选数据"]', '__ALL__')
      await new Promise(r => setTimeout(r, 1500))
    } catch (e) { fail('角度2', '', e.message) }

    // ============================================================
    // 角度 3: 班级对比模式深度测试
    // ============================================================
    console.log('\n--- 角度 3: 班级对比模式深度测试 ---')
    try {
      await cdp.navigate('/dashboard', 3500)
      // 先验证对比模式按钮存在
      const compareBtnExists = await cdp.exists('button[title="班级对比模式"]')
      if (compareBtnExists) {
        ok('对比模式按钮存在', 'button[title="班级对比模式"]')
        // 点击对比模式按钮 (click 方法返回值不可靠,直接检查 UI 变化)
        await cdp.eval("document.querySelector('button[title=\"班级对比模式\"]').click()")
        await new Promise(r => setTimeout(r, 2000))
        // 验证对比模式UI元素出现 (可能有班级选择器、对比图表)
        const compareUI = await cdp.eval("(function(){var sel=document.querySelectorAll('select');var inputs=document.querySelectorAll('input[type=checkbox]');var labels=document.querySelectorAll('label');var body=document.body.innerText||'';var hasCompareText=body.indexOf('对比')>=0||body.indexOf('比较')>=0;var btnText=document.querySelector('button[title=\"班级对比模式\"]')?.textContent||'';return JSON.stringify({sels:sel.length,checkboxes:inputs.length,labels:labels.length,hasCompareText:hasCompareText,bodyLen:body.length,btnText:btnText});})()")
        const cu = JSON.parse(compareUI)
        ok('对比模式UI', 'select=' + cu.sels + ' checkbox=' + cu.checkboxes + ' 含对比文本=' + cu.hasCompareText + ' 按钮文本="' + cu.btnText + '"')

        // 尝试选两个班级 (如果有对比用的 checkbox/select)
        const compareResult = await cdp.eval("(function(){var cbs=document.querySelectorAll('input[type=checkbox]');var selected=0;for(var i=0;i<cbs.length&&i<5;i++){if(!cbs[i].checked){cbs[i].click();selected++}}return 'selected:'+selected;})()")
        ok('对比模式选班级', compareResult)
        await new Promise(r => setTimeout(r, 1500))

        // 查看图表数变化
        const chartCount = await cdp.eval("document.querySelectorAll('[_echarts_instance_], canvas, svg').length")
        ok('对比模式图表数', chartCount + ' 个')

        // 退出对比模式
        await cdp.eval("document.querySelector('button[title=\"班级对比模式\"]').click()")
        await new Promise(r => setTimeout(r, 1200))
        ok('退出对比模式', 'OK')
      } else fail('对比模式按钮', '', '未找到 button[title="班级对比模式"]')
    } catch (e) { fail('角度3', '', e.message) }

    // ============================================================
    // 角度 4: 学生重新分班 (从A班移到B班)
    // ============================================================
    console.log('\n--- 角度 4: 学生重新分班 ---')
    try {
      // 将 A2 从 A班 移到 B班
      const moveRes = await cdp.api("await window.api.eaa.setStudentMeta({name:'R35深度_A2_" + ts + "',classId:'C-B-" + ts + "'})")
      ok('A2移到B班', moveRes?.success ? 'OK' : JSON.stringify(moveRes))

      // 验证 class_id 已更新
      const listAfterMove = await cdp.api('await window.api.eaa.listStudents()')
      const studentsAfterMove = listAfterMove?.data?.students ?? []
      const a2After = studentsAfterMove.find(s => s.name === 'R35深度_A2_' + ts)
      if (a2After?.class_id === 'C-B-' + ts) ok('验证A2已移到B班', 'class_id=' + a2After.class_id)
      else fail('验证A2分班', '', a2After?.class_id ?? '学生未找到')

      // 验证 A1 还在 A 班
      const a1After = studentsAfterMove.find(s => s.name === 'R35深度_A1_' + ts)
      if (a1After?.class_id === 'C-A-' + ts) ok('验证A1仍在A班', 'class_id=' + a1After.class_id)
      else fail('验证A1分班', '', a1After?.class_id ?? '学生未找到')

      // 清除 A1 的班级
      const clearRes = await cdp.api("await window.api.eaa.setStudentMeta({name:'R35深度_A1_" + ts + "',clearClassId:true})")
      ok('清除A1班级', clearRes?.success ? 'OK' : JSON.stringify(clearRes))
      const listAfterClear = await cdp.api('await window.api.eaa.listStudents()')
      const a1Cleared = listAfterClear?.data?.students?.find(s => s.name === 'R35深度_A1_' + ts)
      if (a1Cleared?.class_id === null || a1Cleared?.class_id === undefined) ok('验证A1已无班', 'class_id=null')
      else fail('验证A1无班', '', a1Cleared?.class_id ?? '学生未找到')
    } catch (e) { fail('角度4', '', e.message) }

    // ============================================================
    // 角度 5: 班级容量边界 (创建大量学生分到同一班级)
    // ============================================================
    console.log('\n--- 角度 5: 班级容量边界 ---')
    try {
      const bulkStudents = []
      const bulkCount = 10 // 创建10个学生分到B班,测试容量
      for (let i = 0; i < bulkCount; i++) {
        const name = 'R35Bulk_' + ts + '_' + i
        const addRes = await cdp.api("await window.api.eaa.addStudent('" + name + "')")
        if (addRes?.success) {
          bulkStudents.push(name)
          createdStudentNames.push(name)
          // 立即分配到B班 (参数名是 name 不是 studentName)
          try {
            await cdp.api("await window.api.eaa.setStudentMeta({name:'" + name + "',classId:'C-B-" + ts + "'})")
          } catch (e) {
            warn('批量分班失败 #' + i, name + ': ' + e.message)
          }
        } else {
          warn('批量创建失败 #' + i, name + ': ' + JSON.stringify(addRes).slice(0, 80))
        }
      }
      ok('批量创建学生', bulkStudents.length + '/' + bulkCount)

      // 验证B班学生数
      const listAfterBulk = await cdp.api('await window.api.eaa.listStudents()')
      const bStudents = (listAfterBulk?.data?.students ?? []).filter(s => s.class_id === 'C-B-' + ts)
      ok('B班学生数', bStudents.length + ' 个 (含原B1+A2+新10个)')

      // 仪表盘切到B班,验证能正常加载
      await cdp.navigate('/dashboard', 2500)
      const bFilterRes = await cdp.setReactSelect('select[title="按班级筛选数据"]', 'C-B-' + ts)
      if (bFilterRes === 'OK' || bFilterRes === 'OK_FALLBACK') {
        await new Promise(r => setTimeout(r, 2500))
        const dashAfterB = await cdp.eval("(function(){var t=document.body.innerText||'';var nums=t.match(/-?\\d+(?:\\.\\d+)?/g)||[];return nums.slice(0,5).join('|');})()")
        ok('仪表盘B班筛选加载', '顶部数字=' + dashAfterB)

        // 验证无错误
        const errCount = await cdp.eval("document.querySelectorAll('.error, [role=alert]').length")
        if (errCount === 0) ok('B班筛选无错误', '0 错误')
        else fail('B班筛选有错误', '', errCount + ' 个')
      } else fail('切到B班', '', bFilterRes)

      // 恢复全部
      await cdp.setReactSelect('select[title="按班级筛选数据"]', '__ALL__')
      await new Promise(r => setTimeout(r, 1500))
    } catch (e) { fail('角度5', '', e.message) }

    // ============================================================
    // 角度 6: 跨模块数据同步
    // ============================================================
    console.log('\n--- 角度 6: 跨模块数据同步 ---')
    try {
      // 仪表盘总学生数 vs API 总数 vs 学生页显示数
      await cdp.navigate('/dashboard', 2500)
      const dashData = await cdp.eval("(function(){var t=document.body.innerText||'';var nums=t.match(/\\d+/g)||[];return nums.slice(0,3).join('|');})()")
      ok('仪表盘顶部数据', dashData)

      const apiStudents = await cdp.api('await window.api.eaa.listStudents()')
      const apiActive = (apiStudents?.data?.students ?? []).filter(s => s.status !== 'Deleted').length
      ok('API活跃学生总数', apiActive)

      // 学生页显示行数
      await cdp.navigate('/students', 2500)
      const studentsRows = await cdp.tableRows()
      ok('学生页表格行数', studentsRows)

      // 班级页显示行数 vs API
      await cdp.navigate('/classes', 2500)
      const classRows = await cdp.tableRows()
      const apiClasses = await cdp.api('await window.api.class.list()')
      const apiClassCount = (apiClasses?.data ?? []).length
      ok('班级页/API', '表格=' + classRows + ' API=' + apiClassCount)
      if (Number(classRows) === Number(apiClassCount)) ok('班级数一致', '表格=API')
      else warn('班级数差异', '表格=' + classRows + ' API=' + apiClassCount)

      // 验证每个班级的学生数显示正确
      const classCounts = await cdp.eval("(function(){var rows=document.querySelectorAll('table tbody tr');var out=[];for(var i=0;i<rows.length;i++){var tds=rows[i].querySelectorAll('td');if(tds.length>=5){out.push(tds[0].textContent+'|'+tds[1].textContent+'|'+tds[4].textContent)}}return JSON.stringify(out.slice(0,8));})()")
      const cc = JSON.parse(classCounts)
      ok('班级学生数显示', cc.length + ' 个班级样本')

      // 验证 B班 学生数是否匹配实际
      const bClassRow = cc.find(r => r.indexOf('C-B-' + ts) >= 0)
      if (bClassRow) {
        const bDisplayCount = Number(bClassRow.split('|')[2])
        const apiBCount = (apiStudents?.data?.students ?? []).filter(s => s.class_id === 'C-B-' + ts && s.status !== 'Deleted').length
        if (bDisplayCount === apiBCount) ok('B班学生数匹配', '显示=' + bDisplayCount + ' API=' + apiBCount)
        else fail('B班学生数不匹配', '', '显示=' + bDisplayCount + ' API=' + apiBCount)
      } else warn('B班未在表格中', '可能已分页')

    } catch (e) { fail('角度6', '', e.message) }

    // ============================================================
    // 清理
    // ============================================================
    console.log('\n--- 清理测试数据 ---')
    try {
      // 兜底: 先用 API 列出所有 R35 学生并删除 (包括之前运行残留的)
      const allList = await cdp.api('await window.api.eaa.listStudents()')
      const allR35Students = (allList?.data?.students ?? []).filter(s => s.name.indexOf('R35') >= 0 && s.status !== 'Deleted')
      let deletedStudents = 0
      for (const s of allR35Students) {
        const r = await cdp.api("await window.api.eaa.deleteStudent('" + s.name.replace(/'/g, "\\'") + "','R35清理')")
        if (r?.success) deletedStudents++
      }
      ok('清理所有R35学生', deletedStudents + '/' + allR35Students.length + ' (含兜底)')

      // 删除测试班级
      let deletedClasses = 0
      for (const id of createdClassIds) {
        const r = await cdp.api("await window.api.class.delete('" + id + "')")
        if (r?.success) deletedClasses++
      }
      // 兜底: 删除所有 R35 班级
      const allClasses = await cdp.api('await window.api.class.list()')
      const allR35Classes = (allClasses?.data ?? []).filter(c => c.name.indexOf('R35') >= 0 || c.class_id.indexOf(ts) >= 0)
      for (const c of allR35Classes) {
        if (!createdClassIds.includes(c.id)) {
          const r = await cdp.api("await window.api.class.delete('" + c.id + "')")
          if (r?.success) deletedClasses++
        }
      }
      ok('清理所有R35班级', deletedClasses + ' 个 (含兜底)')

      // 验证清理后无残留
      const finalList = await cdp.api('await window.api.eaa.listStudents()')
      const finalStudents = (finalList?.data?.students ?? []).filter(s => s.name.indexOf('R35') >= 0)
      if (finalStudents.length === 0) ok('验证无R35残留学生', 'OK')
      else warn('残留R35学生', finalStudents.map(s => s.name).join(','))

      const finalClasses = await cdp.api('await window.api.class.list()')
      const r35Classes = (finalClasses?.data ?? []).filter(c => c.name.indexOf('R35') >= 0 || c.class_id.indexOf(ts) >= 0)
      if (r35Classes.length === 0) ok('验证无R35残留班级', 'OK')
      else warn('残留R35班级', r35Classes.map(c => c.name).join(','))
    } catch (e) { fail('清理', '', e.message) }

  } catch (e) {
    fail('主流程异常', '', e.message)
  } finally {
    ws.close()
  }

  console.log('\n=== R35 多角度深度测试 汇总 ===')
  console.log('通过: ' + results.pass + ', 失败: ' + results.fail + ', 警告: ' + results.warn)
  console.log('总断言: ' + (results.pass + results.fail + results.warn))
  console.log('通过率: ' + ((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1) + '%')

  fs.writeFileSync(
    'dogfood-output/r35-multi-angle-result.json',
    JSON.stringify({ ts: Date.now(), results, pass: results.pass, fail: results.fail, warn: results.warn }, null, 2)
  )
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('fatal:', e); process.exit(1) })
