# 系统架构

## 整体架构

```
┌─────────────────────────────────────────────────┐
│                   用户（教师）                      │
│          飞书 / QQ / Discord / Telegram            │
└────────────────────┬────────────────────────────┘
                     │ 消息
                     ▼
┌─────────────────────────────────────────────────┐
│              OpenClaw 网关（Gateway）               │
│           消息路由 + Cron调度 + Hook               │
└────────────────────┬────────────────────────────┘
                     │ 分发
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │  main   │ │governor │ │psychology│ ...（14个Agent）
   │ 协调者   │ │ 督导    │ │  心理    │
   └────┬────┘ └────┬────┘ └────┬────┘
        │           │           │
        ▼           ▼           ▼
   ┌─────────────────────────────────────┐
   │         eaa CLI（唯一数据入口）         │
   │   Rust 强类型校验 + 事件溯源引擎       │
   │   原子写入 | 文件锁 | UUID | dry-run  │
   └──────────────┬──────────────────────┘
                  │ 读写
                  ▼
   ┌─────────────────────────────────────┐
   │   /vol2/copaw-data/data/             │
   │   events.json | entities.json        │
   │   name_index.json | schema/          │
   └─────────────────────────────────────┘
```

## 核心组件

### eaa CLI（底座）
- **定位**：系统唯一的数据读写入口，类似编译器的类型校验器
- **语言**：Rust
- **架构**：事件溯源（Event Sourcing）
- **安全机制**：原子写入、文件锁（flock）、UUID事件ID、dry-run预览、分数范围校验
- **代码位置**：`core/eaa-cli/src/`

### Agent 体系
| Agent | 职责 | 触发方式 |
|:------|:-----|:---------|
| main | 协调调度、推送 | Cron 07:00 + 22:30 |
| governor | 督导复盘、数据校验 | Cron 多次 |
| psychology | 心理危机监测 | Cron 21:00 |
| academic | 学业分析 | Cron 07:05 |
| research | 科研辅助 | Cron 22:10 |
| safety | 安全检查 | Cron 周一08:00 |
| home_school | 家校沟通 | Cron 08:30 |
| executor | 系统维护 | Cron 01:00 |
| validator | 数据校验 | Cron 12:00 + 18:00 |
| counselor | 学业辅导+谈话计划 | Cron 07:05 + 20:00 |

### 数据流
1. 用户消息 → OpenClaw → main Agent
2. main 调度子Agent（sessions_spawn）
3. 每个Agent通过 `eaa` CLI 读写数据
4. 结果写回 agent_outputs/ → 统一推送

## 数据权威源（优先级从高到低）
1. **EAA事件库**（`/vol2/copaw-data/data/events.json`）— 不可变事件流
2. **飞书Bitable v2** — 可视化界面
3. **copawctl**（shared_data.db）— 辅助查询

## 单Agent模式（无OpenClaw）
用户直接将 `single-agent/SOUL.md` 复制到任何AI平台的系统提示词中。
- 有命令执行权限 → 通过 `eaa` CLI 管理数据
- 无命令权限 → 纯对话模式（数据不持久，有丢失风险）
