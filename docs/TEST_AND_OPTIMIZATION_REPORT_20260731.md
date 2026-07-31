# 测试与优化报告 — 2026-07-31 会话

> 范围: 全新编译 → CDP 调试接口逐功能验证 → 底层适配 → UI 美化 → 全量回归
> 最终测试环境: **Electron 43.2.0 + better-sqlite3 13.0.2(与用户 Windows 完全一致的依赖栈)**, Linux X11(Xvfb), CDP 9222

---

## 一、本次发现并修复的问题

### 1. 🔴 底层适配(用户重点关注的"底层软件适配度")

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| B1 | **Electron 43 首次安装后无法启动(挂起/段错误)** | 初装时 npm 12 的 install-scripts 拦截 + 手动 install.js 下载被中断 → **dist 残缺损坏**; 用残缺 dist 测试得出"v43 不兼容"的错误结论。**真实 v43 在本机 X11 完全正常**(含 BrowserWindow + .ico 图标) | 重新完整下载后一切正常; 测试环境已跑在真实 v43 上 |
| B2 | **`BrowserWindow({icon: 'xxx.ico'})` 崩溃假象** | 同上(残缺 dist 所致); 真实 v43 传 .ico 路径正常 | 仍保留平台守卫修复(非 Windows 用 PNG 加载)——更稳健, 且为 Windows 保留多帧 ICO 优化, 无副作用 |
| B3 | **托盘创建无防御** | headless/无托盘环境 `new Tray()` 抛异常会拖垮启动 | `src/main/index.ts`: `initTray` 包 try/catch, 降级为无托盘模式 |
| B4 | **better-sqlite3 13.0.2 + Electron 33(Node 20/NAPI 9)崩溃; + Electron 43 正常** | 13.x 需要 NAPI 10(Node ≥22); 与本机 7/27-29 用的 12.11.1+E33 组合无关 | 无代码修复; **测试环境最终用 E43 + 13.0.2(用户原始栈), 验证完全正常**。若未来在 Linux 跑老 Electron 需注意此约束 |
| B5 | **项目 node_modules 是 Windows 平台包, Linux 无法 typecheck/lint/跑测试** | node_modules 从 Windows 机器同步; TS7/Biome 平台二进制、electron.exe 都是 win32 | 建立隔离测试环境(`/home/admina/ea-linux/`); 在项目内做 Linux 开发需重新 `npm install`(注意 verysync 同步) |
| B6 | **`--ozone-platform=headless` 在 Electron 43 上创建窗口必段错误(本机)** | Chromium ozone-headless 与本机环境的兼容问题 | 不用 headless 模式, 直接 X11 即可(测试脚本已适配) |

### 2. 🟠 功能缺陷(用户"感觉有点问题"的部分)

| # | 问题 | 修复 |
|---|---|---|
| F1 | **飞书网络诊断 DNS 步骤假阳性**: `resolveHostname` 用 fetch HEAD + `.catch(()=>null)` 吞掉所有错误, DNS 失败也永远显示 "resolved" | `feishu-service.ts`: 改用 `node:dns/promises.lookup`, 返回真实 IP; 现在诊断显示 "open.feishu.cn → 112.19.1.70" |
| F2 | **`providerTimeoutMs` 只进日志不生效**: provider 挂起时聊天无限等待 | `pi-ai-service.ts`: createStream 增加"首字节超时"包装 — 超时内无任何事件 → abort 并抛含 timeout 的错误 → 自动进入 isRetryableError 重试; 收到首事件后立即取消计时(长生成不受影响) |
| F3 | **成绩分数越界校验形同虚设**: `record.fullMark > 0` 在渲染层不传 fullMark 时为 false, score=9999 被静默接受 | `academic-service.ts`: setGrade/batchSetGrades 的分数范围改为从科目配置自动推导 fullMark(调用方传入优先) |
| F4 | **Vitest 4 projects 模式不继承顶层 resolve.alias**: `@shared/*` 值导入在测试中全部解析失败(chatStore 新增 `@shared/llm-error` 导入后 `chatStore.test.ts` 挂掉; 之前靠 type-only import 被擦除而侥幸通过) | `vitest.config.ts`: 别名下沉到每个 project 内声明。**修复后全量 1883/1883 通过(修复前 100 文件 1 失败)** |
| F5 | **错误信息可能显示 "[object Object]"** | ModelsPage 测试连接 / FeishuSection 测试连接: 错误信息防御性转字符串 |

### 3. 🟢 验证无问题的部分(排查确认非 bug)

- 飞书假凭证 → error 状态 + 明确错误码(code=10014) — 链路正确
- Agent 无 API Key 运行 → 优雅报错 "No model available with a configured API key" — 链路正确
- Cron 持久化(R87-BUG-1): 用户任务正确写入 `cron.user.json`, 重启恢复 — 已修复且验证
- 隐私引擎: init/unlock/lock/list/anonymize/backup 全链路正确, 锁定态拒绝泄漏
- eaa.summary 报错 — 测试脚本参数形状错误(应用契约正确)
- i18n 语言切换 — 通过设置页 UI 正常生效(setLang 在 GeneralSection 调用); IPC 直调不触发属设计行为
- log:search 报错 — 测试脚本参数形状错误(位置参数 filePath/query)
- 聊天持久化 — 需 DB 初始化成功(E43 + sqlite13 下已验证 save/load/delete 全通)

---

## 二、测试覆盖清单(全部通过)

### 功能层
- 11 个页面全部加载: 0 console error / 0 exception
- IPC 契约 22+ 项: eaa.info/stats/listStudents/codes/doctor/summary/dashboard/export(csv 55KB, jsonl 113KB)/import 校验、agent.list/runManual、cron.list/add/remove(非法表达式拒绝)、settings get/set(theme 持久化到磁盘)、class CRUD、academic exam/grade 全链路、skill/mcp/privacy/log/sys/ollama/feishu 全部
- UI 交互: 添加学生(表单→提交→列表→搜索)、Scheduler 新增任务(4 必填字段闭环)、Agent 开关切换、聊天发送(无 key 优雅报错)、设置开关切换、隐私初始化、学生详情 4 tabs、Dashboard 班级对比、Welcome 视频页
- 导出: CSV(中文表头正确)/JSONL 全量导出; 非法格式拒绝
- 写入: 并发 10 学生创建 + 50 条事件并发写入 — 全部成功, 每学生 5 条无丢失(EAA 写队列串行化验证)
- 持久化: 重启后学生/事件/设置/班级全部保留; cron.user.json 正确落盘

### 质量层
- 内存稳定性: 3 轮全路由切换 JS 堆 12→13MB, DOM 节点恒定 584 — 无泄漏
- 全量测试: **100/100 文件, 1883/1883 用例通过**(含 13 个用户流模拟场景)
- 类型检查 tsc --noEmit 通过; biome lint 通过
- 图标管线: build-icon.mjs 在 Linux 正常生成 7 尺寸 PNG + 多帧 ICO(4x 超采样 + lanczos3)

---

## 三、UI 美化(本轮完成)

1. **字体**: 全局 `--font-sans` 中英文混排栈(Inter + PingFang SC + HarmonyOS Sans SC + 微软雅黑 + Noto Sans CJK)
2. **侧边栏**: Logo 三色渐变 + 顶部微光 + hover 缩放; 导航激活态渐变背景(蓝→靛)+ 渐变指示条
3. **统计卡片**: 数值改为卡片主题色渐变文字(bg-clip-text)
4. **聊天输入框**: focus-within 蓝色 ring 光晕
5. **空状态**: 图标容器改为品牌蓝渐变底(全站受益)
6. **Agent 空状态**: 补充引导描述文案
7. **设置页 HintIcon**: 原生 ⓘ 字符 → Lucide Info 图标 + hover 变色

---

## 六、收尾工作（用户确认后执行）

### 1. 测试数据污染清理 ✅
- 真实数据 225 名学生中 **206 名确定为测试残留**（r\d+ 前缀 95、stress 101、batch 7、注入测试名等，去重后 206）
- 全部通过 EAA `delete-student --confirm` **软删**（可恢复，事件保留）
- 剩余 18 名中文姓名+随机后缀（疑似早期测试生成，无法确认）——保守保留，可再清
- 清理后: 学生列表 18 名、排行榜全部为真实姓名、dashboard 正常生成、doctor 10/11 通过（唯一 issue 是历史压测的"单分钟 896 事件"标记，非损坏）

### 2. 真实项目重新 npm install（Linux 平台化）✅
- 用 docker 以 root 修复权限: 项目根、`.eaa-data`、node_modules 全部归 admina（此前 root 拥有导致 Linux 上 EAA CLI 无法写数据目录、npm/tsc 无法运行——这是"底层适配"的关键一环）
- `npm install`（npmmirror registry + ELECTRON_MIRROR）→ Electron 43.2.0 Linux dist + 全部平台包
- better-sqlite3 13.0.2 以 `force_build` 针对 Electron 43 ABI 重建
- 验证: `tsc --noEmit` ✓ / `biome check` ✓ / `npm run build` ✓ / 应用启动全链路 ✓（DB ready、EAA Doctor passed、18 agents、CDP）

## 七、待用户决策（更新后）

1. **剩余 18 名疑似测试学生**（中文姓名+随机后缀, 如 "冯勇10d"）: 若确认是测试数据可再跑清理
2. **历史事件压测痕迹**: doctor 提示"单分钟 896 条事件"(早期 R21 并发压测), 事件数据本身完好, 无需处理
3. **Linux 开发环境**: 真实项目现在可直接在 Linux 上 typecheck/lint/build/运行; verysync 同步 node_modules 的注意事项不变

## 八、本轮改动的文件清单

```
src/main/index.ts                       — 窗口图标平台守卫(非 Windows 用 PNG) + tray 防御
src/main/services/feishu-service.ts     — DNS 诊断真实解析(node:dns)
src/main/services/pi-ai-service.ts      — 首字节超时(providerTimeoutMs 真正生效)
src/main/services/academic-service.ts   — 成绩越界校验(两处, 从科目配置推导 fullMark)
vitest.config.ts                        — projects 别名下沉(测试修复, 全量 1883 通过)
src/renderer/styles/globals.css         — 中英文混排字体栈 + text-gradient 工具类
src/renderer/layouts/MainLayout.tsx     — Logo 三色渐变微光 / 导航激活渐变
src/renderer/pages/Dashboard/components/DashboardStatCard.tsx — 数值渐变文字
src/renderer/pages/Chat/ChatPage.tsx    — 输入框 focus ring
src/renderer/components/EmptyState.tsx  — 空状态图标品牌蓝底
src/renderer/pages/Agents/AgentsPage.tsx — 空状态引导描述
src/renderer/pages/Settings/components/HintIcon.tsx — Lucide Info 图标
src/renderer/pages/Models/ModelsPage.tsx — 错误信息防御转字符串
src/renderer/pages/Settings/sections/FeishuSection.tsx — 错误信息防御转字符串
```
