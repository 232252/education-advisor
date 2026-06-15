# 03 — IPC 通道 → Tauri command 映射表

> 90+ 原 Electron IPC 通道与 Tauri `#[tauri::command]` 的一一映射。
> 命名规则: `ns:action` → `ns_action` (冒号换下划线), 前端 `invoke('ns_action', args)`。
> 流式事件 (`ipcRenderer.on`) 保持原通道字符串, 走 `AppHandle::emit` + 前端 `listen()`。

## 命名空间速查

| 命名空间 | command 数 | 流式事件 | 文件 |
|----------|-----------|----------|------|
| ai | 11 | ai:chat-stream | commands/ai.rs |
| agent | 13 | agent:status-update | commands/agent.rs |
| eaa | 21 | eaa:event-added / event-reverted / student-added / student-deleted | commands/eaa.rs |
| privacy | 11 | privacy:state-changed | commands/privacy.rs |
| compliance | 4 | — | commands/compliance.rs |
| cron | 7 | cron:status-update | commands/cron.rs |
| skill | 5 | — | commands/skill.rs |
| settings | 3 | — | commands/settings.rs |
| profile | 3 | — | commands/profile.rs |
| chat | 4 | — | commands/chat.rs |
| log | 8 | — | commands/log_viewer.rs |
| feishu | 7 | — | commands/feishu.rs |
| sys | 11 | — | commands/sys.rs |

## 完整映射

### AI / LLM (`commands/ai.rs`)

| Electron 通道 | Tauri command | 参数 | 返回 |
|---------------|---------------|------|------|
| `ai:list-providers` | `ai_list_providers` | — | `Vec<ProviderInfo>` |
| `ai:list-models` | `ai_list_models` | `providerId` | `Vec<ModelInfo>` |
| `ai:test-connection` | `ai_test_connection` | `providerId, apiKey, baseUrl?` | `TestResult` |
| `ai:set-api-key` | `ai_set_api_key` | `providerId, apiKey` | `{success}` |
| `ai:delete-api-key` | `ai_delete_api_key` | `providerId` | `{success}` |
| `ai:oauth-login` | `ai_oauth_login` | `providerId` | `{success, authUrl?, error?}` |
| `ai:chat` | `ai_chat` | `params: ChatParams` | `{success, sessionId}` |
| `ai:chat-abort` | `ai_chat_abort` | — | `{success, aborted}` |
| `ai:add-custom-model` | `ai_add_custom_model` | `params` | `ModelInfo` |
| `ai:del-custom-model` | `ai_del_custom_model` | `providerId, modelId` | `{success}` |
| `ai:update-custom-model` | `ai_update_custom_model` | `params` | `{success}` |
| (stream) `ai:chat-stream` | emit/listen | — | `StreamEvent` |

### Agent (`commands/agent.rs`)

| Electron 通道 | Tauri command | 参数 | 返回 |
|---------------|---------------|------|------|
| `agent:list` | `agent_list` | — | `Vec<AgentListItem>` |
| `agent:get` | `agent_get` | `id` | `AgentDetail?` |
| `agent:toggle` | `agent_toggle` | `id, enabled` | `{success}` |
| `agent:update` | `agent_update` | `id, patch` | `{success, error?}` |
| `agent:get-soul` | `agent_get_soul` | `id` | `String` |
| `agent:set-soul` | `agent_set_soul` | `id, content` | `{success}` |
| `agent:get-rules` | `agent_get_rules` | `id` | `String` |
| `agent:set-rules` | `agent_set_rules` | `id, content` | `{success}` |
| `agent:run-manual` | `agent_run_manual` | `id, prompt, history?` | `{success, id}` |
| `agent:get-history` | `agent_get_history` | `id` | `Vec<Execution>` |
| `agent:get-all-executions` | `agent_get_all_executions` | `opts?` | `{executions, stats, agentNameMap}` |
| `agent:abort` | `agent_abort` | `id` | `{success}` |
| (stream) `agent:status-update` | emit/listen | — | `{agentId, status, ...}` |

### EAA 核心 (`commands/eaa.rs`)

| Electron 通道 | Tauri command | 参数 | 返回 |
|---------------|---------------|------|------|
| `eaa:info` | `eaa_info` | — | `EAAResult<EAAInfoData>` |
| `eaa:score` | `eaa_score` | `name` | `EAAResult<EAAStudentScore>` |
| `eaa:ranking` | `eaa_ranking` | `n?` | `EAAResult<EAARankingData>` |
| `eaa:replay` | `eaa_replay` | — | `EAAResult<{ranking}>` |
| `eaa:add-event` | `eaa_add_event` | `params: AddEventArgs` | `EAAResult<Value>` |
| `eaa:revert-event` | `eaa_revert_event` | `eventId, reason` | `EAAResult<Value>` |
| `eaa:history` | `eaa_history` | `name` | `EAAResult<EAAHistoryData>` |
| `eaa:search` | `eaa_search` | `query, limit?` | `EAAResult<EAASearchData>` |
| `eaa:range` | `eaa_range` | `start, end, limit?` | `EAAResult<EAARangeData>` |
| `eaa:tag` | `eaa_tag` | `tag?` | `EAAResult<TagsOrDetail>` |
| `eaa:stats` | `eaa_stats` | — | `EAAResult<EAAStatsData>` |
| `eaa:validate` | `eaa_validate` | — | `EAAResult<EAAValidateData>` |
| `eaa:export` | `eaa_export` | `format, outputFile?` | `EAAResult<Value>` |
| `eaa:list-students` | `eaa_list_students` | — | `EAAResult<EAAStudentList>` |
| `eaa:add-student` | `eaa_add_student` | `name` | `EAAResult<Value>` |
| `eaa:delete-student` | `eaa_delete_student` | `name, args{confirm,reason}` | `EAAResult<Value>` |
| `eaa:set-student-meta` | `eaa_set_student_meta` | `params` | `EAAResult<Value>` |
| `eaa:import` | `eaa_import` | `filePath` | `EAAResult<Value>` |
| `eaa:codes` | `eaa_codes` | — | `EAAResult<EAACodesData>` |
| `eaa:doctor` | `eaa_doctor` | — | `EAAResult<EAADoctorData>` |
| `eaa:summary` | `eaa_summary` | `since?, until?` | `EAAResult<EAASummaryData>` |
| `eaa:dashboard` | `eaa_dashboard` | `outputDir?` | `EAAResult<Value>` |
| (stream) `eaa:event-added` | emit/listen | — | `{studentName, reasonCode, delta?, at}` |
| (stream) `eaa:event-reverted` | emit/listen | — | `{eventId, at}` |
| (stream) `eaa:student-added` | emit/listen | — | `{name, at}` |
| (stream) `eaa:student-deleted` | emit/listen | — | `{name, at}` |

### Privacy (`commands/privacy.rs`)

| Electron 通道 | Tauri command | 参数 | 返回 |
|---------------|---------------|------|------|
| `privacy:init` | `privacy_init` | `password, autoScan?` | `EAAResult` |
| `privacy:load` | `privacy_load` | `password` | `EAAResult` |
| `privacy:enable` | `privacy_enable` | — | `EAAResult` |
| `privacy:disable` | `privacy_disable` | `password` | `EAAResult` |
| `privacy:list` | `privacy_list` | `password` | `EAAResult<PrivacyMapping[]>` |
| `privacy:add` | `privacy_add` | `entityType, text` | `EAAResult` |
| `privacy:anonymize` | `privacy_anonymize` | `text` | `EAAResult` |
| `privacy:deanonymize` | `privacy_deanonymize` | `text` | `EAAResult` |
| `privacy:filter` | `privacy_filter` | `receiver, text` | `EAAResult` |
| `privacy:dryrun` | `privacy_dryrun` | `text` | `EAAResult` |
| `privacy:backup` | `privacy_backup` | `destPath` | `EAAResult` |
| (stream) `privacy:state-changed` | emit/listen | — | `{enabled, at}` |

### Compliance / Cron / Skill / Settings / Profile / Chat / Log / Feishu / Sys

(同结构, 详见 `src-tauri/src/commands/*.rs` 与 `src/shared/ipc-channels.ts` 对照)

| 命名空间 | 通道数 | 实现文件 |
|----------|--------|----------|
| compliance | 4 (generate/list/save/read-audit) | commands/compliance.rs |
| cron | 7 (list/add/update/remove/toggle/run-now/get-logs) + 流式 status-update | commands/cron.rs |
| skill | 5 (list/get/save/delete/set-enabled) | commands/skill.rs |
| settings | 3 (get/set/reset) | commands/settings.rs |
| profile | 3 (get/set/validate-academic) | commands/profile.rs |
| chat | 4 (save-message/load-messages/delete-session/list-sessions) | commands/chat.rs |
| log | 8 (list/read/clear/filter/search/export/export-dialog/write-renderer) | commands/log_viewer.rs |
| feishu | 7 (test/bitable/send/send-preflight/send-confirm/status/sync-now) | commands/feishu.rs |
| sys | 11 (open/save-dialog/open-external/get-path/check-update/show-update-dialog/notify/reset-factory/delete-by-class/delete-student-by-name/reset-events-only) | commands/sys.rs |

## 注册方式

所有 command 在 `src-tauri/src/main.rs` 用 `generate_handler!` 一次性注册:

```rust
.invoke_handler(tauri::generate_handler![
    all_commands!()  // 展开为 90+ command 路径, 见 commands/mod.rs
])
```

`all_commands!` 宏定义在 `src/lib.rs`, 按命名空间分组列出全部 command 函数路径。
新增通道只需: (1) commands/<ns>.rs 加 `#[tauri::command]` 函数 → (2) lib.rs 宏里加一行 → (3) ipc-client.tauri.ts 加 invoke 调用。

## 流式事件 (8 个) 实现模式

后端 `emit`, 前端 `listen`, 与 Electron `ipcRenderer.on` 语义同构:

```rust
// 后端 (commands/eaa.rs)
broadcaster::emit_all(&app, "eaa:event-added", json!({
    "studentName": name, "reasonCode": code, "delta": delta, "at": ts
}))?;
```

```ts
// 前端 (ipc-client.tauri.ts) — 返回退订函数, 与 Electron 版 unsubscribe 同构
onEventAdded: (callback) => {
  let unlisten: (() => void) | null = null
  let cancelled = false
  subscribe('eaa:event-added', callback).then((fn) => {
    if (cancelled) fn(); else unlisten = fn
  })
  return () => { cancelled = true; unlisten?.() }
}
```

> lazy 退订: 由于 `listen` 返回 `Promise<UnlistenFn>`, 而原接口要求同步返回
> unsubscribe 函数, 这里用 `cancelled` 标志位处理"事件未到达就退订"的边界。
