# 调研报告：侧边栏「连接中心」弹出面板 UI/UX 方案

> 日期：2026-09-13 ｜ 性质：**只调研，不实施**（本轮未改动任何业务代码）
> 背景：用户希望在标题栏「通知中心、深色/浅色主题切换」旁边增加一个「连接中心」入口，点击弹出轻量聚合面板——能看连接状态、能发起连接/扫码、能跳转设置页对应位置；前期不把所有设置搬进来。外部形态参考腾讯 WorkBuddy 左下角的连接中心（点开弹出、可直接连接、扫码）与 ZCode（AI 编程客户端）自带的同类功能，但 UI 要有自己的设计，不照抄。
> 术语澄清：本应用使用系统原生标题栏（`src/main/bootstrap/window.ts:85` `titleBarStyle: 'default'`），没有自绘顶栏；用户口中的「标题栏入口」经代码核实是**侧边栏底部工具区**（通知中心 + 主题切换所在位置）。
> 外部调研来源标注：**[官方]** = 官方文档；**[社区]** = 教程/社区文章，未获官方确认。

---

## 0. 速览结论

1. **数据与动作层零新增即可复用**：设置页「连接中心」的三频道卡片墙（飞书/钉钉/企微）走 `channels:list/start/stop/test` + `channels:status-update` 五态推送（`src/shared/ipc-channels.ts:224-228`），弹窗直接调同一组 IPC 就是「数据同源、动作同源」；`enabled` 开关的「保存即重连」联动已在主进程实现（`src/main/ipc/settings-handlers.ts:74-110,160-349`）。
2. **「扫码连本机」的后端已就绪，只差二维码**：本机 WebUI 网关（HTTP/HTTPS + 令牌鉴权 + 局域网绑定 + 含令牌访问地址）已完整存在（`src/main/services/webui-service.ts`），设置页「本机 WebUI」区已能复制地址/浏览器打开；但全仓库**没有任何二维码生成能力**（package.json / package-lock.json 均无 qrcode 依赖），需要新增一个轻量前端依赖。
3. **弹出面板有现成范式可抄结构**：通知中心「常驻按钮 + portal 弹出面板 + 点击外部/Esc 关闭 + 懒挂载」整套模式（`NotificationCenter.tsx` / `NotificationPanel.tsx`）就是本项目自己的 Popover 规范，新面板照此实现即可，无需引入组件库。
4. **推荐方案 B（单页聚合快捷面板）**：360px 面板分「消息频道」「手机/浏览器接入」两个区块 + 底部「完整设置」跳转；信息架构上弹窗只放「状态 + 一个主动作 + 跳转」，表单/高级配置一律留在设置页。
5. **主要缺口**：设置页是单页长滚动且各 Section 默认折叠（`Section.tsx:16-18`），「跳转到设置页对应位置」需要给设置页补一个「锚点 + 自动展开 + 滚动定位」的小机制（详见 §5、§6）。

---

## 一、代码现状盘点

### 1.1 入口位置：侧边栏底部工具区

侧边栏底部有一个横排工具区，从左到右依次是通知中心、主题切换（主题按钮展开态占满剩余宽度）：

| 元素 | 位置 | 说明 |
|---|---|---|
| 底部工具区容器 | `src/renderer/layouts/MainLayout.tsx:233-247` | 注释即「底部工具区: 通知中心 + 主题切换」；折叠态纵向堆叠（`:237`） |
| 通知中心入口 | `src/renderer/layouts/MainLayout.tsx:240` → `src/renderer/components/notification/NotificationCenter.tsx:45-79` | 16px 铃铛 + 8×8 按钮 + 未读红点徽标（`:61-65`） |
| 主题切换入口 | `src/renderer/layouts/MainLayout.tsx:242-246` → `src/renderer/components/ThemeToggle.tsx:56-75` | 展开态带文字、折叠态 `iconOnly` 两种形态（`:62-66` 双 className 分支） |

**空位评估**：展开态工具区是 `flex items-center gap-2`（`:237`），主题按钮 `flex-1` 占满剩余宽度——在其左侧插入一个图标按钮即可，主题按钮的 `flex-1` 会自动让位；折叠态是纵向堆叠（通知、主题各一行），再加一行图标即可。**现有两个图标均为 8×8(w-8 h-8) 圆角钮规格，新入口照此对齐即可，无横向溢出风险**（侧栏宽 240px/68px，`MainLayout.tsx:89`）。

入口按钮的「状态外显」也有先例：侧栏底部 `AgentStatusBar` 会显示 Agent 运行徽章与状态点（`src/renderer/layouts/AgentStatusBar.tsx:27-38,68-91`）——连接中心入口按钮可以同样在「有频道 error」时显示红点角标（主进程在频道出错时本来就会发系统通知，`src/main/ipc/channel-handlers.ts:58-88`，UI 角标可共用同一状态事件）。

### 1.2 可直接复用的弹出面板范式（本项目自己的 Popover 规范）

通知中心实现了完整的「图标按钮 → 弹出面板」链路，新连接中心面板应完全对齐这套做法：

| 机制 | 位置 | 要点 |
|---|---|---|
| 按钮常驻 + 面板懒挂载 | `NotificationCenter.tsx:14-16,69-77` | 面板 `React.lazy`，打开才加载，entry 减负 |
| 点击外部 / Esc 关闭 | `NotificationCenter.tsx:27-43` | 面板 portal 到 body 后不再按钮的 DOM 子节点，需同时判定 `rootRef` 与 `panelRef` |
| 定位算法 | `NotificationPanel.tsx:56-57,68-79` | `PANEL_WIDTH=360`、`PANEL_GAP=8`；贴侧栏右缘、底部对齐按钮；监听窗口 resize + 侧栏 ResizeObserver 重算 |
| portal + 视觉 | `NotificationPanel.tsx:125-131` | `createPortal` 到 body，`fixed` 定位，`w-[360px] bg-white dark:bg-surface-elevated rounded-xl shadow-2xl border … z-[65] animate-scale-in` |
| 数据挂载即就绪 | `NotificationPanel.tsx:81-98` | 状态全部来自全局 store（与按钮解耦），面板内 60s 心跳刷新相对时间 |
| 面板内跳转 | `NotificationPanel.tsx:115-121` | 点击项 `navigate(target)` 并先 `onClose()`——「跳设置页对应位置」可照搬 |

层级参考：通知面板 `z-[65]`，命令面板遮罩 `z-[70]`（`src/renderer/components/command-palette/CommandPalette.tsx:224`）。命令面板本身就是「全局 store + 懒挂载 + Esc 关闭」的第二个实现（`MainLayout.tsx:26-31,69-73`），可作为面板内容较重时的参照。

### 1.3 设置页「连接中心」：数据模型与 IPC（可整体复用）

设置页连接中心 = 消息频道卡片墙（manifest 驱动）+ 数据源集成（bitable 出站）。与弹窗相关的部分：

**类型与五态**（`src/shared/types/channel.ts`）：
- 五态运行状态 `ChannelRunStatus`：`not-configured / disabled / connecting / connected / error`（`:75-80`）；`ChannelStatusInfo` 带 `detail/degraded/connectedAt/processingCount/pendingCount`（`:83-93`）。
- `ChannelManifest`：`id/label/description/icon/capabilities/configSchema/setupGuide/beta/comingSoon`（`:143-157`）；`ConfigField` 支持 `showIf` 条件显隐与 `pattern` 校验（`:121-135`）。
- `ChannelInstanceInfo = { manifest, configured, enabled, status }`——弹窗行卡片需要的全部信息就是这个结构（`:160-167`）。

**IPC 面**（`src/shared/api/channels.ts:8-19`，实现在 `src/main/preload/api/channels.ts`）：

| API | 通道 | 用途 |
|---|---|---|
| `channels.list()` | `channels:list` | 渠道目录 + 五态派生（挂载拉取） |
| `channels.start(id)` | `channels:start` | 启动（主进程校验 `isConfigured`，`manager.ts:174-183`） |
| `channels.stop(id)` | `channels:stop` | 停止（排空收尾，`manager.ts:186-195`） |
| `channels.test(id)` | `channels:test` | 凭证校验（不建长连接） |
| `channels.onStatusUpdate(cb)` | `channels:status-update` | 状态实时推送（`channel-handlers.ts:58-88` fanout） |

**注册与目录**：飞书/钉钉/企微三个适配器在 `src/main/ipc/channel-handlers.ts:22-26` 注册（企微 `beta: true`，`src/main/services/channels/adapters/wecom/manifest.ts:16-21`）；`channelManager.list()` 统一做五态派生（`src/main/services/channels/manager.ts:126-151`）。

**「保存即重连」已在主进程闭环**：`settings:set` 对 `channels.<id>.enabled` 与凭证字段的保存会触发 `reconnectFeishuBot/reconnectDingtalkBot/reconnectWecomBot`——`enabled && 凭证齐全 → channelManager.start(id)`，否则 `stop(id)`（`src/main/ipc/settings-handlers.ts:74-110`，触发点 `:160-349`）。**这意味着弹窗里做「连接/断开」有两个等价实现可选**：a) 直调 `channels:start/stop`（语义更直接，`channels:start` 只校验 configured、不看 enabled）；b) 写 `settings:set('channels.<id>.enabled', v)` 走设置页同款联动（状态语义与设置页开关完全一致）。建议 a 为主、不面板内改 enabled（见 §4.4）。

**设置页卡片墙组件**（`src/renderer/pages/Settings/channels/`）：
- `ChannelsSection.tsx:52-68` 挂载拉取 `channels.list()` + 订阅 `onStatusUpdate`（卸载退订），`:70-76` settings 变化后轻量重拉；`:87-106` 卡片墙网格；`:79` `Section` 标题「连接中心」（`Section` 默认折叠，见 §1.5）。
- `ChannelCard.tsx:56-87` 卡片头（字母徽标图标 + 名称 + Beta/即将支持徽标 + 状态点 + 启用开关）；`:93-117` 处理中/排队计数 + 配置展开按钮。
- `ChannelStatusDot.tsx:16-22` 五态配色点、`:25-41` `useChannelStatusText()` 文案 hook——**可直接导出复用到弹窗**。
- `ChannelConfigPanel.tsx:51-56` `SchemaForm`（manifest 驱动表单）+ `:61-83` 测试连接按钮——**弹窗不搬**，这是「完整版」的内容。
- 渲染层**没有 channels 全局 store**，`ChannelsSection` 用本地 `useState`（`ChannelsSection.tsx:38-39`）。弹窗照做本地 state 即可（两个订阅者都收 `channels:status-update` 广播，状态天然收敛）；若后续出现第三个消费方再考虑提 store。

### 1.4 本机 Web UI 现状：网关已完整，二维码缺失

**已存在的能力**（这是本产品自己的「Remote Control」底座，且比想象中完整）：

| 能力 | 位置 | 现状 |
|---|---|---|
| HTTP/HTTPS 网关 | `src/main/services/webui-service.ts:201-269` + `src/main/services/webui/gateway.ts` | 静态托管整个 renderer 构建（`gateway.ts:368` `serveStatic(rendererRoot)`，**手机浏览器打开即完整应用**）+ 同源 WS RPC 复用全部 IPC 面（`gateway.ts:326` `/ws`；`channel-handlers.ts:4-6` 注释「WebUI 网关免费复用」）+ `/upload` 上传（`gateway.ts:330`） |
| 开关模式 | `webui-service.ts:65-76` | `off`（默认）/ `always` / `scheduled`（按周定时），端口默认 18765 被占自动顺延（`:28,239-260`） |
| 鉴权 | `webui-service.ts:78-88` + `webui/security.ts` | 256-bit 访问令牌存 keystore、持久不自动轮换；URL 自带令牌；局域网模式拒绝公网来源、IPv6 只放行同 /64 前缀 |
| 状态查询 | `webui-service.ts:104-136` → `WebUiStatus`（`src/shared/types/webui.ts:9-29`） | 含 `listening/urls(含令牌)/lanIpv4/lanIpv6/accessToken/tokenBits/error` 等 |
| 预加载 API | `src/main/preload/api/sys.ts:36-38` | `getWebUiStatus / openWebUi / regenerateWebUiToken`（`src/shared/ipc-channels.ts:244-246`） |
| 设置页 UI | `src/renderer/pages/Settings/sections/WebUiSection.tsx` | 5s 轮询状态（`:67-71`）、复制地址/浏览器打开（`:198-225`）、端口/协议/绑定/IPv6/证书/令牌管理 |
| 保存即生效 | `src/main/ipc/settings-handlers.ts:390-398,435` | `general.webUi*` 任一字段保存立即 `webUiService.syncFromSettings()`，无需等 15s 心跳 |
| 托盘联动 | `src/main/services/tray-service.ts:75-90` + `app-lifecycle.ts:155-163` | 托盘菜单含 WebUI 开关项 |

**缺失的能力**：
1. **二维码生成**：全仓库无 qrcode 依赖、无任何二维码渲染代码。弹窗要「扫码连本机」需新增轻量前端依赖（纯渲染进程生成 dataURL/SVG 即可，如 `qrcode` 或更小的 `uqr`，不涉主进程/原生模块）。
2. **「临时开启」模式**：`webUiMode` 只有 off/always/scheduled 三态。ZCode 的扫码是「临时钥匙」语义；当前若从弹窗开启只能切到 `always`。可先接受该语义（面板文案明示 + 引导去设置页关闭），或后续增加 `on-until-quit` 第四态（列入 §6 开放问题）。
3. **状态推送**：WebUI 状态没有 renderer 推送事件，设置页靠 5s 轮询（`WebUiSection.tsx:67-71`）——弹窗打开期间照此轮询即可，与既有约定一致。

### 1.5 设计语言与组件约束（弹窗必须遵守）

- **无组件库**：项目不用 antd/radix/headlessui，全部自研轻组件（Button/Badge/Card/Tabs/ConfirmDialog/ContextMenu/Toast 等在 `src/renderer/components/`）+ Tailwind 工具类。弹窗不引入新库。
- **暗色模式**：Tailwind v4 `@custom-variant dark`（class 策略），语义表面色 `bg-canvas / bg-surface-secondary / bg-surface-elevated` 等定义在 `src/renderer/styles/globals.css` 的 `@theme`（`:29-35`）。弹出面板的既有配方：`bg-white dark:bg-surface-elevated` + `border-gray-200/60 dark:border-white/[0.08]` + `shadow-2xl` + `animate-scale-in`（`NotificationPanel.tsx:129`）。
- **交互细节**：按钮 hover `hover:bg-gray-100 dark:hover:bg-white/[0.08]`、focus ring `focus-visible:ring-2 focus-visible:ring-blue-500/40`（`NotificationCenter.tsx:53-58`）；小按钮用 `btnStyle('secondary')` / `BTN_SM_BLUE`（`src/renderer/lib/ui-utils.ts:133-160` 附近）。
- **i18n**：`useT()` 带 fallback 的 `t('key', '默认文案')` 模式（各组件均如此），新面板新增 key 时照抄。
- **折叠态适配**：侧栏折叠后工具区纵向堆叠、`ThemeToggle` 切 `iconOnly`（`MainLayout.tsx:241-246`）——新入口同样要支持两种形态，且面板定位算法已处理侧栏宽度变化（ResizeObserver，`NotificationPanel.tsx:106-108`）。

### 1.6 复用性小结

| 弹窗需求 | 结论 | 依据 |
|---|---|---|
| 看各频道连接状态 | ✅ 直接复用 | `channels:list` + `onStatusUpdate` + `ChannelStatusDot`（可导出复用） |
| 一键连接/断开 | ✅ 直接复用 | `channels:start/stop`；或 settings 联动（`settings-handlers.ts:74-110`） |
| 扫码连本机 WebUI | ⚠️ 后端齐、缺二维码 | 网关/令牌/URL 全有（§1.4），需新增 qrcode 依赖；WebUI 可能处于 off 态需面板内快捷开启 |
| 跳转设置页对应位置 | ⚠️ 需小改造 | `/settings` 路由已有，但页面无锚点且 Section 默认折叠（§1.5、`Section.tsx:16-18`） |
| 弹出面板壳 | ✅ 照抄范式 | NotificationCenter/NotificationPanel 全套（§1.2） |

---

## 二、外部参考

### 2.1 ZCode Remote Control（用户点名的原型）[官方]

来源：ZCode 官方文档「Remote Control」（https://zcode.z.ai/cn/docs/remote-control）。

- **入口**：左下角侧栏手机图标 → 打开「移动端远程控制」弹窗。
- **弹窗布局**：左侧生成**二维码 + 连接地址**，右侧是 **Bot Channel**（微信/飞书 Bot）入口——「临时接入扫码」与「长期回访 Bot」两个入口并排放进同一个弹窗，按需选择。
- **连接语义**：连接地址自带授权，「拿到它就能操作你的窗口」= 一把临时钥匙；**刷新二维码旧地址立即失效**；关闭弹窗不停止远控，必须点「停止」；同一时间只支持一个手机连接。
- **手机端定位**：纯控制层——看工作区/任务/会话、底部输入框续指令；不碰代码、不同步运行环境。
- **与 Bot Channel 的关系**：并行的两个移动端入口，共用同一弹窗。

**对本项目的映射**（有意思的是，ZCode 弹窗的两半恰好对应我们已有的两个体系）：

| ZCode 弹窗 | 本项目对应物 | 现状 |
|---|---|---|
| 右侧 Bot Channel | 连接中心（飞书/钉钉/企微频道适配器） | ✅ 已有 IPC/状态体系（§1.3） |
| 左侧二维码 + 地址 | 本机 WebUI 网关 | ✅ 已有网关/令牌/URL，❌ 缺二维码（§1.4） |

### 2.2 WorkBuddy 连接器 / 渠道接入 [官方] + [社区]

来源：WorkBuddy 官方文档（https://www.workbuddy.cn/docs/...）与社区教程。

- **连接器管理页** [官方]：左侧导航栏「连接器」进入卡片墙页面（消息框也支持快捷管理）；卡片 = 名称 + **绿点状态** + 已连接右侧**启用/禁用开关**、未连接显示「+」发起连接；点击已连接卡片在弹窗中可解绑。扫码授权流程（QQ 邮箱例）：点「+」→ 授权页出二维码 → 手机 App 扫码确认权限 → 浏览器弹窗点「打开」完成。
- **渠道/助理接入** [官方]：与连接器是两套体系（微信/企微/QQ/飞书/钉钉六篇指南）；企微路径：**左下角头像菜单 → 设置 → 助理设置 → 集成（BETA）→ 配置 → 弹窗选 WebSocket 长连接 → 手机企微扫码**；微信直连在「Claw 设置」扫码，二维码**有时效**，过期重新生成 [官方+社区]。
- 用户描述的「左下角连接中心入口、点开弹出、可直接连接、扫码」与上述左下角头像菜单/集成弹窗形态一致；WorkBuddy 的卡片墙（绿点 + 开关 + 引导）此前已蒸馏进设置页 ChannelCard 的设计（见 2026-09-12 两份前序报告）。

### 2.3 蒸馏：可借鉴与不照抄的点

**可借鉴的共性模式**：
1. **一个弹窗装两类接入**（ZCode）：左「扫码即时接入」右「频道长期接入」——与本产品「WebUI + 消息频道」完全同构。
2. **地址即钥匙的安全叙事**（ZCode）：二维码旁明示「等同临时钥匙」、提供刷新/停止按钮、明示关闭弹窗不等于停止。
3. **卡片绿点 + 单主动作**（WorkBuddy）：每张卡只呈现「状态 + 一个动作」，复杂配置收进二级。
4. **扫码失败兜底**（WorkBuddy/腾讯云社区教程）：二维码有时效，提供「刷新」与「复制链接手动打开」双通道（手机和电脑不在同一局域网时的唯一出路）。

**不照抄的点**：
- WorkBuddy 的连接器卡片墙已是我们**设置页**的形态，弹窗不再复制一张完整卡片墙（避免两处同质 UI）。
- ZCode 的手机端是完整任务控制台；本产品 WebUI 打开的也是完整应用（`gateway.ts` 托管整个 renderer），弹窗内**不需要**也不应该再造一个「手机端预览」。

---

## 三、候选交互方案对比

| | 方案 A：纯状态 Popover | **方案 B：单页聚合快捷面板（推荐）** | 方案 C：分页签聚合面板 |
|---|---|---|---|
| 形态 | 360px 面板：频道状态只读列表 + 「去设置」链接，无动作无扫码 | 360px 面板：分区单页——「消息频道」每行 状态+一个主动作；「手机/浏览器接入」状态+二维码入口；底部「完整设置→」 | 360px 面板内 Tabs：消息频道 / 手机接入 / 更多 |
| 优点 | 实现最快（半天级）；零新依赖；纯只读无副作用 | 覆盖用户全部三条诉求（看状态/发起连接/扫码）；单页无点击层级；完全复用 §1.3/§1.4 现有 IPC；结构上给未来扩展留了「分区」而不留「页签维护负担」 | 分区逻辑最显式；未来每个页签可独立长胖 |
| 缺点 | 「可直接连接、扫码」两条诉求落空，弹出后仍要跳设置页，体验断层 | 面板内容稍多（约 250-350 行组件）；WebUI off 态时的快捷开启需要一句安全提示文案 | 360px 宽度下 tabs + 内容过挤；前期内容量（3 频道 + 1 WebUI）撑不起页签；每次切签多一次认知成本 |
| 适配后续频道扩展 | 好 | 好（列表天然可增行；再加「数据源集成」等分区也只是加一段） | 好，但页签数量膨胀后回到 C 的拥挤问题 |
| 与既有范式一致性 | 高 | 高（同 NotificationPanel 壳） | 中（项目 Tabs 组件未在浮层用过） |

**推荐：方案 B**。理由：用户明确要「轻量聚合」，B 是唯一同时满足「看状态、发起连接、扫码、跳设置」且不引入点击层级的形态；它照搬通知中心的壳（视觉与交互零学习成本），数据层零新增；C 的页签是为「内容多」设计的，而本期边界恰恰是「内容少」（§4.2）。A 可作为 B 的降级实现阶段（先上状态+跳转，扫码随后补）——但既然 qrcode 依赖只是一次 `npm i`，建议一步到位。

---

## 四、推荐方案与信息架构

### 4.1 方案 B：单页聚合快捷面板

```
侧栏底部工具区:  [🔗 连接中心(新)] [🔔 通知中心] [──── 🌙 主题(flex-1) ────]
                        │ 点击
                        ▼ (portal 到 body, 贴侧栏右缘, 360px, z-[65])
┌─ 连接中心 ────────────────────────[1/3 已连接] ✕ ─┐
│ 消息频道                                            │
│ ┌──────────────────────────────────────────────┐  │
│ │ [飞] 飞书机器人   ● 运行中        [断开]      │  │
│ │ [钉] 钉钉机器人   ● 未配置        [去配置→]   │  │
│ │ [企] 企微机器人 β ● 已停用        [连接]      │  │
│ └──────────────────────────────────────────────┘  │
│ 手机 / 浏览器接入                                   │
│ ┌──────────────────────────────────────────────┐  │
│ │ 本机 WebUI · 未开启                           │  │
│ │   [开启并生成二维码]  (提示: 局域网内可访问)   │  │
│ │ ── 开启后 ──                                  │  │
│ │ [二维码]  https://192.168.x.x:18765/?k=…      │  │
│ │   [复制地址] [浏览器打开] [刷新二维码] [关闭]  │  │
│ └──────────────────────────────────────────────┘  │
│ 完整设置 →          （连接状态异常时入口按钮亮红点）│
└──────────────────────────────────────────────────┘
```

### 4.2 放什么 / 不放什么（本期边界）

**放（每项都是既有能力的重组）**：
1. **头部**：标题「连接中心」+ 汇总徽章「N/M 已连接」（数据 = `channels.list()` 统计）+ 关闭按钮。
2. **消息频道区**（每频道一行，非卡片墙）：字母徽标 + 名称（含 Beta 徽标）+ `ChannelStatusDot` 五态点 + **至多一个主动作**：
   - `connected/connecting` → 「断开」（`channels.stop`）
   - `not-configured` → 「去配置」（跳设置页锚点）
   - `disabled` 或已配置未运行 → 「连接」（`channels.start`；失败时五态自然转 error，detail 截断 40 字符展示，与 `ChannelStatusDot.tsx:56-59` 一致）
   - `error` → 「重试」（`channels.start`）
   - 处理中/排队计数只读展示（`processingCount/pendingCount`）。
3. **手机/浏览器接入区**（本机 WebUI）：
   - `off` 态：状态行「未开启」+ 主按钮「开启并生成二维码」（`settings.set('general.webUiMode','always')` → 主进程即时同步（`settings-handlers.ts:390-398`）→ 轮询拿 `WebUiStatus.urls[0]` → 前端生成二维码）+ 一行小字安全提示。
   - `listening` 态：二维码（内容 = `urls` 中局域网 IPv4 地址，兜底 `urls[0]`）+ 地址明文 + 「复制地址」「在浏览器打开」（`sys.openWebUi`）「刷新」（重新生成二维码即可；如需换令牌走设置页 `regenerateWebUiToken`，面板不放）。
   - `scheduled` 但不在时段：展示 `inSchedule=false` 与下个时段提示，不提供快捷开启（避免覆盖用户定时策略）。
4. **底部**：「完整设置 →」（导航 `/settings` 并展开滚动到连接中心/本机 WebUI，见 §5）。

**明确不放（写进边界，防蔓延）**：
- `SchemaForm` 配置表单、`ChannelConfigPanel` 的测试连接/setupGuide 指引——只属于设置页「完整版」。
- 数据源集成（bitable 同步/教师推送）。
- WebUI 高级项：端口/协议/绑定范围/IPv6/自定义证书/令牌管理。
- 频道 enabled 开关本体（面板用「连接/断开」动作表达意图，开关语义留在设置页，避免两个布尔语义打架）。

### 4.3 与设置页连接中心的关系

- **数据同源**：弹窗与 `ChannelsSection` 各自调 `channels.list()` 并订阅 `channels:status-update` 广播（`channel-handlers.ts:59-64` 是对所有窗口/浏览器的 fanout）——无共享 store 也不会状态分叉；弹窗修改后设置页下次挂载或 settings 变化刷新即收敛（既有行为，`ChannelsSection.tsx:70-76`）。
- **动作复用**：连接/断开/测试走同一组 IPC；`enabled` 开关的保存即重连联动不变（`settings-handlers.ts:74-110`）。
- **定位分工**：设置页 = 完整版（配置、诊断、指引、安全高级项）；弹窗 = 快捷版（状态 + 一个动作 + 扫码 + 跳转）。弹窗内不放任何「只有设置页才能解释」的配置项。

### 4.4 关键交互细节

1. **面板动作的主进程语义差**：`channels:start` 只查 `isConfigured` 不查 `enabled`（`manager.ts:174-183`）。若用户在设置页关了 enabled、在面板点「连接」，会连接成功但设置页开关仍显示关——建议面板在 `disabled` 态的主动作改为「去配置」（或连接前先 `settings.set('channels.<id>.enabled', true)`，与设置页语义合并）。二选一，实施时定。
2. **WebUI off 态快捷开启的提示文案**：需明示「局域网内持有链接的人可访问本应用」；二维码即令牌，等同 ZCode「地址即钥匙」叙事；「关闭 WebUI」按钮放面板内（改回 `webUiMode:'off'`），让用户开启后能一键收回。
3. **二维码内容选择**：优先取 `lanIpv4` 中的地址（手机扫码场景），本机/IPv6 地址放「复制地址」列表；`https` 自签证书首次打开需信任（设置页已有该提示文案，可复用）。
4. **无频道可用**（`instances.length===0`）与 WebUI 被禁用（如企业策略）时的空态兜底，照 `NotificationPanel.tsx:172-181` 的空态样式。
5. **入口角标**：任一频道 `error` 时入口按钮显示红点（复用 `channels:status-update`，与 `channel-handlers.ts:65-84` 的系统通知同源不冲突）。

---

## 五、实施切入点（文件清单）

> 均为基于现有结构的建议路径；本期只调研未实施。

**新建**：

| 文件 | 职责 |
|---|---|
| `src/renderer/components/connection-center/ConnectionCenter.tsx` | 入口按钮 + open 状态 + 外点/Esc 关闭（照 `NotificationCenter.tsx` 结构）；入口 error 红点角标 |
| `src/renderer/components/connection-center/ConnectionCenterPanel.tsx` | 面板本体（懒挂载、portal、360px 定位算法照 `NotificationPanel.tsx:56-79`）；内部拆 `ChannelRow`（频道行）与 `WebUiConnectBlock`（扫码块）两个子组件 |
| `src/renderer/components/connection-center/QrCode.tsx`（或直接引库） | 二维码渲染（新增轻量依赖如 `qrcode`，纯前端 dataURL） |

**修改**：

| 文件 | 改动 |
|---|---|
| `src/renderer/layouts/MainLayout.tsx:233-247` | 工具区插入 `<ConnectionCenter />`（通知中心左侧），展开/折叠两形态 |
| `src/renderer/pages/Settings/components/Section.tsx` | 增加 `id`/受控展开能力（或新增 `sectionId` prop + 全局事件 `settings:reveal-section`） |
| `src/renderer/pages/Settings/SettingsPage.tsx` | 监听 reveal 事件：展开对应 `Section` + `scrollIntoView`（页面本身 `overflow-y-auto`，`:156`） |
| `src/renderer/pages/Settings/channels/ChannelStatusDot.tsx` | 把 `DOT_CLASS`/`useChannelStatusText` 导出（已是具名导出，弹窗直接 import，可能零改动） |
| `src/renderer/pages/Settings/channels/ChannelsSection.tsx:79` | 传入 sectionId，配合锚点展开 |
| i18n 资源（`src/renderer/i18n/`） | 新增 `connectionCenter.*` 键（面板沿用 `t(key, fallback)` 兜底模式可先行） |
| `package.json` | 新增二维码生成依赖（纯 JS、无原生模块） |

**明确不改**：主进程 channels/webui 全部服务与 IPC（`src/main/services/channels/*`、`src/main/services/webui*`、`src/shared/api/channels.ts`、`src/main/preload/api/{channels,sys}.ts`）——本期弹窗是纯渲染层消费方。

---

## 六、风险点与开放问题

1. **弹窗与设置页的状态同步**：两处独立订阅同一广播，正常收敛；但弹窗内 `channels:start` 失败（如凭证中途失效）只反映在五态 error 上，面板需处理 `start()` 抛错的结构化展示（参照 `ChannelConfigPanel.tsx:31-46` 的测试连接三态）。若未来出现第三个消费方，再考虑把 `list+onStatusUpdate` 提为 `useChannelInstances()` hook 或全局 store。
2. **WebUI 快捷开启的安全面**：从面板一键 `webUiMode:'always'` 会持久化（重启后仍开）——与 ZCode「临时钥匙」语义不同。缓解：面板文案明示 + 提供面板内一键关闭；更优解是新增 `on-until-quit` 模式（涉及 `webui-service.ts` schedule 逻辑与 settings schema，建议独立小任务）。
3. **窗口失焦/折叠态**：外点关闭已由范式覆盖；侧栏折叠时面板仍从 `anchorRef` 定位（ResizeObserver 已处理宽度变化），但需真机验证折叠→展开动画期间面板位置跳变。
4. **暗色模式**：二维码为黑白图，深色面板上需白色内衬底（`bg-white p-2 rounded`），避免 `dark:bg-surface-elevated` 上对比度不足与扫码失败。
5. **设置页锚点改造的波及面**：`Section` 目前纯本地 state（`Section.tsx:16-18`），改受控要注意不影响其余 8 个 Section 的折叠行为；建议用「事件 + 默认 state 初始化」而非全量受控。
6. **企微 beta 语义**：企微长连接单设备互踢（前序报告 §2.2），面板「连接」失败文案需能承载 `detail`（已支持截断展示）。
7. **待用户决策**：a) `disabled` 态主动作选「去配置」还是「连接前自动开 enabled」（§4.4-1）；b) WebUI 快捷开启是否接受持久化 `always`，还是先做 `on-until-quit`；c) 面板是否需要同时展示「数据源集成」一行的只读状态（建议本期不放，边界见 §4.2）。

---

## 附：主要来源

- ZCode Remote Control 官方文档：https://zcode.z.ai/cn/docs/remote-control （入口/弹窗布局/二维码时效/单连接/停止按钮/控制层定位）[官方]
- ZCode 更新日志（移动端界面修复）：https://zcode.z.ai/cn/changelog [官方]
- WorkBuddy 连接器文档：https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector （卡片墙/绿点/开关/扫码授权）[官方]
- WorkBuddy 微信客服号接入（二维码时效）：https://www.workbuddy.cn/docs/workbuddy/Wechat-Guide [官方]
- WorkBuddy 企微接入（头像菜单→设置→集成 BETA→长连接→扫码）：https://www.workbuddy.ai/docs/zh/workbuddy/Platform-Integration/Wecom-Guide 、 https://www.codebuddy.cn/docs/workbuddy/Wecom-Guide [官方]
- WorkBuddy 微信小程序/App 远程控制教程（腾讯云社区）：https://developer.cloud.tencent.com/article/2706774 [社区]
- WorkBuddy 连接器 30+ 全景（云巴巴）：https://www.yun88.com/qa/6414.html [社区]
- 本仓库前序调研：`docs/research/2026-09-12-feishu-bot-ux-and-channel-architecture.md`（§4 频道架构）、`docs/research/2026-09-12-channel-connector-catalog.md`（钉钉/企微能力位）
- 代码引用均见文中 `file:line`（基线：本次调研时工作区，含 channels/webui 已合入的现状）
