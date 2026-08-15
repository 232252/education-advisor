# 优化报告 — 2026-07-31 第 3 轮（自主测试与优化）

> 范围: 用户午休期间自主进行的全面测试与优化
> 基线: 第 2 轮报告 (OPTIMIZATION_REPORT_20260731_ROUND2.md) 之后
> 测试方式: 多代理并行调研 + CDP 实时调试 + 全量回归 + 运行时 DOM/像素验证

---

## 一、质量门禁（全绿）

| 检查 | 基线(R2) | 本轮 | 结果 |
|---|---|---|---|
| TypeScript `tsc --noEmit` | ✓ | ✓ | 通过 |
| Biome lint | 1 error | **0 error / 0 warning** | 通过（清理 3 处死代码 + 修复 AppLogo forEach） |
| 全量 build（main+renderer） | ✓ | ✓ | 通过 |
| 全量测试 | 101 文件 / 1893 | **106 文件 / 1935**（+42 新测试） | 通过 |
| CDP 实时 IPC 验证 | 22 项 | 22 项全通过 | 通过 |
| 写路径功能测试 | 17 项(脚本有 bug) | **17/17 真实通过**（修正脚本后） | 通过 |
| Agent 数据链路 | ✓ | 读写一致性三路验证 | 通过 |
| 内存稳定性 | ✓ | 预热后 +1MB / DOM 恒定 | 无泄漏 |
| 数据清洁度 | 18 学生/0 残留 | 18 学生/0 残留/0 cron 垃圾 | 干净 |

---

## 二、本轮发现并修复的问题

### 1. 🟠 测试基础设施缺陷（导致前轮"假失败"，影响信心）

前两轮的 write-path-test.mjs 报告了 7 项"失败"，**经逐一对照 preload 真实签名，全部是测试脚本的 API 误用**，产品本身正常。修正后 17/17 真实通过：

| # | 测试脚本错误调用 | 真实签名（preload） | 性质 |
|---|---|---|---|
| 1 | `eaa.addStudent({name})` | `addStudent(name: string)` | 脚本 bug |
| 2 | `eaa.addEvent({name, code, ...})` | `addEvent({studentName, reasonCode, delta?, note?})` | 脚本 bug（字段名错） |
| 3 | `eaa.search({query})` | `search(query: string, limit?)` | 脚本 bug |
| 4 | `cron.add({id,...})` 后用自传 id 查 list | handler 自动生成 id 并返回 | 脚本 bug（未用返回 id） |
| 5 | `cron.remove({id})` | `remove(id: string)` | 脚本 bug |
| 6 | `class.create({classId})` | `create({class_id})`（snake_case） | 脚本 bug |
| 7 | `class.delete({classId})` | `delete(id: string)`（UUID） | 脚本 bug |
| 8 | `feishu.diagnose` 断言 `success===true` | 返回 `{steps, overall, ...}` 无 success 包装 | 断言 bug |

**附带修复**:
- `cdp-eval.mjs --await`: 顶层 `await` 在 Runtime.evaluate 非 module 上下文抛 SyntaxError → 改为 `--await` 时包进 async IIFE；并修正"已含 async IIFE 时被错误二次包裹"的边界（`;(async()=>{})()` 现在正确工作）
- `ipc-contract-test.mjs`: `eaa.summary({})` → `eaa.summary()`（位置参数，R2 已知非产品 bug，本轮直接修正脚本）
- write-path-test 新增第 13 步：自创测试学生用完即软删，零残留

### 2. 🟢 ranking"假 bug"排查（确认非 bug）

排查中发现"写入事件后 ranking 看不到新学生"，深入后确认是**探针字段名写错**：ranking 返回 `data.ranking` 而非 `data.students`。修正探针后验证：addStudent→addEvent(+5) 后，**listStudents / history / ranking 三路读路径全部正确显示 score=105**，写→读一致性扎实。缓存失效逻辑（`invalidateStudentsCache` 同步清 `rankingCache`/`scoreCache`/`staticCache`）正确。

### 3. 🟢 死代码清理

- `AppLogo.tsx`: `rounded` prop 与衍生 `r` 变量从未使用（SVG 用字面 `r="72"`）→ 移除 prop + 变量
- `DashboardPage.tsx`: 图表 tooltip 改用 `chartTheme.tooltipOption` 后，`theme`/`isDark`/`useTheme` import 全部成为死代码 → 移除
- `AppLogo.test.tsx`: `forEach` 回调返回 Set.add 的值 → biome 报错，改为块语句

---

## 三、UI 美化与好用特性（用户重点诉求）

### H2. 🔴 Chat AI 回复渲染 Markdown（本轮最大改进）

**问题**: `react-markdown`/`remark-gfm`/`remark-math`/`rehype-katex`/`shiki` 全部已装但 **src/ 中零使用** —— AI 回复的标题/列表/表格/代码块/公式全部当成纯文本显示（`whitespace-pre-wrap`），严重影响专业感。

**修复**:
- 新建 `src/renderer/components/Markdown.tsx`：react-markdown + GFM(表格/删除线/任务列表) + 数学公式(KaTeX，含 katex.min.css 引入) + 行内/块级 code 区分 + 链接强制 `target=_blank rel=noopener`
- ChatPage: 助手消息用 `<Markdown>`，用户消息保持纯文本；流式时的"三个点" loading 保留
- 新增 `vendor-markdown` chunk（128KB gzip），按需加载，不拖累首屏

**验证**: 11 个单元测试（标题/列表/表格/删除线/任务列表/链接安全/代码块）全通过；build 成功；运行时 chat 页 0 error。

### M3. 🟠 图表品牌色板 + 统一 tooltip（Dashboard 首屏可见）

**问题**: ECharts 用默认色板（`#5470c6/#91cc75/...`）与应用蓝-靛-紫品牌渐变毫无关系；tooltip 的 `backgroundColor/borderColor` 在多处重复硬编码，无圆角/阴影/毛玻璃。

**修复**:
- `useChartTheme.ts`: 色板换成品牌系 `[#3b82f6, #6366f1, #8b5cf6, #06b6d4, #22c55e, #eab308, #f97316, #ef4444]`（蓝→靛→紫→青→绿→琥珀→橙→红，与 AppLogo 呼应）
- 新增 `tooltipOption`（半透明背景 + backdrop-filter blur 10px + box-shadow + borderRadius 10 + 主题色文字），Dashboard 两处图表迁移到此统一配置
- 新增 `tooltipBg/tooltipBorder/tooltipText` token

**验证**: 7 个单元测试（品牌色板/8 色/毛玻璃/圆角/明暗主题）全通过；运行时 Dashboard 24 个 SVG 渲染、0 error 文本。

### H6. 🟠 Loading spinner（反馈可见性）

**问题**: Dashboard 的 doctor/validate 按钮加载态只是把文字换成"运行中…"，无视觉反馈。

**修复**: 加载态显示 lucide `Loader2` 旋转图标（`animate-spin`），复用 btnStyle 已有的 `inline-flex gap-1.5` 自动对齐。

### H5. 🔴 桌面级全局键盘快捷键（"桌面感 vs 网页感"分水岭）

**新增**:
- `Ctrl/Cmd + 1..9` → 切换前 9 个侧栏导航（dashboard/chat/students/classes/academics/agents/models/skills/scheduler）
- `Ctrl/Cmd + ,` → 设置页（业界惯例）
- 输入框/文本域/下拉/可编辑元素聚焦时不触发（保护打字）
- 前 9 个导航项右侧加 `<kbd>` 数字徽章，hover 时浮现（可发现性）

**验证**: 9 个单元测试（各数字/修饰键/输入保护/边界）全通过；运行时 CDP 实测 Ctrl+2→#/chat、Ctrl+,→#/settings、无修饰键忽略，全部正确。

### M5. 🟠 Chat 消息头像 + hover 复制按钮（最常用交互）

**新增**:
- 助手消息左侧加 **AI 头像**（蓝靛渐变方块 + lucide `Bot` 图标，与 AppLogo 品牌一致）
- 助手消息下方加 **复制按钮**，hover 时浮现（opacity-0 → group-hover:opacity-100）；点击调用 `navigator.clipboard.writeText`，文案切换为 ✓"已复制"1.5s 后回切
- 流式中的最后一条不显示复制按钮（内容还在变）
- 用户消息无头像（右对齐保持不变）

**验证**: 4 个 ChatPage 组件测试（头像渲染/复制按钮存在/点击调用 clipboard 传入助手内容/用户消息无头像）全通过。需 mock chatStore(Proxy 兜底所有 action) + agentStore.getState().subscribeStatus + jsdom scrollIntoView stub。

### M5b. 🟠 AgentsPage 执行输出也用 Markdown（agent 报告含标题/列表/表格）

**问题**: Chat 已修，但 AgentsPage 的「执行 Tab 实时输出」和「历史 Tab 展开输出」仍是 `<pre>` 纯文本 —— agent 报告是 markdown 密集的（标题/列表/表格/代码块），显示成原文严重影响可读性。

**修复**: 两处都改用 `<Markdown>` 组件渲染（与 Chat 一致）。历史输出区从 `max-h-40` 增到 `max-h-60`，空输出显示「（无输出）」占位。

**验证**: typecheck/build 通过；运行时 agents 页 0 error、agent 列表正常。

### L6. 🟡 Logo 状态点反映真实 agent 状态（"活"起来）

**问题**: 侧边栏 Logo 右上角状态点恒亮 emerald 绿灯，与应用内 `agentStatusColor(idle/running/error)` 体系脱节 —— 误导（永远"正常"）。

**修复**: `AppLogo` 新增 `status?: 'idle'|'running'|'error'` prop：running→蓝+脉冲光晕、error→红+光晕、idle→绿。MainLayout 传聚合状态（有 error→红，有 running→蓝，否则绿）。

**验证**: 3 个新测试（running 蓝/error 红/idle 绿）+ 运行时 CDP 实测状态点为 `bg-emerald-400`（idle，无 agent 运行）。

### H1. 🔴 字体加载（"好看"的地基）

**问题**: `--font-sans` 首位声明 Inter、`--font-mono` JetBrains Mono，但 index.html 无 `<link>`、全仓无 woff2 —— Windows 上西文/数字实际回退到微软雅黑的西文字形（呆板），`font-feature-settings: cv02/cv03/cv11`（Inter 专属字形）完全失效。

**修复**: 安装 `@fontsource-variable/inter`（纯 CSS+woff2，平台无关、同步安全），在 `main.tsx` 早于 globals.css 导入；`--font-sans` 首位改为 `"Inter Variable"`。CJK 仍走系统字体（PingFang/微软雅黑）。

**验证**: build 成功打包 26 个 woff2 子集（含 latin）；运行时 `document.fonts.check('16px "Inter Variable"')` → `true`，7 个 face 注册（按 unicode-range 按需解码，运行时只加载 latin 子集）。`font-display: swap` 保证不阻塞首屏。

### M6. 🟠 Chat 输入框自动增高

**问题**: 输入框固定 1 行（`rows={1} max-h-32`），超出即滚动，多行指令体验差。

**修复**: 加 `inputRef` + useEffect 在 `input` 变化时按 `scrollHeight` 调高度（上限 160px≈6 行），发送后清空自动复位；加 `transition-[height] duration-100` 平滑过渡。

**验证**: 运行时 CDP 实测 31px(1 行)→145px(6 行)增长、清空复位 31px，`grew`/`resetWorked` 均 true。

### L7. 🟡 数字千分位格式化

**问题**: 大数字（事件数 34922、撤销数 1000）无千分位，可读性差。

**修复**: DashboardStatCard 加 `formatStat()`：数字与纯数字字符串加千分位（34922→34,922、"1234.5"→1,234.5），非数字（"10/18"、"未设置"、"-"）保持不变。

**验证**: 8 个测试（大数/小数/负数小数/比值/中文/占位符）全通过；运行时 Dashboard stat 实测 "1,000"。

### M9. 🟡 emoji 图标统一为 lucide（跨平台一致性）

**问题**: Students 页 + 按钮/导入/导出用 `📥📤☑⚠+`，EventCard 用 `📝↩▲▼` —— emoji 在 Win/macOS/Linux 渲染风格迥异，破坏一致性；项目已依赖 lucide-react。

**修复**: StudentsPage 头部按钮 + 批量选择 + 班级缺失警告 → lucide（Plus/Upload/Download/CheckSquare/AlertTriangle）；EventCard 备注/撤销/展开箭头 → lucide（StickyNote/RotateCcw/ChevronUp/ChevronDown）。

**验证**: typecheck/build/lint 通过；运行时 Students 页 4 个 SVG 图标正常渲染、0 error。

---

## 四、多角度测试结果（全部通过）

### AI Agent 数据调用链
- 只读: info/stats/ranking/codes/listStudents **(读路径字段已纠正为 data.ranking)**
- 写入: addStudent→addEvent(CLASS_COMMITTEE +5)→deleteStudent 全通
- 一致性: 写入后 listStudents/history/ranking **三路均显示 score=105**
- 非法码拒绝: `未知原因码: NOT_A_REAL_CODE` ✓

### IPC 契约（22 项）
全部正常返回，0 console error（11 路由遍历）。`eaa.summary()` 无参调用正确返回。

### 写路径（17/17 真实通过）
EAA 写入/回查/非法拒绝、agent 无 key 优雅失败、飞书 bot 异常处理 + diagnose 全 pass + botStop 幂等、cron add/list/remove 闭环、cron 非法表达式拒绝、settings 持久化、class CRUD 全通。

### 内存稳定性
预热后 10 轮路由切换：heap 17→18MB（**+1MB**），DOM 恒定 704 节点 —— **无泄漏**。（注：perf-check.mjs 不预热时报"可能泄漏"是首次懒加载 chunk 的良性缓存，非真实泄漏。）

### 渲染/页面
11 路由 0 error，仅 Electron CSP dev 警告（打包后消失）。Dashboard 数据加载（1638 事件）、24 SVG 渲染、图表标题齐全、无 error/undefined/NaN 文本。

### 数据清洁度
18 名活跃真实学生、0 测试残留、0 cron 垃圾、23 个合法 agent 定时任务。doctor 唯一 issue 是历史压测"单分钟 896 事件"痕迹（数据完好，非损坏）。

---

## 五、本轮改动的文件清单

```
src/renderer/components/Markdown.tsx              — 新增: Markdown 渲染组件(GFM+KaTeX+链接安全)
src/renderer/components/__tests__/Markdown.test.tsx — 新增: 11 测试
src/renderer/pages/Agents/AgentsPage.tsx      — 执行实时输出 + 历史输出改用 Markdown 渲染
src/renderer/pages/Chat/ChatPage.tsx              — 助手消息用 Markdown 渲染 + AI 头像 + hover 复制按钮 + 输入框自动增高
src/renderer/pages/Chat/__tests__/ChatPage.test.tsx — 新增: 4 测试(头像/复制/clipboard/用户无头像)
src/renderer/main.tsx                             — 导入 @fontsource-variable/inter(Inter Variable 主字体)
src/renderer/styles/globals.css                   — --font-sans 首位改为 "Inter Variable"
src/renderer/hooks/useChartTheme.ts               — 品牌色板 + tooltipOption(毛玻璃)
src/renderer/hooks/__tests__/useChartTheme.test.tsx — 新增: 7 测试
src/renderer/pages/Dashboard/DashboardPage.tsx    — 图表迁移统一 tooltip + loading spinner + 清理死 isDark/useTheme
src/renderer/pages/Dashboard/components/DashboardStatCard.tsx — 数值千分位格式化(formatStat)
src/renderer/pages/Dashboard/components/__tests__/DashboardStatCard.test.tsx — 新增: 8 测试
src/renderer/pages/Students/StudentsPage.tsx           — 头部按钮 emoji→lucide(Plus/Upload/Download/CheckSquare/AlertTriangle)
src/renderer/pages/Students/components/EventCard.tsx   — 备注/撤销/展开 emoji→lucide(StickyNote/RotateCcw/ChevronUp/Down)
src/renderer/layouts/MainLayout.tsx               — 全局键盘快捷键 + kbd 徽章 + Logo 状态点接 agent 聚合状态
src/renderer/layouts/__tests__/MainLayout.test.tsx — 新增: 9 测试
src/renderer/components/AppLogo.tsx               — 新增 status prop(蓝脉冲/红/绿) + 移除未用 rounded prop/r 变量
src/renderer/components/__tests__/AppLogo.test.tsx — 修复 forEach lint 错误 + 新增 3 status 测试
scripts/cdp-eval.mjs                              — 修复 --await 顶层 await + async IIFE 二次包裹
scripts/ipc-contract-test.mjs                     — 修正 eaa.summary 调用
scripts/write-path-test.mjs                       — 修正 7 处 API 误用 + diagnose 断言 + 自清理
docs/OPTIMIZATION_REPORT_20260731_ROUND3.md       — 本报告
```

## 六、未改动但已记录的问题（供后续）

1. **字体未加载(H1)**: `--font-sans` 首位声明 Inter / `--font-mono` JetBrains Mono，但 index.html 无 `<link>`、全仓无 woff2 —— Windows 上西文实际回退到微软雅黑的西文部分。需打包字体子集或用 @fontsource（增加二进制资源，本轮未做）。
2. **按钮系统未统一(H3)**: 存在 `btnStyle()` + 至少 5 套内联按钮实现（green/purple/emerald/rose），颜色绕过品牌蓝体系。建议升级为 `<Button>` 组件 + success/warning 变体。
3. **Tab 组件复制 5 次(M1)** / **Dashboard 标题+小圆点复制 8 次(M2)** —— 抽公共组件可收敛。
4. **变量码 delta 约束**: EAA Rust 端 `delta=null` 码拒绝非零 delta（R2 已记录，需改 Rust 源码）。
5. **GPU 退出 SIGTRAP / X11 强杀卡死**: Linux 无 GPU 环境的已知行为，非代码问题；开发时避免 `pkill -9` electron。
