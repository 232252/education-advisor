# 优化报告 — 2026-07-31 第 2 轮（自主测试与优化）

> 范围: 用户午休期间自主进行的全面测试与优化
> 基线: 第 1 轮报告 (TEST_AND_OPTIMIZATION_REPORT_20260731.md) 之后的新增功能
> 测试方式: 4 个探索代理并行深度调研 + CDP 实时调试 + 真实 EAA 二进制数据链路验证 + 全量回归

---

## 一、本轮修复与优化（已完成）

### 1. 🔴 阻断性 Bug — package.json 合并冲突（已修复）

| 问题 | 根因 | 修复 |
|---|---|---|
| **electron 无法启动**: `Unable to parse package.json: Expected double-quoted property name at position 3322` | package.json 第 91-99 行有**未解决的 git 合并冲突标记**（HEAD vs origin/dependabot 分支） | 解决冲突，保留 HEAD 的更新版本（`@types/node ^26.1.2`、`@types/react ^19.2.18`、`@types/react-dom ^19.2.4`） |

package-lock.json 也有同类冲突标记，已随修复清除。

### 2. 🎨 图标清晰度提升（用户重点关注 — 已完成）

**根因诊断**（客观像素测量）:
| 元素 | 16px 实际宽度 | 可见性 |
|---|---|---|
| 网络线 stroke-width=34 | 0.53px | ⚠ 临界 |
| 书脊 stroke-width=14 | 0.22px | ✗ 不可见 |
| 页线 stroke-width=26 | 0.41px | ✗ 不可见 |

**解决方案 — 双 SVG 策略**:
- 新建 `resources/icon-small.svg`：小尺寸专用版，笔画加粗到 stroke-width=90（16px 下 ≈ 1.4px），节点加大到 r=92，简化细节
- 改造 `scripts/build-icon.mjs`：≤48px 用 small-svg（清晰），>48px 用原精致 svg（细节丰富）
- `src/main/index.ts`：Linux/macOS 图标候选优先级加入 `icon-1024.png`（HiDPI/Retina 200% DPR 支持）

**客观验证**: 16px 内容像素从 19.5% → 23.0%（+18%），32px 从 21.8% → 25.4%（+16%）。

### 3. 🎨 应用内 Logo 与系统图标统一（已完成）

**问题**: MainLayout 和 WelcomePage 用 CSS 渐变方块 + "E" 字作为 Logo，与系统图标（任务栏/托盘的网络+书 SVG）完全不同——品牌割裂。

**修复**: 新建 `src/renderer/components/AppLogo.tsx`，内联真实 SVG（与 resources/icon.svg 完全一致），支持任意缩放、矢量锐利、多实例渐变 id 隔离。MainLayout + WelcomePage 均已替换。

**CDP 验证**: `sidebarOldE: false`（旧方块已消失）、`sidebarSvgLogo: 1`（新 SVG 已渲染）。

### 4. 🎨 favicon + 触摸图标（已完成）

渲染层此前**完全没有 favicon**（public 目录只有 mp4），浏览器标签页显示默认图标。

**修复**: 生成 `favicon.ico`（16/24/32 三帧，用 small-svg 最清晰）、`favicon.svg`（矢量）、`apple-touch-icon.png`（180×180）、`icon-192/512.png`（PWA），并在 `index.html` 添加引用 + `theme-color`。

### 5. 🎨 UI 细节美化（已完成）

- **EmptyState**: 图标容器加品牌蓝渐变底 + 外层柔光晕，全站空状态视觉层次提升
  - **code-reviewer 发现并修复的 bug**: 初版用 `-z-10` 让柔光晕在图标后，但因图标容器未创建层叠上下文，`-z-10` 穿透到祖先（Card/页面的不透明背景），柔光晕被完全遮挡（死效果）。已重构为：柔光晕作为图标容器的同级前置元素，父级 `.mb-4` 加 `relative` 创建层叠上下文，图标容器用 `z-10` 确保在上层。现在柔光晕真正可见。
- **DashboardStatCard**: 数值加 `tabular-nums`，等宽数字避免位数变化时的跳动
- **AppLogo 测试**: 新增 10 个测试用例（渲染/尺寸/状态点/可访问性/渐变 id 隔离），验证品牌组件正确性

### 6. 📡 飞书 tableId 输入框（已完成）

**真实缺陷**: `feishu.bitableTableId` 类型字段存在、cron-service 读取它，但 FeishuSection UI **没有输入框**——用户永远只能用硬编码的 `log` 表。

**修复**: 在 Bitable 高级配置区添加 "Bitable 表 ID" 输入框，`onChange` 即时持久化到 settings。

> 飞书子系统整体质量很高（长连接无需公网IP、4步网络诊断、凭证DPAPI加密、token缓存隔离、消息串行化限流去重）。"不能远程访问"最可能是用户侧的 WSS 被防火墙拦截或飞书后台未配长连接——诊断逻辑已完善覆盖。

---

## 二、多角度测试结果（全部通过）

### AI Agent 数据调用链
- **只读链路**: score/ranking/stats/codes/search/listStudents/summary/range 全部 ✓（9/9 通过）
- **写入链路**: addStudent→addEvent(固定码)→score验证→deleteStudent ✓
  - `CLASS_COMMITTEE` 自动 +5 → 105 ✓；`LATE` 自动 -2 → 103 ✓
  - 参数校验健壮：错误形状参数被明确拒绝（非静默失败）
  - IPC 层 `lookupReasonCodeDelta` 自动补全固定码标准 delta，agent 无需记忆分值

### 内存稳定性
- **预热后 10 轮 settings↔students 切换**: heap 20.7MB → 19.8MB（**-0.81MB，无泄漏**）
- DOM 节点随页面正常波动（轻页 704 / 学生列表更多）
- 最初观察到的"+5MB 增长"是首次加载懒加载 chunk（echarts/markdown）的良性缓存

### 存储/持久化
- **原子写**: EAA Rust 端 tmp→fsync→rename，TS 层写队列串行化 ✓
- **软删除**: 通过 `status` 字段（DELETED/ACTIVE）标记，deleteStudent 正确生效 ✓
- **重启恢复**: 标记学生写入后，磁盘 entities.json 立即可见（直接读文件验证）✓
- 数据一致性: 1632 实体（1612 DELETED 历史 + 20 ACTIVE），listStudents 按 status 过滤返回活跃学生 ✓

### IPC 契约（22 项）
全部正常返回，0 console error，0 exception（11 路由遍历）。

### 全量回归测试
**101 文件 / 1893 用例全部通过**（图标+Logo+UI+飞书改动 + 新增 AppLogo 10 测试）。EmptyState bug 修复后再次回归通过。

### 安全角度审查
- **沙箱配置**: `contextIsolation: true` + `nodeIntegration: false` ✓（renderer 无 Node 访问）
- **preload 单点暴露**: contextBridge 统一暴露 `window.api`，renderer 看不到 IPC 通道名 ✓
- **shell 注入防护**: `sanitizeArg` 拒绝控制字符 + shell 元字符（`&|;\`$(){}\\<>*?[]#~!`）+ `--` 前缀注入 ✓（42 个边界测试通过）
- **CSP 缺失**: 无 Content-Security-Policy（Electron 桌面应用风险较低，renderer 已隔离，打包后警告消失）

### 国际化完整性
- zh.json / en.json 各 **614 个 key，0 缺失**，完全对齐 ✓
- 飞书 section 高级配置区为既有硬编码中文（与"Bitable 列表"等一致），新加 tableId 文案与既有风格一致

---

## 三、发现但未修改的问题（需记录）

### 1. 变量码 delta 约束（EAA Rust 端行为，非 TS bug）
`BONUS_VARIABLE`（delta=null 变量码）传非零 delta 时被 EAA 拒绝（`标准分值: Some(0.0)，当前: 5.0`）。
- **影响**: agent 想用 BONUS_VARIABLE 加自定义分值时会失败，需改用固定码或 EAA Rust 源码修 delta=null 的校验逻辑
- **当前缓解**: IPC 层 `lookupReasonCodeDelta` 自动补全固定码标准值，agent 用固定码完全正常
- **修复方向**: 改 `core/eaa-cli` Rust 源码，让 delta=null 的码接受任意 delta（需重编译，超出本轮范围）

### 2. 退出阶段 GPU 进程崩溃（SIGTRAP）— 环境问题
`--disable-gpu` 模式下退出时 `GPU process launch failed: error_code=1002` → SIGTRAP。
- **性质**: Linux 无 GPU 环境（Xvfb/headless）的已知行为，**只影响退出码，不影响运行**
- **不应在代码加平台 GPU 开关**: 会污染 Windows 打包版（有真实 GPU 的机器）
- run-linux.sh 作为开发脚本已正确处理

### 3. 测试环境 X11 重启卡死 — 环境问题
反复 `pkill -9` 杀 electron 后，X11/Chromium 状态被破坏，新 electron 进程在 GPU 握手阶段忙等循环（strace 确认 fd 45 反复 sendmsg/recvmsg）。
- **性质**: 纯环境问题，与代码无关（所有代码改动通过 typecheck+lint+build+1883 测试，且最初验证过 Logo 渲染）
- **规避**: 避免在开发时 `pkill -9` 强杀 electron，用正常退出（Ctrl+C 或托盘退出）

### 4. eaa.summary "since must be a string" — 非产品 bug
测试脚本 `ipc-contract-test.mjs` 误传 `api.eaa.summary({})`（对象），实际 API 签名是 `summary(since?: string, until?: string)` 位置参数。handler 的 R14 类型校验是**正确的健壮防御**，渲染层 `useDashboardData.ts` 正确调用 `summary()` 无参。

---

## 四、本轮改动的文件清单

```
package.json                              — 解决 git 合并冲突标记
resources/icon-small.svg                  — 新增: 小尺寸专用 SVG(笔画加粗)
scripts/build-icon.mjs                    — 双 SVG 策略(≤48px 用 small-svg)
resources/icon-{16,24,32,48}.png + icon.ico — 重新生成(小尺寸更清晰)
src/main/index.ts                         — Linux/macOS 图标候选加 icon-1024(HiDPI)
src/renderer/components/AppLogo.tsx       — 新增: 统一品牌 Logo 组件(内联 SVG)
src/renderer/components/__tests__/AppLogo.test.tsx — 新增: AppLogo 测试(10 用例)
src/renderer/layouts/MainLayout.tsx       — CSS 方块"E" → AppLogo 组件
src/renderer/pages/Welcome/WelcomePage.tsx — CSS 方块"E" → AppLogo 组件
src/renderer/index.html                   — favicon/svg/ico/apple-touch/theme-color 引用
src/renderer/public/favicon.{ico,svg}     — 新增: favicon 资源
src/renderer/public/apple-touch-icon.png  — 新增: iOS 主屏图标
src/renderer/public/icon-{192,512}.png    — 新增: PWA 图标
src/renderer/components/EmptyState.tsx    — 图标容器品牌柔光晕(修复 -z-10 死效果 bug)
src/renderer/pages/Dashboard/components/DashboardStatCard.tsx — tabular-nums
src/renderer/pages/Settings/sections/FeishuSection.tsx — Bitable 表 ID 输入框
docs/OPTIMIZATION_REPORT_20260731_ROUND2.md — 本报告
```

## 五、质量门禁

| 检查 | 结果 |
|---|---|
| TypeScript `tsc --noEmit` | ✓ 通过 |
| Biome lint | ✓ 通过（0 error） |
| 全量 build（main+renderer） | ✓ 通过 |
| 全量测试 | ✓ 101 文件 / 1893 用例通过 |
| CDP 实时 IPC 验证 | ✓ 22 项通过，0 console error |
| Agent 数据链路 | ✓ 读取 9/9 + 写入链路完整 |
| 内存稳定性 | ✓ 预热后无泄漏 |
| 存储持久化 | ✓ 原子写+软删除+磁盘验证 |
| 安全审查 | ✓ contextIsolation+sanitizeArg 42 边界测试 |
| i18n 完整性 | ✓ zh/en 各 614 key，0 缺失 |
| code-reviewer 审查 | ✓ 1 个 bug 已修复(EmptyState -z-10) |

## 六、数据清理
- 测试残留（测试链路/固定码测试/持久化验证）已通过 EAA `delete-student --confirm` 软删
- 当前 ACTIVE 学生: **18 名真实学生，0 测试残留**
