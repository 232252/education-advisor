// =============================================================
// Student Profile Service — 学生扩展档案存储
// 存储于 eaa-data/profiles/{name}.json
// H-11 修复: get/set/update 改为异步,避免同步 fs 阻塞主进程事件循环
// =============================================================

import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { parseChineseIdCard } from '@shared/id-card'
import type { StudentProfileData } from '@shared/types'
import { atomicWrite } from '../utils/atomic-write'
import { errText } from '../utils/err-text'
import { readJsonOr, safeFileName } from '../utils/json-file'
import { getAppPaths } from './paths'

function enrichFromIdCard(data: StudentProfileData): StudentProfileData {
  const raw = data.idCard
  if (typeof raw !== 'string' || !raw.trim()) return data
  const parsed = parseChineseIdCard(raw)
  if (!parsed) return data
  return {
    ...data,
    idCard: parsed.idCard,
    gender: parsed.gender,
    birthDate: parsed.birthDate,
  }
}

class ProfileService {
  private profilesDir: string

  constructor() {
    // R2-17: 统一经 path-resolver(此前硬编码 userData/eaa-data/profiles,dev 分叉)
    this.profilesDir = getAppPaths().profilesDir
    // 确保目录存在 (同步,仅启动时执行一次)
    if (!existsSync(this.profilesDir)) {
      mkdirSync(this.profilesDir, { recursive: true })
    }
  }

  private profilePath(name: string): string {
    // 防止路径遍历攻击(共享实现见 utils/json-file)
    return path.join(this.profilesDir, `${safeFileName(name)}.json`)
  }

  /** 读取学生扩展档案 */
  // H-11 修复: 改为异步,避免阻塞主进程
  async get(name: string): Promise<StudentProfileData> {
    // 文件不存在(ENOENT)或 JSON 解析失败时返回空对象
    return readJsonOr(this.profilePath(name), {} as StudentProfileData)
  }

  /** 写入学生扩展档案（全量覆盖） */
  // H-11 修复: 改为异步,避免阻塞主进程
  // 原手写 fd+fsync+rename 序列已换 atomicWrite(唯一权威实现):
  // 同样的唯一临时名+落盘后 rename 语义,额外获得 EPERM/EACCES/EBUSY 重试
  async set(name: string, data: StudentProfileData): Promise<{ success: boolean; error?: string }> {
    try {
      const filePath = this.profilePath(name)
      await atomicWrite(filePath, JSON.stringify(enrichFromIdCard(data), null, 2))
      return { success: true }
    } catch (err) {
      const msg = errText(err)
      return { success: false, error: msg }
    }
  }

  /** 部分更新学生扩展档案（合并） */
  // H-11 修复: 改为异步
  async update(
    name: string,
    patch: Partial<StudentProfileData>,
  ): Promise<{ success: boolean; error?: string }> {
    const existing = await this.get(name)
    const merged = { ...existing, ...patch }
    return this.set(name, merged)
  }
}

export const profileService = new ProfileService()
