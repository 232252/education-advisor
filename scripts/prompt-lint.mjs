// =============================================================
// prompt-lint.mjs — 提示词回归门禁（M11）
//
// 使命：M9/M10 重写提示词后，防止"模板垃圾回潮"——自我复制段、
//       引用不存在的工具/CLI、硬编码人名、空人格文件等问题全部
//       是机器可检的。本脚本以正则断言守住已清理的成果。
//
// 用法：
//   node scripts/prompt-lint.mjs          执行检查（CI 门禁，违规退出码 1）
//
// 检查规则（第一版）：
//   R1 config/agents.yaml 每个 agent 的 SOUL.md 存在且 ≥ 10 行
//   R2 每个 agent 的 AGENTS.md 存在且非空，不含自我复制标志
//   R3 全部 agents/**/*.md 不含已知幻觉关键词
//      （HEARTBEAT / MEMORY.md / ElevenLabs / Discord / WhatsApp /
//        exec 执行 / execute_shell_command / grep_search）
//   R4 不含 CLI 风格工具引用 `eaa xxx`（运行时工具名是 eaa_xxx）
//   R5 不含硬编码模式：邵老师 / 学生总数=52
//   R6 yaml 的 agent 与 agents/ 目录一一对应（_shared 除外）
// =============================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AGENTS_DIR = join(ROOT, 'agents')
const AGENTS_YAML = join(ROOT, 'config', 'agents.yaml')

/** 递归收集目录下所有 .md 文件 */
function walkMd(dir, out = []) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkMd(p, out)
    else if (p.endsWith('.md')) out.push(p)
  }
  return out
}

/** 解析 agents.yaml 顶层 agent id 列表（缩进 2 空格的 "- id:"） */
function parseAgentIds() {
  const src = readFileSync(AGENTS_YAML, 'utf-8')
  const ids = []
  for (const m of src.matchAll(/^\s{2}- id:\s*(\S+)\s*$/gm)) ids.push(m[1])
  return ids
}

const violations = []
const fail = (rule, file, msg) =>
  violations.push(`[${rule}] ${relative(ROOT, file) || file}: ${msg}`)

// ---------- R6 前置：yaml ↔ 目录 一一对应 ----------
const agentIds = parseAgentIds()
if (agentIds.length === 0) {
  console.error('[prompt-lint] config/agents.yaml 未解析到任何 agent id')
  process.exit(1)
}
const dirNames = existsSync(AGENTS_DIR)
  ? readdirSync(AGENTS_DIR).filter((n) => statSync(join(AGENTS_DIR, n)).isDirectory())
  : []

for (const id of agentIds) {
  const dir = join(AGENTS_DIR, id)
  if (!existsSync(dir)) {
    violations.push(`[R6] agents/${id}/: yaml 中声明但目录不存在`)
    continue
  }
  for (const f of ['SOUL.md', 'AGENTS.md']) {
    if (!existsSync(join(dir, f))) {
      violations.push(`[R6] agents/${id}/${f}: yaml 声明的 agent 缺少提示词文件`)
    }
  }
}
for (const name of dirNames) {
  if (name === '_shared') continue
  if (!agentIds.includes(name)) {
    violations.push(`[R6] agents/${name}/: 目录存在但 yaml 未声明`)
  }
}
if (!existsSync(join(AGENTS_DIR, '_shared', 'rules.md'))) {
  violations.push('[R6] agents/_shared/rules.md: 公共规则文件缺失')
}

// ---------- R1/R2：SOUL ≥10 行、AGENTS 非空且无自我复制 ----------
for (const id of agentIds) {
  const soulPath = join(AGENTS_DIR, id, 'SOUL.md')
  if (existsSync(soulPath)) {
    const lines = readFileSync(soulPath, 'utf-8').split('\n').length
    if (lines < 10) fail('R1', soulPath, `SOUL.md 仅 ${lines} 行（要求 ≥10）`)
  }
  const agentsPath = join(AGENTS_DIR, id, 'AGENTS.md')
  if (existsSync(agentsPath)) {
    const content = readFileSync(agentsPath, 'utf-8')
    if (content.trim().length === 0) fail('R2', agentsPath, 'AGENTS.md 为空')
    if (content.includes('Rules relevant to this file:'))
      fail('R2', agentsPath, '包含自我复制标志 "Rules relevant to this file:"')
  }
}

// ---------- R3/R4/R5：全量 .md 内容断言 ----------
const HALLUCINATION_PATTERNS = [
  [/HEARTBEAT/, 'HEARTBEAT（OpenClaw 模板遗留）'],
  [/MEMORY\.md/, 'MEMORY.md（模板 memory 机制，运行时无实现）'],
  [/ElevenLabs/, 'ElevenLabs（TTS 模板遗留）'],
  [/Discord/, 'Discord（群聊模板遗留）'],
  [/WhatsApp/, 'WhatsApp（群聊模板遗留）'],
  [/用\s*exec\s*执行/, '"用 exec 执行"（不存在的 shell 工具）'],
  [/execute_shell_command/, 'execute_shell_command（不存在的工具）'],
  [/grep_search/, 'grep_search（不存在的工具）'],
]
// CLI 风格 `eaa xxx` 引用（运行时工具名为 eaa_xxx 下划线风格）
const CLI_TOOL_RE = /`eaa\s+(add|score|ranking|stats|history|range|summary|search|codes|list-students|add-student|validate|doctor|profile|grades|privacy)\b/
const HARDCODE_PATTERNS = [
  [/邵老师/, '硬编码人名"邵老师"（应使用"教师"）'],
  [/学生总数=52/, '硬编码"学生总数=52"'],
]

for (const file of walkMd(AGENTS_DIR)) {
  const content = readFileSync(file, 'utf-8')
  for (const [re, why] of HALLUCINATION_PATTERNS) {
    if (re.test(content)) fail('R3', file, why)
  }
  if (CLI_TOOL_RE.test(content))
    fail('R4', file, 'CLI 风格工具引用 `eaa xxx`（应为 eaa_xxx 工具名）')
  for (const [re, why] of HARDCODE_PATTERNS) {
    if (re.test(content)) fail('R5', file, why)
  }
}

// ---------- 结果 ----------
if (violations.length > 0) {
  console.error(`\nprompt-lint: ${violations.length} 处违规\n`)
  for (const v of violations) console.error(`  ✗ ${v}`)
  console.error('\n提示：参见 docs/review/03-修改指南.md M9-M11 与 agents/_shared/rules.md 的公共规则约定。')
  process.exit(1)
}

const mdCount = walkMd(AGENTS_DIR).length
console.log(`prompt-lint: 通过（${agentIds.length} 个 agent / ${mdCount} 个 .md 文件 / 6 组规则）`)
