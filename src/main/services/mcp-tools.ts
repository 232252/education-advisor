// =============================================================
// MCP Tools — 将 MCP server 工具适配为 pi-agent-core AgentTool
//
// 职责:
//   - JSON Schema → typebox schema 转换(MCP 用 JSON Schema,AgentTool 用 typebox)
//   - MCP tool → AgentTool 适配(命名/标签/描述/参数/execute)
//   - 安全屏障复用:路径参数走 validateFilePath,字符串参数走 sanitizeArg
//   - AbortSignal 传递(支持 Agent 中断时取消 MCP 调用)
//   - 按 Agent 聚合工具(合并全局 + Agent 级 + 技能级三层 MCP 配置)
//
// 安全设计:
//   - 路径参数(名称含 path/file/dir)强制走 validateFilePath(14 个敏感路径黑名单)
//   - 所有字符串参数走 sanitizeArg(控制字符/shell 元字符/ -- 前缀过滤)
//   - 工具名前缀 mcp_<serverId>_,与 EAA 工具(eaa_*)和内置工具(read_file 等)区分
//   - 调用结果大小限制由 mcp-service.ts 的 callTool 保证(5MB)
// =============================================================

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { TSchema } from 'typebox'
import { Type } from 'typebox'
import type { McpServerConfig, McpTool } from '../../shared/types'
import { sanitizeArg } from './eaa-tools'
import { validateFilePath } from './file-tools'
import { mcpService } from './mcp-service'
import type { McpCallResult } from './mcp-types'

// biome-ignore lint/suspicious/noExplicitAny: 异构工具集合,TSchema 约束不兼容 unknown
type AnyAgentTool = AgentTool<any>

/** 路径参数名关键字(小写匹配) */
const PATH_PARAM_KEYWORDS = ['path', 'file', 'dir', 'folder', 'filepath', 'filename']

/**
 * 判断参数名是否疑似路径参数
 */
function isPathLikeParam(name: string): boolean {
  const lower = name.toLowerCase()
  return PATH_PARAM_KEYWORDS.some((kw) => lower === kw || lower.includes(kw))
}

// =============================================================
// JSON Schema → typebox 转换
// =============================================================

interface JsonSchema {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  additionalProperties?: boolean | JsonSchema
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
}

/**
 * 将 JSON Schema 转换为 typebox TSchema
 * 未知/不支持类型降级为 Type.Any(),保证不阻塞工具注册
 */
export function jsonSchemaToTypebox(schema: JsonSchema | undefined | null): TSchema {
  if (!schema || typeof schema !== 'object') {
    return Type.Any()
  }

  // 优先处理 enum(无论 type 是什么)
  if (Array.isArray(schema.enum)) {
    // biome-ignore lint/suspicious/noExplicitAny: enum 值类型异构
    return Type.Union(schema.enum.map((v) => Type.Literal(v as any)))
  }

  // 处理 anyOf/oneOf(合并为 Union)
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return Type.Union(schema.anyOf.map((s) => jsonSchemaToTypebox(s)))
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return Type.Union(schema.oneOf.map((s) => jsonSchemaToTypebox(s)))
  }

  const desc = { description: schema.description }

  switch (schema.type) {
    case 'string':
      return Type.String(desc)
    case 'number':
      return Type.Number(desc)
    case 'integer':
      return Type.Integer(desc)
    case 'boolean':
      return Type.Boolean(desc)
    case 'array':
      return Type.Array(jsonSchemaToTypebox(schema.items), desc)
    case 'object': {
      if (!schema.properties) {
        return Type.Object({}, { additionalProperties: true })
      }
      const props: Record<string, TSchema> = {}
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        const t = jsonSchemaToTypebox(subSchema)
        const isRequired = schema.required?.includes(key)
        props[key] = isRequired ? t : Type.Optional(t)
      }
      return Type.Object(props, {
        additionalProperties: schema.additionalProperties !== false,
      })
    }
    case 'null':
      return Type.Null()
    default:
      // 未知类型(含 undefined/未声明 type)降级为 Any
      return Type.Any()
  }
}

// =============================================================
// 安全屏障:对 MCP 工具参数复用 file-tools/eaa-tools 的校验
// =============================================================

/**
 * 对 MCP 工具调用参数做安全校验
 * - 路径参数(名称含 path/file/dir)走 validateFilePath
 * - 字符串参数走 sanitizeArg(控制字符/shell 元字符/-- 前缀)
 * - 递归处理嵌套对象和数组
 *
 * @param toolName 工具名(用于错误信息)
 * @param args 原始参数
 * @param inputSchema JSON Schema(用于识别 path 类型参数)
 * @returns 校验通过后的参数(原样返回,不做修改)
 */
export function sanitizeMcpArgs(
  toolName: string,
  args: Record<string, unknown>,
  inputSchema?: object,
): Record<string, unknown> {
  const schema = inputSchema as JsonSchema | undefined
  const properties = schema?.properties

  for (const [key, value] of Object.entries(args)) {
    // 字符串值:sanitizeArg
    if (typeof value === 'string') {
      // 路径参数:validateFilePath(更严格)
      if (isPathLikeParam(key)) {
        try {
          validateFilePath(value)
        } catch (err) {
          throw new Error(
            `MCP 工具 ${toolName} 参数 ${key} 路径校验失败: ${(err as Error).message}`,
          )
        }
      }
      // 所有字符串参数(含路径)走 sanitizeArg
      try {
        sanitizeArg(value)
      } catch (err) {
        throw new Error(`MCP 工具 ${toolName} 参数 ${key} 校验失败: ${(err as Error).message}`)
      }
    }
    // 嵌套对象:递归校验
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nestedSchema = properties?.[key] as JsonSchema | undefined
      sanitizeMcpArgs(`${toolName}.${key}`, value as Record<string, unknown>, nestedSchema)
    }
    // 数组:对每个字符串元素做 sanitizeArg
    else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === 'string') {
          try {
            sanitizeArg(value[i] as string)
          } catch (err) {
            throw new Error(
              `MCP 工具 ${toolName} 参数 ${key}[${i}] 校验失败: ${(err as Error).message}`,
            )
          }
        }
      }
    }
  }
  return args
}

// =============================================================
// MCP tool → AgentTool 适配
// =============================================================

/** 工具名安全化:只保留字母数字和下划线 */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
}

/**
 * 将单个 MCP 工具适配为 AgentTool
 *
 * 命名规则: `mcp_<serverId>_<toolName>` (全部小写,特殊字符替换为 _)
 * 标签: `MCP [<serverId>] <toolName>`
 * 描述: 透传 MCP server 提供的 description
 * 参数: JSON Schema → typebox
 * execute: sanitize → callTool → 格式化结果
 *
 * @param serverId MCP server ID
 * @param mcpTool MCP 工具定义(含 name/description/inputSchema)
 */
export function mcpToolToAgentTool(serverId: string, mcpTool: McpTool): AnyAgentTool {
  const safeServerId = sanitizeToolName(serverId)
  const safeToolName = sanitizeToolName(mcpTool.name)
  const toolName = `mcp_${safeServerId}_${safeToolName}`
  const label = `MCP [${serverId}] ${mcpTool.name}`
  const description = mcpTool.description || `MCP server ${serverId} 提供的工具 ${mcpTool.name}`
  const parameters = jsonSchemaToTypebox(mcpTool.inputSchema as JsonSchema)

  return {
    name: toolName,
    label,
    description,
    parameters,
    execute: async (_toolCallId, params, signal?) => {
      // 1. 安全校验参数
      const rawArgs: Record<string, unknown> =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
      const sanitizedArgs = sanitizeMcpArgs(toolName, rawArgs, mcpTool.inputSchema)

      // 2. 调用 MCP server(支持 AbortSignal)
      let result: McpCallResult | undefined
      try {
        if (signal) {
          // 用 AbortSignal 包装调用,超时或取消时拒绝
          result = await callToolWithSignal(serverId, mcpTool.name, sanitizedArgs, signal)
        } else {
          result = await mcpService.callTool(serverId, mcpTool.name, sanitizedArgs)
        }
      } catch (err) {
        if (signal?.aborted) {
          throw new Error(`MCP 工具 ${toolName} 调用被取消`)
        }
        throw new Error(`MCP 工具 ${toolName} 调用失败: ${(err as Error).message}`)
      }

      // 3. 格式化结果为 AgentToolResult
      return formatMcpResult(toolName, result)
    },
  }
}

/**
 * 用 AbortSignal 包装 MCP 工具调用
 * 当 signal abort 时拒绝 Promise(不实际中断已发出的 JSON-RPC 请求,但释放调用方)
 */
async function callToolWithSignal(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<McpCallResult> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new Error(`MCP 工具 ${toolName} 调用被取消`))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    mcpService
      .callTool(serverId, toolName, args)
      .then((r) => {
        signal.removeEventListener('abort', onAbort)
        resolve(r)
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      })
  })
}

/**
 * 将 MCP 调用结果格式化为 AgentToolResult
 */
function formatMcpResult(toolName: string, result: McpCallResult): AgentToolResult<unknown> {
  // 拼接所有 text 内容
  const textParts: string[] = []
  for (const item of result.content || []) {
    if (item.type === 'text' && item.text) {
      textParts.push(item.text)
    }
  }
  const text = textParts.join('\n') || '(空响应)'

  // isError 标记由 Agent 框架处理(此处仅返回文本)
  return {
    content: [
      {
        type: 'text' as const,
        text: result.isError
          ? `⚠️ MCP 工具 ${toolName} 返回错误:\n${text}`
          : `✅ MCP 工具 ${toolName} 执行结果:\n${text}`,
      },
    ],
    details: { serverError: result.isError === true },
  }
}

// =============================================================
// 按 Agent 聚合 MCP 工具
// =============================================================

/**
 * 获取指定 Agent 可用的所有 MCP 工具(已适配为 AgentTool)
 *
 * 三层配置合并优先级:技能级 > Agent 级 > 全局
 * 详见 mcp-service.ts 的 listToolsForAgent()
 *
 * @param agentId Agent ID
 * @param agentMcpServers Agent 级启用的全局 MCP server ID 列表
 * @param skillMcpServers 技能级临时 MCP server 配置(激活时加载,结束时清理)
 * @returns AgentTool<any>[] 可能为空数组(MCP 未启用或无配置时)
 */
export async function getMcpToolsForAgent(
  agentId: string,
  agentMcpServers?: string[],
  skillMcpServers?: McpServerConfig[],
): Promise<AnyAgentTool[]> {
  try {
    const mcpTools = await mcpService.listToolsForAgent(agentId, agentMcpServers, skillMcpServers)
    if (mcpTools.length === 0) return []

    // 适配为 AgentTool,按 serverId+toolName 去重(技能级覆盖全局同名)
    const seen = new Set<string>()
    const agentTools: AnyAgentTool[] = []
    for (const mcpTool of mcpTools) {
      const key = `${mcpTool.serverId}::${mcpTool.name}`
      if (seen.has(key)) continue
      seen.add(key)
      agentTools.push(mcpToolToAgentTool(mcpTool.serverId, mcpTool))
    }
    return agentTools
  } catch (err) {
    console.warn(`[mcp-tools] Failed to load MCP tools for agent ${agentId}:`, err)
    return []
  }
}
