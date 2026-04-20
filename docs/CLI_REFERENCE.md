# CoPaw CLI 命令手册

## 概述

`copaw` 是事件溯源操行分系统的命令行工具，使用 Rust 编写，是唯一的数据读写入口。

## 编译

```bash
cd core/copaw-cli
cargo build --release
# 编译后二进制: target/release/copaw
```

## 基础命令

### `copaw info`
显示系统信息（学生数、事件数）。

### `copaw validate`
验证所有事件数据的完整性。

### `copaw stats`
显示详细统计：原因码分布、标签分布、分数区间分布。

### `copaw codes`
列出所有原因码及对应标准分值。

## 查询命令

### `copaw score <姓名>`
查询学生当前分数及风险等级。

```bash
copaw score 张三
# 输出: 张三: 101.0 分 (风险: 正常)
```

### `copaw history <姓名>`
查询学生完整事件时间线，含累计分数变化。

```bash
copaw history 张三
```

### `copaw ranking [数量]`
排行榜，默认显示前10名。

```bash
copaw ranking        # 前10名
copaw ranking 52     # 全部排名
```

### `copaw search <关键词>`
搜索事件，支持学生姓名、原因码、标签、原因描述。

```bash
copaw search 睡觉
copaw search SPEAK_IN_CLASS
copaw search 王五
```

### `copaw tag [标签名]`
不带参数列出所有标签及计数；带参数筛选该标签下的事件。

```bash
copaw tag            # 列出所有标签
copaw tag 班主任      # 班主任记录的事件
```

### `copaw range <开始日期> <结束日期>`
按日期范围查询事件（YYYY-MM-DD格式）。

```bash
copaw range 2026-03-01 2026-03-31
```

## 系统命令

### `copaw replay`
重放全部事件，输出完整排行榜及各人分数变动。

## 写入命令

### `copaw add <姓名> <原因码> [--tags 标签] [--delta 分值] [--note 备注]`
新增事件。原因码必须是 `reason_codes.json` 中定义的标准码。

```bash
copaw add 张三 SPEAK_IN_CLASS --tags 班主任 --delta -2 --note "物理课讲话"
copaw add 李四 MONTHLY_ATTENDANCE --delta 2
```

### `copaw revert <事件ID> [--reason 原因]`
撤销指定事件（生成对冲事件）。

```bash
copaw revert evt_00001 --reason "误录"
```

## 数据文件

| 文件 | 说明 |
|:-----|:-----|
| `data/entities/entities.json` | 学生实体数据 |
| `data/entities/name_index.json` | 姓名→ID索引 |
| `data/events/events.json` | 事件流（追加写入） |
| `schema/reason_codes.json` | 原因码定义 |

## 注意事项

- CLI 必须在 `data/` 和 `schema/` 同级目录下运行
- 事件一旦写入不可删除，只能通过 `revert` 撤销
- `add` 命令会强制校验原因码和分值
- 所有 Agent 必须通过 CLI 操作数据，禁止直接修改 JSON
