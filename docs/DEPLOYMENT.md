# 部署指南

## 目录
1. [环境要求](#环境要求)
2. [一键部署](#一键部署)
3. [手动部署](#手动部署)
4. [配置通信通道](#配置通信通道)
5. [编译 CLI](#编译-cli)
6. [首次交互引导](#首次交互引导)

---

## 环境要求

### 必需
- Node.js 18+（用于 OpenClaw）
- npm 或 yarn

### 推荐
- Python 3.8+（用于辅助脚本）
- Rust 工具链（用于编译 `eaa` CLI，不编译则无法使用本地数据管理）
- Linux 服务器

---

## 一键部署

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
bash install.sh
```

安装脚本会自动：
1. 检查环境依赖
2. 创建目录结构
3. 编译 `eaa` CLI（如果有 Rust）
4. 初始化示例数据
5. 验证系统完整性

---

## 手动部署

### 1. 安装 OpenClaw

```bash
npm install -g openclaw
```

### 2. 克隆项目

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
```

### 3. 配置通信通道

EAA 支持所有 OpenClaw 通道。在 OpenClaw 配置中选择您需要的通道：

| 通道 | 配置方式 |
|:-----|:---------|
| 飞书 | 在飞书开放平台创建应用，配置 APP_ID/APP_SECRET |
| QQ | 通过 QQ 机器人平台配置 |
| Discord | 创建 Bot，配置 Token |
| Telegram | 通过 BotFather 创建 Bot |

> **注意**：不绑定任何单一通道。您可以选择任意一个或多个。

### 4. 编译 CLI（可选但推荐）

```bash
cd core/eaa-cli
cargo build --release
# 二进制文件: target/release/eaa
```

### 5. 初始化

```bash
python3 scripts/init_system.py
```

### 6. 启动 OpenClaw

```bash
openclaw gateway start
```

---

## 配置通信通道

### 飞书

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 创建企业自建应用
3. 获取 APP_ID 和 APP_SECRET
4. 配置权限（消息、日历、任务等）
5. 在 OpenClaw 配置中填入凭证

### QQ / Discord / Telegram

按照 OpenClaw 对应通道的文档配置即可。EAA 的 Agent 不依赖任何通道特定功能。

---

## 编译 CLI

`eaa` CLI 是事件溯源数据引擎，用于学生操行分管理。编译需要 Rust 工具链：

```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 编译
cd core/eaa-cli
cargo build --release
```

---

## 首次交互引导

部署完成后，将系统提示词（Agent 的 SOUL.md 内容）交给 AI。AI 会自动执行引导流程：

1. **自我介绍**：AI 介绍自己是教育参谋助手
2. **收集基本信息**：询问您的姓名、学校、年级、班级人数等
3. **功能选择**：引导您选择需要启用的 Agent（学业分析、心理监测等）
4. **一键配置**：支持全部启用，也可以逐一选择
5. **初始化数据**：自动创建学生档案模板、初始化 `eaa` 数据

您只需要回答几个简单问题，AI 会完成所有配置。

---

## Agent 配置

在 `config/agents.yaml` 中启用/禁用 Agent：

```yaml
agents:
  main:
    enabled: true    # 主 Agent，必须启用
  supervisor:
    enabled: true    # 督导，建议启用
  academic:
    enabled: false   # 不需要可以禁用
```

---

## 故障排查

### 机器人无响应
- 检查 OpenClaw 状态：`openclaw gateway status`
- 检查通道凭证配置

### CLI 报错
- 确保在 `core/eaa-cli/` 目录下运行
- 检查 `data/` 和 `schema/` 目录是否存在

### 定时任务不执行
- 检查 `config/agents.yaml` 中的 cron 表达式
- 查看 OpenClaw 日志
