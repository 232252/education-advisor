// =============================================================
// 让连接中心的 dsh web 回答教育问题
//
// dsh-im 把渠道消息交给它所在的 web profile，不会转给教师对话那个
// sdk 子进程。所以 web 进程要自带：关掉 bash 的加固补丁（由宿主另附）、
// 没有命令行的教育预设、教师已经存好的模型密钥、主协调同一套工具。
// 工具仍走本机 MCP，一次挂载长期留给这个进程；关掉连接中心时撤掉。
// =============================================================

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { getClassContextSection } from '../agent/class-context'
import { memoryService } from '../agent/memory-service'
import {
  assertPrivacyReadyForRun,
  isAutoAnonymizeEnabled,
  PrivacyGuard,
} from '../agent/privacy-guard'
import { selectSkillsForRun } from '../agent/tools'
import { agentService } from '../agent-service'
import { safeGetModels } from '../pi-ai/model-utils'
import { settingsService } from '../settings-service'
import { composeImInstructions } from './im-instructions'
import { ensureEaaImPresetPatch } from './im-preset'
import { dshRouteModelEntry } from './profile-overrides'
import {
  type DshProviderRouting,
  dshProviderRouting,
  dshRouteKey,
  dshSubprocessEnv,
  ensureEaaProviderPatch,
  providersToDeclare,
} from './provider-patch'
import { getDshRuntimeCwd } from './runtime'
import { ensureEaaSkillPatch, materializeDshSkills, removeDshSkillDir } from './skill-mount'
import {
  type EaaToolMount,
  ensureActiveEaaToolBridge,
  mountEaaAgentTools,
  pluginProcessEnv,
} from './tool-bridge'

export interface DshImLaunchPrep {
  patches: string[]
  env: Record<string, string>
  instructions: string
  skillDir?: string
}

let held: EaaToolMount | null = null
let heldSkillDir: string | null = null

/** 撤掉连接中心占用的工具端点。重复调用无事发生。 */
export async function releaseDshImEducationLaunch(): Promise<void> {
  const mount = held
  const skillDir = heldSkillDir
  held = null
  heldSkillDir = null
  if (mount) await mount.release()
  removeDshSkillDir(skillDir)
}

/**
 * 非官方内建路由补上 pi 目录里的模型。
 * 只写 apiKeyEnv 时，web 里一发请求就是 has no configured model。
 * deepseek 走 dsh 自己的 deepseek-official，不在这份 profiles 里。
 */
function attachCatalogModels(
  profiles: DshProviderRouting['profiles'],
  providerIds: readonly string[],
): void {
  for (const providerId of providerIds) {
    const profile = profiles[dshRouteKey(providerId)]
    if (!profile || profile.models?.length) continue
    const models = safeGetModels(providerId)
    const entries = []
    let api: string | undefined
    for (const model of models) {
      const entry = dshRouteModelEntry({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: model.input,
        thinkingLevelMap: model.thinkingLevelMap,
        api: model.api,
      })
      if (!entry) continue
      entries.push(entry)
      if (!api && model.api) api = model.api
    }
    if (!entries.length) continue
    profile.models = entries
    if (api) profile.api = api
  }
}

function credentialEnv(envNames: Record<string, string>): Record<string, string> {
  const merged = dshSubprocessEnv(envNames)
  if (!merged) return {}
  const extra: Record<string, string> = {}
  for (const name of Object.keys(envNames)) {
    const value = merged[name]
    if (value) extra[name] = value
  }
  return extra
}

export async function prepareDshImEducationLaunch(opts: {
  patchDir: string
  win?: BrowserWindow
}): Promise<DshImLaunchPrep> {
  await releaseDshImEducationLaunch()
  assertPrivacyReadyForRun()

  const providerIds = providersToDeclare()
  const routing = dshProviderRouting(providerIds)
  attachCatalogModels(routing.profiles, providerIds)
  const providerPatch = ensureEaaProviderPatch(opts.patchDir, routing.profiles)

  let privacyGuard: PrivacyGuard | undefined
  if (isAutoAnonymizeEnabled()) privacyGuard = await PrivacyGuard.create()

  const config = await agentService.getAgent('main')
  if (!config) throw new Error('主协调还没有加载，连接中心暂时接不上教育工具')
  const tools = await agentService.buildMainSurfaceTools(opts.win, privacyGuard)
  if (!tools?.length) throw new Error('主协调没有可挂载的工具')

  await ensureActiveEaaToolBridge({ patchDir: getDshRuntimeCwd() })
  let mount: EaaToolMount | null = null
  let skillDir: string | null = null
  try {
    mount = await mountEaaAgentTools({ label: 'im', tools, via: 'plugin' })
    held = mount
    skillDir = join(tmpdir(), 'eaa-dsh-skills', 'im')
    materializeDshSkills({
      destDir: skillDir,
      skills: selectSkillsForRun(config.capabilities),
      toolNameMap: mount.toolNameMap,
    })
    heldSkillDir = skillDir
    const skillPatch = ensureEaaSkillPatch(skillDir, skillDir)
    const presetPatch = ensureEaaImPresetPatch(opts.patchDir, skillDir)
    const chat = settingsService.getSettings().chat
    const memory = memoryService.getMemorySection('main')
    const instructions = composeImInstructions(
      {
        config: { name: config.name, role: config.role, description: config.description },
        soulContent: config.soulContent,
        projectContextContent: agentService.getProjectContext(),
        classContextSection: await getClassContextSection(),
        sharedRulesContent: agentService.getSharedRules(),
        rulesContent: config.rulesContent,
        skillsSection: '',
        memorySection: privacyGuard ? privacyGuard.anonymize(memory) : memory,
        riskThresholds: config.riskThresholds,
        steeringMode: chat?.steeringMode ?? 'all',
        followUpMode: chat?.followUpMode ?? 'one-at-a-time',
        showImages: chat?.showImages ?? true,
      },
      mount.toolNameMap,
    )
    return {
      patches: [...(providerPatch ? [providerPatch] : []), skillPatch, presetPatch],
      env: {
        ...credentialEnv(routing.envNames),
        ...pluginProcessEnv(mount.pluginEndpoints),
      },
      instructions,
      ...(skillDir ? { skillDir } : {}),
    }
  } catch (err) {
    held = null
    heldSkillDir = null
    await mount?.release()
    removeDshSkillDir(skillDir)
    throw err
  }
}
