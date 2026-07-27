import type { McpServerConfig } from '@shared/types'

/**
 * 校验错误:值为 i18n key(由调用方用 t() 翻译),而非硬编码文案。
 * R4-2 修复: 旧实现直接返回中文字符串,英文环境下表单错误仍是中文。
 */
export type McpConfigErrors = Partial<Record<keyof McpServerConfig | 'id', string>>

const ID_RE = /^[a-zA-Z0-9_-]+$/
const URL_RE = /^https?:\/\/.+/
const SHELL_META_RE = /[;&|`$<>]/

/**
 * 校验 MCP server 配置(前端表单用,纯函数)。
 * 返回 errors 对象,空对象 = 合法。错误值为 i18n key(见 page.mcp.validation.*)。
 * 与后端 validateServerConfig + validateCommandSafe 保持一致语义。
 */
export function validateMcpConfig(config: Partial<McpServerConfig>): McpConfigErrors {
  const errors: McpConfigErrors = {}

  if (!config.id || config.id.trim().length === 0) {
    errors.id = 'page.mcp.validation.idRequired'
  } else if (config.id.length > 128) {
    errors.id = 'page.mcp.validation.idTooLong'
  } else if (!ID_RE.test(config.id)) {
    errors.id = 'page.mcp.validation.idFormat'
  }

  if (!config.name || config.name.trim().length === 0) {
    errors.name = 'page.mcp.validation.nameRequired'
  }

  if (config.transport === 'stdio') {
    if (!config.command || config.command.trim().length === 0) {
      errors.command = 'page.mcp.validation.commandRequired'
    } else if (SHELL_META_RE.test(config.command)) {
      errors.command = 'page.mcp.validation.commandShellChars'
    }
  }

  if (config.transport === 'sse' || config.transport === 'websocket') {
    if (!config.url || config.url.trim().length === 0) {
      errors.url = 'page.mcp.validation.urlRequired'
    } else if (!URL_RE.test(config.url)) {
      errors.url = 'page.mcp.validation.urlFormat'
    }
  }

  return errors
}
