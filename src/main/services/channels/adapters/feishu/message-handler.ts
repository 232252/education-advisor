// =============================================================
// adapters/feishu/message-handler — 飞书批处理流水线装配(M3)
// 通用编排已上提 channels/bridge/pipeline.ts(渠道差异经依赖注入);
// 本文件只做飞书装配:sendReply / CardKit 会话 / file_key 下载 /
// runAgentStreaming,并保持原 MessageHandlerDeps / createBatchPipeline
// 签名(feishu-bot/message-handler.ts 兼容壳继续导出)。
// =============================================================

import type * as lark from '@larksuiteoapi/node-sdk'
import type { ReplySession } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { runAgentStreaming } from '../../bridge/agent-runner'
import { createChannelPipeline } from '../../bridge/pipeline'
import type { QueueItem } from '../../runtime/chat-queue'
import type { CommandContext } from '../../runtime/command/router'
import { createDefaultRouter } from '../../runtime/command/router'
import type { RecentFilesStore } from '../../runtime/recent-files'
import { saveAttachment } from './file-receive'
import { sendReply } from './reply'
import { createReplySession } from './reply-session'
import type { FeishuMessageEvent } from './types'

export type { FeishuMessageEvent }
export { createDefaultRouter }

/** 批处理流水线所需依赖(由连接层注入,保持本模块可在 vitest 中测试) */
export interface MessageHandlerDeps {
  /** 斜杠命令路由器 */
  router: ReturnType<typeof createDefaultRouter>
  /** 动态获取当前 SDK Client(stop/重启时会被置 null,不能提前捕获) */
  getSdkClient: () => lark.Client | null
  /** 获取 tenant_access_token(流式卡片/文件下载直连 API 用) */
  getAccessToken: () => Promise<string | null>
  /** 接收文件保存目录(userData/feishu-files) */
  filesDir: string
  /** 处理中计数 +1(诊断并发用) */
  onProcessingStart: () => void
  /** 处理中计数 -1 */
  onProcessingEnd: () => void
  /** 活动会话注册表(stop 时对未完成的占位卡片收尾) */
  activeSessions: Set<ReplySession>
  /** 每会话最近文件记忆 */
  recentFiles: RecentFilesStore
  /** M4: 渠道绑定的 Agent(channels.feishu.agentId;缺省 main) */
  agentId?: string
}

/**
 * 创建飞书批处理流水线(ChatMessageQueue 的 hooks 实现)。
 * @param deps  依赖(含会话注册表/最近文件)
 * @param ctx   斜杠命令上下文(EAA + Agent 能力)
 * @param win   主窗口(runAgent 状态推送,可为 null)
 */
export function createBatchPipeline(
  deps: MessageHandlerDeps,
  ctx: CommandContext,
  win: BrowserWindow | null,
): {
  onPlaceholder: (item: QueueItem, queuePos: number) => Promise<ReplySession | null>
  onBatch: (batch: { items: QueueItem[]; session: ReplySession | null }) => Promise<void>
  onDrop: (items: QueueItem[], session: ReplySession | null) => Promise<void>
} {
  return createChannelPipeline({
    router: deps.router,
    commandContext: ctx,
    sendText: (messageId, text) => sendReply(deps.getSdkClient(), messageId, text),
    createSession: (messageId, placeholderText) =>
      createReplySession(
        { getSdkClient: deps.getSdkClient, getAccessToken: deps.getAccessToken },
        messageId,
        placeholderText,
      ),
    downloadAttachment: (messageId, att) =>
      saveAttachment({
        getAccessToken: deps.getAccessToken,
        messageId,
        fileKey: att.fileKey,
        kind: att.kind,
        fileName: att.fileName,
        dir: deps.filesDir,
      }),
    filesDir: deps.filesDir,
    onProcessingStart: deps.onProcessingStart,
    onProcessingEnd: deps.onProcessingEnd,
    activeSessions: deps.activeSessions,
    recentFiles: deps.recentFiles,
    runStream: (prompt, onChunk) => runAgentStreaming(prompt, win, onChunk, deps.agentId),
  })
}
