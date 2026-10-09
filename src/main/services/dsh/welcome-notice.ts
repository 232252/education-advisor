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
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { EaaCordisPatchRow } from './hardening'

/** 与 @deepseek-ai/dsh-client-ui-settings-models 的 WELCOME_NOTICE_VERSION 对齐。 */
export const DSH_WELCOME_NOTICE_VERSION = '2026-09-28.1'

export const EAA_WELCOME_PATCH_FILE = 'eaa-welcome-notice.cordis.patch.yml'

export function eaaWelcomeNoticePatchRows(): EaaCordisPatchRow[] {
  return [
    {
      id: 'ui-settings-general',
      config: { welcomeNoticeVersion: DSH_WELCOME_NOTICE_VERSION },
    },
    {
      // 密钥在教育参谋自己的模型页里配，再由宿主注入子进程。
      // 这里再弹一层会挡住飞书 / 微信登录。
      id: 'ui-settings-models',
      config: { credentialOnboarding: false },
    },
  ]
}

export function ensureEaaWelcomeNoticePatch(patchDir: string): string {
  const patchPath = join(patchDir, EAA_WELCOME_PATCH_FILE)
  const text = stringify(eaaWelcomeNoticePatchRows(), { lineWidth: 0 })
  let current: string | null = null
  try {
    current = readFileSync(patchPath, 'utf8')
  } catch {
    current = null
  }
  if (current !== text) writeFileSync(patchPath, text, 'utf8')
  return patchPath
}
