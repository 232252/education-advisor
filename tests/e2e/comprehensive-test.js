// =============================================================
// 全面 UI 自动化测试 — Education Advisor
// 真实模拟用户操作：创建班级、添加学生、批量操作、仪表盘、响应式
// 使用 CDP (Chrome DevTools Protocol) 通过 Electron 远程调试通信
//
// 用法:
//   1. xvfb-run -a npm run dev:electron   (在另一终端启动应用, ENABLE_CDP=1)
//   2. node tests/e2e/comprehensive-test.js
//
// 输出: tests/e2e/screenshots/comprehensive-*.png + 测试报告
// =============================================================

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const WebSocket = require('node:ws')

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', 'comprehensive')
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })

// ---------- CDP 客户端 ----------
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
  async eval(expression, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    })
    if (result.exceptionDetails) {
      throw new Error('Eval error: ' + JSON.stringify(result.exceptionDetails))
    }
    return result.result.value
  }
  async screenshot(name) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(SCREENSHOTS_DIR, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
    return file
  }
  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }
  close() {
    this.ws?.close()
  }
}

function listTargets() {
  return new Promise((resolve, reject) => {
    http
      .get('http://localhost:9222/json', (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })
}

async function waitForCDP(maxWaitMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      const targets = await listTargets()
      const page = targets.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('CDP not available after ' + maxWaitMs + 'ms')
}

// ---------- 测试报告 ----------
const testResults = []
function record(testName, pass, details) {
  testResults.push({ test: testName, pass, details, time: new Date().toISOString() })
  const status = pass ? '✅' : '❌'
  console.log(`  ${status} ${testName}${details ? ' — ' + details : ''}`)
}

// ---------- 测试主流程 ----------
async function main() {
  console.log('=== Education Advisor 全面 UI 自动化测试 ===\n')
  console.log('等待 CDP 启动...')
  const target = await waitForCDP(60000)
  console.log('✓ CDP 已连接:', target.url)

  const cdp = new CDPClient(target.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  console.log('✓ Page/Runtime 已启用\n')

  // 等待应用初始化
  await new Promise((r) => setTimeout(r, 3000))
  const startUrl = await cdp.eval('window.location.href')
  console.log('  当前 URL:', startUrl)
  await cdp.screenshot('00-initial')

  // ===== 1. 班级管理测试 =====
  console.log('\n--- 1. 班级管理测试 ---')
  await testClassManagement(cdp)

  // ===== 2. 学生管理测试（创建学生 + 批量操作）=====
  console.log('\n--- 2. 学生管理测试 ---')
  await testStudentManagement(cdp)

  // ===== 3. 仪表盘 + 班级对比测试 =====
  console.log('\n--- 3. 仪表盘 + 班级对比测试 ---')
  await testDashboardClassCompare(cdp)

  // ===== 4. 响应式 / 排行榜越界测试 =====
  console.log('\n--- 4. 响应式 / 排行榜越界测试 ---')
  await testResponsiveness(cdp)

  // ===== 5. 压力测试：快速切换 + 重复操作 =====
  console.log('\n--- 5. 压力测试：快速切换 + 重复操作 ---')
  await testStressNavigation(cdp)

  // ===== 报告 =====
  console.log('\n=== 测试报告 ===')
  const passed = testResults.filter((r) => r.pass).length
  const failed = testResults.filter((r) => !r.pass).length
  console.log(`通过: ${passed} / 失败: ${failed} / 总计: ${testResults.length}`)

  const reportPath = path.join(SCREENSHOTS_DIR, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2))
  console.log(`报告: ${reportPath}`)
  console.log(`截图: ${SCREENSHOTS_DIR}/`)

  cdp.close()
  process.exit(failed > 0 ? 1 : 0)
}

// ---------- 1. 班级管理测试 ----------
async function testClassManagement(cdp) {
  // 导航到 Classes 页面
  await cdp.eval(`window.history.pushState({}, '', '/classes'); window.dispatchEvent(new PopStateEvent('popstate'))`)
  await new Promise((r) => setTimeout(r, 1500))
  await cdp.screenshot('01-classes-page')

  // 读取当前班级数
  const initialCount = await cdp.eval(`
    (() => {
      const rows = document.querySelectorAll('table tbody tr')
      return rows.length
    })()
  `)
  record('班级页面加载', true, `初始班级数: ${initialCount}`)

  // 创建 3 个测试班级（通过 UI 按钮 + 表单）
  const classNames = [
    { id: 'TEST-G7-1', name: '测试七年级一班', grade: '七年级', teacher: '张老师' },
    { id: 'TEST-G7-2', name: '测试七年级二班', grade: '七年级', teacher: '李老师' },
    { id: 'TEST-G8-1', name: '测试八年级一班', grade: '八年级', teacher: '王老师' },
  ]

  for (const cls of classNames) {
    console.log(`  → 创建班级: ${cls.name}`)

    // 点击新建按钮
    await cdp.eval(`(() => {
      const btns = document.querySelectorAll('button')
      for (const b of btns) {
        if (b.textContent.includes('+ 新建') || b.textContent.includes('+ 添加')) {
          b.click()
          return true
        }
      }
      return false
    })()`)
    await new Promise((r) => setTimeout(r, 500))
    await cdp.screenshot(`02-create-class-${cls.id}-form`)

    // 填写表单
    const formFilled = await cdp.eval(`(async () => {
      const inputs = document.querySelectorAll('input')
      let classIdInput = null, nameInput = null
      for (const inp of inputs) {
        const label = inp.previousElementSibling?.textContent || ''
        if (label.includes('班级编号') || label.includes('class_id')) classIdInput = inp
        if (label.includes('班级名称') || label.includes('名称')) nameInput = inp
      }
      if (!classIdInput || !nameInput) {
        // fallback: 用 placeholder 或顺序
        if (inputs.length >= 2) {
          classIdInput = inputs[0]
          nameInput = inputs[1]
        }
      }
      if (!classIdInput || !nameInput) return { ok: false, reason: 'inputs not found', count: inputs.length }
      // 设置值并触发 React onChange
      const setVal = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      setVal(classIdInput, '${cls.id}')
      setVal(nameInput, '${cls.name}')
      // 找 grade 和 teacher（如果有）
      if (inputs.length >= 4) {
        setVal(inputs[2], '${cls.grade}')
        setVal(inputs[3], '${cls.teacher}')
      }
      return { ok: true, classId: '${cls.id}', name: '${cls.name}' }
    })()`)
    record(`填写班级表单 ${cls.id}`, formFilled.ok, formFilled.reason || '')

    // 点击保存按钮
    const saved = await cdp.eval(`(() => {
      const btns = document.querySelectorAll('button')
      for (const b of btns) {
        if (b.textContent.trim() === '保存' || b.textContent.trim() === '确定' || b.textContent.includes('Save')) {
          b.click()
          return true
        }
      }
      return false
    })()`)
    await new Promise((r) => setTimeout(r, 1500))
    record(`保存班级 ${cls.id}`, saved, '')

    await cdp.screenshot(`03-class-${cls.id}-saved`)
  }

  // 验证班级数
  const newCount = await cdp.eval(`document.querySelectorAll('table tbody tr').length`)
  record('3 个班级创建完成', newCount >= initialCount + 3, `当前 ${newCount} 个班级 (初始 ${initialCount})`)

  // 点击一个班级查看详情
  await cdp.eval(`(() => {
    const rows = document.querySelectorAll('table tbody tr')
    if (rows.length > 0) rows[0].click()
  })()`)
  await new Promise((r) => setTimeout(r, 1000))
  await cdp.screenshot('04-class-detail')
  const hasDetail = await cdp.eval(`document.body.textContent.includes('学生数') || document.body.textContent.includes('学生')`)
  record('班级详情面板打开', hasDetail, '')
}

// ---------- 2. 学生管理测试 ----------
async function testStudentManagement(cdp) {
  // 导航到 Students 页面
  await cdp.eval(`window.history.pushState({}, '', '/students'); window.dispatchEvent(new PopStateEvent('popstate'))`)
  await new Promise((r) => setTimeout(r, 2000))
  await cdp.screenshot('05-students-page')

  // 验证班级筛选下拉存在
  const hasClassFilter = await cdp.eval(`(() => {
    const selects = document.querySelectorAll('select')
    for (const s of selects) {
      if (s.title?.includes('班级') || s.options?.length > 2) {
        const opts = Array.from(s.options).map((o) => o.text)
        if (opts.some((o) => o.includes('全部班级') || o.includes('未分班'))) {
          return { ok: true, options: opts }
        }
      }
    }
    return { ok: false }
  })()`)
  record('班级筛选下拉存在', hasClassFilter.ok, hasClassFilter.options ? `选项: ${hasClassFilter.options.join(' | ')}` : '未找到')

  // 添加测试学生（20+ 个）
  console.log('  → 添加 20 个测试学生...')
  for (let i = 1; i <= 20; i++) {
    const name = `测试学生${i.toString().padStart(2, '0')}`
    // 点 +添加
    await cdp.eval(`(() => {
      const btns = document.querySelectorAll('button')
      for (const b of btns) {
        if (b.textContent.trim().includes('+ 添加')) {
          b.click()
          return true
        }
      }
      return false
    })()`)
    await new Promise((r) => setTimeout(r, 200))
    // 输入名字
    await cdp.eval(`(() => {
      const inputs = document.querySelectorAll('input[type="text"]')
      if (inputs.length > 0) {
        const last = inputs[inputs.length - 1]
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(last, '${name}')
        last.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })()`)
    // 点击确定
    await cdp.eval(`(() => {
      const btns = document.querySelectorAll('button')
      for (const b of btns) {
        if (b.textContent.trim() === '确定' || b.textContent.trim() === '添加') {
          b.click()
          return true
        }
      }
      return false
    })()`)
    await new Promise((r) => setTimeout(r, 300))
  }
  await new Promise((r) => setTimeout(r, 1000))
  await cdp.screenshot('06-students-added')

  // 验证学生数
  const studentCountText = await cdp.eval(`
    (() => {
      const headers = document.querySelectorAll('h1')
      for (const h of headers) {
        const m = h.textContent.match(/学生管理\s*\\((\\d+)\\)/)
        if (m) return m[1]
      }
      return '0'
    })()
  `)
  record('20 个学生添加完成', parseInt(studentCountText) >= 20, `当前学生数: ${studentCountText}`)

  // 测试班级筛选
  console.log('  → 测试班级筛选...')
  const filterResult = await cdp.eval(`(() => {
    const selects = document.querySelectorAll('select')
    for (const s of selects) {
      const opts = Array.from(s.options)
      if (opts.some((o) => o.text.includes('测试七年级一班'))) {
        // 选择 TEST-G7-1
        const opt = opts.find((o) => o.text.includes('测试七年级一班'))
        if (opt) {
          s.value = opt.value
          s.dispatchEvent(new Event('change', { bubbles: true }))
          return { ok: true, value: opt.value }
        }
      }
    }
    return { ok: false }
  })()`)
  await new Promise((r) => setTimeout(r, 800))
  record('按班级筛选', filterResult.ok, filterResult.value ? `筛到 ${filterResult.value}` : '未找到班级选项')
  await cdp.screenshot('07-class-filter-applied')

  // 测试批量选择
  console.log('  → 测试批量选择模式...')
  await cdp.eval(`(() => {
    const btns = document.querySelectorAll('button')
    for (const b of btns) {
      if (b.textContent.includes('☑') || b.textContent.includes('选择')) {
        b.click()
        return true
      }
    }
    return false
  })()`)
  await new Promise((r) => setTimeout(r, 500))
  // 全选
  await cdp.eval(`(() => {
    const checks = document.querySelectorAll('input[type="checkbox"]')
    if (checks.length > 0) {
      checks[0].click()  // 通常第一个是"全选"
      return checks.length
    }
    return 0
  })()`)
  await new Promise((r) => setTimeout(r, 500))
  await cdp.screenshot('08-batch-select-mode')

  const selectedCount = await cdp.eval(`document.querySelectorAll('input[type="checkbox"]:checked').length`)
  record('批量选择模式', selectedCount > 1, `选中 ${selectedCount} 个`)

  // 取消批量模式
  await cdp.eval(`(() => {
    const btns = document.querySelectorAll('button')
    for (const b of btns) {
      if (b.textContent.includes('取消') || b.textContent.includes('退出')) {
        b.click()
        return true
      }
    }
    return false
  })()`)
  await new Promise((r) => setTimeout(r, 500))
}

// ---------- 3. 仪表盘 + 班级对比测试 ----------
async function testDashboardClassCompare(cdp) {
  // 导航到 Dashboard
  await cdp.eval(`window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'))`)
  await new Promise((r) => setTimeout(r, 3000))
  await cdp.screenshot('09-dashboard')

  // 检查班级对比按钮
  const compareBtnExists = await cdp.eval(`(() => {
    const btns = document.querySelectorAll('button')
    for (const b of btns) {
      if (b.textContent.includes('班级对比')) return true
    }
    return false
  })()`)
  record('班级对比按钮存在', compareBtnExists, '')

  // 点击班级对比
  await cdp.eval(`(() => {
    const btns = document.querySelectorAll('button')
    for (const b of btns) {
      if (b.textContent.includes('班级对比')) {
        b.click()
        return true
      }
    }
    return false
  })()`)
  await new Promise((r) => setTimeout(r, 1000))
  await cdp.screenshot('10-dashboard-compare-mode')

  // 验证对比表格
  const compareTable = await cdp.eval(`(() => {
    const headers = document.querySelectorAll('h3, h4, h5')
    for (const h of headers) {
      if (h.textContent.includes('班级对比') || h.textContent.includes('对比总览')) return true
    }
    return false
  })()`)
  record('班级对比模式显示', compareTable, '')

  // 双班级详细对比
  const dualCompare = await cdp.eval(`(() => {
    const selects = document.querySelectorAll('select')
    let a = null, b = null
    for (const s of selects) {
      const opts = Array.from(s.options)
      if (opts.some((o) => o.text.includes('选择班级 A'))) a = s
      if (opts.some((o) => o.text.includes('选择班级 B'))) b = s
    }
    if (!a || !b) return { ok: false, reason: 'A/B selects not found' }
    // 选第一个班级作为 A
    const optA = Array.from(a.options).find((o) => o.value)
    const optB = Array.from(b.options).filter((o) => o.value)[1]  // 不同班级
    if (!optA || !optB) return { ok: false, reason: 'no options' }
    a.value = optA.value
    a.dispatchEvent(new Event('change', { bubbles: true }))
    b.value = optB.value
    b.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, a: optA.value, b: optB.value }
  })()`)
  record('双班级详细对比选择', dualCompare.ok, dualCompare.value ? `A=${dualCompare.a} B=${dualCompare.b}` : dualCompare.reason)
  await new Promise((r) => setTimeout(r, 1000))
  await cdp.screenshot('11-dashboard-dual-compare')

  // 关闭对比模式
  await cdp.eval(`(() => {
    const btns = document.querySelectorAll('button')
    for (const b of btns) {
      if (b.textContent.includes('班级对比')) {
        b.click()
        return true
      }
    }
    return false
  })()`)
  await new Promise((r) => setTimeout(r, 500))
}

// ---------- 4. 响应式 / 排行榜越界测试 ----------
async function testResponsiveness(cdp) {
  // 测试多个窗口尺寸
  const viewports = [
    { w: 1920, h: 1080, name: 'desktop' },
    { w: 1366, h: 768, name: 'laptop' },
    { w: 1024, h: 768, name: 'tablet-landscape' },
    { w: 800, h: 600, name: 'narrow' },
    { w: 600, h: 800, name: 'mobile-portrait' },
  ]

  for (const vp of viewports) {
    await cdp.setViewport(vp.w, vp.h)
    await new Promise((r) => setTimeout(r, 800))
    // 强制重新渲染
    await cdp.eval(`window.dispatchEvent(new Event('resize'))`)
    await new Promise((r) => setTimeout(r, 500))
    await cdp.screenshot(`12-responsive-${vp.name}-${vp.w}x${vp.h}`)

    // 检查排行榜 / 周期摘要是否有横向溢出
    const overflow = await cdp.eval(`(() => {
      const cards = document.querySelectorAll('div[class*="rounded-2xl"]')
      const bodyW = document.body.clientWidth
      const offenders = []
      for (const c of cards) {
        const rect = c.getBoundingClientRect()
        if (rect.right > bodyW + 2 || rect.width > bodyW + 2) {
          const text = c.textContent.slice(0, 30)
          offenders.push({ text, w: rect.width, right: rect.right, bodyW })
        }
      }
      return { ok: offenders.length === 0, offenders, bodyW }
    })()`)
    record(`响应式 ${vp.name} (${vp.w}x${vp.h})`, overflow.ok, overflow.ok ? '' : `发现 ${overflow.offenders.length} 个溢出: ${JSON.stringify(overflow.offenders.slice(0, 2))}`)
  }

  // 恢复默认尺寸
  await cdp.setViewport(1280, 800)
  await new Promise((r) => setTimeout(r, 500))
}

// ---------- 5. 压力测试：快速切换 + 重复操作 ----------
async function testStressNavigation(cdp) {
  const routes = ['/students', '/classes', '/', '/students', '/classes', '/']
  const errors = []

  for (let i = 0; i < 6; i++) {
    try {
      await cdp.eval(`window.history.pushState({}, '', '${routes[i]}'); window.dispatchEvent(new PopStateEvent('popstate'))`)
      await new Promise((r) => setTimeout(r, 600))
      // 快速操作：点击刷新按钮
      await cdp.eval(`(() => {
        const btns = document.querySelectorAll('button')
        for (const b of btns) {
          if (b.textContent.includes('刷新') || b.textContent.includes('🔄')) {
            b.click()
            return true
          }
        }
        return false
      })()`)
      await new Promise((r) => setTimeout(r, 200))
    } catch (e) {
      errors.push(`第 ${i + 1} 次切换失败: ${e.message}`)
    }
  }

  record('压力测试 6 次快速切换', errors.length === 0, errors.length ? errors.join('; ') : '全部成功')
  await cdp.screenshot('13-stress-test-final')
}

main().catch((err) => {
  console.error('Test runner failed:', err)
  process.exit(1)
})
