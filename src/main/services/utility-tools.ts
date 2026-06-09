// =============================================================
// Utility Tools — Agent 通用辅助工具
// 时间、计算、编码等基础能力
// =============================================================

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

function textResult(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
  }
}

// =============================================================
// Schema 定义
// =============================================================

const currentTimeParams = Type.Object({
  timezone: Type.Optional(Type.String({ description: '时区，如 Asia/Shanghai（默认系统时区）' })),
})

const calculateParams = Type.Object({
  expression: Type.String({
    description: '数学表达式，如 "3 * 22"、"(198 + 170 + 156) / 3"、"29 - 6"',
  }),
})

// =============================================================
// 1. 获取当前时间
// =============================================================

const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六']

export const getCurrentTimeTool: AgentTool<typeof currentTimeParams> = {
  name: 'get_current_time',
  label: '获取当前时间',
  description:
    '获取当前的日期和时间，包括星期几、是否工作日/周末。用于需要知道"今天几号"、"星期几"、"现在几点"等场景。',
  parameters: currentTimeParams,
  execute: async (_toolCallId, params) => {
    const now = new Date()
    const tz =
      params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const formatted = formatter.format(now)

    const dayOfWeek = now.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

    // ISO 格式
    const iso = now.toISOString()
    const dateOnly = iso.split('T')[0]
    const timeOnly = iso.split('T')[1].split('.')[0]

    return textResult(
      `🕐 当前时间\n` +
        `日期: ${dateOnly}（${formatted.split(' ').slice(3).join(' ')}）\n` +
        `时间: ${timeOnly}\n` +
        `星期: ${WEEKDAYS_CN[dayOfWeek]}\n` +
        `类型: ${isWeekend ? '周末' : '工作日'}\n` +
        `时区: ${tz}\n` +
        `ISO: ${iso}`,
    )
  },
}

// =============================================================
// 2. 数学计算器
// =============================================================

/**
 * 安全的数学表达式求值
 * 只允许: 数字、四则运算、括号、小数点、空格、常用数学函数
 * 禁止: 变量、赋值、函数调用（Math.* 白名单）、控制流
 */
function safeEval(expr: string): number {
  // 预处理：替换中文/全角符号
  let cleaned = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/＋/g, '+')
    .replace(/－/g, '-')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .trim()

  // 白名单检查：只允许数字、运算符、括号、空格、小数点、百分号
  // 以及 Math.abs, Math.round, Math.ceil, Math.floor, Math.sqrt, Math.pow, Math.min, Math.max
  const allowedPattern = /^[\d+\-*/().,%\s]+$/
  const mathFuncPattern = /\b(Math\.(abs|round|ceil|floor|sqrt|pow|min|max|log|log2|log10))\b/

  // 先移除合法的 Math.xxx 调用再检查
  const withoutMath = cleaned.replace(mathFuncPattern, '0')

  if (!allowedPattern.test(withoutMath)) {
    throw new Error(`表达式包含不允许的字符。只支持数字、四则运算 (+-×÷) 和括号。\n表达式: ${expr}`)
  }

  // 将百分号转为除法
  cleaned = cleaned.replace(/(\d+\.?\d*)%/g, '($1/100)')

  // 安全检查：不允许连续的运算符（如 ++, --, +-）
  if (/[+\-*/]{2,}/.test(cleaned.replace(/\s/g, '').replace(/\(-/g, '(0-'))) {
    throw new Error('表达式包含连续运算符，请检查语法')
  }

  try {
    // 使用 Function 构造器在隔离作用域中求值
    const fn = new Function(`"use strict"; return (${cleaned});`)
    const result = fn()

    if (typeof result !== 'number' || !Number.isFinite(result)) {
      throw new Error(`计算结果无效: ${result}`)
    }

    return result
  } catch (err) {
    throw new Error(
      `计算失败: ${err instanceof Error ? err.message : String(err)}\n表达式: ${expr}`,
    )
  }
}

export const calculateTool: AgentTool<typeof calculateParams> = {
  name: 'calculate',
  label: '数学计算',
  description:
    '计算数学表达式。支持加减乘除、括号、百分比。例如: "3 * 22"、"(198 + 170 + 156) / 3"、"29 - 6"、"100 * 85%"',
  parameters: calculateParams,
  execute: async (_toolCallId, params) => {
    const result = safeEval(params.expression)

    // 格式化结果：整数不显示小数，浮点数最多6位
    const formatted = Number.isInteger(result)
      ? String(result)
      : Number(result.toFixed(6)).toString()

    return textResult(`🧮 ${params.expression} = ${formatted}`)
  },
}

// =============================================================
// 导出：所有实用工具
// =============================================================

// biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
export const allUtilityTools: AgentTool<any>[] = [getCurrentTimeTool, calculateTool]
