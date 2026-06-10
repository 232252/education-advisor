// =============================================================
// Student Profile Service — 学生扩展档案存储
// 存储于 eaa-data/profiles/{name}.json
// =============================================================
//
// 全链路设计：
//   UI (AcademicsTab) → IPC (profile-handlers) → ProfileService
//   → 校验器 (validateAcademicRecords) → 隐私引擎 (anonymize/deanonymize)
//   → JSON 文件存储（带文件锁）
//
// 隐私脱敏：
//   - 写入时：逐字段过 eaa privacy anonymize，最后全文再次过隐私引擎
//   - 读取时：通过 eaa privacy deanonymize 还原
//   - 文件系统上只存脱敏版本
//
// 并发保护：
//   - 每学生一个 Mutex（Promise 队列），同一学生的写入串行化
//   - 原子写：tmp → fsync → rename
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AcademicExamRecord, StudentProfileData } from '../../shared/types'
import { eaaBridge } from './eaa-bridge'

/** 默认科目列表 */
export const DEFAULT_SUBJECTS = [
  '语文', '数学', '英语', '物理', '化学', '生物',
  '政治', '历史', '地理',
  '通用技术', '信息技术',
  '体育', '音乐', '美术',
]

/** 默认考试类型 */
export const DEFAULT_EXAM_TYPES = ['周考', '月考', '期中', '期末', '模拟考', '平时测试', '随堂测验']

/** 分数范围 — 300 能覆盖所有学制（单科最高 300 = 理综/文综） */
const SCORE_MIN = 0
const SCORE_MAX = 300

/** PII 字段列表 — 写入时逐一过隐私引擎 */
const PII_FIELDS = [
  'parentName', 'fatherName', 'motherName',
  'idCard', 'phone', 'address',
  'comments', 'honors', 'punishments',
  'allergy', 'specialNeeds', 'dormNumber', 'bedNumber',
]

class ProfileService {
  private profilesDir: string
  /** 每学生文件锁（Promise 队列，串行化写入） */
  private locks = new Map<string, Promise<void>>()

  constructor() {
    this.profilesDir = path.join(app.getPath('userData'), 'eaa-data', 'profiles')
    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true })
    }
  }

  /**
   * 按 name 加锁，确保同一学生的写入串行
   */
  private async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(name) ?? Promise.resolve()
    // 前一个失败时 catch 吞掉，确保 chain 不断；错误由调用方 set() 自行处理
    const next = prev.catch(() => {}).then(fn)
    this.locks.set(name, next)
    // 清理已完成的任务
    next.finally(() => { if (this.locks.get(name) === next) this.locks.delete(name) })
    return next
  }

  private profilePath(name: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
    return path.join(this.profilesDir, `${safeName}.json`)
  }

  /** 获取经过隐私脱敏的化名路径（用于存储） */
  private async anonymizedPath(realName: string): Promise<string> {
    try {
      const result = await eaaBridge.execute({
        command: 'privacy',
        args: ['anonymize', realName],
      })
      if (result.success && result.data) {
        const anoName = String(result.data).trim()
        return this.profilePath(anoName)
      }
    } catch {
      // 隐私引擎不可用则回退
    }
    return this.profilePath(realName)
  }

  /** 从化名还原真名 */
  private async deanonymizeName(anonymizedName: string): Promise<string> {
    try {
      const result = await eaaBridge.execute({
        command: 'privacy',
        args: ['deanonymize', anonymizedName],
      })
      if (result.success && result.data) {
        return String(result.data).trim()
      }
    } catch {
      // 隐私引擎不可用则回退
    }
    return anonymizedName
  }

  /** 校验学业成绩记录 */
  validateAcademicRecords(records: AcademicExamRecord[]): string[] {
    const errors: string[] = []
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]
      if (!rec.examType || typeof rec.examType !== 'string') {
        errors.push(`[${i}] 考试类型不能为空`)
      }
      if (!rec.examName || typeof rec.examName !== 'string') {
        errors.push(`[${i}] 考试名称不能为空`)
      }
      if (!rec.subjects || typeof rec.subjects !== 'object' || Object.keys(rec.subjects).length === 0) {
        errors.push(`[${i}] 至少需要一个科目的成绩`)
      } else {
        for (const [subject, score] of Object.entries(rec.subjects)) {
          if (typeof subject !== 'string' || subject.trim().length === 0) {
            errors.push(`[${i}] 科目名不能为空`)
          }
          if (score !== null && (typeof score !== 'number' || Number.isNaN(score))) {
            errors.push(`[${i}] ${subject} 的成绩必须是数字或 null`)
          } else if (score !== null && (score < SCORE_MIN || score > SCORE_MAX)) {
            errors.push(`[${i}] ${subject} 的成绩 ${score} 超出范围 (${SCORE_MIN}-${SCORE_MAX})`)
          }
        }
      }
      if (rec.date && !/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) {
        errors.push(`[${i}] 日期格式不正确 (应为 YYYY-MM-DD)`)
      }
    }
    return errors
  }

  /** 合并迁移旧数据：将 midtermGrades/finalGrades 转入 academicRecords */
  migrateLegacyData(data: StudentProfileData): StudentProfileData {
    const result = { ...data }
    const records: AcademicExamRecord[] = [...(data.academicRecords ?? [])]

    if (data.midtermGrades && Object.keys(data.midtermGrades).length > 0) {
      if (!records.some((r) => r.examName === '期中')) {
        records.push({ examType: '期中', examName: '期中', subjects: { ...data.midtermGrades } })
      }
      delete result.midtermGrades
    }
    if (data.finalGrades && Object.keys(data.finalGrades).length > 0) {
      if (!records.some((r) => r.examName === '期末')) {
        records.push({ examType: '期末', examName: '期末', subjects: { ...data.finalGrades } })
      }
      delete result.finalGrades
    }
    result.academicRecords = records
    return result
  }

  /** 读取学生扩展档案（自动 Deanonymize + 迁移旧数据） */
  async get(name: string): Promise<StudentProfileData> {
    const filePath = this.profilePath(name)
    const anoPath = await this.anonymizedPath(name)

    let data: StudentProfileData = {}
    if (fs.existsSync(anoPath)) {
      try {
        data = JSON.parse(fs.readFileSync(anoPath, 'utf-8')) as StudentProfileData
      } catch { data = {} }
    } else if (fs.existsSync(filePath)) {
      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StudentProfileData
      } catch { data = {} }
    }

    data = this.migrateLegacyData(data)

    // Deanonymize 所有 PII 字段
    for (const field of PII_FIELDS) {
      const val = (data as Record<string, unknown>)[field]
      if (val && typeof val === 'string') {
        try {
          ;(data as Record<string, unknown>)[field] = await this.deanonymizeName(val)
        } catch { /* keep as-is */ }
      }
    }

    return data
  }

  /** 写入学生扩展档案（带文件锁 + 自动 Anonymize + 校验） */
  async set(name: string, data: StudentProfileData): Promise<{ success: boolean; error?: string }> {
    return this.withLock(name, async () => {
      try {
        // 1. 校验学业成绩
        if (data.academicRecords && data.academicRecords.length > 0) {
          const errors = this.validateAcademicRecords(data.academicRecords)
          if (errors.length > 0) {
            return { success: false, error: `数据校验失败:\n${errors.join('\n')}` }
          }
        }

        // 2. 迁移旧数据
        const cleaned = this.migrateLegacyData(data)

        // 3. Anonymize 所有 PII 字段
        const anonymized = { ...cleaned } as Record<string, unknown>
        for (const field of PII_FIELDS) {
          const val = anonymized[field]
          if (val && typeof val === 'string') {
            try {
              const result = await eaaBridge.execute({
                command: 'privacy',
                args: ['anonymize', val],
              })
              if (result.success && result.data) {
                anonymized[field] = String(result.data).trim()
              }
            } catch { /* keep as-is */ }
          }
        }

        // 4. 序列化后直接写入（逐字段 PII 脱敏已在步骤 3 完成，无需全文过隐私引擎）
        const anoPath = await this.anonymizedPath(name)
        const json = JSON.stringify(anonymized, null, 2)

        // 5. 原子写入（tmp → fsync → rename）
        const tmpPath = `${anoPath}.tmp`
        fs.writeFileSync(tmpPath, json, 'utf-8')
        // 强制刷盘（防止断电/崩溃时数据丢失）
        const fd = fs.openSync(tmpPath, 'r')
        fs.fsyncSync(fd)
        fs.closeSync(fd)
        fs.renameSync(tmpPath, anoPath)

        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: msg }
      }
    })
  }

  /** 部分更新学生扩展档案（合并） */
  async update(name: string, patch: Partial<StudentProfileData>): Promise<{ success: boolean; error?: string }> {
    const existing = await this.get(name)
    const merged = { ...existing, ...patch }
    return this.set(name, merged)
  }

  /** 添加一条学业成绩记录（便捷方法，仅被 eaa-tools 调用） */
  async addAcademicRecord(
    name: string,
    record: AcademicExamRecord,
  ): Promise<{ success: boolean; error?: string }> {
    const errs = this.validateAcademicRecords([record])
    if (errs.length > 0) {
      return { success: false, error: errs.join('\n') }
    }
    const existing = await this.get(name)
    const records = existing.academicRecords ?? []
    // 用 (examType + examName + date) 三元组判重，降低误覆盖风险
    const duplicateIdx = records.findIndex(
      (r) => r.examName === record.examName && r.examType === record.examType && r.date === record.date,
    )
    if (duplicateIdx >= 0) {
      console.warn(`[ProfileService] Overwriting duplicate academic record: ${record.examName} (${record.examType})`)
      records[duplicateIdx] = record
    } else {
      records.push(record)
    }
    return this.set(name, { ...existing, academicRecords: records })
  }

  /** 获取某学生的所有学业记录 */
  async getAcademicRecords(name: string): Promise<AcademicExamRecord[]> {
    const data = await this.get(name)
    return data.academicRecords ?? []
  }
}

export const profileService = new ProfileService()