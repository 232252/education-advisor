// =============================================================
// Tray Service — 系统托盘生命周期管理
// 作用:把 tray 的创建/销毁从 main/index.ts 抽出,
//       让 minimizeToTray 设置项能在运行时实时生效。
// 重构 (v1):
//   - init() 在 app ready 后调用,根据当前设置决定是否创建
//   - update(enabled) 在设置变更时调用,动态增删托盘
//   - destroy() 在 app 退出时清理
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app, type BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { settingsService } from './settings-service'

let tray: Tray | null = null
let mainWindowRef: BrowserWindow | null = null

function resolveIconPath(): string | undefined {
  const iconCandidates = process.resourcesPath
    ? [
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, 'resources', 'icon.ico'),
        path.join(__dirname, '..', '..', 'resources', 'icon.ico'),
      ]
    : [path.join(__dirname, '..', '..', 'resources', 'icon.ico')]
  for (const p of iconCandidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* continue */
    }
  }
  return undefined
}

export { resolveIconPath }

function showWindow(): void {
  if (!mainWindowRef) return
  if (mainWindowRef.isVisible()) {
    mainWindowRef.focus()
  } else {
    mainWindowRef.show()
  }
}

function loadTrayIcon(iconPath: string | undefined): Electron.NativeImage {
  if (!iconPath) return nativeImage.createEmpty()
  const dir = path.dirname(iconPath)
  // 清晰度优化: 用 build-icon 按目标尺寸栅格化的独立帧构建多分辨率 NativeImage,
  // 16px@1x + 32px@2x, 高 DPI (150%/200% 缩放) 下托盘图标依然锐利。
  const p16 = path.join(dir, 'icon-16.png')
  const p32 = path.join(dir, 'icon-32.png')
  const has16 = fs.existsSync(p16)
  const has32 = fs.existsSync(p32)
  if (has16 || has32) {
    const img = nativeImage.createEmpty()
    if (has16) img.addRepresentation({ scaleFactor: 1, buffer: fs.readFileSync(p16) })
    if (has32) img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(p32) })
    return img
  }
  // 回退: 单帧 PNG/ICO 缩到 16 (best 质量插值)
  const pngCandidate = iconPath.replace(/\.ico$/, '.png')
  const loadPath =
    pngCandidate !== iconPath && fs.existsSync(pngCandidate) ? pngCandidate : iconPath
  return nativeImage.createFromPath(loadPath).resize({ width: 16, height: 16, quality: 'best' })
}

function createTrayInstance(iconPath: string | undefined): Tray | null {
  const trayIcon = loadTrayIcon(iconPath)

  const t = new Tray(trayIcon)
  t.setToolTip('Education Advisor')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      },
    },
  ])

  t.setContextMenu(contextMenu)
  t.on('double-click', () => showWindow())
  return t
}

/** 在 app.whenReady().then() 内调用一次 */
export function initTray(win: BrowserWindow): void {
  mainWindowRef = win
  const iconPath = resolveIconPath()
  if (!iconPath) {
    console.warn('[Tray] No icon found, tray disabled')
    return
  }
  const settings = settingsService.getSettings()
  if (settings.general.minimizeToTray) {
    tray = createTrayInstance(iconPath)
    console.log('[Tray] Initialized (minimizeToTray=true)')
  } else {
    console.log('[Tray] Skipped (minimizeToTray=false)')
  }
}

/** 在 settings-handler 监听到 minimizeToTray 变化时调用 */
export function updateTray(enabled: boolean): void {
  if (enabled) {
    if (tray) return // 已有,忽略
    const iconPath = resolveIconPath()
    if (!iconPath) {
      console.warn('[Tray] No icon, cannot create')
      return
    }
    tray = createTrayInstance(iconPath)
    console.log('[Tray] Created on demand')
  } else {
    if (!tray) return
    tray.destroy()
    tray = null
    console.log('[Tray] Destroyed on demand')
  }
}

/** app.before-quit 时清理 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

export function getTrayStatus(): { exists: boolean } {
  return { exists: tray !== null }
}
