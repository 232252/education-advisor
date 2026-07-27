/**
 * 预设 MCP server 模板(种子数据,用户可任意修改)
 *
 * 注意:`${VAR}` 形式是后端 deepInterpolate 占位符(见 src/main/services/mcp-helpers.ts),
 * 不是 JS 模板字符串,不需要反斜杠转义。biome 的 noTemplateCurlyInString 在此误报。
 */
/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: 占位符由后端 deepInterpolate 处理 */
import type { McpServerConfig } from '@shared/types'

/** 预设 MCP server 模板(种子数据,用户可任意修改) */
export interface McpPreset {
  /** i18n key 后缀,对应 page.mcp.preset.<suffix> */
  i18nSuffix: string
  config: McpServerConfig
}

export const MCP_PRESETS: McpPreset[] = [
  {
    i18nSuffix: 'filesystem',
    config: {
      id: 'filesystem',
      // R4-1: name/description 改为英文默认落盘值(用户保存的 server 名应是具体文字)。
      // UI 展示在 PresetTemplates 用 i18n key(page.mcp.preset.<suffix> / .desc),
      // 落盘到 mcp.user.yaml 用这里的具体值。
      name: 'Local Filesystem',
      description: 'Let the Agent read/write your local documents folder',
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${USER_DOCS}'],
      env: {
        USER_DOCS: '${env.USERPROFILE}/Documents',
      },
    },
  },
  {
    i18nSuffix: 'websearch',
    config: {
      id: 'web-search',
      name: 'Web Search',
      description: 'Let the Agent search the web (requires API key)',
      enabled: true,
      transport: 'sse',
      url: 'https://mcpsearch.example.com/sse',
      headers: {
        Authorization: 'Bearer ${MCP_SEARCH_KEY}',
      },
    },
  },
  {
    i18nSuffix: 'sqlite',
    config: {
      id: 'sqlite',
      name: 'SQLite Database',
      description: 'Query a local SQLite database',
      enabled: true,
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-sqlite', '--db-path', '${USER_DATA}/app.db'],
    },
  },
]
