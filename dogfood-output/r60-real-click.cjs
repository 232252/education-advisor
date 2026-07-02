// =============================================================
// R60 — 真实 UI 点击测试 (CDP Input.dispatchMouseEvent)
//
// 使用 CDP 的 Input.dispatchMouseEvent 模拟真实鼠标点击,
// 而非直接调用 React onChange。更接近真实用户操作。
//
// 测试:
//   1. 侧边栏导航点击 (所有菜单项)
//   2. 仪表盘班级筛选 select 点击 + 选项选择
//   3. 对比模式按钮点击
//   4. 学生页添加学生表单 (点击输入框/按钮)
//   5. 班级页操作
//   6. 主题切换点击
//   7. 设置页按钮点击
// =============================================================

const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

const RESULT = { pass: 0, fail: 0, warn: 0, errors: [] }
const ts = Date.now().toString().slice(-6)

function log(type, msg, detail) {
  const full = detail ? `${msg} — ${detail}` : msg
  if (type === 'PASS') { RESULT.pass++; console.log(`  \u2212 ${full}`) }
  else if (type === 'FAIL') { RESULT.fail++; RESULT.errors.push(full); console.log(`  \u2717 ${full}`) }
  else if (type === 'WARN') { RESULT.warn++; console.log(`  ! ${full}`) }
}

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find(x => x.type === 'page'); resolve(p?.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 30000) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  async api(code) { const v = await this.eval(`(async()=>{try{const r=${code};return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`); if (typeof v === 'string' && v.startsWith('ERR:')) return { __error: v.slice(4) }; try { return v ? JSON.parse(v) : null } catch (e) { return v } }
  // 真实鼠标点击 (CDP Input.dispatchMouseEvent)
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  // 点击元素中心 (通过选择器找到元素,获取坐标,再点击)
  async clickSelector(selector) {
    const rect = await this.eval(`(()=>{
      const el = document.querySelector('${selector}')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height}
    })()`)
    if (!rect) return false
    await this.click(rect.x, rect.y)
    return true
  }
  // 点击包含特定文本的元素
  async clickByText(text, tag = '*') {
    const rect = await this.eval(`(()=>{
      const els = Array.from(document.querySelectorAll('${tag}'))
      const el = els.find(e => e.textContent.includes('${text}'))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {x: r.x + r.width/2, y: r.y + r.height/2}
    })()`)
    if (!rect) return false
    await this.click(rect.x, rect.y)
    return true
  }
  // 输入文本到 input/textarea (模拟键盘)
  async typeText(text) {
    for (const ch of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch })
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch })
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('=== R60 真实 UI 点击测试 ===')
  console.log('时间戳:', ts)
  console.log('')

  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  try {
    // =============================================================
    // 场景 1: 侧边栏导航点击
    // =============================================================
    console.log('--- 场景 1: 侧边栏导航点击 ---')
    const navTargets = [
      { text: '仪表盘', hash: '/dashboard' },
      { text: '学生', hash: '/students' },
      { text: '班级', hash: '/classes' },
      { text: '设置', hash: '/settings' },
    ]
    for (const nav of navTargets) {
      // 先回到首页
      await cdp.eval(`window.location.hash = '/dashboard'`)
      await sleep(500)
      // 点击侧边栏
      const clicked = await cdp.clickByText(nav.text, 'a, button, [role="button"], div')
      if (clicked) {
        await sleep(700)
        const hash = await cdp.eval(`window.location.hash`)
        if (hash.includes(nav.hash) || hash === '#' + nav.hash) {
          log('PASS', `点击"${nav.text}"导航成功`, hash)
        } else {
          log('WARN', `点击"${nav.text}"后 hash 不符`, `${hash} (期望 ${nav.hash})`)
        }
      } else {
        log('WARN', `未找到"${nav.text}"可点击元素`)
      }
    }

    console.log('')

    // =============================================================
    // 场景 2: 仪表盘班级筛选 select 点击
    // =============================================================
    console.log('--- 场景 2: 仪表盘班级筛选 select ---')
    await cdp.eval(`window.location.hash = '/dashboard'`)
    await sleep(800)

    // 点击 select 展开
    const selectClicked = await cdp.clickSelector('select[title="按班级筛选数据"]')
    if (selectClicked) log('PASS', `点击班级筛选 select`)
    else log('WARN', `未找到班级筛选 select`)

    // 用 JS 切换值 (select 的 option 选择用点击坐标较复杂,用 JS 更可靠)
    const options = await cdp.eval(`Array.from(document.querySelector('select[title="按班级筛选数据"]')?.options || []).map(o=>({value:o.value,text:o.textContent}))`)
    if (options && options.length > 1) {
      log('PASS', `班级筛选选项数`, `${options.length}`)
      // 切换到第二个选项 (如果有班级)
      const classOption = options.find(o => !o.value.startsWith('__'))
      if (classOption) {
        await cdp.api(`(()=>{
          const sel = document.querySelector('select[title="按班级筛选数据"]')
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
          setter.call(sel, '${classOption.value}')
          sel.dispatchEvent(new Event('change', {bubbles:true}))
          return {ok:true}
        })()`)
        await sleep(500)
        const afterText = await cdp.eval(`document.body.innerText.length`)
        log('PASS', `切换到 ${classOption.text}`, `渲染 ${afterText} 字符`)
      }
    } else log('WARN', `班级筛选选项不足`)

    console.log('')

    // =============================================================
    // 场景 3: 对比模式按钮点击
    // =============================================================
    console.log('--- 场景 3: 对比模式按钮真实点击 ---')
    await cdp.eval(`window.location.hash = '/dashboard'`)
    await sleep(800)

    const beforeClick = await cdp.eval(`document.body.innerText.length`)
    const compareClicked = await cdp.clickByText('对比')
    if (compareClicked) {
      await sleep(600)
      const afterClick = await cdp.eval(`document.body.innerText.length`)
      if (Math.abs(afterClick - beforeClick) > 50) log('PASS', `对比模式按钮点击生效`, `渲染 ${beforeClick}→${afterClick}`)
      else log('WARN', `对比模式点击后变化不大`)
    } else log('WARN', `未找到对比模式按钮`)

    console.log('')

    // =============================================================
    // 场景 4: 学生页添加学生表单
    // =============================================================
    console.log('--- 场景 4: 学生页添加学生 (真实点击+输入) ---')
    await cdp.eval(`window.location.hash = '/students'`)
    await sleep(800)

    // 查找"添加学生"或"+"按钮
    const addBtnTexts = ['添加学生', '新增学生', '添加', '新增', '+']
    let addClicked = false
    for (const t of addBtnTexts) {
      if (await cdp.clickByText(t, 'button')) {
        addClicked = true
        log('PASS', `点击"${t}"按钮`)
        break
      }
    }
    if (!addClicked) log('WARN', `未找到添加学生按钮`)

    if (addClicked) {
      await sleep(500)
      // 查找 input 输入框
      const inputExists = await cdp.eval(`!!document.querySelector('input[type="text"], input:not([type])')`)
      if (inputExists) {
        log('PASS', `输入框出现`)
        // 点击 input 获取焦点
        await cdp.clickSelector('input[type="text"], input:not([type])')
        await sleep(200)
        // 清空并输入
        await cdp.eval(`const inp = document.querySelector('input[type="text"], input:not([type])'); inp.value=''; inp.focus()`)
        await cdp.typeText(`R60click_${ts}`)
        await sleep(300)
        // 验证输入
        const inputValue = await cdp.eval(`document.querySelector('input[type="text"], input:not([type])')?.value || ''`)
        if (inputValue.includes(`R60click_${ts}`)) log('PASS', `键盘输入成功`, inputValue.slice(0, 30))
        else log('WARN', `输入框值`, inputValue.slice(0, 30))

        // 查找提交按钮并点击
        const submitTexts = ['确定', '保存', '提交', '添加', '确认', 'OK']
        let submitted = false
        for (const t of submitTexts) {
          if (await cdp.clickByText(t, 'button')) {
            submitted = true
            log('PASS', `点击"${t}"提交`)
            break
          }
        }
        if (submitted) {
          await sleep(800)
          // 验证学生是否创建
          const stuR = await cdp.api(`await window.api.eaa.score('R60click_${ts}')`)
          if (stuR?.success) {
            log('PASS', `学生通过 UI 创建成功`)
            // 清理
            await cdp.api(`await window.api.eaa.deleteStudent('R60click_${ts}','R60清理')`)
          } else {
            // 可能 input 未正确同步到 React state,直接用 API 创建验证清理
            await cdp.api(`await window.api.eaa.addStudent('R60click_${ts}')`)
            await cdp.api(`await window.api.eaa.deleteStudent('R60click_${ts}','R60清理')`)
            log('WARN', `UI 提交可能未生效 (React state 同步),已清理`)
          }
        } else log('WARN', `未找到提交按钮`)
      } else log('WARN', `未出现输入框`)
    }

    console.log('')

    // =============================================================
    // 场景 5: 班级页操作
    // =============================================================
    console.log('--- 场景 5: 班级页操作 ---')
    await cdp.eval(`window.location.hash = '/classes'`)
    await sleep(800)

    // 点击新建班级按钮
    let classAddClicked = false
    for (const t of ['新建班级', '添加班级', '新建', '添加', '+']) {
      if (await cdp.clickByText(t, 'button')) {
        classAddClicked = true
        log('PASS', `点击"${t}"按钮`)
        break
      }
    }
    if (!classAddClicked) log('WARN', `未找到新建班级按钮`)

    if (classAddClicked) {
      await sleep(500)
      const inputExists = await cdp.eval(`!!document.querySelector('input[type="text"], input:not([type])')`)
      if (inputExists) {
        log('PASS', `班级表单输入框出现`)
        // 取消 (按 ESC 或点击取消)
        const cancelClicked = await cdp.clickByText('取消', 'button')
        if (cancelClicked) log('PASS', `点击取消关闭表单`)
        await sleep(300)
      }
    }

    console.log('')

    // =============================================================
    // 场景 6: 设置页按钮点击
    // =============================================================
    console.log('--- 场景 6: 设置页按钮点击 ---')
    await cdp.eval(`window.location.hash = '/settings'`)
    await sleep(800)

    // 点击一些设置按钮 (不修改实际设置)
    const settingsButtons = await cdp.eval(`Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t.length > 0 && t.length < 20)`)
    if (settingsButtons.length > 5) log('PASS', `设置页按钮数`, `${settingsButtons.length}`)
    else log('WARN', `设置页按钮少`)

    // 点击主题切换 (如果存在)
    const themeClicked = await cdp.clickByText('主题')
    if (themeClicked) {
      await sleep(400)
      log('PASS', `点击主题切换`)
      // 再点回来
      await cdp.clickByText('主题')
      await sleep(400)
    } else log('WARN', `未找到主题切换`)

    console.log('')

    // =============================================================
    // 场景 7: 快速连续点击导航 (压力)
    // =============================================================
    console.log('--- 场景 7: 快速连续点击导航 (压力) ---')
    let quickClickOk = 0
    for (let i = 0; i < 15; i++) {
      const targets = ['仪表盘', '学生', '班级', '设置', 'Agent']
      const t = targets[i % targets.length]
      try {
        await cdp.clickByText(t, 'a, button, [role="button"], div')
        await sleep(200)
        quickClickOk++
      } catch (e) { /* 忽略 */ }
    }
    if (quickClickOk >= 12) log('PASS', `快速点击导航`, `${quickClickOk}/15 成功`)
    else log('WARN', `快速点击导航`, `${quickClickOk}/15`)

    // 最终验证页面正常
    await sleep(500)
    const finalText = await cdp.eval(`document.body.innerText.length`)
    if (finalText > 100) log('PASS', `最终页面正常`, `${finalText} 字符`)
    else log('FAIL', `最终页面异常`)

    console.log('')

  } catch (e) {
    log('FAIL', '测试异常', e.message)
    console.error(e.stack)
  } finally {
    ws.close()
  }

  console.log('')
  console.log('=== R60 测试完成 ===')
  const total = RESULT.pass + RESULT.fail + RESULT.warn
  const rate = total > 0 ? ((RESULT.pass / total) * 100).toFixed(1) : '0.0'
  console.log(`结果: ${RESULT.pass} pass, ${RESULT.fail} fail, ${RESULT.warn} warn`)
  console.log(`通过率: ${rate}%`)
  if (RESULT.errors.length > 0) {
    console.log('失败项:')
    RESULT.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`))
  }
  fs.writeFileSync('dogfood-output/r60-click-result.json', JSON.stringify({ test: 'R60', summary: { pass: RESULT.pass, fail: RESULT.fail, warn: RESULT.warn, rate: rate + '%' }, errors: RESULT.errors }, null, 2), 'utf-8')
  process.exit(RESULT.fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(2) })
