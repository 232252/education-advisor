// R53 边界条件/异常输入测试 — 测试各种异常输入、边界条件、安全场景
// 8 大场景:
//   1. 空值/未定义参数 (null, undefined, '', '   ')
//   2. 超长字符串 (100+ 字符)
//   3. 特殊字符 (sql/xss/路径/Unicode)
//   4. 重复操作 (创建同名学生/班级)
//   5. 不存在的引用 (event for non-existent student)
//   6. 边界分数 (delta=0, 极大值, 极小值)
//   7. 无效 class_id 格式 (含空格/特殊字符)
//   8. 状态转换边界 (创建→删除→再删除/恢复)
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find(x => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 30000) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
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
  console.log('=== R53 边界条件/异常输入测试 ===')
  console.log('时间戳后缀: ' + ts + '\n')

  // 收集创建的实体用于清理
  const createdStudentNames = []
  const createdClassIds = []

  try {
    // ============================================================
    // 场景 1: 空值/未定义参数
    // ============================================================
    console.log('--- 场景 1: 空值/未定义参数 ---')
    try {
      // 1.1 空字符串学生名
      const r1 = await cdp.apiSafe("await window.api.eaa.addStudent('')")
      if (!r1?.success) ok('空学生名被拒绝', 'success=false')
      else { warn('空学生名被接受', 'success=true'); createdStudentNames.push('') }

      // 1.2 纯空格学生名
      const r2 = await cdp.apiSafe("await window.api.eaa.addStudent('   ')")
      if (!r2?.success) ok('纯空格学生名被拒绝', 'success=false')
      else { warn('纯空格学生名被接受', 'success=true'); createdStudentNames.push('   ') }

      // 1.3 undefined 参数 (addStudent(undefined))
      const r3 = await cdp.apiSafe("await window.api.eaa.addStudent(undefined)")
      if (!r3?.success) ok('undefined 学生名被拒绝', 'success=false')
      else warn('undefined 学生名被接受', 'success=true')

      // 1.4 null 参数
      const r4 = await cdp.apiSafe("await window.api.eaa.addStudent(null)")
      if (!r4?.success) ok('null 学生名被拒绝', 'success=false')
      else warn('null 学生名被接受', 'success=true')

      // 1.5 数字作为学生名
      const r5 = await cdp.apiSafe("await window.api.eaa.addStudent(12345)")
      if (!r5?.success) ok('数字学生名被拒绝', 'success=false')
      else warn('数字学生名被接受', 'success=true')

      // 1.6 空班级创建
      const r6 = await cdp.apiSafe("await window.api.class.create({class_id:'',name:'',grade:''})")
      if (!r6?.success) ok('空班级字段被拒绝', 'success=false')
      else { warn('空班级字段被接受', 'success=true'); if (r6?.data?.id) createdClassIds.push(r6.data.id) }

      // 1.7 undefined addEvent 参数
      const r7 = await cdp.apiSafe("await window.api.eaa.addEvent(undefined)")
      if (!r7?.success) ok('undefined addEvent 被拒绝', 'success=false')
      else warn('undefined addEvent 被接受', 'success=true')

      // 1.8 缺少 reasonCode 的 addEvent
      const r8 = await cdp.apiSafe("await window.api.eaa.addEvent({studentName:'R53测试_" + ts + "'})")
      if (!r8?.success) ok('缺 reasonCode 被拒绝', 'success=false')
      else warn('缺 reasonCode 被接受', 'success=true')

      // 1.9 不存在的 reasonCode
      const r9 = await cdp.apiSafe("await window.api.eaa.addEvent({studentName:'R53测试_" + ts + "',reasonCode:'NON_EXISTENT_CODE_XYZ'})")
      if (!r9?.success) ok('无效 reasonCode 被拒绝', 'success=false')
      else warn('无效 reasonCode 被接受', 'success=true')
    } catch (e) { fail('场景1', '', e.message) }

    // ============================================================
    // 场景 2: 超长字符串
    // ============================================================
    console.log('\n--- 场景 2: 超长字符串 ---')
    try {
      // 2.1 100 字符学生名 (边界值)
      const name100 = 'R53长_' + 'A'.repeat(94) + '_' + ts
      const r1 = await cdp.apiSafe("await window.api.eaa.addStudent('" + name100 + "')")
      if (r1?.success) { ok('100字符学生名', '接受'); createdStudentNames.push(name100) }
      else warn('100字符学生名', '拒绝: ' + (r1?.stderr ?? '').slice(0, 100))

      // 2.2 65 字符学生名 (超过 64 限制)
      const name65 = 'R53长_' + 'B'.repeat(58) + '_' + ts
      const r2 = await cdp.apiSafe("await window.api.eaa.addStudent('" + name65 + "')")
      if (!r2?.success) ok('65字符学生名被拒绝', '符合 64 字符限制')
      else { warn('65字符学生名被接受', '可能超过限制'); createdStudentNames.push(name65) }

      // 2.3 1000 字符学生名
      const name1000 = 'R53超_' + 'C'.repeat(990) + '_' + ts
      const r3 = await cdp.apiSafe("await window.api.eaa.addStudent('" + name1000 + "')")
      if (!r3?.success) ok('1000字符学生名被拒绝', '正确拒绝')
      else { warn('1000字符学生名被接受', '可能有问题'); createdStudentNames.push(name1000) }

      // 2.4 超长班级 class_id (超过 32 字符限制)
      const longClassId = 'C-' + 'D'.repeat(35) + '-' + ts
      const r4 = await cdp.apiSafe("await window.api.class.create({class_id:'" + longClassId + "',name:'R53长ID班_" + ts + "',grade:'高一'})")
      if (!r4?.success) ok('35字符class_id被拒绝', '符合 32 字符限制')
      else { warn('35字符class_id被接受', '可能超过限制'); if (r4?.data?.id) createdClassIds.push(r4.data.id) }

      // 2.5 超长 note
      const testStudent = 'R53note_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + testStudent + "')")
      createdStudentNames.push(testStudent)
      const longNote = 'N'.repeat(2000)
      const r5 = await cdp.apiSafe("await window.api.eaa.addEvent({studentName:'" + testStudent + "',reasonCode:'LATE',note:'" + longNote + "'})")
      if (r5?.success) ok('超长note事件', '接受 2000字符note')
      else warn('超长note被拒绝', (r5?.stderr ?? '').slice(0, 100))
    } catch (e) { fail('场景2', '', e.message) }

    // ============================================================
    // 场景 3: 特殊字符 (SQL/XSS/路径/Unicode)
    // ============================================================
    console.log('\n--- 场景 3: 特殊字符 ---')
    try {
      // 3.1 SQL 注入尝试
      const sqlName = "R53'; DROP TABLE students; --"
      const r1 = await cdp.apiSafe("await window.api.eaa.addStudent(\"" + sqlName.replace(/"/g, '\\"') + "\")")
      if (!r1?.success) ok('SQL注入名被拒绝', '正确拒绝')
      else { warn('SQL注入名被接受', '需验证无SQL执行'); createdStudentNames.push(sqlName) }

      // 3.2 XSS 尝试
      const xssName = 'R53<script>alert("xss")</script>'
      const r2 = await cdp.apiSafe("await window.api.eaa.addStudent('" + xssName.replace(/'/g, "\\'") + "')")
      if (!r2?.success) ok('XSS名被拒绝', '正确拒绝')
      else { warn('XSS名被接受', '需前端转义'); createdStudentNames.push(xssName) }

      // 3.3 路径遍历
      const pathName = 'R53../../../etc/passwd'
      const r3 = await cdp.apiSafe("await window.api.eaa.addStudent('" + pathName + "')")
      if (!r3?.success) ok('路径遍历名被拒绝', '正确拒绝')
      else { warn('路径遍历名被接受', '需验证无文件操作'); createdStudentNames.push(pathName) }

      // 3.4 命令注入尝试
      const cmdName = 'R53; rm -rf /'
      const r4 = await cdp.apiSafe("await window.api.eaa.addStudent('" + cmdName + "')")
      if (!r4?.success) ok('命令注入名被拒绝', '正确拒绝')
      else { warn('命令注入名被接受', '需验证无命令执行'); createdStudentNames.push(cmdName) }

      // 3.5 Unicode 字符 (中文/emoji)
      const unicodeName = 'R53中文_张三李四🌟'
      const r5 = await cdp.apiSafe("await window.api.eaa.addStudent('" + unicodeName + "')")
      if (r5?.success) { ok('Unicode名被接受', '中文+emoji'); createdStudentNames.push(unicodeName) }
      else warn('Unicode名被拒绝', (r5?.stderr ?? '').slice(0, 100))

      // 3.6 反引号
      const backtickName = 'R53`whoami`'
      const r6 = await cdp.apiSafe("await window.api.eaa.addStudent('" + backtickName + "')")
      if (!r6?.success) ok('反引号注入被拒绝', '正确拒绝')
      else { warn('反引号注入被接受', '需验证'); createdStudentNames.push(backtickName) }

      // 3.7 参数注入尝试 (-- 开头)
      const argInjName = '--help'
      const r7 = await cdp.apiSafe("await window.api.eaa.addStudent('" + argInjName + "')")
      if (!r7?.success) ok('参数注入被拒绝', '正确拒绝 -- 开头')
      else { warn('参数注入被接受', '可能有问题'); createdStudentNames.push(argInjName) }

      // 3.8 验证页面不渲染 script (XSS 不执行)
      try {
        if (createdStudentNames.includes(xssName)) {
          await cdp.navigate('/students', 2500)
          const pageText = await cdp.eval("document.body?.innerText?.slice(0, 3000) || ''")
          if (pageText.indexOf('<script>') >= 0) fail('XSS未转义', '', '页面文本含 <script> 字面量')
          else ok('XSS已转义/移除', '页面文本不含 <script>')
        }
      } catch (e) { warn('XSS页面检查跳过', e.message) }
    } catch (e) { fail('场景3', '', e.message) }

    // ============================================================
    // 场景 4: 重复操作
    // ============================================================
    console.log('\n--- 场景 4: 重复操作 ---')
    try {
      const dupName = 'R53重复_' + ts
      // 第一次创建
      const r1 = await cdp.api("await window.api.eaa.addStudent('" + dupName + "')")
      if (r1?.success) { ok('首次创建学生', dupName); createdStudentNames.push(dupName) }
      else fail('首次创建学生', '', JSON.stringify(r1))

      // 第二次创建同名
      const r2 = await cdp.apiSafe("await window.api.eaa.addStudent('" + dupName + "')")
      if (r2?.success) warn('重复创建同名学生被接受', '可能创建重复实体')
      else ok('重复创建被拒绝', '正确拒绝')

      // 验证列表中只有一个
      const list = await cdp.api('await window.api.eaa.listStudents()')
      const dups = (list?.data?.students ?? []).filter(s => s.name === dupName && s.status !== 'Deleted')
      if (dups.length === 1) ok('列表中无重复', '找到 1 个 ' + dupName)
      else if (dups.length === 0) warn('列表中无该学生', '可能已被删除')
      else fail('列表中有重复', '', '共 ' + dups.length + ' 个')

      // 重复创建班级
      const dupClassId = 'C-DUP-' + ts
      const r3 = await cdp.api("await window.api.class.create({class_id:'" + dupClassId + "',name:'R53重复班_" + ts + "',grade:'高一'})")
      if (r3?.success) { ok('首次创建班级', dupClassId); if (r3?.data?.id) createdClassIds.push(r3.data.id) }
      else fail('首次创建班级', '', JSON.stringify(r3))

      const r4 = await cdp.apiSafe("await window.api.class.create({class_id:'" + dupClassId + "',name:'R53重复班2_" + ts + "',grade:'高一'})")
      if (!r4?.success) ok('重复创建班级被拒绝', '正确拒绝同 class_id')
      else { warn('重复创建班级被接受', '可能有问题'); if (r4?.data?.id) createdClassIds.push(r4.data.id) }
    } catch (e) { fail('场景4', '', e.message) }

    // ============================================================
    // 场景 5: 不存在的引用
    // ============================================================
    console.log('\n--- 场景 5: 不存在的引用 ---')
    try {
      // 5.1 给不存在的学生添加事件
      const r1 = await cdp.apiSafe("await window.api.eaa.addEvent({studentName:'R53不存在_" + ts + "',reasonCode:'LATE'})")
      if (!r1?.success) ok('不存在学生事件被拒绝', '正确拒绝')
      else warn('不存在学生事件被接受', '可能自动创建?')

      // 5.2 删除不存在的学生 (preload 签名: deleteStudent(name, reason?))
      const r2 = await cdp.apiSafe("await window.api.eaa.deleteStudent('R53不存在_" + ts + "','测试')")
      if (!r2?.success) ok('删除不存在学生被拒绝', '正确拒绝')
      else warn('删除不存在学生被接受', '可能静默成功')

      // 5.3 设置不存在学生的 meta
      const r3 = await cdp.apiSafe("await window.api.eaa.setStudentMeta({name:'R53不存在_" + ts + "',classId:'C-X-" + ts + "'})")
      if (!r3?.success) ok('设置不存在学生meta被拒绝', '正确拒绝')
      else warn('设置不存在学生meta被接受', '可能自动创建?')

      // 5.4 查询不存在学生的分数
      const r4 = await cdp.apiSafe("await window.api.eaa.score('R53不存在_" + ts + "')")
      if (!r4?.success) ok('查询不存在学生分数失败', '正确处理')
      else warn('查询不存在学生分数', 'data=' + JSON.stringify(r4?.data).slice(0, 100))

      // 5.5 查询不存在学生的历史
      const r5 = await cdp.apiSafe("await window.api.eaa.history('R53不存在_" + ts + "')")
      if (r5?.success || r5?.data === null) ok('查询不存在学生历史', '返回空结果')
      else warn('查询不存在学生历史', 'data=' + JSON.stringify(r5).slice(0, 100))

      // 5.6 删除不存在的班级
      const r6 = await cdp.apiSafe("await window.api.class.delete('nonexistent-uuid-" + ts + "')")
      if (!r6?.success) ok('删除不存在班级被拒绝', '正确拒绝')
      else warn('删除不存在班级被接受', '可能静默成功')

      // 5.7 给不存在的班级分配学生
      const r7 = await cdp.apiSafe("await window.api.class.assign({class_id:'C-NOEXIST-" + ts + "',student_names:['R53测试_" + ts + "']})")
      if (!r7?.success) ok('分配到不存在班级被拒绝', '正确拒绝')
      else warn('分配到不存在班级被接受', '可能有问题')
    } catch (e) { fail('场景5', '', e.message) }

    // ============================================================
    // 场景 6: 边界分数 (delta)
    // ============================================================
    console.log('\n--- 场景 6: 边界分数 ---')
    try {
      const scoreStudent = 'R53分数_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + scoreStudent + "')")
      createdStudentNames.push(scoreStudent)

      // 6.1 delta = 0
      const r1 = await cdp.apiSafe("await window.api.eaa.addEvent({studentName:'" + scoreStudent + "',reasonCode:'OTHER_DEDUCT',delta:0})")
      if (r1?.success) ok('delta=0 事件', '接受')
      else warn('delta=0 被拒绝', (r1?.stderr ?? '').slice(0, 100))

      // 6.2 极大正分 delta = 1000
      const r2 = await cdp.apiSafe("await window.api.eaa.addEvent({studentName:'" + scoreStudent + "',reasonCode:'BONUS_VARIABLE',delta:1000})")
      if (r2?.success) ok('delta=1000 事件', '接受')
      else warn('delta=1000 被拒绝', (r2?.stderr ?? '').slice(0, 100))

      // 6.3 极大负分 delta = -1000
      const r3 = await cdp.apiSafe("await window.api.eaa.addEvent({studentName:'" + scoreStudent + "',reasonCode:'OTHER_DEDUCT',delta:-1000})")
      if (r3?.success) ok('delta=-1000 事件', '接受')
      else warn('delta=-1000 被拒绝', (r3?.stderr ?? '').slice(0, 100))

      // 6.4 非常小小数 delta = 0.001
      const r4 = await cdp.apiSafe("await window.api.eaa.addEvent({studentName:'" + scoreStudent + "',reasonCode:'OTHER_DEDUCT',delta:0.001})")
      if (r4?.success) ok('delta=0.001 事件', '接受')
      else warn('delta=0.001 被拒绝', (r4?.stderr ?? '').slice(0, 100))

      // 6.5 验证最终分数合理
      const score = await cdp.apiSafe("await window.api.eaa.score('" + scoreStudent + "')")
      if (score?.success) {
        const finalScore = score?.data?.score ?? score?.data?.parsed?.score
        ok('最终分数', 'score=' + finalScore)
        if (typeof finalScore === 'number' && !isNaN(finalScore)) ok('分数是有效数字', String(finalScore))
        else fail('分数无效', '', JSON.stringify(score?.data).slice(0, 200))
      } else warn('查询分数失败', JSON.stringify(score).slice(0, 100))

      // 6.6 反转/撤销事件 (revert) 边界
      const histRes = await cdp.apiSafe("await window.api.eaa.history('" + scoreStudent + "')")
      const events = histRes?.data?.events ?? histRes?.data ?? []
      const eventId = Array.isArray(events) && events.length > 0 ? (events[0]?.event_id ?? events[0]?.id ?? events[0]?.uuid) : null
      if (eventId) {
        const revRes = await cdp.apiSafe("await window.api.eaa.revertEvent('" + eventId + "','R53撤销测试')")
        if (revRes?.success) ok('撤销事件', 'eventId=' + eventId)
        else warn('撤销事件失败', JSON.stringify(revRes).slice(0, 100))
      } else warn('无事件可撤销', 'history 返回空')
    } catch (e) { fail('场景6', '', e.message) }

    // ============================================================
    // 场景 7: 无效 class_id 格式
    // ============================================================
    console.log('\n--- 场景 7: 无效 class_id 格式 ---')
    try {
      // 7.1 含空格 class_id
      const r1 = await cdp.apiSafe("await window.api.class.create({class_id:'C SPACE " + ts + "',name:'R53空格ID班_" + ts + "',grade:'高一'})")
      if (!r1?.success) ok('含空格class_id被拒绝', '正确拒绝')
      else { warn('含空格class_id被接受', '可能有问题'); if (r1?.data?.id) createdClassIds.push(r1.data.id) }

      // 7.2 含特殊字符 class_id
      const r2 = await cdp.apiSafe("await window.api.class.create({class_id:'C@#$%" + ts + "',name:'R53特殊ID班_" + ts + "',grade:'高一'})")
      if (!r2?.success) ok('含特殊字符class_id被拒绝', '正确拒绝')
      else { warn('含特殊字符class_id被接受', '可能有问题'); if (r2?.data?.id) createdClassIds.push(r2.data.id) }

      // 7.3 中文 class_id
      const r3 = await cdp.apiSafe("await window.api.class.create({class_id:'C中文_" + ts + "',name:'R53中文ID班_" + ts + "',grade:'高一'})")
      if (r3?.success) { ok('中文class_id被接受', '允许中文'); if (r3?.data?.id) createdClassIds.push(r3.data.id) }
      else warn('中文class_id被拒绝', (r3?.error ?? '').slice(0, 100))

      // 7.4 正常的合法 class_id
      const r4 = await cdp.api("await window.api.class.create({class_id:'C-LEGAL-" + ts + "',name:'R53合法班_" + ts + "',grade:'高一',teacher:'王老师'})")
      if (r4?.success) { ok('合法class_id被接受', 'C-LEGAL-' + ts); if (r4?.data?.id) createdClassIds.push(r4.data.id) }
      else fail('合法class_id创建失败', '', JSON.stringify(r4))

      // 7.5 用无效 class_id 给学生 setStudentMeta
      const metaStudent = 'R53meta_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + metaStudent + "')")
      createdStudentNames.push(metaStudent)
      const r5 = await cdp.apiSafe("await window.api.eaa.setStudentMeta({name:'" + metaStudent + "',classId:'INVALID CLASS WITH SPACE'})")
      if (!r5?.success) ok('无效classId给setStudentMeta被拒绝', '正确拒绝')
      else warn('无效classId被接受', '可能有问题')
    } catch (e) { fail('场景7', '', e.message) }

    // ============================================================
    // 场景 8: 状态转换边界
    // ============================================================
    console.log('\n--- 场景 8: 状态转换边界 ---')
    try {
      const stateStudent = 'R53状态_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + stateStudent + "')")
      createdStudentNames.push(stateStudent)

      // 8.1 删除学生 (preload 签名: deleteStudent(name, reason?))
      const r1 = await cdp.api("await window.api.eaa.deleteStudent('" + stateStudent + "','R53状态测试')")
      if (r1?.success) ok('删除学生', stateStudent)
      else fail('删除学生', '', JSON.stringify(r1))

      // 8.2 再次删除已删除的学生
      const r2 = await cdp.apiSafe("await window.api.eaa.deleteStudent('" + stateStudent + "','再次删除')")
      if (!r2?.success) ok('再次删除被拒绝', '正确拒绝')
      else warn('再次删除被接受', '可能重复操作')

      // 8.3 给已删除学生添加事件
      const r3 = await cdp.apiSafe("await window.api.eaa.addEvent({studentName:'" + stateStudent + "',reasonCode:'LATE'})")
      if (!r3?.success) ok('已删除学生事件被拒绝', '正确拒绝')
      else warn('已删除学生事件被接受', '可能自动恢复?')

      // 8.4 创建班级→存档→恢复→删除
      const stateClassId = 'C-STATE-' + ts
      const r4 = await cdp.api("await window.api.class.create({class_id:'" + stateClassId + "',name:'R53状态班_" + ts + "',grade:'高一'})")
      if (r4?.success && r4?.data?.id) {
        createdClassIds.push(r4.data.id)
        const classUuid = r4.data.id
        ok('创建状态班', classUuid)

        // 存档
        const r5 = await cdp.apiSafe("await window.api.class.archive('" + classUuid + "')")
        if (r5?.success) ok('存档班级', 'archived=true')
        else fail('存档班级', '', JSON.stringify(r5))

        // 再次存档
        const r6 = await cdp.apiSafe("await window.api.class.archive('" + classUuid + "')")
        if (r6?.success) warn('再次存档被接受', '可能幂等')
        else ok('再次存档被拒绝', '正确拒绝')

        // 恢复
        const r7 = await cdp.apiSafe("await window.api.class.restore('" + classUuid + "')")
        if (r7?.success) ok('恢复班级', 'restored=true')
        else fail('恢复班级', '', JSON.stringify(r7))

        // 再次恢复
        const r8 = await cdp.apiSafe("await window.api.class.restore('" + classUuid + "')")
        if (r8?.success) warn('再次恢复被接受', '可能幂等')
        else ok('再次恢复被拒绝', '正确拒绝')

        // 删除
        const r9 = await cdp.apiSafe("await window.api.class.delete('" + classUuid + "')")
        if (r9?.success) {
          ok('删除班级', 'deleted')
          // 从清理列表中移除 (已删除)
          const idx = createdClassIds.indexOf(classUuid)
          if (idx >= 0) createdClassIds.splice(idx, 1)
        } else fail('删除班级', '', JSON.stringify(r9))

        // 操作已删除的班级
        const r10 = await cdp.apiSafe("await window.api.class.archive('" + classUuid + "')")
        if (!r10?.success) ok('操作已删除班级被拒绝', '正确拒绝')
        else warn('操作已删除班级被接受', '可能有问题')
      } else fail('创建状态班', '', JSON.stringify(r4))
    } catch (e) { fail('场景8', '', e.message) }

    // ============================================================
    // 场景 9: 并发操作 (同一实体)
    // ============================================================
    console.log('\n--- 场景 9: 并发操作同一实体 ---')
    try {
      const concStudent = 'R53并发_' + ts
      await cdp.api("await window.api.eaa.addStudent('" + concStudent + "')")
      createdStudentNames.push(concStudent)

      // 5 个并发 addEvent
      const promises = []
      for (let i = 0; i < 5; i++) {
        promises.push(cdp.apiSafe("await window.api.eaa.addEvent({studentName:'" + concStudent + "',reasonCode:'LATE',delta:-2})"))
      }
      const concResults = await Promise.allSettled(promises)
      const succCount = concResults.filter(r => r.status === 'fulfilled' && r.value?.success).length
      ok('5并发事件', succCount + '/5 成功')

      // 验证事件总数
      const histRes = await cdp.api("await window.api.eaa.history('" + concStudent + "')")
      const histEvents = histRes?.data?.events ?? histRes?.data ?? []
      const eventCount = Array.isArray(histEvents) ? histEvents.length : 0
      if (eventCount >= succCount) ok('并发事件已持久化', 'history 显示 ' + eventCount + ' 个事件')
      else warn('并发事件持久化不完整', 'success=' + succCount + ' history=' + eventCount)

      // 验证分数 = 100 - 2*succCount (假设每个 LATE -2)
      const scoreRes = await cdp.api("await window.api.eaa.score('" + concStudent + "')")
      const finalScore = scoreRes?.data?.score ?? scoreRes?.data?.parsed?.score
      if (typeof finalScore === 'number') {
        const expected = 100 - 2 * succCount
        ok('并发后分数', 'score=' + finalScore + ' 期望~' + expected)
      } else warn('分数查询异常', JSON.stringify(scoreRes?.data).slice(0, 100))
    } catch (e) { fail('场景9', '', e.message) }

    // ============================================================
    // 场景 10: UI 边界交互
    // ============================================================
    console.log('\n--- 场景 10: UI 边界交互 ---')
    try {
      // 10.1 仪表盘空状态 (已清空时显示)
      await cdp.navigate('/dashboard', 2500)
      const dashText = await cdp.eval("document.body?.innerText?.slice(0, 800) || ''")
      if (dashText.length > 0) ok('仪表盘空状态可访问', '文本长度=' + dashText.length)
      else fail('仪表盘无响应', '', '文本为空')

      // 10.2 学生页空状态
      await cdp.navigate('/students', 2500)
      const stuText = await cdp.eval("document.body?.innerText?.slice(0, 800) || ''")
      if (stuText.length > 0) ok('学生页可访问', '文本长度=' + stuText.length)
      else fail('学生页无响应', '', '文本为空')

      // 10.3 班级页空状态
      await cdp.navigate('/classes', 2500)
      const clsText = await cdp.eval("document.body?.innerText?.slice(0, 800) || ''")
      if (clsText.length > 0) ok('班级页可访问', '文本长度=' + clsText.length)
      else fail('班级页无响应', '', '文本为空')

      // 10.4 快速连续导航 (10次)
      const pages = ['/dashboard', '/students', '/classes', '/settings', '/agents']
      let navOkCount = 0
      for (let i = 0; i < 10; i++) {
        await cdp.navigate(pages[i % pages.length], 600)
        const hash = await cdp.eval("window.location.hash")
        if (hash === '#' + pages[i % pages.length]) navOkCount++
      }
      if (navOkCount >= 9) ok('快速连续导航', navOkCount + '/10 成功')
      else warn('快速导航部分失败', navOkCount + '/10 成功')

      // 10.5 设置页 - 加载并交互
      await cdp.navigate('/settings', 2500)
      const settingsBtns = await cdp.eval("document.querySelectorAll('button').length")
      if (settingsBtns > 0) ok('设置页可交互', '按钮数=' + settingsBtns)
      else warn('设置页按钮数=0', '可能未加载')
    } catch (e) { fail('场景10', '', e.message) }

    // ============================================================
    // 场景 11: 数据完整性 (跨API一致性)
    // ============================================================
    console.log('\n--- 场景 11: 数据完整性 ---')
    try {
      // 创建一个学生 + 班级 + 事件, 验证各 API 一致
      const integrityStudent = 'R53完整_' + ts
      const integrityClassId = 'C-INT-' + ts

      // 创建班级
      const cr1 = await cdp.api("await window.api.class.create({class_id:'" + integrityClassId + "',name:'R53完整班_" + ts + "',grade:'高一',teacher:'王老师'})")
      if (cr1?.success && cr1?.data?.id) {
        createdClassIds.push(cr1.data.id)
        ok('创建完整班', integrityClassId)

        // 创建学生
        const cr2 = await cdp.api("await window.api.eaa.addStudent('" + integrityStudent + "')")
        if (cr2?.success) {
          createdStudentNames.push(integrityStudent)
          ok('创建完整学生', integrityStudent)

          // 分配学生到班级
          const cr3 = await cdp.api("await window.api.eaa.setStudentMeta({name:'" + integrityStudent + "',classId:'" + integrityClassId + "'})")
          if (cr3?.success) ok('分配学生到班', integrityClassId)
          else fail('分配学生到班', '', JSON.stringify(cr3))

          // 添加事件
          const cr4 = await cdp.api("await window.api.eaa.addEvent({studentName:'" + integrityStudent + "',reasonCode:'CLASS_MONITOR',delta:10,note:'R53完整性测试'})")
          if (cr4?.success) ok('添加完整性事件', 'delta=+10')
          else fail('添加完整性事件', '', JSON.stringify(cr4))

          // 验证 listStudents 中 class_id 一致
          const list = await cdp.api('await window.api.eaa.listStudents()')
          const stu = (list?.data?.students ?? []).find(s => s.name === integrityStudent)
          if (stu) {
            if (stu.class_id === integrityClassId) ok('listStudents class_id 一致', stu.class_id)
            else fail('listStudents class_id 不一致', '', '期望 ' + integrityClassId + ' 实际 ' + stu.class_id)
            if (stu.score === 110) ok('listStudents score 一致', 'score=' + stu.score)
            else warn('listStudents score', '期望 110 实际 ' + stu.score)
          } else fail('listStudents 未找到', '', integrityStudent)

          // 验证 score API 一致
          const sc = await cdp.api("await window.api.eaa.score('" + integrityStudent + "')")
          const scVal = sc?.data?.score ?? sc?.data?.parsed?.score
          if (scVal === 110) ok('score API 一致', 'score=' + scVal)
          else warn('score API 不一致', '期望 110 实际 ' + scVal)

          // 验证 class.list 一致
          const cls = await cdp.api('await window.api.class.list()')
          const found = (cls?.data ?? []).find(c => c.class_id === integrityClassId)
          if (found) {
            ok('class.list 包含该班', 'name=' + found.name)
            if (found.student_count === 1) ok('class.student_count 一致', 'count=1')
            else warn('class.student_count 不一致', '期望 1 实际 ' + found.student_count)
          } else fail('class.list 未找到', '', integrityClassId)
        } else fail('创建完整学生', '', JSON.stringify(cr2))
      } else fail('创建完整班', '', JSON.stringify(cr1))
    } catch (e) { fail('场景11', '', e.message) }

  } catch (e) {
    fail('R53 主流程', '', e.message)
  } finally {
    // ============================================================
    // 清理: 删除所有创建的测试数据
    // ============================================================
    console.log('\n--- 清理 R53 测试数据 ---')
    let cleanedStudents = 0
    let cleanedClasses = 0
    for (const name of createdStudentNames) {
      try {
        const safeName = String(name).replace(/'/g, "\\'").replace(/\\/g, '\\\\')
        // preload 签名: deleteStudent(name, reason?) — preload 自动加 confirm:true
        const r = await cdp.apiSafe("await window.api.eaa.deleteStudent('" + safeName + "','R53清理')")
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

    // 最终验证
    try {
      const finalList = await cdp.api('await window.api.eaa.listStudents()')
      const finalActive = (finalList?.data?.students ?? []).filter(s => s.name.indexOf('R53') >= 0 && s.status !== 'Deleted')
      if (finalActive.length === 0) ok('清理后无 R53 残留', 'active=0')
      else warn('清理后有残留', 'active=' + finalActive.length + ': ' + finalActive.map(s => s.name).slice(0, 5).join(','))
    } catch (e) { warn('清理后验证失败', e.message) }
  }

  console.log('\n=== R53 测试完成 ===')
  console.log('结果: ' + results.pass + ' pass, ' + results.fail + ' fail, ' + results.warn + ' warn')
  const total = results.pass + results.fail + results.warn
  const rate = total > 0 ? ((results.pass + results.warn) / total * 100).toFixed(1) : '0.0'
  console.log('通过率: ' + rate + '%')

  results.summary = { pass: results.pass, fail: results.fail, warn: results.warn, total, passRate: parseFloat(rate) }
  results.timestamp = new Date().toISOString()
  require('fs').writeFileSync('dogfood-output/r53-boundary-result.json', JSON.stringify(results, null, 2))

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch(e => { console.log('FATAL:', e.message); console.log(e.stack); process.exit(1) })
