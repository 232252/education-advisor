// =============================================================
// 学生 Excel 批量导入 IPC 处理器（M30）
//   - students/parse-excel      解析 + 冲突检测（重名/已存在学生），返回预览
//   - students/import-excel     逐条 add-student（class_name 解析出 class_id 时
//                               联动 set-student-meta 分班），assign-progress 同款进度推送
//   - students/import-template  生成 Excel 模板（路径来自已有 sys:save-dialog）
// xlsx 依赖仅在 main 侧（复用 agent 侧 excel-tools 的读法），renderer 零增重
// =============================================================

import { startIpcTimer } from '@shared/debug'
import * as IPC from '@shared/ipc-channels'
import type {
  EAAStudentList,
  StudentImportParams,
  StudentImportPreview,
  StudentImportResult,
  StudentImportTemplateResult,
} from '@shared/types'
import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import * as XLSX from 'xlsx'
import { classService } from '../../services/class-service'
import { eaaBridge } from '../../services/eaa-bridge'
import { sanitizeClassId, sanitizeName } from '../../utils/sanitize'
import { invalidateStudentsCacheExternal } from '../eaa-handlers'
import {
  buildClassIndex,
  parseStudentImportMatrix,
  TEMPLATE_HEADERS,
  TEMPLATE_SHEET_NAME,
  validateExcelFilePath,
} from './excel-import'

/** 读取 Excel 首个工作表为矩阵（第一行作表头；空单元格补 ''） */
function readExcelMatrix(filePath: string): unknown[][] {
  // 注意：XLSX.readFile 是同步阻塞调用（xlsx 库无异步版本），
  // 导入文件来自用户对话框且行数受限，可接受；try/catch 防崩溃
  const workbook = XLSX.readFile(filePath)
  if (workbook.SheetNames.length === 0) {
    throw new Error('Excel 文件中没有工作表')
  }
  const worksheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    blankrows: true,
  }) as unknown[][]
}

/** 获取现有学生名集合（非 Deleted），用于冲突检测 */
async function fetchExistingStudentNames(): Promise<Set<string>> {
  const result = await eaaBridge.execute({ command: 'list-students', args: [] })
  if (!result?.success) {
    throw new Error(`获取现有学生列表失败: ${result?.stderr || '未知错误'}`)
  }
  const students = (result.data as EAAStudentList | null)?.students ?? []
  return new Set(students.filter((s) => s.status !== 'Deleted').map((s) => s.name))
}

export function registerStudentExcelHandlers(): void {
  // ----- parse-excel: 解析 + 冲突检测，返回预览（不写入） -----
  ipcMain.handle(
    IPC.IPC_STUDENTS_PARSE_EXCEL,
    async (_e, filePath: string): Promise<StudentImportPreview> => {
      const stop = startIpcTimer('students:parse-excel')
      try {
        const validated = validateExcelFilePath(filePath)
        if (!validated.ok) {
          return { success: false, error: validated.error, rows: [], errors: [], totalRows: 0 }
        }
        const matrix = readExcelMatrix(filePath)
        const existingNames = await fetchExistingStudentNames()
        const classIndex = buildClassIndex(classService.list())
        return parseStudentImportMatrix(matrix, existingNames, classIndex)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] students:parse-excel failed:', msg)
        return { success: false, error: msg, rows: [], errors: [], totalRows: 0 }
      } finally {
        stop()
      }
    },
  )

  // ----- import-excel: 预览确认后逐条 add-student（+ set-student-meta 分班） -----
  // EAA 写命令经 writeQueue 串行化，循环调用安全但较慢（N 次 spawn），
  // 复用 class:assign 的 assign-progress 推送模式，避免前端长时间无反馈
  ipcMain.handle(
    IPC.IPC_STUDENTS_IMPORT_EXCEL,
    async (e: IpcMainInvokeEvent, params: StudentImportParams): Promise<StudentImportResult> => {
      const stop = startIpcTimer('students:import-excel')
      try {
        if (!params || typeof params !== 'object' || !Array.isArray(params.rows)) {
          return {
            success: false,
            error: 'params.rows must be an array',
            total: 0,
            imported: 0,
            failed: [],
          }
        }
        if (params.rows.length === 0) {
          return {
            success: false,
            error: 'params.rows must not be empty',
            total: 0,
            imported: 0,
            failed: [],
          }
        }
        const total = params.rows.length
        const failed: StudentImportResult['failed'] = []
        const seen = new Set<string>()
        let imported = 0
        let current = 0
        const sendProgress = (
          current: number,
          total: number,
          imported: number,
          lastName: string,
        ) => {
          try {
            if (!e.sender.isDestroyed()) {
              e.sender.send(IPC.IPC_STUDENTS_IMPORT_PROGRESS, {
                current,
                total,
                imported,
                lastName,
              })
            }
          } catch {
            /* 渲染进程可能已卸载，忽略 */
          }
        }
        // 开始前先发一次 0/total，让前端立即进入「处理中」状态
        sendProgress(0, total, 0, '')
        for (const r of params.rows) {
          const rowNo = Number.isInteger(r?.row) ? r.row : 0
          let ok = false
          let failErr = ''
          let name = ''
          try {
            name = sanitizeName(String(r?.name ?? ''), 'name')
            if (seen.has(name)) {
              failErr = 'duplicate name in import request'
            } else {
              seen.add(name)
              const res = await eaaBridge.execute({ command: 'add-student', args: [name] })
              if (res.success) {
                const rawClassId = typeof r?.classId === 'string' ? r.classId : ''
                if (rawClassId) {
                  const classId = sanitizeClassId(rawClassId)
                  const meta = await eaaBridge.execute({
                    command: 'set-student-meta',
                    args: [name, '--class-id', classId],
                  })
                  if (meta.success) {
                    ok = true
                  } else {
                    failErr = `class assign failed: ${meta.stderr || '未知错误'}`
                  }
                } else {
                  ok = true
                }
              } else {
                failErr = res.stderr || '未知错误'
              }
            }
          } catch (err: unknown) {
            failErr = err instanceof Error ? err.message : String(err)
          }
          if (ok) {
            imported += 1
          } else {
            failed.push({ row: rowNo, name, error: failErr })
          }
          current += 1
          sendProgress(current, total, imported, name)
        }
        // 导入后让 listStudents 缓存失效,下一次加载看到新学生
        invalidateStudentsCacheExternal()
        return { success: true, total, imported, failed }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] students:import-excel failed:', msg)
        return { success: false, error: msg, total: 0, imported: 0, failed: [] }
      } finally {
        stop()
      }
    },
  )

  // ----- import-template: 生成 Excel 导入模板（name 必填；student_id/class_name 可选） -----
  ipcMain.handle(
    IPC.IPC_STUDENTS_IMPORT_TEMPLATE,
    async (_e, filePath: string): Promise<StudentImportTemplateResult> => {
      const stop = startIpcTimer('students:import-template')
      try {
        // 模板只生成 .xlsx（路径来自 sys:save-dialog，filters 已限定 xlsx）
        const validated = validateExcelFilePath(filePath, ['.xlsx'])
        if (!validated.ok) {
          return { success: false, error: validated.error }
        }
        const workbook = XLSX.utils.book_new()
        const worksheet = XLSX.utils.aoa_to_sheet([[...TEMPLATE_HEADERS]])
        worksheet['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 20 }]
        XLSX.utils.book_append_sheet(workbook, worksheet, TEMPLATE_SHEET_NAME)
        // 注意：XLSX.writeFile 是同步阻塞调用，单表头行写入耗时可忽略
        XLSX.writeFile(workbook, filePath)
        return { success: true, filePath }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] students:import-template failed:', msg)
        return { success: false, error: msg }
      } finally {
        stop()
      }
    },
  )

  console.log('[IPC] Student Excel import handlers registered (parse/import/template)')
}
