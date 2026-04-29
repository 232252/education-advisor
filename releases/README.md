# 📦 预编译二进制下载

从 [GitHub Releases](https://github.com/232252/education-advisor/releases) 下载适合您系统的版本。

## 可用平台

| 平台 | 文件 | 适用系统 |
|:-----|:-----|:---------|
| Linux x86_64 | `eaa-linux-x86_64` | 大多数Linux服务器和桌面 |
| Linux ARM64 | `eaa-linux-arm64` | 树莓派、ARM服务器 |
| macOS x86_64 | `eaa-macos-x86_64` | Intel Mac |
| macOS ARM64 | `eaa-macos-arm64` | Apple Silicon Mac (M1/M2/M3/M4) |

## 安装方法

```bash
# 1. 下载（以 Linux x86_64 为例）
curl -L https://github.com/232252/education-advisor/releases/latest/download/eaa-linux-x86_64 -o eaa

# 2. 添加执行权限
chmod +x eaa

# 3. 移动到系统路径（可选）
sudo mv eaa /usr/local/bin/

# 4. 验证
eaa info
```

## 当前构建状态

- ✅ **linux-x86_64**: 已构建
- ⏳ **linux-arm64**: 待构建
- ⏳ **macos-x86_64**: 待构建
- ⏳ **macos-arm64**: 待构建

> 其他平台的二进制将在后续 Release 中提供。如果您有对应平台的 Rust 编译环境，可以自行编译：
> ```bash
> cd core/eaa-cli && cargo build --release
> ```
