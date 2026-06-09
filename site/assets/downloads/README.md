# 📦 Education Advisor · 安装包

> v0.1.0-rc.1 候选发布已上线，前往 [GitHub Releases](https://github.com/232252/education-advisor/releases/tag/v0.1.0-rc.1) 下载。

## 当前状态

**已发布** — Windows 安装包（NSIS）+ Windows 便携版已在 GitHub Release 资产中可直接下载。

## 下载链接

| 平台 | 类型 | 链接 |
| --- | --- | --- |
| Windows | NSIS 安装版（推荐） | <https://github.com/232252/education-advisor/releases/download/v0.1.0-rc.1/Education%20Advisor-0.1.0-rc.1-Setup.exe> |
| Windows | 单文件便携版 | <https://github.com/232252/education-advisor/releases/download/v0.1.0-rc.1/Education%20Advisor-0.1.0-rc.1-portable.exe> |
| macOS / Linux | 跨平台 | 见 [Releases 页面](https://github.com/232252/education-advisor/releases)，后续 tag 由 CI 自动构建 |

## 如何获取 v0.1.0-rc.1

### 方式 1：从 GitHub Releases 下载（推荐普通用户）

前往 [Releases 页面](https://github.com/232252/education-advisor/releases/tag/v0.1.0-rc.1) 下载预编译安装包。

### 方式 2：从源码构建（推荐开发者）

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
npm ci
npm run build:eaa    # 拉取 Rust eaa-cli 二进制
npm run build        # 编译渲染层 + 主进程
npm run package      # 产出 Windows NSIS 安装包到 release/
```

构建产物路径：
- `release/Education Advisor-0.1.0-rc.1-Setup.exe`（NSIS 安装版，~85 MB）
- `release/Education Advisor-0.1.0-rc.1-portable.exe`（单文件绿色版，~75 MB）

### 方式 3：等待自动发布

关注仓库的 Releases / Discussions，第一时间获取 v0.1.0 正式版通知。

## 系统要求

| 项目 | 最低配置 |
| --- | --- |
| 操作系统 | Windows 10 1809+ / Windows 11 / macOS 11+ / Ubuntu 20.04+ |
| 内存 | 4 GB（推荐 8 GB） |
| 磁盘 | 500 MB（含本地 LLM 推理另需 ≥6 GB） |
| Node.js | 22.0+（仅源码构建需要） |

## 校验

每个发布版本都会附带 SHA-256 校验和，可与 [GitHub Releases](https://github.com/232252/education-advisor/releases) 中的清单核对。

---

**让教育更智能，让教师更轻松。**
