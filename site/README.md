# Education Advisor · 官网（site/）

仓库内的产品介绍站，**纯静态**：HTML + CSS + 原生 JS，零构建。

## 页面

| 文件 | 用途 |
| --- | --- |
| `index.html` | 产品主页（Hero / 特性 / 代理 / 架构 / 下载入口 / FAQ / 版权） |
| `download.html` | 下载页（通道切换 / GitHub 加速 / OS/架构/类型筛选 / 大表格 / 校验和） |
| `legal.html` | 法律声明 · 隐私政策 · MIT 协议 · 联系方式 |

## 在线地址

- 生产环境（Cloudflare Pages）：<https://eea.qdzwwqd.top/>
- 下载页：<https://eea.qdzwwqd.top/download.html>
- 法律声明：<https://eea.qdzwwqd.top/legal.html>

## 本地预览

```bash
cd site
python -m http.server 8080
# 访问 http://localhost:8080
```

或直接双击 `site/index.html`。

## 下载链接

- `download.html` 表格中所有按钮都直接指向 GitHub Release 资产，**带 GitHub 加速拼接**
- `assets/downloads/` 目录已废弃（之前是占位文件，现在统一走 GitHub）

## 部署

任意静态托管均可（Cloudflare Pages / GitHub Pages / Nginx / OSS）。CF Pages 绑定 GitHub 仓库后，把构建目录指向 `site/` 即可。

## Cloudflare Pages 配置建议

| 项 | 值 |
| --- | --- |
| Build command | （留空） |
| Build output directory | `site` |
| Root directory | `/` |
| 环境变量 | 无 |
| HTTP/3 | 开启 |
| Brotli | 开启（默认） |
| Cache Level | Standard |
| Minification | HTML/CSS/JS（默认） |

## 浏览器兼容

Chrome / Edge ≥ 90 · Firefox ≥ 88 · Safari ≥ 14。

## License

MIT，与主项目保持一致。Copyright © 2025 sq199.
