// =============================================================
// backup-service 测试 — 备份打包/恢复 round-trip / manifest 校验 /
// 条目白名单拒绝 / 备份列表与清理 / deleteAutoBackup 路径安全
// electron / db-service / eaa-bridge / settings-service 全部 mock,
// 文件系统用真实临时目录(覆盖真实读写语义)。
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpRoot = path.join(
  os.tmpdir(),
  `backup-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  getDbPath: vi.fn(() => dbPath),
  dbClose: vi.fn(async () => {}),
  eaaShutdown: vi.fn(() => {}),
  getDataDir: vi.fn(() => eaaDataDir),
  settingsGet: vi.fn(),
  settingsUpdate: vi.fn(),
  settingsFlush: vi.fn(async () => {}),
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath, getVersion: mocks.getVersion },
}))

vi.mock('../../../src/main/services/db-service', () => ({
  dbService: { getDbPath: mocks.getDbPath, close: mocks.dbClose },
}))

vi.mock('../../../src/main/services/eaa-bridge', () => ({
  eaaBridge: { getDataDir: mocks.getDataDir, shutdown: mocks.eaaShutdown },
}))

vi.mock('../../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: mocks.settingsGet,
    update: mocks.settingsUpdate,
    flush: mocks.settingsFlush,
  },
}))

const {
  createBackup,
  deleteAutoBackup,
  isAutoBackupDue,
  listAutoBackups,
  pruneBackups,
  restoreFromZip,
  validateManifest,
} = await import('../../../src/main/services/backup-service')
const { createZip } = await import('../../../src/main/utils/zip')

async function seedWorkspace(): Promise<void> {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
  await fsp.mkdir(userDataDir, { recursive: true })
  await fsp.mkdir(path.join(eaaDataDir, 'entities'), { recursive: true })
  await fsp.mkdir(path.join(eaaDataDir, 'events'), { recursive: true })

  await fsp.writeFile(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ general: { theme: 'light' } }),
    'utf-8',
  )
  await fsp.writeFile(path.join(userDataDir, 'cron-logs.jsonl'), '{"n":1}\n', 'utf-8')
  await fsp.writeFile(path.join(userDataDir, 'cron.user.json'), '[]', 'utf-8')
  await fsp.writeFile(
    path.join(eaaDataDir, 'entities', 'entities.json'),
    JSON.stringify({ version: '1.0', base_score: 100, entities: { 张三: {} } }),
    'utf-8',
  )
  await fsp.writeFile(path.join(eaaDataDir, 'events', 'events.jsonl'), 'evt-1\nevt-2\n', 'utf-8')
  await fsp.writeFile(path.join(eaaDataDir, '.lock'), 'lock', 'utf-8')
  await fsp.writeFile(dbPath, Buffer.from([0x53, 0x51, 0x4c, 0x00, 0x01]))
  await fsp.writeFile(`${dbPath}-wal`, Buffer.from('wal-data'))
}

function makeManifest(files: Array<{ name: string; size: number }>): Buffer {
  return Buffer.from(
    JSON.stringify({
      app: 'education-advisor',
      appVersion: '0.1.0-test',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      files,
    }),
    'utf-8',
  )
}

describe('validateManifest', () => {
  it('合法 manifest 通过', () => {
    const m = validateManifest(JSON.parse(makeManifest([{ name: 'a', size: 1 }]).toString('utf-8')))
    expect(m.app).toBe('education-advisor')
    expect(m.formatVersion).toBe(1)
  })

  it('非本应用备份拒绝', () => {
    expect(() => validateManifest({ app: 'other-app', formatVersion: 1, files: [] })).toThrow(
      'not an education-advisor backup',
    )
  })

  it('不支持的格式版本拒绝', () => {
    expect(() =>
      validateManifest({ app: 'education-advisor', formatVersion: 99, files: [] }),
    ).toThrow('unsupported backup format version')
  })

  it('缺 files 数组拒绝', () => {
    expect(() => validateManifest({ app: 'education-advisor', formatVersion: 1 })).toThrow(
      'manifest.files missing',
    )
  })
})

describe('isAutoBackupDue', () => {
  it('从未备份 → 到期', () => {
    expect(isAutoBackupDue(undefined, 24)).toBe(true)
    expect(isAutoBackupDue(0, 24)).toBe(true)
  })

  it('未到间隔 → 未到期', () => {
    expect(isAutoBackupDue(Date.now() - 3600_000, 24)).toBe(false)
  })

  it('超过间隔 → 到期', () => {
    expect(isAutoBackupDue(Date.now() - 25 * 3600_000, 24)).toBe(true)
  })
})

describe('createBackup / restoreFromZip', () => {
  beforeAll(seedWorkspace)

  it('createBackup 打包白名单文件(排除 .lock)并写入 manifest', async () => {
    const dest = path.join(tmpRoot, 'backup.zip')
    const result = await createBackup(dest)

    expect(result.files).toBeGreaterThan(0)
    const stat = await fsp.stat(dest)
    expect(stat.size).toBeGreaterThan(0)

    const { readZipFile } = await import('../../../src/main/utils/zip')
    const entries = await readZipFile(dest)
    const names = entries.map((e) => e.name)
    expect(names).toContain('manifest.json')
    expect(names).toContain('settings.json')
    expect(names).toContain('cron-logs.jsonl')
    expect(names).toContain('cron.user.json')
    expect(names).toContain('workstation.db')
    expect(names).toContain('workstation.db-wal')
    expect(names).toContain('eaa-data/entities/entities.json')
    expect(names).toContain('eaa-data/events/events.jsonl')
    // .lock 是运行时锁文件,必须排除
    expect(names).not.toContain('eaa-data/.lock')

    const manifest = JSON.parse(
      entries.find((e) => e.name === 'manifest.json')!.data.toString('utf-8'),
    )
    expect(manifest.app).toBe('education-advisor')
    expect(manifest.formatVersion).toBe(1)
    expect(manifest.files.length).toBe(result.files)
  })

  it('restoreFromZip 恢复被修改的数据(含中文内容)', async () => {
    const dest = path.join(tmpRoot, 'backup.zip')

    // 模拟数据被破坏
    const entitiesPath = path.join(eaaDataDir, 'entities', 'entities.json')
    await fsp.writeFile(entitiesPath, 'CORRUPTED', 'utf-8')

    const result = await restoreFromZip(dest)
    expect(result.restoredFiles).toBeGreaterThan(0)
    expect(result.safetyBackupPath).toContain('pre-restore-')

    // 数据已恢复
    const restored = JSON.parse(await fsp.readFile(entitiesPath, 'utf-8'))
    expect(restored.entities).toHaveProperty('张三')
    // db/EAA 持有者在替换文件前被关闭
    expect(mocks.dbClose).toHaveBeenCalled()
    expect(mocks.eaaShutdown).toHaveBeenCalled()
  })

  it('无 manifest 的 zip 拒绝恢复', async () => {
    const evil = path.join(tmpRoot, 'no-manifest.zip')
    const zipBuf = createZip([{ name: 'settings.json', data: Buffer.from('{}', 'utf-8') }])
    await fsp.writeFile(evil, zipBuf)
    await expect(restoreFromZip(evil)).rejects.toThrow('manifest.json not found')
  })

  it('伪造 app 标识的 manifest 拒绝恢复', async () => {
    const evil = path.join(tmpRoot, 'wrong-app.zip')
    const zipBuf = createZip([
      {
        name: 'manifest.json',
        data: Buffer.from(
          JSON.stringify({ app: 'other', appVersion: '1', formatVersion: 1, createdAt: '', files: [] }),
          'utf-8',
        ),
      },
      { name: 'settings.json', data: Buffer.from('{}', 'utf-8') },
    ])
    await fsp.writeFile(evil, zipBuf)
    await expect(restoreFromZip(evil)).rejects.toThrow('not an education-advisor backup')
  })

  it('包含未知条目的 zip 拒绝恢复(zip-slip 白名单)', async () => {
    const evil = path.join(tmpRoot, 'evil-entry.zip')
    const zipBuf = createZip([
      { name: 'manifest.json', data: makeManifest([]) },
      { name: 'evil/evil.txt', data: Buffer.from('x', 'utf-8') },
    ])
    await fsp.writeFile(evil, zipBuf)
    await expect(restoreFromZip(evil)).rejects.toThrow('unknown backup entry: evil/evil.txt')
  })
})

describe('listAutoBackups / deleteAutoBackup / pruneBackups', () => {
  const backupsDir = () => path.join(userDataDir, 'backups')

  beforeEach(async () => {
    await fsp.rm(backupsDir(), { recursive: true, force: true })
    await fsp.mkdir(backupsDir(), { recursive: true })
  })

  it('listAutoBackups 按时间倒序,识别 pre-restore 类型', async () => {
    const dir = backupsDir()
    await fsp.writeFile(path.join(dir, 'auto-1.zip'), 'aaa')
    await fsp.writeFile(path.join(dir, 'auto-2.zip'), 'bbb')
    await fsp.writeFile(path.join(dir, 'pre-restore-1.zip'), 'ccc')
    await fsp.writeFile(path.join(dir, 'not-a-zip.txt'), 'ddd')

    // 保证 mtime 顺序
    const now = Date.now()
    await fsp.utimes(path.join(dir, 'auto-1.zip'), new Date(now - 3000), new Date(now - 3000))
    await fsp.utimes(path.join(dir, 'auto-2.zip'), new Date(now - 2000), new Date(now - 2000))
    await fsp.utimes(path.join(dir, 'pre-restore-1.zip'), new Date(now - 1000), new Date(now - 1000))

    const list = await listAutoBackups()
    expect(list.map((b) => b.fileName)).toEqual(['pre-restore-1.zip', 'auto-2.zip', 'auto-1.zip'])
    expect(list[0].kind).toBe('pre-restore')
    expect(list[1].kind).toBe('auto')
  })

  it('deleteAutoBackup 拒绝路径穿越/非法文件名', async () => {
    await expect(deleteAutoBackup('../evil.zip')).rejects.toThrow('invalid backup file name')
    await expect(deleteAutoBackup('a/b.zip')).rejects.toThrow('invalid backup file name')
    await expect(deleteAutoBackup('notzip.txt')).rejects.toThrow('not a backup zip')
  })

  it('pruneBackups 只保留最新 keep 份', async () => {
    const dir = backupsDir()
    for (let i = 0; i < 5; i++) {
      const p = path.join(dir, `auto-${i}.zip`)
      await fsp.writeFile(p, `content-${i}`)
      const t = new Date(Date.now() - (10 - i) * 1000)
      await fsp.utimes(p, t, t)
    }
    const removed = await pruneBackups(3)
    expect(removed).toBe(2)
    const list = await listAutoBackups()
    expect(list.length).toBe(3)
    // 保留的是最新的
    expect(list.map((b) => b.fileName)).toEqual(['auto-4.zip', 'auto-3.zip', 'auto-2.zip'])
  })
})

afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})
