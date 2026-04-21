# 🤖 AI自部署指南（v2.0）

> 将以下内容复制给AI助手，它会帮您部署教育参谋系统。

---

您好！我需要您帮我部署一个**教育参谋AI助手系统**（Education Advisor AI）。

请严格按照以下步骤操作，每完成一步向我报告结果。

## 第1步：前提条件检查

请先检查并告诉我：

1. 是否能执行 shell 命令？→ 运行 `which cargo` 或 `which eaa`
2. 操作系统？→ 运行 `uname -a`
3. 是否已安装 Rust？→ 运行 `cargo --version`

**如果无法执行任何命令**，请直接告诉我，我会使用方案C（纯对话模式）。

---

## 方案A：有命令执行权限 + 有 Rust

```bash
# 1. 克隆仓库
git clone https://github.com/232252/education-advisor.git
cd education-advisor/core/eaa-cli

# 2. 编译
cargo build --release

# 3. 创建数据目录
mkdir -p ~/eaa-data/entities ~/eaa-data/events ~/eaa-data/logs

# 4. 复制schema
cp -r schema/ ~/eaa-data/schema/

# 5. 设置环境变量
echo 'export EAA_DATA_DIR=~/eaa-data' >> ~/.bashrc
source ~/.bashrc

# 6. 创建全局命令（替换路径为实际路径）
cat > /usr/local/bin/eaa << 'EOF'
#!/bin/bash
export EAA_DATA_DIR="${EAA_DATA_DIR:-$HOME/eaa-data}"
exec /path/to/education-advisor/core/eaa-cli/target/release/eaa "$@"
EOF
chmod +x /usr/local/bin/eaa

# 7. 验证
eaa info
```

## 方案B：有命令执行权限 + 无 Rust

```bash
# 下载预编译二进制（Linux x86_64）
curl -L https://github.com/232252/education-advisor/releases/latest/download/eaa-linux-x86_64 -o /usr/local/bin/eaa
chmod +x /usr/local/bin/eaa

# 创建数据目录
mkdir -p ~/eaa-data/entities ~/eaa-data/events ~/eaa-data/logs

# 下载schema
mkdir -p ~/eaa-data/schema
curl -L https://raw.githubusercontent.com/232252/education-advisor/main/core/eaa-cli/schema/reason_codes.json -o ~/eaa-data/schema/reason_codes.json

# 设置环境变量
echo 'export EAA_DATA_DIR=~/eaa-data' >> ~/.bashrc
source ~/.bashrc

# 验证
eaa info
```

## 方案C：无命令权限（纯对话模式）

如果AI无法执行命令，直接进入对话管理模式：

- AI使用系统提示词（`single-agent/SOUL.md`）管理数据
- 数据存储在对话上下文中，**会话结束后数据丢失**
- **强烈建议**定期导出数据到本地文件
- 功能受限：无法持久化、无法多会话共享数据

---

## 验证步骤

部署后**必须**逐项验证：

```bash
eaa info        # 应显示学生数和事件数（初始为0）
eaa validate    # 应显示"所有事件有效"
eaa codes       # 应显示所有原因码
eaa ranking 5   # 应显示空排行榜（初始无学生）
```

如果任何一步失败，请将错误信息发给我。

---

## 导入学生数据

首次部署后需要导入学生：

```bash
# 单个添加（编辑 entities.json）
echo '[{"id":"stu_001","name":"张三","gender":"男","ethnicity":"汉族"}]' > ~/eaa-data/entities/entities.json

# 或使用 eaa 的批量导入功能（待开发）
```

参考 `examples/students/` 目录下的脱敏示例数据。

---

## 下一步

部署完成后，将 `single-agent/SOUL.md` 的内容设置为AI的系统提示词，然后开始对话。
AI会自动引导您完成首次配置。
