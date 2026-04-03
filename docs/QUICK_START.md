# 🚀 快速开始指南

## 前置要求

- Python 3.8+
- Node.js 18+
- npm
- 飞书应用（开放平台账号）

## 步骤1：获取飞书应用凭证

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 创建企业自建应用
3. 获取以下凭证：
   - `APP_ID`: 应用唯一标识
   - `APP_SECRET`: 应用密钥
4. 配置应用权限（消息、日历、任务等）
5. 发布应用

## 步骤2：获取您的飞书Open ID

1. 打开飞书
2. 点击头像 → 设置 → 关于
3. 找到 Open ID（格式：`ou_xxx`）

## 步骤3：安装系统

```bash
# 克隆项目
git clone https://github.com/your-repo/education-advisor.git
cd education-advisor

# 运行安装脚本
bash install.sh
```

## 步骤4：配置

```bash
# 编辑配置文件
vim config/app_config.json
```

填入您的凭证：
```json
{
  "app": {
    "app_id": "cli_xxxxxxxx",
    "app_secret": "xxxxxxxx",
    "user_open_id": "ou_xxxxxxxx"
  }
}
```

## 步骤5：初始化

```bash
python3 scripts/init_system.py
```

## 步骤6：启动

```bash
# 启动OpenClaw服务
openclaw gateway start

# 或后台运行
nohup openclaw gateway start &
```

## 验证安装

发送消息给机器人：
```
/状态
```

如果返回系统状态，说明安装成功。

## 常见问题

### 1. 机器人无响应
- 检查 APP_ID 和 APP_SECRET 是否正确
- 检查应用是否已发布
- 检查权限是否开通

### 2. 日历同步失败
- 检查日历权限是否开通
- 确认 CALENDAR_ID 格式正确

### 3. 定时任务不执行
- 检查 cron 配置
- 查看日志排查错误

## 下一步

- [配置Agent](../config/agents.yaml)
- [添加学生档案](../data/students/)
- [自定义定时任务](../config/agents.yaml#L1)
- [阅读系统架构](../docs/SYSTEM_ARCHITECTURE.md)
