### Sprint 4b — WeChat / QQ vs QwenPaw 补齐（2026-09-15）

| 能力 | QwenPaw | EA 状态 |
|---|---|---|
| 微信出站图片/文件 | `send_image` / `send_file` 进 reply 路径 | ✅ `outbound.ts` + `reply-session` / `sendReply` / pipeline `sendText` |
| 微信入站 debounce/merge | `_debounce_seconds` + merge | ✅ `InboundDebouncer` 接线 `connection.ts`（`debounceMs`） |
| 微信 outbound message_merge | 流式多段合并缓冲 | ✅ N/A：`streamingKind=none`，finalize 已整段一次发送 |
| 微信 typing refresh | `getconfig` + `sendtyping` 入站刷新 | ✅ `typing.ts` 入站 start / finalize·fail·stop 清理 |
| 微信 ACL allowFrom | `allow_from` + dm/group policy | ✅ `_shared/acl.ts` + manifest `allowFrom`/`aclDm`/`aclGroup` |
| QQ URL sanitize | `_sanitize_qq_text` + aggressive | ✅ `sanitize.ts` 全部出站文本 + URL 拒信重试 |
| QQ 细粒度 ACL | allow_from + access_control dm/group | ✅ ACL + `allowGroups→group:deny` |
| QQ 群 file_type=4 跳过 | group 不发 file | ✅ `sendRichMedia` 群文件静默 skip |

**总判**: WeChat/QQ 功能对等 **YES**（剩余仅平台 N/A：微信弱主动/context_token 限额、QQ 群主动配额——产品限制，非实现缺口）。
