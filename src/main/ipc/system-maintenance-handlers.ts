// =============================================================
// 系统维护 IPC Handlers — 数据重置 / 清理
// 提供：出厂重置、按班级删除、按学期删除
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import { eaaBridge } from '../services/eaa-bridge'

function getEaaDataDir(): string {
  return path.join(app.getPath('userData'), 'eaa-data')
}

export function registerSystemMaintenanceHandlers() {
  // ===== 全量重置（清空所有学生 + 事件 + 档案）=====
  ipcMain.handle(IPC.IPC_SYS_RESET_FACTORY, async () => {
    try {
      const dataDir = getEaaDataDir()
      // 清空子目录
      for (const sub of ['entities', 'events', 'profiles', 'privacy']) {
        const dir = path.join(dataDir, sub)
        if (fs.existsSync(dir)) {
          for (const file of fs.readdirSync(dir)) {
            fs.rmSync(path.join(dir, file), { recursive: true, force: true })
          }
        }
      }
      // 删除文件锁
      const lockFile = path.join(dataDir, '.lock')
      if (fs.existsSync(lockFile)) fs.rmSync(lockFile)

      // 通知 EAA CLI 重置（stop + start 间清空）
      // 让桥接层下次调用时重新初始化
      return { success: true, message: '已清空所有学生、事件与档案数据。请重启应用生效。' }
    } catch (err) {
      return {
        success: false,
        message: `重置失败: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ===== 按班级删除学生 =====
  ipcMain.handle(IPC.IPC_SYS_DELETE_BY_CLASS, async (_e, classId: string) => {
    try {
      if (!classId || typeof classId !== 'string') {
        return { success: false, message: '请提供班级名称' }
      }
      // 1. 获取所有学生
      const listResult = await eaaBridge.execute({ command: 'list-students', args: [] })
      if (!listResult.success || !listResult.data) {
        return { success: false, message: '无法获取学生列表' }
      }
      const students =
        (listResult.data as { students: Array<{ name: string; class_id?: string }> }).students || []
      const matched = students.filter((s) => s.class_id === classId)

      if (matched.length === 0) {
        return { success: true, message: `班级"${classId}"下没有找到学生`, deleted: 0 }
      }

      // 2. 逐个删除
      let deleted = 0
      for (const s of matched) {
        await eaaBridge.execute({ command: 'delete-student', args: [s.name, '--confirm'] })
        deleted++
      }

      // 3. 同时清理 profiles
      const profilesDir = path.join(getEaaDataDir(), 'profiles')
      if (fs.existsSync(profilesDir)) {
        for (const s of matched) {
          const safeName = s.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
          const fp = path.join(profilesDir, `${safeName}.json`)
          if (fs.existsSync(fp)) fs.rmSync(fp)
        }
      }

      return { success: true, message: `已删除班级"${classId}"的 ${deleted} 名学生`, deleted }
    } catch (err) {
      return {
        success: false,
        message: `删除失败: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ===== 按名称删除单个学生 =====
  ipcMain.handle(IPC.IPC_SYS_DELETE_STUDENT_BY_NAME, async (_e, name: string) => {
    try {
      if (!name || typeof name !== 'string') {
        return { success: false, message: '请提供学生姓名' }
      }
      const result = await eaaBridge.execute({
        command: 'delete-student',
        args: [name, '--confirm'],
      })
      if (!result.success) {
        return { success: false, message: `删除学生失败: ${result.stderr || '未知错误'}` }
      }
      // 清理 profile
      const profilesDir = path.join(getEaaDataDir(), 'profiles')
      const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
      const fp = path.join(profilesDir, `${safeName}.json`)
      if (fs.existsSync(fp)) fs.rmSync(fp)

      return { success: true, message: `已删除学生"${name}"` }
    } catch (err) {
      return {
        success: false,
        message: `删除失败: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  // ===== 重置到仅保留学生名单（清除所有事件）=====
  ipcMain.handle(IPC.IPC_SYS_RESET_EVENTS_ONLY, async () => {
    try {
      const eventsDir = path.join(getEaaDataDir(), 'events')
      if (fs.existsSync(eventsDir)) {
        for (const file of fs.readdirSync(eventsDir)) {
          fs.rmSync(path.join(eventsDir, file), { recursive: true, force: true })
        }
      }
      return { success: true, message: '已清空所有事件记录，学生名单保留' }
    } catch (err) {
      return {
        success: false,
        message: `清空事件失败: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })

  console.log('[IPC] System maintenance handlers registered')
}
