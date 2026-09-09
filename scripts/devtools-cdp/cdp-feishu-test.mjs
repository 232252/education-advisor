// 飞书 botStart 错误路径 + diagnose + keystore 检查
import { connectCdp, sleep } from '../lib/cdp-client.mjs'

const { evl, close } = await connectCdp({
  pageFilter: (t) => t.type === 'page' && !t.url.startsWith('devtools'),
})

// 1. keystore 里的飞书凭证是否存在
const keys = await evl(`(async () => {
  try {
    if (window.api?.settings?.listKeys) return await window.api.settings.listKeys()
    const out = {}
    for (const k of Object.keys(window.api || {})) if (/key|secret|creden/i.test(k)) out[k] = Object.keys(window.api[k] || {})
    return { fallback: out }
  } catch (e) { return { error: String(e) } }
})()`)
console.log('=== keystore keys ===')
console.log(JSON.stringify(keys, null, 1))

// 2. 内置诊断
const diag = await evl(`(async () => {
  try { return await window.api.feishu.diagnose() } catch (e) { return { error: String(e) } }
})()`)
console.log('=== feishu.diagnose ===')
console.log(JSON.stringify(diag, null, 1)?.slice(0, 2000))

// 3. botStart 无凭证 → 应得到明确错误而非假连接
const startEmpty = await evl(`(async () => {
  try { return await window.api.feishu.botStart() } catch (e) { return { error: String(e) } }
})()`)
console.log('=== botStart (无凭证) ===')
console.log(JSON.stringify(startEmpty, null, 1)?.slice(0, 600))
await sleep(1500)
const st1 = await evl(`window.api.feishu.botStatus()`)
console.log('status after empty start:', JSON.stringify(st1))

// 4. botStart 非法格式 appId (模拟远程配置错误场景)
const startBad = await evl(`(async () => {
  try { return await window.api.feishu.botStart({ appId: 'bad-id', appSecret: 'x' }) } catch (e) { return { error: String(e) } }
})()`)
console.log('=== botStart (非法 appId) ===')
console.log(JSON.stringify(startBad, null, 1)?.slice(0, 600))
await sleep(1500)
const st2 = await evl(`window.api.feishu.botStatus()`)
console.log('status after bad start:', JSON.stringify(st2))

// 5. botStop 幂等性 (未启动时 stop 不应报错)
const stopIdle = await evl(`(async () => {
  try { await window.api.feishu.botStop(); return { ok: true } } catch (e) { return { error: String(e) } }
})()`)
console.log('=== botStop (idle 幂等) ===')
console.log(JSON.stringify(stopIdle))
const st3 = await evl(`window.api.feishu.botStatus()`)
console.log('final status:', JSON.stringify(st3))

close()
process.exit(0)
