// =============================================================
// agent/agent-events — Agent 状态事件的进程内总线
// sendAgentStatus 原本只推渲染窗口(webContents.send),飞书频道等
// 非 UI 消费方拿不到流式增量(阶段 0 需要它来驱动流式卡片)。
// 此处在 sendAgentStatus 内同步镜像一份到 EventEmitter,零侵入:
// 渲染路径行为不变,主进程内订阅方按 agentId 过滤消费。
// 安全性:同一 agent 的运行被 AgentRunQueue 串行化,订阅窗口内
// 该 agentId 的增量必属于当前这次运行,不会串到别的执行。
// =============================================================

import { EventEmitter } from 'node:events'

export const agentEvents = new EventEmitter()
agentEvents.setMaxListeners(50)
