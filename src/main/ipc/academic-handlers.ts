// =============================================================
// Academic IPC 处理器 — 科目/考试/成绩
// =============================================================

import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import type { AcademicConfig, ExamDef, GradeRecord } from '../../shared/types'
import { academicService } from '../services/academic-service'
import { TtlLruCache } from '../services/eaa-cache'

/**
 * R136 优化: Academic 读取结果 TTL 缓存
 * - getConfig / listExams / getGrades / getClassGrades 在 UI 频繁触发
 *   (页面切换、Tab 重渲染、EAA 同步轮询都会反复读取相同数据)
 * - 写操作(setConfig / createExam / deleteExam / setGrade / batchSetGrades)
 *   主动失效对应条目,保证一致性
 * - TTL 5s: 短到用户感知不到滞后, 又能挡住 1 秒内多次重复读取
 */
const academicCache = {
  config: new TtlLruCache<AcademicConfig>({ ttlMs: 5_000, maxEntries: 4 }),
  exams: new TtlLruCache<ExamDef[]>({ ttlMs: 5_000, maxEntries: 16 }),
  grades: new TtlLruCache<GradeRecord[]>({ ttlMs: 5_000, maxEntries: 256 }),
  classGrades: new TtlLruCache<Record<string, GradeRecord[]>>({
    ttlMs: 5_000,
    maxEntries: 64,
  }),
}

/** 写操作后清掉相关缓存条目 */
function invalidateOnConfigWrite(): void {
  academicCache.config.clear()
}

function invalidateOnExamsWrite(): void {
  academicCache.exams.clear()
  // deleteExam 会级联删除成绩, 保守起见同时清空成绩缓存
  academicCache.grades.clear()
  academicCache.classGrades.clear()
}

function invalidateOnGradesWrite(studentNames: string[]): void {
  for (const name of studentNames) {
    academicCache.grades.delete(name)
  }
  // 班级成绩缓存 key 是 (names + examId + subjectId) 复合,
  // 受影响学生可能出现在任意班级组合里, 直接全清(容量 64, 成本可控)
  academicCache.classGrades.clear()
}

/** 学生姓名安全过滤(与 profile-handlers 一致) */
function sanitizeName(name: string): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('name must be a non-empty string')
  }
  if (name.length > 64) {
    throw new Error('name too long (max 64 chars)')
  }
  // 剥离不可见 Unicode 字符,保留常见姓名符号
  const cleaned = name
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .trim()
  if (cleaned.length === 0) {
    throw new Error('name is empty after cleaning')
  }
  // 拒绝控制字符(包括 NUL、换行符 \n \r、制表符等,防止参数注入和数据损坏)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char guard against injection
  if (/[\x00-\x1F\x7F]/.test(cleaned)) {
    throw new Error('name contains control characters')
  }
  if (/[`$;|&<>{}\\]/.test(cleaned)) {
    throw new Error('name contains illegal characters')
  }
  return cleaned
}

export function registerAcademicHandlers(): void {
  // 读取学业配置
  ipcMain.handle(IPC.IPC_ACADEMIC_GET_CONFIG, async () => {
    try {
      // R136 优化: TTL 缓存命中直接返回, 避免重复 readFile config.json
      const cacheKey = 'config'
      const cached = academicCache.config.get(cacheKey)
      if (cached) {
        return { success: true, data: cached }
      }
      const data = await academicService.getConfig()
      academicCache.config.set(cacheKey, data)
      return { success: true, data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] academic:get-config failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 更新学业配置
  ipcMain.handle(
    IPC.IPC_ACADEMIC_SET_CONFIG,
    async (_e: IpcMainInvokeEvent, config: AcademicConfig) => {
      try {
        if (!config || typeof config !== 'object') {
          throw new Error('config must be a non-null object')
        }
        if (!Array.isArray(config.subjects)) {
          throw new Error('config.subjects must be an array')
        }
        await academicService.setConfig(config)
        // R136: 写后失效配置缓存
        invalidateOnConfigWrite()
        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] academic:set-config failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

  // 列出考试(可选 ?semester=xxx)
  ipcMain.handle(IPC.IPC_ACADEMIC_LIST_EXAMS, async (_e: IpcMainInvokeEvent, semester?: string) => {
    try {
      // R136 优化: TTL 缓存 key 按 semester 区分(空参 → 'all')
      const cacheKey = semester ?? 'all'
      const cached = academicCache.exams.get(cacheKey)
      if (cached) {
        return { success: true, data: cached }
      }
      const data = await academicService.listExams(semester)
      academicCache.exams.set(cacheKey, data)
      return { success: true, data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] academic:list-exams failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 新建考试
  ipcMain.handle(
    IPC.IPC_ACADEMIC_CREATE_EXAM,
    async (_e: IpcMainInvokeEvent, exam: Omit<ExamDef, 'id' | 'createdAt'>) => {
      try {
        if (!exam || typeof exam !== 'object') {
          throw new Error('exam must be a non-null object')
        }
        if (!exam.name || typeof exam.name !== 'string') {
          throw new Error('exam.name is required')
        }
        if (!Array.isArray(exam.subjects)) {
          throw new Error('exam.subjects must be an array')
        }
        // Bug R111-2 修复: subjects 必须是 string[] (subject IDs)。
        // 旧实现只检查 Array.isArray, 接受对象数组后被存入 exams.json,
        // 导致 setGrade 的 exam.subjects.includes(subjectId) 永远 false。
        // 此处强制规范化为 string[], 拒绝非法元素。
        const normalizedSubjects: string[] = []
        for (const s of exam.subjects) {
          if (typeof s === 'string') {
            normalizedSubjects.push(s)
          } else if (
            s &&
            typeof s === 'object' &&
            typeof (s as { id?: unknown }).id === 'string'
          ) {
            // 容错: 接受 {id, name, fullMark} 形式, 提取 id
            normalizedSubjects.push((s as { id: string }).id)
          } else {
            throw new Error('exam.subjects must be an array of subject ID strings')
          }
        }
        exam.subjects = normalizedSubjects
        const data = await academicService.createExam(exam)
        // R136: 新建考试会影响 listExams 结果, 失效所有 exams 缓存
        invalidateOnExamsWrite()
        return { success: true, data }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] academic:create-exam failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

  // 删除考试
  ipcMain.handle(IPC.IPC_ACADEMIC_DELETE_EXAM, async (_e: IpcMainInvokeEvent, examId: string) => {
    try {
      if (typeof examId !== 'string' || examId.trim().length === 0) {
        throw new Error('examId must be a non-empty string')
      }
      await academicService.deleteExam(examId)
      // R136: deleteExam 会级联删除成绩, 失效 exams + grades + classGrades
      invalidateOnExamsWrite()
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] academic:delete-exam failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 读取学生成绩
  ipcMain.handle(
    IPC.IPC_ACADEMIC_GET_GRADES,
    async (_e: IpcMainInvokeEvent, studentName: string) => {
      try {
        const safeName = sanitizeName(studentName)
        // R136 优化: TTL 缓存按学生姓名 key, 避免重复 readFile grades/{name}.json
        const cached = academicCache.grades.get(safeName)
        if (cached) {
          return { success: true, data: cached }
        }
        const data = await academicService.getGrades(safeName)
        academicCache.grades.set(safeName, data)
        return { success: true, data }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] academic:get-grades failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

  // 设置单条成绩
  ipcMain.handle(
    IPC.IPC_ACADEMIC_SET_GRADE,
    async (_e: IpcMainInvokeEvent, record: Omit<GradeRecord, 'updatedAt'>) => {
      try {
        if (!record || typeof record !== 'object') {
          throw new Error('record must be a non-null object')
        }
        if (typeof record.examId !== 'string' || !record.examId) {
          throw new Error('record.examId is required')
        }
        if (typeof record.subjectId !== 'string' || !record.subjectId) {
          throw new Error('record.subjectId is required')
        }
        record.studentName = sanitizeName(record.studentName)
        const data = await academicService.setGrade(record)
        // R136: 失效该学生的 grades 缓存 + 全部 classGrades 复合缓存
        invalidateOnGradesWrite([record.studentName])
        return { success: true, data }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] academic:set-grade failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

  // 批量设置成绩
  ipcMain.handle(
    IPC.IPC_ACADEMIC_BATCH_SET_GRADES,
    async (_e: IpcMainInvokeEvent, records: Omit<GradeRecord, 'updatedAt'>[]) => {
      try {
        if (!Array.isArray(records)) {
          throw new Error('records must be an array')
        }
        // 空数组幂等返回 (与 deleteExam 不存在 id / getGrades 不存在学生返回 []
        // 的批量幂等约定一致), 避免把 service 层前置条件泄漏给前端
        if (records.length === 0) {
          return { success: true, data: 0 }
        }
        for (const r of records) {
          if (!r || typeof r !== 'object') {
            throw new Error('each record must be a non-null object')
          }
          if (typeof r.examId !== 'string' || !r.examId) {
            throw new Error('each record must have examId')
          }
          if (typeof r.subjectId !== 'string' || !r.subjectId) {
            throw new Error('each record must have subjectId')
          }
          if (typeof r.studentName !== 'string' || !r.studentName) {
            throw new Error('each record must have studentName')
          }
          r.studentName = sanitizeName(r.studentName)
        }
        const count = await academicService.batchSetGrades(records)
        // R136: 失效涉及的全部学生 grades + classGrades
        const affected = Array.from(new Set(records.map((r) => r.studentName)))
        invalidateOnGradesWrite(affected)
        return { success: true, data: count }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] academic:batch-set-grades failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

  // 读取班级成绩(参数: studentNames[], examId, subjectId?)
  ipcMain.handle(
    IPC.IPC_ACADEMIC_GET_CLASS_GRADES,
    async (_e: IpcMainInvokeEvent, studentNames: string[], examId: string, subjectId?: string) => {
      try {
        if (!Array.isArray(studentNames)) {
          throw new Error('studentNames must be an array')
        }
        if (typeof examId !== 'string' || !examId) {
          throw new Error('examId must be a non-empty string')
        }
        const safeNames = studentNames.map((n) => sanitizeName(n))
        // R136 优化: TTL 缓存 key = sortedNames|examId|subjectId
        // (排序保证不同顺序的同集合命中同一 key)
        const cacheKey = `${safeNames.slice().sort().join(',')}|${examId}|${subjectId ?? 'all'}`
        const cached = academicCache.classGrades.get(cacheKey)
        if (cached) {
          return { success: true, data: cached }
        }
        const data = await academicService.getClassGrades(safeNames, examId, subjectId)
        academicCache.classGrades.set(cacheKey, data)
        return { success: true, data }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] academic:get-class-grades failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

  // 试卷分析 — 接收文件路径,返回题目分数和分析文本
  // 目前为占位实现:验证文件存在,返回空分析结果(后续可接入 AI/OCR)
  ipcMain.handle(
    IPC.IPC_ACADEMIC_ANALYZE_PAPER,
    async (_e: IpcMainInvokeEvent, filePath: string, examId?: string, subjectId?: string) => {
      try {
        if (typeof filePath !== 'string' || filePath.trim().length === 0) {
          throw new Error('filePath must be a non-empty string')
        }

        // 验证文件是否存在
        try {
          const stat = await fsp.stat(filePath)
          if (!stat.isFile()) {
            throw new Error('path is not a file')
          }
          // 限制文件大小 (50MB)
          if (stat.size > 50 * 1024 * 1024) {
            throw new Error('file too large (max 50MB)')
          }
        } catch (statErr) {
          const msg = statErr instanceof Error ? statErr.message : String(statErr)
          throw new Error(`cannot access file: ${msg}`)
        }

        // 获取文件扩展名
        const ext = path.extname(filePath).toLowerCase()
        const supportedExts = ['.png', '.jpg', '.jpeg', '.pdf', '.webp', '.bmp']
        if (!supportedExts.includes(ext)) {
          throw new Error(`unsupported file type: ${ext} (supported: ${supportedExts.join(', ')})`)
        }

        // 占位分析结果 — 后续可接入 AI/OCR 服务
        const result = {
          filePath,
          fileName: path.basename(filePath),
          fileType: ext,
          examId: examId || null,
          subjectId: subjectId || null,
          questionScores: [] as number[],
          analysis: '试卷分析功能待接入 AI/OCR 服务。文件已验证,可手动录入各题分数。',
          analyzedAt: new Date().toISOString(),
        }

        console.log(`[IPC] academic:analyze-paper: ${result.fileName} (${ext})`)
        return { success: true, data: result }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[IPC] academic:analyze-paper failed:', msg)
        return { success: false, error: msg }
      }
    },
  )

  console.log('[IPC] Academic handlers registered')
}
