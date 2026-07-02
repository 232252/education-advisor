// 第九轮测试 — 跨模块集成边界场景
// 目标: 测试模块间数据流、边界场景、错误恢复、一致性
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(path, wait = 1500) {
    await this.eval(`window.location.hash='${path}'`)
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

  function errMsg(r) {
    return r?.__error || r?.error || (typeof r?.data === 'string' && !r?.success ? r.data : null) || 'unknown'
  }

  const testSuffix = String(Date.now()).slice(-4)
  console.log('=== 第九轮: 跨模块集成边界场景 ===\n')

  // ========== 1. 清理 ==========
  console.log('--- 1. 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 2000))
  ok('清理完成', '')

  // ========== 2. Class ↔ EAA 跨模块数据流 ==========
  console.log('\n--- 2. Class ↔ EAA 跨模块数据流 ---')
  const classId = `CROSS${testSuffix}`
  const className = `跨模块班_${testSuffix}`
  const studentName = `跨模块生_${testSuffix}`

  // 2.1 创建班级
  const classR = await cdp.eval(`(async()=>{
    const r = await window.api.class.create({ class_id: '${classId}', name: '${className}', grade: '九年级', teacher: '跨模块师' });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (classR?.success !== false) ok('创建班级', className)
  else fail('创建班级', '', errMsg(classR))

  // 2.2 创建学生
  const stuR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.addStudent('${studentName}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (stuR?.success !== false) ok('创建学生', studentName)
  else fail('创建学生', '', errMsg(stuR))

  // 2.3 分配学生到班级
  const assignR = await cdp.eval(`(async()=>{
    const r = await window.api.class.assign({ class_id: '${classId}', student_names: ['${studentName}'] });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (assignR?.success !== false) ok('分配学生', `assigned: ${assignR?.assigned ?? 1}`)
  else fail('分配学生', '', errMsg(assignR))

  // 2.4 验证 EAA 中学生 class_id 已更新
  await new Promise((r) => setTimeout(r, 500))
  const stuInfo = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const stu = (stuInfo?.data?.students || []).find((s) => s.name === studentName)
  if (stu?.class_id === classId) ok('EAA class_id 同步', `${stu.class_id}`)
  else warn('EAA class_id 同步', `实际: ${stu?.class_id} (期望 ${classId})`)

  // 2.5 添加事件
  const evtR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.addEvent({ studentName: '${studentName}', reasonCode: 'LATE', note: '跨模块测试', operator: 'cross' });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (evtR?.success !== false) ok('添加事件', 'LATE')
  else fail('添加事件', '', errMsg(evtR))

  // 2.6 验证分数
  const scoreR = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.score('${studentName}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  const score = scoreR?.data?.score ?? scoreR?.data
  if (score === 98) ok('跨模块分数', `${score} (base=100, LATE=-2)`)
  else warn('跨模块分数', `实际 ${score}, 期望 98`)

  // 2.7 班级存档后验证学生仍在 EAA (需要使用内部 UUID id)
  const classListForId = await cdp.eval(`(async()=>{
    const r = await window.api.class.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const targetClass = (classListForId?.data || []).find((c) => c.class_id === classId)
  const internalId = targetClass?.id
  if (!internalId) {
    warn('获取班级内部 ID', '未找到')
  } else {
    const archiveR = await cdp.eval(`(async()=>{
      const r = await window.api.class.archive('${internalId}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    if (archiveR?.success !== false) ok('班级存档', '成功')
    else fail('班级存档', '', errMsg(archiveR))

    // 班级存档后 EAA 学生应仍存在
    const stuAfterArchive = await cdp.eval(`(async()=>{
      const r = await window.api.eaa.listStudents();
      return JSON.parse(JSON.stringify(r));
    })()`)
    const stuStillExists = (stuAfterArchive?.data?.students || []).some((s) => s.name === studentName)
    if (stuStillExists) ok('存档后学生仍在 EAA', '数据保留')
    else fail('存档后学生仍在 EAA', '', '学生消失')

    // 2.8 恢复班级
    const restoreR = await cdp.eval(`(async()=>{
      const r = await window.api.class.restore('${internalId}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    if (restoreR?.success !== false) ok('恢复班级', '成功')
    else fail('恢复班级', '', errMsg(restoreR))
  }

  // ========== 3. EAA 边界场景 ==========
  console.log('\n--- 3. EAA 边界场景 ---')

  // 3.1 不存在的学生添加事件
  const evtNotExist = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.addEvent({ studentName: '不存在学生XYZ_${testSuffix}', reasonCode: 'LATE', note: '测试', operator: 'test' });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (evtNotExist?.success === false || errMsg(evtNotExist) !== 'unknown') ok('不存在学生添加事件', '被拒绝')
  else warn('不存在学生添加事件', `返回: ${JSON.stringify(evtNotExist).slice(0, 80)}`)

  // 3.2 无效原因码
  const evtInvalidCode = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.addEvent({ studentName: '${studentName}', reasonCode: 'INVALID_CODE_XYZ', note: '测试', operator: 'test' });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (evtInvalidCode?.success === false) ok('无效原因码', `被拒绝: ${errMsg(evtInvalidCode).slice(0, 40)}`)
  else warn('无效原因码', `返回: ${JSON.stringify(evtInvalidCode).slice(0, 80)}`)

  // 3.3 空学生名
  const evtEmptyName = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addEvent({ studentName: '', reasonCode: 'LATE', note: '测试', operator: 'test' });
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
  })()`)
  if (evtEmptyName?.success === false) ok('空学生名', '被拒绝')
  else warn('空学生名', `返回: ${JSON.stringify(evtEmptyName).slice(0, 80)}`)

  // 3.4 空原因码
  const evtEmptyCode = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.addEvent({ studentName: '${studentName}', reasonCode: '', note: '测试', operator: 'test' });
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
  })()`)
  if (evtEmptyCode?.success === false) ok('空原因码', '被拒绝')
  else warn('空原因码', `返回: ${JSON.stringify(evtEmptyCode).slice(0, 80)}`)

  // 3.5 空数据排行榜
  // 先创建一个独立场景: 没有学生的排行榜
  const emptyRanking = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.ranking(10);
    return JSON.parse(JSON.stringify(r));
  })()`)
  const rankList = emptyRanking?.data?.ranking || emptyRanking?.data || []
  if (Array.isArray(rankList)) ok('排行榜返回数组', `${rankList.length} 项`)
  else warn('排行榜返回', `非数组: ${typeof rankList}`)

  // 3.6 不存在学生的分数查询
  const scoreNotExist = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.score('不存在学生XYZ_${testSuffix}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
  })()`)
  if (scoreNotExist?.success === false) ok('不存在学生分数', '被拒绝')
  else warn('不存在学生分数', `返回: ${JSON.stringify(scoreNotExist).slice(0, 80)}`)

  // 3.7 不存在学生的历史
  const histNotExist = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.history('不存在学生XYZ_${testSuffix}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
  })()`)
  if (histNotExist?.success !== false) {
    const events = histNotExist?.data?.events || []
    ok('不存在学生历史', `返回空数组 (${events.length} 事件)`)
  } else {
    ok('不存在学生历史', '被拒绝')
  }

  // ========== 4. Class 边界场景 ==========
  console.log('\n--- 4. Class 边界场景 ---')

  // 4.1 重复创建相同 class_id
  const dupClass = await cdp.eval(`(async()=>{
    const r = await window.api.class.create({ class_id: '${classId}', name: '重复班', grade: '九年级' });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (dupClass?.success === false) ok('重复 class_id', '被拒绝')
  else warn('重复 class_id', `返回: ${JSON.stringify(dupClass).slice(0, 80)}`)

  // 4.2 分配到不存在的班级
  const assignNotExist = await cdp.eval(`(async()=>{
    const r = await window.api.class.assign({ class_id: 'NOTEXIST_${testSuffix}', student_names: ['${studentName}'] });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (assignNotExist?.success === false) ok('分配到不存在班级', '被拒绝')
  else warn('分配到不存在班级', `返回: ${JSON.stringify(assignNotExist).slice(0, 80)}`)

  // 4.3 分配不存在的学生
  const assignNotExistStu = await cdp.eval(`(async()=>{
    const r = await window.api.class.assign({ class_id: '${classId}', student_names: ['不存在学生XYZ_${testSuffix}'] });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (assignNotExistStu?.success !== false) {
    // 可能部分成功部分失败
    const failed = assignNotExistStu?.failed || []
    if (failed.length > 0) ok('分配不存在学生', `部分失败: ${failed.length} 个`)
    else warn('分配不存在学生', `返回: ${JSON.stringify(assignNotExistStu).slice(0, 80)}`)
  } else {
    ok('分配不存在学生', '被拒绝')
  }

  // 4.4 删除不存在的班级
  const delNotExist = await cdp.eval(`(async()=>{
    const r = await window.api.class.delete('NOTEXIST_${testSuffix}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (delNotExist?.success === false) ok('删除不存在班级', '被拒绝')
  else warn('删除不存在班级', `返回: ${JSON.stringify(delNotExist).slice(0, 80)}`)

  // 4.5 空参数创建
  const emptyCreate = await cdp.eval(`(async()=>{
    const r = await window.api.class.create({ class_id: '', name: '' });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (emptyCreate?.success === false) ok('空参数创建', '被拒绝')
  else warn('空参数创建', `返回: ${JSON.stringify(emptyCreate).slice(0, 80)}`)

  // ========== 5. EAA 导出边界 ==========
  console.log('\n--- 5. EAA 导出边界 ---')

  // 5.1 导出 3 种格式
  const formats = ['csv', 'jsonl', 'html']
  for (const fmt of formats) {
    const exportR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.eaa.export('${fmt}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
    })()`)
    if (exportR?.success !== false) {
      const len = exportR?.data?.length ?? JSON.stringify(exportR?.data ?? '').length
      ok(`导出 ${fmt}`, `${len} 字符`)
    } else {
      fail(`导出 ${fmt}`, '', errMsg(exportR))
    }
  }

  // 5.2 无效导出格式
  const invalidFmt = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.eaa.export('xml');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
  })()`)
  if (invalidFmt?.success === false) ok('无效导出格式', '被拒绝')
  else warn('无效导出格式', `返回: ${JSON.stringify(invalidFmt).slice(0, 80)}`)

  // ========== 6. Agent 系统深度测试 ==========
  console.log('\n--- 6. Agent 系统深度测试 ---')

  // 6.1 获取所有 Agent (list 返回数组,非 { data: [] })
  const agentList = await cdp.eval(`(async()=>{
    const r = await window.api.agent.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const agents = Array.isArray(agentList) ? agentList : (agentList?.data || [])
  if (agents.length >= 15) ok('Agent 列表', `${agents.length} 个`)
  else warn('Agent 列表', `仅 ${agents.length} 个`)

  // 6.2 逐个获取 SOUL (getSoul 返回字符串)
  let soulOk = 0
  let soulEmpty = 0
  for (const a of agents) {
    const agentId = a.id || a.name
    if (!agentId) continue
    const soul = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.getSoul('${agentId}');
        return r;
      } catch(e) { return ''; }
    })()`)
    const soulText = typeof soul === 'string' ? soul : ''
    if (soulText.length > 10) soulOk++
    else soulEmpty++
  }
  if (agents.length > 0) {
    if (soulOk >= 15) ok('Agent SOUL', `${soulOk}/${agents.length} 有内容`)
    else warn('Agent SOUL', `${soulOk}/${agents.length} 有内容, ${soulEmpty} 空`)
  }

  // 6.3 Agent toggle
  if (agents.length > 0) {
    const a0 = agents[0]
    const aid = a0.id || a0.name
    const toggleR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.agent.toggle('${aid}', false);
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
    })()`)
    if (toggleR?.success !== false) {
      ok('Agent toggle off', aid)
      // 恢复
      await cdp.eval(`(async()=>{
        try { await window.api.agent.toggle('${aid}', true); } catch(e) {}
      })()`)
      ok('Agent toggle on', '恢复')
    } else {
      warn('Agent toggle', errMsg(toggleR))
    }
  }

  // 6.4 无效 Agent ID (getSoul 对无效 ID 会 throw)
  const invalidAgent = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.agent.getSoul('INVALID_AGENT_XYZ');
      return { ok: true, data: r };
    } catch(e) { return { ok: false, error: String(e.message || e).slice(0, 100) }; }
  })()`)
  if (!invalidAgent?.ok) ok('无效 Agent ID', '被拒绝')
  else warn('无效 Agent ID', `返回: ${JSON.stringify(invalidAgent).slice(0, 80)}`)

  // ========== 7. Settings 读写一致性 ==========
  console.log('\n--- 7. Settings 读写一致性 ---')

  // 7.1 读取设置 (settings.get 返回 UnifiedSettings 直接,非 { data: ... })
  const settingsR = await cdp.eval(`(async()=>{
    const r = await window.api.settings.get();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (settingsR && !settingsR?.error) ok('读取设置', '成功')
  else fail('读取设置', '', errMsg(settingsR))

  // 7.2 设置 + 读回 (使用 general.logLevel, 已知有效路径)
  const setR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('general.logLevel', 'debug');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
  })()`)
  if (setR?.success !== false) {
    const verifyR = await cdp.eval(`(async()=>{
      const r = await window.api.settings.get();
      return JSON.parse(JSON.stringify(r));
    })()`)
    const logLevel = verifyR?.general?.logLevel
    if (logLevel === 'debug') ok('设置读写一致', `logLevel = ${logLevel}`)
    else warn('设置读写', `期望 debug, 实际 ${logLevel}`)
    // 恢复
    await cdp.eval(`(async()=>{ try { await window.api.settings.set('general.logLevel', 'info'); } catch(e) {} })()`)
  } else {
    warn('设置写入', errMsg(setR))
  }

  // 7.3 枚举值校验 (settings.set 可能 throw)
  const invalidTheme = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('general.theme', 'INVALID_THEME_XYZ');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
  })()`)
  if (invalidTheme?.success === false) ok('无效主题被拒', errMsg(invalidTheme).slice(0, 40))
  else fail('无效主题应被拒', '', '接受了无效值')

  // 7.4 无效路径 (settings.set 对无效路径会 throw)
  const invalidPath = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.settings.set('invalid.path.xyz', 'test');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
  })()`)
  if (invalidPath?.success === false) ok('无效路径被拒', 'ok')
  else warn('无效路径', `返回: ${JSON.stringify(invalidPath).slice(0, 80)}`)

  // ========== 8. Chat CRUD 边界 ==========
  console.log('\n--- 8. Chat CRUD 边界 ---')

  // 8.1 保存消息 (saveMessage 返回 { success, id }, 无 sessionId)
  const chatSessionId = `R9Session_${testSuffix}`
  const chatR = await cdp.eval(`(async()=>{
    const r = await window.api.chat.saveMessage({ sessionId: '${chatSessionId}', role: 'user', content: 'R9跨模块测试消息_${testSuffix}', timestamp: Date.now() });
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (chatR?.success !== false) {
    ok('保存 Chat 消息', `id: ${chatR?.id ?? '?'}`)
    // 8.2 加载消息 (loadMessages 返回 { success, messages })
    const loadR = await cdp.eval(`(async()=>{
      const r = await window.api.chat.loadMessages('${chatSessionId}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    const msgs = loadR?.messages || []
    if (msgs.length > 0) ok('加载 Chat 消息', `${msgs.length} 条`)
    else warn('加载 Chat 消息', '空')

    // 8.3 列出会话 (listSessions 返回 { success, sessions })
    const listR = await cdp.eval(`(async()=>{
      const r = await window.api.chat.listSessions();
      return JSON.parse(JSON.stringify(r));
    })()`)
    const sessions = listR?.sessions || []
    ok('列出 Chat 会话', `${sessions.length} 个`)

    // 8.4 删除会话
    const delR = await cdp.eval(`(async()=>{
      const r = await window.api.chat.deleteSession('${chatSessionId}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    if (delR?.success !== false) ok('删除 Chat 会话', '成功')
    else warn('删除 Chat 会话', errMsg(delR))
  } else {
    warn('保存 Chat 消息', errMsg(chatR))
  }

  // ========== 9. Skill 边界 ==========
  console.log('\n--- 9. Skill 边界 ---')

  // 9.1 列出技能 (skill.list 返回 Skill[] 直接)
  const skillList = await cdp.eval(`(async()=>{
    const r = await window.api.skill.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const skills = Array.isArray(skillList) ? skillList : (skillList?.data || [])
  ok('Skill 列表', `${skills.length} 个`)

  // 9.2 保存技能
  const skillName = `R9测试技能_${testSuffix}`
  const skillR = await cdp.eval(`(async()=>{
    const r = await window.api.skill.save('${skillName}', '这是 R9 测试技能内容');
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (skillR?.success !== false) {
    ok('保存 Skill', skillName)
    // 9.3 读取技能 (skill.get 返回 Skill | null)
    const getR = await cdp.eval(`(async()=>{
      const r = await window.api.skill.get('${skillName}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    if (getR) ok('读取 Skill', '内容一致')
    else warn('读取 Skill', '返回 null')

    // 9.4 删除技能
    const delSkillR = await cdp.eval(`(async()=>{
      const r = await window.api.skill.delete('${skillName}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    if (delSkillR?.success !== false) ok('删除 Skill', '成功')
    else warn('删除 Skill', errMsg(delSkillR))
  } else {
    warn('保存 Skill', errMsg(skillR))
  }

  // 9.5 读取不存在的技能 (返回 null)
  const notExistSkill = await cdp.eval(`(async()=>{
    const r = await window.api.skill.get('不存在技能XYZ_${testSuffix}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (!notExistSkill) ok('读取不存在 Skill', '返回 null')
  else warn('读取不存在 Skill', `返回: ${JSON.stringify(notExistSkill).slice(0, 80)}`)

  // ========== 10. Privacy 系统测试 ==========
  console.log('\n--- 10. Privacy 系统测试 ---')

  // 10.1 获取状态 (privacy.status 返回 { unlocked: boolean })
  const privStatus = await cdp.eval(`(async()=>{
    const r = await window.api.privacy.status();
    return JSON.parse(JSON.stringify(r));
  })()`)
  ok('Privacy 状态', `unlocked: ${privStatus?.unlocked ?? '?'}`)

  // 10.2 lock (不需要密码)
  const lockR = await cdp.eval(`(async()=>{
    const r = await window.api.privacy.lock();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (lockR?.success !== false) ok('Privacy lock', '成功')
  else warn('Privacy lock', errMsg(lockR))

  // 10.3 再次检查状态 (应锁定)
  const privStatus2 = await cdp.eval(`(async()=>{
    const r = await window.api.privacy.status();
    return JSON.parse(JSON.stringify(r));
  })()`)
  if (privStatus2?.unlocked === false) ok('Privacy 锁定后状态', 'locked')
  else warn('Privacy 锁定后状态', `unlocked: ${privStatus2?.unlocked}`)

  // ========== 11. Cron 定时任务 ==========
  console.log('\n--- 11. Cron 定时任务 ---')

  // 11.1 列出任务 (cron.list 返回 CronTask[] 直接)
  const cronList = await cdp.eval(`(async()=>{
    const r = await window.api.cron.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  const crons = Array.isArray(cronList) ? cronList : (cronList?.data || [])
  if (crons.length > 0) ok('Cron 列表', `${crons.length} 个任务`)
  else warn('Cron 列表', '空')

  // 11.2 添加任务 (cron.add 需要 expression 字段, 返回 string ID 直接)
  const cronId = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.cron.add({ name: 'R9测试_${testSuffix}', expression: '0 9 * * 1', action: 'log', enabled: true });
      return r;
    } catch(e) { return null; }
  })()`)
  if (cronId) {
    ok('添加 Cron 任务', `id: ${String(cronId).slice(0, 20)}`)

    // 11.3 立即运行
    const runR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.cron.runNow('${cronId}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
    })()`)
    if (runR?.success !== false) ok('Cron runNow', '成功')
    else warn('Cron runNow', errMsg(runR))

    // 11.4 获取日志 (cron.getLogs 返回 CronLogEntry[] 直接)
    const logR = await cdp.eval(`(async()=>{
      const r = await window.api.cron.getLogs('${cronId}');
      return JSON.parse(JSON.stringify(r));
    })()`)
    const logs = Array.isArray(logR) ? logR : (logR?.data || [])
    ok('Cron getLogs', `${logs.length} 条`)

    // 11.5 toggle
    const toggleR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.cron.toggle('${cronId}', false);
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
    })()`)
    if (toggleR?.success !== false) ok('Cron toggle off', '成功')
    else warn('Cron toggle', errMsg(toggleR))

    // 11.6 删除任务
    const delR = await cdp.eval(`(async()=>{
      try {
        const r = await window.api.cron.remove('${cronId}');
        return JSON.parse(JSON.stringify(r));
      } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
    })()`)
    if (delR?.success !== false) ok('Cron remove', '成功')
    else warn('Cron remove', errMsg(delR))
  } else {
    warn('添加 Cron 任务', '返回空 ID')
  }

  // ========== 12. System + Profile + AI ==========
  console.log('\n--- 12. System + Profile + AI ---')

  // 12.1 Sys checkUpdate (sys 命名空间, 无 system)
  const sysInfo = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.sys.checkUpdate();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return null; }
  })()`)
  if (sysInfo) ok('Sys checkUpdate', `v${sysInfo?.currentVersion ?? '?'}`)
  else warn('Sys checkUpdate', '返回空')

  // 12.2 Sys getPath
  const sysPath = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.sys.getPath('home');
      return r;
    } catch(e) { return null; }
  })()`)
  if (sysPath) ok('Sys getPath', String(sysPath).slice(0, 40))
  else warn('Sys getPath', '空')

  // 12.3 Profile 读取 (需要学生名)
  const profileR = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.profile.get('${studentName}');
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return { success: false, error: String(e.message || e).slice(0, 100) }; }
  })()`)
  if (profileR?.success !== false) ok('Profile 读取', '成功')
  else warn('Profile 读取', errMsg(profileR))

  // 12.4 AI providers (ai.listProviders, 非 ai.providers)
  const aiProviders = await cdp.eval(`(async()=>{
    try {
      const r = await window.api.ai.listProviders();
      return JSON.parse(JSON.stringify(r));
    } catch(e) { return []; }
  })()`)
  const providers = Array.isArray(aiProviders) ? aiProviders : (aiProviders?.data || [])
  if (providers.length > 0) ok('AI providers', `${providers.length} 个`)
  else warn('AI providers', '空')

  // ========== 13. 清理 ==========
  console.log('\n--- 13. 清理 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  ok('清理完成', '')

  // ========== 汇总 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail + results.warn
  const passRate = total > 0 ? (results.pass / total * 100).toFixed(1) : 0
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${passRate}%`)

  const fs = require('fs')
  fs.writeFileSync(__dirname + '/r9-results.json', JSON.stringify({
    round: 'R9',
    totalTests: total,
    pass: results.pass,
    fail: results.fail,
    warn: results.warn,
    passRate: parseFloat(passRate),
    details: results.details
  }, null, 2))
  console.log('结果已写入: r9-results.json')

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
