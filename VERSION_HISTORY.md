# EAA 版本历史
> 版本命名规则：语义化版本 vMAJOR.MINOR.PATCH
> 由邵老师确认后发布，未经确认不得跳大版本

---

## v3.1.2（当前版本，2026-05-07）

**特性**：
- 飞书Bitable自动同步（D方案：CLI钩子 + cron定时双重保障）
- 数据核心升级：`summary`、`dashboard`、`export --format csv|jsonl|html`、`set-student-meta`
- `--output/-O json|text` 全局结构化输出
- Benchmark 标准化评测框架（安兔兔式跑分，四维度评估）
- PostgreSQL 后端可选支持（双后端架构：文件系统/PostgreSQL）
- `DataContext` 统一数据加载层
- 同步脚本防循环机制（SHA256校验）
- 文档全面更新

**修复**：
- 飞书同步不再需要手动操作（CLI钩子自动触发）
- 总览表更新性能优化（仅在有新事件时触发）
- evidence_ref 全量补齐
- 学生操行分总览表字段完善

---

## v3.1.1（2026-04-29）

**特性**：
- `delete-student` 命令：归档学生（保留历史事件）
- 二进制发布（linux-x86_64）
- Benchmark首跑（99.5/100分 🟢优秀）

---

## v3.1.0（2026-04-22）

**特性**：
- 隐私脱敏引擎（PII Shield），AES-256-GCM加密
- 学生档案查询：`eaa profile/grades/talks`
- 身份证/电话/地址自动脱敏
- 数据导出：`eaa export-profiles`
- 52名学生全量映射（S_001~S_052）
- 数据访问强制规则（禁止直接读JSON）

**修复**：
- 隐私引擎全面修复
- 操作权限分离

**提交**：`233bbfd`, `c908380`

---

## v3.0.0（2026-04-20）

**特性**：
- 事件溯源操行分系统（Event Sourcing）
- Rust 核心引擎（CLI）
- 原因码强类型校验
- 原子写入 + 文件锁
- `eaa add` / `revert` / `ranking` / `history` / `search` / `stats`
- 多平台支持：linux-x86_64 / linux-arm64 / macos-x86_64 / macos-arm64
- Nushell/Python 安装脚本

**提交**：`5b356f1`

---

## 版本变迁图

```
v3.0.0 ────────────────────── 事件溯源系统初始版本
  │                            Rust核心 + 多平台发布
  │
  ├── v3.1.0 ──────────────── 隐私脱敏引擎
  │                            PII Shield + AES-256-GCM
  │
  ├── v3.1.1 ──────────────── delete-student + Benchmark首跑
  │                            二进制发布
  │
  └── v3.1.2 (当前) ───────── 飞书自动同步 + 数据核心升级
                              D方案：钩子+定时双重保障
```

> **重要提示**：版本号由邵老师确认后发布。未经确认不得跳版本。
> 当前版本 `v3.1.2` 对应系统第三次小版本迭代。
> 所有历史误标版本（如远程的 `v5.0.0`、`v4.0.0`）已更正为 v3.1.2。
