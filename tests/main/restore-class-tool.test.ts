// =============================================================
// eaa_restore_class — 存档后的班级可以经对话恢复
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'

const mocks = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const tmpDir = `${tmpBase}${sep}restore-class-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    userDataDir: tmpDir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tmpDir
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath, isPackaged: false },
}))

import { classService } from '../../src/main/services/class-service'
import { dbService } from '../../src/main/services/db-service'
import { restoreClassTool } from '../../src/main/services/eaa/tools/class-tools'

beforeAll(async () => {
  await fsp.mkdir(mocks.userDataDir, { recursive: true })
})

afterAll(async () => {
  await dbService.close()
  // sqlite may still be releasing the directory while rm walks it.
  await fsp.rm(mocks.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('eaa_restore_class', () => {
  it('存档后的班级恢复到日常列表', async () => {
    if (!dbService.isReady()) {
      console.warn('SUPPRESS: skipping restore class tool (db disabled)')
      return
    }
    const created = classService.create({ class_id: 'G12-R', name: '高三恢复班' })
    expect(created.success).toBe(true)
    const id = created.data?.id
    expect(id).toBeTruthy()
    expect(classService.archive(id as string).success).toBe(true)
    expect(classService.list().find((c) => c.class_id === 'G12-R')?.archived).toBe(true)

    const result = await restoreClassTool.execute('r1', { class_id: 'G12-R' })
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    expect(text).toContain('已恢复')
    expect(classService.list().find((c) => c.class_id === 'G12-R')?.archived).toBe(false)
  })
})
