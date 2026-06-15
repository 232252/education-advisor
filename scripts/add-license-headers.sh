#!/usr/bin/env bash
# =============================================================
# add-license-headers.sh — 为所有源文件批量添加版权头
#
# 用途: 开源前规范化所有源文件的协议声明。
# 运行: bash scripts/add-license-headers.sh
# 幂等: 已有头的文件会被跳过 (检测 // SPDX-License-Identifier)
# =============================================================

set -euo pipefail
cd "$(dirname "$0")/.."

YEAR=$(date +%Y)
RUST_NOTICE="// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright (c) ${YEAR} Education Advisor AI Contributors
// This file is dual-licensed under MIT and Apache 2.0.
// See LICENSE-MIT and LICENSE-APACHE at the repository root."

TS_NOTICE="/*
 * SPDX-License-Identifier: MIT OR Apache-2.0
 * Copyright (c) ${YEAR} Education Advisor AI Contributors
 * This file is dual-licensed under MIT and Apache 2.0.
 * See LICENSE-MIT and LICENSE-APACHE at the repository root.
 */"

CSS_NOTICE="/*!
 * SPDX-License-Identifier: MIT OR Apache-2.0
 * Copyright (c) ${YEAR} Education Advisor AI Contributors
 * Dual-licensed under MIT and Apache 2.0.
 */"

count=0

# --- Rust (.rs) ---
while IFS= read -r -d '' f; do
    if ! head -1 "$f" | grep -q "SPDX-License-Identifier"; then
        # 在文件已有的 //! 或 // 模块文档前插入版权头
        printf '%s\n%s\n' "$RUST_NOTICE" "$(cat "$f")" > "$f"
        count=$((count + 1))
        echo "  ✓ $f"
    fi
done < <(find core/eaa-cli/src src-tauri/src -name "*.rs" -print0 2>/dev/null)

# --- TypeScript/JavaScript (.ts/.tsx) ---
while IFS= read -r -d '' f; do
    if ! head -2 "$f" | grep -q "SPDX-License-Identifier"; then
        printf '%s\n%s\n' "$TS_NOTICE" "$(cat "$f")" > "$f"
        count=$((count + 1))
        echo "  ✓ $f"
    fi
done < <(find src/renderer/lib src/renderer/stores src/renderer/hooks -name "*.ts" -o -name "*.tsx" -print0 2>/dev/null)

# --- CSS ---
while IFS= read -r -d '' f; do
    if ! head -2 "$f" | grep -q "SPDX-License-Identifier"; then
        printf '%s\n%s\n' "$CSS_NOTICE" "$(cat "$f")" > "$f"
        count=$((count + 1))
        echo "  ✓ $f"
    fi
done < <(find src/renderer/styles -name "*.css" -print0 2>/dev/null)

echo ""
echo "完成: 为 ${count} 个文件添加了版权头。"
echo "提示: 审查依赖协议兼容性 → cargo install cargo-license && cargo license"
