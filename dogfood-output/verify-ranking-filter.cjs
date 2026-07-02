// 验证 Dashboard 班级筛选排行榜功能 (含数据准备)
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
      // 15s 超时, 避免无限挂起
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          j(new Error(`CDP timeout: ${method}`))
        }
      }, 15000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 12000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
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

  console.log('=== Dashboard 班级筛选排行榜验证 ===\n')

  // 1. 清理旧 VF-* 测试数据
  console.log('--- 阶段1: 清理旧 VF 测试数据 ---')
  const oldClasses = await call('class.list')
  let delCls = 0
  for (const c of (oldClasses?.data ?? [])) {
    if (c.class_id?.startsWith('VF-')) {
      const r = await call('class.delete', c.id)
      if (r?.success) delCls++
    }
  }
  console.log(`  删除班级: ${delCls}`)

  const allStu = await call('eaa.listStudents')
  let delStu = 0
  for (const s of (allStu?.data?.students ?? [])) {
    if (s.name?.startsWith('VF-')) {
      const r = await call('eaa.removeStudent', s.name)
      if (r?.success) delStu++
    }
  }
  console.log(`  删除学生: ${delStu}\n`)

  // 2. 创建 VF-1 班级 + 5 学生 + 分班 + 事件
  console.log('--- 阶段2: 创建测试数据 ---')
  const cr = await call('class.create', { class_id: 'VF-1', name: '验证班1', grade: '七年级', teacher: '测试老师', note: '验证用' })
  console.log(`  班级创建: ${cr?.success ? 'OK' : 'FAIL ' + JSON.stringify(cr)}`)

  const students = ['VF-张三', 'VF-李四', 'VF-王五', 'VF-赵六', 'VF-钱七']
  for (const name of students) {
    const r = await call('eaa.addStudent', name)
    console.log(`  学生 ${name}: ${r?.success ? 'OK' : 'FAIL ' + JSON.stringify(r)}`)
  }
  for (const name of students) {
    const r = await call('class.assign', { class_id: 'VF-1', student_name: name })
    console.log(`  分班 ${name}: ${r?.success ? 'OK' : 'FAIL ' + JSON.stringify(r)}`)
  }
  // 给每个学生添加 2 个加分事件
  const bonusCodes = ['CLASS_MONITOR', 'CLASS_COMMITTEE', 'CIVILIZED_DORM']
  for (let i = 0; i < students.length; i++) {
    const r1 = await call('eaa.addEvent', students[i], bonusCodes[i % 3], '2026-07-01', '测试加分', 'tester')
    const r2 = await call('eaa.addEvent', students[i], 'ACTIVITY_PARTICIPATION', '2026-07-01', '活动加分', 'tester')
    console.log(`  事件 ${students[i]}: ${r1?.success && r2?.success ? 'OK' : 'FAIL'}`)
  }
  console.log('  创建完成\n')

  // 3. 导航到 dashboard
  console.log('--- 阶段3: 验证 Dashboard ---')
  await cdp.eval(`window.location.hash='/dashboard'`)
  await new Promise((r) => setTimeout(r, 3500))

  // 3a. 找所有 h3
  const allH3 = await cdp.eval(`Array.from(document.querySelectorAll('h3')).map(h => h.textContent?.trim())`)
  console.log('所有 h3 文本:', JSON.stringify(allH3))

  // 3b. 找含 "Top" 的 h3, 默认(全部)状态下应有 5 个 VF-* 学生
  const initialRanking = await cdp.eval(`(function(){
    const h3s = Array.from(document.querySelectorAll('h3'));
    const found = h3s.find(h => h.textContent?.includes('Top'));
    if(!found) return {found: false};
    const container = found.parentElement;
    const buttons = container.querySelectorAll('button');
    return {found: true, h3Text: found.textContent?.trim(), buttonCount: buttons.length, buttonTexts: Array.from(buttons).map(b => b.textContent?.trim().slice(0, 40))};
  })()`)
  console.log('\n默认 (全部) 排行:', JSON.stringify(initialRanking, null, 2))

  // 3c. 切换到 VF-1 班级筛选
  await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    const classSel = Array.from(selects).find(s => {
      const opts = Array.from(s.options).map(o => o.value);
      return opts.includes('__ALL__') && opts.includes('__NONE__');
    });
    if(classSel){ classSel.value='VF-1'; classSel.dispatchEvent(new Event('change',{bubbles:true})); }
  })()`)
  await new Promise((r) => setTimeout(r, 1500))

  const filteredRanking = await cdp.eval(`(function(){
    const h3s = Array.from(document.querySelectorAll('h3'));
    const found = h3s.find(h => h.textContent?.includes('Top'));
    if(!found) return {found: false};
    const container = found.parentElement;
    const buttons = container.querySelectorAll('button');
    return {
      found: true,
      h3Text: found.textContent?.trim(),
      buttonCount: buttons.length,
      buttonTexts: Array.from(buttons).map(b => b.textContent?.trim().slice(0, 40))
    };
  })()`)
  console.log('\n筛选 VF-1 排行:', JSON.stringify(filteredRanking, null, 2))

  // 4. 评估结果
  console.log('\n=== 结论 ===')
  if (filteredRanking.found && filteredRanking.buttonCount === 5) {
    console.log('✓ Dashboard 班级筛选排行: VF-1 班级筛选后排行按钮数 = 5 (期望5)')
    console.log('  说明原 real-scenario-test 的失败是测试选择器 bug (Top10 vs Top 10),功能本身正常')
  } else {
    console.log(`✗ 实际 ${filteredRanking.buttonCount}, 期望 5`)
  }

  // 5. 清理
  console.log('\n--- 阶段4: 清理验证数据 ---')
  for (const name of students) await call('eaa.removeStudent', name)
  const clsList = await call('class.list')
  for (const c of (clsList?.data ?? [])) {
    if (c.class_id === 'VF-1') await call('class.delete', c.id)
  }
  console.log('  清理完成')

  ws.close(1000)
}
main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
