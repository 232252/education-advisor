// =============================================================
// feishu-bot-service — 兼容壳(M3)
// 连接层/编排已整体搬至 channels/adapters/feishu/connection.ts;
// 此处 re-export 保持既有 `from './feishu-bot-service'` 导入不变
// (IPC handlers / app-lifecycle / factory-reset / 测试均引用本路径)。
// =============================================================

export type { BotStatus, BotStatusInfo } from './channels/adapters/feishu/types'
export { feishuBotService } from './channels/adapters/feishu/connection'
