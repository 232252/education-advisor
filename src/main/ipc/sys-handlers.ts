// =============================================================
// 系统 IPC 处理器
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import * as IPC from '@shared/ipc-channels'
import { app, type BrowserWindow, dialog, ipcMain } from 'electron'
import { factoryResetAll } from '../services/factory-reset'
import { updateService } from '../services/update-service'
import { validatePathSafety } from '../utils/sanitize'
import { handleIpc } from './handle'
import { invalidateSettingsGetCache } from './settings-handlers'

export function registerSysHandlers(win: BrowserWindow) {
  // M31: 更新下载进度推送 (参考 ollama:pull-progress 模式:
  // 主进程事件 → webContents.send,窗口销毁后静默跳过)
  updateService.setProgressListener((p) => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.IPC_SYS_UPDATE_PROGRESS, p)
    }
  })

  // 打开文件选择对话框
  // H-8 修复: 加 try-catch
  handleIpc(
    IPC.IPC_SYS_OPEN_DIALOG,
    async (_e, options: Electron.OpenDialogOptions) => {
      return await dialog.showOpenDialog(win, options)
    },
    (msg) =>
      ({
        canceled: true,
        filePaths: [],
        error: msg,
      }) as Electron.OpenDialogReturnValue & { error: string },
  )

  // 保存文件对话框
  // H-8 修复: 加 try-catch
  handleIpc(
    IPC.IPC_SYS_SAVE_DIALOG,
    async (_e, options: Electron.SaveDialogOptions) => {
      return await dialog.showSaveDialog(win, options)
    },
    (msg) =>
      ({
        canceled: true,
        filePath: '',
        error: msg,
      }) as Electron.SaveDialogReturnValue & { error: string },
  )

  // R2-16: 版本号单一来源 — electron-builder 注入的 package.json version
  ipcMain.handle(IPC.IPC_SYS_GET_VERSION, () => app.getVersion())

  // 获取系统路径
  // P1-34: app.getPath 合法入参是固定枚举,运行时窄化,
  // 避免非法路径名(如 '../evil')导致 app.getPath 抛错
  handleIpc(IPC.IPC_SYS_GET_PATH, (_e, name: string) => {
    const validNames = [
      'home',
      'appData',
      'userData',
      'sessionData',
      'temp',
      'exe',
      'module',
      'desktop',
      'documents',
      'downloads',
      'music',
      'pictures',
      'videos',
      'recent',
      'logs',
      'crashDumps',
    ] as const
    if (!(validNames as readonly string[]).includes(name)) {
      return { success: false, error: `Invalid path name: ${name}` }
    }
    // P1-34: Parameters[...] 收窄替代 as any(上面已按 validNames 白名单校验)
    type ValidPathName = Parameters<typeof app.getPath>[0]
    return app.getPath(name as ValidPathName)
  })

  // 弹出更新对话框
  handleIpc(IPC.IPC_SYS_SHOW_UPDATE_DIALOG, async () => {
    await updateService.showUpdateDialog()
    return { success: true }
  })

  // 检查更新
  // H-8 修复: 加 try-catch
  handleIpc(
    IPC.IPC_SYS_CHECK_UPDATE,
    async () => {
      return await updateService.checkForUpdates()
    },
    (msg) =>
      ({
        hasUpdate: false,
        message: `检查更新失败: ${msg}`,
        enabled: false,
        error: msg,
      }) as Awaited<ReturnType<typeof updateService.checkForUpdates>> & { error: string },
  )

  // 下载更新 (M31: electron-updater,进度经 sys:update-progress 推送)
  // H-8 修复: 加 try-catch
  handleIpc(IPC.IPC_SYS_DOWNLOAD_UPDATE, async () => {
    return await updateService.downloadUpdate()
  })

  // 重启并安装已下载的更新 (M31;portable 版返回 portable 标记提示手动替换)
  // H-8 修复: 加 try-catch
  handleIpc(
    IPC.IPC_SYS_INSTALL_UPDATE,
    async () => {
      return await updateService.installUpdate()
    },
    (msg) => ({ success: false, portable: false, error: msg }),
  )

  // 重启应用(备份恢复后数据文件已替换,需重启进程重新加载)
  // app.exit 不会触发 will-quit 的 preventDefault 循环,与 activate 分支同模式
  handleIpc(IPC.IPC_SYS_RESTART_APP, async () => {
    app.relaunch()
    app.exit(0)
    return { success: true }
  })

  // 出厂重置: 清空班级/学生/对话/成绩/记忆/密钥/设置。调用方随后 relaunch。
  handleIpc(
    IPC.IPC_SYS_FACTORY_RESET,
    async () => {
      await factoryResetAll()
      invalidateSettingsGetCache()
      return { success: true }
    },
    (msg) => ({ success: false, error: msg }),
  )

  // 读取文件内容 — 用于 ChatPage 文件上传
  // 安全限制:
  //   1. 文件大小上限 10MB (避免内存爆炸)
  //   2. 路径 sanitize (拒绝 null bytes 和 .. 路径段,防穿越)
  //   3. 自动推断 MIME 类型
  handleIpc(IPC.IPC_SYS_READ_FILE, async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return { success: false, error: 'filePath must be a non-empty string' }
    }
    // NUL/遍历统一守卫(H-2: dialog 选出的规范化绝对路径,仅拒 .. 独立路径段)
    const pathErr = validatePathSafety(filePath, { field: 'filePath', segmentTraversal: true })
    if (pathErr) return { success: false, error: pathErr }
    // R136 优化: 使用异步 fs API 避免阻塞主进程事件循环
    // (原 statSync + readFileSync 在读取大文件时会卡住所有并发 IPC)
    const stats = await fsp.stat(filePath)
    if (!stats.isFile()) {
      throw new Error(`Not a regular file: ${filePath}`)
    }
    const MAX_SIZE = 10 * 1024 * 1024 // 10MB
    if (stats.size > MAX_SIZE) {
      throw new Error(`File too large: ${stats.size} bytes (max ${MAX_SIZE})`)
    }
    const ext = path.extname(filePath).toLowerCase()
    // 简单 MIME 推断
    const MIME_MAP: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.csv': 'text/csv',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.xml': 'text/xml',
      '.js': 'text/javascript',
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.jsx': 'text/javascript',
      '.py': 'text/x-python',
      '.rs': 'text/x-rust',
      '.go': 'text/x-go',
      '.java': 'text/x-java',
      '.c': 'text/x-c',
      '.cpp': 'text/x-c++',
      '.h': 'text/x-c',
      '.sh': 'text/x-shellscript',
      '.sql': 'text/x-sql',
      '.log': 'text/plain',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    }
    const mimeType = MIME_MAP[ext] || 'application/octet-stream'
    const isText = mimeType.startsWith('text/') || mimeType === 'application/json'
    const isBinary = !isText
    if (isBinary) {
      // 二进制文件:返回 base64 编码
      const buf = await fsp.readFile(filePath)
      return {
        success: true,
        path: filePath,
        name: path.basename(filePath),
        size: stats.size,
        mimeType,
        encoding: 'base64',
        content: buf.toString('base64'),
      }
    }
    // 文本文件:返回 utf-8 字符串
    const content = await fsp.readFile(filePath, 'utf-8')
    return {
      success: true,
      path: filePath,
      name: path.basename(filePath),
      size: stats.size,
      mimeType,
      encoding: 'utf-8',
      content,
    }
  })

  console.log('[IPC] System handlers registered')
}
