#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""分析 ai-workstation 项目的 IPC 链路打通情况。"""
import io
import re
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

ROOT = Path(r"C:\Users\sq199\.qwenpaw\workspaces\default\coding_projects\1\ai-workstation")

# ---------- 1) ipc-channels.ts 已定义 ----------
ipc_channels_file = ROOT / "src" / "shared" / "ipc-channels.ts"
defined: dict[str, str] = {}
for m in re.finditer(r"export const (IPC_\w+)\s*=\s*'([^']+)'", ipc_channels_file.read_text(encoding="utf-8")):
    defined[m.group(1)] = m.group(2)

# ---------- 2) handler 已注册（多行匹配） ----------
handler_files = list((ROOT / "src" / "main" / "ipc").glob("*.ts"))
registered_const: set[str] = set()
registered_raw: set[str] = set()
for f in handler_files:
    txt = f.read_text(encoding="utf-8")
    # 多行匹配: ipcMain.handle( ... IPC.XXX 或 'xxx'
    for m in re.finditer(r"ipcMain\.handle\([^;]*?IPC\.(IPC_\w+)", txt, re.DOTALL):
        registered_const.add(m.group(1))
    for m in re.finditer(r"ipcMain\.handle\([^;]*?['\"]([a-z][a-z0-9_:-]*)['\"]", txt, re.DOTALL):
        registered_raw.add(m.group(1))
    # 单独字符串注册
    for m in re.finditer(r"ipcMain\.handle\(\s*['\"]([a-z][a-z0-9_:-]*)['\"]", txt):
        registered_raw.add(m.group(1))

# ---------- 3) preload 桥接的通道 ----------
preload = (ROOT / "src" / "main" / "preload" / "index.ts").read_text(encoding="utf-8")
bridged_invoke = set(re.findall(r"ipcRenderer\.invoke\(\s*'([^']+)'", preload))
bridged_on = set(re.findall(r"ipcRenderer\.on\(\s*'([^']+)'", preload))

# ---------- 4) ipc-client.ts 暴露给前端的 window.api ----------
ipc_client = (ROOT / "src" / "renderer" / "lib" / "ipc-client.ts").read_text(encoding="utf-8")
api_methods: dict[str, set[str]] = {}
for m in re.finditer(r"^\s*(\w+):\s*\{([\s\S]*?)\n  \}", ipc_client, re.MULTILINE):
    ns = m.group(1)
    body = m.group(2)
    methods = set(re.findall(r"^\s*(\w+)\s*:\s*\(", body, re.MULTILINE))
    api_methods[ns] = methods

# ---------- 5) Page 调用了哪些 api.ns.method ----------
pages_dir = ROOT / "src" / "renderer" / "pages"
page_calls: dict[str, set[tuple[str, str]]] = {}
for p in pages_dir.rglob("*Page.tsx"):
    if p.is_file():
        txt = p.read_text(encoding="utf-8")
        calls = re.findall(r"(?:window\.api|getAPI\(\))\s*\.(\w+)\.(\w+)\s*\(", txt)
        page_calls[p.relative_to(ROOT).as_posix()] = set(calls)

# ---------- 6) 检查 preload 桥接到 ipc-channels 的对应 ----------
defined_values = set(defined.values())

# ============================================================
# 报告输出
# ============================================================
out = []

out.append("=" * 72)
out.append("AI-WORKSTATION  IPC 链路打通情况归纳")
out.append("=" * 72)
out.append(f"项目根: {ROOT}")
out.append(f"已定义 IPC 通道（共享常量）: {len(defined)}")
out.append(f"已注册 handler（IPC.* 常量）: {len(registered_const)}")
out.append(f"已注册 handler（裸字符串）: {len(registered_raw)}")
out.append(f"preload 已桥接（invoke）: {len(bridged_invoke)}")
out.append(f"preload 已桥接（on/push）: {len(bridged_on)}")
out.append("")

# 6.1 已定义但未注册
out.append("--- 1. 已定义常量但 handler 未注册（链路断）---")
miss = [(n, c) for n, c in defined.items() if n not in registered_const]
if miss:
    for n, c in miss:
        out.append(f"  ❌  {n} = '{c}'   →  在 ipc-channels.ts 中定义, 但 src/main/ipc/*.ts 中没有匹配到 ipcMain.handle(IPC.{n}...)")
else:
    out.append("  ✅  全部已注册")
out.append("")

# 6.2 已注册但常量未走（裸字符串）
out.append("--- 2. handler 用裸字符串注册（不在 IPC.* 常量中）---")
for ch in sorted(registered_raw):
    in_const = ch in defined_values
    out.append(f"  {'⚠️ ' if not in_const else 'ℹ️ '}  '{ch}'  " + ("（未在 ipc-channels.ts 中）" if not in_const else "（常量已定义但 handler 没用常量）"))
out.append("")

# 6.3 preload 桥接 vs 实际存在
out.append("--- 3. preload 桥接但 ipc-channels.ts 中未定义的通道（裸桥接）---")
unbridged_def = bridged_invoke | bridged_on
unbridged_no_const = sorted([c for c in unbridged_def if c not in defined_values])
for ch in unbridged_no_const:
    out.append(f"  ⚠️  '{ch}'  →  preload 直接用了字符串，ipc-channels.ts 没常量")
out.append("")

# 6.4 Page → API 命名空间 统计
out.append("--- 4. 每个 Page 调用的 API 命名空间---")
for page, calls in sorted(page_calls.items()):
    if not calls:
        out.append(f"\n  📄 {page}  (未发现 API 调用)")
        continue
    by_ns: dict[str, set[str]] = {}
    for ns, m in calls:
        by_ns.setdefault(ns, set()).add(m)
    out.append(f"\n  📄 {page}  (共 {len(calls)} 个调用)")
    for ns in sorted(by_ns):
        ms = sorted(by_ns[ns])
        # 检查每个方法是否在 ipc-client.ts 中存在
        if ns not in api_methods:
            out.append(f"     ❌ {ns}.{','.join(ms)}  →  window.api.{ns} 命名空间不存在")
            continue
        for m in ms:
            if m not in api_methods[ns]:
                out.append(f"     ❌ {ns}.{m}  →  window.api.{ns}.{m} 方法不存在")
            else:
                out.append(f"     ✓  {ns}.{m}")
out.append("")

# 6.5 ipc-client → preload 完整性
out.append("--- 5. window.api 各方法在 preload 中的对应桥接（覆盖率）---")
for ns, methods in sorted(api_methods.items()):
    out.append(f"  window.api.{ns}:")
    for m in sorted(methods):
        # 粗略对应
        out.append(f"    {m}")
out.append("")

# 6.6 综合链路总结
out.append("--- 6. 综合链路总结（每行 = Page → API → 桥接 → Handler → Service）---")
out.append("(略，按上述 1-5 节的发现归并即可)")
out.append("")

result = "\n".join(out)
print(result)

# 写入文件
out_path = ROOT / "scripts" / "link_report.txt"
out_path.write_text(result, encoding="utf-8")
print(f"\n[已写入] {out_path}")
