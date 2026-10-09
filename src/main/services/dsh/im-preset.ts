// =============================================================
// 连接中心的网页会话用哪一套工具
//
// dsh web 的命令行、文件、网页和子代理装在预设里面（preset-standard 等），
// 不是宿主那几行。宿主加固补丁按行号只能盖到宿主上已经停用的副本，
// 渠道里的模型仍然能调用预设自己的 bash。
//
// 这里做两件事：
//   1. 插入教育预设 eaa，只留说明、时间和技能，并把它设为新会话的默认预设。
//      技能目录必须写在这个预设自己的 skill-filesystem 上。
//   2. 把已经装上的官方预设里的命令行等工具关掉，已经选过「标准」的旧会话也会生效。
//      精简模式原来只有命令行，关掉之后补上说明和同一份技能。
// =============================================================

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseDocument, type Scalar, type ScalarTag, stringify } from 'yaml'

export const EAA_IM_PRESET_ID = 'eaa'

/** 渠道会话的人设。官方预设原来写着 coding agent 和工作目录，这里统一换成这一句。 */
export const EAA_IM_PERSONA_PREFIX = '你是班级操行助手。只使用当前列出的工具和技能回答教师。'

/** 预设选择器上的说明。官方文案写着会用终端和编辑文件，这里改成实际还能做的事。 */
export const EAA_IM_PRESET_DESCRIPTION = '按班级操行助手回答，只用当前列出的教育工具和技能。'

/** 官方预设一旦写上 name，选择器就不再用「会调用终端」那套内置文案。 */
const HONEST_PRESET_DISPLAY: Record<string, { name: string; description: string }> = {
  standard: { name: '标准', description: EAA_IM_PRESET_DESCRIPTION },
  minimal: { name: '精简', description: EAA_IM_PRESET_DESCRIPTION },
  ptc: { name: '批处理', description: EAA_IM_PRESET_DESCRIPTION },
  cordis: { name: '创作', description: EAA_IM_PRESET_DESCRIPTION },
}
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
  '@deepseek-ai/dsh-tool-ralph',
  '@deepseek-ai/dsh-tool-plugin-manager',
  '@deepseek-ai/dsh-plugin-manager/tools',
  '@deepseek-ai/dsh-plan-mode',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-subagent-control',
  '@deepseek-ai/dsh-tool-subagent-control/list-agents',
  '@deepseek-ai/dsh-tool-cordis',
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
      return typeof js === 'string' ? js : String(js ?? '')
    }
    return ''
  },
}

const YAML_OPTS = { customTags: [JS_TAG], version: '1.1' as const, lineWidth: 0 }

interface PresetDeclaration {
  rowId: string
  config: Record<string, unknown>
}

/** 新会话默认用的教育预设。技能目录只扫描这一次准备好的那份。 */
export function buildEaaImPresetPatch(skillDir: string): string {
  const dir = skillDir.replace(/\\/g, '/')
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
                    prefix: EAA_IM_PERSONA_PREFIX,
                    includeRuntimeContext: false,
                  },
                },
                {
                  id: 'agent-instructions',
                  name: '@deepseek-ai/dsh-agent-instructions',
                  config: { maxBytes: 65536 },
                },
                { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
                {
                  id: 'skill-filesystem',
                  name: '@deepseek-ai/dsh-skill-filesystem',
                  config: {
                    includeDefaultRoots: false,
                    customSkillDirs: [dir],
                    watch: false,
                    dshHome: dir,
                    agentsHome: dir,
                  },
                },
                { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
              ],
            },
          },
        ],
      },
      {
        id: 'agent-preset-registry',
        config: { default: EAA_IM_PRESET_ID },
      },
    ],
    { lineWidth: 0 },
  )
}

export function ensureEaaImPresetPatch(patchDir: string, skillDir: string): string {
  return writeIfChanged(join(patchDir, EAA_IM_PRESET_PATCH_FILE), buildEaaImPresetPatch(skillDir))
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
 * 读官方预设文件，把命令行等工具标成停用。
 * 给出技能目录时，预设里的 skill-filesystem 只扫描这一份，不再扫用户主目录。
 * 目录里没有预设时返回 null。解析失败直接抛出，避免悄悄留下命令行。
 */
export function buildOfficialPresetLock(presetDir: string, skillDir?: string): string | null {
  const files = readdirSync(presetDir)
    .filter((name) => name.endsWith('.patch.yml'))
    .sort()
  const rows: Array<{ id: string; config: Record<string, unknown> }> = []
  for (const name of files) {
    for (const decl of readPresetDeclarations(join(presetDir, name))) {
      lockPluginTree(decl.config.plugins, skillDir)
      if (skillDir) ensureEducationCapabilities(decl.config.plugins, skillDir)
      const display =
        typeof decl.config.id === 'string' ? HONEST_PRESET_DISPLAY[decl.config.id] : undefined
      if (display) {
        decl.config.name = display.name
        decl.config.description = display.description
      }
      rows.push({ id: decl.rowId, config: decl.config })
    }
  }
  if (!rows.length) return null
  return stringify(rows, YAML_OPTS)
}

export function ensureOfficialPresetLock(
  patchDir: string,
  dshBin: string,
  skillDir?: string,
): string | null {
  const presetDir = resolveWebPresetDir(dshBin)
  if (!presetDir) return null
  const text = buildOfficialPresetLock(presetDir, skillDir)
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

function lockPluginTree(entries: unknown, skillDir?: string): void {
  if (!Array.isArray(entries)) return
  for (const row of entries) {
    if (!row || typeof row !== 'object') continue
    const entry = row as { name?: unknown; config?: unknown; disabled?: unknown }
    if (typeof entry.name === 'string' && EAA_PRESET_SHELL_PACKAGES.includes(entry.name)) {
      entry.disabled = true
    }
    if (entry.name === '@deepseek-ai/dsh-persona') {
      entry.config = {
        prefix: EAA_IM_PERSONA_PREFIX,
        includeRuntimeContext: false,
      }
      continue
    }
    if (skillDir && entry.name === '@deepseek-ai/dsh-skill-filesystem') {
      entry.config = pinnedSkillConfig(skillDir)
      continue
    }
    if (Array.isArray(entry.config)) {
      lockPluginTree(entry.config, skillDir)
      continue
    }
    if (entry.config && typeof entry.config === 'object') {
      lockPluginTree((entry.config as { plugins?: unknown }).plugins, skillDir)
    }
  }
}

function pluginPresent(entries: unknown[], pkg: string): boolean {
  return entries.some(
    (row) => row && typeof row === 'object' && (row as { name?: unknown }).name === pkg,
  )
}

/** 精简模式原来没有技能和说明文件。补上之后，选它的旧会话也能读到同一份。 */
function ensureEducationCapabilities(plugins: unknown, skillDir: string): void {
  if (!Array.isArray(plugins)) return
  if (!pluginPresent(plugins, '@deepseek-ai/dsh-agent-instructions')) {
    plugins.push({
      id: 'agent-instructions',
      name: '@deepseek-ai/dsh-agent-instructions',
      config: { maxBytes: 65536 },
    })
  }
  if (!pluginPresent(plugins, '@deepseek-ai/dsh-skill-filesystem')) {
    plugins.push({
      id: 'skill-filesystem',
      name: '@deepseek-ai/dsh-skill-filesystem',
      config: pinnedSkillConfig(skillDir),
    })
  }
  if (!pluginPresent(plugins, '@deepseek-ai/dsh-tool-skill')) {
    plugins.push({
      id: 'tool-skill',
      name: '@deepseek-ai/dsh-tool-skill',
    })
  }
}

function pinnedSkillConfig(skillDir: string): Record<string, unknown> {
  const dir = skillDir.replace(/\\/g, '/')
  return {
    includeDefaultRoots: false,
    customSkillDirs: [dir],
    watch: false,
    dshHome: dir,
    agentsHome: dir,
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
