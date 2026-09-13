# 调研：界面信息 × AI 知情权/写权限 全量审计

- 日期：2026-09-13
- 起因：尼克木果请假事件暴露两个问题——①AI 说"备忘已存好"但教师在界面上从未见过备忘（入口只在 设置→记忆管理，过深）；②操行系统没有请假类原因码，正当事由无处留痕。
- 本文回答四个问题（对界面上显示的每一类信息）：
  1. AI **该不该**知道？
  2. AI **是否已经**能知道（通过什么机制）？
  3. 该信息在 UI 上**能否修改**？
  4. 是否应该给 AI **修改权限**？

## 0. 审计基准

- UI 全量盘点：13 个业务页 + 设置 10 个 Section + 连接中心/通知中心/命令面板（`src/renderer/pages/`、`src/renderer/layouts/MainLayout.tsx`）。
- AI 能力面：`buildAgentTools`（`src/main/services/agent/tools.ts`）= EAA 工具（`src/main/services/eaa/tools/registry.ts`，按 capability 门控）+ 全员工具（read_file/read_excel/write_file/write_excel/write_csv/list_dir/get_current_time/calculate/save_memory）+ delegate_to（仅 main）/escalate_to_main + 动态 MCP 工具。
- 被动知情通道：system prompt 注入（`src/main/services/agent/system-prompt.ts`）——SOUL/项目背景/当前班级（不含花名册名单）/可用技能/公共规则/角色规则/长期记忆（14 天时效的 task 备忘）/风险阈值/运行环境/工作准则/对话配置。
- 写操作治理：公共规则要求"写操作先复述确认"；危险工具（eaa_delete_student、eaa_archive_class、eaa_grading_from_files/publish）强制 `confirm:true`；capability 按 agent 角色分配（`config/agents.yaml` + `agents.user.yaml` 覆盖）。

## 1. 总审计表

图例：✅ 是 / ❌ 否 / ⚠️ 部分。AI 已知列注明机制（工具名 = 主动查询；注入 = system prompt 被动获得）。

| # | 信息域 | UI 展示位置 | UI 可改 | AI 该知道 | AI 已能知道 | AI 已能改 | 该给写权限 |
|---|---|---|---|---|---|---|---|
| 1 | 学生花名册（姓名/班级/操行分/风险/事件数） | 学生页表格 | ✅ 增/删/调班/批量导入 | ✅ | ✅ eaa_list_students / eaa_score / eaa_history | ✅ eaa_add_student / eaa_set_student_meta / eaa_import_students；删除=eaa_delete_student（独立 delete capability，当前无 agent 声明=默认禁用） | ✅ 现状合理（永久删除默认禁用是正确设计） |
| 2 | 学生扩展档案（身份证/电话/住址/学号/家长/健康） | 学生档案 ProfileTab 表单 | ✅ 表单编辑 + 导入写入 | ⚠️ 教育/沟通场景需要非敏感部分 | ⚠️ 仅间接：eaa_list_students 附带学号/考号；read_file 读 profiles/ 在脱敏开启时敏感列显示「(已隐藏)」 | ❌ 无专门写工具（仅导入时随花名册写入） | ⚠️ 建议给只读工具（脱敏后非敏感字段）；写权限不给（家庭信息误改风险大） |
| 3 | 操行事件/分数/撤销 | 学生档案事件 Tab、仪表盘 | ✅ 添加事件（AddEventInline）/撤销 | ✅ | ✅ eaa_history / eaa_search / eaa_tag / eaa_range / eaa_summary | ✅ eaa_add_event（dry_run+force 治理）/ eaa_revert_event | ✅ 已对齐 |
| 4 | 原因码表 | 事件录入下拉（来源 eaa_codes） | ❌（写死 `config/reason-codes.json`） | ✅ | ✅ eaa_codes | ❌ | ❌ 不给（教师级配置，AI 自改分值标准=失控） |
| 5 | 班级信息（名称/年级/班主任/存档） | 班级页 | ✅ 全套增改存档 | ✅ | ✅ eaa_list_classes | ✅ eaa_create_class / eaa_update_class / eaa_archive_class(confirm) | ✅ 已对齐 |
| 6 | 考试与成绩 | 学业页 4 Tab | ✅ 建考/删考/录入/AI 解析录入 | ✅ | ✅ eaa_exams / eaa_exam_grades / eaa_student_grades | ✅ eaa_import_grades（dry_run 治理） | ✅ 已对齐 |
| 7 | AI 批改任务/复核/发布 | 批改页 | ✅ 全套（建/导入/批改/改分/发布） | ✅ | ✅ eaa_grading_overview / eaa_grading_student | ✅ eaa_grading_from_files(confirm) / eaa_grading_publish(confirm) | ✅ 已对齐（复核改分留人，AI 只提交原始分） |
| 8 | 请假/考勤台账 | ❌ **不存在** | ❌ | ✅（旷课误判、月勤发放都要用） | ⚠️ 只有 save_memory 备忘（14 天时效、无结构、教师难见） | ❌ | ✅ 应有（独立于操行分）→ 见《请假台账正式方案》 |
| 9 | AI 对话历史/会话列表 | 对话页 | ✅ 删会话/清空 | ❌（AI 的输入=当前会话上下文，历史由会话机制管理） | —（不适用） | ❌ | ❌ 不需要 |
| 10 | Agent 配置/SOUL/角色规则 | Agent 控制台 | ✅ | ⚠️ 仅自身 SOUL/规则被注入 | ⚠️ 自身的注入；他人不可见 | ❌ | ❌ 不给（自改人格/规则=提示词注入面） |
| 11 | 模型/Provider/API Key | 模型页 | ✅ 录入/删除 Key | ❌ | ❌ | ❌ | ❌ 绝不给（密钥） |
| 12 | 技能（SKILL.md）/MCP 服务器 | 技能页 | ✅ 增删改/启停 | ⚠️ 可用技能列表已注入（按 capability 过滤） | ✅ 技能名+描述注入；正文可 read_file | ❌ | ❌ 不给（技能=指令，AI 自写技能=持久化提示词注入） |
| 13 | 定时任务（cron）及执行日志 | 任务页 | ✅ 全套 | ⚠️ AI 是任务执行者却看不到任务全貌 | ❌ 无 cron 读工具（仅触发时收到 prompt） | ❌ | ❌ 写不给（AI 自建定时任务=无人值守自我调度）；建议补只读 cron:list（低优先） |
| 14 | 隐私映射表（真名↔化名）/脱敏状态 | 隐私页 | ✅ init/load/add/lock | ❌ 设计上就不该（脱敏开启时 AI 只见化名） | ❌（wrapTool 自动还原入参，映射本身不可见） | ❌ | ❌ 绝不给 |
| 15 | AI 长期记忆/备忘 | 设置→记忆管理（**入口过深，本次问题①**） | ✅ 单条删/清空 | ✅（自己的记忆） | ✅ 注入（task 类 14 天时效） | ✅ save_memory（仅自己 agentId；无删除工具） | ⚠️ 现状合理；可选补"AI 删除自己某条记忆"能力（教师也可在设置删） |
| 16 | Agent 报告产物（周报/风险汇总） | 报告中心 | ⚠️ 只读 + 立即生成 | ✅ | ✅ read_file | ✅ write_file（产物即 AI 写的） | ✅ 已对齐 |
| 17 | 应用设置（settings.json：主题/更新/压缩/频道配置…） | 设置页 10 个 Section | ✅ | ⚠️ 仅对话配置（steering/followUp/showImages）被注入 | ⚠️ 注入对话配置；其余不知 | ❌ | ❌ 不给（系统级配置）；间接影响（脱敏开关、阈值）已由系统消化 |
| 18 | 消息频道状态（飞书/钉钉/企微连接） | 连接中心弹层 + 设置 | ✅ 配置/启停 | ⚠️ main 建议话术时最好知道"能不能推送" | ❌ 无工具（project-context 已声明"无发家长消息的工具"边界） | ❌ | ❌ 写不给；可选补只读 channels:list 状态（低优先） |
| 19 | WebUI 接入状态/二维码 | 连接中心 | ✅ | ❌ | ❌ | ❌ | ❌ 不给 |
| 20 | 日志（main/chat/renderer） | 设置→日志 | ✅ 查看/清空/导出 | ❌（排障是教师/开发者场景） | ⚠️ read_file 理论可达（运行环境声明了完整文件系统），无专用工具 | ❌ | ❌ 写不给（清日志破坏排障证据） |
| 21 | 备份/恢复 | 设置→数据 | ✅ 备份/恢复（危险确认） | ❌ | ❌ | ❌ | ❌ 不给 |
| 22 | 通知中心内容（运行结果/任务状态） | 顶栏铃铛面板 | ⚠️ 已读/清空 | ❌ | ❌ | ❌ | ❌ 不需要 |

## 2. 分域详评

### 2.1 已对齐良好的域（1/3/5/6/7/16）
教师业务数据（学生、操行、班级、成绩、批改、报告）呈现"UI 与 AI 同源同权"格局：同一份数据，UI 走 IPC、AI 走 eaa_* 工具，底层同一服务（成绩/班级是 JS 侧服务，操行是 Rust CLI）。写操作有统一治理（复述确认协议、dry_run 预演、confirm:true 危险门、capability 角色门控、delete 默认无人持有）。**这是本应用最健康的部分，不需要动。**

### 2.2 缺口①：请假/考勤台账（#8）——本次问题②的根源
- 现状：无存储、无 UI、无工具。AI 用 save_memory 打临时补丁，但备忘 ①教师看不见（问题①）②14 天后不再注入（AI 会"忘"）③无结构（起止日期/事由/销假状态都是自然语言）。
- 影响：旷课误判风险（时效过后）、月勤奖励（MONTHLY_ATTENDANCE）发放无出勤依据、缺考备案只能口头。
- 详见《请假台账正式方案》（2026-09-13-leave-attendance-formal-plan.md）。

### 2.3 缺口②：学生扩展档案读取（#2）
- UI 可改（ProfileTab 表单），AI 只能间接拿到学号/考号（eaa_list_students 附带）；问"张三家长电话/住址"答不出。
- 隐私考量：身份证/电话/住址在脱敏开启时 read_excel/read_file 已按敏感列隐藏——说明系统有意识地限制。**建议维持限制**，若要补只读工具，只暴露非敏感字段（学号、考号、家长姓名可再议），敏感字段（证件号/电话/住址/健康）永远走「(已隐藏)」。

### 2.4 缺口③：定时任务可见性（#13）
- AI 是 cron 任务的执行者，但看不到任务列表与自己的排期。教师问"你每天几点干什么"AI 只能靠记忆推测。
- 建议低优先补只读 `cron_list` 工具；写权限坚决不给（自建定时任务=无人值守自我调度，与"写操作先确认"协议冲突）。

### 2.5 缺口④：频道状态可见性（#18，可选）
- project-context.md 已声明"无发家长消息的工具，禁止声称已通知家长"——边界正确。
- 若希望 main 在家校沟通话术里准确说"可通过 App 推送"，可补只读 channels 状态工具；不改配置。优先级最低。

### 2.6 明确不该给的（#4/#9/#10/#11/#12/#14/#17/#19/#20/#21）
理由分布三类：密钥与隐私映射（安全红线）；提示词面（SOUL/规则/技能/MCP——AI 自改=持久化提示词注入）；系统运维面（设置/备份/日志/恢复——影响可用性与排障，且 AI 无需参与）。

### 2.7 记忆/备忘（#15，本次问题①）
- 数据闭环已存在（save_memory 写、注入读、设置页可删），唯一问题是**可见性**：入口在 设置→记忆管理，教师不知道。
- 处置：仪表盘（首屏 `/dashboard`）新增"AI 备忘"卡片（本次已实施）；管理动作（删/清空）仍留在设置页，不在首屏重复确认流。

## 3. 结论

1. **总体架构判断：对齐良好。** 教师业务数据读写双通且有治理；系统/安全域全部隔离。没有发现"UI 可改且 AI 不该知道却已知道"的越权项，也没有"密钥/隐私泄漏给 AI"的通道。
2. **四个缺口按优先级**：请假台账（P0，另立方案）＞ 备忘可见性（P0，本次已实施首屏卡片）＞ 学生档案只读（P2）＞ cron 只读/频道状态只读（P3）。
3. **一条架构原则值得延续**：新功能上线时同步回答四问——本应用已有惯例是"教师业务=双通道（IPC+工具），系统配置=单通道（仅 IPC）"，请假台账方案沿此设计。
