# 04 — 前端适配 (ipc-client shim)

> 核心洞察: 渲染端 **172 处** `getAPI()` 调用全部经
> `src/renderer/lib/ipc-client.ts` 一个文件收口 → 重写它即可让 11 个页面零改动。

## 1. 收口点证据

```
src/renderer/lib/ipc-client.ts        ← 唯一定义 WindowAPI + getAPI() 的文件
src/renderer/ (172 处)                ← 全部 import { getAPI } from '../lib/ipc-client'
src/renderer/stores/*.ts (4 store)    ← agentStore / chatStore / settingsStore / toastStore
src/renderer/hooks/*.ts               ← useEAAEvents / useFeishuPreflight / ...
src/renderer/pages/**/*.tsx (11 页面) ← Dashboard / Chat / Agents / Models / ...
```

零 `window.api` 直接访问 (除 ipc-client.ts 自身)。这意味着:
**重写 `getAPI()` 一个函数, 整个渲染端无感知**。

## 2. 双轨策略 (Electron + Tauri 共存)

`ipc-client.ts` 的 `getAPI()` 加运行时探测:

```ts
export function getAPI(): WindowAPI {
  // Tauri 优先: __TAURI_INTERNALS__ 由 Tauri 2.x 注入到 window
  // @ts-expect-error 运行时探测, 编译期不存在该字段
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined) {
    // 动态 require, 避免 Electron 构建时拉 @tauri-apps/api 依赖
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const tauriMod = require('./ipc-client.tauri')
    return tauriMod.getAPI() as WindowAPI
  }
  // 回退 Electron
  if (!window.api) {
    throw new Error('window.api is not available. Are you running inside Electron?')
  }
  return window.api
}
```

- `npm run dev` (Electron) → `window.api` 存在 → 走 Electron 版
- `npm run tauri:dev` (Tauri) → `__TAURI_INTERNALS__` 存在 → 走 Tauri 版
- **同一份渲染端代码, 两个构建共用**

## 3. Tauri 版实现 (`ipc-client.tauri.ts`)

### 3.1 invoke 命名规则

```ts
function cmd(channel: string): string {
  return channel.replace(':', '_')  // 'ai:list-models' → 'ai_list_models'
}
```

与后端 `#[tauri::command] async fn ai_list_models(...)` 一一对应。

### 3.2 一个完整方法示例

```ts
// Electron 版 (原)
listModels: (providerId: string) =>
  ipcRenderer.invoke(IPC.IPC_AI_LIST_MODELS, providerId)

// Tauri 版 (新)
listModels: (providerId: string) =>
  invoke<ModelInfo[]>(cmd('ai:list-models'), { providerId })
```

签名完全一致, 业务代码 `const models = await getAPI().ai.listModels('openai')` 无改动。

### 3.3 流式事件 (8 个) 的 lazy 退订

Electron 版用 `ipcRenderer.on` 同步注册, 返回同步 `unsubscribe` 函数。
Tauri 的 `listen` 返回 `Promise<UnlistenFn>`, 需要桥接:

```ts
onStream: (callback: (event: StreamEvent) => void) => () => void {
  let unlisten: (() => void) | null = null
  let cancelled = false
  // listen 是异步的
  subscribe<StreamEvent>('ai:chat-stream', callback).then((fn) => {
    if (cancelled) fn()       // 注册未完成就退订 → 立即清理
    else unlisten = fn
  })
  // 同步返回退订函数 (与 Electron 版签名一致)
  return () => {
    cancelled = true
    unlisten?.()
  }
}
```

8 个流式事件 (`ai:chat-stream`, `agent:status-update`, `eaa:event-added/reverted`,
`eaa:student-added/deleted`, `privacy:state-changed`, `cron:status-update`)
全部用同一模式。

### 3.4 send (fire-and-forget)

唯一一个 send 通道 `log:write-renderer` → `invoke('log_write_renderer')` (best-effort, catch):

```ts
forward: (level, msg) => {
  invoke(cmd('log:write-renderer'), { level, msg }).catch(() => {})
}
```

## 4. 文件对话框 / 外链 / 通知

这些原 Electron 走 `dialog.showOpenDialog` / `shell.openExternal` / `Notification`。
Tauri 版**不**在前端直接调插件, 而是经后端 command 中转, 保持单一收口:

```ts
// 前端
openDialog: (options) => invoke(cmd('sys:open-dialog'), { options })

// 后端 (commands/sys.rs)
#[tauri::command]
pub async fn sys_open_dialog(app: AppHandle, options: Value) -> Result<Value> {
    let d = app.dialog().file();
    // ... 调 tauri-plugin-dialog
}
```

好处: 后端可在调插件前做参数校验 (如 `openExternal` 强制 https), 与原 Electron
安全模型一致。详见 [07-PLUGINS.md](./07-PLUGINS.md)。

## 5. package.json 新增

```jsonc
{
  "scripts": {
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "tauri:build:debug": "tauri build --debug",
    "cargo:check": "cargo check --manifest-path src-tauri/Cargo.toml --lib",
    "cargo:check:1.95": "cargo +1.95.0 check --manifest-path src-tauri/Cargo.toml --lib",
    "cargo:test": "cargo test --manifest-path src-tauri/Cargo.toml"
  },
  "devDependencies": {
    "@tauri-apps/api": "^2",
    "@tauri-apps/cli": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "@tauri-apps/plugin-opener": "^2",
    "@tauri-apps/plugin-notification": "^2",
    "@tauri-apps/plugin-fs": "^2",
    "@tauri-apps/plugin-os": "^2",
    "@tauri-apps/plugin-log": "^2"
  }
}
```

原 Electron scripts (`dev`, `build`, `start`, `package:*`) **全部保留**, 双轨。

## 6. 改动清单 (渲染端)

| 文件 | 改动类型 | 行数 | 说明 |
|------|----------|------|------|
| `src/renderer/lib/ipc-client.tauri.ts` | 新增 | ~470 | Tauri 版 WindowAPI 实现 |
| `src/renderer/lib/ipc-client.ts` | 修改 | +13 | `getAPI()` 加 Tauri 探测分支 |
| 其他 11 页面 / 4 store / hooks | **零改动** | 0 | 业务代码完全复用 |

## 7. tsconfig / vite 注意

- `@tauri-apps/api` 仅在 Tauri 构建被实际拉取 (动态 require 隔离), Electron 构建不增加体积。
- `ipc-client.tauri.ts` 用动态 require 而非静态 import, 避免 vite 把
  `@tauri-apps/api` 打进 Electron bundle。
- 若需纯 Tauri 构建 (剥离 Electron), 可加一个 vite define `__TAURI_ONLY__`,
  让 `getAPI()` 直接走 Tauri 分支, 删除 Electron 分支。本轮保留双轨未做。
