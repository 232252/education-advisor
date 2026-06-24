# Education Advisor · iced 0.14 重写规划

> 版本：**0.0.1.rc1**
> 目标：以 `iced-app/preview/index.html`（v3）为**设计稿 1:1**，把所有页面、所有功能、所有数据链路实现到 iced 0.14。
> 范围：仅 `iced-app/`，不触碰根目录的 egui 版（egui 版作为对照保留，后续废弃）。

---

## 0. 三个硬性目标（用户确认）

1. **1:1 还原预览版** — 视觉、布局、组件、交互，跟 `preview/index.html` 完全一致
2. **响应式自适应** — 窗口拖大拖小要能合理重排（侧边栏可折叠、网格列数随宽度变、抽屉在窄屏变全屏）
3. **所有功能都要跑通** — 11 个页面 + 学生详情面板 + 主题切换 + 对话流式输出 + 工具调用可视化 + 调度器 + RAG + PII 假名化 + 30+ 模型预设

---

## 1. 现状评估

| 维度 | 现状 | 评估 |
|---|---|---|
| **数据模型** | `models.rs` 完整：Student / Conversation / Message / ToolCallRecord / RiskLevel / LlmProvider / Settings / RagDocument / FullBackup | ✅ 不动 |
| **后端** | `db.rs` / `llm.rs` / `runtime.rs` / `tools.rs` / `scheduler.rs` / `pii_shield.rs` 全部存在 | ✅ 不动 |
| **AI 编排** | 18 个 agent / ReAct / 工具超时 15s / args 16KB / 256KB 返回上限 | ✅ 不动 |
| **加密** | AES-256-GCM / 假名化 / 定向发送过滤 | ✅ 不动 |
| **主题系统** | `theme.rs` 已有 Dark/Light 完整 token（25+ 颜色） | ✅ 基础可用，**加 Auto 模式 + token 调整** |
| **UI 框架** | iced 0.14，`App` 47KB，含完整消息流 | 🟡 重写视觉层 |
| **UI 页面** | 11 个 page 文件，每个 4-20KB | 🟡 视觉/交互要全面重写 |
| **样式系统** | `ui/style.rs` 14KB，已有 card / button / text_input / pick_list | 🟡 加新 token + 新组件 |
| **图标** | 现在用 emoji | 🔴 换成 inline SVG |
| **响应式** | 无窗口尺寸 subscription | 🔴 需新增 |
| **学生详情** | 现在是 `pii_dialog.rs` 模态 | 🔴 改成 in-page 展开（按用户要求） |
| **主题切换** | 设置页只有 Dark/Light | 🔴 加 Auto（跟随系统） |
| **图表** | 无 | 🔴 暂无第三方库；用 SVG 自绘 |

---

## 2. 总体方案

### 2.1 架构原则

- **保持 egui 项目的所有数据/后端不变**（models / db / llm / runtime / tools / scheduler / pii_shield）
- **重写 UI 层**（`src/ui/*.rs`）按预览版
- **加响应式层**（`src/ui/responsive.rs`）— 单一来源的断点状态
- **加 SVG 图标系统**（`src/ui/icons.rs`）— 与预览版一致
- **加 in-page 详情面板** — 不再用 modal

### 2.2 关键决策

| 决策 | 选什么 | 为什么 |
|---|---|---|
| 图标 | inline SVG（写入源码常量） | 与预览版一致，零依赖、可缩放、可着色 |
| 图表 | 自绘 SVG（dashboard 风险分布、成绩趋势、代理活跃度） | iced 0.14 第三方 chart 库少；自绘可控且小 |
| 响应式 | `window_size_subscription` + `Layout::wide()` 枚举 | 跟其它 iced 项目一致做法 |
| 主题切换 | Dark / Light / Auto（Auto = 读 OS 注册表 `AppsUseLightTheme`） | 用户明确要求 |
| 学生详情 | in-page 展开（在 `students.rs` 视图里就地追加 panel） | 用户明确要求"下面汇聚" |
| 路由 | 单一 `Page` 枚举 + 顶替 view 模式 | 当前已经是这样 |
| 字体 | Noto Sans SC（已加载）+ JetBrains Mono（数字） | 与预览版一致 |

### 2.3 响应式策略

引入 `LayoutMode` 枚举：

```rust
pub enum LayoutMode { Compact, Medium, Wide }

impl App {
    pub fn layout_mode(&self) -> LayoutMode {
        let w = self.window_size.width;
        if w < 900.0 { LayoutMode::Compact }
        else if w < 1280.0 { LayoutMode::Medium }
        else { LayoutMode::Wide }
    }
}
```

不同模式下的差异：

| 元素 | Compact (<900) | Medium (900-1280) | Wide (≥1280) |
|---|---|---|---|
| 侧边栏 | 默认收起（只图标） | 收起 + hover 展开 | 完整展开 |
| Dashboard KPI | 1 列 | 2 列 | 4 列 |
| Dashboard row-2 | 1 列 | 1 列 | 2 列 |
| 学生表格 | 隐藏"监护人"列 | 全部列 | 全部列 |
| Chat 工具面板 | 底部抽屉 | 右侧 280px | 右侧 320px |
| 字体缩放 | 90% | 100% | 100% |

实现方式：每个 `view_*` 函数根据 `self.layout_mode()` 返回不同的 layout tree。**不需要运行时动态切换组件**，只在每次重绘时按当前宽度算一遍即可。

---

## 3. 文件级改动清单

### 3.1 新增

| 文件 | 行数估算 | 作用 |
|---|---|---|
| `src/ui/icons.rs` | 600 | 30 个 inline SVG 图标常量（lucide 风格 stroke-width 2） |
| `src/ui/responsive.rs` | 80 | `LayoutMode` 枚举 + 断点判断 |
| `src/ui/components/mod.rs` | 30 | 组件模块声明 |
| `src/ui/components/badge.rs` | 150 | pill 标签 / 状态点 |
| `src/ui/components/kpi.rs` | 200 | KPI 卡片（含 sparkline） |
| `src/ui/components/capsule_bar.rs` | 150 | 风险分布胶囊条 |
| `src/ui/components/score_bar.rs` | 180 | 成绩双轨道 |
| `src/ui/components/section_header.rs` | 100 | 区块标题 + 渐变线 |
| `src/ui/components/empty_state.rs` | 120 | 空状态占位 |
| `src/ui/components/agent_card.rs` | 220 | AI 代理卡（含 hover） |
| `src/ui/components/sidebar_item.rs` | 150 | 侧边栏导航项 |
| `src/ui/components/theme_picker.rs` | 200 | 主题选择器 |
| `src/ui/adaptive.rs` | 120 | 响应式工具函数（`if_wide` / `if_compact`） |

### 3.2 改写（保留 Page 函数签名，body 完全重写）

| 文件 | 改动 |
|---|---|
| `src/app.rs` | 加 `window_size: Size`、`LayoutMode` 字段、订阅 `window::resize` |
| `src/theme.rs` | 加 `auto()` 构造函数 + 调整个别 token 对齐预览版（淡紫+粉+青+琥珀） |
| `src/ui/mod.rs` | 重新组织模块导出，加 `components` |
| `src/ui/style.rs` | 删 emoji 残留 + 新增 `glass_card` / `grad_button` / `icon_button` 样式 |
| `src/ui/sidebar.rs` | 重写为可折叠 + 响应式（compact 只显示图标） |
| `src/ui/topbar.rs` | 重写：搜索 + 引擎状态 + 当前 provider + 通知 + 刷新 |
| `src/ui/dashboard.rs` | 完全重写：4 KPI + 风险分布 + 成绩趋势 + 代理活跃 + 最近对话 |
| `src/ui/chat.rs` | 重写：3 栏布局（代理列表 + 流式对话 + 工具时间轴），窄屏变 2 栏 |
| `src/ui/agents.rs` | 重写：18 代理按教学/安全/行政分组 |
| `src/ui/students.rs` | 重写：表格 + 行点击展开 in-page 详情面板（5 个 tab） |
| `src/ui/skills.rs` | 重写：技能卡 + 触发器 + 工具映射 |
| `src/ui/rag.rs` | 重写：文档列表 + 检索测试（chunks 模拟返回） |
| `src/ui/scheduler.rs` | 重写：cron 任务卡 + 开关 + 编辑 |
| `src/ui/privacy.rs` | 重写：4 大块（PII Shield / 定向 / AES-GCM / 正则脱敏） |
| `src/ui/models.rs` | 重写：30+ 提供商网格 + 已配置模型表 |
| `src/ui/settings.rs` | 重写：AI 行为 + 外观（含主题三选一）+ 行为开关 + 快捷键 |
| `src/ui/agent_history.rs` | 重写：历史对话表 + 筛选 + 重跑 |
| `src/ui/pii_dialog.rs` | 改名为 `src/ui/privacy_dialog.rs` 并入 privacy 页 |
| `src/ui/toast.rs` | 补完入/出动画 |
| `src/ui/widgets.rs` | 清理旧 widget，补新组件 |

### 3.3 不动

- `src/models.rs` — 数据模型完美
- `src/db.rs` — DB 完整
- `src/llm.rs` — LLM 客户端完整
- `src/runtime.rs` — 运行时事件循环完整
- `src/tools.rs` — 9 个工具完整
- `src/scheduler.rs` — cron 调度完整
- `src/pii_shield.rs` — 假名化引擎完整
- `src/privacy.rs` — 加密完整
- `src/agents.rs` — 18 代理人设完整
- `src/ai.rs` — ReAct 编排完整
- `src/audit.rs` — 审计完整
- `src/embedding.rs` — 嵌入完整
- `src/util.rs` — 工具函数完整
- `src/students.rs`（后端 helpers）— DB 助手
- `src/main.rs` — 入口完整

---

## 4. 数据流（每个功能的链路）

### 4.1 Dashboard

```
┌─ App::view() → dashboard::view(app)
│
├─ 4 KPI 卡
│  ├─ total_students   ← app.stats.read().total_students    ← DB.count_students
│  ├─ risk_high        ← app.stats.read().risk_distribution ← DB.list_risk_students
│  ├─ conversations    ← app.stats.read().conversations_today ← DB.count_today
│  └─ tasks_running    ← app.tasks.read().iter().filter(t.enabled).count()
│
├─ 风险分布堆叠条 + 胶囊进度
│  └─ app.stats.read().risk_distribution 数组
│
├─ 成绩趋势（5 科）
│  └─ app.stats.read().grade_trend  (来自 DB.recent_grades + group by subject)
│
├─ 代理活跃度横向条形图（自绘 SVG）
│  └─ app.stats.read().agent_activity  (来自 DB.aggregate_agent_usage)
│
└─ 最近对话列表
   └─ app.conversations.read().iter().take(5)  ← 按 updated_at desc
```

刷新逻辑：`Event::DashboardRefresh` → 后台 tokio task 跑 `db.refresh_dashboard_stats()` → 回 `Event::DashboardStatsReady(stats)` → 更新 `app.stats`。

### 4.2 Chat（流式对话）

```
用户输入 → Message::Send → update() 解析 → runtime::Command::Chat { agent, prompt }
  → 后台 ReAct loop:
      loop (max = settings.max_iterations):
        llm.stream(prompt + tool_results) → chunks
        emit StreamChunk { delta } → UI 增量渲染
        if tool_call: 解析 args → tools::execute(name, args) → ToolResult
        else: 结束
  → Event::StreamFinished(message_id)
```

UI 状态：`app.streaming[conv_id] = StreamState { message_id, current_text, pending_tools: Vec<ToolCallRecord> }`。

### 4.3 Students（含 in-page 详情）

```
表格：
  app.students.read() → render rows → 每行 on_press = StudentRowClicked(uuid)
  → 选中行高亮 + 表格下方插入 StudentPanel（用 ConditionalWidget 或者直接 if）

StudentPanel（5 个 tab）：
  ├─ 概览：DB.get_student_full(uuid) → 3 KPI + 基本信息 + 活动时间线
  ├─ 学业：DB.get_grades(uuid) → 5 科成绩表
  ├─ 行为：DB.get_behavior_records(uuid) → 列表
  ├─ 联系：DB.get_guardian(uuid) → 监护人卡
  └─ 隐私：DB.get_pii_aliases(uuid) → 假名映射展示
```

### 4.4 Agents

```
app.agents = 加载 agents/*.md → AgentDef { id, name, role, desc, tags, tools, group }
app.agents.iter().group_by(|a| a.group) → 渲染 3 个分组
点 "对话" 按钮 → Navigate(Page::Chat) + Chat::PreSelectAgent(id)
```

### 4.5 Scheduler

```
app.tasks.read() → 列表
toggle 开关 → Command::SchedulerToggle(id) → runtime → DB.update_task_enabled
"立即执行" → Command::RunNow(id) → runtime.spawn_conversation_for_task(id)
"编辑" → 编辑 modal（用 components/modal.rs）
"日志" → 跳到 AgentHistory 过滤
```

### 4.6 RAG

```
app.rag_documents.read() → 文档列表
点 "检索测试" → ui_state.rag_query → Message::RagSearch → 后台 embedding + 检索
  → Event::RagResults { chunks: Vec<(doc_id, chunk_id, score, text)> }
  → 渲染 chunks
```

### 4.7 Privacy

```
DB.get_pii_config() → 显示状态
"更换密码" → PiiDialog → 重新加密 mapping.enc
"查看示例" → in-place 展示 假名化对比
```

### 4.8 Settings

```
app.settings = DB.load_settings()
├─ 主题切换 → Command::SetTheme(mode) → DB.save_settings → app.theme = Theme::new(mode)
├─ 当前 provider → pick_list → DB.set_active_provider(id)
├─ API key → 加密后存 DB
├─ 温度 / 迭代次数 / Top-P → slider → DB.save
├─ 强调色 → 6 色圆点 → 仅前端，不持久化
├─ 行为开关 → toggle → DB.save
└─ 快捷键 → 只读
```

### 4.9 Models

```
DB.list_providers() → 已配置
+ 21 个 ProviderPreset 常量网格 → "+ 配置" → 编辑 modal
```

### 4.10 AgentHistory

```
DB.list_conversations(start, end) + DB.aggregate_stats
→ 表格 + 筛选器（agent / 时间）
"重跑" → Command::RerunConversation(id)
```

---

## 5. 实施阶段（5 个里程碑）

### Milestone 1 — 基础设施（预计 1 天）

- [ ] 写 `src/ui/icons.rs`（30 个 SVG 常量）
- [ ] 写 `src/ui/responsive.rs`（`LayoutMode` + 断点）
- [ ] 写 `src/ui/adaptive.rs`（响应式工具函数）
- [ ] 写 `src/ui/components/{badge,kpi,capsule_bar,score_bar,section_header,empty_state,agent_card,sidebar_item,theme_picker}.rs`
- [ ] 调整 `src/theme.rs` — 加 `auto()` + 微调 token 对齐预览版
- [ ] 改 `src/app.rs` — 加 `window_size` 订阅 + `LayoutMode` 字段
- [ ] 跑 `cargo check` 零 error

### Milestone 2 — 外壳（侧边栏 + 顶部栏 + 路由 + 主题切换）

- [ ] `src/ui/sidebar.rs` 重写（可折叠 + 响应式）
- [ ] `src/ui/topbar.rs` 重写
- [ ] `src/ui/style.rs` 补新样式
- [ ] 主题切换接入
- [ ] 跑 `cargo run`，打开看到外壳

### Milestone 3 — 9 个次要页面

按"容易的先做"原则：
- [ ] AgentHistory
- [ ] Scheduler
- [ ] Privacy
- [ ] RAG
- [ ] Skills
- [ ] Models
- [ ] Settings（含主题三选一真切换）
- [ ] Agents
- [ ] 删除 `pii_dialog.rs`（并入 Privacy 页）

每做完一个 → 编译 → 截图对比预览版。

### Milestone 4 — 三大核心页

- [ ] Dashboard（最复杂：4 KPI + 3 图表 + 列表）
- [ ] Chat（流式输出 + 工具时间轴 + 响应式）
- [ ] Students（表格 + in-page 详情面板 + 5 tab）

### Milestone 5 — 响应式 + 抛光 + 验证

- [ ] Compact / Medium / Wide 三档断点全过一遍
- [ ] 字体按断点缩放
- [ ] 微交互动画（hover lift、tab 切换、抽屉滑入）
- [ ] 空状态 / loading / 错误状态补齐
- [ ] `cargo test` 全过
- [ ] `cargo clippy -- -D warnings` 零警告
- [ ] `cargo fmt` 检查
- [ ] Linux + Windows 跨编译验证
- [ ] 截图对比预览版 1:1

---

## 6. 验证方式

### 6.1 每个 Milestone

```bash
cd iced-app
cargo check
cargo build
cargo clippy --all-targets --no-features -- -D warnings
cargo fmt --all -- --check
```

### 6.2 视觉对比

打开 `iced-app/preview/index.html` 和 `cargo run` 后的 iced 窗口，并排截图。每个页面都对一遍：
- 配色 / 间距 / 圆角 / 阴影
- 字体 / 字号 / 字重
- 交互（hover / click / focus / active）
- 状态（empty / loading / error / success）

### 6.3 响应式验证

拖动窗口从 800×600 → 1920×1080，每个断点都要能正常重排，无文字截断、无溢出。

### 6.4 功能链路验证

每个页面走一遍 happy path：
- Dashboard 数字与 DB 实际一致
- Chat 发消息能收到流式响应
- Students 点行能展开详情，5 tab 都正确
- Agents 点"对话"能跳到 Chat 并预选代理
- Skills 触发器 / 工具映射正确
- RAG 检索能返回 chunks
- Scheduler 开关能切换、立即执行能跑
- Privacy 假名化 / 脱敏示例正确
- Settings 改完能保存 + 立即生效
- Models 能加 / 删 / 切换
- AgentHistory 能筛选 + 重跑

---

## 7. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| iced 0.14 图表能力弱 | 中 | 自绘 SVG（已经在预览版验证过） |
| 响应式状态管理复杂 | 中 | 统一在 `LayoutMode` 枚举，每帧按 `window_size` 重算 |
| 流式输出在切换页时丢失 | 中 | 流状态存 `app.streaming` 全局 HashMap |
| in-page 详情面板占位 | 中 | 用 `Option<StudentDetailPanel>` 在 `students` 视图里条件渲染 |
| 30+ SVG 图标源码膨胀 | 低 | 单一文件 `icons.rs`，压缩为常量 |
| 主题切换在已打开窗口上不立即生效 | 低 | 切换后调 `app.theme = Theme::new(mode)` 重绘 |
| Auto 模式读 OS 注册表 | 中 | 用 `windows-sys` 或 `winreg` crate；fallback 默认 Dark |
| 字体按断点缩放影响布局 | 中 | 用 `Font::DEFAULT` 配合 `text.size()` |

---

## 8. 范围之外（不做）

- ❌ 国际化（i18n）— 整个项目中文优先
- ❌ 多窗口
- ❌ 系统托盘（iced 0.14 支持弱，先不做）
- ❌ 自定义字体加载动画
- ❌ 数据导入/导出（FullBackup 已在 models 里，但 UI 不做）
- ❌ 设置里的 30+ 强调色都做（只做 6 个核心）

---

## 9. 验收标准（用户视角）

✅ 1:1 还原预览版：每个页面截图对比，差异 < 5%
✅ 响应式：800 / 1024 / 1280 / 1920 四个宽度都正常
✅ 所有功能可点：11 个页面、详情面板 5 tab、主题切换、对话收发、工具调用
✅ 链路清晰：每个 UI 元素都能溯源到 DB / 后端 / mock
✅ `cargo build --release` 通过
✅ `cargo clippy -- -D warnings` 零警告
✅ 启动时间 < 2s
✅ 单二进制 < 30MB
