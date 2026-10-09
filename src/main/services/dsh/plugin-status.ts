// =============================================================
// 插件中心读安装戳，不把「已安装」写死在界面上。
//
// 花名册、成绩、批改、操行要同时出现在教师对话（sdk）和连接中心（web）。
// 聊天连接只装在 web。戳的内容和 plugin-install / im-host 写入的一致。
// =============================================================

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EducationPluginInstall } from '@shared/api/dsh-im'
import { EAA_PLUGINS } from './eaa-tools-contract'

const INSTALL_KEY: Record<string, keyof Omit<EducationPluginInstall, 'im'>> = {
  'eaa-roster': 'roster',
  'eaa-grades': 'grades',
  'eaa-grading': 'grading',
  'eaa-tools': 'conduct',
}

export function readEducationPluginInstall(opts: {
  vendorRoot: string
  sdkHome: string
  webHome: string
  imStampName: string
  imStampValue: string
}): EducationPluginInstall {
  const row: EducationPluginInstall = {
    im: stampFileMatches(join(opts.webHome, opts.imStampName), opts.imStampValue),
    roster: false,
    grades: false,
    grading: false,
    conduct: false,
  }
  for (const plugin of EAA_PLUGINS) {
    const key = INSTALL_KEY[plugin.dirName]
    if (!key) continue
    const stamp = packageStamp(join(opts.vendorRoot, plugin.dirName))
    row[key] =
      stamp !== null &&
      profileHas(opts.sdkHome, 'sdk', plugin.dirName, stamp) &&
      profileHas(opts.webHome, 'web', plugin.dirName, stamp)
  }
  return row
}

function packageStamp(dir: string): string | null {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string }
    const dirName = dir.split(/[\\/]/).pop() ?? 'plugin'
    return `${pkg.name ?? dirName}@${pkg.version ?? '0'}`
  } catch {
    return null
  }
}

function profileHas(home: string, profile: 'sdk' | 'web', dirName: string, stamp: string): boolean {
  if (stampFileMatches(join(home, `eaa-plugin.${profile}.${dirName}.stamp`), stamp)) return true
  if (dirName !== 'eaa-tools') return false
  return stampFileMatches(join(home, `eaa-tools.${profile}.stamp`), stamp)
}

function stampFileMatches(path: string, stamp: string): boolean {
  if (!existsSync(path)) return false
  try {
    return readFileSync(path, 'utf8').trim() === stamp
  } catch {
    return false
  }
}
