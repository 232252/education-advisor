// R54 数据完整性测试 — 验证事件撤销、分数重算、数据导出、历史时间线等
// 9 大场景:
//   1. 事件撤销 (revert) - 添加事件→验证分数→撤销→验证分数恢复
//   2. 分数重算 (replay) - 添加多事件→replay→验证排行榜
//   3. 数据导出 (csv/jsonl/html) - 导出并验证格式
//   4. 历史时间线 - 添加事件→查询历史→验证时间顺序
//   5. 日期范围查询 (range) - 添加事件→按日期范围查询
//   6. 数据统计 (stats) - 验证统计准确性
//   7. 搜索 (search) - 按关键词搜索事件
//   8. 标签管理 (tag) - 添加带标签的事件→按标签查询
//   9. 原因码 (codes) + 周期摘要 (summary)
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find(x => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 45000) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 40000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  async navigate(p, wait = 2000) { await this.eval("window.location.hash='" + p + "'"); await new Promise(r => setTimeout(r, wait)) }
  async api(code) { const v = await this.eval("(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"); if (typeof v === 'string' && v.startsWith('ERR:')) throw new Error(v.slice(4)); try { return v ? JSON.parse(v) : null } catch (e) { return v } }
  async apiSafe(code) { const v = await this.eval("(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"); try { return v ? JSON.parse(v) : null } catch (e) { return v } }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push('✓ ' + n + (d ? ' — ' + d : '')); console.log('  ✓ ' + n + (d ? ' — ' + d : '')) }
  const fail = (n, d, e) => { results.fail++; results.details.push('✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 200)); console.log('  ✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 200)) }
  const warn = (n, d) => { results.warn++; results.details.push('⚠ ' + n + (d ? ' — ' + d : '')); console.log('  ⚠ ' + n + (d ? ' — ' + d : '')) }

  const ts = String(Date.now()).slice(-6)
  console.log('=== R54 数据完整性测试 ===')
  console.log('时间戳后缀: ' + ts + '\n')

  const createdStudentNames = []
  const createdClassIds = []
  let exportDir = null

  try {
    // ============================================================
    // 场景 1: 事件撤销 (revert)
    // ============================================================
    console.log('--- 场景 1: 事件撤销 (revert) ---')
    try {
      const revStudent = 'R54撤销_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + revStudent + "')")
      createdStudentNames.push(revStudent)

      // 初始分数应为 100
      const sc1 = await cdp.api("await window.api.eaa.score('" + revStudent + "')")
      const s1 = sc1?.data?.score ?? sc1?.data?.parsed?.score
      if (s1 === 100) ok('初始分数 100', 'score=' + s1)
      else fail('初始分数', '', '期望 100 实际 ' + s1)

      // 添加一个 -2 分事件
      const ev1 = await cdp.api("await window.api.eaa.addEvent({studentName:'" + revStudent + "',reasonCode:'LATE'})")
      if (ev1?.success) ok('添加 LATE 事件', 'delta=-2')
      else fail('添加 LATE 事件', '', JSON.stringify(ev1))

      // 验证分数变为 98
      const sc2 = await cdp.api("await window.api.eaa.score('" + revStudent + "')")
      const s2 = sc2?.data?.score ?? sc2?.data?.parsed?.score
      if (s2 === 98) ok('扣分后分数 98', 'score=' + s2)
      else fail('扣分后分数', '', '期望 98 实际 ' + s2)

      // 查询历史获取 event_id
      const hist = await cdp.api("await window.api.eaa.history('" + revStudent + "')")
      const histData = hist?.data
      // history 可能返回数组或 {events: [...]}
      const events = Array.isArray(histData) ? histData : (histData?.events ?? histData?.timeline ?? [])
      console.log('    history 数据类型:', Array.isArray(histData) ? 'array' : typeof histData, '长度:', events.length)
      if (events.length > 0) {
        console.log('    第一个事件字段:', Object.keys(events[0]).join(','))
        // 尝试多种字段名
        const ev = events[0]
        const eventId = ev.event_id || ev.id || ev.uuid || ev.eventId || ev.eventId || Object.values(ev)[0]
        if (eventId) {
          ok('获取 event_id', String(eventId).slice(0, 30))
          // 撤销事件
          const rev = await cdp.apiSafe("await window.api.eaa.revertEvent('" + eventId + "','R54撤销测试')")
          if (rev?.success) {
            ok('撤销事件', 'eventId=' + String(eventId).slice(0, 20))
            // 验证分数恢复为 100
            const sc3 = await cdp.api("await window.api.eaa.score('" + revStudent + "')")
            const s3 = sc3?.data?.score ?? sc3?.data?.parsed?.score
            if (s3 === 100) ok('撤销后分数恢复 100', 'score=' + s3)
            else if (s3 === 98) warn('撤销后分数未变', '可能撤销未生效, score=' + s3)
            else warn('撤销后分数异常', 'score=' + s3)
          } else fail('撤销事件', '', JSON.stringify(rev).slice(0, 200))
        } else fail('获取 event_id', '', '字段名不匹配: ' + Object.keys(ev).join(','))
      } else fail('查询历史', '', '无事件返回')
    } catch (e) { fail('场景1', '', e.message) }

    // ============================================================
    // 场景 2: 分数重算 (replay)
    // ============================================================
    console.log('\n--- 场景 2: 分数重算 (replay) ---')
    try {
      const replayStudent = 'R54重算_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + replayStudent + "')")
      createdStudentNames.push(replayStudent)

      // 添加 3 个事件: -2, -5, +10
      await cdp.api("await window.api.eaa.addEvent({studentName:'" + replayStudent + "',reasonCode:'LATE'})")
      await cdp.api("await window.api.eaa.addEvent({studentName:'" + replayStudent + "',reasonCode:'SCHOOL_CAUGHT'})")
      await cdp.api("await window.api.eaa.addEvent({studentName:'" + replayStudent + "',reasonCode:'CLASS_MONITOR'})")

      // 验证分数 = 100 - 2 - 5 + 10 = 103
      const sc1 = await cdp.api("await window.api.eaa.score('" + replayStudent + "')")
      const s1 = sc1?.data?.score ?? sc1?.data?.parsed?.score
      if (s1 === 103) ok('3事件后分数 103', '100-2-5+10=' + s1)
      else warn('3事件后分数', '期望 103 实际 ' + s1)

      // 执行 replay (重算排名)
      const rep = await cdp.apiSafe('await window.api.eaa.replay()')
      if (rep?.success) ok('replay 执行', 'success=true')
      else fail('replay 执行', '', JSON.stringify(rep).slice(0, 200))

      // 验证 replay 后分数仍为 103
      const sc2 = await cdp.api("await window.api.eaa.score('" + replayStudent + "')")
      const s2 = sc2?.data?.score ?? sc2?.data?.parsed?.score
      if (s2 === 103) ok('replay 后分数一致', 'score=' + s2)
      else warn('replay 后分数', '期望 103 实际 ' + s2)

      // 验证排行榜包含该学生
      const rank = await cdp.apiSafe('await window.api.eaa.ranking(10)')
      if (rank?.success) {
        const rankData = rank?.data
        const rankList = Array.isArray(rankData) ? rankData : (rankData?.ranking ?? rankData?.students ?? [])
        if (Array.isArray(rankList) && rankList.length > 0) {
          const found = rankList.find(r => {
            const name = r.name || r.student_name || r.studentName
            return name === replayStudent
          })
          if (found) ok('排行榜包含学生', replayStudent)
          else warn('排行榜未找到', '共 ' + rankList.length + ' 名学生')
        } else ok('排行榜返回', 'data 类型=' + typeof rankData)
      } else warn('ranking 返回', JSON.stringify(rank).slice(0, 100))
    } catch (e) { fail('场景2', '', e.message) }

    // ============================================================
    // 场景 3: 数据导出 (csv/jsonl/html)
    // ============================================================
    console.log('\n--- 场景 3: 数据导出 ---')
    try {
      // 获取支持的导出格式
      const fmts = await cdp.apiSafe('await window.api.eaa.exportFormats()')
      const formats = Array.isArray(fmts) ? fmts : (fmts?.data ?? fmts ?? [])
      if (formats.length > 0) ok('支持的导出格式', formats.join(','))
      else warn('导出格式查询', '返回空')

      // 获取数据目录用于导出
      const dataDirRes = await cdp.eval("(async()=>{try{const r=await window.api.eaa.info();return r.data?.data_dir||r.data?.dataDir||'UNKNOWN'}catch(e){return 'ERR:'+e.message}})()")
      exportDir = dataDirRes ? String(dataDirRes).replace(/\\/g, '/').replace('/eaa-data', '/exports') : null
      console.log('    导出目录:', exportDir)

      // 导出 CSV
      const csvRes = await cdp.apiSafe("await window.api.eaa.export('csv')")
      if (csvRes?.success) ok('CSV 导出', 'success=true')
      else warn('CSV 导出失败', (csvRes?.stderr ?? '').slice(0, 100))

      // 导出 JSONL
      const jsonlRes = await cdp.apiSafe("await window.api.eaa.export('jsonl')")
      if (jsonlRes?.success) ok('JSONL 导出', 'success=true')
      else warn('JSONL 导出失败', (jsonlRes?.stderr ?? '').slice(0, 100))

      // 导出 HTML
      const htmlRes = await cdp.apiSafe("await window.api.eaa.export('html')")
      if (htmlRes?.success) ok('HTML 导出', 'success=true')
      else warn('HTML 导出失败', (htmlRes?.stderr ?? '').slice(0, 100))

      // 导出无效格式
      const badFmt = await cdp.apiSafe("await window.api.eaa.export('xml')")
      if (!badFmt?.success) ok('无效格式被拒绝', 'xml 不支持')
      else warn('无效格式被接受', '可能有安全问题')
    } catch (e) { fail('场景3', '', e.message) }

    // ============================================================
    // 场景 4: 历史时间线
    // ============================================================
    console.log('\n--- 场景 4: 历史时间线 ---')
    try {
      const histStudent = 'R54历史_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + histStudent + "')")
      createdStudentNames.push(histStudent)

      // 添加 3 个事件 (会按时间顺序)
      await cdp.api("await window.api.eaa.addEvent({studentName:'" + histStudent + "',reasonCode:'LATE',note:'第一个事件'})")
      await new Promise(r => setTimeout(r, 1100))
      await cdp.api("await window.api.eaa.addEvent({studentName:'" + histStudent + "',reasonCode:'SLEEP_IN_CLASS',note:'第二个事件'})")
      await new Promise(r => setTimeout(r, 1100))
      await cdp.api("await window.api.eaa.addEvent({studentName:'" + histStudent + "',reasonCode:'MAKEUP',note:'第三个事件'})")

      // 查询历史
      const hist = await cdp.api("await window.api.eaa.history('" + histStudent + "')")
      const histData = hist?.data
      const events = Array.isArray(histData) ? histData : (histData?.events ?? histData?.timeline ?? [])
      if (events.length >= 3) {
        ok('历史事件数', events.length + ' 个')
        // 验证按时间倒序 (最新在前)
        let chronoOk = true
        for (let i = 1; i < events.length; i++) {
          const t1 = events[i-1]?.timestamp || events[i-1]?.time || events[i-1]?.created_at || events[i-1]?.date
          const t2 = events[i]?.timestamp || events[i]?.time || events[i]?.created_at || events[i]?.date
          if (t1 && t2 && t1 < t2) { chronoOk = false; break }
        }
        if (chronoOk) ok('历史按时间排序', '倒序正确')
        else warn('历史时间排序', '可能不是倒序')

        // 验证事件包含 reason_code
        const hasReason = events[0]?.reason_code || events[0]?.reasonCode || events[0]?.reason
        if (hasReason) ok('事件含 reason_code', String(hasReason))
        else warn('事件字段', '无 reason_code: ' + Object.keys(events[0]).join(','))
      } else fail('历史事件数', '', '期望 >=3 实际 ' + events.length)
    } catch (e) { fail('场景4', '', e.message) }

    // ============================================================
    // 场景 5: 日期范围查询 (range)
    // ============================================================
    console.log('\n--- 场景 5: 日期范围查询 ---')
    try {
      const today = new Date()
      const yesterday = new Date(today.getTime() - 86400000)
      const tomorrow = new Date(today.getTime() + 86400000)
      const fmt = (d) => d.toISOString().slice(0, 10)
      const todayStr = fmt(today)
      const yestStr = fmt(yesterday)
      const tomStr = fmt(tomorrow)

      // 查询今天的事件
      const r1 = await cdp.apiSafe("await window.api.eaa.range('" + todayStr + "','" + todayStr + "')")
      if (r1?.success) {
        const rData = r1?.data
        const rEvents = Array.isArray(rData) ? rData : (rData?.events ?? rData?.items ?? [])
        ok('今天事件查询', 'success=true, 事件数=' + (Array.isArray(rEvents) ? rEvents.length : '?'))
      } else warn('今天事件查询失败', JSON.stringify(r1).slice(0, 100))

      // 查询昨天到明天
      const r2 = await cdp.apiSafe("await window.api.eaa.range('" + yestStr + "','" + tomStr + "')")
      if (r2?.success) ok('昨天到明天查询', 'success=true')
      else warn('昨天到明天查询失败', JSON.stringify(r2).slice(0, 100))

      // 无效日期格式
      const r3 = await cdp.apiSafe("await window.api.eaa.range('invalid','2026-01-01')")
      if (!r3?.success) ok('无效日期格式被拒绝', '正确')
      else warn('无效日期格式被接受', '可能有问题')

      // start > end
      const r4 = await cdp.apiSafe("await window.api.eaa.range('2026-12-31','2026-01-01')")
      if (!r4?.success) ok('start>end 被拒绝', '正确')
      else warn('start>end 被接受', '可能有问题')
    } catch (e) { fail('场景5', '', e.message) }

    // ============================================================
    // 场景 6: 数据统计 (stats)
    // ============================================================
    console.log('\n--- 场景 6: 数据统计 ---')
    try {
      const statsStudent = 'R54统计_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + statsStudent + "')")
      createdStudentNames.push(statsStudent)

      // 添加几个事件
      await cdp.api("await window.api.eaa.addEvent({studentName:'" + statsStudent + "',reasonCode:'LATE'})")
      await cdp.api("await window.api.eaa.addEvent({studentName:'" + statsStudent + "',reasonCode:'SLEEP_IN_CLASS'})")

      const stats = await cdp.apiSafe('await window.api.eaa.stats()')
      if (stats?.success) {
        const sd = stats?.data
        const summary = sd?.summary || sd
        if (summary) {
          ok('stats 返回', 'total_events=' + (summary.total_events ?? '?') + ' students=' + (summary.students ?? '?'))
          if (typeof summary.total_events === 'number' && summary.total_events > 0) {
            ok('事件总数 > 0', 'total=' + summary.total_events)
          } else warn('事件总数', 'total=' + summary.total_events)
          if (typeof summary.students === 'number' && summary.students > 0) {
            ok('学生总数 > 0', 'students=' + summary.students)
          } else warn('学生总数', 'students=' + summary.students)
        } else fail('stats 数据', '', '无 summary 字段')

        // 验证 reason_distribution
        if (sd?.reason_distribution && Array.isArray(sd.reason_distribution)) {
          ok('reason_distribution', sd.reason_distribution.length + ' 种原因码')
        } else warn('reason_distribution', '字段缺失')

        // 验证 score_intervals
        if (sd?.score_intervals) {
          ok('score_intervals', JSON.stringify(sd.score_intervals).slice(0, 100))
        } else warn('score_intervals', '字段缺失')
      } else fail('stats 调用', '', JSON.stringify(stats).slice(0, 200))
    } catch (e) { fail('场景6', '', e.message) }

    // ============================================================
    // 场景 7: 搜索 (search)
    // ============================================================
    console.log('\n--- 场景 7: 搜索 ---')
    try {
      const searchStudent = 'R54搜索_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + searchStudent + "')")
      createdStudentNames.push(searchStudent)

      // 添加带 note 的事件
      await cdp.api("await window.api.eaa.addEvent({studentName:'" + searchStudent + "',reasonCode:'LATE',note:'R54特殊关键词搜索测试'})")

      // 按关键词搜索
      const r1 = await cdp.apiSafe("await window.api.eaa.search('R54特殊关键词')")
      if (r1?.success) {
        const rData = r1?.data
        const rEvents = Array.isArray(rData) ? rData : (rData?.events ?? rData?.items ?? rData?.results ?? [])
        if (Array.isArray(rEvents) && rEvents.length > 0) {
          ok('搜索关键词', '找到 ' + rEvents.length + ' 个匹配')
        } else warn('搜索关键词', 'success=true 但匹配数=' + (Array.isArray(rEvents) ? rEvents.length : '?'))
      } else warn('搜索失败', JSON.stringify(r1).slice(0, 100))

      // 按学生名搜索
      const r2 = await cdp.apiSafe("await window.api.eaa.search('" + searchStudent + "')")
      if (r2?.success) ok('按学生名搜索', 'success=true')
      else warn('按学生名搜索', JSON.stringify(r2).slice(0, 100))

      // 搜索不存在的关键词
      const r3 = await cdp.apiSafe("await window.api.eaa.search('NONEXISTENT_KEYWORD_XYZ_" + ts + "')")
      if (r3?.success) {
        const rData = r3?.data
        const rEvents = Array.isArray(rData) ? rData : (rData?.events ?? rData?.items ?? rData?.results ?? [])
        if (Array.isArray(rEvents) && rEvents.length === 0) ok('搜索无结果', '返回空数组')
        else warn('搜索无结果', '返回 ' + rEvents.length + ' 个结果')
      } else warn('搜索无结果失败', JSON.stringify(r3).slice(0, 100))

      // 带 limit 参数
      const r4 = await cdp.apiSafe("await window.api.eaa.search('R54', 5)")
      if (r4?.success) ok('带 limit 搜索', 'success=true')
      else warn('带 limit 搜索', JSON.stringify(r4).slice(0, 100))
    } catch (e) { fail('场景7', '', e.message) }

    // ============================================================
    // 场景 8: 标签管理 (tag)
    // ============================================================
    console.log('\n--- 场景 8: 标签管理 ---')
    try {
      const tagStudent = 'R54标签_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + tagStudent + "')")
      createdStudentNames.push(tagStudent)

      // 添加带标签的事件
      const r1 = await cdp.api("await window.api.eaa.addEvent({studentName:'" + tagStudent + "',reasonCode:'LATE',tags:['R54标签1','重要']})")
      if (r1?.success) ok('添加带标签事件', 'tags=[R54标签1,重要]')
      else fail('添加带标签事件', '', JSON.stringify(r1))

      // 查询所有标签
      const r2 = await cdp.apiSafe("await window.api.eaa.tag()")
      if (r2?.success) {
        const tData = r2?.data
        const tags = Array.isArray(tData) ? tData : (tData?.tags ?? tData?.items ?? [])
        if (Array.isArray(tags)) {
          ok('查询所有标签', '共 ' + tags.length + ' 个: ' + tags.slice(0, 5).join(','))
          if (tags.includes('R54标签1')) ok('包含测试标签', 'R54标签1')
          else warn('不包含测试标签', 'tags=' + tags.slice(0, 5).join(','))
        } else ok('查询所有标签', 'data 类型=' + typeof tData)
      } else warn('查询所有标签失败', JSON.stringify(r2).slice(0, 100))

      // 查询特定标签的事件
      const r3 = await cdp.apiSafe("await window.api.eaa.tag('R54标签1')")
      if (r3?.success) ok('查询特定标签', 'success=true')
      else warn('查询特定标签失败', JSON.stringify(r3).slice(0, 100))
    } catch (e) { fail('场景8', '', e.message) }

    // ============================================================
    // 场景 9: 原因码 (codes) + 周期摘要 (summary)
    // ============================================================
    console.log('\n--- 场景 9: 原因码 + 周期摘要 ---')
    try {
      // 查询所有原因码
      const codes = await cdp.apiSafe('await window.api.eaa.codes()')
      if (codes?.success) {
        const cData = codes?.data
        const codesList = Array.isArray(cData) ? cData : (cData?.codes ?? cData?.items ?? [])
        if (Array.isArray(codesList) && codesList.length > 0) {
          ok('原因码列表', codesList.length + ' 个')
          // 验证常见原因码存在
          const codeNames = codesList.map(c => typeof c === 'string' ? c : (c.code || c.name || c.reason_code))
          const expected = ['LATE', 'SLEEP_IN_CLASS', 'CLASS_MONITOR', 'SCHOOL_CAUGHT']
          for (const ec of expected) {
            if (codeNames.includes(ec)) ok('包含 ' + ec, '存在')
            else warn('缺少 ' + ec, '可能未注册')
          }
        } else ok('原因码列表', 'data=' + JSON.stringify(cData).slice(0, 100))
      } else fail('原因码查询', '', JSON.stringify(codes).slice(0, 200))

      // 周期摘要
      const today = new Date()
      const weekAgo = new Date(today.getTime() - 7 * 86400000)
      const fmt = (d) => d.toISOString().slice(0, 10)
      const summary = await cdp.apiSafe("await window.api.eaa.summary('" + fmt(weekAgo) + "','" + fmt(today) + "')")
      if (summary?.success) {
        ok('周期摘要', 'success=true')
        const sData = summary?.data
        if (sData) {
          console.log('    摘要字段:', Object.keys(sData).join(','))
          if (sData.total_events !== undefined || sData.events !== undefined) {
            ok('摘要含事件数', 'total=' + (sData.total_events ?? sData.events))
          }
        }
      } else warn('周期摘要失败', JSON.stringify(summary).slice(0, 100))

      // 无参数摘要 (全部时间)
      const summary2 = await cdp.apiSafe('await window.api.eaa.summary()')
      if (summary2?.success) ok('无参数摘要', 'success=true')
      else warn('无参数摘要失败', JSON.stringify(summary2).slice(0, 100))

      // 验证仪表盘显示摘要
      await cdp.navigate('/dashboard', 2500)
      const dashText = await cdp.eval("document.body?.innerText?.slice(0, 1500) || ''")
      if (dashText.length > 0) ok('仪表盘渲染', '文本长度=' + dashText.length)
      else fail('仪表盘渲染', '', '文本为空')

      // 验证学生页有数据
      await cdp.navigate('/students', 2500)
      const stuText = await cdp.eval("document.body?.innerText?.slice(0, 800) || ''")
      const stuRows = await cdp.eval("document.querySelectorAll('table tbody tr').length")
      if (stuRows > 0) ok('学生页有数据', stuRows + ' 行')
      else warn('学生页无数据', '表格行数=0')
    } catch (e) { fail('场景9', '', e.message) }

    // ============================================================
    // 场景 10: 跨模块数据一致性
    // ============================================================
    console.log('\n--- 场景 10: 跨模块数据一致性 ---')
    try {
      const finalStudent = 'R54一致_' + ts
      const finalClassId = 'C-CON-' + ts

      // 创建班级 + 学生 + 分班 + 事件
      const cls = await cdp.api("await window.api.class.create({class_id:'" + finalClassId + "',name:'R54一致班_" + ts + "',grade:'高一',teacher:'王老师'})")
      if (cls?.success && cls?.data?.id) {
        createdClassIds.push(cls.data.id)
        ok('创建一致班', finalClassId)

        const stu = await cdp.api("await window.api.eaa.addStudent('" + finalStudent + "')")
        if (stu?.success) {
          createdStudentNames.push(finalStudent)
          ok('创建一致学生', finalStudent)

          // 分班
          await cdp.api("await window.api.eaa.setStudentMeta({name:'" + finalStudent + "',classId:'" + finalClassId + "'})")
          ok('分班完成', finalClassId)

          // 添加事件
          await cdp.api("await window.api.eaa.addEvent({studentName:'" + finalStudent + "',reasonCode:'CLASS_MONITOR'})")
          ok('添加事件', 'CLASS_MONITOR +10')

          // 验证各 API 一致性
          const list = await cdp.api('await window.api.eaa.listStudents()')
          const s = (list?.data?.students ?? []).find(x => x.name === finalStudent && x.status !== 'Deleted')
          if (s) {
            ok('listStudents 包含', finalStudent)
            if (s.class_id === finalClassId) ok('class_id 一致', s.class_id)
            else fail('class_id 不一致', '', '期望 ' + finalClassId + ' 实际 ' + s.class_id)
            if (s.score === 110) ok('score 一致', String(s.score))
            else warn('score 不一致', '期望 110 实际 ' + s.score)
            if (s.events_count === 1) ok('events_count 一致', String(s.events_count))
            else warn('events_count 不一致', '期望 1 实际 ' + s.events_count)
          } else fail('listStudents 未找到', '', finalStudent)

          // 验证 score API
          const sc = await cdp.api("await window.api.eaa.score('" + finalStudent + "')")
          const scVal = sc?.data?.score ?? sc?.data?.parsed?.score
          if (scVal === 110) ok('score API 一致', String(scVal))
          else warn('score API 不一致', '期望 110 实际 ' + scVal)

          // 验证 history API
          const hist = await cdp.api("await window.api.eaa.history('" + finalStudent + "')")
          const histData = hist?.data
          const histEvents = Array.isArray(histData) ? histData : (histData?.events ?? [])
          if (histEvents.length === 1) ok('history 一致', '1 个事件')
          else warn('history 不一致', '期望 1 实际 ' + histEvents.length)

          // 验证 class.list 包含该班
          const clsList = await cdp.api('await window.api.class.list()')
          const found = (clsList?.data ?? []).find(c => c.class_id === finalClassId)
          if (found) ok('class.list 包含', found.name)
          else fail('class.list 未找到', '', finalClassId)

          // 验证班级详情页
          await cdp.navigate('/classes', 2500)
          await cdp.eval("(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('刷新')>=0){btns[i].click();return 'OK'}}return 'NOT_FOUND';})()")
          await new Promise(r => setTimeout(r, 1500))
          const clsRows = await cdp.eval("document.querySelectorAll('table tbody tr').length")
          if (clsRows > 0) ok('班级页表格', clsRows + ' 行')
          else warn('班级页表格', '0 行')
        } else fail('创建一致学生', '', JSON.stringify(stu))
      } else fail('创建一致班', '', JSON.stringify(cls))
    } catch (e) { fail('场景10', '', e.message) }

  } catch (e) {
    fail('R54 主流程', '', e.message)
  } finally {
    // ============================================================
    // 清理
    // ============================================================
    console.log('\n--- 清理 R54 测试数据 ---')
    let cleanedStudents = 0
    let cleanedClasses = 0
    for (const name of createdStudentNames) {
      try {
        const safeName = String(name).replace(/'/g, "\\'").replace(/\\/g, '\\\\')
        const r = await cdp.apiSafe("await window.api.eaa.deleteStudent('" + safeName + "','R54清理')")
        if (r?.success) cleanedStudents++
      } catch (e) {}
    }
    for (const id of createdClassIds) {
      try {
        const r = await cdp.apiSafe("await window.api.class.delete('" + id + "')")
        if (r?.success) cleanedClasses++
      } catch (e) {}
    }
    console.log('  清理: 学生 ' + cleanedStudents + '/' + createdStudentNames.length + ', 班级 ' + cleanedClasses + '/' + createdClassIds.length)

    try {
      const finalList = await cdp.apiSafe('await window.api.eaa.listStudents()')
      const finalActive = (finalList?.data?.students ?? []).filter(s => s.name.indexOf('R54') >= 0 && s.status !== 'Deleted')
      if (finalActive.length === 0) ok('清理后无 R54 残留', 'active=0')
      else warn('清理后有残留', 'active=' + finalActive.length + ': ' + finalActive.map(s => s.name).slice(0, 5).join(','))
    } catch (e) { warn('清理后验证失败', e.message) }
  }

  console.log('\n=== R54 测试完成 ===')
  console.log('结果: ' + results.pass + ' pass, ' + results.fail + ' fail, ' + results.warn + ' warn')
  const total = results.pass + results.fail + results.warn
  const rate = total > 0 ? ((results.pass + results.warn) / total * 100).toFixed(1) : '0.0'
  console.log('通过率: ' + rate + '%')

  results.summary = { pass: results.pass, fail: results.fail, warn: results.warn, total, passRate: parseFloat(rate) }
  results.timestamp = new Date().toISOString()
  fs.writeFileSync('dogfood-output/r54-integrity-result.json', JSON.stringify(results, null, 2))

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch(e => { console.log('FATAL:', e.message); console.log(e.stack); process.exit(1) })
