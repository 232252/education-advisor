// =============================================================
// 学生 Excel 批量导入 IPC 处理器（M30）
//   - students/parse-excel      解析 + 冲突检测，返回预览
//   - students/import-excel     逐条 add-student + 分班 + 写入学生档案
//   - students/import-template  生成 Excel 模板
// =============================================================

import { fieldsToProfilePatch } from '@shared/roster-profile'
import * as IPC from '@shared/ipc-channels'
import type {
  EAAStudentList,
  StudentImportParams,
  StudentImportPreview,
  StudentImportResult,
  StudentImportTemplateResult,
} from '@shared/types'
import type { IpcMainInvokeEvent } from 'electron'
import * as XLSX from 'xlsx'
import { classService } from '../../services/class-service'
import { eaaBridge } from '../../services/eaa-bridge'
import {
  applyStudentRosterProfile,
  isAlreadyExistsError,
  registerRosterPrivacy,
} from '../../services/profile-import'
import { errText } from '../../utils/err-text'
import { sanitizeClassId, sanitizeName } from '../../utils/sanitize'
import { invalidateStudentsCacheNow } from '../eaa/cache'
import { handleIpc } from '../handle'
import {
  buildClassIndex,
  parseStudentImportMatrix,
  readExcelMatrix,
  TEMPLATE_HEADERS,
  TEMPLATE_SHEET_NAME,
  validateExcelFilePath,
} from './excel-import'

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
  handleIpc(
    IPC.IPC_STUDENTS_PARSE_EXCEL,
    async (_e, filePath: string): Promise<StudentImportPreview> => {
      const validated = validateExcelFilePath(filePath)
      if (!validated.ok) {
        return { success: false, error: validated.error, rows: [], errors: [], totalRows: 0 }
      }
      const matrix = readExcelMatrix(filePath)
      const existingNames = await fetchExistingStudentNames()
      const classIndex = buildClassIndex(classService.list())
      return parseStudentImportMatrix(matrix, existingNames, classIndex)
    },
    {
      timer: 'students:parse-excel',
      onError: (msg) => ({ success: false, error: msg, rows: [], errors: [], totalRows: 0 }),
    },
  )

  handleIpc(
    IPC.IPC_STUDENTS_IMPORT_EXCEL,
    async (e: IpcMainInvokeEvent, params: StudentImportParams): Promise<StudentImportResult> => {
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
      const privacyItems: Array<{ name: string; patch: ReturnType<typeof fieldsToProfilePatch> }> =
        []
      let imported = 0
      let current = 0
      const sendProgress = (current: number, total: number, imported: number, lastName: string) => {
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
            let added = false
            if (!r.alreadyExists) {
              const res = await eaaBridge.execute({ command: 'add-student', args: [name] })
              if (res.success) {
                added = true
              } else if (!isAlreadyExistsError(res.stderr || '', res.data)) {
                failErr = res.stderr || '未知错误'
              }
            }
            if (!failErr) {
              const rawClassId = typeof r?.classId === 'string' ? r.classId : ''
              if (rawClassId) {
                const classId = sanitizeClassId(rawClassId)
                const meta = await eaaBridge.execute({
                  command: 'set-student-meta',
                  args: [name, '--class-id', classId],
                })
                if (!meta.success) {
                  failErr = added
                    ? `class assign failed (new student): ${meta.stderr || '未知错误'}`
                    : `class assign failed (existing student): ${meta.stderr || '未知错误'}`
                }
              }
            }
            if (!failErr) {
              const patch = fieldsToProfilePatch({
                studentId: r.studentId,
                classId: r.classId,
                idCard: r.idCard,
                gender: r.gender,
                birthDate: r.birthDate,
                phone: r.phone,
                address: r.address,
                email: r.email,
                fatherName: r.fatherName,
                fatherPhone: r.fatherPhone,
                motherName: r.motherName,
                motherPhone: r.motherPhone,
                enrollmentDate: r.enrollmentDate,
                dormNumber: r.dormNumber,
              })
              await applyStudentRosterProfile(name, patch)
              privacyItems.push({ name, patch })
              ok = true
            }
          }
        } catch (err: unknown) {
          failErr = errText(err)
        }
        if (ok) {
          imported += 1
        } else {
          failed.push({ row: rowNo, name, error: failErr })
        }
        current += 1
        sendProgress(current, total, imported, name)
      }
      try {
        await registerRosterPrivacy(privacyItems)
      } catch {
        /* 档案已写入，隐私登记失败不回滚导入 */
      }
      invalidateStudentsCacheNow()
      return { success: true, total, imported, failed }
    },
    {
      timer: 'students:import-excel',
      onError: (msg) => ({ success: false, error: msg, total: 0, imported: 0, failed: [] }),
    },
  )

  handleIpc(
    IPC.IPC_STUDENTS_IMPORT_TEMPLATE,
    async (_e, filePath: string): Promise<StudentImportTemplateResult> => {
      const validated = validateExcelFilePath(filePath, ['.xlsx'])
      if (!validated.ok) {
        return { success: false, error: validated.error }
      }
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.aoa_to_sheet([[...TEMPLATE_HEADERS]])
      worksheet['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 4) }))
      XLSX.utils.book_append_sheet(workbook, worksheet, TEMPLATE_SHEET_NAME)
      XLSX.writeFile(workbook, filePath)
      return { success: true, filePath }
    },
    {
      timer: 'students:import-template',
      onError: (msg) => ({ success: false, error: msg }),
    },
  )

  console.log(
    '[IPC] Student Excel import handlers registered (parse/import/import-progress/template)',
  )
}
