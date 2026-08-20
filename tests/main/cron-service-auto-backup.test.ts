// =============================================================
// M33 自动备份调度测试 — cron 注册/注销/重绑/到点触发
// 覆盖规格四条验证:
//   (a) 开启开关 → cron-service 注册了 auto-backup 备份任务
//   (b) 关闭开关 → 任务注销消失
//   (c) 改 cron 表达式 → 幂等 upsert 重绑(无重复任务)
//   (d) 到点触发(triggerScheduled 与 cron 回调同路径) →
//       backup-service 的 runAutoBackupOnce 被调用,backups/ 生成 auto-*.zip
// mock 模式参考 cron-service-exec.test.ts + backup-service.test.ts:
// electron/db-service/eaa-bridge/settings-service/keystore/feishu 全 mock,
// backup-service 与 cron-service 走真实代码(覆盖真实调度与打包语义)。
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(
  os.tmpdir(),
  `cron-auto-backup-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)
const userDataDir = path.join(tmpRoot, 'userData')
const eaaDataDir = path.join(tmpRoot, 'eaa-data')
const dbPath = path.join(tmpRoot, 'workstation.db')

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return userDataDir
    throw new Error(`Unexpected path: ${name}`)
  }),
  getVersion: vi.fn(() => '0.1.0-test'),
  isPackaged: false,
  webContentsSend: vi.fn(),
  getDbPath: vi.fn(() => dbPath),
  dbClose: vi.fn(async () => {}),
  eaaShutdown: vi.fn(() => {}),
  getDataDir: vi.fn(() => eaaDataDir),
  settingsGet: vi.fn(),
  settingsUpdate: vi.fn(),
  settingsFlush: vi.fn(async () => {}),
}))

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
    getVersion: mocks.getVersion,
    isPackaged: mocks.isPackaged,
  },
  BrowserWindow: class {},
}))

vi.mock('../../src/main/services/db-service', () => ({
  dbService: { getDbPath: mocks.getDbPath, close: mocks.dbClose },
}))

vi.mock('../../src/main/services/eaa-bridge', () => ({
  eaaBridge: { getDataDir: mocks.getDataDir, shutdown: mocks.eaaShutdown },
}))

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: mocks.settingsGet,
    update: mocks.settingsUpdate,
    flush: mocks.settingsFlush,
  },
}))

// cron-service 顶层 import 链(bitable-sync)拉入的依赖,与本测试无关,mock 掉
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getSecret: vi.fn().mockReturnValue('') },
}))

vi.mock('../../src/main/services/feishu-service', () => ({
  syncBitableNow: vi.fn().mockResolvedValue({ success: true }),
}))

const { cronService } = await import('../../src/main/services/cron-service')
const {
  AUTO_BACKUP_AGENT_ID,
  AUTO_BACKUP_TASK_ID,
  resolveAutoBackupCronExpression,
} = await import('../../src/main/services/cron/auto-backup-task')

function setBackupSettings(enabled: boolean, cronExpr?: string): void {
  mocks.settingsGet.mockReturnValue({
    general: { timezone: 'Asia/Shanghai' },
    feishu: { bitableSync: { enabled: false, syncInterval: '0 */6 * * *' } },
    backup: {
      autoEnabled: false,
      intervalHours: 24,
      keep: 7,
      autoBackupEnabled: enabled,
      autoBackupCron: cronExpr ?? '0 3 * * *',
    },
  })
}

function makeFakeWin() {
  return {
    webContents: { send: mocks.webContentsSend },
    isDestroyed: () => false,
  } as unknown as import('electron').BrowserWindow
}

/** 造一份可备份的工作区(settings.json + eaa-data + db) */
async function seedWorkspace(): Promise<void> {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
  await fsp.mkdir(userDataDir, { recursive: true })
  await fsp.mkdir(path.join(eaaDataDir, 'entities'), { recursive: true })
  await fsp.writeFile(path.join(userDataDir, 'settings.json'), JSON.stringify({ backup: {} }), 'utf-8')
  await fsp.writeFile(
    path.join(eaaDataDir, 'entities', 'entities.json'),
    JSON.stringify({ version: '1.0', base_score: 100, entities: {} }),
    'utf-8',
  )
  await fsp.writeFile(dbPath, Buffer.from([0x53, 0x51, 0x4c, 0x00, 0x01]))
}

describe('resolveAutoBackupCronExpression', () => {
  it('合法表达式原样通过', () => {
    expect(resolveAutoBackupCronExpression('0 3 * * *')).toBe('0 3 * * *')
    expect(resolveAutoBackupCronExpression('30 4 * * 1')).toBe('30 4 * * 1')
  })

  it('非法/空表达式回退默认每日 03:00', () => {
    expect(resolveAutoBackupCronExpression('not a cron')).toBe('0 3 * * *')
    expect(resolveAutoBackupCronExpression('* * *')).toBe('0 3 * * *')
    expect(resolveAutoBackupCronExpression('')).toBe('0 3 * * *')
    expect(resolveAutoBackupCronExpression(undefined)).toBe('0 3 * * *')
  })
})

describe('M33 自动备份 cron 注册/重绑', () => {
  beforeAll(async () => {
    await fsp.mkdir(userDataDir, { recursive: true })
    setBackupSettings(false)
  })

  beforeEach(() => {
    cronService.removeTask(AUTO_BACKUP_TASK_ID)
    mocks.settingsUpdate.mockClear()
    mocks.webContentsSend.mockClear()
  })

  afterAll(async () => {
    await cronService.shutdown()
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
    vi.restoreAllMocks()
  })

  it('(a) 开启开关 → cron 任务列表出现备份任务(表达式/agentId/enabled 正确)', () => {
    setBackupSettings(true, '0 3 * * *')
    cronService.registerAutoBackup()

    const task = cronService.listTasks().find((t) => t.id === AUTO_BACKUP_TASK_ID)
    expect(task).toBeDefined()
    expect(task?.agentId).toBe(AUTO_BACKUP_AGENT_ID)
    expect(task?.expression).toBe('0 3 * * *')
    expect(task?.enabled).toBe(true)
    // 已绑定 node-cron job(有下次执行时间)
    expect(cronService.getNextRunAt(AUTO_BACKUP_TASK_ID)).toBeDefined()
  })

  it('默认关闭时注册不产生任务', () => {
    setBackupSettings(false)
    cronService.registerAutoBackup()
    expect(cronService.listTasks().some((t) => t.id === AUTO_BACKUP_TASK_ID)).toBe(false)
  })

  it('(b) 开启后再关闭 → 任务注销消失', () => {
    setBackupSettings(true)
    cronService.registerAutoBackup()
    expect(cronService.listTasks().some((t) => t.id === AUTO_BACKUP_TASK_ID)).toBe(true)

    setBackupSettings(false)
    cronService.registerAutoBackup()
    expect(cronService.listTasks().some((t) => t.id === AUTO_BACKUP_TASK_ID)).toBe(false)
    expect(cronService.getNextRunAt(AUTO_BACKUP_TASK_ID)).toBeUndefined()
  })

  it('(c) 改 cron 表达式 → 幂等 upsert 重绑,无重复任务', () => {
    setBackupSettings(true, '0 3 * * *')
    cronService.registerAutoBackup()

    setBackupSettings(true, '30 4 * * *')
    cronService.registerAutoBackup()

    const tasks = cronService.listTasks().filter((t) => t.id === AUTO_BACKUP_TASK_ID)
    expect(tasks.length).toBe(1)
    expect(tasks[0]?.expression).toBe('30 4 * * *')
    expect(cronService.getNextRunAt(AUTO_BACKUP_TASK_ID)).toBeDefined()
  })

  it('settings 中表达式非法 → 注册时回退默认每日 03:00', () => {
    setBackupSettings(true, 'not-a-cron')
    cronService.registerAutoBackup()

    const task = cronService.listTasks().find((t) => t.id === AUTO_BACKUP_TASK_ID)
    expect(task?.expression).toBe('0 3 * * *')
  })
})

describe('M33 到点触发执行备份', () => {
  beforeAll(seedWorkspace)

  beforeEach(() => {
    cronService.removeTask(AUTO_BACKUP_TASK_ID)
    mocks.settingsUpdate.mockClear()
    mocks.webContentsSend.mockClear()
  })

  it('(d) triggerScheduled 到点触发 → 生成 auto-*.zip 于备份目录并记录成功', async () => {
    setBackupSettings(true, '0 3 * * *')
    cronService.registerAutoBackup()
    cronService.setMainWindow(makeFakeWin())

    // triggerScheduled 与 node-cron 定时回调走同一路径(executeTask source='cron')
    await cronService.triggerScheduled(AUTO_BACKUP_TASK_ID)

    const task = cronService.listTasks().find((t) => t.id === AUTO_BACKUP_TASK_ID)
    expect(task?.lastStatus).toBe('success')
    expect(task?.lastRunAt).toBeDefined()
    // lastAutoAt 已记录
    expect(mocks.settingsUpdate).toHaveBeenCalledWith('backup.lastAutoAt', expect.any(Number))

    // backups/ 目录生成 auto-*.zip
    const backupsDir = path.join(userDataDir, 'backups')
    const names = await fsp.readdir(backupsDir)
    expect(names.some((n) => /^auto-.*\.zip$/.test(n))).toBe(true)

    // 成功日志已记录
    const logs = cronService.getLogs(AUTO_BACKUP_TASK_ID)
    expect(logs.some((l) => l.status === 'success')).toBe(true)
  })
})
