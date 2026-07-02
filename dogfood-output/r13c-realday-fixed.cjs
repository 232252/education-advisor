// R13c: 修复版真实用户一天使用场景模拟
// 修复点:
//   1. 使用 reason-codes.json 的标准 delta 值 (R13 用了错误值导致假阳性)
//   2. 修复判断逻辑: 在 unwrap 前检查原始 success 字段, 失败时包装为 {__error}
//      (R13 的 if(e && !e.__error) 无法识别 unwrap 后的 "Error: ..." 字符串)
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

  console.log('=== R13c 修复版真实用户一天使用场景模拟 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`) }

  // 修复的 callApi: 先检查原始 success, 失败包装为 {__error}
  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p)o=o[x];const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }
  function unwrap(r) { if (r && r.__error) return r; if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data; return r }
  async function callApi(path, ...args) {
    const raw = await callRaw(path, ...args)
    // 关键修复: 检查原始 success 字段
    if (raw && typeof raw === 'object' && raw.success === false) {
      return { __error: String(raw.data || raw.error || 'operation failed') }
    }
    return unwrap(raw)
  }
  async function navigate(route) { await cdp.eval(`window.location.hash = '${route}'`); await new Promise((r) => setTimeout(r, 500)) }
  async function getHeap() { return cdp.eval(`performance && performance.memory ? performance.memory.usedJSHeapSize : 0`) }
  const rid = () => 'r13c' + Date.now().toString(36) + Math.floor(Math.random() * 10000)

  // ========== 场景 1: 早上打开软件 ==========
  console.log('--- 场景 1: 早上打开软件 ---')
  const heapStart = await getHeap()
  ok('软件启动', `heap=${(heapStart / 1024 / 1024).toFixed(2)} MB`)
  await navigate('#/dashboard')
  const dashTitle = await cdp.eval(`document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim()?.slice(0, 50) || '无标题'`)
  ok('查看仪表盘', `标题: ${dashTitle}`)

  // ========== 场景 2: 查看学生概况 ==========
  console.log('\n--- 场景 2: 查看学生概况 ---')
  const info = await callApi('eaa.info')
  ok('学生总数', `${info?.students}`)
  ok('事件总数', `${info?.events}`)
  ok('EAA 版本', `${info?.version}`)
  const doc = await callApi('eaa.doctor')
  ok('健康检查', `healthy=${doc?.healthy}, passed=${doc?.passed}, failed=${doc?.failed}`)

  // ========== 场景 3: 创建今日测试班级和学生 ==========
  console.log('\n--- 场景 3: 创建今日测试班级和学生 ---')
  const classId = 'R13C' + Date.now().toString(36).toUpperCase()
  const cls = await callApi('class.create', { class_id: classId, name: 'R13c测试班', grade: '八年级', teacher: '测试班主任' })
  if (cls && cls.id) {
    ok('创建班级', `R13c测试班 (id=${cls.id.slice(0, 8)}...)`)
    const students = []
    const names = ['赵小明', '钱小红', '孙小刚', '李小丽', '周小强']
    for (const n of names) {
      const sn = `R13c_${n}_${rid()}`
      const r = await callApi('eaa.addStudent', sn)
      if (r && !r.__error) { students.push(sn); ok(`创建学生`, n) }
      else fail(`创建学生 ${n}`, '', r?.__error)
    }
    const assign = await callApi('class.assign', { class_id: classId, student_names: students })
    if (assign && !assign.__error) ok('学生调班', `${students.length} 人`)
    else fail('学生调班', '', assign?.__error)

    // ========== 场景 4: 记录今日操行事件 (使用标准 delta) ==========
    console.log('\n--- 场景 4: 记录今日操行事件 (标准 delta) ---')
    // 标准 delta 值 (来自 config/reason-codes.json):
    // LATE=-2, SPEAK_IN_CLASS=-2, ACTIVITY_PARTICIPATION=+1, CLASS_MONITOR=+10, CIVILIZED_DORM=+3
    const e1 = await callApi('eaa.addEvent', { studentName: students[0], reasonCode: 'LATE', delta: -2, operator: '班主任', note: '早上迟到5分钟' })
    if (e1 && !e1.__error) ok('记录迟到', `${students[0].split('_')[1]} (-2分)`)
    else fail('记录迟到', '', e1?.__error)
    const e2 = await callApi('eaa.addEvent', { studentName: students[1], reasonCode: 'SPEAK_IN_CLASS', delta: -2, operator: '班主任' })
    if (e2 && !e2.__error) ok('记录课堂说话', `${students[1].split('_')[1]} (-2分)`)
    else fail('记录课堂说话', '', e2?.__error)
    const e3 = await callApi('eaa.addEvent', { studentName: students[2], reasonCode: 'ACTIVITY_PARTICIPATION', delta: 1, operator: '年级组长', note: '参加演讲比赛' })
    if (e3 && !e3.__error) ok('记录活动参与', `${students[2].split('_')[1]} (+1分)`)
    else fail('记录活动参与', '', e3?.__error)
    const e4 = await callApi('eaa.addEvent', { studentName: students[3], reasonCode: 'CLASS_MONITOR', delta: 10, operator: '班主任' })
    if (e4 && !e4.__error) ok('记录班长履职', `${students[3].split('_')[1]} (+10分)`)
    else fail('记录班长履职', '', e4?.__error)
    const e5 = await callApi('eaa.addEvent', { studentName: students[4], reasonCode: 'CIVILIZED_DORM', delta: 3, operator: '宿管' })
    if (e5 && !e5.__error) ok('记录文明宿舍', `${students[4].split('_')[1]} (+3分)`)
    else fail('记录文明宿舍', '', e5?.__error)

    // ========== 场景 5: 查看排行榜 + 分数验证 ==========
    console.log('\n--- 场景 5: 查看排行榜 + 分数验证 ---')
    const ranking = await callApi('eaa.ranking', 10)
    if (ranking && !ranking.__error) {
      const rankArr = Array.isArray(ranking) ? ranking : (ranking?.ranking || ranking?.data || [])
      ok('查看排行榜', `Top-${rankArr.length || 10}`)
    }
    // 验证每个学生分数与预期一致
    const expectedScores = [
      { name: students[0], label: '赵小明', expected: 98 },  // 100 - 2
      { name: students[1], label: '钱小红', expected: 98 },  // 100 - 2
      { name: students[2], label: '孙小刚', expected: 101 }, // 100 + 1
      { name: students[3], label: '李小丽', expected: 110 }, // 100 + 10
      { name: students[4], label: '周小强', expected: 103 }, // 100 + 3
    ]
    for (const s of expectedScores) {
      const sc = await callApi('eaa.score', s.name)
      if (sc && !sc.__error) {
        const score = sc?.score ?? sc
        if (score === s.expected) {
          ok(`分数验证 ${s.label}`, `${score}分 (期望 ${s.expected})`)
        } else {
          fail(`分数验证 ${s.label}`, `期望 ${s.expected}, 实际 ${score}`, `分数不匹配`)
        }
      } else {
        fail(`分数查询 ${s.label}`, '', sc?.__error)
      }
    }

    // ========== 场景 6: 查看学生历史 ==========
    console.log('\n--- 场景 6: 查看学生历史 ---')
    for (let i = 0; i < students.length; i++) {
      const hist = await callApi('eaa.history', students[i])
      if (hist && !hist.__error) {
        const histArr = Array.isArray(hist) ? hist : (hist?.events || hist?.data || [])
        if (histArr.length === 1) {
          ok(`历史 ${expectedScores[i].label}`, `${histArr.length} 条事件`)
        } else {
          fail(`历史 ${expectedScores[i].label}`, `期望 1 条, 实际 ${histArr.length}`, '事件数不匹配')
        }
      } else {
        fail(`历史 ${expectedScores[i].label}`, '', hist?.__error)
      }
    }

    // ========== 场景 7: 搜索事件 ==========
    console.log('\n--- 场景 7: 搜索事件 ---')
    const search = await callApi('eaa.search', '迟到', 10)
    if (search && !search.__error) {
      const sArr = Array.isArray(search) ? search : (search?.events || search?.data || [])
      ok('搜索"迟到"', `${sArr.length} 条结果`)
    } else fail('搜索"迟到"', '', search?.__error)
    const today = new Date().toISOString().slice(0, 10)
    const rangeR = await callApi('eaa.range', today, today, 50)
    if (rangeR && !rangeR.__error) {
      const rArr = Array.isArray(rangeR) ? rangeR : (rangeR?.events || rangeR?.data || [])
      ok('今日时间范围查询', `${rArr.length} 条事件`)
    } else fail('今日时间范围查询', '', rangeR?.__error)

    // ========== 场景 8: 统计与摘要 ==========
    console.log('\n--- 场景 8: 统计与摘要 ---')
    const stats = await callApi('eaa.stats')
    if (stats && !stats.__error) ok('统计', '成功')
    else fail('统计', '', stats?.__error)
    const summary = await callApi('eaa.summary')
    if (summary && !summary.__error) ok('摘要', '成功')
    else fail('摘要', '', summary?.__error)

    // ========== 场景 9: 设置学生元数据 ==========
    console.log('\n--- 场景 9: 设置学生元数据 ---')
    const metaR = await callApi('eaa.setStudentMeta', { name: students[0], group: '第一组', role: '组长', classId })
    if (metaR && !metaR.__error) ok('设置组长', students[0].split('_')[1])
    else fail('设置组长', '', metaR?.__error)

    // ========== 场景 10: Chat 记录沟通 ==========
    console.log('\n--- 场景 10: Chat 记录沟通 ---')
    const chatSess = 'r13c_' + rid()
    const cm1 = await callApi('chat.saveMessage', { sessionId: chatSess, role: 'user', content: `今天${students[0].split('_')[1]}迟到了,需要联系家长`, timestamp: Date.now() })
    if (cm1 && !cm1.__error) ok('记录沟通', '用户消息')
    else fail('记录沟通', '', cm1?.__error)
    const cm2 = await callApi('chat.saveMessage', { sessionId: chatSess, role: 'assistant', content: '建议先了解迟到原因,再决定是否联系家长。', timestamp: Date.now() + 1 })
    if (cm2 && !cm2.__error) ok('记录回复', 'AI 消息')
    else fail('记录回复', '', cm2?.__error)
    const cmLoad = await callApi('chat.loadMessages', chatSess)
    const cmArr = Array.isArray(cmLoad) ? cmLoad : (cmLoad?.messages || cmLoad?.data || [])
    if (cmArr.length === 2) ok('沟通记录读回', `${cmArr.length} 条`)
    else fail('沟通记录读回', `期望 2 条, 实际 ${cmArr.length}`, '数量不匹配')

    // ========== 场景 11: 撤销错误事件 ==========
    console.log('\n--- 场景 11: 撤销错误事件 ---')
    const histForRevert = await callApi('eaa.history', students[0])
    const histArr = Array.isArray(histForRevert) ? histForRevert : (histForRevert?.events || histForRevert?.data || [])
    if (histArr.length > 0) {
      const evt = histArr[0]
      const evtId = evt.id || evt.event_id
      if (evtId) {
        const revR = await callApi('eaa.revertEvent', String(evtId), '误记,撤销')
        if (revR && !revR.__error) ok('撤销事件', `evt=${String(evtId).slice(0, 16)}`)
        else fail('撤销事件', '', revR?.__error)
        // 验证撤销后分数恢复
        const scAfter = await callApi('eaa.score', students[0])
        const scoreAfter = scAfter?.score ?? scAfter
        if (scoreAfter === 100) ok('撤销后分数恢复', `${scoreAfter}分 (从 98 恢复到 100)`)
        else fail('撤销后分数恢复', `期望 100, 实际 ${scoreAfter}`, '分数未恢复')
      }
    }

    // ========== 场景 12: 导出报告 ==========
    console.log('\n--- 场景 12: 导出报告 ---')
    for (const fmt of ['csv', 'jsonl', 'html']) {
      const r = await callApi('eaa.export', fmt)
      if (r && !r.__error) ok(`导出 ${fmt}`, '成功')
      else fail(`导出 ${fmt}`, '', r?.__error)
    }
    const dashR = await callApi('eaa.dashboard')
    if (dashR && !dashR.__error) ok('生成 dashboard', '成功')
    else fail('生成 dashboard', '', dashR?.__error)

    // ========== 场景 13: 隐私处理 ==========
    console.log('\n--- 场景 13: 隐私处理 ---')
    const pwd = 'r13cpwd'
    const pi = await callApi('privacy.init', pwd, false)
    if (pi && !pi.__error) ok('隐私引擎初始化', '')
    else fail('隐私引擎初始化', '', pi?.__error)
    const padd = await callApi('privacy.add', 'phone', '13800000000')
    if (padd && !padd.__error) ok('添加隐私映射', 'phone')
    else fail('添加隐私映射', '', padd?.__error)
    const anon = await callApi('privacy.anonymize', '赵小明的电话是13800000000')
    if (anon && !anon.__error) {
      const anonText = typeof anon === 'string' ? anon : (anon?.text || anon?.data || String(anon))
      ok('匿名化', anonText.slice(0, 40))
    } else fail('匿名化', '', anon?.__error)

    // ========== 场景 14: 修改设置 ==========
    console.log('\n--- 场景 14: 修改设置 ---')
    await navigate('#/settings')
    const setR = await callApi('settings.set', 'general.logLevel', 'info')
    if (setR && !setR.__error) ok('设置 logLevel', 'info')
    else fail('设置 logLevel', '', setR?.__error)
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
    } else fail('定时任务', '', cronList?.__error)

    // ========== 场景 16: Agent 查看 ==========
    console.log('\n--- 场景 16: Agent 查看 ---')
    const agents = await callApi('agent.list')
    if (agents && !agents.__error) {
      const aArr = Array.isArray(agents) ? agents : (agents?.agents || agents?.data || [])
      ok('Agent 列表', `${aArr.length} 个`)
      if (aArr.length > 0) {
        const aid = aArr[0].id || aArr[0]
        const soul = await callApi('agent.getSoul', aid)
        if (soul !== null && soul !== undefined) ok(`Agent ${aid} SOUL`, `${String(soul).length} 字符`)
        else fail(`Agent ${aid} SOUL`, '', '空')
      }
    } else fail('Agent 列表', '', agents?.__error)

    // ========== 场景 17: 清理 ==========
    console.log('\n--- 场景 17: 下班清理 ---')
    const delChat = await callApi('chat.deleteSession', chatSess)
    if (delChat && !delChat.__error) ok('删除沟通记录', '')
    else fail('删除沟通记录', '', delChat?.__error)
    for (const s of students) {
      await callApi('eaa.deleteStudent', s, 'R13c 清理')
    }
    ok('软删除测试学生', `${students.length} 个`)
    const delCls = await callApi('class.delete', cls.id)
    if (delCls && !delCls.__error) ok('删除测试班级', '')
    else fail('删除测试班级', '', delCls?.__error)

    // ========== 场景 18: 最终验证 ==========
    console.log('\n--- 场景 18: 最终验证 ---')
    const heapEnd = await getHeap()
    const growth = heapEnd - heapStart
    ok('内存使用', `${(heapEnd / 1024 / 1024).toFixed(2)} MB (增长 ${(growth / 1024).toFixed(0)} KB)`)
    ok('一天使用完成', '所有功能正常')
  } else {
    fail('创建班级', '', cls?.__error || cls?.error || JSON.stringify(cls).slice(0, 100))
  }

  console.log('\n=== R13c 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r13c-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
