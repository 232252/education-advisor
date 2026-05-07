# 事件溯源数据架构

## 概述

EAA 事件溯源系统是 Education Advisor AI 的**底层数据引擎**，采用 Event Sourcing（事件溯源）架构管理学生操行分数据。这不是一个独立模块，而是贯穿所有功能的基础架构——所有数据读写都通过 `eaa` CLI 完成。

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
│  用户/Agent  │────▶│   eaa CLI    │────▶│  命令分发器    │
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
系统预定义 22 种标准原因码，每种有固定分值。
完整列表通过 `eaa codes` 命令查看。

## 分数计算

```
当前分数 = 100 + Σ(该学生所有有效事件的 score_delta)
```

## 文件结构

```
core/eaa-cli/
├── src/main.rs         # Rust 源代码
├── Cargo.toml          # 项目配置
├── schema/
│   └── reason_codes.json  # 原因码定义
└── data/
    ├── entities/
    │   ├── entities.json  # 学生实体
    │   └── name_index.json # 姓名索引
    └── events/
        └── events.json    # 事件流
```

## 与 Agent 的集成

**所有 Agent 必须通过 `eaa` CLI 读写数据**，禁止直接操作 JSON 文件。这是事件溯源架构的核心约束——无论数据来自飞书、QQ 还是其他通道，都统一通过 CLI 入口。

详见 [SECURITY.md](./SECURITY.md)。

---

## v5.0 新增：PostgreSQL 事件存储

### 数据库 Schema

| 表 | 用途 |
|:---|:-----|
| `tenants` | 租户（班级/学校） |
| `entities` | 学生实体注册 |
| `events` | 事件流（append-only，触发器强制不可变） |
| `projections` | 物化投影（实时分数/排名缓存） |
| `privacy_mappings` | 隐私映射（AES-256-GCM 加密） |
| `event_streams` | 流序列号分配（乐观并发控制） |
| `operation_log` | 操作审计日志 |

### Append-Only 强制机制

```sql
-- 触发器：阻止 UPDATE 和 DELETE
CREATE TRIGGER events_no_update
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();

CREATE TRIGGER events_no_delete
    BEFORE DELETE ON events
    FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();

-- 尝试修改会报错：
-- ERROR: append-only violation: UPDATE on events is not allowed
```

### RLS 多租户隔离

```sql
-- 每个表只能看到当前租户的数据
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON events
    USING (tenant_id::text = current_setting('app.current_tenant', true));
```

### 双后端架构

```
         ┌─── StorageBackend trait ───┐
         │                           │
  FileSystemBackend          PostgresBackend
  (默认，零依赖)              (多班级，RLS)
```

通过 `EAA_BACKEND=postgres` 环境变量切换，现有命令零变更。
## v4.0 数据核心升级（2026-04-29）

### 视图/投影（只读视图）

事件溯源架构中，"投影"是从事件流计算出的只读视图。v4.0 新增多个投影命令：

- **`eaa summary`**：区间汇总投影（事件数、加分/扣分统计、风险分布、TOP原因码）
- **`eaa stats --output json`**：增强统计投影（含分数区间分布）
- **`eaa export --format jsonl/html`**：导出投影

**原则**：事件不可变，视图可扩展。所有视图都是从事件流实时计算的，不持久化。

### 数据可视化

- **`eaa dashboard`**：生成静态 HTML 仪表盘（ECharts 图表）
- **`eaa export --format html`**：单页 HTML 报表

纯静态输出，不启动 Web 服务，离线可用。

### 结构化输出

全局 `--output/-O json` 选项，所有查询命令支持 JSON 输出，字段名视为稳定接口。

### 实体扩展字段

entities.json 新增可选字段（不影响老数据）：
- `groups: string[]` - 分组
- `roles: string[]` - 角色
- `class_id: string?` - 班级ID

通过 `eaa set-student-meta` 设置。

### 向后兼容

- 所有现有命令参数和默认文本输出不变
- 新增命令使用新子命令（`summary`、`dashboard`）
- 新增选项使用新全局参数（`-O`、`--format`）
- JSON 字段只做加，不做删/改
