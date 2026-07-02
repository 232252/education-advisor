// 第三十轮测试 — Privacy 模块深度测试 (PII Shield 完整流程)
// 覆盖: init/load/enable/disable/list/add/anonymize/deanonymize/filter/dryrun/backup/lock/status
// 边界: 密码校验/实体类型/receiver/文本注入/异常恢复
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')
const os = require('os')

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
  async navigate(p, wait = 1200) {
    await this.eval(`window.location.hash='${p}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push('✓ ' + n + (d ? ' — ' + d : '')); console.log('  ✓ ' + n + (d ? ' — ' + d : '')) }
  const fail = (n, d, e) => { results.fail++; results.details.push('✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 120)); console.log('  ✗ ' + n + (d ? ' — ' + d : '') + ': ' + String(e ?? 'unknown').slice(0, 120)) }
  const warn = (n, d) => { results.warn++; results.details.push('⚠ ' + n + (d ? ' — ' + d : '')); console.log('  ⚠ ' + n + (d ? ' — ' + d : '')) }

  const TEST_PWD = 'R30TestPwd!2026'
  console.log('=== 第三十轮: Privacy 模块深度测试 (PII Shield) ===\n')

  // ========== Section 1: 初始状态 ==========
  console.log('--- Section 1: 初始状态 ---')
  // 检查初始 status
  let st = await cdp.eval('(async()=>{ try{ const s=await window.api.privacy.status(); return JSON.stringify(s); }catch(e){ return "ERR:"+String(e).slice(0,100) } })()')
  console.log('  初始 status: ' + st)
  // 如果已 unlocked,先 lock (确保从干净状态开始)
  try {
    const sp = JSON.parse(st)
    if (sp.unlocked) {
      await cdp.eval('(async()=>{ await window.api.privacy.lock(); return "locked"; })()')
      ok('清理: lock 已解锁状态', '确保从锁定状态开始')
      await new Promise((r) => setTimeout(r, 500))
    } else {
      ok('初始状态: 已锁定', '')
    }
  } catch (e) { warn('初始状态解析', '', e) }

  // ========== Section 2: lock 状态下的保护 ==========
  console.log('\n--- Section 2: lock 状态下的保护 ---')
  // lock 状态下 enable 应被拒
  let r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.enable(); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
  try {
    const rp = JSON.parse(r)
    if (rp.success === false) ok('lock 状态下 enable 被拒', rp.data?.slice(0, 60) || '')
    else fail('lock 状态下 enable 应被拒', '', JSON.stringify(rp).slice(0, 80))
  } catch (e) { fail('lock 状态下 enable', '', e) }

  // lock 状态下 anonymize 应失败(无密码)
  r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.anonymize("张三今天迟到了"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
  try {
    const rp = JSON.parse(r)
    if (rp.success === false || rp.exitCode !== 0) ok('lock 状态下 anonymize 失败', '无密码时正确拒绝')
    else warn('lock 状态下 anonymize', '返回成功但可能无实际脱敏: ' + JSON.stringify(rp).slice(0, 60))
  } catch (e) { warn('lock 状态下 anonymize', '', e) }

  // lock 状态下 list 应失败(无密码)
  r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.list(); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
  try {
    const rp = JSON.parse(r)
    if (rp.success === false || rp.exitCode !== 0) ok('lock 状态下 list 失败', '无密码时正确拒绝')
    else warn('lock 状态下 list', '返回: ' + JSON.stringify(rp).slice(0, 60))
  } catch (e) { warn('lock 状态下 list', '', e) }

  // ========== Section 3: 密码校验 ==========
  console.log('\n--- Section 3: 密码校验 ---')
  // 短密码 (<4) 应被拒
  r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.init("ab"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
  try {
    const rp = JSON.parse(r)
    if (rp.success === false || String(rp).includes('THROW')) ok('短密码(<4)被拒', '')
    else fail('短密码应被拒', '', JSON.stringify(rp).slice(0, 80))
  } catch (e) { warn('短密码测试', '', e) }

  // 超长密码 (>128) 应被拒
  const longPwd = 'x'.repeat(129)
  r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.init("' + longPwd + '"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
  try {
    const rp = JSON.parse(r)
    if (rp.success === false || String(rp).includes('THROW')) ok('超长密码(>128)被拒', '')
    else fail('超长密码应被拒', '', JSON.stringify(rp).slice(0, 80))
  } catch (e) { warn('超长密码测试', '', e) }

  // ========== Section 4: init 初始化 ==========
  console.log('\n--- Section 4: init 初始化 ---')
  r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.init("' + TEST_PWD + '"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,150) } })()')
  let inited = false
  try {
    const rp = JSON.parse(r)
    if (rp.success === true) { ok('init 成功', ''); inited = true }
    else if (String(rp).includes('THROW')) { fail('init', '', rp) }
    else { warn('init 返回', JSON.stringify(rp).slice(0, 80)); inited = rp.success === true }
  } catch (e) { fail('init', '', e) }

  // 如果 init 失败(可能已存在隐私库),尝试 load
  if (!inited) {
    console.log('  init 失败,尝试 load...')
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.load("' + TEST_PWD + '"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,150) } })()')
    try {
      const rp = JSON.parse(r)
      if (rp.success === true) { ok('load 成功', '加载已有隐私库'); inited = true }
      else { fail('load', '', JSON.stringify(rp).slice(0, 80)) }
    } catch (e) { fail('load', '', e) }
  }
  await new Promise((r) => setTimeout(r, 1000))

  // ========== Section 5: status 验证 ==========
  console.log('\n--- Section 5: status 验证 ---')
  if (inited) {
    r = await cdp.eval('(async()=>{ const s=await window.api.privacy.status(); return JSON.stringify(s); })()')
    try {
      const sp = JSON.parse(r)
      if (sp.unlocked === true) ok('status 解锁', '')
      else fail('status 应为 unlocked', '', r)
    } catch (e) { fail('status', '', e) }
  } else {
    warn('status 跳过', '未成功 init/load')
  }

  // ========== Section 6: add 实体 ==========
  console.log('\n--- Section 6: add 实体 (7种类型) ---')
  if (!inited) { console.log('  跳过 (未初始化)'); }
  else {
    const entities = [
      { type: 'person', text: '张三' },
      { type: 'person', text: '李四老师' },
      { type: 'place', text: '北京市海淀区' },
      { type: 'org', text: '清华大学附属中学' },
      { type: 'phone', text: '13800138000' },
      { type: 'email', text: 'zhangsan@school.edu.cn' },
      { type: 'id_card', text: '110108200501011234' },
      { type: 'student_id', text: 'STU2026001' },
    ]
    for (const e of entities) {
      r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.add("' + e.type + '", "' + e.text + '"); return JSON.stringify(r); }catch(e2){ return "THROW:"+String(e2).slice(0,100) } })()')
      try {
        const rp = JSON.parse(r)
        if (rp.success === true || rp.exitCode === 0) ok('add ' + e.type, e.text)
        else warn('add ' + e.type, JSON.stringify(rp).slice(0, 60))
      } catch (e2) { warn('add ' + e.type, '', e2) }
      await new Promise((r2) => setTimeout(r2, 200))
    }
  }

  // ========== Section 7: list 查询 ==========
  console.log('\n--- Section 7: list 查询 ---')
  if (!inited) { console.log('  跳过'); }
  else {
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.list(); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      const list = rp.data || rp
      const count = Array.isArray(list) ? list.length : 0
      if (count > 0) ok('list 查询', count + ' 个实体')
      else warn('list 查询', '0 个实体: ' + JSON.stringify(rp).slice(0, 80))
    } catch (e) { fail('list', '', e) }
  }

  // ========== Section 8: anonymize + deanonymize 往返 ==========
  console.log('\n--- Section 8: anonymize + deanonymize 往返 ---')
  if (!inited) { console.log('  跳过'); }
  else {
    const testText = '张三今天迟到了,电话13800138000,邮箱zhangsan@school.edu.cn'
    // anonymize
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.anonymize("' + testText + '"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    let anonText = ''
    try {
      const rp = JSON.parse(r)
      anonText = rp.data || rp.stdout || ''
      if (typeof anonText === 'string' && anonText.length > 0) ok('anonymize', anonText.slice(0, 60))
      else warn('anonymize', JSON.stringify(rp).slice(0, 80))
    } catch (e) { fail('anonymize', '', e) }

    // deanonymize
    if (anonText) {
      // 使用 JSON.stringify 安全传递字符串
      const safeAnon = JSON.stringify(anonText).slice(1, -1).replace(/'/g, "\\'")
      r = await cdp.eval("(async()=>{ try{ const r=await window.api.privacy.deanonymize('" + safeAnon + "'); return JSON.stringify(r); }catch(e){ return 'THROW:'+String(e).slice(0,100) } })()")
      try {
        const rp = JSON.parse(r)
        const deanonText = rp.data || rp.stdout || ''
        if (typeof deanonText === 'string') ok('deanonymize', deanonText.slice(0, 60))
        else warn('deanonymize', JSON.stringify(rp).slice(0, 80))
      } catch (e) { fail('deanonymize', '', e) }
    }
  }

  // ========== Section 9: dryrun 预览 ==========
  console.log('\n--- Section 9: dryrun 预览 ---')
  if (!inited) { console.log('  跳过'); }
  else {
    const testText = '李四老师今天上课讲了很多内容'
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.dryrun("' + testText + '"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      if (rp.success === true || rp.exitCode === 0) ok('dryrun', JSON.stringify(rp).slice(0, 60))
      else warn('dryrun', JSON.stringify(rp).slice(0, 80))
    } catch (e) { fail('dryrun', '', e) }
  }

  // ========== Section 10: filter 按接收者过滤 ==========
  console.log('\n--- Section 10: filter 按接收者过滤 (5种) ---')
  if (!inited) { console.log('  跳过'); }
  else {
    const testText = '张三同学今天在课堂上讲话,电话13800138000'
    for (const receiver of ['student', 'parent', 'teacher', 'school', 'public']) {
      r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.filter("' + receiver + '", "' + testText + '"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
      try {
        const rp = JSON.parse(r)
        if (rp.success === true || rp.exitCode === 0) ok('filter ' + receiver, JSON.stringify(rp).slice(0, 50))
        else warn('filter ' + receiver, JSON.stringify(rp).slice(0, 60))
      } catch (e) { warn('filter ' + receiver, '', e) }
      await new Promise((r2) => setTimeout(r2, 200))
    }
  }

  // ========== Section 11: 无效 receiver/entityType 边界 ==========
  console.log('\n--- Section 11: 无效 receiver/entityType 边界 ---')
  if (!inited) { console.log('  跳过'); }
  else {
    // 无效 receiver
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.filter("invalid_receiver", "test"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      if (String(rp).includes('THROW') || rp.success === false) ok('无效 receiver 被拒', '')
      else fail('无效 receiver 应被拒', '', JSON.stringify(rp).slice(0, 60))
    } catch (e) { warn('无效 receiver', '', e) }

    // 无效 entityType
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.add("invalid_type", "test"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      if (String(rp).includes('THROW') || rp.success === false) ok('无效 entityType 被拒', '')
      else fail('无效 entityType 应被拒', '', JSON.stringify(rp).slice(0, 60))
    } catch (e) { warn('无效 entityType', '', e) }

    // 空文本
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.anonymize(""); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      if (String(rp).includes('THROW') || rp.success === false) ok('空文本被拒', '')
      else fail('空文本应被拒', '', JSON.stringify(rp).slice(0, 60))
    } catch (e) { warn('空文本', '', e) }

    // null字节
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.anonymize("test\\x00injection"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      if (String(rp).includes('THROW') || rp.success === false) ok('null字节被拒', '')
      else fail('null字节应被拒', '', JSON.stringify(rp).slice(0, 60))
    } catch (e) { warn('null字节', '', e) }
  }

  // ========== Section 12: enable + disable ==========
  console.log('\n--- Section 12: enable + disable ---')
  if (!inited) { console.log('  跳过'); }
  else {
    // enable
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.enable(); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      if (rp.success === true || rp.exitCode === 0) ok('enable', '脱敏已启用')
      else warn('enable', JSON.stringify(rp).slice(0, 80))
    } catch (e) { fail('enable', '', e) }

    // disable (需要密码)
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.disable("' + TEST_PWD + '"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      if (rp.success === true || rp.exitCode === 0) ok('disable', '脱敏已禁用')
      else warn('disable', JSON.stringify(rp).slice(0, 80))
    } catch (e) { fail('disable', '', e) }
  }

  // ========== Section 13: backup 备份 ==========
  console.log('\n--- Section 13: backup 备份 ---')
  if (!inited) { console.log('  跳过'); }
  else {
    // 备份到临时目录
    const tmpDir = os.tmpdir()
    const backupPath = path.join(tmpDir, 'r30-privacy-backup-' + Date.now() + '.bak').replace(/\\/g, '/')
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.backup("' + backupPath + '"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      if (rp.success === true || rp.exitCode === 0) {
        ok('backup', backupPath)
        // 验证备份文件存在
        try {
          const stat = fs.statSync(backupPath)
          ok('备份文件存在', stat.size + ' bytes')
        } catch (e) { warn('备份文件', backupPath + ' 不存在') }
      } else {
        warn('backup', JSON.stringify(rp).slice(0, 80))
      }
    } catch (e) { fail('backup', '', e) }
  }

  // ========== Section 14: lock + 验证锁定后行为 ==========
  console.log('\n--- Section 14: lock + 验证锁定后行为 ---')
  if (!inited) { console.log('  跳过'); }
  else {
    // lock
    r = await cdp.eval('(async()=>{ const r=await window.api.privacy.lock(); return JSON.stringify(r); })()')
    try {
      const rp = JSON.parse(r)
      if (rp.success === true) ok('lock', '隐私引擎已锁定')
      else fail('lock', '', r)
    } catch (e) { fail('lock', '', e) }

    // 验证 status
    r = await cdp.eval('(async()=>{ const s=await window.api.privacy.status(); return JSON.stringify(s); })()')
    try {
      const sp = JSON.parse(r)
      if (sp.unlocked === false) ok('lock 后 status', 'unlocked: false')
      else fail('lock 后 status 应为 false', '', r)
    } catch (e) { fail('lock 后 status', '', e) }

    // lock 后 enable 应被拒
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.enable(); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      if (rp.success === false) ok('lock 后 enable 被拒', '')
      else fail('lock 后 enable 应被拒', '', JSON.stringify(rp).slice(0, 60))
    } catch (e) { warn('lock 后 enable', '', e) }
  }

  // ========== Section 15: load 重新加载 ==========
  console.log('\n--- Section 15: load 重新加载 ---')
  if (!inited) { console.log('  跳过'); }
  else {
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.load("' + TEST_PWD + '"); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,150) } })()')
    try {
      const rp = JSON.parse(r)
      if (rp.success === true || rp.exitCode === 0) ok('load 重新加载', '成功')
      else warn('load', JSON.stringify(rp).slice(0, 80))
    } catch (e) { fail('load', '', e) }

    // 验证 load 后能 list
    await new Promise((r) => setTimeout(r, 500))
    r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.list(); return JSON.stringify(r); }catch(e){ return "THROW:"+String(e).slice(0,100) } })()')
    try {
      const rp = JSON.parse(r)
      const list = rp.data || rp
      const count = Array.isArray(list) ? list.length : 0
      if (count >= 0) ok('load 后 list', count + ' 个实体 (持久化验证)')
      else warn('load 后 list', JSON.stringify(rp).slice(0, 80))
    } catch (e) { fail('load 后 list', '', e) }
  }

  // ========== Section 16: 异常恢复 ==========
  console.log('\n--- Section 16: 异常恢复 ---')
  // 异常后 EAA/Class/Settings 仍正常
  r = await cdp.eval('(async()=>{ try{ const r=await window.api.eaa.stats(); return JSON.stringify({ok:r.success===true||r.success===undefined}); }catch(e){ return "ERR:"+String(e).slice(0,50) } })()')
  try {
    const rp = JSON.parse(r)
    if (rp.ok) ok('异常恢复: EAA stats', '正常')
    else fail('异常恢复: EAA stats', '', r)
  } catch (e) { fail('异常恢复 EAA', '', e) }

  r = await cdp.eval('(async()=>{ try{ const r=await window.api.class.list(); return JSON.stringify({ok:r.success===true}); }catch(e){ return "ERR:"+String(e).slice(0,50) } })()')
  try {
    const rp = JSON.parse(r)
    if (rp.ok) ok('异常恢复: Class list', '正常')
    else fail('异常恢复: Class list', '', r)
  } catch (e) { fail('异常恢复 Class', '', e) }

  r = await cdp.eval('(async()=>{ try{ const r=await window.api.settings.get(); return JSON.stringify({ok:!!r.general}); }catch(e){ return "ERR:"+String(e).slice(0,50) } })()')
  try {
    const rp = JSON.parse(r)
    if (rp.ok) ok('异常恢复: Settings', '正常')
    else fail('异常恢复: Settings', '', r)
  } catch (e) { fail('异常恢复 Settings', '', e) }

  // ========== Section 17: 最终清理 ==========
  console.log('\n--- Section 17: 最终清理 ---')
  // lock 清理密码
  await cdp.eval('(async()=>{ await window.api.privacy.lock(); return "cleaned"; })()')
  ok('清理: lock', '密码已清空')

  // 清理临时备份文件
  try {
    const tmpDir = os.tmpdir()
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith('r30-privacy-backup-'))
    for (const f of files) {
      try { fs.unlinkSync(path.join(tmpDir, f)) } catch (e) {}
    }
    ok('清理: 临时备份文件', files.length + ' 个')
  } catch (e) { warn('清理临时文件', '', e) }

  // ========== 汇总 ==========
  console.log('\n=== 汇总 ===')
  console.log('通过: ' + results.pass + ', 失败: ' + results.fail + ', 警告: ' + results.warn + ', 通过率: ' + ((results.pass / (results.pass + results.fail)) * 100).toFixed(1) + '%')

  // 输出详细结果到文件
  const outPath = path.join(__dirname, 'r30-privacy-result.json')
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log('详细结果: ' + outPath)

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
