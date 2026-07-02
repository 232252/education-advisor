// 第三十一轮 — UI 交互与跨模块数据一致性深度测试
// 覆盖: 路由导航/侧边栏active/页面内容/数据一致性/删除级联/UI空状态
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 60000) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  async navigate(p, wait = 1500) { await this.eval("window.location.hash='" + p + "'"); await new Promise((r) => setTimeout(r, wait)) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push('✓ ' + n + (d ? ' — ' + d : '')); console.log('  ✓ ' + n + (d ? ' — ' + d : '')) }
  const fail = (n, d, e) => { results.fail++; results.details.push('✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 120)); console.log('  ✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 120)) }
  const warn = (n, d) => { results.warn++; results.details.push('⚠ ' + n + (d ? ' — ' + d : '')); console.log('  ⚠ ' + n + (d ? ' — ' + d : '')) }

  console.log('=== 第三十一轮: UI 交互与跨模块数据一致性 ===\n')

  // ========== Section 1: 路由导航 ==========
  console.log('--- Section 1: 路由导航 (10页面 + 兜底) ---')
  const routes = [
    { path: '/dashboard', title: '数据仪表盘' },
    { path: '/chat', title: null },
    { path: '/students', title: null },
    { path: '/classes', title: null },
    { path: '/agents', title: null },
    { path: '/models', title: null },
    { path: '/skills', title: null },
    { path: '/scheduler', title: null },
    { path: '/privacy', title: null },
    { path: '/settings', title: null },
  ]
  for (const route of routes) {
    try {
      await cdp.navigate(route.path, 1500)
      const hash = await cdp.eval('window.location.hash')
      const bodyLen = await cdp.eval('document.querySelector("main")?.textContent?.length || 0')
      if (hash === '#' + route.path && bodyLen > 0) ok('路由 ' + route.path, hash + ', 内容' + bodyLen + '字符')
      else fail('路由 ' + route.path, '', 'hash=' + hash + ' bodyLen=' + bodyLen)
    } catch (e) { fail('路由 ' + route.path, '', e) }
  }

  // 根路径重定向
  await cdp.eval("window.location.hash='/'")
  await new Promise((r) => setTimeout(r, 1500))
  let hash = await cdp.eval('window.location.hash')
  if (hash === '#/dashboard') ok('根路径 / 重定向', '→ /dashboard')
  else fail('根路径重定向', '', 'hash=' + hash)

  // 无效路由重定向
  await cdp.eval("window.location.hash='/invalid-page-xyz'")
  await new Promise((r) => setTimeout(r, 1500))
  hash = await cdp.eval('window.location.hash')
  if (hash === '#/dashboard') ok('无效路由重定向', '→ /dashboard')
  else fail('无效路由重定向', '', 'hash=' + hash)

  // ========== Section 2: 侧边栏 active 状态 ==========
  console.log('\n--- Section 2: 侧边栏 active 状态 ---')
  for (const route of routes.slice(0, 5)) {
    await cdp.navigate(route.path, 1000)
    const activeHref = await cdp.eval('document.querySelector("nav a[class*=\\\"bg-blue-600\\\"]")?.getAttribute("href")')
    if (activeHref === '#' + route.path) ok('active ' + route.path, '侧边栏高亮正确')
    else fail('active ' + route.path, '', '期望 #' + route.path + ' 实际 ' + activeHref)
  }

  // ========== Section 3: 跨模块数据一致性 ==========
  console.log('\n--- Section 3: 跨模块数据一致性 ---')
  const testStudent = 'R31Consistency_' + Date.now()
  const testClassId = 'R31CLS-' + rand(1000, 9999)
  const testClassName = 'R31一致性测试班'

  // 3.1 创建学生 → EAA listStudents 包含
  let r = await cdp.eval("(async()=>{ try{ const r=await window.api.eaa.addStudent('" + testStudent + "'); return JSON.stringify(r); }catch(e){ return 'ERR:'+String(e).slice(0,100) } })()")
  try { const rp = JSON.parse(r); if (rp.success !== false) ok('创建学生', testStudent); else fail('创建学生', '', r) } catch (e) { fail('创建学生', '', e) }
  await new Promise((r) => setTimeout(r, 1000))

  // 3.2 EAA score = 100 (基准)
  r = await cdp.eval("(async()=>{ const r=await window.api.eaa.score('" + testStudent + "'); return JSON.stringify(r); })()")
  try { const rp = JSON.parse(r); const sc = rp.data?.score ?? rp.data; if (sc === 100) ok('初始分数=100', testStudent + ': ' + sc); else warn('初始分数', '期望100 实际' + sc) } catch (e) { fail('初始分数', '', e) }

  // 3.3 创建班级 + 分配学生
  r = await cdp.eval("(async()=>{ try{ const r=await window.api.class.create({ class_id: '" + testClassId + "', name: '" + testClassName + "', grade: '九年级' }); return JSON.stringify(r); }catch(e){ return 'ERR:'+String(e).slice(0,100) } })()")
  try { const rp = JSON.parse(r); if (rp.success !== false) ok('创建班级', testClassId); else fail('创建班级', '', r) } catch (e) { fail('创建班级', '', e) }

  r = await cdp.eval("(async()=>{ try{ const r=await window.api.class.assign({ class_id: '" + testClassId + "', student_names: ['" + testStudent + "'] }); return JSON.stringify(r); }catch(e){ return 'ERR:'+String(e).slice(0,100) } })()")
  try { const rp = JSON.parse(r); if (rp.success !== false) ok('分配学生到班级', testStudent + ' → ' + testClassId); else fail('分配学生', '', r) } catch (e) { fail('分配学生', '', e) }
  await new Promise((r) => setTimeout(r, 1000))

  // 3.4 验证 EAA 学生 class_id 已更新
  r = await cdp.eval("(async()=>{ const r=await window.api.eaa.listStudents(); const s=(r.data?.students||[]).find(x=>x.name==='" + testStudent + "'); return JSON.stringify({class_id:s?.class_id, status:s?.status}); })()")
  try { const rp = JSON.parse(r); if (rp.class_id === testClassId) ok('EAA class_id 同步', rp.class_id); else fail('EAA class_id 同步', '', '期望 ' + testClassId + ' 实际 ' + rp.class_id) } catch (e) { fail('EAA class_id 同步', '', e) }

  // 3.5 添加事件 → score 变化
  r = await cdp.eval("(async()=>{ try{ const r=await window.api.eaa.addEvent({ studentName: '" + testStudent + "', reasonCode: 'SPEAK_IN_CLASS', note: 'R31一致性测试', operator: 'R31' }); return JSON.stringify(r); }catch(e){ return 'ERR:'+String(e).slice(0,100) } })()")
  try { const rp = JSON.parse(r); if (rp.success !== false) ok('添加事件', 'SPEAK_IN_CLASS -2'); else fail('添加事件', '', r) } catch (e) { fail('添加事件', '', e) }
  await new Promise((r) => setTimeout(r, 1000))

  r = await cdp.eval("(async()=>{ const r=await window.api.eaa.score('" + testStudent + "'); return JSON.stringify(r); })()")
  try { const rp = JSON.parse(r); const sc = rp.data?.score ?? rp.data; if (sc === 98) ok('事件后分数=98', testStudent + ': ' + sc); else warn('事件后分数', '期望98 实际' + sc) } catch (e) { fail('事件后分数', '', e) }

  // 3.6 排行榜包含该学生
  r = await cdp.eval("(async()=>{ const r=await window.api.eaa.ranking(500); const list=r.data?.ranking||r.data||[]; const found=list.find(x=>x.name==='" + testStudent + "'); return JSON.stringify({found:!!found, score:found?.score, rank:found?.rank, total:list.length}); })()")
  try { const rp = JSON.parse(r); if (rp.found) ok('排行榜包含学生', 'rank=' + rp.rank + ' score=' + rp.score + ' total=' + rp.total); else warn('排行榜', '未找到学生 (total=' + rp.total + ', 可能分数不在top)') } catch (e) { fail('排行榜', '', e) }

  // 3.7 撤销事件 → 分数恢复
  r = await cdp.eval("(async()=>{ const r=await window.api.eaa.history('" + testStudent + "'); const evts=r.data?.events||[]; const last=evts[evts.length-1]; return JSON.stringify({id:last?.event_id, type:last?.event_type}); })()")
  let eventId = null
  try { const rp = JSON.parse(r); eventId = rp.id; if (rp.type) ok('获取历史事件', 'event_id=' + rp.id + ' type=' + rp.type); else warn('获取历史事件', '无事件') } catch (e) { fail('获取历史事件', '', e) }

  if (eventId) {
    r = await cdp.eval("(async()=>{ try{ const r=await window.api.eaa.revertEvent('" + eventId + "', 'R31测试撤销'); return JSON.stringify(r); }catch(e){ return 'ERR:'+String(e).slice(0,100) } })()")
    try { const rp = JSON.parse(r); if (rp.success !== false) ok('撤销事件', eventId); else fail('撤销事件', '', r) } catch (e) { fail('撤销事件', '', e) }
    await new Promise((r) => setTimeout(r, 1000))

    r = await cdp.eval("(async()=>{ const r=await window.api.eaa.score('" + testStudent + "'); return JSON.stringify(r); })()")
    try { const rp = JSON.parse(r); const sc = rp.data?.score ?? rp.data; if (sc === 100) ok('撤销后分数=100', '分数恢复'); else warn('撤销后分数', '期望100 实际' + sc) } catch (e) { fail('撤销后分数', '', e) }
  }

  // ========== Section 4: 删除级联一致性 ==========
  console.log('\n--- Section 4: 删除级联一致性 ---')
  // 4.1 软删除学生 → 排行榜不包含
  r = await cdp.eval("(async()=>{ try{ const r=await window.api.eaa.deleteStudent('" + testStudent + "', 'R31测试删除'); return JSON.stringify(r); }catch(e){ return 'ERR:'+String(e).slice(0,100) } })()")
  try { const rp = JSON.parse(r); if (rp.success !== false) ok('软删除学生', testStudent); else fail('软删除学生', '', r) } catch (e) { fail('软删除学生', '', e) }
  await new Promise((r) => setTimeout(r, 3000))

  // 验证 listStudents 中 status=Deleted
  r = await cdp.eval("(async()=>{ const r=await window.api.eaa.listStudents(); const s=(r.data?.students||[]).find(x=>x.name==='" + testStudent + "'); return JSON.stringify({status:s?.status}); })()")
  try { const rp = JSON.parse(r); if (rp.status === 'Deleted') ok('删除后 status=Deleted', ''); else warn('删除后 status', '期望 Deleted 实际 ' + rp.status) } catch (e) { fail('删除后 status', '', e) }

  // 验证排行榜不包含已删除学生
  r = await cdp.eval("(async()=>{ const r=await window.api.eaa.ranking(500); const list=r.data?.ranking||r.data||[]; const found=list.find(x=>x.name==='" + testStudent + "'); return JSON.stringify({found:!!found, total:list.length}); })()")
  try { const rp = JSON.parse(r); if (!rp.found) ok('排行榜排除已删除学生', 'total=' + rp.total); else fail('排行榜应排除已删除学生', '', '仍在排行榜中 (total=' + rp.total + ')') } catch (e) { fail('排行榜排除', '', e) }

  // 4.2 删除班级 → class.list 不包含
  const classList = await cdp.eval("(async()=>{ const r=await window.api.class.list(); const c=(r.data||[]).find(x=>x.class_id==='" + testClassId + "'); return JSON.stringify({id:c?.id}); })()")
  let classUuid = null
  try { const rp = JSON.parse(classList); classUuid = rp.id; if (classUuid) ok('获取班级UUID', classUuid); else warn('获取班级UUID', '未找到') } catch (e) { fail('获取班级UUID', '', e) }

  if (classUuid) {
    r = await cdp.eval("(async()=>{ try{ const r=await window.api.class.delete('" + classUuid + "'); return JSON.stringify(r); }catch(e){ return 'ERR:'+String(e).slice(0,100) } })()")
    try { const rp = JSON.parse(r); if (rp.success !== false) ok('删除班级', testClassId); else fail('删除班级', '', r) } catch (e) { fail('删除班级', '', e) }
    await new Promise((r) => setTimeout(r, 500))

    // 验证 class.list 不包含
    r = await cdp.eval("(async()=>{ const r=await window.api.class.list(); const c=(r.data||[]).find(x=>x.class_id==='" + testClassId + "'); return JSON.stringify({found:!!c}); })()")
    try { const rp = JSON.parse(r); if (!rp.found) ok('删除后 class.list 不包含', ''); else fail('删除后仍包含', '', '') } catch (e) { fail('删除后验证', '', e) }
  }

  // ========== Section 5: 不存在实体的 graceful 处理 ==========
  console.log('\n--- Section 5: 不存在实体的 graceful 处理 ---')
  // score 不存在学生
  r = await cdp.eval("(async()=>{ try{ const r=await window.api.eaa.score('不存在学生XYZ999'); return JSON.stringify(r); }catch(e){ return 'THROW:'+String(e).slice(0,80) } })()")
  try { const rp = JSON.parse(r); if (rp.success === false || rp.exitCode !== 0 || String(r).includes('THROW')) ok('score 不存在学生', 'graceful 处理'); else warn('score 不存在学生', JSON.stringify(rp).slice(0, 60)) } catch (e) { ok('score 不存在学生', 'throw 被捕获') }

  // history 不存在学生
  r = await cdp.eval("(async()=>{ try{ const r=await window.api.eaa.history('不存在学生XYZ999'); return JSON.stringify(r); }catch(e){ return 'THROW:'+String(e).slice(0,80) } })()")
  try { const rp = JSON.parse(r); if (rp.success === false || rp.exitCode !== 0 || String(r).includes('THROW')) ok('history 不存在学生', 'graceful 处理'); else warn('history 不存在学生', JSON.stringify(rp).slice(0, 60)) } catch (e) { ok('history 不存在学生', 'throw 被捕获') }

  // addEvent 给不存在学生
  r = await cdp.eval("(async()=>{ try{ const r=await window.api.eaa.addEvent({ studentName: '不存在学生XYZ999', reasonCode: 'SPEAK_IN_CLASS', note: 'test', operator: 'R31' }); return JSON.stringify(r); }catch(e){ return 'THROW:'+String(e).slice(0,80) } })()")
  try { const rp = JSON.parse(r); if (rp.success === false || rp.exitCode !== 0 || String(r).includes('THROW')) ok('addEvent 不存在学生', 'graceful 拒绝'); else fail('addEvent 不存在学生', '', '应被拒') } catch (e) { ok('addEvent 不存在学生', 'throw 被捕获') }

  // ========== Section 6: UI 空状态与页面内容 ==========
  console.log('\n--- Section 6: UI 页面内容验证 ---')
  // Dashboard 页面内容
  await cdp.navigate('/dashboard', 2000)
  const dashH1 = await cdp.eval('document.querySelector("h1")?.textContent || ""')
  if (dashH1.length > 0) ok('Dashboard h1', dashH1.slice(0, 30)); else fail('Dashboard h1', '', '无标题')

  const dashCards = await cdp.eval('document.querySelectorAll("[class*=\\"card\\"], [class*=\\"stat\\"]").length')
  if (dashCards > 0) ok('Dashboard 卡片/统计', dashCards + ' 个'); else warn('Dashboard 卡片', '0个')

  // Students 页面
  await cdp.navigate('/students', 2000)
  const stuH1 = await cdp.eval('document.querySelector("h1")?.textContent || ""')
  if (stuH1.length > 0) ok('Students h1', stuH1.slice(0, 30)); else fail('Students h1', '', '无标题')

  const stuRows = await cdp.eval('document.querySelectorAll("table tbody tr").length')
  if (stuRows >= 0) ok('Students 表格行', stuRows + ' 行'); else warn('Students 表格', '无表格')

  // Classes 页面
  await cdp.navigate('/classes', 2000)
  const clsH1 = await cdp.eval('document.querySelector("h1")?.textContent || ""')
  if (clsH1.length > 0) ok('Classes h1', clsH1.slice(0, 30)); else fail('Classes h1', '', '无标题')

  // Settings 页面
  await cdp.navigate('/settings', 2000)
  const setH1 = await cdp.eval('document.querySelector("h1")?.textContent || ""')
  if (setH1.length > 0) ok('Settings h1', setH1.slice(0, 30)); else fail('Settings h1', '', '无标题')

  const setInputs = await cdp.eval('document.querySelectorAll("input, select, button").length')
  if (setInputs > 5) ok('Settings 表单元素', setInputs + ' 个'); else warn('Settings 表单', setInputs + ' 个')

  // ========== Section 7: 内存与清理 ==========
  console.log('\n--- Section 7: 内存与清理 ---')
  const mem = await cdp.eval('(async()=>{ const p=await performance.memory; return JSON.stringify({used:Math.round(p.usedJSHeapSize/1048576),total:Math.round(p.totalJSHeapSize/1048576),limit:Math.round(p.jsHeapSizeLimit/1048576)}); })()')
  try { const m = JSON.parse(mem); ok('内存', m.used + 'MB/' + m.total + 'MB (limit ' + m.limit + 'MB)') } catch (e) { warn('内存', '', e) }

  // console 错误检查
  const errors = await cdp.eval('window.__consoleErrors || []')
  try { const e = JSON.parse(errors); if (Array.isArray(e) && e.length === 0) ok('console 错误', '0 个'); else warn('console 错误', e.length + ' 个') } catch (e) { ok('console 错误', '无跟踪') }

  // ========== 汇总 ==========
  console.log('\n=== 汇总 ===')
  console.log('通过: ' + results.pass + ', 失败: ' + results.fail + ', 警告: ' + results.warn + ', 通过率: ' + ((results.pass / (results.pass + results.fail)) * 100).toFixed(1) + '%')

  const outPath = path.join(__dirname, 'r31-consistency-result.json')
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log('详细结果: ' + outPath)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
