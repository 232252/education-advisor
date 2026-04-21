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
