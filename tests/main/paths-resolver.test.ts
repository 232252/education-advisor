// =============================================================
// R2-17 统一路径解析器测试
// 覆盖: (a) dev 判定(resourcesPath 含 electron)
//       (b) 打包判定 + userData 布局
//       (c) EAA_DATA_DIR env 覆盖
//       (d) 旧位置 academics/profiles 一次性迁移 + 幂等
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => {
  const osTmp = require('node:os').tmpdir()
  const pathJoin = require('node:path').join
  const tmpUserData = pathJoin(osTmp, `paths-resolver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  return {
    userDataDir: tmpUserData,
    getPath: vi.fn((n: string) => (n === 'userData' ? tmpUserData : '')),
  }
})

vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }))

import {
  getAppPaths,
  isDevRuntime,
  resetAppPathsCache,
  resolveAppDataDir,
  resolveEaaDataDir,
} from '../../src/main/services/paths'

const savedResourcesPath = process.resourcesPath

function setDev(mode: 'dev' | 'packaged'): void {
  if (mode === 'dev') {
    // 模拟开发态:resourcesPath 指向 electron 安装目录
    Object.defineProperty(process, 'resourcesPath', {
      value: path.join(os.tmpdir(), 'node_modules', 'electron', 'dist', 'resources'),
      configurable: true,
    })
  } else {
    Object.defineProperty(process, 'resourcesPath', {
      value: path.join(os.tmpdir(), 'real-app-resources'),
      configurable: true,
    })
  }
}

beforeEach(() => {
  resetAppPathsCache()
  delete process.env.EAA_DATA_DIR
  fs.rmSync(mocks.userDataDir, { recursive: true, force: true })
  fs.mkdirSync(mocks.userDataDir, { recursive: true })
})

afterEach(() => {
  resetAppPathsCache()
  if (savedResourcesPath) {
    Object.defineProperty(process, 'resourcesPath', {
      value: savedResourcesPath,
      configurable: true,
    })
  }
})

describe('dev/packaged 判定', () => {
  it('dev: resourcesPath 含 electron → 项目根 .app-data / .eaa-data', () => {
    setDev('dev')
    expect(isDevRuntime()).toBe(true)
    const p = getAppPaths()
    expect(p.appDataDir.endsWith('.app-data')).toBe(true)
    expect(p.eaaDataDir.endsWith('.eaa-data')).toBe(true)
    expect(p.dbPath).toBe(path.join(p.appDataDir, 'workstation.db'))
    expect(p.academicsDir).toBe(path.join(p.appDataDir, 'academics'))
    expect(p.memoryDir).toBe(path.join(p.appDataDir, 'memory'))
  })

  it('packaged: resourcesPath 不含 electron → userData 布局', () => {
    setDev('packaged')
    expect(isDevRuntime()).toBe(false)
    const p = getAppPaths()
    expect(p.appDataDir).toBe(mocks.userDataDir)
    expect(p.eaaDataDir).toBe(path.join(mocks.userDataDir, 'eaa-data'))
    expect(p.dbPath).toBe(path.join(mocks.userDataDir, 'workstation.db'))
  })

  it('EAA_DATA_DIR env 覆盖 eaaDataDir(不影响 appData)', () => {
    setDev('packaged')
    process.env.EAA_DATA_DIR = '/tmp/env-override-eaa'
    expect(resolveEaaDataDir()).toBe('/tmp/env-override-eaa')
    expect(resolveAppDataDir()).toBe(mocks.userDataDir)
  })
})

describe('legacy 迁移(一次,幂等)', () => {
  it('userData/eaa-data/{academics,profiles} → appDataDir 对应目录,并写标记', () => {
    setDev('packaged')
    const legacy = path.join(mocks.userDataDir, 'eaa-data')
    fs.mkdirSync(path.join(legacy, 'academics'), { recursive: true })
    fs.mkdirSync(path.join(legacy, 'profiles'), { recursive: true })
    fs.writeFileSync(path.join(legacy, 'academics', 'config.json'), '{}')

    const p = getAppPaths()
    expect(fs.existsSync(path.join(p.appDataDir, 'academics', 'config.json'))).toBe(true)
    expect(fs.existsSync(path.join(legacy, 'academics'))).toBe(false)
    expect(fs.existsSync(path.join(p.appDataDir, '.r2-path-migrated'))).toBe(true)

    // 幂等:重置缓存后重跑不报错、不产生额外迁移
    resetAppPathsCache()
    const p2 = getAppPaths()
    expect(p2.appDataDir).toBe(p.appDataDir)
    expect(fs.existsSync(path.join(p2.appDataDir, 'academics', 'config.json'))).toBe(true)
  })
})
