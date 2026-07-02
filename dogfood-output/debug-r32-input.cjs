// Debug: 验证 React __reactProps onChange 方式是否能更新 StudentsPage 表单 state
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 60000) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== Debug R32 Input ===\n')
  // 导航到学生页
  await cdp.eval("window.location.hash='/students'")
  await new Promise((r) => setTimeout(r, 3000))

  // 1. 初始行数
  const rows0 = await cdp.eval('document.querySelectorAll("table tbody tr").length')
  console.log('1. 初始行数:', rows0)

  // 2. 列出所有按钮文本
  const btnTexts = await cdp.eval("(function(){var btns=document.querySelectorAll('button');var arr=[];for(var i=0;i<btns.length;i++){arr.push(btns[i].textContent.trim().substring(0,20));}return JSON.stringify(arr);})()")
  console.log('2. 按钮列表:', btnTexts)

  // 3. 点击 + 添加
  const addClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.includes('+ 添加')){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
  console.log('3. 点击+添加:', addClicked)
  await new Promise((r) => setTimeout(r, 800))

  // 4. 检查输入框
  const inputInfo = await cdp.eval("(function(){var el=document.querySelector('input[placeholder*=\"姓名\"]');if(!el) return JSON.stringify({found:false});var keys=Object.keys(el).filter(function(k){return k.indexOf('__reactProps')===0});var props=keys.length?el[keys[0]]:null;return JSON.stringify({found:true,placeholder:el.placeholder,value:el.value,reactPropsKeys:keys,hasOnChange:props&&typeof props.onChange==='function',onChangeType:props?typeof props.onChange:null,propKeys:props?Object.keys(props).slice(0,10):[]});})()")
  console.log('4. 输入框信息:', inputInfo)

  // 5. 调用 onChange
  const onChangeResult = await cdp.eval("(function(){var el=document.querySelector('input[placeholder*=\"姓名\"]');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(!key) return 'NO_PROPS';var props=el[key];if(!props||typeof props.onChange!=='function') return 'NO_ONCHANGE';try{props.onChange({target:{value:'DebugR32_123'},currentTarget:{value:'DebugR32_123'}});return 'OK';}catch(e){return 'ERR:'+e.message;}})()")
  console.log('5. 调用 onChange:', onChangeResult)
  await new Promise((r) => setTimeout(r, 500))

  // 6. 检查 input.value 是否更新
  const valAfter = await cdp.eval("(function(){var el=document.querySelector('input[placeholder*=\"姓名\"]');return el?el.value:'NO_INPUT';})()")
  console.log('6. onChange 后 input.value:', valAfter)

  // 7. 点击确认按钮
  const confirmResult = await cdp.eval("(function(){var btns=document.querySelectorAll('button');var matches=[];for(var i=0;i<btns.length;i++){if(btns[i].textContent.includes('确认')){matches.push({text:btns[i].textContent.trim(),classes:btns[i].className.substring(0,60),disabled:btns[i].disabled});}}return JSON.stringify(matches);})()")
  console.log('7. 确认按钮候选:', confirmResult)

  // 点击 green 确认
  const clickConfirm = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.includes('确认')&&btns[i].className.includes('green')){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
  console.log('8. 点击确认:', clickConfirm)
  await new Promise((r) => setTimeout(r, 4000))

  // 9. 行数 + API 检查
  const rowsAfter = await cdp.eval('document.querySelectorAll("table tbody tr").length')
  console.log('9. 添加后行数:', rowsAfter)
  const apiCheck = await cdp.eval("(async()=>{ const r=await window.api.eaa.listStudents(); const found=(r.data?.students||[]).find(s=>s.name.startsWith('DebugR32_')); return found?'FOUND:'+found.name:'NOT_FOUND'; })()")
  console.log('10. API 验证:', apiCheck)

  // 清理
  if (apiCheck.startsWith('FOUND')) {
    const name = apiCheck.split(':')[1]
    await cdp.eval("(async()=>{ await window.api.eaa.deleteStudent('" + name + "', 'debug清理'); return 'OK'; })()")
    console.log('清理:', name)
  }

  ws.close()
  process.exit(0)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
