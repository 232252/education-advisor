// =============================================================
// Feishu Service — 飞书开放平台集成 (基于官方 Open API)
//
// 本文件为入口(re-export),实现按职责拆分到 ./feishu/ 子模块
// (纯重构,行为不变):
//   config    — FeishuDomain / getApiBase / fetch 超时常量
//   token     — tenant_access_token 获取与缓存(M-3/M-6 修复)
//   connection — 测连接(testConnection)
//   messages  — 发文本消息(sendTextMessage)
//   bitable   — bitable 列表 / 记录写入 / 手动同步(T4)
//   diagnose  — 网络诊断(DNS → HTTPS → 鉴权 → WebSocket 端点)
//
// 设计参考: OpenClaw 飞书插件的鉴权 + 直发模式
// =============================================================

export { addBitableRecord, listBitableTables, syncBitableNow } from './feishu/bitable'
export type { FeishuDomain } from './feishu/config'
export { testConnection } from './feishu/connection'
export type { DiagnoseResult, DiagnoseStep } from './feishu/diagnose'
export { diagnoseConnection } from './feishu/diagnose'
export { sendTextMessage } from './feishu/messages'
export { feishuInfo } from './feishu/token'
