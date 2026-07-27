// =============================================================
// Student Profile Service — 学生扩展档案存储
// 存储于 eaa-data/profiles/{name}.json
// H-11 修复: get/set/update 改为异步,避免同步 fs 阻塞主进程事件循环
// =============================================================

import { existsSync, mkdirSync } from 'node:fs'
import { open, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { StudentProfileData } from '../../shared/types'

class ProfileService {
  private profilesDir: string

  constructor() {
    this.profilesDir = path.join(app.getPath('userData'), 'eaa-data', 'profiles')
    // 确保目录存在 (同步,仅启动时执行一次)
    if (!existsSync(this.profilesDir)) {
      mkdirSync(this.profilesDir, { recursive: true })
    }
  }

  private profilePath(name: string): string {
    // 防止路径遍历攻击
    const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
    return path.join(this.profilesDir, `${safeName}.json`)
  }

  /** 读取学生扩展档案 */
  // H-11 修复: 改为异步,避免阻塞主进程
  async get(name: string): Promise<StudentProfileData> {
    const filePath = this.profilePath(name)
    try {
      const content = await readFile(filePath, 'utf-8')
      return JSON.parse(content) as StudentProfileData
    } catch {
      // 文件不存在(ENOENT)或 JSON 解析失败时返回空对象
      return {}
    }
  }

  /** 写入学生扩展档案（全量覆盖） */
  // H-11 修复: 改为异步,避免阻塞主进程
  // 修复: 使用唯一临时文件名避免 Windows 上 writeFile+rename 的竞态条件
  // 修复: 通过单个 fd 写入+fsync 确保数据落盘后再 rename (避免 Windows 缓存导致读到旧数据)
  async set(name: string, data: StudentProfileData): Promise<{ success: boolean; error?: string }> {
    try {
      const filePath = this.profilePath(name)
      const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
      const json = JSON.stringify(data, null, 2)
      // 用 'w' 模式打开,通过 fd 写入 + fsync,确保数据落盘后再 rename
      const fd = await open(tmpPath, 'w')
      try {
        await fd.writeFile(json, 'utf-8')
        await fd.sync()
      } finally {
        await fd.close()
      }
      await rename(tmpPath, filePath)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
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
