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
| 本地验证构建 | 291.7MB（291,719,370 B） | **缺损构建**：见下方勘误 |
| **v3.3.6 CI 发布（最终）** | **323.0MB（323,009,354 B）** | 较线上版 **−28.8%**；完整功能面 |
| v3.3.7 本地验证构建（三轮瘦身） | 286.6MB（286,586,290 B） | 解包 18,517 文件 / 924MB；被第四轮取代 |
| **v3.3.7 最终本地构建（四轮：安装提速）** | **302.0MB（301,903,346 B）** | 解包 **15,120 文件 / 840MB**（22,802 → **−33.7%**）；安装耗时代理 **36.5s → 26.4s（−27.7%）**；kit zip +15MB 换安装少写 735 文件/~110MB |

### 勘误（2026-11-09 晚，对照 CI 发布产物）

本地 291.7MB 构建比 CI 少 31.3MB。用 7z 解开两份 Setup 的 `$PLUGINSDIR/app-64.7z` 逐文件对账（blockmap v2 单 blob 无法归因）：**CI 多 783 个文件共 27.8MB raw，其中 511 个是 `lxgw-wenkai-webfont` 的字体子集 woff2**——本地 `node_modules/lxgw-wenkai-webfont` 目录损坏（package.json 元数据是 1.7.0，但 files/ 只剩 71/~582 个字体子集），`npm install --dry-run` 因隐藏 lock 记录一致而报"up to date"未发现。woff2 已压缩、LZMA 再压不动，raw +27.8MB → 安装包 +31.3MB，账目吻合。

- **结论：CI 发布的 323.0MB 才是完整正确产物**（缺损字体子集意味着部分汉字回退系统字体）；本地已重装该包（595 文件）修复。
- 教训：①**本地产物比 CI 小 ≠ 更优，先怀疑本地树缺损**；②验证"包内文件完整性"不能只做大件存在性断言（36/36 全过也没拦住字体子集丢失）；③体积账以 **CI 发布口径**为准，本地数字只作开发参考。
- 工具复用：`7z l Setup.exe` 可列出 NSIS 壳与 `$PLUGINSDIR/app-64.7z` 载荷，`7z l -slt` 出逐文件清单——装机对比零安装。

## 第三轮瘦身（2026-11-09 晚，文件数优先）

教师要求：**功能不能少，安装后解压出来的文件尽量少**。实测账本（win-unpacked 22,802 文件）：
主 `node_modules` 19,672（86.3%）+ `dsh-im` 3,043（13.3%）+ 其余仅 87——文件数战场就是两棵 node_modules。

### 顺带挖出一个真 bug：打包态霞鹜文楷全部 404

`fonts.css` 用 `@import "lxgw-wenkai-webfont/lxgwwenkai-light.css"`，Vite 8 会内联 @import 的 CSS 内容但**不重写其中的 url()**——打包产物里 97 条 `url(./files/lxgwwenkai-light-subset-*.woff2)` 全部悬空，app:// 协议下 404，批注手写体**一直静默回退楷体**。v3.3.6 勘误里花 31MB「补全」的 582 个字体文件随包在 app.asar.unpacked，但打包态没有任何代码路径读它们（app 协议只服 `dist/renderer`）——**上轮"补全"补的是一批不可达文件**。

修法 = 复用仓库里已被验证的发射路径：`main.tsx` 直接 `import 'lxgw-wenkai-webfont/lxgwwenkai-light.css'`（与 jetbrains-mono 同路径，JS import 的 CSS 被 Vite 当独立模块正确 rebase 并哈希发射），97 个 light 子集进 dist → 打进 app.asar（零安装文件数成本）。字体包本体移出打包树（`electron-builder.yml` files 三条排除 + `SLIM_EXCLUDED_PACKAGES`）。

### junk 大扫除（after-pack-trim.mjs 3c 步，两棵树同一套规则）

删（先聚合并保护）：`*.d.ts|.d.mts|.d.cts` 2,216、非声明 `*.ts` 791、`tsconfig*`/`.eslintrc*`/`.prettierrc*`/`.babelrc*` 83、`examples/` 等目录 26、非 README/CHANGELOG 的 `*.md` 228；**LICENSE/COPYING/NOTICE 505 个先聚合为 `resources/THIRD-PARTY-NOTICES.txt` 再删**（法律文本保留，散文件 505→1）。共 −3,849 项 / −19.7MB raw。

- **保护树一刀不碰**：`@deepseek-ai`（黑盒 SDK 运行时读自己的 yml/md/docs）、`@earendil-works`（vendored pi-ai）、`pnpm`、`pdfjs-dist`（cmaps/standard_fonts 运行时按路径读）、`typescript`。
- **`.ts` 保险丝**：先解析包 exports 的运行时条件（require/import/default/node），入口真指向 `.ts` 的包自动豁免（2026-11-11 全量核对：0 个包命中；`development`/`browser` 等 condition 是构建期才用的）。
- **守卫（吸取字体子集丢失教训——内容级断言）**：sweep 后每个包根 package.json 必须在位（`.bin` 等点目录除外）、保护树外 `*.d.ts` 残留必须为 0；`verify:dsh --dist` 新增聚合文件/字体发射双向断言（app.asar 内 `lxgwwenkai-light-subset-` 引用 ≥90、无悬空 `./files/lxgwwenkai`）——旧树上试跑时守卫立刻拦下"lxgw 还在包里"，按设计工作。
- `package.json` 一律不删（模块解析链命脉，`runtime.ts` 靠它定位 dsh 入口）。

### 结果

- Setup **286.6MB**（v3.3.6 CI 口径 323.0MB → −11.3%；CI 重建预计同量级——本地字体树已修复，本轮本地与 CI 口径应收敛）。
- 解包 **18,517 文件 / 924MB**（22,802 / 969MB → **−18.8%**）：sweep −3,849、字体三包 −955、lxgw light 97 个以哈希资产进 asar（文件数零成本）。
- `verify:dsh --dist` **43/43**（36 旧 + 7 新）；tsc 0 错；biome 干净；全量 vitest 4,759 过；win-unpacked 启动冒烟无模块缺失。
- `release.yml` windows 构建新增 `verify:dsh --dist` 产物门禁（此前发布产物本身无断言）。

### 明确不做（第三轮）

- `@pnpm/exe`（52MB 单文件）：实测账单曾标"疑似误打包"——实为连接中心随包 pnpm 工具链主力（`pnpm-env.ts` PATH 前置），**必需**。
- dsh-im 与主树重复的 libvips/sharp（−19MB）：需 NODE_PATH hack 让插件跨树解析，脆弱性 > 收益。
- typebox/openai/@anthropic-ai 内部海量小 `.js`：ESM 结构固有，不可合并。

- `verify:dsh --dist` **36/36 通过**；Setup.exe 与 latest.yml 的 sha512 逐字节一致。
- 安装写盘 ~1016MB/27,647 文件（CI 口径），换掉的是首启 ~166MB 在线下载 + 在线装依赖——教师机断网直装。
- 教训（2026-11-09 记）：**体积决策按压缩后口径估**，raw 去重对 solid LZMA 收益极小。

### 构建过程注意（本机环境）
本机多次构建互相干扰（`release-v11` 出现过非本轮的 Setup/Portable 与 6 份 `package-build*.log`，判断为并发构建进程；文件锁引发连串 EBUSY/ENOENT/ENOTEMPTY）。**同一台机器不要并行跑两份 electron-builder**；失败先查 `release-v11` 是否被别的进程占用，必要时用带重试的预清理（`rm -rf release-v11/win-unpacked` 2-3 次）再构建。产物可信度以 `verify:dsh --dist` + latest.yml sha512 双校验为准。

## 第四轮（2026-11-09 深夜，安装时间优先）

教师要求：**极大减少安装时间**。调研结论（社区佐证 + 本机实测）：NSIS 安装时间由**解包文件数**主导（逐文件解压 + 杀软逐文件扫描），LZMA 解码本身只占 0.2s/36.5s。佐证：electron-builder #8640（宽泛 asarUnpack 是反模式）、t3code #5520（NSIS 解包 node_modules 9 分钟+）、NSIS #628（数万小文件性能塌方）。

新工具 `scripts/bench-install.mjs`（`npm run bench:install`）：用 7z 复刻安装两段——壳解出 `$PLUGINSDIR/app-64.7z`（solid LZMA → 单大文件，0.2s）+ payload 解到安装目录（18,517 文件/924MB 落盘风暴，36.3s）——作为安装耗时的可复现代理指标。

### 选择性解包（主战场）

旧配置 `asarUnpack: "**/node_modules/**"` 把 16,329 个文件全落盘，但真正**必须**真实落盘的只有 dsh 子进程（staged node.exe 看不见 asar）的依赖闭包；openai/@aws-sdk/@anthropic-ai 等 ~147 个主进程专用包收进 app.asar（主进程读归档透明）。

- **生成器** `scripts/compute-unpack-closure.mjs`（prepackage 链）：从 `@deepseek-ai/dsh` BFS 依赖闭包（580 包）∪ `@deepseek-ai` scope（331 包，黑盒 + cordis 按名装载）∪ keepers（pnpm、@pnpm/exe.win32-x64、pdfjs-dist、better-sqlite3、@napi-rs/canvas-win32-x64-msvc）− files 排除包 → 与 **shipSet 求交**（从根 dependencies 走 deps+optDeps，精确复现打包器发货的 715 包）→ **559 包落盘清单**，重写 electron-builder.yml 哨兵块 + 落 `build/unpack-closure.json`。
- **两个校准发现**（守卫拦下后逐包核实）：① dsh 体系大量 peer+dev 成对声明的微包（dsh-bash-local 等 19 个）npm 会装进 dev 树但 builder 从不发货——求交解决；② `yallist` 在 shipSet 语义内但产物里从来没有（lru-cache 版本解析差异，旧包逐文件核对确认）——录 `KNOWN_BUILDER_SKIPS` 豁免表。
- **守卫**：afterPack 4c 对照 JSON 双向核对（闭包包缺落盘 → 炸；落盘树多出清单外包 → 炸，曾拦下 smartUnpack 整包解出 better-sqlite3/@napi-rs/canvas，照实补录 keepers）；verify --dist 解析 asar 头（pickle 布局）断言 extract-zip 内嵌无 unpacked 标记、pdfjs-dist/dist 在归档外/内，并**用随包 node.exe 离线跑 `dsh --version`** 作闭包完整性的最终证据。

### office-kit 随包 zip 化

184MB/735 文件（曾占主树 37%）不再预解压：安装包只带 1 个 zip（65.8MB，afterPack 1c 复制进 `resources/office-kit/`——走钩子不走 extraResources，免得 mac/linux 构建被缺目录卡死），首次需要时 `office-kit-service` sha256 校验后本地解压到 userData（不联网；闲时预热首启后台完成，在线下载降级为 zip 损坏修复通道）。dsh 子进程经既有 NODE_PATH 机制解析，零改动。

**顺带挖出存量 bug**：资产主二进制在 `bin/libreoffice-kit.exe`（打资产打的是整包目录），服务代码一直查包根——下载/随包两条链路的就绪检测、就绪戳、状态卡全部静默失效（组件实际解压到位，功能碰巧可用）。修正为 `bin/` 布局 + 测试夹具对齐真实资产；装机实测全链路通（预热 → 校验 → 落位 → 就绪戳 bundled-zip）。

### 其他

- `LICENSES.chromium.html`（5.4MB，运行时无进程读）并入 `THIRD-PARTY-NOTICES.txt` 后删除。
- dsh-im 应用散件（523 文件）查过：src/plugin-src/docs 全是运行时引用、LICENSE 仅 1 个——无可扫项，不动。

### 结果（本地口径，CI 出包后回填）

- Setup **302.0MB**（三轮本地 286.6MB → +15.3MB：kit zip 不可压 +15MB，asar 收编与去重 −14MB；较 v3.3.6 CI 323.0MB 仍 −6.5%）。
- 解包 **15,120 文件 / 840MB**（22,802 → −33.7%；969 → 840MB）。
- 安装耗时代理 **36.5s → 26.4s（−27.7%）**（同机 NVMe；教师机 HDD+杀软的逐文件成本更高，相对收益只会更大）。
- `verify:dsh --dist` **51/51**（36 旧 + 第三轮 7 + 第四轮 8，口径有改写）；全量 vitest **4,761 过**（+2 office-kit zip 用例）；tsc 0 错；biome 干净；win-unpacked 启动冒烟两轮无模块缺失、SQLite（asar 内原生件）正常、kit 预热链路全通。
- 账目：落盘侧 node_modules 559 包是 dsh 黑盒闭包的合理下限——再往下砍就是砍功能，明确不做。

### 明确不做（第四轮）

- d3dcompiler_47.dll / vk_swiftshader.dll（GPU 兜底，老教师机渲染风险）。
- 复用 Electron 代替 staged node.exe（83MB，dsh 指纹锁，既有否决）。
- dsh-im 与主树 sharp/libvips 去重（NODE_PATH hack 脆弱，既有否决）。
- dsh 闭包内部再裁剪（功能不能少，闭包是 npm 契约）。

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
5. [ ] 断网冒烟（需教师机/干净虚拟机）：禁网安装 → 首启 → 开连接中心（无在线装依赖）→ AI 转 docx→PDF（走随包 kit）；**顺带看批注/手写笔迹是不是细笔楷书（霞鹜文楷，本轮修复项）**；
6. [x] Setup.exe 体积记入记忆账本。

第三轮（2026-11-09 晚）：

1. [x] `npm run build` 后 dist/renderer 发射 lxgw light woff2 97 个、CSS 无悬空 `./files/` 引用；
2. [x] 旧产物树假 context 试跑 afterPack：sweep −3,849 项，守卫按设计拦截旧树遗留的 lxgw；
3. [x] v3.3.7 本地出包 286.6MB / 解包 18,517 文件，`verify:dsh --dist` **43/43 全绿**；
4. [x] tsc 0 错 + biome 干净 + 全量 vitest 4,759 过 + win-unpacked 启动冒烟无模块缺失；
5. [ ] 断网冒烟（与第 5 项合并为同一次，装 v3.3.7 本地包）；
6. [ ] 断网冒烟通过后推 GitHub 发 v3.3.7，CI 产物口径回填本表。

第四轮（2026-11-09 深夜，安装提速）：

1. [x] `bench-install.mjs` 基线：36.5s（18,517 文件/924MB，落盘风暴占 36.3s）；
2. [x] 选择性解包出包：落盘 559 包（闭包 ∩ shipSet），147 包进 asar（67.7MB），守卫双向全绿；
3. [x] office-kit 随包 zip + `bin/` 存量 bug 修复，装机实测预热全链路（预热 → 校验 → 落位 → 就绪戳 bundled-zip）；
4. [x] v3.3.7 最终本地包 **302.0MB / 15,120 文件 / 840MB**，`verify:dsh --dist` **51/51**、bench **26.4s（−27.7%）**、全量 vitest **4,761 过**、启动冒烟两轮干净、sha512 ↔ latest.yml 一致；
5. [ ] 断网冒烟（同一次：装 → 首启 → 连接中心 → AI 转 docx→PDF【首用本地解压几秒~几十秒】→ 批注手写体）；
6. [ ] 通过后提交推送发 v3.3.7，CI 口径回填本表与 CHANGELOG。
