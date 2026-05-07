# EAA CLI 命令手册

## 概述

`eaa` 是事件溯源操行分系统的命令行工具，使用 Rust 编写，是**唯一的数据读写入口**。

所有 Agent、所有通道的数据操作都通过 `eaa` CLI 完成，确保数据一致性和可追溯性。

## 编译安装

```bash
# 从源码编译（需要 Rust）
cd core/eaa-cli
cargo build --release
# 编译后二进制: target/release/eaa

# 或下载预编译版本
curl -L https://github.com/232252/education-advisor/releases/latest/download/eaa-linux-x86_64 \
  -o /usr/local/bin/eaa && chmod +x /usr/local/bin/eaa
```

## 系统命令

### `eaa --version`
显示版本号。

### `eaa info`
显示系统信息（学生数、事件数、数据目录路径）。

### `eaa doctor`
环境检查：数据目录、Schema文件、文件权限、数据完整性。

### `eaa validate`
验证所有事件数据的完整性（原因码有效、实体ID存在、字段完整）。

## 查询命令

### `eaa score <姓名>`
查询学生当前分数及风险等级。

```bash
eaa score 张三
# 输出: 张三: 101.0 分 (风险: 正常)
```

### `eaa history <姓名>`
查询学生完整事件时间线，含累计分数变化。

```bash
eaa history 张三
# 显示所有事件：日期、原因码、分数变动、备注、累计分
```

### `eaa ranking [数量]`
排行榜，默认显示前10名。可指定人数查看完整排行。

```bash
eaa ranking        # 前10名
eaa ranking 52     # 全部排名
```

### `eaa stats`
显示详细统计：原因码分布、标签分布、分数区间分布、全班概况。

### `eaa codes`
列出所有原因码及对应标准分值。

### `eaa replay`
重放全部事件，输出完整排行榜及各人分数变动。用于数据修复后验证。

## 搜索命令

### `eaa search <关键词>`
搜索事件，支持学生姓名、原因码、标签、原因描述。

```bash
eaa search 睡觉              # 按关键词搜索
eaa search SPEAK_IN_CLASS   # 按原因码搜索
eaa search 张三 --limit 5    # 限制结果数量
```

### `eaa range <开始日期> <结束日期>`
按日期范围查询事件（YYYY-MM-DD格式）。

```bash
eaa range 2026-03-01 2026-03-31
eaa range 2026-04-01 2026-04-21 --limit 20
```

### `eaa tag [标签名]`
不带参数列出所有标签及计数；带参数筛选该标签下的事件。

```bash
eaa tag            # 列出所有标签
eaa tag 班主任      # 班主任记录的事件
```

## 写入命令

### `eaa add <姓名> <原因码> [选项]`
新增事件。原因码必须是 `reason_codes.json` 中定义的标准码。

```bash
# 基本用法
eaa add 张三 SPEAK_IN_CLASS --delta -2 --note "物理课讲话"

# 带标签
eaa add 李四 MONTHLY_ATTENDANCE --tags 班主任 --delta 2

# 预览模式（不实际写入）
eaa add 张三 LATE --delta -2 --dry-run

# 强制写入超出范围的分值
eaa add 王五 CUSTOM --delta -15 --force
```

**选项**：
| 选项 | 说明 |
|:-----|:-----|
| `--delta` | 分值变动（默认使用原因码的标准分） |
| `--note` | 事件备注 |
| `--tags` | 事件标签 |
| `--operator` | 操作人（默认环境变量 `EAA_OPERATOR`） |
| `--dry-run` | 预览模式，不实际写入 |
| `--force` | 允许超出 [-10, +10] 范围的分值 |

### `eaa revert <事件ID> [选项]`
撤销指定事件（生成对冲事件，原始事件保留）。

```bash
eaa revert evt_00001 --reason "误录"
eaa revert evt_00002 --dry-run    # 预览
```

## 实体管理

### `eaa list-students`
列出所有学生实体。

### `eaa add-student <姓名>`
添加新学生。

### `eaa import <文件>`
从JSON/CSV文件批量导入学生。

### `eaa export`
导出数据为CSV格式。

## 数据文件

| 文件 | 说明 |
|:-----|:-----|
| `data/entities/entities.json` | 学生实体数据（ID、姓名、别名、状态） |
| `data/entities/name_index.json` | 姓名到ID的索引（支持别名） |
| `data/events/events.json` | 事件流（追加写入，不可删除） |
| `schema/reason_codes.json` | 原因码定义（代码、描述、标准分值、标签） |

## 安全特性

| 特性 | 说明 |
|:-----|:-----|
| 原子写入 | tmp → fsync → rename，断电不丢数据 |
| 文件锁 | flock 互斥，RAII 自动释放，多进程并发安全 |
| 事件ID | UUID v4，避免重复和跳号 |
| 去重校验 | 同学生同日同原因码只允许一条 |
| Revert保护 | 撤销事件不可再撤销 |
| 分数范围 | delta [-10, +10]，超出需 `--force` |
| dry-run | 所有写入命令支持预演模式 |

## 环境变量

| 变量 | 说明 | 默认值 |
|:-----|:-----|:-------|
| `EAA_DATA_DIR` | 数据目录路径 | `./data` |
| `EAA_OPERATOR` | 默认操作人 | `班主任` |

## 注意事项

- CLI 必须在 `EAA_DATA_DIR` 正确设置后运行
- 事件一旦写入不可删除，只能通过 `revert` 撤销
- `add` 命令会强制校验原因码和分值范围
- 所有 Agent 必须通过 CLI 操作数据，禁止直接修改 JSON 文件

---

## v3.1.2 新增环境变量

| 变量 | 说明 | 默认值 |
|:-----|:-----|:-------|
| `EAA_BACKEND` | 存储后端：`filesystem` 或 `postgres` | `filesystem` |
| `DATABASE_URL` | PostgreSQL 连接字符串（postgres 模式必需） | - |
| `EAA_TENANT_ID` | 租户 UUID（RLS 隔离） | default |
| `EAA_PRIVACY_PASSWORD` | 隐私加密密钥 | - |

## v3.1.2 新增全局选项

| 选项 | 默认值 | 说明 |
|:-----|:--------|:------------|
| `-O, --output <fmt>` | `text` | 输出格式：`text` 或 `json` |

## v3.1.2 新增命令

| 命令 | 说明 |
|:-----|:-----|
| `eaa summary [--since DATE] [--until DATE]` | 区间汇总视图 |
| `eaa dashboard [--output-dir <dir>]` | 生成 HTML 仪表盘（ECharts） |
| `eaa export --format csv\|jsonl\|html` | 多格式导出 |
| `eaa set-student-meta <姓名> --group/role/class-id` | 设置学生元数据 |

## v3.1.2 数据迁移

```bash
# 将文件系统数据迁移到 PostgreSQL
python3 scripts/migrate_to_pg.py

# 验证迁移完整性
eaa validate
eaa doctor
```
