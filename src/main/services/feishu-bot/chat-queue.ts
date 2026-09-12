// =============================================================
// feishu-bot/chat-queue — 兼容壳(M2)
// 实现已上提到 channels/runtime/chat-queue.ts(平台无关);
// 飞书装配的默认参数(2000ms/16)与原常量一致,行为不变。
// =============================================================

export {
  ChatMessageQueue,
  type ChannelQueueMessage,
  type ChatQueueHooks,
  type ChatQueueOptions,
  type QueuedBatch,
  type QueueItem,
} from '../channels/runtime/chat-queue'
