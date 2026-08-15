// =============================================================
// MCP 工具参数安全校验
//
// 安全屏障复用:
//   - 路径参数(名称含 path/file/dir)强制走 validateFilePath(14 个敏感路径黑名单)
//   - 所有字符串参数走 sanitizeArg(控制字符/shell 元字符/-- 前缀过滤)
//   - 递归处理嵌套对象和数组
// =============================================================

import { sanitizeArg } from '../../eaa-tools'
import { validateFilePath } from '../../file-tools'
import type { JsonSchema } from './schema'

/** 路径参数名关键字(小写匹配) */
const PATH_PARAM_KEYWORDS = ['path', 'file', 'dir', 'folder', 'filepath', 'filename']

/**
 * 判断参数名是否疑似路径参数
 */
function isPathLikeParam(name: string): boolean {
  const lower = name.toLowerCase()
  return PATH_PARAM_KEYWORDS.some((kw) => lower === kw || lower.includes(kw))
}

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
