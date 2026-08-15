// =============================================================
// JSON Schema → typebox 转换
//
// MCP server 用 JSON Schema 声明工具参数,AgentTool 用 typebox。
// 未知/不支持类型降级为 Type.Any(),保证不阻塞工具注册。
// =============================================================

import type { TSchema } from 'typebox'
import { Type } from 'typebox'

export interface JsonSchema {
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
