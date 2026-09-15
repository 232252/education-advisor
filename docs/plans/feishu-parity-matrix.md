### Sprint 4c — Feishu vs QwenPaw 补齐（2026-09-15）

| 能力 | QwenPaw | EA 状态 |
|---|---|---|
| WS 长连接 + 守护重连 | lark-oapi WS + backoff + recv health | ✅ `connection.ts` autoReconnect + guard + pingTimeout + resume |
| CardKit 流式卡片 | create → throttled update → finalize | ✅ `api.ts` + `reply-session.ts`（缺权限降级纯文本） |
| 入站文本/post/图/文件 | content_parts | ✅ `parsing.ts` + `file-receive.ts` |
| 出站图片/文件 | `send_image` / `send_file` | ✅ `outbound.ts` + Adapter `sendReply`/`push`（multipart 上传） |
| 入站 debounce/merge | BaseChannel `_debounce_seconds` | ✅ `InboundDebouncer` 接线 `event-handler`（`debounceMs`） |
| ACL allowFrom + dm/group | `allow_from` + access_control | ✅ `_shared/acl.ts` + manifest + `allowGroups→group:deny` |
| 群 @ 过滤 | `require_mention` / `group_at_only` | ✅ `requireMention`（默认 true） |
| Typing / DONE | reaction Typing + DONE | ✅ `reactions.ts`（入站 Typing / finalize DONE） |
| reaction 事件静默 | no-op handlers | ✅ EventDispatcher 注册 created/deleted no-op |
| health diagnostics | ChannelManager | ✅ `getHealthDiagnostics` |
| 话题线程会话 | `feishu_thread_id` session override | ⚠️ 平台能力可用；EA 会话键仍用 chat 批队列（产品未接话题维度） |
| 互动审批卡 / tool_guard | CardKit 审批按钮 | N/A（EA Agent 审批走桌面 UI，非 IM 卡） |
| Webhook 模式 | 可选（文档以 WS 为主） | N/A（产品只做长连接，与 QwenPaw 默认一致） |

**总判**: Feishu 功能对等 **YES**（剩余仅平台/产品 N/A：话题线程会话键、IM 内 tool_guard 卡、Webhook 模式）。
