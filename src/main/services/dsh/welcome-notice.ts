// =============================================================
// 连接中心打开时跳过 dsh 的「预览版说明」
//
// 「预览版说明」存在 ui-settings-general.welcomeNoticeVersion。没确认过时，
// dsh web 会先弹一层。密钥弹层是 ui-settings-models 的 credentialOnboarding，
// 密钥已经在教育参谋的模型页里配，再弹会挡住飞书 / 微信登录。
// 版本号必须和当前 dsh 包里的 WELCOME_NOTICE_VERSION 逐字相同，
// 官方改了文案就会再出现一次，那是该看的更新，不要在这里写死成永远跳过。
// =============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { EaaCordisPatchRow } from './hardening'

/** 与 @deepseek-ai/dsh-client-ui-settings-models 的 WELCOME_NOTICE_VERSION 对齐。 */
export const DSH_WELCOME_NOTICE_VERSION = '2026-09-28.1'

export const EAA_WELCOME_PATCH_FILE = 'eaa-welcome-notice.cordis.patch.yml'

/** 在已安装的设置行 config 上只改这两个字段，其它键留着。 */
export function eaaWelcomeNoticePatchRows(installed?: {
  general?: Record<string, unknown>
  models?: Record<string, unknown>
}): EaaCordisPatchRow[] {
  return [
    {
      id: 'ui-settings-general',
      config: {
        ...(installed?.general ?? {}),
        welcomeNoticeVersion: DSH_WELCOME_NOTICE_VERSION,
      },
    },
    {
      // 密钥在教育参谋自己的模型页里配，再由宿主注入子进程。
      // 这里再弹一层会挡住飞书 / 微信登录。
      id: 'ui-settings-models',
      config: { ...(installed?.models ?? {}), credentialOnboarding: false },
    },
  ]
}

function configOf(node: unknown, id: string): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = configOf(item, id)
      if (found) return found
    }
    return undefined
  }
  const rec = node as { id?: unknown; config?: unknown; insert?: unknown }
  if (rec.id === id && rec.config && typeof rec.config === 'object' && !Array.isArray(rec.config)) {
    return { ...(rec.config as Record<string, unknown>) }
  }
  if (rec.insert) return configOf(rec.insert, id)
  return undefined
}

/** 从已安装的 dsh-web-app 补丁里取出这两行现有 config。读不到就当没有。 */
export function installedSettingsConfigs(dshBin: string): {
  general?: Record<string, unknown>
  models?: Record<string, unknown>
} {
  try {
    const req = createRequire(dshBin)
    const manifest = req.resolve('@deepseek-ai/dsh-web-app/package.json')
    const text = readFileSync(join(dirname(manifest), 'cordis.patch.yml'), 'utf8')
    const doc: unknown = parse(text)
    return {
      general: configOf(doc, 'ui-settings-general'),
      models: configOf(doc, 'ui-settings-models'),
    }
  } catch {
    return {}
  }
}

export function ensureEaaWelcomeNoticePatch(patchDir: string, dshBin?: string): string {
  const patchPath = join(patchDir, EAA_WELCOME_PATCH_FILE)
  const text = stringify(
    eaaWelcomeNoticePatchRows(dshBin ? installedSettingsConfigs(dshBin) : undefined),
    { lineWidth: 0 },
  )
  let current: string | null = null
  try {
    current = readFileSync(patchPath, 'utf8')
  } catch {
    current = null
  }
  if (current !== text) writeFileSync(patchPath, text, 'utf8')
  return patchPath
}
