# 方案：请假/考勤台账 正式方案（含 AI 可知性与可调用性调研）

- 日期：2026-09-13
- 背景：尼克木果（高三5班）请假赴康定考试，AI 无处登记——操行原因码全是加减分（`config/reason-codes.json` 无中性码），只能 save_memory 打备忘补丁（14 天时效、无结构、教师难见）。
- 本文是正式方案 + 调研结论，未实施代码。

## 1. 目标与非目标

**目标**
1. 请假成为一等数据：结构化（学生/起止日期/事由/状态）、可查（教师+AI）、可管理（录入/销假）。
2. AI **能知道**：不问也知道的被动注入 + 主动查询工具，双通道。
3. AI **能调用**：对话里说"尼克木果请假到周二"即可登记，说"销假"即可撤销，走既有写操作治理（复述确认/dry_run）。
4. 联动：旷课判定、月勤奖励（MONTHLY_ATTENDANCE）发放前提示核对出勤。

**非目标**
- 不动操行分体系：请假不产生任何分值变动（不新增 0 分原因码，理由见选型 B）。
- 不做完整考勤打卡（每日到课登记）——只做"请假事由登记"，考勤统计留给未来。
- 不做审批流（教师一人使用，无多级审批场景）。

## 2. 存储选型

| 方案 | 说明 | 结论 |
|---|---|---|
| A. workstation.db 新增 `leaves` 表（better-sqlite3） | 与 classes/academics/grading 同模式：JS 侧服务直接读写，备份（backup-service 备 workstation.db）自动覆盖，迁移=CREATE IF NOT EXISTS 幂等 | ✅ **采用** |
| B. EAA 加 0 分原因码 `LEAVE` | 与分数体系耦合；Rust 端对 delta=0 的校验行为未知（v3.2.7 曾有 0.0 校验失败先例，`reason-codes.ts` 注释）；事件流会被非分值记录污染，排行榜/统计需处处排除 | ❌ 否决 |
| C. 飞书 bitable 台账 | 外部依赖，断网不可用；当前 bitable 仅做心跳同步无读回 | ❌ 否决 |
| D. 继续 save_memory 备忘 | 无结构、14 天时效、教师不可见于业务面 | ❌ 仅作过渡（现状） |

## 3. 数据模型（M1）

```sql
CREATE TABLE IF NOT EXISTS leaves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_name TEXT NOT NULL,            -- 与 EAA 实体名对齐（成绩/操行同名体系）
  class_id TEXT,                          -- 冗余存班级编号，列表过滤用
  start_date TEXT NOT NULL,               -- YYYY-MM-DD
  end_date TEXT NOT NULL,                 -- 含当日；end>=start 服务层校验
  reason TEXT NOT NULL DEFAULT '',        -- 事由（赴康定考试/病假…）
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  source TEXT NOT NULL DEFAULT 'ui' CHECK(source IN ('ui','ai')),
  note TEXT,                              -- 备注（缺考备案标注等）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cancelled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_leaves_student ON leaves(student_name);
CREATE INDEX IF NOT EXISTS idx_leaves_range ON leaves(start_date, end_date);
```

- 服务层 `leave-service.ts`（新建，模式照抄 `class-service.ts`）：`add / cancel / update / listByStudent / listByRange / listActive`（active 且 end_date >= 今天）。
- 输入校验：姓名必须存在于 EAA 实体（防错别字产生孤儿记录——可调 `eaa_list_students` 校验或直接 spawn CLI 校验，M1 先做非空+格式校验，实体校验 M2）；日期 `end>=start`；跨年不限制。
- 备份/恢复/出厂重置：workstation.db 已在 backup-service/factory-reset 覆盖范围内，零额外工作。

## 4. IPC 面（M1）

- `leave:list`（Q）——筛选：class_id / student_name / 日期区间 / status；返回按 start_date 倒序。
- `leave:add`（W）、`leave:update`（W，改期/改事由）、`leave:cancel`（W，软销假，记录 cancelled_at）。
- 不做 `leave:delete` 硬删——登记错误用 cancel（写错学生名这种极少数情况由教师用 cancel+重新登记；保留痕迹比硬删安全）。

## 5. UI 设计（M3）

1. **仪表盘卡片「请假动态」**（首屏，与本次新增的 AI 备忘卡片同区）：显示"进行中/未来 7 天"的 active 请假（姓名·班级·起止·事由），空态显示"近期无请假"；点击行跳学生档案请假 Tab。
2. **学生档案新增「请假」Tab**（StudentProfile 第 7 个 Tab）：该生请假历史时间线 + 「登记请假」内联表单（起止日期/事由/备注）+ 行内「销假」按钮（ConfirmDialog）。
3. 学生页表格不加列（保持现有信息密度，请假是档案维度不是花名册维度）。

## 6. AI 集成（M2）——本次调研核心

### 6.1 AI 能不能知道？→ 双通道，都能

**通道一（被动注入，不问也知道）**：system prompt 新增 `--- 请假动态 ---` 段（`class-context.ts` 同模式，拼在"当前班级"段后）：
- 内容：当前进行中（start<=今天<=end，active）与未来 7 天内开始的请假，逐条"姓名（班级）：9/14–9/15 赴康定考试"。
- 空态输出"（当前无进行中或即将开始的请假）"——让 AI 明确知道"没有"而不是"没查"。
- 缓存：5 分钟 TTL（与班级上下文一致）；leave 写操作后主动失效。
- 脱敏：注入前 anonymize（照抄长期记忆段的处理，`execution.ts` L258 一致）。
- 体量控制：上限 20 条 + "更多用 eaa_leaves 查询"。

**通道二（主动查询）**：新工具 `eaa_leaves`（读，capability `read`/`leave`）：
- 参数：student_name? / class_id? / date_from? / date_to? / include_cancelled?（默认否）。
- 返回结构化列表（含 status/source/创建时间）。教师问"尼克木果为什么没来""上月谁请过假"→ AI 查询后回答，并引用请假记录而非误判旷课。

### 6.2 AI 能不能调用（写）？→ 能，走既有治理

| 工具 | capability | 发给谁 | 治理 |
|---|---|---|---|
| `eaa_leave_add`（学生/起止/事由/备注?/dry_run?） | `write`/`leave_add` | main、class-monitor、student-care | 实体名校验（不存在的学生报错提示先 eaa_list_students）；dry_run 预演；默认 source='ai' |
| `eaa_leave_cancel`（id 或 学生+日期/reason） | `write`/`leave_cancel` | main、class-monitor | confirm:true 强制（销假影响出勤口径） |
| `eaa_leave_update`（改期/改事由） | `write`/`leave_add` | main | dry_run 支持 |

- 注册进 `registry.ts` 的 `allEAATools` + capability 映射，自动获得：wrapTool 脱敏包装（入参化名→真名）、AbortSignal、统一 textResult。
- **project-context.md 补一段**：请假/销假台账的语义（"请假不算旷课、不扣操行分；月勤发放前核对 eaa_leaves"），让全体 agent 知道该数据存在。

### 6.3 隐私与安全

- 请假含学生姓名+事由（可能含健康信息"病假"）→ 全链路沿用脱敏：工具结果出域 anonymize、save_memory 之外的持久层存真名（本地数据基准态）。
- AI 只能经工具读写 leaves，无文件路径暴露（与 EAA 同级别隔离）。

## 7. 联动设计（M4，打磨）

1. **旷课判定**：AI 回答"谁没来"类问题时，prompt 注入段已提供当日在假名单——无需改 eaa 查询工具。
2. **月勤奖励**：MONTHLY_ATTENDANCE 加分前，规则提示 AI 先 eaa_leaves 查当月请假核对出勤天数（project-context 措辞即够，不强制拦截）。
3. **缺考备案**：成绩导入（eaa_import_grades）对缺考学生，若当日在假则在 note 提示可标注"请假缺考"——v2 再做，先把 note 字段留足。

## 8. 阶段计划

| 阶段 | 内容 | 交付判据 |
|---|---|---|
| M1 | leaves 表 + leave-service + IPC + 单测 | 建表幂等；CRUD 单测绿；备份覆盖验证 |
| M2 | AI 工具 ×3 + prompt 注入段 + project-context 更新 + agents.yaml capability | 装机对话"XX 请假到周二"→ AI 调 eaa_leave_add 落库；重启会话后 AI 仍知道（注入段生效） |
| M3 | 仪表盘请假动态卡 + 学生档案请假 Tab + i18n + 测试 | 首屏可见；登记/销假全流程 UI 可操作 |
| M4 | 月勤/缺考联动打磨、导出 | 按需 |

## 9. 存量数据迁移

- 尼克木果的 task 备忘（2026-09-13 存于 `memory/main.json`）：M2 上线后由教师在对话里让 AI 重新登记为正式请假（或 UI 手工录入），确认落库后在 设置→记忆管理 删除该条备忘。不写自动迁移脚本（仅 1 条，脚本成本>收益）。

## 10. 风险与开放问题

- **student_name 关联键**：leaves 用姓名而非 EAA entity_id（JS 侧拿不到稳定 id 映射，成绩/操行侧已是姓名体系）——重名学生需靠班级消歧，`class_id` 冗余列即为此留。若未来 EAA 开放 entity_id 查询接口可平滑升级。
- **日期语义**：end_date 含当日；"下周二"这类相对日期由 AI 用 get_current_time 推算后传绝对日期（本次事件已证明 AI 推算正确）。
- **多 agent 并发写**：better-sqlite3 同步写，无并发问题。
