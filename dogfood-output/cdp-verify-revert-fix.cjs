// 验证 EAA revert 修复
const http = require('http')
const WebSocket = require('ws')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}

async function main() {
  const targets = await getTargets()
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.on('open', r))
  let id = 0
  const pending = new Map()
  ws.on('message', msg => {
    const obj = JSON.parse(msg)
    if (obj.id && pending.has(obj.id)) {
      const { resolve, reject } = pending.get(obj.id)
      pending.delete(obj.id)
      if (obj.error) reject(new Error(JSON.stringify(obj.error)))
      else resolve(obj.result)
    }
  })
  async function callApi(path, ...args) {
    const i = ++id
    return new Promise((resolve, reject) => {
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({
        id: i, method: 'Runtime.evaluate',
        params: { expression: `(async () => {
          const parts = ${JSON.stringify(path)}.split('.')
          let obj = window.api
          for (const p of parts) obj = obj[p]
          const args = ${JSON.stringify(args)}
          return await obj(...args)
        })()`, awaitPromise: true, returnByValue: true }
      }))
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout')) } }, 60000)
    })
  }
  function extract(result) {
    if (result.exceptionDetails) return { __error: result.exceptionDetails.exception?.description || result.exceptionDetails.text }
    return result.result.value
  }

  // 需要重启 Electron 才能加载新的 EAA 二进制
  // 但 eaaBridge.execute 每次 spawn 新进程,所以新二进制会立即生效
  console.log('=== EAA Revert 修复验证 ===\n')

  const student = `RevertFix-${Date.now()}`
  console.log(`测试学生: ${student}`)

  // 创建学生
  await callApi('eaa.addStudent', student)
  console.log('✓ addStudent')

  // 查初始分
  const r1 = extract(await callApi('eaa.score', student))
  const scoreBefore = r1?.data?.score
  console.log(`初始分: ${scoreBefore}`)

  // 添加 LATE (-2)
  await callApi('eaa.addEvent', { studentName: student, reasonCode: 'LATE' })
  const r2 = extract(await callApi('eaa.score', student))
  const scoreAfterLate = r2?.data?.score
  console.log(`LATE 后: ${scoreAfterLate} (期望 ${scoreBefore - 2})`)

  // 获取 event_id
  const hist = extract(await callApi('eaa.history', student))
  const events = hist?.data?.events || []
  const eventId = events[events.length - 1]?.event_id
  console.log(`eventId: ${eventId}`)

  // revert
  await callApi('eaa.revertEvent', eventId, 'test revert fix')
  const r3 = extract(await callApi('eaa.score', student))
  const scoreAfterRevert = r3?.data?.score
  console.log(`revert 后: ${scoreAfterRevert} (期望 ${scoreBefore})`)

  // 验证
  if (scoreAfterRevert === scoreBefore) {
    console.log('\n✅ BUG 已修复! revert 后分数正确恢复')
  } else {
    console.log(`\n❌ BUG 未修复! revert 后分数=${scoreAfterRevert}, 期望=${scoreBefore}`)
  }

  // 再测试一个加分场景
  console.log('\n--- 加分场景测试 ---')
  const student2 = `RevertFix2-${Date.now()}`
  await callApi('eaa.addStudent', student2)
  const r4 = extract(await callApi('eaa.score', student2))
  const score2Before = r4?.data?.score
  console.log(`学生2 初始分: ${score2Before}`)

  // 加 ACTIVITY_PARTICIPATION (+1)
  await callApi('eaa.addEvent', { studentName: student2, reasonCode: 'ACTIVITY_PARTICIPATION' })
  const r5 = extract(await callApi('eaa.score', student2))
  const score2AfterBonus = r5?.data?.score
  console.log(`ACTIVITY_PARTICIPATION 后: ${score2AfterBonus} (期望 ${score2Before + 1})`)

  // revert
  const hist2 = extract(await callApi('eaa.history', student2))
  const eventId2 = hist2?.data?.events?.[hist2.data.events.length - 1]?.event_id
  await callApi('eaa.revertEvent', eventId2, 'test revert bonus')
  const r6 = extract(await callApi('eaa.score', student2))
  const score2AfterRevert = r6?.data?.score
  console.log(`revert 后: ${score2AfterRevert} (期望 ${score2Before})`)

  if (score2AfterRevert === score2Before) {
    console.log('✅ 加分 revert 也正确!')
  } else {
    console.log(`❌ 加分 revert 错误! 分数=${score2AfterRevert}, 期望=${score2Before}`)
  }

  // 清理
  await callApi('eaa.deleteStudent', student)
  await callApi('eaa.deleteStudent', student2)
  console.log('\n清理完成')

  ws.close()
}
main().catch(e => { console.error(e); process.exit(1) })
