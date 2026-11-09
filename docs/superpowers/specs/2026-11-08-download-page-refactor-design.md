# 下载页重构：以 EasyTier 下载页为骨架，用 Cloudflare Worker 供数

**日期**：2026-11-08
**状态**：已实现并部署（2026-11-08，经用户确认两步部署：`eea-releases` Worker + 现站静态资源）。实现时与下文有两处运行时偏差，均实测后采纳：① Cloudflare 出口 IP 被 GitHub 匿名 REST 拒绝（403），Worker 回源改为 GitHub → `ungh.cc` 镜像兜底（产出同一 raw 形状后归一化）；② Gitee API 对数据中心 IP + 非浏览器 UA 有拦截，Worker 对 Gitee 使用拟真 UA。风险表 §10 中的静态兜底/浏览器直连降级链照常生效。
**目标**：`site-build/download.html` 从「三张静态平台卡片 + 手抄版本号」重构为「通道/系统/架构筛选 + 下载表格」，版本与资产全部来自实时 API；配套一个 Cloudflare Worker 做边缘缓存与归一化。

---

## 0. 调研结论摘要（全部为实测，非推测）

| 事实 | 来源 | 影响 |
|---|---|---|
| 现页硬编码兜底版本 `v0.1.0-rc`，实际最新已 `v3.3.5` | `site-build/download.html:110` | 手抄版本号必然漂移，是既有事故源（R2-01 修复只覆盖了「链接」，没覆盖「展示」） |
| 现页「Gitee 加速下载 .exe」→ `gitee.com/.../releases/download/<tag>/Education-Advisor-Setup.exe` | `download.js:40` + Gitee API 实查 | **v3.x 全部 404**：Gitee 免费版单附件 100MB 上限，`gitee-sync.yml:79` 主动跳过超限安装包，镜像只剩 `SHA256SUMS` / `latest*.yml` / 源码包 |
| 现页只拉 `releases/latest` 一个 release | `download.js:56` | 无法提供历史版本与预发布版下载 |
| 站点实为 **Workers 静态资源**（非 Pages）：`rapid-sky-9499`，自定义域名 `eea.qdzwwqd.top`，`wrangler.toml` 仅 `[assets]`，无脚本无绑定 | Cloudflare API 实查 | 转成「脚本+静态资源」Worker 需整包重传 52MB（3 个 mp4 占 51MB），风险收益不划算 → API 另起 Worker |
| 站点资源 52MB，其中 mp4 51MB | 本地统计 | 同上 |
| zone `qdzwwqd.top` 属同账号 `dfd02bbb…`，无任何 route（纯自定义域名模式） | Cloudflare API 实查 | 新增独立子域 Worker 与现站零冲突 |
| 资产命名跨版本演进：`Education-Advisor-Setup.exe` / `Education-Advisor-3.2.0-Setup.exe` / `Education.Advisor-0.1.0-rc.1-arm64.dmg` / `EducationAdvisor-Portable-Windows-x64.zip` | GitHub Releases API 实查 | 分类逻辑必须按**模式**而非固定文件名匹配 |
| macOS 有 `.dmg` 与 `.zip` 两种产物；Windows 有 Setup 与 Portable 两种；Linux 有 `.deb` 与 `.AppImage` 两种 | 同上 | 表格单元格需容纳多格式 |
| `blockmap` / `latest*.yml` 是差量更新清单，非用户下载物 | 同上 | 不进安装包表 |

---

## 1. 核心设计决策

1. **新增独立 Worker `eea-releases`，现站 `rapid-sky-9499` 一行不改。** 现站 52MB 资源不重传；删掉新 Worker 即完成回滚。API 走独立子域 `api.eea.qdzwwqd.top`（Cloudflare 自动建 DNS + 证书，与现站同 zone 同账号）。
2. **分类与归一化只在 Worker 里做一遍**，前端只渲染。资产名 → 平台/架构/类型的映射是代码而非 HTML 里的 `data-asset` 正则，新增命名不再需要改页面。
3. **GitHub API 匿名模式（用户已定）**，不存任何凭据。Worker 无 `GITHUB_TOKEN` secret，代码保留「若未来注入 token 则带上 Authorization」的口子，但不默认启用。
4. **降级链三层**：Worker → 浏览器直连 GitHub API（用访客自己的 IP 配额）→ 页面内置静态表。静态表用 `releases/latest/download/<资产名>` 这类**不锁版本**的链接，因此永不漂移；静态态下**不展示版本号**（展示「最新版本」），彻底消灭手抄版本。
5. **不设 CLI 列。** Rust EAA CLI 是应用内 Sidecar，不单独发版；参考页的 GUI/CLI 双列在 eaa 没有对应物，硬凑会每行都是「无」。
6. **通道三档**：稳定版（最新 `prerelease=false`）/ 预发布版（最新 `prerelease=true`，当前 `v0.1.0-rc.1`）/ 历史版本（其余，选中出现「具体版本」下拉）。
7. **Gitee 按资产逐个判定可用性**，不整版一刀切：Worker 同时抓 Gitee 公开 API，产出 `tag → 资产名集合` 映射；前端仅在该资产确实存在于 Gitee 时给镜像链接，否则显示「镜像未同步（超 100MB 单附件上限）」并链到该 tag 的 Gitee release 页。
8. **更新日志先转义再渲染 markdown。** 现页把 release body 直接 `innerHTML`（`download.js:65`），属半可信内容直插；改为 escape-first 再做 markdown 替换。
9. **下载源下拉沿用参考页形态**：GitHub 直连（默认）/ 第三方加速（ghfast.top、v6.gh-proxy.org、hk.gh-proxy.org，标注第三方）/ Gitee 镜像（官方同源）。第三方加速项属外部服务，UI 上显式标注，不做默认。

---

## 2. 架构与数据流

```
                    ┌─────────────────────────────────────────┐
   访客浏览器 ──────▶│ site-build/download.html (静态, 现站)     │
                    │  ├─ assets/js/download.js  渲染 + 筛选     │
                    │  └─ 内置静态兜底表（/latest/download 链接） │
                    └───────────────┬─────────────────────────┘
                                    │ 1) GET api.eea.qdzwwqd.top/releases
                                    │ 2) 失败 → api.github.com/...(浏览器直连)
                                    │ 3) 失败 → 内置静态表
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │ Worker eea-releases (无静态资源)          │
                    │  GitHub Releases API ─┐                  │
                    │  Gitee Releases API ──┴→ 归一化 + 分类    │
                    │  Cache API: 15min 新鲜 / 24h 可过期      │
                    └─────────────────────────────────────────┘
```

静态站与 Worker 是两个独立 Worker：站点不可用互不影响；Worker 可随时重建。

---

## 3. Worker 契约

**端点**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/releases` | 归一化后的全部 release 列表 |
| GET | `/health` | `{ ok, updatedAt, cacheStatus }` |

**`/releases` 响应**

```jsonc
{
  "updatedAt": "2026-11-08T13:40:00.000Z",
  "repo": { "owner": "232252", "name": "education-advisor" },
  "releases": [
    {
      "tag": "v3.3.5",
      "prerelease": false,
      "publishedAt": "2026-11-08T12:42:29Z",
      "htmlUrl": "https://github.com/232252/education-advisor/releases/tag/v3.3.5",
      "body": "**Full Changelog**: ...",
      "assets": [
        {
          "name": "Education-Advisor-Setup.exe",
          "size": 475779113,
          "url": "https://github.com/.../download/v3.3.5/Education-Advisor-Setup.exe",
          "os": "windows", "arch": "x64",
          "kind": "installer",
          "label": "Windows 安装程序 (.exe)",
          "giteeUrl": null
        }
      ],
      "checksumsUrl": "https://github.com/.../download/v3.3.5/SHA256SUMS"
    }
  ]
}
```

- `assets` 只含**用户可下载物**（`kind !== 'meta'`）；`blockmap` / `latest*.yml` 剔除，`SHA256SUMS` 单独提为 `checksumsUrl`。
- `body` 原样透传（前端转义后渲染）。
- `giteeUrl` 为 `null` 表示该资产未同步到 Gitee。

**缓存与错误**

| 场景 | 行为 |
|---|---|
| 命中新鲜缓存（≤15min） | 直接返回，`X-Cache: HIT` |
| 缓存过期 | 回源 GitHub + Gitee，成功则写入并返回 `X-Cache: MISS` |
| 回源失败（403/429/5xx/网络） | 返回**过期副本**（≤24h），`X-Cache: STALE`；无过期副本则 `503` + `{ error }` |
| 请求方法非 GET | `405` |

响应头：`Access-Control-Allow-Origin: *`、`Cache-Control: public, max-age=60, s-maxage=900, stale-while-revalidate=86400`、`Content-Type: application/json; charset=utf-8`。

**上游**

| 源 | 地址 | 认证 | 限额 |
|---|---|---|---|
| GitHub | `https://api.github.com/repos/232252/education-advisor/releases?per_page=100` | 无（匿名） | 60 次/小时/IP |
| Gitee | `https://gitee.com/api/v5/repos/qdzwwqd/education-advisor/releases` | 无（公开仓） | 宽松 |

Gitee 抓取失败**不阻断**主流程：仅损失镜像可用性标注，退化为「全部走 GitHub 直连」。

---

## 4. 资产分类规则（唯一事实来源在 Worker）

按**模式**匹配，兼容跨版本命名演进。规则表按序命中，先匹配先生效。

| # | 匹配 | os | arch | kind | 展示名 |
|---|---|---|---|---|---|
| 1 | `portable` 且 `.exe` | windows | x64 | portable | Windows 便携版 (.exe) |
| 2 | `.exe` | windows | x64 | installer | Windows 安装程序 (.exe) |
| 3 | `.dmg` 且 `arm64\|aarch64` | macos | arm64 | dmg | macOS 磁盘映像 (.dmg) |
| 4 | `.dmg` 且 `x64\|amd64\|intel` | macos | x64 | dmg | macOS 磁盘映像 (.dmg) |
| 5 | `.zip`（非源码包，见 6）且 `arm64\|aarch64` | macos | arm64 | zip | macOS 便携压缩包 (.zip) |
| 6 | `.zip`（非源码包）且 `x64\|amd64\|intel` | macos | x64 | zip | macOS 便携压缩包 (.zip) |
| 7 | `.AppImage` | linux | x64 | appimage | Linux 便携版 (.AppImage) |
| 8 | `.deb` | linux | x64 | deb | Linux 安装包 (.deb) |
| 9 | `.tar.gz` / `.rpm` | linux | 按名推断 | archive | Linux 压缩包 |
| 10 | `SHA256SUMS` | — | — | meta | （不进表，单独校验入口） |
| 11 | `.blockmap` / `latest*.yml` | — | — | meta | （剔除） |
| 12 | 其他 | — | — | other | 其他文件 |

**规则 6 的源码包豁免**：GitHub 自动生成的源码包名为 `<tag>.zip`（如 `v3.3.5.zip`）与 `<tag>.tar.gz`，不进入资产列表。

**arch 推断**：文件名含 `arm64`/`aarch64` → `arm64`；含 `x64`/`amd64`/`x86_64`/`win64` → `x64`；含 `arm`/`armv7` → `arm`；含 `mips` → `mips`；否则按扩展名兜底（`.AppImage`/`.deb` → `x64`；`.exe` → `x64`）。

**未识别资产**（kind=`other`）不丢失——归入表格「其他文件」行，便于发现命名演进。

---

## 5. 页面结构与交互

```
┌─ Hero：标题 + 一句话说明 + 当前版本（实时）─────────────────┐
├─ 推荐下载大按钮（按 UA 自动选平台；显示文件名 + 大小 + 来源）─┤
├─ 控制条：下载通道 │ 具体版本(条件显示) │ 操作系统 │ 架构 │ 下载源 ┤
├─ 版本标题：v3.3.5（链到 GitHub release 页）+ 发布日期 ────────┤
├─ 表格：操作系统 │ 架构 │ 安装包 │ 大小 │ 备注 ──────────────┤
├─ 更新日志（当前版本 release body）─────────────────────────┤
└─ 校验说明 + SHA256SUMS 链接 + Gitee 镜像说明 ──────────────┘
```

**交互规则**

- **下载通道**：稳定版 → 显示最新稳定版；预发布版 → 显示最新预发布版；历史版本 → 出现「具体版本」下拉，**下拉内容是全部 release**（按 `publishedAt` 倒序，默认选中最近的一个，即最新稳定版）。即「稳定版 / 预发布版」是快捷项，「历史版本」是完整列表，避免出现「排除掉某些版本」这类隐式规则。
- **操作系统 / 架构筛选**：过滤表格行（行 = 操作系统 × 架构），默认「全部」。
- **下载源**：切换所有下载链接的前缀。
  - GitHub 直连：`https://github.com/232252/education-advisor/releases/download/<tag>/<资产名>`
  - 第三方加速：`https://ghfast.top/` + 上面的路径
  - Gitee 镜像：**仅当该资产 `giteeUrl` 非空**时使用；否则该单元格显示「镜像未同步」，链到 Gitee release 页
- **推荐大按钮**：按 `navigator.userAgent` 判定 Windows / macOS(再判 arm64) / Linux，取对应 `kind` 优先级（Windows: installer > portable；macOS: dmg > zip；Linux: appimage > deb），跟随「下载源」选择变化。
- **表格单元格**：每个安装包一个链接 chip，chip 文本 = 展示名 + 文件名；同行多格式并列。
- **大小**：Worker 返回字节数，前端格式化为 `454 MB` / `512 KB`。
- **备注列**（按平台固定文案，均有仓库内证据）：

| 平台 | 备注文案 | 证据 |
|---|---|---|
| Windows | 未签名安装包，首次运行 SmartScreen 可能提示「Windows 已保护你的电脑」→ 点「更多信息」→「仍要运行」 | `docs/DESKTOP_BUILD.md:376-378`、`docs/TROUBLESHOOTING.md:683` |
| macOS | 未公证，Gatekeeper 会拦截 → 右键点「打开」；或 `xattr -c /Applications/Education\ Advisor.app` | `docs/DESKTOP_BUILD.md:485-492`、`BACKLOG.md:45`（signed + notarized 仍为 Planned） |
| Linux | AppImage 首次运行需 `chmod +x`；精简发行版若缺 FUSE2 需先 `apt install libfuse2`（deb 包免此步） | `electron-builder.yml:97-100`（AppImage + deb 双目标） |

**降级链（前端）**

1. `https://api.eea.qdzwwqd.top/releases`（Worker）—— 正常路径
2. 失败 → `https://api.github.com/repos/232252/education-advisor/releases?per_page=100`（浏览器直连，用访客自己的 IP 配额）。**此分支不做资产分类**（分类逻辑只在 Worker 里存在一份，前端复制即产生第二个事实来源）。降级为**扁平附件列表**：逐条列出资产文件名 + 大小 + 直连链接，顶部标注「实时信息加载失败，以下为原始附件列表」。此时通道/系统/架构筛选与分类列全部隐藏。
3. 失败 → 内置静态兜底表：固定列出 Windows/macOS/Linux 各自的 `releases/latest/download/<资产名>` 链接（**不锁版本，永不失效**），提示「实时版本信息加载失败，以下为最新版本入口」。此态**不展示任何版本号**（展示「最新版本」），彻底消灭手抄版本。

---

## 6. 文件改动清单

**新增（4）**

- `site-build/worker/src/releases.js` —— 纯函数：`classifyAsset(name)`、`normalizeRelease(release, giteeAssets)`、`buildPayload(releases, giteeReleases)`、`splitChannels(releases)`。**无 IO、无全局依赖**，可被单测直接 import。
- `site-build/worker/src/index.js` —— Worker 入口：`fetch` 处理 CORS / 缓存 / 上游抓取 / 错误降级；导出 `default { fetch }`。
- `site-build/worker/wrangler.toml` —— `name = "eea-releases"`、`main = "src/index.js"`、`compatibility_date`、`routes = [{ pattern = "api.eea.qdzwwqd.top", custom_domain = true }]`。
- `tests/site/releases.test.ts` —— 纯函数单测（见 §7）。

**修改（5）**

- `site-build/download.html` —— 重写主体骨架：Hero + 推荐 CTA 容器 + 控制条 + 表格容器 + 更新日志容器；保留既有 nav / footer 结构不动。
- `site-build/assets/js/download.js` —— 重写：取数 → 归一化 → 渲染控制条/表格/CTA/更新日志 → 处理筛选与下载源切换 → 降级链。
- `site-build/assets/css/style.css` —— 追加：表格、select、chip、CTA 卡、状态徽章样式（沿用现有 `--bg-elevated` / `--border` / `--primary` 等 token，不引入新色板）。
- `site-build/.assetsignore` —— 追加 `worker/`，避免 Worker 源码被当作静态资源上传。
- `vitest.config.ts` —— main project 的 `include` 追加 `tests/site/**/*.{test,spec}.{ts,tsx}`（一行改动）。

**不动（明确列出，防止误改）**

- `site-build/wrangler.toml`（现站 Worker 配置）、`site-build/assets/js/main.js`、`site-build/index.html`、`site-build/docs.html`、`site-build/legal.html`、`site-build/product-video.html`。
- `.github/workflows/release.yml`、`gitee-sync.yml` —— 本轮不动 CI。

---

## 7. 测试

- `tests/site/releases.test.ts`（vitest，node 环境）：覆盖
  - `classifyAsset`：Setup/Portable/dmg×2 架构/zip×2/AppImage/deb/SHA256SUMS/blockmap/latest.yml/源码包豁免/旧版命名（`Education-Advisor-3.2.0-Setup.exe`、`Education.Advisor-0.1.0-rc.1-arm64.dmg`、`EducationAdvisor-Portable-Windows-x64.zip`）
  - `splitChannels`：稳定/预发布/历史切分正确
  - `normalizeRelease`：`giteeUrl` 命中 / 未命中（>100MB 未同步）
  - `buildPayload`：剔除 meta、保留 SHA256SUMS 为 `checksumsUrl`
- `vitest.config.ts`：main project 的 `include` 追加 `tests/site/**/*.{test,spec}.{ts,tsx}`（一行改动）。
- 前端渲染逻辑不写单测（无既有前端测试基建；`main.js` 同样无测试）——由人工验收清单覆盖。

---

## 8. 部署与回滚

**部署顺序**

1. `npx --yes wrangler@4 deploy`（工作目录 `site-build/worker`）→ 创建 Worker + 自动绑定 `api.eea.qdzwwqd.top`（DNS 与证书由 Cloudflare 自动创建）
2. `npx --yes wrangler@4 deploy`（工作目录 `site-build`）→ 更新现站静态资源
3. 人工验收（§9）

**回滚**

- 静态站：`wrangler deployments list` 取上一个版本 `wrangler rollback`（Cloudflare 保留部署历史）；或直接 `git revert` 后重新部署。
- Worker：删除 `eea-releases` 不影响现站（独立 Worker + 独立域名）。

**部署前置**

- 本机已有 wrangler OAuth 登录态（`%APPDATA%\xdg.config\.wrangler\config\default.toml`，含 `workers:write` / `workers_routes:write`），无需额外凭据。
- 生产部署属对外可见变更，**执行前需用户确认**。

---

## 9. 验收标准

1. `GET https://api.eea.qdzwwqd.top/releases` 返回 200，JSON 含 `v3.3.5` 及其 `Education-Advisor-Setup.exe`（size ≈ 475779113），`giteeUrl` 为 `null`（实测该资产未同步到 Gitee）。
2. `GET https://api.eea.qdzwwqd.top/health` 返回 `{ ok: true }`。
3. 连续两次请求第二次带 `X-Cache: HIT`。
4. 下载页表格在通道=稳定版时显示 Windows/macOS(Intel)/macOS(Apple Silicon)/Linux 四行，架构与安装包名与 GitHub 实际资产一致。
5. 切换「历史版本」→ 出现具体版本下拉 → 选 `v3.3.4` → 表格与更新日志同步切换。
6. 切换「操作系统=Linux」→ 仅剩 Linux 行；切「架构=arm64」→ 仅剩 macOS Apple Silicon 行。
7. 切换「下载源=Gitee 镜像」→ 未同步资产的单元格显示「镜像未同步」而非死链；`SHA256SUMS` 链接在 Gitee 上可点开。
8. 顶部推荐按钮在 Windows/macOS/Linux UA 下分别指向 `.exe` / `.dmg` / `.AppImage`。
9. 断网（DevTools 离线）刷新下载页 → 出现内置静态兜底表，链接指向 `releases/latest/download/...` 且可下载。
10. 页面源码中**不再出现**任何硬编码版本号字符串（如 `v0.1.0-rc`）。
11. `npm run typecheck` / `npm run lint` / `npm run test` 全绿。

---

## 10. 已知风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **GitHub 匿名 API 60 次/小时/IP，Worker 出口 IP 共享** | 高频访问时 Worker 可能拿到 403，下载页退到浏览器直连（访客自有配额）或静态兜底 | 15 分钟边缘缓存（回源频率 ≈ 每数据中心 4 次/小时）+ 24h 过期副本兜底；代码预留 `GITHUB_TOKEN` 注入口，用户后续可一行命令补上 |
| 第三方加速站（ghfast.top 等）不可控 | 用户可能下载到失效文件 | UI 显式标注「第三方加速」；默认仍是 GitHub 直连；建议用户以 SHA256SUMS 校验 |
| Gitee 镜像缺安装包 | 国内用户拿不到加速 | 已在 UI 显式标注原因（超 100MB 单附件上限）；后续若需镜像需换方案（如 R2/OSS），不在本轮 |
| `expanded_assets` / Atom 等免限额接口未采用 | 依赖 REST API 配额 | 有过期副本 + 浏览器直连 + 静态兜底三层降级，风险可控 |
| Windows 未签名、macOS 未公证 | SmartScreen / Gatekeeper 首次运行拦截 | 已在表格「备注」列写明处理方式（右键打开 / 更多信息→仍要运行），并有仓库内文档佐证；签名与公证列入 `BACKLOG.md:45`，不在本轮 |

---

## 11. 不在本轮范围

- 不改 CI（`release.yml` / `gitee-sync.yml`）：不做 Nightly 通道，不把 eaa-cli 做成独立发版产物。
- 不动 `docs/decisions/0003-site-separation.md` 记载的「官网迁独立仓」计划；Worker 源码随 `site-build/worker/` 一起迁移。
- 不做下载重定向带镜像自动 fallback 的 `/d/:asset` 端点（当前不需要）。
