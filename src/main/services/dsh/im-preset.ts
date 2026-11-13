// =============================================================
// 连接中心的网页会话用哪一套工具
//
// dsh web 的命令行、文件、网页和子代理装在预设里面（preset-standard 等），
// 不是宿主那几行。宿主加固补丁盖不到预设内部的副本，渠道里的模型仍然能
// 调用预设自己的 bash。
//
// 这里做两件事：
//   1. 插入教育预设 eaa，留下说明、时间、技能，以及官方网页预设同一组
//      上下文压缩，并把它设为新会话的默认预设。技能目录必须写在这个预设
//      自己的 skill-filesystem 上。预设会换成自己的插件树，不写进这棵树的
//      官方能力（压缩、/compact）在渠道会话里不会再生效。
//   2. 启动时重读已安装的官方预设，只把命令行等壳层标成停用。人设、说明和
//      技能目录保持 DSH 原样，升级带来的新字段也会留下来。Cordis 对同一行
//      的 config 是整段替换，所以仍然要写出完整 config，但不再改写内容。
// =============================================================

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseDocument, type Scalar, type ScalarTag, stringify } from 'yaml'
import { EAA_AGENTS_INSTRUCTION_BYTES } from './agents-home'
import { readInstalledRowConfig } from './hardening'
import { dshSkillScanDirs } from './skill-mount'

export const EAA_IM_PRESET_ID = 'eaa'

/** 教育预设的人设。官方预设的原文不动。 */
export const EAA_IM_PERSONA_PREFIX = '你是班级操行助手。只使用当前列出的工具和技能回答教师。'

/** 预设选择器上的说明。只用于教育预设，不改写官方预设的文案。 */
export const EAA_IM_PRESET_DESCRIPTION = '按班级操行助手回答，只用当前列出的教育工具和技能。'

export const EAA_IM_PRESET_PATCH_FILE = 'eaa-im-preset.cordis.patch.yml'
export const EAA_PRESET_LOCK_PATCH_FILE = 'eaa-preset-lock.cordis.patch.yml'

/** 预设内部不允许留给模型的包。技能、说明和压缩不在这里。 */
export const EAA_PRESET_SHELL_PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-bash-persistent',
  '@deepseek-ai/dsh-tool-pwsh-persistent',
  '@deepseek-ai/dsh-terminal',
  '@deepseek-ai/dsh-terminal-bash',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-tool-schedule',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-tool-goal',
  '@deepseek-ai/dsh-command-goal',
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-workflow-ptc',
  // 0.2.2 起 ptc 预设自带 PTC 执行器；批处理代码路径不留给渠道模型。
  '@deepseek-ai/dsh-tool-executor-ptc',
  '@deepseek-ai/dsh-tool-ralph',
  '@deepseek-ai/dsh-tool-plugin-manager',
  '@deepseek-ai/dsh-plugin-manager/tools',
  '@deepseek-ai/dsh-plan-mode',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-subagent-control',
  '@deepseek-ai/dsh-tool-subagent-control/list-agents',
  '@deepseek-ai/dsh-tool-cordis',
  // 官方「标准 / 批处理 / 创作」预设还带着提问和展示卡片。渠道会话不走这两条，
  // 避免绕过教育工具直接跟教师要输入或弹出交付物。
  '@deepseek-ai/dsh-tool-ask-user',
  '@deepseek-ai/dsh-tool-present',
]

const JS_TAG: ScalarTag = {
  identify: (value: unknown) =>
    Boolean(value && typeof value === 'object' && value !== null && Object.hasOwn(value, '__js')),
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: string) => ({ __js: String(value) }),
  stringify: (item: Scalar) => {
    const value = item.value
    if (value && typeof value === 'object' && '__js' in value) {
      const js = (value as { __js?: unknown }).__js
      // rc.2 的表达式以 ! 开头（如 !ctx.get(...)），不引号会被当成第二个标签
      return JSON.stringify(typeof js === 'string' ? js : String(js ?? ''))
    }
    return '""'
  },
}

const YAML_OPTS = { customTags: [JS_TAG], version: '1.1' as const, lineWidth: 0 }

interface PresetDeclaration {
  rowId: string
  config: Record<string, unknown>
}

const FALLBACK_COMPACTION = {
  id: 'compaction',
  name: 'cordis:group',
  group: true,
  isolate: { compaction: true, toolResultPruner: true },
  config: [
    { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
    { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
    {
      id: 'tool-result-pruner',
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
      config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    },
  ],
}

export interface InstalledEaaPresetPieces {
  /** 官方标准预设里 persona 的 config。前缀和运行环境开关仍由教育预设决定。 */
  persona?: Record<string, unknown>
  /** 官方标准预设里 agent-instructions 的 config。上限仍改成教育说明用的值。 */
  agentInstructions?: Record<string, unknown>
  /** 官方标准预设里的 compaction 组。原样采用，不手写阈值。 */
  compaction?: Record<string, unknown>
  /** 已安装 agent-preset-registry 的 config。默认预设仍改成教育预设。 */
  registry?: Record<string, unknown>
  /** 官方标准预设里 skill-filesystem 的 config。扫描范围仍钉在这次的目录。 */
  skillFilesystem?: Record<string, unknown>
  /** 官方标准预设里的时间插件。没有就用包名本身。 */
  timeContext?: Record<string, unknown>
  /** 官方标准预设里的技能工具。没有就用包名本身。 */
  toolSkill?: Record<string, unknown>
}

/** 新会话默认用的教育预设。技能目录只扫描这一次准备好的那份。 */
export function buildEaaImPresetPatch(
  skillDir: string,
  installed?: InstalledEaaPresetPieces,
): string {
  const dir = skillDir.replace(/\\/g, '/')
  const compaction = installed?.compaction ?? FALLBACK_COMPACTION
  const timeContext = installed?.timeContext ?? {
    id: 'time-context',
    name: '@deepseek-ai/dsh-time-context',
  }
  const toolSkill = installed?.toolSkill ?? {
    id: 'tool-skill',
    name: '@deepseek-ai/dsh-tool-skill',
  }
  return stringify(
    [
      {
        insert: [
          {
            id: 'preset-eaa',
            name: '@deepseek-ai/dsh-agent-preset',
            config: {
              id: EAA_IM_PRESET_ID,
              name: '教育参谋',
              description: EAA_IM_PRESET_DESCRIPTION,
              order: 0,
              plugins: [
                {
                  id: 'persona',
                  name: '@deepseek-ai/dsh-persona',
                  config: {
                    ...(installed?.persona ?? {}),
                    prefix: EAA_IM_PERSONA_PREFIX,
                    includeRuntimeContext: false,
                    // complete 会让这一段变成整份提示，教育说明就进不去。
                    complete: false,
                  },
                },
                {
                  id: 'agent-instructions',
                  name: '@deepseek-ai/dsh-agent-instructions',
                  // 预设挂载会换成自己的插件树，盖不到宿主那行。先留下官方这行
                  // 已有的字段，再把上限改成教育说明用的值。
                  config: {
                    ...(installed?.agentInstructions ?? {}),
                    maxBytes: EAA_AGENTS_INSTRUCTION_BYTES,
                  },
                },
                timeContext,
                {
                  id: 'skill-filesystem',
                  name: '@deepseek-ai/dsh-skill-filesystem',
                  config: {
                    ...(installed?.skillFilesystem ?? {}),
                    includeDefaultRoots: false,
                    customSkillDirs: dshSkillScanDirs(dir),
                    watch: false,
                  },
                },
                toolSkill,
                compaction,
              ],
            },
          },
        ],
      },
      {
        id: 'agent-preset-registry',
        config: { ...(installed?.registry ?? {}), default: EAA_IM_PRESET_ID },
      },
    ],
    { lineWidth: 0 },
  )
}

export function ensureEaaImPresetPatch(
  patchDir: string,
  skillDir: string,
  dshBin?: string,
): string {
  return writeIfChanged(
    join(patchDir, EAA_IM_PRESET_PATCH_FILE),
    buildEaaImPresetPatch(skillDir, installedPresetPieces(dshBin)),
  )
}

/** 读已安装标准预设里的一行插件。没有标准预设或没有这一行就返回 undefined。 */
export function readStandardPresetPlugin(
  presetDir: string,
  pluginId: string,
): Record<string, unknown> | undefined {
  const file = join(presetDir, 'standard.patch.yml')
  if (!existsSync(file)) return undefined
  for (const decl of readPresetDeclarations(file)) {
    const plugins = decl.config.plugins
    if (!Array.isArray(plugins)) continue
    for (const plugin of plugins) {
      if (!plugin || typeof plugin !== 'object') continue
      if ((plugin as { id?: unknown }).id === pluginId) return plugin as Record<string, unknown>
    }
  }
  return undefined
}

function pluginConfig(
  plugin: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const config = plugin?.config
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined
  return config as Record<string, unknown>
}

function installedPresetPieces(dshBin: string | undefined): InstalledEaaPresetPieces {
  if (!dshBin) return {}
  const pieces: InstalledEaaPresetPieces = {}
  const presetDir = resolveWebPresetDir(dshBin)
  if (presetDir) {
    const persona = pluginConfig(readStandardPresetPlugin(presetDir, 'persona'))
    const instructions = pluginConfig(readStandardPresetPlugin(presetDir, 'agent-instructions'))
    const compaction = readStandardPresetPlugin(presetDir, 'compaction')
    const skills = pluginConfig(readStandardPresetPlugin(presetDir, 'skill-filesystem'))
    const timeContext = readStandardPresetPlugin(presetDir, 'time-context')
    const toolSkill = readStandardPresetPlugin(presetDir, 'tool-skill')
    if (persona) pieces.persona = persona
    if (instructions) pieces.agentInstructions = instructions
    if (compaction) pieces.compaction = compaction
    if (skills) pieces.skillFilesystem = skills
    if (timeContext) pieces.timeContext = timeContext
    if (toolSkill) pieces.toolSkill = toolSkill
  }
  const registry = readInstalledRowConfig(
    dshBin,
    '@deepseek-ai/dsh-web-app',
    'agent-preset-registry',
  )
  if (registry) pieces.registry = registry
  return pieces
}

/** 从 dsh 可执行文件找到 web 应用自带的预设目录。找不到就返回 null。 */
export function resolveWebPresetDir(dshBin: string): string | null {
  try {
    const req = createRequire(dshBin)
    const manifest = req.resolve('@deepseek-ai/dsh-web-app/package.json')
    const dir = join(dirname(manifest), 'presets')
    return existsSync(dir) ? dir : null
  } catch {
    return null
  }
}

/**
 * 读已安装的官方预设，只把壳层工具标成停用。
 * 目录里没有预设时返回 null。解析失败直接抛出，避免悄悄留下命令行。
 */
export function buildOfficialPresetLock(presetDir: string): string | null {
  const files = readdirSync(presetDir)
    .filter((name) => name.endsWith('.patch.yml'))
    .sort()
  const rows: Array<{ id: string; config: Record<string, unknown> }> = []
  for (const name of files) {
    for (const decl of readPresetDeclarations(join(presetDir, name))) {
      lockPluginTree(decl.config.plugins)
      rows.push({ id: decl.rowId, config: decl.config })
    }
  }
  if (!rows.length) return null
  return stringify(rows, YAML_OPTS)
}

export function ensureOfficialPresetLock(patchDir: string, dshBin: string): string | null {
  const presetDir = resolveWebPresetDir(dshBin)
  if (!presetDir) return null
  const text = buildOfficialPresetLock(presetDir)
  if (!text) return null
  return writeIfChanged(join(patchDir, EAA_PRESET_LOCK_PATCH_FILE), text)
}

function readPresetDeclarations(file: string): PresetDeclaration[] {
  const doc = parseDocument(readFileSync(file, 'utf8'), YAML_OPTS)
  if (doc.errors.length) {
    throw new Error(`无法解析预设 ${file}: ${doc.errors.map((err) => err.message).join('; ')}`)
  }
  const found: PresetDeclaration[] = []
  const ops = doc.toJS()
  if (!Array.isArray(ops)) return found
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue
    const insert = (op as { insert?: unknown }).insert
    if (!Array.isArray(insert)) continue
    for (const row of insert) {
      if (!row || typeof row !== 'object') continue
      const rec = row as { id?: unknown; name?: unknown; config?: unknown }
      if (rec.name !== '@deepseek-ai/dsh-agent-preset') continue
      if (
        typeof rec.id !== 'string' ||
        !rec.config ||
        typeof rec.config !== 'object' ||
        Array.isArray(rec.config)
      ) {
        continue
      }
      found.push({ rowId: rec.id, config: rec.config as Record<string, unknown> })
    }
  }
  return found
}

function lockPluginTree(entries: unknown): void {
  if (!Array.isArray(entries)) return
  for (const row of entries) {
    if (!row || typeof row !== 'object') continue
    const entry = row as { name?: unknown; config?: unknown; disabled?: unknown }
    if (typeof entry.name === 'string' && EAA_PRESET_SHELL_PACKAGES.includes(entry.name)) {
      entry.disabled = true
    }
    if (Array.isArray(entry.config)) {
      lockPluginTree(entry.config)
      continue
    }
    if (entry.config && typeof entry.config === 'object') {
      lockPluginTree((entry.config as { plugins?: unknown }).plugins)
    }
  }
}

function writeIfChanged(patchPath: string, text: string): string {
  let current: string | null = null
  try {
    current = readFileSync(patchPath, 'utf8')
  } catch {
    current = null
  }
  if (current !== text) writeFileSync(patchPath, text, 'utf8')
  return patchPath
}
