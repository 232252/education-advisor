// =============================================================
// channels/bridge/pipeline — 渠道消息批处理流水线(通用编排)
// (M3 从 feishu-bot/message-handler.ts 泛化,行为不变)
// 输入是 ChatMessageQueue 冲刷出的"批"(同会话合并窗口内的消息):
//   - 命令批(无占位会话) → 斜杠命令分发,原样回复(快路径)
//   - 纯文件批          → 下载保存 + 直接回确认(不跑 Agent,省额度)
//   - 文字(±文件)批     → 组 prompt(文件路径+最近文件上下文)
//                          → runAgentStreaming 流式更新占位会话 → 终稿收尾
// 出错/stop 均通过会话 fail/finalize 收尾,不再静默丢回复。
// 渠道差异(怎么发文本/怎么建流式会话/怎么下载附件/怎么跑 Agent)
// 全部经 ChannelPipelineDeps 注入 — 渠道绝不直接碰 Agent(chatgpt-on-wechat
// Bridge 分层教训:队列与 Agent 调度共享,渠道只做收发与格式归一)。
// =============================================================

import type { InboundAttachment, ReplySession } from '@shared/types'
import { errText } from '../../../utils/err-text'
import { log } from '../../../utils/logger'
import { formatBytes, type SavedAttachment } from '../runtime/attachment-store'
import type { QueueItem } from '../runtime/chat-queue'
import type { CommandContext, CommandRouter } from '../runtime/command/router'
import type { RecentFilesStore } from '../runtime/recent-files'

/** 附件下载结果(saveAttachment 等渠道实现的返回形状) */
export type AttachmentDownloadResult =
  | { ok: true; saved: SavedAttachment }
  | { ok: false; error: string }

/** 流水线依赖(由各渠道装配方注入,保持本模块可在 vitest 中测试) */
export interface ChannelPipelineDeps {
  /** 斜杠命令路由器 */
  router: CommandRouter
  /** 斜杠命令上下文(EAA + Agent 能力,由装配方构造) */
  commandContext: CommandContext
  /** 按渠道消息 id 发送一次性纯文本(命令回复/繁忙提示等) */
  sendText: (messageId: string, text: string) => Promise<void>
  /** 创建流式回复会话(立即发出占位,秒回体验) */
  createSession: (messageId: string, placeholderText: string) => Promise<ReplySession>
  /** 下载并落盘一个附件(渠道实现各自的下载协议) */
  downloadAttachment: (
    messageId: string,
    att: InboundAttachment,
  ) => Promise<AttachmentDownloadResult>
  /** 接收文件保存目录 */
  filesDir: string
  /** 处理中计数 +1(诊断并发用) */
  onProcessingStart: () => void
  /** 处理中计数 -1 */
  onProcessingEnd: () => void
  /** 活动会话注册表(stop 时对未完成的占位收尾) */
  activeSessions: Set<ReplySession>
  /** 每会话最近文件记忆 */
  recentFiles: RecentFilesStore
  /** 运行 Agent(流式回调累计全量文本) */
  runStream: (prompt: string, onChunk: (accumulatedText: string) => void) => Promise<string>
  /** 渠道显示名(注入文件类 prompt,如"用户通过钉钉发来了文件";缺省"聊天软件") */
  channelLabel?: string
}

/**
 * 创建渠道批处理流水线(ChatMessageQueue 的 hooks 实现)。
 */
export function createChannelPipeline(deps: ChannelPipelineDeps): {
  onPlaceholder: (item: QueueItem, queuePos: number) => Promise<ReplySession | null>
  onBatch: (batch: { items: QueueItem[]; session: ReplySession | null }) => Promise<void>
  onDrop: (items: QueueItem[], session: ReplySession | null) => Promise<void>
} {
  return {
    /** 批次首条到达 → 立即秒回占位("正在思考…"/"排队中第 N 位") */
    async onPlaceholder(item, queuePos): Promise<ReplySession | null> {
      const hasFiles = item.parsed.attachments.length > 0
      const baseText = hasFiles
        ? `已收到 ${item.parsed.attachments.length} 个文件,正在准备…`
        : '正在思考…'
      const placeholderText = queuePos > 0 ? `排队中(前面还有 ${queuePos} 个任务)…` : baseText
      const session = await deps.createSession(item.parsed.messageId, placeholderText)
      deps.activeSessions.add(session)
      return session
    },

    /** 一批开始处理 */
    async onBatch(batch): Promise<void> {
      const { items, session } = batch
      if (items.length === 0) return
      const first = items[0].parsed
      const chatId = first.chatId
      const messageId = first.messageId

      deps.onProcessingStart()
      try {
        // 命令批:无占位会话,走原快路径(分发 + 纯文本回复)
        if (!session && first.text.trimStart().startsWith('/')) {
          const reply = await deps.router.dispatch(first.text, deps.commandContext)
          if (reply) {
            await deps.sendText(messageId, reply)
          }
          return
        }

        const texts = items.map((i) => i.parsed.text.trim()).filter(Boolean)

        // 下载本批全部附件(逐条;失败不中断,汇总告知)
        const saved: SavedAttachment[] = []
        const failed: string[] = []
        for (const item of items) {
          for (const att of item.parsed.attachments) {
            const r = await deps.downloadAttachment(item.parsed.messageId, att)
            if (r.ok) {
              saved.push(r.saved)
              deps.recentFiles.note(chatId, r.saved)
            } else {
              failed.push(r.error)
            }
          }
        }
        if (saved.length > 0) {
          // 顺手清理过期文件(容错,不等待)
          void cleanupExpired(deps.filesDir)
        }

        // 纯文件批(无文字说明):不跑 Agent,直接确认收悉 + 告知路径
        if (texts.length === 0) {
          if (saved.length === 0 && failed.length === 0) return
          const lines = [
            ...saved.map((s) => `- 《${s.name}》(${formatBytes(s.bytes)}) 已保存到 ${s.path}`),
            ...failed.map((f) => `- ⚠ ${f}`),
          ]
          const summary = `已接收 ${saved.length} 个文件:\n${lines.join('\n')}\n\n需要我怎么处理,直接说就行。`
          await session?.finalize(summary)
          return
        }

        // 文字(±文件) → Agent 流式
        let prompt: string
        if (saved.length > 0 || failed.length > 0) {
          const fileLines = saved.map((s) => `- 《${s.name}》已保存到本机:${s.path}`)
          if (failed.length > 0) fileLines.push(...failed.map((f) => `- (接收失败)${f}`))
          prompt = `用户通过${deps.channelLabel ?? '聊天软件'}发来了文件:\n${fileLines.join('\n')}\n\n用户的说明:\n${texts.join('\n')}`
        } else {
          prompt = texts.join('\n')
          // 注入最近文件上下文,让"这个你看得到吗"能解析到具体文件
          const recent = deps.recentFiles.fresh(chatId)
          if (recent.length > 0) {
            const recentLines = recent.map((f) => `《${f.name}》(${f.path})`).join('、')
            prompt += `\n\n(上下文提示:用户最近发来过的文件:${recentLines})`
          }
        }

        log(
          'info',
          'channel-bridge',
          `batch [${first.chatType}] ${items.length} msg(s), running agent`,
        )
        const reply = await deps.runStream(prompt, (accumulated) => {
          void session?.update(accumulated)
        })
        await session?.finalize(reply)
      } catch (err) {
        log('error', 'channel-bridge', `batch processing error: ${errText(err)}`)
        await session?.fail(`处理出错:${errText(err)}`)
      } finally {
        if (session) deps.activeSessions.delete(session)
        deps.onProcessingEnd()
      }
    },

    /** stop():未处理的消息通知用户(占位收尾或纯文本告知) */
    async onDrop(items, session): Promise<void> {
      const notice = '机器人已停止,这条消息未处理,请稍后重新发送。'
      if (session) {
        await session.finalize(notice)
        deps.activeSessions.delete(session)
        return
      }
      const first = items[0]?.parsed.messageId
      if (first) {
        await deps.sendText(first, notice)
      }
    },
  }
}

/** 过期文件清理(延迟 import 由装配方覆盖;默认走通用清理) */
async function cleanupExpired(filesDir: string): Promise<void> {
  const { cleanExpiredFiles } = await import('../runtime/attachment-store')
  await cleanExpiredFiles(filesDir)
}
