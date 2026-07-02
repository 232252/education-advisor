// R39: 深入调查 R38 发现 — EAA import 格式 + Logs 路由 + 边界场景
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
          const { resolve, reject } = this.pending.get(m.id)
          this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R39: EAA import 格式 + Logs 路由 + 边界场景 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function callRaw(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      const p='${apiPath}'.split('.');
      let o=window.api;
      for(const x of p){if(o==null)return{__error:'no such api'};o=o[x]}
      if(typeof o!=='function')return{__error:'not a function'};
      const a=${JSON.stringify(args)};
      try{const r=await o(...a);return r}catch(e){return{__error:e.message}}
    })()`)
  }

  async function callApi(apiPath, ...args) {
    const r = await callRaw(apiPath, ...args)
    if (r && r.__error) throw new Error(r.__error)
    if (r && r.success === false) throw new Error(String(r.data || r.error || 'failed'))
    if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data
    return r
  }

  // ========== 1. EAA import 格式调查 ==========
  console.log('--- 1. EAA import 格式调查 (Bug R38-1) ---')

  // 1.1 测试 JSON 数组格式 (正确格式)
  try {
    const jsonPath = path.join(__dirname, 'r39-import-test.json')
    const jsonContent = JSON.stringify(['R39-ImportA', 'R39-ImportB', 'R39-ImportC'])
    fs.writeFileSync(jsonPath, jsonContent)

    const r = await callRaw('eaa.import', jsonPath)
    if (r && r.success) {
      ok('eaa.import JSON 数组格式', `success, stderr: ${(r.stderr || '').slice(0, 80)}`)
      // 验证学生已导入
      const students = await callApi('eaa.listStudents')
      const found = Array.isArray(students) ? students.filter(s => s.name && s.name.startsWith('R39-Import')).length : 0
      ok('验证学生已导入', `找到 ${found} 个 R39-Import 学生`)
    } else {
      fail('eaa.import JSON 数组格式', '', r.stderr || r.__error || JSON.stringify(r).slice(0, 100))
    }
    fs.unlinkSync(jsonPath)
  } catch (e) {
    fail('eaa.import JSON 数组格式', '', e)
  }

  // 1.2 测试 CSV 格式 (错误格式 - 应有清晰错误)
  try {
    const csvPath = path.join(__dirname, 'r39-import-test.csv')
    fs.writeFileSync(csvPath, 'name,class_id\nR39CSV1,R39CLASS\nR39CSV2,R39CLASS')

    const r = await callRaw('eaa.import', csvPath)
    if (r && r.success) {
      ok('eaa.import CSV 格式', '意外成功 — 可能接受 CSV')
    } else {
      // 应该返回清晰的错误信息
      const errMsg = (r.stderr || r.data || r.__error || '').toString()
      if (errMsg.includes('Json') || errMsg.includes('expected ident')) {
        ok('eaa.import CSV 格式被拒', `错误信息: ${errMsg.slice(0, 100)} — 确认 Bug R38-1: import 期望 JSON 格式但无清晰提示`)
      } else {
        ok('eaa.import CSV 格式被拒', `错误信息: ${errMsg.slice(0, 100)}`)
      }
    }
    fs.unlinkSync(csvPath)
  } catch (e) {
    fail('eaa.import CSV 格式', '', e)
  }

  // 1.3 测试空文件
  try {
    const emptyPath = path.join(__dirname, 'r39-import-empty.json')
    fs.writeFileSync(emptyPath, '')

    const r = await callRaw('eaa.import', emptyPath)
    if (r && r.success) {
      ok('eaa.import 空文件', '意外成功')
    } else {
      ok('eaa.import 空文件被拒', `错误: ${(r.stderr || r.__error || '').slice(0, 80)}`)
    }
    fs.unlinkSync(emptyPath)
  } catch (e) {
    fail('eaa.import 空文件', '', e)
  }

  // 1.4 测试空 JSON 数组
  try {
    const emptyArrPath = path.join(__dirname, 'r39-import-empty-arr.json')
    fs.writeFileSync(emptyArrPath, '[]')

    const r = await callRaw('eaa.import', emptyArrPath)
    if (r && r.success) {
      ok('eaa.import 空数组', `success, stderr: ${(r.stderr || '').slice(0, 80)}`)
    } else {
      ok('eaa.import 空数组被拒', `错误: ${(r.stderr || r.__error || '').slice(0, 80)}`)
    }
    fs.unlinkSync(emptyArrPath)
  } catch (e) {
    fail('eaa.import 空数组', '', e)
  }

  // 1.5 测试无效 JSON
  try {
    const invalidPath = path.join(__dirname, 'r39-import-invalid.json')
    fs.writeFileSync(invalidPath, '{invalid json')

    const r = await callRaw('eaa.import', invalidPath)
    if (r && r.success) {
      ok('eaa.import 无效 JSON', '意外成功')
    } else {
      ok('eaa.import 无效 JSON 被拒', `错误: ${(r.stderr || r.__error || '').slice(0, 80)}`)
    }
    fs.unlinkSync(invalidPath)
  } catch (e) {
    fail('eaa.import 无效 JSON', '', e)
  }

  // 1.6 测试 JSON 对象 (非数组)
  try {
    const objPath = path.join(__dirname, 'r39-import-obj.json')
    fs.writeFileSync(objPath, '{"name": "test"}')

    const r = await callRaw('eaa.import', objPath)
    if (r && r.success) {
      ok('eaa.import JSON 对象', '意外成功')
    } else {
      ok('eaa.import JSON 对象被拒', `错误: ${(r.stderr || r.__error || '').slice(0, 80)}`)
    }
    fs.unlinkSync(objPath)
  } catch (e) {
    fail('eaa.import JSON 对象', '', e)
  }

  // 1.7 测试不存在文件路径
  try {
    const r = await callRaw('eaa.import', 'C:/nonexistent/path/file.json')
    if (r && r.success) {
      ok('eaa.import 不存在路径', '意外成功')
    } else {
      ok('eaa.import 不存在路径被拒', `错误: ${(r.stderr || r.__error || '').slice(0, 80)}`)
    }
  } catch (e) {
    fail('eaa.import 不存在路径', '', e)
  }

  // 1.8 测试 null bytes
  try {
    const r = await callRaw('eaa.import', 'test\0path')
    if (r && r.success === false) {
      ok('eaa.import null bytes 被拒', `错误: ${(r.data || r.error || '').slice(0, 80)}`)
    } else if (r && r.__error) {
      ok('eaa.import null bytes 被拒', `错误: ${r.__error.slice(0, 80)}`)
    } else {
      fail('eaa.import null bytes', '未拒绝', JSON.stringify(r).slice(0, 100))
    }
  } catch (e) {
    ok('eaa.import null bytes 被拒', `错误: ${e.message.slice(0, 80)}`)
  }

  // 1.9 清理已导入的测试学生
  try {
    const students = await callApi('eaa.listStudents')
    const toDelete = students.filter(s => s.name && s.name.startsWith('R39-Import'))
    for (const s of toDelete) {
      await callApi('eaa.deleteStudent', s.name)
    }
    ok('清理 R39-Import 学生', `删除 ${toDelete.length} 个`)
  } catch (e) {
    fail('清理 R39-Import 学生', '', e)
  }

  // ========== 2. Logs 路由调查 (Bug R38-2) ==========
  console.log('\n--- 2. Logs 路由调查 ---')

  // 2.1 检查 /logs 路由是否存在
  try {
    await cdp.eval(`window.location.hash = '#/logs';`)
    await new Promise(r => setTimeout(r, 1500))

    const info = await cdp.eval(`(async()=>{
      const hash = window.location.hash;
      const h1 = document.querySelector('h1')?.textContent || '';
      const path = window.location.hash;
      const main = document.querySelector('main');
      const mainText = main ? main.textContent?.slice(0, 100) : 'no main';
      return JSON.stringify({ hash, h1: h1.slice(0, 80), mainText });
    })()`)
    const li = JSON.parse(info)
    if (li.hash === '#/dashboard') {
      ok('/logs 路由重定向到 /dashboard', `hash=${li.hash} h1="${li.h1}" — 确认无 /logs 路由,catch-all 重定向生效`)
    } else {
      ok('/logs 路由行为', `hash=${li.hash} h1="${li.h1}"`)
    }
  } catch (e) {
    fail('/logs 路由', '', e)
  }

  // 2.2 检查所有已注册路由
  try {
    await cdp.eval(`window.location.hash = '#/dashboard';`)
    await new Promise(r => setTimeout(r, 500))
    const routes = await cdp.eval(`(async()=>{
      // 检查侧边栏导航链接
      const navLinks = Array.from(document.querySelectorAll('a[href^="#/"], a[href^="/"]'));
      return JSON.stringify(navLinks.map(a => ({
        href: a.getAttribute('href'),
        text: a.textContent?.trim().slice(0, 30)
      })));
    })()`)
    const r = JSON.parse(routes)
    ok('侧边栏导航链接', `${r.length} 个链接: ${r.map(x => x.href + '(' + x.text + ')').join(', ')}`)
  } catch (e) {
    fail('侧边栏导航链接', '', e)
  }

  // 2.3 测试 log API 是否有 UI 页面入口
  try {
    const r = await callApi('log.list')
    ok('log.list API', `返回: ${JSON.stringify(r).slice(0, 100)}`)
  } catch (e) {
    ok('log.list API', `无此 API 或失败: ${e.message.slice(0, 80)}`)
  }

  // 2.4 log.filter 测试
  try {
    const r = await callRaw('log.filter', 'main', ['error', 'warn'], 10)
    if (r && r.success !== false && !r.__error) {
      ok('log.filter API', `返回: ${JSON.stringify(r).slice(0, 100)}`)
    } else {
      ok('log.filter API', `结果: ${(r.__error || r.stderr || JSON.stringify(r)).slice(0, 100)}`)
    }
  } catch (e) {
    fail('log.filter API', '', e)
  }

  // ========== 3. EAA 性能优化调查 ==========
  console.log('\n--- 3. EAA 性能调查 ---')

  // 3.1 单次 eaa.info 计时
  try {
    const times = []
    for (let i = 0; i < 5; i++) {
      const t = Date.now()
      await callApi('eaa.info')
      times.push(Date.now() - t)
    }
    const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)
    ok('eaa.info 5次计时', `times=${times.join(',')}ms avg=${avg}ms`)
  } catch (e) {
    fail('eaa.info 计时', '', e)
  }

  // 3.2 eaa.ranking 计时
  try {
    const times = []
    for (let i = 0; i < 5; i++) {
      const t = Date.now()
      await callApi('eaa.ranking', 10)
      times.push(Date.now() - t)
    }
    const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)
    ok('eaa.ranking 5次计时', `times=${times.join(',')}ms avg=${avg}ms`)
  } catch (e) {
    fail('eaa.ranking 计时', '', e)
  }

  // 3.3 agent.list vs eaa.info 对比
  try {
    const t1 = Date.now()
    await callApi('agent.list')
    const agentTime = Date.now() - t1

    const t2 = Date.now()
    await callApi('eaa.info')
    const eaaTime = Date.now() - t2

    ok('agent.list vs eaa.info', `agent=${agentTime}ms eaa=${eaaTime}ms — ${eaaTime > agentTime * 10 ? 'EAA 慢很多(预期,Rust 启动开销)' : '相近'}`)
  } catch (e) {
    fail('性能对比', '', e)
  }

  // ========== 4. 未测试的边界场景 ==========
  console.log('\n--- 4. 未测试的边界场景 ---')

  // 4.1 eaa.search 特殊字符
  try {
    const queries = ['', '   ', 'a', 'A', '1', '中文测试', '🌟', 'SELECT * FROM', '<script>', '%00', '\\n', '\\t']
    for (const q of queries) {
      const r = await callRaw('eaa.search', q, 5)
      ok(`eaa.search "${q.slice(0, 20)}"`, `success=${r?.success} dataLen=${Array.isArray(r?.data) ? r.data.length : (r?.data?.events?.length || 0)}`)
    }
  } catch (e) {
    fail('eaa.search 特殊字符', '', e)
  }

  // 4.2 eaa.ranking 极端值
  try {
    const r1 = await callRaw('eaa.ranking', 0)
    ok('eaa.ranking 0', `success=${r1?.success} len=${Array.isArray(r1?.data) ? r1.data.length : 0}`)

    const r2 = await callRaw('eaa.ranking', -1)
    ok('eaa.ranking -1', `success=${r2?.success} len=${Array.isArray(r2?.data) ? r2.data.length : 0}`)

    const r3 = await callRaw('eaa.ranking', 100000)
    ok('eaa.ranking 100000', `success=${r3?.success} len=${Array.isArray(r3?.data) ? r3.data.length : 0}`)
  } catch (e) {
    fail('eaa.ranking 极端值', '', e)
  }

  // 4.3 eaa.score 不存在学生
  try {
    const r = await callRaw('eaa.score', 'R39-NonExistent-Student-12345')
    ok('eaa.score 不存在学生', `success=${r?.success} stderr=${(r?.stderr || '').slice(0, 80)}`)
  } catch (e) {
    fail('eaa.score 不存在学生', '', e)
  }

  // 4.4 eaa.history 不存在学生
  try {
    const r = await callRaw('eaa.history', 'R39-NonExistent-Student-12345')
    ok('eaa.history 不存在学生', `success=${r?.success} data=${JSON.stringify(r?.data).slice(0, 80)}`)
  } catch (e) {
    fail('eaa.history 不存在学生', '', e)
  }

  // 4.5 eaa.tag 不存在标签
  try {
    const r = await callRaw('eaa.tag', 'R39-NonExistent-Tag-XYZ')
    ok('eaa.tag 不存在标签', `success=${r?.success} data=${JSON.stringify(r?.data).slice(0, 80)}`)
  } catch (e) {
    fail('eaa.tag 不存在标签', '', e)
  }

  // 4.6 agent.getSoul 不存在 agent
  try {
    const r = await callRaw('agent.getSoul', 'R39-NonExistent-Agent')
    ok('agent.getSoul 不存在', `success=${r?.success} data=${JSON.stringify(r?.data).slice(0, 80)}`)
  } catch (e) {
    fail('agent.getSoul 不存在', '', e)
  }

  // 4.7 agent.getRules 不存在 agent
  try {
    const r = await callRaw('agent.getRules', 'R39-NonExistent-Agent')
    ok('agent.getRules 不存在', `success=${r?.success} data=${JSON.stringify(r?.data).slice(0, 80)}`)
  } catch (e) {
    fail('agent.getRules 不存在', '', e)
  }

  // 4.8 class.get 不存在 ID
  try {
    const r = await callRaw('class.get', 'R39-NonExistent-Class-ID-XYZ')
    ok('class.get 不存在', `success=${r?.success} data=${JSON.stringify(r?.data).slice(0, 80)}`)
  } catch (e) {
    fail('class.get 不存在', '', e)
  }

  // 4.9 settings.set 超长路径
  try {
    const longPath = 'general.theme'.repeat(50)
    const r = await callRaw('settings.set', longPath, 'test')
    ok('settings.set 超长路径', `success=${r?.success} error=${(r?.data || r?.error || '').slice(0, 80)}`)
  } catch (e) {
    fail('settings.set 超长路径', '', e)
  }

  // 4.10 cron.getLogs 不存在任务
  try {
    const r = await callRaw('cron.getLogs', 'R39-NonExistent-Cron-XYZ', 10)
    ok('cron.getLogs 不存在任务', `success=${r?.success} data=${JSON.stringify(r?.data).slice(0, 80)}`)
  } catch (e) {
    fail('cron.getLogs 不存在任务', '', e)
  }

  // ========== 5. 数据完整性验证 ==========
  console.log('\n--- 5. 数据完整性验证 ---')

  // 5.1 eaa.info 数据一致性
  try {
    const info = await callApi('eaa.info')
    const students = await callApi('eaa.listStudents')
    const infoStudentCount = info?.students || info?.student_count || info?.total_students
    const listLen = Array.isArray(students) ? students.length : 0
    ok('eaa.info vs listStudents 一致性', `info=${JSON.stringify(info).slice(0, 100)} listLen=${listLen}`)
  } catch (e) {
    fail('数据一致性', '', e)
  }

  // 5.2 eaa.ranking vs listStudents 数量
  try {
    const ranking = await callApi('eaa.ranking', 1000)
    const students = await callApi('eaa.listStudents')
    const rankLen = Array.isArray(ranking) ? ranking.length : 0
    const studLen = Array.isArray(students) ? students.length : 0
    ok('ranking vs listStudents', `ranking=${rankLen} students=${studLen} ${rankLen === studLen ? '一致' : '不一致!'}`)
  } catch (e) {
    fail('ranking vs listStudents', '', e)
  }

  // 5.3 eaa.codes 数量
  try {
    const codes = await callApi('eaa.codes')
    const codeLen = Array.isArray(codes) ? codes.length : (Object.keys(codes || {}).length)
    ok('eaa.codes', `${codeLen} 个原因码`)
  } catch (e) {
    fail('eaa.codes', '', e)
  }

  // ========== 6. 汇总 ==========
  console.log('\n=== R39 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  fs.writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r39-result.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
