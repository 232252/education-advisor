// Phase 6 诊断: UI添加学生分班 — 检查 select 选择是否正确
const http = require('http')
const WebSocket = require('ws')

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
  async clickByText(tag, text) { const safe = text.replace(/'/g, "\\'"); return await this.eval("(function(){var els=document.querySelectorAll('" + tag + "');for(var i=0;i<els.length;i++){if(els[i].textContent.indexOf('" + safe + "')>=0){els[i].click();return 'OK'}}return 'NOT_FOUND'})()") }
  async api(code) { const expr = "(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"; const v = await this.eval(expr); if (typeof v === 'string' && v.startsWith('ERR:')) throw new Error(v.slice(4)); try { return v ? JSON.parse(v) : null } catch (e) { return v } }
}

const R = () => Math.floor(Math.random() * 100000).toString(36)

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== Phase 6 诊断: UI添加学生分班 ===\n')

  // 0. 先创建一个测试班级(如果没有的话)
  const clsList = await cdp.api('await window.api.class.list()')
  let testClass = (clsList?.data ?? [])[0]
  if (!testClass) {
    const cid = 'C-DIAG6-' + R()
    const createRes = await cdp.api("await window.api.class.create({class_id:'" + cid + "',name:'诊断6班',grade:'高一',teacher:'测试'})")
    testClass = createRes?.data
    console.log('创建测试班级:', testClass?.name, '(' + testClass?.class_id + ')')
  } else {
    console.log('使用已有班级:', testClass.name, '(' + testClass.class_id + ')')
  }

  // 1. 导航到学生页
  await cdp.navigate('/students', 3000)
  await new Promise(r => setTimeout(r, 2000))

  // 2. 点击"+ 添加"按钮
  const addResult = await cdp.clickByText('button', '添加')
  console.log('点击添加按钮:', addResult)
  await new Promise(r => setTimeout(r, 1000))

  // 3. 列出页面上所有 select 元素
  const selectInfo = await cdp.eval("(function(){var sels=document.querySelectorAll('select');var info=[];for(var i=0;i<sels.length;i++){var s=sels[i];info.push({idx:i,title:s.getAttribute('title')||'',value:s.value,optionCount:s.options.length,firstOptionValue:s.options[0]?s.options[0].value:'',parentClass:s.parentElement?s.parentElement.className.slice(0,80):''})}return JSON.stringify(info)})()")
  console.log('\n页面上所有 select 元素:')
  const selects = JSON.parse(selectInfo)
  selects.forEach(s => {
    console.log('  [', s.idx, '] title="' + s.title + '" value="' + s.value + '" options=' + s.optionCount + ' parent="' + s.parentClass + '"')
  })

  // 4. 找到表单中的 select (没有 title 的那个,在 addingStudent 表单中)
  const formSelectIdx = selects.findIndex(s => !s.title && s.optionCount > 1)
  console.log('\n表单 select 索引:', formSelectIdx, formSelectIdx >= 0 ? '(optionCount=' + selects[formSelectIdx].optionCount + ')' : '(未找到)')

  if (formSelectIdx < 0) {
    console.log('✗ 未找到表单 select')
    ws.close(); return
  }

  // 5. 填写姓名
  const newStuName = 'UI诊断_' + R().slice(0, 5)
  const inputResult = await cdp.eval("(function(){var el=document.querySelector('input[placeholder=\"姓名...\"]');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(key){var props=el[key];if(props&&typeof props.onChange==='function'){var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,'" + newStuName + "');props.onChange({target:{value:'" + newStuName + "'},currentTarget:{value:'" + newStuName + "'}});return 'OK'}}return 'NO_PROPS'})()")
  console.log('填写姓名:', inputResult, '→', newStuName)
  await new Promise(r => setTimeout(r, 500))

  // 6. 选择班级 — 只针对表单 select (按索引)
  const selectExpr = "(function(){var sels=document.querySelectorAll('select');var el=sels[" + formSelectIdx + "];if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(key){var props=el[key];if(props&&typeof props.onChange==='function'){var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,'" + testClass.class_id + "');props.onChange({target:{value:'" + testClass.class_id + "'},currentTarget:{value:'" + testClass.class_id + "'}});return 'OK'}}var setter2=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter2.call(el,'" + testClass.class_id + "');el.dispatchEvent(new Event('change',{bubbles:true}));return 'OK_FALLBACK'})()"
  const selectResult = await cdp.eval(selectExpr)
  console.log('选择班级:', selectResult, '→', testClass.name, '(' + testClass.class_id + ')')
  await new Promise(r => setTimeout(r, 500))

  // 7. 验证 select 的当前值
  const selectValue = await cdp.eval("document.querySelectorAll('select')[" + formSelectIdx + "]?.value || 'EMPTY'")
  console.log('select 当前值:', selectValue)

  // 8. 点击确认按钮
  const confirmResult = await cdp.clickByText('button', '确认')
  console.log('点击确认:', confirmResult)
  await new Promise(r => setTimeout(r, 3000))

  // 9. 验证学生已创建且 class_id 正确
  const verifyStu = await cdp.api('await window.api.eaa.listStudents()')
  const created = (verifyStu?.data?.students ?? []).find(s => s.name === newStuName)
  if (created && created.class_id === testClass.class_id) {
    console.log('\n✓ UI添加学生分班成功!', newStuName, '→', testClass.name, '(class_id=' + created.class_id + ')')
  } else if (created) {
    console.log('\n✗ UI添加学生分班错误: class_id=' + created.class_id + ' 期望 ' + testClass.class_id)
    console.log('  学生完整数据:', JSON.stringify(created, null, 2))
  } else {
    console.log('\n✗ UI添加学生未找到:', newStuName)
  }

  // 清理
  if (created) {
    await cdp.api("await window.api.eaa.deleteStudent('" + newStuName + "','诊断清理')")
    console.log('清理测试学生完成')
  }

  ws.close()
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
