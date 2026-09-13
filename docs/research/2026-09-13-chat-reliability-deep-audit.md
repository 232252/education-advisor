# 对话可靠性与首次启动风险深查 + 修复执行文案（2026-09-13）

> **状态：已全部实施并装机验证（2026-09-13 深夜）。** P0-1/2/3、P1-4/5/6、P2-7/8/9 全部落地
> （P2 三项按"不妥协全功能"指示一并实施：排队发送、read_image 视觉通道、重试口径统一）。
> 测试 3937/3937 绿（3901 基线 + 21 新增）；装机启动零错误(934ms ready-to-show)；
> 视觉链路经真实 API 端到端验证(969KB 答题卡照片被模型准确识别)。
> 回滚：单 commit revert 后重打包即回。

> 触发事件：09-13 22:05「模拟改卷」消息带 3 附件，AI 纯沉默；22:08「？」4 分钟后才回。
> 当晚已完成根因诊断（见记忆 ai-chat-silent-diagnosis），本轮为全链路系统性深查：
> A 启动/首启风险、B 对话主链路、C 附件/视觉链路。本文档为修复执行依据。

## 〇、结论总览

| 域 | 结论 |
|---|---|
| A 启动 | 主干防护到位（DB 降级/设置深合并/网关隔离/asarUnpack），**缺口集中在渲染层崩溃与加载失败无自愈** |
| B 对话 | **abort/超时对用户零可见（今晚实锤）+ 挂死请求无超时无重试 + 半截回复被记成功** |
| C 附件 | **二进制附件 size 硬编码 0（实锤）+ 聊天全链路无视觉通道（图片模型看不见）** |

基线：main 分支 deaaf84，测试 3901 绿。

---

## 一、问题清单（按证据列出）

### A. 启动 / 首次启动

**A1【已防护，无需改】DB 初始化失败优雅降级**
`db-service.ts` 头注释+实现：sqlite 加载失败 → `_ready=false`，所有方法 no-op，启动不中断。✅

**A2【已防护】settings 默认值完整**
`settings/defaults.ts` → `config/default-settings.json`：`logLevel`/`agentTimeoutMins:5`/`webUiMode:off`/`models.retry` 均有默认；`loadOrDefaultSync` 深合并保证结构。新机无 settings.json 安全。✅

**A3【已防护】WebUI 网关不拖垮主窗口**
`webui-service.ts:239-259`：EADDRINUSE 自动 +1 重试 12 个端口；失败仅 `lastError` + warn 日志。桌面渲染走 `app://` 协议（`app-lifecycle.ts:102`），不依赖网关。✅

**A4【已防护】原生模块打包正确**
`electron-builder.yml`：`asarUnpack: ["**/*.exe","**/*.node","**/*.dll"]` 覆盖 better-sqlite3 与 @napi-rs/canvas。canvas 为懒加载，缺失时报友好错误（`grading/pdf-rasterize.ts:167`）不崩启动。✅

**A5【缺口·P1】渲染进程崩溃后无自愈**
`app-lifecycle.ts:112-114`：`render-process-gone` 仅 console.error，不 reload。
实证：09-13 13:40 renderer 日志 ErrorBoundary 连环错误（renderer-2026-09-13.log）。渲染层崩了 = 白屏等用户手动重启。

**A6【缺口·P1】页面加载失败无重试无兜底**
`app-lifecycle.ts:117-119`：`did-fail-load` 仅记日志。app:// 加载失败 = 白屏。

**A7【缺口·P1】registerAllHandlers 抛错 → 白窗无恢复**
`app-lifecycle.ts:79` 窗口先建，`:85` `await registerAllHandlers(win)` 无 try/catch；抛错被 index.ts:116 仅日志捕获，窗口已存在但永不 loadURL。

### B. 对话主链路

**B1【用户可见故障·P0】abort/超时对用户零可见（今晚 22:05 实锤）**
证据链：
- 主进程：`execution.ts:549-550` wasAborted → `notifyStatus('idle',{aborted:true})`；DB 只写 agent_executions，**chat_messages 零落库**（DB 实测）。
- 渲染层：`stores/chat/agent-bridge-slice.ts:203-243` `case 'idle'` **从头到尾未读 `data.aborted`**；:212 空内容守卫只管不落空气泡。
- 对比：`case 'error'`(:245-280) 有"**错误:** …"气泡并经 addMessage 落库。
→ 用户点停止/运行超时后：无提示、无落库、界面只剩乐观空气泡 = "完全不理人"。

**B2【用户可见故障·P0】挂死请求无超时上限、零字节中止不可重试**
- pi-ai openai-completions 支持 `options.timeoutMs → fetch timeout`（`openai-completions.js:210`），但全应用**无人传 timeoutMs** → 单请求无主动超时（仅 undici 默认 ~300s 兜底）。
- `retrying-stream.ts:85` canRetry 取决于 `isRetryableError`；`pi-ai-helpers.ts:243-255` 列表 = timeout/network/429/5xx/ECONNRESET/ECONNREFUSED —— **"Request was aborted" 不在内**；22:05 挂死 180s 后中止，一次重试都没发生（日志无 retry 行）。
- `agentTimeoutMins(=5min)` 只包 waitForIdle（`execution.ts:224-230`），不管 prompt() 本身。

**B3【体验缺陷·P1】部分输出+中途错误 → 记 success、错误被丢**
`execution.ts:522` `hasError = 输出为空 && 有错误`；有部分输出时 hasError=false → finalStatus='success'，`rawOutput` 只含 outputText，`lastErrorMessage` 不附著（:529）。半截回复被当完整回复，用户不知出错。续跑循环仅部分缓解。

**B4【体验缺陷·P2】运行中输入框锁死，无法排队追问**
`ChatPage.tsx:150` `if (!input.trim() || isStreaming) return`；Composer 同步禁用。而主进程 run-queue 明明支持排队（`run-queue.ts:20` maxDepth=8）。4 分钟长任务期间用户只能干看工具行。

**B5【代码坏味道·P2】直连路径与 agent 路径重试口径相反**
`pi-ai-helpers.ts:165` mapEvent：error 事件 `retryable = reason==='aborted'`（aborted 才重试）；agent 链路 `isRetryableError` 反而**不含** aborted。直连 chat IPC（`ipc/ai/chat-handlers.ts`）仍在。两口径应统一。

### C. 附件 / 视觉链路

**C1【用户可见故障·P0】二进制附件 size 硬编码 0**
- `useFileUpload.ts:81-92`：ARCHIVE_OR_SCAN（pdf/zip/jpg/png/webp/bmp）分支 `size: 0, content: ''`。
- `chat-message.ts:92` `sizeKb=(f.size/1024).toFixed(1)` → prompt 显示 "(0.0KB)"（969KB jpg 实锤）。
- 后果：模型不信任附件元信息 → 22:08 那轮 20+ 次 list_dir 满盘找文件，回复拖到 4 分钟。
- 修复素材：`ipc/sys-handlers.ts:165,219` readFile 已 stat 并返回 size —— 加 `metaOnly` 参数即可不读内容只回元信息。

**C2【产品缺口·P2 需拍板】聊天无视觉通道，图片模型看不见**
- 二进制附件只传"绝对路径+指示语"（chat-message.ts:104-110），全 src/main 无任何 imageUrl/base64 注入，`tools.ts` 无读图工具；`showImages` 仅在系统提示词输出一行"显示图片: 是"（system-prompt.ts:97），形同虚设。
- 实证：09-13 20:00 模型自述"无法直接识别图片里的文字"。
- 现状 = 图片只能进批改管线（eaa_grading_from_files，EAA 子进程自带视觉）。聊天里发照片问"这题怎么讲"是不可能完成的。

**C3【设计如此，可接受】PDF/zip 走路径约定**，与批改工具契约一致。

---

## 二、修复执行方案

### P0 批（消除"沉默"，本轮立即做）

**P0-1 abort/超时可见化**（B1）
- `agent-bridge-slice.ts` `case 'idle'`：读 `data.aborted` → toast「已停止生成」+ 若 `data.result?.status` 为超时映射给「运行超时已停止，可重发或调大设置里运行超时」；会话内追加一条 role=system 的短消息（复用现有 system 消息通道，chat_messages 已有 system 先例）。
- `execution.ts:549`：idle 事件 payload 补 `reason: 'timeout' | 'aborted'`（isTimeout/isAborted 已在上下文）。
- 风险：低。纯展示层 + 事件字段追加。

**P0-2 挂死请求超时 + 可重试**（B2）
- `retrying-stream.ts`：给 streamSimple 的 options 注入 `timeoutMs`（默认 120_000，读 settings.models.retry 扩展键 requestTimeoutMs，缺省 120s）——SDK 原生 fetch timeout 通道，无需自建看门狗。
- `isRetryableError` 增加 `/timed?\s*out/i`（openai SDK 超时文案 "Request timed out."）与 `Request was aborted`；aborted 的重试前提保留现有 `!signal?.aborted` 门（用户主动停止不会被重试）。
- 风险：中低。重试语义变化需单测覆盖（含"用户 stop 不重试"）。

**P0-3 附件真实大小**（C1）
- `sys-handlers.ts` readFile 加 `metaOnly` 参数：stat 后直接回 `{success,name,path,size}` 不读内容。
- preload 类型 + `useFileUpload.ts` ARCHIVE_OR_SCAN 分支先 `readFile(p,{metaOnly})` 拿 size；toast 文案同步真实 KB。
- 风险：低。

### P1 批（启动韧性 + 状态诚实）

**P1-4 渲染层自愈**（A5/A6）：`render-process-gone` → `webContents.reload()`（限 3 次/会话防崩溃循环，超过则保留日志提示重启）；`did-fail-load` → 延迟 1s 重载一次，再失败降级 `loadURL('data:text/html…简单错误页')`。
**P1-5 半截输出标注**（B3）：`execution.ts:522` 改为 `hasError = !!stats.lastErrorMessage`（不再要求空输出）；有输出+有错 → status='failure'、输出尾部附 `\n\n[中断] {errorMsg}`，保留已生成内容。
**P1-6 启动兜底**（A7）：registerAllHandlers 包 try/catch，失败 log + 仍执行 loadURL（渲染层自身有降级 UI 能力），不白窗。

### P2 批（拍板后做）

**P2-7 运行中可排队发送**（B4）：解除 isStreaming 硬锁，允许发送 → run-queue 排队（上限提示）；UI 显示"已排队"。
**P2-8 聊天视觉通道**（C2）：方案 a) 新增 read_image 工具：主进程读图→base64→pi-ai image content block 注入（openai-completions 支持图片输入，glm-5.3-flash 为多模态）；方案 b) 不做功能，只把上传 toast/说明改诚实（"图片请在批改页使用"）。**需用户拍板范围**。
**P2-9 直连/agent 重试口径统一 + 回归测试**（B5）。

### 明确不做
- agentTimeoutMins 扩展为管 prompt() 全程 —— P0-2 的请求级超时已覆盖根因，不动运行级语义。
- ws fetch failed 噪声、直连 chat 路径下线 —— 另案（见 feishu-ws-log-noise-diagnosis）。

---

## 三、验证方案

1. **单测**（新增）：
   - bridge-slice：idle+aborted → 提示消息/系统消息；半截输出落库含 [中断] 标注。
   - retrying-stream：注入 timeoutMs；"Request timed out"/"Request was aborted" 重试；signal.aborted 不重试。
   - isRetryableError 新口径；useFileUpload metaOnly 分支 size 正确。
   - 基线 3901 绿不得回退。
2. **装机实测**（kill → NSIS 静装 → 启动零错误）：
   - 大附件消息：prompt 日志里附件显示真实 KB；回复不再出现成片 list_dir。
   - 断网发消息：~120s 超时 → 日志出现 retry 1/3 → 恢复网络自动续上；全程断网 → 最终失败且聊天里有错误气泡。
   - 运行中点停止：立即出现「已停止」提示。
   - （P1 后）任务管理器杀渲染进程 → 窗口自动恢复。
3. **回滚**：P0/P1 各一个 commit，revert 即回；不动 DB schema。

## 四、待拍板
1. P2-8 视觉通道选 a（做功能）还是 b（改文案）。
2. P2-7 运行中排队发送是否本轮一起做。
3. P0-2 请求超时默认 120s 是否合适（可设置化后用户可调）。
