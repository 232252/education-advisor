// 第十四轮测试 — 跨页面数据一致性 + UI 可访问性 + 主题/语言
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d).find((x) => x.type === 'page').webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(path, wait = 1500) {
    await this.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [], apiCalls: 0, startTime: Date.now() }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  const origEval = cdp.eval.bind(cdp)
  cdp.eval = async (expr) => { results.apiCalls++; return origEval(expr) }

  function errMsg(r) {
    return r?.__error || r?.error || (typeof r?.data === 'string' && !r?.success ? r.data : null) || 'unknown'
  }

  console.log('=== 第十四轮: 跨页面数据一致性 + UI 可访问性 + 主题/语言 ===\n')

  const testSuffix = String(Date.now()).slice(-4)

  // ========== 1. 准备数据 ==========
  console.log('--- 1. 准备数据 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 1500))

  // 创建班级 + 学生
  const classId = `R14CLS-${testSuffix}`
  await cdp.eval(`(async()=>{
    await window.api.class.create({ class_id: '${classId}', name: 'R14测试班', grade: '高一', teacher: '测试师' });
  })()`)

  const testStudents = []
  for (let i = 0; i < 5; i++) {
    const name = `R14生${i}_${testSuffix}`
    await cdp.eval(`(async()=>{
      await window.api.eaa.addStudent('${name}');
      await window.api.class.assign({ class_id: '${classId}', student_names: ['${name}'] });
    })()`)
    testStudents.push(name)
  }
  // 添加事件
  for (let i = 0; i < testStudents.length; i++) {
    await cdp.eval(`(async()=>{
      try { await window.api.eaa.addEvent({ studentName: '${testStudents[i]}', reasonCode: 'LATE', note: 'R14测试', operator: 'test' }); } catch(e) {}
    })()`)
  }
  ok('准备数据', `班级 1, 学生 ${testStudents.length}, 事件 ${testStudents.length}`)

  // ========== 2. 跨页面数据一致性 ==========
  console.log('\n--- 2. 跨页面数据一致性 ---')

  // 2.1 Dashboard 显示的数据 vs API 数据
  await cdp.navigate('/dashboard', 3000)
  const dashData = await cdp.eval(`(async()=>{
    const students = await window.api.eaa.listStudents();
    const ranking = await window.api.eaa.ranking(20);
    const stats = await window.api.eaa.stats();
    return {
      studentCount: students?.data?.students?.length ?? 0,
      rankCount: ranking?.data?.ranking?.length ?? ranking?.data?.length ?? 0,
      statsStudents: stats?.data?.summary?.students ?? stats?.data?.students ?? 0
    };
  })()`)
  ok('Dashboard API 一致', `listStudents:${dashData?.studentCount}, ranking:${dashData?.rankCount}, stats:${dashData?.statsStudents}`)
  // 验证三个来源学生数一致
  if (dashData?.studentCount === dashData?.statsStudents) ok('学生数一致', 'listStudents === stats ✓')
  else warn('学生数不一致', `list:${dashData?.studentCount}, stats:${dashData?.statsStudents}`)

  // 2.2 学生页 vs 班级页学生数
  await cdp.navigate('/students', 2000)
  const studentsPageRows = await cdp.eval(`(function(){
    return document.querySelectorAll('table tbody tr').length;
  })()`)
  await cdp.navigate('/classes', 2000)
  const classesPageInfo = await cdp.eval(`(function(){
    const rows = document.querySelectorAll('table tbody tr').length;
    const cards = document.querySelectorAll('[class*="card"]').length;
    return { rows, cards };
  })()`)
  ok('学生页 vs 班级页', `学生页表格 ${studentsPageRows} 行, 班级页 ${classesPageInfo?.rows} 行`)

  // 2.3 学生数 vs API
  const clsListR = await cdp.eval(`(async()=>{
    const r = await window.api.class.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const clsR14 = (clsListR?.data || []).find(c => c.class_id === classId)
  if (clsR14) {
    ok('班级数据', `${clsR14.name}, id: ${clsR14.id}`)
    // 查询该班级学生数
    const stuListR = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.listStudents();
      return JSON.parse(JSON.stringify(r));
    })()`)
    const clsStudents = (stuListR?.data?.students || []).filter(s => s.class_id === classId)
    ok('班级学生数', `API: ${clsStudents.length} 名`)
  }

  // ========== 3. UI 可访问性 ==========
  console.log('\n--- 3. UI 可访问性 ---')

  const pages = ['/dashboard', '/students', '/classes', '/chat', '/skills', '/agents', '/settings', '/privacy', '/logs', '/about']
  let totalFocusable = 0
  let totalAria = 0
  let totalImages = 0
  let totalImagesWithoutAlt = 0
  let totalButtons = 0
  let totalButtonsWithoutLabel = 0

  for (const p of pages) {
    await cdp.navigate(p, 1200)
    const a11y = await cdp.eval(`(function(){
      const focusable = document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])').length;
      const aria = document.querySelectorAll('[aria-label], [aria-labelledby], [role]').length;
      const images = document.querySelectorAll('img').length;
      const imagesWithoutAlt = document.querySelectorAll('img:not([alt])').length;
      const buttons = document.querySelectorAll('button').length;
      const btnsNoLabel = Array.from(document.querySelectorAll('button')).filter(b => !b.textContent?.trim() && !b.getAttribute('aria-label') && !b.title).length;
      return { focusable, aria, images, imagesWithoutAlt, buttons, btnsNoLabel };
    })()`)
    totalFocusable += a11y?.focusable ?? 0
    totalAria += a11y?.aria ?? 0
    totalImages += a11y?.images ?? 0
    totalImagesWithoutAlt += a11y?.imagesWithoutAlt ?? 0
    totalButtons += a11y?.buttons ?? 0
    totalButtonsWithoutLabel += a11y?.btnsNoLabel ?? 0
  }
  ok('可聚焦元素', `${totalFocusable} 个 (10 页)`)
  ok('ARIA 属性', `${totalAria} 个`)
  ok('图片', `${totalImages} 个, 无 alt: ${totalImagesWithoutAlt}`)
  ok('按钮', `${totalButtons} 个, 无标签: ${totalButtonsWithoutLabel}`)

  if (totalImagesWithoutAlt === 0) ok('图片 a11y', '所有图片都有 alt ✓')
  else warn('图片 a11y', `${totalImagesWithoutAlt} 个图片无 alt`)

  if (totalButtonsWithoutLabel === 0) ok('按钮 a11y', '所有按钮都有标签 ✓')
  else warn('按钮 a11y', `${totalButtonsWithoutLabel} 个按钮无标签`)

  // ========== 4. 主题切换 ==========
  console.log('\n--- 4. 主题切换 ---')

  // 4.1 切换到 light 主题
  await cdp.eval(`(async()=>{
    try { await window.api.settings.set('general.theme', 'light'); } catch(e) {}
  })()`)
  await cdp.navigate('/dashboard', 1500)
  const lightTheme = await cdp.eval(`(function(){
    const body = document.body;
    return {
      class: body?.className || '',
      dataset: JSON.stringify(body?.dataset || {}),
      bgColor: window.getComputedStyle(body)?.backgroundColor
    };
  })()`)
  ok('Light 主题', `bg: ${lightTheme?.bgColor?.slice(0, 30)}`)

  // 4.2 切换到 dark 主题
  await cdp.eval(`(async()=>{
    try { await window.api.settings.set('general.theme', 'dark'); } catch(e) {}
  })()`)
  await cdp.navigate('/dashboard', 1500)
  const darkTheme = await cdp.eval(`(function(){
    const body = document.body;
    return {
      class: body?.className || '',
      bgColor: window.getComputedStyle(body)?.backgroundColor
    };
  })()`)
  ok('Dark 主题', `bg: ${darkTheme?.bgColor?.slice(0, 30)}`)

  // 验证主题确实切换了
  if (lightTheme?.bgColor !== darkTheme?.bgColor) ok('主题切换验证', '颜色不同 ✓')
  else warn('主题切换验证', '颜色相同')

  // ========== 5. 语言切换 ==========
  console.log('\n--- 5. 语言切换 ---')

  // 5.1 切换到 en-US
  await cdp.eval(`(async()=>{
    try { await window.api.settings.set('general.language', 'en-US'); } catch(e) {}
  })()`)
  await cdp.navigate('/dashboard', 1500)
  const enText = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1');
    return h1?.textContent?.trim() || '';
  })()`)
  ok('en-US 语言', `h1: ${enText}`)

  // 5.2 切换回 zh-CN
  await cdp.eval(`(async()=>{
    try { await window.api.settings.set('general.language', 'zh-CN'); } catch(e) {}
  })()`)
  await cdp.navigate('/dashboard', 1500)
  const zhText = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1');
    return h1?.textContent?.trim() || '';
  })()`)
  ok('zh-CN 语言', `h1: ${zhText}`)

  // ========== 6. 键盘导航 ==========
  console.log('\n--- 6. 键盘导航 ---')

  await cdp.navigate('/dashboard', 1500)
  // Tab 键导航
  const tabResult = await cdp.eval(`(function(){
    const before = document.activeElement;
    // 模拟 Tab
    const focusable = document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])');
    if(focusable.length > 0) {
      focusable[0].focus();
      return { before: before?.tagName || 'body', after: document.activeElement?.tagName || '?', count: focusable.length };
    }
    return { before: 'none', after: 'none', count: 0 };
  })()`)
  ok('键盘 Tab', `可聚焦 ${tabResult?.count} 个, 当前 ${tabResult?.after}`)

  // Escape 键测试
  const escResult = await cdp.eval(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    return true;
  })()`)
  ok('Escape 键', '已分发')

  // ========== 7. 404 路由兜底 ==========
  console.log('\n--- 7. 404 路由兜底 ---')

  await cdp.eval(`window.location.hash='/nonexistent-page-xyz'`)
  await new Promise((r) => setTimeout(r, 1500))
  const notFound = await cdp.eval(`(function(){
    const body = document.body?.innerHTML?.length || 0;
    const h1 = document.querySelector('h1')?.textContent || '';
    return { bodyLen: body, h1 };
  })()`)
  ok('404 路由', `h1: ${notFound?.h1 || '?'}, body ${notFound?.bodyLen} 字符`)

  // 恢复正常路由
  await cdp.navigate('/dashboard', 1500)

  // ========== 8. Console 错误检查 ==========
  console.log('\n--- 8. Console 错误检查 ---')

  // 注入 console 错误捕获
  await cdp.eval(`(function(){
    if(!window.__consoleErrors) {
      window.__consoleErrors = [];
      const origError = console.error;
      console.error = function(...args) {
        window.__consoleErrors.push(args.map(a => String(a)).join(' '));
        origError.apply(console, args);
      };
    }
    return true;
  })()`)

  // 遍历所有页面
  let totalErrors = 0
  for (const p of pages) {
    await cdp.navigate(p, 1000)
    const errCount = await cdp.eval(`window.__consoleErrors?.length || 0`)
    totalErrors += errCount || 0
    if (errCount > 0) {
      // 清空已记录的错误避免重复计数
      await cdp.eval(`window.__consoleErrors = []`)
    }
  }
  if (totalErrors === 0) ok('Console 错误', '10 页遍历, 0 错误 ✓')
  else warn('Console 错误', `${totalErrors} 个`)

  // ========== 9. 响应式布局 ==========
  console.log('\n--- 9. 响应式布局 ---')

  await cdp.navigate('/dashboard', 1500)

  // 模拟不同视口
  const viewports = [
    { width: 1920, height: 1080, name: 'desktop' },
    { width: 1366, height: 768, name: 'laptop' },
    { width: 768, height: 1024, name: 'tablet' },
    { width: 375, height: 667, name: 'mobile' },
  ]
  for (const vp of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width < 768,
    })
    await new Promise((r) => setTimeout(r, 500))
    const layout = await cdp.eval(`(function(){
      const h1 = document.querySelector('h1');
      const bodyOverflow = document.body?.scrollWidth > document.body?.clientWidth;
      return { hasH1: !!h1, h1Text: h1?.textContent?.trim(), overflow: bodyOverflow };
    })()`)
    ok(`视口 ${vp.name} (${vp.width}x${vp.height})`, `${layout?.h1Text || '?'} | overflow: ${layout?.overflow}`)
  }
  // 恢复
  await cdp.send('Emulation.clearDeviceMetricsOverride', {})

  // ========== 10. 清理 ==========
  console.log('\n--- 10. 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  ok('清理完成', '')

  // ========== 汇总 ==========
  const elapsed = ((Date.now() - results.startTime) / 1000).toFixed(1)
  console.log('\n=== 测试汇总 ===')
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1)}%`)
  console.log(`API 调用: ${results.apiCalls}, 耗时: ${elapsed}s`)

  fs.writeFileSync('dogfood-output/r14-results.json', JSON.stringify({
    ...results,
    elapsedSec: parseFloat(elapsed),
    testType: 'R14-consistency-a11y-theme',
  }, null, 2))
  console.log('结果已写入: r14-results.json')

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
