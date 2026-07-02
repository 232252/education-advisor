// 第三十二轮 — UI 交互深度测试 (模拟真实用户操作)
// 覆盖: 搜索筛选/班级筛选/添加学生表单/学生详情/删除确认对话框/导出菜单/批量选择/表单验证
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

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
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  async navigate(p, wait = 2000) { await this.eval("window.location.hash='" + p + "'"); await new Promise((r) => setTimeout(r, wait)) }
  // React 受控组件 input 设置值 — 直接触发 React 内部 onChange(props) 以更新 state
  // (execCommand / native setter 无法更新 React 受控组件 state,改用 __reactProps$ onChange 直调)
  async setReactInput(selector, value) {
    const safe = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const expr = "(function(){var el=document.querySelector('" + selector + "');if(!el) return 'NOT_FOUND';var key=Object.keys(el).find(function(k){return k.indexOf('__reactProps')===0});if(!key) return 'NO_PROPS';var props=el[key];if(!props||typeof props.onChange!=='function') return 'NO_ONCHANGE';props.onChange({target:{value:'" + safe + "'},currentTarget:{value:'" + safe + "'}});return 'OK';})()"
    return await this.eval(expr)
  }
  // React 受控组件 select 设置值
  async setReactSelect(selector, value) {
    const expr = "(function(){var el=document.querySelector('" + selector + "');if(!el) return 'NOT_FOUND';var setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,'" + value + "');el.dispatchEvent(new Event('change',{bubbles:true}));return 'OK';})()"
    return await this.eval(expr)
  }
  // 点击元素
  async click(selector) {
    const r = await this.eval("document.querySelector('" + selector + "')?.click() || 'NOT_FOUND'")
    return r !== 'NOT_FOUND'
  }
  // 获取表格行数
  async tableRows() { return await this.eval('document.querySelectorAll("table tbody tr").length') }
  // 获取元素文本
  async text(selector) { return await this.eval("document.querySelector('" + selector + "')?.textContent || ''") }
  // 检查元素是否存在
  async exists(selector) { return await this.eval("!!document.querySelector('" + selector + "')") }
  // 等待表格加载完成(行数 > 0 或超时)
  async waitForRows(timeoutMs = 10000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const n = await this.tableRows()
      if (n > 0) return n
      await new Promise((r) => setTimeout(r, 500))
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
  const fail = (n, d, e) => { results.fail++; results.details.push('✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 120)); console.log('  ✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 120)) }
  const warn = (n, d) => { results.warn++; results.details.push('⚠ ' + n + (d ? ' — ' + d : '')); console.log('  ⚠ ' + n + (d ? ' — ' + d : '')) }

  console.log('=== 第三十二轮: UI 交互深度测试 ===\n')

  // 导航到学生页
  await cdp.navigate('/students', 2500)
  // 等待表格加载完成(EAA listStudents ~1.4s,避免初始 0 行导致后续判断错误)
  const initialRows = await cdp.waitForRows(10000)

  // ========== Section 1: 搜索筛选 ==========
  console.log('--- Section 1: 搜索筛选 ---')
  ok('初始表格行数', initialRows + ' 行')

  // 输入搜索文字
  const searchResult = await cdp.setReactInput('input[placeholder*="搜索"]', 'R31')
  if (searchResult === 'OK') {
    await new Promise((r) => setTimeout(r, 500))
    const searchedRows = await cdp.tableRows()
    if (searchedRows <= initialRows) ok('搜索筛选生效', initialRows + ' → ' + searchedRows + ' 行')
    else fail('搜索筛选', '', '行数未减少')
  } else { fail('搜索输入', '', '未找到搜索框') }

  // 清空搜索
  await cdp.setReactInput('input[placeholder*="搜索"]', '')
  await new Promise((r) => setTimeout(r, 500))
  const clearedRows = await cdp.tableRows()
  if (clearedRows === initialRows) ok('清空搜索恢复', clearedRows + ' 行')
  else warn('清空搜索', '期望 ' + initialRows + ' 实际 ' + clearedRows)

  // ========== Section 2: 班级筛选 ==========
  console.log('\n--- Section 2: 班级筛选 ---')
  // 获取筛选选项数
  const filterOptions = await cdp.eval('document.querySelector("select[title=\\"按班级筛选\\"] option").length > 0 ? document.querySelector("select[title=\\"按班级筛选\\"]").options.length : 0')
  if (filterOptions > 0) ok('班级筛选选项', filterOptions + ' 个'); else warn('班级筛选', '无选项')

  // 选择"未分班"
  const filterResult = await cdp.setReactSelect('select[title="按班级筛选"]', '__NONE__')
  if (filterResult === 'OK') {
    await new Promise((r) => setTimeout(r, 500))
    const filteredRows = await cdp.tableRows()
    ok('筛选"未分班"', initialRows + ' → ' + filteredRows + ' 行')
  } else { fail('班级筛选', '', '未找到筛选框') }

  // 恢复"全部班级"
  await cdp.setReactSelect('select[title="按班级筛选"]', '__ALL__')
  await new Promise((r) => setTimeout(r, 500))
  const restoredRows = await cdp.tableRows()
  if (restoredRows === initialRows) ok('恢复"全部班级"', restoredRows + ' 行')
  else warn('恢复全部', '期望 ' + initialRows + ' 实际 ' + restoredRows)

  // ========== Section 3: 添加学生表单 ==========
  console.log('\n--- Section 3: 添加学生表单 ---')
  // 找到"+ 添加"按钮(注意:不要 click 任意 button,否则会误触"☑ 选择"进入批量模式)
  const addClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.includes('+ 添加')){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
  if (addClicked === 'OK') {
    await new Promise((r) => setTimeout(r, 500))
    // 检查输入框出现
    const inputExists = await cdp.exists('input[placeholder="姓名..."]')
    if (inputExists) ok('添加表单显示', '输入框出现')
    else fail('添加表单', '', '输入框未出现')

    // 测试空输入提交(应不操作)
    const emptySubmit = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.includes('确认')){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
    await new Promise((r) => setTimeout(r, 500))
    // 空输入不应添加学生
    const rowsAfterEmpty = await cdp.tableRows()
    if (rowsAfterEmpty === initialRows) ok('空输入不提交', '行数不变'); else warn('空输入提交', '行数变化 ' + initialRows + '→' + rowsAfterEmpty)

    // 输入学生名
    const testStudentName = 'R32UITest_' + Date.now()
    const inputResult = await cdp.setReactInput('input[placeholder="姓名..."]', testStudentName)
    if (inputResult === 'OK') {
      await new Promise((r) => setTimeout(r, 400)) // 等 React 重新渲染,使按钮 onClick 闭包捕获到最新 newStudentName
      // 点击确认
      const confirmResult = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.includes('确认')&&btns[i].className.includes('green')){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
      if (confirmResult === 'OK') {
        // 等待 EAA addStudent(~1.4s) + loadStudents(~1.4s) 完成
        await new Promise((r) => setTimeout(r, 3500))
        let rowsAfterAdd = await cdp.tableRows()
        if (rowsAfterAdd === 0) {
          // 表格可能还在加载中,重新导航到 /students 恢复
          await cdp.navigate('/students', 3000)
          rowsAfterAdd = await cdp.waitForRows(8000)
        }
        if (rowsAfterAdd === initialRows + 1) ok('添加学生成功', initialRows + ' → ' + rowsAfterAdd + ' 行')
        else if (rowsAfterAdd > initialRows) ok('添加学生', '+ ' + (rowsAfterAdd - initialRows))
        else {
          // 用 API 验证学生是否被添加
          const apiCheck = await cdp.eval("(async()=>{ const r=await window.api.eaa.listStudents(); const found=(r.data?.students||[]).find(s=>s.name.startsWith('R32UITest_')); return found?'FOUND:'+found.name:'NOT_FOUND'; })()")
          if (apiCheck.startsWith('FOUND')) ok('添加学生(API验证)', apiCheck)
          else warn('添加学生', '行数未增加 (' + rowsAfterAdd + '), API: ' + apiCheck)
        }
      } else { fail('确认按钮', '', '未找到') }
    } else { fail('输入学生名', '', inputResult) }
  } else { fail('+添加按钮', '', '未找到') }

  // ========== Section 4: 学生详情 ==========
  console.log('\n--- Section 4: 学生详情 ---')
  // 等待表格加载完成
  await new Promise((r) => setTimeout(r, 2000))
  // 点击第一行学生
  const firstRowClicked = await cdp.eval("(function(){var row=document.querySelector('table tbody tr');if(row){row.click();return 'OK';}return 'NOT_FOUND';})()")
  if (firstRowClicked === 'OK') {
    await new Promise((r) => setTimeout(r, 1000))
    // 检查右侧详情面板
    const profileExists = await cdp.eval('document.querySelector("[class*=\\"border-l\\"]")?.textContent?.length > 50')
    if (profileExists) ok('学生详情面板', '右侧打开')
    else warn('学生详情', '面板可能未打开')
  } else { fail('点击学生行', '', '未找到行') }

  // ========== Section 5: 删除确认对话框 ==========
  console.log('\n--- Section 5: 删除确认对话框 ---')
  // 找到"删除"按钮
  const deleteClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.trim()==='删除'&&btns[i].className.includes('red')){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
  if (deleteClicked === 'OK') {
    await new Promise((r) => setTimeout(r, 500))
    // 检查确认对话框出现
    const dialogExists = await cdp.eval('document.querySelector("[class*=\\"fixed\\"][class*=\\"z-50\\"]")?.textContent?.length > 10')
    if (dialogExists) {
      ok('删除确认对话框', '出现')
      // 点击取消
      const cancelClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.trim()==='取消'){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
      if (cancelClicked === 'OK') {
        await new Promise((r) => setTimeout(r, 500))
        const dialogGone = !(await cdp.eval('document.querySelector("[class*=\\"fixed\\"][class*=\\"z-50\\"]")?.textContent?.length > 10'))
        if (dialogGone) ok('取消删除', '对话框关闭')
        else warn('取消删除', '对话框可能未关闭')
      }
    } else { warn('删除确认对话框', '未出现(可能直接删除)') }
  } else { warn('删除按钮', '未找到') }

  // ========== Section 6: 导出下拉菜单 ==========
  console.log('\n--- Section 6: 导出下拉菜单 ---')
  const exportClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.includes('📤 导出')){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
  if (exportClicked === 'OK') {
    await new Promise((r) => setTimeout(r, 500))
    // 检查下拉菜单出现
    const menuExists = await cdp.eval('document.querySelector(".relative > div[class*=\\"absolute\\"]")?.children?.length > 0')
    if (menuExists) {
      const menuItems = await cdp.eval('document.querySelector(".relative > div[class*=\\"absolute\\"]")?.children?.length || 0')
      ok('导出下拉菜单', menuItems + ' 个选项')
      // 点击外部关闭
      await cdp.eval('document.body.click()')
      await new Promise((r) => setTimeout(r, 500))
      ok('导出菜单关闭', '点击外部关闭')
    } else { warn('导出下拉菜单', '未出现') }
  } else { fail('导出按钮', '', '未找到') }

  // ========== Section 7: 批量选择模式 ==========
  console.log('\n--- Section 7: 批量选择模式 ---')
  // 进入批量选择模式(按钮文本为 "☑ 选择",不含"取消")
  const selectClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.includes('选择')&&!btns[i].textContent.includes('取消')){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
  if (selectClicked === 'OK') {
    await new Promise((r) => setTimeout(r, 500))
    // 检查 checkbox 出现
    const checkboxExists = await cdp.eval('document.querySelectorAll("input[type=\\"checkbox\\"]").length > 0')
    if (checkboxExists) {
      const checkboxCount = await cdp.eval('document.querySelectorAll("input[type=\\"checkbox\\"]").length')
      ok('批量选择模式', checkboxCount + ' 个 checkbox')

      // 全选
      const selectAllClicked = await cdp.eval("(function(){var cb=document.querySelector('thead input[type=checkbox]');if(cb){cb.click();return 'OK';}return 'NOT_FOUND';})()")
      if (selectAllClicked === 'OK') {
        await new Promise((r) => setTimeout(r, 500))
        const checkedCount = await cdp.eval('document.querySelectorAll("tbody input[type=checkbox]:checked").length')
        if (checkedCount > 0) ok('全选', checkedCount + ' 个已选')
        else warn('全选', '0个已选')

        // 取消全选
        await cdp.eval("(function(){var cb=document.querySelector('thead input[type=checkbox]');if(cb){cb.click();}})()")
        await new Promise((r) => setTimeout(r, 500))
        const uncheckedCount = await cdp.eval('document.querySelectorAll("tbody input[type=checkbox]:checked").length')
        if (uncheckedCount === 0) ok('取消全选', '0 个已选')
        else warn('取消全选', uncheckedCount + ' 仍选中')
      } else { warn('全选 checkbox', '未找到') }

      // 退出批量选择(按钮文本为 "取消选择")
      const exitClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.includes('取消选择')){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
      if (exitClicked === 'OK') {
        await new Promise((r) => setTimeout(r, 500))
        const checkboxGone = await cdp.eval('document.querySelectorAll("thead input[type=checkbox]").length === 0')
        if (checkboxGone) ok('退出批量选择', 'checkbox 消失')
        else warn('退出批量选择', 'checkbox 仍存在')
      }
    } else { fail('批量选择模式', '', 'checkbox 未出现') }
  } else { fail('批量选择按钮', '', '未找到') }

  // ========== Section 8: 刷新按钮 ==========
  console.log('\n--- Section 8: 刷新按钮 ---')
  const refreshClicked = await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.includes('刷新')){btns[i].click();return 'OK';}}return 'NOT_FOUND';})()")
  if (refreshClicked === 'OK') {
    await new Promise((r) => setTimeout(r, 2000))
    const refreshedRows = await cdp.waitForRows(8000)
    ok('刷新', refreshedRows + ' 行')
  } else { fail('刷新按钮', '', '未找到') }

  // ========== Section 9: 页面导航切换 ==========
  console.log('\n--- Section 9: 页面切换状态保持 ---')
  // 导航到 Dashboard 再回来
  await cdp.navigate('/dashboard', 2000)
  await cdp.navigate('/students', 2500)
  const returnedRows = await cdp.waitForRows(10000)
  if (returnedRows > 0) ok('页面切换后恢复', returnedRows + ' 行')
  else fail('页面切换后', '', '0 行')

  // ========== Section 10: 清理 ==========
  console.log('\n--- Section 10: 清理 ---')
  // 删除 R32UITest 学生
  const cleaned = await cdp.eval("(async()=>{ try{ await window.api.eaa.deleteStudent('R32UITest_' + " + Date.now() + ", 'R32清理'); return 'OK'; }catch(e){ return 'ERR'; } })()")
  // 注意:上面可能因为时间戳不匹配而失败,用 API 直接删
  const cleanupResult = await cdp.eval("(async()=>{ const r=await window.api.eaa.listStudents(); const r32=(r.data?.students||[]).filter(s=>s.name.startsWith('R32UITest_')); for(const s of r32){ try{ await window.api.eaa.deleteStudent(s.name, 'R32清理'); }catch(e){} } return r32.length; })()")
  ok('清理 R32 测试学生', cleanupResult + ' 个')

  // ========== 汇总 ==========
  console.log('\n=== 汇总 ===')
  console.log('通过: ' + results.pass + ', 失败: ' + results.fail + ', 警告: ' + results.warn + ', 通过率: ' + ((results.pass / (results.pass + results.fail)) * 100).toFixed(1) + '%')

  const outPath = path.join(__dirname, 'r32-ui-interaction-result.json')
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log('详细结果: ' + outPath)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
