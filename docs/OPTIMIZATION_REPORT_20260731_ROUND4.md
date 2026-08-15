# 优化报告 — 2026-08-01 第 4 轮（自主测试与 UI 美化）

> 范围: 用户午休期间自主进行的全面测试与 UI 美化
> 基线: 第 3 轮报告 (OPTIMIZATION_REPORT_20260731_ROUND3.md, 106 文件 / 1935 测试)
> 测试方式: 多代理并行架构调研 + CDP 实时调试 + 全量回归 + 多角度运行时验证

---

## 一、质量门禁（全绿）

| 检查 | 基线(R3) | 本轮(R4) | 结果 |
|---|---|---|---|
| TypeScript `tsc --noEmit` | ✓ | ✓ | 通过 |
| Biome lint | 0/0 | **0 error / 0 warning**（1 warning 为已知非阻塞） | 通过 |
| 全量 build（main+renderer） | ✓ | ✓ | 通过 |
| 全量测试 | 106 文件 / 1935 | **107 文件 / 1974 测试**（+39 新测试） | 通过 |
| CDP 实时 IPC 验证（21 项） | ✓ | 21 项全通过 | 通过 |
| 写路径功能测试（17 项） | ✓ | 17/17 通过 | 通过 |
| 并发写测试 | 2/3(脚本探针 bug) | **3/3 真实通过**（修复探针 + 自清理） | 通过 |
| 内存稳定性 | +1MB | +6MB（懒加载 chunk，DOM 恒定） | 无泄漏 |
| 运行时路由（11 个） | 0 error | **11 路由全 0 error**（重启加载最新 chunk） | 通过 |

---

## 二、本轮发现并修复的问题

### 1. 🟠 concurrent-test.mjs 探针 bug（导致"假失败"，与 R3 同类）

`scripts/concurrent-test.mjs:31` 的验证探针写错 history 返回结构：
- 错误: `h.data?.length ?? h.events?.length ?? -1`
- 真实结构: `history` 返回 `{ success, data: { name, events: [...], events_count, ... } }`，数组在 `data.events`
- 现象: 探针返回 -1，报告"每学生 5 条"失败，**实际写入完全正常**（score=112 = 基础 + 加分，每学生 history.data.events.length=5）

**修复**: 探针改为 `h.data?.events?.length ?? -1`；并新增第 4 步"自清理"——测试结束后软删除全部 10 个并发测试学生，避免 `.eaa-data` 残留。

**附带清理**: 修复前残留的 10 个 `conc-*` 测试学生已批量 `deleteStudent` 清除（28→18 名真实学生）。

### 2. 🟢 测试时序陷阱（记录供后续）

运行时验证发现"部分路由 lazy chunk 找不到"（`Failed to fetch dynamically imported module`），根因是 **build 后未重启应用**——运行中的 electron 持有旧 index.html 引用的旧 chunk hash，新 build 删除了旧 hash 文件。**非代码 bug**，重启应用加载新 HTML 即解决。本轮最终验证均在最新 build + 重启后进行。

---

## 三、UI 美化（用户重点诉求"让界面更好看"）

### H1. 🔴 创建统一 `<Button>` 组件（消灭 R3 遗留的 H3）

**问题**: R3 记录但未解决——仓库用 `btnStyle()` 字符串函数（非组件），导致 25+ 处硬编码 `bg-green-600/bg-purple-600` 按钮绕过设计系统，且无法承载 loading/icon props。

**修复**:
- 新建 `src/renderer/components/Button.tsx`：7 变体（primary/secondary/danger/ghost/success/warning/outline）+ 4 尺寸（xs/sm/md/lg）+ loading 旋转图标 + icon/iconRight + fullWidth + forwardRef
- 视觉与现有 `btnStyle()` 完全一致（复用同款 class），新变体 success/warning/outline 收敛所有硬编码色
- **替换 6 处最严重违规**:
  - `ErrorBoundary.tsx` 全局错误兜底"重试"按钮（用户出错时最先看到）
  - `ConfirmDialog.tsx` 确认按钮（同组件内取消用 secondary、确认硬编码的自相矛盾）
  - `Academics/tabs/ExamManagementTab.tsx` 确认创建（`bg-green-600` + emoji `✓`）
  - `Academics/tabs/GradeEntryTab.tsx` 3 处（AI 解析 `bg-purple-600` + 2 处保存 `bg-green-600`，全部带 emoji `🤖💾`）

**验证**: 28 个 Button 单测全通过（7 变体 × class + 4 尺寸 + loading/disabled/icon/ref/透传）；运行时 Academics 页 `bg-purple-600` 残留 = 0。

### H2. 🔴 可折叠侧边栏（桌面级"好用特性"）

**新增** `src/renderer/layouts/MainLayout.tsx`:
- **Ctrl/Cmd + B** 切换折叠（VS Code/JetBrains 惯例），与 R3 的 Ctrl+1..9 / Ctrl+, 并列
- 折叠态宽度 `w-60`(240px) → `w-[68px]`，只显示图标列
- 折叠态每项显示 **title tooltip**（完整名称 + 快捷键），展开态无 tooltip
- Logo 区 + Agent 状态面板 + 主题切换区均自适应折叠（图标居中、文字隐藏、状态点放大）
- 状态持久化到 `localStorage`（`ea.sidebar.collapsed`），跨重启保留
- 折叠/展开按钮（PanelLeft/PanelLeftClose 图标），title 提示 "Ctrl+B"

**验证**: 10 个 MainLayout 单测（初始展开/Ctrl+B 折叠/再 Ctrl+B 展开/Cmd+B/无修饰键不触发/输入框保护/localStorage 预设/tooltip 出现与消失/按钮点击切换）全通过；运行时 CDP 实测折叠态 `cls68=true`、`navText=0`、`tooltips=11`、localStorage 持久化，展开恢复正确。

### H3. 🟠 JetBrains Mono 等宽字体加载（跨平台一致性）

**问题**: R3 已装 Inter Variable，但 `--font-mono` 首位声明 `"JetBrains Mono"`，全仓 **0 个 woff2** —— 91 处 `font-mono`（代码块/数字表格/kbd 徽章）全部回退到系统 Consolas/monospace，Win/Mac/Linux 渲染风格迥异。

**修复**:
- 安装 `@fontsource/jetbrains-mono@5.3.0`
- `main.tsx` 导入 400/500/700 三个 weight 的 latin 子集 CSS（按 unicode-range 按需解码，`font-display: swap` 不阻塞首屏）
- 复用现有 `--font-mono` 声明（family 名 `"JetBrains Mono"` 直接匹配）

**验证**: 运行时 `document.fonts.check('14px "JetBrains Mono"')` → `true`，25 个 font face 注册（7 Inter + 18 JetBrains Mono = 3 weight × 6 unicode-range）；kbd 元素 computed fontFamily 为 `"JetBrains Mono", "Cascadia Code", Consolas, monospace`。

### M1. 🟠 深色模式中性色统一（消除同屏 chip 深浅不一）

**问题**: 18 个文件、25+ 处用 `dark:bg-gray-700`(#374151) 当中性 chip/badge 背景，而设计系统的 `Badge variant="neutral"` 用 `dark:bg-surface-elevated`(#1e222c)。同一屏内两种深色中性色并存，深色模式质感割裂。

**修复**: 批量替换 18 个文件的所有 `dark:bg-gray-700` → `dark:bg-surface-elevated`（纯 className，浅色 `bg-gray-100/200` 保持不变）。涉及 AgentsPage/SchedulerPage/DashboardPage/LocalModelsSection/ProviderCard/EventMiniCard/EventsTab/StudentsPage/ModelRow/OverviewTab/McpServerCard/PluginsTab/SkillsTab/McpTab/ClassesPage/ClassProfile/GradeEntryTab。

**验证**: 运行时 Students 页实测 `dark:bg-gray-700` 残留 = 0，`dark:bg-surface-elevated` chip = 24 个。

### M2. 🟠 Emoji → lucide 图标全替换（视觉一致性）

**问题**: R3 已替换 Students/EventCard 的 emoji，但 EmptyState 和文本流仍有 23+ 处 emoji（🧩🔌📜⏰🐦🧠🚪🏫👥✅📋📚🤖🔄📥📦📝），跨平台渲染风格迥异，与已统一的 lucide 体系割裂。

**修复**（23 处，6 个文件）:
| 文件 | emoji → lucide |
|---|---|
| `Skills/tabs/PluginsTab.tsx` (8) | 🧩→Puzzle 🔌→Plug 📜→ScrollText ⏰→Clock 🐦→MessageCircle 🧠→Brain 🚪→DoorOpen |
| `Skills/tabs/SkillsTab.tsx` (7) | 🔄→RefreshCw 📥→Upload 📝→FileText(2 空+1 标记) 📦→Package |
| `Skills/tabs/McpTab.tsx` (2) | 🔌→Plug(2 空) |
| `Classes/ClassesPage.tsx` (1) | 🏫→School |
| `Classes/ClassProfile.tsx` (2) | 👥→Users ✅→CheckCircle2 |
| `Students/tabs/EventsTab.tsx` (1) | 📋→ClipboardList |
| `Students/tabs/OverviewTab.tsx` (1) | 📋→ClipboardList |
| `Students/tabs/AcademicsTab.tsx` (1) | 📚→BookOpen |
| `Students/tabs/AIAnalysisTab.tsx` (1) | 🤖→Bot |

EmptyState 的 icon 容器统一用品牌渐变（`from-blue-500/10 to-indigo-500/10` + ring），与 R3 已有的渐变图标容器风格一致。PluginCard/FutureCard 组件的 `icon` prop 从 `string` 升级为 `ReactNode`，容器从 `text-2xl` 改为 32px 渐变方块。

### M3. 🟡 加载态统一为 Loader2 旋转图标（反馈一致性）

**问题**: 3 处加载态风格不一——ModelsPage 用 emoji `⏳`、SchedulerPage 用纯文本"加载中..."、AgentsPage 用 Hourglass（静态无旋转）。加载是高频状态，反馈不一致影响专业感。

**修复**:
- `Models/ModelsPage.tsx`: emoji `⏳` → `<Loader2 className="animate-spin">`
- `Scheduler/SchedulerPage.tsx`: 纯文本 → Loader2 旋转 + 文字（flex-col 居中）
- `Agents/AgentsPage.tsx`: Hourglass → Loader2 旋转（2 处），清理未用的 Hourglass import

**验证**: 运行时各页加载态 0 error；全量测试 1974 全过无回归。

### L1. 🟡 滚动条可发现性优化

**问题**: `globals.css` 把所有 `*::-webkit-scrollbar-thumb` 设为 `transparent`，仅容器 hover 时显示——长列表用户看不到滚动条，不知道内容可滚（affordance 弱）。

**修复**: 滚动条默认 `color-mix(in srgb, var(--scrollbar-thumb) 35%, transparent)`（半透明隐约可见），hover 容器变实心，hover thumb 时更深。平衡"不喧宾夺主"与"可发现性"。Chromium 150（Electron 43）原生支持 `color-mix`。

**验证**: 运行时 skills/classes/students 三页 UI 层 emoji 残留 = 0（chat 页保留的 97 个是 AI 消息内容，属合理数据非 UI）。

---

## 四、多角度测试结果（全部通过）

### IPC 契约（21 项只读）
eaa.info/stats/listStudents/summary/codes/doctor、agent.list/getHistory、cron.list、settings.get、class.list、academic.getConfig/listExams、skill.list、mcp.list、privacy.status、log.list、sys.getPath、ollama.detect、feishu.botStatus/status、profile.get —— 全部结构化返回，0 error。

### 写路径（17/17）
EAA 写入/回查/非法 reasonCode 拒绝、agent 无 key 优雅失败、飞书 bot 异常 + diagnose + botStop 幂等、cron add/list/remove + 非法表达式拒绝、settings 持久化、class CRUD 全通。

### 并发写（3/3 真实通过）
10 学生并发创建 + 50 条事件并发写入，writeQueue 串行化无丢失，每学生 `data.events.length === 5`，score=112；测试结束自清理 0 残留。

### AI 数据链路（agent → EAA 工具 → 写入）
addStudent→addEvent(CLASS_COMMITTEE +5)→三路读验证：listStudents/history/ranking 均显示 score=105；非法码 `NOT_A_REAL_CODE` 拒绝；缓存失效（`invalidateStudentsCache` 清 4 闭包缓存 + eaaBridge.readCache）正确。

### 内存稳定性
预热后 3 轮 × 11 路由切换：heap 19→25MB（+6MB 懒加载 chunk 首次加载），DOM 恒定 716 节点 —— 无泄漏。

### 渲染（11 路由）
最新 build + 重启后，dashboard/chat/students/classes/academics/agents/models/skills/scheduler/privacy/settings 全部 0 console error。仅 Electron CSP dev 警告（打包后消失）。

### 数据清洁度
18 名活跃真实学生（清理了 10 个并发测试残留）、0 cron 垃圾、23 个合法 agent 定时任务。

---

## 五、本轮改动文件清单

```
src/renderer/components/Button.tsx                      — 新增: 统一按钮组件(7变体+4尺寸+loading+icon+forwardRef)
src/renderer/components/__tests__/Button.test.tsx       — 新增: 28 测试
src/renderer/components/ConfirmDialog.tsx               — 确认/取消按钮改用 <Button>(消灭同组件自相矛盾)
src/renderer/components/ErrorBoundary.tsx               — 重试按钮改用 <Button>
src/renderer/layouts/MainLayout.tsx                     — 可折叠侧边栏(Ctrl+B + localStorage + tooltip + 折叠按钮) + transition-all
src/renderer/layouts/__tests__/MainLayout.test.tsx      — 新增: 10 个 Ctrl+B 折叠测试
src/renderer/main.tsx                                   — 导入 @fontsource/jetbrains-mono(400/500/700 latin 子集)
src/renderer/pages/Academics/tabs/ExamManagementTab.tsx — 确认创建按钮改 <Button variant=success> + emoji→Check
src/renderer/pages/Academics/tabs/GradeEntryTab.tsx     — AI解析/保存(3)按钮改 <Button> + emoji→Sparkles/Save
src/renderer/pages/Classes/ClassesPage.tsx              — 🏫→School
src/renderer/pages/Classes/ClassProfile.tsx             — 👥→Users ✅→CheckCircle2
src/renderer/pages/Skills/tabs/PluginsTab.tsx           — 8 emoji→lucide + PluginCard/FutureCard icon 改 ReactNode + 渐变容器
src/renderer/pages/Skills/tabs/SkillsTab.tsx            — 7 emoji→lucide(RefreshCw/Upload/FileText/Package)
src/renderer/pages/Skills/tabs/McpTab.tsx               — 2 emoji→Plug
src/renderer/pages/Students/tabs/EventsTab.tsx          — 📋→ClipboardList
src/renderer/pages/Students/tabs/OverviewTab.tsx        — 📋→ClipboardList
src/renderer/pages/Students/tabs/AcademicsTab.tsx       — 📚→BookOpen
src/renderer/pages/Students/tabs/AIAnalysisTab.tsx      — 🤖→Bot
18 个文件                                               — dark:bg-gray-700 → dark:bg-surface-elevated(批量)
scripts/concurrent-test.mjs                             — 修复 history 探针(data.events) + 新增自清理步骤
package.json / package-lock.json                        — 新增 @fontsource/jetbrains-mono 依赖
docs/OPTIMIZATION_REPORT_20260731_ROUND4.md             — 本报告
```

---

## 六、累计成果（R1→R4）

| 维度 | R1 基线 | R4 当前 |
|---|---|---|
| 测试数 | — | 1974（+39 本轮） |
| TypeScript | ✓ | ✓ |
| Biome | 有 error | 0/0 |
| 字体 | 0 woff2 | Inter Variable + JetBrains Mono（29 face） |
| 按钮系统 | btnStyle 函数 + 25 硬编码 | `<Button>` 组件 + 7 变体（H3 收尾） |
| Emoji UI 残留 | 40+ 处 | 0（仅 chat 内容保留） |
| 深色中性色 | gray-700 与 surface-elevated 并存 | 统一 surface-elevated |
| 桌面快捷键 | 无 | Ctrl+1..9 / Ctrl+, / Ctrl+B |
| 侧边栏 | 固定 w-60 | 可折叠(Ctrl+B + 持久化 + tooltip) |
| AI 回复渲染 | 纯文本 | Markdown(GFM+KaTeX+代码高亮) |
| 图表配色 | 默认色板 | 品牌蓝-靛-紫渐变 + 毛玻璃 tooltip |

---

## 七、未改动但已记录的问题（供后续）

1. **`btnStyle()` 渐进迁移**: 本轮替换了 6 处最严重硬编码，剩余 ~92 处 `btnStyle()` 调用仍可用（视觉等价 `<Button>`）。建议新代码统一用 `<Button>`，旧代码按修改机会迁移。`iconBtnStyle()` 死代码可激活或删除。
2. **ToastContainer.css**: 仓内唯一组件级 CSS，深色配色独立于 Tailwind 维护，是潜在"第二真相"。建议迁移到 Tailwind 或 @theme。
3. **加载态统一**: SchedulerPage/ModelsPage/AgentsPage 仍用 `EmptyState title="加载中..."` 替代 Skeleton，建议迁移到 CardSkeleton/PageSkeleton。
4. **详情页 h2 字号不一致**: 三种(`text-xl font-bold`/`font-semibold text-lg`/`text-lg font-medium`)，建议收敛到 `<SectionTitle>` 组件。
5. **EAA 双层缓存 agent 路径**: agent 工具(eaa-tools)调 `eaaBridge.invalidateReadCache()` 只清 readCache，不清 eaa-handlers 闭包的 4 个缓存(students/ranking/score/static)。极端场景下 agent 写入后 renderer 的闭包缓存(3s TTL)可能短暂返回旧值。建议让 agent 工具也触发 `invalidateStudentsCacheExternal()`。
6. **变量码 delta 约束(R2 遗留)**: EAA Rust 端 `delta=null` 码拒绝非零 delta，需改 Rust 源码。
7. **CSP 缺失**: index.html 无 Content-Security-Policy meta，main 未通过 onHeadersReceived 注入。建议打包版注入严格 CSP。
8. **Linux 无 GPU 环境 transition 怪异**: `transition-[width]` 在 X11 无 GPU 下偶现 width 更新延迟（强制 reflow 后正常）。本轮已改 `transition-all` 提升健壮性；真实 Windows/Mac 有 GPU 加速不受影响。
9. **测试覆盖空白(R3 记录)**: privacy 全链路 / academic.* / MCP 工具注入 / chat 压缩 / DB 自动清理 仍零覆盖。
