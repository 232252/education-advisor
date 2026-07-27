// =============================================================
// 系统 IPC 处理器
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, type BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import { updateService } from '../services/update-service'

export function registerSysHandlers(win: BrowserWindow) {
  // 打开文件选择对话框
  // H-8 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_SYS_OPEN_DIALOG, async (_e, options: Electron.OpenDialogOptions) => {
    try {
      return await dialog.showOpenDialog(win, options)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] sys:open-dialog failed:', msg)
      return { canceled: true, filePaths: [], error: msg } as Electron.OpenDialogReturnValue & {
        error: string
      }
    }
  })

  // 保存文件对话框
  // H-8 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_SYS_SAVE_DIALOG, async (_e, options: Electron.SaveDialogOptions) => {
    try {
      return await dialog.showSaveDialog(win, options)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] sys:save-dialog failed:', msg)
      return { canceled: true, filePath: '', error: msg } as Electron.SaveDialogReturnValue & {
        error: string
      }
    }
  })

  // 在系统浏览器中打开链接
  // MEDIUM 修复: openExternal 增加协议白名单(http/https/mailto),防止恶意协议执行
  // H-8 修复: 加 try-catch,校验失败返回结构化错误
  ipcMain.handle(IPC.IPC_SYS_OPEN_EXTERNAL, async (_e, url: string) => {
    if (typeof url !== 'string' || url.length === 0) {
      return { success: false, error: 'url must be a non-empty string' }
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { success: false, error: `Invalid URL: ${url}` }
    }
    const ALLOWED_PROTOCOLS = new Set(['https:', 'mailto:'])
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return { success: false, error: `Disallowed protocol: ${parsed.protocol}` }
    }
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] sys:open-external failed for "${url}":`, msg)
      return { success: false, error: msg }
    }
  })

  // 获取系统路径
  // P1-34 修复:用 Parameters<typeof app.getPath>[0] 替代 as any,
  // 避免非法路径名（如 '../evil'）导致 app.getPath 抛错
  // H-8 修复: 加 try-catch,校验失败返回结构化错误
  ipcMain.handle(IPC.IPC_SYS_GET_PATH, async (_e, name: string) => {
    try {
      // app.getPath 的合法入参固定枚举,运行时窄化
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
      type ValidPathName = (typeof validNames)[number]
      if (!(validNames as readonly string[]).includes(name)) {
        return { success: false, error: `Invalid path name: ${name}` }
      }
      return app.getPath(name as ValidPathName)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] sys:get-path failed for "${name}":`, msg)
      return { success: false, error: msg }
    }
  })

  // 检查更新
  // H-8 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_SYS_CHECK_UPDATE, async () => {
    try {
      return await updateService.checkForUpdates()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] sys:check-update failed:', msg)
      return {
        hasUpdate: false,
        message: `检查更新失败: ${msg}`,
        enabled: false,
        error: msg,
      } as Awaited<ReturnType<typeof updateService.checkForUpdates>> & { error: string }
    }
  })

  // 弹出更新对话框
  // H-8 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_SYS_SHOW_UPDATE_DIALOG, async () => {
    try {
      await updateService.showUpdateDialog()
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] sys:show-update-dialog failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 系统通知
  // H-8 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_SYS_NOTIFICATION, async (_e, title: string, body: string) => {
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show()
      }
      return { success: true }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] sys:notification failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 读取文件内容 — 用于 ChatPage 文件上传
  // 安全限制:
  //   1. 文件大小上限 10MB (避免内存爆炸)
  //   2. 路径 sanitize (拒绝 null bytes 和 .. 路径段,防穿越)
  //   3. 自动推断 MIME 类型
  ipcMain.handle(IPC.IPC_SYS_READ_FILE, async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return { success: false, error: 'filePath must be a non-empty string' }
    }
    if (filePath.includes('\0')) {
      return { success: false, error: 'filePath contains null bytes' }
    }
    // H-2 修复: 拒绝路径中包含 .. 段(路径穿越攻击)
    // 用户通过 dialog 选择的文件路径都是规范化的绝对路径,不会包含 ..
    const segments = filePath.split(/[\\/]/)
    if (segments.includes('..')) {
      return { success: false, error: 'filePath contains path traversal segments (..)' }
    }
    try {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] sys:read-file failed:', msg)
      return { success: false, error: msg, path: filePath }
    }
  })

  console.log('[IPC] System handlers registered')
}
