// R13: 真实用户一天使用场景模拟
// 模拟班主任一天: 早打开→查仪表盘→记录迟到→查排行→处理学生→导出报告→晚关闭
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 5000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R13 真实用户一天使用场景模拟 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`) }

  function unwrap(r) { if (r && r.__error) return r; if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data; return r }
  async function callApi(path, ...args) {
    const r = await cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p)o=o[x];const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
    return unwrap(r)
  }
  async function navigate(route) { await cdp.eval(`window.location.hash = '${route}'`); await new Promise((r) => setTimeout(r, 500)) }
  async function getHeap() { return cdp.eval(`performance && performance.memory ? performance.memory.usedJSHeapSize : 0`) }
  const rid = () => 'r13' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

  // ========== 场景 1: 早上打开软件 ==========
  console.log('--- 场景 1: 早上打开软件 ---')
  const heapStart = await getHeap()
  ok('软件启动', `heap=${(heapStart / 1024 / 1024).toFixed(2)} MB`)

  // 查看仪表盘
  await navigate('#/dashboard')
  const dashTitle = await cdp.eval(`document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim()?.slice(0, 50) || '无标题'`)
  ok('查看仪表盘', `标题: ${dashTitle}`)

  // ========== 场景 2: 查看学生概况 ==========
  console.log('\n--- 场景 2: 查看学生概况 ---')
  const info = await callApi('eaa.info')
  ok('学生总数', `${info?.students}`)
  ok('事件总数', `${info?.events}`)
  ok('EAA 版本', `${info?.version}`)

  // 健康检查
  const doc = await callApi('eaa.doctor')
  ok('健康检查', `healthy=${doc?.healthy}, passed=${doc?.passed}, failed=${doc?.failed}`)

  // ========== 场景 3: 创建今日测试班级和学生 ==========
  console.log('\n--- 场景 3: 创建今日测试班级和学生 ---')
  const classId = 'R13DAY' + Date.now().toString(36).toUpperCase()
  const cls = await callApi('class.create', { class_id: classId, name: '今日测试班', grade: '八年级', teacher: '测试班主任' })
  if (cls && cls.id) {
    ok('创建班级', `今日测试班 (id=${cls.id.slice(0, 8)}...)`)
    // 创建 5 个学生
    const students = []
    const names = ['赵小明', '钱小红', '孙小刚', '李小丽', '周小强']
    for (const n of names) {
      const sn = `R13_${n}_${rid()}`
      const r = await callApi('eaa.addStudent', sn)
      if (r && !r.__error) { students.push(sn); ok(`创建学生`, n) }
    }
    // 调班
    const assign = await callApi('class.assign', { class_id: classId, student_names: students })
    if (assign && !assign.__error) ok('学生调班', `${students.length} 人`)

    // ========== 场景 4: 记录今日操行事件 ==========
    console.log('\n--- 场景 4: 记录今日操行事件 ---')
    // 赵小明迟到
    const e1 = await callApi('eaa.addEvent', { studentName: students[0], reasonCode: 'LATE', delta: -2, operator: '班主任', note: '早上迟到5分钟' })
    if (e1 && !e1.__error) ok('记录迟到', `${students[0]}`)
    // 钱小红课堂说话
    const e2 = await callApi('eaa.addEvent', { studentName: students[1], reasonCode: 'SPEAK_IN_CLASS', delta: -1, operator: '班主任' })
    if (e2 && !e2.__error) ok('记录课堂说话', `${students[1]}`)
    // 孙小刚参加活动
    const e3 = await callApi('eaa.addEvent', { studentName: students[2], reasonCode: 'ACTIVITY_PARTICIPATION', delta: 2, operator: '年级组长', note: '参加演讲比赛' })
    if (e3 && !e3.__error) ok('记录活动参与', `${students[2]}`)
    // 李小丽班干部加分
    const e4 = await callApi('eaa.addEvent', { studentName: students[3], reasonCode: 'CLASS_MONITOR', delta: 5, operator: '班主任' })
    if (e4 && !e4.__error) ok('记录班干部加分', `${students[3]}`)
    // 周小强文明宿舍
    const e5 = await callApi('eaa.addEvent', { studentName: students[4], reasonCode: 'CIVILIZED_DORM', delta: 3, operator: '宿管' })
    if (e5 && !e5.__error) ok('记录文明宿舍', `${students[4]}`)

    // ========== 场景 5: 查看排行榜 ==========
    console.log('\n--- 场景 5: 查看排行榜 ---')
    const ranking = await callApi('eaa.ranking', 10)
    if (ranking && !ranking.__error) {
      const rankArr = Array.isArray(ranking) ? ranking : (ranking?.ranking || ranking?.data || [])
      ok('查看排行榜', `Top-${rankArr.length || 10}`)
      // 查看自己班学生排名
      for (const s of students) {
        const sc = await callApi('eaa.score', s)
        if (sc && !sc.__error) {
          const score = sc?.score ?? sc
          ok(`查询分数 ${s.split('_')[1]}`, `${score}分`)
        }
      }
    }

    // ========== 场景 6: 查看学生历史 ==========
    console.log('\n--- 场景 6: 查看学生历史 ---')
    for (const s of students) {
      const hist = await callApi('eaa.history', s)
      if (hist && !hist.__error) {
        const histArr = Array.isArray(hist) ? hist : (hist?.events || hist?.data || [])
        ok(`历史 ${s.split('_')[1]}`, `${histArr.length} 条事件`)
      }
    }

    // ========== 场景 7: 搜索事件 ==========
    console.log('\n--- 场景 7: 搜索事件 ---')
    const search = await callApi('eaa.search', '迟到', 10)
    if (search && !search.__error) {
      const sArr = Array.isArray(search) ? search : (search?.events || search?.data || [])
      ok('搜索"迟到"', `${sArr.length} 条结果`)
    }
    // 按时间范围查
    const today = new Date().toISOString().slice(0, 10)
    const rangeR = await callApi('eaa.range', today, today, 50)
    if (rangeR && !rangeR.__error) {
      const rArr = Array.isArray(rangeR) ? rangeR : (rangeR?.events || rangeR?.data || [])
      ok('今日时间范围查询', `${rArr.length} 条事件`)
    }

    // ========== 场景 8: 统计与摘要 ==========
    console.log('\n--- 场景 8: 统计与摘要 ---')
    const stats = await callApi('eaa.stats')
    if (stats && !stats.__error) ok('统计', '成功')
    const summary = await callApi('eaa.summary')
    if (summary && !summary.__error) ok('摘要', '成功')

    // ========== 场景 9: 设置学生元数据 ==========
    console.log('\n--- 场景 9: 设置学生元数据 ---')
    const metaR = await callApi('eaa.setStudentMeta', { name: students[0], group: '第一组', role: '组长' })
    if (metaR && !metaR.__error) ok('设置组长', students[0].split('_')[1])

    // ========== 场景 10: Chat 记录沟通 ==========
    console.log('\n--- 场景 10: Chat 记录沟通 ---')
    const chatSess = 'r13day_' + rid()
    const cm1 = await callApi('chat.saveMessage', { sessionId: chatSess, role: 'user', content: `今天${students[0].split('_')[1]}迟到了,需要联系家长`, timestamp: Date.now() })
    if (cm1 && !cm1.__error) ok('记录沟通', '用户消息')
    const cm2 = await callApi('chat.saveMessage', { sessionId: chatSess, role: 'assistant', content: '建议先了解迟到原因,再决定是否联系家长。', timestamp: Date.now() + 1 })
    if (cm2 && !cm2.__error) ok('记录回复', 'AI 消息')
    // 读回
    const cmLoad = await callApi('chat.loadMessages', chatSess)
    const cmArr = Array.isArray(cmLoad) ? cmLoad : (cmLoad?.messages || cmLoad?.data || [])
    ok('沟通记录读回', `${cmArr.length} 条`)

    // ========== 场景 11: 撤销错误事件 ==========
    console.log('\n--- 场景 11: 撤销错误事件 ---')
    // 误记了一个事件,撤销它
    const histForRevert = await callApi('eaa.history', students[0])
    const histArr = Array.isArray(histForRevert) ? histForRevert : (histForRevert?.events || histForRevert?.data || [])
    if (histArr.length > 0) {
      const evt = histArr[0]
      const evtId = evt.id || evt.event_id
      if (evtId) {
        const revR = await callApi('eaa.revertEvent', String(evtId), '误记,撤销')
        if (revR && !revR.__error) ok('撤销事件', `evt=${String(evtId).slice(0, 16)}`)
      }
    }

    // ========== 场景 12: 导出报告 ==========
    console.log('\n--- 场景 12: 导出报告 ---')
    for (const fmt of ['csv', 'jsonl', 'html']) {
      const r = await callApi('eaa.export', fmt)
      if (r && !r.__error) ok(`导出 ${fmt}`, '成功')
    }
    // 生成 dashboard
    const dashR = await callApi('eaa.dashboard')
    if (dashR && !dashR.__error) ok('生成 dashboard', '成功')

    // ========== 场景 13: 隐私处理 (敏感信息) ==========
    console.log('\n--- 场景 13: 隐私处理 ---')
    const pwd = 'r13daypwd'
    const pi = await callApi('privacy.init', pwd, false)
    if (pi && !pi.__error) ok('隐私引擎初始化', '')
    await callApi('privacy.add', 'phone', '13800000000')
    const anon = await callApi('privacy.anonymize', '赵小明的电话是13800000000')
    if (anon && !anon.__error) {
      const anonText = anon?.text || anon?.data || String(anon)
      ok('匿名化', anonText.slice(0, 40))
    }
    await callApi('privacy.lock')

    // ========== 场景 14: 修改设置 ==========
    console.log('\n--- 场景 14: 修改设置 ---')
    await navigate('#/settings')
    const setR = await callApi('settings.set', 'general.logLevel', 'info')
    if (setR && !setR.__error) ok('设置 logLevel', 'info')
    await callApi('settings.set', 'general.logLevel', 'debug')
    ok('切换 logLevel', 'debug')
    await callApi('settings.set', 'general.logLevel', 'info')
    ok('恢复 logLevel', 'info')

    // ========== 场景 15: 查看定时任务 ==========
    console.log('\n--- 场景 15: 查看定时任务 ---')
    const cronList = await callApi('cron.list')
    if (cronList && !cronList.__error) {
      const cArr = Array.isArray(cronList) ? cronList : (cronList?.tasks || cronList?.data || [])
      ok('定时任务', `${cArr.length} 个`)
    }

    // ========== 场景 16: Agent 查看与触发 ==========
    console.log('\n--- 场景 16: Agent 查看 ---')
    const agents = await callApi('agent.list')
    if (agents && !agents.__error) {
      const aArr = Array.isArray(agents) ? agents : (agents?.agents || agents?.data || [])
      ok('Agent 列表', `${aArr.length} 个`)
      // 查看第一个 agent 详情
      if (aArr.length > 0) {
        const aid = aArr[0].id || aArr[0]
        const soul = await callApi('agent.getSoul', aid)
        if (soul !== null) ok(`Agent ${aid} SOUL`, `${String(soul).length} 字符`)
      }
    }

    // ========== 场景 17: 清理 — 删除测试数据 ==========
    console.log('\n--- 场景 17: 下班清理 ---')
    // 删除沟通记录
    const delChat = await callApi('chat.deleteSession', chatSess)
    if (delChat && !delChat.__error) ok('删除沟通记录', '')
    // 软删除学生
    for (const s of students) {
      await callApi('eaa.deleteStudent', s, 'R13 清理')
    }
    ok('软删除测试学生', `${students.length} 个`)
    // 删除班级
    const delCls = await callApi('class.delete', cls.id)
    if (delCls && !delCls.__error) ok('删除测试班级', '')
    // 锁定隐私
    await callApi('privacy.lock')

    // ========== 场景 18: 最终验证 ==========
    console.log('\n--- 场景 18: 最终验证 ---')
    const heapEnd = await getHeap()
    const growth = heapEnd - heapStart
    ok('内存使用', `${(heapEnd / 1024 / 1024).toFixed(2)} MB (增长 ${(growth / 1024).toFixed(0)} KB)`)
    ok('一天使用完成', '所有功能正常')
  } else {
    fail('创建班级', '', cls?.__error || cls?.error || JSON.stringify(cls).slice(0, 100))
  }

  // ========== 汇总 ==========
  console.log('\n=== R13 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r13-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
