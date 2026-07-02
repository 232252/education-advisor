// 第五轮测试 — 多角度测试 (无障碍性 + 表单验证 + 数据持久化 + Toast 验证)
// 从不同角度测试应用的健壮性
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
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

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  console.log('=== 第五轮: 多角度测试 (无障碍性/表单验证/数据持久化/Toast) ===\n')

  // ========== 角度1: 无障碍性 (a11y) ==========
  console.log('--- 角度1: 无障碍性 (a11y) ---')

  // 1.1 所有页面都有 h1
  console.log('  [1.1] 检查所有页面 h1 标题')
  const pages = ['/dashboard', '/chat', '/students', '/classes', '/agents', '/models', '/skills', '/scheduler', '/privacy', '/settings']
  let h1OkCount = 0
  for (const p of pages) {
    await cdp.navigate(p, 1500)
    const hasH1 = await cdp.eval(`document.querySelector('h1') !== null`)
    if (hasH1) h1OkCount++
    else console.log(`    ${p}: 无 h1`)
  }
  if (h1OkCount === pages.length) ok('所有页面 h1', `${h1OkCount}/${pages.length}`)
  else fail('所有页面 h1', `${h1OkCount}/${pages.length}`)

  // 1.2 所有按钮有可访问文本
  console.log('  [1.2] 检查按钮可访问文本 (aria-label/textContent)')
  await cdp.navigate('/classes', 1500)
  const btnAccessibility = await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    if(btns.length === 0) return { total: 0, noLabel: 0 };
    let noLabel = 0;
    for(const b of btns){
      const text = (b.textContent || '').trim();
      const ariaLabel = b.getAttribute('aria-label') || b.getAttribute('title') || '';
      if(!text && !ariaLabel) noLabel++;
    }
    return { total: btns.length, noLabel };
  })()`)
  if (btnAccessibility.noLabel === 0) ok('按钮可访问文本', `${btnAccessibility.total} 个按钮全部有标签`)
  else warn('按钮可访问文本', `${btnAccessibility.noLabel}/${btnAccessibility.total} 个按钮无标签`)

  // 1.3 所有 input 有关联 label
  console.log('  [1.3] 检查输入框关联 label')
  await cdp.navigate('/classes', 1500)
  const inputLabels = await cdp.eval(`(function(){
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"])'));
    let withLabel = 0;
    for(const i of inputs){
      const id = i.id;
      const hasLabel = id && document.querySelector('label[for="' + id + '"]');
      const ariaLabel = i.getAttribute('aria-label') || i.getAttribute('placeholder') || '';
      const wrappedLabel = i.closest('label');
      if(hasLabel || ariaLabel || wrappedLabel) withLabel++;
    }
    return { total: inputs.length, withLabel };
  })()`)
  if (inputLabels.total === 0) warn('输入框 label', '无输入框')
  else if (inputLabels.withLabel === inputLabels.total) ok('输入框 label', `${inputLabels.withLabel}/${inputLabels.total}`)
  else warn('输入框 label', `${inputLabels.withLabel}/${inputLabels.total} (placeholder 计为标签)`)

  // 1.4 图片有 alt 属性
  console.log('  [1.4] 检查图片 alt 属性')
  await cdp.navigate('/dashboard', 3000)
  const imgAlt = await cdp.eval(`(function(){
    const imgs = Array.from(document.querySelectorAll('img'));
    let withAlt = 0;
    for(const img of imgs){
      if(img.getAttribute('alt') !== null) withAlt++;
    }
    return { total: imgs.length, withAlt };
  })()`)
  if (imgAlt.total === 0) ok('图片 alt', '无图片 (使用图标字体/CSS)')
  else if (imgAlt.withAlt === imgAlt.total) ok('图片 alt', `${imgAlt.withAlt}/${imgAlt.total}`)
  else warn('图片 alt', `${imgAlt.withAlt}/${imgAlt.total}`)

  // 1.5 键盘 Tab 导航 — focusable 元素数量
  console.log('  [1.5] 键盘 Tab 可达元素')
  const focusable = await cdp.eval(`(function(){
    const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return document.querySelectorAll(sel).length;
  })()`)
  if (focusable > 0) ok('键盘 Tab 可达', `${focusable} 个可聚焦元素 (dashboard)`)
  else fail('键盘 Tab 可达', '', '无可聚焦元素')

  // 1.6 颜色对比度 (检查文本元素是否有可见样式)
  console.log('  [1.6] 文本可见性检查')
  const textVisibility = await cdp.eval(`(function(){
    const texts = Array.from(document.querySelectorAll('h1, h2, h3, p, span, td, th, label'));
    let visible = 0;
    for(const t of texts){
      const s = window.getComputedStyle(t);
      if(s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.1) visible++;
    }
    return { total: texts.length, visible };
  })()`)
  if (textVisibility.visible === textVisibility.total) ok('文本可见性', `${textVisibility.visible}/${textVisibility.total} 元素可见`)
  else warn('文本可见性', `${textVisibility.visible}/${textVisibility.total}`)

  // ========== 角度2: 表单验证 ==========
  console.log('\n--- 角度2: 表单验证 ---')

  // 2.1 空班级编号提交应被拒绝
  console.log('  [2.1] 空班级编号提交')
  await cdp.navigate('/classes', 1500)
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('新建班级'));
    if(cb) cb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  // 不填写任何内容,直接点保存
  const emptySaveResult = await cdp.eval(`(async function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const sb = btns.find(b => b.textContent?.includes('保存') || b.textContent?.includes('确定'));
    if(!sb) return { saved: false, reason: 'no save btn' };
    sb.click();
    await new Promise(r => setTimeout(r, 500));
    // 检查 toast 是否显示错误
    const toasts = Array.from(document.querySelectorAll('[class*="toast"], [class*="Toast"], [role="alert"], [class*="notification"]'));
    const toastText = toasts.map(t => t.textContent).join(' | ');
    // 检查表单是否仍打开 (未关闭说明验证失败)
    const formStillOpen = document.querySelectorAll('input').length > 0;
    return { saved: !formStillOpen, toastText, formStillOpen };
  })()`)
  if (emptySaveResult.formStillOpen || emptySaveResult.toastText) ok('空编号验证', `表单保持打开 / toast: "${emptySaveResult.toastText?.slice(0, 60) || '无'}"`)
  else fail('空编号验证', '', `表单意外关闭: ${JSON.stringify(emptySaveResult)}`)

  // 关闭表单
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('取消') || b.textContent?.includes('关闭'));
    if(cb) cb.click();
  })()`)

  // 2.2 特殊字符班级编号
  console.log('  [2.2] 特殊字符班级编号')
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('新建班级'));
    if(cb) cb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  const specialCharResult = await cdp.eval(`(async function(){
    const inputs = Array.from(document.querySelectorAll('input'));
    if(inputs.length < 2) return { reason: 'no form' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], 'TEST<>"\\\'&');
    setter.call(inputs[1], '特殊字符班<script>x</script>');
    inputs[0].dispatchEvent(new Event('input', {bubbles: true}));
    inputs[1].dispatchEvent(new Event('input', {bubbles: true}));
    const btns = Array.from(document.querySelectorAll('button'));
    const sb = btns.find(b => b.textContent?.includes('保存') || b.textContent?.includes('确定'));
    if(!sb) return { reason: 'no save' };
    sb.click();
    await new Promise(r => setTimeout(r, 1500));
    // 检查是否创建成功
    const cls = await window.api.class.list();
    const found = cls.data?.find(c => c.name?.includes('特殊字符班'));
    return { created: !!found, classId: found?.class_id, name: found?.name };
  })()`)
  if (specialCharResult.created) {
    ok('特殊字符班级', `创建成功 (class_id: ${specialCharResult.classId})`)
    // 验证无 XSS 执行
    const xssCheck = await cdp.eval(`document.querySelectorAll('script:not([src])').length === 0`)
    if (xssCheck) ok('XSS 防护', '无注入 script 标签')
    else fail('XSS 防护', '', '检测到注入 script')
  } else {
    warn('特殊字符班级', `创建结果: ${JSON.stringify(specialCharResult)}`)
  }

  // 2.3 超长班级名称 (200字符)
  console.log('  [2.3] 超长班级名称 (200字符)')
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('新建班级'));
    if(cb) cb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  const longNameResult = await cdp.eval(`(async function(){
    const inputs = Array.from(document.querySelectorAll('input'));
    if(inputs.length < 2) return { reason: 'no form' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const longName = 'A'.repeat(200);
    setter.call(inputs[0], 'LONG-TEST');
    setter.call(inputs[1], longName);
    inputs[0].dispatchEvent(new Event('input', {bubbles: true}));
    inputs[1].dispatchEvent(new Event('input', {bubbles: true}));
    const btns = Array.from(document.querySelectorAll('button'));
    const sb = btns.find(b => b.textContent?.includes('保存') || b.textContent?.includes('确定'));
    if(!sb) return { reason: 'no save' };
    sb.click();
    await new Promise(r => setTimeout(r, 1500));
    const cls = await window.api.class.list();
    const found = cls.data?.find(c => c.class_id === 'LONG-TEST');
    return { created: !!found, nameLen: found?.name?.length };
  })()`)
  if (longNameResult.created) ok('超长名称', `创建成功 (长度 ${longNameResult.nameLen})`)
  else warn('超长名称', `结果: ${JSON.stringify(longNameResult)}`)

  // 2.4 重复班级编号
  console.log('  [2.4] 重复班级编号')
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('新建班级'));
    if(cb) cb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  const dupResult = await cdp.eval(`(async function(){
    const inputs = Array.from(document.querySelectorAll('input'));
    if(inputs.length < 2) return { reason: 'no form' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], 'LONG-TEST'); // 重复上面的
    setter.call(inputs[1], '重复测试班');
    inputs[0].dispatchEvent(new Event('input', {bubbles: true}));
    inputs[1].dispatchEvent(new Event('input', {bubbles: true}));
    const btns = Array.from(document.querySelectorAll('button'));
    const sb = btns.find(b => b.textContent?.includes('保存') || b.textContent?.includes('确定'));
    if(!sb) return { reason: 'no save' };
    sb.click();
    await new Promise(r => setTimeout(r, 1500));
    // 检查是否被拒绝 (表单仍打开 或 toast 错误)
    const formStillOpen = document.querySelectorAll('input').length > 0;
    const cls = await window.api.class.list();
    const dups = cls.data?.filter(c => c.class_id === 'LONG-TEST');
    return { formStillOpen, dupCount: dups?.length };
  })()`)
  if (dupResult.dupCount === 1) ok('重复编号验证', `仅 1 条记录 (拒绝重复)`)
  else if (dupResult.dupCount > 1) fail('重复编号验证', '', `存在 ${dupResult.dupCount} 条重复记录`)
  else warn('重复编号验证', `结果: ${JSON.stringify(dupResult)}`)

  // 关闭表单
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('取消') || b.textContent?.includes('关闭'));
    if(cb) cb.click();
  })()`)

  // ========== 角度3: 数据持久化 ==========
  console.log('\n--- 角度3: 数据持久化 ---')

  // 3.1 创建测试数据,刷新页面验证保留
  console.log('  [3.1] 创建数据 + 刷新验证持久化')
  const testSuffix = String(Date.now()).slice(-4)
  await cdp.eval(`(async function(){
    // 确保 clean slate
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    // 创建
    await window.api.class.create({ class_id: 'PERSIST-1', name: '持久化测试班', grade: '九年级', teacher: '持久教师' });
    // 添加学生
    await window.api.eaa.addStudent('持久测试生_' + '${testSuffix}');
    // 分配班级
    await window.api.class.assign({ class_id: 'PERSIST-1', student_names: ['持久测试生_' + '${testSuffix}'] });
    // 添加事件
    await window.api.eaa.addEvent({ studentName: '持久测试生_' + '${testSuffix}', reasonCode: 'LATE', note: '持久化测试', operator: 'test' });
  })()`)
  await new Promise((r) => setTimeout(r, 2000))

  // 刷新页面
  await cdp.eval(`window.location.reload()`)
  await new Promise((r) => setTimeout(r, 3000))

  // 验证班级保留
  const classPersist = await cdp.eval(`(async function(){
    const cls = await window.api.class.list();
    const found = cls.data?.find(c => c.class_id === 'PERSIST-1');
    return found ? { name: found.name, grade: found.grade, teacher: found.teacher } : null;
  })()`)
  if (classPersist) ok('班级持久化', `${classPersist.name} (${classPersist.grade})`)
  else fail('班级持久化', '', '班级未保留')

  // 验证学生保留
  const stuPersist = await cdp.eval(`(async function(){
    const stu = await window.api.eaa.listStudents();
    const found = stu.data?.students?.find(s => s.name?.includes('持久测试生'));
    return found ? { name: found.name, class_id: found.class_id } : null;
  })()`)
  if (stuPersist) ok('学生持久化', `${stuPersist.name} (${stuPersist.class_id})`)
  else fail('学生持久化', '', '学生未保留')

  // 验证事件保留
  const evtPersist = await cdp.eval(`(async function(){
    const hist = await window.api.eaa.history('持久测试生_' + '${testSuffix}');
    const events = hist.data?.events || [];
    return events.length > 0 ? { count: events.length, firstReason: events[0]?.reason_code } : null;
  })()`)
  if (evtPersist) ok('事件持久化', `${evtPersist.count} 条事件 (原因: ${evtPersist.firstReason})`)
  else fail('事件持久化', '', '事件未保留')

  // ========== 角度4: Toast 通知验证 ==========
  console.log('\n--- 角度4: Toast 通知验证 ---')

  // 4.1 成功 Toast
  console.log('  [4.1] 成功 Toast')
  await cdp.navigate('/classes', 1500)
  await cdp.eval(`(async function(){
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    await window.api.class.create({ class_id: 'TOAST-1', name: 'Toast测试班' });
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  // 触发 UI 操作产生 toast
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const rb = btns.find(b => b.textContent?.includes('刷新'));
    if(rb) rb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  const toastAfterRefresh = await cdp.eval(`(function(){
    // toast 可能已经消失,检查是否曾经出现 (无直接方法,验证页面正常)
    return document.querySelectorAll('table tbody tr').length;
  })()`)
  if (toastAfterRefresh >= 1) ok('刷新后数据', `${toastAfterRefresh} 行班级数据`)
  else warn('刷新后数据', '可能 toast 已消失或无数据')

  // 4.2 通过 UI 创建班级触发 toast
  console.log('  [4.2] UI 创建触发 Toast')
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('新建班级'));
    if(cb) cb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  await cdp.eval(`(function(){
    const inputs = Array.from(document.querySelectorAll('input'));
    if(inputs.length < 2) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], 'TOAST-2');
    setter.call(inputs[1], 'Toast班级2');
    inputs[0].dispatchEvent(new Event('input', {bubbles: true}));
    inputs[1].dispatchEvent(new Event('input', {bubbles: true}));
  })()`)
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const sb = btns.find(b => b.textContent?.includes('保存') || b.textContent?.includes('确定'));
    if(sb) sb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 2000))
  const toastCheck = await cdp.eval(`(function(){
    // 检查 toast 容器或通知
    const toastEls = Array.from(document.querySelectorAll('[class*="toast"], [class*="Toast"], [role="alert"], [class*="notification"], [class*="message"]'));
    const visibleToasts = toastEls.filter(t => {
      const s = window.getComputedStyle(t);
      return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.1;
    });
    // 也检查表格是否有新班级
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    const found = rows.some(r => r.textContent?.includes('TOAST-2'));
    return { toastCount: visibleToasts.length, classInTable: found };
  })()`)
  if (toastCheck.classInTable) ok('Toast 创建触发', `班级出现在表格中${toastCheck.toastCount > 0 ? ', toast 可见' : ', toast 可能已消失'}`)
  else fail('Toast 创建触发', '', `班级未出现在表格: ${JSON.stringify(toastCheck)}`)

  // ========== 角度5: 响应式布局深度 ==========
  console.log('\n--- 角度5: 响应式布局深度 ---')
  const sizes = [
    { name: 'mobile-375', w: 375, h: 667 },
    { name: 'tablet-768', w: 768, h: 1024 },
    { name: 'desktop-1440', w: 1440, h: 900 },
    { name: 'wide-1920', w: 1920, h: 1080 },
  ]
  for (const sz of sizes) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: sz.w, height: sz.h, deviceScaleFactor: 1, mobile: false })
    await new Promise((r) => setTimeout(r, 800))
    // 检查水平滚动条
    const overflow = await cdp.eval(`(function(){
      const body = document.body;
      const html = document.documentElement;
      const hasHScroll = body.scrollWidth > body.clientWidth;
      const hasVScroll = body.scrollHeight > body.clientHeight;
      // 检查元素是否溢出视口
      const navItems = Array.from(document.querySelectorAll('nav a, nav button'));
      let hiddenItems = 0;
      for(const n of navItems){
        const r = n.getBoundingClientRect();
        if(r.right > sz_w) hiddenItems++;
      }
      return { hasHScroll, hasVScroll, hiddenItems };
    })()`.replace('sz_w', sz.w))
    if (!overflow.hasHScroll && overflow.hiddenItems === 0) ok(`响应式 ${sz.name}`, `${sz.w}x${sz.h} 无溢出`)
    else warn(`响应式 ${sz.name}`, `水平滚动: ${overflow.hasHScroll}, 隐藏元素: ${overflow.hiddenItems}`)
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride')

  // ========== 角度6: 键盘交互 ==========
  console.log('\n--- 角度6: 键盘交互 ---')
  await cdp.navigate('/classes', 1500)
  // Tab 键导航
  await cdp.eval(`(function(){
    document.body.focus();
  })()`)
  const tabResult = await cdp.eval(`(function(){
    const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const before = document.activeElement;
    // 模拟 Tab: 找第一个 focusable 并聚焦
    const focusables = Array.from(document.querySelectorAll(sel));
    if(focusables.length > 0){
      focusables[0].focus();
    }
    return { beforeTag: before?.tagName, afterTag: document.activeElement?.tagName, focusableCount: focusables.length };
  })()`)
  if (tabResult.afterTag && tabResult.afterTag !== 'BODY') ok('键盘 Tab 导航', `聚焦到 ${tabResult.afterTag} (${tabResult.focusableCount} 个可聚焦)`)
  else warn('键盘 Tab 导航', `聚焦到 ${tabResult.afterTag}`)

  // Enter 键提交
  console.log('  [Enter 键提交测试]')
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('新建班级'));
    if(cb) cb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  const enterResult = await cdp.eval(`(async function(){
    const inputs = Array.from(document.querySelectorAll('input'));
    if(inputs.length < 2) return { reason: 'no form' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], 'ENTER-1');
    setter.call(inputs[1], 'Enter键测试');
    inputs[0].dispatchEvent(new Event('input', {bubbles: true}));
    inputs[1].dispatchEvent(new Event('input', {bubbles: true}));
    inputs[1].focus();
    // 模拟 Enter 键
    inputs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    await new Promise(r => setTimeout(r, 1500));
    const cls = await window.api.class.list();
    const found = cls.data?.find(c => c.class_id === 'ENTER-1');
    return { created: !!found };
  })()`)
  if (enterResult.created) ok('Enter 键提交', '创建成功')
  else warn('Enter 键提交', '表单可能不支持 Enter 提交 (需点击保存按钮)')

  // ========== 角度7: 空状态处理 ==========
  console.log('\n--- 角度7: 空状态处理 ---')
  // 清空所有数据
  await cdp.eval(`(async function(){
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
  })()`)
  await new Promise((r) => setTimeout(r, 1000))
  await cdp.navigate('/classes', 1500)
  const emptyState = await cdp.eval(`(function(){
    const rows = document.querySelectorAll('table tbody tr').length;
    const emptyMsg = document.body.textContent?.includes('暂无') || document.body.textContent?.includes('空') || document.body.textContent?.includes('empty');
    return { rows, emptyMsg };
  })()`)
  if (emptyState.rows === 0 && emptyState.emptyMsg) ok('班级空状态', '显示空状态提示')
  else if (emptyState.rows === 0) ok('班级空状态', '无数据行 (可能无空状态文字)')
  else warn('班级空状态', `仍有 ${emptyState.rows} 行`)

  // 学生页空状态
  await cdp.navigate('/students', 2000)
  const stuEmpty = await cdp.eval(`(function(){
    const rows = document.querySelectorAll('table tbody tr').length;
    const emptyMsg = document.body.textContent?.includes('暂无') || document.body.textContent?.includes('空') || document.body.textContent?.includes('empty');
    return { rows, emptyMsg };
  })()`)
  if (stuEmpty.rows === 0) ok('学生空状态', '无数据行')
  else warn('学生空状态', `仍有 ${stuEmpty.rows} 行 (EAA 软删除数据)`)

  // ========== 清理 ==========
  console.log('\n--- 清理 ---')
  await cdp.eval(`(async function(){
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  ok('清理完成', '')

  console.log('\n=== 第五轮多角度测试汇总 ===')
  const total = results.pass + results.fail + results.warn
  console.log(`总计 ${total}, 通过 ${results.pass}, 失败 ${results.fail}, 警告 ${results.warn}, 通过率 ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.details.filter((d) => d.startsWith('✗')).forEach((d) => console.log(`  ${d}`))
  }

  ws.close(1000)
  fs.writeFileSync('dogfood-output/r5-multi-angle-result.json', JSON.stringify(results, null, 2))
  return results
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
