# 教师对话的工具、技能与产品界面边界

- 状态：2026-11-12 修订。对话侧缺口已实现（见下一节）。下文若与修订记录冲突，以修订记录为准。
- 日期：2026-11-12（调研）；修订：2026-11-12
- 代码基线：实现分支相对于 `cursor/module-archives-74e4`（含 DSH 模型路由与极致 AI 批改）

## 修订（2026-11-12）：对话现在能做、仍然只在页面

默认角色 `main`（教育参谋）在这次修订之后可以：

- 用 `eaa_grading_from_files` 的 `grading_strategy` 指定 `fast` / `standard` / `dual` / `extreme`。`grading_mode` 仍只是 strict / normal / lenient。不传策略时开批仍按 standard；教师说了极致 AI 就必须传 `extreme`，不会再被缺省吃掉。
- `extreme` 在建任务或把已有任务改成极致（`eaa_grading_set_strategy`）之前，弹出与批改页相同的费用确认框。工具在主进程里等待，教师点确认后才写入；点取消则不建任务、不改策略。模型填写的 `confirm: true` 不是这次点击。
- `dual` 未配置第二模型时直接失败，错误是「未配置第二模型」，不会降成 standard。
- `eaa_set_grade` 改一场已有考试里一名学生的一科分数。`eaa_delete_exam` 删除考试并级联成绩，同样等待教师点击；取消则不删。
- `eaa_restore_class` 把存档班级恢复到日常列表。`eaa_archive_class` 的说明改为指向这个工具。
- SOUL、AGENTS、公共规则和技能 `AI_GRADING`、`ACADEMIC_ANALYSIS`、`STUDENT_MANAGEMENT` 按上面的真实工具来写。`bug-hunter` 不再要求自己跑测试。`executor` 不再声称能备份或自维护。supervisor / validator 仍是停用角色。

`confirm: true` 还留在存档、非极致建任务、发布成绩、删除学生上，含义是「模型已经复述」，不是教师点击。默认对话仍然没有 `eaa_delete_student`。

仍然只在页面上，对话没有对应工具：

- 批改：改量规、归组、合并多页、教师改分、重批、中止、删任务、套打、批注 PDF、汇总 CSV、打印预览
- 学业：不带 Excel 手工建考试、删一名学生在某场的全部成绩、科目配置、两场对比视图
- 班级硬删除；学生删除（学生页有界面确认；`main` 无 `delete`）
- 仪表盘重放与导出 HTML；报告列表专用查询
- 定时任务增删改和「现在跑」
- API Key 与模型目录、出厂重置、隐私库密码、连接中心扫码、插件安装、WebUI 证书、整库备份与恢复
- 官方 `dsh-tool-subagent` 仍在教师 sdk 关闭名单里。极致批改继续走 `completeGradingCall` → `completeSimpleViaDsh`，不是对话里的子代理工具

下面第 2–9 节是修订前的调研地图。与上一节冲突的句子（例如「没有 gradingStrategy」「没有 eaa_restore_class」「确认只有参数自证」）已过时。
- 范围：教师在「对话」里能让助手做成的事，对照侧栏各页、技能和系统提示。不限于批改。

证据以当前源码为准。官方说明见 `docs/DSH_PLUGIN_STANDARD.md`、`docs/DSH_CORE_RUNTIME.md`、`docs/DSH_PLUGIN_VISION.md`、`docs/ARCHITECTURE.md`；工具名单、能力裁剪和页面动作以代码为准，不以这些文档的「建议插件」列为已实现能力。

本机检出没有可读的 `@deepseek-ai/dsh-*` 包源码（安装包把它们排除出 asar 文件表，运行时另走 dsh 闭包）。官方工具是否对模型可见，以本仓库的关闭名单和挂载代码为准；名单里没写、源码里也没有行定义的包，文中标为未证实，不写成「已经暴露」或「已经关掉」。

---

## 1. 对话怎样接到工具和技能

教师对话的模型循环是 `dsh --profile sdk`，界面在本应用。入口：`src/main/services/agent/execution.ts` 调用 `createDshRuntime`，并 `mountEaaAgentTools({ via: 'plugin' })`。pi 不再驱动这一轮。

「对话」页可以选择任意已启用角色（`src/renderer/pages/Chat/ChatPage.tsx` 的 `selectedAgentId`）。未选时用已启用列表的第一项；`config/agents.yaml` 里第一项是 `main`（教育参谋）。下面的「默认对话」指这一角色。换到其他角色后，工具集按该角色的 `capabilities` 重裁，不是同一套。

一次运行的工具由 `src/main/services/agent/tools.ts` 的 `buildAgentTools` 拼出：

1. `getToolsByCapability`（`src/main/services/eaa/tools/registry.ts`）按 yaml 能力展开 EAA 工具。`all` / `*` 不含删除。`delete` 必须单独声明。
2. 全员文件工具、实用工具、`save_memory`。
3. 该角色配置了的外部 MCP（工具名前缀 `mcp_<serverId>_`）。仓库里没有预置外部 MCP 服务器。
4. 仅 `id === 'main'` 时追加 `delegate_to`。
5. 仅声明 `escalate` 时追加 `escalate_to_main`。`main` 没有这项。

dsh 的 MCP 客户端会把工具名改成 `mcp__<serverName>__<rawName>`。分组约定在 `src/main/services/dsh/eaa-tools-contract.ts`：

| 插件目录 | 模型侧前缀 | 归入的工具 |
| --- | --- | --- |
| `vendor/eaa-roster` | `mcp__roster__*` | 班级与学生档案（见第 2 节） |
| `vendor/eaa-grades` | `mcp__grades__*` | 成绩导入与考试查询 |
| `vendor/eaa-grading` | `mcp__grading__*` | 批改查询、从文件建任务、发布 |
| `vendor/eaa-tools` | `mcp__eaa__*` | 其余：操行、文件、实用、记忆、委托 |

某次运行的工具集里没有某一组，宿主就不注入该组地址，对应插件保持关闭（`src/main/services/dsh/tool-bridge.ts`）。

系统提示在送给模型前，会把正文里的裸工具名改写成上述公开名（`src/main/services/dsh/agent-facade.ts` + `tool-names.ts`）。用户消息不改写。技能正文在复制进临时目录时同样改写（`src/main/services/dsh/skill-mount.ts`）。

技能不再写进系统提示。`execution.ts` 把 `skillsSection` 固定为 `''`，注释写明由 dsh 的 skill 工具在会话里发布。每次运行把该角色看得到的技能复制到临时目录，并把 `skill-filesystem` 钉死在这个目录（不扫描用户主目录）。角色过滤规则：技能 frontmatter 有 `tools` 时，角色至少持有其中一只工具（或全员工具）才挂上；没有 `tools` 的技能对所有角色可见（`selectSkillsForRun`）。

连接中心（`dsh web` + dsh-im）使用主协调的同一套教育工具和同一份技能目录（`src/main/services/dsh/im-education.ts`，`docs/DSH_PLUGIN_VISION.md`）。渠道里的模型不是另一套业务 API。它额外受官方会话预设的包级关闭名单约束，和教师对话的行级关闭名单不是同一份（见 2.4）。

---

## 2. 当前工具地图

### 2.1 默认对话（`main`）的 EAA 工具

`main` 的能力在 `config/agents.yaml`：`read`、`summary`、`add_event`、`add_student`、`history`、`search`、`list`、`ranking`、`stats`、`codes`、`range`、`revert`、`class`、`set_student_meta`、`import_students`、`import_grades`、`grading`。没有 `delete`。

「确认」一列的含义见 2.5。`参数自证` 表示工具要求 `confirm: true`，由模型自己传入，对话里没有教师点击的确认卡片。`提示词约定` 表示只写在 `agents/_shared/rules.md`，工具本身不检查。

| 工具 | 做什么 | 确认 | 产品区 |
| --- | --- | --- | --- |
| `eaa_score` | 查一名学生的操行分、风险档、事件统计 | 无 | 学生 / 仪表盘 |
| `eaa_history` | 一名学生的事件时间线 | 无 | 学生 |
| `eaa_search` | 按关键词搜操行事件 | 无 | 学生 |
| `eaa_tag` | 按标签查，或不带参数列出标签 | 无 | 学生 |
| `eaa_list_students` | 学生名单，可按 `class_id` 过滤；超上限会截断并提示改用排名 | 无 | 学生 / 班级 |
| `eaa_ranking` | 操行排行 | 无 | 学生 / 仪表盘 |
| `eaa_stats` | 全校操行统计。看一个班不要用它混班 | 无 | 仪表盘 |
| `eaa_summary` | 一段时间内的操行摘要 | 无 | 仪表盘 / 报告 |
| `eaa_range` | 按时间区间列事件 | 无 | 学生 / 报告 |
| `eaa_codes` | 原因码字典。记分前必须先查，不许猜码 | 无 | 学生 |
| `eaa_add_event` | 加分或扣分。支持 `dry_run`、`force`、标签 | 提示词约定；有预演参数，无 `confirm` | 学生 |
| `eaa_revert_event` | 按事件 ID 撤销并回退分数 | 提示词约定 | 学生 |
| `eaa_add_student` | 注册一名学生，可选 `classId` 立即分班 | 提示词约定 | 学生 |
| `eaa_set_student_meta` | 改班级、组别、角色；可清除班级 | 无 | 学生 / 班级 |
| `eaa_import_students` | 花名册批量导入。优先 `excel_path`；也可传 `students[]`（含身份证、电话、住址、家长，写入档案）。支持 `replace_class` | 提示词约定（整批复述一次） | 学生 / 班级 |
| `eaa_list_classes` | 列班级 | 无 | 班级 |
| `eaa_create_class` | 建班。名称须带年级，可自动编号 | 提示词约定 | 班级 |
| `eaa_update_class` | 改显示名、年级、班主任、备注 | 无 | 班级 |
| `eaa_archive_class` | 存档：日常列表隐藏，学生与事件保留。恢复用 `eaa_restore_class` | 参数自证（只表示已复述） | 班级 |
| `eaa_restore_class` | 取消存档，班级回到日常列表 | 无 | 班级 |
| `eaa_exams` | 列考试 | 无 | 学业 |
| `eaa_exam_grades` | 一场考试的成绩 | 无 | 学业 |
| `eaa_student_grades` | 一名学生的成绩时间线 | 无 | 学业 / 学生 |
| `eaa_import_grades` | 成绩 Excel → 建考试并按该班花名册对号写入。考号不等于学号时按姓名。对不上的行进 unmatched，不新建学生。支持 `dry_run` | 提示词约定；预演参数 | 学业 |
| `eaa_set_grade` | 改一名学生在已有考试中的一科分数，或记缺考 | 无（先复述，无 confirm 参数） | 学业 |
| `eaa_delete_exam` | 删除考试并级联成绩 | 教师点击 | 学业 |
| `eaa_grading_overview` | 批改任务列表：状态、题数、份数、已批、失败、均分 | 无 | 批改作业 |
| `eaa_grading_student` | 一名学生的逐题批改分、依据、教师改分 | 无 | 批改作业 |
| `eaa_grading_from_files` | 原卷 + 作业建任务并开批。`grading_mode` 为松紧，`grading_strategy` 为 fast/standard/dual/extreme | 非极致为参数自证；extreme 为教师点击 | 批改作业 |
| `eaa_grading_set_strategy` | 改已有任务的流程策略，不重新开批 | extreme 为教师点击；其余无 | 批改作业 |
| `eaa_grading_publish` | 把已有任务的成绩写入学业 | 参数自证（只表示已复述） | 批改作业 / 学业 |

`eaa_delete_student` 已实现（永久删除学生和事件，`confirm: true`），但 `main` 未声明 `delete`，默认对话调不到。学生页可以删（`src/main/ipc/eaa/handlers-students.ts` 的 `requiresConfirmation: true`，那是界面确认）。

`eaa_grading_from_files` 的参数（`src/main/services/eaa/tools/grading-write-tools.ts`）有：任务名、学期、班级名、考试日期、原卷路径、作业路径、可选花名册路径、`auto_publish`、`grading_mode`、`grading_strategy`。`grading_mode` 是 `strict` / `normal` / `lenient`（给分松紧）。`grading_strategy` 是 `fast` / `standard` / `dual` / `extreme`。不传策略时任务字段留空，开批仍由 `normalizeGradingStrategy` 归一为 `standard`。传入的策略会写进 `createTask`。`dual` 在建任务前调用 `assertDualModelConfigured`，未配置第二模型抛「未配置第二模型」，不降级。`extreme` 先 `requireTeacherConfirm`，取消则不调用 `createTask`。已有任务用 `eaa_grading_set_strategy`，改成极致时同一条确认。

极致 AI 的费用文案仍是 `ExtremeAiConfirm.tsx`。批改页的创建对话框和任务详情继续用它。对话工具通过 `teacher-confirm:request` 把同一对话框挂到 `TeacherConfirmHost`（`App.tsx`），工具调用停住直到教师点击。

### 2.2 全员工具（每个角色都有，含默认对话）

定义在 `src/main/services/agent/tools.ts` 的 `UNIVERSAL_TOOL_NAMES`，外加文件实现。无确认参数。

| 工具 | 做什么 | 产品区 |
| --- | --- | --- |
| `read_file` | 读本地文本。单文件上限 5 MB；路径含 `..` 拒绝。不支持把 GBK 当 UTF-8 静默读入 | 文件 |
| `read_excel` | 读 xlsx/xls，最多 5000 行。身份证、电话、住址等列对模型显示为「(已隐藏)」 | 学生 / 学业导入 |
| `read_image` | 把图片交给具备视觉输入的模型看。模型 `input` 不含 image 时不注入（`visionEnabled === false`） | 批改 / 答疑 |
| `list_dir` | 列目录 | 文件 |
| `write_file` | 写文本，自动建目录 | 报告等产物 |
| `write_excel` | 写新的 xlsx | 导出表 |
| `write_csv` | 写 UTF-8-BOM CSV | 导出表 |
| `get_current_time` | 日期、星期、是否工作日 | 通用 |
| `calculate` | 数学表达式 | 通用 |
| `save_memory` | 写入该角色的长期记忆。读取不走工具，下次运行注入系统提示。设置页可以删 | 仪表盘备忘 / 设置 |

`delegate_to` 只给 `main`：把一段自包含任务交给另一个角色，等它跑完，结果截断到 8000 字后回到主协调。不能委托给自己，不能嵌套或并行。无确认参数。目标角色用它自己的能力，不是主协调的全套工具。

`escalate_to_main` 只给声明了 `escalate` 的角色（`psychology`、`safety`、`risk-alert`）。方向与委托相反。

### 2.3 官方 DSH 工具：关掉的、留下的、两边名单不一致的

教师对话子进程附带 `src/main/services/dsh/hardening.ts` 的补丁。按行 id 关闭，不删除运行时包。`docs/DSH_CORE_RUNTIME.md` 写明这些包仍随 sdk profile 安装，只是不对模型开放。

关闭的行 id：

`tool-bash`、`tool-pwsh`、`tool-jobs`、`tool-schedule`、`tool-ask-user`、`present`、`tool-fs`、`tool-fs-search`、`tool-todo`、`tool-goal`、`tool-web`、`tool-workflow`、`tool-ralph`、`tool-plugin-manager`、`plan-mode`、`tool-subagent`、`tool-subagent-fork`、`tool-subagent-control`、`tool-subagent-list-agents`、`mcp-resources`。

同时把官方 system-prompt 的 harness 身份和人格前后缀清空，避免和本应用的 SOUL 叠两套人设。

故意保留：

- `tool-skill`（`@deepseek-ai/dsh-tool-skill`）。只加载技能正文。
- `tools` 注册表行。关掉它，MCP 工具也注册不进去。
- 注释写明 `run_code` 只在 ptc/both 模式暴露，缺省 native 不暴露，因此不关 `tools` 行。

不在这份行名单里、但连接中心预设按包名关掉的（`src/main/services/dsh/im-preset.ts` 的 `EAA_PRESET_SHELL_PACKAGES`）：持久化 bash/pwsh、`dsh-terminal`、`dsh-terminal-bash`、`dsh-command-goal`、`dsh-workflow-ptc`、`dsh-tool-executor-ptc`、`dsh-tool-cordis`、`dsh-plugin-manager/tools`。教师对话的行级补丁没有这些 id。本仓库没有 `dsh-base` 的 `cordis.patch.yml`，不能证明它们在 sdk profile 上是否另有行 id、是否已经对模型可见。这是名单缺口，不是已复现的越权。

官方子代理工具是关掉的。批改管线里的「双子核验 / 仲裁子代理」是宿主进程里的 `extreme-pipeline.ts`，不是模型可调的 `subagent` 工具。对话不能通过官方子代理去跑极致模式。

`tool-ask-user` 已关。对话里也没有工具审批卡片（渲染层没有 tool approval 状态）。模型不能弹出官方提问，也不能等教师在卡片上点允许。

`tool-schedule` 已关。宿主自己的定时任务仍由 `/scheduler` 和 `agents.yaml` 的 cron 叫醒，不依赖这个工具。

### 2.4 外部 MCP

技能页和设置里的 MCP 开关是宿主配置。配好并挂到角色上之后，那些工具会进入该角色的对话。名字是 `mcp_<serverId>_…`，再被 dsh 包一层 `mcp__eaa__` 前缀（它们走剩余工具那一组）。仓库不附带具体第三方工具。`tool-plugin-manager` 已关，对话不能自己安装或卸载插件。

---

## 2.5 确认到底是什么

三套机制不要混：

1. **提示词约定。** `agents/_shared/rules.md` 要求记事件、加人、导花名册、导成绩、建班、撤销之前先复述。工具不强制。模型可以不复述就调用。
2. **参数自证。** `eaa_archive_class`、非极致的 `eaa_grading_from_files`、`eaa_grading_publish`、`eaa_delete_student` 在 `confirm !== true` 时抛错。这只表示模型声称已经复述，不是教师点击。工具说明已改成这个口径。
3. **界面确认。** 学生页删除、对话删除会话、设置重置、批改页把策略改成极致 AI，以及对话里的极致 AI（建任务或改策略）和 `eaa_delete_exam`，使用 `ConfirmDialog`。后两者由 `requestTeacherConfirm` 挡住工具，直到教师点击。`eaa_set_grade` 与 `eaa_restore_class` 没有 confirm 参数。

---

## 3. 当前技能地图

仓库内建技能只有 `skills/` 下 5 份。用户技能是运行时目录（开发态 `.app-data/skills`，打包态 userData；`src/main/services/skill-service.ts`），不在仓库里。技能页可以新建、编辑、删除用户技能（`src/main/preload/api/skill.ts`）。`Skill` 类型没有启用开关（`src/shared/types/skill.ts`）。`docs/DSH_PLUGIN_STANDARD.md` 写「教师可启用或停用某一份技能」，代码里停用等于删文件，项目技能没有单独的停用位。

注入：下一轮对话（以及连接中心准备教育预设时）按 2.1 的过滤复制进临时目录，由 `tool-skill` 加载。系统提示不再附「用 read_file 读技能全文」的清单。技能是否出现在模型眼前的目录，取决于 dsh 0.2.2-rc.1 的 skill 插件；宿主侧只保证目录被钉死、正文被改写工具名。

| 技能 | 用途 | 声明的工具 | 和工具的关系 | 默认对话能否注入 |
| --- | --- | --- | --- | --- |
| `STUDENT_MANAGEMENT` | 操行记分、撤销、名单、建班、导花名册、改班级属性 | 查询 + `eaa_add_event`、`eaa_revert_event`、`eaa_add_student`、班级四件套、`eaa_import_students`、`eaa_set_student_meta` | 有工具。不覆盖成绩导入、批改、删除学生 | 能。`main` 持有这些工具 |
| `ACADEMIC_ANALYSIS` | 考试查询、加权、分数段、缺考口径、成绩和操行一起看 | `eaa_exams`、`eaa_exam_grades`、`eaa_student_grades`、`eaa_stats`、`eaa_summary`、`calculate`、`write_file` | 有查询和写文件。不含 `eaa_import_grades`，也不教改分 | 能 |
| `AI_GRADING` | 批改分和考试分的口径、生效分、未归组 / 失败不要当 0 分 | 批改查询 + 考试查询 + `calculate`、`write_file` | 查询手册。正文写明查询角色没有改分工具；`eaa_grading_from_files` 只在角色规则里提了一句，不在 `tools` 里。不提流程策略 | 能 |
| `WEEKLY_REPORT_GUIDE` | 周报结构、对比基准 | 操行查询 + `get_current_time`、`write_file` | 有工具。产物是 Markdown 文件，不是报告中心的专用 API | 能 |
| `RISK_INTERVENTION` | 四档风险对应的干预动作、家校沟通时机 | `eaa_ranking`、`eaa_score`、`eaa_range`、`eaa_search`、`eaa_stats`、`eaa_summary` | 查询工具加上一份话术。没有「创建干预记录」或「发送给家长」的工具 | 能 |

过滤是「声明工具里至少有一只角色拿得到」，不是「全部拿得到」。全员工具（`write_file`、`calculate`、`get_current_time`）算数。因此 `academic` 看不到 `STUDENT_MANAGEMENT`（里面没有它持有的工具），但看得到成绩分析、批改查询、周报和风险干预。`bug-hunter` 能力为空，仍然看得到 `ACADEMIC_ANALYSIS`、`AI_GRADING`、`WEEKLY_REPORT_GUIDE`，因为它们列了 `write_file` 或 `calculate`；它看不了这些技能里的 `eaa_*`。`STUDENT_MANAGEMENT` 和 `RISK_INTERVENTION` 它看不到。

没有「有技能、零工具」的内建技能。`RISK_INTERVENTION` 最接近：工具只负责取数，动作本身是提示词。

---

## 4. 角色说明和系统提示，对照实际工具

默认对话的说明由四段拼成（`src/main/services/agent/system-prompt.ts`）：`agents/main/SOUL.md`、`agents/_shared/project-context.md`、当前班级段、`agents/_shared/rules.md`、`agents/main/AGENTS.md`、长期记忆、运行环境、工作准则、对话配置。技能段为空。

裸工具名会被改成 `mcp__…`。所以「提示里写了 `eaa_score`、列表里却是另一个名字」这个问题，对已挂载的工具已经处理。下面的错配是内容，不是前缀。

`tests/main/prompt-tool-contract.test.ts` 检查各角色 `AGENTS.md` 里出现的 `eaa_*` 是否都在该角色能力展开结果里。它不检查 SOUL、不检查公共规则、不检查「没写但实际有」。

### 4.1 `agents/main/SOUL.md` 偏旧

「可用能力」列出查分、统计、考试查询、记事件、加人、列班、建班、文件、计算、时间。同一文件的记忆段写了 `save_memory`。

没写、但 `main` 实际有的：`eaa_tag`、`eaa_set_student_meta`、`eaa_update_class`、`eaa_archive_class`、`eaa_import_grades`、四个批改工具、`read_image`、`delegate_to`、`list_dir`、`write_csv`。考试查询写了「数据来自教师在学业页的录入」，没有写对话可以 `eaa_import_grades`。

### 4.2 `agents/main/AGENTS.md` 比 SOUL 新，仍不完整

工具表有班级改名和存档、成绩导入、`eaa_grading_from_files` / `eaa_grading_publish`、`delegate_to`、文件工具。路由表把深度分析委托给专家。

没写：`eaa_exams`、`eaa_exam_grades`、`eaa_student_grades`（SOUL 有）、`eaa_tag`、`eaa_set_student_meta`、`eaa_grading_overview`、`eaa_grading_student`、`read_image`、`save_memory`。批改小节只给路径和 `confirm: true`，没有松紧口径，也没有流程策略。路由表说「查分/加减分/统计/写文件 = 自己办（你已有全套工具）」——删除学生不在这套里。

### 4.3 公共规则和运行环境段

`agents/_shared/rules.md` 的写操作名单是：`eaa_add_event`、加人、导花名册、`eaa_import_grades`、`eaa_create_class`、`eaa_revert_event`。不含改班、存档、改学生属性、发布批改、写文件。批改只提示不要猜姓名。

运行环境段（`system-prompt.ts`）的文件表有读写文本、Excel、CSV、列目录、时间、计算。没有 `read_image`。同段写「完整能力面以本轮工具定义为准」，并给出导花名册、导成绩、批改的步骤。这和 SOUL 的简表不一致，以工具定义为准时，模型仍可能更听 SOUL 的短名单。

`eaa_archive_class` 的描述指向 `eaa_restore_class`。恢复走 `classService.restore`，与班级页同一条服务。`main` 的 `class` 能力包含这个工具。没有硬删除班级的对话工具。

### 4.4 其他角色（对话页选得中，或被 `delegate_to` 叫起）

`config/agents.yaml` 共 18 个角色。`supervisor`、`validator` 的 `enabled: false`，委托校验会拒绝已停用目标。

| 角色 | 能力要点 | 对话里实际做不到的、但说明容易让人以为能做的 |
| --- | --- | --- |
| `academic` | 只读 + 统计排名。含考试和批改查询 | 不能导成绩、不能改分、不能开批 |
| `counselor` | 只读 + `add_event` | 不能建班、不能导花名册 |
| `psychology` / `safety` / `risk-alert` | 只读为主，可 `escalate_to_main`。`safety` 可记事件 | 不能联络家长，不能改隐私或处分流程状态 |
| `home_school` | 只读 + 排名 | 只能出草稿。不能发消息、不能打印家长报告 |
| `discipline-officer` | 读写操行，含撤销、加人。无 `class` / `import_students` / `grading` | 不能建班，不能批改 |
| `class-monitor` | 记事件、加人、建班、改属性。无成绩、无批改、无撤销 | 不能导成绩 |
| `weekly-reporter` / `data-analyst` / `research` / `governor` | 只读统计 | 产物靠 `write_file`。不能改操行 |
| `student-care` | 查询 + `add_event`，无整包 `read` 里的考试工具 | 表扬可以记加分。没有独立的「奖励」对象 |
| `executor` | 只读统计和原因码 | 说明写系统维护、备份。没有备份、诊断、更新工具 |
| `bug-hunter` | 能力为空，只有全员文件工具 | `AGENTS.md` 要求写测试再跑再看输出，同一文件写明没有 shell。测试运行做不到 |

定时任务走同一套 `buildAgentTools`，不是对话页。报告中心的「立即生成周报」是替用户调用 `weekly-reporter`（`src/renderer/pages/Reports/hooks/useReportsData.ts`），不是新工具。

---

## 5. 按产品模块：对话能做、只有页面能做、说了也不发生

侧栏唯一名单是 `src/renderer/config/nav-items.ts`：仪表盘、对话、学生、班级、学业、批改作业、Agent、模型、技能、任务（`/scheduler`）、隐私、报告中心、设置。另有欢迎页、连接中心、本机 WebUI、打印。没有影视模块（`docs/DSH_PLUGIN_STANDARD.md` 已写明）。

「缺失」指：教师用自然语言让默认对话去办，今天没有工具把它做成页面上那件事。密钥、打印预览、卸载确认一类，建议继续只留在页面，表里标为页面职责，不标成缺陷。

### 5.1 仪表盘 `/dashboard`

- 对话能做：用操行和成绩查询工具回答人数、均分、排名、区间、风险。`save_memory` 写入的内容会出现在备忘卡。
- 只有页面能做：操行/成绩镜头切换、图表、双班对比表、事件重放（`eaa.replay`）、导出 HTML 仪表盘（`eaa.dashboard`）。没有对应工具。
- 缺失：让对话「导出仪表盘 HTML」或「重放事件日志」不会发生。对比可以让模型用查询工具算，但没有对比图。

### 5.2 对话 `/chat`

- 页面本身：会话列表、换模型（写入 DSH 路由）、思考档、附件、换角色、停止、排队。附件路径会写进发给模型的文本（`useFileUpload` + `buildFinalText`）。
- 对话里的助手不能：改当前模型、改思考档、改对话设置、删除会话、打开连接中心。没有这些工具。
- 这是页面职责。助手去改密钥或模型路由不合适。

### 5.3 学生 `/students`

- 对话能做：查询、记分、撤销、单人添加、批量导入（含档案字段）、改班级/组别/角色。
- 只有页面能做：删除学生（带界面确认）、Excel 预览后再导入、下载导入模板、按格式导出操行、学生页上的多角色分析、家校话术生成按钮、家长版报告打印（`ParentReportDocument`）。档案里身份证等字段的逐项编辑表单不在 `eaa_set_student_meta` 里；导入路径可以写入。
- 缺失：默认对话不能删除学生。不能直接打印家长报告。话术可以由 `home_school` 角色或主协调用查询加写作完成，但没有页面那套场景×语气控件，也发不出去。

### 5.4 班级 `/classes`

- 对话能做：列表、创建、改名/班主任/备注、存档、把学生分入班级、导花名册。
- 只有页面能做：从存档恢复、硬删除班级、班级成绩表上的 AI 分析按钮（`useClassGradesAiAnalysis` 直接 `runManual` 学业角色，提示词在 `class-grades-ai-prompt.ts`）。
- 修订后：`eaa_restore_class` 可以恢复存档班。硬删除仍然只在班级页。

### 5.5 学业 `/academics`

- 对话能做：列考试、查一场、查一人、从成绩 Excel 新建考试并写入对得上的行。
- 只有页面能做：不带 Excel 手工建考试、删考试、单格改分、`batchSetGrades`、删一名学生在某场的成绩、两场对比视图、科目配置（`academic.getConfig` 只在页面）。
- 修订后：`eaa_set_grade` 可以改一科；`eaa_delete_exam` 删整场考试并等教师点击。删一名学生在某场的全部成绩、不带 Excel 手工建考试，仍然只在学业页。`ACADEMIC_ANALYSIS` 教导入、改分和删考试，并写明没有工具的角色不能调用。

### 5.6 批改作业 `/grading`

- 对话能做：看任务概览、看一名学生的逐题结果、用附件路径创建任务（松紧三档 + 流程四档）、改已有任务的流程策略、把任务发布到学业。极致策略等教师点击费用确认。`read_image` 可以看单张卷，不进入量规和台账。
- 只有页面能做：选流程策略（快改 / 标准 / 双评 / 极致）及极致确认框；改已有任务的松紧和策略；编辑或精修量规；导入后人工归组、合并多页、删卷；开始 / 重批 / 中止；保存教师改分；框选作答区；套打红笔、批阅痕迹、导出带批注 PDF、导出汇总 CSV；删除任务。IPC 见 `src/main/preload/api/grading.ts`。
- 修订后：对话可以指定 `fast` / `standard` / `dual` / `extreme`，也可以改已有任务的策略。极致要教师点击费用确认。双评仍依赖设置里的第二模型，对话不能去模型页配置它；没配时建任务或改策略直接失败。改量规、归组、教师改分、重批、中止、删任务、套打和导出仍然只在批改页。

### 5.7 Agent `/agents`

- 对话能做：`main` 用 `delegate_to` 跑另一个已启用角色并收回文字结果。
- 只有页面能做：启用/停用、改名称和描述、改 SOUL / 规则、在本页手动跑。
- 缺失：对话不能改角色权限或提示词。委托不能并行，结果超过 8000 字会被截断，完整内容要靠目标角色 `write_file`。

### 5.8 模型 `/models`

- 页面：供应商、API Key、连接测试、自定义模型、默认模型、批改模型、本机 Ollama 检测/拉取/删除。对话顶栏可以换当前路由，那是教师点的，不是助手的工具。
- 对话不能做：任何密钥或模型目录操作。应保持页面职责。
- 和批改的交叉：不配第二模型时，双评在管线里直接失败（`grading-pipeline.ts`）。对话既不能选双评，也不能去模型页配好第二模型。

### 5.9 技能 `/skills`

三个页签：技能正文、MCP、插件安装状态。

- 对话能做：使用已注入的技能正文；调用已挂上的 MCP 工具。
- 只有页面能做：新建/编辑/删除技能，添加 MCP，看花名册/成绩/批改/操行插件是否两边安装戳都对齐。
- 缺失：对话不能管理技能或插件（官方插件管理工具已关）。技能没有启用位，和标准文档的说法不一致。

### 5.10 任务 `/scheduler`

- 页面和 `agents.yaml` 的 cron 会在没有人打开对话时叫醒角色。
- 对话不能做：增删改定时任务、立即跑某一条 cron。`tool-schedule` 已关。
- 这是宿主职责（`docs/DSH_PLUGIN_VISION.md` 已说明 dsh-schedule 替不了早报）。若产品希望「每周五提醒我」，今天要去任务页或改 yaml，不能在对话里设。

### 5.11 隐私 `/privacy`

- 页面：设密码、解锁、实体名单、添加实体、脱敏预览、备份、锁定（`src/main/preload/api/privacy.ts`）。
- 对话：自动脱敏打开时，工具参数和结果会经 `privacyGuard` 化名，模型不控制开关。公共规则写明模型不能自己执行脱敏。
- 应保持页面职责。对话没有「把全班改成化名显示」的工具。

### 5.12 报告中心 `/reports`

- 对话能做：按周报技能用查询工具取数，`write_file` 写到 `data_archive/agent_outputs/`。文件会出现在报告中心列表里。
- 只有页面能做：列表、预览、按钮「立即生成周报」（内部跑 `weekly-reporter`）。
- 没有 `eaa_list_reports`。模型可以用 `list_dir` 找文件。生成动作本身对话也能做，只是不走报告页那个按钮。

### 5.13 设置 `/settings`

分区（`SettingsPage.tsx`）：通用（主题、语言、数据目录、时区、开机、托盘、超时、日志级别、更新）、连接中心频道配置、WebUI、对话（压缩、引导、追问、图片、对话日志）、MCP 开关、诊断（`eaa.doctor` / `eaa.validate`）、日志、记忆查看与删除、备份与恢复、关于。

对话不能做以上任何一项。诊断和备份没有 EAA 工具。`executor` 的自我维护说明覆盖不了这些 IPC。密钥、更新、恢复出厂应留在页面。诊断如果希望对话能跑，目前是缺工具，不是页面独有的交互。

### 5.14 连接中心 / IM

侧栏面板是 dsh-im（飞书、企微、钉钉、QQ、微信、Slack、Telegram、Discord、Matrix 等，以适配器清单为准）。渠道消息走主协调工具。设置页还有飞书开放平台的多维表格同步，和 IM 扫码不是同一套凭证（`docs/DSH_PLUGIN_VISION.md`）。

对话不能：打开面板、扫码登录、启停频道、写多维表格。应留在连接中心和设置。渠道里的教师可以让助手做第 2 节那些数据操作，边界与桌面默认对话相同，另外还受预设包级关闭名单约束。

### 5.15 本机 WebUI

`src/main/services/webui/gateway.ts` 用令牌保护的 HTTP(S) 提供静态页，并把请求转成已注册的 IPC。手机浏览器因此能碰到桌面 IPC，比对话工具宽。它不是对话的一个工具。开关、端口、排程、证书在设置页。对话不能打开或配置 WebUI。

上传注释写明：否则 `read_excel` / `eaa_grading_from_files` 看不到另一台设备上传的文件（`src/main/services/webui/upload.ts`）。WebUI 上传是给这些工具补路径，不是第二套批改 API。

### 5.16 打印 / PDF / Office

- 批改页：批阅痕迹、套打原卷、带批注 PDF、汇总 CSV（`useGradingMarksPrint`、`grading` IPC 的 overlay / export）。
- 学生页：家长版一页报告。
- Office 转 PDF 用随包 office-kit，首次使用时解压。没有对话工具去安装、转换或打印。
- 缺失：对话不能「打印这叠作业」或「导出批注 PDF」。预览和打印机选择适合留在页面；若只要文件，目前也没有导出工具。

### 5.17 欢迎页

首次引导视频。不是侧栏模块。对话的「首次使用引导」只是文字，要求教师自己去配模型和数据目录，助手没有工具代做。

---

## 6. 提示与工具不一致（汇总）

1. SOUL 的能力清单短于 `main` 的真实工具，尤其是成绩导入、批改、改班、存档、委托、看图。
2. `AGENTS.md` 比 SOUL 全，但仍漏考试查询三件套、标签、学生属性、批改查询、记忆、看图。两份说明会同时注入。
3. 系统提示文件表没有 `read_image`。技能段恒为空，技能靠官方 skill 工具，不靠这段提示。
4. 公共规则的确认名单和真正带 `confirm` 参数的工具不是同一批。确认不是界面点击。
5. `eaa_archive_class` 说可以恢复，没有恢复工具。
6. `eaa_grading_from_files` 的说明容易理解成「对话里能批改」。实际只覆盖建任务 + 松紧三档 + 默认 standard。极致 AI 和费用确认只在页面。
7. `AI_GRADING` 技能教查询口径，并引导教师去页面改分。它不教 `from_files` 的参数，也不提四种流程策略。
8. `bug-hunter` 要求跑测试，同时声明没有 shell。对话里选这个角色也不能跑测试。
9. `executor` 的说明覆盖备份和自维护，工具只有操行只读和文件。
10. 标准文档写技能可启用/停用；类型里没有启用字段。
11. 教师对话的行级关闭名单和连接中心的包级关闭名单不对齐。持久化 shell、terminal、ptc 执行器是否在 sdk 上仍可见，本仓库证明不了。
12. 提示词契约测试只防止 `AGENTS.md` 多写 `eaa_*`。挡不住 SOUL 少写，也挡不住「写了恢复但没有工具」。
13. 技能按「至少一只工具重叠」注入。`bug-hunter` 会拿到成绩、批改、周报三份技能，因为它们列了 `write_file` / `calculate`，但技能正文里的 `eaa_*` 它没有。

---

## 7. 缺的工具

相对「教师在对话里说了，就应落到现有产品数据上」。不含密钥和更新。

| 缺口 | 依据 |
| --- | --- |
| 批改流程策略 `fast` / `standard` / `dual` / `extreme`，以及极致模式的费用确认 | 工具只有 `grading_mode`；确认框只在页面 |
| 批改任务的后续操作：改策略、改量规、归组、合并、改分、重批、中止、删任务 | `grading` IPC 有，工具只有概览、单生、建任务、发布 |
| 打印与导出：套打、批注 PDF、汇总 CSV、家长报告 | 仅渲染层和 grading IPC |
| 学业：删考试、改分、删成绩、无 Excel 建考试 | `academic` IPC；工具只有查询和 Excel 导入 |
| 班级：恢复、硬删除 | `class.restore` / `class.delete`；工具只到存档 |
| 删除学生进入默认对话，且确认必须是教师点击而不是模型自填 `confirm` | 工具存在但 `main` 无 `delete`；页面另有确认 |
| 仪表盘：重放、导出 HTML | `eaa.replay`、`eaa.dashboard` 无工具 |
| 诊断：doctor / validate | 设置页 IPC，无工具 |
| 报告列表的专用查询 | 可退化为 `list_dir`，没有和报告中心同一排序的工具 |
| 定时任务的增删改和「现在跑」 | cron IPC；官方 schedule 工具被关 |
| 技能、MCP、插件、模型、WebUI、频道、备份 | 管理面。多数应继续只留页面；此处列出是为了标明对话碰不到 |

已有工具但默认对话未授权：`eaa_delete_student`。

---

## 8. 缺的技能

有工具、没有技能覆盖操作步骤的：

- `eaa_import_grades`（`ACADEMIC_ANALYSIS` 只教查询）
- `eaa_grading_from_files` / `eaa_grading_publish`（`AI_GRADING` 不把它们列进 `tools`，也不写策略和极致模式）
- `delegate_to`（只在 `AGENTS.md` 路由表）
- `read_image`（无技能；批改技能仍把看卷推回页面）
- `save_memory`（只在公共规则和 SOUL 的记忆段）

有技能、动作停在提示词、没有落库或送达工具的：

- `RISK_INTERVENTION`：干预动作和家校时机。不能记一条「已干预」，不能发送。
- `home_school` 角色同理：草稿可以写文件，不能发到连接中心，也不能走学生页的打印。
- `WEEKLY_REPORT_GUIDE`：能写 Markdown。没有「在报告中心发布」这一步，因为报告中心就是读那个目录。

整段产品流程既没有专用工具、也没有技能：

- 极致 AI / 双评 / 快改，以及费用确认
- 教师改分、重批、归组、套打
- 学业改分与删考试
- 班级恢复
- 仪表盘导出与事件重放
- 定时任务
- 模型与密钥、隐私库、备份、WebUI、频道登录、插件开关

---

## 9. 建议的优先级（只建议，本文件不实现）

**先补提示，避免说了做不到或没说却以为不能。** 把 SOUL 和 `AGENTS.md` 收成同一份能力表；删掉或改写「存档后可再恢复」；在批改角色规则里写明对话建任务只有松紧三档、策略为 standard、极致模式请到批改页。成本是文档，不改工具。

**第一优先的产品缺口：批改策略和复核。** 对话已经能建任务并发布，教师会以为「极致批改」也能说出来。页面上的四档策略、费用确认、改分、重批、归组都还在 IPC 里。若要对话办成，需要新参数或新工具，并且极致模式的确认不能再用模型自填的 `confirm`。在此之前，技能 `AI_GRADING` 应覆盖 `from_files` 的真实参数，避免模型编造 `extreme`。

**第二：学业改分 / 删考试，班级恢复。** 导入和存档已经在对话里，反向操作只在页面。存档文案已经承诺恢复。

**第三：补技能，不先造工具。** 成绩导入手册；委托何时用、何时自己办；看图和批改任务的分工。`RISK_INTERVENTION` 保持「只出建议」也可以，但应在技能里写明没有发送和记干预的工具。

**继续留在页面，不必做成对话工具：** API Key 与模型目录、更新与恢复出厂、隐私库密码、打印预览与打印机、连接中心扫码、插件安装、WebUI 证书。诊断 doctor/validate 若教师经常在对话里问「数据有没有坏」，可以单独立项，优先级低于批改和改分。

**关闭名单：** 把连接中心已经按包名关掉的 persistent shell、terminal、ptc 执行器，核对进教师对话的行 id 名单。核对需要 dsh-base 的补丁原文，本调研没有那份文件。
