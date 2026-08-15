// =============================================================
// 主窗口创建 — 应用图标解析 + BrowserWindow 构造
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, nativeImage } from 'electron'
import { resolveIconPath } from '../services/tray-service'

/**
 * 解析应用图标:
 * - Windows 直接传 ICO 路径(而非 NativeImage), 保留 ICO 内全部尺寸帧
 * - Linux/macOS 传 nativeImage 加载 PNG,避免 ICO 解码 SIGSEGV 崩溃
 */
export function resolveAppIcon(): string | Electron.NativeImage | undefined {
  const iconPath = resolveIconPath()
  if (!iconPath) {
    console.warn('[Main] No icon found, using Electron default')
    return undefined
  }
  // 清晰度优化: Windows 直接传 ICO 路径(而非 NativeImage), 保留 ICO 内全部尺寸帧
  // (16/24/32/48/64/128/256), 标题栏/任务栏/Alt-Tab 各场景自动选最佳帧, 不再整体缩放。
  // Linux/macOS 适配: 传 .ico 路径给 BrowserWindow 会导致 Electron SIGSEGV 崩溃
  // (Chromium 无法解码 ICO), 必须改用 nativeImage 从高分辨率 PNG 加载。
  let appIcon: string | Electron.NativeImage | undefined
  const isIco = iconPath.toLowerCase().endsWith('.ico')
  if (isIco && process.platform === 'win32') {
    appIcon = iconPath
    console.log(`[Main] Window icon: ${iconPath} (multi-frame ICO)`)
  } else {
    // 非 Windows: 优先同目录最高分辨率 PNG 帧, 其次 icon.png, 最后原路径(可能已是 PNG)
    // 清晰度优化: 优先 1024 用于 Retina/HiDPI (200% DPR 下需 2x 物理像素),
    // 退到 512/256 兼容旧资源。Linux/macOS 用 nativeImage 加载,避免 ICO 解码崩溃。
    const dir = path.dirname(iconPath)
    const pngCandidates = [
      path.join(dir, 'icon-1024.png'),
      path.join(dir, 'icon-512.png'),
      path.join(dir, 'icon-256.png'),
      path.join(dir, 'icon.png'),
      ...(isIco ? [] : [iconPath]),
    ]
    const pngPath = pngCandidates.find((p) => p !== iconPath && fs.existsSync(p))
    const loadPath = pngPath ?? (isIco ? '' : iconPath)
    appIcon = loadPath ? nativeImage.createFromPath(loadPath) : nativeImage.createEmpty()
    console.log(
      `[Main] Window icon: ${loadPath || '(none)'} (${appIcon.getSize().width}x${appIcon.getSize().height}, platform=${process.platform})`,
    )
    if (appIcon.isEmpty()) {
      console.warn('[Main] Icon loaded but empty, falling back to default')
      appIcon = undefined
    }
  }
  return appIcon
}

/** 创建主窗口(preload 路径断言 + contextIsolation 安全配置) */
export function createMainWindow(
  appIcon: string | Electron.NativeImage | undefined,
): BrowserWindow {
  return new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Education Advisor',
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      // P0-2 修复: 启动期断言 preload 存在，支持 .js/.cjs/.mjs 扩展名
      preload: (() => {
        for (const ext of ['.js', '.cjs', '.mjs']) {
          const preloadPath = path.join(__dirname, `preload${ext}`)
          if (fs.existsSync(preloadPath)) return preloadPath
        }
        throw new Error(
          `[Main] preload not found at ${path.join(__dirname, 'preload.*')} — vite build 产物可能改名，` +
            `请确认 vite.config.ts 输出格式与 main 入口一致`,
        )
      })(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    show: false,
  })
}
