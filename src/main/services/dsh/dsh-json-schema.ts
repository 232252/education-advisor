// =============================================================
// 把工具参数收成 dsh 能注册的 JSON Schema 子集
//
// dsh-tools 只接受 type / oneOf / properties / required /
// additionalProperties(布尔) / items / enum / const，外加说明字段。
// TypeBox 的联合类型是 anyOf，字符串约束是 pattern、minLength。
// 这些关键字会让整份工具注册失败，模型就看不到这个工具。
// =============================================================

const SUPPORTED = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'description',
  'title',
  'default',
  'examples',
])

const EMPTY_OBJECT = { type: 'object', properties: {} }

/** 模型可见的参数说明。执行仍用原来的 schema。 */
export function toDshToolInputSchema(schema: unknown): Record<string, unknown> {
  let plain: unknown
  try {
    plain = JSON.parse(JSON.stringify(schema ?? null))
  } catch {
    return { ...EMPTY_OBJECT }
  }
  const cleaned = cleanNode(plain)
  if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) return { ...EMPTY_OBJECT }
  const record = cleaned as Record<string, unknown>
  if (record.type !== 'object') return { ...EMPTY_OBJECT }
  return record
}

function cleanNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map((item) => cleanNode(item))
  if (!node || typeof node !== 'object') return node
  const source = node as Record<string, unknown>
  const next: Record<string, unknown> = {}
  const notes: string[] = []
  if (source.anyOf !== undefined && source.oneOf === undefined) {
    next.oneOf = cleanNode(source.anyOf)
  }
  for (const [key, value] of Object.entries(source)) {
    if (key === 'anyOf') continue
    if (key === 'oneOf') {
      next.oneOf = cleanNode(value)
      continue
    }
    if (!SUPPORTED.has(key)) {
      if (value !== undefined) notes.push(`${key}: ${noteValue(value)}`)
      continue
    }
    if (key === 'additionalProperties') {
      if (typeof value === 'boolean') next.additionalProperties = value
      continue
    }
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const properties: Record<string, unknown> = {}
      for (const [name, property] of Object.entries(value as Record<string, unknown>)) {
        properties[name] = cleanNode(property)
      }
      next.properties = properties
      continue
    }
    if (key === 'items') {
      next.items = cleanNode(value)
      continue
    }
    next[key] = value
  }
  if (notes.length > 0) {
    const extra = notes.join('; ')
    const description = typeof next.description === 'string' ? next.description : ''
    next.description = description ? `${description} (${extra})` : extra
  }
  return next
}

function noteValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return '…'
  }
}
