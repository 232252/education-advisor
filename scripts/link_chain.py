#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""分析 ai-workstation 项目的 IPC 链路打通情况（精确版）。"""
import io
import re
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

ROOT = Path(r"C:\Users\sq199\.qwenpaw\workspaces\default\coding_projects\1\ai-workstation")

# =============================================================
# 1) 收集已定义的 IPC 通道
# =============================================================
ipc_channels_file = ROOT / "src" / "shared" / "ipc-channels.ts"
defined: dict[str, str] = {}
for m in re.finditer(r"export const (IPC_\w+)\s*=\s*'([^']+)'", ipc_channels_file.read_text(encoding="utf-8")):
    defined[m.group(1)] = m.group(2)

# =============================================================
# 2) 收集 handler 注册（多行、含 IPC.* 与裸字符串）
# =============================================================
handler_dir = ROOT / "src" / "main" / "ipc"
service_dir = ROOT / "src" / "main" / "services"
handler_const: set[str] = set()      # 已用 IPC.* 常量注册的通道
handler_raw: dict[str, str] = {}     # 裸字符串注册的通道 → 所在文件

for f in handler_dir.glob("*.ts"):
    txt = f.read_text(encoding="utf-8")
    for m in re.finditer(r"ipcMain\.handle\([^;]*?IPC\.(IPC_\w+)", txt, re.DOTALL):
        handler_const.add(m.group(1))
    # 裸字符串：定位在 ipcMain.handle( 之后第一个字符串字面量
    for m in re.finditer(r"ipcMain\.handle\(\s*['\"]([a-z][a-z0-9_:\-\.]*)['\"]", txt):
        handler_raw[m.group(1)] = str(f.relative_to(ROOT))

# 哪些是 push 通道（main → renderer 推送，不是 handle）
push_channels: set[str] = set()
for f in (handler_dir / "agent-handlers.ts", service_dir / "agent-service.ts",
          service_dir / "cron-service.ts", handler_dir / "ai-handlers.ts"):
    if f.exists():
        txt = f.read_text(encoding="utf-8")
        for m in re.finditer(r"webContents\.send\(\s*(?:IPC\.)?(IPC_\w+|'([^']+)'|\"([^\"]+)\")", txt):
            ch = m.group(2) or m.group(3) or m.group(1)
            push_channels.add(ch)

# =============================================================
# 3) preload 桥接的通道
# =============================================================
preload_txt = (ROOT / "src" / "main" / "preload" / "index.ts").read_text(encoding="utf-8")
bridged_invoke: set[str] = set()
bridged_on: set[str] = set()
# 常量:  ipcRenderer.invoke(IPC.IPC_FOO)       → 已走 IPC.* 常量
# 字符串: ipcRenderer.invoke('foo:bar')          → 裸字符串
for m in re.finditer(r"ipcRenderer\.invoke\(\s*IPC\.(IPC_\w+)\s*[,)]", preload_txt):
    bridged_invoke.add(("const", m.group(1)))
for m in re.finditer(r"ipcRenderer\.invoke\(\s*'([^']+)'\s*[,)]", preload_txt):
    bridged_invoke.add(("raw", m.group(1)))
for m in re.finditer(r"ipcRenderer\.on\(\s*IPC\.(IPC_\w+)\s*[,)]", preload_txt):
    bridged_on.add(("const", m.group(1)))
for m in re.finditer(r"ipcRenderer\.on\(\s*'([^']+)'\s*[,)]", preload_txt):
    bridged_on.add(("raw", m.group(1)))
for m in re.finditer(r"ipcRenderer\.send\(\s*'([^']+)'", preload_txt):
    bridged_invoke.add(("raw", m.group(1)))

# 改名：bridged_invoke 和 bridged_on 是 (kind, ch) tuple set
# 后续代码需要相应调整

# =============================================================
# 4) ipc-client.ts 暴露给前端的 window.api
# =============================================================
ipc_client = (ROOT / "src" / "renderer" / "lib" / "ipc-client.ts").read_text(encoding="utf-8")
api_methods: dict[str, set[str]] = {}
for m in re.finditer(r"^\s*(\w+):\s*\{([\s\S]*?)\n  \}", ipc_client, re.MULTILINE):
    ns = m.group(1)
    body = m.group(2)
    methods = set(re.findall(r"^\s*(\w+)\s*:\s*\(", body, re.MULTILINE))
    api_methods[ns] = methods

# =============================================================
# 5) Pages 与 Stores 调用的 API
# =============================================================
pages_dir = ROOT / "src" / "renderer" / "pages"
stores_dir = ROOT / "src" / "renderer" / "stores"

# 命名空间 → 实际调用方式
caller_map: dict[str, set[str]] = {}   # 调用方（"Page:..." / "Store:..."）→ 命名空间.method

# Page 直接调用
for p in pages_dir.rglob("*Page.tsx"):
    if p.is_file():
        txt = p.read_text(encoding="utf-8")
        calls = re.findall(r"(?:window\.api|getAPI\(\))\s*\.(\w+)\.(\w+)\s*\(", txt)
        key = f"Page: {p.stem}"
        caller_map.setdefault(key, set()).update([f"{ns}.{m}" for ns, m in calls])

# Store 调用
for p in stores_dir.glob("*.ts"):
    txt = p.read_text(encoding="utf-8")
    calls = re.findall(r"getAPI\(\)\s*\.(\w+)\.(\w+)\s*\(", txt)
    if calls:
        key = f"Store: {p.stem}"
        caller_map.setdefault(key, set()).update([f"{ns}.{m}" for ns, m in calls])

# =============================================================
# 6) main/index.ts 启动流程
# =============================================================
main_index = (ROOT / "src" / "main" / "index.ts").read_text(encoding="utf-8")
service_inits = re.findall(r"(?:await\s+)?(\w+Service)\.\w+\(\)", main_index)

# =============================================================
# 输出报告
# =============================================================
out = []
out.append("=" * 78)
out.append("🔗 AI-WORKSTATION  IPC 链路打通情况归纳（精确版）")
out.append("=" * 78)
out.append(f"项目根: {ROOT}")
out.append("")
out.append(f"已定义 IPC 通道（共享常量）:  {len(defined)}")
out.append(f"已用 IPC.* 常量注册的 handler:  {len(handler_const)}")
out.append(f"已用裸字符串注册的 handler:    {len(handler_raw)}")
invoke_const = [c for k, c in bridged_invoke if k == "const"]
invoke_raw = [c for k, c in bridged_invoke if k == "raw"]
on_const = [c for k, c in bridged_on if k == "const"]
on_raw = [c for k, c in bridged_on if k == "raw"]
out.append(f"preload invoke 桥接:            {len(bridged_invoke)} (常量: {len(invoke_const)}, 裸字符串: {len(invoke_raw)})")
out.append(f"preload on (push 订阅):         {len(bridged_on)} (常量: {len(on_const)}, 裸字符串: {len(on_raw)})")
out.append(f"前端 window.api 命名空间:       {len(api_methods)}")
out.append(f"调用方（Page+Store）:            {len(caller_map)}")
out.append("")

# ----- 1. 推送通道说明 -----
out.append("─" * 78)
out.append("📡  推送通道（main → renderer 主动推，不是 handle，需要 webContents.send）")
out.append("─" * 78)
for ch in sorted(push_channels):
    const = next((k for k, v in defined.items() if v == ch), None)
    bridge_ok = ("const", ch) in bridged_on or ("raw", ch) in bridged_on
    out.append(f"  • {ch:32s}  常量={const or '∅':28s}  preload.on {'✅' if bridge_ok else '❌ 未桥接'}")
out.append("")

# ----- 2. 已定义但 handler 未注册（真正的链路断点） -----
out.append("─" * 78)
out.append("❌  1) 已定义常量但 handler 未注册（真正的链路断）")
out.append("─" * 78)
miss = [(n, c) for n, c in defined.items() if n not in handler_const and c not in handler_raw and c not in push_channels]
if miss:
    for n, c in miss:
        out.append(f"   ❌ {n} = '{c}'")
else:
    out.append("   ✅  全部已注册（handle 或 push）")
out.append("")

# ----- 3. 用裸字符串注册的 handler -----
out.append("─" * 78)
out.append("⚠️   2) handler 用裸字符串注册（应该改成 IPC.* 常量）")
out.append("─" * 78)
for ch, f in sorted(handler_raw.items()):
    const = next((k for k, v in defined.items() if v == ch), None)
    if const:
        out.append(f"   ⚠️  '{ch}'  ← 应改为 IPC.{const}     (in {f})")
    else:
        out.append(f"   ⚠️  '{ch}'  (无对应常量，建议新增)   (in {f})")
out.append("")

# ----- 4. preload 桥接但未走 IPC.* 常量 -----
out.append("─" * 78)
out.append("⚠️   3) preload 用裸字符串桥接（应改为 IPC.* 常量）")
out.append("─" * 78)
all_raw_set: set[str] = set()
for k, c in bridged_invoke | bridged_on:
    if k == "raw":
        all_raw_set.add(c)
for ch in sorted(all_raw_set):
    const = next((k for k, v in defined.items() if v == ch), None)
    if const:
        out.append(f"   ⚠️  preload 用 '{ch}'  → 应改为 IPC.{const}")
    else:
        out.append(f"   ⚠️  preload 用 '{ch}'  (ipc-channels.ts 中无对应常量, 建议新增)")
out.append("")

# ----- 5. Page → API 矩阵 -----
out.append("─" * 78)
out.append("📄  4) 各 Page/Store → window.api 调用矩阵")
out.append("─" * 78)
for caller in sorted(caller_map):
    out.append(f"\n  {caller}")
    calls = sorted(caller_map[caller])
    by_ns: dict[str, list[str]] = {}
    for c in calls:
        ns, m = c.split(".", 1)
        by_ns.setdefault(ns, []).append(m)
    for ns in sorted(by_ns):
        for m in sorted(by_ns[ns]):
            ok = ns in api_methods and m in api_methods[ns]
            bridge_ok = ns in api_methods and m in api_methods[ns]  # api_methods 已经是 preload 桥接的接口
            icon = "✅" if ok else "❌"
            out.append(f"     {icon} {ns}.{m}")
out.append("")

# ----- 6. window.api 各命名空间方法覆盖率 -----
out.append("─" * 78)
out.append("🔌  5) window.api → preload → handler → service 完整性")
out.append("─" * 78)
out.append("  说明: window.api 的每个方法都应该:")
out.append("    1) 在 preload 中 invoke 至少一个 IPC.* 通道")
out.append("    2) 该通道在 main/ipc 中有 handler")
out.append("    3) handler 调用了对应的 service")
out.append("")
for ns in sorted(api_methods):
    out.append(f"  window.api.{ns}:")
    for m in sorted(api_methods[ns]):
        out.append(f"    • {m}")
out.append("")

# ----- 7. 综合结论 -----
out.append("─" * 78)
out.append("📊  6) 综合结论")
out.append("─" * 78)
out.append(f"  链路通畅的 IPC 通道:  {len(handler_const) - len(miss)}/{len(defined)}")
out.append(f"  推送通道（无 handle）:  {len(push_channels)}")
out.append(f"  裸字符串注册的 handler: {len(handler_raw)}   ← 建议统一为 IPC.* 常量")
out.append(f"  preload 裸字符串桥接:   {len([c for c in all_bridged if c not in defined.values()])}   ← 建议统一为 IPC.* 常量")
out.append(f"  API 方法命名空间:        {len(api_methods)} 个 ({sum(len(v) for v in api_methods.values())} 个方法)")
out.append(f"  端到端可用的 Page:       {sum(1 for k in caller_map if k.startswith('Page: '))} 个")
out.append("")

result = "\n".join(out)
print(result)
(ROOT / "scripts" / "link_chain_report.txt").write_text(result, encoding="utf-8")
print(f"\n[已写入] {ROOT / 'scripts' / 'link_chain_report.txt'}")
