// =============================================================
// 关掉 dsh 自带工具的 cordis patch
//
// 为什么必须有它：SDK 子进程跑的是 `dsh --profile sdk`
// （packages/sdk/client/src/launch.ts:132,143），其 roster 为
// dsh-base + dsh-sdk-app（packages/boot/app-boot/src/profile.ts:138-146），
// 而 dsh-base 把整套 harness 工具都挂上了：bash/pwsh、read/write/edit、
// glob/grep、job_*、subagent/subagent_fork/list_agents/send_message、workflow、
// todo_write、goal、web_search/web_fetch、exit_plan_mode、mcp 资源读取。
// initialize 只能定 cwd/provider/model/maxTokens，没有任何工具过滤入参。
// 所以「按角色挂一个 MCP 端点」本身不构成最小权限 —— 不关这些行，任何角色的
// dsh 子进程都能直接 shell 到用户机器上。
//
// 为什么 disabled 行有效：patch 层顺序是「bundle → profile 自身 → --patch」，
// 同 id 后写覆盖（packages/boot/app-boot/src/profile.ts:11-13）。目标行不存在
// 只是一条 Loader 警告（同文件 parsePatchList 的注释），所以 dsh 增删工具不会
// 让子进程起不来 —— 降级方向是「少关了一个」，因此这里逐个点名并由测试固定。
//
// 不改 `tools` 行：@deepseek-ai/dsh-tools 就是工具注册表本身
// （packages/bundle/base/cordis.patch.yml:483-486），MCP 工具也要往里注册；
// 它的 run_code 只在 mode: ptc/both 下暴露，缺省 native 不暴露，故无需触碰。
// =============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parse, type ScalarTag, stringify } from 'yaml'

const JS_TAG: ScalarTag = {
  identify: (value: unknown) =>
    Boolean(value && typeof value === 'object' && value !== null && Object.hasOwn(value, '__js')),
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: string) => ({ __js: String(value) }),
}

/** harness 自带、不允许出现在模型可见工具集里的 cordis 行 id */
export const EAA_DISABLED_DSH_ROWS: readonly string[] = [
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  // 0.2.2 起 sdk-app 把定时/追问/交付展示插成模型工具；宿主自有
  // 调度与 UI，不留这些。dsh-schedule 运行时行不关，只关模型侧工具。
  // web 侧预设树里的同名行不受顶层补丁影响，渠道仍保留追问与交付。
  'tool-schedule',
  'tool-ask-user',
  'present',
  'tool-fs',
  'tool-fs-search',
  // 模型可见的 cd。id 为 working-directory 的运行时服务保留。
  'tool-working-directory',
  // tool-skill 保留：它只加载技能正文，不执行命令。目录由每次运行的
  // skill-filesystem 补丁钉死，不扫描用户主目录。
  'tool-todo',
  'tool-goal',
  'tool-web',
  'tool-workflow',
  'tool-ralph',
  'tool-plugin-manager',
  'plan-mode',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'mcp-resources',
]

/**
 * 模型可见、但经审视后**保留**的官方工具行（不关闭）。
 * 与 EAA_DISABLED_DSH_ROWS 一起构成「官方工具行」的完整登记：
 * 守卫测试（dsh-tool-row-audit）对照真实安装包，任何未登记的新行都会变红，
 * 迫使升级时显式决定关或留，而不是静默放行（DSH_CORE_RUNTIME.md §4.3）。
 *
 * - tool-skill：只加载技能正文，不执行命令；目录由每次运行的
 *   skill-filesystem 补丁钉死，不扫描用户主目录。
 */
export const EAA_REVIEWED_TOOL_ROWS: readonly string[] = ['tool-skill']

/**
 * 名字带 dsh-tool- 前缀、但属于**工具基础设施**而非模型可见工具的行。
 * 它们不直接给模型能力，守卫测试单独登记、不与模型工具混为一谈：
 * - tool-executor-native：工具执行器，MCP 桥的硬依赖，关了教育工具也调不起来。
 * - tool-executor-ptc：PTC 执行器，官方默认 disabled（run_code 仅 ptc/both 模式）。
 * - timeout-policy：工具调用超时策略。
 * - workspace-dependencies：工作区依赖解析（非 primary runtime 时官方自行 disabled）。
 */
export const EAA_TOOL_INFRA_ROWS: readonly string[] = [
  'tool-executor-native',
  'tool-executor-ptc',
  'timeout-policy',
  'workspace-dependencies',
]

export const EAA_HARDENING_PATCH_FILE = 'eaa-harness-tools-off.cordis.patch.yml'

/** patch 顶层数组的行（PatchOptions：id / config / disabled / insert） */
export type EaaCordisPatchRow = Record<string, unknown>

function configOf(node: unknown, id: string): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = configOf(item, id)
      if (found) return found
    }
    return undefined
  }
  const rec = node as { id?: unknown; config?: unknown; insert?: unknown }
  if (rec.id === id && rec.config && typeof rec.config === 'object' && !Array.isArray(rec.config)) {
    return { ...(rec.config as Record<string, unknown>) }
  }
  if (rec.insert) return configOf(rec.insert, id)
  if (rec.config && typeof rec.config === 'object') {
    const nested = (rec.config as { plugins?: unknown }).plugins
    if (nested) return configOf(nested, id)
  }
  return undefined
}

/** 从已安装包的 cordis.patch.yml 取出某一行的 config。读不到就当没有。 */
export function readInstalledRowConfig(
  dshBin: string | undefined,
  packageName: string,
  rowId: string,
): Record<string, unknown> | undefined {
  if (!dshBin) return undefined
  try {
    const req = createRequire(dshBin)
    const manifest = req.resolve(`${packageName}/package.json`)
    const text = readFileSync(join(dirname(manifest), 'cordis.patch.yml'), 'utf8')
    return configOf(parse(text, { customTags: [JS_TAG], version: '1.1' }), rowId)
  } catch {
    return undefined
  }
}

export function eaaHardeningPatchRows(installed?: Record<string, unknown>): EaaCordisPatchRow[] {
  return [
    ...EAA_DISABLED_DSH_ROWS.map((id): EaaCordisPatchRow => ({ id, disabled: true })),
    {
      // 后写的 config 会换掉整行。先留下已安装的字段，再关掉 harness 自己的身份。
      // includeRuntimeContext 省略即取默认 true。
      id: 'system-prompt',
      config: {
        ...(installed ?? {}),
        includeHarnessIdentity: false,
        personaPrefix: '',
        personaSuffix: '',
      },
    },
  ]
}

export function buildEaaHardeningPatch(installed?: Record<string, unknown>): string {
  return stringify(eaaHardeningPatchRows(installed), { lineWidth: 0 })
}

/**
 * 落盘并返回路径。同步写：这份 patch 不含密钥、常驻 userData，且 createDshRuntime
 * 是同步入口（三处调用点都在异步流程里，但为了少一层 await 保持同步）。
 * 内容一致时不重写，避免每次起子进程都碰盘。
 */
export function ensureEaaHardeningPatch(patchDir: string, dshBin?: string): string {
  const patchPath = join(patchDir, EAA_HARDENING_PATCH_FILE)
  const installed = readInstalledRowConfig(dshBin, '@deepseek-ai/dsh-base', 'system-prompt')
  const text = buildEaaHardeningPatch(installed)
  let current: string | null = null
  try {
    current = readFileSync(patchPath, 'utf8')
  } catch {
    current = null
  }
  if (current !== text) writeFileSync(patchPath, text, 'utf8')
  return patchPath
}
