# 更新日志

所有版本的重要变更都记录在此文件中。

## [4.0.0] - 2026-05-07

### 新增
- **数据核心升级** — eaa CLI v4.0.0
  - `--output/-O json|text` 全局结构化输出（所有命令支持）
  - `eaa summary [--since] [--until]` 区间汇总视图
  - `eaa dashboard [--output-dir] [--open]` 静态HTML仪表盘（ECharts）
  - `eaa export --format csv|jsonl|html` 多格式导出
  - `eaa set-student-meta <姓名> --group/role/class-id` 实体属性扩展
  - `eaa delete-student` 学生归档（保留历史事件）
  - `DataContext` 统一数据加载层，减少重复文件IO
  - `doctor` 增强：实体引用完整性、事件分布异常、ID唯一性
  - `stats` 增强：分数区间分布统计
  - 所有命令 `--output json` 输出JSON格式
- **飞书Bitable双向同步（D方案）** — 钩子+定时双重保障
  - `scripts/eaa_bitable_sync.py` 全量同步脚本
  - CLI钩子：`eaa add/revert` 完成后自动触发飞书同步
  - 定时兜底：每天07:00/12:00/18:00/22:00全量检查
  - 防循环机制：SHA256校验避免同步脚本触发自身
- **PostgreSQL后端** — 可选替代文件系统存储
  - `sqlx` 依赖，实现 `postgres` feature
  - `scripts/migrate_to_pg.py` 迁移脚本
  - 配置示例：`.env.example`
- **Benchmark系统** — 安兔兔式标准化跑分
  - `benchmark/` 目录，四维度评估（安全0.35/数据0.30/任务0.25/性能0.10）
  - `eaa-benchmark` 命令行入口
  - 14条基准测试用例
  - run_A vs run_B 对比功能
- **Docker Compose** — PostgreSQL + EAA 一键部署

### 变更
- 版本号 v3.2.0 → v4.0.0
- CLI文档全面更新至v4.0
- 事件溯源文档新增v4.0特性
- wrapper脚本升级v5.0（双后端 + Python扩展命令）
- 默认输出保持text兼容，`-O json` 启用JSON
- releases/linux-x86_64/eaa 二进制更新至v4.0

### 修复
- 同步脚本防循环：SHA256校验文件变化后再执行
- 总览表更新性能优化：仅在有新事件时触发（避免64秒全量跑）
- 无事件时跳过分值更新（耗时从64秒降到1.4秒）

## [3.2.0] - 2026-04-22

### 新增
- **隐私脱敏铁律**：12个Agent配置文件全部写入强制性脱敏规则
- **Cron任务脱敏强化**：17个定时任务payload追加🔴🔴🔴三级警报式脱敏指令
- **counselor Agent**：新增SOUL.md + AGENTS.md（谈话计划+学业日报）
- **governor Agent**：新增SOUL.md + AGENTS.md（督导复盘+数据校验+风险分析）
- **talk_planner Agent**：新增AGENTS.md（功能已整合到counselor）
- **主配置脱敏同步**：config/main_*.md（AGENTS/SOUL/USER/IDENTITY脱敏版）
- **single-agent隐私规则**：SOUL.md追加v3.2隐私脱敏铁律

### 变更
- Agent数量从10个扩展到12个（新增counselor、governor）
- 所有Agent输出文件强制使用S_XXX化名（之前直接用真名）
- 写文件后grep自检：确保无真名残留
- 脱敏流程标准化：eaa CLI获取 → anonymize脱敏 → 写文件 → deanonymize推送

### 修复
- 15个Agent输出文件中的学生真名已替换为S_XXX
- governor_evening_validation.json JSON格式损坏已清理
- main_morning/research_evening学生数51→52修正
- GitHub remote URL中的PAT Token已移除
- 所有硬编码路径替换为环境变量引用

### 安全
- 5重安全扫描全部通过：0处敏感信息残留
- .gitignore强化覆盖inbox/隐私数据/EAA数据目录
- 删除含飞书用户ID的inbox文件

## [3.1.0] - 2026-04-22

### 新增
- **隐私脱敏引擎**（PII Shield）
  - `eaa privacy list`：查看52人映射表
  - `eaa privacy anonymize`：真名→S_XXX
  - `eaa privacy deanonymize`：S_XXX→真名
  - `eaa privacy dry-run`：往返测试
  - AES-256-GCM加密映射表
  - 52名学生全部映射（S_001~S_052）
- **学生档案查询**
  - `eaa profile <姓名>`：完整档案（自动脱敏）
  - `eaa grades <姓名>`：学业成绩
  - `eaa talks <姓名>`：谈话记录
  - `eaa export-profiles`：导出脱敏CSV
- **`--full` 参数**：不脱敏，仅限教师直接对话使用
- **profiles.json**：52名学生完整档案纳入EAA数据目录
- **权限锁定**：students.json改为600（仅root可读）

### 变更
- EAA CLI wrapper升级v3.2：支持profile/grades/talks命令
- 数据权威源更新：EAA事件库 > 飞书Bitable v2 > copawctl
- Agent隐私规则：所有Agent输出到外部系统必须先脱敏
- 脱敏规则明确：发给教师本人用真名，发给其他系统用化名

## [3.0.0] - 2026-04-21

### 新增
- eaa CLI v2.0全面重构
  - 原子写入（tmp → fsync → rename）
  - UUID v4事件ID
  - 文件锁（RAII自动释放）
  - `--dry-run`预演模式
  - `--force`强制执行
  - `doctor`环境健康检查
  - `export` CSV导出
  - 去重校验（同学生+同日+同原因码）
  - Revert保护（撤销事件不可再撤销）
  - 操作日志（operations.jsonl）
- 18个CLI命令完整支持
- 模块化代码拆分（types/storage/commands/validation/privacy）
- Nushell安装/卸载脚本
- Docker部署支持
- CI/CD GitHub Actions

### 修复
- reason_code从枚举改为String，运行时校验
- Revert二次撤销拦截
- unwrap链改为安全匹配
- 文件锁RAII Drop自动释放
- 时区改为Local/Asia/Shanghai
- 清除所有编译warnings

## [2.0.0] - 2026-04-13

### 新增
- 飞书Bitable v2数据同步
- 评分记录表+学生操行分总览表
- 18个Cron定时任务完整配置
- 多Agent协作架构（10个Agent）
- 原因码体系（22种标准原因码）

### 变更
- 操行分范围调整为0-200（加分无上限）
- 数据权威源：EAA事件库 > 飞书Bitable > copawctl

## [1.0.0] - 2026-04-01

### 新增
- 初始版本
- eaa CLI基础功能（info/validate/replay/ranking/score/history/add/revert）
- 事件溯源数据引擎（Rust）
- 原因码强类型校验
- 多Agent架构（OpenClaw）
- 单Agent模式（SOUL.md）
- 一键安装脚本
