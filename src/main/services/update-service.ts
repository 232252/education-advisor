// =============================================================
// Update Service — 轻量级自动更新检查
// 使用 Node 内置 https 模块检查 GitHub Releases API
// 无需安装 electron-updater
// =============================================================

import https from 'node:https'
import { app, dialog, shell } from 'electron'
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
}

/**
 * 简单 semver 比较: 返回 1 (a>b), -1 (a<b), 0 (a==b)
 * 支持基础 pre-release 版本号比较 (如 1.0.0-beta.1):
 * - 无 pre-release 的版本 > 有 pre-release 的版本 (1.0.0 > 1.0.0-beta.1)
 * - pre-release 标识按字母数字顺序逐段比较 (按 . 分段)
 * - 纯数字段按数值比较,非数字段按字符串比较;数字段优先级低于非数字段
 */
function compareSemver(a: string, b: string): number {
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
    // 从 repo URL 提取 owner/repo
    // 支持格式: https://github.com/owner/repo 或 owner/repo
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) {
      reject(new Error(`Invalid GitHub repo URL: ${repoUrl}`))
      return
    }
    const [, owner, repo] = match
    const cleanRepo = repo.replace(/\.git$/, '')
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
          reject(new Error(`GitHub API returned ${res.statusCode}`))
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
            resolve(JSON.parse(data))
          } catch (err) {
            reject(new Error(`Failed to parse GitHub API response: ${err}`))
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      // 超时时同时清理响应流和请求,防止资源泄漏
      res?.destroy()
      req.destroy()
      reject(new Error('Request timed out'))
    })
  })
}

class UpdateService {
  private lastCheck: UpdateInfo | null = null
  private updateUrl: string = ''

  /** 设置 GitHub 仓库 URL */
  setRepoUrl(url: string): void {
    this.updateUrl = url
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
}

export const updateService = new UpdateService()
