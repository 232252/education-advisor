// =============================================================
// Vitest globalSetup — 全量跑批后的原子写残留清扫
// 背景(2026-10-27 实证): 部分 main 测试的 electron mock 让
// app.getPath('userData') 指向仓库根(或 cwd),atomicWrite 崩溃/中断
// 遗留的 *.tmp.<pid>.<ts>.<rand> 会累积在仓库根(一次清出 97 个)。
// 真实 App 启动已有 sweepAtomicTmpResidue(app-lifecycle),但 vitest
// 不会走那条路径,故在 globalSetup teardown 兜底扫一次仓库根。
// 复用 src/main/utils/atomic-write 的唯一权威实现(仅依赖 node 内建)。
// =============================================================

import path from 'node:path'
import { sweepAtomicTmpResidue } from '../src/main/utils/atomic-write'

export default function globalSetup(): () => Promise<void> {
  // setup 阶段无事可做;残留清排放到 teardown,顺带清掉历史遗留
  return async () => {
    // process.cwd() = vitest root(仓库根);同 pid 跳过逻辑对 orchestrator
    // 无影响(写盘发生在 worker 进程,pid 必不同)
    const removed = await sweepAtomicTmpResidue([path.resolve(process.cwd())])
    if (removed > 0) {
      console.log(`[globalSetup] swept ${removed} atomic-write tmp residue files in repo root`)
    }
  }
}
