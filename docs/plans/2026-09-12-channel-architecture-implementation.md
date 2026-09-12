# 实施文档：频道化架构统一接口 + 连接中心 UI

> 日期：2026-09-12 ｜ 分支：`feature/channel-architecture` ｜ 性质：**实施计划（本文档不改动运行时代码）**
> 上游调研：[频道架构与飞书体验](../research/2026-09-12-feishu-bot-ux-and-channel-architecture.md)、[频道连接器全景](../research/2026-09-12-channel-connector-catalog.md)
> 本文回答两个问题：① 本地连接接口能否统一、怎么统一（§3）；② 连接中心 UI 怎么布局（§4）。并给出阶段 1 的任务分解与验收标准（§5）。
> 标注约定：**[代码]** = 本仓库代码事实（附 file:line）；**[官方]** / **[社区]** = 外部来源（URL 见 §7）。

---

## 0. 结论速览

1. **接口可以统一，且成本低**。代码摸底显示 `feishu-bot/` 13 个模块中 7 个已经平台无关（chat-queue / dedup-cache / recent-files / command-router / agent-runner / file-receive 落盘部分 / message-handler 的装配骨架），真正的飞书特有代码集中在两个"收口点"：`parseIncomingMessage()`（入站归一化）和 `createReplySession()`（流式出站会话）[代码]。统一 = 把通用件上提到 `channels/runtime/` + 把两个收口点定义成接口，**不是重写**。
2. **业界已验证这套抽象**。WorkBuddy 六渠道（微信助理/微信客服号/企微/QQ/飞书/钉钉）全部是"凭证或扫码 + 长连接优先"的同构接入 [官方]；LangBot 用 YAML manifest 驱动渠道配置表单，30+ 平台共享一套表单引擎 [官方]；NoneBot2/Chatwoot/chatgpt-on-wechat 的教训（接口要小、队列必须每实例私有、渠道不直接碰 Agent）见 §2.2。
3. **UI 采用「连接中心」卡片墙 + schema 驱动表单**。状态采用五态分类法（未配置/已停用/连接中/运行中/错误），启用开关与运行状态正交（AstrBot、OpenClaw 同款）；飞书卡片 = 现有 FeishuSection 的演进，钉钉加入时零新表单代码。
4. **能力位要扩展**。原调研草案的 `supportsStreamingUpdate: boolean` 不够用：企微智能机器人的流式是"respond 命令内嵌 stream.id 刷新"（10 分钟硬窗口），与飞书/钉钉"先发卡片再独立 update"语义不同 [官方]。本方案用 `streamingKind: 'card-stream' | 'respond-stream' | 'edit-message' | 'none'` 区分。
5. **阶段 1 估 6~7 个工作日**（§5 的 M0–M6），全程保持现有 3742 个测试绿线；行为不变的迁移用"只搬文件不改逻辑"的独立提交。
6. **开工前置一个 P0 修复（M0）**：阶段 0 装机实测暴露"飞书只回一句就停"——根因是渲染层 `switchSession` 无差别 abort 共享的 `main` agent 运行（UI 与飞书共用 agent + 状态通道，UI 切换会话即杀飞书侧运行；且 abort 被 pi-agent-core 伪装成正常 turn 结束，半截输出当完整回复发出、DB 误记 success）。修复方案已诊断定案但未实施（abort 来源隔离 / aborted 不伪装 success / 卡片轮间进展提示），其中各条正是 Bridge 层职责、与阶段 1 同构，故排在 M1 之前。

---

## 1. 对两份调研报告的核验结论

### 1.1 与代码事实的交叉核验（全部通过）

| 调研论断 | 核验结果 |
|---|---|
| 阶段 0（占位卡片/CardKit 流式/文件接收/chat-queue）已实施 | ✅ `streaming-card.ts`、`feishu-api.ts`、`chat-queue.ts`、`file-receive.ts`、`recent-files.ts`、`agent-events.ts` 均已存在且被 `feishu-bot-stage0.test.ts`(14) + `feishu-bot-streaming.test.ts`(9) 锚定 [代码] |
| Agent 内核零改动即可订阅流式 | ✅ `agent/agent-events.ts` 就是为此加的进程内镜像；`agent-runner.runAgentStreaming`（L70 起）已示范订阅模式 [代码] |
| 飞书事件回调不阻塞 ack、message_id 去重 | ✅ `event-handler.ts` 同步入队即返回；`dedup-cache.ts` FIFO 500 条 [代码] |
| 全局串行队列已被 per-chat 队列取代 | ✅ 旧 `message-queue.ts` 已删除（git status D），由 `chat-queue.ts` 替代 [代码] |

### 1.2 需要修正 / 补充的点（本文档落实）

1. **接口草案缺口**（原报告 §4.3）：
   - 缺 `streamingKind` 三态区分（企微 respond-stream vs 飞书/钉钉 card-stream vs Telegram edit-message）；
   - 缺回复窗口约束（企微 24h、QQ 群被动回复仅 5 分钟 [官方]）→ `replyWindowMs`；
   - 缺主动推送约束（企微 push 需用户先发过消息 [官方]）→ `pushPolicy`；
   - 缺附件获取抽象（钉钉 downloadCode 两跳、企微 url+aeskey AES 解密 [官方]）→ `fetchAttachment()`。
2. **状态类型重复定义**：`feishu-bot/types.ts` 的 `BotStatusInfo` 与 `shared/types/feishu.ts` 的 `FeishuBotStatusInfo` 是两个近似定义（前者多 pendingCount）[代码]。统一为 `ChannelStatusInfo` 时合并。
3. **WebUI 网关可承载 webhook 渠道，但有三个前置约束** [代码]：`gateway.ts` 的 `admit()` 对所有请求强制 token（平台回调不带 token，需按路径白名单）；默认 bind=loopback 收不到外部回调；自签 HTTPS 过不了平台证书校验。→ 阶段 1 不做本地 webhook 路由，`receivesVia: 'webhook'` 的渠道在 UI 前置声明"需云端中继"，与全景调研 §3.4 一致。
4. **竞品覆盖缺口**：原调研只看了 WorkBuddy 的 Connector 一页。本轮补充了 WorkBuddy 六个渠道文档 + Coze/钉钉 AI 助理/ima + AstrBot/LangBot/Chatwoot/ChatGPT/OpenClaw 的渠道配置 UI（§2），结论直接进入 §3/§4 的设计依据。

---

## 2. 竞品连接方式与 UI 模式（本轮新增调研数据）

### 2.1 国内产品：AI 助手如何接 IM

| 产品 | 渠道接入方式 | 用户要填什么 | UI 形态 | 关键限制 |
|---|---|---|---|---|
| **WorkBuddy 微信助理**（官方推荐） | **扫码绑定，零凭证** | 无（扫二维码） | 集成卡片：「配置」→ 按钮变「绑定中...」→ 二维码嵌卡片下方 → 「已绑定」；可「解绑」 | 一对一绑定；电脑休眠/断网即中断 [官方] |
| **WorkBuddy 微信客服号** | 扫码绑定 | 无 | 同上，**绑定后回显微信头像+昵称**（连接身份可视化） | 一对一 [官方] |
| **WorkBuddy 企业微信** | 智能机器人 API 模式 | Bot ID + Secret（长连接）；或 URL 回调（WorkBuddy 生成 Webhook 回填企微后台） | 配置弹窗内**模式切换** + 凭证输入 + **可选扫码快捷绑定** + 私有化地址框（show_if 条件显隐） | 支持私有化部署自定义 WS 地址 [官方] |
| **WorkBuddy QQ 机器人** | 开放平台建机器人 | AppID + AppSecret（secret 二次查看强制重置） | 三种连接方式并存：QQ 扫码 / WS 长连接 / URL 回调；成功后显示「已连接」 | 文档未提消息窗口 [官方] |
| **WorkBuddy 飞书** | 企业自建应用 | App ID/Secret/**Encrypt Key/Verification Token** 四件套 + 批量导入权限 JSON | 凭证输入 + 连接模式选择 + 「注册」；**长连接→「已连接」，URL 回调→「已注册」+ Webhook 复制按钮** | 应用须发布、首租户可能管理员审核 [官方] |
| **WorkBuddy 钉钉** | 开放平台企业内部应用 | Client ID/Secret + 三权限（`Card.Streaming.Write` 等） | 同飞书：模式选择 + 注册 + 双态（已连接/已注册）；URL 回调须把 http 改 https | 应用须发布审核；群归属组织须一致 [官方] |
| **Coze 扣子** | 平台托管授权 | 飞书：不填凭证，引导授权；公众号：AppID + 管理员扫码；**微信客服是唯一需回调 URL 的渠道**（企业ID+Token+AESKey → 生成 webhook 回填） | 发布页 =「发布记录 + 渠道勾选列表」 | 渠道审核中间态（飞书首租户审核、微信平台审核）；渠道会整体下线（豆包 2026-07 下线）[官方] |
| **钉钉 AI 助理** | 客户端内零代码创建；自定义技能粘贴 ClientID/Secret 接自建应用 | 按模板配置 | 发布范围三档：仅自己（免审批）/组织内（审批）/组织外（**可再分发到微信公众号、小程序、Web**） | 组织外渠道仍需公众号开发配置（AppID/Secret/Token/AESKey）[官方] |
| **腾讯 ima** | 无连接器/IM 接入概念 | — | 应用内对话+知识库；在生态中是"被集成方"（WorkBuddy 有「IMA 知识库」教程） | 不具可比性 [官方] |

**WorkBuddy 的两个体系**（对信息架构最重要）：**连接器（Connector）**= 对接 QQ 邮箱/腾讯文档/乐享/TAPD/网盘/自定义 MCP 的*数据服务*集成；**助理接入（集成 BETA）**= 微信/企微/QQ/飞书/钉钉六条*IM 渠道*，定位"通过手机 IM 远程控制电脑"——与我们飞书 bot 的定位完全一致。两者分开管理，但**共用同一套卡片 UI 语言**（绿点状态 + 启用开关 + 解绑弹窗）[官方]。

**WorkBuddy 远程会话的产品约束**（全渠道统一，值得借鉴）：仅一个会话、所有远程指令集中处理；工作目录固定为"助理专属文件夹"；对话历史不可清空；删文件/改系统配置等危险操作需在 IM 内确认；桌面端可看完整执行记录（思考过程/步骤/产物）[官方]。

### 2.2 开源 / 国际产品：渠道配置 UI 怎么做

| 产品 | 渠道列表结构 | 配置表单 | 状态模型 | 凭证与诊断 |
|---|---|---|---|---|
| **AstrBot**（QQ/微信/飞书/钉钉/TG/Slack…） | WebUI 左列表（图标+实例名+状态点+适配器类型）+ 右编辑面板（**master-detail**）；「+ 添加适配器」 | **2 步对话框**：选平台类型（下拉+图标）→ 填模板表单；飞书有「扫码一键创建」单选项 | **五态**：disabled / running(绿) / error(红) / pending(黄) / unknown(灰)；**启用开关与运行状态是两个正交维度**（源码 PlatformPage.vue L448-463） | 扫码后自动回填 app_id/secret/域名；webhook 模式卡片上直接复制回调 URL |
| **LangBot**（30+ 平台） | **卡片墙**：每卡=图标+名称+描述+适配器标签+绑定流水线标签+**右上角启用 Switch**（即时生效） | **YAML manifest 驱动动态表单**（最完整范例）：多语言 label/description、字段类型/options/default/required、**`show_if` 条件显隐**（长连接↔webhook 切换字段）、`help_links` 文档外链、`login_platform` 扫码登录字段；zod 校验 | 卡片无运行状态（看日志）；**每机器人实例配日志页 + 会话监控** | 「一键创建应用」扫码后凭证自动填入 |
| **Chatwoot**（全渠道客服） | 已接入列表（图标+名称+类型标签+标识符+设置/删除）；添加走 **4 步向导** CHANNEL→INBOX→AGENT→FINISH，左侧步骤导航 | **每渠道手写**（18+ Vue 文件）；渠道选择屏是**卡片网格** {key,title,description,icon}，带禁用/Coming Soon/Beta 徽标 | 列表**无状态列**（webhook 常驻型渠道"永远在线"，重新授权提示收在设置内部）——证明 OAuth 型与常驻型渠道对状态展示需求不同 | OAuth（Facebook/Gmail）是登录按钮；删除需输入名称确认 |
| **ChatGPT Apps/连接器** | 目录发现 → Connect → OAuth；Settings→Apps 管理已连接应用 | 无表单（OAuth 托管） | Connect 按钮态 + 已连接列表 | **每应用"动作权限档位"**：Always ask / Allow read / Allow low-risk / Allow all——权限分级是 OAuth 型渠道卡片的差异化内容 |
| **OpenClaw**（25+ 渠道网关） | **无 GUI**（CLI + `openclaw.json`）——反例数据点：纯配置文件对非技术教师不可接受 | `channels add --channel telegram --token …` | **状态模型最精细**：installed→configured→enabled 三层标签 + running + **probe 探测结果** + degraded 降级 + **dead letters 死信**；每渠道 `channels logs` | OAuth 渠道有 login/logout；WhatsApp 走 QR 配对 |
| **Slack / Copilot Studio** | Marketplace 应用列表（权限 scopes+状态）；Copilot Channels 页列渠道状态，须先发布 agent 才能连渠道 | — | 托管环境渠道状态只读；排障模式="关渠道→保存→重开→重新发布" | — |

### 2.3 ZCode 的第一手观察（本工具环境）

ZCode（本 CLI 智能体）连接飞书的方式是**与 bot 渠道相反的方向**——不是"IM 里的机器人把消息送到 agent"，而是 **"agent 侧的连接器"**：通过 `lark-*` skill 家族（IM/云文档/日历/任务/审批/会议/妙搭…共 20+ 个）驱动 `lark-cli`，以**用户 OAuth 身份**直接操作飞书 OpenAPI；`lark-shared` 统一管 `auth login/status/logout`、user vs bot 身份区分、`--domain` 权限域（im/docs/drive…）、scopes 缺失提示。另有插件市场（marketplace + 版本化缓存）和声明式 SKILL.md manifest（name/description 自动进系统清单）。

对本项目的三点启示：
1. **"频道"（inbound：IM 触达本机 agent）与"连接器"（outbound：agent 主动操作外部服务）是两个正交轴**。本仓库已有雏形：`src/main/services/feishu-bot/`（入站频道）vs `src/main/services/feishu/`（出站集成：alerts 教师推送 / bitable / token）[代码]——与 WorkBuddy 的 Connector/渠道双体系、ZCode 的 skills/频道之分完全同构。连接中心 UI 预留两组分区（§4.1），阶段 1 只填"频道"组。
2. **声明式 manifest 是低摩擦扩展的关键**（LangBot YAML、ZCode SKILL.md 同构）：新增渠道 = 新增一个 manifest + 一个 adapter 文件，UI 与注册表零改动。
3. **权限域 + 状态可查询**（`--domain` scopes、`auth status`）值得抄：渠道卡片上的「测试连接」就相当于 per-channel 的 `auth status` + probe。

### 2.4 提炼出的共性模式（设计输入）

- **P1 卡片 = 渠道类型**（每平台一张卡），不是实例；同一平台多实例是 WorkBuddy 没做、我们也暂缓的差异化点（预留 instanceId）。
- **P2 卡片内容清单**：图标 / 名称 / 状态点+文字 / 启用开关 / 关键绑定信息（App ID 前缀或对方昵称）/ 「配置」入口 / 诊断入口。
- **P3 双模板**：扫码型（零凭证，状态=绑定中→已绑定，回显身份）vs 凭证型（表单+测试连接）。阶段 1 只有凭证型，但状态机按两模板设计。
- **P4 长连接优先、URL 回调为高级选项**：WorkBuddy 四个企业渠道全部"长连接（适合无公网 IP 用户）+ URL 回调（生成 Webhook 复制回填）"双模式；状态区分「已连接」vs「已注册」。
- **P5 状态五态 + 开关正交**：未配置 → 已停用 → 连接中 → 运行中 → 错误（+ 降级子态）；enabled 是设置，running 是运行时。
- **P6 schema 驱动表单 + show_if**：LangBot 已验证，飞书的 domain/长连接模式、企微的私有化地址、邮件的 IMAP/SMTP 分组全是条件显隐场景。
- **P7 诊断内建**：每卡片「测试连接」+ 最近错误 + 指引清单（去平台侧开权限/发布应用的 checklist）——WorkBuddy 每渠道文档都有结构化 FAQ。
- **P8 审批/下线中间态**：渠道卡需能表达"应用待平台审核""此渠道已下线"（Coze 豆包渠道 2026-07 整体下线、旧服务号渠道强制重绑）。
- **P9 渠道只是传输层**：WorkBuddy 六渠道接入后共享同一套远程任务能力与约束；我们的 chat-queue/命令路由/Agent 调度全部上提到 Bridge，新渠道只写适配器。

---

## 3. 细化方向一：统一本地连接接口

### 3.1 现状盘点：哪些通用、哪些飞书特有

| 现模块（`src/main/services/feishu-bot/`） | 通用性 | 迁移动作 |
|---|---|---|
| `chat-queue.ts`（per-chat 串行+合并窗口+排队位置+cancelAll） | **完全通用** | 移入 `channels/runtime/`，不改 |
| `dedup-cache.ts`（FIFO 去重） | **完全通用**（键 = providerMessageId） | 移入 `channels/runtime/`，不改 |
| `recent-files.ts`（每会话最近文件） | **完全通用** | 移入 `channels/runtime/`，不改 |
| `command-router.ts` + `command-context.ts`（/help /score …） | 路由器通用 | 移入 `channels/runtime/`，不改 |
| `agent-runner.ts`（runAgentAndCollect / runAgentStreaming） | 通用（win 参数可选化） | 移入 `channels/bridge/`，不改逻辑 |
| `message-handler.ts`（createBatchPipeline 装配：命令/纯文件/文字三路分发） | **依赖注入骨架通用** | 泛化为 `channels/bridge/pipeline.ts`（Deps 里的 feishu 具体函数改为经 Adapter 接口注入） |
| `event-handler.ts`（回调构造：去重→解析→入队→立即返回） | 骨架通用 | 拆：骨架进 Bridge，飞书事件回调留在 Adapter |
| `message-parsing.ts`（→ `ParsedIncomingMessage`） | 输出形状=通用入站 DTO；解析=飞书特有 | 输出类型提升为 `InboundMessage`；解析逻辑留 Adapter |
| `streaming-card.ts`（→ `ReplySession`） | **接口通用**（update/finalize/fail 幂等三态）；CardKit 实现飞书特有 | 接口提升为 `channels/types.ts` 的 `ReplySession`；实现留 Adapter |
| `feishu-api.ts` / `reply.ts` / `http-instance.ts` / `credentials.ts` | 飞书特有 | 留在 `channels/adapters/feishu/` |
| `file-receive.ts`（sanitizeFileName/落盘/清理） | 落盘清洗通用；下载源特有 | 清洗落盘进 `channels/runtime/attachment-store.ts`；下载经 Adapter 的 `fetchAttachment` |
| `constants.ts` | 混合：通用常量 vs 平台限制 | 拆分：通用进 runtime，平台值进各 Adapter manifest |
| `feishu-bot-service.ts`（生命周期/守护/重启） | 骨架通用（3s 轮询守护、退避、唤醒重连） | 泛化为 `channels/manager.ts` 的连接守护；飞书装配留 Adapter |

**结论**：统一的本质是"上提 7 个通用件 + 定义 2 个收口接口 + 把 service 泛化为 manager"，全部是搬运和薄封装。

### 3.2 目标模块布局

```
src/main/services/channels/
├── types.ts                 # InboundMessage / OutboundContent / ReplySession / ChannelCapabilities / ChannelStatusInfo
├── manifest.ts              # ChannelManifest + ConfigField（configSchema 声明，驱动 UI 表单）
├── manager.ts               # ChannelManager：注册表 / 启停 / 守护重启 / 状态聚合 / IPC 源
├── bridge/
│   ├── pipeline.ts          # 由 message-handler.ts 泛化：命令/纯文件/文字三路分发
│   └── agent-runner.ts      # 由 agent-runner.ts 移入（win 可选）
└── runtime/
    ├── chat-queue.ts        # 由 feishu-bot/chat-queue.ts 移入
    ├── dedup-cache.ts
    ├── recent-files.ts
    ├── attachment-store.ts  # file-receive.ts 的清洗落盘部分
    └── command/             # command-router.ts + command-context.ts

src/main/services/channels/adapters/feishu/
├── index.ts                 # FeishuAdapter implements ChannelAdapter + feishuManifest
├── connection.ts            # WS 生命周期（原 feishu-bot-service 的连接部分）
├── parsing.ts               # 原 message-parsing.ts → InboundMessage
├── reply-session.ts         # 原 streaming-card.ts（CardKit 实现 ReplySession）
├── api.ts                   # 原 feishu-api.ts + reply.ts + http-instance.ts
└── credentials.ts           # 原 credentials.ts（validateCredentials）
```

> 迁移原则：**每个 M 步骤是独立提交，只搬文件/改 import，不混逻辑改动**，保证 3742 个测试在每个提交点都是绿的。

### 3.3 核心接口 v1（完整定义）

```typescript
// ============ channels/types.ts ============

/** 统一入站信封（由各 Adapter 把平台事件归一化成这个形状） */
export interface InboundMessage {
  channel: string                     // 'feishu' | 'dingtalk' | 'wecom' | ...
  providerMessageId: string           // 去重键：飞书 message_id / 钉钉 headers.messageId / 邮件 Message-ID
  providerEventId?: string
  chat: { id: string; type: 'p2p' | 'group' }
  sender: { id: string; name?: string }
  text: string
  attachments: InboundAttachment[]    // 未下载的附件引用，Bridge 按需调 adapter.fetchAttachment
  raw: unknown                        // 平台原始事件（诊断用）
  receivedAt: number
}

export interface InboundAttachment {
  kind: 'file' | 'image'
  fileKey: string                     // 飞书 file_key / 钉钉 downloadCode / TG file_id
  fileName?: string
}

/** 能力位：Bridge 据此自适应输出策略（对应全景调研 §1 对比表各列） */
export type StreamingKind =
  | 'none'            // 邮件、微信公众号、QQ
  | 'card-stream'     // 飞书 CardKit、钉钉 AI 卡片 streamingUpdate（先发卡片再独立 update，传全量文本）
  | 'respond-stream'  // 企微智能机器人（respond 命令内嵌 stream.id 刷新，10 分钟窗口）
  | 'edit-message'    // Telegram editMessageText / Slack chat.update（降频编辑）

export interface ChannelCapabilities {
  receivesVia: 'ws' | 'polling' | 'imap-idle' | 'webhook' | 'relay-ws'
  streamingKind: StreamingKind
  canSendCard: boolean
  maxTextLength: number | null        // 超长由 runtime 统一分段（现状 REPLY_CHAR_LIMIT=4000）
  replyWindowMs: number | null        // 被动回复有效期：企微 24h、QQ 群 5min；null=不限
  streamWindowMs: number | null       // 流式必须完成的硬窗口：企微 10min；null=不限
  pushPolicy: 'free' | 'require-prior-message' | 'quota'   // 主动推送约束（企微需用户先发言）
  receivesFiles: boolean
}

/** 流式出站会话 —— 直接采用现有 streaming-card.ts 的事实抽象（update/finalize/fail 均幂等） */
export interface ReplySession {
  update(fullText: string): Promise<void>     // 全量文本（CardKit/钉钉 streamingUpdate 语义）
  finalize(finalText: string): Promise<void>
  fail(errorText: string): Promise<void>
}

export type ChannelRunStatus =
  | 'not-configed' | 'disabled'      // 派生态：无凭证 / 开关关
  | 'connecting' | 'connected' | 'error'

export interface ChannelStatusInfo {          // 合并现 BotStatusInfo 与 FeishuBotStatusInfo 两个重复定义
  channel: string
  status: ChannelRunStatus
  detail?: string                             // 最近错误/降级原因，如「流式卡片无权限，已降级纯文本」
  degraded?: boolean                          // 阶段 0 已有降级链，UI 需可见
  connectedAt?: number
  processingCount: number
  pendingCount: number
}

/** 出站内容（sendReply/push 用；流式场景用 createReplySession） */
export type OutboundContent =
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; text: string }

export interface PushTarget { chatId: string; senderId?: string }   // push 需渠道自查 pushPolicy 前置条件

// ============ channels/manifest.ts ============

/** 表单字段声明 —— LangBot YAML manifest 的 TS 版（P6） */
export interface ConfigField {
  name: string
  label: string
  description?: string
  type: 'string' | 'secret' | 'select' | 'boolean' | 'number'
  options?: { value: string; label: string }[]
  default?: unknown
  required?: boolean
  pattern?: string                             // 如飞书 appId '^cli_[0-9a-fA-F]{16}$'
  showIf?: { field: string; equals: unknown }  // 条件显隐（企微私有化地址等）
  helpLink?: string                            // 指引外链（对应 FeishuGuidePanel）
}

export interface ChannelManifest {
  id: string
  label: string
  description: string
  icon: string                                 // 渲染层图标标识
  capabilities: ChannelCapabilities
  configSchema: ConfigField[]                  // → 连接中心表单自动渲染
  setupGuide?: { title: string; steps: string[] }   // 平台侧操作清单（开权限/发布应用）→ GuidePanel
  beta?: boolean
}

// ============ channels/types.ts（Adapter 与运行时契约） ============

export interface ChannelRuntimeContext {
  config: Record<string, unknown>              // manifest 声明的非 secret 字段已解析
  getSecret(name: string): Promise<string | null>   // keystore 读取，Adapter 不接触 settings
  bridge: {
    onMessage(msg: InboundMessage): void       // 归一化后上交（Manager 先过全局去重再进来）
    onStatus(s: ChannelStatusInfo): void       // → IPC fanout（renderer + WebUI）
  }
  filesDir: string                             // userData/channels/<id>/files
}

export interface ChannelAdapter {
  readonly id: string
  readonly manifest: ChannelManifest
  /** 凭证/格式预检（对应 feishu validateCredentials；不建连接、不发消息） */
  validateConfig(ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>): Promise<{ ok: true } | { ok: false; message: string; field?: string }>
  connect(ctx: ChannelRuntimeContext): Promise<void>
  disconnect(opts?: { userInitiated?: boolean }): Promise<void>   // 与 connect 对称：排空、清理监听（LangBot 泄漏教训）
  getStatus(): Omit<ChannelStatusInfo, 'processingCount' | 'pendingCount'>
  sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }>
  push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }>
  /** streamingKind !== 'none' 时必须实现；Bridge 只依赖 ReplySession 接口 */
  createReplySession?(msg: InboundMessage, placeholderText: string): Promise<ReplySession>
  /** receivesFiles 时必须实现：下载并返回本地路径（钉钉两跳 / 企微 AES 解密差异封装在此） */
  fetchAttachment?(msg: InboundMessage, att: InboundAttachment): Promise<{ ok: true; path: string; bytes: number } | { ok: false; error: string }>
}

// ============ channels/manager.ts ============

export interface ChannelManagerHooks {
  resolveAgent(channel: string, chatId: string): { agentId: string }   // 渠道→Agent 绑定（默认 'main'）
}

export class ChannelManager extends EventEmitter {
  register(factory: () => ChannelAdapter): void            // 静态注册表起步（无动态加载）
  start(channel: string): Promise<void>                    // 读 settings+keystore → 组装 ctx → adapter.connect → 守护
  stop(channel: string, opts?: { userInitiated?: boolean }): Promise<void>
  list(): ChannelStatusInfo[]                              // channels:list IPC 源
  test(channel: string): Promise<{ ok: boolean; message: string }>   // = validateConfig + 轻量探活
}
```

**Bridge（`bridge/pipeline.ts`）职责**——由现 `createBatchPipeline` 泛化，所有渠道共享：per-chat 队列与 2s 合并窗口、占位卡片（排队位置）、命令批直通、纯文件批落盘确认、文字批组 prompt（含 recent-files 上下文）→ `runAgentStreaming` → `session.update/finalize`、错误 `session.fail`、onDrop 收尾。**渠道绝不直接碰 Agent**（chatgpt-on-wechat 的 Bridge 强制分层；其类级队列导致"飞书 context 被 Web 渠道消费"的串台事故，是队列必须实例私有的直接证据 [社区]）。

### 3.4 关键设计决策

| # | 决策 | 依据 |
|---|---|---|
| D1 | **每渠道类型单实例起步**（`channels.feishu` 是对象不是数组），instanceId 在类型里预留 | WorkBuddy 全渠道一对一绑定已够用 [官方]；多实例引入配置/UI/状态复杂度，等真实需求（工作微信+家长群）再开 |
| D2 | **流出站抽象 = ReplySession 三态**（不是 send+edit 两个方法） | `streaming-card.ts:26-33` 已是事实抽象且被 9 个流式测试锚定 [代码]；钉钉 streamingUpdate 同为"全量文本+节流"语义（全景调研 §3.1），企微 respond-stream 只是 update 的另一种传输 |
| D3 | **enabled（设置）与 status（运行）正交**；现状"有凭证即连接"改为显式开关 | AstrBot 五态源码、OpenClaw installed/configured/enabled/running 分层 [官方]；也是 P5 |
| D4 | **队列/去重/recent-files/命令路由上提 runtime，Agent 调度上提 Bridge** | 7 个模块已平台无关 [代码]；CoW 串台事故 [社区]；WorkBuddy"渠道只是传输层" |
| D5 | **凭据范式沿用**：settings 存非敏感字段 + keystore 存 secret（key 不变 `'feishu-app-secret'`）+ `'__keystore__'` 占位回显 + 保存即重连 | 现 `settings-handlers.ts` 已验证的链路 [代码]，等价 Chatwoot 的凭据静态加密 |
| D6 | **guard 守护（3s 轮询、指数退避、唤醒重连、MAX_GUARD_ATTEMPTS=8）泛化进 Manager**，重连/watchdog 自己持有 | SDK 长连接不可全信（oapi-sdk-go#195 / python#126）[社区]；现守护逻辑已有测试锚定 [代码] |
| D7 | **阶段 1 不做本地 webhook 网关路由**；`receivesVia:'webhook'` 渠道在 UI 前置声明"需云端中继" | gateway admit() 强制 token / loopback bind / 自签证书三约束 [代码]；全景调研 §3.4 中继方案随 P3 立项 |
| D8 | **IPC 面 `channels:*` 统一注册进 invokeHandlers**，WebUI 经 `invokeRegisteredHandler` 免费复用 | 现 gateway 对 feishu:* 已是此模式 [代码 handle.ts:32-40]；手机端连接中心零额外开发 |
| D9 | **`maxTextLength` 截断/分段收口在 runtime**，Adapter 只报数值 | 现状 4000 截断在 reply.ts（飞书特有位置）[代码]；邮件/钉钉上限不同 |
| D10 | **流式硬窗口保护**：`streamWindowMs`（企微 10min）到时 Bridge 强制 finalize(已完成部分) + 补发"继续"说明 | 企微官方约束 [官方]；Agent 长任务（数分钟）+ 流式窗口是真实冲突 |

### 3.5 设置模型与迁移

```typescript
// shared/types/settings.ts 新增（DEFAULT_SETTINGS 同步声明——settingsService.update 要求路径先存在）
interface UnifiedSettings {
  channels: {
    feishu: {
      enabled: boolean          // 新增：显式开关（迁移时 = 旧"有凭证"推导值）
      agentId?: string          // 渠道绑定的 Agent（默认 'main'；缓解多渠道抢 main 队列）
      allowGroups: boolean      // 群聊响应（现群聊需 @ 的行为做成开关）
      domain: 'feishu' | 'lark'
      appId: string
      // appSecret 继续走 keystore，不进 settings.json
    }
    // dingtalk / wecom / mail …：每个新渠道 = manifest 声明字段平铺至此
  }
  feishu: {                     // 保留：出站集成（教师推送/bitable/订阅）不动，属"连接器"轴
    userOpenId: string
    bitableAppToken: string
    bitableTableId: string
    bitableSync: { enabled: boolean; syncInterval: number }
    agentPushEnabled: boolean
  }
}
```

迁移规则（`settings-service` 启动时一次性，写回前备份 `settings.json`）：
- `feishu.domain/appId` → `channels.feishu.domain/appId`；`channels.feishu.enabled = appId 非空`；
- keystore key 不变；`src/main/services/feishu/token.ts` 等出站集成的取凭证路径改为读 `channels.feishu`（兼容读取旧路径一版）；
- 旧 `feishu.appId/domain` 保留一个版本期（兼容读取，不双写），下版本删除；
- 工厂重置（factory-reset）同步清理 `channels.*`。

### 3.6 IPC 契约（`shared/ipc-channels.ts` + `main/ipc/channel-handlers.ts`）

| 通道 | 行为 | 对应现状 |
|---|---|---|
| `channels:list` | `ChannelStatusInfo[]` + manifest 摘要（渲染卡片墙） | feishu:bot-status 的泛化 |
| `channels:save-config` | 存 settings + keystore secret（占位符协议），secret 变更触发重连 | settings-handlers 的 feishu 分支泛化 |
| `channels:start` / `channels:stop` | 显式启停（userInitiated） | feishu:bot-start/stop |
| `channels:test` | validateConfig + 轻量探活（不建长连接） | feishu:test |
| `channels:diagnose` | 渠道诊断（复用现 feishu diagnose 思路） | feishu:diagnose |
| 事件 `IPC_CHANNELS_STATUS_UPDATE` | 状态变化 fanout → renderer + WebUI（现 `feishuBotService.on('status')` → IPC 模式平移） | IPC_FEISHU_BOT_STATUS_UPDATE |

旧 `feishu:bot-*` IPC 保留一版转发到 channels:*（渲染层与 WebUI 兼容），下版本移除。

### 3.7 测试策略

1. **存量测试是行为锚**：`feishu-bot-guard / -service / -stage0 / -streaming / -outbound / -cached-token-isolation` 六个文件随迁移只改 import 路径，断言不动；
2. **新增 Adapter 契约测试**（`tests/main/channels/adapter-contract.test.ts`）：用 FakeAdapter 驱动 Manager 生命周期（connect→onMessage→createReplySession→finalize / stop 排空 / 重连守护 / 状态 fanout），钉钉接入时同一套契约直接复用；
3. **设置迁移测试**：旧 settings.json → 新结构 + keystore 兼容 + 备份存在；
4. **降级链测试**：streamingKind='none'（FakeAdapter）时 Bridge 走 sendReply 一次性回复、企微型 streamWindow 超时强制 finalize。

### 3.8 风险清单

| 风险 | 缓解 |
|---|---|
| 多渠道并发抢 `'main'` 的 AgentRunQueue（深度 8，满则拒绝）[代码] | `channels.*.agentId` 绑定 + Bridge 排队位反馈（已实现）+ 文档建议不同渠道绑不同 Agent |
| 企微 10 分钟流式窗口 vs Agent 数分钟长任务 | D10 强制 finalize + 补发续卡说明；契约测试覆盖 |
| 文件搬迁导致行为漂移 | 每 M 步独立提交、只搬不改；全量测试为每个提交的门槛 |
| 设置迁移丢配置 | 迁移前备份 + 兼容读取 + 迁移专项测试 |
| WebUI 暴露渠道启停面 | 与 settings.set 同风险面（token 鉴权后本就可改设置）；`channels:save-config` 不回显 secret（占位符协议），文档注明 |
| 钉钉服务端 ~30s 主动断连（负载均衡）[社区] | Manager 守护重连（D6）+ 契约测试模拟断连 |

---

## 4. 细化方向二：连接中心 UI

### 4.1 信息架构

- 位置：设置页 sections 列表中，`FeishuSection` 演进为 **`ChannelsSection`（连接中心）**，排在 General 之后（高频入口靠前）。`src/renderer/pages/Settings/sections/index.ts` 替换一项，SettingsPage 零改动。
- 分组（WorkBuddy 双体系 + ZCode 双轴，P1）：**「消息频道」**（阶段 1：飞书；占位卡：钉钉·即将支持）与**「数据源集成」**（阶段 3+：现 Feishu 的 bitable/推送设置迁入，卡片化）。
- 渲染层新增目录 `pages/Settings/channels/`：

```
ChannelsSection.tsx            # 分区容器：标题 + 说明 + 卡片网格
ChannelCard.tsx                # 单渠道卡片（P2 内容清单）
ChannelConfigPanel.tsx         # 展开态：schema 表单 + 测试连接 + 指引 + 诊断
SchemaForm.tsx                 # ConfigField[] → 现有行组件的渲染器（含 showIf）
ChannelStatusDot.tsx           # 五态状态点（合并 FeishuStatusBadge 逻辑）
```

### 4.2 状态分类法（P5，映射到现有组件）

| 态 | 视觉 | 数据来源 | 现有对应 |
|---|---|---|---|
| 未配置 not-configed | 灰点「未配置」 | settings 无必填字段 | FeishuStatusBadge 的 isConfigured=false |
| 已停用 disabled | 灰点「已停用」+ 开关 off | `channels.feishu.enabled=false` | 无（新增，D3） |
| 连接中 connecting | 黄点呼吸「连接中…」 | status 事件 | BotStatus 'connecting' |
| 运行中 connected | 绿点「运行中」+ 处理数 | status 事件 + processing/pending | BotStatus 'connected' |
| 错误 error | 红点「错误」+ detail + 「诊断」 | status 事件 | BotStatus 'error' |
| 降级（子态） | 绿点+「流式已降级」角标 | `degraded=true`（阶段 0 降级链） | 无（新增，占位卡片权限缺失时） |

### 4.3 布局线框

**卡片墙（默认态）：**

```
┌ 设置 ─────────────────────────────────────────────────────────┐
│ ▼ 连接中心                                                      │
│   让手机/平板上的聊天软件直接指挥这台电脑上的 AI 助教。                  │
│                                                                │
│   消息频道                                                      │
│   ┌──────────────────────┐   ┌──────────────────────┐          │
│   │ [飞书]  飞书机器人   ●运行中│   │ [钉钉]  钉钉机器人  ○未配置 │
│   │ cli_a1b2…c3 · 单聊/群聊   │   │                        │         │
│   │ 正在处理 1 · 排队 0  [开关●]│   │ 即将支持           [开关○]│     │
│   │ [配置 ▾]        [诊断]    │   │                       │         │
│   └──────────────────────┘   └──────────────────────┘          │
│                                                                │
│   数据源集成（即将改版）                                            │
│   ┌──────────────────────┐                                      │
│   │ [表格] 飞书多维表格同步  ●已连接│  …（bitable/推送，阶段 3 迁入）      │
│   └──────────────────────┘                                      │
└────────────────────────────────────────────────────────────────┘
```

- 网格 `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3`（Tailwind v4，与现有 Section 卡片风格一致：`CARD_BASE`）。
- 「即将支持」占位卡带 `beta` 徽标（Chatwoot Coming Soon 模式），不可点配置但可看渠道说明——给用户路线预期，也为钉钉上线留 UI 位。

**展开态（点「配置 ▾」，卡片下方内联展开，非全屏向导）：**

```
│ ▼ [飞书] 飞书机器人 配置                                          │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ ① 渠道开关   [● 启用]（enabled，独立于保存）                  │   │
│ │ ② 接入指引   ▸ 飞书开放平台操作清单（建应用/开权限/发布，        │   │
│ │              含 cardkit:card:write、im:resource 两权限提示）     │   │
│ │ ③ 表单（manifest.configSchema 自动渲染）                       │   │
│ │    域名        [飞书(feishu) ▾]                               │   │
│ │    App ID     [cli_xxxxxxxx          ]  格式错则红框            │   │
│ │    App Secret [••••••••••  已加密保存]  （SecretInput+keystore） │   │
│ │    群聊响应     [● 允许（需@机器人）]                           │   │
│ │    绑定 Agent  [main ▾]（缓解多渠道抢占说明）                    │   │
│ │ ④ [测试连接]  ✅ 凭证有效（tenant_token 正常）                  │   │
│ │ ⑤ 网络诊断 ▸（现 FeishuNetworkDiagnostics 平移）                │   │
│ │ ⑥ 最近事件 ▸（最近 5 条状态变化/错误，OpenClaw logs 的轻量版）     │   │
│ └──────────────────────────────────────────────────────────┘   │
```

选择**内联展开而非向导**的依据：AstrBot master-detail（"列表+右表单，不打断上下文"）被验证最适合设置页（P-C）；Chatwoot 的 4 步全屏向导留给步骤间差异巨大的渠道（邮件 IMAP/SMTP 多阶段），而我们的渠道都是"2~4 个字段 + 平台侧清单"，内联足够。未来邮件渠道字段多时，`SchemaForm` 支持分组渲染即可，仍不需要向导。

### 4.4 SchemaForm：字段类型 → 现有组件映射

| ConfigField.type | 渲染组件（现成） | 备注 |
|---|---|---|
| `string` | `SettingRow` + `input`（`INPUT_SM`，pattern 校验红框 `INPUT_INVALID`） | 照 FeishuSection App ID 行 |
| `secret` | `SettingRow` + `SecretInput` | `'__keystore__'` 占位协议；清空=删除 keystore |
| `select` | `SelectSettingRow` | domain/agentId |
| `boolean` | `ToggleSettingRow` / `ToggleSwitch` | allowGroups/enabled |
| `number` | `NumberSettingRow` | 节流间隔等 |
| `showIf` | 条件渲染（zustand/局部 state 读表单值） | 企微私有化地址、（未来）长连接↔webhook 切换 |

飞书 `setupGuide` 的 steps 渲染为 `FeishuGuidePanel` 的数据化版本（`GuidePanel`），钉钉上线时给它的 manifest 填 steps 即得到同款指引，**新渠道 UI 零新增组件**（LangBot manifest 模式的价值）。

### 4.5 交互流程与状态机

**首次连接**：填表（或粘贴凭证）→ 自动 `channels:test`（不建连接）→ 显示 ✅/❌ 与字段定位 → 保存 → 开关自动置 on → `channels:start` → 状态点黄→绿；失败红点 + detail + 「诊断」。
**凭据变更**：保存即重连（沿用现 `reconnectFeishuBot` 语义，`userStopped` 不被内部 stop 污染——已有测试锚定）。
**停止/解绑**：开关 off = 优雅 stop（排空队列、未完成占位卡收尾——阶段 0 已实现）；「清除配置」= 删 settings 字段 + keystore secret，需确认弹窗（Chatwoot 删除需输入名称确认的轻量版：二次确认即可）。
**审批/下线中间态**（P8）：status.detail 承载「应用待平台审核」「渠道已下线」文案；manifest 有 `beta` 徽标位。

### 4.6 WebUI / 移动端

`channels:*` 经 `invokeRegisteredHandler` 自动对 WebUI 开放 [代码]——手机浏览器打开 WebUI 即可看到连接中心（同一 React 页面），无需额外开发；secret 永不回显（占位符协议）。

### 4.7 i18n

沿用 `useT`：`settings.channels.title/desc`、`settings.channels.feishu.*`（由 manifest label 兜底默认文案）、状态文案 `settings.channels.status.{notConfigured,disabled,connecting,connected,error,degraded}`。

---

## 5. 阶段 1 任务分解（每步独立提交，全量测试为门槛）

| # | 任务 | 主要改动 | 验收标准 |
|---|---|---|---|
| **M0** 飞书 P0 修复：abort 误杀（~1d，已诊断未实施） | ① **abort 来源隔离**：`runAgent` 增加 `source: 'ui' \| 'feishu' \| 'cron'`，`runningAgents` 记来源；`switchSession`（sessions-slice.ts）只 abort ui 发起的流；② **aborted 不伪装 success**：execution.ts 成功路径检查 aborted，飞书侧收到"任务被中止"提示而非半截话（`session.fail` 收尾）；③ **卡片轮间进展**：Bridge 消费 `AgentStatusPayload.toolCall` 事件，轮间长静默时占位卡显示"正在执行第 N 步…" | sessions-slice.ts 与 execution.ts 两处入手（诊断结论）；③在 message-handler/agent-runner 侧，不碰 Agent 内核 | 飞书触发的运行不受 UI 切换会话影响（复测原故障场景）；中止时 DB `agent_executions.status` 不再记 success；②③属于 Bridge 通用能力，后续所有渠道直接受益 |
| **M1** 类型与 manifest 落地（纯新增，~0.5d） | `channels/types.ts`、`channels/manifest.ts`、feishu manifest 初稿 | 新文件，无现有文件改动 | 类型编译通过；manifest 单测（configSchema 合法性） |
| **M2** runtime 上提（~1d） | `chat-queue/dedup-cache/recent-files/command-router/command-context` 移入 `channels/runtime/`；`file-receive` 拆出 `attachment-store.ts`；feishu-bot 内改为 re-export 或改 import | 只搬不改 | 六个存量测试文件仅改 import 后全绿；`npm test` 全量 3742+ |
| **M3** Bridge + Adapter 收口（~1.5d） | `bridge/pipeline.ts`（message-handler 泛化）+ `bridge/agent-runner.ts`；`adapters/feishu/*` 组装；`feishu-bot-service` 连接部分并入 `connection.ts` | 行为不变重构；feishu-bot-service 退化为兼容壳 | stage0/streaming 测试原断言全绿；手工冒烟：真机收发+流式+文件（用户装机流程） |
| **M4** ChannelManager + IPC + 设置迁移（~1d） | `manager.ts`（注册/启停/守护/状态聚合）；`channel-handlers.ts` + ipc-channels + preload `api.channels`；settings `channels.feishu.*` + 迁移函数 + keystore 兼容；factory-reset 更新 | 旧 `feishu:bot-*` 转发保留一版 | 契约测试（FakeAdapter 全生命周期）；迁移测试（旧 settings.json → 新结构+备份）；`channels:list` 经 WebUI gateway 可调 |
| **M5** 连接中心 UI（~1.5d） | `ChannelsSection/ChannelCard/ChannelConfigPanel/SchemaForm/ChannelStatusDot`；替换 sections/index 的 Feishu 项；状态订阅 `IPC_CHANNELS_STATUS_UPDATE` | 渲染层新增，Feishu 相关组件吸收进 Panel | 卡片墙五态可视；schema 表单含 secret 占位/测试连接/指引/诊断；手动切换开关→启停联动；WebUI 手机端可用 |
| **M6** 文档与回归（~0.5d） | ARCHITECTURE.md 增 channels 分层图；docs/CONFIGURATION.md 更新设置键；删除兼容壳（若稳） | 文档 + 清理 | 全量测试；`npm run build` 通过 |

**回滚策略**：M0 独立成 1-2 个提交，可单独 revert；M1/M2 随时可弃（纯新增/纯搬移）；M3/M4 各自独立提交，出问题 revert 单个提交即可回到可运行状态；设置迁移有备份 + 兼容读取双保险。

**阶段 2 衔接**（钉钉 P0，另立计划）：按全景调研 §3.1——`DingtalkAdapter` 新增 `adapters/dingtalk/`（Stream 客户端 + 自动重连 + AI 卡片 `streamingUpdate` 复用 ReplySession + downloadCode 两跳下载），`channels.dingtalk` 设置段由 manifest 生成 UI，契约测试套件复用；验收 = 群 @ 问答 + 打字机流式 + 文件问答。

---

## 6. 与产品目标的呼应（用户关切）

- **"与本地软件部署结合得越好越好"**：长连接模式（飞书 WS / 钉钉 Stream / 企微智能机器人 WS）让桌面端**免公网 IP、免域名、免备案**即可双向通信——WorkBuddy 对四个企业渠道的宣传语即"适用于个人/家庭/办公室用户（没有公网 IP）"[官方]，这正是本产品作为本地桌面应用的护城河；开机自启（`app-lifecycle` 已有 [代码]）+ 托盘常驻 + 唤醒重连构成"教师电脑即服务器"的形态。
- **"统一接口"**：§3.3 一套接口 + manifest，新渠道边际成本 = 一个 adapter 目录 + 一份 manifest（UI/队列/Agent 调度/诊断全部复用）。
- **体验下限**：占位秒回/排队位置/流式打字机/降级链已由阶段 0 建立并测试锚定，任何新渠道通过 `streamingKind` 自动获得对应体验档位。

---

## 7. 本轮新增来源汇总

**WorkBuddy [官方]**（docs.workbuddy.cn）：
- 功能总览·Assistant（远程会话约束）: https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Assistant
- Connector（连接器卡片 UI）: https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector
- 渠道接入：WeixinBot-Guide / Wechat-Guide / Wecom-Guide / QQ-Guide / Feishu-Guide / Dingtalk-Guide（同域名 `/docs/workbuddy/` 下六篇）

**Coze 扣子 [官方]**（docs.coze.cn）：guides_quickstart（发布流）、guides_publish_to_feishu、tutorial_0_code_wechat_customer_service、guides_wechat_service_account、guides_wecom、recent-updates（豆包渠道下线）

**钉钉 [官方]**：open.dingtalk.com/document/ai-dev/create-a-dingtalk-ai-assistant（AI 助理三档发布）、orgapp 企业内部应用机器人文档

**腾讯 ima [官方]**：ima.qq.com（无连接器概念）

**AstrBot [官方]**：github.com/AstrBotDevs/AstrBot/wiki/zh-platform-lark、docs.astrbot.app/platform/start.html、前端源码 dashboard/src/views/PlatformPage.vue（状态五态 L448-463）、components/platform/AddNewPlatform.vue

**LangBot [官方]**：docs.langbot.app/zh/usage/platforms/lark、src/langbot/pkg/platform/sources/lark.yaml、web/src/app/home/bots/components/bot-card/BotCard.tsx 与 dynamic-form/DynamicFormItemConfig.ts

**Chatwoot [官方]**：chatwoot.com/hc/user-guide/articles/1677492191-adding-inboxes、前端 app/javascript/dashboard/routes/dashboard/settings/inbox/（InboxChannels/ChannelList/ChannelItem/Index.vue）

**ChatGPT Apps [官方]**：help.openai.com/en/articles/11487775-connectors-in-chatgpt

**OpenClaw [官方]**：docs.openclaw.ai/channels、docs.openclaw.ai/cli/channels

**Slack / Copilot Studio [官方]**：slack.com/help/articles/115003461503、1500009181142；learn.microsoft.com/en-us/microsoft-copilot-studio/publication-fundamentals-publish-channels

**平台事实**（钉钉 Stream/企微智能机器人/QQ/Telegram 等连接方式与频控）：见全景调研 `docs/research/2026-09-12-channel-connector-catalog.md` §1–§2（含全部官方 URL）。

**本仓库代码事实**：见 §1.1/§3.1 各 file:line 标注（2026-09-12 于 `feature/channel-architecture` 分支核验）。

---

## 8. 实施记录与偏差（2026-09-12，M0–M6 全部完成）

阶段 1 已在 `feature/channel-architecture` 分支全部落地，每个里程碑独立通过
全量回归 + `npm run build`（3748 → **3775 测试全绿**）。与本文的偏差记录如下：

| # | 偏差 | 原因与结论 |
|---|---|---|
| 1 | `AgentRunSource = 'ui' \| 'channel' \| 'cron'`，而非 M0 草案的 `'feishu'` | 渠道无关命名，钉钉接入零改动即获得同款隔离（abort 守卫 / 渲染层过滤 / `aborted` 落库三件套） |
| 2 | 运行态五态拼写 `'not-configured'`（kebab），i18n 键为 `settings.channels.status.notConfigured` | wire 契约与 UI 键名解耦，与 `ChannelRunStatus` 其余状态（`connecting` 等）保持一致风格 |
| 3 | 未新增 `channels:save-config` IPC，配置保存复用 `settings:set`（dotPath + 枚举校验 + `__keystore__` 占位符协议） | 少一条 IPC 面 = 少一分契约维护；`handleIpc` 注册使 WebUI 网关免费复用 channels:list/start/stop/test |
| 4 | `adapters/feishu/connection.ts` 承载原 FeishuBotService 引擎（未把服务内部再拆薄层）；`feishu-bot-service.ts` 与 `feishu-bot/*` 退化为 re-export 兼容壳并保留 | M3 验收本就允许"行为不变重构"；壳零成本，遗留 `feishu:bot-*` IPC 与部分测试 import 仍指向旧路径 |
| 5 | M6 的"删除兼容壳（若稳）"本轮**未执行**，明确推迟到阶段 2 | 壳仍被 `index.ts`/`close-behavior`/`feishu-handlers`/`settings-handlers`/`factory-reset` 及 6+ 测试文件引用；删除是纯机械改动但有回归面，钉钉落地时随 `feishu:bot-*` 旧 IPC 一并退役更稳 |
| 6 | factory-reset 经现有 `feishuBotService.reset()`（壳转发到引擎）覆盖渠道清理，未在 factory-reset 内直连 ChannelManager | 保持单一清理入口，避免两套清理路径漂移 |
| 7 | UI i18n 键族为 `settings.channels.*`（intro/status.*/form.*/testConnection 等 24 键，zh/en 双语），非 §4.7 草案的 `settings.channels.title/desc` 命名 | 实际组件拆分为卡片墙/表单/测试连接三块，键名随之细化；死键守卫同步清退了 9 个被裁剪的旧 feishu 键 |
| 8 | M3/M5 的"手工冒烟（真机收发/流式/文件、WebUI 手机端）"本轮跳过 | 遵守用户硬约束「不破坏已安装软件与现有数据」——不跑安装器、不动真实 userData；冒烟并入下一次正常发版流程 |

**新增测试锚点**：`agent-source-isolation`（M0）、`channels/manifest`（M1）、
`channels/{feishu-adapter,settings-migration,manager-contract}`（M3/M4）、
`settings/channels-ui` + settings-page 重定向（M5）。

**遗留（阶段 2 待办）**：钉钉 DingtalkAdapter（manifest 已就位，`comingSoon` 占位）；
feishu:bot-* 旧 IPC 与兼容壳退役；数据源集成（bitable/推送）并入连接中心。
