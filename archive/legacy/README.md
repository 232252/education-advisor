# Legacy (Electron) — 已封存

> ⚠️ **本目录下的所有资产已废弃,不再维护。**
> 仅作历史参考 + 紧急回滚用。
>
> 仓库 v0.2.0 起已正式切换到 **Tauri 2.0 + 纯 Rust 后端** 单一架构。
> 详见仓库根 `README.md` 与 `MIGRATION_REPORT.md`。

---

## 1. 内容清单

| 路径 | 说明 |
|------|------|
| `src-main/` | 原 Electron 主进程 (36 个 .ts 文件) |
| `src-main/main/index.ts` | Electron app 入口 |
| `src-main/main/ipc/` | 12 个 IPC handler 模块 |
| `src-main/main/preload/` | contextBridge preload bridge |
| `src-main/main/services/` | 13 个 service 模块 |
| `src-main/main/utils/` | logger 等工具 |
| `electron-builder.yml` | 原 Windows 打包配置 (NSIS + portable) |
| `vite.config.main.ts` | 原 vite 主进程构建配置 |
| `scripts/build-icon.mjs` | 原 Electron 图标生成 (SVG → .ico / .png) |
| `scripts/download-eaa-binaries.mjs` | 原下载 pre-built eaa-cli 二进制 (Tauri 改为本地 crate) |
| `scripts/generate-update-manifest.mjs` | 原 electron-updater manifest 生成 (Tauri 改为 tauri-action 自动签) |
| `scripts/refine-wording.ps1` | 原品牌重命名 (Windows 脚本) |
| `scripts/rename-brand.ps1` | 原品牌重命名 (Windows 脚本) |
| `.github/workflows/release.yml` | 原 Electron release workflow (Win/macOS/Linux 四平台) |

> 共 **44 个文件** 已封存,所有 git 历史 (rename detection) 完整保留。

---

## 2. 为什么封存 (而不是直接删除)?

1. **可回滚**: 任何 Tauri 版本的紧急问题,可以 1-2 小时回滚到 Electron 主版本
2. **可对照**: 原 Electron 实现是 Tauri 版本的"对照基线", 改 bug 时需要回看 TS 逻辑
3. **Git 历史友好**: `git mv` 保留了完整 file history,PR 讨论、blame 都能用

## 3. 何时删除?

满足以下**全部**条件后,可在 v1.0 之前删除此目录:

- [ ] Tauri 单一版本连续运行 ≥ 6 个月
- [ ] 三平台 (Win/macOS/Linux) 都有 ≥ 1 个真实用户验证
- [ ] 渲染端 `getAPI()` 0 个 Electron 兼容分支残留
- [ ] 所有 `git grep -i "electron" .` 命中均为文档/历史记录(无活代码)

## 4. 回滚到 Electron 的方法

如需紧急回滚(假设 v0.2.0 Tauri 有严重问题):

```bash
# 1. 把 src-main 移回 src/main
git mv archive/legacy/src-main/main src/main
rmdir archive/legacy/src-main

# 2. 恢复 package.json (从 git history 找回 v0.1.0 版本)
git checkout v0.1.0 -- package.json package-lock.json
npm install

# 3. 恢复打包配置
git checkout v0.1.0 -- electron-builder.yml vite.config.main.ts

# 4. 恢复 CI workflow
mkdir -p .github/workflows
git mv archive/legacy/.github/workflows/release.yml .github/workflows/

# 5. 恢复 Electron 专用脚本
git mv archive/legacy/scripts/* scripts/

# 6. 恢复渲染端双轨检测
git checkout v0.1.0 -- src/renderer/lib/ipc-client.ts

# 7. 重新构建
npm ci
npm run build
npm run dev
```

## 5. 历史与决策

- **2026-06-09**: v0.1.0 发布,Electron + Node 主进程 + Rust eaa-cli 子进程
- **2026-06-14**: 启动 Tauri 2.0 重构 (PR `feat/tauri-restructure-and-cleanup`)
- **2026-06-15**: src-tauri 完成功能对齐 (13 services / 30 tools / 90+ commands / 108 tests)
- **2026-06-15**: v0.2.0 仓库转正迁移,Electron 资产软删除到本目录

详细迁移记录: 仓库根 `MIGRATION_REPORT.md`
Tauri 重构详细文档: [`src-tauri/docs/00-OVERVIEW.md`](../../src-tauri/docs/00-OVERVIEW.md)
