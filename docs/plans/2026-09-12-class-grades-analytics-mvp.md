# 班级成绩分析 MVP 定稿方案

> 日期：2026-09-12  
> 仓库：education-advisor @ tip `b06749d`（以最新提交为准）  
> 状态：**MVP + 二期 + AI 接入已在 feat/class-grades-analytics 实现**  
> 关联调研：班级管理缺成绩入口；分析能力已在 Dashboard 成绩镜头 + Academics 对比/总览成熟

## 1. 已拍板

| 项 | 决定 |
|----|------|
| 入口 | `ClassProfile` 增加第 4 Tab：**成绩分析**（`grades`） |
| 点学生 | 跳转 **`/academics`**（选中该生 / 带可识别查询参数） |
| MVP 范围 | 单场：分布 + 分科均分 + 排行 + 待关注；**轻量两场升降对比** |
| 非目标（本 MVP） | 多场班级均分趋势折线、自动计算 `classRank`、飞书/通讯、新 IPC（尽量） |
| 分支策略 | 实现时另开独立分支；避开当前 `feature/channel-architecture` 工作区飞书脏文件 |

## 2. 信息架构

```
/classes → ClassTable → ClassProfile(?class_id=)
  ├─ 概览（现状元数据；可选加「查看成绩分析」按钮）
  ├─ 学生（姓名可点 → /academics）
  ├─ 成绩分析 ★NEW
  └─ 调班
```

## 3. 「成绩分析」Tab 布局

### 3.1 工具栏
- 考试下拉（`listExams`）
- 科目筛选：全部 / 单科
- 刷新
- 快捷链：录入、完整对比（→ `/academics` 对应 tab）

### 3.2 单场区（默认展开）
1. **StatsRow**：均分、已录人数、低分人数、缺考/未录  
   复用 `AcademicStatsRow` / `computeAcademicStats` 模式
2. **分数段分布** → `GradeBandChartCard` + `computeGradeBands`
3. **科目均分** → `SubjectAvgChartCard`
4. **排行** → `GradeRankingCard`
5. **待关注** → `GradeWatchlistCard`（不及格 / 缺考 / 未录）

数据：本班 EAA 学生名列表 → `academic.getClassGrades(names, examId, subjectId?)`

### 3.3 轻量两场对比区（折叠面板，默认可展开一次）
- 选择「基准场 / 对比场」两个考试（默认：最近两场；不足两场则空态引导）
- **摘要卡**：进步人数 / 退步人数 / 持平（复用 `computeStudentComparisons` + `ClassComparisonSummary` 口径）
- **升降表**：姓名、前场、后场、Δ、进步/退步科目数（表列精简，不做完整 Academics CompareTab）
- **可选一图**：科目平均变化柱（`SubjectDeltaChartCard`，空间不够可二期再挂）
- **不搬**：学业对比页的全部筛选项、打印、复杂导出

固定 `classFilter = 当前班级`，不提供跨班。

### 3.4 空态
- 无考试 / 无成绩：引导「去录入」链到 `/academics` 录入 Tab
- 学生名单为空：提示先维护花名册

## 4. 技术要点

- 图表栈：现有 ECharts（`EChart` / `option-builders`），不引新库
- Hook 建议：`useClassGradesAnalytics(classId, studentNames)`（可参考 `useDashboardAcademicData`）
- 百分制：全科对比沿用仪表盘 `score/fullMark` 口径
- **零新 IPC**：复用 `academic:list-exams` / `academic:get-class-grades`
- 服务内已有但未暴露的 `getExamGrades`：**本 MVP 不用**

## 5. 建议改动文件（实现阶段）

### 可改
- `src/renderer/pages/Classes/ClassProfile.tsx`
- `src/renderer/pages/Classes/components/StudentsTab.tsx`
- `src/renderer/pages/Classes/components/ClassGradesTab.tsx`（NEW）
- `src/renderer/pages/Classes/hooks/useClassGradesAnalytics.ts`（NEW）
- `src/renderer/pages/Classes/components/OverviewTab.tsx`（可选入口按钮）
- i18n 文案 keys

### 复用（尽量只读引用）
- `Dashboard/dashboard-academic-stats.ts` 与 Grade* 卡片
- `Academics/components/overview/SubjectAvgChartCard.tsx`
- `Academics/components/compare/*`（摘要/表/Δ 图，按需抽公共）
- `src/renderer/lib/academics/*`

### 明确不要动（飞书/通讯合并风险）
```
src/main/services/feishu*
src/main/services/feishu-bot/**
src/shared/types/feishu.ts
src/shared/api/feishu.ts
src/main/services/webui*
src/main/ipc/handle.ts          # 除非绝对必要
docs/plans|research/*channel* / *feishu*
```

若实现时**被迫**改到上表任一路径，必须在本文件「合并风险附录」追加路径与 diff 说明，方便另一分支合并。

## 6. 验收标准（MVP）

1. 打开任意有名单的班级 → 「成绩分析」可见  
2. 选一场有数据的考试 → 分布、分科、排行、待关注有数且与仪表盘同口径（同班同场抽检）  
3. 选两场 → 摘要人数 + 升降表正确反映进步/退步  
4. 学生 Tab 点姓名 → 进入 `/academics` 且能定位到该生  
5. 未改飞书/通讯相关文件（`git diff` 自检）

## 7. 二期（原延后项 — 见 §9 完成说明）

- ~~多场班级均分趋势折线~~ → 已做
- ~~录入后自动计算 `classRank`~~ → 已做
- ~~班级成绩一页纸打印/导出~~ → 已做
- ~~演示样例数据包~~ → 已做（文档级 fixture）

## 8. 开放附录（已关闭）

- ~~升降档位~~ → **轻量两场对比**
- ~~点学生跳转~~ → **/academics**
- ~~是否先写代码~~ → **先定稿方案，待命实现**

## 9. 二期完成

> 分支：`feat/class-grades-analytics`（在 MVP `b94d9b6` 之上）  
> 约束：仍未改动 feishu* / webui* / `handle.ts`；**无新 IPC**（趋势复用多次 `getClassGrades`）。

### 已交付

| 项 | 说明 |
|----|------|
| 多场班级均分趋势 | `ClassAvgTrendCard` + `class-avg-trend.ts`；同学期优先，否则最近 8 场；全科百分制 / 单科原始分；`<2` 场有数据时空态 |
| 自动 classRank | `shared/class-rank.ts` → `academic-service.batchSetGrades`：同一考试+科目且 ≥2 名学生有分时，按分数降序**竞争排名**（同分同名次，下一名次跳过，如 1,2,2,4）并**覆盖**该批手填排名；仅 1 名学生的科目组（全科逐人保存）**不改动**已有排名，避免误伤 |
| 一页纸打印 | 成绩分析工具栏复用 `useExamGradeSheet` + `ClassGradeSheetDocument` + `PrintOverlay`（与学业考试管理同一套） |
| 演示样例 | `docs/fixtures/class-grades-demo/` + README（复制到 `academics/`，无需改工厂重置） |

### 弃做 / 仍延后

- 未暴露 `getExamGrades` / 新多场聚合 IPC（趋势用多次现有 API 足够）
- 自动排名**不**跨「未出现在本批保存」的学生重算（依赖录入时班级筛选下的名单；部分覆盖保存时排名仅相对本批有分学生）
- 未做独立 PDF 引擎（继续系统打印 / 另存为 PDF）
- 样例不自动注入 userData；需按 README 手动覆盖 `academics/`

### 主要文件

- `src/shared/class-rank.ts` + `tests/shared/class-rank.test.ts`
- `src/main/services/academic-service.ts`（batchSet 挂钩）
- `src/renderer/pages/Classes/lib/class-avg-trend.ts` (+ test)
- `src/renderer/pages/Classes/components/ClassAvgTrendCard.tsx`
- `src/renderer/pages/Classes/components/ClassGradesTab.tsx` / `hooks/useClassGradesAnalytics.ts`
- `docs/fixtures/class-grades-demo/**`
- i18n：`page.classes.grades.trend*` / `printSheet`

## 10. AI 接入（MVP stitch）

> 分支同 `feat/class-grades-analytics`。仍**不**改 feishu* / webui* / `handle.ts`；无新 IPC。

### 已有 AI 能力（调研）

| 入口 | 路径 | 说明 |
|------|------|------|
| 学生档案 AI 分析 | `Students/tabs/AIAnalysisTab` + `useAgentAnalysis` | `agent.runManual(id, prompt)` + `useAgentStreamOutput` |
| 家校话术 | `useCommunicationScript` + `home-school.ts` | 同构 runManual + 纯函数 prompt |
| Chat | `/chat` + chat store | 无 query 预填；agent 事件桥接到消息 |
| Agents | `academic` / `data-analyst` / `class-monitor` 等 | academic 已含 `eaa_exams` / `eaa_exam_grades` |

### 本班成绩 AI 接法

- **入口**：`ClassGradesTab` 工具栏下 `ClassGradesAiPanel`（「AI 分析本班」）
- **Agent**：优先启用的 `academic`，否则第一个 enabled agent
- **上下文**：班级名、考试、科目范围、摘要统计、排行 Top5、待关注 Top5、两场升降人数 + 进步/退步各 Top3 姓名Δ — **不**整表 dump 原始成绩
- **文件**：`lib/class-grades-ai-prompt.ts`、`hooks/useClassGradesAiAnalysis.ts`、`components/ClassGradesAiPanel.tsx`
- **i18n**：`page.classes.grades.ai.*`（zh+en）

### 如何试用

1. Agent 页启用「学业分析师」(academic)，并配置可用模型
2. 班级详情 → 成绩分析 → 选有数据的考试 → 点「AI 分析本班」
3. 查看流式输出；可清除后换科目/考试再跑

### 弃做

- 未新建独立 agent / 未改 Chat 路由预填
- 未走飞书/通讯通道；未改 `handle.ts`
- 未把全班原始分矩阵塞进 prompt
