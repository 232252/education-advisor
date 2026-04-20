# 🚀 快速开始指南

## 前置要求

- Node.js 18+
- npm
- （推荐）Python 3.8+、Rust 工具链

## 步骤1：安装

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
bash install.sh
```

## 步骤2：配置通信通道

在 OpenClaw 配置中选择您的通道（飞书/QQ/Discord/Telegram 任选其一或多选），填入对应凭证。

参见 [部署指南](./DEPLOYMENT.md)。

## 步骤3：启动

```bash
openclaw gateway start
```

## 步骤4：首次交互

给 AI 发送任意消息，AI 会自动开始引导配置流程：

1. 自我介绍
2. 询问您的基本信息（姓名、学校、年级、班级人数）
3. 引导您选择需要的功能
4. 自动初始化数据

## 验证安装

发送消息给 AI：
```
/状态
```

如果返回系统状态，说明安装成功。

## 常用命令

```
/分析 学生姓名    - 分析学生风险
/预警            - 查看高风险学生
/待办            - 查看今日待办
/谈话计划        - 获取谈话建议
```

## CLI 命令（如已编译 eaa）

```bash
cd core/eaa-cli
./target/release/eaa info        # 系统信息
./target/release/eaa stats       # 统计摘要
./target/release/eaa ranking 52  # 完整排行榜
```

## 下一步

- [配置 Agent](../config/agents.yaml)
- [阅读系统架构](./SYSTEM_ARCHITECTURE.md)
- [CLI 命令手册](./CLI_REFERENCE.md)
- [事件溯源架构](./EVENT_SOURCING.md)
