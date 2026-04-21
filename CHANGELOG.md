# 更新日志

## [2.0.0] - 2026-04-21

### 新增
- eaa CLI v2.0：原子写入、UUID事件ID、文件锁
- dry-run 预览模式
- 分数范围校验（[-10, +10]，超出需 --force）
- 防重复 Revert 保护
- EAA_DATA_DIR 环境变量支持
- 操作日志（operations.jsonl）
- 模块化代码拆分（types/storage/commands/validation）

### 修复
- 重写 DEPLOY_TO_AI.md（3种实际可用部署方案）
- 修复 install.sh --prefix 参数缺失检查
- 从 Git 追踪中移除学生敏感数据

### 变更
- SOUL.md 集成 eaa CLI 命令参考
- 所有 Agent 配置统一引用 eaa CLI

## [1.0.0] - 2026-04-01

### 新增
- 初始版本
- eaa CLI 基础功能（info/validate/replay/ranking/score/history/add/revert）
- 事件溯源数据引擎
- 原因码强类型校验
- 多Agent架构（OpenClaw）
- 单Agent模式（SOUL.md）

## [2.0.0] - 2026-04-22

### 新增
- 18个CLI命令（info/validate/replay/history/ranking/score/add/revert/codes/search/stats/tag/range/list-students/add-student/import/export/doctor）
- `--version` 版本号支持
- `--limit` 分页（search/range）
- `--dry-run` 预演模式（add/revert）
- `--force` 强制执行（超出分数范围）
- `doctor` 环境健康检查（含文件权限）
- `export` CSV导出
- 去重校验（同学生+同日+同原因码）
- Revert保护（撤销事件不可再撤销）
- 原子写入 + 文件锁（RAII）
- UUID v4 事件ID
- 操作日志（operations.jsonl）
- 6个Rust单元测试

### 修复
- reason_code从枚举改为String，运行时校验（#11）
- Revert二次撤销拦截（#15）
- unwrap链改为安全匹配（#21）
- 文件锁RAII Drop自动释放（#25）
- 时区改为Local/Asia/Shanghai（#23）
- 清除所有编译warnings
- 删除未使用的ReasonCode枚举
- 原因码列表按标准分排序
