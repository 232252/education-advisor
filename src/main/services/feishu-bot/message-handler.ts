// =============================================================
// feishu-bot/message-handler — 兼容壳(M3)
// 通用编排已上提 channels/bridge/pipeline.ts;飞书装配在
// channels/adapters/feishu/message-handler.ts。
// =============================================================

export {
  type FeishuMessageEvent,
  type MessageHandlerDeps,
  createBatchPipeline,
} from '../channels/adapters/feishu/message-handler'
export { RECEIVED_FILES_DIR_NAME as FEISHU_FILES_DIR_NAME } from '../channels/adapters/feishu/constants'
