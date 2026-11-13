// =============================================================
// 从 `dsh web` 启动日志里取出带进程 token 的根 URL。
//
// 0.2.2-rc.1 的 web-app 在 Loader 就绪后打印一行：
//   dsh web: http://127.0.0.1:<port>/?token=...
//   dsh web: http://127.0.0.1:<port>/?token=... (LAN: http://...)
// 连接中心的 iframe 必须打开这一行，裸端口没有签名 cookie。
// =============================================================

/** 随仓库带上的 @xmanrui/dsh-im 版本。升级插件时改这里，宿主会重装。 */
export const DSH_IM_VERSION = '5.10.0'

const ANNOUNCEMENT = /dsh web: (https?:\/\/\S+)/

export function parseDshWebAnnouncement(text: string): string | null {
  const match = ANNOUNCEMENT.exec(text)
  return match?.[1] ?? null
}

/** pnpm `link:` 说明符。Windows 反斜杠会被当成转义，统一改成正斜杠。 */
export function dshPluginLinkSpec(dir: string): string {
  return `link:${dir.replace(/\\/g, '/')}`
}

/**
 * `dsh web` 的启动参数。每个 `--patch` 都必须写在 `--host` 前面：
 * 第一个 dsh 不认识的参数会整段交给 web 应用，写反了补丁不会生效。
 * 顺序与教师对话一致：加固、模型路由、教育工具挂载。
 */
export function dshWebLaunchArgs(patches: readonly string[]): string[] {
  const args = ['web']
  for (const patch of patches) {
    if (!patch) continue
    args.push('--patch', patch)
  }
  args.push('--host', '127.0.0.1', '--port', '0', '--no-open')
  return args
}
