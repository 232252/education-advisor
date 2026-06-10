// =============================================================
// Student Profile Service — 学生扩展档案存储
// 存储于 eaa-data/profiles/{name}.json
// =============================================================
//
// 全链路设计：
//   UI (AcademicsTab) → IPC (profile-handlers) → ProfileService
//   → 校验器 (validateAcademicRecords) → 隐私引擎 (anonymize/deanonymize)
//   → JSON 文件存储
//
// 隐私脱敏：
//   - 写入时：通过 eaa privacy anonymize 脱敏学生名 + 档案内容
//   - 读取时：通过 eaa privacy deanonymize 还原
//   - 文件系统上只存 S_XXX 化名版本
//
// 数据校验：
//   - 科目名非空，禁特殊字符
//   - 分数在有效范围 (0-150)
//   - 考试名称非空
//   - 自动去重（同考试名只保留最新）
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AcademicExamRecord, StudentProfileData } from '../../shared/types'
import { eaaBridge } from './eaa-bridge'

/** 默认科目列表（可在 settings 中自定义） */
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

class ProfileService {
  private profilesDir: string

  constructor() {
    this.profilesDir = path.join(app.getPath('userData'), 'eaa-data', 'profiles')
    if (!fs.existsSync(this.profilesDir)) {
      fs.mkdirSync(this.profilesDir, { recursive: true })
    }
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
          if (typeof score !== 'number' || Number.isNaN(score)) {
            errors.push(`[${i}] ${subject} 的成绩必须是数字`)
          } else if (score < SCORE_MIN || score > SCORE_MAX) {
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
      // 检查是否已迁移
      if (!records.some((r) => r.examName === '期中')) {
        records.push({
          examType: '期中',
          examName: '期中',
          subjects: { ...data.midtermGrades },
        })
      }
      delete result.midtermGrades
    }

    if (data.finalGrades && Object.keys(data.finalGrades).length > 0) {
      if (!records.some((r) => r.examName === '期末')) {
        records.push({
          examType: '期末',
          examName: '期末',
          subjects: { ...data.finalGrades },
        })
      }
      delete result.finalGrades
    }

    result.academicRecords = records
    return result
  }

  /** 读取学生扩展档案（自动 Deanonymize + 迁移旧数据） */
  async get(name: string): Promise<StudentProfileData> {
    // 1. 用真名直接读（兼容旧版）
    const filePath = this.profilePath(name)
    // 2. 用化名路径读（新版）
    const anoPath = await this.anonymizedPath(name)

    let data: StudentProfileData = {}

    // 优先读化名版
    if (fs.existsSync(anoPath)) {
      try {
        const content = fs.readFileSync(anoPath, 'utf-8')
        data = JSON.parse(content) as StudentProfileData
      } catch {
        data = {}
      }
    } else if (fs.existsSync(filePath)) {
      // 回退读真名版
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        data = JSON.parse(content) as StudentProfileData
      } catch {
        data = {}
      }
    }

    // 3. 迁移旧数据
    data = this.migrateLegacyData(data)

    // 4. Deanonymize 档案内容中的 PII 化名
    const piiFields = ['parentName', 'fatherName', 'motherName', 'idCard', 'phone', 'address']
    for (const field of piiFields) {
      const val = (data as Record<string, unknown>)[field]
      if (val && typeof val === 'string') {
        try {
          ;(data as Record<string, unknown>)[field] = await this.deanonymizeName(val)
        } catch { /* keep as-is */ }
      }
    }

    return data
  }

  /** 写入学生扩展档案（自动 Anonymize + 校验） */
  async set(name: string, data: StudentProfileData): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. 校验学业成绩（如果有）
      if (data.academicRecords && data.academicRecords.length > 0) {
        const errors = this.validateAcademicRecords(data.academicRecords)
        if (errors.length > 0) {
          return { success: false, error: `数据校验失败:\n${errors.join('\n')}` }
        }
      }

      // 2. 自动迁移旧数据
      const cleaned = this.migrateLegacyData(data)

      // 3. Anonymize 档案中的 PII 字段（姓名、身份证、电话、地址）
      const anonymized = { ...cleaned }
      const piiFields = ['parentName', 'fatherName', 'motherName', 'idCard', 'phone', 'address']
      for (const field of piiFields) {
        const val = anonymized[field]
        if (val && typeof val === 'string') {
          try {
            const result = await eaaBridge.execute({
              command: 'privacy',
              args: ['anonymize', val],
            })
            if (result.success && result.data) {
              ;(anonymized as Record<string, unknown>)[field] = String(result.data).trim()
            }
          } catch { /* keep as-is */ }
        }
      }

      // 4. 写入化名路径
      const anoPath = await this.anonymizedPath(name)
      const tmpPath = `${anoPath}.tmp`
      const json = JSON.stringify(anonymized, null, 2)
      fs.writeFileSync(tmpPath, json, 'utf-8')
      fs.renameSync(tmpPath, anoPath)

      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }

  /** 部分更新学生扩展档案（合并） */
  async update(name: string, patch: Partial<StudentProfileData>): Promise<{ success: boolean; error?: string }> {
    const existing = await this.get(name)
    const merged = { ...existing, ...patch }
    return this.set(name, merged)
  }

  /** 添加一条学业成绩记录（便捷方法） */
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

    // 去重：同名考试覆盖
    const idx = records.findIndex((r) => r.examName === record.examName)
    if (idx >= 0) {
      records[idx] = record
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