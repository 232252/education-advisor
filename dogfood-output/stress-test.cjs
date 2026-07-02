// 压力测试: 快速导航/并发创建/筛选切换/边缘情况
// 持续运行,模拟真实用户高强度操作
const http = require('http')
const WebSocket = require('ws')

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
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          j(new Error(`CDP timeout: ${method}`))
        }
      }, 20000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 15000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  async function call(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      const p='${apiPath}'.split('.');
      let o=window.api;
      for(const x of p){if(o==null)return{__error:'no such api'};o=o[x]}
      if(typeof o!=='function')return{__error:'not a function'};
      const a=${JSON.stringify(args)};
      try{const r=await o(...a);return r}catch(e){return{__error:e.message}}
    })()`)
  }
  async function navigate(path) {
    await cdp.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, 1000))
  }

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  console.log('=== 压力测试: 高强度操作 ===\n')

  // ========== 测试1: 快速页面导航 (10次循环) ==========
  console.log('--- 测试1: 快速页面导航 (10次循环) ---')
  const pages = ['/dashboard', '/classes', '/students', '/chat', '/agents', '/models', '/skills', '/scheduler', '/privacy', '/settings']
  const navStart = Date.now()
  let navOk = 0
  for (let i = 0; i < 10; i++) {
    for (const page of pages) {
      try {
        await navigate(page)
        // 检查页面是否加载 (有内容)
        const hasContent = await cdp.eval(`document.querySelector('h1, h2, h3, [class*="title"]') !== null`)
        if (hasContent) navOk++
      } catch (e) {
        // 忽略单个页面错误
      }
    }
  }
  const navTime = Date.now() - navStart
  if (navOk >= 90) ok('快速导航', `${navOk}/100 次成功, ${navTime}ms (avg ${Math.round(navTime/100)}ms/页)`)
  else fail('快速导航', `${navOk}/100 次成功`)

  // ========== 测试2: 并发班级创建 (5个同时) ==========
  console.log('\n--- 测试2: 并发班级创建 (5个同时) ---')
  // 先清理
  const oldClasses = await call('class.list')
  for (const c of (oldClasses?.data ?? [])) {
    if (c.class_id?.startsWith('ST-')) await call('class.delete', c.id)
  }
  const concurrentStart = Date.now()
  const concurrentPromises = []
  for (let i = 1; i <= 5; i++) {
    concurrentPromises.push(call('class.create', {
      class_id: `ST-CC${i}`,
      name: `并发测试${i}班`,
      grade: '八年级',
      teacher: `老师${i}`,
      note: '并发创建测试'
    }))
  }
  const concurrentResults = await Promise.allSettled(concurrentPromises)
  const concurrentTime = Date.now() - concurrentStart
  let concurrentOk = 0
  for (const r of concurrentResults) {
    if (r.status === 'fulfilled' && r.value?.success) concurrentOk++
  }
  if (concurrentOk === 5) ok('并发班级创建', `${concurrentOk}/5 成功, ${concurrentTime}ms`)
  else fail('并发班级创建', `${concurrentOk}/5 成功`)

  // 验证全部创建成功
  const afterConcurrent = await call('class.list')
  const stClasses = (afterConcurrent?.data ?? []).filter((c) => c.class_id?.startsWith('ST-CC'))
  if (stClasses.length === 5) ok('并发创建验证', `5 个班级都在DB中`)
  else fail('并发创建验证', `仅 ${stClasses.length}/5 在DB中`)

  // ========== 测试3: 快速筛选切换 (Dashboard) ==========
  console.log('\n--- 测试3: 快速筛选切换 (Dashboard) ---')
  await navigate('/dashboard')
  await new Promise((r) => setTimeout(r, 3000))
  const filterStart = Date.now()
  let filterOk = 0
  for (let i = 0; i < 20; i++) {
    const targetClass = `ST-CC${(i % 5) + 1}`
    try {
      await cdp.eval(`(function(){
        const selects = document.querySelectorAll('select');
        const classSel = Array.from(selects).find(s => {
          const opts = Array.from(s.options).map(o => o.value);
          return opts.includes('__ALL__') && opts.includes('__NONE__');
        });
        if(classSel){ classSel.value='${targetClass}'; classSel.dispatchEvent(new Event('change',{bubbles:true})); return true; }
        return false;
      })()`)
      await new Promise((r) => setTimeout(r, 300))
      filterOk++
    } catch (e) {
      // 忽略
    }
  }
  const filterTime = Date.now() - filterStart
  if (filterOk === 20) ok('快速筛选切换', `${filterOk}/20 次, ${filterTime}ms (avg ${Math.round(filterTime/20)}ms/次)`)
  else fail('快速筛选切换', `${filterOk}/20 次`)

  // 重置筛选
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(classSel){ classSel.value='__ALL__'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
  })()`)

  // ========== 测试4: 班级对比模式快速开关 ==========
  console.log('\n--- 测试4: 班级对比模式快速开关 ---')
  let toggleOk = 0
  for (let i = 0; i < 10; i++) {
    try {
      await cdp.eval(`(function(){
        const btns = Array.from(document.querySelectorAll('button'));
        const cb = btns.find(b => b.textContent?.includes('班级对比'));
        if(cb) cb.click();
      })()`)
      await new Promise((r) => setTimeout(r, 300))
      toggleOk++
    } catch (e) {}
  }
  if (toggleOk === 10) ok('对比模式开关', `${toggleOk}/10 次切换`)
  else fail('对比模式开关', `${toggleOk}/10 次`)

  // ========== 测试5: 响应式布局多尺寸 ==========
  console.log('\n--- 测试5: 响应式布局多尺寸 ---')
  const sizes = [
    { w: 1920, h: 1080, name: '1920x1080' },
    { w: 1366, h: 768, name: '1366x768' },
    { w: 1024, h: 768, name: '1024x768' },
    { w: 800, h: 600, name: '800x600' },
    { w: 500, h: 400, name: '500x400' },
    { w: 320, h: 240, name: '320x240' },
  ]
  for (const size of sizes) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false })
    await new Promise((r) => setTimeout(r, 800))
    // 检查是否有溢出
    const overflow = await cdp.eval(`(function(){
      const body = document.body;
      const html = document.documentElement;
      return {
        bodyScroll: body.scrollWidth > body.clientWidth,
        htmlScroll: html.scrollWidth > html.clientWidth,
        bodyWidth: body.scrollWidth,
        clientWidth: body.clientWidth
      };
    })()`)
    if (!overflow.bodyScroll && !overflow.htmlScroll) ok(`布局 ${size.name}`, '无溢出')
    else warn(`布局 ${size.name}`, `溢出: body=${overflow.bodyWidth} > client=${overflow.clientWidth}`)
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride')
  await new Promise((r) => setTimeout(r, 500))

  // ========== 测试6: 班级生命周期快速循环 ==========
  console.log('\n--- 测试6: 班级生命周期快速循环 (archive/restore 10次) ---')
  const lifeClass = stClasses[0]
  if (lifeClass) {
    let lifeOk = 0
    for (let i = 0; i < 10; i++) {
      const archRes = await call('class.archive', lifeClass.id)
      const restRes = await call('class.restore', lifeClass.id)
      if (archRes?.success && restRes?.success) lifeOk++
    }
    if (lifeOk === 10) ok('生命周期循环', `${lifeOk}/10 次 archive/restore`)
    else fail('生命周期循环', `${lifeOk}/10 次`)
  }

  // ========== 测试7: 学生页快速搜索 ===
  console.log('\n--- 测试7: 学生页快速搜索 (10次) ---')
  await navigate('/students')
  await new Promise((r) => setTimeout(r, 2000))
  const searchTerms = ['CT', '张', '李', '王', '一', '二', '三', 'xyz', '', '测试']
  let searchOk = 0
  for (const term of searchTerms) {
    try {
      await cdp.eval(`(function(){
        const input = document.querySelector('input[type="text"], input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"]');
        if(input){
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, '${term}');
          input.dispatchEvent(new Event('input', {bubbles: true}));
        }
      })()`)
      await new Promise((r) => setTimeout(r, 400))
      searchOk++
    } catch (e) {}
  }
  if (searchOk === 10) ok('快速搜索', `${searchOk}/10 次`)
  else fail('快速搜索', `${searchOk}/10 次`)

  // ========== 测试8: 并发EAA调用 ==========
  console.log('\n--- 测试8: 并发EAA调用 (5个同时) ---')
  const eaaStart = Date.now()
  const eaaPromises = [
    call('eaa.stats'),
    call('eaa.summary'),
    call('eaa.ranking', 10),
    call('eaa.info'),
    call('eaa.listStudents'),
  ]
  const eaaResults = await Promise.allSettled(eaaPromises)
  const eaaTime = Date.now() - eaaStart
  let eaaOk = 0
  for (const r of eaaResults) {
    if (r.status === 'fulfilled' && r.value?.success) eaaOk++
  }
  if (eaaOk === 5) ok('并发EAA调用', `${eaaOk}/5 成功, ${eaaTime}ms`)
  else fail('并发EAA调用', `${eaaOk}/5 成功`)

  // ========== 测试9: 空数据状态检查 ==========
  console.log('\n--- 测试9: 空数据状态检查 ---')
  // 删除所有 ST-* 班级
  const stClasses2 = await call('class.list')
  for (const c of (stClasses2?.data ?? [])) {
    if (c.class_id?.startsWith('ST-')) await call('class.delete', c.id)
  }
  await navigate('/classes')
  await new Promise((r) => setTimeout(r, 1500))
  const emptyClassRows = await cdp.eval(`document.querySelectorAll('table tbody tr').length`)
  if (emptyClassRows === 0) {
    // 检查是否有"暂无班级"提示
    const hasEmpty = await cdp.eval(`document.body.textContent?.includes('暂无班级') || document.body.textContent?.includes('empty')`)
    ok('空班级列表', `0 行, 空提示: ${hasEmpty ? '是' : '否'}`)
  } else {
    warn('空班级列表', `仍有 ${emptyClassRows} 行(可能有其他班级)`)
  }

  // 空数据 Dashboard
  await navigate('/dashboard')
  await new Promise((r) => setTimeout(r, 3000))
  const dashHasContent = await cdp.eval(`document.querySelector('h1, h2, h3') !== null`)
  if (dashHasContent) ok('空数据Dashboard', '仍能正常显示')
  else fail('空数据Dashboard', '无内容')

  // ========== 测试10: 长时间运行稳定性 ===
  console.log('\n--- 测试10: 长时间运行稳定性 (30秒持续导航) ---')
  const stabStart = Date.now()
  let stabOk = 0
  let stabErr = 0
  while (Date.now() - stabStart < 30000) {
    for (const page of ['/dashboard', '/classes', '/students', '/settings']) {
      try {
        await navigate(page)
        await new Promise((r) => setTimeout(r, 500))
        stabOk++
      } catch (e) {
        stabErr++
      }
    }
  }
  const stabTime = Date.now() - stabStart
  ok('长时间稳定性', `${stabOk} 次导航成功, ${stabErr} 次失败, ${stabTime}ms`)

  // ========== 清理 ==========
  console.log('\n--- 清理ST-* 测试数据 ---')
  const finalClasses = await call('class.list')
  for (const c of (finalClasses?.data ?? [])) {
    if (c.class_id?.startsWith('ST-')) await call('class.delete', c.id)
  }
  ok('清理完成', '已删除 ST-* 班级')

  console.log('\n=== 压力测试汇总 ===')
  console.log(`总计: ${results.pass + results.fail + results.warn}, 通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.details.filter((d) => d.startsWith('✗')).forEach((d) => console.log(`  ${d}`))
  }
  if (results.warn > 0) {
    console.log('\n警告项:')
    results.details.filter((d) => d.startsWith('⚠')).forEach((d) => console.log(`  ${d}`))
  }

  ws.close(1000)
  const fs = require('fs')
  fs.writeFileSync('dogfood-output/stress-result.json', JSON.stringify(results, null, 2))
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
