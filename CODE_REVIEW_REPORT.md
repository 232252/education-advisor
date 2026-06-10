# Education Advisor 代码审查报告

> 审查范围：`src/` 全部源码 + `config/` + `agents/` + IPC 链路 + i18n 文案
> 审查日期：2026-06-10
> 版本基准：v0.1.0-rc.1 (package.json) / v0.1.0 (README & about)

---

## 一、Bug（会导致功能异常或数据错误）

### Bug-1 【严重】`deleteStudent` 参数类型不匹配，导致删除请求参数结构错误

**位置**：`src/renderer/pages/Students/StudentsPage.tsx` 第79行  →  `src/main/preload/index.ts` 第177行

**现象**：
- `preload` 中 `deleteStudent` 签名是 `(name: string, reason?: string)`
- 但 `StudentsPage` 调用时传入的是对象：`getAPI().eaa.deleteStudent(name, { confirm: true, reason: '管理员操作' })`
- preload 实际发出的 IPC 请求会变成 `{ confirm: true, reason: { confirm: true, reason: '管理员操作' } }`
- `eaa-handlers.ts` 虽然期望 `{ confirm?: boolean; reason?: string }`，但 `reason` 字段被嵌套成了对象

**修复方案**：统一 preload 签名为 `(name: string, options?: { confirm?: boolean; reason?: string })`，与 handler 一致。

---

### Bug-2 【严重】分数趋势图 `cumulative` 从 0 累加，与实际分数基准 100 不符

**位置**：`src/renderer/pages/Students/StudentProfile.tsx` 第433-446行 (`OverviewTab.scoreTimeline`)

**现象**：
```ts
let cumulative = 0
// ...
cumulative += evt.score_delta
```
趋势图纵轴从 0 开始累加 `score_delta`。若学生初始分 100，先有 +2 再有 -3，趋势图显示 `0 → 2 → -1`，而实际分数是 `100 → 102 → 99`。

**修复方案**：
```ts
let cumulative = student.score - student.delta  // 反推初始基准分
// 或直接用 EAAInfoData 中的 base_score（需确认后端是否返回）
```

---

### Bug-3 【严重】`monthlyExam1Grades/monthlyExam2Grades` 前端迁移后后端不迁移，数据丢失

**位置**：
- 前端迁移：`src/renderer/pages/Students/StudentProfile.tsx` 第1111-1129行 (`migrateLegacyRecords`)
- 后端迁移：`src/main/services/profile-service.ts` 第145-163行 (`migrateLegacyData`)

**现象**：前端会读取 `monthlyExam1Grades`/`monthlyExam2Grades` 并显示，但 `profile-service.ts` 的 `set` 方法只迁移 `midtermGrades`/`finalGrades`。用户在学业页看到月考成绩后点击保存，后端不会将这些月考数据写入 `academicRecords`，导致数据丢失。

**修复方案**：在 `profile-service.ts` 的 `migrateLegacyData` 中同步添加 `monthlyExam1Grades`/`monthlyExam2Grades` 的迁移逻辑，与前端保持一致。

---

### Bug-4 【严重】Dashboard 英文模式下分数分布图 X 轴显示中文键名

**位置**：`src/renderer/pages/Dashboard/DashboardPage.tsx` 第167行 + `src/renderer/i18n/en.json` 第59-62行

**现象**：
- 后端 `EAAStatsData.score_intervals` 的键名是中文：`"极高(<60)"`、`"高(60-80)"` 等
- `DashboardPage` 的 `SCORE_ORDER` 使用这些中文键名直接作为图表数据
- 切换到英文模式后，图表 X 轴仍然显示中文，与 `en.json` 中定义的 `"High (80-100)"` 等翻译完全脱节

**修复方案**：
- 方案 A（推荐）：后端返回带语义 key 的结构（如 `{ "extreme": 5, "high": 3, ... }`），前端根据当前语言做映射
- 方案 B：前端在渲染图表时将中文键名通过硬编码映射表转为当前语言

---

### Bug-5 【中等】Dashboard `REASON_CODE_LABELS` 硬编码映射表与 `reason-codes.json` 可能不一致

**位置**：`src/renderer/pages/Dashboard/DashboardPage.tsx` 第41-64行

**现象**：`REASON_CODE_LABELS` 是一个纯前端硬编码对象，但原因码的真实来源是 `config/reason-codes.json`（由 `eaa.codes()` 返回）。当管理员修改 `reason-codes.json` 后，Dashboard 的"事件原因分布"仍显示旧标签。

**修复方案**：直接使用 `eaa.codes()` 返回的 `label` 字段，移除 `REASON_CODE_LABELS` 硬编码表。

---

### Bug-6 【中等】`eaa-bridge.execute` Promise 可能被 resolve 两次

**位置**：`src/main/services/eaa-bridge.ts` 第372-452行

**现象**：`proc.on('error', ...)` 和 `proc.on('close', ...)` 都会调用 `resolve`。虽然 Node.js EventEmitter 允许多次 emit 同一个事件，但如果进程先触发 `error` 再触发 `close`，Promise 会被 resolve 两次。虽然不会抛异常，但行为不可预期。

**修复方案**：使用一个 `resolved` 标志位 guard，确保只 resolve 一次。

---

### Bug-7 【中等】`profile-service.get` 双路径读取时可能丢失未迁移数据

**位置**：`src/main/services/profile-service.ts` 第166-179行

**现象**：同时检查 `anoPath`（化名路径）和 `filePath`（真名路径），但优先使用 `anoPath`。如果用户曾经用真名路径保存过旧格式数据，启用隐私引擎后 `anoPath` 是新文件，旧数据永远不会被迁移。

**修复方案**：如果两个文件都存在，应合并数据（旧数据做迁移后合并到新数据中）。

---

### Bug-8 【中等】学业成绩 0 分被当作"无数据"处理

**位置**：`src/renderer/pages/Students/StudentProfile.tsx` 第1132-1133行、第1142-1143行、第1468-1469行

**现象**：
```ts
if (score != null && !Number.isNaN(score) && score > 0)  // 排除 0 分
// ...
{rec.subjects[sub] != null && rec.subjects[sub] > 0 ? rec.subjects[sub] : '-'}  // 0 分显示为 '-'
```
学生某科目考 0 分（或缺考标记为 0）时，表格显示 `'-'`，平均分和趋势图也排除该数据。

**修复方案**：区分"未录入"（`null`/`undefined`）和"0 分"（`0`）。显示逻辑应为 `!= null` 而非 `> 0`。

---

## 二、功能缺陷（功能不完整或设计不合理）

### Defect-1 【高】`IPC_PROFILE_ADD_ACADEMIC` / `IPC_PROFILE_GET_ACADEMIC` 是死链

**位置**：`src/shared/ipc-channels.ts` 第101-103行

**现象**：定义了两个 IPC 通道常量，但 `profile-handlers.ts` 中没有注册对应的 handler，`preload` 和 `ipc-client.ts` 也没有暴露对应方法。`profile-service.ts` 中虽然实现了 `addAcademicRecord` / `getAcademicRecords`，但没有任何入口可以调用。

**修复方案**：要么补齐 IPC handler + preload 暴露 + 前端调用，要么删除这些死代码和常量。

---

### Defect-2 【高】`PII_FIELDS` 未覆盖全部档案字段，敏感信息可能未脱敏

**位置**：`src/main/services/profile-service.ts` 第43-48行

**现象**：`PII_FIELDS` 列表缺少 `email`、`fatherName`、`motherName`、`fatherPhone`、`motherPhone`、`studentNumber`、`dormNumber`、`bedNumber`、`bloodType`、`allergy`、`specialNeeds`、`honors`、`punishments` 等字段。这些字段在 `ProfileTab` 中可编辑并保存，但不会被隐私引擎脱敏。

**修复方案**：扩展 `PII_FIELDS` 以覆盖 `ProfileTab` 中所有可能包含敏感信息的字段，或改用动态扫描所有字符串字段。

---

### Defect-3 【高】AI 分析 prompt 硬编码中文，英文模式下仍发送中文

**位置**：`src/renderer/pages/Students/StudentProfile.tsx` 第165行、第208行

**现象**：`runSelectedAgents` 和 `runAllAgents` 中构造的 prompt 完全是中文：
```ts
const prompt = `请分析学生"${student.name}"的操行情况...`
```
当 UI 切换到英文模式时，发送给 LLM 的 prompt 仍然是中文，导致非中文模型输出质量下降。

**修复方案**：将 prompt 模板提取到 i18n 中，根据当前语言动态切换。

---

### Defect-4 【中】学生列表搜索大小写敏感

**位置**：`src/renderer/pages/Students/StudentsPage.tsx` 第159-164行

**现象**：
```ts
s.name.includes(search) || s.groups.some((g) => g.includes(search))
```
搜索 "张" 能找到 "张三"，但搜索 "zhang" 找不到 "Zhang"（如果数据中有英文名）。

**修复方案**：统一转为小写后再匹配。

---

### Defect-5 【中】每个学生的 Profile 加载时重复请求 `agent.list()`

**位置**：`src/renderer/pages/Students/StudentProfile.tsx` 第107-112行

**现象**：`loadAllData` 中每次都会 `getAPI().agent.list()`，但 agent 列表是全局数据，已在 `MainLayout` 中加载。切换学生时这个请求被重复发送。

**修复方案**：`agent.list()` 的结果通过 props 或全局 store 传入，不再在 `loadAllData` 中请求。

---

### Defect-6 【中】`MainLayout` 侧边栏只显示前 6 个 agent 状态

**位置**：`src/renderer/layouts/MainLayout.tsx` 第67行

**现象**：`agents.slice(0, 6)` 硬编码截断。如果启用的 agent 超过 6 个，用户无法从侧边栏看到其余 agent 的运行状态。

**修复方案**：改为可折叠列表或滚动区域，显示全部 agent。

---

### Defect-7 【中】事件日期范围搜索逻辑不完整

**位置**：`src/renderer/pages/Students/StudentProfile.tsx` 第909-942行

**现象**：`performSearch` 中只有当 `start && end` 时才执行 `range` 查询。如果用户只选了开始日期没有选结束日期（或反之），不会执行任何范围查询，也不会给出提示。

**修复方案**：
- 单选开始日期时默认结束日期为今天
- 或给出提示要求同时选择起止日期

---

### Defect-8 【低】`deanonymizeName` 被用于任意文本字段，语义不匹配

**位置**：`src/main/services/profile-service.ts` 第184-191行

**现象**：`address`（地址）、`comments`（备注）等字段可能包含多行文本，但调用的是 `deanonymizeName`，该函数调用隐私引擎的 `deanonymize` 命令。如果隐私引擎的 `deanonymize` 只支持单个人名还原，长文本中的多处化名可能无法全部还原。

**修复方案**：确认 EAA CLI 的 `privacy deanonymize` 命令是否支持长文本批量还原；如果不支持，需要逐词扫描或改用 `privacy filter` 命令。

---

## 三、功能优化方向（可行且能显著提升体验）

### Optimize-1 【高】学业成绩支持批量录入 / Excel 导入

**现状**：目前只能逐科、逐考试手动输入分数。

**优化方案**：
- 提供"粘贴表格"功能：用户从 Excel 复制多行数据，粘贴后自动解析为成绩记录
- 提供"导入模板下载"：生成标准 Excel 模板，用户填好后导入
- 支持常见的成绩表格式识别（如智学网、好分数等导出格式）

**关联模块**：`AcademicsTab` → `profile-service` → 新增 `import-academic` IPC

---

### Optimize-2 【高】学业成绩添加"总分/满分"和"百分比"列

**现状**：表格只有各科原始分和平均分，没有总分概念。不同考试满分不同（如周考 100 分，月考 150 分），直接比较原始分不合理。

**优化方案**：
- 每行考试记录增加"满分"字段（默认可配置，如 100/150/750）
- 自动计算"总分"和"得分率 %"
- 趋势图支持按"得分率"统一展示，消除不同考试满分差异

---

### Optimize-3 【高】学业与操行数据在 AI 分析中打通

**现状**：`runSelectedAgents` 的 prompt 只包含操行信息（分数、风险、事件数），完全不涉及学业成绩。

**优化方案**：
- 若学生有 `academicRecords`，自动将最近 3 次考试的各科得分率、排名变化、偏科分析结果追加到 prompt 中
- AI 分析维度增加"学业-操行关联分析"（如：学业下滑是否伴随操行扣分增加）

**关联模块**：`StudentProfile` → `AIAnalysisTab` → `agent.runManual`

---

### Optimize-4 【中】成绩表格支持排序和筛选

**现状**：成绩表格按 `records` 数组顺序显示，无法按考试时间或总分排序。

**优化方案**：
- 表头点击排序（按日期、按总分、按某科目分数）
- 支持按考试类型筛选（只看月考/只看期中期末）

---

### Optimize-5 【中】支持"缺考/免考"标记，与 0 分区分

**现状**：`null`/空值和 0 分都显示为 `'-'`。

**优化方案**：
- 输入框旁增加下拉标记：正常分数 / 缺考 / 免考 / 未录入
- 缺考在平均分和趋势图中以特殊标记显示（如断开点），不计入平均分

---

### Optimize-6 【中】成绩趋势图支持缩放和平移

**现状**：`echarts` 趋势图固定高度 280px，X 轴标签超过 6 个时自动旋转。

**优化方案**：
- 启用 `dataZoom` 组件，支持拖拽查看历史区间
- 支持切换显示模式：原始分 / 得分率 / 班级排名变化

---

### Optimize-7 【中】学生档案支持导入/导出（JSON/Excel）

**现状**：档案数据存储在 `eaa-data/profiles/{name}.json`，只能在应用内编辑。

**优化方案**：
- 档案页增加"导出档案"按钮（含基础信息 + 学业记录 + 操行事件摘要）
- 支持从其他学生的档案导入学业记录（用于同班批量录入后复制到个人）

---

### Optimize-8 【低】学业编辑支持自动保存（防抖）

**现状**：用户修改分数后必须点击"保存"按钮，否则数据丢失。

**优化方案**：
- 输入框失去焦点或停止输入 2 秒后，自动调用 `profile.set` 保存
- 保存失败时显示红色提示，允许用户手动重试

---

## 四、链路通断检查

| 链路 | 路径 | 状态 | 备注 |
|------|------|------|------|
| 学生列表加载 | `StudentsPage` → `eaa.listStudents` → `eaa-bridge` → Rust CLI | ✅ 通 | — |
| 学生详情加载 | `StudentProfile` → `eaa.score`/`history`/`codes` → `eaa-bridge` | ✅ 通 | `agent.list()` 重复调用见 Defect-5 |
| 档案读写 | `ProfileTab` → `profile.get`/`set` → `profile-service` → JSON | ✅ 通 | PII 脱敏不完整见 Defect-2 |
| 学业记录保存 | `AcademicsTab` → `profile.set` → `profile-service` → 校验 → 存储 | ✅ 通 | 前端/后端迁移不一致见 Bug-3 |
| 事件添加 | `AddEventInline` → `eaa.addEvent` → `eaa-bridge` → Rust CLI | ✅ 通 | — |
| 事件撤销 | `EventsTab` → `eaa.revertEvent` → `eaa-bridge` | ✅ 通 | — |
| 事件搜索/范围 | `EventsTab` → `eaa.search`/`range` → `eaa-bridge` | ✅ 通 | 单日期搜索不完整见 Defect-7 |
| AI 对话 | `ChatPage` → `ai.chat` → `pi-ai-service` | ✅ 通 | prompt 未国际化见 Defect-3 |
| Agent 运行 | `AgentStore` → `agent.runManual` → `agent-service` → `pi-agent-core` | ✅ 通 | — |
| 定时任务 | `cron-service` → `node-cron` → `agent-service` | ✅ 通 | — |
| 飞书同步 | `feishu-service` | ⚠️ 未深度验证 | 需实际配置后测试 |
| 日志系统 | `log-handlers` → 文件系统 | ✅ 通 | — |
| 隐私引擎 | `privacy-handlers` → `eaa-bridge` → `privacy` | ✅ 通 | `deanonymize` 长文本支持待验证见 Defect-8 |
| 设置读写 | `settings-handlers` → `settings-service` | ✅ 通 | — |
| 学业记录独立 IPC | `IPC_PROFILE_ADD_ACADEMIC` / `IPC_PROFILE_GET_ACADEMIC` | ❌ 断链 | 有常量无 handler 见 Defect-1 |
| Dashboard 统计 | `DashboardPage` → `eaa.stats`/`summary`/`ranking`/`info`/`tag` | ✅ 通 | 英文 i18n 与数据键名不匹配见 Bug-4 |
| 更新检查 | `update-service` → GitHub Releases | ✅ 通 | — |

---

## 五、模块联系缺失（应该关联但未关联）

### 缺失-1：学业成绩 ↔ Dashboard 概览

**现状**：Dashboard 完全基于操行数据（EAA），学生的学业成绩（`academicRecords`）没有任何展示入口。

**建议**：Dashboard 增加"学业概览"卡片区域：
- 班级平均分对比（若多个学生有同一次考试记录）
- 近期考试参与率
- 偏科预警学生列表（基于学业数据而非操行数据）

---

### 缺失-2：学业成绩 ↔ AI 分析

**现状**：见 Optimize-3。AI 分析 prompt 完全不包含学业信息。

**建议**：当学生有学业记录时，自动将以下信息注入 prompt：
- 最近 3 次考试的总分/满分/得分率变化趋势
- 最强/最弱科目
- 班级排名/年级排名变化

---

### 缺失-3：学业成绩 ↔ 排行榜

**现状**：排行榜（ranking）只按操行分数排序。

**建议**：在学业页增加"学业排行榜"子视图：
- 按某次考试的总分排名
- 按某科目的分数排名
- 按得分率进步幅度排名

---

### 缺失-4：操行事件 ↔ 学业时间关联

**现状**：操行事件和学业记录是两个完全独立的数据维度。

**建议**：
- 在学业趋势图上叠加操行事件标记（如在考试日期前后显示加分/扣分事件）
- 帮助教师直观看到"考试前违纪是否影响成绩"

---

### 缺失-5：周报 agent ↔ 学业数据

**现状**：`weekly-reporter` agent 的 capabilities 只有 `read`/`summary`/`stats`/`ranking`/`range`，都是操行维度的工具。

**建议**：
- 为 `weekly-reporter` 增加读取学业数据的工具（如 `get-academic-summary`）
- 周报内容增加"本周学业动态"章节

---

## 六、文字/文案统一性问题

### Text-1：硬编码中文与 i18n 混用

**位置**：以下位置直接写死中文，未走 i18n：
- `StudentsPage.tsx` 第98行：`title: '选择导入文件'`
- `StudentsPage.tsx` 第126行：`title: '导出排名'`
- `StudentsPage.tsx` 第89行：`setActionMessageAuto('删除失败')`
- `StudentProfile.tsx` 第141行：`setAiMessageAuto('请至少选择一个Agent')`
- `StudentProfile.tsx` 第948行：`if (!confirm('确定要撤销此事件吗？撤销后分数将回退。'))`
- `StudentProfile.tsx` 第1241行：`setValidationMsg(`${rec.examName} - ${sub}: 分数无效 (0-300)`)`
- `DashboardPage.tsx` 第362、401、519、767行：`'暂无数据'`

**修复方案**：全部提取到 `zh.json` / `en.json`。

---

### Text-2：i18n key 与后端数据键名紧耦合

**位置**：`zh.json` / `en.json` 中的 `page.dashboard.scoreRange.*`

**现象**：后端 `score_intervals` 的键名是中文硬编码字符串（如 `"极高(<60)"`），前端的 i18n 为了匹配图表显示，key 名直接用了这些中文字符串的翻译。英文模式下后端仍返回中文键名，导致图表显示异常（Bug-4）。

**修复方案**：后端改用结构化 key，前端做语义映射。

---

### Text-3：版本号不一致

**位置**：
- `package.json`: `"version": "0.1.0-rc.1"`
- `README.md`: `v0.1.0 release`
- `zh.json` / `en.json` `"about.appName"`: `Education Advisor v0.1.0`

**建议**：统一为 `0.1.0-rc.1`，发布正式版时再统一改为 `0.1.0`。

---

### Text-4：`status.*` 与 `common.*` 语义重复

**位置**：
- `zh.json`: `"status.success": "操作成功"` vs `"common.success": "成功"`
- `zh.json`: `"status.failed": "操作失败"` vs `"common.error": "错误"`

**建议**：合并为一套，减少维护成本。`status.*` 用于操作结果反馈，`common.*` 用于通用标签。

---

### Text-5：大小写/标点不统一

**位置**：
- `zh.json` 中部分翻译使用中文冒号（如 `"page.dashboard.summary.up": "加分事件"` 后的冒号在前端代码中拼接）
- `en.json` 中 `"page.student.academics.examType": "Monthly"` 与实际 select 选项中的中文值 `"月考"` 不对应
- 部分按钮文字带 emoji（如 `"page.student.tab.overview": "📊 概览"`），部分不带

**建议**：
- emoji 统一放到组件代码中，i18n 只存纯文本
- 英文模式下 `newExamType` 默认值应从 i18n 读取而非硬编码 `'月考'`

---

## 七、附录：快速修复清单（按优先级排序）

| # | 问题 | 文件 | 预估工作量 |
|---|------|------|-----------|
| 1 | Bug-1: deleteStudent 参数类型修复 | `preload/index.ts` + `StudentsPage.tsx` | 10 分钟 |
| 2 | Bug-2: 趋势图 cumulative 从 100 开始 | `StudentProfile.tsx` | 10 分钟 |
| 3 | Bug-3: 后端同步 monthlyExam 迁移 | `profile-service.ts` | 15 分钟 |
| 4 | Bug-8: 0 分显示为 '-' | `StudentProfile.tsx` (3 处) | 15 分钟 |
| 5 | Bug-4: Dashboard 英文键名映射 | `DashboardPage.tsx` + 后端 | 30 分钟 |
| 6 | Defect-1: 删除死链 IPC 或补齐 handler | `ipc-channels.ts` + `profile-handlers.ts` | 20 分钟 |
| 7 | Defect-2: 扩展 PII_FIELDS | `profile-service.ts` | 10 分钟 |
| 8 | Defect-3: AI prompt 国际化 | `StudentProfile.tsx` + `zh.json` + `en.json` | 30 分钟 |
| 9 | Defect-4: 搜索大小写不敏感 | `StudentsPage.tsx` | 5 分钟 |
| 10 | Bug-5: 移除 REASON_CODE_LABELS 硬编码 | `DashboardPage.tsx` | 15 分钟 |
| 11 | Bug-6: Promise 重复 resolve guard | `eaa-bridge.ts` | 10 分钟 |
| 12 | Text-1: 硬编码中文提取到 i18n | 多个文件 | 40 分钟 |
| 13 | Optimize-1: 学业批量导入 | `AcademicsTab` + `profile-service` | 2-3 小时 |
| 14 | Optimize-2: 总分/满分/得分率 | `AcademicsTab` + 类型定义 | 1-2 小时 |
| 15 | Optimize-3: AI 分析接入学业数据 | `StudentProfile.tsx` + agent prompt | 1 小时 |
