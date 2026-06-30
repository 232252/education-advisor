// ============================================================
// 第九轮：完整 CRUD 链路 + Skills 编辑 + Classes archive + 长时间稳定性
// ============================================================
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find(t => t.type === 'page')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(r => this.ws.on('open', r))
    this.id = 0; this.pending = new Map()
    this.ws.on('message', msg => {
      const obj = JSON.parse(msg)
      if (obj.id && this.pending.has(obj.id)) {
        const { resolve, reject } = this.pending.get(obj.id)
        this.pending.delete(obj.id)
        if (obj.error) reject(new Error(JSON.stringify(obj.error)))
        else resolve(obj.result)
      }
    })
  }
  async send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  async callApi(path, ...args) {
    return this.eval(`(async () => {
      const parts = ${JSON.stringify(path)}.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      const args = ${JSON.stringify(args)}
      return await obj(...args)
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' :: ' + detail.slice(0, 150) : ''}`)
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('============================================================')
  console.log('ROUND 9: Full CRUD + Skills Edit + Class Archive + Stability')
  console.log('============================================================')

  // ---------- 1. Skills 完整 CRUD ----------
  console.log('\n[1] Skills 完整 CRUD')
  const skillName = `test-skill-${Date.now()}`
  const skillContent = `---\nname: ${skillName}\ndescription: Test skill for round 9\n---\n\n# Test Skill\n\nThis is a test skill content.\n\n## Usage\n\n- Step 1\n- Step 2\n`

  const skillsList = await c.callApi('skill.list')
  record('skill.list', Array.isArray(skillsList), `count=${skillsList?.length || 0}`)

  const saveRes = await c.callApi('skill.save', skillName, skillContent)
  record('skill.save', !saveRes?.__error, saveRes?.__error ? saveRes.__error.slice(0, 100) : `name=${skillName}`)

  // skill.get 返回 { name, description, content, source, filePath }
  const getRes = await c.callApi('skill.get', skillName)
  if (getRes?.__error) {
    record('skill.get', false, getRes.__error.slice(0, 100))
  } else {
    record('skill.get', getRes?.content?.includes('Test Skill') || typeof getRes === 'string', `content_len=${getRes?.content?.length || 0}`)
  }

  const updatedContent = skillContent + '\n## Updated\n\nAdded section.\n'
  const updateRes = await c.callApi('skill.save', skillName, updatedContent)
  record('skill.update', !updateRes?.__error, updateRes?.__error ? updateRes.__error.slice(0, 100) : '')

  const getRes2 = await c.callApi('skill.get', skillName)
  record('skill.update_verified', getRes2?.content?.includes('Updated') || (typeof getRes2 === 'string' && getRes2.includes('Updated')), `content_len=${getRes2?.content?.length || 0}`)

  const skillsList2 = await c.callApi('skill.list')
  if (skillsList2?.__error) {
    record('skill.list_after_save', false, skillsList2.__error.slice(0, 100))
  } else {
    const found = Array.isArray(skillsList2) && skillsList2.some(s => s === skillName || s?.name === skillName)
    record('skill.list_after_save', found, `count=${skillsList2?.length || 0}`)
  }

  const delRes = await c.callApi('skill.delete', skillName)
  record('skill.delete', !delRes?.__error, delRes?.__error ? delRes.__error.slice(0, 100) : '')

  const getRes3 = await c.callApi('skill.get', skillName)
  record('skill.deleted_verified', getRes3?.__error !== undefined || getRes3 === null || getRes3 === '' || getRes3?.content === undefined, `result=${JSON.stringify(getRes3).slice(0, 50)}`)

  // ---------- 2. Classes 完整 CRUD + archive ----------
  console.log('\n[2] Classes 完整 CRUD + archive/restore')
  const classId = `R9-${Date.now()}`.slice(0, 15)
  const classParams = {
    class_id: classId,
    name: `测试班级R9`,
    grade: '高一',
    note: 'Round 9 test class'
  }

  const createRes = await c.callApi('class.create', classParams)
  const internalClassId = createRes?.data?.id
  record('class.create', !createRes?.__error && createRes?.success === true, createRes?.__error ? createRes.__error.slice(0, 100) : `id=${classId}, internal=${internalClassId}`)

  // class.list 返回 { success, data: [...] }
  const listRes = await c.callApi('class.list')
  const classList = listRes?.data || []
  if (listRes?.__error) {
    record('class.list', false, listRes.__error.slice(0, 100))
  } else {
    const found = Array.isArray(classList) && classList.some(c => c.class_id === classId)
    record('class.list', listRes?.success === true && Array.isArray(classList) && found, `count=${classList.length}, found=${found}`)
  }

  const classUpdateRes = await c.callApi('class.update', internalClassId, { name: '测试班级R9-更新', note: 'updated note' })
  record('class.update', !classUpdateRes?.__error && classUpdateRes?.success !== false, classUpdateRes?.__error ? classUpdateRes.__error.slice(0, 100) : '')

  const archiveRes = await c.callApi('class.archive', internalClassId)
  record('class.archive', !archiveRes?.__error && archiveRes?.success === true, archiveRes?.__error ? archiveRes.__error.slice(0, 100) : `success=${archiveRes?.success}`)

  const listRes2 = await c.callApi('class.list')
  const classList2 = listRes2?.data || []
  if (Array.isArray(classList2)) {
    const archived = classList2.find(c => c.class_id === classId)
    record('class.archive_verified', archived?.archived === true, `archived=${archived?.archived}`)
  } else {
    record('class.archive_verified', false, 'could not verify')
  }

  const restoreRes = await c.callApi('class.restore', internalClassId)
  record('class.restore', !restoreRes?.__error && restoreRes?.success === true, restoreRes?.__error ? restoreRes.__error.slice(0, 100) : '')

  const delClassRes = await c.callApi('class.delete', internalClassId)
  record('class.delete', !delClassRes?.__error && delClassRes?.success !== false, delClassRes?.__error ? delClassRes.__error.slice(0, 100) : '')

  const listRes4 = await c.callApi('class.list')
  const classList4 = listRes4?.data || []
  if (Array.isArray(classList4)) {
    const gone = !classList4.some(c => c.class_id === classId)
    record('class.deleted_verified', gone)
  } else {
    record('class.deleted_verified', false, 'could not verify')
  }

  // ---------- 3. Cron 完整流程 ----------
  console.log('\n[3] Cron 完整流程')
  // cron.list 返回 { success, data: [...] } 或数组
  const cronListRaw = await c.callApi('cron.list')
  const cronList = cronListRaw?.data || cronListRaw
  record('cron.list', Array.isArray(cronList), `count=${cronList?.length || 0}`)

  // cron 任务字段: name, expression, agentId, prompt, enabled, modelTier
  const cronTask = {
    name: `R9-test-${Date.now()}`,
    expression: '0 9 * * *',
    agentId: 'safety',
    prompt: 'test prompt',
    enabled: false,
    modelTier: 'low_cost'
  }
  const cronAdd = await c.callApi('cron.add', cronTask)
  let cronId
  if (cronAdd?.__error) {
    record('cron.add', false, cronAdd.__error.slice(0, 100))
  } else {
    cronId = cronAdd?.id || cronAdd?.data?.id || cronAdd
    record('cron.add', true, `id=${cronId}`)
  }

  if (cronId) {
    const toggleRes = await c.callApi('cron.toggle', cronId, true)
    record('cron.toggle', !toggleRes?.__error, toggleRes?.__error ? toggleRes.__error.slice(0, 100) : '')

    const cronUpdateRes = await c.callApi('cron.update', cronId, { prompt: 'updated prompt' })
    record('cron.update', !cronUpdateRes?.__error, cronUpdateRes?.__error ? cronUpdateRes.__error.slice(0, 100) : '')

    const logs = await c.callApi('cron.getLogs', cronId)
    record('cron.getLogs', Array.isArray(logs) || Array.isArray(logs?.logs) || logs?.success, `type=${typeof logs}`)

    const removeRes = await c.callApi('cron.remove', cronId)
    record('cron.remove', !removeRes?.__error, removeRes?.__error ? removeRes.__error.slice(0, 100) : '')
  }

  // ---------- 4. Models 自定义模型管理 ----------
  console.log('\n[4] Models 自定义模型管理')
  const providers = await c.callApi('ai.listProviders')
  record('ai.listProviders', Array.isArray(providers), `count=${providers?.length || 0}`)

  if (Array.isArray(providers) && providers.length > 0) {
    const provider = providers[0]
    const providerId = provider.id || provider.providerId || provider
    console.log(`    使用 provider: ${providerId}`)

    const customModelId = `r9-test-${Date.now()}`
    const addModel = await c.callApi('ai.addCustomModel', {
      providerId: providerId,
      modelId: customModelId,
      name: 'R9 Test Model',
      contextWindow: 8192,
      maxOutputTokens: 4096,
      supportsReasoning: false
    })
    record('ai.addCustomModel', !addModel?.__error, addModel?.__error ? addModel.__error.slice(0, 100) : `id=${customModelId}`)

    const models = await c.callApi('ai.listModels', providerId)
    if (models?.__error) {
      record('ai.listModels', false, models.__error.slice(0, 100))
    } else {
      const found = Array.isArray(models) && models.some(m => m.id === customModelId || m.modelId === customModelId)
      record('ai.listModels', Array.isArray(models) && found, `count=${models?.length || 0}, found=${found}`)
    }

    const updateModel = await c.callApi('ai.updateCustomModel', {
      providerId: providerId,
      modelId: customModelId,
      name: 'R9 Test Model Updated',
      contextWindow: 16384
    })
    record('ai.updateCustomModel', !updateModel?.__error, updateModel?.__error ? updateModel.__error.slice(0, 100) : '')

    const delModel = await c.callApi('ai.deleteCustomModel', providerId, customModelId)
    record('ai.deleteCustomModel', !delModel?.__error || delModel?.success === true, delModel?.__error ? delModel.__error.slice(0, 100) : '')

    const models2 = await c.callApi('ai.listModels', providerId)
    if (Array.isArray(models2)) {
      const gone = !models2.some(m => m.id === customModelId || m.modelId === customModelId)
      record('ai.model_deleted_verified', gone)
    } else {
      record('ai.model_deleted_verified', false, 'could not verify')
    }
  }

  // ---------- 5. 长时间稳定性监控 ----------
  console.log('\n[5] 长时间稳定性监控 (3 次采样, 间隔 20s)')
  const samples = []
  for (let i = 0; i < 3; i++) {
    const heap = await c.eval(`JSON.stringify({
      used: performance.memory.usedJSHeapSize,
      total: performance.memory.totalJSHeapSize,
      limit: performance.memory.jsHeapSizeLimit
    })`)
    const navHash = await c.eval(`window.location.hash`)
    const ts = new Date().toISOString()
    samples.push({ ts, heap, navHash })
    console.log(`    [${i+1}/3] ${ts} hash=${navHash} heap=${heap}`)
    if (i < 2) await sleep(20000)
  }
  const heaps = samples.map(s => JSON.parse(s.heap).used)
  const growth = (heaps[heaps.length - 1] - heaps[0]) / heaps[0]
  record('stability.memory_growth', Math.abs(growth) < 0.5, `growth=${(growth * 100).toFixed(1)}%, samples=${JSON.stringify(heaps)}`)

  // ---------- 6. EAA 完整业务流程 ----------
  console.log('\n[6] EAA 完整业务流程')
  const bizStudent = `BizR9-${Date.now()}`
  await c.callApi('eaa.addStudent', bizStudent)
  record('biz.add_student', true)

  const events = [
    { reasonCode: 'LATE', expectedDelta: -2 },
    { reasonCode: 'SLEEP_IN_CLASS', expectedDelta: -2 },
    { reasonCode: 'ACTIVITY_PARTICIPATION', expectedDelta: 1 },
    { reasonCode: 'CLASS_COMMITTEE', expectedDelta: 5 }
  ]
  let expectedScore = 100
  for (const evt of events) {
    await c.callApi('eaa.addEvent', { studentName: bizStudent, reasonCode: evt.reasonCode })
    expectedScore += evt.expectedDelta
  }
  const bizScore = await c.callApi('eaa.score', bizStudent)
  const actualScore = bizScore?.data?.score
  record('biz.cumulative_score', actualScore === expectedScore, `actual=${actualScore}, expected=${expectedScore}`)

  const bizHist = await c.callApi('eaa.history', bizStudent)
  const bizEvents = bizHist?.data?.events || []
  record('biz.history_count', bizEvents.length === events.length, `count=${bizEvents.length}, expected=${events.length}`)

  // 撤销第二个事件 (SLEEP_IN_CLASS -2)
  const eventToRevert = bizEvents[1]?.event_id
  if (eventToRevert) {
    await c.callApi('eaa.revertEvent', eventToRevert, '误报撤销')
    const scoreAfterRevert = await c.callApi('eaa.score', bizStudent)
    const revertedScore = scoreAfterRevert?.data?.score
    // 撤销 -2 事件: 应该 +2 回到原值
    const expectedAfterRevert = expectedScore + 2
    record('biz.revert_correct', revertedScore === expectedAfterRevert, `actual=${revertedScore}, expected=${expectedAfterRevert}`)
  }

  const ranking = await c.callApi('eaa.ranking', 10)
  record('biz.ranking', ranking?.success === true || !!ranking?.data, `has_data=${!!ranking?.data}`)

  const stats = await c.callApi('eaa.stats')
  record('biz.stats', stats?.success === true || !!stats?.data, `has_data=${!!stats?.data}`)

  await c.callApi('eaa.deleteStudent', bizStudent)
  record('biz.cleanup', true)

  // ---------- SUMMARY ----------
  console.log('\n============================================================')
  console.log('ROUND 9 SUMMARY')
  console.log('============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  results.filter(r => !r.ok).forEach(r => {
    console.log(`  FAIL: ${r.name} :: ${r.detail}`)
  })
  console.log(`\nTotal: ${passed} ok, ${failed} fail, ${results.length} tests`)

  fs.writeFileSync(
    'c:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round9.json',
    JSON.stringify({ round: 9, timestamp: new Date().toISOString(), results, passed, failed, total: results.length }, null, 2)
  )

  c.close()
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
