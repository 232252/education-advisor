# 🎓 教育参谋系统 (Education Advisor AI)

<div align="center">

**基于 OpenClaw 框架的智能教育管理助手**

*为班主任和教师提供学生管理、教育督导、科研辅助的全场景智能服务*

**[项目详细介绍](./PROJECT_INTRO.md)** · **[快速开始](./docs/QUICK_START.md)** · **[系统架构](./docs/SYSTEM_ARCHITECTURE.md)**

</div>

## ✨ 功能特性

- 📋 **学生档案管理** - 自动维护学生档案，记录行为、谈话、成绩
- 🔍 **智能风险预警** - 多维度评估学生风险等级，自动识别高风险学生
- 📊 **督导复盘** - 每日自动生成督导报告，待办事项提醒
- 💬 **谈话计划** - 智能推荐谈话学生，提供谈话话术建议
- 📅 **日历同步** - 与飞书日历同步课表和日程
- 📈 **成绩分析** - 自动分析成绩分布，识别学业预警
- 🔐 **数据校验** - 多Agent交叉校验，确保数据准确性

## 🚀 快速部署

### 方式一：一键部署（推荐）

```bash
# 克隆项目
git clone https://github.com/your-repo/education-advisor.git
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
# 复制配置模板
cp config/app_config.example.json config/app_config.json

# 编辑配置，填入您的飞书应用参数
vim config/app_config.json
```

3. 初始化系统
```bash
python3 scripts/init_system.py
```

## 📁 项目结构

```
education-advisor/
├── README.md           # 项目说明
├── install.sh          # 一键安装脚本
├── config/             # 配置文件
│   ├── app_config.example.json  # 配置模板
│   └── agents.yaml     # Agent定义
├── scripts/            # 系统脚本
│   ├── init_system.py  # 初始化脚本
│   └── *.py            # 各种工具脚本
├── agents/             # Agent定义
│   ├── supervisor/     # 督导Agent
│   ├── validator/      # 数据校验Agent
│   └── ...
├── skills/             # 技能定义
├── docs/               # 文档
├── examples/           # 示例数据
│   └── students/       # 示例学生档案（脱敏）
└── tests/              # 测试
```

## ⚙️ 配置说明

### 必需配置

| 配置项 | 说明 | 获取方式 |
|:-------|:-----|:---------|
| APP_ID | 飞书应用ID | 飞书开放平台 |
| APP_SECRET | 飞书应用密钥 | 飞书开放平台 |
| USER_OPEN_ID | 您的飞书Open ID | 飞书个人资料 |

### 可选配置

| 配置项 | 说明 | 默认值 |
|:-------|:-----|:-------|
| CALENDAR_ID | 日历ID | 主日历 |
| BITABLE_APP_TOKEN | 多维表格Token | 无 |

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
| home_school | 家校通知 | 可选 |
| research | 科研辅助 | 可选 |
| executor | 系统维护 | 可选 |
| talk_planner | 谈话计划 | 可选 |

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

系统自动执行以下任务：

| 时间 | 任务 |
|:-----|:-----|
| 07:00 | 早间推送 |
| 22:00 | 督导复盘 |
| 22:30 | 统一推送 |

## 🔧 扩展开发

### 创建新Agent

1. 在 `agents/` 下创建Agent目录
2. 编写 `SOUL.md` 定义角色
3. 在 `config/agents.yaml` 注册

### 创建新技能

1. 在 `skills/` 下创建技能目录
2. 编写 `SKILL.md` 定义接口
3. 在Agent中引用

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📧 联系

如有问题，请提交 GitHub Issue。
