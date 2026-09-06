---
name: STUDENT_MANAGEMENT
description: 学生操行数据操作手册 — 何时用哪些 eaa_* 工具、write 类工具的参数与约束（dry_run/force/撤销）；适合「怎么加分扣分/撤销/查名单」类操作问题。通用规则（先确认/数据即工具）不在此重复，见系统自动注入的公共规则。
tools: [eaa_score, eaa_history, eaa_search, eaa_list_students, eaa_codes, eaa_stats, eaa_summary, eaa_ranking, eaa_range, eaa_tag, eaa_add_event, eaa_revert_event, eaa_add_student]
---

# 学生管理操作手册（技能）

本技能聚焦**操作参数与约束**；通用行为规则（数字来自工具、写操作先复述确认、化名）由公共规则注入，此处不重复，阅读本技能即可专注工具用法。

## 查询类工具

| 工具 | 用途 | 关键参数 |
|:-----|:-----|:-----|
| `eaa_score` | 单生分数 + 风险等级 | `name` |
| `eaa_history` | 单生事件时间线（撤销前先查 event_id） | `name`，可选 `limit` |
| `eaa_search` | 按关键词搜事件 | `query`，可选 `limit`（结果可能被截断，注意 events_truncated 字段） |
| `eaa_list_students` | 学生名单（含 class_id / 学号 / 性别） | 无 |
| `eaa_ranking` | 排行榜（**分数从高到低**，默认前 10 名） | `n`；找低分学生传大 n 后看末尾 |
| `eaa_stats` / `eaa_summary` | 班级统计 / 区间汇总 | 可选范围 |
| `eaa_codes` | 原因码全表（分值以此为准） | 无 |
| `eaa_tag` / `eaa_range` | 按标签查 / 按时间段汇总 | `tag` / `start`+`end` |

> 学生姓名参数：查询类工具用 `name`，仅 `eaa_add_event` 用 `student_name` — 不要混用。

## 写入类工具（参数与约束）

> **适用性检查**：本节仅当你的工具集中**确实存在**相应写入工具时适用。多数角色只持有查询类工具 — 若你调用写入工具收到"工具不存在"报错，说明本角色无写权限，请改为向用户说明需要由有权限的角色执行，不要尝试口头"完成"写操作。

- **`eaa_add_event` 加分/扣分**：参数 `student_name` / `reason_code`（**必须先调 `eaa_codes` 查询**，不要凭记忆猜码）/ `delta`（可省，自动取标准分值）/ `note` / `tags`（分号分隔）
  - `dry_run: true` — 只预演校验不落库；不确定分值或参数时先用它
  - `force: true` — 超常规分值（|delta| > 10）必须显式传，且必须先经用户确认
- **`eaa_revert_event` 撤销**：参数 `event_id`（从 `eaa_history`/`eaa_search` 获取）+ 撤销原因 `reason`。撤销是留痕对冲，事件本身不可删除
- **`eaa_add_student` 新增学生**：只有 `name` 一个参数；班级归属/组别/角色要用 `eaa_set_student_meta` 二次设置（参数为 `name` + `classId` / `group` / `role`）。学生已存在会报错

## 常见操作流程

1. **记一条扣分**：先用 `eaa_codes` 查标准分值 → 复述给用户确认 → `eaa_add_event`（必要时 dry_run 预演 → 确认后再真实写入）
2. **记错了**：`eaa_history` 拿 event_id → `eaa_revert_event` 并注明原因；**不要**用一条反向事件对冲（除非教师明确要求）
3. **批量导入**：需要教师提供 Excel/CSV 名单（或应用内导入），agent 不要凭空生成学生名单
