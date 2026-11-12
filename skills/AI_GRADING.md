---
name: AI_GRADING
description: AI 批改作业手册 — 查询批改任务与逐题得分的标准口径(批改分 vs 考试分)、生效分(AI 分+教师改分)与发布联动、常见坑(未归组/批改失败/未作答)。适合「作业表现/薄弱知识点/谁总交不上作业」类任务,配合 academic / data-analyst / weekly-reporter 使用。
tools: [eaa_grading_overview, eaa_grading_student, eaa_grading_from_files, eaa_grading_set_strategy, eaa_grading_publish, eaa_exams, eaa_exam_grades, eaa_student_grades, eaa_stats, calculate, write_file, read_image]
---

# AI 批改作业手册(技能)

## 何时用本技能

教师问「这次作业谁错得多」「哪个知识点薄弱」「张三的作业情况」「谁总迟交/缺交」时。
批改数据由教师在「批改作业」页产生，或由持有写入工具的角色从对话建任务。
查询角色只能读。下面的写入工具若本轮工具列表里没有，就不要调用，并说明需要主协调或批改页。
发现教师改分、量规精修、归组、重批、套打、批注 PDF 时，引导教师去「批改作业」页。那些不在对话工具里。
卷面考号经常不等于学号：归组以姓名唯一命中为准；识别不出的算未归组，不要猜姓名。

## 从对话建任务（仅当工具存在）

`eaa_grading_from_files` 参数：

| 参数 | 含义 |
|:-----|:-----|
| `name` | 任务名 |
| `sample_paths` | 原卷或答案卷的绝对路径 |
| `homework_paths` | 学生作业（图片 / PDF / zip） |
| `class_name` | 可选，过滤花名册 |
| `semester` / `exam_date` | 可选 |
| `roster_paths` | 可选花名册文件 |
| `auto_publish` | 批完是否写入学业，默认 true |
| `grading_mode` | 给分松紧：`strict` / `normal` / `lenient`。不是流程策略 |
| `grading_strategy` | 流程策略：`fast` 快改 / `standard` 标准 / `dual` 双评 / `extreme` 极致 AI |
| `confirm` | 非极致任务设为 true，只表示你已复述任务。不是教师点击 |

- 教师没指定策略时不要传 `grading_strategy`（开批按 standard）。教师说了快改、双评或极致 AI，必须传对应值，不要省略
- 不要另造 extreme / dual 路径或工具。只用上面的参数
- `dual` 未配置第二模型时会失败，错误是「未配置第二模型」。不要改成 standard 再试
- `extreme` 会弹出费用确认（大量 token）。不要自己把 `confirm` 设成教师已同意。教师点取消则不会建任务、不会开批
- 已有任务改策略用 `eaa_grading_set_strategy`。改成 extreme 同样等教师点击。不要传 confirm
- 发布到学业用 `eaa_grading_publish`
- 单张图片答疑用 `read_image`。整班批改不要用它代替 `eaa_grading_from_files`

## 两套数据的边界(必读)

- **批改分**(本技能):逐题得分、AI 判分依据、教师改分标记 —— 过程视角,含未发布任务。
- **考试分**(`eaa_exams`/`eaa_exam_grades`):批改任务**发布后**会写入学业管线,scope 标记
  `ai-grading`,科目形如「1.选择题/总分」——统计视角。
- 同一次作业,发布前后两处都有数;结论要以发布后的学业管线为准,批改数据用来解释"为什么丢分"。

## 标准工作流

1. **先拿任务概览**:`eaa_grading_overview`(可按学期过滤)→ 任务状态、已批/失败/未归组份数、均分。
   注意 `unassigned`/`failed` 不为零时,统计口径不完整,报告开头要声明。
2. **全班分析**:对关注任务逐生查 `eaa_grading_student` 太慢——优先用 `published_exam_id` 走
   `eaa_exam_grades(exam_id)` 拿全班总分统计,再对异常学生下钻逐题。
3. **单生诊断**:`eaa_grading_student(name)` → 历次任务逐题得分(含 `evidence` 判分依据),
   找重复丢分的题目/知识点;配合 `eaa_student_grades` 看考试面是否同样薄弱。

## 计算口径

- **生效分** = 教师改分优先,无改分用 AI 分(`score` 字段已是生效分,`ai_score` 是原始 AI 分)。
  评分点(从满分加减的扣分项)若被教师点选,会写入改分,同样以 `score` 为准。
- **满分**:任务级 `full_mark` = 量规各题满分之和;逐题有自己的 `full_mark`,不能跨题直接比。
- 得分率 = score ÷ full_mark;多任务趋势用得分率比较,不用原始分。

## 常见坑

- `papers` 里没有某学生 = **未归组或缺交**,不是 0 分——两者要分开说。
  教师可不改扫描文件名,由「从卷面识别」读首页姓名;识别不出的仍算未归组。
- `status: failed` = AI 批改失败(网络/模型原因),该份无分数,不要当 0 分参与均分。
- 逐题 `ai_score` 与 `score` 不同 = 教师改过 分,以 `score` 为准。
- 批改分的科目名(如「1.选择题」)与考试科目(语文/数学)是**两套口径**,不要混在一张表里比。

## 输出建议

- 全班报告:任务概况(份数/均分/异常) → 分数段名单 → 薄弱知识点(按题聚合丢分) → 干预建议。
- 单生报告:历次作业得分率趋势 → 重复丢分的题目与依据摘录 → 与考试表现/操行的关联
  (配 `eaa_stats`)→ 给教师的具体动作。
- 产物落盘:`data_archive/agent_outputs/`(write_file,Markdown),命名含任务名与日期。
