# Windows Setup.exe 从约 287 MB 回到约 370 MB（2026-11-12）

只读结论。本文不改打包脚本，也不以新的安装包为证据。云端环境打不出 Windows 安装包，也打不开教师机上的 `.exe`。下面的体积数字来自教师机实测；脚本、配置和提交来自本仓库。

## 结论

**最可能变大的那一步，是 NSIS 把一份仍带 pnpm 工具链的 `dsh-runtime.zip` 打进了 Setup。** 这份布局就是当天 10:50 的 t58 完整包，不是 beta.4 那种小包。

beta.4 与 beta.5 之间**没有**打包脚本、electron-builder 配置、NSIS 脚本、压缩档位、`asarUnpack` 或 prepackage 归档步骤的差异。`443b0e0`（v3.3.7-beta.5）相对 `1a13b22`（v3.3.7-beta.4）只改了版本号，其余是 PR #56 的对话功能（约 +1775 / −187 行），解释不了 +82 MB。

同一天更早的 `07fae8c`（11:41，Asia/Shanghai）才改了打包布局：把 `pnpm` 和 `@pnpm/exe` 移出教师运行时 zip，并禁止它们再进安装目录。t58 完整包的文件时间是 **10:50:50**，在这次提交之前。beta.4 本地包是 **12:12**，在这次提交之后，体积掉到 287 MB；GitHub CI 的 beta.4 是 287 MB，说明小体积是这套脚本的干净结果，不是本机碰巧。

beta.5（17:16）是 **369,660,622** 字节，t58 完整包是 **369,388,880** 字节，只差 **271,742** 字节（约 266 KB）。这是同一份载荷加上版本号和 PR #56 那一点源码，不是「小包再加 82 MB 的新功能」。

**打包思路不用改。** STORE zip、NSIS 保持默认 LZMA、`asarUnpack` 只留操作系统要映射的原生文件，这套就是 beta.4 本地和 CI 都打出约 287 MB 的做法。后面要补的是门禁，让一次干净的 `prepackage && package:installer` 不能再悄悄交回 t58 那种大布局。本文不实现这些门禁。

还不能在没有教师机日志和两份 Setup 的 7z 清单时，把「zip 里确实是 pnpm」写成已打开文件核对过的事实。能对上的是时间、脚本差异和体积差。证明方法写在文末。

## 实测体积

目标仍是：终端用户的 Setup 维持在官方约 **323 MB** 或更小；不接受 `-mx=0` 的约 0.8–1.1 GB 未压缩包；功能不减。Electron 文件收进归档，只有操作系统必须按真实文件加载时才解出。安装包已经在磁盘上之后，安装应在 60 秒内结束。

| 包 | 字节 | 说明 |
| --- | ---: | --- |
| 官方完整口径（v3.3.6 CI） | 323,009,354 | `docs/superpowers/specs/2026-11-09-installer-offline-slim.md` 记为 323.0 MB |
| 本地 3.3.7-beta.3 时段，约 18:34 | 283,966,771 | 小包 |
| 更早一份旁路包 | 284,096,422 | 与上一行同一量级 |
| t58 完整包 `Education-Advisor-Setup.t58-complete-20261112-1050.exe` | 369,388,880 | 10:50:50。大布局 |
| t58 **残包** | 369,389,051，其中 17,993,211 个尾部 0 | 不是一次完整打包，不参与对比 |
| 本地 beta.4 `release-v11\Education-Advisor-Setup.3.3.7-beta.4-20261112-1212.exe` | 287,550,146 | 12:12。近期小包 |
| GitHub CI beta.4（release v3.3.7-beta.4，15:31） | 287,227,957 | SHA256 `8139cdaf999c751516cf796380b2a3684f878c23bcf338fade105309c4b2b25e` |
| 本地 beta.5 `Education-Advisor-Setup.3.3.7-beta.5-20261112-1716.exe` | 369,660,622 | 17:16。SHA256 `8CECB94E1F5687BA4ADC54C45F31FB26A970F604075ADC5CFC25017B4E7BC0F9`。完整性检查 0 个尾部 0。预发布 tag `v3.3.7-beta.5` |

算术：

- beta.5 − 本地 beta.4 = **82,110,476** 字节（约 78.3 MiB，口头说的 +82 MB）
- t58 完整 − 本地 beta.4 = **81,838,734** 字节
- beta.5 − t58 完整 = **271,742** 字节
- 本地 beta.4 − CI beta.4 = **322,189** 字节

本地和 CI 的 beta.4 相差约 300 KB，和 t58 与 beta.5 相差的约 266 KB 是同一类「同一布局、内容略有出入」。+82 MB 不是这一类。

beta.4 的 prepackage 日志（教师机，不在 git 里）写的是：dsh-runtime **574** 个包 / **15,336** 个文件 / **166.0 MB**；dsh-im **2,207** 个文件 / **69.5 MB**。当前脚本的对应日志行带字样 `MB store`（`scripts/build-dsh-archives.mjs`），166.0 与 69.5 是 **zip 文件本身的字节**，不是解压后的估计。

## 1. 今天的打包脚本，以及先前约定的布局

`package.json` 里两条命令是：

```text
prepackage = prebuild-check
          && stage-dsh-node
          && build-office-kit-asset
          && compute-unpack-closure
          && stage-dsh-im-deps
          && build-dsh-archives

package:installer = vite build && electron-builder --win nsis
```

npm 只会在 `npm run package` 之前自动跑名为 `prepackage` 的钩子。`package:installer` **不会**自动跑 prepackage。`docs/DESKTOP_BUILD.md` 仍写「prepackage 在 `npm run package` 前自动跑，并且只有三个脚本」，那是旧说明；以 `package.json` 为准。beta.5 两次都是人手跑的，prepackage 退出码 0。

electron-builder（`electron-builder.yml`）：

- 产物目录 `release-v11`，Windows 只打 NSIS，`artifactName` 为 `Education-Advisor-Setup.${ext}`。
- **没有** `compression:` 字段，也没有 `-mx=0`。因此走 electron-builder 的默认 7z 档。先前的安装提速研究把这个默认记为 `-mx=9`，并明确否决 `compression: store`：未压缩载荷会把 Setup 撑到约 **0.8–1.1 GB**（PR #51，提交 `36f88b7` 曾打开 store，`d8812ba` 撤掉）。`tests/main/nsis-upgrade.test.ts` 和 `scripts/verify-dsh-package.mjs` 都断言 yml 里不能出现 `compression: store` 或 `-mx=0`。
- `asar: true`。`asarUnpack` 只有 `**/*.node`、`**/*.dll`、`**/*.exe`、`**/*.dylib`、`**/*.so`（`install-layout-unpack` 哨兵，`scripts/lib/install-layout.mjs` 的 `NATIVE_GLOBS`）。
- `nsis.include` 是 `scripts/nsis/installer.nsh`。它只处理覆盖安装（整目录改名、不跑旧卸载器的逐文件 `atomicRMDir`），**不改** 7z 压缩档。
- `afterPack` 是 `scripts/after-pack-trim.mjs`。它在打 7z 之前把 `build/dsh-runtime/dsh-runtime.zip`、`build/dsh-im/dsh-im.zip`、`build/office-kit/*.zip` 复制进 `resources/`，并删掉 `dxcompiler.dll`（约 25 MB）和多余 locale。

归档本身：

- `scripts/lib/store-zip.mjs` 写的是 **method 0（STORE）**。文件头注释写明原因：先 deflate 再放进 7z，第二轮几乎压不动，Setup 会变大。NSIS 只负责一次 LZMA。
- `scripts/build-dsh-archives.mjs` 把 stock-node 的 dsh 闭包打成 `build/dsh-runtime/dsh-runtime.zip`，把 `vendor/dsh-im` 打成 `build/dsh-im/dsh-im.zip`。`@deepseek-ai/*` 只收运行时目录；其它包去掉测试、source map、`.d.ts`、README。zip 每次重写，没有缓存。
- `scripts/build-office-kit-asset.mjs` 用 Windows `bsdtar` 打 **deflate** zip（约 65.8 MB）。这个 zip 已经压过，LZMA 再压几乎不缩小，所以它在 Setup 里大约原样占 66 MB。清单和 zip 都没变时会跳过重打。输出放在 `build/office-kit/`，避免被 `files: dist/**/*` 收进 `app.asar`（注释里写过这条曾经白占体积）。
- `scripts/lib/install-layout.mjs` 的 `filesToExclude` 把运行时闭包从 electron-builder 的 `files` 里排除，避免同一棵树既在 zip 里又在 `app.asar` 里再放一份。主进程在解压之前就要 `require` 的包留在 app 里（`better-sqlite3`、`pdfjs-dist`、`@napi-rs/canvas`、`yaml`、`ws`、`@earendil-works/pi-ai`，以及 `cross-spawn`、`debug`）。这些包的依赖即使也在 runtime zip 里，仍然留在 app 里：beta.2/beta.3 把它们排除掉之后，启动报过 `Cannot find module 'cross-spawn'`。
- 教师包不带 `pnpm` / `@pnpm/exe`。`runtimeArchivePackages` 会从闭包里删掉它们；`excludeCandidates` 再把它们写进 yml 排除表；`after-pack-trim.mjs` 若在 runtime zip 里看到 `node_modules/pnpm/` 或 `node_modules/@pnpm/exe` 会直接 `process.exit(1)`。

先前约定的布局（PR #54 / 提交 `1e0b257`，以及 PR #51 对 `-mx=0` 的否决）是：

| 安装结束时在磁盘上 | 原因 |
| --- | --- |
| `resources/dsh-runtime/dsh-runtime.zip` | dsh 闭包一个 STORE zip。NSIS 写一个文件。首次启动（或预热）解到 userData；sha256 没变则跳过。 |
| `resources/dsh-im/dsh-im.zip` | 连接中心同样处理。`link:` 需要真实目录，所以不能留在 asar 里。 |
| `app.asar`、主程序 exe、`dsh-node`、`office-kit/*.zip` | 本来就是单文件。office-kit 约 184 MB / 735 个文件不再预解压。 |
| `*.node` / `*.dll` / `*.exe` / `*.dylib` / `*.so` | 加载器要真实路径。 |
| 小树：`agents/`、`config/`、`skills/`、教育插件、eaa 二进制 | 按路径读，体积小。 |

Electron 45.0.0 仍然过不了 dsh 0.2.2-rc.1 的 `requireBuiltin` 指纹检查，子进程继续用 staged `dsh-node`，不能改成「整棵 dsh 放进 asar、用 Electron 当 Node」。

覆盖安装的现行脚本是整目录改名后向空目录全量解压（`scripts/nsis/installer.nsh`），**不会**按大小或 SHA-256 跳过未改文件。按文件跳过写在 `cursor/faster-windows-install-ae92` 的 `b80fbe8`，后来的升级修复换成了目录改名。这和本次 +82 MB 不是同一件事：跳过未改文件影响的是安装耗时，不是 Setup.exe 的体积。

## 2. beta.4 到 beta.5，打包脚本没有变

`git diff 1a13b22..443b0e0` 动到的打包相关路径只有 `package.json` / `package-lock.json` 的版本号（`3.3.7-beta.4` → `3.3.7-beta.5`）。没有改：

- `electron-builder.yml`
- `scripts/build-dsh-archives.mjs`、`scripts/lib/store-zip.mjs`、`scripts/lib/install-layout.mjs`
- `scripts/after-pack-trim.mjs`、`scripts/compute-unpack-closure.mjs`、`scripts/build-office-kit-asset.mjs`
- `scripts/nsis/installer.nsh`
- `.github/workflows/release.yml`

中间两个提交是 PR #56：`9086b24`（文档）和 `fbd4e24`（对话里改批改策略、改分、恢复班级）。tag `v3.3.7-beta.4` 指向 `1a13b22`，tag `v3.3.7-beta.5` 指向 `443b0e0`。

因此 beta.5 相对 beta.4 的 +82 MB **不是**这两次提交引入的压缩档、文件集或 `asarUnpack` 变化。干净地再跑当前脚本，应当仍在 beta.4 的约 287 MB 附近（CI 已经证明过一次）。beta.5 打到 369.7 MB，说明这次 `package:installer` 吃进去的树，和 beta.4 / CI 不是同一份输入。

## 3. 约 82 MB 最可能是哪一步：t58 的大布局

当天和体积有关的打包脚本改动只有 `07fae8c`（11:41），标题是模型选择器，同时改了安装布局。它在 t58（10:50）之后、beta.4 本地包（12:12）之前。`d83bb5c`（tag `v3.3.7-beta.2`，也是 `cursor/module-archives-74e4` 的尖端）到 `07fae8c` 之间没有别的提交。10:50 打出来的包，用的是 beta.2 这套模块归档脚本。

beta.2 的 `runtimeArchivePackages` **会把 `pnpm` 和所有 `@pnpm/exe.*` 放进 runtime zip**（`1e0b257` 里是 `archive.add`）。`07fae8c` 改成从闭包里删除它们，并在 afterPack 里见到它们就失败。`docs/DSH_CORE_RUNTIME.md` 对这份工具链的盘上体积写的是：`pnpm` 目录约 **404 MB**，实际是同一份约 **50 MB** 程序的 **8** 个副本；另加一份约 **50 MB** 的 `@pnpm/exe`。`electron-builder.yml` 顶部注释同一件事：8 个别名在复制进安装包后不再是硬链接，合计约 **391 MB**。

这能对上 +82 MB，而 `-mx=0` 对不上：

- 整包 `-mx=0` 是 0.8–1.1 GB，不是 370 MB。当前 yml 也没有这个开关。
- 两个 STORE zip（166 + 69.5 MB）若改成 deflate 再放进 7z，第二轮压不动，Setup 只会大一截「deflate 比 LZMA 差出来的那部分」，量级是十几到二十几 MB，不是 82 MB。`store-zip.mjs` 的注释说的就是这个较小的坑。
- 退回「闭包散文件 + LZMA」会回到官方约 323 MB、两万多个文件的旧包，不会到 370 MB。文件数决定安装时间，几乎不决定这 82 MB。
- office-kit 的 65.8 MB zip 在小包里已经在。再把 184 MB 的未解压 kit 塞进去，增加的会比 82 MB 更接近整份二进制（这些文件本身已经很难压）。
- PR #56 的源码进 `app.asar` 之后，压缩增量应当是几百 KB 这一档。beta.5 比 t58 只大 272 KB，和这个判断一致；它解释不了相对 beta.4 的 82 MB。

STORE zip 里的 pnpm 为什么是约 +82 MB 而不是 +400 MB：NSIS 仍用默认 LZMA（`-mx=9`，字典 64 MB）。8 个彼此相同、在 zip 里挨着的 50 MB 别名，会在字典里合成大约一份。`@pnpm/exe.win32-x64` 按包名排在 zip 前部，`pnpm` 包排在后部，中间隔着整份约 166 MB 的其余闭包，超出 64 MB 字典，**第二份相同的 exe 压不掉**。两份几乎压不动的约 40 MB 可执行文件，就是大约 80 MB。arm64 的 `@pnpm/exe` 只有磁盘上真有 `package.json` 时才会进 zip；beta.4 的 166.0 MB 说明那次 zip 里没有这堆二进制。

`07fae8c` 还把 `cross-spawn`、`debug`、`js-yaml`、`sharp` 等从 `files` 排除表里拿掉，让它们留在 app 里（它们的另一份仍在 runtime zip 里）。这是**变大**的方向，而且已经包含在 287 MB 的 beta.4 里。beta.4 相对 t58 仍净减约 82 MB，所以 pnpm 移出 zip 的节省大于这份重复。它不是 beta.5 相对 beta.4 的增量。

beta.5 的过程（日志不在 git 里）：

1. `npm run prepackage` 约 16 秒，退出码 0，`release-v11\build-beta5-prepackage.log`
2. 第一次 `npm run package:installer` 失败：`connect ETIMEDOUT 20.205.243.166:443`（Electron / GitHub 下载），`release-v11\build-beta5-installer.log`
3. 重试成功：`CSC_IDENTITY_AUTO_DISCOVERY=false`，`-c.electronDist=node_modules/electron/dist`，`release-v11\build-beta5-installer-retry.log`

当前 `build-dsh-archives.mjs` 每次都会重写 zip，当前 afterPack 见到 pnpm 会失败退出。因此：**若重试日志里有 afterPack 成功、并且 prepackage 日志里的 runtime zip 仍是约 166 MB，则 82 MB 不在那份新 zip 里，而是 NSIS 压缩了一棵更旧的 `release-v11/win-unpacked`（t58 留下的那棵）。** 若 prepackage 日志里的 runtime zip 已经是数百 MB，则 10:50 之后跑到的并不是 `07fae8c` 这份脚本。两种情况都是「打包输入仍是 t58 的大布局」，不是 beta.5 的源码或压缩档位写错。

`-c.electronDist` 本身只是改用本机已有的 Electron 发行目录，避免再去下载。beta.4 本地和 CI 用的也是同一大版本 Electron，体积只差 322 KB。单独这一参数解释不了 +82 MB，除非重试没有重建 win-unpacked、把 t58 的输出目录又打了一次 7z。

## 4. 是一次打包事故，还是脚本必须改

相对 `443b0e0` 上的脚本，这是一次**输入事故**：同一套脚本在 beta.4 本地和 CI 都打出约 287 MB，beta.5 却交回了 10:50 那种约 369 MB 的载荷。事故能够发生，是因为脚本和 CI **没有**把「Setup 不得超过小包预算」写成失败条件。afterPack 已经会拒绝 zip 里的 pnpm，但拒绝的前提是这次打包真的跑了当前的 afterPack。重试若只是对旧目录再打 7z，这道门碰不到。

以后建议加的门禁（本文不改代码）：

1. **体积预算。** 打完包若 `Education-Advisor-Setup.exe` 大于约 310 MB（beta.4 CI 的 287,227,957 字节留一点余量，仍低于 323 MB 政策），打包失败。CI 的 `release.yml` 在 `verify:dsh --dist` 之外加上同一条。beta.5 这种包就不能当预发布交出去。
2. **组件清单。** 打包日志打印并留下：`app.asar`、`dsh-runtime.zip`、`dsh-im.zip`、office-kit zip、主程序 exe、`app.asar.unpacked` 文件数，以及 runtime zip 的 method 是否为 0、是否含 `node_modules/pnpm/`。beta.4 的对照值是 runtime **166.0 MB / 574 包 / 15,336 文件**，dsh-im **69.5 MB / 2,207 文件**。runtime zip 超过约 200 MB 就失败（pnpm 回来了）。
3. **`package:installer` 先跑 prepackage。** 不要依赖 npm 对另一个脚本名的钩子。prepackage 失败就不要打 7z。
4. **不要在 Electron 下载失败时退回未压缩或散文件树。** 重试可以继续用 `-c.electronDist`，但必须先删掉 `release-v11/win-unpacked`，再跑当前的 afterPack。禁止 `--prepackaged` 去压一个来历不明的旧目录，除非同时检查体积预算。
5. **不要**加一条「zip 缺失就改回 `asarUnpack: **/node_modules/**`」或「改 `compression: store`」的后备。缺 zip 应当失败，现行 afterPack 已经是这个行为。

`scripts/compute-unpack-closure.mjs` 开头和 `docs/DESKTOP_BUILD.md` 仍按旧的「闭包解成散文件、prepackage 只有三步」来写。它们会误导下一次打包，但不是这次 82 MB 的来源。整理注释可以以后做。

## 5. 打包思路要不要换

**不要换。** 现有思路在脚本真的跑完时是对的：

- dsh 闭包和连接中心用 STORE zip，NSIS 用默认 LZMA 压一次。
- `asarUnpack` 只留原生文件。
- office-kit 继续一个 deflate zip，不预解压。
- 教师包不带 pnpm 工具链。
- 不使用 `-mx=0`。

beta.4 本地 287,550,146 字节和 CI 287,227,957 字节就是这套思路的结果，低于 323 MB 的政策，也远小于未压缩包。功能没有靠删文件换体积：闭包仍在 zip 里，首次启动再解压。

要修的是「哪一棵目录被送进了 7z」，以及让大布局不能静默出包。不需要把模块归档改回散文件，也不需要为了体积去动 `-mx`。

覆盖安装「跳过未改文件」是另一项已有设计，不在当前 `installer.nsh` 里，也不是这次体积回归的原因。

## 教师机上怎样一锤定音

在两份完整 Setup 上（不要用带 17,993,211 个尾部 0 的 t58 残包）：

1. 看 `build-beta4` 与 `build-beta5-prepackage.log` 里的 `[build-dsh-archives] dsh-runtime … MB store`。166 MB 对上百 MB，就能判断 beta.5 的 prepackage 有没有重写出小 zip。
2. 看 `build-beta5-installer-retry.log` 有没有 `[after-pack-trim] +…MB dsh runtime`，以及有没有 `runtime zip 不应含 pnpm`。没有 afterPack 行，就是旧的 win-unpacked 被直接打进了 7z。
3. `7z l` 两份 Setup 的 `$PLUGINSDIR/app-64.7z`，对比 `resources/dsh-runtime/dsh-runtime.zip` 的压缩前大小，并在 zip 内查找 `node_modules/pnpm/pnpm.exe` 和 `node_modules/@pnpm/exe`。t58 与 beta.5 若这份 zip 的大小和文件列表一致，而 beta.4 的 zip 是约 166 MB 且没有 pnpm，原因就坐实了。
4. 同时看 `resources/office-kit/*.zip`、`app.asar`、主 exe、locale 个数、有没有第二份 `electron.exe` 或 `dxcompiler.dll`。这些是备选的不可压大块；以第 3 步为准，避免把 Electron 下载重试本身当成体积原因。
