# 安装包离线直装与瘦身方案（2026-11-09）

## 背景与目标

线上 v3.3.5 Setup.exe = **453,779,113 B（453.7MB）**，且新装教师机体验差：

- 装完 15 秒后台自动联网下载 66MB office-kit（`app-lifecycle.ts:332-335`）；
- 首开连接中心触发在线装 ~111MB 依赖（历史 ~100MB pnpm install）。

教师要求：**安装特别慢要治、安装全程不联网、全功能离线直装、连接中心一点不能少、体积尽量砍**。

用户决策（2026-11-09）：office-kit **打进安装包**（全功能彻底离线优先于减半）；**停发 Portable**（双产物带宽减半）。

## 当前包的两处致命回归（新装机器连接中心必坏）

### 回归 1：`resources/dsh-im/node_modules` 没进包

- **现象**：`release-v11/win-unpacked/resources/dsh-im/`（19MB）里没有 node_modules；`vendor/dsh-im/node_modules`（111MB，`stage-dsh-im-deps.mjs` 专门装好"让首启离线"）丢失。
- **根因**：electron-builder 复制 extraResources 时**整目录丢弃 node_modules**（上游行为，filter 写得再细也没用）。`electron-builder.yml:99-115` 的 filter 仍保留着 `!node_modules/@img/sharp-wasm32/**` 等条目——证明本意就是要带 deps。
- **后果**：首开连接中心 `ensurePluginDeps` 的 qrcode 标记检测（`im-host.ts:167`）落空 → 走在线安装回退；又撞上回归 2，**联网也装不上**。
- **修复**：afterPack 钩子（`after-pack-trim.mjs`，NSIS 打 7z 前执行）手工复制 `vendor/dsh-im/node_modules` → `win-unpacked/resources/dsh-im/node_modules`，顺带剥 wasm32 兜底/source map/README。

### 回归 2：包内 pnpm 工具链是坏的

- **现象**：`win-unpacked/resources/app.asar.unpacked/node_modules/pnpm/` 下没有 `dist/node_modules`（get-pnpm 等 21 包，4.5MB）；源树 `node_modules/pnpm/dist/node_modules` 存在。
- **根因**：electron-builder 复制模块树时对嵌套 node_modules **无条件跳过**（`app-builder-lib/out/util/NodeModuleCopyHelper.js:12-23` 的 `excludedFiles` 含 `"node_modules"`）。
- **后果**：pnpm 启动链 `pnpm.exe(launcher) → node pnpm.mjs → nativeBinary() 找不到 → import get-pnpm 失败 → exit 1`，`im-host.ts:168` 的回退安装联网也死。
- **修复**：afterPack 手工复制 `node_modules/pnpm/dist/node_modules` → `app.asar.unpacked/node_modules/pnpm/dist/node_modules`。

### 回归 3（实施中发现）：vendor/dsh-im 依赖树是 11-02 的 pnpm 符号链接农场

- **现象**：首次实施构建时 cpSync 复制报 `EPERM: symlink`；`vendor/dsh-im/node_modules` 里混着 47MB 的 `.pnpm` store（含内部符号链接），总 111MB。stage 脚本现已改用 npm，但 qrcode 标记存在即跳过，旧树一直没刷新。
- **后果**：a) 符号链接无法进 NSIS 包（打包机非管理员直接失败）；b) 47MB 寄生死重。
- **修复**：删除 `vendor/dsh-im/node_modules` 重跑 stage（npm 扁平真目录树），新树 **54MB**、零符号链接。

## 体积账本（口径：Setup.exe）

| 时点 | 体积 | 说明 |
|---|---|---|
| 线上 v3.3.5 | 453.7MB | office-kit 随包 + 双产物时代 |
| 今日构建 1（kit 随包） | 273.4MB | `latest.yml` 记录 286,701,132 B |
| 今日构建 2（kit 改按需） | 208.6MB | 218,711,944 B，`win-unpacked` 730MB / 19,566 文件 |
| **本方案落地（实测）** | **291.7MB（291,719,370 B）** | 较线上版 **−35.7%**；`win-unpacked` 943MB / 22,802 文件 |

- 落地值与预估（~285-295MB）吻合：kit 回包 + dsh-im 离线依赖 + pnpm 修复，抵消安全删项。
- `verify:dsh --dist` **36/36 通过**；Setup.exe 与 latest.yml 的 sha512 逐字节一致。
- 安装写盘 943MB/22,802 文件（比 10-09 晨的 730MB/19,566 多，代价是全离线），换掉的是首启 ~166MB 在线下载 + 在线装依赖——教师机断网直装。
- 教训（2026-11-09 记）：**体积决策按压缩后口径估**，raw 去重对 solid LZMA 收益极小。

### 构建过程注意（本机环境）
本机多次构建互相干扰（`release-v11` 出现过非本轮的 Setup/Portable 与 6 份 `package-build*.log`，判断为并发构建进程；文件锁引发连串 EBUSY/ENOENT/ENOTEMPTY）。**同一台机器不要并行跑两份 electron-builder**；失败先查 `release-v11` 是否被别的进程占用，必要时用带重试的预清理（`rm -rf release-v11/win-unpacked` 2-3 次）再构建。产物可信度以 `verify:dsh --dist` + latest.yml sha512 双校验为准。

## 改动清单

### A. 修两处回归（连接中心保命）
1. `scripts/after-pack-trim.mjs`：新增复制步骤（见上）；守卫清单移除 libreoffice-kit。
2. `src/main/services/dsh/im-host.ts:168`：回退安装加 `--prefer-offline`；`im-host.ts:36` 10 分钟超时缩短为 3 分钟（deps 已随包，回退只在安装损坏时触发，快速失败指向"重装应用"）。
3. 过时注释清理："首开在线装 ~100MB" 已不成立：`im-host.ts:38-42,161-165`、`dsh-im-handlers.ts:62`、`app-lifecycle.ts:327-329`、`src/shared/api/dsh-im.ts:17-19`。

### B. office-kit 随包（全功能离线）
1. `electron-builder.yml:49`：删 `!node_modules/@deepseek-ai/libreoffice-kit-win32-x64/**` 排除。`bundledPkgDir`（`app-lifecycle.ts:83-91`、`office-kit-service.ts:118-128`）本就优先随包目录，零代码改动生效；下载逻辑保留为修复通道（sha256/双源不动）。
2. `scripts/after-pack-trim.mjs:31` 守卫、`scripts/verify-dsh-package.mjs:50` SLIM_EXCLUDED 同步移除。

### C. 安全再瘦身
- `better-sqlite3/prebuilds` 非 win32-x64 7 份 .node + `better-sqlite3/deps`（sqlite C 源码，~25MB raw，npmRebuild:false 无运行时用途）。
- `openai/src`（5.9MB TS 源码；运行时走包根 `index.js`+`resources/`，消费方 vendored pi-ai 只 import 'openai' 根入口）。
- ~~`pdfjs-dist/legacy`~~ **不删**——预检发现 `src/main/services/grading/pdf-rasterize.ts:81` 套打光栅化正在用。

### D. 停发 Portable
- `electron-builder.yml:139-154`：win.target 只留 nsis，删 portable 段。
- `site-build/download.html:164`：删 Portable chip；`site-build/assets/js/download.js:44`：windows 只留 installer。分类器与 `tests/site/releases.test.ts` 保留（历史 release 资产仍显示）。

### E. 门禁加码（`verify-dsh-package.mjs --dist` 新断言）
- `resources/dsh-im/node_modules/qrcode/package.json` 存在（离线首开标记）；
- `app.asar.unpacked/node_modules/pnpm/dist/node_modules` 存在（pnpm 链完整）;
- `app.asar.unpacked/node_modules/@deepseek-ai/libreoffice-kit-win32-x64/bin/libreoffice-kit.exe` 存在（随包 kit）;
- `resources/dsh-im/node_modules/@img/sharp-wasm32` 不存在。

### 明确不做
- **复用 Electron 代替 staged node.exe**（-18MB）：dsh 的 `node-addon-require-builtin` 只认 Electron 43.0.0/44.0.0/44.7.0 精确指纹（`src/main/services/dsh/dsh-node.ts:1-6`），本应用 43.2.0；降级牵动全部原生依赖重验。
- codepage/xlsx 裁剪（运行时风险）；NSIS 压缩参数改动（体积/速度权衡已优）。

## 验证清单

1. [x] `npm run prepackage && npm run package:installer` 出包，release-v11 只有 Setup.exe（291,719,370 B）；
2. [x] `npm run verify:dsh -- --dist release-v11/win-unpacked` **36/36 全绿**（含离线三件套新断言）；
3. [x] `npx tsc --noEmit` 0 错 + `biome check` 触及文件 0 错 + 触及模块 vitest 36 用例全过（全量套件另跑）；
4. [x] Setup.exe sha512 与 latest.yml 记录逐字节一致（防并发写坏）；
5. [ ] 断网冒烟（需教师机/干净虚拟机）：禁网安装 → 首启 → 开连接中心（无在线装依赖）→ AI 转 docx→PDF（走随包 kit）；
6. [x] Setup.exe 体积记入记忆账本。
