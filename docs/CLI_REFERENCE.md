# EAA CLI v2.0 命令参考

## 系统命令

| 命令 | 说明 | 示例 |
|:-----|:-----|:-----|
| `eaa --version` | 版本号 | `eaa --version` → eaa 2.0.0 |
| `eaa info` | 系统信息 | 学生数、事件数、数据目录 |
| `eaa doctor` | 环境检查 | 数据目录、Schema、文件权限 |
| `eaa validate` | 校验全部事件 | 原因码、实体ID、数据完整性 |

## 查询命令

| 命令 | 说明 | 示例 |
|:-----|:-----|:-----|
| `eaa score <姓名>` | 查询单人分数 | `eaa score 张三` → 80.0 |
| `eaa history <姓名>` | 事件时间线 | 含运行分数变化 |
| `eaa ranking [N]` | 排行榜 | `eaa ranking 10` |
| `eaa replay` | 重算全部分数 | 完整排行榜 |
| `eaa stats` | 数据统计 | 原因码分布、总分变动 |
| `eaa codes` | 原因码列表 | 按标准分排序 |

## 搜索命令

| 命令 | 说明 | 参数 |
|:-----|:-----|:-----|
| `eaa search <关键词>` | 搜索事件 | `--limit N` 限制条数 |
| `eaa range <起始> <结束>` | 日期范围 | `--limit N` 限制条数 |
| `eaa tag [标签]` | 标签查询 | 留空显示全部标签 |

## 写入命令

| 命令 | 说明 | 关键参数 |
|:-----|:-----|:---------|
| `eaa add <姓名> <原因码>` | 新增事件 | `--delta`, `--note`, `--operator`, `--force`, `--dry-run` |
| `eaa revert <事件ID>` | 撤销事件 | `--reason`, `--dry-run` |

## 实体管理

| 命令 | 说明 |
|:-----|:-----|
| `eaa list-students` | 列出所有学生 |
| `eaa add-student <姓名>` | 添加学生 |
| `eaa import <文件>` | 批量导入 |
| `eaa export` | 导出CSV |

## 安全特性

- **原子写入**：tmp → fsync → rename
- **文件锁**：flock 互斥，RAII 自动释放
- **事件ID**：UUID v4
- **去重校验**：同学生同日同原因码
- **Revert保护**：撤销事件不可再撤销
- **分数范围**：delta [-10, +10]，超出需 `--force`
- **dry-run**：所有写入命令支持预演

## 环境变量

| 变量 | 说明 | 默认值 |
|:-----|:-----|:-------|
| `EAA_DATA_DIR` | 数据目录 | `./data` |
| `EAA_OPERATOR` | 默认操作者 | `班主任` |
