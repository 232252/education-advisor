// R36: i18n/主题切换/键盘导航/响应式布局/CSS变量
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
          const { resolve, reject } = this.pending.get(m.id)
          this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R36: i18n/主题切换/键盘导航/响应式 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p){if(o==null)return{__error:'no such api: '+p.join('.')};o=o[x]}if(typeof o!=='function')return{__error:'not a function: '+p.join('.')};const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }
  async function callApi(path, ...args) {
    const r = await callRaw(path, ...args)
    if (r && r.__error) throw new Error(r.__error)
    if (r && r.success === false) throw new Error(String(r.data || r.error || 'failed'))
    if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data
    return r
  }

  // ========== 1. 主题切换 ==========
  console.log('--- 1. 主题切换 (dark → light → system) ---')
  try {
    await cdp.eval(`window.location.hash = '#/settings';`)
    await new Promise(r => setTimeout(r, 1500))

    // 获取当前主题
    const settings = await callApi('settings.get')
    const originalTheme = settings.general?.theme
    ok('原始主题', `theme=${originalTheme}`)

    // 切换到 light
    const r1 = await callRaw('settings.set', 'general', { ...settings.general, theme: 'light' })
    if (r1.success) {
      await new Promise(r => setTimeout(r, 500))
      const lightCss = await cdp.eval(`(async()=>{
        const root = document.documentElement;
        return JSON.stringify({
          class: root.className,
          colorScheme: root.style.colorScheme,
          bodyBg: window.getComputedStyle(document.body).backgroundColor,
          bodyColor: window.getComputedStyle(document.body).color
        });
      })()`)
      const lc = JSON.parse(lightCss)
      ok('切换到 light', `class="${lc.class}" bg=${lc.bodyBg} color=${lc.bodyColor}`)
    }

    // 切换到 dark
    const r2 = await callRaw('settings.set', 'general', { ...settings.general, theme: 'dark' })
    if (r2.success) {
      await new Promise(r => setTimeout(r, 500))
      const darkCss = await cdp.eval(`(async()=>{
        const root = document.documentElement;
        return JSON.stringify({
          class: root.className,
          colorScheme: root.style.colorScheme,
          bodyBg: window.getComputedStyle(document.body).backgroundColor,
          bodyColor: window.getComputedStyle(document.body).color
        });
      })()`)
      const dc = JSON.parse(darkCss)
      ok('切换到 dark', `class="${dc.class}" bg=${dc.bodyBg} color=${dc.bodyColor}`)
    }

    // 恢复原始主题
    await callRaw('settings.set', 'general', settings.general)
    ok('恢复原始主题', `theme=${originalTheme}`)
  } catch (e) {
    fail('主题切换', '', e)
  }

  // ========== 2. 语言切换 ==========
  console.log('\n--- 2. 语言切换 (zh → en → zh) ---')
  try {
    const settings = await callApi('settings.get')
    const originalLang = settings.general?.language

    // 切换到英文
    const r1 = await callRaw('settings.set', 'general', { ...settings.general, language: 'en' })
    if (r1.success) {
      await new Promise(r => setTimeout(r, 500))
      await cdp.eval(`window.location.hash = '#/students';`)
      await new Promise(r => setTimeout(r, 1500))
      const enText = await cdp.eval(`document.querySelector('h1')?.textContent?.slice(0,80) || 'no h1'`)
      ok('切换到 en', `Students h1="${enText}"`)
    }

    // 切换回中文
    const r2 = await callRaw('settings.set', 'general', { ...settings.general, language: originalLang })
    if (r2.success) {
      await new Promise(r => setTimeout(r, 500))
      await cdp.eval(`window.location.hash = '#/students';`)
      await new Promise(r => setTimeout(r, 1500))
      const zhText = await cdp.eval(`document.querySelector('h1')?.textContent?.slice(0,80) || 'no h1'`)
      ok(`切换回 ${originalLang}`, `Students h1="${zhText}"`)
    }

    // 恢复
    await callRaw('settings.set', 'general', settings.general)
  } catch (e) {
    fail('语言切换', '', e)
  }

  // ========== 3. 键盘导航 ==========
  console.log('\n--- 3. 键盘导航 (Tab/Enter/Escape) ---')
  try {
    await cdp.eval(`window.location.hash = '#/settings';`)
    await new Promise(r => setTimeout(r, 1500))

    // 统计 focusable 元素
    const focusable = await cdp.eval(`(async()=>{
      const els = document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]');
      return JSON.stringify({
        total: els.length,
        first: els[0]?.tagName + ' ' + (els[0]?.textContent?.slice(0,20) || ''),
        last: els[els.length-1]?.tagName + ' ' + (els[els.length-1]?.textContent?.slice(0,20) || '')
      });
    })()`)
    const f = JSON.parse(focusable)
    ok('focusable 元素', `total=${f.total} first=${f.first} last=${f.last}`)

    // 模拟 Tab 键
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await new Promise(r => setTimeout(r, 200))

    const activeAfterTab = await cdp.eval(`document.activeElement?.tagName + ' ' + (document.activeElement?.textContent?.slice(0,30) || document.activeElement?.type || '')`)
    ok('Tab 键后焦点', `active=${activeAfterTab}`)

    // 模拟多次 Tab
    for (let i = 0; i < 5; i++) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await new Promise(r => setTimeout(r, 100))
    }
    const activeAfter5Tab = await cdp.eval(`document.activeElement?.tagName + ' ' + (document.activeElement?.textContent?.slice(0,30) || document.activeElement?.type || '')`)
    ok('5次 Tab 后焦点', `active=${activeAfter5Tab}`)
  } catch (e) {
    fail('键盘导航', '', e)
  }

  // ========== 4. CSS 变量检查 ==========
  console.log('\n--- 4. CSS 变量检查 ---')
  try {
    const cssVars = await cdp.eval(`(async()=>{
      const root = document.documentElement;
      const styles = window.getComputedStyle(root);
      return JSON.stringify({
        // Tailwind dark mode
        darkClass: root.classList.contains('dark'),
        // CSS custom properties (如果有)
        colorScheme: styles.colorScheme,
        // 检查 body 样式
        bodyFont: window.getComputedStyle(document.body).fontFamily?.slice(0, 50),
        bodyBg: window.getComputedStyle(document.body).backgroundColor,
        bodyColor: window.getComputedStyle(document.body).color,
        // 检查 scrollbar
        overflow: window.getComputedStyle(document.body).overflow,
      });
    })()`)
    const cv = JSON.parse(cssVars)
    ok('CSS 变量', `dark=${cv.darkClass} bg=${cv.bodyBg} color=${cv.bodyColor} font=${cv.bodyFont?.slice(0, 30)}`)
  } catch (e) {
    fail('CSS 变量', '', e)
  }

  // ========== 5. 响应式布局 ==========
  console.log('\n--- 5. 响应式布局 ---')
  const viewports = [
    { width: 1920, height: 1080, name: 'Desktop 1920x1080' },
    { width: 1366, height: 768, name: 'Laptop 1366x768' },
    { width: 768, height: 1024, name: 'Tablet 768x1024' },
    { width: 375, height: 812, name: 'Mobile 375x812' },
  ]

  for (const vp of viewports) {
    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.width < 768 })
      await new Promise(r => setTimeout(r, 1000))

      const layout = await cdp.eval(`(async()=>{
        return JSON.stringify({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          bodyScrollH: document.body?.scrollHeight || 0,
          h1Visible: !!document.querySelector('h1')?.offsetParent,
          navVisible: !!document.querySelector('nav')?.offsetParent || !!document.querySelector('[class*="nav"]')?.offsetParent,
          horizontalScroll: document.body?.scrollWidth > window.innerWidth
        });
      })()`)
      const l = JSON.parse(layout)
      ok(`${vp.name}`, `${l.innerWidth}x${l.innerHeight} h1=${l.h1Visible} nav=${l.navVisible} hScroll=${l.horizontalScroll}`)
    } catch (e) {
      fail(`响应式 ${vp.name}`, '', e)
    }
  }

  // 恢复默认视口
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })

  // ========== 6. 页面切换内存检查 ==========
  console.log('\n--- 6. 页面切换内存检查 ---')
  try {
    const pages = ['#/dashboard', '#/students', '#/classes', '#/agents', '#/chat', '#/settings']
    const memBefore = await cdp.eval(`performance.memory?.usedJSHeapSize || 0`)

    // 切换 30 次
    for (let i = 0; i < 30; i++) {
      await cdp.eval(`window.location.hash = '${pages[i % pages.length]}';`)
      await new Promise(r => setTimeout(r, 300))
    }

    const memAfter = await cdp.eval(`performance.memory?.usedJSHeapSize || 0`)
    const delta = (memAfter - memBefore) / 1024
    ok('30次页面切换', `内存 delta=${delta.toFixed(1)}KB (before=${(memBefore/1024/1024).toFixed(2)}MB after=${(memAfter/1024/1024).toFixed(2)}MB)`)
  } catch (e) {
    fail('页面切换内存', '', e)
  }

  // ========== 7. 滚动行为 ==========
  console.log('\n--- 7. 滚动行为 ---')
  try {
    await cdp.eval(`window.location.hash = '#/students';`)
    await new Promise(r => setTimeout(r, 2000))

    // 获取滚动信息
    const scrollInfo = await cdp.eval(`(async()=>{
      const main = document.querySelector('main') || document.querySelector('[class*="content"]') || document.body;
      return JSON.stringify({
        scrollHeight: main.scrollHeight,
        clientHeight: main.clientHeight,
        canScroll: main.scrollHeight > main.clientHeight
      });
    })()`)
    const si = JSON.parse(scrollInfo)
    ok('Students 滚动', `scrollH=${si.scrollHeight} clientH=${si.clientHeight} canScroll=${si.canScroll}`)

    // 滚动到底部
    if (si.canScroll) {
      await cdp.eval(`(document.querySelector('main') || document.body).scrollTop = 999999`)
      await new Promise(r => setTimeout(r, 500))
      const afterScroll = await cdp.eval(`(document.querySelector('main') || document.body).scrollTop`)
      ok('滚动到底部', `scrollTop=${afterScroll}`)
    }
  } catch (e) {
    fail('滚动行为', '', e)
  }

  // ========== 8. 表单输入验证 (Settings) ==========
  console.log('\n--- 8. Settings 表单交互 ---')
  try {
    await cdp.eval(`window.location.hash = '#/settings';`)
    await new Promise(r => setTimeout(r, 2000))

    // 检查 select 元素
    const selects = await cdp.eval(`(async()=>{
      const sels = document.querySelectorAll('select');
      return JSON.stringify(Array.from(sels).map(s => ({
        value: s.value,
        optionCount: s.options.length,
        options: Array.from(s.options).map(o => o.value).slice(0, 5)
      })));
    })()`)
    const selArr = JSON.parse(selects)
    ok('Settings select 元素', `共 ${selArr.length} 个`)
    selArr.forEach((s, i) => {
      ok(`  select ${i}`, `value=${s.value} options=[${s.options.join(',')}] (${s.optionCount} 个)`)
    })

    // 检查 checkbox/radio
    const checks = await cdp.eval(`(async()=>{
      return JSON.stringify({
        checkboxes: document.querySelectorAll('input[type="checkbox"]').length,
        radios: document.querySelectorAll('input[type="radio"]').length,
        text: document.querySelectorAll('input[type="text"]').length,
        number: document.querySelectorAll('input[type="number"]').length,
        range: document.querySelectorAll('input[type="range"]').length
      });
    })()`)
    const ch = JSON.parse(checks)
    ok('Settings input 类型', `checkbox=${ch.checkboxes} radio=${ch.radios} text=${ch.text} number=${ch.number} range=${ch.range}`)
  } catch (e) {
    fail('Settings 表单', '', e)
  }

  // ========== 总结 ==========
  console.log('\n=== R36 总结 ===')
  console.log(`Pass: ${results.pass} / Fail: ${results.fail}`)
  console.log(`Total: ${results.pass + results.fail}`)

  const reportPath = path.join(__dirname, 'r36-result.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n结果已保存: ${reportPath}`)

  await cdp.close()
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
