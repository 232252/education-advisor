# 班级成绩分析 MVP 定稿方案

> 日期：2026-09-12  
> 仓库：education-advisor @ tip `b06749d`（以最新提交为准）  
> 状态：**方案定稿，暂不写代码**（待用户下令再实现）  
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

## 7. 二期（明确延后）

- 多场班级均分趋势折线（或暴露 `getExamGrades` / 多场聚合 API）
- 录入后自动计算 `classRank`
- 班级成绩一页纸打印/导出
- 演示样例数据包（当前 live academics 常为空）

## 8. 开放附录（已关闭）

- ~~升降档位~~ → **轻量两场对比**
- ~~点学生跳转~~ → **/academics**
- ~~是否先写代码~~ → **先定稿方案，待命实现**