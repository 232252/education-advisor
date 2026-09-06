// 飞书功能深度诊断: 状态/凭证/设置项/命令路由
import { connectCdp } from '../lib/cdp-client.mjs'

const { evl, close } = await connectCdp({
  pageFilter: (t) => t.type === 'page' && !t.url.startsWith('devtools'),
})

// 1. 枚举 window.api 上飞书相关方法
const apiKeys = await evl(`(() => {
  const out = {}
  for (const k of Object.keys(window.api || {})) {
    if (/feishu|lark|bot/i.test(k)) {
      out[k] = Object.keys(window.api[k] || {})
    }
  }
  return out
})()`)
console.log('=== api 飞书命名空间 ===')
console.log(JSON.stringify(apiKeys, null, 1))

// 2. 查询 bot 状态
const botStatus = await evl(`(async () => {
  try {
    if (window.api?.feishu?.botStatus) return await window.api.feishu.botStatus()
    if (window.api?.feishu?.getBotStatus) return await window.api.feishu.getBotStatus()
    return { error: 'no botStatus method', keys: Object.keys(window.api?.feishu || {}) }
  } catch (e) { return { error: String(e) } }
})()`)
console.log('=== bot 状态 ===')
console.log(JSON.stringify(botStatus, null, 1))

// 3. 设置里的飞书配置
const settings = await evl(`(async () => {
  try {
    const s = await window.api.settings.get()
    return { feishu: s.feishu ?? null }
  } catch (e) { return { error: String(e) } }
})()`)
console.log('=== settings.feishu ===')
console.log(JSON.stringify(settings, null, 1))

close()
process.exit(0)
