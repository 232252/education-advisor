# 07 — Tauri 插件清单

> Tauri 2.0 用插件化架构替代 1.x 的内建 API。本表列出本项目用到的全部插件、
> 用途、对应原 Electron 能力、配置位置。

## 1. 插件总表

| 插件 (Rust) | JS 包 | 用途 | 对应 Electron | Cargo feature |
|-------------|-------|------|---------------|---------------|
| `tauri-plugin-shell` | `@tauri-apps/plugin-shell` | 外部命令/Shell | `child_process` (受限) | — |
| `tauri-plugin-dialog` | `@tauri-apps/plugin-dialog` | 文件对话框 | `dialog.showOpenDialog/save` | — |
| `tauri-plugin-opener` | `@tauri-apps/plugin-opener` | 打开 URL/文件 | `shell.openExternal` | — |
| `tauri-plugin-notification` | `@tauri-apps/plugin-notification` | 系统通知 | `new Notification()` | — |
| `tauri-plugin-fs` | `@tauri-apps/plugin-fs` | 受限文件读写 | `fs` (经 preload 收口) | — |
| `tauri-plugin-os` | `@tauri-apps/plugin-os` | 平台/版本 | `process.platform` | — |
| `tauri-plugin-log` | `@tauri-apps/plugin-log` | 前端日志路由 | `console` + ipc forward | — |
| `tauri-plugin-updater` (待接) | `@tauri-apps/plugin-updater` | 自动更新 | `electron-updater` | — |
| `tauri::tray` (内建) | — | 系统托盘 | `Tray` | `tray-icon` |
| `tauri-plugin-deep-link` (待接) | `@tauri-apps/plugin-deep-link` | OAuth 回调 | 自定义 loopback | — |

## 2. 注册位置

`src-tauri/src/main.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_log::Builder::new().build())
    .setup(|app| { /* ... AppState, scheduler, tray ... */ Ok(()) })
    .invoke_handler(tauri::generate_handler![all_commands!()])
    .run(tauri::generate_context!())
```

`Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png", "image-ico"] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
tauri-plugin-notification = "2"
tauri-plugin-fs = "2"
tauri-plugin-os = "2"
tauri-plugin-log = "2"
```

## 3. 权限声明 (capabilities)

`src-tauri/capabilities/default.json` 声明每个插件具体允许哪些方法。
最小权限原则 — 默认拒绝, 显式列出:

```jsonc
{
  "permissions": [
    "core:event:allow-emit",
    "core:event:allow-listen",
    "core:tray:default",
    "dialog:allow-open",
    "dialog:allow-save",
    "opener:allow-open-url",
    "notification:allow-notify",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "os:allow-platform",
    "log:allow-info",
    "log:allow-error"
  ]
}
```

新增插件方法必须在此声明, 否则前端调用会被运行时拒绝 (与 Electron 的
contextIsolation 安全模型等价, 但更细粒度)。

## 4. 插件使用模式 (经后端 command 中转)

本项目**不**让前端直接调插件 JS 包, 而是经后端 command 中转, 保持单一收口
(与原 Electron preload 暴露 `window.api.sys.*` 的模式一致):

```rust
// 后端 (commands/sys.rs) — 调插件 + 参数校验
#[tauri::command]
pub async fn sys_open_external(app: AppHandle, url: String) -> Result<Value> {
    // 安全: 仅允许 http/https (与原 Electron 校验一致)
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(AppError::Validation(format!("仅允许 http/https 链接: {url}")));
    }
    app.opener().open_url(url, None::<&str>)?;
    Ok(json!({ "success": true }))
}
```

```ts
// 前端 — 仍走 getAPI().sys.openExternal(url), 无感知
openExternal: (url) => invoke(cmd('sys:open-external'), { url })
```

**好处**:
1. 安全校验集中在后端 (前端不可信)
2. 前端代码不直接依赖 `@tauri-apps/plugin-*` (双轨时 Electron 构建不拉这些包)
3. 行为与原 Electron preload 完全一致, 11 页面零改动

> 例外: `ipc-client.tauri.ts` 内部未直接用插件 JS, 全部走 invoke。仅
> `package.json` 把 JS 包列入 devDeps 是为了 Tauri 文档示例/未来直调预留。

## 5. 待接插件

### tauri-plugin-updater (自动更新)

**状态**: ✅ 已接通 (2026-06-15 收尾)。

**配置** (`tauri.conf.json`):

```jsonc
{
  "plugins": {
    "updater": {
      "pubkey": "REPLACE_WITH_TAURI_SIGNER_PUBKEY_RUN_npm_run_signer:gen",
      "endpoints": [
        "https://github.com/232252/education-advisor/releases/latest/download/latest.json"
      ]
    }
  }
}
```

**密钥生成**:

```bash
npm run signer:gen          # 交互式生成 ed25519 密钥对
# 1. 私钥存 ~/.tauri/ea.key (chmod 600), 公钥打印到 stdout
# 2. 替换 tauri.conf.json 的 pubkey
# 3. GitHub Secrets: TAURI_SIGNING_PRIVATE_KEY + TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

**后端 command 链** (`commands/sys.rs`):

- `sys_check_update` → `app.updater().check().await` → 三态返回 (`hasUpdate: true/false/检查失败降级`)
- `sys_show_update_dialog` → `update.download_and_install(on_chunk, on_finish)` →
  - `on_chunk(downloaded, total)` → emit `sys:update-progress` (`{phase:"downloading", downloaded, total, percent}`)
  - `on_finish()` → emit `sys:update-progress` (`{phase:"verifying", message}`)
  - 成功 → `app.request_restart()` + emit `phase:"restarting"`
  - 失败 → emit `phase:"error"`

**前端** (`SettingsPage.tsx`):
- 「检查更新」按钮 → 调 `sys.checkUpdate()`, 有更新调 `sys.showUpdateDialog()`
- `UpdaterProgress` 组件监听 `sys:update-progress` 事件, 显示进度条 + 阶段提示

**CI** (`release-tauri.yml`):
- tauri-action 读 `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` 自动签 latest.json + bundle
- `updaterJsonPreferNsis: true` → Windows NSIS 优先于 MSI

**未配置时行为**:
- `sys_check_update` 返回 `{hasUpdate: false, error: "pubkey 未配置"}` (降级, UI 提示)
- 不会 panic, 仅更新功能不可用

---

### tauri-plugin-deep-link (OAuth 回调)

**状态**: ✅ 已接通, 见 docs/08-OAUTH.md (Notion + Discord)。

> 上一版本标"待接"已过时; 详见 §8-OAUTH.md。

## 6. 插件与 eaa_core 的协作

| 能力 | 实现方 | 说明 |
|------|--------|------|
| 文件对话框 | tauri-plugin-dialog | 用户选文件 → 路径传后端 command |
| 路径解析 | `tauri::Manager::path()` | userData/resources/app_data_dir |
| 文件锁 | `eaa_core::storage::FileLock` | 不用插件, 直接复用 fs2 |
| 原子写 | `eaa_core::storage::atomic_write_json` | 同上 |
| 通知 | tauri-plugin-notification | agent 完成时桌面通知 |
| 日志 | tauri-plugin-log + tracing | 前端日志路由到后端 tracing |
| 托盘 | `tauri::tray` | 最小化到托盘 + 菜单 |
| 自动更新 | tauri-plugin-updater (待) | GitHub Releases |

`tauri-plugin-fs` 仅用于少量用户文档读写 (如导出), 主要数据路径走 `eaa_core`
的原子写, 不经插件 (保证文件锁与原子性语义)。
