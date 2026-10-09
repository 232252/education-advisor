/**
 * 对话里展示给教师的工具名。
 * dsh 把 MCP 工具注册成 mcp__<server>__<raw>，模型必须用这个全名调用。
 * 气泡和运行页只显示原始名字。
 */
export function displayToolName(name: string): string {
  if (!name.startsWith('mcp__')) return name
  const rest = name.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  if (sep <= 0 || sep >= rest.length - 2) return name
  return rest.slice(sep + 2)
}

/** 回复正文里的工具全名改成短名，教师不用看到 mcp__ 前缀。 */
export function displayToolMentions(text: string): string {
  return text.replace(/mcp__[A-Za-z0-9]+__([A-Za-z0-9_]+)/g, '$1')
}
