// =============================================================
// Update Service — 自动更新:检查 + 下载 + 安装 (M31)
// 检查层: GitHub Releases API + 自研 semver 比对 (保留原有逻辑,
//         renderer 侧 check-update IPC 交互不变)
// 下载/安装层: electron-updater (替换自研,差量/回滚/签名校验/代理均内置)
//   - latest.yml 的 sha512 校验由 electron-updater 默认启用(硬性安全要求,
//     校验失败会 reject 并拒绝触发 update-downloaded,不得禁用)
//   - 进度/完成/错误经 progressListener 推送 → sys:update-progress IPC
//   - portable 版(electron-builder portable 目标)不支持自动安装,提示手动替换
// =============================================================

import https from 'node:https'
import { app, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { settingsService } from './settings-service'

interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseNotes: string
  publishedAt: string
  platform: string
  arch: string
  enabled: boolean
  message: string
  /** portable 版不支持自动安装,renderer 据此显示"手动替换"提示 */
  portable: boolean
}

/** 更新下载进度载荷 (主→渲染,经 sys:update-progress 推送) */
export interface UpdateProgress {
  status: 'downloading' | 'downloaded' | 'error'
  /** 下载百分比 0-100 (downloaded 恒为 100) */
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
  version: string
  message: string
}

/**
 * 简单 semver 比较: 返回 1 (a>b), -1 (a<b), 0 (a==b)
 * 支持基础 pre-release 版本号比较 (如 1.0.0-beta.1):
 * - 无 pre-release 的版本 > 有 pre-release 的版本 (1.0.0 > 1.0.0-beta.1)
 * - pre-release 标识按字母数字顺序逐段比较 (按 . 分段)
 * - 纯数字段按数值比较,非数字段按字符串比较;数字段优先级低于非数字段
 */
export function compareSemver(a: string, b: string): number {
  // 移除 v 前缀,按首个 '-' 分离主版本号与 pre-release 标识
  const cleanA = a.replace(/^v/, '')
  const cleanB = b.replace(/^v/, '')
  const dashA = cleanA.indexOf('-')
  const dashB = cleanB.indexOf('-')
  const mainA = dashA === -1 ? cleanA : cleanA.slice(0, dashA)
  const mainB = dashB === -1 ? cleanB : cleanB.slice(0, dashB)
  const preA = dashA === -1 ? '' : cleanA.slice(dashA + 1)
  const preB = dashB === -1 ? '' : cleanB.slice(dashB + 1)

  // 先比较主版本号 (major.minor.patch)
  const pa = mainA.split('.').map(Number)
  const pb = mainB.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }

  // 主版本号相同,比较 pre-release
  // 无 pre-release 的版本 > 有 pre-release 的版本 (如 1.0.0 > 1.0.0-beta.1)
  if (!preA && !preB) return 0
  if (!preA) return 1
  if (!preB) return -1

  // 两者都有 pre-release,按 . 分段逐段比较 (字母数字顺序)
  const prePartsA = preA.split('.')
  const prePartsB = preB.split('.')
  const len = Math.max(prePartsA.length, prePartsB.length)
  for (let i = 0; i < len; i++) {
    const partA = prePartsA[i] ?? ''
    const partB = prePartsB[i] ?? ''
    // semver 规范: 若所有前置段都相等,则 pre-release 字段更多的版本优先级更高。
    // 例: 1.0.0-beta.1 > 1.0.0-beta
    if (partA === '' && partB !== '') return -1
    if (partB === '' && partA !== '') return 1
    if (partA === partB) continue

    const numA = Number(partA)
    const numB = Number(partB)
    const isNumA = partA !== '' && !Number.isNaN(numA)
    const isNumB = partB !== '' && !Number.isNaN(numB)

    // 纯数字段优先级低于非数字段 (semver 规范)
    if (isNumA && !isNumB) return -1
    if (!isNumA && isNumB) return 1
    if (isNumA && isNumB) {
      return numA > numB ? 1 : numA < numB ? -1 : 0
    }
    // 都是非数字段,按字符串比较
    return partA > partB ? 1 : -1
  }
  return 0
}

/** 从 GitHub Releases API 获取最新版本信息 */
function fetchLatestRelease(repoUrl: string): Promise<{
  tag_name: string
  html_url: string
  body: string
  published_at: string
}> {
  return new Promise((resolve, reject) => {
    // M-2 修复: settled flag 防止 timeout 后 req.destroy() 触发 error 事件导致双重 reject
    let settled = false
    const safeResolve = (v: {
      tag_name: string
      html_url: string
      body: string
      published_at: string
    }) => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    const safeReject = (e: Error) => {
      if (!settled) {
        settled = true
        reject(e)
      }
    }

    // 从 repo URL 提取 owner/repo
    // 支持格式: https://github.com/owner/repo 或 owner/repo
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) {
      safeReject(new Error(`Invalid GitHub repo URL: ${repoUrl}`))
      return
    }
    const [, owner, repo] = match
    const cleanRepo = repo.replace(/\.git$/, '')
    // L-1 修复: 验证 owner/repo 只含合法字符(字母数字/连字符/下划线/点),防止 URL 注入
    if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(cleanRepo)) {
      safeReject(new Error(`Invalid GitHub owner/repo in URL: ${repoUrl}`))
      return
    }
    const apiUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/releases/latest`

    // 保存 res 引用,以便在超时时清理响应流,防止资源泄漏
    let res: import('node:http').IncomingMessage | null = null
    const req = https.get(
      apiUrl,
      {
        headers: {
          'User-Agent': `AI-Workstation/${app.getVersion()}`,
          Accept: 'application/vnd.github.v3+json',
        },
        timeout: 10_000,
      },
      (response) => {
        res = response
        if (res.statusCode !== 200) {
          safeReject(new Error(`GitHub API returned ${res.statusCode}`))
          res.resume()
          return
        }
        let data = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            safeResolve(JSON.parse(data))
          } catch (err) {
            safeReject(new Error(`Failed to parse GitHub API response: ${err}`))
          }
        })
      },
    )
    req.on('error', (err) => safeReject(err))
    req.on('timeout', () => {
      // 超时时同时清理响应流和请求,防止资源泄漏
      res?.destroy()
      req.destroy()
      safeReject(new Error('Request timed out'))
    })
  })
}

class UpdateService {
  private lastCheck: UpdateInfo | null = null
  private updateUrl: string = ''
  private progressListener: ((p: UpdateProgress) => void) | null = null
  /** electron-updater 事件是否已接线 (仅接线一次,避免重复监听) */
  private wired = false

  /** 设置 GitHub 仓库 URL */
  setRepoUrl(url: string): void {
    this.updateUrl = url
  }

  /** 注册进度监听 (sys-handlers 调用,转发到 win.webContents.send) */
  setProgressListener(cb: (p: UpdateProgress) => void): void {
    this.progressListener = cb
  }

  /**
   * 是否为 portable 版:electron-builder portable 目标运行时注入
   * PORTABLE_EXECUTABLE_DIR 环境变量;未打包的 dev 模式同样不支持自动安装
   */
  isPortable(): boolean {
    if (!app.isPackaged) return true
    return Boolean(process.env.PORTABLE_EXECUTABLE_DIR)
  }

  /** 检查更新 */
  async checkForUpdates(): Promise<UpdateInfo> {
    const currentVersion = app.getVersion()
    const baseInfo = {
      currentVersion,
      platform: process.platform,
      arch: process.arch,
    }

    // 读取设置中的更新 URL
    let repoUrl = this.updateUrl
    if (!repoUrl) {
      try {
        const s = settingsService.getSettings() as { general?: { updateUrl?: string } }
        repoUrl = s.general?.updateUrl ?? ''
      } catch {
        /* ignore */
      }
    }

    if (!repoUrl) {
      const info: UpdateInfo = {
        ...baseInfo,
        hasUpdate: false,
        latestVersion: currentVersion,
        releaseUrl: '',
        releaseNotes: '',
        publishedAt: '',
        enabled: false,
        message: '未配置更新源 (updateUrl)，请在设置中填写 GitHub 仓库地址',
        portable: this.isPortable(),
      }
      this.lastCheck = info
      return info
    }

    try {
      const release = await fetchLatestRelease(repoUrl)
      const latestVersion = release.tag_name.replace(/^v/, '')
      const hasUpdate = compareSemver(latestVersion, currentVersion) > 0

      const info: UpdateInfo = {
        ...baseInfo,
        hasUpdate,
        latestVersion,
        releaseUrl: release.html_url,
        releaseNotes: (release.body ?? '').slice(0, 500),
        publishedAt: release.published_at,
        enabled: true,
        message: hasUpdate ? `发现新版本 v${latestVersion}` : `当前已是最新版本 v${currentVersion}`,
        portable: this.isPortable(),
      }
      this.lastCheck = info
      return info
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const info: UpdateInfo = {
        ...baseInfo,
        hasUpdate: false,
        latestVersion: currentVersion,
        releaseUrl: '',
        releaseNotes: '',
        publishedAt: '',
        enabled: true,
        message: `检查更新失败: ${msg}`,
        portable: this.isPortable(),
      }
      this.lastCheck = info
      return info
    }
  }

  /** 获取上次检查结果 */
  getLastCheck(): UpdateInfo | null {
    return this.lastCheck
  }

  /** 弹出更新对话框（如果有更新） */
  async showUpdateDialog(): Promise<void> {
    const info = this.lastCheck ?? (await this.checkForUpdates())
    if (!info.hasUpdate) {
      dialog.showMessageBox({
        type: 'info',
        title: '检查更新',
        message: info.message,
        buttons: ['确定'],
      })
      return
    }

    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 v${info.latestVersion}\n\n${info.releaseNotes || '请前往 GitHub 查看更新内容'}`,
      buttons: ['前往下载', '稍后提醒'],
      defaultId: 0,
      cancelId: 1,
    })

    if (response === 0 && info.releaseUrl) {
      await shell.openExternal(info.releaseUrl)
    }
  }

  // ===== 下载 & 安装层 (M31, electron-updater) =====

  /** 推送进度到渲染进程 (监听器异常不中断更新流程) */
  private emitProgress(p: UpdateProgress): void {
    try {
      this.progressListener?.(p)
    } catch {
      /* ignore */
    }
  }

  /** 接线 electron-updater 事件 → progressListener (仅接线一次) */
  private ensureWired(): void {
    if (this.wired) return
    this.wired = true
    autoUpdater.on('download-progress', (info) => {
      this.emitProgress({
        status: 'downloading',
        percent: info.percent,
        transferred: info.transferred,
        total: info.total,
        bytesPerSecond: info.bytesPerSecond,
        version: '',
        message: '',
      })
    })
    // 下载完成事件仅在安装包 sha512 校验通过后才会触发
    autoUpdater.on('update-downloaded', (info) => {
      this.emitProgress({
        status: 'downloaded',
        percent: 100,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0,
        version: info?.version ?? '',
        message: '',
      })
    })
    autoUpdater.on('error', (err) => {
      this.emitProgress({
        status: 'error',
        percent: 0,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0,
        version: '',
        message: err instanceof Error ? err.message : String(err),
      })
    })
  }

  /** 从仓库 URL 配置 electron-updater feed (GitHub provider) */
  private configureFeed(repoUrl: string): boolean {
    // 与 fetchLatestRelease 相同的 owner/repo 提取与校验,防 URL 注入
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) return false
    const [, owner, repo] = match
    const cleanRepo = repo.replace(/\.git$/, '')
    if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(cleanRepo)) {
      return false
    }
    autoUpdater.setFeedURL({ provider: 'github', owner, repo })
    return true
  }

  /**
   * 下载更新 (electron-updater,内置 latest.yml sha512 校验)
   * 仅打包后的 NSIS 安装版支持;portable/dev 模式返回错误提示手动更新
   */
  async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    if (this.isPortable()) {
      return { success: false, error: '便携版或开发模式不支持自动下载,请前往 GitHub 手动下载' }
    }
    let repoUrl = this.updateUrl
    if (!repoUrl) {
      try {
        const s = settingsService.getSettings() as { general?: { updateUrl?: string } }
        repoUrl = s.general?.updateUrl ?? ''
      } catch {
        /* ignore */
      }
    }
    if (!repoUrl) {
      return { success: false, error: '未配置更新源 (updateUrl)' }
    }
    if (!this.configureFeed(repoUrl)) {
      return { success: false, error: `Invalid GitHub repo URL: ${repoUrl}` }
    }
    this.ensureWired()
    // 手动下载:checkForUpdates 发现新版本后不自动下载,由用户点击"下载并安装"
    autoUpdater.autoDownload = false
    // 下载完成后即使未点"重启安装",退出应用时也自动装上(提高安全修复到达率)
    autoUpdater.autoInstallOnAppQuit = true
    try {
      // downloadUpdate 前必须先 checkForUpdates 填充 updateInfoAndProvider
      // (否则 electron-updater 抛 "Please check update first");
      // sha512 校验失败会 reject,不会触发 update-downloaded
      await autoUpdater.checkForUpdates()
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  /** 重启并安装已下载的更新 (仅 NSIS 安装版;portable 返回 portable 标记) */
  async installUpdate(): Promise<{ success: boolean; portable: boolean; error?: string }> {
    if (this.isPortable()) {
      return { success: false, portable: true, error: '便携版请手动下载替换文件更新' }
    }
    try {
      autoUpdater.quitAndInstall()
      return { success: true, portable: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, portable: false, error: msg }
    }
  }
}

export const updateService = new UpdateService()
