// =============================================================
// MCP tool → AgentTool 适配
//
// 职责:
//   - MCP 工具命名/标签/描述/参数/execute 适配
//   - AbortSignal 传递(支持 Agent 中断时取消 MCP 调用)
//   - 调用结果格式化为 AgentToolResult
//
// 命名规则: `mcp_<serverId>_<toolName>` (全部小写,特殊字符替换为 _),
//   与 EAA 工具(eaa_*)和内置工具(read_file 等)区分。
// 调用结果大小限制由 mcp-service.ts 的 callTool 保证(5MB)。
// =============================================================

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { McpTool } from '@shared/types'
import type { McpCallResult } from '../../mcp/types'
import { mcpService } from '../../mcp-service'
import { sanitizeMcpArgs } from './sanitize'
import { type JsonSchema, jsonSchemaToTypebox } from './schema'

// biome-ignore lint/suspicious/noExplicitAny: 异构工具集合,TSchema 约束不兼容 unknown
export type AnyAgentTool = AgentTool<any>

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
