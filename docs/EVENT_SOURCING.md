# 事件溯源数据架构

## 概述

CoPaw 事件溯源系统是教育参谋系统的底层数据引擎，采用 **Event Sourcing（事件溯源）** 架构管理学生操行分数据。

## 核心理念

传统系统：直接修改分数（覆盖式）→ 历史不可追溯

事件溯源：**所有状态变更以不可变事件记录** → 当前分数通过重放全部事件计算

### 优势

| 特性 | 说明 |
|:-----|:-----|
| 完全可追溯 | 任何时间点的分数都可以通过重放还原 |
| 天然审计 | 每个分数变动都有对应事件，无法篡改 |
| 可撤销 | 通过 REVERT 事件抵消，而非删除 |
| 数据一致性 | 可随时与外部数据源对比校验 |

## 架构图

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  用户/Agent  │────▶│  copaw CLI   │────▶│  命令分发器    │
└─────────────┘     └──────────────┘     └──────┬───────┘
                                                │
                    ┌───────────────────────────┤
                    ▼                           ▼
          ┌──────────────┐           ┌──────────────┐
          │  事件处理器    │           │  查询处理器    │
          │  (写入事件流)  │           │  (读取+重放)   │
          └──────┬───────┘           └──────┬───────┘
                 ▼                          ▼
          ┌──────────────┐        ┌──────────────────┐
          │  events.json  │        │  事件重放引擎      │
          │  (追加写入)    │───────▶│  (初始100分累加)   │
          └──────────────┘        └──────────────────┘
                                           │
                                           ▼
                                  ┌──────────────┐
                                  │  分数结果输出   │
                                  │  (排行榜/个人)  │
                                  └──────────────┘
```

## 数据结构

### 实体（Entity）
```json
{
  "id": "stu_001",
  "name": "张三",
  "aliases": [],
  "status": "ACTIVE",
  "metadata": {"class": "示例班级", "risk": "正常"}
}
```

### 事件（Event）
```json
{
  "event_id": "evt_00001",
  "entity_id": "stu_001",
  "event_type": "CONDUCT_DEDUCT",
  "reason_code": "SPEAK_IN_CLASS",
  "original_reason": "课堂讲话",
  "score_delta": -2.0,
  "operator": "班主任",
  "timestamp": "2026-03-05T09:30:00Z",
  "is_valid": true,
  "reverted_by": null
}
```

### 原因码（Reason Codes）
系统预定义 22 种标准原因码，每种有固定分值：
- 扣分：`SPEAK_IN_CLASS`(-2)、`LATE`(-2)、`SMOKING`(-10) 等
- 加分：`MONTHLY_ATTENDANCE`(+2)、`CIVILIZED_DORM`(+3) 等
- 系统：`REVERT`(自动计算)

完整列表通过 `copaw codes` 命令查看。

## 分数计算

```
当前分数 = 100 + Σ(该学生所有有效事件的 score_delta)
```

- 每个学生初始分数为 100
- 仅计算 `is_valid=true` 且 `reverted_by=null` 的事件
- 分数通过重放全部事件实时计算，不存储快照

## 文件结构

```
core/copaw-cli/
├── src/main.rs         # Rust 源代码
├── Cargo.toml          # 项目配置
├── schema/
│   └── reason_codes.json  # 原因码定义
├── data/
│   ├── entities/
│   │   ├── entities.json  # 学生实体
│   │   └── name_index.json # 姓名索引
│   └── events/
│       └── events.json    # 事件流
└── scripts/
    └── migrate.py         # 数据迁移工具
```

## 编译与部署

```bash
cd core/copaw-cli

# 编译（需要 Rust 工具链）
cargo build --release

# 二进制文件位于 target/release/copaw
# 使用时确保在 data/ 和 schema/ 同级目录下运行
```

## 与 Agent 的集成

所有 Agent 必须通过 `copaw` CLI 读写数据，禁止直接操作 JSON 文件。详见 [SECURITY.md](./SECURITY.md)。
