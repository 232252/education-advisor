// =============================================================
// 全量回归测试 — 依次运行所有 CDP 测试脚本并汇总结果
// =============================================================
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const tests = [
  'cdp-nav-students-academics-test.mjs',
  'cdp-direct-entry-test.mjs',
  'cdp-ai-entry-test.mjs',
  'cdp-linkage-test.mjs',
  'cdp-comprehensive-test.mjs',
  'cdp-stress-test.mjs',
  'cdp-ui-save-test.mjs',
  'cdp-all-subjects-test.mjs',
  'cdp-cross-page-linkage.mjs',
  'cdp-academics-test.mjs',
  'cdp-analyze-paper-test.mjs',
  'cdp-edge-cases.mjs',
  'cdp-all-pages-nav.mjs',
  'cdp-class-crud.mjs',
  'cdp-cross-ref-consistency.mjs',
  'cdp-eaa-integration.mjs',
  'cdp-settings-persistence.mjs',
  'cdp-ipc-modules.mjs',
  'cdp-settings-concurrent.mjs',
  'cdp-eaa-concurrent-cache.mjs',
  'cdp-cross-module-edge.mjs',
  'cdp-ui-form-validation.mjs',
  'cdp-import-export.mjs',
  'cdp-cron-deep.mjs',
  'cdp-agent-deep.mjs',
  'cdp-privacy-log-deep.mjs',
  'cdp-academics-full-subjects.mjs',
  'cdp-eaa-search-range-deep.mjs',
  'cdp-student-meta-deep.mjs',
  'cdp-settings-enum-deep.mjs',
  'cdp-dashboard-stats-deep.mjs',
  'cdp-agent-execution-deep.mjs',
  'cdp-log-export-deep.mjs',
  'cdp-eaa-event-lifecycle-deep.mjs',
  'cdp-class-archive-deep.mjs',
  'cdp-eaa-doctor-cache-deep.mjs',
  'cdp-academic-exam-deep.mjs',
  'cdp-cron-execution-deep.mjs',
  'cdp-settings-reset-deep.mjs',
  'cdp-skill-system-deep.mjs',
  'cdp-keystore-deep.mjs',
  'cdp-ai-chat-deep.mjs',
  'cdp-system-profile-deep.mjs',
  // ===== Round 8 深度测试套件 =====
  'cdp-agent-soul-validation-deep.mjs',
  'cdp-integrations-deep.mjs',
  'cdp-ipc-coverage-deep.mjs',
  'cdp-cross-module-stress-deep.mjs',
  // ===== Round 9 用户需求功能深度验证 =====
  'cdp-feature-deep-test.mjs',
  // ===== Round 10 用户需求功能边界深度测试 =====
  'cdp-feature-edge-deep.mjs',
  // ===== Round 11 用户需求功能稳定性 + 压力测试 =====
  'cdp-feature-stability-deep.mjs',
  // ===== Round 12 用户需求功能 UI 交互测试 =====
  'cdp-feature-ui-interact.mjs',
  // ===== Round 13 AI 数据访问能力全方面测试 (重中之重) =====
  'cdp-ai-data-access-deep.mjs',
  // ===== Round 14 AI 数据访问深度矩阵测试 (重中之重续) =====
  'cdp-ai-data-access-matrix-deep.mjs',
  // ===== Round 15 AI 数据访问边界与错误处理测试 (重中之重续2) =====
  'cdp-ai-data-access-edge-deep.mjs',
  // ===== Round 16 AI Agent 工具实际执行测试 (重中之重续3) =====
  'cdp-ai-agent-tool-execution-deep.mjs',
  // ===== Round 17 AI 文件工具学业数据深度测试 (重中之重续4) =====
  'cdp-ai-file-tools-academic-deep.mjs',
  // ===== Round 18 AI 跨模块数据流端到端测试 (重中之重续5) =====
  'cdp-ai-cross-module-dataflow-deep.mjs',
  // ===== Round 19 AI 真实使用场景端到端测试 (重中之重续6) =====
  'cdp-ai-real-workflow-deep.mjs',
  // ===== Round 20 AI 写入-读取一致性测试 (重中之重续7) =====
  'cdp-ai-write-read-consistency-deep.mjs',
  // ===== Round 21 AI 并发压力测试 (重中之重续8) =====
  'cdp-ai-concurrent-stress-deep.mjs',
  // ===== Round 22 AI 数据生命周期完整性测试 (重中之重续9) =====
  'cdp-ai-lifecycle-deep.mjs',
  // ===== Round 23 AI 工具 schema + 参数边界深度测试 (重中之重续10) =====
  'cdp-ai-schema-boundary-deep.mjs',
  // ===== Round 24 AI 跨时间段数据分析 + 趋势数据可达性测试 (重中之重续11) =====
  'cdp-ai-time-trend-deep.mjs',
  // ===== Round 25 AI 多轮写入压力 + 数据一致性长期验证 (重中之重续12) =====
  'cdp-ai-write-stress-deep.mjs',
  // ===== Round 26 AI 异常路径与错误恢复深度测试 (重中之重续13) =====
  'cdp-ai-error-recovery-deep.mjs',
  // ===== Round 27 AI 数据隔离与权限边界深度测试 (重中之重续14) =====
  'cdp-ai-data-isolation-deep.mjs',
  // ===== Round 28 AI 大数据量性能与极限边界深度测试 (重中之重续15) =====
  'cdp-ai-large-data-perf-deep.mjs',
  // ===== Round 29 AI Agent 工具调用真实执行路径深度验证 (重中之重续16) =====
  'cdp-ai-agent-tool-path-deep.mjs',
  // ===== Round 30 AI 数据完整性 + 缓存一致性 + 交叉验证深度测试 (重中之重续17) =====
  'cdp-ai-data-integrity-cross-deep.mjs',
  // ===== Round 31 AI Agent SOUL/Rules + 学业数据写入路径深度测试 (重中之重续18) =====
  'cdp-ai-soul-academic-write-deep.mjs',
  // ===== Round 32 AI 剩余数据路径可达性深度测试 (重中之重续19) =====
  'cdp-ai-remaining-paths-deep.mjs',
  // ===== Round 33 AI Agent 工具能力矩阵 + 跨 agent 协作数据流深度测试 (重中之重续20) =====
  'cdp-ai-agent-capability-matrix-deep.mjs',
  // ===== Round 34 AI 数据导出/导入 + 外部文件交互 + 隐私引擎深度测试 (重中之重续21) =====
  'cdp-ai-export-file-privacy-deep.mjs',
  // ===== Round 35 AI 数据一致性 + 跨模块写入路径端到端深度测试 (重中之重续22) =====
  'cdp-ai-data-consistency-cross-module-deep.mjs',
  // ===== Round 36 AI 真实多 Agent 协作场景 + 数据流完整性深度测试 (重中之重续23) =====
  'cdp-ai-multi-agent-collaboration-deep.mjs',
  // ===== Round 37 AI 极限边界 + 输入注入 + 安全防护深度测试 (重中之重续24) =====
  'cdp-ai-extreme-boundary-security-deep.mjs',
  // ===== Round 38 MCP 集成预备 + 计划文档结构验证测试 =====
  'cdp-mcp-integration-readiness-deep.mjs',
  // ===== Round 40 MCP 集成实功能验证测试 (post-implementation, 71 tests) =====
  'cdp-mcp-integration-verification-deep.mjs',
  // ===== Round 41 MCP 功能深度验证测试 (feature flag ON, error handling, security, 50 tests) =====
  'cdp-mcp-functional-deep.mjs',
  // ===== Round 42 MCP 性能与稳定性深度测试 (IPC延迟, 并发, 长时间运行, 28 tests) =====
  'cdp-mcp-performance-deep.mjs',
]

const results = []
const cwd = process.cwd()

for (const test of tests) {
  const testPath = path.join(cwd, 'scripts', test)
  if (!fs.existsSync(testPath)) {
    console.log(`[SKIP] ${test} — 文件不存在`)
    results.push({ name: test, status: 'skip', detail: '文件不存在' })
    continue
  }
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`运行: ${test}`)
  console.log('='.repeat(60))
  
  try {
    const output = execSync(`node scripts/${test}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    console.log(output)
    
    // 解析结果
    const match = output.match(/总计:\s*(\d+),\s*通过:\s*(\d+),\s*失败:\s*(\d+)/)
    if (match) {
      const [, total, passed, failed] = match
      results.push({ name: test, status: failed === '0' ? 'pass' : 'fail', detail: `${passed}/${total}` })
    } else {
      // 没有标准格式的输出,检查是否有 FAIL
      const hasFail = output.includes('[FAIL]')
      const passCount = (output.match(/\[PASS\]/g) || []).length
      const failCount = (output.match(/\[FAIL\]/g) || []).length
      results.push({ name: test, status: failCount === 0 ? 'pass' : 'fail', detail: `${passCount}/${passCount + failCount}` })
    }
  } catch (err) {
    const output = err.stdout || err.stderr || ''
    console.log(output)
    console.log(`[ERROR] ${test}: ${err.message}`)
    
    const match = output.match(/总计:\s*(\d+),\s*通过:\s*(\d+),\s*失败:\s*(\d+)/)
    if (match) {
      const [, total, passed, failed] = match
      results.push({ name: test, status: 'fail', detail: `${passed}/${total}` })
    } else {
      const passCount = (output.match(/\[PASS\]/g) || []).length
      const failCount = (output.match(/\[FAIL\]/g) || []).length
      results.push({ name: test, status: 'fail', detail: `${passCount}/${passCount + failCount} (exit ${err.status})` })
    }
  }
}

// 汇总
console.log('\n' + '='.repeat(60))
console.log('全量回归测试汇总')
console.log('='.repeat(60))
console.log('Test'.padEnd(45) + 'Status'.padEnd(8) + 'Result')
console.log('-'.repeat(60))
let totalPass = 0
let totalFail = 0
for (const r of results) {
  const status = r.status === 'pass' ? 'PASS' : r.status === 'skip' ? 'SKIP' : 'FAIL'
  console.log(r.name.padEnd(45) + status.padEnd(8) + r.detail)
  if (r.status === 'pass') {
    const [, passed] = r.detail.match(/(\d+)\/(\d+)/) || [, 0]
    totalPass += parseInt(passed)
  } else if (r.status === 'fail') {
    const match = r.detail.match(/(\d+)\/(\d+)/)
    if (match) {
      totalPass += parseInt(match[1])
      totalFail += parseInt(match[2]) - parseInt(match[1])
    }
  }
}
console.log('-'.repeat(60))
console.log(`总计: ${results.length} 套件, ${totalPass} 通过, ${totalFail} 失败`)
