# Education Advisor 全面审查报告

> 审查时间：2026-06-10 | 审查范围：Bug、功能缺陷、优化方向、模块勾连、文字统一性

---

## 一、Bug 清单（共 9 项）

### 🔴 BUG-1 [高] 成绩非法输入静默转为 0
- **文件**: `StudentProfile.tsx:1245`
- **问题**: `parseFloat(value) || 0` — 输入 `"abc"` 时 NaN 被 `||` 吞掉变成 0。0 分是合法分数，无法区分"误输入被默认为0"和"确实录入0分"
- **修复**: 无效输入保持原值，不写入

### 🔴 BUG-2 [高] 取消编辑不恢复原始数据
- **文件**: `StudentProfile.tsx:1324-1327`
- **问题**: 点击"取消"只是 `setEditing(false)`，编辑过程中的修改已直接写入状态，未做快照恢复
- **修复**: 进入编辑时保存快照，取消时恢复

### 🔴 BUG-3 [高] 平均分/偏科分析排除 0 分
- **文件**: `StudentProfile.tsx:1132, 1142`
- **问题**: `filter(v => v > 0)` 排除 0 分成绩，0 分不参与平均计算，也不参与偏科分析，导致平均分偏高、偏科判断失真
- **修复**: 改为 `v >= 0`（同时排除 null/undefined/NaN）

### 🟡 BUG-4 [中] 排名输入允许负数
- **文件**: `StudentProfile.tsx:1508, 1523`
- **问题**: `parseInt("-3") || undefined` — `-3` 是 truthy，负数排名可存入；而 `0 || undefined` 反而丢失 0
- **修复**: 限定排名为正整数 `rank > 0 ? rank : undefined`

### 🟡 BUG-5 [中] number 类型字段通过 updateForm 存为字符串
- **文件**: `StudentProfile.tsx:604, 773-774`
- **问题**: `updateForm` 统一以 string 写入，`attendanceRate`（number 类型）存入后变成 `"95.5"` 字符串，违反类型定义
- **修复**: number 字段应做类型转换

### 🟡 BUG-6 [中] subjects 类型定义与校验逻辑不一致
- **文件**: `types/index.ts:533` vs `profile-service.ts:131`
- **问题**: 类型声明 `Record<string, number>` 不允许 null，但后端校验 `score !== null` 明确允许 null
- **修复**: 统一类型定义为 `Record<string, number | null>`

### 🟡 BUG-7 [中] 0 分成绩显示为 "-"，与未录入无法区分
- **文件**: `StudentProfile.tsx:1468-1469`
- **问题**: `rec.subjects[sub] > 0 ? rec.subjects[sub] : '-'` — 0 分和未录入都显示 "-"
- **修复**: 区分显示，0 分显示数字，未录入显示 "-"

### 🟡 BUG-8 [中] 判重逻辑在 date 缺失时不可靠
- **文件**: `profile-service.ts:269-270`
- **问题**: 当 date 为 undefined 时，`r.date === record.date` 判断可能让同次考试被录入两次
- **修复**: date 缺失时仅按 examName + examType 判重

### 🟡 BUG-9 [中] 前后端迁移逻辑重复且不一致
- **文件**: `StudentProfile.tsx:1111-1129` vs `profile-service.ts:146-163`
- **问题**: 前端处理 `monthlyExam1Grades`/`monthlyExam2Grades`，后端不处理；后端处理 `midtermGrades`/`finalGrades`，前端不处理；后端迁移每次读取都执行但不持久化
- **修复**: 迁移逻辑统一在后端，执行后持久化

---

## 二、功能缺陷（共 10 项，含模块勾连缺失）

### 🔴 S1 [严重] Privacy 引擎与所有学生数据页面完全脱钩
- `anonymize`/`filter`/`deanonymize`/`enable`/`disable` API **从未被任何页面调用**
- StudentsPage、StudentProfile、Dashboard 排行榜全部明文展示学生姓名、身份证、电话、家庭住址
- 隐私引擎形同虚设——开启后无任何实际效果
- **建议**: 在 StudentProfile/StudentsPage 展示前调用 `privacy.filter()`；添加全局隐私状态指示器

> **✅ 状态：已修复（2026-06-11 复核）**
>
> 4 个数据展示页面（Dashboard / StudentsPage / StudentProfile / ChatPage）已全部接入隐私脱敏：
>
> | 页面 | 接入点 | 范围 |
> |:---|:---|:---|
> | `DashboardPage` | 排行榜 `rankingDisplay` | 学生名 → 化名 |
> | `StudentsPage` | 名单 `displayNames` | 学生名 → 化名 |
> | `StudentProfile` (父) | `displayName` | 学生名 → 化名 |
> | `StudentProfile` (ProfileTab) | 8 个 PII 字段 `displayPII` | idCard/phone/email/address/fatherName/fatherPhone/motherName/motherPhone |
> | `ChatPage` | 消息气泡 `<PrivacyFilteredText>` | 整段文本 → 化名（流式中最后一条 bypass 避免闪烁）|
>
> PrivacyPage 补全了 enable/disable 按钮 + `settings.privacy.enabled` 持久化（usePrivacyFilter 启动时读取 + `onStateChanged` 订阅实时切换）。
>
> 共享基建：
> - `src/renderer/hooks/usePrivacyFilter.ts`（162 行）— 单/批脱敏 + 缓存 + 订阅
> - `src/renderer/components/PrivacyFilteredText.tsx`（45 行，新建）— 通用脱敏文本包装
> - `IPC_PRIVACY_STATE_CHANGED` 已注册 + `privacy-handlers` 在 enable/disable 成功时广播
> - `shared/types/index.ts:499` `privacy: { enabled, autoAnonymize }` 已定义
>
> 验证：`npx tsc --noEmit` exit 0，无类型错误。已知的 2 个 typecheck 错误（Dashboard 缺 import / StudentProfile `displayName` 引用）已修复。
>
> **未做（用户接受范围外）**：
> - MainLayout 顶部全局"隐私模式"选择器（real/parent/public）— 当前依赖 PrivacyPage 的开关控制全局 `enabled`，未做 per-page 切换
> - 第三方 chat 输入框 / 工具调用 args 的脱敏（args 段是结构化 JSON，按"已知学生姓名"模糊匹配风险可控）

### 🔴 S2 [严重] Skills 与 Agent 完全隔离
- 技能定义与 Agent 运行时无数据通路，Skill 内容不会被注入 Agent prompt
- `skill.list()`/`skill.get()` 只在 SkillsPage 使用，Agent 执行流程中无任何代码路径读取 Skill
- **建议**: 在 Agent 的 system prompt 组装时注入关联的 Skill 内容；Skills 页面增加"分配给 Agent"功能

### 🔴 S3 [严重] 几乎没有跨页面导航跳转
- 整个项目只有侧边栏 NavLink，无任何页面内程序化跳转
- 缺失跳转：

| 起始页 | 应跳转到 | 触发点 |
|--------|---------|--------|
| Dashboard | Students | 统计卡片、排行榜学生名 |
| Students | Chat | "带学生上下文对话"按钮 |
| Students | Agents | AI分析Tab的Agent列表 |
| Scheduler | Agents | TaskCard的Agent名 |
| Agents | Scheduler | Agent的schedule配置 |

### 🟡 M1 Dashboard 不展示 Agent/Scheduler/Privacy 运行状态
- `agentStore` 已在 MainLayout 初始化，但 Dashboard 完全未使用
- 建议增加"系统状态"区域，展示 Agent 运行数、定时任务状态、隐私引擎状态

### 🟡 M2 StudentProfile AI 分析与 Chat 页面隔离
- 两处运行 Agent 结果互不可见，无"将学生上下文带入 Chat"功能
- 建议增加"在对话中讨论此学生"按钮

### 🟡 M3 Agent 执行结果不会自动刷新 StudentsPage
- Agent 通过 eaa-tools 操作数据后，前端无推送刷新机制
- 建议通过 IPC 事件通知前端刷新

### 🟡 M4 Scheduler 日志与 Agent 执行历史不共享
- `CronLogEntry` 和 `AgentExecution` 两套数据模型，无法互相关联
- 建议统一执行 ID 或增加关联字段

### 🟡 M5 Agent 配置的 schedule 字段只读，无法直接创建定时任务
- AgentsPage 展示 schedule 但不能编辑，需手动去 Scheduler 页面
- 建议在 Agent 详情中增加"为此 Agent 创建定时任务"快捷按钮

### 🟡 M6 排名手动输入而非自动计算
- `classRank`/`gradeRank` 是手动录入字段，与 EAA ranking 系统功能重复
- 建议排名从 EAA 自动获取，或提供"从排名系统同步"按钮

### 🟡 M7 成绩无满分设定机制
- 分数上限硬编码为 300，无按科目/考试类型设定满分
- 导致偏科分析直接比原始分（不同满分科目无法比较）
- 建议在 `AcademicExamRecord` 增加 `fullScore` 字段，偏科分析基于得分率

---

## 三、优化方向（共 15 项，均可行且方便）

### 📐 交互优化

| # | 优化项 | 现状 | 建议 | 收益 |
|---|--------|------|------|------|
| O1 | 成绩批量录入 | 每次只能手动添加一次考试 | 支持从 Excel/CSV 批量粘贴 | 减少录入时间 80%+ |
| O2 | 考试名自动补全 | 每次手动输入 | 记录历史考试名，输入时自动补全 | 减少重复输入 |
| O3 | 成绩趋势图 Y 轴自适应 | 固定 min:0 | 高分段数据自适应范围 + 缩放 | 成绩波动一目了然 |
| O4 | 成绩表格分页/虚拟滚动 | 无限制渲染 | 分页或虚拟滚动 | 大数据量不卡 |
| O5 | 删除撤销机制 | 删除即永久 | 5 秒 Toast 内可撤销 | 防误操作 |
| O6 | 未保存修改提示 | 离开不提示 | 检测脏状态，离开前提示 | 防数据丢失 |
| O7 | "带学生上下文对话"快捷入口 | 无 | 在 StudentProfile 添加按钮，跳转 Chat 时自动注入学生摘要 | 工作流贯通 |
| O8 | Dashboard 统计卡片可点击 | 纯展示 | 卡片/排行榜条目可点击跳转 | 仪表盘变导航枢纽 |
| O9 | 科目列表持久化 | 切学生/刷新后丢失 | 从已有成绩记录动态提取或存入 Profile | 不重复添加科目 |

### 📐 数据优化

| # | 优化项 | 现状 | 建议 | 收益 |
|---|--------|------|------|------|
| O10 | 偏科分析基于得分率 | 直接比原始分 | 按满分换算百分比后比较 | 跨科目可比较 |
| O11 | IPC profile.set 改增量更新 | 全量覆盖写入 | 使用 `profileService.update()` 增量合并 | 防并发数据丢失 |
| O12 | 前后端校验统一 | 各自独立校验 | 前端调用 `validateAcademic` IPC（已注册但未使用） | 校验规则一致 |
| O13 | `AcademicExamRecord` 增加唯一 ID | 无 ID，React 用数组索引 | 增加 `id: string` (UUID) | 列表渲染稳定、判重可靠 |

### 📐 架构优化

| # | 优化项 | 现状 | 建议 | 收益 |
|---|--------|------|------|------|
| O14 | REASON_CODE_LABELS 改为动态获取 | Dashboard 硬编码 22 条与 reason-codes.json 重复 | 调用 `eaa.codes()` API | 数据源统一 |
| O15 | profileService.get() 增加缓存 | 每次读取完整迁移+脱敏 | 内存缓存(TTL) | 减少重复计算 |

---

## 四、模块勾连缺失详细图

```
┌────────────┐     ┌────────────┐     ┌────────────┐
│ Dashboard  │     │  Students  │     │    Chat     │
│            │ ✗→  │            │ ✗→  │            │
│ [卡片不可点]│     │ [无跳Chat] │     │ [无关联学生]│
└─────┬──────┘     └──────┬─────┘     └────────────┘
      │                   │
      │ ✗ 不展示           │ ✗ Privacy未脱敏
      │ Agent/Scheduler    │
      │ Privacy状态        │
      ▼                    ▼
┌────────────┐     ┌────────────┐     ┌────────────┐
│   Agents   │ ✗→  │ Scheduler  │     │  Privacy   │
│            │     │            │     │            │
│ [schedule  │     │ [无法跳转   │     │ [脱敏API   │
│  只读]     │     │  Agent详情] │     │  从未调用] │
└──────┬─────┘     └────────────┘     └────────────┘
       │ ✗ Skills无关联
       ▼
┌────────────┐
│   Skills   │
│            │
│ [无法分配   │
│  给Agent]  │
└────────────┘

✗ = 勾连缺失
```

### 应建立的勾连关系

| 来源模块 | 目标模块 | 触发方式 | 勾连内容 |
|---------|---------|---------|---------|
| Dashboard | Students | 点击统计卡片/排行榜 | 导航到 Students 并选中该学生 |
| Students | Chat | 按钮点击 | 跳转 Chat 并注入学生上下文 |
| Students | Agents | AI分析Tab中的"管理Agent"链接 | 跳转 Agents 页面 |
| Agents | Scheduler | "为此Agent创建定时任务"按钮 | 跳转 Scheduler 预填 agentId |
| Scheduler | Agents | 点击日志中的Agent名 | 跳转 Agents 查看详情 |
| Privacy | Students/Dashboard | 全局中间件 | 展示前调用 filter/anonymize |
| Skills | Agents | "分配给Agent"功能 | Agent prompt 注入 Skill |
| Dashboard | Agents/Scheduler/Privacy | 状态展示区 | 展示运行状态 |

---

## 五、文字统一性问题（共 5 类 30+ 处）

### 1. 硬编码中文未走 i18n（最严重）

至少 30 处有对应 i18n 键但未使用 `t()`，切换英文后仍显示中文。重点页面：
- **ChatPage**: "对话"/"模型" 硬编码
- **StudentsPage**: 标题、搜索框、按钮全硬编码
- **AgentsPage**: 状态标签硬编码（且与 i18n 值不一致——"错误" vs "异常"、"就绪" vs "空闲"）
- **SkillsPage**: 标题、空态提示全硬编码
- **SchedulerPage**: 按钮文字硬编码
- **PrivacyPage**: 大量文字硬编码
- **StudentProfile**: 概览卡片、档案区、学业区全硬编码
- **SettingsPage**: label 属性直接用中文

### 2. 术语不一致

| 术语A | 术语B | 位置 | 应统一为 |
|-------|-------|------|---------|
| 就绪 | 空闲 | Agent状态(idle) | 建议统一为"空闲" |
| 错误 | 异常 | Agent状态(error) | 建议统一为"异常" |
| 停用/启用 | 禁用/启用 | Agent开关 | 建议统一为"禁用/启用" |
| 暂无日志 | 暂无执行日志 | Scheduler空态 | 统一为"暂无执行日志" |

### 3. 标点符号混用

- 全角括号 `（）` vs 半角括号 `()`：SCORE_ORDER 和 i18n 键不统一
- 问号：半角 `?` vs 全角 `？`：confirm 对话框不统一
- 引号：`""` vs `''` vs `""`：确认提示不统一

### 4. typo

- `agents.yaml` 中 `validator` 的 name 为"数据**效验**AI"，应为"数据**校验**AI"

### 5. 页面标题风格不统一

| 页面 | 字号 | 是否i18n | 备注 |
|------|------|---------|------|
| Dashboard | text-2xl | ✓ | 渐变色 |
| Students | text-xl | ✗ 硬编码 | 带数量后缀 |
| Chat | 无标题 | — | 完全缺失 |
| Agents | text-lg | ✓ | — |
| Models | text-2xl | ✓ | — |
| Skills | text-sm(h2) | ✗ 硬编码 | 用 h2 非 h1 |
| Scheduler | text-xl | ✓ | — |
| Privacy | text-2xl | ✓ | — |
| Settings | text-2xl | ✓ | — |

---

## 六、优先级排序建议

### 立即修复（影响数据准确性）
1. BUG-1 成绩非法输入静默转0
2. BUG-3 平均分/偏科排除0分
3. BUG-2 取消编辑不恢复数据

### 尽快修复（影响功能完整性）
4. S1 Privacy 引擎脱钩（隐私安全）
5. S3 跨页面导航缺失
6. BUG-5 number 字段存为字符串
7. BUG-7 0分显示为"-"

### 计划修复（影响体验和一致性）
8. S2 Skills 与 Agent 隔离
9. M1 Dashboard 状态展示
10. M2 学生上下文与 Chat 贯通
11. M7 成绩满分设定机制
12. 文字统一性（30+处硬编码 i18n 修复）

### 后续优化
13. O1-O15 各项优化
14. O10-O15 架构级优化

---

*报告完*
