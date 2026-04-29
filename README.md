# EAA - Event-Sourced Conduct Score System

> 事件溯源是根，数据库是土。土可以换，根不能断。

**EAA** (Event-sourced Assessment & Analytics) 是一个基于事件溯源架构的教育操行分管理系统，专为班主任设计。

## ✨ 核心特性

- 📋 **事件溯源** - 每条记录都是不可变事件，支持完整审计追踪
- 🔒 **隐私脱敏** - AES-256-GCM 加密映射，自动脱敏/还原
- 🏢 **多租户隔离** - PostgreSQL RLS 数据库级安全隔离
- 🦀 **Rust 实现** - 编译时 SQL 校验，零运行时开销
- 📊 **多格式输出** - text/json/html 仪表盘
- 🔄 **双后端** - 文件系统（默认）/ PostgreSQL，`EAA_BACKEND` 一键切换

## 🚀 快速开始

### 安装

```bash
# 从源码编译（需要 Rust）
git clone https://github.com/nicholasgao/eaa.git
cd eaa
cargo build --release

# 二进制在 target/release/eaa
```

### 文件系统模式（零依赖）

```bash
# 初始化数据目录
export EAA_DATA_DIR=./data

# 查看系统信息
eaa info

# 查询学生分数
eaa score 张三

# 新增事件
eaa add 张三 SPEAK_IN_CLASS --delta -2 --note "课堂讲话"

# 排行榜
eaa ranking 10
```

### PostgreSQL 模式

```bash
# 使用 Docker Compose 一键启动
cd docker
docker compose up -d

# 或者连接已有 PostgreSQL
export EAA_BACKEND=postgres
export DATABASE_URL=postgres://eaa:password@localhost:5432/eaa
export EAA_TENANT_ID=your-tenant-uuid

# 迁移现有数据
eaa migrate --from-dir ./data

# 运行迁移脚本
psql -d eaa -f migrations/001_init.sql
```

## 📖 CLI 命令

| 命令 | 说明 |
|:-----|:-----|
| `eaa info` | 系统信息 |
| `eaa validate` | 校验所有事件 |
| `eaa replay` | 重放全部操行分 |
| `eaa ranking [N]` | 排行榜 Top N |
| `eaa score <姓名>` | 查询学生分数 |
| `eaa history <姓名>` | 学生事件时间线 |
| `eaa search <关键词>` | 搜索事件 |
| `eaa stats` | 统计概览 |
| `eaa add <姓名> <原因码>` | 新增事件 |
| `eaa revert <事件ID>` | 撤销事件 |
| `eaa export` | 导出数据 |
| `eaa summary` | 区间汇总 |
| `eaa dashboard` | HTML 仪表盘 |
| `eaa doctor` | 环境诊断 |
| `eaa privacy anonymize <文本>` | 隐私脱敏 |
| `eaa privacy deanonymize <文本>` | 脱敏还原 |

## 🏗️ 架构

```
┌─────────────────────────────────┐
│       CLI / API Layer           │
├─────────────────────────────────┤
│  Storage Backend (trait)        │
│  ├─ FileSystemBackend (default) │
│  └─ PostgresBackend (optional)  │
├─────────────────────────────────┤
│  Event Sourcing Core            │
│  ├─ Append-Only Event Stream    │
│  ├─ Privacy Engine (AES-GCM)    │
│  └─ Validation & Audit          │
└─────────────────────────────────┘
```

## 🔒 安全设计

- **Append-Only**：事件表通过 PostgreSQL 触发器强制不可变
- **RLS 隔离**：数据库行级安全策略，即使应用层忘记过滤也不会泄露
- **隐私脱敏**：学生真名 → S_XXX 化名，AES-256-GCM 加密映射
- **强类型校验**：防止 AI 幻觉写入无效数据

## 📁 项目结构

```
eaa/
├── src/
│   ├── main.rs           # CLI 入口
│   ├── commands.rs       # 命令实现
│   ├── types.rs          # 类型定义
│   ├── storage.rs        # 存储辅助
│   ├── validation.rs     # 事件校验
│   ├── backend/
│   │   ├── mod.rs        # 存储抽象 trait
│   │   ├── filesystem.rs # 文件系统后端
│   │   └── postgres.rs   # PostgreSQL 后端
│   └── privacy/          # 隐私脱敏引擎
├── migrations/
│   └── 001_init.sql      # PostgreSQL Schema
├── schema/
│   └── reason_codes.json # 原因码定义
├── docker/
│   └── docker-compose.yml
├── docs/
│   ├── CLI_REFERENCE.md
│   ├── EVENT_SOURCING.md
│   └── DEPLOYMENT.md
└── scripts/
    └── migrate_to_pg.py  # 数据迁移工具
```

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 📄 许可证

MIT License

## 🙏 致谢

- 设计灵感来自 [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) 模式
- 面向中国县域高中教育场景优化
- [SQLx](https://github.com/launchbadge/sqlx) - Rust 异步 PostgreSQL 驱动

---

> 数据是教育的底稿，不可篡改是底线，多租户隔离是责任。
