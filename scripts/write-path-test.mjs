// 写入链路 + Agent 运行 + 飞书异常测试
import WebSocket from 'ws'

const page = (await (await fetch('http://localhost:9222/json')).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0
const pending = new Map()
const consoleErrors = []
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    consoleErrors.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 250)}`)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(`[exception] ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description?.slice(0, 250) || ''}`)
  }
})
const send = (method, params = {}, timeout = 40000) => new Promise((res, rej) => {
  const mid = ++id
  const t = setTimeout(() => { pending.delete(mid); rej(new Error(`timeout ${method}`)) }, timeout)
  pending.set(mid, (m) => { clearTimeout(t); res(m) })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
const evl = async (expr, timeout = 30000) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeout)
  if (r.result?.exceptionDetails) return { __error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 400) }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const T = (name, ok, detail) => console.log(`${ok ? '✓' : '✗'} ${name}: ${detail}`)

await send('Runtime.enable')
// 1. EAA 写入链路: 添加事件
const studentName = `test-e2e-${Date.now()}`
const addStudent = await evl(`(async()=>{try{return await api.eaa.addStudent({name:'${studentName}'})}catch(e){return {err:String(e.message)}}})()`)
T('eaa.addStudent', addStudent.success === true || addStudent.entity_id, JSON.stringify(addStudent).slice(0, 200))

const addEvent = await evl(`(async()=>{try{return await api.eaa.addEvent({name:'${studentName}', code:'CLASS_MONITOR', note:'e2e test', delta:10})}catch(e){return {err:String(e.message)}}})()`)
T('eaa.addEvent', addEvent.success === true, JSON.stringify(addEvent).slice(0, 200))

// 2. 验证可查回
const found = await evl(`(async()=>{try{const r=await api.eaa.search({query:'${studentName}'}); return r}catch(e){return {err:String(e.message)}}})()`)
T('eaa.search 回查', found.success === true && JSON.stringify(found).includes(studentName), JSON.stringify(found).slice(0, 250))

// 3. 非法 reasonCode 应被拒
const badEvent = await evl(`(async()=>{try{return await api.eaa.addEvent({name:'${studentName}', code:'NOT_A_REAL_CODE', note:'bad', delta:10})}catch(e){return {err:String(e.message)}}})()`)
T('eaa.addEvent 非法码拒绝', badEvent.success === false, JSON.stringify(badEvent).slice(0, 200))

// 4. Agent 运行(无 API Key 时应优雅报错而非崩溃)
const runAgent = await evl(`(async()=>{try{return await api.agent.runManual({agentId:'class-monitor', prompt:'测试: 请输出hello'})}catch(e){return {err:String(e.message)}}})()`)
T('agent.runManual(无key)', runAgent.success === false, JSON.stringify(runAgent).slice(0, 250))

// 5. 飞书: 非法 appId 启动 → 明确错误
const botStart = await evl(`(async()=>{try{return await api.feishu.botStart({appId:'bad-id', appSecret:'bad-secret'})}catch(e){return {err:String(e.message)}}})()`)
T('feishu.botStart 非法appId', botStart.success === false, JSON.stringify(botStart).slice(0, 250))

// 6. 飞书: 格式正确但凭证错误 → 凭证校验错误
const botStart2 = await evl(`(async()=>{try{return await api.feishu.botStart({appId:'cli_a1b2c3d4e5f6a7b8', appSecret:'wrong-secret-0000'})}catch(e){return {err:String(e.message)}}})()`)
T('feishu.botStart 错误凭证', botStart2.success === false, JSON.stringify(botStart2).slice(0, 250))

// 7. 飞书 diagnose 网络诊断
const diag = await evl(`(async()=>{try{return await api.feishu.diagnose()}catch(e){return {err:String(e.message)}}})()`)
T('feishu.diagnose', diag.success === true, JSON.stringify(diag.data || diag).slice(0, 350))

// 8. 飞书 bot-stop 幂等
const botStop = await evl(`(async()=>{try{return await api.feishu.botStop()}catch(e){return {err:String(e.message)}}})()`)
T('feishu.botStop 幂等', botStop.success === true, JSON.stringify(botStop).slice(0, 150))

// 9. cron 添加用户任务 → 持久化验证
const cronId = `test-cron-${Date.now()}`
const cronAdd = await evl(`(async()=>{try{return await api.cron.add({id:'${cronId}', name:'e2e cron', agentId:'class-monitor', expression:'0 */30 * * * *', prompt:'test'})}catch(e){return {err:String(e.message)}}})()`)
T('cron.add', cronAdd.success === true, JSON.stringify(cronAdd).slice(0, 200))
const cronList = await evl(`(async()=>{try{const r=await api.cron.list(); return r.some(t=>t.id==='${cronId}')}catch(e){return {err:String(e.message)}}})()`)
T('cron.list 包含新任务', cronList === true, String(cronList))
const cronRemove = await evl(`(async()=>{try{return await api.cron.remove({id:'${cronId}'})}catch(e){return {err:String(e.message)}}})()`)
T('cron.remove', cronRemove.success === true, JSON.stringify(cronRemove).slice(0, 150))

// 10. 非法 cron 表达式应被拒
const cronBad = await evl(`(async()=>{try{return await api.cron.add({id:'x', name:'x', agentId:'class-monitor', expression:'NOT CRON', prompt:'x'})}catch(e){return {err:String(e.message)}}})()`)
T('cron.add 非法表达式拒绝', cronBad.success === false, JSON.stringify(cronBad).slice(0, 200))

// 11. 设置写入: theme 切换
const setTheme = await evl(`(async()=>{try{return await api.settings.set('general.theme','light')}catch(e){return {err:String(e.message)}}})()`)
T('settings.set theme→light', setTheme.success === true, JSON.stringify(setTheme).slice(0, 150))
const getTheme = await evl(`(async()=>{try{const s=await api.settings.get(); return s.general.theme}catch(e){return {err:String(e.message)}}})()`)
T('settings.get 回读 theme', getTheme === 'light', String(getTheme))
// 还原 dark
await evl(`api.settings.set('general.theme','dark')`)

// 12. 班级 CRUD
const clsId = `test-cls-${Date.now()}`
const clsAdd = await evl(`(async()=>{try{return await api.class.create({classId:'${clsId}', name:'测试班级-e2e', grade:'高一', teacher:'测试老师'})}catch(e){return {err:String(e.message)}}})()`)
T('class.create', clsAdd.success === true, JSON.stringify(clsAdd).slice(0, 150))
const clsDel = await evl(`(async()=>{try{return await api.class.delete({classId:'${clsId}'})}catch(e){return {err:String(e.message)}}})()`)
T('class.delete', clsDel.success === true, JSON.stringify(clsDel).slice(0, 150))

console.log('=== console errors ===')
console.log(consoleErrors.slice(0, 15).join('\n') || '(none)')
ws.close()
process.exit(0)
