# Education Advisor · 官网（site/）

仓库内的产品介绍站，**纯静态**：HTML + CSS + 原生 JS，零构建。

## 在线地址
- 生产环境（Cloudflare Pages）：<https://eea.qdzwwqd.top/>

## 本地预览
```bash
cd site
python -m http.server 8080
# 访问 http://localhost:8080
```

或直接双击 `site/index.html`。

## 下载链接
所有下载按钮已直接指向 GitHub Release `v0.1.0-rc.1` 资产，无需本地 `assets/downloads/` 目录：
- Windows NSIS 安装版
- Windows 便携版
- macOS / Linux（CI 后续补，详见 GitHub Releases）

## 部署
任意静态托管均可（Cloudflare Pages / GitHub Pages / Nginx / OSS）。CF Pages 绑定 GitHub 仓库后，把构建目录指向 `site/` 即可。

## 浏览器兼容
Chrome / Edge ≥ 90 · Firefox ≥ 88 · Safari ≥ 14。

## License
MIT，与主项目保持一致。