# 单Agent部署指南

## 快速开始（3步）

### 1. 安装 eaa CLI
```bash
# 下载对应平台的二进制文件
cp releases/你的平台/eaa /usr/local/bin/
chmod +x /usr/local/bin/eaa

# 初始化数据目录
mkdir -p ./data/entities ./data/events
```

### 2. 初始化学生数据
创建 `./data/entities/entities.json`：
```json
{
  "entities": {
    "stu_001": {"id": "stu_001", "name": "张三", "aliases": [], "status": "ACTIVE", "created_at": "2025-09-01"},
    "stu_002": {"id": "stu_002", "name": "李四", "aliases": [], "status": "ACTIVE", "created_at": "2025-09-01"}
  }
}
```

创建 `./data/entities/name_index.json`：
```json
{"张三": "stu_001", "李四": "stu_002"}
```

创建 `./data/events/events.json`：
```json
[]
```

### 3. 配置AI助手
将 `single-agent/SOUL.md` 的内容复制到你的AI助手系统提示词中。

## 支持的平台

| 平台 | 配置方式 |
|:-----|:---------|
| OpenClaw | 放入 workspace/SOUL.md |
| ChatGPT GPTs | 紴入 Instructions |
| Claude Project | 加入 Project Instructions |
| 千问/通义 | 系统提示词 |
| 本地部署 | 任意支持系统提示词的框架 |

## 环境变量
```bash
export EAA_DATA_DIR=./data    # 数据目录路径
```

## 验证安装
```bash
eaa doctor    # 检查环境
eaa info      # 查看学生数和事件数
```
