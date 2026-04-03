# 部署指南

## 目录
1. [环境要求](#环境要求)
2. [快速部署](#快速部署)
3. [手动部署](#手动部署)
4. [配置详解](#配置详解)
5. [Docker部署](#docker部署)
6. [故障排查](#故障排查)

---

## 环境要求

### 必需
- Python 3.8+
- Node.js 18+
- npm 或 yarn
- 飞书应用账号

### 推荐
- Linux 服务器 (Ubuntu 20.04+)
- 2GB+ 内存
- 10GB+ 磁盘空间

---

## 快速部署

### 方式一：使用安装脚本

```bash
# 克隆项目
git clone https://github.com/your-repo/education-advisor.git
cd education-advisor

# 运行安装脚本
bash install.sh
```

安装脚本会自动：
1. 检查环境依赖
2. 创建目录结构
3. 配置飞书参数
4. 初始化数据库
5. 验证系统完整性

### 方式二：使用 Docker

```bash
# 构建镜像
docker build -t education-advisor .

# 运行容器
docker run -d \
  -v ./config:/app/config \
  -v ./data:/app/data \
  -p 18789:18789 \
  education-advisor
```

---

## 手动部署

### 1. 安装 OpenClaw

```bash
# 安装 Node.js (如果没有)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 OpenClaw
npm install -g openclaw
```

### 2. 克隆项目

```bash
git clone https://github.com/your-repo/education-advisor.git
cd education-advisor
```

### 3. 安装 Python 依赖

```bash
pip install pytest pyyaml
```

### 4. 配置飞书应用

```bash
# 复制配置模板
cp config/app_config.example.json config/app_config.json

# 编辑配置
vim config/app_config.json
```

必需配置：
```json
{
  "app": {
    "app_id": "cli_xxxxxxxxxxxxxxxx",
    "app_secret": "xxxxxxxxxxxxxxxxxxxxxxxx",
    "user_open_id": "ou_xxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

### 5. 初始化系统

```bash
python3 scripts/init_system.py
```

### 6. 启动服务

```bash
# 前台运行（测试用）
openclaw gateway start

# 后台运行（生产用）
nohup openclaw gateway start &
```

### 7. 验证安装

```bash
# 检查服务状态
openclaw status

# 发送测试消息
curl -X POST http://localhost:18789/api/test
```

---

## 配置详解

### 飞书应用配置

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 创建企业自建应用
3. 获取凭证：
   - APP_ID：`cli_` 开头的字符串
   - APP_SECRET：在应用凭证页面
4. 配置权限：
   - 消息权限
   - 日历权限
   - 任务权限
5. 发布应用

### Agent配置

在 `config/agents.yaml` 中启用/禁用Agent：

```yaml
agents:
  main:
    enabled: true  # 主Agent必须启用
  
  supervisor:
    enabled: true  # 督导建议启用
  
  validator:
    enabled: true  # 数据校验建议启用
  
  academic:
    enabled: false  # 不需要可以禁用
```

### 定时任务配置

使用 CRON 表达式：

```yaml
schedule:
  morning_push: "0 7 * * *"    # 每天7:00
  supervision: "0 22 * * *"    # 每天22:00
```

常用表达式：
- `0 7 * * *` - 每天7:00
- `0 22 * * *` - 每天22:00
- `0 */6 * * *` - 每6小时
- `0 8 * * 1` - 每周一8:00

---

## Docker部署

### Dockerfile

```dockerfile
FROM python:3.10-slim

RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g openclaw

WORKDIR /app

COPY . .

RUN pip install pytest pyyaml

CMD ["openclaw", "gateway", "start"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  education-advisor:
    build: .
    ports:
      - "18789:18789"
    volumes:
      - ./config:/app/config
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
    environment:
      - TZ=Asia/Shanghai
```

### 启动

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

---

## 故障排查

### 机器人无响应

1. 检查应用是否发布
```bash
openclaw status
```

2. 检查飞书应用配置
```bash
cat config/app_config.json
```

3. 检查网络连接
```bash
curl -v https://open.feishu.cn
```

### 定时任务不执行

1. 检查 cron 配置
```bash
crontab -l
```

2. 检查日志
```bash
tail -f logs/cron.log
```

3. 手动触发测试
```bash
python3 scripts/supervisor_quick_scan.py
```

### 数据不同步

1. 检查数据目录权限
```bash
ls -la data/
```

2. 手动同步
```bash
python3 scripts/init_system.py --sync
```

### 性能问题

1. 检查资源使用
```bash
top
df -h
```

2. 清理缓存
```bash
python3 scripts/cleanup.py
```

---

## 联系支持

如有问题，请提交 [GitHub Issue](https://github.com/your-repo/education-advisor/issues)
