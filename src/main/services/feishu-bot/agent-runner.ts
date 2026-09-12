// =============================================================
// feishu-bot/agent-runner — 兼容壳(M3)
// 实现已上提 channels/bridge/agent-runner(渠道通用 Agent 调度)。
// 新签名增加可选 preferredAgentId(渠道绑定 Agent,M4 接入设置)。
// =============================================================

export { runAgentAndCollect, runAgentStreaming } from '../channels/bridge/agent-runner'
