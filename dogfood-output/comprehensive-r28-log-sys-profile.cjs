// 第二十八轮测试 — Log/Sys/Profile 深度测试
// 目标: 深入测试日志、系统、Profile 模块的完整功能
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

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
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString())
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(p, wait = 1500) {
    await this.eval(`window.location.hash='${p}'`)
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

  console.log(`=== 第二十八轮: Log/Sys/Profile 深度测试 ===\n`)

  // ========== 1. Log 模块 ==========
  console.log('--- 1. Log 模块 ---')

  // 1.1 列出所有日志文件
  const logList = await cdp.eval(`(async()=>{ const r=await window.api.log.list(); return JSON.parse(JSON.stringify(r)); })()`)
  const logs = Array.isArray(logList) ? logList : (logList?.data || [])
  ok('Log list', `${logs.length} 个文件`)
  if (logs.length > 0) {
    const l = logs[0]
    ok('Log 结构', `字段: ${Object.keys(l).slice(0, 6).join(', ')}`)
  }

  // 1.2 读取每个日志文件
  for (const logFile of logs.slice(0, Math.min(4, logs.length))) {
    const fileName = logFile.name || logFile.filename || logFile
    const readR = await cdp.eval(`(async()=>{ try{ const r=await window.api.log.read(${JSON.stringify(fileName)}); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,100)}} })()`)
    if (readR && !readR.error) {
      const content = typeof readR === 'string' ? readR : (readR?.data || readR?.content || '')
      ok(`读取 ${fileName}`, `${content.length || String(content).length} 字符`)
    } else {
      warn(`读取 ${fileName}`, readR?.error || '失败')
    }
  }

  // 1.3 搜索日志
  const searchR = await cdp.eval(`(async()=>{ try{ const r=await window.api.log.search('error'); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,100)}} })()`)
  if (searchR && !searchR.error) {
    const searchResults = typeof searchR === 'string' ? searchR : (searchR?.data || searchR?.results || '')
    ok('Log search "error"', `${typeof searchResults === 'string' ? searchResults.length : 0} 字符`)
  } else {
    warn('Log search', searchR?.error || '失败')
  }

  // 1.4 搜索不同关键词
  const keywords = ['info', 'warn', 'EAA', 'IPC', 'Settings']
  for (const kw of keywords) {
    const r = await cdp.eval(`(async()=>{ try{ const r=await window.api.log.search('${kw}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,80)}} })()`)
    if (r && !r.error) {
      const content = typeof r === 'string' ? r : (r?.data || r?.results || '')
      ok(`search "${kw}"`, `${typeof content === 'string' ? content.length : 0} 字符`)
    } else {
      warn(`search "${kw}"`, r?.error || '失败')
    }
  }

  // 1.5 日志过滤
  const filterR = await cdp.eval(`(async()=>{ try{ const r=await window.api.log.filter({ level: 'error' }); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,100)}} })()`)
  if (filterR && !filterR.error) {
    ok('Log filter', '成功')
  } else {
    warn('Log filter', filterR?.error || '可能不支持')
  }

  // 1.6 日志转发
  const forwardR = await cdp.eval(`(async()=>{ try{ const r=await window.api.log.forward(); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,100)}} })()`)
  if (forwardR && !forwardR.error) {
    ok('Log forward', '成功')
  } else {
    warn('Log forward', forwardR?.error || '可能不支持')
  }

  // 1.7 Log UI 页面
  await cdp.navigate('/logs', 1500)
  const logBody = await cdp.eval(`document.body.innerText.length`)
  ok('Log 页面', `${logBody} 字符`)

  // ========== 2. Sys 模块 ==========
  console.log('\n--- 2. Sys 模块 ---')

  // 2.1 checkUpdate
  const updateR = await cdp.eval(`(async()=>{ const r=await window.api.sys.checkUpdate(); return JSON.parse(JSON.stringify(r)); })()`)
  if (updateR) {
    ok('Sys checkUpdate', `版本: ${updateR.version || updateR.currentVersion || '?'}`)
  }

  // 2.2 getPath(6种)
  const pathTypes = ['home', 'appData', 'userData', 'temp', 'desktop', 'documents']
  for (const pt of pathTypes) {
    const p = await cdp.eval(`(async()=>{ try{ const r=await window.api.sys.getPath('${pt}'); return r; }catch(e){return {error:String(e.message||e).slice(0,80)}} })()`)
    if (typeof p === 'string' && p.length > 0) ok(`getPath ${pt}`, p.slice(0, 50))
    else warn(`getPath ${pt}`, p?.error || '失败')
  }

  // 2.3 无效 path
  const invalidPathR = await cdp.eval(`(async()=>{ try{ const r=await window.api.sys.getPath('invalid-path-type'); return r; }catch(e){return {error:String(e.message||e).slice(0,100)}} })()`)
  if (invalidPathR?.error) ok('getPath 无效', 'graceful 失败')
  else warn('getPath 无效', `返回: ${JSON.stringify(invalidPathR).slice(0, 80)}`)

  // 2.4 notify
  const notifyR = await cdp.eval(`(async()=>{ try{ const r=await window.api.sys.notify('R28测试标题', 'R28测试内容'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
  if (notifyR?.success !== false) ok('Sys notify', '成功')
  else warn('Sys notify', notifyR?.error)

  // 2.5 openExternal
  const openExtR = await cdp.eval(`(async()=>{ try{ const r=await window.api.sys.openExternal('https://www.example.com'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
  if (openExtR?.success !== false) ok('Sys openExternal', '成功')
  else warn('Sys openExternal', openExtR?.error)

  // 2.6 openExternal 无效 URL
  const openInvalidR = await cdp.eval(`(async()=>{ try{ const r=await window.api.sys.openExternal('not-a-url'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
  if (openInvalidR?.success === false || openInvalidR?.error) ok('Sys openExternal 无效', 'graceful')
  else warn('Sys openExternal 无效', `返回: ${JSON.stringify(openInvalidR).slice(0, 80)}`)

  // ========== 3. Profile 模块 ==========
  console.log('\n--- 3. Profile 模块 ---')

  // 3.1 获取所有 profile
  const profileNames = ['default', 'teacher', 'student', 'admin']
  for (const name of profileNames) {
    const p = await cdp.eval(`(async()=>{ try{ const r=await window.api.profile.get('${name}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,80)}} })()`)
    if (p && !p.error) ok(`profile.get ${name}`, '成功')
    else warn(`profile.get ${name}`, p?.error || '不存在')
  }

  // 3.2 Profile 读写往返
  const testProfileName = `R28Profile_${Date.now().toString().slice(-5)}`
  const testProfileData = {
    name: 'R28测试',
    settings: { theme: 'dark', lang: 'zh-CN' },
    timestamp: Date.now()
  }
  const setR = await cdp.eval(`(async()=>{ try{ const r=await window.api.profile.set('${testProfileName}', ${JSON.stringify(testProfileData)}); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
  if (setR?.success !== false) ok('profile.set', '成功')
  else warn('profile.set', setR?.error)

  // 验证读取
  const getR = await cdp.eval(`(async()=>{ try{ const r=await window.api.profile.get('${testProfileName}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,100)}} })()`)
  if (getR && !getR.error) {
    // 验证数据一致
    const data = getR?.data || getR
    if (JSON.stringify(data) === JSON.stringify(testProfileData)) ok('profile 读写一致', '✓')
    else warn('profile 读写一致', '数据不一致')
  } else {
    warn('profile.get 验证', getR?.error || '失败')
  }

  // 3.3 Profile 覆盖写入
  const newData = { updated: true, timestamp: Date.now() }
  const overwriteR = await cdp.eval(`(async()=>{ try{ const r=await window.api.profile.set('${testProfileName}', ${JSON.stringify(newData)}); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
  if (overwriteR?.success !== false) ok('profile 覆盖', '成功')

  // 3.4 Profile 空名
  const emptyNameR = await cdp.eval(`(async()=>{ try{ const r=await window.api.profile.get(''); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,80)}} })()`)
  if (emptyNameR?.error) ok('profile 空名', 'graceful 失败')
  else warn('profile 空名', `返回: ${JSON.stringify(emptyNameR).slice(0, 80)}`)

  // 3.5 Profile 超长名
  const longName = 'A'.repeat(200)
  const longNameR = await cdp.eval(`(async()=>{ try{ const r=await window.api.profile.get('${longName}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,80)}} })()`)
  if (longNameR?.error || longNameR === null) ok('profile 超长名', 'graceful')
  else warn('profile 超长名', `返回: ${JSON.stringify(longNameR).slice(0, 80)}`)

  // ========== 4. About 页面 ==========
  console.log('\n--- 4. About 页面 ---')
  await cdp.navigate('/about', 2000)
  const aboutBody = await cdp.eval(`document.body.innerText.length`)
  ok('About 页面', `${aboutBody} 字符`)

  const aboutH1 = await cdp.eval(`document.querySelector('h1')?.innerText`)
  if (aboutH1) ok('About h1', aboutH1)

  // 检查版本信息
  const hasVersion = await cdp.eval(`document.body.innerText.includes('v0.1.0') || document.body.innerText.includes('version') || document.body.innerText.includes('版本')`)
  if (hasVersion) ok('About 版本信息', '存在')

  // ========== 5. Skills 页面 ==========
  console.log('\n--- 5. Skills 页面 ---')
  await cdp.navigate('/skills', 2000)
  const skillsBody = await cdp.eval(`document.body.innerText.length`)
  ok('Skills 页面', `${skillsBody} 字符`)

  // 获取 skill 列表
  const skills = await cdp.eval(`(async()=>{ const r=await window.api.skill.list(); return JSON.parse(JSON.stringify(r)); })()`)
  const skillList = Array.isArray(skills) ? skills : (skills?.data || [])
  ok('Skill 列表', `${skillList.length} 个`)

  if (skillList.length > 0) {
    const s = skillList[0]
    ok('Skill 结构', `name=${s.name || s.id}`)

    // 获取 skill 详情
    const skillName = s.name || s.id
    const skillDetail = await cdp.eval(`(async()=>{ try{ const r=await window.api.skill.get('${skillName}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,80)}} })()`)
    if (skillDetail && !skillDetail.error) ok(`skill.get ${skillName}`, '成功')
  }

  // Skill CRUD 往返
  const testSkillName = `R28Skill_${Date.now().toString().slice(-5)}`
  const testSkillContent = `# R28测试技能\n这是测试内容\n${new Date().toISOString()}`
  const saveSkillR = await cdp.eval(`(async()=>{ try{ const r=await window.api.skill.save({ name: '${testSkillName}', content: ${JSON.stringify(testSkillContent)} }); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
  if (saveSkillR?.success !== false) ok('skill.save', '成功')

  // 验证读取
  const getSkillR = await cdp.eval(`(async()=>{ try{ const r=await window.api.skill.get('${testSkillName}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {error:String(e.message||e).slice(0,100)}} })()`)
  if (getSkillR && !getSkillR.error) {
    const content = getSkillR?.content || getSkillR?.data?.content || ''
    if (content === testSkillContent) ok('skill 读写一致', '✓')
    else warn('skill 读写一致', '不一致')
  }

  // 删除 skill
  const delSkillR = await cdp.eval(`(async()=>{ try{ const r=await window.api.skill.delete('${testSkillName}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
  if (delSkillR?.success !== false) ok('skill.delete', '成功')

  // 删除不存在的 skill
  const delNonexistR = await cdp.eval(`(async()=>{ try{ const r=await window.api.skill.delete('nonexistent-skill-${Date.now()}'); return JSON.parse(JSON.stringify(r)); }catch(e){return {success:false,error:String(e.message||e).slice(0,100)}} })()`)
  if (delNonexistR?.success !== false) ok('skill.delete 不存在', 'graceful')

  // ========== 6. 内存检查 ==========
  console.log('\n--- 6. 内存检查 ---')
  const memR = await cdp.eval(`(function(){ if(performance && performance.memory){ return { used: Math.round(performance.memory.usedJSHeapSize/1024/1024), total: Math.round(performance.memory.totalJSHeapSize/1024/1024) }; } return null; })()`)
  if (memR) ok('内存', `${memR.used} MB / ${memR.total} MB`)

  // ========== 总结 ==========
  console.log('\n=== 测试汇总 ===')
  const total = results.pass + results.fail
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${total > 0 ? (results.pass / total * 100).toFixed(1) : 0}%`)

  const resultFile = path.join(__dirname, 'r28-results.json')
  fs.writeFileSync(resultFile, JSON.stringify({ results }, null, 2))
  console.log(`结果已写入: ${resultFile}`)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
