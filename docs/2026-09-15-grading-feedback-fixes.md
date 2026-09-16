# 调研与修复记录：改卷/学业模块 7 项反馈（2026-09-15）

> 背景：用户实测反馈 7 项问题。本文档记录每项的**现象 → 根因（含文件:行号，行号为修复前）→ 修复方案**，最后附手动验证清单。
> 改卷子系统为 JSON 文件存储（`<appData>/grading/tasks/<taskId>.json` + `files/<taskId>/`），学业数据为 `eaa-data/academics/`（`exams.json` + `grades/{学生姓名}.json`），均不走 SQLite。

---

## 问题 1：任务创建后无法补加试卷、无法回退

**现象**：标记就绪→批改完成后（待复核/已发布），少导的试卷补不进去，也没有退回可编辑状态的路径。

**根因**：
- 任务状态机 `draft → ready → grading → review → published`（`src/main/services/grading/grading-service.ts:41-47`）。
- `ready → draft` 本就合法且有「退回草稿」按钮（`src/renderer/pages/Grading/components/TaskDetail.tsx:314-323`）；真正被锁的是导入：服务端 `grading-service.ts:366-368` 与 UI `PapersTable.tsx:82` 只允许 `draft|ready`。
- 批改管线 `startGrading` 本就允许 `review` 态重跑，且**只批 pending/failed 试卷、跳过已批**（`src/main/services/grading/grading-pipeline.ts:511,518-520`）——「复核态补卷→只批新卷」管线层天然支持，只是入口被锁。
- `published → review` 迁移在状态机中合法但 UI 无入口。

**修复**：
1. `importPapers` 放开到 `draft|ready|review`；
2. `PapersTable` 的 `importable` 同步放开，review 态按钮语义为「补录试卷」；
3. `TaskDetail` 增加「撤回发布」按钮（published → review），补卷后用现有「开始批改」只批新卷，批完回到复核，再发布（`batchSetGrades` 按 `(examId, subjectId)` 幂等 upsert，重复发布安全）。

## 问题 2：「从样卷识别」只收图片，要支持 PDF/Word/MD

**现象**：样卷识别入口只能选图片文件。

**根因**：两个入口的 dialog filter 与主进程扩展名白名单双写死图片：
- 抽题目结构：`RubricEditor.tsx:24-25` + `src/main/services/grading/rubric-extract.ts:30`；
- 母版标定（逐题坐标）：`src/renderer/components/print/TemplateCalibrateDialog.tsx:33` + `src/main/services/grading/template-calibrate.ts:24`。

项目已有现成 PDF→图片管线（`pdf-rasterize.ts` openPdf/renderAllPages，试卷导入的 pdf/zip 展开在用）；Word(docx) 无任何依赖；MD/TXT 为纯文本。

**修复**：
1. 新增 `mammoth` 依赖与 `src/main/services/grading/sample-ingest.ts`：文件路径 → `{ images, text }` 统一摄取（图片直读 / PDF 栅格化(≤8页) / docx 抽文本+内嵌图 / md·txt 读文本）。
2. 「从样卷识别」接受 `jpg/jpeg/png/webp/bmp/pdf/docx/md/txt`，消息改为 文本 part + 图片 part 混排，prompt 注明「有文本时结构以文本为准」。
3. 「母版标定」加 PDF（需要页面几何，Word/MD 无坐标不开放）。

## 问题 3：选了班级，出现的却是全校学生

**现象**：创建考试选了班级，导入试卷后归属下拉/名单里出现全年级乃至全校学生，无一一对应当。

**根因**（`TaskDetail.tsx:140-148`）：
1. 创建对话框的班级是自由文本+datalist，只存 `className` 字符串，`task.classId` 从未被写入 → 名单过滤条件永远为空 = 全校 Active 学生；
2. `scoped.length > 0 ? scoped : active`：班级名单为空时**静默回退全校**；
3. `PapersTable.tsx:66` 归属下拉直接用全校 Active 名单，不做班级过滤。

**修复**：
1. 创建对话框改真下拉（选项来自班级库 `useClassStore`），提交写 `classId + className`；
2. 任务详情按 classId 严格过滤，历史任务用 `className` 反查班级库兜底解析；空名单显式警告 +「显示全校」显式开关，不再静默回退；
3. 任务详情 meta 区支持改选班级（draft/ready/review）；
4. 归属下拉、批量识别 roster、startGrading roster 全部使用本班名单。

## 问题 4：批量识别姓名

**现象**：希望导入后自动批量识别卷面姓名。

**根因**：批量 AI 视觉识别**功能已存在**（`identify-papers.ts` + 试卷表「识别」按钮 + 候选一键指派 + 手动改派），只是不会自动触发。

**修复**：导入完成后自动触发一轮批量识别，识别留痕照旧可纠正。

## 问题 5：AI批改作业页中间分隔条不能拖动

**现象**：任务列表与详情之间的分栏固定 38%/62%，想拉宽详情侧拉不动。

**根因**：`GradingPage.tsx:123-186` 写死 `w-[38%]/w-[62%]`；`ReviewWorkbench.tsx:216-233` 写死 `w-1/2`；全项目无任何可拖动分栏组件（resizer/split-pane 搜索 0 命中，亦无相关依赖）。

**修复**：新写轻量 `SplitPane` 组件（拖动改比例、20%~80% 钳制、localStorage 记忆、双击重置，零新依赖），两处分栏替换。

## 问题 6：学业页「幽灵成绩」（没参加的考试出现在学生成绩里）

**现象**：如「2024级零诊」，学生没参加却出现在其成绩列表。

**根因**（四层叠加，`src/renderer/lib/academics/metrics.ts:58-62` 是展示层放大器）：
1. `score=null` 的「缺考占位」记录也算数：学生文件里只要有一条该考试的记录（哪怕全 null）考试就会被列出；
2. 成绩按姓名字符串存文件（`grades/{姓名}.json`），无学生 ID，同名学生会互相污染；
3. AI 智能录入用双向子串模糊匹配（`grade-entry.ts:120-131`）：「张三」能匹配「张三丰」，整年级成绩表粘入即可能把分写到错的学生头上；
4. `ExamDef` 无 class/grade 字段，考试全局共享，写入/读取均不校验学生是否在考试范围内。

**修复**（分层治理）：
1. 展示过滤：只列该生**至少有一门实际分数**的考试；
2. 成绩明细卡提供单场考试记录的**删除**入口（两段式确认）；
3. AI 录入改精确姓名匹配，未匹配者显式提示「名单中无此人，已跳过」；
4. `ExamDef` 增加可选 `classId/className`，批改发布与 EAA 成绩导入落库时写入；学业页过滤时班级不符且考试带班级的不再显示（历史考试无该字段照常显示）。

**遗留说明**：已被误写的脏数据用上述删除工具手动清理；如需批量体检扫描（找出全部可疑记录）可后续追加。

## 问题 7：历史脏数据的确认方式

学生 `grades/{姓名}.json` 中该考试下记录的实际内容（全 null 占位 / 有分但属误写 / 同名污染）决定属于哪种机制污染。修复后：
- 全 null 占位 → 不再显示（展示过滤）；
- 误写有分 → 用删除工具清掉；
- 新产生路径已由精确匹配 + 班级字段封住。

---

## 手动验证清单

1. **班级对应**：新建任务选某班 → 任务详情名单只有该班学生；归属下拉默认本班，「显示全校」开关可控；历史任务（只填过班级名）打开后能自动反查班级。
2. **补卷闭环**：draft 导入→就绪→批改→待复核 → 此时「补录试卷」可用，导入新卷自动识别归组 → 「开始批改」只批新卷 → 回到复核；已发布任务「撤回发布」回到复核后同样可补卷。
3. **样卷多格式**：「从样卷识别」分别选 PDF / docx / md 文件能抽出题目结构；「母版标定」可选 PDF。
4. **自动识别**：导入试卷完成后无需点按钮，自动出现卷面姓名识别结果与候选指派。
5. **分栏拖动**：AI批改作业页与复核工作台的分隔条可拖动，刷新后记住位置，双击复位。
6. **幽灵成绩**：学生 A（无「零诊」成绩）详情不再列出该考试；对有误写记录的考试行可删除；AI 粘贴含非本班姓名的成绩表时被明确跳过而非模糊写入。
