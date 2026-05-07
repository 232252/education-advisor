# 📦 预编译二进制下载

从 [GitHub Releases](https://github.com/232252/education-advisor/releases) 下载适合您系统的版本。

## v3.1.2 可用平台

| 平台 | 文件 | 适用系统 |
|:-----|:-----|:---------|
| Linux x86_64 | `eaa-linux-x86_64` | 大多数Linux服务器和桌面 |
| Linux ARM64 | 从源码编译 | 树莓派、ARM服务器 |
| macOS (Intel) | 从源码编译 | Intel Mac |
| macOS (Apple Silicon) | 从源码编译 | M1/M2/M3/M4 Mac |
| Windows x86_64 | 从源码编译 | Windows 10/11 |

## 安装 (Linux x86_64)

```bash
curl -L https://github.com/232252/education-advisor/releases/latest/download/eaa-linux-x86_64 -o eaa
chmod +x eaa
sudo mv eaa /usr/local/bin/
eaa info
```

## 从源码编译（其他平台）

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor/core/eaa-cli
cargo build --release
# 二进制在 target/release/eaa
```
