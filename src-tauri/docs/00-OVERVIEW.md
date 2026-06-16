# 00 — Tauri 重构总览

> 本文档系列记录 Education Advisor 从 **Electron + Node 主进程** 重构为
> **Tauri 2.0 + 纯 Rust 后端** 的完整方案、实施过程与每阶段修改内容。
>
> 起源: 用户在 2026-06-14 提出 "在这个目录夹下面建一个 Tauri 目录夹, 整个项目
> 用 Rust 做一次全面 Tauri 重建/重构, 把没完成的功能和没打通的链路重写一遍,
> 大量使用 Rust, 要有详细 md 文件以及修改内容"。
>
> **当前状态 (v0.2.0, 2026-06-15)**: Tauri 单一架构已正式转正, 原 Electron 资产
> 已封存到仓库根 [`archive/legacy/`](../../archive/legacy/), 仓库主入口即为
> `src-tauri/`。 后续 PR 提交不再有 Electron 兼容分支。

---

## 1. 重构目标

| # | 目标 | 对应原项目痛点 |
|---|------|---------------|
| G1 | 消除 Node.js 主进程运行时 | Electron 内存占用 ~150MB, 启动 1.5s+ |
| G2 | 数据/隐私/校验层 100% Rust | 原本已有 `core/eaa-cli` Rust 引擎, 但作为子进程被 spawn, 有 IPC 开销 |
| G3 | 业务层 (agent/LLM/cron/feishu/...) 全 Rust 重写 | 原 TS service ~8.4k 行, 想全部迁到 Rust |
| G4 | 渲染端 11 页面零改动 | 渲染端已单一收口在 `getAPI()`, 重写一个文件即可 |
| G5 | 与原 Electron 版**共存** (双轨) | 可逆、可对照、契合项目 ROADMAP v0.7.0 Tauri parity 计划 |
| G6 | 打通未完成链路 | agent 工具调用循环 / LLM 流式 abort / 隐私预检 / 合规报告 |

## 2. 核心策略 (已选定)

**共存式重构** + **重型 Rust 重写**:

```
原架构:
  Teacher → [Renderer (React)] ──window.api──▶ [Electron Main (Node 22)]
                                                  └──▶ [eaa CLI (Rust, 子进程)]

新架构 (src-tauri/):
  Teacher → [Renderer (React, 不变)] ──invoke/listen──▶ [Tauri Main (纯 Rust)]
                                                          ├── eaa_core (库内调用, 非子进程)
                                                          ├── agent_service / llm_service / ...
                                                          └── Tauri 插件 (dialog/opener/notify/updater)
```

两个关键利好 (来自实施前的代码全量探查):

1. **渲染端单一收口**: 172 处 `getAPI()` 调用全部经
   `src/renderer/lib/ipc-client.ts` 一个文件 → 重写它能复用全部 11 个页面。
2. **Rust 核心已库级**: `core/eaa-cli` 的 storage/privacy/validation/types
   早已是 `pub`, 仅缺 `[lib]` 目标 → 加 8 行即可被 Tauri crate 当库消费。

## 3. 目录结构 (新增, 在 `education-advisor/` 根下)

```
src-tauri/
├── Cargo.toml              # Rust 依赖清单 (含 [patch.crates-io] 修复 brotli, 见 05)
├── tauri.conf.json         # 窗口/CSP/bundle/resources 配置
├── build.rs                # tauri-build 编译期 codegen
├── capabilities/default.json  # Tauri 2.0 权限白名单
├── icons/                  # 应用图标 (5 尺寸 + ico/icns)
├── vendor/                 # 本地 fork 的依赖 (brotli/alloc-stdlib, 见 05)
│   ├── brotli/             # brotli 8.0.3 源码 (alloc-stdlib 指向本地 shim)
│   ├── brotli-decompressor/# 5.0.0 (硬绑 alloc-no-stdlib v2)
│   └── alloc-stdlib/       # 真 0.2.3 源码, alloc-no-stdlib bound 钉死 =2.0.4
├── src/
│   ├── lib.rs              # 库入口 + 共享类型 + IPC 事件常量
│   ├── main.rs             # Tauri Builder 装配 (对应 Electron main/index.ts)
│   ├── error.rs            # 统一 AppError (序列化给前端)
│   ├── state.rs            # AppState: 13 个 service 单例 (Arc<RwLock>/Mutex)
│   ├── commands/           # 13 个文件, 90+ #[tauri::command]
│   │   ├── mod.rs          #   register 宏 (all_commands!)
│   │   ├── ai.rs           #   11 个 (provider/model/chat/stream/abort/custom)
│   │   ├── agent.rs        #   13 个 (list/run/soul/rules/history/abort)
│   │   ├── eaa.rs          #   21 个 (数据引擎薄包装 eaa_core)
│   │   ├── privacy.rs      #   12 个 (anonymize/filter/...+审计)
│   │   ├── compliance.rs   #   4 个  (季度报告 + SHA-256 manifest)
│   │   ├── cron.rs         #   7 个  (CRUD + run_now + 日志)
│   │   ├── skill.rs        #   5 个
│   │   ├── settings.rs     #   3 个
│   │   ├── profile.rs      #   3 个
│   │   ├── chat.rs         #   4 个  (SQLite 持久化)
│   │   ├── log_viewer.rs   #   8 个
│   │   ├── feishu.rs       #   7 个  (含隐私预检 preflight/confirm)
│   │   └── sys.rs          #   11 个 (对话框/外链/通知/路径/更新/数据维护)
│   ├── services/           # 12 个业务逻辑 (从 TS service 重写)
│   │   ├── db.rs           #   ← db-service.ts (rusqlite, schema 完全一致)
│   │   ├── agent_service.rs#   ← agent-service.ts (agents.yaml + SOUL/Rules)
│   │   ├── llm_service.rs  #   ← pi-ai-service.ts (reqwest+SSE, 12 provider)
│   │   ├── scheduler.rs    #   ← cron-service.ts (tokio-cron-scheduler)
│   │   ├── settings_service.rs # ← settings-service.ts (dot-path + atomic)
│   │   ├── keystore.rs     #   ← keystore-service.ts (keyring 跨平台)
│   │   ├── feishu_service.rs#   ← feishu-service.ts (reqwest)
│   │   ├── skill_service.rs#   ← skill-service.ts
│   │   ├── profile_service.rs# ← profile-service.ts
│   │   ├── privacy_audit.rs#   ← privacy-audit.ts + compliance-report.ts
│   │   ├── broadcaster.rs  #   ← broadcaster.ts (AppHandle::emit 封装)
│   │   └── tray.rs         #   ← tray-service.ts (tauri::tray)
│   └── tools/              # agent 工具调用层
│       ├── eaa_tools.rs    #   ← eaa-tools.ts (capability 校验 + 参数清洗)
│       ├── file_tools.rs   #   ← file-tools.ts (路径穿越防护)
│       └── utility.rs      #   ← utility-tools.ts (calculate 安全求值)
├── docs/                   # ← 本文档系列 (00-07 + CHANGELOG)
└── tests/                  # Rust 单元/集成测试
```

**同时改动的原有文件** (改动最小化):

| 文件 | 改动 | 目的 |
|------|------|------|
| `core/eaa-cli/Cargo.toml` | + `[lib] name="eaa_core"` | 让核心引擎可作库被消费 |
| `core/eaa-cli/src/lib.rs` | 新增 (re-export 模块) | 库入口 |
| `core/eaa-cli/src/main.rs` | 3 处 `mod xxx` → `use eaa_core::xxx` | CLI 仍可编译 |
| `src/renderer/lib/ipc-client.ts` | `getAPI()` 加 Tauri 探测分支 | 渲染端运行时双轨 |
| `src/renderer/lib/ipc-client.tauri.ts` | 新增 (470 行) | Tauri 版 IPC 客户端 |
| `package.json` | +8 个 `tauri:*`/`cargo:*` scripts + 8 个 `@tauri-apps/*` deps | 构建入口 |

## 4. 文档索引

| 文件 | 内容 |
|------|------|
| [00-OVERVIEW.md](./00-OVERVIEW.md) | 本文件: 重构目标、策略、目录 |
| [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) | Tauri 架构图 + 与 Electron 逐层对比 + LLM/Agent 数据流 |
| [02-RUST-CORE-REUSE.md](./02-RUST-CORE-REUSE.md) | eaa-cli 加 `[lib]` 的改动 + 复用方式 + diff |
| [03-COMMANDS-MAP.md](./03-COMMANDS-MAP.md) | 90+ 通道 → `#[tauri::command]` 一一映射表 |
| [04-FRONTEND-SHIM.md](./04-FRONTEND-SHIM.md) | ipc-client.tauri.ts 设计 + invoke/listen 模式 + 双轨切换 |
| [05-BUILD-RUN.md](./05-BUILD-RUN.md) | 依赖安装 (含 8888 代理) / brotli 已知问题 / dev/build/package |
| [06-MIGRATION-CHECKLIST.md](./06-MIGRATION-CHECKLIST.md) | 分阶段验收清单 + 未打通链路修复点 |
| [07-PLUGINS.md](./07-PLUGINS.md) | Tauri 插件清单 (dialog/opener/notification/updater/...) |
| [CHANGELOG.md](./CHANGELOG.md) | 每个阶段的"修改内容"逐条对照 |

## 5. 当前进度

| 阶段 | 状态 | 产出 |
|------|------|------|
| 0 工具链 & 骨架 | ✅ | rustup 装好 (1.95/1.96), src-tauri 全部骨架文件 |
| 1 复用 Rust 核心 | ✅ | eaa-cli 加 `[lib]`, lib+bin 均通过 `cargo check` |
| 2 持久化 & 系统 | ✅ | db (rusqlite) + settings + keystore + sys commands |
| 3 LLM & Agent 主链路 | ✅ | llm_service (12 provider, SSE) + agent_service + ai/agent commands |
| 4 调度器 & 集成 | ✅ | scheduler + feishu + cron/log/profile/chat/compliance + tray |
| 5 前端适配 | ✅ | ipc-client.tauri.ts + ipc-client.ts 双轨 + tauri:* scripts |
| 6 文档收尾 | ✅ | 本系列 9 篇 md |
| 7 编译修复 + 完整构建 + 多轮工具调用闭环 | ✅ | 见 CHANGELOG 阶段 7 |
| **8 仓库转正迁移** | ✅ | 见 CHANGELOG 阶段 8 + [`MIGRATION_REPORT.md`](../../MIGRATION_REPORT.md) |

**编译验证 (最终)**:
- ✅ `cargo +1.95.0 check --all-targets` (lib + bin + tests) **0 错误**
- ✅ `cargo +1.95.0 build` (debug): 二进制生成, smoke test 启动到 "ready"
  (db migrated: 4 tables ready / loaded 18 agents / scheduler started / tray installed)
- ✅ `cargo +1.95.0 build --release` (LTO + strip): **12 MB 生产二进制** (vs Electron ~90 MB)

## 6. 不在本轮范围 (后续)

- tauri-plugin-updater 接 GitHub Release endpoint (配置项已留, 见 07)
- OAuth 登录 (Notion 等) 的 deep-link 流程
- 4 个子 crate (callback-signature 等) 的 feishu HMAC 校验接线
- Tauri 版打包产物的代码签名 (Windows/macOS notarization)
- 在有 DISPLAY 的桌面跑 `npm run tauri:dev` 做 GUI 端到端回归 (headless 仅验启动)
