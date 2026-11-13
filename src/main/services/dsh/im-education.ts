// =============================================================
// 让连接中心的 dsh web 回答教育问题
//
// dsh-im 把渠道消息交给它所在的 web profile，不会转给教师对话那个
// sdk 子进程。所以 web 进程要自带：关掉 bash 的加固补丁（由宿主另附）、
// 没有命令行的教育预设、教师已经存好的模型密钥、主协调同一套工具。
// 工具仍走本机 MCP，一次挂载长期留给这个进程；关掉连接中心时撤掉。
// =============================================================

import { dirname, join } from 'node:path'
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
import { settingsService } from '../settings-service'
import { ensureDshCatalogReady } from './dsh-model-catalog'
import { getDshCurrentRoute, syncDshCredentialRoutes } from './dsh-model-settings'
import {
  credentialedRouteIds,
  fillUnsetBotModels,
  imExposesReadImage,
  listedBotModels,
} from './im-bot-model'
import { composeImInstructions } from './im-instructions'
import { ensureEaaImPresetPatch } from './im-preset'
import { dshProviderRouting, dshSubprocessEnv, providersToDeclare } from './provider-patch'
import {
  profileRouteFill,
  readLlmProviders,
  syncUncataloguedRouteModels,
  withProfileCredentialRefs,
} from './provider-profile-patch'
import { describeConfiguredRouteModel, getConfiguredDshBin, getDshRuntimeCwd } from './runtime'
import { dshVisibleSkillDir, ensureEaaSkillPatch, materializeDshSkills } from './skill-mount'
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

/** 撤掉连接中心占用的工具端点。技能留在 DSH_HOME/skills，下次启动会重写。 */
export async function releaseDshImEducationLaunch(): Promise<void> {
  const mount = held
  held = null
  if (mount) await mount.release()
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
  const credentials: Record<string, ReturnType<typeof profileRouteFill>> = {}
  for (const [id, profile] of Object.entries(routing.profiles)) {
    const fill = profileRouteFill(profile)
    if (Object.keys(fill).length > 0) credentials[id] = fill
  }
  const webProfile = join(dirname(opts.patchDir), 'profiles', 'web')
  syncDshCredentialRoutes(webProfile, credentials)
  // 出厂默认是 deepseek-official，和网页搜索共用 DEEPSEEK_API_KEY。没这把钥匙时，
  // 只给还没选模型的机器人补上 dsh-im 自己的 models，不改 agent-default-model。
  const modelEnv = credentialEnv(
    withProfileCredentialRefs(routing.envNames, routing.profiles, readLlmProviders(webProfile)),
  )
  const home = dirname(opts.patchDir)
  const selection = getDshCurrentRoute()
  fillUnsetBotModels({
    home,
    selection,
    credentialedRoutes: credentialedRouteIds(routing.envNames, modelEnv),
  })
  await ensureDshCatalogReady()
  const picks = listedBotModels(home)
  if (selection?.provider && selection.model) picks.push(selection)
  syncUncataloguedRouteModels(webProfile, picks, describeConfiguredRouteModel)

  let privacyGuard: PrivacyGuard | undefined
  if (isAutoAnonymizeEnabled()) privacyGuard = await PrivacyGuard.create()

  const config = await agentService.getAgent('main')
  if (!config) throw new Error('主协调还没有加载，连接中心暂时接不上教育工具')
  const tools = await agentService.buildMainSurfaceTools(
    opts.win,
    privacyGuard,
    imExposesReadImage(dirname(opts.patchDir)),
  )
  if (!tools?.length) throw new Error('主协调没有可挂载的工具')

  await ensureActiveEaaToolBridge({ patchDir: getDshRuntimeCwd() })
  let mount: EaaToolMount | null = null
  let skillDir: string | null = null
  try {
    mount = await mountEaaAgentTools({ label: 'im', tools })
    held = mount
    skillDir = dshVisibleSkillDir(dirname(opts.patchDir), 'im')
    materializeDshSkills({
      destDir: skillDir,
      skills: selectSkillsForRun(config.capabilities),
      toolNameMap: mount.toolNameMap,
    })
    const skillPatch = ensureEaaSkillPatch(skillDir, skillDir, getConfiguredDshBin())
    const presetPatch = ensureEaaImPresetPatch(opts.patchDir, skillDir, getConfiguredDshBin())
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
      patches: [skillPatch, presetPatch],
      env: {
        ...modelEnv,
        ...pluginProcessEnv(mount.pluginEndpoints),
      },
      instructions,
      ...(skillDir ? { skillDir } : {}),
    }
  } catch (err) {
    held = null
    await mount?.release()
    throw err
  }
}
