# 实施文档：连接中心快捷面板 + 设置页连接 UI 升级（扩充版）

> 日期：2026-09-13 ｜ 性质：**设计与实施计划**
> 上游调研：[侧边栏连接中心弹窗调研](../research/2026-09-13-titlebar-connection-center-popover.md)（下称「前次调研」，其 §1 代码盘点与 §2 外部参考本文不再重复）
> 用户指示（2026-09-13）：前次调研的方案 B 落地时要**做到位**——设计范围**扩大**、**样式做漂亮**；同时**加深设置页里对应的 UI**（连接中心卡片墙、本机 WebUI 区）一并优化。
> 标注约定：**[代码]** = 本仓库代码事实（附 file:line，基线为本文撰写时工作区）；其余为设计决策。

---

## 0. 结论速览

1. **范围从「360px 轻量面板」扩大为「400px 品牌化快捷面板 + 设置页同语言升级」**：面板不再是通知面板的换皮，而是有自己视觉身份（频道品牌色瓦片、五态辉光点、状态 pill、二维码接入块）的常驻快捷入口；设置页频道卡片墙同步吃到同一套共享组件，两处视觉一致。
2. **动作语义定案**（前次调研 §6.7-a 的决策）：面板「连接/断开」= `settings:set(channels.<id>.enabled, true/false)`——主进程「保存即重连」在每次保存该路径时都会触发（`settings-handlers.ts:74-110` 的三个 reconnect 函数在保存路径上无条件执行，不比较旧值），因此面板动作与设置页开关**单一事实源、零分叉**；`error` 态「重试」= `channels.start(id)` 直调。
3. **WebUI 快捷开启定案**（§6.7-b 的决策）：接受 `always` 持久化语义，面板文案明示「局域网内持有链接的人可访问」+ 面板内一键关闭；`on-until-quit` 第四模式列为后续独立任务，本期不做。
4. **二维码依赖选型定案**：`uqr`（unjs，零依赖、纯 ESM、任意运行时、`renderSVG(text, { ecc, border })` 直接出 SVG 字符串）[官方 npm/github]。渲染层自绘注入，不涉主进程/原生模块。
5. **设置页锚点揭示机制定案**：URL hash 方案——面板跳转 `/settings#connection` / `/settings#webui`；`Section` 组件新增 `id` prop，自监听 `hashchange` + 挂载时比对，命中则展开 + `scrollIntoView`。不引全局事件总线、不引 store，可收藏/可深链。
6. **设置页 Section 顺序调整**：连接中心 + 本机 WebUI 上移到「通用」之后紧邻排列（`SettingsPage.tsx:196-208`），与面板两个分区一一对应。
7. **明确不做**（防蔓延，沿用前次调研 §4.2 边界）：面板不放 SchemaForm 配置表单、不放频道 enabled 开关本体、不放数据源集成状态、不放 WebUI 高级项（端口/证书/令牌管理）。

---

## 1. 设计总则

| 原则 | 落法 |
|---|---|
| 零组件库 | 沿用自研轻组件 + Tailwind v4 工具类（前次调研 §1.5）；新依赖仅 `uqr` 一个纯函数库 |
| 设计语言同源 | 表面层级/边框/圆角/阴影沿用既有配方：面板壳 `bg-white dark:bg-surface-elevated` + `border-gray-200/60 dark:border-white/[0.08]` + `rounded-xl` + `shadow-2xl` + `animate-scale-in`（`NotificationPanel.tsx:129` 同款）；分区小标签沿用 AgentStatusBar 的 uppercase micro-label 风格（`AgentStatusBar.tsx:28`） |
| 暗色优先 | 所有新样式成对设计（light/dark），二维码固定白衬底（扫码对比度与主题无关） |
| 状态即视觉 | 五态全部有专属配色 + 动效（辉光/脉冲），文字文案沿用 `ChannelStatusDot` 的 i18n 键，不另造一套词 |
| 品牌色只上「瓦片」 | 每频道一个品牌渐变图标瓦片；状态色（绿/红/琥珀/灰）保持全局语义色不与品牌色混用 |
| 动效克制 | 只用已有关键帧（scale-in / fade-in / slide-up / pulse），新增一个 `animate-slide-in-left`（面板从锚点侧滑入）；全部受 `prefers-reduced-motion` 覆盖（`globals.css:364-372` 已全局处理） |

---

## 2. 信息架构与线框

### 2.1 入口（侧边栏底部工具区）

```
展开态: [⚡连接中心(新)] [🔔通知] [── 🌙 主题(flex-1) ──]     ← MainLayout.tsx:233-247 工具区，新入口插在最左
折叠态:   纵向堆叠，连接中心在最上一行（w-8 h-8 图标钮，与通知中心同规格）
```

- 图标：lucide `PlugZap`（16px，同通知中心 Bell 规格）。
- **状态外显**：任一频道 `error` → 图标右上红点（8×8 圆钮样式同 `NotificationCenter.tsx:61-65` 的红点规格）；有频道 `connected` → 不加角标（避免常亮噪声）。
- 数据：入口常驻组件在挂载时 `channels.list()` 一次 + 订阅 `onStatusUpdate`（轻量，3 个 manifest）。

### 2.2 面板（400px，portal 到 body，贴侧栏右缘、底部对齐锚点）

```
┌─ ⚡ 连接中心 ────────────── [● 2/3 已连接] ── ✕ ─┐   ← 头部：图标+标题+汇总 pill+关闭
│                                                    │
│ 消息频道                                            │   ← 分区标签(micro-label)
│ ╭────────────────────────────────────────────────╮ │
│ │ ▟ 飞书机器人   ● 运行中 · 处理 2      [ 断开 ] │ │   ← 品牌瓦片 34px + 名称/Beta + 状态 pill + 主动作
│ │ ▟ 钉钉机器人   ● 运行中              [ 断开 ] │ │
│ │ ▟ 企微机器人 β ● 未配置              [ 去配置→]│ │
│ ╰────────────────────────────────────────────────╯ │
│                                                    │
│ 手机 / 浏览器接入                                   │
│ ╭────────────────────────────────────────────────╮ │
│ │        ┌──────────┐   本机 WebUI · 监听中        │ │   ← listening 态：左 QR 右信息
│ │        │ ▓▓ QR ▓▓ │   https://192.168.1.5:…     │ │      (off 态此区域换成开启按钮，见 §4)
│ │        │ ▓▓▓▓▓▓▓▓ │   局域网内扫码即用            │ │
│ │        └──────────┘   [复制] [浏览器] [关闭]      │ │
│ ╰────────────────────────────────────────────────╯ │
│                                                    │
│ ⚙ 完整设置…                    esc 关闭 · ⌥C 唤起   │   ← 底栏：跳设置锚点 + 快捷键提示
└────────────────────────────────────────────────────┘
```

- 宽 400px（比通知面板 360px 略宽：QR 块要并排信息；定位算法照抄 `computePanelPosition`，仅 `PANEL_WIDTH=400`）。
- 最大高 `max-h-[min(560px,calc(100vh-16px))]`，内容区 `overflow-y-auto`。
- 层级 `z-[65]`（与通知面板同级，低于命令面板 `z-[70]`）。
- 全局快捷键 `Alt+C` 唤起/关闭（`useGlobalShortcuts` 已有 Ctrl 系注册框架，新增一个；避免占用 Ctrl+C）。

### 2.3 面板内「每频道一行」动作矩阵（定案）

| 五态 | 右侧主动作 | 动作实现 | 说明 |
|---|---|---|---|
| `not-configured` | 「去配置 →」 | 关面板 + `navigate('/settings#connection')` | 锚点揭示见 §5 |
| `disabled` | 「连接」 | `settings:set(channels.<id>.enabled, true)` | 主进程保存即重连自动 start；与设置页开关同源 |
| `connecting` | 「断开」（禁用转圈可选，本期直接可点） | `settings:set(channels.<id>.enabled, false)` | 自动 stop |
| `connected` | 「断开」 | `settings:set(channels.<id>.enabled, false)` | 同上；处理中/排队计数随行展示 |
| `error` | 「重试」 | `channels.start(id)` 直调 | enabled 已为 true，set 同值仍会触发 reconnect，但直调 start 语义最短；失败 detail 经五态推送展示 |

- `comingSoon` 占位渠道：整行降透明度、无动作按钮（与设置页占位卡一致）。
- 动作按钮请求期间本地 `pending` 态：按钮 `disabled` + 文案不变（IPC 很快，不做 spinner）。

---

## 3. 视觉规范（样式好看的核心）

### 3.1 频道品牌瓦片（新共享组件 `ChannelBrandIcon`）

设置页现用「蓝色系字母徽标」（`ChannelCard.tsx:24-33`）全部同色，辨识度差。升级为**每渠道品牌渐变瓦片**：

| 渠道 | 渐变 | 光效 |
|---|---|---|
| feishu 飞书 | `from-[#3370FF] to-[#5B8CFF]` | `shadow-[0_2px_8px_rgba(51,112,255,0.35)]` |
| dingtalk 钉钉 | `from-[#0089FF] to-[#00B2FF]` | `shadow-[0_2px_8px_rgba(0,137,255,0.35)]` |
| wecom 企微 | `from-[#00A944] to-[#33C46E]` | `shadow-[0_2px_8px_rgba(0,169,68,0.35)]` |
| 其他/未知 | `from-blue-500 to-indigo-500` | 默认 |

- 规格：`w-[34px] h-[34px] rounded-[10px]`（面板行）/ `w-9 h-9 rounded-xl`（设置页卡），白色字形单字居中 `font-bold`，外圈 `ring-1 ring-white/20`，底 `bg-gradient-to-br`。
- 字形：`manifest.label[0]`（现有 `ChannelIcon` 逻辑保留），后续换官方 SVG 时只改这一个组件。
- unknown/comingSoon 渠道：灰底 `from-gray-400 to-gray-500` + 虚线边框卡片语义保留在设置页。

### 3.2 五态状态呈现（升级 `ChannelStatusDot` → 加 pill 变体）

现版点+灰字（`ChannelStatusDot.tsx:16-22`）升级为**语义配色 pill**，点带辉光（参照 AgentStatusBar 运行点的 glow 手法 `AgentStatusBar.tsx:78-80`）：

| 态 | dot | 文字色 | pill 底 |
|---|---|---|---|
| connected | `bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] animate-pulse` | `text-emerald-600 dark:text-emerald-400` | `bg-emerald-500/10` |
| connecting | `bg-amber-400 animate-pulse` | `text-amber-600 dark:text-amber-400` | `bg-amber-500/10` |
| error | `bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.4)]` | `text-red-600 dark:text-red-400` | `bg-red-500/10` |
| disabled | `bg-gray-400 dark:bg-gray-600` | `text-gray-500 dark:text-gray-400` | 无底 |
| not-configured | 同 disabled | 同上 | 无底 |

- 组件签名：`<ChannelStatusBadge status degraded detail variant="pill"|"plain" />`——`plain` 即现版点+文字（向后兼容设置卡片头），`pill` 用于面板行与设置卡升级态。
- i18n 文案键完全沿用 `settings.channels.status.*`，不新增词。

### 3.3 面板壳与分区

```
壳:   fixed w-[400px] bg-white dark:bg-surface-elevated rounded-xl shadow-2xl
      border border-gray-200/60 dark:border-white/[0.08] overflow-hidden z-[65]
      animate-slide-in-left          ← 新关键帧: opacity 0→1 + translateX(-8px)→0 + scale .97→1
头部: px-4 py-3 border-b …；左侧 PlugZap 14px 灰 + 标题 text-sm font-semibold；
      汇总 pill: 「N/M 已连接」emerald 底（全连）/ amber 底（部分）/ gray（0 连接）
分区标签: px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-widest font-semibold
          text-gray-400 dark:text-gray-500（同 AgentStatusBar "AGENTS" 样式）
分区容器: mx-3 mb-1 rounded-xl border border-gray-200/70 dark:border-white/[0.06]
          bg-gray-50/60 dark:bg-white/[0.02] divide-y divide-gray-100 dark:divide-white/[0.04]
行:   px-3 py-2.5 flex items-center gap-2.5 hover:bg-white dark:hover:bg-white/[0.04]
      transition-colors
底栏: px-4 py-2.5 border-t …; 左「完整设置…」ghost 按钮（齿轮图标），
      右 kbd 提示「Alt C」(text-[10px] 灰)
```

### 3.4 二维码接入块（面板的视觉锚点）

```
off 态:
  ┌────────────────────────────────┐
  │ 📱 本机 WebUI · 未开启          │
  │   用手机浏览器控制这台电脑        │
  │   [ 开启并生成二维码 ]  ← 主按钮  │
  │   ⚠ 局域网内持有链接的人可访问    │
  └────────────────────────────────┘
listening 态:
  左: 白衬底 QR 卡  p-2 bg-white rounded-lg border border-gray-200/70
      shadow-sm w-[144px] h-[144px]  (QR 本体 128px, uqr border=2 模块白边)
  右: 状态行(emerald pill「监听中」) + 地址 code(text-[11px] font-mono break-all
      line-clamp-2, title=完整地址) + 副文案「局域网内扫码即用」
  下: 按钮行 [复制地址] [浏览器打开] | [关闭 WebUI](红色 ghost)
scheduled 且 !inSchedule:
  状态行 + 「当前不在开启时段」提示 + [查看定时设置→](跳 #webui)，不提供快捷开启
error:
  红 text 显示 status.error + [重试](重新 syncFromSettings 由保存触发,等价动作:
  settings:set('general.webUiMode', 当前值) 触发 sync —— 或直接提示去设置页)
```

- **QR 渲染**：`renderSVG(url, { ecc: 'M', border: 2 })` → SVG 字符串 → 容器 `dangerouslySetInnerHTML`（内容是本机生成的可信 SVG；不用 `<img data:>`，规避潜在 CSP 限制且矢量无锯齿）。组件 `QrCode.tsx`：`<QrCode value size />`。
- **URL 选择**：优先 `status.urls` 中以 `lanIpv4[0]` 为 host 的项，兜底 `urls[0]`；`loopback` 绑定时提示「仅本机可访问，手机需在设置中改为局域网」。
- 轮询：面板挂载期间 3s 拉 `sys.getWebUiStatus()`（对齐设置页 5s 轮询惯例，缩短到 3s 让「开启」反馈更快）。
- **安全叙事**（借 ZCode「地址即钥匙」）：off 态开启按钮下方一行小字「⚠️ 开启后，局域网内持有链接的人可访问本应用」；listening 态地址旁 title 提示「链接包含访问令牌，请勿外传」。

### 3.5 动效清单

| 场景 | 动效 |
|---|---|
| 面板入场 | 新增 `slide-in-left` 关键帧（translateX(-8px)+scale(.97)→1，0.2s ease-out），注册进 `@theme --animate-slide-in-left` |
| QR 出现 | `animate-fade-in` |
| connected 点 | `animate-pulse` + 辉光（§3.2） |
| 面板内切换动作 | 按钮仅 `disabled` 态变化，不加 spinner |
| 设置卡展开 | 内容区 `animate-slide-up` 0.2s（现无动画，直接闪现） |

### 3.6 设置页同步升级（「加深设置里对应的 UI」）

1. **ChannelCard**（`ChannelCard.tsx`）：
   - 图标换 `ChannelBrandIcon`（§3.1 大规格 36px）；
   - 状态换 `ChannelStatusBadge variant="pill"`；
   - 卡片容器升级 `CARD_INTERACTIVE`（hover 浮起已有配方 `ui-utils.ts:130`）+ `shadow-card`；
   - 「配置/收起」按钮统一 `BTN_SM_GRAY` 样式（现裸 border 手写），箭头字符 ▴▾ 换 lucide `ChevronDown`（`rotate-180` 过渡）；
   - 展开容器加 `animate-slide-up`；
   - 卡片头行右侧保持 ToggleSwitch（开关语义仍属设置页）。
2. **ChannelsSection**：
   - `Section` 传 `id="connection"`（锚点揭示，§5）；
   - intro 文案前加 lucide `Smartphone` 小图标，居左与卡片墙对齐；
   - 数据源集成子区标题从裸 h4 升级为同款 micro-label（与面板分区语言一致）。
3. **WebUiSection**：
   - `Section` 传 `id="webui"`；
   - 「状态」行升级：监听时左侧 emerald 辉光点 + 「正在监听」emerald 文字；URL code 块升级 `bg-gray-50 dark:bg-white/[0.04] rounded-lg px-2 py-1` 的 code-chip 样式；
   - 增加「在连接中心扫码」提示行（`Alt+C`）——双向导流。
4. **SettingsPage 顺序**：`General → Channels(连接中心) → WebUI → Chat → Mcp → …`（连接中心与 WebUI 紧邻上移，与面板分区对应）。

### 3.7 i18n

新增键（zh/en 同步，flat key 风格与现有一致）：

```
connectionCenter.title 连接中心
connectionCenter.section.channels 消息频道
connectionCenter.section.remote 手机 / 浏览器接入
connectionCenter.summary 「{n}/{m} 已连接」（tr 插值）
connectionCenter.openSettings 完整设置…
connectionCenter.action.connect 连接
connectionCenter.action.disconnect 断开
connectionCenter.action.retry 重试
connectionCenter.action.configure 去配置
connectionCenter.entryAria 连接中心
connectionCenter.webui.enable 开启并生成二维码
connectionCenter.webui.securityHint 开启后，局域网内持有链接的人可访问本应用
connectionCenter.webui.listening 监听中
connectionCenter.webui.scanHint 局域网内扫码即用
connectionCenter.webui.off 未开启
connectionCenter.webui.desc 用手机浏览器控制这台电脑
connectionCenter.webui.copy 复制地址
connectionCenter.webui.open 浏览器打开
connectionCenter.webui.close 关闭 WebUI
connectionCenter.webui.scheduledOut 当前不在定时开启时段
connectionCenter.webui.loopbackOnly 当前仅本机可访问，手机接入请在设置中改为局域网
connectionCenter.webui.tokenHint 链接包含访问令牌，请勿外传
```

---

## 4. WebUI 接入块状态机

```
        ┌───────── settings:set(webUiMode,'always') ─────────┐
        │                                                      ▼
   [off 未开启] ──开启──> [enabling 轮询中] ──listening=true──> [listening: QR]
        ▲                                                      │
        └──────────── settings:set(webUiMode,'off') ───────────┘
   scheduled && !inSchedule → 只读提示态（不提供快捷开关）
   status.error → 错误提示 + 引导设置页
```

- enabling 态 UI：按钮转「开启中…」disabled，最多等 3 个轮询周期（9s）后仍 false → 提示失败（一般端口被占自动顺延，成功率高）。
- 所有按钮走 `getAPI().settings.set` / `getAPI().sys.*`，不新增 IPC。

---

## 5. 设置页锚点揭示机制（hash 方案）

**方案**：`Section` 新增可选 `id?: string`。

- Section 内部 `useEffect`：挂载时与 `hashchange` 时，比对 `window.location.hash === '#'+id`；命中 → `setOpen(true)` + `requestAnimationFrame(() => ref.scrollIntoView({ behavior:'smooth', block:'start' }))`（rAF 等展开内容渲染出高度后再滚）。
- 面板/其他入口：`navigate('/settings#connection')`（react-router 的 hash 会被写入 URL；若已在 /settings 页则手动 dispatch `hashchange`——navigate 同页 hash 变化也会触发 Section 的 hashchange 监听，双保险）。
- 为何不用全局事件/store：hash 可深链、可收藏、时序天然安全（路由先切、Section 挂载后自比对），实现 ~15 行；事件方案有「面板已关、设置页未挂载」的时序坑。
- 其余 8 个 Section 不传 id，行为零变化（默认折叠逻辑不动，`Section.tsx:16-18` 保持本地 state）。

---

## 6. 实施文件清单

**新建**：

| 文件 | 职责 | 预估行数 |
|---|---|---|
| `src/renderer/components/channel/ChannelBrandIcon.tsx` | 品牌渐变瓦片（id→渐变映射，面板/设置页共用） | ~45 |
| `src/renderer/components/channel/ChannelStatusBadge.tsx` | 五态 pill/plain 状态徽标（含 glow/pulse；文案 hook 从 ChannelStatusDot 迁入） | ~85 |
| `src/renderer/components/connection-center/ConnectionCenter.tsx` | 入口按钮 + open 状态 + 外点/Esc 关闭 + error 红点 + `list()/onStatusUpdate` 订阅 | ~110 |
| `src/renderer/components/connection-center/ConnectionCenterPanel.tsx` | 面板壳（懒挂载、portal、400px 定位算法）+ 频道区 + 底栏 | ~200 |
| `src/renderer/components/connection-center/ChannelRow.tsx` | 单频道行（瓦片+pill+主动作，§2.3 矩阵） | ~120 |
| `src/renderer/components/connection-center/WebUiConnectBlock.tsx` | WebUI 接入块（§4 状态机 + 轮询 + QR 布局） | ~170 |
| `src/renderer/components/connection-center/QrCode.tsx` | uqr renderSVG 封装（白衬底卡） | ~35 |

**修改**：

| 文件 | 改动 |
|---|---|
| `package.json` | +`uqr`（dependencies，纯渲染层函数库） |
| `src/renderer/layouts/MainLayout.tsx` | 工具区插 `<ConnectionCenter />`（:233-247）；注册 `Alt+C` 快捷键（经 useGlobalShortcuts 或组件内 effect） |
| `src/renderer/styles/globals.css` | `@theme` 加 `--animate-slide-in-left` + `@keyframes slide-in-left` |
| `src/renderer/pages/Settings/components/Section.tsx` | +`id` prop + hash 揭示（§5） |
| `src/renderer/pages/Settings/SettingsPage.tsx` | Section 顺序调整（连接中心/WebUI 上移） |
| `src/renderer/pages/Settings/channels/ChannelsSection.tsx` | `id="connection"`、intro 图标、数据源子区 micro-label |
| `src/renderer/pages/Settings/channels/ChannelCard.tsx` | 换 ChannelBrandIcon + ChannelStatusBadge(pill) + CARD_INTERACTIVE + BTN_SM_GRAY + ChevronDown + 展开动画 |
| `src/renderer/pages/Settings/channels/ChannelStatusDot.tsx` | 变为 re-export `ChannelStatusBadge`（或删除并全量替换 import；倾向后者，引用点仅 ChannelCard 一处） |
| `src/renderer/pages/Settings/sections/WebUiSection.tsx` | `id="webui"`、状态行辉光点 + code-chip、连接中心导流行 |
| `src/renderer/i18n/zh.json` / `en.json` | §3.7 新键 |
| `src/renderer/hooks/useGlobalShortcuts.ts` | 增加 `Alt+C` → 打开连接中心（callback 经 props 或轻量 store） |

**明确不改**：主进程全部（channels/webui/settings IPC）、`src/shared/**`、通知中心、命令面板。

---

## 7. 验收标准

- [ ] `typecheck` / `lint` / `vitest run` 全绿（3883 基线不回归）。
- [ ] 侧边栏展开/折叠两形态下入口均正常，`Alt+C` 可唤起/关闭，Esc/外点关闭。
- [ ] 面板五态 × 动作矩阵（§2.3）逐项手测：连接（disabled→connecting→connected）、断开、重试（error）、去配置（跳设置并展开滚动到位）。
- [ ] 面板开关与设置页开关互为镜像：面板「断开」后设置页开关为关；设置页开面板即时反映（status-update 广播）。
- [ ] WebUI：off→开启→QR 出现（≤9s）；复制/浏览器打开/关闭可用；scheduled 态提示正确；暗色下 QR 白衬底可扫。
- [ ] 设置页：连接中心卡片墙新视觉（品牌瓦片/pill/hover 浮起/展开动画）；`#connection`、`#webui` 深链直达并自动展开。
- [ ] 暗色模式全量过一遍（面板/设置页/QR）。
- [ ] 新增组件纳入既有测试风格：`ConnectionCenter` 挂载/关闭、`ChannelRow` 动作矩阵、`QrCode` 产出 svg 字符串、Section hash 揭示——补 vitest 单测。

---

## 8. 风险与开放问题

1. **`uqr` SVG 的模块色**：默认黑模块白底；若 `renderSVG` 默认输出与预期不符（背景透明等），在 `QrCode.tsx` 内加 `backgroundColor:'#fff'` 选项兜底——实施时以单测锚定输出包含 `<svg` 与 `rect`。
2. **同值 set 触发重连的依赖**：面板「连接」依赖「保存路径必触发 reconnect」这一主进程行为（`settings-handlers.ts` 现实现为保存即触发）；若未来主进程改成「值变化才触发」，面板 disabled 态会出现不连接的边缘 case——用 `channels.start` 兜底不在本期（保持单一事实源），在 manager 层加防御更合适。
3. **`Alt+C` 快捷键冲突**：Electron 菜单/输入法占用的可能性低；若用户反馈冲突，改 `Ctrl+Alt+C`（键位提示文案同步）。
4. **面板与设置页同时打开**：两处各自订阅广播，状态收敛；动作互斥无锁——最坏情况是两边同时点「连接/断开」最终态以主进程最后到达的 set 为准，可接受。
5. **折叠态侧栏动画期间面板定位**：ResizeObserver 已重算（`NotificationPanel.tsx:106-108` 同款照抄）；真机验证折叠↔展开时面板位置跟随。
6. **`dangerouslySetInnerHTML` 注入 SVG**：内容来自 uqr 对本地生成 URL 的编码输出，无用户可控标记；qrcode 值为 `https://<ip>:<port>/?k=<token>`，无 `"`/`<` 注入面——风险可忽略，如仍有顾虑可换成 `DOMPurify`（不必，引依赖反而重）。

---

## 9. 来源

- 前次调研：`docs/research/2026-09-13-titlebar-connection-center-popover.md`（代码盘点 §1、外部参考 §2、方案对比 §3）
- uqr：https://github.com/unjs/uqr 、https://www.npmjs.com/package/uqr （`renderSVG(text, options)`，零依赖）[官方]
- 代码引用见文中 file:line（基线：2026-09-13 工作区，main @ 68019f0）

---

## 10. 二轮深化：视觉 v2（2026-09-13 同日追加）

> 背景：第一轮（§0-§9）已落地并通过 3894 用例 + 浅/深双主题截图验证。用户二轮指示：**样式要更好看**、面板与设置页对应 UI 继续加深。本节基于对 `tmp/visual-panel-{light,dark}*.png`、`tmp/visual-settings-connection-*.png` 的视觉走查与代码复查，收敛为以下 8 项；**只动视觉与微交互，不动信息架构边界**（§0.7 的「明确不做」继续有效）。

### 10.1 面板：头部品牌瓦片

**问题**：头部是 14px 灰色 `PlugZap` 裸图标——面板自己的「身份位」最弱，与频道行的品牌瓦片语言脱节（视觉走查：头部图标存在感低）。

**方案**：头部左侧升级为 24×24 渐变小瓦片，与 `ChannelBrandIcon` 同语言：

```
w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500
ring-1 ring-white/20 shadow-[0_2px_8px_rgba(59,130,246,0.35)]
白色 PlugZap 13px 居中
```

- 蓝靛渐变 = 连接中心的「自有品牌色」，与三频道的品牌瓦片并排时既统一（同规格/同 ring/同 shadow 手法）又可区分（连接中心本体 vs 单个频道）。
- 头部其余（标题/汇总 pill/关闭钮）不动。

### 10.2 面板：QR 取景框（扫码语义的视觉锚点）

**问题**：listening 态的二维码是一张裸白卡，无扫码引导；视觉走查确认 QR 区是面板最平淡的区域。

**方案**：QR 白卡外包一层 `relative` 容器，四角加 L 形取景框——相机取景的语言直给「扫这个」：

```
容器: relative（QR 卡本体尺寸不变,144px 白卡含 p-2 衬底）
四角: 4 个绝对定位 span,各 w-4 h-4,border 2px,emerald-500/80,
      分别 border-t+border-l / border-t+border-r / border-b+border-l / border-b+border-r,
      偏移 -4px(角在白卡外一点,不压码区)
data-testid="qr-frame"(测试锚点)
```

- emerald 取景框 + emerald「监听中」pill 同色系，状态语义连贯；深浅主题同色（QR 本体黑白与主题无关，框是装饰层不受对比度约束）。

### 10.3 面板：WebUI off 空态对称化

**问题**：off 态是一行横排小字（图标+文字+按钮），listening 态是 QR 大卡布局——**同一分区的两态结构完全不同**，开启成功瞬间布局跳变突兀；且 off 态视觉份量远低于其入口价值（这是面板的第二主功能区）。

**方案**：off 态重排为与 listening 同构的三段式：

```
┌──────────────────────────────────────────┐
│ ┌ ─ ─ ─ ─ ┐  本机 WebUI · 未开启          │   ← 左:144px 虚线取景框占位
│ │  (QR icon) │  用手机浏览器控制这台电脑     │      (QrCodeIcon 28px 居中,虚线边框
│ └ ─ ─ ─ ─ ┘  ⚠(ShieldAlert) 局域网…可访问 │       rounded-xl,同 QR 卡尺寸)
│              [ 开启并生成二维码 ]           │   ← 右:标题+desc+安全提示;下:动作行
└──────────────────────────────────────────┘
```

- 左侧占位框与 listening 的 QR 白卡**同尺寸同位置**（`w-[144px] h-[144px]`），开启时占位框原地被真 QR 替换 + `animate-fade-in`，无布局跳变。
- 「开启并生成二维码」主按钮沿用蓝底样式，放信息列下方（动作行位置与 listening 的「复制/浏览器/关闭」行对齐）。
- `enabling` 等待态：按钮转「开启中…」disabled（保持既有语义）。
- scheduled-不在时段、error 两态维持现状（只读提示，本就合理）。

### 10.4 面板：安全/错误提示图标统一

**问题**：off 态安全提示用 `⚠` emoji 文字前缀，error 态用 lucide `ShieldAlert` 图标——同类警示两种语言。

**方案**：off 态改为 `ShieldAlert` 11px + amber 色，与 error 态、loopbackOnly 提示统一为「图标 + 彩色小字」；移除 emoji 前缀（emoji 在 Windows 上渲染成彩色字形，与整体灰蓝视觉不符）。

### 10.5 面板：底栏「完整设置」加齿轮图标

**问题**：底栏「完整设置 →」是裸文字链接，与面板内其他动作（均带图标）语言不一致。

**方案**：前缀 lucide `Settings` 12px 图标，hover 变蓝的逻辑不变（`hover:text-blue-600` 时图标随 `currentColor` 一起变色）。

### 10.6 设置页：频道卡「已运行」时长（B1）

**问题**：设置页卡片只显示「运行中」静态文案；连接建立后用户无法感知「持续在线多久」（对教师用户，机器人稳定性是最关心的事）。

**方案**：`ChannelCard` 在 `connected` 且有 `connectedAt` 时，状态 pill 右侧显示灰字「已运行 2 小时 5 分」：

- 相对时长格式：`<1min → 刚刚`；`<60min → N 分钟`；`<24h → H 小时 M 分`；`≥24h → N 天`（i18n 键 `settings.channels.uptime.*`，en 对应 `just now / Nm / Hh Mm / Nd`）。
- `title` 属性显示完整连接时刻（`formatDateTime(connectedAt)`，ui-utils 已有）。
- 60s 间隔 `setInterval` tick 重渲染（面板不加——400px 行内已有 pill+计数+按钮，放不下；此为设置页专属信息密度的体现）。

### 10.7 设置页：卡片 hover 时品牌瓦片微放大（B2）

**问题**：卡片 hover 只有浮起+边框加深，品牌瓦片无反馈。

**方案**：卡片容器加 `group`，瓦片 `transition-transform duration-200 group-hover:scale-105`——与卡片浮起（`-translate-y-0.5`）形成同向的「拿起」动效。幅度 5% 保持克制。

### 10.8 设置页：WebUiSection 扫码导流行加 QR 图标（B3）

**问题**：「手机扫码接入可按 Alt+C 打开连接中心」是纯文字小字，导流价值未被视觉强调。

**方案**：前缀 lucide `QrCode` 12px 灰图标，与面板 QR 语言呼应。

### 10.9 验收（v2 增补）

- [ ] 面板头部为渐变瓦片 + 白色 PlugZap；浅/深主题均清晰。
- [ ] listening 态 QR 四角有 emerald 取景框（`data-testid="qr-frame"`）；off 态左侧为同尺寸虚线占位框；开启后占位框原位替换为真 QR，无布局跳变。
- [ ] off 态安全提示为 ShieldAlert 图标 + amber 文字（无 emoji）。
- [ ] 底栏「完整设置」带齿轮图标。
- [ ] 设置页：connected 卡片显示「已运行 …」（60s 自更新，title 为完整时刻）；hover 卡片时瓦片 scale-105；WebUiSection 扫码导流行带 QR 图标。
- [ ] 既有 12 个连接中心用例 + settings-page 用例全绿；新增用例：QR 取景框/占位框存在性、uptime 文案渲染（`connectedAt` 存在时）。
- [ ] `typecheck` / `lint` 全绿。
