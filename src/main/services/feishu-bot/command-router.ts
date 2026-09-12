// =============================================================
// feishu-bot/command-router — 兼容壳(M2)
// 实现已上提到 channels/runtime/command/router.ts(平台无关);
// FeishuCommandRouter 为 CommandRouter 的历史别名,行为不变。
// =============================================================

export {
  type CommandContext,
  CommandRouter,
  createDefaultRouter,
  parseCommand,
} from '../channels/runtime/command/router'

/** 历史类名别名(现通用 CommandRouter) */
export { CommandRouter as FeishuCommandRouter } from '../channels/runtime/command/router'
