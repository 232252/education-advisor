# 🚨 AI Workstation 真问题诊断报告

> 扫描日期: 2025-07-19
> 扫描范围: 全项目 97 个 IPC 通道 × 11 个 Handler × 13 个 Service × 9 个页面

---

## 🔴 P0 — 系统崩溃级

### 1. log-handlers.ts 全部为空壳，日志查看功能完全不可用

**文件**: `src/main/ipc/log-handlers.ts` 第 15-41 行

```typescript
// 全部 7 个处理器都是 stub!
const STUB_ERROR = 'rebuild pending — fix-arch-logic follow-up'

ipcMain.handle(IPC.IPC_LOG_LIST, async () => { throw new Error(STUB_ERROR) })
ipcMain.handle(IPC.IPC_LOG_READ, async () => { throw new Error(STUB_ERROR) })
ipcMain.handle(IPC.IPC_LOG_CLEAR, async () => { throw new Error(STUB_ERROR) })
ipcMain.handle(IPC.IPC_LOG_FILTER, async () => { throw new Error(STUB_ERROR) })
ipcMain.handle(IPC.IPC_LOG_SEARCH, async () => { throw new Error(STUB_ERROR) })
ipcMain.handle(IPC.IPC_LOG_EXPORT, async () => { throw new Error(STUB_ERROR) })
ipcMain.handle(IPC.IPC_LOG_EXPORT_DIALOG, async () => { throw new Error(STUB_ERROR) })
```

**调用方**: `src/renderer/pages/Settings/SettingsPage.tsx` 中大量调用这些 API

| 行号 | 调用 | 后果 |
|:----:|:----|:----:|
| 832 | `getAPI().log.list()` | 点击「刷新列表」→ 崩溃 |
| 843 | `getAPI().log.clear()` | 点击「清空」→ 崩溃 |
| 869 | `getAPI().log.read(selectedLog, 200)` | 选择日志文件 → 崩溃 |
| 870 | `getAPI().log.filter(selectedLog, levels, 200)` | 切换级别过滤 → 崩溃 |
| 893 | `getAPI().log.search(selectedLog, v, 200)` | 输入搜索关键词 → 崩溃 |
| 910 | `getAPI().log.exportWithDialog(selectedLog)` | 点击「导出」→ 崩溃 |
| 932 | `getAPI().log.search(f.name, ...)` | 点击日志文件名 → 崩溃 |

**修复方案**: 实现 7 个 log handler 的完整功能（文件读取、按级别过滤、文本搜索、导出等）
- `logger.ts` 已存在日志写入逻辑，各日志文件路径已知
- `IPC_LOG_WRITE_RENDERER` 已正确实现（仅这一个通道不是 stub）

> **✅ 状态：已修复（2026-06-11 复核）**
>
> 本节描述的 stub 实现**已在扫描日期之后被重写**。当前 `src/main/ipc/log-handlers.ts`（100 行，文件头注释明确为「真实业务实现」+「real implementation」）已完整实现 7 个 IPC handler，全部委托到 `src/main/utils/logger.ts` 中已存在的函数：
>
> | IPC 通道 | 当前实现 |
> |:---|:---|
> | `IPC_LOG_LIST` | `listLogFiles()` — 读 `userData/logs/`，返回 `{stream,date,name,sizeBytes}[]` |
> | `IPC_LOG_READ` | `readLogTail(name, lines=100)` — 读 tail，含 `path.relative` 路径遍历防护 |
> | `IPC_LOG_CLEAR` | `clearAllLogs()` — 删 `*.log` 文件，返回数量 |
> | `IPC_LOG_FILTER` | `readLogTailByLevel(name, levels[], lines=200)` — 先读 1000 行再按 `[LEVEL]` 过滤 |
> | `IPC_LOG_SEARCH` | `searchLog(name, query, lines=200)` — 子串匹配（大小写不敏感），先读 2000 行 |
> | `IPC_LOG_EXPORT` | `exportLog(name, destPath)` — 复制到目标路径，返回字节数 |
> | `IPC_LOG_EXPORT_DIALOG` | `dialog.showSaveDialog()` + `exportLog()` |
>
> 验证：
> - `grep -E "STUB_ERROR|rebuild pending" log-handlers.ts` → 无匹配
> - `npx tsc --noEmit` → exit 0，无类型错误
> - `ipc-client.ts:215-225` 的 `log.*` 类型签名与 handler 返回值一致
> - SettingsPage 的 11 处调用（行 955-1059）路径全部能命中
>
> 报告中"修复方案"段提到的两件事**已完成**：`logger.ts` 的 `listLogFiles`/`readLogTail`/`clearAllLogs`/`exportLog` 4 个函数现已是 handler 唯一依赖；`IPC_LOG_WRITE_RENDERER` 仍正常工作（渲染端 `console.log` 经 `log.forward` 转发）。

---

## 🔴 P0 — 系统崩溃级

### 2. ChatPage Agent 模式：agent 事件被 MainLayout 和 ChatPage 双重订阅

**文件**: 
- `src/renderer/layouts/MainLayout.tsx` 第 29-32 行（agentStore.initStatusListener）
- `src/renderer/pages/Chat/ChatPage.tsx` 第 62-68 行（独立订阅 agent.onStatusUpdate）

**问题**: 
- MainLayout 挂载时调用 `agentStore.initStatusListener()` → 订阅了 `IPC_AGENT_STATUS_UPDATE`，事件进入 `agentStore._handleStatusUpdate`
- ChatPage 挂载时也独立订阅了 `IPC_AGENT_STATUS_UPDATE`，事件进入 `chatStore.handleAgentEvent`

这不是 bug 而是设计，但要注意：
- 两个监听器独立运行，且 ChatPage 的监听器只在 `chatMode === 'agent'` 时转发
- 导航离开 Chat 页面时 ChatPage 的监听器会被清理，但 MainLayout 的监听器永远存在
- 如果 ChatPage 被多次挂载/卸载，每次都会新增一个监听器实例（虽然 useEffect 清理会移除旧的）

**影响**: 🟡 中风险 — 正常使用没问题，但导航性能敏感。

---

## 🟡 P1 — 功能降级级

### 3. eaa-bridge.ts JSON 命令集不完整（handler 注释与 bridge 逻辑矛盾）

**文件**: `src/main/services/eaa-bridge.ts` 第 34-59 行（JSON_COMPATIBLE_COMMANDS / TEXT_OUTPUT_COMMANDS）

**问题**: 以下 EAA 子命令既不在 JSON 集合也不在文本集合中，走默认"未知命令追加 `--output json`"逻辑：

| 命令 | Handler 注释 | Bridge 行为 |
|:----:|:------------|:-----------|
| `add` | "不产生 JSON 输出，返回文本" | 追加 `--output json` ❌ |
| `revert` | "不产生 JSON 输出" | 追加 `--output json` ❌ |
| `add-student` | "不产生 JSON 输出" | 追加 `--output json` ❌ |
| `delete-student` | "不产生 JSON 输出" | 追加 `--output json` ❌ |
| `set-student-meta` | "不产生 JSON 输出" | 追加 `--output json` ❌ |
| `import` | "不产生 JSON 输出" | 追加 `--output json` ❌ |
| `info` | — | 追加 `--output json` |
| `score` | — | 追加 `--output json` |
| `validate` | — | 追加 `--output json` |
| `range` | — | 追加 `--output json` |
| `tag` | — | 追加 `--output json` |
| `codes` | — | 追加 `--output json` |
| `list-students` | — | 追加 `--output json` |
| `replay` | — | 追加 `--output json` |

**风险**: 如果 eaa-cli 二进制不支持 `--output json` 参数，这些命令会出错。如果 eaa-cli 支持，就是注释过时。

**修复方案**: 
- 确认每个命令是否真正支持 `--output json`
- 将不支持的命令加入 TEXT_OUTPUT_COMMANDS
- 更新 handler 注释

---

## 🟡 P1 — 功能降级级

### 4. eaa-tools.ts 缺少参数 sanitize（Agent 调用可绕过安全校验）

**文件**: `src/main/services/eaa-tools.ts`

**问题**: eaa-handlers.ts 中有完善的 `sanitizeName()` 防注入校验（拒绝控制字符、shell 元字符、`--` 起头），但 eaa-tools.ts 直接透传 Agent 参数到 eaa-bridge，**没有做任何安全校验**。

```
eaa-handlers.ts: 用户 → sanitizeName() → eaa-bridge ✅
eaa-tools.ts:    Agent → eaa-bridge.execute() ❌ 无校验
```

**风险**: Agent 可通过工具调用发起命令注入攻击（如传递含 `"`、`$`、`;` 的参数）。

**受影响工具**: `queryScoreTool`, `addEventTool`, `historyTool`, `searchEventsTool`, `listStudentsTool`, `rankingTool`, `rangeTool`, `addStudentTool`（8 个工具全部没有 sanitize）

**修复方案**: 在 eaa-tools.ts 的每个 execute 中加 sanitize 校验，或封装一个 `safeExecute()` 包装器

---

## 🟡 P1 — 功能降级级

### 5. searchEventsTool 不支持引号包裹的复合词搜索

**文件**: `src/main/services/eaa-tools.ts` 第 140 行

```typescript
// eaa-tools.ts — Agent 调用的 search
const args = params.query.split(' ')  // ❌ 简单 split，不支持引号

// eaa-handlers.ts — 用户直接调用的 search（正确版）
const args = tokenizeQuery(query)  // ✅ 支持 "引号包裹" 的复合词
```

**影响**: Agent 搜索带空格的关键词时行为不一致。用户从 UI 搜索 `"张三 迟到"` 可以精确匹配，Agent 调工具搜索同样的内容得到的是 `['"张三', '迟到"']` 两个 token。

---

## 🟢 P2 — 可用性级

### 6. starter 配置缺失 `npm run build:eaa` 脚本

**文件**: `package.json`

**问题**: eaa-bridge.ts 第 150 行提到 `"Please run 'pnpm build:eaa'..."`，但 package.json 中没有任何 `build:eaa` 脚本，也没有 `pnpm` 配置（只有 npm）。新开发者看到这个提示无法操作。

```json
// package.json scripts — 缺少 build:eaa
{
  "dev": "...",
  "build": "...",
  "start": "...",
  "package": "...",
  // no "build:eaa" or "download:eaa"
}
```

---

## 🟢 P2 — 可用性级

### 7. DashboardPage/StudentsPage/StudentProfile 等页面直接 getAPI().eaa.* — 无 store 容错

**文件**: `src/renderer/pages/Dashboard/DashboardPage.tsx`, `src/renderer/pages/Students/StudentsPage.tsx` 等

**问题**: 这些页面直接调 `getAPI().eaa.*`，没有：
- Zustand store 缓存（每次切换页面都重新请求）
- 统一的 loading/error 状态（每个组件自己状态管理，风格不统一）
- 数据更新没有状态管理通知机制

**对比**: Chat 页面和 Agents 页面有 chatStore/agentStore 统一管理状态

---

## 🟢 P2 — 可用性级

### 8. `eaa:export` 导出格式硬编码

**文件**: `src/main/ipc/eaa-handlers.ts` 第 186-188 行

```typescript
const allowedFormats = new Set(['csv', 'json', 'markdown', 'html'])
```

但 `ipc-channels.ts` 中 `IPC_EAA_EXPORT` 的接口定义为：
```typescript
export: (format: string, outputFile?: string) => Promise<EAAResult<string>>
```

**问题**: `format` 类型是 `string`，但实际只允许 4 种格式。前端传了不支持的格式会在 IPC handler 层抛异常。应该在 `shared/types` 中定义联合类型 `'csv' | 'json' | 'markdown' | 'html'`，并在 ipc-client.ts 中使用。

---

## 🟢 P3 — 建议级

### 9. 缺少 `build:eaa` 和 `download:eaa` 脚本

**文件**: `package.json`

**建议**: 添加从 GitHub Releases 下载 eaa-cli 二进制到 resources 目录的脚本

---

## 总结：问题优先级矩阵

| 优先级 | 问题 | 影响 |
|:------:|:----|:----|
| 🔴 **P0** | log-handlers.ts 全空壳 | Settings 日志查看器完全不可用 |
| 🔴 **P0** | Agent 事件双重订阅 | 潜在的多监听器泄漏 |
| 🟡 **P1** | eaa-bridge JSON 集合不完整 | add/revert 等命令可能输出非 JSON |
| 🟡 **P1** | eaa-tools 缺少 sanitize | Agent 可注入 shell 命令 |
| 🟡 **P1** | search 工具不支持引号词 | Agent 搜索行为与 UI 不一致 |
| 🟢 **P2** | 没有 build:eaa 脚本 | 新开发者无法构建 EAA |
| 🟢 **P2** | 部分页面无 store 状态管理 | 数据不缓存，样式不统一 |
| 🟢 **P3** | export format 类型不够精确 | 类型不安全 |
| 🟢 **P3** | 缺少构建辅助脚本 | 开发者体验差 |

---

## 关键发现图表

### 链路完整率

```
IPC 通道总数: 97
Handler 实现数: 90 ✅
Handler stub 数:   7 ❌ (log-handlers)
链路完整率:     92.8%
```

### 安全覆盖

```
eaa-handlers sanitize 覆盖率: 22/22 = 100% ✅
privacy-handlers sanitize 覆盖率: 10/10 = 100% ✅
eaa-tools sanitize 覆盖率:     0/11 =   0% ❌ 高危!
```

### Store 状态管理覆盖

```
有独立 Store:     Chat, Agents, Settings (3/9 = 33%)
无 Store 直接调:  Dashboard, Students, StudentProfile,
                  Models, Skills, Scheduler, Privacy (7/9 = 67%)
```
