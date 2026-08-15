// =============================================================
// EAA 导出/导入域 IPC 处理器
// export / import / export-formats / dashboard
// 从 eaa-handlers.ts 抽出,handler 体逐行对照搬迁
// =============================================================

import { startIpcTimer } from '@shared/debug'
import * as IPC from '@shared/ipc-channels'
import { ipcMain } from 'electron'
import { eaaBridge } from '../../services/eaa-bridge'
import { buildDashboardArgs, buildExportFileArgs, buildImportArgs } from './commands'

export interface ExportHandlersContext {
  /** 写操作完成后清空缓存(由 eaa-handlers.ts 提供,import 导入学生后需失效) */
  invalidateStudentsCache: () => void
}

export function registerExportHandlers({ invalidateStudentsCache }: ExportHandlersContext): void {
  // ----- export: 导出排名 -----
  // 注意: export 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_EXPORT, async (_e, format: string, outputFile?: string) => {
    const stop = startIpcTimer('eaa:export')
    try {
      // 动态从 EAA 获取支持的格式,避免硬编码与 Rust 源码不同步
      const allowedFormats = new Set(await eaaBridge.getSupportedExportFormats())
      if (!allowedFormats.has(format)) {
        return {
          success: false,
          error: `format must be one of: ${[...allowedFormats].join(', ')}`,
          stderr: `format must be one of: ${[...allowedFormats].join(', ')}`,
          exitCode: -1,
        }
      }
      const built = buildExportFileArgs(outputFile)
      if (!built.ok) {
        return { success: false, error: built.error, stderr: built.error, exitCode: -1 }
      }
      const args = ['--format', format, ...built.args]
      return await eaaBridge.execute({ command: 'export', args })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:export failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    } finally {
      stop()
    }
  })

  // ----- import: 批量导入学生 -----
  // 注意: 不产生 JSON 输出
  ipcMain.handle(IPC.IPC_EAA_IMPORT, async (_e, filePath: string) => {
    const stop = startIpcTimer('eaa:import')
    try {
      const built = buildImportArgs(filePath)
      if (!built.ok) {
        return { success: false, error: built.error, stderr: built.error, exitCode: -1 }
      }
      const result = await eaaBridge.execute({ command: 'import', args: built.args })
      invalidateStudentsCache()
      return result
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:import failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    } finally {
      stop()
    }
  })

  // ----- dashboard: 生成静态 HTML 仪表盘（60s 超时） -----
  ipcMain.handle(IPC.IPC_EAA_DASHBOARD, async (_e, outputDir?: string) => {
    const stop = startIpcTimer('eaa:dashboard')
    try {
      const built = buildDashboardArgs(outputDir)
      if (!built.ok) {
        return { success: false, error: built.error, stderr: built.error, exitCode: -1 }
      }
      return await eaaBridge.execute({ command: 'dashboard', args: built.args, timeout: 60_000 })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:dashboard failed:', msg)
      return { success: false, error: msg, stderr: msg, exitCode: -1 }
    } finally {
      stop()
    }
  })

  // ----- export-formats: 动态从 EAA CLI 获取支持的导出格式 -----
  // 优先调用 eaaBridge.getSupportedExportFormats() 动态探测（运行 `eaa export --help`），
  // 探测失败或二进制不可用时降级到静态 SUPPORTED_EXPORT_FORMATS。
  // 这样 EAA 升级新增格式时前端无需改动即可自动适配。
  ipcMain.handle(IPC.IPC_EAA_EXPORT_FORMATS, async () => {
    try {
      return await eaaBridge.getSupportedExportFormats()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] eaa:export-formats failed:', msg)
      return []
    }
  })
}
