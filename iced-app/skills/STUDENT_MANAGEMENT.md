# 学生管理技能

## 数据查询（通过 eaa CLI）

```bash
export EAA_DATA_DIR=./data

# 查询学生分数
eaa score 张三

# 查看事件时间线
eaa history 张三

# 搜索相关事件
eaa search 讲话

# 排行榜
eaa ranking 10
```

## 数据写入（通过 eaa CLI）

```bash
# 记录扣分
eaa add "张三" SPEAK_IN_CLASS --delta -2 --note "物理课讲话"

# 记录加分
eaa add "李四" CIVILIZED_DORM --delta +3 --note "文明寝室"

# 预览（不写入）
eaa add "张三" LATE --delta -2 --note "迟到" --dry-run

# 撤销事件
eaa revert evt_00001 --reason "误记"
```

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

运行 `eaa codes` 查看完整列表。

## 注意事项
1. **所有数据操作必须通过 eaa CLI**
2. 禁止直接编辑 events.json 或 entities.json
3. delta 超出 [-10, +10] 需加 `--force`
4. 事件不可删除，只能通过 `eaa revert` 对冲
