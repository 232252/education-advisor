/**
 * 与 vendor 里各插件的 cordis.patch.yml 约定的名字。改插件时两边一起改。
 *
 * 一个功能一个插件：花名册、成绩、批改各自一条 MCP 连接。
 * 没被点名的工具（操行查询、加减分、文件、委托）仍走 eaa-tools。
 * 某次运行的工具集里没有某一组，宿主就不注入那组的地址，插件保持关闭。
 */

export interface EaaPluginContract {
  /** vendor 下的目录名 */
  dirName: string
  /** dsh 侧工具前缀：mcp__<serverName>__<rawName> */
  serverName: string
  urlEnv: string
  tokenEnv: string
  /** 空数组表示「其余工具都归这里」 */
  toolNames: readonly string[]
}

export const EAA_TOOLS_SERVER_NAME = 'eaa'
export const EAA_MCP_URL_ENV = 'EAA_MCP_URL'
export const EAA_MCP_TOKEN_ENV = 'EAA_MCP_TOKEN'

export const EAA_ROSTER_TOOLS = [
  'eaa_list_classes',
  'eaa_create_class',
  'eaa_update_class',
  'eaa_archive_class',
  'eaa_import_students',
  'eaa_list_students',
  'eaa_add_student',
  'eaa_set_student_meta',
  'eaa_delete_student',
] as const

export const EAA_GRADES_TOOLS = [
  'eaa_import_grades',
  'eaa_exams',
  'eaa_exam_grades',
  'eaa_student_grades',
] as const

export const EAA_GRADING_TOOLS = [
  'eaa_grading_overview',
  'eaa_grading_student',
  'eaa_grading_from_files',
  'eaa_grading_publish',
] as const

const CONDUCT_PLUGIN: EaaPluginContract = {
  dirName: 'eaa-tools',
  serverName: EAA_TOOLS_SERVER_NAME,
  urlEnv: EAA_MCP_URL_ENV,
  tokenEnv: EAA_MCP_TOKEN_ENV,
  toolNames: [],
}

export const EAA_PLUGINS: readonly EaaPluginContract[] = [
  {
    dirName: 'eaa-roster',
    serverName: 'roster',
    urlEnv: 'EAA_ROSTER_MCP_URL',
    tokenEnv: 'EAA_ROSTER_MCP_TOKEN',
    toolNames: EAA_ROSTER_TOOLS,
  },
  {
    dirName: 'eaa-grades',
    serverName: 'grades',
    urlEnv: 'EAA_GRADES_MCP_URL',
    tokenEnv: 'EAA_GRADES_MCP_TOKEN',
    toolNames: EAA_GRADES_TOOLS,
  },
  {
    dirName: 'eaa-grading',
    serverName: 'grading',
    urlEnv: 'EAA_GRADING_MCP_URL',
    tokenEnv: 'EAA_GRADING_MCP_TOKEN',
    toolNames: EAA_GRADING_TOOLS,
  },
  CONDUCT_PLUGIN,
]

const TOOL_PLUGIN = new Map<string, EaaPluginContract>()
for (const plugin of EAA_PLUGINS) {
  for (const name of plugin.toolNames) TOOL_PLUGIN.set(name, plugin)
}

/** 点名的进对应插件，其余进操行插件。 */
export function pluginForToolName(toolName: string): EaaPluginContract {
  return TOOL_PLUGIN.get(toolName) ?? CONDUCT_PLUGIN
}
