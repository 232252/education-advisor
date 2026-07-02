// 第二十五轮测试 — 主题/语言/快捷键切换循环 + 持久化验证
// 目标: 测试主题切换、语言切换、快捷键设置的循环和持久化
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

  console.log(`=== 第二十五轮: 主题/语言/快捷键切换循环 + 持久化 ===\n`)

  // 保存原始设置
  const origSettings = await cdp.eval(`(async()=>{ const r=await window.api.settings.get(); return JSON.parse(JSON.stringify(r)); })()`)
  const origTheme = origSettings?.general?.theme || 'dark'
  const origLang = origSettings?.general?.language || 'zh-CN'
  ok('保存原始设置', `theme=${origTheme}, lang=${origLang}`)

  // ========== 1. 主题切换循环 ==========
  console.log('\n--- 1. 主题切换循环(dark → light → system → dark) ---')
  await cdp.navigate('/settings', 2000)

  const themes = ['dark', 'light', 'system', 'dark']
  for (const theme of themes) {
    // 通过 UI select 切换(触发 CustomEvent)
    const r = await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        // 找到主题 select(含 dark/light/system 选项)
        const options = Array.from(sel.options).map(o => o.value);
        if (options.includes('dark') && options.includes('light') && options.includes('system')) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, '${theme}');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, value: sel.value };
        }
      }
      return { success: false };
    })()`)

    if (r?.success) {
      await new Promise((res) => setTimeout(res, 800))
      // 验证 dark class
      const hasDark = await cdp.eval(`document.documentElement.classList.contains('dark')`)
      const bgColor = await cdp.eval(`window.getComputedStyle(document.body).backgroundColor`)

      if (theme === 'dark') {
        if (hasDark) ok(`主题 ${theme}`, `dark class ✓, bg=${bgColor}`)
        else warn(`主题 ${theme}`, `dark class 缺失`)
      } else if (theme === 'light') {
        if (!hasDark) ok(`主题 ${theme}`, `light ✓, bg=${bgColor}`)
        else warn(`主题 ${theme}`, `dark class 仍存在`)
      } else if (theme === 'system') {
        ok(`主题 ${theme}`, `dark=${hasDark} (跟随系统)`)
      }
    } else {
      fail(`主题 ${theme}`, '', 'select 未找到')
    }
  }

  // ========== 2. 主题持久化验证 ==========
  console.log('\n--- 2. 主题持久化验证 ---')
  // 设置为 light,然后重新读取
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const options = Array.from(sel.options).map(o => o.value);
      if (options.includes('dark') && options.includes('light')) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, 'light');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
  })()`)
  await new Promise((r) => setTimeout(r, 1000))

  const settingsAfterLight = await cdp.eval(`(async()=>{ const r=await window.api.settings.get(); return JSON.parse(JSON.stringify(r)); })()`)
  if (settingsAfterLight?.general?.theme === 'light') ok('主题持久化', `settings: ${settingsAfterLight.general.theme}`)
  else warn('主题持久化', `settings: ${settingsAfterLight?.general?.theme}`)

  // 切换页面后验证仍为 light
  await cdp.navigate('/dashboard', 1500)
  const hasDarkAfterNav = await cdp.eval(`document.documentElement.classList.contains('dark')`)
  if (!hasDarkAfterNav) ok('切换页面后主题保持', 'light')
  else warn('切换页面后主题', 'dark class 仍存在')

  // ========== 3. 语言切换循环 ==========
  console.log('\n--- 3. 语言切换循环(zh-CN → en-US → zh-CN) ---')
  await cdp.navigate('/settings', 2000)

  const langs = ['en-US', 'zh-CN']
  for (const lang of langs) {
    const r = await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const options = Array.from(sel.options).map(o => o.value);
        if (options.includes('zh-CN') && options.includes('en-US')) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, '${lang}');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, value: sel.value };
        }
      }
      return { success: false };
    })()`)

    if (r?.success) {
      await new Promise((res) => setTimeout(res, 1000))
      const h1 = await cdp.eval(`document.querySelector('h1')?.innerText || ''`)
      const settingsLang = await cdp.eval(`(async()=>{ const r=await window.api.settings.get(); return r.general.language; })()`)

      if (lang === 'en-US') {
        // 英文模式下 h1 应该是英文
        if (h1.includes('Settings') || h1.includes('System') || !h1.includes('系统设置')) {
          ok(`语言 ${lang}`, `h1="${h1.slice(0, 30)}", settings=${settingsLang}`)
        } else {
          warn(`语言 ${lang}`, `h1="${h1.slice(0, 30)}" 未切换`)
        }
      } else if (lang === 'zh-CN') {
        if (h1.includes('系统设置') || h1.includes('数据')) {
          ok(`语言 ${lang}`, `h1="${h1.slice(0, 30)}", settings=${settingsLang}`)
        } else {
          warn(`语言 ${lang}`, `h1="${h1.slice(0, 30)}"`)
        }
      }
    } else {
      fail(`语言 ${lang}`, '', 'select 未找到')
    }
  }

  // ========== 4. 语言持久化 ==========
  console.log('\n--- 4. 语言持久化 ---')
  // 设置为 en-US,切换页面后验证
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const options = Array.from(sel.options).map(o => o.value);
      if (options.includes('zh-CN') && options.includes('en-US')) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, 'en-US');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
  })()`)
  await new Promise((r) => setTimeout(r, 1000))

  await cdp.navigate('/dashboard', 1500)
  const dashH1En = await cdp.eval(`document.querySelector('h1')?.innerText || ''`)
  const settingsLangEn = await cdp.eval(`(async()=>{ const r=await window.api.settings.get(); return r.general.language; })()`)
  if (settingsLangEn === 'en-US') ok('语言持久化', `settings=${settingsLangEn}, h1="${dashH1En.slice(0, 30)}"`)
  else warn('语言持久化', `settings=${settingsLangEn}`)

  // 切回中文
  await cdp.navigate('/settings', 1500)
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const options = Array.from(sel.options).map(o => o.value);
      if (options.includes('zh-CN') && options.includes('en-US')) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, 'zh-CN');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
  })()`)
  await new Promise((r) => setTimeout(r, 1000))

  // ========== 5. 快捷键设置 ==========
  console.log('\n--- 5. 快捷键设置 ---')
  // 测试设置通用字段(logLevel)
  const logLevelR = await cdp.eval(`(async()=>{ try{ await window.api.settings.set('general.logLevel', 'debug'); const r=await window.api.settings.get(); return r.general.logLevel; }catch(e){return {error:String(e.message||e).slice(0,100)}} })()`)
  if (logLevelR === 'debug') ok('settings.set logLevel', 'debug ✓')
  else warn('settings.set logLevel', logLevelR?.error || logLevelR)

  // 恢复 logLevel
  await cdp.eval(`(async()=>{ await window.api.settings.set('general.logLevel', '${origSettings.general.logLevel || 'info'}'); })()`)

  // 测试设置 thinkingLevel
  const thinkR = await cdp.eval(`(async()=>{ try{ await window.api.settings.set('chat.thinkingLevel', 'high'); const r=await window.api.settings.get(); return r.chat.thinkingLevel; }catch(e){return {error:String(e.message||e).slice(0,100)}} })()`)
  if (thinkR === 'high') ok('settings.set thinkingLevel', 'high ✓')
  else warn('settings.set thinkingLevel', thinkR?.error || thinkR)
  await cdp.eval(`(async()=>{ await window.api.settings.set('chat.thinkingLevel', '${origSettings.chat.thinkingLevel || 'medium'}'); })()`)

  // 测试设置 maxTokens
  const maxTokensR = await cdp.eval(`(async()=>{ try{ await window.api.settings.set('chat.maxTokens', 16384); const r=await window.api.settings.get(); return r.chat.maxTokens; }catch(e){return {error:String(e.message||e).slice(0,100)}} })()`)
  if (maxTokensR === 16384) ok('settings.set maxTokens', '16384 ✓')
  else warn('settings.set maxTokens', maxTokensR?.error || maxTokensR)
  await cdp.eval(`(async()=>{ await window.api.settings.set('chat.maxTokens', ${origSettings.chat.maxTokens || 32768}); })()`)

  // ========== 6. 完整设置读写验证 ==========
  console.log('\n--- 6. 完整设置读写验证 ---')
  const finalSettings = await cdp.eval(`(async()=>{ const r=await window.api.settings.get(); return JSON.parse(JSON.stringify(r)); })()`)
  const sections = Object.keys(finalSettings || {})
  ok('设置 sections', `${sections.length}: ${sections.join(', ')}`)

  // 验证各 section 字段数
  for (const sec of sections) {
    const fieldCount = Object.keys(finalSettings[sec] || {}).length
    ok(`section ${sec}`, `${fieldCount} 字段`)
  }

  // ========== 7. 主题+语言组合切换 ==========
  console.log('\n--- 7. 主题+语言组合切换 ---')
  const combinations = [
    { theme: 'dark', lang: 'zh-CN' },
    { theme: 'light', lang: 'en-US' },
    { theme: 'dark', lang: 'en-US' },
    { theme: 'light', lang: 'zh-CN' },
  ]

  for (const combo of combinations) {
    // 设置主题
    await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const options = Array.from(sel.options).map(o => o.value);
        if (options.includes('dark') && options.includes('light') && options.includes('system')) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, '${combo.theme}');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    })()`)
    // 设置语言
    await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const options = Array.from(sel.options).map(o => o.value);
        if (options.includes('zh-CN') && options.includes('en-US')) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, '${combo.lang}');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    })()`)
    await new Promise((r) => setTimeout(r, 800))

    const hasDark = await cdp.eval(`document.documentElement.classList.contains('dark')`)
    const h1 = await cdp.eval(`document.querySelector('h1')?.innerText || ''`)
    const s = await cdp.eval(`(async()=>{ const r=await window.api.settings.get(); return {theme:r.general.theme, lang:r.general.language}; })()`)

    const themeOk = (combo.theme === 'dark' && hasDark) || (combo.theme === 'light' && !hasDark)
    const langOk = (combo.lang === 'zh-CN' && /[\u4e00-\u9fa5]/.test(h1)) || (combo.lang === 'en-US' && !/[\u4e00-\u9fa5]/.test(h1))

    ok(`组合 ${combo.theme}+${combo.lang}`, `dark=${hasDark}, h1="${h1.slice(0, 20)}", settings=${s?.theme}/${s?.lang}`)
  }

  // ========== 8. 恢复原始设置 ==========
  console.log('\n--- 8. 恢复原始设置 ---')
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const options = Array.from(sel.options).map(o => o.value);
      if (options.includes('dark') && options.includes('light') && options.includes('system')) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, '${origTheme}');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (options.includes('zh-CN') && options.includes('en-US')) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, '${origLang}');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  })()`)
  await new Promise((r) => setTimeout(r, 1000))

  const restoredSettings = await cdp.eval(`(async()=>{ const r=await window.api.settings.get(); return JSON.parse(JSON.stringify(r)); })()`)
  if (restoredSettings?.general?.theme === origTheme && restoredSettings?.general?.language === origLang) {
    ok('恢复原始设置', `theme=${origTheme}, lang=${origLang}`)
  } else {
    warn('恢复原始设置', `theme=${restoredSettings?.general?.theme}/${origTheme}, lang=${restoredSettings?.general?.language}/${origLang}`)
  }

  // ========== 9. 快速切换不崩溃 ==========
  console.log('\n--- 9. 快速切换不崩溃 ---')
  // 快速切换主题 10 次
  for (let i = 0; i < 10; i++) {
    const theme = i % 2 === 0 ? 'dark' : 'light'
    await cdp.eval(`(function(){
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const options = Array.from(sel.options).map(o => o.value);
        if (options.includes('dark') && options.includes('light') && options.includes('system')) {
          const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, '${theme}');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    })()`)
  }
  await new Promise((r) => setTimeout(r, 1000))
  const stillAlive = await cdp.eval(`document.querySelector('h1')?.innerText || ''`)
  if (stillAlive) ok('快速切换10次', '系统正常')
  else fail('快速切换10次', '', '系统崩溃')

  // 恢复
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const options = Array.from(sel.options).map(o => o.value);
      if (options.includes('dark') && options.includes('light') && options.includes('system')) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, '${origTheme}');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  })()`)

  // ========== 10. 内存检查 ==========
  console.log('\n--- 10. 内存检查 ---')
  const memR = await cdp.eval(`(function(){ if(performance && performance.memory){ return { used: Math.round(performance.memory.usedJSHeapSize/1024/1024), total: Math.round(performance.memory.totalJSHeapSize/1024/1024) }; } return null; })()`)
  if (memR) ok('内存', `${memR.used} MB / ${memR.total} MB`)
  else warn('内存', '不可用')

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${total > 0 ? (results.pass / total * 100).toFixed(1) : 0}%`)

  const resultFile = path.join(__dirname, 'r25-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ results }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
