# EAA CLI 命令手册

> **版本**: v4.0.0 | **更新**: 2026-04-29

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

## 全局选项（v4.0 新增）

### `--output / -O <text|json>`

控制所有命令的输出格式。默认 `text`，传 `json` 输出结构化 JSON。

```bash
eaa info                          # 文本输出（默认）
eaa -O json info                  # JSON 输出
eaa --output json ranking 5       # JSON 排行榜
eaa -O json score 张三            # JSON 学生详情
eaa -O json stats                 # JSON 统计（含原因码/标签/区间分布）
eaa -O json validate              # JSON 校验结果
eaa -O json doctor                # JSON 诊断报告
```

**JSON 字段视为稳定接口**，小版本只做加字段，不改/删老字段。

## 系统命令

### `eaa --version`
显示版本号。

### `eaa info`
显示系统信息（学生数、事件数、数据目录路径）。

### `eaa doctor`
环境检查（v4.0 增强）：数据目录、Schema文件、文件权限、数据完整性、实体引用完整性、事件分布异常检测、事件ID唯一性检查。

### `eaa validate`
验证所有事件数据的完整性（原因码有效、实体ID存在、字段完整）。

## 查询命令

### `eaa score <姓名>`
查询学生当前分数及风险等级。JSON 输出包含：score, delta, risk, status, events_count, last_event_at, groups, roles, class_id。

```bash
eaa score 张三
# 输出: 张三: 101.0 分 (风险: 正常)
```

### `eaa history <姓名>`
查询学生完整事件时间线，含累计分数变化。JSON 输出包含 cumulative 字段。

```bash
eaa history 张三
# 显示所有事件：日期、原因码、分数变动、备注、累计分
```

### `eaa ranking [数量]`
排行榜，默认显示前10名。

```bash
eaa ranking        # 前10名
eaa ranking 52     # 全部排名
eaa -O json ranking 5  # JSON格式
```

### `eaa stats`
显示详细统计（v4.0 增强）：原因码分布、标签分布、**分数区间分布**（极高/高/中/低）、全班概况。

### `eaa codes`
列出所有原因码及对应标准分值。

### `eaa replay`
重放全部事件，输出完整排行榜及各人分数变动。

## 搜索命令

### `eaa search <关键词>`
搜索事件，支持学生姓名、原因码、标签、原因描述。

```bash
eaa search 睡觉              # 按关键词搜索
eaa search SPEAK_IN_CLASS   # 按原因码搜索
eaa -O json search 张三 --limit 5  # JSON格式限制5条
```

### `eaa range <开始日期> <结束日期>`
按日期范围查询事件。

```bash
eaa range 2026-03-01 2026-03-31
eaa -O json range 2026-04-01 2026-04-21 --limit 20
```

### `eaa tag [标签名]`
不带参数列出所有标签及计数；带参数筛选该标签下的事件。

## 写入命令

### `eaa add <姓名> <原因码> [选项]`
新增事件。原因码必须是 `reason_codes.json` 中定义的标准码。

```bash
eaa add 张三 SPEAK_IN_CLASS --delta -2 --note "物理课讲话"
eaa add 张三 LATE --delta -2 --dry-run     # 预览
eaa add 王五 CUSTOM --delta -15 --force     # 强制
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
eaa revert evt_00002 --dry-run
```

## 实体管理

### `eaa list-students`
列出所有学生实体。

### `eaa add-student <姓名>`
添加新学生。

### `eaa import <文件>`
从JSON文件批量导入学生。

### `eaa delete-student <姓名> [选项]`
删除学生（保留历史事件用于审计）。

```bash
eaa delete-student 张三 --confirm --reason "转学"
```

## 数据视图（v4.0 新增）

### `eaa summary [--since DATE] [--until DATE]`
区间汇总视图，纯查询不改数据。

```bash
eaa summary                                    # 全量汇总
eaa summary --since 2026-04-01 --until 2026-04-30  # 按月
eaa -O json summary --since 2026-04-01         # JSON格式
```

**输出字段**：
| 字段 | 说明 |
|:-----|:-----|
| events.total | 区间内事件总数 |
| events.bonus_count/deduct_count | 加分/扣分次数 |
| events.bonus_total/deduct_total | 加分/扣分总量 |
| risk_distribution | 风险等级人数分布 |
| top_reason_codes | TOP5 原因码 |
| top_gainers / top_losers | 分数变化最大/最小的学生 |

## 实体属性扩展（v4.0 新增）

### `eaa set-student-meta <姓名> [选项]`
设置学生实体的扩展属性（分组/角色/班级），不改事件。

```bash
eaa set-student-meta 张三 --group "物理兴趣组" --role "班委"
eaa set-student-meta 李四 --class-id "cls_02"
```

**扩展字段**（entities.json 中的可选字段，不影响老数据）：
| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| groups | string[] | 分组列表 |
| roles | string[] | 角色列表 |
| class_id | string? | 班级ID |

## 导出与可视化（v4.0 新增）

### `eaa export [--format csv|jsonl|html] [--output-file PATH]`
导出排行榜数据。

```bash
eaa export                              # CSV到stdout
eaa export --format csv --output-file ranking.csv
eaa export --format jsonl               # JSONL到stdout（每行一个JSON对象）
eaa export --format html --output-file report.html  # HTML报表
```

### `eaa dashboard [--output-dir DIR] [--open]`
生成静态HTML仪表盘（含ECharts图表）。

```bash
eaa dashboard                           # 生成到 ./eaa-dashboard/
eaa dashboard --output-dir /tmp/eaa     # 指定目录
eaa dashboard --open                    # 自动打开浏览器
```

**仪表盘内容**：分数分布柱状图、风险等级饼图、完整排行榜表格。

## 隐私脱敏

### `eaa privacy <子命令>`
隐私脱敏引擎，详见隐私模块文档。

```bash
eaa privacy anonymize "王勇讲话"        # → S_024讲话
eaa privacy deanonymize "S_024讲话"    # → 王勇讲话
eaa privacy list                        # 查看映射表
```

## 数据文件

| 文件 | 说明 |
|:-----|:-----|
| `data/entities/entities.json` | 学生实体数据（ID、姓名、别名、状态、groups、roles、class_id） |
| `data/entities/name_index.json` | 姓名到ID的索引 |
| `data/events/events.json` | 事件流（追加写入，不可删除） |
| `schema/reason_codes.json` | 原因码定义 |
| `data/logs/operations.jsonl` | 操作审计日志 |

## 安全特性

| 特性 | 说明 |
|:-----|:-----|
| 原子写入 | tmp → fsync → rename，断电不丢数据 |
| 文件锁 | flock 互斥，RAII 自动释放 |
| 事件ID | UUID v4 |
| 去重校验 | 同学生同日同原因码只允许一条 |
| Revert保护 | 撤销事件不可再撤销 |
| 分数范围 | delta [-10, +10]，超出需 `--force` |
| dry-run | 所有写入命令支持预演模式 |

## 环境变量

| 变量 | 说明 | 默认值 |
|:-----|:-----|:-------|
| `EAA_DATA_DIR` | 数据目录路径 | `./data` |
| `EAA_OPERATOR` | 默认操作人 | `班主任` |
| `EAA_PRIVACY_PASSWORD` | 隐私脱敏密码 | （wrapper脚本内设） |

## 稳定接口清单（v4.0）

以下字段/命令视为稳定接口，供 AI 和脚本依赖：

**JSON 输出字段**：
- ranking: `rank`, `name`, `entity_id`, `score`, `delta`, `risk`
- history events: `event_id`, `timestamp`, `event_type`, `reason_code`, `score_delta`, `cumulative`, `note`, `tags`
- student: `name`, `entity_id`, `score`, `delta`, `risk`, `status`, `events_count`
- stats summary: `students`, `total_events`, `valid_events`, `reverted_events`, `total_delta`

**命令参数**：所有现有命令的参数和语义不变，新能力通过新选项/新命令添加。

## 注意事项

- CLI 必须在 `EAA_DATA_DIR` 正确设置后运行
- 事件一旦写入不可删除，只能通过 `revert` 撤销
- `add` 命令会强制校验原因码和分值范围
- 所有 Agent 必须通过 CLI 操作数据，禁止直接修改 JSON 文件
---

## v3.1.1 新增

### 环境变量

| 变量 | 说明 | 默认值 |
|:-----|:-----|:-------|
| `EAA_BACKEND` | 存储后端：`filesystem` 或 `postgres` | `filesystem` |
| `DATABASE_URL` | PostgreSQL 连接字符串（postgres 模式必需） | - |
| `EAA_TENANT_ID` | 租户 UUID（RLS 隔离） | default |
| `EAA_PRIVACY_PASSWORD` | 隐私加密密钥 | - |

### 全局选项

| 选项 | 默认值 | 说明 |
|:-----|:--------|:------------|
| `-O, --output <fmt>` | `text` | 输出格式：`text` 或 `json` |

### 新增命令

| 命令 | 说明 |
|:-----|:-----|
| `eaa summary [--since DATE] [--until DATE]` | 区间汇总视图 |
| `eaa dashboard [--output-dir <dir>]` | 生成 HTML 仪表盘（ECharts） |
| `eaa export --format csv|jsonl|html` | 多格式导出 |
| `eaa set-student-meta <姓名> --group/role/class-id` | 设置学生元数据 |

### 数据迁移

```bash
# 将文件系统数据迁移到 PostgreSQL
python3 scripts/migrate_to_pg.py

# 验证迁移完整性
eaa validate
eaa doctor
```

### 向后兼容

- v4.0/v3.1.1 完全向后兼容 v3.x，所有旧命令和参数不变
