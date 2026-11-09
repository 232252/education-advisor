// =============================================================
// 连接中心的 dsh-im 宿主
//
// dsh-im 的管理面板是 DSH 客户端插件（dshImClient.render），
// 不能拆进教育参谋自己的 React 树。这里按官方接入方式做：
//   1. 把 vendor/dsh-im 和 integrations/eaa-panel 用 link: 装进 web profile
//   2. 起 `dsh web --no-open`，带上加固补丁，以及调用方准备的模型密钥和教育工具
//   3. 主进程把这个地址贴到连接中心的子视图上，侧栏直接停在 IM 面板
//
// SDK 子进程仍走单独的 userData 工作目录；这个 Web 宿主用自己的 DSH_HOME，
// 避免插件安装写进教师机器上已有的 ~/.dsh。
// =============================================================

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureEaaHardeningPatch } from './hardening'
import { ensureOfficialPresetLock } from './im-preset'
import {
  DSH_IM_VERSION,
  dshPluginLinkSpec,
  dshPnpmLaunch,
  dshWebLaunchArgs,
  parseDshWebAnnouncement,
  pnpmInstallRegistry,
} from './im-url'
import { ensureProfileHasEaaTools } from './plugin-install'
import { dshChildEnv } from './pnpm-env'
import { ensureEaaWelcomeNoticePatch } from './welcome-notice'

export const DSH_IM_STAMP = 'eaa-dsh-im.stamp'
/** 改面板插件时bump，已有 DSH_HOME 会重装。 */
export const DSH_IM_INSTALL_STAMP = `${DSH_IM_VERSION}+panel1`
const WEB_URL_TIMEOUT_MS = 120_000
/** 回退安装的上限：依赖已随包分发，回退只在安装包损坏时触发，快速失败比干等好。 */
const DEPS_INSTALL_TIMEOUT_MS = 3 * 60_000

/**
 * 连接中心启动各阶段的进度。依赖已随包分发（afterPack 把 vendor/dsh-im 的
 * node_modules 补进 resources/dsh-im），正常首开直接命中标记、不联网；只有
 * 安装包损坏才走在线回退 —— 进度事件保证回退期间面板有状态而不是干等。
 */
export interface DshImBootProgress {
  phase: 'deps' | 'plugins' | 'web'
  /** 面板可直接展示的一行状态（pnpm 输出行或阶段描述）。 */
  message: string
}

export interface DshImOpenResult {
  ok: boolean
  url?: string
  error?: string
}

export interface DshImLaunchPrep {
  patches: string[]
  env: Record<string, string>
  instructions: string
  /** 这次准备的教育技能目录。官方预设的 skill-filesystem 也钉在这里。 */
  skillDir?: string
}

export interface DshImWebHostOptions {
  home: string
  dshBin: string
  imDir: string
  /** vendor/eaa-tools，用 link: 装进 web profile。 */
  toolsDir: string
  execPath: string
  electronAsNode: boolean
  env?: NodeJS.ProcessEnv
  /** 按需组件目录（office-kit）：web 子进程经 NODE_PATH 解析 libreoffice-kit。 */
  extraModulesDir?: string
  /** 在 dsh web 起来之前准备模型密钥、教育工具和 AGENTS.md。 */
  prepareLaunch?: (patchDir: string) => Promise<DshImLaunchPrep>
  /** 进程退出时撤掉教育工具端点。重复调用应当无事发生。 */
  releaseLaunch?: () => Promise<void>
  /** 启动阶段进度（依赖下载/插件安装/web 起动），面板据此显示状态。 */
  onProgress?: (progress: DshImBootProgress) => void
}

export class DshImWebHost {
  private child: ChildProcess | null = null
  private url: string | null = null
  private pending: Promise<DshImOpenResult> | null = null
  private launchEnv: Record<string, string> = {}

  constructor(private readonly opts: DshImWebHostOptions) {}

  async open(): Promise<DshImOpenResult> {
    if (this.url) return { ok: true, url: this.url }
    if (!this.pending) {
      this.pending = this.boot().finally(() => {
        this.pending = null
      })
    }
    return this.pending
  }

  /**
   * 只装依赖、不起 web：应用启动后闲时调一次，教师点开连接中心时
   * ensurePluginDeps 已命中幂等标记，首开不再卡下载。
   */
  async prewarmDeps(): Promise<void> {
    try {
      await this.ensurePluginDeps()
    } catch (err) {
      console.warn('[dsh-im] 预热依赖失败（打开连接中心时会重试）:', err)
    }
  }

  stop(): void {
    const child = this.child
    this.child = null
    this.url = null
    this.launchEnv = {}
    if (child) child.kill()
    void this.opts.releaseLaunch?.()
  }

  private async boot(): Promise<DshImOpenResult> {
    if (!this.opts.dshBin || !existsSync(this.opts.dshBin)) {
      return { ok: false, error: '还没有可用的 dsh 可执行文件（0.2.2-rc.1 依赖尚未装完）' }
    }
    if (!existsSync(join(this.opts.imDir, 'package.json'))) {
      return { ok: false, error: `找不到 dsh-im 插件目录：${this.opts.imDir}` }
    }
    const panelDir = join(this.opts.imDir, 'integrations', 'eaa-panel')
    if (!existsSync(join(panelDir, 'package.json'))) {
      return { ok: false, error: `找不到 IM 侧栏插件：${panelDir}` }
    }
    mkdirSync(this.opts.home, { recursive: true })
    try {
      await this.ensurePluginDeps()
      await this.ensurePlugins(panelDir)
      await this.ensureEducationPlugin()
      const patchDir = join(this.opts.home, 'patches')
      mkdirSync(patchDir, { recursive: true })
      const hardening = ensureEaaHardeningPatch(patchDir)
      const welcome = ensureEaaWelcomeNoticePatch(patchDir)
      const prepared = await this.opts.prepareLaunch?.(patchDir)
      this.launchEnv = prepared?.env ?? {}
      if (prepared?.instructions.trim()) {
        writeFileSync(join(this.opts.home, 'AGENTS.md'), prepared.instructions, 'utf8')
      }
      const presetLock = ensureOfficialPresetLock(patchDir, this.opts.dshBin, prepared?.skillDir)
      const url = await this.startWeb([
        hardening,
        welcome,
        ...(prepared?.patches ?? []),
        ...(presetLock ? [presetLock] : []),
      ])
      return { ok: true, url }
    } catch (err) {
      await this.opts.releaseLaunch?.()
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  }

  /**
   * link: 不会顺带装插件自己的依赖。依赖已随包分发，qrcode 标记在位时直接
   * 返回（离线首开的正路）；标记缺失说明安装包损坏，走在线回退
   * （--prefer-offline：本地 store 有就不用联网），镜像源失败退回默认源。
   * 两头都失败时指向重装应用 —— 这个分支不该在正常安装里出现。
   */
  private async ensurePluginDeps(): Promise<void> {
    if (existsSync(join(this.opts.imDir, 'node_modules', 'qrcode', 'package.json'))) return
    const base = ['install', '--prod', '--ignore-scripts', '--prefer-offline']
    const registry = pnpmInstallRegistry(this.opts.env ?? process.env)
    try {
      if (registry) {
        await this.withProgress(
          { phase: 'deps', message: `正在修复连接中心组件（镜像源 ${new URL(registry).host}）` },
          (report) => this.runPnpm([...base, '--registry', registry], this.opts.imDir, report),
        )
      } else {
        await this.withProgress({ phase: 'deps', message: '正在修复连接中心组件' }, (report) =>
          this.runPnpm(base, this.opts.imDir, report),
        )
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      const fail = (): never => {
        throw new Error(
          `连接中心组件缺失且在线修复失败（${reason}）。请重新安装应用以恢复随包组件。`,
        )
      }
      if (!registry) fail()
      // 镜像源失败（学校防火墙/镜像同步缺包）→ 退回默认源再试一次
      try {
        await this.withProgress(
          { phase: 'deps', message: '镜像源失败，改用默认源重试…' },
          (report) => this.runPnpm(base, this.opts.imDir, report),
        )
      } catch {
        fail()
      }
    }
  }

  /** 包一层：进度事件 + 依赖安装超时（pnpm 挂起时别永远「正在打开」）。 */
  private withProgress(
    start: DshImBootProgress,
    run: (report: (line: string) => void) => Promise<void>,
  ): Promise<void> {
    this.opts.onProgress?.(start)
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`组件安装超时（${DEPS_INSTALL_TIMEOUT_MS / 60_000} 分钟）`)),
        DEPS_INSTALL_TIMEOUT_MS,
      )
      const settle = (err?: unknown) => {
        clearTimeout(timer)
        if (err) reject(err)
        else resolve()
      }
      const report = (line: string) => {
        const text = line.trim()
        if (text) this.opts.onProgress?.({ phase: start.phase, message: text })
      }
      run(report).then(
        () => settle(),
        (err: unknown) => settle(err),
      )
    })
  }

  private async ensurePlugins(panelDir: string): Promise<void> {
    const stampPath = join(this.opts.home, DSH_IM_STAMP)
    if (existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === DSH_IM_INSTALL_STAMP)
      return
    this.opts.onProgress?.({ phase: 'plugins', message: '正在把连接中心装进 dsh…' })
    await this.run(['plugin', '--profile', 'web', 'add', dshPluginLinkSpec(this.opts.imDir)])
    await this.run(['plugin', '--profile', 'web', 'add', dshPluginLinkSpec(panelDir)])
    writeFileSync(stampPath, `${DSH_IM_INSTALL_STAMP}\n`, 'utf8')
  }

  private async ensureEducationPlugin(): Promise<void> {
    await ensureProfileHasEaaTools({
      home: this.opts.home,
      profile: 'web',
      toolsDir: this.opts.toolsDir,
      dshBin: this.opts.dshBin,
      execPath: this.opts.execPath,
      electronAsNode: this.opts.electronAsNode,
      env: this.opts.env,
    })
  }

  private startWeb(patches: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      this.opts.onProgress?.({ phase: 'web', message: '正在启动连接中心…' })
      const child = spawn(this.opts.execPath, [this.opts.dshBin, ...dshWebLaunchArgs(patches)], {
        cwd: this.opts.home,
        env: this.childEnv(),
        windowsHide: true,
      })
      this.child = child
      let buffer = ''
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }
      const timer = setTimeout(() => {
        finish(() => {
          this.stop()
          reject(new Error('dsh web 在 120 秒内没有打印访问地址'))
        })
      }, WEB_URL_TIMEOUT_MS)
      const onChunk = (chunk: string) => {
        buffer += chunk
        const url = parseDshWebAnnouncement(buffer)
        if (!url) return
        this.url = url
        finish(() => resolve(url))
      }
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', onChunk)
      child.stderr?.on('data', onChunk)
      child.once('error', (err) => {
        finish(() => reject(err))
      })
      child.once('exit', (code) => {
        if (this.child === child) {
          this.child = null
          this.url = null
        }
        const detail = buffer.trim().slice(-800)
        if (code && code !== 0) {
          console.error(
            `[dsh-im] ${this.opts.execPath} exited ${code}${detail ? `: ${detail}` : ''}`,
          )
        }
        finish(() =>
          reject(
            new Error(
              `dsh web 在打印地址前退出，code=${code ?? 'null'}${detail ? `: ${detail}` : ''}`,
            ),
          ),
        )
      })
    })
  }

  private runPnpm(args: string[], cwd: string, onLine?: (line: string) => void): Promise<void> {
    const launch = dshPnpmLaunch(this.opts.dshBin, this.opts.execPath)
    return new Promise((resolve, reject) => {
      const child = spawn(launch.command, [...launch.prefix, ...args], {
        cwd,
        env: this.childEnv(),
        windowsHide: true,
        shell: launch.shell,
      })
      let stderr = ''
      let stdoutLine = ''
      child.stderr?.setEncoding('utf8')
      child.stdout?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-4000)
      })
      // pnpm 非交互模式下按行打进度（Packages: +qrcode@… / Progress: …）
      child.stdout?.on('data', (chunk: string) => {
        stdoutLine += chunk
        const lines = stdoutLine.split(/\r?\n/)
        stdoutLine = lines.pop() ?? ''
        for (const line of lines) onLine?.(line)
      })
      child.once('error', (err: NodeJS.ErrnoException) => {
        reject(
          err.code === 'ENOENT' ? new Error('找不到 pnpm，连接中心无法安装 dsh-im 的依赖') : err,
        )
      })
      child.once('exit', (code) => {
        if (stdoutLine.trim()) onLine?.(stdoutLine)
        if (code === 0) resolve()
        else
          reject(
            new Error(
              `pnpm ${args.join(' ')} 退出码 ${code ?? 'null'}${stderr ? `: ${stderr}` : ''}`,
            ),
          )
      })
    })
  }

  private run(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.execPath, [this.opts.dshBin, ...args], {
        env: this.childEnv(),
        windowsHide: true,
      })
      let stderr = ''
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-4000)
      })
      child.once('error', reject)
      child.once('exit', (code) => {
        if (code === 0) resolve()
        else
          reject(
            new Error(
              `dsh ${args.join(' ')} 退出码 ${code ?? 'null'}${stderr ? `: ${stderr}` : ''}`,
            ),
          )
      })
    })
  }

  private childEnv(): NodeJS.ProcessEnv {
    // launchEnv（模型密钥、教育工具端点）叠在宿主环境上，再交给公共构造：
    // DSH_HOME / ELECTRON_RUN_AS_NODE / 把随包 pnpm 前置进 PATH。
    return dshChildEnv({
      home: this.opts.home,
      dshBin: this.opts.dshBin,
      execPath: this.opts.execPath,
      electronAsNode: this.opts.electronAsNode,
      env: { ...(this.opts.env ?? process.env), ...this.launchEnv },
      extraModulesDir: this.opts.extraModulesDir,
    })
  }
}
