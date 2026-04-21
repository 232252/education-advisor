# CoPaw v2.0 —— 类型驱动的事件溯源操行分系统

> **核心理念**："让非法状态不可表达" —— 用 Rust 的类型系统拦截 AI 幻觉

## 架构

```
AI (按 Schema 生成) → 强类型 Struct (Serde 拦截) → CLI (状态机校验) → 原子写入
```

## 三层防线

| 防线 | 机制 | 拦截内容 |
|:-----|:-----|:---------|
| 第一层 | `#[serde(deny_unknown_fields)]` | AI 捏造的未知字段 |
| 第二层 | `TryFrom<T>` + Newtype | 非法值（分数 > ±10） |
| 第三层 | 业务状态机 `validate()` | 已休学学生不能记迟到 |

## 功能

- 📊 操行分事件溯源（不可变追加 + 重放计算）
- 🔒 强类型事件（Rust Enum 穷尽所有类型）
- 🛡️ AI 幻觉拦截（Serde 反序列化 + 业务校验）
- 📜 JSON Schema 导出（供 AI 平台使用）
- 🔄 旧版数据自动降级兼容
- ⚡ 原子写入（临时文件 → fsync → rename）
- 🔑 UUID 事件ID（避免并发冲突）

## 安装

```bash
# 需要安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 编译
cd src && cargo build --release

# 安装
cp target/release/copaw /usr/local/bin/
```

## 使用

```bash
# 系统信息
copaw info

# 添加事件
copaw add 学生姓名 SPEAK_IN_CLASS
copaw add 学生姓名 BONUS_VARIABLE --delta 5

# 查询
copaw score 学生姓名
copaw history 学生姓名
copaw ranking 10

# 撤销
copaw revert evt_xxx --reason "误录"

# 校验
copaw validate

# 导出 JSON Schema（供 AI 使用）
copaw schema > school_event_schema.json

# 统计
copaw stats
```

## 事件类型

### 纪律类（扣分）
| 原因码 | 标准分 | 说明 |
|:-------|:-------|:-----|
| SPEAK_IN_CLASS | -2 | 课堂讲话 |
| SLEEP_IN_CLASS | -2 | 课堂睡觉 |
| LATE | -2 | 迟到 |
| SCHOOL_CAUGHT | -5 | 学校抓拍违纪 |
| PHONE_IN_CLASS | -5 | 手机违纪 |
| SMOKING | -10 | 抽烟 |
| DRINKING_DORM | -5 | 寝室饮酒 |
| LAB_EQUIPMENT_DAMAGE | -5 | 实验室设备损坏 |
| LAB_SAFETY_VIOLATION | -10 | 实验室安全违规 |

### 加分类
| 原因码 | 标准分 | 说明 |
|:-------|:-------|:-----|
| BONUS_VARIABLE | 变量 | 学业奖励 |
| ACTIVITY_PARTICIPATION | +1 | 活动参与 |
| CLASS_MONITOR | +10 | 班长履职 |
| CLASS_COMMITTEE | +5 | 班委履职 |
| CIVILIZED_DORM | +3 | 文明寝室 |
| MONTHLY_ATTENDANCE | +2 | 月勤奖励 |

## 项目结构

```
src/
├── main.rs              # CLI 入口
├── types/               # 强类型定义
│   ├── mod.rs
│   ├── enums.rs         # 穷举枚举
│   ├── newtypes.rs      # Newtype 包装（StudentId/ScoreDelta等）
│   ├── event.rs         # SchoolEvent ADT
│   ├── entity.rs        # 学生实体
│   ├── envelope.rs      # 事件信封 + 降级解析
│   └── error.rs         # AI 友好错误码
├── storage/             # 存储层（原子读写）
├── validation/          # 校验层（三道防线）
└── schema/              # JSON Schema 导出
```

## 隐私保护

⚠️ `data/` 目录包含真实学生数据，已在 `.gitignore` 中排除。
`data/examples/` 提供脱敏示例数据供参考。

## License

MIT
