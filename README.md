# 🎓 教育参谋系统 (Education Advisor AI)

<div align="center">

**基于 OpenClaw 框架的智能教育管理助手**

*为班主任和教师提供学生管理、教育督导、科研辅助的全场景智能服务*

**[项目详细介绍](./PROJECT_INTRO.md)** · **[快速开始](./docs/QUICK_START.md)** · **[系统架构](./docs/SYSTEM_ARCHITECTURE.md)** · **[安全限制](./docs/SECURITY.md)**

</div>

## ✨ 功能特性

- 📋 **学生档案管理** - 自动维护学生档案，记录行为、谈话、成绩
- 🔍 **智能风险预警** - 多维度评估学生风险等级，自动识别高风险学生
- 📊 **督导复盘** - 每日自动生成督导报告，待办事项提醒
- 💬 **谈话计划** - 智能推荐谈话学生，提供谈话话术建议
- 📅 **日历同步** - 与飞书日历同步课表和日程
- 📈 **成绩分析** - 自动分析成绩分布，识别学业预警
- 🔐 **数据校验** - 多Agent交叉校验，确保数据准确性
- 🗄️ **事件溯源数据系统** - Rust 高性能 CLI，不可变事件流，完全可追溯

## 🚀 快速部署

### 方式一：一键部署（推荐）

```bash
# 克隆项目
git clone https://github.com/232252/education-advisor.git
cd education-advisor

# 运行自动部署脚本
bash install.sh

# 按提示配置飞书应用参数
```

### 方式二：手动部署

1. 安装 OpenClaw
```bash
npm install -g openclaw
```

2. 配置飞书应用
```bash
cp config/app_config.example.json config/app_config.json
vim config/app_config.json
```

3. 编译数据系统 CLI（可选，需要本地数据管理）
```bash
cd core/copaw-cli
cargo build --release
# 二进制文件: target/release/copaw
```

4. 初始化系统
```bash
python3 scripts/init_system.py
```

### 方式三：直接交给 OpenClaw（最简）

```
将本项目地址交给 OpenClaw AI，AI 会自动创建文件并完成部署配置：
https://github.com/232252/education-advisor
```

## 🗄️ 事件溯源数据系统

系统内置基于 Rust 的事件溯源操行分管理 CLI（`copaw`），是**唯一的数据读写入口**。

### 核心架构

```
用户/Agent → copaw CLI → 事件流(events.json) → 重放引擎 → 实时分数
```

- **不可变事件流**：所有分数变动以事件形式追加，不可删除/修改
- **重放计算**：当前分数 = 100 + Σ(事件分值)，实时计算
- **强制校验**：新增事件必须通过原因码和分值校验
- **可撤销**：通过 REVERT 事件对冲，保留完整审计轨迹

### 常用命令

```bash
copaw info                    # 系统信息
copaw score <姓名>            # 查询分数
copaw history <姓名>          # 事件时间线
copaw ranking [数量]          # 排行榜
copaw search <关键词>          # 搜索事件
copaw add <姓名> <原因码>      # 新增事件
copaw revert <事件ID>         # 撤销事件
copaw stats                   # 统计摘要
copaw codes                   # 原因码列表
```

详见 [CLI命令手册](./docs/CLI_REFERENCE.md) 和 [事件溯源架构说明](./docs/EVENT_SOURCING.md)。

## 📁 项目结构

```
education-advisor/
├── README.md              # 项目说明
├── PROJECT_INTRO.md       # 项目详细介绍
├── install.sh             # 一键安装脚本
├── config/                # 配置文件
│   └── agents.yaml        # Agent定义（10个完整配置）
├── core/                  # 核心组件
│   └── copaw-cli/         # 事件溯源 CLI（Rust）
│       ├── src/main.rs    # CLI 源代码
│       ├── Cargo.toml     # Rust 项目配置
│       ├── schema/        # 原因码定义
│       ├── data/          # 示例数据（脱敏）
│       └── scripts/       # 迁移脚本
├── scripts/               # 系统脚本
├── agents/                # Agent工作区（10个Agent）
├── docs/                  # 完整文档
│   ├── EVENT_SOURCING.md  # 事件溯源架构
│   ├── CLI_REFERENCE.md   # CLI命令手册
│   ├── SECURITY.md        # 安全限制（必读）
│   └── VALIDATION_REPORT.md # 验证报告
└── examples/              # 脱敏示例数据
```

## ⚙️ 配置说明

### 必需配置

| 配置项 | 说明 | 获取方式 |
|:-------|:-----|:---------|
| APP_ID | 飞书应用ID | 飞书开放平台 |
| APP_SECRET | 飞书应用密钥 | 飞书开放平台 |
| USER_OPEN_ID | 您的飞书Open ID | 飞书个人资料 |

### Agent配置

系统包含10个Agent，可按需启用/禁用：

| Agent | 功能 | 必需 |
|:------|:-----|:-----|
| main | 主协调Agent | ✅ |
| supervisor | 督导复盘 | ✅ |
| validator | 数据校验 | ✅ |
| academic | 学业分析 | 可选 |
| psychology | 心理危机 | 可选 |
| safety | 安全检查 | 可选 |
| home_school | 家校沟通 | 可选 |
| research | 科研辅助 | 可选 |
| executor | 系统维护 | 可选 |
| talk_planner | 谈话计划 | 可选 |

## 🔒 安全限制

> ⚠️ **重要：所有部署者必须阅读 [SECURITY.md](./docs/SECURITY.md)**

- CLI 是唯一数据读写入口，禁止直接修改 JSON 文件
- Agent 只能通过 CLI 读写数据，禁止绕过校验
- 学生数据为敏感信息，禁止上传至公开仓库
- 本系统不得用于操控宿主系统

## 📖 使用指南

### 基础命令

```
/分析 学生姓名    - 分析学生风险
/预警            - 查看高风险学生
/待办            - 查看今日待办
/谈话计划        - 获取谈话建议
/科研            - 查看科研提醒
```

### 定时任务

| 时间 | 任务 |
|:-----|:-----|
| 07:00 | 早间推送 |
| 22:00 | 督导复盘 |
| 22:30 | 统一推送 |

## 🔮 未来发展方向

详细说明请查看 [PROJECT_INTRO.md](./PROJECT_INTRO.md)

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📧 联系

- **项目地址**: https://github.com/232252/education-advisor
- **问题反馈**: https://github.com/232252/education-advisor/issues
