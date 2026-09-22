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
import { join } from 'node:path'
import { stringify } from 'yaml'

/** harness 自带、不允许出现在模型可见工具集里的 cordis 行 id */
export const EAA_DISABLED_DSH_ROWS: readonly string[] = [
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  'tool-fs',
  'tool-fs-search',
  'tool-skill',
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

export const EAA_HARDENING_PATCH_FILE = 'eaa-harness-tools-off.cordis.patch.yml'

/** patch 顶层数组的行（PatchOptions：id / config / disabled / insert） */
export type EaaCordisPatchRow = Record<string, unknown>

export function eaaHardeningPatchRows(): EaaCordisPatchRow[] {
  return [
    ...EAA_DISABLED_DSH_ROWS.map((id): EaaCordisPatchRow => ({ id, disabled: true })),
    {
      // patch 覆盖整行 config（不是合并），所以这里给出完整的三项；
      // includeRuntimeContext 省略即取默认 true（cwd/平台等运行环境快照保留）。
      id: 'system-prompt',
      config: {
        includeHarnessIdentity: false,
        personaPrefix: '',
        personaSuffix: '',
      },
    },
  ]
}

export function buildEaaHardeningPatch(): string {
  return stringify(eaaHardeningPatchRows(), { lineWidth: 0 })
}

/**
 * 落盘并返回路径。同步写：这份 patch 不含密钥、常驻 userData，且 createDshRuntime
 * 是同步入口（三处调用点都在异步流程里，但为了少一层 await 保持同步）。
 * 内容一致时不重写，避免每次起子进程都碰盘。
 */
export function ensureEaaHardeningPatch(patchDir: string): string {
  const patchPath = join(patchDir, EAA_HARDENING_PATCH_FILE)
  const text = buildEaaHardeningPatch()
  let current: string | null = null
  try {
    current = readFileSync(patchPath, 'utf8')
  } catch {
    current = null
  }
  if (current !== text) writeFileSync(patchPath, text, 'utf8')
  return patchPath
}
