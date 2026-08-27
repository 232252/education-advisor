---
name: STUDENT_MANAGEMENT
description: 学生操行管理技能 — 用内置 eaa_* 工具查询分数/记录加减分/撤销事件,含原因码标准分值表与操作规范
---

# 学生管理技能

你无需调用外部 CLI — 系统已把 eaa 数据引擎封装为内置工具，直接调用即可。

## 数据查询（内置工具）

| 工具 | 用途 |
|:-----|:-----|
| `eaa_score` | 查询单个学生分数与风险等级 |
| `eaa_history` | 学生事件时间线 |
| `eaa_search` | 按关键词搜索事件 |
| `eaa_ranking` | 班级排行榜 |
| `eaa_list_students` | 学生名单 |
| `eaa_stats` / `eaa_summary` | 班级统计 / 区间汇总 |
| `eaa_codes` | 原因码完整列表（分值以它为准） |
| `eaa_tag` / `eaa_range` | 标签查询 / 时间段汇总 |

## 数据写入（内置工具）

- **加减分**： `eaa_add_event`，参数 `student_name` / `reason_code` / `delta`(可省，自动取标准分值) / `note` / `tags`(分号分隔)
- **撤销**： `eaa_revert_event`，参数 `event_id`(从 `eaa_history` / `eaa_search` 获取) + `reason`
- **不确定时**： `eaa_add_event` 传 `dry_run: true` 先预演校验，不真正写入
- **超常规分值**（|delta| > 10）： 需 `force: true`，且必须先向用户确认

## 原因码参考

| 代码 | 标准分 | 说明 |
|:-----|:-----:|:-----|
| SPEAK_IN_CLASS | -2 | 课堂讲话 |
| SLEEP_IN_CLASS | -2 | 课堂睡觉 |
| LATE | -2 | 迟到 |
| SMOKING | -10 | 抽烟 |
| DRINKING_DORM | -5 | 寝室饮酒 |
| PHONE_IN_CLASS | -5 | 手机违纪 |
| SCHOOL_CAUGHT | -5 | 学校抓拍 |
| APPEARANCE_VIOLATION | -2 | 仪容违纪 |
| DESK_UNALIGNED | -1 | 桌椅不整齐 |
| MONTHLY_ATTENDANCE | +2 | 月勤奖励 |
| CLASS_MONITOR | +10 | 班长履职 |
| CLASS_COMMITTEE | +5 | 班委履职 |
| CIVILIZED_DORM | +3 | 文明寝室 |

完整列表以 `eaa_codes` 实时结果为准。

## 操作规范

1. **所有数字必须来自工具输出** — 没查到的数据就是不存在，禁止凭记忆报分数
2. 写操作前先向用户复述确认（学生、原因码、分值），确认后再执行
3. 禁止直接读写 events.json / entities.json 数据文件
4. 事件不可删除，只能通过 `eaa_revert_event` 对冲留痕
5. 开启隐私模式时你看到的学生姓名是化名（如 S_001），直接用化名调用工具即可，系统会自动转换
