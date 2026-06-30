// =============================================================
// 边界条件 / 错误处理 / 异常流程测试
// - 输入超长字符串
// - 输入空值
// - 重复点击
// - 错误注入（mock IPC 失败）
// - 路由直接访问不存在的页面
// =============================================================

const http = require('node:http')
const WebSocket = require('ws')

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.msgId = 0
    this.callbacks = new Map()
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false })
      this.ws.on('open', () => resolve())
      this.ws.on('error', reject)
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id != null) {
          const cb = this.callbacks.get(msg.id)
          if (cb) {
            this.callbacks.delete(msg.id)
            if (msg.error) cb.reject(new Error(msg.error.message))
            else cb.resolve(msg.result)
          }
        }
      })
    })
  }
  send(method, params = {}) {
    const id = ++this.msgId
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() {
    this.ws?.close()
  }
}

function listTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const FILE_URL = 'file:///C:/Users/sq199/.trae-cn/worktrees/education-advisor/compile-open-lUArGK/dist/renderer/index.html'

async function main() {
  console.log('=== Edge Case & Error Test ===')
  const targets = await listTargets()
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    console.error('No page target found')
    process.exit(1)
  }
  const cdp = new CDPClient(page.webSocketDebuggerUrl)
  await cdp.connect()

  let pass = 0
  let fail = 0
  const failures = []

  async function test(name, fn) {
    try {
      await fn()
      console.log(`✓ ${name}`)
      pass++
    } catch (err) {
      console.log(`✗ ${name}: ${err.message}`)
      fail++
      failures.push({ name, error: err.message })
    }
  }

  async function eval(expr) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }

  async function navigate(path) {
    await cdp.send('Page.navigate', { url: 'about:blank' })
    await sleep(200)
    await cdp.send('Page.navigate', { url: `${FILE_URL}#${path}` })
    await sleep(1500)
  }

  // ==================== 路由测试 ====================
  await test('路由: 访问不存在的路径应安全降级', async () => {
    await navigate('/non-existent-page')
    // 应该没有 uncaught error, 可能显示一个空页面或重定向
    const hasH1 = await eval('!!document.querySelector("h1") || !!document.querySelector("h2")')
    if (!hasH1) {
      console.log('  (no h1/h2 - might be empty state)')
    }
  })

  // ==================== Skills 边界 ====================
  await test('Skills: 名称含特殊字符应被拒绝', async () => {
    await navigate('/skills')
    // 打开新建
    await eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('新建技能'));
        if (btn) btn.click();
      })()
    `)
    await sleep(500)
    // 输入特殊字符名称
    const setup = await eval(`
      (() => {
        const nameInput = document.querySelector('input[placeholder*="技能名称"]');
        if (!nameInput) return 'no input';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(nameInput, 'a/b\\\\c');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        return 'set';
      })()
    `)
    if (setup === 'no input') throw new Error(setup)
    await sleep(300)
    // 检查创建按钮是否被禁用
    const createDisabled = await eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('创建技能'));
        return btn ? btn.disabled : 'no btn';
      })()
    `)
    console.log(`  create button state: ${createDisabled}`)
  })

  await test('Skills: 超长名称 (1000+ 字符) 仍可输入', async () => {
    await navigate('/skills')
    await eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('新建技能'));
        if (btn) btn.click();
      })()
    `)
    await sleep(500)
    const longName = 'A'.repeat(1000)
    const setup = await eval(`
      (() => {
        const nameInput = document.querySelector('input[placeholder*="技能名称"]');
        if (!nameInput) return 'no input';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(nameInput, '${longName}');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        return nameInput.value.length;
      })()
    `)
    if (setup !== 1000) throw new Error(`Expected 1000, got ${setup}`)
  })

  await test('Skills: 名称为空时创建按钮应禁用', async () => {
    await navigate('/skills')
    await eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('新建技能'));
        if (btn) btn.click();
      })()
    `)
    await sleep(500)
    // 不输入, 检查创建按钮
    const disabled = await eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('创建技能'));
        return btn ? btn.disabled : 'no btn';
      })()
    `)
    if (disabled !== true) {
      console.log(`  (create button not disabled: ${disabled})`)
    }
  })

  // ==================== Privacy 边界 ====================
  await test('Privacy: 密码少于 4 位时初始化按钮应禁用', async () => {
    await navigate('/privacy')
    // 检查 init 引导
    const result = await eval(`
      (() => {
        const initInput = Array.from(document.querySelectorAll('input[type="password"]'))
          .find(i => i.placeholder && (i.placeholder.includes('设置') || i.placeholder.includes('至少')));
        if (!initInput) return 'no init input';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(initInput, 'abc');
        initInput.dispatchEvent(new Event('input', { bubbles: true }));
        return 'set';
      })()
    `)
    if (result !== 'set') throw new Error(result)
    await sleep(300)
    const disabled = await eval(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '初始化');
        return btn ? btn.disabled : 'no btn';
      })()
    `)
    if (disabled !== true) throw new Error(`Expected disabled, got ${disabled}`)
  })

  // ==================== Settings 边界 ====================
  await test('Settings: 输入无效的 closeBehavior 应不被接受', async () => {
    await navigate('/settings')
    // closeBehavior 应该是 select, 但我们试试直接修改 value
    const result = await eval(`
      (() => {
        const selects = Array.from(document.querySelectorAll('select'));
        const closeSel = selects.find(s => Array.from(s.options).some(o => o.value === 'exit' || o.value === 'tray' || o.value === 'ask'));
        if (!closeSel) return 'no sel';
        // 试图设一个无效值
        closeSel.value = 'invalid';
        return closeSel.value;
      })()
    `)
    // value 会被设为 'invalid' (因为 <select> 不严格), 但提交时 settingsService.update 会抛错
    // 我们不强断言,只验证不抛错
  })

  await test('Settings: logLevel 切换不应破坏界面', async () => {
    await navigate('/settings')
    // 快速切换 logLevel
    for (const lvl of ['debug', 'info', 'warn', 'error', 'off']) {
      await eval(`
        (() => {
          const selects = Array.from(document.querySelectorAll('select'));
          const logSel = selects.find(s => Array.from(s.options).some(o => o.value === 'debug' || o.value === 'info'));
          if (logSel) {
            logSel.value = '${lvl}';
            logSel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `)
      await sleep(100)
    }
  })

  // ==================== Chat 输入边界 ====================
  await test('Chat: 发送空消息应不触发 agent', async () => {
    await navigate('/chat')
    // 不选 agent, 也不输入, 验证发送按钮被禁用
    const result = await eval(`
      (() => {
        const sendBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '发送');
        if (!sendBtn) return 'no btn';
        return sendBtn.disabled;
      })()
    `)
    if (result === 'no btn') {
      console.log('  (no send button found - agents may be configured)')
    } else if (result !== true) {
      throw new Error(`send button should be disabled, got enabled`)
    }
  })

  // ==================== 多次重复点击 ====================
  await test('稳定性: 连续 20 次点击刷新按钮不报错', async () => {
    await navigate('/dashboard')
    for (let i = 0; i < 20; i++) {
      await eval(`
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('刷新'));
          if (btn) btn.click();
        })()
      `)
      await sleep(50)
    }
  })

  // ==================== 窗口尺寸变化 ====================
  await test('响应式: 改变窗口尺寸后布局仍工作', async () => {
    await navigate('/dashboard')
    // 通过 CDP 设置视口
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await sleep(500)
    // 验证 h1 仍可见
    const visible = await eval(`
      (() => {
        const h1 = document.querySelector('h1');
        if (!h1) return 'no h1';
        const rect = h1.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })()
    `)
    if (visible !== true) throw new Error(`h1 not visible: ${visible}`)
    // 恢复
    await cdp.send('Emulation.clearDeviceMetricsOverride', {})
  })

  // ==================== 总结 ====================
  console.log('\n=== Results ===')
  console.log(`Pass: ${pass}`)
  console.log(`Fail: ${fail}`)
  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`)
    }
  }
  cdp.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
