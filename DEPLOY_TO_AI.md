# 🤖 AI自部署指南（v3.0）

> **使用方法**：将本文件全部内容复制给你的AI助手，AI会帮你完成部署。

---

你好！我需要你帮我部署一个**教育参谋AI助手系统**。请按以下步骤操作。

**重要规则**：
- 每完成一步，向我报告结果（成功/失败+输出内容）
- 遇到错误不要跳过，把错误信息发给我
- 不要猜测结果，实际运行命令告诉我真实输出

---

## 第1步：环境检测

请依次运行以下命令，把**每个命令的输出**都发给我：

```bash
# 1. 操作系统
uname -a

# 2. CPU架构
uname -m

# 3. 是否有curl
which curl

# 4. 是否有git
which git

# 5. 是否有cargo（Rust编译器）
which cargo
```

**如果所有命令都报"command not found"**，告诉我，我会用方案C（纯对话模式）。

---

## 第2步：选择方案

根据第1步结果选择：

### 方案A：有命令权限 + Linux x86_64（大多数情况）

```bash
# 1. 下载eaa CLI
sudo curl -L https://github.com/232252/education-advisor/releases/latest/download/eaa-linux-x86_64 -o /usr/local/bin/eaa
sudo chmod +x /usr/local/bin/eaa

# 2. 验证下载成功
eaa --version
```

如果下载失败（网络问题），用方案B从源码编译。

### 方案B：有命令权限 + 有Rust编译器

```bash
# 1. 克隆仓库
git clone https://github.com/232252/education-advisor.git
cd education-advisor/core/eaa-cli

# 2. 编译
cargo build --release

# 3. 安装到全局
sudo cp target/release/eaa /usr/local/bin/eaa

# 4. 验证
eaa --version
```

### 方案C：无法执行命令

跳到第5步，使用纯对话模式。

---

## 第3步：初始化数据

**eaa CLI安装成功后**，运行：

```bash
# 1. 创建数据目录
mkdir -p ~/eaa-data/entities ~/eaa-data/events

# 2. 下载原因码Schema
mkdir -p ~/eaa-data/schema
curl -L https://raw.githubusercontent.com/232252/education-advisor/main/core/eaa-cli/schema/reason_codes.json \
  -o ~/eaa-data/schema/reason_codes.json

# 3. 设置环境变量
# bash用户：
echo 'export EAA_DATA_DIR=~/eaa-data' >> ~/.bashrc
# zsh用户：
# echo 'export EAA_DATA_DIR=~/eaa-data' >> ~/.zshrc
# 通用：
echo 'export EAA_DATA_DIR=~/eaa-data' >> ~/.profile
source ~/.bashrc 2>/dev/null || source ~/.zshrc 2>/dev/null || source ~/.profile

# 4. 验证
eaa doctor
```

**eaa doctor 应该输出**：
```
✅ 数据目录: ~/eaa-data
✅ 原因码Schema: ~/eaa-data/schema/reason_codes.json
✅ 实体加载: 0 名学生
✅ 事件加载: 0 条
```

如果任何一项是❌，把完整输出发给我。

---

## 第4步：导入学生数据

创建学生数据文件。**请先告诉我：**

1. 您的学生总人数？
2. 您要不要我批量生成学生数据？（提供学生名单，AI自动生成JSON）

**模板格式**（以3个学生为例）：

运行以下命令创建 `~/eaa-data/entities/entities.json`：

```bash
cat > ~/eaa-data/entities/entities.json << 'EOF'
{
  "entities": {
    "stu_001": {"id": "stu_001", "name": "张三", "aliases": [], "status": "ACTIVE", "created_at": "2025-09-01"},
    "stu_002": {"id": "stu_002", "name": "李四", "aliases": ["小李"], "status": "ACTIVE", "created_at": "2025-09-01"},
    "stu_003": {"id": "stu_003", "name": "王五", "aliases": [], "status": "ACTIVE", "created_at": "2025-09-01"}
  }
}
EOF
```

创建姓名索引 `~/eaa-data/entities/name_index.json`：

```bash
cat > ~/eaa-data/entities/name_index.json << 'EOF'
{"张三": "stu_001", "李四": "stu_002", "小李": "stu_002", "王五": "stu_003"}
EOF
```

创建空事件文件 `~/eaa-data/events/events.json`：

```bash
echo '[]' > ~/eaa-data/events/events.json
```

**验证**：

```bash
eaa info
```

应显示：`3 名学生, 0 条事件`

---

## 第5步：配置AI系统提示词

### 如果是OpenClaw
```bash
# 将SOUL.md放入workspace
mkdir -p ~/.openclaw/workspace
curl -L https://raw.githubusercontent.com/232252/education-advisor/main/single-agent/SOUL.md \
  -o ~/.openclaw/workspace/SOUL.md
```

### 如果是其他AI平台
1. 打开 `single-agent/SOUL.md` 文件
2. 复制全部内容
3. 粘贴到AI助手的"系统提示词"或"Instructions"中

---

## 第6步：首次对话验证

部署完成后，向AI发送：

```
eaa info
```

**AI应该**：
1. 运行 `eaa info` 命令
2. 返回学生数和事件数
3. 如果数据正确，部署成功

**然后发送**：
```
帮我查看排行榜
```

**AI应该**：
1. 运行 `eaa ranking 10`
2. 返回排行榜（初始可能为空，因为还没有事件）

---

## 常见问题

### 国内网络下载慢
```bash
# GitHub raw链接国内可能不稳定
# 可先克隆仓库再本地复制
git clone https://github.com/232252/education-advisor.git
cp education-advisor/core/eaa-cli/schema/reason_codes.json ~/eaa-data/schema/
cp education-advisor/releases/linux-x86_64/eaa /usr/local/bin/eaa
```

### 已有旧版本
```bash
# 检查当前版本
eaa --version
# 如果已安装，直接替换二进制文件即可
cp /path/to/new/eaa /usr/local/bin/eaa
# 数据目录不变，无需重新初始化
```

### eaa: command not found
```bash
# 检查是否在PATH中
ls -la /usr/local/bin/eaa
# 如果不在，重新安装（见第2步）
```

### eaa doctor显示❌
```bash
# 检查数据目录
ls -la ~/eaa-data/entities/
ls -la ~/eaa-data/events/
ls -la ~/eaa-data/schema/

# 检查环境变量
echo $EAA_DATA_DIR
# 如果为空，运行：
source ~/.bashrc
```

### AI不执行eaa命令
- 确认AI平台支持执行命令
- 如果不支持，只能用纯对话模式（功能受限）

### 权限不足
```bash
# eaa需要写入data目录的权限
chmod 755 ~/eaa-data
chmod 644 ~/eaa-data/entities/*.json
chmod 644 ~/eaa-data/events/*.json
```

---

## 部署完成检查清单

完成所有步骤后确认：

- [ ] `eaa doctor` 全部✅
- [ ] `eaa info` 显示正确学生数
- [ ] `eaa validate` 无错误
- [ ] AI系统提示词已设置
- [ ] AI能执行 `eaa` 命令并返回结果

**全部打勾 → 部署成功！开始使用吧。**
