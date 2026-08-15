// =============================================================
// MCP — spawn 辅助: env 构建(PATH 合并) + Windows 命令解析
// 从 mcp-client-pool.ts 拆出。逻辑零修改(逐行对照搬迁)。
// 历史修复标记全部保留: R52(npx ENOENT)。
// =============================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 构建 spawn 子进程的 env,合并常见 Node.js 安装路径到 PATH。
 *
 * R52 修复: sidecar 由 Tauri Rust 启动,用打包的 node.exe,其 PATH 不包含
 * 用户系统的 npm/npx 路径。当 MCP server 配置用 `npx -y @modelcontextprotocol/server-echo`
 * 时,spawn 报 `spawn npx ENOENT`。
 *
 * 策略:在当前 process.env.PATH 基础上追加平台相关的 Node.js 常见安装路径,
 * 仅传给 spawn 的 env,不改全局 process.env.PATH。
 * 合并失败时 graceful:log warn 后返回原始 env,不阻塞 spawn。
 */
export function buildSpawnEnv(serverEnv?: Record<string, string>): Record<string, string> {
  // 从 process.env 浅拷贝(避免全局副作用),再叠加 server 级 env
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...serverEnv }

  try {
    const extraPaths: string[] = []
    const homeDir = os.homedir()
    const platform = process.platform

    if (platform === 'win32') {
      // Windows 常见 Node.js 路径
      // %APPDATA%\npm — npm 全局安装目录(npx.cmd 通常在此)
      const appData = process.env.APPDATA
      if (appData) extraPaths.push(path.join(appData, 'npm'))
      // %ProgramFiles%\nodejs — Node.js 官方安装目录
      const programFiles = process.env.ProgramFiles
      if (programFiles) extraPaths.push(path.join(programFiles, 'nodejs'))
      const programFilesX86 = process.env['ProgramFiles(x86)']
      if (programFilesX86) extraPaths.push(path.join(programFilesX86, 'nodejs'))
      // scoop 安装:~/scoop/apps/nodejs/current/bin 及 ~/scoop/shims
      extraPaths.push(path.join(homeDir, 'scoop', 'apps', 'nodejs', 'current', 'bin'))
      extraPaths.push(path.join(homeDir, 'scoop', 'apps', 'nodejs', 'current'))
      extraPaths.push(path.join(homeDir, 'scoop', 'shims'))
      // nvm-windows:经常安装在 %APPDATA%\nvm\vXX.XX.X
      if (appData) {
        const nvmDir = path.join(appData, 'nvm')
        try {
          // nvm-windows 的 symlink 指向当前版本,直接加 nvm 目录即可
          if (fs.existsSync(nvmDir)) extraPaths.push(nvmDir)
        } catch {
          /* ignore */
        }
      }
      // Volta:~/AppData/Local/Volta/bin
      const localAppData = process.env.LOCALAPPDATA
      if (localAppData) extraPaths.push(path.join(localAppData, 'Volta', 'bin'))
    } else {
      // macOS / Linux 常见 Node.js 路径
      extraPaths.push('/usr/local/bin')
      extraPaths.push('/opt/homebrew/bin')
      extraPaths.push(path.join(homeDir, '.npm-global', 'bin'))
      // nvm:~/.nvm/versions/node/*/bin(取当前激活版本或最新版本)
      const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node')
      try {
        const versions = fs.readdirSync(nvmDir).sort().reverse()
        if (versions.length > 0) {
          // 取排序后最新版本的 bin 目录
          extraPaths.push(path.join(nvmDir, versions[0], 'bin'))
        }
      } catch {
        /* nvm 目录不存在,忽略 */
      }
      // fnm:~/.local/share/fnm/multishells/*/bin 或 ~/.fnm
      extraPaths.push(path.join(homeDir, '.local', 'share', 'fnm'))
      extraPaths.push(path.join(homeDir, '.fnm'))
      // Volta:~/.volta/bin
      extraPaths.push(path.join(homeDir, '.volta', 'bin'))
    }

    // 过滤掉不存在的路径(减少无效 PATH 条目)
    const validPaths = extraPaths.filter((p) => {
      try {
        return fs.existsSync(p)
      } catch {
        return false
      }
    })

    if (validPaths.length > 0) {
      const pathKey = platform === 'win32' ? 'Path' : 'PATH'
      // Windows env 大小写不敏感,但 process.env 中 key 可能是 'Path' 或 'PATH'
      // 优先用已有 key,不存在则用平台默认
      const existingKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || pathKey
      const existingPath = env[existingKey] || ''
      // 追加新路径(放在末尾,不覆盖系统已有路径)
      const separator = platform === 'win32' ? ';' : ':'
      env[existingKey] = existingPath
        ? existingPath + separator + validPaths.join(separator)
        : validPaths.join(separator)
      console.log(
        `[McpService] buildSpawnEnv: appended ${validPaths.length} PATH entries for spawn`,
      )
    }
  } catch (err) {
    // graceful:合并 PATH 失败不阻塞 spawn,log warn 后继续用原始 env
    console.warn('[McpService] buildSpawnEnv: failed to merge PATH, using original env:', err)
  }

  return env
}

/**
 * 解析 spawn 的 command,处理 Windows 上 npx/npm 需要 .cmd/.ps1 后缀的问题。
 *
 * R52 修复: Windows 的 spawn('npx', ...) 报 ENOENT,因为 Windows 上 npx
 * 实际是 npx.cmd 或 npx.ps1(不在 PATHEXT 搜索路径时)。
 * 本方法在 Windows 上对 npx/npm 尝试在 spawnEnv(已含合并后的 PATH)中
 * 找 .cmd/.ps1 后缀的真实可执行路径,
 * 找不到则返回原始 command(保留原 spawn 行为)。
 *
 * @param command 原始 command(如 'npx')
 * @param spawnEnv buildSpawnEnv 构建的 env(已含合并后的 PATH)
 */
export function resolveSpawnCommand(command: string, spawnEnv: Record<string, string>): string {
  // 仅在 Windows 且 command 是裸 npx/npm 时处理
  if (process.platform !== 'win32') return command
  const needsResolve = ['npx', 'npm']
  if (!needsResolve.includes(command.toLowerCase())) return command

  // 从 spawnEnv 中提取 PATH(已经过 buildSpawnEnv 合并)
  const pathKey = Object.keys(spawnEnv).find((k) => k.toLowerCase() === 'path') || 'Path'
  const pathEnv = spawnEnv[pathKey] || ''
  const separator = ';'
  const extensions = ['.cmd', '.ps1']

  // 遍历 PATH 目录寻找 npx.cmd / npm.cmd / npx.ps1 / npm.ps1
  for (const dir of pathEnv.split(separator)) {
    if (!dir) continue
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`)
      try {
        if (fs.existsSync(candidate)) {
          console.log(`[McpService] resolveSpawnCommand: ${command} → ${candidate}`)
          return candidate
        }
      } catch {
        /* ignore */
      }
    }
  }

  // 找不到 .cmd/.ps1,返回原始 command(保留原 spawn 行为,可能仍然 ENOENT)
  console.warn(
    `[McpService] resolveSpawnCommand: could not find ${command}.cmd/.ps1 in PATH, ` +
      `using original command (may still ENOENT)`,
  )
  return command
}
