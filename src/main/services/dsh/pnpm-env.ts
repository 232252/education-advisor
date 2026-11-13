// =============================================================
// dsh 子进程的公共环境
//
// 教师机不带 pnpm、不现场执行 dsh plugin add（DSH_CORE_RUNTIME.md §3.4）：
// 连接中心依赖随包分发，缺失即要求重装。历史上为「首开在线装依赖」准备的
// @pnpm/exe 解析与垫片生成已删除，这里只保留子进程环境组装。
// =============================================================

import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

/** 目录前置进 PATH（Windows 的 env 大小写两种键名都写）。 */
export function prependPath(env: NodeJS.ProcessEnv, dir: string): void {
  const current = env.PATH ?? env.Path ?? ''
  const next = current ? `${dir}${delimiter}${current}` : dir
  env.PATH = next
  env.Path = next
}

export interface DshChildEnvOptions {
  home: string
  dshBin: string
  execPath: string
  electronAsNode: boolean
  env?: NodeJS.ProcessEnv
  /**
   * 按需组件目录（office-kit-service 的 extraModulesDir）—— 追加进
   * NODE_PATH，让 dsh web 子进程也能解析被移出安装包的 libreoffice-kit。
   */
  extraModulesDir?: string
}

/**
 * dsh web 子进程的公共环境：DSH_HOME、ELECTRON_RUN_AS_NODE、可选 NODE_PATH。
 * 教师包不含 pnpm，连接中心也不再调用它，所以不把 @pnpm/exe 或垫片放进 PATH。
 * 开发态仓库的 node_modules/.bin 仍前置，方便 dsh 找到同仓库里的其它命令。
 */
export function dshChildEnv(opts: DshChildEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), DSH_HOME: opts.home }
  if (opts.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1'
  if (opts.extraModulesDir) {
    env.NODE_PATH = env.NODE_PATH
      ? `${env.NODE_PATH}${delimiter}${opts.extraModulesDir}`
      : opts.extraModulesDir
  }
  const binDir = join(dirname(opts.dshBin || ''), '..', '..', '..', '.bin')
  if (opts.dshBin && existsSync(binDir)) prependPath(env, binDir)
  return env
}
