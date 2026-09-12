# 2026-09-12 Windows 安装包 Error 窗口 — 协作复盘

> 一次「窗口标题是 Error、任务栏有图标、进程不退出」的排障。
> 先发了 v3.3.1（修错方向），用户反馈「还是一样的错误」后才截到真正的对话框。
> 对应版本：v3.3.0 引入 → v3.3.1 误修 → **v3.3.2 修对**。

本文只记可复用的判断方法，不记本机代理、令牌或用户数据内容。

---

## 1. 现象（用户原话）

安装包打开后：

- 桌面上有一个窗口，标题是 **Error**
- 任务栏有图标，进程还在，**不是闪退**
- 没有当天的 `logs/main-YYYY-MM-DD.log`

这三句话很容易被理解成 Chromium 的失败页（`chrome-error://` / HTTP 403）。两次都看错了。

---

## 2. 时间线

| 版本 | 做了什么 | 用户看到的 |
| --- | --- | --- |
| v3.3.0 | Pi 0.84.2 → 0.85.1；云端 Release | Error 窗口 |
| v3.3.1 | 修 `app://` Windows 路径拼接 + `pathToFileURL` | **还是 Error 窗口** |
| v3.3.2 | 内联 `@earendil-works/*`；`app://` 改 `fs.readFile` | 应对的是真根因 |

旁路（同一轮协作、与本 bug 独立）：

- Gitee 同步用了 `workflow_run.head_branch`（dispatch 时是 `main`）当 tag，镜像失败。应解析 **GitHub 上最新 Release 的 tag**。
- CI 曾被 `docs/ARCHITECTURE.md` 的 doc-stats 漂移、Windows `app://` 403 单测、Submitty SQL 的 CRLF/sha256 绊住。门禁要在 **Windows runner** 上跑路径相关用例。
- 本机访问 GitHub 不稳定时，**一次性**给 `git`/`gh` 配代理，**不要**写入 `git config`。

---

## 3. 两次误判

### 3.1 v3.3.1：当成 `app://` 403

Windows 上确实有一个真 bug：

```text
path.join(root, '/index.html')  →  C:\index.html
```

`URL.pathname` 带前导 `/`，`path.join` 会把后段当成盘符根。守卫判定逃逸，协议回 **403**。这在代码里能钉死，单测也能写。

**错在**：把「标题 Error」直接等同于这个 403，没有先看窗口内容。v3.3.0 的 Error **也可能**已经是后面的 JS 对话框；403 只是分析代码时的合理猜测，从未在用户机器上读到 `did-fail-load` 日志。

### 3.2 还以为是 asar + `net.fetch(file://)`

v3.3.1 装上之后仍是 Error。下一假设：Chromium `net.fetch` 读不出 `app.asar` 里的文件。

本机用 **同一份已安装的 asar** 写探针：`protocol.handle` 里 `net.fetch(pathToFileURL(...))`，`loadURL('app://index/index.html')` **能加载出「Education Advisor」**，资源 200。这个假设被实验否定。

v3.3.2 仍把协议改成 `fs.readFile`（Electron 给 `fs` 打了 asar 补丁），作为加固，**不是**这次 Error 的根因。

---

## 4. 真正根因

截到对话框原文：

```text
A JavaScript error occurred in the main process

Uncaught Exception:
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './context'
is not defined by "exports" in
...\resources\app.asar\node_modules\@earendil-works\chord\package.json
```

调用栈是 CJS `require("@earendil-works/chord/context")`。

`@earendil-works/chord@0.85.1` 的 `exports` **只有 `import`，没有 `require` / `default`**。Vite 主进程是 CJS（`ssr: true` + `formats: ['cjs']`），默认把 `node_modules` external。Pi 0.85 升级后，`pi-agent-core` 会碰到 `@earendil-works/chord/context`，打包结果里留下一条 `require(...)`，安装包一启动就在 **logger / BrowserWindow 之前** 抛未捕获异常。

所以会出现：

- 窗口标题是 Error（Electron 主进程 JS 错误框，不是 Chromium 失败页）
- 没有当天 main 日志（`initLogger` 还没跑到）
- 长时间只有一个主进程，没有 `--type=renderer` / gpu（卡在模块求值）
- `ENABLE_CDP=1` 连不上（Chromium 会话没起来）
- 用户数据目录当天没有新文件

仓库里 **早已** 对 `pi-telemetry`、`typebox` 做了同样处理（`ssr.noExternal`），chord 是 0.85 新依赖，漏网。

---

## 5. 怎么钉死的（下次按这个顺序）

1. **看窗口，不要猜标题。** `Get-Process` 的 `MainWindowTitle -eq 'Error'` 分不清 Chromium 失败页和 Electron `Uncaught Exception` 框。截图或 `PrintWindow` 裁出对话框正文。
2. **先看有没有今天的日志。** 没有 `logs/main-今天.log` → 崩溃在 `initLogger` 之前，优先查主进程模块加载 / `package.json` `exports`，不要先改渲染协议。
3. **看子进程。** 只有 `Education Advisor.exe`、没有 `--type=renderer`，多半主进程没走到 `BrowserWindow.loadURL`。
4. **用已安装的 asar 做最小探针。** 把「协议能否读文件」和「完整 `startApp`」拆开。本轮探针证明协议是好的，完整 exe 仍弹 Error → 问题在主进程求值，不在 `app://`。
5. **对照安装包里的 `dist/main/index.cjs`。** Electron 的 `fs` 能读 asar。搜 `require("@earendil-works/` 比猜 `__dirname` 快。

不要做的：

- 只根据源码路径拼接「推断」用户看到的是 403，然后发版。
- 用系统 Node `readFileSync(app.asar/...)` 判断 asar 不可读（系统 Node **没有** Electron 的 asar 补丁）。
- 用 `asar extract-file dist/main/index.cjs` 在 Windows 上拆包（归档里可能是 `\dist\main\index.cjs` 这种反斜杠路径，CLI 对不上）。改用 Electron `fs.readFileSync(asar 内路径)`。

---

## 6. 修法（已进 v3.3.2）

`vite.config.main.ts`：

```ts
ssr: {
  noExternal: ['typebox', /^@earendil-works\//],
}
```

把所有 `@earendil-works/*` 打进 CJS bundle，运行时不再 `require` 它们的 ESM-only 子路径。

守卫：`scripts/main-cjs-exports-check.mjs`，由 `npm run check:bundle` 在 `npm run build` 之后跑。`dist/main/*.cjs` 里若再出现 `require("@earendil-works/...")` 直接失败。

协议侧：`createAppProtocolHandler` 用 `fs.readFile` 出字节，并剥掉 pathname 前导 `/`，避免 Windows `path.join` 跳到盘符根。这是加固，单独发 v3.3.1 **救不了** 这次 Error 框。

---

## 7. 发版协作里另几条

- **安装包只走 GitHub Actions**，不要在开发机 `electron-builder`。手动 `workflow_dispatch` 或推 tag `v*.*.*`。
- 发完用 `gh release edit` 写中文说明：用户要关哪个窗口、数据清不清、Setup 链接。自动生成的 “Full Changelog” 不够。
- 覆盖安装 **不要** 清 `%AppData%\Education Advisor`。`deleteAppDataOnUninstall: false`。
- PowerShell 提交信息用 `@'...'@`，不要套 bash heredoc。
- 不要提交 `agents.user.yaml`、`tmp/`、本机代理、令牌。

---

## 8. 以后升级 Pi / ESM 包的检查单

- [ ] 新 `@earendil-works/*`（或任何 `exports` 只有 `import` 的包）是否会被 CJS 主进程 `require`？
- [ ] `npm run build && npm run check:bundle` 是否包含 `main-cjs-exports-check`
- [ ] 本地用 **已安装的 Setup** 冷启动一次，确认窗口标题是「Education Advisor」而不是 Error
- [ ] 确认当天写出了 `logs/main-*.log`
- [ ] 路径相关单测至少在 Windows CI 跑过（`path.join` + 前导 `/`）

一句话：**标题 Error + 无今日日志 = 先当主进程未捕获异常，截对话框正文，再改协议。**
