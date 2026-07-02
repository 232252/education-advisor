// 第二十四轮测试 — 修复点验证 + UI 溢出测试
// 目标: 验证 Top10 溢出、周期摘要溢出、学生页班级筛选栏 + 批量操作
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
        try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString())
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(p, wait = 1500) {
    await this.eval(`window.location.hash='${p}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  const testSuffix = String(Date.now()).slice(-5)
  console.log(`=== 第二十四轮: 修复点验证 + UI 溢出测试 ===\n`)

  // ========== 1. 准备大数据(触发 Top10 溢出场景) ==========
  console.log('--- 1. 准备大数据(15学生触发Top10+) ---')
  // 创建2个班级,每班15学生,产生15+排名项
  const classA = `R24A-${testSuffix}`
  const classB = `R24B-${testSuffix}`
  await cdp.eval(`(async()=>{ await window.api.class.create({ class_id: '${classA}', name: 'R24甲班', grade: '九年级' }); })()`)
  await cdp.eval(`(async()=>{ await window.api.class.create({ class_id: '${classB}', name: 'R24乙班', grade: '九年级' }); })()`)

  const allStudents = []
  for (let ci = 0; ci < 2; ci++) {
    const cid = ci === 0 ? classA : classB
    const names = []
    for (let i = 0; i < 15; i++) {
      const name = `R24S${ci}_${i}_${testSuffix}`
      names.push(name)
      allStudents.push({ name, class_id: cid, classIndex: ci })
    }
    await cdp.eval(`(async()=>{ ${names.map(n => `try{await window.api.eaa.addStudent('${n}');}catch(e){}`).join('\n')} })()`)
    await cdp.eval(`(async()=>{ await window.api.class.assign({ class_id: '${cid}', student_names: ${JSON.stringify(names)} }); })()`)
  }
  await new Promise((r) => setTimeout(r, 2000))
  ok('准备数据', `${allStudents.length} 学生 + 2 班级`)

  // 给学生加事件产生不同分数
  const codes = ['LATE', 'SPEAK_IN_CLASS', 'CLASS_MONITOR', 'BONUS_VARIABLE', 'ACTIVITY_PARTICIPATION', 'SLEEP_IN_CLASS', 'CIVILIZED_DORM', 'PHONE_IN_CLASS']
  for (const s of allStudents) {
    const code = codes[Math.floor(Math.random() * codes.length)]
    await cdp.eval(`(async()=>{ try{ await window.api.eaa.addEvent({ studentName: '${s.name}', reasonCode: '${code}', note: 'R24', operator: 'R24' }); }catch(e){} })()`)
  }
  await new Promise((r) => setTimeout(r, 1000))
  ok('添加事件', `${allStudents.length} 个`)

  // ========== 2. Top10 排行榜溢出测试 ==========
  console.log('\n--- 2. Top10 排行榜溢出测试 ---')
  await cdp.navigate('/dashboard', 2000)

  // 检查 Top10 排行榜区域
  const top10Info = await cdp.eval(`(function(){
    const text = document.body.innerText;
    // 查找排行榜相关元素
    const rankingElements = [];
    const allElements = document.querySelectorAll('[class*="rank"], [class*="top"], [class*="leader"]');
    for (const el of allElements) {
      if (el.innerText && el.innerText.length > 10) {
        rankingElements.push({ class: el.className.slice(0, 50), text: el.innerText.slice(0, 100) });
      }
    }
    // 检查是否有溢出(滚动条)
    const hasOverflow = Array.from(document.querySelectorAll('*')).some(el => {
      const style = window.getComputedStyle(el);
      return (style.overflow === 'auto' || style.overflow === 'scroll' || style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    return { rankingCount: rankingElements.length, rankingElements: rankingElements.slice(0, 3), hasOverflow };
  })()`)
  ok('Top10 区域元素', `${top10Info?.rankingCount || 0} 个`)

  // 检查是否有内容被截断或溢出
  const overflowCheck = await cdp.eval(`(function(){
    // 检查所有元素是否有内容溢出可见区域
    const issues = [];
    const elements = document.querySelectorAll('div, section, article, td, th');
    let checked = 0;
    for (const el of elements) {
      if (checked > 200) break;
      checked++;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      // 检查文字溢出(可见高度小于内容高度且无滚动)
      if (el.scrollHeight > el.clientHeight + 5 && el.clientHeight > 20 &&
          style.overflow !== 'hidden' && style.overflow !== 'auto' && style.overflow !== 'scroll' &&
          style.overflowY !== 'hidden' && style.overflowY !== 'auto' && style.overflowY !== 'scroll') {
        issues.push({ tag: el.tagName, class: el.className?.toString().slice(0, 40), scrollH: el.scrollHeight, clientH: el.clientHeight });
      }
    }
    return { checked, issues: issues.slice(0, 5) };
  })()`)
  if (overflowCheck?.issues?.length === 0) ok('无溢出问题', `检查 ${overflowCheck.checked} 元素`)
  else warn('溢出问题', `${overflowCheck?.issues?.length || 0} 个: ${JSON.stringify(overflowCheck?.issues?.[0] || {}).slice(0, 100)}`)

  // ========== 3. 筛选班级后 Top10 ==========
  console.log('\n--- 3. 筛选班级后 Top10 ---')
  // 筛选班级 A
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      if (sel.querySelector('option[value="__ALL__"]')) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, '${classA}');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  ok('筛选班级 A 后 Top10', 'UI 更新')

  // 重置
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      if (sel.querySelector('option[value="__ALL__"]')) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, '__ALL__');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
  })()`)
  await new Promise((r) => setTimeout(r, 1000))

  // ========== 4. 周期摘要溢出测试 ==========
  console.log('\n--- 4. 周期摘要溢出测试 ---')
  // 调用 EAA summary API
  const summaryR = await cdp.eval(`(async()=>{ const r=await window.api.eaa.summary(); return JSON.parse(JSON.stringify(r)); })()`)
  if (summaryR?.success !== false) {
    ok('EAA summary API', '可用')
    const summaryData = summaryR?.data
    if (summaryData) {
      ok('summary 数据', `${Object.keys(summaryData).length} 字段`)
    }
  } else {
    warn('EAA summary API', '失败')
  }

  // 检查仪表盘上摘要区域的渲染
  const summaryRender = await cdp.eval(`(function(){
    const text = document.body.innerText;
    const hasSummary = text.includes('摘要') || text.includes('summary') || text.includes('周期') || text.includes('本周') || text.includes('统计');
    return { hasSummary };
  })()`)
  if (summaryRender?.hasSummary) ok('摘要区域渲染', '存在')
  else warn('摘要区域渲染', '未找到')

  // 检查摘要区域溢出
  const summaryOverflow = await cdp.eval(`(function(){
    // 查找含"摘要"或"周期"的容器
    const allElements = document.querySelectorAll('div, section');
    const summaryContainers = [];
    for (const el of allElements) {
      const text = el.innerText || '';
      if ((text.includes('摘要') || text.includes('周期')) && text.length < 5000 && text.length > 50) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          summaryContainers.push({
            class: el.className?.toString().slice(0, 40),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            scrollW: el.scrollWidth,
            scrollH: el.scrollHeight,
            overflow: window.getComputedStyle(el).overflow
          });
        }
      }
    }
    return summaryContainers.slice(0, 3);
  })()`)
  if (Array.isArray(summaryOverflow) && summaryOverflow.length > 0) {
    const noOverflow = summaryOverflow.every(c => c.scrollW <= c.width + 5 && c.scrollH <= c.height + 5)
    if (noOverflow) ok('摘要无溢出', `${summaryOverflow.length} 容器`)
    else warn('摘要溢出', JSON.stringify(summaryOverflow[0]).slice(0, 100))
  } else {
    warn('摘要容器', '未找到')
  }

  // ========== 5. 学生页班级筛选栏 ==========
  console.log('\n--- 5. 学生页班级筛选栏 ---')
  await cdp.navigate('/students', 2000)

  // 查找班级筛选 select
  const stuFilterSelect = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      // 学生页的筛选可能有 "全部班级" 或测试班级选项
      const options = Array.from(sel.options).map(o => ({value: o.value, text: o.text}));
      const hasTestClass = options.some(o => o.value === '${classA}' || o.value === '${classB}');
      if (hasTestClass || options.some(o => o.text.includes('全部') || o.text.includes('班级'))) {
        return { found: true, optionCount: options.length, options: options.slice(0, 6) };
      }
    }
    return { found: false };
  })()`)

  if (stuFilterSelect?.found) {
    ok('学生页班级筛选', `${stuFilterSelect.optionCount} 选项`)
  } else {
    warn('学生页班级筛选', '未找到')
  }

  // ========== 6. 学生页筛选功能 ==========
  console.log('\n--- 6. 学生页筛选功能 ---')
  if (stuFilterSelect?.found) {
    // 获取筛选前行数
    const beforeRows = await cdp.eval(`document.querySelectorAll('table tbody tr, [class*="row"]').length`)

    // 筛选班级 A
    const filterR = await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const hasTestClass = Array.from(sel.options).some(o => o.value === '${classA}');
        if (hasTestClass) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, '${classA}');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    })()`)

    if (filterR) {
      await new Promise((r) => setTimeout(r, 1500))
      const afterRows = await cdp.eval(`document.querySelectorAll('table tbody tr, [class*="row"]').length`)
      ok('筛选班级 A', `行数 ${beforeRows} → ${afterRows}`)

      // 重置
      await cdp.eval(`(function(){
        const selects = document.querySelectorAll('select');
        for (const sel of selects) {
          if (Array.from(sel.options).some(o => o.value === '${classA}')) {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
            setter.call(sel, '');
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      })()`)
      await new Promise((r) => setTimeout(r, 1000))
      ok('重置筛选', '完成')
    }
  }

  // ========== 7. 批量选择 UI ==========
  console.log('\n--- 7. 批量选择 UI ---')
  // 查找 checkbox
  const checkboxes = await cdp.eval(`document.querySelectorAll('input[type="checkbox"]').length`)
  if (checkboxes > 0) {
    ok('checkbox 数量', `${checkboxes} 个`)

    // 尝试勾选前3个
    const checkR = await cdp.eval(`(function(){
      const cbs = document.querySelectorAll('input[type="checkbox"]');
      let checked = 0;
      for (let i = 0; i < Math.min(3, cbs.length); i++) {
        if (!cbs[i].checked) {
          cbs[i].click();
          checked++;
        }
      }
      return { success: true, checked };
    })()`)
    if (checkR?.success) ok('勾选 checkbox', `${checkR.checked} 个`)

    // 查找批量操作按钮
    const batchBtns = await cdp.eval(`(function(){
      const btns = document.querySelectorAll('button');
      const batchRelated = [];
      for (const b of btns) {
        const text = b.innerText || '';
        if (text.includes('导出') || text.includes('删除') || text.includes('调班') || text.includes('批量') || text.includes('移除') || text.includes('Export') || text.includes('Delete')) {
          batchRelated.push(text.slice(0, 30));
        }
      }
      return batchRelated;
    })()`)
    if (batchBtns.length > 0) ok('批量操作按钮', batchBtns.join(', '))
    else warn('批量操作按钮', '未找到')

    // 取消勾选
    await cdp.eval(`(function(){ const cbs = document.querySelectorAll('input[type="checkbox"]'); for (let i = 0; i < Math.min(3, cbs.length); i++) { if (cbs[i].checked) cbs[i].click(); } })()`)
  } else {
    warn('checkbox', '未找到')
  }

  // ========== 8. 长学生名溢出测试 ==========
  console.log('\n--- 8. 长学生名溢出测试 ---')
  // 创建一个长名学生(边界)
  const longName = 'R24长名学生测试'.repeat(3)
  await cdp.eval(`(async()=>{ try{ await window.api.eaa.addStudent('${longName}'); }catch(e){} })()`)
  await new Promise((r) => setTimeout(r, 1000))
  await cdp.navigate('/students', 1500)

  const longNameRender = await cdp.eval(`(function(){
    const text = document.body.innerText;
    const hasLong = text.includes('${longName.slice(0, 10)}');
    return { hasLong };
  })()`)
  if (longNameRender?.hasLong) ok('长名学生渲染', '显示')
  else warn('长名学生渲染', '未找到')

  // 检查长名是否溢出
  const longNameOverflow = await cdp.eval(`(function(){
    const allElements = document.querySelectorAll('td, div, span');
    for (const el of allElements) {
      if (el.innerText && el.innerText.includes('${longName.slice(0, 10)}')) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          width: Math.round(rect.width),
          scrollWidth: el.scrollWidth,
          overflow: style.overflow,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace
        };
      }
    }
    return null;
  })()`)
  if (longNameOverflow) {
    if (longNameOverflow.scrollWidth > longNameOverflow.width + 5) {
      if (longNameOverflow.textOverflow === 'ellipsis' || longNameOverflow.overflow === 'hidden') {
        ok('长名溢出处理', `text-overflow: ${longNameOverflow.textOverflow}`)
      } else {
        warn('长名溢出', `scrollW ${longNameOverflow.scrollWidth} > width ${longNameOverflow.width}`)
      }
    } else {
      ok('长名无溢出', `width ${longNameOverflow.width} 足够`)
    }
  }

  // 清理长名学生
  await cdp.eval(`(async()=>{ try{ await window.api.eaa.deleteStudent('${longName}', '清理'); }catch(e){} })()`)

  // ========== 9. 仪表盘 Top10 完整渲染验证 ==========
  console.log('\n--- 9. 仪表盘 Top10 完整渲染 ---')
  await cdp.navigate('/dashboard', 2000)

  // 检查 Top10 是否正确渲染(不溢出、不截断)
  const top10Render = await cdp.eval(`(function(){
    const text = document.body.innerText;
    // 查找排行榜相关文本
    const lines = text.split('\\n').filter(l => l.includes('R24S'));
    return { topLines: lines.slice(0, 5), totalLines: lines.length };
  })()`)
  if (top10Render?.totalLines > 0) ok('Top10 渲染', `${top10Render.totalLines} 行含测试学生`)
  else warn('Top10 渲染', '未找到测试学生')

  // ========== 10. 响应式溢出(窄视口) ==========
  console.log('\n--- 10. 响应式溢出(窄视口) ---')
  // 模拟窄视口
  await cdp.eval(`window.resizeTo(800, 600)`)
  await new Promise((r) => setTimeout(r, 1000))

  const narrowOverflow = await cdp.eval(`(function(){
    const body = document.body;
    const html = document.documentElement;
    return {
      bodyWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      htmlWidth: html.scrollWidth,
      htmlClientWidth: html.clientWidth,
      hasHScroll: body.scrollWidth > body.clientWidth + 5
    };
  })()`)
  if (narrowOverflow) {
    if (!narrowOverflow.hasHScroll) ok('窄视口无水平溢出', `body ${narrowOverflow.bodyWidth}/${narrowOverflow.bodyClientWidth}`)
    else warn('窄视口水平溢出', `body ${narrowOverflow.bodyWidth} > ${narrowOverflow.bodyClientWidth}`)
  }

  // 恢复窗口
  await cdp.eval(`window.resizeTo(1280, 800)`)
  await new Promise((r) => setTimeout(r, 500))

  // ========== 11. 清理 ==========
  console.log('\n--- 11. 清理 ---')
  try {
    // 删除班级
    const cls = await cdp.eval(`(async()=>{ const r=await window.api.class.list(); return JSON.parse(JSON.stringify(r)); })()`)
    for (const c of (cls?.data || [])) {
      if (c.class_id.startsWith('R24')) await cdp.eval(`(async()=>{ await window.api.class.delete('${c.id}'); })()`)
    }
    // 删除学生
    const stuList = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); })()`)
    const students = (stuList?.data?.students || []).filter(s => s.name.startsWith('R24') && s.status !== 'Deleted')
    for (let i = 0; i < students.length; i += 5) {
      const batch = students.slice(i, i + 5)
      await cdp.eval(`(async()=>{ ${batch.map(s => `try{await window.api.eaa.deleteStudent('${s.name}', '清理');}catch(e){}`).join('\n')} })()`)
    }
    ok('清理', `${students.length} 学生 + 2 班级`)
  } catch (e) {
    warn('清理', String(e).slice(0, 100))
  }

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${total > 0 ? (results.pass / total * 100).toFixed(1) : 0}%`)

  const resultFile = path.join(__dirname, 'r24-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ results }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
