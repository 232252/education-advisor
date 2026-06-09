# 🐝 AI Workstation 蜂群架构设计文档

> 版本: v0.2.0-wip | 日期: 2025-07-19  
> 目标: 构建自验性蜂群开发体系 — 每个功能模块对应一位专家，
> 底层设计对应架构专家，修改时并行征询意见、并行修改、交叉验证，
> 形成「设计→实现→效应验证→查缺补漏」的完美闭环

---

## 第1章: 项目全局链接拓扑

### 1.1 三层架构总览

```
┌──────────────────────────────────────────────────────────┐
│            RENDERER LAYER (React 18 + Zustand)            │
│  ┌───────────┬───────────┬──────┬──────┬────────────────┐ │
│  │ Dashboard │   Chat    │Students│Agents│  Models        │ │
│  │ Skills    │ Scheduler │Privacy│Settings│  StudentProfile│ │
│  └─────┬─────┴─────┬─────┴──┬───┴──┬───┴───────┬────────┘ │
│        │           │        │      │           │           │
│  ┌─────┴───────────┴────────┴──────┴───────────┴────────┐ │
│  │              Zustand Stores                           │ │
│  │  chatStore │ agentStore │ settingsStore │ toastStore   │ │
│  └──────────────────────┬───────────────────────────────┘ │
│                         │ window.api                      │
├─────────────────────────┼────────────────────────────────┤
│            MAIN PROCESS LAYER (Electron + Node.js 22)     │
│                         │                                 │
│  ┌──────────────────────┴───────────────────────────────┐ │
│  │              IPC Handlers (11 模块)                    │ │
│  │  ai-handlers  │ agent-handlers  │ eaa-handlers       │ │
│  │  cron-handlers│ feishu-handlers │ log-handlers       │ │
│  │  privacy-h    │ profile-h       │ settings-h         │ │
│  │  skill-h      │ sys-h           │                     │ │
│  └──┬───────┬────┴────┬──────┬─────┴──────┬────────────┘ │
│     │       │         │      │            │              │
│  ┌──┴───────┴─────────┴──────┴────────────┴──────────┐   │
│  │              Services Layer                         │   │
│  │  agent-service.ai→pi-ai  │ eaa-bridge→eaa-cli      │   │
│  │  cron-service            │ db-service→SQLite        │   │
│  │  keystore-service        │ feishu-service→Lark API  │   │
│  │  update-service          │ tray-service             │   │
│  │  settings-service        │ profile-service          │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                  │
├─────────────────────────┼────────────────────────────────┤
│             EXTERNAL / BACKEND LAYER                       │
│                         │                                  │
│  ┌─────────┐  ┌────────┴──────┐  ┌──────────┐            │
│  │ eaa-cli │  │ pi-agent-core │  │ Feishu   │            │
│  │ (Rust)  │  │ (LLM 推理)    │  │ OpenAPI  │            │
│  └─────────┘  └───────────────┘  └──────────┘            │
└──────────────────────────────────────────────────────────┘
```

### 1.2 页面 → Store → IPC → Handler → Service 完整链路表

| # | 页面 (Page) | Store | IPC 通道 | Handler | 后端 Service | 链路状态 |
|---|------------|-------|----------|---------|-------------|---------|
| **1** | **DashboardPage** | → 直接 getAPI().eaa.* | IPC_EAA_STATS/SUMMARY/INFO/DOCTOR/VALIDATE/BENCHMARK/DASHBOARD/REPLAY | eaa-handlers.ts | eaa-bridge.ts → eaa-cli.exe | ✅ **通** |
| **2** | **ChatPage** | chatStore | IPC_AI_CHAT_STREAM, IPC_AI_CHAT_ABORT, IPC_AI_LIST_PROVIDERS, IPC_AI_LIST_MODELS, IPC_CHAT_SAVE_MESSAGE, IPC_CHAT_LOAD_MESSAGES, IPC_CHAT_DELETE_SESSION, IPC_CHAT_LIST_SESSIONS | ai-handlers.ts, agent-handlers.ts | pi-ai-service.ts → pi-agent-core | ✅ **通** |
| **3** | **StudentsPage** | → 直接 getAPI().eaa.* | IPC_EAA_LIST_STUDENTS, IPC_EAA_SCORE, IPC_EAA_RANKING, IPC_EAA_SEARCH, IPC_EAA_ADD_STUDENT, IPC_EAA_DELETE_STUDENT, IPC_EAA_ADD_EVENT, IPC_EAA_REVERT_EVENT, IPC_EAA_SET_STUDENT_META, IPC_EAA_EXPORT, IPC_EAA_HISTORY | eaa-handlers.ts | eaa-bridge.ts → eaa-cli.exe | ✅ **通** |
| **4** | **StudentProfile** | → 直接 getAPI().eaa.* + getAPI().profile.* | IPC_EAA_SCORE, IPC_EAA_HISTORY, IPC_EAA_SEARCH, IPC_EAA_RANGE, IPC_EAA_STATS, IPC_EAA_ADD_EVENT, IPC_EAA_REVERT_EVENT, IPC_EAA_EXPORT, IPC_PROFILE_GET/SET | eaa-handlers.ts, profile-handlers.ts | eaa-bridge.ts → eaa-cli.exe, profile-service.ts | ✅ **通** |
| **5** | **AgentsPage** | agentStore | IPC_AGENT_LIST/GET/UPDATE/TOGGLE/RUN_MANUAL/ABORT/GET_SOUL/SET_SOUL/GET_RULES/SET_RULES/GET_HISTORY/STATUS_UPDATE | agent-handlers.ts | agent-service.ts → pi-agent-core | ✅ **通** |
| **6** | **ModelsPage** | → 直接 getAPI().ai.* | IPC_AI_LIST_PROVIDERS, IPC_AI_LIST_MODELS, IPC_AI_TEST_CONNECTION, IPC_AI_SET_API_KEY, IPC_AI_DELETE_API_KEY, IPC_AI_ADD_CUSTOM_MODEL, IPC_AI_DEL_CUSTOM_MODEL, IPC_AI_UPDATE_CUSTOM_MODEL | ai-handlers.ts | pi-ai-service.ts → keystore-service.ts | ✅ **通** |
| **7** | **SkillsPage** | → 直接 getAPI().skill.* | IPC_SKILL_LIST/GET/SAVE/DELETE | skill-handlers.ts | agent-service.ts (buildSkillsSection) | ✅ **通** |
| **8** | **SchedulerPage** | → 直接 getAPI().cron.* | IPC_CRON_LIST/ADD/UPDATE/REMOVE/TOGGLE/RUN_NOW/GET_LOGS/STATUS_UPDATE | cron-handlers.ts | cron-service.ts → node-cron | ✅ **通** |
| **9** | **PrivacyPage** | → 直接 getAPI().privacy.* | IPC_PRIVACY_INIT/LOAD/ENABLE/DISABLE/LIST/ADD/ANONYMIZE/DEANONYMIZE/FILTER/DRYRUN/BACKUP | privacy-handlers.ts | eaa-bridge.ts → eaa-cli.exe (PII Shield) | ✅ **通** |
| **10** | **SettingsPage** | settingsStore | IPC_SETTINGS_GET/SET/RESET, IPC_FEISHU_*, IPC_LOG_*, IPC_SYS_* | settings-handlers.ts, feishu-handlers.ts, log-handlers.ts, sys-handlers.ts | settings-service.ts, feishu-service.ts, update-service.ts | ✅ **通** |

> **结论：全链路 10/10 通畅。** 所有页面都有完整的 Page → Store/IPC → Handler → Service 链路，无断裂。

---

## 第2章: 蜂群架构设计 (Swarm Architecture)

### 2.1 蜂群成员总览

```
┌────────────────────────────────────────────────────────────────┐
│                      🐝 蜂群委员会 (Swarm Council)               │
│                     协调所有专家的工作流                           │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐     │
│  │ 👑 架构总师    │  │ 🔗 链路专家    │  │ 🧪 效应验证专家 │     │
│  │ (Architect)    │  │ (Linker)       │  │ (Validator)    │     │
│  │ - 全局一致性    │  │ - 上下游连接    │  │ - 回归测试     │     │
│  │ - 模块边界     │  │ - 数据流完整性  │  │ - 异常路径     │     │
│  │ - 技术选型     │  │ - 接口契约      │  │ - 边界效应     │     │
│  └────────┬───────┘  └────────┬───────┘  └───────┬────────┘     │
│           │                   │                   │              │
│  ┌────────┴───────────────────┴───────────────────┴────────┐    │
│  │                  领域专家 (Domain Experts)                 │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                        │    │
│  │  🧠 UI/UX 专家  │  ⚙️ EAA 核心专家  │  🤖 Agent 专家   │    │
│  │  (UI Expert)    │  (EAA Expert)     │  (Agent Expert)  │    │
│  │  - Dashboard    │  - 评分引擎       │  - 运行时        │    │
│  │  - Chat         │  - 事件系统       │  - 调度系统      │    │
│  │  - Students     │  - 学生管理       │  - 技能注入      │    │
│  │  - Settings     │  - 隐私引擎       │  - 模型路由      │    │
│  │  - 响应式/主题   │  - 导出/报表      │  - Agent 编排    │    │
│  │                                                        │    │
│  │  🗄️ 数据专家    │  🔌 集成专家      │  📊 运维专家     │    │
│  │  (Data Expert)  │  (Integration)   │  (Ops Expert)    │    │
│  │  - SQLite Schema│  - 飞书           │  - 构建/发布     │    │
│  │  - Zustand Store│  - MCP           │  - 日志/监控     │    │
│  │  - IPC 数据流   │  - LLM Provider   │  - 自动更新      │    │
│  │  - 类型系统     │  - OAuth          │  - 打包/分发     │    │
│  │                                                        │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 专家职责明细

#### 👑 架构总师 (Architect)
- **守护领域**: 全局架构、模块边界、技术方向
- **检查清单**:
  - [ ] 新增/修改是否遵循三层架构 (Renderer → Main → Backend)
  - [ ] 模块间依赖是否单向（不得循环依赖）
  - [ ] 类型定义是否集中在 `shared/types`
  - [ ] IPC 通道是否在 `shared/ipc-channels` 注册
  - [ ] 是否有不必要的跨层穿透
  - [ ] 新增功能是否已有架构决策记录

#### 🔗 链路专家 (Linker)
- **守护领域**: 上下游数据流完整性
- **检查清单**:
  - [ ] Page → Store → IPC → Handler → Service 链路完整
  - [ ] 每个 IPC 通道名对应 `ipc-channels.ts` 中定义的常量
  - [ ] Handler 路径与 `ipc/index.ts` 中的注册一致
  - [ ] 返回类型与 `shared/types` 中的接口一致
  - [ ] 错误处理是否每一层都有 try-catch
  - [ ] Store 中的 `getAPI()` 调用与 `ipc-client.ts` 定义匹配
  - [ ] preload 暴露的 API 与 `ipc-client.ts` 的 `WindowAPI` 接口一致

#### 🧪 效应验证专家 (Validator)
- **守护领域**: 改动带来的副作用、回归测试、边界条件
- **检查清单**:
  - [ ] 修改是否影响其他页面/模块（副作用扫描）
  - [ ] 修改是否破坏现有 UI 布局
  - [ ] i18n 中英文字典是否都加了新 key
  - [ ] 是否引入了新的异常路径/边界情况
  - [ ] 修改后的 TS 类型检查是否通过 (`tsc --noEmit`)
  - [ ] 构建是否通过 (`npm run build`)
  - [ ] 测试是否通过 (`npm run test`)

#### 🧠 UI/UX 专家 (UI Expert)
- **守护领域**: 9 个页面、组件、Hooks、样式、国际化
- **负责文件**: `src/renderer/pages/*`, `src/renderer/components/*`, `src/renderer/hooks/*`, `src/renderer/stores/*`, `src/renderer/i18n/*`, `src/renderer/styles/*`, `src/renderer/layouts/*`
- **检查清单**:
  - [ ] UI 组件符合 Tailwind 设计体系
  - [ ] 暗色模式支持
  - [ ] 中英文 i18n 完整
  - [ ] 响应式布局（最小窗口 1024×640）
  - [ ] 键盘可访问性
  - [ ] Toast 通知覆盖所有错误/成功场景

#### ⚙️ EAA 核心专家 (EAA Expert)
- **守护领域**: 评分引擎、事件系统、学生管理、隐私引擎、导出/报表
- **负责文件**: `src/main/services/eaa-bridge.ts`, `src/main/services/eaa-tools.ts`, `src/main/ipc/eaa-handlers.ts`, `src/main/ipc/privacy-handlers.ts`
- **检查清单**:
  - [ ] eaa-cli 二进制可执行文件存在
  - [ ] 命令参数格式正确传递
  - [ ] EAAResult 包装一致性
  - [ ] 数据目录正确初始化
  - [ ] 隐私加密/脱敏流程完整
  - [ ] 导出格式支持完整

#### 🤖 Agent 专家 (Agent Expert)
- **守护领域**: Agent 运行时、调度系统、技能注入、模型路由、编排
- **负责文件**: `src/main/services/agent-service.ts`, `src/main/services/cron-service.ts`, `src/main/ipc/agent-handlers.ts`, `src/main/ipc/cron-handlers.ts`, `src/main/ipc/skill-handlers.ts`
- **检查清单**:
  - [ ] Agent 生命周期完整 (idle→running→idle/error)
  - [ ] SOUL/Rules 注入逻辑正确
  - [ ] 技能(Skill)构建和注入正确
  - [ ] 模型选择策略生效
  - [ ] 定时任务触发正确
  - [ ] Agent 状态推送完整

#### 🗄️ 数据专家 (Data Expert)
- **守护领域**: SQLite Schema、Zustand Store、IPC 数据流、类型系统
- **负责文件**: `src/shared/types/index.ts`, `src/shared/ipc-channels.ts`, `src/main/services/db-service.ts`, `src/renderer/stores/*`, `src/renderer/lib/ipc-client.ts`, `src/main/ipc/profile-handlers.ts`
- **检查清单**:
  - [ ] 类型接口在 shared/types 中统一定义
  - [ ] IPC 通道在 shared/ipc-channels 中统一注册
  - [ ] 数据库 Migration 版本控制
  - [ ] Store 数据流单向传输
  - [ ] 类型变更是否同步更新所有消费者

#### 🔌 集成专家 (Integration Expert)
- **守护领域**: 飞书、MCP、LLM Provider、OAuth
- **负责文件**: `src/main/services/feishu-service.ts`, `src/main/services/pi-ai-service.ts`, `src/main/services/keystore-service.ts`, `src/main/ipc/feishu-handlers.ts`, `src/main/ipc/ai-handlers.ts`
- **检查清单**:
  - [ ] 飞书 API 认证流程完整
  - [ ] Bitable 同步定时任务准确
  - [ ] LLM Provider 连接测试
  - [ ] API Key 安全存储（keystore）
  - [ ] OAuth 流程完整
  - [ ] 第三方 API 凭证管理

#### 📊 运维专家 (Ops Expert)
- **守护领域**: 构建/发布、日志/监控、自动更新、打包/分发
- **负责文件**: `package.json`, `vite.config.*`, `src/main/services/update-service.ts`, `src/main/services/tray-service.ts`, `src/main/utils/logger.ts`, `src/main/ipc/sys-handlers.ts`, `src/main/ipc/log-handlers.ts`
- **检查清单**:
  - [ ] 构建配置正确
  - [ ] 打包产物路径正确
  - [ ] 日志级别/轮转/清理正常
  - [ ] 自动更新流程完整
  - [ ] 跨平台二进制路径正确

---

## 第3章: 蜂群工作流

### 3.1 四阶段循环

```
  ┌────────────────────────────────────────────────────────────────┐
  │                   🐝 蜂群工作流 (Swarm Workflow)                │
  │                                                                │
  │   PHASE 1                    PHASE 2                           │
  │   ┌──────────────┐          ┌──────────────┐                   │
  │   │  🗣️ 需求征询   │  ──────→ │  ✏️ 并行修改    │                │
  │   │  Consult      │         │  Parallel Edit │                  │
  │   │  ──────────── │         │  ──────────── │                  │
  │   │  · 架构总师    │         │  · ≥4 文件并行  │                 │
  │   │  · 链路专家    │         │  · 各专家在     │                 │
  │   │  · 领域专家    │         │    自己领域修改  │                 │
  │   │  · 效应专家    │         │  · 链路专家锁定  │                 │
  │   │  评估影响范围   │         │    接口契约     │                 │
  │   └──────┬───────┘          └──────┬─────────┘                 │
  │          │                        │                            │
  │          │    PHASE 4             │   PHASE 3                  │
  │          │    ┌──────────────┐    │                            │
  │          └───→│  🔁 迭代优化  │←───┘                            │
  │               │  Iterate     │                                  │
  │               │  ────────────│                                  │
  │               │  · 根据效应    │                                  │
  │               │    专家意见修改 │                                  │
  │               │  · 直到无缺陷  │                                  │
  │               └──────┬───────┘                                  │
  │                      │                                          │
  │                      │  达到完美状态 ✓                           │
  │                      ▼                                          │
  │               ┌──────────────┐                                  │
  │               │  ✅ 合并交付   │                                  │
  │               │  Merge &     │                                  │
  │               │  Deliver     │                                  │
  │               └──────────────┘                                  │
  └────────────────────────────────────────────────────────────────┘
```

### 3.2 工作流详细步骤

```
PHASE 1: 🗣️ 需求征询
─────────────────────
1. 架构总师收到修改请求
2. 架构总师召集相关领域专家（至少链路专家 + 效应专家）
3. 各位专家独立评估影响范围，输出检查清单
4. 链路专家锁定所有受影响的接口契约（不可修改的接口签名）
5. 汇总意见，形成修改计划

PHASE 2: ✏️ 并行修改 (≥4 并行)
─────────────────────────
1. 架构总师分配修改任务给各专家
2. 至少 4 个文件同时修改（利用 parallel_edit_files 工具）
3. 链路专家监控接口一致性
4. 效应专家在修改过程中进行实时验证
5. 修改完成后跑 tsc --noEmit / npm run build

PHASE 3: 🔍 效应验证
─────────────────
1. 效应专家运行全套验证：
   a. 类型检查 (tsc --noEmit)
   b. 构建检查 (npm run build)
   c. 测试 (npm run test)
   d. 副作用扫描（检查是否影响其他模块）
   e. 链路回溯（确认所有链路完整）
2. 架构总师复查全局一致性
3. 各位专家出具验证意见

PHASE 4: 🔁 迭代优化
─────────────────
1. 根据效应专家的验证意见进行修改
2. 如有缺陷：回到 PHASE 2
3. 如无缺陷：进入下一步
4. 链路专家最终确认链路完整性
5. 效应专家给出「通过」评级
6. 架构总师批准合并
```

---

## 第4章: 项目详细链路分析

### 4.1 各模块上下游依赖图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          DASHBOARD 页面                              │
│  StudentsPage ─────┐                                                │
│  StudentProfile ───┤                                                │
│                    ├──→ getAPI().eaa.* ──→ eaa-handlers ──→ eaa-bridge ──→ eaa-cli │
│  DashboardPage ────┘                                                │
│                    │                                                │
│                    └──→ getAPI().eaa.info                            │
│                    └──→ getAPI().eaa.stats                           │
│                    └──→ getAPI().eaa.doctor                          │
│                    └──→ getAPI().eaa.validate                        │
│                    └──→ getAPI().eaa.summary                         │
│                    └──→ getAPI().eaa.dashboard                       │
│                    └──→ getAPI().eaa.benchmark                       │
│                    └──→ getAPI().eaa.replay                          │
│                    └──→ getAPI().eaa.codes                           │
│                    └──→ getAPI().eaa.tag                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          CHAT 页面                                   │
│  chatStore ──→ getAPI().ai.listProviders ──→ ai-handlers ──→ pi-ai-service │
│  chatStore ──→ getAPI().ai.chat ───────────→ ai-handlers ──→ pi-ai-service │
│  chatStore ──→ getAPI().ai.onStream ───────→ preload (ipcRenderer.on)      │
│  chatStore ──→ getAPI().ai.abortChat ──────→ ai-handlers ──→ pi-ai-service │
│  chatStore ──→ getAPI().chat.* ────────────→ (main process handles)       │
│                                                                           │
│  对话模式切换: direct / agent                                              │
│  agent 模式 → getAPI().agent.runManual ───→ agent-service ──→ pi-agent   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          AGENTS 页面                                │
│  agentStore ──→ getAPI().agent.list ──────→ agent-handlers ──→ agent-service │
│  agentStore ──→ getAPI().agent.get ───────→ agent-handlers ──→ agent-service │
│  agentStore ──→ getAPI().agent.toggle ────→ agent-handlers ──→ agent-service │
│  agentStore ──→ getAPI().agent.update ────→ agent-handlers ──→ agent-service │
│  agentStore ──→ getAPI().agent.runManual ─→ agent-handlers ──→ agent-service │
│  agentStore ──→ getAPI().agent.onStatusUpdate ─→ preload (ipcMain → renderer)│
│  agentStore ──→ getAPI().agent.abort ─────→ agent-handlers ──→ agent-service │
│                                                                           │
│  agent-service → cron-service (定时任务关联)                                │
│  agent-service → settings-service (模型路由)                                │
│  agent-service → keystore-service (API Key)                                │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          SETTINGS 页面                               │
│  settingsStore ──→ getAPI().settings.get ──→ settings-handlers ──→ settings-service │
│  settingsStore ──→ getAPI().settings.set ──→ settings-handlers ──→ settings-service │
│                                                                            │
│  飞书配置 → getAPI().feishu.* ───→ feishu-handlers ──→ feishu-service       │
│  日志     → getAPI().log.* ──────→ log-handlers ────→ (fs 读写日志文件)      │
│  系统     → getAPI().sys.* ──────→ sys-handlers ────→ electron API          │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 跨模块耦合点分析

| 耦合点 | 涉及模块 | 现状 | 风险等级 |
|--------|---------|------|---------|
| **Agent ↔ Cron** | agent-service ↔ cron-service | agent 通过 cron 定时执行，schedule 双向绑定 | 🟡 中 |
| **Agent ↔ EAA Tools** | agent-service ↔ eaa-tools | agent 通过 getToolsByCapability 注入 EAA 工具 | 🟢 低 |
| **EAA Bridge ↔ Privacy** | eaa-bridge → eaa-cli (PII) | 隐私引擎是 eaa-cli 的一个子命令 | 🟢 低 |
| **Chat ↔ Agent** | chatStore ↔ agentStore | Agent 模式需切换 chatStore.agentId | 🟡 中 |
| **Dashboard ↔ EAA** | DashboardPage → eaa-handlers | 强依赖，dashboard 从 eaa 拉取所有数据 | 🟢 低 |
| **Settings → all** | settingsStore → 所有 service | 全局配置，设置变化影响所有模块 | 🔴 高 |

### 4.3 已发现的潜在链路问题

- **[中] DashboardPage 没有用 infoStore/summaryStore** — 它直接调 getAPI().eaa.*，不经过 Zustand store。虽然链路是通的，但不在状态管理体系中，刷新/错误处理较原始。
- **[低] PrivacyPage 没有用 privacyStore** — 和 Dashboard 一样直接调 API，状态管理在组件内。
- **[低] SkillsPage 没有用 skillsStore** — 直接调 getAPI().skill.*。
- **[低] SchedulerPage 没有用 schedulerStore** — 直接调 getAPI().cron.*。
- **[低] ModelsPage 没有用 modelsStore** — 直接调 getAPI().ai.*。

> **分析**: 一部分页面有独立 Store (Chat/Agents/Settings)，另一部分直接调 API。这是设计选择而非缺陷——有独立 Store 的页面通常有复杂的状态需要跨组件共享，简单的 CRUD 页面直接调 API 更高效。

---

## 第5章: 蜂群启动与使用指南

### 5.1 新功能开发流程

```mermaid
sequenceDiagram
    participant PM as 需求提出人
    participant Arch as 👑 架构总师
    participant Link as 🔗 链路专家
    participant Domain as 🧠 领域专家
    participant Valid as 🧪 效应专家
    participant Code as 代码实现

    PM->>Arch: 提出需求
    Arch->>Domain: 召集相关领域专家
    Arch->>Link: 调用链路专家评估影响
    Arch->>Valid: 调用效应专家评估影响
    Link-->>Arch: 返回受影响的接口清单
    Domain-->>Arch: 返回技术方案
    Valid-->>Arch: 返回验证计划
    Arch->>Code: 形成修改计划，分配并行修改任务(≥4文件)
    Code->>Link: 修改过程中保持接口一致
    Code->>Domain: 领域实现
    Code->>Valid: 提交修改
    Valid->>Code: 验证意见
    Code->>Code: 迭代修改直到完美
    Valid-->>Arch: 验证通过
    Link-->>Arch: 链路完整确认
    Arch->>PM: 交付
```

### 5.2 快速启动蜂群命令

```bash
# Step 1: 查看当前项目结构和文件列表
# Step 2: 读取指定文件内容
# Step 3: 架构总师评估 → 链路专家锁定接口 → 效应专家制定验证计划
# Step 4: 并行修改 ≥4 文件
# Step 5: 构建验证 (tsc --noEmit + npm run build)
# Step 6: 效应验证 → 迭代
# Step 7: git commit
```

### 5.3 使用模板

每次修改时，首先输出以下检查模板：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🐝 蜂群启动检查
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👑 架构总师意见:
  [ ] 是否遵循三层架构
  [ ] 是否有循环依赖
  [ ] 是否需要新增 IPC 通道

🔗 链路专家锁定接口:
  受影响链路:
  1. Page → Store → IPC → Handler → Service
  2. 接口签名冻结清单: ...

🧠 领域专家 (@UI/@EAA/@Agent/@Data/@Integration/@Ops):
  评估意见: ...

🧪 效应专家验证计划:
  1. tsc --noEmit
  2. npm run build
  3. npm run test
  4. 副作用扫描（影响哪些模块）
  5. i18n 完整性检查
  6. 链路回溯

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 第6章: 可扩展性

### 6.1 可加入的额外蜂群角色

| 角色 | 说明 | 何时加入 |
|------|------|---------|
| 🔒 安全专家 | 审计代码安全性（XSS/RCE/注入） | 引入网络/文件操作时 |
| ⚡ 性能专家 | 性能优化、内存泄漏检测 | 大规模数据处理时 |
| 📐 测试专家 | 编写/维护单元测试和 E2E 测试 | 测试覆盖率不足时 |
| 🌐 DevOps 专家 | CI/CD 流水线、跨平台打包 | 发布流程自动化时 |
| 📖 文档专家 | 维护 API 文档、用户手册 | 对外发布时 |

### 6.2 未来扩展方向（目前缺失但可加）

- **MCP 服务器集成**: 当前 `codeartsdoer/mcp/mcp_settings.json` 存在但未见代码引用
- **侧边栏 Agent 状态监控**: MainLayout 已有 Agent 状态小面板，但未集成 Agent 快捷操作
- **Event Bus 中心**: 当前模块间通信依赖 IPC，缺少统一的进程内事件总线

---

## 第7章: 快速参考

### 7.1 文件结构速查

| 路径 | 说明 |
|------|------|
| `src/main/index.ts` | Electron 主进程入口 |
| `src/main/ipc/index.ts` | IPC Handler 注册入口 |
| `src/main/ipc/*.ts` | 11 个 IPC Handler 模块 |
| `src/main/services/*.ts` | 13 个业务服务模块 |
| `src/renderer/App.tsx` | React 根组件（路由） |
| `src/renderer/layouts/MainLayout.tsx` | 主布局（侧边栏导航） |
| `src/renderer/pages/*/` | 9 个页面 + 1 个详情页 |
| `src/renderer/stores/*.ts` | 4 个 Zustand Store |
| `src/renderer/hooks/*.ts` | 11 个自定义 Hooks |
| `src/renderer/lib/ipc-client.ts` | IPC 客户端封装（类型安全） |
| `src/shared/ipc-channels.ts` | IPC 通道常量 |
| `src/shared/types/index.ts` | 共享类型定义 |
| `resources/eaa-binaries/win32-x64/eaa.exe` | EAA 核心二进制 |

### 7.2 IPC 通道数量统计

| 模块 | 通道数 | 说明 |
|------|--------|------|
| AI | 11 | Provider/模型/Chat/流式/OAuth |
| Agent | 12 | 列表/详情/开关/运行/SOUL/Rules |
| EAA | 22 | 评分/排名/事件/学生/搜索/导出 |
| Privacy | 10 | 初始化/加载/脱敏/备份 |
| Cron | 8 | 增删改查/开关/运行/日志 |
| Skill | 4 | 增删改查 |
| Settings | 3 | 读/写/重置 |
| Chat | 4 | 消息持久化 |
| Feishu | 6 | 飞书集成 |
| Sys | 7 | 系统功能 |
| Log | 8 | 日志管理 |
| Profile | 2 | 学生档案 |
| **总计** | **97** | 完整 IPC 通道 |

---

> 📌 **本设计文档本身就是蜂群架构的第一份"架构文档"**，后续每次修改都应按蜂群工作流程执行。  
> 每次启动任务时，先读取此文档，调用相应专家，再开始工作。
