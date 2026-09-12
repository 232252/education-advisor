# 调研报告：飞书机器人对话体验修复 + 频道（连接器）模块化

> 日期：2026-09-12 ｜ 性质：**只调研，不实施**（本轮明确不动代码）
> 背景：用户反馈飞书机器人（1）发消息后没有立刻的回应感，回复是"憋很久后一次性蹦出来"，不像正常 AI 机器人的"秒回 + 内容逐渐变长"；（2）看不到排队状态，连发两条消息时不确定机器人是否死了；（3）远期要把飞书模块重构成 WorkBuddy 那种"连接器/频道"体系，飞书只是其中一个频道。
>
> 外部调研来源标注：**[官方]** = open.feishu.cn 官方文档；**[社区]** = GitHub 源码/Issue/博客，未获官方确认。

---

## 一、现状：飞书模块的工作原理（代码摸底）

### 1.1 消息链路（当前实现）

```
飞书服务器 ──WebSocket 长连接──> @larksuiteoapi/node-sdk WSClient
   │  事件 im.message.receive_v1
   ▼
event-handler.ts   同步去重(message_id, 500 条缓存) + 深度检查(16) + 入队，立即返回让 SDK ack
   ▼
SerialMessageQueue  ★ 全局单条 Promise 链：所有会话的所有消息严格串行
   ▼
message-handler.ts  解析(仅 text；群聊需 @) → 命令路由(/help /score …) 或 runAgent
   ▼
agent-runner.ts     await agentService.runAgent('main', …)  ← ★ 阻塞到整个 Agent 跑完(可达数分钟)
   ▼
reply.ts            im.message.reply(msg_type:'text')  ← ★ 一次性回一条纯文本，>4000 字截断
```

关键文件：

| 环节 | 位置 |
|---|---|
| WS 连接与生命周期/守护重启 | `src/main/services/feishu-bot-service.ts:107-238`（start）、`:308-360`（3s 轮询守护，5s→60s 指数退避重启） |
| 事件回调（去重/限流/入队） | `src/main/services/feishu-bot/event-handler.ts:32-61` |
| 串行队列 | `src/main/services/feishu-bot/message-queue.ts:17-52` |
| 消息解析与分发 | `src/main/services/feishu-bot/message-parsing.ts:20-40`、`message-handler.ts:31-63` |
| Agent 调用（阻塞式） | `src/main/services/feishu-bot/agent-runner.ts:18-47` |
| 回复发送（纯文本一次性） | `src/main/services/feishu-bot/reply.ts:12-42` |
| 常量（4000 字 / 16 条 / 500 去重） | `src/main/services/feishu-bot/constants.ts` |

**已经做对的部分**（对照飞书官方要求，见 §2.3）：
- 事件回调立即返回、不阻塞 ack（H3 修复），满足官方"3 秒内返回"要求；
- 用 `message_id` 而非 `event_id` 去重，与官方文档要求一致；
- WS 断连有守护重启 + 系统唤醒重连。

### 1.2 用户体感问题对应的根因

| 用户体感 | 根因 |
|---|---|
| "应该立马回我个消息，内容逐渐拉长" | 现在是**跑完整个 Agent 才回一条纯文本**。没有占位消息（"正在思考…"）、飞书也没有任何"正在输入"API（见 §2.1），业界唯一解法是**秒发占位卡片 → 卡片流式更新**。 |
| "不要让人等，太着急了" | Agent 一轮可能跑几分钟（多轮工具调用 + 智能续跑 `runContinuationLoop`），期间用户侧完全静默，无任何进度信号。 |
| "好像没有排队" | 排队确实存在（16 条深度），但**用户完全感知不到**：没有"排队中，前面还有 N 条"的反馈；满了直接回"繁忙"并**丢弃**。 |
| "发两条消息他是不是死了" | 全局串行队列 + 每 Agent 深度 8 的 `AgentRunQueue`：第二条消息要等第一条完整跑完才开始处理；若与桌面聊天/cron 抢占 'main' agent 队列满 8，直接回错误文本。且被丢弃的消息 id 已先进去重缓存，飞书重投也会被跳过——**真丢了**。 |

### 1.3 现状代码的其它隐患（摸底时发现，修复时一并考虑）

1. **全局串行 = 全体会话队头阻塞**：不同用户/不同群的消息互相排队，一个长任务让所有人等待。业界做法是 per-chat 串行（§2.4）。
2. **stop() 期间排队消息的回复静默丢失**：`stop()` 置空 `sdkClient` 后，队列里在跑的任务调 `sendReply` 只打日志 "sdkClient missing"，没有队列排空/终止机制。
3. **回复失败不重试**：ack 已发、id 已去重，`sendReply` 失败（限流/网络）后这条回复就没了。
4. **纯文本 4000 字截断**：长输出没有分段多消息策略，也没有卡片排版（markdown 都没有）。

### 1.4 重要的内部利好：流式管道已经存在

Agent 运行时**已经有完整的 token 流**：`event-collector.ts` 把 `text_delta` 按 33ms 窗口攒批，经 `sendAgentStatus(win, agentId, 'running', { output: 增量 })` 推给渲染窗口（`src/main/services/agent/event-collector.ts:101-141`、`execution.ts:501-512`）。

**结论：飞书侧做"内容逐渐拉长"不需要改 Agent 内核，只需要**——
- 把 `sendAgentStatus` 从"绑定 BrowserWindow 的 webContents.send"解耦成可订阅的事件流（如 `agentService.onOutputChunk(executionId, cb)`），飞书频道订阅它；
- 飞书侧把累计文本写入可流式更新的消息载体（CardKit 卡片，见 §2.2）。

### 1.5 新发现（2026-09-12 实测）：文件/图片消息被静默丢弃

用户在手机上给机器人发 Excel 文件（`2024级单招、普招统计表（已分）.xlsx`），机器人完全看不到文件：只回了随附文字"这条消息里我只看到文字…没有收到图片、文件或路径"，甚至自己去桌面乱找同名文件（错误级联）。

根因（代码已确认）：
- `src/main/services/feishu-bot/message-parsing.ts:24-25`：
  ```ts
  // 只处理文本消息(其它类型如图片/文件暂不支持)
  if (msg.message_type !== 'text') return null
  ```
- `message-handler.ts:37` 对 `null` 直接 `return`——文件（`file`）、图片（`image`）、富文本（`post`）、语音等消息事件**收到后被无声丢弃**，不回复、不记日志、用户不知道发了等于白发。

修复方案（并入阶段 0）：
1. 解析层接受 `file`/`image`（`post` 富文本可先提取其中文本段）：文件消息 content 为 `{"file_key","file_name"}`，图片为 `{"image_key"}`；
2. 收到文件/图片 → 调 `GET /open-apis/im/v1/messages/:message_id/resources/:file_key?type=file|image`（node-sdk `im.messageResource.get`）下载，保存到 `userData/feishu-files/`（保留原始文件名）；
3. **立刻回一条确认**："已收到文件《xxx.xlsx》(137KB)，已保存到 `<本地路径>`，直接告诉我怎么处理"——与占位卡片同属"秒回"体验；
4. 维护 per-chat 最近文件列表（chat_id → 最近 N 个文件路径），随后续文本 prompt 附给 Agent（"用户刚发来的文件：<路径>"），这样"这个你看得到吗"就能解析到具体文件；与阶段 0 的 debounce 合并天然配合（文件+说明文字合并成一次处理）；
5. 前置条件：开放平台需勾选**「获取消息中的资源文件」权限（im:resource）**；大文件注意下载超时与磁盘占用（设保留策略，如只留最近 7 天）。

---

## 二、外部调研：飞书 AI 机器人的标准对话流程

### 2.1 立即反馈：没有 typing indicator，标准做法是"占位卡片 + 流式更新"

- **[官方]** 消息域 API 全集（发送/回复/编辑/撤回/已读/表情回应）中**不存在"输入状态"接口**：https://open.feishu.cn/document/server-docs/im-v1/introduction ；chat-sdk 官方 Lark 适配器文档也明确写 "Lark has no typing-indicator API"（https://chat-sdk.dev/adapters/vendor-official/lark）。
- **[社区]** 业界标准模式：收到消息后**立刻回复一张占位卡片**（初始文案 "正在处理…"，卡片 `summary` 控制会话列表预览显示"[生成中...]"），然后原地流式更新同一张卡片（掘金实践：https://juejin.cn/post/7600990891206819867 ；clawdbot-feishu 源码）。
- **[社区]** 轻量替代：用**表情回应模拟 typing**——收到消息先给用户消息加 ⏳ 表情，回复完成再移除（API：`POST/DELETE /open-apis/im/v1/messages/:message_id/reactions[/:reaction_id]`，权限 `im:message.reactions:write_only`）。clawdbot-feishu 把它作为正式特性。
- **[官方]** 对长任务没有专门 API；模式就是"快速 ack + 异步处理 + 占位卡片原地更新"。

### 2.2 渐进更新消息的全部官方机制

**机制 A（传统）：`PATCH /open-apis/im/v1/messages/:message_id` 更新已发送的卡片** [官方]
- 只能更新 **interactive 卡片消息**；text/post 发出去就改不了（只能撤回重发）。
- 卡片 config 必须显式 `"update_multi": true`（共享卡片）。
- **单条消息 5 QPS**；接口整体 1000 次/分；只能更新 14 天内的消息；卡片 ≤30KB。
- **[社区]** 实测反复编辑约 20-30 次后**静默失败**（返回成功但内容不变，掘金）——高频流式场景已被社区弃用。

**机制 B（官方推荐）：CardKit v1 卡片实体 + 流式更新** [官方] —— 应采用
1. `POST /open-apis/cardkit/v1/cards` 创建卡片实体（schema 2.0，`streaming_mode: true`），返回 `card_id`：
   ```json
   {
     "schema": "2.0",
     "config": {
       "streaming_mode": true,
       "summary": { "content": "[生成中...]" },
       "streaming_config": { "print_frequency_ms": { "default": 50 }, "print_step": { "default": 2 } }
     },
     "body": { "elements": [{ "tag": "markdown", "content": "正在思考...", "element_id": "content" }] }
   }
   ```
2. 用 `im.message.reply/create` 发出（`msg_type: "interactive"`，content 引用 `card_id`）——这一步就是**秒回占位**。
3. 流式循环：`PUT /open-apis/cardkit/v1/cards/:card_id/elements/:element_id/content`，body `{ uuid, content: 全量文本, sequence: 递增 }`。
   - **content 传累计全量，不是增量**；新文本以旧文本为前缀才有打字机动画，否则整段替换。
   - `sequence` 必须严格递增（错误 300317）。
   - 节流基准：官方每卡片 10 次/秒（流式调用豁免该上限）；clawdbot-feishu 用 100ms 节流，codex-remote-feishu 建议思考类增量合并进 ~1s 窗口。**建议 500ms~1s 节流**（顺带省免费版 API 月额度，见 2.6）。
4. 结束**必须** `PATCH /open-apis/cardkit/v1/cards/:card_id/settings` 关闭 `streaming_mode` 并把 summary 换成正文摘要——否则流式 10 分钟后自动关闭（错误 200850），期间卡片不可转发、回调被阻塞。
- 权限要求：`im:message:send_as_bot` + `cardkit:card:write`（**当前应用需要在开放平台补权限**）；飞书客户端 **7.20+**。
- markdown 组件支持流式渲染，但半截 markdown（未闭合代码块/表格）会渲染异常；30KB 按序列化后实际请求体算。

**机制 C（辅助）：CardKit 全量覆盖 `PUT .../cards/:card_id` + 组件增删 `POST .../cards/:card_id/elements`** [官方] —— 流式过程中动态加"工具调用面板"等元素时用（hermes-lark-streaming 就是这样渲染思考过程/工具面板的）。

### 2.3 事件投递语义（长连接模式）

- **[官方] 3 秒硬性要求**：handler 必须在 3 秒内返回且不抛异常，否则服务端超时重推（https://open.feishu.cn/document/server-docs/event-subscription-guide/overview ）。**当前代码已满足**（入队即返回）。
- **[官方] 重试策略**：推送失败按 **15 秒 / 5 分钟 / 1 小时 / 6 小时** 间隔重推，最多 4 次。
- **[官方] 去重**：至少一次投递；`im.message.receive_v1` 官方明确要求**用 `message_id` 去重，不要依赖 `event_id`**（当前代码已满足）。
- **[官方] 顺序**：`im.message.receive_v1` **不是有序事件**，同一用户的连续消息不保证按序到达，需要业务侧用消息创建时间戳自行排序。
- **[社区]** 桌面端注意：进程退出/重启期间事件**丢失不补投**；重启后可能遇到排队重推，去重缓存窗口要够长（当前内存 500 条，重启即清空——可接受，但要知道）。

### 2.4 并发处理最佳实践（连发多条消息）[社区]

1. **per-chat 串行队列**：同一会话排队，不同会话并行（chat-sdk Lark 适配器内置；clawdbot-feishu 用 Promise 链保证同一卡片的更新串行有序）。
2. **消息合并/去抖**：收到首条后等 1-3 秒 debounce，把连发的几条短消息合并成一个 prompt（用户"发两条消息"的典型场景）。
3. **排队位置写进占位卡片**："排队中（第 N 位）"，让人知道没死。
4. **新消息取代旧任务（supersede）**：同会话新消息到达时 AbortController 中止旧运行，只处理最新请求。
5. **`/new` 之类会话重置命令**（clawdbot-feishu）。

### 2.5 开源案例

| 项目 | 方案 | 要点 |
|---|---|---|
| [m1heng/clawdbot-feishu](https://github.com/m1heng/clawdbot-feishu)（TS） | CardKit 流式 | 创建 schema 2.0 流式卡片 → 增量到达时全量文本 + sequence 递增 PUT，100ms 节流，结束关 streaming_mode；README FAQ 又提示生产环境对开流式谨慎（频控）；[issue #446](https://github.com/m1heng/clawdbot-feishu/issues/446)：必须传全量文本，传增量只显示最后几个字 |
| [ConnectAI-E/Feishu-OpenAI-Stream-Chatbot](https://github.com/ConnectAI-E/Feishu-OpenAI-Stream-Chatbot)（Go） | 老 PATCH 方案 | 占位卡片（update_multi）→ 每 700ms PATCH 一次 → 结束写终稿；10s 无内容超时兜底 |
| [Cheerwhy/hermes-lark-streaming](https://github.com/Cheerwhy/hermes-lark-streaming)（Py） | CardKit 全功能 | 单卡片内动态渲染思考过程/工具面板/打字机正文；节流调度；接近 200 元素上限时封存旧卡开新卡；监听撤回终止更新；卡片创建失败降级纯文本回复 |
| [kxn/codex-remote-feishu 约束文档](https://github.com/kxn/codex-remote-feishu/blob/master/docs/general/feishu-card-api-constraints.md) | 工程基线 | 思考类增量合并 ~1s 窗口；30KB 按实际请求体算；流式与卡片按钮回调不能共存 |

### 2.6 频控与额度汇总 [官方]

| 接口 | 限制 |
|---|---|
| im.message.create / reply | 同一用户 5 QPS；同群所有机器人共享 5 QPS；整体 1000 次/分、50 次/秒 |
| PATCH im/v1/messages/:id（更新卡片） | 单条消息 5 QPS；整体 1000 次/分；超限错误 230020 |
| CardKit 卡片/组件接口（非流式） | 每卡片实体 10 次/秒（卡片级+组件级合计）；**流式文本调用豁免** |
| CardKit 流式更新文本 | 接口级 1000 次/分、50 次/秒；sequence 严格递增 |
| 消息体大小 | 文本 ≤150KB；卡片 ≤30KB |
| 免费版自建应用 | **10000 次 API 调用/月总量**（流式更新会快速消耗，节流 1s 而非 100ms 可大幅缓解） |
| 限流表现 | HTTP 429 / code 99991400，响应头 `x-ogw-ratelimit-reset` 给等待秒数；消息类 API 不支持提额 |

---

## 三、内部可行性：把流式管道接到飞书

不需要动 Agent 内核，改动集中在"出口"和"编排"两层：

1. **解耦流式出口**：`sendAgentStatus` 目前写死推给 BrowserWindow。加一个与窗口无关的订阅 API（如 `agentService.onOutputChunk(executionId, cb)` / EventEmitter），渲染窗口和飞书频道都是订阅者。
2. **新增飞书流式卡片发送器**（对应 §2.2 机制 B）：创建卡片实体 → reply 发出（秒回占位，文案"正在思考…"或"排队中第 N 位"）→ 订阅 chunk，累计全量文本按 500ms~1s 节流 PUT → 完成/出错都关闭 streaming_mode，summary 换正文摘要。
3. **降级链**：CardKit 创建失败（无权限/客户端版本低）→ 降级为"占位纯文本 + 最终一条纯文本"（现状行为）；再失败 → 只发最终结果。
4. **队列改造**：全局 `SerialMessageQueue` → **per-chat 串行 + 会话间并行**；占位卡片里回显排队位置；同会话 2s debounce 合并连发消息；可选 supersede（新消息中止旧运行）。
5. **健壮性**：`stop()` 时排空/终止队列并向未完成的占位卡片写"服务已停止"；回复失败有限重试（尊重 `x-ogw-ratelimit-reset`）。
6. **前置条件**：开放平台给应用补 `cardkit:card:write` 权限；确认用户飞书客户端 ≥7.20；确认企业是否免费版（10000 次/月额度）以定节流档位。

---

## 四、频道（连接器）架构调研

### 4.1 WorkBuddy 的真实结构：连接器 ≠ 渠道

WorkBuddy（workbuddy.cn，腾讯系的 AI 桌面智能体）的对外连接分**两个独立体系**（[官方文档](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector)）：

1. **连接器（Connectors）= 工具/数据集成**：QQ 邮箱、腾讯文档、腾讯乐享、腾讯会议、TAPD、腾讯网盘 + 自定义（走 **MCP** 配置）。每连接器独立认证（扫码授权/OAuth 网页登录）、卡片墙 UI、绿点状态 + 启用/禁用开关、可随时解绑。
2. **渠道（助理接入）= IM 平台接入**：微信助理、微信客服号、企业微信、QQ 机器人、飞书、钉钉机器人六篇文档，用途是**远程向桌面智能体下发任务**——和我们飞书 bot 的定位完全一致。

**对产品拆分的启示**：飞书 bot 应抽象为 **Channel（消息渠道）**，而不是和"网盘/文档类连接器"混为一层；但两者可以共用同一个"外部连接中心"的卡片墙 UI（每连接一张卡：状态点 + 开关 + 独立认证入口）。业界同类：OpenAI ChatGPT 2025 年的 apps + 原生连接器（底座同为 MCP，Google Drive/Slack/Notion/Calendar）。

### 4.2 开源项目的渠道抽象模式（蒸馏自 4+ 真实项目源码）

| 项目 | 模式贡献 | 来源 |
|---|---|---|
| **LangBot**（最像我们） | 声明式 YAML manifest（自动生成配置 UI，类型化字段 + `show_if` 条件显隐）+ 适配器基类：`send_message`（主动推）/`reply_message`（回复）/`reply_message_chunk`（流式，`is_final` 标志）/`register_listener`（入站总线）/`run_async`+`kill`（生命周期）/`is_stream_output_supported()`（能力位）；MessageChain 双向归一化 | [lark.yaml](https://raw.githubusercontent.com/langbot-app/LangBot/master/src/langbot/pkg/platform/sources/lark.yaml)、[adapter.py](https://github.com/langbot-app/langbot-plugin-sdk/blob/master/src/langbot_plugin/api/definition/abstract/platform/adapter.py) |
| **NoneBot2** | 接口要小：Adapter 只管"连接 + 调 API"，Bot 管"会话身份 + 发送"；连接建立/断开向上通知框架；API 调用统一入口带钩子，可 mock | [adapter.py](https://raw.githubusercontent.com/nonebot/nonebot2/master/nonebot/internal/adapter/adapter.py) |
| **Chatwoot** | channel（通信方式）与 inbox（实例）分离；每渠道实例独立模型 + **凭据静态加密**（`encrypts`）+ Reauthorizable（token 过期重授权是一等公民）；`after_create_commit :subscribe / before_destroy :unsubscribe` 对称生命周期 | [channelable.rb](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/models/concerns/channelable.rb) |
| **chatgpt-on-wechat** | 渠道工厂（`create_channel(type, instance_id, credentials…)`，多实例绕过单例）；渠道与 Agent 之间强制 **Bridge 层**（渠道绝不直接碰 LLM）；源码里真实事故：队列/锁曾是类级属性，导致 **Feishu 渠道的 context 被 Web 渠道消费**（跨渠道串台），改实例级解决 | [channel_factory.py](https://raw.githubusercontent.com/zhayujie/chatgpt-on-wechat/master/channel/channel_factory.py)、[chat_channel.py](https://raw.githubusercontent.com/zhayujie/chatgpt-on-wechat/master/channel/chat_channel.py) |
| **Bot Framework** | 中性 Activity 信封（含全局唯一 id），消费侧按 id 幂等；"靠幂等而不是靠阻塞响应长任务" | [Activity 规范](https://github.com/microsoft/botframework-sdk/blob/master/specs/botframework-activity/botframework-activity.md) |

**共同模式**：① 统一消息信封；② 适配器接口 = 生命周期 + 入站监听 + 出站（send/reply/stream）；③ 能力位声明让上层自适应（飞书能流式，Telegram 只能 editMessageText 降频，邮件只能整发）；④ 注册从静态表起步、声明式 manifest 演进；⑤ 每实例独立凭据 + 加密 + 重授权；⑥ 启动健康上报。

### 4.3 适配本项目的最小 TypeScript 接口草案

```typescript
// 统一入站信封
interface InboundMessage {
  eventId: string            // 平台事件 id
  messageId: string          // 平台消息 id（去重用——飞书官方要求用 message_id）
  channel: string            // 'feishu' | 'dingtalk' | 'telegram' | …
  instanceId: string         // 同渠道多实例（如两个飞书自建应用）
  chat: { id: string; type: 'p2p' | 'group' }
  sender: { id: string; name?: string }
  content: { text: string; raw?: unknown }
  receivedAt: number
}

// 能力位：上层 Agent 输出策略据此自适应
interface ChannelCapabilities {
  canSendCard: boolean            // 飞书 true
  supportsStreamingUpdate: boolean // 飞书 CardKit true；Telegram 靠 editMessageText 降频
  maxTextLength: number           // 飞书 4000 截断 / Telegram 4096
  receivesVia: 'websocket' | 'long-polling' | 'webhook' // webhook 在桌面端需中继，UI 前置声明
}

// 渠道适配器：飞书是第一个实现
interface ChannelAdapter {
  readonly id: string
  readonly manifest: ChannelManifest   // 名称/图标/configSchema(含 showIf)/帮助链接 → 自动生成设置 UI
  validateConfig(cfg: Record<string, unknown>): ValidationResult
  connect(cfg: ResolvedConfig, hooks: AdapterHooks): Promise<void>
  disconnect(): Promise<void>          // 与 connect 对称：排空队列、清理监听
  getStatus(): ChannelStatus           // disconnected | connecting | connected | error（→ UI 状态点）
  reply(msg: InboundMessage, out: OutboundContent): Promise<{ messageId?: string }>
  push(chatId: string, out: OutboundContent): Promise<{ messageId?: string }>  // 主动推送(cron 通知)
  // OutboundContent: { kind:'text' } | { kind:'card' } | { kind:'stream', streamId, fullText, final }
}

interface AdapterHooks {
  onMessage(msg: InboundMessage): void        // 归一化后上交 ChannelManager
  onStatus(s: ChannelStatus, detail?: string): void
}

// 主进程单例：注册/启停/状态列表 + eventId 去重 + 每渠道令牌桶限速 + chatId→Agent 会话路由
// 凭据继续走 Electron safeStorage（等价 Chatwoot encrypts）
class ChannelManager extends EventEmitter { register(); start(instanceId, cfg); stop(instanceId); list(): ChannelInstanceInfo[] }
```

**渠道与 Agent 之间保留 Bridge 层**（CoW 模式）：渠道只负责收发与格式归一，Agent 调度（per-chat 队列、debounce、supersede）在 Bridge，避免每个渠道重复实现。

### 4.4 业界踩过的坑（直接对应我们的风险清单）

1. **重复投递是设计行为**：飞书 3 秒未返回即重推（15s/5m/1h/6h ×4 次），必须按 message_id 幂等。[官方]
2. **SDK 长连接不可全信**：Go SDK 长连接快速发消息稳定丢消息（[oapi-sdk-go#195](https://github.com/larksuite/oapi-sdk-go/issues/195)）；Python SDK 重连循环可能永久挂起（[oapi-sdk-python#126](https://github.com/larksuite/oapi-sdk-python/issues/126)）；第三方实测"数小时后断开不自动重连"。→ 重连/watchdog 自己持有（我们已有 3s 守护轮询，保留）。
3. **重连导致监听器泄漏**：LangBot 专门提供 register/unregister 成对接口。→ 每次 reconnect 走同一套 teardown→setup，禁止叠加注册。
4. **跨渠道资源串台**：CoW 的队列/锁曾是类级属性，飞书渠道的 context 被 Web 渠道消费。→ 队列/定时器必须每渠道实例私有。
5. **限速与重启风暴**：Telegram 全局 ~30 msg/s，网关重启风暴本身触发 429。→ 每渠道令牌桶 + 流式编辑降频（1-2s）+ 启动时不重复调低频配额接口。
6. **重连退化**：状态机要有"半开"探测；UI 健康卡（WorkBuddy 绿点/开关模式）让用户可见。

---

## 五、建议的改造路线（分阶段）

> **状态更新 2026-09-12：阶段 0 已实施**（同日完成）。实现摘要：
> - 秒回占位 + CardKit 流式卡片 + 降级纯文本：`feishu-bot/streaming-card.ts`、`feishu-bot/feishu-api.ts`（900ms 节流、sequence 递增、终稿必关 streaming_mode）
> - 文件/图片接收：`message-parsing.ts`（text/post/file/image）+ `file-receive.ts`（下载落盘到 `userData/feishu-files/`、保留 7 天、Mimosa 审过的路径边界校验）+ `recent-files.ts`（每会话最近 5 个文件、30 分钟内注入 Agent 上下文）
> - 队列重构：`chat-queue.ts`（per-chat 串行 + 会话间并行 + 2s 合并窗口 + 排队位置 + 命令直通 + 全局 16 条上限保留）
> - 流式管道复用：`agent/agent-events.ts` 在 `sendAgentStatus` 内加进程内 EventEmitter 镜像,`agent-runner.runAgentStreaming` 订阅驱动卡片;Agent 内核零改动
> - 健壮性：`reply.ts` 限流/网络错误重试一次;`service.stop()` 先 `queue.cancelAll()`(排队消息回"未处理"提示)+ 活动会话收尾,再断连
> - 测试：新增 `tests/main/feishu-bot-stage0.test.ts`(14) + `feishu-bot-streaming.test.ts`(9);全套 3742 测试通过
> - **待用户在飞书开放平台操作**：应用补 `cardkit:card:write`(流式卡片)与 `im:resource`(文件下载)权限;未补权限时自动降级为纯文本,不阻塞使用
>
> 阶段 2 的候选频道评估见 `docs/research/2026-09-12-channel-connector-catalog.md`。

**阶段 0 — 飞书体验修复**（✅ 已实施,见上方状态更新）
1. 秒发占位：收到消息立即回占位卡片（"正在思考…"/"排队中第 N 位"）——先不做流式也能立刻消除"死了吗"焦虑；
2. 文件/图片接收（§1.5）：不再静默丢弃，下载保存到本地 + 秒回确认（含本地路径）+ per-chat 最近文件列表注入 Agent 上下文；
3. 流式接入：补 `cardkit:card:write` 权限 → CardKit 流式卡片（500ms~1s 节流、全量文本、sequence 递增、结束必关 streaming_mode；失败降级现状纯文本）；
4. 队列语义：全局串行 → per-chat 串行 + 会话间并行；占位卡片回显排队位置；同会话 ~2s debounce 合并连发（文件+说明文字天然合并）；可选 supersede；
5. 健壮性：stop() 排空队列并给未完成占位卡片收尾；回复失败按 `x-ogw-ratelimit-reset` 有限重试。

**阶段 1 — 频道化重构**（在阶段 0 验证交互形态后）
> **已细化为可执行实施方案**（2026-09-12）：接口完整定义、模块布局、设置迁移、连接中心 UI 线框与任务分解见 `docs/plans/2026-09-12-channel-architecture-implementation.md`（分支 `feature/channel-architecture`）。
- 落地 §4.3 接口：`ChannelManager` + `FeishuAdapter`（现 feishu-bot/* 迁入）+ Bridge 层（per-chat 队列/去抖/supersede 逻辑从 Feishu 适配器上提到 Bridge）；
- settings 迁移：`feishu.*` → `channels.feishu.*`（保留兼容读取）；凭据仍走 safeStorage；
- 渲染层设置页改造为"连接中心"卡片墙（每渠道一张卡：状态点 + 开关 + 配置入口，WorkBuddy 模式）；manifest/configSchema 驱动表单。

**阶段 2 — 扩渠道**
- 桌面端友好优先：钉钉 Stream Mode（同为出站 WS）、Telegram long-polling；
- webhook/IMAP 型（企微、邮件）需云端中继或本地隧道——manifest 的 `receivesVia` 字段在 UI 上前置声明该约束。

**需要用户/后续决策的点**
- 飞书企业版还是免费版（10000 次 API/月额度决定流式节流档位）；
- supersede（新消息中止旧运行）是否符合教育场景预期（可能希望每条都处理）；
- 阶段 1 的 UI 形态（连接中心卡片墙）何时做。

---

## 附：主要来源

- 飞书事件订阅概述/重试/去重：https://open.feishu.cn/document/server-docs/event-subscription-guide/overview
- im.message.receive_v1（message_id 去重要求）：https://open.feishu.cn/document/server-docs/im-v1/message/events/receive
- CardKit 流式更新总览：https://open.feishu.cn/document/cardkit-v1/streaming-updates-openapi-overview
- 卡片元素流式文本：https://open.feishu.cn/document/cardkit-v1/card-element/content
- 卡片设置（关闭流式）：https://open.feishu.cn/document/cardkit-v1/card/settings
- 消息卡片 PATCH：https://open.feishu.cn/document/server-docs/im-v1/message-card/patch
- 频控说明：https://open.feishu.cn/document/server-docs/api-call-guide/frequency-control
- WorkBuddy 连接器文档：https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector
- LangBot / NoneBot2 / Chatwoot / chatgpt-on-wechat / Bot Framework：见 §4.2 各源码链接
- 开源飞书流式机器人：clawdbot-feishu、hermes-lark-streaming、Feishu-OpenAI-Stream-Chatbot、codex-remote-feishu（见 §2.5）
