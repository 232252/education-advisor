# 01 — Tauri 架构

> 渲染端不变, 主进程从 Node 全换 Rust, 数据引擎从子进程升级为库内调用。

## 1. 进程模型对比

### Electron 版 (原)

```
┌────────────────────────────────────────────────────────────────┐
│ 进程 1: Main (Node 22)                                          │
│   - 13 个 IPC handler (ipcMain.handle)                          │
│   - 20 个 service (TypeScript, ~8.4k 行)                        │
│   - better-sqlite3 (native 模块, 同步)                          │
│   - contextBridge → window.api (90+ 方法)                       │
│   - spawn eaa CLI 子进程 (JSON over stdin/stdout)               │
├────────────────────────────────────────────────────────────────┤
│ 进程 2: Renderer (Chromium, React 18)                           │
│   - 11 个页面, 4 个 zustand store                               │
│   - window.api.getAPI() 单一收口                                │
├────────────────────────────────────────────────────────────────┤
│ 进程 3: eaa CLI (Rust, 每次调用 spawn)                          │
│   - 事件日志 / 实体 / 隐私映射 / 原因码校验                      │
└────────────────────────────────────────────────────────────────┘
内存: ~150-200 MB (Chromium)  启动: 1.5-2 s  每次数据写入 +50ms (spawn)
```

### Tauri 版 (新)

```
┌────────────────────────────────────────────────────────────────┐
│ 进程 1: Tauri Main (纯 Rust, 单二进制)                          │
│   - 90+ #[tauri::command] (invoke_handler)                      │
│   - 12 个 service (Rust, ~3.5k 行)                              │
│   - rusqlite (bundled, 同步)                                    │
│   - eaa_core 库内直接调用 (无子进程)                            │
│   - AppHandle::emit → 前端 listen() (8 流式事件)                │
│   - Tauri 插件: dialog/opener/notification/fs/os/log            │
├────────────────────────────────────────────────────────────────┤
│ 进程 2: Webview (系统 WebView: WebKitGTK / WebView2 / WKWebView) │
│   - 同一份 React 18 代码 (零改动)                               │
│   - ipc-client.tauri.ts 走 @tauri-apps/api invoke/listen        │
└────────────────────────────────────────────────────────────────┘
内存: ~40-80 MB (系统 WebView 复用 OS)  启动: 0.3-0.6 s  数据写入 ~0ms (库调用)
```

**关键差异**:

| 维度 | Electron | Tauri |
|------|----------|-------|
| 主进程语言 | TypeScript (Node) | **Rust** |
| WebView | 自带 Chromium (~150MB) | 系统 WebView (复用 OS) |
| 数据引擎接入 | spawn 子进程 (JSON) | **库内调用** (eaa_core) |
| IPC | ipcMain.handle / ipcRenderer.invoke | **#[tauri::command] / invoke** |
| 流式事件 | ipcRenderer.on | **AppHandle::emit + listen** |
| 原生模块 | better-sqlite3 (需重编) | **rusqlite (bundled)** |
| 密钥存储 | win-dpapi (Win 专属) | **keyring (跨平台 OS keychain)** |
| 打包体积 | ~90 MB (.exe) | ~10-15 MB |

## 2. 数据流: 一次 agent 手动运行

```
[渲染端 ChatPage.tsx]
  │ getAPI().agent.runManual('class-monitor', 'Alice +2 homework')
  ▼
[ipc-client.tauri.ts]
  │ invoke('agent_run_manual', { id, prompt, history })
  ▼  (Tauri IPC, 跨进程)
[src-tauri/commands/agent.rs::agent_run_manual]
  │ 1. AgentService::entry(id) → 取 capabilities/model_tier/SOUL
  │ 2. SettingsService → 解析 (provider_id, model_id)
  │ 3. KeystoreService::get(provider_id) → 取解密后的 API key
  │ 4. 组装 system_prompt = SOUL + Rules + capabilities 清单
  │ 5. DbService::insert_execution(status='running')  ← SQLite
  │ 6. tokio::spawn → 异步流式
  ▼
[src-tauri/services/llm_service.rs::stream_chat]
  │ tokio::select! { reqwest SSE 流 | cancel_token }
  │   ↓ 每个 chunk
  │ parse_openai_chunk → StreamEvent::Delta / Thinking / ToolCall
  │   ↓
  │ broadcaster::emit_all('ai:chat-stream', StreamEvent)
  ▼  (AppHandle::emit, 跨进程)
[渲染端 ChatPage useStream → chatStore.handleStreamEvent]
  │ token 增量渲染到消息气泡
  ▼
  (若 StreamEvent::ToolCall { name: 'add_event', args })
[src-tauri/tools/eaa_tools.rs::dispatch]
  │ capability 校验: agent 有 'add_event'?
  │ 参数清洗: reason_code 仅允许 [A-Z_]
  │ eaa_core::storage::FileLock::acquire → save_events → atomic write
  ▼
[core/eaa-cli/src/storage.rs]  (库内, 非子进程)
  │ atomic_write_json (tmp → fsync → rename)
  │ append_operation_log
  ▼
[commands/agent.rs] 任务结束
  │ DbService::update_execution(status='success', tokens, cost)
  │ emit('agent:status-update', { status: 'success' })
```

**取消 (abort)**: 前端 `getAPI().ai.abortChat()` → `invoke('ai_chat_abort')` →
`active_streams.lock().await.drain()` → 所有 `CancellationToken::cancel()` →
`tokio::select!` 分支命中, reqwest 流被 drop, 即时停止。

## 3. 数据流: 隐私预检 (飞书发送)

```
[渲染端] getAPI().feishu.sendPreflight(appId, openId, text)
   ▼ invoke('feishu_send_preflight')
[src-tauri/commands/feishu.rs::feishu_send_preflight]
   │ if privacy_enabled:
   │   eaa_core::privacy::PrivacyEngine::filter_for_receiver(text, "parent")
   │   → 把"非本家长学生"替换为"其他同学", 保留自己孩子名字
   │ has_pii = (redacted != text)
   ▼ 返回 { hasPII, redacted, original, privacyEnabled }
[渲染端] 弹确认框: "检测到 PII, 发送脱敏版/原文/取消?"
   ▼ getAPI().feishu.sendConfirm(..., decision)
[src-tauri/commands/feishu.rs::feishu_send_confirm]
   │ decision == 'redacted' → 再过一次 filter_for_receiver
   │ decision == 'original' → 直发 (用户已确认风险)
   │ FeishuService::send_text(token, 'open_id', openId, text)
   │   → reqwest POST open.feishu.cn/im/v1/messages
   ▼
[隐私审计] privacy_audit.rs::append(AuditEntry { op:'filter', has_pii, ... })
   → 追加 {eaa_data}/privacy/audit.log (JSON-Lines)
```

## 4. 模块依赖图

```
                    ┌─────────────────────────────────────────────┐
                    │            src-tauri (bin)                   │
                    │   main.rs → tauri::Builder + all_commands!   │
                    └────────────────────┬────────────────────────┘
                                         │ manage(AppState)
                    ┌────────────────────▼────────────────────────┐
                    │              state.rs (AppState)             │
                    │  db / privacy / agents / llm / scheduler /   │
                    │  skills / settings / keystore / feishu /     │
                    │  privacy_audit / profile / active_streams    │
                    └─────┬──────────┬──────────┬──────────┬──────┘
                          │          │          │          │
              ┌───────────▼┐ ┌───────▼────────┐ ┌▼────────┐ ┌▼──────────┐
              │ commands/  │ │ services/      │ │ tools/  │ │ eaa_core  │
              │ (90+)      │ │ (12 个业务)    │ │ (3 个)  │ │ (库复用)  │
              └───────────┬┘ └───────┬────────┘ └┴────────┘ └────┬─────┘
                          │          │                          │
                          └──────────┴───────────┬──────────────┘
                                                  ▼
                              ┌──────────────────────────────────┐
                              │  core/eaa-cli (eaa_core 库)       │
                              │  storage / privacy / validation / │
                              │  types / commands                 │
                              │  + 4 子 crate                     │
                              └──────────────────────────────────┘
```

`commands/` 是薄包装层 (参数解析 + 调 service), `services/` 是业务逻辑,
`tools/` 是 agent 工具分发, 全部业务最终落到 `eaa_core` 的库函数 (不再 spawn)。

## 5. Tauri 2.0 的能力模型 (capabilities)

Tauri 2.0 用 **capabilities + permissions** 替代 1.x 的 allowlist。
`src-tauri/capabilities/default.json` 声明渲染端可用权限:

- `core:event:allow-emit/listen` — 流式事件 (我们 8 个)
- `dialog:allow-open/save` — 文件对话框
- `opener:allow-open-url` — 外链 (限 https)
- `notification:allow-notify` — 系统通知
- `fs:default` — 受限文件读写
- `os:default` — 平台/版本信息

每个插件权限都需显式声明, 默认拒绝。这与原 Electron 的 `contextIsolation:true`
最小权限模型一致, 但更细粒度。
