// =============================================================
// 设置 schema 校验 — dotPath 格式 / 值类型 / 路径可达性 / 深度防御
//
// 修复:
//   P1-25: update() 校验 dotPath 格式和路径可达性
//   L-9: 防止原型链污染(__proto__ / constructor / prototype)
//   R150: 基于 DEFAULT_SETTINGS 的类型校验
// =============================================================

import { DEFAULT_SETTINGS } from './defaults'

/**
 * 校验 dotPath 与 value(原 update() 的校验部分,逐字搬移):
 * - 校验 dotPath 非空、所有段非空
 * - 拒绝危险 key(原型链污染)
 * - 拒绝 undefined/null/function/symbol/bigint、NaN/Infinity、超长字符串、深嵌套对象
 * - 校验路径在 DEFAULT_SETTINGS 中存在(防 typo)
 * - 校验 value 类型与默认值一致(数组性 + typeof)
 *
 * @throws Error 校验失败时抛出(消息与原实现一致)
 */
export function validateUpdate(dotPath: string, value: unknown): void {
  if (typeof dotPath !== 'string' || dotPath.length === 0) {
    throw new Error('dotPath must be a non-empty string')
  }
  const keys = dotPath.split('.')
  if (keys.some((k) => k.length === 0)) {
    throw new Error(`dotPath contains empty segment: ${dotPath}`)
  }
  // L-9 修复: 防止原型链污染 — 拒绝 __proto__ / constructor / prototype 作为 key
  const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype'])
  for (const k of keys) {
    if (dangerousKeys.has(k)) {
      throw new Error(`dotPath contains dangerous key '${k}': ${dotPath}`)
    }
  }

  // RISK 修复 + CONCERN 修复: 基本类型校验,防止 JSON.stringify 抛错或数据污染
  // 拒绝 undefined / null / function / symbol / bigint
  if (
    value === undefined ||
    value === null ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throw new Error(`Invalid value type for ${dotPath}: ${typeof value}`)
  }
  // 拒绝 NaN 和 Infinity (JSON.stringify 会把它们变成 null,静默丢数据)
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`Invalid number value for ${dotPath}: ${value} (NaN/Infinity not allowed)`)
  }
  // 防止超长字符串撑爆 settings.json
  if (typeof value === 'string' && value.length > 1_000_000) {
    throw new Error(`Value too long for ${dotPath}: ${value.length} chars (max 1,000,000)`)
  }
  // 对象深度限制:防止恶意/意外深嵌套对象导致 JSON.stringify 栈溢出
  if (typeof value === 'object') {
    const depth = getObjectDepth(value)
    if (depth > 10) {
      throw new Error(`Object depth too deep for ${dotPath}: ${depth} (max 10)`)
    }
  }

  // 校验路径在默认设置中存在
  let probe: unknown = DEFAULT_SETTINGS as unknown as Record<string, unknown>
  for (const key of keys) {
    if (probe === null || typeof probe !== 'object' || Array.isArray(probe)) {
      throw new Error(`Invalid dotPath (parent is not object): ${dotPath}`)
    }
    probe = (probe as Record<string, unknown>)[key]
    if (probe === undefined) {
      throw new Error(`dotPath not found in default settings: ${dotPath}`)
    }
  }

  // R150 修复: 基于 DEFAULT_SETTINGS 的类型校验
  // 防止传入与 schema 不符的类型(如 general.autoStart = 'yes' 字符串)
  // 原有逻辑只拒绝 undefined/null/function/symbol/bigint,但未校验
  // value 类型是否与默认值一致,导致 boolean 字段可被写入字符串
  const defaultValue = probe
  if (defaultValue !== null && defaultValue !== undefined) {
    const defaultIsArray = Array.isArray(defaultValue)
    const valueIsArray = Array.isArray(value)
    if (defaultIsArray !== valueIsArray) {
      throw new Error(
        `Type mismatch for ${dotPath}: expected ${defaultIsArray ? 'array' : 'non-array'}, got ${valueIsArray ? 'array' : 'non-array'}`,
      )
    }
    const defaultType = typeof defaultValue
    const valueType = typeof value
    if (defaultType !== valueType) {
      throw new Error(`Type mismatch for ${dotPath}: expected ${defaultType}, got ${valueType}`)
    }
  }
}

/** 计算对象最大嵌套深度(防御恶意深嵌套对象) */
export function getObjectDepth(obj: unknown, seen = new WeakSet()): number {
  if (obj === null || typeof obj !== 'object') return 0
  if (seen.has(obj as object)) return 0 // 防止循环引用导致无限递归
  seen.add(obj as object)
  let maxDepth = 0
  try {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      if (typeof val === 'object' && val !== null) {
        const d = getObjectDepth(val, seen)
        if (d > maxDepth) maxDepth = d
      }
    }
  } catch {
    // Object.values 在异常对象上可能抛错,忽略
    return 1
  }
  return maxDepth + 1
}
