# 强制源码编译 EAA、弃用下载机制

**日期**：2026-06-30
**状态**：待审批
**目标**：让本地 `npm run build:eaa` 与 CI（`release.yml`）行为一致——始终从 `core/eaa-cli/` 源码 `cargo build` 编译 EAA 二进制，彻底移除"从 GitHub Releases 下载二进制"的机制。

---

## 背景与动机

项目 EAA（教育操行分系统）的 Rust 源码**已经在仓库内**（`core/eaa-cli/`，~3183 行，跨平台无 Windows 耦合）。CI 发布管线（`release.yml:74-94`）也早已改为在 win/mac/linux runner 上各跑 `cargo build --release`（提交 `60fd0c7`）。

但**本地开发侧**仍保留着一套下载机制：
- `scripts/download-eaa-binaries.mjs` —— 从 `232252/education-advisor` 的 GitHub Releases 下载预编译二进制
- `npm run build:eaa`（`package.json:45`）→ 调用上述下载脚本
- `scripts/prebuild-check.mjs` 的 `downloadEAA()`（L110-123）→ 二进制缺失时自动触发下载

这造成两个问题：
1. **本地与 CI 行为不一致**：本地可能用到与源码版本不匹配的下载二进制。
2. **依赖外部网络/GitHub**：下载机制需要访问 GitHub Releases，离线或网络受限时失败。

**结论**：下载机制已是冗余，应彻底替换为本地源码编译，与 CI 对齐。

---

## 设计方案

### 1. 新建 `scripts/build-eaa.mjs`（核心）

职责：检测 Rust → 编译当前平台 → 放置产物。

**流程：**
1. **检测 `cargo`**：用 `spawnSync('cargo', ['--version'])`。失败则报错退出（exit 1），打印清晰提示："未检测到 Rust 工具链。请先安装 Rust（https://rustup.rs），或确认 cargo 在 PATH 中。EAA 现已改为强制源码编译，不再提供下载。" **不回退下载。**
2. **检测当前平台**：用 `process.platform` + `process.arch` 拼成 `<platform>-<arch>`（如 `win32-x64`、`darwin-arm64`、`linux-x64`）。与 `eaa-bridge.ts` 的 `PLATFORM_DIR` 键一致。
3. **跳过判断（缓存）**：若 `resources/eaa-binaries/<platform>/eaa(.exe)` 已存在，且其 mtime ≥ `core/eaa-cli/src` 下任一 `.rs` 文件的 mtime，则提示"已是最新"并跳过编译（`EAA_FORCE=1` 可强制重编）。这避免每次 `build` 都重编 ~6 秒。
4. **编译**：`spawnSync('cargo', ['build', '--release'], { cwd: 'core/eaa-cli', stdio: 'inherit' })`。失败则 exit 1。
5. **放置产物**：
   - 目标目录：`resources/eaa-binaries/<platform>/`（`mkdirSync` 递归）
   - Windows：复制 `core/eaa-cli/target/release/eaa.exe` → `<dir>/eaa.exe`
   - POSIX：复制 `core/eaa-cli/target/release/eaa` → `<dir>/eaa`，并 `chmodSync(path, 0o755)`
6. **验证**：复制后检查文件存在 + 大小 > 100KB（与 prebuild-check 的 `minSize` 一致）。失败则 exit 1。
7. **输出 manifest**（可选，与旧脚本一致）：写 `resources/eaa-binaries/<platform>/manifest.json`，记录 `{ built_at, platform, source_commit?, cargo_version }`。

**平台目录键**（与 `eaa-bridge.ts:99-106` 对齐）：`win32-x64`、`darwin-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`。

### 2. 改造 `scripts/prebuild-check.mjs`

- `downloadEAA()` 函数（L110-123）→ 重命名为 `buildEAA()`，改为调用 `node scripts/build-eaa.mjs`（`EAA_FORCE` 不强制，让其走缓存逻辑）。
- `checks` 数组里 EAA 项的 `autoFix: 'download'` → 改为 `autoFix: 'build'`。
- 错误提示文案（L173）"`npm run build:eaa`" 保留，但补一句"（需本地 Rust 工具链，参见 https://rustup.rs）"。

### 3. 改造 `package.json`

- `build:eaa`（L45）：`node scripts/download-eaa-binaries.mjs` → `node scripts/build-eaa.mjs`。

### 4. 删除 `scripts/download-eaa-binaries.mjs`

彻底移除下载脚本（`git rm`）。不再保留作 fallback——这是"强制源码编译、弃用下载"的核心体现。

### 5. 文档同步

- `docs/DESKTOP_BUILD.md`：所有提及"`npm run build:eaa` 下载"的地方改为"从源码编译（需 Rust 工具链）"。特别是第 351-353 行 reproducible builds 段。
- 若 `docs/DISTRIBUTION.md` 提及下载机制，一并更新。

---

## 边界情况与已知限制

### A. Windows ARM64 回退冲突
`eaa-bridge.ts:101` 把 `win32-arm64` 映射到 `win32-x64` 目录（运行时回退用 x64 二进制）。但新脚本按"仅编译当前平台"原则，会在 ARM64 机器上把 arm64 原生二进制放进 `win32-arm64/`，而运行时却去 `win32-x64/` 找——**会导致 ARM64 本地开发找不到二进制**。

**处理**：本次不解决（Windows ARM64 不在 CI matrix，属 ROADMAP 项 P4）。在 `build-eaa.mjs` 中针对 `win32-arm64` 加一条警告日志："检测到 Windows ARM64：当前 eaa-bridge 运行时会回退使用 win32-x64 二进制。本脚本已编译 arm64 原生二进制到 win32-arm64/，如需匹配运行时行为，请额外运行 x64 编译。" 让用户知情，不阻塞。

### B. macOS arm64（Apple Silicon）
`eaa-bridge.ts:105` 无回退，`darwin-arm64` 独立目录。新脚本在 Apple Silicon 上编 arm64 放进 `darwin-arm64/`，与运行时一致。**无冲突。**

### C. 缓存判断的准确性
基于 mtime 的跳过判断在以下情况可能误判：
- `Cargo.lock` 依赖更新但 `.rs` 未变 → 不会触发重编（保守可接受；用户可 `EAA_FORCE=1`）
- 拉取他人分支、`.rs` mtime 被 git 设为提交时间 → 可能误判为"需重编"（无害，多编一次）

权衡：mtime 简单跨平台，无需引入 cargo 依赖分析。误判方向都是"多编"，不是"漏编"，安全。

### D. 离线/无 Rust 环境
按方案，无 cargo 时 build:eaa 报错退出。这是用户明确选择。后续若团队需要，可再讨论是否提供"指定二进制路径"的逃生舱（如 `EAA_BINARY_PATH` 环境变量直接指向一个已编译好的二进制），但本次不做。

---

## 涉及文件清单

| 文件 | 操作 |
|------|------|
| `scripts/build-eaa.mjs` | **新建** |
| `scripts/prebuild-check.mjs` | 改 `downloadEAA`→`buildEAA`、`autoFix` 值、错误文案 |
| `package.json` | 改 `build:eaa` 脚本指向 |
| `scripts/download-eaa-binaries.mjs` | **删除** |
| `docs/DESKTOP_BUILD.md` | 同步下载→编译的描述 |
| `docs/DISTRIBUTION.md` | （若涉及）同步描述 |

---

## 验证

1. `npm run build:eaa` 在当前 Windows 机器上：检测到 cargo → 编译 → 产物出现在 `resources/eaa-binaries/win32-x64/eaa.exe` → 应用能正常调用 EAA（`eaa-bridge` 的 `isAvailable()` 返回 true）。
2. `EAA_FORCE=1 npm run build:eaa`：强制重编。
3. 临时把 `cargo` 改名模拟缺失：`build:eaa` 报错退出、提示安装 Rust、不下载。
4. `npm run prebuild`：二进制存在时跳过；删除二进制后自动 build。
5. 确认 `download-eaa-binaries.mjs` 已删除且无任何引用（`grep` 全仓）。
6. 既有 `npm test` / `tsc --noEmit` 仍通过。
